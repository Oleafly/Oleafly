pub mod admin;
pub mod auth;
pub mod devices;
pub mod landing;
pub mod meta;
pub mod projects;
pub mod ws;

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;

use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{ConnectInfo, FromRequestParts, Path};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap};
use axum::{Json, Router};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::roles::{server_role_allows, ServerAction, ServerRole};
use rusqlite::{Connection, OptionalExtension};

use crate::error::ServerError;
use crate::members;
use crate::state::AppState;
use crate::tokens;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .merge(meta::router())
        .merge(admin::router())
        .merge(auth::router())
        .merge(devices::router())
        .merge(ws::router())
        .merge(projects::router())
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
        _ => Err(ServerError::Unauthorized),
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
        Ok(ClientIp(client_ip(parts, state.config.behind_proxy)))
    }
}

fn client_ip(parts: &Parts, behind_proxy: bool) -> Option<String> {
    if behind_proxy {
        let mut forwarded: Vec<IpAddr> = parts
            .headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .filter_map(|item| item.trim().parse::<IpAddr>().ok())
            .collect();
        if let Some(address) = forwarded.pop() {
            return Some(address.to_string());
        }
    }
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(address)| address.ip().to_string())
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
