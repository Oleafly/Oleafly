use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use loro::{EncodedBlobMode, ExportMode, IdSpan, ImportBlobMetadata, LoroDoc, VersionVector, ID};
use oleafly_collab_protocol::ids::{AccountId, BatchId, DeviceId};
use oleafly_collab_protocol::projects::{
    project_role_allows, ProjectAction, ProjectDevice, ProjectRole,
};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use serde::{Deserialize, Serialize};

use crate::devices::{DeviceRegistry, NewDevice};
use crate::doc::{
    advance, decode_version, delta_to_operation, encode_version, DocChanges, ProjectDoc,
};
use crate::editor::{ChannelError, DocMessage, EditorChannel};
use crate::ot::TextOperation;
use crate::{write_atomic, CollabError};

pub type DocSink = Arc<dyn Fn(DocMessage) + Send + Sync>;

const DOC_FILE: &str = "doc.bin";
const STATE_FILE: &str = "sync.json";
const LOG_FILE: &str = "doc.log";
const DEVICES_FILE: &str = "devices.json";
const AUTHORS_FILE: &str = "authors.json";
const LOG_LIMIT: usize = 500;
pub const BATCH_BYTES: usize = 4 * 1024 * 1024;
const SMALLEST_BATCH_BYTES: usize = 16 * 1024;

struct OpenFile {
    channel: EditorChannel,
    sink: DocSink,
}

#[derive(Clone)]
pub struct Outgoing {
    pub batch: BatchId,
    pub payload: Vec<u8>,
    version: VersionVector,
    sent: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiskWork {
    pub texts: BTreeSet<String>,
    pub tree: bool,
}

impl DiskWork {
    pub fn is_empty(&self) -> bool {
        self.texts.is_empty() && !self.tree
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PeerCheck {
    Fine,
    Refused,
    Unknown(Vec<u64>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeReport {
    pub before: Vec<u8>,
    pub after: Vec<u8>,
    pub files: BTreeMap<String, u32>,
    pub authors: BTreeMap<AccountId, BTreeMap<String, u32>>,
}

struct CatchUp {
    before: VersionVector,
    files: BTreeMap<String, u32>,
    authors: BTreeMap<AccountId, BTreeMap<String, u32>>,
}

#[derive(Serialize, Deserialize)]
struct StoredState {
    last_seq: u64,
    #[serde(with = "crate::live::hex_bytes")]
    confirmed: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    anchor: Option<BatchId>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    offline_edits: HashMap<String, BTreeMap<u64, i32>>,
}

pub struct Arrival {
    pub seq: u64,
    pub payload: Vec<u8>,
    pub device: Option<DeviceId>,
    pub author: Option<AccountId>,
}

struct Received {
    arrival: Arrival,
    meta: Option<ImportBlobMetadata>,
    introduced: Vec<u64>,
    spans: Vec<(u64, i32, i32)>,
}

struct Piece {
    peer: u64,
    from: i32,
    to: i32,
    lamport: u32,
    deps: Vec<ID>,
}

impl Piece {
    fn atoms(&self) -> usize {
        usize::try_from(self.to - self.from).unwrap_or(0)
    }
}

fn update_meta(payload: &[u8]) -> Option<ImportBlobMetadata> {
    LoroDoc::decode_import_blob_meta(payload, true)
        .ok()
        .filter(|meta| meta.mode == EncodedBlobMode::Updates)
}

fn held_by_server(confirmed: &mut VersionVector, meta: &ImportBlobMetadata) {
    for (peer, end) in meta.partial_end_vv.iter() {
        let start = meta.partial_start_vv.get(peer).copied().unwrap_or(0);
        let held = confirmed.get(peer).copied().unwrap_or(0);
        if start <= held && held < *end {
            confirmed.set_end(ID::new(*peer, *end));
        }
    }
}

pub struct LiveProject {
    doc: ProjectDoc,
    last_seq: u64,
    confirmed: VersionVector,
    outgoing: Option<Outgoing>,
    open: HashMap<String, OpenFile>,
    disk: DiskWork,
    role: ProjectRole,
    received: u64,
    catch_up: Option<CatchUp>,
    seen: BTreeSet<u64>,
    persisted: Option<VersionVector>,
    log_records: usize,
    doc_replacements: u64,
    saving: Arc<Mutex<()>>,
    devices: DeviceRegistry,
    devices_dirty: bool,
    comments: crate::comments::CommentEvents,
    authors_dirty: bool,
    retired: HashMap<String, u64>,
    device: Option<DeviceId>,
    batch_limit: usize,
    unsendable: bool,
    told_unsendable: bool,
    anchor: Option<BatchId>,
    numbered: BTreeMap<u64, BatchId>,
    connected: bool,
    offline_edits: HashMap<String, BTreeMap<u64, i32>>,
}

fn read_log(path: &Path) -> Vec<Vec<u8>> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    let mut records = Vec::new();
    let mut at = 0;
    while at + 4 <= bytes.len() {
        let length =
            u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize;
        let Some(end) = at.checked_add(4 + length).filter(|end| *end <= bytes.len()) else {
            break;
        };
        records.push(bytes[at + 4..end].to_vec());
        at = end;
    }
    records
}

fn append_log(path: &Path, record: &[u8]) -> Result<(), CollabError> {
    use std::io::Write;
    let length = u32::try_from(record.len())
        .map_err(|_| CollabError::Corrupt("a change record is too large".to_owned()))?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| CollabError::Io(error.to_string()))?;
    let mut framed = Vec::with_capacity(record.len() + 4);
    framed.extend_from_slice(&length.to_le_bytes());
    framed.extend_from_slice(record);
    file.write_all(&framed)
        .and_then(|()| file.sync_data())
        .map_err(|error| CollabError::Io(error.to_string()))
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, CollabError> {
    serde_json::to_vec(value).map_err(|error| CollabError::Corrupt(error.to_string()))
}

enum SavedDocument {
    Unchanged,
    Appended(Vec<u8>),
    Replaced(Vec<u8>),
}

pub struct PendingSave {
    dir: PathBuf,
    document: SavedDocument,
    version: VersionVector,
    doc_replacements: u64,
    state: Vec<u8>,
    devices: Option<Vec<u8>>,
    authors: Option<Vec<u8>>,
}

impl PendingSave {
    pub fn write(&self) -> Result<(), CollabError> {
        let dir = &self.dir;
        std::fs::create_dir_all(dir).map_err(|error| CollabError::Io(error.to_string()))?;
        match &self.document {
            SavedDocument::Unchanged => {}
            SavedDocument::Appended(record) => append_log(&dir.join(LOG_FILE), record)?,
            SavedDocument::Replaced(snapshot) => {
                write_atomic(&dir.join(DOC_FILE), snapshot)?;
                match std::fs::remove_file(dir.join(LOG_FILE)) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(CollabError::Io(error.to_string())),
                }
            }
        }
        write_atomic(&dir.join(STATE_FILE), &self.state)?;
        if let Some(json) = &self.devices {
            write_atomic(&dir.join(DEVICES_FILE), json)?;
        }
        if let Some(json) = &self.authors {
            write_atomic(&dir.join(AUTHORS_FILE), json)?;
        }
        Ok(())
    }
}

fn hold(live: &Mutex<LiveProject>) -> MutexGuard<'_, LiveProject> {
    live.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn save_shared(live: &Mutex<LiveProject>, dir: &Path) -> Result<(), CollabError> {
    let saving = Arc::clone(&hold(live).saving);
    let _turn = saving.lock().unwrap_or_else(PoisonError::into_inner);
    let pending = hold(live).begin_save(dir)?;
    let written = pending.write();
    hold(live).end_save(pending, written)
}

impl LiveProject {
    pub fn new(doc: ProjectDoc, last_seq: u64, role: ProjectRole) -> LiveProject {
        let confirmed = doc.version();
        LiveProject {
            doc,
            last_seq,
            confirmed,
            outgoing: None,
            open: HashMap::new(),
            disk: DiskWork::default(),
            role,
            received: 0,
            catch_up: None,
            seen: BTreeSet::new(),
            persisted: None,
            log_records: 0,
            doc_replacements: 0,
            saving: Arc::default(),
            devices: DeviceRegistry::default(),
            devices_dirty: false,
            comments: crate::comments::CommentEvents::default(),
            authors_dirty: false,
            retired: HashMap::new(),
            device: None,
            batch_limit: BATCH_BYTES,
            unsendable: false,
            told_unsendable: false,
            anchor: None,
            numbered: BTreeMap::new(),
            connected: false,
            offline_edits: HashMap::new(),
        }
    }

    pub fn load(dir: &Path, role: ProjectRole) -> Result<LiveProject, CollabError> {
        let bytes = std::fs::read(dir.join(DOC_FILE))
            .map_err(|error| CollabError::Io(error.to_string()))?;
        let state: StoredState = serde_json::from_slice(
            &std::fs::read(dir.join(STATE_FILE))
                .map_err(|error| CollabError::Io(error.to_string()))?,
        )
        .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        let mut doc = ProjectDoc::load(&bytes)?;
        let records = read_log(&dir.join(LOG_FILE));
        let saved: Vec<&[u8]> = records.iter().map(Vec::as_slice).collect();
        if doc.import_all(&saved).is_err() {
            doc = ProjectDoc::load(&bytes)?;
            for record in &records {
                if doc.import(record).is_err() {
                    break;
                }
            }
        }
        let mut live = LiveProject::new(doc, state.last_seq, role);
        live.confirmed = decode_version(&state.confirmed)?;
        live.anchor = state.anchor;
        live.offline_edits = state.offline_edits;
        live.persisted = Some(live.doc.version());
        live.log_records = records.len();
        live.devices = DeviceRegistry::load(&dir.join(DEVICES_FILE));
        if let Some(authors) = std::fs::read(dir.join(AUTHORS_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            live.doc.set_authorship(authors);
        }
        Ok(live)
    }

    pub fn save(&mut self, dir: &Path) -> Result<(), CollabError> {
        let pending = self.begin_save(dir)?;
        let written = pending.write();
        self.end_save(pending, written)
    }

    pub fn begin_save(&mut self, dir: &Path) -> Result<PendingSave, CollabError> {
        let appendable = self.log_records < LOG_LIMIT && dir.join(DOC_FILE).is_file();
        let document = match self.persisted.as_ref().filter(|_| appendable) {
            Some(persisted) if self.doc.has_changes_since(persisted) => {
                SavedDocument::Appended(self.doc.export_since(persisted)?)
            }
            Some(_) => SavedDocument::Unchanged,
            None => SavedDocument::Replaced(self.doc.snapshot()?),
        };
        let state = StoredState {
            last_seq: self.last_seq,
            confirmed: self.confirmed.encode(),
            anchor: self.anchor,
            offline_edits: self.offline_edits.clone(),
        };
        let state = to_json(&state)?;
        let devices = if self.devices_dirty {
            Some(to_json(&self.devices)?)
        } else {
            None
        };
        let authors = if self.authors_dirty {
            Some(to_json(self.doc.authorship())?)
        } else {
            None
        };
        self.devices_dirty = false;
        self.authors_dirty = false;
        Ok(PendingSave {
            dir: dir.to_path_buf(),
            document,
            version: self.doc.version(),
            doc_replacements: self.doc_replacements,
            state,
            devices,
            authors,
        })
    }

    pub fn end_save(
        &mut self,
        pending: PendingSave,
        written: Result<(), CollabError>,
    ) -> Result<(), CollabError> {
        if let Err(error) = written {
            self.devices_dirty |= pending.devices.is_some();
            self.authors_dirty |= pending.authors.is_some();
            return Err(error);
        }
        if pending.doc_replacements != self.doc_replacements {
            self.forget_saved_document();
            return Ok(());
        }
        match pending.document {
            SavedDocument::Unchanged => {}
            SavedDocument::Appended(_) => self.log_records += 1,
            SavedDocument::Replaced(_) => self.log_records = 0,
        }
        self.persisted = Some(pending.version);
        Ok(())
    }

    fn forget_saved_document(&mut self) {
        self.persisted = None;
        self.log_records = 0;
    }

    pub fn exists(dir: &Path) -> bool {
        dir.join(DOC_FILE).is_file() && dir.join(STATE_FILE).is_file()
    }

    pub fn doc(&self) -> &ProjectDoc {
        &self.doc
    }

    pub fn doc_mut(&mut self) -> &mut ProjectDoc {
        self.disk.tree = true;
        &mut self.doc
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    pub fn role(&self) -> ProjectRole {
        self.role
    }

    pub fn set_role(&mut self, role: ProjectRole) {
        self.role = role;
    }

    pub fn can_edit(&self) -> bool {
        project_role_allows(self.role, ProjectAction::Edit)
    }

    pub fn received(&self) -> u64 {
        self.received
    }

    pub fn devices(&self) -> &DeviceRegistry {
        &self.devices
    }

    pub fn check_peers(&self, payload: &[u8], device: DeviceId) -> PeerCheck {
        let Ok(introduced) = self.doc.introduced_peers(payload) else {
            return PeerCheck::Refused;
        };
        let own = self.doc.peer_id();
        let mut unknown = Vec::new();
        for peer in introduced {
            if peer == own {
                return PeerCheck::Refused;
            }
            match self.devices.device_of_peer(peer) {
                Some(bound) if bound == device => {}
                Some(_) => return PeerCheck::Refused,
                None => unknown.push(peer),
            }
        }
        if unknown.is_empty() {
            PeerCheck::Fine
        } else {
            PeerCheck::Unknown(unknown)
        }
    }

    pub fn pin_peers(&mut self, listed: Vec<ProjectPeer>) {
        if self.devices.pin_peers(&listed) {
            self.devices_dirty = true;
        }
        let vouched = listed.iter().map(|bound| (bound.peer, bound.account_id));
        if self.doc.authors_mut().vouch(vouched) {
            self.authors_dirty = true;
        }
    }

    pub fn await_writers(&mut self) {
        if self.doc.authors_mut().await_vouch() {
            self.authors_dirty = true;
        }
    }

    pub fn peers_vouched(&self) -> bool {
        self.doc.authorship().vouched()
    }

    pub fn bind_own_peer(&mut self, device: DeviceId) {
        let own = self.doc.peer_id();
        if self.devices.bind_peers(&[own], device) {
            self.devices_dirty = true;
        }
        if let Some(me) = self.doc.author_account() {
            if self.doc.authors_mut().witness([own], me) {
                self.authors_dirty = true;
            }
        }
    }

    pub fn pin_devices(&mut self, listed: Vec<ProjectDevice>) -> Vec<NewDevice> {
        let before = self.devices.clone();
        let announced = self.devices.pin(listed);
        if self.devices != before {
            self.devices_dirty = true;
        }
        announced
    }

    pub fn open_file(&mut self, id: &str, sink: DocSink) -> Result<(u64, String), CollabError> {
        let text = self.doc.text(id)?;
        let start = self
            .editor_rev(id)
            .or_else(|| self.retired.get(id).copied())
            .map_or(0, |rev| rev + 1);
        let channel = EditorChannel::starting_at(text.clone(), start);
        let rev = channel.rev();
        self.open.insert(id.to_owned(), OpenFile { channel, sink });
        Ok((rev, text))
    }

    pub fn close_file(&mut self, id: &str) {
        if let Some(closed) = self.open.remove(id) {
            self.retired.insert(id.to_owned(), closed.channel.rev());
        }
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.open.contains_key(id)
    }

    pub fn editor_rev(&self, id: &str) -> Option<u64> {
        self.open.get(id).map(|open| open.channel.rev())
    }

    pub fn editor_change(
        &mut self,
        id: &str,
        base_rev: u64,
        operation: TextOperation,
    ) -> Result<(), CollabError> {
        if !self.can_edit() {
            self.reset_file(id)?;
            return Ok(());
        }
        let open = self
            .open
            .get_mut(id)
            .ok_or_else(|| CollabError::Corrupt(format!("the file {id} is not open")))?;
        match open.channel.receive(base_rev, operation) {
            Ok(applied) => {
                let message = DocMessage::Ack {
                    rev: open.channel.rev(),
                    length: open.channel.length(),
                };
                let sink = Arc::clone(&open.sink);
                let before = self.own_counter();
                self.doc.apply_operation(id, &applied)?;
                self.note_offline(id, before);
                self.disk.texts.insert(id.to_owned());
                sink(message);
                Ok(())
            }
            Err(ChannelError::Stale | ChannelError::Invalid(_)) => self.reset_file(id),
        }
    }

    fn reset_file(&mut self, id: &str) -> Result<(), CollabError> {
        let text = self.doc.text(id)?;
        if let Some(open) = self.open.get_mut(id) {
            let rev = open.channel.reset(text.clone());
            (open.sink)(DocMessage::Reset { rev, text });
        }
        Ok(())
    }

    fn route(&mut self, changes: DocChanges, author: Option<AccountId>) -> Result<(), CollabError> {
        let touched: Vec<String> = changes.texts.iter().map(|(id, _)| id.clone()).collect();
        self.count_catch_up(touched, author);
        self.deliver(changes)
    }

    fn count_catch_up(
        &mut self,
        texts: impl IntoIterator<Item = String>,
        author: Option<AccountId>,
    ) {
        let Some(catch_up) = self.catch_up.as_mut() else {
            return;
        };
        for id in texts {
            if let Some(author) = author {
                *catch_up
                    .authors
                    .entry(author)
                    .or_default()
                    .entry(id.clone())
                    .or_default() += 1;
            }
            *catch_up.files.entry(id).or_default() += 1;
        }
    }

    fn deliver(&mut self, changes: DocChanges) -> Result<(), CollabError> {
        self.comments.extend(changes.comments);
        if changes.tree {
            self.disk.tree = true;
        }
        for (id, deltas) in changes.texts {
            self.disk.texts.insert(id.clone());
            let Some(open) = self.open.get_mut(&id) else {
                continue;
            };
            let routed = delta_to_operation(open.channel.text(), &deltas)
                .ok()
                .and_then(|operation| {
                    open.channel
                        .remote(operation.clone())
                        .ok()
                        .map(|_| operation)
                });
            match routed {
                Some(operation) => (open.sink)(DocMessage::Remote {
                    rev: open.channel.rev(),
                    op: operation,
                    length: open.channel.length(),
                }),
                None => self.reset_file(&id)?,
            }
        }
        Ok(())
    }

    fn mark_seen(&mut self, seq: u64) {
        if seq > self.last_seq {
            self.seen.insert(seq);
        }
        let before = self.last_seq;
        while self.seen.remove(&(self.last_seq + 1)) {
            self.last_seq += 1;
        }
        if self.last_seq != before {
            self.moved_to(self.last_seq);
        }
    }

    fn moved_to(&mut self, last: u64) {
        self.anchor = self.numbered.remove(&last);
        self.numbered.retain(|seq, _| *seq > last);
    }

    pub fn note_batch(&mut self, seq: u64, batch: BatchId) {
        if seq == self.last_seq && seq > 0 {
            self.anchor = Some(batch);
        } else if seq > self.last_seq {
            self.numbered.insert(seq, batch);
        }
    }

    pub fn anchor(&self) -> Option<BatchId> {
        self.anchor
    }

    pub fn diverged(&self, head: u64, at_since: Option<BatchId>) -> bool {
        head < self.last_seq
            || matches!((self.anchor, at_since), (Some(mine), Some(theirs)) if mine != theirs)
    }

    pub fn rebase(&mut self, seq: u64, snapshot: &[u8]) -> Result<(), CollabError> {
        let held = LoroDoc::decode_import_blob_meta(snapshot, true)
            .ok()
            .filter(|meta| meta.mode == EncodedBlobMode::Snapshot)
            .ok_or_else(|| CollabError::Corrupt("the server's snapshot does not load".to_owned()))?
            .partial_end_vv;
        let imported = self.doc.import(snapshot)?;
        self.confirmed = held;
        self.last_seq = seq;
        self.seen.clear();
        self.numbered.clear();
        self.anchor = None;
        self.outgoing = None;
        self.route(imported.changes, None)
    }

    pub fn import_update(&mut self, seq: u64, payload: &[u8]) -> Result<bool, CollabError> {
        self.import_update_from(seq, payload, None)
    }

    pub fn import_update_from(
        &mut self,
        seq: u64,
        payload: &[u8],
        author: Option<AccountId>,
    ) -> Result<bool, CollabError> {
        self.import_signed(seq, payload, None, author)
    }

    pub fn import_signed(
        &mut self,
        seq: u64,
        payload: &[u8],
        device: Option<DeviceId>,
        author: Option<AccountId>,
    ) -> Result<bool, CollabError> {
        let imported = self.import_arrivals(vec![Arrival {
            seq,
            payload: payload.to_vec(),
            device,
            author,
        }])?;
        Ok(imported > 0)
    }

    pub fn import_arrivals(&mut self, arrivals: Vec<Arrival>) -> Result<usize, CollabError> {
        let mut known = self.doc.version();
        let mut fresh: Vec<Received> = Vec::new();
        for arrival in arrivals {
            let repeated = arrival.seq <= self.last_seq
                || self.seen.contains(&arrival.seq)
                || fresh.iter().any(|kept| kept.arrival.seq == arrival.seq);
            if repeated {
                continue;
            }
            let meta = update_meta(&arrival.payload);
            let mut introduced = Vec::new();
            let mut spans = Vec::new();
            for (peer, end) in meta.iter().flat_map(|meta| meta.partial_end_vv.iter()) {
                let had = known.get(peer).copied().unwrap_or(0);
                if had < *end {
                    let from = meta
                        .as_ref()
                        .and_then(|meta| meta.partial_start_vv.get(peer).copied())
                        .unwrap_or(0);
                    introduced.push(*peer);
                    spans.push((*peer, had.max(from), *end));
                    known.set_end(ID::new(*peer, *end));
                }
            }
            if arrival.device.is_none() && arrival.author.is_none() {
                introduced.clear();
            }
            fresh.push(Received {
                arrival,
                meta,
                introduced,
                spans,
            });
        }
        if fresh.is_empty() {
            return Ok(0);
        }
        let payloads: Vec<&[u8]> = fresh
            .iter()
            .map(|received| received.arrival.payload.as_slice())
            .collect();
        let imported = self.doc.import_all(&payloads)?;
        for received in &fresh {
            if let Some(device) = received.arrival.device {
                if self.devices.bind_peers(&received.introduced, device) {
                    self.devices_dirty = true;
                }
            }
            if let Some(account) = received.arrival.author {
                if self
                    .doc
                    .authors_mut()
                    .witness(received.introduced.iter().copied(), account)
                {
                    self.authors_dirty = true;
                }
            }
        }
        advance(&mut self.confirmed, &imported.arrived);
        for received in &fresh {
            if let Some(meta) = &received.meta {
                held_by_server(&mut self.confirmed, meta);
            }
            self.mark_seen(received.arrival.seq);
            self.received += 1;
        }
        match fresh.as_slice() {
            [only] => self.route(imported.changes, only.arrival.author)?,
            _ => {
                if self.catch_up.is_some() {
                    for received in &fresh {
                        let touched = self.doc.texts_changed_in(&received.spans);
                        self.count_catch_up(touched, received.arrival.author);
                    }
                }
                self.deliver(imported.changes)?;
            }
        }
        Ok(fresh.len())
    }

    pub fn skip_update(&mut self, seq: u64) {
        self.mark_seen(seq);
    }

    pub fn import_snapshot(&mut self, seq: u64, snapshot: &[u8]) -> Result<(), CollabError> {
        let imported = self.doc.import(snapshot)?;
        advance(&mut self.confirmed, &imported.arrived);
        if seq > self.last_seq {
            self.last_seq = seq;
            self.moved_to(seq);
        }
        self.seen.retain(|known| *known > seq);
        self.mark_seen(seq);
        self.route(imported.changes, None)
    }

    pub fn begin_catch_up(&mut self) {
        self.catch_up = Some(CatchUp {
            before: self.doc.version(),
            files: BTreeMap::new(),
            authors: BTreeMap::new(),
        });
    }

    pub fn end_catch_up(&mut self) -> Option<MergeReport> {
        let catch_up = self.catch_up.take()?;
        if catch_up.files.is_empty() {
            return None;
        }
        Some(MergeReport {
            before: encode_version(&catch_up.before),
            after: encode_version(&self.doc.version()),
            files: catch_up.files,
            authors: catch_up.authors,
        })
    }

    pub fn pending_changes(&self) -> u64 {
        self.unsent()
            .iter()
            .map(|(_, from, to)| u64::try_from(to - from).unwrap_or(0))
            .sum()
    }

    fn sendable(&self, peer: u64) -> bool {
        match (self.devices.device_of_peer(peer), self.device) {
            (Some(bound), Some(own)) => bound == own || peer == self.doc.peer_id(),
            _ => true,
        }
    }

    fn unsent(&self) -> Vec<(u64, i32, i32)> {
        let mut unsent: Vec<(u64, i32, i32)> = self
            .doc
            .version()
            .iter()
            .filter_map(|(peer, end)| {
                let from = self.confirmed.get(peer).copied().unwrap_or(0);
                (from < *end && self.sendable(*peer)).then_some((*peer, from, *end))
            })
            .collect();
        unsent.sort_unstable();
        unsent
    }

    fn pieces(&self) -> Vec<Piece> {
        let loro = self.doc.loro();
        let mut pieces = Vec::new();
        for (peer, from, to) in self.unsent() {
            let mut counter = from;
            while counter < to {
                let Some(change) = loro.get_change(ID::new(peer, counter)) else {
                    break;
                };
                let start = change.id.counter;
                let end = start
                    .saturating_add(i32::try_from(change.len).unwrap_or(i32::MAX))
                    .min(to);
                if end <= counter {
                    break;
                }
                let deps = if counter == start {
                    change.deps.iter().collect()
                } else {
                    Vec::new()
                };
                let lamport = change
                    .lamport
                    .saturating_add(u32::try_from(counter - start).unwrap_or(0));
                pieces.push(Piece {
                    peer,
                    from: counter,
                    to: end,
                    lamport,
                    deps,
                });
                counter = end;
            }
        }
        pieces.sort_by_key(|piece| (piece.lamport, piece.peer));
        pieces
    }

    fn ready(&self, pieces: Vec<Piece>) -> Vec<Piece> {
        let mut reach = self.confirmed.clone();
        let mut blocked = BTreeSet::new();
        let mut ready = Vec::new();
        for piece in pieces {
            let next = reach.get(&piece.peer).copied().unwrap_or(0);
            let fits = !blocked.contains(&piece.peer)
                && next >= piece.from
                && piece
                    .deps
                    .iter()
                    .all(|dep| reach.get(&dep.peer).copied().unwrap_or(0) > dep.counter);
            if fits {
                reach.set_end(ID::new(piece.peer, piece.to));
                ready.push(piece);
            } else {
                blocked.insert(piece.peer);
            }
        }
        ready
    }

    fn export_prefix(
        &self,
        ready: &[Piece],
        atoms: usize,
    ) -> Result<(Vec<u8>, VersionVector), CollabError> {
        let mut ends: BTreeMap<u64, (i32, i32)> = BTreeMap::new();
        let mut left = atoms;
        for piece in ready {
            if left == 0 {
                break;
            }
            let take = left.min(piece.atoms());
            let entry = ends.entry(piece.peer).or_insert((piece.from, piece.from));
            entry.1 = piece.from + i32::try_from(take).unwrap_or(i32::MAX);
            left -= take;
        }
        let spans: Vec<IdSpan> = ends
            .iter()
            .map(|(peer, (from, to))| IdSpan::new(*peer, *from, *to))
            .collect();
        let payload = self
            .doc
            .loro()
            .export(ExportMode::UpdatesInRange {
                spans: Cow::Owned(spans),
            })
            .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        let mut version = self.confirmed.clone();
        for (peer, (_, to)) in ends {
            version.set_end(ID::new(peer, to));
        }
        Ok((payload, version))
    }

    pub fn local_text(&mut self, id: &str, content: &str) -> Result<bool, CollabError> {
        let before = self.own_counter();
        let changes = self.doc.set_text(id, content)?;
        self.note_offline(id, before);
        let changed = !changes.is_empty();
        self.route(changes, None)?;
        Ok(changed)
    }

    pub fn local_operation(
        &mut self,
        id: &str,
        operation: &TextOperation,
    ) -> Result<bool, CollabError> {
        if operation.is_noop() {
            return Ok(false);
        }
        let before = self.own_counter();
        self.doc.apply_operation(id, operation)?;
        self.note_offline(id, before);
        self.disk.texts.insert(id.to_owned());
        let Some(open) = self.open.get_mut(id) else {
            return Ok(true);
        };
        if open.channel.remote(operation.clone()).is_err() {
            self.reset_file(id)?;
            return Ok(true);
        }
        (open.sink)(DocMessage::Remote {
            rev: open.channel.rev(),
            op: operation.clone(),
            length: open.channel.length(),
        });
        Ok(true)
    }

    pub fn next_outgoing(&mut self) -> Result<Option<Outgoing>, CollabError> {
        if let Some(outgoing) = self.outgoing.as_mut() {
            if outgoing.sent {
                return Ok(None);
            }
            outgoing.sent = true;
            return Ok(Some(outgoing.clone()));
        }
        if !self.can_edit() || self.unsendable {
            return Ok(None);
        }
        let ready = self.ready(self.pieces());
        let total: usize = ready.iter().map(Piece::atoms).sum();
        if total == 0 {
            return Ok(None);
        }
        let mut atoms = total.min(self.batch_limit.saturating_mul(2)).max(1);
        let (mut payload, mut version) = self.export_prefix(&ready, atoms)?;
        while payload.len() > self.batch_limit {
            if atoms == 1 {
                self.unsendable = true;
                return Ok(None);
            }
            let wanted = (self.batch_limit as u128 * 9 / 10).max(1);
            let scaled = atoms as u128 * wanted / payload.len().max(1) as u128;
            atoms = usize::try_from(scaled).unwrap_or(1).clamp(1, atoms - 1);
            (payload, version) = self.export_prefix(&ready, atoms)?;
        }
        let outgoing = Outgoing {
            batch: BatchId::new_v7(),
            payload,
            version,
            sent: true,
        };
        self.outgoing = Some(outgoing.clone());
        Ok(Some(outgoing))
    }

    pub fn acknowledged(&mut self, batch: BatchId, seq: u64) {
        if self
            .outgoing
            .as_ref()
            .is_some_and(|outgoing| outgoing.batch == batch)
        {
            if let Some(outgoing) = self.outgoing.take() {
                self.confirmed.merge(&outgoing.version);
            }
            self.note_batch(seq, batch);
            self.mark_seen(seq);
        }
    }

    pub fn refused(&mut self) {
        self.outgoing = None;
    }

    pub fn comments_refused(
        &mut self,
    ) -> Result<Option<Vec<crate::comments::UnsentComment>>, CollabError> {
        self.refused();
        let base = self.kept_base();
        let old_peer = self.doc.peer_id();
        let Some(unsent) = self.doc.without_comment_changes_after(&base)? else {
            return Ok(None);
        };
        self.doc_replacements += 1;
        self.forget_saved_document();
        self.keep_own_writer(old_peer);
        self.move_offline_edits(old_peer, &base);
        let open: Vec<String> = self.open.keys().cloned().collect();
        for id in open {
            let current = self.doc.text(&id).ok();
            let differs = self
                .open
                .get(&id)
                .is_some_and(|file| current.as_deref() != Some(file.channel.text()));
            if differs {
                self.reset_file(&id)?;
            }
        }
        Ok(Some(unsent))
    }

    fn kept_base(&self) -> VersionVector {
        let mut base = self.confirmed.clone();
        for (peer, end) in self.doc.version().iter() {
            if !self.sendable(*peer) {
                base.set_end(ID::new(*peer, *end));
            }
        }
        let loro = self.doc.loro();
        loro.frontiers_to_vv(&loro.vv_to_frontiers(&base))
            .unwrap_or(base)
    }

    fn move_offline_edits(&mut self, old: u64, base: &VersionVector) {
        let kept = base.get(&old).copied().unwrap_or(0);
        let (new, end) = (self.doc.peer_id(), self.own_counter());
        for spans in self.offline_edits.values_mut() {
            if spans.get(&old).is_some_and(|until| *until > kept) {
                spans.remove(&old);
                spans.insert(new, end);
            }
        }
    }

    fn keep_own_writer(&mut self, peer: u64) {
        if self.confirmed.get(&peer).copied().unwrap_or(0) == 0 {
            return;
        }
        if let Some(device) = self.device {
            if self.devices.bind_peers(&[peer], device) {
                self.devices_dirty = true;
            }
        }
        if let Some(me) = self.doc.author_account() {
            if self.doc.authors_mut().witness([peer], me) {
                self.authors_dirty = true;
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn set_batch_limit(&mut self, bytes: usize) {
        self.batch_limit = bytes.max(1);
    }

    pub fn set_device(&mut self, device: DeviceId) {
        self.device = Some(device);
    }

    pub fn take_unsendable(&mut self) -> bool {
        let tell = self.unsendable && !self.told_unsendable;
        self.told_unsendable |= tell;
        tell
    }

    pub fn too_large(&mut self) {
        let refused = self
            .outgoing
            .take()
            .map_or(self.batch_limit, |outgoing| outgoing.payload.len());
        if refused <= SMALLEST_BATCH_BYTES {
            self.unsendable = true;
        }
        self.batch_limit = (refused.min(self.batch_limit) / 2).max(SMALLEST_BATCH_BYTES);
    }

    pub fn disconnected(&mut self) {
        self.connected = false;
        if let Some(outgoing) = self.outgoing.as_mut() {
            outgoing.sent = false;
        }
    }

    pub fn mark_connected(&mut self) {
        self.connected = true;
    }

    fn own_counter(&self) -> i32 {
        self.doc
            .version()
            .get(&self.doc.peer_id())
            .copied()
            .unwrap_or(0)
    }

    fn note_offline(&mut self, id: &str, before: i32) {
        if self.connected {
            return;
        }
        let after = self.own_counter();
        if after > before {
            self.offline_edits
                .entry(id.to_owned())
                .or_default()
                .insert(self.doc.peer_id(), after);
        }
    }

    pub fn take_offline_loss(&mut self, id: &str) -> bool {
        let Some(spans) = self.offline_edits.remove(id) else {
            return false;
        };
        let Some(seen) = self.doc.trash_seen(id) else {
            return false;
        };
        spans
            .iter()
            .any(|(peer, end)| seen.get(peer).copied().unwrap_or(0) < *end)
    }

    pub fn has_unsent(&self) -> bool {
        self.outgoing.is_some() || !self.unsent().is_empty()
    }

    pub fn sendable_now(&self) -> bool {
        self.outgoing.is_none() && !self.unsendable && self.can_edit() && !self.unsent().is_empty()
    }

    pub fn mark_all_dirty(&mut self) -> Result<(), CollabError> {
        self.disk.tree = true;
        for node in self.doc.nodes()? {
            if node.kind == crate::doc::NodeKind::Text {
                self.disk.texts.insert(node.id);
            }
        }
        Ok(())
    }

    pub fn mark_dirty(&mut self, id: &str) {
        self.disk.texts.insert(id.to_owned());
    }

    pub fn take_disk_work(&mut self) -> DiskWork {
        std::mem::take(&mut self.disk)
    }

    pub fn comment_doc(&mut self) -> &mut ProjectDoc {
        &mut self.doc
    }

    pub fn take_comment_changes(&mut self) -> crate::comments::CommentChanges {
        let events = std::mem::take(&mut self.comments);
        if events.is_empty() {
            return crate::comments::CommentChanges::default();
        }
        self.doc.comment_changes(events)
    }
}

pub(crate) mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        let text: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        serializer.serialize_str(&text)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        (0..text.len())
            .step_by(2)
            .map(|index| {
                text.get(index..index + 2)
                    .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                    .ok_or_else(|| serde::de::Error::custom("not hex"))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::client::test_util::noise;
    use crate::doc::NodeKind;
    use oleafly_collab_protocol::ids::{AccountId, DeviceId};

    fn recorder() -> (DocSink, Arc<Mutex<Vec<DocMessage>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let copy = Arc::clone(&seen);
        let sink: DocSink = Arc::new(move |message| copy.lock().unwrap().push(message));
        (sink, seen)
    }

    fn insert(position: usize, text: &str, length: usize) -> TextOperation {
        let mut operation = TextOperation::new();
        operation
            .retain(position)
            .insert(text)
            .retain(length - position);
        operation
    }

    fn pair() -> (LiveProject, LiveProject, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let snapshot = doc.snapshot().unwrap();
        let owner = LiveProject::new(doc, 0, ProjectRole::Owner);
        let editor = LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Editor);
        (owner, editor, main)
    }

    #[test]
    fn typing_on_one_side_reaches_the_open_editor_on_the_other() {
        let (mut bob, mut alice, main) = pair();
        let (bob_sink, bob_seen) = recorder();
        let (alice_sink, alice_seen) = recorder();
        bob.open_file(&main, bob_sink).unwrap();
        alice.open_file(&main, alice_sink).unwrap();
        bob.editor_change(&main, 0, insert(3, "d", 3)).unwrap();
        assert_eq!(
            bob_seen.lock().unwrap()[0],
            DocMessage::Ack { rev: 1, length: 4 }
        );
        let outgoing = bob.next_outgoing().unwrap().expect("a change to send");
        assert!(bob.next_outgoing().unwrap().is_none());
        assert!(alice.import_update(1, &outgoing.payload).unwrap());
        assert!(!alice.import_update(1, &outgoing.payload).unwrap());
        assert_eq!(
            alice_seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(3, "d", 3),
                length: 4
            }
        );
        bob.acknowledged(outgoing.batch, 1);
        assert!(!bob.has_unsent());
        assert_eq!(bob.last_seq(), 1);
        assert!(!alice.has_unsent());
        let work = alice.take_disk_work();
        assert!(work.texts.contains(&main));
    }

    #[test]
    fn updates_that_arrive_out_of_order_are_all_applied() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        assert!(alice.import_update(2, &second.payload).unwrap());
        assert_eq!(alice.last_seq(), 0);
        assert!(alice.import_update(1, &first.payload).unwrap());
        assert_eq!(alice.last_seq(), 2);
        assert_eq!(alice.doc().text(&main).unwrap(), "abcde");
        assert!(!alice.import_update(2, &second.payload).unwrap());
    }

    #[test]
    fn an_own_acknowledgement_fills_the_gap_between_others_updates() {
        let (mut bob, mut alice, main) = pair();
        alice.local_text(&main, "abcX").unwrap();
        let mine = alice.next_outgoing().unwrap().unwrap();
        bob.local_text(&main, "Yabc").unwrap();
        let theirs = bob.next_outgoing().unwrap().unwrap();
        assert!(alice.import_update(2, &theirs.payload).unwrap());
        alice.acknowledged(mine.batch, 1);
        assert_eq!(alice.last_seq(), 2);
    }

    #[test]
    fn an_unacknowledged_change_is_sent_again_after_a_reconnect() {
        let (mut bob, _alice, main) = pair();
        let (sink, _seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        bob.editor_change(&main, 0, insert(0, "x", 3)).unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.disconnected();
        let again = bob.next_outgoing().unwrap().unwrap();
        assert_eq!(first.batch, again.batch);
        assert_eq!(first.payload, again.payload);
    }

    #[test]
    fn a_viewer_cannot_change_text_and_gets_the_file_back() {
        let (_bob, mut alice, main) = pair();
        alice.set_role(ProjectRole::Viewer);
        let (sink, seen) = recorder();
        alice.open_file(&main, sink).unwrap();
        alice.editor_change(&main, 0, insert(0, "x", 3)).unwrap();
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Reset {
                rev: 1,
                text: "abc".to_owned()
            }
        );
        assert!(alice.next_outgoing().unwrap().is_none());
    }

    #[test]
    fn a_disk_edit_reaches_the_open_editor_and_the_outbox() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        assert!(bob.local_text(&main, "abXc").unwrap());
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(2, "X", 3),
                length: 4
            }
        );
        assert!(bob.has_unsent());
    }

    fn trashed_by(deleter: &mut LiveProject, id: &str, other: &mut LiveProject, seq: u64) {
        deleter.doc_mut().trash(id).unwrap();
        let sent = deleter.next_outgoing().unwrap().unwrap();
        deleter.acknowledged(sent.batch, seq);
        assert!(other.import_update(seq, &sent.payload).unwrap());
    }

    #[test]
    fn an_edit_made_offline_to_a_file_someone_else_deleted_is_reported_once() {
        let (mut bob, mut alice, main) = pair();
        bob.mark_connected();
        alice.mark_connected();
        alice.disconnected();
        let (sink, _seen) = recorder();
        alice.open_file(&main, sink).unwrap();
        alice
            .editor_change(&main, 0, insert(3, " written offline", 3))
            .unwrap();
        trashed_by(&mut bob, &main, &mut alice, 1);
        assert!(alice.take_offline_loss(&main));
        assert!(!alice.take_offline_loss(&main));
        assert_eq!(alice.doc().text(&main).unwrap(), "abc written offline");
    }

    #[test]
    fn typing_while_connected_is_not_reported_as_an_offline_loss() {
        let (mut bob, mut alice, main) = pair();
        alice.mark_connected();
        alice.local_text(&main, "abc typed online").unwrap();
        trashed_by(&mut bob, &main, &mut alice, 1);
        assert!(!alice.take_offline_loss(&main));
    }

    #[test]
    fn an_offline_edit_the_deleter_had_already_received_is_not_reported() {
        let (mut bob, mut alice, main) = pair();
        alice.local_text(&main, "abc offline").unwrap();
        let sent = alice.next_outgoing().unwrap().unwrap();
        alice.acknowledged(sent.batch, 1);
        assert!(bob.import_update(1, &sent.payload).unwrap());
        trashed_by(&mut bob, &main, &mut alice, 2);
        assert!(!alice.take_offline_loss(&main));
    }

    #[test]
    fn an_offline_edit_lost_to_a_delete_is_still_reported_after_a_restart() {
        let (mut bob, mut alice, main) = pair();
        alice.local_text(&main, "abc written offline").unwrap();
        let dir = tempfile::tempdir().unwrap();
        alice.save(dir.path()).unwrap();
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        trashed_by(&mut bob, &main, &mut restarted, 1);
        assert!(restarted.take_offline_loss(&main));
        restarted.save(dir.path()).unwrap();
        let mut again = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(!again.take_offline_loss(&main));
    }

    #[test]
    fn changes_that_arrive_while_catching_up_are_counted_per_file_and_author() {
        let (mut bob, mut alice, main) = pair();
        let bob_account = AccountId::new_v7();
        let carol_account = AccountId::new_v7();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        let before = alice.doc().version();
        alice.begin_catch_up();
        alice
            .import_update_from(1, &first.payload, Some(bob_account))
            .unwrap();
        alice
            .import_update_from(2, &second.payload, Some(carol_account))
            .unwrap();
        let report = alice.end_catch_up().expect("something merged");
        assert_eq!(report.files.get(&main), Some(&2));
        assert_eq!(
            report
                .authors
                .get(&bob_account)
                .and_then(|files| files.get(&main)),
            Some(&1)
        );
        assert_eq!(
            report
                .authors
                .get(&carol_account)
                .and_then(|files| files.get(&main)),
            Some(&1)
        );
        assert_eq!(crate::doc::decode_version(&report.before).unwrap(), before);
        assert_eq!(
            crate::doc::decode_version(&report.after).unwrap(),
            alice.doc().version()
        );
        assert!(alice.end_catch_up().is_none());
        assert_eq!(bob.pending_changes(), 1);
    }

    #[test]
    fn changes_taken_in_together_while_catching_up_are_counted_per_file_and_author() {
        let (mut bob, mut alice, main) = pair();
        let bob_account = AccountId::new_v7();
        let carol_account = AccountId::new_v7();
        let notes = bob
            .doc_mut()
            .add_node(None, "notes.tex", NodeKind::Text, None, "n")
            .unwrap();
        let added = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(added.batch, 1);
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 2);
        bob.local_text(&notes, "notes").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        assert!(alice.import_update(1, &added.payload).unwrap());
        let (sink, seen) = recorder();
        alice.open_file(&main, sink).unwrap();
        alice.begin_catch_up();
        let arrival = |seq: u64, payload: &[u8], author: AccountId| Arrival {
            seq,
            payload: payload.to_vec(),
            device: None,
            author: Some(author),
        };

        let taken = alice
            .import_arrivals(vec![
                arrival(2, &first.payload, bob_account),
                arrival(3, &second.payload, carol_account),
                arrival(2, &first.payload, bob_account),
            ])
            .unwrap();

        assert_eq!(taken, 2);
        assert_eq!(alice.last_seq(), 3);
        assert_eq!(alice.received(), 3);
        assert_eq!(alice.doc().text(&main).unwrap(), "abcd");
        assert_eq!(alice.doc().text(&notes).unwrap(), "notes");
        let report = alice.end_catch_up().expect("something merged");
        assert_eq!(report.files.get(&main), Some(&1));
        assert_eq!(report.files.get(&notes), Some(&1));
        assert_eq!(
            report.authors.get(&bob_account),
            Some(&BTreeMap::from([(main.clone(), 1)]))
        );
        assert_eq!(
            report.authors.get(&carol_account),
            Some(&BTreeMap::from([(notes.clone(), 1)]))
        );
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .any(|message| matches!(message, DocMessage::Remote { .. })));
        let work = alice.take_disk_work();
        assert!(work.texts.contains(&main) && work.texts.contains(&notes));
    }

    #[test]
    fn a_comment_signed_as_someone_else_stays_unverified_when_it_arrives_in_one_batch_with_theirs()
    {
        let (mut bob, mut alice, main) = pair();
        let initial = bob.doc().snapshot().unwrap();
        let (alice_account, bob_account) = (AccountId::new_v7(), AccountId::new_v7());
        let (alice_device, bob_device) = (DeviceId::new_v7(), DeviceId::new_v7());
        let doc = alice.comment_doc();
        let honest = doc
            .create_comment_thread(&main, 0, 1, alice_account, 1, "Mine", &[])
            .unwrap();
        let forged = doc
            .create_comment_thread(&main, 1, 2, bob_account, 2, "Pretending to be Bob", &[])
            .unwrap();
        let commented = alice.next_outgoing().unwrap().unwrap();
        assert!(bob
            .import_signed(
                1,
                &commented.payload,
                Some(alice_device),
                Some(alice_account)
            )
            .unwrap());
        let mut typed = Vec::new();
        for (seq, text) in [(2, "abcx"), (3, "abcxy")] {
            bob.local_text(&main, text).unwrap();
            let outgoing = bob.next_outgoing().unwrap().unwrap();
            bob.acknowledged(outgoing.batch, seq);
            typed.push((seq, outgoing.payload));
        }
        let mut late =
            LiveProject::new(ProjectDoc::load(&initial).unwrap(), 0, ProjectRole::Editor);
        let mut arrivals = vec![Arrival {
            seq: 1,
            payload: commented.payload.clone(),
            device: Some(alice_device),
            author: Some(alice_account),
        }];
        arrivals.extend(typed.into_iter().map(|(seq, payload)| Arrival {
            seq,
            payload,
            device: Some(bob_device),
            author: Some(bob_account),
        }));

        assert_eq!(late.import_arrivals(arrivals).unwrap(), 3);

        let seen = |id| late.doc().comment_thread(&main, id).unwrap().unwrap();
        assert!(seen(honest.id).verified);
        assert!(!seen(forged.id).verified);
        assert!(!seen(forged.id).messages[0].verified);
        assert_eq!(
            late.devices().device_of_peer(alice.doc().peer_id()),
            Some(alice_device)
        );
        assert_eq!(
            late.devices().device_of_peer(bob.doc().peer_id()),
            Some(bob_device)
        );
    }

    #[test]
    fn a_catch_up_that_brings_nothing_reports_nothing() {
        let (_bob, mut alice, _main) = pair();
        alice.begin_catch_up();
        assert!(alice.end_catch_up().is_none());
    }

    #[test]
    fn a_refused_update_is_skipped_so_later_ones_still_move_the_cursor() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        alice.skip_update(1);
        assert_eq!(alice.last_seq(), 1);
        assert!(alice.import_update(2, &second.payload).unwrap());
        assert_eq!(alice.last_seq(), 2);
        assert!(!alice.import_update(1, &first.payload).unwrap());
    }

    #[test]
    fn pinned_devices_are_kept_beside_the_document() {
        let (mut bob, _alice, _main) = pair();
        let laptop = oleafly_collab_protocol::ids::DeviceId::new_v7();
        let alice = AccountId::new_v7();
        assert!(bob.devices().is_empty());
        bob.pin_devices(vec![oleafly_collab_protocol::projects::ProjectDevice {
            device_id: laptop,
            account_id: alice,
            public_key: "AQID".to_owned(),
            added_at: 1,
        }]);
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        assert!(dir.path().join(DEVICES_FILE).is_file());
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(loaded.devices().account_of(laptop), Some(alice));
    }

    #[test]
    fn a_local_operation_reaches_the_open_editor_and_the_outbox() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        bob.open_file(&main, sink).unwrap();
        assert!(bob.local_operation(&main, &insert(1, "Z", 3)).unwrap());
        assert_eq!(bob.doc().text(&main).unwrap(), "aZbc");
        assert_eq!(
            seen.lock().unwrap()[0],
            DocMessage::Remote {
                rev: 1,
                op: insert(1, "Z", 3),
                length: 4
            }
        );
        assert!(!bob
            .local_operation(&main, &TextOperation::between("aZbc", "aZbc"))
            .unwrap());
    }

    #[test]
    fn state_survives_a_save_and_load() {
        let (mut bob, _alice, main) = pair();
        bob.local_text(&main, "abcdef").unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        assert!(LiveProject::exists(dir.path()));
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(loaded.doc().text(&main).unwrap(), "abcdef");
        assert!(loaded.has_unsent());
    }

    fn type_at_end(live: &mut LiveProject, id: &str, text: &str) {
        let current = live.doc().text(id).unwrap();
        let mut operation = TextOperation::default();
        operation.retain(current.encode_utf16().count());
        operation.insert(text);
        live.local_operation(id, &operation).unwrap();
    }

    #[test]
    fn a_comment_refused_while_a_save_is_being_written_does_not_come_back_from_disk() {
        let (_bob, mut alice, main) = pair();
        alice.set_device(DeviceId::new_v7());
        let dir = tempfile::tempdir().unwrap();
        alice.save(dir.path()).unwrap();
        type_at_end(&mut alice, &main, " offline");
        alice
            .comment_doc()
            .create_comment_thread(&main, 0, 3, AccountId::new_v7(), 1, "Not sent", &[])
            .unwrap();
        alice.save(dir.path()).unwrap();

        let pending = alice.begin_save(dir.path()).unwrap();
        assert!(alice.comments_refused().unwrap().is_some());
        let written = pending.write();
        alice.end_save(pending, written).unwrap();
        alice.save(dir.path()).unwrap();

        let reloaded = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(reloaded.doc().comment_threads(&main).unwrap().is_empty());
        assert!(reloaded
            .doc()
            .loro()
            .get_map(crate::comments::COMMENTS)
            .is_empty());
        assert_eq!(reloaded.doc().text(&main).unwrap(), "abc offline");
        assert_eq!(reloaded.doc().version(), alice.doc().version());
    }

    #[test]
    fn many_small_saves_reload_every_change() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        for round in 0..60 {
            type_at_end(&mut bob, &main, &format!(" {round}"));
            bob.save(dir.path()).unwrap();
        }
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            loaded.doc().text(&main).unwrap(),
            bob.doc().text(&main).unwrap()
        );
        assert_eq!(loaded.last_seq(), bob.last_seq());
    }

    #[test]
    fn a_small_change_is_appended_instead_of_rewriting_the_whole_document() {
        let (mut bob, _alice, main) = pair();
        let body: String = (0..2_000u64)
            .map(|line| format!("line {line} {:x}\n", line.wrapping_mul(2_654_435_761)))
            .collect();
        bob.local_text(&main, &body).unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let snapshot = std::fs::read(dir.path().join(DOC_FILE)).unwrap();
        type_at_end(&mut bob, &main, "x");
        bob.save(dir.path()).unwrap();
        assert_eq!(std::fs::read(dir.path().join(DOC_FILE)).unwrap(), snapshot);
        let log = std::fs::metadata(dir.path().join(LOG_FILE)).unwrap().len() as usize;
        assert!(
            log * 20 < snapshot.len(),
            "log {log} snapshot {}",
            snapshot.len()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_shared_save_writes_the_change_log_before_the_sync_state_and_leaves_the_project_free() {
        use std::io::Read;
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let before = std::fs::read(dir.path().join(STATE_FILE)).unwrap();
        let log = dir.path().join(LOG_FILE);
        assert!(std::process::Command::new("mkfifo")
            .arg(&log)
            .status()
            .unwrap()
            .success());
        let body: String = (0..1_000_000u64)
            .map(|at| char::from(b'a' + ((at.wrapping_mul(2_654_435_761) >> 9) % 26) as u8))
            .collect();
        bob.local_text(&main, &body).unwrap();
        bob.skip_update(1);
        let shared = Arc::new(Mutex::new(bob));
        let saving = {
            let shared = Arc::clone(&shared);
            let dir = dir.path().to_path_buf();
            std::thread::spawn(move || save_shared(&shared, &dir))
        };
        let (opened, reader) = std::sync::mpsc::channel();
        let path = log.clone();
        std::thread::spawn(move || {
            let _ = opened.send(std::fs::File::open(path));
        });
        let mut reader = reader
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("the save never opened its change log")
            .unwrap();
        let mut first = [0u8; 1];
        reader.read_exact(&mut first).unwrap();
        let free = shared.try_lock().is_ok();
        let during = std::fs::read(dir.path().join(STATE_FILE)).unwrap();
        std::io::copy(&mut reader, &mut std::io::sink()).unwrap();
        let _ = saving.join().unwrap();
        assert!(
            free,
            "the project stayed locked while its change log was written"
        );
        assert_eq!(
            during, before,
            "the sync state moved ahead of the change log"
        );
    }

    #[test]
    fn a_failed_save_keeps_the_writer_ids_for_the_next_one() {
        let (mut bob, _alice, _main) = pair();
        bob.bind_own_peer(DeviceId::new_v7());
        let dir = tempfile::tempdir().unwrap();
        let taken = dir.path().join("taken");
        std::fs::write(&taken, b"a file, not a folder").unwrap();
        assert!(bob.save(&taken).is_err());
        let document = dir.path().join("document");
        bob.save(&document).unwrap();
        assert!(document.join(DEVICES_FILE).is_file());
    }

    #[test]
    fn a_half_written_change_record_is_ignored_on_load() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        type_at_end(&mut bob, &main, " kept");
        bob.save(dir.path()).unwrap();
        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(dir.path().join(LOG_FILE))
            .unwrap();
        std::io::Write::write_all(&mut log, &[200, 0, 0, 0, 1, 2, 3]).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(loaded.doc().text(&main).unwrap().ends_with(" kept"));
    }

    #[test]
    fn the_change_log_is_folded_into_the_document_after_many_saves() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        for round in 0..=LOG_LIMIT {
            type_at_end(&mut bob, &main, &format!("{}", round % 10));
            bob.save(dir.path()).unwrap();
        }
        let log = std::fs::metadata(dir.path().join(LOG_FILE)).map_or(0, |meta| meta.len());
        assert!(log < 1_000, "log still {log} bytes");
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            loaded.doc().text(&main).unwrap(),
            bob.doc().text(&main).unwrap()
        );
    }

    #[test]
    fn an_open_file_reports_its_editor_revision_and_a_reopen_never_reuses_one() {
        let (mut bob, _alice, main) = pair();
        assert_eq!(bob.editor_rev(&main), None);
        let (sink, _seen) = recorder();
        let (first, _) = bob.open_file(&main, Arc::clone(&sink)).unwrap();
        assert_eq!(bob.editor_rev(&main), Some(first));
        bob.editor_change(&main, first, insert(3, "d", 3)).unwrap();
        let typed = bob.editor_rev(&main).unwrap();
        assert!(typed > first);
        bob.close_file(&main);
        assert_eq!(bob.editor_rev(&main), None);
        let (again, text) = bob.open_file(&main, Arc::clone(&sink)).unwrap();
        assert!(again > typed, "{again} after {typed}");
        assert_eq!(text, "abcd");
        let (replaced, _) = bob.open_file(&main, sink).unwrap();
        assert!(replaced > again, "{replaced} after {again}");
        bob.editor_change(&main, replaced, insert(0, "x", 4))
            .unwrap();
        assert_eq!(bob.doc().text(&main).unwrap(), "xabcd");
        assert_eq!(bob.editor_rev(&main), Some(replaced + 1));
    }

    #[test]
    fn a_change_is_checked_against_the_writer_ids_this_copy_knows() {
        let (owner, mut alice, main) = pair();
        let (laptop, mallory) = (DeviceId::new_v7(), DeviceId::new_v7());
        let base = owner.doc().snapshot().unwrap();
        let write_as = |peer: u64, text: &str| {
            let mut writer = ProjectDoc::load(&base).unwrap();
            let since = writer.version();
            writer.loro().set_peer_id(peer).unwrap();
            writer.set_text(&main, text).unwrap();
            writer.export_since(&since).unwrap()
        };
        let own = alice.doc().peer_id();
        assert_eq!(
            alice.check_peers(&write_as(own, "abc mine?"), mallory),
            PeerCheck::Refused
        );
        let fresh = write_as(41, "abc new");
        assert_eq!(
            alice.check_peers(&fresh, laptop),
            PeerCheck::Unknown(vec![41])
        );
        assert!(alice.import_signed(1, &fresh, Some(laptop), None).unwrap());
        assert_eq!(alice.devices().device_of_peer(41), Some(laptop));
        let more = write_as(41, "abc forged");
        assert_eq!(alice.check_peers(&more, mallory), PeerCheck::Refused);
        assert_eq!(alice.check_peers(&more, laptop), PeerCheck::Fine);
        assert_eq!(alice.check_peers(&fresh, mallory), PeerCheck::Fine);
        assert_eq!(
            alice.check_peers(b"not a change", laptop),
            PeerCheck::Refused
        );
        assert_eq!(alice.check_peers(&base, laptop), PeerCheck::Refused);
    }

    fn end_of(payload: &[u8]) -> loro::VersionVector {
        loro::LoroDoc::decode_import_blob_meta(payload, false)
            .unwrap()
            .partial_end_vv
    }

    fn deliver_all(from: &mut LiveProject, to: &mut LiveProject, limit: usize) -> usize {
        let mut seq = to.last_seq();
        let mut batches = 0;
        while let Some(outgoing) = from.next_outgoing().unwrap() {
            assert!(
                outgoing.payload.len() <= limit,
                "batch {} carries {} bytes, over {limit}",
                batches + 1,
                outgoing.payload.len()
            );
            seq += 1;
            assert!(to.import_update(seq, &outgoing.payload).unwrap());
            assert!(
                to.doc().version().includes_vv(&end_of(&outgoing.payload)),
                "batch {} could not be applied when it arrived",
                batches + 1
            );
            from.acknowledged(outgoing.batch, seq);
            batches += 1;
        }
        batches
    }

    #[test]
    fn a_change_bigger_than_one_batch_goes_out_in_pieces_that_each_fit() {
        let (mut bob, mut alice, main) = pair();
        let limit = 32 * 1024;
        bob.set_batch_limit(limit);
        let big = noise(200_000, 7);
        bob.local_text(&main, &big).unwrap();
        let batches = deliver_all(&mut bob, &mut alice, limit);
        assert!(batches >= 6, "only {batches} batches");
        assert_eq!(alice.doc().text(&main).unwrap(), big);
        assert!(!bob.has_unsent());
        assert_eq!(bob.pending_changes(), 0);
    }

    #[test]
    fn pieces_from_two_writer_ids_of_one_device_arrive_in_an_order_the_other_copy_can_apply() {
        let (mut bob, mut alice, main) = pair();
        let limit = 16 * 1024;
        bob.set_batch_limit(limit);
        bob.local_text(&main, &noise(40_000, 1)).unwrap();
        bob.comment_doc().loro().set_peer_id(4242).unwrap();
        let more = format!("{}{}", bob.doc().text(&main).unwrap(), noise(40_000, 2));
        bob.local_text(&main, &more).unwrap();
        let batches = deliver_all(&mut bob, &mut alice, limit);
        assert!(batches >= 4, "only {batches} batches");
        assert_eq!(alice.doc().text(&main).unwrap(), more);
    }

    #[test]
    fn a_single_edit_too_large_for_any_batch_is_refused_here_and_never_sent_again() {
        let (mut bob, mut alice, main) = pair();
        bob.set_batch_limit(16 * 1024);
        bob.local_text(&main, "abcd").unwrap();
        let huge = noise(64 * 1024, 3);
        bob.comment_doc()
            .loro()
            .get_map("oversized")
            .insert("value", huge.as_str())
            .unwrap();
        bob.comment_doc().loro().commit();
        let first = bob
            .next_outgoing()
            .unwrap()
            .expect("the small change still goes out");
        assert!(alice.import_update(1, &first.payload).unwrap());
        bob.acknowledged(first.batch, 1);
        assert_eq!(alice.doc().text(&main).unwrap(), "abcd");
        assert!(bob.next_outgoing().unwrap().is_none());
        assert!(bob.take_unsendable());
        assert!(!bob.take_unsendable());
        assert!(bob.next_outgoing().unwrap().is_none());
        assert!(bob.has_unsent());
    }

    #[test]
    fn a_batch_the_server_calls_too_large_is_cut_smaller_and_sent_again() {
        let (mut bob, mut alice, main) = pair();
        let big = noise(100_000, 9);
        bob.local_text(&main, &big).unwrap();
        let whole = bob.next_outgoing().unwrap().unwrap();
        bob.too_large();
        let smaller = bob
            .next_outgoing()
            .unwrap()
            .expect("the change goes out again in a smaller piece");
        assert_ne!(smaller.batch, whole.batch);
        assert!(
            smaller.payload.len() * 2 <= whole.payload.len() + 1024,
            "{} after {}",
            smaller.payload.len(),
            whole.payload.len()
        );
        assert!(alice.import_update(1, &smaller.payload).unwrap());
        bob.acknowledged(smaller.batch, 1);
        deliver_all(&mut bob, &mut alice, whole.payload.len());
        assert_eq!(alice.doc().text(&main).unwrap(), big);
    }

    #[test]
    fn changes_under_another_devices_writer_id_are_left_for_that_device_to_send() {
        let (mut bob, mut alice, main) = pair();
        let base = alice.doc().snapshot().unwrap();
        let (alice_device, bob_device) = (DeviceId::new_v7(), DeviceId::new_v7());
        alice.set_device(alice_device);
        bob.local_text(&main, "abcB").unwrap();
        let theirs = bob.next_outgoing().unwrap().unwrap();
        assert!(alice
            .import_signed(1, &theirs.payload, Some(bob_device), None)
            .unwrap());
        alice.rebase(0, &base).unwrap();
        assert_eq!(alice.pending_changes(), 0);
        alice.local_text(&main, "AabcB").unwrap();
        assert!(
            alice.next_outgoing().unwrap().is_none(),
            "Alice's change builds on Bob's, which the server lost"
        );
        assert!(alice
            .import_signed(1, &theirs.payload, Some(bob_device), None)
            .unwrap());
        let mine = alice
            .next_outgoing()
            .unwrap()
            .expect("Alice's own change goes out once Bob's is back");
        let writers: Vec<u64> = end_of(&mine.payload).keys().copied().collect();
        assert_eq!(writers, vec![alice.doc().peer_id()]);
    }

    #[test]
    fn after_a_rebase_changes_the_server_sends_back_are_not_uploaded_again() {
        let (mut bob, _alice, main) = pair();
        let base = bob.doc().snapshot().unwrap();
        bob.local_text(&main, "abcd").unwrap();
        let mine = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(mine.batch, 1);
        bob.rebase(0, &base).unwrap();
        assert_eq!(bob.last_seq(), 0);
        assert!(bob.has_unsent());
        assert!(bob.import_signed(1, &mine.payload, None, None).unwrap());
        assert!(!bob.has_unsent());
        assert!(bob.next_outgoing().unwrap().is_none());
        assert_eq!(bob.last_seq(), 1);
        assert_eq!(bob.doc().text(&main).unwrap(), "abcd");
    }

    #[test]
    fn the_change_at_the_last_seen_number_is_remembered_through_gaps_and_a_restart() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        assert_eq!(bob.anchor(), Some(first.batch));
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        alice.note_batch(2, second.batch);
        assert!(alice.import_update(2, &second.payload).unwrap());
        assert_eq!(alice.anchor(), None);
        alice.note_batch(1, first.batch);
        assert!(alice.import_update(1, &first.payload).unwrap());
        assert_eq!(alice.last_seq(), 2);
        assert_eq!(alice.anchor(), Some(second.batch));
        assert!(!alice.diverged(2, Some(second.batch)));
        assert!(!alice.diverged(9, None));
        assert!(alice.diverged(1, None));
        assert!(alice.diverged(2, Some(first.batch)));
        let dir = tempfile::tempdir().unwrap();
        alice.save(dir.path()).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert_eq!(loaded.anchor(), Some(second.batch));
        assert!(loaded.diverged(2, Some(first.batch)));
    }

    fn unsent(
        file: &str,
        thread: oleafly_collab_protocol::ids::CommentId,
        quote: &str,
        body: &str,
    ) -> crate::comments::UnsentComment {
        crate::comments::UnsentComment {
            file_id: file.to_owned(),
            thread_id: thread,
            quote: quote.to_owned(),
            body: body.to_owned(),
        }
    }

    fn deliver_without_comments(from: &mut LiveProject, to: &mut LiveProject) {
        let mut seq = to.last_seq();
        while let Some(outgoing) = from.next_outgoing().unwrap() {
            seq += 1;
            let before = to.doc().version();
            assert!(to.import_update(seq, &outgoing.payload).unwrap());
            assert!(
                !crate::doc::changes_comments_after(to.doc().loro(), &before),
                "batch {seq} still carried a comment change"
            );
            from.acknowledged(outgoing.batch, seq);
        }
    }

    #[test]
    fn a_refused_comment_is_dropped_and_the_typing_around_it_reaches_the_others_once() {
        let (mut bob, mut alice, main) = pair();
        let me = AccountId::new_v7();
        type_at_end(&mut alice, &main, " one");
        let thread = alice
            .comment_doc()
            .create_comment_thread(&main, 0, 3, me, 1, "written while off", &[])
            .unwrap();
        type_at_end(&mut alice, &main, " two");
        let refused = alice.next_outgoing().unwrap().unwrap();
        let dropped = alice
            .comments_refused()
            .unwrap()
            .expect("the comment is dropped");
        assert_eq!(
            dropped,
            vec![unsent(&main, thread.id, "abc", "written while off")]
        );
        assert_eq!(alice.doc().text(&main).unwrap(), "abc one two");
        assert!(alice.doc().comment_threads(&main).unwrap().is_empty());
        let again = alice
            .next_outgoing()
            .unwrap()
            .expect("the typing goes out again");
        assert_ne!(again.batch, refused.batch);
        let before = bob.doc().version();
        assert!(bob.import_update(1, &again.payload).unwrap());
        assert!(!crate::doc::changes_comments_after(
            bob.doc().loro(),
            &before
        ));
        alice.acknowledged(again.batch, 1);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc one two");
        assert!(bob.doc().comment_threads(&main).unwrap().is_empty());
        assert!(!alice.has_unsent());
        assert!(alice.next_outgoing().unwrap().is_none());
    }

    #[test]
    fn comments_the_server_already_took_stay_when_later_comment_changes_are_refused() {
        let (mut bob, mut alice, main) = pair();
        let me = AccountId::new_v7();
        let kept = alice
            .comment_doc()
            .create_comment_thread(&main, 0, 2, me, 1, "sent earlier", &[])
            .unwrap();
        let first = alice.next_outgoing().unwrap().unwrap();
        assert!(bob.import_update(1, &first.payload).unwrap());
        alice.acknowledged(first.batch, 1);
        alice
            .comment_doc()
            .edit_comment(
                &main,
                kept.id,
                kept.messages[0].id,
                me,
                2,
                "sent earlier, then edited",
                &[],
            )
            .unwrap();
        alice
            .comment_doc()
            .reply_to_comment(&main, kept.id, me, 3, "a reply while off", &[])
            .unwrap();
        type_at_end(&mut alice, &main, " typed");
        let fresh = alice
            .comment_doc()
            .create_comment_thread(&main, 1, 3, me, 4, "a new thread while off", &[])
            .unwrap();
        alice.next_outgoing().unwrap().unwrap();
        let dropped = alice.comments_refused().unwrap().unwrap();
        assert_eq!(
            dropped,
            vec![
                unsent(&main, kept.id, "ab", "sent earlier, then edited"),
                unsent(&main, kept.id, "ab", "a reply while off"),
                unsent(&main, fresh.id, "bc", "a new thread while off"),
            ]
        );
        deliver_without_comments(&mut alice, &mut bob);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc typed");
        for live in [&alice, &bob] {
            let threads = live.doc().comment_threads(&main).unwrap();
            assert_eq!(threads.len(), 1);
            assert_eq!(threads[0].id, kept.id);
            assert_eq!(threads[0].messages.len(), 1);
            assert_eq!(threads[0].messages[0].body, "sent earlier");
        }
    }

    #[test]
    fn files_added_renamed_and_deleted_beside_a_refused_comment_arrive_once() {
        let (mut bob, mut alice, main) = pair();
        let me = AccountId::new_v7();
        let notes = {
            let doc = alice.doc_mut();
            let chapters = doc
                .add_node(None, "chapters", NodeKind::Dir, None, "")
                .unwrap();
            let notes = doc
                .add_node(Some(&chapters), "notes.tex", NodeKind::Text, None, "notes")
                .unwrap();
            let scratch = doc
                .add_node(None, "scratch.tex", NodeKind::Text, None, "scratch")
                .unwrap();
            doc.rename(&main, "thesis.tex").unwrap();
            doc.trash(&scratch).unwrap();
            notes
        };
        alice
            .comment_doc()
            .create_comment_thread(&notes, 0, 5, me, 1, "on the new notes", &[])
            .unwrap();
        type_at_end(&mut alice, &notes, " more");
        alice.next_outgoing().unwrap().unwrap();
        assert_eq!(alice.comments_refused().unwrap().unwrap().len(), 1);
        deliver_without_comments(&mut alice, &mut bob);
        let sorted = |live: &LiveProject| {
            let mut nodes = live.doc().nodes().unwrap();
            nodes.sort_by(|left, right| left.id.cmp(&right.id));
            nodes
        };
        assert_eq!(sorted(&bob), sorted(&alice));
        assert_eq!(sorted(&bob).len(), 4);
        assert_eq!(bob.doc().text(&notes).unwrap(), "notes more");
        assert!(sorted(&bob)
            .iter()
            .any(|node| node.id == main && node.name == "thesis.tex"));
    }

    #[test]
    fn an_open_editor_keeps_typing_through_the_rebuild_without_being_reset() {
        let (mut bob, mut alice, main) = pair();
        let (sink, seen) = recorder();
        let (rev, _) = alice.open_file(&main, sink).unwrap();
        alice
            .editor_change(&main, rev, insert(3, " one", 3))
            .unwrap();
        alice
            .comment_doc()
            .create_comment_thread(&main, 0, 3, AccountId::new_v7(), 1, "while off", &[])
            .unwrap();
        alice.next_outgoing().unwrap().unwrap();
        alice.comments_refused().unwrap().unwrap();
        alice
            .editor_change(&main, rev + 1, insert(7, " two", 7))
            .unwrap();
        assert!(
            seen.lock()
                .unwrap()
                .iter()
                .all(|message| matches!(message, DocMessage::Ack { .. })),
            "{:?}",
            seen.lock().unwrap()
        );
        deliver_without_comments(&mut alice, &mut bob);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc one two");
    }

    #[test]
    fn the_rebuilt_document_replaces_the_saved_one_so_a_restart_does_not_bring_the_comment_back() {
        let (mut bob, mut alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        alice.save(dir.path()).unwrap();
        type_at_end(&mut alice, &main, " one");
        alice
            .comment_doc()
            .create_comment_thread(&main, 0, 3, AccountId::new_v7(), 1, "while off", &[])
            .unwrap();
        alice.save(dir.path()).unwrap();
        alice.next_outgoing().unwrap().unwrap();
        alice.comments_refused().unwrap().unwrap();
        alice.save(dir.path()).unwrap();
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(restarted.doc().comment_threads(&main).unwrap().is_empty());
        assert_eq!(restarted.doc().text(&main).unwrap(), "abc one");
        deliver_without_comments(&mut restarted, &mut bob);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc one");
    }

    #[test]
    fn an_offline_edit_carried_through_a_refused_comment_is_not_reported_lost_once_the_deleter_had_it(
    ) {
        let (mut bob, mut alice, main) = pair();
        alice.local_text(&main, "abc offline").unwrap();
        alice
            .comment_doc()
            .create_comment_thread(&main, 0, 3, AccountId::new_v7(), 1, "while off", &[])
            .unwrap();
        alice.next_outgoing().unwrap().unwrap();
        alice.comments_refused().unwrap().unwrap();
        deliver_without_comments(&mut alice, &mut bob);
        trashed_by(&mut bob, &main, &mut alice, 2);
        assert!(!alice.take_offline_loss(&main));
    }

    #[test]
    fn a_refusal_with_no_comment_change_to_drop_only_drops_the_batch() {
        let (_bob, mut alice, main) = pair();
        type_at_end(&mut alice, &main, " one");
        let first = alice.next_outgoing().unwrap().unwrap();
        assert!(alice.comments_refused().unwrap().is_none());
        let again = alice
            .next_outgoing()
            .unwrap()
            .expect("the change is kept for a later try");
        assert_ne!(again.batch, first.batch);
        assert_eq!(again.payload, first.payload);
        assert_eq!(alice.doc().text(&main).unwrap(), "abc one");
    }
}
