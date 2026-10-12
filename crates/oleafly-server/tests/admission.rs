use axum::body::Body;
use axum::http::{header, Method, Request};
use oleafly_collab_protocol::admin::{
    AllowlistMatcher, MemberPatch, MemberStatus, NewAllowlistEntry, NewDomainRule,
    RuntimeSettingsPatch, SecurityEventKind,
};
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::crypto::pkce_s256;
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::auth::admission::{self, Admission, Applied, Via};
use oleafly_server::auth::oidc::OidcProvider;
use oleafly_server::auth::{ExternalIdentity, IdentityProvider};
use oleafly_server::clock::Clock;
use oleafly_server::config::ProviderConfig;
use oleafly_server::state::setup_code_hash;
use oleafly_server::test_support::{
    allowlist, authorization_code, oidc_provider, seed_member, sign_in, test_app_with, test_config,
    MockOidc, MockOidcUser, TestApp, TestDevice, TestServer, TEST_SETUP_CODE,
};
use oleafly_server::tokens::random_token;
use oleafly_server::{guests, members, projects, security_log, settings};
use serde_json::{json, Value};
use tower::ServiceExt;
use url::Url;

async fn app_with_github() -> TestApp {
    let mut config = test_config();
    config.providers.push(ProviderConfig::Github {
        id: "github".to_owned(),
        label: "GitHub".to_owned(),
        client_id: "client".to_owned(),
        client_secret: "secret".to_owned(),
        web_url: Url::parse("https://github.com").expect("web url"),
        api_url: Url::parse("https://api.github.com").expect("api url"),
    });
    test_app_with(config).await
}

async fn admin_call(app: &TestApp, token: &str, method: Method, path: &str, body: Value) {
    let request = Request::builder()
        .method(method.clone())
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("request");
    let response = app.router.clone().oneshot(request).await.expect("response");
    assert!(
        response.status().is_success(),
        "{method} {path} answered {}",
        response.status()
    );
}

async fn allow(app: &TestApp, token: &str, matcher: AllowlistMatcher) {
    let entry = NewAllowlistEntry {
        matcher,
        role: ServerRole::Member,
    };
    let body = serde_json::to_value(entry).expect("entry json");
    admin_call(app, token, Method::POST, "/api/v1/admin/allowlist", body).await;
}

fn github(subject: &str, login: &str, emails: &[&str]) -> ExternalIdentity {
    ExternalIdentity {
        provider_id: "github".to_owned(),
        issuer: "https://github.com".to_owned(),
        subject: subject.to_owned(),
        login: Some(login.to_owned()),
        display_name: login.to_owned(),
        avatar_url: None,
        verified_emails: emails.iter().map(|email| (*email).to_owned()).collect(),
    }
}

async fn decide(
    app: &TestApp,
    identity: &ExternalIdentity,
    setup_hash: Option<String>,
) -> Admission {
    let identity = identity.clone();
    app.state
        .db
        .call(move |conn| admission::decide(conn, &identity, setup_hash.as_deref()))
        .await
        .expect("decide")
}

async fn admit(app: &TestApp, identity: &ExternalIdentity, setup_hash: Option<String>) -> Applied {
    let identity = identity.clone();
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let decision = admission::decide(conn, &identity, setup_hash.as_deref())?;
            admission::apply(conn, &identity, decision, 20, now)
        })
        .await
        .expect("admit")
}

async fn oidc_identity(email_verified: Option<Value>, trust_email: bool) -> ExternalIdentity {
    let mock = MockOidc::start(vec![MockOidcUser {
        subject: "uni-user-77".to_owned(),
        name: "Alice Chen".to_owned(),
        email: Some("alice@uni.edu".to_owned()),
        email_verified,
    }])
    .await;
    let provider = OidcProvider::new(
        "uni".to_owned(),
        mock.issuer().to_string(),
        "client-1".to_owned(),
        "secret-1".to_owned(),
        trust_email,
        reqwest::Client::new(),
    );
    let redirect = Url::parse("https://collab.test/auth/callback/uni").expect("redirect");
    let verifier = random_token();
    let nonce = random_token();
    let authorize = provider
        .authorize_url("state-1", &redirect, &pkce_s256(&verifier), &nonce)
        .await
        .expect("authorize url");
    let code = authorization_code(&authorize).await;
    provider
        .exchange(&code, &redirect, &verifier, &nonce)
        .await
        .expect("identity")
}

#[tokio::test]
async fn an_email_entry_matches_any_case() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    allow(
        &app,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "Alice@Uni.EDU".to_owned(),
        },
    )
    .await;
    let decision = decide(&app, &github("1001", "someone", &["alice@uni.edu"]), None).await;
    assert!(matches!(
        decision,
        Admission::Allowlisted {
            role: ServerRole::Member,
            ..
        }
    ));
}

#[tokio::test]
async fn a_handle_entry_binds_to_the_first_github_id() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "Alice-Chen".to_owned(),
    };
    allow(&app, &admin.access_token, matcher).await;
    let alice = github("1001", "alice-chen", &[]);
    let Applied::Admitted(admitted) = admit(&app, &alice, None).await else {
        panic!("alice was refused");
    };
    assert!(admitted.new_account);
    assert_eq!(admitted.via, Via::Allowlist);
    let entry = app
        .state
        .db
        .call(|conn| members::find_allowlist_by_login(conn, "github", "alice-chen"))
        .await
        .expect("lookup")
        .expect("entry");
    assert_eq!(entry.bound_account, Some(admitted.account_id));
    let impostor = github("2002", "alice-chen", &[]);
    assert!(matches!(
        decide(&app, &impostor, None).await,
        Admission::NotAdmitted
    ));
    assert!(matches!(
        decide(&app, &alice, None).await,
        Admission::Linked { account_id } if account_id == admitted.account_id
    ));
}

#[tokio::test]
async fn an_unverified_email_never_admits() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    allow(
        &app,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "bob@uni.edu".to_owned(),
        },
    )
    .await;
    let decision = decide(&app, &github("3003", "bob", &[]), None).await;
    assert!(matches!(decision, Admission::NotAdmitted));
}

#[tokio::test]
async fn oidc_emails_admit_only_when_verified_or_trusted() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    allow(
        &app,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "Alice@Uni.EDU".to_owned(),
        },
    )
    .await;
    let verified = oidc_identity(Some(json!(true)), false).await;
    assert!(matches!(
        decide(&app, &verified, None).await,
        Admission::Allowlisted { .. }
    ));
    for claim in [
        None,
        Some(json!("true")),
        Some(json!(1)),
        Some(json!(false)),
    ] {
        let identity = oidc_identity(claim, false).await;
        assert!(identity.verified_emails.is_empty());
        assert!(matches!(
            decide(&app, &identity, None).await,
            Admission::NotAdmitted
        ));
    }
    let trusted = oidc_identity(None, true).await;
    assert!(matches!(
        decide(&app, &trusted, None).await,
        Admission::Allowlisted { .. }
    ));
}

#[tokio::test]
async fn a_domain_rule_admits_verified_addresses_of_that_exact_domain() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let rule = NewDomainRule {
        domain: "cs.uni.edu".to_owned(),
        role: ServerRole::Member,
    };
    let body = serde_json::to_value(rule).expect("rule json");
    admin_call(
        &app,
        &admin.access_token,
        Method::POST,
        "/api/v1/admin/domains",
        body,
    )
    .await;
    let dana = github("4004", "dana", &["dana@CS.Uni.edu"]);
    assert!(matches!(
        decide(&app, &dana, None).await,
        Admission::Domain {
            role: ServerRole::Member,
            existing: None
        }
    ));
    let parent = github("5005", "erin", &["erin@uni.edu"]);
    assert!(matches!(
        decide(&app, &parent, None).await,
        Admission::NotAdmitted
    ));
}

#[tokio::test]
async fn a_suspended_account_is_refused() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "frank".to_owned(),
    };
    allow(&app, &admin.access_token, matcher).await;
    let frank = github("6006", "frank", &[]);
    let Applied::Admitted(admitted) = admit(&app, &frank, None).await else {
        panic!("frank was refused");
    };
    let patch = MemberPatch {
        role: None,
        status: Some(MemberStatus::Suspended),
    };
    let path = format!("/api/v1/admin/members/{}", admitted.account_id);
    let body = serde_json::to_value(patch).expect("patch json");
    admin_call(&app, &admin.access_token, Method::PATCH, &path, body).await;
    assert!(matches!(
        decide(&app, &frank, None).await,
        Admission::Suspended
    ));
    assert!(matches!(
        admit(&app, &frank, None).await,
        Applied::Refused {
            code: AuthErrorCode::NotAdmitted,
            reason: "suspended"
        }
    ));
}

#[tokio::test]
async fn the_setup_code_admits_the_first_admin_once() {
    let app = app_with_github().await;
    let carol = github("7007", "carol", &[]);
    assert!(matches!(
        decide(&app, &carol, Some(setup_code_hash("WRONG-CODE"))).await,
        Admission::SetupCodeInvalid
    ));
    let lowercase = setup_code_hash(&TEST_SETUP_CODE.to_lowercase());
    let Applied::Admitted(admitted) = admit(&app, &carol, Some(lowercase)).await else {
        panic!("carol was refused");
    };
    assert_eq!(admitted.via, Via::Setup);
    assert!(admitted.new_account);
    let admins = app
        .state
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .expect("admins");
    assert_eq!(admins, 1);
    let dave = github("8008", "dave", &[]);
    assert!(matches!(
        decide(&app, &dave, Some(setup_code_hash(TEST_SETUP_CODE))).await,
        Admission::SetupCodeInvalid
    ));
    assert!(matches!(
        decide(&app, &dave, None).await,
        Admission::NotAdmitted
    ));
}

async fn remove(app: &TestApp, token: &str, account: oleafly_collab_protocol::ids::AccountId) {
    let path = format!("/api/v1/admin/members/{account}");
    admin_call(app, token, Method::DELETE, &path, Value::Null).await;
}

#[tokio::test]
async fn a_removed_member_who_is_not_added_again_is_refused() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "grace".to_owned(),
    };
    allow(&app, &admin.access_token, matcher).await;
    let grace = github("9009", "grace", &["grace@uni.edu"]);
    let Applied::Admitted(first) = admit(&app, &grace, None).await else {
        panic!("grace was refused");
    };
    remove(&app, &admin.access_token, first.account_id).await;
    assert!(matches!(
        decide(&app, &grace, None).await,
        Admission::NotAdmitted
    ));
    assert!(matches!(
        admit(&app, &grace, None).await,
        Applied::Refused {
            code: AuthErrorCode::NotAdmitted,
            reason: "not_admitted"
        }
    ));
    let status = app
        .state
        .db
        .call(move |conn| members::account_status(conn, first.account_id))
        .await
        .expect("status");
    assert_eq!(status, Some(MemberStatus::Removed));
}

#[tokio::test]
async fn a_removed_member_added_again_gets_the_same_account() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "grace".to_owned(),
    };
    allow(&app, &admin.access_token, matcher.clone()).await;
    let grace = github("9009", "grace", &["grace@uni.edu"]);
    let Applied::Admitted(first) = admit(&app, &grace, None).await else {
        panic!("grace was refused");
    };
    remove(&app, &admin.access_token, first.account_id).await;
    allow(&app, &admin.access_token, matcher).await;
    assert!(matches!(
        decide(&app, &grace, None).await,
        Admission::Allowlisted { existing: Some(account), .. } if account == first.account_id
    ));
    let Applied::Admitted(again) = admit(&app, &grace, None).await else {
        panic!("grace was refused the second time");
    };
    assert_eq!(again.account_id, first.account_id);
    assert!(!again.new_account);
    assert!(again.reactivated);
    assert_eq!(again.via, Via::Allowlist);
    let (status, entry) = app
        .state
        .db
        .call(move |conn| {
            Ok((
                members::account_status(conn, first.account_id)?,
                members::find_allowlist_by_login(conn, "github", "grace")?,
            ))
        })
        .await
        .expect("lookup");
    assert_eq!(status, Some(MemberStatus::Active));
    assert_eq!(entry.expect("entry").bound_account, Some(first.account_id));
    assert!(
        matches!(decide(&app, &grace, None).await, Admission::Linked { account_id } if account_id == first.account_id)
    );
}

async fn admin_status(
    app: &TestApp,
    token: &str,
    path: &str,
    body: Value,
) -> axum::http::StatusCode {
    let request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("request");
    app.router
        .clone()
        .oneshot(request)
        .await
        .expect("response")
        .status()
}

#[tokio::test]
async fn a_domain_rule_does_not_bring_back_a_removed_member() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let rule = NewDomainRule {
        domain: "uni.edu".to_owned(),
        role: ServerRole::Member,
    };
    admin_call(
        &app,
        &admin.access_token,
        Method::POST,
        "/api/v1/admin/domains",
        serde_json::to_value(rule).expect("rule json"),
    )
    .await;
    let mallory = github("6006", "mallory", &["mallory@uni.edu"]);
    let Applied::Admitted(first) = admit(&app, &mallory, None).await else {
        panic!("mallory was refused");
    };
    assert_eq!(first.via, Via::Domain);
    remove(&app, &admin.access_token, first.account_id).await;
    assert!(matches!(
        decide(&app, &mallory, None).await,
        Admission::NotAdmitted
    ));
    let newcomer = github("6007", "nadia", &["nadia@uni.edu"]);
    assert!(matches!(
        decide(&app, &newcomer, None).await,
        Admission::Domain { existing: None, .. }
    ));
    allow(
        &app,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "mallory@uni.edu".to_owned(),
        },
    )
    .await;
    let Applied::Admitted(again) = admit(&app, &mallory, None).await else {
        panic!("mallory was refused after being added again");
    };
    assert_eq!(again.account_id, first.account_id);
    assert_eq!(again.via, Via::Allowlist);
}

#[tokio::test]
async fn name_entries_are_refused_for_openid_connect_providers() {
    let mut config = test_config();
    config.providers.push(ProviderConfig::Github {
        id: "github".to_owned(),
        label: "GitHub".to_owned(),
        client_id: "client".to_owned(),
        client_secret: "secret".to_owned(),
        web_url: Url::parse("https://github.com").expect("web url"),
        api_url: Url::parse("https://api.github.com").expect("api url"),
    });
    config.providers.push(ProviderConfig::Oidc {
        id: "uni".to_owned(),
        label: "University login".to_owned(),
        issuer: "https://sso.uni.example".to_owned(),
        client_id: "client-1".to_owned(),
        client_secret: "secret-1".to_owned(),
        trust_email: false,
    });
    let app = test_app_with(config).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let entry = |provider: &str| {
        serde_json::to_value(NewAllowlistEntry {
            matcher: AllowlistMatcher::ProviderLogin {
                provider: provider.to_owned(),
                login: "alice".to_owned(),
            },
            role: ServerRole::Member,
        })
        .expect("entry json")
    };
    assert_eq!(
        admin_status(
            &app,
            &admin.access_token,
            "/api/v1/admin/allowlist",
            entry("uni")
        )
        .await,
        axum::http::StatusCode::BAD_REQUEST
    );
    assert_eq!(
        admin_status(
            &app,
            &admin.access_token,
            "/api/v1/admin/allowlist",
            entry("github")
        )
        .await,
        axum::http::StatusCode::CREATED
    );
}

#[tokio::test]
async fn a_valid_setup_code_makes_the_first_admin_even_when_a_rule_also_matches() {
    let app = app_with_github().await;
    app.state
        .db
        .call(|conn| {
            let rule = NewDomainRule {
                domain: "lab.test".to_owned(),
                role: ServerRole::Member,
            };
            members::add_domain_rule(conn, &rule, None, 0)?;
            Ok(())
        })
        .await
        .expect("seed a domain rule");
    let bob = github("9009", "bob", &["bob@lab.test"]);
    assert!(matches!(
        decide(&app, &bob, Some(setup_code_hash(TEST_SETUP_CODE))).await,
        Admission::Setup { existing: None }
    ));
    assert!(matches!(
        decide(&app, &bob, Some(setup_code_hash("WRONG-CODE"))).await,
        Admission::Domain { .. }
    ));
}

struct Returning {
    decision: Admission,
    applied: Applied,
    status: Option<MemberStatus>,
    role: Option<ServerRole>,
    old_grant: Option<ProjectRole>,
    new_grant: Option<ProjectRole>,
}

async fn removed_then_invited(role: ServerRole) -> Returning {
    let app = app_with_github().await;
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let yara = members::create_account(conn, "Yara", None, ServerRole::Member, now)?;
            let xavi = members::create_account(conn, "Xavi", None, ServerRole::Member, now)?;
            let bob = members::create_account(conn, "Bob", None, role, now)?;
            members::link_identity(
                conn,
                bob,
                "github",
                "https://github.com",
                "42",
                Some("bob"),
                now,
            )?;
            members::add_verified_emails(conn, bob, &["bob@uni.edu".to_owned()])?;
            let thesis = projects::create_pending(conn, yara, "Yara thesis", now)?;
            projects::set_status(conn, thesis, ProjectStatus::Active, now)?;
            projects::grant(conn, thesis, bob, ProjectRole::Editor, yara, now)?;
            let paper = projects::create_pending(conn, xavi, "Xavi paper", now)?;
            projects::set_status(conn, paper, ProjectStatus::Active, now)?;
            members::remove_account(conn, bob, now)?;
            settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    guests_enabled: Some(true),
                    guest_approval_required: Some(false),
                    ..Default::default()
                },
            )?;
            guests::create(
                conn,
                paper,
                "bob@uni.edu",
                ProjectRole::Viewer,
                xavi,
                false,
                now,
            )?;
            let identity = github("42", "bob", &["bob@uni.edu"]);
            let decision = admission::decide(conn, &identity, None)?;
            let again = admission::decide(conn, &identity, None)?;
            let applied = admission::apply(conn, &identity, again, 20, now)?;
            Ok(Returning {
                decision,
                applied,
                status: members::account_status(conn, bob)?,
                role: members::account_role(conn, bob)?,
                old_grant: projects::role_of(conn, thesis, bob)?,
                new_grant: projects::role_of(conn, paper, bob)?,
            })
        })
        .await
        .expect("db")
}

#[tokio::test]
async fn a_member_removed_from_the_server_does_not_return_through_a_guest_invitation() {
    let returning = removed_then_invited(ServerRole::Member).await;
    assert!(matches!(returning.decision, Admission::NotAdmitted));
    assert!(matches!(
        returning.applied,
        Applied::Refused {
            code: AuthErrorCode::NotAdmitted,
            ..
        }
    ));
    assert_eq!(returning.status, Some(MemberStatus::Removed));
    assert_eq!(returning.role, Some(ServerRole::Member));
    assert_eq!(returning.old_grant, Some(ProjectRole::Editor));
    assert_eq!(returning.new_grant, None);
}

#[tokio::test]
async fn a_removed_guest_who_still_has_projects_does_not_return_through_a_new_invitation() {
    let returning = removed_then_invited(ServerRole::Guest).await;
    assert!(matches!(returning.decision, Admission::NotAdmitted));
    assert_eq!(returning.status, Some(MemberStatus::Removed));
    assert_eq!(returning.new_grant, None);
}

#[tokio::test]
async fn a_removed_member_added_again_gets_their_old_projects_back() {
    let app = app_with_github().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github".to_owned(),
        login: "grace".to_owned(),
    };
    allow(&app, &admin.access_token, matcher.clone()).await;
    let grace = github("9009", "grace", &["grace@uni.edu"]);
    let Applied::Admitted(first) = admit(&app, &grace, None).await else {
        panic!("grace was refused");
    };
    let account = first.account_id;
    let now = app.clock.now_ms();
    let thesis = app
        .state
        .db
        .call(move |conn| {
            let owner = members::create_account(conn, "Yara", None, ServerRole::Member, now)?;
            let thesis = projects::create_pending(conn, owner, "Thesis", now)?;
            projects::set_status(conn, thesis, ProjectStatus::Active, now)?;
            projects::grant(conn, thesis, account, ProjectRole::Editor, owner, now)?;
            Ok(thesis)
        })
        .await
        .expect("grant");
    remove(&app, &admin.access_token, account).await;
    allow(&app, &admin.access_token, matcher).await;
    let Applied::Admitted(again) = admit(&app, &grace, None).await else {
        panic!("grace was refused the second time");
    };
    assert_eq!(again.account_id, account);
    let role = app
        .state
        .db
        .call(move |conn| projects::role_of(conn, thesis, account))
        .await
        .expect("role");
    assert_eq!(role, Some(ProjectRole::Editor));
}

const FORMER_ADDRESS: &str = "address_of_inactive_account";

fn mallory_at(subject: &str) -> MockOidcUser {
    MockOidcUser {
        subject: subject.to_owned(),
        name: "Mallory Reyes".to_owned(),
        email: Some("mallory@uni.edu".to_owned()),
        email_verified: Some(json!(true)),
    }
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

async fn refusal_reasons(server: &TestServer) -> Vec<Value> {
    server
        .state()
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("security log")
        .items
        .into_iter()
        .filter(|event| event.kind == SecurityEventKind::SignInRefused)
        .map(|event| event.detail["reason"].clone())
        .collect()
}

struct SecondIdentity {
    server: TestServer,
    admin: oleafly_server::test_support::SeededMember,
    first: oleafly_collab_protocol::ids::AccountId,
    refused: Option<String>,
    accounts_before: i64,
    _issuers: [MockOidc; 2],
}

async fn second_identity_after(status: MemberStatus) -> SecondIdentity {
    let uni = MockOidc::start(vec![mallory_at("uni-1")]).await;
    let lab = MockOidc::start(vec![mallory_at("lab-1")]).await;
    let mut config = test_config();
    config.providers.push(oidc_provider("uni", &uni, false));
    config.providers.push(oidc_provider("lab", &lab, false));
    let server = TestServer::start(config).await;
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    server
        .state()
        .db
        .call(|conn| {
            let rule = NewDomainRule {
                domain: "uni.edu".to_owned(),
                role: ServerRole::Member,
            };
            members::add_domain_rule(conn, &rule, None, 0)?;
            Ok(())
        })
        .await
        .expect("domain rule");
    let first = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .expect("the domain rule admits the first identity")
        .account_id;
    let now = server.clock().now_ms();
    server
        .state()
        .db
        .call(move |conn| match status {
            MemberStatus::Removed => members::remove_account(conn, first, now).map(|_| ()),
            other => members::set_status(conn, first, &other, now),
        })
        .await
        .expect("status");
    let accounts_before = account_count(&server).await;
    let refused = sign_in(&server, "lab", &TestDevice::generate(), None)
        .await
        .err();
    SecondIdentity {
        server,
        admin,
        first,
        refused,
        accounts_before,
        _issuers: [uni, lab],
    }
}

async fn status_of(
    server: &TestServer,
    account: oleafly_collab_protocol::ids::AccountId,
) -> Option<MemberStatus> {
    server
        .state()
        .db
        .call(move |conn| members::account_status(conn, account))
        .await
        .expect("status")
}

#[tokio::test]
async fn a_removed_member_gets_no_new_account_from_a_domain_rule_under_a_second_identity() {
    let second = second_identity_after(MemberStatus::Removed).await;
    assert_eq!(second.refused.as_deref(), Some("not_admitted"));
    assert_eq!(account_count(&second.server).await, second.accounts_before);
    assert!(refusal_reasons(&second.server)
        .await
        .contains(&json!(FORMER_ADDRESS)));
    assert_eq!(
        status_of(&second.server, second.first).await,
        Some(MemberStatus::Removed)
    );
    let newcomer = github("7101", "nadia", &["nadia@uni.edu"]);
    assert!(matches!(
        decide(second.server.app(), &newcomer, None).await,
        Admission::Domain { existing: None, .. }
    ));
}

#[tokio::test]
async fn a_suspended_member_gets_no_new_account_from_a_domain_rule_under_a_second_identity() {
    let second = second_identity_after(MemberStatus::Suspended).await;
    assert_eq!(second.refused.as_deref(), Some("not_admitted"));
    assert_eq!(account_count(&second.server).await, second.accounts_before);
    assert!(refusal_reasons(&second.server)
        .await
        .contains(&json!(FORMER_ADDRESS)));
    assert_eq!(
        status_of(&second.server, second.first).await,
        Some(MemberStatus::Suspended)
    );
}

#[tokio::test]
async fn an_allowlist_entry_for_the_address_still_brings_a_removed_member_back_to_their_old_account(
) {
    let second = second_identity_after(MemberStatus::Removed).await;
    allowlist(
        &second.server,
        &second.admin.access_token,
        AllowlistMatcher::Email {
            email: "mallory@uni.edu".to_owned(),
        },
        ServerRole::Member,
    )
    .await;
    let elsewhere = ExternalIdentity {
        provider_id: "lab".to_owned(),
        issuer: "https://lab.example".to_owned(),
        subject: "lab-1".to_owned(),
        login: None,
        display_name: "Mallory Reyes".to_owned(),
        avatar_url: None,
        verified_emails: vec!["mallory@uni.edu".to_owned()],
    };
    assert!(matches!(
        decide(second.server.app(), &elsewhere, None).await,
        Admission::Allowlisted { existing: None, .. }
    ));
    let back = sign_in(&second.server, "uni", &TestDevice::generate(), None)
        .await
        .expect("the allowlist lets them back in");
    assert_eq!(back.account_id, second.first);
    assert_eq!(
        status_of(&second.server, second.first).await,
        Some(MemberStatus::Active)
    );
}

struct InvitedElsewhere {
    applied: Applied,
    accounts_before: i64,
    accounts_after: i64,
}

async fn inactive_then_invited_under_another_identity(
    role: ServerRole,
    status: MemberStatus,
) -> InvitedElsewhere {
    let app = app_with_github().await;
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let count = |conn: &rusqlite::Connection| {
                conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| {
                    row.get::<_, i64>(0)
                })
            };
            let xavi = members::create_account(conn, "Xavi", None, ServerRole::Member, now)?;
            let bob = members::create_account(conn, "Bob", None, role, now)?;
            members::link_identity(
                conn,
                bob,
                "github",
                "https://github.com",
                "42",
                Some("bob"),
                now,
            )?;
            members::add_verified_emails(conn, bob, &["bob@uni.edu".to_owned()])?;
            match status {
                MemberStatus::Removed => {
                    members::remove_account(conn, bob, now)?;
                }
                other => members::set_status(conn, bob, &other, now)?,
            }
            let paper = projects::create_pending(conn, xavi, "Xavi paper", now)?;
            projects::set_status(conn, paper, ProjectStatus::Active, now)?;
            settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    guests_enabled: Some(true),
                    guest_approval_required: Some(false),
                    ..Default::default()
                },
            )?;
            guests::create(
                conn,
                paper,
                "bob@uni.edu",
                ProjectRole::Viewer,
                xavi,
                false,
                now,
            )?;
            let accounts_before = count(conn)?;
            let identity = github("43", "bob-elsewhere", &["bob@uni.edu"]);
            let decision = admission::decide(conn, &identity, None)?;
            let applied = admission::apply(conn, &identity, decision, 20, now)?;
            Ok(InvitedElsewhere {
                applied,
                accounts_before,
                accounts_after: count(conn)?,
            })
        })
        .await
        .expect("db")
}

#[tokio::test]
async fn a_removed_member_does_not_return_as_a_guest_under_a_second_identity() {
    let invited =
        inactive_then_invited_under_another_identity(ServerRole::Member, MemberStatus::Removed)
            .await;
    assert!(
        matches!(
            invited.applied,
            Applied::Refused {
                code: AuthErrorCode::NotAdmitted,
                reason: FORMER_ADDRESS
            }
        ),
        "{:?}",
        invited.applied
    );
    assert_eq!(invited.accounts_after, invited.accounts_before);
}

#[tokio::test]
async fn a_suspended_guest_does_not_return_as_a_guest_under_a_second_identity() {
    let invited =
        inactive_then_invited_under_another_identity(ServerRole::Guest, MemberStatus::Suspended)
            .await;
    assert!(
        matches!(
            invited.applied,
            Applied::Refused {
                code: AuthErrorCode::NotAdmitted,
                reason: FORMER_ADDRESS
            }
        ),
        "{:?}",
        invited.applied
    );
    assert_eq!(invited.accounts_after, invited.accounts_before);
}

#[tokio::test]
async fn a_guest_whose_projects_all_ended_may_accept_a_new_invitation_under_a_second_identity() {
    let invited =
        inactive_then_invited_under_another_identity(ServerRole::Guest, MemberStatus::Removed)
            .await;
    assert!(
        matches!(
            invited.applied,
            Applied::Admitted(admission::Admitted {
                via: Via::Guest,
                ..
            })
        ),
        "{:?}",
        invited.applied
    );
}
