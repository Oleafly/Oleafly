use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{header, Request};
use oleafly_collab_protocol::admin::{AllowlistMatcher, NewAllowlistEntry, SecurityEventKind};
use oleafly_collab_protocol::auth::{
    challenge_message, ApiError, ChallengePurpose, ChallengeResponse, RefreshRequest,
    SessionTokens, TokenRequest,
};
use oleafly_collab_protocol::crypto::{b64url_encode, pkce_s256};
use oleafly_collab_protocol::ids::DeviceId;
use oleafly_collab_protocol::roles::ServerRole;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::Serialize;
use tokio::task::JoinHandle;
use url::Url;

use crate::clock::{Clock, ManualClock, SystemClock};
use crate::config::ServerConfig;
use crate::security_log;
use crate::state::AppState;
use crate::test_support::{test_app_with, TestApp, TEST_SETUP_CODE};
use crate::tokens::random_token;

pub const TEST_REDIRECT_URI: &str = "http://127.0.0.1:9/callback";

pub struct TestServer {
    app: TestApp,
    addr: SocketAddr,
    setup_code: String,
    task: JoinHandle<()>,
}

impl TestServer {
    pub async fn start(mut config: ServerConfig) -> TestServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the test server");
        let addr = listener.local_addr().expect("test server address");
        config.public_url = Url::parse(&format!("http://{addr}/")).expect("test server url");
        config.bind = addr;
        let setup_code = config
            .setup_code
            .clone()
            .unwrap_or_else(|| TEST_SETUP_CODE.to_owned());
        config.setup_code = Some(setup_code.clone());
        let app = test_app_with(config).await;
        let real = SystemClock.now_ms();
        let current = app.clock.now_ms();
        if real > current {
            app.clock.advance(real - current);
        }
        let service = app
            .router
            .clone()
            .into_make_service_with_connect_info::<SocketAddr>();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, service).await;
        });
        TestServer {
            app,
            addr,
            setup_code,
            task,
        }
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn setup_code(&self) -> String {
        self.setup_code.clone()
    }

    pub fn state(&self) -> &AppState {
        &self.app.state
    }

    pub fn app(&self) -> &TestApp {
        &self.app
    }

    pub fn clock(&self) -> Arc<ManualClock> {
        Arc::clone(&self.app.clock)
    }

    pub fn socket_request(&self, access_token: &str) -> Request<()> {
        socket_request(&self.url(), Some(access_token))
    }
}

pub fn socket_request(server_url: &str, access_token: Option<&str>) -> Request<()> {
    let url = format!("{}/ws", server_url.replacen("http://", "ws://", 1));
    let host = Url::parse(&url)
        .ok()
        .and_then(|parsed| {
            let host = parsed.host_str()?.to_owned();
            Some(match parsed.port() {
                Some(port) => format!("{host}:{port}"),
                None => host,
            })
        })
        .expect("the socket address has a host");
    let mut key = [0u8; 16];
    SystemRandom::new()
        .fill(&mut key)
        .expect("the operating system random number generator is available");
    let key = b64url_encode(&key).replace('-', "+").replace('_', "/") + "==";
    let mut request = Request::builder()
        .method("GET")
        .uri(&url)
        .header(header::HOST, host)
        .header(header::CONNECTION, "Upgrade")
        .header(header::UPGRADE, "websocket")
        .header(header::SEC_WEBSOCKET_VERSION, "13")
        .header(header::SEC_WEBSOCKET_KEY, key);
    if let Some(token) = access_token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(()).expect("a valid socket request")
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub struct TestDevice {
    key: Ed25519KeyPair,
    public_key: String,
}

impl TestDevice {
    pub fn generate() -> TestDevice {
        let pkcs8 =
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).expect("generate a device key");
        let key = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("load the device key");
        let public_key = b64url_encode(key.public_key().as_ref());
        TestDevice { key, public_key }
    }

    pub fn public_key_b64(&self) -> &str {
        &self.public_key
    }

    pub fn sign_b64(&self, message: &[u8]) -> String {
        b64url_encode(self.key.sign(message).as_ref())
    }
}

pub struct SignInAttempt {
    pub state: String,
    pub verifier: String,
    pub start_url: Url,
}

impl SignInAttempt {
    pub fn new(
        server: &TestServer,
        provider: &str,
        device: &TestDevice,
        setup_code: Option<&str>,
    ) -> SignInAttempt {
        let state = random_token();
        let verifier = random_token();
        let mut start_url = Url::parse(&format!("{}/auth/start", server.url())).expect("start url");
        start_url
            .query_pairs_mut()
            .append_pair("provider", provider)
            .append_pair("redirect_uri", TEST_REDIRECT_URI)
            .append_pair("state", &state)
            .append_pair("code_challenge", &pkce_s256(&verifier))
            .append_pair("device_public_key", device.public_key_b64())
            .append_pair("device_name", "Test laptop")
            .append_pair("platform", "macos");
        if let Some(code) = setup_code {
            start_url.query_pairs_mut().append_pair("setup_code", code);
        }
        SignInAttempt {
            state,
            verifier,
            start_url,
        }
    }
}

pub fn no_redirect_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client")
}

pub async fn follow_to_app(client: &reqwest::Client, start: Url) -> Result<Url, String> {
    let mut next = start;
    for _ in 0..10 {
        let response = client
            .get(next.clone())
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_redirection() {
            return Err(format!("{next} answered {}", response.status()));
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("{next} redirected without a location"))?;
        let target = next.join(location).map_err(|error| error.to_string())?;
        if target.as_str().starts_with(TEST_REDIRECT_URI) {
            return Ok(target);
        }
        next = target;
    }
    Err("too many redirects".to_owned())
}

pub fn app_callback(landing: &Url, expected_state: &str) -> Result<String, String> {
    let pairs: HashMap<String, String> = landing.query_pairs().into_owned().collect();
    if pairs.get("state").map(String::as_str) != Some(expected_state) {
        return Err("state_mismatch".to_owned());
    }
    if let Some(error) = pairs.get("error") {
        return Err(error.clone());
    }
    pairs
        .get("code")
        .cloned()
        .ok_or_else(|| "missing_code".to_owned())
}

pub async fn api_error_code(response: reqwest::Response) -> String {
    let status = response.status();
    response
        .json::<ApiError>()
        .await
        .map(|error| error.code)
        .unwrap_or_else(|_| status.to_string())
}

pub async fn allowlist(
    server: &TestServer,
    admin_token: &str,
    matcher: AllowlistMatcher,
    role: ServerRole,
) {
    let response = reqwest::Client::new()
        .post(format!("{}/api/v1/admin/allowlist", server.url()))
        .bearer_auth(admin_token)
        .json(&NewAllowlistEntry { matcher, role })
        .send()
        .await
        .expect("allowlist request");
    assert!(
        response.status().is_success(),
        "adding to the allowlist answered {}",
        response.status()
    );
}

pub async fn security_event_kinds(server: &TestServer) -> Vec<SecurityEventKind> {
    server
        .state()
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("security log")
        .items
        .into_iter()
        .map(|event| event.kind)
        .collect()
}

pub async fn challenge_nonce(server: &TestServer) -> String {
    let reply: ChallengeResponse = reqwest::Client::new()
        .post(format!("{}/auth/challenge", server.url()))
        .send()
        .await
        .expect("challenge request")
        .json()
        .await
        .expect("challenge reply");
    reply.nonce
}

async fn post_for_tokens<T: Serialize>(
    server: &TestServer,
    path: &str,
    body: &T,
) -> Result<SessionTokens, String> {
    let response = reqwest::Client::new()
        .post(format!("{}{path}", server.url()))
        .json(body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        response.json().await.map_err(|error| error.to_string())
    } else {
        Err(api_error_code(response).await)
    }
}

pub async fn redeem(
    server: &TestServer,
    device: &TestDevice,
    code: &str,
    verifier: &str,
) -> Result<SessionTokens, String> {
    let nonce = challenge_nonce(server).await;
    let message = challenge_message(ChallengePurpose::Token, server.state().server_id, &nonce);
    let request = TokenRequest {
        code: code.to_owned(),
        code_verifier: verifier.to_owned(),
        device_public_key: device.public_key_b64().to_owned(),
        signature: device.sign_b64(&message),
        nonce,
    };
    post_for_tokens(server, "/auth/token", &request).await
}

pub async fn refresh_session(
    server: &TestServer,
    device: &TestDevice,
    device_id: DeviceId,
    refresh_token: &str,
) -> Result<SessionTokens, String> {
    let nonce = challenge_nonce(server).await;
    let message = challenge_message(ChallengePurpose::Refresh, server.state().server_id, &nonce);
    let request = RefreshRequest {
        refresh_token: refresh_token.to_owned(),
        device_id,
        signature: device.sign_b64(&message),
        nonce,
    };
    post_for_tokens(server, "/auth/refresh", &request).await
}

pub async fn sign_in(
    server: &TestServer,
    provider: &str,
    device: &TestDevice,
    setup_code: Option<&str>,
) -> Result<SessionTokens, String> {
    let attempt = SignInAttempt::new(server, provider, device, setup_code);
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone()).await?;
    let code = app_callback(&landing, &attempt.state)?;
    redeem(server, device, &code, &attempt.verifier).await
}
