mod people;

use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{ProjectMember, ProjectPatch, ProjectRole, ProjectSummary};
use oleafly_server::clock::Clock;
use oleafly_server::state::DAY_MS;
use oleafly_server::test_support::test_config;
use people::{call, read, seeded, share_project, stage, stage_with, Person, Stage};
use reqwest::{Method, StatusCode};

async fn link_shared(stage: &Stage) -> SharedProjectId {
    link_shared_by(stage, &stage.bob).await
}

async fn link_shared_by(stage: &Stage, owner: &Person) -> SharedProjectId {
    let project = share_project(&stage.server, owner, "Reef survey").await;
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
            owner.token(),
            Some(serde_json::to_value(patch).expect("json")),
        )
        .await,
    )
    .await;
    project.project_id
}

async fn knock(
    stage: &Stage,
    person: &Person,
    project: SharedProjectId,
    method: Method,
) -> StatusCode {
    call(
        &stage.server,
        method,
        &format!("/api/v1/projects/{project}/join"),
        person.token(),
        None,
    )
    .await
    .status()
}

async fn removed(stage: &Stage, project: SharedProjectId) {
    assert_eq!(
        knock(stage, &stage.alice, project, Method::POST).await,
        StatusCode::OK
    );
    let gone = call(
        &stage.server,
        Method::DELETE,
        &format!(
            "/api/v1/projects/{project}/members/{}",
            stage.alice.tokens.account_id
        ),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(gone.status(), StatusCode::NO_CONTENT);
}

async fn refusal_rows(stage: &Stage) -> Vec<serde_json::Value> {
    stage
        .server
        .state()
        .db
        .call(|conn| {
            let mut statement = conn.prepare(
                "SELECT detail FROM security_log WHERE kind = 'project_rejoin_refused' ORDER BY id",
            )?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
        .await
        .expect("security log rows")
        .iter()
        .map(|detail| serde_json::from_str(detail).expect("json detail"))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_member_knocking_again_and_again_leaves_one_row_with_a_count() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    removed(&stage, project).await;
    for attempt in 0..12 {
        let method = if attempt % 3 == 0 {
            Method::GET
        } else {
            Method::POST
        };
        assert_eq!(
            knock(&stage, &stage.alice, project, method).await,
            StatusCode::NOT_FOUND
        );
    }
    let rows = refusal_rows(&stage).await;
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0]["count"], 12);
    assert_eq!(rows[0]["via"], "link");

    stage.server.clock().advance(DAY_MS + 1);
    let (account, device) = (stage.alice.tokens.account_id, stage.alice.tokens.device_id);
    let now = stage.server.clock().now_ms();
    let (fresh, _) = stage
        .server
        .state()
        .db
        .call(move |conn| oleafly_server::tokens::issue_access_token(conn, account, device, now))
        .await
        .expect("a fresh access token");
    let next_day = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/join"),
        &fresh,
        None,
    )
    .await;
    assert_eq!(next_day.status(), StatusCode::NOT_FOUND);
    let rows = refusal_rows(&stage).await;
    assert_eq!(rows.len(), 2, "a new day starts a new row: {rows:?}");
    assert_eq!(rows[1]["count"], 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_account_asking_to_join_too_often_is_slowed_down_without_slowing_others() {
    let stage = stage().await;
    let project = link_shared(&stage).await;
    let mut answers = Vec::new();
    for _ in 0..40 {
        answers.push(knock(&stage, &stage.alice, project, Method::GET).await);
    }
    assert_eq!(answers[0], StatusCode::OK);
    assert!(
        answers.contains(&StatusCode::TOO_MANY_REQUESTS),
        "40 join previews in a row were all answered: {answers:?}"
    );
    assert_eq!(
        knock(&stage, &stage.bob, project, Method::GET).await,
        StatusCode::OK
    );
    stage.server.clock().advance(60_000);
    assert_eq!(
        knock(&stage, &stage.alice, project, Method::POST).await,
        StatusCode::OK
    );
}

async fn remove_from_server(stage: &Stage, person: &Person) {
    let removed = call(
        &stage.server,
        Method::DELETE,
        &format!("/api/v1/admin/members/{}", person.tokens.account_id),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_project_whose_owner_left_the_server_takes_no_one_new_and_shows_them_gone() {
    let stage = stage().await;
    let project = link_shared_by(&stage, &stage.alice).await;
    assert_eq!(
        knock(&stage, &stage.bob, project, Method::POST).await,
        StatusCode::OK
    );
    remove_from_server(&stage, &stage.alice).await;
    let carol = seeded(&stage.server, "Carol").await;
    for method in [Method::GET, Method::POST] {
        let refused = call(
            &stage.server,
            method,
            &format!("/api/v1/projects/{project}/join"),
            carol.token(),
            None,
        )
        .await;
        assert_eq!(refused.status(), StatusCode::CONFLICT);
        let body: serde_json::Value = refused.json().await.expect("json body");
        assert_eq!(body["code"], "owner_away");
    }
    let members: Vec<ProjectMember> = read(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}/members"),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    let active = |person: &Person| {
        members
            .iter()
            .find(|member| member.person.account_id == person.tokens.account_id)
            .map(|member| member.person.active)
    };
    assert_eq!(active(&stage.alice), Some(false));
    assert_eq!(active(&stage.bob), Some(true));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn someone_removed_from_the_server_no_longer_takes_a_seat() {
    let mut config = test_config();
    config.limits.max_members_per_project = 2;
    let stage = stage_with(config).await;
    let project = link_shared(&stage).await;
    assert_eq!(
        knock(&stage, &stage.alice, project, Method::POST).await,
        StatusCode::OK
    );
    let carol = seeded(&stage.server, "Carol").await;
    assert_eq!(
        knock(&stage, &carol, project, Method::POST).await,
        StatusCode::CONFLICT
    );
    remove_from_server(&stage, &stage.alice).await;
    assert_eq!(
        knock(&stage, &carol, project, Method::POST).await,
        StatusCode::OK
    );
}
