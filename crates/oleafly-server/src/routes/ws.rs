use std::time::Duration;

use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::auth::ChallengePurpose;
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::auth::devices;
use crate::members;
use crate::sockets::SocketControl;
use crate::state::AppState;
use crate::tokens::{random_token, resolve_access_token};

pub const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_FRAME_BYTES: usize = 64 * 1024;

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
        Some(account_id) => {
            let welcome = ServerFrame::Welcome {
                protocol: PROTOCOL_VERSION,
                account_id,
            };
            if send(&mut socket, &welcome).await {
                serve_session(&mut socket, &mut ticket.control).await;
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
) -> Option<AccountId> {
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
            Ok(Some(context.account_id))
        })
        .await;
    checked.ok().flatten()
}

async fn serve_session(socket: &mut WebSocket, control: &mut UnboundedReceiver<SocketControl>) {
    loop {
        tokio::select! {
            signal = control.recv() => {
                if matches!(signal, Some(SocketControl::Revoked)) && send(socket, &ServerFrame::SessionRevoked).await {
                    close(socket, "Session revoked.").await;
                }
                return;
            }
            incoming = next_incoming(socket) => match incoming {
                Incoming::Frame(ClientFrame::Ping { id }) => {
                    if !send(socket, &ServerFrame::Pong { id }).await {
                        return;
                    }
                }
                Incoming::Frame(ClientFrame::Hello { .. }) | Incoming::Malformed => {
                    let frame = ServerFrame::Error {
                        code: FrameErrorCode::BadFrame,
                        message: "Unexpected frame.".to_owned(),
                    };
                    if !send(socket, &frame).await {
                        return;
                    }
                }
                Incoming::Closed => return,
            },
        }
    }
}
