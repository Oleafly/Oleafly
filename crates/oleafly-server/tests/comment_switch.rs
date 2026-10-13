mod people;

use loro::{ExportMode, LoroDoc, LoroMap};
use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use people::{
    call, connect, first_snapshot, grant, next_frame, raw_envelope, send_update, share_project,
    stage, subscribe, Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;

const COMMENTS_OFF: &str = "Comments are turned off for this project.";

struct Writer {
    doc: LoroDoc,
    socket: Socket,
    last: Vec<u8>,
}

impl Writer {
    async fn open(stage: &Stage, person: &Person, project: SharedProjectId, peer: u64) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        doc.set_peer_id(peer).expect("peer");
        let mut socket = connect(&stage.server, person).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        Writer {
            doc,
            socket,
            last: Vec::new(),
        }
    }

    async fn send(
        &mut self,
        person: &Person,
        project: SharedProjectId,
        change: impl FnOnce(&LoroDoc),
    ) -> ServerFrame {
        let before = self.doc.oplog_vv();
        change(&self.doc);
        self.doc.commit();
        let update = self
            .doc
            .export(ExportMode::updates(&before))
            .expect("update");
        send_update(&mut self.socket, &raw_envelope(person, project, &update)).await;
        self.last = update;
        loop {
            match next_frame(&mut self.socket).await.expect("a reply") {
                ServerFrame::Update { .. } | ServerFrame::Presence { .. } => {}
                reply => return reply,
            }
        }
    }
}

fn add_thread(doc: &LoroDoc) {
    let thread = doc
        .get_map("comments")
        .insert_container("file-1/thread-1", LoroMap::new())
        .expect("thread");
    thread.insert("quote", "first").expect("quote");
}

fn resolve_thread(doc: &LoroDoc) {
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(thread))) =
        doc.get_map("comments").get("file-1/thread-1")
    else {
        panic!("the thread exists");
    };
    thread.insert("resolved", true).expect("resolve");
}

fn type_text(doc: &LoroDoc) {
    let text = doc.get_text("text");
    text.insert(text.len_unicode(), " more").expect("type");
}

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
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

async fn set_project_comments(stage: &Stage, project: SharedProjectId, on: bool) {
    let response = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/projects/{project}"),
        stage.bob.token(),
        Some(json!({ "comments_enabled": on })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

async fn set_server_comments(stage: &Stage, on: bool) {
    let patch = RuntimeSettingsPatch {
        comments_allowed: Some(on),
        ..RuntimeSettingsPatch::default()
    };
    let response = call(
        &stage.server,
        Method::PATCH,
        "/api/v1/admin/settings",
        stage.bob.token(),
        Some(serde_json::to_value(patch).expect("json")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

fn refused_for_comments(reply: &ServerFrame) -> bool {
    matches!(
        reply,
        ServerFrame::Error { code: FrameErrorCode::Forbidden, message } if message == COMMENTS_OFF
    )
}

#[tokio::test]
async fn with_comments_on_a_new_thread_is_stored() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 41).await;
    let reply = alice.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(reply, ServerFrame::Ack { seq: 1, .. }),
        "{reply:?}"
    );
}

#[tokio::test]
async fn with_comments_off_for_the_project_a_new_thread_is_refused_and_typing_still_saves() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    let mut commenter = Writer::open(&stage, &stage.alice, project, 41).await;
    let refused = commenter.send(&stage.alice, project, add_thread).await;
    assert!(refused_for_comments(&refused), "{refused:?}");
    let mut typist = Writer::open(&stage, &stage.alice, project, 42).await;
    let typed = typist.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(typed, ServerFrame::Ack { seq: 1, .. }),
        "{typed:?}"
    );
    let again = typist.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(again, ServerFrame::Ack { seq: 2, .. }),
        "{again:?}"
    );
}

#[tokio::test]
async fn with_comments_off_a_reply_to_a_thread_made_earlier_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 41).await;
    let made = alice.send(&stage.alice, project, add_thread).await;
    assert!(matches!(made, ServerFrame::Ack { seq: 1, .. }), "{made:?}");
    let thread = alice.last.clone();
    set_project_comments(&stage, project, false).await;
    let refused = alice.send(&stage.alice, project, resolve_thread).await;
    assert!(refused_for_comments(&refused), "{refused:?}");
    set_project_comments(&stage, project, true).await;
    let mut later = Writer::open(&stage, &stage.alice, project, 43).await;
    later.doc.import(&thread).expect("alice's thread");
    let resolved = later.send(&stage.alice, project, resolve_thread).await;
    assert!(
        matches!(resolved, ServerFrame::Ack { seq: 2, .. }),
        "{resolved:?}"
    );
}

#[tokio::test]
async fn with_comments_off_for_the_whole_server_a_new_thread_is_refused() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_server_comments(&stage, false).await;
    let mut commenter = Writer::open(&stage, &stage.alice, project, 41).await;
    let refused = commenter.send(&stage.alice, project, add_thread).await;
    assert!(refused_for_comments(&refused), "{refused:?}");
    let mut typist = Writer::open(&stage, &stage.alice, project, 42).await;
    let typed = typist.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(typed, ServerFrame::Ack { seq: 1, .. }),
        "{typed:?}"
    );
    set_server_comments(&stage, true).await;
    let mut commenter = Writer::open(&stage, &stage.alice, project, 44).await;
    let stored = commenter.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(stored, ServerFrame::Ack { seq: 2, .. }),
        "{stored:?}"
    );
}
