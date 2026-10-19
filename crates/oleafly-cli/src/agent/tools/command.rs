//! `run_command`: a shell command in the run's folder. Where Oleafly's
//! sandbox works (macOS, Linux with bubblewrap, Windows once it is set up)
//! the command can write only to the run's folder and reach the network
//! only with `--allow network`. Elsewhere it runs as the user, with a
//! warning, and never in a read-only run.
//!
//! Children never inherit provider keys.
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};

use super::{schema, ToolContext, ToolSpec};
use crate::agent::policy::{Allow, WriteMode};
use crate::app_paths::Platform;

/// The longest a command may run.
const MAX_TIMEOUT_SECONDS: u64 = 600;
const DEFAULT_TIMEOUT_SECONDS: u64 = 120;
/// Output kept from stdout and stderr together.
pub(crate) const MAX_COMMAND_OUTPUT: usize = 48 * 1024;
const MAX_COMMAND_TEXT: usize = 16 * 1024;
const UNSANDBOXED: &str = "Commands run without a sandbox on this system.";

/// How a shell line is started on a platform.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ShellInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Windows: the command line passed as is (`CommandExt::raw_arg`), so
    /// `cmd.exe` sees exactly what was asked.
    pub raw_tail: Option<String>,
}

/// `cmd.exe /d /s /c "<command>"` on Windows, `/bin/sh -c <command>` elsewhere.
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

/// Runs `text` for at most `timeout_seconds`.
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
    let sandboxed = matches!(
        oleafly_sandbox::availability(),
        oleafly_sandbox::Availability::Available
    );
    let command = if sandboxed {
        let line = text.to_string();
        let home = temp.path().to_path_buf();
        // Spec building looks up runtimes and may grant folder access on
        // Windows, so it stays off the async threads.
        let inputs = SandboxInputs::from(ctx);
        tokio::task::spawn_blocking(move || inputs.command(&line, &home))
            .await
            .map_err(|_| "The command could not be prepared.".to_string())??
    } else {
        if matches!(ctx.policy.mode, WriteMode::ReadOnly) {
            return Err("Commands need Oleafly's sandbox to run in a read-only run, and it isn't available here. Run again with --allow write.".into());
        }
        ctx.warn_once(&ctx.warned_unsandboxed, "agent.unsandboxed", UNSANDBOXED);
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
    // Ends the whole process group (or job), children included.
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

/// What the sandboxed command needs, owned, for a blocking thread.
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
            network: self.network,
            home: home.to_path_buf(),
            owner: format!("agent:{}", self.run_id),
            ..oleafly_sandbox::SandboxSpec::default()
        };
        oleafly_sandbox::shell_command(&spec, text).map_err(String::from)
    }
}

/// The tool call.
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
