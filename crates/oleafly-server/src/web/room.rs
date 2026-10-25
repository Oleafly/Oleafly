use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use oleafly_collab::comments::{mentions_in, CommentMember};
use oleafly_collab::doc::{DocChanges, NodeKind, ProjectDoc};
use oleafly_collab::editor::{ChannelError, EditorChannel};
use oleafly_collab::materialize;
use oleafly_collab::ot::TextOperation;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, BatchId, CommentId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::Ed25519KeyPair;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::UnboundedSender;

use crate::outputs;
use crate::peers;
use crate::projects;
use crate::routes::ws::{Peer, ASIDE_BYTES};
use crate::snapshots::{read_cost, Current, Held};
use crate::sockets::SocketControl;
use crate::state::AppState;
use crate::web::frames::{CommentAction, Outgoing, WebFile, WebOutput};
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

#[derive(Default)]
pub struct Hub {
    rooms: Mutex<HashMap<SharedProjectId, Weak<WebRoom>>>,
    sessions: AtomicU64,
}

impl Hub {
    fn lock(&self) -> MutexGuard<'_, HashMap<SharedProjectId, Weak<WebRoom>>> {
        self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
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

    pub fn linger(room: Arc<WebRoom>) {
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                tokio::time::sleep(LINGER).await;
                drop(room);
            });
        }
    }
}

pub struct WebRoom {
    project: SharedProjectId,
    doc: tokio::sync::Mutex<Option<RoomDoc>>,
    sessions: Mutex<Sinks>,
}

impl Drop for WebRoom {
    fn drop(&mut self) {
        if let Some(room) = self.doc.get_mut().take() {
            free(room);
        }
    }
}

fn free(room: RoomDoc) {
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => {
            drop(runtime.spawn_blocking(move || drop(room)));
        }
        Err(_) => drop(room),
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

pub struct RoomDoc {
    doc: ProjectDoc,
    held: Held,
    seq: u64,
    ahead: BTreeSet<u64>,
    channels: HashMap<String, HashMap<u64, EditorChannel>>,
    retired: HashMap<(u64, String), u64>,
    writers: HashMap<DeviceId, u64>,
    files: Vec<WebFile>,
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
    let bound = state
        .db
        .read(move |conn| peers::table(conn, project))
        .await
        .map_err(|_| cannot_open())?;
    let built = tokio::task::spawn_blocking(move || {
        let (replay, held) = budgeted.into_parts();
        let bytes = replay.finish()?;
        let mut doc = ProjectDoc::load_contained(&bytes).ok()?;
        let mut authorship = doc.authorship().clone();
        authorship.vouch(bound.iter().map(|row| (row.peer, row.account_id)));
        doc.set_authorship(authorship);
        let files = files_of(&doc);
        Some((doc, held, files))
    })
    .await
    .ok()
    .flatten();
    let Some((doc, held, files)) = built else {
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
        files,
    })
}

impl RoomDoc {
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
        let known = self.doc.version();
        let peer = *self
            .writers
            .entry(device)
            .or_insert_with(|| fresh_peer(&known));
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

    fn send_threads(&self, sinks: &Sinks, file: &str) {
        let Ok(threads) = self.doc.comment_threads(file) else {
            return;
        };
        for (session, sink) in sinks {
            sink.send(&Outgoing::Threads {
                file_id: file.to_string(),
                rev: self.rev_of(*session, file),
                threads: threads.clone(),
            });
        }
    }

    fn send_threads_if_any(&self, sinks: &Sinks, file: &str) {
        if self
            .doc
            .comment_threads(file)
            .is_ok_and(|threads| !threads.is_empty())
        {
            self.send_threads(sinks, file);
        }
    }

    fn send_suggestions(&self, sinks: &Sinks, file: &str) {
        let suggestions = pending_core::suggestions(&self.doc, file);
        self.send_suggestion_list(sinks, file, suggestions);
    }

    fn send_suggestion_list(&self, sinks: &Sinks, file: &str, suggestions: Vec<Value>) {
        for (session, sink) in sinks {
            sink.send(&Outgoing::Suggestions {
                file_id: file.to_string(),
                rev: self.rev_of(*session, file),
                suggestions: suggestions.clone(),
            });
        }
    }

    fn send_suggestions_if_any(&self, sinks: &Sinks, file: &str) {
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
        if let Some(sink) = sinks.get(&session) {
            sink.send(&Outgoing::Reset {
                file_id: file.to_string(),
                rev,
                text,
            });
        }
    }

    fn open(&mut self, sinks: &Sinks, session: u64, file: &str) -> Result<(), Refusal> {
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
        let Some(sink) = sinks.get(&session) else {
            return Ok(());
        };
        sink.send(&Outgoing::Opened {
            file_id: file.to_string(),
            rev,
            text,
        });
        sink.send(&Outgoing::Threads {
            file_id: file.to_string(),
            rev: Some(rev),
            threads: self.doc.comment_threads(file).unwrap_or_default(),
        });
        sink.send(&Outgoing::Suggestions {
            file_id: file.to_string(),
            rev: Some(rev),
            suggestions: pending_core::suggestions(&self.doc, file),
        });
        Ok(())
    }

    fn close(&mut self, session: u64, file: &str) {
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
                if let Some(sink) = sinks.get(session) {
                    sink.send(&Outgoing::Remote {
                        file_id: file.to_string(),
                        rev: channel.rev(),
                        op: operation.clone(),
                        length: channel.length(),
                    });
                }
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
                            if let Some(sink) = sinks.get(session) {
                                sink.send(&Outgoing::Remote {
                                    file_id: file.clone(),
                                    rev: channel.rev(),
                                    op: operation,
                                    length: channel.length(),
                                });
                            }
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
    ) -> Result<Option<Written>, Refusal> {
        let received = {
            let channel = self
                .channels
                .get_mut(file)
                .and_then(|channels| channels.get_mut(&session))
                .ok_or_else(not_open)?;
            match channel.receive(rev, operation) {
                Ok(applied) => Some((applied, channel.rev(), channel.length())),
                Err(ChannelError::BeforeReset) => return Ok(None),
                Err(ChannelError::Stale | ChannelError::Invalid(_)) => None,
            }
        };
        let Some((applied, acked, length)) = received else {
            self.reset_one(sinks, session, file);
            return Ok(None);
        };
        let before = self.doc.version();
        let peer = match self.writer(device) {
            Ok(peer) => peer,
            Err(refusal) => {
                self.reset_one(sinks, session, file);
                return Err(refusal);
            }
        };
        let tracked = suggesting || !pending_core::suggestions(&self.doc, file).is_empty();
        let outcome = if suggesting {
            pending_core::suggest_operation(&mut self.doc, file, &applied, account, device, now)
        } else {
            pending_core::edit_operation(&mut self.doc, file, &applied)
        };
        if let Err(refusal) = outcome {
            self.reset_one(sinks, session, file);
            return Err(refusal);
        }
        if let Some(sink) = sinks.get(&session) {
            sink.send(&Outgoing::Ack {
                file_id: file.to_string(),
                rev: acked,
                length,
            });
        }
        self.spread(sinks, file, Some(session), &applied);
        self.send_threads_if_any(sinks, file);
        if tracked {
            self.send_suggestions(sinks, file);
        }
        if !self.doc.has_changes_since(&before) {
            return Ok(None);
        }
        let payload = self
            .doc
            .export_since(&before)
            .map_err(|_| Refusal::server())?;
        Ok(Some(Written {
            payload,
            peer,
            texts: Vec::new(),
            threads: Vec::new(),
        }))
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

    fn adopt(&mut self, mut old: RoomDoc, sinks: &Sinks) {
        let changed = old.files != self.files;
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
        let files: Vec<String> = self.channels.keys().cloned().collect();
        for file in files {
            self.send_threads(sinks, &file);
            self.send_suggestions(sinks, &file);
        }
        free(old);
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
        }
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

    pub async fn greet(&self, session: u64) {
        let sinks = self.sinks();
        let guard = self.doc.lock().await;
        if let (Some(room), Some(sink)) = (guard.as_ref(), sinks.get(&session)) {
            room.greet(sink);
        }
    }

    pub async fn open_file(&self, session: u64, file: &str) -> Result<(), Refusal> {
        let sinks = self.sinks();
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        room.open(&sinks, session, file)
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
                self.reload(state, guard).await;
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
        let old = guard.take();
        let sinks = self.sinks();
        match load(state, self.project).await {
            Ok(mut fresh) => {
                if let Some(old) = old {
                    fresh.adopt(old, &sinks);
                }
                **guard = Some(fresh);
            }
            Err(refusal) => {
                if let Some(old) = old {
                    free(old);
                }
                self.unload(guard, &sinks, refusal);
            }
        }
    }

    async fn store(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        written: Written,
    ) -> Result<(), Refusal> {
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
        match peer.update(self.project, envelope).await {
            ServerFrame::Ack { seq, .. } => {
                let sinks = self.sinks();
                if let Some(room) = guard.as_mut() {
                    if seq > 0 {
                        room.mark(seq);
                    }
                    room.witness(&[ProjectPeer {
                        peer: written.peer,
                        device_id: peer.device,
                        account_id: peer.account,
                    }]);
                    if !room.held.grow(&state.snapshots, read_cost(0, size)) {
                        self.unload(guard, &sinks, busy());
                    }
                }
                Ok(())
            }
            ServerFrame::Error { code, message } => {
                self.reload(state, guard).await;
                Err(Refusal::from_frame(code, &message))
            }
            _ => {
                self.reload(state, guard).await;
                Err(Refusal::server())
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn change(
        &self,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        file: &str,
        rev: u64,
        operation: TextOperation,
        suggesting: bool,
    ) -> Result<(), Refusal> {
        let sinks = self.sinks();
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let now = state.clock.now_ms();
        let written = room.local_change(
            &sinks,
            session,
            peer.device,
            peer.account,
            file,
            rev,
            operation,
            suggesting,
            now,
        )?;
        match written {
            Some(written) => self.store(state, &mut guard, peer, key, written).await,
            None => Ok(()),
        }
    }

    pub async fn reset_file(&self, session: u64, file: &str) {
        let sinks = self.sinks();
        if let Some(room) = self.doc.lock().await.as_mut() {
            room.reset_one(&sinks, session, file);
        }
    }

    async fn finish_write(
        &self,
        state: &AppState,
        guard: &mut tokio::sync::MutexGuard<'_, Option<RoomDoc>>,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        outcome: Result<Option<Written>, Failed>,
        applied: Applied,
    ) -> Result<(), Refusal> {
        let written = match outcome {
            Ok(Some(written)) => written,
            Ok(None) => return Ok(()),
            Err(failed) => {
                if failed.dirty {
                    self.reload(state, guard).await;
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
        self.store(state, guard, peer, key, written).await?;
        let sinks = self.sinks();
        if let Some(room) = guard.as_mut() {
            room.after_write(&sinks, &effects);
        }
        Ok(())
    }

    pub(crate) async fn comment(
        &self,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        session: u64,
        action: CommentAction,
        members: &[CommentMember],
    ) -> Result<(), Refusal> {
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let now = state.clock.now_ms();
        let outcome = room.comment(session, peer.device, peer.account, action, members, now);
        self.finish_write(state, &mut guard, peer, key, outcome, Applied::default())
            .await
    }

    pub(crate) async fn apply(
        &self,
        state: &AppState,
        peer: &Peer<'_>,
        key: &Ed25519KeyPair,
        work: impl FnOnce(&mut ProjectDoc, i64) -> Result<Applied, Refusal>,
    ) -> Result<(), Refusal> {
        let mut guard = self.doc.lock().await;
        let room = guard.as_mut().ok_or_else(cannot_open)?;
        let now = state.clock.now_ms();
        let mut applied = Applied::default();
        let outcome = room.write(peer.device, now, Vec::new(), |doc, now| {
            applied = work(doc, now)?;
            Ok(())
        });
        self.finish_write(state, &mut guard, peer, key, outcome, applied)
            .await
    }
}

#[derive(Debug, Default)]
pub struct Applied {
    pub suggestions: Vec<String>,
    pub chat: bool,
}
