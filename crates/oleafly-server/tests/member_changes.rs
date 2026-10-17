mod people;

use oleafly_collab_protocol::frames::{MemberChange, MemberChangeKind, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{ProjectPatch, ProjectRole, ProjectSummary};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{seed_person, PersonSeed, TestDevice};
use people::{
    call, connect, grant, next_frame, read, share_project, stage, subscribe, Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};

async fn carol(stage: &Stage) -> Person {
    let device = TestDevice::generate();
    let tokens = seed_person(
        stage.server.state(),
        PersonSeed {
            name: "Carol Diaz".to_owned(),
            email: "carol@uni.edu".to_owned(),
            role: ServerRole::Member,
            device_public_key: device.public_key_b64().to_owned(),
            device_name: "Carol's laptop".to_owned(),
        },
    )
    .await
    .expect("carol is seeded");
    Person { device, tokens }
}

async fn shared_with(stage: &Stage, people: &[&Person]) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    for person in people {
        let granted = grant(
            &stage.server,
            &stage.bob,
            project,
            person,
            ProjectRole::Editor,
        )
        .await;
        assert_eq!(granted.status(), StatusCode::OK);
    }
    project
}

async fn watching(stage: &Stage, person: &Person, project: SharedProjectId) -> Socket {
    let mut socket = connect(&stage.server, person).await;
    assert!(matches!(
        subscribe(&mut socket, project, 0).await,
        ServerFrame::Subscribed { .. }
    ));
    socket
}

async fn remove(stage: &Stage, by: &Person, who: &Person, project: SharedProjectId) {
    let path = format!(
        "/api/v1/projects/{project}/members/{}",
        who.tokens.account_id
    );
    let response = call(&stage.server, Method::DELETE, &path, by.token(), None).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

fn told(
    project: SharedProjectId,
    role: ProjectRole,
    who: &Person,
    by: &Person,
    kind: MemberChangeKind,
) -> Option<ServerFrame> {
    Some(ServerFrame::AccessChanged {
        project_id: project,
        role: Some(role),
        change: Some(MemberChange {
            account_id: who.tokens.account_id,
            by: by.tokens.account_id,
            kind,
        }),
        comments: None,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_others_hear_who_removed_whom() {
    let stage = stage().await;
    let carol = carol(&stage).await;
    let project = shared_with(&stage, &[&stage.alice, &carol]).await;
    let mut watcher = watching(&stage, &carol, project).await;
    remove(&stage, &stage.bob, &stage.alice, project).await;
    assert_eq!(
        next_frame(&mut watcher).await,
        told(
            project,
            ProjectRole::Editor,
            &stage.alice,
            &stage.bob,
            MemberChangeKind::Removed
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_owner_who_removed_someone_hears_it_too() {
    let stage = stage().await;
    let project = shared_with(&stage, &[&stage.alice]).await;
    let mut owner = watching(&stage, &stage.bob, project).await;
    remove(&stage, &stage.bob, &stage.alice, project).await;
    assert_eq!(
        next_frame(&mut owner).await,
        told(
            project,
            ProjectRole::Owner,
            &stage.alice,
            &stage.bob,
            MemberChangeKind::Removed
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_removed_person_hears_who_removed_them() {
    let stage = stage().await;
    let project = shared_with(&stage, &[&stage.alice]).await;
    let mut removed = watching(&stage, &stage.alice, project).await;
    remove(&stage, &stage.bob, &stage.alice, project).await;
    assert_eq!(
        next_frame(&mut removed).await,
        Some(ServerFrame::AccessChanged {
            project_id: project,
            role: None,
            change: Some(MemberChange {
                account_id: stage.alice.tokens.account_id,
                by: stage.bob.tokens.account_id,
                kind: MemberChangeKind::Removed,
            }),
            comments: None,
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_others_hear_when_someone_leaves() {
    let stage = stage().await;
    let carol = carol(&stage).await;
    let project = shared_with(&stage, &[&stage.alice, &carol]).await;
    let mut watcher = watching(&stage, &carol, project).await;
    remove(&stage, &stage.alice, &stage.alice, project).await;
    assert_eq!(
        next_frame(&mut watcher).await,
        told(
            project,
            ProjectRole::Editor,
            &stage.alice,
            &stage.alice,
            MemberChangeKind::Removed
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_others_hear_who_added_whom() {
    let stage = stage().await;
    let carol = carol(&stage).await;
    let project = shared_with(&stage, &[&carol]).await;
    let mut watcher = watching(&stage, &carol, project).await;
    let granted = grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(granted.status(), StatusCode::OK);
    assert_eq!(
        next_frame(&mut watcher).await,
        told(
            project,
            ProjectRole::Editor,
            &stage.alice,
            &stage.bob,
            MemberChangeKind::Added
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_others_hear_about_a_new_role() {
    let stage = stage().await;
    let carol = carol(&stage).await;
    let project = shared_with(&stage, &[&stage.alice, &carol]).await;
    let mut watcher = watching(&stage, &carol, project).await;
    let changed = grant(
        &stage.server,
        &stage.bob,
        project,
        &stage.alice,
        ProjectRole::Viewer,
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    assert_eq!(
        next_frame(&mut watcher).await,
        told(
            project,
            ProjectRole::Editor,
            &stage.alice,
            &stage.bob,
            MemberChangeKind::RoleChanged
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_others_hear_when_someone_joins_with_the_link() {
    let stage = stage().await;
    let carol = carol(&stage).await;
    let project = shared_with(&stage, &[&carol]).await;
    let patch = ProjectPatch {
        link_sharing: Some(true),
        link_role: Some(ProjectRole::Editor),
        ..ProjectPatch::default()
    };
    read::<ProjectSummary>(
        call(
            &stage.server,
            Method::PATCH,
            &format!("/api/v1/projects/{project}"),
            stage.bob.token(),
            Some(serde_json::to_value(patch).expect("json")),
        )
        .await,
    )
    .await;
    let mut watcher = watching(&stage, &carol, project).await;
    let joined = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/join"),
        stage.alice.token(),
        None,
    )
    .await;
    assert_eq!(joined.status(), StatusCode::OK);
    assert_eq!(
        next_frame(&mut watcher).await,
        told(
            project,
            ProjectRole::Editor,
            &stage.alice,
            &stage.alice,
            MemberChangeKind::Added
        )
    );
}
