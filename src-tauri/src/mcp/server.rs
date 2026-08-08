//! Authenticated localhost MCP endpoint. Project file tools can continue in
//! Rust after the renderer exits. Tools that need the interface are forwarded
//! only while a fresh renderer session is available.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::{to_bytes, Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch, Mutex, OwnedSemaphorePermit, Semaphore};

use super::protocol::{dispatch, rpc_error, rpc_result, RpcOutcome, ToolMeta};
use crate::paths;

/// Upper bound for one forwarded tool call: compiles and human approvals are
/// slow; anything past this returns a JSON-RPC error to the client.
const CALL_TIMEOUT: Duration = Duration::from_secs(300);
const REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(30);
// `write_file` accepts up to 16 MiB. Four MiB of JSON envelope headroom keeps
// that contract while bounding retained request memory to 160 MiB total.
const MAX_REQUEST_BODY_BYTES: usize = 20 * 1024 * 1024;
const MAX_AUTHENTICATED_REQUESTS: usize = 8;
const MAX_PENDING_FORWARD_CALLS: usize = 16;
const MAX_ACTIVITY_TOOL_NAME_CHARS: usize = 128;
const RENDERER_LEASE_TTL: Duration = Duration::from_secs(45);
const CANCEL_REASON_CLIENT_DISCONNECTED: &str = "client-disconnected";
const CANCEL_REASON_TIMEOUT: &str = "timeout";

const INSTRUCTIONS: &str = "Oleafly is a local-first LaTeX editor. These tools prefer the project open in the app and can use the most recently updated valid library project when no window is connected. Start with get_status to see the selected project. Use list_files or project_map to orient, then read and edit files and call compile. Destructive edits may pause for the user to approve inside Oleafly.";

pub struct McpState {
    /// Serializes user-facing start/stop/restart/token commands through their
    /// config writes. The inner lifecycle lock only covers listener state, so
    /// releasing it before persistence would let competing intents overtake.
    pub(crate) control: Mutex<()>,
    pub lifecycle: Mutex<()>,
    /// Tool metadata pushed by the webview at startup (and on policy change).
    pub registry: Mutex<Vec<ToolMeta>>,
    /// In-flight forwarded calls awaiting a webview result.
    pub(crate) pending: std::sync::Mutex<HashMap<u64, PendingCall>>,
    pub call_seq: AtomicU64,
    /// Changes on every start, stop, credential, and registry transition.
    /// Forwarded calls retain the epoch they were admitted under so stale
    /// renderer results can never cross one of those boundaries.
    pub(crate) epoch: AtomicU64,
    /// A non-empty renderer registry has been received at least once. The
    /// listener may bind before this happens, but it is not ready or published.
    pub(crate) registry_initialized: AtomicBool,
    /// The running epoch whose discovery file and started event have been
    /// published. Zero means the bound listener is intentionally not ready.
    pub(crate) published_epoch: AtomicU64,
    /// Monotonic renderer incarnation. Every forwarded request/result is bound
    /// to this value so a reloaded webview cannot answer work emitted to its
    /// predecessor.
    pub(crate) active_renderer_session: AtomicU64,
    renderer_session_seq: AtomicU64,
    renderer_lease: std::sync::Mutex<Option<RendererLease>>,
    /// One bounded supervisor for the active renderer incarnation. Completed
    /// handles are replaced on the next begin; they never accumulate.
    renderer_lease_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    request_slots: Arc<Semaphore>,
    pub token: Mutex<Option<String>>,
    /// Present while the server runs; sending true triggers graceful shutdown.
    pub shutdown: Mutex<Option<watch::Sender<bool>>>,
    pub bound_port: Mutex<Option<u16>>,
    pub active_project: Mutex<Option<String>>,
    /// The monitor owns the actual Axum JoinHandle and signals this completion
    /// channel before it attempts lifecycle cleanup. Stop can therefore wait
    /// while holding `lifecycle` without deadlocking the monitor.
    serve_instance: Mutex<Option<ServeInstance>>,
    serve_seq: AtomicU64,
}

#[derive(Clone, Copy, Debug)]
struct RendererLease {
    session: u64,
    deadline: Instant,
    expiration_revoked: bool,
}

struct ServeInstance {
    id: u64,
    completed: oneshot::Receiver<()>,
}

pub(crate) enum PendingReply {
    Result(Value),
    ServerStopped,
    Revoked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PendingInterruption {
    ServerStopped,
    Revoked,
}

pub(crate) struct PendingCall {
    pub(crate) epoch: u64,
    pub(crate) renderer_session: u64,
    pub(crate) sender: oneshot::Sender<PendingReply>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            control: Mutex::new(()),
            lifecycle: Mutex::new(()),
            registry: Mutex::new(Vec::new()),
            pending: std::sync::Mutex::new(HashMap::new()),
            call_seq: AtomicU64::new(0),
            epoch: AtomicU64::new(0),
            registry_initialized: AtomicBool::new(false),
            published_epoch: AtomicU64::new(0),
            active_renderer_session: AtomicU64::new(0),
            renderer_session_seq: AtomicU64::new(0),
            renderer_lease: std::sync::Mutex::new(None),
            renderer_lease_task: Mutex::new(None),
            request_slots: Arc::new(Semaphore::new(MAX_AUTHENTICATED_REQUESTS)),
            token: Mutex::new(None),
            shutdown: Mutex::new(None),
            bound_port: Mutex::new(None),
            active_project: Mutex::new(None),
            serve_instance: Mutex::new(None),
            serve_seq: AtomicU64::new(0),
        }
    }
}

fn lock_pending(state: &McpState) -> std::sync::MutexGuard<'_, HashMap<u64, PendingCall>> {
    state
        .pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_renderer_lease(state: &McpState) -> std::sync::MutexGuard<'_, Option<RendererLease>> {
    state
        .renderer_lease
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn next_nonzero_sequence(sequence: &AtomicU64, label: &str) -> Result<u64, String> {
    sequence
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current.checked_add(1)
        })
        .map(|previous| previous + 1)
        .map_err(|_| format!("{label} sequence is exhausted"))
}

fn activate_renderer_lease_at(state: &McpState, session: u64, now: Instant) {
    // Publish the session only after its deadline exists. Readers can observe
    // either the old lease or a temporary mismatch, both of which fail closed.
    *lock_renderer_lease(state) = Some(RendererLease {
        session,
        deadline: now + RENDERER_LEASE_TTL,
        expiration_revoked: false,
    });
    state
        .active_renderer_session
        .store(session, Ordering::Release);
}

fn renderer_session_is_fresh_at(state: &McpState, session: u64, now: Instant) -> bool {
    if session == 0 || state.active_renderer_session.load(Ordering::Acquire) != session {
        return false;
    }
    lock_renderer_lease(state)
        .as_ref()
        .is_some_and(|lease| lease.session == session && lease.deadline > now)
}

pub(crate) fn renderer_session_is_fresh(state: &McpState, session: u64) -> bool {
    renderer_session_is_fresh_at(state, session, Instant::now())
}

/// Returns `(was_expired, needs_revocation)`. An active (non-superseded)
/// renderer may recover after OS sleep or timer throttling; callers revoke an
/// unprocessed expiry, re-arm the supervisor, and republish as needed.
fn renew_renderer_lease_at(
    state: &McpState,
    session: u64,
    now: Instant,
) -> Result<(bool, bool), String> {
    if session == 0 || state.active_renderer_session.load(Ordering::Acquire) != session {
        return Err("stale MCP renderer session".into());
    }
    let mut lease = lock_renderer_lease(state);
    let Some(active) = lease.as_mut() else {
        return Err("MCP renderer lease is unavailable".into());
    };
    if active.session != session {
        return Err("stale MCP renderer session".into());
    }
    let was_expired = active.deadline <= now;
    let needs_revocation = was_expired && !active.expiration_revoked;
    active.deadline = now + RENDERER_LEASE_TTL;
    active.expiration_revoked = false;
    Ok((was_expired, needs_revocation))
}

fn renderer_lease_expired_at(state: &McpState, session: u64, now: Instant) -> bool {
    state.active_renderer_session.load(Ordering::Acquire) == session
        && lock_renderer_lease(state)
            .as_ref()
            .is_some_and(|active| active.session == session && active.deadline <= now)
}

fn mark_renderer_expiration_revoked_at(state: &McpState, session: u64, now: Instant) -> bool {
    let mut lease = lock_renderer_lease(state);
    let Some(active) = lease.as_mut().filter(|active| active.session == session) else {
        return false;
    };
    if state.active_renderer_session.load(Ordering::Acquire) != session
        || active.deadline > now
        || active.expiration_revoked
    {
        return false;
    }
    active.expiration_revoked = true;
    true
}

fn acquire_request_slot(state: &McpState) -> Result<OwnedSemaphorePermit, ()> {
    state
        .request_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ())
}

type CancellationEmitter = Box<dyn Fn(u64, u64, &'static str) + Send + Sync>;

struct PendingRegistration<'a> {
    state: &'a McpState,
    call_id: u64,
    epoch: u64,
    renderer_session: u64,
    cancellation_reason: &'static str,
    emit_cancellation: Option<CancellationEmitter>,
}

impl PendingRegistration<'_> {
    fn mark_timed_out(&mut self) {
        self.cancellation_reason = CANCEL_REASON_TIMEOUT;
    }
}

impl Drop for PendingRegistration<'_> {
    fn drop(&mut self) {
        let removed = {
            let mut pending = lock_pending(self.state);
            if pending.get(&self.call_id).is_some_and(|call| {
                call.epoch == self.epoch && call.renderer_session == self.renderer_session
            }) {
                pending.remove(&self.call_id);
                true
            } else {
                false
            }
        };
        // Emitting while holding the pending mutex could deadlock a renderer
        // reply. The removal is atomic; notification happens immediately after
        // the guard is released.
        if !removed {
            return;
        }
        if let Some(emit) = self.emit_cancellation.take() {
            emit(self.call_id, self.epoch, self.cancellation_reason);
        }
    }
}

/// Register and emit as one critical section. Stop takes the same pending lock,
/// so event order is always tool-call then server-stopped; a call can never be
/// emitted into the renderer after its epoch was invalidated.
fn register_pending<'a, Emit>(
    state: &'a McpState,
    epoch: u64,
    renderer_session: u64,
    emit: Emit,
    emit_cancellation: Option<CancellationEmitter>,
) -> Result<(oneshot::Receiver<PendingReply>, PendingRegistration<'a>), String>
where
    Emit: FnOnce(u64) -> Result<(), String>,
{
    let mut pending = lock_pending(state);
    if state.epoch.load(Ordering::Acquire) != epoch
        || !renderer_session_is_fresh(state, renderer_session)
    {
        return Err("MCP request authorization changed before the tool call could start".into());
    }
    if pending.len() >= MAX_PENDING_FORWARD_CALLS {
        return Err(format!(
            "too many forwarded MCP tool calls are pending (limit {MAX_PENDING_FORWARD_CALLS})"
        ));
    }
    let call_id = state.call_seq.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    pending.insert(
        call_id,
        PendingCall {
            epoch,
            renderer_session,
            sender,
        },
    );
    if let Err(error) = emit(call_id) {
        pending.remove(&call_id);
        return Err(error);
    }
    drop(pending);
    Ok((
        receiver,
        PendingRegistration {
            state,
            call_id,
            epoch,
            renderer_session,
            cancellation_reason: CANCEL_REASON_CLIENT_DISCONNECTED,
            emit_cancellation,
        },
    ))
}

pub(crate) fn take_pending_result(
    state: &McpState,
    call_id: u64,
    renderer_session: u64,
) -> Option<PendingCall> {
    let mut pending = lock_pending(state);
    let current_epoch = state.epoch.load(Ordering::Acquire);
    let current_renderer_session = state.active_renderer_session.load(Ordering::Acquire);
    let matches_current = pending.get(&call_id).is_some_and(|call| {
        call.epoch == current_epoch
            && call.renderer_session == renderer_session
            && renderer_session == current_renderer_session
            && renderer_session_is_fresh(state, renderer_session)
    });
    matches_current.then(|| pending.remove(&call_id)).flatten()
}

fn tool_call_cancelled_payload(
    call_id: u64,
    epoch: u64,
    renderer_session: u64,
    reason: &'static str,
) -> Value {
    json!({
        "callId": call_id,
        "epoch": epoch,
        "rendererSession": renderer_session,
        "reason": reason,
    })
}

/// Advance the authorization epoch and wake every forwarded HTTP request. The
/// lifecycle event is emitted while the pending registry is locked and before
/// any interruption reply is delivered, allowing the renderer to discard its
/// queued work before HTTP callers resume.
pub(crate) fn invalidate_pending<Emit>(
    state: &McpState,
    interruption: PendingInterruption,
    emit: Emit,
) -> (u64, u64)
where
    Emit: FnOnce(u64),
{
    let mut pending = lock_pending(state);
    let revoked_epoch = state.epoch.fetch_add(1, Ordering::AcqRel);
    let next_epoch = state.epoch.load(Ordering::Acquire);
    emit(revoked_epoch);
    let calls = std::mem::take(&mut *pending);
    drop(pending);
    for (_, call) in calls {
        let reply = match interruption {
            PendingInterruption::ServerStopped => PendingReply::ServerStopped,
            PendingInterruption::Revoked => PendingReply::Revoked,
        };
        let _ = call.sender.send(reply);
    }
    (revoked_epoch, next_epoch)
}

fn renderer_revocation_payload(epoch: u64, reason: &'static str, renderer_session: u64) -> Value {
    json!({
        "epoch": epoch,
        "reason": reason,
        "rendererSession": renderer_session,
    })
}

fn log_discovery_cleanup_error(context: &str, error: &str) {
    let message = format!("MCP {context}: {error}");
    #[cfg(debug_assertions)]
    eprintln!("{message}");
    let _ = crate::project::append_app_log(message);
}

fn combine_cleanup_error(
    primary: String,
    cleanup: Result<(), String>,
    cleanup_context: &str,
) -> String {
    match cleanup {
        Ok(()) => primary,
        Err(cleanup_error) => format!("{primary}. {cleanup_context}: {cleanup_error}"),
    }
}

async fn clear_renderer_registry(state: &McpState) {
    state.registry_initialized.store(false, Ordering::Release);
    state.registry.lock().await.clear();
}

/// Caller holds both lifecycle and token/admission barriers.
fn revoke_expired_renderer_authorization_locked(
    app: &AppHandle,
    state: &McpState,
    renderer_session: u64,
) {
    state.published_epoch.store(0, Ordering::Release);
    invalidate_pending(state, PendingInterruption::Revoked, |epoch| {
        let _ = app.emit(
            "mcp:requests-revoked",
            renderer_revocation_payload(epoch, "renderer-lease-expired", renderer_session),
        );
    });
    if let Err(error) = remove_discovery_file_checked() {
        log_discovery_cleanup_error("renderer lease expiry cleanup failed", &error);
    }
}

async fn replace_renderer_supervisor_locked(
    app: &AppHandle,
    state: &McpState,
    renderer_session: u64,
) {
    if let Some(previous) = state.renderer_lease_task.lock().await.take() {
        previous.abort();
    }
    let supervisor_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        supervise_renderer_lease(supervisor_app, renderer_session).await;
    });
    *state.renderer_lease_task.lock().await = Some(task);
}

async fn supervise_renderer_lease(app: AppHandle, renderer_session: u64) {
    loop {
        let deadline = {
            let state = app.state::<McpState>();
            if state.active_renderer_session.load(Ordering::Acquire) != renderer_session {
                return;
            }
            let lease = lock_renderer_lease(&state);
            let Some(lease) = lease
                .as_ref()
                .filter(|lease| lease.session == renderer_session)
            else {
                return;
            };
            lease.deadline
        };
        tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await;

        let state = app.state::<McpState>();
        let _lifecycle = state.lifecycle.lock().await;
        if !renderer_lease_expired_at(&state, renderer_session, Instant::now()) {
            continue;
        }

        // Keep the session and registry so an otherwise healthy renderer can
        // recover after OS sleep or timer throttling. Authorization and
        // discovery still fail closed until that same session heartbeats.
        let _token = state.token.lock().await;
        let now = Instant::now();
        if !mark_renderer_expiration_revoked_at(&state, renderer_session, now) {
            continue;
        }
        revoke_expired_renderer_authorization_locked(&app, &state, renderer_session);
        return;
    }
}

pub(crate) async fn begin_renderer_session(app: &AppHandle) -> Result<u64, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    let renderer_session =
        next_nonzero_sequence(&state.renderer_session_seq, "MCP renderer session")?;

    if let Some(previous) = state.renderer_lease_task.lock().await.take() {
        previous.abort();
    }
    let _token = state.token.lock().await;
    activate_renderer_lease_at(&state, renderer_session, Instant::now());
    clear_renderer_registry(&state).await;
    *state.active_project.lock().await = None;
    state.published_epoch.store(0, Ordering::Release);
    invalidate_pending(&state, PendingInterruption::Revoked, |epoch| {
        let _ = app.emit(
            "mcp:requests-revoked",
            renderer_revocation_payload(epoch, "renderer-session-changed", renderer_session),
        );
    });
    if let Err(error) = remove_discovery_file_checked() {
        log_discovery_cleanup_error("renderer session cleanup failed", &error);
    }
    drop(_token);
    replace_renderer_supervisor_locked(app, &state, renderer_session).await;
    Ok(renderer_session)
}

pub(crate) async fn renderer_heartbeat(
    app: &AppHandle,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    // Holding the admission barrier makes an overdue heartbeat linearize as an
    // expiry revocation followed by renewal; no request can slip through using
    // the old epoch after the deadline.
    let token = state.token.lock().await;
    let (was_expired, needs_revocation) =
        renew_renderer_lease_at(&state, renderer_session, Instant::now())?;
    if needs_revocation {
        revoke_expired_renderer_authorization_locked(app, &state, renderer_session);
    }
    drop(token);
    if was_expired {
        replace_renderer_supervisor_locked(app, &state, renderer_session).await;
    }
    // Normally this is a no-op. After expiry it atomically restores discovery
    // and readiness only if the retained registry still belongs to this session.
    publish_if_ready_locked(app, &state).await?;
    Ok(())
}

pub(crate) async fn end_renderer_session(
    app: &AppHandle,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if state.active_renderer_session.load(Ordering::Acquire) != renderer_session {
        return Ok(());
    }
    if let Some(supervisor) = state.renderer_lease_task.lock().await.take() {
        supervisor.abort();
    }
    let _token = state.token.lock().await;
    *lock_renderer_lease(&state) = None;
    state.active_renderer_session.store(0, Ordering::Release);
    *state.active_project.lock().await = None;
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let (revoked_epoch, next_epoch) =
        invalidate_pending(&state, PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                renderer_revocation_payload(epoch, "renderer-session-changed", renderer_session),
            );
        });
    if published_epoch == revoked_epoch {
        state.published_epoch.store(next_epoch, Ordering::Release);
    } else if published_epoch != 0 {
        state.published_epoch.store(0, Ordering::Release);
    }
    // Keep the last validated registry, publication epoch, token, and discovery
    // file. This lets native project tools remain available after the renderer
    // exits. A later renderer session clears and republishes the registry before
    // it can receive forwarded calls.
    Ok(())
}

/// Pure readiness decision used by both start and registration. Lifecycle
/// callers serialize the state transitions; this helper makes both arrival
/// orders explicit and unit-testable.
fn publication_candidate(
    running_epoch: Option<u64>,
    registry_initialized: bool,
    renderer_lease_fresh: bool,
    published_epoch: u64,
) -> Option<u64> {
    running_epoch
        .filter(|epoch| registry_initialized && renderer_lease_fresh && published_epoch != *epoch)
}

fn admission_is_current(captured_epoch: u64, current_epoch: u64, published_epoch: u64) -> bool {
    captured_epoch != 0 && captured_epoch == current_epoch && captured_epoch == published_epoch
}

/// Publish a bound listener once a stable, non-empty renderer registry exists.
/// The caller must hold `state.lifecycle`, which serializes start, stop, tool
/// registration, and credential rotation.
pub(crate) async fn publish_if_ready_locked(
    app: &AppHandle,
    state: &McpState,
) -> Result<bool, String> {
    let running = state.shutdown.lock().await.is_some();
    let running_epoch = running.then(|| state.epoch.load(Ordering::Acquire));
    let renderer_session = state.active_renderer_session.load(Ordering::Acquire);
    let Some(epoch) = publication_candidate(
        running_epoch,
        state.registry_initialized.load(Ordering::Acquire),
        renderer_session_is_fresh(state, renderer_session),
        state.published_epoch.load(Ordering::Acquire),
    ) else {
        return Ok(false);
    };
    let port = state
        .bound_port
        .lock()
        .await
        .ok_or_else(|| "MCP listener has no bound port".to_string())?;
    let token = state
        .token
        .lock()
        .await
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "MCP listener has no active credential".to_string())?;

    // Keep admission closed until both publication and the renderer lifecycle
    // notification have succeeded. A client racing the atomic rename receives
    // a retryable 503 rather than seeing an empty tool surface.
    write_discovery_file(port, &token)?;
    if let Err(error) = app.emit(
        "mcp:server-started",
        json!({ "epoch": epoch, "port": port }),
    ) {
        return Err(combine_cleanup_error(
            format!("failed to publish MCP server readiness: {error}"),
            remove_discovery_file_checked(),
            "Also failed to remove the unpublished MCP discovery file",
        ));
    }
    state.published_epoch.store(epoch, Ordering::Release);
    Ok(true)
}

async fn collect_body_limited(body: Body, limit: usize) -> Result<Bytes, StatusCode> {
    collect_body_limited_with_timeout(body, limit, REQUEST_BODY_TIMEOUT).await
}

async fn collect_body_limited_with_timeout(
    body: Body,
    limit: usize,
    timeout: Duration,
) -> Result<Bytes, StatusCode> {
    tokio::time::timeout(timeout, to_bytes(body, limit))
        .await
        .map_err(|_| StatusCode::REQUEST_TIMEOUT)?
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE)
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn authorized(headers: &HeaderMap, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let Some(v) = headers.get("authorization").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(presented) = v.strip_prefix("Bearer ") else {
        return false;
    };
    constant_time_eq(presented.as_bytes(), token.as_bytes())
}

/// Browsers always attach an Origin to cross-origin fetches; native MCP
/// clients never do. Rejecting every Origin blocks hostile web pages and
/// DNS-rebinding regardless of what they put in the header.
pub fn origin_allowed(headers: &HeaderMap) -> bool {
    headers.get("origin").is_none()
}

pub fn host_allowed(headers: &HeaderMap) -> bool {
    let Some(h) = headers.get("host").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let (host, port) = if let Some(rest) = h.strip_prefix('[') {
        let Some((host, suffix)) = rest.split_once(']') else {
            return false;
        };
        let port = if suffix.is_empty() {
            None
        } else if let Some(port) = suffix.strip_prefix(':') {
            Some(port)
        } else {
            return false;
        };
        (host, port)
    } else {
        h.split_once(':')
            .map_or((h, None), |(host, port)| (host, Some(port)))
    };
    let port_allowed = match port {
        None => true,
        Some(port) => {
            !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit())
                && port.parse::<u16>().is_ok()
        }
    };
    port_allowed && (matches!(host, "127.0.0.1" | "::1") || host.eq_ignore_ascii_case("localhost"))
}

fn effective_policy(config: Option<(String, bool)>) -> (String, bool) {
    config.unwrap_or_else(|| ("ask".to_string(), true))
}

fn bounded_activity_tool_name(name: &str) -> String {
    name.chars().take(MAX_ACTIVITY_TOOL_NAME_CHARS).collect()
}

struct NativeActivity {
    app: AppHandle,
    activity_id: String,
    epoch: u64,
    name: String,
    started: bool,
    finished: bool,
}

impl NativeActivity {
    fn start(app: &AppHandle, state: &McpState, epoch: u64, name: &str) -> Self {
        let activity_id = state.call_seq.fetch_add(1, Ordering::Relaxed).to_string();
        let name = bounded_activity_tool_name(name);
        let started = app
            .emit(
                "mcp:native-tool-started",
                json!({
                    "activityId": activity_id,
                    "epoch": epoch,
                    "name": name,
                }),
            )
            .is_ok();
        Self {
            app: app.clone(),
            activity_id,
            epoch,
            name,
            started,
            finished: false,
        }
    }

    fn finish(&mut self, ok: bool, cancelled: bool) {
        if self.finished {
            return;
        }
        if self.started {
            let _ = self.app.emit(
                "mcp:native-tool-finished",
                json!({
                    "activityId": self.activity_id,
                    "epoch": self.epoch,
                    "name": self.name,
                    "ok": ok,
                    "cancelled": cancelled,
                }),
            );
        }
        let _ = crate::project::append_app_log(format!(
            "[mcp] {} {}",
            self.name,
            if ok { "ok" } else { "error" }
        ));
        self.finished = true;
    }
}

impl Drop for NativeActivity {
    fn drop(&mut self) {
        self.finish(false, true);
    }
}

async fn mcp_post(State(app): State<AppHandle>, request: Request) -> Response {
    let state = app.state::<McpState>();
    let headers = request.headers();
    if !host_allowed(headers) || !origin_allowed(headers) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    // Authentication and epoch capture share the credential lock. Credential
    // rotation takes this same lock while advancing the epoch, so the pair is
    // an atomic admission snapshot rather than two independently racing reads.
    let (epoch, renderer_session) = {
        let token = state.token.lock().await;
        let Some(token) = token.as_deref() else {
            return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
        };
        if !authorized(headers, token) {
            return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
        }
        let epoch = state.epoch.load(Ordering::Acquire);
        let renderer_session = state.active_renderer_session.load(Ordering::Acquire);
        if !admission_is_current(epoch, epoch, state.published_epoch.load(Ordering::Acquire)) {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "MCP server is not ready. Retry shortly.",
            )
                .into_response();
        }
        (epoch, renderer_session)
    };
    let _request_slot = match acquire_request_slot(&state) {
        Ok(permit) => permit,
        Err(()) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                "too many concurrent MCP requests",
            )
                .into_response()
        }
    };
    // The raw request body is deliberately not extracted by Axum: doing so
    // would allocate it before authentication and concurrency admission.
    let body = match collect_body_limited(request.into_body(), MAX_REQUEST_BODY_BYTES).await {
        Ok(body) => body,
        Err(StatusCode::REQUEST_TIMEOUT) => {
            return (StatusCode::REQUEST_TIMEOUT, "MCP request body timed out").into_response()
        }
        Err(status) => return (status, "MCP request body is too large").into_response(),
    };
    let msg: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::OK,
                Json(rpc_error(Value::Null, -32700, "parse error")),
            )
                .into_response()
        }
    };
    drop(body);
    if msg.is_array() {
        // Batching was removed from the MCP spec in 2025-06-18.
        return (
            StatusCode::OK,
            Json(rpc_error(
                Value::Null,
                -32600,
                "batch requests not supported",
            )),
        )
            .into_response();
    }
    // Re-enter the credential barrier after the potentially slow body upload.
    // A request authenticated immediately before token regeneration cannot
    // dispatch or register work in the replacement epoch.
    let outcome = {
        let _token = state.token.lock().await;
        if !admission_is_current(
            epoch,
            state.epoch.load(Ordering::Acquire),
            state.published_epoch.load(Ordering::Acquire),
        ) {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "MCP request authorization changed. Retry with current credentials.",
            )
                .into_response();
        }
        let tools = state.registry.lock().await.clone();
        dispatch(&msg, &tools, INSTRUCTIONS)
    };
    match outcome {
        RpcOutcome::Reply(v) => (StatusCode::OK, Json(v)).into_response(),
        RpcOutcome::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcOutcome::ForwardCall {
            id,
            name,
            arguments,
        } => {
            let config = tokio::task::spawn_blocking(|| {
                crate::config::read_config().map(|cfg| (cfg.mcp_approval_policy, cfg.mcp_read_only))
            })
            .await
            .ok()
            .and_then(|read| read.ok());
            let (policy, read_only) = effective_policy(config);
            if read_only && super::native::is_mutating(&name) {
                return (
                    StatusCode::OK,
                    Json(rpc_error(id, -32000, "tool disabled by read-only mode")),
                )
                    .into_response();
            }
            let renderer_is_fresh = renderer_session_is_fresh(&state, renderer_session);
            let native_without_renderer = !super::native::is_mutating(&name) || !renderer_is_fresh;
            if native_without_renderer && super::native::handles(&name, &policy) {
                let mut activity = NativeActivity::start(&app, &state, epoch, &name);
                let reported = state.active_project.lock().await.clone();
                let outcome = match super::native::resolve_project(&arguments, reported) {
                    Ok(project_id) => {
                        let result = super::native::call(&project_id, &name, &arguments).await;
                        (Some(project_id), result)
                    }
                    Err(error) => (None, Err(error)),
                };
                let epoch_current = state.epoch.load(Ordering::Acquire) == epoch;
                let ok = epoch_current && matches!(&outcome, (Some(_), Ok(_)));
                activity.finish(ok, !epoch_current);
                if !epoch_current {
                    return (
                        StatusCode::OK,
                        Json(rpc_error(
                            id,
                            -32000,
                            "MCP request was revoked before the tool call completed",
                        )),
                    )
                        .into_response();
                }
                return match outcome {
                    (Some(project_id), Ok(outcome)) => {
                        if let Some(change) = outcome.change {
                            let paths = match change["kind"].as_str() {
                                Some("rename") => {
                                    vec![change["from"].clone(), change["to"].clone()]
                                }
                                _ => vec![change["path"].clone()],
                            };
                            let _ = app.emit(
                                "project:files-changed",
                                json!({
                                    "projectId": project_id,
                                    "paths": paths,
                                    "from": "mcp-native",
                                    "change": change,
                                }),
                            );
                        }
                        (StatusCode::OK, Json(rpc_result(id, outcome.result))).into_response()
                    }
                    (_, Err(error)) => {
                        (StatusCode::OK, Json(rpc_error(id, -32000, &error))).into_response()
                    }
                    (None, Ok(_)) => (
                        StatusCode::OK,
                        Json(rpc_error(id, -32000, "project resolution failed")),
                    )
                        .into_response(),
                };
            }
            if !renderer_is_fresh {
                return (
                    StatusCode::OK,
                    Json(rpc_error(
                        id,
                        -32000,
                        "this tool requires an active Oleafly window",
                    )),
                )
                    .into_response();
            }
            let cancellation_app = app.clone();
            let registration = register_pending(
                &state,
                epoch,
                renderer_session,
                |call_id| {
                    app.emit(
                        "mcp:tool-call",
                        json!({
                            "callId": call_id,
                            "epoch": epoch,
                            "rendererSession": renderer_session,
                            "name": name,
                            "arguments": arguments,
                        }),
                    )
                    .map_err(|_| "app bridge unavailable".to_string())
                },
                Some(Box::new(move |call_id, epoch, reason| {
                    let _ = cancellation_app.emit(
                        "mcp:tool-call-cancelled",
                        tool_call_cancelled_payload(call_id, epoch, renderer_session, reason),
                    );
                })),
            );
            let (receiver, mut registration) = match registration {
                Ok(registration) => registration,
                Err(error) => {
                    return (StatusCode::OK, Json(rpc_error(id, -32000, &error))).into_response()
                }
            };
            match tokio::time::timeout(CALL_TIMEOUT, receiver).await {
                Ok(Ok(PendingReply::Result(result))) => {
                    (StatusCode::OK, Json(rpc_result(id, result))).into_response()
                }
                Ok(Ok(PendingReply::ServerStopped)) | Ok(Err(_)) => (
                    StatusCode::OK,
                    Json(rpc_error(
                        id,
                        -32000,
                        "MCP server stopped before the tool call completed",
                    )),
                )
                    .into_response(),
                Ok(Ok(PendingReply::Revoked)) => (
                    StatusCode::OK,
                    Json(rpc_error(
                        id,
                        -32000,
                        "MCP request authorization was revoked. Retry the tool call.",
                    )),
                )
                    .into_response(),
                Err(_) => {
                    registration.mark_timed_out();
                    (
                        StatusCode::OK,
                        Json(rpc_error(
                            id,
                            -32000,
                            "tool call timed out waiting for the app",
                        )),
                    )
                        .into_response()
                }
            }
        }
    }
}

fn serve_exit_is_current(active_id: Option<u64>, exited_id: u64, shutdown_present: bool) -> bool {
    active_id == Some(exited_id) && shutdown_present
}

async fn signal_completion_before_cleanup<Cleanup, CleanupFuture>(
    completed: oneshot::Sender<()>,
    cleanup: Cleanup,
) where
    Cleanup: FnOnce() -> CleanupFuture,
    CleanupFuture: std::future::Future<Output = ()>,
{
    // Stop may await this receiver while holding `lifecycle`. The signal must
    // therefore happen before cleanup attempts to acquire that same lock.
    let _ = completed.send(());
    cleanup().await;
}

/// Claim the current listener for unexpected-exit cleanup. Caller holds
/// `lifecycle`, so the two async mutexes form one atomic lifecycle transition.
async fn claim_unexpected_serve_exit(state: &McpState, serve_id: u64) -> bool {
    let active_id = state
        .serve_instance
        .lock()
        .await
        .as_ref()
        .map(|instance| instance.id);
    let shutdown_present = state.shutdown.lock().await.is_some();
    if !serve_exit_is_current(active_id, serve_id, shutdown_present) {
        return false;
    }
    state.serve_instance.lock().await.take();
    state.shutdown.lock().await.take();
    true
}

async fn handle_serve_exit(app: AppHandle, serve_id: u64, outcome: Result<(), String>) {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if !claim_unexpected_serve_exit(&state, serve_id).await {
        return;
    }

    // The monitor signalled completion before acquiring `lifecycle`, so this
    // receiver was already ready when the claimed instance was dropped.
    let mut token = state.token.lock().await;
    *token = None;
    clear_renderer_registry(&state).await;
    let published_epoch = state.published_epoch.swap(0, Ordering::AcqRel);
    invalidate_pending(&state, PendingInterruption::ServerStopped, |epoch| {
        if published_epoch == epoch {
            let _ = app.emit("mcp:server-stopped", json!({ "epoch": epoch }));
        }
    });
    drop(token);
    *state.bound_port.lock().await = None;
    if let Err(error) = remove_discovery_file_checked() {
        log_discovery_cleanup_error("unexpected listener cleanup failed", &error);
    }
    let detail = outcome
        .err()
        .unwrap_or_else(|| "listener exited without a shutdown request".into());
    let message = format!("MCP listener terminated unexpectedly: {detail}");
    #[cfg(debug_assertions)]
    eprintln!("{message}");
    let _ = crate::project::append_app_log(message);
}

/// Start the server. Returns the bound port. Errors if already running or the
/// port is taken.
pub async fn start(app: AppHandle, port: u16) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if state.shutdown.lock().await.is_some() {
        return Err("MCP server already running".into());
    }
    let token = ensure_token()?;
    // A previous process may have crashed without cleanup. Never let its
    // credential document represent this listener before our registry is ready.
    remove_discovery_file_checked()?;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("could not bind {addr}: {e}"))?;
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let serve_id = next_nonzero_sequence(&state.serve_seq, "MCP listener")?;
    let (tx, mut rx) = watch::channel(false);
    state.epoch.fetch_add(1, Ordering::AcqRel);
    state.published_epoch.store(0, Ordering::Release);

    let router = Router::new()
        .route("/mcp", post(mcp_post))
        .with_state(app.clone());
    // Make all authorization state visible before the listener begins polling.
    // Until publication succeeds, authenticated requests receive a retryable
    // 503 because `published_epoch` remains zero.
    *state.token.lock().await = Some(token);
    *state.shutdown.lock().await = Some(tx);
    *state.bound_port.lock().await = Some(bound);
    let runner = tauri::async_runtime::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.changed().await;
            })
            .await
    });
    let (completed_tx, completed_rx) = oneshot::channel();
    let monitor_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = runner
            .await
            .map_err(|error| format!("listener task failed: {error}"))
            .and_then(|result| result.map_err(|error| error.to_string()));
        signal_completion_before_cleanup(completed_tx, || async move {
            handle_serve_exit(monitor_app, serve_id, outcome).await;
        })
        .await;
    });
    *state.serve_instance.lock().await = Some(ServeInstance {
        id: serve_id,
        completed: completed_rx,
    });
    if let Err(error) = publish_if_ready_locked(&app, &state).await {
        // Publication is part of startup when registration arrived first. Roll
        // the listener back completely instead of leaving a half-ready server.
        state.published_epoch.store(0, Ordering::Release);
        *state.token.lock().await = None;
        if let Some(shutdown) = state.shutdown.lock().await.take() {
            let _ = shutdown.send(true);
        }
        invalidate_pending(&state, PendingInterruption::ServerStopped, |_| {});
        let instance = state.serve_instance.lock().await.take();
        if let Some(instance) = instance {
            let _ = tokio::time::timeout(Duration::from_secs(3), instance.completed).await;
        }
        *state.bound_port.lock().await = None;
        return Err(combine_cleanup_error(
            error,
            remove_discovery_file_checked(),
            "Startup rollback also failed to remove the MCP discovery file",
        ));
    }
    Ok(bound)
}

pub async fn stop(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    let shutdown = state.shutdown.lock().await.take();
    if let Some(tx) = shutdown {
        // Block new authorization before invalidating/draining admitted calls.
        // The pending lock then makes stopped-event -> failed-call ordering
        // atomic with respect to both registration and renderer replies.
        let mut token = state.token.lock().await;
        *token = None;
        let published_epoch = state.published_epoch.swap(0, Ordering::AcqRel);
        invalidate_pending(&state, PendingInterruption::ServerStopped, |epoch| {
            if published_epoch == epoch {
                let _ = app.emit("mcp:server-stopped", json!({ "epoch": epoch }));
            }
        });
        drop(token);
        let _ = tx.send(true);
    }
    // The frontend discards its local registry on `server-stopped`. Retaining
    // this copy would let a rapid restart publish tools that the renderer can
    // no longer dispatch, so every new listener waits for fresh registration.
    clear_renderer_registry(&state).await;
    // Wait (bounded) for the serve task to finish so the listener is fully
    // released before any caller rebinds the same port. Graceful shutdown drops
    // the listener early, so this returns near-instantly in the normal case; the
    // timeout guards against a long in-flight tool call holding the drain open
    // (the detached task finishes on its own, port already freed).
    let instance = state.serve_instance.lock().await.take();
    if let Some(instance) = instance {
        let _ = tokio::time::timeout(Duration::from_secs(3), instance.completed).await;
    }
    *state.bound_port.lock().await = None;
    *state.token.lock().await = None;
    remove_discovery_file_checked()
}

/// Read the persisted token, generating and persisting one on first use.
fn ensure_token() -> Result<String, String> {
    let cfg = crate::config::read_config()?;
    if !cfg.mcp_token.is_empty() {
        return Ok(cfg.mcp_token);
    }
    let token = crate::secrets::generate_mcp_token();
    let mut updated = cfg;
    updated.mcp_token = token.clone();
    crate::config::write_config(&updated)?;
    Ok(token)
}

/// Connection info for local clients: `<data-dir>/mcp.json`, hardened to
/// owner-only (0600 on unix, current-user ACL on Windows), present only while
/// the server is running and its tool registry is ready. Documented in
/// docs/mcp.md.
fn write_discovery_file(port: u16, token: &str) -> Result<(), String> {
    let path = paths::oleafly_root()?.join("mcp.json");
    write_discovery_file_at(&path, port, token)
}

fn write_discovery_file_at(path: &std::path::Path, port: u16, token: &str) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&json!({
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "token": token,
    }))
    .map_err(|e| e.to_string())?;
    write_private_discovery(path, body.as_bytes())
}

/// Publish the bearer-token discovery document atomically. The temporary file
/// is owner-only before token bytes are written: mode 0600 at create time on
/// Unix, or an empty file whose inherited ACL is replaced and checked first on
/// Windows. Hardening failures abort startup instead of being silently ignored.
fn write_private_discovery(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let parent = path
        .parent()
        .ok_or_else(|| "MCP discovery path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create MCP discovery directory: {e}"))?;
    let temp = (0..32)
        .find_map(|_| {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let candidate =
                parent.join(format!(".mcp.json.{}.{}.tmp", std::process::id(), sequence));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                options.mode(0o600);
            }
            match options.open(&candidate) {
                Ok(file) => Some(Ok((candidate, file))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(format!(
                    "failed to create MCP discovery staging file: {error}"
                ))),
            }
        })
        .transpose()?
        .ok_or_else(|| "failed to reserve an MCP discovery staging file".to_string())?;
    let (temp_path, mut file) = temp;
    let publish = (|| -> Result<(), String> {
        harden_empty_discovery_file(&temp_path)?;
        file.write_all(bytes)
            .map_err(|e| format!("failed to write MCP discovery file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("failed to sync MCP discovery file: {e}"))?;
        drop(file);
        replace_discovery_file(&temp_path, path)
            .map_err(|e| format!("failed to publish MCP discovery file: {e}"))?;
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();
    if publish.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    publish
}

#[cfg(unix)]
fn harden_empty_discovery_file(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("failed to harden MCP discovery file permissions: {e}"))?;
    let mode = std::fs::metadata(path)
        .map_err(|e| format!("failed to verify MCP discovery file permissions: {e}"))?
        .permissions()
        .mode()
        & 0o777;
    if mode != 0o600 {
        return Err(format!(
            "MCP discovery file permissions are {mode:o}, expected 600"
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn harden_empty_discovery_file(path: &std::path::Path) -> Result<(), String> {
    use crate::proc::NoConsole as _;
    use std::process::Stdio;

    let name = std::env::var("USERNAME")
        .ok()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "cannot determine the current Windows user for MCP ACLs".to_string())?;
    let principal = std::env::var("USERDOMAIN")
        .ok()
        .filter(|domain| !domain.is_empty())
        .map_or_else(|| name.clone(), |domain| format!("{domain}\\{name}"));
    let system_root = std::env::var_os("SystemRoot")
        .filter(|root| !root.is_empty())
        .ok_or_else(|| "cannot locate the Windows system directory for MCP ACLs".to_string())?;
    let icacls = std::path::PathBuf::from(system_root)
        .join("System32")
        .join("icacls.exe");
    if !icacls.is_file() {
        return Err(format!(
            "cannot locate the Windows ACL utility at {}",
            icacls.display()
        ));
    }
    let status = std::process::Command::new(&icacls)
        .no_console()
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{principal}:(F)"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to harden MCP discovery file ACL: {e}"))?;
    if !status.success() {
        return Err(format!(
            "failed to harden MCP discovery file ACL (icacls exited with {status})"
        ));
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn harden_empty_discovery_file(_path: &std::path::Path) -> Result<(), String> {
    Err("owner-only MCP discovery files are unsupported on this platform".into())
}

#[cfg(not(windows))]
fn replace_discovery_file(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_discovery_file(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Rewrite the discovery file after a token regeneration while running.
pub fn rewrite_discovery_file(port: u16, token: &str) -> Result<(), String> {
    write_discovery_file(port, token)
}

pub fn remove_discovery_file() -> Result<(), String> {
    remove_discovery_file_checked()
}

fn remove_discovery_file_checked() -> Result<(), String> {
    let path = paths::oleafly_root()?.join("mcp.json");
    remove_discovery_file_at(&path)
}

fn remove_discovery_file_at(path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove MCP discovery file {}: {error}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    fn h(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut m = HeaderMap::new();
        for (k, v) in pairs {
            m.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                v.parse().unwrap(),
            );
        }
        m
    }

    fn activate_test_renderer(state: &McpState, renderer_session: u64) {
        activate_renderer_lease_at(state, renderer_session, Instant::now());
    }

    #[test]
    fn auth_requires_exact_bearer_token() {
        let t = "aa".repeat(32);
        assert!(authorized(
            &h(&[("authorization", &format!("Bearer {t}"))]),
            &t
        ));
        assert!(!authorized(
            &h(&[("authorization", &format!("Bearer {t}x"))]),
            &t
        ));
        assert!(!authorized(&h(&[("authorization", "Bearer ")]), &t));
        assert!(
            !authorized(&h(&[("authorization", &t)]), &t),
            "missing Bearer prefix"
        );
        assert!(!authorized(&h(&[]), &t), "missing header");
        assert!(
            !authorized(&h(&[("authorization", "Bearer ")]), ""),
            "empty configured token never authorizes"
        );
    }

    #[test]
    fn constant_time_eq_basics() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn origin_header_is_rejected() {
        // Native MCP clients send no Origin; browsers always do. Rejecting
        // every Origin blocks DNS-rebinding and hostile-page fetches.
        assert!(origin_allowed(&h(&[])));
        assert!(!origin_allowed(&h(&[("origin", "https://evil.example")])));
        assert!(!origin_allowed(&h(&[("origin", "http://127.0.0.1:5323")])));
        assert!(!origin_allowed(&h(&[("origin", "null")])));
    }

    #[test]
    fn host_must_be_loopback() {
        assert!(host_allowed(&h(&[("host", "127.0.0.1:5323")])));
        assert!(host_allowed(&h(&[("host", "localhost:5323")])));
        assert!(host_allowed(&h(&[("host", "LOCALHOST:5323")])));
        assert!(host_allowed(&h(&[("host", "127.0.0.1")])));
        assert!(host_allowed(&h(&[("host", "[::1]:5323")])));
        assert!(host_allowed(&h(&[("host", "[::1]")])));
        assert!(!host_allowed(&h(&[("host", "localhost:not-a-port")])));
        assert!(!host_allowed(&h(&[("host", "localhost:70000")])));
        assert!(!host_allowed(&h(&[("host", "[::1].attacker.example")])));
        assert!(!host_allowed(&h(&[("host", "[::1]:5323:evil")])));
        assert!(!host_allowed(&h(&[(
            "host",
            "rebind.attacker.example:5323"
        )])));
        assert!(!host_allowed(&h(&[])));
    }

    #[test]
    fn unreadable_configuration_disables_every_mutating_tool() {
        assert_eq!(effective_policy(None), ("ask".to_string(), true));
        assert_eq!(
            effective_policy(Some(("trust".to_string(), false))),
            ("trust".to_string(), false)
        );
    }

    #[test]
    fn readiness_waits_for_both_start_and_nonempty_registration_in_either_order() {
        let epoch = 7;

        // Registration arrives before the listener.
        assert_eq!(publication_candidate(None, true, true, 0), None);
        assert_eq!(
            publication_candidate(Some(epoch), true, true, 0),
            Some(epoch)
        );

        // The listener arrives before registration.
        assert_eq!(publication_candidate(Some(epoch), false, true, 0), None);
        assert_eq!(
            publication_candidate(Some(epoch), true, true, 0),
            Some(epoch)
        );

        // A stale renderer lease never publishes a retained registry.
        assert_eq!(publication_candidate(Some(epoch), true, false, 0), None);

        // Publication is single-shot within one epoch.
        assert_eq!(publication_candidate(Some(epoch), true, true, epoch), None);
    }

    #[tokio::test]
    async fn clearing_renderer_registry_closes_restart_readiness() {
        let state = McpState::default();
        state.registry_initialized.store(true, Ordering::Release);
        state.registry.lock().await.push(ToolMeta {
            name: "test".into(),
            description: "test tool".into(),
            input_schema: json!({ "type": "object" }),
        });

        clear_renderer_registry(&state).await;

        assert!(!state.registry_initialized.load(Ordering::Acquire));
        assert!(state.registry.lock().await.is_empty());
        assert_eq!(publication_candidate(Some(7), false, true, 0), None);
    }

    #[test]
    fn renderer_lease_fails_closed_at_expiry_and_same_session_can_recover() {
        let state = McpState::default();
        let now = Instant::now();
        activate_renderer_lease_at(&state, 41, now);
        assert!(renderer_session_is_fresh_at(
            &state,
            41,
            now + RENDERER_LEASE_TTL - Duration::from_millis(1)
        ));
        assert!(!renderer_session_is_fresh_at(
            &state,
            41,
            now + RENDERER_LEASE_TTL
        ));
        assert!(renew_renderer_lease_at(&state, 40, now).is_err());
        assert_eq!(
            renew_renderer_lease_at(&state, 41, now + RENDERER_LEASE_TTL)
                .expect("the active session may recover after sleep"),
            (true, true)
        );
        assert!(renderer_session_is_fresh_at(
            &state,
            41,
            now + RENDERER_LEASE_TTL
        ));

        activate_renderer_lease_at(&state, 42, now);
        assert!(!renderer_session_is_fresh_at(&state, 41, now));
        assert!(renew_renderer_lease_at(&state, 41, now).is_err());
    }

    #[test]
    fn renderer_expiry_is_revoked_once_before_recovery() {
        let state = McpState::default();
        let now = Instant::now();
        activate_renderer_lease_at(&state, 9, now);
        let expired_at = now + RENDERER_LEASE_TTL;
        assert!(mark_renderer_expiration_revoked_at(&state, 9, expired_at));
        assert!(!mark_renderer_expiration_revoked_at(&state, 9, expired_at));
        assert_eq!(
            renew_renderer_lease_at(&state, 9, expired_at).unwrap(),
            (true, false),
            "a supervisor-drained expiry must not be revoked twice by recovery"
        );
    }

    #[test]
    fn listener_exit_cleanup_is_bound_to_the_listener_incarnation_not_auth_epoch() {
        assert!(serve_exit_is_current(Some(7), 7, true));
        assert!(!serve_exit_is_current(Some(8), 7, true));
        assert!(!serve_exit_is_current(Some(7), 7, false));
    }

    #[tokio::test]
    async fn unexpected_exit_claim_clears_only_the_current_listener() {
        let state = McpState::default();
        let (shutdown, _shutdown_rx) = watch::channel(false);
        *state.shutdown.lock().await = Some(shutdown);
        let (_completed_tx, completed) = oneshot::channel();
        *state.serve_instance.lock().await = Some(ServeInstance { id: 8, completed });

        assert!(!claim_unexpected_serve_exit(&state, 7).await);
        assert!(state.shutdown.lock().await.is_some());
        assert_eq!(
            state
                .serve_instance
                .lock()
                .await
                .as_ref()
                .map(|instance| instance.id),
            Some(8)
        );

        assert!(claim_unexpected_serve_exit(&state, 8).await);
        assert!(state.shutdown.lock().await.is_none());
        assert!(state.serve_instance.lock().await.is_none());
    }

    #[tokio::test]
    async fn listener_completion_is_signalled_before_cleanup_waits_for_lifecycle() {
        let lifecycle = Arc::new(Mutex::new(()));
        let lifecycle_guard = lifecycle.lock().await;
        let cleaned = Arc::new(AtomicBool::new(false));
        let (completed_tx, completed_rx) = oneshot::channel();
        let cleanup_lifecycle = Arc::clone(&lifecycle);
        let cleanup_flag = Arc::clone(&cleaned);
        let monitor = tokio::spawn(async move {
            signal_completion_before_cleanup(completed_tx, || async move {
                let _lifecycle = cleanup_lifecycle.lock().await;
                cleanup_flag.store(true, Ordering::Release);
            })
            .await;
        });

        tokio::time::timeout(Duration::from_secs(1), completed_rx)
            .await
            .expect("completion must not wait for the lifecycle lock")
            .expect("monitor must signal completion");
        assert!(!cleaned.load(Ordering::Acquire));
        drop(lifecycle_guard);
        monitor.await.expect("cleanup task should finish");
        assert!(cleaned.load(Ordering::Acquire));
    }

    #[test]
    fn admission_rejects_an_authentication_snapshot_paused_across_rotation() {
        let authenticated_epoch = 11;
        assert!(admission_is_current(
            authenticated_epoch,
            authenticated_epoch,
            authenticated_epoch
        ));
        assert!(!admission_is_current(
            authenticated_epoch,
            authenticated_epoch + 1,
            authenticated_epoch + 1
        ));
        assert!(!admission_is_current(
            authenticated_epoch,
            authenticated_epoch,
            0
        ));
    }

    #[test]
    fn authenticated_request_slots_are_bounded() {
        let state = McpState::default();
        let mut permits = (0..MAX_AUTHENTICATED_REQUESTS)
            .map(|_| acquire_request_slot(&state).expect("slot within configured bound"))
            .collect::<Vec<_>>();
        assert!(acquire_request_slot(&state).is_err());
        permits.pop();
        assert!(acquire_request_slot(&state).is_ok());
    }

    #[tokio::test]
    async fn body_collection_enforces_the_limit() {
        let accepted = collect_body_limited(Body::from("four"), 4)
            .await
            .expect("body at the bound should be accepted");
        assert_eq!(&accepted[..], b"four");
        assert_eq!(
            collect_body_limited(Body::from("five!"), 4)
                .await
                .expect_err("oversized body must be rejected"),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[tokio::test]
    async fn body_collection_times_out_a_stalled_authenticated_upload() {
        let stream = futures_util::stream::pending::<Result<Bytes, std::io::Error>>();
        let result = collect_body_limited_with_timeout(
            Body::from_stream(stream),
            4,
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(result.unwrap_err(), StatusCode::REQUEST_TIMEOUT);
    }

    #[test]
    fn cleanup_failures_are_appended_to_the_primary_lifecycle_error() {
        assert_eq!(
            combine_cleanup_error(
                "publication failed".into(),
                Err("permission denied".into()),
                "Cleanup failed",
            ),
            "publication failed. Cleanup failed: permission denied"
        );
        assert_eq!(
            combine_cleanup_error("publication failed".into(), Ok(()), "Cleanup failed"),
            "publication failed"
        );
    }

    #[test]
    fn invalid_utf8_is_a_json_parse_error() {
        assert!(serde_json::from_slice::<Value>(&[0xff, 0xfe]).is_err());
    }

    #[test]
    fn forwarded_pending_calls_are_capped_and_cancel_safe() {
        let state = McpState::default();
        state.epoch.store(3, Ordering::Release);
        activate_test_renderer(&state, 30);
        let mut registrations = Vec::new();
        for _ in 0..MAX_PENDING_FORWARD_CALLS {
            registrations.push(
                register_pending(&state, 3, 30, |_| Ok(()), None)
                    .expect("registration within pending bound"),
            );
        }
        assert_eq!(lock_pending(&state).len(), MAX_PENDING_FORWARD_CALLS);
        assert!(register_pending(&state, 3, 30, |_| Ok(()), None).is_err());

        registrations.pop();
        assert_eq!(
            lock_pending(&state).len(),
            MAX_PENDING_FORWARD_CALLS - 1,
            "dropping a request must remove its abandoned pending call"
        );
        assert!(register_pending(&state, 2, 30, |_| Ok(()), None).is_err());
        assert!(register_pending(&state, 3, 29, |_| Ok(()), None).is_err());
    }

    #[test]
    fn renderer_results_cannot_cross_session_or_epoch_boundaries() {
        let state = McpState::default();
        state.epoch.store(12, Ordering::Release);
        activate_test_renderer(&state, 120);
        let (mut receiver, registration) =
            register_pending(&state, 12, 120, |_| Ok(()), None).expect("pending call");

        assert!(take_pending_result(&state, registration.call_id, 119).is_none());
        assert_eq!(lock_pending(&state).len(), 1);
        let call = take_pending_result(&state, registration.call_id, 120)
            .expect("matching renderer may answer");
        let _ = call
            .sender
            .send(PendingReply::Result(json!({ "ok": true })));
        assert!(matches!(
            receiver.try_recv(),
            Ok(PendingReply::Result(value)) if value == json!({ "ok": true })
        ));
        drop(registration);
        assert!(lock_pending(&state).is_empty());

        let (_receiver, registration) =
            register_pending(&state, 12, 120, |_| Ok(()), None).expect("second pending call");
        state.epoch.store(13, Ordering::Release);
        assert!(take_pending_result(&state, registration.call_id, 120).is_none());
    }

    #[test]
    fn abandoned_and_timed_out_calls_emit_exact_cancellation_metadata() {
        let state = McpState::default();
        state.epoch.store(6, Ordering::Release);
        activate_test_renderer(&state, 60);
        let cancellations = Arc::new(std::sync::Mutex::new(Vec::new()));

        let disconnected_events = Arc::clone(&cancellations);
        let (_, disconnected) = register_pending(
            &state,
            6,
            60,
            |_| Ok(()),
            Some(Box::new(move |call_id, epoch, reason| {
                disconnected_events
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push((call_id, epoch, reason));
            })),
        )
        .expect("disconnected call registration");
        drop(disconnected);

        let timeout_events = Arc::clone(&cancellations);
        let (_, mut timed_out) = register_pending(
            &state,
            6,
            60,
            |_| Ok(()),
            Some(Box::new(move |call_id, epoch, reason| {
                timeout_events
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push((call_id, epoch, reason));
            })),
        )
        .expect("timed out call registration");
        timed_out.mark_timed_out();
        drop(timed_out);

        assert_eq!(
            *cancellations
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
            vec![
                (0, 6, CANCEL_REASON_CLIENT_DISCONNECTED),
                (1, 6, CANCEL_REASON_TIMEOUT),
            ]
        );
        assert_eq!(
            tool_call_cancelled_payload(1, 6, 60, CANCEL_REASON_TIMEOUT),
            json!({
                "callId": 1,
                "epoch": 6,
                "rendererSession": 60,
                "reason": "timeout"
            })
        );
        assert!(lock_pending(&state).is_empty());
    }

    #[test]
    fn lifecycle_invalidation_does_not_emit_redundant_per_call_cancellation() {
        let state = McpState::default();
        state.epoch.store(8, Ordering::Release);
        activate_test_renderer(&state, 80);
        let cancellations = Arc::new(std::sync::Mutex::new(0));
        let captured = Arc::clone(&cancellations);
        let (mut receiver, registration) = register_pending(
            &state,
            8,
            80,
            |_| Ok(()),
            Some(Box::new(move |_, _, _| {
                *captured
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) += 1;
            })),
        )
        .expect("pending registration");

        invalidate_pending(&state, PendingInterruption::Revoked, |_| {});
        assert!(matches!(receiver.try_recv(), Ok(PendingReply::Revoked)));
        drop(registration);
        assert_eq!(
            *cancellations
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
            0
        );
    }

    #[test]
    fn epoch_invalidation_emits_before_waking_pending_calls() {
        use tokio::sync::oneshot::error::TryRecvError;

        let state = McpState::default();
        state.epoch.store(9, Ordering::Release);
        activate_test_renderer(&state, 90);
        let (mut receiver, _registration) =
            register_pending(&state, 9, 90, |_| Ok(()), None).expect("pending registration");
        let (revoked, next) =
            invalidate_pending(&state, PendingInterruption::Revoked, |event_epoch| {
                assert_eq!(event_epoch, 9);
                assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
            });
        assert_eq!((revoked, next), (9, 10));
        assert!(matches!(receiver.try_recv(), Ok(PendingReply::Revoked)));
        assert!(lock_pending(&state).is_empty());
    }

    #[test]
    fn stop_invalidation_fails_every_pending_call() {
        let state = McpState::default();
        state.epoch.store(4, Ordering::Release);
        activate_test_renderer(&state, 40);
        let (mut first, _first_registration) =
            register_pending(&state, 4, 40, |_| Ok(()), None).expect("first pending registration");
        let (mut second, _second_registration) =
            register_pending(&state, 4, 40, |_| Ok(()), None).expect("second pending registration");

        invalidate_pending(&state, PendingInterruption::ServerStopped, |_| {});
        assert!(matches!(first.try_recv(), Ok(PendingReply::ServerStopped)));
        assert!(matches!(second.try_recv(), Ok(PendingReply::ServerStopped)));
        assert!(lock_pending(&state).is_empty());
    }

    #[test]
    fn native_activity_names_are_bounded_by_characters() {
        let name = format!("{}é", "a".repeat(MAX_ACTIVITY_TOOL_NAME_CHARS));
        let bounded = bounded_activity_tool_name(&name);
        assert_eq!(bounded.chars().count(), MAX_ACTIVITY_TOOL_NAME_CHARS);
        assert!(!bounded.ends_with('é'));
    }

    #[test]
    fn discovery_cleanup_surfaces_non_file_targets() {
        let path = std::env::temp_dir().join(format!(
            "oleafly-mcp-cleanup-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        let error =
            remove_discovery_file_at(&path).expect_err("a directory is not removable as a file");
        assert!(error.contains("failed to remove MCP discovery file"));
        std::fs::remove_dir(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn discovery_file_is_owner_only_and_atomically_replaced() {
        use std::os::unix::fs::PermissionsExt as _;

        static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "oleafly-mcp-discovery-test-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).expect("unique test directory");
        let path = directory.join("mcp.json");

        write_discovery_file_at(&path, 3210, "first-secret").expect("first publication");
        write_discovery_file_at(&path, 4321, "replacement-secret").expect("atomic replacement");
        let metadata = std::fs::metadata(&path).expect("published file metadata");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        let document: Value = serde_json::from_slice(
            &std::fs::read(&path).expect("read owner-only discovery document"),
        )
        .expect("valid discovery JSON");
        assert_eq!(document["url"], "http://127.0.0.1:4321/mcp");
        assert_eq!(document["token"], "replacement-secret");
        assert_eq!(
            std::fs::read_dir(&directory)
                .expect("list test directory")
                .count(),
            1,
            "successful publication must not leave staging files"
        );

        std::fs::remove_file(&path).expect("remove test discovery file");
        std::fs::remove_dir(&directory).expect("remove test directory");
    }
}
