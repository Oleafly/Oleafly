use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::SET_COOKIE;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Instant, Interval};
use tokio_tungstenite::tungstenite::http::{header, HeaderMap, HeaderValue};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use url::Url;

use super::codec::{self, Frame, FrameError};
use super::events::{PublicId, Rejection, ServerEvent};
use super::page::ProjectPage;
use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::session::SessionHandle;

const DEFAULT_SILENCE: Duration = Duration::from_secs(45);
const SLEEP_JUMP: Duration = Duration::from_secs(20);
const WATCH_TICK: Duration = Duration::from_secs(5);
const JOIN_TIMEOUT: Duration = Duration::from_secs(30);
const WEBSOCKET_TRIES: usize = 3;
const RATE_LIMIT_WAIT: Duration = Duration::from_secs(15);
const CLOSE_WAIT: Duration = Duration::from_secs(5);
const REQUEST_SLACK: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Carrier {
    WebSocket,
    XhrPolling,
}

impl Carrier {
    pub fn wire_name(self) -> &'static str {
        match self {
            Carrier::WebSocket => "websocket",
            Carrier::XhrPolling => "xhr-polling",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Tuning {
    pub silence: Option<Duration>,
    pub tick: Duration,
    pub sleep_jump: Duration,
    pub join_timeout: Duration,
    pub wall_clock: fn() -> SystemTime,
    pub proxy: Option<String>,
}

impl Default for Tuning {
    fn default() -> Tuning {
        Tuning {
            silence: None,
            tick: WATCH_TICK,
            sleep_jump: SLEEP_JUMP,
            join_timeout: JOIN_TIMEOUT,
            wall_clock: SystemTime::now,
            proxy: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct JoinProject {
    pub public_id: PublicId,
    pub response: Value,
}

impl JoinProject {
    pub fn project(&self) -> &Value {
        self.response.get("project").unwrap_or(&Value::Null)
    }
}

#[derive(Debug)]
pub enum RealtimeError {
    Rejected(Rejection),
    Handshake(String),
    Transport(String),
    Closed(String),
    TimedOut,
    Malformed(String),
    Page(OnlineError),
}

impl std::fmt::Display for RealtimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RealtimeError::Rejected(Rejection::Other(message)) => {
                write!(f, "the server sent connectionRejected: {message}")
            }
            RealtimeError::Rejected(rejection) => {
                write!(f, "the server sent connectionRejected ({rejection:?})")
            }
            RealtimeError::Handshake(detail) => write!(f, "the handshake failed: {detail}"),
            RealtimeError::Transport(detail) => write!(f, "the connection failed: {detail}"),
            RealtimeError::Closed(detail) => write!(f, "{detail}"),
            RealtimeError::TimedOut => f.write_str("the server did not send the project"),
            RealtimeError::Malformed(raw) => {
                write!(f, "the server sent a frame that won't parse: {raw}")
            }
            RealtimeError::Page(error) => write!(f, "the editor page failed: {:?}", error.kind),
        }
    }
}

impl std::error::Error for RealtimeError {}

impl RealtimeError {
    pub fn retry_after(&self, attempt: usize) -> Option<Duration> {
        let backoff = Duration::from_millis(oleafly_net::reconnect::backoff_wait(attempt));
        match self {
            RealtimeError::Rejected(Rejection::RateLimited) => Some(backoff.max(RATE_LIMIT_WAIT)),
            RealtimeError::Rejected(
                Rejection::SignedOut | Rejection::NotAuthorized | Rejection::ProjectGone,
            ) => None,
            RealtimeError::Page(error)
                if matches!(
                    error.kind,
                    OnlineErrorKind::SessionExpired | OnlineErrorKind::ProjectUnavailable
                ) =>
            {
                None
            }
            _ => Some(backoff),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallError {
    Closed,
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the connection closed before the server answered")
    }
}

impl std::error::Error for CallError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Dropped {
    Closed,
    ServerClosed,
    ServerError(String),
    Silent(Duration),
    Slept(Duration),
    Malformed(String),
    Transport(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Handshake {
    sid: String,
    heartbeat: Option<Duration>,
    transports: Vec<String>,
}

fn parse_handshake(body: &str) -> Option<Handshake> {
    let mut fields = body.trim().split(':');
    let sid = fields.next()?;
    let heartbeat = fields.next()?;
    let close = fields.next()?;
    let transports = fields.next()?;
    let digits = |field: &str| field.bytes().all(|byte| byte.is_ascii_digit());
    let named = |name: &str| {
        !name.is_empty()
            && name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
    };
    let usable = fields.next().is_none()
        && !sid.is_empty()
        && sid
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        && digits(heartbeat)
        && digits(close)
        && transports.split(',').all(named);
    usable.then(|| Handshake {
        sid: sid.to_string(),
        heartbeat: heartbeat
            .parse::<u64>()
            .ok()
            .filter(|seconds| *seconds > 0)
            .map(Duration::from_secs),
        transports: transports.split(',').map(str::to_string).collect(),
    })
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn set_cookie_lines(headers: &reqwest::header::HeaderMap) -> Vec<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_string))
        .collect()
}

fn absorb(session: &SessionHandle, response: &reqwest::Response) {
    let lines = set_cookie_lines(response.headers());
    session.absorb(lines.iter().map(String::as_str));
}

fn resource(http: &Http, page: &ProjectPage) -> Result<Url, RealtimeError> {
    let raw = page
        .ws_url()
        .unwrap_or_else(|| format!("{}/socket.io", http.base));
    let mut url = Url::parse(&raw)
        .map_err(|error| RealtimeError::Handshake(format!("the address is not valid: {error}")))?;
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(if path.is_empty() { "/socket.io" } else { &path });
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn under(base: &Url, tail: &str) -> String {
    format!("{}{tail}", base.as_str().trim_end_matches('/'))
}

fn wants_ping(carrier: Carrier) -> &'static str {
    match carrier {
        Carrier::WebSocket => "&esh=1&ssp=1",
        Carrier::XhrPolling => "",
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

struct Context<'a> {
    http: &'a Http,
    session: &'a SessionHandle,
    page: &'a ProjectPage,
    tuning: &'a Tuning,
}

enum Attempt {
    NotSocketIo(String),
    NotOffered,
    Transport(String),
    Failed(RealtimeError),
}

#[derive(Clone)]
struct Poller {
    http: Http,
    session: SessionHandle,
    channel: String,
    timeout: Duration,
}

impl Poller {
    async fn get(self) -> Result<Vec<String>, String> {
        let response = self
            .http
            .get_at(
                &format!("{}&t={}", self.channel, now_millis()),
                &self.session.cookie(),
            )
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        absorb(&self.session, &response);
        if !response.status().is_success() {
            return Err(format!(
                "a poll was refused with HTTP {}",
                response.status().as_u16()
            ));
        }
        let body = response.text().await.map_err(|error| error.to_string())?;
        Ok(codec::decode_payload(&body))
    }

    async fn post(&self, frames: &[String]) -> Result<(), String> {
        let response = self
            .http
            .post_at(
                &format!("{}&t={}", self.channel, now_millis()),
                &self.session.cookie(),
            )
            .timeout(self.timeout)
            .body(codec::encode_payload(frames))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        absorb(&self.session, &response);
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "a send was refused with HTTP {}",
                response.status().as_u16()
            ))
        }
    }
}

type Socket = oleafly_net::WebSocket;

enum Rx {
    WebSocket(SplitStream<Socket>),
    Polling(Poller),
}

enum Tx {
    WebSocket(SplitSink<Socket, Message>),
    Polling(Poller),
}

impl Tx {
    async fn send(&mut self, frames: Vec<String>) -> Result<(), String> {
        match self {
            Tx::WebSocket(sink) => {
                for frame in frames {
                    sink.send(Message::text(frame))
                        .await
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            }
            Tx::Polling(poller) => poller.post(&frames).await,
        }
    }

    async fn close(&mut self) {
        let _ = self.send(vec![codec::encode(&Frame::Disconnect)]).await;
        if let Tx::WebSocket(sink) = self {
            let _ = sink.close().await;
        }
    }
}

async fn receive(rx: &mut Rx) -> Result<Vec<String>, String> {
    match rx {
        Rx::WebSocket(stream) => match stream.next().await {
            Some(Ok(Message::Text(text))) => Ok(codec::decode_payload(text.as_str())),
            Some(Ok(Message::Close(_))) | None => Err("the connection closed".to_string()),
            Some(Ok(_)) => Ok(Vec::new()),
            Some(Err(error)) => Err(error.to_string()),
        },
        Rx::Polling(poller) => poller.clone().get().await,
    }
}

fn pong(args: &[Value], carrier: Carrier, sid: &str) -> String {
    let mut echoed: Vec<Value> = args.iter().take(4).cloned().collect();
    echoed.resize(4, Value::Null);
    echoed.push(json!(carrier.wire_name()));
    echoed.push(json!(sid));
    codec::encode(&Frame::event("clientPong", &echoed))
}

async fn dashboard_check(http: &Http, session: &SessionHandle) -> Option<bool> {
    match http.dashboard(&session.cookie()).await {
        Ok(dashboard) => {
            session.absorb(dashboard.set_cookies.iter().map(String::as_str));
            Some(true)
        }
        Err(error)
            if matches!(
                error.kind,
                OnlineErrorKind::SessionExpired | OnlineErrorKind::SignInFailed
            ) =>
        {
            Some(false)
        }
        Err(_) => None,
    }
}

pub(super) async fn classify(http: &Http, session: &SessionHandle, payload: &Value) -> Rejection {
    let message = payload
        .as_str()
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let code = payload.get("code").and_then(Value::as_str);
    match (message.as_str(), code) {
        ("retry", _) => Rejection::Retry,
        ("rate-limit hit when joining project", _) | (_, Some("TooManyRequests")) => {
            Rejection::RateLimited
        }
        ("invalid session" | "not authorized", _) => match dashboard_check(http, session).await {
            Some(true) => Rejection::NotAuthorized,
            Some(false) => Rejection::SignedOut,
            None => Rejection::Retry,
        },
        ("project not found", _) | (_, Some("ProjectNotFound")) => Rejection::ProjectGone,
        _ => Rejection::Other(message),
    }
}

async fn classify_lost(http: &Http, session: &SessionHandle) -> Rejection {
    match dashboard_check(http, session).await {
        Some(false) => Rejection::SignedOut,
        Some(true) | None => Rejection::Retry,
    }
}

struct Opened {
    rx: Rx,
    tx: Tx,
    carrier: Carrier,
    handshake: Handshake,
    join: JoinProject,
    early: Vec<String>,
}

async fn warm(context: &Context<'_>, base: &Url) {
    if let Ok(response) = context
        .http
        .get_at(&under(base, "/socket.io.js"), &context.session.cookie())
        .send()
        .await
    {
        absorb(context.session, &response);
    }
}

async fn handshake(
    context: &Context<'_>,
    base: &Url,
    carrier: Carrier,
) -> Result<Handshake, Attempt> {
    let url = under(
        base,
        &format!(
            "/1/?projectId={}&t={}{}",
            context.page.project_id(),
            now_millis(),
            wants_ping(carrier)
        ),
    );
    let response = context
        .http
        .get_at(&url, &context.session.cookie())
        .timeout(context.tuning.join_timeout)
        .send()
        .await
        .map_err(|error| Attempt::NotSocketIo(error.to_string()))?;
    absorb(context.session, &response);
    if !response.status().is_success() {
        return Err(Attempt::NotSocketIo(format!(
            "the handshake was refused with HTTP {}",
            response.status().as_u16()
        )));
    }
    let body = response
        .text()
        .await
        .map_err(|error| Attempt::NotSocketIo(error.to_string()))?;
    parse_handshake(&body).ok_or_else(|| {
        let shown: String = body.chars().take(60).collect();
        Attempt::NotSocketIo(format!("the handshake is not Socket.IO 0.9: {shown}"))
    })
}

fn websocket_target(base: &Url, sid: &str, project_id: &str) -> Result<Url, String> {
    let mut url = Url::parse(&under(base, &format!("/1/websocket/{sid}")))
        .map_err(|error| error.to_string())?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme)
        .map_err(|()| "the address can't carry a websocket".to_string())?;
    url.set_query(Some(&format!("projectId={project_id}&esh=1&ssp=1")));
    Ok(url)
}

async fn open_link(
    context: &Context<'_>,
    base: &Url,
    handshake: &Handshake,
    carrier: Carrier,
) -> Result<(Rx, Tx), Attempt> {
    match carrier {
        Carrier::WebSocket => {
            let target = websocket_target(base, &handshake.sid, context.page.project_id())
                .map_err(Attempt::Transport)?;
            let mut headers = HeaderMap::new();
            let mut put = |name: header::HeaderName, value: &str| {
                if let Ok(value) = HeaderValue::from_str(value) {
                    headers.insert(name, value);
                }
            };
            put(header::COOKIE, &context.session.cookie());
            put(header::ORIGIN, &context.http.origin);
            put(header::USER_AGENT, &context.http.user_agent);
            let opened = match &context.tuning.proxy {
                Some(proxy) => oleafly_net::open_websocket_through(&target, headers, proxy).await,
                None => oleafly_net::open_websocket(&target, headers).await,
            };
            let (sink, stream) = opened
                .map_err(|error| Attempt::Transport(error.to_string()))?
                .split();
            Ok((Rx::WebSocket(stream), Tx::WebSocket(sink)))
        }
        Carrier::XhrPolling => {
            let poller = Poller {
                http: context.http.clone(),
                session: context.session.clone(),
                channel: under(
                    base,
                    &format!(
                        "/1/xhr-polling/{}?projectId={}",
                        handshake.sid,
                        context.page.project_id()
                    ),
                ),
                timeout: silence_for(context.tuning, handshake) + REQUEST_SLACK,
            };
            Ok((Rx::Polling(poller.clone()), Tx::Polling(poller)))
        }
    }
}

fn silence_for(tuning: &Tuning, handshake: &Handshake) -> Duration {
    tuning
        .silence
        .or(handshake.heartbeat)
        .unwrap_or(DEFAULT_SILENCE)
}

async fn await_join(
    context: &Context<'_>,
    rx: &mut Rx,
    tx: &mut Tx,
    carrier: Carrier,
    handshake: &Handshake,
) -> Result<(JoinProject, Vec<String>), Attempt> {
    let deadline = Instant::now() + context.tuning.join_timeout;
    let mut connected = carrier == Carrier::XhrPolling;
    let mut early = Vec::new();
    loop {
        let frames = match tokio::time::timeout_at(deadline, receive(rx)).await {
            Ok(Ok(frames)) => frames,
            Ok(Err(detail)) if connected => {
                return Err(Attempt::Failed(RealtimeError::Closed(detail)))
            }
            Ok(Err(detail)) => return Err(Attempt::Transport(detail)),
            Err(_) if connected => return Err(Attempt::Failed(RealtimeError::TimedOut)),
            Err(_) => {
                return Err(Attempt::Transport(
                    "the websocket opened but the server never answered".to_string(),
                ))
            }
        };
        let mut rest = frames.into_iter();
        while let Some(raw) = rest.next() {
            let frame = match codec::decode(&raw) {
                Ok(frame) => frame,
                Err(FrameError::UnknownType(_)) => continue,
                Err(FrameError::Malformed(shown)) => {
                    return Err(Attempt::Failed(RealtimeError::Malformed(shown)))
                }
            };
            match frame {
                Frame::Connect => connected = true,
                Frame::Heartbeat => {
                    let _ = tx.send(vec![codec::encode(&Frame::Heartbeat)]).await;
                }
                Frame::Disconnect if connected => {
                    return Err(Attempt::Failed(RealtimeError::Closed(
                        "the server closed the connection".to_string(),
                    )))
                }
                Frame::Disconnect => {
                    return Err(Attempt::Transport(
                        "the server closed the websocket before connecting".to_string(),
                    ))
                }
                Frame::Error(_) => {
                    let rejection = classify_lost(context.http, context.session).await;
                    return Err(Attempt::Failed(RealtimeError::Rejected(rejection)));
                }
                Frame::Event { name, args, .. } => match name.as_str() {
                    "joinProjectResponse" => {
                        let response = args.into_iter().next().unwrap_or(Value::Null);
                        let public_id = response
                            .get("publicId")
                            .and_then(Value::as_str)
                            .map(|id| PublicId(id.to_string()))
                            .ok_or_else(|| {
                                Attempt::Failed(RealtimeError::Malformed(
                                    "joinProjectResponse has no publicId".to_string(),
                                ))
                            })?;
                        early.extend(rest);
                        return Ok((
                            JoinProject {
                                public_id,
                                response,
                            },
                            early,
                        ));
                    }
                    "connectionRejected" => {
                        let payload = args.first().cloned().unwrap_or(Value::Null);
                        let rejection = classify(context.http, context.session, &payload).await;
                        return Err(Attempt::Failed(RealtimeError::Rejected(rejection)));
                    }
                    "serverPing" => {
                        let _ = tx.send(vec![pong(&args, carrier, &handshake.sid)]).await;
                    }
                    _ => early.push(raw),
                },
                _ => {}
            }
        }
    }
}

async fn open(context: &Context<'_>, carrier: Carrier) -> Result<Opened, Attempt> {
    let base = resource(context.http, context.page).map_err(Attempt::Failed)?;
    warm(context, &base).await;
    let handshake = handshake(context, &base, carrier).await?;
    if !handshake
        .transports
        .iter()
        .any(|offered| offered == carrier.wire_name())
    {
        return Err(Attempt::NotOffered);
    }
    let (mut rx, mut tx) = open_link(context, &base, &handshake, carrier).await?;
    let (join, early) = await_join(context, &mut rx, &mut tx, carrier, &handshake).await?;
    Ok(Opened {
        rx,
        tx,
        carrier,
        handshake,
        join,
        early,
    })
}

pub async fn connect(
    http: &Http,
    session: &SessionHandle,
    page: &ProjectPage,
    carriers: &[Carrier],
) -> Result<(Connection, JoinProject), RealtimeError> {
    connect_tuned(http, session, page, carriers, &Tuning::default()).await
}

pub async fn connect_tuned(
    http: &Http,
    session: &SessionHandle,
    page: &ProjectPage,
    carriers: &[Carrier],
    tuning: &Tuning,
) -> Result<(Connection, JoinProject), RealtimeError> {
    let context = Context {
        http,
        session,
        page,
        tuning,
    };
    let mut last_transport = "no carrier was allowed".to_string();
    loop {
        let carrier = if carriers.contains(&Carrier::WebSocket)
            && page.websocket_failures() < WEBSOCKET_TRIES
        {
            Carrier::WebSocket
        } else if carriers.contains(&Carrier::XhrPolling) {
            Carrier::XhrPolling
        } else {
            return Err(RealtimeError::Transport(last_transport));
        };
        match open(&context, carrier).await {
            Ok(opened) => return Ok(Connection::start(&context, opened)),
            Err(Attempt::NotSocketIo(detail)) => {
                if page.ws_url().is_some() && !page.is_fallback() {
                    page.reload(http, session, true)
                        .await
                        .map_err(RealtimeError::Page)?;
                    continue;
                }
                return Err(RealtimeError::Handshake(detail));
            }
            Err(Attempt::NotOffered) if carrier == Carrier::WebSocket => {
                page.give_up_websockets();
                last_transport = "the server does not offer websockets".to_string();
            }
            Err(Attempt::NotOffered) => {
                return Err(RealtimeError::Transport(
                    "the server does not offer xhr-polling".to_string(),
                ))
            }
            Err(Attempt::Transport(detail)) if carrier == Carrier::WebSocket => {
                page.note_websocket_failure();
                last_transport = detail;
            }
            Err(Attempt::Transport(detail)) => return Err(RealtimeError::Transport(detail)),
            Err(Attempt::Failed(error)) => return Err(error),
        }
    }
}

#[derive(Default)]
struct Calls {
    ended: bool,
    waiting: HashMap<u64, oneshot::Sender<Vec<Value>>>,
}

#[derive(Default)]
struct Shared {
    calls: Mutex<Calls>,
    dropped: Mutex<Option<Dropped>>,
    closing: AtomicBool,
}

enum Outbound {
    Frame(String),
    Close,
}

struct Watch {
    silence: Duration,
    sleep_jump: Duration,
    wall_clock: fn() -> SystemTime,
    heard: Instant,
    checked: Instant,
    checked_wall: SystemTime,
}

impl Watch {
    fn new(tuning: &Tuning, silence: Duration) -> Watch {
        let now = Instant::now();
        Watch {
            silence,
            sleep_jump: tuning.sleep_jump,
            wall_clock: tuning.wall_clock,
            heard: now,
            checked: now,
            checked_wall: (tuning.wall_clock)(),
        }
    }

    fn heard(&mut self) {
        self.heard = Instant::now();
    }

    fn check(&mut self) -> Option<Dropped> {
        let now = Instant::now();
        let wall = (self.wall_clock)();
        let steady = now.duration_since(self.checked);
        let walked = wall.duration_since(self.checked_wall).unwrap_or_default();
        self.checked = now;
        self.checked_wall = wall;
        if walked > steady + self.sleep_jump {
            return Some(Dropped::Slept(walked - steady));
        }
        let silent = now.duration_since(self.heard);
        (silent > self.silence).then_some(Dropped::Silent(silent))
    }
}

struct Driver {
    http: Http,
    session: SessionHandle,
    carrier: Carrier,
    sid: String,
    shared: Arc<Shared>,
    events: mpsc::UnboundedSender<ServerEvent>,
    outbound: mpsc::UnboundedReceiver<Outbound>,
    watch: Watch,
    tick: Duration,
}

type Poll = Pin<Box<dyn Future<Output = Result<Vec<String>, String>> + Send>>;

impl Driver {
    async fn run(mut self, rx: Rx, mut tx: Tx, early: Vec<String>) {
        let reason = self.drive(rx, &mut tx, early).await;
        *lock(&self.shared.dropped) = Some(reason);
        let mut calls = lock(&self.shared.calls);
        calls.ended = true;
        calls.waiting.clear();
    }

    fn closing(&self) -> bool {
        self.shared.closing.load(Ordering::SeqCst)
    }

    async fn handle(&mut self, tx: &mut Tx, raw: &str) -> Result<(), Dropped> {
        let frame = match codec::decode(raw) {
            Ok(frame) => frame,
            Err(FrameError::UnknownType(_)) => return Ok(()),
            Err(FrameError::Malformed(shown)) => return Err(Dropped::Malformed(shown)),
        };
        match frame {
            Frame::Heartbeat => tx
                .send(vec![codec::encode(&Frame::Heartbeat)])
                .await
                .map_err(Dropped::Transport),
            Frame::Disconnect => Err(Dropped::ServerClosed),
            Frame::Error(reason) => Err(Dropped::ServerError(reason)),
            Frame::Ack { id, args } => {
                if let Some(waiting) = lock(&self.shared.calls).waiting.remove(&id.0) {
                    let _ = waiting.send(args);
                }
                Ok(())
            }
            Frame::Event { name, args, .. } => {
                let event = match name.as_str() {
                    "serverPing" => {
                        return tx
                            .send(vec![pong(&args, self.carrier, &self.sid)])
                            .await
                            .map_err(Dropped::Transport);
                    }
                    "connectionRejected" => {
                        let payload = args.first().cloned().unwrap_or(Value::Null);
                        ServerEvent::Rejected(classify(&self.http, &self.session, &payload).await)
                    }
                    _ => ServerEvent::from_wire(&name, &args),
                };
                let _ = self.events.send(event);
                Ok(())
            }
            Frame::Connect | Frame::Message(_) | Frame::Json(_) | Frame::Noop => Ok(()),
        }
    }

    async fn handle_all(&mut self, tx: &mut Tx, frames: Vec<String>) -> Result<(), Dropped> {
        for raw in frames {
            self.handle(tx, &raw).await?;
        }
        Ok(())
    }

    async fn send_outbound(&mut self, tx: &mut Tx, first: Outbound) -> Result<(), Dropped> {
        let mut frames = Vec::new();
        let mut closing = false;
        let mut next = Some(first);
        while let Some(message) = next {
            match message {
                Outbound::Frame(frame) => frames.push(frame),
                Outbound::Close => closing = true,
            }
            next = self.outbound.try_recv().ok();
        }
        if !frames.is_empty() {
            tx.send(frames).await.map_err(Dropped::Transport)?;
        }
        if closing {
            tx.close().await;
            return Err(Dropped::Closed);
        }
        Ok(())
    }

    async fn drive(&mut self, rx: Rx, tx: &mut Tx, early: Vec<String>) -> Dropped {
        if let Err(dropped) = self.handle_all(tx, early).await {
            return dropped;
        }
        let mut tick = tokio::time::interval(self.tick);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        tick.tick().await;
        match rx {
            Rx::WebSocket(stream) => self.drive_websocket(stream, tx, &mut tick).await,
            Rx::Polling(poller) => self.drive_polling(poller, tx, &mut tick).await,
        }
    }

    async fn drive_websocket(
        &mut self,
        mut stream: SplitStream<Socket>,
        tx: &mut Tx,
        tick: &mut Interval,
    ) -> Dropped {
        loop {
            if self.closing() {
                tx.close().await;
                return Dropped::Closed;
            }
            let step = tokio::select! {
                message = stream.next() => self.received(tx, message).await,
                outbound = self.outbound.recv() => {
                    self.send_outbound(tx, outbound.unwrap_or(Outbound::Close)).await
                }
                _ = tick.tick() => self.watch.check().map_or(Ok(()), Err),
            };
            if let Err(dropped) = step {
                return dropped;
            }
        }
    }

    async fn drive_polling(&mut self, poller: Poller, tx: &mut Tx, tick: &mut Interval) -> Dropped {
        let mut poll: Poll = Box::pin(poller.clone().get());
        loop {
            if self.closing() {
                tx.close().await;
                return Dropped::Closed;
            }
            let step = tokio::select! {
                polled = &mut poll => {
                    let step = self.polled(tx, polled).await;
                    poll = Box::pin(poller.clone().get());
                    step
                }
                outbound = self.outbound.recv() => {
                    self.send_outbound(tx, outbound.unwrap_or(Outbound::Close)).await
                }
                _ = tick.tick() => self.watch.check().map_or(Ok(()), Err),
            };
            if let Err(dropped) = step {
                return dropped;
            }
        }
    }

    async fn received(
        &mut self,
        tx: &mut Tx,
        message: Option<Result<Message, WsError>>,
    ) -> Result<(), Dropped> {
        match message {
            Some(Ok(Message::Text(text))) => {
                self.watch.heard();
                self.handle_all(tx, codec::decode_payload(text.as_str()))
                    .await
            }
            Some(Ok(Message::Close(_))) | None => {
                Err(Dropped::Transport("the connection closed".to_string()))
            }
            Some(Ok(_)) => {
                self.watch.heard();
                Ok(())
            }
            Some(Err(error)) => Err(Dropped::Transport(error.to_string())),
        }
    }

    async fn polled(
        &mut self,
        tx: &mut Tx,
        polled: Result<Vec<String>, String>,
    ) -> Result<(), Dropped> {
        let frames = polled.map_err(Dropped::Transport)?;
        self.watch.heard();
        self.handle_all(tx, frames).await
    }
}

pub struct Connection {
    public_id: PublicId,
    carrier: Carrier,
    sid: String,
    outbound: mpsc::UnboundedSender<Outbound>,
    events: mpsc::UnboundedReceiver<ServerEvent>,
    shared: Arc<Shared>,
    next_ack: AtomicU64,
    driver: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("public_id", &self.public_id)
            .field("carrier", &self.carrier)
            .finish()
    }
}

impl Connection {
    fn start(context: &Context<'_>, opened: Opened) -> (Connection, JoinProject) {
        let shared = Arc::new(Shared::default());
        let (outbound, outbound_rx) = mpsc::unbounded_channel();
        let (events_tx, events) = mpsc::unbounded_channel();
        let silence = silence_for(context.tuning, &opened.handshake);
        let driver = Driver {
            http: context.http.clone(),
            session: context.session.clone(),
            carrier: opened.carrier,
            sid: opened.handshake.sid.clone(),
            shared: Arc::clone(&shared),
            events: events_tx,
            outbound: outbound_rx,
            watch: Watch::new(context.tuning, silence),
            tick: context.tuning.tick,
        };
        let task = tokio::spawn(driver.run(opened.rx, opened.tx, opened.early));
        let connection = Connection {
            public_id: opened.join.public_id.clone(),
            carrier: opened.carrier,
            sid: opened.handshake.sid,
            outbound,
            events,
            shared,
            next_ack: AtomicU64::new(1),
            driver: Some(task),
        };
        (connection, opened.join)
    }

    pub fn public_id(&self) -> &PublicId {
        &self.public_id
    }

    pub fn carrier(&self) -> Carrier {
        self.carrier
    }

    pub fn session_id(&self) -> &str {
        &self.sid
    }

    pub async fn call(
        &self,
        name: &'static str,
        args: Vec<Value>,
    ) -> Result<Vec<Value>, CallError> {
        let id = self.next_ack.fetch_add(1, Ordering::SeqCst);
        let (reply, answer) = oneshot::channel();
        {
            let mut calls = lock(&self.shared.calls);
            if calls.ended {
                return Err(CallError::Closed);
            }
            calls.waiting.insert(id, reply);
        }
        let frame = codec::encode(&Frame::call(id, name, &args));
        if self.outbound.send(Outbound::Frame(frame)).is_err() {
            lock(&self.shared.calls).waiting.remove(&id);
            return Err(CallError::Closed);
        }
        answer.await.map_err(|_| CallError::Closed)
    }

    pub fn emit(&self, name: &'static str, args: Vec<Value>) {
        let frame = codec::encode(&Frame::event(name, &args));
        let _ = self.outbound.send(Outbound::Frame(frame));
    }

    pub async fn next_event(&mut self) -> Option<ServerEvent> {
        self.events.recv().await
    }

    pub fn dropped(&self) -> Option<Dropped> {
        lock(&self.shared.dropped).clone()
    }

    pub async fn close(mut self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        let _ = self.outbound.send(Outbound::Close);
        if let Some(task) = self.driver.take() {
            let _ = tokio::time::timeout(CLOSE_WAIT, task).await;
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        let _ = self.outbound.send(Outbound::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_socket_io_0_9_handshake_is_accepted() {
        assert_eq!(
            parse_handshake("abc-_1:60:60:websocket,flashsocket,xhr-polling"),
            Some(Handshake {
                sid: "abc-_1".into(),
                heartbeat: Some(Duration::from_secs(60)),
                transports: vec![
                    "websocket".into(),
                    "flashsocket".into(),
                    "xhr-polling".into()
                ],
            })
        );
        assert_eq!(
            parse_handshake("abc:::xhr-polling").map(|shake| shake.heartbeat),
            Some(None)
        );
        for other in [
            "97:0{\"sid\":\"abc\",\"upgrades\":[\"websocket\"],\"pingInterval\":25000}2:40",
            "{\"sid\":\"abc\"}",
            "<!DOCTYPE html>",
            "",
            "abc:60:60",
            "abc:60:60:websocket:extra",
            "a b:60:60:websocket",
        ] {
            assert_eq!(parse_handshake(other), None, "{other}");
        }
    }

    #[test]
    fn the_watchdog_reads_silence_and_a_wall_clock_jump() {
        fn later() -> SystemTime {
            SystemTime::now() + Duration::from_secs(120)
        }
        let tuning = Tuning::default();
        let mut watch = Watch::new(&tuning, Duration::from_secs(60));
        assert_eq!(watch.check(), None);
        watch.wall_clock = later;
        assert!(
            matches!(watch.check(), Some(Dropped::Slept(gap)) if gap >= Duration::from_secs(100))
        );
        watch.wall_clock = SystemTime::now;
        watch.checked_wall = SystemTime::now();
        watch.heard -= Duration::from_secs(61);
        assert!(matches!(watch.check(), Some(Dropped::Silent(_))));
        watch.heard();
        assert_eq!(watch.check(), None);
    }

    #[test]
    fn a_pong_echoes_the_ping_and_names_this_end() {
        let ping = [
            json!(3),
            json!(1_700_000_000_000_u64),
            json!("websocket"),
            json!("sid-a"),
        ];
        assert_eq!(
            codec::decode(&pong(&ping, Carrier::WebSocket, "sid-a"))
                .unwrap()
                .into_event(),
            Some((
                "clientPong".to_string(),
                vec![
                    json!(3),
                    json!(1_700_000_000_000_u64),
                    json!("websocket"),
                    json!("sid-a"),
                    json!("websocket"),
                    json!("sid-a"),
                ]
            ))
        );
    }

    #[test]
    fn rate_limits_wait_at_least_fifteen_seconds_and_final_rejections_never_retry() {
        for attempt in 0..60 {
            let wait = RealtimeError::Rejected(Rejection::RateLimited)
                .retry_after(attempt)
                .unwrap();
            assert!(wait >= RATE_LIMIT_WAIT, "{wait:?} at {attempt}");
        }
        assert!(
            RealtimeError::Rejected(Rejection::Retry)
                .retry_after(0)
                .unwrap()
                <= Duration::from_millis(500)
        );
        for gone in [
            Rejection::SignedOut,
            Rejection::NotAuthorized,
            Rejection::ProjectGone,
        ] {
            assert_eq!(RealtimeError::Rejected(gone).retry_after(3), None);
        }
        assert_eq!(
            RealtimeError::Page(OnlineError::new(OnlineErrorKind::SessionExpired)).retry_after(0),
            None
        );
        assert!(RealtimeError::TimedOut.retry_after(0).is_some());
    }
}
