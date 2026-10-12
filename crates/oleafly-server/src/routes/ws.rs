use std::time::Duration;

use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::auth::ChallengePurpose;
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, PresenceState, ProjectAction, ProjectStatus,
};
use tokio::sync::mpsc::{self, Sender};

use crate::auth::devices;
use crate::error::ServerError;
use crate::members;
use crate::projects;
use crate::rooms::RoomMember;
use crate::sockets::{SocketControl, SocketTicket};
use crate::state::AppState;
use crate::tokens::{random_token, resolve_access_token};

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_FRAME_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_UPDATE_BYTES: usize = 8 * 1024 * 1024;
pub const OUTBOUND_CAPACITY: usize = 512;
const MAX_PRESENCE_FILE_ID: usize = 256;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(upgrade))
}

async fn upgrade(State(state): State<AppState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| run(state, socket))
}

enum Incoming {
    Frame(ClientFrame),
    Malformed,
    Closed,
}

async fn next_incoming(socket: &mut WebSocket) -> Incoming {
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                return serde_json::from_str(text.as_str())
                    .map_or(Incoming::Malformed, Incoming::Frame);
            }
            Some(Ok(Message::Binary(_))) => return Incoming::Malformed,
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
            Some(Ok(Message::Close(_)) | Err(_)) | None => return Incoming::Closed,
        }
    }
}

async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> bool {
    match serde_json::to_string(frame) {
        Ok(text) => socket.send(Message::Text(text.into())).await.is_ok(),
        Err(_) => false,
    }
}

async fn close(socket: &mut WebSocket, reason: &str) {
    let frame = CloseFrame {
        code: close_code::POLICY,
        reason: reason.into(),
    };
    let _ = socket.send(Message::Close(Some(frame))).await;
}

async fn refuse(socket: &mut WebSocket, code: FrameErrorCode, message: &str) {
    let frame = ServerFrame::Error {
        code,
        message: message.to_owned(),
    };
    if send(socket, &frame).await {
        close(socket, message).await;
    }
}

async fn run(state: AppState, mut socket: WebSocket) {
    let nonce = random_token();
    let challenge = ServerFrame::Challenge {
        nonce: nonce.clone(),
        server_id: state.server_id,
    };
    if !send(&mut socket, &challenge).await {
        return;
    }
    let hello = match tokio::time::timeout(HELLO_TIMEOUT, next_incoming(&mut socket)).await {
        Ok(Incoming::Frame(frame)) => frame,
        Ok(Incoming::Malformed) => {
            return refuse(
                &mut socket,
                FrameErrorCode::BadFrame,
                "The first frame must be a hello.",
            )
            .await
        }
        Ok(Incoming::Closed) => return,
        Err(_) => {
            return refuse(
                &mut socket,
                FrameErrorCode::Unauthorized,
                "No hello arrived in time.",
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
    let account = if echoed == nonce {
        authorize(&state, device_id, access_token, echoed, signature).await
    } else {
        None
    };
    match account {
        Some((account_id, public_key)) => {
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
                };
                session.serve(&mut socket, &mut ticket).await;
            }
        }
        None => {
            refuse(
                &mut socket,
                FrameErrorCode::Unauthorized,
                "This session is not valid.",
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
) -> Option<(AccountId, Vec<u8>)> {
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    let checked = state
        .db
        .call(move |conn| {
            let Some(context) = resolve_access_token(conn, &access_token, now)? else {
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
                    &nonce,
                    &signature,
                );
            if !valid {
                return Ok(None);
            }
            devices::touch(conn, device_id, now)?;
            let key = b64url_decode(&device.public_key)
                .map_err(|_| ServerError::Internal("a device key does not decode".to_string()))?;
            Ok(Some((context.account_id, key)))
        })
        .await;
    checked.ok().flatten()
}

struct Session<'a> {
    state: &'a AppState,
    device: DeviceId,
    account: AccountId,
    public_key: Vec<u8>,
}

fn subscribe_refusal(error: &ServerError) -> FrameErrorCode {
    match error {
        ServerError::NotFound | ServerError::Forbidden => FrameErrorCode::NotFound,
        _ => FrameErrorCode::Internal,
    }
}

fn frame_error(code: FrameErrorCode, message: &str) -> ServerFrame {
    ServerFrame::Error {
        code,
        message: message.to_owned(),
    }
}

impl Session<'_> {
    async fn serve(&self, socket: &mut WebSocket, ticket: &mut SocketTicket) {
        let (frames, mut outbound) = mpsc::channel::<ServerFrame>(OUTBOUND_CAPACITY);
        loop {
            tokio::select! {
                signal = ticket.control.recv() => {
                    match signal {
                        Some(SocketControl::Revoked) => {
                            if send(socket, &ServerFrame::SessionRevoked).await {
                                close(socket, "Session revoked.").await;
                            }
                        }
                        Some(SocketControl::Overloaded) => {
                            close(socket, "This connection fell behind. Reconnect.").await;
                        }
                        None => {}
                    }
                    break;
                }
                Some(frame) = outbound.recv() => {
                    if !send(socket, &frame).await {
                        break;
                    }
                }
                incoming = next_incoming(socket) => {
                    let keep_going = match incoming {
                        Incoming::Frame(frame) => self.handle(socket, ticket, &frames, frame).await,
                        Incoming::Malformed => {
                            send(socket, &frame_error(FrameErrorCode::BadFrame, "Unexpected frame.")).await
                        }
                        Incoming::Closed => false,
                    };
                    if !keep_going {
                        break;
                    }
                }
            }
        }
        for (project, _) in self.state.rooms.leave_all(ticket.id) {
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

    async fn handle(
        &self,
        socket: &mut WebSocket,
        ticket: &SocketTicket,
        frames: &Sender<ServerFrame>,
        frame: ClientFrame,
    ) -> bool {
        match frame {
            ClientFrame::Ping { id } => send(socket, &ServerFrame::Pong { id }).await,
            ClientFrame::Subscribe {
                project_id,
                since_seq,
            } => {
                self.subscribe(socket, ticket, frames, project_id, since_seq)
                    .await
            }
            ClientFrame::Unsubscribe { project_id } => {
                if self.state.rooms.leave(project_id, ticket.id).is_some() {
                    self.state.rooms.broadcast(
                        project_id,
                        None,
                        &ServerFrame::PresenceLeft {
                            project_id,
                            device_id: self.device,
                        },
                    );
                }
                true
            }
            ClientFrame::Update {
                project_id,
                envelope,
            } => self.update(socket, ticket, project_id, envelope).await,
            ClientFrame::Presence { project_id, state } => {
                self.presence(socket, ticket, project_id, state).await
            }
            ClientFrame::PresenceLeave { project_id } => {
                if self.state.rooms.is_member(project_id, ticket.id) {
                    self.state.rooms.broadcast(
                        project_id,
                        Some(ticket.id),
                        &ServerFrame::PresenceLeft {
                            project_id,
                            device_id: self.device,
                        },
                    );
                }
                true
            }
            ClientFrame::Hello { .. } => {
                send(
                    socket,
                    &frame_error(FrameErrorCode::BadFrame, "Unexpected frame."),
                )
                .await
            }
        }
    }

    async fn subscribe(
        &self,
        socket: &mut WebSocket,
        ticket: &SocketTicket,
        frames: &Sender<ServerFrame>,
        project: SharedProjectId,
        since: u64,
    ) -> bool {
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
                Ok((role, row.head_seq, oldest, snapshot))
            })
            .await;
        let (role, head, oldest, snapshot) = match checked {
            Ok(found) => found,
            Err(error) => {
                let code = subscribe_refusal(&error);
                let message = if code == FrameErrorCode::NotFound {
                    "You don't have access to this project."
                } else {
                    "The server could not open this project. Try again."
                };
                return send(socket, &frame_error(code, message)).await;
            }
        };
        let missing_from_log = since < head && oldest.is_none_or(|oldest| oldest > since + 1);
        if missing_from_log && snapshot.is_some_and(|seq| seq > since) {
            return send(
                socket,
                &ServerFrame::SnapshotRequired {
                    project_id: project,
                },
            )
            .await;
        }
        self.state.rooms.join(
            project,
            RoomMember {
                connection: ticket.id,
                device: self.device,
                account: self.account,
                frames: frames.clone(),
                control: ticket.signal.clone(),
            },
        );
        let still = self
            .state
            .db
            .call(move |conn| projects::role_of(conn, project, account))
            .await;
        if !matches!(still, Ok(Some(_))) {
            self.state.rooms.leave(project, ticket.id);
            return send(
                socket,
                &frame_error(
                    FrameErrorCode::NotFound,
                    "You don't have access to this project.",
                ),
            )
            .await;
        }
        if !send(
            socket,
            &ServerFrame::Subscribed {
                project_id: project,
                role,
                head_seq: head,
            },
        )
        .await
        {
            return false;
        }
        let mut cursor = since;
        loop {
            let page = self
                .state
                .db
                .call(move |conn| projects::updates_since(conn, project, cursor))
                .await;
            let Ok(page) = page else {
                return false;
            };
            let full = page.len() >= projects::BACKLOG_LIMIT;
            for stored in page {
                cursor = stored.seq;
                let Ok(envelope) = serde_json::from_slice::<Envelope>(&stored.envelope) else {
                    continue;
                };
                let frame = ServerFrame::Update {
                    project_id: project,
                    seq: stored.seq,
                    account_id: Some(stored.account),
                    envelope,
                };
                if !send(socket, &frame).await {
                    return false;
                }
            }
            if !full || cursor >= head {
                return true;
            }
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
            &self.public_key,
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

    async fn update(
        &self,
        socket: &mut WebSocket,
        ticket: &SocketTicket,
        project: SharedProjectId,
        envelope: Envelope,
    ) -> bool {
        if !self.state.rooms.is_member(project, ticket.id) {
            return send(
                socket,
                &frame_error(
                    FrameErrorCode::Forbidden,
                    "Open the project before changing it.",
                ),
            )
            .await;
        }
        if let Some(problem) = self.envelope_problem(project, &envelope) {
            return send(socket, &problem).await;
        }
        let Ok(stored) = serde_json::to_vec(&envelope) else {
            return false;
        };
        let (account, device, batch) = (self.account, self.device, envelope.batch_id);
        let now = self.state.clock.now_ms();
        let rooms = std::sync::Arc::clone(&self.state.rooms);
        let connection = ticket.id;
        let appended = self
            .state
            .db
            .call(move |conn| {
                let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
                let role =
                    projects::role_of(conn, project, account)?.ok_or(ServerError::NotFound)?;
                if row.status != ProjectStatus::Active
                    || !project_role_allows(role, ProjectAction::Edit)
                {
                    return Err(ServerError::Forbidden);
                }
                let appended =
                    projects::append_update(conn, project, batch, device, account, &stored, now)?;
                if !appended.duplicate {
                    rooms.broadcast(
                        project,
                        Some(connection),
                        &ServerFrame::Update {
                            project_id: project,
                            seq: appended.seq,
                            account_id: Some(account),
                            envelope,
                        },
                    );
                }
                Ok(appended)
            })
            .await;
        match appended {
            Ok(appended) => {
                let ack = ServerFrame::Ack {
                    project_id: project,
                    batch_id: batch,
                    seq: appended.seq,
                };
                send(socket, &ack).await
            }
            Err(ServerError::Forbidden | ServerError::NotFound) => {
                send(
                    socket,
                    &frame_error(FrameErrorCode::Forbidden, "You can't edit this project."),
                )
                .await
            }
            Err(_) => {
                send(
                    socket,
                    &frame_error(
                        FrameErrorCode::Internal,
                        "The server could not store this change.",
                    ),
                )
                .await
            }
        }
    }

    async fn presence(
        &self,
        socket: &mut WebSocket,
        ticket: &SocketTicket,
        project: SharedProjectId,
        state: PresenceState,
    ) -> bool {
        if !self.state.rooms.is_member(project, ticket.id) {
            return true;
        }
        if state
            .file_id
            .as_ref()
            .is_some_and(|file| file.len() > MAX_PRESENCE_FILE_ID)
        {
            return send(
                socket,
                &frame_error(
                    FrameErrorCode::BadFrame,
                    "This presence update is not valid.",
                ),
            )
            .await;
        }
        self.state.rooms.broadcast(
            project,
            Some(ticket.id),
            &ServerFrame::Presence {
                project_id: project,
                device_id: self.device,
                account_id: self.account,
                state,
            },
        );
        true
    }
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
