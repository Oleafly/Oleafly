mod people;

use loro::{ExportMode, LoroDoc, LoroMap};
use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::ClientFrame;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    understands_header, PollBatch, PollFrames, PollReplies, DEVICE_HEADER, NONCE_HEADER,
    POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER, UNDERSTANDS_HEADER,
};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::snapshots::{read_cost, Budget, Keep};
use oleafly_server::test_support::challenge_nonce;
use people::{
    call, connect, connect_understanding, first_snapshot, grant, next_frame, raw_envelope,
    send_update, share_project, stage, subscribe, Person, Socket, Stage,
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
        Writer::open_understanding(stage, person, project, peer, Vec::new()).await
    }

    async fn open_understanding(
        stage: &Stage,
        person: &Person,
        project: SharedProjectId,
        peer: u64,
        understands: Vec<FrameErrorCode>,
    ) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        doc.set_peer_id(peer).expect("peer");
        let mut socket = if understands.is_empty() {
            connect(&stage.server, person).await
        } else {
            connect_understanding(&stage.server, person, understands).await
        };
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
                ServerFrame::Update { .. }
                | ServerFrame::Presence { .. }
                | ServerFrame::AccessChanged {
                    comments: Some(_), ..
                } => {}
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

#[tokio::test]
async fn a_socket_client_that_understands_the_comments_off_code_is_refused_with_it() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    let mut commenter = Writer::open_understanding(
        &stage,
        &stage.alice,
        project,
        41,
        vec![FrameErrorCode::CommentsOff],
    )
    .await;
    let refused = commenter.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(
            &refused,
            ServerFrame::Error { code: FrameErrorCode::CommentsOff, message } if message == COMMENTS_OFF
        ),
        "{refused:?}"
    );
}

struct LongPoll {
    url: String,
    key: String,
}

async fn open_long_poll(
    stage: &Stage,
    person: &Person,
    project: SharedProjectId,
    understands: &[FrameErrorCode],
) -> LongPoll {
    let server = &stage.server;
    let nonce = challenge_nonce(server).await;
    let signature = person.device.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    let mut request = reqwest::Client::new()
        .get(format!("{}/api/v1/projects/{project}/poll", server.url()))
        .query(&[("since", "0")])
        .bearer_auth(person.token())
        .header(DEVICE_HEADER, person.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string());
    if !understands.is_empty() {
        request = request.header(UNDERSTANDS_HEADER, understands_header(understands));
    }
    let response = request.send().await.expect("open request");
    assert_eq!(response.status(), StatusCode::OK);
    let batch: PollBatch = response.json().await.expect("poll batch");
    LongPoll {
        url: format!("{}/api/v1/projects/{project}/frames", server.url()),
        key: batch.key.expect("an open session"),
    }
}

async fn post_comment(
    poll: &LongPoll,
    person: &Person,
    project: SharedProjectId,
) -> Vec<ServerFrame> {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    doc.set_peer_id(51).expect("peer");
    let before = doc.oplog_vv();
    add_thread(&doc);
    doc.commit();
    let update = doc.export(ExportMode::updates(&before)).expect("update");
    let envelope = raw_envelope(person, project, &update);
    let response = reqwest::Client::new()
        .post(&poll.url)
        .header(POLL_KEY_HEADER, &poll.key)
        .json(&PollFrames {
            frames: vec![ClientFrame::Update {
                project_id: project,
                envelope,
            }],
        })
        .send()
        .await
        .expect("frames request");
    assert_eq!(response.status(), StatusCode::OK);
    let replies: PollReplies = response.json().await.expect("replies");
    replies.frames
}

#[tokio::test]
async fn over_long_poll_only_a_client_that_names_the_comments_off_code_gets_it() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_server_comments(&stage, false).await;
    let knows = open_long_poll(
        &stage,
        &stage.alice,
        project,
        &[FrameErrorCode::CommentsOff],
    )
    .await;
    let replies = post_comment(&knows, &stage.alice, project).await;
    assert!(
        matches!(
            replies.as_slice(),
            [ServerFrame::Error { code: FrameErrorCode::CommentsOff, message }] if message == COMMENTS_OFF
        ),
        "{replies:?}"
    );
    let earlier = open_long_poll(&stage, &stage.alice, project, &[]).await;
    let replies = post_comment(&earlier, &stage.alice, project).await;
    assert!(
        matches!(replies.as_slice(), [reply] if refused_for_comments(reply)),
        "{replies:?}"
    );
}

#[tokio::test]
async fn with_comments_off_each_project_is_read_once_not_once_per_change() {
    let stage = stage().await;
    set_server_comments(&stage, false).await;
    let mut projects = Vec::new();
    for index in 0..20 {
        let shared = share_project(&stage.server, &stage.bob, &format!("Thesis {index}")).await;
        projects.push(shared.project_id);
    }
    let mut socket = connect(&stage.server, &stage.bob).await;
    let mut docs = Vec::new();
    for project in &projects {
        assert!(matches!(
            subscribe(&mut socket, *project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        doc.set_peer_id(61).expect("peer");
        docs.push(doc);
    }
    let snapshots = &stage.server.state().snapshots;
    let reads = snapshots.document_reads();
    for round in 0..3u64 {
        for (project, doc) in projects.iter().zip(&docs) {
            let before = doc.oplog_vv();
            type_text(doc);
            doc.commit();
            let update = doc.export(ExportMode::updates(&before)).expect("update");
            send_update(&mut socket, &raw_envelope(&stage.bob, *project, &update)).await;
            loop {
                match next_frame(&mut socket).await.expect("a reply") {
                    ServerFrame::Ack { seq, .. } => {
                        assert_eq!(seq, round + 1);
                        break;
                    }
                    ServerFrame::Update { .. }
                    | ServerFrame::Presence { .. }
                    | ServerFrame::AccessChanged { .. } => {}
                    other => panic!("expected an acknowledgement, got {other:?}"),
                }
            }
        }
    }
    let read = snapshots.document_reads() - reads;
    assert!(
        read <= 20,
        "the server read the projects {read} times for 60 changes"
    );
}

#[tokio::test]
async fn with_comments_off_typing_is_saved_even_when_the_project_is_too_large_to_check() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    stage.server.state().snapshots.set_budget(Budget {
        memory_bytes: 1,
        ..Budget::default()
    });
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

async fn read_cost_of(stage: &Stage, project: SharedProjectId) -> u64 {
    let size = stage
        .server
        .state()
        .db
        .call(move |conn| oleafly_server::projects::snapshot_size(conn, project, 0))
        .await
        .expect("the snapshot size")
        .expect("a stored snapshot");
    read_cost(size, 0)
}

#[tokio::test]
async fn with_comments_off_a_project_larger_than_a_quarter_of_the_budget_is_read_once() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    let needed = read_cost_of(&stage, project).await;
    let snapshots = &stage.server.state().snapshots;
    snapshots.set_budget(Budget {
        memory_bytes: 3 * needed,
        ..Budget::default()
    });
    let reads = snapshots.document_reads();
    let mut typist = Writer::open(&stage, &stage.alice, project, 42).await;
    for expected in 1..=5 {
        let typed = typist.send(&stage.alice, project, type_text).await;
        assert!(
            matches!(typed, ServerFrame::Ack { seq, .. } if seq == expected),
            "{typed:?}"
        );
    }
    assert_eq!(
        snapshots.document_reads() - reads,
        1,
        "the project was read again for later changes"
    );
}

#[tokio::test]
async fn a_document_kept_for_mention_scans_never_lets_a_comment_through_unchecked() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let other = share_project(&stage.server, &stage.bob, "Notes")
        .await
        .project_id;
    set_project_comments(&stage, project, false).await;
    let needed = read_cost_of(&stage, project).await;
    assert_eq!(read_cost_of(&stage, other).await, needed);
    let state = stage.server.state();
    state.snapshots.set_budget(Budget {
        memory_bytes: needed,
        ..Budget::default()
    });
    let (document, head) = state
        .snapshots
        .current(&state.db, other)
        .await
        .expect("a read")
        .expect("the other project fits the budget");
    state
        .snapshots
        .keep(Keep::MentionScans, other, document, head);
    let mut writer = Writer::open(&stage, &stage.alice, project, 43).await;
    let refused = writer.send(&stage.alice, project, add_thread).await;
    assert!(refused_for_comments(&refused), "{refused:?}");
}
