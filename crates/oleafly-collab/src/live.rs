use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use loro::{EncodedBlobMode, ExportMode, IdSpan, ImportBlobMetadata, VersionVector, ID};
use oleafly_collab_protocol::ids::{AccountId, BatchId, DeviceId};
use oleafly_collab_protocol::projects::{
    project_role_allows, ProjectAction, ProjectDevice, ProjectRole,
};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use serde::{Deserialize, Serialize};

use crate::devices::{DeviceRegistry, NewDevice};
use crate::doc::{advance, decode_version, encode_version, DocChanges, ProjectDoc};
use crate::editor::{ChannelError, DocMessage, EditorChannel};
use crate::ot::TextOperation;
use crate::{write_atomic, CollabError};

pub type DocSink = Arc<dyn Fn(DocMessage) + Send + Sync>;

// Counted across every LiveProject in the process: each live start builds a
// new one, and a late close from an earlier start must never match an editor
// channel opened since.
static NEXT_SESSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

const DOC_FILE: &str = "doc.bin";
const STATE_FILE: &str = "sync.json";
const LOG_FILE: &str = "doc.log";
const DEVICES_FILE: &str = "devices.json";
const AUTHORS_FILE: &str = "authors.json";
const LOG_LIMIT: usize = 500;
pub const BATCH_BYTES: usize = 4 * 1024 * 1024;
// Several changes go out in pieces of about this size, so even a slow link
// carries each one in seconds. One change that cannot be split may still be
// as large as BATCH_BYTES.
const PIECE_BYTES: usize = 512 * 1024;
const SMALLEST_BATCH_BYTES: usize = 16 * 1024;

struct OpenFile {
    channel: EditorChannel,
    sink: DocSink,
    session: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenedFile {
    pub rev: u64,
    pub session: u64,
    pub text: String,
}

#[derive(Clone)]
pub struct Outgoing {
    pub batch: BatchId,
    pub payload: Vec<u8>,
    version: VersionVector,
    sent: bool,
    sent_at: std::time::Instant,
    // Refused because the project is full: it waits for the next connection
    // without counting as on its way.
    held: bool,
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
    Unreadable,
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

// A catch-up is kept on disk until its report goes out, so quitting or a
// dropped connection halfway through a long backlog loses nothing.
#[derive(Serialize, Deserialize)]
struct StoredCatchUp {
    #[serde(with = "crate::live::hex_bytes")]
    before: Vec<u8>,
    files: BTreeMap<String, u32>,
    authors: BTreeMap<AccountId, BTreeMap<String, u32>>,
}

// The batch on its way up is kept with the sync state. After a restart it
// goes out again under the same batch id, so a server that took it before
// the app quit stores it once.
#[derive(Serialize, Deserialize)]
struct StoredOutgoing {
    batch: BatchId,
    #[serde(with = "crate::live::hex_bytes")]
    version: Vec<u8>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    catch_up: Option<StoredCatchUp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    outgoing: Option<StoredOutgoing>,
    // Changes that made the document engine panic, skipped from now on, and
    // the changes of a batch that panicked, each taken in alone next time so
    // the one at fault is found.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    skipped: BTreeSet<u64>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    suspect: BTreeSet<u64>,
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
    // Decoding its metadata made Loro panic, so taking it in would too.
    unreadable: bool,
}

const SCRATCH_FAILURES_PER_SESSION: usize = crate::doc::MOST_SCRATCH_FAILURES;

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

fn update_meta(payload: &[u8]) -> Result<Option<ImportBlobMetadata>, ()> {
    match crate::doc::blob_meta(payload, true) {
        crate::doc::Meta::Read(meta) => Ok((meta.mode == EncodedBlobMode::Updates).then_some(meta)),
        crate::doc::Meta::Malformed => Ok(None),
        crate::doc::Meta::Panicked => Err(()),
    }
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

fn receive(arrival: Arrival, known: &mut VersionVector) -> Received {
    let (meta, unreadable) = match update_meta(&arrival.payload) {
        Ok(meta) => (meta, false),
        Err(()) => (None, true),
    };
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
    Received {
        arrival,
        meta,
        introduced,
        spans,
        unreadable,
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
    repaired: bool,
    resync_needed: bool,
    unreadable: Vec<(u64, Option<DeviceId>)>,
    waiting: VersionVector,
    resync: ResyncGuard,
    dir: Option<PathBuf>,
    damaged: bool,
    skipped: BTreeSet<u64>,
    suspect: BTreeSet<u64>,
    // The person heard on this connection that the project is full.
    told_full: bool,
}

struct ChangeLog {
    records: Vec<Vec<u8>>,
    torn: bool,
}

const FIRST_RESYNC_GAP: std::time::Duration = std::time::Duration::from_secs(120);
const LONGEST_RESYNC_GAP: std::time::Duration = std::time::Duration::from_secs(3600);

// Reloads from the server's snapshot for changes held back by a missing
// dependency. The first reload goes at once. The snapshot it gets may still
// predate the missing change, so another may follow, but only after a gap
// of two minutes that doubles up to an hour, so neither an honest writer
// building on a refused change nor updates with made-up dependencies can
// keep anyone reloading. It all starts over once nothing is held back.
struct ResyncGuard {
    next: Option<std::time::Instant>,
    gap: std::time::Duration,
    first_gap: std::time::Duration,
    #[cfg(test)]
    reloads: usize,
}

impl Default for ResyncGuard {
    fn default() -> ResyncGuard {
        ResyncGuard {
            next: None,
            gap: FIRST_RESYNC_GAP,
            first_gap: FIRST_RESYNC_GAP,
            #[cfg(test)]
            reloads: 0,
        }
    }
}

fn read_log(path: &Path) -> ChangeLog {
    let Ok(bytes) = std::fs::read(path) else {
        return ChangeLog {
            records: Vec::new(),
            torn: false,
        };
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
    ChangeLog {
        records,
        torn: at < bytes.len(),
    }
}

trait LogFile: std::io::Write {
    fn end(&mut self) -> std::io::Result<u64>;
    fn cut_to(&mut self, length: u64) -> std::io::Result<()>;
    fn settle(&mut self) -> std::io::Result<()>;
}

struct OpenLog<'a> {
    file: std::fs::File,
    path: &'a Path,
}

impl std::io::Write for OpenLog<'_> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.file.write(buffer)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

impl LogFile for OpenLog<'_> {
    fn end(&mut self) -> std::io::Result<u64> {
        self.file.metadata().map(|meta| meta.len())
    }

    fn cut_to(&mut self, length: u64) -> std::io::Result<()> {
        let file = std::fs::OpenOptions::new().write(true).open(self.path)?;
        file.set_len(length)?;
        file.sync_data()
    }

    fn settle(&mut self) -> std::io::Result<()> {
        self.file.sync_data()
    }
}

fn append_record(file: &mut impl LogFile, record: &[u8]) -> Result<(), CollabError> {
    let length = u32::try_from(record.len())
        .map_err(|_| CollabError::Corrupt("a change record is too large".to_owned()))?;
    let mut framed = Vec::with_capacity(record.len() + 4);
    framed.extend_from_slice(&length.to_le_bytes());
    framed.extend_from_slice(record);
    let before = file
        .end()
        .map_err(|error| CollabError::Io(error.to_string()))?;
    let written = file.write_all(&framed).and_then(|()| file.settle());
    if let Err(error) = written {
        let _ = file.cut_to(before);
        return Err(CollabError::Io(error.to_string()));
    }
    Ok(())
}

fn append_log(path: &Path, record: &[u8]) -> Result<(), CollabError> {
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| CollabError::Io(error.to_string()))?;
    append_record(&mut OpenLog { file, path }, record)
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
    state: Option<Vec<u8>>,
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
        if let Some(state) = &self.state {
            write_atomic(&dir.join(STATE_FILE), state)?;
        }
        if let Some(json) = &self.devices {
            write_atomic(&dir.join(DEVICES_FILE), json)?;
        }
        if let Some(json) = &self.authors {
            write_atomic(&dir.join(AUTHORS_FILE), json)?;
        }
        Ok(())
    }
}

fn saved_document(dir: &Path) -> Option<ProjectDoc> {
    let bytes = std::fs::read(dir.join(DOC_FILE)).ok()?;
    let mut doc = ProjectDoc::load(&bytes).ok()?;
    for record in &read_log(&dir.join(LOG_FILE)).records {
        let _ = doc.import_saved(&[record.as_slice()]);
    }
    Some(doc)
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
            repaired: false,
            resync_needed: false,
            unreadable: Vec::new(),
            waiting: VersionVector::new(),
            resync: ResyncGuard::default(),
            dir: None,
            damaged: false,
            skipped: BTreeSet::new(),
            suspect: BTreeSet::new(),
            told_full: false,
        }
    }

    // The server refused the batch on its way because the project is full.
    // It stays as it is and goes out again on the next connection, and
    // until then it isn't waiting for an answer. True the first time on
    // this connection, so the person hears it once per connection.
    pub(crate) fn refused_as_full(&mut self) -> bool {
        if let Some(outgoing) = self.outgoing.as_mut() {
            outgoing.held = true;
        }
        !std::mem::replace(&mut self.told_full, true)
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
        let log = read_log(&dir.join(LOG_FILE));
        let saved: Vec<&[u8]> = log.records.iter().map(Vec::as_slice).collect();
        let mut damaged = log.torn;
        if doc.import_saved(&saved).is_err() {
            doc = ProjectDoc::load(&bytes)?;
            for record in &log.records {
                damaged |= doc.import_saved(&[record.as_slice()]).is_err();
            }
        }
        let mut live = LiveProject::new(doc, state.last_seq, role);
        live.dir = Some(dir.to_path_buf());
        live.skipped = state.skipped;
        live.suspect = state.suspect;
        live.confirmed = decode_version(&state.confirmed)?;
        live.anchor = state.anchor;
        live.offline_edits = state.offline_edits;
        live.outgoing = state.outgoing.and_then(|stored| live.resumed(stored));
        live.catch_up = state.catch_up.and_then(|stored| {
            Some(CatchUp {
                before: decode_version(&stored.before).ok()?,
                files: stored.files,
                authors: stored.authors,
            })
        });
        live.persisted = (!damaged).then(|| live.doc.version());
        live.log_records = log.records.len();
        live.repaired = damaged;
        live.resync_needed = !live.doc.version().includes_vv(&live.confirmed);
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
        if self.damaged {
            return Ok(self.damaged_save(dir));
        }
        self.dir = Some(dir.to_path_buf());
        let last_seq = self.last_seq;
        self.skipped.retain(|seq| *seq > last_seq);
        self.suspect.retain(|seq| *seq > last_seq);
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
            catch_up: self.catch_up.as_ref().map(|catch_up| StoredCatchUp {
                before: catch_up.before.encode(),
                files: catch_up.files.clone(),
                authors: catch_up.authors.clone(),
            }),
            outgoing: self.outgoing.as_ref().map(|outgoing| StoredOutgoing {
                batch: outgoing.batch,
                version: outgoing.version.encode(),
            }),
            skipped: self.skipped.clone(),
            suspect: self.suspect.clone(),
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
            state: Some(state),
            devices,
            authors,
        })
    }

    // The document in memory can't be trusted after the engine panicked, so
    // nothing of it is written. Only the changes to skip are added to the
    // saved sync state, which still matches the document saved on disk.
    fn damaged_save(&self, dir: &Path) -> PendingSave {
        let state = std::fs::read(dir.join(STATE_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredState>(&bytes).ok())
            .and_then(|mut stored| {
                stored.skipped.extend(self.skipped.iter().copied());
                stored.suspect = self.suspect.clone();
                to_json(&stored).ok()
            });
        PendingSave {
            dir: dir.to_path_buf(),
            document: SavedDocument::Unchanged,
            version: VersionVector::new(),
            doc_replacements: self.doc_replacements,
            state,
            devices: None,
            authors: None,
        }
    }

    pub fn end_save(
        &mut self,
        pending: PendingSave,
        written: Result<(), CollabError>,
    ) -> Result<(), CollabError> {
        if self.damaged {
            return written;
        }
        if let Err(error) = written {
            self.devices_dirty |= pending.devices.is_some();
            self.authors_dirty |= pending.authors.is_some();
            if matches!(pending.document, SavedDocument::Appended(_)) {
                self.forget_saved_document();
            }
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

    // The saved change log had a torn or unreadable record. The next save
    // writes the whole document again in place of the log.
    pub fn repaired_on_load(&self) -> bool {
        self.repaired
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
        if !matches!(
            crate::doc::blob_meta(payload, true),
            crate::doc::Meta::Read(_)
        ) {
            return PeerCheck::Unreadable;
        }
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

    // Rows from a list filtered to writer ids this copy did not know. They
    // never count as the whole list: only the full listing vouches for that.
    pub fn add_peers(&mut self, listed: Vec<ProjectPeer>) {
        if self.devices.pin_peers(&listed) {
            self.devices_dirty = true;
        }
        for bound in &listed {
            if self
                .doc
                .authors_mut()
                .witness([bound.peer], bound.account_id)
            {
                self.authors_dirty = true;
            }
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

    pub fn open_file(&mut self, id: &str, sink: DocSink) -> Result<OpenedFile, CollabError> {
        let text = self.doc.text(id)?;
        let start = self
            .editor_rev(id)
            .or_else(|| self.retired.get(id).copied())
            .map_or(0, |rev| rev + 1);
        let channel = EditorChannel::starting_at(text.clone(), start);
        let rev = channel.rev();
        let session = NEXT_SESSION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.open.insert(
            id.to_owned(),
            OpenFile {
                channel,
                sink,
                session,
            },
        );
        Ok(OpenedFile { rev, session, text })
    }

    pub fn close_file(&mut self, id: &str, session: u64) -> bool {
        if self.open.get(id).is_none_or(|open| open.session != session) {
            return false;
        }
        if let Some(closed) = self.open.remove(id) {
            self.retired.insert(id.to_owned(), closed.channel.rev());
        }
        true
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
        if self.damaged {
            return Ok(());
        }
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
                if self.doc.apply_operation(id, &applied).is_err() {
                    return self.reset_file(id);
                }
                self.note_offline(id, before);
                self.disk.texts.insert(id.to_owned());
                sink(message);
                Ok(())
            }
            Err(ChannelError::BeforeReset) => Ok(()),
            Err(ChannelError::Stale | ChannelError::Invalid(_)) => self.reset_file(id),
        }
    }

    fn reset_file(&mut self, id: &str) -> Result<(), CollabError> {
        if self.damaged {
            return Ok(());
        }
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
            let routed = open
                .channel
                .operation_for(&deltas)
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

    fn note_waiting(&mut self, waiting: &[(u64, i32)]) {
        advance(&mut self.waiting, waiting);
        let have = self.doc.version();
        let drained: Vec<u64> = self
            .waiting
            .iter()
            .filter(|(peer, end)| have.get(peer).copied().unwrap_or(0) >= **end)
            .map(|(peer, _)| *peer)
            .collect();
        if !drained.is_empty() {
            let mut left = VersionVector::new();
            for (peer, end) in self.waiting.iter() {
                if !drained.contains(peer) {
                    left.set_end(ID::new(*peer, *end));
                }
            }
            self.waiting = left;
        }
        if !self.missing_changes() {
            self.resync.next = None;
            self.resync.gap = self.resync.first_gap;
        }
    }

    // Changes Loro holds back because something they build on never
    // arrived, for example a change skipped as forged that later ones build
    // on. They never apply by themselves, so the session reloads from the
    // server's snapshot when they are still waiting after a while.
    pub fn missing_changes(&self) -> bool {
        let have = self.doc.version();
        self.waiting
            .iter()
            .any(|(peer, end)| have.get(peer).copied().unwrap_or(0) < *end)
    }

    pub fn request_resync(&mut self, now: std::time::Instant) -> bool {
        if self.resync.next.is_some_and(|next| now < next) {
            return false;
        }
        self.resync.next = Some(now + self.resync.gap);
        self.resync.gap = (self.resync.gap * 2).min(LONGEST_RESYNC_GAP);
        self.resync_needed = true;
        #[cfg(test)]
        {
            self.resync.reloads += 1;
        }
        true
    }

    #[cfg(test)]
    pub(crate) fn resync_after(&mut self, gap: std::time::Duration) {
        self.resync.gap = gap;
        self.resync.first_gap = gap;
    }

    #[cfg(test)]
    pub(crate) fn reloads(&self) -> usize {
        self.resync.reloads
    }

    pub fn diverged(&self, head: u64, at_since: Option<BatchId>) -> bool {
        self.resync_needed
            || head < self.last_seq
            || matches!((self.anchor, at_since), (Some(mine), Some(theirs)) if mine != theirs)
    }

    pub fn rebase(&mut self, seq: u64, snapshot: &[u8]) -> Result<(), CollabError> {
        let held = match crate::doc::blob_meta(snapshot, true) {
            crate::doc::Meta::Read(meta) if meta.mode == EncodedBlobMode::Snapshot => {
                meta.partial_end_vv
            }
            _ => {
                return Err(CollabError::Corrupt(
                    "the server's snapshot does not load".to_owned(),
                ))
            }
        };
        let imported = self.import_contained(snapshot)?;
        self.confirmed = held;
        self.last_seq = seq;
        self.seen.clear();
        self.numbered.clear();
        self.anchor = None;
        self.outgoing = None;
        self.resync_needed = false;
        self.note_waiting(&imported.waiting);
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
        if self.damaged {
            return Err(crate::doc::engine_failed());
        }
        if crate::doc::engine_budget_spent() {
            self.went_bad(false);
            return Err(crate::doc::engine_failed());
        }
        let mut known = self.doc.version();
        let mut fresh: Vec<Received> = Vec::new();
        let mut passed_over = 0;
        for arrival in arrivals {
            if self.is_repeated(arrival.seq, &fresh) {
                continue;
            }
            if self.skipped.contains(&arrival.seq) {
                self.mark_seen(arrival.seq);
                self.received += 1;
                passed_over += 1;
                continue;
            }
            let received = receive(arrival, &mut known);
            if received.unreadable {
                self.unreadable
                    .push((received.arrival.seq, received.arrival.device));
                self.mark_seen(received.arrival.seq);
                self.received += 1;
                passed_over += 1;
                continue;
            }
            fresh.push(received);
        }
        let (fresh, known_already): (Vec<Received>, Vec<Received>) = fresh
            .into_iter()
            .partition(|received| received.meta.is_none() || !received.spans.is_empty());
        for received in &known_already {
            if let Some(meta) = &received.meta {
                held_by_server(&mut self.confirmed, meta);
            }
            self.mark_seen(received.arrival.seq);
            self.received += 1;
        }
        if fresh.is_empty() {
            return Ok(known_already.len() + passed_over);
        }
        let arrived: Vec<(u64, Option<DeviceId>)> = fresh
            .iter()
            .map(|received| (received.arrival.seq, received.arrival.device))
            .collect();
        let holding = self.missing_changes();
        let attempt = {
            let payloads: Vec<&[u8]> = fresh
                .iter()
                .map(|received| received.arrival.payload.as_slice())
                .collect();
            if fresh
                .iter()
                .any(|received| self.suspect.contains(&received.arrival.seq))
            {
                self.import_each(&fresh, &payloads, crate::doc::Imported::default(), None)
            } else {
                let together = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    self.doc.import_keeping(&payloads)
                }));
                match together {
                    Ok(Ok(imported)) => Ok((imported, BTreeSet::new(), BTreeSet::new())),
                    Ok(Err(failure)) => {
                        let failure = *failure;
                        self.import_each(&fresh, &payloads, failure.kept, failure.panicked)
                    }
                    Err(_) => Err(None),
                }
            }
        };
        let (imported, unreadable, panicked) = match attempt {
            Ok(done) => done,
            Err(culprit) => {
                self.engine_panicked(&arrived, culprit, holding);
                return Err(crate::doc::engine_failed());
            }
        };
        // Too many scratch copies were left in memory. Only the changes that
        // panicked in theirs are blamed; the others come again next start.
        if crate::doc::engine_budget_spent()
            || self.doc.scratch_failures() >= SCRATCH_FAILURES_PER_SESSION
        {
            for index in &panicked {
                let (seq, device) = arrived[*index];
                self.skipped.insert(seq);
                self.unreadable.push((seq, device));
            }
            self.went_bad(false);
            return Err(crate::doc::engine_failed());
        }
        let mut readable = Vec::with_capacity(fresh.len());
        for (index, received) in fresh.into_iter().enumerate() {
            if unreadable.contains(&index) {
                let seq = received.arrival.seq;
                if panicked.contains(&index) {
                    self.skipped.insert(seq);
                }
                self.unreadable.push((seq, received.arrival.device));
                self.mark_seen(seq);
                self.received += 1;
            } else {
                readable.push(received);
            }
        }
        let count = readable.len();
        let taken = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.take_in_imported(&readable, imported)
        }));
        match taken {
            Ok(taken) => taken?,
            Err(_) => {
                let arrived: Vec<(u64, Option<DeviceId>)> = readable
                    .iter()
                    .map(|received| (received.arrival.seq, received.arrival.device))
                    .collect();
                self.engine_panicked(&arrived, None, holding);
                return Err(crate::doc::engine_failed());
            }
        }
        Ok(count + known_already.len() + passed_over)
    }

    // What the arrivals that went in change: who wrote what, what the server
    // holds, and the editors and catch-up counts. This reads the document
    // Loro just changed, so a panic here counts like one during the import.
    fn take_in_imported(
        &mut self,
        fresh: &[Received],
        imported: crate::doc::Imported,
    ) -> Result<(), CollabError> {
        #[cfg(test)]
        for received in fresh {
            crate::doc::failpoint::hit(
                &received.arrival.payload,
                crate::doc::failpoint::At::Applied,
            );
        }
        self.witness_arrivals(fresh);
        advance(&mut self.confirmed, &imported.arrived);
        self.note_waiting(&imported.waiting);
        for received in fresh {
            if let Some(meta) = &received.meta {
                held_by_server(&mut self.confirmed, meta);
            }
            self.mark_seen(received.arrival.seq);
            self.received += 1;
        }
        match fresh {
            [only] => self.route(imported.changes, only.arrival.author),
            _ => {
                if self.catch_up.is_some() {
                    for received in fresh {
                        let touched = self.doc.texts_changed_in(&received.spans);
                        self.count_catch_up(touched, received.arrival.author);
                    }
                }
                self.deliver(imported.changes)
            }
        }
    }

    // A batch import stops at the first update it cannot read, after taking
    // in the others. Each one is tried again alone so the unreadable ones
    // are found, skipped and reported, and the rest still count. One the
    // batch already took in fully is not imported again, and one that made
    // Loro panic in its scratch copy is not tried again. A panic in the
    // document names the update that caused it.
    #[allow(clippy::type_complexity)]
    fn import_each(
        &mut self,
        fresh: &[Received],
        payloads: &[&[u8]],
        mut kept: crate::doc::Imported,
        panicked_before: Option<usize>,
    ) -> Result<(crate::doc::Imported, BTreeSet<usize>, BTreeSet<usize>), Option<usize>> {
        let mut unreadable = BTreeSet::new();
        let mut panicked = BTreeSet::new();
        if let Some(index) = panicked_before {
            unreadable.insert(index);
            panicked.insert(index);
        }
        for (index, payload) in payloads.iter().enumerate() {
            let taken = fresh[index]
                .meta
                .as_ref()
                .is_some_and(|meta| self.doc.version().includes_vv(&meta.partial_end_vv));
            if taken || unreadable.contains(&index) {
                continue;
            }
            if crate::doc::engine_budget_spent()
                || self.doc.scratch_failures() >= SCRATCH_FAILURES_PER_SESSION
            {
                break;
            }
            let alone = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.doc.import_keeping(&[*payload])
            }));
            match alone {
                Ok(Ok(alone)) => kept.absorb(alone),
                Ok(Err(failure)) => {
                    if failure.panicked.is_some() {
                        panicked.insert(index);
                    }
                    kept.absorb(failure.kept);
                    unreadable.insert(index);
                }
                Err(_) => return Err(Some(index)),
            }
        }
        Ok((kept, unreadable, panicked))
    }

    // Loro panicked while it took in a change, so the document in memory
    // may be broken and is never saved, sent or written to disk again. The
    // change at fault is skipped from the next start on. When a whole batch
    // panicked, its changes are taken in one at a time next time to find
    // it. A change held back for a missing dependency is applied inside the
    // import of the change that supplies it, so while anything was held
    // back a panic may not be the newcomer's fault: it gets one more try,
    // alone, before it is skipped. Held-back changes are not saved with the
    // document, so on that try they are gone. Until then a copy of the
    // document as last saved stands in for the broken one.
    fn engine_panicked(
        &mut self,
        arrived: &[(u64, Option<DeviceId>)],
        culprit: Option<usize>,
        holding: bool,
    ) {
        let culprit = culprit.or_else(|| (arrived.len() == 1).then_some(0));
        match culprit.and_then(|index| arrived.get(index)) {
            Some(&(seq, _)) if holding && !self.suspect.contains(&seq) => {
                self.suspect.insert(seq);
            }
            Some(&(seq, device)) => {
                self.suspect.remove(&seq);
                self.skipped.insert(seq);
                self.unreadable.push((seq, device));
            }
            None => self.suspect.extend(arrived.iter().map(|(seq, _)| *seq)),
        }
        self.went_bad(true);
    }

    // `broken` when Loro panicked in the document itself. It is then left
    // in memory, and a copy of the project as last saved stands in, so
    // nothing that still reads the project trips over the broken one.
    pub(crate) fn went_bad(&mut self, broken: bool) {
        self.damaged = true;
        self.disk = DiskWork::default();
        if broken {
            let stand_in = self
                .dir
                .as_deref()
                .and_then(saved_document)
                .or_else(|| ProjectDoc::create().ok());
            if let Some(stand_in) = stand_in {
                crate::doc::leave_in_memory(std::mem::replace(&mut self.doc, stand_in));
            }
        }
        self.doc.freeze();
    }

    pub fn damaged(&self) -> bool {
        self.damaged
    }

    pub fn take_unreadable(&mut self) -> Vec<(u64, Option<DeviceId>)> {
        std::mem::take(&mut self.unreadable)
    }

    fn is_repeated(&self, seq: u64, fresh: &[Received]) -> bool {
        seq <= self.last_seq
            || self.seen.contains(&seq)
            || fresh.iter().any(|kept| kept.arrival.seq == seq)
    }

    fn witness_arrivals(&mut self, fresh: &[Received]) {
        for received in fresh {
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
    }

    pub fn skip_update(&mut self, seq: u64) {
        self.mark_seen(seq);
    }

    // A snapshot from the server goes into the document like any change,
    // so a panic there leaves the project damaged the same way. So does one
    // that panicked in its scratch copy, or found no room for another: the
    // next reload would fetch the same snapshot and fail again, so the
    // session ends instead of reloading it over and over.
    fn import_contained(&mut self, bytes: &[u8]) -> Result<crate::doc::Imported, CollabError> {
        if self.damaged {
            return Err(crate::doc::engine_failed());
        }
        if crate::doc::engine_budget_spent() {
            self.went_bad(false);
            return Err(crate::doc::engine_spent());
        }
        let taken =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.doc.import(bytes)));
        match taken {
            Ok(Err(error))
                if error == crate::doc::engine_failed() || error == crate::doc::engine_spent() =>
            {
                self.went_bad(false);
                Err(error)
            }
            Ok(taken) => taken,
            Err(_) => {
                self.went_bad(true);
                Err(crate::doc::engine_failed())
            }
        }
    }

    pub fn import_snapshot(&mut self, seq: u64, snapshot: &[u8]) -> Result<(), CollabError> {
        let held = match crate::doc::blob_meta(snapshot, true) {
            crate::doc::Meta::Read(meta) => Some(meta.partial_end_vv),
            crate::doc::Meta::Malformed => None,
            crate::doc::Meta::Panicked => {
                return Err(CollabError::Corrupt(
                    "the server's snapshot does not load".to_owned(),
                ))
            }
        };
        let imported = self.import_contained(snapshot)?;
        advance(&mut self.confirmed, &imported.arrived);
        // Own changes in the server's snapshot are held there too, even the
        // ones this copy already had, so they are not sent again.
        if let Some(held) = held {
            self.confirmed.merge(&held);
        }
        self.note_waiting(&imported.waiting);
        if seq > self.last_seq {
            self.last_seq = seq;
            self.moved_to(seq);
        }
        self.seen.retain(|known| *known > seq);
        self.mark_seen(seq);
        self.route(imported.changes, None)
    }

    // A reconnect halfway through keeps the catch-up already under way, so
    // the report starts from the version before the first part and counts
    // every part.
    pub fn begin_catch_up(&mut self) {
        if self.catch_up.is_some() {
            return;
        }
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

    // The project as the server holds it, as far as this copy knows: every
    // change the server confirmed and none of the ones still to send.
    pub fn confirmed_doc(&self) -> Result<ProjectDoc, CollabError> {
        self.doc.at_version(&self.confirmed)
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

    fn resumed(&self, stored: StoredOutgoing) -> Option<Outgoing> {
        let version = decode_version(&stored.version).ok()?;
        if !self.doc.version().includes_vv(&version) {
            return None;
        }
        let spans: Vec<IdSpan> = version
            .iter()
            .filter_map(|(peer, end)| {
                let from = self.confirmed.get(peer).copied().unwrap_or(0);
                (from < *end).then(|| IdSpan::new(*peer, from, *end))
            })
            .collect();
        if spans.is_empty() {
            return None;
        }
        let payload = self
            .doc
            .loro()
            .export(ExportMode::UpdatesInRange {
                spans: Cow::Owned(spans),
            })
            .ok()?;
        Some(Outgoing {
            batch: stored.batch,
            payload,
            version,
            sent: false,
            sent_at: std::time::Instant::now(),
            held: false,
        })
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
        if self.damaged {
            return Ok(false);
        }
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
        if operation.is_noop() || self.damaged {
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
        if self.damaged {
            return Ok(None);
        }
        if let Some(outgoing) = self.outgoing.as_mut() {
            if outgoing.sent {
                return Ok(None);
            }
            outgoing.sent = true;
            outgoing.sent_at = std::time::Instant::now();
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
        let target = self.batch_limit.min(PIECE_BYTES);
        let mut atoms = total.min(target.saturating_mul(2)).max(1);
        let (mut payload, mut version) = self.export_prefix(&ready, atoms)?;
        while payload.len() > target && atoms > 1 {
            let wanted = (target as u128 * 9 / 10).max(1);
            let scaled = atoms as u128 * wanted / payload.len().max(1) as u128;
            atoms = usize::try_from(scaled).unwrap_or(1).clamp(1, atoms - 1);
            (payload, version) = self.export_prefix(&ready, atoms)?;
        }
        if payload.len() > self.batch_limit {
            self.unsendable = true;
            return Ok(None);
        }
        let outgoing = Outgoing {
            batch: BatchId::new_v7(),
            payload,
            version,
            sent: true,
            sent_at: std::time::Instant::now(),
            held: false,
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

    pub fn in_flight(&self) -> Option<(BatchId, usize, std::time::Instant)> {
        self.outgoing
            .as_ref()
            .filter(|outgoing| outgoing.sent && !outgoing.held)
            .map(|outgoing| (outgoing.batch, outgoing.payload.len(), outgoing.sent_at))
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
            let differs = self.open.get(&id).is_some_and(|file| {
                current
                    .as_deref()
                    .is_none_or(|text| !file.channel.holds(text))
            });
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
        self.told_full = false;
        if let Some(outgoing) = self.outgoing.as_mut() {
            outgoing.sent = false;
            outgoing.held = false;
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
        self.outgoing.is_none()
            && !self.unsendable
            && !self.damaged
            && self.can_edit()
            && !self.unsent().is_empty()
    }

    pub fn mark_all_dirty(&mut self) -> Result<(), CollabError> {
        if self.damaged {
            return Ok(());
        }
        self.disk.tree = true;
        for node in self.doc.nodes()? {
            if node.kind == crate::doc::NodeKind::Text {
                self.disk.texts.insert(node.id);
            }
        }
        Ok(())
    }

    pub fn mark_dirty(&mut self, id: &str) {
        if !self.damaged {
            self.disk.texts.insert(id.to_owned());
        }
    }

    // A damaged project writes nothing to disk: its stand-in document is
    // older than the files there.
    pub fn take_disk_work(&mut self) -> DiskWork {
        let work = std::mem::take(&mut self.disk);
        if self.damaged {
            return DiskWork::default();
        }
        work
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
    fn a_batch_still_on_its_way_up_keeps_its_id_after_a_restart() {
        let (mut bob, mut alice, main) = pair();
        type_at_end(&mut bob, &main, " sent");
        let first = bob.next_outgoing().unwrap().unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(restarted.has_unsent());
        let again = restarted.next_outgoing().unwrap().unwrap();
        assert_eq!(again.batch, first.batch);
        alice.import_update(1, &again.payload).unwrap();
        assert_eq!(
            alice.doc().text(&main).unwrap(),
            bob.doc().text(&main).unwrap()
        );
        restarted.acknowledged(again.batch, 1);
        assert!(!restarted.has_unsent());
        restarted.save(dir.path()).unwrap();
        let mut later = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(later.next_outgoing().unwrap().is_none());
    }

    #[test]
    fn the_confirmed_document_leaves_out_changes_not_yet_acknowledged() {
        let (mut bob, _alice, main) = pair();
        type_at_end(&mut bob, &main, " sent");
        let sent = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(sent.batch, 1);
        type_at_end(&mut bob, &main, " unsent");
        assert_eq!(bob.doc().text(&main).unwrap(), "abc sent unsent");
        assert_eq!(
            bob.confirmed_doc().unwrap().text(&main).unwrap(),
            "abc sent"
        );
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let reopened = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            reopened.confirmed_doc().unwrap().text(&main).unwrap(),
            "abc sent"
        );
    }

    #[test]
    fn own_changes_in_a_downloaded_snapshot_are_not_sent_again() {
        let (mut bob, mut alice, main) = pair();
        let before = bob.doc().version();
        type_at_end(&mut bob, &main, " mine");
        let mine = bob.doc().export_since(&before).unwrap();
        alice.import_update(1, &mine).unwrap();
        assert!(bob.has_unsent());
        bob.import_snapshot(1, &alice.doc().snapshot().unwrap())
            .unwrap();
        assert!(!bob.has_unsent());
        assert_eq!(bob.pending_changes(), 0);
    }

    #[test]
    fn a_catch_up_cut_off_by_a_reconnect_or_a_restart_reports_every_part() {
        let (mut bob, mut alice, main) = pair();
        let bob_account = AccountId::new_v7();
        let mut sent = Vec::new();
        for round in 0..4 {
            type_at_end(&mut bob, &main, &format!(" {round}"));
            let outgoing = bob.next_outgoing().unwrap().unwrap();
            bob.acknowledged(outgoing.batch, round + 1);
            sent.push(outgoing);
        }
        let before = alice.doc().version();
        alice.begin_catch_up();
        alice
            .import_update_from(1, &sent[0].payload, Some(bob_account))
            .unwrap();
        alice.disconnected();
        alice.begin_catch_up();
        alice
            .import_update_from(2, &sent[1].payload, Some(bob_account))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        alice.save(dir.path()).unwrap();
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        restarted.begin_catch_up();
        for (seq, outgoing) in [(3, &sent[2]), (4, &sent[3])] {
            restarted
                .import_update_from(seq, &outgoing.payload, Some(bob_account))
                .unwrap();
        }
        let report = restarted.end_catch_up().expect("something merged");
        assert_eq!(crate::doc::decode_version(&report.before).unwrap(), before);
        assert_eq!(report.files.get(&main), Some(&4));
        assert_eq!(
            report
                .authors
                .get(&bob_account)
                .and_then(|files| files.get(&main)),
            Some(&4)
        );
        restarted.save(dir.path()).unwrap();
        let mut again = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
        assert!(again.end_catch_up().is_none());
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

    fn skipped_beside(unreadable: Option<&[u8]>) {
        let (mut bob, alice, main) = pair();
        let (trimmed, early) = crate::client::test_util::trimmed_and_unreadable(alice.doc());
        let broken = unreadable.map_or(early, <[u8]>::to_vec);
        let mut alice =
            LiveProject::new(ProjectDoc::load(&trimmed).unwrap(), 0, ProjectRole::Editor);
        let (sink, seen) = recorder();
        alice.open_file(&main, sink).unwrap();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        let carol_device = DeviceId::new_v7();
        let arrival = |seq: u64, payload: &[u8], device: Option<DeviceId>| Arrival {
            seq,
            payload: payload.to_vec(),
            device,
            author: None,
        };
        let taken = alice
            .import_arrivals(vec![
                arrival(1, &first.payload, None),
                arrival(2, &broken, Some(carol_device)),
                arrival(3, &second.payload, None),
            ])
            .unwrap();
        assert_eq!(taken, 2);
        assert_eq!(alice.doc().text(&main).unwrap(), "abcde");
        assert_eq!(alice.last_seq(), 3);
        assert_eq!(alice.received(), 3);
        assert_eq!(alice.take_unreadable(), vec![(2, Some(carol_device))]);
        assert!(alice.take_unreadable().is_empty());
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .all(|message| matches!(message, DocMessage::Remote { .. })));
        let rev = alice.editor_rev(&main).unwrap();
        alice.editor_change(&main, rev, insert(5, "!", 5)).unwrap();
        assert_eq!(alice.doc().text(&main).unwrap(), "abcde!");
        assert!(matches!(
            seen.lock().unwrap().last(),
            Some(DocMessage::Ack { length: 6, .. })
        ));
    }

    #[test]
    fn an_update_that_cannot_be_imported_is_skipped_and_the_rest_of_its_batch_reaches_the_editor() {
        skipped_beside(None);
        skipped_beside(Some(b"not a change at all"));
    }

    #[test]
    fn an_editor_change_the_document_cannot_take_resets_the_editor_instead_of_failing() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        let rev = bob.open_file(&main, sink).unwrap().rev;
        bob.comment_doc()
            .text_of(&main)
            .unwrap()
            .insert_utf16(0, "zz")
            .unwrap();
        bob.comment_doc().loro().commit();
        bob.editor_change(&main, rev, insert(3, "d", 3)).unwrap();
        assert_eq!(
            seen.lock().unwrap().last(),
            Some(&DocMessage::Reset {
                rev: rev + 2,
                text: "zzabc".to_owned()
            })
        );
        bob.editor_change(&main, rev + 2, insert(5, "d", 5))
            .unwrap();
        assert_eq!(bob.doc().text(&main).unwrap(), "zzabcd");
    }

    #[test]
    fn a_change_the_editor_sent_before_a_reset_is_dropped_without_another_reset() {
        let (mut bob, _alice, main) = pair();
        let (sink, seen) = recorder();
        let rev = bob.open_file(&main, sink).unwrap().rev;
        bob.comment_doc()
            .text_of(&main)
            .unwrap()
            .insert_utf16(0, "zz")
            .unwrap();
        bob.comment_doc().loro().commit();
        bob.editor_change(&main, rev, insert(3, "d", 3)).unwrap();
        let resets = || {
            seen.lock()
                .unwrap()
                .iter()
                .filter(|message| matches!(message, DocMessage::Reset { .. }))
                .count()
        };
        assert_eq!(resets(), 1);
        bob.editor_change(&main, rev + 1, insert(4, "e", 4))
            .unwrap();
        assert_eq!(resets(), 1);
        assert_eq!(bob.doc().text(&main).unwrap(), "zzabc");
        bob.editor_change(&main, rev + 2, insert(5, "de", 5))
            .unwrap();
        assert_eq!(bob.doc().text(&main).unwrap(), "zzabcde");
        assert_eq!(resets(), 1);
    }

    #[test]
    fn a_change_built_on_a_skipped_one_is_held_back_until_the_copy_reloads_from_the_server() {
        let (mut bob, mut alice, main) = pair();
        bob.local_text(&main, "abcd").unwrap();
        let first = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(first.batch, 1);
        bob.local_text(&main, "abcde").unwrap();
        let second = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(second.batch, 2);
        alice.skip_update(1);
        assert!(!alice.missing_changes());
        assert!(alice.import_update(2, &second.payload).unwrap());
        assert_eq!(alice.doc().text(&main).unwrap(), "abc");
        assert!(alice.missing_changes());
        assert!(!alice.import_update(1, &first.payload).unwrap());
        assert!(alice.missing_changes());
        assert!(!alice.diverged(2, alice.anchor()));
        let now = std::time::Instant::now();
        assert!(alice.request_resync(now));
        assert!(!alice.request_resync(now));
        assert!(alice.diverged(2, alice.anchor()));
        alice.rebase(2, &bob.doc().snapshot().unwrap()).unwrap();
        assert!(!alice.missing_changes());
        assert!(!alice.diverged(2, None));
        assert_eq!(alice.doc().text(&main).unwrap(), "abcde");
    }

    #[test]
    fn reloads_for_held_back_changes_are_spaced_out_and_start_over_once_nothing_waits() {
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        sent_change(&mut bob, &main, " base", 1);
        let first = sent_change(&mut bob, &main, " one", 2);
        alice.skip_update(1);
        assert!(alice.import_update(2, &first).unwrap());
        assert!(alice.missing_changes());
        let start = std::time::Instant::now();
        let after = |seconds: u64| start + std::time::Duration::from_secs(seconds);
        assert!(alice.request_resync(start));
        for (seq, word) in [(3, " two"), (4, " three"), (5, " four")] {
            let later = sent_change(&mut bob, &main, word, seq);
            alice.import_update(seq, &later).unwrap();
            assert!(!alice.request_resync(after(20 * seq)), "{word}");
        }
        assert!(alice.request_resync(after(121)));
        assert!(!alice.request_resync(after(121 + 239)));
        assert!(alice.request_resync(after(121 + 241)));
        let mut server = ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap();
        server.import(&carol.doc().snapshot().unwrap()).unwrap();
        alice.rebase(5, &server.snapshot().unwrap()).unwrap();
        assert!(!alice.missing_changes());
        sent_change(&mut carol, &main, " unseen", 6);
        let built_on_it = sent_change(&mut carol, &main, " carol", 7);
        alice.skip_update(6);
        alice.import_update(7, &built_on_it).unwrap();
        assert!(alice.missing_changes());
        assert!(alice.request_resync(after(121 + 242)));
    }

    #[test]
    fn a_batch_refused_as_full_waits_for_the_next_connection_without_counting_as_on_its_way() {
        let (_bob, mut alice, main) = pair();
        alice.mark_connected();
        alice.local_text(&main, "abc kept").unwrap();
        let first = alice.next_outgoing().unwrap().unwrap();
        assert!(alice.in_flight().is_some());
        assert!(alice.refused_as_full());
        assert!(alice.in_flight().is_none());
        assert!(!alice.refused_as_full());
        assert!(alice.next_outgoing().unwrap().is_none());
        assert!(alice.has_unsent());
        alice.disconnected();
        alice.mark_connected();
        let again = alice.next_outgoing().unwrap().unwrap();
        assert_eq!(again.batch, first.batch);
        assert!(alice.in_flight().is_some());
        assert!(alice.refused_as_full());
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

    fn sent_change(live: &mut LiveProject, id: &str, text: &str, seq: u64) -> Vec<u8> {
        type_at_end(live, id, text);
        let outgoing = live.next_outgoing().unwrap().unwrap();
        live.acknowledged(outgoing.batch, seq);
        outgoing.payload
    }

    fn from_device(device: DeviceId) -> impl Fn(u64, &[u8]) -> Arrival {
        move |seq, payload| Arrival {
            seq,
            payload: payload.to_vec(),
            device: Some(device),
            author: None,
        }
    }

    fn saved_and_loaded(live: &mut LiveProject) -> (tempfile::TempDir, LiveProject) {
        let dir = tempfile::tempdir().unwrap();
        live.save(dir.path()).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        (dir, loaded)
    }

    #[test]
    fn a_change_the_engine_panics_on_leaves_the_project_untouched_and_is_skipped_after_a_restart() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let bad = sent_change(&mut alice, &main, " boom", 1);
        panic_on(&bad, At::Document);
        assert!(bob.import_arrivals(vec![arrival(1, &bad)]).is_err());
        assert!(bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc");
        type_at_end(&mut bob, &main, " typed after");
        bob.mark_dirty(&main);
        assert!(bob.take_disk_work().is_empty());
        assert!(bob.next_outgoing().unwrap().is_none());
        assert!(bob.import_arrivals(vec![arrival(2, &bad)]).is_err());
        let saved = std::fs::read(dir.path().join(DOC_FILE)).unwrap();
        bob.save(dir.path()).unwrap();
        assert_eq!(std::fs::read(dir.path().join(DOC_FILE)).unwrap(), saved);
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            restarted.import_arrivals(vec![arrival(1, &bad)]).unwrap(),
            1
        );
        assert!(!restarted.damaged());
        assert_eq!(restarted.last_seq(), 1);
        assert_eq!(restarted.doc().text(&main).unwrap(), "abc");
        restarted.save(dir.path()).unwrap();
        let again = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(again.skipped.is_empty());
    }

    #[test]
    fn retrying_a_failed_batch_alone_skips_the_large_change_it_already_took() {
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let large = sent_change(&mut alice, &main, &noise(120_000, 11), 1);
        let small = sent_change(&mut carol, &main, " carol", 2);
        let before = crate::doc::failpoint::forks();
        let taken = bob
            .import_arrivals(vec![
                arrival(1, &large),
                arrival(2, b"not a change"),
                arrival(3, &small),
            ])
            .unwrap();
        assert_eq!(taken, 2);
        assert_eq!(bob.take_unreadable(), vec![(2, Some(device))]);
        assert_eq!(crate::doc::failpoint::forks() - before, 1);
        assert!(bob.doc().text(&main).unwrap().contains(" carol"));
    }

    #[test]
    fn a_scratch_copy_loro_panics_in_while_it_holds_its_lock_is_left_without_aborting() {
        use crate::doc::failpoint::poison_next;
        let (mut bob, mut alice, main) = pair();
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let large = sent_change(&mut alice, &main, &noise(100_000, 61), 1);
        let left = crate::doc::left_documents();
        poison_next();
        bob.import_arrivals(vec![arrival(1, &large)]).unwrap();
        assert_eq!(crate::doc::left_documents(), left + 1);
        assert_eq!(bob.doc().scratch_failures(), 1);
        assert!(!bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc mine");
    }

    #[test]
    fn a_panic_while_a_scratch_copy_is_read_back_is_contained_like_one_in_its_import() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let large = sent_change(&mut alice, &main, &noise(100_000, 62), 1);
        panic_on(&large, At::ScratchExport);
        bob.import_arrivals(vec![arrival(1, &large)]).unwrap();
        assert_eq!(bob.doc().scratch_failures(), 1);
        assert!(!bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
    }

    #[test]
    fn copies_of_the_project_loro_panics_in_are_left_without_aborting() {
        use crate::doc::failpoint::poison_next;
        let (mut bob, _alice, main) = pair();
        let snapshot = bob.doc().snapshot().unwrap();
        let left = crate::doc::left_documents();
        poison_next();
        assert!(ProjectDoc::load_contained(&snapshot).is_err());
        let base = bob.doc().version();
        type_at_end(&mut bob, &main, " more");
        poison_next();
        assert!(bob.doc().at_version(&base).is_err());
        bob.comment_doc()
            .create_comment_thread(&main, 0, 1, AccountId::new_v7(), 1, "Note", &[])
            .unwrap();
        poison_next();
        assert!(bob
            .comment_doc()
            .without_comment_changes_after(&base)
            .is_err());
        assert_eq!(crate::doc::left_documents(), left + 3);
        assert_eq!(
            ProjectDoc::load_contained(&snapshot)
                .unwrap()
                .text(&main)
                .unwrap(),
            "abc"
        );
        assert_eq!(
            bob.doc().at_version(&base).unwrap().text(&main).unwrap(),
            "abc"
        );
    }

    #[test]
    fn a_project_that_stopped_syncing_after_a_panic_takes_no_comment_edits() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        let account = AccountId::new_v7();
        let thread = bob
            .comment_doc()
            .create_comment_thread(&main, 0, 1, account, 1, "Kept", &[])
            .unwrap();
        let message = thread.messages[0].id;
        bob.save(dir.path()).unwrap();
        let bad = sent_change(&mut alice, &main, " boom", 1);
        panic_on(&bad, At::Document);
        let arrival = from_device(DeviceId::new_v7());
        assert!(bob.import_arrivals(vec![arrival(1, &bad)]).is_err());
        assert!(bob.damaged());
        let doc = bob.comment_doc();
        assert!(doc
            .create_comment_thread(&main, 0, 1, account, 2, "Lost", &[])
            .is_err());
        assert!(doc
            .reply_to_comment(&main, thread.id, account, 3, "Lost", &[])
            .is_err());
        assert!(doc
            .edit_comment(&main, thread.id, message, account, 4, "Lost", &[])
            .is_err());
        assert!(doc
            .resolve_comment_thread(&main, thread.id, account, 5)
            .is_err());
        assert!(doc.reopen_comment_thread(&main, thread.id).is_err());
        assert!(doc
            .delete_comment(&main, thread.id, message, account)
            .is_err());
        assert!(doc
            .delete_comment_thread(&main, thread.id, account)
            .is_err());
        assert_eq!(doc.comment_threads(&main).unwrap(), vec![thread]);
        assert!(bob.next_outgoing().unwrap().is_none());
    }

    #[test]
    fn a_change_whose_metadata_makes_the_decoder_panic_is_skipped_without_harm() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let bad = sent_change(&mut alice, &main, " boom", 1);
        let good = sent_change(&mut carol, &main, " carol", 2);
        panic_on(&bad, At::Decode);
        assert_eq!(bob.check_peers(&bad, device), PeerCheck::Unreadable);
        assert!(bob.doc().introduced_peers(&bad).is_err());
        assert_eq!(
            bob.import_arrivals(vec![arrival(1, &bad), arrival(2, &good)])
                .unwrap(),
            2
        );
        assert!(!bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
        assert_eq!(bob.last_seq(), 2);
        assert_eq!(bob.doc().text(&main).unwrap(), "abc carol");
    }

    #[test]
    fn a_panic_while_the_document_is_read_after_a_change_counts_like_one_during_the_import() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let bad = sent_change(&mut alice, &main, " boom", 1);
        panic_on(&bad, At::Applied);
        assert!(bob.import_arrivals(vec![arrival(1, &bad)]).is_err());
        assert!(bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
        bob.save(dir.path()).unwrap();
        let mut restarted = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            restarted.import_arrivals(vec![arrival(1, &bad)]).unwrap(),
            1
        );
        assert!(!restarted.damaged());
        assert_eq!(restarted.doc().text(&main).unwrap(), "abc");
    }

    #[test]
    fn a_change_that_panics_while_others_are_held_back_gets_a_second_try_before_it_is_skipped() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        sent_change(&mut alice, &main, " base", 1);
        let built_on_base = sent_change(&mut alice, &main, " more", 2);
        bob.skip_update(1);
        bob.import_arrivals(vec![arrival(2, &built_on_base)])
            .unwrap();
        assert!(bob.missing_changes());
        let carols = sent_change(&mut carol, &main, " carol", 3);
        panic_on(&carols, At::Document);
        assert!(bob.import_arrivals(vec![arrival(3, &carols)]).is_err());
        assert!(bob.take_unreadable().is_empty());
        bob.save(dir.path()).unwrap();
        let mut second = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(!second.missing_changes());
        assert!(second.import_arrivals(vec![arrival(3, &carols)]).is_err());
        assert_eq!(second.take_unreadable(), vec![(3, Some(device))]);
        second.save(dir.path()).unwrap();
        let mut third = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(third.import_arrivals(vec![arrival(3, &carols)]).unwrap(), 1);
        assert!(!third.damaged());
    }

    #[test]
    fn a_large_change_that_panics_in_its_scratch_copy_costs_one_copy_and_three_end_the_session() {
        use crate::doc::failpoint::{forks, panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let small = sent_change(&mut carol, &main, " carol", 1);
        let mut seq = 1;
        for round in 0..SCRATCH_FAILURES_PER_SESSION {
            seq += 1;
            let large = sent_change(&mut alice, &main, &noise(100_000, 40 + round as u64), seq);
            panic_on(&large, At::Scratch);
            let before = forks();
            let taken = bob.import_arrivals(vec![arrival(seq, &large), arrival(1, &small)]);
            assert_eq!(forks() - before, 1, "round {round}");
            if round + 1 < SCRATCH_FAILURES_PER_SESSION {
                assert!(taken.is_ok(), "round {round}");
                assert!(!bob.damaged(), "round {round}");
            } else {
                assert!(taken.is_err());
                assert!(bob.damaged());
            }
            assert!(bob.skipped.contains(&seq), "round {round}");
        }
        assert!(bob.doc().text(&main).unwrap().contains(" carol"));
    }

    #[test]
    fn a_backlog_of_large_changes_that_panic_in_scratch_copies_costs_at_most_three_copies() {
        use crate::doc::failpoint::{forks, panic_on, At};
        let (mut bob, mut alice, main) = pair();
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let mut backlog = Vec::new();
        for seq in 1..=5u64 {
            let large = sent_change(&mut alice, &main, &noise(100_000, 70 + seq), seq);
            panic_on(&large, At::Scratch);
            backlog.push(arrival(seq, &large));
        }
        let (before, left) = (forks(), crate::doc::left_documents());
        assert!(bob.import_arrivals(backlog).is_err());
        assert_eq!(forks() - before, SCRATCH_FAILURES_PER_SESSION);
        assert_eq!(
            crate::doc::left_documents() - left,
            SCRATCH_FAILURES_PER_SESSION
        );
        assert!(bob.damaged());
        assert_eq!(bob.skipped, BTreeSet::from([1, 2, 3]));
    }

    #[test]
    fn a_large_snapshot_that_panics_in_its_scratch_copy_ends_the_session_instead_of_reloading() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        type_at_end(&mut bob, &main, " mine");
        type_at_end(&mut alice, &main, &noise(100_000, 81));
        let snapshot = alice.doc().snapshot().unwrap();
        panic_on(&snapshot, At::Scratch);
        assert!(bob.rebase(1, &snapshot).is_err());
        assert!(bob.damaged());
        assert_eq!(bob.doc().scratch_failures(), 1);
    }

    #[test]
    fn once_the_engine_budget_is_spent_a_snapshot_is_not_taken_in_at_all() {
        let (mut bob, alice, _main) = pair();
        for _ in 0..crate::doc::MOST_LEFT_DOCUMENTS {
            crate::doc::leave_in_memory(Vec::<u8>::new());
        }
        let left = crate::doc::left_documents();
        assert_eq!(
            bob.import_snapshot(1, &alice.doc().snapshot().unwrap()),
            Err(crate::doc::engine_spent())
        );
        assert!(bob.damaged());
        assert_eq!(crate::doc::left_documents(), left);
    }

    #[test]
    fn a_project_whose_log_holds_a_large_change_reopens_with_all_of_it_after_the_budget_is_spent() {
        let (mut bob, mut alice, main) = pair();
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        type_at_end(&mut bob, &main, " mine");
        let large = sent_change(&mut alice, &main, &noise(100_000, 91), 1);
        bob.import_arrivals(vec![from_device(DeviceId::new_v7())(1, &large)])
            .unwrap();
        bob.save(dir.path()).unwrap();
        type_at_end(&mut bob, &main, " after");
        bob.save(dir.path()).unwrap();
        let expected = bob.doc().text(&main).unwrap();
        assert!(expected.ends_with(" after") && expected.len() > 100_000);
        for _ in 0..crate::doc::MOST_LEFT_DOCUMENTS {
            crate::doc::leave_in_memory(Vec::<u8>::new());
        }
        let mut reopened = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(!reopened.repaired_on_load());
        assert_eq!(reopened.doc().text(&main).unwrap(), expected);
        reopened.save(dir.path()).unwrap();
        let again = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(again.doc().text(&main).unwrap(), expected);
    }

    #[test]
    fn when_the_engine_budget_runs_out_in_a_pass_only_the_change_that_panicked_is_blamed() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        for _ in 1..crate::doc::MOST_LEFT_DOCUMENTS {
            crate::doc::leave_in_memory(Vec::<u8>::new());
        }
        let bad = sent_change(&mut alice, &main, &noise(100_000, 51), 1);
        let good = sent_change(&mut carol, &main, &noise(100_000, 52), 2);
        panic_on(&bad, At::Scratch);
        assert!(bob
            .import_arrivals(vec![arrival(1, &bad), arrival(2, &good)])
            .is_err());
        assert!(crate::doc::engine_budget_spent());
        assert!(bob.damaged());
        assert!(bob.skipped.contains(&1));
        assert!(!bob.skipped.contains(&2));
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
    }

    #[test]
    fn after_too_many_documents_are_left_in_memory_live_projects_stop_taking_in_changes() {
        let (mut bob, mut alice, main) = pair();
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        for _ in 0..crate::doc::MOST_LEFT_DOCUMENTS {
            crate::doc::leave_in_memory(Vec::<u8>::new());
        }
        assert!(crate::doc::engine_budget_spent());
        let change = sent_change(&mut alice, &main, " more", 1);
        assert!(bob.import_arrivals(vec![arrival(1, &change)]).is_err());
        assert!(bob.damaged());
        assert_eq!(bob.doc().text(&main).unwrap(), "abc");
    }

    #[test]
    fn when_a_batch_panics_its_changes_are_taken_in_alone_to_find_the_one_at_fault() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        let (dir, mut bob) = saved_and_loaded(&mut bob);
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let first = sent_change(&mut alice, &main, " one", 1);
        let bad = sent_change(&mut carol, &main, " bad", 2);
        let last = sent_change(&mut alice, &main, " two", 3);
        panic_on(&bad, At::Document);
        let batch = || vec![arrival(1, &first), arrival(2, &bad), arrival(3, &last)];
        assert!(bob.import_arrivals(batch()).is_err());
        assert!(bob.take_unreadable().is_empty());
        bob.save(dir.path()).unwrap();
        let mut second = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(second.import_arrivals(batch()).is_err());
        assert_eq!(second.take_unreadable(), vec![(2, Some(device))]);
        second.save(dir.path()).unwrap();
        let mut third = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(third.import_arrivals(batch()).unwrap(), 3);
        assert!(!third.damaged());
        assert_eq!(third.last_seq(), 3);
        assert_eq!(third.doc().text(&main).unwrap(), "abc one two");
    }

    #[test]
    fn a_large_change_the_engine_panics_on_in_its_scratch_copy_is_skipped_and_syncing_goes_on() {
        use crate::doc::failpoint::{panic_on, At};
        let (mut bob, mut alice, main) = pair();
        let mut carol = LiveProject::new(
            ProjectDoc::load(&bob.doc().snapshot().unwrap()).unwrap(),
            0,
            ProjectRole::Editor,
        );
        type_at_end(&mut bob, &main, " mine");
        let device = DeviceId::new_v7();
        let arrival = from_device(device);
        let large = sent_change(&mut alice, &main, &noise(120_000, 7), 1);
        assert!(large.len() >= 64 * 1024, "{}", large.len());
        let small = sent_change(&mut carol, &main, " carol", 2);
        panic_on(&large, At::Scratch);
        let taken = bob
            .import_arrivals(vec![arrival(1, &large), arrival(2, &small)])
            .unwrap();
        assert_eq!(taken, 1);
        assert!(!bob.damaged());
        assert_eq!(bob.take_unreadable(), vec![(1, Some(device))]);
        assert_eq!(bob.last_seq(), 2);
        assert!(bob.doc().text(&main).unwrap().contains(" carol"));
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
    fn a_half_written_change_record_is_ignored_on_load_and_never_hides_later_saves() {
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
        drop(log);
        let mut loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(loaded.doc().text(&main).unwrap().ends_with(" kept"));
        assert!(loaded.repaired_on_load());
        type_at_end(&mut loaded, &main, " typed after");
        loaded.save(dir.path()).unwrap();
        type_at_end(&mut loaded, &main, " and more");
        loaded.save(dir.path()).unwrap();
        let again = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(
            again.doc().text(&main).unwrap(),
            "abc kept typed after and more"
        );
        assert!(!again.repaired_on_load());
    }

    struct FailingLog {
        bytes: Vec<u8>,
        fails_after: usize,
    }

    impl std::io::Write for FailingLog {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            let room = self.fails_after.saturating_sub(self.bytes.len());
            if room == 0 {
                return Err(std::io::Error::other("the disk is full"));
            }
            let taken = room.min(buffer.len());
            self.bytes.extend_from_slice(&buffer[..taken]);
            Ok(taken)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl LogFile for FailingLog {
        fn end(&mut self) -> std::io::Result<u64> {
            Ok(self.bytes.len() as u64)
        }

        fn cut_to(&mut self, length: u64) -> std::io::Result<()> {
            self.bytes.truncate(length as usize);
            Ok(())
        }

        fn settle(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_change_record_cut_short_by_a_failed_write_is_taken_back() {
        let mut file = FailingLog {
            bytes: Vec::new(),
            fails_after: 30,
        };
        append_record(&mut file, b"first record").unwrap();
        let whole = file.bytes.clone();
        assert!(append_record(&mut file, b"a second record that does not fit").is_err());
        assert_eq!(file.bytes, whole);
        file.fails_after = usize::MAX;
        append_record(&mut file, b"third").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(LOG_FILE);
        std::fs::write(&path, &file.bytes).unwrap();
        let log = read_log(&path);
        assert!(!log.torn);
        assert_eq!(
            log.records,
            vec![b"first record".to_vec(), b"third".to_vec()]
        );
    }

    #[test]
    fn a_save_after_a_failed_append_writes_the_whole_document_again() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        type_at_end(&mut bob, &main, " one");
        std::fs::create_dir(dir.path().join(LOG_FILE)).unwrap();
        assert!(bob.save(dir.path()).is_err());
        std::fs::remove_dir(dir.path().join(LOG_FILE)).unwrap();
        type_at_end(&mut bob, &main, " two");
        bob.save(dir.path()).unwrap();
        assert!(!dir.path().join(LOG_FILE).exists());
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(loaded.doc().text(&main).unwrap(), "abc one two");
    }

    #[test]
    fn a_change_record_that_cannot_be_read_does_not_hide_the_ones_after_it() {
        let (mut bob, _alice, main) = pair();
        let notes = bob
            .doc_mut()
            .add_node(None, "notes.tex", NodeKind::Text, None, "n")
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        type_at_end(&mut bob, &main, " first");
        bob.save(dir.path()).unwrap();
        append_log(&dir.path().join(LOG_FILE), b"not a change at all").unwrap();
        type_at_end(&mut bob, &notes, " after");
        let since = bob.persisted.clone().unwrap();
        append_log(
            &dir.path().join(LOG_FILE),
            &bob.doc().export_since(&since).unwrap(),
        )
        .unwrap();
        let mut loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(loaded.doc().text(&main).unwrap(), "abc first");
        assert_eq!(loaded.doc().text(&notes).unwrap(), "n after");
        assert!(loaded.repaired_on_load());
        loaded.save(dir.path()).unwrap();
        assert!(!dir.path().join(LOG_FILE).exists());
        let again = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(again.doc().text(&notes).unwrap(), "n after");
    }

    #[test]
    fn a_copy_whose_document_lacks_changes_its_sync_state_counted_asks_for_the_servers_copy() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let loaded = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert!(!loaded.diverged(0, None));
        type_at_end(&mut bob, &main, " sent");
        let sent = bob.next_outgoing().unwrap().unwrap();
        bob.acknowledged(sent.batch, 1);
        let state = StoredState {
            last_seq: bob.last_seq(),
            confirmed: bob.confirmed.encode(),
            anchor: bob.anchor(),
            offline_edits: HashMap::new(),
            catch_up: None,
            outgoing: None,
            skipped: BTreeSet::new(),
            suspect: BTreeSet::new(),
        };
        std::fs::write(dir.path().join(STATE_FILE), to_json(&state).unwrap()).unwrap();
        let mut lost = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        assert_eq!(lost.doc().text(&main).unwrap(), "abc");
        assert!(lost.diverged(1, bob.anchor()));
        lost.rebase(1, &bob.doc().snapshot().unwrap()).unwrap();
        assert!(!lost.diverged(1, None));
        assert_eq!(lost.doc().text(&main).unwrap(), "abc sent");
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
        let opened = bob.open_file(&main, Arc::clone(&sink)).unwrap();
        let first = opened.rev;
        assert_eq!(bob.editor_rev(&main), Some(first));
        bob.editor_change(&main, first, insert(3, "d", 3)).unwrap();
        let typed = bob.editor_rev(&main).unwrap();
        assert!(typed > first);
        assert!(bob.close_file(&main, opened.session));
        assert_eq!(bob.editor_rev(&main), None);
        let reopened = bob.open_file(&main, Arc::clone(&sink)).unwrap();
        let again = reopened.rev;
        assert!(again > typed, "{again} after {typed}");
        assert_eq!(reopened.text, "abcd");
        let replaced = bob.open_file(&main, sink).unwrap().rev;
        assert!(replaced > again, "{replaced} after {again}");
        bob.editor_change(&main, replaced, insert(0, "x", 4))
            .unwrap();
        assert_eq!(bob.doc().text(&main).unwrap(), "xabcd");
        assert_eq!(bob.editor_rev(&main), Some(replaced + 1));
    }

    #[test]
    fn a_late_close_for_an_earlier_open_leaves_the_newer_channel_open() {
        let (mut bob, _alice, main) = pair();
        let (sink, _seen) = recorder();
        let earlier = bob.open_file(&main, Arc::clone(&sink)).unwrap();
        let newer = bob.open_file(&main, sink).unwrap();
        assert_ne!(earlier.session, newer.session);
        assert!(!bob.close_file(&main, earlier.session));
        assert!(bob.is_open(&main));
        assert_eq!(bob.editor_rev(&main), Some(newer.rev));
        bob.editor_change(&main, newer.rev, insert(3, "d", 3))
            .unwrap();
        assert_eq!(bob.doc().text(&main).unwrap(), "abcd");
        assert!(bob.close_file(&main, newer.session));
        assert!(!bob.is_open(&main));
        assert!(!bob.close_file(&main, newer.session));
    }

    #[test]
    fn a_close_from_an_earlier_live_start_never_closes_a_channel_opened_since() {
        let (mut bob, _alice, main) = pair();
        let dir = tempfile::tempdir().unwrap();
        bob.save(dir.path()).unwrap();
        let mut first = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        let mut second = LiveProject::load(dir.path(), ProjectRole::Owner).unwrap();
        let (sink, _seen) = recorder();
        let earlier = first.open_file(&main, Arc::clone(&sink)).unwrap();
        let newer = second.open_file(&main, sink).unwrap();
        assert_ne!(earlier.session, newer.session);
        assert!(!second.close_file(&main, earlier.session));
        assert!(second.is_open(&main));
        assert!(second.close_file(&main, newer.session));
        assert!(first.close_file(&main, earlier.session));
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
            PeerCheck::Unreadable
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
    fn a_large_paste_goes_out_in_pieces_a_slow_link_can_carry_and_one_large_value_still_fits() {
        let (mut bob, mut alice, main) = pair();
        let big = noise(2 * 1024 * 1024, 11);
        bob.local_text(&main, &big).unwrap();
        let batches = deliver_all(&mut bob, &mut alice, PIECE_BYTES);
        assert!(batches >= 4, "only {batches} batches");
        assert_eq!(alice.doc().text(&main).unwrap(), big);
        let value = noise(1024 * 1024, 12);
        bob.comment_doc()
            .loro()
            .get_map("large_value")
            .insert("value", value.as_str())
            .unwrap();
        bob.comment_doc().loro().commit();
        let whole = bob
            .next_outgoing()
            .unwrap()
            .expect("a value that cannot be split still goes out");
        assert!(whole.payload.len() > PIECE_BYTES);
        assert!(whole.payload.len() <= BATCH_BYTES);
        assert!(!bob.take_unsendable());
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
        let rev = alice.open_file(&main, sink).unwrap().rev;
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
