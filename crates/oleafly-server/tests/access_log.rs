mod people;

use oleafly_collab_protocol::access_log::{AccessEntry, AccessKind, JoinedVia};
use oleafly_collab_protocol::admin::{Page, SecurityEventKind};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::{CapabilityManifest, PROTOCOL_VERSION};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    PollBatch, DEVICE_HEADER, NONCE_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectSummary};
use oleafly_server::access_log::{self, Visit};
use oleafly_server::state::DAY_MS;
use oleafly_server::test_support::{challenge_nonce, security_event_kinds, TestServer};
use people::{call, connect, create_project, grant, read, share_project, stage, subscribe, Person};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};

fn log_path(project: SharedProjectId) -> String {
    format!("/api/v1/projects/{project}/access-log")
}

async fn patch(
    server: &TestServer,
    person: &Person,
    project: SharedProjectId,
    body: Value,
) -> reqwest::Response {
    call(
        server,
        Method::PATCH,
        &format!("/api/v1/projects/{project}"),
        person.token(),
        Some(body),
    )
    .await
}

async fn turn_on(server: &TestServer, owner: &Person, project: SharedProjectId) -> ProjectSummary {
    read(patch(server, owner, project, json!({ "access_log": true })).await).await
}

async fn entries(
    server: &TestServer,
    owner: &Person,
    project: SharedProjectId,
) -> Vec<AccessEntry> {
    let page: Page<AccessEntry> =
        read(call(server, Method::GET, &log_path(project), owner.token(), None).await).await;
    page.items
}

fn kinds(listed: &[AccessEntry]) -> Vec<(AccessKind, Option<JoinedVia>)> {
    listed.iter().map(|entry| (entry.kind, entry.via)).collect()
}

async fn download(server: &TestServer, person: &Person, project: SharedProjectId) {
    let response = call(
        server,
        Method::GET,
        &format!("/api/v1/projects/{project}/snapshot"),
        person.token(),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

async fn allow(server: &TestServer, admin: &Person, allowed: bool) {
    let response = call(
        server,
        Method::PATCH,
        "/api/v1/admin/settings",
        admin.token(),
        Some(json!({ "access_logs_allowed": allowed })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

async fn stored(server: &TestServer) -> i64 {
    server
        .state()
        .db
        .call(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM project_access_log", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            )
        })
        .await
        .unwrap()
}

async fn open_by_polling(server: &TestServer, person: &Person, project: SharedProjectId) {
    let nonce = challenge_nonce(server).await;
    let signature = person.device.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    let response = reqwest::Client::new()
        .get(format!("{}/api/v1/projects/{project}/poll", server.url()))
        .query(&[("since", "0")])
        .bearer_auth(person.token())
        .header(DEVICE_HEADER, person.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
        .send()
        .await
        .expect("open request");
    assert_eq!(response.status(), StatusCode::OK);
    let batch: PollBatch = response.json().await.expect("poll batch");
    assert!(
        matches!(batch.frames.first(), Some(ServerFrame::Subscribed { .. })),
        "{:?}",
        batch.frames
    );
}

#[tokio::test]
async fn the_log_is_off_until_the_owner_turns_it_on() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Editor)
            .await
            .status(),
        StatusCode::OK
    );
    download(server, alice, project).await;
    let mut socket = connect(server, alice).await;
    assert!(matches!(
        subscribe(&mut socket, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    assert!(entries(server, bob, project).await.is_empty());
    assert_eq!(stored(server).await, 0);
    let summary = turn_on(server, bob, project).await;
    assert!(summary.access_log);
    let seen: ProjectSummary = read(
        call(
            server,
            Method::GET,
            &format!("/api/v1/projects/{project}"),
            alice.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(seen.access_log);
    assert!(security_event_kinds(server)
        .await
        .contains(&SecurityEventKind::ProjectSettingsChanged));
}

#[tokio::test]
async fn the_owner_sees_who_joined_by_link_downloaded_and_opened_the_project() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    read::<ProjectSummary>(
        patch(
            server,
            bob,
            project,
            json!({ "link_sharing": true, "link_role": "editor" }),
        )
        .await,
    )
    .await;
    let joined = call(
        server,
        Method::POST,
        &format!("/api/v1/projects/{project}/join"),
        alice.token(),
        None,
    )
    .await;
    assert_eq!(joined.status(), StatusCode::OK);
    download(server, alice, project).await;
    let mut socket = connect(server, alice).await;
    assert!(matches!(
        subscribe(&mut socket, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    let listed = entries(server, bob, project).await;
    assert_eq!(
        kinds(&listed),
        [
            (AccessKind::Opened, None),
            (AccessKind::Downloaded, None),
            (AccessKind::Joined, Some(JoinedVia::Link)),
        ]
    );
    for entry in &listed {
        assert_eq!(entry.person.account_id, alice.tokens.account_id);
        assert_eq!(entry.person.display_name, "Alice Chen");
        assert_eq!(entry.device_name, "Test laptop");
        assert!(entry.at > 0);
    }
}

#[tokio::test]
async fn a_shared_project_counts_as_joined_at_the_first_download() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Viewer)
            .await
            .status(),
        StatusCode::OK
    );
    assert!(entries(server, bob, project).await.is_empty());
    download(server, alice, project).await;
    download(server, alice, project).await;
    let listed = entries(server, bob, project).await;
    assert_eq!(
        kinds(&listed),
        [
            (AccessKind::Downloaded, None),
            (AccessKind::Joined, Some(JoinedVia::Share)),
        ]
    );
    assert_eq!(listed[0].times, 2);
}

#[tokio::test]
async fn opening_the_project_over_long_polling_is_recorded_too() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    open_by_polling(server, bob, project).await;
    let listed = entries(server, bob, project).await;
    assert_eq!(kinds(&listed), [(AccessKind::Opened, None)]);
    assert_eq!(listed[0].person.account_id, bob.tokens.account_id);
    let _ = alice;
}

#[tokio::test]
async fn a_reconnecting_app_adds_one_entry_not_one_per_connection() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    grant(server, bob, project, alice, ProjectRole::Editor).await;
    for _ in 0..5 {
        let mut socket = connect(server, alice).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        open_by_polling(server, alice, project).await;
    }
    let listed = entries(server, bob, project).await;
    assert_eq!(kinds(&listed), [(AccessKind::Opened, None)]);
    assert_eq!(listed[0].times, 10);
    assert_eq!(stored(server).await, 1);
}

#[tokio::test]
async fn only_the_owner_reads_the_log_or_turns_it_on() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    let path = log_path(project);
    for role in [ProjectRole::Editor, ProjectRole::Viewer] {
        grant(server, bob, project, alice, role).await;
        assert_eq!(
            call(server, Method::GET, &path, alice.token(), None)
                .await
                .status(),
            StatusCode::FORBIDDEN,
            "{role:?}"
        );
        assert_eq!(
            patch(server, alice, project, json!({ "access_log": false }))
                .await
                .status(),
            StatusCode::FORBIDDEN,
            "{role:?}"
        );
    }
    let unsigned = reqwest::Client::new()
        .get(format!("{}{path}", server.url()))
        .send()
        .await
        .expect("request");
    assert_eq!(unsigned.status(), StatusCode::UNAUTHORIZED);
    let alices = share_project(server, alice, "Alice's notes")
        .await
        .project_id;
    let alices_path = log_path(alices);
    assert_eq!(
        call(server, Method::GET, &alices_path, bob.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    grant(server, alice, alices, bob, ProjectRole::Editor).await;
    assert_eq!(
        call(server, Method::GET, &alices_path, bob.token(), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let draft = create_project(server, bob, "Draft").await.project_id;
    assert_eq!(
        call(server, Method::GET, &log_path(draft), alice.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let missing = log_path(SharedProjectId::new_v7());
    assert_eq!(
        call(server, Method::GET, &missing, bob.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_server_that_disallows_access_logs_records_and_shows_nothing_but_keeps_old_entries() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    grant(server, bob, project, alice, ProjectRole::Editor).await;
    download(server, alice, project).await;
    assert_eq!(entries(server, bob, project).await.len(), 2);
    allow(server, bob, false).await;
    let manifest: CapabilityManifest = read(
        reqwest::Client::new()
            .get(format!("{}/.well-known/oleafly-server", server.url()))
            .send()
            .await
            .expect("manifest"),
    )
    .await;
    assert!(!manifest.features.access_logs);
    assert!(entries(server, bob, project).await.is_empty());
    let mut socket = connect(server, alice).await;
    assert!(matches!(
        subscribe(&mut socket, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    open_by_polling(server, bob, project).await;
    assert_eq!(stored(server).await, 2);
    assert_eq!(
        patch(server, bob, project, json!({ "access_log": true }))
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let off: ProjectSummary =
        read(patch(server, bob, project, json!({ "access_log": false })).await).await;
    assert!(!off.access_log);
    allow(server, bob, true).await;
    turn_on(server, bob, project).await;
    assert_eq!(entries(server, bob, project).await.len(), 2);
    let manifest: CapabilityManifest = read(
        reqwest::Client::new()
            .get(format!("{}/.well-known/oleafly-server", server.url()))
            .send()
            .await
            .expect("manifest"),
    )
    .await;
    assert!(manifest.features.access_logs);
}

#[tokio::test]
async fn the_log_pages_newest_first() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    let (account, device) = (alice.tokens.account_id, alice.tokens.device_id);
    let now = server.state().clock.now_ms();
    server
        .state()
        .db
        .call(move |conn| {
            for index in 0..5 {
                access_log::record(
                    conn,
                    now + index,
                    Visit::joined(project, account, device, JoinedVia::Share),
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let first: Page<AccessEntry> = read(
        call(
            server,
            Method::GET,
            &format!("{}?limit=2", log_path(project)),
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(
        first
            .items
            .iter()
            .map(|entry| entry.at - now)
            .collect::<Vec<_>>(),
        [4, 3]
    );
    let cursor = first.next_cursor.expect("a second page");
    let second: Page<AccessEntry> = read(
        call(
            server,
            Method::GET,
            &format!("{}?limit=2&cursor={cursor}", log_path(project)),
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(
        second
            .items
            .iter()
            .map(|entry| entry.at - now)
            .collect::<Vec<_>>(),
        [2, 1]
    );
    assert_eq!(
        call(
            server,
            Method::GET,
            &format!("{}?cursor=nope", log_path(project)),
            bob.token(),
            None,
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn maintenance_prunes_access_entries_older_than_the_security_log_keeps() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    turn_on(server, bob, project).await;
    let (account, device) = (alice.tokens.account_id, alice.tokens.device_id);
    let now = server.state().clock.now_ms();
    let keep_days = i64::from(server.state().config.security_log_days);
    server
        .state()
        .db
        .call(move |conn| {
            access_log::record(
                conn,
                now - (keep_days + 1) * DAY_MS,
                Visit::opened(project, account, device),
            )?;
            access_log::record(conn, now, Visit::downloaded(project, account, device))?;
            Ok(())
        })
        .await
        .unwrap();
    let report = server.state().run_maintenance().await.expect("maintenance");
    assert_eq!(report.access_events, 1);
    assert_eq!(
        kinds(&entries(server, bob, project).await),
        [(AccessKind::Downloaded, None)]
    );
}

#[tokio::test]
async fn the_owner_sees_emails_in_the_log_only_when_the_server_shows_them() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, alice, "Thesis").await.project_id;
    turn_on(server, alice, project).await;
    assert_eq!(
        grant(server, alice, project, bob, ProjectRole::Viewer)
            .await
            .status(),
        StatusCode::OK
    );
    download(server, bob, project).await;
    let shown = entries(server, alice, project).await;
    assert!(!shown.is_empty());
    assert!(shown.iter().all(|entry| entry.person.email.is_some()));
    let hidden = call(
        server,
        Method::PATCH,
        "/api/v1/admin/settings",
        bob.token(),
        Some(json!({ "directory_shows_email": false })),
    )
    .await;
    assert_eq!(hidden.status(), StatusCode::OK);
    let listed = entries(server, alice, project).await;
    assert_eq!(listed.len(), shown.len());
    assert!(listed.iter().all(|entry| entry.person.email.is_none()));
}
