//! Hermes Agent per-project profiles: each project can run Hermes in its own
//! profile (separate memory and settings), cloned from the user's default
//! one, or connect to Hermes on another machine over SSH.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;

use super::catalog::Launch;

pub(super) const HERMES_ID: &str = "hermes";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT: usize = 64 * 1024;
const PROFILE_PREFIX: &str = "oleafly-";
const MAX_PROFILE: usize = 64;
/// Settings the Nous tool gateway serves when it is on.
const GATEWAY_KEYS: [&str; 5] = [
    "web.backend",
    "image_gen.provider",
    "tts.provider",
    "stt.provider",
    "browser.cloud_provider",
];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HermesSettings {
    pub mode: HermesMode,
    pub profile: Option<String>,
    pub memory: bool,
    pub tool_gateway: bool,
    pub remote: Option<super::remote::RemoteHermes>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HermesMode {
    #[default]
    Default,
    Project,
    Remote,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesStatus {
    pub mode: HermesMode,
    pub profile: Option<String>,
    pub exists: bool,
    /// ready | starting | stopped | unknown
    pub gateway: String,
    pub reason: Option<String>,
    pub memory: bool,
    pub tool_gateway: bool,
}

/// How to run the `hermes` CLI: the program Oleafly resolved for the agent
/// and the arguments that come before Hermes's own.
#[derive(Clone, Debug)]
pub struct HermesProgram {
    pub program: PathBuf,
    pub prefix_args: Vec<String>,
}

impl HermesProgram {
    /// From the agent's launch, without the definition's own arguments
    /// (`acp`).
    pub fn from_launch(launch: &Launch, definition_args: &[String]) -> Self {
        let args = &launch.args;
        let prefix = if args.len() >= definition_args.len()
            && args[args.len() - definition_args.len()..] == *definition_args
        {
            args[..args.len() - definition_args.len()].to_vec()
        } else {
            args.clone()
        };
        Self {
            program: launch.executable.clone(),
            prefix_args: prefix,
        }
    }
}

/// `hermes [-p profile] args…`, without a shell.
pub fn hermes_command(
    hermes: &HermesProgram,
    profile: Option<&str>,
    args: &[&str],
) -> std::process::Command {
    let mut command = std::process::Command::new(&hermes.program);
    command.args(&hermes.prefix_args);
    if let Some(profile) = profile {
        command.args(["-p", profile]);
    }
    command.args(args);
    command
}

pub fn valid_profile_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_PROFILE
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_' || *b == b'-')
}

/// The profile Oleafly makes for a project: `oleafly-<slug>`, with a short
/// hash of the id when the slug had to change, so two projects never share
/// one.
pub fn project_profile_name(project_id: &str) -> String {
    let slug: String = project_id
        .chars()
        .map(|c| {
            let lower = c.to_ascii_lowercase();
            if lower.is_ascii_lowercase() || lower.is_ascii_digit() || lower == '_' || lower == '-'
            {
                lower
            } else {
                '-'
            }
        })
        .collect();
    let changed = slug != project_id;
    let plain = format!("{PROFILE_PREFIX}{slug}");
    if !changed && plain.len() <= MAX_PROFILE {
        return plain;
    }
    let hash = Sha256::digest(project_id.as_bytes());
    let suffix: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    let room = MAX_PROFILE - PROFILE_PREFIX.len() - 1 - suffix.len();
    let short: String = slug.chars().take(room).collect();
    format!("{PROFILE_PREFIX}{short}-{suffix}")
}

/// The profile folder from `hermes profile show` output (`Path: …`). Only a
/// folder named under `profiles/` is accepted.
pub fn profile_path_from_show(output: &str, home: &Path) -> Option<PathBuf> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| line.to_ascii_lowercase().starts_with("path:"))?;
    let value = line[5..].trim();
    let path = if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        home.join(rest)
    } else {
        PathBuf::from(value)
    };
    let parent = path.parent()?;
    (parent.file_name()? == "profiles" && path.is_absolute()).then_some(path)
}

pub(super) struct HermesOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

async fn read_limited<R: tokio::io::AsyncRead + Unpin>(reader: Option<R>) -> String {
    let Some(reader) = reader else {
        return String::new();
    };
    let mut buffer = Vec::new();
    let _ = reader
        .take(MAX_OUTPUT as u64)
        .read_to_end(&mut buffer)
        .await;
    String::from_utf8_lossy(&buffer).into_owned()
}

/// Runs one Hermes command, without input and with bounded output.
/// `contained` commands are stopped with their process tree on timeout;
/// `gateway ensure` runs uncontained, so a gateway it starts outlives it.
pub(super) async fn run_hermes(
    hermes: &HermesProgram,
    profile: Option<&str>,
    args: &[&str],
    contained: bool,
) -> Result<HermesOutput, String> {
    let mut command = tokio::process::Command::from(hermes_command(hermes, profile, args));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if contained {
        command.kill_on_drop(true);
        crate::proc::isolate_process_tree(&mut command);
    } else {
        #[cfg(unix)]
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Oleafly couldn't start Hermes. Check that it is installed.".to_string())?;
    let guard = if contained {
        child
            .id()
            .and_then(|pid| crate::proc::contain_process_tree(pid).ok())
    } else {
        None
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let run = async {
        let (stdout, stderr, status) =
            tokio::join!(read_limited(stdout), read_limited(stderr), child.wait());
        (stdout, stderr, status)
    };
    let (stdout, stderr, status) = tokio::time::timeout(COMMAND_TIMEOUT, run)
        .await
        .map_err(|_| "Hermes did not answer in time.".to_string())?;
    drop(guard);
    Ok(HermesOutput {
        code: status.ok().and_then(|status| status.code()),
        stdout,
        stderr,
    })
}

fn failure(output: &HermesOutput) -> String {
    let detail = output
        .stderr
        .lines()
        .chain(output.stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .chars()
        .take(300)
        .collect::<String>();
    if detail.is_empty() {
        "Hermes could not complete the change.".into()
    } else {
        format!("Hermes could not complete the change: {detail}")
    }
}

async fn checked(
    hermes: &HermesProgram,
    profile: Option<&str>,
    args: &[&str],
) -> Result<HermesOutput, String> {
    let output = run_hermes(hermes, profile, args, true).await?;
    if output.code == Some(0) {
        Ok(output)
    } else {
        Err(failure(&output))
    }
}

pub async fn profile_exists(hermes: &HermesProgram, profile: &str) -> bool {
    run_hermes(hermes, None, &["profile", "show", profile], true)
        .await
        .is_ok_and(|output| output.code == Some(0))
}

pub async fn set_memory(hermes: &HermesProgram, profile: &str, on: bool) -> Result<(), String> {
    let value = if on { "true" } else { "false" };
    for key in ["memory.memory_enabled", "memory.user_profile_enabled"] {
        checked(hermes, Some(profile), &["config", "set", key, value]).await?;
    }
    Ok(())
}

pub async fn set_tool_gateway(
    hermes: &HermesProgram,
    profile: &str,
    on: bool,
) -> Result<(), String> {
    for key in GATEWAY_KEYS {
        if on {
            checked(hermes, Some(profile), &["config", "set", key, "nous"]).await?;
        } else {
            checked(hermes, Some(profile), &["config", "unset", key]).await?;
        }
    }
    Ok(())
}

/// Creates the project's profile (a clone of the default one, without a
/// shell alias), turns memory off and removes the memories it cloned.
pub async fn create_project_profile(
    hermes: &HermesProgram,
    project_id: &str,
    project_name: &str,
) -> Result<String, String> {
    let name = project_profile_name(project_id);
    if !profile_exists(hermes, &name).await {
        let description = format!(
            "Oleafly project: {}",
            project_name
                .chars()
                .filter(|c| !c.is_control())
                .take(80)
                .collect::<String>()
        );
        checked(
            hermes,
            None,
            &[
                "profile",
                "create",
                &name,
                "--clone",
                "--no-alias",
                "--description",
                &description,
            ],
        )
        .await?;
    }
    set_memory(hermes, &name, false).await?;
    let shown = checked(hermes, None, &["profile", "show", &name]).await?;
    let home = crate::paths::home_dir()?;
    if let Some(folder) = profile_path_from_show(&shown.stdout, &home)
        .filter(|folder| folder.file_name().is_some_and(|file| file == name.as_str()))
    {
        for file in ["MEMORY.md", "USER.md"] {
            let _ = std::fs::remove_file(folder.join("memories").join(file));
        }
    }
    Ok(name)
}

/// The profile a project's sessions run in (`None` = Hermes's default).
pub fn active_profile(project_id: &str, settings: &HermesSettings) -> Option<String> {
    match settings.mode {
        HermesMode::Project => Some(project_profile_name(project_id)),
        HermesMode::Default | HermesMode::Remote => None,
    }
}

pub async fn status(
    hermes: &HermesProgram,
    project_id: &str,
    settings: &HermesSettings,
) -> HermesStatus {
    let profile = active_profile(project_id, settings);
    let exists = match &profile {
        Some(name) => profile_exists(hermes, name).await,
        None => true,
    };
    let mut gateway = "unknown".to_string();
    let mut reason = None;
    if exists {
        if let Ok(output) = run_hermes(
            hermes,
            profile.as_deref(),
            &["gateway", "ensure", "--json", "--timeout", "10"],
            false,
        )
        .await
        {
            let parsed: Option<Value> = serde_json::from_str(output.stdout.trim()).ok();
            let state = parsed
                .as_ref()
                .and_then(|value| value["state"].as_str())
                .filter(|state| matches!(*state, "ready" | "starting" | "stopped" | "unknown"));
            gateway = match (output.code, state) {
                (Some(0), _) => "ready".into(),
                (_, Some(state)) => state.into(),
                _ => "stopped".into(),
            };
            if gateway != "ready" {
                reason = parsed
                    .as_ref()
                    .and_then(|value| value["reason_code"].as_str().or(value["reason"].as_str()))
                    .map(|text| text.chars().take(120).collect());
            }
        }
    }
    let memory = match run_hermes(
        hermes,
        profile.as_deref(),
        &["config", "get", "memory.memory_enabled", "--json"],
        true,
    )
    .await
    {
        Ok(output) if output.code == Some(0) => {
            let text = output.stdout.trim();
            serde_json::from_str::<Value>(text)
                .ok()
                .and_then(|value| value.as_bool().or(value["value"].as_bool()))
                .unwrap_or(text == "true")
        }
        _ => settings.memory,
    };
    HermesStatus {
        mode: settings.mode,
        profile,
        exists,
        gateway,
        reason,
        memory,
        tool_gateway: settings.tool_gateway,
    }
}

/// A project-profile launch: `hermes -p <profile> acp`.
pub fn apply_profile(
    launch: &mut Launch,
    definition_args: &[String],
    project_id: &str,
    settings: &HermesSettings,
) -> Result<(), String> {
    let Some(profile) = active_profile(project_id, settings) else {
        return Ok(());
    };
    if !valid_profile_name(&profile) {
        return Err("The Hermes profile name is not valid.".into());
    }
    let hermes = HermesProgram::from_launch(launch, definition_args);
    let mut args = hermes.prefix_args;
    args.extend(["-p".to_string(), profile]);
    args.extend(definition_args.iter().cloned());
    launch.args = args;
    Ok(())
}

impl super::runtime::AcpRuntime {
    /// The `hermes` CLI as Oleafly would start it.
    async fn hermes_program(&self) -> Result<HermesProgram, String> {
        let definition = self.definition(HERMES_ID)?;
        let program = self.store.agent_program(HERMES_ID)?;
        let root = self.root.clone();
        let planned = definition.clone();
        let launch = super::catalog::blocking(move || {
            super::catalog::plan(&root, &planned, program.as_deref().map(Path::new)).launch
        })
        .await??;
        let definition_args = definition
            .distribution
            .command
            .as_ref()
            .map(|command| command.args.clone())
            .unwrap_or_default();
        Ok(HermesProgram::from_launch(&launch, &definition_args))
    }

    pub fn hermes_project_settings(&self, project_id: &str) -> Result<HermesSettings, String> {
        Ok(self
            .store
            .project_agent_settings(project_id, HERMES_ID)?
            .hermes
            .unwrap_or_default())
    }

    fn save_hermes(&self, project_id: &str, settings: &HermesSettings) -> Result<(), String> {
        let mut stored = self.store.project_agent_settings(project_id, HERMES_ID)?;
        stored.hermes = Some(settings.clone());
        self.store
            .set_project_agent_settings(project_id, HERMES_ID, &stored)
    }

    /// Saves how a project runs Hermes. Project mode creates the project's
    /// profile when it is missing; the profile name is always derived from
    /// the project.
    pub async fn set_hermes_project_settings(
        &self,
        project_id: &str,
        project_name: &str,
        mut settings: HermesSettings,
    ) -> Result<HermesStatus, String> {
        settings.profile = None;
        if let Some(remote) = &settings.remote {
            super::remote::validate(remote)?;
        }
        if settings.mode == HermesMode::Remote && settings.remote.is_none() {
            return Err("Enter the SSH host and remote folder first.".into());
        }
        if settings.mode == HermesMode::Project {
            let hermes = self.hermes_program().await?;
            let name = create_project_profile(&hermes, project_id, project_name).await?;
            settings.memory = false;
            settings.profile = Some(name);
        }
        self.save_hermes(project_id, &settings)?;
        self.hermes_project_status(project_id).await
    }

    pub async fn hermes_project_status(&self, project_id: &str) -> Result<HermesStatus, String> {
        let settings = self.hermes_project_settings(project_id)?;
        if settings.mode == HermesMode::Remote {
            return Ok(HermesStatus {
                mode: settings.mode,
                profile: settings
                    .remote
                    .as_ref()
                    .and_then(|remote| remote.profile.clone()),
                exists: true,
                gateway: "unknown".into(),
                reason: None,
                memory: settings.memory,
                tool_gateway: settings.tool_gateway,
            });
        }
        let hermes = self.hermes_program().await?;
        Ok(status(&hermes, project_id, &settings).await)
    }

    /// Turns memory or the Nous tool gateway on or off for the project's
    /// profile.
    pub async fn hermes_set_option(
        &self,
        project_id: &str,
        option: &str,
        enabled: bool,
    ) -> Result<HermesStatus, String> {
        let mut settings = self.hermes_project_settings(project_id)?;
        let profile = active_profile(project_id, &settings)
            .ok_or("Use a project profile for Hermes first.")?;
        let hermes = self.hermes_program().await?;
        match option {
            "memory" => {
                set_memory(&hermes, &profile, enabled).await?;
                settings.memory = enabled;
            }
            "toolGateway" => {
                set_tool_gateway(&hermes, &profile, enabled).await?;
                settings.tool_gateway = enabled;
            }
            _ => return Err("This Hermes option does not exist.".into()),
        }
        self.save_hermes(project_id, &settings)?;
        Ok(status(&hermes, project_id, &settings).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_profile_names_are_valid_and_distinct() {
        let upper = project_profile_name("Thesis_2024");
        let lower = project_profile_name("thesis_2024");
        assert_ne!(upper, lower);
        assert_eq!(lower, "oleafly-thesis_2024");
        let long = project_profile_name(&"x".repeat(200));
        assert!(long.len() <= 64);
        for name in [upper, lower, long, project_profile_name("../é?")] {
            assert!(valid_profile_name(&name), "{name}");
        }
    }

    #[test]
    fn profile_path_parses_show_output_on_windows_and_unix() {
        let home = Path::new("/home/a");
        assert_eq!(
            profile_path_from_show("Name: work\nPath:    ~/.hermes/profiles/work\n", home),
            Some(PathBuf::from("/home/a/.hermes/profiles/work"))
        );
        assert!(profile_path_from_show("Path: /tmp/elsewhere/work", home).is_none());
        #[cfg(windows)]
        assert_eq!(
            profile_path_from_show(r"Path: C:\Users\x\.hermes\profiles\work", home),
            Some(PathBuf::from(r"C:\Users\x\.hermes\profiles\work"))
        );
    }

    #[test]
    fn hermes_launch_adds_the_profile_flag() {
        let mut launch = Launch {
            executable: PathBuf::from("/usr/local/bin/hermes"),
            args: vec!["acp".into()],
            version: None,
            managed: false,
            batch: false,
            entry: None,
            needs_local_folder: false,
            env: Vec::new(),
        };
        let settings = HermesSettings {
            mode: HermesMode::Project,
            ..Default::default()
        };
        apply_profile(&mut launch, &["acp".into()], "thesis", &settings).unwrap();
        assert_eq!(launch.args, vec!["-p", "oleafly-thesis", "acp"]);
        let command = hermes_command(
            &HermesProgram {
                program: launch.executable.clone(),
                prefix_args: Vec::new(),
            },
            Some("oleafly-thesis"),
            &["gateway", "ensure", "--json", "--timeout", "10"],
        );
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "-p",
                "oleafly-thesis",
                "gateway",
                "ensure",
                "--json",
                "--timeout",
                "10"
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn hermes_commands_keep_a_windows_launcher_path() {
        let program =
            PathBuf::from(r"C:\Users\A B\AppData\Roaming\uv\tools\hermes-agent\Scripts\hermes.exe");
        let command = hermes_command(
            &HermesProgram {
                program: program.clone(),
                prefix_args: Vec::new(),
            },
            Some("oleafly-x"),
            &["gateway", "ensure", "--json", "--timeout", "10"],
        );
        assert_eq!(command.get_program(), program.as_os_str());
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "-p",
                "oleafly-x",
                "gateway",
                "ensure",
                "--json",
                "--timeout",
                "10"
            ]
        );
    }
}
