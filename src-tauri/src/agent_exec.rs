use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;

// Shell-exec surface for the agentic harness: runs one command in a validated
// project directory and returns the command, combined output, exit code, and a
// reference-style status (Success / Failed with exit code N / Stopped). This
// is the exec item behind the harness command cards. It is a shell-risk tool:
// the frontend confirms the command and cwd before calling, and the command
// runs with the project dir as its working directory so it cannot roam the
// library root by relative path alone.

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
    if command.trim().is_empty() {
        return Err("the command was empty".to_string());
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
    cmd.current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start command: {e}"))?;

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut combined = Vec::new();
    let read_streams = async {
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_end(&mut combined).await;
        }
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_end(&mut combined).await;
        }
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
}
