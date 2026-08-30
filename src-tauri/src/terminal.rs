use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use tauri::ipc::Channel;

struct TermSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _containment: crate::proc::ProcessTreeGuard,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionOwner {
    window_label: String,
    project_id: String,
}

impl SessionOwner {
    fn new(window_label: &str, project_id: &str) -> Self {
        Self {
            window_label: window_label.to_string(),
            project_id: project_id.to_string(),
        }
    }
}

struct OwnedSession<T> {
    owner: SessionOwner,
    session: T,
}

struct SessionRegistry<T> {
    sessions: HashMap<String, OwnedSession<T>>,
}

impl<T> Default for SessionRegistry<T> {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

impl<T> SessionRegistry<T> {
    fn insert(&mut self, owner: SessionOwner, session: T) -> String {
        let mut id = random_session_id();
        while self.sessions.contains_key(&id) {
            id = random_session_id();
        }
        self.sessions
            .insert(id.clone(), OwnedSession { owner, session });
        id
    }

    fn get(&self, id: &str, owner: &SessionOwner) -> Result<&T, String> {
        let record = self
            .sessions
            .get(id)
            .ok_or_else(|| "terminal session is not open".to_string())?;
        if &record.owner != owner {
            return Err("terminal session belongs to another window or project".to_string());
        }
        Ok(&record.session)
    }

    fn remove(&mut self, id: &str, owner: &SessionOwner) -> Result<Option<T>, String> {
        let Some(record) = self.sessions.get(id) else {
            return Ok(None);
        };
        if &record.owner != owner {
            return Err("terminal session belongs to another window or project".to_string());
        }
        Ok(self.sessions.remove(id).map(|record| record.session))
    }

    fn remove_unchecked(&mut self, id: &str) -> Option<T> {
        self.sessions.remove(id).map(|record| record.session)
    }
}

static SESSIONS: Mutex<Option<SessionRegistry<TermSession>>> = Mutex::new(None);

fn random_session_id() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!(
        "term-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

fn command_owner(window_label: &str, project_id: &str) -> Result<SessionOwner, String> {
    crate::paths::validate_project_id(project_id)?;
    if window_label != "main" {
        return Err("terminal is unavailable from this window".to_string());
    }
    Ok(SessionOwner::new(window_label, project_id))
}

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
    window: tauri::WebviewWindow,
    project_id: String,
    cols: u16,
    rows: u16,
    channel: Channel<String>,
) -> Result<String, String> {
    let owner = command_owner(window.label(), &project_id)?;
    let cwd = crate::paths::project_dir(&project_id)?;
    open_terminal(&cwd, owner, cols, rows, channel, default_shell())
}

fn open_terminal(
    cwd: &Path,
    owner: SessionOwner,
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
    let mut child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start shell: {e}"))?;
    let pid = child
        .process_id()
        .ok_or_else(|| "failed to identify shell process".to_string())?;
    let containment = match crate::proc::contain_process_tree(pid) {
        Ok(containment) => containment,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to contain shell process: {error}"));
        }
    };
    drop(pty.slave);

    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to read pty: {e}"))?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|e| format!("failed to write pty: {e}"))?;

    let id = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions
            .get_or_insert_with(SessionRegistry::default)
            .insert(
                owner,
                TermSession {
                    master: pty.master,
                    writer: Arc::new(Mutex::new(writer)),
                    child,
                    _containment: containment,
                },
            )
    };

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
            sessions
                .as_mut()
                .and_then(|registry| registry.remove_unchecked(&session_id))
        };
        if let Some(session) = session {
            stop_session(session);
        }
    });

    Ok(id)
}

fn stop_session(session: TermSession) {
    let TermSession {
        mut child,
        _containment,
        ..
    } = session;
    drop(_containment);
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn term_write(
    window: tauri::WebviewWindow,
    project_id: String,
    id: String,
    data: String,
) -> Result<(), String> {
    let owner = command_owner(window.label(), &project_id)?;
    write_terminal(&owner, &id, &data)
}

fn write_terminal(owner: &SessionOwner, id: &str, data: &str) -> Result<(), String> {
    let writer = {
        let sessions = SESSIONS.lock().expect("terminal registry poisoned");
        let session = sessions
            .as_ref()
            .ok_or_else(|| "terminal session is not open".to_string())?
            .get(id, owner)?;
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
pub fn term_resize(
    window: tauri::WebviewWindow,
    project_id: String,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let owner = command_owner(window.label(), &project_id)?;
    resize_terminal(&owner, &id, cols, rows)
}

fn resize_terminal(owner: &SessionOwner, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS.lock().expect("terminal registry poisoned");
    let session = sessions
        .as_ref()
        .ok_or_else(|| "terminal session is not open".to_string())?
        .get(id, owner)?;
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
pub fn term_kill(
    window: tauri::WebviewWindow,
    project_id: String,
    id: String,
) -> Result<(), String> {
    let owner = command_owner(window.label(), &project_id)?;
    kill_terminal(&owner, &id)
}

fn kill_terminal(owner: &SessionOwner, id: &str) -> Result<(), String> {
    let session = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        if let Some(registry) = sessions.as_mut() {
            registry.remove(id, owner)?
        } else {
            None
        }
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
        let owner = SessionOwner::new("main", "proj");
        assert!(write_terminal(&owner, "missing", "ls\n").is_err());
        assert!(resize_terminal(&owner, "missing", 80, 24).is_err());
        assert!(kill_terminal(&owner, "missing").is_ok());
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

    #[test]
    fn terminal_session_ids_are_not_sequential_counters() {
        let root =
            std::env::temp_dir().join(format!("oleafly-terminal-random-id-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let mut shell = CommandBuilder::new(if cfg!(windows) { "cmd" } else { "/bin/sh" });
        if cfg!(windows) {
            shell.arg("/C");
            shell.arg("ping -n 10 127.0.0.1 >NUL");
        } else {
            shell.arg("-c");
            shell.arg("sleep 10");
        }
        let id = open_terminal(
            &project,
            SessionOwner::new("main", "proj"),
            80,
            24,
            Channel::new(|_| Ok(())),
            shell,
        )
        .unwrap();
        let numeric_suffix = id
            .strip_prefix("term-")
            .and_then(|suffix| suffix.parse::<u64>().ok());
        let random_ids = (0..32)
            .map(|_| random_session_id())
            .collect::<std::collections::HashSet<_>>();

        kill_terminal(&SessionOwner::new("main", "proj"), &id).unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert!(numeric_suffix.is_none());
        assert_eq!(random_ids.len(), 32);
        assert!(random_ids.iter().all(|id| id.len() >= 48));
    }

    #[test]
    fn terminal_sessions_require_the_creating_window_and_project() {
        let owner = SessionOwner::new("main", "project-a");
        let mut registry = SessionRegistry::default();
        let id = registry.insert(owner.clone(), ());
        let wrong_window = SessionOwner::new("preview", "project-a");
        let wrong_project = SessionOwner::new("main", "project-b");

        assert!(registry.get(&id, &owner).is_ok());
        assert_eq!(
            registry.get(&id, &wrong_window).err().as_deref(),
            Some("terminal session belongs to another window or project")
        );
        assert_eq!(
            registry.remove(&id, &wrong_project).err().as_deref(),
            Some("terminal session belongs to another window or project")
        );
        assert!(registry.get(&id, &owner).is_ok());
        assert!(registry.remove(&id, &owner).unwrap().is_some());
        assert_eq!(
            command_owner("preview", "project-a").err().as_deref(),
            Some("terminal is unavailable from this window")
        );
    }

    #[cfg(unix)]
    #[test]
    fn owning_window_and_project_can_write_to_the_shell() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-owner-write-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let shell = root.join("test-shell.sh");
        std::fs::write(
            &shell,
            b"#!/bin/sh\nIFS= read -r input\nprintf '%s' \"$input\" > terminal-input.txt\nsleep 10\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let owner = command_owner("main", "proj").unwrap();
        let session_id = open_terminal(
            &project,
            owner.clone(),
            80,
            24,
            Channel::new(|_| Ok(())),
            CommandBuilder::new(&shell),
        )
        .unwrap();

        write_terminal(&owner, &session_id, "hello from the owner\n").unwrap();
        let received_path = project.join("terminal-input.txt");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !received_path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let received = std::fs::read_to_string(received_path).unwrap();

        kill_terminal(&owner, &session_id).unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(received, "hello from the owner");
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

        let owner = SessionOwner::new("main", "proj");
        let session_id = open_terminal(
            &project,
            owner.clone(),
            80,
            24,
            channel,
            CommandBuilder::new(&shell),
        )
        .unwrap();
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
        let _ = kill_terminal(&owner, &session_id);
        std::fs::remove_dir_all(&root).ok();
        assert!(stopped);
    }

    #[cfg(unix)]
    #[test]
    fn term_kill_terminates_background_descendants() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-process-group-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let shell = root.join("test-shell.sh");
        std::fs::write(
            &shell,
            b"#!/bin/sh\ntrap '' HUP TERM\n( trap '' HUP TERM; sleep 0.35; touch descendant-marker ) &\nprintf '%s\\n' \"$!\" > descendant.pid\nsleep 10\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
        let channel = Channel::new(|_| Ok(()));
        let owner = SessionOwner::new("main", "proj");
        let session_id = open_terminal(
            &project,
            owner.clone(),
            80,
            24,
            channel,
            CommandBuilder::new(&shell),
        )
        .unwrap();
        let pid_path = project.join("descendant.pid");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !pid_path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let descendant_pid = std::fs::read_to_string(&pid_path).unwrap();

        kill_terminal(&owner, &session_id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let marker_exists = project.join("descendant-marker").exists();
        let _ = std::process::Command::new("kill")
            .args(["-KILL", descendant_pid.trim()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        std::fs::remove_dir_all(&root).ok();
        assert!(!marker_exists);
    }
}
