mod people;

use std::sync::Arc;
use std::time::Duration;

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
use oleafly_server::state::AppState;
use oleafly_server::test_support::{mail_config, test_config, CapturedEmail, MockSmtp, TestServer};
use people::{
    call, connect, create_project, grant, next_frame, put_bytes, raw_envelope, read, send_update,
    stage_with, subscribe, Person, Socket, Stage,
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
    alice.doc.import(&started).unwrap();
    alice.sent = alice.doc.oplog_vv();
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
    let (sent, _smtp, _stage) = mention_then(|doc, thread| {
        thread_map(doc, thread).insert("deleted", true).unwrap();
    })
    .await;
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
    alice.change(|doc| {
        thread_map(doc, &thread).insert("deleted", true).unwrap();
    });
    alice.flush(&stage.alice, project).await;
    let sent = mention_emails(&stage.server, &smtp).await;
    assert!(sent.is_empty(), "{sent:?}");
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
        state.snapshots.kept_bytes() > 0,
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
    assert_eq!(state.snapshots.kept_bytes(), 0);
}
