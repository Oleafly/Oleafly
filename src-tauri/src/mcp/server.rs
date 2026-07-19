//! Localhost MCP endpoint. The Rust side is a transport only: it guards the
//! request (loopback host, no browser Origin, bearer token) and forwards
//! `tools/call` into the webview, where the exact in-app tool implementations
//! execute. Everything else is answered from the registered tool metadata.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch, Mutex};

use super::protocol::{dispatch, rpc_error, rpc_result, RpcOutcome, ToolMeta};
use crate::paths;

/// Upper bound for one forwarded tool call: compiles and human approvals are
/// slow; anything past this returns a JSON-RPC error to the client.
const CALL_TIMEOUT: Duration = Duration::from_secs(300);

const INSTRUCTIONS: &str = "Oleafly is a local-first LaTeX editor. These tools operate on the project currently open in the app. Start with get_status to see what is open, list_files or project_map to orient, then read and edit files and call compile. Destructive edits may pause for the user to approve inside Oleafly.";

#[derive(Default)]
pub struct McpState {
    pub lifecycle: Mutex<()>,
    /// Tool metadata pushed by the webview at startup (and on policy change).
    pub registry: Mutex<Vec<ToolMeta>>,
    /// In-flight forwarded calls awaiting a webview result.
    pub pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    pub call_seq: AtomicU64,
    pub token: Mutex<Option<String>>,
    /// Present while the server runs; sending true triggers graceful shutdown.
    pub shutdown: Mutex<Option<watch::Sender<bool>>>,
    pub bound_port: Mutex<Option<u16>>,
    /// The running axum task, so `stop` can await teardown (the listener is
    /// released early in graceful shutdown) before a caller rebinds the port.
    pub serve_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
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
    let bare = if let Some(rest) = h.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        h.split(':').next().unwrap_or("")
    };
    matches!(bare, "127.0.0.1" | "localhost" | "::1")
}

async fn mcp_post(State(app): State<AppHandle>, headers: HeaderMap, body: String) -> Response {
    let state = app.state::<McpState>();
    if !host_allowed(&headers) || !origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let token = state.token.lock().await.clone().unwrap_or_default();
    if !authorized(&headers, &token) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let msg: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::OK,
                Json(rpc_error(Value::Null, -32700, "parse error")),
            )
                .into_response()
        }
    };
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
    let tools = state.registry.lock().await.clone();
    match dispatch(&msg, &tools, INSTRUCTIONS) {
        RpcOutcome::Reply(v) => (StatusCode::OK, Json(v)).into_response(),
        RpcOutcome::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcOutcome::ForwardCall {
            id,
            name,
            arguments,
        } => {
            let call_id = state.call_seq.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = oneshot::channel();
            state.pending.lock().await.insert(call_id, tx);
            let emitted = app.emit(
                "mcp:tool-call",
                json!({ "callId": call_id, "name": name, "arguments": arguments }),
            );
            if emitted.is_err() {
                state.pending.lock().await.remove(&call_id);
                return (
                    StatusCode::OK,
                    Json(rpc_error(id, -32000, "app bridge unavailable")),
                )
                    .into_response();
            }
            match tokio::time::timeout(CALL_TIMEOUT, rx).await {
                Ok(Ok(result)) => (StatusCode::OK, Json(rpc_result(id, result))).into_response(),
                _ => {
                    state.pending.lock().await.remove(&call_id);
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

/// Start the server. Returns the bound port. Errors if already running or the
/// port is taken.
pub async fn start(app: AppHandle, port: u16) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if state.shutdown.lock().await.is_some() {
        return Err("MCP server already running".into());
    }
    let token = ensure_token()?;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("could not bind {addr}: {e}"))?;
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let (tx, mut rx) = watch::channel(false);
    write_discovery_file(bound, &token)?;

    let router = Router::new()
        .route("/mcp", post(mcp_post))
        .with_state(app.clone());
    let serve = tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.changed().await;
            })
            .await;
    });
    *state.token.lock().await = Some(token);
    *state.shutdown.lock().await = Some(tx);
    *state.bound_port.lock().await = Some(bound);
    *state.serve_task.lock().await = Some(serve);
    Ok(bound)
}

pub async fn stop(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if let Some(tx) = state.shutdown.lock().await.take() {
        let _ = tx.send(true);
    }
    // Wait (bounded) for the serve task to finish so the listener is fully
    // released before any caller rebinds the same port. Graceful shutdown drops
    // the listener early, so this returns near-instantly in the normal case; the
    // timeout guards against a long in-flight tool call holding the drain open
    // (the detached task finishes on its own, port already freed).
    if let Some(handle) = state.serve_task.lock().await.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), handle).await;
    }
    *state.bound_port.lock().await = None;
    *state.token.lock().await = None;
    remove_discovery_file();
    Ok(())
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
/// the server runs. Documented in docs/mcp.md.
fn write_discovery_file(port: u16, token: &str) -> Result<(), String> {
    let path = paths::openleaf_root()?.join("mcp.json");
    let body = serde_json::to_string_pretty(&json!({
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "token": token,
    }))
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    // Owner-only (0600 on unix, current-user ACL on Windows): the file holds the
    // live MCP bearer token.
    crate::fsperm::harden_file(&path);
    Ok(())
}

/// Rewrite the discovery file after a token regeneration while running.
pub fn rewrite_discovery_file(port: u16, token: &str) -> Result<(), String> {
    write_discovery_file(port, token)
}

pub fn remove_discovery_file() {
    if let Ok(root) = paths::openleaf_root() {
        let _ = std::fs::remove_file(root.join("mcp.json"));
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
        assert!(host_allowed(&h(&[("host", "127.0.0.1")])));
        assert!(host_allowed(&h(&[("host", "[::1]:5323")])));
        assert!(!host_allowed(&h(&[(
            "host",
            "rebind.attacker.example:5323"
        )])));
        assert!(!host_allowed(&h(&[])));
    }
}
