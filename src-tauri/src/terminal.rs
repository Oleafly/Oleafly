use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use serde::Serialize;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{ipc::Channel, RunEvent, Runtime, Webview};

#[derive(Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub(crate) enum TerminalEvent {
    Output { data: String },
    Exit,
}

struct TermSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
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

    fn drain_window(&mut self, window_label: &str) -> Vec<T> {
        let ids: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, record)| record.owner.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter()
            .filter_map(|id| self.remove_unchecked(id))
            .collect()
    }

    fn drain_all(&mut self) -> Vec<T> {
        self.sessions
            .drain()
            .map(|(_, record)| record.session)
            .collect()
    }
}

fn stop_sessions_in_background(sessions: Vec<TermSession>) {
    if sessions.is_empty() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("oleafly-terminal-cleanup".into())
        .spawn(move || {
            for session in sessions {
                stop_session(session);
            }
        });
}

pub(crate) fn kill_window_sessions(window_label: &str) {
    let drained = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions
            .as_mut()
            .map(|registry| registry.drain_window(window_label))
            .unwrap_or_default()
    };
    stop_sessions_in_background(drained);
}

fn kill_all_sessions() {
    let drained = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions
            .as_mut()
            .map(|registry| registry.drain_all())
            .unwrap_or_default()
    };
    for session in drained {
        stop_session(session);
    }
}

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if webview.window().label() != "main" || !matches!(payload.event(), PageLoadEvent::Started) {
        return;
    }
    kill_window_sessions("main");
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("terminal-lifecycle")
        .on_event(|_app, event| {
            if let RunEvent::Exit = event {
                kill_all_sessions();
            }
        })
        .build()
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

fn webview_command_owner<R: Runtime>(
    webview: &Webview<R>,
    project_id: &str,
) -> Result<SessionOwner, String> {
    command_owner(webview.window().label(), project_id)
}

/// Decode as much valid UTF-8 as `pending` holds, keeping an incomplete
/// multi-byte tail for the next read. A per-read `from_utf8_lossy` would turn
/// a character straddling the 8 KiB read boundary into U+FFFD on both sides.
fn drain_utf8_lossy(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    let mut start = 0usize;
    loop {
        match std::str::from_utf8(&pending[start..]) {
            Ok(valid) => {
                out.push_str(valid);
                start = pending.len();
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                out.push_str(
                    std::str::from_utf8(&pending[start..start + valid]).expect("validated prefix"),
                );
                match error.error_len() {
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        start += valid + bad;
                    }
                    None => {
                        start += valid;
                        break;
                    }
                }
            }
        }
    }
    pending.drain(..start);
    out
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
pub async fn term_open<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
) -> Result<String, String> {
    let owner = webview_command_owner(&webview, &project_id)?;
    let cwd = crate::paths::project_dir(&project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        open_terminal(&cwd, owner, cols, rows, channel, default_shell())
    })
    .await
    .map_err(|e| format!("failed to start shell: {e}"))?
}

fn open_terminal(
    cwd: &Path,
    owner: SessionOwner,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
    mut cmd: CommandBuilder,
) -> Result<String, String> {
    let started = Instant::now();
    let pty = portable_pty::native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    let pty_ready = started.elapsed();

    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    let mut child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start shell: {e}"))?;
    let pid = child
        .process_id()
        .ok_or_else(|| "failed to identify shell process".to_string())?;
    let spawned = started.elapsed();
    let containment = match crate::proc::contain_process_tree(pid) {
        Ok(containment) => containment,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to contain shell process: {error}"));
        }
    };
    let contained = started.elapsed();
    drop(pty.slave);

    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to read pty: {e}"))?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|e| format!("failed to write pty: {e}"))?;

    let child = Arc::new(Mutex::new(child));
    let id = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions
            .get_or_insert_with(SessionRegistry::default)
            .insert(
                owner,
                TermSession {
                    master: pty.master,
                    writer: Arc::new(Mutex::new(writer)),
                    child: Arc::clone(&child),
                    _containment: containment,
                },
            )
    };
    println!(
        "term: session {id} opened pty={:.1}ms spawn={:.1}ms contain={:.1}ms",
        pty_ready.as_secs_f64() * 1000.0,
        (spawned - pty_ready).as_secs_f64() * 1000.0,
        (contained - spawned).as_secs_f64() * 1000.0
    );

    // ConPTY keeps the reader blocked until the pseudo console closes, so a
    // shell that exits on its own never EOFs the reader on Windows. Poll for
    // the exit and drop the session; closing the master unblocks the reader,
    // which then delivers the exit event. The poller ends when the session is
    // torn down elsewhere and its registry clone of the child goes away.
    let poll_id = id.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if Arc::strong_count(&child) == 1 {
            break;
        }
        let exited = child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .is_some();
        if !exited {
            continue;
        }
        println!("term: session {poll_id} shell exited");
        let session = {
            let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
            sessions
                .as_mut()
                .and_then(|registry| registry.remove_unchecked(&poll_id))
        };
        if let Some(session) = session {
            stop_session(session);
        }
        break;
    });

    let session_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        let mut channel_open = true;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buffer[..n]);
                    let data = drain_utf8_lossy(&mut pending);
                    if data.is_empty() {
                        continue;
                    }
                    if channel.send(TerminalEvent::Output { data }).is_err() {
                        channel_open = false;
                        break;
                    }
                }
            }
        }
        println!("term: session {session_id} reader eof (channel_open={channel_open})");
        if channel_open && !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).to_string();
            if channel.send(TerminalEvent::Output { data }).is_err() {
                channel_open = false;
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
        if channel_open {
            let delivered = channel.send(TerminalEvent::Exit).is_ok();
            println!("term: session {session_id} exit event delivered={delivered}");
        }
    });

    Ok(id)
}

fn stop_session(session: TermSession) {
    let TermSession {
        child,
        _containment,
        ..
    } = session;
    drop(_containment);
    if let Ok(mut guard) = child.lock() {
        let _ = guard.kill();
        let _ = guard.wait();
    };
}

#[tauri::command]
pub fn term_write<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    id: String,
    data: String,
) -> Result<(), String> {
    let owner = webview_command_owner(&webview, &project_id)?;
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
pub fn term_resize<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let owner = webview_command_owner(&webview, &project_id)?;
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
pub fn term_kill<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    id: String,
) -> Result<(), String> {
    let owner = webview_command_owner(&webview, &project_id)?;
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

    #[test]
    fn drain_window_removes_only_that_windows_sessions() {
        let mut registry = SessionRegistry::<u32>::default();
        let main_id = registry.insert(SessionOwner::new("main", "alpha"), 1);
        let other_main = registry.insert(SessionOwner::new("main", "beta"), 2);
        let preview_id = registry.insert(SessionOwner::new("preview", "alpha"), 3);
        let mut drained = registry.drain_window("main");
        drained.sort_unstable();
        assert_eq!(drained, vec![1, 2]);
        assert!(registry.remove_unchecked(&main_id).is_none());
        assert!(registry.remove_unchecked(&other_main).is_none());
        assert_eq!(registry.remove_unchecked(&preview_id), Some(3));
        assert!(registry.drain_all().is_empty());
    }
    #[cfg(unix)]
    use crate::proc::NoConsole as _;
    #[test]
    fn drain_utf8_keeps_a_split_multibyte_tail() {
        let emoji = "café🦀".as_bytes();
        let (head, tail) = emoji.split_at(emoji.len() - 2);
        let mut pending = head.to_vec();
        let mut out = super::drain_utf8_lossy(&mut pending);
        pending.extend_from_slice(tail);
        out.push_str(&super::drain_utf8_lossy(&mut pending));
        assert_eq!(out, "café🦀");
        assert!(pending.is_empty());
    }

    #[test]
    fn drain_utf8_replaces_invalid_bytes() {
        let mut pending = vec![b'o', b'k', 0xFF, b'!'];
        let out = super::drain_utf8_lossy(&mut pending);
        assert_eq!(out, "ok\u{FFFD}!");
        assert!(pending.is_empty());
    }

    use super::*;

    #[test]
    #[cfg_attr(
        windows,
        ignore = "WebView2 child-webview creation needs a running message loop that a unit test thread does not provide"
    )]
    fn terminal_write_resolves_the_parent_of_a_multi_webview_window() {
        #[cfg(not(windows))]
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-multi-webview-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        #[cfg(not(windows))]
        let shell = {
            let shell = root.join("test-shell.sh");
            std::fs::write(
                &shell,
                b"#!/bin/sh\nIFS= read -r input\nprintf '%s' \"$input\" > terminal-input.txt\nsleep 10\n",
            )
            .unwrap();
            std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
            CommandBuilder::new(shell)
        };
        #[cfg(windows)]
        let shell = {
            let mut shell = CommandBuilder::new("powershell.exe");
            shell.arg("-NoProfile");
            shell.arg("-Command");
            shell.arg("$input = [Console]::In.ReadLine(); [IO.File]::WriteAllText('terminal-input.txt', $input); Start-Sleep -Seconds 10");
            shell
        };
        let owner = SessionOwner::new("main", "proj");
        let session_id = open_terminal(
            &project,
            owner.clone(),
            80,
            24,
            Channel::new(|_| Ok(())),
            shell,
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![term_write])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let main_webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let window = main_webview.as_ref().window();
        let _browser_webview = window
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    "oleafly-browser-pane-test",
                    Default::default(),
                ),
                tauri::LogicalPosition::new(0, 0),
                tauri::LogicalSize::new(400, 600),
            )
            .unwrap();

        let response = tauri::test::get_ipc_response(
            &main_webview,
            tauri::webview::InvokeRequest {
                cmd: "term_write".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: serde_json::json!({
                    "projectId": "proj",
                    "id": session_id,
                    "data": "hello from the main webview\n"
                })
                .into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );
        let response = response.map(|body| body.deserialize::<()>().unwrap());
        let received_path = project.join("terminal-input.txt");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !received_path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let received = std::fs::read_to_string(&received_path);

        kill_terminal(&owner, &session_id).unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(response, Ok(()));
        assert_eq!(received.unwrap(), "hello from the main webview");
    }

    #[cfg(unix)]
    #[test]
    fn child_exit_sends_a_terminal_exit_event() {
        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-exit-event-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let mut shell = CommandBuilder::new("/bin/sh");
        shell.arg("-c");
        shell.arg("sleep 0.05");
        let (events_tx, events_rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            events_tx
                .send(body.deserialize::<serde_json::Value>().unwrap())
                .unwrap();
            Ok(())
        });

        open_terminal(
            &project,
            SessionOwner::new("main", "proj"),
            80,
            24,
            channel,
            shell,
        )
        .unwrap();
        // The contract is that the exit event arrives, not that it is the
        // first event; a pty may emit terminal noise before the shell dies.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut events = Vec::new();
        let exit_seen = loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break false;
            }
            match events_rx.recv_timeout(remaining) {
                Ok(event) => {
                    let is_exit = event == serde_json::json!({ "event": "exit" });
                    events.push(event);
                    if is_exit {
                        break true;
                    }
                }
                Err(_) => break false,
            }
        };

        std::fs::remove_dir_all(&root).ok();
        assert!(exit_seen, "no exit event; received: {events:?}");
    }

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
        let mut registry = SessionRegistry::default();
        let id = registry.insert(SessionOwner::new("main", "proj"), ());
        let numeric_suffix = id
            .strip_prefix("term-")
            .and_then(|suffix| suffix.parse::<u64>().ok());
        let random_ids = (0..32)
            .map(|_| random_session_id())
            .collect::<std::collections::HashSet<_>>();

        assert!(id.starts_with("term-"));
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
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
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
        use std::sync::atomic::{AtomicUsize, Ordering};
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
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        let channel_entered = Arc::new(Barrier::new(2));
        let close_channel = Arc::new(Barrier::new(2));
        let send_attempts = Arc::new(AtomicUsize::new(0));
        let callback_entered = Arc::clone(&channel_entered);
        let callback_close = Arc::clone(&close_channel);
        let callback_attempts = Arc::clone(&send_attempts);
        let channel = Channel::new(move |_| {
            if callback_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                callback_entered.wait();
                callback_close.wait();
            }
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
                .no_console()
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
                .no_console()
                .args(["-KILL", &pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        let _ = kill_terminal(&owner, &session_id);
        std::thread::sleep(std::time::Duration::from_millis(100));
        std::fs::remove_dir_all(&root).ok();
        assert!(stopped);
        assert_eq!(send_attempts.load(Ordering::SeqCst), 1);
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
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
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
            .no_console()
            .args(["-KILL", descendant_pid.trim()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        std::fs::remove_dir_all(&root).ok();
        assert!(!marker_exists);
    }

    #[cfg(unix)]
    #[test]
    fn closing_a_window_stops_only_that_windows_shells() {
        let root = std::env::temp_dir().join(format!(
            "oleafly-terminal-window-drain-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        let project = root.join("projects/proj");
        std::fs::create_dir_all(&project).unwrap();
        let idle = || {
            let mut shell = CommandBuilder::new("/bin/sh");
            shell.arg("-c");
            shell.arg("sleep 30");
            shell
        };
        let closing = SessionOwner::new("terminal-drain-window", "proj");
        let staying = SessionOwner::new("terminal-keep-window", "proj");
        let closing_id = open_terminal(
            &project,
            closing.clone(),
            80,
            24,
            Channel::new(|_| Ok(())),
            idle(),
        )
        .unwrap();
        let staying_id = open_terminal(
            &project,
            staying.clone(),
            80,
            24,
            Channel::new(|_| Ok(())),
            idle(),
        )
        .unwrap();

        kill_window_sessions("terminal-window-with-no-shells");
        assert!(write_terminal(&closing, &closing_id, "\n").is_ok());

        kill_window_sessions("terminal-drain-window");
        assert_eq!(
            write_terminal(&closing, &closing_id, "\n").err().as_deref(),
            Some("terminal session is not open")
        );
        assert!(write_terminal(&staying, &staying_id, "\n").is_ok());

        kill_terminal(&staying, &staying_id).unwrap();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_lifecycle_plugin_carries_a_stable_name() {
        use tauri::plugin::Plugin as _;

        let plugin = lifecycle_plugin::<tauri::test::MockRuntime>();
        assert_eq!(plugin.name(), "terminal-lifecycle");
    }
}
