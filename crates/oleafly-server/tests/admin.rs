mod support;

use axum::http::{HeaderValue, Method, StatusCode};
use oleafly_collab_protocol::admin::{
    AllowlistEntry, AllowlistMatcher, DomainRule, MemberPatch, MemberStatus, MemberSummary,
    NewAllowlistEntry, NewDomainRule, Page, RuntimeSettings, RuntimeSettingsPatch, SecurityEvent,
    SecurityEventKind,
};
use oleafly_collab_protocol::auth::DeviceSummary;
use oleafly_collab_protocol::capabilities::CapabilityManifest;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::security_log::{self, NewSecurityEvent};
use oleafly_server::test_support::{
    mail_config, seed_member, test_app, test_app_with, MockSmtp, SeededMember, TestApp,
};
use oleafly_server::{members, projects, tokens};
use serde_json::{json, Value};
use support::Reply;

const MEMBERS: &str = "/api/v1/admin/members";
const ALLOWLIST: &str = "/api/v1/admin/allowlist";
const DOMAINS: &str = "/api/v1/admin/domains";
const SETTINGS: &str = "/api/v1/admin/settings";
const SECURITY_LOG: &str = "/api/v1/admin/security-log";
const MANIFEST: &str = "/.well-known/oleafly-server";
const UNKNOWN_ID: &str = "0192f0c4-7c00-7000-8000-000000000000";

fn member_path(account: AccountId) -> String {
    format!("{MEMBERS}/{account}")
}

fn device_path(device: DeviceId) -> String {
    format!("/api/v1/admin/devices/{device}")
}

fn token(member: &SeededMember) -> Option<&str> {
    Some(member.access_token.as_str())
}

fn role_patch(role: ServerRole) -> Value {
    serde_json::to_value(MemberPatch {
        role: Some(role),
        status: None,
    })
    .unwrap()
}

fn status_patch(status: MemberStatus) -> Value {
    serde_json::to_value(MemberPatch {
        role: None,
        status: Some(status),
    })
    .unwrap()
}

fn email_entry(email: &str, role: ServerRole) -> Value {
    serde_json::to_value(NewAllowlistEntry {
        matcher: AllowlistMatcher::Email {
            email: email.to_string(),
        },
        role,
    })
    .unwrap()
}

fn login_entry(provider: &str, login: &str, role: ServerRole) -> Value {
    serde_json::to_value(NewAllowlistEntry {
        matcher: AllowlistMatcher::ProviderLogin {
            provider: provider.to_string(),
            login: login.to_string(),
        },
        role,
    })
    .unwrap()
}

fn domain_rule(domain: &str, role: ServerRole) -> Value {
    serde_json::to_value(NewDomainRule {
        domain: domain.to_string(),
        role,
    })
    .unwrap()
}

fn settings_patch(guests_enabled: Option<bool>, link_sharing_allowed: Option<bool>) -> Value {
    serde_json::to_value(RuntimeSettingsPatch {
        guests_enabled,
        guest_approval_required: None,
        directory_visible: None,
        directory_shows_email: None,
        link_sharing_allowed,
        access_logs_allowed: None,
        email_notifications: None,
        comments_allowed: None,
        email_link_sign_in: None,
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

async fn logged(app: &TestApp) -> Vec<SecurityEvent> {
    app.state
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("the security log reads")
        .items
}

fn kinds(events: &[SecurityEvent]) -> Vec<&'static str> {
    events
        .iter()
        .map(|event| security_log::kind_to_str(&event.kind))
        .collect()
}

fn of_kind<'a>(events: &'a [SecurityEvent], kind: &str) -> Vec<&'a SecurityEvent> {
    events
        .iter()
        .filter(|event| security_log::kind_to_str(&event.kind) == kind)
        .collect()
}

async fn count(app: &TestApp, sql: &'static str, id: String) -> i64 {
    app.state
        .db
        .call(move |conn| Ok(conn.query_row(sql, [id], |row| row.get::<_, i64>(0))?))
        .await
        .expect("the count query runs")
}

async fn add_device(app: &TestApp, account: AccountId) -> String {
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            let device = DeviceId::new_v7();
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES (?1, ?2, ?3, 'Second laptop', 'linux', ?4)",
                rusqlite::params![device.to_string(), account.to_string(), tokens::random_token(), now],
            )?;
            let (access_token, _) = tokens::issue_access_token(conn, account, device, now)?;
            Ok(access_token)
        })
        .await
        .expect("the second device is stored")
}

fn every_admin_request(
    account: AccountId,
    device: DeviceId,
) -> Vec<(Method, String, Option<Value>)> {
    vec![
        (Method::GET, MEMBERS.to_string(), None),
        (
            Method::PATCH,
            member_path(account),
            Some(role_patch(ServerRole::Member)),
        ),
        (Method::DELETE, member_path(account), None),
        (
            Method::GET,
            format!("{}/devices", member_path(account)),
            None,
        ),
        (Method::DELETE, device_path(device), None),
        (Method::GET, ALLOWLIST.to_string(), None),
        (
            Method::POST,
            ALLOWLIST.to_string(),
            Some(email_entry("new@uni.edu", ServerRole::Member)),
        ),
        (Method::DELETE, format!("{ALLOWLIST}/{UNKNOWN_ID}"), None),
        (Method::GET, DOMAINS.to_string(), None),
        (
            Method::POST,
            DOMAINS.to_string(),
            Some(domain_rule("uni.edu", ServerRole::Member)),
        ),
        (Method::DELETE, format!("{DOMAINS}/{UNKNOWN_ID}"), None),
        (Method::GET, SETTINGS.to_string(), None),
        (
            Method::PATCH,
            SETTINGS.to_string(),
            Some(settings_patch(Some(true), None)),
        ),
        (Method::GET, SECURITY_LOG.to_string(), None),
    ]
}

#[tokio::test]
async fn admin_routes_need_a_session() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    for (method, path, body) in every_admin_request(admin.account_id, admin.device_id) {
        let reply = support::send(&app.router, method.clone(), &path, None, body).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{method} {path}");
        assert_eq!(reply.body["code"], "unauthorized");
    }
}

#[tokio::test]
async fn members_and_guests_get_403_from_every_admin_route() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    for role in [ServerRole::Member, ServerRole::Guest] {
        let caller = seed_member(&app, role).await;
        for (method, path, body) in every_admin_request(admin.account_id, admin.device_id) {
            let reply =
                support::send(&app.router, method.clone(), &path, token(&caller), body).await;
            assert_eq!(
                reply.status,
                StatusCode::FORBIDDEN,
                "{role:?} {method} {path}"
            );
            assert_eq!(reply.body["code"], "forbidden");
        }
    }
    assert!(logged(&app).await.is_empty());
}

#[tokio::test]
async fn maintainers_manage_members_but_not_staff() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let other_maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let auth = token(&maintainer);
    let router = &app.router;

    expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("alice@uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    );
    for role in [ServerRole::Maintainer, ServerRole::Admin] {
        expect_status(
            support::send_post(router, ALLOWLIST, auth, email_entry("staff@uni.edu", role)).await,
            StatusCode::FORBIDDEN,
        );
    }
    let refused = [
        (
            member_path(member.account_id),
            role_patch(ServerRole::Maintainer),
        ),
        (
            member_path(admin.account_id),
            role_patch(ServerRole::Member),
        ),
        (
            member_path(other_maintainer.account_id),
            role_patch(ServerRole::Member),
        ),
        (
            member_path(other_maintainer.account_id),
            status_patch(MemberStatus::Suspended),
        ),
        (
            member_path(admin.account_id),
            status_patch(MemberStatus::Suspended),
        ),
    ];
    for (path, body) in refused {
        let reply = support::send_patch(router, &path, auth, body).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{path}");
    }
    for target in [admin.account_id, other_maintainer.account_id] {
        expect_status(
            support::send_delete(router, &member_path(target), auth).await,
            StatusCode::FORBIDDEN,
        );
    }
    expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            auth,
            role_patch(ServerRole::Guest),
        )
        .await,
        StatusCode::OK,
    );
    let suspended: MemberSummary = parse(expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            auth,
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(suspended.status, MemberStatus::Suspended);
    assert_eq!(suspended.account.server_role, ServerRole::Guest);
    let (admin_id, other_id) = (admin.account_id, other_maintainer.account_id);
    let roles = app
        .state
        .db
        .call(move |conn| {
            Ok((
                members::account_role(conn, admin_id)?,
                members::account_role(conn, other_id)?,
            ))
        })
        .await
        .unwrap();
    assert_eq!(
        roles,
        (Some(ServerRole::Admin), Some(ServerRole::Maintainer))
    );
}

#[tokio::test]
async fn admins_appoint_and_demote_staff() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let auth = token(&admin);
    let router = &app.router;
    let promoted: MemberSummary = parse(expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            auth,
            role_patch(ServerRole::Maintainer),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(promoted.account.server_role, ServerRole::Maintainer);
    expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("co-admin@uni.edu", ServerRole::Admin),
        )
        .await,
        StatusCode::CREATED,
    );
    let demoted: MemberSummary = parse(expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            auth,
            role_patch(ServerRole::Member),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(demoted.account.server_role, ServerRole::Member);
    let listed: Vec<MemberSummary> = parse(expect_status(
        support::send_get(router, MEMBERS, auth).await,
        StatusCode::OK,
    ));
    assert_eq!(listed.len(), 2);
    let events = logged(&app).await;
    let changes = of_kind(&events, "role_changed");
    assert_eq!(changes.len(), 2);
    assert_eq!(
        changes[0].detail,
        json!({"from": "maintainer", "to": "member"})
    );
    assert_eq!(
        changes[1].detail,
        json!({"from": "member", "to": "maintainer"})
    );
    assert_eq!(changes[0].target, Some(member.account_id.to_string()));
}

#[tokio::test]
async fn the_last_admin_cannot_be_demoted_suspended_or_removed() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let auth = token(&admin);
    let router = &app.router;
    let own = member_path(admin.account_id);
    for body in [
        role_patch(ServerRole::Maintainer),
        role_patch(ServerRole::Member),
        status_patch(MemberStatus::Suspended),
    ] {
        let reply = support::send_patch(router, &own, auth, body).await;
        assert_eq!(reply.status, StatusCode::CONFLICT);
        assert_eq!(reply.body["code"], "last_admin");
    }
    let removal = expect_status(
        support::send_delete(router, &own, auth).await,
        StatusCode::CONFLICT,
    );
    assert_eq!(removal.body["code"], "last_admin");
    let second = seed_member(&app, ServerRole::Admin).await;
    expect_status(
        support::send_patch(router, &own, auth, role_patch(ServerRole::Member)).await,
        StatusCode::OK,
    );
    let second_own = member_path(second.account_id);
    expect_status(
        support::send_patch(
            router,
            &second_own,
            token(&second),
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::CONFLICT,
    );
    expect_status(
        support::send_delete(router, &second_own, token(&second)).await,
        StatusCode::CONFLICT,
    );
    let admins = app
        .state
        .db
        .call(|conn| members::count_admins(conn))
        .await
        .unwrap();
    assert_eq!(admins, 1);
}

#[tokio::test]
async fn suspending_a_member_signs_out_every_device() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let second_token = add_device(&app, member.account_id).await;
    let router = &app.router;
    expect_status(
        support::send_get(router, MEMBERS, token(&member)).await,
        StatusCode::FORBIDDEN,
    );
    expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            token(&admin),
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::OK,
    );
    for access in [member.access_token.as_str(), second_token.as_str()] {
        expect_status(
            support::send_get(router, MEMBERS, Some(access)).await,
            StatusCode::UNAUTHORIZED,
        );
    }
    let id = member.account_id.to_string();
    assert_eq!(
        count(
            &app,
            "SELECT COUNT(*) FROM devices WHERE account_id = ?1",
            id.clone()
        )
        .await,
        2
    );
    assert_eq!(
        count(
            &app,
            "SELECT COUNT(*) FROM devices WHERE account_id = ?1 AND revoked_at IS NULL",
            id.clone()
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &app,
            "SELECT COUNT(*) FROM access_tokens WHERE account_id = ?1",
            id.clone()
        )
        .await,
        0
    );
    let events = logged(&app).await;
    let suspended = of_kind(&events, "member_suspended");
    assert_eq!(suspended.len(), 1);
    assert_eq!(suspended[0].actor, Some(admin.account_id));
    assert_eq!(suspended[0].target, Some(id));
    assert_eq!(suspended[0].detail["devices_signed_out"], 2);
    let reactivated: MemberSummary = parse(expect_status(
        support::send_patch(
            router,
            &member_path(member.account_id),
            token(&admin),
            status_patch(MemberStatus::Active),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(reactivated.status, MemberStatus::Active);
    expect_status(
        support::send_get(router, MEMBERS, token(&member)).await,
        StatusCode::UNAUTHORIZED,
    );
}

#[tokio::test]
async fn making_someone_active_again_is_refused_while_their_project_is_full() {
    let app = test_app_with(support::config_with(&[(
        "OLEAFLY_MAX_MEMBERS_PER_PROJECT",
        "2",
    )]))
    .await;
    let router = &app.router;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let bob = seed_member(&app, ServerRole::Member).await;
    let carol = seed_member(&app, ServerRole::Member).await;
    let now = app.clock.now_ms();
    let (by, bob_id, carol_id) = (owner.account_id, bob.account_id, carol.account_id);
    let project = app
        .state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, by, "Reef survey", now)?;
            projects::set_status(conn, project, ProjectStatus::Active, now)?;
            projects::grant(conn, project, bob_id, ProjectRole::Editor, by, now)?;
            Ok(project)
        })
        .await
        .expect("a shared project");
    expect_status(
        support::send_patch(
            router,
            &member_path(bob_id),
            token(&admin),
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::OK,
    );
    app.state
        .db
        .call(move |conn| projects::grant(conn, project, carol_id, ProjectRole::Editor, by, now))
        .await
        .expect("carol takes the free seat");
    let refused = expect_status(
        support::send_patch(
            router,
            &member_path(bob_id),
            token(&admin),
            status_patch(MemberStatus::Active),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_eq!(refused.body["code"], "project_full");
    assert!(
        refused.body["message"]
            .as_str()
            .is_some_and(|message| message.contains("Reef survey")),
        "{}",
        refused.body
    );
    let still = app
        .state
        .db
        .call(move |conn| members::account_status(conn, bob_id))
        .await
        .expect("status");
    assert_eq!(still, Some(MemberStatus::Suspended));
    app.state
        .db
        .call(move |conn| projects::revoke(conn, project, carol_id).map(|_| ()))
        .await
        .expect("carol leaves");
    let back: MemberSummary = parse(expect_status(
        support::send_patch(
            router,
            &member_path(bob_id),
            token(&admin),
            status_patch(MemberStatus::Active),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(back.status, MemberStatus::Active);
}

#[tokio::test]
async fn removing_a_member_keeps_the_account_revokes_devices_and_drops_bound_entries() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let auth = token(&admin);
    let router = &app.router;
    let bound: AllowlistEntry = parse(expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("member@uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    let unbound: AllowlistEntry = parse(expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("other@uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    let (entry_id, account) = (bound.id.clone(), member.account_id);
    app.state
        .db
        .call(move |conn| members::bind_allowlist(conn, &entry_id, account))
        .await
        .unwrap();
    expect_status(
        support::send_delete(router, &member_path(account), auth).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_get(router, MEMBERS, token(&member)).await,
        StatusCode::UNAUTHORIZED,
    );
    let remaining: Vec<AllowlistEntry> = parse(expect_status(
        support::send_get(router, ALLOWLIST, auth).await,
        StatusCode::OK,
    ));
    let remaining_ids: Vec<&str> = remaining.iter().map(|entry| entry.id.as_str()).collect();
    assert_eq!(remaining_ids, [unbound.id.as_str()]);
    let (status, still_stored) = app
        .state
        .db
        .call(move |conn| {
            Ok((
                members::account_status(conn, account)?,
                members::account_summary(conn, account)?.is_some(),
            ))
        })
        .await
        .unwrap();
    assert_eq!(status, Some(MemberStatus::Removed));
    assert!(still_stored);
    let id = account.to_string();
    assert_eq!(
        count(
            &app,
            "SELECT COUNT(*) FROM devices WHERE account_id = ?1",
            id.clone()
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &app,
            "SELECT COUNT(*) FROM devices WHERE account_id = ?1 AND revoked_at IS NULL",
            id.clone()
        )
        .await,
        0
    );
    for (method, path) in [
        (Method::DELETE, member_path(account)),
        (Method::PATCH, member_path(account)),
        (Method::GET, format!("{}/devices", member_path(account))),
    ] {
        let body = (method == Method::PATCH).then(|| role_patch(ServerRole::Member));
        let reply = support::send(router, method.clone(), &path, auth, body).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{method} {path}");
    }
    let listed: Vec<MemberSummary> = parse(support::send_get(router, MEMBERS, auth).await);
    assert_eq!(listed.len(), 1);
    let events = logged(&app).await;
    let removed = of_kind(&events, "member_removed");
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].target, Some(id));
    assert_eq!(removed[0].detail["devices_signed_out"], 1);
    assert_eq!(removed[0].detail["allowlist_entries_removed"], 1);
    assert!(of_kind(&events, "device_signed_out").is_empty());
}

#[tokio::test]
async fn staff_list_a_members_live_devices() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let guest = seed_member(&app, ServerRole::Guest).await;
    add_device(&app, member.account_id).await;
    let router = &app.router;
    let path = format!("{}/devices", member_path(member.account_id));
    for caller in [&admin, &maintainer] {
        let listed: Vec<DeviceSummary> = parse(expect_status(
            support::send_get(router, &path, token(caller)).await,
            StatusCode::OK,
        ));
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|device| !device.current));
        assert!(listed
            .iter()
            .any(|device| device.device_id == member.device_id));
    }
    for caller in [&member, &guest] {
        expect_status(
            support::send_get(router, &path, token(caller)).await,
            StatusCode::FORBIDDEN,
        );
    }
    expect_status(
        support::send_delete(router, &device_path(member.device_id), token(&maintainer)).await,
        StatusCode::NO_CONTENT,
    );
    let after: Vec<DeviceSummary> = parse(support::send_get(router, &path, token(&admin)).await);
    assert_eq!(after.len(), 1);
    assert!(after
        .iter()
        .all(|device| device.device_id != member.device_id));
    expect_status(
        support::send_get(
            router,
            &format!("{}/devices", member_path(AccountId::new_v7())),
            token(&admin),
        )
        .await,
        StatusCode::NOT_FOUND,
    );
    expect_status(
        support::send_get(
            router,
            "/api/v1/admin/members/not-an-id/devices",
            token(&admin),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
}

#[tokio::test]
async fn allowlist_entries_are_validated_and_unique() {
    let app = test_app_with(support::config_with(&[
        ("OLEAFLY_GITHUB_CLIENT_ID", "id"),
        ("OLEAFLY_GITHUB_CLIENT_SECRET", "secret"),
    ]))
    .await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let auth = token(&maintainer);
    let router = &app.router;
    let by_email: AllowlistEntry = parse(expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("Alice@Uni.EDU", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    assert!(
        matches!(&by_email.matcher, AllowlistMatcher::Email { email } if email == "Alice@Uni.EDU")
    );
    assert_eq!(by_email.role, ServerRole::Member);
    assert_eq!(by_email.bound_account, None);
    let duplicate = support::send_post(
        router,
        ALLOWLIST,
        auth,
        email_entry("alice@uni.edu", ServerRole::Member),
    )
    .await;
    assert_eq!(duplicate.status, StatusCode::CONFLICT);
    assert_eq!(duplicate.body["code"], "duplicate_entry");
    let not_an_address = expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("not-an-email", ServerRole::Member),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(not_an_address.body["code"], "invalid_email");
    let by_login: AllowlistEntry = parse(expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            login_entry("github", "@Alice-Chen", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    assert!(matches!(
        &by_login.matcher,
        AllowlistMatcher::ProviderLogin { provider, login } if provider == "github" && login == "Alice-Chen"
    ));
    expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            login_entry("gitlab", "alice", ServerRole::Member),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    let (found_email, found_login) = app
        .state
        .db
        .call(|conn| {
            Ok((
                members::find_allowlist_by_email(conn, "ALICE@uni.edu")?,
                members::find_allowlist_by_login(conn, "github", "alice-chen")?,
            ))
        })
        .await
        .unwrap();
    assert_eq!(found_email.map(|entry| entry.id), Some(by_email.id.clone()));
    assert_eq!(found_login.map(|entry| entry.id), Some(by_login.id.clone()));
    let listed: Vec<AllowlistEntry> = parse(support::send_get(router, ALLOWLIST, auth).await);
    assert_eq!(listed.len(), 2);
    let path = format!("{ALLOWLIST}/{}", by_email.id);
    expect_status(
        support::send_delete(router, &path, auth).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_delete(router, &path, auth).await,
        StatusCode::NOT_FOUND,
    );
    expect_status(
        support::send_delete(router, &format!("{ALLOWLIST}/{UNKNOWN_ID}"), auth).await,
        StatusCode::NOT_FOUND,
    );
}

#[tokio::test]
async fn domain_rules_are_normalised_and_cannot_add_staff() {
    let app = test_app().await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let auth = token(&maintainer);
    let router = &app.router;
    let created: DomainRule = parse(expect_status(
        support::send_post(
            router,
            DOMAINS,
            auth,
            domain_rule("@CS.Stanford.EDU", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    assert_eq!(created.domain, "cs.stanford.edu");
    assert_eq!(created.role, ServerRole::Member);
    let again = expect_status(
        support::send_post(
            router,
            DOMAINS,
            auth,
            domain_rule("cs.stanford.edu", ServerRole::Guest),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_eq!(again.body["code"], "duplicate_entry");
    for role in [ServerRole::Admin, ServerRole::Maintainer] {
        expect_status(
            support::send_post(router, DOMAINS, auth, domain_rule("uni.edu", role)).await,
            StatusCode::BAD_REQUEST,
        );
    }
    let not_a_domain = expect_status(
        support::send_post(
            router,
            DOMAINS,
            auth,
            domain_rule("not a domain", ServerRole::Member),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(not_a_domain.body["code"], "invalid_domain");
    let found = app
        .state
        .db
        .call(|conn| members::find_domain_rule(conn, "Cs.Stanford.Edu"))
        .await
        .unwrap();
    assert_eq!(found.map(|rule| rule.id), Some(created.id.clone()));
    expect_status(
        support::send_get(router, DOMAINS, token(&member)).await,
        StatusCode::FORBIDDEN,
    );
    expect_status(
        support::send_delete(router, &format!("{DOMAINS}/{}", created.id), auth).await,
        StatusCode::NO_CONTENT,
    );
    let listed: Vec<DomainRule> = parse(support::send_get(router, DOMAINS, auth).await);
    assert!(listed.is_empty());
}

#[tokio::test]
async fn settings_are_read_by_maintainers_and_changed_by_admins() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let router = &app.router;
    let read: RuntimeSettings = parse(expect_status(
        support::send_get(router, SETTINGS, token(&maintainer)).await,
        StatusCode::OK,
    ));
    assert!(!read.guests_enabled);
    assert!(read.guest_approval_required);
    assert!(read.link_sharing_allowed);
    assert!(read.comments_allowed);
    expect_status(
        support::send_patch(
            router,
            SETTINGS,
            token(&maintainer),
            settings_patch(Some(true), None),
        )
        .await,
        StatusCode::FORBIDDEN,
    );
    let changed: RuntimeSettings = parse(expect_status(
        support::send_patch(
            router,
            SETTINGS,
            token(&admin),
            settings_patch(Some(true), Some(false)),
        )
        .await,
        StatusCode::OK,
    ));
    assert!(changed.guests_enabled);
    assert!(!changed.link_sharing_allowed);
    assert!(changed.directory_visible);
    let again: RuntimeSettings = parse(support::send_get(router, SETTINGS, token(&admin)).await);
    assert!(again.guests_enabled && !again.link_sharing_allowed);
    let manifest: CapabilityManifest = parse(support::send_get(router, MANIFEST, None).await);
    assert!(manifest.features.guests);
    assert!(!manifest.features.link_sharing);
    let events = logged(&app).await;
    let logged_changes = of_kind(&events, "settings_changed");
    assert_eq!(logged_changes.len(), 1);
    assert_eq!(
        logged_changes[0].detail,
        json!({
            "guests_enabled": {"from": false, "to": true},
            "link_sharing_allowed": {"from": true, "to": false}
        })
    );
    expect_status(
        support::send_patch(
            router,
            SETTINGS,
            token(&admin),
            settings_patch(Some(true), None),
        )
        .await,
        StatusCode::OK,
    );
    assert_eq!(of_kind(&logged(&app).await, "settings_changed").len(), 1);
}

#[tokio::test]
async fn security_log_pages_newest_first() {
    let app = test_app().await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let start = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            for index in 0..60 {
                security_log::record(
                    conn,
                    start + index,
                    NewSecurityEvent {
                        actor: None,
                        kind: SecurityEventKind::SignIn,
                        target: Some(format!("event-{index}")),
                        ip: None,
                        detail: json!({"index": index}),
                    },
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let router = &app.router;
    let first: Page<SecurityEvent> = parse(expect_status(
        support::send_get(router, SECURITY_LOG, token(&maintainer)).await,
        StatusCode::OK,
    ));
    assert_eq!(first.items.len(), 50);
    assert_eq!(first.items[0].target.as_deref(), Some("event-59"));
    assert_eq!(first.items[49].target.as_deref(), Some("event-10"));
    let cursor = first.next_cursor.clone().expect("a second page");
    let second: Page<SecurityEvent> = parse(expect_status(
        support::send_get(
            router,
            &format!("{SECURITY_LOG}?cursor={cursor}"),
            token(&maintainer),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(second.items.len(), 10);
    assert_eq!(second.items[9].target.as_deref(), Some("event-0"));
    assert_eq!(second.next_cursor, None);
    let empty_cursor: Page<SecurityEvent> = parse(expect_status(
        support::send_get(
            router,
            &format!("{SECURITY_LOG}?cursor="),
            token(&maintainer),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(empty_cursor.items.len(), 50);
    expect_status(
        support::send_get(router, SECURITY_LOG, token(&member)).await,
        StatusCode::FORBIDDEN,
    );
}

#[tokio::test]
async fn maintainers_sign_out_members_devices() {
    let app = test_app().await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let router = &app.router;
    expect_status(
        support::send_delete(router, &device_path(admin.device_id), token(&member)).await,
        StatusCode::FORBIDDEN,
    );
    expect_status(
        support::send_delete(router, &device_path(member.device_id), token(&maintainer)).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_get(router, SETTINGS, token(&member)).await,
        StatusCode::UNAUTHORIZED,
    );
    expect_status(
        support::send_delete(router, &device_path(member.device_id), token(&maintainer)).await,
        StatusCode::NOT_FOUND,
    );
    expect_status(
        support::send_delete(router, &device_path(admin.device_id), token(&maintainer)).await,
        StatusCode::FORBIDDEN,
    );
    let events = logged(&app).await;
    let signed_out = of_kind(&events, "device_signed_out");
    assert_eq!(signed_out.len(), 1);
    assert_eq!(signed_out[0].target, Some(member.device_id.to_string()));
    assert_eq!(
        signed_out[0].detail["account_id"],
        member.account_id.to_string()
    );
    assert_eq!(signed_out[0].actor, Some(maintainer.account_id));
}

#[tokio::test]
async fn every_admin_change_is_in_the_security_log() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let other = seed_member(&app, ServerRole::Member).await;
    let auth = token(&admin);
    let router = &app.router;
    let target = member_path(member.account_id);
    expect_status(
        support::send_patch(router, &target, auth, role_patch(ServerRole::Maintainer)).await,
        StatusCode::OK,
    );
    expect_status(
        support::send_patch(router, &target, auth, status_patch(MemberStatus::Suspended)).await,
        StatusCode::OK,
    );
    expect_status(
        support::send_patch(router, &target, auth, status_patch(MemberStatus::Active)).await,
        StatusCode::OK,
    );
    expect_status(
        support::send_delete(router, &device_path(other.device_id), auth).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_delete(router, &member_path(other.account_id), auth).await,
        StatusCode::NO_CONTENT,
    );
    let entry: AllowlistEntry = parse(expect_status(
        support::send_post(
            router,
            ALLOWLIST,
            auth,
            email_entry("new@uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    expect_status(
        support::send_delete(router, &format!("{ALLOWLIST}/{}", entry.id), auth).await,
        StatusCode::NO_CONTENT,
    );
    let rule: DomainRule = parse(expect_status(
        support::send_post(
            router,
            DOMAINS,
            auth,
            domain_rule("uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    ));
    expect_status(
        support::send_delete(router, &format!("{DOMAINS}/{}", rule.id), auth).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_patch(router, SETTINGS, auth, settings_patch(Some(true), None)).await,
        StatusCode::OK,
    );
    let events = logged(&app).await;
    assert_eq!(
        kinds(&events),
        [
            "settings_changed",
            "domain_rule_removed",
            "domain_rule_added",
            "allowlist_removed",
            "allowlist_added",
            "member_removed",
            "device_signed_out",
            "member_reactivated",
            "member_suspended",
            "role_changed",
        ]
    );
    assert!(events
        .iter()
        .all(|event| event.actor == Some(admin.account_id)));
}

#[tokio::test]
async fn security_events_take_the_client_address_from_a_trusted_proxy_only() {
    for (behind_proxy, expected) in [("true", Some("198.51.100.7")), ("false", None)] {
        let app = test_app_with(support::config_with(&[(
            "OLEAFLY_BEHIND_PROXY",
            behind_proxy,
        )]))
        .await;
        let admin = seed_member(&app, ServerRole::Admin).await;
        let mut request = support::build_request(
            Method::POST,
            ALLOWLIST,
            Some(format!("Bearer {}", admin.access_token)),
            Some(email_entry("ip@uni.edu", ServerRole::Member).to_string()),
        );
        request.headers_mut().insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.5, 198.51.100.7"),
        );
        expect_status(
            support::send_request(&app.router, request).await,
            StatusCode::CREATED,
        );
        let events = logged(&app).await;
        assert_eq!(
            events[0].ip.as_deref(),
            expected,
            "behind proxy: {behind_proxy}"
        );
    }
}

#[tokio::test]
async fn malformed_requests_get_api_errors() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let auth = token(&admin);
    let router = &app.router;
    let own = member_path(admin.account_id);
    let replies = [
        support::send_raw(router, Method::PATCH, &own, auth, r#"{"role": "#).await,
        support::send_patch(router, &own, auth, json!({"role": "emperor"})).await,
        support::send_patch(router, &own, auth, json!({})).await,
        support::send_patch(router, &own, auth, status_patch(MemberStatus::Removed)).await,
        support::send_patch(
            router,
            "/api/v1/admin/members/not-an-id",
            auth,
            role_patch(ServerRole::Member),
        )
        .await,
        support::send_post(router, ALLOWLIST, auth, json!({"matcher": "nobody"})).await,
        support::send_get(router, &format!("{SECURITY_LOG}?cursor=yesterday"), auth).await,
    ];
    for reply in replies {
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{}", reply.body);
        assert_eq!(reply.body["code"], "bad_request");
    }
    let missing = support::send_patch(
        router,
        &member_path(AccountId::new_v7()),
        auth,
        role_patch(ServerRole::Member),
    )
    .await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert_eq!(missing.body["code"], "not_found");
}

#[tokio::test]
async fn admin_routes_never_create_or_read_project_grants() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let grant = json!({"account_id": admin.account_id, "role": "owner"});
    let paths = [
        format!("/api/v1/admin/projects/{UNKNOWN_ID}/grants"),
        format!("/api/v1/admin/projects/{UNKNOWN_ID}/members"),
        format!("/api/v1/admin/projects/{UNKNOWN_ID}/link"),
        "/api/v1/admin/grants".to_string(),
        format!("{}/projects", member_path(admin.account_id)),
    ];
    for path in &paths {
        for method in [
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ] {
            let body = if method == Method::GET || method == Method::DELETE {
                None
            } else {
                Some(grant.clone())
            };
            let reply = support::send(&app.router, method.clone(), path, token(&admin), body).await;
            assert!(
                matches!(
                    reply.status,
                    StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
                ),
                "{method} {path} answered {}",
                reply.status
            );
        }
    }
    assert!(logged(&app).await.is_empty());
}

#[tokio::test]
async fn maintainers_cannot_list_or_sign_out_staff_devices() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let other = seed_member(&app, ServerRole::Maintainer).await;
    let router = &app.router;
    for staff in [&admin, &other] {
        let devices = format!("{}/devices", member_path(staff.account_id));
        expect_status(
            support::send_get(router, &devices, token(&maintainer)).await,
            StatusCode::FORBIDDEN,
        );
        expect_status(
            support::send_delete(router, &device_path(staff.device_id), token(&maintainer)).await,
            StatusCode::FORBIDDEN,
        );
        expect_status(
            support::send_get(router, "/api/v1/me", token(staff)).await,
            StatusCode::OK,
        );
    }
    let own = format!("{}/devices", member_path(maintainer.account_id));
    let listed: Vec<DeviceSummary> = parse(expect_status(
        support::send_get(router, &own, token(&maintainer)).await,
        StatusCode::OK,
    ));
    assert_eq!(listed.len(), 1);
    expect_status(
        support::send_delete(router, &device_path(other.device_id), token(&admin)).await,
        StatusCode::NO_CONTENT,
    );
    assert_eq!(of_kind(&logged(&app).await, "device_signed_out").len(), 1);
}

#[tokio::test]
async fn the_member_list_says_how_many_shared_projects_each_person_owns() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let (owner_id, now) = (owner.account_id, app.clock.now_ms());
    app.state
        .db
        .call(move |conn| {
            use oleafly_collab_protocol::projects::ProjectStatus;
            use oleafly_server::projects;
            for (title, status) in [
                ("Thesis", ProjectStatus::Active),
                ("Paper", ProjectStatus::Active),
                ("Old poster", ProjectStatus::Archived),
                ("Still uploading", ProjectStatus::Pending),
            ] {
                let project = projects::create_pending(conn, owner_id, title, now)?;
                if status != ProjectStatus::Pending {
                    projects::set_status(conn, project, ProjectStatus::Active, now)?;
                }
                if status == ProjectStatus::Archived {
                    projects::set_status(conn, project, status, now)?;
                }
            }
            Ok(())
        })
        .await
        .unwrap();
    let listed: Vec<MemberSummary> = parse(expect_status(
        support::send_get(&app.router, MEMBERS, token(&admin)).await,
        StatusCode::OK,
    ));
    let owned = |account: AccountId| {
        listed
            .iter()
            .find(|member| member.account.account_id == account)
            .map(|member| member.owned_projects)
    };
    assert_eq!(owned(owner.account_id), Some(2));
    assert_eq!(owned(admin.account_id), Some(0));
    let suspended: MemberSummary = parse(expect_status(
        support::send_patch(
            &app.router,
            &member_path(owner.account_id),
            token(&admin),
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::OK,
    ));
    assert_eq!(suspended.owned_projects, 2);
}

#[tokio::test]
async fn adding_someone_who_already_has_an_account_is_refused_and_emails_nobody() {
    let smtp = oleafly_server::test_support::MockSmtp::start().await;
    let app = test_app_with(oleafly_server::test_support::mail_config(&smtp)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let bob = seed_member(&app, ServerRole::Member).await;
    let bob_id = bob.account_id;
    app.state
        .db
        .call(move |conn| members::add_verified_emails(conn, bob_id, &["bob@uni.edu".to_string()]))
        .await
        .unwrap();
    let refused = support::send_post(
        &app.router,
        ALLOWLIST,
        token(&admin),
        email_entry("Bob@uni.edu", ServerRole::Maintainer),
    )
    .await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{}", refused.body);
    assert_eq!(refused.body["code"], "already_member");
    assert!(
        refused.body["message"]
            .as_str()
            .is_some_and(|message| message.contains("under People")),
        "{}",
        refused.body
    );
    app.state.mailer.settled().await;
    assert!(smtp.messages().is_empty(), "{:?}", smtp.messages());
    let listed: Vec<AllowlistEntry> = parse(expect_status(
        support::send_get(&app.router, ALLOWLIST, token(&admin)).await,
        StatusCode::OK,
    ));
    assert!(listed.is_empty(), "{listed:?}");
    expect_status(
        support::send_delete(&app.router, &member_path(bob_id), token(&admin)).await,
        StatusCode::NO_CONTENT,
    );
    expect_status(
        support::send_post(
            &app.router,
            ALLOWLIST,
            token(&admin),
            email_entry("bob@uni.edu", ServerRole::Member),
        )
        .await,
        StatusCode::CREATED,
    );
}

async fn live_sign_ins(app: &TestApp, account: AccountId) -> (i64, i64, i64) {
    app.state
        .db
        .call(move |conn| {
            let id = account.to_string();
            let count = |sql: &str| -> rusqlite::Result<i64> {
                conn.query_row(sql, [&id], |row| row.get(0))
            };
            Ok((
                count("SELECT COUNT(*) FROM devices WHERE account_id = ?1 AND revoked_at IS NULL")?,
                count("SELECT COUNT(*) FROM access_tokens WHERE account_id = ?1")?,
                count(
                    "SELECT COUNT(*) FROM refresh_tokens WHERE account_id = ?1 AND revoked_at IS NULL",
                )?,
            ))
        })
        .await
        .unwrap()
}

async fn with_a_second_device(app: &TestApp, member: &SeededMember) {
    let (account, now) = (member.account_id, app.clock.now_ms());
    app.state
        .db
        .call(move |conn| {
            let device = oleafly_server::auth::devices::register(
                conn,
                account,
                &tokens::random_token(),
                "Lab PC",
                "linux",
                now,
            )?
            .device_id;
            oleafly_server::auth::refresh::issue_session(conn, account, device, now)?;
            Ok(())
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn suspending_or_removing_someone_signs_out_every_device_in_the_same_step() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let paused = seed_member(&app, ServerRole::Member).await;
    let gone = seed_member(&app, ServerRole::Member).await;
    for member in [&paused, &gone] {
        with_a_second_device(&app, member).await;
        assert_eq!(live_sign_ins(&app, member.account_id).await, (2, 2, 1));
    }
    expect_status(
        support::send_patch(
            &app.router,
            &member_path(paused.account_id),
            token(&admin),
            status_patch(MemberStatus::Suspended),
        )
        .await,
        StatusCode::OK,
    );
    assert_eq!(live_sign_ins(&app, paused.account_id).await, (0, 0, 0));
    expect_status(
        support::send_delete(&app.router, &member_path(gone.account_id), token(&admin)).await,
        StatusCode::NO_CONTENT,
    );
    assert_eq!(live_sign_ins(&app, gone.account_id).await, (0, 0, 0));
    assert_eq!(live_sign_ins(&app, admin.account_id).await.0, 1);
}

#[tokio::test]
async fn email_sign_in_stays_off_until_email_is_known_to_work() {
    let smtp = MockSmtp::start().await;
    let app = test_app_with(mail_config(&smtp)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let on = json!({ "email_link_sign_in": true });
    let refused = expect_status(
        support::send_patch(&app.router, SETTINGS, token(&admin), on.clone()).await,
        StatusCode::CONFLICT,
    );
    assert_eq!(refused.body["code"], "mail_not_working");
    assert!(refused.body["message"]
        .as_str()
        .is_some_and(|message| message.contains("test email")));
    app.state.mailer.check().await.expect("the mock answers");
    let settings: RuntimeSettings = parse(expect_status(
        support::send_patch(&app.router, SETTINGS, token(&admin), on).await,
        StatusCode::OK,
    ));
    assert!(settings.email_link_sign_in);
}
