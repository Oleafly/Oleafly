mod support;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use oleafly_collab_protocol::admin::{
    AllowlistMatcher, MemberStatus, RuntimeSettingsPatch, SecurityEventKind,
};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::outputs::MAIN_FILE_HEADER;
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::auth::admission::{self, Admission, Applied, Via};
use oleafly_server::auth::ExternalIdentity;
use oleafly_server::blobs::sha256_hex;
use oleafly_server::clock::Clock;
use oleafly_server::config::{AccountQuotas, ServerConfig};
use oleafly_server::quotas::UPLOAD_WINDOW_MS;
use oleafly_server::state::setup_code_hash;
use oleafly_server::test_support::{
    allowlist, oidc_provider, seed_member, sign_in, test_app_with, test_config, MockOidc,
    MockOidcUser, SeededMember, TestApp, TestDevice, TestServer,
};
use oleafly_server::{guests, members, projects, security_log, settings};
use serde_json::{json, Value};
use support::{send, send_post, Reply};
use tower::ServiceExt;

fn open_config() -> ServerConfig {
    let mut config = test_config();
    config.open_signup = true;
    config
}

fn newcomer(subject: &str, email: &str) -> MockOidcUser {
    MockOidcUser {
        subject: subject.to_owned(),
        name: "Nadia Park".to_owned(),
        email: Some(email.to_owned()),
        email_verified: Some(json!(true)),
    }
}

async fn server_with(open: bool, users: Vec<MockOidcUser>) -> (TestServer, MockOidc) {
    let issuer = MockOidc::start(users).await;
    let mut config = if open { open_config() } else { test_config() };
    config.providers.push(oidc_provider("uni", &issuer, false));
    (TestServer::start(config).await, issuer)
}

async fn sign_ins(server: &TestServer) -> Vec<Value> {
    server
        .state()
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("security log")
        .items
        .into_iter()
        .filter(|event| {
            matches!(
                event.kind,
                SecurityEventKind::SignIn | SecurityEventKind::SignInRefused
            )
        })
        .map(|event| event.detail)
        .collect()
}

fn identity(subject: &str, emails: &[&str]) -> ExternalIdentity {
    ExternalIdentity {
        provider_id: "github".to_owned(),
        issuer: "https://github.com".to_owned(),
        subject: subject.to_owned(),
        login: Some(format!("user-{subject}")),
        display_name: format!("User {subject}"),
        avatar_url: None,
        verified_emails: emails.iter().map(|email| (*email).to_owned()).collect(),
    }
}

async fn decide(
    app: &TestApp,
    identity: &ExternalIdentity,
    setup_hash: Option<String>,
    open: bool,
) -> Admission {
    let identity = identity.clone();
    app.state
        .db
        .call(move |conn| admission::decide(conn, &identity, setup_hash.as_deref(), open))
        .await
        .expect("decide")
}

#[tokio::test]
async fn open_sign_up_admits_anyone_who_signs_in_as_a_member() {
    let (server, _issuer) = server_with(true, vec![newcomer("uni-9", "nadia@uni.edu")]).await;
    let tokens = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .expect("open sign-up admits a stranger");
    let account = tokens.account_id;
    let (role, status) = server
        .state()
        .db
        .call(move |conn| {
            Ok((
                members::account_role(conn, account)?,
                members::account_status(conn, account)?,
            ))
        })
        .await
        .expect("account");
    assert_eq!(role, Some(ServerRole::Member));
    assert_eq!(status, Some(MemberStatus::Active));
    let details = sign_ins(&server).await;
    assert!(
        details
            .iter()
            .any(|detail| detail["via"] == "open_signup" && detail["new_account"] == true),
        "{details:?}"
    );
    let again = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .expect("the same person signs in again");
    assert_eq!(again.account_id, account);
}

#[tokio::test]
async fn without_open_sign_up_a_stranger_is_still_refused() {
    let (server, _issuer) = server_with(false, vec![newcomer("uni-9", "nadia@uni.edu")]).await;
    let refused = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .err();
    assert_eq!(refused.as_deref(), Some("not_admitted"));
    let details = sign_ins(&server).await;
    assert!(details.iter().all(|detail| detail["via"] != "open_signup"));
}

#[tokio::test]
async fn open_sign_up_never_brings_back_someone_the_admin_removed() {
    let (server, _issuer) = server_with(true, vec![newcomer("uni-9", "nadia@uni.edu")]).await;
    let first = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .expect("first sign-in")
        .account_id;
    let now = server.clock().now_ms();
    server
        .state()
        .db
        .call(move |conn| members::remove_account(conn, first, now).map(|_| ()))
        .await
        .expect("removed");
    let back = sign_in(&server, "uni", &TestDevice::generate(), None)
        .await
        .err();
    assert_eq!(back.as_deref(), Some("not_admitted"));
    let elsewhere = identity("7001", &["nadia@uni.edu"]);
    assert!(matches!(
        decide(server.app(), &elsewhere, None, true).await,
        Admission::NotAdmitted
    ));
    let someone_new = identity("7002", &["omar@uni.edu"]);
    assert!(matches!(
        decide(server.app(), &someone_new, None, true).await,
        Admission::Open
    ));
}

#[tokio::test]
async fn the_allowlist_and_setup_code_still_come_before_open_sign_up() {
    let server = TestServer::start(open_config()).await;
    let wrong = Some(setup_code_hash("WRONG-CODE-0000-0000"));
    let someone = identity("8001", &["ada@uni.edu"]);
    assert!(matches!(
        decide(server.app(), &someone, wrong, true).await,
        Admission::SetupCodeInvalid
    ));
    let admin = seed_member(server.app(), ServerRole::Admin).await;
    allowlist(
        &server,
        &admin.access_token,
        AllowlistMatcher::Email {
            email: "ada@uni.edu".to_owned(),
        },
        ServerRole::Maintainer,
    )
    .await;
    assert!(matches!(
        decide(server.app(), &someone, None, true).await,
        Admission::Allowlisted {
            role: ServerRole::Maintainer,
            ..
        }
    ));
}

#[tokio::test]
async fn an_invited_guest_who_signs_up_openly_becomes_a_member_with_the_project() {
    let app = test_app_with(open_config()).await;
    let now = app.clock.now_ms();
    let (applied, paper) = app
        .state
        .db
        .call(move |conn| {
            let xavi = members::create_account(conn, "Xavi", None, ServerRole::Member, now)?;
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
            let bob = identity("9001", &["bob@uni.edu"]);
            let decision = admission::decide(conn, &bob, None, true)?;
            Ok((
                admission::apply(conn, &bob, decision, 20, None, now)?,
                paper,
            ))
        })
        .await
        .expect("admit");
    let Applied::Admitted(admitted) = applied else {
        panic!("open sign-up refused an invited person");
    };
    assert_eq!(admitted.via, Via::Open);
    let account = admitted.account_id;
    let (role, project_role) = app
        .state
        .db
        .call(move |conn| {
            Ok((
                members::account_role(conn, account)?,
                projects::role_of(conn, paper, account)?,
            ))
        })
        .await
        .expect("read back");
    assert_eq!(role, Some(ServerRole::Member));
    assert_eq!(project_role, Some(ProjectRole::Viewer));
}

fn quota_config(quotas: AccountQuotas) -> ServerConfig {
    let mut config = test_config();
    config.quotas = quotas;
    config
}

async fn shared_project(app: &TestApp, owner: AccountId) -> SharedProjectId {
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, owner, "Thesis", now)?;
            projects::set_status(conn, project, ProjectStatus::Active, now)?;
            Ok(project)
        })
        .await
        .expect("a project")
}

async fn add_member(
    app: &TestApp,
    project: SharedProjectId,
    owner: AccountId,
    member: AccountId,
    role: ProjectRole,
) {
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| projects::grant(conn, project, member, role, owner, now))
        .await
        .expect("grant");
}

async fn put(
    app: &TestApp,
    path: &str,
    token: &str,
    bytes: Vec<u8>,
    main_file: Option<&str>,
) -> Reply {
    let mut builder = Request::builder()
        .method(Method::PUT)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_LENGTH, bytes.len());
    if let Some(main) = main_file {
        builder = builder.header(MAIN_FILE_HEADER, main);
    }
    let response = app
        .router
        .clone()
        .oneshot(builder.body(Body::from(bytes)).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body");
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status,
        headers,
        body,
    }
}

fn unique(size: usize, seed: u8) -> Vec<u8> {
    let salt = oleafly_server::tokens::random_token();
    let mut bytes: Vec<u8> = salt.into_bytes();
    bytes.extend((0..size).map(|at| (at as u8).wrapping_mul(31).wrapping_add(seed)));
    bytes.truncate(size.max(1));
    bytes
}

async fn put_blob(app: &TestApp, project: SharedProjectId, token: &str, bytes: Vec<u8>) -> Reply {
    let path = format!("/api/v1/projects/{project}/blobs/{}", sha256_hex(&bytes));
    put(app, &path, token, bytes, None).await
}

fn pdf(size: usize) -> Vec<u8> {
    let mut bytes = b"%PDF-1.7\n".to_vec();
    bytes.extend(unique(size, 9));
    bytes
}

fn code(reply: &Reply) -> &str {
    reply.body["code"].as_str().unwrap_or_default()
}

#[tokio::test]
async fn an_account_owns_at_most_the_projects_the_limit_allows() {
    let app = test_app_with(quota_config(AccountQuotas {
        projects: Some(2),
        ..AccountQuotas::default()
    }))
    .await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let other = seed_member(&app, ServerRole::Member).await;
    let create = |member: &SeededMember| {
        let token = member.access_token.clone();
        let router = app.router.clone();
        async move {
            send_post(
                &router,
                "/api/v1/projects",
                Some(&token),
                json!({ "title": "Thesis" }),
            )
            .await
        }
    };
    let first = create(&owner).await;
    assert_eq!(first.status, StatusCode::CREATED);
    assert_eq!(create(&owner).await.status, StatusCode::CREATED);
    let refused = create(&owner).await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(code(&refused), "too_many_projects");
    assert_eq!(create(&other).await.status, StatusCode::CREATED);
    let project: SharedProjectId = first.body["project_id"]
        .as_str()
        .expect("id")
        .parse()
        .expect("project id");
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| projects::set_status(conn, project, ProjectStatus::Archived, now))
        .await
        .expect("archived");
    assert_eq!(create(&owner).await.status, StatusCode::CREATED);
}

#[tokio::test]
async fn blob_and_snapshot_uploads_share_one_hourly_limit_per_account_and_outputs_do_not_count() {
    let app = test_app_with(quota_config(AccountQuotas {
        uploads_per_hour: Some(3),
        ..AccountQuotas::default()
    }))
    .await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let editor = seed_member(&app, ServerRole::Member).await;
    let viewer = seed_member(&app, ServerRole::Member).await;
    let project = shared_project(&app, owner.account_id).await;
    add_member(
        &app,
        project,
        owner.account_id,
        editor.account_id,
        ProjectRole::Editor,
    )
    .await;
    add_member(
        &app,
        project,
        owner.account_id,
        viewer.account_id,
        ProjectRole::Viewer,
    )
    .await;
    let token = owner.access_token.as_str();
    let blob = put_blob(&app, project, token, unique(1000, 1)).await;
    assert_eq!(blob.status, StatusCode::NO_CONTENT);
    let output_path = format!("/api/v1/projects/{project}/output/pdf");
    for size in [2000, 2100, 2200, 2300] {
        let output = put(&app, &output_path, token, pdf(size), Some("main.tex")).await;
        assert_eq!(output.status, StatusCode::OK, "{:?}", output.body);
    }
    let hint = send(
        &app.router,
        Method::PUT,
        &format!("/api/v1/projects/{project}/snapshot?seq=0"),
        Some(token),
        None,
    )
    .await;
    assert_eq!(hint.status, StatusCode::BAD_REQUEST, "{:?}", hint.body);
    let third = put_blob(&app, project, token, unique(1000, 6)).await;
    assert_eq!(third.status, StatusCode::NO_CONTENT, "{:?}", third.body);
    let refused = put_blob(&app, project, token, unique(1000, 2)).await;
    assert_eq!(refused.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(code(&refused), "too_many_uploads");
    assert!(refused.body["message"]
        .as_str()
        .unwrap_or_default()
        .contains("Try again in"));
    for _ in 0..3 {
        let not_allowed = put_blob(&app, project, &viewer.access_token, unique(10, 3)).await;
        assert_eq!(not_allowed.status, StatusCode::FORBIDDEN);
    }
    assert_eq!(
        put_blob(&app, project, &editor.access_token, unique(1000, 4))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    app.clock.advance(UPLOAD_WINDOW_MS);
    let later = fresh_token(&app, &owner).await;
    assert_eq!(
        put_blob(&app, project, &later, unique(1000, 5))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

async fn fresh_token(app: &TestApp, member: &SeededMember) -> String {
    let (account, device, now) = (member.account_id, member.device_id, app.clock.now_ms());
    app.state
        .db
        .call(move |conn| {
            oleafly_server::tokens::issue_access_token(conn, account, device, now)
                .map(|(token, _)| token)
        })
        .await
        .expect("a fresh access token")
}

#[tokio::test]
async fn an_unlimited_server_counts_no_uploads() {
    let app = test_app_with(test_config()).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = shared_project(&app, owner.account_id).await;
    for seed in 0..80 {
        let reply = put_blob(&app, project, &owner.access_token, unique(64, seed)).await;
        assert_eq!(reply.status, StatusCode::NO_CONTENT);
    }
    let counted: i64 = app
        .state
        .db
        .call(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM account_uploads", [], |row| row.get(0))?)
        })
        .await
        .expect("count");
    assert_eq!(counted, 0);
}

#[tokio::test]
async fn the_owners_storage_covers_every_project_they_own_and_every_upload_into_them() {
    let app = test_app_with(quota_config(AccountQuotas {
        storage_mb: Some(1),
        ..AccountQuotas::default()
    }))
    .await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let editor = seed_member(&app, ServerRole::Member).await;
    let thesis = shared_project(&app, owner.account_id).await;
    let notes = shared_project(&app, owner.account_id).await;
    add_member(
        &app,
        thesis,
        owner.account_id,
        editor.account_id,
        ProjectRole::Editor,
    )
    .await;
    let token = owner.access_token.as_str();
    assert_eq!(
        put_blob(&app, thesis, token, unique(600 * 1024, 1))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let full = put_blob(&app, notes, token, unique(500 * 1024, 2)).await;
    assert_eq!(full.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(code(&full), "account_storage_full");
    assert!(full.body["message"]
        .as_str()
        .unwrap_or_default()
        .starts_with("Your projects"));
    let by_editor = put_blob(&app, thesis, &editor.access_token, unique(500 * 1024, 3)).await;
    assert_eq!(by_editor.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(code(&by_editor), "account_storage_full");
    assert!(by_editor.body["message"]
        .as_str()
        .unwrap_or_default()
        .contains("owner"));
    let output_path = format!("/api/v1/projects/{thesis}/output/pdf");
    let output = put(&app, &output_path, token, pdf(500 * 1024), Some("main.tex")).await;
    assert_eq!(output.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(code(&output), "account_storage_full");
    let small = put(&app, &output_path, token, pdf(300 * 1024), Some("main.tex")).await;
    assert_eq!(small.status, StatusCode::OK, "{:?}", small.body);
    let replaced = put(&app, &output_path, token, pdf(350 * 1024), Some("main.tex")).await;
    assert_eq!(
        replaced.status,
        StatusCode::OK,
        "a replaced output frees its own room: {:?}",
        replaced.body
    );
    let editors_own = shared_project(&app, editor.account_id).await;
    assert_eq!(
        put_blob(
            &app,
            editors_own,
            &editor.access_token,
            unique(500 * 1024, 4)
        )
        .await
        .status,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn a_first_snapshot_that_would_fill_the_account_is_refused() {
    let app = test_app_with(quota_config(AccountQuotas {
        storage_mb: Some(1),
        ..AccountQuotas::default()
    }))
    .await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let full = shared_project(&app, owner.account_id).await;
    assert_eq!(
        put_blob(&app, full, &owner.access_token, unique(1000 * 1024, 1))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let created = send_post(
        &app.router,
        "/api/v1/projects",
        Some(&owner.access_token),
        json!({ "title": "Next" }),
    )
    .await;
    let next = created.body["project_id"].as_str().expect("id").to_owned();
    let snapshot = put(
        &app,
        &format!("/api/v1/projects/{next}/snapshot?seq=0"),
        &owner.access_token,
        unique(100 * 1024, 2),
        None,
    )
    .await;
    assert_eq!(snapshot.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(code(&snapshot), "account_storage_full");
}
