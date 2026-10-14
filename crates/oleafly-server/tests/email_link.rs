mod browser;

use std::time::Duration;

use browser::{form, security_events, set_email_link, text_of, Browser, Page};
use oleafly_collab_protocol::admin::{
    AllowlistMatcher, MemberStatus, NewDomainRule, SecurityEventKind,
};
use oleafly_collab_protocol::auth::AccountSummary;
use oleafly_collab_protocol::capabilities::{CapabilityManifest, ProviderKind};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::members;
use oleafly_server::test_support::{
    allowlist, app_callback, github_provider, mail_config, redeem, seed_member, sign_in,
    test_config, CapturedEmail, MockGithub, MockGithubUser, MockSmtp, SeededMember, SignInAttempt,
    TestDevice, TestServer, TEST_REDIRECT_URI,
};
use url::Url;

const WAIT: Duration = Duration::from_secs(10);
const MINUTE_MS: i64 = 60 * 1000;

struct Setup {
    smtp: MockSmtp,
    server: TestServer,
    admin: SeededMember,
}

async fn setup() -> Setup {
    setup_with(|_| {}).await
}

async fn setup_with(change: impl FnOnce(&mut oleafly_server::config::ServerConfig)) -> Setup {
    let smtp = MockSmtp::start().await;
    let mut config = mail_config(&smtp);
    change(&mut config);
    let server = TestServer::start(config).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    set_email_link(&server, true).await;
    Setup {
        smtp,
        server,
        admin,
    }
}

async fn admit(setup: &Setup, email: &str) {
    allowlist(
        &setup.server,
        &setup.admin.access_token,
        AllowlistMatcher::Email {
            email: email.to_owned(),
        },
        ServerRole::Member,
    )
    .await;
}

async fn manifest(server: &TestServer) -> CapabilityManifest {
    reqwest::get(format!("{}/.well-known/oleafly-server", server.url()))
        .await
        .expect("manifest")
        .json()
        .await
        .expect("manifest json")
}

fn link_in(email: &CapturedEmail) -> Url {
    let text = email.text();
    let start = text
        .find("/auth/email-link/verify?token=")
        .expect("the email has a sign-in link");
    let begin = text[..start].rfind("http").expect("link start");
    let end = text[begin..]
        .find(char::is_whitespace)
        .map_or(text.len(), |offset| begin + offset);
    Url::parse(&text[begin..end]).expect("link url")
}

async fn ask_for_link(browser: &Browser, attempt: &SignInAttempt, email: &str) -> Page {
    let start = browser.get(&attempt.start_url).await;
    assert_eq!(start.status, 200, "{}", start.body);
    browser.submit(&form(&start), &[("email", email)]).await
}

async fn open_link(browser: &Browser, link: &Url) -> Page {
    let confirm = browser.get(link).await;
    if confirm.status != 200 {
        return confirm;
    }
    browser.submit(&form(&confirm), &[]).await
}

fn sign_in_emails(smtp: &MockSmtp) -> Vec<CapturedEmail> {
    smtp.messages()
        .into_iter()
        .filter(|email| email.subject().starts_with("Sign in to"))
        .collect()
}

async fn wait_for_sign_in_emails(smtp: &MockSmtp, count: usize) -> Vec<CapturedEmail> {
    let deadline = tokio::time::Instant::now() + WAIT;
    loop {
        let emails = sign_in_emails(smtp);
        if emails.len() >= count || tokio::time::Instant::now() >= deadline {
            return emails;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn sign_in_emails_after_a_pause(smtp: &MockSmtp) -> usize {
    tokio::time::sleep(Duration::from_millis(300)).await;
    sign_in_emails(smtp).len()
}

async fn latest_email(smtp: &MockSmtp, count: usize) -> CapturedEmail {
    let emails = wait_for_sign_in_emails(smtp, count).await;
    assert_eq!(emails.len(), count, "expected {count} sign-in emails");
    emails[count - 1].clone()
}

fn landing(page: &Page) -> Url {
    let location = page
        .location
        .clone()
        .unwrap_or_else(|| panic!("expected a redirect, got {}: {}", page.status, page.body));
    assert!(
        location.as_str().starts_with(TEST_REDIRECT_URI),
        "{location}"
    );
    location
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

#[tokio::test]
async fn the_email_option_is_listed_only_with_mail_and_the_admin_switch() {
    let quiet = TestServer::start(test_config()).await;
    set_email_link(&quiet, true).await;
    assert!(manifest(&quiet).await.providers.is_empty());
    let setup = setup().await;
    let listed = manifest(&setup.server).await.providers;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "email-link");
    assert_eq!(listed[0].kind, ProviderKind::EmailLink);
    set_email_link(&setup.server, false).await;
    assert!(manifest(&setup.server).await.providers.is_empty());
}

#[tokio::test]
async fn starting_an_email_sign_in_while_it_is_off_goes_back_to_the_app() {
    let setup = setup().await;
    set_email_link(&setup.server, false).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let page = Browser::new().get(&attempt.start_url).await;
    let back = landing(&page);
    assert_eq!(
        app_callback(&back, &attempt.state),
        Err("unknown_provider".to_owned())
    );
}

#[tokio::test]
async fn an_emailed_link_signs_an_allowlisted_person_in_on_the_device_that_asked() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let sent = ask_for_link(&browser, &attempt, " Ada@Uni.EDU ").await;
    assert_eq!(sent.status, 200, "{}", sent.body);
    assert!(text_of(&sent).contains("ada@uni.edu"), "{}", sent.body);
    let email = latest_email(&setup.smtp, 1).await;
    assert_eq!(email.rcpt_to, ["ada@uni.edu"]);
    for body in [email.text(), email.html()] {
        assert!(!body.contains("Test laptop"), "{body}");
    }
    let link = link_in(&email);
    let back = landing(&open_link(&browser, &link).await);
    let code = app_callback(&back, &attempt.state).expect("a sign-in code");
    let tokens = redeem(&setup.server, &device, &code, &attempt.verifier)
        .await
        .expect("tokens");
    let account = me(&setup.server, &tokens.access_token).await;
    assert_eq!(account.emails, ["ada@uni.edu"]);
    assert_eq!(account.display_name, "ada");
    let events = security_events(&setup.server).await;
    let signed_in = events
        .iter()
        .find(|event| event.kind == SecurityEventKind::SignIn)
        .expect("a sign-in event");
    assert_eq!(signed_in.detail["provider"], "email-link");
}

#[tokio::test]
async fn a_link_works_once() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    landing(&open_link(&browser, &link).await);
    let again = open_link(&browser, &link).await;
    assert_eq!(again.status, 400);
    assert!(again.location.is_none());
    assert!(text_of(&again).contains("already used"), "{}", again.body);
}

#[tokio::test]
async fn a_link_expires_after_fifteen_minutes() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    setup.server.clock().advance(15 * MINUTE_MS);
    let late = open_link(&browser, &link).await;
    assert_eq!(late.status, 400);
    assert!(late.location.is_none());
    assert!(text_of(&late).contains("expired"), "{}", late.body);
}

#[tokio::test]
async fn a_link_still_works_after_the_ten_minute_sign_in_window() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    setup.server.clock().advance(14 * MINUTE_MS);
    let back = landing(&open_link(&browser, &link).await);
    assert!(app_callback(&back, &attempt.state).is_ok());
}

#[tokio::test]
async fn the_code_from_a_link_only_works_for_the_device_that_asked() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let other = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    let back = landing(&open_link(&browser, &link).await);
    let code = app_callback(&back, &attempt.state).expect("code");
    assert_eq!(
        redeem(&setup.server, &other, &code, &attempt.verifier).await,
        Err("invalid_signature".to_owned())
    );
    assert!(redeem(&setup.server, &device, &code, &attempt.verifier)
        .await
        .is_ok());
}

#[tokio::test]
async fn a_newer_link_replaces_the_older_one() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    let older = link_in(&latest_email(&setup.smtp, 1).await);
    browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    let both = wait_for_sign_in_emails(&setup.smtp, 2).await;
    assert_eq!(both.len(), 2, "expected 2 sign-in emails");
    let newest = both
        .iter()
        .map(link_in)
        .find(|link| *link != older)
        .expect("the second email carries a new link");
    let refused = open_link(&browser, &older).await;
    assert_eq!(refused.status, 400);
    landing(&open_link(&browser, &newest).await);
}

#[tokio::test]
async fn a_person_the_server_does_not_admit_learns_nothing_more_than_anyone_else() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let known_attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let unknown_attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let known = ask_for_link(&browser, &known_attempt, "ada@uni.edu").await;
    let unknown = ask_for_link(&browser, &unknown_attempt, "eve@else.where").await;
    assert_eq!(known.status, unknown.status);
    assert_eq!(
        text_of(&known).replace("ada@uni.edu", "ADDRESS"),
        text_of(&unknown).replace("eve@else.where", "ADDRESS")
    );
    let email = latest_email(&setup.smtp, 2).await;
    assert_eq!(email.rcpt_to, ["eve@else.where"]);
    let back = landing(&open_link(&browser, &link_in(&email)).await);
    assert_eq!(
        app_callback(&back, &unknown_attempt.state),
        Err("not_admitted".to_owned())
    );
    assert_eq!(
        back.query_pairs()
            .find(|(key, _)| key == "account")
            .map(|(_, value)| value.into_owned()),
        Some("eve@else.where".to_owned())
    );
    let refused = security_events(&setup.server)
        .await
        .into_iter()
        .find(|event| event.kind == SecurityEventKind::SignInRefused)
        .expect("a refusal is logged");
    assert_eq!(refused.detail["provider"], "email-link");
}

#[tokio::test]
async fn links_are_limited_per_address_and_the_lockout_is_logged_once() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    let mut statuses = Vec::new();
    for _ in 0..5 {
        statuses.push(
            browser
                .submit(&form(&start), &[("email", "ada@uni.edu")])
                .await
                .status,
        );
    }
    assert_eq!(statuses, [200, 200, 200, 429, 429]);
    assert_eq!(wait_for_sign_in_emails(&setup.smtp, 3).await.len(), 3);
    assert_eq!(sign_in_emails_after_a_pause(&setup.smtp).await, 3);
    let lockouts: Vec<_> = security_events(&setup.server)
        .await
        .into_iter()
        .filter(|event| event.detail["reason"] == "locked_out")
        .collect();
    assert_eq!(lockouts.len(), 1);
    assert_eq!(lockouts[0].kind, SecurityEventKind::SignInRefused);
    assert_eq!(lockouts[0].target.as_deref(), Some("ada@uni.edu"));
    setup.server.clock().advance(15 * MINUTE_MS);
    let again = SignInAttempt::new(&setup.server, "email-link", &device, None);
    assert_eq!(
        ask_for_link(&browser, &again, "ada@uni.edu").await.status,
        200
    );
}

#[tokio::test]
async fn the_per_address_link_limit_comes_from_the_server_settings() {
    let setup = setup_with(|config| config.sign_in.email_links_per_address = 2).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    let mut statuses = Vec::new();
    for _ in 0..3 {
        statuses.push(
            browser
                .submit(&form(&start), &[("email", "ada@uni.edu")])
                .await
                .status,
        );
    }
    assert_eq!(statuses, [200, 200, 429]);
}

#[tokio::test]
async fn fifty_people_behind_one_address_each_get_a_sign_in_link() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    for index in 0..50 {
        let email = format!("student{index}@uni.edu");
        let page = browser
            .submit(&form(&start), &[("email", email.as_str())])
            .await;
        assert_eq!(page.status, 200, "{email}: {}", page.body);
    }
    assert_eq!(wait_for_sign_in_emails(&setup.smtp, 50).await.len(), 50);
}

#[tokio::test]
async fn links_are_limited_per_address_of_the_requester() {
    let setup = setup_with(|config| config.sign_in.email_links_per_ip = 10).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    let mut statuses = Vec::new();
    for index in 0..11 {
        let email = format!("person{index}@uni.edu");
        statuses.push(
            browser
                .submit(&form(&start), &[("email", email.as_str())])
                .await
                .status,
        );
    }
    assert_eq!(statuses[..10], [200; 10]);
    assert_eq!(statuses[10], 429);
    let lockout = security_events(&setup.server)
        .await
        .into_iter()
        .find(|event| event.detail["reason"] == "locked_out")
        .expect("the lockout is logged");
    assert_eq!(lockout.detail["limit"], "ip");
}

#[tokio::test]
async fn forms_without_their_cookie_are_refused() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    browser.forget_cookies();
    let forged = browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    assert_eq!(forged.status, 403);
    assert_eq!(sign_in_emails_after_a_pause(&setup.smtp).await, 0);
    let start = browser.get(&attempt.start_url).await;
    browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    let confirm = browser.get(&link).await;
    browser.forget_cookies();
    let forged = browser.submit(&form(&confirm), &[]).await;
    assert_eq!(forged.status, 403);
    assert!(forged.location.is_none());
    let honest = Browser::new();
    landing(&open_link(&honest, &link).await);
}

#[tokio::test]
async fn opening_a_link_does_not_use_it_until_the_person_confirms() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    let scanner = Browser::new();
    for _ in 0..3 {
        let preview = scanner.get(&link).await;
        assert_eq!(preview.status, 200);
        assert!(preview.location.is_none());
        assert!(
            text_of(&preview).contains("Test laptop"),
            "{}",
            preview.body
        );
    }
    landing(&open_link(&browser, &link).await);
}

#[tokio::test]
async fn a_bad_address_gets_the_form_back_with_a_hint() {
    let setup = setup().await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let page = ask_for_link(&browser, &attempt, "not an address").await;
    assert_eq!(page.status, 400);
    assert!(
        text_of(&page).contains("valid email address"),
        "{}",
        page.body
    );
    assert!(browser::forms(&page).len() == 1);
    assert_eq!(sign_in_emails_after_a_pause(&setup.smtp).await, 0);
}

#[tokio::test]
async fn a_member_who_signed_in_with_github_keeps_one_account_with_an_email_link() {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "ada".to_owned(),
        name: "Ada Lovelace".to_owned(),
        emails: vec![("ada@uni.edu".to_owned(), true)],
    }])
    .await;
    let smtp = MockSmtp::start().await;
    let mut config = mail_config(&smtp);
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
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
    let laptop = TestDevice::generate();
    let first = sign_in(&server, "github", &laptop, None)
        .await
        .expect("github sign-in");
    let desktop = TestDevice::generate();
    let attempt = SignInAttempt::new(&server, "email-link", &desktop, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, "ada@uni.edu").await;
    let email = latest_email(&smtp, 1).await;
    let back = landing(&open_link(&browser, &link_in(&email)).await);
    let code = app_callback(&back, &attempt.state).expect("code");
    let second = redeem(&server, &desktop, &code, &attempt.verifier)
        .await
        .expect("tokens");
    assert_eq!(second.account_id, first.account_id);
    assert_eq!(
        me(&server, &second.access_token).await.display_name,
        "Ada Lovelace"
    );
}

async fn email_sign_in_result(
    server: &TestServer,
    smtp: &MockSmtp,
    email: &str,
    count: usize,
) -> Result<String, String> {
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(server, "email-link", &device, None);
    let browser = Browser::new();
    ask_for_link(&browser, &attempt, email).await;
    let link = link_in(&latest_email(smtp, count).await);
    let back = landing(&open_link(&browser, &link).await);
    app_callback(&back, &attempt.state)
}

async fn account_count(server: &TestServer) -> i64 {
    server
        .state()
        .db
        .call(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| {
                row.get::<_, i64>(0)
            })?)
        })
        .await
        .expect("count")
}

#[tokio::test]
async fn a_suspended_or_removed_member_stays_out_when_signing_in_by_email() {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "ada".to_owned(),
        name: "Ada Lovelace".to_owned(),
        emails: vec![("ada@uni.edu".to_owned(), true)],
    }])
    .await;
    let smtp = MockSmtp::start().await;
    let mut config = mail_config(&smtp);
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    seed_member(server.app(), ServerRole::Admin).await;
    set_email_link(&server, true).await;
    server
        .state()
        .db
        .call(|conn| {
            members::add_domain_rule(
                conn,
                &NewDomainRule {
                    domain: "uni.edu".to_owned(),
                    role: ServerRole::Member,
                },
                None,
                1,
            )
            .map(|_| ())
        })
        .await
        .expect("domain rule");
    let ada = sign_in(&server, "github", &TestDevice::generate(), None)
        .await
        .expect("github sign-in")
        .account_id;
    let accounts = account_count(&server).await;
    server
        .state()
        .db
        .call(move |conn| members::set_status(conn, ada, &MemberStatus::Suspended, 2))
        .await
        .expect("suspend");
    assert_eq!(
        email_sign_in_result(&server, &smtp, "ada@uni.edu", 1).await,
        Err("not_admitted".to_owned())
    );
    server
        .state()
        .db
        .call(move |conn| members::remove_account(conn, ada, 3).map(|_| ()))
        .await
        .expect("remove");
    assert_eq!(
        email_sign_in_result(&server, &smtp, "ada@uni.edu", 2).await,
        Err("not_admitted".to_owned())
    );
    assert_eq!(account_count(&server).await, accounts);
}

#[tokio::test]
async fn an_address_held_only_by_former_accounts_opens_no_new_account_through_a_domain_rule() {
    let setup = setup().await;
    setup
        .server
        .state()
        .db
        .call(|conn| {
            members::add_domain_rule(
                conn,
                &NewDomainRule {
                    domain: "uni.edu".to_owned(),
                    role: ServerRole::Member,
                },
                None,
                1,
            )?;
            for status in [MemberStatus::Removed, MemberStatus::Suspended] {
                let account = members::create_account(conn, "Left", None, ServerRole::Member, 1)?;
                members::add_verified_emails(conn, account, &["left@uni.edu".to_owned()])?;
                members::set_status(conn, account, &status, 2)?;
            }
            Ok(())
        })
        .await
        .expect("seed");
    let accounts = account_count(&setup.server).await;
    assert_eq!(
        email_sign_in_result(&setup.server, &setup.smtp, "left@uni.edu", 1).await,
        Err("not_admitted".to_owned())
    );
    assert_eq!(account_count(&setup.server).await, accounts);
    let refused = security_events(&setup.server)
        .await
        .into_iter()
        .find(|event| event.kind == SecurityEventKind::SignInRefused)
        .expect("a refusal is logged");
    assert_eq!(refused.detail["reason"], "address_of_inactive_account");
    assert!(
        email_sign_in_result(&setup.server, &setup.smtp, "new@uni.edu", 2)
            .await
            .is_ok()
    );
    assert_eq!(account_count(&setup.server).await, accounts + 1);
}

const IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

#[tokio::test]
async fn a_link_opened_on_a_phone_says_to_use_the_computer_and_stays_usable() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let computer = Browser::new();
    ask_for_link(&computer, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    let phone = Browser::with_user_agent(IPHONE);
    let opened = phone.get(&link).await;
    assert_eq!(opened.status, 200, "{}", opened.body);
    let text = text_of(&opened);
    assert!(
        text.contains("so it can't finish on a phone or tablet"),
        "{text}"
    );
    assert!(text.contains("Test laptop (macOS)"), "{text}");
    assert!(!opened.body.contains("<form"), "{}", opened.body);
    let finished = open_link(&computer, &link).await;
    let back = landing(&finished);
    let code = app_callback(&back, &attempt.state).expect("a sign-in code");
    assert!(redeem(&setup.server, &device, &code, &attempt.verifier)
        .await
        .is_ok());
}

#[tokio::test]
async fn the_link_page_on_the_computer_says_it_works_only_there() {
    let setup = setup().await;
    admit(&setup, "ada@uni.edu").await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let computer = Browser::new();
    ask_for_link(&computer, &attempt, "ada@uni.edu").await;
    let link = link_in(&latest_email(&setup.smtp, 1).await);
    let confirm = computer.get(&link).await;
    let text = text_of(&confirm);
    assert!(
        text.contains("This link works only on that computer."),
        "{text}"
    );
    assert!(confirm.body.contains("<form"), "{}", confirm.body);
}
