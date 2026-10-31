use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgeError {
    InvalidBaseUrl { input: String },
    HttpsRequired,
    InvalidToken,
    TokenRejected,
    InvalidRepository,
    InvalidRepositoryName,
    UnknownServer,
    DeviceFlowUnavailable,
    SignInExpired,
    SignInDenied,
    SignInFailed { detail: String },
    Unauthorized,
    Forbidden { scopes: &'static str },
    SsoRequired,
    MissingScopes { scopes: &'static str },
    NotFound,
    Conflict,
    RateLimited { retry_after_secs: Option<u64> },
    RepositoryEmpty,
    TooLarge { limit_mb: u64 },
    Tls { detail: String },
    Unreachable { detail: String },
    RedirectRefused { target: String },
    InvalidResponse { detail: String },
    Server { status: u16, detail: String },
    CaFile { detail: String },
    Store { detail: String },
}

impl ForgeError {
    pub fn code(&self) -> &'static str {
        match self {
            ForgeError::InvalidBaseUrl { .. } => "git.forge_invalid_server",
            ForgeError::HttpsRequired => "git.forge_https_required",
            ForgeError::InvalidToken => "git.forge_token_invalid",
            ForgeError::TokenRejected => "git.forge_token_rejected",
            ForgeError::InvalidRepository => "git.forge_invalid_repository",
            ForgeError::InvalidRepositoryName => "git.forge_invalid_repository_name",
            ForgeError::UnknownServer => "git.forge_unknown_server",
            ForgeError::DeviceFlowUnavailable => "git.device_flow_unavailable",
            ForgeError::SignInExpired => "git.sign_in_expired",
            ForgeError::SignInDenied => "git.sign_in_cancelled",
            ForgeError::SignInFailed { .. } => "git.sign_in_failed",
            ForgeError::Unauthorized => "git.forge_signed_out",
            ForgeError::Forbidden { .. } => "git.forge_forbidden",
            ForgeError::SsoRequired => "git.forge_sso_required",
            ForgeError::MissingScopes { .. } => "git.forge_missing_scopes",
            ForgeError::NotFound => "git.forge_not_found",
            ForgeError::Conflict => "git.forge_repository_exists",
            ForgeError::RateLimited { .. } => "git.forge_rate_limited",
            ForgeError::RepositoryEmpty => "git.repository_empty",
            ForgeError::TooLarge { .. } => "git.archive_too_large",
            ForgeError::Tls { .. } => "git.tls_failed",
            ForgeError::Unreachable { .. } => "git.host_unreachable",
            ForgeError::RedirectRefused { .. } => "git.forge_redirect_refused",
            ForgeError::InvalidResponse { .. } => "git.forge_bad_response",
            ForgeError::Server { .. } => "git.forge_server_error",
            ForgeError::CaFile { .. } => "git.forge_ca_file_invalid",
            ForgeError::Store { .. } => "git.forge_store",
        }
    }

    pub fn is_auth(&self) -> bool {
        matches!(
            self,
            ForgeError::Unauthorized
                | ForgeError::Forbidden { .. }
                | ForgeError::SsoRequired
                | ForgeError::MissingScopes { .. }
                | ForgeError::InvalidToken
                | ForgeError::TokenRejected
        )
    }

    pub fn is_network(&self) -> bool {
        matches!(
            self,
            ForgeError::Unreachable { .. }
                | ForgeError::Tls { .. }
                | ForgeError::RateLimited { .. }
        )
    }
}

impl fmt::Display for ForgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ForgeError::InvalidBaseUrl { input } => {
                write!(f, "{input} isn't a server address Oleafly can use.")
            }
            ForgeError::HttpsRequired => f.write_str(
                "Use an https:// address. Plain http only works for servers on your own network.",
            ),
            ForgeError::InvalidToken => {
                f.write_str("This doesn't look like an access token. Paste the whole token.")
            }
            ForgeError::TokenRejected => f.write_str(
                "The server didn't accept this token. Check that you copied the whole token and that it hasn't expired.",
            ),
            ForgeError::InvalidRepository => {
                f.write_str("That isn't a repository path Oleafly can use.")
            }
            ForgeError::InvalidRepositoryName => f.write_str(
                "Use only letters, digits, dots, dashes and underscores in the repository name.",
            ),
            ForgeError::UnknownServer => f.write_str(
                "Oleafly couldn't tell what kind of server this is. Choose the server type.",
            ),
            ForgeError::DeviceFlowUnavailable => f.write_str(
                "Browser sign-in isn't available for this server in this build. Use an access token instead.",
            ),
            ForgeError::SignInExpired => f.write_str("The sign-in code expired. Try again."),
            ForgeError::SignInDenied => f.write_str("Sign-in was cancelled in the browser."),
            ForgeError::SignInFailed { detail } => write!(f, "Sign-in failed ({detail})."),
            ForgeError::Unauthorized => {
                f.write_str("The sign-in expired or was revoked. Sign in again.")
            }
            ForgeError::Forbidden { scopes } => write!(
                f,
                "The server refused this. The token may be missing the {scopes} scopes."
            ),
            ForgeError::SsoRequired => f.write_str(
                "The organization requires single sign-on. Authorize this sign-in for the organization on the server, then try again.",
            ),
            ForgeError::MissingScopes { scopes } => write!(
                f,
                "This token can't push. Create a token with the {scopes} scopes."
            ),
            ForgeError::NotFound => f.write_str("The server couldn't find that repository."),
            ForgeError::Conflict => {
                f.write_str("A repository with this name already exists on the server.")
            }
            ForgeError::RateLimited { retry_after_secs } => match retry_after_secs {
                Some(seconds) => write!(
                    f,
                    "The server is limiting requests right now. Try again in {seconds} seconds."
                ),
                None => f.write_str(
                    "The server is limiting requests right now. Try again in a minute.",
                ),
            },
            ForgeError::RepositoryEmpty => f.write_str(
                "This repository has no commits yet, so there is nothing to import.",
            ),
            ForgeError::TooLarge { limit_mb } => write!(
                f,
                "The repository files are larger than {limit_mb} MB, so Oleafly can't import them."
            ),
            ForgeError::Tls { detail } => write!(
                f,
                "Oleafly couldn't verify the server's certificate ({detail})."
            ),
            ForgeError::Unreachable { detail } => {
                write!(f, "Oleafly couldn't reach the server ({detail}).")
            }
            ForgeError::RedirectRefused { target } => write!(
                f,
                "The server tried to send Oleafly to {target}, so Oleafly stopped to keep the sign-in safe."
            ),
            ForgeError::InvalidResponse { detail } => {
                write!(f, "The server sent a reply Oleafly couldn't read ({detail}).")
            }
            ForgeError::Server { status, detail } if detail.is_empty() => {
                write!(f, "The server returned an error ({status}).")
            }
            ForgeError::Server { status, detail } => {
                write!(f, "The server returned an error ({status}: {detail}).")
            }
            ForgeError::CaFile { detail } => write!(
                f,
                "Oleafly couldn't read a certificate from this file ({detail})."
            ),
            ForgeError::Store { detail } => write!(
                f,
                "Oleafly couldn't read or save the Git hosting accounts ({detail})."
            ),
        }
    }
}

impl std::error::Error for ForgeError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_error() -> Vec<ForgeError> {
        vec![
            ForgeError::InvalidBaseUrl { input: "x".into() },
            ForgeError::HttpsRequired,
            ForgeError::InvalidToken,
            ForgeError::TokenRejected,
            ForgeError::InvalidRepository,
            ForgeError::InvalidRepositoryName,
            ForgeError::UnknownServer,
            ForgeError::DeviceFlowUnavailable,
            ForgeError::SignInExpired,
            ForgeError::SignInDenied,
            ForgeError::SignInFailed { detail: "x".into() },
            ForgeError::Unauthorized,
            ForgeError::Forbidden { scopes: "api" },
            ForgeError::SsoRequired,
            ForgeError::MissingScopes { scopes: "api" },
            ForgeError::NotFound,
            ForgeError::Conflict,
            ForgeError::RateLimited {
                retry_after_secs: None,
            },
            ForgeError::RepositoryEmpty,
            ForgeError::TooLarge { limit_mb: 256 },
            ForgeError::Tls { detail: "x".into() },
            ForgeError::Unreachable { detail: "x".into() },
            ForgeError::RedirectRefused { target: "x".into() },
            ForgeError::InvalidResponse { detail: "x".into() },
            ForgeError::Server {
                status: 500,
                detail: "x".into(),
            },
            ForgeError::CaFile { detail: "x".into() },
            ForgeError::Store { detail: "x".into() },
        ]
    }

    #[test]
    fn every_error_code_exists_in_the_english_catalog() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/i18n/locales/en/errors.json")).unwrap();
        for error in every_error() {
            let code = error.code();
            let found = code
                .split('.')
                .try_fold(&catalog, |node, part| node.get(part))
                .and_then(serde_json::Value::as_str);
            assert!(found.is_some(), "{code} is missing from en/errors.json");
        }
    }

    #[test]
    fn every_error_reads_as_a_sentence() {
        for error in every_error() {
            let text = error.to_string();
            assert!(text.ends_with('.') || text.ends_with(')'), "{text}");
            assert!(
                !text.contains('\u{2014}') && !text.contains('\u{2013}'),
                "{text}"
            );
        }
    }

    #[test]
    fn auth_and_network_errors_are_grouped_for_exit_codes() {
        assert!(ForgeError::Unauthorized.is_auth());
        assert!(ForgeError::MissingScopes { scopes: "api" }.is_auth());
        assert!(ForgeError::SsoRequired.is_auth());
        assert!(ForgeError::Unreachable {
            detail: String::new()
        }
        .is_network());
        assert!(ForgeError::RateLimited {
            retry_after_secs: Some(3)
        }
        .is_network());
        assert!(!ForgeError::NotFound.is_auth() && !ForgeError::NotFound.is_network());
    }
}
