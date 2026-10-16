mod people;
mod support;

use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::StatusCode;
use oleafly_collab_protocol::admin::{
    AllowlistMatcher, NewAllowlistEntry, NewDomainRule, RuntimeSettingsPatch,
};
use oleafly_collab_protocol::capabilities::CapabilityManifest;
use oleafly_collab_protocol::email::{EmailPreferences, EmailStatus, EmailTestResult};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::mail::messages;
use oleafly_server::members;
use oleafly_server::test_support::{
    fast_mail_retry, mail_config, seed_member, sign_in, test_app, test_app_with,
    test_app_with_mail_retry, test_config, MockSmtp, MockSmtpFault, SeededMember, TestApp,
    TestDevice, MOCK_SMTP_PASSWORD, MOCK_SMTP_USER,
};
use people::{call, grant, share_project, stage_with, Stage};
use reqwest::Method;
use serde_json::{json, Value};
use support::Reply;

const ALLOWLIST: &str = "/api/v1/admin/allowlist";
const DOMAINS: &str = "/api/v1/admin/domains";
const SETTINGS: &str = "/api/v1/admin/settings";
const STATUS: &str = "/api/v1/admin/email";
const TEST: &str = "/api/v1/admin/email/test";
const PREFERENCES: &str = "/api/v1/me/email-preferences";
const MANIFEST: &str = "/.well-known/oleafly-server";
const WAIT: Duration = Duration::from_secs(10);

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .expect("capture lock")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Capture {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().expect("capture lock")).into_owned()
    }
}

fn capture_logs() -> (Capture, tracing::subscriber::DefaultGuard) {
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .finish();
    (capture, tracing::subscriber::set_default(subscriber))
}

fn token(member: &SeededMember) -> Option<&str> {
    Some(member.access_token.as_str())
}

fn email_entry(email: &str) -> Value {
    serde_json::to_value(NewAllowlistEntry {
        matcher: AllowlistMatcher::Email {
            email: email.to_string(),
        },
        role: ServerRole::Member,
    })
    .unwrap()
}

fn notifications(on: bool) -> Value {
    serde_json::to_value(RuntimeSettingsPatch {
        email_notifications: Some(on),
        ..RuntimeSettingsPatch::default()
    })
    .unwrap()
}

fn parse<T: serde::de::DeserializeOwned>(reply: Reply) -> T {
    serde_json::from_value(reply.body).expect("the reply has the expected shape")
}

fn expect_status(reply: Reply, status: StatusCode) -> Reply {
    assert_eq!(reply.status, status, "unexpected reply {}", reply.body);
    reply
}

async fn give_email(app: &TestApp, member: &SeededMember, email: &str) {
    let account = member.account_id;
    let email = email.to_string();
    app.state
        .db
        .call(move |conn| members::add_verified_emails(conn, account, &[email]))
        .await
        .expect("the email is stored");
}

async fn settled(state: &oleafly_server::state::AppState) {
    tokio::time::timeout(WAIT, state.mailer.settled())
        .await
        .expect("the mail queue settles");
}

async fn add_by_email(server: &oleafly_server::test_support::TestServer, admin: &str, email: &str) {
    let reply = call(
        server,
        Method::POST,
        ALLOWLIST,
        admin,
        Some(email_entry(email)),
    )
    .await;
    assert_eq!(reply.status(), reqwest::StatusCode::CREATED);
}

async fn sign_in_again(stage: &Stage) {
    let laptop = TestDevice::generate();
    sign_in(&stage.server, "github", &laptop, None)
        .await
        .expect("bob signs in on a second device");
}

#[tokio::test]
async fn adding_someone_by_email_sends_them_the_server_and_an_add_link() {
    let smtp = MockSmtp::start().await;
    let app = test_app_with(mail_config(&smtp)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    expect_status(
        support::send_post(
            &app.router,
            ALLOWLIST,
            token(&admin),
            email_entry("Carol@Uni.EDU"),
        )
        .await,
        StatusCode::CREATED,
    );
    let sent = smtp.wait_for(1, WAIT).await;
    assert_eq!(sent.len(), 1);
    let email = &sent[0];
    assert_eq!(email.rcpt_to, ["carol@uni.edu"]);
    assert_eq!(email.mail_from, "oleafly@lab.test");
    assert_eq!(
        email.login,
        Some((MOCK_SMTP_USER.to_string(), MOCK_SMTP_PASSWORD.to_string()))
    );
    assert!(email.header("From").unwrap().contains("Smith Lab"));
    assert_eq!(email.subject(), "You've been added to Oleafly Server");
    let text = email.text();
    assert!(
        text.contains("oleafly://server/add?url=https%3A%2F%2Fcollab.test"),
        "{text}"
    );
    assert!(text.contains("https://collab.test"), "{text}");
    assert!(email.html().contains("Add to Oleafly"));
    expect_status(
        support::send_post(
            &app.router,
            DOMAINS,
            token(&admin),
            serde_json::to_value(NewDomainRule {
                domain: "uni.edu".to_string(),
                role: ServerRole::Member,
            })
            .unwrap(),
        )
        .await,
        StatusCode::CREATED,
    );
    settled(&app.state).await;
    assert_eq!(smtp.messages().len(), 1);
}

#[tokio::test]
async fn sharing_a_project_emails_the_new_member_once() {
    let smtp = MockSmtp::start().await;
    let stage = stage_with(mail_config(&smtp)).await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Reef survey").await.project_id;
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Viewer)
            .await
            .status(),
        reqwest::StatusCode::OK
    );
    let sent = smtp.wait_for(1, WAIT).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let email = &sent[0];
    assert_eq!(email.rcpt_to, ["alice@uni.edu"]);
    assert_eq!(email.subject(), "Bob Smith shared \"Reef survey\" with you");
    let text = email.text();
    assert!(text.contains("You're a viewer"), "{text}");
    assert!(text.contains(&format!("&project={project}")), "{text}");
    assert!(
        text.contains(&format!("{}/p/{project}", server.url())),
        "{text}"
    );
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Editor)
            .await
            .status(),
        reqwest::StatusCode::OK
    );
    settled(server.state()).await;
    assert_eq!(smtp.messages().len(), 1);
}

#[tokio::test]
async fn a_sign_in_on_another_device_emails_the_account() {
    let smtp = MockSmtp::start().await;
    let stage = stage_with(mail_config(&smtp)).await;
    settled(stage.server.state()).await;
    assert!(smtp.messages().is_empty(), "first devices send nothing");
    sign_in_again(&stage).await;
    let sent = smtp.wait_for(1, WAIT).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let email = &sent[0];
    assert_eq!(email.rcpt_to, ["bob@uni.edu"]);
    assert_eq!(
        email.subject(),
        "New sign-in to your account on Oleafly Server"
    );
    let text = email.text();
    assert!(text.contains("Device: Test laptop"), "{text}");
    assert!(text.contains("System: macOS"), "{text}");
    let when = messages::local_time(stage.server.clock().now_ms());
    assert!(text.contains(&format!("Time: {when}")), "{text}");
    assert!(text.contains("sign that device out"), "{text}");
}

#[tokio::test]
async fn turning_email_notifications_off_stops_all_three_emails() {
    let smtp = MockSmtp::start().await;
    let stage = stage_with(mail_config(&smtp)).await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let off = call(
        server,
        Method::PATCH,
        SETTINGS,
        bob.token(),
        Some(notifications(false)),
    )
    .await;
    assert_eq!(off.status(), reqwest::StatusCode::OK);
    add_by_email(server, bob.token(), "carol@uni.edu").await;
    let project = share_project(server, bob, "Quiet").await.project_id;
    grant(server, bob, project, alice, ProjectRole::Editor).await;
    sign_in_again(&stage).await;
    settled(server.state()).await;
    assert!(smtp.messages().is_empty(), "{:?}", smtp.messages());
    // Notifications only turn back on once mail is known to get through.
    server
        .state()
        .mailer
        .check()
        .await
        .expect("the mock answers");
    let on = call(
        server,
        Method::PATCH,
        SETTINGS,
        bob.token(),
        Some(notifications(true)),
    )
    .await;
    assert_eq!(on.status(), reqwest::StatusCode::OK);
    add_by_email(server, bob.token(), "dan@uni.edu").await;
    let sent = smtp.wait_for(1, WAIT).await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].rcpt_to, ["dan@uni.edu"]);
}

#[tokio::test]
async fn a_person_can_turn_off_emails_about_shared_projects() {
    let smtp = MockSmtp::start().await;
    let stage = stage_with(mail_config(&smtp)).await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let preferences: EmailPreferences = call(server, Method::GET, PREFERENCES, alice.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(
        preferences,
        EmailPreferences {
            shared_with_you: true,
            mentions: Some(true),
            mail_configured: true,
            notifications: true,
        }
    );
    let changed = call(
        server,
        Method::PATCH,
        PREFERENCES,
        alice.token(),
        Some(json!({ "shared_with_you": false })),
    )
    .await;
    assert_eq!(changed.status(), reqwest::StatusCode::OK);
    let changed: EmailPreferences = changed.json().await.unwrap();
    assert!(!changed.shared_with_you);
    let again: EmailPreferences = call(server, Method::GET, PREFERENCES, alice.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert!(!again.shared_with_you);
    let bobs: EmailPreferences = call(server, Method::GET, PREFERENCES, bob.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert!(bobs.shared_with_you);
    let first = share_project(server, bob, "First").await.project_id;
    grant(server, bob, first, alice, ProjectRole::Editor).await;
    settled(server.state()).await;
    assert!(smtp.messages().is_empty(), "{:?}", smtp.messages());
    call(
        server,
        Method::PATCH,
        PREFERENCES,
        alice.token(),
        Some(json!({ "shared_with_you": true })),
    )
    .await;
    let second = share_project(server, bob, "Second").await.project_id;
    grant(server, bob, second, alice, ProjectRole::Editor).await;
    let sent = smtp.wait_for(1, WAIT).await;
    assert_eq!(sent.len(), 1);
    assert!(sent[0].subject().contains("Second"));
    let signed_out = reqwest::Client::new()
        .get(format!("{}{PREFERENCES}", server.url()))
        .send()
        .await
        .unwrap();
    assert_eq!(signed_out.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_person_can_turn_off_emails_about_mentions_without_touching_share_emails() {
    let smtp = MockSmtp::start().await;
    let stage = stage_with(mail_config(&smtp)).await;
    let (server, alice) = (&stage.server, &stage.alice);
    let before: EmailPreferences = call(server, Method::GET, PREFERENCES, alice.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(before.mentions, Some(true));
    let changed = call(
        server,
        Method::PATCH,
        PREFERENCES,
        alice.token(),
        Some(json!({ "mentions": false })),
    )
    .await;
    assert_eq!(changed.status(), reqwest::StatusCode::OK);
    let changed: EmailPreferences = changed.json().await.unwrap();
    assert_eq!(changed.mentions, Some(false));
    assert!(changed.shared_with_you);
    let again: EmailPreferences = call(server, Method::GET, PREFERENCES, alice.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(again.mentions, Some(false));
    let bobs: EmailPreferences = call(server, Method::GET, PREFERENCES, stage.bob.token(), None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(bobs.mentions, Some(true));
}

#[tokio::test]
async fn without_mail_settings_actions_work_and_every_email_control_says_so() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    give_email(&app, &admin, "admin@uni.edu").await;
    let status: EmailStatus = parse(expect_status(
        support::send_get(&app.router, STATUS, token(&admin)).await,
        StatusCode::OK,
    ));
    assert!(!status.configured);
    assert_eq!(status.from, None);
    let refused = expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::CONFLICT,
    );
    assert!(refused.body["message"]
        .as_str()
        .unwrap()
        .contains("OLEAFLY_SMTP_URL"));
    let preferences: EmailPreferences = parse(expect_status(
        support::send_get(&app.router, PREFERENCES, token(&admin)).await,
        StatusCode::OK,
    ));
    assert!(!preferences.mail_configured);
    expect_status(
        support::send_post(
            &app.router,
            ALLOWLIST,
            token(&admin),
            email_entry("carol@uni.edu"),
        )
        .await,
        StatusCode::CREATED,
    );
    let manifest: CapabilityManifest = parse(support::send_get(&app.router, MANIFEST, None).await);
    assert!(!manifest.features.email);
    assert_eq!(app.state.mailer.stats(), Default::default());
    let smtp = MockSmtp::start().await;
    let mailing = test_app_with(mail_config(&smtp)).await;
    let manifest: CapabilityManifest =
        parse(support::send_get(&mailing.router, MANIFEST, None).await);
    assert!(manifest.features.email);
}

#[tokio::test]
async fn when_the_mail_server_is_down_the_action_succeeds_and_mail_is_retried() {
    let (logs, _guard) = capture_logs();
    let smtp = MockSmtp::start().await;
    smtp.fail_next(1, MockSmtpFault::Unavailable);
    smtp.fail_next(1, MockSmtpFault::RejectMail);
    let app = test_app_with_mail_retry(mail_config(&smtp), fast_mail_retry(4)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    expect_status(
        support::send_post(
            &app.router,
            ALLOWLIST,
            token(&admin),
            email_entry("carol@uni.edu"),
        )
        .await,
        StatusCode::CREATED,
    );
    settled(&app.state).await;
    assert_eq!(smtp.messages().len(), 1);
    assert_eq!(smtp.sessions(), 3);
    let stats = app.state.mailer.stats();
    assert_eq!(
        (stats.delivered, stats.failed_attempts, stats.abandoned),
        (1, 2, 0)
    );
    let text = logs.text();
    assert!(
        text.contains("Could not send the added to the server email (attempt 1 of 4)"),
        "{text}"
    );
    assert!(text.contains("(attempt 2 of 4)"), "{text}");
    assert!(!text.contains(MOCK_SMTP_PASSWORD), "{text}");
}

#[tokio::test]
async fn a_mail_server_that_never_answers_is_given_up_on_and_logged() {
    let (logs, _guard) = capture_logs();
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let mut config = test_config();
    config.smtp_url = Some(format!("smtp://mailer:s3cret-word@127.0.0.1:{port}"));
    config.mail_from = Some("Smith Lab <oleafly@lab.test>".to_string());
    let app = test_app_with_mail_retry(config, fast_mail_retry(3)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    expect_status(
        support::send_post(
            &app.router,
            ALLOWLIST,
            token(&admin),
            email_entry("carol@uni.edu"),
        )
        .await,
        StatusCode::CREATED,
    );
    settled(&app.state).await;
    let stats = app.state.mailer.stats();
    assert_eq!(
        (stats.delivered, stats.failed_attempts, stats.abandoned),
        (0, 3, 1)
    );
    let text = logs.text();
    assert!(
        text.contains("Gave up sending the added to the server email after 3 attempts"),
        "{text}"
    );
    assert!(!text.contains("s3cret-word"), "{text}");
    let status = expect_status(
        support::send_get(&app.router, STATUS, token(&admin)).await,
        StatusCode::OK,
    );
    assert!(!status.body.to_string().contains("s3cret-word"));
    let status: EmailStatus = parse(status);
    let failure = status.last_failure.expect("the last failure is shown");
    assert!(!failure.message.is_empty());
}

#[tokio::test]
async fn the_test_email_goes_to_the_admin_and_reports_the_result() {
    let smtp = MockSmtp::start().await;
    let app = test_app_with(mail_config(&smtp)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let missing = expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::BAD_REQUEST,
    );
    assert!(missing.body["message"]
        .as_str()
        .unwrap()
        .contains("verified email"));
    give_email(&app, &admin, "Admin@Uni.edu").await;
    let result: EmailTestResult = parse(expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::OK,
    ));
    assert_eq!(
        result,
        EmailTestResult {
            sent_to: vec!["admin@uni.edu".to_string()],
            delivered: true,
            error: None,
        }
    );
    let sent = smtp.messages();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].rcpt_to, ["admin@uni.edu"]);
    assert_eq!(sent[0].subject(), "Test email from Oleafly Server");
    smtp.fail_next(1, MockSmtpFault::RejectMail);
    let failed: EmailTestResult = parse(expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::OK,
    ));
    assert!(!failed.delivered);
    let error = failed.error.expect("the failure is explained");
    assert!(error.contains("451"), "{error}");
    assert!(!error.contains(MOCK_SMTP_PASSWORD));
    for role in [
        ServerRole::Maintainer,
        ServerRole::Member,
        ServerRole::Guest,
    ] {
        let other = seed_member(&app, role).await;
        give_email(&app, &other, &format!("{}@uni.edu", other.account_id)).await;
        expect_status(
            support::send_post(&app.router, TEST, token(&other), json!({})).await,
            StatusCode::FORBIDDEN,
        );
    }
    expect_status(
        support::send_post(&app.router, TEST, None, json!({})).await,
        StatusCode::UNAUTHORIZED,
    );
    assert_eq!(smtp.messages().len(), 1);
}

#[tokio::test]
async fn the_test_email_goes_to_each_address_on_its_own() {
    let smtp = MockSmtp::start().await;
    let app = test_app_with(mail_config(&smtp)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    give_email(&app, &admin, "admin@uni.edu").await;
    give_email(&app, &admin, "admin@home.org").await;
    let result: EmailTestResult = parse(expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::OK,
    ));
    assert_eq!(
        result,
        EmailTestResult {
            sent_to: vec!["admin@home.org".to_string(), "admin@uni.edu".to_string()],
            delivered: true,
            error: None,
        }
    );
    let mut recipients: Vec<Vec<String>> = smtp
        .messages()
        .into_iter()
        .map(|message| message.rcpt_to)
        .collect();
    recipients.sort();
    assert_eq!(
        recipients,
        [
            vec!["admin@home.org".to_string()],
            vec!["admin@uni.edu".to_string()]
        ]
    );
    smtp.fail_next(1, MockSmtpFault::RejectMail);
    let partly: EmailTestResult = parse(expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::OK,
    ));
    assert!(!partly.delivered);
    assert_eq!(partly.sent_to.len(), 1);
    let refused = ["admin@home.org", "admin@uni.edu"]
        .into_iter()
        .find(|address| !partly.sent_to.iter().any(|sent| sent == address))
        .expect("one address was refused");
    let error = partly.error.expect("the refusal is explained");
    assert!(error.contains(refused), "{error}");
    assert!(error.contains("451"), "{error}");
}

#[tokio::test]
async fn email_status_is_for_staff_and_never_shows_the_password() {
    let smtp = MockSmtp::start().await;
    let app = test_app_with(mail_config(&smtp)).await;
    for role in [ServerRole::Admin, ServerRole::Maintainer] {
        let staff = seed_member(&app, role).await;
        let reply = expect_status(
            support::send_get(&app.router, STATUS, token(&staff)).await,
            StatusCode::OK,
        );
        let raw = reply.body.to_string();
        assert!(!raw.contains("pass"), "{raw}");
        assert!(!raw.contains("smtp://"), "{raw}");
        let status: EmailStatus = parse(reply);
        assert!(status.configured);
        assert_eq!(status.from.as_deref(), Some("Smith Lab <oleafly@lab.test>"));
        assert!(status.notifications);
        assert_eq!(status.last_failure, None);
    }
    for role in [ServerRole::Member, ServerRole::Guest] {
        let other = seed_member(&app, role).await;
        expect_status(
            support::send_get(&app.router, STATUS, token(&other)).await,
            StatusCode::FORBIDDEN,
        );
    }
    expect_status(
        support::send_get(&app.router, STATUS, None).await,
        StatusCode::UNAUTHORIZED,
    );
}

#[tokio::test]
async fn a_test_email_to_a_mail_server_that_hangs_gives_up_in_time() {
    let smtp = MockSmtp::start().await;
    smtp.fail_next(1, MockSmtpFault::Stall);
    let retry = oleafly_server::mail::RetryPolicy {
        delays: Vec::new(),
        attempt_timeout: Duration::from_millis(300),
    };
    let app = test_app_with_mail_retry(mail_config(&smtp), retry).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    give_email(&app, &admin, "admin@uni.edu").await;
    let started = std::time::Instant::now();
    let result: EmailTestResult = parse(expect_status(
        support::send_post(&app.router, TEST, token(&admin), json!({})).await,
        StatusCode::OK,
    ));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!result.delivered);
    assert!(result
        .error
        .expect("the hang is explained")
        .contains("did not answer"));
}

#[test]
fn the_server_gives_up_on_a_mail_server_before_the_app_gives_up_on_the_server() {
    assert!(
        oleafly_server::mail::RetryPolicy::default().attempt_timeout <= Duration::from_secs(20)
    );
}
