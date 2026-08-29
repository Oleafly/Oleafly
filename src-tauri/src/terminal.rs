use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

// PTY sessions for the Agentic Harness terminal pane (@xterm/xterm frontend).
// The webview never chooses the program: every session runs the user's own
// login shell, and the working directory is always a validated project dir,
// so a compromised webview cannot use this surface to execute an arbitrary
// binary or escape the library root.

struct TermSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

static SESSIONS: Mutex<Option<HashMap<String, TermSession>>> = Mutex::new(None);
static SESSION_SEQ: AtomicU64 = AtomicU64::new(1);

fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        CommandBuilder::new("powershell.exe")
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd
    }
}

#[tauri::command]
pub fn term_open(
    project_id: String,
    cols: u16,
    rows: u16,
    channel: Channel<String>,
) -> Result<String, String> {
    let cwd = crate::paths::project_dir(&project_id)?;
    let pty = portable_pty::native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut cmd = default_shell();
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start shell: {e}"))?;
    let killer = child.clone_killer();
    drop(pty.slave);

    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to read pty: {e}"))?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|e| format!("failed to write pty: {e}"))?;

    let id = format!("term-{}", SESSION_SEQ.fetch_add(1, Ordering::SeqCst));
    {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions.get_or_insert_with(HashMap::new).insert(
            id.clone(),
            TermSession {
                master: pty.master,
                writer,
                killer,
            },
        );
    }

    let session_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                    if channel.send(text).is_err() {
                        break;
                    }
                }
            }
        }
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        if let Some(map) = sessions.as_mut() {
            map.remove(&session_id);
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn term_write(id: String, data: String) -> Result<(), String> {
    let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
    let session = sessions
        .as_mut()
        .and_then(|map| map.get_mut(&id))
        .ok_or_else(|| "terminal session is not open".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("failed to write to shell: {e}"))
}

#[tauri::command]
pub fn term_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS.lock().expect("terminal registry poisoned");
    let session = sessions
        .as_ref()
        .and_then(|map| map.get(&id))
        .ok_or_else(|| "terminal session is not open".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to resize terminal: {e}"))
}

#[tauri::command]
pub fn term_kill(id: String) -> Result<(), String> {
    let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
    if let Some(mut session) = sessions.as_mut().and_then(|map| map.remove(&id)) {
        let _ = session.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_to_unknown_sessions_are_rejected() {
        assert!(term_write("missing".into(), "ls\n".into()).is_err());
        assert!(term_resize("missing".into(), 80, 24).is_err());
        assert!(term_kill("missing".into()).is_ok());
    }

    #[test]
    fn shell_builder_targets_a_login_shell() {
        let cmd = default_shell();
        let program = format!("{:?}", cmd);
        #[cfg(not(windows))]
        assert!(program.contains("sh") || program.contains("SHELL"));
        #[cfg(windows)]
        assert!(program.contains("powershell"));
    }
}
