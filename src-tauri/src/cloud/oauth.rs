use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::sync::{oneshot, Notify};

pub(crate) const LOOPBACK_PORTS: [u16; 3] = [53171, 53172, 53173];
const AUTHORIZE_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
const API_BASE: &str = "https://api.dropboxapi.com/2";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub(crate) fn dropbox_app_key() -> &'static str {
    match option_env!("OLEAFLY_DROPBOX_APP_KEY") {
        Some(key) => key,
        None if cfg!(debug_assertions) => "4ybx26gsxmea24s",
        None => "x97gi50cqmrr4cm",
    }
}

#[derive(Debug)]
pub(crate) enum OAuthError {
    Cancelled,
    Timeout,
    CodeInvalid,
    Revoked,
    NoPort,
    Network(String),
    Server(String),
}

impl OAuthError {
    pub(crate) fn key(&self) -> &'static str {
        match self {
            Self::Cancelled => "sign_in_cancelled",
            Self::Timeout => "sign_in_timeout",
            Self::CodeInvalid => "code_invalid",
            Self::Revoked => "revoked",
            Self::NoPort => "no_port",
            Self::Network(_) | Self::Server(_) => "network",
        }
    }
}

impl fmt::Display for OAuthError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("sign-in was cancelled"),
            Self::Timeout => formatter.write_str("sign-in timed out"),
            Self::CodeInvalid => formatter.write_str("sign-in code was refused"),
            Self::Revoked => formatter.write_str("dropbox access was revoked"),
            Self::NoPort => formatter.write_str("no loopback port is available"),
            Self::Network(message) | Self::Server(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for OAuthError {}

type OAuthResult<T> = std::result::Result<T, OAuthError>;

pub(crate) struct PkceFlow {
    verifier: String,
    pub(crate) challenge: String,
    pub(crate) state: String,
}

impl fmt::Debug for PkceFlow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PkceFlow")
            .field("verifier", &"[redacted]")
            .field("challenge", &self.challenge)
            .field("state", &self.state)
            .finish()
    }
}

fn random_base64url(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

impl PkceFlow {
    pub(crate) fn generate() -> Self {
        let verifier = random_base64url(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
            state: random_base64url(32),
        }
    }

    pub(crate) fn verifier(&self) -> &str {
        &self.verifier
    }
}

pub(crate) fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}/oauth/dropbox")
}

pub(crate) fn authorize_url(
    app_key: &str,
    flow: &PkceFlow,
    redirect: Option<&str>,
    locale: Option<&str>,
) -> String {
    let mut url = reqwest::Url::parse(AUTHORIZE_URL).expect("static authorize URL");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", app_key)
            .append_pair("response_type", "code")
            .append_pair("token_access_type", "offline")
            .append_pair("code_challenge", &flow.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &flow.state);
        if let Some(redirect) = redirect {
            query.append_pair("redirect_uri", redirect);
        }
        if let Some(locale) = locale.filter(|locale| !locale.is_empty()) {
            query.append_pair("locale", locale);
        }
    }
    url.to_string()
}

#[derive(Clone)]
pub(crate) struct LoopbackPages {
    pub(crate) success: String,
    pub(crate) failure: String,
}

impl Default for LoopbackPages {
    fn default() -> Self {
        Self {
            success: "You're connected. You can close this tab and go back to Oleafly.".into(),
            failure: "Sign-in did not finish. You can close this tab and go back to Oleafly."
                .into(),
        }
    }
}

struct LoopbackShared {
    expected_state: String,
    sender: Mutex<Option<oneshot::Sender<OAuthResult<String>>>>,
    shutdown: Arc<Notify>,
    pages: LoopbackPages,
}

pub(crate) struct LoopbackListener {
    pub(crate) port: u16,
    receiver: oneshot::Receiver<OAuthResult<String>>,
    shutdown: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}

impl LoopbackListener {
    pub(crate) fn shutdown_handle(&self) -> Arc<Notify> {
        Arc::clone(&self.shutdown)
    }

    pub(crate) async fn wait(mut self, timeout: std::time::Duration) -> OAuthResult<String> {
        let result = match tokio::time::timeout(timeout, &mut self.receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(OAuthError::Cancelled),
            Err(_) => Err(OAuthError::Timeout),
        };
        self.shutdown.notify_one();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), &mut self.task).await;
        self.task.abort();
        result
    }

    pub(crate) fn cancel(self) {
        self.shutdown.notify_one();
        self.task.abort();
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = |byte: u8| match byte {
                    b'0'..=b'9' => Some(byte - b'0'),
                    b'a'..=b'f' => Some(byte - b'a' + 10),
                    b'A'..=b'F' => Some(byte - b'A' + 10),
                    _ => None,
                };
                match (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        decoded.push((high << 4) | low);
                        index += 3;
                    }
                    _ => {
                        decoded.push(b'%');
                        index += 1;
                    }
                }
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn query_value(query: Option<&str>, key: &str) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (percent_decode(name) == key).then(|| percent_decode(value))
    })
}

fn page(message: &str) -> String {
    let message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>Oleafly</title></head><body><p>{message}</p></body></html>")
}

async fn loopback_handler(
    axum::extract::State(shared): axum::extract::State<Arc<LoopbackShared>>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<SocketAddr>,
    uri: axum::http::Uri,
) -> axum::response::Response {
    use axum::response::IntoResponse as _;
    if !peer.ip().is_loopback() {
        return (axum::http::StatusCode::BAD_REQUEST, "bad request").into_response();
    }
    let query = uri.query();
    if query_value(query, "state").as_deref() != Some(shared.expected_state.as_str()) {
        return (axum::http::StatusCode::BAD_REQUEST, "bad request").into_response();
    }
    let (result, message) =
        if let Some(code) = query_value(query, "code").filter(|code| !code.is_empty()) {
            (Ok(code), shared.pages.success.clone())
        } else if query_value(query, "error").is_some() {
            (Err(OAuthError::Cancelled), shared.pages.failure.clone())
        } else {
            return (axum::http::StatusCode::BAD_REQUEST, "bad request").into_response();
        };
    let sender = shared
        .sender
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(result);
    }
    shared.shutdown.notify_one();
    axum::response::Html(page(&message)).into_response()
}

pub(crate) async fn bind_loopback(
    expected_state: String,
    pages: LoopbackPages,
) -> OAuthResult<LoopbackListener> {
    let mut listener = None;
    for port in LOOPBACK_PORTS {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(bound) => {
                listener = Some((port, bound));
                break;
            }
            Err(_) => continue,
        }
    }
    let Some((port, listener)) = listener else {
        return Err(OAuthError::NoPort);
    };
    let (sender, receiver) = oneshot::channel();
    let shutdown = Arc::new(Notify::new());
    let shared = Arc::new(LoopbackShared {
        expected_state,
        sender: Mutex::new(Some(sender)),
        shutdown: Arc::clone(&shutdown),
        pages,
    });
    let router = axum::Router::new()
        .route("/oauth/dropbox", axum::routing::get(loopback_handler))
        .with_state(shared);
    let signal = Arc::clone(&shutdown);
    let task = tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            signal.notified().await;
        })
        .await;
    });
    Ok(LoopbackListener {
        port,
        receiver,
        shutdown,
        task,
    })
}

pub(crate) struct TokenSet {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in: u64,
    pub(crate) account_id: Option<String>,
}

impl fmt::Debug for TokenSet {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TokenSet")
            .field("access_token", &"[redacted]")
            .field("has_refresh_token", &self.refresh_token.is_some())
            .field("expires_in", &self.expires_in)
            .field("has_account_id", &self.account_id.is_some())
            .finish()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Account {
    pub(crate) account_id: String,
    pub(crate) email: String,
    pub(crate) display_name: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct AccountResponse {
    account_id: String,
    email: String,
    name: AccountName,
}

#[derive(Deserialize)]
struct AccountName {
    display_name: String,
}

pub(crate) struct DropboxAuthClient {
    http: reqwest::Client,
    token_url: String,
    api_base: String,
}

const AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

impl DropboxAuthClient {
    pub(crate) fn new() -> Self {
        Self {
            http: super::store::http().clone(),
            token_url: TOKEN_URL.into(),
            api_base: API_BASE.into(),
        }
    }

    async fn read_capped(&self, mut response: reqwest::Response) -> OAuthResult<Vec<u8>> {
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| OAuthError::Network(error.to_string()))?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(OAuthError::Server("dropbox response is too large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn token(&self, form: Vec<(&str, &str)>, refresh: bool) -> OAuthResult<TokenSet> {
        let response = self
            .http
            .post(&self.token_url)
            .timeout(AUTH_TIMEOUT)
            .form(&form)
            .send()
            .await
            .map_err(|error| OAuthError::Network(error.to_string()))?;
        let status = response.status();
        let bytes = self.read_capped(response).await?;
        if !status.is_success() {
            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
            let error = value
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            return Err(match error {
                "invalid_grant" if refresh => OAuthError::Revoked,
                "invalid_grant" => OAuthError::CodeInvalid,
                "access_denied" => OAuthError::Cancelled,
                _ => OAuthError::Server(format!("dropbox sign-in failed with status {status}")),
            });
        }
        let parsed: TokenResponse = serde_json::from_slice(&bytes).map_err(|_| {
            OAuthError::Server("dropbox sign-in returned an unreadable reply".into())
        })?;
        if parsed.access_token.is_empty() {
            return Err(OAuthError::Server(
                "dropbox sign-in returned an unreadable reply".into(),
            ));
        }
        Ok(TokenSet {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            expires_in: parsed.expires_in,
            account_id: parsed.account_id,
        })
    }

    pub(crate) async fn exchange_code(
        &self,
        app_key: &str,
        code: &str,
        verifier: &str,
        redirect: Option<&str>,
    ) -> OAuthResult<TokenSet> {
        let mut form = vec![
            ("code", code),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
            ("client_id", app_key),
        ];
        if let Some(redirect) = redirect {
            form.push(("redirect_uri", redirect));
        }
        self.token(form, false).await
    }

    pub(crate) async fn refresh(
        &self,
        app_key: &str,
        refresh_token: &str,
    ) -> OAuthResult<TokenSet> {
        self.token(
            vec![
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", app_key),
            ],
            true,
        )
        .await
    }

    pub(crate) async fn revoke(&self, access_token: &str) -> OAuthResult<()> {
        let response = self
            .http
            .post(format!("{}/auth/token/revoke", self.api_base))
            .timeout(AUTH_TIMEOUT)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| OAuthError::Network(error.to_string()))?;
        let status = response.status();
        let _ = self.read_capped(response).await?;
        if status.is_success() || status.as_u16() == 401 {
            return Ok(());
        }
        Err(OAuthError::Server(format!(
            "dropbox revoke failed with status {status}"
        )))
    }

    pub(crate) async fn space_usage(&self, access_token: &str) -> OAuthResult<(u64, u64)> {
        let response = self
            .http
            .post(format!("{}/users/get_space_usage", self.api_base))
            .timeout(AUTH_TIMEOUT)
            .bearer_auth(access_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body("null")
            .send()
            .await
            .map_err(|error| OAuthError::Network(error.to_string()))?;
        let status = response.status();
        let bytes = self.read_capped(response).await?;
        if status.as_u16() == 401 {
            return Err(OAuthError::Revoked);
        }
        if !status.is_success() {
            return Err(OAuthError::Server(format!(
                "dropbox space lookup failed with status {status}"
            )));
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            OAuthError::Server("dropbox space lookup returned an unreadable reply".into())
        })?;
        let used = value
            .get("used")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        let allocated = value
            .get("allocation")
            .and_then(|allocation| allocation.get("allocated"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        Ok((used, allocated))
    }

    pub(crate) async fn current_account(&self, access_token: &str) -> OAuthResult<Account> {
        let response = self
            .http
            .post(format!("{}/users/get_current_account", self.api_base))
            .timeout(AUTH_TIMEOUT)
            .bearer_auth(access_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body("null")
            .send()
            .await
            .map_err(|error| OAuthError::Network(error.to_string()))?;
        let status = response.status();
        let bytes = self.read_capped(response).await?;
        if status.as_u16() == 401 {
            return Err(OAuthError::Revoked);
        }
        if !status.is_success() {
            return Err(OAuthError::Server(format!(
                "dropbox account lookup failed with status {status}"
            )));
        }
        let parsed: AccountResponse = serde_json::from_slice(&bytes).map_err(|_| {
            OAuthError::Server("dropbox account lookup returned an unreadable reply".into())
        })?;
        Ok(Account {
            account_id: parsed.account_id,
            email: parsed.email,
            display_name: parsed.name.display_name,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_url, bind_loopback, query_value, redirect_uri, DropboxAuthClient, LoopbackPages,
        OAuthError, PkceFlow,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn pkce_challenge_is_the_s256_of_an_86_character_verifier() {
        let flow = PkceFlow::generate();
        assert_eq!(flow.verifier().len(), 86);
        assert_eq!(flow.state.len(), 43);
        assert_eq!(flow.challenge.len(), 43);
        assert_eq!(
            flow.challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(flow.verifier().as_bytes()))
        );
        assert!(!format!("{flow:?}").contains(flow.verifier()));
        assert_ne!(PkceFlow::generate().verifier(), flow.verifier());
    }

    #[test]
    fn app_key_is_the_dev_key_in_debug_builds() {
        assert_eq!(super::dropbox_app_key(), "4ybx26gsxmea24s");
    }

    #[test]
    fn authorize_urls_carry_pkce_and_the_paste_variant_omits_the_redirect() {
        let flow = PkceFlow::generate();
        let url = authorize_url("key123", &flow, Some(&redirect_uri(53171)), Some("de"));
        let parsed = reqwest::Url::parse(&url).unwrap();
        let pairs: std::collections::HashMap<String, String> =
            parsed.query_pairs().into_owned().collect();
        assert_eq!(pairs["client_id"], "key123");
        assert_eq!(pairs["response_type"], "code");
        assert_eq!(pairs["token_access_type"], "offline");
        assert_eq!(pairs["code_challenge"], flow.challenge);
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["state"], flow.state);
        assert_eq!(
            pairs["redirect_uri"],
            "http://127.0.0.1:53171/oauth/dropbox"
        );
        assert_eq!(pairs["locale"], "de");
        assert!(!url.contains("client_secret"));
        let paste = authorize_url("key123", &flow, None, None);
        assert!(!paste.contains("redirect_uri"));
    }

    #[tokio::test]
    async fn loopback_accepts_only_the_matching_state_and_then_the_code() {
        let flow = PkceFlow::generate();
        let listener = bind_loopback(flow.state.clone(), LoopbackPages::default())
            .await
            .unwrap();
        let port = listener.port;
        let http = reqwest::Client::new();
        let wrong = http
            .get(format!(
                "http://127.0.0.1:{port}/oauth/dropbox?code=x&state=wrong"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status().as_u16(), 400);
        let waiting = tokio::spawn(listener.wait(Duration::from_secs(5)));
        let right = http
            .get(format!(
                "http://127.0.0.1:{port}/oauth/dropbox?code=code-123&state={}",
                flow.state
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(right.status().as_u16(), 200);
        assert!(right.text().await.unwrap().contains("You're connected"));
        assert_eq!(waiting.await.unwrap().unwrap(), "code-123");
    }

    #[tokio::test]
    async fn loopback_reports_refusals_and_timeouts() {
        let flow = PkceFlow::generate();
        let listener = bind_loopback(flow.state.clone(), LoopbackPages::default())
            .await
            .unwrap();
        let port = listener.port;
        let waiting = tokio::spawn(listener.wait(Duration::from_secs(5)));
        reqwest::Client::new()
            .get(format!(
                "http://127.0.0.1:{port}/oauth/dropbox?error=access_denied&state={}",
                flow.state
            ))
            .send()
            .await
            .unwrap();
        assert!(matches!(waiting.await.unwrap(), Err(OAuthError::Cancelled)));
        let listener = bind_loopback("state".into(), LoopbackPages::default())
            .await
            .unwrap();
        assert!(matches!(
            listener.wait(Duration::from_millis(50)).await,
            Err(OAuthError::Timeout)
        ));
    }

    struct FakeDropbox {
        last_body: Arc<Mutex<String>>,
        last_auth: Arc<Mutex<Option<String>>>,
        base: String,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for FakeDropbox {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn fake_dropbox() -> FakeDropbox {
        #[derive(Clone)]
        struct Shared {
            body: Arc<Mutex<String>>,
            auth: Arc<Mutex<Option<String>>>,
        }
        async fn token(
            axum::extract::State(shared): axum::extract::State<Shared>,
            body: String,
        ) -> axum::response::Response {
            use axum::response::IntoResponse as _;
            *shared.body.lock().unwrap() = body.clone();
            if body.contains("client_secret") {
                return (axum::http::StatusCode::BAD_REQUEST, "secret not allowed").into_response();
            }
            if query_value(Some(&body), "code").as_deref() == Some("bad")
                || query_value(Some(&body), "refresh_token").as_deref() == Some("revoked")
            {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({"error": "invalid_grant"})),
                )
                    .into_response();
            }
            let refresh = if query_value(Some(&body), "grant_type").as_deref()
                == Some("authorization_code")
            {
                serde_json::json!({"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 14400, "account_id": "dbid:AAH4"})
            } else {
                serde_json::json!({"access_token": "at-2", "expires_in": 14400, "account_id": "dbid:AAH4"})
            };
            axum::Json(refresh).into_response()
        }
        async fn revoke(
            axum::extract::State(shared): axum::extract::State<Shared>,
            headers: axum::http::HeaderMap,
        ) -> axum::http::StatusCode {
            *shared.auth.lock().unwrap() = headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            axum::http::StatusCode::OK
        }
        async fn account() -> axum::Json<serde_json::Value> {
            axum::Json(serde_json::json!({
                "account_id": "dbid:AAH4",
                "email": "ada@example.org",
                "name": {"display_name": "Ada"}
            }))
        }
        let shared = Shared {
            body: Arc::new(Mutex::new(String::new())),
            auth: Arc::new(Mutex::new(None)),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new()
            .route("/token", axum::routing::post(token))
            .route("/2/auth/token/revoke", axum::routing::post(revoke))
            .route("/2/users/get_current_account", axum::routing::post(account))
            .with_state(shared.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        FakeDropbox {
            last_body: shared.body,
            last_auth: shared.auth,
            base: format!("http://{address}"),
            task,
        }
    }

    fn client(fake: &FakeDropbox) -> DropboxAuthClient {
        DropboxAuthClient {
            http: reqwest::Client::new(),
            token_url: format!("{}/token", fake.base),
            api_base: format!("{}/2", fake.base),
        }
    }

    #[tokio::test]
    async fn exchange_and_refresh_never_send_a_secret_and_map_invalid_grant_by_flow() {
        let fake = fake_dropbox().await;
        let client = client(&fake);
        let tokens = client
            .exchange_code(
                "key123",
                "code-123",
                "verifier-1",
                Some("http://127.0.0.1:53171/oauth/dropbox"),
            )
            .await
            .unwrap();
        assert_eq!(tokens.access_token, "at-1");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-1"));
        assert!(!format!("{tokens:?}").contains("at-1"));
        let body = fake.last_body.lock().unwrap().clone();
        assert_eq!(
            query_value(Some(&body), "code_verifier").as_deref(),
            Some("verifier-1")
        );
        assert_eq!(
            query_value(Some(&body), "client_id").as_deref(),
            Some("key123")
        );
        let refreshed = client.refresh("key123", "rt-1").await.unwrap();
        assert_eq!(refreshed.access_token, "at-2");
        assert!(refreshed.refresh_token.is_none());
        assert!(matches!(
            client
                .exchange_code("key123", "bad", "verifier-1", None)
                .await,
            Err(OAuthError::CodeInvalid)
        ));
        assert!(matches!(
            client.refresh("key123", "revoked").await,
            Err(OAuthError::Revoked)
        ));
    }

    #[tokio::test]
    async fn revoke_and_account_lookup_use_the_bearer_token() {
        let fake = fake_dropbox().await;
        let client = client(&fake);
        client.revoke("at-1").await.unwrap();
        assert_eq!(
            fake.last_auth.lock().unwrap().as_deref(),
            Some("Bearer at-1")
        );
        let account = client.current_account("at-1").await.unwrap();
        assert_eq!(account.account_id, "dbid:AAH4");
        assert_eq!(account.email, "ada@example.org");
        assert_eq!(account.display_name, "Ada");
    }
}
