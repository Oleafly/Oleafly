mod support;

use axum::http::{Method, StatusCode};
use oleafly_collab_protocol::admin::{RuntimeSettingsPatch, SecurityEvent, SecurityEventKind};
use oleafly_collab_protocol::capabilities::{ProviderKind, WELL_KNOWN_PATH};
use oleafly_collab_protocol::console::{
    AdminOverview, AdminProject, AdminProjectsPage, DailyActivity, FilesLocation, HealthIssue,
    HealthStatus, HourlyActivity, ServerActivity, ACTIVITY_DAYS,
};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, BatchId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::config::{BlobStoreConfig, ServerConfig};
use oleafly_server::rooms::{outbox, Outbound, RoomMember};
use oleafly_server::security_log::{self, NewSecurityEvent};
use oleafly_server::sockets::SocketControl;
use oleafly_server::test_support::{
    seed_member, test_app, test_app_with, test_config, MockS3, SeededMember, TestApp,
    MOCK_S3_SECRET_ACCESS_KEY,
};
use oleafly_server::{projects, tokens};
use rusqlite::params;
use serde_json::Value;
use support::Reply;
use tokio::sync::mpsc;

const OVERVIEW: &str = "/api/v1/admin/overview";
const PROJECTS: &str = "/api/v1/admin/projects";
const UNKNOWN_ID: &str = "0192f0c4-7c00-7000-8000-000000000000";
const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;

fn token(member: &SeededMember) -> Option<&str> {
    Some(member.access_token.as_str())
}

fn archive_path(project: impl std::fmt::Display) -> String {
    format!("{PROJECTS}/{project}/archive")
}

fn unarchive_path(project: impl std::fmt::Display) -> String {
    format!("{PROJECTS}/{project}/unarchive")
}

fn parse<T: serde::de::DeserializeOwned>(reply: Reply) -> T {
    assert!(
        reply.status.is_success(),
        "unexpected reply {} {}",
        reply.status,
        reply.body
    );
    serde_json::from_value(reply.body).expect("the reply has the expected shape")
}

fn every_console_request() -> Vec<(Method, String)> {
    vec![
        (Method::GET, OVERVIEW.to_string()),
        (Method::GET, PROJECTS.to_string()),
        (Method::POST, archive_path(UNKNOWN_ID)),
        (Method::POST, unarchive_path(UNKNOWN_ID)),
    ]
}

async fn logged(app: &TestApp) -> Vec<SecurityEvent> {
    app.state
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("the security log reads")
        .items
}

fn logged_kinds(events: &[SecurityEvent]) -> Vec<&'static str> {
    events
        .iter()
        .map(|event| security_log::kind_to_str(&event.kind))
        .collect()
}

struct Seed {
    title: &'static str,
    status: ProjectStatus,
    created_at: i64,
    snapshot_bytes: u64,
    file_bytes: u64,
    output_bytes: u64,
    members: Vec<AccountId>,
}

impl Seed {
    fn active(title: &'static str, created_at: i64) -> Seed {
        Seed {
            title,
            status: ProjectStatus::Active,
            created_at,
            snapshot_bytes: 100,
            file_bytes: 0,
            output_bytes: 0,
            members: Vec::new(),
        }
    }
}

async fn seed_project(app: &TestApp, owner: AccountId, seed: Seed) -> SharedProjectId {
    app.state
        .db
        .call(move |conn| {
            let id = projects::create_pending(conn, owner, seed.title, seed.created_at)?;
            if seed.status != ProjectStatus::Pending {
                projects::record_snapshot(
                    conn,
                    id,
                    0,
                    &format!("snapshots/{id}/0.bin"),
                    seed.snapshot_bytes,
                    owner,
                    seed.created_at,
                )?;
                projects::set_status(conn, id, ProjectStatus::Active, seed.created_at)?;
            }
            if seed.status == ProjectStatus::Archived {
                projects::set_status(conn, id, ProjectStatus::Archived, seed.created_at + 1)?;
            }
            if seed.file_bytes > 0 {
                let hash = format!("{:064x}", seed.file_bytes);
                projects::add_blob(conn, id, &hash, seed.file_bytes, seed.created_at)?;
            }
            if seed.output_bytes > 0 {
                conn.execute(
                    "INSERT INTO project_outputs (project_id, kind, blob_hash, size, compiled_by, compiled_at, main_file) VALUES (?1, 'pdf', ?2, ?3, ?4, ?5, 'main.tex')",
                    params![
                        id.to_string(),
                        format!("{:064x}", seed.output_bytes),
                        i64::try_from(seed.output_bytes).unwrap_or(i64::MAX),
                        owner.to_string(),
                        seed.created_at
                    ],
                )?;
            }
            for account in seed.members {
                projects::grant(
                    conn,
                    id,
                    account,
                    ProjectRole::Editor,
                    owner,
                    seed.created_at,
                )?;
            }
            Ok(id)
        })
        .await
        .expect("the project is seeded")
}

async fn add_update(app: &TestApp, project: SharedProjectId, owner: &SeededMember, at: i64) {
    let (account, device) = (owner.account_id, owner.device_id);
    app.state
        .db
        .call(move |conn| {
            projects::append_update(
                conn,
                project,
                BatchId::new_v7(),
                device,
                account,
                b"update",
                at,
            )?;
            Ok(())
        })
        .await
        .expect("the update is stored");
}

fn room_member(
    connection: u64,
    account: AccountId,
) -> (RoomMember, Outbound, mpsc::UnboundedReceiver<SocketControl>) {
    let (frames, received) = outbox(8);
    let (control, controls) = mpsc::unbounded_channel();
    (
        RoomMember {
            connection,
            device: DeviceId::new_v7(),
            account,
            frames,
            control,
        },
        received,
        controls,
    )
}

fn data_dir_config(dir: &tempfile::TempDir) -> ServerConfig {
    let mut config = test_config();
    config.data_dir = dir.path().to_path_buf();
    config
}

async fn page(app: &TestApp, caller: &SeededMember, query: &str) -> AdminProjectsPage {
    parse(support::send_get(&app.router, &format!("{PROJECTS}{query}"), token(caller)).await)
}

fn titles(page: &AdminProjectsPage) -> Vec<&str> {
    page.items.iter().map(|item| item.title.as_str()).collect()
}

#[tokio::test]
async fn console_routes_need_a_session() {
    let app = test_app().await;
    for (method, path) in every_console_request() {
        let reply = support::send(&app.router, method.clone(), &path, None, None).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{method} {path}");
        assert_eq!(reply.body["code"], "unauthorized");
    }
}

#[tokio::test]
async fn members_and_guests_are_refused_by_every_console_route() {
    let app = test_app().await;
    seed_member(&app, ServerRole::Admin).await;
    for role in [ServerRole::Member, ServerRole::Guest] {
        let caller = seed_member(&app, role).await;
        for (method, path) in every_console_request() {
            let reply =
                support::send(&app.router, method.clone(), &path, token(&caller), None).await;
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
async fn a_suspended_admin_is_signed_out_of_the_console() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let account = admin.account_id;
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET status = 'suspended' WHERE id = ?1",
                [account.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let reply = support::send_get(&app.router, OVERVIEW, token(&admin)).await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn maintainers_read_the_console_without_storage_or_archiving() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let project = seed_project(&app, admin.account_id, Seed::active("Thesis", 1)).await;

    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(&maintainer)).await);
    assert_eq!(overview.storage, None);
    let listed = page(&app, &maintainer, "").await;
    assert_eq!(titles(&listed), vec!["Thesis"]);
    assert_eq!(listed.items[0].size_bytes, None);

    let by_size = support::send_get(
        &app.router,
        &format!("{PROJECTS}?sort=size"),
        token(&maintainer),
    )
    .await;
    assert_eq!(by_size.status, StatusCode::FORBIDDEN);
    for path in [archive_path(project), unarchive_path(project)] {
        let reply = support::send(&app.router, Method::POST, &path, token(&maintainer), None).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(reply.body["code"], "forbidden");
    }
    assert!(logged(&app).await.is_empty());
}

#[tokio::test]
async fn the_overview_counts_people_devices_projects_and_who_is_online() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app_with(data_dir_config(&dir)).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let suspended = seed_member(&app, ServerRole::Member).await;
    let removed = seed_member(&app, ServerRole::Member).await;
    let (suspended_id, removed_id, member_id) =
        (suspended.account_id, removed.account_id, member.account_id);
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET status = 'suspended' WHERE id = ?1",
                [suspended_id.to_string()],
            )?;
            conn.execute(
                "UPDATE accounts SET status = 'removed' WHERE id = ?1",
                [removed_id.to_string()],
            )?;
            let revoked = DeviceId::new_v7();
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, revoked_at) VALUES (?1, ?2, ?3, 'Old laptop', 'linux', ?4, ?4)",
                params![revoked.to_string(), member_id.to_string(), tokens::random_token(), now],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let owner = admin.account_id;
    let shared = seed_project(
        &app,
        owner,
        Seed {
            snapshot_bytes: 1_000,
            file_bytes: 300,
            output_bytes: 700,
            ..Seed::active("Thesis", 1)
        },
    )
    .await;
    let second = seed_project(
        &app,
        owner,
        Seed {
            snapshot_bytes: 2_000,
            file_bytes: 300,
            ..Seed::active("Paper", 2)
        },
    )
    .await;
    seed_project(
        &app,
        owner,
        Seed {
            status: ProjectStatus::Archived,
            snapshot_bytes: 500,
            ..Seed::active("Old", 3)
        },
    )
    .await;
    seed_project(
        &app,
        owner,
        Seed {
            status: ProjectStatus::Pending,
            ..Seed::active("Draft", 4)
        },
    )
    .await;
    let (one, _a, _ac) = room_member(1, owner);
    let (two, _b, _bc) = room_member(2, maintainer.account_id);
    let (three, _c, _cc) = room_member(3, owner);
    app.state.rooms.join(shared, one);
    app.state.rooms.join(shared, two);
    app.state.rooms.join(second, three);

    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(&admin)).await);
    let counts = overview.counts;
    assert_eq!(counts.people, 3);
    assert_eq!(counts.suspended_people, 1);
    assert_eq!(counts.devices, 3);
    assert_eq!(counts.projects, 2);
    assert_eq!(counts.archived_projects, 1);
    assert_eq!(counts.pending_projects, 1);
    assert_eq!(counts.open_rooms, 2);
    assert_eq!(counts.people_online, 2);
    let storage = overview.storage.expect("admins see storage");
    assert_eq!(storage.snapshot_bytes, 3_500);
    assert_eq!(storage.file_bytes, 1_000);
    assert!(storage.database_bytes > 0);
    assert_eq!(storage.files_location, FilesLocation::Disk);
    assert_eq!(overview.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(overview.server_name, app.state.config.server_name);
    assert_eq!(overview.protocol.min, overview.protocol.max);
    assert!(!overview.email_configured);
    assert!(overview.providers.is_empty());
    assert_eq!(overview.health.status, HealthStatus::Warning);
    assert_eq!(overview.health.issues, vec![HealthIssue::NoSignInProvider]);
    assert_eq!(
        overview.limits.max_members_per_project,
        app.state.config.limits.max_members_per_project
    );
    assert!(overview.settings.link_sharing_allowed);
    assert_eq!(overview.archive_days, app.state.config.archive_days);
}

#[tokio::test]
async fn the_overview_counts_guest_invitations_waiting_for_an_admin() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = seed_project(&app, owner.account_id, Seed::active("Thesis", 1)).await;
    let (inviter, now) = (owner.account_id, app.clock.now_ms());
    app.state
        .db
        .call(move |conn| {
            oleafly_server::settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    guests_enabled: Some(true),
                    guest_approval_required: Some(true),
                    ..RuntimeSettingsPatch::default()
                },
            )?;
            for (email, approval) in [
                ("reviewer@elsewhere.org", true),
                ("editor@elsewhere.org", true),
                ("approved@elsewhere.org", false),
            ] {
                oleafly_server::guests::create(
                    conn,
                    project,
                    email,
                    ProjectRole::Viewer,
                    inviter,
                    approval,
                    now,
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    for caller in [&admin, &maintainer] {
        let overview: AdminOverview =
            parse(support::send_get(&app.router, OVERVIEW, token(caller)).await);
        assert_eq!(overview.counts.pending_guest_approvals, 2);
    }
}

async fn log_events(app: &TestApp, events: Vec<(SecurityEventKind, AccountId, i64)>) {
    app.state
        .db
        .call(move |conn| {
            for (kind, actor, at) in events {
                security_log::record(
                    conn,
                    at,
                    NewSecurityEvent {
                        actor: Some(actor),
                        kind,
                        target: Some(actor.to_string()),
                        ip: None,
                        detail: serde_json::json!({}),
                    },
                )?;
            }
            Ok(())
        })
        .await
        .expect("the events are logged");
}

async fn activity(app: &TestApp, caller: &SeededMember) -> ServerActivity {
    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(caller)).await);
    overview.activity.expect("the overview has activity")
}

#[tokio::test]
async fn the_overview_charts_sign_ins_over_the_last_30_utc_days() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let member = seed_member(&app, ServerRole::Member).await;
    let now = app.clock.now_ms();
    let today = now - now.rem_euclid(DAY);
    let first = today - 29 * DAY;

    let quiet = activity(&app, &admin).await;
    assert_eq!((quiet.since, quiet.days), (first, ACTIVITY_DAYS));
    assert!(quiet.daily.is_empty() && quiet.by_hour.is_empty());

    let (alice, bob) = (admin.account_id, member.account_id);
    log_events(
        &app,
        vec![
            (SecurityEventKind::SignIn, alice, today + HOUR),
            (SecurityEventKind::SignIn, alice, today + HOUR + 30 * MINUTE),
            (SecurityEventKind::SignIn, bob, today + 7 * HOUR),
            (SecurityEventKind::SignIn, bob, today - 1),
            (SecurityEventKind::SignIn, alice, first),
            (SecurityEventKind::SignIn, bob, first - 1),
            (SecurityEventKind::SignInRefused, bob, today + 2 * HOUR),
            (SecurityEventKind::DeviceAdded, bob, today + 7 * HOUR),
            (SecurityEventKind::SettingsChanged, alice, today + 3 * HOUR),
        ],
    )
    .await;

    let charted = activity(&app, &admin).await;
    assert_eq!(charted.since, first);
    assert_eq!(
        charted.daily,
        vec![
            DailyActivity {
                day: first,
                sign_ins: 1,
                people: 1
            },
            DailyActivity {
                day: today - DAY,
                sign_ins: 1,
                people: 1
            },
            DailyActivity {
                day: today,
                sign_ins: 3,
                people: 2
            },
        ]
    );
    assert_eq!(
        charted.by_hour,
        vec![
            HourlyActivity {
                weekday: 3,
                hour: 0,
                sign_ins: 1
            },
            HourlyActivity {
                weekday: 3,
                hour: 23,
                sign_ins: 1
            },
            HourlyActivity {
                weekday: 4,
                hour: 1,
                sign_ins: 2
            },
            HourlyActivity {
                weekday: 4,
                hour: 7,
                sign_ins: 1
            },
        ]
    );
    assert_eq!(activity(&app, &maintainer).await, charted);

    app.clock.advance(DAY);
    let signed_in_again = seed_member(&app, ServerRole::Admin).await;
    let next_day = activity(&app, &signed_in_again).await;
    assert_eq!(next_day.since, first + DAY);
    assert_eq!(
        next_day.daily.first().map(|day| day.day),
        Some(today - DAY),
        "the first day drops out of the range a day later"
    );
}

#[tokio::test]
async fn uptime_runs_from_when_the_server_started() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    app.clock.advance(5 * MINUTE);
    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(&admin)).await);
    assert_eq!(overview.now - overview.started_at, 5 * MINUTE);
}

#[tokio::test]
async fn health_is_ok_with_a_sign_in_option_and_a_writable_data_folder() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = data_dir_config(&dir);
    config
        .providers
        .push(oleafly_server::config::ProviderConfig::Github {
            id: "github".to_string(),
            label: "GitHub".to_string(),
            client_id: "client".to_string(),
            client_secret: "github-client-secret-value".to_string(),
            web_url: url::Url::parse("https://github.com").unwrap(),
            api_url: url::Url::parse("https://api.github.com").unwrap(),
        });
    let app = test_app_with(config).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let reply = support::send_get(&app.router, OVERVIEW, token(&admin)).await;
    assert!(!reply
        .body
        .to_string()
        .contains("github-client-secret-value"));
    let overview: AdminOverview = parse(reply);
    assert_eq!(overview.health.status, HealthStatus::Ok);
    assert!(overview.health.issues.is_empty());
    assert_eq!(overview.providers.len(), 1);
    assert_eq!(overview.providers[0].label, "GitHub");
}

struct SignInSetup {
    github: bool,
    mail: bool,
    email_link_setting: bool,
}

async fn overview_and_manifest(
    setup: &SignInSetup,
) -> (
    AdminOverview,
    oleafly_collab_protocol::capabilities::CapabilityManifest,
) {
    overview_and_manifest_with_mail_checked(setup, true).await
}

async fn overview_and_manifest_with_mail_checked(
    setup: &SignInSetup,
    mail_checked: bool,
) -> (
    AdminOverview,
    oleafly_collab_protocol::capabilities::CapabilityManifest,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut config = data_dir_config(&dir);
    if setup.github {
        config
            .providers
            .push(oleafly_server::config::ProviderConfig::Github {
                id: "github".to_string(),
                label: "GitHub".to_string(),
                client_id: "client".to_string(),
                client_secret: "secret".to_string(),
                web_url: url::Url::parse("https://github.com").unwrap(),
                api_url: url::Url::parse("https://api.github.com").unwrap(),
            });
    }
    if setup.mail {
        config.smtp_url = Some("smtps://lab:mail-password@smtp.uni.edu:465".to_string());
        config.mail_from = Some("Smith Lab <lab@uni.edu>".to_string());
    }
    let app = test_app_with(config).await;
    if setup.mail && mail_checked {
        app.state.mailer.assume_working();
    }
    let email_link = setup.email_link_setting;
    app.state
        .db
        .call(move |conn| {
            oleafly_server::settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    email_link_sign_in: Some(email_link),
                    ..RuntimeSettingsPatch::default()
                },
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let admin = seed_member(&app, ServerRole::Admin).await;
    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(&admin)).await);
    let manifest = parse(support::send_get(&app.router, WELL_KNOWN_PATH, None).await);
    (overview, manifest)
}

#[tokio::test]
async fn the_overview_lists_sign_in_by_email_link_and_counts_it_as_a_way_in() {
    let (overview, _) = overview_and_manifest(&SignInSetup {
        github: false,
        mail: true,
        email_link_setting: true,
    })
    .await;
    let kinds: Vec<ProviderKind> = overview
        .providers
        .iter()
        .map(|provider| provider.kind)
        .collect();
    assert_eq!(kinds, vec![ProviderKind::EmailLink]);
    assert_eq!(overview.health.status, HealthStatus::Ok);
    assert!(overview.health.issues.is_empty());
}

#[tokio::test]
async fn sign_in_by_email_stays_hidden_until_email_is_shown_to_work() {
    let (overview, manifest) = overview_and_manifest_with_mail_checked(
        &SignInSetup {
            github: false,
            mail: true,
            email_link_setting: true,
        },
        false,
    )
    .await;
    assert!(overview.providers.is_empty());
    assert!(manifest.providers.is_empty());
    assert!(overview
        .health
        .issues
        .contains(&HealthIssue::NoSignInProvider));
}

#[tokio::test]
async fn nobody_can_sign_in_exactly_when_the_overview_lists_no_sign_in_option() {
    for github in [false, true] {
        for mail in [false, true] {
            for email_link_setting in [false, true] {
                let setup = SignInSetup {
                    github,
                    mail,
                    email_link_setting,
                };
                let (overview, manifest) = overview_and_manifest(&setup).await;
                let case = format!("github {github}, mail {mail}, setting {email_link_setting}");
                assert_eq!(overview.providers, manifest.providers, "{case}");
                let expected = usize::from(github) + usize::from(mail && email_link_setting);
                assert_eq!(overview.providers.len(), expected, "{case}");
                assert_eq!(
                    overview
                        .health
                        .issues
                        .contains(&HealthIssue::NoSignInProvider),
                    overview.providers.is_empty(),
                    "{case}"
                );
            }
        }
    }
}

#[tokio::test]
async fn health_warns_when_the_data_folder_cannot_be_written() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = data_dir_config(&dir);
    config.data_dir = dir.path().join("missing").join("deeper");
    let app = test_app_with(config).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let overview: AdminOverview =
        parse(support::send_get(&app.router, OVERVIEW, token(&admin)).await);
    assert_eq!(overview.health.status, HealthStatus::Warning);
    assert!(overview
        .health
        .issues
        .contains(&HealthIssue::StorageNotWritable));
}

#[tokio::test]
async fn email_shows_as_configured_without_revealing_the_mail_password() {
    let app = test_app_with(support::config_with(&[
        (
            "OLEAFLY_SMTP_URL",
            "smtps://lab:very-secret-mail-password@smtp.uni.edu:465",
        ),
        ("OLEAFLY_MAIL_FROM", "Smith Lab <lab@uni.edu>"),
    ]))
    .await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let reply = support::send_get(&app.router, OVERVIEW, token(&admin)).await;
    let text = reply.body.to_string();
    assert!(!text.contains("very-secret-mail-password"));
    assert!(!text.contains("smtp.uni.edu"));
    let overview: AdminOverview = parse(reply);
    assert!(overview.email_configured);
}

#[tokio::test]
async fn files_in_a_bucket_show_as_s3_without_the_bucket_secret() {
    let bucket = MockS3::start().await;
    let mut config = test_config();
    config.blob_store = BlobStoreConfig::S3(Box::new(bucket.config("oleafly")));
    let app = test_app_with(config).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let reply = support::send_get(&app.router, OVERVIEW, token(&admin)).await;
    assert!(!reply.body.to_string().contains(MOCK_S3_SECRET_ACCESS_KEY));
    let overview: AdminOverview = parse(reply);
    assert_eq!(
        overview.storage.expect("admins see storage").files_location,
        FilesLocation::S3
    );
}

#[tokio::test]
async fn the_projects_list_describes_each_project() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let editor = seed_member(&app, ServerRole::Member).await;
    let project = seed_project(
        &app,
        admin.account_id,
        Seed {
            snapshot_bytes: 1_000,
            file_bytes: 250,
            output_bytes: 400,
            members: vec![editor.account_id],
            ..Seed::active("Thesis", 10 * MINUTE)
        },
    )
    .await;
    add_update(&app, project, &admin, 20 * MINUTE).await;

    let listed = page(&app, &admin, "").await;
    assert_eq!(listed.total, 1);
    assert_eq!(listed.next_cursor, None);
    let item: &AdminProject = &listed.items[0];
    assert_eq!(item.project_id, project);
    assert_eq!(item.title, "Thesis");
    assert_eq!(item.owner.account_id, admin.account_id);
    assert_eq!(item.owner.display_name, "Seeded admin");
    assert_eq!(item.owner.email, None);
    assert_eq!(item.status, ProjectStatus::Active);
    assert_eq!(item.member_count, 2);
    assert_eq!(item.size_bytes, Some(1_650));
    assert_eq!(item.created_at, 10 * MINUTE);
    assert_eq!(item.last_activity_at, 20 * MINUTE);
    assert_eq!(item.archived_at, None);
}

#[tokio::test]
async fn the_projects_list_pages_through_every_project() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    for (index, title) in ["A", "B", "C", "D", "E"].into_iter().enumerate() {
        let created = i64::try_from(index).unwrap() + 1;
        seed_project(&app, admin.account_id, Seed::active(title, created)).await;
    }
    let first = page(&app, &admin, "?sort=title&order=asc&limit=2").await;
    assert_eq!(titles(&first), vec!["A", "B"]);
    assert_eq!(first.total, 5);
    let cursor = first.next_cursor.clone().expect("more pages");
    let second = page(
        &app,
        &admin,
        &format!("?sort=title&order=asc&limit=2&cursor={cursor}"),
    )
    .await;
    assert_eq!(titles(&second), vec!["C", "D"]);
    let cursor = second.next_cursor.clone().expect("one more page");
    let last = page(
        &app,
        &admin,
        &format!("?sort=title&order=asc&limit=2&cursor={cursor}"),
    )
    .await;
    assert_eq!(titles(&last), vec!["E"]);
    assert_eq!(last.next_cursor, None);
    let default = page(&app, &admin, "").await;
    assert_eq!(default.items.len(), 5);
    assert_eq!(titles(&default)[0], "E");
}

#[tokio::test]
async fn the_projects_list_refuses_pages_out_of_bounds() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let long = "x".repeat(201);
    for query in [
        "?limit=0".to_string(),
        "?limit=101".to_string(),
        "?limit=ten".to_string(),
        "?cursor=-1".to_string(),
        "?cursor=next".to_string(),
        "?cursor=1000001".to_string(),
        "?sort=colour".to_string(),
        "?order=up".to_string(),
        "?status=deleted".to_string(),
        format!("?q={long}"),
    ] {
        let reply =
            support::send_get(&app.router, &format!("{PROJECTS}{query}"), token(&admin)).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{query}");
        assert_eq!(reply.body["code"], "bad_request", "{query}");
    }
    let most = page(&app, &admin, "?limit=100").await;
    assert!(most.items.is_empty());
    let past_the_end = page(&app, &admin, "?cursor=40").await;
    assert!(past_the_end.items.is_empty());
    assert_eq!(past_the_end.next_cursor, None);
}

#[tokio::test]
async fn the_projects_list_searches_titles_and_owners_ignoring_case() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let other = seed_member(&app, ServerRole::Member).await;
    let other_id = other.account_id;
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET display_name = 'Zoë Ångström' WHERE id = ?1",
                [other_id.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    seed_project(&app, admin.account_id, Seed::active("Über Thesis", 1)).await;
    seed_project(&app, other.account_id, Seed::active("Grant report", 2)).await;
    seed_project(&app, admin.account_id, Seed::active("Notes", 3)).await;

    assert_eq!(
        titles(&page(&app, &admin, "?q=%C3%BCBER").await),
        vec!["Über Thesis"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?q=%C3%A5ngstr").await),
        vec!["Grant report"]
    );
    let none = page(&app, &admin, "?q=missing").await;
    assert!(none.items.is_empty());
    assert_eq!(none.total, 0);
    assert_eq!(page(&app, &admin, "?q=%20%20").await.total, 3);
}

#[tokio::test]
async fn the_projects_list_sorts_and_filters() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let amy = seed_member(&app, ServerRole::Member).await;
    let amy_id = amy.account_id;
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET display_name = 'Amy' WHERE id = ?1",
                [amy_id.to_string()],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let big = seed_project(
        &app,
        admin.account_id,
        Seed {
            snapshot_bytes: 9_000,
            members: vec![amy.account_id],
            ..Seed::active("Big", 1)
        },
    )
    .await;
    seed_project(
        &app,
        amy.account_id,
        Seed {
            snapshot_bytes: 10,
            ..Seed::active("Small", 2)
        },
    )
    .await;
    seed_project(
        &app,
        admin.account_id,
        Seed {
            status: ProjectStatus::Archived,
            snapshot_bytes: 500,
            ..Seed::active("Archived", 3)
        },
    )
    .await;
    add_update(&app, big, &admin, 50).await;

    assert_eq!(
        titles(&page(&app, &admin, "?sort=title").await),
        vec!["Archived", "Big", "Small"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=title&order=desc").await),
        vec!["Small", "Big", "Archived"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=size&order=desc").await),
        vec!["Big", "Archived", "Small"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=members&order=desc").await)[0],
        "Big"
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=activity&order=desc").await),
        vec!["Big", "Archived", "Small"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=created&order=asc").await),
        vec!["Big", "Small", "Archived"]
    );
    assert_eq!(
        titles(&page(&app, &admin, "?sort=owner&order=asc").await)[0],
        "Small"
    );
    assert_eq!(
        titles(&page(&app, &admin, "?status=archived").await),
        vec!["Archived"]
    );
    let active = page(&app, &admin, "?status=active&sort=title").await;
    assert_eq!(titles(&active), vec!["Big", "Small"]);
    assert_eq!(active.total, 2);
}

#[tokio::test]
async fn admins_archive_and_unarchive_a_project_and_both_are_logged() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let project = seed_project(&app, owner.account_id, Seed::active("Thesis", 1)).await;
    let (inside, mut frames, _controls) = room_member(7, owner.account_id);
    app.state.rooms.join(project, inside);

    let archived: AdminProject = parse(
        support::send(
            &app.router,
            Method::POST,
            &archive_path(project),
            token(&admin),
            None,
        )
        .await,
    );
    assert_eq!(archived.status, ProjectStatus::Archived);
    assert_eq!(archived.archived_at, Some(app.clock.now_ms()));
    assert_eq!(
        frames.try_recv().ok(),
        Some(ServerFrame::ProjectArchived {
            project_id: project
        })
    );
    assert_eq!(app.state.rooms.size(project), 0);
    let again: AdminProject = parse(
        support::send(
            &app.router,
            Method::POST,
            &archive_path(project),
            token(&admin),
            None,
        )
        .await,
    );
    assert_eq!(again.status, ProjectStatus::Archived);

    app.clock.advance(MINUTE);
    let restored: AdminProject = parse(
        support::send(
            &app.router,
            Method::POST,
            &unarchive_path(project),
            token(&admin),
            None,
        )
        .await,
    );
    assert_eq!(restored.status, ProjectStatus::Active);
    assert_eq!(restored.archived_at, None);
    let again: AdminProject = parse(
        support::send(
            &app.router,
            Method::POST,
            &unarchive_path(project),
            token(&admin),
            None,
        )
        .await,
    );
    assert_eq!(again.status, ProjectStatus::Active);

    let events = logged(&app).await;
    assert_eq!(
        logged_kinds(&events),
        vec!["project_unarchived", "project_archived"]
    );
    for event in &events {
        assert_eq!(event.actor, Some(admin.account_id));
        assert_eq!(event.target.as_deref(), Some(project.to_string().as_str()));
        assert_eq!(event.detail["title"], Value::from("Thesis"));
        assert_eq!(event.detail["by_admin"], Value::Bool(true));
    }
    let owner_list = support::send_get(&app.router, "/api/v1/projects", token(&owner)).await;
    assert_eq!(owner_list.body.as_array().map(Vec::len), Some(1));
}

#[tokio::test]
async fn unarchiving_needs_a_project_that_finished_uploading() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let draft = seed_project(
        &app,
        admin.account_id,
        Seed {
            status: ProjectStatus::Pending,
            ..Seed::active("Draft", 1)
        },
    )
    .await;
    let still_pending = support::send(
        &app.router,
        Method::POST,
        &unarchive_path(draft),
        token(&admin),
        None,
    )
    .await;
    assert_eq!(still_pending.status, StatusCode::CONFLICT);
    parse::<AdminProject>(
        support::send(
            &app.router,
            Method::POST,
            &archive_path(draft),
            token(&admin),
            None,
        )
        .await,
    );
    let reply = support::send(
        &app.router,
        Method::POST,
        &unarchive_path(draft),
        token(&admin),
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert_eq!(reply.body["code"], "conflict");
}

#[tokio::test]
async fn archiving_an_unknown_or_malformed_project_fails_cleanly() {
    let app = test_app().await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    for path in [archive_path(UNKNOWN_ID), unarchive_path(UNKNOWN_ID)] {
        let reply = support::send(&app.router, Method::POST, &path, token(&admin), None).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
    }
    let reply = support::send(
        &app.router,
        Method::POST,
        &archive_path("not-an-id"),
        token(&admin),
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert!(logged(&app).await.is_empty());
}
