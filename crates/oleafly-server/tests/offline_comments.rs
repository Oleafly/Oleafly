mod large_changes;
mod people;

use std::time::Duration;

use futures_util::StreamExt;
use large_changes::{build_every, hinted, shared_with_alice};
use loro::{ExportMode, LoroDoc, LoroList, LoroMap, ValueOrContainer, VersionVector};
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use people::{
    call, connect_understanding, first_snapshot, raw_envelope, send_update, stage, subscribe,
    Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;

const LARGE_FILE: usize = if cfg!(debug_assertions) {
    224 * 1024
} else {
    1_500 * 1024
};
const PASTE: usize = 96 * 1024;
const STAGED: usize = 64 * 1024;
const ROUNDS: usize = 5;
const OFFLINE: &str = "Offline comment round";

#[derive(Clone, Copy, Debug)]
enum Shape {
    TextAndComment,
    CommentAlone,
    TextThenComment,
    TextBeforeTheSwitch,
    PasteAndCommentOnOwnHead,
    PasteAndCommentAfterOthers,
}

struct Writer {
    doc: LoroDoc,
    socket: Socket,
    held: VersionVector,
}

impl Writer {
    async fn open(stage: &Stage, person: &Person, project: SharedProjectId, peer: u64) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        doc.set_peer_id(peer).expect("peer");
        let mut socket =
            connect_understanding(&stage.server, person, vec![FrameErrorCode::CommentsOff]).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        let held = doc.oplog_vv();
        Writer { doc, socket, held }
    }

    fn change(&self, edit: impl FnOnce(&LoroDoc)) -> Vec<u8> {
        let before = self.doc.oplog_vv();
        edit(&self.doc);
        self.doc.commit();
        self.doc
            .export(ExportMode::updates(&before))
            .expect("update")
    }

    async fn send(
        &mut self,
        person: &Person,
        project: SharedProjectId,
        update: &[u8],
    ) -> ServerFrame {
        send_update(&mut self.socket, &raw_envelope(person, project, update)).await;
        loop {
            let message = tokio::time::timeout(Duration::from_secs(600), self.socket.next())
                .await
                .expect("a reply in time")
                .expect("the socket stays open")
                .expect("a message");
            let Message::Text(text) = message else {
                continue;
            };
            match serde_json::from_str(text.as_str()).expect("server frame") {
                ServerFrame::Update { .. }
                | ServerFrame::Presence { .. }
                | ServerFrame::PresenceLeft { .. }
                | ServerFrame::AccessChanged { .. } => {}
                reply => return reply,
            }
        }
    }

    fn rebuilt_from_held(&mut self, peer: u64) {
        let frontiers = self.doc.vv_to_frontiers(&self.held);
        let rebuilt = self
            .doc
            .fork_at(&frontiers)
            .expect("fork at the held version");
        rebuilt.set_peer_id(peer).expect("peer");
        self.doc = rebuilt;
    }
}

struct Room {
    stage: Stage,
    project: SharedProjectId,
    bob: Writer,
    alice: Writer,
}

impl Room {
    async fn bob_sends(&mut self, edit: impl FnOnce(&LoroDoc)) {
        let update = self.bob.change(edit);
        let reply = self.bob.send(&self.stage.bob, self.project, &update).await;
        assert!(matches!(reply, ServerFrame::Ack { .. }), "{reply:?}");
        self.alice
            .doc
            .import(&update)
            .expect("alice takes bob's change");
        self.both_hold(&update);
    }

    fn both_hold(&mut self, update: &[u8]) {
        let ends = ends_of(update);
        self.bob.held.merge(&ends);
        self.alice.held.merge(&ends);
    }

    async fn alice_sends(&mut self, edit: impl FnOnce(&LoroDoc)) {
        let update = self.alice.change(edit);
        self.alice_sends_update(update).await;
    }

    async fn alice_sends_update(&mut self, update: Vec<u8>) {
        let reply = self
            .alice
            .send(&self.stage.alice, self.project, &update)
            .await;
        assert!(matches!(reply, ServerFrame::Ack { .. }), "{reply:?}");
        self.bob
            .doc
            .import(&update)
            .expect("bob takes alice's change");
        self.both_hold(&update);
    }

    async fn switch_comments(&self, on: bool) {
        let response = call(
            &self.stage.server,
            Method::PATCH,
            &format!("/api/v1/projects/{}", self.project),
            self.stage.bob.token(),
            Some(json!({ "comments_enabled": on })),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    async fn server_doc(&self) -> LoroDoc {
        let state = self.stage.server.state();
        let (replay, _) = state
            .snapshots
            .current(&state.db, self.project)
            .await
            .expect("the server reads the project")
            .expect("the project has a document");
        replay.doc().fork()
    }
}

fn ends_of(update: &[u8]) -> VersionVector {
    LoroDoc::decode_import_blob_meta(update, false)
        .expect("an update")
        .partial_end_vv
}

fn type_line(doc: &LoroDoc, words: &str) {
    let text = doc.get_text("text");
    text.insert(text.len_unicode(), words).expect("type");
}

fn paper(bytes: usize, title: &str) -> String {
    let mut text = String::with_capacity(bytes + 128);
    let mut section = 0;
    while text.len() < bytes {
        text.push_str(&format!(
            "\\section{{{title} {section}}}\nThe samples rose by {} percent.\n\n",
            section % 97
        ));
        section += 1;
    }
    text
}

fn add_thread(doc: &LoroDoc, key: &str, body: &str) {
    let thread = doc
        .get_map("comments")
        .insert_container(key, LoroMap::new())
        .expect("thread");
    thread.insert("quote", "first").expect("quote");
    let messages = thread
        .insert_container("messages", LoroList::new())
        .expect("messages");
    let message = messages
        .insert_container(0, LoroMap::new())
        .expect("message");
    message.insert("body", body).expect("body");
}

fn resolve(doc: &LoroDoc, key: &str) {
    let Some(ValueOrContainer::Container(loro::Container::Map(thread))) =
        doc.get_map("comments").get(key)
    else {
        panic!("the thread exists");
    };
    thread.insert("resolved", true).expect("resolve");
}

fn bodies(doc: &LoroDoc) -> Vec<String> {
    let value = doc.get_map("comments").get_deep_value();
    let mut found = Vec::new();
    collect_bodies(&value, &mut found);
    found.sort();
    found
}

fn collect_bodies(value: &loro::LoroValue, found: &mut Vec<String>) {
    match value {
        loro::LoroValue::Map(map) => {
            for (key, inner) in map.iter() {
                match inner {
                    loro::LoroValue::String(body) if key == "body" => {
                        found.push(body.to_string());
                    }
                    other => collect_bodies(other, found),
                }
            }
        }
        loro::LoroValue::List(list) => {
            for inner in list.iter() {
                collect_bodies(inner, found);
            }
        }
        _ => {}
    }
}

async fn a_room_with_a_large_file_and_a_long_history() -> Room {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let bob = Writer::open(&stage, &stage.bob, project, 101).await;
    let alice = Writer::open(&stage, &stage.alice, project, 201).await;
    let mut room = Room {
        stage,
        project,
        bob,
        alice,
    };
    for line in 0..20 {
        room.bob_sends(|doc| type_line(doc, &format!(" bob {line}")))
            .await;
        room.alice_sends(|doc| type_line(doc, &format!(" alice {line}")))
            .await;
    }
    let large = paper(LARGE_FILE, "Results");
    let big = room.bob.change(|doc| {
        doc.get_text("text:big").insert(0, &large).expect("insert");
    });
    let typed_meanwhile = room.alice.change(|doc| type_line(doc, " typed beside it"));
    let reply = room.bob.send(&room.stage.bob, room.project, &big).await;
    assert!(matches!(reply, ServerFrame::Ack { .. }), "{reply:?}");
    room.alice_sends_update(typed_meanwhile).await;
    room.alice
        .doc
        .import(&big)
        .expect("alice takes the large file");
    room.both_hold(&big);
    for line in 20..40 {
        room.bob_sends(|doc| type_line(doc, &format!(" bob {line}")))
            .await;
        room.alice_sends(|doc| type_line(doc, &format!(" alice {line}")))
            .await;
    }
    room.bob_sends(|doc| add_thread(doc, "file-1/bob", "Bob's note"))
        .await;
    room.switch_comments(false).await;
    room.bob_sends(|doc| type_line(doc, " checked")).await;
    let resolving = room.bob.change(|doc| resolve(doc, "file-1/bob"));
    let refused = room
        .bob
        .send(&room.stage.bob, room.project, &resolving)
        .await;
    assert!(
        matches!(
            refused,
            ServerFrame::Error {
                code: FrameErrorCode::CommentsOff,
                ..
            }
        ),
        "{refused:?}"
    );
    room.bob.rebuilt_from_held(102);
    room.alice_sends(|doc| type_line(doc, " checked too")).await;
    room.switch_comments(true).await;
    room
}

fn offline_work(alice: &Writer, shape: Shape, round: usize) -> Vec<Vec<u8>> {
    let key = format!("file-1/alice-{round}");
    let body = format!("{OFFLINE} {round}");
    let words = format!(" offline {round}");
    match shape {
        Shape::TextAndComment => vec![alice.change(|doc| {
            type_line(doc, &words);
            add_thread(doc, &key, &body);
        })],
        Shape::CommentAlone => vec![alice.change(|doc| add_thread(doc, &key, &body))],
        Shape::TextThenComment | Shape::TextBeforeTheSwitch => vec![
            alice.change(|doc| type_line(doc, &words)),
            alice.change(|doc| add_thread(doc, &key, &body)),
        ],
        Shape::PasteAndCommentOnOwnHead | Shape::PasteAndCommentAfterOthers => {
            let pasted = paper(PASTE, &format!("Pasted {round}"));
            let update = alice.change(|doc| {
                type_line(doc, &words);
                doc.get_text(format!("text:paste-{round}"))
                    .insert(0, &pasted)
                    .expect("paste");
                add_thread(doc, &key, &body);
            });
            assert!(
                update.len() >= STAGED,
                "the paste is only {} bytes",
                update.len()
            );
            vec![update]
        }
    }
}

async fn head(room: &Room) -> u64 {
    let project = room.project;
    room.stage
        .server
        .state()
        .db
        .call(move |conn| {
            Ok(oleafly_server::projects::project_row(conn, project)?.map_or(0, |row| row.head_seq))
        })
        .await
        .expect("head")
}

async fn a_comment_written_offline_is_refused(shape: Shape, derived: bool) {
    let mut room = a_room_with_a_large_file_and_a_long_history().await;
    if derived {
        build_every(&room.stage, 1);
    }
    for round in 0..ROUNDS {
        if derived {
            let at = head(&room).await;
            assert_eq!(hinted(&room.stage, room.project, at).await, Some(at));
            let state = room.stage.server.state();
            state
                .comment_guard
                .forget(&state.snapshots, room.project)
                .await;
        }
        room.bob_sends(|doc| type_line(doc, &format!(" bob before {round}")))
            .await;
        if !matches!(shape, Shape::PasteAndCommentAfterOthers) {
            room.alice_sends(|doc| type_line(doc, &format!(" alice before {round}")))
                .await;
        }
        let mut work = offline_work(&room.alice, shape, round);
        if matches!(shape, Shape::TextBeforeTheSwitch) {
            let early = work.remove(0);
            room.alice_sends_update(early).await;
        }
        room.switch_comments(false).await;
        let mut refused = false;
        for update in &work {
            let reply = room
                .alice
                .send(&room.stage.alice, room.project, update)
                .await;
            match reply {
                ServerFrame::Ack { .. } => {
                    room.bob.doc.import(update).expect("bob takes it");
                    room.both_hold(update);
                }
                ServerFrame::Error {
                    code: FrameErrorCode::CommentsOff,
                    ..
                } => {
                    refused = true;
                    break;
                }
                other => panic!("round {round} {shape:?}: the server answered {other:?}"),
            }
        }
        assert!(
            refused,
            "round {round} {shape:?}: the server took a comment written while comments were turned off"
        );
        let server = room.server_doc().await;
        assert!(
            !bodies(&server).iter().any(|body| body.starts_with(OFFLINE)),
            "round {round} {shape:?}: the server holds {:?}",
            bodies(&server)
        );
        room.alice.rebuilt_from_held(1_000 + round as u64);
        room.alice_sends(|doc| type_line(doc, &format!(" offline {round}")))
            .await;
        let server = room.server_doc().await;
        assert!(server
            .get_text("text")
            .to_string()
            .ends_with(&format!(" offline {round}")));
        room.switch_comments(true).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn typing_and_a_comment_written_offline_in_one_change_are_refused_together() {
    a_comment_written_offline_is_refused(Shape::TextAndComment, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_comment_written_offline_on_its_own_is_refused() {
    a_comment_written_offline_is_refused(Shape::CommentAlone, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn typing_saved_offline_goes_through_and_the_comment_after_it_is_refused() {
    a_comment_written_offline_is_refused(Shape::TextThenComment, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_large_paste_with_a_comment_that_continues_the_writers_own_change_is_refused() {
    a_comment_written_offline_is_refused(Shape::PasteAndCommentOnOwnHead, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_large_paste_with_a_comment_after_someone_else_wrote_is_refused() {
    a_comment_written_offline_is_refused(Shape::PasteAndCommentAfterOthers, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn typing_that_reached_the_server_before_the_switch_does_not_let_the_comment_after_it_through(
) {
    a_comment_written_offline_is_refused(Shape::TextBeforeTheSwitch, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_comment_checked_against_a_snapshot_the_server_built_is_refused() {
    a_comment_written_offline_is_refused(Shape::TextAndComment, true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_large_paste_with_a_comment_checked_against_a_snapshot_the_server_built_is_refused() {
    a_comment_written_offline_is_refused(Shape::PasteAndCommentAfterOthers, true).await;
}
