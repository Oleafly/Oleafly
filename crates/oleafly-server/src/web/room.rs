use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use oleafly_collab::comments::{mentions_in, CommentMember};
use oleafly_collab::doc::{DocChanges, NodeKind, ProjectDoc};
use oleafly_collab::editor::{ChannelError, EditorChannel};
use oleafly_collab::materialize;
use oleafly_collab::ot::TextOperation;
use oleafly_collab::settings::Settings;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, BatchId, CommentId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::Ed25519KeyPair;
use serde_json::Value;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::{mpsc, oneshot, watch};

use crate::outputs;
use crate::peers;
use crate::projects;
use crate::routes::ws::{CursorGate, Peer, ASIDE_BYTES};
use crate::snapshots::{read_cost, Current, Held};
use crate::sockets::SocketControl;
use crate::state::AppState;
use crate::web::frames::{CommentAction, Outgoing, WebFile, WebOutput, WebText};
use crate::web::outbox::{Answer, Outbox, Queued, Reply, Writer};
use crate::web::{pending_core, Refusal};

pub const LINGER: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct Sink {
    frames: mpsc::Sender<String>,
    control: UnboundedSender<SocketControl>,
}

impl Sink {
    pub fn new(frames: mpsc::Sender<String>, control: UnboundedSender<SocketControl>) -> Sink {
        Sink { frames, control }
    }

    pub fn send(&self, frame: &Outgoing) {
        let Some(text) = frame.text() else {
            return;
        };
        if let Err(TrySendError::Full(_)) = self.frames.try_send(text) {
            let _ = self.control.send(SocketControl::Overloaded);
        }
    }

    fn close(&self) {
        let _ = self.control.send(SocketControl::Overloaded);
    }
}

type Sinks = HashMap<u64, Sink>;

struct Done {
    order: u64,
    session: u64,
    writer: Writer,
    peer: u64,
    size: u64,
    change: Option<String>,
    reply: Option<Reply>,
}

enum Waiting {
    Frame(Outgoing),
    Ack { order: u64, frame: Outgoing },
}

type Channels = HashMap<(u64, String), VecDeque<Waiting>>;

const MAX_WAITING: usize = crate::web::gateway::SINK_CAPACITY;

fn to_channel(waiting: &mut Channels, sinks: &Sinks, session: u64, file: &str, frame: Outgoing) {
    match waiting.get_mut(&(session, file.to_string())) {
        Some(queue) if queue.len() >= MAX_WAITING => {
            if let Some(sink) = sinks.get(&session) {
                sink.close();
            }
        }
        Some(queue) if !queue.is_empty() => queue.push_back(Waiting::Frame(frame)),
        _ => {
            if let Some(sink) = sinks.get(&session) {
                sink.send(&frame);
            }
        }
    }
}

fn release(waiting: &mut Channels, sinks: &Sinks, through: u64) {
    waiting.retain(|(session, _), queue| {
        while let Some(front) = queue.front() {
            if matches!(front, Waiting::Ack { order, .. } if *order > through) {
                break;
            }
            let Some(Waiting::Frame(frame) | Waiting::Ack { frame, .. }) = queue.pop_front() else {
                break;
            };
            if let Some(sink) = sinks.get(session) {
                sink.send(&frame);
            }
        }
        !queue.is_empty()
    });
}

const LINGERING_PER_ACCOUNT: usize = 2;
const KEPT_CHANGES: usize = 16;
const KEPT_WRITERS: usize = 4_096;
const MAX_CHANGE_ID_CHARS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fate {
    Queued(u64),
    Applied,
    Abandoned,
}

struct Lingering {
    room: Arc<WebRoom>,
    account: AccountId,
    ticket: u64,
}

type Author = (SharedProjectId, DeviceId);

#[derive(Default)]
struct Changes {
    clock: u64,
    writers: HashMap<Author, (u64, VecDeque<(String, Fate)>)>,
}

impl Changes {
    fn fate(&self, writer: Author, id: &str) -> Option<Fate> {
        self.writers
            .get(&writer)?
            .1
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, fate)| *fate)
    }

    fn note(&mut self, writer: Author, id: &str, fate: Fate) {
        self.clock += 1;
        if !self.writers.contains_key(&writer) && self.writers.len() >= KEPT_WRITERS {
            let oldest = self
                .writers
                .iter()
                .min_by_key(|(_, (used, _))| *used)
                .map(|(key, _)| *key);
            if let Some(oldest) = oldest {
                self.writers.remove(&oldest);
            }
        }
        let clock = self.clock;
        let (used, kept) = self.writers.entry(writer).or_default();
        *used = clock;
        kept.retain(|(known, _)| known != id);
        kept.push_back((id.to_string(), fate));
        while kept.len() > KEPT_CHANGES {
            kept.pop_front();
        }
    }
}

pub fn change_id(id: Option<String>) -> Option<String> {
    id.filter(|id| !id.is_empty() && id.chars().count() <= MAX_CHANGE_ID_CHARS)
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Default)]
pub struct Hub {
    rooms: Mutex<HashMap<SharedProjectId, Weak<WebRoom>>>,
    sessions: AtomicU64,
    lingering: Mutex<Vec<Lingering>>,
    tickets: AtomicU64,
    changes: Mutex<Changes>,
}

impl Hub {
    fn lock(&self) -> MutexGuard<'_, HashMap<SharedProjectId, Weak<WebRoom>>> {
        locked(&self.rooms)
    }

    pub fn room(&self, project: SharedProjectId) -> Arc<WebRoom> {
        let mut rooms = self.lock();
        if let Some(room) = rooms.get(&project).and_then(Weak::upgrade) {
            return room;
        }
        rooms.retain(|_, room| room.strong_count() > 0);
        let room = Arc::new(WebRoom::new(project));
        rooms.insert(project, Arc::downgrade(&room));
        room
    }

    pub fn live(&self, project: SharedProjectId) -> Option<Arc<WebRoom>> {
        self.lock().get(&project).and_then(Weak::upgrade)
    }

    pub fn next_session(&self) -> u64 {
        self.sessions.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn linger(self: &Arc<Self>, account: AccountId, room: Arc<WebRoom>) {
        let ticket = self.tickets.fetch_add(1, Ordering::Relaxed);
        let released = {
            let mut lingering = locked(&self.lingering);
            let mut released = Vec::new();
            if let Some(at) = lingering
                .iter()
                .position(|kept| kept.account == account && Arc::ptr_eq(&kept.room, &room))
            {
                released.push(lingering.remove(at));
            }
            while lingering
                .iter()
                .filter(|kept| kept.account == account)
                .count()
                >= LINGERING_PER_ACCOUNT
            {
                let Some(at) = lingering.iter().position(|kept| kept.account == account) else {
                    break;
                };
                released.push(lingering.remove(at));
            }
            lingering.push(Lingering {
                room,
                account,
                ticket,
            });
            released
        };
        drop(released);
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            self.release(ticket);
            return;
        };
        let hub = Arc::downgrade(self);
        runtime.spawn(async move {
            tokio::time::sleep(LINGER).await;
            if let Some(hub) = hub.upgrade() {
                hub.release(ticket);
            }
        });
    }

    fn release(&self, ticket: u64) {
        let released = {
            let mut lingering = locked(&self.lingering);
            lingering
                .iter()
                .position(|kept| kept.ticket == ticket)
                .map(|at| lingering.remove(at))
        };
        drop(released);
    }

    pub fn shed(&self) -> bool {
        let released = std::mem::take(&mut *locked(&self.lingering));
        let freed = released
            .iter()
            .any(|kept| Arc::strong_count(&kept.room) == 1);
        drop(released);
        freed
    }

    pub fn lingering(&self) -> usize {
        locked(&self.lingering).len()
    }

    fn fate(&self, project: SharedProjectId, device: DeviceId, id: &str) -> Option<Fate> {
        locked(&self.changes).fate((project, device), id)
    }

    fn note(&self, project: SharedProjectId, device: DeviceId, id: &str, fate: Fate) {
        locked(&self.changes).note((project, device), id, fate);
    }

    fn resumed(&self, project: SharedProjectId, device: DeviceId, id: &str) -> bool {
        let mut changes = locked(&self.changes);
        match changes.fate((project, device), id) {
            Some(Fate::Applied) => true,
            Some(Fate::Abandoned | Fate::Queued(_)) => false,
            None => {
                changes.note((project, device), id, Fate::Abandoned);
                false
            }
        }
    }
}

pub struct WebRoom {
    project: SharedProjectId,
    doc: tokio::sync::Mutex<Option<RoomDoc>>,
    sessions: Mutex<Sinks>,
    outbox: Mutex<Outbox>,
    progress: watch::Sender<u64>,
}

impl Drop for WebRoom {
    fn drop(&mut self) {
        if let Some(room) = self.doc.get_mut().take() {
            free(room);
        }
    }
}

fn free(room: RoomDoc) {
    drop(room.release());
}

fn free_doc(doc: ProjectDoc) {
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => {
            drop(runtime.spawn_blocking(move || drop(doc)));
        }
        Err(_) => drop(doc),
    }
}

fn fresh_peer(taken: &loro::VersionVector) -> u64 {
    loop {
        let mut bytes = [0u8; 8];
        if SystemRandom::new().fill(&mut bytes).is_err() {
            continue;
        }
        let peer = u64::from_le_bytes(bytes) >> 1;
        if taken.get(&peer).is_none() {
            return peer;
        }
    }
}

fn too_large() -> Refusal {
    Refusal::new(
        "project_too_large",
        "This project is too large for the server to open in a browser.",
    )
}

fn busy() -> Refusal {
    Refusal::new("server_busy", "The server is busy. Try again in a moment.")
}

fn cannot_open() -> Refusal {
    Refusal::new(
        "server",
        "The server could not open this project. Try again.",
    )
}

fn not_open() -> Refusal {
    Refusal::new("not_open", "Open the file before changing it.")
}

fn not_found() -> Refusal {
    Refusal::new("not_found", "This file is not in the project.")
}

pub fn files_of(doc: &ProjectDoc) -> Vec<WebFile> {
    let Ok(nodes) = doc.nodes() else {
        return Vec::new();
    };
    let mut files: Vec<WebFile> = materialize::layout(&nodes)
        .into_iter()
        .map(|(id, placed)| WebFile {
            file_id: id,
            path: placed.path,
            kind: match placed.kind {
                NodeKind::Dir => "dir",
                NodeKind::Text => "text",
                NodeKind::Blob => "blob",
            },
            hash: placed.blob.filter(|_| placed.kind == NodeKind::Blob),
        })
        .collect();
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}

struct Written {
    payload: Vec<u8>,
    peer: u64,
    texts: Vec<(String, String)>,
    threads: Vec<String>,
}

struct Failed {
    refusal: Refusal,
    dirty: bool,
}

enum Taken {
    Skipped,
    Applied {
        ack: Outgoing,
        written: Option<Written>,
        tracked: bool,
    },
}

struct Carried {
    channels: HashMap<String, HashMap<u64, EditorChannel>>,
    retired: HashMap<(u64, String), u64>,
    writers: HashMap<DeviceId, u64>,
    files: Vec<WebFile>,
    compile: Settings,
}

pub struct RoomDoc {
    doc: ProjectDoc,
    held: Held,
    seq: u64,
    ahead: BTreeSet<u64>,
    channels: HashMap<String, HashMap<u64, EditorChannel>>,
    retired: HashMap<(u64, String), u64>,
    writers: HashMap<DeviceId, u64>,
    stored: HashMap<DeviceId, Vec<(u64, i64)>>,
    files: Vec<WebFile>,
    compile: Settings,
    waiting: Channels,
    frozen: bool,
}

async fn load(state: &AppState, project: SharedProjectId) -> Result<RoomDoc, Refusal> {
    let current = state
        .snapshots
        .read_current(&state.db, project)
        .await
        .map_err(|_| cannot_open())?;
    let (budgeted, head) = match current {
        Current::Read(budgeted, head) => (budgeted, head),
        Current::TooLarge { .. } => return Err(too_large()),
        Current::Busy => return Err(busy()),
        Current::Missing => return Err(cannot_open()),
    };
    let (bound, ends) = state
        .db
        .read(move |conn| Ok((peers::table(conn, project)?, peers::ends(conn, project)?)))
        .await
        .map_err(|_| cannot_open())?;
    let mut stored: HashMap<DeviceId, Vec<(u64, i64)>> = HashMap::new();
    for row in &bound {
        if let Some(end) = ends.get(&row.peer) {
            stored
                .entry(row.device_id)
                .or_default()
                .push((row.peer, *end));
        }
    }
    let built = tokio::task::spawn_blocking(move || {
        let (replay, held) = budgeted.into_parts();
        let bytes = replay.finish()?;
        let mut doc = ProjectDoc::load_contained(&bytes).ok()?;
        let mut authorship = doc.authorship().clone();
        authorship.vouch(bound.iter().map(|row| (row.peer, row.account_id)));
        doc.set_authorship(authorship);
        let files = files_of(&doc);
        let compile = doc.settings();
        Some((doc, held, files, compile))
    })
    .await
    .ok()
    .flatten();
    let Some((doc, held, files, compile)) = built else {
        return Err(cannot_open());
    };
    Ok(RoomDoc {
        doc,
        held,
        seq: head,
        ahead: BTreeSet::new(),
        channels: HashMap::new(),
        retired: HashMap::new(),
        writers: HashMap::new(),
        stored,
        files,
        compile,
        waiting: HashMap::new(),
        frozen: false,
    })
}

impl RoomDoc {
    fn release(self) -> Carried {
        let RoomDoc {
            doc,
            held,
            channels,
            retired,
            writers,
            files,
            compile,
            ..
        } = self;
        drop(held);
        free_doc(doc);
        Carried {
            channels,
            retired,
            writers,
            files,
            compile,
        }
    }

    fn reusable(&self, device: DeviceId) -> Option<u64> {
        let known = self.doc.version();
        self.stored
            .get(&device)?
            .iter()
            .filter(|(peer, end)| {
                known
                    .get(peer)
                    .is_some_and(|counter| i64::from(*counter) == *end)
            })
            .max_by_key(|(_, end)| *end)
            .map(|(peer, _)| *peer)
    }

    fn knows(&self, seq: u64) -> bool {
        seq <= self.seq || self.ahead.contains(&seq)
    }

    fn mark(&mut self, seq: u64) {
        if seq <= self.seq {
            return;
        }
        self.ahead.insert(seq);
        while self.ahead.remove(&(self.seq + 1)) {
            self.seq += 1;
        }
    }

    fn witness(&mut self, rows: &[ProjectPeer]) {
        if rows.is_empty() {
            return;
        }
        let mut authorship = self.doc.authorship().clone();
        for row in rows {
            authorship.witness([row.peer], row.account_id);
        }
        self.doc.set_authorship(authorship);
    }

    fn writer(&mut self, device: DeviceId) -> Result<u64, Refusal> {
        let peer = match self.writers.get(&device) {
            Some(peer) => *peer,
            None => {
                let peer = self
                    .reusable(device)
                    .unwrap_or_else(|| fresh_peer(&self.doc.version()));
                self.writers.insert(device, peer);
                peer
            }
        };
        self.doc.set_peer_id(peer).map_err(|_| Refusal::server())?;
        Ok(peer)
    }

    fn rev_of(&self, session: u64, file: &str) -> Option<u64> {
        self.channels
            .get(file)
            .and_then(|channels| channels.get(&session))
            .map(EditorChannel::rev)
    }

    fn is_text(&self, file: &str) -> bool {
        self.files
            .iter()
            .any(|known| known.file_id == file && known.kind == "text")
    }

    fn send_to_session(&mut self, sinks: &Sinks, session: u64, file: &str, frame: Outgoing) {
        if self.rev_of(session, file).is_some() {
            to_channel(&mut self.waiting, sinks, session, file, frame);
        } else if let Some(sink) = sinks.get(&session) {
            sink.send(&frame);
        }
    }

    fn send_threads(&mut self, sinks: &Sinks, file: &str) {
        let Ok(threads) = self.doc.comment_threads(file) else {
            return;
        };
        for session in sinks.keys() {
            let frame = Outgoing::Threads {
                file_id: file.to_string(),
                rev: self.rev_of(*session, file),
                threads: threads.clone(),
            };
            self.send_to_session(sinks, *session, file, frame);
        }
    }

    fn send_threads_if_any(&mut self, sinks: &Sinks, file: &str) {
        if self
            .doc
            .comment_threads(file)
            .is_ok_and(|threads| !threads.is_empty())
        {
            self.send_threads(sinks, file);
        }
    }

    fn send_suggestions(&mut self, sinks: &Sinks, file: &str) {
        let suggestions = pending_core::suggestions(&self.doc, file);
        self.send_suggestion_list(sinks, file, suggestions);
    }

    fn send_suggestion_list(&mut self, sinks: &Sinks, file: &str, suggestions: Vec<Value>) {
        for session in sinks.keys() {
            let frame = Outgoing::Suggestions {
                file_id: file.to_string(),
                rev: self.rev_of(*session, file),
                suggestions: suggestions.clone(),
            };
            self.send_to_session(sinks, *session, file, frame);
        }
    }

    fn send_suggestions_if_any(&mut self, sinks: &Sinks, file: &str) {
        let suggestions = pending_core::suggestions(&self.doc, file);
        if !suggestions.is_empty() {
            self.send_suggestion_list(sinks, file, suggestions);
        }
    }

    fn send_chat(&self, sinks: &Sinks) {
        let messages = pending_core::chat_messages(&self.doc);
        for sink in sinks.values() {
            sink.send(&Outgoing::Chat {
                messages: messages.clone(),
            });
        }
    }

    pub fn greet(&self, sink: &Sink) {
        for file in self.doc.commented_files() {
            if let Ok(threads) = self.doc.comment_threads(&file) {
                if !threads.is_empty() {
                    sink.send(&Outgoing::Threads {
                        file_id: file,
                        rev: None,
                        threads,
                    });
                }
            }
        }
        for file in self.doc.suggestion_counts().into_keys() {
            let suggestions = pending_core::suggestions(&self.doc, &file);
            if !suggestions.is_empty() {
                sink.send(&Outgoing::Suggestions {
                    file_id: file,
                    rev: None,
                    suggestions,
                });
            }
        }
        sink.send(&Outgoing::Chat {
            messages: pending_core::chat_messages(&self.doc),
        });
    }

    fn reset_one(&mut self, sinks: &Sinks, session: u64, file: &str) {
        let Ok(text) = self.doc.text(file) else {
            return;
        };
        let Some(channel) = self
            .channels
            .get_mut(file)
            .and_then(|channels| channels.get_mut(&session))
        else {
            return;
        };
        let rev = channel.reset(text.clone());
        let reset = Outgoing::Reset {
            file_id: file.to_string(),
            rev,
            text,
        };
        to_channel(&mut self.waiting, sinks, session, file, reset);
    }

    fn open(
        &mut self,
        sinks: &Sinks,
        session: u64,
        file: &str,
        resumed: Option<bool>,
    ) -> Result<(), Refusal> {
        if !self.is_text(file) {
            return Err(not_found());
        }
        let text = self.doc.text(file).map_err(|_| not_found())?;
        let key = (session, file.to_string());
        let start = self
            .rev_of(session, file)
            .or_else(|| self.retired.remove(&key))
            .map_or(0, |rev| rev + 1);
        let channel = EditorChannel::starting_at(text.clone(), start);
        let rev = channel.rev();
        self.channels
            .entry(file.to_string())
            .or_default()
            .insert(session, channel);
        let opened = Outgoing::Opened {
            file_id: file.to_string(),
            rev,
            text,
            resumed,
        };
        to_channel(&mut self.waiting, sinks, session, file, opened);
        let threads = Outgoing::Threads {
            file_id: file.to_string(),
            rev: Some(rev),
            threads: self.doc.comment_threads(file).unwrap_or_default(),
        };
        to_channel(&mut self.waiting, sinks, session, file, threads);
        let suggestions = Outgoing::Suggestions {
            file_id: file.to_string(),
            rev: Some(rev),
            suggestions: pending_core::suggestions(&self.doc, file),
        };
        to_channel(&mut self.waiting, sinks, session, file, suggestions);
        Ok(())
    }

    fn close(&mut self, session: u64, file: &str) {
        self.waiting.remove(&(session, file.to_string()));
        let Some(channels) = self.channels.get_mut(file) else {
            return;
        };
        if let Some(channel) = channels.remove(&session) {
            self.retired
                .insert((session, file.to_string()), channel.rev());
        }
        if channels.is_empty() {
            self.channels.remove(file);
        }
    }

    fn forget(&mut self, session: u64) {
        self.waiting.retain(|(owner, _), _| *owner != session);
        for channels in self.channels.values_mut() {
            channels.remove(&session);
        }
        self.channels.retain(|_, channels| !channels.is_empty());
        self.retired.retain(|(owner, _), _| *owner != session);
    }

    fn spread(
        &mut self,
        sinks: &Sinks,
        file: &str,
        except: Option<u64>,
        operation: &TextOperation,
    ) {
        let mut broken = Vec::new();
        if let Some(channels) = self.channels.get_mut(file) {
            for (session, channel) in channels.iter_mut() {
                if Some(*session) == except {
                    continue;
                }
                if channel.remote(operation.clone()).is_err() {
                    broken.push(*session);
                    continue;
                }
                let remote = Outgoing::Remote {
                    file_id: file.to_string(),
                    rev: channel.rev(),
                    op: operation.clone(),
                    length: channel.length(),
                };
                to_channel(&mut self.waiting, sinks, *session, file, remote);
            }
        }
        for session in broken {
            self.reset_one(sinks, session, file);
        }
    }

    fn deliver(&mut self, sinks: &Sinks, changes: DocChanges) {
        let mut touched: BTreeSet<String> = BTreeSet::new();
        for (file, deltas) in &changes.texts {
            touched.insert(file.clone());
            let mut broken = Vec::new();
            if let Some(channels) = self.channels.get_mut(file) {
                for (session, channel) in channels.iter_mut() {
                    let routed = channel.operation_for(deltas).ok().and_then(|operation| {
                        channel.remote(operation.clone()).ok().map(|()| operation)
                    });
                    match routed {
                        Some(operation) => {
                            let remote = Outgoing::Remote {
                                file_id: file.clone(),
                                rev: channel.rev(),
                                op: operation,
                                length: channel.length(),
                            };
                            to_channel(&mut self.waiting, sinks, *session, file, remote);
                        }
                        None => broken.push(*session),
                    }
                }
            }
            for session in broken {
                self.reset_one(sinks, session, file);
            }
        }
        if changes.tree {
            self.tree_changed(sinks);
        }
        let commented = changes.comments.files();
        for file in &commented {
            self.send_threads(sinks, file);
        }
        for file in touched.difference(&commented) {
            self.send_threads_if_any(sinks, file);
        }
        let suggested: BTreeSet<String> = pending_core::suggestion_files(&self.doc, &changes)
            .into_iter()
            .collect();
        for file in &suggested {
            self.send_suggestions(sinks, file);
        }
        for file in touched.difference(&suggested) {
            self.send_suggestions_if_any(sinks, file);
        }
        if pending_core::chat_changed(&changes) {
            self.send_chat(sinks);
        }
        self.compile_changed(sinks);
    }

    fn compile_changed(&mut self, sinks: &Sinks) {
        let compile = self.doc.settings();
        if compile == self.compile {
            return;
        }
        self.compile = compile;
        self.send_compile(sinks);
    }

    fn send_compile(&self, sinks: &Sinks) {
        for sink in sinks.values() {
            sink.send(&Outgoing::Compile {
                settings: self.compile.clone(),
            });
        }
    }

    fn texts(&self) -> Vec<WebText> {
        self.files
            .iter()
            .filter(|file| file.kind == "text")
            .filter_map(|file| {
                let text = self.doc.text(&file.file_id).ok()?;
                Some(WebText {
                    file_id: file.file_id.clone(),
                    path: file.path.clone(),
                    text,
                })
            })
            .collect()
    }

    fn tree_changed(&mut self, sinks: &Sinks) {
        let files = files_of(&self.doc);
        if files == self.files {
            return;
        }
        self.files = files;
        let alive: BTreeSet<&str> = self
            .files
            .iter()
            .filter(|file| file.kind == "text")
            .map(|file| file.file_id.as_str())
            .collect();
        self.channels
            .retain(|file, _| alive.contains(file.as_str()));
        for sink in sinks.values() {
            sink.send(&Outgoing::Tree {
                files: self.files.clone(),
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn local_change(
        &mut self,
        sinks: &Sinks,
        session: u64,
        device: DeviceId,
        account: AccountId,
        file: &str,
        rev: u64,
        operation: TextOperation,
        suggesting: bool,
        now: i64,
    ) -> Result<Taken, Failed> {
        if self.frozen {
            return Ok(Taken::Skipped);
        }
        let received = {
            let channel = self
                .channels
                .get_mut(file)
                .and_then(|channels| channels.get_mut(&session))
                .ok_or_else(|| Failed {
                    refusal: not_open(),
                    dirty: false,
                })?;
            match channel.receive(rev, operation) {
                Ok(applied) => Some((applied, channel.rev(), channel.length())),
                Err(ChannelError::BeforeReset) => return Ok(Taken::Skipped),
                Err(ChannelError::Stale | ChannelError::Invalid(_)) => None,
            }
        };
        let Some((applied, acked, length)) = received else {
            self.reset_one(sinks, session, file);
            return Ok(Taken::Skipped);
        };
        let before = self.doc.version();
        let peer = match self.writer(device) {
            Ok(peer) => peer,
            Err(refusal) => {
                self.reset_one(sinks, session, file);
                return Err(Failed {
                    refusal,
                    dirty: false,
                });
            }
        };
        let tracked = suggesting || !pending_core::suggestions(&self.doc, file).is_empty();
        let outcome = if suggesting {
            pending_core::suggest_operation(&mut self.doc, file, &applied, account, device, now)
        } else {
            pending_core::edit_operation(&mut self.doc, file, &applied)
        };
        if let Err(refusal) = outcome {
            let dirty = self.doc.has_changes_since(&before);
            if !dirty {
                self.reset_one(sinks, session, file);
            }
            return Err(Failed { refusal, dirty });
        }
        let ack = Outgoing::Ack {
            file_id: file.to_string(),
            rev: acked,
            length,
        };
        if !self.doc.has_changes_since(&before) {
            self.spread(sinks, file, Some(session), &applied);
            return Ok(Taken::Applied {
                ack,
                written: None,
                tracked: false,
            });
        }
        let payload = self.doc.export_since(&before).map_err(|_| Failed {
            refusal: Refusal::server(),
            dirty: true,
        })?;
        self.spread(sinks, file, Some(session), &applied);
        Ok(Taken::Applied {
            ack,
            written: Some(Written {
                payload,
                peer,
                texts: Vec::new(),
                threads: Vec::new(),
            }),
            tracked,
        })
    }

    fn changed(&mut self, sinks: &Sinks, file: &str, tracked: bool) {
        self.send_threads_if_any(sinks, file);
        if tracked {
            self.send_suggestions(sinks, file);
        }
    }

    fn hold_ack(&mut self, session: u64, file: &str, order: u64, frame: Outgoing) {
        self.waiting
            .entry((session, file.to_string()))
            .or_default()
            .push_back(Waiting::Ack { order, frame });
    }

    fn file_of_thread(&self, thread: CommentId) -> Result<String, Refusal> {
        self.doc
            .commented_files()
            .into_iter()
            .find(|file| matches!(self.doc.comment_thread(file, thread), Ok(Some(_))))
            .ok_or_else(|| Refusal::new("not_found", "This comment thread is gone."))
    }

    fn write(
        &mut self,
        device: DeviceId,
        now: i64,
        threads: Vec<String>,
        work: impl FnOnce(&mut ProjectDoc, i64) -> Result<(), Refusal>,
    ) -> Result<Option<Written>, Failed> {
        if self.frozen {
            return Err(Failed {
                refusal: busy(),
                dirty: false,
            });
        }
        let open: Vec<String> = self.channels.keys().cloned().collect();
        let texts_before: Vec<(String, String)> = open
            .iter()
            .filter_map(|file| self.doc.text(file).ok().map(|text| (file.clone(), text)))
            .collect();
        let before = self.doc.version();
        let peer = self.writer(device).map_err(|refusal| Failed {
            refusal,
            dirty: false,
        })?;
        if let Err(refusal) = work(&mut self.doc, now) {
            return Err(Failed {
                refusal,
                dirty: self.doc.has_changes_since(&before),
            });
        }
        if !self.doc.has_changes_since(&before) {
            return Ok(None);
        }
        let payload = self.doc.export_since(&before).map_err(|_| Failed {
            refusal: Refusal::server(),
            dirty: true,
        })?;
        let texts = texts_before
            .into_iter()
            .filter(|(file, text)| self.doc.text(file).ok().as_ref() != Some(text))
            .collect();
        Ok(Some(Written {
            payload,
            peer,
            texts,
            threads,
        }))
    }

    fn comment(
        &mut self,
        session: u64,
        device: DeviceId,
        account: AccountId,
        action: CommentAction,
        members: &[CommentMember],
        now: i64,
    ) -> Result<Option<Written>, Failed> {
        let file = match action.named_file() {
            Some(file) => file.to_string(),
            None => {
                let thread = action.thread().ok_or_else(|| Failed {
                    refusal: Refusal::new("invalid", "This comment action is not valid."),
                    dirty: false,
                })?;
                self.file_of_thread(thread).map_err(|refusal| Failed {
                    refusal,
                    dirty: false,
                })?
            }
        };
        if let CommentAction::Create { rev: Some(rev), .. } = &action {
            if self.rev_of(session, &file) != Some(*rev) {
                return Err(Failed {
                    refusal: Refusal::new(
                        "comment_selection_changed",
                        "The text changed while the comment was written.",
                    ),
                    dirty: false,
                });
            }
        }
        let collab = |error: oleafly_collab::CollabError| Refusal::from_collab(&error);
        let target = file.clone();
        self.write(device, now, vec![file], move |doc, now| match action {
            CommentAction::Create { from, to, body, .. } => doc
                .create_comment_thread(
                    &target,
                    from,
                    to,
                    account,
                    now,
                    &body,
                    &mentions_in(&body, members),
                )
                .map(drop)
                .map_err(collab),
            CommentAction::Reply {
                thread_id, body, ..
            } => doc
                .reply_to_comment(
                    &target,
                    thread_id,
                    account,
                    now,
                    &body,
                    &mentions_in(&body, members),
                )
                .map(drop)
                .map_err(collab),
            CommentAction::Edit {
                thread_id,
                message_id,
                body,
                ..
            } => doc
                .edit_comment(
                    &target,
                    thread_id,
                    message_id,
                    account,
                    now,
                    &body,
                    &mentions_in(&body, members),
                )
                .map(drop)
                .map_err(collab),
            CommentAction::Delete {
                thread_id,
                message_id,
                ..
            } => doc
                .delete_comment(&target, thread_id, message_id, account)
                .map_err(collab),
            CommentAction::DeleteThread { thread_id, .. } => doc
                .delete_comment_thread(&target, thread_id, account)
                .map_err(collab),
            CommentAction::Resolve { thread_id, .. } => doc
                .resolve_comment_thread(&target, thread_id, account, now)
                .map_err(collab),
            CommentAction::Reopen { thread_id, .. } => doc
                .reopen_comment_thread(&target, thread_id)
                .map_err(collab),
        })
    }

    fn after_write(&mut self, sinks: &Sinks, written: &Effects) {
        for (file, before) in &written.texts {
            let Ok(after) = self.doc.text(file) else {
                continue;
            };
            let operation = TextOperation::between(before, &after);
            if !operation.is_noop() {
                self.spread(sinks, file, None, &operation);
            }
        }
        for file in &written.threads {
            self.send_threads(sinks, file);
        }
        for file in &written.suggestions {
            self.send_suggestions(sinks, file);
        }
        if written.chat {
            self.send_chat(sinks);
        }
    }

    fn adopt(&mut self, mut old: Carried, sinks: &Sinks) {
        let changed = old.files != self.files;
        let compiled = old.compile != self.compile;
        self.writers = std::mem::take(&mut old.writers);
        for (file, channels) in old.channels.drain() {
            let Ok(text) = self.doc.text(&file) else {
                continue;
            };
            let mut kept = HashMap::new();
            for (session, mut channel) in channels {
                let rev = channel.reset(text.clone());
                if let Some(sink) = sinks.get(&session) {
                    sink.send(&Outgoing::Reset {
                        file_id: file.clone(),
                        rev,
                        text: text.clone(),
                    });
                }
                kept.insert(session, channel);
            }
            self.channels.insert(file, kept);
        }
        self.retired = std::mem::take(&mut old.retired);
        if changed {
            for sink in sinks.values() {
                sink.send(&Outgoing::Tree {
                    files: self.files.clone(),
                });
            }
        }
        if compiled {
            self.send_compile(sinks);
        }
        let files: Vec<String> = self.channels.keys().cloned().collect();
        for file in files {
            self.send_threads(sinks, &file);
            self.send_suggestions(sinks, &file);
        }
    }
}

#[derive(Default)]
struct Effects {
    texts: Vec<(String, String)>,
    threads: Vec<String>,
    suggestions: Vec<String>,
    chat: bool,
}

impl WebRoom {
    fn new(project: SharedProjectId) -> WebRoom {
        WebRoom {
            project,
            doc: tokio::sync::Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            outbox: Mutex::new(Outbox::default()),
            progress: watch::channel(0).0,
        }
    }

    pub async fn settled(&self, session: u64) {
        let mut progress = self.progress.subscribe();
        while locked(&self.outbox).pending(session) > 0 {
            if progress.changed().await.is_err() {
                return;
            }
        }
    }

    fn finished(&self, sessions: &[u64], through: u64) {
        let mut outbox = locked(&self.outbox);
        for session in sessions {
            outbox.finish(*session);
        }
        drop(outbox);
        self.progress
            .send_modify(|done| *done = (*done).max(through));
    }

    async fn reload_when_idle(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
    ) {
        if locked(&self.outbox).busy() {
            if let Some(room) = guard.as_mut() {
                room.frozen = true;
            }
            return;
        }
        self.reload(state, guard).await;
    }

    #[allow(clippy::too_many_arguments)]
    fn enqueue(
        self: &Arc<Self>,
        state: &AppState,
        room: &mut RoomDoc,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        written: Written,
        change: Option<String>,
        reply: Option<Reply>,
        ack: Option<(&str, Outgoing)>,
    ) {
        let order = locked(&self.outbox).next_order();
        if let Some((file, frame)) = ack {
            room.hold_ack(session, file, order, frame);
        }
        if let Some(id) = change.as_deref() {
            state
                .web
                .note(self.project, peer.device, id, Fate::Queued(order));
        }
        let size = written.payload.len() as u64;
        let mut envelope = Envelope {
            v: 1,
            project_id: self.project,
            batch_id: BatchId::new_v7(),
            device_id: peer.device,
            mode: EnvelopeMode::Plain,
            key_epoch: None,
            payload: written.payload,
            signature: Vec::new(),
        };
        envelope.signature = key.sign(&envelope.signing_bytes()).as_ref().to_vec();
        let start = locked(&self.outbox).push(Queued {
            order,
            session,
            writer: Writer::of(peer),
            envelope,
            peer: written.peer,
            size,
            change,
            reply,
        });
        if start {
            let room = Arc::clone(self);
            let state = state.clone();
            tokio::spawn(async move { room.drain(state).await });
        }
    }

    async fn drain(self: Arc<Self>, state: AppState) {
        loop {
            let next = locked(&self.outbox).pop();
            let Some(next) = next else {
                let mut guard = self.doc.lock().await;
                if !locked(&self.outbox).rest() {
                    continue;
                }
                if guard.as_ref().is_some_and(|room| room.frozen) {
                    self.reload(&state, &mut guard).await;
                }
                return;
            };
            let Queued {
                order,
                session,
                writer,
                envelope,
                peer,
                size,
                change,
                reply,
            } = next;
            let cursors = CursorGate::new();
            let answer = writer
                .peer(&state, &cursors)
                .update(self.project, envelope)
                .await;
            let mut guard = self.doc.lock().await;
            let sinks = self.sinks();
            let done = Done {
                order,
                session,
                writer,
                peer,
                size,
                change,
                reply,
            };
            match answer {
                ServerFrame::Ack { seq, .. } => self.stored(&state, &mut guard, &sinks, seq, done),
                refused => {
                    self.refused(&state, &mut guard, &sinks, refused, done)
                        .await
                }
            }
        }
    }

    fn stored(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        sinks: &Sinks,
        seq: u64,
        done: Done,
    ) {
        let Done {
            order,
            session,
            writer,
            peer,
            size,
            change,
            reply,
        } = done;
        if let Some(room) = guard.as_mut() {
            if seq > 0 {
                room.mark(seq);
            }
            room.witness(&[ProjectPeer {
                peer,
                device_id: writer.device,
                account_id: writer.account,
            }]);
            release(&mut room.waiting, sinks, order);
            if !room.held.grow(&state.snapshots, read_cost(0, size)) {
                self.unload(guard, sinks, busy());
            }
        }
        if let Some(id) = change.as_deref() {
            state
                .web
                .note(self.project, writer.device, id, Fate::Applied);
        }
        if let Some(reply) = reply {
            let _ = reply.send(Ok(()));
        }
        self.finished(&[session], order);
    }

    async fn refused(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        sinks: &Sinks,
        refused: ServerFrame,
        done: Done,
    ) {
        let Done {
            order,
            session,
            writer,
            change,
            reply,
            ..
        } = done;
        let refusal = match refused {
            ServerFrame::Error { code, message } => Refusal::from_frame(code, &message),
            _ => Refusal::server(),
        };
        let cancelled = locked(&self.outbox).cancel();
        self.reload(state, guard).await;
        match reply {
            Some(reply) => {
                let _ = reply.send(Err(refusal));
            }
            None => {
                if let Some(sink) = sinks.get(&session) {
                    sink.send(&Outgoing::error(&refusal.code, &refusal.message, None));
                }
            }
        }
        let mut sessions = vec![session];
        let mut through = order;
        let abandoned = change.map(|id| (id, writer.device)).into_iter().chain(
            cancelled
                .iter()
                .filter_map(|queued| queued.change.clone().map(|id| (id, queued.writer.device))),
        );
        for (id, device) in abandoned {
            state.web.note(self.project, device, &id, Fate::Abandoned);
        }
        for queued in cancelled {
            sessions.push(queued.session);
            through = through.max(queued.order);
            if let Some(reply) = queued.reply {
                let _ = reply.send(Err(Refusal::new(
                    "conflict",
                    "A change this one built on was refused. Try again.",
                )));
            }
        }
        self.finished(&sessions, through);
    }

    fn sinks(&self) -> Sinks {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn join(&self, session: u64, sink: Sink) {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(session, sink);
    }

    pub async fn leave(&self, session: u64) {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&session);
        if let Some(room) = self.doc.lock().await.as_mut() {
            room.forget(session);
        }
    }

    pub async fn ready(&self, state: &AppState) -> Result<Vec<WebFile>, Refusal> {
        let mut guard = self.doc.lock().await;
        if guard.is_none() {
            *guard = Some(load(state, self.project).await?);
        } else {
            self.catch_up(state, &mut guard).await;
        }
        guard
            .as_ref()
            .map(|room| room.files.clone())
            .ok_or_else(cannot_open)
    }

    pub async fn compile(&self) -> Settings {
        self.doc
            .lock()
            .await
            .as_ref()
            .map(|room| room.compile.clone())
            .unwrap_or_default()
    }

    pub async fn texts(&self) -> Result<Vec<WebText>, Refusal> {
        self.doc
            .lock()
            .await
            .as_ref()
            .map(RoomDoc::texts)
            .ok_or_else(cannot_open)
    }

    pub async fn greet(&self, session: u64) {
        let sinks = self.sinks();
        let guard = self.doc.lock().await;
        if let (Some(room), Some(sink)) = (guard.as_ref(), sinks.get(&session)) {
            room.greet(sink);
        }
    }

    pub async fn open_file(
        &self,
        hub: &Hub,
        device: DeviceId,
        session: u64,
        file: &str,
        resume: Option<String>,
    ) -> Result<(), Refusal> {
        let resume = change_id(resume);
        if let Some(Fate::Queued(order)) = resume
            .as_deref()
            .and_then(|id| hub.fate(self.project, device, id))
        {
            let mut progress = self.progress.subscribe();
            let _ = progress.wait_for(|done| *done >= order).await;
        }
        let sinks = self.sinks();
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let resumed = resume.map(|id| hub.resumed(self.project, device, &id));
        room.open(&sinks, session, file, resumed)
    }

    pub async fn close_file(&self, session: u64, file: &str) {
        if let Some(room) = self.doc.lock().await.as_mut() {
            room.close(session, file);
        }
    }

    pub async fn output_changed(&self, state: &AppState) {
        let project = self.project;
        let Ok(listed) = state
            .db
            .read(move |conn| outputs::list(conn, project))
            .await
        else {
            return;
        };
        let items: Vec<WebOutput> = listed.into_iter().map(WebOutput::from).collect();
        for sink in self.sinks().values() {
            sink.send(&Outgoing::Output {
                items: items.clone(),
            });
        }
    }

    pub async fn receive(&self, state: &AppState, seq: u64, envelope: Envelope) {
        let mut guard = self.doc.lock().await;
        let Some(room) = guard.as_ref() else {
            return;
        };
        if room.knows(seq) {
            return;
        }
        if seq == room.seq + 1 {
            self.take_in(state, &mut guard, seq, envelope.payload).await;
        } else {
            self.catch_up(state, &mut guard).await;
        }
    }

    async fn catch_up(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
    ) {
        let project = self.project;
        loop {
            let Some(after) = guard.as_ref().map(|room| room.seq) else {
                return;
            };
            let page = state
                .db
                .read(move |conn| {
                    let page = projects::updates_since(conn, project, after)?;
                    let full =
                        projects::page_is_full(page.iter().map(|stored| stored.envelope.len()));
                    Ok((page, full))
                })
                .await;
            let Ok((page, full)) = page else {
                return;
            };
            if page.is_empty() {
                return;
            }
            if page[0].seq != after + 1 {
                self.reload_when_idle(state, guard).await;
                return;
            }
            for stored in page {
                match serde_json::from_slice::<Envelope>(&stored.envelope) {
                    Ok(envelope) => {
                        self.take_in(state, guard, stored.seq, envelope.payload)
                            .await
                    }
                    Err(_) => {
                        if let Some(room) = guard.as_mut() {
                            room.mark(stored.seq);
                        }
                    }
                }
            }
            if !full {
                return;
            }
        }
    }

    async fn take_in(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        seq: u64,
        payload: Vec<u8>,
    ) {
        let project = self.project;
        let introduced = match guard.as_ref() {
            Some(room) if !room.knows(seq) => {
                room.doc.introduced_peers(&payload).unwrap_or_default()
            }
            _ => return,
        };
        if !introduced.is_empty() {
            if let Ok(rows) = state
                .db
                .read(move |conn| peers::rows_for(conn, project, &introduced))
                .await
            {
                if let Some(room) = guard.as_mut() {
                    room.witness(&rows);
                }
            }
        }
        let cost = read_cost(0, payload.len() as u64);
        let imported = if payload.len() >= ASIDE_BYTES {
            let Some(mut room) = guard.take() else {
                return;
            };
            let Ok((room, imported)) = tokio::task::spawn_blocking(move || {
                let imported = room.doc.import(&payload);
                (room, imported)
            })
            .await
            else {
                self.unload(guard, &self.sinks(), cannot_open());
                return;
            };
            **guard = Some(room);
            imported
        } else {
            match guard.as_mut() {
                Some(room) => room.doc.import(&payload),
                None => return,
            }
        };
        let sinks = self.sinks();
        let Some(room) = guard.as_mut() else {
            return;
        };
        room.mark(seq);
        let Ok(imported) = imported else {
            return;
        };
        if !room.held.grow(&state.snapshots, cost) {
            self.unload(guard, &sinks, busy());
            return;
        }
        room.deliver(&sinks, imported.changes);
    }

    fn unload(
        &self,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        sinks: &Sinks,
        refusal: Refusal,
    ) {
        if let Some(room) = guard.take() {
            free(room);
        }
        for sink in sinks.values() {
            sink.send(&Outgoing::error(&refusal.code, &refusal.message, None));
            sink.close();
        }
    }

    async fn reload(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
    ) {
        let old = guard.take().map(RoomDoc::release);
        let sinks = self.sinks();
        match load(state, self.project).await {
            Ok(mut fresh) => {
                if let Some(old) = old {
                    fresh.adopt(old, &sinks);
                }
                **guard = Some(fresh);
            }
            Err(refusal) => self.unload(guard, &sinks, refusal),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn change(
        self: &Arc<Self>,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        file: &str,
        rev: u64,
        operation: TextOperation,
        suggesting: bool,
        id: Option<String>,
    ) -> Result<(), Refusal> {
        let sinks = self.sinks();
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let id = change_id(id);
        if let Some(id) = id.as_deref() {
            if state.web.fate(self.project, peer.device, id).is_some() {
                return Ok(());
            }
        }
        let now = state.clock.now_ms();
        let taken = room.local_change(
            &sinks,
            session,
            peer.device,
            peer.account,
            file,
            rev,
            operation,
            suggesting,
            now,
        );
        match taken {
            Ok(Taken::Skipped) => Ok(()),
            Ok(Taken::Applied {
                ack, written: None, ..
            }) => {
                to_channel(&mut room.waiting, &sinks, session, file, ack);
                if let Some(id) = id.as_deref() {
                    state.web.note(self.project, peer.device, id, Fate::Applied);
                }
                Ok(())
            }
            Ok(Taken::Applied {
                ack,
                written: Some(written),
                tracked,
            }) => {
                self.enqueue(
                    state,
                    room,
                    peer,
                    key,
                    session,
                    written,
                    id,
                    None,
                    Some((file, ack)),
                );
                room.changed(&sinks, file, tracked);
                Ok(())
            }
            Err(failed) => {
                if failed.dirty {
                    self.reload_when_idle(state, &mut guard).await;
                }
                Err(failed.refusal)
            }
        }
    }

    #[cfg(feature = "test-support")]
    pub async fn ask_reload(&self, state: &AppState) {
        let mut guard = self.doc.lock().await;
        self.reload_when_idle(state, &mut guard).await;
    }

    pub async fn reset_file(&self, session: u64, file: &str) {
        let sinks = self.sinks();
        if let Some(room) = self.doc.lock().await.as_mut() {
            room.reset_one(&sinks, session, file);
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn finish_write(
        self: &Arc<Self>,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        outcome: Result<Option<Written>, Failed>,
        applied: Applied,
    ) -> Result<Answer, Refusal> {
        let written = match outcome {
            Ok(Some(written)) => written,
            Ok(None) => return Ok(Answer::Done),
            Err(failed) => {
                if failed.dirty {
                    self.reload_when_idle(state, guard).await;
                }
                return Err(failed.refusal);
            }
        };
        let effects = Effects {
            texts: written.texts.clone(),
            threads: written.threads.clone(),
            suggestions: applied.suggestions,
            chat: applied.chat,
        };
        let sinks = self.sinks();
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        room.after_write(&sinks, &effects);
        let (reply, answer) = oneshot::channel();
        self.enqueue(
            state,
            room,
            peer,
            key,
            session,
            written,
            None,
            Some(reply),
            None,
        );
        Ok(Answer::Later(answer))
    }

    pub(crate) async fn comment(
        self: &Arc<Self>,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        action: CommentAction,
        members: &[CommentMember],
    ) -> Result<Answer, Refusal> {
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let now = state.clock.now_ms();
        let outcome = room.comment(session, peer.device, peer.account, action, members, now);
        self.finish_write(
            state,
            &mut guard,
            peer,
            key,
            session,
            outcome,
            Applied::default(),
        )
        .await
    }

    pub(crate) async fn apply(
        self: &Arc<Self>,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        work: impl FnOnce(&mut ProjectDoc, i64) -> Result<Applied, Refusal>,
    ) -> Result<Answer, Refusal> {
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let now = state.clock.now_ms();
        let mut applied = Applied::default();
        let outcome = room.write(peer.device, now, Vec::new(), |doc, now| {
            applied = work(doc, now)?;
            Ok(())
        });
        self.finish_write(state, &mut guard, peer, key, session, outcome, applied)
            .await
    }
}

#[derive(Debug, Default)]
pub struct Applied {
    pub suggestions: Vec<String>,
    pub chat: bool,
}
