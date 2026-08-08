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

const INSTRUCTIONS: &str = "Oleafly is a local-first LaTeX editor. Project tools require the project currently reported by the app. Start with get_status to see the selected project. Use list_files or project_map to orient, then read and edit files and call compile. Destructive edits may pause for the user to approve inside Oleafly.";

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
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let (revoked_epoch, next_epoch) =
        invalidate_pending(state, PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                renderer_revocation_payload(epoch, "renderer-lease-expired", renderer_session),
            );
        });
    state.published_epoch.store(
        advance_published_epoch(published_epoch, revoked_epoch, next_epoch),
        Ordering::Release,
    );
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
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let (revoked_epoch, next_epoch) =
        invalidate_pending(&state, PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                renderer_revocation_payload(epoch, "renderer-session-changed", renderer_session),
            );
        });
    state.published_epoch.store(
        advance_published_epoch(published_epoch, revoked_epoch, next_epoch),
        Ordering::Release,
    );
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

fn native_completion_is_reportable(epoch_current: bool, succeeded: bool, changed: bool) -> bool {
    epoch_current || (succeeded && changed)
}

pub(crate) fn advance_published_epoch(
    published_epoch: u64,
    revoked_epoch: u64,
    next_epoch: u64,
) -> u64 {
    if published_epoch == revoked_epoch {
        next_epoch
    } else {
        0
    }
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

#[path = "server_request.rs"]
mod request;

use request::mcp_post;
#[cfg(test)]
use request::{
    authorized, bounded_activity_tool_name, collect_body_limited,
    collect_body_limited_with_timeout, constant_time_eq, effective_policy, host_allowed,
    origin_allowed,
};
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
#[path = "server_discovery.rs"]
mod discovery;

use discovery::{ensure_token, remove_discovery_file_checked, write_discovery_file};
pub use discovery::{remove_discovery_file, rewrite_discovery_file};
#[cfg(test)]
use discovery::{remove_discovery_file_at, write_discovery_file_at};
#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
