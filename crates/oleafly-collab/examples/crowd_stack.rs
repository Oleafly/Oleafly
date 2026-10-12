#[path = "../tests/crowd/typist.rs"]
mod typist;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use loro::VersionVector;
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::ot::TextOperation;
use oleafly_collab::sync::{spawn_live, LiveEvent, LiveLink, LiveStatus};
use oleafly_collab::{
    CollabError, DeviceKey, MemorySecrets, SecretPort, ServerClient, ServerUrl, SessionManager,
};
use oleafly_collab_protocol::admin::NewDomainRule;
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::SystemClock;
use oleafly_server::config::ServerConfig;
use oleafly_server::projects;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{
    find_shared_project, github_provider, grant_project_role, init_dev_logging, seed_person,
    serve_until, MockGithub, MockGithubUser, PersonSeed,
};
use tokio::sync::{mpsc, watch};

use crate::typist::{keystroke, phrase, EditorDoc, Reaction, Rng, NAMES, WORDS};

const SERVER: &str = "127.0.0.1:8787";
const GITHUB: &str = "127.0.0.1:8790";
const SETUP_CODE: &str = "DEV-SETUP-CODE-0001";
const STATUS_EVERY: Duration = Duration::from_secs(5);
const PRESENCE_EVERY: Duration = Duration::from_millis(150);
const CONNECT_SPACING: Duration = Duration::from_millis(300);
const DESKTOP_PEOPLE: [&str; 3] = ["Bob Smith", "Alice Chen", "Carol Diaz"];
const USAGE: &str = "usage: crowd_stack [DATA_DIR] [--server ADDR] [--github ADDR] [--crowd N] [--project-title TITLE] [--rate MS] [--file PATH]";

struct Options {
    data_dir: String,
    server: String,
    github: String,
    crowd: usize,
    project_title: Option<String>,
    rate_ms: u64,
    file: String,
}

fn parse_options(args: impl Iterator<Item = String>) -> Result<Options, String> {
    let mut options = Options {
        data_dir: "target/dev-stack".to_owned(),
        server: SERVER.to_owned(),
        github: GITHUB.to_owned(),
        crowd: 0,
        project_title: None,
        rate_ms: 250,
        file: "main.tex".to_owned(),
    };
    let mut data_dir: Option<String> = None;
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => {
                (flag.to_owned(), Some(value.to_owned()))
            }
            _ => (arg.clone(), None),
        };
        if !flag.starts_with("--") {
            if data_dir.replace(arg).is_some() {
                return Err("only one data folder can be given".to_owned());
            }
            continue;
        }
        if flag == "--help" {
            return Err(USAGE.to_owned());
        }
        let value = match inline {
            Some(value) => value,
            None => args.next().ok_or_else(|| format!("{flag} needs a value"))?,
        };
        match flag.as_str() {
            "--server" => options.server = value,
            "--github" => options.github = value,
            "--crowd" => {
                options.crowd = value
                    .parse()
                    .map_err(|_| format!("--crowd expects a number, not {value}"))?;
            }
            "--project-title" => options.project_title = Some(value),
            "--rate" => {
                options.rate_ms = value
                    .parse::<u64>()
                    .map_err(|_| format!("--rate expects milliseconds, not {value}"))?
                    .max(10);
            }
            "--file" => options.file = value.trim_start_matches("./").to_owned(),
            other => return Err(format!("unknown option {other}\n{USAGE}")),
        }
    }
    if let Some(data_dir) = data_dir {
        options.data_dir = data_dir;
    }
    let available = NAMES
        .iter()
        .filter(|name| !DESKTOP_PEOPLE.contains(name))
        .count();
    if options.crowd > available {
        return Err(format!("--crowd can be at most {available}"));
    }
    Ok(options)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn person(id: u64, login: &str, name: &str) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_owned(),
        name: name.to_owned(),
        emails: vec![(format!("{login}@lab.test"), true)],
    }
}

fn no_secret_files(path: &Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        path.display().to_string(),
    ))
}

struct KeyFile {
    path: PathBuf,
}

impl SecretPort for KeyFile {
    fn get(&self, _account: &str) -> Result<Option<String>, CollabError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(Some(text.trim().to_owned())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(CollabError::Secret(error.to_string())),
        }
    }

    fn set(&self, _account: &str, value: &str) -> Result<(), CollabError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CollabError::Secret(error.to_string()))?;
        }
        std::fs::write(&self.path, value).map_err(|error| CollabError::Secret(error.to_string()))
    }

    fn remove(&self, _account: &str) -> Result<(), CollabError> {
        match std::fs::remove_file(&self.path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(CollabError::Secret(error.to_string()))
            }
            _ => Ok(()),
        }
    }
}

fn slug(name: &str) -> String {
    name.to_lowercase().replace(' ', ".")
}

#[derive(Clone, Debug, Default)]
struct Status {
    state: String,
    sent: u64,
    acked: u64,
    lag: Duration,
    last_seq: u64,
}

struct Member {
    name: String,
    key: Arc<DeviceKey>,
    tokens: SessionTokens,
    status: Arc<Mutex<Status>>,
}

struct Typing {
    word: Vec<String>,
    deleting: usize,
}

impl Typing {
    fn next_word(&mut self, rng: &mut Rng) {
        let text = phrase(rng);
        self.word = text.chars().rev().map(String::from).collect();
        if rng.chance(15) {
            self.word.insert(0, keystroke(rng));
        }
    }
}

struct Own {
    peer: u64,
    edits: Vec<(i32, Instant)>,
    acked: usize,
}

impl Own {
    fn record(&mut self, before: &VersionVector, after: &VersionVector) {
        if self.peer == 0 {
            if let Some((peer, _)) = after
                .iter()
                .find(|(peer, end)| before.get(peer) != Some(*end))
            {
                self.peer = *peer;
            }
        }
        if let Some(end) = after.get(&self.peer).copied() {
            if before.get(&self.peer).copied() != Some(end) {
                self.edits.push((end, Instant::now()));
            }
        }
    }

    fn confirm(&mut self, live: &LiveProject) {
        let Some(end) = live.doc().version().get(&self.peer).copied() else {
            return;
        };
        let confirmed = i64::from(end) - i64::try_from(live.pending_changes()).unwrap_or(i64::MAX);
        while self.acked < self.edits.len() && i64::from(self.edits[self.acked].0) <= confirmed {
            self.acked += 1;
        }
    }

    fn lag(&self) -> Duration {
        self.edits
            .get(self.acked)
            .map_or(Duration::ZERO, |(_, at)| at.elapsed())
    }
}

fn target_file(doc: &ProjectDoc, wanted: &str) -> Option<(String, String)> {
    let layout = materialize::layout(&doc.nodes().ok()?);
    let texts: Vec<(&String, &materialize::Placed)> = layout
        .iter()
        .filter(|(_, placed)| placed.kind == NodeKind::Text)
        .collect();
    texts
        .iter()
        .find(|(_, placed)| placed.path == wanted)
        .or_else(|| texts.iter().min_by(|a, b| a.1.path.cmp(&b.1.path)))
        .map(|(id, placed)| ((*id).clone(), placed.path.clone()))
}

fn submit(
    live: &Mutex<LiveProject>,
    own: &mut Own,
    id: &str,
    rev: u64,
    operation: TextOperation,
) -> Result<(), CollabError> {
    let mut live = lock(live);
    let before = live.doc().version();
    live.editor_change(id, rev, operation)?;
    let after = live.doc().version();
    drop(live);
    own.record(&before, &after);
    Ok(())
}

fn open(
    live: &Mutex<LiveProject>,
    id: &str,
    generation: u64,
    sender: &mpsc::UnboundedSender<(u64, DocMessage)>,
) -> Result<(u64, String), CollabError> {
    let sender = sender.clone();
    let sink: DocSink = Arc::new(move |message| {
        let _ = sender.send((generation, message));
    });
    lock(live).open_file(id, sink)
}

#[allow(clippy::too_many_arguments)]
async fn simulate(
    member: Arc<Member>,
    index: usize,
    url: ServerUrl,
    server_id: ServerId,
    project: SharedProjectId,
    file: String,
    rate_ms: u64,
    mut stop: watch::Receiver<bool>,
) {
    let set = |state: &str| lock(&member.status).state = state.to_owned();
    let client = match ServerClient::new(url) {
        Ok(client) => Arc::new(client),
        Err(error) => return set(&format!("no client: {error}")),
    };
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::new()),
        Arc::clone(&member.key),
    ));
    if let Err(error) = sessions.store(server_id, &member.tokens) {
        return set(&format!("no session: {error}"));
    }
    set("joining");
    let (seq, snapshot) = loop {
        let fetched = match sessions.access_token(server_id, &client).await {
            Ok(access) => client.get_snapshot(&access, project).await,
            Err(error) => Err(error),
        };
        match fetched {
            Ok(found) => break found,
            Err(error) => set(&format!("waiting for the snapshot: {error}")),
        }
        tokio::select! {
            _ = stop.changed() => return,
            () = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    };
    let doc = match ProjectDoc::load(&snapshot) {
        Ok(doc) => doc,
        Err(error) => return set(&format!("unreadable snapshot: {error}")),
    };
    let Some((file_id, path)) = target_file(&doc, &file) else {
        return set("the project has no text file");
    };
    let live = Arc::new(Mutex::new(LiveProject::new(doc, seq, ProjectRole::Editor)));
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let link = LiveLink {
        client,
        server_id,
        project,
        device_id: member.tokens.device_id,
        key: Arc::clone(&member.key),
        sessions,
    };
    let handle = spawn_live(link, Arc::clone(&live), events_tx);
    let (sender, mut messages) = mpsc::unbounded_channel::<(u64, DocMessage)>();
    let mut generation = 1u64;
    let mut editor = match open(&live, &file_id, generation, &sender) {
        Ok((rev, text)) => EditorDoc::opened(&file_id, generation, rev, text),
        Err(error) => {
            handle.stopped().await;
            return set(&format!("cannot open {path}: {error}"));
        }
    };
    let mut rng = Rng::new(0xC20D ^ (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    editor.jump_random(&mut rng);
    let mut typing = Typing {
        word: Vec::new(),
        deleting: 0,
    };
    let mut own = Own {
        peer: 0,
        edits: Vec::new(),
        acked: 0,
    };
    let mut sent = 0u64;
    let mut last_presence: Option<Instant> = None;
    let mut ended = false;
    let jitter = |rng: &mut Rng| {
        let spread = rate_ms * 2 / 5;
        Duration::from_millis(rng.between(rate_ms - spread, rate_ms + spread))
    };
    let mut next_key = tokio::time::Instant::now() + jitter(&mut rng);
    loop {
        tokio::select! {
            biased;
            _ = stop.changed() => break,
            message = messages.recv() => {
                let Some((from, message)) = message else { break };
                if from != editor.generation {
                    continue;
                }
                match editor.receive(message) {
                    Reaction::Nothing => {}
                    Reaction::Send(rev, operation) => {
                        if submit(&live, &mut own, &file_id, rev, operation).is_ok() {
                            handle.flush();
                        }
                    }
                    Reaction::Resync => {
                        generation += 1;
                        if let Ok((rev, text)) = open(&live, &file_id, generation, &sender) {
                            editor.reopened(generation, rev, text);
                        }
                    }
                }
            }
            event = events.recv() => {
                let Some(event) = event else { break };
                match event {
                    LiveEvent::Status(LiveStatus::Online) => set("online"),
                    LiveEvent::Status(LiveStatus::Connecting) => set("connecting"),
                    LiveEvent::Status(LiveStatus::Offline { retry_in_ms }) => set(&format!("offline, retry in {retry_in_ms} ms")),
                    LiveEvent::Status(LiveStatus::Ended { reason }) => {
                        set(&format!("ended: {reason:?}"));
                        ended = true;
                    }
                    LiveEvent::Acknowledged => own.confirm(&lock(&live)),
                    _ => {}
                }
            }
            () = tokio::time::sleep_until(next_key), if !ended => {
                next_key = tokio::time::Instant::now() + jitter(&mut rng);
                let typed = if typing.deleting > 0 {
                    typing.deleting -= 1;
                    editor.backspace(1)
                } else if let Some(character) = typing.word.pop() {
                    editor.type_text(&character)
                } else {
                    if rng.chance(12) {
                        typing.deleting = 1 + rng.below(6);
                    } else {
                        editor.jump_random(&mut rng);
                        if rng.chance(20) {
                            typing.word = format!("{} ", rng.pick(WORDS)).chars().rev().map(String::from).collect();
                        } else {
                            typing.next_word(&mut rng);
                        }
                    }
                    Ok(None)
                };
                match typed {
                    Ok(Some((rev, operation))) => {
                        sent += 1;
                        if submit(&live, &mut own, &file_id, rev, operation).is_ok() {
                            handle.flush();
                        }
                    }
                    Ok(None) => {}
                    Err(error) => set(&format!("edit did not fit: {error}")),
                }
                if last_presence.is_none_or(|last| last.elapsed() >= PRESENCE_EVERY) {
                    last_presence = Some(Instant::now());
                    handle.presence(PresenceState {
                        file_id: Some(path.clone()),
                        cursor: u32::try_from(editor.cursor).ok(),
                        anchor: None,
                    });
                }
            }
        }
        {
            let live = lock(&live);
            own.confirm(&live);
            let mut status = lock(&member.status);
            status.sent = sent.max(own.edits.len() as u64);
            status.acked = own.acked as u64;
            status.lag = own.lag();
            status.last_seq = live.last_seq();
        }
    }
    set("stopping");
    handle.flush();
    let settle = Instant::now();
    while lock(&live).has_unsent() && settle.elapsed() < Duration::from_secs(3) {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let _ = tokio::time::timeout(Duration::from_secs(10), handle.stopped()).await;
    {
        let live = lock(&live);
        own.confirm(&live);
        let mut status = lock(&member.status);
        status.acked = own.acked as u64;
        status.lag = own.lag();
        status.last_seq = live.last_seq();
    }
    set("stopped");
}

async fn seed_crowd(state: &AppState, options: &Options) -> Vec<Arc<Member>> {
    let names: Vec<&str> = NAMES
        .iter()
        .copied()
        .filter(|name| !DESKTOP_PEOPLE.contains(name))
        .take(options.crowd)
        .collect();
    let keys = Path::new(&options.data_dir).join("crowd-keys");
    let mut members = Vec::new();
    for name in names {
        let secrets = KeyFile {
            path: keys.join(format!("{}.key", slug(name))),
        };
        let key = match DeviceKey::load_or_create(&secrets) {
            Ok(key) => Arc::new(key),
            Err(error) => {
                eprintln!("Could not prepare a device key for {name}: {error}");
                continue;
            }
        };
        let seeded = seed_person(
            state,
            PersonSeed {
                name: name.to_owned(),
                email: format!("{}@lab.test", slug(name)),
                role: ServerRole::Member,
                device_public_key: key.public_key_b64(),
                device_name: format!("{name}'s simulated laptop"),
            },
        )
        .await;
        match seeded {
            Ok(tokens) => members.push(Arc::new(Member {
                name: name.to_owned(),
                key,
                tokens,
                status: Arc::new(Mutex::new(Status {
                    state: "waiting for the project".to_owned(),
                    ..Status::default()
                })),
            })),
            Err(error) => eprintln!("Could not seed {name}: {error}"),
        }
    }
    members
}

async fn head_seq(state: &AppState, project: SharedProjectId) -> u64 {
    state
        .db
        .call(move |conn| Ok(projects::project_row(conn, project)?.map_or(0, |row| row.head_seq)))
        .await
        .unwrap_or(0)
}

fn status_line(started: Instant, members: &[Arc<Member>], head: u64) -> String {
    let elapsed = started.elapsed().as_secs();
    let mut parts = Vec::new();
    for member in members {
        let status = lock(&member.status).clone();
        let first = member.name.split(' ').next().unwrap_or(&member.name);
        let mut part = format!(
            "{first} {}/{} lag {:.1}s",
            status.sent,
            status.acked,
            status.lag.as_secs_f64()
        );
        let behind = head.saturating_sub(status.last_seq);
        if behind > 0 && status.state == "online" {
            part.push_str(&format!(" behind {behind}"));
        }
        if status.state != "online" {
            part.push_str(&format!(" ({})", status.state));
        }
        parts.push(part);
    }
    format!(
        "[crowd {:02}:{:02} seq {head}] {}",
        elapsed / 60,
        elapsed % 60,
        parts.join(" | ")
    )
}

async fn run_crowd(state: AppState, options: Arc<Options>, mut stop: watch::Receiver<bool>) {
    let members = seed_crowd(&state, &options).await;
    if members.is_empty() {
        return;
    }
    let names: Vec<&str> = members.iter().map(|member| member.name.as_str()).collect();
    println!(
        "Seeded {} simulated people: {}.",
        members.len(),
        names.join(", ")
    );
    match &options.project_title {
        Some(title) => println!("The crowd waits for a shared project called \"{title}\"."),
        None => println!("The crowd waits for the newest shared project."),
    }
    let (project, title) = loop {
        match find_shared_project(&state, options.project_title.as_deref()).await {
            Ok(Some(found)) => break found,
            Ok(None) => {}
            Err(error) => eprintln!("Could not look for the project: {error}"),
        }
        tokio::select! {
            _ = stop.changed() => return,
            () = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    };
    for member in &members {
        if let Err(error) = grant_project_role(
            &state,
            project,
            member.tokens.account_id,
            ProjectRole::Editor,
        )
        .await
        {
            eprintln!("Could not add {} to \"{title}\": {error}", member.name);
        }
    }
    println!(
        "Found \"{title}\". {} people joined as editors and type into {} every {} ms.",
        members.len(),
        options.file,
        options.rate_ms
    );
    let url = match ServerUrl::parse(&format!("http://{}", options.server)) {
        Ok(url) => url,
        Err(error) => return eprintln!("The server address is not usable: {error}"),
    };
    let mut tasks = Vec::new();
    for (index, member) in members.iter().enumerate() {
        tasks.push(tokio::spawn(simulate(
            Arc::clone(member),
            index,
            url.clone(),
            state.server_id,
            project,
            options.file.clone(),
            options.rate_ms,
            stop.clone(),
        )));
        tokio::select! {
            _ = stop.changed() => break,
            () = tokio::time::sleep(CONNECT_SPACING) => {}
        }
    }
    let started = Instant::now();
    let mut ticker = tokio::time::interval(STATUS_EVERY);
    ticker.tick().await;
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            _ = ticker.tick() => {
                let head = head_seq(&state, project).await;
                println!("{}", status_line(started, &members, head));
            }
        }
    }
    for task in tasks {
        let _ = tokio::time::timeout(Duration::from_secs(15), task).await;
    }
    let head = head_seq(&state, project).await;
    println!("{}", status_line(started, &members, head));
}

#[tokio::main]
async fn main() {
    let options = match parse_options(std::env::args().skip(1)) {
        Ok(options) => Arc::new(options),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    std::fs::create_dir_all(&options.data_dir).expect("create the data folder");
    let github = MockGithub::start_rotating_on(
        &options.github,
        vec![
            person(8, "bob", "Bob Smith"),
            person(9, "alice", "Alice Chen"),
            person(10, "carol", "Carol Diaz"),
        ],
    )
    .await;
    let vars: BTreeMap<String, String> = [
        ("OLEAFLY_PUBLIC_URL", format!("http://{}", options.server)),
        ("OLEAFLY_BIND", options.server.clone()),
        ("OLEAFLY_DATA_DIR", options.data_dir.clone()),
        ("OLEAFLY_SETUP_CODE", SETUP_CODE.to_owned()),
        ("OLEAFLY_SERVER_NAME", "Smith Lab".to_owned()),
        ("OLEAFLY_LOG_LEVEL", "info".to_owned()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect();
    let mut config = ServerConfig::from_vars(&vars, &no_secret_files).expect("dev configuration");
    config.providers.push(github_provider("github", &github));
    init_dev_logging(&["loro", "loro_internal", "loro_common"]);
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .expect("the dev server starts");
    let seeded = state
        .db
        .call(|conn| {
            let rule = NewDomainRule {
                domain: "lab.test".to_owned(),
                role: ServerRole::Member,
            };
            Ok(oleafly_server::members::add_domain_rule(conn, &rule, None, 0).is_ok())
        })
        .await
        .expect("seed the domain rule");
    let listener = tokio::net::TcpListener::bind(&options.server)
        .await
        .expect("listen on the dev address");
    println!(
        "Oleafly dev server on http://{} (data in {})",
        options.server, options.data_dir
    );
    println!("Setup code for the first sign-in: {SETUP_CODE}");
    println!("Mock GitHub signs in Bob Smith, then Alice Chen, then Carol Diaz, in turn.");
    if seeded {
        println!("Anyone with an @lab.test email is admitted as a member.");
    }
    let (stop_server, server_stopped) = watch::channel(false);
    let mut server_signal = server_stopped.clone();
    let server = tokio::spawn(serve_until(state.clone(), listener, async move {
        let _ = server_signal.changed().await;
    }));
    let (stop_crowd, crowd_stopped) = watch::channel(false);
    let crowd = (options.crowd > 0).then(|| {
        tokio::spawn(run_crowd(
            state.clone(),
            Arc::clone(&options),
            crowd_stopped,
        ))
    });
    let interrupted = tokio::signal::ctrl_c().await;
    if let Err(error) = interrupted {
        eprintln!("Could not listen for Ctrl-C: {error}");
        std::future::pending::<()>().await;
    }
    println!("Stopping the crowd and the server.");
    let _ = stop_crowd.send(true);
    if let Some(crowd) = crowd {
        let _ = tokio::time::timeout(Duration::from_secs(20), crowd).await;
    }
    let _ = stop_server.send(true);
    match tokio::time::timeout(Duration::from_secs(5), server).await {
        Ok(Ok(Ok(()))) => println!("Stopped."),
        Ok(Ok(Err(error))) => eprintln!("The server stopped with an error: {error}"),
        Ok(Err(error)) => eprintln!("The server task failed: {error}"),
        Err(_) => println!("Stopped (open connections were dropped)."),
    }
    drop(github);
}
