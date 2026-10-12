#[path = "../tests/crowd/relay.rs"]
mod relay;
#[path = "../tests/crowd/typist.rs"]
mod typist;

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, Write};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::ot::{utf16_len, TextOperation};
use oleafly_collab::sync::{spawn_live, LiveEvent, LiveHandle, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{
    CollabError, DeviceKey, MemorySecrets, ServerClient, ServerUrl, SessionManager,
};
use oleafly_collab_protocol::admin::NewDomainRule;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::PresenceState;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::SystemClock;
use oleafly_server::config::ServerConfig;
use oleafly_server::state::AppState;
use oleafly_server::test_support::{
    github_provider, init_dev_logging, project_log, seed_person, serve_until, MockGithub,
    MockGithubUser, PersonSeed,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};

use crate::relay::Relay;
use crate::typist::{EditorDoc, Reaction};

const PREFIX: &str = "e2e-peer ";
const SETUP_CODE: &str = "E2E-SETUP-CODE-0001";
const SERVER_NAME: &str = "E2E Lab";
const OWNER: (&str, &str) = ("bob", "Bob Smith");
const PEER: (&str, &str) = ("alice", "Alice Chen");
const POLL: Duration = Duration::from_millis(50);
const PRESENCE_EVERY: Duration = Duration::from_millis(150);
const STATUS_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Join {
        link: String,
    },
    Type {
        text: String,
        #[serde(default)]
        after: Option<String>,
        #[serde(default)]
        delay_ms: u64,
    },
    WaitText {
        contains: Vec<String>,
        #[serde(default = "default_wait_ms")]
        timeout_ms: u64,
    },
    Text {},
    Settle {
        #[serde(default = "default_wait_ms")]
        timeout_ms: u64,
    },
    Offline {
        side: Side,
    },
    Online {
        side: Side,
    },
    WaitEnded {
        #[serde(default = "default_wait_ms")]
        timeout_ms: u64,
    },
    Retry {},
    Quit {},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Side {
    Peer,
    App,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Request {
    id: u64,
    command: Command,
}

fn default_wait_ms() -> u64 {
    30_000
}

fn parse_request(line: &str) -> Result<Request, String> {
    let mut value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "a request is a JSON object".to_owned())?;
    let id = object
        .remove("id")
        .and_then(|id| id.as_u64())
        .ok_or_else(|| "a request needs a numeric id".to_owned())?;
    let command = serde_json::from_value(value).map_err(|error| error.to_string())?;
    Ok(Request { id, command })
}

fn request_id(line: &str) -> Option<u64> {
    serde_json::from_str::<Value>(line)
        .ok()?
        .get("id")?
        .as_u64()
}

fn parse_link(link: &str) -> Result<(String, SharedProjectId), String> {
    let invalid = || format!("{link:?} is not a shared project link");
    let cleaned = link
        .trim()
        .trim_matches(|character: char| character == '"' || character == '\'')
        .trim();
    let url = url::Url::parse(cleaned).map_err(|_| invalid())?;
    if url.scheme() == "oleafly" {
        let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let server = pairs.get("server").ok_or_else(invalid)?;
        let project = pairs
            .get("project")
            .and_then(|id| id.parse().ok())
            .ok_or_else(invalid)?;
        return Ok((server.trim_end_matches('/').to_owned(), project));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(invalid());
    }
    let mut page = url.clone();
    page.set_query(None);
    page.set_fragment(None);
    let text = page.as_str().trim_end_matches('/');
    let (server, id) = text.rsplit_once("/p/").ok_or_else(invalid)?;
    let project = id.parse().map_err(|_| invalid())?;
    Ok((server.to_owned(), project))
}

fn position_after(text: &str, needle: &str) -> Option<usize> {
    text.find(needle)
        .map(|start| utf16_len(&text[..start + needle.len()]))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn say(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{PREFIX}{value}");
    let _ = out.flush();
}

fn person(id: u64, (login, name): (&str, &str)) -> MockGithubUser {
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

fn failure(error: impl std::fmt::Display) -> String {
    error.to_string()
}

struct Account {
    key: Arc<DeviceKey>,
    sessions: Arc<SessionManager>,
    device_id: oleafly_collab_protocol::ids::DeviceId,
}

struct Peer {
    live: SharedLive,
    link: LiveLink,
    events: mpsc::UnboundedSender<LiveEvent>,
    handle: Option<LiveHandle>,
    file_id: String,
    path: String,
    editor: EditorDoc,
    sender: mpsc::UnboundedSender<(u64, DocMessage)>,
    state: String,
    reason: Option<String>,
    last_presence: Option<Instant>,
}

impl Peer {
    fn open(&mut self) -> Result<(), String> {
        let generation = self.editor.generation + 1;
        let sender = self.sender.clone();
        let sink: DocSink = Arc::new(move |message| {
            let _ = sender.send((generation, message));
        });
        let (rev, text) = lock(&self.live)
            .open_file(&self.file_id, sink)
            .map_err(failure)?;
        self.editor.reopened(generation, rev, text);
        Ok(())
    }

    fn submit(&mut self, rev: u64, operation: TextOperation) -> Result<(), String> {
        lock(&self.live)
            .editor_change(&self.file_id, rev, operation)
            .map_err(failure)?;
        if let Some(handle) = &self.handle {
            handle.flush();
        }
        Ok(())
    }

    fn receive(&mut self, generation: u64, message: DocMessage) {
        if generation != self.editor.generation {
            return;
        }
        match self.editor.receive(message) {
            Reaction::Nothing => {}
            Reaction::Send(rev, operation) => {
                let _ = self.submit(rev, operation);
            }
            Reaction::Resync => {
                let _ = self.open();
            }
        }
    }

    fn observe(&mut self, event: LiveEvent) {
        let LiveEvent::Status(status) = event else {
            return;
        };
        let (state, reason) = match status {
            LiveStatus::Connecting => ("connecting", None),
            LiveStatus::Online => ("online", None),
            LiveStatus::Offline { .. } => ("offline", None),
            LiveStatus::Ended { reason } => (
                "ended",
                serde_json::to_value(reason)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned)),
            ),
        };
        self.state = state.to_owned();
        self.reason = reason;
    }

    fn type_one(&mut self, character: &str) -> Result<(), String> {
        if let Some((rev, operation)) = self.editor.type_text(character).map_err(failure)? {
            self.submit(rev, operation)?;
        }
        if self
            .last_presence
            .is_none_or(|last| last.elapsed() >= PRESENCE_EVERY)
        {
            self.announce();
        }
        Ok(())
    }

    fn announce(&mut self) {
        self.last_presence = Some(Instant::now());
        if let Some(handle) = &self.handle {
            handle.presence(PresenceState {
                file_id: Some(self.path.clone()),
                cursor: u32::try_from(self.editor.cursor).ok(),
                anchor: None,
            });
        }
    }

    fn unsent(&self) -> bool {
        lock(&self.live).has_unsent() || !self.editor.synchronized()
    }

    fn report(&self) -> Value {
        json!({
            "state": self.state,
            "reason": self.reason,
            "text": self.editor.content,
            "file": self.path,
            "unsent": self.unsent(),
        })
    }

    fn go_live(&mut self) {
        self.state = "connecting".to_owned();
        self.reason = None;
        self.handle = Some(spawn_live(
            self.link.clone(),
            Arc::clone(&self.live),
            self.events.clone(),
        ));
    }
}

struct Stack {
    state: AppState,
    server_id: ServerId,
    app_route: Relay,
    peer_route: Relay,
    account: Account,
    peer: Option<Arc<Mutex<Peer>>>,
}

fn target_file(doc: &ProjectDoc) -> Option<(String, String)> {
    let wanted = doc
        .meta("main_doc")
        .filter(|main| !main.is_empty())
        .unwrap_or_else(|| "main.tex".to_owned());
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

async fn pump(
    peer: Arc<Mutex<Peer>>,
    mut messages: mpsc::UnboundedReceiver<(u64, DocMessage)>,
    mut events: mpsc::UnboundedReceiver<LiveEvent>,
) {
    loop {
        tokio::select! {
            message = messages.recv() => match message {
                Some((generation, message)) => lock(&peer).receive(generation, message),
                None => return,
            },
            event = events.recv() => match event {
                Some(event) => lock(&peer).observe(event),
                None => return,
            },
        }
    }
}

async fn wait_for<F>(peer: &Arc<Mutex<Peer>>, timeout: Duration, mut done: F) -> Result<(), String>
where
    F: FnMut(&Peer) -> bool,
{
    let started = Instant::now();
    loop {
        {
            let peer = lock(peer);
            if done(&peer) {
                return Ok(());
            }
            if started.elapsed() >= timeout {
                return Err(format!(
                    "timed out after {} ms; the peer is {} ({}) and has {}",
                    timeout.as_millis(),
                    peer.state,
                    peer.reason.as_deref().unwrap_or("no reason"),
                    if peer.unsent() {
                        "changes the server has not confirmed"
                    } else {
                        "nothing unsent"
                    }
                ));
            }
        }
        tokio::time::sleep(POLL).await;
    }
}

impl Stack {
    fn peer(&self) -> Result<Arc<Mutex<Peer>>, String> {
        self.peer
            .clone()
            .ok_or_else(|| "the peer has not joined a project yet".to_owned())
    }

    async fn join(&mut self, link: &str) -> Result<Value, String> {
        let (server, shared) = parse_link(link)?;
        let linked = ServerClient::new(ServerUrl::parse(&server).map_err(failure)?)
            .map_err(failure)?
            .capabilities()
            .await
            .map_err(|error| format!("the link's server did not answer: {error}"))?;
        if linked.server_id != self.server_id {
            return Err(format!("the link points at another server ({server})"));
        }
        let client = Arc::new(ServerClient::new(self.peer_route.url.clone()).map_err(failure)?);
        let access = self
            .account
            .sessions
            .access_token(self.server_id, &client)
            .await
            .map_err(failure)?;
        let summary = match client.project(&access, shared).await {
            Err(CollabError::Api { status: 404, .. }) => client
                .join_project(&access, shared)
                .await
                .map_err(|error| format!("joining through the link was refused: {error}"))?,
            other => other.map_err(failure)?,
        };
        let (seq, snapshot) = client
            .get_snapshot(&access, shared)
            .await
            .map_err(failure)?;
        let doc = ProjectDoc::load(&snapshot).map_err(failure)?;
        let (file_id, path) =
            target_file(&doc).ok_or_else(|| "the project has no text file".to_owned())?;
        let live: SharedLive = Arc::new(Mutex::new(LiveProject::new(doc, seq, summary.role)));
        let (events_tx, events_rx) = mpsc::unbounded_channel();
        let (sender, messages) = mpsc::unbounded_channel();
        let link = LiveLink {
            client,
            server_id: self.server_id,
            project: shared,
            device_id: self.account.device_id,
            key: Arc::clone(&self.account.key),
            sessions: Arc::clone(&self.account.sessions),
        };
        let mut peer = Peer {
            live,
            link,
            events: events_tx,
            handle: None,
            file_id: file_id.clone(),
            path: path.clone(),
            editor: EditorDoc::opened(&file_id, 0, 0, String::new()),
            sender,
            state: "connecting".to_owned(),
            reason: None,
            last_presence: None,
        };
        peer.open()?;
        peer.go_live();
        let peer = Arc::new(Mutex::new(peer));
        tokio::spawn(pump(Arc::clone(&peer), messages, events_rx));
        wait_for(&peer, STATUS_WAIT, |peer| peer.state == "online").await?;
        lock(&peer).announce();
        self.peer = Some(peer);
        Ok(json!({
            "title": summary.title,
            "role": summary.role,
            "file": path,
            "project": shared.to_string(),
        }))
    }

    async fn type_text(
        &self,
        text: &str,
        after: Option<&str>,
        delay: u64,
    ) -> Result<Value, String> {
        let peer = self.peer()?;
        {
            let mut peer = lock(&peer);
            let start = match after {
                Some(needle) => position_after(&peer.editor.content, needle)
                    .ok_or_else(|| format!("{needle:?} is not in {}", peer.path))?,
                None => peer.editor.length,
            };
            peer.editor.jump(start);
        }
        for character in text.chars() {
            lock(&peer).type_one(&character.to_string())?;
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
        let report = lock(&peer).report();
        Ok(report)
    }

    async fn wait_text(&self, contains: &[String], timeout: Duration) -> Result<Value, String> {
        let peer = self.peer()?;
        wait_for(&peer, timeout, |peer| {
            contains
                .iter()
                .all(|needle| peer.editor.content.contains(needle.as_str()))
        })
        .await
        .map_err(|error| {
            let text = lock(&peer).editor.content.clone();
            format!("{error}; the peer's text is {text:?}")
        })?;
        let report = lock(&peer).report();
        Ok(report)
    }

    async fn settle(&self, timeout: Duration) -> Result<Value, String> {
        let peer = self.peer()?;
        wait_for(&peer, timeout, |peer| {
            peer.state == "online" && !peer.unsent()
        })
        .await?;
        let report = lock(&peer).report();
        Ok(report)
    }

    async fn offline(&self, side: Side) -> Result<Value, String> {
        match side {
            Side::App => {
                self.app_route.go_offline();
                Ok(json!({ "side": "app" }))
            }
            Side::Peer => {
                self.peer_route.go_offline();
                let peer = self.peer()?;
                wait_for(&peer, STATUS_WAIT, |peer| peer.state != "online").await?;
                let report = lock(&peer).report();
                Ok(report)
            }
        }
    }

    async fn online(&self, side: Side) -> Result<Value, String> {
        match side {
            Side::App => {
                self.app_route.go_online();
                Ok(json!({ "side": "app" }))
            }
            Side::Peer => {
                self.peer_route.go_online();
                let peer = self.peer()?;
                wait_for(&peer, STATUS_WAIT, |peer| peer.state == "online").await?;
                let report = lock(&peer).report();
                Ok(report)
            }
        }
    }

    async fn wait_ended(&self, timeout: Duration) -> Result<Value, String> {
        let peer = self.peer()?;
        wait_for(&peer, timeout, |peer| peer.state == "ended").await?;
        let report = lock(&peer).report();
        Ok(report)
    }

    async fn retry(&self) -> Result<Value, String> {
        let peer = self.peer()?;
        let (shared, client) = {
            let peer = lock(&peer);
            (peer.link.project, Arc::clone(&peer.link.client))
        };
        let before = project_log(&self.state, shared)
            .await
            .map_err(failure)?
            .head_seq;
        let finished = lock(&peer).handle.take();
        if let Some(handle) = finished {
            let _ = tokio::time::timeout(Duration::from_secs(10), handle.stopped()).await;
        }
        lock(&peer).go_live();
        wait_for(&peer, STATUS_WAIT, |peer| {
            peer.state == "ended" || peer.state == "online"
        })
        .await?;
        let read = match self
            .account
            .sessions
            .access_token(self.server_id, &client)
            .await
        {
            Ok(access) => match client.get_snapshot(&access, shared).await {
                Ok(_) => "allowed".to_owned(),
                Err(CollabError::Api { status, .. }) => format!("refused {status}"),
                Err(error) => format!("failed: {error}"),
            },
            Err(error) => format!("no session: {error}"),
        };
        let after = project_log(&self.state, shared)
            .await
            .map_err(failure)?
            .head_seq;
        let mut report = lock(&peer).report();
        report["headBefore"] = json!(before);
        report["headAfter"] = json!(after);
        report["snapshot"] = json!(read);
        Ok(report)
    }

    async fn run(&mut self, command: Command) -> Result<Value, String> {
        match command {
            Command::Join { link } => self.join(&link).await,
            Command::Type {
                text,
                after,
                delay_ms,
            } => self.type_text(&text, after.as_deref(), delay_ms).await,
            Command::WaitText {
                contains,
                timeout_ms,
            } => {
                self.wait_text(&contains, Duration::from_millis(timeout_ms))
                    .await
            }
            Command::Text {} => {
                let peer = self.peer()?;
                let report = lock(&peer).report();
                Ok(report)
            }
            Command::Settle { timeout_ms } => self.settle(Duration::from_millis(timeout_ms)).await,
            Command::Offline { side } => self.offline(side).await,
            Command::Online { side } => self.online(side).await,
            Command::WaitEnded { timeout_ms } => {
                self.wait_ended(Duration::from_millis(timeout_ms)).await
            }
            Command::Retry {} => self.retry().await,
            Command::Quit {} => Ok(json!({ "bye": true })),
        }
    }

    async fn shutdown(&mut self) {
        if let Some(peer) = self.peer.take() {
            let handle = lock(&peer).handle.take();
            if let Some(handle) = handle {
                let _ = tokio::time::timeout(Duration::from_secs(5), handle.stopped()).await;
            }
        }
    }
}

async fn start_server(data_dir: &Path) -> (AppState, SocketAddr, MockGithub, watch::Sender<bool>) {
    let github = MockGithub::start(vec![person(8, OWNER)]).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listen on a free port");
    let address = listener.local_addr().expect("the server address");
    let vars: BTreeMap<String, String> = [
        ("OLEAFLY_PUBLIC_URL", format!("http://{address}")),
        ("OLEAFLY_BIND", address.to_string()),
        ("OLEAFLY_DATA_DIR", data_dir.display().to_string()),
        ("OLEAFLY_SETUP_CODE", SETUP_CODE.to_owned()),
        ("OLEAFLY_SERVER_NAME", SERVER_NAME.to_owned()),
        ("OLEAFLY_LOG_LEVEL", "info".to_owned()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect();
    let mut config = ServerConfig::from_vars(&vars, &no_secret_files).expect("e2e configuration");
    config.providers.push(github_provider("github", &github));
    let state = AppState::new(config, Arc::new(SystemClock))
        .await
        .expect("the e2e server starts");
    state
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
    let (stop, stopped) = watch::channel(false);
    let mut signal = stopped;
    tokio::spawn(serve_until(state.clone(), listener, async move {
        let _ = signal.changed().await;
    }));
    (state, address, github, stop)
}

async fn seed_peer(state: &AppState) -> Account {
    let key = Arc::new(DeviceKey::load_or_create(&MemorySecrets::new()).expect("a device key"));
    let tokens = seed_person(
        state,
        PersonSeed {
            name: PEER.1.to_owned(),
            email: format!("{}@lab.test", PEER.0),
            role: ServerRole::Member,
            device_public_key: key.public_key_b64(),
            device_name: format!("{}'s headless laptop", PEER.1),
        },
    )
    .await
    .expect("seed the peer");
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::new()),
        Arc::clone(&key),
    ));
    sessions
        .store(state.server_id, &tokens)
        .expect("store the peer's session");
    Account {
        key,
        sessions,
        device_id: tokens.device_id,
    }
}

fn read_requests() -> mpsc::UnboundedReceiver<String> {
    let (lines, receiver) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

#[tokio::main]
async fn main() {
    init_dev_logging(&["loro", "loro_internal", "loro_common"]);
    let data = tempfile::tempdir().expect("a data folder for the e2e server");
    let (state, address, github, stop) = start_server(data.path()).await;
    let account = seed_peer(&state).await;
    let mut stack = Stack {
        server_id: state.server_id,
        app_route: Relay::start(address).await,
        peer_route: Relay::start(address).await,
        state,
        account,
        peer: None,
    };
    say(&json!({
        "event": "ready",
        "server": stack.app_route.url.as_str(),
        "direct": format!("http://{address}"),
        "setupCode": SETUP_CODE,
        "serverName": SERVER_NAME,
        "owner": OWNER.1,
        "peer": PEER.1,
    }));
    let mut requests = read_requests();
    while let Some(line) = requests.recv().await {
        if line.trim().is_empty() {
            continue;
        }
        let request = match parse_request(&line) {
            Ok(request) => request,
            Err(error) => {
                say(&json!({ "id": request_id(&line), "ok": false, "error": error }));
                continue;
            }
        };
        let quit = request.command == Command::Quit {};
        match stack.run(request.command).await {
            Ok(mut reply) => {
                reply["id"] = json!(request.id);
                reply["ok"] = json!(true);
                say(&reply);
            }
            Err(error) => say(&json!({ "id": request.id, "ok": false, "error": error })),
        }
        if quit {
            break;
        }
    }
    stack.shutdown().await;
    let _ = stop.send(true);
    drop(github);
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "0199d2a4-7b1e-7c3a-9f00-1234567890ab";

    #[test]
    fn a_landing_link_names_the_server_and_the_project() {
        let link = format!("http://127.0.0.1:41234/p/{PROJECT}");
        let (server, project) = parse_link(&link).expect("a landing link");
        assert_eq!(server, "http://127.0.0.1:41234");
        assert_eq!(project.to_string(), PROJECT);
        let padded = format!("  \"https://collab.example.edu/lab/p/{PROJECT}/?from=mail\"  ");
        let (server, project) = parse_link(&padded).expect("a padded landing link");
        assert_eq!(server, "https://collab.example.edu/lab");
        assert_eq!(project.to_string(), PROJECT);
    }

    #[test]
    fn an_app_link_carries_the_server_and_the_project_in_its_query() {
        let link =
            format!("oleafly://open?server=http%3A%2F%2F127.0.0.1%3A41234&project={PROJECT}");
        let (server, project) = parse_link(&link).expect("an app link");
        assert_eq!(server, "http://127.0.0.1:41234");
        assert_eq!(project.to_string(), PROJECT);
    }

    #[test]
    fn anything_else_is_not_a_shared_project_link() {
        for link in [
            "",
            "http://127.0.0.1:41234/projects/1",
            "http://127.0.0.1:41234/p/not-an-id",
            "oleafly://open?server=http%3A%2F%2F127.0.0.1",
            "mailto:someone@lab.test",
        ] {
            assert!(parse_link(link).is_err(), "{link} was accepted");
        }
    }

    #[test]
    fn requests_name_their_command_and_keep_their_id() {
        let typed = parse_request(
            r#"{"id":7,"cmd":"type","text":"PEER","after":"\\begin{document}","delay_ms":25}"#,
        )
        .expect("a type request");
        assert_eq!(
            typed,
            Request {
                id: 7,
                command: Command::Type {
                    text: "PEER".to_owned(),
                    after: Some("\\begin{document}".to_owned()),
                    delay_ms: 25,
                },
            }
        );
        let offline =
            parse_request(r#"{"id":8,"cmd":"offline","side":"app"}"#).expect("an offline request");
        assert_eq!(offline.command, Command::Offline { side: Side::App });
        let waiting = parse_request(r#"{"id":9,"cmd":"wait_text","contains":["a","b"]}"#)
            .expect("a wait request");
        assert_eq!(
            waiting.command,
            Command::WaitText {
                contains: vec!["a".to_owned(), "b".to_owned()],
                timeout_ms: 30_000,
            }
        );
    }

    #[test]
    fn a_request_the_peer_cannot_follow_says_why() {
        let unknown = parse_request(r#"{"id":1,"cmd":"dance"}"#).expect_err("unknown command");
        assert!(unknown.contains("dance"), "{unknown}");
        let broken = parse_request("not json").expect_err("not json");
        assert!(!broken.is_empty());
        let stray =
            parse_request(r#"{"id":2,"cmd":"text","colour":"red"}"#).expect_err("unknown field");
        assert!(stray.contains("colour"), "{stray}");
    }

    #[test]
    fn a_refused_request_is_still_answered_under_its_own_id() {
        assert_eq!(request_id(r#"{"id":4,"cmd":"dance"}"#), Some(4));
        assert_eq!(request_id(r#"{"cmd":"text"}"#), None);
        assert_eq!(request_id("not json"), None);
    }

    #[test]
    fn typing_after_a_phrase_starts_right_behind_it_in_editor_units() {
        assert_eq!(
            position_after("ab\\begin{document}\ncd", "\\begin{document}"),
            Some(18)
        );
        assert_eq!(position_after("é😀 marker tail", "marker"), Some(10));
        assert_eq!(position_after("nothing here", "marker"), None);
    }
}
