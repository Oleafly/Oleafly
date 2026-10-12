use std::sync::Arc;

use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap};
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{DeviceId, SharedProjectId};
use oleafly_collab_protocol::poll::{
    PollBatch, PollFrames, PollReplies, DEVICE_HEADER, MAX_POSTED_FRAMES, NONCE_HEADER,
    POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use serde::Deserialize;

use crate::auth::nonce;
use crate::error::ServerError;
use crate::polls::{self, Opening, PollSession};
use crate::rate_limit::client_key;
use crate::rooms::RoomMember;
use crate::routes::ws::{frame_error, proves_device, unexpected_frame, Opened, Peer};
use crate::routes::{json_body, path_id, ClientIp};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{project}/poll", get(poll))
        .route(
            "/api/v1/projects/{project}/frames",
            post(frames).route_layer(DefaultBodyLimit::max(crate::routes::ws::MAX_FRAME_BYTES)),
        )
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

fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = header_text(headers, header::AUTHORIZATION.as_str())?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then(|| token.to_owned())
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
    let token = bearer(headers).ok_or(ServerError::Unauthorized)?;
    let protocol = header_text(headers, PROTOCOL_HEADER)
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| {
            ServerError::BadRequest("Say which protocol version you speak.".to_owned())
        })?;
    if protocol != PROTOCOL_VERSION {
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
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    let proved = state
        .db
        .call(move |conn| {
            if !nonce::consume(conn, &echoed, now)? {
                return Ok(None);
            }
            proves_device(conn, server_id, now, device, &token, &echoed, &signature)
        })
        .await
        .inspect_err(|_| state.connects.forgive(address, now))?;
    let (account, public_key) = proved.ok_or(ServerError::Unauthorized)?;
    if !state.connects.admitted(address, device, now) {
        return Err(ServerError::RateLimited);
    }
    if state.polls.count() >= polls::MAX_POLL_SESSIONS {
        return Err(ServerError::RateLimited);
    }
    for stale in state.polls.opened_by(device, project) {
        polls::close(state, &stale);
    }
    for oldest in state.polls.beyond_account_cap(account) {
        polls::close(state, &oldest);
    }
    let ticket = state.sockets.register(device);
    state.sockets.admit(device, ticket.id);
    let (frames, outbound) = polls::channel();
    let member = RoomMember {
        connection: ticket.id,
        device,
        account,
        frames: frames.clone(),
        control: ticket.signal.clone(),
    };
    let peer = Peer {
        state,
        device,
        account,
        public_key: &public_key,
        connection: ticket.id,
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
            };
            polls::start(state, opening, subscribed, since, head)
                .await
                .map(Json)
        }
    }
}

async fn frames(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<PollFrames>, JsonRejection>,
) -> Result<Json<PollReplies>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let session = session_for(&state, ip, &headers, project)?;
    let _active = session.enter();
    if session.is_ended() {
        return Err(ServerError::NotFound);
    }
    let posted = json_body(body)?.frames;
    if posted.len() > MAX_POSTED_FRAMES {
        return Err(ServerError::BadRequest(format!(
            "Send at most {MAX_POSTED_FRAMES} frames at a time."
        )));
    }
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
            ClientFrame::Hello { .. } | ClientFrame::Subscribe { .. } => {
                replies.push(unexpected_frame());
            }
        }
    }
    Ok(Json(PollReplies { frames: replies }))
}
