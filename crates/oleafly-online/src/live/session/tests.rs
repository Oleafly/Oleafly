use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use oleafly_ot::testing::{insertion, EditorDoc, Reaction};
use oleafly_ot::{utf16_len, DocMessage, DocSink, OtError, TextOperation};
use serde_json::{json, Value};

use super::catch_up::History;
use super::state::{iso_time, JoinKind, State};
use super::{
    Account, DocStopReason, LiveEnd, LiveError, LivePort, LiveState, MergeReview, OverleafSession,
    SessionConfig, SessionTuning, SignedIn, UnsentDoc,
};
use crate::client::Http;
use crate::live::format::{operation_of, pieces_from_json, FormatState};
use crate::live::history_ot::RawOp;
use crate::live::join::parse_join;
use crate::live::journal::{journal_dir, DocRecord, Journal, ProjectManifest, SCHEMA};
use crate::live::{AppliedUpdate, DocId, PublicId};
use crate::realtime::connection::Carrier;
use crate::realtime::events::{PeerPosition, ProjectEvent};
use crate::realtime::project::{ProjectState, Role};
use crate::realtime::tree::PathChange;
use crate::session::{Session, SessionHandle};
use crate::test_support::mock_overleaf::{
    DocFormat as MockFormat, MockOverleaf, MockProject, MockUser, Privilege,
    Rejection as MockRejection,
};
use crate::test_support::overleaf_rt::{recordings, DocEvent, Recording, Trace};

const AGENT: &str = "Oleafly/test";
const WAIT: Duration = Duration::from_secs(20);
const MAIN: &str = "main.tex";
const INTRO: &str = "sections/intro.tex";
const NOTES: &str = "notes.tex";
const FILES: [(&str, &str); 3] = [(MAIN, "Hello"), (INTRO, "Intro"), (NOTES, "Notes")];

fn project() -> MockProject {
    let mut project = MockProject::new("live")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("vera"), Privilege::ReadOnly);
    for (path, text) in FILES {
        project = project.doc(path, text);
    }
    project
}

fn tuning() -> SessionTuning {
    SessionTuning {
        tick: Duration::from_millis(20),
        trickle_every: Duration::from_millis(20),
        legacy_check: Duration::from_millis(400),
        legacy_grace: Duration::from_millis(50),
        legacy_every: Duration::from_millis(20),
        call_timeout: Duration::from_secs(5),
        ..SessionTuning::default()
    }
}

#[derive(Default)]
struct Seen {
    states: Vec<LiveState>,
    roles: Vec<(Role, bool)>,
    peers: Vec<PeerPosition>,
    stopped: Vec<(DocId, DocStopReason)>,
    merged: Vec<(DocId, MergeReview)>,
    journal: Vec<Option<String>>,
    pending_docs: Vec<(DocId, bool)>,
    accounts: Vec<Account>,
}

#[derive(Default)]
struct Port {
    disk: Mutex<BTreeMap<String, String>>,
    seen: Mutex<Seen>,
}

impl Port {
    fn new(files: &[(&str, &str)]) -> Arc<Port> {
        let port = Port::default();
        port.disk.lock().unwrap().extend(
            files
                .iter()
                .map(|(path, text)| (path.to_string(), text.to_string())),
        );
        Arc::new(port)
    }

    fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap()
    }

    fn ended(&self) -> Option<LiveEnd> {
        self.seen()
            .states
            .iter()
            .rev()
            .find_map(|state| match state {
                LiveState::Ended(end) => Some(end.clone()),
                _ => None,
            })
    }

    fn offline_count(&self) -> usize {
        self.seen()
            .states
            .iter()
            .filter(|state| matches!(state, LiveState::Offline { .. }))
            .count()
    }

    fn went_offline(&self) -> bool {
        self.offline_count() > 0
    }
}

impl LivePort for Port {
    fn state(&self, state: LiveState) {
        self.seen().states.push(state);
    }

    fn role(&self, role: Role, tracking: bool) {
        self.seen().roles.push((role, tracking));
    }

    fn texts_changed(&self, _docs: Vec<DocId>) {}

    fn tree_changed(&self, _changes: Vec<PathChange>) {}

    fn peer(&self, peer: PeerPosition) {
        self.seen().peers.push(peer);
    }

    fn peer_left(&self, _id: &PublicId) {}

    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason) {
        self.seen().stopped.push((doc.clone(), reason));
    }

    fn project_event(&self, _event: ProjectEvent) {}

    fn merged(&self, doc: &DocId, review: MergeReview) {
        self.seen().merged.push((doc.clone(), review));
    }

    fn journal_failed(&self, reason: Option<String>) {
        self.seen().journal.push(reason);
    }

    fn disk_text(&self, path: &str) -> Option<String> {
        self.disk.lock().unwrap().get(path).cloned()
    }

    fn doc_pending(&self, doc: &DocId, pending: bool) {
        self.seen().pending_docs.push((doc.clone(), pending));
    }

    fn account_changed(&self, typed_as: Account) {
        self.seen().accounts.push(typed_as);
    }
}

struct Rig {
    mock: MockOverleaf,
    http: Http,
    data: tempfile::TempDir,
}

impl Rig {
    async fn start(project: MockProject) -> Rig {
        let mock = MockOverleaf::start(project).await;
        let http = Http::new(&mock.base, AGENT).unwrap();
        Rig {
            mock,
            http,
            data: tempfile::tempdir().unwrap(),
        }
    }

    fn id(&self, path: &str) -> DocId {
        DocId(self.mock.doc_id(path))
    }

    fn user_id(&self, name: &str) -> String {
        self.mock.user(name).id
    }

    fn handle_for(&self, user: &MockUser) -> SessionHandle {
        SessionHandle::new(
            &self.mock.base,
            Session {
                cookie: user.cookie(),
                user_id: user.id.clone(),
                email: user.email.clone(),
                saved_by: None,
            },
            None,
        )
    }

    fn config(&self, name: &str, tuning: SessionTuning) -> SessionConfig {
        let session = self.handle_for(&self.mock.user(name));
        SessionConfig {
            http: self.http.clone(),
            session,
            project_id: self.mock.project_id(),
            carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
            tuning,
        }
    }

    fn data(&self, name: &str) -> PathBuf {
        self.data.path().join(name)
    }

    async fn journal(&self, name: &str) -> Journal {
        let started = Instant::now();
        loop {
            match Journal::open(
                &self.data(name),
                &self.mock.base,
                &self.mock.project_id(),
                None,
            ) {
                Ok(journal) => return journal,
                Err(error) => {
                    assert!(started.elapsed() < WAIT, "{error}");
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            }
        }
    }

    async fn seed(&self, name: &str, version: u64) {
        let mut journal = self.journal(name).await;
        journal.set_manifest(ProjectManifest {
            user_id: self.user_id(name),
            history_version: Some(version),
            ..ProjectManifest::default()
        });
        journal.flush().unwrap();
    }

    async fn live(&self, name: &str, port: &Arc<Port>) -> Arc<OverleafSession> {
        self.live_tuned(name, port, tuning()).await
    }

    async fn live_tuned(
        &self,
        name: &str,
        port: &Arc<Port>,
        tuning: SessionTuning,
    ) -> Arc<OverleafSession> {
        let journal = self.journal(name).await;
        let port = Arc::clone(port) as Arc<dyn LivePort>;
        OverleafSession::start(self.config(name, tuning), port, journal)
            .await
            .unwrap()
    }

    fn connection_of(&self, name: &str) -> Option<String> {
        let id = self.user_id(name);
        self.mock
            .connections()
            .into_iter()
            .rev()
            .find(|connection| connection.user_id.as_deref() == Some(id.as_str()))
            .map(|connection| connection.public_id)
    }

    fn joined(&self, name: &str) -> BTreeSet<String> {
        let id = self.user_id(name);
        self.mock
            .connections()
            .into_iter()
            .filter(|connection| connection.user_id.as_deref() == Some(id.as_str()))
            .flat_map(|connection| connection.joined)
            .collect()
    }

    fn joins_except(&self, peers: &[&str]) -> Vec<String> {
        self.mock
            .received("joinDoc")
            .into_iter()
            .filter(|received| !peers.contains(&received.public_id.as_str()))
            .filter_map(|received| {
                received
                    .args
                    .first()
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    }

    fn updates_for(&self, doc: &DocId) -> Vec<Value> {
        self.mock
            .received("applyOtUpdate")
            .into_iter()
            .filter(|received| received.args.first() == Some(&json!(doc.0)))
            .filter_map(|received| received.args.get(1).cloned())
            .collect()
    }
}

fn record_of(live: &OverleafSession, doc: &DocId) -> Option<DocRecord> {
    let bytes = std::fs::read(live.journal_dir().join(format!("{}.json", doc.0))).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn manifest_of(live: &OverleafSession) -> Option<ProjectManifest> {
    let bytes = std::fs::read(live.journal_dir().join("project.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

struct Tab {
    doc: DocId,
    editor: EditorDoc,
    inbox: Arc<Mutex<VecDeque<DocMessage>>>,
}

impl Tab {
    fn open(live: &OverleafSession, path: &str) -> Tab {
        let inbox: Arc<Mutex<VecDeque<DocMessage>>> = Arc::default();
        let sink_inbox = Arc::clone(&inbox);
        let sink: DocSink = Arc::new(move |message| sink_inbox.lock().unwrap().push_back(message));
        let opened = live.open(path, sink).expect("a live doc");
        Tab {
            doc: DocId(opened.file_id.clone()),
            editor: EditorDoc::opened(&opened.file_id, 0, opened.rev, opened.text),
            inbox,
        }
    }

    fn next(&self) -> Option<DocMessage> {
        self.inbox.lock().unwrap().pop_front()
    }

    fn pump(&mut self, live: &OverleafSession) {
        while let Some(message) = self.next() {
            match self.editor.receive(message) {
                Reaction::Send(rev, op) => live.editor_change(&self.doc, rev, op).unwrap(),
                Reaction::Resync => panic!("the editor lost sync"),
                Reaction::Nothing => {}
            }
        }
    }

    fn text(&mut self, live: &OverleafSession) -> String {
        self.pump(live);
        self.editor.content.clone()
    }

    fn type_at(&mut self, live: &OverleafSession, at: usize, text: &str) {
        self.pump(live);
        self.editor.jump(at);
        if let Some((rev, op)) = self.editor.type_text(text).unwrap() {
            live.editor_change(&self.doc, rev, op).unwrap();
        }
        self.pump(live);
    }

    fn type_end(&mut self, live: &OverleafSession, text: &str) {
        self.pump(live);
        let end = self.editor.length;
        self.type_at(live, end, text);
    }
}

#[tokio::test]
async fn every_open_tab_and_every_unopened_doc_stays_current() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let (main, intro, notes) = (rig.id(MAIN), rig.id(INTRO), rig.id(NOTES));
    let mut tab = Tab::open(&live, MAIN);
    eventually("alice joins the open doc", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.join(&intro.0);
    bob.type_at(&main.0, 5, " world");
    bob.type_at(&intro.0, 0, "An ");
    bob.type_at(&intro.0, 3, "early ");
    eventually("the tab follows bob", || tab.text(&live) == "Hello world").await;
    eventually("the unopened doc follows bob", || {
        live.text(&intro).as_deref() == Some("An early Intro")
    })
    .await;
    assert_eq!(rig.mock.doc_text(&intro.0), "An early Intro");
    assert_eq!(live.text(&notes), None);
    assert!(!rig.joined("alice").contains(&notes.0));
    let joins = rig.joins_except(&[&bob.public_id]);
    assert_eq!(joins.iter().filter(|doc| **doc == intro.0).count(), 1);
    assert!(tab.editor.synchronized());
    live.stop().await;
    assert_eq!(port.ended(), Some(LiveEnd::Stopped));
}

#[tokio::test]
async fn typing_in_two_tabs_reaches_the_server_in_order_per_doc() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let (main, intro) = (rig.id(MAIN), rig.id(INTRO));
    let mut main_tab = Tab::open(&live, MAIN);
    let mut intro_tab = Tab::open(&live, INTRO);
    eventually("both docs are joined", || {
        let joined = rig.joined("alice");
        joined.contains(&main.0) && joined.contains(&intro.0)
    })
    .await;
    for (index, word) in ["one", "two", "three", "four", "five"]
        .into_iter()
        .enumerate()
    {
        main_tab.type_end(&live, &format!(" {word}"));
        intro_tab.type_end(&live, &format!(" {index}"));
    }
    assert!(live.settle(WAIT).await);
    main_tab.pump(&live);
    intro_tab.pump(&live);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello one two three four five");
    assert_eq!(rig.mock.doc_text(&intro.0), "Intro 0 1 2 3 4");
    for doc in [&main, &intro] {
        let versions: Vec<u64> = rig
            .updates_for(doc)
            .iter()
            .map(|update| update["v"].as_u64().unwrap())
            .collect();
        assert!(!versions.is_empty());
        assert!(
            versions.windows(2).all(|pair| pair[0] < pair[1]),
            "{versions:?}"
        );
    }
    assert!(main_tab.editor.synchronized() && intro_tab.editor.synchronized());
    assert_eq!(main_tab.text(&live), "Hello one two three four five");
    live.stop().await;
}

#[tokio::test]
async fn editor_ack_does_not_wait_for_overleaf() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.editor.jump(5);
    let (rev, op) = tab.editor.type_text("!").unwrap().unwrap();
    live.editor_change(&tab.doc, rev, op).unwrap();
    let acked = matches!(tab.next(), Some(DocMessage::Ack { rev: 1, length: 6 }));
    assert!(acked, "the editor had its ack before the server answered");
    tab.editor.outstanding = None;
    assert!(!live.settle(Duration::from_millis(200)).await);
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello!");
    assert_eq!(rig.updates_for(&main).len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_broadcast_for_an_unknown_doc_joins_it_and_applies_buffered_events() {
    for format in [MockFormat::ShareJs, MockFormat::HistoryOt] {
        let rig = Rig::start(project().format(format)).await;
        rig.seed("alice", 0).await;
        let port = Port::new(&FILES);
        let live = rig.live("alice", &port).await;
        let intro = rig.id(INTRO);
        let mut bob = rig.mock.peer("bob");
        bob.join(&intro.0);
        rig.mock.stall();
        for (at, word) in [(5, " one"), (9, " two"), (13, " three")] {
            bob.type_at(&intro.0, at, word);
        }
        rig.mock.resume();
        eventually("the broadcast doc catches up", || {
            live.text(&intro).as_deref() == Some("Intro one two three")
        })
        .await;
        bob.type_at(&intro.0, 0, ">");
        eventually("later broadcasts apply", || {
            live.text(&intro).as_deref() == Some(">Intro one two three")
        })
        .await;
        assert_eq!(
            rig.joins_except(&[&bob.public_id]),
            vec![intro.0.clone()],
            "{format:?}"
        );
        assert!(port.seen().stopped.is_empty(), "{format:?}");
        live.stop().await;
    }
}

#[tokio::test]
async fn startup_catch_up_joins_only_changed_docs() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(rig.joined("alice").is_empty());
    live.stop().await;
    drop(live);

    let intro = rig.id(INTRO);
    let mut bob = rig.mock.peer("bob");
    bob.join(&intro.0);
    bob.type_at(&intro.0, 0, "New ");
    bob.type_at(&intro.0, 4, "and improved ");
    let before = rig.mock.received("joinDoc").len();
    let live = rig.live("alice", &port).await;
    eventually("the changed doc is current", || {
        live.text(&intro).as_deref() == Some("New and improved Intro")
    })
    .await;
    eventually("the history version is stored", || {
        manifest_of(&live).and_then(|manifest| manifest.history_version) == Some(2)
    })
    .await;
    let joined: Vec<String> = rig.mock.received("joinDoc")[before..]
        .iter()
        .filter(|received| received.public_id != bob.public_id)
        .filter_map(|received| received.args[0].as_str().map(str::to_string))
        .collect();
    assert_eq!(joined, vec![intro.0.clone()]);
    assert_eq!(live.text(&rig.id(MAIN)), None);
    live.stop().await;
}

#[tokio::test]
async fn free_plan_history_402_trickles_joins() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| config.history_status = 402);
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let mut tuned = tuning();
    tuned.trickle_every = Duration::from_millis(400);
    let live = rig.live_tuned("alice", &port, tuned).await;
    eventually("the first trickled join", || {
        !rig.joins_except(&[]).is_empty()
    })
    .await;
    assert_eq!(rig.joins_except(&[]).len(), 1);
    eventually("every doc is joined", || {
        rig.joins_except(&[]).len() == FILES.len()
    })
    .await;
    let joined: BTreeSet<String> = rig.joins_except(&[]).into_iter().collect();
    assert_eq!(joined.len(), FILES.len());
    for (path, text) in FILES {
        eventually("each doc is current", || {
            live.text(&rig.id(path)).as_deref() == Some(text)
        })
        .await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(rig.joins_except(&[]).len(), FILES.len());
    assert_eq!(manifest_of(&live).unwrap().history_version, Some(0));
    live.stop().await;
}

fn many_docs(count: usize) -> MockProject {
    let mut project =
        MockProject::new("many").member(MockUser::named("bob"), Privilege::ReadAndWrite);
    for index in 0..count {
        project = project.doc(
            &format!("chapters/c{index:03}.tex"),
            &format!("Chapter {index}"),
        );
    }
    project
}

#[tokio::test]
async fn legacy_doc_room_server_joins_all_docs_paced() {
    let rig = Rig::start(many_docs(6)).await;
    rig.mock.configure(|config| config.legacy_doc_rooms = true);
    rig.seed("alice", 0).await;
    let port = Port::new(&[]);
    let live = rig.live("alice", &port).await;
    let first = rig.id("chapters/c000.tex");
    let mut bob = rig.mock.peer("bob");
    bob.join(&first.0);
    bob.type_at(&first.0, 0, "Bob: ");
    eventually("every doc is joined after the legacy check", || {
        rig.joined("alice").len() == 6
    })
    .await;
    eventually("the edited doc is current", || {
        live.text(&first).as_deref() == Some("Bob: Chapter 0")
    })
    .await;
    bob.type_at(&first.0, 0, "> ");
    eventually("room broadcasts reach the joined doc", || {
        live.text(&first).as_deref() == Some("> Bob: Chapter 0")
    })
    .await;
    let joins = rig.joins_except(&[&bob.public_id]);
    let unique: BTreeSet<&String> = joins.iter().collect();
    assert_eq!((joins.len(), unique.len()), (6, 6));
    live.stop().await;
}

#[tokio::test]
async fn joining_three_hundred_docs_is_paced() {
    let rig = Rig::start(many_docs(300)).await;
    rig.mock.configure(|config| config.history_status = 402);
    let port = Port::new(&[]);
    let mut tuned = tuning();
    tuned.trickle_every = Duration::from_millis(2);
    let live = rig.live_tuned("alice", &port, tuned).await;
    eventually("all 300 docs are joined", || {
        rig.joins_except(&[]).len() >= 300
    })
    .await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let joins = rig.joins_except(&[]);
    let unique: BTreeSet<&String> = joins.iter().collect();
    assert_eq!((joins.len(), unique.len()), (300, 300));
    assert!(rig
        .mock
        .connections()
        .iter()
        .all(|connection| !connection.joined.is_empty()));
    live.stop().await;

    let docs: Vec<(String, String)> = (0..300)
        .map(|index| (format!("{index:024x}"), format!("c{index:03}.tex")))
        .collect();
    let mut state = watcher(&docs);
    state.start_history(History::default(), Duration::from_secs(1));
    let start = Instant::now();
    let mut joined = 0;
    for second in 0..300 {
        let now = start + Duration::from_secs(second);
        let batch = state.next_joins(now, 8);
        assert_eq!(batch.len(), 1, "second {second}");
        assert!(state
            .next_joins(now + Duration::from_millis(999), 8)
            .is_empty());
        joined += batch.len();
    }
    assert_eq!(joined, 300);
    assert!(state
        .next_joins(start + Duration::from_secs(400), 8)
        .is_empty());

    let mut legacy = watcher(&docs);
    let changed: BTreeSet<String> = ["c000.tex".to_string()].into();
    assert!(legacy.legacy_from(&changed, 4, Duration::from_secs(1)));
    let mut rounds = 0;
    while !legacy
        .next_joins(start + Duration::from_secs(rounds), 8)
        .is_empty()
    {
        rounds += 1;
    }
    assert_eq!(rounds, 75);
}

struct Watcher {
    state: State,
    port: Arc<Port>,
    _dir: tempfile::TempDir,
    _journal: Journal,
}

impl Watcher {
    fn deliver(&mut self) {
        let notices = std::mem::take(&mut self.state.notices);
        super::state::deliver(self.port.as_ref(), notices);
    }
}

impl std::ops::Deref for Watcher {
    type Target = State;

    fn deref(&self) -> &State {
        &self.state
    }
}

impl std::ops::DerefMut for Watcher {
    fn deref_mut(&mut self) -> &mut State {
        &mut self.state
    }
}

fn watcher(docs: &[(String, String)]) -> Watcher {
    let docs: Vec<Value> = docs
        .iter()
        .map(|(id, name)| json!({ "_id": id, "name": name }))
        .collect();
    let project = ProjectState::from_join(json!({
        "publicId": "P.watcher",
        "permissionsLevel": "owner",
        "project": {
            "_id": "64f0c0ffee0123456789abcd",
            "name": "watcher",
            "rootFolder": [{ "_id": "f0", "name": "rootFolder", "docs": docs, "fileRefs": [], "folders": [] }],
            "owner": { "_id": "alice", "email": "alice@example.com", "privileges": "owner" },
        },
    }))
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let journal = Journal::open(
        dir.path(),
        "http://localhost:8080",
        "64f0c0ffee0123456789abcd",
        None,
    )
    .unwrap();
    let port = Port::new(&[]);
    let mut state = State::new(
        project,
        Account {
            user_id: "alice".into(),
            email: "alice@example.com".into(),
        },
        &journal,
        Arc::clone(&port) as Arc<dyn LivePort>,
    );
    state.connected(PublicId("P.watcher".into()), 0);
    Watcher {
        state,
        port,
        _dir: dir,
        _journal: journal,
    }
}

#[tokio::test]
async fn format_follows_join_doc_every_time() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let mut expected = String::from("Hello");
    for (round, format) in [
        MockFormat::ShareJs,
        MockFormat::HistoryOt,
        MockFormat::ShareJs,
    ]
    .into_iter()
    .enumerate()
    {
        if round > 0 {
            rig.mock.set_doc_format(&main.0, format);
            let before = rig.connection_of("alice").unwrap();
            let drops = port.offline_count();
            rig.mock.disconnect(&before);
            eventually("the session sees the drop", || port.offline_count() > drops).await;
            let offline_word = format!(" {round}a");
            tab.type_end(&live, &offline_word);
            expected.push_str(&offline_word);
            eventually("alice reconnects and rejoins", || {
                rig.connection_of("alice").is_some_and(|now| now != before)
                    && rig.joined("alice").contains(&main.0)
            })
            .await;
        }
        let word = format!(" {round}");
        tab.type_end(&live, &word);
        expected.push_str(&word);
        assert!(live.settle(WAIT).await, "{format:?}");
        assert_eq!(rig.mock.doc_text(&main.0), expected, "{format:?}");
        let last = rig.updates_for(&main).pop().unwrap();
        let history_ot = last["op"][0].get("textOperation").is_some();
        assert_eq!(
            history_ot,
            format == MockFormat::HistoryOt,
            "{format:?}: {last}"
        );
    }
    assert_eq!(tab.text(&live), expected);
    assert!(port.seen().stopped.is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_restart_with_an_unacknowledged_op_sends_it_exactly_once() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " once");
    eventually("the server applied it", || {
        rig.mock.doc_text(&main.0) == "Hello once"
    })
    .await;
    let record = record_of(&live, &main).expect("the op is journaled before it is sent");
    let inflight = record.inflight.expect("an op in flight");
    assert_eq!(inflight.base_version, 0);
    assert_eq!(inflight.public_ids.len(), 1);
    drop(tab);
    drop(live);
    rig.mock.resume();

    let restarted = Port::new(&FILES);
    let live = rig.live("alice", &restarted).await;
    eventually("the restarted doc settles", || {
        live.text(&main).as_deref() == Some("Hello once") && record_of(&live, &main).is_none()
    })
    .await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello once");
    assert_eq!(rig.updates_for(&main).len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn the_journal_survives_a_kill_between_send_and_ack() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " sent");
    eventually("the server applied the send", || {
        rig.mock.doc_text(&main.0) == "Hello sent"
    })
    .await;
    tab.type_end(&live, " pending");
    eventually("the pending typing is journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello sent pending")
    })
    .await;
    let killed = Instant::now();
    drop(tab);
    drop(live);
    rig.mock.resume();
    let record = {
        let journal = rig.journal("alice").await;
        journal.docs()[&main].clone()
    };
    assert!(killed.elapsed() < WAIT);
    assert_eq!(record.base_text, "Hello");
    assert!(record.inflight.is_some());

    let restarted = Port::new(&FILES);
    let live = rig.live("alice", &restarted).await;
    eventually("both parts reach the server once", || {
        rig.mock.doc_text(&main.0) == "Hello sent pending"
    })
    .await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello sent pending");
    assert_eq!(live.text(&main).as_deref(), Some("Hello sent pending"));
    assert!(restarted.seen().merged.is_empty());
    live.stop().await;
}

#[tokio::test]
async fn journal_never_lands_in_project_folder() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let dir = live.journal_dir();
    assert!(dir.starts_with(rig.data("alice")));
    let folder = rig.data.path().join("project-folder");
    std::fs::create_dir_all(&folder).unwrap();
    assert!(!dir.starts_with(&folder));
    let relative = dir.strip_prefix(rig.data("alice")).unwrap();
    assert!(!relative.to_string_lossy().contains(':'), "{relative:?}");
    assert_eq!(
        dir,
        journal_dir(&rig.data("alice"), &rig.mock.base, &rig.mock.project_id()).unwrap()
    );
    live.stop().await;
}

#[tokio::test]
async fn journal_path_has_no_colon_on_windows() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    assert!(rig.mock.base.contains(':'));
    for part in live
        .journal_dir()
        .strip_prefix(rig.data("alice"))
        .unwrap()
        .components()
    {
        assert!(!part.as_os_str().to_string_lossy().contains(':'));
    }
    live.stop().await;
}

#[tokio::test]
async fn a_second_process_cannot_go_live_on_the_same_project() {
    let rig = Rig::start(project()).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let second = Journal::open(
        &rig.data("alice"),
        &rig.mock.base,
        &rig.mock.project_id(),
        None,
    )
    .unwrap_err();
    let error = crate::error::OnlineError::from(second);
    assert_eq!(error.kind, crate::error::OnlineErrorKind::LiveElsewhere);
    live.stop().await;
    drop(live);
    rig.journal("alice").await;
}

#[tokio::test]
async fn a_journal_from_another_user_is_not_sent() {
    let rig = Rig::start(project()).await;
    let main = rig.id(MAIN);
    {
        let mut journal = rig.journal("alice").await;
        journal.set_manifest(ProjectManifest {
            user_id: "someone-else".into(),
            history_version: Some(0),
            ..ProjectManifest::default()
        });
        journal.put(
            &main,
            Some(DocRecord {
                schema: SCHEMA,
                format: "sharejs-text-ot".into(),
                base_text: "Hello".into(),
                base_raw: None,
                base_version: 0,
                local_text: "Hello from someone else".into(),
                inflight: None,
                provisional: false,
                path: None,
            }),
        );
        journal.flush().unwrap();
    }
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let kept = MergeReview::Kept {
        text: "Hello from someone else".into(),
    };
    assert!(port.seen().merged.contains(&(main.clone(), kept)));
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    assert!(rig.mock.received("applyOtUpdate").is_empty());
    assert!(record_of(&live, &main).is_none());
    assert_eq!(manifest_of(&live).unwrap().user_id, rig.user_id("alice"));
    live.stop().await;
}

#[tokio::test]
async fn journal_write_failure_banners_and_retries() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let blocker = live.journal_dir().join(format!("{}.json", main.0));
    std::fs::create_dir_all(blocker.join("in-the-way")).unwrap();
    rig.mock.stall();
    tab.type_end(&live, " saved");
    eventually("the banner is raised", || !port.seen().journal.is_empty()).await;
    tab.type_end(&live, " again");
    tokio::time::sleep(Duration::from_millis(700)).await;
    {
        let seen = port.seen();
        assert_eq!(seen.journal.len(), 1, "{:?}", seen.journal);
        assert!(seen.journal[0].is_some());
    }
    std::fs::remove_dir_all(&blocker).unwrap();
    eventually("a retry clears the banner", || {
        port.seen().journal.last() == Some(&None)
    })
    .await;
    eventually("the unsent work is on disk", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello saved again")
    })
    .await;
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    eventually("the settled doc's journal is gone", || !blocker.exists()).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello saved again");
    live.stop().await;
}

#[tokio::test]
async fn settled_doc_journal_is_deleted() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " soon");
    eventually("the unsent work is journaled", || {
        record_of(&live, &main).is_some()
    })
    .await;
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    eventually("the record is deleted", || {
        record_of(&live, &main).is_none()
    })
    .await;
    assert!(!live.journal_dir().join(format!("{}.json", main.0)).exists());
    assert!(live.journal_dir().join("project.json").is_file());
    live.stop().await;
}

#[tokio::test]
async fn unknown_journal_schema_is_kept_not_replayed() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let main = rig.id(MAIN);
    let dir = journal_dir(&rig.data("alice"), &rig.mock.base, &rig.mock.project_id()).unwrap();
    let future = json!({ "schema": SCHEMA + 1, "local_text": "Hello from the future" });
    std::fs::write(dir.join(format!("{}.json", main.0)), future.to_string()).unwrap();
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.mock.received("applyOtUpdate").is_empty());
    assert!(rig.joined("alice").is_empty());
    let kept = dir.join("kept").join(format!("{}.json", main.0));
    let copy: Value = serde_json::from_slice(&std::fs::read(kept).unwrap()).unwrap();
    assert_eq!(copy, future);
    live.stop().await;
}

#[tokio::test]
async fn typing_before_first_join_against_a_stale_baseline_merges() {
    let rig = Rig::start(project()).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.type_at(&main.0, 5, " world");
    rig.seed("alice", 1).await;
    let port = Port::new(&[(MAIN, "Hello")]);
    let live = rig.live("alice", &port).await;
    rig.mock.stall();
    let mut tab = Tab::open(&live, MAIN);
    assert_eq!(tab.editor.content, "Hello");
    tab.type_at(&live, 0, "Oh, ");
    assert_eq!(live.text(&main).as_deref(), Some("Oh, Hello"));
    rig.mock.resume();
    eventually("the merge reaches the editor", || {
        tab.text(&live) == "Oh, Hello world"
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Oh, Hello world");
    let merged = MergeReview::Merged {
        before: "Oh, Hello".into(),
        after: "Oh, Hello world".into(),
    };
    assert_eq!(port.seen().merged, vec![(main.clone(), merged)]);
    live.stop().await;
}

#[tokio::test]
async fn overlapping_typing_before_the_first_join_waits_for_review() {
    let rig = Rig::start(project()).await;
    let main = rig.id(MAIN);
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.type_at(&main.0, 5, " world");
    rig.seed("alice", 1).await;
    let port = Port::new(&[(MAIN, "Hello")]);
    let live = rig.live("alice", &port).await;
    rig.mock.stall();
    let mut tab = Tab::open(&live, MAIN);
    tab.type_at(&live, 5, " there");
    rig.mock.resume();
    let review = MergeReview::NeedsReview {
        mine: "Hello there".into(),
        theirs: "Hello world".into(),
    };
    eventually("the conflict is listed", || {
        port.seen().merged.contains(&(main.clone(), review.clone()))
    })
    .await;
    eventually("the held text is journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello there")
    })
    .await;
    tab.type_end(&live, "?");
    eventually("typing while held stays local", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello there?")
    })
    .await;
    assert_eq!(live.text(&main).as_deref(), Some("Hello there?"));
    assert_eq!(rig.mock.doc_text(&main.0), "Hello world");
    let sent_by_alice = rig
        .mock
        .received("applyOtUpdate")
        .into_iter()
        .filter(|received| received.public_id != bob.public_id)
        .count();
    assert_eq!(sent_by_alice, 0);
    let edit = live.local_edit_with(&main, |_| Some(TextOperation::new()));
    assert_eq!(edit, Err(LiveError::NotWritable));
    live.stop().await;
}

#[tokio::test]
async fn history_version_and_doc_version_are_never_mixed() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let (main, notes) = (rig.id(MAIN), rig.id(NOTES));
    let mut bob = rig.mock.peer("bob");
    bob.join(&notes.0);
    for word in [" a", " b", " c"] {
        bob.type_at(&notes.0, 5, word);
    }
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    eventually("the history version follows /updates", || {
        manifest_of(&live).and_then(|manifest| manifest.history_version) == Some(3)
    })
    .await;
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let version = rig.mock.doc_version(&main.0);
    rig.mock.stall();
    tab.type_end(&live, "!");
    eventually("the doc record is written", || {
        record_of(&live, &main).is_some()
    })
    .await;
    let record = record_of(&live, &main).unwrap();
    assert_eq!(record.base_version, version);
    assert_eq!(record.base_version, 0);
    assert_eq!(record.inflight.unwrap().base_version, 0);
    assert_eq!(manifest_of(&live).unwrap().history_version, Some(3));
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    assert_eq!(manifest_of(&live).unwrap().history_version, Some(3));
    live.stop().await;
}

#[tokio::test]
async fn a_dropped_connection_acknowledges_an_applied_op_without_resending() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " once");
    eventually("the server applied it", || {
        rig.mock.doc_text(&main.0) == "Hello once"
    })
    .await;
    let before = rig.connection_of("alice").unwrap();
    rig.mock.drop_client(&before);
    rig.mock.resume();
    eventually("alice is back", || {
        rig.connection_of("alice").is_some_and(|now| now != before)
    })
    .await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello once");
    assert_eq!(rig.updates_for(&main).len(), 1);
    assert!(port.went_offline());
    assert!(matches!(
        port.seen().states.last(),
        Some(LiveState::Online { pending: 0 })
    ));
    tab.type_end(&live, " more");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello once more");
    live.stop().await;
}

#[tokio::test]
async fn typing_while_offline_is_sent_after_reconnecting() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.crash();
    eventually("the session notices", || port.went_offline()).await;
    tab.type_end(&live, " offline");
    assert_eq!(tab.text(&live), "Hello offline");
    eventually("the offline typing is journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello offline")
    })
    .await;
    rig.mock.recover();
    eventually("the typing reaches the server", || {
        rig.mock.doc_text(&main.0) == "Hello offline"
    })
    .await;
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.updates_for(&main).len(), 1);
    live.stop().await;
}

#[tokio::test]
async fn a_server_that_stops_answering_is_treated_as_lost() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let mut tuned = tuning();
    tuned.call_timeout = Duration::from_millis(300);
    let live = rig.live_tuned("alice", &port, tuned).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " late");
    eventually("the session gives up on the call", || port.went_offline()).await;
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello late");
    live.stop().await;
}

#[tokio::test]
async fn an_update_error_rejoins_once_then_stops_the_doc() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let (main, intro) = (rig.id(MAIN), rig.id(INTRO));
    let mut tab = Tab::open(&live, MAIN);
    let mut other = Tab::open(&live, INTRO);
    eventually("the docs are joined", || {
        let joined = rig.joined("alice");
        joined.contains(&main.0) && joined.contains(&intro.0)
    })
    .await;
    rig.mock
        .fail_next_update(&main.0, "Delete component does not match");
    tab.type_end(&live, " retried");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello retried");
    assert!(port.seen().stopped.is_empty());

    rig.mock
        .fail_updates(&main.0, "Delete component does not match", 2);
    tab.type_end(&live, " x");
    eventually("the second failure stops the doc", || {
        port.seen()
            .stopped
            .iter()
            .any(|(doc, reason)| doc == &main && matches!(reason, DocStopReason::Server(_)))
    })
    .await;
    assert_eq!(live.text(&main).as_deref(), Some("Hello retried x"));
    eventually("the stopped doc keeps its unsent text", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello retried x")
    })
    .await;
    other.type_end(&live, " still live");
    eventually("other docs keep working", || {
        rig.mock.doc_text(&intro.0) == "Intro still live"
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn a_stopped_doc_with_unsent_text_never_reads_as_settled() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock
        .fail_updates(&main.0, "Delete component does not match", 2);
    tab.type_end(&live, " kept");
    eventually("the doc stops", || {
        port.seen()
            .stopped
            .iter()
            .any(|(doc, reason)| doc == &main && matches!(reason, DocStopReason::Server(_)))
    })
    .await;
    assert!(!live.settle(Duration::from_millis(300)).await);
    let unsent = live.unsent(Duration::from_millis(100)).await;
    let expected = UnsentDoc {
        doc: main.clone(),
        path: MAIN.into(),
    };
    assert_eq!(unsent, vec![expected]);
    assert!(record_of(&live, &main).is_some_and(|record| record.local_text == "Hello kept"));
    eventually("the status counts the stopped doc", || {
        matches!(
            port.seen().states.last(),
            Some(LiveState::Online { pending: 1 })
        )
    })
    .await;
    assert_ne!(rig.mock.doc_text(&main.0), "Hello kept");
    live.stop().await;
}

fn parked(port: &Port) -> bool {
    matches!(port.seen().states.last(), Some(LiveState::SignedOut { .. }))
}

async fn sign_out_mid_session(rig: &Rig, port: &Port, name: &str) -> MockUser {
    let renewed = rig.mock.expire_session(name);
    rig.mock.drop_client(&rig.connection_of(name).unwrap());
    eventually("the session parks signed out", || parked(port)).await;
    renewed
}

#[tokio::test]
async fn expired_session_keeps_typing_and_resumes_once() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let renewed = sign_out_mid_session(&rig, &port, "alice").await;
    tab.type_end(&live, " offline");
    assert_eq!(tab.text(&live), "Hello offline");
    eventually("the typing is journaled", || {
        record_of(&live, &main).is_some_and(|record| record.local_text == "Hello offline")
    })
    .await;
    assert!(matches!(
        port.seen().states.last(),
        Some(LiveState::SignedOut { pending: 1 })
    ));
    assert_eq!(port.ended(), None);
    assert!(rig.updates_for(&main).is_empty());
    assert_eq!(live.signed_in(rig.handle_for(&renewed)), SignedIn::Resumed);
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello offline");
    assert_eq!(rig.updates_for(&main).len(), 1);
    assert!(matches!(
        port.seen().states.last(),
        Some(LiveState::Online { pending: 0 })
    ));
    assert!(port.seen().accounts.is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_mid_session_account_switch_keeps_the_old_text_as_copies_and_sends_none() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    sign_out_mid_session(&rig, &port, "alice").await;
    tab.type_end(&live, " from alice");
    let alice = rig.mock.user("alice");
    let bob = rig.mock.user("bob");
    let typed_as = Account {
        user_id: alice.id.clone(),
        email: alice.email.clone(),
    };
    let outcome = live.signed_in(rig.handle_for(&bob));
    assert_eq!(
        outcome,
        SignedIn::AccountChanged {
            typed_as: typed_as.clone()
        }
    );
    let kept = MergeReview::Kept {
        text: "Hello from alice".into(),
    };
    assert!(port.seen().merged.contains(&(main.clone(), kept)));
    assert_eq!(port.seen().accounts, vec![typed_as]);
    eventually("the tab shows the server's text", || {
        tab.text(&live) == "Hello"
    })
    .await;
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    assert!(rig.updates_for(&main).is_empty());
    assert!(record_of(&live, &main).is_none());
    let manifest = manifest_of(&live).unwrap();
    assert_eq!((manifest.user_id, manifest.user_email), (bob.id, bob.email));
    live.stop().await;
}

#[tokio::test]
async fn signing_in_again_as_the_same_user_while_live_sends_nothing_twice() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " one");
    let before = rig.connection_of("alice").unwrap();
    let alice = rig.mock.user("alice");
    assert_eq!(live.signed_in(rig.handle_for(&alice)), SignedIn::Resumed);
    eventually("the session reconnects with the new handle", || {
        rig.connection_of("alice").is_some_and(|now| now != before)
            && rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " two");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello one two");
    assert_eq!(rig.updates_for(&main).len(), 2);
    assert!(port.seen().accounts.is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_false_sign_out_alarm_never_parks_the_session() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    rig.mock
        .configure(|config| config.reject_connections = Some(MockRejection::InvalidSession));
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("the session ends", || port.ended().is_some()).await;
    assert_eq!(port.ended(), Some(LiveEnd::AccessEnded));
    let parked_ever = port
        .seen()
        .states
        .iter()
        .any(|state| matches!(state, LiveState::SignedOut { .. }));
    assert!(!parked_ever);
    live.stop().await;
}

#[tokio::test]
async fn a_journal_for_a_deleted_doc_is_kept_as_a_copy() {
    let rig = Rig::start(project()).await;
    let gone = DocId("deadbeefdeadbeefdeadbeef".into());
    {
        let mut journal = rig.journal("alice").await;
        journal.set_manifest(ProjectManifest {
            user_id: rig.user_id("alice"),
            history_version: Some(0),
            ..ProjectManifest::default()
        });
        journal.put(
            &gone,
            Some(DocRecord {
                schema: SCHEMA,
                format: "sharejs-text-ot".into(),
                base_text: "Old".into(),
                base_raw: None,
                base_version: 3,
                local_text: "Old and unsent".into(),
                inflight: None,
                provisional: false,
                path: None,
            }),
        );
        journal.flush().unwrap();
    }
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    eventually("the removed doc is reported", || {
        port.seen()
            .stopped
            .contains(&(gone.clone(), DocStopReason::Removed))
    })
    .await;
    let kept = MergeReview::Kept {
        text: "Old and unsent".into(),
    };
    assert!(port.seen().merged.contains(&(gone.clone(), kept)));
    eventually("its journal entry is gone", || {
        record_of(&live, &gone).is_none()
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn a_viewer_cannot_change_the_doc() {
    let rig = Rig::start(project()).await;
    rig.seed("vera", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("vera", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Viewer, false)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("vera").contains(&main.0)).await;
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    live.editor_change(&tab.doc, rev, op).unwrap();
    tab.pump(&live);
    assert_eq!(tab.editor.content, "Hello");
    assert_eq!(tab.editor.resets, 1);
    assert_eq!(
        live.local_edit_with(&main, |_| Some(TextOperation::new())),
        Err(LiveError::NotWritable)
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.mock.received("applyOtUpdate").is_empty());
    assert_eq!(rig.mock.doc_text(&main.0), "Hello");
    live.stop().await;
}

#[tokio::test]
async fn track_changes_sends_suggestions() {
    let rig = Rig::start(project().track_changes(json!(true))).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    assert_eq!(port.seen().roles.first(), Some(&(Role::Owner, true)));
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " suggested");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(update["meta"]["tc"].is_string(), "{update}");
    rig.mock.set_track_changes(json!(false));
    eventually("tracking turns off", || {
        port.seen().roles.last() == Some(&(Role::Owner, false))
    })
    .await;
    tab.type_end(&live, " plain");
    assert!(live.settle(WAIT).await);
    let update = rig.updates_for(&main).pop().unwrap();
    assert!(update.get("meta").is_none(), "{update}");
    live.stop().await;
}

#[tokio::test]
async fn removal_from_the_project_ends_the_session() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    rig.mock.set_privilege("bob", None);
    eventually("the session ends", || {
        port.ended() == Some(LiveEnd::AccessEnded)
    })
    .await;
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    assert_eq!(live.editor_change(&tab.doc, rev, op), Err(LiveError::Ended));
    live.stop().await;
    assert_eq!(port.ended(), Some(LiveEnd::AccessEnded));
}

#[tokio::test]
async fn a_downgrade_to_viewer_holds_typing() {
    let rig = Rig::start(project()).await;
    rig.seed("bob", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("bob", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || rig.joined("bob").contains(&main.0)).await;
    rig.mock.set_privilege("bob", Some(Privilege::ReadOnly));
    eventually("the role drops to viewer", || {
        port.seen().roles.last() == Some(&(Role::Viewer, false))
    })
    .await;
    tab.type_end(&live, " nope");
    assert_eq!(tab.text(&live), "Hello");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.updates_for(&main).is_empty());
    live.stop().await;
}

#[tokio::test]
async fn a_project_gone_on_reconnect_ends_the_session() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    rig.mock
        .configure(|config| config.reject_connections = Some(MockRejection::ProjectNotFound));
    rig.mock.drop_client(&rig.connection_of("alice").unwrap());
    eventually("the session ends", || {
        port.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn a_forced_disconnect_reconnects_after_the_delay() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let before = rig.connection_of("alice").unwrap();
    rig.mock.force_disconnect("maintenance", 0);
    eventually("alice is back on a new connection", || {
        rig.connection_of("alice").is_some_and(|now| now != before)
            && rig.joined("alice").contains(&main.0)
    })
    .await;
    tab.type_end(&live, " after");
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello after");
    live.stop().await;
}

#[tokio::test]
async fn stop_keeps_unsent_work_in_the_journal() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " later");
    live.stop().await;
    assert_eq!(port.ended(), Some(LiveEnd::Stopped));
    tab.editor.jump(0);
    let (rev, op) = tab.editor.type_text("x").unwrap().unwrap();
    assert_eq!(live.editor_change(&tab.doc, rev, op), Err(LiveError::Ended));
    drop(live);
    let journal = rig.journal("alice").await;
    assert_eq!(journal.docs()[&main].local_text, "Hello later");
    rig.mock.resume();
}

#[tokio::test]
async fn presence_goes_out_and_peers_come_in() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    live.presence(Some((main.clone(), 3)));
    eventually("the position reaches the server", || {
        rig.mock
            .received("clientTracking.updatePosition")
            .iter()
            .any(|received| received.args[0] == json!({ "row": 0, "column": 3, "doc_id": main.0 }))
    })
    .await;
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.emit(
        "clientTracking.updatePosition",
        vec![json!({ "row": 0, "column": 1, "doc_id": main.0 })],
    );
    eventually("bob's position arrives", || {
        port.seen()
            .peers
            .iter()
            .any(|peer| peer.doc.as_ref() == Some(&main) && peer.column == Some(1))
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn an_edit_sees_a_coauthors_op_that_landed_after_the_read() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    let read = live.text(&main).unwrap();
    assert_eq!(read, "Hello");
    let mut bob = rig.mock.peer("bob");
    bob.join(&main.0);
    bob.type_at(&main.0, 0, "Bob: ");
    eventually("the coauthor's op lands", || {
        live.text(&main).as_deref() == Some("Bob: Hello")
    })
    .await;
    let mut seen = String::new();
    let edited = live.local_edit_with(&main, |text| {
        seen = text.to_string();
        Some(insertion(utf16_len(text), utf16_len(text), "!"))
    });
    assert_eq!(edited, Ok(true));
    assert_eq!(seen, "Bob: Hello");
    let stale = live.local_edit_with(&main, |_| Some(insertion(utf16_len(&read), 0, "x")));
    assert_eq!(stale, Err(LiveError::Invalid(OtError::LengthMismatch)));
    assert!(live.settle(WAIT).await);
    assert_eq!(rig.mock.doc_text(&main.0), "Bob: Hello!");
    assert_eq!(tab.text(&live), "Bob: Hello!");
    assert_eq!(tab.editor.resets, 0);
    live.stop().await;
}

#[tokio::test]
async fn an_edit_that_changes_nothing_sends_nothing() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let _tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    assert_eq!(live.local_edit_with(&main, |_| None), Ok(false));
    let unchanged = live.local_edit_with(&main, |text| {
        let mut op = TextOperation::new();
        op.retain(utf16_len(text));
        Some(op)
    });
    assert_eq!(unchanged, Ok(false));
    assert!(live.settle(WAIT).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rig.updates_for(&main).is_empty());
    assert!(port.seen().pending_docs.is_empty());
    assert!(record_of(&live, &main).is_none());
    live.stop().await;
}

#[tokio::test]
async fn doc_pending_flips_on_an_edit_and_back_on_the_ack() {
    let rig = Rig::start(project()).await;
    rig.seed("alice", 0).await;
    let port = Port::new(&FILES);
    let live = rig.live("alice", &port).await;
    let main = rig.id(MAIN);
    let mut tab = Tab::open(&live, MAIN);
    eventually("the doc is joined", || {
        rig.joined("alice").contains(&main.0)
    })
    .await;
    rig.mock.stall();
    tab.type_end(&live, " soon");
    assert_eq!(port.seen().pending_docs, vec![(main.clone(), true)]);
    tab.type_end(&live, " now");
    assert_eq!(port.seen().pending_docs, vec![(main.clone(), true)]);
    rig.mock.resume();
    assert!(live.settle(WAIT).await);
    eventually("the dot clears", || port.seen().pending_docs.len() == 2).await;
    let flips = port.seen().pending_docs.clone();
    assert_eq!(flips, vec![(main.clone(), true), (main.clone(), false)]);
    assert_eq!(rig.mock.doc_text(&main.0), "Hello soon now");
    live.stop().await;
}

#[test]
fn an_unknown_doc_type_stops_only_that_doc() {
    let docs = vec![
        ("aaaaaaaaaaaaaaaaaaaaaaaa".to_string(), "a.tex".to_string()),
        ("bbbbbbbbbbbbbbbbbbbbbbbb".to_string(), "b.tex".to_string()),
    ];
    let mut state = watcher(&docs);
    let (a, b) = (DocId(docs[0].0.clone()), DocId(docs[1].0.clone()));
    let unknown = vec![
        Value::Null,
        json!(["x"]),
        json!(4),
        json!([]),
        json!({}),
        json!("sharejs-json"),
    ];
    state.joined(&a, JoinKind::Fresh, parse_join(&a, &unknown));
    let known = vec![
        Value::Null,
        json!(["Bee"]),
        json!(2),
        json!([]),
        json!({}),
        json!("sharejs-text-ot"),
    ];
    state.joined(&b, JoinKind::Fresh, parse_join(&b, &known));
    assert_eq!(state.text(&b).as_deref(), Some("Bee"));
    assert!(state.next_joins(Instant::now(), 8).is_empty());
    state.deliver();
    let unsupported = DocStopReason::Unsupported("sharejs-json".into());
    assert_eq!(state.port.seen().stopped, vec![(a.clone(), unsupported)]);
    assert!(state.doc(&a).is_none());
    assert_eq!(state.doc(&b).map(|doc| doc.version()), Some(2));
}

#[test]
fn tracked_change_timestamps_are_iso_utc() {
    assert_eq!(iso_time(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso_time(951_782_400_000), "2000-02-29T00:00:00.000Z");
    assert_eq!(iso_time(1_763_200_000_123), "2025-11-15T09:46:40.123Z");
    assert_eq!(iso_time(4_102_444_799_999), "2099-12-31T23:59:59.999Z");
}

fn replayed_op(state: &State, doc: &DocId, update: &Value) -> TextOperation {
    let known = state.doc(doc).unwrap();
    match known.format() {
        FormatState::ShareJs(_) => {
            operation_of(known.text(), &pieces_from_json(&update["op"]).unwrap()).unwrap()
        }
        FormatState::HistoryOt(raw) => {
            let scans = &update["op"][0]["textOperation"];
            raw.project(&RawOp::from_json(scans).unwrap()).unwrap()
        }
    }
}

fn tracked(update: &Value) -> bool {
    update["op"][0]["textOperation"]
        .as_array()
        .is_some_and(|scans| scans.iter().any(|scan| scan.get("tracking").is_some()))
        || update["meta"]["tc"].is_string()
}

fn replay_event(
    state: &mut Watcher,
    doc: &DocId,
    event: DocEvent,
    step: usize,
    label: &str,
) -> bool {
    match event {
        DocEvent::Remote { update, .. } => {
            state.on_applied(AppliedUpdate::from_value(&update, Some(doc)).unwrap());
            false
        }
        DocEvent::Acked { v } => {
            state.on_applied(AppliedUpdate::from_value(&json!({ "v": v }), Some(doc)).unwrap());
            false
        }
        DocEvent::Sent { v, update } => {
            let op = replayed_op(state, doc, &update);
            assert!(state.local_edit_with(doc, |_| Some(op)).unwrap(), "{label}");
            let now = Instant::now() + Duration::from_secs(10 * step as u64);
            let sent = state.next_sends(now);
            assert_eq!(sent.len(), 1, "{label}");
            assert_eq!(sent[0].v, v, "{label}");
            true
        }
        DocEvent::Error { args } => panic!("{label}: {args:?}"),
    }
}

fn replay_trace(recording: &Recording, trace: &Trace) -> Option<usize> {
    let expected = recording.final_text(&trace.name)?;
    let (reply, events) = trace.last_session(&recording.doc_id)?;
    let sends_tracked = events
        .iter()
        .any(|event| matches!(event, DocEvent::Sent { update, .. } if tracked(update)));
    if sends_tracked {
        return None;
    }
    let label = format!("{}: {}", recording.name, trace.name);
    let doc = DocId(recording.doc_id.clone());
    let mut state = watcher(&[(recording.doc_id.clone(), "main.tex".into())]);
    state.connected(PublicId(trace.public_ids().last().cloned()?), 0);
    state.joined(&doc, JoinKind::Fresh, parse_join(&doc, &reply));
    let mut sends = 0;
    for (step, event) in events.into_iter().enumerate() {
        sends += usize::from(replay_event(&mut state, &doc, event, step, &label));
    }
    assert_eq!(state.text(&doc).unwrap(), expected, "{label}");
    assert!(state.doc(&doc).unwrap().is_settled(), "{label}");
    Some(sends)
}

#[test]
fn recorded_sessions_replay_through_the_session_state() {
    let mut replayed = BTreeMap::<String, (usize, usize)>::new();
    for recording in recordings().iter().filter(|recording| recording.converged) {
        for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
            if let Some(sends) = replay_trace(recording, trace) {
                let entry = replayed.entry(recording.format.clone()).or_default();
                entry.0 += 1;
                entry.1 += sends;
            }
        }
    }
    let sharejs = replayed.get("sharejs-text-ot").copied().unwrap_or_default();
    let history_ot = replayed.get("history-ot").copied().unwrap_or_default();
    assert!(sharejs.0 >= 10 && sharejs.1 >= 20, "sharejs {sharejs:?}");
    assert!(history_ot.0 >= 1, "history-ot {history_ot:?}");
}
