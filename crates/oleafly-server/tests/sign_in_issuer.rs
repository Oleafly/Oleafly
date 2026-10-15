mod browser;

use std::collections::HashMap;
use std::time::Duration;

use browser::{form, set_email_link, Browser};
use oleafly_collab_protocol::admin::AllowlistMatcher;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{
    allowlist, follow_to_app, github_provider, mail_config, no_redirect_client, seed_member,
    test_config, MockGithub, MockGithubUser, MockSmtp, SignInAttempt, TestDevice, TestServer,
    TEST_REDIRECT_URI,
};
use reqwest::StatusCode;
use url::Url;

fn carol() -> MockGithubUser {
    MockGithubUser {
        id: 7,
        login: "carol".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![("carol@uni.edu".to_owned(), true)],
    }
}

async fn server_with_github() -> (TestServer, MockGithub) {
    let github = MockGithub::start(vec![carol()]).await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    (TestServer::start(config).await, github)
}

async fn admit_carol(server: &TestServer) {
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    allowlist(
        server,
        &admin.access_token,
        AllowlistMatcher::ProviderLogin {
            provider: "github".to_owned(),
            login: "carol".to_owned(),
        },
        ServerRole::Member,
    )
    .await;
}

fn query(url: &Url) -> HashMap<String, String> {
    url.query_pairs().into_owned().collect()
}

async fn landing(server: &TestServer, provider: &str) -> HashMap<String, String> {
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(server, provider, &device, None);
    let landing = follow_to_app(&no_redirect_client(), attempt.start_url.clone())
        .await
        .expect("back at the app");
    query(&landing)
}

#[tokio::test]
async fn a_finished_sign_in_names_the_server_that_issued_the_code() {
    let (server, _github) = server_with_github().await;
    admit_carol(&server).await;
    let back = landing(&server, "github").await;
    assert!(back.contains_key("code"), "{back:?}");
    assert_eq!(back.get("iss"), Some(&server.url()));
}

#[tokio::test]
async fn a_refused_sign_in_names_the_server_too() {
    let (server, _github) = server_with_github().await;
    let back = landing(&server, "github").await;
    assert_eq!(back.get("error").map(String::as_str), Some("not_admitted"));
    assert_eq!(back.get("iss"), Some(&server.url()));
}

#[tokio::test]
async fn a_sign_in_option_the_server_lacks_still_names_the_server() {
    let (server, _github) = server_with_github().await;
    let back = landing(&server, "gitlab").await;
    assert_eq!(
        back.get("error").map(String::as_str),
        Some("unknown_provider")
    );
    assert_eq!(back.get("iss"), Some(&server.url()));
}

async fn start_from(server: &TestServer, site: Option<&str>) -> reqwest::Response {
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(server, "github", &device, None);
    let mut request = no_redirect_client().get(attempt.start_url.clone());
    if let Some(site) = site {
        request = request.header("sec-fetch-site", site);
    }
    request.send().await.expect("start")
}

#[tokio::test]
async fn a_sign_in_start_reached_through_another_site_is_refused() {
    let (server, _github) = server_with_github().await;
    for site in ["cross-site", "same-site", "Cross-Site"] {
        let response = start_from(&server, Some(site)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{site}");
        assert!(response.headers().get(reqwest::header::LOCATION).is_none());
        let body = response.text().await.expect("body");
        assert!(body.contains("incomplete"), "{site}: {body}");
    }
    let pending: i64 = server
        .state()
        .db
        .call(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM pending_auth", [], |row| row.get(0))?))
        .await
        .expect("count pending sign-ins");
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn a_sign_in_the_app_opened_or_an_older_browser_sent_goes_ahead() {
    let (server, _github) = server_with_github().await;
    for site in [Some("none"), Some("same-origin"), None] {
        let response = start_from(&server, site).await;
        assert_eq!(response.status(), StatusCode::FOUND, "{site:?}");
        let location = response.headers()[reqwest::header::LOCATION]
            .to_str()
            .expect("location");
        assert!(location.contains("/login/oauth/authorize"), "{location}");
    }
}

#[tokio::test]
async fn an_email_link_used_on_the_same_computer_names_the_server() {
    let smtp = MockSmtp::start().await;
    let server = TestServer::start(mail_config(&smtp)).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    set_email_link(&server, true).await;
    allowlist(
        &server,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "ada@uni.edu".to_owned(),
        },
        ServerRole::Member,
    )
    .await;
    let browser = Browser::new();
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "email-link", &device, None);
    let start = browser.get(&attempt.start_url).await;
    assert_eq!(start.status, 200, "{}", start.body);
    browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    let sent = smtp.wait_for(2, Duration::from_secs(10)).await;
    let text = sent
        .iter()
        .find(|email| email.subject().starts_with("Sign in to"))
        .expect("a sign-in email")
        .text();
    let path = text
        .find("/auth/email-link/verify?token=")
        .expect("the email has a sign-in link");
    let begin = text[..path].rfind("http").expect("link start");
    let end = text[begin..]
        .find(char::is_whitespace)
        .map_or(text.len(), |offset| begin + offset);
    let link = Url::parse(&text[begin..end]).expect("link url");
    let confirm = browser.get(&link).await;
    let used = browser.submit(&form(&confirm), &[]).await;
    let back = used.location.expect("a redirect to the app");
    assert!(back.as_str().starts_with(TEST_REDIRECT_URI), "{back}");
    let back = query(&back);
    assert!(back.contains_key("code"), "{back:?}");
    assert_eq!(back.get("iss"), Some(&server.url()));
}
