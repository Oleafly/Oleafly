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

#[derive(Clone, Debug)]
pub struct MockConfig {
    pub legacy_doc_rooms: bool,
    pub websocket: bool,
    pub ws_url: Option<String>,
    pub handshake_reply: Option<(u16, String)>,
    pub heartbeat: Option<Duration>,
    pub poll_hold: Duration,
    pub protocol_version: u64,
    pub max_reconnect_gracefully_ms: Option<u64>,
    pub reject_connections: Option<String>,
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
            poll_hold: Duration::from_secs(5),
            protocol_version: 2,
            max_reconnect_gracefully_ms: Some(30_000),
            reject_connections: None,
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
    connected_at: u128,
}

struct State {
    config: MockConfig,
    next_id: u64,
    next_client: u64,
    ping: u64,
    project_id: String,
    project_name: String,
    owner: MockUser,
    members: Vec<(MockUser, Privilege)>,
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
}

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
            ping: 0,
            project_id: object_id(&format!("project:{}", project.name)),
            project_name: project.name.clone(),
            owner: project.owner.clone(),
            members: project.members.clone(),
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

    fn user(&self, id: &str) -> Option<&MockUser> {
        std::iter::once(&self.owner)
            .chain(self.members.iter().map(|(user, _)| user))
            .find(|user| user.id == id)
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
                std::iter::once(&self.owner)
                    .chain(self.members.iter().map(|(user, _)| user))
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
        let rejection = if let Some(reason) = self.config.reject_connections.clone() {
            Some(reason)
        } else if query.len() != 24 || !query.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            Some("missing/bad ?projectId=... query flag on handshake".to_string())
        } else if query != self.project_id {
            Some("project not found".to_string())
        } else {
            match user.as_deref() {
                None => Some("invalid session".to_string()),
                Some(user) if self.privilege(user).is_none() => Some("not authorized".to_string()),
                Some(_) => None,
            }
        };
        if let Some(reason) = rejection {
            if let Some(client) = self.clients.get_mut(sid) {
                client.connected = false;
            }
            self.push(
                sid,
                frames::event("connectionRejected", &[error_value(&reason)]),
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
            if from < doc.first_kept() || from > doc.version {
                self.reply(
                    sid,
                    id,
                    &[error_value(
                        "joinDoc: ops requested are no longer available",
                    )],
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
        let details = json!({
            "project_id": self.project_id,
            "doc_id": doc_id,
            "error": message,
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
            return Reply::status(if rest.is_empty() { 302 } else { 403 })
                .header("Location", "/login");
        };
        let Some(privilege) = self.privilege(&user) else {
            return Reply::status(403);
        };
        let writes = method != "GET";
        if writes && headers.get("x-csrf-token").map(String::as_str) != Some(MOCK_CSRF) {
            return Reply::status(403);
        }
        if writes && !privilege.can_write() {
            return Reply::status(403);
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
                json_reply(&json!({ "updates": updates, "nextBeforeTimestamp": null }))
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
                    .map(|(path, _, _)| {
                        let name = path.rsplit('/').next().unwrap_or_default().to_string();
                        if edited.contains(&name) {
                            json!({ "pathname": path, "operation": "edited" })
                        } else {
                            json!({ "pathname": path })
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
    Reply::ok(value.to_string()).header("Content-Type", "application/json")
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
        let reply = if let Some(sid) = path.strip_prefix("/socket.io/1/xhr-polling/") {
            if method == "GET" {
                self.poll(sid).await
            } else {
                let mut state = self.state();
                for packet in crate::socket::decode_payload(&String::from_utf8_lossy(&body)) {
                    state.handle_raw(sid, &packet);
                }
                Reply::ok("1")
            }
        } else {
            let mut state = self.state();
            state.requests.push(Request {
                method: method.clone(),
                path: target.clone(),
                headers: headers.clone(),
                body: String::from_utf8_lossy(&body).to_string(),
            });
            if path == "/socket.io/socket.io.js" {
                Reply::ok("js").header("Set-Cookie", "GCLB=mock-affinity; Path=/")
            } else if path == "/socket.io/1/" || path == "/socket.io/1" {
                state.handshake(&query, &headers)
            } else {
                state.rest(&method, &path, &query, &headers, &body)
            }
        };
        write_reply(&mut stream, reply).await;
    }

    async fn websocket(self, mut stream: TcpStream, sid: String, key: String) {
        let wake = {
            let state = self.state();
            state
                .clients
                .get(&sid)
                .filter(|client| state.config.websocket && client.transport == Transport::Pending)
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
            let (outgoing, closed) = {
                let mut state = self.state();
                match state.clients.get_mut(&sid) {
                    Some(client) => (client.outbox.drain(..).collect::<Vec<_>>(), client.closed),
                    None => (Vec::new(), true),
                }
            };
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
            let hold = state.config.poll_hold;
            let Some(client) = state.clients.get(sid) else {
                return Reply::status(404);
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
                let Some(client) = state.clients.get_mut(sid) else {
                    return Reply::status(404);
                };
                if !client.outbox.is_empty() {
                    let packets: Vec<String> = client.outbox.drain(..).collect();
                    if client.closed {
                        state.clients.remove(sid);
                    }
                    return Reply::ok(frames::payload(&packets));
                }
                if client.closed {
                    state.clients.remove(sid);
                    return Reply::status(404);
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
        std::iter::once(&state.owner)
            .chain(state.members.iter().map(|(user, _)| user))
            .find(|user| user.email.starts_with(&format!("{name}@")) || user.id == name)
            .cloned()
            .unwrap_or_else(|| panic!("the mock has no user {name}"))
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
        state.ping += 1;
        let counter = state.ping;
        for sid in state.live() {
            if state.clients[&sid].transport == Transport::WebSocket {
                let ping = frames::event(
                    "serverPing",
                    &[
                        json!(counter),
                        json!(now_ms() as u64),
                        json!("websocket"),
                        json!(sid),
                    ],
                );
                state.push(&sid, ping);
            }
        }
    }

    pub fn emit_to_room(&self, name: &str, args: &[Value]) {
        self.state().emit_room(name, args, None);
    }

    pub fn reconnect_gracefully(&self) {
        self.emit_to_room("reconnectGracefully", &[]);
    }

    pub fn force_disconnect(&self, message: &str, delay: Duration) {
        let targets = {
            let mut state = self.state();
            let targets = state.live();
            for sid in &targets {
                let event =
                    frames::event("forceDisconnect", &[json!(message), json!(delay.as_secs())]);
                state.push(sid, event);
            }
            targets
        };
        let shared = Arc::downgrade(&self.shared);
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            if let Some(shared) = shared.upgrade() {
                let mut state = shared
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                for sid in targets {
                    state.close(&sid);
                }
            }
        });
    }

    pub fn disconnect(&self, public_id: &str) {
        let mut state = self.state();
        let found = state
            .clients
            .iter()
            .find(|(_, client)| client.public_id == public_id)
            .map(|(sid, _)| sid.clone());
        if let Some(sid) = found {
            state.close(&sid);
        }
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
                Some(client) => client.outbox.drain(..).collect(),
                None => Vec::new(),
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
                let mut combined = operations.into_iter();
                let first = combined.next().unwrap_or_default();
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
        let op = self.removal(doc_id, at, length, None);
        self.local(doc_id, op, false);
    }

    pub fn track_delete(&mut self, doc_id: &str, at: usize, length: usize) {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{Rng, SeedableRng};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;

    const WAIT: Duration = Duration::from_secs(10);

    fn project() -> MockProject {
        MockProject::new("demo")
            .member(MockUser::named("bob"), Privilege::ReadAndWrite)
            .member(MockUser::named("carol"), Privilege::Review)
            .member(MockUser::named("dave"), Privilege::ReadOnly)
            .member(MockUser::named("erin"), Privilege::ReadAndWrite)
            .doc("main.tex", "\\documentclass{article}\nHello")
            .doc("sections/other.tex", "Other text")
            .file("figure.png", b"\x89PNG\r\n\x1a\nfake")
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Kind {
        WebSocket,
        Polling,
    }

    type WsStream = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    struct Socket {
        kind: Kind,
        ws: Option<WsStream>,
        http: reqwest::Client,
        channel: String,
        cookie: String,
        queued: VecDeque<String>,
    }

    async fn handshake(mock: &MockOverleaf, cookie: &str) -> String {
        reqwest::Client::new()
            .get(format!(
                "{}/socket.io/1/?projectId={}&t=1",
                mock.base,
                mock.project_id()
            ))
            .header("Cookie", cookie)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    }

    impl Socket {
        async fn open(mock: &MockOverleaf, user: &str, kind: Kind) -> Socket {
            let cookie = mock.user(user).cookie();
            let reply = handshake(mock, &cookie).await;
            let sid = reply.split(':').next().unwrap().to_string();
            let query = format!("projectId={}", mock.project_id());
            let mut socket = Socket {
                kind,
                ws: None,
                http: reqwest::Client::new(),
                channel: format!("{}/socket.io/1/xhr-polling/{sid}?{query}", mock.base),
                cookie: cookie.clone(),
                queued: VecDeque::new(),
            };
            if kind == Kind::WebSocket {
                let url = format!(
                    "{}/socket.io/1/websocket/{sid}?{query}",
                    mock.base.replace("http://", "ws://")
                );
                let mut request = url.into_client_request().unwrap();
                request
                    .headers_mut()
                    .insert("Cookie", HeaderValue::from_str(&cookie).unwrap());
                let (ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
                socket.ws = Some(ws);
            }
            socket
        }

        async fn send(&mut self, packet: &str) {
            match self.kind {
                Kind::WebSocket => self
                    .ws
                    .as_mut()
                    .unwrap()
                    .send(Message::text(packet.to_string()))
                    .await
                    .unwrap(),
                Kind::Polling => {
                    let reply = self
                        .http
                        .post(&self.channel)
                        .header("Cookie", &self.cookie)
                        .body(packet.to_string())
                        .send()
                        .await
                        .unwrap();
                    assert_eq!(reply.text().await.unwrap(), "1");
                }
            }
        }

        async fn receive(&mut self) -> Option<String> {
            loop {
                if let Some(packet) = self.queued.pop_front() {
                    return Some(packet);
                }
                match self.kind {
                    Kind::WebSocket => match self.ws.as_mut().unwrap().next().await {
                        Some(Ok(Message::Text(text))) => return Some(text.to_string()),
                        Some(Ok(_)) => continue,
                        _ => return None,
                    },
                    Kind::Polling => {
                        let reply = self
                            .http
                            .get(&self.channel)
                            .header("Cookie", &self.cookie)
                            .send()
                            .await
                            .ok()?;
                        if !reply.status().is_success() {
                            return None;
                        }
                        let body = reply.text().await.ok()?;
                        self.queued.extend(
                            crate::socket::decode_payload(&body)
                                .into_iter()
                                .filter(|packet| packet != "8::"),
                        );
                    }
                }
            }
        }

        async fn next(&mut self) -> String {
            loop {
                let packet = tokio::time::timeout(WAIT, self.receive())
                    .await
                    .expect("no packet in time")
                    .expect("the connection closed");
                if packet != "2::" {
                    return packet;
                }
            }
        }

        async fn event(&mut self, wanted: &str) -> Vec<Value> {
            loop {
                let packet = self.next().await;
                if let Some((name, args)) = Packet::parse(&packet).and_then(|packet| packet.event())
                {
                    if name == wanted {
                        return args;
                    }
                }
            }
        }

        async fn ack(&mut self, id: u64) -> Vec<Value> {
            loop {
                let packet = self.next().await;
                if let Some((got, args)) = Packet::parse(&packet).and_then(|packet| packet.ack()) {
                    if got == id {
                        return args;
                    }
                }
            }
        }

        async fn closes(&mut self) -> bool {
            loop {
                match tokio::time::timeout(WAIT, self.receive())
                    .await
                    .expect("no close in time")
                {
                    None => return true,
                    Some(packet) if packet.starts_with("0::") => return true,
                    Some(_) => continue,
                }
            }
        }
    }

    async fn eventually(check: impl Fn() -> bool) {
        let started = tokio::time::Instant::now();
        while !check() {
            assert!(started.elapsed() < WAIT, "the condition never held");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    fn join_options() -> Value {
        json!({ "encodeRanges": true, "supportsHistoryOT": true })
    }

    #[tokio::test]
    async fn mock_serves_both_transports() {
        let mock = MockOverleaf::start(project()).await;
        let doc = mock.doc_id("main.tex");
        let mut sockets = Vec::new();
        for (index, kind) in [Kind::WebSocket, Kind::Polling].into_iter().enumerate() {
            let mut socket = Socket::open(&mock, "alice", kind).await;
            assert_eq!(socket.next().await, "1::", "{kind:?}");
            let joined = socket.event("joinProjectResponse").await;
            assert_eq!(joined[0]["permissionsLevel"], "owner");
            assert_eq!(joined[0]["project"]["_id"], mock.project_id());
            assert_eq!(joined[0]["protocolVersion"], 2);
            socket
                .send(&frames::event_with_ack(
                    1,
                    "joinDoc",
                    &[json!(doc), join_options()],
                ))
                .await;
            let reply = socket.ack(1).await;
            assert!(reply[0].is_null());
            assert_eq!(reply[5], "sharejs-text-ot");
            assert_eq!(reply[2], index as u64);
            let update =
                json!({ "doc": doc, "op": [{ "p": 0, "i": format!("{kind:?} ") }], "v": index });
            socket
                .send(&frames::event_with_ack(
                    2,
                    "applyOtUpdate",
                    &[json!(doc), update],
                ))
                .await;
            assert_eq!(socket.ack(2).await, Vec::<Value>::new());
            let applied = socket.event("otUpdateApplied").await;
            assert_eq!(applied[0], json!({ "v": index, "doc": doc }));
            sockets.push(socket);
        }
        assert_eq!(
            mock.doc_text(&doc),
            "Polling WebSocket \\documentclass{article}\nHello"
        );
        let mut transports: Vec<Transport> = mock
            .connections()
            .iter()
            .map(|connection| connection.transport)
            .collect();
        transports.sort_by_key(|transport| format!("{transport:?}"));
        assert_eq!(transports, vec![Transport::Polling, Transport::WebSocket]);
        let remote = sockets[0].event("otUpdateApplied").await;
        assert_eq!(remote[0]["op"], json!([{ "p": 0, "i": "Polling " }]));
        assert_eq!(remote[0]["v"], 1);
    }

    fn keys(value: &Value) -> BTreeSet<String> {
        value
            .as_object()
            .map(|object| object.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn kinds(values: &[Value]) -> Vec<&'static str> {
        values
            .iter()
            .map(|value| match value {
                Value::Null => "null",
                Value::Bool(_) => "bool",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Object(_) => "object",
            })
            .collect()
    }

    #[tokio::test]
    async fn mock_frames_have_the_shapes_ce_sent() {
        use super::super::overleaf_rt::{recordings, DocEvent};
        for (scenario, format) in [
            ("two-users-typing", DocFormat::ShareJs),
            ("history-ot-turns", DocFormat::HistoryOt),
        ] {
            let recording = recordings()
                .into_iter()
                .find(|recording| recording.name == scenario)
                .unwrap();
            let trace = recording.trace("alice");
            let event = |name: &str| {
                trace
                    .packets()
                    .filter(|(outgoing, _)| !outgoing)
                    .filter_map(|(_, packet)| packet.event())
                    .find(|(found, _)| found == name)
                    .map(|(_, args)| args[0].clone())
                    .unwrap()
            };
            let ce_join = event("joinProjectResponse");
            let ce_cursor = event("clientTracking.clientUpdated");
            let ce_reply = trace.join_doc_replies(&recording.doc_id).remove(0);
            let ce_remote = trace
                .doc_events(&recording.doc_id)
                .into_iter()
                .find_map(|event| match event {
                    DocEvent::Remote { update, .. } => Some(update),
                    _ => None,
                })
                .unwrap();

            let mock = MockOverleaf::start(project().format(format)).await;
            let doc = mock.doc_id("main.tex");
            let mut alice = mock.peer("alice");
            let mut bob = mock.peer("bob");
            alice.join(&doc);
            bob.join(&doc);
            bob.type_at(&doc, 0, "x");
            bob.emit(
                "clientTracking.updatePosition",
                vec![json!({ "row": 0, "column": 1, "doc_id": doc })],
            );
            let mock_join = alice.events("joinProjectResponse")[0][0].clone();
            let mock_remote = alice
                .events("otUpdateApplied")
                .into_iter()
                .find(|args| args[0].get("op").is_some())
                .unwrap()[0]
                .clone();
            let mock_cursor = alice.events("clientTracking.clientUpdated")[0][0].clone();
            let mock_reply = alice
                .emit("joinDoc", vec![json!(doc), join_options()])
                .unwrap();

            assert_eq!(
                keys(&mock_join),
                keys(&ce_join),
                "{scenario}: joinProjectResponse"
            );
            assert_eq!(
                keys(&mock_join["project"]),
                keys(&ce_join["project"]),
                "{scenario}: project"
            );
            assert_eq!(
                keys(&mock_join["project"]["owner"]),
                keys(&ce_join["project"]["owner"])
            );
            assert_eq!(
                kinds(&mock_reply),
                kinds(&ce_reply),
                "{scenario}: joinDoc reply"
            );
            assert_eq!(mock_reply[5], ce_reply[5]);
            let required: BTreeSet<String> = ["doc", "op", "v", "meta"]
                .iter()
                .map(|key| key.to_string())
                .collect();
            assert!(
                required.is_subset(&keys(&ce_remote)) && required.is_subset(&keys(&mock_remote))
            );
            assert_eq!(
                keys(&mock_remote["meta"]),
                keys(&ce_remote["meta"]),
                "{scenario}: meta"
            );
            assert_eq!(
                keys(&mock_cursor),
                keys(&ce_cursor),
                "{scenario}: clientUpdated"
            );
        }
    }

    #[tokio::test]
    async fn mock_serves_history_ot_docs_only_to_clients_that_support_them() {
        let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
        let doc = mock.doc_id("main.tex");
        let mut socket = Socket::open(&mock, "alice", Kind::WebSocket).await;
        socket.event("joinProjectResponse").await;
        socket
            .send(&frames::event_with_ack(
                1,
                "joinDoc",
                &[json!(doc), json!({ "encodeRanges": true })],
            ))
            .await;
        assert_eq!(
            socket.ack(1).await[0]["message"],
            "client does not support history-ot"
        );
        socket
            .send(&frames::event_with_ack(
                2,
                "joinDoc",
                &[json!(doc), join_options()],
            ))
            .await;
        let reply = socket.ack(2).await;
        assert_eq!(reply[5], "history-ot");
        assert_eq!(
            reply[1],
            json!({ "content": "\\documentclass{article}\nHello" })
        );
    }

    #[tokio::test]
    async fn mock_broadcasts_to_the_project_room_and_can_switch_to_doc_rooms() {
        let mock = MockOverleaf::start(project()).await;
        let main = mock.doc_id("main.tex");
        let other = mock.doc_id("sections/other.tex");
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        let mut erin = mock.peer("erin");
        alice.join(&main);
        bob.join(&main);
        erin.join(&other);
        let mut socket = Socket::open(&mock, "dave", Kind::WebSocket).await;
        socket.event("joinProjectResponse").await;
        let seen = |peer: &mut MockPeer| {
            peer.events("otUpdateApplied")
                .iter()
                .filter(|args| args[0]["doc"] == main && args[0].get("op").is_some())
                .count()
        };
        alice.type_at(&main, 0, "x");
        assert_eq!(seen(&mut bob), 1);
        assert_eq!(
            seen(&mut erin),
            1,
            "the project room reaches clients that never joined the doc"
        );
        assert_eq!(
            socket.event("otUpdateApplied").await[0]["op"],
            json!([{ "p": 0, "i": "x" }])
        );
        mock.configure(|config| config.legacy_doc_rooms = true);
        alice.type_at(&main, 1, "y");
        assert_eq!(seen(&mut bob), 2);
        assert_eq!(
            seen(&mut erin),
            1,
            "doc rooms only reach clients that joined the doc"
        );
        assert_eq!(bob.text(&main), "xy\\documentclass{article}\nHello");
    }

    #[tokio::test]
    async fn mock_doc_error_disconnects_every_joined_client() {
        let mock = MockOverleaf::start(project()).await;
        let main = mock.doc_id("main.tex");
        let other = mock.doc_id("sections/other.tex");
        let mut alice = mock.peer("alice");
        let mut erin = mock.peer("erin");
        alice.join(&main);
        erin.join(&other);
        let mut bob = Socket::open(&mock, "bob", Kind::WebSocket).await;
        bob.event("joinProjectResponse").await;
        bob.send(&frames::event_with_ack(
            1,
            "joinDoc",
            &[json!(main), join_options()],
        ))
        .await;
        bob.ack(1).await;
        let bad = json!({ "doc": main, "op": [{ "p": 0, "d": "not there" }], "v": 0 });
        assert_eq!(
            alice.emit("applyOtUpdate", vec![json!(main), bad]),
            Some(Vec::new())
        );
        let error = bob.event("otUpdateError").await;
        assert!(error[0].as_str().unwrap().contains("does not match"));
        assert_eq!(error[1]["doc_id"], main);
        assert!(bob.closes().await);
        assert!(!alice.is_connected(), "the sender is disconnected too");
        assert!(
            erin.is_connected(),
            "a client that never joined the doc stays"
        );
        assert_eq!(erin.events("clientTracking.clientDisconnected").len(), 2);
        mock.fail_next_update(&other, "injected failure");
        erin.type_at(&other, 0, "z");
        assert!(!erin.is_connected());
        assert_eq!(mock.doc_text(&other), "Other text");
        assert!(mock.connections().is_empty());
    }

    #[tokio::test]
    async fn mock_peers_converge_on_concurrent_edits_in_both_formats() {
        for (format, applied_version) in [
            (DocFormat::ShareJs, true),
            (DocFormat::HistoryOt, false),
            (DocFormat::HistoryOt, true),
        ] {
            let mock = MockOverleaf::start(project().format(format)).await;
            mock.configure(|config| config.history_ot_applied_version = applied_version);
            let doc = mock.doc_id("main.tex");
            let mut peers = vec![mock.peer("alice"), mock.peer("bob"), mock.peer("erin")];
            for peer in &mut peers {
                peer.join(&doc);
            }
            let mut rng = rand::rngs::StdRng::seed_from_u64(458);
            for round in 0..150 {
                let who = rng.gen_range(0..peers.len());
                let peer = &mut peers[who];
                if rng.gen_bool(0.3) {
                    peer.hold();
                }
                let length = peer.text(&doc).encode_utf16().count();
                if length > 3 && rng.gen_bool(0.4) {
                    let at = rng.gen_range(0..length - 2);
                    peer.delete(&doc, at, rng.gen_range(1..3));
                } else {
                    let at = rng.gen_range(0..=length);
                    peer.type_at(&doc, at, &format!("{round} "));
                }
                if rng.gen_bool(0.5) {
                    peers[rng.gen_range(0..3)].release();
                }
            }
            for peer in &mut peers {
                peer.release();
            }
            for peer in &mut peers {
                peer.release();
            }
            let expected = mock.doc_text(&doc);
            for peer in &mut peers {
                assert_eq!(
                    peer.text(&doc),
                    expected,
                    "{format:?} applied_version={applied_version}"
                );
            }
        }
    }

    #[tokio::test]
    async fn mock_history_ot_reports_the_senders_base_version_like_ce() {
        let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        alice.join(&doc);
        bob.join(&doc);
        alice.hold();
        bob.hold();
        alice.type_at(&doc, 0, "A");
        bob.type_at(&doc, 0, "B");
        alice.release();
        bob.release();
        let stale = alice.events("otUpdateApplied").last().unwrap()[0].clone();
        assert_eq!(
            stale["v"], 0,
            "CE reports the base version of a transformed history-ot update"
        );
        assert_eq!(
            stale["op"],
            json!([{ "textOperation": ["B", 30] }]),
            "the incoming insert goes first at a tie"
        );
        assert_eq!(mock.doc_version(&doc), 2);
        assert!(mock.doc_text(&doc).starts_with("BA"));
        assert_eq!(alice.text(&doc), bob.text(&doc));
    }

    #[tokio::test]
    async fn mock_join_doc_catches_up_from_a_version() {
        let mock = MockOverleaf::start(project()).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        alice.join(&doc);
        for word in ["one ", "two ", "three "] {
            alice.type_at(&doc, 0, word);
        }
        let mut bob = mock.peer("bob");
        let reply = bob
            .emit("joinDoc", vec![json!(doc), json!(1), join_options()])
            .unwrap();
        assert_eq!(reply[2], 3);
        let updates = reply[3].as_array().unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0]["op"], json!([{ "p": 0, "i": "two " }]));
        mock.configure(|config| config.kept_ops = 1);
        alice.type_at(&doc, 0, "four ");
        let stale = bob
            .emit("joinDoc", vec![json!(doc), json!(1), join_options()])
            .unwrap();
        assert!(stale[0]["message"]
            .as_str()
            .unwrap()
            .contains("no longer available"));
    }

    #[tokio::test]
    async fn mock_dedupes_a_resend_with_dup_if_source() {
        let mock = MockOverleaf::start(project()).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        let mut bob = mock.peer("bob");
        alice.join(&doc);
        bob.join(&doc);
        let update = json!({ "doc": doc, "op": [{ "p": 0, "i": "once " }], "v": 0 });
        alice.emit("applyOtUpdate", vec![json!(doc), update.clone()]);
        let mut resend = update;
        resend["dupIfSource"] = json!([alice.public_id]);
        let mut again = mock.peer("alice");
        again.join(&doc);
        again.emit("applyOtUpdate", vec![json!(doc), resend]);
        assert_eq!(mock.doc_version(&doc), 1);
        assert_eq!(mock.doc_text(&doc), "once \\documentclass{article}\nHello");
        assert_eq!(
            again.events("otUpdateApplied").last().unwrap()[0],
            json!({ "v": 0, "doc": doc })
        );
        assert_eq!(bob.events("otUpdateApplied").len(), 1);
    }

    #[tokio::test]
    async fn mock_lifecycle_events_reach_clients() {
        let mock = MockOverleaf::start(project()).await;
        let mut socket = Socket::open(&mock, "alice", Kind::WebSocket).await;
        socket.event("joinProjectResponse").await;
        mock.server_ping();
        let ping = socket.event("serverPing").await;
        assert_eq!(ping.len(), 4);
        assert_eq!(ping[2], "websocket");
        let pong = frames::event(
            "clientPong",
            &[
                ping[0].clone(),
                ping[1].clone(),
                ping[2].clone(),
                ping[3].clone(),
                json!("websocket"),
                Value::Null,
            ],
        );
        socket.send(&pong).await;
        mock.reconnect_gracefully();
        assert!(socket.event("reconnectGracefully").await.is_empty());
        eventually(|| mock.received("clientPong").len() == 1).await;
        mock.force_disconnect("Maintenance", Duration::from_millis(50));
        assert_eq!(
            socket.event("forceDisconnect").await,
            vec![json!("Maintenance"), json!(0)]
        );
        assert!(socket.closes().await);
        mock.configure(|config| config.reject_connections = Some("retry".into()));
        let mut rejected = Socket::open(&mock, "bob", Kind::Polling).await;
        assert_eq!(
            rejected.event("connectionRejected").await,
            vec![json!({ "message": "retry" })]
        );
        assert!(rejected.closes().await);
        mock.configure(|config| config.reject_connections = None);
        let unauthenticated = handshake(&mock, "overleaf.sid=unknown").await;
        let sid = unauthenticated.split(':').next().unwrap();
        let body = reqwest::get(format!(
            "{}/socket.io/1/xhr-polling/{sid}?projectId={}",
            mock.base,
            mock.project_id()
        ))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
        assert!(body.contains("invalid session"), "{body}");
        mock.configure(|config| config.websocket = false);
        assert!(handshake(&mock, &mock.user("alice").cookie())
            .await
            .ends_with(":xhr-polling"));
        mock.configure(|config| config.handshake_reply = Some((200, "0{\"sid\":\"v2\"}".into())));
        assert!(handshake(&mock, &mock.user("alice").cookie())
            .await
            .starts_with("0{"));
    }

    #[tokio::test]
    async fn mock_refuses_a_reviewers_plain_edit_and_accepts_a_tracked_one() {
        let mock = MockOverleaf::start(project().format(DocFormat::HistoryOt)).await;
        let doc = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        alice.join(&doc);
        let mut carol = mock.peer("carol");
        carol.join(&doc);
        carol.type_at(&doc, 0, "plain ");
        assert!(
            !carol.is_connected(),
            "a reviewer's plain edit disconnects them, as CE does"
        );
        assert_eq!(mock.doc_text(&doc), "\\documentclass{article}\nHello");
        let mut carol = mock.peer("carol");
        carol.join(&doc);
        let hello = "\\documentclass{article}\n".encode_utf16().count();
        carol.track_delete(&doc, hello, 5);
        assert!(carol.is_connected());
        assert_eq!(mock.doc_text(&doc), "\\documentclass{article}\n");
        assert_eq!(alice.text(&doc), "\\documentclass{article}\n");
        let raw = mock.raw_doc(&doc);
        assert_eq!(raw["content"], "\\documentclass{article}\nHello");
        assert_eq!(
            raw["trackedChanges"][0]["range"],
            json!({ "pos": hello, "length": 5 })
        );
        alice.type_at(&doc, hello, "Hi ");
        assert_eq!(
            mock.raw_doc(&doc)["content"],
            "\\documentclass{article}\nHi Hello"
        );
        let mut dave = mock.peer("dave");
        dave.join(&doc);
        dave.track_delete(&doc, 0, 1);
        assert!(!dave.is_connected(), "a viewer can't even suggest");
    }

    #[tokio::test]
    async fn mock_rest_routes_change_the_tree_and_tell_the_room() {
        let mock = MockOverleaf::start(project()).await;
        let mut watcher = mock.peer("bob");
        let http = reqwest::Client::new();
        let cookie = mock.user("alice").cookie();
        let root = mock.root_folder_id();
        let url = |path: &str| format!("{}/project/{}{path}", mock.base, mock.project_id());
        let page = http
            .get(url(""))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(page.contains("name=\"ol-csrfToken\" content=\"mock-csrf-token\""));
        assert!(page.contains("name=\"ol-wsUrl\""));
        let fallback = http
            .get(url("?ws=fallback"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(!fallback.contains("ol-wsUrl"));
        let unredirected = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        assert_eq!(
            unredirected.get(url("")).send().await.unwrap().status(),
            302
        );
        let refused = http
            .post(url("/doc"))
            .header("Cookie", &cookie)
            .json(&json!({ "name": "x.tex", "parent_folder_id": root }))
            .send()
            .await
            .unwrap();
        assert_eq!(refused.status(), 403, "writes need the CSRF token");
        let created: Value = http
            .post(url("/doc"))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(&json!({ "name": "new.tex", "parent_folder_id": root }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let new_doc = created["_id"].as_str().unwrap().to_string();
        assert_eq!(
            watcher.events("reciveNewDoc")[0][1],
            json!({ "_id": new_doc, "name": "new.tex" })
        );
        let upload = |name: &str, bytes: &[u8]| {
            let mut body =
                b"--XyZ\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"".to_vec();
            body.extend_from_slice(name.as_bytes());
            body.extend_from_slice(b"\"\r\nContent-Type: application/octet-stream\r\n\r\n");
            body.extend_from_slice(bytes);
            body.extend_from_slice(b"\r\n--XyZ--\r\n");
            http.post(url(&format!("/upload?folder_id={root}")))
                .header("Cookie", &cookie)
                .header("X-Csrf-Token", MOCK_CSRF)
                .header("Content-Type", "multipart/form-data; boundary=XyZ")
                .body(body)
                .send()
        };
        let text: Value = upload("notes.txt", b"plain words")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(text["entity_type"], "doc");
        let image: Value = upload("photo.png", b"\x89PNG\x00binary")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(image["entity_type"], "file");
        assert_eq!(watcher.events("reciveNewFile").len(), 1);
        let blob = http
            .get(url(&format!("/blob/{}", image["hash"].as_str().unwrap())))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(blob.as_ref(), b"\x89PNG\x00binary");
        let renamed = http
            .post(url(&format!("/doc/{new_doc}/rename")))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(&json!({ "name": "renamed.tex" }))
            .send()
            .await
            .unwrap();
        assert_eq!(renamed.status(), 204);
        assert_eq!(
            watcher.events("reciveEntityRename")[0],
            vec![json!(new_doc), json!("renamed.tex")]
        );
        let folder = mock.entity_id("sections").unwrap();
        http.post(url(&format!("/doc/{new_doc}/move")))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(&json!({ "folder_id": folder }))
            .send()
            .await
            .unwrap();
        assert_eq!(
            mock.entity_id("sections/renamed.tex"),
            Some(new_doc.clone())
        );
        http.delete(url(&format!("/doc/{new_doc}")))
            .header("Cookie", &cookie)
            .header("X-Csrf-Token", MOCK_CSRF)
            .send()
            .await
            .unwrap();
        assert_eq!(
            watcher.events("removeEntity")[0],
            vec![json!(new_doc), json!("editor")]
        );
        let entities: Value = http
            .get(url("/entities"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let paths: Vec<&str> = entities["entities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entity| entity["path"].as_str().unwrap())
            .collect();
        assert_eq!(
            paths,
            vec![
                "/figure.png",
                "/main.tex",
                "/notes.txt",
                "/photo.png",
                "/sections/other.tex"
            ]
        );
        let members: Value = http
            .get(url("/members"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(members["members"].as_array().unwrap().len(), 4);
        assert_eq!(
            http.get(url("/threads"))
                .header("Cookie", &cookie)
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert_eq!(
            http.get(url("/messages"))
                .header("Cookie", &cookie)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let main = mock.doc_id("main.tex");
        let mut alice = mock.peer("alice");
        alice.join(&main);
        alice.type_at(&main, 0, "edit ");
        let updates: Value = http
            .get(url("/updates"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(updates["updates"][0]["pathnames"], json!(["main.tex"]));
        let diff: Value = http
            .get(url("/filetree/diff?from=0&to=1"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(diff["diff"]
            .as_array()
            .unwrap()
            .contains(&json!({ "pathname": "main.tex", "operation": "edited" })));
        mock.configure(|config| config.history_status = 402);
        assert_eq!(
            http.get(url("/updates"))
                .header("Cookie", &cookie)
                .send()
                .await
                .unwrap()
                .status(),
            402
        );
        let viewer = http
            .post(url("/doc"))
            .header("Cookie", mock.user("dave").cookie())
            .header("X-Csrf-Token", MOCK_CSRF)
            .json(&json!({ "name": "y.tex", "parent_folder_id": root }))
            .send()
            .await
            .unwrap();
        assert_eq!(viewer.status(), 403);
    }
}
