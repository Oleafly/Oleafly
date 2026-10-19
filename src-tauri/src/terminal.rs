pub(crate) mod env;
mod flow;
mod jobs;
mod shell;

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{ipc::Channel, RunEvent, Runtime, Webview};

use self::env::CliEnv;
use self::flow::{
    next_batch, OutputFlow, OUTPUT_BATCH_BYTES, OUTPUT_BATCH_WINDOW, OUTPUT_QUEUE_CHUNKS,
    OUTPUT_READ_BYTES,
};
use self::jobs::TerminalJob;
use self::shell::{ShellChoice, ShellId, ShellKind, ShellOption};

#[derive(Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub(crate) enum TerminalEvent {
    /// `bytes` is the UTF-8 length of `data`, which the frontend
    /// acknowledges once xterm has parsed it.
    Output {
        data: String,
        bytes: usize,
    },
    Exit,
    InputError {
        message: String,
    },
}

struct TermSession {
    master: SharedMaster,
    writer: TerminalWriter,
    child: SharedChild,
    containment: crate::proc::ProcessTreeGuard,
    flow: Arc<OutputFlow>,
    shell_pid: u32,
}

/// How long a hung-up shell gets to exit before it is killed.
#[cfg(unix)]
pub(crate) const HANGUP_GRACE: Duration = Duration::from_millis(500);

const MAX_PENDING_INPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PENDING_INPUT_WRITES: usize = 256;

type WriteReceipt = tokio::sync::oneshot::Receiver<Result<(), String>>;

/// The pair of handles a session reads from and writes to.
type TerminalStreams = (Box<dyn Read + Send>, Box<dyn Write + Send>);

type SharedMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;
type SharedChild = Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>;

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
                std::thread::sleep(Duration::from_millis(10));
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

    /// Every session the owner opened, with its id.
    fn owned<'a>(&'a self, owner: &'a SessionOwner) -> impl Iterator<Item = (&'a str, &'a T)> {
        self.sessions
            .iter()
            .filter(move |(_, record)| &record.owner == owner)
            .map(|(id, record)| (id.as_str(), &record.session))
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

    fn drain_project(&mut self, project_id: &str) -> Vec<T> {
        let ids: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, record)| record.owner.project_id == project_id)
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
        .spawn(move || stop_sessions(sessions));
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

pub(crate) fn kill_project_sessions(project_id: &str) {
    let drained = {
        let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
        sessions
            .as_mut()
            .map(|registry| registry.drain_project(project_id))
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
    stop_sessions(drained);
}

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if crate::caller::own_window_label(webview).as_deref() != Some("main")
        || !matches!(payload.event(), PageLoadEvent::Started)
    {
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
    command_owner(
        crate::caller::own_window_label(webview)
            .as_deref()
            .unwrap_or_default(),
        project_id,
    )
}

/// Decode as much valid UTF-8 as `pending` holds, keeping an incomplete
/// multi-byte tail for the next read. A per-read `from_utf8_lossy` would turn
/// a character straddling a read boundary into U+FFFD on both sides.
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

/// Apply the project's trust rules to a shell command. A restricted folder
/// never gets a shell started in the background, and a shell the user opens
/// gets Git hardened. Applied last, so nothing a launch sets can undo it.
fn project_shell(
    project_id: &str,
    root: &Path,
    autostart: bool,
    mut cmd: CommandBuilder,
) -> Result<CommandBuilder, String> {
    let Some(hardening) = crate::trust::git_restriction(project_id, root)? else {
        return Ok(cmd);
    };
    if autostart {
        return Err(crate::app_error::AppError::new(
            crate::trust::Capability::TerminalAutostart.error_code(),
        )
        .into());
    }
    for (key, value) in hardening {
        cmd.env(key, value);
    }
    Ok(cmd)
}

/// What a terminal starts with besides its project: a folder inside the
/// project, extra environment and the shell setting.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalOpenOptions {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
    #[serde(default)]
    pub shell: Option<ShellChoice>,
}

/// The session id and how its shell quotes typed commands.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalOpened {
    pub id: String,
    pub shell: ShellKind,
    pub shell_id: ShellId,
    /// The shell program's name (`zsh`, `bash`), which decides the bytes
    /// Shift+Enter sends.
    pub shell_name: String,
}

#[tauri::command]
pub async fn term_open<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    cols: u16,
    rows: u16,
    autostart: Option<bool>,
    options: Option<TerminalOpenOptions>,
    channel: Channel<TerminalEvent>,
) -> Result<TerminalOpened, String> {
    let owner = webview_command_owner(&webview, &project_id)?;
    let root = crate::paths::project_dir(&project_id)?;
    let options = options.unwrap_or_default();
    let cwd = env::terminal_cwd(&root, options.cwd.as_deref())?;
    let launch_env = env::validate_launch_env(&options.env.unwrap_or_default(), cfg!(windows))?;
    let choice = options.shell.unwrap_or_default();
    let cli = CliEnv::current();
    let ticket = terminal_open_ticket(owner);
    tauri::async_runtime::spawn_blocking(move || {
        let spec = shell::resolve_shell(&choice, cfg!(windows), &shell::SystemProbe)?;
        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        env::apply_session_env(&mut cmd, &spec, &cli, &launch_env);
        let cmd = project_shell(&project_id, &root, autostart.unwrap_or(false), cmd)?;
        let id = open_terminal_with_ticket(&cwd, ticket, cols, rows, channel, cmd)?;
        Ok(TerminalOpened {
            id,
            shell: spec.kind,
            shell_id: spec.id,
            shell_name: spec.name,
        })
    })
    .await
    .map_err(|e| format!("failed to start shell: {e}"))?
}

/// The shells this computer can start, for the picker in Settings.
#[tauri::command]
pub async fn term_shells() -> Vec<ShellOption> {
    tauri::async_runtime::spawn_blocking(|| {
        shell::shell_options(cfg!(windows), &shell::SystemProbe)
    })
    .await
    .unwrap_or_default()
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
    let flow = OutputFlow::new();
    let session = TermSession {
        master: Arc::new(Mutex::new(pty.master)),
        writer,
        child: Arc::clone(&child),
        containment,
        flow: Arc::clone(&flow),
        shell_pid: pid,
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
    eprintln!(
        "term: session {id} opened pty={:.1}ms spawn={:.1}ms contain={:.1}ms",
        pty_ready.as_secs_f64() * 1000.0,
        (spawned - pty_ready).as_secs_f64() * 1000.0,
        (contained - spawned).as_secs_f64() * 1000.0
    );

    spawn_exit_poller(id.clone(), child);
    if let Err(error) = spawn_output_pump(id.clone(), reader, channel, flow) {
        if let Some(session) = take_session(&id) {
            stop_session(session);
        }
        return Err(format!("failed to start terminal output: {error}"));
    }

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
fn spawn_exit_poller(poll_id: String, child: SharedChild) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
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
        eprintln!("term: session {poll_id} shell exited");
        if let Some(session) = take_session(&poll_id) {
            stop_session(session);
        }
        break;
    });
}

/// Remove a session from the registry by id. The pump and the exit poller
/// race to tear the same session down, so whichever arrives second gets None.
fn take_session(session_id: &str) -> Option<TermSession> {
    let mut sessions = SESSIONS.lock().expect("terminal registry poisoned");
    sessions
        .as_mut()
        .and_then(|registry| registry.remove_unchecked(session_id))
}

/// Start the output pump: a reader thread that blocks on the pty and queues
/// chunks (a full queue blocks it, so a flooding program blocks on write),
/// and an emitter thread that batches the chunks, waits while the frontend
/// is behind and sends them.
fn spawn_output_pump(
    session_id: String,
    reader: Box<dyn Read + Send>,
    channel: Channel<TerminalEvent>,
    flow: Arc<OutputFlow>,
) -> std::io::Result<()> {
    let (queue, chunks) = sync_channel::<Vec<u8>>(OUTPUT_QUEUE_CHUNKS);
    std::thread::Builder::new()
        .name("oleafly-terminal-read".into())
        .spawn(move || read_output(reader, &queue))?;
    std::thread::Builder::new()
        .name("oleafly-terminal-output".into())
        .spawn(move || emit_output(&session_id, &chunks, &channel, &flow))?;
    Ok(())
}

fn read_output(mut reader: Box<dyn Read + Send>, queue: &SyncSender<Vec<u8>>) {
    let mut buffer = vec![0u8; OUTPUT_READ_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                if queue.send(buffer[..count].to_vec()).is_err() {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
}

/// Forward shell output until the reader ends, then tear the session down
/// and send the exit event while the channel is open.
fn emit_output(
    session_id: &str,
    chunks: &Receiver<Vec<u8>>,
    channel: &Channel<TerminalEvent>,
    flow: &OutputFlow,
) {
    let mut pending: Vec<u8> = Vec::new();
    let mut channel_open = true;
    // None means quiet, so the first chunk goes out at once.
    let mut last_flush: Option<Instant> = None;
    while let Some(batch) = next_batch(chunks, last_flush, OUTPUT_BATCH_WINDOW, OUTPUT_BATCH_BYTES)
    {
        if !channel_open {
            // Keep draining so the reader never blocks on a dead channel.
            continue;
        }
        pending.extend_from_slice(&batch);
        let data = drain_utf8_lossy(&mut pending);
        if data.is_empty() {
            continue;
        }
        if !flow.wait_for_room() {
            // Closed while paused: drop the output, still send Exit later.
            pending.clear();
            continue;
        }
        let bytes = data.len();
        if channel.send(TerminalEvent::Output { data, bytes }).is_err() {
            channel_open = false;
            pending.clear();
            stop_sessions_in_background(take_session(session_id).into_iter().collect());
            continue;
        }
        flow.charge(bytes);
        last_flush = Some(Instant::now());
    }
    eprintln!("term: session {session_id} reader eof (channel_open={channel_open})");
    if channel_open && !pending.is_empty() {
        let data = String::from_utf8_lossy(&pending).to_string();
        let bytes = data.len();
        channel_open = channel.send(TerminalEvent::Output { data, bytes }).is_ok();
    }
    if let Some(session) = take_session(session_id) {
        stop_session(session);
    }
    if channel_open {
        let delivered = channel.send(TerminalEvent::Exit).is_ok();
        eprintln!("term: session {session_id} exit event delivered={delivered}");
    }
}

fn stop_session(session: TermSession) {
    stop_sessions(vec![session]);
}

/// Stop shells in three steps: hang up (Unix: SIGHUP to the shell's process
/// group and to its foreground job; Windows: close the kill-on-close job),
/// give every shell one shared HANGUP_GRACE to exit, then kill what is left.
/// Quitting with ten terminals waits at most once.
fn stop_sessions(sessions: Vec<TermSession>) {
    let stopping: Vec<Stopping> = sessions.into_iter().map(Stopping::hang_up).collect();
    #[cfg(unix)]
    {
        let deadline = Instant::now() + HANGUP_GRACE;
        while Instant::now() < deadline && !stopping.iter().all(Stopping::exited) {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    for session in stopping {
        session.kill();
    }
}

/// A session between its hang-up and its kill.
struct Stopping {
    child: SharedChild,
    #[cfg(unix)]
    foreground: Option<i32>,
    #[cfg(unix)]
    containment: crate::proc::ProcessTreeGuard,
    #[cfg(unix)]
    master: SharedMaster,
}

impl Stopping {
    #[cfg(unix)]
    fn hang_up(session: TermSession) -> Self {
        let TermSession {
            master,
            writer,
            child,
            containment,
            flow,
            shell_pid,
        } = session;
        flow.close();
        let shell_group = shell_pid as i32;
        // Read the foreground job before anything closes.
        let foreground = jobs::unix_foreground_group(
            shell_group,
            master
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .process_group_leader(),
        );
        crate::proc::signal_process_group(shell_group, libc::SIGHUP);
        if let Some(group) = foreground {
            crate::proc::signal_process_group(group, libc::SIGHUP);
        }
        drop(writer);
        Self {
            child,
            foreground,
            containment,
            master,
        }
    }

    #[cfg(windows)]
    fn hang_up(session: TermSession) -> Self {
        let TermSession {
            master,
            writer,
            child,
            containment,
            flow,
            shell_pid: _,
        } = session;
        flow.close();
        drop(writer);
        // Closing the kill-on-close job ends every process in it.
        drop(containment);
        drop(master);
        Self { child }
    }

    #[cfg(unix)]
    fn exited(&self) -> bool {
        self.child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .is_some()
    }

    fn kill(self) {
        #[cfg(unix)]
        {
            if let Some(group) = self.foreground {
                crate::proc::signal_process_group(group, libc::SIGKILL);
            }
            // Dropping the guard sends SIGKILL to the shell's process group.
            drop(self.containment);
            drop(self.master);
        }
        if let Ok(mut child) = self.child.lock() {
            // A child the grace loop already reaped must not be signalled:
            // its pid may belong to another process by now.
            if !matches!(child.try_wait(), Ok(Some(_))) {
                let _ = child.kill();
            }
            let _ = child.wait();
        };
    }
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

/// The frontend parsed `bytes` of a session's output.
#[tauri::command]
pub fn term_ack<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    id: String,
    bytes: u64,
) -> Result<(), String> {
    let owner = webview_command_owner(&webview, &project_id)?;
    ack_terminal(&owner, &id, bytes)
}

fn ack_terminal(owner: &SessionOwner, id: &str, bytes: u64) -> Result<(), String> {
    let flow = {
        let sessions = SESSIONS.lock().expect("terminal registry poisoned");
        Arc::clone(
            &sessions
                .as_ref()
                .ok_or_else(|| "terminal session is not open".to_string())?
                .get(id, owner)?
                .flow,
        )
    };
    flow.ack(usize::try_from(bytes).unwrap_or(usize::MAX));
    Ok(())
}

/// Which of the project's terminals (all, or `ids`) run a program besides
/// their shell. Only busy terminals are listed.
#[tauri::command]
pub async fn term_foreground<R: Runtime>(
    webview: Webview<R>,
    project_id: String,
    ids: Option<Vec<String>>,
) -> Result<Vec<TerminalJob>, String> {
    let owner = webview_command_owner(&webview, &project_id)?;
    let probes = foreground_probes(&owner, ids.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        probes
            .into_iter()
            .filter_map(ForegroundProbe::job)
            .collect()
    })
    .await
    .map_err(|error| format!("failed to check the terminals: {error}"))
}

/// What the busy check needs from one session, taken under the registry
/// lock so the slower process queries run without it.
struct ForegroundProbe {
    id: String,
    shell_pid: u32,
    #[cfg(unix)]
    master: SharedMaster,
    #[cfg(windows)]
    processes: std::io::Result<Vec<u32>>,
}

fn foreground_probes(owner: &SessionOwner, ids: Option<&[String]>) -> Vec<ForegroundProbe> {
    let sessions = SESSIONS.lock().expect("terminal registry poisoned");
    let Some(registry) = sessions.as_ref() else {
        return Vec::new();
    };
    registry
        .owned(owner)
        .filter(|(id, _)| ids.is_none_or(|wanted| wanted.iter().any(|candidate| candidate == id)))
        .map(|(id, session)| ForegroundProbe {
            id: id.to_string(),
            shell_pid: session.shell_pid,
            #[cfg(unix)]
            master: Arc::clone(&session.master),
            #[cfg(windows)]
            processes: session.containment.process_ids(),
        })
        .collect()
}

impl ForegroundProbe {
    #[cfg(unix)]
    fn job(self) -> Option<TerminalJob> {
        let foreground = self
            .master
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .process_group_leader();
        let group = jobs::unix_foreground_group(self.shell_pid as i32, foreground)?;
        Some(TerminalJob {
            id: self.id,
            process: crate::proc::process_name(group).map(|name| jobs::display_process_name(&name)),
        })
    }

    #[cfg(windows)]
    fn job(self) -> Option<TerminalJob> {
        let processes: Vec<(u32, String)> = self
            .processes
            .ok()?
            .into_iter()
            .map(|pid| {
                (
                    pid,
                    crate::proc::process_image_name(pid).unwrap_or_default(),
                )
            })
            .collect();
        let image = jobs::windows_foreground_process(self.shell_pid, &processes)?;
        let name = jobs::display_process_name(&image);
        Some(TerminalJob {
            id: self.id,
            process: (!name.is_empty()).then_some(name),
        })
    }
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
    let master = master.lock().unwrap_or_else(PoisonError::into_inner);
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
mod tests;
