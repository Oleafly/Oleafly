mod people;

use std::sync::Arc;

use loro::{ExportMode, LoroDoc, LoroMap};
use oleafly_collab_protocol::admin::{
    Page, RuntimeSettingsPatch, SecurityEvent, SecurityEventKind,
};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::console::{AdminOverview, HealthIssue};
use oleafly_collab_protocol::frames::ClientFrame;
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::poll::{
    understands_header, PollBatch, PollFrames, PollReplies, DEVICE_HEADER, NONCE_HEADER,
    POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER, UNDERSTANDS_HEADER,
};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::clock::Clock;
use oleafly_server::comment_guard;
use oleafly_server::snapshots::{read_cost, Budget, Keep};
use oleafly_server::state::AppState;
use oleafly_server::test_support::challenge_nonce;
use people::{
    call, connect, connect_understanding, first_snapshot, grant, next_frame, raw_envelope,
    send_update, share_project, stage, subscribe, Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;

const COMMENTS_OFF: &str = "Comments are turned off for this project.";
const CHAT_ID: &str = "01920000-0000-7000-8000-00000000c001";

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

async fn logged(stage: &Stage, kind: SecurityEventKind) -> Vec<SecurityEvent> {
    let page: Page<SecurityEvent> = call(
        &stage.server,
        Method::GET,
        "/api/v1/admin/security-log",
        stage.bob.token(),
        None,
    )
    .await
    .json()
    .await
    .expect("the security log");
    page.items
        .into_iter()
        .filter(|event| event.kind == kind)
        .collect()
}

#[tokio::test]
async fn a_comment_stored_unchecked_is_checked_once_the_budget_allows_and_reported() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    let state = stage.server.state();
    state.snapshots.set_budget(Budget {
        memory_bytes: 1,
        ..Budget::default()
    });
    let mut writer = Writer::open(&stage, &stage.alice, project, 44).await;
    let thread = writer.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(thread, ServerFrame::Ack { seq: 1, .. }),
        "{thread:?}"
    );
    let typed = writer.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(typed, ServerFrame::Ack { seq: 2, .. }),
        "{typed:?}"
    );
    state.comment_guard.rechecks_settled().await;
    assert!(logged(&stage, SecurityEventKind::CommentsChangedWhileOff)
        .await
        .is_empty());

    state.snapshots.set_budget(Budget::default());
    let checked = writer.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(checked, ServerFrame::Ack { seq: 3, .. }),
        "{checked:?}"
    );
    state.comment_guard.rechecks_settled().await;
    let logged = logged(&stage, SecurityEventKind::CommentsChangedWhileOff).await;
    assert_eq!(logged.len(), 1, "only the new thread changed comments");
    assert_eq!(logged[0].actor, Some(stage.alice.tokens.account_id));
    assert_eq!(logged[0].target, Some(project.to_string()));
    assert_eq!(logged[0].detail["seq"], 1);
    let overview: AdminOverview = call(
        &stage.server,
        Method::GET,
        "/api/v1/admin/overview",
        stage.bob.token(),
        None,
    )
    .await
    .json()
    .await
    .expect("the overview");
    assert!(overview
        .health
        .issues
        .contains(&HealthIssue::CommentsChangedWhileOff));
    let [noticed] = overview.comments_changed_while_off.as_slice() else {
        panic!("one change is named: {overview:?}");
    };
    assert_eq!(noticed.project_id, project);
    assert_eq!(noticed.project_title.as_deref(), Some("Thesis"));
    assert_eq!(noticed.account_id, Some(stage.alice.tokens.account_id));
    let waiting: i64 = state
        .db
        .call(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM comment_rechecks", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .await
        .expect("the queue");
    assert_eq!(waiting, 0);
}

async fn rechecks_waiting(stage: &Stage) -> i64 {
    stage
        .server
        .state()
        .db
        .call(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM comment_rechecks", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .await
        .expect("the queue")
}

#[tokio::test]
async fn with_comments_on_an_editor_comment_the_server_could_not_read_is_checked_later() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let state = stage.server.state();
    state.snapshots.set_budget(Budget {
        memory_bytes: 1,
        ..Budget::default()
    });
    let mut writer = Writer::open(&stage, &stage.alice, project, 46).await;
    let thread = writer.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(thread, ServerFrame::Ack { seq: 1, .. }),
        "{thread:?}"
    );
    state.comment_guard.rechecks_settled().await;
    assert_eq!(rechecks_waiting(&stage).await, 1);
    state.snapshots.set_budget(Budget::default());
    let typed = writer.send(&stage.alice, project, type_text).await;
    assert!(
        matches!(typed, ServerFrame::Ack { seq: 2, .. }),
        "{typed:?}"
    );
    state.comment_guard.rechecks_settled().await;
    assert_eq!(rechecks_waiting(&stage).await, 0);
    assert!(
        logged(&stage, SecurityEventKind::CommentsChangedWhileOff)
            .await
            .is_empty(),
        "comments were on, so the thread is judged by the editor's rules"
    );
}

fn chat_with_a_reaction(doc: &LoroDoc, author: AccountId) {
    let message = doc
        .get_list("chat")
        .push_container(LoroMap::new())
        .expect("message");
    message.insert("id", CHAT_ID).expect("id");
    message
        .insert("author", author.to_string())
        .expect("author");
    message.insert("at", 1_i64).expect("at");
    message.insert("body", "Morning").expect("body");
    doc.get_map("chat_reactions")
        .insert(&format!("{CHAT_ID}|👍|{author}"), 2_i64)
        .expect("reaction");
}

async fn taken_back_while_unreadable(
    stage: &Stage,
    project: SharedProjectId,
    typed_meanwhile: usize,
) {
    let state = stage.server.state();
    let bob = stage.bob.tokens.account_id;
    let mut owner = Writer::open(stage, &stage.bob, project, 47).await;
    let posted = owner
        .send(&stage.bob, project, |doc| chat_with_a_reaction(doc, bob))
        .await;
    assert!(matches!(posted, ServerFrame::Ack { .. }), "{posted:?}");
    state.snapshots.set_budget(Budget {
        memory_bytes: 1,
        ..Budget::default()
    });
    let mut editor = Writer::open(stage, &stage.alice, project, 48).await;
    editor.doc.import(&owner.last).expect("the chat");
    let taken = editor
        .send(&stage.alice, project, |doc| {
            doc.get_map("chat_reactions")
                .delete(&format!("{CHAT_ID}|👍|{bob}"))
                .expect("take back");
        })
        .await;
    assert!(matches!(taken, ServerFrame::Ack { .. }), "{taken:?}");
    state.comment_guard.rechecks_settled().await;
    assert_eq!(rechecks_waiting(stage).await, 1);
    for _ in 0..typed_meanwhile {
        let typed = editor.send(&stage.alice, project, type_text).await;
        assert!(matches!(typed, ServerFrame::Ack { .. }), "{typed:?}");
        state.comment_guard.rechecks_settled().await;
    }
    state.snapshots.set_budget(Budget::default());
    let typed = editor.send(&stage.alice, project, type_text).await;
    assert!(matches!(typed, ServerFrame::Ack { .. }), "{typed:?}");
    state.comment_guard.rechecks_settled().await;
    assert_eq!(rechecks_waiting(stage).await, 0);
}

#[tokio::test]
async fn an_editor_change_stored_unchecked_that_breaks_their_role_is_reported_once_checked() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    taken_back_while_unreadable(&stage, project, 0).await;
    let broke = logged(&stage, SecurityEventKind::ChangeBrokeRole).await;
    assert_eq!(broke.len(), 1, "{broke:?}");
    assert_eq!(broke[0].actor, Some(stage.alice.tokens.account_id));
    assert_eq!(broke[0].target, Some(project.to_string()));
    assert_eq!(broke[0].detail["seq"], 2);
    assert!(logged(&stage, SecurityEventKind::CommentsChangedWhileOff)
        .await
        .is_empty());
}

#[tokio::test]
async fn with_comments_off_an_editor_change_to_the_chat_stored_unchecked_is_judged_by_role() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    set_project_comments(&stage, project, false).await;
    taken_back_while_unreadable(&stage, project, 0).await;
    let broke = logged(&stage, SecurityEventKind::ChangeBrokeRole).await;
    assert_eq!(broke.len(), 1, "{broke:?}");
    assert_eq!(broke[0].actor, Some(stage.alice.tokens.account_id));
    assert!(logged(&stage, SecurityEventKind::CommentsChangedWhileOff)
        .await
        .is_empty());
}

#[tokio::test]
async fn a_role_break_stored_unchecked_is_still_judged_after_typing_while_the_project_is_too_large()
{
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    taken_back_while_unreadable(&stage, project, 6).await;
    let broke = logged(&stage, SecurityEventKind::ChangeBrokeRole).await;
    assert_eq!(broke.len(), 1, "{broke:?}");
    assert_eq!(broke[0].detail["seq"], 2);
}

async fn attempts(stage: &Stage) -> Vec<i64> {
    stage
        .server
        .state()
        .db
        .call(|conn| {
            Ok(conn
                .prepare("SELECT attempts FROM comment_rechecks ORDER BY seq")?
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<i64>, _>>()?)
        })
        .await
        .expect("the queue")
}

#[tokio::test]
async fn a_change_stored_unchecked_on_a_project_too_large_to_read_is_given_up_after_five_tries() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let state = stage.server.state();
    state.snapshots.set_budget(Budget {
        memory_bytes: 1,
        ..Budget::default()
    });
    let mut writer = Writer::open(&stage, &stage.alice, project, 49).await;
    let thread = writer.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(thread, ServerFrame::Ack { seq: 1, .. }),
        "{thread:?}"
    );
    state.comment_guard.rechecks_settled().await;
    assert_eq!(attempts(&stage).await, [1]);
    state.comment_guard.recheck(state, project);
    state.comment_guard.rechecks_settled().await;
    assert_eq!(
        attempts(&stage).await,
        [1],
        "a try within the minute counts once"
    );
    for tries in 2..=4 {
        stage.server.clock().advance(60_000);
        state.comment_guard.recheck(state, project);
        state.comment_guard.rechecks_settled().await;
        assert_eq!(attempts(&stage).await, [tries]);
    }
    stage.server.clock().advance(60_000);
    state.comment_guard.recheck(state, project);
    state.comment_guard.rechecks_settled().await;
    assert_eq!(rechecks_waiting(&stage).await, 0);
}

#[tokio::test]
async fn a_restart_counts_no_try_until_the_minute_after_it() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let state = stage.server.state();
    let unreadable = Budget {
        memory_bytes: 1,
        ..Budget::default()
    };
    state.snapshots.set_budget(unreadable);
    let mut writer = Writer::open(&stage, &stage.alice, project, 50).await;
    let thread = writer.send(&stage.alice, project, add_thread).await;
    assert!(
        matches!(thread, ServerFrame::Ack { seq: 1, .. }),
        "{thread:?}"
    );
    state.comment_guard.rechecks_settled().await;
    assert_eq!(attempts(&stage).await, [1]);
    let clock: Arc<dyn Clock> = stage.server.clock();
    let mut restarted = None;
    for _ in 0..5 {
        let again = AppState::with_db(
            (*state.config).clone(),
            Arc::clone(&clock),
            state.db.clone(),
        )
        .await
        .expect("the server starts again");
        again.snapshots.set_budget(unreadable);
        comment_guard::resume(&again).await;
        again.comment_guard.rechecks_settled().await;
        assert_eq!(
            attempts(&stage).await,
            [1],
            "a restart counts no try at once"
        );
        restarted = Some(again);
    }
    let restarted = restarted.expect("the server restarted");
    stage.server.clock().advance(60_000);
    restarted.comment_guard.recheck(&restarted, project);
    restarted.comment_guard.rechecks_settled().await;
    assert_eq!(
        attempts(&stage).await,
        [2],
        "the minute after a restart counts"
    );
}
