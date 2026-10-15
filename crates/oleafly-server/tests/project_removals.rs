mod people;
mod support;

use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{ProjectPatch, ProjectRole, ProjectSummary};
use oleafly_server::test_support::{security_event_kinds, test_config};
use people::{call, grant, read, share_project, stage, stage_with, Person, Stage};
use reqwest::{Method, StatusCode};

async fn link_shared(stage: &Stage) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Reef survey").await;
    let patch = ProjectPatch {
        link_sharing: Some(true),
        link_role: Some(ProjectRole::Editor),
        ..ProjectPatch::default()
    };
    read::<ProjectSummary>(
        call(
            &stage.server,
            Method::PATCH,
            &format!("/api/v1/projects/{}", project.project_id),
            stage.bob.token(),
            Some(serde_json::to_value(patch).expect("json")),
        )
        .await,
    )
    .await;
    project.project_id
}

async fn join(stage: &Stage, person: &Person, project: SharedProjectId) -> StatusCode {
    call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/join"),
        person.token(),
        None,
    )
    .await
    .status()
}

async fn remove(stage: &Stage, by: &Person, who: &Person, project: SharedProjectId) -> StatusCode {
    call(
        &stage.server,
        Method::DELETE,
        &format!(
            "/api/v1/projects/{project}/members/{}",
            who.tokens.account_id
        ),
        by.token(),
        None,
    )
    .await
    .status()
}

async fn refusals(stage: &Stage) -> usize {
    security_event_kinds(&stage.server)
        .await
        .into_iter()
        .filter(|kind| *kind == SecurityEventKind::ProjectRejoinRefused)
        .count()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn someone_the_owner_removed_cannot_rejoin_by_link() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    assert_eq!(
        remove(&stage, &stage.bob, &stage.alice, project).await,
        StatusCode::NO_CONTENT
    );
    let refused = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/join"),
        stage.alice.token(),
        None,
    )
    .await;
    assert_eq!(refused.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value = refused.json().await.expect("error body");
    assert_eq!(body["code"], "not_found");
    assert_eq!(refusals(&stage).await, 1);
    assert_eq!(
        join(&stage, &stage.alice, project).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(refusals(&stage).await, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_owner_adding_them_back_clears_the_removal() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    remove(&stage, &stage.bob, &stage.alice, project).await;
    assert_eq!(
        join(&stage, &stage.alice, project).await,
        StatusCode::NOT_FOUND
    );
    let added = grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(added.status(), StatusCode::OK);
    assert_eq!(
        remove(&stage, &stage.alice, &stage.alice, project).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn leaving_by_choice_does_not_block_rejoining() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    assert_eq!(
        remove(&stage, &stage.alice, &stage.alice, project).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    assert_eq!(refusals(&stage).await, 0);
}

async fn preview(stage: &Stage, person: &Person, project: SharedProjectId) -> reqwest::Response {
    call(
        &stage.server,
        Method::GET,
        &format!("/api/v1/projects/{project}/join"),
        person.token(),
        None,
    )
    .await
}

async fn granted(stage: &Stage) -> usize {
    security_event_kinds(&stage.server)
        .await
        .into_iter()
        .filter(|kind| *kind == SecurityEventKind::ProjectAccessGranted)
        .count()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_link_preview_names_the_project_without_joining_it() {
    let stage = stage().await;
    let unlinked = share_project(&stage.server, &stage.bob, "Field notes")
        .await
        .project_id;
    assert_eq!(
        preview(&stage, &stage.alice, unlinked).await.status(),
        StatusCode::NOT_FOUND
    );
    let project = link_shared(&stage).await;
    let before = granted(&stage).await;
    let shown: ProjectSummary = read(preview(&stage, &stage.alice, project).await).await;
    assert_eq!(shown.project_id, project);
    assert_eq!(shown.title, "Reef survey");
    assert_eq!(shown.owner.display_name, "Bob Smith");
    assert_eq!(shown.owner.email, None);
    assert_eq!(shown.role, ProjectRole::Editor);
    assert_eq!(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}"),
            stage.alice.token(),
            None,
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(granted(&stage).await, before);
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    assert_eq!(granted(&stage).await, before + 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_previewing_the_link_sees_their_own_role() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    let added = grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(added.status(), StatusCode::OK);
    let shown: ProjectSummary = read(preview(&stage, &stage.alice, project).await).await;
    assert_eq!(shown.role, ProjectRole::Viewer);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_link_preview_refuses_someone_the_owner_removed_and_logs_the_try() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    assert_eq!(join(&stage, &stage.alice, project).await, StatusCode::OK);
    remove(&stage, &stage.bob, &stage.alice, project).await;
    let refused = preview(&stage, &stage.alice, project).await;
    assert_eq!(refused.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value = refused.json().await.expect("error body");
    assert_eq!(body["code"], "not_found");
    assert_eq!(refusals(&stage).await, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_link_preview_says_when_the_project_is_full() {
    let mut config = test_config();
    config.limits.max_members_per_project = 1;
    let stage = stage_with(config).await;
    let project = link_shared(&stage).await;
    assert_eq!(
        preview(&stage, &stage.alice, project).await.status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        join(&stage, &stage.alice, project).await,
        StatusCode::CONFLICT
    );
}
