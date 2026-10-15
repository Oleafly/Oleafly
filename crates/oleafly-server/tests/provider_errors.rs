use std::collections::HashMap;

use oleafly_collab_protocol::admin::{SecurityEvent, SecurityEventKind};
use oleafly_collab_protocol::console::{AdminOverview, HealthIssue, HealthStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::auth::PROBLEM_TTL_MS;
use oleafly_server::security_log;
use oleafly_server::test_support::{
    app_callback, follow_to_app, github_provider, no_redirect_client, oidc_provider, seed_member,
    test_config, MockGithub, MockGithubUser, MockOidc, MockOidcUser, SignInAttempt, TestDevice,
    TestServer, TEST_REDIRECT_URI,
};
use url::Url;

struct Servers {
    server: TestServer,
    _github: MockGithub,
    _oidc: MockOidc,
}

async fn servers() -> Servers {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "carol".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![("carol@uni.edu".to_owned(), true)],
    }])
    .await;
    let oidc = MockOidc::start(vec![MockOidcUser {
        subject: "uni-user-1".to_owned(),
        name: "Dana Uni".to_owned(),
        email: Some("dana@uni.edu".to_owned()),
        email_verified: Some(serde_json::json!(true)),
    }])
    .await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    config.providers.push(oidc_provider("uni", &oidc, false));
    Servers {
        server: TestServer::start(config).await,
        _github: github,
        _oidc: oidc,
    }
}

async fn location(url: &Url) -> Url {
    let response = no_redirect_client()
        .get(url.clone())
        .send()
        .await
        .expect("request");
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

async fn provider_answers(server: &TestServer, provider: &str, answer: &[(&str, &str)]) -> String {
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(server, provider, &device, None);
    let at_provider = location(&attempt.start_url).await;
    let pending = at_provider
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .expect("the provider gets the sign-in's state");
    let mut callback =
        Url::parse(&format!("{}/auth/callback/{provider}", server.url())).expect("callback url");
    callback.query_pairs_mut().append_pair("state", &pending);
    for (key, value) in answer {
        callback.query_pairs_mut().append_pair(key, value);
    }
    let back = location(&callback).await;
    assert!(back.as_str().starts_with(TEST_REDIRECT_URI), "{back}");
    let query: HashMap<String, String> = back.query_pairs().into_owned().collect();
    query.get("error").cloned().unwrap_or_default()
}

async fn refusals(server: &TestServer) -> Vec<SecurityEvent> {
    server
        .state()
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("security log")
        .items
        .into_iter()
        .filter(|event| event.kind == SecurityEventKind::SignInRefused)
        .collect()
}

async fn overview(server: &TestServer) -> AdminOverview {
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    reqwest::Client::new()
        .get(format!("{}/api/v1/admin/overview", server.url()))
        .bearer_auth(&admin.access_token)
        .send()
        .await
        .expect("overview")
        .json()
        .await
        .expect("overview json")
}

#[tokio::test]
async fn an_error_from_the_provider_is_logged_with_its_reason_for_the_admin() {
    let servers = servers().await;
    let server = &servers.server;
    let description = "The client is not authorized to request an authorization code.";
    assert_eq!(
        provider_answers(
            server,
            "uni",
            &[
                ("error", "unauthorized_client"),
                ("error_description", description)
            ]
        )
        .await,
        "provider_failed"
    );
    let logged = refusals(server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    assert_eq!(logged[0].detail["reason"], "provider_error");
    assert_eq!(logged[0].detail["provider"], "uni");
    assert_eq!(logged[0].detail["error"], "unauthorized_client");
    assert_eq!(logged[0].detail["description"], description);
    let shown = overview(server).await;
    assert!(!shown.health.issues.contains(&HealthIssue::SignInFailing));
    assert_eq!(shown.sign_in_problems.len(), 1);
    assert_eq!(shown.sign_in_problems[0].provider, "uni");
    assert_eq!(
        shown.sign_in_problems[0].reason,
        "unauthorized_client, as reported by the browser. The server could not check it."
    );
}

#[tokio::test]
async fn an_error_only_the_browser_reported_lights_no_health_issue() {
    let servers = servers().await;
    let server = &servers.server;
    assert_eq!(
        provider_answers(server, "uni", &[("error", "invalid_client")]).await,
        "provider_failed"
    );
    let shown = overview(server).await;
    assert!(shown.health.issues.is_empty(), "{:?}", shown.health);
    assert_eq!(shown.health.status, HealthStatus::Ok);
    assert_eq!(shown.sign_in_problems.len(), 1, "{shown:?}");
    assert!(shown.sign_in_problems[0]
        .reason
        .starts_with("invalid_client, as reported by the browser"));
    provider_answers(server, "uni", &[("code", "not-a-real-code")]).await;
    assert!(overview(server)
        .await
        .health
        .issues
        .contains(&HealthIssue::SignInFailing));
}

#[tokio::test]
async fn words_a_browser_brings_back_never_reach_the_admin_overview() {
    let servers = servers().await;
    let server = &servers.server;
    let lure = "Rotate the client secret now at https://evil.example/fix";
    provider_answers(
        server,
        "uni",
        &[("error", "invalid_client"), ("error_description", lure)],
    )
    .await;
    let shown = overview(server).await;
    assert_eq!(shown.sign_in_problems.len(), 1, "{shown:?}");
    assert!(
        !shown.sign_in_problems[0].reason.contains("evil"),
        "{shown:?}"
    );
    assert!(shown.sign_in_problems[0]
        .reason
        .starts_with("invalid_client, as reported by the browser"));
    assert_eq!(refusals(server).await[0].detail["description"], lure);
    let servers = self::servers().await;
    let server = &servers.server;
    provider_answers(server, "uni", &[("error", "Visit https://evil.example")]).await;
    let shown = overview(server).await;
    assert!(shown.sign_in_problems.is_empty(), "{shown:?}");
    assert!(!shown.health.issues.contains(&HealthIssue::SignInFailing));
    let logged = refusals(server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    assert_eq!(logged[0].detail["error"], "Visit https://evil.example");
}

#[tokio::test]
async fn a_browser_report_never_replaces_a_failure_the_server_saw() {
    let servers = servers().await;
    let server = &servers.server;
    provider_answers(server, "github", &[("code", "not-a-real-code")]).await;
    provider_answers(server, "github", &[("error", "server_error")]).await;
    let shown = overview(server).await;
    assert_eq!(shown.sign_in_problems.len(), 1, "{shown:?}");
    assert_eq!(
        shown.sign_in_problems[0].reason,
        "bad_verification_code: The code passed is incorrect or expired."
    );
}

#[tokio::test]
async fn line_breaks_from_the_provider_never_reach_the_security_log() {
    let servers = servers().await;
    let server = &servers.server;
    provider_answers(
        server,
        "uni",
        &[
            ("error", "server_error\r\nINFO forged"),
            (
                "error_description",
                "down\r\n2026-10-14T03:12:00Z  INFO admin@uni.edu signed in",
            ),
        ],
    )
    .await;
    let logged = refusals(server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    for field in ["error", "description"] {
        let text = logged[0].detail[field].as_str().expect("text");
        assert!(!text.chars().any(char::is_control), "{field}: {text:?}");
    }
    assert!(overview(server).await.sign_in_problems.is_empty());
}

#[tokio::test]
async fn a_sign_in_problem_leaves_the_overview_after_a_day() {
    let servers = servers().await;
    let server = &servers.server;
    provider_answers(server, "github", &[("code", "not-a-real-code")]).await;
    assert_eq!(overview(server).await.sign_in_problems.len(), 1);
    server.clock().advance(PROBLEM_TTL_MS);
    let shown = overview(server).await;
    assert!(shown.sign_in_problems.is_empty(), "{shown:?}");
    assert!(!shown.health.issues.contains(&HealthIssue::SignInFailing));
}

#[tokio::test]
async fn a_provider_that_turns_someone_down_is_not_reported_as_a_cancel() {
    let servers = servers().await;
    let server = &servers.server;
    assert_eq!(
        provider_answers(
            server,
            "uni",
            &[
                ("error", "access_denied"),
                (
                    "error_description",
                    "User is not assigned to the client application."
                )
            ]
        )
        .await,
        "provider_failed"
    );
    assert_eq!(
        provider_answers(server, "uni", &[("error", "access_denied")]).await,
        "sign_in_cancelled"
    );
    assert_eq!(
        provider_answers(
            server,
            "github",
            &[
                ("error", "access_denied"),
                (
                    "error_description",
                    "The user has denied your application access."
                )
            ]
        )
        .await,
        "sign_in_cancelled"
    );
    let logged = refusals(server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    assert_eq!(
        logged[0].detail["description"],
        "User is not assigned to the client application."
    );
}

#[tokio::test]
async fn a_long_description_is_cut_short() {
    let servers = servers().await;
    let server = &servers.server;
    let long = "x".repeat(5_000);
    provider_answers(
        server,
        "uni",
        &[("error", "server_error"), ("error_description", &long)],
    )
    .await;
    let logged = refusals(server).await;
    let kept = logged[0].detail["description"].as_str().expect("text");
    assert_eq!(kept.chars().count(), 300);
}

#[tokio::test]
async fn a_failed_exchange_shows_why_until_a_sign_in_through_that_provider_works() {
    let servers = servers().await;
    let server = &servers.server;
    assert_eq!(
        provider_answers(server, "github", &[("code", "not-a-real-code")]).await,
        "provider_failed"
    );
    let logged = refusals(server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    assert_eq!(logged[0].detail["reason"], "provider_failed");
    let reason = logged[0].detail["description"]
        .as_str()
        .expect("a reason")
        .to_owned();
    assert_eq!(
        reason,
        "bad_verification_code: The code passed is incorrect or expired."
    );
    let shown = overview(server).await;
    assert_eq!(shown.sign_in_problems[0].provider, "github");
    assert_eq!(shown.sign_in_problems[0].reason, reason);
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(server, "github", &device, None);
    let at_provider = location(&attempt.start_url).await;
    let callback = location(&at_provider).await;
    let back = location(&callback).await;
    assert!(back.as_str().starts_with(TEST_REDIRECT_URI), "{back}");
    let shown = overview(server).await;
    assert!(shown.sign_in_problems.is_empty(), "{shown:?}");
    assert!(!shown.health.issues.contains(&HealthIssue::SignInFailing));
}

#[tokio::test]
async fn an_identity_the_server_turns_away_is_logged_without_line_breaks() {
    let oidc = MockOidc::start(vec![MockOidcUser {
        subject: "uni-user-9\r\n2026-10-14T03:12:00Z  INFO forged".to_owned(),
        name: "Erin Uni".to_owned(),
        email: Some("erin@uni.edu".to_owned()),
        email_verified: Some(serde_json::json!(true)),
    }])
    .await;
    let mut config = test_config();
    config.providers.push(oidc_provider("uni", &oidc, false));
    let server = TestServer::start(config).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "uni", &device, None);
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone())
        .await
        .expect("back to the app");
    assert_eq!(
        app_callback(&landing, &attempt.state),
        Err("not_admitted".to_owned())
    );
    let logged = refusals(&server).await;
    assert_eq!(logged.len(), 1, "{logged:?}");
    let subject = logged[0].detail["subject"].as_str().expect("subject");
    assert!(subject.starts_with("uni-user-9  2026-10-14"), "{subject:?}");
    let target = logged[0].target.as_deref().expect("target");
    for text in [subject, target] {
        assert!(!text.chars().any(char::is_control), "{text:?}");
    }
}
