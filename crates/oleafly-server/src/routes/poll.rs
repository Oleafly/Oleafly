use std::sync::Arc;

use axum::body::Body;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{DeviceId, SharedProjectId};
use oleafly_collab_protocol::poll::{
    understood_codes, PollBatch, PollFrames, PollReplies, DEVICE_HEADER, MAX_POSTED_FRAMES,
    NONCE_HEADER, POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER, UNDERSTANDS_HEADER,
};
use serde::Deserialize;

use crate::auth::nonce;
use crate::error::ServerError;
use crate::polls::{self, Opening, PollSession};
use crate::rate_limit::client_key;
use crate::rooms::RoomMember;
use crate::routes::meta::spoken_protocol;
use crate::routes::ws::{
    bearer_token, frame_error, proves_device, unexpected_frame, CursorGate, Opened, Peer,
    MAX_FRAME_BYTES,
};
use crate::routes::{path_id, ClientIp};
use crate::state::AppState;

const TOO_MUCH: &str = "These changes are too large to send.";
const NOT_FRAMES: &str = "These frames are not valid.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{project}/poll", get(poll))
        .route("/api/v1/projects/{project}/frames", post(frames))
}

#[derive(Deserialize)]
struct PollQuery {
    #[serde(default)]
    since: u64,
    cursor: Option<String>,
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn address_of(ip: Option<String>) -> String {
    client_key(ip.as_deref().unwrap_or("unknown"))
}

fn charge(state: &AppState, address: &str) -> Result<(), ServerError> {
    if state.connects.allow_address(address, state.clock.now_ms()) {
        Ok(())
    } else {
        Err(ServerError::RateLimited)
    }
}

fn session_for(
    state: &AppState,
    ip: Option<String>,
    headers: &HeaderMap,
    project: SharedProjectId,
) -> Result<Arc<PollSession>, ServerError> {
    let found = header_text(headers, POLL_KEY_HEADER)
        .and_then(|key| state.polls.find(&key))
        .filter(|session| session.project == project);
    match found {
        Some(session) => Ok(session),
        None => {
            charge(state, &address_of(ip))?;
            Err(ServerError::NotFound)
        }
    }
}

fn only(frames: Vec<ServerFrame>) -> Json<PollBatch> {
    Json(PollBatch {
        cursor: None,
        key: None,
        frames,
    })
}

async fn poll(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<PollQuery>, QueryRejection>,
) -> Result<Json<PollBatch>, ServerError> {
    if headers.contains_key(POLL_KEY_HEADER) {
        let project: SharedProjectId = path_id(path)?;
        let session = session_for(&state, ip, &headers, project)?;
        let Query(query) =
            query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
        let cursor = query.cursor.unwrap_or_default();
        return polls::poll(&state, session, &cursor).await.map(Json);
    }
    let address = address_of(ip);
    charge(&state, &address)?;
    let project: SharedProjectId = path_id(path)?;
    let Query(query) = query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    open(&state, &address, &headers, project, query.since).await
}

async fn open(
    state: &AppState,
    address: &str,
    headers: &HeaderMap,
    project: SharedProjectId,
    since: u64,
) -> Result<Json<PollBatch>, ServerError> {
    let token = bearer_token(headers).ok_or(ServerError::Unauthorized)?;
    let protocol = header_text(headers, PROTOCOL_HEADER)
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| {
            ServerError::BadRequest("Say which protocol version you speak.".to_owned())
        })?;
    if spoken_protocol(protocol).is_none() {
        return Ok(only(vec![frame_error(
            FrameErrorCode::ProtocolMismatch,
            "This server speaks another protocol version.",
        )]));
    }
    let device = header_text(headers, DEVICE_HEADER)
        .and_then(|value| value.parse::<DeviceId>().ok())
        .ok_or(ServerError::Unauthorized)?;
    let echoed = header_text(headers, NONCE_HEADER).ok_or(ServerError::Unauthorized)?;
    let signature = header_text(headers, SIGNATURE_HEADER).ok_or(ServerError::Unauthorized)?;
    let understands = header_text(headers, UNDERSTANDS_HEADER)
        .map(|header| understood_codes(&header))
        .unwrap_or_default();
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    // Registered before the proof, like a socket, so a sign-out that lands
    // while the proof runs still reaches this session.
    let ticket = state.sockets.register(device);
    let refuse = |error: ServerError| {
        state.sockets.unregister(device, ticket.id);
        error
    };
    let proved = state
        .db
        .call(move |conn| {
            if !nonce::consume(conn, &echoed, now)? {
                return Ok(None);
            }
            proves_device(conn, server_id, now, device, &token, &echoed, &signature)
        })
        .await;
    #[cfg(any(test, feature = "test-support"))]
    state.polls.after_proof().await;
    let proved = proved.map_err(|error| {
        state.connects.forgive(address, now);
        refuse(error)
    })?;
    let (account, public_key) = proved.ok_or_else(|| refuse(ServerError::Unauthorized))?;
    if !state.connects.admitted(address, device, now)
        || state.polls.count() >= polls::MAX_POLL_SESSIONS
    {
        return Err(refuse(ServerError::RateLimited));
    }
    for stale in state.polls.opened_by(device, project) {
        polls::close(state, &stale);
    }
    for oldest in state.polls.beyond_account_cap(account) {
        polls::close(state, &oldest);
    }
    state.sockets.admit(device, ticket.id);
    let (frames, outbound) = polls::channel();
    let member = RoomMember {
        connection: ticket.id,
        device,
        account,
        frames: frames.clone(),
        control: ticket.signal.clone(),
    };
    let cursors = CursorGate::new();
    let peer = Peer {
        state,
        device,
        account,
        public_key: &public_key,
        connection: ticket.id,
        understands: &understands,
        cursors: &cursors,
    };
    match peer.open(project, since, member).await {
        Opened::Refused(frame) => {
            state.sockets.unregister(device, ticket.id);
            Ok(only(vec![frame]))
        }
        Opened::Subscribed(subscribed, head) => {
            let opening = Opening {
                project,
                device,
                account,
                public_key: public_key.clone(),
                ticket,
                frames,
                outbound,
                understands,
            };
            polls::start(state, opening, subscribed, since, head)
                .await
                .map(Json)
        }
    }
}

fn posted_frames(bytes: &[u8]) -> Result<Vec<ClientFrame>, ServerError> {
    let too_many = format!("Send at most {MAX_POSTED_FRAMES} frames at a time.");
    PollFrames::from_json(bytes)
        .map(|posted| posted.frames)
        .map_err(|error| {
            ServerError::BadRequest(if error.to_string().starts_with(&too_many) {
                too_many
            } else {
                NOT_FRAMES.to_owned()
            })
        })
}

async fn frames(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    body: Body,
) -> Result<Json<PollReplies>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let session = session_for(&state, ip, &headers, project)?;
    let _active = session.enter();
    if session.is_ended() {
        return Err(ServerError::NotFound);
    }
    let bytes = state
        .transfers
        .read_body(body, &headers, MAX_FRAME_BYTES as u64)
        .await?
        .ok_or_else(|| ServerError::BadRequest(TOO_MUCH.to_owned()))?;
    let posted = posted_frames(&bytes)?;
    let peer = session.peer(&state);
    let mut replies = Vec::new();
    for frame in posted {
        match frame {
            ClientFrame::Ping { id } => replies.push(ServerFrame::Pong { id }),
            ClientFrame::Update {
                project_id,
                envelope,
            } => replies.push(peer.update(project_id, envelope).await),
            ClientFrame::Presence { project_id, state } => {
                replies.extend(peer.presence(project_id, state));
            }
            ClientFrame::PresenceLeave { project_id } => peer.leave_presence(project_id),
            ClientFrame::Unsubscribe { project_id } => {
                if project_id == session.project {
                    polls::close(&state, &session);
                    break;
                }
            }
            ClientFrame::Hello { .. } | ClientFrame::Subscribe { .. } | ClientFrame::Unknown => {
                replies.push(unexpected_frame());
            }
        }
    }
    Ok(Json(PollReplies { frames: replies }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refused_posts_keep_the_routes_own_words() {
        let ping = r#"{"type":"ping","id":1}"#;
        let too_many = format!(
            r#"{{"frames":[{}]}}"#,
            vec![ping; MAX_POSTED_FRAMES + 1].join(",")
        );
        assert_eq!(
            posted_frames(too_many.as_bytes()),
            Err(ServerError::BadRequest(format!(
                "Send at most {MAX_POSTED_FRAMES} frames at a time."
            )))
        );
        for broken in [
            r#"{"frames":[{"type":"ping"}]}"#,
            r#"{"frames":[1]}"#,
            "not json",
            "{}",
        ] {
            assert_eq!(
                posted_frames(broken.as_bytes()),
                Err(ServerError::BadRequest(NOT_FRAMES.to_owned())),
                "{broken}"
            );
        }
        assert_eq!(
            posted_frames(format!(r#"{{"frames":[{ping}]}}"#).as_bytes()),
            Ok(vec![ClientFrame::Ping { id: 1 }])
        );
    }
}
