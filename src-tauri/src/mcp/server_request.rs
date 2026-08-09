use super::*;

pub(super) async fn collect_body_limited(body: Body, limit: usize) -> Result<Bytes, StatusCode> {
    collect_body_limited_with_timeout(body, limit, REQUEST_BODY_TIMEOUT).await
}

pub(super) async fn collect_body_limited_with_timeout(
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

pub(super) fn effective_policy(config: Option<(String, bool)>) -> (String, bool) {
    config.unwrap_or_else(|| ("ask".to_string(), true))
}

pub(super) fn bounded_activity_tool_name(name: &str) -> String {
    name.chars().take(MAX_ACTIVITY_TOOL_NAME_CHARS).collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ToolRoute {
    Native,
    Renderer,
    RejectNoRenderer,
}

pub(super) fn tool_route(name: &str, policy: &str, renderer_is_fresh: bool) -> ToolRoute {
    if crate::mcp::native::handles(name, policy) {
        ToolRoute::Native
    } else if renderer_is_fresh {
        ToolRoute::Renderer
    } else {
        ToolRoute::RejectNoRenderer
    }
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

pub(super) async fn mcp_post(State(app): State<AppHandle>, request: Request) -> Response {
    let state = app.state::<McpState>();
    let (epoch, renderer_session) = match authenticate_request(&state, request.headers()).await {
        Ok(admission) => admission,
        Err(response) => return response,
    };
    let _request_slot = match acquire_request_slot(&state) {
        Ok(permit) => permit,
        Err(()) => {
            return status_response(
                StatusCode::TOO_MANY_REQUESTS,
                "too many concurrent MCP requests",
            )
        }
    };
    let message = match parse_request(request).await {
        Ok(message) => message,
        Err(response) => return response,
    };
    let outcome = match dispatch_authenticated(&state, epoch, &message).await {
        Ok(outcome) => outcome,
        Err(response) => return response,
    };
    match outcome {
        RpcOutcome::Reply(v) => (StatusCode::OK, Json(v)).into_response(),
        RpcOutcome::Accepted => StatusCode::ACCEPTED.into_response(),
        RpcOutcome::ForwardCall {
            id,
            name,
            arguments,
        } => handle_forward_call(&app, &state, epoch, renderer_session, id, name, arguments).await,
    }
}

fn status_response(status: StatusCode, message: &'static str) -> Response {
    (status, message).into_response()
}

fn json_rpc_error(id: Value, message: &str) -> Response {
    (StatusCode::OK, Json(rpc_error(id, -32000, message))).into_response()
}

fn json_tool_error(id: Value, message: &str) -> Response {
    (StatusCode::OK, Json(rpc_tool_error(id, message))).into_response()
}

async fn authenticate_request(
    state: &McpState,
    headers: &HeaderMap,
) -> Result<(u64, u64), Response> {
    if !host_allowed(headers) || !origin_allowed(headers) {
        return Err(status_response(StatusCode::FORBIDDEN, "forbidden"));
    }
    let token = state.token.lock().await;
    let Some(token) = token.as_deref() else {
        return Err(status_response(StatusCode::UNAUTHORIZED, "unauthorized"));
    };
    if !authorized(headers, token) {
        return Err(status_response(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    let epoch = state.epoch.load(Ordering::Acquire);
    let renderer_session = state.active_renderer_session.load(Ordering::Acquire);
    if !admission_is_current(epoch, epoch, state.published_epoch.load(Ordering::Acquire)) {
        return Err(status_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "MCP server is not ready. Retry shortly.",
        ));
    }
    Ok((epoch, renderer_session))
}

async fn parse_request(request: Request) -> Result<Value, Response> {
    let body = collect_body_limited(request.into_body(), MAX_REQUEST_BODY_BYTES)
        .await
        .map_err(|status| match status {
            StatusCode::REQUEST_TIMEOUT => status_response(status, "MCP request body timed out"),
            _ => status_response(status, "MCP request body is too large"),
        })?;
    let message: Value = serde_json::from_slice(&body).map_err(|_| {
        (
            StatusCode::OK,
            Json(rpc_error(Value::Null, -32700, "parse error")),
        )
            .into_response()
    })?;
    if message.is_array() {
        return Err((
            StatusCode::OK,
            Json(rpc_error(
                Value::Null,
                -32600,
                "batch requests not supported",
            )),
        )
            .into_response());
    }
    Ok(message)
}

async fn dispatch_authenticated(
    state: &McpState,
    epoch: u64,
    message: &Value,
) -> Result<RpcOutcome, Response> {
    let _token = state.token.lock().await;
    if !admission_is_current(
        epoch,
        state.epoch.load(Ordering::Acquire),
        state.published_epoch.load(Ordering::Acquire),
    ) {
        return Err(status_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "MCP request authorization changed. Retry with current credentials.",
        ));
    }
    let tools = state.registry.lock().await.clone();
    Ok(dispatch(message, &tools, INSTRUCTIONS))
}

async fn handle_forward_call(
    app: &AppHandle,
    state: &McpState,
    epoch: u64,
    renderer_session: u64,
    id: Value,
    name: String,
    arguments: Value,
) -> Response {
    let config = tokio::task::spawn_blocking(|| {
        crate::config::read_config().map(|cfg| (cfg.mcp_approval_policy, cfg.mcp_read_only))
    })
    .await
    .ok()
    .and_then(|read| read.ok());
    let (policy, read_only) = effective_policy(config);
    if read_only && crate::mcp::native::is_mutating(&name) {
        return json_tool_error(id, "tool disabled by read-only mode");
    }
    let renderer_is_fresh = renderer_session_is_fresh(state, renderer_session);
    match tool_route(&name, &policy, renderer_is_fresh) {
        ToolRoute::Native => run_native_call(app, state, epoch, id, name, arguments).await,
        ToolRoute::Renderer => {
            forward_to_renderer(app, state, epoch, renderer_session, id, name, arguments).await
        }
        ToolRoute::RejectNoRenderer => json_tool_error(
            id,
            "this tool requires an active Oleafly window and user approval",
        ),
    }
}

async fn run_native_call(
    app: &AppHandle,
    state: &McpState,
    epoch: u64,
    id: Value,
    name: String,
    arguments: Value,
) -> Response {
    let mut activity = NativeActivity::start(app, state, epoch, &name);
    let reported = state.active_project.lock().await.clone();
    let outcome = match crate::mcp::native::resolve_project(&arguments, reported) {
        Ok(project_id) => {
            let result = crate::mcp::native::call(&project_id, &name, &arguments).await;
            (Some(project_id), result)
        }
        Err(error) => (None, Err(error)),
    };
    let succeeded = matches!(&outcome, (Some(_), Ok(_)));
    let changed = matches!(&outcome, (Some(_), Ok(result)) if result.change.is_some());
    let reportable = native_completion_is_reportable(
        state.epoch.load(Ordering::Acquire) == epoch,
        succeeded,
        changed,
    );
    activity.finish(succeeded && reportable, !reportable);
    if !reportable {
        return json_rpc_error(id, "MCP request was revoked before the tool call completed");
    }
    native_call_response(app, id, outcome)
}

fn native_call_response(
    app: &AppHandle,
    id: Value,
    outcome: (
        Option<String>,
        Result<crate::mcp::native::CallOutcome, String>,
    ),
) -> Response {
    match outcome {
        (Some(project_id), Ok(outcome)) => {
            if let Some(change) = outcome.change {
                let paths = match change["kind"].as_str() {
                    Some("rename") => vec![change["from"].clone(), change["to"].clone()],
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
        (_, Err(error)) => json_tool_error(id, &error),
        (None, Ok(_)) => json_tool_error(id, "project resolution failed"),
    }
}

async fn forward_to_renderer(
    app: &AppHandle,
    state: &McpState,
    epoch: u64,
    renderer_session: u64,
    id: Value,
    name: String,
    arguments: Value,
) -> Response {
    let cancellation_app = app.clone();
    let registration = register_pending(
        state,
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
        Err(error) => return json_rpc_error(id, &error),
    };
    let reply = tokio::time::timeout(CALL_TIMEOUT, receiver).await;
    if reply.is_err() {
        registration.mark_timed_out();
    }
    pending_reply_response(id, reply)
}

fn pending_reply_response(
    id: Value,
    reply: Result<Result<PendingReply, oneshot::error::RecvError>, tokio::time::error::Elapsed>,
) -> Response {
    match reply {
        Ok(Ok(PendingReply::Result(result))) => {
            (StatusCode::OK, Json(rpc_result(id, result))).into_response()
        }
        Ok(Ok(PendingReply::ServerStopped)) | Ok(Err(_)) => {
            json_rpc_error(id, "MCP server stopped before the tool call completed")
        }
        Ok(Ok(PendingReply::Revoked)) => json_rpc_error(
            id,
            "MCP request authorization was revoked. Retry the tool call.",
        ),
        Err(_) => json_rpc_error(id, "tool call timed out waiting for the app"),
    }
}
