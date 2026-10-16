mod browser;

use std::time::Duration;

use browser::{form, form_labelled, request_code, set_email_link, text_of, Browser, Page};
use oleafly_collab_protocol::admin::AllowlistMatcher;
use oleafly_collab_protocol::auth::{AuthErrorCode, DeviceCodeResponse};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::i18n::{Key, Locale};
use oleafly_server::test_support::{
    allowlist, github_provider, mail_config, seed_member, test_config, CapturedEmail, MockGithub,
    MockGithubUser, MockSmtp, SeededMember, SignInAttempt, TestDevice, TestServer,
};
use url::Url;

const MINUTE_MS: i64 = 60 * 1000;

struct Setup {
    _github: MockGithub,
    smtp: Option<MockSmtp>,
    server: TestServer,
    admin: SeededMember,
}

impl Setup {
    fn server_name(&self) -> String {
        self.server.state().config.server_name.clone()
    }

    fn smtp(&self) -> &MockSmtp {
        self.smtp.as_ref().expect("this setup sends email")
    }
}

async fn setup(admitted: &str, with_mail: bool) -> Setup {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 11,
        login: "mallory".to_owned(),
        name: "mallory".to_owned(),
        emails: vec![("mallory@uni.edu".to_owned(), true)],
    }])
    .await;
    let smtp = if with_mail {
        Some(MockSmtp::start().await)
    } else {
        None
    };
    let mut config = smtp.as_ref().map_or_else(test_config, mail_config);
    config.providers.push(github_provider("github", &github));
    let server = TestServer::start(config).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    if with_mail {
        set_email_link(&server, true).await;
    }
    let setup = Setup {
        _github: github,
        smtp,
        server,
        admin,
    };
    if !admitted.is_empty() {
        let matcher = if admitted.contains('@') {
            AllowlistMatcher::Email {
                email: admitted.to_owned(),
            }
        } else {
            AllowlistMatcher::ProviderLogin {
                provider: "github".to_owned(),
                login: admitted.to_owned(),
            }
        };
        allowlist(
            &setup.server,
            &setup.admin.access_token,
            matcher,
            ServerRole::Member,
        )
        .await;
    }
    setup
}

fn locale(tag: &str) -> Locale {
    Locale::named(tag).expect("a supported locale")
}

fn in_language(page: &Page, tag: &str) {
    assert!(
        page.body
            .starts_with(&format!("<!doctype html><html lang=\"{tag}\">")),
        "{}",
        page.body
    );
    assert_eq!(
        page.vary.as_deref(),
        Some("accept-language"),
        "{}",
        page.body
    );
}

fn shows(page: &Page, tag: &str, key: Key, values: &[(&str, &str)]) {
    let translated = locale(tag).fill(key, values);
    assert_ne!(
        translated,
        Locale::ENGLISH.fill(key, values),
        "{tag} {key:?} is still English"
    );
    let text = text_of(page);
    let wanted = translated.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        text.contains(&wanted),
        "{tag} page lacks {wanted:?}: {text}"
    );
}

fn label(tag: &str, key: Key, values: &[(&str, &str)]) -> String {
    locale(tag).fill(key, values)
}

async fn enter_code(browser: &Browser, code: &DeviceCodeResponse, typed: &str) -> Page {
    let entry = browser
        .get(&Url::parse(&code.verification_uri).expect("verification uri"))
        .await;
    assert_eq!(entry.status, 200, "{}", entry.body);
    browser.submit(&form(&entry), &[("user_code", typed)]).await
}

async fn sign_in_email(smtp: &MockSmtp, count: usize) -> CapturedEmail {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let found: Vec<CapturedEmail> = smtp
            .messages()
            .into_iter()
            .filter(|email| email.subject().starts_with("Sign in to"))
            .collect();
        if found.len() >= count {
            return found[count - 1].clone();
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
async fn the_landing_page_follows_the_browser_language() {
    let setup = setup("", false).await;
    let server = setup.server_name();
    let url = Url::parse(&format!(
        "{}/p/01920000-0000-7000-8000-0000000000aa",
        setup.server.url()
    ))
    .expect("landing url");
    let page = Browser::speaking("de-DE,de;q=0.9,en;q=0.8").get(&url).await;
    assert_eq!(page.status, 200, "{}", page.body);
    in_language(&page, "de");
    shows(&page, "de", Key::LandingTitle, &[]);
    shows(&page, "de", Key::LandingBody, &[("server", &server)]);
    shows(&page, "de", Key::LandingNext, &[]);
    shows(&page, "de", Key::LandingOpen, &[]);
    shows(&page, "de", Key::LandingGet, &[]);
    let english = Browser::new().get(&url).await;
    in_language(&english, "en");
    assert!(text_of(&english).contains("A shared Oleafly project"));
    let unknown = Browser::speaking("tlh, xx;q=0.5").get(&url).await;
    in_language(&unknown, "en");
}

#[tokio::test]
async fn the_code_pages_follow_the_browser_language() {
    let setup = setup("mallory", false).await;
    let server = setup.server_name();
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::speaking("fr-CA, en;q=0.5");
    let entry = browser
        .get(&Url::parse(&code.verification_uri).expect("uri"))
        .await;
    in_language(&entry, "fr");
    shows(&entry, "fr", Key::SignInTitle, &[("server", &server)]);
    shows(&entry, "fr", Key::CodeEnter, &[]);
    assert_eq!(form(&entry).label, label("fr", Key::Continue, &[]));
    let wrong = browser
        .submit(&form(&entry), &[("user_code", "BBBB-BBBB")])
        .await;
    assert_eq!(wrong.status, 400);
    in_language(&wrong, "fr");
    shows(&wrong, "fr", Key::CodeWrong, &[]);
    let confirm = browser
        .submit(&form(&entry), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    in_language(&confirm, "fr");
    shows(
        &confirm,
        "fr",
        Key::CodeAsked,
        &[("device", "Lab PC (Linux)")],
    );
    shows(&confirm, "fr", Key::CodeOnlyIfYou, &[]);
    shows(&confirm, "fr", Key::CodeDeny, &[]);
    let with_github = label("fr", Key::ContinueWith, &[("provider", "GitHub")]);
    let started = browser
        .submit(&form_labelled(&confirm, &with_github), &[])
        .await;
    let done = browser.follow(started, "oleafly://").await;
    assert_eq!(done.status, 200, "{}", done.body);
    in_language(&done, "fr");
    shows(&done, "fr", Key::CodeDoneTitle, &[]);
    shows(
        &done,
        "fr",
        Key::CodeDoneBody,
        &[("device", "Lab PC (Linux)")],
    );
}

#[tokio::test]
async fn stopping_a_code_sign_in_is_confirmed_in_the_browser_language() {
    let setup = setup("mallory", false).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::speaking("es-MX");
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let stopped = browser
        .submit(
            &form_labelled(&confirm, &label("es", Key::CodeDeny, &[])),
            &[],
        )
        .await;
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    in_language(&stopped, "es");
    shows(&stopped, "es", Key::CodeStoppedTitle, &[]);
    shows(&stopped, "es", Key::CodeStoppedBody, &[]);
}

#[tokio::test]
async fn too_many_wrong_codes_are_reported_in_the_browser_language() {
    let setup = setup("mallory", false).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::speaking("it");
    let mut last = enter_code(&browser, &code, "BBBB-BBBB").await;
    for _ in 0..10 {
        last = enter_code(&browser, &code, "BBBB-BBBB").await;
    }
    assert_eq!(last.status, 429, "{}", last.body);
    in_language(&last, "it");
    shows(&last, "it", Key::CodeLockedTitle, &[]);
    shows(&last, "it", Key::CodeLockedBody, &[]);
}

#[tokio::test]
async fn a_refused_person_reads_why_in_the_browser_language() {
    let setup = setup("", false).await;
    let server = setup.server_name();
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::speaking("pl-PL");
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let with_github = label("pl", Key::ContinueWith, &[("provider", "GitHub")]);
    let started = browser
        .submit(&form_labelled(&confirm, &with_github), &[])
        .await;
    let refused = browser.follow(started, "oleafly://").await;
    assert_eq!(refused.status, 403, "{}", refused.body);
    in_language(&refused, "pl");
    shows(&refused, "pl", Key::RefusedTitle, &[]);
    shows(
        &refused,
        "pl",
        Key::RefusedProviderAdvice,
        &[("provider", "GitHub")],
    );
    let named = locale("pl").fill_html(
        Key::RefusedProviderAccount,
        &[
            ("provider", "GitHub"),
            ("account", "<strong>@mallory</strong>"),
            ("server", &server),
        ],
    );
    assert!(refused.body.contains(&named), "{}", refused.body);
}

#[tokio::test]
async fn a_provider_link_from_another_browser_fails_in_that_browser_language() {
    let setup = setup("mallory", false).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let starter = Browser::new();
    let confirm = enter_code(&starter, &code, &code.user_code).await;
    let started = starter
        .submit(&form_labelled(&confirm, "GitHub"), &[])
        .await;
    let link = started.location.expect("the provider sign-in address");
    let other = Browser::speaking("ru");
    let at_provider = other.get(&link).await;
    let done = other.follow(at_provider, "oleafly://").await;
    assert_eq!(done.status, 400, "{}", done.body);
    in_language(&done, "ru");
    shows(&done, "ru", Key::NotFinishedTitle, &[]);
    let reason = locale("ru").auth_error(AuthErrorCode::InvalidCode);
    shows(
        &done,
        "ru",
        Key::CodeRetry,
        &[("reason", reason), ("link", &code.verification_uri)],
    );
}

#[tokio::test]
async fn a_server_with_no_sign_in_option_says_so_in_the_browser_language() {
    let server = TestServer::start(test_config()).await;
    let device = TestDevice::generate();
    let code = request_code(&server, &device, None).await.expect("a code");
    let confirm = enter_code(&Browser::speaking("cs"), &code, &code.user_code).await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    in_language(&confirm, "cs");
    shows(&confirm, "cs", Key::CodeNoProviders, &[]);
}

#[tokio::test]
async fn the_email_pages_follow_the_browser_language() {
    let setup = setup("ada@uni.edu", true).await;
    let server = setup.server_name();
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::speaking("sv-SE,sv;q=0.9");
    let start = browser.get(&attempt.start_url).await;
    assert_eq!(start.status, 200, "{}", start.body);
    in_language(&start, "sv");
    shows(&start, "sv", Key::SignInTitle, &[("server", &server)]);
    shows(
        &start,
        "sv",
        Key::EmailEnterAddress,
        &[("device", "Test laptop (macOS)")],
    );
    shows(&start, "sv", Key::EmailAddressLabel, &[]);
    assert_eq!(form(&start).label, label("sv", Key::EmailSend, &[]));
    let bad = browser
        .submit(&form(&start), &[("email", "not an address")])
        .await;
    assert_eq!(bad.status, 400, "{}", bad.body);
    in_language(&bad, "sv");
    shows(&bad, "sv", Key::EmailInvalidAddress, &[]);
    let sent = browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    assert_eq!(sent.status, 200, "{}", sent.body);
    in_language(&sent, "sv");
    shows(&sent, "sv", Key::EmailSentTitle, &[]);
    shows(
        &sent,
        "sv",
        Key::EmailSentBody,
        &[("address", "ada@uni.edu")],
    );
    shows(&sent, "sv", Key::EmailSentSameDevice, &[]);
    let link = link_in(&sign_in_email(setup.smtp(), 1).await);
    let reader = Browser::speaking("nb");
    let confirm = reader.get(&link).await;
    assert_eq!(confirm.status, 200, "{}", confirm.body);
    in_language(&confirm, "nb");
    shows(
        &confirm,
        "nb",
        Key::EmailFinish,
        &[("device", "Test laptop (macOS)")],
    );
    assert_eq!(form(&confirm).label, label("nb", Key::SignInButton, &[]));
    let back = reader.submit(&form(&confirm), &[]).await;
    assert_eq!(back.status, 302, "{}", back.body);
    let used = Browser::speaking("ro").get(&link).await;
    assert_eq!(used.status, 400, "{}", used.body);
    in_language(&used, "ro");
    shows(&used, "ro", Key::LinkUsedTitle, &[]);
    shows(&used, "ro", Key::LinkUsedBody, &[]);
}

#[tokio::test]
async fn broken_and_expired_links_are_explained_in_the_browser_language() {
    let setup = setup("ada@uni.edu", true).await;
    let mut broken =
        Url::parse(&format!("{}/auth/email-link/verify", setup.server.url())).expect("verify url");
    broken.query_pairs_mut().append_pair("token", "nope");
    let invalid = Browser::speaking("fi").get(&broken).await;
    assert_eq!(invalid.status, 400, "{}", invalid.body);
    in_language(&invalid, "fi");
    shows(&invalid, "fi", Key::LinkInvalidTitle, &[]);
    shows(&invalid, "fi", Key::LinkInvalidBody, &[]);
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::new();
    let start = browser.get(&attempt.start_url).await;
    browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    let link = link_in(&sign_in_email(setup.smtp(), 1).await);
    setup.server.clock().advance(16 * MINUTE_MS);
    let late = Browser::speaking("tr").get(&link).await;
    assert_eq!(late.status, 400, "{}", late.body);
    in_language(&late, "tr");
    shows(&late, "tr", Key::LinkExpiredTitle, &[]);
    shows(&late, "tr", Key::LinkExpiredBody, &[]);
}

#[tokio::test]
async fn expired_pages_and_limits_are_explained_in_the_browser_language() {
    let setup = setup("ada@uni.edu", true).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let browser = Browser::speaking("da");
    let start = browser.get(&attempt.start_url).await;
    let gone = browser
        .submit(
            &form(&start),
            &[("pending", "nope"), ("email", "ada@uni.edu")],
        )
        .await;
    assert_eq!(gone.status, 400, "{}", gone.body);
    in_language(&gone, "da");
    shows(&gone, "da", Key::SignInExpiredTitle, &[]);
    shows(&gone, "da", Key::SignInExpiredBody, &[]);
    let mut limited = browser
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    for _ in 0..3 {
        limited = browser
            .submit(&form(&start), &[("email", "ada@uni.edu")])
            .await;
    }
    assert_eq!(limited.status, 429, "{}", limited.body);
    in_language(&limited, "da");
    shows(&limited, "da", Key::TooManyEmailsTitle, &[]);
    shows(&limited, "da", Key::TooManyEmailsBody, &[]);
    let forged = Browser::speaking("cs")
        .submit(&form(&start), &[("email", "ada@uni.edu")])
        .await;
    assert_eq!(forged.status, 403, "{}", forged.body);
    in_language(&forged, "cs");
    shows(&forged, "cs", Key::PageExpiredTitle, &[]);
    shows(&forged, "cs", Key::PageExpiredBody, &[]);
    let other = SignInAttempt::new(&setup.server, "email-link", &device, None);
    let late = Browser::speaking("uk");
    let page = late.get(&other.start_url).await;
    set_email_link(&setup.server, false).await;
    let off = late.submit(&form(&page), &[("email", "ada@uni.edu")]).await;
    assert_eq!(off.status, 400, "{}", off.body);
    in_language(&off, "uk");
    shows(&off, "uk", Key::EmailOffTitle, &[]);
    shows(&off, "uk", Key::EmailOffBody, &[]);
}

#[tokio::test]
async fn an_emailed_link_for_a_code_sign_in_follows_the_browser_language() {
    let setup = setup("dana@uni.edu", true).await;
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::speaking("ko");
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let with_email = label("ko", Key::ContinueWithEmail, &[]);
    let ask = browser
        .submit(&form_labelled(&confirm, &with_email), &[])
        .await;
    assert_eq!(ask.status, 200, "{}", ask.body);
    in_language(&ask, "ko");
    let sent = browser
        .submit(&form(&ask), &[("email", "dana@uni.edu")])
        .await;
    in_language(&sent, "ko");
    shows(&sent, "ko", Key::EmailSentOtherDevice, &[]);
    let phone = Browser::speaking("ja-JP");
    let link = link_in(&sign_in_email(setup.smtp(), 1).await);
    let typed = phone.get(&link).await;
    assert_eq!(typed.status, 200, "{}", typed.body);
    in_language(&typed, "ja");
    shows(&typed, "ja", Key::EmailTypeCode, &[]);
    shows(&typed, "ja", Key::EmailOnlyIfYou, &[]);
    shows(&typed, "ja", Key::CodeLabel, &[]);
    let wrong = phone
        .submit(&form(&typed), &[("user_code", "BBBB-BBBB")])
        .await;
    assert_eq!(wrong.status, 400, "{}", wrong.body);
    in_language(&wrong, "ja");
    shows(&wrong, "ja", Key::CodeWrong, &[]);
    setup.server.clock().advance(11 * MINUTE_MS);
    let late = phone
        .submit(&form(&typed), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(late.status, 400, "{}", late.body);
    in_language(&late, "ja");
    shows(&late, "ja", Key::CodeExpiredTitle, &[]);
    shows(&late, "ja", Key::CodeExpiredBody, &[]);
}

#[tokio::test]
async fn a_turned_away_address_is_named_in_the_browser_language() {
    let setup = setup("dana@uni.edu", true).await;
    let server = setup.server_name();
    let device = TestDevice::generate();
    let code = request_code(&setup.server, &device, None)
        .await
        .expect("a code");
    let browser = Browser::new();
    let confirm = enter_code(&browser, &code, &code.user_code).await;
    let ask = browser.submit(&form_labelled(&confirm, "Email"), &[]).await;
    browser
        .submit(&form(&ask), &[("email", "dave@else.where")])
        .await;
    let phone = Browser::speaking("nl-BE");
    let typed = phone
        .get(&link_in(&sign_in_email(setup.smtp(), 1).await))
        .await;
    let refused = phone
        .submit(&form(&typed), &[("user_code", code.user_code.as_str())])
        .await;
    assert_eq!(refused.status, 403, "{}", refused.body);
    in_language(&refused, "nl");
    shows(&refused, "nl", Key::RefusedTitle, &[]);
    shows(&refused, "nl", Key::RefusedEmailAdvice, &[]);
    let named = locale("nl").fill_html(
        Key::RefusedEmailAccount,
        &[
            ("account", "<strong>dave@else.where</strong>"),
            ("server", &server),
        ],
    );
    assert!(refused.body.contains(&named), "{}", refused.body);
}

#[tokio::test]
async fn sign_in_dead_ends_follow_the_browser_language() {
    let setup = setup("", false).await;
    let device = TestDevice::generate();
    let attempt = SignInAttempt::new(&setup.server, "github", &device, None);
    let mut start = attempt.start_url.clone();
    let pairs: Vec<(String, String)> = attempt
        .start_url
        .query_pairs()
        .map(|(name, value)| {
            let value = if name == "redirect_uri" {
                "https://evil.example/callback".to_owned()
            } else {
                value.into_owned()
            };
            (name.into_owned(), value)
        })
        .collect();
    start.query_pairs_mut().clear().extend_pairs(pairs);
    let bad = Browser::speaking("zh-TW").get(&start).await;
    assert_eq!(bad.status, 400, "{}", bad.body);
    in_language(&bad, "zh-Hant");
    shows(&bad, "zh-Hant", Key::BadLinkTitle, &[]);
    shows(&bad, "zh-Hant", Key::BadLinkBody, &[]);
    let callback = Url::parse(&format!(
        "{}/auth/callback/github?state=nope&code=x",
        setup.server.url()
    ))
    .expect("callback");
    let over = Browser::speaking("zh-CN,zh;q=0.9").get(&callback).await;
    assert_eq!(over.status, 400, "{}", over.body);
    in_language(&over, "zh-Hans");
    shows(&over, "zh-Hans", Key::OverTitle, &[]);
    shows(&over, "zh-Hans", Key::OverBody, &[]);
}
