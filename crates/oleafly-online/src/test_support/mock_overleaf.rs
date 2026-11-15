use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::frames::{self, Packet};
use super::history_ot_text::{Marks, Part, TextOperation};
use super::overleaf_rt::{blob_hash, git_blob_hash};
use super::sharejs_text::{self, Component, Side};
use super::{read_message, Reply, Request};

pub const MOCK_CSRF: &str = "mock-csrf-token";
pub const MAX_DOC_LENGTH: usize = 2 * 1024 * 1024;

const TEXT_EXTENSIONS: &[&str] = &[
    "tex", "latex", "sty", "cls", "bst", "bib", "bibtex", "txt", "tikz", "md", "bbx", "cbx", "lbx",
    "def", "cfg", "clo", "dtx", "ins", "ist", "ldf", "lua", "rmd", "rnw", "yml", "yaml", "ltx",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocFormat {
    ShareJs,
    HistoryOt,
}

impl DocFormat {
    pub fn wire_name(self) -> &'static str {
        match self {
            DocFormat::ShareJs => "sharejs-text-ot",
            DocFormat::HistoryOt => "history-ot",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Privilege {
    Owner,
    ReadAndWrite,
    Review,
    ReadOnly,
}

impl Privilege {
    pub fn wire_name(self) -> &'static str {
        match self {
            Privilege::Owner => "owner",
            Privilege::ReadAndWrite => "readAndWrite",
            Privilege::Review => "review",
            Privilege::ReadOnly => "readOnly",
        }
    }

    fn can_write(self) -> bool {
        matches!(self, Privilege::Owner | Privilege::ReadAndWrite)
    }

    fn can_review(self) -> bool {
        !matches!(self, Privilege::ReadOnly)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockUser {
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub session: String,
}

fn object_id(seed: &str) -> String {
    let mut hash: u128 = 0x6af9_0000_0000_0000_0000_0000_0000_0000;
    for byte in seed.bytes() {
        hash = hash
            .wrapping_mul(0x0100_0000_0000_0000_0000_0000_013b)
            .wrapping_add(u128::from(byte));
    }
    format!("{:024x}", hash & ((1 << 96) - 1))
}

impl MockUser {
    pub fn named(name: &str) -> Self {
        let mut first = name.to_string();
        if let Some(initial) = first.get_mut(0..1) {
            initial.make_ascii_uppercase();
        }
        MockUser {
            id: object_id(&format!("user:{name}")),
            email: format!("{name}@example.test"),
            first_name: first,
            last_name: "Tester".into(),
            session: format!("session-{name}"),
        }
    }

    pub fn cookie(&self) -> String {
        format!("overleaf.sid={}", self.session)
    }

    fn display_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }
}

#[derive(Clone, Debug)]
enum Entry {
    Doc { path: String, text: String },
    File { path: String, bytes: Vec<u8> },
}

#[derive(Clone, Debug)]
pub struct MockProject {
    pub name: String,
    pub owner: MockUser,
    pub members: Vec<(MockUser, Privilege)>,
    pub outsiders: Vec<MockUser>,
    pub format: DocFormat,
    pub compiler: String,
    pub track_changes: Value,
    entries: Vec<Entry>,
    root_doc: Option<String>,
}

impl MockProject {
    pub fn new(name: &str) -> Self {
        MockProject {
            name: name.to_string(),
            owner: MockUser::named("alice"),
            members: Vec::new(),
            outsiders: Vec::new(),
            format: DocFormat::ShareJs,
            compiler: "pdflatex".into(),
            track_changes: json!({}),
            entries: Vec::new(),
            root_doc: None,
        }
    }

    pub fn owner(mut self, user: MockUser) -> Self {
        self.owner = user;
        self
    }

    pub fn member(mut self, user: MockUser, privilege: Privilege) -> Self {
        self.members.push((user, privilege));
        self
    }

    pub fn outsider(mut self, user: MockUser) -> Self {
        self.outsiders.push(user);
        self
    }

    pub fn format(mut self, format: DocFormat) -> Self {
        self.format = format;
        self
    }

    pub fn doc(mut self, path: &str, text: &str) -> Self {
        self.entries.push(Entry::Doc {
            path: path.to_string(),
            text: text.to_string(),
        });
        self
    }

    pub fn file(mut self, path: &str, bytes: &[u8]) -> Self {
        self.entries.push(Entry::File {
            path: path.to_string(),
            bytes: bytes.to_vec(),
        });
        self
    }

    pub fn root_doc(mut self, path: &str) -> Self {
        self.root_doc = Some(path.to_string());
        self
    }

    pub fn track_changes(mut self, state: Value) -> Self {
        self.track_changes = state;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    Retry,
    InvalidSession,
    BadProjectId,
    Error,
    NotAuthorized,
    ProjectNotFound,
    RateLimited,
}

impl Rejection {
    pub fn payload(self) -> Value {
        match self {
            Rejection::Retry => json!({ "message": "retry" }),
            Rejection::InvalidSession => json!({ "message": "invalid session" }),
            Rejection::BadProjectId => {
                json!({ "message": "missing/bad ?projectId=... query flag on handshake" })
            }
            Rejection::Error => json!({ "message": "error" }),
            Rejection::NotAuthorized => json!({ "message": "not authorized" }),
            Rejection::ProjectNotFound => {
                json!({ "message": "project not found", "code": "ProjectNotFound" })
            }
            Rejection::RateLimited => {
                json!({ "message": "rate-limit hit when joining project", "code": "TooManyRequests" })
            }
        }
    }

    fn lost_over_polling(self) -> bool {
        matches!(
            self,
            Rejection::Retry
                | Rejection::InvalidSession
                | Rejection::BadProjectId
                | Rejection::Error
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fault {
    LoseReply,
    Delay(Duration),
    Reply(u16, String),
}

#[derive(Clone, Debug)]
struct PlannedFault {
    method: Option<String>,
    prefix: String,
    fault: Fault,
}

#[derive(Clone, Debug)]
pub struct RateLimits {
    pub joins_per_minute: usize,
    pub docs_per_minute: usize,
    pub folders_per_minute: usize,
    pub uploads_per_quarter_hour: usize,
}

impl Default for RateLimits {
    fn default() -> Self {
        RateLimits {
            joins_per_minute: 45,
            docs_per_minute: 30,
            folders_per_minute: 60,
            uploads_per_quarter_hour: 500,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MockConfig {
    pub legacy_doc_rooms: bool,
    pub websocket: bool,
    pub ws_url: Option<String>,
    pub handshake_reply: Option<(u16, String)>,
    pub heartbeat: Option<Duration>,
    pub server_ping: Option<Duration>,
    pub poll_hold: Duration,
    pub protocol_version: u64,
    pub max_reconnect_gracefully_ms: Option<u64>,
    pub reject_connections: Option<Rejection>,
    pub lose_polling_rejections: bool,
    pub rate_limits: RateLimits,
    pub retry_after: Option<u64>,
    pub history_status: u16,
    pub threads_status: u16,
    pub messages_status: u16,
    pub kept_ops: usize,
    pub max_op_age: u64,
    pub history_ot_applied_version: bool,
}

impl Default for MockConfig {
    fn default() -> Self {
        MockConfig {
            legacy_doc_rooms: false,
            websocket: true,
            ws_url: None,
            handshake_reply: None,
            heartbeat: Some(Duration::from_secs(25)),
            server_ping: Some(Duration::from_secs(15)),
            poll_hold: Duration::from_secs(5),
            protocol_version: 2,
            max_reconnect_gracefully_ms: Some(30_000),
            reject_connections: None,
            lose_polling_rejections: true,
            rate_limits: RateLimits::default(),
            retry_after: None,
            history_status: 200,
            threads_status: 404,
            messages_status: 200,
            kept_ops: 100,
            max_op_age: 80,
            history_ot_applied_version: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    Pending,
    WebSocket,
    Polling,
    Peer,
}

#[derive(Clone, Debug)]
pub struct Received {
    pub public_id: String,
    pub name: String,
    pub args: Vec<Value>,
}

#[derive(Clone, Debug)]
pub struct Connection {
    pub public_id: String,
    pub user_id: Option<String>,
    pub transport: Transport,
    pub joined: Vec<String>,
}

#[derive(Clone, Debug)]
struct Applied {
    at: u64,
    source: String,
    update: Value,
}

#[derive(Clone, Debug)]
struct Doc {
    name: String,
    format: DocFormat,
    content: Vec<u16>,
    tracked: Vec<Option<Value>>,
    version: u64,
    applied: VecDeque<Applied>,
    fail_next: Option<String>,
}

impl Doc {
    fn new(name: &str, text: &str, format: DocFormat) -> Self {
        let content = sharejs_text::units(text);
        Doc {
            name: name.to_string(),
            format,
            tracked: vec![None; content.len()],
            content,
            version: 0,
            applied: VecDeque::new(),
            fail_next: None,
        }
    }

    fn visible(&self) -> Vec<u16> {
        self.content
            .iter()
            .zip(&self.tracked)
            .filter(|(_, mark)| !is_deleted(mark))
            .map(|(unit, _)| *unit)
            .collect()
    }

    fn first_kept(&self) -> u64 {
        self.applied
            .front()
            .map_or(self.version, |applied| applied.at)
    }

    fn tracked_changes(&self) -> Vec<Value> {
        let mut changes: Vec<Value> = Vec::new();
        let mut run: Option<(usize, usize, Value)> = None;
        for (at, mark) in self.tracked.iter().enumerate() {
            match (&mut run, mark) {
                (Some((_, length, current)), Some(mark)) if current == mark => *length += 1,
                _ => {
                    if let Some((pos, length, tracking)) = run.take() {
                        changes.push(json!({ "range": { "pos": pos, "length": length }, "tracking": tracking }));
                    }
                    if let Some(mark) = mark {
                        run = Some((at, 1, mark.clone()));
                    }
                }
            }
        }
        if let Some((pos, length, tracking)) = run {
            changes
                .push(json!({ "range": { "pos": pos, "length": length }, "tracking": tracking }));
        }
        changes
    }
}

fn is_deleted(mark: &Option<Value>) -> bool {
    mark.as_ref().and_then(|mark| mark["type"].as_str()) == Some("delete")
}

#[derive(Clone, Debug)]
struct Blob {
    name: String,
    bytes: Vec<u8>,
    hash: String,
}

#[derive(Clone, Debug, Default)]
struct Folder {
    id: String,
    name: String,
    folders: Vec<Folder>,
    docs: Vec<String>,
    files: Vec<String>,
}

impl Folder {
    fn find_mut(&mut self, id: &str) -> Option<&mut Folder> {
        if self.id == id {
            return Some(self);
        }
        self.folders
            .iter_mut()
            .find_map(|folder| folder.find_mut(id))
    }

    fn detach(&mut self, id: &str) -> Option<Option<Folder>> {
        if let Some(at) = self.docs.iter().position(|entity| entity == id) {
            self.docs.remove(at);
            return Some(None);
        }
        if let Some(at) = self.files.iter().position(|entity| entity == id) {
            self.files.remove(at);
            return Some(None);
        }
        if let Some(at) = self.folders.iter().position(|folder| folder.id == id) {
            return Some(Some(self.folders.remove(at)));
        }
        self.folders.iter_mut().find_map(|folder| folder.detach(id))
    }

    fn rename(&mut self, id: &str, name: &str) -> bool {
        if let Some(folder) = self.find_mut(id) {
            folder.name = name.to_string();
            return true;
        }
        false
    }

    fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.docs.iter().chain(&self.files).cloned().collect();
        for folder in &self.folders {
            ids.push(folder.id.clone());
            ids.extend(folder.ids());
        }
        ids
    }
}

struct Client {
    public_id: String,
    user: Option<String>,
    project_query: String,
    transport: Transport,
    outbox: VecDeque<String>,
    wake: Arc<Notify>,
    joined: BTreeSet<String>,
    cursor: Option<Value>,
    connected: bool,
    closed: bool,
    abrupt: bool,
    wants_ping: bool,
    pings: u64,
    connected_at: u128,
}

struct State {
    config: MockConfig,
    next_id: u64,
    next_client: u64,
    project_id: String,
    project_name: String,
    owner: MockUser,
    members: Vec<(MockUser, Privilege)>,
    outsiders: Vec<MockUser>,
    compiler: String,
    track_changes: Value,
    format: DocFormat,
    root: Folder,
    root_doc: Option<String>,
    docs: BTreeMap<String, Doc>,
    files: BTreeMap<String, Blob>,
    clients: BTreeMap<String, Client>,
    received: Vec<Received>,
    requests: Vec<Request>,
    history: Vec<Value>,
    faults: Vec<PlannedFault>,
    counters: HashMap<String, VecDeque<tokio::time::Instant>>,
    stalled: bool,
    down: bool,
}

const RATE_LIMITED: &str = "Rate limit reached, please try again later";
const NOT_HANDSHAKEN: &str = "7:::1+0";

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn pack_lines(units: &[u16]) -> Value {
    let text = sharejs_text::text(units);
    Value::Array(
        text.split('\n')
            .map(|line| Value::String(line.bytes().map(char::from).collect()))
            .collect(),
    )
}

fn error_value(message: &str) -> Value {
    json!({ "message": message })
}

impl State {
    fn new(project: MockProject) -> State {
        let mut state = State {
            config: MockConfig::default(),
            next_id: 1,
            next_client: 1,
            project_id: object_id(&format!("project:{}", project.name)),
            project_name: project.name.clone(),
            owner: project.owner.clone(),
            members: project.members.clone(),
            outsiders: project.outsiders.clone(),
            compiler: project.compiler.clone(),
            track_changes: project.track_changes.clone(),
            format: project.format,
            root: Folder::default(),
            root_doc: None,
            docs: BTreeMap::new(),
            files: BTreeMap::new(),
            clients: BTreeMap::new(),
            received: Vec::new(),
            requests: Vec::new(),
            history: Vec::new(),
            faults: Vec::new(),
            counters: HashMap::new(),
            stalled: false,
            down: false,
        };
        state.root = Folder {
            id: state.new_id(),
            name: "rootFolder".into(),
            ..Folder::default()
        };
        for entry in &project.entries {
            match entry {
                Entry::Doc { path, text } => {
                    let (folder, name) = state.folder_for_path(path);
                    let id = state.new_id();
                    state
                        .docs
                        .insert(id.clone(), Doc::new(&name, text, project.format));
                    state.root.find_mut(&folder).unwrap().docs.push(id);
                }
                Entry::File { path, bytes } => {
                    let (folder, name) = state.folder_for_path(path);
                    let id = state.new_id();
                    state.files.insert(
                        id.clone(),
                        Blob {
                            name,
                            hash: git_blob_hash(bytes),
                            bytes: bytes.clone(),
                        },
                    );
                    state.root.find_mut(&folder).unwrap().files.push(id);
                }
            }
        }
        let root_doc = project.root_doc.clone().or_else(|| {
            project.entries.iter().find_map(|entry| match entry {
                Entry::Doc { path, .. } => Some(path.clone()),
                Entry::File { .. } => None,
            })
        });
        state.root_doc = root_doc.and_then(|path| state.id_for_path(&path));
        state
    }

    fn new_id(&mut self) -> String {
        self.next_id += 1;
        format!("{}{:08x}", self.project_id_seed(), self.next_id)
    }

    fn project_id_seed(&self) -> String {
        self.project_id
            .get(..16)
            .unwrap_or("6af9000000000000")
            .to_string()
    }

    fn folder_for_path(&mut self, path: &str) -> (String, String) {
        let mut parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        let name = parts.pop().unwrap_or_default().to_string();
        let mut current = self.root.id.clone();
        for part in parts {
            let existing = self
                .root
                .find_mut(&current)
                .unwrap()
                .folders
                .iter()
                .find(|folder| folder.name == part)
                .map(|folder| folder.id.clone());
            current = match existing {
                Some(id) => id,
                None => {
                    let id = self.new_id();
                    self.root.find_mut(&current).unwrap().folders.push(Folder {
                        id: id.clone(),
                        name: part.to_string(),
                        ..Folder::default()
                    });
                    id
                }
            };
        }
        (current, name)
    }

    fn paths(&self) -> Vec<(String, &'static str, String)> {
        let mut found = Vec::new();
        let mut pending = vec![(String::new(), &self.root)];
        while let Some((prefix, folder)) = pending.pop() {
            for id in &folder.docs {
                if let Some(doc) = self.docs.get(id) {
                    found.push((format!("{prefix}{}", doc.name), "doc", id.clone()));
                }
            }
            for id in &folder.files {
                if let Some(file) = self.files.get(id) {
                    found.push((format!("{prefix}{}", file.name), "file", id.clone()));
                }
            }
            for child in &folder.folders {
                found.push((
                    format!("{prefix}{}", child.name),
                    "folder",
                    child.id.clone(),
                ));
                pending.push((format!("{prefix}{}/", child.name), child));
            }
        }
        found.sort();
        found
    }

    fn id_for_path(&self, path: &str) -> Option<String> {
        let path = path.trim_start_matches('/');
        self.paths()
            .into_iter()
            .find(|(candidate, _, _)| candidate == path)
            .map(|(_, _, id)| id)
    }

    fn people(&self) -> impl Iterator<Item = &MockUser> {
        std::iter::once(&self.owner)
            .chain(self.members.iter().map(|(user, _)| user))
            .chain(&self.outsiders)
    }

    fn user(&self, id: &str) -> Option<&MockUser> {
        self.people().find(|user| user.id == id)
    }

    fn privilege(&self, user_id: &str) -> Option<Privilege> {
        if self.owner.id == user_id {
            return Some(Privilege::Owner);
        }
        self.members
            .iter()
            .find(|(user, _)| user.id == user_id)
            .map(|(_, privilege)| *privilege)
    }

    fn user_for(&self, headers: &HashMap<String, String>) -> Option<String> {
        let cookie = headers.get("cookie")?;
        cookie
            .split(';')
            .filter_map(|pair| pair.trim().split_once('='))
            .filter(|(name, _)| *name == "overleaf.sid")
            .find_map(|(_, value)| {
                self.people()
                    .find(|user| user.session == value)
                    .map(|user| user.id.clone())
            })
    }

    fn folder_json(&self, folder: &Folder) -> Value {
        json!({
            "_id": folder.id,
            "name": folder.name,
            "folders": folder.folders.iter().map(|child| self.folder_json(child)).collect::<Vec<_>>(),
            "fileRefs": folder.files.iter().filter_map(|id| self.files.get(id).map(|file| json!({
                "_id": id, "name": file.name, "linkedFileData": null, "created": "2026-11-15T00:00:00.000Z", "hash": file.hash,
            }))).collect::<Vec<_>>(),
            "docs": folder.docs.iter().filter_map(|id| self.docs.get(id).map(|doc| json!({ "_id": id, "name": doc.name }))).collect::<Vec<_>>(),
        })
    }

    fn person_json(user: &MockUser, privilege: Privilege) -> Value {
        json!({
            "_id": user.id,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "privileges": privilege.wire_name(),
            "signUpDate": "2026-11-15T00:00:00.000Z",
        })
    }

    fn project_json(&self) -> Value {
        json!({
            "_id": self.project_id,
            "name": self.project_name,
            "rootDoc_id": self.root_doc,
            "rootFolder": [self.folder_json(&self.root)],
            "publicAccesLevel": "private",
            "dropboxEnabled": false,
            "compiler": self.compiler,
            "description": "",
            "spellCheckLanguage": "en",
            "deletedByExternalDataSource": false,
            "owner": State::person_json(&self.owner, Privilege::Owner),
            "members": self.members.iter().map(|(user, privilege)| State::person_json(user, *privilege)).collect::<Vec<_>>(),
            "invites": [],
            "editAccessRequests": [],
            "features": { "collaborators": -1, "versioning": true, "trackChanges": true, "compileTimeout": 180, "compileGroup": "standard" },
            "trackChangesState": self.track_changes,
        })
    }

    fn push(&mut self, sid: &str, packet: String) {
        if let Some(client) = self.clients.get_mut(sid) {
            if client.closed {
                return;
            }
            client.outbox.push_back(packet);
            client.wake.notify_one();
        }
    }

    fn live(&self) -> Vec<String> {
        self.clients
            .iter()
            .filter(|(_, client)| client.connected && !client.closed)
            .map(|(sid, _)| sid.clone())
            .collect()
    }

    fn emit_room(&mut self, name: &str, args: &[Value], except: Option<&str>) {
        for sid in self.live() {
            if Some(sid.as_str()) != except {
                self.push(&sid, frames::event(name, args));
            }
        }
    }

    fn close(&mut self, sid: &str) {
        let Some(client) = self.clients.get_mut(sid) else {
            return;
        };
        if client.closed {
            return;
        }
        client.outbox.push_back("0::".into());
        client.closed = true;
        client.wake.notify_one();
        let public_id = client.public_id.clone();
        let announce = client.connected;
        if announce {
            self.emit_room(
                "clientTracking.clientDisconnected",
                &[json!(public_id)],
                Some(sid),
            );
        }
    }

    fn handshake(
        &mut self,
        query: &HashMap<String, String>,
        headers: &HashMap<String, String>,
    ) -> Reply {
        if let Some((status, body)) = &self.config.handshake_reply {
            return Reply {
                status: *status,
                headers: Vec::new(),
                body: body.clone().into_bytes(),
            };
        }
        let wants_ping = query.get("esh").is_some_and(|value| !value.is_empty())
            && query.get("ssp").is_some_and(|value| !value.is_empty());
        let sid = format!("mocksid{:06}", self.next_client);
        let public_id = format!("P.mock{:06}", self.next_client);
        self.next_client += 1;
        let user = self.user_for(headers);
        self.clients.insert(
            sid.clone(),
            Client {
                public_id,
                user,
                project_query: query.get("projectId").cloned().unwrap_or_default(),
                transport: Transport::Pending,
                outbox: VecDeque::new(),
                wake: Arc::new(Notify::new()),
                joined: BTreeSet::new(),
                cursor: None,
                connected: false,
                closed: false,
                abrupt: false,
                wants_ping,
                pings: 0,
                connected_at: now_ms(),
            },
        );
        let transports = if self.config.websocket {
            "websocket,xhr-polling"
        } else {
            "xhr-polling"
        };
        Reply::ok(format!("{sid}:60:60:{transports}"))
    }

    fn connect(&mut self, sid: &str, transport: Transport) {
        let Some(client) = self.clients.get_mut(sid) else {
            return;
        };
        client.transport = transport;
        client.connected = true;
        client.connected_at = now_ms();
        let query = client.project_query.clone();
        let user = client.user.clone();
        let public_id = client.public_id.clone();
        self.push(sid, "1::".into());
        let well_formed = query.len() == 24 && query.bytes().all(|byte| byte.is_ascii_hexdigit());
        let rejection = if let Some(rejection) = self.config.reject_connections {
            Some(rejection)
        } else if user.is_none() {
            Some(Rejection::InvalidSession)
        } else if !well_formed {
            Some(Rejection::BadProjectId)
        } else if !self.allow(
            &format!("join:{}", user.as_deref().unwrap_or_default()),
            self.config.rate_limits.joins_per_minute,
            Duration::from_secs(60),
        ) {
            Some(Rejection::RateLimited)
        } else if query != self.project_id {
            Some(Rejection::ProjectNotFound)
        } else if self
            .privilege(user.as_deref().unwrap_or_default())
            .is_none()
        {
            Some(Rejection::NotAuthorized)
        } else {
            None
        };
        if let Some(rejection) = rejection {
            if let Some(client) = self.clients.get_mut(sid) {
                client.connected = false;
            }
            if transport == Transport::Polling
                && self.config.lose_polling_rejections
                && rejection.lost_over_polling()
            {
                self.push(sid, "7:::1+0".into());
                if let Some(client) = self.clients.get_mut(sid) {
                    client.closed = true;
                }
                return;
            }
            self.push(
                sid,
                frames::event("connectionRejected", &[rejection.payload()]),
            );
            self.close(sid);
            return;
        }
        let privilege = self
            .privilege(user.as_deref().unwrap_or_default())
            .unwrap_or(Privilege::ReadOnly);
        let response = json!({
            "publicId": public_id,
            "project": self.project_json(),
            "permissionsLevel": privilege.wire_name(),
            "protocolVersion": self.config.protocol_version,
        });
        self.push(sid, frames::event("joinProjectResponse", &[response]));
    }

    fn take_fault(&mut self, method: &str, target: &str) -> Option<Fault> {
        let at = self.faults.iter().position(|planned| {
            planned
                .method
                .as_deref()
                .is_none_or(|wanted| wanted == method)
                && target.starts_with(&planned.prefix)
        })?;
        Some(self.faults.remove(at).fault)
    }

    fn ping(&mut self, sid: &str) {
        let Some(client) = self.clients.get_mut(sid) else {
            return;
        };
        let counter = client.pings;
        client.pings += 1;
        let ping = frames::event(
            "serverPing",
            &[
                json!(counter),
                json!(now_ms() as u64),
                json!("websocket"),
                json!(sid),
            ],
        );
        self.push(sid, ping);
    }

    fn cut(&mut self, sid: &str) {
        let Some(client) = self.clients.get_mut(sid) else {
            return;
        };
        let announce = client.connected && !client.closed;
        client.abrupt = true;
        client.closed = true;
        client.wake.notify_one();
        let public_id = client.public_id.clone();
        if announce {
            self.emit_room(
                "clientTracking.clientDisconnected",
                &[json!(public_id)],
                Some(sid),
            );
        }
    }

    fn allow(&mut self, key: &str, limit: usize, window: Duration) -> bool {
        let now = tokio::time::Instant::now();
        let seen = self.counters.entry(key.to_string()).or_default();
        while seen
            .front()
            .is_some_and(|at| now.duration_since(*at) >= window)
        {
            seen.pop_front();
        }
        if seen.len() >= limit {
            return false;
        }
        seen.push_back(now);
        true
    }

    fn handle_raw(&mut self, sid: &str, raw: &str) {
        let Some(packet) = Packet::parse(raw) else {
            self.close(sid);
            return;
        };
        match packet.kind {
            0 => self.close(sid),
            5 => {
                let Some((name, args)) = packet.event() else {
                    self.close(sid);
                    return;
                };
                self.handle_event(sid, &name, args, packet.id.filter(|_| packet.wants_ack));
            }
            _ => {}
        }
    }

    fn reply(&mut self, sid: &str, id: Option<u64>, args: &[Value]) {
        if let Some(id) = id {
            self.push(sid, frames::ack(id, args));
        }
    }

    fn handle_event(&mut self, sid: &str, name: &str, args: Vec<Value>, id: Option<u64>) {
        let Some(client) = self.clients.get(sid) else {
            return;
        };
        if !client.connected || client.closed {
            return;
        }
        let public_id = client.public_id.clone();
        self.received.push(Received {
            public_id,
            name: name.to_string(),
            args: args.clone(),
        });
        match name {
            "joinDoc" => self.join_doc(sid, &args, id),
            "leaveDoc" => self.reply(sid, id, &[]),
            "applyOtUpdate" => self.apply_update(sid, &args, id),
            "clientTracking.getConnectedUsers" => {
                let users = self.connected_users();
                self.reply(sid, id, &[Value::Null, users]);
            }
            "clientTracking.updatePosition" => self.update_position(sid, &args),
            _ => {}
        }
    }

    fn connected_users(&self) -> Value {
        Value::Array(
            self.live()
                .iter()
                .filter_map(|sid| {
                    let client = &self.clients[sid];
                    let user = self.user(client.user.as_deref()?)?;
                    let mut entry = json!({
                        "last_updated_at": client.connected_at.to_string(),
                        "user_id": user.id,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "email": user.email,
                        "connected": true,
                        "client_id": client.public_id,
                        "client_age": 0.5,
                    });
                    if let Some(cursor) = &client.cursor {
                        entry["cursorData"] = cursor.clone();
                    }
                    Some(entry)
                })
                .collect(),
        )
    }

    fn update_position(&mut self, sid: &str, args: &[Value]) {
        let Some(position) = args.first().and_then(Value::as_object) else {
            self.close(sid);
            return;
        };
        if position
            .keys()
            .any(|key| !["row", "column", "doc_id"].contains(&key.as_str()))
        {
            self.close(sid);
            return;
        }
        let client = &self.clients[sid];
        if let Some(doc) = position.get("doc_id").and_then(Value::as_str) {
            if !client.joined.contains(doc) {
                return;
            }
        }
        let Some(user) = client.user.as_deref().and_then(|id| self.user(id)).cloned() else {
            return;
        };
        let mut update = Value::Object(position.clone());
        update["id"] = json!(client.public_id);
        update["user_id"] = json!(user.id);
        update["email"] = json!(user.email);
        update["name"] = json!(user.display_name());
        if let Some(client) = self.clients.get_mut(sid) {
            client.cursor = Some(Value::Object(position.clone()));
        }
        self.emit_room("clientTracking.clientUpdated", &[update], None);
    }

    fn join_doc(&mut self, sid: &str, args: &[Value], id: Option<u64>) {
        let doc_id = args
            .first()
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let (from_version, options) = match args.get(1) {
            Some(Value::Number(number)) => {
                (number.as_u64(), args.get(2).cloned().unwrap_or(json!({})))
            }
            Some(options) => (None, options.clone()),
            None => (None, json!({})),
        };
        let allowed = ["age", "supportsHistoryOT", "encodeRanges"];
        if !options
            .as_object()
            .is_some_and(|options| options.keys().all(|key| allowed.contains(&key.as_str())))
        {
            self.reply(sid, id, &[error_value("unexpected arguments")]);
            self.close(sid);
            return;
        }
        let Some(doc) = self.docs.get(&doc_id) else {
            self.reply(sid, id, &[error_value("not found")]);
            return;
        };
        if doc.format == DocFormat::HistoryOt && options["supportsHistoryOT"] != json!(true) {
            self.reply(
                sid,
                id,
                &[error_value("client does not support history-ot")],
            );
            return;
        }
        if let Some(from) = from_version {
            if from < doc.first_kept() {
                self.reply(
                    sid,
                    id,
                    &[error_value("doc updater could not load requested ops")],
                );
                return;
            }
        }
        let updates: Vec<Value> = from_version
            .map(|from| {
                doc.applied
                    .iter()
                    .filter(|applied| applied.at >= from)
                    .map(|applied| applied.update.clone())
                    .collect()
            })
            .unwrap_or_default();
        let lines = match doc.format {
            DocFormat::ShareJs => pack_lines(&doc.content),
            DocFormat::HistoryOt => {
                let mut raw = Map::new();
                raw.insert("content".into(), json!(sharejs_text::text(&doc.content)));
                let tracked = doc.tracked_changes();
                if !tracked.is_empty() {
                    raw.insert("trackedChanges".into(), Value::Array(tracked));
                }
                Value::Object(raw)
            }
        };
        let reply = [
            Value::Null,
            lines,
            json!(doc.version),
            Value::Array(updates),
            json!({}),
            json!(doc.format.wire_name()),
            json!({ "canSkipLeaveDoc": true }),
        ];
        if let Some(client) = self.clients.get_mut(sid) {
            client.joined.insert(doc_id);
        }
        self.reply(sid, id, &reply);
    }

    fn apply_update(&mut self, sid: &str, args: &[Value], id: Option<u64>) {
        let doc_id = args
            .first()
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let update = args.get(1).cloned().unwrap_or(Value::Null);
        let allowed = ["doc", "op", "v", "lastV", "hash", "dupIfSource", "meta"];
        let valid = update.as_object().is_some_and(|object| {
            object.keys().all(|key| allowed.contains(&key.as_str()))
                && object
                    .get("op")
                    .and_then(Value::as_array)
                    .is_some_and(|op| !op.is_empty())
                && object.get("v").and_then(Value::as_u64).is_some()
                && object.get("meta").is_none_or(|meta| {
                    meta.as_object()
                        .is_some_and(|meta| meta.keys().all(|key| key == "tc"))
                })
        });
        if !valid {
            self.reply(sid, id, &[error_value("unexpected arguments")]);
            self.close(sid);
            return;
        }
        let client = &self.clients[sid];
        let user_id = client.user.clone().unwrap_or_default();
        let public_id = client.public_id.clone();
        let joined = client.joined.contains(&doc_id);
        let tracked = update.pointer("/meta/tc").is_some()
            || update["op"].to_string().contains("\"tracking\"");
        let privilege = self.privilege(&user_id);
        let permitted = privilege.is_some_and(|privilege| {
            if tracked {
                privilege.can_review()
            } else {
                privilege.can_write()
            }
        });
        if !joined || !permitted {
            self.reply(sid, id, &[error_value("not authorized")]);
            self.close(sid);
            return;
        }
        self.reply(sid, id, &[]);
        let Some(doc) = self.docs.get_mut(&doc_id) else {
            self.doc_error(&doc_id, "doc not found");
            return;
        };
        if let Some(message) = doc.fail_next.take() {
            self.doc_error(&doc_id, &message);
            return;
        }
        let kept = self.config.kept_ops;
        let max_age = self.config.max_op_age;
        let applied_version = self.config.history_ot_applied_version;
        let outcome = match doc.format {
            DocFormat::ShareJs => apply_sharejs(doc, &update, &public_id, &user_id, max_age),
            DocFormat::HistoryOt => {
                apply_history_ot(doc, &update, &public_id, &user_id, applied_version)
            }
        };
        match outcome {
            Err(message) => self.doc_error(&doc_id, &message),
            Ok(Outcome::Dup { v }) => {
                self.push(
                    sid,
                    frames::event("otUpdateApplied", &[json!({ "v": v, "doc": doc_id })]),
                );
            }
            Ok(Outcome::Applied(applied)) => {
                while doc.applied.len() >= kept.max(1) {
                    doc.applied.pop_front();
                }
                doc.applied.push_back(applied.clone());
                let path = doc.name.clone();
                self.record_history(&user_id, &path);
                self.broadcast(&doc_id, sid, &applied.update);
            }
        }
    }

    fn record_history(&mut self, user_id: &str, name: &str) {
        let version = self.history.len() as u64;
        let user = self.user(user_id).cloned();
        let ts = now_ms();
        self.history.push(json!({
            "fromV": version,
            "toV": version + 1,
            "meta": {
                "users": user.map(|user| vec![json!({ "id": user.id, "first_name": user.first_name, "last_name": user.last_name, "email": user.email })]).unwrap_or_default(),
                "start_ts": ts,
                "end_ts": ts,
            },
            "labels": [],
            "pathnames": [name],
            "project_ops": [],
        }));
    }

    fn broadcast(&mut self, doc_id: &str, sender: &str, update: &Value) {
        let v = update["v"].clone();
        self.push(
            sender,
            frames::event("otUpdateApplied", &[json!({ "v": v, "doc": doc_id })]),
        );
        let legacy = self.config.legacy_doc_rooms;
        for sid in self.live() {
            if sid == sender {
                continue;
            }
            if legacy && !self.clients[&sid].joined.contains(doc_id) {
                continue;
            }
            self.push(
                &sid,
                frames::event("otUpdateApplied", std::slice::from_ref(update)),
            );
        }
    }

    fn doc_error(&mut self, doc_id: &str, message: &str) {
        self.next_id += 1;
        let details = json!({
            "project_id": self.project_id,
            "doc_id": doc_id,
            "error": message,
            "_id": format!("doc:mock:{}", self.next_id),
            "message": "otUpdateError",
        });
        for sid in self.live() {
            if self.clients[&sid].joined.contains(doc_id) {
                self.push(
                    &sid,
                    frames::event("otUpdateError", &[json!(message), details.clone()]),
                );
                self.close(&sid);
            }
        }
    }

    fn rest(
        &mut self,
        method: &str,
        path: &str,
        query: &HashMap<String, String>,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> Reply {
        let Some(rest) = path.strip_prefix(&format!("/project/{}", self.project_id)) else {
            return Reply::status(404);
        };
        let Some(user) = self.user_for(headers) else {
            return text_reply(401, "Unauthorized");
        };
        let writes = method != "GET";
        if writes && headers.get("x-csrf-token").map(String::as_str) != Some(MOCK_CSRF) {
            return text_reply(403, "Forbidden");
        }
        let Some(privilege) = self.privilege(&user) else {
            return json_reply(&json!({ "message": "restricted" })).with_status(403);
        };
        if writes && !privilege.can_write() {
            return json_reply(&json!({ "message": "restricted" })).with_status(403);
        }
        let limited = match (method, rest.trim_start_matches('/')) {
            ("POST", "doc") => Some((
                "doc",
                self.config.rate_limits.docs_per_minute,
                Duration::from_secs(60),
            )),
            ("POST", "folder") => Some((
                "folder",
                self.config.rate_limits.folders_per_minute,
                Duration::from_secs(60),
            )),
            ("POST", "upload") => Some((
                "upload",
                self.config.rate_limits.uploads_per_quarter_hour,
                Duration::from_secs(900),
            )),
            _ => None,
        };
        if let Some((route, limit, window)) = limited {
            if !self.allow(&format!("{route}:{user}"), limit, window) {
                let reply = Reply {
                    status: 429,
                    headers: Vec::new(),
                    body: RATE_LIMITED.as_bytes().to_vec(),
                };
                return match self.config.retry_after {
                    Some(seconds) => reply.header("Retry-After", &seconds.to_string()),
                    None => reply,
                };
            }
        }
        let json_body = || serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
        let parts: Vec<&str> = rest.trim_start_matches('/').split('/').collect();
        match (method, parts.as_slice()) {
            ("GET", [""]) => self.page(&user, query),
            ("GET", ["entities"]) => {
                let entities: Vec<Value> = self
                    .paths()
                    .into_iter()
                    .filter(|(_, kind, _)| *kind != "folder")
                    .map(|(path, kind, _)| json!({ "path": format!("/{path}"), "type": kind }))
                    .collect();
                json_reply(&json!({ "project_id": self.project_id, "entities": entities }))
            }
            ("POST", ["doc"]) => {
                let request = json_body();
                let (Some(name), Some(parent)) = (
                    request["name"].as_str(),
                    request["parent_folder_id"].as_str(),
                ) else {
                    return Reply::status(400);
                };
                match self.add_doc(parent, name, "", &user) {
                    Some(id) => json_reply(&json!({ "_id": id, "name": name })),
                    None => Reply::status(404),
                }
            }
            ("POST", ["folder"]) => {
                let request = json_body();
                let (Some(name), Some(parent)) = (
                    request["name"].as_str(),
                    request["parent_folder_id"].as_str(),
                ) else {
                    return Reply::status(400);
                };
                let id = self.new_id();
                let Some(folder) = self.root.find_mut(parent) else {
                    return Reply::status(404);
                };
                folder.folders.push(Folder {
                    id: id.clone(),
                    name: name.to_string(),
                    ..Folder::default()
                });
                let created =
                    json!({ "_id": id, "name": name, "docs": [], "fileRefs": [], "folders": [] });
                self.emit_room(
                    "reciveNewFolder",
                    &[json!(parent), created.clone(), json!(user)],
                    None,
                );
                json_reply(&created)
            }
            ("POST", ["upload"]) => {
                let folder = query
                    .get("folder_id")
                    .cloned()
                    .unwrap_or_else(|| self.root.id.clone());
                let Some((name, bytes)) = multipart_file(
                    headers
                        .get("content-type")
                        .map(String::as_str)
                        .unwrap_or_default(),
                    body,
                ) else {
                    return Reply::status(400);
                };
                let text = String::from_utf8(bytes.clone()).ok().filter(|text| {
                    let extension = name
                        .rsplit('.')
                        .next()
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    TEXT_EXTENSIONS.contains(&extension.as_str())
                        && !text.contains('\0')
                        && text.chars().all(|character| (character as u32) < 0x10000)
                        && bytes.len() <= MAX_DOC_LENGTH
                });
                match text {
                    Some(text) => match self.add_doc(&folder, &name, &text, &user) {
                        Some(id) => json_reply(
                            &json!({ "success": true, "entity_id": id, "entity_type": "doc" }),
                        ),
                        None => Reply::status(404),
                    },
                    None => {
                        let id = self.new_id();
                        let hash = git_blob_hash(&bytes);
                        let Some(target) = self.root.find_mut(&folder) else {
                            return Reply::status(404);
                        };
                        target.files.push(id.clone());
                        self.files.insert(
                            id.clone(),
                            Blob {
                                name: name.clone(),
                                bytes,
                                hash: hash.clone(),
                            },
                        );
                        let file = json!({ "_id": id, "name": name, "linkedFileData": null, "created": "2026-11-15T00:00:00.000Z", "hash": hash });
                        self.emit_room(
                            "reciveNewFile",
                            &[
                                json!(folder),
                                file,
                                json!("upload"),
                                Value::Null,
                                json!(user),
                            ],
                            None,
                        );
                        json_reply(
                            &json!({ "success": true, "entity_id": id, "entity_type": "file", "hash": hash }),
                        )
                    }
                }
            }
            ("GET", ["blob", hash]) => match self.files.values().find(|file| file.hash == *hash) {
                Some(file) => Reply::ok(file.bytes.clone()),
                None => Reply::status(404),
            },
            ("GET", ["file", id]) => match self.files.get(*id) {
                Some(file) => Reply::ok(file.bytes.clone()),
                None => Reply::status(404),
            },
            ("POST", [_, id, "rename"]) => {
                let Some(name) = json_body()["name"].as_str().map(str::to_string) else {
                    return Reply::status(400);
                };
                let renamed = if let Some(doc) = self.docs.get_mut(*id) {
                    doc.name = name.clone();
                    true
                } else if let Some(file) = self.files.get_mut(*id) {
                    file.name = name.clone();
                    true
                } else {
                    self.root.rename(id, &name)
                };
                if !renamed {
                    return Reply::status(404);
                }
                self.emit_room("reciveEntityRename", &[json!(id), json!(name)], None);
                Reply::status(204)
            }
            ("POST", [_, id, "move"]) => {
                let Some(target) = json_body()["folder_id"].as_str().map(str::to_string) else {
                    return Reply::status(400);
                };
                let id = id.to_string();
                let Some(detached) = self.root.detach(&id) else {
                    return Reply::status(404);
                };
                let is_doc = self.docs.contains_key(&id);
                let Some(folder) = self.root.find_mut(&target) else {
                    return Reply::status(404);
                };
                match detached {
                    Some(moved) => folder.folders.push(moved),
                    None if is_doc => folder.docs.push(id.clone()),
                    None => folder.files.push(id.clone()),
                }
                self.emit_room("reciveEntityMove", &[json!(id), json!(target)], None);
                Reply::status(204)
            }
            ("DELETE", [_, id]) => {
                let id = id.to_string();
                let Some(detached) = self.root.detach(&id) else {
                    return Reply::status(404);
                };
                let mut gone = vec![id.clone()];
                if let Some(folder) = detached {
                    gone.extend(folder.ids());
                }
                for entity in &gone {
                    self.docs.remove(entity);
                    self.files.remove(entity);
                }
                self.emit_room("removeEntity", &[json!(id), json!("editor")], None);
                Reply::status(204)
            }
            ("GET", ["updates"]) => {
                if self.config.history_status != 200 {
                    return Reply::status(self.config.history_status);
                }
                let updates: Vec<Value> = self.history.iter().rev().cloned().collect();
                json_reply(&json!({ "updates": updates }))
            }
            ("GET", ["filetree", "diff"]) => {
                if self.config.history_status != 200 {
                    return Reply::status(self.config.history_status);
                }
                let from: u64 = query
                    .get("from")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                let to: u64 = query
                    .get("to")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(self.history.len() as u64);
                let edited: BTreeSet<String> = self
                    .history
                    .iter()
                    .filter(|entry| {
                        entry["fromV"].as_u64().unwrap_or_default() >= from
                            && entry["toV"].as_u64().unwrap_or_default() <= to
                    })
                    .flat_map(|entry| entry["pathnames"].as_array().cloned().unwrap_or_default())
                    .filter_map(|name| name.as_str().map(str::to_string))
                    .collect();
                let diff: Vec<Value> = self
                    .paths()
                    .into_iter()
                    .filter(|(_, kind, _)| *kind != "folder")
                    .map(|(path, kind, _)| {
                        let name = path.rsplit('/').next().unwrap_or_default().to_string();
                        if edited.contains(&name) {
                            json!({ "pathname": path, "operation": "edited" })
                        } else {
                            json!({ "pathname": path, "editable": kind == "doc" })
                        }
                    })
                    .collect();
                json_reply(&json!({ "diff": diff }))
            }
            ("GET", ["threads"]) => match self.config.threads_status {
                200 => json_reply(&json!({})),
                status => Reply::status(status),
            },
            ("GET", ["messages"]) => match self.config.messages_status {
                200 => json_reply(&json!([])),
                status => Reply::status(status),
            },
            ("GET", ["members"]) => json_reply(&json!({
                "members": self.members.iter().map(|(user, privilege)| State::person_json(user, *privilege)).collect::<Vec<_>>(),
            })),
            _ => Reply::status(404),
        }
    }

    fn add_doc(&mut self, folder: &str, name: &str, text: &str, user: &str) -> Option<String> {
        let id = self.new_id();
        self.root.find_mut(folder)?.docs.push(id.clone());
        self.docs
            .insert(id.clone(), Doc::new(name, text, self.format));
        self.emit_room(
            "reciveNewDoc",
            &[
                json!(folder),
                json!({ "_id": id, "name": name }),
                json!("editor"),
                json!(user),
            ],
            None,
        );
        Some(id)
    }

    fn page(&self, user: &str, query: &HashMap<String, String>) -> Reply {
        let fallback = query.get("ws").map(String::as_str) == Some("fallback");
        let mut metas = vec![
            ("ol-csrfToken", "", MOCK_CSRF.to_string()),
            ("ol-user_id", "", user.to_string()),
            ("ol-project_id", "", self.project_id.clone()),
            ("ol-maxDocLength", "json", MAX_DOC_LENGTH.to_string()),
            ("ol-wsRetryHandshake", "json", "5".to_string()),
            ("ol-useShareJsHash", "boolean", String::new()),
            (
                "ol-otMigrationStage",
                "json",
                if self.format == DocFormat::HistoryOt {
                    "1"
                } else {
                    "0"
                }
                .to_string(),
            ),
        ];
        if !fallback {
            metas.push((
                "ol-wsUrl",
                "",
                self.config.ws_url.clone().unwrap_or_default(),
            ));
        }
        if let Some(interval) = self.config.max_reconnect_gracefully_ms {
            metas.push((
                "ol-maxReconnectGracefullyIntervalMs",
                "json",
                interval.to_string(),
            ));
        }
        let tags: String = metas
            .iter()
            .map(|(name, kind, content)| {
                let kind = if kind.is_empty() {
                    String::new()
                } else {
                    format!(" data-type=\"{kind}\"")
                };
                format!(
                    "<meta name=\"{name}\"{kind} content=\"{}\">",
                    super::escape(content)
                )
            })
            .collect();
        Reply::ok(format!(
            "<!DOCTYPE html><html><head>{tags}</head><body></body></html>"
        ))
        .header("Content-Type", "text/html; charset=utf-8")
    }
}

fn json_reply(value: &Value) -> Reply {
    Reply::ok(value.to_string()).header("Content-Type", "application/json; charset=utf-8")
}

fn text_reply(status: u16, text: &str) -> Reply {
    Reply::ok(text)
        .with_status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
}

trait WithStatus {
    fn with_status(self, status: u16) -> Self;
}

impl WithStatus for Reply {
    fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| at + from)
}

fn multipart_file(content_type: &str, body: &[u8]) -> Option<(String, Vec<u8>)> {
    let boundary = content_type.split("boundary=").nth(1)?.trim_matches('"');
    let marker = format!("--{boundary}");
    let mut at = find(body, marker.as_bytes(), 0)?;
    loop {
        let start = at + marker.len();
        let head_end = find(body, b"\r\n\r\n", start)?;
        let head = String::from_utf8_lossy(&body[start..head_end]).to_string();
        let next = find(body, marker.as_bytes(), head_end)?;
        if head.contains("name=\"qqfile\"") {
            let name = head
                .split("filename=\"")
                .nth(1)?
                .split('"')
                .next()?
                .to_string();
            let end = next.saturating_sub(2).max(head_end + 4);
            return Some((name, body[head_end + 4..end].to_vec()));
        }
        at = next;
    }
}

fn sanitize(units: &mut [u16]) {
    for unit in units {
        if (0xD800..=0xDFFF).contains(unit) {
            *unit = 0xFFFD;
        }
    }
}

enum Outcome {
    Applied(Applied),
    Dup { v: u64 },
}

fn duplicate(doc: &Doc, update: &Value, from: u64) -> Option<u64> {
    let sources: Vec<&str> = update["dupIfSource"]
        .as_array()
        .map(|sources| sources.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    doc.applied
        .iter()
        .filter(|applied| applied.at >= from)
        .find(|applied| sources.contains(&applied.source.as_str()))
        .map(|applied| applied.at)
}

fn broadcast_update(update: &Value, op: Value, v: u64, source: &str, user_id: &str) -> Value {
    let mut meta = json!({ "source": source, "user_id": user_id, "ts": now_ms() as u64 });
    if let Some(tc) = update.pointer("/meta/tc") {
        meta["tc"] = tc.clone();
    }
    let mut out = json!({ "doc": update["doc"], "op": op, "v": v, "meta": meta });
    for key in ["lastV", "hash"] {
        if let Some(value) = update.get(key) {
            out[key] = value.clone();
        }
    }
    out
}

fn apply_sharejs(
    doc: &mut Doc,
    update: &Value,
    source: &str,
    user_id: &str,
    max_age: u64,
) -> Result<Outcome, String> {
    let v = update["v"].as_u64().unwrap_or_default();
    if v > doc.version {
        return Err("Op at future version".into());
    }
    if doc.version - v > max_age || v < doc.first_kept() {
        return Err("Op too old".into());
    }
    let mut op = sharejs_text::op_from_json(&update["op"]).map_err(|error| error.0)?;
    if let Some(at) = duplicate(doc, update, v) {
        return Ok(Outcome::Dup { v: at });
    }
    for applied in doc.applied.iter().filter(|applied| applied.at >= v) {
        let concurrent =
            sharejs_text::op_from_json(&applied.update["op"]).map_err(|error| error.0)?;
        op = sharejs_text::transform(&op, &concurrent, Side::Left).map_err(|error| error.0)?;
    }
    for component in &mut op {
        if let Component::Insert { i, .. } = component {
            sanitize(i);
        }
    }
    let mut content = doc.content.clone();
    sharejs_text::apply_units(&mut content, &op).map_err(|error| error.0)?;
    if content.len() > MAX_DOC_LENGTH {
        return Err("Update takes doc over max doc size".into());
    }
    if let Some(hash) = update["hash"].as_str() {
        if blob_hash(&sharejs_text::text(&content)) != hash {
            return Err("Invalid hash".into());
        }
    }
    let at = doc.version;
    doc.tracked = vec![None; content.len()];
    doc.content = content;
    doc.version += 1;
    Ok(Outcome::Applied(Applied {
        at,
        source: source.to_string(),
        update: broadcast_update(update, sharejs_text::op_to_json(&op), at, source, user_id),
    }))
}

fn text_operations(op: &Value) -> Result<Vec<Option<TextOperation>>, String> {
    op.as_array()
        .ok_or("history-ot op is not an array")?
        .iter()
        .map(|edit| match edit.get("textOperation") {
            Some(text) => TextOperation::from_json(text)
                .map(Some)
                .map_err(|error| error.0),
            None if edit.is_object() => Ok(None),
            None => Err("unknown history-ot edit".to_string()),
        })
        .collect()
}

fn apply_history_ot(
    doc: &mut Doc,
    update: &Value,
    source: &str,
    user_id: &str,
    applied_version: bool,
) -> Result<Outcome, String> {
    let v = update["v"].as_u64().unwrap_or_default();
    if v > doc.version {
        return Err("Op at future version".into());
    }
    if v < doc.first_kept() {
        return Err("Op too old".into());
    }
    if let Some(at) = duplicate(doc, update, v) {
        return Ok(Outcome::Dup {
            v: if applied_version { at } else { v },
        });
    }
    let mut ours = text_operations(&update["op"])?;
    for applied in doc.applied.iter().filter(|applied| applied.at >= v) {
        let mut theirs: Vec<TextOperation> = text_operations(&applied.update["op"])?
            .into_iter()
            .flatten()
            .collect();
        for own in ours.iter_mut().flatten() {
            for their in theirs.iter_mut() {
                let (own_after, their_after) =
                    TextOperation::transform(own, their).map_err(|error| error.0)?;
                *own = own_after;
                *their = their_after;
            }
        }
    }
    let (mut content, mut tracked) = (doc.content.clone(), doc.tracked.clone());
    for operation in ours.iter_mut().flatten() {
        for part in &mut operation.parts {
            if let Part::Insert { text, .. } = part {
                sanitize(text);
            }
        }
        (content, tracked) = operation
            .apply(&content, &tracked)
            .map_err(|error| error.0)?;
    }
    let edits: Vec<Value> = update["op"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&ours)
        .map(|(edit, operation)| match operation {
            Some(operation) => {
                let mut edit = edit.clone();
                edit["textOperation"] = operation.to_json();
                edit
            }
            None => edit.clone(),
        })
        .collect();
    let at = doc.version;
    doc.content = content;
    doc.tracked = tracked;
    doc.version += 1;
    let reported = if applied_version { at } else { v };
    Ok(Outcome::Applied(Applied {
        at,
        source: source.to_string(),
        update: broadcast_update(update, Value::Array(edits), reported, source, user_id),
    }))
}

#[derive(Clone)]
pub struct MockOverleaf {
    pub base: String,
    shared: Arc<Mutex<State>>,
}

fn split_target(target: &str) -> (String, HashMap<String, String>) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    (path.to_string(), query)
}

async fn write_reply(stream: &mut TcpStream, reply: Reply) {
    let mut head = format!(
        "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n",
        reply.status,
        reply.body.len()
    );
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(&reply.body).await;
}

impl MockOverleaf {
    pub async fn start(project: MockProject) -> MockOverleaf {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let shared = Arc::new(Mutex::new(State::new(project)));
        let weak = Arc::downgrade(&shared);
        let accept_base = base.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let Some(shared) = weak.upgrade() else {
                    return;
                };
                let mock = MockOverleaf {
                    base: accept_base.clone(),
                    shared,
                };
                tokio::spawn(async move { mock.serve(stream).await });
            }
        });
        tokio::spawn(heartbeats(Arc::downgrade(&shared)));
        tokio::spawn(server_pings(Arc::downgrade(&shared)));
        MockOverleaf { base, shared }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    async fn serve(self, mut stream: TcpStream) {
        let Some((method, target, headers, body)) = read_message(&mut stream).await else {
            return;
        };
        let (path, query) = split_target(&target);
        if let Some(sid) = path.strip_prefix("/socket.io/1/websocket/") {
            if headers
                .get("upgrade")
                .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            {
                let key = headers
                    .get("sec-websocket-key")
                    .cloned()
                    .unwrap_or_default();
                self.websocket(stream, sid.to_string(), key).await;
                return;
            }
        }
        let (reply, fault) = if let Some(sid) = path.strip_prefix("/socket.io/1/xhr-polling/") {
            let reply = if method == "GET" {
                self.poll(sid).await
            } else {
                self.post(sid, &body)
            };
            (reply, None)
        } else {
            let mut state = self.state();
            state.requests.push(Request {
                method: method.clone(),
                path: target.clone(),
                headers: headers.clone(),
                body: String::from_utf8_lossy(&body).to_string(),
            });
            let fault = state.take_fault(&method, &target);
            let reply = if state.down {
                text_reply(503, "Service Unavailable")
            } else if let Some(Fault::Reply(status, text)) = &fault {
                let reply = text_reply(*status, text);
                match (status, state.config.retry_after) {
                    (429, Some(seconds)) => reply.header("Retry-After", &seconds.to_string()),
                    _ => reply,
                }
            } else if path == "/socket.io/socket.io.js" {
                Reply::ok("js").header("Set-Cookie", "GCLB=mock-affinity; Path=/")
            } else if path == "/socket.io/1/" || path == "/socket.io/1" {
                state.handshake(&query, &headers)
            } else {
                state.rest(&method, &path, &query, &headers, &body)
            };
            (reply, fault)
        };
        match fault {
            Some(Fault::LoseReply) => return,
            Some(Fault::Delay(delay)) => tokio::time::sleep(delay).await,
            _ => {}
        }
        write_reply(&mut stream, reply).await;
    }

    fn post(&self, sid: &str, body: &[u8]) -> Reply {
        let mut state = self.state();
        if state.down {
            return text_reply(503, "Service Unavailable");
        }
        if !state.clients.contains_key(sid) {
            return Reply::ok(NOT_HANDSHAKEN);
        }
        for packet in crate::socket::decode_payload(&String::from_utf8_lossy(body)) {
            state.handle_raw(sid, &packet);
        }
        Reply::ok("1")
    }

    async fn websocket(self, mut stream: TcpStream, sid: String, key: String) {
        let wake = {
            let state = self.state();
            state
                .clients
                .get(&sid)
                .filter(|client| {
                    state.config.websocket && !state.down && client.transport == Transport::Pending
                })
                .map(|client| client.wake.clone())
        };
        let Some(wake) = wake else {
            write_reply(&mut stream, Reply::status(503)).await;
            return;
        };
        let accept = derive_accept_key(key.as_bytes());
        let response = format!(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
        );
        if stream.write_all(response.as_bytes()).await.is_err() {
            return;
        }
        let mut socket = WebSocketStream::from_raw_socket(stream, Role::Server, None).await;
        self.state().connect(&sid, Transport::WebSocket);
        loop {
            let (outgoing, closed, abrupt) = {
                let mut state = self.state();
                let stalled = state.stalled;
                match state.clients.get_mut(&sid) {
                    Some(client) if client.abrupt => (Vec::new(), true, true),
                    Some(_) if stalled => (Vec::new(), false, false),
                    Some(client) => (
                        client.outbox.drain(..).collect::<Vec<_>>(),
                        client.closed,
                        false,
                    ),
                    None => (Vec::new(), true, true),
                }
            };
            if abrupt {
                drop(socket);
                break;
            }
            let mut gone = false;
            for packet in outgoing {
                if socket.send(Message::text(packet)).await.is_err() {
                    gone = true;
                    break;
                }
            }
            if closed || gone {
                let _ = socket.close(None).await;
                break;
            }
            tokio::select! {
                message = socket.next() => match message {
                    Some(Ok(Message::Text(text))) => self.state().handle_raw(&sid, text.as_str()),
                    Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Binary(_) | Message::Frame(_))) => {}
                    Some(Ok(Message::Close(_)) | Err(_)) | None => {
                        self.state().close(&sid);
                        break;
                    }
                },
                _ = wake.notified() => {}
            }
        }
        self.state().clients.remove(&sid);
    }

    async fn poll(&self, sid: &str) -> Reply {
        let (wake, hold) = {
            let mut state = self.state();
            if state.down {
                return text_reply(503, "Service Unavailable");
            }
            let hold = state.config.poll_hold;
            let Some(client) = state.clients.get(sid) else {
                return Reply::ok(NOT_HANDSHAKEN);
            };
            if client.transport == Transport::Pending {
                state.connect(sid, Transport::Polling);
            }
            (state.clients[sid].wake.clone(), hold)
        };
        let mut waited = false;
        loop {
            {
                let mut state = self.state();
                let stalled = state.stalled;
                let Some(client) = state.clients.get_mut(sid) else {
                    return Reply::ok(NOT_HANDSHAKEN);
                };
                if client.abrupt {
                    state.clients.remove(sid);
                    return Reply::ok(NOT_HANDSHAKEN);
                }
                if !stalled && !client.outbox.is_empty() {
                    let packets: Vec<String> = client.outbox.drain(..).collect();
                    if client.closed {
                        state.clients.remove(sid);
                    }
                    return Reply::ok(frames::payload(&packets));
                }
                if client.closed && !stalled {
                    state.clients.remove(sid);
                    return Reply::ok(NOT_HANDSHAKEN);
                }
                if waited {
                    return Reply::ok("8::");
                }
            }
            let _ = tokio::time::timeout(hold, wake.notified()).await;
            waited = true;
        }
    }

    pub fn project_id(&self) -> String {
        self.state().project_id.clone()
    }

    pub fn project_page_url(&self) -> String {
        format!("{}/project/{}", self.base, self.project_id())
    }

    pub fn root_folder_id(&self) -> String {
        self.state().root.id.clone()
    }

    pub fn entity_id(&self, path: &str) -> Option<String> {
        self.state().id_for_path(path)
    }

    pub fn doc_id(&self, path: &str) -> String {
        self.entity_id(path)
            .unwrap_or_else(|| panic!("the mock has no {path}"))
    }

    pub fn user(&self, name: &str) -> MockUser {
        let state = self.state();
        let found = state
            .people()
            .find(|user| user.email.starts_with(&format!("{name}@")) || user.id == name)
            .cloned();
        found.unwrap_or_else(|| panic!("the mock has no user {name}"))
    }

    pub fn configure(&self, change: impl FnOnce(&mut MockConfig)) {
        change(&mut self.state().config);
    }

    pub fn doc_text(&self, doc_id: &str) -> String {
        sharejs_text::text(&self.state().docs[doc_id].visible())
    }

    pub fn raw_doc(&self, doc_id: &str) -> Value {
        let state = self.state();
        let doc = &state.docs[doc_id];
        json!({ "content": sharejs_text::text(&doc.content), "trackedChanges": doc.tracked_changes() })
    }

    pub fn doc_version(&self, doc_id: &str) -> u64 {
        self.state().docs[doc_id].version
    }

    pub fn set_doc_format(&self, doc_id: &str, format: DocFormat) {
        let mut state = self.state();
        let doc = state.docs.get_mut(doc_id).unwrap();
        let visible = doc.visible();
        doc.format = format;
        doc.tracked = vec![None; visible.len()];
        doc.content = visible;
        doc.applied.clear();
    }

    pub fn connections(&self) -> Vec<Connection> {
        let state = self.state();
        state
            .live()
            .iter()
            .map(|sid| {
                let client = &state.clients[sid];
                Connection {
                    public_id: client.public_id.clone(),
                    user_id: client.user.clone(),
                    transport: client.transport,
                    joined: client.joined.iter().cloned().collect(),
                }
            })
            .collect()
    }

    pub fn received(&self, name: &str) -> Vec<Received> {
        self.state()
            .received
            .iter()
            .filter(|received| received.name == name)
            .cloned()
            .collect()
    }

    pub fn requests(&self, prefix: &str) -> Vec<Request> {
        self.state()
            .requests
            .iter()
            .filter(|request| request.path.starts_with(prefix))
            .cloned()
            .collect()
    }

    pub fn server_ping(&self) {
        let mut state = self.state();
        for sid in state.live() {
            if state.clients[&sid].transport == Transport::WebSocket {
                state.ping(&sid);
            }
        }
    }

    pub fn emit_to_room(&self, name: &str, args: &[Value]) {
        self.state().emit_room(name, args, None);
    }

    pub fn reconnect_gracefully(&self) {
        self.emit_to_room("reconnectGracefully", &[]);
    }

    pub fn force_disconnect(&self, message: &str, delay_seconds: u64) {
        self.emit_to_room("forceDisconnect", &[json!(message), json!(delay_seconds)]);
    }

    fn sid_of(state: &State, public_id: &str) -> Option<String> {
        state
            .clients
            .iter()
            .find(|(_, client)| client.public_id == public_id)
            .map(|(sid, _)| sid.clone())
    }

    pub fn disconnect(&self, public_id: &str) {
        let mut state = self.state();
        if let Some(sid) = MockOverleaf::sid_of(&state, public_id) {
            state.close(&sid);
        }
    }

    pub fn drop_client(&self, public_id: &str) {
        let mut state = self.state();
        if let Some(sid) = MockOverleaf::sid_of(&state, public_id) {
            state.cut(&sid);
        }
    }

    pub fn send_raw(&self, public_id: &str, raw: &str) {
        let mut state = self.state();
        if let Some(sid) = MockOverleaf::sid_of(&state, public_id) {
            state.push(&sid, raw.to_string());
        }
    }

    pub fn stall(&self) {
        self.state().stalled = true;
    }

    pub fn resume(&self) {
        let mut state = self.state();
        state.stalled = false;
        for client in state.clients.values() {
            client.wake.notify_one();
        }
    }

    pub fn crash(&self) {
        let mut state = self.state();
        state.down = true;
        for client in state.clients.values_mut() {
            client.abrupt = true;
            client.closed = true;
            client.wake.notify_one();
        }
    }

    pub fn recover(&self) {
        self.state().down = false;
    }

    pub fn plan_fault(&self, method: Option<&str>, prefix: &str, fault: Fault) {
        self.state().faults.push(PlannedFault {
            method: method.map(str::to_string),
            prefix: prefix.to_string(),
            fault,
        });
    }

    pub fn fail_next_update(&self, doc_id: &str, message: &str) {
        self.state().docs.get_mut(doc_id).unwrap().fail_next = Some(message.to_string());
    }

    pub fn doc_error(&self, doc_id: &str, message: &str) {
        self.state().doc_error(doc_id, message);
    }

    pub fn peer(&self, name: &str) -> MockPeer {
        let user = self.user(name);
        let project_id = self.project_id();
        let mut state = self.state();
        let mut headers = HashMap::new();
        headers.insert("cookie".to_string(), user.cookie());
        let mut query = HashMap::new();
        query.insert("projectId".to_string(), project_id);
        let reply = state.handshake(&query, &headers);
        let sid = String::from_utf8_lossy(&reply.body)
            .split(':')
            .next()
            .unwrap_or_default()
            .to_string();
        state.connect(&sid, Transport::Peer);
        let public_id = state.clients[&sid].public_id.clone();
        drop(state);
        let mut peer = MockPeer {
            mock: self.clone(),
            sid,
            public_id,
            user,
            docs: HashMap::new(),
            acks: HashMap::new(),
            events: Vec::new(),
            next_ack: 1,
            held: false,
            connected: true,
        };
        peer.sync();
        peer
    }
}

async fn server_pings(shared: Weak<Mutex<State>>) {
    loop {
        let interval = {
            let Some(shared) = shared.upgrade() else {
                return;
            };
            let state = shared
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.config.server_ping
        };
        tokio::time::sleep(interval.unwrap_or(Duration::from_secs(1))).await;
        if interval.is_none() {
            continue;
        }
        let Some(shared) = shared.upgrade() else {
            return;
        };
        let mut state = shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for sid in state.live() {
            let client = &state.clients[&sid];
            if client.transport == Transport::WebSocket && client.wants_ping {
                state.ping(&sid);
            }
        }
    }
}

async fn heartbeats(shared: Weak<Mutex<State>>) {
    loop {
        let interval = {
            let Some(shared) = shared.upgrade() else {
                return;
            };
            let state = shared
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.config.heartbeat
        };
        tokio::time::sleep(interval.unwrap_or(Duration::from_secs(1))).await;
        if interval.is_none() {
            continue;
        }
        let Some(shared) = shared.upgrade() else {
            return;
        };
        let mut state = shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for sid in state.live() {
            if state.clients[&sid].transport != Transport::Peer {
                state.push(&sid, "2::".into());
            }
        }
    }
}

#[derive(Clone, Debug)]
enum PeerOp {
    ShareJs(sharejs_text::Op),
    HistoryOt(TextOperation),
}

#[derive(Clone, Debug)]
struct PeerDoc {
    format: DocFormat,
    content: Vec<u16>,
    tracked: Vec<Option<Value>>,
    version: u64,
    inflight: Option<(PeerOp, bool)>,
    pending: VecDeque<(PeerOp, bool)>,
}

impl PeerDoc {
    fn apply(&mut self, op: &PeerOp) {
        match op {
            PeerOp::ShareJs(op) => {
                sharejs_text::apply_units(&mut self.content, op).unwrap();
                self.tracked = vec![None; self.content.len()];
            }
            PeerOp::HistoryOt(op) => {
                (self.content, self.tracked) = op.apply(&self.content, &self.tracked).unwrap();
            }
        }
    }

    fn raw_index(&self, visible: usize) -> usize {
        let mut seen = 0;
        for (at, mark) in self.tracked.iter().enumerate() {
            if seen == visible {
                return at;
            }
            if !is_deleted(mark) {
                seen += 1;
            }
        }
        self.content.len()
    }

    fn visible_text(&self) -> String {
        let kept: Vec<u16> = self
            .content
            .iter()
            .zip(&self.tracked)
            .filter(|(_, mark)| !is_deleted(mark))
            .map(|(unit, _)| *unit)
            .collect();
        sharejs_text::text(&kept)
    }
}

pub struct MockPeer {
    mock: MockOverleaf,
    sid: String,
    pub public_id: String,
    pub user: MockUser,
    docs: HashMap<String, PeerDoc>,
    acks: HashMap<u64, Vec<Value>>,
    events: Vec<(String, Vec<Value>)>,
    next_ack: u64,
    held: bool,
    connected: bool,
}

fn transform_against(own: &PeerOp, remote: &PeerOp) -> (PeerOp, PeerOp) {
    match (own, remote) {
        (PeerOp::ShareJs(own), PeerOp::ShareJs(remote)) => {
            let (own, remote) = sharejs_text::transform_x(own, remote).unwrap();
            (PeerOp::ShareJs(own), PeerOp::ShareJs(remote))
        }
        (PeerOp::HistoryOt(own), PeerOp::HistoryOt(remote)) => {
            let (own, remote) = TextOperation::transform(own, remote).unwrap();
            (PeerOp::HistoryOt(own), PeerOp::HistoryOt(remote))
        }
        _ => panic!("a peer mixed document formats"),
    }
}

impl MockPeer {
    pub fn is_connected(&mut self) -> bool {
        self.sync();
        self.connected
    }

    pub fn sync(&mut self) {
        let packets: Vec<String> = {
            let mut state = self.mock.state();
            match state.clients.get_mut(&self.sid) {
                Some(client) if client.abrupt => {
                    state.clients.remove(&self.sid);
                    self.connected = false;
                    Vec::new()
                }
                Some(client) => client.outbox.drain(..).collect(),
                None => {
                    self.connected = false;
                    Vec::new()
                }
            }
        };
        for raw in packets {
            let Some(packet) = Packet::parse(&raw) else {
                continue;
            };
            if packet.kind == 0 {
                self.connected = false;
                self.mock.state().clients.remove(&self.sid);
                continue;
            }
            if let Some((id, args)) = packet.ack() {
                self.acks.insert(id, args);
                continue;
            }
            let Some((name, args)) = packet.event() else {
                continue;
            };
            if name == "otUpdateApplied" {
                if let Some(update) = args.first() {
                    self.on_applied(update);
                }
            }
            self.events.push((name, args));
        }
        self.flush_all();
    }

    fn on_applied(&mut self, update: &Value) {
        let Some(doc_id) = update["doc"].as_str() else {
            return;
        };
        let Some(doc) = self.docs.get_mut(doc_id) else {
            return;
        };
        if update.get("op").is_none() {
            doc.inflight = None;
            doc.version += 1;
            return;
        }
        let mut remote = match doc.format {
            DocFormat::ShareJs => {
                PeerOp::ShareJs(sharejs_text::op_from_json(&update["op"]).unwrap())
            }
            DocFormat::HistoryOt => {
                let operations: Vec<TextOperation> = text_operations(&update["op"])
                    .unwrap()
                    .into_iter()
                    .flatten()
                    .collect();
                let Some(first) = operations.into_iter().next() else {
                    doc.version += 1;
                    return;
                };
                PeerOp::HistoryOt(first)
            }
        };
        if let Some((own, tracked)) = doc.inflight.take() {
            let (own, after) = transform_against(&own, &remote);
            doc.inflight = Some((own, tracked));
            remote = after;
        }
        for (own, _) in doc.pending.iter_mut() {
            let (own_after, after) = transform_against(own, &remote);
            *own = own_after;
            remote = after;
        }
        doc.apply(&remote);
        doc.version += 1;
    }

    fn call(&mut self, name: &str, args: Vec<Value>) -> Option<Vec<Value>> {
        let id = self.next_ack;
        self.next_ack += 1;
        self.mock
            .state()
            .handle_event(&self.sid, name, args, Some(id));
        self.sync();
        self.acks.remove(&id)
    }

    pub fn join(&mut self, doc_id: &str) -> String {
        let reply = self
            .call(
                "joinDoc",
                vec![
                    json!(doc_id),
                    json!({ "encodeRanges": true, "supportsHistoryOT": true }),
                ],
            )
            .expect("joinDoc got no reply");
        assert!(reply[0].is_null(), "joinDoc failed: {:?}", reply[0]);
        let format = if reply[5] == "history-ot" {
            DocFormat::HistoryOt
        } else {
            DocFormat::ShareJs
        };
        let (content, tracked) = match format {
            DocFormat::ShareJs => {
                let text = super::overleaf_rt::unpack_lines(reply[1].as_array().unwrap());
                let units = sharejs_text::units(&text);
                let tracked = vec![None; units.len()];
                (units, tracked)
            }
            DocFormat::HistoryOt => {
                let units = sharejs_text::units(reply[1]["content"].as_str().unwrap_or_default());
                let mut tracked = vec![None; units.len()];
                for change in reply[1]["trackedChanges"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                {
                    let pos = change["range"]["pos"].as_u64().unwrap_or_default() as usize;
                    let length = change["range"]["length"].as_u64().unwrap_or_default() as usize;
                    for mark in tracked.iter_mut().skip(pos).take(length) {
                        *mark = Some(change["tracking"].clone());
                    }
                }
                (units, tracked)
            }
        };
        let doc = PeerDoc {
            format,
            content,
            tracked,
            version: reply[2].as_u64().unwrap_or_default(),
            inflight: None,
            pending: VecDeque::new(),
        };
        let text = doc.visible_text();
        self.docs.insert(doc_id.to_string(), doc);
        text
    }

    pub fn text(&mut self, doc_id: &str) -> String {
        self.sync();
        self.docs[doc_id].visible_text()
    }

    pub fn version(&mut self, doc_id: &str) -> u64 {
        self.sync();
        self.docs[doc_id].version
    }

    pub fn hold(&mut self) {
        self.held = true;
    }

    pub fn release(&mut self) {
        self.held = false;
        self.flush_all();
        self.sync();
    }

    fn local(&mut self, doc_id: &str, op: PeerOp, tracked: bool) {
        self.sync();
        let doc = self.docs.get_mut(doc_id).expect("join the doc first");
        doc.apply(&op);
        doc.pending.push_back((op, tracked));
        self.flush_all();
    }

    fn flush_all(&mut self) {
        if self.held || !self.connected {
            return;
        }
        let ids: Vec<String> = self.docs.keys().cloned().collect();
        for doc_id in ids {
            let next = {
                let doc = self.docs.get_mut(&doc_id).unwrap();
                if doc.inflight.is_some() {
                    continue;
                }
                doc.pending
                    .retain(|(op, _)| !matches!(op, PeerOp::ShareJs(op) if op.is_empty()));
                let Some(next) = doc.pending.pop_front() else {
                    continue;
                };
                doc.inflight = Some(next.clone());
                (next, doc.version)
            };
            let ((op, tracked), version) = next;
            let mut update = json!({ "doc": doc_id, "v": version });
            match op {
                PeerOp::ShareJs(op) => {
                    update["op"] = sharejs_text::op_to_json(&op);
                    if tracked {
                        update["meta"] = json!({ "tc": "0123456789abcdef01" });
                    }
                }
                PeerOp::HistoryOt(op) => update["op"] = json!([{ "textOperation": op.to_json() }]),
            }
            let id = self.next_ack;
            self.next_ack += 1;
            self.mock.state().handle_event(
                &self.sid,
                "applyOtUpdate",
                vec![json!(doc_id), update],
                Some(id),
            );
            self.sync();
        }
    }

    pub fn type_at(&mut self, doc_id: &str, at: usize, inserted: &str) {
        self.sync();
        let doc = &self.docs[doc_id];
        let op = match doc.format {
            DocFormat::ShareJs => PeerOp::ShareJs(vec![Component::insert(at, inserted)]),
            DocFormat::HistoryOt => {
                let raw = doc.raw_index(at);
                let mut op = TextOperation::new();
                op.retain(raw)
                    .insert(inserted)
                    .retain(doc.content.len() - raw);
                PeerOp::HistoryOt(op)
            }
        };
        self.local(doc_id, op, false);
    }

    fn removal(&self, doc_id: &str, at: usize, length: usize, tracking: Option<Value>) -> PeerOp {
        let doc = &self.docs[doc_id];
        match doc.format {
            DocFormat::ShareJs => {
                let visible = sharejs_text::units(&doc.visible_text());
                PeerOp::ShareJs(vec![Component::Delete {
                    p: at,
                    d: visible[at..at + length].to_vec(),
                }])
            }
            DocFormat::HistoryOt => {
                let start = doc.raw_index(at);
                let mut op = TextOperation::new();
                op.retain(start);
                let mut left = length;
                let mut raw = start;
                while left > 0 && raw < doc.content.len() {
                    if is_deleted(&doc.tracked[raw]) {
                        op.retain(1);
                    } else {
                        match &tracking {
                            Some(tracking) => op.retain_marked(
                                1,
                                Marks {
                                    tracking: Some(tracking.clone()),
                                    comment_ids: None,
                                },
                            ),
                            None => op.delete(1),
                        };
                        left -= 1;
                    }
                    raw += 1;
                }
                op.retain(doc.content.len() - raw);
                PeerOp::HistoryOt(op)
            }
        }
    }

    pub fn delete(&mut self, doc_id: &str, at: usize, length: usize) {
        self.sync();
        let op = self.removal(doc_id, at, length, None);
        self.local(doc_id, op, false);
    }

    pub fn track_delete(&mut self, doc_id: &str, at: usize, length: usize) {
        self.sync();
        let tracking =
            json!({ "type": "delete", "userId": self.user.id, "ts": "2026-11-15T00:00:00.000Z" });
        let op = self.removal(doc_id, at, length, Some(tracking));
        self.local(doc_id, op, true);
    }

    pub fn drop_connection(&mut self) {
        let mut state = self.mock.state();
        let announce = state
            .clients
            .get(&self.sid)
            .is_some_and(|client| client.connected && !client.closed);
        if announce {
            let public_id = self.public_id.clone();
            state.clients.remove(&self.sid);
            state.emit_room(
                "clientTracking.clientDisconnected",
                &[json!(public_id)],
                None,
            );
        }
        self.connected = false;
    }

    pub fn emit(&mut self, name: &str, args: Vec<Value>) -> Option<Vec<Value>> {
        self.call(name, args)
    }

    pub fn events(&mut self, name: &str) -> Vec<Vec<Value>> {
        self.sync();
        self.events
            .iter()
            .filter(|(event, _)| event == name)
            .map(|(_, args)| args.clone())
            .collect()
    }

    pub fn take_events(&mut self, name: &str) -> Vec<Vec<Value>> {
        self.sync();
        let (taken, kept) = std::mem::take(&mut self.events)
            .into_iter()
            .partition(|(event, _)| event == name);
        self.events = kept;
        taken.into_iter().map(|(_, args)| args).collect()
    }
}

#[cfg(test)]
mod tests;
