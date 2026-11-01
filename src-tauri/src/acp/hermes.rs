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
const DEFAULT_PROFILE: &str = "default";
const MAX_PROFILE: usize = 64;
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
    pub gateway: String,
    pub reason: Option<String>,
    pub memory: bool,
    pub tool_gateway: bool,
}

#[derive(Clone, Debug)]
pub struct HermesProgram {
    pub program: PathBuf,
    pub prefix_args: Vec<String>,
}

impl HermesProgram {
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
    let mut limited = reader.take(MAX_OUTPUT as u64);
    let _ = limited.read_to_end(&mut buffer).await;
    let _ = tokio::io::copy(&mut limited.into_inner(), &mut tokio::io::sink()).await;
    String::from_utf8_lossy(&buffer).into_owned()
}

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

pub async fn create_project_profile(
    hermes: &HermesProgram,
    project_id: &str,
    project_name: &str,
) -> Result<(String, bool), String> {
    let name = project_profile_name(project_id);
    if profile_exists(hermes, &name).await {
        return Ok((name, false));
    }
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
    set_memory(hermes, &name, false).await?;
    let shown = checked(hermes, None, &["profile", "show", &name]).await?;
    let home = crate::paths::home_dir()?;
    if let Some(folder) = profile_path_from_show(&shown.stdout, &home)
        .filter(|folder| folder.file_name().is_some_and(|file| file == name.as_str()))
    {
        for file in ["MEMORY.md", "USER.md"] {
            let _ = tokio::fs::remove_file(folder.join("memories").join(file)).await;
        }
    }
    Ok((name, true))
}

pub fn active_profile(project_id: &str, settings: &HermesSettings) -> Option<String> {
    match settings.mode {
        HermesMode::Project => Some(project_profile_name(project_id)),
        HermesMode::Default | HermesMode::Remote => None,
    }
}

pub fn profile_tag(project_id: &str, settings: &HermesSettings) -> Option<String> {
    match settings.mode {
        HermesMode::Remote => None,
        HermesMode::Default | HermesMode::Project => {
            Some(active_profile(project_id, settings).unwrap_or_else(|| DEFAULT_PROFILE.to_owned()))
        }
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
            (gateway, reason) = gateway_state(&output);
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

fn gateway_state(output: &HermesOutput) -> (String, Option<String>) {
    if output.code == Some(2) && output.stderr.contains("invalid choice: 'ensure'") {
        return ("outdated".into(), None);
    }
    let parsed: Option<Value> = serde_json::from_str(output.stdout.trim()).ok();
    let state = parsed
        .as_ref()
        .and_then(|value| value["state"].as_str())
        .filter(|state| matches!(*state, "ready" | "starting" | "stopped" | "unknown"));
    let gateway: String = match (output.code, state) {
        (Some(0), _) => "ready".into(),
        (_, Some(state)) => state.into(),
        _ => "stopped".into(),
    };
    let reason = if gateway == "ready" {
        None
    } else {
        parsed
            .as_ref()
            .and_then(|value| value["reason_code"].as_str().or(value["reason"].as_str()))
            .map(|text| text.chars().take(120).collect())
    };
    (gateway, reason)
}

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

async fn settings_to_save(
    hermes: Option<&HermesProgram>,
    project_id: &str,
    project_name: &str,
    stored: &HermesSettings,
    mut settings: HermesSettings,
) -> Result<HermesSettings, String> {
    settings.profile = None;
    if let Some(remote) = &settings.remote {
        super::remote::validate(remote)?;
    }
    if settings.mode == HermesMode::Remote && settings.remote.is_none() {
        return Err("Enter the SSH host and remote folder first.".into());
    }
    settings.memory = stored.memory;
    settings.tool_gateway = stored.tool_gateway;
    if let (HermesMode::Project, Some(hermes)) = (settings.mode, hermes) {
        let (name, created) = create_project_profile(hermes, project_id, project_name).await?;
        if created {
            settings.memory = false;
        }
        settings.profile = Some(name);
    }
    Ok(settings)
}

impl super::runtime::AcpRuntime {
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

    pub async fn set_hermes_project_settings(
        &self,
        project_id: &str,
        project_name: &str,
        settings: HermesSettings,
    ) -> Result<HermesStatus, String> {
        let stored = self.hermes_project_settings(project_id)?;
        let hermes = if settings.mode == HermesMode::Project {
            Some(self.hermes_program().await?)
        } else {
            None
        };
        let settings =
            settings_to_save(hermes.as_ref(), project_id, project_name, &stored, settings).await?;
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

    struct FakeHermes {
        state: tempfile::TempDir,
        program: HermesProgram,
    }

    impl FakeHermes {
        fn new() -> Self {
            const SCRIPT: &str = r#"
import os, sys
state, args = sys.argv[1], sys.argv[2:]
profile = None
if args[:1] == ["-p"]:
    profile, args = args[1], args[2:]
with open(os.path.join(state, "calls.log"), "a") as log:
    log.write(" ".join((["-p", profile] if profile else []) + args) + "\n")
folder = lambda name: os.path.join(state, "profiles", name)
if args[:2] == ["profile", "show"]:
    if not os.path.isdir(folder(args[2])):
        sys.exit(1)
    print("Path: " + folder(args[2]))
elif args[:2] == ["profile", "create"]:
    os.makedirs(os.path.join(folder(args[2]), "memories"))
    for name in ("MEMORY.md", "USER.md"):
        with open(os.path.join(folder(args[2]), "memories", name), "w") as file:
            file.write("cloned from the default profile")
elif args[:2] == ["config", "set"]:
    pass
elif args[:2] == ["gateway", "ensure"]:
    sys.stderr.write("usage: hermes gateway [-h] [--accept-hooks]\n                      {run,start,stop,restart,status,install,uninstall,list,setup,migrate-legacy,enroll}\n                      ...\nhermes gateway: error: argument gateway_command: invalid choice: 'ensure' (choose from 'run', 'start', 'stop', 'restart', 'status', 'install', 'uninstall', 'list', 'setup', 'migrate-legacy', 'enroll')\n")
    sys.exit(2)
else:
    sys.exit(2)
"#;
            let state = tempfile::Builder::new()
                .prefix("oleafly-hermes-fixture-")
                .tempdir()
                .unwrap();
            let script = state.path().join("hermes.py");
            std::fs::write(&script, SCRIPT).unwrap();
            let program = HermesProgram {
                program: crate::acp::tests::fixture_python(),
                prefix_args: vec![
                    "-u".into(),
                    script.to_string_lossy().into_owned(),
                    state.path().to_string_lossy().into_owned(),
                ],
            };
            Self { state, program }
        }

        fn memory_file(&self, project_id: &str, name: &str) -> PathBuf {
            self.state
                .path()
                .join("profiles")
                .join(project_profile_name(project_id))
                .join("memories")
                .join(name)
        }

        fn calls(&self) -> Vec<String> {
            std::fs::read_to_string(self.state.path().join("calls.log"))
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect()
        }
    }

    fn project_mode() -> HermesSettings {
        HermesSettings {
            mode: HermesMode::Project,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn a_new_project_profile_starts_without_the_cloned_memories() {
        let fake = FakeHermes::new();
        let (name, created) = create_project_profile(&fake.program, "thesis", "Thesis")
            .await
            .unwrap();
        assert_eq!((name.as_str(), created), ("oleafly-thesis", true));
        assert!(!fake.memory_file("thesis", "MEMORY.md").exists());
        assert!(!fake.memory_file("thesis", "USER.md").exists());
        assert!(fake
            .calls()
            .contains(&"-p oleafly-thesis config set memory.memory_enabled false".to_string()));
    }

    #[tokio::test]
    async fn choosing_project_mode_again_keeps_the_profiles_memory() {
        let fake = FakeHermes::new();
        create_project_profile(&fake.program, "thesis", "Thesis")
            .await
            .unwrap();
        std::fs::write(
            fake.memory_file("thesis", "MEMORY.md"),
            "learned over weeks",
        )
        .unwrap();
        std::fs::write(
            fake.memory_file("thesis", "USER.md"),
            "prefers British spelling",
        )
        .unwrap();
        let calls = fake.calls().len();
        let stored = HermesSettings {
            memory: true,
            ..project_mode()
        };

        let (_, created) = create_project_profile(&fake.program, "thesis", "Thesis")
            .await
            .unwrap();
        assert!(!created);
        let saved = settings_to_save(
            Some(&fake.program),
            "thesis",
            "Thesis",
            &stored,
            project_mode(),
        )
        .await
        .unwrap();

        assert!(saved.memory, "the stored memory setting is kept");
        assert_eq!(saved.profile.as_deref(), Some("oleafly-thesis"));
        assert_eq!(
            std::fs::read_to_string(fake.memory_file("thesis", "MEMORY.md")).unwrap(),
            "learned over weeks"
        );
        assert_eq!(
            std::fs::read_to_string(fake.memory_file("thesis", "USER.md")).unwrap(),
            "prefers British spelling"
        );
        let later = fake.calls().split_off(calls);
        assert!(
            later.iter().all(|call| !call.contains("config set")),
            "no setting changed: {later:?}"
        );
    }

    #[tokio::test]
    async fn saving_project_mode_for_a_new_profile_turns_memory_off() {
        let fake = FakeHermes::new();
        let stored = HermesSettings {
            memory: true,
            ..Default::default()
        };
        let saved = settings_to_save(
            Some(&fake.program),
            "thesis",
            "Thesis",
            &stored,
            project_mode(),
        )
        .await
        .unwrap();
        assert!(!saved.memory);
        assert_eq!(saved.profile.as_deref(), Some("oleafly-thesis"));
    }

    #[tokio::test]
    async fn leaving_project_mode_keeps_the_stored_memory_flags() {
        let stored = HermesSettings {
            memory: true,
            tool_gateway: true,
            ..project_mode()
        };
        let saved = settings_to_save(
            None,
            "thesis",
            "Thesis",
            &stored,
            HermesSettings {
                mode: HermesMode::Default,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(saved.memory && saved.tool_gateway);
        assert_eq!(saved.profile, None);
    }

    fn answer(code: i32, stdout: &str, stderr: &str) -> HermesOutput {
        HermesOutput {
            code: Some(code),
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }

    #[test]
    fn gateway_states_follow_what_hermes_answered() {
        assert_eq!(
            gateway_state(&answer(0, r#"{"state":"ready"}"#, "")),
            ("ready".to_string(), None)
        );
        assert_eq!(
            gateway_state(&answer(
                1,
                r#"{"state":"stopped","reason_code":"port_in_use"}"#,
                ""
            )),
            ("stopped".to_string(), Some("port_in_use".to_string()))
        );
        assert_eq!(
            gateway_state(&answer(
                2,
                "",
                "hermes gateway: error: argument gateway_command: invalid choice: 'ensure' (choose from 'run', 'start')"
            )),
            ("outdated".to_string(), None)
        );
        assert_eq!(
            gateway_state(&answer(2, "", "hermes: error: something else")),
            ("stopped".to_string(), None)
        );
    }

    #[tokio::test]
    async fn a_hermes_without_gateway_ensure_asks_for_an_update_instead_of_a_stopped_gateway() {
        let fake = FakeHermes::new();
        let shown = status(&fake.program, "thesis", &HermesSettings::default()).await;
        assert_eq!(shown.gateway, "outdated");
        assert_eq!(shown.reason, None);
        assert!(fake
            .calls()
            .contains(&"gateway ensure --json --timeout 10".to_string()));
    }

    #[tokio::test]
    async fn output_past_the_cap_is_read_to_the_end() {
        use tokio::io::AsyncWriteExt as _;
        let (mut writer, reader) = tokio::io::duplex(1024);
        let writing = tokio::spawn(async move {
            let result = writer.write_all(&vec![b'x'; 3 * MAX_OUTPUT]).await;
            drop(writer);
            result
        });
        let text = read_limited(Some(reader)).await;
        assert_eq!(text.len(), MAX_OUTPUT);
        writing.await.unwrap().unwrap();
    }

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
        // A home folder as each platform has one: on Windows "/home/a" has
        // no drive, so it isn't absolute and the parser rightly refuses it.
        #[cfg(windows)]
        let home = Path::new(r"C:\Users\a");
        #[cfg(not(windows))]
        let home = Path::new("/home/a");
        assert_eq!(
            profile_path_from_show("Name: work\nPath:    ~/.hermes/profiles/work\n", home),
            Some(home.join(".hermes").join("profiles").join("work"))
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
