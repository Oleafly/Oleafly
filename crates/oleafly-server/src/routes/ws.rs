use std::time::Duration;

use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::auth::{ChallengePurpose, SessionEndReason};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, PresenceState, ProjectAction, ProjectStatus,
};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::time::{Instant, MissedTickBehavior};

use crate::auth::devices;
use crate::comment_guard::Verdict;
use crate::error::ServerError;
use crate::members;
use crate::peers::{self, Bound};
use crate::projects;
use crate::rate_limit::client_key;
use crate::rooms::{self, Outbox, Queued, RoomMember};
use crate::routes::ClientIp;
use crate::settings;
use crate::sockets::{LinkTiming, SocketControl};
use crate::state::AppState;
use crate::tokens::{random_token, resolve_access_token};

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_FRAME_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_UPDATE_BYTES: usize = 8 * 1024 * 1024;
pub const OUTBOUND_CAPACITY: usize = 512;
pub const MAX_PRESENCE_FILE_ID: usize = 256;
pub const COMMENTS_OFF: &str = "Comments are turned off for this project.";
const BRIEF_SEND: Duration = Duration::from_secs(5);
const TOO_LARGE: &str = "This change is too large to send.";

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(upgrade))
}

async fn upgrade(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    upgrade: WebSocketUpgrade,
) -> Response {
    let address = client_key(ip.as_deref().unwrap_or("unknown"));
    upgrade
        .max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| run(state, socket, address))
}

enum Incoming {
    Frame(ClientFrame),
    Malformed,
    Heard,
    TooLarge,
    Closed,
}

async fn next_incoming(socket: &mut WebSocket) -> Incoming {
    match socket.recv().await {
        Some(Ok(Message::Text(text))) => {
            serde_json::from_str(text.as_str()).map_or(Incoming::Malformed, Incoming::Frame)
        }
        Some(Ok(Message::Binary(_))) => Incoming::Malformed,
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => Incoming::Heard,
        Some(Err(error)) if over_size_limit(&error) => Incoming::TooLarge,
        Some(Ok(Message::Close(_)) | Err(_)) | None => Incoming::Closed,
    }
}

async fn next_hello(socket: &mut WebSocket) -> Incoming {
    loop {
        match next_incoming(socket).await {
            Incoming::Heard => {}
            other => return other,
        }
    }
}

fn over_size_limit(error: &axum::Error) -> bool {
    error.to_string().contains("Message too long")
}

async fn send_briefly(socket: &mut WebSocket, message: Message) -> bool {
    matches!(
        tokio::time::timeout(BRIEF_SEND, socket.send(message)).await,
        Ok(Ok(()))
    )
}

async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> bool {
    match serde_json::to_string(frame) {
        Ok(text) => send_briefly(socket, Message::Text(text.into())).await,
        Err(_) => false,
    }
}

async fn close(socket: &mut WebSocket, code: u16, reason: &str) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    send_briefly(socket, Message::Close(Some(frame))).await;
}

async fn refuse(socket: &mut WebSocket, code: FrameErrorCode, message: &str) {
    if send(socket, &frame_error(code, message)).await {
        close(socket, close_code::POLICY, message).await;
    }
}

async fn too_large(socket: &mut WebSocket, device: Option<DeviceId>) {
    tracing::warn!(
        device = ?device,
        limit = MAX_FRAME_BYTES,
        "closed a connection that sent a message over the size limit"
    );
    if send(socket, &frame_error(FrameErrorCode::TooLarge, TOO_LARGE)).await {
        close(socket, close_code::SIZE, TOO_LARGE).await;
    }
}

async fn run(state: AppState, mut socket: WebSocket, address: String) {
    let nonce = random_token();
    let challenge = ServerFrame::Challenge {
        nonce: nonce.clone(),
        server_id: state.server_id,
    };
    if !send(&mut socket, &challenge).await {
        return;
    }
    let hello = match tokio::time::timeout(HELLO_TIMEOUT, next_hello(&mut socket)).await {
        Ok(Incoming::Frame(frame)) => frame,
        Ok(Incoming::Malformed) => {
            return refuse(
                &mut socket,
                FrameErrorCode::BadFrame,
                "The first frame must be a hello.",
            )
            .await
        }
        Ok(Incoming::TooLarge) => return too_large(&mut socket, None).await,
        Ok(Incoming::Heard | Incoming::Closed) => return,
        Err(_) => {
            return refuse(
                &mut socket,
                FrameErrorCode::Internal,
                "No hello arrived in time. Connect again.",
            )
            .await
        }
    };
    let ClientFrame::Hello {
        protocol,
        device_id,
        access_token,
        nonce: echoed,
        signature,
    } = hello
    else {
        return refuse(
            &mut socket,
            FrameErrorCode::BadFrame,
            "The first frame must be a hello.",
        )
        .await;
    };
    if protocol != PROTOCOL_VERSION {
        return refuse(
            &mut socket,
            FrameErrorCode::ProtocolMismatch,
            "This server speaks another protocol version.",
        )
        .await;
    }
    let mut ticket = state.sockets.register(device_id);
    let checked = if echoed == nonce {
        authorize(&state, device_id, access_token, echoed, signature).await
    } else {
        Ok(None)
    };
    let now = state.clock.now_ms();
    match checked {
        Ok(Some((account_id, public_key))) => {
            if state.connects.admitted(&address, device_id, now) {
                state.sockets.admit(device_id, ticket.id);
                let welcome = ServerFrame::Welcome {
                    protocol: PROTOCOL_VERSION,
                    account_id,
                };
                if send(&mut socket, &welcome).await {
                    let session = Session {
                        state: &state,
                        device: device_id,
                        account: account_id,
                        public_key,
                        connection: ticket.id,
                        signal: ticket.signal.clone(),
                    };
                    let timing = state.sockets.timing();
                    let mut link = Link::new(&mut socket, &mut ticket.control, timing);
                    session.serve(&mut link).await;
                }
            } else {
                refuse(
                    &mut socket,
                    FrameErrorCode::RateLimited,
                    "This device is reconnecting too often. Wait a minute, then try again.",
                )
                .await;
            }
        }
        Ok(None) => {
            refuse(
                &mut socket,
                FrameErrorCode::Unauthorized,
                "This session is not valid.",
            )
            .await
        }
        Err(error) => {
            state.connects.forgive(&address, now);
            tracing::warn!("could not check the session of a new connection: {error}");
            refuse(
                &mut socket,
                FrameErrorCode::Internal,
                "The server could not check this session. Try again.",
            )
            .await
        }
    }
    state.sockets.unregister(device_id, ticket.id);
}

async fn authorize(
    state: &AppState,
    device_id: DeviceId,
    access_token: String,
    nonce: String,
    signature: String,
) -> Result<Option<(AccountId, Vec<u8>)>, ServerError> {
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    state
        .db
        .call(move |conn| {
            proves_device(
                conn,
                server_id,
                now,
                device_id,
                &access_token,
                &nonce,
                &signature,
            )
        })
        .await
}

pub(crate) fn proves_device(
    conn: &rusqlite::Connection,
    server_id: ServerId,
    now: i64,
    device_id: DeviceId,
    access_token: &str,
    nonce: &str,
    signature: &str,
) -> Result<Option<(AccountId, Vec<u8>)>, ServerError> {
    let Some(context) = resolve_access_token(conn, access_token, now)? else {
        return Ok(None);
    };
    let Some(device) = devices::find(conn, device_id)? else {
        return Ok(None);
    };
    let active = matches!(
        members::account_status(conn, context.account_id)?,
        Some(MemberStatus::Active)
    );
    let valid = context.device_id == device_id
        && device.account_id == context.account_id
        && !device.revoked
        && active
        && devices::signature_valid(
            &device.public_key,
            ChallengePurpose::Socket,
            server_id,
            nonce,
            signature,
        );
    if !valid {
        return Ok(None);
    }
    if let Err(error) = devices::touch(conn, device_id, now) {
        tracing::debug!("could not note when a device was last seen: {error}");
    }
    let key = b64url_decode(&device.public_key)
        .map_err(|_| ServerError::Internal("a device key does not decode".to_string()))?;
    Ok(Some((context.account_id, key)))
}

struct Session<'a> {
    state: &'a AppState,
    device: DeviceId,
    account: AccountId,
    public_key: Vec<u8>,
    connection: u64,
    signal: UnboundedSender<SocketControl>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ending {
    Closed,
    Revoked(Option<SessionEndReason>),
    Overloaded,
    Replaced,
    Stalled,
    Idle,
    TooLarge,
}

impl Ending {
    fn from_signal(signal: Option<SocketControl>) -> Ending {
        match signal {
            Some(SocketControl::Revoked(reason)) => Ending::Revoked(reason),
            Some(SocketControl::Overloaded) => Ending::Overloaded,
            Some(SocketControl::Replaced) => Ending::Replaced,
            None => Ending::Closed,
        }
    }
}

struct Link<'a> {
    socket: &'a mut WebSocket,
    control: &'a mut UnboundedReceiver<SocketControl>,
    timing: LinkTiming,
    unanswered_since: Option<Instant>,
    ending: Option<Ending>,
}

impl<'a> Link<'a> {
    fn new(
        socket: &'a mut WebSocket,
        control: &'a mut UnboundedReceiver<SocketControl>,
        timing: LinkTiming,
    ) -> Link<'a> {
        Link {
            socket,
            control,
            timing,
            unanswered_since: None,
            ending: None,
        }
    }

    async fn send(&mut self, frame: &ServerFrame) -> bool {
        match serde_json::to_string(frame) {
            Ok(text) => {
                let size = text.len();
                self.send_message(Message::Text(text.into()), size).await
            }
            Err(_) => false,
        }
    }

    async fn send_queued(&mut self, queued: &Queued) -> bool {
        match queued.text() {
            Some(text) => {
                let size = text.as_str().len();
                self.send_message(Message::Text(text), size).await
            }
            None => true,
        }
    }

    async fn ping(&mut self) -> bool {
        self.send_message(Message::Ping(axum::body::Bytes::new()), 0)
            .await
    }

    async fn send_message(&mut self, message: Message, size: usize) -> bool {
        if self.ending.is_some() {
            return false;
        }
        let sending = tokio::time::timeout(self.timing.send_limit(size), self.socket.send(message));
        tokio::select! {
            biased;
            sent = sending => match sent {
                Ok(Ok(())) => true,
                Ok(Err(_)) => {
                    self.ending = Some(Ending::Closed);
                    false
                }
                Err(_) => {
                    self.ending = Some(Ending::Stalled);
                    false
                }
            },
            signal = self.control.recv() => {
                self.ending = Some(Ending::from_signal(signal));
                false
            }
        }
    }

    fn ended(&mut self) -> Ending {
        self.ending.take().unwrap_or(Ending::Closed)
    }

    async fn finish(&mut self, ending: Ending, device: DeviceId) {
        match ending {
            Ending::Revoked(reason) => {
                if send(self.socket, &ServerFrame::SessionRevoked { reason }).await {
                    close(self.socket, close_code::POLICY, "Session revoked.").await;
                }
            }
            Ending::Overloaded => {
                tracing::info!(device = %device, "closed a connection that fell behind");
                close(
                    self.socket,
                    close_code::POLICY,
                    "This connection fell behind. Reconnect.",
                )
                .await;
            }
            Ending::Replaced => {
                close(
                    self.socket,
                    close_code::POLICY,
                    "This device opened too many connections.",
                )
                .await;
            }
            Ending::Stalled => {
                tracing::info!(device = %device, "closed a connection that stopped reading");
            }
            Ending::Idle => {
                tracing::info!(device = %device, "closed a connection that went quiet");
                close(
                    self.socket,
                    close_code::POLICY,
                    "Nothing arrived on this connection in time. Reconnect.",
                )
                .await;
            }
            Ending::TooLarge => too_large(self.socket, Some(device)).await,
            Ending::Closed => {}
        }
    }
}

fn subscribe_refusal(error: &ServerError) -> FrameErrorCode {
    match error {
        ServerError::NotFound | ServerError::Forbidden => FrameErrorCode::NotFound,
        _ => FrameErrorCode::Internal,
    }
}

pub(crate) fn frame_error(code: FrameErrorCode, message: &str) -> ServerFrame {
    ServerFrame::Error {
        code,
        message: message.to_owned(),
    }
}

pub(crate) fn unexpected_frame() -> ServerFrame {
    frame_error(FrameErrorCode::BadFrame, "Unexpected frame.")
}

pub(crate) enum Opened {
    Refused(ServerFrame),
    Subscribed(ServerFrame, u64),
}

pub(crate) struct BacklogEntry {
    pub(crate) seq: u64,
    pub(crate) size: usize,
    pub(crate) frame: Option<ServerFrame>,
}

pub(crate) struct BacklogPage {
    pub(crate) entries: Vec<BacklogEntry>,
    pub(crate) full: bool,
}

pub(crate) async fn backlog_page(
    state: &AppState,
    project: SharedProjectId,
    after: u64,
) -> Result<BacklogPage, ServerError> {
    let page = state
        .db
        .call(move |conn| projects::updates_since(conn, project, after))
        .await?;
    let full = projects::page_is_full(page.iter().map(|stored| stored.envelope.len()));
    let entries = page
        .into_iter()
        .map(|stored| BacklogEntry {
            seq: stored.seq,
            size: stored.envelope.len(),
            frame: serde_json::from_slice::<Envelope>(&stored.envelope)
                .ok()
                .map(|envelope| ServerFrame::Update {
                    project_id: project,
                    seq: stored.seq,
                    account_id: Some(stored.account),
                    envelope,
                }),
        })
        .collect();
    Ok(BacklogPage { entries, full })
}

pub(crate) fn leave_rooms(state: &AppState, connection: u64, device: DeviceId) {
    for (project, _) in state.rooms.leave_all(connection) {
        state.rooms.broadcast(
            project,
            None,
            &ServerFrame::PresenceLeft {
                project_id: project,
                device_id: device,
            },
        );
    }
}

pub(crate) struct Peer<'a> {
    pub(crate) state: &'a AppState,
    pub(crate) device: DeviceId,
    pub(crate) account: AccountId,
    pub(crate) public_key: &'a [u8],
    pub(crate) connection: u64,
}

impl Peer<'_> {
    pub(crate) async fn open(
        &self,
        project: SharedProjectId,
        since: u64,
        member: RoomMember,
    ) -> Opened {
        let account = self.account;
        let checked = self
            .state
            .db
            .call(move |conn| {
                let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
                let role =
                    projects::role_of(conn, project, account)?.ok_or(ServerError::NotFound)?;
                if row.status != ProjectStatus::Active {
                    return Err(ServerError::NotFound);
                }
                let oldest = projects::oldest_kept_update(conn, project)?;
                let snapshot = projects::latest_snapshot(conn, project)?.map(|found| found.seq);
                let at_since: Option<String> =
                    rusqlite::OptionalExtension::optional(conn.query_row(
                        "SELECT batch_id FROM project_updates WHERE project_id = ?1 AND seq = ?2",
                        rusqlite::params![
                            project.to_string(),
                            i64::try_from(since).unwrap_or(i64::MAX)
                        ],
                        |found| found.get(0),
                    ))?;
                Ok((role, row.head_seq, oldest, snapshot, at_since))
            })
            .await;
        let (role, head, oldest, snapshot, at_since) = match checked {
            Ok(found) => found,
            Err(error) => {
                let code = subscribe_refusal(&error);
                let message = if code == FrameErrorCode::NotFound {
                    "You don't have access to this project."
                } else {
                    "The server could not open this project. Try again."
                };
                return Opened::Refused(frame_error(code, message));
            }
        };
        let missing_from_log = since < head && oldest.is_none_or(|oldest| oldest > since + 1);
        if missing_from_log && snapshot.is_some_and(|seq| seq > since) {
            return Opened::Refused(ServerFrame::SnapshotRequired {
                project_id: project,
            });
        }
        self.state.rooms.join(project, member);
        let still = self
            .state
            .db
            .call(move |conn| projects::role_of(conn, project, account))
            .await;
        if !matches!(still, Ok(Some(_))) {
            self.state.rooms.leave(project, self.connection);
            return Opened::Refused(frame_error(
                FrameErrorCode::NotFound,
                "You don't have access to this project.",
            ));
        }
        crate::access_log::note_open(self.state, project, account, self.device).await;
        Opened::Subscribed(
            ServerFrame::Subscribed {
                project_id: project,
                role,
                head_seq: head,
                since_batch: at_since.and_then(|batch| batch.parse().ok()),
            },
            head,
        )
    }

    pub(crate) fn unsubscribe(&self, project: SharedProjectId) {
        if self.state.rooms.leave(project, self.connection).is_some() {
            self.state.rooms.broadcast(
                project,
                None,
                &ServerFrame::PresenceLeft {
                    project_id: project,
                    device_id: self.device,
                },
            );
        }
    }

    pub(crate) fn leave_presence(&self, project: SharedProjectId) {
        if self.state.rooms.is_member(project, self.connection) {
            self.state.rooms.broadcast(
                project,
                Some(self.connection),
                &ServerFrame::PresenceLeft {
                    project_id: project,
                    device_id: self.device,
                },
            );
        }
    }

    fn envelope_problem(
        &self,
        project: SharedProjectId,
        envelope: &Envelope,
    ) -> Option<ServerFrame> {
        if envelope.project_id != project
            || envelope.device_id != self.device
            || envelope.v != 1
            || envelope.mode != EnvelopeMode::Plain
            || envelope.key_epoch.is_some()
        {
            return Some(frame_error(
                FrameErrorCode::BadFrame,
                "This update is not valid.",
            ));
        }
        if envelope.payload.len() > MAX_UPDATE_BYTES {
            return Some(frame_error(
                FrameErrorCode::TooLarge,
                "This change is too large to send.",
            ));
        }
        if !verify_ed25519(
            self.public_key,
            &envelope.signing_bytes(),
            &envelope.signature,
        ) {
            return Some(frame_error(
                FrameErrorCode::Unauthorized,
                "This update is not signed by this device.",
            ));
        }
        None
    }

    pub(crate) async fn update(&self, project: SharedProjectId, envelope: Envelope) -> ServerFrame {
        if !self.state.rooms.is_member(project, self.connection) {
            return frame_error(
                FrameErrorCode::Forbidden,
                "Open the project before changing it.",
            );
        }
        if let Some(problem) = self.envelope_problem(project, &envelope) {
            return problem;
        }
        let stored_failed = frame_error(
            FrameErrorCode::Internal,
            "The server could not store this change.",
        );
        let payload = envelope.payload.clone();
        let reach = match tokio::task::spawn_blocking(move || peers::update_reach(&payload)).await {
            Ok(Some(reach)) => reach,
            Ok(None) => {
                return frame_error(FrameErrorCode::BadFrame, "This update is not valid.");
            }
            Err(_) => return stored_failed,
        };
        let Ok(stored) = serde_json::to_vec(&envelope) else {
            return stored_failed;
        };
        let batch = envelope.batch_id;
        let first = self
            .append(
                project,
                envelope.clone(),
                reach.clone(),
                stored.clone(),
                false,
            )
            .await;
        let appended = match first {
            Ok(Some(appended)) => Ok(appended),
            Ok(None) => {
                if let Some(refusal) = self.refuse_comment_change(project, &envelope).await {
                    return refusal;
                }
                let checked = self.append(project, envelope, reach, stored, true).await;
                if checked.is_err() {
                    self.state.comment_guard.forget(project).await;
                }
                checked.and_then(|appended| {
                    appended.ok_or_else(|| {
                        ServerError::Internal("the comment check did not hold".to_string())
                    })
                })
            }
            Err(error) => Err(error),
        };
        match appended {
            Ok(appended) => ServerFrame::Ack {
                project_id: project,
                batch_id: batch,
                seq: appended.seq,
            },
            Err(ServerError::Forbidden | ServerError::NotFound) => {
                frame_error(FrameErrorCode::Forbidden, "You can't edit this project.")
            }
            Err(ServerError::Unauthorized) => frame_error(
                FrameErrorCode::Unauthorized,
                "This update is not signed by this device.",
            ),
            Err(ServerError::BadRequest(_)) => {
                frame_error(FrameErrorCode::BadFrame, "This update is not valid.")
            }
            Err(_) => stored_failed,
        }
    }

    async fn refuse_comment_change(
        &self,
        project: SharedProjectId,
        envelope: &Envelope,
    ) -> Option<ServerFrame> {
        let verdict = self
            .state
            .comment_guard
            .check(
                &self.state.db,
                &self.state.snapshots,
                project,
                envelope.payload.clone(),
            )
            .await;
        match verdict {
            Ok(Verdict::Allowed) => None,
            Ok(Verdict::ChangesComments) => {
                Some(frame_error(FrameErrorCode::Forbidden, COMMENTS_OFF))
            }
            Ok(Verdict::Unreadable) => Some(frame_error(
                FrameErrorCode::BadFrame,
                "This update is not valid.",
            )),
            Err(_) => Some(frame_error(
                FrameErrorCode::Internal,
                "The server could not store this change.",
            )),
        }
    }

    async fn append(
        &self,
        project: SharedProjectId,
        envelope: Envelope,
        reach: peers::Reach,
        stored: Vec<u8>,
        checked: bool,
    ) -> Result<Option<projects::Appended>, ServerError> {
        let (account, device, batch) = (self.account, self.device, envelope.batch_id);
        let now = self.state.clock.now_ms();
        let rooms = std::sync::Arc::clone(&self.state.rooms);
        let connection = self.connection;
        self.state
            .db
            .call(move |conn| {
                let transaction = conn.transaction()?;
                let row =
                    projects::project_row(&transaction, project)?.ok_or(ServerError::NotFound)?;
                let role = projects::role_of(&transaction, project, account)?
                    .ok_or(ServerError::NotFound)?;
                if row.status != ProjectStatus::Active
                    || !project_role_allows(role, ProjectAction::Edit)
                {
                    return Err(ServerError::Forbidden);
                }
                if !checked && !comments_on(&transaction, &row)? {
                    return Ok(None);
                }
                match peers::bind(&transaction, project, device, account, &reach, now)? {
                    Bound::Accepted => {}
                    Bound::Refused(_) => return Err(ServerError::Unauthorized),
                    Bound::Detached => {
                        return Err(ServerError::BadRequest(
                            "This update builds on changes the server does not have.".to_string(),
                        ))
                    }
                }
                let appended = projects::append_update_in(
                    &transaction,
                    project,
                    batch,
                    device,
                    account,
                    &stored,
                    now,
                )?;
                transaction.commit()?;
                if !appended.duplicate {
                    rooms.publish(
                        project,
                        Some(connection),
                        ServerFrame::Update {
                            project_id: project,
                            seq: appended.seq,
                            account_id: Some(account),
                            envelope,
                        },
                    );
                }
                Ok(Some(appended))
            })
            .await
    }

    pub(crate) fn presence(
        &self,
        project: SharedProjectId,
        state: PresenceState,
    ) -> Option<ServerFrame> {
        if !self.state.rooms.is_member(project, self.connection) {
            return None;
        }
        if state
            .file_id
            .as_ref()
            .is_some_and(|file| file.len() > MAX_PRESENCE_FILE_ID)
        {
            return Some(frame_error(
                FrameErrorCode::BadFrame,
                "This presence update is not valid.",
            ));
        }
        self.state.rooms.broadcast(
            project,
            Some(self.connection),
            &ServerFrame::Presence {
                project_id: project,
                device_id: self.device,
                account_id: self.account,
                state,
            },
        );
        None
    }
}

impl Session<'_> {
    fn peer(&self) -> Peer<'_> {
        Peer {
            state: self.state,
            device: self.device,
            account: self.account,
            public_key: &self.public_key,
            connection: self.connection,
        }
    }

    async fn serve(&self, link: &mut Link<'_>) {
        let (frames, mut outbound) = rooms::outbox(OUTBOUND_CAPACITY);
        let every = link.timing.ping_every;
        let mut ping = tokio::time::interval_at(Instant::now() + every, every);
        ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let ending = loop {
            tokio::select! {
                biased;
                signal = link.control.recv() => break Ending::from_signal(signal),
                incoming = next_incoming(link.socket) => {
                    link.unanswered_since = None;
                    let keep_going = match incoming {
                        Incoming::Frame(frame) => self.handle(link, &frames, frame).await,
                        Incoming::Malformed => link.send(&unexpected_frame()).await,
                        Incoming::Heard => true,
                        Incoming::TooLarge => break Ending::TooLarge,
                        Incoming::Closed => break Ending::Closed,
                    };
                    if !keep_going {
                        break link.ended();
                    }
                }
                Some(queued) = outbound.recv_shared() => {
                    if !link.send_queued(&queued).await {
                        break link.ended();
                    }
                }
                _ = ping.tick() => {
                    if link
                        .unanswered_since
                        .is_some_and(|since| since.elapsed() >= link.timing.idle_after)
                    {
                        break Ending::Idle;
                    }
                    if !link.ping().await {
                        break link.ended();
                    }
                    link.unanswered_since.get_or_insert_with(Instant::now);
                }
            }
        };
        link.finish(ending, self.device).await;
        leave_rooms(self.state, self.connection, self.device);
    }

    async fn handle(&self, link: &mut Link<'_>, frames: &Outbox, frame: ClientFrame) -> bool {
        let peer = self.peer();
        match frame {
            ClientFrame::Ping { id } => link.send(&ServerFrame::Pong { id }).await,
            ClientFrame::Subscribe {
                project_id,
                since_seq,
            } => self.subscribe(link, frames, project_id, since_seq).await,
            ClientFrame::Unsubscribe { project_id } => {
                peer.unsubscribe(project_id);
                true
            }
            ClientFrame::Update {
                project_id,
                envelope,
            } => {
                let reply = peer.update(project_id, envelope).await;
                link.send(&reply).await
            }
            ClientFrame::Presence { project_id, state } => match peer.presence(project_id, state) {
                Some(problem) => link.send(&problem).await,
                None => true,
            },
            ClientFrame::PresenceLeave { project_id } => {
                peer.leave_presence(project_id);
                true
            }
            ClientFrame::Hello { .. } => link.send(&unexpected_frame()).await,
        }
    }

    async fn subscribe(
        &self,
        link: &mut Link<'_>,
        frames: &Outbox,
        project: SharedProjectId,
        since: u64,
    ) -> bool {
        let member = RoomMember {
            connection: self.connection,
            device: self.device,
            account: self.account,
            frames: frames.clone(),
            control: self.signal.clone(),
        };
        let head = match self.peer().open(project, since, member).await {
            Opened::Refused(frame) => return link.send(&frame).await,
            Opened::Subscribed(frame, head) => {
                if !link.send(&frame).await {
                    return false;
                }
                head
            }
        };
        let mut cursor = since;
        loop {
            let Ok(page) = backlog_page(self.state, project, cursor).await else {
                return false;
            };
            for entry in page.entries {
                cursor = entry.seq;
                if let Some(frame) = entry.frame {
                    if !link.send(&frame).await {
                        return false;
                    }
                }
            }
            if !page.full || cursor >= head {
                return true;
            }
        }
    }
}

fn comments_on(
    conn: &rusqlite::Connection,
    row: &projects::ProjectRow,
) -> Result<bool, ServerError> {
    Ok(row.comments_enabled && settings::load(conn)?.comments_allowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_missing_project_or_grant_reads_as_not_found() {
        assert_eq!(
            subscribe_refusal(&ServerError::NotFound),
            FrameErrorCode::NotFound
        );
        assert_eq!(
            subscribe_refusal(&ServerError::Internal("disk".to_owned())),
            FrameErrorCode::Internal
        );
    }
}
