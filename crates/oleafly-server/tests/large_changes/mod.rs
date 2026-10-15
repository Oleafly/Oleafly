#![allow(dead_code)]

use loro::{ExportMode, LoroDoc};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::projects;
use reqwest::StatusCode;

use crate::people::{self, first_snapshot, grant, share_project, signed_by, Stage};

pub async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    project
}

fn filler(round: u64, bytes: usize) -> String {
    let mut text = String::with_capacity(bytes);
    let mut state = round.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    while text.len() < bytes {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        text.push(char::from(b'a' + (state % 26) as u8));
    }
    text
}

pub async fn append_large_changes(
    stage: &Stage,
    doc: &LoroDoc,
    project: SharedProjectId,
    rounds: std::ops::RangeInclusive<u64>,
    bytes: usize,
) {
    let person = &stage.alice;
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    let mut stored = Vec::new();
    for round in rounds {
        let before = doc.oplog_vv();
        let field = doc.get_text("text");
        field
            .insert(field.len_unicode(), &filler(round, bytes))
            .expect("insert");
        doc.commit();
        let update = doc.export(ExportMode::updates(&before)).expect("update");
        let envelope = signed_by(person, &person.device, project, &update);
        stored.push((
            envelope.batch_id,
            serde_json::to_vec(&envelope).expect("json"),
            update,
        ));
    }
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            for (batch, envelope, update) in stored {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &envelope, 1)?;
            }
            Ok(())
        })
        .await
        .expect("append changes");
}

pub fn opened_doc() -> LoroDoc {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    doc
}

const SEQ_HEADER: &str = "x-oleafly-snapshot-seq";

pub async fn hinted(stage: &Stage, project: SharedProjectId, seq: u64) -> Option<u64> {
    let response = people::put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{project}/snapshot?seq={seq}"),
        stage.alice.token(),
        Vec::new(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    response
        .headers()
        .get(SEQ_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

pub async fn newest_snapshot(stage: &Stage, project: SharedProjectId) -> (Option<u64>, Vec<u8>) {
    let response = people::call(
        &stage.server,
        reqwest::Method::GET,
        &format!("/api/v1/projects/{project}/snapshot"),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let seq = response
        .headers()
        .get(SEQ_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok());
    (seq, response.bytes().await.expect("body").to_vec())
}

pub async fn kept_from(stage: &Stage, project: SharedProjectId) -> Option<u64> {
    stage
        .server
        .state()
        .db
        .call(move |conn| projects::oldest_kept_update(conn, project))
        .await
        .expect("oldest kept")
}

pub fn build_every(stage: &Stage, changes: u64) {
    stage
        .server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: changes,
            keep_updates: changes,
        });
}

pub fn budget(stage: &Stage, memory_bytes: u64, max_snapshot_bytes: u64) {
    stage
        .server
        .state()
        .snapshots
        .set_budget(oleafly_server::snapshots::Budget {
            memory_bytes,
            max_snapshot_bytes,
        });
}
