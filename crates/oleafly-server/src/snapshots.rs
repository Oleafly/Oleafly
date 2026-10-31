use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::Duration;

use axum::body::Bytes;
use loro::{
    ExportMode, IdSpan, ImportStatus, LoroDoc, LoroResult, LoroValue, ValueOrContainer,
    VersionVector, ID,
};
use oleafly_collab_protocol::envelope::Envelope;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use tokio::sync::{watch, Mutex};

use crate::blobs::{self, sha256_hex, BlobReader, BlobStore};
use crate::db::Db;
use crate::error::ServerError;
use crate::peers;
use crate::projects::{self, LoggedUpdate, Removal, SnapshotRow};
use crate::transfers::SMALL_TRANSFER;

mod kept;

pub use kept::Keep;

const LEGACY_FOLDER: &str = "snapshots";
const WRITE_STRIPES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    pub build_after: u64,
    pub keep_updates: u64,
}

impl Default for Policy {
    fn default() -> Policy {
        Policy {
            build_after: 1_000,
            keep_updates: 2_000,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    pub memory_bytes: u64,
    pub max_snapshot_bytes: u64,
}

impl Default for Budget {
    fn default() -> Budget {
        Budget {
            memory_bytes: 1024 * 1024 * 1024,
            max_snapshot_bytes: 200 * 1024 * 1024,
        }
    }
}

#[derive(Clone)]
pub struct Snapshots {
    blobs: BlobStore,
    data_dir: PathBuf,
    writes: Arc<[Mutex<()>]>,
    sweep: Arc<Mutex<()>>,
    policy: Arc<RwLock<Policy>>,
    budget: Arc<RwLock<Budget>>,
    reserved: Arc<RwLock<u64>>,
    freeing: Arc<AtomicU64>,
    reported: Arc<RwLock<HashMap<SharedProjectId, u64>>>,
    reads: Arc<AtomicU64>,
    building: Running,
    kept: Arc<kept::KeptDocuments>,
    shedder: Arc<RwLock<Option<Shedder>>>,
}

type Shedder = Arc<dyn Fn() -> bool + Send + Sync>;

type Running = Arc<std::sync::Mutex<HashMap<SharedProjectId, watch::Receiver<bool>>>>;

struct Building {
    running: Running,
    project: SharedProjectId,
    finished: watch::Sender<bool>,
}

enum Turn {
    Lead(Building),
    Follow(watch::Receiver<bool>),
}

impl Building {
    fn turn(running: &Running, project: SharedProjectId) -> Turn {
        let mut builds = running.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(finished) = builds.get(&project) {
            return Turn::Follow(finished.clone());
        }
        let (finished, waiting) = watch::channel(false);
        builds.insert(project, waiting);
        Turn::Lead(Building {
            running: Arc::clone(running),
            project,
            finished,
        })
    }
}

impl Drop for Building {
    fn drop(&mut self) {
        self.running
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.project);
        let _ = self.finished.send(true);
    }
}

pub enum Current {
    Read(Budgeted, u64),
    TooLarge { needed: u64, allowed: u64 },
    Busy,
    Missing,
}

struct Reserved {
    held: Arc<RwLock<u64>>,
    bytes: u64,
}

impl Drop for Reserved {
    fn drop(&mut self) {
        let mut held = self.held.write().unwrap_or_else(PoisonError::into_inner);
        *held = held.saturating_sub(self.bytes);
    }
}

impl Reserved {
    fn shrink_to(&mut self, bytes: u64) {
        if bytes < self.bytes {
            let mut held = self.held.write().unwrap_or_else(PoisonError::into_inner);
            *held = held.saturating_sub(self.bytes - bytes);
            self.bytes = bytes;
        }
    }
}

pub struct Budgeted {
    replay: Replay,
    reserved: Reserved,
}

impl Budgeted {
    pub fn reserved_bytes(&self) -> u64 {
        self.reserved.bytes
    }

    pub fn grow(&mut self, snapshots: &Snapshots, bytes: u64) -> bool {
        let Some(mut more) = snapshots.reserve(bytes) else {
            return false;
        };
        self.reserved.bytes += more.bytes;
        more.bytes = 0;
        true
    }

    pub fn replaced(self, replay: Replay) -> Budgeted {
        Budgeted {
            replay,
            reserved: self.reserved,
        }
    }

    pub fn finish(self) -> Option<Vec<u8>> {
        self.replay.finish()
    }

    pub fn into_parts(self) -> (Replay, Held) {
        (
            self.replay,
            Held {
                reserved: self.reserved,
            },
        )
    }

    fn exported(self) -> Option<(Vec<u8>, Reserved)> {
        let Budgeted {
            replay,
            mut reserved,
        } = self;
        let bytes = replay.finish()?;
        reserved.shrink_to(bytes.len() as u64);
        Some((bytes, reserved))
    }
}

pub struct Held {
    reserved: Reserved,
}

impl Held {
    pub fn bytes(&self) -> u64 {
        self.reserved.bytes
    }

    pub fn grow(&mut self, snapshots: &Snapshots, bytes: u64) -> bool {
        let Some(mut more) = snapshots.reserve(bytes) else {
            return false;
        };
        self.reserved.bytes += more.bytes;
        more.bytes = 0;
        true
    }
}

const FREE_APART_BYTES: u64 = 4 * 1024 * 1024;

struct Freeing {
    documents: Vec<Budgeted>,
    counted: Arc<AtomicU64>,
}

impl Drop for Freeing {
    fn drop(&mut self) {
        for Budgeted { replay, reserved } in self.documents.drain(..) {
            drop(replay);
            self.counted.fetch_sub(reserved.bytes, Ordering::SeqCst);
            drop(reserved);
        }
    }
}

impl std::ops::Deref for Budgeted {
    type Target = Replay;

    fn deref(&self) -> &Replay {
        &self.replay
    }
}

impl std::ops::DerefMut for Budgeted {
    fn deref_mut(&mut self) -> &mut Replay {
        &mut self.replay
    }
}

enum Replayed {
    Ready(Budgeted),
    Unreadable,
    Gap,
}

const SNAPSHOT_MEMORY_FACTOR: u64 = 10;
const LOG_MEMORY_FACTOR: u64 = 9;
const READ_SNAPSHOT_FACTOR: u64 = 6;
const READ_LOG_FACTOR: u64 = 3;
const TREE: &str = "tree";
const BLOB_KEY: &str = "blob";
const STAGED_IMPORT_BYTES: usize = 64 * 1024;
const STAGE_ATOMS: i32 = 16_384;

pub(crate) fn import_update(doc: &LoroDoc, payload: &[u8]) -> LoroResult<ImportStatus> {
    if payload.len() >= STAGED_IMPORT_BYTES && !continues_its_own_head(doc, payload) {
        if let Some(status) = in_pieces(doc, |scratch| scratch.import(payload)) {
            return Ok(status);
        }
    }
    doc.import(payload)
}

fn continues_its_own_head(doc: &LoroDoc, payload: &[u8]) -> bool {
    let Some(reach) = peers::update_reach(payload) else {
        return false;
    };
    let heads: Vec<peers::Span> = doc
        .oplog_frontiers()
        .iter()
        .map(|id| (id.peer, id.counter))
        .collect();
    match (
        heads.as_slice(),
        reach.deps.as_slice(),
        reach.starts.as_slice(),
        reach.ends.as_slice(),
    ) {
        ([head], [dep], [(peer, start)], [(writer, _)]) => {
            head == dep && head.0 == *peer && *writer == *peer && *start == head.1 + 1
        }
        _ => false,
    }
}

fn import_updates(doc: &LoroDoc, payloads: &[Vec<u8>]) -> LoroResult<ImportStatus> {
    if payloads
        .iter()
        .any(|payload| payload.len() >= STAGED_IMPORT_BYTES)
    {
        if let Some(status) = in_pieces(doc, |scratch| scratch.import_batch(payloads)) {
            return Ok(status);
        }
    }
    doc.import_batch(payloads)
}

fn in_pieces(
    doc: &LoroDoc,
    load: impl FnOnce(&LoroDoc) -> LoroResult<ImportStatus>,
) -> Option<ImportStatus> {
    let known = doc.oplog_vv();
    if known.is_empty() {
        return None;
    }
    let scratch = doc.fork();
    scratch.detach();
    let status = load(&scratch).ok()?;
    if status.pending.is_some() {
        return None;
    }
    let target = scratch.oplog_vv();
    for piece in pieces(&scratch, &known, &target)? {
        doc.import(&piece).ok()?;
    }
    doc.oplog_vv().includes_vv(&target).then_some(status)
}

fn pieces(
    scratch: &LoroDoc,
    known: &VersionVector,
    target: &VersionVector,
) -> Option<Vec<Vec<u8>>> {
    let mut chunks: Vec<(u32, u64, i32, i32)> = Vec::new();
    for (peer, end) in target.iter() {
        let mut counter = known.get(peer).copied().unwrap_or(0);
        while counter < *end {
            let change = scratch.get_change(ID::new(*peer, counter))?;
            let first = change.id.counter;
            let last = first
                .saturating_add(i32::try_from(change.len).unwrap_or(i32::MAX))
                .min(*end);
            if last <= counter {
                return None;
            }
            while counter < last {
                let to = counter.saturating_add(STAGE_ATOMS).min(last);
                let offset = u32::try_from(counter - first).unwrap_or(0);
                chunks.push((change.lamport.saturating_add(offset), *peer, counter, to));
                counter = to;
            }
        }
    }
    chunks.sort_unstable();
    let mut pieces = Vec::new();
    let mut spans: BTreeMap<u64, (i32, i32)> = BTreeMap::new();
    let mut atoms = 0;
    for (_, peer, from, to) in chunks {
        spans.entry(peer).or_insert((from, from)).1 = to;
        atoms += to - from;
        if atoms >= STAGE_ATOMS {
            pieces.push(piece(scratch, &std::mem::take(&mut spans))?);
            atoms = 0;
        }
    }
    if !spans.is_empty() {
        pieces.push(piece(scratch, &spans)?);
    }
    Some(pieces)
}

fn piece(scratch: &LoroDoc, spans: &BTreeMap<u64, (i32, i32)>) -> Option<Vec<u8>> {
    let spans = spans
        .iter()
        .map(|(peer, (from, to))| IdSpan::new(*peer, *from, *to))
        .collect();
    scratch
        .export(ExportMode::UpdatesInRange {
            spans: std::borrow::Cow::Owned(spans),
        })
        .ok()
}

pub fn build_cost(snapshot_bytes: u64, log_bytes: u64) -> u64 {
    snapshot_bytes
        .saturating_mul(SNAPSHOT_MEMORY_FACTOR)
        .saturating_add(log_bytes.saturating_mul(LOG_MEMORY_FACTOR))
}

pub fn read_cost(snapshot_bytes: u64, log_bytes: u64) -> u64 {
    snapshot_bytes
        .saturating_mul(READ_SNAPSHOT_FACTOR)
        .saturating_add(log_bytes.saturating_mul(READ_LOG_FACTOR))
}

fn megabytes(bytes: u64) -> u64 {
    bytes.div_ceil(1024 * 1024)
}

async fn blocking<T, F>(task: F) -> Result<T, ServerError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ServerError> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| ServerError::Internal(format!("a snapshot task failed: {error}")))?
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Upload {
    Stored,
    Held(u64),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signed {
    pub device: DeviceId,
    pub signature: String,
}

pub struct Opened {
    pub seq: u64,
    pub reader: BlobReader,
    pub signed: Option<Signed>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Moved {
    pub moved: usize,
    pub failed: usize,
}

impl Snapshots {
    fn writer(&self, project: SharedProjectId) -> &Mutex<()> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        project.hash(&mut hasher);
        let stripe = (hasher.finish() % WRITE_STRIPES as u64) as usize;
        &self.writes[stripe]
    }

    pub fn new(blobs: BlobStore, data_dir: &Path) -> Snapshots {
        Snapshots {
            blobs,
            data_dir: data_dir.to_path_buf(),
            writes: (0..WRITE_STRIPES).map(|_| Mutex::new(())).collect(),
            sweep: Arc::new(Mutex::new(())),
            policy: Arc::new(RwLock::new(Policy::default())),
            budget: Arc::new(RwLock::new(Budget::default())),
            reserved: Arc::new(RwLock::new(0)),
            freeing: Arc::new(AtomicU64::new(0)),
            reported: Arc::new(RwLock::new(HashMap::new())),
            reads: Arc::new(AtomicU64::new(0)),
            building: Arc::new(std::sync::Mutex::new(HashMap::new())),
            kept: Arc::new(kept::KeptDocuments::default()),
            shedder: Arc::new(RwLock::new(None)),
        }
    }

    pub fn on_pressure(&self, shed: impl Fn() -> bool + Send + Sync + 'static) {
        *self.shedder.write().unwrap_or_else(PoisonError::into_inner) = Some(Arc::new(shed));
    }

    pub fn in_use(&self) -> u64 {
        let held = *self.reserved.read().unwrap_or_else(PoisonError::into_inner);
        held.saturating_sub(self.freeing.load(Ordering::SeqCst))
    }

    fn shed(&self) -> bool {
        let shedder = self
            .shedder
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        shedder.is_some_and(|shed| shed())
    }

    pub fn document_reads(&self) -> u64 {
        self.reads.load(Ordering::Relaxed)
    }

    fn put_off(&self, project: SharedProjectId, through: u64) -> bool {
        let round = self.policy().build_after.max(1);
        self.reported
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&project)
            .is_some_and(|last| through < last.saturating_add(round))
    }

    fn refused(&self, project: SharedProjectId, through: u64) {
        self.reported
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(project, through);
    }

    pub fn policy(&self) -> Policy {
        *self.policy.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.write().unwrap_or_else(PoisonError::into_inner) = policy;
    }

    pub fn budget(&self) -> Budget {
        *self.budget.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_budget(&self, budget: Budget) {
        *self.budget.write().unwrap_or_else(PoisonError::into_inner) = budget;
    }

    pub async fn upload(
        &self,
        db: &Db,
        project: SharedProjectId,
        seq: u64,
        bytes: Bytes,
        by: AccountId,
        now: i64,
    ) -> Result<Upload, ServerError> {
        let _writing = self.writer(project).lock().await;
        self.store(db, project, seq, bytes, by, None, now).await
    }

    pub async fn upload_first(
        &self,
        db: &Db,
        project: SharedProjectId,
        bytes: Bytes,
        by: AccountId,
        signed: Option<Signed>,
        now: i64,
    ) -> Result<Upload, ServerError> {
        let _writing = self.writer(project).lock().await;
        self.store(db, project, 0, bytes, by, signed, now).await
    }

    pub(crate) fn free(&self, documents: impl IntoIterator<Item = Budgeted>) {
        let (large, small): (Vec<Budgeted>, Vec<Budgeted>) = documents
            .into_iter()
            .partition(|document| document.reserved_bytes() >= FREE_APART_BYTES);
        drop(small);
        if large.is_empty() {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            drop(large);
            return;
        };
        let bytes: u64 = large.iter().map(Budgeted::reserved_bytes).sum();
        self.freeing.fetch_add(bytes, Ordering::SeqCst);
        let freeing = Freeing {
            documents: large,
            counted: Arc::clone(&self.freeing),
        };
        drop(runtime.spawn_blocking(move || drop(freeing)));
    }

    fn reserve(&self, bytes: u64) -> Option<Reserved> {
        let mut shed = false;
        loop {
            let limit = self.budget().memory_bytes;
            let short = {
                let mut held = self
                    .reserved
                    .write()
                    .unwrap_or_else(PoisonError::into_inner);
                let staying = held.saturating_sub(self.freeing.load(Ordering::SeqCst));
                if staying.saturating_add(bytes) <= limit {
                    *held += bytes;
                    return Some(Reserved {
                        held: Arc::clone(&self.reserved),
                        bytes,
                    });
                }
                staying
                    .saturating_sub(self.kept.bytes())
                    .saturating_add(bytes)
                    > limit
            };
            if short {
                if shed || !self.shed() {
                    return None;
                }
                shed = true;
                continue;
            }
            self.free([self.kept.least_recent()?]);
        }
    }

    pub async fn caught_up(
        &self,
        db: &Db,
        project: SharedProjectId,
        kept: Option<(Budgeted, u64)>,
    ) -> Result<Option<(Budgeted, u64)>, ServerError> {
        let Some((mut replay, seq)) = kept else {
            return Ok(None);
        };
        let (head, bindings, grown) = db
            .read(move |conn| {
                let head = projects::project_row(conn, project)?.map_or(0, |row| row.head_seq);
                let grown = projects::log_span(conn, project, seq, head.max(seq))?.bytes;
                Ok((head, peers::bound_devices(conn, project)?, grown))
            })
            .await?;
        if head < seq || !replay.grow(self, read_cost(0, grown)) {
            return Ok(None);
        }
        let advanced = advance(db, project, replay, seq, head, &Arc::new(bindings)).await?;
        Ok(advanced.map(|replay| (replay, head)))
    }

    pub async fn derive(
        &self,
        db: &Db,
        project: SharedProjectId,
        through: u64,
        by: AccountId,
        now: i64,
    ) -> Result<Upload, ServerError> {
        let _writing = self.writer(project).lock().await;
        let newest = db
            .read(move |conn| projects::latest_snapshot(conn, project))
            .await?
            .ok_or(ServerError::NotFound)?;
        if through < newest.seq.saturating_add(self.policy().build_after.max(1))
            || self.put_off(project, through)
        {
            return Ok(Upload::Held(newest.seq));
        }
        let (candidates, bindings) = db
            .read(move |conn| {
                Ok((
                    projects::readable_snapshots(conn, project)?,
                    peers::bound_devices(conn, project)?,
                ))
            })
            .await?;
        let bindings = Arc::new(bindings);
        let budget = self.budget();
        for row in candidates {
            let after = row.seq;
            let (span, size) = db
                .read(move |conn| {
                    Ok((
                        projects::log_span(conn, project, after, through)?,
                        projects::snapshot_size(conn, project, after)?.unwrap_or(0),
                    ))
                })
                .await?;
            if span.count != through.saturating_sub(after) {
                tracing::warn!(
                    "Kept the snapshot of project {project} at {after} because its change log does not reach {through}"
                );
                return Ok(Upload::Held(after));
            }
            let needed = build_cost(size, span.bytes);
            if needed > budget.memory_bytes {
                self.refused(project, through);
                tracing::warn!(
                    "Kept the change log of project {project} after {after} because building its snapshot at {through} needs about {} MB and the server allows {} MB. Raise OLEAFLY_SNAPSHOT_MEMORY_MB to build it.",
                    megabytes(needed),
                    megabytes(budget.memory_bytes)
                );
                return Ok(Upload::Held(newest.seq));
            }
            let Some(reserved) = self.reserve(needed) else {
                tracing::info!(
                    "Put off the snapshot of project {project} at {through} while other snapshots are being built"
                );
                return Ok(Upload::Held(newest.seq));
            };
            let base = match self.read(project, &row).await {
                Ok(Some(bytes)) => bytes,
                Ok(None) => {
                    tracing::warn!(
                        "The snapshot of project {project} at {after} is missing from the blob store"
                    );
                    continue;
                }
                Err(error) => {
                    tracing::warn!(
                        "The snapshot of project {project} at {after} could not be read: {error}"
                    );
                    continue;
                }
            };
            let replay = match self
                .replayed(db, project, base, after, through, &bindings, reserved)
                .await?
            {
                Replayed::Ready(replay) => replay,
                Replayed::Gap => {
                    tracing::warn!(
                        "Kept the snapshot of project {project} at {after} because its change log does not reach {through}"
                    );
                    return Ok(Upload::Held(after));
                }
                Replayed::Unreadable => {
                    tracing::warn!(
                        "The snapshot of project {project} at {after} does not load, so the server builds on the one before it"
                    );
                    continue;
                }
            };
            if let Some((first, last)) = replay.left_out() {
                self.refused(project, through);
                tracing::error!(
                    "Kept the change log of project {project} and did not build its snapshot at {through}, because changes stored between {first} and {last} could not be read. Members who were online have them. Update Oleafly Server if the apps are newer than it."
                );
                return Ok(Upload::Held(newest.seq));
            }
            let Some((derived, _storing)) = blocking(move || Ok(replay.exported())).await? else {
                tracing::warn!(
                    "The snapshot of project {project} at {after} does not load, so the server builds on the one before it"
                );
                continue;
            };
            if derived.len() as u64 > budget.max_snapshot_bytes {
                self.refused(project, through);
                tracing::warn!(
                    "Kept the change log of project {project} after {after} because its snapshot at {through} holds {} MB, more than the {} MB a project may hold",
                    megabytes(derived.len() as u64),
                    megabytes(budget.max_snapshot_bytes)
                );
                return Ok(Upload::Held(newest.seq));
            }
            let stored = self
                .store(db, project, through, Bytes::from(derived), by, None, now)
                .await;
            if matches!(stored, Ok(Upload::Stored)) {
                self.reported
                    .write()
                    .unwrap_or_else(PoisonError::into_inner)
                    .remove(&project);
            }
            return stored;
        }
        Err(ServerError::Internal(format!(
            "no snapshot of project {project} loads"
        )))
    }

    pub async fn files_in_use(
        &self,
        db: &Db,
        project: SharedProjectId,
    ) -> Result<Option<HashSet<String>>, ServerError> {
        let Some((replay, _)) = self.current(db, project).await? else {
            return Ok(None);
        };
        if replay.left_out().is_some() {
            return Ok(None);
        }
        Ok(Some(blocking(move || Ok(replay.files())).await?))
    }

    #[allow(clippy::too_many_arguments)]
    async fn replayed(
        &self,
        db: &Db,
        project: SharedProjectId,
        base: Bytes,
        after: u64,
        through: u64,
        bindings: &Arc<HashMap<u64, DeviceId>>,
        reserved: Reserved,
    ) -> Result<Replayed, ServerError> {
        let started = blocking(move || {
            Ok(Replay::start(project, &base).map(|replay| Budgeted { replay, reserved }))
        });
        let Some(replay) = started.await? else {
            return Ok(Replayed::Unreadable);
        };
        Ok(
            match advance(db, project, replay, after, through, bindings).await? {
                Some(replay) => Replayed::Ready(replay),
                None => Replayed::Gap,
            },
        )
    }

    pub async fn current(
        &self,
        db: &Db,
        project: SharedProjectId,
    ) -> Result<Option<(Budgeted, u64)>, ServerError> {
        Ok(match self.read_current(db, project).await? {
            Current::Read(replay, head) => Some((replay, head)),
            Current::TooLarge { .. } | Current::Busy | Current::Missing => None,
        })
    }

    pub async fn read_current(
        &self,
        db: &Db,
        project: SharedProjectId,
    ) -> Result<Current, ServerError> {
        let (candidates, bindings, head) = db
            .read(move |conn| {
                Ok((
                    projects::readable_snapshots(conn, project)?,
                    peers::bound_devices(conn, project)?,
                    projects::project_row(conn, project)?.map_or(0, |row| row.head_seq),
                ))
            })
            .await?;
        let bindings = Arc::new(bindings);
        let budget = self.budget();
        for row in candidates {
            let after = row.seq;
            let (span, size) = db
                .read(move |conn| {
                    Ok((
                        projects::log_span(conn, project, after, head)?,
                        projects::snapshot_size(conn, project, after)?.unwrap_or(0),
                    ))
                })
                .await?;
            if span.count != head.saturating_sub(after) {
                return Ok(Current::Missing);
            }
            let needed = read_cost(size, span.bytes);
            if needed > budget.memory_bytes {
                tracing::info!(
                    "Did not read the document of project {project} because reading it needs about {} MB and the server allows {} MB",
                    megabytes(needed),
                    megabytes(budget.memory_bytes)
                );
                return Ok(Current::TooLarge {
                    needed,
                    allowed: budget.memory_bytes,
                });
            }
            let Some(reserved) = self.reserve(needed) else {
                return Ok(Current::Busy);
            };
            self.reads.fetch_add(1, Ordering::Relaxed);
            let Ok(Some(base)) = self.read(project, &row).await else {
                continue;
            };
            match self
                .replayed(db, project, base, after, head, &bindings, reserved)
                .await?
            {
                Replayed::Ready(replay) => return Ok(Current::Read(replay, head)),
                Replayed::Gap => return Ok(Current::Missing),
                Replayed::Unreadable => {}
            }
        }
        Ok(Current::Missing)
    }

    #[allow(clippy::too_many_arguments)]
    async fn store(
        &self,
        db: &Db,
        project: SharedProjectId,
        seq: u64,
        bytes: Bytes,
        by: AccountId,
        signed: Option<Signed>,
        now: i64,
    ) -> Result<Upload, ServerError> {
        let newest = db
            .call(move |conn| projects::latest_snapshot(conn, project))
            .await?;
        if let Some(newest) = &newest {
            if newest.seq > seq || (newest.seq == seq && self.readable(project, newest).await) {
                return Ok(Upload::Held(newest.seq));
            }
        }
        let (hash, size) = self.stage(db, project, bytes, now).await?;
        if !matches!(self.blobs.snapshot_size(project, &hash).await, Ok(Some(found)) if found == size)
        {
            self.drop_unused(db, project, &hash, now).await;
            return Err(ServerError::Internal(format!(
                "the snapshot of project {project} at {seq} could not be read back from the blob store"
            )));
        }
        let recorded_hash = hash.clone();
        let recorded = match db
            .call(move |conn| {
                let recorded =
                    projects::record_snapshot(conn, project, seq, &recorded_hash, size, by, now)?;
                projects::set_snapshot_signature(
                    conn,
                    project,
                    seq,
                    signed
                        .as_ref()
                        .map(|signed| (signed.device, signed.signature.as_str())),
                )?;
                Ok(recorded)
            })
            .await
        {
            Ok(recorded) => recorded,
            Err(error) => {
                self.drop_unused(db, project, &hash, now).await;
                return Err(error);
            }
        };
        if let Some(replaced) = recorded.replaced {
            if let Some(hash) = &replaced.hash {
                self.remove_queued(db, project, hash).await;
            }
            if !replaced.in_blob_store(project) {
                self.remove_legacy_file(project, &replaced.file).await;
            }
        }
        let keep = self.policy().keep_updates;
        let floor = db
            .call(move |conn| projects::compaction_floor(conn, project, seq, keep))
            .await?;
        if let Some((floor, size)) = floor {
            if floor.hash.is_some() && self.intact(project, &floor, size).await {
                let through = floor.seq;
                db.call(move |conn| projects::compact_updates(conn, project, through))
                    .await?;
                self.prune_project(db, project, now).await?;
            } else {
                tracing::warn!(
                    "Kept the change log of project {project} because its snapshot at {} could not be read from the blob store",
                    floor.seq
                );
            }
        }
        Ok(Upload::Stored)
    }

    async fn stage(
        &self,
        db: &Db,
        project: SharedProjectId,
        bytes: Bytes,
        now: i64,
    ) -> Result<(String, u64), ServerError> {
        let size = bytes.len() as u64;
        let (hash, bytes) = blocking(move || Ok((sha256_hex(&bytes), bytes))).await?;
        let queued = hash.clone();
        db.call(move |conn| {
            projects::queue_removal(conn, Removal::Snapshot, Some(project), &queued, now)
        })
        .await?;
        self.blobs.put_snapshot_as(project, &hash, bytes).await?;
        Ok((hash, size))
    }

    pub fn build_running(&self, project: SharedProjectId) -> Option<watch::Receiver<bool>> {
        self.building
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&project)
            .cloned()
    }

    pub async fn build_soon(
        &self,
        db: &Db,
        project: SharedProjectId,
        through: u64,
        by: AccountId,
        now: i64,
        wait: Duration,
    ) -> Result<Option<Upload>, ServerError> {
        let deadline = tokio::time::Instant::now() + wait;
        let building = loop {
            match Building::turn(&self.building, project) {
                Turn::Lead(building) => break building,
                Turn::Follow(mut finished) => {
                    let waited =
                        tokio::time::timeout_at(deadline, finished.wait_for(|done| *done)).await;
                    if waited.is_err() {
                        return Ok(None);
                    }
                }
            }
        };
        let (done, outcome) = tokio::sync::oneshot::channel();
        let (snapshots, db) = (self.clone(), db.clone());
        tokio::spawn(async move {
            let _building = building;
            let built = snapshots.derive(&db, project, through, by, now).await;
            if let Err(error) = &built {
                tracing::warn!(
                    "Could not build the snapshot of project {project} at {through}: {error}"
                );
            }
            let _ = done.send(built);
        });
        match tokio::time::timeout_at(deadline, outcome).await {
            Ok(Ok(built)) => built.map(Some),
            Ok(Err(_)) => Err(ServerError::Internal(format!(
                "the snapshot build of project {project} stopped before it finished"
            ))),
            Err(_) => Ok(None),
        }
    }

    async fn intact(&self, project: SharedProjectId, row: &SnapshotRow, size: u64) -> bool {
        match &row.hash {
            Some(hash) if row.in_blob_store(project) => matches!(
                self.blobs.snapshot_size(project, hash).await,
                Ok(Some(found)) if found == size
            ),
            _ => self.readable(project, row).await,
        }
    }

    async fn prune_project(
        &self,
        db: &Db,
        project: SharedProjectId,
        now: i64,
    ) -> Result<usize, ServerError> {
        let superseded = db
            .call(move |conn| projects::superseded_snapshots(conn, project))
            .await?;
        let mut removed = 0;
        for row in superseded {
            let forgotten = row.clone();
            let queued = db
                .call(move |conn| projects::forget_snapshot(conn, project, &forgotten, now))
                .await?;
            if let (true, Some(hash)) = (queued, &row.hash) {
                self.remove_queued(db, project, hash).await;
            }
            if !row.in_blob_store(project) {
                self.remove_legacy_file(project, &row.file).await;
            }
            removed += 1;
        }
        Ok(removed)
    }

    async fn remove_queued(&self, db: &Db, project: SharedProjectId, hash: &str) -> bool {
        let lookup = hash.to_string();
        let unused = db
            .call(move |conn| {
                if projects::snapshot_hash_in_use(conn, project, &lookup)? {
                    projects::finish_removal(conn, Removal::Snapshot, Some(project), &lookup)?;
                    return Ok(false);
                }
                Ok(true)
            })
            .await;
        match unused {
            Ok(true) => {}
            Ok(false) => return true,
            Err(error) => {
                tracing::warn!(
                    "Could not check whether project {project} still uses snapshot {hash}: {error}"
                );
                return false;
            }
        }
        let removed = self.blobs.remove_snapshot(project, hash).await;
        let (finished, succeeded) = (hash.to_string(), removed.is_ok());
        let noted = db
            .call(move |conn| {
                if succeeded {
                    projects::finish_removal(conn, Removal::Snapshot, Some(project), &finished)
                } else {
                    projects::removal_failed(conn, Removal::Snapshot, Some(project), &finished)
                }
            })
            .await;
        if let Err(error) = noted {
            tracing::warn!(
                "Could not note the removal of snapshot {hash} of project {project}: {error}"
            );
        }
        match removed {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(
                    "Could not remove the old snapshot {hash} of project {project}, so the server tries again at its next maintenance pass: {error}"
                );
                false
            }
        }
    }

    pub async fn retry_removal(&self, db: &Db, project: SharedProjectId, hash: &str) -> bool {
        let _writing = self.writer(project).lock().await;
        self.remove_queued(db, project, hash).await
    }

    pub async fn open(
        &self,
        db: &Db,
        project: SharedProjectId,
        before: Option<u64>,
    ) -> Result<Option<Opened>, ServerError> {
        let candidates = db
            .read(move |conn| match before {
                Some(before) => projects::readable_snapshots_before(conn, project, before),
                None => projects::readable_snapshots(conn, project),
            })
            .await?;
        if candidates.is_empty() {
            return Ok(None);
        }
        for row in &candidates {
            match self.open_row(db, project, row).await {
                Ok(Some(reader)) => {
                    let seq = row.seq;
                    let signed = db
                        .read(move |conn| projects::snapshot_signature(conn, project, seq))
                        .await?
                        .map(|(device, signature)| Signed { device, signature });
                    return Ok(Some(Opened {
                        seq,
                        reader,
                        signed,
                    }));
                }
                Ok(None) => tracing::warn!(
                    "The snapshot of project {project} at {} is missing from the blob store",
                    row.seq
                ),
                Err(error) => tracing::warn!(
                    "The snapshot of project {project} at {} could not be read: {error}",
                    row.seq
                ),
            }
        }
        Err(ServerError::Internal(format!(
            "no snapshot of project {project} could be read"
        )))
    }

    pub async fn move_legacy_files(&self, db: &Db) -> Result<Moved, ServerError> {
        let pending = db.call(|conn| projects::snapshots_to_move(conn)).await?;
        let mut outcome = Moved::default();
        for (project, row) in pending {
            let _writing = self.writer(project).lock().await;
            match self.move_one(db, project, &row).await {
                Ok(true) => outcome.moved += 1,
                Ok(false) => {}
                Err(error) => {
                    outcome.failed += 1;
                    tracing::warn!(
                        "Could not move the snapshot of project {project} at {} ({}) into the blob store: {error}",
                        row.seq,
                        row.file
                    );
                }
            }
        }
        if outcome.moved > 0 {
            tracing::info!(
                "Moved {} into the blob store",
                snapshot_count(outcome.moved)
            );
        }
        if outcome.failed > 0 {
            tracing::warn!(
                "{} still in the snapshots folder. The server tries again at its next start and at each maintenance pass.",
                snapshot_count(outcome.failed)
            );
        }
        self.clear_unused_legacy_files(db).await?;
        Ok(outcome)
    }

    pub async fn prune(&self, db: &Db, now: i64) -> Result<usize, ServerError> {
        let projects = db
            .call(|conn| projects::projects_with_superseded_snapshots(conn))
            .await?;
        let mut removed = 0;
        for project in projects {
            let _writing = self.writer(project).lock().await;
            removed += self.prune_project(db, project, now).await?;
        }
        Ok(removed)
    }

    pub async fn forget_project(&self, project: SharedProjectId, rows: &[SnapshotRow]) {
        let _writing = self.writer(project).lock().await;
        for row in rows {
            if !row.in_blob_store(project) {
                self.remove_legacy_file(project, &row.file).await;
            }
        }
    }

    async fn clear_unused_legacy_files(&self, db: &Db) -> Result<(), ServerError> {
        let folder = self.data_dir.join(LEGACY_FOLDER);
        if !folder.is_dir() {
            return Ok(());
        }
        let _sweeping = self.sweep.lock().await;
        let (pending, known) = db
            .call(|conn| {
                Ok((
                    projects::snapshots_to_move(conn)?,
                    projects::project_ids(conn)?,
                ))
            })
            .await?;
        let keep: HashSet<PathBuf> = pending
            .iter()
            .map(|(_, row)| self.data_dir.join(&row.file))
            .collect();
        let known: HashSet<String> = known.iter().map(ToString::to_string).collect();
        let removed = tokio::task::spawn_blocking(move || clear_folder(&folder, &known, &keep))
            .await
            .map_err(|error| ServerError::Internal(format!("a snapshot task failed: {error}")))?;
        if removed > 0 {
            tracing::info!(
                "Removed {} that no project uses from the snapshots folder",
                file_count(removed)
            );
        }
        Ok(())
    }

    async fn move_one(
        &self,
        db: &Db,
        project: SharedProjectId,
        row: &SnapshotRow,
    ) -> Result<bool, ServerError> {
        let hash = match &row.hash {
            Some(hash) => {
                if !matches!(self.blobs.get_snapshot(project, hash).await, Ok(Some(_))) {
                    let bytes = self.legacy_bytes(&row.file).await?.ok_or_else(|| {
                        ServerError::Internal(
                            "the stored copy and the original file are both gone".to_string(),
                        )
                    })?;
                    if sha256_hex(&bytes) != *hash {
                        return Err(ServerError::Internal(
                            "the original file no longer matches its recorded hash".to_string(),
                        ));
                    }
                    self.copy_verified(project, bytes).await?;
                }
                hash.clone()
            }
            None => {
                let bytes = self.legacy_bytes(&row.file).await?.ok_or_else(|| {
                    ServerError::Internal("the snapshot file is missing".to_string())
                })?;
                let hash = self.copy_verified(project, bytes).await?;
                let moved = row.clone();
                let recorded = hash.clone();
                if !db
                    .call(move |conn| projects::record_moved_hash(conn, project, &moved, &recorded))
                    .await?
                {
                    return Ok(false);
                }
                hash
            }
        };
        self.remove_legacy_file(project, &row.file).await;
        let seq = row.seq;
        let finished = hash.clone();
        db.call(move |conn| projects::finish_moved_snapshot(conn, project, seq, &finished))
            .await
    }

    async fn copy_verified(
        &self,
        project: SharedProjectId,
        bytes: Bytes,
    ) -> Result<String, ServerError> {
        let hash = self.blobs.put_snapshot(project, bytes).await?;
        match self.blobs.get_snapshot(project, &hash).await? {
            Some(_) => Ok(hash),
            None => Err(ServerError::Internal(
                "the copy could not be read back from the blob store".to_string(),
            )),
        }
    }

    async fn read(
        &self,
        project: SharedProjectId,
        row: &SnapshotRow,
    ) -> Result<Option<Bytes>, ServerError> {
        let Some(hash) = &row.hash else {
            return self.legacy_bytes(&row.file).await;
        };
        let stored = self.blobs.get_snapshot(project, hash).await;
        if row.in_blob_store(project) || matches!(stored, Ok(Some(_))) {
            return stored;
        }
        match self.legacy_bytes(&row.file).await? {
            Some(bytes) if sha256_hex(&bytes) == *hash => Ok(Some(bytes)),
            _ => stored,
        }
    }

    async fn open_row(
        &self,
        db: &Db,
        project: SharedProjectId,
        row: &SnapshotRow,
    ) -> Result<Option<BlobReader>, ServerError> {
        let Some(reader) = self.opened(project, row).await? else {
            return Ok(None);
        };
        let seq = row.seq;
        let stored = db
            .read(move |conn| projects::snapshot_size(conn, project, seq))
            .await?;
        if let Some(stored) = stored.filter(|stored| *stored != reader.size()) {
            return Err(ServerError::Internal(format!(
                "it holds {} bytes, not the {stored} it was stored with",
                reader.size()
            )));
        }
        if reader.size() >= SMALL_TRANSFER {
            return Ok(Some(reader));
        }
        let bytes = reader
            .read_all()
            .await
            .map_err(|error| ServerError::Internal(error.to_string()))?;
        Ok(Some(BlobReader::whole(bytes)))
    }

    async fn opened(
        &self,
        project: SharedProjectId,
        row: &SnapshotRow,
    ) -> Result<Option<BlobReader>, ServerError> {
        let legacy = self.data_dir.join(&row.file);
        let Some(hash) = &row.hash else {
            return blobs::open_file(legacy, None).await;
        };
        let stored = self.blobs.open_snapshot(project, hash).await;
        if row.in_blob_store(project) || matches!(stored, Ok(Some(_))) {
            return stored;
        }
        match blobs::open_file(legacy, Some(hash)).await? {
            Some(reader) => Ok(Some(reader)),
            None => stored,
        }
    }

    async fn readable(&self, project: SharedProjectId, row: &SnapshotRow) -> bool {
        matches!(self.read(project, row).await, Ok(Some(_)))
    }

    async fn drop_unused(&self, db: &Db, project: SharedProjectId, hash: &str, now: i64) {
        let queued = hash.to_string();
        let noted = db
            .call(move |conn| {
                projects::queue_removal(conn, Removal::Snapshot, Some(project), &queued, now)
            })
            .await;
        if let Err(error) = noted {
            tracing::warn!(
                "Could not note snapshot {hash} of project {project} for removal: {error}"
            );
        }
        self.remove_queued(db, project, hash).await;
    }

    async fn legacy_bytes(&self, file: &str) -> Result<Option<Bytes>, ServerError> {
        let path = self.data_dir.join(file);
        tokio::task::spawn_blocking(move || match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(Bytes::from(bytes))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ServerError::Internal(format!(
                "could not read the snapshot file {}: {error}",
                path.display()
            ))),
        })
        .await
        .map_err(|error| ServerError::Internal(format!("a snapshot task failed: {error}")))?
    }

    async fn remove_legacy_file(&self, project: SharedProjectId, file: &str) {
        let path = self.data_dir.join(file);
        let folder = self.data_dir.join(LEGACY_FOLDER).join(project.to_string());
        let removed = tokio::task::spawn_blocking(move || {
            let outcome = match std::fs::remove_file(&path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
                _ => Ok(()),
            };
            let _ = std::fs::remove_dir(&folder);
            outcome
        })
        .await;
        if let Ok(Err(error)) = removed {
            tracing::warn!("Could not remove the old snapshot file {file}: {error}");
        }
    }
}

pub struct Replay {
    project: SharedProjectId,
    doc: LoroDoc,
    reached: HashMap<u64, Reached>,
}

#[derive(Clone, Copy)]
struct Reached {
    end: i32,
    first: u64,
    last: u64,
}

pub async fn advance(
    db: &Db,
    project: SharedProjectId,
    mut replay: Budgeted,
    after: u64,
    through: u64,
    bindings: &Arc<HashMap<u64, DeviceId>>,
) -> Result<Option<Budgeted>, ServerError> {
    let mut cursor = after;
    while cursor < through {
        let page = db
            .read(move |conn| projects::logged_between(conn, project, cursor, through))
            .await?;
        let contiguous = page
            .iter()
            .zip(cursor + 1..)
            .all(|(entry, expected)| entry.seq == expected);
        let Some(last) = page.last().filter(|_| contiguous).map(|entry| entry.seq) else {
            return Ok(None);
        };
        cursor = last;
        let known = Arc::clone(bindings);
        replay = blocking(move || {
            replay.apply(&page, &known);
            Ok(replay)
        })
        .await?;
    }
    Ok(Some(replay))
}

fn heads_after(
    mut heads: BTreeSet<peers::Span>,
    deps: &BTreeSet<peers::Span>,
    ends: &[peers::Span],
) -> Option<BTreeSet<peers::Span>> {
    let [(peer, end)] = ends else {
        return None;
    };
    heads.retain(|head| !deps.contains(head) && !(head.0 == *peer && head.1 < *end));
    heads.insert((*peer, end - 1));
    Some(heads)
}

pub(crate) fn builds_on(reach: &peers::Reach, known: &VersionVector) -> bool {
    let counter = |peer: &u64| known.get(peer).copied().unwrap_or(0);
    reach
        .starts
        .iter()
        .all(|(peer, start)| counter(peer) >= *start)
        && reach.deps.iter().all(|(peer, at)| counter(peer) > *at)
}

impl Replay {
    pub fn start(project: SharedProjectId, base: &[u8]) -> Option<Replay> {
        peers::snapshot_reach(base)?;
        let doc = LoroDoc::new();
        doc.import(base).ok()?;
        Some(Replay {
            project,
            doc,
            reached: HashMap::new(),
        })
    }

    pub fn left_out(&self) -> Option<(u64, u64)> {
        let held = self.doc.oplog_vv();
        self.reached
            .iter()
            .filter(|(peer, reached)| held.get(peer).copied().unwrap_or(0) < reached.end)
            .map(|(_, reached)| (reached.first, reached.last))
            .reduce(|(low, high), (first, last)| (low.min(first), high.max(last)))
    }

    pub fn apply(&mut self, entries: &[LoggedUpdate], bindings: &HashMap<u64, DeviceId>) {
        let mut known = self.doc.oplog_vv();
        let mut waiting = Vec::new();
        let mut heads = Some(self.heads());
        for entry in entries {
            let Ok(envelope) = serde_json::from_slice::<Envelope>(&entry.envelope) else {
                continue;
            };
            if envelope.project_id != self.project || envelope.device_id != entry.device {
                continue;
            }
            let Some(reach) = peers::update_reach(&envelope.payload) else {
                continue;
            };
            let taken = reach.ends.iter().any(|(peer, _)| {
                bindings
                    .get(peer)
                    .is_some_and(|bound| *bound != entry.device)
            });
            if taken {
                continue;
            }
            for (peer, end) in &reach.ends {
                let reached = self.reached.entry(*peer).or_insert(Reached {
                    end: *end,
                    first: entry.seq,
                    last: entry.seq,
                });
                reached.end = reached.end.max(*end);
                reached.first = reached.first.min(entry.seq);
                reached.last = reached.last.max(entry.seq);
            }
            if builds_on(&reach, &known) {
                for (peer, end) in &reach.ends {
                    if known.get(peer).copied().unwrap_or(0) < *end {
                        known.insert(*peer, *end);
                    }
                }
            }
            let deps: BTreeSet<peers::Span> = reach.deps.iter().copied().collect();
            if heads.as_ref() == Some(&deps) {
                self.import_all(&mut waiting);
                let current = self.heads();
                if current == deps {
                    let _ = import_update(&self.doc, &envelope.payload);
                    heads = Some(self.heads());
                    continue;
                }
                heads = Some(current);
            }
            heads = heads.and_then(|heads| heads_after(heads, &deps, &reach.ends));
            waiting.push(envelope.payload);
        }
        self.import_all(&mut waiting);
    }

    fn heads(&self) -> BTreeSet<peers::Span> {
        self.doc
            .oplog_frontiers()
            .iter()
            .map(|id| (id.peer, id.counter))
            .collect()
    }

    fn import_all(&self, waiting: &mut Vec<Vec<u8>>) {
        if waiting.is_empty() {
            return;
        }
        let before = self.doc.oplog_vv();
        if import_updates(&self.doc, waiting).is_err() && self.doc.oplog_vv() == before {
            for payload in waiting.iter() {
                let _ = import_update(&self.doc, payload);
            }
        }
        waiting.clear();
    }

    pub fn doc(&self) -> &LoroDoc {
        &self.doc
    }

    pub fn finish(self) -> Option<Vec<u8>> {
        self.doc.export(ExportMode::Snapshot).ok()
    }

    pub fn files(&self) -> HashSet<String> {
        let tree = self.doc.get_tree(TREE);
        tree.get_nodes(false)
            .into_iter()
            .filter_map(|node| tree.get_meta(node.id).ok())
            .filter_map(|meta| match meta.get(BLOB_KEY) {
                Some(ValueOrContainer::Value(LoroValue::String(hash))) => {
                    Some(hash.as_str().to_owned())
                }
                _ => None,
            })
            .collect()
    }
}

pub fn replay(
    project: SharedProjectId,
    base: &[u8],
    entries: &[LoggedUpdate],
    bindings: &HashMap<u64, DeviceId>,
) -> Option<Vec<u8>> {
    let mut replay = Replay::start(project, base)?;
    replay.apply(entries, bindings);
    replay.finish()
}

fn clear_folder(folder: &Path, known: &HashSet<String>, keep: &HashSet<PathBuf>) -> usize {
    let mut removed = 0;
    let Ok(projects) = std::fs::read_dir(folder) else {
        return removed;
    };
    for project in projects.flatten() {
        if !known.contains(project.file_name().to_string_lossy().as_ref()) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let is_file = file.file_type().is_ok_and(|kind| kind.is_file());
            if is_file && !keep.contains(&path) && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
        let _ = std::fs::remove_dir(project.path());
    }
    let _ = std::fs::remove_dir(folder);
    removed
}

fn file_count(count: usize) -> String {
    if count == 1 {
        "1 file".to_string()
    } else {
        format!("{count} files")
    }
}

fn snapshot_count(count: usize) -> String {
    if count == 1 {
        "1 snapshot".to_string()
    } else {
        format!("{count} snapshots")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshots() -> (tempfile::TempDir, Snapshots) {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::filesystem(dir.path());
        let snapshots = Snapshots::new(store, dir.path());
        (dir, snapshots)
    }

    #[tokio::test]
    async fn one_project_writing_its_snapshot_never_holds_up_another_project() {
        let (_dir, snapshots) = snapshots();
        let first = SharedProjectId::new_v7();
        let others: Vec<SharedProjectId> = (0..32).map(|_| SharedProjectId::new_v7()).collect();
        let _writing = snapshots.writer(first).lock().await;
        assert!(snapshots.writer(first).try_lock().is_err());
        let free = others
            .iter()
            .filter(|project| snapshots.writer(**project).try_lock().is_ok())
            .count();
        assert!(free >= 28, "only {free} of 32 other projects could write");
    }

    #[test]
    fn snapshots_built_at_the_same_time_share_one_memory_budget() {
        let (_dir, snapshots) = snapshots();
        snapshots.set_budget(Budget {
            memory_bytes: 100,
            max_snapshot_bytes: 1_000,
        });
        let first = snapshots.reserve(60).expect("the first build fits");
        assert!(snapshots.reserve(60).is_none());
        let second = snapshots.reserve(40).expect("what is left still fits");
        assert!(snapshots.reserve(1).is_none());
        drop(first);
        let third = snapshots
            .reserve(60)
            .expect("a finished build gives its share back");
        drop((second, third));
        assert!(snapshots.reserve(100).is_some());
        assert!(snapshots.reserve(101).is_none());
    }

    async fn project_with_snapshot(snapshots: &Snapshots, db: &Db, text: &str) -> SharedProjectId {
        let project = SharedProjectId::new_v7();
        let owner = db
            .call(move |conn| {
                let owner = crate::members::create_account(
                    conn,
                    "Ada",
                    None,
                    oleafly_collab_protocol::roles::ServerRole::Member,
                    1,
                )?;
                conn.execute(
                    "INSERT INTO projects (id, owner_account, title, status, created_at) VALUES (?1, ?2, 'Thesis', 'active', 1)",
                    rusqlite::params![project.to_string(), owner.to_string()],
                )?;
                Ok(owner)
            })
            .await
            .unwrap();
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        doc.get_text("text").insert(0, text).unwrap();
        doc.commit();
        let bytes = doc.export(ExportMode::Snapshot).unwrap();
        snapshots
            .upload_first(db, project, Bytes::from(bytes), owner, None, 1)
            .await
            .unwrap();
        project
    }

    #[tokio::test]
    async fn a_document_read_keeps_its_share_of_the_budget_until_it_is_dropped() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let project = project_with_snapshot(&snapshots, &db, "Hello").await;
        let size = db
            .call(move |conn| projects::snapshot_size(conn, project, 0))
            .await
            .unwrap()
            .expect("a stored snapshot");
        let needed = read_cost(size, 0);
        snapshots.set_budget(Budget {
            memory_bytes: needed,
            max_snapshot_bytes: 1 << 20,
        });
        let (kept, head) = snapshots
            .current(&db, project)
            .await
            .unwrap()
            .expect("the document fits the budget");
        assert_eq!(head, 0);
        assert_eq!(kept.reserved_bytes(), needed);
        assert_eq!(kept.doc().get_text("text").to_string(), "Hello");
        assert!(snapshots.reserve(needed).is_none());
        assert!(snapshots.current(&db, project).await.unwrap().is_none());
        drop(kept);
        assert!(snapshots.reserve(needed).is_some());
    }

    async fn read_cost_of(db: &Db, project: SharedProjectId) -> u64 {
        let size = db
            .call(move |conn| projects::snapshot_size(conn, project, 0))
            .await
            .unwrap()
            .expect("a stored snapshot");
        read_cost(size, 0)
    }

    async fn kept_for(snapshots: &Snapshots, db: &Db, keep: Keep, project: SharedProjectId) {
        let (document, head) = snapshots
            .current(db, project)
            .await
            .unwrap()
            .expect("the document fits the budget");
        snapshots.keep(keep, project, document, head);
    }

    #[tokio::test]
    async fn a_kept_document_gives_way_to_a_read_that_needs_its_memory() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let first = project_with_snapshot(&snapshots, &db, "Hello").await;
        let second = project_with_snapshot(&snapshots, &db, "Hello").await;
        let needed = read_cost_of(&db, first).await;
        assert_eq!(read_cost_of(&db, second).await, needed);
        snapshots.set_budget(Budget {
            memory_bytes: needed,
            max_snapshot_bytes: 1 << 20,
        });
        kept_for(&snapshots, &db, Keep::MentionScans, first).await;
        assert_eq!(snapshots.kept_bytes(), needed);
        let (read, _) = snapshots
            .current(&db, second)
            .await
            .unwrap()
            .expect("the kept document gives its memory to the read");
        assert_eq!(read.reserved_bytes(), needed);
        assert_eq!(snapshots.kept_bytes(), 0);
        assert!(snapshots.take_kept(Keep::MentionScans, first).is_none());
        assert!(
            snapshots.current(&db, first).await.unwrap().is_none(),
            "a document in use keeps its memory"
        );
    }

    #[tokio::test]
    async fn the_document_kept_last_stays_and_older_ones_give_way() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let mut projects = Vec::new();
        for _ in 0..3 {
            projects.push(project_with_snapshot(&snapshots, &db, "Hello").await);
        }
        let needed = read_cost_of(&db, projects[0]).await;
        snapshots.set_budget(Budget {
            memory_bytes: 4 * needed,
            max_snapshot_bytes: 1 << 20,
        });
        for project in &projects {
            kept_for(&snapshots, &db, Keep::CommentChecks, *project).await;
        }
        assert_eq!(snapshots.kept_bytes(), 2 * needed);
        assert!(snapshots
            .take_kept(Keep::CommentChecks, projects[0])
            .is_none());
        snapshots.clear_kept(Keep::CommentChecks);
        snapshots.set_budget(Budget {
            memory_bytes: needed + needed / 2,
            max_snapshot_bytes: 1 << 20,
        });
        kept_for(&snapshots, &db, Keep::CommentChecks, projects[2]).await;
        assert_eq!(
            snapshots.kept_bytes(),
            needed,
            "a document larger than the kept share on its own still stays"
        );
        assert!(snapshots
            .take_kept(Keep::CommentChecks, projects[2])
            .is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn kept_documents_nobody_uses_are_swept_and_scans_can_drop_theirs() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let checked = project_with_snapshot(&snapshots, &db, "Hello").await;
        let scanned = project_with_snapshot(&snapshots, &db, "Hello").await;
        kept_for(&snapshots, &db, Keep::CommentChecks, checked).await;
        kept_for(&snapshots, &db, Keep::MentionScans, scanned).await;
        let both = snapshots.kept_bytes();
        snapshots.clear_kept(Keep::MentionScans);
        assert_eq!(snapshots.kept_bytes(), both / 2);
        tokio::time::advance(Duration::from_secs(14 * 60)).await;
        assert_eq!(snapshots.sweep_kept(), 0);
        tokio::time::advance(Duration::from_secs(2 * 60)).await;
        assert_eq!(snapshots.sweep_kept(), 1);
        assert_eq!(snapshots.kept_bytes(), 0);
    }

    struct HeldThread {
        release: std::sync::mpsc::Sender<()>,
        held: tokio::task::JoinHandle<()>,
    }

    impl HeldThread {
        fn hold() -> HeldThread {
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let held = tokio::task::spawn_blocking(move || {
                let _ = wait.recv();
            });
            HeldThread { release, held }
        }

        async fn let_go(self) {
            drop(self.release);
            self.held.await.unwrap();
            tokio::task::spawn_blocking(|| ()).await.unwrap();
        }
    }

    async fn large_document(
        snapshots: &Snapshots,
        db: &Db,
        project: SharedProjectId,
    ) -> (Budgeted, u64) {
        let (mut document, head) = snapshots
            .current(db, project)
            .await
            .unwrap()
            .expect("the document fits the budget");
        assert!(document.grow(snapshots, FREE_APART_BYTES));
        (document, head)
    }

    #[test]
    fn large_documents_leaving_the_kept_pool_are_freed_on_a_blocking_thread() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .start_paused(true)
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            let (_dir, snapshots) = snapshots();
            let db = Db::open_in_memory().unwrap();
            let held = || *snapshots.reserved.read().unwrap();
            let mut projects = Vec::new();
            for _ in 0..4 {
                projects.push(project_with_snapshot(&snapshots, &db, "Hello").await);
            }
            snapshots.set_budget(Budget {
                memory_bytes: 64 << 20,
                max_snapshot_bytes: 1 << 20,
            });

            let (document, head) = large_document(&snapshots, &db, projects[0]).await;
            let size = document.reserved_bytes();
            snapshots.keep(Keep::CommentChecks, projects[0], document, head);
            tokio::time::advance(Duration::from_secs(16 * 60)).await;
            let thread = HeldThread::hold();
            assert_eq!(snapshots.sweep_kept(), 1);
            assert_eq!(snapshots.kept_bytes(), 0);
            assert_eq!(
                held(),
                size,
                "a swept document is freed on the blocking thread"
            );
            thread.let_go().await;
            assert_eq!(held(), 0);

            let (document, head) = large_document(&snapshots, &db, projects[1]).await;
            snapshots.keep(Keep::MentionScans, projects[1], document, head);
            tokio::time::advance(Duration::from_secs(6 * 60)).await;
            let thread = HeldThread::hold();
            assert!(snapshots
                .take_kept(Keep::CommentChecks, projects[0])
                .is_none());
            assert_eq!(snapshots.kept_bytes(), 0);
            assert_eq!(
                held(),
                size,
                "an idle document met on a take is freed apart"
            );
            thread.let_go().await;
            assert_eq!(held(), 0);

            snapshots.set_budget(Budget {
                memory_bytes: 3 * size,
                max_snapshot_bytes: 1 << 20,
            });
            let (older, older_head) = large_document(&snapshots, &db, projects[2]).await;
            let (newer, newer_head) = large_document(&snapshots, &db, projects[3]).await;
            let thread = HeldThread::hold();
            snapshots.keep(Keep::CommentChecks, projects[2], older, older_head);
            snapshots.keep(Keep::CommentChecks, projects[3], newer, newer_head);
            assert_eq!(snapshots.kept_bytes(), size);
            assert_eq!(held(), 2 * size, "a document pushed out is freed apart");
            thread.let_go().await;
            assert_eq!(held(), size);

            snapshots.set_budget(Budget {
                memory_bytes: size,
                max_snapshot_bytes: 1 << 20,
            });
            let thread = HeldThread::hold();
            let reserved = snapshots
                .reserve(size)
                .expect("the memory a kept document is giving back counts as free");
            assert_eq!(snapshots.kept_bytes(), 0);
            assert_eq!(
                held(),
                2 * size,
                "a document given up for a reservation is freed apart"
            );
            thread.let_go().await;
            assert_eq!(held(), size);
            drop(reserved);
            assert_eq!(held(), 0);
        });
    }

    #[tokio::test]
    async fn an_exported_snapshot_keeps_its_share_of_the_budget_until_it_is_stored() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let project = project_with_snapshot(&snapshots, &db, "Hello").await;
        let (document, _) = snapshots
            .current(&db, project)
            .await
            .unwrap()
            .expect("the document fits the budget");
        assert!(document.reserved_bytes() > 0);
        let (bytes, storing) = document.exported().expect("an export");
        let held = || *snapshots.reserved.read().unwrap();
        assert_eq!(storing.bytes, bytes.len() as u64);
        assert_eq!(held(), bytes.len() as u64);
        drop(storing);
        assert_eq!(held(), 0);
    }

    #[tokio::test]
    async fn a_comment_check_waits_for_a_build_of_its_project_instead_of_skipping_it() {
        use crate::comment_guard::{CommentGuard, Verdict};
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let project = project_with_snapshot(&snapshots, &db, "Hello").await;
        let needed = read_cost_of(&db, project).await;
        snapshots.set_budget(Budget {
            memory_bytes: needed,
            max_snapshot_bytes: 1 << 20,
        });
        let base = LoroDoc::new();
        base.set_peer_id(1).unwrap();
        base.get_text("text").insert(0, "Hello").unwrap();
        base.commit();
        let typist = LoroDoc::new();
        typist
            .import(&base.export(ExportMode::Snapshot).unwrap())
            .unwrap();
        typist.set_peer_id(2).unwrap();
        let before = typist.oplog_vv();
        typist.get_text("text").insert(5, " world").unwrap();
        typist.commit();
        let typed = typist.export(ExportMode::updates(&before)).unwrap();
        let Turn::Lead(building) = Building::turn(&snapshots.building, project) else {
            panic!("no other build runs");
        };
        let held = snapshots.reserve(needed).expect("the build's share");
        let checking = {
            let (db, snapshots) = (db.clone(), snapshots.clone());
            tokio::spawn(async move {
                let reach = peers::update_reach(&typed).expect("a reach");
                CommentGuard::default()
                    .check(&db, &snapshots, project, typed, &reach)
                    .await
            })
        };
        tokio::time::sleep(Duration::from_secs(3)).await;
        drop(held);
        drop(building);
        assert_eq!(checking.await.unwrap().unwrap(), Verdict::Allowed);
    }

    #[tokio::test]
    async fn an_object_written_but_never_recorded_is_removed_by_maintenance() {
        let (_dir, snapshots) = snapshots();
        let db = Db::open_in_memory().unwrap();
        let project = project_with_snapshot(&snapshots, &db, "Hello").await;
        let recorded = db
            .call(move |conn| projects::pending_removals(conn, 10))
            .await
            .unwrap();
        assert!(recorded.is_empty(), "{recorded:?}");
        let (hash, _) = snapshots
            .stage(&db, project, Bytes::from_static(b"a build that stopped"), 2)
            .await
            .unwrap();
        assert!(snapshots
            .blobs
            .get_snapshot(project, &hash)
            .await
            .unwrap()
            .is_some());
        let pending = db
            .call(move |conn| projects::pending_removals(conn, 10))
            .await
            .unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].hash, hash);
        crate::blobs::cleanup::finish_removals(&db, &snapshots.blobs, &snapshots)
            .await
            .unwrap();
        assert!(snapshots
            .blobs
            .get_snapshot(project, &hash)
            .await
            .unwrap()
            .is_none());
    }

    fn logged(
        seq: u64,
        project: SharedProjectId,
        device: DeviceId,
        payload: Vec<u8>,
    ) -> LoggedUpdate {
        let envelope = Envelope {
            v: 1,
            project_id: project,
            batch_id: oleafly_collab_protocol::ids::BatchId::new_v7(),
            device_id: device,
            mode: oleafly_collab_protocol::envelope::EnvelopeMode::Plain,
            key_epoch: None,
            payload,
            signature: Vec::new(),
        };
        LoggedUpdate {
            seq,
            device,
            envelope: serde_json::to_vec(&envelope).unwrap(),
        }
    }

    fn typed(doc: &LoroDoc, peer: u64, text: &str) -> Vec<u8> {
        let before = doc.oplog_vv();
        doc.set_peer_id(peer).unwrap();
        let field = doc.get_text("text");
        field.insert(field.len_unicode(), text).unwrap();
        doc.commit();
        doc.export(ExportMode::updates(&before)).unwrap()
    }

    #[test]
    fn a_page_of_concurrent_changes_is_imported_in_a_pass_or_two_not_one_per_change() {
        let project = SharedProjectId::new_v7();
        let laptop = DeviceId::new_v7();
        let base_doc = LoroDoc::new();
        base_doc.set_peer_id(1).unwrap();
        base_doc.get_text("text").insert(0, "Hello").unwrap();
        base_doc.commit();
        let base = base_doc.export(ExportMode::Snapshot).unwrap();
        let writers: Vec<LoroDoc> = (0..3)
            .map(|_| {
                let doc = LoroDoc::new();
                doc.import(&base).unwrap();
                doc
            })
            .collect();
        let mut entries = Vec::new();
        for round in 0..30u64 {
            let writer = &writers[usize::try_from(round % 3).unwrap()];
            let peer = 10 + round % 3;
            entries.push(logged(
                round + 1,
                project,
                laptop,
                typed(writer, peer, " x"),
            ));
        }
        let mut replay = Replay::start(project, &base).expect("a replay");
        let passes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = Arc::clone(&passes);
        let _watching = replay.doc.subscribe_root(Arc::new(move |_| {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        replay.apply(&entries, &HashMap::new());
        assert!(passes.load(std::sync::atomic::Ordering::SeqCst) <= 2);
        let built = LoroDoc::new();
        built.import(&replay.finish().unwrap()).unwrap();
        let expected = LoroDoc::new();
        expected.import(&base).unwrap();
        for writer in &writers {
            expected
                .import(&writer.export(ExportMode::all_updates()).unwrap())
                .unwrap();
        }
        assert_eq!(
            built.get_text("text").to_string(),
            expected.get_text("text").to_string()
        );
    }

    #[test]
    fn one_person_pasting_large_blocks_is_replayed_quickly() {
        let project = SharedProjectId::new_v7();
        let laptop = DeviceId::new_v7();
        let writer = LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer.get_text("text").insert(0, "Hello").unwrap();
        writer.commit();
        let base = writer.export(ExportMode::Snapshot).unwrap();
        let block = "abcdefghijklmnopqrstuvwxyz".repeat(64 * 1024 / 26);
        let entries: Vec<LoggedUpdate> = (0..22u64)
            .map(|round| logged(round + 1, project, laptop, typed(&writer, 2, &block)))
            .collect();
        let started = std::time::Instant::now();
        let built = replay(project, &base, &entries, &HashMap::new()).expect("a snapshot");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "replaying took {:?}",
            started.elapsed()
        );
        let loaded = LoroDoc::new();
        loaded.import(&built).unwrap();
        assert_eq!(
            loaded.get_text("text").to_string(),
            writer.get_text("text").to_string()
        );
    }

    #[test]
    fn a_stored_change_that_repeats_another_devices_operations_never_reaches_a_snapshot() {
        let project = SharedProjectId::new_v7();
        let (alice, bob, mallory) = (DeviceId::new_v7(), DeviceId::new_v7(), DeviceId::new_v7());
        let base_doc = LoroDoc::new();
        base_doc.set_peer_id(1).unwrap();
        base_doc.get_text("text").insert(0, "Hello").unwrap();
        base_doc.commit();
        let base = base_doc.export(ExportMode::Snapshot).unwrap();
        let written = |peer: u64, text: &str| {
            let doc = LoroDoc::new();
            doc.import(&base).unwrap();
            typed(&doc, peer, text)
        };
        let from_bob = written(20, " Bob");
        let from_alice = written(10, " holds.");
        let forged = {
            let doc = LoroDoc::new();
            doc.import(&base).unwrap();
            let before = doc.oplog_vv();
            let text = doc.get_text("text");
            doc.set_peer_id(10).unwrap();
            text.insert(text.len_unicode(), " FAILS!").unwrap();
            doc.commit();
            doc.set_peer_id(30).unwrap();
            text.insert(0, ">").unwrap();
            doc.commit();
            doc.export(ExportMode::updates(&before)).unwrap()
        };
        let entries = vec![
            logged(1, project, bob, from_bob.clone()),
            logged(2, project, alice, from_alice.clone()),
            logged(3, project, mallory, forged),
        ];
        let bindings = HashMap::from([(1, alice), (10, alice), (20, bob), (30, mallory)]);
        let built = replay(project, &base, &entries, &bindings).expect("a snapshot");
        let loaded = LoroDoc::new();
        loaded.import(&built).unwrap();
        let expected = LoroDoc::new();
        expected.import(&base).unwrap();
        expected.import(&from_bob).unwrap();
        expected.import(&from_alice).unwrap();
        let text = loaded.get_text("text").to_string();
        assert_eq!(text, expected.get_text("text").to_string());
        assert!(text.contains("holds."), "{text}");
        assert!(!text.contains("FAILS"), "{text}");
    }

    #[test]
    fn a_replay_names_the_entries_whose_changes_it_could_not_take_in() {
        let project = SharedProjectId::new_v7();
        let laptop = DeviceId::new_v7();
        let base_doc = LoroDoc::new();
        base_doc.set_peer_id(1).unwrap();
        base_doc.get_text("text").insert(0, "Hello").unwrap();
        base_doc.commit();
        let base = base_doc.export(ExportMode::Snapshot).unwrap();
        let writer = LoroDoc::new();
        writer.import(&base).unwrap();
        let first = typed(&writer, 2, " one");
        typed(&writer, 3, " never stored");
        let after_the_gap = typed(&writer, 3, " builds on it");
        let entries = vec![
            logged(1, project, laptop, first),
            logged(2, project, laptop, after_the_gap),
        ];
        let mut whole = Replay::start(project, &base).unwrap();
        whole.apply(&entries[..1], &HashMap::new());
        assert_eq!(whole.left_out(), None);
        let mut gapped = Replay::start(project, &base).unwrap();
        gapped.apply(&entries, &HashMap::new());
        assert_eq!(gapped.left_out(), Some((2, 2)));
    }

    #[test]
    fn a_built_snapshot_leaves_out_what_a_checking_copy_would_refuse() {
        let project = SharedProjectId::new_v7();
        let (laptop, thief) = (DeviceId::new_v7(), DeviceId::new_v7());
        let base_doc = LoroDoc::new();
        base_doc.set_peer_id(1).unwrap();
        base_doc.get_text("text").insert(0, "Hello").unwrap();
        base_doc.commit();
        let base = base_doc.export(ExportMode::Snapshot).unwrap();
        let honest_doc = LoroDoc::new();
        honest_doc.import(&base).unwrap();
        let honest = typed(&honest_doc, 2, " world");
        let forged_doc = LoroDoc::new();
        forged_doc.import(&base).unwrap();
        forged_doc.import(&honest).unwrap();
        let forged = typed(&forged_doc, 2, " forged");
        let elsewhere = typed(&honest_doc, 3, " elsewhere");
        let entries = vec![
            logged(1, project, laptop, honest),
            logged(2, project, thief, forged),
            logged(3, SharedProjectId::new_v7(), laptop, elsewhere),
            LoggedUpdate {
                seq: 4,
                device: laptop,
                envelope: b"not an envelope".to_vec(),
            },
        ];
        let bindings = HashMap::from([(1, laptop), (2, laptop)]);
        let built = replay(project, &base, &entries, &bindings).expect("a snapshot");
        let loaded = LoroDoc::new();
        loaded.import(&built).unwrap();
        assert_eq!(loaded.get_text("text").to_string(), "Hello world");
        assert_eq!(
            replay(project, b"not a snapshot", &entries, &bindings),
            None
        );
    }
}
