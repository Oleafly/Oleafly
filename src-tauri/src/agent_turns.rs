//! Before-turn copies of a project so the changes an agent or the assistant
//! made in one turn can be reviewed and undone file by file.
//!
//! `begin` records every project file (size, time and, for files Oleafly can
//! keep, the content in a compressed content-addressed store outside the
//! project). `finish` walks the project again and lists what the turn added,
//! changed or deleted. Undo and Redo write one side back only when the disk
//! still holds the other side, so later edits are never overwritten.
//!
//! TeX build output is compared by size and time only and is never undone.

mod lines;
mod store;
mod walk;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use store::{
    BeforeEntry, Budget, FinishRecord, Index, IndexEntry, LockError, Side, Snapshot, Store,
    StoredChange,
};
use walk::{Entry, FileStat, WalkStop};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnUnavailable {
    TooLarge,
    TooManyFiles,
    Timeout,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnSkipReason {
    TooLarge,
    Symlink,
    Unreadable,
    CloudPlaceholder,
    StoreFull,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSkipped {
    pub path: String,
    pub reason: TurnSkipReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChange {
    pub index: u32,
    pub path: String,
    pub change: TurnChangeKind,
    pub before_size: Option<u64>,
    pub after_size: Option<u64>,
    /// Lines added, when both sides are UTF-8 text of at most 2 MiB.
    pub added: Option<u32>,
    /// Lines removed, when both sides are UTF-8 text of at most 2 MiB.
    pub removed: Option<u32>,
    /// Oleafly's own write path also saved this file during the turn.
    pub also_edited_here: bool,
    /// A build output file (see `build_hygiene::is_build_artifact`).
    pub build: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnChanges {
    pub snapshot_id: Option<String>,
    pub files: Vec<TurnChange>,
    pub more_files: u32,
    pub skipped: Vec<TurnSkipped>,
    /// Another turn in the same project was open during this one.
    pub overlapped: bool,
    pub unavailable: Option<TurnUnavailable>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnBegin {
    pub snapshot_id: Option<String>,
    pub unavailable: Option<TurnUnavailable>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnFileState {
    Applied,
    Undone,
    Edited,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFileStatus {
    pub index: u32,
    pub state: TurnFileState,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStatus {
    pub expired: bool,
    pub files: Vec<TurnFileStatus>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFilePreview {
    pub index: u32,
    pub path: String,
    pub change: TurnChangeKind,
    pub before: Option<String>,
    pub after: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub state: TurnFileState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnRevertSkipReason {
    Edited,
    Expired,
    WriteFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRevertSkipped {
    pub index: u32,
    pub reason: TurnRevertSkipReason,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRevertResult {
    pub reverted: Vec<u32>,
    pub skipped: Vec<TurnRevertSkipped>,
    pub project_state: crate::project::ProjectStateChanged,
}

// ---------------------------------------------------------------------------
// Limits

const MIB: u64 = 1024 * 1024;
/// Stat matches this close to the moment a file was hashed are not trusted:
/// some file systems keep modification times in whole seconds.
const RACY_NS: i64 = 3_000_000_000;
/// How long preview, status and undo wait for a busy store.
const STORE_WAIT: Duration = Duration::from_secs(30);
/// Longest text shown in a preview, per side.
const PREVIEW_CHARS: usize = 400_000;
/// Skipped files carried in one finish payload.
const MAX_PAYLOAD_SKIPPED: usize = 100;
/// Open turns older than this were abandoned (the app never finished them).
const ABANDONED_TURN: Duration = Duration::from_secs(24 * 60 * 60);
const EXPIRED: &str = "Undo is no longer available for this turn.";
const NOT_IN_TURN: &str = "This file is not part of the turn.";
const STORE_BUSY: &str = "Oleafly is still saving another turn. Try again in a moment.";

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub(crate) max_files: usize,
    pub(crate) max_file_bytes: u64,
    pub(crate) max_total_bytes: u64,
    pub(crate) budget: Duration,
    pub(crate) store_bytes: u64,
    pub(crate) keep_newest: usize,
    pub(crate) keep_age: Duration,
    pub(crate) max_payload_files: usize,
    pub(crate) max_payload_bytes: usize,
}

impl Limits {
    pub(crate) const DEFAULT: Self = Self {
        max_files: 20_000,
        max_file_bytes: 25 * MIB,
        max_total_bytes: 512 * MIB,
        budget: Duration::from_secs(5),
        store_bytes: 1024 * MIB,
        keep_newest: 100,
        keep_age: Duration::from_secs(14 * 24 * 60 * 60),
        max_payload_files: 500,
        max_payload_bytes: 128 * 1024,
    };
}

impl From<WalkStop> for TurnUnavailable {
    fn from(stop: WalkStop) -> Self {
        match stop {
            WalkStop::TooManyFiles => Self::TooManyFiles,
            WalkStop::Timeout => Self::Timeout,
            WalkStop::RootUnreadable => Self::Error,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_nanos()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn log(message: String) {
    let _ = crate::project::append_app_log(message);
}

pub(crate) fn valid_snapshot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte.is_ascii_lowercase() || byte == b'-')
}

/// Project-relative path in the walk's form (`/`-separated, no `.` parts).
fn normalize_relative(path: &str) -> String {
    let path = if cfg!(windows) {
        path.replace('\\', "/")
    } else {
        path.to_owned()
    };
    path.split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn ancestors(path: &str) -> impl Iterator<Item = &str> {
    std::iter::successors(path.rsplit_once('/').map(|(parent, _)| parent), |parent| {
        parent.rsplit_once('/').map(|(parent, _)| parent)
    })
}

// ---------------------------------------------------------------------------
// Open turns

struct OpenTurn {
    snapshot_id: String,
    opened: Instant,
    app_writes: BTreeSet<String>,
    overlapped: bool,
}

static OPEN_TURNS: Mutex<BTreeMap<String, Vec<OpenTurn>>> = Mutex::new(BTreeMap::new());

fn open_turns() -> MutexGuard<'static, BTreeMap<String, Vec<OpenTurn>>> {
    OPEN_TURNS.lock().unwrap_or_else(PoisonError::into_inner)
}

fn open_turn(project_id: &str, snapshot_id: &str) {
    let mut open = open_turns();
    let turns = open.entry(project_id.to_owned()).or_default();
    turns.retain(|turn| turn.opened.elapsed() < ABANDONED_TURN);
    let overlapped = !turns.is_empty();
    for turn in turns.iter_mut() {
        turn.overlapped = true;
    }
    turns.push(OpenTurn {
        snapshot_id: snapshot_id.to_owned(),
        opened: Instant::now(),
        app_writes: BTreeSet::new(),
        overlapped,
    });
}

/// Closes an open turn: the paths Oleafly wrote during it and whether another
/// turn overlapped it.
fn close_turn(project_id: &str, snapshot_id: &str) -> Option<(BTreeSet<String>, bool)> {
    let mut open = open_turns();
    let turns = open.get_mut(project_id)?;
    let position = turns
        .iter()
        .position(|turn| turn.snapshot_id == snapshot_id)?;
    let turn = turns.remove(position);
    if turns.is_empty() {
        open.remove(project_id);
    }
    Some((turn.app_writes, turn.overlapped))
}

/// Lets the caller of [`begin_for`] give up on a copy still being taken on
/// another thread. The turn is registered as open only while its caller still
/// waits: once the caller gives up, a copy that has not registered never does
/// and one that has is closed again, so an abandoned copy can never mark
/// later turns as overlapped.
#[derive(Default)]
pub(crate) struct BeginTicket {
    state: Mutex<TicketState>,
}

#[derive(Default)]
enum TicketState {
    #[default]
    Waiting,
    Opened {
        project_id: String,
        snapshot_id: String,
    },
    Abandoned,
}

impl BeginTicket {
    fn state(&self) -> MutexGuard<'_, TicketState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers the turn unless the caller has given up.
    fn open(&self, project_id: &str, snapshot_id: &str) -> bool {
        let mut state = self.state();
        if matches!(*state, TicketState::Abandoned) {
            return false;
        }
        open_turn(project_id, snapshot_id);
        *state = TicketState::Opened {
            project_id: project_id.to_owned(),
            snapshot_id: snapshot_id.to_owned(),
        };
        true
    }

    /// The caller stopped waiting for the copy. Never blocks on the disk.
    pub(crate) fn abandon(&self) {
        let mut state = self.state();
        if let TicketState::Opened {
            project_id,
            snapshot_id,
        } = std::mem::replace(&mut *state, TicketState::Abandoned)
        {
            close_turn(&project_id, &snapshot_id);
        }
    }
}

fn open_snapshot_ids(project_id: &str) -> BTreeSet<String> {
    open_turns()
        .get(project_id)
        .map(|turns| turns.iter().map(|turn| turn.snapshot_id.clone()).collect())
        .unwrap_or_default()
}

/// Records that Oleafly's own write path saved `relative_path` so open turns
/// can flag it as also edited by the user.
pub(crate) fn note_app_write(project_id: &str, relative_path: &str) {
    let mut open = open_turns();
    let Some(turns) = open.get_mut(project_id) else {
        return;
    };
    let path = normalize_relative(relative_path);
    if path.is_empty() {
        return;
    }
    for turn in turns.iter_mut() {
        turn.app_writes.insert(path.clone());
    }
}

// ---------------------------------------------------------------------------
// Shared helpers

fn worktree_shared(
    project_id: &str,
    deadline: Instant,
) -> Result<crate::worktree_lock::ProjectWorktreeLock, TurnUnavailable> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    crate::worktree_lock::ProjectWorktreeLock::shared_bounded(project_id, remaining).map_err(
        |error| {
            if Instant::now() >= deadline {
                TurnUnavailable::Timeout
            } else {
                log(format!("Could not read a project for Undo: {error}"));
                TurnUnavailable::Error
            }
        },
    )
}

fn lock_store_for_turn(
    project_id: &str,
    deadline: Instant,
    create: bool,
) -> Result<Option<Store>, TurnUnavailable> {
    Store::lock(project_id, deadline, create).map_err(|error| match error {
        LockError::Busy => TurnUnavailable::Timeout,
        LockError::Failed(error) => {
            log(format!("Could not open the Undo store: {error}"));
            TurnUnavailable::Error
        }
    })
}

fn lock_store(project_id: &str) -> Result<Option<Store>, String> {
    Store::lock(project_id, Instant::now() + STORE_WAIT, false).map_err(|error| match error {
        LockError::Busy => STORE_BUSY.to_owned(),
        LockError::Failed(error) => error,
    })
}

/// Reads a whole file, refusing anything over `limit` bytes.
fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, TurnSkipReason> {
    use std::io::Read as _;
    let file = std::fs::File::open(path).map_err(|_| TurnSkipReason::Unreadable)?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| TurnSkipReason::Unreadable)?;
    if bytes.len() as u64 > limit {
        return Err(TurnSkipReason::TooLarge);
    }
    Ok(bytes)
}

fn same_stat(size: u64, mtime: Option<i64>, stat: &FileStat) -> bool {
    size == stat.size && mtime.is_some() && mtime == stat.mtime
}

fn is_manifest_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(crate::project_location::MANIFEST_FILE)
}

/// Whether the root `project.json` is Oleafly's own manifest right now.
fn manifest_is_managed(location: &crate::project_location::ProjectLocation) -> bool {
    crate::project_manifest::location_root_file_is_managed(
        location,
        crate::project_location::MANIFEST_FILE,
    )
}

// ---------------------------------------------------------------------------
// begin

/// Takes the before-turn copy. Never fails the caller's turn: problems come
/// back as `unavailable`.
pub(crate) fn begin(project_id: &str, label: &str) -> TurnBegin {
    begin_for(project_id, label, &BeginTicket::default())
}

/// [`begin`] for a caller that may stop waiting; see [`BeginTicket`].
pub(crate) fn begin_for(project_id: &str, label: &str, ticket: &BeginTicket) -> TurnBegin {
    turn_begin(take_before(
        project_id,
        label,
        &Limits::DEFAULT,
        now_ms(),
        ticket,
    ))
}

#[cfg(test)]
pub(crate) fn begin_with(project_id: &str, label: &str, limits: &Limits, now_ms: u64) -> TurnBegin {
    turn_begin(take_before(
        project_id,
        label,
        limits,
        now_ms,
        &BeginTicket::default(),
    ))
}

fn turn_begin(taken: Result<String, TurnUnavailable>) -> TurnBegin {
    match taken {
        Ok(snapshot_id) => TurnBegin {
            snapshot_id: Some(snapshot_id),
            unavailable: None,
        },
        Err(unavailable) => TurnBegin {
            snapshot_id: None,
            unavailable: Some(unavailable),
        },
    }
}

fn take_before(
    project_id: &str,
    label: &str,
    limits: &Limits,
    now_ms: u64,
    ticket: &BeginTicket,
) -> Result<String, TurnUnavailable> {
    let deadline = Instant::now() + limits.budget;
    let location = crate::project_location::locate(project_id).map_err(|error| {
        log(format!(
            "Could not find a project for Undo: {}",
            String::from(error)
        ));
        TurnUnavailable::Error
    })?;
    let _worktree = worktree_shared(project_id, deadline)?;
    let store = lock_store_for_turn(project_id, deadline, true)?.ok_or(TurnUnavailable::Error)?;
    let keep_age_ms = u64::try_from(limits.keep_age.as_millis()).unwrap_or(u64::MAX);
    let used = store.retain(
        limits.keep_newest,
        keep_age_ms,
        now_ms,
        &open_snapshot_ids(project_id),
    );
    let started_ns = now_ns();
    let manifest_managed = manifest_is_managed(&location);
    let managed = |name: &str| manifest_managed && is_manifest_name(name);
    let walk::Walked { tree, folders } =
        walk::walk(&location.root, &managed, limits.max_files, deadline)?;
    let has_file = |path: &str| matches!(tree.get(path), Some(Entry::File(_)));

    let mut before = BTreeMap::new();
    let mut to_keep = Vec::new();
    let mut total = 0_u64;
    for (path, entry) in &tree {
        let stat = match entry {
            Entry::Symlink => {
                before.insert(
                    path.clone(),
                    store::skipped_entry(TurnSkipReason::Symlink, 0, None),
                );
                continue;
            }
            Entry::Unreadable => {
                before.insert(
                    path.clone(),
                    store::skipped_entry(TurnSkipReason::Unreadable, 0, None),
                );
                continue;
            }
            Entry::File(stat) => stat,
        };
        let skip = if crate::build_hygiene::is_build_artifact(path, has_file) {
            before.insert(
                path.clone(),
                BeforeEntry {
                    size: stat.size,
                    mtime: stat.mtime,
                    build: true,
                    ..BeforeEntry::default()
                },
            );
            continue;
        } else if stat.placeholder {
            TurnSkipReason::CloudPlaceholder
        } else if stat.size > limits.max_file_bytes {
            TurnSkipReason::TooLarge
        } else {
            total = total.saturating_add(stat.size);
            to_keep.push((path.clone(), *stat));
            continue;
        };
        before.insert(
            path.clone(),
            store::skipped_entry(skip, stat.size, stat.mtime),
        );
    }
    if total > limits.max_total_bytes {
        return Err(TurnUnavailable::TooLarge);
    }

    // The cache is rebuilt from this walk, so entries for old content do not
    // keep its blobs alive.
    let cache = store.load_index();
    let mut index = Index::default();
    let mut budget = Budget::known(used, limits.store_bytes);
    let trusted_before = started_ns.saturating_sub(RACY_NS);
    for (path, stat) in to_keep {
        if Instant::now() >= deadline {
            // Keep what was hashed so the next turn gets further.
            for (path, entry) in cache.files {
                index.files.entry(path).or_insert(entry);
            }
            let _ = store.save_index(&index);
            return Err(TurnUnavailable::Timeout);
        }
        let cached = cache
            .lookup(&path, stat.size, stat.mtime)
            .filter(|sha| store.has_blob(sha))
            .map(str::to_owned);
        let (sha, size) = match cached {
            Some(sha) => {
                if let Some(entry) = cache.files.get(&path) {
                    index.files.insert(path.clone(), entry.clone());
                }
                (sha, stat.size)
            }
            None => {
                let bytes = match read_limited(&location.root.join(&path), limits.max_file_bytes) {
                    Ok(bytes) => bytes,
                    Err(reason) => {
                        before.insert(path, store::skipped_entry(reason, stat.size, stat.mtime));
                        continue;
                    }
                };
                let sha = store::sha256_hex(&bytes);
                match store.put_blob(&sha, &bytes, &mut budget) {
                    Ok(true) => {}
                    Ok(false) => {
                        before.insert(
                            path,
                            store::skipped_entry(TurnSkipReason::StoreFull, stat.size, stat.mtime),
                        );
                        continue;
                    }
                    Err(error) => {
                        log(format!("Could not keep a file for Undo: {error}"));
                        before.insert(
                            path,
                            store::skipped_entry(TurnSkipReason::StoreFull, stat.size, stat.mtime),
                        );
                        continue;
                    }
                }
                if let Some(mtime) = stat.mtime.filter(|mtime| *mtime < trusted_before) {
                    index.files.insert(
                        path.clone(),
                        IndexEntry {
                            size: bytes.len() as u64,
                            mtime,
                            sha256: sha.clone(),
                        },
                    );
                }
                (sha, bytes.len() as u64)
            }
        };
        before.insert(
            path,
            BeforeEntry {
                size,
                mtime: stat.mtime,
                sha256: Some(sha),
                ..BeforeEntry::default()
            },
        );
    }
    if let Err(error) = store.save_index(&index) {
        log(format!("Could not save the Undo file index: {error}"));
    }
    let snapshot = Snapshot {
        version: store::SNAPSHOT_VERSION,
        id: store::new_snapshot_id(now_ms),
        label: label.chars().take(200).collect(),
        created_ms: now_ms,
        started_ns,
        before,
        folders,
        manifest_managed: Some(manifest_managed),
        finish: None,
    };
    store.save_snapshot(&snapshot).map_err(|error| {
        log(format!("Could not save a turn for Undo: {error}"));
        TurnUnavailable::Error
    })?;
    // Registered while the worktree is still read-locked, so no save can land
    // between the copy and the registration unnoticed.
    if !ticket.open(project_id, &snapshot.id) {
        // Nobody waits for this copy any more; the turn runs without Undo.
        store.remove_snapshot(&snapshot.id);
        return Err(TurnUnavailable::Timeout);
    }
    Ok(snapshot.id)
}

// ---------------------------------------------------------------------------
// finish

/// Compares the project with the before-turn copy.
pub(crate) fn finish(
    project_id: &str,
    snapshot_id: &str,
    tool_paths: Option<&[String]>,
) -> TurnChanges {
    finish_with(project_id, snapshot_id, tool_paths, &Limits::DEFAULT)
}

pub(crate) fn finish_with(
    project_id: &str,
    snapshot_id: &str,
    tool_paths: Option<&[String]>,
    limits: &Limits,
) -> TurnChanges {
    let unavailable = |code| TurnChanges {
        snapshot_id: Some(snapshot_id.to_owned()),
        unavailable: Some(code),
        ..TurnChanges::default()
    };
    match compare_turn(project_id, snapshot_id, tool_paths, limits) {
        Ok(changes) => changes,
        Err(code) => {
            close_turn(project_id, snapshot_id);
            unavailable(code)
        }
    }
}

fn compare_turn(
    project_id: &str,
    snapshot_id: &str,
    tool_paths: Option<&[String]>,
    limits: &Limits,
) -> Result<TurnChanges, TurnUnavailable> {
    if !valid_snapshot_id(snapshot_id) {
        return Err(TurnUnavailable::Error);
    }
    let deadline = Instant::now() + limits.budget;
    let location = crate::project_location::locate(project_id).map_err(|error| {
        log(format!(
            "Could not find a project for Undo: {}",
            String::from(error)
        ));
        TurnUnavailable::Error
    })?;
    let _worktree = worktree_shared(project_id, deadline)?;
    // Closed only once saves are blocked, so every save during the turn is
    // either noted or part of the comparison below.
    let (app_writes, overlapped) = close_turn(project_id, snapshot_id).unwrap_or_default();
    let store = lock_store_for_turn(project_id, deadline, false)?.ok_or(TurnUnavailable::Error)?;
    let mut snapshot = store
        .load_snapshot(snapshot_id)
        .ok_or(TurnUnavailable::Error)?;
    if let Some(record) = &snapshot.finish {
        return Ok(payload(snapshot_id, record));
    }
    let tool_paths: BTreeSet<String> = tool_paths
        .unwrap_or_default()
        .iter()
        .map(|path| normalize_relative(path))
        .collect();
    let also_edited: BTreeSet<String> = app_writes.difference(&tool_paths).cloned().collect();
    let result = Comparison {
        store: &store,
        root: &location.root,
        snapshot: &snapshot,
        limits,
        deadline,
        finished_ns: now_ns(),
    }
    .run(&location, &also_edited, overlapped);
    let (record, index) = match result {
        Ok(done) => done,
        Err(code) => {
            snapshot.before.clear();
            snapshot.folders.clear();
            snapshot.finish = Some(FinishRecord {
                unavailable: Some(code),
                ..FinishRecord::default()
            });
            let _ = store.save_snapshot(&snapshot);
            return Err(code);
        }
    };
    if let Err(error) = store.save_index(&index) {
        log(format!("Could not save the Undo file index: {error}"));
    }
    let changes = payload(snapshot_id, &record);
    snapshot.before.clear();
    snapshot.folders.clear();
    snapshot.finish = Some(record);
    store.save_snapshot(&snapshot).map_err(|error| {
        log(format!("Could not save a turn for Undo: {error}"));
        TurnUnavailable::Error
    })?;
    Ok(changes)
}

struct Comparison<'a> {
    store: &'a Store,
    root: &'a Path,
    snapshot: &'a Snapshot,
    limits: &'a Limits,
    deadline: Instant,
    finished_ns: i64,
}

/// A change found by the comparison, with the bytes kept for line counts.
struct Found {
    change: StoredChange,
    before_bytes: Option<Vec<u8>>,
    after_bytes: Option<Vec<u8>>,
}

impl Comparison<'_> {
    fn run(
        &self,
        location: &crate::project_location::ProjectLocation,
        also_edited: &BTreeSet<String>,
        overlapped: bool,
    ) -> Result<(FinishRecord, Index), TurnUnavailable> {
        let before = &self.snapshot.before;
        let manifest_left_out = match self.snapshot.manifest_managed {
            // Left out of the copy, so it stays out even when the turn broke
            // it: listing it as added would let Undo delete it.
            Some(true) => true,
            // Kept in the copy and compared like any file. One that only
            // appeared during the turn as Oleafly's own manifest (saving the
            // settings to the folder writes it) is Oleafly's, as above.
            Some(false) => {
                !before.keys().any(|path| is_manifest_name(path)) && manifest_is_managed(location)
            }
            None => manifest_is_managed(location),
        };
        let managed = |name: &str| manifest_left_out && is_manifest_name(name);
        let tree = walk::walk(self.root, &managed, self.limits.max_files, self.deadline)?.tree;
        let unreadable_before: BTreeSet<&str> = before
            .iter()
            .filter(|(_, entry)| entry.skip == Some(TurnSkipReason::Unreadable))
            .map(|(path, _)| path.as_str())
            .collect();
        let unreadable_after: BTreeSet<&str> = tree
            .iter()
            .filter(|(_, entry)| matches!(entry, Entry::Unreadable))
            .map(|(path, _)| path.as_str())
            .collect();
        let has_file = |path: &str| {
            before.get(path).is_some_and(|entry| entry.skip.is_none())
                || matches!(tree.get(path), Some(Entry::File(_)))
        };
        let paths: BTreeSet<&String> = before.keys().chain(tree.keys()).collect();
        let mut index = Index::default();
        let mut budget = Budget::lazy(self.limits.store_bytes);
        let mut found = Vec::new();
        let mut skipped = Vec::new();
        let mut skip = |path: &str, reason| {
            skipped.push(TurnSkipped {
                path: path.to_owned(),
                reason,
            })
        };
        let trusted_after = self.finished_ns.saturating_sub(RACY_NS);
        let trusted_before = self.snapshot.started_ns.saturating_sub(RACY_NS);
        for path in paths {
            if Instant::now() >= self.deadline {
                return Err(TurnUnavailable::Timeout);
            }
            let old = before.get(path.as_str());
            let new = tree.get(path.as_str());
            // A file inside a folder that could not be read after the turn
            // may well still be there.
            if old.is_some()
                && new.is_none()
                && ancestors(path).any(|folder| unreadable_after.contains(folder))
            {
                skip(path, TurnSkipReason::Unreadable);
                continue;
            }
            let build = match old {
                Some(entry) => entry.build,
                None => {
                    matches!(new, Some(Entry::File(_)))
                        && crate::build_hygiene::is_build_artifact(path, has_file)
                }
            };
            if build {
                if let Some(change) = build_change(path, old, new) {
                    found.push(Found {
                        change,
                        before_bytes: None,
                        after_bytes: None,
                    });
                }
                continue;
            }
            let kept = old.and_then(|entry| entry.sha256.as_deref().map(|sha| (entry, sha)));
            match (old, kept, new) {
                (None, _, None) => {}
                // Before: not kept (skipped). Report it only if it changed.
                (Some(entry), None, new) => {
                    if !skipped_unchanged(entry, new) {
                        let reason = new
                            .and_then(|new| self.after_skip_reason(new))
                            .or(entry.skip)
                            .unwrap_or(TurnSkipReason::Unreadable);
                        skip(path, reason);
                    }
                }
                (Some(entry), Some((_, sha)), None) => found.push(Found {
                    before_bytes: self.counted_blob(sha, entry.size),
                    after_bytes: Some(Vec::new()),
                    change: stored_change(
                        path,
                        TurnChangeKind::Deleted,
                        Some(kept_side(entry, sha)),
                        None,
                    ),
                }),
                (Some(_), Some(_), Some(Entry::Symlink)) => skip(path, TurnSkipReason::Symlink),
                (Some(_), Some(_), Some(Entry::Unreadable)) => {
                    skip(path, TurnSkipReason::Unreadable)
                }
                (Some(entry), Some((_, sha)), Some(Entry::File(stat))) => {
                    let untouched = same_stat(entry.size, entry.mtime, stat)
                        && entry.mtime.is_some_and(|mtime| mtime < trusted_before);
                    if untouched {
                        remember(&mut index, path, stat, sha, trusted_after);
                        continue;
                    }
                    if stat.placeholder {
                        if !same_stat(entry.size, entry.mtime, stat) {
                            skip(path, TurnSkipReason::CloudPlaceholder);
                        }
                        continue;
                    }
                    let bytes = match self.read(path, stat) {
                        Ok(bytes) => bytes,
                        Err(reason) => {
                            skip(path, reason);
                            continue;
                        }
                    };
                    let after_sha = store::sha256_hex(&bytes);
                    if after_sha == sha {
                        remember(&mut index, path, stat, sha, trusted_after);
                        continue;
                    }
                    if let Err(reason) = self.keep(&after_sha, &bytes, &mut budget) {
                        skip(path, reason);
                        continue;
                    }
                    remember(&mut index, path, stat, &after_sha, trusted_after);
                    found.push(Found {
                        before_bytes: self.counted_blob(sha, entry.size),
                        change: stored_change(
                            path,
                            TurnChangeKind::Modified,
                            Some(kept_side(entry, sha)),
                            Some(Side {
                                size: bytes.len() as u64,
                                mtime: stat.mtime,
                                sha256: Some(after_sha),
                            }),
                        ),
                        after_bytes: Some(bytes),
                    });
                }
                (None, _, Some(Entry::Symlink)) => skip(path, TurnSkipReason::Symlink),
                (None, _, Some(Entry::Unreadable)) => skip(path, TurnSkipReason::Unreadable),
                (None, _, Some(Entry::File(stat))) => {
                    // A file inside a folder that could not be read before
                    // the turn may well have been there all along.
                    if ancestors(path).any(|folder| unreadable_before.contains(folder)) {
                        skip(path, TurnSkipReason::Unreadable);
                        continue;
                    }
                    if stat.placeholder {
                        skip(path, TurnSkipReason::CloudPlaceholder);
                        continue;
                    }
                    let bytes = match self.read(path, stat) {
                        Ok(bytes) => bytes,
                        Err(reason) => {
                            skip(path, reason);
                            continue;
                        }
                    };
                    let after_sha = store::sha256_hex(&bytes);
                    if let Err(reason) = self.keep(&after_sha, &bytes, &mut budget) {
                        skip(path, reason);
                        continue;
                    }
                    remember(&mut index, path, stat, &after_sha, trusted_after);
                    found.push(Found {
                        change: stored_change(
                            path,
                            TurnChangeKind::Added,
                            None,
                            Some(Side {
                                size: bytes.len() as u64,
                                mtime: stat.mtime,
                                sha256: Some(after_sha),
                            }),
                        ),
                        before_bytes: Some(Vec::new()),
                        after_bytes: Some(bytes),
                    });
                }
            }
        }
        let mut changes: Vec<StoredChange> = found
            .into_iter()
            .map(|found| {
                let mut change = found.change;
                if let (Some(old), Some(new)) = (&found.before_bytes, &found.after_bytes) {
                    if let Some((added, removed)) = lines::line_counts(old, new) {
                        change.added = Some(added);
                        change.removed = Some(removed);
                    }
                }
                change.also_edited_here = also_edited.contains(&change.path);
                change
            })
            .collect();
        changes.sort_by(|left, right| (left.build, &left.path).cmp(&(right.build, &right.path)));
        for (position, change) in changes.iter_mut().enumerate() {
            change.index = u32::try_from(position).unwrap_or(u32::MAX);
        }
        let before_dirs: BTreeSet<&str> = (self.snapshot.folders.iter().map(String::as_str))
            .chain(before.keys().flat_map(|path| ancestors(path)))
            .collect();
        let created_dirs = changes
            .iter()
            .filter(|change| change.change == TurnChangeKind::Added && !change.build)
            .flat_map(|change| ancestors(&change.path))
            .filter(|folder| !before_dirs.contains(folder))
            .map(str::to_owned)
            .collect();
        skipped.truncate(MAX_PAYLOAD_SKIPPED);
        let shown = shown_count(&changes, &skipped, self.limits);
        Ok((
            FinishRecord {
                changes,
                skipped,
                overlapped,
                shown,
                created_dirs,
                unavailable: None,
            },
            index,
        ))
    }

    fn read(&self, path: &str, stat: &FileStat) -> Result<Vec<u8>, TurnSkipReason> {
        if stat.size > self.limits.max_file_bytes {
            return Err(TurnSkipReason::TooLarge);
        }
        read_limited(&self.root.join(path), self.limits.max_file_bytes)
    }

    fn keep(&self, sha: &str, bytes: &[u8], budget: &mut Budget) -> Result<(), TurnSkipReason> {
        match self.store.put_blob(sha, bytes, budget) {
            Ok(true) => Ok(()),
            Ok(false) => Err(TurnSkipReason::StoreFull),
            Err(error) => {
                log(format!("Could not keep a file for Undo: {error}"));
                Err(TurnSkipReason::StoreFull)
            }
        }
    }

    /// Kept content small enough for line counts.
    fn counted_blob(&self, sha: &str, size: u64) -> Option<Vec<u8>> {
        (size <= lines::MAX_COUNTED_BYTES)
            .then(|| self.store.read_blob(sha, size))
            .flatten()
    }

    fn after_skip_reason(&self, entry: &Entry) -> Option<TurnSkipReason> {
        match entry {
            Entry::Symlink => Some(TurnSkipReason::Symlink),
            Entry::Unreadable => Some(TurnSkipReason::Unreadable),
            Entry::File(stat) if stat.placeholder => Some(TurnSkipReason::CloudPlaceholder),
            Entry::File(stat) if stat.size > self.limits.max_file_bytes => {
                Some(TurnSkipReason::TooLarge)
            }
            Entry::File(_) => None,
        }
    }
}

fn remember(index: &mut Index, path: &str, stat: &FileStat, sha: &str, trusted_before: i64) {
    if let Some(mtime) = stat.mtime.filter(|mtime| *mtime < trusted_before) {
        index.files.insert(
            path.to_owned(),
            IndexEntry {
                size: stat.size,
                mtime,
                sha256: sha.to_owned(),
            },
        );
    }
}

fn kept_side(entry: &BeforeEntry, sha: &str) -> Side {
    Side {
        size: entry.size,
        mtime: entry.mtime,
        sha256: Some(sha.to_owned()),
    }
}

fn stored_change(
    path: &str,
    change: TurnChangeKind,
    before: Option<Side>,
    after: Option<Side>,
) -> StoredChange {
    StoredChange {
        index: 0,
        path: path.to_owned(),
        change,
        before,
        after,
        added: None,
        removed: None,
        also_edited_here: false,
        build: false,
    }
}

/// Build output is compared by size and time only.
fn build_change(
    path: &str,
    old: Option<&BeforeEntry>,
    new: Option<&Entry>,
) -> Option<StoredChange> {
    let before = old.filter(|entry| entry.build).map(|entry| Side {
        size: entry.size,
        mtime: entry.mtime,
        sha256: None,
    });
    let after = match new {
        Some(Entry::File(stat)) => Some(Side {
            size: stat.size,
            mtime: stat.mtime,
            sha256: None,
        }),
        _ => None,
    };
    let kind = match (&before, &after) {
        (None, None) => return None,
        (Some(old), Some(new))
            if old.size == new.size && old.mtime.is_some() && old.mtime == new.mtime =>
        {
            return None
        }
        (Some(_), Some(_)) => TurnChangeKind::Modified,
        (None, Some(_)) => TurnChangeKind::Added,
        (Some(_), None) => TurnChangeKind::Deleted,
    };
    Some(StoredChange {
        build: true,
        ..stored_change(path, kind, before, after)
    })
}

/// Whether a file whose content was not kept looks the same after the turn.
fn skipped_unchanged(entry: &BeforeEntry, new: Option<&Entry>) -> bool {
    match (entry.skip, new) {
        (Some(TurnSkipReason::Symlink), Some(Entry::Symlink)) => true,
        (Some(TurnSkipReason::Unreadable), Some(Entry::Unreadable)) => true,
        (_, Some(Entry::File(stat))) => same_stat(entry.size, entry.mtime, stat),
        _ => false,
    }
}

fn to_turn_change(change: &StoredChange) -> TurnChange {
    TurnChange {
        index: change.index,
        path: change.path.clone(),
        change: change.change,
        before_size: change.before.as_ref().map(|side| side.size),
        after_size: change.after.as_ref().map(|side| side.size),
        added: change.added,
        removed: change.removed,
        also_edited_here: change.also_edited_here,
        build: change.build,
    }
}

fn json_len<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map_or(256, |bytes| bytes.len() + 1)
}

/// How many changes fit the payload caps.
fn shown_count(changes: &[StoredChange], skipped: &[TurnSkipped], limits: &Limits) -> u32 {
    let mut used = 256 + skipped.iter().map(json_len).sum::<usize>();
    let mut shown = 0_u32;
    for change in changes.iter().take(limits.max_payload_files) {
        used += json_len(&to_turn_change(change));
        if used > limits.max_payload_bytes {
            break;
        }
        shown += 1;
    }
    shown
}

fn payload(snapshot_id: &str, record: &FinishRecord) -> TurnChanges {
    let shown = (record.shown as usize).min(record.changes.len());
    TurnChanges {
        snapshot_id: Some(snapshot_id.to_owned()),
        files: record.changes[..shown].iter().map(to_turn_change).collect(),
        more_files: u32::try_from(record.changes.len() - shown).unwrap_or(u32::MAX),
        skipped: record.skipped.clone(),
        overlapped: record.overlapped,
        unavailable: record.unavailable,
    }
}

// ---------------------------------------------------------------------------
// status and preview

/// What is on disk now for one path.
#[derive(Debug, PartialEq, Eq)]
enum Disk {
    Absent,
    File {
        size: u64,
        mtime: Option<i64>,
    },
    /// No entry of this exact name, but a case-insensitive disk resolved it
    /// to one whose name differs only in letter case (after a case-only
    /// rename, the only copy of the file). Counts as no file of this name,
    /// and is never written over or removed under it.
    OtherName,
    Other,
}

fn disk_at(target: &Path, relative: &str) -> Disk {
    let metadata = match std::fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Disk::Absent,
        Err(_) => return Disk::Other,
    };
    if metadata.file_type().is_symlink() {
        Disk::Other
    } else if spelled_in_other_case(target, relative) {
        Disk::OtherName
    } else if metadata.is_file() {
        Disk::File {
            size: metadata.len(),
            mtime: walk::mtime_ns(&metadata),
        }
    } else {
        Disk::Other
    }
}

/// Whether a case-insensitive disk found `target` under a name that differs
/// from `relative` only in letter case (compared by its trailing path parts).
fn spelled_in_other_case(target: &Path, relative: &str) -> bool {
    let Ok(real) = std::fs::canonicalize(target) else {
        return false;
    };
    let found: Vec<_> = real.components().collect();
    let wanted: Vec<&str> = relative.split('/').collect();
    let Some(first) = found.len().checked_sub(wanted.len()) else {
        return false;
    };
    let mut other_case = false;
    for (found, wanted) in found[first..].iter().zip(&wanted) {
        let Some(found) = found.as_os_str().to_str() else {
            return false;
        };
        if found == *wanted {
            continue;
        }
        if found.to_lowercase() != wanted.to_lowercase() {
            return false;
        }
        other_case = true;
    }
    other_case
}

/// Whether `disk` holds `side` at `target` (`None` = no file of that name).
fn holds(disk: &Disk, target: &Path, relative: &str, side: Option<&Side>, index: &Index) -> bool {
    let Some(side) = side else {
        return matches!(disk, Disk::Absent | Disk::OtherName);
    };
    let Disk::File { size, mtime } = *disk else {
        return false;
    };
    if size != side.size {
        return false;
    }
    match &side.sha256 {
        Some(sha) => {
            if index.lookup(relative, size, mtime) == Some(sha.as_str()) {
                return true;
            }
            std::fs::read(target).is_ok_and(|bytes| store::sha256_hex(&bytes) == *sha)
        }
        // Build output: size and time only.
        None => side.mtime.is_some() && side.mtime == mtime,
    }
}

fn file_state(root: &Path, change: &StoredChange, index: &Index) -> TurnFileState {
    let Ok(target) = crate::sandbox::resolve_within(root, &change.path) else {
        return TurnFileState::Edited;
    };
    let disk = disk_at(&target, &change.path);
    if holds(&disk, &target, &change.path, change.after.as_ref(), index) {
        TurnFileState::Applied
    } else if !change.build && holds(&disk, &target, &change.path, change.before.as_ref(), index) {
        TurnFileState::Undone
    } else {
        TurnFileState::Edited
    }
}

fn finished_record(store: &Store, snapshot_id: &str) -> Option<FinishRecord> {
    store
        .load_snapshot(snapshot_id)?
        .finish
        .filter(|record| record.unavailable.is_none())
}

/// Each shown file's state, from disk hashes; nothing is saved.
pub(crate) fn status(project_id: &str, snapshot_id: &str) -> Result<TurnStatus, String> {
    let expired = TurnStatus {
        expired: true,
        files: Vec::new(),
    };
    if !valid_snapshot_id(snapshot_id) {
        return Ok(expired);
    }
    // The store is only held while reading it, never while hashing the
    // project's files.
    let (record, index) = {
        let Some(store) = lock_store(project_id)? else {
            return Ok(expired);
        };
        let Some(snapshot) = store.load_snapshot(snapshot_id) else {
            return Ok(expired);
        };
        let Some(record) = snapshot
            .finish
            .filter(|record| record.unavailable.is_none())
        else {
            return Ok(TurnStatus::default());
        };
        (record, store.load_index())
    };
    let root = crate::paths::project_dir(project_id)?;
    let files = record
        .changes
        .iter()
        .take(record.shown as usize)
        .map(|change| TurnFileStatus {
            index: change.index,
            state: file_state(&root, change, &index),
        })
        .collect();
    Ok(TurnStatus {
        expired: false,
        files,
    })
}

fn preview_text(bytes: Option<Vec<u8>>) -> Result<Option<String>, ()> {
    match bytes {
        None => Ok(None),
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) if !text.contains('\0') => Ok(Some(text)),
            _ => Err(()),
        },
    }
}

/// Both sides of one change, as text when possible.
pub(crate) fn preview(
    project_id: &str,
    snapshot_id: &str,
    index: u32,
) -> Result<TurnFilePreview, String> {
    if !valid_snapshot_id(snapshot_id) {
        return Err(EXPIRED.into());
    }
    let read = |store: &Store, side: &Option<Side>| -> Result<Option<Vec<u8>>, String> {
        match side {
            None => Ok(None),
            Some(side) => {
                let sha = side.sha256.as_deref().ok_or(EXPIRED)?;
                store
                    .read_blob(sha, side.size)
                    .map(Some)
                    .ok_or_else(|| EXPIRED.to_owned())
            }
        }
    };
    let (change, before, after, index) = {
        let store = lock_store(project_id)?.ok_or(EXPIRED)?;
        let record = finished_record(&store, snapshot_id).ok_or(EXPIRED)?;
        let change = record
            .changes
            .into_iter()
            .nth(index as usize)
            .ok_or(NOT_IN_TURN)?;
        let (before, after) = if change.build {
            (None, None)
        } else {
            (read(&store, &change.before)?, read(&store, &change.after)?)
        };
        (change, before, after, store.load_index())
    };
    let root = crate::paths::project_dir(project_id)?;
    let state = file_state(&root, &change, &index);
    let mut preview = TurnFilePreview {
        index: change.index,
        path: change.path.clone(),
        change: change.change,
        before: None,
        after: None,
        binary: false,
        too_large: false,
        state,
    };
    if change.build {
        // Build output is not kept, so there is nothing to show.
        preview.binary = true;
        return Ok(preview);
    }
    match (preview_text(before), preview_text(after)) {
        (Ok(before), Ok(after)) => {
            let too_long = |text: &Option<String>| {
                text.as_ref().is_some_and(|text| {
                    text.len() > PREVIEW_CHARS && text.chars().count() > PREVIEW_CHARS
                })
            };
            if too_long(&before) || too_long(&after) {
                preview.too_large = true;
            } else {
                preview.before = before;
                preview.after = after;
            }
        }
        _ => preview.binary = true,
    }
    Ok(preview)
}

// ---------------------------------------------------------------------------
// Undo and Redo

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Direction {
    Undo,
    Redo,
}

struct Applied {
    reverted: Vec<u32>,
    skipped: Vec<TurnRevertSkipped>,
    changed: bool,
}

fn expired_for(indices: Option<&[u32]>) -> Applied {
    Applied {
        reverted: Vec::new(),
        skipped: indices
            .unwrap_or_default()
            .iter()
            .map(|index| TurnRevertSkipped {
                index: *index,
                reason: TurnRevertSkipReason::Expired,
            })
            .collect(),
        changed: false,
    }
}

/// Undoes or redoes files of a turn inside the project mutation transaction.
pub(crate) async fn apply_turn<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &crate::state::AppState,
    project_id: String,
    snapshot_id: String,
    indices: Option<Vec<u32>>,
    expected_generation: u64,
    direction: Direction,
) -> Result<TurnRevertResult, String> {
    let operation_project = project_id.clone();
    let mutation = crate::project::mutate_project_worktree(
        state,
        project_id.clone(),
        Some(expected_generation),
        move |root| {
            let applied = apply_changes(
                &operation_project,
                root,
                &snapshot_id,
                indices.as_deref(),
                direction,
            )?;
            let changed = applied.changed;
            Ok((applied, changed))
        },
    )
    .await?;
    let applied = mutation.value?;
    let reason = match direction {
        Direction::Undo => "agent-turn-revert",
        Direction::Redo => "agent-turn-redo",
    };
    let project_state = crate::project::publish_project_state_changed(
        app,
        state,
        &project_id,
        mutation.project,
        reason,
        !applied.reverted.is_empty(),
        Some(mutation.generation),
    )?;
    Ok(TurnRevertResult {
        reverted: applied.reverted,
        skipped: applied.skipped,
        project_state,
    })
}

fn apply_changes(
    project_id: &str,
    root: &Path,
    snapshot_id: &str,
    indices: Option<&[u32]>,
    direction: Direction,
) -> Result<Applied, String> {
    if !valid_snapshot_id(snapshot_id) {
        return Ok(expired_for(indices));
    }
    let Some(store) = lock_store(project_id)? else {
        return Ok(expired_for(indices));
    };
    let Some(record) = finished_record(&store, snapshot_id) else {
        return Ok(expired_for(indices));
    };
    let mut applied = Applied {
        reverted: Vec::new(),
        skipped: Vec::new(),
        changed: false,
    };
    let mut targets: Vec<&StoredChange> = Vec::new();
    match indices {
        None => targets.extend(
            record
                .changes
                .iter()
                .filter(|change| !change.build && !change.also_edited_here),
        ),
        Some(indices) => {
            let mut seen = BTreeSet::new();
            for index in indices.iter().filter(|index| seen.insert(**index)) {
                match record.changes.get(*index as usize) {
                    Some(change) if !change.build => targets.push(change),
                    _ => applied.skipped.push(TurnRevertSkipped {
                        index: *index,
                        reason: TurnRevertSkipReason::Expired,
                    }),
                }
            }
        }
    }
    // Removals first: on a case-insensitive disk a case-only rename must
    // lose its new name before the old one can come back.
    let removes_file = |change: &StoredChange| match direction {
        Direction::Undo => change.change == TurnChangeKind::Added,
        Direction::Redo => change.change == TurnChangeKind::Deleted,
    };
    let creates_file = |change: &StoredChange| match direction {
        Direction::Undo => change.change == TurnChangeKind::Deleted,
        Direction::Redo => change.change == TurnChangeKind::Added,
    };
    targets.sort_by_key(|change| {
        (
            !removes_file(change),
            creates_file(change),
            change.path.clone(),
        )
    });
    let index = store.load_index();
    for change in targets {
        let (from, to) = match direction {
            Direction::Undo => (change.after.as_ref(), change.before.as_ref()),
            Direction::Redo => (change.before.as_ref(), change.after.as_ref()),
        };
        let skip = |reason| TurnRevertSkipped {
            index: change.index,
            reason,
        };
        let Ok(target) = crate::sandbox::resolve_within(root, &change.path) else {
            applied.skipped.push(skip(TurnRevertSkipReason::Edited));
            continue;
        };
        let disk = disk_at(&target, &change.path);
        if holds(&disk, &target, &change.path, to, &index) {
            applied.reverted.push(change.index);
            continue;
        }
        // A name spelled in another case is a different file of the turn
        // (a case-only rename): writing here would overwrite it.
        if disk == Disk::OtherName || !holds(&disk, &target, &change.path, from, &index) {
            applied.skipped.push(skip(TurnRevertSkipReason::Edited));
            continue;
        }
        let outcome = match to {
            None => remove_file(&target).map(|()| {
                if direction == Direction::Undo {
                    prune_created_dirs(root, &change.path, &record.created_dirs);
                }
            }),
            Some(side) => {
                let Some(bytes) = side
                    .sha256
                    .as_deref()
                    .and_then(|sha| store.read_blob(sha, side.size))
                else {
                    applied.skipped.push(skip(TurnRevertSkipReason::Expired));
                    continue;
                };
                write_file(project_id, &target, &change.path, &bytes)
            }
        };
        match outcome {
            Ok(()) => {
                applied.changed = true;
                applied.reverted.push(change.index);
            }
            Err(error) => {
                log(format!("Could not undo a file change: {error}"));
                applied
                    .skipped
                    .push(skip(TurnRevertSkipReason::WriteFailed));
            }
        }
    }
    applied.reverted.sort_unstable();
    applied.skipped.sort_by_key(|skipped| skipped.index);
    Ok(applied)
}

fn write_file(project_id: &str, target: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let _writable = WritableWhileSaving::new(target);
    crate::project::write_project_bytes(project_id, target, relative, bytes).map(|_| ())
}

/// Windows refuses to replace a read-only file; clear the flag while the
/// file is written and put it back afterwards.
struct WritableWhileSaving<'a> {
    #[cfg_attr(not(windows), allow(dead_code))]
    target: &'a Path,
    #[cfg_attr(not(windows), allow(dead_code))]
    restore: bool,
}

impl<'a> WritableWhileSaving<'a> {
    #[cfg(windows)]
    fn new(target: &'a Path) -> Self {
        let restore = std::fs::symlink_metadata(target).is_ok_and(|metadata| {
            let mut permissions = metadata.permissions();
            if !metadata.is_file() || !permissions.readonly() {
                return false;
            }
            // NOSONAR: only the file Undo is restoring, only while it is
            // written; Drop sets the read-only flag again.
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false); // NOSONAR
            std::fs::set_permissions(target, permissions).is_ok()
        });
        Self { target, restore }
    }

    #[cfg(not(windows))]
    fn new(target: &'a Path) -> Self {
        Self {
            target,
            restore: false,
        }
    }
}

impl Drop for WritableWhileSaving<'_> {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.restore {
            if let Ok(metadata) = std::fs::metadata(self.target) {
                let mut permissions = metadata.permissions();
                permissions.set_readonly(true);
                let _ = std::fs::set_permissions(self.target, permissions);
            }
        }
    }
}

/// Deletes a file, retrying briefly while another program holds it open.
fn remove_file(target: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(if cfg!(windows) { 2 } else { 0 });
    let mut delay = Duration::from_millis(20);
    loop {
        match std::fs::remove_file(target) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if Instant::now() >= deadline => {
                return Err(format!("could not delete a file: {error}"))
            }
            Err(_) => {
                std::thread::sleep(delay);
                delay = (delay * 2).min(Duration::from_millis(250));
            }
        }
    }
}

/// Removes folders the turn created once Undo has emptied them.
fn prune_created_dirs(root: &Path, path: &str, created: &BTreeSet<String>) {
    for folder in ancestors(path) {
        if !created.contains(folder) || std::fs::remove_dir(root.join(folder)).is_err() {
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Project removal

/// Deletes every before-turn copy kept for a project.
pub(crate) fn remove_project(project_id: &str) {
    if let Err(error) = remove_project_store(project_id) {
        log(format!(
            "Could not remove the Undo data of a project: {error}"
        ));
    }
}

fn remove_project_store(project_id: &str) -> Result<(), String> {
    let dir = store::store_dir(project_id)?;
    open_turns().remove(project_id);
    let _guard =
        store::StoreGuard::acquire(project_id, Instant::now() + STORE_WAIT).ok_or(STORE_BUSY)?;
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Commands

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("turn task failed: {error}"))
}

#[tauri::command]
pub async fn agent_turn_begin(project_id: String, label: String) -> Result<TurnBegin, String> {
    blocking(move || begin(&project_id, &label)).await
}

#[tauri::command]
pub async fn agent_turn_finish(
    project_id: String,
    snapshot_id: String,
    tool_paths: Option<Vec<String>>,
) -> Result<TurnChanges, String> {
    blocking(move || finish(&project_id, &snapshot_id, tool_paths.as_deref())).await
}

#[tauri::command]
pub async fn agent_turn_status(
    project_id: String,
    snapshot_id: String,
) -> Result<TurnStatus, String> {
    blocking(move || status(&project_id, &snapshot_id)).await?
}

#[tauri::command]
pub async fn agent_turn_preview(
    project_id: String,
    snapshot_id: String,
    index: u32,
) -> Result<TurnFilePreview, String> {
    blocking(move || preview(&project_id, &snapshot_id, index)).await?
}

#[tauri::command]
pub async fn agent_turn_revert(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    snapshot_id: String,
    indices: Option<Vec<u32>>,
    expected_generation: u64,
) -> Result<TurnRevertResult, String> {
    apply_turn(
        &app,
        &state,
        project_id,
        snapshot_id,
        indices,
        expected_generation,
        Direction::Undo,
    )
    .await
}

#[tauri::command]
pub async fn agent_turn_redo(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    snapshot_id: String,
    indices: Option<Vec<u32>>,
    expected_generation: u64,
) -> Result<TurnRevertResult, String> {
    apply_turn(
        &app,
        &state,
        project_id,
        snapshot_id,
        indices,
        expected_generation,
        Direction::Redo,
    )
    .await
}
