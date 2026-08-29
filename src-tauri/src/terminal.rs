use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

struct TermSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
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
    open_terminal(&cwd, cols, rows, channel, default_shell())
}

fn open_terminal(
    cwd: &Path,
    cols: u16,
    rows: u16,
    channel: Channel<String>,
    mut cmd: CommandBuilder,
) -> Result<String, String> {
    let pty = portable_pty::native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start shell: {e}"))?;
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
                writer: Arc::new(Mutex::new(writer)),
                child,
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
        let session = {
            let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
            sessions.as_mut().and_then(|map| map.remove(&session_id))
        };
        if let Some(session) = session {
            stop_session(session);
        }
    });

    Ok(id)
}

fn stop_session(mut session: TermSession) {
    let _ = session.child.kill();
    let _ = session.child.wait();
}

#[tauri::command]
pub fn term_write(id: String, data: String) -> Result<(), String> {
    let writer = {
        let sessions = SESSIONS.lock().expect("terminal registry poisoned");
        let session = sessions
            .as_ref()
            .and_then(|map| map.get(&id))
            .ok_or_else(|| "terminal session is not open".to_string())?;
        Arc::clone(&session.writer)
    };
    let result = writer
        .lock()
        .expect("terminal writer poisoned")
        .write_all(data.as_bytes())
        .map_err(|e| format!("failed to write to shell: {e}"));
    result
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
    let session = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions.as_mut().and_then(|map| map.remove(&id))
    };
    if let Some(session) = session {
        stop_session(session);
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

    #[cfg(unix)]
    #[test]
    fn closed_output_channel_kills_the_login_shell() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::{Arc, Barrier};

        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-channel-close-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let shell = root.join("test-shell.sh");
        std::fs::write(
            &shell,
            b"#!/bin/sh\ntrap '' HUP\nprintf '%s\\n' \"$$\" > terminal.pid\nprintf ready\nread ignored\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let channel_entered = Arc::new(Barrier::new(2));
        let close_channel = Arc::new(Barrier::new(2));
        let callback_entered = Arc::clone(&channel_entered);
        let callback_close = Arc::clone(&close_channel);
        let channel = Channel::new(move |_| {
            callback_entered.wait();
            callback_close.wait();
            Err(tauri::Error::AssetNotFound("closed".into()))
        });

        let session_id =
            open_terminal(&project, 80, 24, channel, CommandBuilder::new(&shell)).unwrap();
        channel_entered.wait();
        let pid_path = project.join("terminal.pid");
        let pid = std::fs::read_to_string(&pid_path)
            .unwrap()
            .trim()
            .to_string();
        close_channel.wait();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut stopped = false;
        while std::time::Instant::now() < deadline {
            if !std::process::Command::new("kill")
                .args(["-0", &pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
            {
                stopped = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !stopped {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        let _ = term_kill(session_id);
        std::fs::remove_dir_all(&root).ok();
        assert!(stopped);
    }
}
