mod people;

use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectMember, ProjectRole, ProjectStatus, ProjectSummary,
};
use oleafly_server::blobs::sha256_hex;
use oleafly_server::test_support::security_event_kinds;
use people::{call, create_project, grant, put_bytes, read, share_project, stage};
use reqwest::{Method, StatusCode};
use serde_json::json;

#[tokio::test]
async fn a_project_goes_live_only_after_its_first_snapshot() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let created = create_project(server, bob, "  Thesis  ").await;
    assert_eq!(created.title, "Thesis");
    assert_eq!(created.status, ProjectStatus::Pending);
    assert_eq!(created.role, ProjectRole::Owner);
    let project = created.project_id;
    let commit = format!("/api/v1/projects/{project}/commit");
    assert_eq!(
        call(server, Method::POST, &commit, bob.token(), None)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let show = format!("/api/v1/projects/{project}");
    assert_eq!(
        call(server, Method::GET, &show, alice.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let listed: Vec<ProjectSummary> =
        read(call(server, Method::GET, "/api/v1/projects", bob.token(), None).await).await;
    assert!(listed.is_empty());
    let snapshot = format!("/api/v1/projects/{project}/snapshot?seq=0");
    assert_eq!(
        put_bytes(server, &snapshot, bob.token(), b"snapshot".to_vec())
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let live: ProjectSummary =
        read(call(server, Method::POST, &commit, bob.token(), None).await).await;
    assert_eq!(live.status, ProjectStatus::Active);
    let listed: Vec<ProjectSummary> =
        read(call(server, Method::GET, "/api/v1/projects", bob.token(), None).await).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].owner.display_name, "Bob Smith");
    assert!(security_event_kinds(server)
        .await
        .contains(&SecurityEventKind::ProjectShared));
}

#[tokio::test]
async fn a_title_must_not_be_empty() {
    let stage = stage().await;
    let response = call(
        &stage.server,
        Method::POST,
        "/api/v1/projects",
        stage.bob.token(),
        Some(json!({ "title": "   " })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn snapshots_round_trip_and_cannot_run_ahead_of_the_log() {
    let stage = stage().await;
    let (server, bob) = (&stage.server, &stage.bob);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let ahead = format!("/api/v1/projects/{project}/snapshot?seq=5");
    assert_eq!(
        put_bytes(server, &ahead, bob.token(), b"later".to_vec())
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let response = call(
        server,
        Method::GET,
        &format!("/api/v1/projects/{project}/snapshot"),
        bob.token(),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("x-oleafly-snapshot-seq")
            .and_then(|value| value.to_str().ok()),
        Some("0")
    );
    assert_eq!(
        response.bytes().await.expect("bytes").as_ref(),
        b"first snapshot"
    );
}

#[tokio::test]
async fn files_are_checked_against_their_hash_and_read_only_by_members() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let figure = b"figure bytes".to_vec();
    let hash = sha256_hex(&figure);
    let path = format!("/api/v1/projects/{project}/blobs/{hash}");
    let wrong = format!("/api/v1/projects/{project}/blobs/{}", sha256_hex(b"other"));
    assert_eq!(
        put_bytes(server, &wrong, bob.token(), figure.clone())
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        put_bytes(server, &path, bob.token(), figure.clone())
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let fetched = call(server, Method::GET, &path, bob.token(), None).await;
    assert_eq!(fetched.bytes().await.expect("bytes").to_vec(), figure);
    assert_eq!(
        call(server, Method::GET, &path, alice.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Viewer)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        call(server, Method::GET, &path, alice.token(), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        put_bytes(server, &path, alice.token(), figure)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn the_owner_adds_changes_and_removes_people() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let added: ProjectMember =
        read(grant(server, bob, project, alice, ProjectRole::Editor).await).await;
    assert_eq!(added.role, ProjectRole::Editor);
    assert_eq!(added.person.email.as_deref(), Some("alice@uni.edu"));
    let members_path = format!("/api/v1/projects/{project}/members");
    let members: Vec<ProjectMember> =
        read(call(server, Method::GET, &members_path, alice.token(), None).await).await;
    assert_eq!(members.len(), 2);
    let shared: Vec<ProjectSummary> =
        read(call(server, Method::GET, "/api/v1/projects", alice.token(), None).await).await;
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].role, ProjectRole::Editor);
    assert_eq!(
        grant(server, bob, project, alice, ProjectRole::Owner)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        grant(server, alice, project, bob, ProjectRole::Viewer)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let changed: ProjectMember =
        read(grant(server, bob, project, alice, ProjectRole::Viewer).await).await;
    assert_eq!(changed.role, ProjectRole::Viewer);
    let owner_path = format!(
        "/api/v1/projects/{project}/members/{}",
        bob.tokens.account_id
    );
    assert_eq!(
        call(server, Method::DELETE, &owner_path, bob.token(), None)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let alice_path = format!(
        "/api/v1/projects/{project}/members/{}",
        alice.tokens.account_id
    );
    assert_eq!(
        call(server, Method::DELETE, &alice_path, alice.token(), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let shared: Vec<ProjectSummary> =
        read(call(server, Method::GET, "/api/v1/projects", alice.token(), None).await).await;
    assert!(shared.is_empty());
    let kinds = security_event_kinds(server).await;
    for kind in [
        SecurityEventKind::ProjectAccessGranted,
        SecurityEventKind::ProjectAccessChanged,
        SecurityEventKind::ProjectAccessRemoved,
    ] {
        assert!(kinds.contains(&kind), "missing {kind:?}");
    }
}

#[tokio::test]
async fn a_link_lets_signed_in_people_join_with_the_link_role() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    let join = format!("/api/v1/projects/{project}/join");
    assert_eq!(
        call(server, Method::POST, &join, alice.token(), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let show = format!("/api/v1/projects/{project}");
    assert_eq!(
        call(
            server,
            Method::PATCH,
            &show,
            bob.token(),
            Some(json!({ "link_role": "owner" }))
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let linked: ProjectSummary = read(
        call(
            server,
            Method::PATCH,
            &show,
            bob.token(),
            Some(json!({ "link_sharing": true, "link_role": "editor" })),
        )
        .await,
    )
    .await;
    assert!(linked.link_sharing);
    assert_eq!(linked.link_role, ProjectRole::Editor);
    let joined: ProjectSummary =
        read(call(server, Method::POST, &join, alice.token(), None).await).await;
    assert_eq!(joined.role, ProjectRole::Editor);
    let again: ProjectSummary =
        read(call(server, Method::POST, &join, alice.token(), None).await).await;
    assert_eq!(again.role, ProjectRole::Editor);
    assert_eq!(
        call(
            server,
            Method::PATCH,
            &show,
            alice.token(),
            Some(json!({ "link_sharing": false }))
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn stopping_sharing_archives_the_project_for_everyone() {
    let stage = stage().await;
    let (server, bob, alice) = (&stage.server, &stage.bob, &stage.alice);
    let project = share_project(server, bob, "Thesis").await.project_id;
    grant(server, bob, project, alice, ProjectRole::Editor).await;
    let archive = format!("/api/v1/projects/{project}/archive");
    assert_eq!(
        call(server, Method::POST, &archive, alice.token(), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(server, Method::POST, &archive, bob.token(), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    for person in [bob, alice] {
        let listed: Vec<ProjectSummary> = read(
            call(
                server,
                Method::GET,
                "/api/v1/projects",
                person.token(),
                None,
            )
            .await,
        )
        .await;
        assert!(listed.is_empty());
    }
    let hash = sha256_hex(b"late");
    let path = format!("/api/v1/projects/{project}/blobs/{hash}");
    assert_eq!(
        put_bytes(server, &path, alice.token(), b"late".to_vec())
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert!(security_event_kinds(server)
        .await
        .contains(&SecurityEventKind::ProjectArchived));
}

#[tokio::test]
async fn the_directory_finds_other_people_by_name() {
    let stage = stage().await;
    let (server, bob) = (&stage.server, &stage.bob);
    let found: Vec<PersonSummary> = read(
        call(
            server,
            Method::GET,
            "/api/v1/directory?q=ali",
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].display_name, "Alice Chen");
    let mine: Vec<PersonSummary> = read(
        call(
            server,
            Method::GET,
            "/api/v1/directory?q=bob",
            bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(mine.is_empty());
}

#[tokio::test]
async fn the_link_page_offers_to_open_the_project_in_the_app() {
    let stage = stage().await;
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let page = reqwest::get(format!("{}/p/{project}", stage.server.url()))
        .await
        .expect("landing page");
    assert_eq!(page.status(), StatusCode::OK);
    let html = page.text().await.expect("html");
    assert!(html.contains("oleafly://open?server="));
    assert!(html.contains(&project.to_string()));
    assert!(html.contains("https://oleafly.com/download"));
    let missing = reqwest::get(format!("{}/p/not-an-id", stage.server.url()))
        .await
        .expect("landing page");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn unshared_drafts_are_removed_after_a_day() {
    let stage = stage().await;
    let (server, bob) = (&stage.server, &stage.bob);
    create_project(server, bob, "Abandoned").await;
    let live = share_project(server, bob, "Thesis").await.project_id;
    server.clock().advance(2 * 24 * 60 * 60 * 1000);
    let report = server.state().run_maintenance().await.expect("maintenance");
    assert_eq!(report.expired_projects, 1);
    let kept = server
        .state()
        .db
        .call(move |conn| oleafly_server::projects::project_row(conn, live))
        .await
        .expect("project row")
        .expect("the shared project stays");
    assert_eq!(kept.status, ProjectStatus::Active);
}
