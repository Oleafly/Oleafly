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

use super::protocol::{dispatch, rpc_error, rpc_result, rpc_tool_error, RpcOutcome, ToolMeta};
use crate::paths;

/// Upper bound for one forwarded tool call: compiles and human approvals are
/// slow; anything past this returns a JSON-RPC error to the client.
const CALL_TIMEOUT: Duration = Duration::from_secs(300);
const REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUEST_BODY_BYTES: usize = 20 * 1024 * 1024;
const MAX_AUTHENTICATED_REQUESTS: usize = 8;
const MAX_PENDING_FORWARD_CALLS: usize = 16;
const MAX_ACTIVITY_TOOL_NAME_CHARS: usize = 128;
const RENDERER_LEASE_TTL: Duration = Duration::from_secs(45);
const CANCEL_REASON_CLIENT_DISCONNECTED: &str = "client-disconnected";
const CANCEL_REASON_TIMEOUT: &str = "timeout";

const INSTRUCTIONS: &str = "Oleafly is a local-first LaTeX editor. Project tools require the project currently reported by the app. Start with get_status to see the selected project. Use list_files or project_map to orient, then read and edit files and call compile. Destructive edits may pause for the user to approve inside Oleafly.";

pub struct McpState {
    pub(crate) control: Mutex<()>,
    pub lifecycle: Mutex<()>,
    /// Tool metadata pushed by the webview at startup (and on policy change).
    pub registry: Mutex<Vec<ToolMeta>>,
    /// In-flight forwarded calls awaiting a webview result.
    pub(crate) pending: std::sync::Mutex<HashMap<u64, PendingCall>>,
    pub call_seq: AtomicU64,
    pub(crate) epoch: AtomicU64,
    pub(crate) registry_initialized: AtomicBool,
    pub(crate) published_epoch: AtomicU64,
    pub(crate) active_renderer_session: AtomicU64,
    renderer_session_seq: AtomicU64,
    renderer_lease: std::sync::Mutex<Option<RendererLease>>,
    renderer_lease_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    request_slots: Arc<Semaphore>,
    pub token: Mutex<Option<String>>,
    /// Present while the server runs; sending true triggers graceful shutdown.
    pub shutdown: Mutex<Option<watch::Sender<bool>>>,
    pub bound_port: Mutex<Option<u16>>,
    pub active_project: Mutex<Option<String>>,
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
        if !removed {
            return;
        }
        if let Some(emit) = self.emit_cancellation.take() {
            emit(self.call_id, self.epoch, self.cancellation_reason);
        }
    }
}

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

#[path = "server_renderer.rs"]
mod renderer;

pub(crate) use renderer::{begin_renderer_session, end_renderer_session, renderer_heartbeat};
use renderer::{clear_renderer_registry, combine_cleanup_error, log_discovery_cleanup_error};

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
    origin_allowed, tool_disabled_by_read_only, tool_route, ToolRoute,
};
#[path = "server_lifecycle.rs"]
mod lifecycle;

#[cfg(test)]
use lifecycle::{
    claim_unexpected_serve_exit, serve_exit_is_current, signal_completion_before_cleanup,
};
pub use lifecycle::{start, stop};

#[path = "server_discovery.rs"]
mod discovery;

#[cfg(test)]
use discovery::remove_discovery_file_at;
#[cfg(all(test, unix))]
use discovery::write_discovery_file_at;
use discovery::{ensure_token, remove_discovery_file_checked, write_discovery_file};
pub use discovery::{remove_discovery_file, rewrite_discovery_file};
#[cfg(test)]
#[path = "server_pending_tests.rs"]
mod pending_tests;
#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
