use std::fmt;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use oleafly_collab_protocol::auth::{ApiError, AuthErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerError {
    BadRequest(String),
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict(String),
    RateLimited,
    Auth(AuthErrorCode),
    Internal(String),
}

impl ServerError {
    pub fn status(&self) -> StatusCode {
        match self {
            ServerError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ServerError::Unauthorized => StatusCode::UNAUTHORIZED,
            ServerError::Forbidden => StatusCode::FORBIDDEN,
            ServerError::NotFound => StatusCode::NOT_FOUND,
            ServerError::Conflict(_) => StatusCode::CONFLICT,
            ServerError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            ServerError::Auth(code) => auth_status(code),
            ServerError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            ServerError::BadRequest(_) => "bad_request",
            ServerError::Unauthorized => "unauthorized",
            ServerError::Forbidden => "forbidden",
            ServerError::NotFound => "not_found",
            ServerError::Conflict(_) => "conflict",
            ServerError::RateLimited => "rate_limited",
            ServerError::Auth(code) => auth_code_name(code),
            ServerError::Internal(_) => "internal",
        }
    }

    pub fn public_message(&self) -> String {
        match self {
            ServerError::BadRequest(message) | ServerError::Conflict(message) => message.clone(),
            ServerError::Unauthorized => "Sign in to this server again.".to_string(),
            ServerError::Forbidden => "Your role on this server doesn't allow that.".to_string(),
            ServerError::NotFound => "Not found.".to_string(),
            ServerError::RateLimited => "Too many requests. Try again in a minute.".to_string(),
            ServerError::Auth(code) => auth_message(code).to_string(),
            ServerError::Internal(_) => {
                "Something went wrong on the server. Try again later.".to_string()
            }
        }
    }
}

pub fn auth_code_name(code: &AuthErrorCode) -> &'static str {
    match code {
        AuthErrorCode::NotAdmitted => "not_admitted",
        AuthErrorCode::InvalidCode => "invalid_code",
        AuthErrorCode::InvalidSignature => "invalid_signature",
        AuthErrorCode::ExpiredNonce => "expired_nonce",
        AuthErrorCode::InvalidRedirect => "invalid_redirect",
        AuthErrorCode::UnknownProvider => "unknown_provider",
        AuthErrorCode::ProviderFailed => "provider_failed",
        AuthErrorCode::RefreshReused => "refresh_reused",
        AuthErrorCode::Revoked => "revoked",
        AuthErrorCode::SetupCodeInvalid => "setup_code_invalid",
        AuthErrorCode::SignInCancelled => "sign_in_cancelled",
    }
}

fn auth_status(code: &AuthErrorCode) -> StatusCode {
    match code {
        AuthErrorCode::NotAdmitted | AuthErrorCode::SetupCodeInvalid => StatusCode::FORBIDDEN,
        AuthErrorCode::InvalidCode
        | AuthErrorCode::InvalidRedirect
        | AuthErrorCode::ProviderFailed
        | AuthErrorCode::SignInCancelled => StatusCode::BAD_REQUEST,
        AuthErrorCode::InvalidSignature
        | AuthErrorCode::ExpiredNonce
        | AuthErrorCode::RefreshReused
        | AuthErrorCode::Revoked => StatusCode::UNAUTHORIZED,
        AuthErrorCode::UnknownProvider => StatusCode::NOT_FOUND,
    }
}

fn auth_message(code: &AuthErrorCode) -> &'static str {
    match code {
        AuthErrorCode::NotAdmitted => {
            "You're not on this server's list yet. Ask its admin to add you."
        }
        AuthErrorCode::InvalidCode => "The sign-in code is wrong or has expired. Sign in again.",
        AuthErrorCode::InvalidSignature => "This device couldn't prove who it is. Sign in again.",
        AuthErrorCode::ExpiredNonce => "The sign-in check expired. Try again.",
        AuthErrorCode::InvalidRedirect => "That sign-in return address isn't allowed.",
        AuthErrorCode::UnknownProvider => "This server doesn't offer that sign-in option.",
        AuthErrorCode::ProviderFailed => {
            "The sign-in provider didn't finish the sign-in. Try again."
        }
        AuthErrorCode::RefreshReused => {
            "This session was used twice, so the server signed this device out. Sign in again."
        }
        AuthErrorCode::Revoked => "This device was signed out. Sign in again.",
        AuthErrorCode::SetupCodeInvalid => "That setup code is wrong or was already used.",
        AuthErrorCode::SignInCancelled => "Sign-in was cancelled.",
    }
}

impl fmt::Display for ServerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServerError::Internal(detail) => write!(formatter, "internal error: {detail}"),
            other => write!(formatter, "{}: {}", other.code(), other.public_message()),
        }
    }
}

impl std::error::Error for ServerError {}

impl From<rusqlite::Error> for ServerError {
    fn from(error: rusqlite::Error) -> Self {
        ServerError::Internal(format!("database error: {error}"))
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        if let ServerError::Internal(detail) = &self {
            tracing::error!("{detail}");
        }
        let body = ApiError {
            code: self.code().to_string(),
            message: self.public_message(),
        };
        (self.status(), Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const AUTH_CODES: [AuthErrorCode; 11] = [
        AuthErrorCode::NotAdmitted,
        AuthErrorCode::InvalidCode,
        AuthErrorCode::InvalidSignature,
        AuthErrorCode::ExpiredNonce,
        AuthErrorCode::InvalidRedirect,
        AuthErrorCode::UnknownProvider,
        AuthErrorCode::ProviderFailed,
        AuthErrorCode::RefreshReused,
        AuthErrorCode::Revoked,
        AuthErrorCode::SetupCodeInvalid,
        AuthErrorCode::SignInCancelled,
    ];

    #[tokio::test]
    async fn errors_render_as_api_error_json() {
        let cases = [
            (
                ServerError::BadRequest("That cursor is not valid.".to_string()),
                StatusCode::BAD_REQUEST,
                "bad_request",
                "That cursor is not valid.",
            ),
            (
                ServerError::Unauthorized,
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Sign in to this server again.",
            ),
            (
                ServerError::Forbidden,
                StatusCode::FORBIDDEN,
                "forbidden",
                "Your role on this server doesn't allow that.",
            ),
            (
                ServerError::NotFound,
                StatusCode::NOT_FOUND,
                "not_found",
                "Not found.",
            ),
            (
                ServerError::Conflict("Already on the allowlist.".to_string()),
                StatusCode::CONFLICT,
                "conflict",
                "Already on the allowlist.",
            ),
            (
                ServerError::RateLimited,
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many requests. Try again in a minute.",
            ),
            (
                ServerError::Auth(AuthErrorCode::NotAdmitted),
                StatusCode::FORBIDDEN,
                "not_admitted",
                "You're not on this server's list yet. Ask its admin to add you.",
            ),
            (
                ServerError::Internal("disk full under /data".to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "Something went wrong on the server. Try again later.",
            ),
        ];
        for (error, status, code, message) in cases {
            let response = error.into_response();
            assert_eq!(response.status(), status);
            let bytes = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["code"], code);
            assert_eq!(body["message"], message);
        }
    }

    #[test]
    fn every_auth_code_has_a_wire_name_status_and_message() {
        let names: Vec<&str> = AUTH_CODES.iter().map(auth_code_name).collect();
        assert_eq!(
            names,
            [
                "not_admitted",
                "invalid_code",
                "invalid_signature",
                "expired_nonce",
                "invalid_redirect",
                "unknown_provider",
                "provider_failed",
                "refresh_reused",
                "revoked",
                "setup_code_invalid",
                "sign_in_cancelled",
            ]
        );
        for code in AUTH_CODES {
            let error = ServerError::Auth(code);
            assert!(!error.public_message().is_empty());
            assert!(
                [400, 401, 403, 404].contains(&error.status().as_u16()),
                "{}",
                error.code()
            );
        }
    }

    #[test]
    fn database_errors_become_internal_and_hide_their_detail() {
        let error = ServerError::from(rusqlite::Error::QueryReturnedNoRows);
        assert!(matches!(&error, ServerError::Internal(detail) if detail.contains("database")));
        assert_eq!(
            error.public_message(),
            "Something went wrong on the server. Try again later."
        );
    }
}
