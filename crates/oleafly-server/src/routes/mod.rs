pub mod access_log;
pub mod admin;
pub mod auth;
pub mod code_sign_in;
pub mod console;
pub mod devices;
pub mod email;
pub mod email_sign_in;
pub mod guests;
pub mod landing;
pub mod meta;
pub mod poll;
pub mod projects;
pub mod sign_in_pages;
pub mod ws;

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::str::FromStr;

use axum::body::{Body, Bytes, HttpBody};
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{ConnectInfo, FromRequestParts, Path};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap};
use axum::{Json, Router};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::roles::{server_role_allows, ServerAction, ServerRole};
use rusqlite::{Connection, OptionalExtension};

use crate::config::ServerConfig;
use crate::error::ServerError;
use crate::members;
use crate::state::AppState;
use crate::tokens;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .merge(meta::router())
        .merge(admin::router())
        .merge(console::router())
        .merge(auth::router())
        .merge(email_sign_in::router())
        .merge(code_sign_in::router())
        .merge(devices::router())
        .merge(email::router())
        .merge(ws::router())
        .merge(poll::router())
        .merge(projects::router())
        .merge(access_log::router())
        .merge(guests::router())
        .merge(landing::router())
}

pub async fn not_found() -> ServerError {
    ServerError::NotFound
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Authenticated {
    pub account_id: AccountId,
    pub device_id: DeviceId,
    pub role: ServerRole,
}

impl Authenticated {
    pub fn require(&self, action: ServerAction) -> Result<(), ServerError> {
        if server_role_allows(self.role, action) {
            Ok(())
        } else {
            Err(ServerError::Forbidden)
        }
    }
}

impl FromRequestParts<AppState> for Authenticated {
    type Rejection = ServerError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers).ok_or(ServerError::Unauthorized)?;
        let now = state.clock.now_ms();
        state
            .db
            .call(move |conn| authenticate(conn, &token, now))
            .await
    }
}

pub fn authenticate(
    conn: &Connection,
    token: &str,
    now: i64,
) -> Result<Authenticated, ServerError> {
    let access =
        tokens::resolve_access_token(conn, token, now)?.ok_or(ServerError::Unauthorized)?;
    let row = conn
        .query_row(
            "SELECT server_role, status FROM accounts WHERE id = ?1",
            [access.account_id.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match row {
        Some((role, status)) if status == "active" => Ok(Authenticated {
            account_id: access.account_id,
            device_id: access.device_id,
            role: members::role_from_str(&role)?,
        }),
        _ => Err(members::session_end_reason(conn, access.account_id)?
            .map_or(ServerError::Unauthorized, ServerError::SessionEnded)),
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then(|| token.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientIp(pub Option<String>);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(ClientIp(
            client_ip(parts, &state.config).map(|address| address.to_string()),
        ))
    }
}

fn forwarded_address(item: &str) -> Option<IpAddr> {
    let item = item.trim();
    item.parse::<IpAddr>()
        .or_else(|_| item.parse::<SocketAddr>().map(|address| address.ip()))
        .ok()
        .map(|address| address.to_canonical())
}

fn client_ip(parts: &Parts, config: &ServerConfig) -> Option<IpAddr> {
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(address)| address.ip().to_canonical());
    if !config.behind_proxy {
        return peer;
    }
    let forwarded: Vec<Option<IpAddr>> = parts
        .headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(forwarded_address)
        .collect();
    if config.trusted_proxies.is_empty() {
        let skip = usize::from(config.proxy_hops.max(1)) - 1;
        return match forwarded.iter().rev().nth(skip).or(forwarded.first()) {
            Some(Some(address)) => Some(*address),
            Some(None) | None => peer,
        };
    }
    let trusted = |address: &IpAddr| {
        config
            .trusted_proxies
            .iter()
            .any(|range| range.contains(*address))
    };
    if peer.is_some_and(|peer| !trusted(&peer)) {
        return peer;
    }
    let mut leftmost = peer;
    for entry in forwarded.iter().rev() {
        match entry {
            Some(address) if trusted(address) => leftmost = Some(*address),
            Some(address) => return Some(*address),
            None => return peer,
        }
    }
    leftmost
}

pub fn json_body<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, ServerError> {
    body.map(|Json(value)| value)
        .map_err(|rejection| ServerError::BadRequest(rejection.body_text()))
}

pub fn path_id<T: FromStr>(path: Result<Path<String>, PathRejection>) -> Result<T, ServerError> {
    let Path(raw) = path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    raw.parse::<T>()
        .map_err(|_| ServerError::BadRequest(format!("{raw} is not a valid id.")))
}

pub async fn read_body_within(mut body: Body, limit: u64) -> Result<Option<Bytes>, ServerError> {
    let mut collected: Vec<u8> = Vec::new();
    while let Some(frame) = std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx)).await {
        let frame = frame.map_err(|_| {
            ServerError::BadRequest("The upload did not finish. Try again.".to_string())
        })?;
        let Ok(data) = frame.into_data() else {
            continue;
        };
        if collected.len() as u64 + data.len() as u64 > limit {
            return Ok(None);
        }
        collected.extend_from_slice(&data);
    }
    Ok(Some(Bytes::from(collected)))
}

#[cfg(test)]
mod body_tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use axum::body::{Body, Bytes};
    use futures_util::stream::{self, StreamExt};

    use super::read_body_within;
    use crate::error::ServerError;

    fn counted(chunks: usize, size: usize, polled: Arc<AtomicUsize>) -> Body {
        let chunks = stream::iter(
            (0..chunks).map(move |_| Ok::<_, std::io::Error>(Bytes::from(vec![7u8; size]))),
        )
        .inspect(move |_| {
            polled.fetch_add(1, Ordering::SeqCst);
        });
        Body::from_stream(chunks)
    }

    #[tokio::test]
    async fn a_body_within_the_limit_comes_back_whole() {
        let polled = Arc::new(AtomicUsize::new(0));
        let read = read_body_within(counted(4, 10, polled), 40)
            .await
            .expect("the body reads");
        assert_eq!(read.map(|bytes| bytes.len()), Some(40));
    }

    #[tokio::test]
    async fn reading_stops_as_soon_as_the_limit_is_passed() {
        let polled = Arc::new(AtomicUsize::new(0));
        let read = read_body_within(counted(100, 10, Arc::clone(&polled)), 25)
            .await
            .expect("the body reads");
        assert!(read.is_none());
        assert_eq!(polled.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn a_body_that_breaks_off_is_a_bad_request() {
        let broken = stream::iter(vec![
            Ok(Bytes::from_static(b"start")),
            Err(std::io::Error::other("the client went away")),
        ]);
        let read = read_body_within(Body::from_stream(broken), 1024).await;
        assert!(matches!(read, Err(ServerError::BadRequest(_))));
    }
}
