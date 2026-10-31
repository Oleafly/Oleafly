use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::Resources;
use crate::runs::RunError;

pub const WINDOWS_SANDBOX_DEFAULT_ON: bool = false;
const MAX_PRELUDE: usize = 4 * 1024;
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const MAX_HOSTS: usize = 512;

pub fn compute_file(data_root: &Path) -> PathBuf {
    data_root.join("research").join("compute.json")
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComputeSettings {
    #[serde(default)]
    pub version: u8,
    #[serde(default)]
    pub targets: Vec<ComputeTarget>,
    #[serde(default)]
    pub windows_sandbox: Option<bool>,
    #[serde(default)]
    pub tested: BTreeMap<String, TestSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ComputeTarget {
    Ssh {
        id: String,
        label: String,
        host: String,
        #[serde(default)]
        user: Option<String>,
        #[serde(default)]
        port: Option<u16>,
        #[serde(default)]
        remote_root: Option<String>,
        #[serde(default)]
        prelude: String,
    },
    Slurm {
        id: String,
        label: String,
        host: String,
        #[serde(default)]
        user: Option<String>,
        #[serde(default)]
        port: Option<u16>,
        #[serde(default)]
        remote_root: Option<String>,
        #[serde(default)]
        prelude: String,
        #[serde(default)]
        defaults: Resources,
        #[serde(default)]
        gpu_flag: GpuFlag,
    },
    CuaSpace {
        id: String,
        label: String,
        #[serde(default)]
        space: String,
        #[serde(default)]
        per_task: bool,
        #[serde(default)]
        image: Option<String>,
    },
}

impl ComputeTarget {
    pub fn id(&self) -> &str {
        match self {
            Self::Ssh { id, .. } | Self::Slurm { id, .. } | Self::CuaSpace { id, .. } => id,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Ssh { label, .. } | Self::Slurm { label, .. } | Self::CuaSpace { label, .. } => {
                label
            }
        }
    }

    pub fn set_id(&mut self, value: String) {
        match self {
            Self::Ssh { id, .. } | Self::Slurm { id, .. } | Self::CuaSpace { id, .. } => {
                *id = value
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GpuFlag {
    #[default]
    Gres,
    Gpus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestSummary {
    pub at: i64,
    pub ok: bool,
    pub resolved: Option<String>,
    #[serde(default)]
    pub relay: bool,
}

pub fn load(data_root: &Path) -> ComputeSettings {
    let file = compute_file(data_root);
    let Ok(text) = std::fs::read_to_string(&file) else {
        return ComputeSettings::default();
    };
    match serde_json::from_str(&text) {
        Ok(settings) => settings,
        Err(_) => {
            let _ = std::fs::rename(&file, file.with_extension("json.bad"));
            ComputeSettings::default()
        }
    }
}

pub fn update(
    data_root: &Path,
    change: impl FnOnce(&mut ComputeSettings) -> Result<(), RunError>,
) -> Result<ComputeSettings, RunError> {
    let folder = data_root.join("research");
    std::fs::create_dir_all(&folder).map_err(|error| RunError::Io(error.to_string()))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(folder.join("compute.lock"))
        .map_err(|error| RunError::Io(error.to_string()))?;
    fs4::FileExt::lock(&lock).map_err(|error| RunError::Io(error.to_string()))?;
    let mut settings = load(data_root);
    change(&mut settings)?;
    settings.version = 1;
    let text =
        serde_json::to_vec_pretty(&settings).map_err(|error| RunError::Io(error.to_string()))?;
    let temporary = tempfile::NamedTempFile::new_in(&folder)
        .map_err(|error| RunError::Io(error.to_string()))?;
    std::fs::write(temporary.path(), text).map_err(|error| RunError::Io(error.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o600));
    }
    temporary
        .persist(compute_file(data_root))
        .map_err(|error| RunError::Io(error.to_string()))?;
    Ok(settings)
}

fn invalid(message: &str) -> RunError {
    RunError::Config(message.to_string())
}

fn matches_charset(value: &str, allowed: impl Fn(char) -> bool) -> bool {
    value.chars().all(allowed)
}

fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len())
        && matches_charset(id, |c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'
        })
}

fn valid_host(host: &str) -> bool {
    (1..=253).contains(&host.len())
        && !host.starts_with('-')
        && matches_charset(host, |c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '%' | '-')
        })
}

fn valid_user(user: &str) -> bool {
    let mut chars = user.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric() || first == '.' || first == '_')
        && user.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn valid_remote_root(root: &str) -> bool {
    (1..=200).contains(&root.len())
        && !root.starts_with('-')
        && matches_charset(root, |c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-')
        })
        && !root.split('/').any(|part| part == "..")
}

fn valid_name(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && matches_charset(value, |c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ',' | '-')
        })
}

fn check_label(label: &str) -> Result<(), RunError> {
    let length = label.trim().chars().count();
    if length == 0 || length > 80 || label.chars().any(char::is_control) {
        return Err(invalid("Give the target a name of 1 to 80 characters."));
    }
    Ok(())
}

fn check_endpoint(
    host: &str,
    user: &Option<String>,
    port: &Option<u16>,
    remote_root: &Option<String>,
    prelude: &str,
) -> Result<(), RunError> {
    if !valid_host(host) {
        return Err(invalid(
            "Enter a host name or an SSH config alias without spaces.",
        ));
    }
    if user.as_deref().is_some_and(|user| !valid_user(user)) {
        return Err(invalid(
            "Enter a user name with letters, numbers, dots, dashes or underscores.",
        ));
    }
    if port.is_some_and(|port| port == 0) {
        return Err(invalid("Enter a port from 1 to 65535."));
    }
    if remote_root
        .as_deref()
        .is_some_and(|root| !valid_remote_root(root))
    {
        return Err(invalid(
            "Enter a remote folder with letters, numbers, dots, dashes, underscores or slashes.",
        ));
    }
    if prelude.len() > MAX_PRELUDE || prelude.contains('\0') {
        return Err(invalid("The setup lines can be up to 4 KB."));
    }
    Ok(())
}

pub fn validate_resources(resources: &Resources) -> Result<(), RunError> {
    if resources
        .time_minutes
        .is_some_and(|minutes| minutes == 0 || minutes > 60 * 24 * 30)
    {
        return Err(invalid("Enter a time limit from 1 minute to 30 days."));
    }
    for value in [&resources.partition, &resources.account, &resources.qos]
        .into_iter()
        .flatten()
    {
        if !valid_name(value) {
            return Err(invalid(
                "Use letters, numbers, dots, commas, dashes or underscores.",
            ));
        }
    }
    if resources
        .memory_gb
        .is_some_and(|memory| memory == 0 || memory > 65_536)
    {
        return Err(invalid("Enter the memory in GB, from 1 to 65536."));
    }
    if resources.gpus.is_some_and(|gpus| gpus > 64) {
        return Err(invalid("Enter from 0 to 64 GPUs."));
    }
    if resources.cpus.is_some_and(|cpus| cpus == 0 || cpus > 1024) {
        return Err(invalid("Enter from 1 to 1024 CPUs."));
    }
    Ok(())
}

pub fn validate_target(target: &ComputeTarget) -> Result<(), RunError> {
    if !valid_id(target.id()) {
        return Err(invalid("The target id is invalid."));
    }
    check_label(target.label())?;
    match target {
        ComputeTarget::Ssh {
            host,
            user,
            port,
            remote_root,
            prelude,
            ..
        } => check_endpoint(host, user, port, remote_root, prelude),
        ComputeTarget::Slurm {
            host,
            user,
            port,
            remote_root,
            prelude,
            defaults,
            ..
        } => {
            check_endpoint(host, user, port, remote_root, prelude)?;
            validate_resources(defaults)
        }
        ComputeTarget::CuaSpace {
            space,
            per_task,
            image,
            ..
        } => {
            if !per_task
                && !((1..=63).contains(&space.len())
                    && matches_charset(space, |c| {
                        c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
                    }))
            {
                return Err(invalid(
                    "Enter the Space name: letters, numbers, dots, dashes or underscores.",
                ));
            }
            if image.as_deref().is_some_and(|image| {
                !(1..=200).contains(&image.len())
                    || !matches_charset(image, |c| {
                        c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | ':' | '@' | '-')
                    })
            }) {
                return Err(invalid("Enter an image name without spaces."));
            }
            Ok(())
        }
    }
}

pub fn new_target_id() -> String {
    format!("t-{:012x}", rand::random::<u64>() & 0xffff_ffff_ffff)
}

pub fn find<'a>(settings: &'a ComputeSettings, id: &str) -> Option<&'a ComputeTarget> {
    settings.targets.iter().find(|target| target.id() == id)
}

pub fn executor_for(target: Option<&ComputeTarget>) -> &'static str {
    match target {
        None => "local",
        Some(ComputeTarget::Ssh { .. }) => "ssh",
        Some(ComputeTarget::Slurm { .. }) => "slurm",
        Some(ComputeTarget::CuaSpace { .. }) => "cua-space",
    }
}

pub fn windows_sandbox_enabled(data_root: &Path) -> bool {
    if !cfg!(windows) {
        return true;
    }
    load(data_root)
        .windows_sandbox
        .unwrap_or(WINDOWS_SANDBOX_DEFAULT_ON)
}

pub const WINDOWS_SWITCH_MESSAGE: &str =
    "Turn on the Windows sandbox (beta) in Settings › Research › Compute to run commands on this computer.";

pub fn local_commands_unavailable_reason(data_root: &Path) -> Option<String> {
    if cfg!(windows) && !windows_sandbox_enabled(data_root) {
        return Some(WINDOWS_SWITCH_MESSAGE.to_string());
    }
    match oleafly_sandbox::availability() {
        oleafly_sandbox::Availability::Available => None,
        oleafly_sandbox::Availability::Unavailable(reason) => Some(reason),
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
}

fn split_keyword(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let position = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let keyword = line[..position].to_ascii_lowercase();
    let value = line[position..]
        .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
        .trim();
    Some((keyword, value.trim_matches('"').to_string()))
}

fn glob_match(pattern: &str, name: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == name,
        Some((prefix, suffix)) => {
            name.len() >= prefix.len() + suffix.len()
                && name.starts_with(prefix)
                && name.ends_with(suffix)
        }
    }
}

fn included_files(pattern: &str, ssh_dir: &Path) -> Vec<PathBuf> {
    let path = if Path::new(pattern).is_absolute() {
        PathBuf::from(pattern)
    } else if let Some(rest) = pattern.strip_prefix("~/") {
        ssh_dir
            .parent()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| ssh_dir.join(rest))
    } else {
        ssh_dir.join(pattern)
    };
    let folder = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| ssh_dir.to_path_buf());
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| glob_match(&name, &entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect();
    files.sort();
    files
}

fn add_hosts(aliases: &str, hosts: &mut Vec<SshConfigHost>, current: &mut Vec<usize>) {
    current.clear();
    for alias in aliases.split_whitespace() {
        if alias.contains(['*', '?', '!']) || hosts.len() >= MAX_HOSTS {
            continue;
        }
        if hosts.iter().any(|host| host.alias == alias) {
            continue;
        }
        hosts.push(SshConfigHost {
            alias: alias.to_string(),
            host_name: None,
            user: None,
            port: None,
        });
        current.push(hosts.len() - 1);
    }
}

fn read_config(file: &Path, ssh_dir: &Path, depth: usize, hosts: &mut Vec<SshConfigHost>) {
    if depth > 4 || hosts.len() >= MAX_HOSTS {
        return;
    }
    let Ok(metadata) = std::fs::metadata(file) else {
        return;
    };
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        return;
    }
    let Ok(text) = std::fs::read_to_string(file) else {
        return;
    };
    let mut current: Vec<usize> = Vec::new();
    for line in text.lines() {
        let Some((keyword, value)) = split_keyword(line) else {
            continue;
        };
        match keyword.as_str() {
            "include" => {
                for pattern in value.split_whitespace() {
                    for included in included_files(pattern, ssh_dir) {
                        read_config(&included, ssh_dir, depth + 1, hosts);
                    }
                }
                current.clear();
            }
            "host" => add_hosts(&value, hosts, &mut current),
            "match" => current.clear(),
            "hostname" => current
                .iter()
                .for_each(|&index| hosts[index].host_name = Some(value.clone())),
            "user" => current
                .iter()
                .for_each(|&index| hosts[index].user = Some(value.clone())),
            "port" => {
                let port = value.parse().ok();
                current.iter().for_each(|&index| hosts[index].port = port);
            }
            _ => {}
        }
    }
}

pub fn ssh_config_hosts(ssh_dir: &Path) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    read_config(&ssh_dir.join("config"), ssh_dir, 0, &mut hosts);
    hosts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh(id: &str, host: &str) -> ComputeTarget {
        ComputeTarget::Ssh {
            id: id.into(),
            label: "Lab".into(),
            host: host.into(),
            user: None,
            port: None,
            remote_root: None,
            prelude: String::new(),
        }
    }

    #[test]
    fn missing_and_corrupt_settings_load_defaults() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(load(root.path()), ComputeSettings::default());
        std::fs::create_dir_all(root.path().join("research")).unwrap();
        std::fs::write(compute_file(root.path()), "{not json").unwrap();
        assert_eq!(load(root.path()), ComputeSettings::default());
        assert!(root.path().join("research/compute.json.bad").exists());
    }

    #[test]
    fn targets_use_camel_case_tags() {
        let mut target = ssh("t-1", "h");
        if let ComputeTarget::Ssh { remote_root, .. } = &mut target {
            *remote_root = Some("scratch".into());
        }
        let json = serde_json::to_string(&target).unwrap();
        assert!(
            json.contains("\"kind\":\"ssh\"") && json.contains("\"remoteRoot\""),
            "{json}"
        );
        let cua = ComputeTarget::CuaSpace {
            id: "t-2".into(),
            label: "Space".into(),
            space: String::new(),
            per_task: true,
            image: None,
        };
        let json = serde_json::to_string(&cua).unwrap();
        assert!(
            json.contains("\"kind\":\"cuaSpace\"") && json.contains("\"perTask\""),
            "{json}"
        );
    }

    #[test]
    fn validation_rejects_injection_and_option_like_values() {
        for host in ["-oProxyCommand=x", "a b", "h\n"] {
            assert!(validate_target(&ssh("t-1", host)).is_err(), "{host:?}");
        }
        let mut target = ssh("t-1", "h");
        if let ComputeTarget::Ssh { user, .. } = &mut target {
            *user = Some("root;rm".into());
        }
        assert!(validate_target(&target).is_err());
        let resources = Resources {
            partition: Some("gpu\n#SBATCH --x".into()),
            ..Resources::default()
        };
        assert!(validate_resources(&resources).is_err());
        for root in ["../x", "/scratch/j doe"] {
            let mut target = ssh("t-1", "h");
            if let ComputeTarget::Ssh { remote_root, .. } = &mut target {
                *remote_root = Some(root.into());
            }
            assert!(validate_target(&target).is_err(), "{root:?}");
        }
        assert!(validate_target(&ssh("t-1", "cluster.example.edu")).is_ok());
    }

    #[test]
    fn concurrent_updates_do_not_lose_targets() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().to_path_buf();
        let workers: Vec<_> = (0..2)
            .map(|worker| {
                let path = path.clone();
                std::thread::spawn(move || {
                    for index in 0..20 {
                        update(&path, |settings| {
                            settings
                                .targets
                                .push(ssh(&format!("t-{worker}-{index}"), "h"));
                            Ok(())
                        })
                        .unwrap();
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(load(&path).targets.len(), 40);
    }

    #[test]
    fn ssh_config_hosts_skip_patterns_and_follow_includes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("config.d")).unwrap();
        std::fs::write(
            dir.path().join("config"),
            "Host *\n  ForwardAgent no\nHost gpu-* !gpu-old\n  User x\nHost cluster\n  HostName cluster.example.edu\n  User jdoe\n  Port 2222\nInclude config.d/*\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("config.d/lab"),
            "Host lab lab-alias\n  HostName lab.example.edu\n",
        )
        .unwrap();
        let hosts = ssh_config_hosts(dir.path());
        let aliases: Vec<&str> = hosts.iter().map(|host| host.alias.as_str()).collect();
        assert_eq!(aliases, ["cluster", "lab", "lab-alias"]);
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[0].user.as_deref(), Some("jdoe"));
    }

    #[test]
    fn ssh_config_accepts_crlf_equals_and_any_keyword_case() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("config"),
            "HOST box\r\n  hostname=box.example.edu\r\n  PORT 22\r\n",
        )
        .unwrap();
        let hosts = ssh_config_hosts(dir.path());
        assert_eq!(hosts[0].host_name.as_deref(), Some("box.example.edu"));
        assert_eq!(hosts[0].port, Some(22));
    }
}
