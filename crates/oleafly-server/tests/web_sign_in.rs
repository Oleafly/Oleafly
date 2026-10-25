#![cfg(feature = "web")]

mod people;
mod web_support;

use oleafly_collab_protocol::auth::DeviceSummary;
use oleafly_server::test_support::{
    github_provider, no_redirect_client, MockGithub, MockGithubUser, TestServer,
};
use people::{call, read};
use reqwest::header::{COOKIE, LOCATION, ORIGIN};
use reqwest::{Method, StatusCode};
use serde_json::Value;
use web_support::{browser_sign_in, follow, start_url, web_stage, Jar};

async fn devices_of(server: &TestServer, token: &str) -> Vec<DeviceSummary> {
    read(call(server, Method::GET, "/api/v1/devices", token, None).await).await
}

#[tokio::test]
async fn signing_in_from_the_browser_sets_a_session_cookie_and_returns_to_the_app() {
    let stage = web_stage().await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/?project=abc").await;
    assert_eq!(browser.landed.path(), "/web/");
    assert_eq!(browser.landed.query(), Some("project=abc"));
    let cookie = browser.session_cookie.clone();
    for part in ["HttpOnly", "SameSite=Lax", "Path=/;", "Max-Age=2592000"] {
        assert!(cookie.contains(part), "{cookie} lacks {part}");
    }
    assert!(
        !cookie.contains("Secure"),
        "plain http on this computer keeps the cookie without Secure: {cookie}"
    );
    let me = browser.json("/web/api/me").await;
    assert_eq!(
        me["account"]["id"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    assert_eq!(me["account"]["displayName"], "Alice Chen");
    assert_eq!(me["account"]["login"], "alice");
    assert_eq!(
        me["server"]["name"],
        stage.server.state().config.server_name
    );
    let listed = devices_of(&stage.server, stage.alice.token()).await;
    let web: Vec<&DeviceSummary> = listed
        .iter()
        .filter(|device| device.platform == "web")
        .collect();
    assert_eq!(web.len(), 1, "{listed:?}");
}

#[tokio::test]
async fn a_return_path_outside_the_app_goes_back_to_the_app_home() {
    let stage = web_stage().await;
    let browser = browser_sign_in(&stage.server, "github2", "https://evil.example/web/").await;
    assert_eq!(browser.landed.path(), "/web/");
    assert_eq!(browser.landed.query(), None);
}

#[tokio::test]
async fn revoking_the_browser_from_the_device_list_ends_its_session() {
    let stage = web_stage().await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let web = devices_of(&stage.server, stage.alice.token())
        .await
        .into_iter()
        .find(|device| device.platform == "web")
        .expect("the browser is a device");
    let revoked = call(
        &stage.server,
        Method::DELETE,
        &format!("/api/v1/devices/{}", web.device_id),
        stage.alice.token(),
        None,
    )
    .await;
    assert!(revoked.status().is_success(), "{}", revoked.status());
    let me = browser.get("/web/api/me").await;
    assert_eq!(me.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn signing_out_needs_the_app_marker_and_this_origin_then_revokes_the_device() {
    let stage = web_stage().await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let origin = stage.server.url();
    let unmarked = browser
        .send(Method::POST, "/web/api/sign-out", Some(&origin), false)
        .await;
    assert_eq!(unmarked.status(), StatusCode::FORBIDDEN);
    let elsewhere = browser
        .send(
            Method::POST,
            "/web/api/sign-out",
            Some("https://evil.example"),
            true,
        )
        .await;
    assert_eq!(elsewhere.status(), StatusCode::FORBIDDEN);
    let without_origin = browser
        .send(Method::POST, "/web/api/sign-out", None, true)
        .await;
    assert_eq!(without_origin.status(), StatusCode::FORBIDDEN);
    assert_eq!(browser.get("/web/api/me").await.status(), StatusCode::OK);
    let signed_out = browser.sign_out().await;
    assert_eq!(signed_out.status(), StatusCode::NO_CONTENT);
    let cleared = signed_out
        .headers()
        .get("set-cookie")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(cleared.starts_with("oleafly_web=;"), "{cleared}");
    assert!(cleared.contains("Max-Age=0"), "{cleared}");
    assert_eq!(
        browser.get("/web/api/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    let web = devices_of(&stage.server, stage.alice.token())
        .await
        .into_iter()
        .filter(|device| device.platform == "web")
        .count();
    assert_eq!(web, 0);
}

#[tokio::test]
async fn a_sign_in_finished_in_another_browser_is_refused() {
    let stage = web_stage().await;
    let server = &stage.server;
    let client = no_redirect_client();
    let started = client
        .get(start_url(server, "github2", "/web/"))
        .send()
        .await
        .expect("start");
    assert_eq!(started.status(), StatusCode::FOUND);
    let mut jar = Jar::default();
    jar.take(&started);
    assert!(jar.get("oleafly_device_flow").is_some(), "{jar:?}");
    let to_provider = started
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .expect("a provider address")
        .to_string();
    let from_provider = client.get(&to_provider).send().await.expect("provider");
    let callback = from_provider
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .expect("a callback")
        .to_string();
    let elsewhere = client.get(&callback).send().await.expect("callback");
    assert_eq!(elsewhere.status(), StatusCode::BAD_REQUEST);
    assert!(elsewhere.headers().get("set-cookie").is_none());
    let page = elsewhere.text().await.unwrap_or_default();
    assert!(page.contains("/web/sign-in"), "{page}");
}

#[tokio::test]
async fn someone_the_server_does_not_admit_sees_why_and_gets_no_session() {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 40,
        login: "mallory".to_owned(),
        name: "Mallory".to_owned(),
        emails: vec![],
    }])
    .await;
    let mut config = web_support::web_config();
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    let followed = follow(
        &server,
        start_url(&server, "github", "/web/?project=x"),
        Jar::default(),
    )
    .await;
    assert_eq!(followed.last.status(), StatusCode::FORBIDDEN);
    assert!(
        followed
            .cookies
            .iter()
            .all(|cookie| !cookie.starts_with("oleafly_web=")),
        "{:?}",
        followed.cookies
    );
    let page = followed.last.text().await.expect("page");
    assert!(page.contains("@mallory"), "{page}");
    assert!(
        page.contains("/web/sign-in?return=%2Fweb%2F%3Fproject%3Dx"),
        "{page}"
    );
}

#[tokio::test]
async fn the_sign_in_page_lists_the_providers_and_a_signed_in_browser_skips_it() {
    let stage = web_stage().await;
    let page = reqwest::Client::new()
        .get(format!(
            "{}/web/sign-in?return=%2Fweb%2F%3Fproject%3Dp1",
            stage.server.url()
        ))
        .send()
        .await
        .expect("page");
    assert_eq!(page.status(), StatusCode::OK);
    let policy = page
        .headers()
        .get("content-security-policy")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(policy.contains("frame-ancestors 'none'"), "{policy}");
    let html = page.text().await.expect("html");
    assert!(html.contains("flow=web"), "{html}");
    assert!(html.contains("provider=github2"), "{html}");
    assert!(html.contains("return=%2Fweb%2F%3Fproject%3Dp1"), "{html}");
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let again = no_redirect_client()
        .get(format!(
            "{}/web/sign-in?return=%2Fweb%2Fdone",
            stage.server.url()
        ))
        .header(COOKIE, browser.jar.header())
        .send()
        .await
        .expect("page");
    assert_eq!(again.status(), StatusCode::FOUND);
    assert_eq!(
        again
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok()),
        Some("/web/done")
    );
}

#[tokio::test]
async fn with_browser_access_off_every_web_address_is_missing() {
    let stage = people::stage().await;
    for path in [
        "/web/",
        "/web/sign-in",
        "/web/api/me",
        "/web/api/projects",
        "/web/anything",
    ] {
        let response = reqwest::Client::new()
            .get(format!("{}{path}", stage.server.url()))
            .send()
            .await
            .expect("request");
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
    let start = no_redirect_client()
        .get(start_url(&stage.server, "github2", "/web/"))
        .send()
        .await
        .expect("start");
    assert_eq!(start.status(), StatusCode::NOT_FOUND);
    let sign_out = reqwest::Client::new()
        .post(format!("{}/web/api/sign-out", stage.server.url()))
        .header(ORIGIN, stage.server.url())
        .header("X-Requested-With", "oleafly-web")
        .send()
        .await
        .expect("sign out");
    assert_eq!(sign_out.status(), StatusCode::NOT_FOUND);
}

mod browser;

fn link_in(email: &oleafly_server::test_support::CapturedEmail) -> url::Url {
    let text = email.text();
    let start = text
        .find("/auth/email-link/verify?token=")
        .expect("the email has a sign-in link");
    let begin = text[..start].rfind("http").expect("link start");
    let end = text[begin..]
        .find(char::is_whitespace)
        .map_or(text.len(), |offset| begin + offset);
    url::Url::parse(&text[begin..end]).expect("link url")
}

async fn sign_in_email(
    smtp: &oleafly_server::test_support::MockSmtp,
) -> oleafly_server::test_support::CapturedEmail {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if let Some(email) = smtp
            .messages()
            .into_iter()
            .find(|email| email.subject().starts_with("Sign in to"))
        {
            return email;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no sign-in email arrived"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn an_email_link_signs_in_only_the_browser_that_asked_for_it() {
    let smtp = oleafly_server::test_support::MockSmtp::start().await;
    let mut config = oleafly_server::test_support::mail_config(&smtp);
    config.web = true;
    let server = TestServer::start(config).await;
    let admin = oleafly_server::test_support::seed_member(
        server.app(),
        oleafly_collab_protocol::roles::ServerRole::Admin,
    )
    .await;
    browser::set_email_link(&server, true).await;
    oleafly_server::test_support::allowlist(
        &server,
        &admin.access_token,
        oleafly_collab_protocol::admin::AllowlistMatcher::Email {
            email: "ada@uni.edu".to_owned(),
        },
        oleafly_collab_protocol::roles::ServerRole::Member,
    )
    .await;
    let asking = browser::Browser::with_user_agent(
        "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    );
    let start = asking
        .get(&start_url(&server, "email-link", "/web/?project=p"))
        .await;
    assert_eq!(start.status, 200, "{}", start.body);
    assert!(start.body.contains("Firefox on Linux"), "{}", start.body);
    let sent = asking
        .submit(&browser::form(&start), &[("email", "ada@uni.edu")])
        .await;
    assert_eq!(sent.status, 200, "{}", sent.body);
    let link = link_in(&sign_in_email(&smtp).await);
    let other = browser::Browser::new();
    let elsewhere = other.get(&link).await;
    assert_eq!(elsewhere.status, 200);
    assert!(
        elsewhere.body.contains("the browser where you started"),
        "{}",
        elsewhere.body
    );
    let confirm = asking.get(&link).await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    let done = asking.submit(&browser::form(&confirm), &[]).await;
    assert_eq!(done.status, 302, "{}", done.body);
    let location = done.location.expect("a redirect");
    assert_eq!(location.path(), "/web/");
    assert_eq!(location.query(), Some("project=p"));
    let signed_in = asking
        .get(&url::Url::parse(&format!("{}/web/sign-in", server.url())).expect("url"))
        .await;
    assert_eq!(
        signed_in.status, 302,
        "the browser that asked now has a session"
    );
    let still_out = other
        .get(&url::Url::parse(&format!("{}/web/sign-in", server.url())).expect("url"))
        .await;
    assert_eq!(still_out.status, 200);
}
