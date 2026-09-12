use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
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
    InputError { message: String },
}

struct TermSession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: TerminalWriter,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    _containment: crate::proc::ProcessTreeGuard,
}

const MAX_PENDING_INPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PENDING_INPUT_WRITES: usize = 256;

type WriteReceipt = tokio::sync::oneshot::Receiver<Result<(), String>>;

/// The pair of handles a session reads from and writes to.
type TerminalStreams = (Box<dyn Read + Send>, Box<dyn Write + Send>);

struct PendingWrite {
    bytes: Vec<u8>,
    completion: tokio::sync::oneshot::Sender<Result<(), String>>,
}

struct TerminalWriter {
    sender: SyncSender<PendingWrite>,
    pending_bytes: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
}

#[cfg(unix)]
struct TerminalReader(std::fs::File);

#[cfg(unix)]
impl Read for TerminalReader {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        use std::os::fd::AsRawFd;
        loop {
            match self.0.read(bytes) {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    let mut descriptor = libc::pollfd {
                        fd: self.0.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    };
                    if unsafe { libc::poll(&mut descriptor, 1, -1) } < 0 {
                        let error = std::io::Error::last_os_error();
                        if error.kind() != std::io::ErrorKind::Interrupted {
                            return Err(error);
                        }
                    }
                }
                result => return result,
            }
        }
    }
}

fn write_terminal_input(
    writer: &mut dyn Write,
    mut bytes: &[u8],
    closed: &AtomicBool,
) -> Result<(), String> {
    while !bytes.is_empty() {
        if closed.load(Ordering::Acquire) {
            return Err("terminal session is closed".into());
        }
        match writer.write(bytes) {
            Ok(0) => return Err("failed to write to shell: no input was accepted".into()),
            Ok(written) => bytes = &bytes[written..],
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(error) => return Err(format!("failed to write to shell: {error}")),
        }
    }
    Ok(())
}

impl TerminalWriter {
    fn start(
        mut writer: Box<dyn Write + Send>,
        channel: Option<Channel<TerminalEvent>>,
    ) -> Result<Self, String> {
        let (sender, receiver) = sync_channel::<PendingWrite>(MAX_PENDING_INPUT_WRITES);
        let pending_bytes = Arc::new(AtomicUsize::new(0));
        let closed = Arc::new(AtomicBool::new(false));
        let worker_pending = Arc::clone(&pending_bytes);
        let worker_closed = Arc::clone(&closed);
        std::thread::Builder::new()
            .name("oleafly-terminal-input".into())
            .spawn(move || {
                for pending in receiver {
                    let result = if worker_closed.load(Ordering::Acquire) {
                        Err("terminal session is closed".into())
                    } else {
                        write_terminal_input(&mut writer, &pending.bytes, &worker_closed)
                    };
                    worker_pending.fetch_sub(pending.bytes.len(), Ordering::AcqRel);
                    let failed = result.is_err();
                    if failed && !worker_closed.swap(true, Ordering::AcqRel) {
                        if let (Some(channel), Err(message)) = (&channel, &result) {
                            let _ = channel.send(TerminalEvent::InputError {
                                message: message.clone(),
                            });
                        }
                    }
                    let _ = pending.completion.send(result);
                }
            })
            .map_err(|error| format!("failed to start terminal input: {error}"))?;
        Ok(Self {
            sender,
            pending_bytes,
            closed,
        })
    }

    fn enqueue(&self, data: &str) -> Result<WriteReceipt, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("terminal session is closed".into());
        }
        if data.len() > MAX_PENDING_INPUT_BYTES {
            return Err("This paste is too large. Paste 4 MiB or less at a time.".into());
        }
        self.pending_bytes
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |pending| {
                pending
                    .checked_add(data.len())
                    .filter(|total| *total <= MAX_PENDING_INPUT_BYTES)
            })
            .map_err(|_| "The shell is not accepting input. Wait or restart the terminal.")?;
        let (completion, receipt) = tokio::sync::oneshot::channel();
        if let Err(error) = self.sender.try_send(PendingWrite {
            bytes: data.as_bytes().to_vec(),
            completion,
        }) {
            self.pending_bytes.fetch_sub(data.len(), Ordering::AcqRel);
            return Err(match error {
                std::sync::mpsc::TrySendError::Full(_) => {
                    "The shell is not accepting input. Wait or restart the terminal."
                }
                std::sync::mpsc::TrySendError::Disconnected(_) => "terminal session is closed",
            }
            .into());
        }
        Ok(receipt)
    }
}

impl Drop for TerminalWriter {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Release);
    }
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
    window_generations: HashMap<String, u64>,
}

impl<T> Default for SessionRegistry<T> {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            window_generations: HashMap::new(),
        }
    }
}

impl<T> SessionRegistry<T> {
    fn generation(&mut self, window_label: &str) -> u64 {
        *self
            .window_generations
            .entry(window_label.to_string())
            .or_default()
    }

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
        let generation = self
            .window_generations
            .entry(window_label.to_string())
            .or_default();
        *generation = generation.wrapping_add(1);
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
        for generation in self.window_generations.values_mut() {
            *generation = generation.wrapping_add(1);
        }
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
            .map(SessionRegistry::drain_all)
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

/// Environment that lets prompts and CLI tools render at their best inside
/// the embedded xterm: 256 colors plus truecolor, a UTF-8 locale when the
/// GUI launch left none (so icons and box drawing are not replaced by `?`),
/// and a TERM_PROGRAM identity tools can special-case.
fn apply_terminal_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Oleafly");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    #[cfg(not(windows))]
    {
        let has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .any(|key| std::env::var_os(key).is_some_and(|v| !v.is_empty()));
        if !has_locale {
            let locale = if cfg!(target_os = "macos") {
                "en_US.UTF-8"
            } else {
                "C.UTF-8"
            };
            cmd.env("LANG", locale);
        }
    }
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
    let ticket = terminal_open_ticket(owner);
    tauri::async_runtime::spawn_blocking(move || {
        open_terminal_with_ticket(&cwd, ticket, cols, rows, channel, default_shell())
    })
    .await
    .map_err(|e| format!("failed to start shell: {e}"))?
}

struct TerminalOpenTicket {
    owner: SessionOwner,
    generation: u64,
}

fn terminal_open_ticket(owner: SessionOwner) -> TerminalOpenTicket {
    let generation = SESSIONS
        .lock()
        .expect("terminal registry poisoned")
        .get_or_insert_with(SessionRegistry::default)
        .generation(&owner.window_label);
    TerminalOpenTicket { owner, generation }
}

#[cfg(test)]
fn open_terminal(
    cwd: &Path,
    owner: SessionOwner,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
    cmd: CommandBuilder,
) -> Result<String, String> {
    open_terminal_with_ticket(cwd, terminal_open_ticket(owner), cols, rows, channel, cmd)
}

fn open_terminal_with_ticket(
    cwd: &Path,
    ticket: TerminalOpenTicket,
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
    apply_terminal_env(&mut cmd);
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

    let (reader, writer) = terminal_streams(&*pty.master)?;
    let writer = TerminalWriter::start(writer, Some(channel.clone()))?;

    let child = Arc::new(Mutex::new(child));
    let session = TermSession {
        master: Arc::new(Mutex::new(pty.master)),
        writer,
        child: Arc::clone(&child),
        _containment: containment,
    };
    let id = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        let registry = sessions.get_or_insert_with(SessionRegistry::default);
        if registry.generation(&ticket.owner.window_label) != ticket.generation {
            drop(sessions);
            drop(reader);
            stop_session(session);
            return Err("terminal window was reloaded while the shell was starting".into());
        }
        registry.insert(ticket.owner, session)
    };
    println!(
        "term: session {id} opened pty={:.1}ms spawn={:.1}ms contain={:.1}ms",
        pty_ready.as_secs_f64() * 1000.0,
        (spawned - pty_ready).as_secs_f64() * 1000.0,
        (contained - spawned).as_secs_f64() * 1000.0
    );

    spawn_exit_poller(id.clone(), child);
    spawn_output_reader(id.clone(), reader, channel);

    Ok(id)
}

/// Open the pair of handles the session reads from and writes to. Unix needs a
/// non-blocking duplicate of the master descriptor; Windows takes the reader
/// and writer the pty exposes.
fn terminal_streams(master: &(dyn MasterPty + Send)) -> Result<TerminalStreams, String> {
    #[cfg(unix)]
    {
        use std::os::fd::{AsRawFd, BorrowedFd};
        let fd = master.as_raw_fd().ok_or("terminal input is unavailable")?;
        let fd = unsafe { BorrowedFd::borrow_raw(fd) }
            .try_clone_to_owned()
            .map_err(|error| format!("failed to open terminal input: {error}"))?;
        let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) };
        if flags < 0
            || unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
        {
            return Err(format!(
                "failed to configure terminal input: {}",
                std::io::Error::last_os_error()
            ));
        }
        let reader = fd
            .try_clone()
            .map_err(|error| format!("failed to open terminal output: {error}"))?;
        Ok((
            Box::new(TerminalReader(std::fs::File::from(reader))),
            Box::new(std::fs::File::from(fd)),
        ))
    }
    #[cfg(not(unix))]
    {
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("failed to read pty: {e}"))?;
        let writer = master
            .take_writer()
            .map_err(|error| format!("failed to write pty: {error}"))?;
        Ok((reader, writer))
    }
}

/// ConPTY keeps the reader blocked until the pseudo console closes, so a shell
/// that exits on its own never EOFs the reader on Windows. Poll for the exit
/// and drop the session; closing the master unblocks the reader, which then
/// delivers the exit event. The poller ends when the session is torn down
/// elsewhere and its registry clone of the child goes away.
fn spawn_exit_poller(
    poll_id: String,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
) {
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
        if let Some(session) = take_session(&poll_id) {
            stop_session(session);
        }
        break;
    });
}

/// Remove a session from the registry by id. The reader and the exit poller
/// race to tear the same session down, so whichever arrives second gets None.
fn take_session(session_id: &str) -> Option<TermSession> {
    let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
    sessions
        .as_mut()
        .and_then(|registry| registry.remove_unchecked(session_id))
}

/// Forward shell output until the pty closes. Returns whether the channel still
/// accepts events, and any bytes left after the last complete character.
fn stream_terminal_output(
    session_id: &str,
    reader: &mut dyn Read,
    channel: &Channel<TerminalEvent>,
) -> (bool, Vec<u8>) {
    let mut buffer = [0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    let mut channel_open = true;
    while let Ok(count) = reader.read(&mut buffer) {
        if count == 0 {
            break;
        }
        if !channel_open {
            continue;
        }
        pending.extend_from_slice(&buffer[..count]);
        let data = drain_utf8_lossy(&mut pending);
        if data.is_empty() {
            continue;
        }
        if channel.send(TerminalEvent::Output { data }).is_ok() {
            continue;
        }
        channel_open = false;
        pending.clear();
        stop_sessions_in_background(take_session(session_id).into_iter().collect());
    }
    (channel_open, pending)
}

fn spawn_output_reader(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    channel: Channel<TerminalEvent>,
) {
    std::thread::spawn(move || {
        let (mut channel_open, pending) =
            stream_terminal_output(&session_id, reader.as_mut(), &channel);
        println!("term: session {session_id} reader eof (channel_open={channel_open})");
        if channel_open && !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).to_string();
            channel_open = channel.send(TerminalEvent::Output { data }).is_ok();
        }
        if let Some(session) = take_session(&session_id) {
            stop_session(session);
        }
        if channel_open {
            let delivered = channel.send(TerminalEvent::Exit).is_ok();
            println!("term: session {session_id} exit event delivered={delivered}");
        }
    });
}

fn stop_session(session: TermSession) {
    let TermSession {
        master,
        writer,
        child,
        _containment,
    } = session;
    drop(writer);
    drop(_containment);
    drop(master);
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
    let _receipt = write_terminal(&owner, &id, &data)?;
    Ok(())
}

fn write_terminal(owner: &SessionOwner, id: &str, data: &str) -> Result<WriteReceipt, String> {
    let sessions = SESSIONS.lock().expect("terminal registry poisoned");
    let session = sessions
        .as_ref()
        .ok_or_else(|| "terminal session is not open".to_string())?
        .get(id, owner)?;
    session.writer.enqueue(data)
}

#[tauri::command]
pub async fn term_resize<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let owner = webview_command_owner(&webview, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || resize_terminal(&owner, &id, cols, rows))
        .await
        .map_err(|error| format!("failed to resize terminal: {error}"))?
}

fn resize_terminal(owner: &SessionOwner, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    // ResizePseudoConsole can wait on ConPTY. Never keep the global registry
    // locked while resizing, or even input/close for other terminals stalls.
    let master = {
        let sessions = SESSIONS.lock().expect("terminal registry poisoned");
        Arc::clone(
            &sessions
                .as_ref()
                .ok_or_else(|| "terminal session is not open".to_string())?
                .get(id, owner)?
                .master,
        )
    };
    // Recover a poisoned master the way storage locks do. A panic in one
    // resize must not make every later resize of that terminal fail.
    let master = master
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    master
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
    stop_sessions_in_background(session.into_iter().collect());
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn reload_rejects_an_in_flight_terminal_open() {
        let directory = tempfile::tempdir().unwrap();
        let owner = SessionOwner::new("audit-stale-open", "proj");
        let ticket = terminal_open_ticket(owner.clone());
        kill_window_sessions(&owner.window_label);
        let result = open_terminal_with_ticket(
            directory.path(),
            ticket,
            80,
            24,
            Channel::new(|_| Ok(())),
            nonreading_terminal_fixture(),
        );
        assert!(result.unwrap_err().contains("reloaded"));
        let sessions = SESSIONS.lock().unwrap();
        assert!(!sessions
            .as_ref()
            .unwrap()
            .sessions
            .values()
            .any(|record| record.owner == owner));
    }

    #[test]
    fn slow_resize_does_not_hold_the_global_session_registry() {
        let directory = tempfile::tempdir().unwrap();
        let owner = SessionOwner::new("audit-resize-lock", "proj");
        let id = open_terminal(
            directory.path(),
            owner.clone(),
            80,
            24,
            Channel::new(|_| Ok(())),
            nonreading_terminal_fixture(),
        )
        .unwrap();
        let master = {
            let sessions = SESSIONS.lock().unwrap();
            Arc::clone(&sessions.as_ref().unwrap().get(&id, &owner).unwrap().master)
        };
        let locked = master.lock().unwrap();
        let resize_owner = owner.clone();
        let resize_id = id.clone();
        let (started, ready) = std::sync::mpsc::channel();
        let resize = std::thread::spawn(move || {
            started.send(()).unwrap();
            resize_terminal(&resize_owner, &resize_id, 100, 30)
        });
        ready
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let registry_available = SESSIONS.try_lock().is_ok();
        drop(locked);
        resize.join().unwrap().unwrap();
        kill_terminal(&owner, &id).unwrap();
        assert!(
            registry_available,
            "resize blocked input/close for every terminal"
        );
    }

    #[tokio::test]
    async fn oversized_pastes_are_rejected_whole_and_leave_the_terminal_usable() {
        let writer = TerminalWriter::start(Box::new(std::io::sink()), None).unwrap();
        let error = writer
            .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES + 1))
            .unwrap_err();
        assert!(error.contains("Paste 4 MiB or less"));
        assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 0);
        writer
            .enqueue("echo ready\n")
            .unwrap()
            .await
            .unwrap()
            .unwrap();
        writer
            .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES))
            .unwrap()
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn blocked_terminal_input_is_bounded_ordered_and_does_not_block_the_caller() {
        struct BlockedWriter {
            started: std::sync::mpsc::Sender<()>,
            resume: std::sync::mpsc::Receiver<()>,
            output: Arc<Mutex<Vec<u8>>>,
        }
        impl Write for BlockedWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.started.send(()).unwrap();
                self.resume.recv().unwrap();
                self.output.lock().unwrap().extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (started, started_rx) = std::sync::mpsc::channel();
        let (resume, resume_rx) = std::sync::mpsc::channel();
        let output = Arc::new(Mutex::new(Vec::new()));
        let writer = TerminalWriter::start(
            Box::new(BlockedWriter {
                started,
                resume: resume_rx,
                output: Arc::clone(&output),
            }),
            None,
        )
        .unwrap();
        let first = writer.enqueue("first").unwrap();
        started_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let second = writer.enqueue("second").unwrap();
        assert!(writer
            .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES))
            .is_err());
        assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 11);
        resume.send(()).unwrap();
        first.await.unwrap().unwrap();
        started_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        resume.send(()).unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(*output.lock().unwrap(), b"firstsecond");
        assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn terminal_writer_reports_io_failure_and_rejects_more_input() {
        struct FailedWriter;
        impl Write for FailedWriter {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let writer = TerminalWriter::start(Box::new(FailedWriter), None).unwrap();
        assert!(writer.enqueue("hello").unwrap().await.unwrap().is_err());
        assert!(writer.enqueue("again").is_err());
    }

    #[test]
    fn terminal_env_advertises_truecolor_and_identity() {
        let mut cmd = super::CommandBuilder::new("sh");
        super::apply_terminal_env(&mut cmd);
        let get = |k: &str| cmd.get_env(k).map(|v| v.to_string_lossy().into_owned());
        assert_eq!(get("TERM").as_deref(), Some("xterm-256color"));
        assert_eq!(get("COLORTERM").as_deref(), Some("truecolor"));
        assert_eq!(get("TERM_PROGRAM").as_deref(), Some("Oleafly"));
        assert_eq!(
            get("TERM_PROGRAM_VERSION").as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        #[cfg(not(windows))]
        {
            // Either the host already has a UTF-8-capable locale, or we supplied one.
            let host_has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
                .iter()
                .any(|k| std::env::var_os(k).is_some_and(|v| !v.is_empty()));
            if !host_has_locale {
                assert!(get("LANG").is_some_and(|v| v.ends_with("UTF-8")));
            }
        }
    }

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
        while !std::fs::read_to_string(&received_path)
            .is_ok_and(|received| received == "hello from the main webview")
            && std::time::Instant::now() < deadline
        {
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
        while !std::fs::read_to_string(&received_path)
            .is_ok_and(|received| received == "hello from the owner")
            && std::time::Instant::now() < deadline
        {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let received = std::fs::read_to_string(received_path).unwrap();

        kill_terminal(&owner, &session_id).unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(received, "hello from the owner");
    }

    struct TerminalTestSession {
        owner: SessionOwner,
        id: String,
    }

    impl Drop for TerminalTestSession {
        fn drop(&mut self) {
            let _ = kill_terminal(&self.owner, &self.id);
        }
    }

    #[test]
    fn nonreading_terminal_child() {
        if std::env::var("OLEAFLY_TERMINAL_TEST_CHILD").as_deref() != Ok("1") {
            return;
        }
        #[cfg(windows)]
        let mut output = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open("CONOUT$")
            .unwrap();
        #[cfg(unix)]
        let mut output = std::io::stdout().lock();
        output.write_all(b"READY").unwrap();
        output.flush().unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(30);
        while Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if output.write_all(b".").and_then(|_| output.flush()).is_err() {
                return;
            }
        }
    }

    fn nonreading_terminal_fixture() -> CommandBuilder {
        let mut process = CommandBuilder::new(std::env::current_exe().unwrap());
        process.args([
            "--exact",
            "terminal::tests::nonreading_terminal_child",
            "--nocapture",
        ]);
        process.env("OLEAFLY_TERMINAL_TEST_CHILD", "1");
        process
    }

    async fn wait_for_terminal_ready(
        events: &mut tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>,
    ) {
        let mut output = String::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(event) = events.recv().await {
                if let Some(data) = event["data"].as_str() {
                    output.push_str(data);
                    if output.contains("READY") {
                        return;
                    }
                }
            }
            panic!("terminal event stream closed before the shell was ready");
        })
        .await
        .unwrap_or_else(|_| panic!("shell did not become ready; terminal output: {output:?}"));
    }

    #[tokio::test]
    async fn hidden_terminal_starts_and_closes_without_a_cursor_response() {
        let project = tempfile::tempdir().unwrap();
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            let _ = events.send(body.deserialize::<serde_json::Value>().unwrap());
            Ok(())
        });
        let owner = SessionOwner::new("main", "hidden-terminal");
        let id = open_terminal(
            project.path(),
            owner.clone(),
            80,
            24,
            channel,
            nonreading_terminal_fixture(),
        )
        .unwrap();
        let session = TerminalTestSession { owner, id };
        wait_for_terminal_ready(&mut received).await;
        kill_terminal(&session.owner, &session.id).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(event) = received.recv().await {
                if event["event"] == "exit" {
                    return;
                }
            }
            panic!("terminal event stream closed without an exit event");
        })
        .await
        .expect("hidden terminal did not finish native teardown");
    }

    #[tokio::test]
    async fn disconnecting_output_during_a_large_paste_reaps_the_shell() {
        let project = tempfile::tempdir().unwrap();
        let disconnect = Arc::new(AtomicBool::new(false));
        let close_channel = Arc::clone(&disconnect);
        let rejected = Arc::new(AtomicBool::new(false));
        let observed_rejection = Arc::clone(&rejected);
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            if close_channel.load(Ordering::Acquire) {
                observed_rejection.store(true, Ordering::Release);
                return Err(tauri::Error::AssetNotFound("closed".into()));
            }
            let _ = events.send(body.deserialize::<serde_json::Value>().unwrap());
            Ok(())
        });
        let owner = SessionOwner::new("main", "paste-disconnect");
        let id = open_terminal(
            project.path(),
            owner.clone(),
            80,
            24,
            channel,
            nonreading_terminal_fixture(),
        )
        .unwrap();
        let session = TerminalTestSession { owner, id };
        wait_for_terminal_ready(&mut received).await;
        let child = {
            let sessions = SESSIONS.lock().unwrap();
            Arc::clone(
                &sessions
                    .as_ref()
                    .unwrap()
                    .get(&session.id, &session.owner)
                    .unwrap()
                    .child,
            )
        };
        let receipt =
            write_terminal(&session.owner, &session.id, &"paste\n".repeat(80_000)).unwrap();
        disconnect.store(true, Ordering::Release);
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        tokio::time::timeout_at(deadline, async {
            while !rejected.load(Ordering::Acquire) {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("terminal never observed the disconnected output channel");
        let _ = tokio::time::timeout_at(deadline, receipt)
            .await
            .expect("terminal input did not settle after disconnect");
        tokio::time::timeout_at(deadline, async {
            loop {
                let exited = child
                    .try_lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok().flatten())
                    .is_some();
                if exited {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("terminal shell did not exit after disconnect");
        assert!(write_terminal(&session.owner, &session.id, "more").is_err());
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
