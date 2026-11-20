use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use oleafly_net::{Heard, MAX_MESSAGE_BYTES};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Instant, Interval};
use tokio_tungstenite::tungstenite::http::{header, HeaderMap, HeaderValue};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use url::Url;

use super::codec::{self, Frame, FrameError};
use super::events::{PublicId, Rejection, ServerEvent, LONGEST_SERVER_WAIT};
use super::page::ProjectPage;
use crate::client::{self, Http, SMALL_BODY_BYTES};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::locked;
use crate::session::SessionHandle;

const DEFAULT_SILENCE: Duration = Duration::from_secs(45);
const SHORTEST_HEARTBEAT: Duration = Duration::from_secs(10);
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
    #[cfg(test)]
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
            #[cfg(test)]
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
        heartbeat: heartbeat_of(heartbeat),
        transports: transports.split(',').map(str::to_string).collect(),
    })
}

fn heartbeat_of(digits: &str) -> Option<Duration> {
    if digits.is_empty() {
        return None;
    }
    let seconds = digits.parse::<u64>().unwrap_or(u64::MAX);
    (seconds > 0)
        .then(|| Duration::from_secs(seconds).clamp(SHORTEST_HEARTBEAT, LONGEST_SERVER_WAIT))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
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
    wait: Duration,
    arrived: Arc<AtomicU64>,
}

fn carried_within(wait: Duration, bytes: usize) -> Duration {
    wait.saturating_add(client::transfer_time(
        u64::try_from(bytes).unwrap_or(u64::MAX),
    ))
}

impl Poller {
    async fn get(self) -> Result<Vec<String>, String> {
        let response = self
            .http
            .get_at(
                &format!("{}&t={}", self.channel, now_millis()),
                &self.session.cookie(),
            )
            .timeout(carried_within(self.wait, MAX_MESSAGE_BYTES))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        self.session.absorb_headers(response.headers());
        if !response.status().is_success() {
            return Err(format!(
                "a poll was refused with HTTP {}",
                response.status().as_u16()
            ));
        }
        let arrived = &self.arrived;
        let body = client::read_counted(response, MAX_MESSAGE_BYTES, |bytes| {
            arrived.fetch_add(u64::try_from(bytes).unwrap_or(u64::MAX), Ordering::Relaxed);
        })
        .await
        .map_err(|error| error.to_string())?;
        Ok(codec::decode_payload(&client::lossy_text(body)))
    }

    async fn post(&self, frames: &[String]) -> Result<(), String> {
        let body = codec::encode_payload(frames);
        let response = self
            .http
            .post_at(
                &format!("{}&t={}", self.channel, now_millis()),
                &self.session.cookie(),
            )
            .timeout(carried_within(self.wait, body.len()))
            .body(body)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        self.session.absorb_headers(response.headers());
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
    arrivals: Arrivals,
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
        context.session.absorb_headers(response.headers());
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
    context.session.absorb_headers(response.headers());
    if !response.status().is_success() {
        return Err(Attempt::NotSocketIo(format!(
            "the handshake was refused with HTTP {}",
            response.status().as_u16()
        )));
    }
    let body = client::text_capped(response, SMALL_BODY_BYTES)
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

#[derive(Clone, Default)]
struct Arrivals {
    socket: Option<Heard>,
    polled: Arc<AtomicU64>,
}

impl Arrivals {
    fn bytes(&self) -> u64 {
        self.socket
            .as_ref()
            .map_or(0, Heard::bytes)
            .saturating_add(self.polled.load(Ordering::Relaxed))
    }
}

async fn open_link(
    context: &Context<'_>,
    base: &Url,
    handshake: &Handshake,
    carrier: Carrier,
) -> Result<(Rx, Tx, Arrivals), Attempt> {
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
            #[cfg(test)]
            let opened = match &context.tuning.proxy {
                Some(proxy) => oleafly_net::open_websocket_through(&target, headers, proxy).await,
                None => oleafly_net::open_websocket(&target, headers).await,
            };
            #[cfg(not(test))]
            let opened = oleafly_net::open_websocket(&target, headers).await;
            let socket = opened.map_err(|error| Attempt::Transport(error.to_string()))?;
            let arrivals = Arrivals {
                socket: Heard::of(&socket),
                ..Arrivals::default()
            };
            let (sink, stream) = socket.split();
            Ok((Rx::WebSocket(stream), Tx::WebSocket(sink), arrivals))
        }
        Carrier::XhrPolling => {
            let arrivals = Arrivals::default();
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
                wait: silence_for(context.tuning, handshake).saturating_add(REQUEST_SLACK),
                arrived: Arc::clone(&arrivals.polled),
            };
            Ok((Rx::Polling(poller.clone()), Tx::Polling(poller), arrivals))
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
    let (mut rx, mut tx, arrivals) = open_link(context, &base, &handshake, carrier).await?;
    let (join, early) = await_join(context, &mut rx, &mut tx, carrier, &handshake).await?;
    Ok(Opened {
        rx,
        tx,
        arrivals,
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
    arrivals: Arrivals,
    arrived: u64,
    heard: Instant,
    checked: Instant,
    checked_wall: SystemTime,
}

impl Watch {
    fn new(tuning: &Tuning, silence: Duration, arrivals: Arrivals) -> Watch {
        let now = Instant::now();
        Watch {
            silence,
            sleep_jump: tuning.sleep_jump,
            wall_clock: tuning.wall_clock,
            arrived: arrivals.bytes(),
            arrivals,
            heard: now,
            checked: now,
            checked_wall: (tuning.wall_clock)(),
        }
    }

    fn heard(&mut self) {
        self.heard = Instant::now();
        self.arrived = self.arrivals.bytes();
    }

    fn check(&mut self) -> Option<Dropped> {
        let now = Instant::now();
        let wall = (self.wall_clock)();
        let steady = now.duration_since(self.checked);
        let walked = wall.duration_since(self.checked_wall).unwrap_or_default();
        self.checked = now;
        self.checked_wall = wall;
        if walked > steady.saturating_add(self.sleep_jump) {
            return Some(Dropped::Slept(walked - steady));
        }
        let arrived = self.arrivals.bytes();
        if arrived != self.arrived {
            self.arrived = arrived;
            self.heard = now;
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
        *locked(&self.shared.dropped) = Some(reason);
        let mut calls = locked(&self.shared.calls);
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
                if let Some(waiting) = locked(&self.shared.calls).waiting.remove(&id.0) {
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
            watch: Watch::new(context.tuning, silence, opened.arrivals),
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
            let mut calls = locked(&self.shared.calls);
            if calls.ended {
                return Err(CallError::Closed);
            }
            calls.waiting.insert(id, reply);
        }
        let _waiting = Waiting {
            calls: &self.shared.calls,
            id,
        };
        let frame = codec::encode(&Frame::call(id, name, &args));
        if self.outbound.send(Outbound::Frame(frame)).is_err() {
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
        locked(&self.shared.dropped).clone()
    }

    pub async fn close(mut self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        let _ = self.outbound.send(Outbound::Close);
        if let Some(mut task) = self.driver.take() {
            if tokio::time::timeout(CLOSE_WAIT, &mut task).await.is_err() {
                task.abort();
                let _ = task.await;
            }
        }
    }
}

struct Waiting<'a> {
    calls: &'a Mutex<Calls>,
    id: u64,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        locked(self.calls).waiting.remove(&self.id);
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
    use crate::test_support::{streaming_server, STREAM_CHUNK};

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
        let mut watch = Watch::new(&tuning, Duration::from_secs(60), Arrivals::default());
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
    fn bytes_still_arriving_keep_the_watchdog_quiet() {
        let arrivals = Arrivals::default();
        let mut watch = Watch::new(
            &Tuning::default(),
            Duration::from_secs(60),
            arrivals.clone(),
        );
        watch.heard -= Duration::from_secs(61);
        arrivals.polled.fetch_add(512, Ordering::Relaxed);
        assert_eq!(watch.check(), None);
        watch.heard -= Duration::from_secs(61);
        assert!(matches!(watch.check(), Some(Dropped::Silent(_))));
    }

    #[test]
    fn a_server_heartbeat_is_held_to_a_sane_range() {
        let huge = u64::MAX.to_string();
        for (field, expected) in [
            ("100000000000000000000", Some(LONGEST_SERVER_WAIT)),
            ("1000000000000", Some(LONGEST_SERVER_WAIT)),
            (huge.as_str(), Some(LONGEST_SERVER_WAIT)),
            ("0", None),
            ("1", Some(SHORTEST_HEARTBEAT)),
            ("60", Some(Duration::from_secs(60))),
        ] {
            let shake = parse_handshake(&format!("sid:{field}:60:websocket")).unwrap();
            assert_eq!(shake.heartbeat, expected, "{field}");
            let silence = silence_for(&Tuning::default(), &shake);
            assert!(silence <= LONGEST_SERVER_WAIT, "{field}");
            assert!(
                carried_within(silence.saturating_add(REQUEST_SLACK), MAX_MESSAGE_BYTES) > silence
            );
            let mut watch = Watch::new(&Tuning::default(), silence, Arrivals::default());
            watch.heard -= LONGEST_SERVER_WAIT + Duration::from_secs(1);
            assert!(matches!(watch.check(), Some(Dropped::Silent(_))), "{field}");
        }
    }

    fn idle_connection(driver: JoinHandle<()>) -> (Connection, mpsc::UnboundedReceiver<Outbound>) {
        let (outbound, outbound_rx) = mpsc::unbounded_channel();
        let (_events, events) = mpsc::unbounded_channel();
        let connection = Connection {
            public_id: PublicId("P.1".into()),
            carrier: Carrier::WebSocket,
            sid: "sid".into(),
            outbound,
            events,
            shared: Arc::default(),
            next_ack: AtomicU64::new(1),
            driver: Some(driver),
        };
        (connection, outbound_rx)
    }

    #[tokio::test(start_paused = true)]
    async fn closing_a_stuck_connection_stops_its_driver() {
        let alive = Arc::new(());
        let held = Arc::clone(&alive);
        let driver = tokio::spawn(async move {
            let _held = held;
            std::future::pending::<()>().await;
        });
        let (connection, _outbound) = idle_connection(driver);
        connection.close().await;
        assert_eq!(Arc::strong_count(&alive), 1);
    }

    #[tokio::test]
    async fn a_call_given_up_on_leaves_no_waiter_behind() {
        let (connection, _outbound) = idle_connection(tokio::spawn(std::future::pending()));
        let gave_up = tokio::time::timeout(
            Duration::from_millis(20),
            connection.call("joinDoc", Vec::new()),
        )
        .await;
        assert!(gave_up.is_err());
        assert!(locked(&connection.shared.calls).waiting.is_empty());
    }

    fn signed_in(base: &str) -> (Http, SessionHandle) {
        let session = crate::session::Session {
            cookie: "overleaf.sid=s".into(),
            user_id: "u1".into(),
            email: String::new(),
            saved_by: None,
        };
        (
            Http::new(base, "Oleafly/test").unwrap(),
            SessionHandle::new(base, session, None),
        )
    }

    fn poller_for(base: &str, wait: Duration) -> Poller {
        let (http, session) = signed_in(base);
        Poller {
            http,
            session,
            channel: format!("{base}/socket.io/1/xhr-polling/sid?projectId=p1"),
            wait,
            arrived: Arc::default(),
        }
    }

    #[tokio::test]
    async fn a_slow_poll_reply_is_read_to_the_end_and_counted_as_it_arrives() {
        let base = streaming_server(None, Some(6), Duration::from_millis(100)).await;
        let poller = poller_for(&base, Duration::from_millis(200));
        let arrived = Arc::clone(&poller.arrived);
        let frames = poller.get().await.expect("the whole reply");
        assert!(!frames.is_empty());
        assert_eq!(
            arrived.load(Ordering::Relaxed),
            u64::try_from(6 * STREAM_CHUNK).unwrap()
        );
    }

    #[tokio::test]
    async fn a_poll_reply_that_never_ends_is_refused() {
        let base = streaming_server(None, None, Duration::ZERO).await;
        let refused = poller_for(&base, Duration::from_secs(5))
            .get()
            .await
            .unwrap_err();
        assert!(refused.contains("larger than"), "{refused}");
    }

    #[tokio::test]
    async fn an_oversized_handshake_is_refused_before_it_is_read() {
        let base = streaming_server(Some(u64::MAX / 2), None, Duration::ZERO).await;
        let (http, session) = signed_in(&base);
        let page = ProjectPage::unloaded("p1").unwrap();
        let tuning = Tuning::default();
        let context = Context {
            http: &http,
            session: &session,
            page: &page,
            tuning: &tuning,
        };
        let socket_io = Url::parse(&format!("{base}/socket.io")).unwrap();
        match handshake(&context, &socket_io, Carrier::XhrPolling).await {
            Err(Attempt::NotSocketIo(detail)) => {
                assert!(detail.contains("larger than"), "{detail}");
            }
            _ => panic!("an oversized handshake is refused"),
        }
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
