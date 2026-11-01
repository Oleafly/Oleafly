use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};

use super::{schema, ToolContext, ToolSpec};
use crate::agent::policy::{Allow, WriteMode};
use crate::agent::workspace::protected_folders;
use crate::app_paths::Platform;

const MAX_TIMEOUT_SECONDS: u64 = 600;
const DEFAULT_TIMEOUT_SECONDS: u64 = 120;
pub(crate) const MAX_COMMAND_OUTPUT: usize = 48 * 1024;
const MAX_COMMAND_TEXT: usize = 16 * 1024;
const UNSANDBOXED: &str = "Commands run without a sandbox on this system.";

fn sandbox_owner(run_id: &str) -> String {
    format!("agent:{run_id}")
}

pub(crate) struct OwnerRelease {
    owner: String,
}

impl OwnerRelease {
    pub(crate) fn new(run_id: &str) -> Self {
        Self {
            owner: sandbox_owner(run_id),
        }
    }

    pub(crate) fn owner(&self) -> &str {
        &self.owner
    }

    pub(crate) async fn release_now(mut self, ctx: &crate::contract::Context) {
        let owner = std::mem::take(&mut self.owner);
        if cfg!(windows) && !ctx.json() && !ctx.quiet() {
            ctx.note("Removing the sandbox's access to the project's folders.");
        }
        let _ = tokio::task::spawn_blocking(move || oleafly_sandbox::release(&owner)).await;
    }
}

impl Drop for OwnerRelease {
    fn drop(&mut self) {
        if !self.owner.is_empty() {
            let _ = oleafly_sandbox::release(&self.owner);
        }
    }
}

pub(crate) fn unsandboxed_refusal(mode: &WriteMode, allowed: bool, reason: &str) -> Option<String> {
    match mode {
        WriteMode::ReadOnly => Some(format!("Commands need Oleafly's sandbox to run in a read-only run. {reason} Run again with --allow write.")),
        WriteMode::Review { .. } if !allowed => Some(format!("Commands need Oleafly's sandbox to stay inside the review copy. {reason} Run again with --apply, or with --unsandboxed-commands to let them run as you.")),
        WriteMode::Review { .. } | WriteMode::Apply => None,
    }
}

pub(crate) fn unsandboxed_note(
    mode: &WriteMode,
    allowed: bool,
    reason: &str,
) -> (&'static str, String) {
    match unsandboxed_refusal(mode, allowed, reason) {
        Some(refusal) => ("agent.commands_refused", refusal),
        None => ("agent.unsandboxed", format!("{UNSANDBOXED} {reason}")),
    }
}

pub(crate) fn sandbox_unavailable(data_root: Option<&Path>) -> Option<String> {
    if cfg!(windows)
        && !data_root.is_some_and(oleafly_research::runs::remote::settings::windows_sandbox_enabled)
    {
        return Some(oleafly_research::runs::remote::settings::WINDOWS_SWITCH_MESSAGE.to_string());
    }
    match oleafly_sandbox::availability() {
        oleafly_sandbox::Availability::Available => None,
        oleafly_sandbox::Availability::Unavailable(reason) => Some(reason),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ShellInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Windows: the command line passed as is (`CommandExt::raw_arg`), so
    /// `cmd.exe` sees exactly what was asked.
    pub raw_tail: Option<String>,
}

pub(crate) fn shell_invocation(platform: Platform, command: &str) -> ShellInvocation {
    match platform {
        Platform::Windows => ShellInvocation {
            program: PathBuf::from("cmd.exe"),
            args: vec!["/d".into(), "/s".into(), "/c".into()],
            // With /s, cmd.exe strips the first and last quote and runs the rest.
            raw_tail: Some(format!("\"{command}\"")),
        },
        Platform::MacOs | Platform::Linux => ShellInvocation {
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".into(), command.into()],
            raw_tail: None,
        },
    }
}

/// The inherited environment without any provider key (names compared
/// without case, as Windows does).
pub(crate) fn command_env(
    inherited: impl Iterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    let blocked: Vec<String> = crate::agent::provider::all_key_variables()
        .into_iter()
        .map(str::to_ascii_uppercase)
        .collect();
    inherited
        .filter(|(name, _)| {
            let name = name.to_string_lossy().to_ascii_uppercase();
            !blocked.contains(&name)
        })
        .collect()
}

pub(super) fn specs() -> Vec<ToolSpec> {
    vec![ToolSpec {
        name: "run_command",
        needs: Allow::Commands,
        writes: false,
        schema: schema(
            "run_command",
            "Run a shell command in the project folder and return its output (stdout and stderr, at most 48 KiB). Use it for scripts, tests and tools the other tools don't cover.",
            json!({
                "command": {"type": "string", "minLength": 1, "maxLength": MAX_COMMAND_TEXT},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECONDS, "description": "Stop the command after this long (default 120)."},
            }),
            &["command"],
        ),
    }]
}

async fn read_capped<R: AsyncRead + Unpin>(mut stream: R) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return kept,
            Ok(count) => {
                let room = (MAX_COMMAND_OUTPUT + 1).saturating_sub(kept.len());
                kept.extend_from_slice(&buffer[..count.min(room)]);
            }
        }
    }
}

fn plain_command(ctx: &ToolContext, text: &str, temp: &std::path::Path) -> std::process::Command {
    let shell = shell_invocation(Platform::current(), text);
    let mut command = std::process::Command::new(&shell.program);
    command.args(&shell.args);
    #[cfg(windows)]
    if let Some(tail) = &shell.raw_tail {
        use std::os::windows::process::CommandExt;
        command.raw_arg(tail);
    }
    command.env_clear();
    command.envs(command_env(std::env::vars_os()));
    for name in ["TMP", "TEMP", "TMPDIR"] {
        command.env(name, temp);
    }
    command.current_dir(ctx.workspace.work_root());
    command
}

pub(crate) async fn run_command(
    ctx: &ToolContext,
    text: &str,
    timeout_seconds: u64,
) -> Result<Value, String> {
    if text.trim().is_empty() || text.len() > MAX_COMMAND_TEXT || text.contains('\0') {
        return Err("Give a command of 1 to 16,384 bytes.".into());
    }
    let timeout = Duration::from_secs(timeout_seconds.clamp(1, MAX_TIMEOUT_SECONDS));
    let temp = tempfile::Builder::new()
        .prefix("oleafly-agent-command-")
        .tempdir()
        .map_err(|error| format!("The command's temporary folder could not be made: {error}"))?;
    let data_root = ctx.data_root.clone();
    let unavailable =
        tokio::task::spawn_blocking(move || sandbox_unavailable(data_root.as_deref()))
            .await
            .map_err(|_| "The sandbox could not be checked.".to_string())?;
    let sandboxed = unavailable.is_none();
    let command = if sandboxed {
        let line = text.to_string();
        let home = temp.path().to_path_buf();
        let inputs = SandboxInputs::from(ctx);
        tokio::task::spawn_blocking(move || inputs.command(&line, &home))
            .await
            .map_err(|_| "The command could not be prepared.".to_string())??
    } else {
        let reason = unavailable.unwrap_or_default();
        if let Some(refusal) =
            unsandboxed_refusal(&ctx.policy.mode, ctx.unsandboxed_commands, &reason)
        {
            return Err(refusal);
        }
        ctx.warn_once(
            &ctx.warned_unsandboxed,
            "agent.unsandboxed",
            &format!("{UNSANDBOXED} {reason}"),
        );
        plain_command(ctx, text, temp.path())
    };
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    oleafly_sandbox::process::isolate_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("The command could not start: {error}"))?;
    let pid = child.id().ok_or("The command has no process ID.")?;
    let tree = match oleafly_sandbox::process::contain_process_tree(pid) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            return Err(format!("The command could not be contained: {error}"));
        }
    };
    let mut stdout = tokio::spawn(read_capped(
        child
            .stdout
            .take()
            .ok_or("The command's output is unavailable.")?,
    ));
    let mut stderr = tokio::spawn(read_capped(
        child
            .stderr
            .take()
            .ok_or("The command's errors are unavailable.")?,
    ));
    let (status, timed_out, cancelled) = tokio::select! {
        status = child.wait() => (status.ok(), false, false),
        _ = ctx.cancel.cancelled() => (None, false, true),
        _ = tokio::time::sleep(timeout) => (None, true, false),
    };
    drop(tree);
    let _ = child.start_kill();
    let reaped = tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .ok()
        .and_then(Result::ok);
    let read = async { tokio::join!(&mut stdout, &mut stderr) };
    let (mut output, errors) = match tokio::time::timeout(Duration::from_secs(2), read).await {
        Ok((stdout, stderr)) => (stdout.unwrap_or_default(), stderr.unwrap_or_default()),
        Err(_) => {
            stdout.abort();
            stderr.abort();
            (Vec::new(), Vec::new())
        }
    };
    output.extend(errors);
    let truncated = output.len() > MAX_COMMAND_OUTPUT;
    output.truncate(MAX_COMMAND_OUTPUT);
    Ok(json!({
        "output": String::from_utf8_lossy(&output),
        "exitCode": status.or(reaped).and_then(|status| status.code()),
        "timedOut": timed_out,
        "cancelled": cancelled,
        "truncated": truncated,
        "sandboxed": sandboxed,
    }))
}

struct SandboxInputs {
    root: PathBuf,
    read_paths: Vec<PathBuf>,
    writable: bool,
    network: bool,
    run_id: String,
}

impl From<&ToolContext> for SandboxInputs {
    fn from(ctx: &ToolContext) -> Self {
        Self {
            root: ctx.workspace.work_root().to_path_buf(),
            read_paths: ctx.read_paths.clone(),
            writable: !matches!(ctx.policy.mode, WriteMode::ReadOnly),
            network: ctx.policy.allow.network,
            run_id: ctx.run_id.clone(),
        }
    }
}

impl SandboxInputs {
    fn command(&self, text: &str, home: &std::path::Path) -> Result<std::process::Command, String> {
        let spec = oleafly_sandbox::SandboxSpec {
            workspace: self.root.clone(),
            read_only: self.read_paths.clone(),
            read_write: if self.writable {
                vec![self.root.clone()]
            } else {
                Vec::new()
            },
            // What the file tools refuse stays read-only for commands too
            // (`.git` hooks and config run outside the sandbox later).
            protected: if self.writable {
                protected_folders(&self.root)
            } else {
                Vec::new()
            },
            deny_read: hidden_files(&self.root),
            network: self.network,
            home: home.to_path_buf(),
            owner: sandbox_owner(&self.run_id),
            ..oleafly_sandbox::SandboxSpec::default()
        };
        oleafly_sandbox::shell_command(&spec, text).map_err(String::from)
    }
}

fn hidden_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut hidden = vec![root.join(".git").join("config"), root.join(".private")];
    if let Ok(entries) = std::fs::read_dir(root) {
        hidden.extend(
            entries
                .flatten()
                .filter(|entry| {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    name == ".env" || name.starts_with(".env.")
                })
                .map(|entry| entry.path()),
        );
    }
    hidden
}

pub(super) async fn call(ctx: &Arc<ToolContext>, arguments: Value) -> Result<Value, String> {
    let text = arguments["command"]
        .as_str()
        .ok_or("Give the command as text.")?;
    let timeout = arguments["timeout_seconds"]
        .as_u64()
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    run_command(ctx, text, timeout).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::test_support::{context, policy};
    use super::*;
    use crate::agent::policy::AllowSet;

    #[test]
    fn windows_commands_reach_cmd_verbatim() {
        let windows = shell_invocation(Platform::Windows, r#"echo "a b" & dir"#);
        assert_eq!(
            (windows.program, windows.args),
            (
                PathBuf::from("cmd.exe"),
                vec!["/d".to_string(), "/s".into(), "/c".into()]
            )
        );
        assert_eq!(windows.raw_tail.as_deref(), Some(r#""echo "a b" & dir""#));
        let linux = shell_invocation(Platform::Linux, "echo hi");
        assert_eq!(
            (linux.program, linux.args, linux.raw_tail),
            (
                PathBuf::from("/bin/sh"),
                vec!["-c".to_string(), "echo hi".into()],
                None
            )
        );
        let mac = shell_invocation(Platform::MacOs, "ls 'Zoë Müller'");
        assert_eq!(mac.args[1], "ls 'Zoë Müller'");
    }

    #[test]
    fn commands_cannot_read_the_git_config_private_folder_or_env_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for name in [".env", ".env.local", ".envrc", "main.tex"] {
            std::fs::write(root.join(name), "x").unwrap();
        }
        let mut hidden = hidden_files(root);
        hidden.sort();
        let mut expected = vec![
            root.join(".env"),
            root.join(".env.local"),
            root.join(".git").join("config"),
            root.join(".private"),
        ];
        expected.sort();
        assert_eq!(hidden, expected);
    }

    #[test]
    fn command_children_never_see_provider_keys() {
        assert_eq!(
            command_env(
                [
                    ("OPENAI_API_KEY".into(), "sk".into()),
                    ("OLEAFLY_API_KEY".into(), "k".into()),
                    ("PATH".into(), "/bin".into())
                ]
                .into_iter()
            ),
            [(OsString::from("PATH"), OsString::from("/bin"))]
        );
        // Windows spells variables in any case.
        assert!(command_env([("anthropic_api_key".into(), "sk".into())].into_iter()).is_empty());
        assert!(command_env([("Gemini_Api_Key".into(), "sk".into())].into_iter()).is_empty());
    }

    fn commands_policy() -> crate::agent::policy::RunPolicy {
        policy(
            WriteMode::Apply,
            AllowSet {
                write: true,
                commands: true,
                ..AllowSet::default()
            },
            false,
        )
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_that_runs_too_long_is_killed_with_its_children() {
        let project = tempfile::tempdir().unwrap();
        let ctx = context(project.path(), commands_policy());
        let started = std::time::Instant::now();
        let value = run_command(&ctx, "sleep 30 & sleep 30", 1).await.unwrap();
        assert_eq!(value["timedOut"], true);
        assert!(started.elapsed() < Duration::from_secs(6));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_output_is_capped_at_48_kib() {
        let project = tempfile::tempdir().unwrap();
        let ctx = context(project.path(), commands_policy());
        let value = run_command(&ctx, "head -c 200000 /dev/zero | tr '\\0' 'a'", 30)
            .await
            .unwrap();
        assert_eq!(value["truncated"], true);
        assert_eq!(value["output"].as_str().unwrap().len(), MAX_COMMAND_OUTPUT);
        assert_eq!(value["exitCode"], 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_cancelled_run_stops_its_command() {
        let project = tempfile::tempdir().unwrap();
        let ctx = context(project.path(), commands_policy());
        let cancel = ctx.cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancel.cancel();
        });
        let value = run_command(&ctx, "sleep 30", 60).await.unwrap();
        assert_eq!(value["cancelled"], true);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_sandboxed_command_cannot_write_git_hooks_or_oleafly_state() {
        if sandbox_unavailable(None).is_some() {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join(".git/hooks")).unwrap();
        std::fs::create_dir_all(project.path().join(".oleafly")).unwrap();
        std::fs::write(project.path().join(".git/config"), "[core]\n").unwrap();
        let ctx = context(project.path(), commands_policy());
        let value = run_command(&ctx, "echo ok > fine.txt", 30).await.unwrap();
        if value["exitCode"] != 0 || !project.path().join("fine.txt").is_file() {
            return;
        }
        let value = run_command(
            &ctx,
            "echo '#!/bin/sh' > .git/hooks/pre-commit; echo '[core]' > .git/config; echo x > .oleafly/state; echo y > .git/new",
            30,
        )
        .await
        .unwrap();
        assert_eq!(value["sandboxed"], true);
        assert!(!project.path().join(".git/hooks/pre-commit").exists());
        assert!(!project.path().join(".git/new").exists());
        assert!(!project.path().join(".oleafly/state").exists());
        assert_eq!(
            std::fs::read_to_string(project.path().join(".git/config")).unwrap(),
            "[core]\n"
        );
    }

    #[test]
    fn unsandboxed_commands_run_only_with_apply_or_the_flag() {
        let review = WriteMode::Review {
            dir: PathBuf::from("review"),
        };
        let refusal = unsandboxed_refusal(&review, false, "No sandbox.").unwrap();
        assert!(refusal.contains("--unsandboxed-commands") && refusal.contains("No sandbox."));
        assert_eq!(unsandboxed_refusal(&review, true, "No sandbox."), None);
        assert_eq!(unsandboxed_refusal(&WriteMode::Apply, false, "x"), None);
        assert!(unsandboxed_refusal(&WriteMode::ReadOnly, true, "x").is_some());
        assert_eq!(
            unsandboxed_note(&review, false, "x").0,
            "agent.commands_refused"
        );
        assert_eq!(
            unsandboxed_note(&WriteMode::Apply, false, "x").0,
            "agent.unsandboxed"
        );
    }

    #[tokio::test]
    async fn a_review_run_refuses_a_command_the_sandbox_cant_hold() {
        let project = tempfile::tempdir().unwrap();
        let ctx = context(
            project.path(),
            policy(
                WriteMode::Review {
                    dir: project.path().join("review"),
                },
                AllowSet {
                    write: true,
                    commands: true,
                    ..AllowSet::default()
                },
                false,
            ),
        );
        let Some(_) = sandbox_unavailable(None) else {
            return;
        };
        let error = run_command(&ctx, "echo hi > ../outside.txt", 10)
            .await
            .unwrap_err();
        assert!(error.contains("--unsandboxed-commands"), "{error}");
        assert!(!project
            .path()
            .parent()
            .unwrap()
            .join("outside.txt")
            .exists());
    }

    #[test]
    fn dropping_the_release_guard_is_harmless_without_an_owner() {
        let guard = OwnerRelease::new("1792000000000-00ab");
        assert_eq!(guard.owner, "agent:1792000000000-00ab");
        drop(guard);
    }

    #[tokio::test]
    async fn empty_and_oversized_commands_are_refused() {
        let project = tempfile::tempdir().unwrap();
        let ctx = context(project.path(), commands_policy());
        assert!(run_command(&ctx, "  ", 10).await.is_err());
        assert!(run_command(&ctx, &"x".repeat(MAX_COMMAND_TEXT + 1), 10)
            .await
            .is_err());
    }
}
