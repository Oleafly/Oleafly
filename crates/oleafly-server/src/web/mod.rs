pub mod api;
pub mod assets;
pub mod frames;
pub mod gateway;
pub mod pending_core;
pub mod room;
pub mod sign_in;

use axum::extract::FromRequestParts;
use axum::http::header::ORIGIN;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{any, get, post};
use axum::Router;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::frames::FrameErrorCode;
use oleafly_collab_protocol::ids::SharedProjectId;

pub use room::Hub;

use crate::config::ServerConfig;
use crate::error::ServerError;
use crate::state::AppState;
use crate::web_sessions::{self, WebCaller};

pub const REQUESTED_WITH: &str = "oleafly-web";
pub const REQUESTED_WITH_HEADER: &str = "x-requested-with";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/web", get(assets::home))
        .route("/web/", get(assets::index))
        .route("/web/{*path}", get(assets::file))
        .route("/web/sign-in", get(sign_in::page))
        .route("/web/ws", get(gateway::upgrade))
        .route("/web/api/me", get(api::me))
        .route("/web/api/projects", get(api::projects))
        .route("/web/api/projects/{project}", get(api::project))
        .route("/web/api/projects/{project}/blobs/{hash}", get(api::blob))
        .route("/web/api/projects/{project}/texts", get(api::texts))
        .route("/web/api/projects/{project}/output", get(api::outputs))
        .route(
            "/web/api/projects/{project}/output/{kind}",
            get(api::output)
                .put(api::put_output)
                .layer(axum::middleware::map_response(crate::transfers::retry_soon)),
        )
        .route("/web/api/sign-out", post(api::sign_out))
        .route("/web/api/{*rest}", any(api::unknown))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub code: String,
    pub message: String,
}

impl Refusal {
    pub fn new(code: &str, message: &str) -> Refusal {
        Refusal {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn server() -> Refusal {
        Refusal::new("server", "The server could not do that. Try again.")
    }

    pub fn from_frame(code: FrameErrorCode, message: &str) -> Refusal {
        let code = match code {
            FrameErrorCode::Forbidden => "forbidden",
            FrameErrorCode::NotFound => "not_found",
            FrameErrorCode::TooLarge | FrameErrorCode::ProjectTooLarge => "too_large",
            FrameErrorCode::RateLimited => "rate_limited",
            FrameErrorCode::CommentsOff => "comment_off_project",
            FrameErrorCode::BadFrame => "invalid",
            FrameErrorCode::Unauthorized
            | FrameErrorCode::ProtocolMismatch
            | FrameErrorCode::Internal
            | FrameErrorCode::Unknown => "server",
        };
        Refusal::new(code, message)
    }

    pub fn from_collab(error: &CollabError) -> Refusal {
        let CollabError::Api { code, message, .. } = error else {
            return Refusal::server();
        };
        let mapped = match code.as_str() {
            "not_yours" => "comment_not_yours",
            "someone_replied" => "comment_someone_replied",
            "message_deleted" => "comment_message_deleted",
            "selection_changed" => "comment_selection_changed",
            "too_large" => "comment_too_long",
            "empty" => "comment_empty",
            "not_found" => "not_found",
            "suggestion_not_found" => "suggestion_not_found",
            "suggestion_not_yours" => "suggestion_not_yours",
            "suggestion_role" => "suggestion_role",
            "chat_role" => "chat_role",
            _ => "server",
        };
        Refusal::new(mapped, message)
    }
}

pub struct WebOn;

impl FromRequestParts<AppState> for WebOn {
    type Rejection = ServerError;

    async fn from_request_parts(
        _parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if state.config.web {
            Ok(WebOn)
        } else {
            Err(ServerError::NotFound)
        }
    }
}

pub struct WebUser {
    pub caller: WebCaller,
    pub token: String,
}

impl FromRequestParts<AppState> for WebUser {
    type Rejection = ServerError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !state.config.web {
            return Err(ServerError::NotFound);
        }
        signed_in(state, &parts.headers).await
    }
}

pub async fn signed_in(state: &AppState, headers: &HeaderMap) -> Result<WebUser, ServerError> {
    let token = web_sessions::presented(headers).ok_or(ServerError::Unauthorized)?;
    let now = state.clock.now_ms();
    let checked = token.clone();
    let caller = state
        .db
        .read(move |conn| web_sessions::resolve(conn, &checked, now))
        .await?;
    Ok(WebUser { caller, token })
}

/// The signed-in session behind a browser request that changes something. It
/// has to carry the app's marker and come from this server's origin.
pub async fn changing(state: &AppState, headers: &HeaderMap) -> Result<WebUser, ServerError> {
    if !state.config.web {
        return Err(ServerError::NotFound);
    }
    if !requested_by_the_app(headers, &state.config) {
        return Err(cross_site());
    }
    signed_in(state, headers).await
}

pub fn same_origin(headers: &HeaderMap, config: &ServerConfig) -> bool {
    let expected = config.public_url.origin().ascii_serialization();
    let mut origins = headers.get_all(ORIGIN).iter();
    match (origins.next(), origins.next()) {
        (Some(origin), None) => origin.to_str().is_ok_and(|origin| origin == expected),
        _ => false,
    }
}

pub fn requested_by_the_app(headers: &HeaderMap, config: &ServerConfig) -> bool {
    let marked = headers
        .get(REQUESTED_WITH_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == REQUESTED_WITH);
    marked && same_origin(headers, config)
}

pub fn cross_site() -> ServerError {
    ServerError::Refused {
        status: StatusCode::FORBIDDEN,
        code: "cross_site",
        message: "This request did not come from the Oleafly web app on this server.".to_string(),
    }
}

pub async fn output_changed(state: &AppState, project: SharedProjectId) {
    if let Some(room) = state.web.live(project) {
        room.output_changed(state).await;
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;
    use crate::test_support::test_config;

    fn with(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_static(value));
        }
        headers
    }

    #[test]
    fn only_this_servers_exact_origin_counts_as_the_same_origin() {
        let config = test_config();
        assert!(same_origin(
            &with(&[("origin", "https://collab.test")]),
            &config
        ));
        for other in [
            "https://collab.test.evil.example",
            "http://collab.test",
            "https://collab.test:444",
            "null",
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(ORIGIN, HeaderValue::from_str(other).unwrap());
            assert!(!same_origin(&headers, &config), "{other}");
        }
        assert!(!same_origin(&HeaderMap::new(), &config));
        assert!(!same_origin(
            &with(&[
                ("origin", "https://collab.test"),
                ("origin", "https://other.test")
            ]),
            &config
        ));
    }

    #[test]
    fn a_change_needs_the_app_marker_and_the_origin() {
        let config = test_config();
        assert!(requested_by_the_app(
            &with(&[
                ("origin", "https://collab.test"),
                ("x-requested-with", "oleafly-web")
            ]),
            &config
        ));
        assert!(!requested_by_the_app(
            &with(&[("origin", "https://collab.test")]),
            &config
        ));
        assert!(!requested_by_the_app(
            &with(&[("x-requested-with", "oleafly-web")]),
            &config
        ));
        assert!(!requested_by_the_app(
            &with(&[
                ("origin", "https://collab.test"),
                ("x-requested-with", "XMLHttpRequest")
            ]),
            &config
        ));
    }

    #[test]
    fn refusals_use_the_codes_the_web_app_knows() {
        assert_eq!(
            Refusal::from_frame(FrameErrorCode::ProjectTooLarge, "full").code,
            "too_large"
        );
        assert_eq!(
            Refusal::from_frame(FrameErrorCode::CommentsOff, "off").code,
            "comment_off_project"
        );
        assert_eq!(
            Refusal::from_frame(FrameErrorCode::Unauthorized, "x").code,
            "server"
        );
        let mine = CollabError::Api {
            status: 403,
            code: "not_yours".into(),
            message: "only the author".into(),
        };
        assert_eq!(Refusal::from_collab(&mine).code, "comment_not_yours");
        for code in [
            "suggestion_not_found",
            "suggestion_not_yours",
            "suggestion_role",
            "chat_role",
        ] {
            let refused = CollabError::Api {
                status: 403,
                code: code.into(),
                message: "no".into(),
            };
            assert_eq!(Refusal::from_collab(&refused).code, code);
        }
        assert_eq!(
            Refusal::from_collab(&CollabError::Corrupt("x".into())).code,
            "server"
        );
    }
}
