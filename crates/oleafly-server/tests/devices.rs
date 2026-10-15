mod claims;

use oleafly_collab_protocol::admin::{AllowlistMatcher, SecurityEventKind};
use oleafly_collab_protocol::auth::{AccountSummary, DeviceSummary, SessionTokens};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{
    allowlist, github_provider, refresh_session, security_event_kinds, sign_in, test_config,
    MockGithub, MockGithubUser, TestDevice, TestServer,
};
use reqwest::StatusCode;

async fn two_people() -> (TestServer, MockGithub, MockGithub) {
    let carol = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "carol".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![("carol@uni.edu".to_owned(), true)],
    }])
    .await;
    let bob = MockGithub::start(vec![MockGithubUser {
        id: 8,
        login: "bob".to_owned(),
        name: "Bob Smith".to_owned(),
        emails: vec![],
    }])
    .await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &carol));
    config.providers.push(github_provider("github2", &bob));
    (TestServer::start(config).await, carol, bob)
}

async fn carol_signs_in(server: &TestServer, device: &TestDevice, first: bool) -> SessionTokens {
    let setup_code = first.then(|| server.setup_code());
    claims::sign_in(server, "github", device, setup_code.as_deref())
        .await
        .expect("carol signs in")
}

async fn get(server: &TestServer, path: &str, token: &str) -> reqwest::Response {
    reqwest::Client::new()
        .get(format!("{}{path}", server.url()))
        .bearer_auth(token)
        .send()
        .await
        .expect("request")
}

async fn delete(server: &TestServer, path: &str, token: &str) -> StatusCode {
    reqwest::Client::new()
        .delete(format!("{}{path}", server.url()))
        .bearer_auth(token)
        .send()
        .await
        .expect("request")
        .status()
}

#[tokio::test]
async fn me_describes_the_signed_in_account() {
    let (server, _carol, _bob) = two_people().await;
    let laptop = TestDevice::generate();
    let tokens = carol_signs_in(&server, &laptop, true).await;
    let me: AccountSummary = get(&server, "/api/v1/me", &tokens.access_token)
        .await
        .json()
        .await
        .expect("me json");
    assert_eq!(me.account_id, tokens.account_id);
    assert_eq!(me.display_name, "Carol Diaz");
    assert_eq!(me.server_role, ServerRole::Admin);
    assert_eq!(me.emails, vec!["carol@uni.edu".to_owned()]);
    assert!(me.logins.iter().any(|login| login.contains("carol")));
}

#[tokio::test]
async fn me_needs_a_bearer_token() {
    let (server, _carol, _bob) = two_people().await;
    let response = reqwest::get(format!("{}/api/v1/me", server.url()))
        .await
        .expect("request");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn devices_lists_my_devices_and_marks_this_one() {
    let (server, _carol, _bob) = two_people().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = carol_signs_in(&server, &laptop, true).await;
    let desktop_tokens = carol_signs_in(&server, &desktop, false).await;
    let listed: Vec<DeviceSummary> = get(&server, "/api/v1/devices", &laptop_tokens.access_token)
        .await
        .json()
        .await
        .expect("devices json");
    assert_eq!(listed.len(), 2);
    let current: Vec<_> = listed.iter().filter(|device| device.current).collect();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].device_id, laptop_tokens.device_id);
    assert!(listed
        .iter()
        .any(|device| device.device_id == desktop_tokens.device_id && !device.current));
    assert!(listed
        .iter()
        .all(|device| device.name == "Test laptop" && device.platform == "macos"));
    assert!(listed.iter().all(|device| device.last_seen_at.is_some()));
}

#[tokio::test]
async fn signing_out_my_other_device_ends_its_session() {
    let (server, _carol, _bob) = two_people().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = carol_signs_in(&server, &laptop, true).await;
    let desktop_tokens = carol_signs_in(&server, &desktop, false).await;
    let path = format!("/api/v1/devices/{}", desktop_tokens.device_id);
    assert_eq!(
        delete(&server, &path, &laptop_tokens.access_token).await,
        StatusCode::NO_CONTENT
    );
    let listed: Vec<DeviceSummary> = get(&server, "/api/v1/devices", &laptop_tokens.access_token)
        .await
        .json()
        .await
        .expect("devices json");
    assert_eq!(listed.len(), 1);
    assert_eq!(
        get(&server, "/api/v1/me", &desktop_tokens.access_token)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let refreshed = refresh_session(
        &server,
        &desktop,
        desktop_tokens.device_id,
        &desktop_tokens.refresh_token,
    )
    .await;
    assert_eq!(refreshed.err().as_deref(), Some("revoked"));
    assert_eq!(
        delete(&server, &path, &laptop_tokens.access_token).await,
        StatusCode::NOT_FOUND
    );
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::DeviceSignedOut)));
}

#[tokio::test]
async fn another_persons_device_is_not_found() {
    let (server, _carol, _bob) = two_people().await;
    let carol_laptop = TestDevice::generate();
    let carol = carol_signs_in(&server, &carol_laptop, true).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github2".to_owned(),
        login: "bob".to_owned(),
    };
    allowlist(&server, &carol.access_token, matcher, ServerRole::Member).await;
    let bob_laptop = TestDevice::generate();
    let bob = sign_in(&server, "github2", &bob_laptop, None)
        .await
        .expect("bob signs in");
    let path = format!("/api/v1/devices/{}", bob.device_id);
    assert_eq!(
        delete(&server, &path, &carol.access_token).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(&server, "/api/v1/me", &bob.access_token).await.status(),
        StatusCode::OK
    );
    assert_eq!(
        delete(&server, "/api/v1/devices/not-a-device", &carol.access_token).await,
        StatusCode::NOT_FOUND
    );
}
