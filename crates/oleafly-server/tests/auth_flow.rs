mod claims;

use oleafly_collab_protocol::admin::{AllowlistMatcher, SecurityEventKind};
use oleafly_collab_protocol::capabilities::CapabilityManifest;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::db;
use oleafly_server::members;
use oleafly_server::test_support::{
    allowlist, app_callback, follow_to_app, github_provider, no_redirect_client, oidc_provider,
    redeem, security_event_kinds, seed_member, test_config, MockGithub, MockGithubUser, MockOidc,
    MockOidcUser, SignInAttempt, TestDevice, TestServer, TEST_REDIRECT_URI, TEST_SETUP_CODE,
};
use reqwest::StatusCode;
use serde_json::json;
use url::Url;

fn carol() -> MockGithubUser {
    MockGithubUser {
        id: 7,
        login: "Carol-K".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![("carol@uni.edu".to_owned(), true)],
    }
}

async fn server_for(user: MockGithubUser) -> (TestServer, MockGithub) {
    let github = MockGithub::start(vec![user]).await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    (TestServer::start(config).await, github)
}

async fn attempt(
    server: &TestServer,
    provider: &str,
    setup_code: Option<&str>,
) -> Result<String, String> {
    let device = TestDevice::generate();
    let attempt = claims::attempt(server, provider, &device, setup_code).await?;
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone()).await?;
    app_callback(&landing, &attempt.state)
}

async fn admins(server: &TestServer) -> u32 {
    server
        .state()
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .expect("count admins")
}

async fn location(client: &reqwest::Client, url: Url) -> Url {
    let response = client.get(url.clone()).send().await.expect("request");
    assert!(
        response.status().is_redirection(),
        "{url} answered {}",
        response.status()
    );
    let location = response.headers()[reqwest::header::LOCATION]
        .to_str()
        .expect("location")
        .to_owned();
    url.join(&location).expect("redirect target")
}

fn replacing(url: &Url, changes: &[(&str, &str)]) -> Url {
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    let mut changed = url.clone();
    changed
        .query_pairs_mut()
        .clear()
        .extend_pairs(pairs.iter().map(|(key, value)| {
            let new = changes
                .iter()
                .find(|(name, _)| name == key)
                .map_or(value.as_str(), |(_, new)| new);
            (key.as_str(), new)
        }));
    changed
}

#[tokio::test]
async fn a_device_name_and_system_are_cleaned_before_they_are_stored() {
    let (server, _github) = server_for(carol()).await;
    let blank = SignInAttempt::new(&server, "github", &TestDevice::generate(), None);
    let refused = no_redirect_client()
        .get(replacing(
            &blank.start_url,
            &[("device_name", "\u{200b}\r\n\u{202e}")],
        ))
        .send()
        .await
        .expect("start");
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    let device = TestDevice::generate();
    let attempt = claims::attempt(&server, "github", &device, Some(&server.setup_code()))
        .await
        .expect("a setup claim");
    let start = replacing(
        &attempt.start_url,
        &[
            (
                "device_name",
                "Carol's\r\n2026-10-14 INFO laptop\u{202e}\u{200b}",
            ),
            ("platform", "linux\u{2028}"),
        ],
    );
    let landing = follow_to_app(&no_redirect_client(), start)
        .await
        .expect("back to the app");
    let code = app_callback(&landing, &attempt.state).expect("a sign-in code");
    let tokens = redeem(&server, &device, &code, &attempt.verifier)
        .await
        .expect("tokens");
    let id = tokens.device_id.to_string();
    let stored: (String, String) = server
        .state()
        .db
        .call(move |conn| {
            Ok(conn.query_row(
                "SELECT name, platform FROM devices WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .await
        .expect("the device");
    assert_eq!(
        stored,
        (
            "Carol's 2026-10-14 INFO laptop".to_owned(),
            "linux".to_owned()
        )
    );
}

fn with_redirect(url: &Url, redirect: &str) -> Url {
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    let mut changed = url.clone();
    changed
        .query_pairs_mut()
        .clear()
        .extend_pairs(pairs.iter().map(|(key, value)| {
            (
                key.as_str(),
                if key == "redirect_uri" {
                    redirect
                } else {
                    value.as_str()
                },
            )
        }));
    changed
}

#[tokio::test]
async fn the_setup_code_makes_the_first_admin() {
    let (server, _github) = server_for(carol()).await;
    assert_eq!(admins(&server).await, 0);
    assert_eq!(server.setup_code(), TEST_SETUP_CODE);
    let code = attempt(&server, "github", Some(&server.setup_code()))
        .await
        .expect("sign-in code");
    assert!(!code.is_empty());
    assert_eq!(admins(&server).await, 1);
    let stored = server
        .state()
        .db
        .call(|conn| db::meta_get(conn, db::SETUP_CODE_HASH_KEY))
        .await
        .expect("setup hash");
    assert_eq!(stored, None);
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::SetupCompleted)));
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::SignIn)));
    let manifest: CapabilityManifest =
        reqwest::get(format!("{}/.well-known/oleafly-server", server.url()))
            .await
            .expect("manifest")
            .json()
            .await
            .expect("manifest json");
    assert!(!manifest.needs_setup);
}

#[tokio::test]
async fn the_setup_code_works_once() {
    let (server, _github) = server_for(carol()).await;
    let code = server.setup_code();
    attempt(&server, "github", Some(&code))
        .await
        .expect("first sign-in");
    assert_eq!(
        attempt(&server, "github", Some(&code)).await,
        Err("setup_code_invalid".to_owned())
    );
}

#[tokio::test]
async fn a_wrong_setup_code_never_reaches_the_provider() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    assert_eq!(
        claims::attempt(&server, "github", &device, Some("WRONG-CODE"))
            .await
            .err()
            .as_deref(),
        Some("setup_code_invalid")
    );
    let in_the_address = SignInAttempt::new(&server, "github", &device, Some(&server.setup_code()));
    let landing = location(&no_redirect_client(), in_the_address.start_url.clone()).await;
    assert!(landing.as_str().starts_with(TEST_REDIRECT_URI));
    assert_eq!(
        app_callback(&landing, &in_the_address.state),
        Err("setup_code_invalid".to_owned())
    );
    assert_eq!(admins(&server).await, 0);
}

#[tokio::test]
async fn someone_nobody_added_is_not_admitted() {
    let (server, _github) = server_for(carol()).await;
    assert_eq!(
        attempt(&server, "github", None).await,
        Err("not_admitted".to_owned())
    );
    let kinds = security_event_kinds(&server).await;
    assert!(kinds
        .iter()
        .any(|kind| matches!(kind, SecurityEventKind::SignInRefused)));
}

#[tokio::test]
async fn someone_turned_away_hears_which_account_they_used() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone())
        .await
        .expect("back at the app");
    let query: std::collections::HashMap<String, String> =
        landing.query_pairs().into_owned().collect();
    assert_eq!(query.get("error").map(String::as_str), Some("not_admitted"));
    assert_eq!(query.get("account").map(String::as_str), Some("@Carol-K"));
}

#[tokio::test]
async fn a_finished_sign_in_never_names_the_account_in_the_address() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = claims::attempt(&server, "github", &device, Some(&server.setup_code()))
        .await
        .expect("a setup claim");
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone())
        .await
        .expect("back at the app");
    assert!(landing.query_pairs().any(|(key, _)| key == "code"));
    assert!(!landing.query_pairs().any(|(key, _)| key == "account"));
}

async fn browser_page(url: String) -> (StatusCode, String, String) {
    let response = no_redirect_client().get(url).send().await.expect("request");
    let status = response.status();
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    (status, kind, response.text().await.expect("body"))
}

#[tokio::test]
async fn a_used_or_unknown_sign_in_return_shows_a_page_not_an_error_object() {
    let (server, _github) = server_for(carol()).await;
    let (status, kind, body) = browser_page(format!(
        "{}/auth/callback/github?state=never-issued&code=abc",
        server.url()
    ))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(kind.starts_with("text/html"), "{kind}");
    assert!(body.contains("<div class=\"brand\">"), "{body}");
    assert!(body.contains("This sign-in already finished or expired"));
    assert!(!body.contains("\"code\":"));
}

#[tokio::test]
async fn a_sign_in_start_that_cannot_return_to_oleafly_shows_a_page() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    let mut start = attempt.start_url.clone();
    let pairs: Vec<(String, String)> = start
        .query_pairs()
        .map(|(key, value)| {
            let value = if key == "redirect_uri" {
                "https://elsewhere.example/callback".to_owned()
            } else {
                value.into_owned()
            };
            (key.into_owned(), value)
        })
        .collect();
    start.query_pairs_mut().clear().extend_pairs(pairs);
    let (status, kind, body) = browser_page(start.to_string()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(kind.starts_with("text/html"), "{kind}");
    assert!(body.contains("<div class=\"brand\">"), "{body}");
    assert!(body.contains("lead back to Oleafly"), "{body}");
}

#[tokio::test]
async fn an_allowlisted_handle_is_admitted() {
    let (server, _github) = server_for(carol()).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "carol-k".to_owned(),
    };
    allowlist(&server, &admin.access_token, matcher, ServerRole::Member).await;
    assert!(attempt(&server, "github", None).await.is_ok());
}

#[tokio::test]
async fn an_oidc_provider_signs_in_through_the_same_flow() {
    let issuer = MockOidc::start(vec![MockOidcUser {
        subject: "uni-1".to_owned(),
        name: "Carol Diaz".to_owned(),
        email: Some("carol@uni.edu".to_owned()),
        email_verified: Some(json!(true)),
    }])
    .await;
    let mut config = test_config();
    config.providers.push(oidc_provider("uni", &issuer, false));
    let server = TestServer::start(config).await;
    assert!(attempt(&server, "uni", Some(&server.setup_code()))
        .await
        .is_ok());
    assert_eq!(admins(&server).await, 1);
}

#[tokio::test]
async fn redirects_must_go_to_the_loopback_callback() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    for redirect in [
        "http://example.com:5000/callback",
        "http://localhost:5000/callback",
        "https://127.0.0.1:5000/callback",
    ] {
        let response = no_redirect_client()
            .get(with_redirect(&attempt.start_url, redirect))
            .send()
            .await
            .expect("start");
        assert!(
            response.status().is_client_error(),
            "{redirect} answered {}",
            response.status()
        );
        assert!(response.headers().get(reqwest::header::LOCATION).is_none());
        assert!(response
            .text()
            .await
            .expect("page")
            .contains("lead back to Oleafly"));
    }
}

#[tokio::test]
async fn an_unknown_provider_returns_to_the_app() {
    let (server, _github) = server_for(carol()).await;
    assert_eq!(
        attempt(&server, "gitlab", None).await,
        Err("unknown_provider".to_owned())
    );
}

#[tokio::test]
async fn declining_at_the_provider_returns_sign_in_cancelled() {
    let github = MockGithub::start(Vec::new()).await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    assert_eq!(
        attempt(&server, "github", Some(&server.setup_code())).await,
        Err("sign_in_cancelled".to_owned())
    );
    assert_eq!(admins(&server).await, 0);
}

#[tokio::test]
async fn a_pending_sign_in_expires_after_ten_minutes() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = claims::attempt(&server, "github", &device, Some(&server.setup_code()))
        .await
        .expect("a setup claim");
    let client = no_redirect_client();
    let provider_page = location(&client, attempt.start_url.clone()).await;
    let callback = location(&client, provider_page).await;
    server.clock().advance(10 * 60 * 1000 + 1);
    let response = client.get(callback).send().await.expect("callback");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(admins(&server).await, 0);
}

#[tokio::test]
async fn a_callback_cannot_be_replayed() {
    let (server, _github) = server_for(carol()).await;
    let device = TestDevice::generate();
    let attempt = claims::attempt(&server, "github", &device, Some(&server.setup_code()))
        .await
        .expect("a setup claim");
    let client = no_redirect_client();
    let provider_page = location(&client, attempt.start_url.clone()).await;
    let callback = location(&client, provider_page).await;
    let landing = location(&client, callback.clone()).await;
    assert!(app_callback(&landing, &attempt.state).is_ok());
    let replay = client.get(callback).send().await.expect("replay");
    assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
}
