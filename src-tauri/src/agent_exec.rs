use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;

const EXEC_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_OUTPUT_BYTES: usize = 200 * 1024;

#[derive(Serialize)]
pub struct ExecResult {
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub status: String,
    pub truncated: bool,
}

fn status_line(exit_code: Option<i32>, timed_out: bool) -> String {
    if timed_out {
        return "Stopped: timed out".to_string();
    }
    match exit_code {
        Some(0) => "Success".to_string(),
        Some(code) => format!("Failed with exit code {code}"),
        None => "Stopped".to_string(),
    }
}

#[tauri::command]
pub async fn agent_exec(project_id: String, command: String) -> Result<ExecResult, String> {
    let cwd = crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    execute_command(&root, &project_id, &cwd, command).await
}

async fn execute_command(
    root: &Path,
    project_id: &str,
    cwd: &Path,
    command: String,
) -> Result<ExecResult, String> {
    if command.trim().is_empty() {
        return Err("the command was empty".to_string());
    }
    if crate::approvals::decision_for(root, project_id, "run_command")
        == Some(crate::approvals::ToolDecision::Deny)
    {
        return Err("run_command is denied for this project".to_string());
    }

    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut c = tokio::process::Command::new(shell);
        c.arg("-lc").arg(&command);
        c
    };
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start command: {e}"))?;

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let read_streams = async {
        let read_stdout = async {
            if let Some(out) = stdout.as_mut() {
                let _ = out.read_to_end(&mut stdout_bytes).await;
            }
        };
        let read_stderr = async {
            if let Some(err) = stderr.as_mut() {
                let _ = err.read_to_end(&mut stderr_bytes).await;
            }
        };
        tokio::join!(read_stdout, read_stderr);
    };

    let mut timed_out = false;
    let status = tokio::select! {
        _ = read_streams => child.wait().await.ok(),
        _ = tokio::time::sleep(EXEC_TIMEOUT) => {
            timed_out = true;
            let _ = child.start_kill();
            child.wait().await.ok()
        }
    };

    let exit_code = status.and_then(|s| s.code());
    let mut combined = stdout_bytes;
    combined.extend(stderr_bytes);
    let truncated = combined.len() > MAX_OUTPUT_BYTES;
    if truncated {
        combined.truncate(MAX_OUTPUT_BYTES);
    }
    let mut output = String::from_utf8_lossy(&combined).to_string();
    if truncated {
        output.push_str("\n… output truncated");
    }

    Ok(ExecResult {
        command,
        output,
        exit_code,
        status: status_line(exit_code, timed_out),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("oleafly-agent-exec-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("projects/proj")).unwrap();
        root
    }

    #[test]
    fn status_line_matches_reference_labels() {
        assert_eq!(status_line(Some(0), false), "Success");
        assert_eq!(status_line(Some(2), false), "Failed with exit code 2");
        assert_eq!(status_line(None, false), "Stopped");
        assert_eq!(status_line(Some(0), true), "Stopped: timed out");
    }

    #[tokio::test]
    async fn rejects_empty_commands() {
        // A project id that fails validation also errors, so use a clearly
        // empty command against a syntactically valid id shape.
        let result = agent_exec("proj".to_string(), "   ".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn persisted_deny_prevents_command_execution() {
        let root = test_root("deny");
        crate::approvals::set_decision(
            &root,
            "proj",
            "run_command",
            Some(crate::approvals::ToolDecision::Deny),
        )
        .unwrap();
        let cwd = root.join("projects/proj");

        let result = execute_command(&root, "proj", &cwd, "touch denied-marker".into()).await;
        let marker_exists = root.join("projects/proj/denied-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command is denied for this project")
        );
        assert!(!marker_exists);
    }

    #[cfg(not(windows))]
    #[tokio::test(flavor = "current_thread")]
    async fn stderr_flood_does_not_block_stdout_collection() {
        let root = test_root("stderr-flood");
        let cwd = root.join("projects/proj");
        let command = "(sleep 4; kill -TERM $$) </dev/null >/dev/null 2>&1 & watchdog=$!; dd if=/dev/zero bs=1024 count=128 1>&2 2>/dev/null; printf stdout-done; kill \"$watchdog\" 2>/dev/null; wait \"$watchdog\" 2>/dev/null || true";

        let result = tokio::time::timeout(
            Duration::from_secs(2),
            execute_command(&root, "proj", &cwd, command.into()),
        )
        .await;

        std::fs::remove_dir_all(&root).ok();
        let exec = result
            .expect("stderr flood blocked command completion")
            .unwrap();
        assert!(exec.output.contains("stdout-done"));
        assert!(!exec.truncated);
    }
}
