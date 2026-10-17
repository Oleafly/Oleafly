mod browser;

use std::time::Duration;

use browser::{
    form, form_labelled, poll, request_code, request_code_as, security_events, set_email_link,
    text_of, Browser, Page,
};
use oleafly_collab_protocol::admin::{AllowlistMatcher, SecurityEventKind};
use oleafly_collab_protocol::auth::{
    AccountSummary, DeviceCodeRequest, DeviceCodeResponse, DevicePoll,
};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{
    allowlist, github_provider, mail_config, seed_member, test_config, CapturedEmail, MockGithub,
    MockGithubUser, MockSmtp, SeededMember, TestDevice, TestServer,
};
use url::Url;

const MINUTE_MS: i64 = 60 * 1000;

struct Setup {
    _github: MockGithub,
    server: TestServer,
    admin: SeededMember,
}

fn person(id: u64, login: &str) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_owned(),
        name: login.to_owned(),
        emails: vec![(format!("{login}@uni.edu"), true)],
    }
}

async fn setup_with(login: &str, smtp: Option<&MockSmtp>) -> Setup {
    let github = MockGithub::start(vec![person(11, login)]).await;
    let mut config = match smtp {
        Some(smtp) => mail_config(smtp),
        None => test_config(),
    };
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    Setup {
        _github: github,
        server,
        admin,
    }
}

async fn setup() -> Setup {
    let setup = setup_with("ada", None).await;
    admit(&setup, "ada").await;
    setup
}

async fn admit(setup: &Setup, login: &str) {
    allowlist(
        &setup.server,
        &setup.admin.access_token,
        AllowlistMatcher::ProviderLogin {
            provider: "github".to_owned(),
            login: login.to_owned(),
        },
        ServerRole::Member,
    )
    .await;
}

async fn enter_code(browser: &Browser, code: &DeviceCodeResponse, typed: &str) -> Page {
    let entry = browser
        .get(&Url::parse(&code.verification_uri).expect("verification uri"))
        .await;
    assert_eq!(entry.status, 200, "{}", entry.body);
    browser.submit(&form(&entry), &[("user_code", typed)]).await
}

async fn continue_with(browser: &Browser, confirm: &Page, label: &str) -> Page {
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    let started = browser.submit(&form_labelled(confirm, label), &[]).await;
    browser.follow(started, "oleafly://").await
}

async fn me(server: &TestServer, access: &str) -> AccountSummary {
    reqwest::Client::new()
        .get(format!("{}/api/v1/me", server.url()))
        .bearer_auth(access)
        .send()
        .await
        .expect("me")
        .json()
        .await
        .expect("me json")
}

fn tokens_from(poll: Result<DevicePoll, String>) -> oleafly_collab_protocol::auth::SessionTokens {
    match poll {
        Ok(DevicePoll::Approved { tokens }) => tokens,
        other => panic!("expected tokens, got {other:?}"),
    }
}

#[tokio::test]
async fn a_code_sign_in_finishes_in_any_browser_and_the_device_gets_its_session() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    assert_eq!(code.interval, 5);
    assert_eq!(code.expires_in, 600);
    assert!(code.verification_uri.ends_with("/auth/device"));
    assert!(code
        .verification_uri_complete
        .ends_with(&format!("/auth/device?code={}", code.user_code)));
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code.to_lowercase()).await;
    assert!(
        text_of(&confirm).contains("Lab PC (Linux)"),
        "{}",
        confirm.body
    );
    let done = continue_with(&browser, &confirm, "GitHub").await;
    assert_eq!(done.status, 200, "{}", done.body);
    assert!(text_of(&done).contains("You're signed in"), "{}", done.body);
    let tokens = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    assert_eq!(
        me(&setup.server, &tokens.access_token).await.logins,
        ["ada"]
    );
    let events = security_events(&setup.server).await;
    let signed_in = events
        .iter()
        .find(|event| event.kind == SecurityEventKind::SignIn)
        .expect("a sign-in event");
    assert_eq!(signed_in.detail["device_code"], true);
    assert!(events
        .iter()
        .any(|event| event.kind == SecurityEventKind::DeviceAdded));
}

#[tokio::test]
async fn the_complete_link_goes_straight_to_the_page_that_names_the_device() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let page = Browser::new()
        .get(&Url::parse(&code.verification_uri_complete).expect("complete uri"))
        .await;
    assert_eq!(page.status, 200, "{}", page.body);
    assert!(
        !page.body.contains("name=\"user_code\" value=\"\""),
        "{}",
        page.body
    );
    assert!(
        !page.body.contains("<label for=\"user_code\">"),
        "{}",
        page.body
    );
    assert!(
        text_of(&page).contains("asked to sign in with this code"),
        "{}",
        page.body
    );
    assert!(text_of(&page).contains(&code.user_code), "{}", page.body);
    assert!(
        text_of(&page).contains("Continue with GitHub"),
        "{}",
        page.body
    );
    // Turning someone else's sign-in away is still one click, as a quiet link.
    assert!(
        page.body
            .contains("<button type=\"submit\" class=\"quiet\">"),
        "{}",
        page.body
    );
}

#[tokio::test]
async fn the_complete_link_offers_only_the_way_picked_in_oleafly() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let mut picked = Url::parse(&code.verification_uri_complete).expect("complete uri");
    picked.query_pairs_mut().append_pair("provider", "github");
    let only_github = text_of(&Browser::new().get(&picked).await);
    assert!(
        only_github.contains("Continue with GitHub"),
        "{only_github}"
    );
    assert!(
        !only_github.contains("Continue with Email"),
        "{only_github}"
    );
    let both = text_of(
        &Browser::new()
            .get(&Url::parse(&code.verification_uri_complete).expect("complete uri"))
            .await,
    );
    assert!(both.contains("Continue with GitHub"), "{both}");
    assert!(both.contains("Continue with Email"), "{both}");
}

#[tokio::test]
async fn polling_waits_while_pending_and_slows_down_when_too_fast() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::SlowDown { interval: 10 })
    );
    setup.server.clock().advance(10_000);
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 10 })
    );
}

#[tokio::test]
async fn codes_expire_after_ten_minutes() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    setup.server.clock().advance(10 * MINUTE_MS);
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Expired)
    );
    let late = enter_code(&Browser::new(), &code, &code.user_code).await;
    assert_eq!(late.status, 400);
    assert!(
        text_of(&late).contains("wrong or has expired"),
        "{}",
        late.body
    );
}

#[tokio::test]
async fn the_person_can_stop_a_sign_in_they_did_not_start() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let stopped = browser
        .submit(&form_labelled(&confirm, "this wasn't me"), &[])
        .await;
    assert_eq!(stopped.status, 200);
    assert!(text_of(&stopped).contains("Sign-in stopped"));
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Denied)
    );
    let again = enter_code(&browser, &code, &code.user_code).await;
    assert_eq!(again.status, 400);
}

#[tokio::test]
async fn an_approved_code_gives_out_one_session() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    continue_with(&browser, &confirm, "GitHub").await;
    let first = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    let again = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    assert_eq!(again.refresh_token, first.refresh_token);
    setup.server.clock().advance(2 * MINUTE_MS + 1);
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Err("invalid_code".to_owned())
    );
}

#[tokio::test]
async fn only_the_device_that_asked_can_collect_the_session() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let thief = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    continue_with(&browser, &confirm, "GitHub").await;
    assert_eq!(
        poll(&setup.server, &thief, &code.device_code).await,
        Err("invalid_signature".to_owned())
    );
    let forged = format!("{}x", code.device_code);
    assert_eq!(
        poll(&setup.server, &device, &forged).await,
        Err("invalid_code".to_owned())
    );
    let tokens = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    let devices: Vec<oleafly_collab_protocol::auth::DeviceSummary> = reqwest::Client::new()
        .get(format!("{}/api/v1/devices", setup.server.url()))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("devices")
        .json()
        .await
        .expect("devices json");
    let current = devices
        .iter()
        .find(|entry| entry.current)
        .expect("this device");
    assert_eq!(current.name, "Lab PC");
    assert_eq!(current.device_id, tokens.device_id);
}

#[tokio::test]
async fn a_person_the_server_does_not_admit_sees_the_usual_refusal() {
    let setup = setup_with("mallory", None).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let refused = continue_with(&browser, &confirm, "GitHub").await;
    assert_eq!(refused.status, 403);
    assert!(
        text_of(&refused).contains("Access denied"),
        "{}",
        refused.body
    );
    assert!(
        text_of(&refused).contains("Your GitHub account @mallory doesn't have access to"),
        "{}",
        refused.body
    );
    assert!(
        text_of(&refused).contains("admin to give you access"),
        "{}",
        refused.body
    );
    assert!(
        refused.body.contains("class=\"status problem\""),
        "{}",
        refused.body
    );
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Err("not_admitted".to_owned())
    );
}

#[tokio::test]
async fn wrong_codes_are_limited_per_address_and_the_lockout_is_logged() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let mut statuses = Vec::new();
    for _ in 0..11 {
        statuses.push(enter_code(&browser, &code, "BBBB-BBBB").await.status);
    }
    assert_eq!(statuses[..10], [400; 10]);
    assert_eq!(statuses[10], 429);
    let right = enter_code(&browser, &code, &code.user_code).await;
    assert_eq!(right.status, 429);
    let lockouts: Vec<_> = security_events(&setup.server)
        .await
        .into_iter()
        .filter(|event| event.detail["reason"] == "locked_out")
        .collect();
    assert_eq!(lockouts.len(), 1);
    assert_eq!(lockouts[0].kind, SecurityEventKind::SignInRefused);
    setup.server.clock().advance(10 * MINUTE_MS);
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a fresh code");
    assert_eq!(
        enter_code(&browser, &code, &code.user_code).await.status,
        200
    );
}

#[tokio::test]
async fn the_code_form_needs_its_own_cookie() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let entry = browser
        .get(&Url::parse(&code.verification_uri).expect("uri"))
        .await;
    browser.forget_cookies();
    let forged = browser
        .submit(&form(&entry), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(forged.status, 403);
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    browser.forget_cookies();
    let forged = browser
        .submit(&form_labelled(&confirm, "GitHub"), &[])
        .await;
    assert_eq!(forged.status, 403);
    assert!(forged.location.is_none());
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
}

#[tokio::test]
async fn a_bad_setup_code_or_device_is_refused_before_a_code_is_made() {
    let setup = setup().await;
    let device = TestDevice::generate();
    assert_eq!(
        request_code(&setup.server, &device, Some("WRONG-CODE"))
            .await
            .err(),
        Some("setup_code_invalid".to_owned())
    );
    let response = reqwest::Client::new()
        .post(format!("{}/auth/device/code", setup.server.url()))
        .json(&serde_json::json!({
            "device_public_key": "short",
            "device_name": "Lab PC",
            "platform": "linux"
        }))
        .send()
        .await
        .expect("request");
    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
}

async fn provider_link(browser: &Browser, code: &DeviceCodeResponse) -> Url {
    let confirm = enter_code(browser, code, &code.user_code).await;
    let started = browser
        .submit(&form_labelled(&confirm, "GitHub"), &[])
        .await;
    assert_eq!(started.status, 303, "{}", started.body);
    started.location.expect("the provider sign-in address")
}

#[tokio::test]
async fn a_provider_link_from_someone_elses_code_sign_in_signs_nobody_in() {
    let setup = setup().await;
    let attacker_device = TestDevice::generate();
    let code = request_code(&setup.server, &attacker_device, None)
        .await
        .expect("a code");
    let link = provider_link(&Browser::new(), &code).await;
    let victim = Browser::new();
    let at_provider = victim.get(&link).await;
    let done = victim.follow(at_provider, "oleafly://").await;
    assert_eq!(done.status, 400, "{}", done.body);
    assert!(
        !text_of(&done).contains("You're signed in"),
        "{}",
        done.body
    );
    assert!(
        text_of(&done).contains("Sign-in didn't finish"),
        "{}",
        done.body
    );
    assert_eq!(
        poll(&setup.server, &attacker_device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
    let events = security_events(&setup.server).await;
    assert!(!events
        .iter()
        .any(|event| event.kind == SecurityEventKind::SignIn));
    let refused = events
        .iter()
        .find(|event| event.kind == SecurityEventKind::SignInRefused)
        .expect("the refusal is logged");
    assert_eq!(refused.detail["reason"], "other_browser");
    assert_eq!(refused.detail["flow"], "device_code");
}

#[tokio::test]
async fn a_provider_link_from_someone_elses_code_sign_in_fails_even_mid_sign_in_of_their_own() {
    let setup = setup().await;
    let attacker_device = TestDevice::generate();
    let attacker_code = request_code(&setup.server, &attacker_device, None)
        .await
        .expect("a code");
    let attacker_link = provider_link(&Browser::new(), &attacker_code).await;
    let own_device = TestDevice::generate();
    let own_code = request_code(&setup.server, &own_device, None)
        .await
        .expect("a code");
    let victim = Browser::new();
    let own_link = provider_link(&victim, &own_code).await;
    let at_provider = victim.get(&attacker_link).await;
    let phished = victim.follow(at_provider, "oleafly://").await;
    assert_eq!(phished.status, 400, "{}", phished.body);
    assert_eq!(
        poll(&setup.server, &attacker_device, &attacker_code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
    let at_provider = victim.get(&own_link).await;
    let done = victim.follow(at_provider, "oleafly://").await;
    assert_eq!(done.status, 200, "{}", done.body);
    assert!(text_of(&done).contains("You're signed in"), "{}", done.body);
    tokens_from(poll(&setup.server, &own_device, &own_code.device_code).await);
}

async fn email_setup(smtp: &MockSmtp) -> Setup {
    let setup = setup_with("ada", Some(smtp)).await;
    set_email_link(&setup.server, true).await;
    allowlist(
        &setup.server,
        &setup.admin.access_token,
        AllowlistMatcher::Email {
            email: "dana@uni.edu".to_owned(),
        },
        ServerRole::Member,
    )
    .await;
    setup
}

async fn ask_for_email(browser: &Browser, code: &DeviceCodeResponse, address: &str) -> Page {
    let confirm = enter_code(browser, code, &code.user_code).await;
    let ask = continue_with(browser, &confirm, "Email").await;
    assert_eq!(ask.status, 200, "{}", ask.body);
    browser.submit(&form(&ask), &[("email", address)]).await
}

async fn sign_in_email(smtp: &MockSmtp) -> CapturedEmail {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let found = smtp
            .messages()
            .into_iter()
            .find(|email| email.subject().starts_with("Sign in to"));
        if let Some(email) = found {
            return email;
        }
        assert!(tokio::time::Instant::now() < deadline, "no sign-in email");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn link_in(email: &CapturedEmail) -> Url {
    let text = email.text();
    let start = text.find("/auth/email-link/verify?token=").expect("link");
    let begin = text[..start].rfind("http").expect("link start");
    let end = text[begin..]
        .find(char::is_whitespace)
        .map_or(text.len(), |offset| begin + offset);
    Url::parse(&text[begin..end]).expect("link")
}

#[tokio::test]
async fn a_stranger_who_signs_in_by_email_hears_which_address_was_turned_away() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    ask_for_email(&Browser::new(), &code, "dave@else.where").await;
    let email = sign_in_email(&smtp).await;
    let phone = Browser::new();
    let confirm = phone.get(&link_in(&email)).await;
    let refused = phone
        .submit(&form(&confirm), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(refused.status, 403, "{}", refused.body);
    let text = text_of(&refused);
    assert!(
        text.contains("dave@else.where doesn't have access to"),
        "{text}"
    );
    assert!(text.contains("admin to give you access"), "{text}");
    assert!(!text.contains("sign out"), "{text}");
    assert!(!text.contains("to Email"), "{text}");
}

#[tokio::test]
async fn a_code_sign_in_can_finish_with_an_emailed_link_opened_anywhere() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let sent = ask_for_email(&Browser::new(), &code, "dana@uni.edu").await;
    assert!(
        text_of(&sent).contains("Open it within 15 minutes"),
        "{}",
        sent.body
    );
    let email = sign_in_email(&smtp).await;
    assert!(!email.text().contains("on that device"), "{}", email.text());
    let phone = Browser::new();
    let confirm = phone.get(&link_in(&email)).await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    let typed = code.user_code.to_lowercase().replace('-', " ");
    let done = phone
        .submit(&form(&confirm), &[("user_code", typed.as_str())])
        .await;
    assert_eq!(done.status, 200, "{}", done.body);
    assert!(text_of(&done).contains("You're signed in"));
    let tokens = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    assert_eq!(
        me(&setup.server, &tokens.access_token).await.emails,
        ["dana@uni.edu"]
    );
}

#[tokio::test]
async fn an_emailed_link_from_someone_elses_code_sign_in_needs_the_code_from_their_device() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let attacker_device = TestDevice::generate();
    let code = request_code(&setup.server, &attacker_device, None)
        .await
        .expect("a code");
    ask_for_email(&Browser::new(), &code, "dana@uni.edu").await;
    let email = sign_in_email(&smtp).await;
    for body in [email.text(), email.html()] {
        assert!(!body.contains("Lab PC"), "{body}");
    }
    let victim = Browser::new();
    let confirm = victim.get(&link_in(&email)).await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    assert!(!text_of(&confirm).contains("Lab PC"), "{}", confirm.body);
    assert!(
        text_of(&confirm).contains("Type the code Oleafly shows"),
        "{}",
        confirm.body
    );
    let blank = victim.submit(&form(&confirm), &[]).await;
    assert_eq!(blank.status, 400, "{}", blank.body);
    assert!(
        !text_of(&blank).contains("You're signed in"),
        "{}",
        blank.body
    );
    let someone_else = request_code(&setup.server, &TestDevice::generate(), None)
        .await
        .expect("another code");
    let wrong = victim
        .submit(
            &form(&confirm),
            &[("user_code", someone_else.user_code.as_str())],
        )
        .await;
    assert_eq!(wrong.status, 400, "{}", wrong.body);
    assert!(
        text_of(&wrong).contains("That code is wrong"),
        "{}",
        wrong.body
    );
    assert_eq!(
        poll(&setup.server, &attacker_device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
    assert!(!security_events(&setup.server)
        .await
        .iter()
        .any(|event| event.kind == SecurityEventKind::SignIn));
}

#[tokio::test]
async fn wrong_codes_on_an_emailed_link_count_toward_the_wrong_code_limit() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    ask_for_email(&Browser::new(), &code, "dana@uni.edu").await;
    let phone = Browser::new();
    let confirm = phone.get(&link_in(&sign_in_email(&smtp).await)).await;
    let mut statuses = Vec::new();
    for _ in 0..11 {
        statuses.push(
            phone
                .submit(&form(&confirm), &[("user_code", "BBBB-BBBB")])
                .await
                .status,
        );
    }
    assert_eq!(statuses[..10], [400; 10]);
    assert_eq!(statuses[10], 429);
    let right = phone
        .submit(&form(&confirm), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(right.status, 429);
    assert_eq!(
        poll(&setup.server, &device, &code.device_code).await,
        Ok(DevicePoll::Pending { interval: 5 })
    );
}

#[tokio::test]
async fn an_emailed_link_for_a_code_that_ran_out_says_the_code_expired() {
    let smtp = MockSmtp::start().await;
    let setup = email_setup(&smtp).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    ask_for_email(&Browser::new(), &code, "dana@uni.edu").await;
    let phone = Browser::new();
    let confirm = phone.get(&link_in(&sign_in_email(&smtp).await)).await;
    setup.server.clock().advance(11 * MINUTE_MS);
    let late = phone
        .submit(&form(&confirm), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(late.status, 400, "{}", late.body);
    assert!(
        text_of(&late).contains("This code has expired"),
        "{}",
        late.body
    );
}

fn code_request(device: &TestDevice, name: &str, platform: &str) -> DeviceCodeRequest {
    DeviceCodeRequest {
        device_public_key: device.public_key_b64().to_owned(),
        device_name: name.to_owned(),
        platform: platform.to_owned(),
        setup_code: None,
    }
}

#[tokio::test]
async fn a_code_for_a_system_the_app_never_runs_on_is_refused() {
    let setup = setup().await;
    let device = TestDevice::generate();
    for platform in ["Security check", "ios", ""] {
        assert_eq!(
            request_code_as(
                &setup.server,
                code_request(&device, "Lab PC", platform),
                None
            )
            .await
            .err()
            .as_deref(),
            Some("bad_request"),
            "{platform}"
        );
    }
    for platform in ["macos", "Windows", "linux"] {
        assert!(
            request_code_as(
                &setup.server,
                code_request(&device, "Lab PC", platform),
                None
            )
            .await
            .is_ok(),
            "{platform}"
        );
    }
}

#[tokio::test]
async fn a_device_name_is_cleaned_before_a_code_is_made_for_it() {
    let setup = setup().await;
    let device = TestDevice::generate();
    assert_eq!(
        request_code_as(
            &setup.server,
            code_request(&device, "\u{200b}\n\u{2066}", "linux"),
            None
        )
        .await
        .err()
        .as_deref(),
        Some("bad_request")
    );
    let code = request_code_as(
        &setup.server,
        code_request(&device, "Lab\r\nPC\u{202e}\u{feff}", "linux"),
        None,
    )
    .await
    .expect("a code");
    let stored: Vec<String> = setup
        .server
        .state()
        .db
        .call(|conn| {
            let mut statement = conn.prepare("SELECT device_name FROM device_authorizations")?;
            let names = statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            Ok(names)
        })
        .await
        .expect("stored names");
    assert_eq!(stored, ["Lab PC"]);
    let confirm = enter_code(&Browser::new(), &code, &code.user_code).await;
    let text = text_of(&confirm);
    assert!(text.contains("Oleafly on Lab PC"), "{text}");
}

#[tokio::test]
async fn a_long_device_name_is_cut_short_on_the_approval_page() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let name = "Please confirm your access for the university IT department today";
    let code = request_code_as(&setup.server, code_request(&device, name, "linux"), None)
        .await
        .expect("a code");
    let confirm = enter_code(&Browser::new(), &code, &code.user_code).await;
    let text = text_of(&confirm);
    assert!(!text.contains(name), "{text}");
    assert!(
        text.contains("Oleafly on Please confirm your access for the univ"),
        "{text}"
    );
    assert!(
        text.contains("If someone sent you this link or code, stop."),
        "{text}"
    );
}

#[tokio::test]
async fn approving_a_code_asked_for_on_another_network_shows_a_warning() {
    let github = MockGithub::start(vec![person(11, "ada")]).await;
    let mut config = test_config();
    config.behind_proxy = true;
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    let device = TestDevice::generate();
    let code = request_code_as(
        &server,
        code_request(&device, "Lab PC", "linux"),
        Some("198.51.100.1"),
    )
    .await
    .expect("a code");
    let warning = "This sign-in was started on a different network than this browser.";
    let elsewhere = enter_code(
        &Browser::from_address("203.0.113.1"),
        &code,
        &code.user_code,
    )
    .await;
    assert!(text_of(&elsewhere).contains(warning), "{}", elsewhere.body);
    assert!(
        elsewhere.body.contains("role=\"alert\""),
        "{}",
        elsewhere.body
    );
    let same = enter_code(
        &Browser::from_address("198.51.100.1"),
        &code,
        &code.user_code,
    )
    .await;
    assert!(!text_of(&same).contains(warning), "{}", same.body);
}

#[tokio::test]
async fn a_poll_whose_approved_reply_was_lost_gets_the_same_session_again() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let done = continue_with(&browser, &confirm, "GitHub").await;
    assert_eq!(done.status, 200, "{}", done.body);
    let lost = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    setup.server.clock().advance(30 * 1000);
    let again = tokens_from(poll(&setup.server, &device, &code.device_code).await);
    assert_eq!(again.refresh_token, lost.refresh_token);
    assert_eq!(again.access_token, lost.access_token);
    assert_eq!(again.device_id, lost.device_id);
    assert_eq!(me(&setup.server, &again.access_token).await.logins, ["ada"]);
    let stranger = TestDevice::generate();
    assert_eq!(
        poll(&setup.server, &stranger, &code.device_code)
            .await
            .err()
            .as_deref(),
        Some("invalid_signature")
    );
    let added = security_events(&setup.server)
        .await
        .into_iter()
        .filter(|event| event.kind == SecurityEventKind::DeviceAdded)
        .count();
    assert_eq!(added, 1);
    setup.server.clock().advance(2 * MINUTE_MS);
    assert_eq!(
        poll(&setup.server, &device, &code.device_code)
            .await
            .err()
            .as_deref(),
        Some("invalid_code")
    );
}
