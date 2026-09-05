use super::types::*;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};

const REGISTRY: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const DOWNLOAD_LIMIT: usize = 100 * 1024 * 1024;
const EXPANDED_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub definition: Option<AgentDefinition>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct InstallReceipt {
    version: String,
    executable: PathBuf,
    node: bool,
}

#[derive(Clone, Debug)]
pub struct Launch {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub version: Option<String>,
    pub managed: bool,
}

pub fn builtins() -> Vec<AgentDefinition> {
    [
        (
            "claude",
            "Claude Code",
            "@agentclientprotocol/claude-agent-acp@0.74.0",
            "claude-agent-acp",
            22,
            vec![],
        ),
        (
            "codex",
            "Codex",
            "@agentclientprotocol/codex-acp@1.10.0",
            "codex-acp",
            20,
            vec![],
        ),
        (
            "gemini",
            "Gemini CLI",
            "@google/gemini-cli@0.57.0",
            "gemini",
            20,
            vec!["--acp".into()],
        ),
    ]
    .into_iter()
    .map(|(id, name, package, cmd, node, args)| AgentDefinition {
        id: id.into(),
        name: name.into(),
        version: package.rsplit('@').next().unwrap_or_default().into(),
        description: "Uses the agent's own CLI account and permissions.".into(),
        builtin: true,
        distribution: Distribution {
            npx: Some(PackageDistribution {
                package: package.into(),
                cmd: Some(cmd.into()),
                args,
                node_major: Some(node),
                env: BTreeMap::new(),
            }),
            ..Distribution::default()
        },
    })
    .collect()
}

pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{}-{}", os, std::env::consts::ARCH)
}

fn exact_version(value: &str) -> bool {
    exact_npm_version(value) || exact_python_version(value)
}

fn exact_npm_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 80 || !value.is_ascii() {
        return false;
    }
    let (release, build) = value
        .split_once('+')
        .map_or((value, None), |(a, b)| (a, Some(b)));
    let (release, pre) = release
        .split_once('-')
        .map_or((release, None), |(a, b)| (a, Some(b)));
    let numeric = |part: &str| {
        !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && (part == "0" || !part.starts_with('0'))
    };
    let identifiers = |value: &str, prerelease: bool| {
        value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && (!prerelease || !part.bytes().all(|byte| byte.is_ascii_digit()) || numeric(part))
        })
    };
    release.split('.').count() == 3
        && release.split('.').all(numeric)
        && pre.map_or(true, |part| identifiers(part, true))
        && build.map_or(true, |part| identifiers(part, false))
}

fn exact_python_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 80 || !value.is_ascii() {
        return false;
    }
    let normalized = value.to_ascii_lowercase();
    let (public, local) = normalized
        .split_once('+')
        .map_or((normalized.as_str(), None), |(a, b)| (a, Some(b)));
    if local.is_some_and(|part| {
        !part
            .split(['.', '-', '_'])
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric()))
    }) {
        return false;
    }
    let public = public.strip_prefix('v').unwrap_or(public);
    let release = if let Some((epoch, release)) = public.split_once('!') {
        if epoch.is_empty() || !epoch.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
        release
    } else {
        public
    };
    if !release.starts_with(|ch: char| ch.is_ascii_digit()) {
        return false;
    }
    let mut rest = release.trim_start_matches(|ch: char| ch.is_ascii_digit());
    while rest
        .strip_prefix('.')
        .is_some_and(|part| part.starts_with(|ch: char| ch.is_ascii_digit()))
    {
        rest = rest[1..].trim_start_matches(|ch: char| ch.is_ascii_digit());
    }
    rest = python_version_suffix(
        rest,
        &["preview", "alpha", "beta", "pre", "rc", "a", "b", "c"],
    );
    rest = if let Some(post) = rest
        .strip_prefix('-')
        .filter(|part| part.starts_with(|ch: char| ch.is_ascii_digit()))
    {
        post.trim_start_matches(|ch: char| ch.is_ascii_digit())
    } else {
        python_version_suffix(rest, &["post", "rev", "r"])
    };
    python_version_suffix(rest, &["dev"]).is_empty()
}

fn python_version_suffix<'a>(value: &'a str, labels: &[&str]) -> &'a str {
    let candidate = value.strip_prefix(['.', '-', '_']).unwrap_or(value);
    labels
        .iter()
        .find_map(|label| candidate.strip_prefix(label))
        .map_or(value, |rest| {
            rest.strip_prefix(['.', '-', '_'])
                .unwrap_or(rest)
                .trim_start_matches(|ch: char| ch.is_ascii_digit())
        })
}

pub fn package_parts(spec: &str, npm: bool) -> Result<(&str, &str), String> {
    let (name, version) = if npm {
        spec.rsplit_once('@')
    } else {
        spec.split_once("==")
    }
    .ok_or("Use a package with an exact version.")?;
    let valid = !name.is_empty()
        && name.len() <= 160
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"@/._-".contains(&b));
    let scoped =
        name.starts_with('@') && name.matches('/').count() == 1 && !name[1..].contains('@');
    let unscoped = !name.contains('/') && !name.contains('@');
    let pinned = if npm {
        exact_npm_version(version)
    } else {
        exact_python_version(version)
    };
    if !valid || (!scoped && !unscoped) || name.contains("..") || !pinned {
        return Err(
            "Use a package name with an exact version, without a URL or version range.".into(),
        );
    }
    Ok((name, version))
}

#[cfg(test)]
#[path = "tests/catalog.rs"]
mod catalog_tests;

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn validate_args(args: &[String]) -> Result<(), String> {
    if args.len() > 64
        || args
            .iter()
            .any(|v| v.len() > 4096 || v.contains('\0') || v.contains('\n') || v.contains('\r'))
    {
        return Err("The agent arguments are too long or contain control characters.".into());
    }
    if args.iter().any(|v| {
        let value = v.to_ascii_lowercase();
        [
            "--yolo",
            "--skip-trust",
            "--dangerously-skip-permissions",
            "--dangerously-bypass-approvals-and-sandbox",
            "--api-key",
            "--password",
            "--access-token",
            "--token",
        ]
        .iter()
        .any(|flag| value == *flag || value.starts_with(&format!("{flag}=")))
    }) {
        return Err("Keep credentials and permission-bypass flags out of agent definitions. Sign in through the CLI.".into());
    }
    Ok(())
}

pub fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && !path.to_string_lossy().contains('\\')
        && !path.to_string_lossy().contains(':')
}

pub fn validate(definition: &AgentDefinition) -> Result<(), String> {
    if !valid_id(&definition.id)
        || definition.name.trim().is_empty()
        || definition.name.len() > 120
        || definition.description.len() > 4000
        || !exact_version(&definition.version)
    {
        return Err("Give the agent a lowercase ID, a name and an exact version.".into());
    }
    let dist = &definition.distribution;
    if dist.npx.is_none() && dist.uvx.is_none() && dist.binary.is_empty() && dist.command.is_none()
    {
        return Err("Add an npm, uv, binary or installed-command distribution.".into());
    }
    for (package, npm) in [(dist.npx.as_ref(), true), (dist.uvx.as_ref(), false)] {
        if let Some(package) = package {
            package_parts(&package.package, npm)?;
            validate_args(&package.args)?;
            if !package.env.is_empty() {
                return Err("Environment values cannot be stored in agent definitions. Configure authentication in the CLI.".into());
            }
            if let Some(cmd) = &package.cmd {
                if !valid_command_name(cmd) {
                    return Err("The package command must be a simple executable name.".into());
                }
            }
        }
    }
    if dist.binary.len() > 12 {
        return Err("An agent definition has too many platforms.".into());
    }
    for binary in dist.binary.values() {
        validate_args(&binary.args)?;
        if !safe_relative(Path::new(&binary.cmd)) || !binary.env.is_empty() {
            return Err("Binary commands must stay inside their archive and cannot store environment values.".into());
        }
        let url = reqwest::Url::parse(&binary.archive).map_err(|_| "The binary URL is invalid.")?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err("Binary downloads require an HTTPS URL without credentials.".into());
        }
        if let Some(hash) = &binary.sha256 {
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("The binary SHA-256 must contain 64 hexadecimal characters.".into());
            }
        }
    }
    if let Some(command) = &dist.command {
        validate_args(&command.args)?;
        if command.executable.is_empty()
            || command.executable.len() > 4096
            || command.executable.contains(['\0', '\n', '\r'])
        {
            return Err("The executable path is invalid.".into());
        }
        if !Path::new(&command.executable).is_absolute() && !valid_command_name(&command.executable)
        {
            return Err("Use an absolute executable path or a command name from PATH.".into());
        }
        if cfg!(windows)
            && Path::new(&command.executable)
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "cmd" | "bat" | "ps1" | "js" | "py"
                    )
                })
        {
            return Err("Use a native executable with argument arrays, or a pinned package, instead of a Windows command script.".into());
        }
        let stem = Path::new(&command.executable)
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or_default();
        if matches!(
            stem,
            "npx" | "npm" | "pnpm" | "yarn" | "uvx" | "uv" | "bunx"
        ) {
            return Err("Use a pinned package distribution instead of a package launcher.".into());
        }
    }
    Ok(())
}

fn valid_command_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && !value.starts_with('.')
}

pub fn discover(name: &str) -> Option<PathBuf> {
    if Path::new(name).is_absolute() {
        return executable_path(PathBuf::from(name));
    }
    if !valid_command_name(name) {
        return None;
    }
    let mut directories: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .filter(|p| p.is_absolute())
            .collect();
    if let Ok(home) = crate::paths::home_dir() {
        directories.extend([
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".npm-global/bin"),
            home.join(".bun/bin"),
        ]);
    }
    #[cfg(unix)]
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    for directory in directories {
        if let Some(path) = executable_path(directory.join(name)) {
            return Some(path);
        }
        #[cfg(windows)]
        if let Some(path) = executable_path(directory.join(format!("{name}.exe"))) {
            return Some(path);
        }
    }
    None
}

fn executable_path(path: PathBuf) -> Option<PathBuf> {
    let metadata = path.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    #[cfg(windows)]
    {
        let native = path.extension().is_some_and(|extension| {
            extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("com")
        });
        if !native {
            return None;
        }
    }
    path.canonicalize().ok()
}

fn receipt_dir(root: &Path, definition: &AgentDefinition) -> PathBuf {
    root.join("agents")
        .join(&definition.id)
        .join(&definition.version)
}

fn read_receipt(root: &Path, definition: &AgentDefinition) -> Option<InstallReceipt> {
    let directory = receipt_dir(root, definition).canonicalize().ok()?;
    let receipt: InstallReceipt =
        serde_json::from_slice(&std::fs::read(directory.join("receipt.json")).ok()?).ok()?;
    let executable = receipt.executable.canonicalize().ok()?;
    if !executable.starts_with(&directory)
        || !executable.is_file()
        || receipt.version != definition.version
    {
        return None;
    }
    Some(InstallReceipt {
        executable,
        ..receipt
    })
}

pub fn resolve(root: &Path, definition: &AgentDefinition) -> Result<Launch, String> {
    validate(definition)?;
    let args = definition
        .distribution
        .command
        .as_ref()
        .map(|v| &v.args)
        .or_else(|| definition.distribution.npx.as_ref().map(|v| &v.args))
        .or_else(|| definition.distribution.uvx.as_ref().map(|v| &v.args))
        .or_else(|| {
            definition
                .distribution
                .binary
                .get(&platform())
                .map(|v| &v.args)
        })
        .cloned()
        .unwrap_or_default();
    if let Some(receipt) = read_receipt(root, definition) {
        if receipt.node {
            let mut argv = vec![receipt.executable.to_string_lossy().into_owned()];
            argv.extend(args);
            return Ok(Launch {
                executable: discover("node").ok_or("Install Node.js to run this agent.")?,
                args: argv,
                version: Some(receipt.version),
                managed: true,
            });
        }
        return Ok(Launch {
            executable: receipt.executable,
            args,
            version: Some(receipt.version),
            managed: true,
        });
    }
    let name = definition
        .distribution
        .command
        .as_ref()
        .map(|v| v.executable.clone())
        .or_else(|| {
            definition
                .distribution
                .npx
                .as_ref()
                .and_then(|v| v.cmd.clone())
        })
        .or_else(|| {
            definition
                .distribution
                .uvx
                .as_ref()
                .and_then(|v| v.cmd.clone())
        })
        .or_else(|| {
            definition
                .distribution
                .binary
                .get(&platform())
                .and_then(|v| {
                    Path::new(&v.cmd)
                        .file_name()
                        .map(|v| v.to_string_lossy().into_owned())
                })
        });
    if let Some(path) = name.and_then(|name| discover(&name)) {
        return Ok(Launch {
            executable: path,
            args,
            version: None,
            managed: false,
        });
    }
    if let Some(launch) = existing_npm_launch(definition, &args) {
        return Ok(launch);
    }
    Err("The agent is not installed. Install the pinned version or make its executable available on PATH.".into())
}

fn existing_npm_launch(definition: &AgentDefinition, args: &[String]) -> Option<Launch> {
    let package = definition.distribution.npx.as_ref()?;
    let (name, _) = package_parts(&package.package, true).ok()?;
    let mut directories: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .filter(|path| path.is_absolute())
            .collect();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(appdata).join("npm"));
    }
    for directory in directories {
        let package_root = directory.join("node_modules").join(name);
        let manifest_path = package_root.join("package.json");
        if manifest_path
            .metadata()
            .ok()
            .map_or(true, |meta| meta.len() > 512 * 1024)
        {
            continue;
        }
        let Some(manifest) = std::fs::read(&manifest_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            continue;
        };
        let bin = manifest["bin"]
            .as_str()
            .or_else(|| {
                package
                    .cmd
                    .as_ref()
                    .and_then(|cmd| manifest["bin"][cmd].as_str())
            })
            .or_else(|| {
                manifest["bin"]
                    .as_object()
                    .filter(|map| map.len() == 1)
                    .and_then(|map| map.values().next())
                    .and_then(Value::as_str)
            });
        let Some(bin) = bin.filter(|bin| safe_relative(Path::new(bin))) else {
            continue;
        };
        let Some(executable) = package_root.join(bin).canonicalize().ok() else {
            continue;
        };
        let Some(root) = package_root.canonicalize().ok() else {
            continue;
        };
        if !executable.starts_with(root) || !executable.is_file() {
            continue;
        }
        let mut header = [0u8; 128];
        let count = std::fs::File::open(&executable)
            .and_then(|mut file| file.read(&mut header))
            .ok()?;
        let node_script = String::from_utf8_lossy(&header[..count])
            .lines()
            .next()
            .is_some_and(|line| line.starts_with("#!") && line.contains("node"))
            || executable.extension().is_some_and(|extension| {
                extension == "js" || extension == "mjs" || extension == "cjs"
            });
        let version = manifest["version"].as_str().map(str::to_owned);
        if node_script {
            let mut arguments = vec![executable.to_string_lossy().into_owned()];
            arguments.extend_from_slice(args);
            return Some(Launch {
                executable: discover("node")?,
                args: arguments,
                version,
                managed: false,
            });
        }
        if let Some(executable) = executable_path(executable) {
            return Some(Launch {
                executable,
                args: args.to_vec(),
                version,
                managed: false,
            });
        }
    }
    None
}

pub fn install_reason(definition: &AgentDefinition) -> Option<String> {
    if definition.distribution.npx.is_some() {
        return if discover("node").is_none() || npm_cli().is_none() {
            Some("Install Node.js and npm to install this agent.".into())
        } else {
            None
        };
    }
    if let Some(package) = &definition.distribution.uvx {
        if cfg!(windows) {
            return Some("Managed uv installations are not supported on Windows. Use an installed executable.".into());
        }
        if package.cmd.is_none() {
            return Some("Set the Python package executable name in cmd before installing.".into());
        }
        return if discover("uv").is_none() {
            Some("Install uv to install this Python agent.".into())
        } else {
            None
        };
    }
    if definition.distribution.command.is_some() {
        return Some("This definition uses an existing executable. Install it using the agent's instructions.".into());
    }
    match definition.distribution.binary.get(&platform()) {
        None => Some(format!("No binary is published for {}.", platform())),
        Some(binary) if binary.sha256.is_none() => Some("This binary has no SHA-256 checksum. Use a verified distribution or an installed executable.".into()),
        Some(binary) if !binary.archive.ends_with(".tar.gz") && !binary.archive.ends_with(".zip") => Some("Only ZIP and tar.gz binary distributions are supported.".into()),
        Some(_) => None,
    }
}

pub fn task_unavailable_reason(definition: &AgentDefinition) -> Option<String> {
    task_unavailable_reason_for(definition, std::env::consts::OS)
}

pub(super) fn task_unavailable_reason_for(
    definition: &AgentDefinition,
    os: &str,
) -> Option<String> {
    if os == "windows" {
        return Some("Isolated CLI agent tasks are not available on Windows yet. Use the agent in the assistant instead.".into());
    }
    let codex = definition.id == "codex"
        || definition.distribution.npx.as_ref().is_some_and(|package| {
            package_parts(&package.package, true)
                .is_ok_and(|(name, _)| name == "@agentclientprotocol/codex-acp")
        })
        || definition
            .distribution
            .command
            .as_ref()
            .is_some_and(|command| {
                Path::new(&command.executable)
                    .file_stem()
                    .is_some_and(|stem| stem == "codex-acp")
            });
    if os == "macos" && codex {
        return Some("Codex cannot start its child processes under macOS task isolation. Use Codex in the assistant or choose Oleafly Assistant for this task.".into());
    }
    None
}

pub async fn status(root: &Path, definition: AgentDefinition, probe: bool) -> AgentStatus {
    let resolution = resolve(root, &definition);
    let mut reason = install_reason(&definition);
    if definition.distribution.command.is_some() {
        if let Err(error) = &resolution {
            reason = Some(error.clone());
        }
    }
    let resolved = resolution.ok();
    if probe && resolved.is_some() {
        if let Some(required) = definition
            .distribution
            .npx
            .as_ref()
            .and_then(|v| v.node_major)
        {
            if let Err(error) = check_node(required).await {
                reason = Some(error);
            }
        }
    }
    AgentStatus {
        platform: platform(), installed: resolved.is_some(), executable: resolved.as_ref().map(|v| v.executable.to_string_lossy().into_owned()),
        installed_version: resolved.as_ref().and_then(|v| v.version.clone()), managed: resolved.as_ref().is_some_and(|v| v.managed),
        can_install: install_reason(&definition).is_none(), reason,
        sign_in_hint: match definition.id.as_str() { "claude" => Some("Run claude auth login in your terminal, then reconnect.".into()), "codex" => Some("Run codex login in your terminal, then reconnect.".into()), "gemini" => Some("Run gemini in your terminal and finish sign-in and workspace trust, then reconnect.".into()), _ => Some("Use the agent's CLI sign-in, or choose a sign-in method after connecting.".into()) },
        task_unavailable_reason: task_unavailable_reason(&definition),
        definition,
    }
}

pub async fn check_node(required: u32) -> Result<(), String> {
    let node = discover("node")
        .ok_or_else(|| format!("Install Node.js {required} or newer to run this agent."))?;
    let mut command = tokio::process::Command::new(node);
    command.arg("--version");
    let output = bounded_command(command, Duration::from_secs(5)).await?;
    let major = output
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    if major < required {
        return Err(format!(
            "This agent needs Node.js {required} or newer. The detected version is {major}."
        ));
    }
    Ok(())
}

fn npm_cli() -> Option<PathBuf> {
    if let Some(path) = discover("npm") {
        if path.extension().is_some_and(|v| v == "js") {
            return Some(path);
        }
    }
    let node = discover("node")?;
    let directory = node.parent()?;
    [
        directory.join("node_modules/npm/bin/npm-cli.js"),
        directory.join("../lib/node_modules/npm/bin/npm-cli.js"),
    ]
    .into_iter()
    .find(|v| v.is_file())
}

async fn bounded_command(
    mut command: tokio::process::Command,
    duration: Duration,
) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "The installation command could not be started.")?;
    let guard =
        crate::proc::contain_process_tree(child.id().ok_or("The installer has no process ID.")?)
            .map_err(|_| "The installer process could not be contained.")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("The installer has no output stream.")?;
    let read = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let count = output
                .read(&mut buffer)
                .await
                .map_err(|_| "The installer output could not be read.")?;
            if count == 0 {
                break;
            }
            let remaining = (64 * 1024usize).saturating_sub(bytes.len());
            bytes.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        Ok::<_, String>(String::from_utf8_lossy(&bytes).into_owned())
    });
    let exit = tokio::time::timeout(duration, child.wait()).await;
    drop(guard);
    let success = match exit {
        Ok(Ok(exit)) => exit.success(),
        _ => {
            let _ = child.kill().await;
            read.abort();
            return Err("The installation timed out and was stopped.".into());
        }
    };
    let output = read
        .await
        .map_err(|_| "The installer stopped unexpectedly.")??;
    if !success {
        return Err("The installation failed. Check the package, network connection and runtime requirements.".into());
    }
    Ok(output)
}

async fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| "The download client could not start.")?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "The download failed. Check your connection.")?
        .error_for_status()
        .map_err(|_| "The server refused the download.")?;
    if response.content_length().is_some_and(|v| v > limit as u64) {
        return Err("The download exceeds the size limit.".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "The download was interrupted.")?;
        if bytes.len() + chunk.len() > limit {
            return Err("The download exceeds the size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn extract(bytes: &[u8], zip_format: bool, destination: &Path) -> Result<(), String> {
    let mut total = 0u64;
    let mut files = 0u32;
    let mut write_entry =
        |path: &Path, size: u64, reader: &mut dyn Read, directory: bool| -> Result<(), String> {
            files += 1;
            total = total.checked_add(size).ok_or("The archive is too large.")?;
            if files > 20_000 || total > EXPANDED_LIMIT || !safe_relative(path) {
                return Err(
                    "The archive contains an unsafe path or exceeds the extraction limits.".into(),
                );
            }
            let target = destination.join(path);
            if directory {
                std::fs::create_dir_all(&target)
                    .map_err(|_| "An archive directory could not be created.")?;
                return Ok(());
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|_| "An archive directory could not be created.")?;
            }
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(|_| "The archive contains a duplicate or unreadable file.")?;
            let written = std::io::copy(&mut reader.take(size + 1), &mut file)
                .map_err(|_| "An archive file could not be extracted.")?;
            if written != size {
                return Err("An archive file has an invalid size.".into());
            }
            Ok(())
        };
    if zip_format {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| "The ZIP archive is invalid.")?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| "The ZIP entry is invalid.")?;
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Archive symbolic links are not supported.".into());
            }
            let path = PathBuf::from(entry.name());
            let size = entry.size();
            let directory = entry.is_dir();
            write_entry(&path, size, &mut entry, directory)?;
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive
            .entries()
            .map_err(|_| "The tar archive is invalid.")?
        {
            let mut entry = entry.map_err(|_| "The tar entry is invalid.")?;
            let kind = entry.header().entry_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err("Archive links and special files are not supported.".into());
            }
            let path = entry
                .path()
                .map_err(|_| "The archive path is invalid.")?
                .into_owned();
            let size = entry.size();
            write_entry(&path, size, &mut entry, kind.is_dir())?;
        }
    }
    Ok(())
}

pub async fn install(root: &Path, definition: &AgentDefinition) -> Result<(), String> {
    validate(definition)?;
    if let Some(reason) = install_reason(definition) {
        return Err(reason);
    }
    if read_receipt(root, definition).is_some() {
        return Ok(());
    }
    let parent = root.join("agents").join(&definition.id);
    std::fs::create_dir_all(&parent)
        .map_err(|_| "The agent installation directory could not be created.")?;
    let destination = receipt_dir(root, definition);
    if destination.exists() {
        return Err("An incomplete installation already exists for this version. Remove it before retrying.".into());
    }
    let temporary = parent.join(format!("install-{}", new_id()));
    std::fs::create_dir(&temporary)
        .map_err(|_| "The agent installation directory could not be created.")?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(temporary.clone());
    let (relative, node) = if let Some(package) = &definition.distribution.npx {
        check_node(package.node_major.unwrap_or(20)).await?;
        std::fs::write(temporary.join("package.json"), b"{\"private\":true}")
            .map_err(|_| "The package manifest could not be written.")?;
        let mut command =
            tokio::process::Command::new(discover("node").ok_or("Node.js was not found.")?);
        command
            .arg(npm_cli().ok_or("npm was not found.")?)
            .args([
                "install",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--save-exact",
                "--registry=https://registry.npmjs.org",
                "--prefix",
            ])
            .arg(&temporary)
            .arg(&package.package)
            .current_dir(&temporary);
        command.env("npm_config_userconfig", temporary.join("empty-npmrc"));
        bounded_command(command, Duration::from_secs(300)).await?;
        let (name, _) = package_parts(&package.package, true)?;
        let package_root = temporary.join("node_modules").join(name);
        let manifest: Value = serde_json::from_slice(
            &std::fs::read(package_root.join("package.json"))
                .map_err(|_| "The installed package has no manifest.")?,
        )
        .map_err(|_| "The installed package manifest is invalid.")?;
        let bin = if let Some(bin) = manifest["bin"].as_str() {
            Some(bin)
        } else if let Some(cmd) = &package.cmd {
            manifest["bin"][cmd].as_str()
        } else {
            manifest["bin"]
                .as_object()
                .filter(|v| v.len() == 1)
                .and_then(|v| v.values().next())
                .and_then(Value::as_str)
        }
        .ok_or("The package has several executables. Add its command name to the definition.")?;
        if !safe_relative(Path::new(bin)) {
            return Err("The package executable escapes its directory.".into());
        }
        let executable = package_root
            .join(bin)
            .canonicalize()
            .map_err(|_| "The package executable was not installed.")?;
        let canonical = temporary
            .canonicalize()
            .map_err(|_| "The installation path could not be resolved.")?;
        let relative = executable
            .strip_prefix(&canonical)
            .map_err(|_| "The package executable escapes its installation.")?
            .to_path_buf();
        let mut header = [0u8; 128];
        let n = std::fs::File::open(&executable)
            .and_then(|mut f| f.read(&mut header))
            .map_err(|_| "The package executable could not be read.")?;
        let node = String::from_utf8_lossy(&header[..n])
            .lines()
            .next()
            .is_some_and(|v| v.starts_with("#!") && v.contains("node"))
            || executable
                .extension()
                .is_some_and(|v| v == "js" || v == "mjs" || v == "cjs");
        (relative, node)
    } else if let Some(package) = &definition.distribution.uvx {
        std::fs::create_dir(&destination)
            .map_err(|_| "The Python agent directory could not be created.")?;
        let mut command = tokio::process::Command::new(discover("uv").ok_or("uv was not found.")?);
        command
            .args([
                "tool",
                "install",
                "--no-config",
                "--python-preference",
                "only-system",
                &package.package,
            ])
            .env("UV_TOOL_DIR", destination.join("tools"))
            .env("UV_TOOL_BIN_DIR", destination.join("bin"))
            .current_dir(&destination);
        if let Err(error) = bounded_command(command, Duration::from_secs(300)).await {
            let _ = std::fs::remove_dir_all(&destination);
            return Err(error);
        }
        let cmd = package
            .cmd
            .as_ref()
            .ok_or("Set the Python package's executable name in cmd.")?;
        let filename = if cfg!(windows) {
            format!("{cmd}.exe")
        } else {
            cmd.clone()
        };
        let installed = destination
            .join("bin")
            .join(&filename)
            .canonicalize()
            .map_err(|_| "The Python package executable was not installed.")?;
        let canonical = destination
            .canonicalize()
            .map_err(|_| "The installation path could not be resolved.")?;
        let relative = installed
            .strip_prefix(&canonical)
            .map_err(|_| "The Python executable escapes its installation.")?
            .to_path_buf();
        return write_receipt(&destination, &definition.version, relative, false);
    } else {
        let binary = definition
            .distribution
            .binary
            .get(&platform())
            .ok_or("This platform has no binary distribution.")?;
        let bytes = download(&binary.archive, DOWNLOAD_LIMIT).await?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if binary
            .sha256
            .as_ref()
            .map_or(true, |expected| !expected.eq_ignore_ascii_case(&digest))
        {
            return Err("The binary checksum does not match. The download was discarded.".into());
        }
        extract(&bytes, binary.archive.ends_with(".zip"), &temporary)?;
        let relative = PathBuf::from(&binary.cmd);
        if !temporary.join(&relative).is_file() {
            return Err("The archive does not contain the declared executable.".into());
        }
        (relative, false)
    };
    #[cfg(unix)]
    if !node {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            temporary.join(&relative),
            std::fs::Permissions::from_mode(0o700),
        )
        .map_err(|_| "The agent executable permissions could not be set.")?;
    }
    std::fs::rename(&temporary, &destination)
        .map_err(|_| "The agent installation could not be finalized.")?;
    write_receipt(&destination, &definition.version, relative, node)
}

fn write_receipt(
    destination: &Path,
    version: &str,
    relative: PathBuf,
    node: bool,
) -> Result<(), String> {
    let receipt = InstallReceipt {
        version: version.into(),
        executable: destination.join(relative),
        node,
    };
    let bytes =
        serde_json::to_vec(&receipt).map_err(|_| "The install receipt could not be encoded.")?;
    std::fs::write(destination.join("receipt.json"), bytes)
        .map_err(|_| "The install receipt could not be saved.".into())
}

pub async fn registry_search(query: &str) -> Result<Vec<RegistryEntry>, String> {
    if query.len() > 200 {
        return Err("The registry search is too long.".into());
    }
    let bytes = download(REGISTRY, 4 * 1024 * 1024).await?;
    let payload: Value =
        serde_json::from_slice(&bytes).map_err(|_| "The ACP registry returned invalid JSON.")?;
    let agents = payload["agents"]
        .as_array()
        .ok_or("The ACP registry has no agent list.")?;
    let query = query.to_lowercase();
    Ok(agents.iter().filter(|agent| format!("{} {} {}", agent["id"], agent["name"], agent["description"]).to_lowercase().contains(&query)).take(1000).map(|agent| {
        let id = agent["id"].as_str().unwrap_or_default().to_owned();
        let name = agent["name"].as_str().unwrap_or_default().to_owned();
        let description = agent["description"].as_str().unwrap_or_default().chars().take(4000).collect::<String>();
        let version = agent["version"].as_str().unwrap_or_default().to_owned();
        let definition: Result<AgentDefinition, String> = serde_json::from_value(json!({"id":id,"name":name,"description":description,"version":version,"distribution":agent["distribution"]})).map_err(|_| "This registry distribution uses fields Oleafly does not support.".into()).and_then(|definition| { validate(&definition)?; Ok(definition) });
        match definition {
            Ok(definition) => { let reason = install_reason(&definition); RegistryEntry { id, name, description, version, definition: Some(definition), reason } },
            Err(reason) => RegistryEntry { id, name, description, version, definition: None, reason: Some(reason) },
        }
    }).collect())
}
