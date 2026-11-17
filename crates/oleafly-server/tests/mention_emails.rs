mod people;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use loro::cursor::Side;
use loro::{
    Container, ExportMode, LoroDoc, LoroList, LoroMap, LoroValue, TreeParentId, ValueOrContainer,
    VersionVector,
};
use oleafly_collab_protocol::envelope::Envelope;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::members;
use oleafly_server::mentions;
use oleafly_server::peers;
use oleafly_server::snapshots::Keep;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{mail_config, test_config, CapturedEmail, MockSmtp, TestServer};
use people::{
    call, connect, create_project, grant, next_frame, put_bytes, raw_envelope, read, seeded,
    send_update, stage_with, subscribe, Person, Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;

const WAIT: Duration = Duration::from_secs(10);
const FILE: &str = "01920000-0000-7000-8000-0000000000f1";
const TITLE: &str = "Reef survey";
const TEXT: &str = "The quick brown fox jumps over the lazy dog.";
const OWNER_PEER: u64 = 7;

fn project_snapshot() -> Vec<u8> {
    let doc = LoroDoc::new();
    doc.set_peer_id(OWNER_PEER).expect("peer");
    let tree = doc.get_tree("tree");
    let folder = tree.create(TreeParentId::Root).expect("folder");
    let meta = tree.get_meta(folder).expect("folder meta");
    meta.insert("id", "01920000-0000-7000-8000-0000000000d1")
        .expect("id");
    meta.insert("name", "chapters").expect("name");
    meta.insert("kind", "folder").expect("kind");
    let file = tree.create(TreeParentId::Node(folder)).expect("file");
    let meta = tree.get_meta(file).expect("file meta");
    meta.insert("id", FILE).expect("id");
    meta.insert("name", "intro.tex").expect("name");
    meta.insert("kind", "text").expect("kind");
    doc.get_text(format!("text:{FILE}"))
        .insert(0, TEXT)
        .expect("text");
    doc.commit();
    doc.export(ExportMode::Snapshot).expect("snapshot")
}

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
    let created = create_project(&stage.server, &stage.bob, TITLE).await;
    let project = created.project_id;
    let uploaded = put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{project}/snapshot?seq=0"),
        stage.bob.token(),
        project_snapshot(),
    )
    .await;
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let _: serde_json::Value = read(
        call(
            &stage.server,
            Method::POST,
            &format!("/api/v1/projects/{project}/commit"),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
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

struct Writer {
    doc: LoroDoc,
    socket: Socket,
    sent: VersionVector,
}

impl Writer {
    async fn open(stage: &Stage, person: &Person, project: SharedProjectId, peer: u64) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&project_snapshot()).expect("the snapshot loads");
        doc.set_peer_id(peer).expect("peer");
        let mut socket = connect(&stage.server, person).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        let sent = doc.oplog_vv();
        Writer { doc, socket, sent }
    }

    fn catch_up(&mut self, update: &[u8]) {
        self.doc.import(update).expect("the update loads");
        self.sent = self.doc.oplog_vv();
    }

    fn change(&self, edit: impl FnOnce(&LoroDoc)) {
        edit(&self.doc);
        self.doc.commit();
    }

    fn pending(&mut self) -> Vec<u8> {
        let update = self
            .doc
            .export(ExportMode::updates(&self.sent))
            .expect("update");
        self.sent = self.doc.oplog_vv();
        update
    }

    async fn deliver(&mut self, envelope: &Envelope) -> ServerFrame {
        send_update(&mut self.socket, envelope).await;
        loop {
            match next_frame(&mut self.socket).await.expect("a reply") {
                ServerFrame::Update { .. }
                | ServerFrame::Presence { .. }
                | ServerFrame::PresenceLeft { .. }
                | ServerFrame::AccessChanged { .. } => {}
                reply => return reply,
            }
        }
    }

    async fn flush(&mut self, person: &Person, project: SharedProjectId) -> Vec<u8> {
        let update = self.pending();
        let reply = self.deliver(&raw_envelope(person, project, &update)).await;
        assert!(matches!(reply, ServerFrame::Ack { .. }), "{reply:?}");
        update
    }

    async fn send(
        &mut self,
        person: &Person,
        project: SharedProjectId,
        edit: impl FnOnce(&LoroDoc),
    ) -> Vec<u8> {
        self.change(edit);
        self.flush(person, project).await
    }
}

fn ids(text: &str) -> Vec<String> {
    vec![text.to_string()]
}

fn mention_list(accounts: &[AccountId]) -> LoroValue {
    LoroValue::from(
        accounts
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<String>>(),
    )
}

fn write_message(
    messages: &LoroList,
    id: &str,
    author: AccountId,
    body: &str,
    mentions: &[AccountId],
) {
    let message = messages.push_container(LoroMap::new()).expect("message");
    message.insert("id", id).expect("id");
    message
        .insert("author", author.to_string())
        .expect("author");
    message.insert("at", 10_i64).expect("at");
    message.insert("body", body).expect("body");
    message
        .insert("mentions", mention_list(mentions))
        .expect("mentions");
}

fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

fn start_thread(
    doc: &LoroDoc,
    thread: &str,
    author: AccountId,
    body: &str,
    mentions: &[AccountId],
) -> String {
    let map = doc
        .get_map("comments")
        .insert_container(&format!("{FILE}/{thread}"), LoroMap::new())
        .expect("thread");
    map.insert("quote", "brown fox").expect("quote");
    let text = doc.get_text(format!("text:{FILE}"));
    for (key, at, side) in [("start", 10, Side::Left), ("end", 18, Side::Right)] {
        let cursor = text.get_cursor(at, side).expect("a cursor");
        map.insert(key, cursor.encode()).expect("anchor");
    }
    map.insert("created_by", author.to_string())
        .expect("created by");
    map.insert("created_at", 10_i64).expect("created at");
    let messages = map
        .insert_container("messages", LoroList::new())
        .expect("messages");
    let message = new_id();
    write_message(&messages, &message, author, body, mentions);
    message
}

fn messages_of(doc: &LoroDoc, thread: &str) -> LoroList {
    let Some(ValueOrContainer::Container(Container::Map(map))) =
        doc.get_map("comments").get(&format!("{FILE}/{thread}"))
    else {
        panic!("the thread exists");
    };
    let Some(ValueOrContainer::Container(Container::List(messages))) = map.get("messages") else {
        panic!("the messages exist");
    };
    messages
}

fn reply(doc: &LoroDoc, thread: &str, author: AccountId, body: &str, mentions: &[AccountId]) {
    write_message(&messages_of(doc, thread), &new_id(), author, body, mentions);
}

fn type_text(doc: &LoroDoc, words: &str) {
    let text = doc.get_text(format!("text:{FILE}"));
    text.insert(text.len_unicode(), words).expect("type");
}

fn account(person: &Person) -> AccountId {
    person.tokens.account_id
}

async fn mention_emails(server: &TestServer, smtp: &MockSmtp) -> Vec<CapturedEmail> {
    let state = server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .expect("looking for mentions finishes");
    server.clock().advance(mentions::WINDOW_MS);
    mentions::deliver_due(state)
        .await
        .expect("due mentions go out");
    tokio::time::timeout(WAIT, state.mailer.settled())
        .await
        .expect("the mail queue settles");
    smtp.messages()
        .into_iter()
        .filter(|email| email.subject().contains("mention"))
        .collect()
}

async fn mail_stage(smtp: &MockSmtp) -> (Stage, SharedProjectId) {
    let stage = stage_with(mail_config(smtp)).await;
    let project = shared_with_alice(&stage).await;
    (stage, project)
}

async fn joined(stage: &Stage, project: SharedProjectId, name: &str, role: ProjectRole) -> Person {
    let person = seeded(&stage.server, name).await;
    assert_eq!(
        grant(&stage.server, &stage.bob, project, &person, role)
            .await
            .status(),
        StatusCode::OK
    );
    person
}

#[tokio::test]
async fn a_mention_in_a_new_comment_emails_the_person_once_the_minute_is_up() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let thread = new_id();
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &thread,
                account(&stage.alice),
                "@Bob Smith which fox is this?",
                &[account(&stage.bob)],
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    mentions::deliver_due(state).await.unwrap();
    tokio::time::timeout(WAIT, state.mailer.settled())
        .await
        .unwrap();
    assert!(smtp
        .messages()
        .iter()
        .all(|email| !email.subject().contains("mention")));
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let email = &sent[0];
    assert_eq!(email.rcpt_to, ["bob@uni.edu"]);
    assert_eq!(
        email.subject(),
        format!("Alice Chen mentioned you in \"{TITLE}\"")
    );
    let text = email.text();
    assert!(
        text.contains("Alice Chen mentioned you in a comment on Oleafly Server."),
        "{text}"
    );
    assert!(text.contains("File: chapters/intro.tex"), "{text}");
    assert!(text.contains("Text: \"brown fox\""), "{text}");
    assert!(
        text.contains("Comment: @Bob Smith which fox is this?"),
        "{text}"
    );
    assert!(
        text.contains(&format!("&project={project}&file={FILE}&thread={thread}")),
        "{text}"
    );
}

#[tokio::test]
async fn a_mention_in_a_reply_emails_the_person_mentioned_and_not_the_one_who_started() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut bob = Writer::open(&stage, &stage.bob, project, 11).await;
    let thread = new_id();
    let started = bob
        .send(&stage.bob, project, |doc| {
            start_thread(doc, &thread, account(&stage.bob), "Too vague?", &[]);
        })
        .await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice.catch_up(&started);
    alice
        .send(&stage.alice, project, |doc| {
            reply(
                doc,
                &thread,
                account(&stage.alice),
                "@Bob Smith I think it is fine",
                &[account(&stage.bob)],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].rcpt_to, ["bob@uni.edu"]);
    assert!(sent[0]
        .text()
        .contains("Comment: @Bob Smith I think it is fine"));
}

#[tokio::test]
async fn a_comment_written_offline_and_sent_later_still_emails() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let thread = new_id();
    alice.change(|doc| {
        for round in 0..600 {
            type_text(
                doc,
                &format!(" offline paragraph {round} {}", "words ".repeat(30)),
            );
        }
    });
    alice.change(|doc| {
        start_thread(
            doc,
            &thread,
            account(&stage.alice),
            "@Bob Smith written on the train",
            &[account(&stage.bob)],
        );
    });
    alice.change(|doc| type_text(doc, " and more after the comment"));
    drop(alice.socket);
    stage.server.clock().advance(5 * 60 * 1000);
    let mut back = Writer::open(&stage, &stage.alice, project, 21).await;
    back.doc = alice.doc;
    back.sent = alice.sent;
    let update = back.flush(&stage.alice, project).await;
    assert!(update.len() > 64 * 1024, "{}", update.len());
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert!(sent[0]
        .text()
        .contains("Comment: @Bob Smith written on the train"));
}

#[tokio::test]
async fn sending_the_same_comment_again_or_editing_it_never_emails_twice() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let thread = new_id();
    let mut first = None;
    let update = alice
        .send(&stage.alice, project, |doc| {
            first = Some(start_thread(
                doc,
                &thread,
                account(&stage.alice),
                "@Bob Smith look",
                &[account(&stage.bob)],
            ));
        })
        .await;
    assert_eq!(mention_emails(&stage.server, &smtp).await.len(), 1);
    let again = raw_envelope(&stage.alice, project, &update);
    assert!(matches!(
        alice.deliver(&again).await,
        ServerFrame::Ack { .. }
    ));
    assert!(matches!(
        alice.deliver(&again).await,
        ServerFrame::Ack { .. }
    ));
    alice
        .send(&stage.alice, project, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(message))) =
                messages_of(doc, &thread).get(0)
            else {
                panic!("the message exists");
            };
            message.insert("body", "@Bob Smith look here").unwrap();
            message.insert("edited_at", 20_i64).unwrap();
            message
                .insert("mentions", mention_list(&[account(&stage.bob)]))
                .unwrap();
        })
        .await;
    assert!(first.is_some());
    assert_eq!(mention_emails(&stage.server, &smtp).await.len(), 1);
}

#[tokio::test]
async fn nobody_is_emailed_about_mentioning_themselves() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Alice Chen note to self",
                &[account(&stage.alice)],
            );
        })
        .await;
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
}

#[tokio::test]
async fn people_outside_the_project_and_removed_members_are_not_emailed() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let now = stage.server.clock().now_ms();
    let carol = stage
        .server
        .state()
        .db
        .call(move |conn| {
            let carol = members::create_account(conn, "Carol", None, ServerRole::Member, now)?;
            members::add_verified_emails(conn, carol, &ids("carol@uni.edu"))?;
            Ok(carol)
        })
        .await
        .unwrap();
    let mut bob = Writer::open(&stage, &stage.bob, project, 11).await;
    bob.send(&stage.bob, project, |doc| {
        start_thread(
            doc,
            &new_id(),
            account(&stage.bob),
            "@Carol are you here?",
            &[carol],
        );
    })
    .await;
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
    bob.send(&stage.bob, project, |doc| {
        start_thread(
            doc,
            &new_id(),
            account(&stage.bob),
            "@Alice Chen soon gone",
            &[account(&stage.alice)],
        );
    })
    .await;
    tokio::time::timeout(WAIT, stage.server.state().mentions.settled())
        .await
        .unwrap();
    let removed = call(
        &stage.server,
        Method::DELETE,
        &format!(
            "/api/v1/projects/{project}/members/{}",
            account(&stage.alice)
        ),
        stage.bob.token(),
        None,
    )
    .await;
    assert!(removed.status().is_success(), "{}", removed.status());
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
    bob.send(&stage.bob, project, |doc| {
        start_thread(
            doc,
            &new_id(),
            account(&stage.bob),
            "@Alice Chen after you left",
            &[account(&stage.alice)],
        );
    })
    .await;
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
}

fn chat(doc: &LoroDoc, author: AccountId, body: &str, mentions: &[AccountId]) {
    write_message(&doc.get_list("chat"), &new_id(), author, body, mentions);
}

#[tokio::test]
async fn a_mention_in_the_chat_emails_the_person_once_and_never_the_writer() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let update = alice
        .send(&stage.alice, project, |doc| {
            chat(
                doc,
                account(&stage.alice),
                "@Bob Smith are you around? @Alice Chen",
                &[account(&stage.bob), account(&stage.alice)],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let email = &sent[0];
    assert_eq!(email.rcpt_to, ["bob@uni.edu"]);
    assert_eq!(
        email.subject(),
        format!("Alice Chen mentioned you in \"{TITLE}\"")
    );
    let text = email.text();
    assert!(
        text.contains("Alice Chen mentioned you in the chat on Oleafly Server."),
        "{text}"
    );
    assert!(
        text.contains("Chat message: @Bob Smith are you around? @Alice Chen"),
        "{text}"
    );
    assert!(text.contains(&format!("&project={project}")), "{text}");
    assert!(
        !text.contains("&thread=") && !text.contains("File:"),
        "{text}"
    );
    let again = raw_envelope(&stage.alice, project, &update);
    assert!(matches!(
        alice.deliver(&again).await,
        ServerFrame::Ack { .. }
    ));
    assert_eq!(mention_emails(&stage.server, &smtp).await.len(), 1);
}

#[tokio::test]
async fn a_chat_message_that_reuses_a_comments_id_never_rewrites_or_withdraws_its_email() {
    for mentions_bob in [true, false] {
        let smtp = MockSmtp::start().await;
        let (stage, project) = mail_stage(&smtp).await;
        let mallory = joined(&stage, project, "Mallory", ProjectRole::Commenter).await;
        let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
        let mut message = String::new();
        alice
            .send(&stage.alice, project, |doc| {
                message = start_thread(
                    doc,
                    &new_id(),
                    account(&stage.alice),
                    "@Bob Smith which fox?",
                    &[account(&stage.bob)],
                );
            })
            .await;
        let state = stage.server.state();
        tokio::time::timeout(WAIT, state.mentions.settled())
            .await
            .unwrap();
        let mentioned = if mentions_bob {
            vec![account(&stage.bob)]
        } else {
            Vec::new()
        };
        let mut copier = Writer::open(&stage, &mallory, project, 31).await;
        copier
            .send(&mallory, project, |doc| {
                write_message(
                    &doc.get_list("chat"),
                    &message,
                    account(&mallory),
                    "@Bob Smith not what Alice wrote",
                    &mentioned,
                );
            })
            .await;
        let sent = mention_emails(&stage.server, &smtp).await;
        assert_eq!(sent.len(), 1, "mentions Bob: {mentions_bob} {sent:?}");
        let text = sent[0].text();
        assert!(
            text.contains("Alice Chen mentioned you in a comment on Oleafly Server."),
            "{text}"
        );
        assert!(text.contains("Comment: @Bob Smith which fox?"), "{text}");
        assert!(!text.contains("not what Alice wrote"), "{text}");
    }
}

#[tokio::test]
async fn a_copy_of_a_message_that_claims_its_author_never_withdraws_their_email() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mallory = joined(&stage, project, "Mallory", ProjectRole::Editor).await;
    let thread = new_id();
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let mut message = String::new();
    let update = alice
        .send(&stage.alice, project, |doc| {
            message = start_thread(
                doc,
                &thread,
                account(&stage.alice),
                "@Bob Smith which fox?",
                &[account(&stage.bob)],
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    let mut copier = Writer::open(&stage, &mallory, project, 31).await;
    copier.catch_up(&update);
    copier
        .send(&mallory, project, |doc| {
            write_message(
                &messages_of(doc, &thread),
                &message,
                account(&stage.alice),
                "",
                &[],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert!(
        sent[0].text().contains("Comment: @Bob Smith which fox?"),
        "{}",
        sent[0].text()
    );
}

#[tokio::test]
async fn a_chat_mention_and_a_comment_mention_within_a_minute_arrive_as_one_email() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith which fox?",
                &[account(&stage.bob)],
            );
            chat(
                doc,
                account(&stage.alice),
                "@Bob Smith see my comment",
                &[account(&stage.bob)],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let text = sent[0].text();
    assert!(text.contains("Comment: @Bob Smith which fox?"), "{text}");
    assert!(
        text.contains("Chat message: @Bob Smith see my comment"),
        "{text}"
    );
    assert_eq!(text.matches("&thread=").count(), 1, "{text}");
}

#[tokio::test]
async fn a_person_who_turned_mention_emails_off_gets_none() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let off = call(
        &stage.server,
        Method::PATCH,
        "/api/v1/me/email-preferences",
        stage.alice.token(),
        Some(json!({ "mentions": false })),
    )
    .await;
    assert_eq!(off.status(), StatusCode::OK);
    let mut bob = Writer::open(&stage, &stage.bob, project, 11).await;
    bob.send(&stage.bob, project, |doc| {
        start_thread(
            doc,
            &new_id(),
            account(&stage.bob),
            "@Alice Chen please read",
            &[account(&stage.alice)],
        );
    })
    .await;
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
}

#[tokio::test]
async fn mentions_within_a_minute_arrive_as_one_email_and_later_ones_as_another() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let state = stage.server.state();
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith first",
                &[account(&stage.bob)],
            );
        })
        .await;
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    stage.server.clock().advance(30_000);
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith second",
                &[account(&stage.bob)],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].subject(), "2 comments mention you");
    let text = sent[0].text();
    assert!(text.contains("Comment: @Bob Smith first"), "{text}");
    assert!(text.contains("Comment: @Bob Smith second"), "{text}");
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith third",
                &[account(&stage.bob)],
            );
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 2, "{sent:?}");
    assert_eq!(
        sent[1].subject(),
        format!("Alice Chen mentioned you in \"{TITLE}\"")
    );
    assert!(sent[1].text().contains("Comment: @Bob Smith third"));
}

#[tokio::test]
async fn a_comment_that_claims_someone_else_wrote_it_emails_nobody() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.bob),
                "@Alice Chen from Bob, honest",
                &[account(&stage.alice)],
            );
        })
        .await;
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
}

#[tokio::test]
async fn without_mail_settings_mentions_are_accepted_and_nothing_waits_to_be_sent() {
    let stage = stage_with(test_config()).await;
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith hello",
                &[account(&stage.bob)],
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    assert_eq!(mentions::deliver_due(state).await.unwrap(), 0);
    let waiting: (i64, i64) = state
        .db
        .call(|conn| {
            Ok((
                conn.query_row("SELECT COUNT(*) FROM mention_scans", [], |row| row.get(0))?,
                conn.query_row("SELECT COUNT(*) FROM mention_emails", [], |row| row.get(0))?,
            ))
        })
        .await
        .unwrap();
    assert_eq!(waiting, (0, 0));
}

#[tokio::test]
async fn mentions_waiting_when_the_server_stops_go_out_after_it_starts_again() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let update = alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith before the restart",
                &[account(&stage.bob)],
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    let reach = peers::update_reach(&update).expect("an update");
    state
        .db
        .call(move |conn| {
            conn.execute("DELETE FROM mention_emails WHERE sent_at IS NULL", [])?;
            mentions::queue(conn, project, 1_000, &reach)
        })
        .await
        .unwrap();
    let clock: Arc<dyn Clock> = stage.server.clock();
    let restarted = AppState::with_db((*state.config).clone(), clock, state.db.clone())
        .await
        .expect("the server starts again");
    mentions::resume(&restarted).await;
    tokio::time::timeout(WAIT, restarted.mentions.settled())
        .await
        .unwrap();
    stage.server.clock().advance(mentions::WINDOW_MS);
    mentions::resume(&restarted).await;
    let deadline = tokio::time::Instant::now() + WAIT;
    let sent = loop {
        let sent: Vec<CapturedEmail> = smtp
            .messages()
            .into_iter()
            .filter(|email| email.subject().contains("mention"))
            .collect();
        if !sent.is_empty() || tokio::time::Instant::now() > deadline {
            break sent;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert!(sent[0]
        .text()
        .contains("Comment: @Bob Smith before the restart"));
}

fn thread_map(doc: &LoroDoc, thread: &str) -> LoroMap {
    let Some(ValueOrContainer::Container(Container::Map(map))) =
        doc.get_map("comments").get(&format!("{FILE}/{thread}"))
    else {
        panic!("the thread exists");
    };
    map
}

fn delete_thread(doc: &LoroDoc, thread: &str) {
    let map = thread_map(doc, thread);
    if map.get("deleted").and_then(|flag| flag.into_value().ok()) == Some(LoroValue::Bool(true)) {
        map.insert("deleted", false).unwrap();
    }
    map.insert("deleted", true).unwrap();
}

fn first_message(doc: &LoroDoc, thread: &str) -> LoroMap {
    let Some(ValueOrContainer::Container(Container::Map(message))) =
        messages_of(doc, thread).get(0)
    else {
        panic!("the message exists");
    };
    message
}

async fn mention_then(edit: impl FnOnce(&LoroDoc, &str)) -> (Vec<CapturedEmail>, MockSmtp, Stage) {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let thread = new_id();
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &thread,
                account(&stage.alice),
                "@Bob Smith the second reviewer is clueless",
                &[account(&stage.bob)],
            );
        })
        .await;
    tokio::time::timeout(WAIT, stage.server.state().mentions.settled())
        .await
        .unwrap();
    stage.server.clock().advance(10_000);
    alice
        .send(&stage.alice, project, |doc| edit(doc, &thread))
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    (sent, smtp, stage)
}

#[tokio::test]
async fn a_thread_deleted_before_the_minute_is_up_emails_nobody() {
    let (sent, _smtp, _stage) = mention_then(delete_thread).await;
    assert!(sent.is_empty(), "{sent:?}");
}

#[tokio::test]
async fn a_comment_deleted_before_the_minute_is_up_emails_nobody() {
    let (sent, _smtp, _stage) = mention_then(|doc, thread| {
        let message = first_message(doc, thread);
        message.insert("deleted", true).unwrap();
        message.insert("body", "").unwrap();
    })
    .await;
    assert!(sent.is_empty(), "{sent:?}");
}

#[tokio::test]
async fn a_comment_edited_before_the_minute_is_up_sends_the_new_text() {
    let (sent, _smtp, _stage) = mention_then(|doc, thread| {
        let message = first_message(doc, thread);
        message
            .insert("body", "@Bob Smith the second review needs another look")
            .unwrap();
        message.insert("edited_at", 20_i64).unwrap();
    })
    .await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let text = sent[0].text();
    assert!(
        text.contains("Comment: @Bob Smith the second review needs another look"),
        "{text}"
    );
    assert!(!text.contains("clueless"), "{text}");
}

#[tokio::test]
async fn an_edit_that_takes_someone_out_withdraws_their_email() {
    let (sent, _smtp, _stage) = mention_then(|doc, thread| {
        let message = first_message(doc, thread);
        message.insert("body", "Never mind").unwrap();
        message.insert("mentions", mention_list(&[])).unwrap();
    })
    .await;
    assert!(sent.is_empty(), "{sent:?}");
}

#[tokio::test]
async fn a_thread_written_and_deleted_offline_emails_nobody() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let thread = new_id();
    alice.change(|doc| {
        start_thread(
            doc,
            &thread,
            account(&stage.alice),
            "@Bob Smith written on the train",
            &[account(&stage.bob)],
        );
    });
    alice.change(|doc| delete_thread(doc, &thread));
    alice.flush(&stage.alice, project).await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert!(sent.is_empty(), "{sent:?}");
}

async fn alice_starts(
    stage: &Stage,
    project: SharedProjectId,
    thread: &str,
    body: &str,
    mentions: &[AccountId],
) -> (Writer, Vec<u8>) {
    let mut alice = Writer::open(stage, &stage.alice, project, 21).await;
    let started = alice
        .send(&stage.alice, project, |doc| {
            start_thread(doc, thread, account(&stage.alice), body, mentions);
        })
        .await;
    tokio::time::timeout(WAIT, stage.server.state().mentions.settled())
        .await
        .unwrap();
    (alice, started)
}

#[tokio::test]
async fn the_owners_flag_keeps_someone_elses_mention_email_and_removing_the_comment_withdraws_it() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let carol = joined(&stage, project, "Carol", ProjectRole::Editor).await;
    let thread = new_id();
    let (mut alice, started) = alice_starts(
        &stage,
        project,
        &thread,
        "@Carol have a look",
        &[account(&carol)],
    )
    .await;
    let mut owner = Writer::open(&stage, &stage.bob, project, 11).await;
    owner.catch_up(&started);
    let flagged = owner
        .send(&stage.bob, project, |doc| delete_thread(doc, &thread))
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].rcpt_to, ["carol@uni.edu"]);
    assert!(sent[0].text().contains("Comment: @Carol have a look"));
    alice.catch_up(&flagged);
    let (author, mentioned) = (account(&stage.alice), account(&carol));
    let replied = alice
        .send(&stage.alice, project, |doc| {
            reply(doc, &thread, author, "@Carol and this", &[mentioned]);
        })
        .await;
    tokio::time::timeout(WAIT, stage.server.state().mentions.settled())
        .await
        .unwrap();
    owner.catch_up(&replied);
    owner
        .send(&stage.bob, project, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(removed))) =
                messages_of(doc, &thread).get(1)
            else {
                panic!("the reply exists");
            };
            remove(&removed);
        })
        .await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
}

fn remove(message: &LoroMap) {
    message.insert("deleted", true).unwrap();
    message.insert("removed", true).unwrap();
    message.insert("body", "").unwrap();
    message.insert("mentions", mention_list(&[])).unwrap();
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Who {
    Alice,
    Bob,
    Carol,
    Dan,
    Mallory,
}

impl Who {
    const ALL: [Who; 5] = [Who::Alice, Who::Bob, Who::Carol, Who::Dan, Who::Mallory];

    fn peer(self) -> u64 {
        match self {
            Who::Bob => 11,
            Who::Alice => 21,
            Who::Mallory => 31,
            Who::Carol => 41,
            Who::Dan => 51,
        }
    }

    fn email(self) -> String {
        format!("{self:?}@uni.edu").to_lowercase()
    }
}

#[derive(Clone, Copy, Debug)]
enum Step {
    Start(Who, &'static str, &'static [Who]),
    Reply(Who, &'static str, &'static [Who]),
    Crossing(Who, &'static str, &'static [Who]),
    Seen(Who),
    Delete(Who),
    Flag(Who, bool),
    TakeBack(Who),
    Remove(Who),
    Rewrite(Who, Who, &'static str),
}

impl Step {
    fn by(self) -> Who {
        match self {
            Step::Start(who, ..)
            | Step::Reply(who, ..)
            | Step::Crossing(who, ..)
            | Step::Seen(who)
            | Step::Delete(who)
            | Step::Flag(who, _)
            | Step::TakeBack(who)
            | Step::Rewrite(who, ..) => who,
            Step::Remove(_) => Who::Bob,
        }
    }
}

struct Case {
    name: &'static str,
    steps: &'static [Step],
    emailed: &'static [(Who, &'static [&'static str])],
}

type Emailed = BTreeMap<String, Vec<String>>;

fn emailed(comments: impl IntoIterator<Item = (String, String)>) -> Emailed {
    let mut emailed = Emailed::new();
    for (to, comment) in comments {
        emailed.entry(to).or_default().push(comment);
    }
    for comments in emailed.values_mut() {
        comments.sort();
    }
    emailed
}

struct Cast {
    stage: Stage,
    others: Vec<(Who, Person)>,
}

impl Cast {
    fn person(&self, who: Who) -> &Person {
        match who {
            Who::Alice => &self.stage.alice,
            Who::Bob => &self.stage.bob,
            _ => {
                &self
                    .others
                    .iter()
                    .find(|(other, _)| *other == who)
                    .expect("everyone is cast")
                    .1
            }
        }
    }

    fn accounts(&self, people: &[Who]) -> Vec<AccountId> {
        people
            .iter()
            .map(|who| account(self.person(*who)))
            .collect()
    }
}

struct Actor {
    who: Who,
    writer: Writer,
    heard: usize,
}

fn message_by(doc: &LoroDoc, thread: &str, id: &str) -> LoroMap {
    let messages = messages_of(doc, thread);
    (0..messages.len())
        .find_map(|index| match messages.get(index) {
            Some(ValueOrContainer::Container(Container::Map(map)))
                if map.get("id").and_then(|id| id.into_value().ok())
                    == Some(LoroValue::from(id)) =>
            {
                Some(map)
            }
            _ => None,
        })
        .expect("the message exists")
}

async fn play(case: &Case) -> Emailed {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut others = Vec::new();
    for who in Who::ALL {
        if !matches!(who, Who::Alice | Who::Bob) {
            others.push((
                who,
                joined(&stage, project, &format!("{who:?}"), ProjectRole::Editor).await,
            ));
        }
    }
    let cast = Cast { stage, others };
    let stage = &cast.stage;
    let thread = new_id();
    let mut actors: Vec<Actor> = Vec::new();
    let mut updates: Vec<Vec<u8>> = Vec::new();
    let mut written: Vec<(Who, String)> = Vec::new();
    for step in case.steps {
        let who = step.by();
        let index = match actors.iter().position(|actor| actor.who == who) {
            Some(index) => index,
            None => {
                let writer = Writer::open(stage, cast.person(who), project, who.peer()).await;
                actors.push(Actor {
                    who,
                    writer,
                    heard: 0,
                });
                actors.len() - 1
            }
        };
        let actor = &mut actors[index];
        let crossing = matches!(step, Step::Crossing(..));
        if !crossing {
            for update in &updates[actor.heard..] {
                actor.writer.catch_up(update);
            }
            actor.heard = updates.len();
        }
        let latest = |of: Who| {
            written
                .iter()
                .rev()
                .find(|(by, _)| *by == of)
                .map(|(_, id)| id.clone())
                .expect("they wrote a message")
        };
        let id = new_id();
        let update = match *step {
            Step::Seen(_) => continue,
            Step::Start(_, body, mentions) => {
                let mentions = cast.accounts(mentions);
                let mut started = String::new();
                let update = actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        started =
                            start_thread(doc, &thread, account(cast.person(who)), body, &mentions);
                    })
                    .await;
                written.push((who, started));
                update
            }
            Step::Reply(_, body, mentions) | Step::Crossing(_, body, mentions) => {
                let mentions = cast.accounts(mentions);
                let update = actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        write_message(
                            &messages_of(doc, &thread),
                            &id,
                            account(cast.person(who)),
                            body,
                            &mentions,
                        );
                    })
                    .await;
                written.push((who, id));
                update
            }
            Step::Delete(_) => {
                actor
                    .writer
                    .send(cast.person(who), project, |doc| delete_thread(doc, &thread))
                    .await
            }
            Step::Flag(_, on) => {
                actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        thread_map(doc, &thread).insert("deleted", on).unwrap();
                    })
                    .await
            }
            Step::TakeBack(_) => {
                let taken = latest(who);
                actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        let message = message_by(doc, &thread, &taken);
                        message.insert("deleted", true).unwrap();
                        message.insert("body", "").unwrap();
                    })
                    .await
            }
            Step::Remove(of) => {
                let removed = latest(of);
                actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        remove(&message_by(doc, &thread, &removed));
                    })
                    .await
            }
            Step::Rewrite(_, of, body) => {
                let rewritten = latest(of);
                actor
                    .writer
                    .send(cast.person(who), project, |doc| {
                        message_by(doc, &thread, &rewritten)
                            .insert("body", body)
                            .unwrap();
                    })
                    .await
            }
        };
        updates.push(update);
        if !crossing {
            actor.heard = updates.len();
        }
        tokio::time::timeout(WAIT, stage.server.state().mentions.settled())
            .await
            .expect("looking for mentions finishes");
    }
    let sent = emailed(
        mention_emails(&stage.server, &smtp)
            .await
            .into_iter()
            .flat_map(|email| {
                let to = email.rcpt_to.join(",");
                email
                    .text()
                    .lines()
                    .filter_map(|line| line.strip_prefix("Comment: "))
                    .map(|comment| (to.clone(), comment.to_string()))
                    .collect::<Vec<_>>()
            }),
    );
    #[cfg(feature = "web")]
    assert_eq!(
        shown_by_the_app(&cast, &updates, &thread),
        expected(case),
        "what the app shows in {:?}",
        case.name
    );
    sent
}

fn expected(case: &Case) -> Emailed {
    emailed(case.emailed.iter().flat_map(|(who, comments)| {
        comments
            .iter()
            .map(|comment| (who.email(), comment.to_string()))
    }))
}

#[cfg(feature = "web")]
fn shown_by_the_app(cast: &Cast, updates: &[Vec<u8>], thread: &str) -> Emailed {
    use oleafly_collab::comments::Authorship;
    use oleafly_collab::doc::ProjectDoc;

    let merged = LoroDoc::new();
    merged.import(&project_snapshot()).unwrap();
    for update in updates {
        merged.import(update).unwrap();
    }
    let mut doc = ProjectDoc::load(&merged.export(ExportMode::Snapshot).unwrap()).unwrap();
    let mut authorship = Authorship::default();
    authorship.vouch(Who::ALL.map(|who| (who.peer(), account(cast.person(who)))));
    doc.set_authorship(authorship);
    let shown = doc
        .comment_thread(FILE, thread.parse().unwrap())
        .unwrap()
        .map(|shown| shown.messages)
        .unwrap_or_default();
    emailed(
        shown
            .iter()
            .filter(|message| message.verified && !message.deleted)
            .flat_map(|message| {
                Who::ALL
                    .into_iter()
                    .filter(|who| {
                        let mentioned = account(cast.person(*who));
                        mentioned != message.author && message.mentions.contains(&mentioned)
                    })
                    .map(|who| (who.email(), message.body.clone()))
            }),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn a_mention_emails_exactly_when_the_app_shows_its_thread() {
    use Step::{Crossing, Delete, Flag, Remove, Reply, Rewrite, Seen, Start, TakeBack};
    use Who::{Alice, Bob, Carol, Dan, Mallory};
    const CASES: &[Case] = &[
        Case {
            name: "the creator deletes their thread",
            steps: &[Start(Alice, "@Bob a1", &[Bob]), Delete(Alice)],
            emailed: &[],
        },
        Case {
            name: "the owner deletes their own thread",
            steps: &[Start(Bob, "@Alice b1", &[Alice]), Delete(Bob)],
            emailed: &[],
        },
        Case {
            name: "another editor flags the thread",
            steps: &[Start(Alice, "@Bob a1", &[Bob]), Flag(Mallory, true)],
            emailed: &[(Bob, &["@Bob a1"])],
        },
        Case {
            name: "the owner flags someone else's thread",
            steps: &[Start(Alice, "@Carol a1", &[Carol]), Flag(Bob, true)],
            emailed: &[(Carol, &["@Carol a1"])],
        },
        Case {
            name: "the creator mentions someone after the owner's flag",
            steps: &[
                Start(Alice, "a1", &[]),
                Flag(Bob, true),
                Reply(Alice, "@Dan a2", &[Dan]),
            ],
            emailed: &[(Dan, &["@Dan a2"])],
        },
        Case {
            name: "the creator mentions someone after another editor's flag",
            steps: &[
                Start(Alice, "a1", &[]),
                Flag(Mallory, true),
                Reply(Alice, "@Bob a2", &[Bob]),
            ],
            emailed: &[(Bob, &["@Bob a2"])],
        },
        Case {
            name: "an editor flags the thread on, off and on",
            steps: &[
                Start(Alice, "@Bob a1", &[Bob]),
                Flag(Mallory, true),
                Flag(Mallory, false),
                Flag(Mallory, true),
            ],
            emailed: &[(Bob, &["@Bob a1"])],
        },
        Case {
            name: "the creator deletes after another editor's flag",
            steps: &[
                Start(Alice, "@Bob a1", &[Bob]),
                Flag(Mallory, true),
                Delete(Alice),
            ],
            emailed: &[],
        },
        Case {
            name: "the creator deletes after a reply",
            steps: &[
                Start(Alice, "@Carol a1", &[Carol]),
                Reply(Carol, "@Bob c1", &[Bob]),
                Delete(Alice),
            ],
            emailed: &[(Bob, &["@Bob c1"]), (Carol, &["@Carol a1"])],
        },
        Case {
            name: "the owner deletes their own thread after a reply",
            steps: &[
                Start(Bob, "@Carol b1", &[Carol]),
                Reply(Carol, "@Alice c1", &[Alice]),
                Delete(Bob),
            ],
            emailed: &[(Alice, &["@Alice c1"]), (Carol, &["@Carol b1"])],
        },
        Case {
            name: "the creator deletes after a reply that was taken back",
            steps: &[
                Start(Alice, "@Bob a1", &[Bob]),
                Reply(Carol, "c1", &[]),
                TakeBack(Carol),
                Delete(Alice),
            ],
            emailed: &[],
        },
        Case {
            name: "a reply crosses the creator's delete and the creator mentions again",
            steps: &[
                Start(Alice, "@Dan a1", &[Dan]),
                Seen(Carol),
                Delete(Alice),
                Crossing(Carol, "@Bob c1", &[Bob]),
                Reply(Alice, "@Dan a2", &[Dan]),
            ],
            emailed: &[(Bob, &["@Bob c1"]), (Dan, &["@Dan a1", "@Dan a2"])],
        },
        Case {
            name: "a reply crosses the owner's delete and everyone mentions again",
            steps: &[
                Start(Bob, "b1", &[]),
                Seen(Carol),
                Delete(Bob),
                Crossing(Carol, "@Dan c1", &[Dan]),
                Reply(Dan, "@Carol d1", &[Carol]),
                Reply(Bob, "@Alice b2", &[Alice]),
            ],
            emailed: &[
                (Alice, &["@Alice b2"]),
                (Carol, &["@Carol d1"]),
                (Dan, &["@Dan c1"]),
            ],
        },
        Case {
            name: "a crossing reply taken back hides the thread again",
            steps: &[
                Start(Alice, "@Dan a1", &[Dan]),
                Seen(Carol),
                Delete(Alice),
                Crossing(Carol, "@Bob c1", &[Bob]),
                TakeBack(Carol),
            ],
            emailed: &[],
        },
        Case {
            name: "the owner removes the crossing reply",
            steps: &[
                Start(Alice, "@Dan a1", &[Dan]),
                Seen(Carol),
                Delete(Alice),
                Crossing(Carol, "@Bob c1", &[Bob]),
                Remove(Carol),
            ],
            emailed: &[],
        },
        Case {
            name: "the owner removes the creator's comment and a reply keeps the thread",
            steps: &[
                Start(Alice, "@Carol a1", &[Carol]),
                Reply(Dan, "@Bob d1", &[Bob]),
                Remove(Alice),
            ],
            emailed: &[(Bob, &["@Bob d1"])],
        },
        Case {
            name: "the creator mentions someone in their deleted thread",
            steps: &[
                Start(Alice, "a1", &[]),
                Delete(Alice),
                Reply(Alice, "@Bob a2", &[Bob]),
            ],
            emailed: &[],
        },
        Case {
            name: "another editor rewrites the creator's comment before the creator deletes",
            steps: &[
                Start(Alice, "@Bob a1", &[Bob]),
                Rewrite(Mallory, Alice, "@Bob not a1"),
                Delete(Alice),
            ],
            emailed: &[],
        },
        Case {
            name: "the creator takes their delete back",
            steps: &[
                Start(Alice, "@Bob a1", &[Bob]),
                Delete(Alice),
                Flag(Alice, false),
            ],
            emailed: &[(Bob, &["@Bob a1"])],
        },
    ];
    let mut got = Vec::new();
    for cases in CASES.chunks(3) {
        let played: Vec<_> = cases.iter().map(|case| tokio::spawn(play(case))).collect();
        for (case, played) in cases.iter().zip(played) {
            got.push((case.name, played.await.expect("the case plays")));
        }
    }
    let wanted: Vec<_> = CASES
        .iter()
        .map(|case| (case.name, expected(case)))
        .collect();
    assert_eq!(got, wanted);
}

async fn scans_waiting(server: &TestServer) -> i64 {
    server
        .state()
        .db
        .call(
            |conn| Ok(conn.query_row("SELECT COUNT(*) FROM mention_scans", [], |row| row.get(0))?),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn words_typed_into_a_file_never_start_a_scan() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            type_text(
                doc,
                " As Smith mentions in [3], the body of work was later deleted.",
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    assert_eq!(scans_waiting(&stage.server).await, 0);
    assert_eq!(state.mentions.documents_built(), 0);
}

#[tokio::test]
async fn a_second_scan_advances_the_document_it_kept_instead_of_rebuilding_it() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let state = stage.server.state();
    for body in ["@Bob Smith first", "@Bob Smith second"] {
        alice
            .send(&stage.alice, project, |doc| {
                start_thread(
                    doc,
                    &new_id(),
                    account(&stage.alice),
                    body,
                    &[account(&stage.bob)],
                );
            })
            .await;
        tokio::time::timeout(WAIT, state.mentions.settled())
            .await
            .unwrap();
    }
    assert_eq!(state.mentions.documents_built(), 1);
    let sent = mention_emails(&stage.server, &smtp).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    let text = sent[0].text();
    assert!(text.contains("Comment: @Bob Smith first"), "{text}");
    assert!(text.contains("Comment: @Bob Smith second"), "{text}");
}

#[tokio::test]
async fn with_email_notifications_off_comments_are_not_scanned() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let off = call(
        &stage.server,
        Method::PATCH,
        "/api/v1/admin/settings",
        stage.bob.token(),
        Some(json!({ "email_notifications": false })),
    )
    .await;
    assert_eq!(off.status(), StatusCode::OK);
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    alice
        .send(&stage.alice, project, |doc| {
            start_thread(
                doc,
                &new_id(),
                account(&stage.alice),
                "@Bob Smith while email is off",
                &[account(&stage.bob)],
            );
        })
        .await;
    let state = stage.server.state();
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    assert_eq!(scans_waiting(&stage.server).await, 0);
    assert_eq!(state.mentions.documents_built(), 0);
    assert!(mention_emails(&stage.server, &smtp).await.is_empty());
}

#[tokio::test]
async fn turning_email_notifications_off_drops_the_documents_kept_for_scans() {
    let smtp = MockSmtp::start().await;
    let (stage, project) = mail_stage(&smtp).await;
    let mut alice = Writer::open(&stage, &stage.alice, project, 21).await;
    let state = stage.server.state();
    let mention = |body: &'static str| {
        let (alice, bob) = (account(&stage.alice), account(&stage.bob));
        move |doc: &LoroDoc| {
            start_thread(doc, &new_id(), alice, body, &[bob]);
        }
    };
    alice
        .send(&stage.alice, project, mention("@Bob Smith first"))
        .await;
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    assert!(
        state.snapshots.kept_bytes_for(Keep::MentionScans) > 0,
        "the scan kept its document"
    );
    let off = call(
        &stage.server,
        Method::PATCH,
        "/api/v1/admin/settings",
        stage.bob.token(),
        Some(json!({ "email_notifications": false })),
    )
    .await;
    assert_eq!(off.status(), StatusCode::OK);
    alice
        .send(&stage.alice, project, mention("@Bob Smith second"))
        .await;
    tokio::time::timeout(WAIT, state.mentions.settled())
        .await
        .unwrap();
    assert_eq!(state.snapshots.kept_bytes_for(Keep::MentionScans), 0);
}
