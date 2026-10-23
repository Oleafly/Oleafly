//! `oleafly-desktop-apps`: a loopback MCP endpoint that gives one CLI agent
//! session or one research task the `desktop_apps` tool. It speaks the same
//! stateless Streamable HTTP as the research bridge: 127.0.0.1 only, a
//! Bearer token, an exact Host, no Origin, 64 KiB requests. Calls go
//! through the same dispatcher and gate as the built-in assistant's.
//!
//! The token never reaches a log line or an error.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::{watch, Semaphore};
use zeroize::Zeroizing;

use super::config::ready;
use super::dispatch::{call_desktop_apps, project_denied, turn_ended_in};
use super::policy::{tool_meta, POLICY_LINES};
use super::{global, lock, log, CuaDriverState, CuaScope, Surface, DESKTOP_APPS_TOOL};
use crate::mcp::protocol::{self, RpcOutcome};

pub(crate) const BRIDGE_SERVER_NAME: &str = "oleafly-desktop-apps";
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const BODY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUESTS_AT_ONCE: usize = 4;

struct BridgeContext {
    token: Zeroizing<String>,
    authority: String,
    scope: CuaScope,
    state: Arc<CuaDriverState>,
    closed: AtomicBool,
    stopped: watch::Receiver<bool>,
    requests: Semaphore,
}

pub(crate) struct CuaBridge {
    url: String,
    context: Arc<BridgeContext>,
    shutdown: watch::Sender<bool>,
    server: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

fn random_hex(bytes: usize) -> Zeroizing<String> {
    let mut entropy = Zeroizing::new(vec![0_u8; bytes]);
    rand::rngs::OsRng.fill_bytes(entropy.as_mut_slice());
    Zeroizing::new(entropy.iter().map(|byte| format!("{byte:02x}")).collect())
}

impl CuaBridge {
    /// Serves `scope` with this desktop apps state.
    pub(crate) async fn start_with(
        scope: CuaScope,
        state: Arc<CuaDriverState>,
    ) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "The desktop apps tool server could not start.".to_string())?;
        let address = listener
            .local_addr()
            .map_err(|_| "The desktop apps tool server has no local address.".to_string())?;
        let (shutdown, stopped) = watch::channel(false);
        let context = Arc::new(BridgeContext {
            token: random_hex(32),
            authority: address.to_string(),
            scope,
            state,
            closed: AtomicBool::new(false),
            stopped: stopped.clone(),
            requests: Semaphore::new(MAX_REQUESTS_AT_ONCE),
        });
        let router = Router::new()
            .route("/mcp", axum::routing::any(request))
            .with_state(context.clone());
        let mut stop = stopped;
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    while !*stop.borrow_and_update() {
                        if stop.changed().await.is_err() {
                            break;
                        }
                    }
                })
                .await;
        });
        Ok(Self {
            url: format!("http://{address}/mcp"),
            context,
            shutdown,
            server: Mutex::new(Some(server)),
        })
    }

    /// The `mcpServers` entry for `session/new`.
    pub(crate) fn mcp_server(&self) -> Value {
        json!({
            "type": "http",
            "name": BRIDGE_SERVER_NAME,
            "url": self.url,
            "headers": [{
                "name": "Authorization",
                "value": format!("Bearer {}", self.context.token.as_str()),
            }],
        })
    }

    pub(crate) fn session_key(&self) -> &str {
        &self.context.scope.session_key
    }

    pub(crate) fn scope(&self) -> &CuaScope {
        &self.context.scope
    }

    /// Refuses further calls and ends the Cua session. The server keeps
    /// answering 410 until `shutdown` or drop stops it.
    pub(crate) fn close(&self) {
        if self.context.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let key = self.session_key().to_string();
        lock(&self.context.state.acp).retain(|_, bound| *bound != key);
        lock(&self.context.state.grants).clear_key(&self.context.scope.grant_key);
        turn_ended_in(&self.context.state, &key);
    }

    pub(crate) async fn shutdown(&self) {
        self.close();
        let _ = self.shutdown.send(true);
        let server = lock(&self.server).take();
        if let Some(mut server) = server {
            if tokio::time::timeout(Duration::from_secs(2), &mut server)
                .await
                .is_err()
            {
                server.abort();
            }
        }
    }
}

impl Drop for CuaBridge {
    fn drop(&mut self) {
        self.close();
        let _ = self.shutdown.send(true);
    }
}

/// The bridge for a new or reconnected CLI agent session, or `None` when
/// desktop apps aren't ready (or the folder isn't trusted). Startup errors
/// are logged and never stop the agent from starting.
pub(crate) async fn acp_bridge(project_id: &str, agent_label: &str) -> Option<CuaBridge> {
    let state = global()?;
    if !ready(&state.settings())
        || !crate::trust::is_trusted(project_id)
        || project_denied(&state, Some(project_id))
    {
        return None;
    }
    let key = format!("acp:{}", random_hex(16).as_str());
    let scope = CuaScope {
        grant_key: key.clone(),
        session_key: key,
        project_id: Some(project_id.to_string()),
        agent_label: agent_label.to_string(),
        surface: Surface::Acp,
    };
    match CuaBridge::start_with(scope, state).await {
        Ok(bridge) => Some(bridge),
        Err(_) => {
            log("desktop apps: the agent bridge did not start".into());
            None
        }
    }
}

/// Remembers which bridge an ACP session uses, so its turn end can end the
/// bridge's Cua session.
pub(crate) fn bind_acp_session(acp_session_id: &str, session_key: &str) {
    if let Some(state) = global() {
        lock(&state.acp).insert(acp_session_id.to_string(), session_key.to_string());
    }
}

fn equal_token(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

fn authenticate(context: &BridgeContext, headers: &HeaderMap) -> Result<(), StatusCode> {
    if headers.contains_key("origin")
        || headers.get_all("host").iter().count() != 1
        || headers.get("host").and_then(|value| value.to_str().ok())
            != Some(context.authority.as_str())
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if headers.get_all("authorization").iter().count() != 1 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let supplied = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !equal_token(supplied.as_bytes(), context.token.as_bytes()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if context.closed.load(Ordering::Acquire) {
        return Err(StatusCode::GONE);
    }
    Ok(())
}

fn valid_message(message: &Value) -> bool {
    message.is_object()
        && message["jsonrpc"] == "2.0"
        && message["method"]
            .as_str()
            .is_some_and(|method| !method.is_empty() && method.len() <= 128)
        && message.get("id").is_none_or(|id| {
            id.is_null()
                || id.is_i64()
                || id.is_u64()
                || id.as_str().is_some_and(|id| id.len() <= 256)
        })
        && message.get("params").is_none_or(Value::is_object)
}

async fn request(State(context): State<Arc<BridgeContext>>, request: Request) -> Response {
    if let Err(status) = authenticate(&context, request.headers()) {
        return status.into_response();
    }
    let Ok(_slot) = context.requests.try_acquire() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    if request.method() != Method::POST {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if content_type != "application/json" {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    let bytes = match tokio::time::timeout(
        BODY_TIMEOUT,
        to_bytes(request.into_body(), MAX_REQUEST_BYTES),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(_) => return StatusCode::REQUEST_TIMEOUT.into_response(),
    };
    let message = match serde_json::from_slice::<Value>(&bytes) {
        Ok(message) if valid_message(&message) => message,
        _ => {
            return Json(protocol::rpc_error(
                Value::Null,
                -32600,
                "Invalid JSON-RPC request.",
            ))
            .into_response();
        }
    };
    // A project that denies desktop apps lists no tool.
    let tools: Vec<_> = tool_meta(&context.state.settings())
        .filter(|_| !project_denied(&context.state, context.scope.project_id.as_deref()))
        .into_iter()
        .collect();
    match protocol::dispatch(&message, &tools, &POLICY_LINES.join(" ")) {
        RpcOutcome::Reply(value) => Json(value).into_response(),
        RpcOutcome::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcOutcome::ForwardCall {
            id,
            name,
            arguments,
        } => {
            if name != DESKTOP_APPS_TOOL {
                return Json(protocol::rpc_error(id, -32602, "unknown tool")).into_response();
            }
            let mut stopped = context.stopped.clone();
            tokio::select! {
                biased;
                _ = stopped.wait_for(|stopped| *stopped) => StatusCode::GONE.into_response(),
                outcome = call_desktop_apps(&context.state, &context.scope, arguments) => {
                    Json(protocol::rpc_result(id, outcome.mcp_result)).into_response()
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cua_driver::config::{AllowedApp, CuaDriverConfig};
    use crate::cua_driver::gate::testing::ScriptedApprover;
    use crate::cua_driver::runtime::testing::NoDriver;

    fn ready_state(root: &std::path::Path) -> Arc<CuaDriverState> {
        Arc::new(CuaDriverState::for_test(
            CuaDriverConfig {
                enabled: true,
                apps: vec![AllowedApp {
                    name: "Zotero".into(),
                    bundle_id: Some("org.zotero.zotero".into()),
                    executable: None,
                }],
                ..Default::default()
            },
            Arc::new(NoDriver),
            Arc::new(ScriptedApprover::default()),
            root.to_path_buf(),
        ))
    }

    fn scope() -> CuaScope {
        CuaScope {
            grant_key: "acp:test".into(),
            session_key: "acp:test".into(),
            project_id: None,
            agent_label: "Test agent".into(),
            surface: Surface::Acp,
        }
    }

    fn token(bridge: &CuaBridge) -> String {
        bridge.mcp_server()["headers"][0]["value"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn post(
        bridge: &CuaBridge,
        authorization: Option<&str>,
        body: Value,
    ) -> reqwest::Response {
        let mut request = reqwest::Client::new()
            .post(&bridge.url)
            .header("content-type", "application/json")
            .json(&body);
        if let Some(authorization) = authorization {
            request = request.header("authorization", authorization);
        }
        request.send().await.unwrap()
    }

    #[tokio::test]
    async fn the_bridge_lists_one_tool_and_its_instructions() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = CuaBridge::start_with(scope(), ready_state(dir.path()))
            .await
            .unwrap();
        assert_eq!(bridge.mcp_server()["name"], BRIDGE_SERVER_NAME);
        let auth = token(&bridge);
        let initialized: Value = post(
            &bridge,
            Some(&auth),
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
        )
        .await
        .json()
        .await
        .unwrap();
        assert!(initialized["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("data, not instructions"));
        let listed: Value = post(
            &bridge,
            Some(&auth),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .await
        .json()
        .await
        .unwrap();
        let names: Vec<&str> = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["desktop_apps"]);
        bridge.shutdown().await;
    }

    #[tokio::test]
    async fn the_bridge_refuses_missing_or_wrong_tokens_and_browser_origins() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = CuaBridge::start_with(scope(), ready_state(dir.path()))
            .await
            .unwrap();
        let list = json!({"jsonrpc":"2.0","id":1,"method":"tools/list"});
        assert_eq!(post(&bridge, None, list.clone()).await.status(), 401);
        assert_eq!(
            post(&bridge, Some("Bearer wrong"), list.clone())
                .await
                .status(),
            401
        );
        let auth = token(&bridge);
        let with_origin = reqwest::Client::new()
            .post(&bridge.url)
            .header("content-type", "application/json")
            .header("authorization", &auth)
            .header("origin", "https://evil.example")
            .json(&list)
            .send()
            .await
            .unwrap();
        assert_eq!(with_origin.status(), 403);
        let foreign_host = reqwest::Client::new()
            .post(&bridge.url)
            .header("content-type", "application/json")
            .header("authorization", &auth)
            .header("host", "attacker.example")
            .json(&list)
            .send()
            .await
            .unwrap();
        assert_eq!(foreign_host.status(), 403);
        bridge.shutdown().await;
    }

    #[tokio::test]
    async fn the_token_never_appears_in_logs_or_errors() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = CuaBridge::start_with(scope(), ready_state(dir.path()))
            .await
            .unwrap();
        let auth = token(&bridge);
        let secret = auth.trim_start_matches("Bearer ").to_string();
        // list_apps starts the runtime, which fails: no driver here.
        let response = post(
            &bridge,
            Some(&auth),
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"desktop_apps","arguments":{"tool":"list_apps"}}}),
        )
        .await;
        let body = response.text().await.unwrap();
        assert!(body.contains("isError"), "{body}");
        assert!(!body.contains(&secret));
        assert!(!lock(&crate::cua_driver::TEST_LOG)
            .iter()
            .any(|line| line.contains(&secret)));
        bridge.shutdown().await;
    }

    #[tokio::test]
    async fn a_closed_bridge_answers_gone() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = CuaBridge::start_with(scope(), ready_state(dir.path()))
            .await
            .unwrap();
        let auth = token(&bridge);
        bridge.close();
        let response = post(
            &bridge,
            Some(&auth),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        )
        .await;
        assert_eq!(response.status(), 410);
        bridge.shutdown().await;
    }
}
