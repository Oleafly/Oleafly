mod people;

use loro::{ExportMode, LoroDoc, LoroList, LoroMap};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    PollBatch, PollFrames, PollReplies, DEVICE_HEADER, NONCE_HEADER, POLL_KEY_HEADER,
    PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectSummary};
use oleafly_server::role_guard::{RoleRule, RoleVerdict};
use oleafly_server::test_support::challenge_nonce;
use oleafly_server::test_support::suggestions::{
    file_text, remove_suggestion, suggest_delete, suggest_insert,
};
use people::{
    call, connect, first_snapshot, grant, next_frame, raw_envelope, read, seeded, send_update,
    share_project, stage, subscribe, Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;

const FILE: &str = "f1";
const COMMENTS_OFF: &str = "Comments are turned off for this project.";

struct Writer {
    doc: LoroDoc,
    socket: Socket,
}

impl Writer {
    async fn open(
        stage: &Stage,
        person: &Person,
        project: SharedProjectId,
        peer: u64,
        known: &[Vec<u8>],
    ) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        for update in known {
            doc.import(update).expect("an earlier change loads");
        }
        doc.set_peer_id(peer).expect("peer");
        let mut socket = connect(&stage.server, person).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        Writer { doc, socket }
    }

    async fn send(
        &mut self,
        person: &Person,
        project: SharedProjectId,
        change: impl FnOnce(&LoroDoc),
    ) -> (ServerFrame, Vec<u8>) {
        let before = self.doc.oplog_vv();
        change(&self.doc);
        self.doc.commit();
        let update = self
            .doc
            .export(ExportMode::updates(&before))
            .expect("update");
        send_update(&mut self.socket, &raw_envelope(person, project, &update)).await;
        loop {
            match next_frame(&mut self.socket).await.expect("a reply") {
                ServerFrame::Update { .. }
                | ServerFrame::Presence { .. }
                | ServerFrame::AccessChanged { .. } => {}
                reply => return (reply, update),
            }
        }
    }
}

fn stored(reply: &ServerFrame) -> bool {
    matches!(reply, ServerFrame::Ack { .. })
}

fn forbidden(reply: &ServerFrame) -> bool {
    matches!(
        reply,
        ServerFrame::Error {
            code: FrameErrorCode::Forbidden,
            ..
        }
    )
}

struct Shared {
    project: SharedProjectId,
    known: Vec<Vec<u8>>,
}

async fn shared_with(stage: &Stage, person: &Person, role: ProjectRole) -> Shared {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(&stage.server, &stage.bob, project, person, role)
            .await
            .status(),
        StatusCode::OK
    );
    let mut owner = Writer::open(stage, &stage.bob, project, 10, &[]).await;
    let (reply, update) = owner
        .send(&stage.bob, project, |doc| {
            file_text(doc, FILE).insert(0, "Hello world").unwrap();
        })
        .await;
    assert!(stored(&reply), "{reply:?}");
    Shared {
        project,
        known: vec![update],
    }
}

fn account(person: &Person) -> String {
    person.tokens.account_id.to_string()
}

fn comment_as(doc: &LoroDoc, thread: &str, author: &str) {
    let thread = doc
        .get_map("comments")
        .insert_container(thread, LoroMap::new())
        .unwrap();
    thread.insert("quote", "world").unwrap();
    thread.insert("created_by", author).unwrap();
    let messages = thread
        .insert_container("messages", LoroList::new())
        .unwrap();
    let message = messages.push_container(LoroMap::new()).unwrap();
    message.insert("author", author).unwrap();
    message.insert("body", "Why?").unwrap();
}

fn chat_as(doc: &LoroDoc, author: &str, body: &str) {
    let message = doc.get_list("chat").push_container(LoroMap::new()).unwrap();
    message.insert("author", author).unwrap();
    message.insert("body", body).unwrap();
}

#[tokio::test]
async fn a_reviewer_can_suggest_comment_and_chat() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let me = account(&stage.alice);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (inserted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "s1", FILE, 5, ", dear", &me);
        })
        .await;
    assert!(stored(&inserted), "{inserted:?}");
    let (deleted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_delete(doc, "s2", FILE, 0, 5, &me);
        })
        .await;
    assert!(stored(&deleted), "{deleted:?}");
    let (commented, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            comment_as(doc, "f1/t1", &me);
        })
        .await;
    assert!(stored(&commented), "{commented:?}");
    let (chatted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            chat_as(doc, &me, "Looks good");
        })
        .await;
    assert!(stored(&chatted), "{chatted:?}");
    let (withdrawn, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            let text = file_text(doc, FILE);
            text.delete(0, 6).unwrap();
            remove_suggestion(doc, "s1");
        })
        .await;
    assert!(stored(&withdrawn), "{withdrawn:?}");
}

#[tokio::test]
async fn a_reviewer_who_edits_directly_or_deletes_without_a_suggestion_is_refused() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (typed, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            file_text(doc, FILE).insert(5, "!").unwrap();
        })
        .await;
    assert!(forbidden(&typed), "{typed:?}");
    let mut again = Writer::open(&stage, &stage.alice, shared.project, 42, &shared.known).await;
    let (deleted, _) = again
        .send(&stage.alice, shared.project, |doc| {
            file_text(doc, FILE).delete(0, 6).unwrap();
        })
        .await;
    assert!(forbidden(&deleted), "{deleted:?}");
    let mut tree = Writer::open(&stage, &stage.alice, shared.project, 43, &shared.known).await;
    let (renamed, _) = tree
        .send(&stage.alice, shared.project, |doc| {
            doc.get_map("meta").insert("main", "other.tex").unwrap();
        })
        .await;
    assert!(forbidden(&renamed), "{renamed:?}");
}

#[tokio::test]
async fn a_reviewer_who_suggests_in_someone_elses_name_is_refused() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let bob = account(&stage.bob);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (forged, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &bob);
        })
        .await;
    assert!(forbidden(&forged), "{forged:?}");
}

#[tokio::test]
async fn a_reviewer_can_withdraw_their_own_suggestion_but_not_accept_one() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let me = account(&stage.alice);
    let bob = account(&stage.bob);
    let mut owner = Writer::open(&stage, &stage.bob, shared.project, 11, &shared.known).await;
    let (theirs, from_bob) = owner
        .send(&stage.bob, shared.project, |doc| {
            suggest_insert(doc, "b1", FILE, 0, "Oh, ", &bob);
        })
        .await;
    assert!(stored(&theirs), "{theirs:?}");
    let mut known = shared.known.clone();
    known.push(from_bob);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &known).await;
    let (accepted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            remove_suggestion(doc, "b1");
        })
        .await;
    assert!(forbidden(&accepted), "{accepted:?}");
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 42, &known).await;
    let (mine, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "a1", FILE, 15, "!", &me);
        })
        .await;
    assert!(stored(&mine), "{mine:?}");
    let (self_accepted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            remove_suggestion(doc, "a1");
        })
        .await;
    assert!(forbidden(&self_accepted), "{self_accepted:?}");
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 43, &known).await;
    let (again, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "a2", FILE, 15, "?", &me);
        })
        .await;
    assert!(stored(&again), "{again:?}");
    let (withdrawn, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            file_text(doc, FILE).delete(15, 1).unwrap();
            remove_suggestion(doc, "a2");
        })
        .await;
    assert!(stored(&withdrawn), "{withdrawn:?}");
}

#[tokio::test]
async fn an_editor_can_accept_a_reviewers_suggestion() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let carol = seeded(&stage.server, "Carol").await;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            shared.project,
            &carol,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    let me = account(&stage.alice);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (suggested, from_alice) = alice
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "s1", FILE, 11, "!", &me);
        })
        .await;
    assert!(stored(&suggested), "{suggested:?}");
    let mut known = shared.known.clone();
    known.push(from_alice);
    let mut editor = Writer::open(&stage, &carol, shared.project, 61, &known).await;
    let (accepted, _) = editor
        .send(&carol, shared.project, |doc| {
            remove_suggestion(doc, "s1");
        })
        .await;
    assert!(stored(&accepted), "{accepted:?}");
}

#[tokio::test]
async fn a_commenter_can_comment_and_chat_but_not_touch_text_or_suggestions() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Commenter).await;
    let me = account(&stage.alice);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (commented, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            comment_as(doc, "f1/t1", &me);
        })
        .await;
    assert!(stored(&commented), "{commented:?}");
    let (chatted, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            chat_as(doc, &me, "Hi");
        })
        .await;
    assert!(stored(&chatted), "{chatted:?}");
    let (wiped, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            doc.get_map("comments").delete("f1/t1").unwrap();
            doc.get_list("chat").delete(0, 1).unwrap();
        })
        .await;
    assert!(forbidden(&wiped), "{wiped:?}");
    let mut typist = Writer::open(&stage, &stage.alice, shared.project, 42, &shared.known).await;
    let (typed, _) = typist
        .send(&stage.alice, shared.project, |doc| {
            file_text(doc, FILE).insert(0, "x").unwrap();
        })
        .await;
    assert!(forbidden(&typed), "{typed:?}");
    let mut suggester = Writer::open(&stage, &stage.alice, shared.project, 43, &shared.known).await;
    let (suggested, _) = suggester
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me);
        })
        .await;
    assert!(forbidden(&suggested), "{suggested:?}");
}

#[tokio::test]
async fn a_viewer_still_cannot_change_anything() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Viewer).await;
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (commented, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            doc.get_map("comments")
                .insert_container("f1/t1", LoroMap::new())
                .unwrap()
                .insert("quote", "world")
                .unwrap();
        })
        .await;
    assert!(forbidden(&commented), "{commented:?}");
}

#[tokio::test]
async fn with_comments_off_a_reviewer_comment_is_refused_and_a_suggestion_still_saves() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let response = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/projects/{}", shared.project),
        stage.bob.token(),
        Some(json!({ "comments_enabled": false })),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let me = account(&stage.alice);
    let mut alice = Writer::open(&stage, &stage.alice, shared.project, 41, &shared.known).await;
    let (commented, _) = alice
        .send(&stage.alice, shared.project, |doc| {
            doc.get_map("comments")
                .insert_container("f1/t1", LoroMap::new())
                .unwrap()
                .insert("quote", "world")
                .unwrap();
        })
        .await;
    assert!(
        matches!(&commented, ServerFrame::Error { code: FrameErrorCode::Forbidden, message } if message == COMMENTS_OFF),
        "{commented:?}"
    );
    let mut suggester = Writer::open(&stage, &stage.alice, shared.project, 42, &shared.known).await;
    let (suggested, _) = suggester
        .send(&stage.alice, shared.project, |doc| {
            suggest_insert(doc, "s1", FILE, 5, "!", &me);
        })
        .await;
    assert!(stored(&suggested), "{suggested:?}");
}

#[tokio::test]
async fn reviewers_and_commenters_can_be_granted_linked_and_invited() {
    let stage = stage().await;
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    for role in [ProjectRole::Reviewer, ProjectRole::Commenter] {
        let response = grant(&stage.server, &stage.bob, project, &stage.alice, role).await;
        assert_eq!(response.status(), StatusCode::OK);
        let summary: ProjectSummary = read(
            call(
                &stage.server,
                Method::GET,
                &format!("/api/v1/projects/{project}"),
                stage.alice.token(),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(summary.role, role);
        let linked: ProjectSummary = read(
            call(
                &stage.server,
                Method::PATCH,
                &format!("/api/v1/projects/{project}"),
                stage.bob.token(),
                Some(json!({ "link_sharing": true, "link_role": role })),
            )
            .await,
        )
        .await;
        assert_eq!(linked.link_role, role);
    }
    let owner = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/projects/{project}"),
        stage.bob.token(),
        Some(json!({ "link_role": "owner" })),
    )
    .await;
    assert_eq!(owner.status(), StatusCode::BAD_REQUEST);
    let unknown = call(
        &stage.server,
        Method::PUT,
        &format!(
            "/api/v1/projects/{project}/members/{}",
            stage.alice.tokens.account_id
        ),
        stage.bob.token(),
        Some(json!({ "role": "auditor" })),
    )
    .await;
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
}

async fn post_over_long_poll(
    stage: &Stage,
    person: &Person,
    project: SharedProjectId,
    update: Vec<u8>,
) -> Vec<ServerFrame> {
    let server = &stage.server;
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
    let response = reqwest::Client::new()
        .post(format!("{}/api/v1/projects/{project}/frames", server.url()))
        .header(POLL_KEY_HEADER, batch.key.expect("an open session"))
        .json(&PollFrames {
            frames: vec![ClientFrame::Update {
                project_id: project,
                envelope: raw_envelope(person, project, &update),
            }],
        })
        .send()
        .await
        .expect("frames request");
    assert_eq!(response.status(), StatusCode::OK);
    let replies: PollReplies = response.json().await.expect("replies");
    replies.frames
}

fn update_on(known: &[Vec<u8>], peer: u64, change: impl FnOnce(&LoroDoc)) -> Vec<u8> {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    for update in known {
        doc.import(update).expect("an earlier change loads");
    }
    doc.set_peer_id(peer).expect("peer");
    let before = doc.oplog_vv();
    change(&doc);
    doc.commit();
    doc.export(ExportMode::updates(&before)).expect("update")
}

#[tokio::test]
async fn over_long_poll_a_reviewer_is_held_to_suggestions_too() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let me = account(&stage.alice);
    let typed = update_on(&shared.known, 51, |doc| {
        file_text(doc, FILE).insert(0, "x").unwrap();
    });
    let replies = post_over_long_poll(&stage, &stage.alice, shared.project, typed).await;
    assert!(
        matches!(replies.as_slice(), [reply] if forbidden(reply)),
        "{replies:?}"
    );
    let suggested = update_on(&shared.known, 52, |doc| {
        suggest_insert(doc, "s1", FILE, 0, "x", &me);
    });
    let replies = post_over_long_poll(&stage, &stage.alice, shared.project, suggested).await;
    assert!(
        matches!(replies.as_slice(), [reply] if stored(reply)),
        "{replies:?}"
    );
}

#[tokio::test]
async fn a_change_checked_once_is_judged_again_when_its_rule_changes_before_it_is_stored() {
    let stage = stage().await;
    let shared = shared_with(&stage, &stage.alice, ProjectRole::Reviewer).await;
    let me = account(&stage.alice);
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    for update in &shared.known {
        doc.import(update).expect("an earlier change loads");
    }
    doc.set_peer_id(41).expect("peer");
    let before = doc.oplog_vv();
    comment_as(&doc, "f1/t9", &me);
    doc.commit();
    let update = doc.export(ExportMode::updates(&before)).expect("update");
    let reach = oleafly_server::peers::update_reach(&update).expect("a reach");
    let state = stage.server.state();
    let on = RoleRule {
        role: ProjectRole::Reviewer,
        account: stage.alice.tokens.account_id,
        comments_off: false,
    };
    let off = RoleRule {
        comments_off: true,
        ..on
    };
    let checked = |rule| {
        state.comment_guard.check_role(
            &state.db,
            &state.snapshots,
            shared.project,
            update.clone(),
            &reach,
            rule,
        )
    };
    assert_eq!(checked(on).await.expect("a check"), RoleVerdict::Allowed);
    assert_eq!(
        checked(off).await.expect("a check"),
        RoleVerdict::ChangesComments
    );
}
