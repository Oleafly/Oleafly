use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, SessionTokens, TokenRequest,
};
use oleafly_server::clock::Clock;
use oleafly_server::members;
use oleafly_server::test_support::{
    api_error_code, app_callback, challenge_nonce, follow_to_app, github_provider,
    no_redirect_client, redeem, refresh_session, security_event_kinds, sign_in, test_config,
    MockGithub, MockGithubUser, SignInAttempt, TestDevice, TestServer,
};
use oleafly_server::tokens::resolve_access_token;
use reqwest::StatusCode;

async fn server() -> (TestServer, MockGithub) {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "carol".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![("carol@uni.edu".to_owned(), true)],
    }])
    .await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    (TestServer::start(config).await, github)
}

async fn setup_code_if_needed(server: &TestServer) -> Option<String> {
    let admins = server
        .state()
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .expect("admins");
    (admins == 0).then(|| server.setup_code())
}

async fn code_for(server: &TestServer, device: &TestDevice) -> (String, String) {
    let setup_code = setup_code_if_needed(server).await;
    let attempt = SignInAttempt::new(server, "github", device, setup_code.as_deref());
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone())
        .await
        .expect("redirects");
    (
        app_callback(&landing, &attempt.state).expect("code"),
        attempt.verifier,
    )
}

async fn session(server: &TestServer, device: &TestDevice) -> SessionTokens {
    let setup_code = setup_code_if_needed(server).await;
    sign_in(server, "github", device, setup_code.as_deref())
        .await
        .expect("sign in")
}

async fn access_is_live(server: &TestServer, access: &str) -> bool {
    let access = access.to_owned();
    let now = server.clock().now_ms();
    server
        .state()
        .db
        .call(move |conn| resolve_access_token(conn, &access, now))
        .await
        .expect("resolve")
        .is_some()
}

fn token_request(
    server: &TestServer,
    device: &TestDevice,
    code: &str,
    verifier: &str,
    nonce: &str,
    purpose: ChallengePurpose,
) -> TokenRequest {
    let message = challenge_message(purpose, server.state().server_id, nonce);
    TokenRequest {
        code: code.to_owned(),
        code_verifier: verifier.to_owned(),
        device_public_key: device.public_key_b64().to_owned(),
        nonce: nonce.to_owned(),
        signature: device.sign_b64(&message),
    }
}

async fn post_token(server: &TestServer, request: &TokenRequest) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{}/auth/token", server.url()))
        .json(request)
        .send()
        .await
        .expect("token request")
}

#[tokio::test]
async fn a_code_becomes_a_device_session() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    let tokens = redeem(&server, &device, &code, &verifier)
        .await
        .expect("tokens");
    assert!(!tokens.refresh_token.is_empty());
    assert!(tokens.access_expires_at > server.clock().now_ms());
    assert!(access_is_live(&server, &tokens.access_token).await);
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::DeviceAdded)));
}

#[tokio::test]
async fn a_code_works_once() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    redeem(&server, &device, &code, &verifier)
        .await
        .expect("first redeem");
    assert_eq!(
        redeem(&server, &device, &code, &verifier)
            .await
            .err()
            .as_deref(),
        Some("invalid_code")
    );
}

#[tokio::test]
async fn a_code_expires_after_two_minutes() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    server.clock().advance(120_001);
    assert_eq!(
        redeem(&server, &device, &code, &verifier)
            .await
            .err()
            .as_deref(),
        Some("invalid_code")
    );
}

#[tokio::test]
async fn a_wrong_verifier_is_refused_and_the_code_survives() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    let wrong = "a-verifier-that-does-not-match-the-challenge-at-all";
    assert_eq!(
        redeem(&server, &device, &code, wrong)
            .await
            .err()
            .as_deref(),
        Some("invalid_code")
    );
    assert!(redeem(&server, &device, &code, &verifier).await.is_ok());
}

#[tokio::test]
async fn only_the_device_that_started_can_redeem() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let other = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    assert_eq!(
        redeem(&server, &other, &code, &verifier)
            .await
            .err()
            .as_deref(),
        Some("invalid_signature")
    );
}

#[tokio::test]
async fn the_signature_must_cover_the_token_purpose() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    let nonce = challenge_nonce(&server).await;
    let request = token_request(
        &server,
        &device,
        &code,
        &verifier,
        &nonce,
        ChallengePurpose::Refresh,
    );
    let response = post_token(&server, &request).await;
    assert!(response.status().is_client_error());
    assert_eq!(api_error_code(response).await, "invalid_signature");
}

#[tokio::test]
async fn a_nonce_is_single_use() {
    let (server, _github) = server().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let (laptop_code, laptop_verifier) = code_for(&server, &laptop).await;
    let nonce = challenge_nonce(&server).await;
    let first = token_request(
        &server,
        &laptop,
        &laptop_code,
        &laptop_verifier,
        &nonce,
        ChallengePurpose::Token,
    );
    assert_eq!(post_token(&server, &first).await.status(), StatusCode::OK);
    let (desktop_code, desktop_verifier) = code_for(&server, &desktop).await;
    let replay = token_request(
        &server,
        &desktop,
        &desktop_code,
        &desktop_verifier,
        &nonce,
        ChallengePurpose::Token,
    );
    assert_eq!(
        api_error_code(post_token(&server, &replay).await).await,
        "expired_nonce"
    );
}

#[tokio::test]
async fn a_nonce_expires_after_two_minutes() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let (code, verifier) = code_for(&server, &device).await;
    let nonce = challenge_nonce(&server).await;
    server.clock().advance(120_001);
    let request = token_request(
        &server,
        &device,
        &code,
        &verifier,
        &nonce,
        ChallengePurpose::Token,
    );
    assert_eq!(
        api_error_code(post_token(&server, &request).await).await,
        "expired_nonce"
    );
}

#[tokio::test]
async fn a_refresh_rotates_both_tokens() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let first = session(&server, &device).await;
    let rotated = refresh_session(&server, &device, first.device_id, &first.refresh_token)
        .await
        .expect("rotate");
    assert_ne!(rotated.refresh_token, first.refresh_token);
    assert_ne!(rotated.access_token, first.access_token);
    assert_eq!(rotated.device_id, first.device_id);
    assert_eq!(rotated.account_id, first.account_id);
}

#[tokio::test]
async fn a_retried_refresh_within_sixty_seconds_gets_the_same_pair() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let first = session(&server, &device).await;
    let rotated = refresh_session(&server, &device, first.device_id, &first.refresh_token)
        .await
        .expect("rotate");
    server.clock().advance(59_000);
    let retried = refresh_session(&server, &device, first.device_id, &first.refresh_token)
        .await
        .expect("retry within the grace window");
    assert_eq!(retried, rotated);
    assert!(access_is_live(&server, &retried.access_token).await);
    let next = refresh_session(&server, &device, first.device_id, &rotated.refresh_token)
        .await
        .expect("the new refresh token still rotates");
    assert_ne!(next.refresh_token, rotated.refresh_token);
}

#[tokio::test]
async fn a_refresh_reused_after_sixty_seconds_signs_the_device_out() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let first = session(&server, &device).await;
    let rotated = refresh_session(&server, &device, first.device_id, &first.refresh_token)
        .await
        .expect("rotate");
    server.clock().advance(60_001);
    let reused = refresh_session(&server, &device, first.device_id, &first.refresh_token).await;
    assert_eq!(reused.err().as_deref(), Some("refresh_reused"));
    let after = refresh_session(&server, &device, first.device_id, &rotated.refresh_token).await;
    assert_eq!(after.err().as_deref(), Some("revoked"));
    assert!(!access_is_live(&server, &rotated.access_token).await);
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::RefreshReuseDetected)));
}

#[tokio::test]
async fn replaying_an_old_token_after_the_new_one_was_used_is_reuse() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let first = session(&server, &device).await;
    let rotated = refresh_session(&server, &device, first.device_id, &first.refresh_token)
        .await
        .expect("rotate");
    refresh_session(&server, &device, first.device_id, &rotated.refresh_token)
        .await
        .expect("rotate again");
    let replay = refresh_session(&server, &device, first.device_id, &first.refresh_token).await;
    assert_eq!(replay.err().as_deref(), Some("refresh_reused"));
}

#[tokio::test]
async fn a_refresh_needs_the_device_key() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let other = TestDevice::generate();
    let first = session(&server, &device).await;
    let stolen = refresh_session(&server, &other, first.device_id, &first.refresh_token).await;
    assert_eq!(stolen.err().as_deref(), Some("invalid_signature"));
}

#[tokio::test]
async fn a_refresh_token_only_works_for_its_own_device() {
    let (server, _github) = server().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = session(&server, &laptop).await;
    let desktop_tokens = session(&server, &desktop).await;
    let crossed = refresh_session(
        &server,
        &desktop,
        desktop_tokens.device_id,
        &laptop_tokens.refresh_token,
    )
    .await;
    assert_eq!(crossed.err().as_deref(), Some("revoked"));
}

#[tokio::test]
async fn signing_out_ends_the_session_and_the_device_can_return() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let tokens = session(&server, &device).await;
    let response = reqwest::Client::new()
        .post(format!("{}/auth/sign-out", server.url()))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("sign out");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(!access_is_live(&server, &tokens.access_token).await);
    let refreshed =
        refresh_session(&server, &device, tokens.device_id, &tokens.refresh_token).await;
    assert_eq!(refreshed.err().as_deref(), Some("revoked"));
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::DeviceSignedOut)));
}

#[tokio::test]
async fn a_signed_out_device_is_reactivated_with_the_same_id() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let tokens = session(&server, &device).await;
    server
        .state()
        .revoke_device(tokens.device_id)
        .await
        .expect("revoke");
    let again = session(&server, &device).await;
    assert_eq!(again.device_id, tokens.device_id);
    assert_eq!(again.account_id, tokens.account_id);
    assert!(access_is_live(&server, &again.access_token).await);
    let added = security_event_kinds(&server)
        .await
        .iter()
        .filter(|kind| matches!(kind, SecurityEventKind::DeviceAdded))
        .count();
    assert_eq!(added, 2);
    let live_again = session(&server, &device).await;
    assert_eq!(live_again.device_id, tokens.device_id);
    let added_after_live_sign_in = security_event_kinds(&server)
        .await
        .iter()
        .filter(|kind| matches!(kind, SecurityEventKind::DeviceAdded))
        .count();
    assert_eq!(added_after_live_sign_in, 2);
}
