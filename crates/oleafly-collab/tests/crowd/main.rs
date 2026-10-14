mod content;
mod cost;
mod measure;
mod relay;
mod soak;
mod typist;

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use loro::VersionVector;
use oleafly_collab::doc::{FileNode, NodeKind, NodeParent, ProjectDoc};
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::ot::TextOperation;
use oleafly_collab::sync::{spawn_live, EndReason, LiveEvent, LiveHandle, LiveLink, LiveStatus};
use oleafly_collab::{DeviceKey, MemorySecrets, ServerClient, ServerUrl, SessionManager};
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::projects;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{project_log, seed_person, test_config, PersonSeed, TestServer};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::measure::{Percentiles, ProcessSampler};
use crate::relay::Relay;
use crate::typist::{keystroke, phrase, EditorDoc, Reaction, Rng, NAMES};

static SERIAL: Mutex<()> = Mutex::new(());

const PRESENCE_EVERY: Duration = Duration::from_millis(150);
const ONLINE_WITHIN: Duration = Duration::from_secs(60);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn seed_from_env(fallback: u64) -> u64 {
    std::env::var("CROWD_SEED")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

#[derive(Clone)]
struct Offline {
    person: usize,
    after: usize,
    burst: usize,
    burst_pause_ms: (u64, u64),
    at_least: Duration,
}

#[derive(Clone)]
struct Scenario {
    name: &'static str,
    people: usize,
    operations: usize,
    pause_ms: (u64, u64),
    main_bytes: usize,
    small_files: usize,
    single_file: bool,
    tree_edits: bool,
    switch_percent: u64,
    offline: Option<Offline>,
    late_joiner: bool,
    observers: usize,
    settle_within: Duration,
    seed: u64,
}

impl Scenario {
    fn new(name: &'static str, people: usize, operations: usize, pause_ms: (u64, u64)) -> Scenario {
        Scenario {
            name,
            people,
            operations,
            pause_ms,
            main_bytes: 20_000,
            small_files: 0,
            single_file: false,
            tree_edits: true,
            switch_percent: 4,
            offline: None,
            late_joiner: false,
            observers: 12,
            settle_within: Duration::from_secs(90),
            seed: seed_from_env(0x0C0F_FEE5),
        }
    }

    fn expected_typing(&self) -> Duration {
        let pause = (self.pause_ms.0 + self.pause_ms.1) / 2;
        let mut total = Duration::from_millis(pause * self.operations as u64);
        if let Some(offline) = &self.offline {
            let burst = (offline.burst_pause_ms.0 + offline.burst_pause_ms.1) / 2;
            total += Duration::from_millis(burst * offline.burst as u64) + offline.at_least;
        }
        total
    }
}

#[derive(Clone, Copy)]
struct Edit {
    end: i32,
    at: Instant,
    offline: bool,
}

#[derive(Default)]
struct EditLog {
    peer: AtomicU64,
    entries: Mutex<Vec<Edit>>,
}

impl EditLog {
    fn record(&self, before: &VersionVector, after: &VersionVector, offline: bool) {
        let known = self.peer.load(Ordering::SeqCst);
        let changed = if known != 0 {
            after
                .get(&known)
                .copied()
                .filter(|end| before.get(&known).copied() != Some(*end))
        } else {
            let found = after
                .iter()
                .find(|(peer, end)| before.get(peer) != Some(*end))
                .map(|(peer, end)| (*peer, *end));
            found.map(|(peer, end)| {
                self.peer.store(peer, Ordering::SeqCst);
                end
            })
        };
        if let Some(end) = changed {
            lock(&self.entries).push(Edit {
                end,
                at: Instant::now(),
                offline,
            });
        }
    }
}

struct Person {
    index: usize,
    name: String,
    live: Arc<Mutex<LiveProject>>,
    link: LiveLink,
    events: UnboundedSender<LiveEvent>,
    handle: Mutex<Option<LiveHandle>>,
    relay: Option<Relay>,
    log: Arc<EditLog>,
    queued: Arc<AtomicU64>,
    handled: AtomicU64,
    synced: AtomicBool,
    done: AtomicBool,
    halt: AtomicBool,
    online: AtomicBool,
    expect_offline: AtomicBool,
    went_online_at: Mutex<Option<(Instant, u64)>>,
    reconnected_at: Mutex<Option<Instant>>,
    offline_seen_at: Mutex<Option<Instant>>,
    offline_events: AtomicU64,
    edits: AtomicU64,
    problems: Mutex<Vec<String>>,
    latency: Mutex<Vec<u64>>,
    offline_latency: Mutex<Vec<u64>>,
    ack_latency: Mutex<Vec<u64>>,
}

impl Person {
    fn problem(&self, text: String) {
        lock(&self.problems).push(format!("{}: {text}", self.name));
    }

    fn flush(&self) {
        if let Some(handle) = lock(&self.handle).as_ref() {
            handle.flush();
        }
    }

    fn presence(&self, file: &str, cursor: usize) {
        if let Some(handle) = lock(&self.handle).as_ref() {
            handle.presence(PresenceState {
                file_id: Some(file.to_owned()),
                cursor: u32::try_from(cursor).ok(),
                anchor: None,
            });
        }
    }

    fn go_live(&self) {
        let handle = spawn_live(
            self.link.clone(),
            Arc::clone(&self.live),
            self.events.clone(),
        );
        *lock(&self.handle) = Some(handle);
    }

    fn on_status(&self, status: LiveStatus) {
        match status {
            LiveStatus::Online => {
                self.online.store(true, Ordering::SeqCst);
                if self.expect_offline.swap(false, Ordering::SeqCst) {
                    *lock(&self.reconnected_at) = Some(Instant::now());
                }
            }
            LiveStatus::Offline { retry_in_ms } => {
                self.online.store(false, Ordering::SeqCst);
                self.offline_events.fetch_add(1, Ordering::SeqCst);
                if !self.expect_offline.load(Ordering::SeqCst) {
                    self.problem(format!(
                        "went offline without being cut off (retry in {retry_in_ms} ms)"
                    ));
                }
            }
            LiveStatus::Ended { reason } => {
                self.online.store(false, Ordering::SeqCst);
                if reason != EndReason::Stopped {
                    self.problem(format!("the live session ended: {reason:?}"));
                }
            }
            LiveStatus::Connecting => {}
        }
    }
}

type Logs = Arc<Mutex<Vec<(usize, Arc<EditLog>)>>>;

#[derive(Default)]
struct Monitor {
    samples: Vec<(Instant, u64, Option<u64>)>,
    snapshots: HashSet<String>,
}

struct Harness {
    server: TestServer,
    _data: tempfile::TempDir,
    url: ServerUrl,
    upstream: SocketAddr,
    server_id: ServerId,
    project: SharedProjectId,
    owner_client: Arc<ServerClient>,
    owner_sessions: Arc<SessionManager>,
    owner_key: Arc<DeviceKey>,
    main_file: String,
    logs: Logs,
    monitor: Arc<Mutex<Monitor>>,
    background: Vec<JoinHandle<()>>,
}

impl Drop for Harness {
    fn drop(&mut self) {
        for task in &self.background {
            task.abort();
        }
    }
}

fn email_for(name: &str) -> String {
    format!("{}@crowd.test", name.to_lowercase().replace(' ', "."))
}

async fn identity(
    state: &AppState,
    name: &str,
    role: ServerRole,
) -> (Arc<DeviceKey>, SessionTokens) {
    let key = Arc::new(DeviceKey::load_or_create(&MemorySecrets::new()).expect("device key"));
    let tokens = seed_person(
        state,
        PersonSeed {
            name: name.to_owned(),
            email: email_for(name),
            role,
            device_public_key: key.public_key_b64(),
            device_name: format!("{name}'s laptop"),
        },
    )
    .await
    .expect("seed a person");
    (key, tokens)
}

fn project_doc(scenario: &Scenario, rng: &mut Rng) -> (ProjectDoc, String) {
    let mut doc = ProjectDoc::create().expect("create a project doc");
    let main = doc
        .add_node(
            None,
            "main.tex",
            NodeKind::Text,
            None,
            &content::latex_main(scenario.main_bytes, rng),
        )
        .expect("add main.tex");
    if !scenario.single_file {
        for (name, text) in [
            ("refs.bib", content::bibliography(rng)),
            ("notes.typ", content::typst_notes(rng)),
            ("README.md", content::readme(rng)),
        ] {
            doc.add_node(None, name, NodeKind::Text, None, &text)
                .expect("add a file");
        }
    }
    if scenario.small_files > 0 {
        let folders: Vec<String> = (0..10)
            .map(|index| {
                doc.add_node(None, &format!("part-{index}"), NodeKind::Dir, None, "")
                    .expect("add a folder")
            })
            .collect();
        for index in 0..scenario.small_files {
            let folder = &folders[index % folders.len()];
            doc.add_node(
                Some(folder),
                &format!("section-{index:03}.tex"),
                NodeKind::Text,
                None,
                &content::small_section(index, rng),
            )
            .expect("add a small file");
        }
    }
    (doc, main)
}

fn track_real_time(server: &TestServer) -> JoinHandle<()> {
    let clock = server.clock();
    tokio::spawn(async move {
        let start = Instant::now();
        let mut applied = 0i64;
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let elapsed = i64::try_from(start.elapsed().as_millis()).unwrap_or(i64::MAX);
            clock.advance(elapsed - applied);
            applied = elapsed;
        }
    })
}

fn watch_server(
    state: AppState,
    project: SharedProjectId,
    into: Arc<Mutex<Monitor>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let read = state
                .db
                .call(move |conn| {
                    let head = projects::project_row(conn, project)?.map_or(0, |row| row.head_seq);
                    let oldest = projects::oldest_kept_update(conn, project)?;
                    let latest = projects::latest_snapshot(conn, project)?;
                    Ok((head, oldest, latest))
                })
                .await;
            if let Ok((head, oldest, latest)) = read {
                let mut monitor = lock(&into);
                monitor.samples.push((Instant::now(), head, oldest));
                if let Some(snapshot) = latest {
                    monitor.snapshots.insert(snapshot.file);
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
}

impl Harness {
    async fn start(scenario: &Scenario, rng: &mut Rng) -> (Harness, LiveProject) {
        let data = tempfile::tempdir().expect("server data folder");
        let mut config = test_config();
        config.data_dir = data.path().to_path_buf();
        config.limits.max_members_per_project = 1_000;
        let server = TestServer::start(config).await;
        let mut background = vec![track_real_time(&server)];
        let url = ServerUrl::parse(&server.url()).expect("server url");
        let upstream: SocketAddr = server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address");
        let server_id = server.state().server_id;
        let (key, tokens) = identity(server.state(), NAMES[0], ServerRole::Admin).await;
        let owner_sessions = Arc::new(SessionManager::new(
            Arc::new(MemorySecrets::new()),
            Arc::clone(&key),
        ));
        owner_sessions
            .store(server_id, &tokens)
            .expect("store the owner session");
        let owner_client = Arc::new(ServerClient::new(url.clone()).expect("owner client"));
        let (doc, main_file) = project_doc(scenario, rng);
        let access = &tokens.access_token;
        let project = owner_client
            .create_project(access, "Crowd paper")
            .await
            .expect("create the project")
            .project_id;
        owner_client
            .put_snapshot(access, project, 0, doc.snapshot().expect("snapshot"))
            .await
            .expect("upload the first snapshot");
        owner_client
            .commit_project(access, project)
            .await
            .expect("share the project");
        let monitor = Arc::new(Mutex::new(Monitor::default()));
        background.push(watch_server(
            server.state().clone(),
            project,
            Arc::clone(&monitor),
        ));
        let owner_live = LiveProject::new(doc, 0, ProjectRole::Owner);
        let harness = Harness {
            server,
            _data: data,
            url,
            upstream,
            server_id,
            project,
            owner_client,
            owner_sessions,
            owner_key: key,
            main_file,
            logs: Arc::new(Mutex::new(Vec::new())),
            monitor,
            background,
        };
        (harness, owner_live)
    }

    #[allow(clippy::too_many_arguments)]
    fn person(
        &self,
        index: usize,
        live: LiveProject,
        key: Arc<DeviceKey>,
        tokens: &SessionTokens,
        relay: Option<Relay>,
        sessions: Arc<SessionManager>,
        client: Arc<ServerClient>,
    ) -> (Arc<Person>, UnboundedReceiver<LiveEvent>) {
        let link = LiveLink {
            client,
            server_id: self.server_id,
            project: self.project,
            device_id: tokens.device_id,
            key,
            sessions,
        };
        new_person(index, live, link, relay, &self.logs)
    }

    async fn owner(&self, live: LiveProject) -> (Arc<Person>, UnboundedReceiver<LiveEvent>) {
        let tokens = self
            .owner_sessions
            .tokens(self.server_id)
            .expect("owner tokens")
            .expect("owner session");
        self.person(
            0,
            live,
            Arc::clone(&self.owner_key),
            &tokens,
            None,
            Arc::clone(&self.owner_sessions),
            Arc::clone(&self.owner_client),
        )
    }

    async fn admit(
        &self,
        index: usize,
        with_relay: bool,
    ) -> (Arc<Person>, UnboundedReceiver<LiveEvent>) {
        let name = NAMES[index];
        let (key, tokens) = identity(self.server.state(), name, ServerRole::Member).await;
        let relay = if with_relay {
            Some(Relay::start(self.upstream).await)
        } else {
            None
        };
        let url = relay
            .as_ref()
            .map_or_else(|| self.url.clone(), |relay| relay.url.clone());
        let client = Arc::new(ServerClient::new(url).expect("client"));
        let sessions = Arc::new(SessionManager::new(
            Arc::new(MemorySecrets::new()),
            Arc::clone(&key),
        ));
        sessions
            .store(self.server_id, &tokens)
            .expect("store the session");
        let owner_access = self
            .owner_sessions
            .access_token(self.server_id, &self.owner_client)
            .await
            .expect("owner access");
        self.owner_client
            .grant_member(
                &owner_access,
                self.project,
                tokens.account_id,
                ProjectRole::Editor,
            )
            .await
            .expect("grant editor");
        let access = sessions
            .access_token(self.server_id, &client)
            .await
            .expect("access token");
        let (seq, snapshot) = client
            .get_snapshot(&access, self.project)
            .await
            .expect("download the snapshot");
        let live = LiveProject::new(
            ProjectDoc::load(&snapshot).expect("load the snapshot"),
            seq,
            ProjectRole::Editor,
        );
        self.person(index, live, key, &tokens, relay, sessions, client)
    }
}

fn new_person(
    index: usize,
    live: LiveProject,
    link: LiveLink,
    relay: Option<Relay>,
    logs: &Logs,
) -> (Arc<Person>, UnboundedReceiver<LiveEvent>) {
    let (events, receiver) = mpsc::unbounded_channel();
    let log = Arc::new(EditLog::default());
    lock(logs).push((index, Arc::clone(&log)));
    let person = Arc::new(Person {
        index,
        name: NAMES[index].to_owned(),
        live: Arc::new(Mutex::new(live)),
        link,
        events,
        handle: Mutex::new(None),
        relay,
        log,
        queued: Arc::new(AtomicU64::new(0)),
        handled: AtomicU64::new(0),
        synced: AtomicBool::new(true),
        done: AtomicBool::new(false),
        halt: AtomicBool::new(false),
        online: AtomicBool::new(false),
        expect_offline: AtomicBool::new(false),
        went_online_at: Mutex::new(None),
        reconnected_at: Mutex::new(None),
        offline_seen_at: Mutex::new(None),
        offline_events: AtomicU64::new(0),
        edits: AtomicU64::new(0),
        problems: Mutex::new(Vec::new()),
        latency: Mutex::new(Vec::new()),
        offline_latency: Mutex::new(Vec::new()),
        ack_latency: Mutex::new(Vec::new()),
    });
    (person, receiver)
}

type Routed = (String, u64, DocMessage);

#[derive(Clone)]
struct Plan {
    operations: usize,
    pause_ms: (u64, u64),
    seed: u64,
    tree_edits: bool,
    switch_percent: u64,
    single_file: bool,
    main_file: String,
    offline: Option<Offline>,
    max_chars: Option<usize>,
}

#[derive(Default)]
struct Tally {
    creates: usize,
    renames: usize,
}

struct Editor {
    files: HashMap<String, EditorDoc>,
    current: String,
    generation: u64,
    sender: UnboundedSender<Routed>,
    last_presence: Option<Instant>,
}

fn submit(
    person: &Person,
    id: &str,
    rev: u64,
    operation: TextOperation,
    offline: bool,
) -> Result<(), String> {
    let mut live = lock(&person.live);
    let before = live.doc().version();
    live.editor_change(id, rev, operation)
        .map_err(|error| format!("the editor change for {id} failed: {error}"))?;
    let after = live.doc().version();
    drop(live);
    let away = offline || person.expect_offline.load(Ordering::SeqCst);
    person.log.record(&before, &after, away);
    person.flush();
    Ok(())
}

fn text_files(person: &Person) -> Result<Vec<FileNode>, String> {
    let nodes = lock(&person.live)
        .doc()
        .nodes()
        .map_err(|error| error.to_string())?;
    Ok(nodes
        .into_iter()
        .filter(|node| node.kind == NodeKind::Text && node.parent != NodeParent::Trash)
        .collect())
}

impl Editor {
    fn new(sender: UnboundedSender<Routed>, main_file: &str) -> Editor {
        Editor {
            files: HashMap::new(),
            current: main_file.to_owned(),
            generation: 0,
            sender,
            last_presence: None,
        }
    }

    fn synchronized(&self) -> bool {
        self.files.values().all(EditorDoc::synchronized)
    }

    fn open(&mut self, person: &Person, id: &str) -> Result<(), String> {
        self.generation += 1;
        let generation = self.generation;
        let sender = self.sender.clone();
        let queued = Arc::clone(&person.queued);
        let file = id.to_owned();
        let sink: DocSink = Arc::new(move |message| {
            queued.fetch_add(1, Ordering::SeqCst);
            let _ = sender.send((file.clone(), generation, message));
        });
        let (rev, text) = lock(&person.live)
            .open_file(id, sink)
            .map_err(|error| format!("opening {id} failed: {error}"))?;
        match self.files.get_mut(id) {
            Some(doc) => doc.reopened(generation, rev, text),
            None => {
                self.files
                    .insert(id.to_owned(), EditorDoc::opened(id, generation, rev, text));
            }
        }
        Ok(())
    }

    fn deliver(&mut self, person: &Person, routed: Routed, offline: bool) -> Result<(), String> {
        let (id, generation, message) = routed;
        let Some(doc) = self.files.get_mut(&id) else {
            return Ok(());
        };
        if doc.generation != generation {
            return Ok(());
        }
        match doc.receive(message) {
            Reaction::Nothing => Ok(()),
            Reaction::Send(rev, operation) => submit(person, &id, rev, operation, offline),
            Reaction::Resync => self.open(person, &id),
        }
    }

    fn presence(&mut self, person: &Person) {
        if self
            .last_presence
            .is_some_and(|last| last.elapsed() < PRESENCE_EVERY)
        {
            return;
        }
        if let Some(doc) = self.files.get(&self.current) {
            person.presence(&self.current, doc.cursor);
            self.last_presence = Some(Instant::now());
        }
    }

    fn switch_file(&mut self, person: &Person, rng: &mut Rng) -> Result<(), String> {
        let files = text_files(person)?;
        if files.is_empty() {
            return Ok(());
        }
        let id = rng.pick(&files).id.clone();
        if !self.files.contains_key(&id) {
            self.open(person, &id)?;
        }
        self.current = id;
        Ok(())
    }

    fn create_file(
        &mut self,
        person: &Person,
        rng: &mut Rng,
        tally: &mut Tally,
        offline: bool,
    ) -> Result<(), String> {
        let name = if rng.chance(30) {
            "shared-notes.tex".to_owned()
        } else {
            format!("notes-{}-{}.tex", person.index, tally.creates)
        };
        let text = content::small_section(person.index * 10 + tally.creates, rng);
        let id = {
            let mut live = lock(&person.live);
            let before = live.doc().version();
            let id = live
                .doc_mut()
                .add_node(None, &name, NodeKind::Text, None, &text)
                .map_err(|error| format!("creating {name} failed: {error}"))?;
            let after = live.doc().version();
            drop(live);
            person.log.record(&before, &after, offline);
            id
        };
        person.flush();
        tally.creates += 1;
        self.open(person, &id)?;
        self.current = id;
        Ok(())
    }

    fn rename_file(
        &mut self,
        person: &Person,
        rng: &mut Rng,
        tally: &mut Tally,
        main_file: &str,
        offline: bool,
    ) -> Result<(), String> {
        let files: Vec<FileNode> = text_files(person)?
            .into_iter()
            .filter(|node| node.id != main_file)
            .collect();
        if files.is_empty() {
            return Ok(());
        }
        let id = rng.pick(&files).id.clone();
        let name = if rng.chance(30) {
            "chapter.tex".to_owned()
        } else {
            format!("renamed-{}-{}.tex", person.index, tally.renames)
        };
        {
            let mut live = lock(&person.live);
            let before = live.doc().version();
            live.doc_mut()
                .rename(&id, &name)
                .map_err(|error| format!("renaming {id} failed: {error}"))?;
            let after = live.doc().version();
            drop(live);
            person.log.record(&before, &after, offline);
        }
        person.flush();
        tally.renames += 1;
        Ok(())
    }

    fn act(
        &mut self,
        person: &Person,
        rng: &mut Rng,
        plan: &Plan,
        tally: &mut Tally,
        offline: bool,
    ) -> Result<(), String> {
        person.edits.fetch_add(1, Ordering::SeqCst);
        if plan.tree_edits && tally.creates < 2 && rng.chance(1) {
            return self.create_file(person, rng, tally, offline);
        }
        if plan.tree_edits && tally.renames < 2 && rng.chance(1) {
            return self.rename_file(person, rng, tally, &plan.main_file, offline);
        }
        if !plan.single_file && rng.chance(plan.switch_percent) {
            self.switch_file(person, rng)?;
        }
        let current = self.current.clone();
        let doc = self
            .files
            .get_mut(&current)
            .ok_or_else(|| format!("{current} is not open"))?;
        let crowded = plan.max_chars.is_some_and(|limit| doc.length > limit);
        let sent = match rng.below(100) {
            _ if crowded => {
                doc.jump_random(rng);
                doc.delete_ahead(20 + rng.below(60))
            }
            0..=5 => {
                doc.jump_random(rng);
                doc.type_text(&phrase(rng))
            }
            6..=9 => {
                if rng.chance(50) {
                    doc.jump(0);
                } else {
                    let end = doc.length;
                    doc.jump(end);
                }
                doc.type_text(&phrase(rng))
            }
            10..=21 => doc.backspace(1 + rng.below(4)),
            22..=23 => {
                doc.jump_random(rng);
                doc.delete_ahead(1 + rng.below(12))
            }
            24..=50 => doc.type_text(&phrase(rng)),
            _ => doc.type_text(&keystroke(rng)),
        }
        .map_err(|error| format!("a local edit did not fit: {error}"))?;
        if let Some((rev, operation)) = sent {
            submit(person, &current, rev, operation, offline)?;
        }
        self.presence(person);
        Ok(())
    }
}

enum Phase {
    Online,
    Burst { left: usize, since: Instant },
    Waiting { since: Instant },
}

fn pause(rng: &mut Rng, range: (u64, u64)) -> Duration {
    Duration::from_millis(rng.between(range.0, range.1))
}

async fn type_along(person: Arc<Person>, plan: Plan, mut stop: watch::Receiver<bool>) -> Editor {
    let (sender, mut messages) = mpsc::unbounded_channel::<Routed>();
    let mut editor = Editor::new(sender, &plan.main_file);
    if let Err(problem) = editor.open(&person, &plan.main_file) {
        person.problem(problem);
    }
    let mut rng = Rng::new(plan.seed);
    let mut tally = Tally::default();
    let mut remaining = plan.operations;
    let mut typed = 0usize;
    let mut went_offline = false;
    let mut phase = Phase::Online;
    let mut next_at = Instant::now() + pause(&mut rng, plan.pause_ms);
    if remaining == 0 {
        person.done.store(true, Ordering::SeqCst);
    }
    loop {
        let active = remaining > 0 || !matches!(phase, Phase::Online);
        tokio::select! {
            biased;
            routed = messages.recv() => {
                let Some(routed) = routed else { break };
                let offline = !matches!(phase, Phase::Online);
                if let Err(problem) = editor.deliver(&person, routed, offline) {
                    person.problem(problem);
                }
                person.handled.fetch_add(1, Ordering::SeqCst);
            }
            _ = stop.changed() => break,
            () = tokio::time::sleep_until(tokio::time::Instant::from_std(next_at)), if active => {
                if person.halt.load(Ordering::SeqCst) {
                    remaining = 0;
                    if !matches!(phase, Phase::Online) {
                        let last_seq = lock(&person.live).last_seq();
                        *lock(&person.went_online_at) = Some((Instant::now(), last_seq));
                        if let Some(relay) = person.relay.as_ref() {
                            relay.go_online();
                        }
                        phase = Phase::Online;
                    }
                    next_at = Instant::now() + Duration::from_millis(50);
                    person.synced.store(editor.synchronized(), Ordering::SeqCst);
                    person.done.store(true, Ordering::SeqCst);
                    continue;
                }
                match phase {
                    Phase::Online => {
                        let offline = plan.offline.as_ref().filter(|offline| !went_offline && typed == offline.after);
                        if let (Some(offline), Some(relay)) = (offline, person.relay.as_ref()) {
                            went_offline = true;
                            person.expect_offline.store(true, Ordering::SeqCst);
                            relay.go_offline();
                            phase = Phase::Burst { left: offline.burst, since: Instant::now() };
                            next_at = Instant::now() + pause(&mut rng, offline.burst_pause_ms);
                        } else {
                            if let Err(problem) = editor.act(&person, &mut rng, &plan, &mut tally, false) {
                                person.problem(problem);
                            }
                            typed += 1;
                            remaining -= 1;
                            next_at = Instant::now() + pause(&mut rng, plan.pause_ms);
                        }
                    }
                    Phase::Burst { left, since } => {
                        if let Err(problem) = editor.act(&person, &mut rng, &plan, &mut tally, true) {
                            person.problem(problem);
                        }
                        let burst_pause = plan.offline.as_ref().map_or((50, 50), |offline| offline.burst_pause_ms);
                        phase = if left <= 1 { Phase::Waiting { since } } else { Phase::Burst { left: left - 1, since } };
                        next_at = Instant::now() + pause(&mut rng, burst_pause);
                    }
                    Phase::Waiting { since } => {
                        let at_least = plan.offline.as_ref().map_or(Duration::ZERO, |offline| offline.at_least);
                        if since.elapsed() >= at_least {
                            let last_seq = lock(&person.live).last_seq();
                            *lock(&person.went_online_at) = Some((Instant::now(), last_seq));
                            if let Some(relay) = person.relay.as_ref() {
                                relay.go_online();
                            }
                            phase = Phase::Online;
                            next_at = Instant::now() + pause(&mut rng, plan.pause_ms);
                        } else {
                            next_at = Instant::now() + Duration::from_millis(50);
                        }
                    }
                }
            }
        }
        person.synced.store(editor.synchronized(), Ordering::SeqCst);
        if remaining == 0 && matches!(phase, Phase::Online) {
            person.done.store(true, Ordering::SeqCst);
        }
    }
    editor
}

async fn watch_events(
    person: Arc<Person>,
    mut events: UnboundedReceiver<LiveEvent>,
    logs: Logs,
    observe: bool,
) {
    let mut cursors: HashMap<usize, usize> = lock(&logs)
        .iter()
        .map(|(index, log)| (*index, lock(&log.entries).len()))
        .collect();
    let mut own_acked = 0usize;
    while let Some(event) = events.recv().await {
        match event {
            LiveEvent::Status(status) => person.on_status(status),
            LiveEvent::Changed if observe => record_seen(&person, &logs, &mut cursors),
            LiveEvent::Acknowledged => record_acknowledged(&person, &mut own_acked),
            _ => {}
        }
    }
}

fn record_seen(person: &Person, logs: &Logs, cursors: &mut HashMap<usize, usize>) {
    let seen = lock(&person.live).doc().version();
    let now = Instant::now();
    let known: Vec<(usize, Arc<EditLog>)> = lock(logs).clone();
    let mut fresh = Vec::new();
    let mut fresh_offline = Vec::new();
    for (index, log) in known {
        if index == person.index {
            continue;
        }
        let peer = log.peer.load(Ordering::SeqCst);
        let Some(end) = (peer != 0).then(|| seen.get(&peer).copied()).flatten() else {
            continue;
        };
        let entries = lock(&log.entries);
        let cursor = cursors.entry(index).or_insert(0);
        while *cursor < entries.len() && entries[*cursor].end <= end {
            let edit = entries[*cursor];
            let micros = u64::try_from(now.duration_since(edit.at).as_micros()).unwrap_or(u64::MAX);
            if edit.offline {
                fresh_offline.push(micros);
            } else {
                fresh.push(micros);
            }
            *cursor += 1;
        }
    }
    if !fresh_offline.is_empty() {
        *lock(&person.offline_seen_at) = Some(now);
        lock(&person.offline_latency).extend(fresh_offline);
    }
    lock(&person.latency).extend(fresh);
}

fn record_acknowledged(person: &Person, own_acked: &mut usize) {
    let peer = person.log.peer.load(Ordering::SeqCst);
    if peer == 0 {
        return;
    }
    let (end, pending) = {
        let live = lock(&person.live);
        (
            live.doc().version().get(&peer).copied(),
            live.pending_changes(),
        )
    };
    let Some(end) = end else { return };
    let confirmed = i64::from(end) - i64::try_from(pending).unwrap_or(i64::MAX);
    let now = Instant::now();
    let entries = lock(&person.log.entries);
    let mut fresh = Vec::new();
    while *own_acked < entries.len() && i64::from(entries[*own_acked].end) <= confirmed {
        let edit = entries[*own_acked];
        if !edit.offline {
            fresh.push(u64::try_from(now.duration_since(edit.at).as_micros()).unwrap_or(u64::MAX));
        }
        *own_acked += 1;
    }
    drop(entries);
    lock(&person.ack_latency).extend(fresh);
}

struct Crowd {
    harness: Harness,
    people: Vec<Arc<Person>>,
    typists: Vec<JoinHandle<Editor>>,
    watchers: Vec<JoinHandle<()>>,
    stop: watch::Sender<bool>,
}

impl Crowd {
    fn plan(&self, scenario: &Scenario, index: usize, operations: usize) -> Plan {
        Plan {
            operations,
            pause_ms: scenario.pause_ms,
            seed: scenario.seed ^ (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15),
            tree_edits: scenario.tree_edits,
            switch_percent: scenario.switch_percent,
            single_file: scenario.single_file,
            main_file: self.harness.main_file.clone(),
            offline: scenario
                .offline
                .clone()
                .filter(|offline| offline.person == index),
            max_chars: None,
        }
    }

    fn listen(
        &mut self,
        scenario: &Scenario,
        person: &Arc<Person>,
        events: UnboundedReceiver<LiveEvent>,
    ) {
        let offline_person = scenario.offline.as_ref().map(|offline| offline.person);
        let observe = person.index < scenario.observers && Some(person.index) != offline_person;
        self.watchers.push(tokio::spawn(watch_events(
            Arc::clone(person),
            events,
            Arc::clone(&self.harness.logs),
            observe,
        )));
        person.go_live();
    }

    fn launch(&mut self, scenario: &Scenario, person: Arc<Person>, operations: usize) {
        let plan = self.plan(scenario, person.index, operations);
        self.typists.push(tokio::spawn(type_along(
            Arc::clone(&person),
            plan,
            self.stop.subscribe(),
        )));
        self.people.push(person);
    }
}

async fn until_online(people: &[Arc<Person>]) -> Result<(), String> {
    let start = Instant::now();
    loop {
        let waiting: Vec<&str> = people
            .iter()
            .filter(|person| !person.online.load(Ordering::SeqCst))
            .map(|person| person.name.as_str())
            .collect();
        if waiting.is_empty() {
            return Ok(());
        }
        if start.elapsed() > ONLINE_WITHIN {
            return Err(format!("still not online: {}", waiting.join(", ")));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn head_seq(harness: &Harness) -> u64 {
    let project = harness.project;
    harness
        .server
        .state()
        .db
        .call(move |conn| Ok(projects::project_row(conn, project)?.map_or(0, |row| row.head_seq)))
        .await
        .unwrap_or(0)
}

async fn settle(
    harness: &Harness,
    people: &[Arc<Person>],
    within: Duration,
) -> Result<Instant, String> {
    settle_on(|| head_seq(harness), people, within).await
}

async fn settle_on<F, Fut>(
    head_seq: F,
    people: &[Arc<Person>],
    within: Duration,
) -> Result<Instant, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = u64>,
{
    let start = Instant::now();
    let mut quiet_once = false;
    loop {
        let head = head_seq().await;
        let mut reasons = Vec::new();
        let mut reference: Option<VersionVector> = None;
        for person in people {
            unsettled_reasons(person, head, &mut reference, &mut reasons);
        }
        if reasons.is_empty() {
            if quiet_once {
                return Ok(Instant::now());
            }
            quiet_once = true;
        } else {
            quiet_once = false;
        }
        if start.elapsed() > within {
            reasons.truncate(20);
            return Err(format!(
                "no quiescence after {within:?}: {}",
                reasons.join("; ")
            ));
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn unsettled_reasons(
    person: &Person,
    head: u64,
    reference: &mut Option<VersionVector>,
    reasons: &mut Vec<String>,
) {
    if !person.done.load(Ordering::SeqCst) {
        reasons.push(format!("{} is still typing", person.name));
    }
    if !person.online.load(Ordering::SeqCst) {
        reasons.push(format!("{} is not online", person.name));
    }
    let queued = person.queued.load(Ordering::SeqCst);
    let handled = person.handled.load(Ordering::SeqCst);
    if queued != handled {
        reasons.push(format!(
            "{}'s editor has {} unread messages",
            person.name,
            queued - handled
        ));
    }
    if !person.synced.load(Ordering::SeqCst) {
        reasons.push(format!(
            "{}'s editor waits for an acknowledgement",
            person.name
        ));
    }
    let live = lock(&person.live);
    if live.has_unsent() {
        reasons.push(format!(
            "{} has {} unconfirmed changes",
            person.name,
            live.pending_changes()
        ));
    }
    if live.last_seq() != head {
        reasons.push(format!(
            "{} is at seq {} of {head}",
            person.name,
            live.last_seq()
        ));
    }
    let version = live.doc().version();
    drop(live);
    match reference {
        None => *reference = Some(version),
        Some(first) if *first != version => {
            reasons.push(format!("{} has a different version", person.name));
        }
        Some(_) => {}
    }
}

fn sorted_nodes(person: &Person) -> Vec<FileNode> {
    let mut nodes = lock(&person.live).doc().nodes().unwrap_or_default();
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    nodes
}

fn verify(people: &[Arc<Person>], editors: &[(usize, Editor)]) -> Vec<String> {
    let mut problems = Vec::new();
    let reference = sorted_nodes(&people[0]);
    let texts: Vec<String> = reference
        .iter()
        .filter(|node| node.kind == NodeKind::Text)
        .map(|node| node.id.clone())
        .collect();
    let expected: HashMap<String, String> = {
        let live = lock(&people[0].live);
        texts
            .iter()
            .map(|id| (id.clone(), live.doc().text(id).unwrap_or_default()))
            .collect()
    };
    for person in people {
        if sorted_nodes(person) != reference {
            problems.push(format!("{} has a different file tree", person.name));
        }
        let live = lock(&person.live);
        for id in &texts {
            match live.doc().text(id) {
                Ok(text) if text == expected[id] => {}
                Ok(text) => problems.push(format!(
                    "{} has different text in {id}: {} bytes instead of {}",
                    person.name,
                    text.len(),
                    expected[id].len()
                )),
                Err(error) => problems.push(format!("{} cannot read {id}: {error}", person.name)),
            }
        }
        if live.pending_changes() > 0 || live.has_unsent() {
            problems.push(format!(
                "{} is stuck with {} pending changes",
                person.name,
                live.pending_changes()
            ));
        }
        drop(live);
        problems.extend(lock(&person.problems).iter().cloned());
    }
    for (index, editor) in editors {
        let person = &people[*index];
        let live = lock(&person.live);
        for (id, doc) in &editor.files {
            match live.doc().text(id) {
                Ok(text) if text == doc.content => {}
                Ok(text) => problems.push(format!(
                    "{}'s editor shows {} bytes for {id} but the document has {}",
                    person.name,
                    doc.content.len(),
                    text.len()
                )),
                Err(error) => problems.push(format!("{} cannot read {id}: {error}", person.name)),
            }
            if expected.get(id).is_some_and(|text| *text != doc.content) {
                problems.push(format!(
                    "{}'s editor differs from {} in {id}",
                    person.name, people[0].name
                ));
            }
        }
    }
    problems
}

struct Report {
    name: &'static str,
    people: usize,
    operations: usize,
    pause_ms: (u64, u64),
    seed: u64,
    edits: u64,
    window: Duration,
    convergence: Option<Duration>,
    latency: Percentiles,
    ack: Percentiles,
    offline: Percentiles,
    head: u64,
    delivered: u64,
    per_client: (f64, f64),
    peak_kb: Option<u64>,
    cpu_ms: Option<u64>,
    wall: Duration,
    files: usize,
    text_bytes: usize,
    snapshot_bytes: usize,
    kept_updates: u64,
    kept_bytes: u64,
    oldest_kept: Option<u64>,
    snapshots_seen: usize,
    offline_events: u64,
    resets: u64,
    resyncs: u64,
    lost_edits: u64,
    reconnect: Option<Duration>,
    burst_delivered: Option<Duration>,
    needed_snapshot: Option<bool>,
    problems: Vec<String>,
}

impl Report {
    fn print(&self) {
        let seconds = self.window.as_secs_f64().max(0.001);
        println!();
        println!(
            "crowd {}: {} people, {} operations each, {}-{} ms between keystrokes, seed {}",
            self.name, self.people, self.operations, self.pause_ms.0, self.pause_ms.1, self.seed
        );
        println!(
            "  typed {} edits in {:.1} s ({:.0} edits/s)",
            self.edits,
            seconds,
            self.edits as f64 / seconds
        );
        println!(
            "  server: {} updates stored ({:.0}/s), {} kept after compaction ({:.1} KB, oldest kept seq {:?}), {} distinct snapshots seen",
            self.head,
            self.head as f64 / seconds,
            self.kept_updates,
            self.kept_bytes as f64 / 1024.0,
            self.oldest_kept,
            self.snapshots_seen
        );
        println!(
            "  clients: {} updates imported ({:.0}/s in total, {:.0}/s per client on average, {:.0}/s for the busiest)",
            self.delivered,
            self.delivered as f64 / seconds,
            self.per_client.0,
            self.per_client.1
        );
        match self.convergence {
            Some(time) => println!(
                "  convergence after the last edit: {:.0} ms",
                time.as_secs_f64() * 1000.0
            ),
            None => println!("  convergence after the last edit: never"),
        }
        println!("  edit seen by another person: {}", self.latency.line());
        println!("  edit acknowledged by the server: {}", self.ack.line());
        if self.offline.count > 0 {
            println!("  offline edits seen by others: {}", self.offline.line());
        }
        if let Some(reconnect) = self.reconnect {
            println!(
                "  reconnect after the network came back: {:.0} ms",
                reconnect.as_secs_f64() * 1000.0
            );
        }
        if let Some(delivered) = self.burst_delivered {
            println!(
                "  offline burst seen by every observer {:.0} ms after the reconnect",
                delivered.as_secs_f64() * 1000.0
            );
        }
        if let Some(needed) = self.needed_snapshot {
            println!("  the returning person had to catch up from a snapshot: {needed}");
        }
        let cores = self
            .cpu_ms
            .map(|cpu| cpu as f64 / 1000.0 / self.wall.as_secs_f64().max(0.001));
        println!(
            "  process: peak RSS {}, CPU {} over {:.1} s wall",
            self.peak_kb.map_or("n/a".to_owned(), |kb| format!(
                "{:.0} MB",
                kb as f64 / 1024.0
            )),
            match (self.cpu_ms, cores) {
                (Some(cpu), Some(cores)) =>
                    format!("{:.1} s ({cores:.1} cores)", cpu as f64 / 1000.0),
                _ => "n/a".to_owned(),
            },
            self.wall.as_secs_f64()
        );
        println!(
            "  final document: {} files, {:.1} KB of text, snapshot {:.1} KB",
            self.files,
            self.text_bytes as f64 / 1024.0,
            self.snapshot_bytes as f64 / 1024.0
        );
        println!(
            "  health: {} offline statuses, {} editor resets, {} editor resyncs, {} lost editor edits, {} problems",
            self.offline_events,
            self.resets,
            self.resyncs,
            self.lost_edits,
            self.problems.len()
        );
        for problem in self.problems.iter().take(25) {
            println!("    problem: {problem}");
        }
        println!(
            "  | {} | {} | {} | {} | {} | {:.1} | {:.1} | {:.1} | {:.1} | {:.1} | {:.0} | {:.0} | {} | {:.1} | {:.1} |",
            self.name,
            self.people,
            self.edits,
            self.convergence.map_or("never".to_owned(), |time| format!("{:.0}", time.as_secs_f64() * 1000.0)),
            self.latency.count,
            self.latency.p50,
            self.latency.p95,
            self.latency.p99,
            self.ack.p50,
            self.ack.p99,
            self.head as f64 / seconds,
            self.per_client.0,
            self.peak_kb.map_or("n/a".to_owned(), |kb| format!("{:.0}", kb as f64 / 1024.0)),
            self.text_bytes as f64 / 1024.0,
            self.snapshot_bytes as f64 / 1024.0
        );
    }
}

fn gather(people: &[Arc<Person>], pick: fn(&Person) -> &Mutex<Vec<u64>>) -> Percentiles {
    let mut samples: Vec<u64> = Vec::new();
    for person in people {
        samples.extend(lock(pick(person)).iter().copied());
    }
    Percentiles::of(&mut samples)
}

async fn run(scenario: Scenario) -> Report {
    let wall = Instant::now();
    let sampler = ProcessSampler::start();
    let cpu_start = sampler.cpu_ms();
    let mut rng = Rng::new(scenario.seed);
    let (harness, owner_live) = Harness::start(&scenario, &mut rng).await;
    let (stop, _) = watch::channel(false);
    let mut crowd = Crowd {
        harness,
        people: Vec::new(),
        typists: Vec::new(),
        watchers: Vec::new(),
        stop,
    };
    let mut joining = Vec::new();
    joining.push(crowd.harness.owner(owner_live).await);
    let offline_person = scenario.offline.as_ref().map(|offline| offline.person);
    for index in 1..scenario.people {
        joining.push(
            crowd
                .harness
                .admit(index, Some(index) == offline_person)
                .await,
        );
    }
    let mut ready = Vec::new();
    for (person, events) in joining {
        crowd.listen(&scenario, &person, events);
        ready.push(person);
    }
    let mut problems = Vec::new();
    if let Err(problem) = until_online(&ready).await {
        problems.push(problem);
    }
    for person in ready {
        crowd.launch(&scenario, person, scenario.operations);
    }
    if scenario.late_joiner {
        let planned = (scenario.people * scenario.operations) as u64;
        let deadline = Instant::now() + scenario.expected_typing() * 3;
        loop {
            let typed: u64 = crowd
                .people
                .iter()
                .map(|person| person.edits.load(Ordering::SeqCst))
                .sum();
            if typed * 10 >= planned * 6 || Instant::now() > deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let index = scenario.people;
        let (person, events) = crowd.harness.admit(index, false).await;
        crowd.listen(&scenario, &person, events);
        if let Err(problem) = until_online(std::slice::from_ref(&person)).await {
            problems.push(problem);
        }
        crowd.launch(&scenario, person, scenario.operations / 3);
    }
    let typing_deadline = Instant::now() + scenario.expected_typing() * 3 + Duration::from_secs(30);
    let mut halted = false;
    while crowd
        .people
        .iter()
        .any(|person| !person.done.load(Ordering::SeqCst))
    {
        if !halted && Instant::now() > typing_deadline {
            halted = true;
            let typed: u64 = crowd
                .people
                .iter()
                .map(|person| person.edits.load(Ordering::SeqCst))
                .sum();
            problems.push(format!(
                "typing was halted at the deadline after {typed} edits because the crowd fell behind"
            ));
            for person in &crowd.people {
                person.halt.store(true, Ordering::SeqCst);
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let settled = settle(&crowd.harness, &crowd.people, scenario.settle_within).await;
    let _ = crowd.stop.send(true);
    let mut editors = Vec::new();
    for (position, typist) in crowd.typists.drain(..).enumerate() {
        match typist.await {
            Ok(editor) => editors.push((position, editor)),
            Err(error) => problems.push(format!("a typist task failed: {error}")),
        }
    }
    let first_edit = lock(&crowd.harness.logs)
        .iter()
        .filter_map(|(_, log)| lock(&log.entries).first().map(|edit| edit.at))
        .min();
    let last_edit = lock(&crowd.harness.logs)
        .iter()
        .filter_map(|(_, log)| lock(&log.entries).last().map(|edit| edit.at))
        .max();
    let convergence = match (&settled, last_edit) {
        (Ok(at), Some(last)) => Some(at.saturating_duration_since(last)),
        _ => None,
    };
    if let Err(problem) = &settled {
        problems.push(problem.clone());
    }
    problems.extend(verify(&crowd.people, &editors));
    let window = match (first_edit, last_edit) {
        (Some(first), Some(last)) => last.saturating_duration_since(first),
        _ => Duration::ZERO,
    };
    let seconds = window.as_secs_f64().max(0.001);
    let log = project_log(crowd.harness.server.state(), crowd.harness.project)
        .await
        .unwrap_or_default();
    let received: Vec<u64> = crowd
        .people
        .iter()
        .map(|person| lock(&person.live).received())
        .collect();
    let delivered: u64 = received.iter().sum();
    let per_client = (
        delivered as f64 / received.len().max(1) as f64 / seconds,
        received.iter().copied().max().unwrap_or(0) as f64 / seconds,
    );
    let (files, text_bytes, snapshot_bytes) = {
        let live = lock(&crowd.people[0].live);
        let nodes = live.doc().nodes().unwrap_or_default();
        let texts: Vec<&FileNode> = nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Text)
            .collect();
        let bytes: usize = texts
            .iter()
            .map(|node| live.doc().text(&node.id).map_or(0, |text| text.len()))
            .sum();
        (
            texts.len(),
            bytes,
            live.doc().snapshot().map_or(0, |snapshot| snapshot.len()),
        )
    };
    let offline_story = scenario.offline.as_ref().and_then(|offline| {
        crowd
            .people
            .iter()
            .find(|person| person.index == offline.person)
    });
    let went_online = offline_story.and_then(|person| *lock(&person.went_online_at));
    let reconnected = offline_story.and_then(|person| *lock(&person.reconnected_at));
    let reconnect = match (went_online, reconnected) {
        (Some((online, _)), Some(back)) => Some(back.saturating_duration_since(online)),
        _ => None,
    };
    let burst_seen = crowd
        .people
        .iter()
        .filter_map(|person| *lock(&person.offline_seen_at))
        .max();
    let burst_delivered = match (reconnected, burst_seen) {
        (Some(back), Some(seen)) => Some(seen.saturating_duration_since(back)),
        _ => None,
    };
    let (needed_snapshot, snapshots_seen) = {
        let monitor = lock(&crowd.harness.monitor);
        let needed = went_online.map(|(online, last_seq)| {
            monitor
                .samples
                .iter()
                .rev()
                .find(|(at, _, _)| *at <= online + Duration::from_millis(100))
                .and_then(|(_, _, oldest)| *oldest)
                .is_some_and(|oldest| oldest > last_seq + 1)
        });
        (needed, monitor.snapshots.len())
    };
    let report = Report {
        name: scenario.name,
        people: crowd.people.len(),
        operations: scenario.operations,
        pause_ms: scenario.pause_ms,
        seed: scenario.seed,
        edits: crowd
            .people
            .iter()
            .map(|person| person.edits.load(Ordering::SeqCst))
            .sum(),
        window,
        convergence,
        latency: gather(&crowd.people, |person| &person.latency),
        ack: gather(&crowd.people, |person| &person.ack_latency),
        offline: gather(&crowd.people, |person| &person.offline_latency),
        head: log.head_seq,
        delivered,
        per_client,
        peak_kb: None,
        cpu_ms: None,
        wall: wall.elapsed(),
        files,
        text_bytes,
        snapshot_bytes,
        kept_updates: log.kept_updates,
        kept_bytes: log.kept_bytes,
        oldest_kept: log.oldest_kept,
        snapshots_seen,
        offline_events: crowd
            .people
            .iter()
            .map(|person| person.offline_events.load(Ordering::SeqCst))
            .sum(),
        resets: editors
            .iter()
            .map(|(_, editor)| editor.files.values().map(|doc| doc.resets).sum::<u64>())
            .sum(),
        resyncs: editors
            .iter()
            .map(|(_, editor)| editor.files.values().map(|doc| doc.resyncs).sum::<u64>())
            .sum(),
        lost_edits: editors
            .iter()
            .map(|(_, editor)| editor.files.values().map(|doc| doc.lost_edits).sum::<u64>())
            .sum(),
        reconnect,
        burst_delivered,
        needed_snapshot,
        problems,
    };
    let stopping: Vec<JoinHandle<()>> = crowd
        .people
        .iter()
        .filter_map(|person| lock(&person.handle).take())
        .map(|handle| tokio::spawn(handle.stopped()))
        .collect();
    let stop_deadline = Instant::now() + Duration::from_secs(15);
    for task in stopping {
        let left = stop_deadline.saturating_duration_since(Instant::now());
        let _ = tokio::time::timeout(left, task).await;
    }
    for watcher in &crowd.watchers {
        watcher.abort();
    }
    let (peak_kb, cpu_end) = sampler.finish();
    Report {
        peak_kb,
        cpu_ms: cpu_end.map(|end| end.saturating_sub(cpu_start)),
        wall: wall.elapsed(),
        ..report
    }
}

fn execute(scenario: Scenario) {
    let _serial = lock(&SERIAL);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let report = runtime.block_on(run(scenario));
    runtime.shutdown_timeout(Duration::from_secs(5));
    report.print();
    assert!(
        report.problems.is_empty(),
        "the crowd did not end in the same place: {:#?}",
        report.problems
    );
    assert!(report.convergence.is_some(), "the crowd never converged");
}

#[test]
fn ten_people_typing_at_once_end_with_identical_documents() {
    execute(Scenario::new("ten_people", 10, 40, (80, 160)));
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_ten_people_two_thousand_operations_each() {
    let mut scenario = Scenario::new("10x2000", 10, 2_000, (25, 55));
    scenario.settle_within = Duration::from_secs(180);
    execute(scenario);
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_twenty_five_people() {
    execute(Scenario::new("25_people", 25, 400, (100, 200)));
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_fifty_people() {
    let mut scenario = Scenario::new("50_people", 50, 300, (120, 240));
    scenario.settle_within = Duration::from_secs(180);
    execute(scenario);
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_one_megabyte_file_edited_by_ten_people() {
    let mut scenario = Scenario::new("1mb_file", 10, 400, (60, 120));
    scenario.main_bytes = 1_000_000;
    scenario.single_file = true;
    scenario.tree_edits = false;
    scenario.settle_within = Duration::from_secs(180);
    execute(scenario);
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_five_hundred_small_files() {
    let mut scenario = Scenario::new("500_files", 10, 600, (50, 100));
    scenario.small_files = 500;
    scenario.switch_percent = 30;
    execute(scenario);
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_offline_burst_then_reconnect() {
    let mut scenario = Scenario::new("offline_burst", 10, 600, (60, 120));
    scenario.offline = Some(Offline {
        person: 3,
        after: 100,
        burst: 500,
        burst_pause_ms: (10, 30),
        at_least: Duration::from_secs(5),
    });
    execute(scenario);
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_long_session_with_snapshot_compaction() {
    let mut scenario = Scenario::new("long_session", 10, 1_500, (30, 60));
    scenario.offline = Some(Offline {
        person: 2,
        after: 300,
        burst: 60,
        burst_pause_ms: (100, 200),
        at_least: Duration::from_secs(20),
    });
    scenario.late_joiner = true;
    scenario.settle_within = Duration::from_secs(180);
    execute(scenario);
}

#[test]
#[ignore = "soak test, build oleafly-server in release first, then run with --release -- --ignored --nocapture"]
fn soak_twenty_people_over_fifty_files() {
    let _serial = lock(&SERIAL);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let report = runtime.block_on(soak::run(soak::SoakPlan::from_env()));
    runtime.shutdown_timeout(Duration::from_secs(5));
    report.print();
    assert!(
        report.problems.is_empty(),
        "the soak did not end cleanly: {:#?}",
        report.problems
    );
    assert!(report.converged(), "the soak never converged");
}

#[test]
#[ignore = "stress test, run with --release -- --ignored --nocapture"]
fn stress_import_cost_per_update() {
    let _serial = lock(&SERIAL);
    let seed = seed_from_env(0x0C0F_FEE5);
    println!();
    println!(
        "crowd import_cost: one observer imports each update on one thread, no server, seed {seed}"
    );
    for (writers, lag, bytes, updates) in [
        (10, 1, 20_000, 1_000),
        (10, 10, 20_000, 1_000),
        (25, 4, 20_000, 600),
        (50, 2, 20_000, 600),
        (10, 1, 1_000_000, 300),
    ] {
        cost::measure(writers, lag, bytes, updates, seed).print();
    }
}
