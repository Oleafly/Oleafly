mod people;

use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::{ProjectPatch, ProjectRole, ProjectSummary};
use oleafly_server::clock::Clock;
use oleafly_server::state::DAY_MS;
use people::{call, read, share_project, stage, Person, Stage};
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
