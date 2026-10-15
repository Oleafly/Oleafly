mod claims;

use oleafly_collab_protocol::crypto::pkce_s256;
use oleafly_server::auth::setup::CLAIM_TTL_MS;
use oleafly_server::members;
use oleafly_server::test_support::{
    app_callback, follow_to_app, github_provider, no_redirect_client, redeem, test_config,
    MockGithub, MockGithubUser, SignInAttempt, TestDevice, TestServer,
};
use reqwest::StatusCode;
use serde_json::json;
use url::Url;

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

async fn admins(server: &TestServer) -> u32 {
    server
        .state()
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .expect("count admins")
}

async fn claim_status(server: &TestServer, body: serde_json::Value) -> (StatusCode, String) {
    let response = reqwest::Client::new()
        .post(format!("{}/auth/setup-claim", server.url()))
        .json(&body)
        .send()
        .await
        .expect("setup claim request");
    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    (status, body["code"].as_str().unwrap_or_default().to_owned())
}

fn with_claim(attempt: &SignInAttempt, claim: &str) -> Url {
    let mut url = attempt.start_url.clone();
    url.query_pairs_mut().append_pair("setup_claim", claim);
    url
}

async fn landing(url: Url, state: &str) -> Result<String, String> {
    let landing = follow_to_app(&no_redirect_client(), url).await?;
    app_callback(&landing, state)
}

#[tokio::test]
async fn a_wrong_setup_code_gets_no_claim() {
    let (server, _github) = server().await;
    let challenge = pkce_s256("some verifier");
    let (status, code) = claim_status(
        &server,
        json!({ "setup_code": "WRONG-CODE", "code_challenge": challenge }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(code, "setup_code_invalid");
    let (status, code) = claim_status(
        &server,
        json!({ "setup_code": "  ", "code_challenge": challenge }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(code, "setup_code_invalid");
}

#[tokio::test]
async fn a_claim_needs_a_real_pkce_challenge() {
    let (server, _github) = server().await;
    let (status, _) = claim_status(
        &server,
        json!({ "setup_code": server.setup_code(), "code_challenge": "short" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = claim_status(&server, json!({ "setup_code": server.setup_code() })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_claim_makes_the_first_admin_without_the_code_in_any_address() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    let claim = claims::claim_for(&server, &server.setup_code(), &pkce_s256(&attempt.verifier))
        .await
        .expect("a claim");
    let url = with_claim(&attempt, &claim);
    assert!(!url.as_str().contains(&server.setup_code()), "{url}");
    let code = landing(url, &attempt.state).await.expect("sign-in code");
    redeem(&server, &device, &code, &attempt.verifier)
        .await
        .expect("tokens");
    assert_eq!(admins(&server).await, 1);
}

#[tokio::test]
async fn a_claim_only_works_with_the_sign_in_it_was_made_for() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let own = SignInAttempt::new(&server, "github", &device, None);
    let other = SignInAttempt::new(&server, "github", &device, None);
    let claim = claims::claim_for(&server, &server.setup_code(), &pkce_s256(&own.verifier))
        .await
        .expect("a claim");
    assert_eq!(
        landing(with_claim(&other, &claim), &other.state).await,
        Err("setup_code_invalid".to_owned())
    );
    assert_eq!(admins(&server).await, 0);
    let code = landing(with_claim(&own, &claim), &own.state)
        .await
        .expect("the claim still works for its own sign-in");
    redeem(&server, &device, &code, &own.verifier)
        .await
        .expect("tokens");
    assert_eq!(admins(&server).await, 1);
}

#[tokio::test]
async fn a_claim_works_once() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    let claim = claims::claim_for(&server, &server.setup_code(), &pkce_s256(&attempt.verifier))
        .await
        .expect("a claim");
    let url = with_claim(&attempt, &claim);
    let first = no_redirect_client()
        .get(url.clone())
        .send()
        .await
        .expect("first start");
    assert!(first.status().is_redirection());
    assert_eq!(
        landing(url, &attempt.state).await,
        Err("setup_code_invalid".to_owned())
    );
}

#[tokio::test]
async fn a_claim_runs_out_after_ten_minutes() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, None);
    let claim = claims::claim_for(&server, &server.setup_code(), &pkce_s256(&attempt.verifier))
        .await
        .expect("a claim");
    server.clock().advance(CLAIM_TTL_MS);
    assert_eq!(
        landing(with_claim(&attempt, &claim), &attempt.state).await,
        Err("setup_code_invalid".to_owned())
    );
    assert_eq!(admins(&server).await, 0);
}

#[tokio::test]
async fn the_setup_code_itself_is_refused_in_the_start_address() {
    let (server, _github) = server().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "github", &device, Some(&server.setup_code()));
    assert_eq!(
        landing(attempt.start_url.clone(), &attempt.state).await,
        Err("setup_code_invalid".to_owned())
    );
    assert_eq!(admins(&server).await, 0);
    let still_usable = claims::claim_for(&server, &server.setup_code(), &pkce_s256("v")).await;
    assert!(still_usable.is_ok(), "{still_usable:?}");
}
