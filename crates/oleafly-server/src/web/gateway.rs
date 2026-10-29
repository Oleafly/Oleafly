use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use oleafly_collab::comments::CommentMember;
use oleafly_collab::ot::TextOperation;
use oleafly_collab_protocol::crypto::b64url_decode;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, PresenceState, ProjectAction, ProjectRole, ProjectStatus,
};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio::time::{Instant, MissedTickBehavior};

use crate::error::ServerError;
use crate::outputs;
use crate::projects;
use crate::rate_limit::client_key;
use crate::removals;
use crate::rooms::{self, Outbound, RoomMember};
use crate::routes::ws::{
    leave_rooms, CursorGate, Opened, Peer, ASIDE_BYTES, MAX_FRAME_BYTES, OUTBOUND_CAPACITY,
};
use crate::routes::ClientIp;
use crate::settings;
use crate::sockets::{SocketControl, SocketSlot};
use crate::state::AppState;
use crate::web::frames::{
    self, ChatAction, CommentAction, EditMode, Incoming, Outgoing, SuggestionAction, WebFeatures,
    WebMember, WebOutput, WebPeer,
};
use crate::web::room::{Applied, Hub, Sink, WebRoom};
use crate::web::{cross_site, pending_core, same_origin, Refusal, WebOn};
use crate::web_sessions::{self, WebCaller};

pub const SINK_CAPACITY: usize = 1024;
const RESTARTING: &str = "The server is restarting.";

#[derive(Debug, Default, Deserialize)]
pub struct SocketQuery {
    #[serde(default)]
    project: String,
}

pub async fn upgrade(
    State(state): State<AppState>,
    _on: WebOn,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Query(query): Query<SocketQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !same_origin(&headers, &state.config) {
        return cross_site().into_response();
    }
    let Ok(project) = query.project.parse::<SharedProjectId>() else {
        return ServerError::BadRequest("Name a project to open.".to_string()).into_response();
    };
    let address = client_key(ip.as_deref().unwrap_or("unknown"));
    let now = state.clock.now_ms();
    let user = match super::signed_in(&state, &headers).await {
        Ok(user) => user,
        Err(error) => {
            if matches!(error, ServerError::Internal(_)) {
                state.connects.forgive(&address, now);
            }
            return error.into_response();
        }
    };
    let Ok(key) = web_sessions::signing_key(&user.token) else {
        return ServerError::Unauthorized.into_response();
    };
    let public_key = key.public_key().as_ref().to_vec();
    if b64url_decode(&user.caller.public_key).ok().as_deref() != Some(public_key.as_slice()) {
        return ServerError::Unauthorized.into_response();
    }
    if !state
        .connects
        .admitted(&address, user.caller.device_id, now)
    {
        return ServerError::RateLimited.into_response();
    }
    let Some(slot) = state
        .sockets
        .open_slot(user.caller.account_id, user.caller.device_id)
    else {
        return ServerError::RateLimited.into_response();
    };
    let caller = user.caller;
    upgrade
        .max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| run(state, socket, caller, key, public_key, project, slot))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ending {
    Closed,
    Revoked,
    Overloaded,
    Replaced,
    Restarting,
    Idle,
    Removed,
}

impl Ending {
    fn from_signal(signal: Option<SocketControl>) -> Ending {
        match signal {
            Some(SocketControl::Revoked(_)) => Ending::Revoked,
            Some(SocketControl::Overloaded) => Ending::Overloaded,
            Some(SocketControl::Replaced) => Ending::Replaced,
            Some(SocketControl::Restarting) => Ending::Restarting,
            None => Ending::Closed,
        }
    }
}

async fn send_text(
    socket: &mut WebSocket,
    text: String,
    timing: crate::sockets::LinkTiming,
) -> bool {
    let limit = timing.send_limit(text.len());
    matches!(
        tokio::time::timeout(limit, socket.send(Message::Text(text.into()))).await,
        Ok(Ok(()))
    )
}

async fn close(socket: &mut WebSocket, code: u16, reason: &str) {
    let frame = CloseFrame {
        code,
        reason: reason.into(),
    };
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        socket.send(Message::Close(Some(frame))),
    )
    .await;
}

async fn refuse(socket: &mut WebSocket, refusal: &Refusal, timing: crate::sockets::LinkTiming) {
    if let Some(text) = Outgoing::error(&refusal.code, &refusal.message, None).text() {
        if send_text(socket, text, timing).await {
            close(socket, close_code::POLICY, &refusal.message).await;
        }
    }
}

struct Switches {
    server: bool,
    project: bool,
}

fn people(members: &[projects_member::Member]) -> Vec<WebMember> {
    members
        .iter()
        .map(|member| WebMember {
            account_id: member.account_id,
            display_name: member.display_name.clone(),
            login: member.login.clone(),
            avatar_url: member.avatar_url.clone(),
        })
        .collect()
}

mod projects_member {
    use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
    use rusqlite::Connection;

    use crate::error::ServerError;
    use crate::projects;

    #[derive(Clone, Debug)]
    pub struct Member {
        pub account_id: AccountId,
        pub display_name: String,
        pub login: Option<String>,
        pub avatar_url: Option<String>,
    }

    pub fn list(conn: &Connection, project: SharedProjectId) -> Result<Vec<Member>, ServerError> {
        Ok(projects::members(conn, project, false)?
            .into_iter()
            .map(|member| Member {
                account_id: member.person.account_id,
                display_name: member.person.display_name,
                login: member.person.login,
                avatar_url: member.person.avatar_url,
            })
            .collect())
    }
}

fn refusal_for(
    status: Option<ProjectStatus>,
    role: Option<ProjectRole>,
    removed: bool,
) -> Option<Refusal> {
    match (status, role) {
        (None, _) => Some(Refusal::new(
            "not_found",
            "This project is not on this server.",
        )),
        (Some(_), None) if removed => Some(Refusal::new(
            "removed",
            "You were removed from this project.",
        )),
        (Some(_), None) => Some(Refusal::new(
            "not_found",
            "You don't have access to this project.",
        )),
        (Some(ProjectStatus::Pending), Some(_)) => Some(Refusal::new(
            "project_not_shared",
            "This project is not shared yet.",
        )),
        (Some(ProjectStatus::Archived | ProjectStatus::Unknown), Some(_)) => Some(Refusal::new(
            "archived",
            "This project is no longer shared.",
        )),
        (Some(ProjectStatus::Active), Some(_)) => None,
    }
}

struct Session {
    state: AppState,
    id: u64,
    project: SharedProjectId,
    account: AccountId,
    device: DeviceId,
    public_key: Vec<u8>,
    key: Ed25519KeyPair,
    connection: u64,
    role: ProjectRole,
    mode: String,
    room: Arc<WebRoom>,
    sink: Sink,
    cursors: CursorGate,
    understands: Vec<FrameErrorCode>,
    members: Vec<projects_member::Member>,
    peers: BTreeMap<DeviceId, WebPeer>,
}

#[allow(clippy::too_many_arguments)]
async fn run(
    state: AppState,
    mut socket: WebSocket,
    caller: WebCaller,
    key: Ed25519KeyPair,
    public_key: Vec<u8>,
    project: SharedProjectId,
    _slot: SocketSlot,
) {
    let timing = state.sockets.timing();
    if state.sockets.is_restarting() {
        return close(&mut socket, close_code::RESTART, RESTARTING).await;
    }
    let device = caller.device_id;
    let now = state.clock.now_ms();
    if let Err(error) = state
        .db
        .call(move |conn| crate::auth::devices::touch(conn, device, now))
        .await
    {
        tracing::debug!("could not note when a browser was last seen: {error}");
    }
    let mut ticket = state.sockets.register(device);
    state.sockets.admit(device, ticket.id);
    let (frames, mut outbound) = rooms::outbox(OUTBOUND_CAPACITY);
    let (sink_frames, mut sink_rx) = mpsc::channel(SINK_CAPACITY);
    let sink = Sink::new(sink_frames, ticket.signal.clone());
    let member = RoomMember {
        connection: ticket.id,
        device,
        account: caller.account_id,
        frames,
        control: ticket.signal.clone(),
    };
    let opened = Session::open(
        &state, caller, key, public_key, project, ticket.id, sink, member,
    )
    .await;
    let mut session = match opened {
        Ok(session) => session,
        Err(refusal) => {
            refuse(&mut socket, &refusal, timing).await;
            leave_rooms(&state, ticket.id, device);
            state.sockets.unregister(device, ticket.id);
            return;
        }
    };
    let ending = session
        .serve(
            &mut socket,
            &mut ticket.control,
            &mut outbound,
            &mut sink_rx,
        )
        .await;
    while let Ok(text) = sink_rx.try_recv() {
        if !send_text(&mut socket, text, timing).await {
            break;
        }
    }
    match ending {
        Ending::Revoked => {
            refuse(
                &mut socket,
                &Refusal::new("signed_out", "This browser was signed out."),
                timing,
            )
            .await
        }
        Ending::Overloaded => {
            close(
                &mut socket,
                close_code::POLICY,
                "This connection fell behind. Reconnect.",
            )
            .await
        }
        Ending::Replaced => {
            close(
                &mut socket,
                close_code::POLICY,
                "This browser opened too many connections.",
            )
            .await
        }
        Ending::Restarting => close(&mut socket, close_code::RESTART, RESTARTING).await,
        Ending::Idle => {
            close(
                &mut socket,
                close_code::POLICY,
                "Nothing arrived on this connection in time. Reconnect.",
            )
            .await
        }
        Ending::Removed => close(&mut socket, close_code::POLICY, "Access ended.").await,
        Ending::Closed => {}
    }
    session.room.leave(session.id).await;
    Hub::linger(Arc::clone(&session.room));
    leave_rooms(&state, ticket.id, device);
    state.sockets.unregister(device, ticket.id);
}

impl Session {
    #[allow(clippy::too_many_arguments)]
    async fn open(
        state: &AppState,
        caller: WebCaller,
        key: Ed25519KeyPair,
        public_key: Vec<u8>,
        project: SharedProjectId,
        connection: u64,
        sink: Sink,
        member: RoomMember,
    ) -> Result<Session, Refusal> {
        let account = caller.account_id;
        let checked = state
            .db
            .read(move |conn| {
                let row = projects::project_row(conn, project)?;
                let role = projects::role_of(conn, project, account)?;
                let removed = role.is_none() && removals::is_removed(conn, project, account)?;
                let members = projects_member::list(conn, project)?;
                Ok((row.map(|row| row.status), role, removed, members))
            })
            .await
            .map_err(|_| Refusal::server())?;
        let (status, role, removed, members) = checked;
        if let Some(refusal) = refusal_for(status, role, removed) {
            return Err(refusal);
        }
        let mut session = Session {
            state: state.clone(),
            id: state.web.next_session(),
            project,
            account,
            device: caller.device_id,
            public_key,
            key,
            connection,
            role: role.unwrap_or(ProjectRole::Unknown),
            mode: caller.mode,
            room: state.web.room(project),
            sink,
            cursors: CursorGate::new(),
            understands: vec![FrameErrorCode::ProjectTooLarge, FrameErrorCode::CommentsOff],
            members,
            peers: BTreeMap::new(),
        };
        match session.peer().open(project, u64::MAX, member).await {
            Opened::Refused(ServerFrame::Error { code, message }) => {
                return Err(Refusal::from_frame(code, &message))
            }
            Opened::Refused(_) => return Err(Refusal::server()),
            Opened::Subscribed(ServerFrame::Subscribed { role, .. }, _) => session.role = role,
            Opened::Subscribed(..) => {}
        }
        session.room.join(session.id, session.sink.clone());
        if let Err(refusal) = session.hello().await {
            session.room.leave(session.id).await;
            return Err(refusal);
        }
        session.room.greet(session.id).await;
        session.send_outputs().await;
        session.sink.send(&Outgoing::Presence { peers: Vec::new() });
        Ok(session)
    }

    fn peer(&self) -> Peer<'_> {
        Peer {
            state: &self.state,
            device: self.device,
            account: self.account,
            public_key: &self.public_key,
            connection: self.connection,
            understands: &self.understands,
            cursors: &self.cursors,
        }
    }

    async fn switches(&self) -> Result<Switches, Refusal> {
        let project = self.project;
        self.state
            .db
            .read(move |conn| {
                Ok(Switches {
                    server: settings::load(conn)?.comments_allowed,
                    project: projects::project_row(conn, project)?
                        .is_some_and(|row| row.comments_enabled),
                })
            })
            .await
            .map_err(|_| Refusal::server())
    }

    async fn hello(&mut self) -> Result<(), Refusal> {
        let files = self.room.ready(&self.state).await?;
        let compile = self.room.compile().await;
        let switches = self.switches().await?;
        self.sink.send(&Outgoing::Hello {
            role: self.role,
            features: WebFeatures {
                comments: switches.server && switches.project,
                suggestions: pending_core::SUGGESTIONS_READY,
                chat: pending_core::CHAT_READY,
            },
            files,
            members: people(&self.members),
            compile,
        });
        Ok(())
    }

    async fn send_outputs(&self) {
        let project = self.project;
        if let Ok(listed) = self
            .state
            .db
            .read(move |conn| outputs::list(conn, project))
            .await
        {
            self.sink.send(&Outgoing::Output {
                items: listed.into_iter().map(WebOutput::from).collect(),
            });
        }
    }

    async fn refresh_members(&mut self) {
        let project = self.project;
        if let Ok(members) = self
            .state
            .db
            .read(move |conn| projects_member::list(conn, project))
            .await
        {
            self.members = members;
        }
    }

    fn name_of(&self, account: AccountId) -> Option<String> {
        self.members
            .iter()
            .find(|member| member.account_id == account)
            .map(|member| member.display_name.clone())
    }

    fn comment_members(&self) -> Vec<CommentMember> {
        self.members
            .iter()
            .map(|member| CommentMember {
                account_id: member.account_id,
                display_name: member.display_name.clone(),
                login: member.login.clone(),
            })
            .collect()
    }

    fn suggesting(&self) -> bool {
        pending_core::always_suggests(self.role)
            || (self.mode == web_sessions::SUGGESTING
                && pending_core::SUGGESTIONS_READY
                && pending_core::may_choose_mode(self.role))
    }

    async fn serve(
        &mut self,
        socket: &mut WebSocket,
        control: &mut mpsc::UnboundedReceiver<SocketControl>,
        outbound: &mut Outbound,
        sink_rx: &mut mpsc::Receiver<String>,
    ) -> Ending {
        let timing = self.state.sockets.timing();
        let every = timing.ping_every;
        let mut ping = tokio::time::interval_at(Instant::now() + every, every);
        ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut unanswered_since: Option<Instant> = None;
        loop {
            tokio::select! {
                biased;
                signal = control.recv() => return Ending::from_signal(signal),
                message = socket.recv() => {
                    unanswered_since = None;
                    match message {
                        Some(Ok(Message::Text(text))) => self.handle(text).await,
                        Some(Ok(Message::Binary(_))) => self.sink.send(&Outgoing::error(
                            "invalid",
                            "This frame is not valid.",
                            None,
                        )),
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                        Some(Ok(Message::Close(_)) | Err(_)) | None => return Ending::Closed,
                    }
                }
                Some(queued) = outbound.recv_shared() => {
                    if self.heard(queued.frame().clone()).await {
                        return Ending::Removed;
                    }
                }
                Some(text) = sink_rx.recv() => {
                    if !send_text(socket, text, timing).await {
                        return Ending::Closed;
                    }
                }
                _ = ping.tick() => {
                    if unanswered_since.is_some_and(|since| since.elapsed() >= timing.idle_after) {
                        return Ending::Idle;
                    }
                    let pinged = tokio::time::timeout(
                        timing.send_limit(0),
                        socket.send(Message::Ping(axum::body::Bytes::new())),
                    )
                    .await;
                    if !matches!(pinged, Ok(Ok(()))) {
                        return Ending::Closed;
                    }
                    unanswered_since.get_or_insert_with(Instant::now);
                }
            }
        }
    }

    fn reply(&self, result: Result<(), Refusal>, req_id: Option<String>) {
        match result {
            Ok(()) => {
                if let Some(req_id) = req_id {
                    self.sink.send(&Outgoing::Done { req_id });
                }
            }
            Err(refusal) => {
                self.sink
                    .send(&Outgoing::error(&refusal.code, &refusal.message, req_id))
            }
        }
    }

    async fn handle(&mut self, text: axum::extract::ws::Utf8Bytes) {
        let parsed = if text.len() < ASIDE_BYTES {
            frames::parse(text.as_str())
        } else {
            tokio::task::spawn_blocking(move || frames::parse(text.as_str()))
                .await
                .unwrap_or(frames::Parsed {
                    frame: None,
                    req_id: None,
                })
        };
        let req_id = parsed.req_id;
        let Some(frame) = parsed.frame else {
            self.reply(
                Err(Refusal::new("invalid", "This frame is not valid.")),
                req_id,
            );
            return;
        };
        match frame {
            Incoming::Open { file_id } => {
                if let Err(refusal) = self.room.open_file(self.id, &file_id).await {
                    self.reply(Err(refusal), req_id);
                }
            }
            Incoming::Close { file_id } => self.room.close_file(self.id, &file_id).await,
            Incoming::Change { file_id, rev, op } => {
                if let Err(refusal) = self.change(&file_id, rev, op).await {
                    self.reply(Err(refusal), req_id);
                }
            }
            Incoming::Mode { mode } => {
                let result = self.choose_mode(mode).await;
                self.reply(result, req_id);
            }
            Incoming::Presence {
                file_id,
                anchor,
                head,
            } => self.presence(file_id, anchor, head),
            Incoming::Comment(action) => {
                let result = self.comment(action).await;
                self.reply(result, req_id);
            }
            Incoming::Suggestion(action) => {
                let result = self.suggestion(action).await;
                self.reply(result, req_id);
            }
            Incoming::Chat(action) => {
                let result = self.chat(action).await;
                self.reply(result, req_id);
            }
        }
    }

    async fn change(
        &mut self,
        file: &str,
        rev: u64,
        operation: TextOperation,
    ) -> Result<(), Refusal> {
        let suggesting = self.suggesting();
        let allowed = if suggesting {
            pending_core::may_suggest(self.role)
        } else {
            project_role_allows(self.role, ProjectAction::Edit)
        };
        if !allowed {
            self.room.reset_file(self.id, file).await;
            return Ok(());
        }
        let peer = self.peer();
        self.room
            .change(
                &self.state,
                &peer,
                &self.key,
                self.id,
                file,
                rev,
                operation,
                suggesting,
            )
            .await
    }

    async fn choose_mode(&mut self, mode: EditMode) -> Result<(), Refusal> {
        if !pending_core::may_choose_mode(self.role) {
            return Err(Refusal::new(
                "suggestion_role",
                "Your role can't switch between editing and suggesting.",
            ));
        }
        let chosen = pending_core::chosen_mode(mode)?;
        let device = self.device;
        self.state
            .db
            .call(move |conn| web_sessions::set_mode(conn, device, chosen))
            .await
            .map_err(|_| Refusal::server())?;
        self.mode = chosen.to_string();
        Ok(())
    }

    fn presence(&mut self, file_id: Option<String>, anchor: Option<u32>, head: Option<u32>) {
        let state = PresenceState {
            file_id,
            cursor: head,
            anchor,
        };
        if let Some(ServerFrame::Error { code, message }) =
            self.peer().presence(self.project, state)
        {
            let refusal = Refusal::from_frame(code, &message);
            self.sink
                .send(&Outgoing::error(&refusal.code, &refusal.message, None));
        }
    }

    async fn comment(&mut self, action: CommentAction) -> Result<(), Refusal> {
        if !pending_core::may_comment(self.role) {
            return Err(Refusal::new(
                "comment_viewer",
                "Your role can read comments but not write them.",
            ));
        }
        let switches = self.switches().await?;
        if !switches.server {
            return Err(Refusal::new(
                "comment_off_server",
                "Comments are turned off on this server.",
            ));
        }
        if !switches.project {
            return Err(Refusal::new(
                "comment_off_project",
                "Comments are turned off for this project.",
            ));
        }
        let members = self.comment_members();
        let peer = self.peer();
        self.room
            .comment(&self.state, &peer, &self.key, self.id, action, &members)
            .await
    }

    async fn suggestion(&mut self, action: SuggestionAction) -> Result<(), Refusal> {
        let allowed = match &action {
            SuggestionAction::Withdraw { .. } => pending_core::may_suggest(self.role),
            _ => pending_core::may_resolve(self.role),
        };
        if !allowed {
            return Err(Refusal::new(
                "suggestion_role",
                "Your role can't make or review suggestions.",
            ));
        }
        let account = self.account;
        let peer = self.peer();
        self.room
            .apply(&self.state, &peer, &self.key, move |doc, _| {
                let files = match action {
                    SuggestionAction::Accept { ids } => {
                        pending_core::accept_suggestions(doc, &ids)?
                    }
                    SuggestionAction::Reject { ids } => {
                        pending_core::reject_suggestions(doc, &ids)?
                    }
                    SuggestionAction::Withdraw { ids } => {
                        pending_core::withdraw_suggestions(doc, &ids, account)?
                    }
                    SuggestionAction::AcceptFile { file_id } => {
                        pending_core::accept_file_suggestions(doc, &file_id)?
                    }
                    SuggestionAction::RejectFile { file_id } => {
                        pending_core::reject_file_suggestions(doc, &file_id)?
                    }
                };
                Ok(Applied {
                    suggestions: files,
                    chat: false,
                })
            })
            .await
    }

    async fn chat(&mut self, action: ChatAction) -> Result<(), Refusal> {
        let allowed = match &action {
            ChatAction::Clear => self.role == ProjectRole::Owner,
            ChatAction::Send { .. } | ChatAction::Delete { .. } => {
                pending_core::may_chat(self.role)
            }
        };
        if !allowed {
            return Err(Refusal::new(
                "chat_role",
                "Your role can't post in the chat.",
            ));
        }
        let account = self.account;
        let peer = self.peer();
        self.room
            .apply(&self.state, &peer, &self.key, move |doc, now| {
                match action {
                    ChatAction::Send { body } => pending_core::send_chat(doc, account, now, &body)?,
                    ChatAction::Delete { id } => pending_core::delete_chat(doc, &id, account)?,
                    ChatAction::Clear => pending_core::clear_chat(doc)?,
                }
                Ok(Applied {
                    suggestions: Vec::new(),
                    chat: true,
                })
            })
            .await
    }

    fn send_peers(&self) {
        self.sink.send(&Outgoing::Presence {
            peers: self.peers.values().cloned().collect(),
        });
    }

    async fn heard(&mut self, frame: ServerFrame) -> bool {
        match frame {
            ServerFrame::Update {
                project_id,
                seq,
                envelope,
                ..
            } if project_id == self.project => {
                self.room.receive(&self.state, seq, envelope).await;
            }
            ServerFrame::Presence {
                project_id,
                device_id,
                account_id,
                state,
            } if project_id == self.project && device_id != self.device => {
                let name = self.name_of(account_id);
                self.peers.insert(
                    device_id,
                    WebPeer {
                        device_id,
                        account_id,
                        name,
                        file_id: state.file_id,
                        anchor: state.anchor,
                        head: state.cursor,
                    },
                );
                self.send_peers();
            }
            ServerFrame::PresenceLeft {
                project_id,
                device_id,
            } if project_id == self.project => {
                if self.peers.remove(&device_id).is_some() {
                    self.send_peers();
                }
            }
            ServerFrame::AccessChanged {
                project_id,
                role,
                change,
                comments,
            } if project_id == self.project => match role {
                None => {
                    self.sink.send(&Outgoing::Access {
                        role: ProjectRole::Unknown,
                        removed: Some(true),
                    });
                    self.sink.send(&Outgoing::error(
                        "access_removed",
                        "You no longer have access to this project.",
                        None,
                    ));
                    return true;
                }
                Some(role) => {
                    if role != self.role {
                        self.role = role;
                        self.sink.send(&Outgoing::Access {
                            role,
                            removed: None,
                        });
                    }
                    let others = change.is_some_and(|change| change.account_id != self.account);
                    if others || comments.is_some() {
                        if others {
                            self.refresh_members().await;
                        }
                        if self.hello().await.is_err() {
                            return false;
                        }
                    }
                }
            },
            ServerFrame::ProjectArchived { project_id } if project_id == self.project => {
                self.sink.send(&Outgoing::error(
                    "project_removed",
                    "This project is no longer shared.",
                    None,
                ));
                return true;
            }
            _ => {}
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_problems_before_hello_use_the_codes_the_web_app_knows() {
        let code = |status, role, removed| refusal_for(status, role, removed).map(|r| r.code);
        assert_eq!(code(None, None, false).as_deref(), Some("not_found"));
        assert_eq!(
            code(Some(ProjectStatus::Active), None, true).as_deref(),
            Some("removed")
        );
        assert_eq!(
            code(Some(ProjectStatus::Active), None, false).as_deref(),
            Some("not_found")
        );
        assert_eq!(
            code(
                Some(ProjectStatus::Pending),
                Some(ProjectRole::Owner),
                false
            )
            .as_deref(),
            Some("project_not_shared")
        );
        assert_eq!(
            code(
                Some(ProjectStatus::Archived),
                Some(ProjectRole::Editor),
                false
            )
            .as_deref(),
            Some("archived")
        );
        assert_eq!(
            code(
                Some(ProjectStatus::Active),
                Some(ProjectRole::Viewer),
                false
            ),
            None
        );
    }
}
