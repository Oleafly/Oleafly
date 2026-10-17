use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::{save_shared, DocSink, LiveProject};
use oleafly_collab::sync::{
    spawn_live_with, LiveEvent, LiveHandle, LiveLink, LiveStatus, SharedLive, TransportOptions,
};
use oleafly_collab::{DeviceKey, MemorySecrets, ServerClient, ServerUrl, SessionManager};
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectPatch, ProjectRole};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{
    seed_person, test_config, BlockingProxy, PersonSeed, TestServer,
};
use tokio::sync::mpsc::{self, UnboundedReceiver};

const LARGE_FILE: usize = if cfg!(debug_assertions) {
    224 * 1024
} else {
    1_500 * 1024
};
const ROUNDS: usize = 5;
const HISTORY: usize = 60;
const OFFLINE: &str = "Offline comment round";
const WAIT: Duration = Duration::from_secs(60);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Person {
    key: Arc<DeviceKey>,
    tokens: SessionTokens,
    sessions: Arc<SessionManager>,
}

struct Side {
    live: SharedLive,
    events: UnboundedReceiver<LiveEvent>,
    handle: LiveHandle,
}

struct Room {
    server: TestServer,
    server_id: ServerId,
    url: ServerUrl,
    project: SharedProjectId,
    main: String,
    bob: Person,
    alice: Person,
    proxy: BlockingProxy,
}

async fn person(server: &TestServer, server_id: ServerId, name: &str, role: ServerRole) -> Person {
    let key = Arc::new(DeviceKey::load_or_create(&MemorySecrets::new()).expect("device key"));
    let tokens = seed_person(
        server.state(),
        PersonSeed {
            name: name.to_owned(),
            email: format!("{name}@uni.edu"),
            role,
            device_public_key: key.public_key_b64(),
            device_name: format!("{name}'s laptop"),
        },
    )
    .await
    .expect("seed a person");
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::new()),
        Arc::clone(&key),
    ));
    sessions
        .store(server_id, &tokens)
        .expect("store the session");
    Person {
        key,
        tokens,
        sessions,
    }
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

impl Room {
    async fn open(blocked: bool) -> (Room, LiveProject, LiveProject) {
        let server = TestServer::start(test_config()).await;
        let server_id = server.state().server_id;
        let url = ServerUrl::parse(&server.url()).expect("server address");
        let bob = person(&server, server_id, "bob", ServerRole::Admin).await;
        let alice = person(&server, server_id, "alice", ServerRole::Member).await;
        let client = ServerClient::new(url.clone()).expect("client");
        let mut doc = ProjectDoc::create().expect("doc");
        let main = doc
            .add_node(None, "method.tex", NodeKind::Text, None, "abc")
            .expect("main");
        let project = client
            .create_project(&bob.tokens.access_token, "Paper")
            .await
            .expect("create")
            .project_id;
        client
            .put_snapshot(
                &bob.tokens.access_token,
                project,
                0,
                doc.snapshot().expect("snapshot"),
            )
            .await
            .expect("first snapshot");
        client
            .commit_project(&bob.tokens.access_token, project)
            .await
            .expect("commit");
        client
            .grant_member(
                &bob.tokens.access_token,
                project,
                alice.tokens.account_id,
                ProjectRole::Editor,
            )
            .await
            .expect("grant");
        let (seq, snapshot) = client
            .get_snapshot(&alice.tokens.access_token, project)
            .await
            .expect("alice's snapshot");
        let joined = LiveProject::new(
            ProjectDoc::load(&snapshot).expect("load"),
            seq,
            ProjectRole::Editor,
        );
        let upstream = server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address");
        let proxy = BlockingProxy::start(upstream).await;
        proxy.block_websockets(blocked);
        (
            Room {
                server,
                server_id,
                url,
                project,
                main,
                bob,
                alice,
                proxy,
            },
            LiveProject::new(doc, 0, ProjectRole::Owner),
            joined,
        )
    }

    fn link(&self, person: &Person, through_proxy: bool) -> LiveLink {
        let url = if through_proxy {
            ServerUrl::parse(&self.proxy.url()).expect("proxy address")
        } else {
            self.url.clone()
        };
        LiveLink {
            client: Arc::new(ServerClient::new(url).expect("client")),
            server_id: self.server_id,
            project: self.project,
            device_id: person.tokens.device_id,
            key: Arc::clone(&person.key),
            sessions: Arc::clone(&person.sessions),
        }
    }

    fn side(&self, live: LiveProject, person: &Person, through_proxy: bool) -> Side {
        let live = Arc::new(Mutex::new(live));
        let sink: DocSink = Arc::new(|_| {});
        lock(&live).open_file(&self.main, sink).expect("open");
        let (events_tx, events) = mpsc::unbounded_channel();
        let handle = spawn_live_with(
            self.link(person, through_proxy),
            Arc::clone(&live),
            events_tx,
            TransportOptions {
                fallback_after: 2,
                retry_socket_every: Duration::from_secs(60),
                ..TransportOptions::default()
            },
        );
        Side {
            live,
            events,
            handle,
        }
    }

    async fn switch_comments(&self, on: bool) {
        ServerClient::new(self.url.clone())
            .expect("client")
            .patch_project(
                &self.bob.tokens.access_token,
                self.project,
                &ProjectPatch {
                    comments_enabled: Some(on),
                    ..ProjectPatch::default()
                },
            )
            .await
            .expect("switch comments");
    }

    async fn server_bodies(&self) -> Vec<String> {
        let state = self.server.state();
        let (replay, _) = state
            .snapshots
            .current(&state.db, self.project)
            .await
            .expect("the server reads the project")
            .expect("the project has a document");
        let doc = ProjectDoc::load(&replay.finish().expect("snapshot")).expect("load");
        bodies(&doc, &self.main)
    }
}

fn bodies(doc: &ProjectDoc, main: &str) -> Vec<String> {
    doc.comment_threads(main)
        .expect("threads")
        .into_iter()
        .flat_map(|thread| thread.messages.into_iter().map(|message| message.body))
        .collect()
}

fn text(side: &Side, main: &str) -> String {
    lock(&side.live).doc().text(main).expect("text")
}

fn append(side: &Side, main: &str, words: &str) {
    let mut live = lock(&side.live);
    let typed = format!("{}{words}", live.doc().text(main).expect("text"));
    live.local_text(main, &typed).expect("type");
}

async fn until(what: &str, check: impl Fn() -> bool) {
    tokio::time::timeout(WAIT, async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what} never happened"));
}

async fn until_status(side: &mut Side, wanted: impl Fn(&LiveStatus) -> bool) -> bool {
    let mut told = false;
    tokio::time::timeout(WAIT, async {
        while let Some(event) = side.events.recv().await {
            match event {
                LiveEvent::CommentsNotSent(_) => told = true,
                LiveEvent::Status(status) if wanted(&status) => return,
                _ => {}
            }
        }
    })
    .await
    .expect("the connection status changed");
    told
}

async fn a_comment_written_offline_stays_off_the_server_round_after_round(blocked: bool) {
    let (room, bob_live, alice_live) = Room::open(blocked).await;
    let main = room.main.clone();
    let mut bob = room.side(bob_live, &room.bob, false);
    let mut alice = room.side(alice_live, &room.alice, true);
    until_status(&mut bob, |status| *status == LiveStatus::Online).await;
    until_status(&mut alice, |status| *status == LiveStatus::Online).await;
    for line in 0..HISTORY {
        append(&bob, &main, &format!(" b{line}"));
        bob.handle.flush();
        append(&alice, &main, &format!(" a{line}"));
        alice.handle.flush();
        if line == HISTORY / 2 {
            let large = paper(LARGE_FILE, "Results");
            lock(&bob.live)
                .comment_doc()
                .add_node(None, "big.tex", NodeKind::Text, None, &large)
                .expect("big file");
            bob.handle.flush();
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    until("both copies agree", || {
        text(&alice, &main) == text(&bob, &main)
            && !lock(&alice.live).has_unsent()
            && !lock(&bob.live).has_unsent()
    })
    .await;
    let alice_account = room.alice.tokens.account_id;
    for round in 0..ROUNDS {
        room.switch_comments(true).await;
        room.proxy.go_offline();
        until_status(&mut alice, |status| {
            matches!(status, LiveStatus::Offline { .. })
        })
        .await;
        append(&alice, &main, &format!(" offline{round}"));
        let length = text(&alice, &main).encode_utf16().count();
        lock(&alice.live)
            .comment_doc()
            .create_comment_thread(
                &main,
                length - 3,
                length,
                alice_account,
                1,
                &format!("{OFFLINE} {round}"),
                &[],
            )
            .expect("comment");
        alice.handle.flush();
        append(&bob, &main, &format!(" bob while away {round}"));
        bob.handle.flush();
        room.switch_comments(false).await;
        append(&bob, &main, &format!(" bob after the switch {round}"));
        bob.handle.flush();
        tokio::time::sleep(Duration::from_secs(2)).await;
        room.proxy.go_online();
        let words = format!(" offline{round}");
        until("the offline words reach bob", || {
            text(&bob, &main).contains(&words)
        })
        .await;
        until("alice has nothing left to send", || {
            !lock(&alice.live).has_unsent()
        })
        .await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        let mut told = false;
        while let Ok(event) = alice.events.try_recv() {
            told |= matches!(event, LiveEvent::CommentsNotSent(_));
        }
        assert!(
            told,
            "round {round}: alice was not told her comment was not sent"
        );
        let held = room.server_bodies().await;
        assert!(
            !held.iter().any(|body| body.starts_with(OFFLINE)),
            "round {round}: the server holds {held:?}"
        );
        assert!(
            !bodies(lock(&bob.live).doc(), &main)
                .iter()
                .any(|body| body.starts_with(OFFLINE)),
            "round {round}: bob sees {:?}",
            bodies(lock(&bob.live).doc(), &main)
        );
    }
    room.switch_comments(true).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let held = room.server_bodies().await;
    assert!(
        !held.iter().any(|body| body.starts_with(OFFLINE)),
        "after comments came back on the server holds {held:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_comment_written_offline_stays_off_the_server_round_after_round_over_a_socket() {
    a_comment_written_offline_stays_off_the_server_round_after_round(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_comment_written_offline_stays_off_the_server_round_after_round_over_long_poll() {
    a_comment_written_offline_stays_off_the_server_round_after_round(true).await;
}

async fn until_told(side: &mut Side) {
    tokio::time::timeout(WAIT, async {
        while let Some(event) = side.events.recv().await {
            if matches!(event, LiveEvent::CommentsNotSent(_)) {
                return;
            }
        }
        panic!("the events ended");
    })
    .await
    .expect("alice was told her comment was not sent");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_comment_refused_while_a_save_was_being_written_never_reaches_the_server_after_a_restart()
{
    let (room, bob_live, alice_live) = Room::open(false).await;
    let main = room.main.clone();
    let dir = tempfile::tempdir().expect("project folder");
    let mut bob = room.side(bob_live, &room.bob, false);
    let mut alice = room.side(alice_live, &room.alice, true);
    until_status(&mut bob, |status| *status == LiveStatus::Online).await;
    until_status(&mut alice, |status| *status == LiveStatus::Online).await;
    append(&alice, &main, " before");
    alice.handle.flush();
    until("bob sees alice's first words", || {
        text(&bob, &main).ends_with(" before") && !lock(&alice.live).has_unsent()
    })
    .await;
    save_shared(&alice.live, dir.path()).expect("save");

    room.proxy.go_offline();
    until_status(&mut alice, |status| {
        matches!(status, LiveStatus::Offline { .. })
    })
    .await;
    append(&alice, &main, " offline");
    let length = text(&alice, &main).encode_utf16().count();
    lock(&alice.live)
        .comment_doc()
        .create_comment_thread(
            &main,
            length - 3,
            length,
            room.alice.tokens.account_id,
            1,
            &format!("{OFFLINE} 0"),
            &[],
        )
        .expect("comment");
    save_shared(&alice.live, dir.path()).expect("save");
    let pending = lock(&alice.live)
        .begin_save(dir.path())
        .expect("a save starts");
    room.switch_comments(false).await;
    room.proxy.go_online();
    until_told(&mut alice).await;
    let written = pending.write();
    lock(&alice.live)
        .end_save(pending, written)
        .expect("the save ends");
    until("the offline words reach bob", || {
        text(&bob, &main).ends_with(" offline") && !lock(&alice.live).has_unsent()
    })
    .await;
    save_shared(&alice.live, dir.path()).expect("save");
    alice.handle.stopped().await;

    room.switch_comments(true).await;
    let reloaded = LiveProject::load(dir.path(), ProjectRole::Editor).expect("reload");
    let mut again = room.side(reloaded, &room.alice, true);
    until_status(&mut again, |status| *status == LiveStatus::Online).await;
    again.handle.flush();
    tokio::time::sleep(Duration::from_secs(2)).await;
    until("alice has nothing left to send", || {
        !lock(&again.live).has_unsent()
    })
    .await;
    append(&bob, &main, " after");
    bob.handle.flush();
    until("alice sees bob again", || {
        text(&again, &main).ends_with(" after")
    })
    .await;

    let held = room.server_bodies().await;
    assert!(
        !held.iter().any(|body| body.starts_with(OFFLINE)),
        "the server holds {held:?}"
    );
    assert!(bodies(lock(&bob.live).doc(), &main).is_empty());
    assert_eq!(text(&bob, &main).matches(" offline").count(), 1);
    assert_eq!(text(&again, &main), text(&bob, &main));
}
