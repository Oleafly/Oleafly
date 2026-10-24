//! The ACP client: the official SDK runs the JSON-RPC connection over
//! Oleafly's bounded line transport, and one consumer task hands every
//! inbound message to a [`ClientHost`] in wire order. A reply is delivered
//! only after every update the agent sent before it.
use std::collections::HashMap;
use std::future::Future;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::{Agent, Client, ConnectionTo, Responder, UntypedMessage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;

use crate::capabilities::{initialize_params, parse_initialize, AgentCapabilities, AuthMethod};
use crate::controls::{set_config_option_params, ConfigValue};
use crate::error::{disconnect_message, rpc_error_message, RpcError};
use crate::limits::{MAX_FRAME, MAX_PENDING, REQUEST_TIMEOUT};
use crate::process::{contain_process_tree, isolate_process_tree, StderrTail};
use crate::transport::{line_transport, DROPPED_UPDATE_METHOD};
use crate::v2::{permission_params_to_v1, Translated, V2Translator};

/// Receives what the agent sends. Calls arrive one at a time, in the order
/// the agent wrote them. A host must not block for long and must not wait
/// for a reply to one of its own requests inside a callback.
pub trait ClientHost: Send + Sync + 'static {
    /// `session/update` params. Under protocol v2 they arrive translated to
    /// the v1 shape.
    fn on_update(&self, params: Value);
    /// Permission, elicitation, file reads and any other agent request. The
    /// host must answer it (respond or reject), now or later.
    fn on_request(&self, request: IncomingRequest);
    /// Every other notification (`_auth/status_update`, …).
    fn on_notification(&self, method: &str, params: Value);
    /// An update too large to keep was cut or dropped.
    fn on_dropped_update(&self, bytes: usize);
    /// The connection ended. Called once.
    fn on_disconnected(&self);
    /// A turn of `session_id` ended: its `session/prompt` reply arrived, or
    /// under protocol v2 the session went idle. Called in order with the
    /// session's updates, before the prompt's caller sees the reply, so an
    /// update after this call came after the turn.
    fn on_turn_ended(&self, _session_id: &str) {}
}

/// A host for connections that only probe an agent (the agent check).
pub struct NullHost;

impl ClientHost for NullHost {
    fn on_update(&self, _params: Value) {}

    fn on_request(&self, request: IncomingRequest) {
        if request.method() == "session/request_permission" {
            let _ = request.respond(json!({"outcome": {"outcome": "cancelled"}}));
        } else {
            let _ = request.reject(-32601, "This client capability is not available.");
        }
    }

    fn on_notification(&self, _method: &str, _params: Value) {}
    fn on_dropped_update(&self, _bytes: usize) {}
    fn on_disconnected(&self) {}
}

/// Room kept in a frame for a reply's envelope (version, id and method).
const REPLY_ENVELOPE: usize = 256;

/// A request from the agent, with the means to answer it once.
pub struct IncomingRequest {
    method: String,
    params: Value,
    responder: Responder<Value>,
}

impl IncomingRequest {
    pub fn method(&self) -> &str {
        &self.method
    }

    pub fn params(&self) -> &Value {
        &self.params
    }

    /// The JSON-RPC id the agent chose (a number or a string).
    pub fn wire_id(&self) -> Value {
        serde_json::to_value(self.responder.id()).unwrap_or(Value::Null)
    }

    /// Answers the request. A reply that would not fit one frame is sent as
    /// an error instead: the transport ends the whole connection on a frame
    /// that is too large.
    pub fn respond(self, result: Value) -> Result<(), RpcError> {
        let id = serde_json::to_vec(self.responder.id()).map_or(0, |id| id.len());
        let fits = serde_json::to_vec(&result)
            .is_ok_and(|reply| reply.len().saturating_add(id) < MAX_FRAME - REPLY_ENVELOPE);
        if !fits {
            return self.reject(-32603, "The reply is too large to send over ACP.");
        }
        self.responder
            .respond(result)
            .map_err(|_| RpcError::local("The agent is disconnected."))
    }

    pub fn reject(self, code: i64, message: &str) -> Result<(), RpcError> {
        let code = i32::try_from(code).unwrap_or(-32603);
        self.responder
            .respond_with_error(agent_client_protocol::Error::new(code, message))
            .map_err(|_| RpcError::local("The agent is disconnected."))
    }

    /// Resolves when the agent sends `$/cancel_request` for this request.
    pub fn cancelled(&self) -> impl Future<Output = ()> + Send + 'static {
        let cancellation = self.responder.cancellation();
        async move { cancellation.cancelled().await }
    }
}

impl std::fmt::Debug for IncomingRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IncomingRequest")
            .field("method", &self.method)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProtocolVersion {
    V1,
    V2,
}

impl ProtocolVersion {
    pub fn number(self) -> u16 {
        match self {
            Self::V1 => 1,
            Self::V2 => 2,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ClientInfo {
    pub name: String,
    pub title: String,
    pub version: String,
}

#[derive(Clone, Debug)]
pub struct ClientOptions {
    pub info: ClientInfo,
    /// Ask for protocol v2 (the Experimental switch); agents that answer
    /// with v1 are restarted with v1.
    pub prefer_v2: bool,
    /// Advertise `fs/read_text_file`.
    pub fs_read: bool,
}

#[derive(Debug)]
pub enum InitializeError {
    Rpc(RpcError),
    /// The program answered, but not as an ACP agent this client supports.
    NotAcp(String),
    /// The agent answered a v2 request with v1: start it again with v1.
    FallBackToV1,
}

impl std::fmt::Display for InitializeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rpc(error) => write!(f, "{error}"),
            Self::NotAcp(message) => write!(f, "{message}"),
            Self::FallBackToV1 => write!(f, "The agent only supports ACP version 1."),
        }
    }
}

impl From<InitializeError> for String {
    fn from(error: InitializeError) -> Self {
        error.to_string()
    }
}

/// What `initialize` settled on.
#[derive(Clone, Debug)]
pub struct Negotiated {
    pub protocol: ProtocolVersion,
    pub capabilities: AgentCapabilities,
    pub auth_methods: Vec<AuthMethod>,
    pub agent_name: Option<String>,
    pub agent_title: Option<String>,
    pub agent_version: Option<String>,
    /// The agent's full answer, for fields this crate does not model.
    pub raw: Value,
}

/// How long a turn may run.
#[derive(Clone, Debug, Default)]
pub struct TurnTiming {
    /// Stop the agent when nothing arrives for this long, unless `hold`.
    pub inactivity: Option<Duration>,
    /// Stop the agent when the whole turn takes longer than this.
    pub absolute: Option<Duration>,
    /// While true (a permission card or question is open) the inactivity
    /// clock is paused; it restarts when the value changes.
    pub hold: Option<watch::Receiver<bool>>,
}

enum Routed {
    Notification(UntypedMessage),
    Request(UntypedMessage, Responder<Value>),
    Reply {
        token: u64,
        result: Result<Value, agent_client_protocol::Error>,
    },
    /// The connection ended with this message. It is queued behind what the
    /// agent sent before, so replies and updates already received are
    /// handled first; pending requests fail only then.
    Closed(String),
}

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>;

struct Shared {
    connection: watch::Receiver<Option<ConnectionTo<Agent>>>,
    pending: Pending,
    next_token: AtomicU64,
    route: mpsc::Sender<Routed>,
    stop: watch::Sender<bool>,
    closed: watch::Sender<bool>,
    /// Set once the agent's process has been reaped (or given up on), always
    /// after `closed`. True from the start for a client over plain streams.
    exited: watch::Sender<bool>,
    closed_routed: AtomicBool,
    /// Set once the consumer failed the pending requests after the close: a
    /// request registered later fails at once.
    drained: AtomicBool,
    finished: watch::Sender<bool>,
    stderr: StderrTail,
    activity: watch::Sender<Instant>,
    negotiated: Mutex<Option<Negotiated>>,
    pid: Option<u32>,
    /// v2: the running prompt of each session, ended by an idle state.
    turn_waiters: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    /// v1: the pending `session/prompt` requests, by token, with their
    /// session. Their reply ends the turn.
    turn_replies: Mutex<HashMap<u64, String>>,
    translator: Mutex<V2Translator>,
}

impl Shared {
    fn is_closed(&self) -> bool {
        *self.closed.borrow()
    }

    fn protocol(&self) -> ProtocolVersion {
        self.negotiated
            .lock()
            .ok()
            .and_then(|negotiated| negotiated.as_ref().map(|value| value.protocol))
            .unwrap_or(ProtocolVersion::V1)
    }

    fn map_reply(
        &self,
        result: Result<Value, agent_client_protocol::Error>,
    ) -> Result<Value, RpcError> {
        match result {
            Ok(value) => Ok(value),
            Err(error)
                if agent_client_protocol::is_incoming_transport_closed(&error)
                    || self.is_closed() =>
            {
                Err(RpcError::local(&disconnect_message(
                    "The agent disconnected before replying.",
                    &self.stderr.text(),
                )))
            }
            Err(error) => Err(RpcError {
                code: i64::from(i32::from(error.code)),
                message: rpc_error_message(&json!({"message": error.message})),
            }),
        }
    }

    /// Hands one agent notification to the host.
    fn route_notification(&self, host: &dyn ClientHost, message: UntypedMessage) {
        self.activity.send_replace(Instant::now());
        let (method, params) = message.into_parts();
        match method.as_str() {
            "session/update" if self.protocol() == ProtocolVersion::V2 => {
                self.route_v2_update(host, &params);
            }
            "session/update" => host.on_update(params),
            DROPPED_UPDATE_METHOD => {
                host.on_dropped_update(params["bytes"].as_u64().unwrap_or(0) as usize);
            }
            _ => host.on_notification(&method, params),
        }
    }

    /// Translates a v2 `session/update` and hands the results to the host. A
    /// turn's end also wakes the prompt waiting on it.
    fn route_v2_update(&self, host: &dyn ClientHost, params: &Value) {
        let translated = self
            .translator
            .lock()
            .map(|mut translator| translator.translate(params))
            .unwrap_or_default();
        for item in translated {
            match item {
                Translated::Update(update) => host.on_update(update),
                Translated::TurnEnd {
                    session_id,
                    outcome,
                } => {
                    host.on_turn_ended(&session_id);
                    let waiter = self
                        .turn_waiters
                        .lock()
                        .ok()
                        .and_then(|mut waiters| waiters.remove(&session_id));
                    if let Some(waiter) = waiter {
                        let _ = waiter.send(outcome);
                    }
                }
            }
        }
    }

    /// Hands one agent request to the host. A v2 permission request that
    /// can't be translated is cancelled here.
    fn route_request(
        &self,
        host: &dyn ClientHost,
        message: UntypedMessage,
        responder: Responder<Value>,
    ) {
        self.activity.send_replace(Instant::now());
        let (method, params) = message.into_parts();
        let params =
            if method == "session/request_permission" && self.protocol() == ProtocolVersion::V2 {
                match permission_params_to_v1(&params) {
                    Some(params) => params,
                    None => {
                        let _ = responder.respond(json!({"outcome": {"outcome": "cancelled"}}));
                        return;
                    }
                }
            } else {
                params
            };
        host.on_request(IncomingRequest {
            method,
            params,
            responder,
        });
    }

    /// Ends the turn a reply closes, then delivers the reply to its caller.
    fn route_reply(
        &self,
        host: &dyn ClientHost,
        token: u64,
        result: Result<Value, agent_client_protocol::Error>,
    ) {
        let turn = self
            .turn_replies
            .lock()
            .ok()
            .and_then(|mut turns| turns.remove(&token));
        if let Some(session_id) = turn {
            host.on_turn_ended(&session_id);
        }
        let result = self.map_reply(result);
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&token));
        if let Some(sender) = sender {
            let _ = sender.send(result);
        }
    }

    /// Ends the connection. The close is queued behind everything the agent
    /// sent before it: the consumer hands those to the host first, then
    /// fails every pending request (and v2 turn) with `message` and tells
    /// the host once.
    fn close_with(self: &Arc<Self>, message: &str) {
        self.closed.send_replace(true);
        let _ = self.stop.send(true);
        if !self.closed_routed.swap(true, Ordering::AcqRel) {
            let route = self.route.clone();
            let shared = self.clone();
            let message = message.to_owned();
            tokio::spawn(async move {
                if let Err(unsent) = route.send(Routed::Closed(message)).await {
                    // No consumer is left to drain them.
                    if let Routed::Closed(message) = unsent.0 {
                        shared.fail_pending(&message);
                    }
                }
            });
        }
    }

    /// Fails every pending request with `message` and ends every v2 turn
    /// still waiting (its prompt sees the disconnect).
    fn fail_pending(&self, message: &str) {
        self.drained.store(true, Ordering::Release);
        let drained: Vec<_> = self
            .pending
            .lock()
            .map(|mut pending| pending.drain().collect())
            .unwrap_or_default();
        for (_, sender) in drained {
            let _ = sender.send(Err(RpcError::local(message)));
        }
        if let Ok(mut waiters) = self.turn_waiters.lock() {
            waiters.clear();
        }
        if let Ok(mut turns) = self.turn_replies.lock() {
            turns.clear();
        }
    }
}

/// A connection to one agent process (or any pair of streams in tests).
pub struct AcpClient {
    shared: Arc<Shared>,
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        let _ = self.shared.stop.send(true);
    }
}

impl AcpClient {
    /// Starts the agent, contains its process tree and connects to it.
    pub async fn spawn(
        mut command: tokio::process::Command,
        host: Arc<dyn ClientHost>,
    ) -> Result<Arc<AcpClient>, String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        isolate_process_tree(&mut command);
        let program = command.as_std().get_program().to_owned();
        let mut child = command.spawn().map_err(|error| {
            format!(
                "The agent could not be started. Check its installation and executable permissions. ({:?}: {})",
                error.kind(),
                std::path::Path::new(&program).display()
            )
        })?;
        let pid = child.id().ok_or("The agent process has no ID.")?;
        let guard = match contain_process_tree(pid) {
            Ok(guard) => guard,
            Err(_) => {
                let _ = child.kill().await;
                return Err("The agent process could not be contained.".into());
            }
        };
        let stdin = child.stdin.take().ok_or("The agent has no input stream.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("The agent has no output stream.")?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("The agent has no error stream.")?;
        let client = Self::connect(stdout, stdin, host, Some(pid));
        let shared = client.shared.clone();
        let tail = shared.stderr.clone();
        let diagnostics = tokio::spawn(async move {
            let mut buffer = [0u8; 8192];
            loop {
                match stderr.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => tail.push(&buffer[..count]),
                }
            }
        });
        let mut stop = shared.stop.subscribe();
        let mut finished = shared.finished.subscribe();
        tokio::spawn(async move {
            // The stop branch drops its watch guard before the other
            // branch awaits, which keeps this task `Send`.
            tokio::select! {
                _ = async { let _ = stop.wait_for(|stop| *stop).await; } => {}
                _ = child.wait() => {
                    // Let the connection hand over what the agent wrote last.
                    let _ = tokio::time::timeout(
                        Duration::from_millis(500),
                        finished.wait_for(|done| *done),
                    )
                    .await;
                }
            }
            drop(guard);
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            diagnostics.abort();
            shared.close_with(&disconnect_message(
                "The agent disconnected.",
                &shared.stderr.text(),
            ));
            shared.exited.send_replace(true);
        });
        Ok(client)
    }

    /// Connects over an agent's stdout and stdin (tests use in-memory pipes).
    pub fn from_streams<R, W>(stdout: R, stdin: W, host: Arc<dyn ClientHost>) -> Arc<AcpClient>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        Self::connect(stdout, stdin, host, None)
    }

    fn connect<R, W>(
        stdout: R,
        stdin: W,
        host: Arc<dyn ClientHost>,
        pid: Option<u32>,
    ) -> Arc<AcpClient>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let (route_tx, mut route_rx) = mpsc::channel::<Routed>(256);
        let (connection_tx, connection_rx) = watch::channel(None);
        let shared = Arc::new(Shared {
            connection: connection_rx,
            pending: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
            route: route_tx.clone(),
            stop: watch::channel(false).0,
            closed: watch::channel(false).0,
            exited: watch::channel(pid.is_none()).0,
            closed_routed: AtomicBool::new(false),
            drained: AtomicBool::new(false),
            finished: watch::channel(false).0,
            stderr: StderrTail::default(),
            activity: watch::channel(Instant::now()).0,
            negotiated: Mutex::new(None),
            pid,
            turn_waiters: Mutex::new(HashMap::new()),
            turn_replies: Mutex::new(HashMap::new()),
            translator: Mutex::new(V2Translator::default()),
        });

        // The SDK connection. Its handlers only forward into the route
        // channel; awaiting the bounded channel is the backpressure that
        // stops reading while the host falls behind.
        let requests = route_tx.clone();
        let notifications = route_tx.clone();
        let mut stop = shared.stop.subscribe();
        let connection_shared = shared.clone();
        tokio::spawn(async move {
            let transport = line_transport(stdout, stdin);
            let _ = Client
                .builder()
                .without_acp_version_guard()
                .on_receive_request(
                    async move |request: UntypedMessage, responder: Responder<Value>, _cx| {
                        let _ = requests.send(Routed::Request(request, responder)).await;
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_notification(
                    async move |notification: UntypedMessage, _cx| {
                        if notification.method() != "$/cancel_request" {
                            let _ = notifications.send(Routed::Notification(notification)).await;
                        }
                        Ok(())
                    },
                    agent_client_protocol::on_receive_notification!(),
                )
                .connect_with(transport, async move |cx: ConnectionTo<Agent>| {
                    connection_tx.send_replace(Some(cx.clone()));
                    tokio::select! {
                        _ = stop.wait_for(|stop| *stop) => {}
                        _ = cx.incoming_closed() => {}
                    }
                    Ok(())
                })
                .await;
            connection_shared.finished.send_replace(true);
            connection_shared.close_with(&disconnect_message(
                "The agent disconnected.",
                &connection_shared.stderr.text(),
            ));
        });

        // One consumer, in wire order.
        let consumer = shared.clone();
        tokio::spawn(async move {
            while let Some(item) = route_rx.recv().await {
                match item {
                    Routed::Notification(message) => {
                        consumer.route_notification(host.as_ref(), message);
                    }
                    Routed::Request(message, responder) => {
                        consumer.route_request(host.as_ref(), message, responder);
                    }
                    Routed::Reply { token, result } => {
                        consumer.route_reply(host.as_ref(), token, result);
                    }
                    Routed::Closed(message) => {
                        consumer.fail_pending(&message);
                        host.on_disconnected();
                        break;
                    }
                }
            }
        });

        Arc::new(AcpClient { shared })
    }

    async fn connection(&self) -> Result<ConnectionTo<Agent>, RpcError> {
        let mut connection = self.shared.connection.clone();
        let ready =
            tokio::time::timeout(Duration::from_secs(5), connection.wait_for(Option::is_some))
                .await;
        match ready {
            Ok(Ok(value)) => value
                .clone()
                .ok_or_else(|| RpcError::local("The agent is disconnected.")),
            _ => Err(RpcError::local("The agent is disconnected.")),
        }
    }

    /// Sends a request and registers its reply, without waiting.
    async fn send_request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<(PendingGuard, oneshot::Receiver<Result<Value, RpcError>>), RpcError> {
        self.send_request_for(method, params, None).await
    }

    /// `send_request` for a request whose reply ends a turn of `turn_of`.
    async fn send_request_for(
        &self,
        method: &str,
        params: Value,
        turn_of: Option<&str>,
    ) -> Result<(PendingGuard, oneshot::Receiver<Result<Value, RpcError>>), RpcError> {
        if self.shared.is_closed() {
            return Err(RpcError::local("The agent is disconnected."));
        }
        let size = serde_json::to_vec(&params)
            .map_err(|_| RpcError::local("This ACP request could not be encoded."))?
            .len();
        if size >= MAX_FRAME - 256 {
            return Err(RpcError::local(
                "This ACP request exceeds the 1 MiB message limit.",
            ));
        }
        let connection = self.connection().await?;
        let token = self.shared.next_token.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self
                .shared
                .pending
                .lock()
                .map_err(|_| RpcError::local("The ACP connection is unavailable."))?;
            if pending.len() >= MAX_PENDING {
                return Err(RpcError::local("Too many ACP requests are pending."));
            }
            pending.insert(token, sender);
        }
        let guard = PendingGuard {
            shared: self.shared.clone(),
            token,
        };
        // The close was handled while this request was being registered:
        // nothing will answer or fail it.
        if self.shared.drained.load(Ordering::Acquire) {
            return Err(RpcError::local("The agent is disconnected."));
        }
        // Known before the request goes out, so the reply can't beat it.
        if let (Some(session), Ok(mut turns)) = (turn_of, self.shared.turn_replies.lock()) {
            turns.insert(token, session.to_owned());
        }
        let message = UntypedMessage::new(method, params)
            .map_err(|_| RpcError::local("This ACP request could not be encoded."))?;
        let route = self.shared.route.clone();
        connection
            .prepare_request(message)
            .on_receiving_result(move |result| async move {
                let _ = route.send(Routed::Reply { token, result }).await;
                Ok(())
            })
            .map_err(|_| RpcError::local("The agent is disconnected."))?;
        Ok((guard, receiver))
    }

    fn disconnected_before_reply(&self) -> RpcError {
        RpcError::local(&disconnect_message(
            "The agent disconnected before replying.",
            &self.shared.stderr.text(),
        ))
    }

    /// Like [`Self::request`], but `quiet` is how long the agent may send
    /// nothing, not how long the whole reply may take: every message from the
    /// agent restarts it. For a reply that streams updates first.
    async fn request_while_active(
        &self,
        method: &str,
        params: Value,
        quiet: Duration,
    ) -> Result<Value, RpcError> {
        let (_guard, receiver) = self.send_request(method, params).await?;
        tokio::pin!(receiver);
        let started = Instant::now();
        let mut activity = self.shared.activity.subscribe();
        loop {
            let end = (*activity.borrow()).max(started) + quiet;
            tokio::select! {
                result = &mut receiver => {
                    return match result {
                        Ok(result) => result,
                        Err(_) => Err(self.disconnected_before_reply()),
                    };
                }
                changed = activity.changed() => {
                    if changed.is_err() {
                        return Err(self.disconnected_before_reply());
                    }
                }
                _ = tokio::time::sleep_until(end) => {
                    if Instant::now() >= (*activity.borrow()).max(started) + quiet {
                        let _ = self.shared.stop.send(true);
                        return Err(RpcError::local(
                            "The agent did not reply in time and was stopped.",
                        ));
                    }
                }
            }
        }
    }

    /// Sends `method` and waits for its reply. Past `deadline` the agent is
    /// stopped.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        deadline: Duration,
    ) -> Result<Value, RpcError> {
        let (_guard, receiver) = self.send_request(method, params).await?;
        match tokio::time::timeout(deadline, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(self.disconnected_before_reply()),
            Err(_) => {
                let _ = self.shared.stop.send(true);
                Err(RpcError::local(
                    "The agent did not reply in time and was stopped.",
                ))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), RpcError> {
        if self.shared.is_closed() {
            return Err(RpcError::local("The agent is disconnected."));
        }
        let size = serde_json::to_vec(&params)
            .map_err(|_| RpcError::local("This ACP request could not be encoded."))?
            .len();
        if size >= MAX_FRAME - 256 {
            return Err(RpcError::local(
                "This ACP request exceeds the 1 MiB message limit.",
            ));
        }
        let connection = self
            .shared
            .connection
            .borrow()
            .clone()
            .ok_or_else(|| RpcError::local("The agent is disconnected."))?;
        let message = UntypedMessage::new(method, params)
            .map_err(|_| RpcError::local("This ACP request could not be encoded."))?;
        connection
            .send_notification(message)
            .map_err(|_| RpcError::local("The agent is disconnected."))
    }

    /// Negotiates the protocol and records what the agent can do.
    pub async fn initialize(&self, options: &ClientOptions) -> Result<Negotiated, InitializeError> {
        let version = if options.prefer_v2 {
            ProtocolVersion::V2
        } else {
            ProtocolVersion::V1
        };
        let response = self
            .request(
                "initialize",
                initialize_params(options, version),
                REQUEST_TIMEOUT,
            )
            .await
            .map_err(InitializeError::Rpc)?;
        let negotiated = parse_initialize(&response, version)?;
        if let Ok(mut slot) = self.shared.negotiated.lock() {
            *slot = Some(negotiated.clone());
        }
        Ok(negotiated)
    }

    pub fn negotiated(&self) -> Option<Negotiated> {
        self.shared
            .negotiated
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub async fn new_session(&self, cwd: &str, mcp_servers: &[Value]) -> Result<Value, RpcError> {
        self.request(
            "session/new",
            json!({"cwd": cwd, "mcpServers": mcp_servers}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn load_session(
        &self,
        session: &str,
        cwd: &str,
        mcp_servers: &[Value],
    ) -> Result<Value, RpcError> {
        if self.protocol() == ProtocolVersion::V2 {
            return Err(RpcError::local(
                "ACP v2 has no session/load. Resume the session instead.",
            ));
        }
        // The agent answers only after replaying the whole conversation as
        // updates, which can take longer than the deadline of a plain request.
        self.request_while_active(
            "session/load",
            json!({"sessionId": session, "cwd": cwd, "mcpServers": mcp_servers}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn resume_session(
        &self,
        session: &str,
        cwd: &str,
        mcp_servers: &[Value],
    ) -> Result<Value, RpcError> {
        self.request(
            "session/resume",
            json!({"sessionId": session, "cwd": cwd, "mcpServers": mcp_servers}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn list_sessions(
        &self,
        cwd: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Value, RpcError> {
        let mut params = serde_json::Map::new();
        if let Some(cwd) = cwd {
            params.insert("cwd".into(), json!(cwd));
        }
        if let Some(cursor) = cursor {
            params.insert("cursor".into(), json!(cursor));
        }
        self.request("session/list", Value::Object(params), REQUEST_TIMEOUT)
            .await
    }

    pub async fn fork_session(
        &self,
        session: &str,
        cwd: &str,
        mcp_servers: &[Value],
    ) -> Result<Value, RpcError> {
        self.request(
            "session/fork",
            json!({"sessionId": session, "cwd": cwd, "mcpServers": mcp_servers}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn close_session(&self, session: &str) -> Result<(), RpcError> {
        self.request(
            "session/close",
            json!({"sessionId": session}),
            REQUEST_TIMEOUT,
        )
        .await
        .map(|_| ())
    }

    pub async fn delete_session(&self, session: &str) -> Result<(), RpcError> {
        self.request(
            "session/delete",
            json!({"sessionId": session}),
            REQUEST_TIMEOUT,
        )
        .await
        .map(|_| ())
    }

    pub async fn set_config_option(
        &self,
        session: &str,
        config_id: &str,
        value: &ConfigValue,
    ) -> Result<Value, RpcError> {
        self.request(
            "session/set_config_option",
            set_config_option_params(session, config_id, value),
            REQUEST_TIMEOUT,
        )
        .await
    }

    /// Legacy v1 mode switch, for agents without config options.
    pub async fn set_mode(&self, session: &str, mode_id: &str) -> Result<Value, RpcError> {
        if self.protocol() == ProtocolVersion::V2 {
            return Err(RpcError::local(
                "ACP v2 has no session/set_mode. Use the mode option.",
            ));
        }
        self.request(
            "session/set_mode",
            json!({"sessionId": session, "modeId": mode_id}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    /// Legacy v1 model switch, for agents without a model config option.
    /// V2 moved the model to config options, but an agent that still lists
    /// its models the v1 way (Claude Code does) answers this request too; a
    /// refusal here left every model but the current one unselectable.
    pub async fn set_model(&self, session: &str, model_id: &str) -> Result<Value, RpcError> {
        self.request(
            "session/set_model",
            json!({"sessionId": session, "modelId": model_id}),
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub async fn authenticate(
        &self,
        method_id: &str,
        meta: Option<Value>,
        deadline: Duration,
    ) -> Result<Value, RpcError> {
        let mut params = json!({"methodId": method_id});
        if let Some(meta) = meta {
            params["_meta"] = meta;
        }
        let method = if self.protocol() == ProtocolVersion::V2 {
            "auth/login"
        } else {
            "authenticate"
        };
        self.request(method, params, deadline).await
    }

    pub async fn logout(&self) -> Result<(), RpcError> {
        let method = if self.protocol() == ProtocolVersion::V2 {
            "auth/logout"
        } else {
            "logout"
        };
        self.request(method, json!({}), REQUEST_TIMEOUT)
            .await
            .map(|_| ())
    }

    pub fn protocol(&self) -> ProtocolVersion {
        self.shared.protocol()
    }

    /// Sends one turn and waits for its end under `timing`. Under v2 the
    /// prompt is accepted at once and ends when the session reports idle,
    /// after every earlier update reached the host.
    pub async fn prompt(
        &self,
        session: &str,
        blocks: Vec<Value>,
        timing: TurnTiming,
    ) -> Result<Value, RpcError> {
        self.prompt_with(session, blocks, timing, true).await
    }

    /// [`Self::prompt`] for a turn whose time limits end only the turn: when
    /// one passes the agent is sent `session/cancel` and keeps running.
    pub async fn prompt_or_cancel(
        &self,
        session: &str,
        blocks: Vec<Value>,
        timing: TurnTiming,
    ) -> Result<Value, RpcError> {
        self.prompt_with(session, blocks, timing, false).await
    }

    /// Ends a turn whose time ran out: stops the agent, or with `stop`
    /// false only cancels the turn.
    fn turn_timed_out(&self, session: &str, stop: bool) {
        if stop {
            let _ = self.shared.stop.send(true);
        } else {
            let _ = self.cancel(session);
        }
    }

    async fn prompt_with(
        &self,
        session: &str,
        blocks: Vec<Value>,
        timing: TurnTiming,
        stop_on_timeout: bool,
    ) -> Result<Value, RpcError> {
        let waiter = if self.protocol() == ProtocolVersion::V2 {
            let (sender, receiver) = oneshot::channel();
            self.shared
                .turn_waiters
                .lock()
                .map_err(|_| RpcError::local("The ACP connection is unavailable."))?
                .insert(session.to_owned(), sender);
            Some((
                receiver,
                TurnWaiterGuard {
                    shared: self.shared.clone(),
                    session: session.to_owned(),
                },
            ))
        } else {
            None
        };
        // Under v1 the reply ends the turn; v2 ends it with an idle state.
        let ends_turn = waiter.is_none().then_some(session);
        let (_guard, reply) = self
            .send_request_for(
                "session/prompt",
                json!({"sessionId": session, "prompt": blocks}),
                ends_turn,
            )
            .await?;
        let receiver = async {
            let accepted = match reply.await {
                Ok(result) => result?,
                Err(_) => return Err(self.disconnected_before_reply()),
            };
            match waiter {
                None => Ok(accepted),
                Some((ended, _waiter_guard)) => {
                    ended.await.map_err(|_| self.disconnected_before_reply())
                }
            }
        };
        tokio::pin!(receiver);
        let started = Instant::now();
        let mut activity = self.shared.activity.subscribe();
        let mut hold = timing.hold;
        let mut quiet_since = Instant::now();
        loop {
            let now = Instant::now();
            let held = hold.as_ref().is_some_and(|hold| *hold.borrow());
            let mut wake: Option<Instant> = None;
            if let Some(limit) = timing.absolute {
                let end = started + limit;
                if now >= end {
                    self.turn_timed_out(session, stop_on_timeout);
                    return Err(RpcError::local(if stop_on_timeout {
                        "The agent did not reply in time and was stopped."
                    } else {
                        "The agent did not reply in time."
                    }));
                }
                wake = Some(wake.map_or(end, |wake| wake.min(end)));
            }
            if let (Some(limit), false) = (timing.inactivity, held) {
                let last = (*activity.borrow()).max(quiet_since);
                let end = last + limit;
                if now >= end && !stop_on_timeout {
                    self.turn_timed_out(session, false);
                    return Err(RpcError::local("The agent did not reply in time."));
                }
                if now >= end {
                    let _ = self.shared.stop.send(true);
                    let minutes = (limit.as_secs() / 60).max(1);
                    return Err(RpcError::local(&format!(
                        "The agent sent nothing for {minutes} minutes, so Oleafly stopped it. Reconnect to continue."
                    )));
                }
                wake = Some(wake.map_or(end, |wake| wake.min(end)));
            }
            let sleep = tokio::time::sleep_until(wake.unwrap_or(now + Duration::from_secs(3600)));
            tokio::select! {
                result = &mut receiver => {
                    return result;
                }
                changed = activity.changed() => {
                    if changed.is_err() {
                        return Err(self.disconnected_before_reply());
                    }
                }
                _ = hold_changed(&mut hold) => {
                    quiet_since = Instant::now();
                }
                _ = sleep => {}
            }
        }
    }

    /// Tells the agent to stop the running turn (`session/cancel`).
    pub fn cancel(&self, session: &str) -> Result<(), RpcError> {
        self.notify("session/cancel", json!({"sessionId": session}))
    }

    /// Adds a message to a running turn.
    pub async fn steer(&self, session: &str, blocks: Vec<Value>) -> Result<Value, RpcError> {
        self.request(
            "_session/steering",
            json!({
                "sessionId": session,
                "prompt": blocks,
                "_meta": {"steering": {"idleBehavior": "promptRequired"}},
            }),
            REQUEST_TIMEOUT,
        )
        .await
    }

    /// Stops the agent and waits (up to 7 s) until the connection is closed.
    pub async fn shutdown(&self) {
        let _ = self.shared.stop.send(true);
        let mut closed = self.shared.closed.subscribe();
        let mut exited = self.shared.exited.subscribe();
        let _ = tokio::time::timeout(Duration::from_secs(7), async {
            let _ = closed.wait_for(|closed| *closed).await;
            // The connection closes as soon as it stops, while the agent's
            // process may still be exiting. Callers often delete the agent's
            // working folder next, which Windows refuses while a process runs
            // there, so wait for the process too.
            let _ = exited.wait_for(|exited| *exited).await;
        })
        .await;
    }

    pub fn request_stop(&self) {
        let _ = self.shared.stop.send(true);
    }

    pub fn is_closed(&self) -> bool {
        self.shared.is_closed()
    }

    pub fn stderr_tail(&self) -> String {
        self.shared.stderr.text()
    }

    pub fn pid(&self) -> Option<u32> {
        self.shared.pid
    }
}

async fn hold_changed(hold: &mut Option<watch::Receiver<bool>>) {
    match hold {
        Some(receiver) => {
            if receiver.changed().await.is_err() {
                *hold = None;
            }
        }
        None => std::future::pending::<()>().await,
    }
}

/// Removes a v2 turn waiter when its prompt stops waiting.
struct TurnWaiterGuard {
    shared: Arc<Shared>,
    session: String,
}

impl Drop for TurnWaiterGuard {
    fn drop(&mut self) {
        if let Ok(mut waiters) = self.shared.turn_waiters.lock() {
            waiters.remove(&self.session);
        }
    }
}

/// Removes a request's reply slot when its waiter stops waiting.
struct PendingGuard {
    shared: Arc<Shared>,
    token: u64,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.shared.pending.lock() {
            pending.remove(&self.token);
        }
        if let Ok(mut turns) = self.shared.turn_replies.lock() {
            turns.remove(&self.token);
        }
    }
}
