//! OAuth for github.com and gitlab.com: the device flow (a code the user
//! enters in the browser) and GitLab's token refresh.
//!
//! The client ids are public and compiled in. `OLEAFLY_DESKTOP_GITLAB_CLIENT_ID`
//! has no default: without it, GitLab signs in with an access token only.
//! The `DESKTOP_` prefix keeps them apart from `OLEAFLY_GITHUB_CLIENT_ID`,
//! which the collaboration server reads at runtime for another app.
use crate::http::{self, Call, CallBody, ForgeHttp};
use crate::kind::{ForgeKind, GITHUB_COM, GITLAB_COM};
use crate::{ForgeError, ForgeToken};
use std::time::Duration;

pub const GITHUB_CLIENT_ID: &str = match option_env!("OLEAFLY_DESKTOP_GITHUB_CLIENT_ID") {
    Some(id) if !id.is_empty() => id,
    _ => match option_env!("VITE_GITHUB_CLIENT_ID") {
        Some(id) if !id.is_empty() => id,
        _ => "Ov23li4f2jpz7iBljiYT",
    },
};
pub const GITLAB_COM_CLIENT_ID: Option<&str> = match option_env!("OLEAFLY_DESKTOP_GITLAB_CLIENT_ID")
{
    Some(id) if !id.is_empty() => Some(id),
    _ => None,
};
pub const GITHUB_SCOPES: &str = "repo read:user";
pub const GITLAB_SCOPES: &str = "api read_user write_repository";
pub const REFRESH_MARGIN_MS: u64 = 5 * 60 * 1000;
const OAUTH_TIMEOUT: Duration = Duration::from_secs(20);
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

pub fn device_client_id(base: &str) -> Option<(ForgeKind, &'static str)> {
    match base {
        GITHUB_COM => Some((ForgeKind::GitHub, GITHUB_CLIENT_ID)),
        GITLAB_COM => GITLAB_COM_CLIENT_ID.map(|id| (ForgeKind::GitLab, id)),
        _ => None,
    }
}

pub struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

impl std::fmt::Debug for DeviceAuthorization {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceAuthorization")
            .field("device_code", &"[redacted]")
            .field("user_code", &self.user_code)
            .field("verification_uri", &self.verification_uri)
            .field("expires_in", &self.expires_in)
            .field("interval", &self.interval)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct TokenGrant {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
}

impl std::fmt::Debug for TokenGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenGrant")
            .field("access_token", &"[redacted]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[redacted]"),
            )
            .field("expires_in", &self.expires_in)
            .field("scope", &self.scope)
            .finish()
    }
}

impl TokenGrant {
    pub fn into_token(self, now_ms: u64) -> ForgeToken {
        let expires_at = self.expires_in.map(|seconds| {
            i64::try_from((now_ms / 1000).saturating_add(seconds)).unwrap_or(i64::MAX)
        });
        ForgeToken {
            token: self.access_token,
            refresh: self.refresh_token,
            expires_at,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DevicePoll {
    Pending,
    SlowDown { interval: u64 },
    Granted(TokenGrant),
}

fn expiry_ms(expires_at: i64) -> u64 {
    u64::try_from(expires_at).unwrap_or(0).saturating_mul(1000)
}

pub fn needs_refresh(token: &ForgeToken, now_ms: u64) -> bool {
    token.refresh.is_some()
        && token
            .expires_at
            .is_some_and(|at| expiry_ms(at) <= now_ms.saturating_add(REFRESH_MARGIN_MS))
}

pub fn expired(token: &ForgeToken, now_ms: u64) -> bool {
    token.expires_at.is_some_and(|at| expiry_ms(at) <= now_ms)
}

fn endpoint(base: &str, path: &str) -> Result<url::Url, ForgeError> {
    url::Url::parse(&format!("{base}/{path}")).map_err(|_| ForgeError::InvalidBaseUrl {
        input: base.to_string(),
    })
}

fn device_paths(kind: ForgeKind) -> Result<(&'static str, &'static str), ForgeError> {
    match kind {
        ForgeKind::GitHub => Ok(("login/device/code", "login/oauth/access_token")),
        ForgeKind::GitLab => Ok(("oauth/authorize_device", "oauth/token")),
        ForgeKind::Gitea => Err(ForgeError::DeviceFlowUnavailable),
    }
}

/// POST a form and read the JSON body whatever the status: GitHub answers a
/// pending poll with 200, GitLab with 400.
async fn post_form(
    http: &ForgeHttp,
    url: url::Url,
    form: Vec<(&'static str, String)>,
    secrets: &[&str],
) -> Result<serde_json::Value, ForgeError> {
    let response = http
        .send(Call::post(url, None, CallBody::Form(form)).timeout(OAUTH_TIMEOUT))
        .await?;
    let status = response.status();
    let headers = response.headers().clone();
    let body = http::read_limited(response, 64 * 1024).await?;
    match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(value) if value.is_object() => Ok(value),
        _ if !status.is_success() => Err(http::error_for_status(
            status,
            &headers,
            &String::from_utf8_lossy(&body),
            secrets,
            "",
        )),
        _ => Err(ForgeError::InvalidResponse {
            detail: "the sign-in reply was not JSON".into(),
        }),
    }
}

fn text(body: &serde_json::Value, field: &str) -> Option<String> {
    body.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn error_code(body: &serde_json::Value) -> Option<String> {
    text(body, "error")
}

fn sign_in_error(code: &str) -> ForgeError {
    match code {
        "expired_token" => ForgeError::SignInExpired,
        "access_denied" => ForgeError::SignInDenied,
        other => ForgeError::SignInFailed {
            detail: http::scrub(other, &[]),
        },
    }
}

fn web_address(value: Option<String>) -> Option<String> {
    let value = value?;
    let parsed = url::Url::parse(&value).ok()?;
    matches!(parsed.scheme(), "https" | "http").then_some(value)
}

pub async fn device_start(
    http: &ForgeHttp,
    kind: ForgeKind,
    base: &str,
    client_id: &str,
) -> Result<DeviceAuthorization, ForgeError> {
    let (start_path, _) = device_paths(kind)?;
    let scope = match kind {
        ForgeKind::GitHub => GITHUB_SCOPES,
        _ => GITLAB_SCOPES,
    };
    let body = post_form(
        http,
        endpoint(base, start_path)?,
        vec![
            ("client_id", client_id.to_string()),
            ("scope", scope.to_string()),
        ],
        &[],
    )
    .await?;
    if let Some(code) = error_code(&body) {
        return Err(sign_in_error(&code));
    }
    let missing = || ForgeError::InvalidResponse {
        detail: "the sign-in reply had no code".into(),
    };
    let device_code = text(&body, "device_code").ok_or_else(missing)?;
    let user_code = text(&body, "user_code").ok_or_else(missing)?;
    let verification_uri = web_address(text(&body, "verification_uri")).ok_or_else(missing)?;
    Ok(DeviceAuthorization {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete: web_address(text(&body, "verification_uri_complete")),
        expires_in: body
            .get("expires_in")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(900),
        interval: body
            .get("interval")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(5),
    })
}

pub fn poll_from_body(body: &serde_json::Value) -> Result<DevicePoll, ForgeError> {
    if let Some(access_token) = text(body, "access_token") {
        return Ok(DevicePoll::Granted(grant_from_body(body, access_token)));
    }
    match error_code(body).as_deref() {
        Some("authorization_pending") | None => Ok(DevicePoll::Pending),
        Some("slow_down") => Ok(DevicePoll::SlowDown {
            interval: body
                .get("interval")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(5),
        }),
        Some(code) => Err(sign_in_error(code)),
    }
}

fn grant_from_body(body: &serde_json::Value, access_token: String) -> TokenGrant {
    TokenGrant {
        access_token,
        refresh_token: text(body, "refresh_token"),
        expires_in: body.get("expires_in").and_then(serde_json::Value::as_u64),
        scope: text(body, "scope"),
    }
}

pub async fn device_poll(
    http: &ForgeHttp,
    kind: ForgeKind,
    base: &str,
    client_id: &str,
    device_code: &str,
) -> Result<DevicePoll, ForgeError> {
    let (_, token_path) = device_paths(kind)?;
    let body = post_form(
        http,
        endpoint(base, token_path)?,
        vec![
            ("client_id", client_id.to_string()),
            ("device_code", device_code.to_string()),
            ("grant_type", DEVICE_GRANT.to_string()),
        ],
        &[device_code],
    )
    .await?;
    poll_from_body(&body)
}

pub async fn refresh_gitlab(
    http: &ForgeHttp,
    base: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenGrant, ForgeError> {
    let body = post_form(
        http,
        endpoint(base, "oauth/token")?,
        vec![
            ("client_id", client_id.to_string()),
            ("refresh_token", refresh_token.to_string()),
            ("grant_type", "refresh_token".to_string()),
        ],
        &[refresh_token],
    )
    .await?;
    if let Some(access_token) = text(&body, "access_token") {
        return Ok(grant_from_body(&body, access_token));
    }
    match error_code(&body).as_deref() {
        Some("invalid_grant" | "invalid_client" | "unauthorized_client") => {
            Err(ForgeError::Unauthorized)
        }
        Some(code) => Err(sign_in_error(code)),
        None => Err(ForgeError::InvalidResponse {
            detail: "the refresh reply had no token".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kind::AuthMethod;
    use crate::store::{ForgeAccount, ForgeStore};
    use crate::test_support::{MockResponse, MockServer};

    #[test]
    fn device_poll_bodies_map_to_states() {
        let granted = poll_from_body(&serde_json::json!({
            "access_token": "gho_abc", "refresh_token": "rt", "expires_in": 7200, "scope": "repo"
        }))
        .unwrap();
        let DevicePoll::Granted(grant) = granted else {
            panic!("an access token is a grant");
        };
        assert_eq!(grant.access_token, "gho_abc");
        assert_eq!(grant.refresh_token.as_deref(), Some("rt"));
        assert_eq!(grant.expires_in, Some(7200));
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "authorization_pending" })).unwrap(),
            DevicePoll::Pending
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "slow_down", "interval": 9 })).unwrap(),
            DevicePoll::SlowDown { interval: 9 }
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "slow_down" })).unwrap(),
            DevicePoll::SlowDown { interval: 5 }
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "expired_token" })),
            Err(ForgeError::SignInExpired)
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "access_denied" })),
            Err(ForgeError::SignInDenied)
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({ "error": "unsupported_grant_type" })),
            Err(ForgeError::SignInFailed {
                detail: "unsupported_grant_type".into()
            })
        );
        assert_eq!(
            poll_from_body(&serde_json::json!({})).unwrap(),
            DevicePoll::Pending
        );
    }

    #[test]
    fn grants_and_device_codes_never_print_their_secrets() {
        let grant = TokenGrant {
            access_token: "gho_visible".into(),
            refresh_token: Some("rt_visible".into()),
            expires_in: None,
            scope: None,
        };
        let debug = format!("{grant:?}");
        assert!(
            !debug.contains("gho_visible") && !debug.contains("rt_visible"),
            "{debug}"
        );
        let start = DeviceAuthorization {
            device_code: "device-visible".into(),
            user_code: "ABCD-1234".into(),
            verification_uri: "https://github.com/login/device".into(),
            verification_uri_complete: None,
            expires_in: 900,
            interval: 5,
        };
        assert!(!format!("{start:?}").contains("device-visible"));
    }

    #[test]
    fn token_expiry_is_stored_in_seconds_and_compared_in_milliseconds() {
        let now_ms = 1_760_000_000_123;
        let token = TokenGrant {
            access_token: "glpat-abc".into(),
            refresh_token: Some("rt-abc".into()),
            expires_in: Some(7200),
            scope: None,
        }
        .into_token(now_ms);
        assert_eq!(token.expires_at, Some(1_760_000_000 + 7200));
        assert!(!needs_refresh(&token, now_ms));
        assert!(!needs_refresh(
            &token,
            now_ms + 7200 * 1000 - REFRESH_MARGIN_MS - 1_000
        ));
        assert!(needs_refresh(
            &token,
            now_ms + 7200 * 1000 - REFRESH_MARGIN_MS + 1_000
        ));
        assert!(!expired(&token, now_ms + 7200 * 1000 - 1_000));
        assert!(expired(&token, now_ms + 7200 * 1000));
        let no_refresh = ForgeToken {
            refresh: None,
            ..token.clone()
        };
        assert!(
            !needs_refresh(&no_refresh, u64::MAX),
            "only refreshable tokens refresh"
        );
        let negative = ForgeToken {
            expires_at: Some(-5),
            ..token
        };
        assert!(expired(&negative, 0));
    }

    #[tokio::test]
    async fn gitlab_device_polls_read_400_error_bodies() {
        let server = MockServer::start(vec![MockResponse::json(
            400,
            r#"{"error":"authorization_pending","error_description":"pending"}"#,
        )]);
        let http = ForgeHttp::new(None).unwrap();
        let poll = device_poll(
            &http,
            ForgeKind::GitLab,
            &server.url(),
            "client",
            "device-123",
        )
        .await
        .unwrap();
        assert_eq!(poll, DevicePoll::Pending);
        let request = &server.requests()[0];
        assert_eq!(request.path, "/oauth/token");
        assert!(request.body.contains("device_code=device-123"));
        assert!(request
            .body
            .contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
    }

    #[tokio::test]
    async fn github_device_start_asks_for_repo_and_read_user() {
        let server = MockServer::start(vec![MockResponse::json(
            200,
            r#"{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":899,"interval":5}"#,
        )]);
        let http = ForgeHttp::new(None).unwrap();
        let start = device_start(&http, ForgeKind::GitHub, &server.url(), "client-1")
            .await
            .unwrap();
        assert_eq!(start.user_code, "ABCD-1234");
        assert_eq!(start.expires_in, 899);
        let request = &server.requests()[0];
        assert_eq!(request.path, "/login/device/code");
        assert!(
            request.body.contains("client_id=client-1"),
            "{}",
            request.body
        );
        assert!(
            request.body.contains("scope=repo+read%3Auser"),
            "{}",
            request.body
        );
        assert_eq!(request.header("authorization"), None);
    }

    #[tokio::test]
    async fn a_verification_address_that_is_not_a_web_page_is_refused() {
        let server = MockServer::start(vec![MockResponse::json(
            200,
            r#"{"device_code":"dc","user_code":"ABCD","verification_uri":"file:///etc/passwd"}"#,
        )]);
        let http = ForgeHttp::new(None).unwrap();
        assert!(matches!(
            device_start(&http, ForgeKind::GitLab, &server.url(), "client").await,
            Err(ForgeError::InvalidResponse { .. })
        ));
    }

    #[test]
    fn the_gitlab_client_id_is_absent_unless_built_in() {
        assert!(GITLAB_COM_CLIENT_ID.is_none_or(|id| !id.is_empty()));
        assert!(!GITHUB_CLIENT_ID.is_empty());
    }

    #[test]
    fn device_flow_is_offered_only_on_github_com_and_gitlab_com() {
        assert_eq!(device_client_id("https://git.example.org"), None);
        assert_eq!(device_client_id(crate::kind::CODEBERG), None);
        assert_eq!(
            device_client_id(GITHUB_COM),
            Some((ForgeKind::GitHub, GITHUB_CLIENT_ID))
        );
        assert_eq!(
            device_client_id(GITLAB_COM).is_some(),
            GITLAB_COM_CLIENT_ID.is_some()
        );
    }

    fn gitlab_oauth_account(base: &str) -> ForgeAccount {
        ForgeAccount {
            base: base.to_string(),
            kind: ForgeKind::GitLab,
            flavor: None,
            login: "octo".into(),
            name: None,
            avatar_url: None,
            ca_file: None,
            auth: AuthMethod::OAuth,
            added_at: 0,
        }
    }

    fn expiring(now_ms: u64, seconds: i64) -> ForgeToken {
        ForgeToken {
            token: "old-access-token".into(),
            refresh: Some("old-refresh-token".into()),
            expires_at: Some((now_ms / 1000) as i64 + seconds),
        }
    }

    const FRESH: &str = r#"{"access_token":"new-access-token","refresh_token":"new-refresh-token","expires_in":7200,"token_type":"Bearer"}"#;

    #[tokio::test]
    async fn an_expiring_gitlab_token_is_refreshed_and_both_tokens_rotate() {
        let server = MockServer::start(vec![MockResponse::json(200, FRESH)]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 60))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let token = store
            .usable_token_with(&http, &base, now_ms, Some("client"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(token.token, "new-access-token");
        let stored = store.token(&base).unwrap().unwrap();
        assert_eq!(stored.refresh.as_deref(), Some("new-refresh-token"));
        assert_eq!(stored.expires_at, Some((now_ms / 1000) as i64 + 7200));
        let request = &server.requests()[0];
        assert_eq!(request.path, "/oauth/token");
        assert!(request.body.contains("grant_type=refresh_token"));
        assert!(request.body.contains("refresh_token=old-refresh-token"));
        assert_eq!(request.header("authorization"), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_refreshes_call_the_server_once() {
        let server = MockServer::start(vec![MockResponse::json(200, FRESH)]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 60))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let tasks: Vec<_> = (0..4)
            .map(|_| {
                let store = store.clone();
                let http = http.clone();
                let base = base.clone();
                tokio::spawn(async move {
                    store
                        .usable_token_with(&http, &base, now_ms, Some("client"))
                        .await
                })
            })
            .collect();
        for task in tasks {
            let token = task.await.unwrap().unwrap().unwrap();
            assert_eq!(token.token, "new-access-token");
        }
        assert_eq!(server.requests().len(), 1, "one refresh for four callers");
    }

    async fn request_arrived(server: &MockServer) {
        for _ in 0..500 {
            if !server.requests().is_empty() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("the refresh request never arrived");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_refresh_that_ends_after_a_sign_out_does_not_bring_the_account_back() {
        let server = MockServer::start(vec![
            MockResponse::json(200, FRESH).delayed(std::time::Duration::from_millis(300))
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 60))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let refresh = tokio::spawn({
            let (store, http, base) = (store.clone(), http.clone(), base.clone());
            async move {
                store
                    .usable_token_with(&http, &base, now_ms, Some("client"))
                    .await
            }
        });
        request_arrived(&server).await;
        assert!(store.remove(&base).unwrap(), "signed out mid-refresh");
        assert_eq!(refresh.await.unwrap().unwrap(), None);
        assert_eq!(store.token(&base).unwrap(), None);
        assert!(
            store.orphan_bases().unwrap().is_empty(),
            "no token is left without its account"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_refresh_that_ends_after_a_new_sign_in_keeps_the_new_sign_in() {
        let server = MockServer::start(vec![
            MockResponse::json(200, FRESH).delayed(std::time::Duration::from_millis(300))
        ]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 60))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let refresh = tokio::spawn({
            let (store, http, base) = (store.clone(), http.clone(), base.clone());
            async move {
                store
                    .usable_token_with(&http, &base, now_ms, Some("client"))
                    .await
            }
        });
        request_arrived(&server).await;
        let signed_in_again = ForgeToken {
            token: "glpat-signed-in-again".into(),
            refresh: None,
            expires_at: None,
        };
        store
            .save(gitlab_oauth_account(&base), signed_in_again.clone())
            .unwrap();
        assert_eq!(
            refresh.await.unwrap().unwrap(),
            Some(signed_in_again.clone())
        );
        assert_eq!(store.token(&base).unwrap(), Some(signed_in_again));
    }

    #[tokio::test]
    async fn a_rejected_refresh_reports_signed_out_and_keeps_the_stored_token() {
        let server = MockServer::start(vec![MockResponse::json(
            400,
            r#"{"error":"invalid_grant","error_description":"The provided authorization grant is invalid"}"#,
        )]);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        let saved = expiring(now_ms, 60);
        store
            .save(gitlab_oauth_account(&base), saved.clone())
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        assert_eq!(
            store
                .usable_token_with(&http, &base, now_ms, Some("client"))
                .await,
            Err(ForgeError::Unauthorized)
        );
        assert_eq!(store.token(&base).unwrap(), Some(saved));
    }

    #[tokio::test]
    async fn an_unreachable_refresh_keeps_using_a_token_that_still_works() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 60))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let token = store
            .usable_token_with(&http, &base, now_ms, Some("client"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(token.token, "old-access-token");
    }

    #[tokio::test]
    async fn tokens_far_from_expiry_are_used_as_they_are() {
        let server = MockServer::start(Vec::new());
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeStore::new(dir.path());
        let base = server.url();
        let now_ms = crate::now_ms();
        store
            .save(gitlab_oauth_account(&base), expiring(now_ms, 3600))
            .unwrap();
        let http = ForgeHttp::new(None).unwrap();
        let token = store
            .usable_token_with(&http, &base, now_ms, Some("client"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(token.token, "old-access-token");
        assert!(server.requests().is_empty());
        let without_client = store
            .usable_token_with(&http, &base, now_ms + 3600 * 1000, None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(without_client.token, "old-access-token");
        assert!(server.requests().is_empty(), "no client id, no refresh");
    }
}
