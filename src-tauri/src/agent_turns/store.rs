use super::{TurnChangeKind, TurnSkipReason, TurnSkipped, TurnUnavailable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io::Read as _;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

const STORE_DIR: &str = "agent-turns";
const BLOBS: &str = "blobs";
const SNAPSHOTS: &str = "snapshots";
const INDEX: &str = "index.json";
const LOCK: &str = "lock";
const TEMP_PREFIX: &str = ".tmp-";
const ZSTD_LEVEL: i32 = 3;
const FILE_LOCK_WAIT: Duration = Duration::from_secs(2);
pub(super) const SNAPSHOT_VERSION: u32 = 1;

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

fn is_sha256(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

pub(super) fn store_dir(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    Ok(crate::paths::oleafly_root()?
        .join(STORE_DIR)
        .join(project_id))
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BeforeEntry {
    #[serde(default)]
    pub(super) size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) mtime: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) skip: Option<TurnSkipReason>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(super) build: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Side {
    pub(super) size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) mtime: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredChange {
    pub(super) index: u32,
    pub(super) path: String,
    pub(super) change: TurnChangeKind,
    #[serde(default)]
    pub(super) before: Option<Side>,
    #[serde(default)]
    pub(super) after: Option<Side>,
    #[serde(default)]
    pub(super) added: Option<u32>,
    #[serde(default)]
    pub(super) removed: Option<u32>,
    #[serde(default)]
    pub(super) also_edited_here: bool,
    #[serde(default)]
    pub(super) build: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinishRecord {
    #[serde(default)]
    pub(super) changes: Vec<StoredChange>,
    #[serde(default)]
    pub(super) skipped: Vec<TurnSkipped>,
    #[serde(default)]
    pub(super) overlapped: bool,
    #[serde(default)]
    pub(super) shown: u32,
    #[serde(default)]
    pub(super) created_dirs: BTreeSet<String>,
    #[serde(default)]
    pub(super) unavailable: Option<TurnUnavailable>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Snapshot {
    pub(super) version: u32,
    pub(super) id: String,
    #[serde(default)]
    pub(super) label: String,
    pub(super) created_ms: u64,
    pub(super) started_ns: i64,
    #[serde(default)]
    pub(super) before: BTreeMap<String, BeforeEntry>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub(super) folders: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) manifest_managed: Option<bool>,
    #[serde(default)]
    pub(super) finish: Option<FinishRecord>,
}

impl Snapshot {
    fn referenced(&self, into: &mut HashSet<String>) {
        into.extend(
            self.before
                .values()
                .filter_map(|entry| entry.sha256.clone()),
        );
        if let Some(finish) = &self.finish {
            for change in &finish.changes {
                for side in [&change.before, &change.after].into_iter().flatten() {
                    if let Some(sha) = &side.sha256 {
                        into.insert(sha.clone());
                    }
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct IndexEntry {
    pub(super) size: u64,
    pub(super) mtime: i64,
    pub(super) sha256: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Index {
    #[serde(default)]
    pub(super) files: BTreeMap<String, IndexEntry>,
}

impl Index {
    pub(super) fn lookup(&self, path: &str, size: u64, mtime: Option<i64>) -> Option<&str> {
        let entry = self.files.get(path)?;
        (Some(entry.mtime) == mtime && entry.size == size).then_some(entry.sha256.as_str())
    }
}

pub(super) struct Budget {
    used: Option<u64>,
    limit: u64,
}

impl Budget {
    pub(super) fn known(used: u64, limit: u64) -> Self {
        Self {
            used: Some(used),
            limit,
        }
    }

    pub(super) fn lazy(limit: u64) -> Self {
        Self { used: None, limit }
    }
}

struct Busy {
    projects: Mutex<HashSet<String>>,
    released: Condvar,
}

fn busy() -> &'static Busy {
    static BUSY: OnceLock<Busy> = OnceLock::new();
    BUSY.get_or_init(|| Busy {
        projects: Mutex::new(HashSet::new()),
        released: Condvar::new(),
    })
}

fn lock_busy() -> MutexGuard<'static, HashSet<String>> {
    busy()
        .projects
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

pub(super) struct StoreGuard {
    project_id: String,
    file: Option<std::fs::File>,
}

impl StoreGuard {
    pub(super) fn acquire(project_id: &str, deadline: Instant) -> Option<Self> {
        let mut projects = lock_busy();
        while projects.contains(project_id) {
            let remaining = deadline.checked_duration_since(Instant::now())?;
            if remaining.is_zero() {
                return None;
            }
            projects = busy()
                .released
                .wait_timeout(projects, remaining)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        projects.insert(project_id.to_owned());
        Some(Self {
            project_id: project_id.to_owned(),
            file: None,
        })
    }
}

impl Drop for StoreGuard {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            let _ = fs4::FileExt::unlock(&file);
        }
        lock_busy().remove(&self.project_id);
        busy().released.notify_all();
    }
}

pub(super) enum LockError {
    Busy,
    Failed(String),
}

pub(super) struct Store {
    dir: PathBuf,
    _guard: StoreGuard,
}

impl Store {
    pub(super) fn lock(
        project_id: &str,
        deadline: Instant,
        create: bool,
    ) -> Result<Option<Self>, LockError> {
        let dir = store_dir(project_id).map_err(LockError::Failed)?;
        let mut guard = StoreGuard::acquire(project_id, deadline).ok_or(LockError::Busy)?;
        if create {
            for folder in [dir.join(BLOBS), dir.join(SNAPSHOTS)] {
                std::fs::create_dir_all(&folder).map_err(|error| {
                    LockError::Failed(format!("could not create the turn store: {error}"))
                })?;
            }
        }
        match std::fs::symlink_metadata(&dir) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err(LockError::Failed(
                    "the turn store is not a real folder".into(),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(LockError::Failed(format!(
                    "could not open the turn store: {error}"
                )))
            }
        }
        if let Ok(file) = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(LOCK))
        {
            if oleafly_core::locking::lock_file(&file, true, FILE_LOCK_WAIT).is_ok() {
                guard.file = Some(file);
            }
        }
        Ok(Some(Self { dir, _guard: guard }))
    }

    fn blob_path(&self, sha: &str) -> PathBuf {
        self.dir.join(BLOBS).join(&sha[..2]).join(sha)
    }

    pub(super) fn has_blob(&self, sha: &str) -> bool {
        is_sha256(sha) && self.blob_path(sha).is_file()
    }

    pub(super) fn put_blob(
        &self,
        sha: &str,
        bytes: &[u8],
        budget: &mut Budget,
    ) -> Result<bool, String> {
        if !is_sha256(sha) {
            return Err("invalid content hash".into());
        }
        if self.has_blob(sha) {
            return Ok(true);
        }
        let compressed = zstd::stream::encode_all(bytes, ZSTD_LEVEL)
            .map_err(|error| format!("could not compress a file: {error}"))?;
        let used = match budget.used {
            Some(used) => used,
            None => self.blob_bytes(),
        };
        let next = used.saturating_add(compressed.len() as u64);
        if next > budget.limit {
            budget.used = Some(used);
            return Ok(false);
        }
        let target = self.blob_path(sha);
        let folder = target.parent().expect("blob paths have a parent");
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("could not create a blob folder: {error}"))?;
        let temporary = folder.join(format!(
            "{TEMP_PREFIX}{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::write(&temporary, &compressed)
            .map_err(|error| format!("could not keep a file: {error}"))?;
        if let Err(error) = std::fs::rename(&temporary, &target) {
            let _ = std::fs::remove_file(&temporary);
            if !target.is_file() {
                return Err(format!("could not keep a file: {error}"));
            }
        }
        budget.used = Some(next);
        Ok(true)
    }

    pub(super) fn read_blob(&self, sha: &str, size: u64) -> Option<Vec<u8>> {
        if !is_sha256(sha) {
            return None;
        }
        let path = self.blob_path(sha);
        let file = std::fs::File::open(&path).ok()?;
        let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
        let decoded = zstd::stream::read::Decoder::new(file)
            .and_then(|decoder| decoder.take(size.saturating_add(1)).read_to_end(&mut bytes));
        if decoded.is_ok() && bytes.len() as u64 == size && sha256_hex(&bytes) == sha {
            return Some(bytes);
        }
        let _ = std::fs::remove_file(&path);
        None
    }

    fn blob_bytes(&self) -> u64 {
        let mut total = 0;
        let Ok(folders) = std::fs::read_dir(self.dir.join(BLOBS)) else {
            return 0;
        };
        for folder in folders.flatten() {
            let Ok(blobs) = std::fs::read_dir(folder.path()) else {
                continue;
            };
            for blob in blobs.flatten() {
                if let Ok(metadata) = blob.metadata() {
                    total += metadata.len();
                }
            }
        }
        total
    }

    fn snapshot_path(&self, id: &str) -> PathBuf {
        self.dir.join(SNAPSHOTS).join(format!("{id}.json"))
    }

    pub(super) fn load_snapshot(&self, id: &str) -> Option<Snapshot> {
        let bytes = std::fs::read(self.snapshot_path(id)).ok()?;
        serde_json::from_slice::<Snapshot>(&bytes)
            .ok()
            .filter(|snapshot| snapshot.id == id)
    }

    pub(super) fn remove_snapshot(&self, id: &str) {
        let _ = std::fs::remove_file(self.snapshot_path(id));
    }

    pub(super) fn save_snapshot(&self, snapshot: &Snapshot) -> Result<(), String> {
        let bytes = serde_json::to_vec(snapshot)
            .map_err(|error| format!("could not encode a turn: {error}"))?;
        crate::sandbox::atomic_write(&self.snapshot_path(&snapshot.id), &bytes)
    }

    pub(super) fn load_index(&self) -> Index {
        std::fs::read(self.dir.join(INDEX))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub(super) fn save_index(&self, index: &Index) -> Result<(), String> {
        let bytes = serde_json::to_vec(index)
            .map_err(|error| format!("could not encode the file index: {error}"))?;
        crate::sandbox::atomic_write(&self.dir.join(INDEX), &bytes)
    }

    pub(super) fn retain(
        &self,
        keep_newest: usize,
        keep_age_ms: u64,
        now_ms: u64,
        protect: &BTreeSet<String>,
    ) -> u64 {
        let mut snapshots = Vec::new();
        if let Ok(entries) = std::fs::read_dir(self.dir.join(SNAPSHOTS)) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let Some(name) = name.to_str() else { continue };
                match name
                    .strip_suffix(".json")
                    .filter(|id| super::valid_snapshot_id(id))
                {
                    Some(id) => snapshots.push((created_ms(id), id.to_owned())),
                    None if name.starts_with('.') => {
                        let _ = std::fs::remove_file(entry.path());
                    }
                    None => {}
                }
            }
        }
        snapshots.sort_by(|left, right| right.cmp(left));
        let mut referenced = HashSet::new();
        let mut references_known = true;
        for (rank, (created, id)) in snapshots.iter().enumerate() {
            let keep = rank < keep_newest
                || now_ms.saturating_sub(*created) < keep_age_ms
                || protect.contains(id);
            if !keep {
                self.remove_snapshot(id);
                continue;
            }
            match self.load_snapshot(id) {
                Some(snapshot) => snapshot.referenced(&mut referenced),
                None => references_known = false,
            }
        }
        referenced.extend(
            self.load_index()
                .files
                .into_values()
                .map(|entry| entry.sha256),
        );
        let mut total = 0;
        let Ok(folders) = std::fs::read_dir(self.dir.join(BLOBS)) else {
            return 0;
        };
        for folder in folders.flatten() {
            let Ok(blobs) = std::fs::read_dir(folder.path()) else {
                continue;
            };
            let mut empty = true;
            for blob in blobs.flatten() {
                let name = blob.file_name();
                let keep = !references_known
                    || name
                        .to_str()
                        .is_some_and(|name| is_sha256(name) && referenced.contains(name));
                if keep {
                    empty = false;
                    total += blob.metadata().map(|metadata| metadata.len()).unwrap_or(0);
                } else {
                    let _ = std::fs::remove_file(blob.path());
                }
            }
            if empty {
                let _ = std::fs::remove_dir(folder.path());
            }
        }
        total
    }
}

fn created_ms(id: &str) -> u64 {
    id.split('-')
        .next()
        .and_then(|prefix| prefix.parse().ok())
        .unwrap_or(0)
}

pub(super) fn new_snapshot_id(now_ms: u64) -> String {
    format!("{now_ms:013}-{:08x}", rand::random::<u32>())
}

pub(super) fn skipped_entry(reason: TurnSkipReason, size: u64, mtime: Option<i64>) -> BeforeEntry {
    BeforeEntry {
        size,
        mtime,
        skip: Some(reason),
        ..BeforeEntry::default()
    }
}
