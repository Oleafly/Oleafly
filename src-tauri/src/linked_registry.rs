use crate::fs_identity::{FsIdentity, VolumeKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{OnceLock, PoisonError, RwLock};
use std::time::SystemTime;

pub(crate) const LINK_FILE: &str = "link.json";
pub(crate) const LINK_VERSION: u32 = 1;
pub(crate) const LINKED_ID_PREFIX: &str = "linked-";
const MAX_LINK_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LinkRecord {
    pub(crate) version: u32,
    pub(crate) id: String,
    pub(crate) canonical_path: String,
    pub(crate) identity: FsIdentity,
    #[serde(default)]
    pub(crate) weak_identity: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    pub(crate) created_at: u64,
    pub(crate) last_opened_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) removed_at: Option<u64>,
    pub(crate) volume_kind: VolumeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) compile_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) displaced: Option<Displacement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reattach: Option<ReattachOffer>,
    #[serde(flatten)]
    pub(crate) extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Displacement {
    pub(crate) by: String,
    pub(crate) at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReattachReason {
    Replaced,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ReattachOffer {
    pub(crate) from_id: String,
    pub(crate) reason: ReattachReason,
    pub(crate) offered_at_ms: u64,
}

impl LinkRecord {
    pub(crate) fn is_active(&self) -> bool {
        self.removed_at.is_none()
    }

    pub(crate) fn is_current(&self) -> bool {
        self.is_active() && self.displaced.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Member {
    pub(crate) record: LinkRecord,
    pub(crate) state_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Membership {
    Active(Box<Member>),
    Corrupt(String),
    Absent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
    index: Option<u64>,
}

#[derive(Debug, Clone)]
enum Cached {
    Record {
        record: Box<LinkRecord>,
        stamp: FileStamp,
    },
    Corrupt {
        stamp: Option<FileStamp>,
        error: String,
    },
}

impl Cached {
    fn stamp(&self) -> Option<FileStamp> {
        match self {
            Self::Record { stamp, .. } => Some(*stamp),
            Self::Corrupt { stamp, .. } => *stamp,
        }
    }
}

struct Registry {
    linked_root: Option<PathBuf>,
    entries: HashMap<String, Cached>,
    failure: Option<String>,
}

enum Lookup {
    Hit { entry: Cached, linked_root: PathBuf },
    Miss,
    Failed(String),
}

fn registries() -> &'static RwLock<HashMap<PathBuf, Registry>> {
    static REGISTRIES: OnceLock<RwLock<HashMap<PathBuf, Registry>>> = OnceLock::new();
    REGISTRIES.get_or_init(|| RwLock::new(HashMap::new()))
}

#[cfg(test)]
thread_local! {
    static DISK_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn disk_reads_on_this_thread() -> usize {
    DISK_READS.with(std::cell::Cell::get)
}

fn note_disk_read() {
    #[cfg(test)]
    DISK_READS.with(|reads| reads.set(reads.get() + 1));
}

pub(crate) fn is_linked_id(project_id: &str) -> bool {
    project_id
        .strip_prefix(LINKED_ID_PREFIX)
        .is_some_and(|hex| {
            hex.len() == 32
                && hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

#[cfg(unix)]
fn file_index(metadata: &std::fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt as _;
    Some(metadata.ino())
}

#[cfg(not(unix))]
fn file_index(_metadata: &std::fs::Metadata) -> Option<u64> {
    None
}

fn entry_directory_exists(directory: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(directory) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !crate::paths::is_reparse_point(&metadata) =>
        {
            Ok(true)
        }
        Ok(_) => Err("folder registry entry is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect folder registry entry: {error}")),
    }
}

fn link_stamp(directory: &Path) -> Result<Option<FileStamp>, String> {
    match std::fs::symlink_metadata(directory.join(LINK_FILE)) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            Ok(Some(FileStamp {
                len: metadata.len(),
                modified: metadata.modified().ok(),
                index: file_index(&metadata),
            }))
        }
        Ok(_) => Err("folder link is not a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not inspect folder link: {error}")),
    }
}

fn validate_compile_dir(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains('\\')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("folder link compile directory is invalid".into());
    }
    Ok(())
}

fn validate_record(record: &LinkRecord, project_id: &str) -> Result<(), String> {
    if record.version != LINK_VERSION {
        return Err(format!(
            "unsupported folder link version {}",
            record.version
        ));
    }
    if record.id != project_id || !is_linked_id(&record.id) {
        return Err("folder link does not match its registry entry".into());
    }
    if !Path::new(&record.canonical_path).is_absolute() {
        return Err("folder link path is not absolute".into());
    }
    if let Some(compile_dir) = &record.compile_dir {
        validate_compile_dir(compile_dir)?;
    }
    Ok(())
}

fn read_record(directory: &Path, project_id: &str) -> Result<Option<LinkRecord>, String> {
    if !entry_directory_exists(directory)? || link_stamp(directory)?.is_none() {
        return Ok(None);
    }
    let file = match std::fs::File::open(directory.join(LINK_FILE)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not open folder link: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_LINK_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read folder link: {error}"))?;
    if bytes.len() as u64 > MAX_LINK_BYTES {
        return Err("folder link is too large".into());
    }
    let mut record: LinkRecord = serde_json::from_slice(&bytes)
        .map_err(|error| format!("folder link is invalid: {error}"))?;
    validate_record(&record, project_id)?;
    record.weak_identity = record.identity.weak;
    Ok(Some(record))
}

fn read_cached(directory: &Path, project_id: &str) -> Option<Cached> {
    let stamp = match link_stamp(directory) {
        Ok(Some(stamp)) => stamp,
        Ok(None) => return None,
        Err(error) => return Some(Cached::Corrupt { stamp: None, error }),
    };
    Some(match read_record(directory, project_id) {
        Ok(Some(record)) => Cached::Record {
            record: Box::new(record),
            stamp,
        },
        Ok(None) => return None,
        Err(error) => Cached::Corrupt {
            stamp: Some(stamp),
            error,
        },
    })
}

fn load_registry() -> Registry {
    note_disk_read();
    let mut registry = Registry {
        linked_root: None,
        entries: HashMap::new(),
        failure: None,
    };
    let linked_root = match crate::paths::existing_linked_root() {
        Ok(Some(linked_root)) => linked_root,
        Ok(None) => return registry,
        Err(error) => {
            registry.failure = Some(error);
            return registry;
        }
    };
    match std::fs::read_dir(&linked_root) {
        Ok(listing) => {
            for entry in listing.flatten() {
                let Some(project_id) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if !is_linked_id(&project_id) {
                    continue;
                }
                if let Some(cached) = read_cached(&linked_root.join(&project_id), &project_id) {
                    registry.entries.insert(project_id, cached);
                }
            }
        }
        Err(error) => {
            registry.failure = Some(format!("could not read the folder registry: {error}"))
        }
    }
    registry.linked_root = Some(linked_root);
    registry
}

fn lookup(registry: &Registry, project_id: &str) -> Lookup {
    if let Some(failure) = &registry.failure {
        if is_linked_id(project_id) {
            return Lookup::Failed(failure.clone());
        }
    }
    match (registry.entries.get(project_id), &registry.linked_root) {
        (Some(entry), Some(linked_root)) => Lookup::Hit {
            entry: entry.clone(),
            linked_root: linked_root.clone(),
        },
        _ => Lookup::Miss,
    }
}

fn membership(entry: Option<Cached>, directory: PathBuf) -> Membership {
    match entry {
        Some(Cached::Record { record, .. }) if record.is_active() => {
            Membership::Active(Box::new(Member {
                record: *record,
                state_dir: directory,
            }))
        }
        Some(Cached::Corrupt { error, .. }) => Membership::Corrupt(error),
        Some(Cached::Record { .. }) | None => Membership::Absent,
    }
}

fn store_entry(data_root: &Path, linked_root: &Path, project_id: &str, entry: Option<Cached>) {
    let mut registries = registries().write().unwrap_or_else(PoisonError::into_inner);
    let Some(registry) = registries.get_mut(data_root) else {
        return;
    };
    registry.linked_root = Some(linked_root.to_path_buf());
    match entry {
        Some(entry) => {
            registry.entries.insert(project_id.to_owned(), entry);
        }
        None => {
            registry.entries.remove(project_id);
        }
    }
}

pub(crate) fn cached_membership(project_id: &str) -> Result<Membership, String> {
    let data_root = crate::paths::oleafly_root()?;
    let cached = registries()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&data_root)
        .map(|registry| lookup(registry, project_id));
    let found = match cached {
        Some(Lookup::Failed(_)) | None => {
            let loaded = load_registry();
            let found = lookup(&loaded, project_id);
            registries()
                .write()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(data_root.clone(), loaded);
            found
        }
        Some(found) => found,
    };
    let (entry, linked_root) = match found {
        Lookup::Hit { entry, linked_root } => (entry, linked_root),
        Lookup::Miss => return Ok(Membership::Absent),
        Lookup::Failed(error) => return Err(error),
    };
    let directory = linked_root.join(project_id);
    let current = link_stamp(&directory).ok().flatten();
    if current.is_some() && current == entry.stamp() {
        return Ok(membership(Some(entry), directory));
    }
    note_disk_read();
    let fresh = read_cached(&directory, project_id);
    store_entry(&data_root, &linked_root, project_id, fresh.clone());
    Ok(membership(fresh, directory))
}

pub(crate) fn refreshed_membership(project_id: &str) -> Result<Membership, String> {
    if !is_linked_id(project_id) {
        return Ok(Membership::Absent);
    }
    let data_root = crate::paths::oleafly_root()?;
    note_disk_read();
    let Some(linked_root) = crate::paths::existing_linked_root()? else {
        return Ok(Membership::Absent);
    };
    let directory = linked_root.join(project_id);
    let fresh = read_cached(&directory, project_id);
    store_entry(&data_root, &linked_root, project_id, fresh.clone());
    Ok(membership(fresh, directory))
}

pub(crate) fn id_reserved(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let entry = crate::paths::oleafly_root()?
        .join("linked")
        .join(project_id);
    match std::fs::symlink_metadata(entry) {
        Ok(_) => Ok(true),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(format!(
            "could not inspect folder registry identity: {error}"
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkEntry {
    Record(Box<LinkRecord>),
    Corrupt { id: String, error: String },
}

impl LinkEntry {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::Record(record) => &record.id,
            Self::Corrupt { id, .. } => id,
        }
    }
}

pub(crate) fn list() -> Result<Vec<LinkEntry>, String> {
    let data_root = crate::paths::oleafly_root()?;
    let registry = load_registry();
    if let Some(failure) = &registry.failure {
        return Err(failure.clone());
    }
    let mut entries: Vec<LinkEntry> = registry
        .entries
        .iter()
        .map(|(project_id, cached)| match cached {
            Cached::Record { record, .. } => LinkEntry::Record(record.clone()),
            Cached::Corrupt { error, .. } => LinkEntry::Corrupt {
                id: project_id.clone(),
                error: error.clone(),
            },
        })
        .collect();
    entries.sort_by(|left, right| left.id().cmp(right.id()));
    registries()
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(data_root, registry);
    Ok(entries)
}

#[cfg(test)]
pub(crate) use management::{
    folder_snapshot_for_test, get, register, register_folder_for_test, transaction, update,
    NewLink, Registration, Transaction,
};

#[cfg(test)]
mod management {
    use super::*;
    use oleafly_core::locking::{lock_file, lock_mutex, STORAGE_LOCK_TIMEOUT};
    use std::sync::{Mutex, MutexGuard};

    pub(super) fn new_linked_id() -> String {
        format!("{LINKED_ID_PREFIX}{:032x}", rand::random::<u128>())
    }

    pub(super) fn write_record(directory: &Path, record: &LinkRecord) -> Result<(), String> {
        let mut record = record.clone();
        record.weak_identity = record.identity.weak;
        let bytes = serde_json::to_vec_pretty(&record)
            .map_err(|error| format!("could not encode folder link: {error}"))?;
        let path = directory.join(LINK_FILE);
        crate::sandbox::atomic_write(&path, &bytes)?;
        crate::fsperm::harden_file(&path);
        Ok(())
    }

    pub(crate) fn get(project_id: &str) -> Result<Option<LinkRecord>, String> {
        if !is_linked_id(project_id) {
            return Ok(None);
        }
        let Some(linked_root) = crate::paths::existing_linked_root()? else {
            return Ok(None);
        };
        read_record(&linked_root.join(project_id), project_id)
    }

    pub(crate) struct NewLink {
        pub(crate) canonical_path: PathBuf,
        pub(crate) identity: FsIdentity,
        pub(crate) volume_kind: VolumeKind,
        pub(crate) display_name: Option<String>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) enum Registration {
        Created(LinkRecord),
        Existing(LinkRecord),
    }

    impl Registration {
        pub(crate) fn record(&self) -> &LinkRecord {
            match self {
                Self::Created(record) | Self::Existing(record) => record,
            }
        }
    }

    pub(super) const REGISTRY_LOCK_FILE: &str = ".linked-registry.lock";
    const RESERVATION_ATTEMPTS: usize = 32;

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| u64::try_from(value.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or_default()
    }

    fn write_mutex() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct RegistryWriteLock {
        _file: std::fs::File,
        _guard: MutexGuard<'static, ()>,
    }

    fn lock_registry_writes() -> Result<RegistryWriteLock, String> {
        let guard = lock_mutex(write_mutex(), STORAGE_LOCK_TIMEOUT)
            .map_err(|error| format!("failed to lock the folder registry: {error}"))?;
        let root = crate::paths::oleafly_root()?;
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("failed to create the Oleafly data directory: {error}"))?;
        let path = root.join(REGISTRY_LOCK_FILE);
        if std::fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("the folder registry lock cannot be a symbolic link".to_string());
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|error| format!("failed to open the folder registry lock: {error}"))?;
        crate::fsperm::harden_file(&path);
        lock_file(&file, true, STORAGE_LOCK_TIMEOUT)
            .map_err(|error| format!("failed to lock the folder registry: {error}"))?;
        Ok(RegistryWriteLock {
            _file: file,
            _guard: guard,
        })
    }

    fn registrable_path(path: &Path) -> Result<String, String> {
        if !path.is_absolute() {
            return Err("a linked folder path must be absolute".to_string());
        }
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("could not resolve the linked folder: {error}"))?;
        if canonical != path {
            return Err("a linked folder path must be canonical".to_string());
        }
        let metadata = std::fs::symlink_metadata(&canonical)
            .map_err(|error| format!("could not inspect the linked folder: {error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("a linked folder must be a real directory".to_string());
        }
        if crate::paths::overlaps_app_data(&canonical)? {
            return Err("a folder that holds Oleafly's app data cannot be linked".to_string());
        }
        canonical
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| "a linked folder path must be valid Unicode".to_string())
    }

    fn same_folder(record: &LinkRecord, canonical_path: &str, identity: &FsIdentity) -> bool {
        record.is_active()
            && record.canonical_path == canonical_path
            && (record.identity == *identity || (record.identity.weak && identity.weak))
    }

    fn records_in(linked_root: &Path) -> Result<Vec<LinkRecord>, String> {
        let listing = std::fs::read_dir(linked_root)
            .map_err(|error| format!("could not read the folder registry: {error}"))?;
        let mut records = Vec::new();
        for entry in listing.flatten() {
            let Some(project_id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_linked_id(&project_id) {
                continue;
            }
            if let Ok(Some(record)) = read_record(&linked_root.join(&project_id), &project_id) {
                records.push(record);
            }
        }
        records.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(records)
    }

    pub(super) struct LinkedReservation {
        directory: PathBuf,
        committed: bool,
        _identity: crate::worktree_lock::ProjectWorktreeLock,
    }

    impl LinkedReservation {
        fn commit(mut self) -> PathBuf {
            self.committed = true;
            self.directory.clone()
        }
    }

    impl Drop for LinkedReservation {
        fn drop(&mut self) {
            if !self.committed {
                let _ = std::fs::remove_dir_all(&self.directory);
            }
        }
    }

    pub(super) fn try_reserve_linked_id(
        linked_root: &Path,
        project_id: &str,
    ) -> Result<Option<LinkedReservation>, String> {
        crate::paths::validate_project_id(project_id)?;
        let identity =
            crate::worktree_lock::ProjectWorktreeLock::exclusive_for_identity_allocation(
                project_id,
            )?;
        let library = crate::paths::oleafly_root()?
            .join("projects")
            .join(project_id);
        match std::fs::symlink_metadata(&library) {
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to inspect library project identity {project_id}: {error}"
                ))
            }
        }
        if crate::storage::recycled_project_identity_reserved_lock_held(project_id)?
            || crate::paths::existing_checkpoint_store_dir(project_id)?.is_some()
        {
            return Ok(None);
        }
        let directory = linked_root.join(project_id);
        match std::fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "failed to reserve folder identity {project_id}: {error}"
                ))
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700));
        }
        Ok(Some(LinkedReservation {
            directory,
            committed: false,
            _identity: identity,
        }))
    }

    pub(crate) struct Transaction {
        records: Vec<LinkRecord>,
        _lock: RegistryWriteLock,
    }

    impl Transaction {
        pub(crate) fn records(&self) -> &[LinkRecord] {
            &self.records
        }

        pub(crate) fn create(
            &mut self,
            link: NewLink,
            reattach: Option<ReattachOffer>,
        ) -> Result<LinkRecord, String> {
            self.create_with(link, reattach, |_, _| Ok(()))
        }

        pub(crate) fn create_with<F>(
            &mut self,
            link: NewLink,
            reattach: Option<ReattachOffer>,
            before_commit: F,
        ) -> Result<LinkRecord, String>
        where
            F: FnOnce(&mut Self, &LinkRecord) -> Result<(), String>,
        {
            let canonical_path = registrable_path(&link.canonical_path)?;
            let linked_root = crate::paths::linked_root()?;
            let now = now_ms();
            let mut reserved = None;
            for _ in 0..RESERVATION_ATTEMPTS {
                let project_id = new_linked_id();
                if let Some(reservation) = try_reserve_linked_id(&linked_root, &project_id)? {
                    reserved = Some((project_id, reservation));
                    break;
                }
            }
            let Some((project_id, reservation)) = reserved else {
                return Err(crate::app_error::AppError::new("project.folder_unavailable").into());
            };
            let record = LinkRecord {
                version: LINK_VERSION,
                id: project_id.clone(),
                canonical_path,
                weak_identity: link.identity.weak,
                identity: link.identity,
                display_name: link.display_name,
                created_at: now,
                last_opened_at: now,
                removed_at: None,
                volume_kind: link.volume_kind,
                compile_dir: None,
                displaced: None,
                reattach,
                extra: BTreeMap::new(),
            };
            write_record(&reservation.directory, &record)?;
            before_commit(self, &record)?;
            let directory = reservation.commit();
            let data_root = crate::paths::oleafly_root()?;
            store_entry(
                &data_root,
                &linked_root,
                &project_id,
                read_cached(&directory, &project_id),
            );
            self.records.push(record.clone());
            Ok(record)
        }

        pub(crate) fn update<F>(
            &mut self,
            project_id: &str,
            change: F,
        ) -> Result<LinkRecord, String>
        where
            F: FnOnce(&mut LinkRecord) -> Result<(), String>,
        {
            let missing = || format!("project does not exist: {project_id}");
            if !is_linked_id(project_id) {
                return Err(missing());
            }
            let linked_root = crate::paths::existing_linked_root()?.ok_or_else(missing)?;
            let directory = linked_root.join(project_id);
            let current = read_record(&directory, project_id)?.ok_or_else(missing)?;
            let mut next = current.clone();
            change(&mut next)?;
            next.weak_identity = next.identity.weak;
            if next.id != current.id
                || next.version != current.version
                || next.created_at != current.created_at
            {
                return Err("a folder link cannot change its identity".into());
            }
            if next.canonical_path != current.canonical_path {
                next.canonical_path = registrable_path(Path::new(&next.canonical_path))?;
            }
            validate_record(&next, project_id)?;
            if next != current {
                write_record(&directory, &next)?;
            }
            let data_root = crate::paths::oleafly_root()?;
            note_disk_read();
            store_entry(
                &data_root,
                &linked_root,
                project_id,
                read_cached(&directory, project_id),
            );
            match self.records.iter_mut().find(|record| record.id == next.id) {
                Some(slot) => *slot = next.clone(),
                None => self.records.push(next.clone()),
            }
            Ok(next)
        }
    }

    pub(crate) fn transaction<T, E, F>(work: F) -> Result<T, E>
    where
        E: From<String>,
        F: FnOnce(&mut Transaction) -> Result<T, E>,
    {
        let lock = lock_registry_writes()?;
        let records = match crate::paths::existing_linked_root()? {
            Some(linked_root) => records_in(&linked_root)?,
            None => Vec::new(),
        };
        work(&mut Transaction {
            records,
            _lock: lock,
        })
    }

    pub(crate) fn register(link: NewLink) -> Result<Registration, String> {
        transaction(|txn| {
            let canonical_path = registrable_path(&link.canonical_path)?;
            if let Some(existing) = txn
                .records
                .iter()
                .find(|record| same_folder(record, &canonical_path, &link.identity))
            {
                return Ok(Registration::Existing(existing.clone()));
            }
            txn.create(link, None).map(Registration::Created)
        })
    }

    pub(crate) fn update<F>(project_id: &str, change: F) -> Result<LinkRecord, String>
    where
        F: FnOnce(&mut LinkRecord) -> Result<(), String>,
    {
        transaction(|txn| txn.update(project_id, change))
    }

    pub(crate) fn register_folder_for_test(folder: &Path) -> LinkRecord {
        let canonical = folder.canonicalize().unwrap();
        let observed = crate::fs_identity::identify_directory(&canonical).unwrap();
        register(NewLink {
            canonical_path: canonical,
            identity: observed.identity,
            volume_kind: observed.volume_kind,
            display_name: None,
        })
        .unwrap()
        .record()
        .clone()
    }

    pub(crate) fn folder_snapshot_for_test(root: &Path) -> Vec<(String, u64, Option<SystemTime>)> {
        fn visit(root: &Path, path: &Path, out: &mut Vec<(String, u64, Option<SystemTime>)>) {
            let metadata = std::fs::symlink_metadata(path).unwrap();
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push((relative, metadata.len(), metadata.modified().ok()));
            if metadata.is_dir() {
                for entry in std::fs::read_dir(path).unwrap().flatten() {
                    visit(root, &entry.path(), out);
                }
            }
        }
        let mut out = Vec::new();
        visit(root, root, &mut out);
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::management::{
        new_linked_id, try_reserve_linked_id, write_record, REGISTRY_LOCK_FILE,
    };
    use super::*;

    fn record_for(folder: &Path, id: &str) -> LinkRecord {
        let canonical = folder.canonicalize().unwrap();
        let observed = crate::fs_identity::identify_directory(&canonical).unwrap();
        LinkRecord {
            version: LINK_VERSION,
            id: id.to_owned(),
            canonical_path: canonical.to_str().unwrap().to_owned(),
            weak_identity: observed.identity.weak,
            identity: observed.identity,
            display_name: None,
            created_at: 1,
            last_opened_at: 1,
            removed_at: None,
            volume_kind: observed.volume_kind,
            compile_dir: None,
            displaced: None,
            reattach: None,
            extra: BTreeMap::new(),
        }
    }

    fn fake_other_process_record(record: &LinkRecord) {
        let directory = crate::paths::linked_root().unwrap().join(&record.id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(LINK_FILE),
            serde_json::to_vec_pretty(record).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn linked_ids_are_prefixed_lowercase_hex_and_valid_project_ids() {
        for _ in 0..64 {
            let id = new_linked_id();
            assert!(is_linked_id(&id), "{id}");
            crate::paths::validate_project_id(&id).unwrap();
        }
        assert!(!is_linked_id("linked-ABCDEF00000000000000000000000000"));
        assert!(!is_linked_id("linked-123"));
        assert!(!is_linked_id("project-00000000000000000000000000000001"));
        assert!(!is_linked_id("flying-pink-pikachu"));
    }

    #[test]
    fn link_records_round_trip_and_keep_fields_from_newer_builds() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 7);
        let directory = data.path().join(&id);
        std::fs::create_dir(&directory).unwrap();
        let mut record = record_for(folder.path(), &id);
        record.display_name = Some("Thesis".into());
        record.compile_dir = Some("paper".into());
        record
            .extra
            .insert("lens".into(), serde_json::json!({ "pinned": true }));

        write_record(&directory, &record).unwrap();

        assert_eq!(read_record(&directory, &id).unwrap(), Some(record));
        assert!(read_record(&directory, &format!("{LINKED_ID_PREFIX}{:032x}", 8)).is_err());
        let text = std::fs::read_to_string(directory.join(LINK_FILE)).unwrap();
        assert!(text.contains("\"lens\""));
        assert!(!text.contains("removed_at"));
    }

    #[test]
    fn displacement_and_reattach_offers_round_trip_and_stay_out_of_plain_records() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 11);
        let directory = data.path().join(&id);
        std::fs::create_dir(&directory).unwrap();
        let plain = record_for(folder.path(), &id);
        write_record(&directory, &plain).unwrap();
        let text = std::fs::read_to_string(directory.join(LINK_FILE)).unwrap();
        assert!(
            !text.contains("displaced") && !text.contains("reattach"),
            "{text}"
        );

        let mut record = plain;
        record.displaced = Some(Displacement {
            by: format!("{LINKED_ID_PREFIX}{:032x}", 12),
            at_ms: 5,
        });
        record.reattach = Some(ReattachOffer {
            from_id: format!("{LINKED_ID_PREFIX}{:032x}", 13),
            reason: ReattachReason::Replaced,
            offered_at_ms: 6,
        });
        write_record(&directory, &record).unwrap();

        let read = read_record(&directory, &id).unwrap().unwrap();
        assert_eq!(read, record);
        assert!(read.extra.is_empty());
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(directory.join(LINK_FILE)).unwrap()).unwrap();
        assert_eq!(json["reattach"]["reason"], "replaced");
        assert_eq!(json["displaced"]["at_ms"], 5);
    }

    #[test]
    fn the_weak_flag_is_derived_from_the_identity_and_never_read_back() {
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 10);
        let directory = data.path().join(&id);
        std::fs::create_dir(&directory).unwrap();
        let mut record = record_for(folder.path(), &id);
        record.weak_identity = !record.identity.weak;
        std::fs::write(
            directory.join(LINK_FILE),
            serde_json::to_vec_pretty(&record).unwrap(),
        )
        .unwrap();

        let read = read_record(&directory, &id).unwrap().unwrap();

        assert_eq!(read.weak_identity, read.identity.weak);
        assert!(!read.extra.contains_key("weak_identity"));
    }

    #[test]
    fn unreadable_link_records_are_reported_not_trusted() {
        let data = tempfile::tempdir().unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 9);
        let directory = data.path().join(&id);
        std::fs::create_dir(&directory).unwrap();
        assert_eq!(read_record(&directory, &id).unwrap(), None);
        std::fs::write(directory.join(LINK_FILE), b"{not json").unwrap();
        assert!(read_record(&directory, &id).is_err());
        std::fs::write(
            directory.join(LINK_FILE),
            vec![b' '; (MAX_LINK_BYTES + 1) as usize],
        )
        .unwrap();
        assert!(read_record(&directory, &id)
            .unwrap_err()
            .contains("too large"));
        for invalid in ["../up", "/abs", "a\\b", ""] {
            assert!(validate_compile_dir(invalid).is_err(), "{invalid}");
        }
        validate_compile_dir("paper/chapters").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_registry_entry_reached_through_a_symlink_is_not_trusted() {
        let data = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 17);
        let record = record_for(folder.path(), &id);
        write_record(elsewhere.path(), &record).unwrap();
        let directory = data.path().join(&id);
        std::os::unix::fs::symlink(elsewhere.path(), &directory).unwrap();

        assert!(read_record(&directory, &id).is_err());
        assert!(matches!(
            read_cached(&directory, &id),
            Some(Cached::Corrupt { .. })
        ));
    }

    #[test]
    fn membership_is_cached_and_follows_rewrites_by_another_process() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        std::fs::create_dir(folders.path().join("a")).unwrap();
        std::fs::create_dir(folders.path().join("moved-somewhere-else")).unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 11);

        assert_eq!(cached_membership(&id).unwrap(), Membership::Absent);
        let first = record_for(&folders.path().join("a"), &id);
        fake_other_process_record(&first);
        assert_eq!(cached_membership(&id).unwrap(), Membership::Absent);
        let Membership::Active(member) = refreshed_membership(&id).unwrap() else {
            panic!()
        };
        assert_eq!(member.record, first);
        assert_eq!(
            member.state_dir,
            crate::paths::existing_linked_root()
                .unwrap()
                .unwrap()
                .join(&id)
        );

        let moved = record_for(&folders.path().join("moved-somewhere-else"), &id);
        fake_other_process_record(&moved);
        let Membership::Active(member) = cached_membership(&id).unwrap() else {
            panic!()
        };
        assert_eq!(member.record, moved);

        std::fs::remove_dir_all(crate::paths::linked_root().unwrap().join(&id)).unwrap();
        assert_eq!(cached_membership(&id).unwrap(), Membership::Absent);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_corrupt_entry_affects_only_its_own_id_and_library_ids_ignore_registry_failures() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let broken = format!("{LINKED_ID_PREFIX}{:032x}", 12);
        let directory = crate::paths::linked_root().unwrap().join(&broken);
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join(LINK_FILE), b"[]").unwrap();
        assert!(matches!(
            cached_membership(&broken).unwrap(),
            Membership::Corrupt(_)
        ));
        assert_eq!(
            cached_membership(&format!("{LINKED_ID_PREFIX}{:032x}", 13)).unwrap(),
            Membership::Absent
        );
        assert!(matches!(&list().unwrap()[..], [LinkEntry::Corrupt { .. }]));
        std::env::remove_var("OLEAFLY_DATA_DIR");

        let other = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", other.path());
        std::fs::write(other.path().join("linked"), b"not a directory").unwrap();
        assert_eq!(cached_membership("paper").unwrap(), Membership::Absent);
        assert!(cached_membership(&broken).is_err());
        assert!(list().is_err());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_registry_that_failed_to_load_is_retried_for_linked_ids() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        std::fs::write(data.path().join("linked"), b"not a directory").unwrap();
        let id = format!("{LINKED_ID_PREFIX}{:032x}", 14);
        assert!(cached_membership(&id).is_err());

        std::fs::remove_file(data.path().join("linked")).unwrap();
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let record = record_for(&folder, &id);
        fake_other_process_record(&record);

        let Membership::Active(member) = cached_membership(&id).unwrap() else {
            panic!()
        };
        assert_eq!(member.record, record);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn library_ids_never_touch_the_registry_disk_after_it_loads() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        cached_membership("paper").unwrap();
        let before = disk_reads_on_this_thread();
        for _ in 0..1_000 {
            assert_eq!(cached_membership("paper").unwrap(), Membership::Absent);
        }
        assert_eq!(disk_reads_on_this_thread(), before);
        assert!(!data.path().join("linked").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn registering_a_folder_writes_only_central_state() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("main.tex"), "\\documentclass{article}").unwrap();
        let before = folder_snapshot_for_test(&folder);

        let record = register_folder_for_test(&folder);

        assert!(is_linked_id(&record.id));
        assert_eq!(
            record.canonical_path,
            folder.canonicalize().unwrap().to_str().unwrap()
        );
        assert!(crate::paths::linked_root()
            .unwrap()
            .join(&record.id)
            .join(LINK_FILE)
            .is_file());
        assert_eq!(folder_snapshot_for_test(&folder), before);
        assert_eq!(get(&record.id).unwrap(), Some(record));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn registration_refuses_paths_that_are_not_canonical_real_folders_outside_app_data() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().canonicalize().unwrap().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let observed = crate::fs_identity::identify_directory(&folder).unwrap();
        let attempt = |path: PathBuf| {
            register(NewLink {
                canonical_path: path,
                identity: observed.identity.clone(),
                volume_kind: observed.volume_kind,
                display_name: None,
            })
        };

        assert!(attempt(PathBuf::from("thesis")).is_err());
        let mut dotted = folder.clone().into_os_string();
        for part in ["..", "thesis"] {
            dotted.push(std::path::MAIN_SEPARATOR_STR);
            dotted.push(part);
        }
        assert!(attempt(PathBuf::from(dotted)).is_err());
        assert!(attempt(folder.join("missing")).is_err());
        let file = folder.join("main.tex");
        std::fs::write(&file, "x").unwrap();
        assert!(attempt(file).is_err());
        let inside_data = data.path().canonicalize().unwrap().join("inside");
        std::fs::create_dir(&inside_data).unwrap();
        assert!(attempt(inside_data).is_err());
        assert!(attempt(data.path().canonicalize().unwrap()).is_err());
        assert!(!data.path().join("linked").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn registration_refuses_library_folders_behind_a_symlinked_projects_root() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let volume = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let volume = volume.path().canonicalize().unwrap();
        let library = volume.join("library");
        std::fs::create_dir(&library).unwrap();
        std::os::unix::fs::symlink(&library, data.path().join("projects")).unwrap();
        let project = crate::paths::create_project_dir("paper").unwrap();
        assert_eq!(project, library.join("paper"));
        let sibling = volume.join("thesis");
        std::fs::create_dir(&sibling).unwrap();
        let attempt = |path: &Path| {
            let observed = crate::fs_identity::identify_directory(path).unwrap();
            register(NewLink {
                canonical_path: path.to_path_buf(),
                identity: observed.identity,
                volume_kind: observed.volume_kind,
                display_name: None,
            })
        };

        assert!(attempt(&project).is_err());
        assert!(attempt(&library).is_err());
        assert!(attempt(&volume).is_err());
        assert!(!data.path().join("linked").exists());
        assert!(matches!(attempt(&sibling), Ok(Registration::Created(_))));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_identities_skip_every_namespace_that_already_owns_the_id() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let linked = crate::paths::linked_root().unwrap();
        let projects = crate::paths::projects_root().unwrap();
        let id = |n: u128| format!("{LINKED_ID_PREFIX}{n:032x}");

        std::fs::create_dir(projects.join(id(1))).unwrap();
        assert!(try_reserve_linked_id(&linked, &id(1)).unwrap().is_none());

        oleafly_history::Store::open(crate::paths::checkpoint_store_dir(&id(2)).unwrap()).unwrap();
        assert!(try_reserve_linked_id(&linked, &id(2)).unwrap().is_none());

        let active = projects.join(id(3));
        std::fs::create_dir(&active).unwrap();
        std::fs::write(active.join("project.json"), br#"{"name":"Owner"}"#).unwrap();
        crate::storage::recycle_project_directory(
            &crate::project_location::LibraryProjectDir::resolve(&id(3)).unwrap(),
            "Owner",
        )
        .unwrap();
        assert!(try_reserve_linked_id(&linked, &id(3)).unwrap().is_none());

        std::fs::create_dir(linked.join(id(4))).unwrap();
        assert!(try_reserve_linked_id(&linked, &id(4)).unwrap().is_none());

        let reservation = try_reserve_linked_id(&linked, &id(5)).unwrap().unwrap();
        assert!(linked.join(id(5)).is_dir());
        drop(reservation);
        assert!(!linked.join(id(5)).exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn concurrent_registrations_of_one_folder_share_one_identity() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let start = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let folder = folder.clone();
                let start = std::sync::Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    register_folder_for_test(&folder).id
                })
            })
            .collect();
        let ids: Vec<String> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(ids[0], ids[1]);
        assert_eq!(
            std::fs::read_dir(crate::paths::linked_root().unwrap())
                .unwrap()
                .count(),
            1
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_different_folder_at_a_registered_path_gets_its_own_id_unless_the_volume_is_weak() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let register_as = |name: &str, file: &str, weak: bool| {
            let folder = folders.path().canonicalize().unwrap().join(name);
            std::fs::create_dir_all(&folder).unwrap();
            let observed = crate::fs_identity::identify_directory(&folder).unwrap();
            let mut identity = observed.identity;
            identity.file = file.to_owned();
            identity.weak = weak;
            register(NewLink {
                canonical_path: folder,
                identity,
                volume_kind: observed.volume_kind,
                display_name: None,
            })
            .unwrap()
        };

        let first = register_as("thesis", "1", false);
        assert!(matches!(first, Registration::Created(_)));
        assert_eq!(
            register_as("thesis", "1", false),
            Registration::Existing(first.record().clone())
        );
        let replaced = register_as("thesis", "2", false);
        assert!(
            matches!(&replaced, Registration::Created(record) if record.id != first.record().id)
        );

        let usb = register_as("usb", "3", true);
        assert!(usb.record().weak_identity);
        assert_eq!(
            register_as("usb", "4", true),
            Registration::Existing(usb.record().clone())
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn registration_waits_for_the_cross_process_registry_lock() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(data.path().join(REGISTRY_LOCK_FILE))
            .unwrap();
        fs4::FileExt::try_lock(&held).unwrap();

        let worker = std::thread::spawn(move || register_folder_for_test(&folder));
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(!worker.is_finished());
        assert!(!data.path().join("linked").exists());

        fs4::FileExt::unlock(&held).unwrap();
        assert!(is_linked_id(&worker.join().unwrap().id));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn updates_rewrite_only_real_changes_and_never_the_identity() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let record = register_folder_for_test(&folder);
        let link = crate::paths::linked_root()
            .unwrap()
            .join(&record.id)
            .join(LINK_FILE);
        let written = std::fs::metadata(&link).unwrap().modified().unwrap();

        assert_eq!(update(&record.id, |_| Ok(())).unwrap(), record);
        assert_eq!(
            std::fs::metadata(&link).unwrap().modified().unwrap(),
            written
        );
        assert!(update(&record.id, |next| {
            next.id = format!("{LINKED_ID_PREFIX}{:032x}", 5);
            Ok(())
        })
        .is_err());
        assert!(update(&record.id, |next| {
            next.compile_dir = Some("../outside".into());
            Ok(())
        })
        .is_err());
        assert!(update(&record.id, |next| {
            next.canonical_path = "relative".into();
            Ok(())
        })
        .is_err());
        assert_eq!(get(&record.id).unwrap(), Some(record.clone()));
        let removed = update(&record.id, |next| {
            next.removed_at = Some(10);
            Ok(())
        })
        .unwrap();
        assert_eq!(removed.removed_at, Some(10));
        assert_eq!(cached_membership(&record.id).unwrap(), Membership::Absent);
        assert_eq!(get(&record.id).unwrap().unwrap().removed_at, Some(10));
        assert!(update("paper", |_| Ok(())).is_err());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn get_reads_one_record_and_list_reports_every_entry_in_id_order() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        std::fs::create_dir(folders.path().join("b")).unwrap();
        std::fs::create_dir(folders.path().join("a")).unwrap();
        let later = record_for(
            &folders.path().join("b"),
            &format!("{LINKED_ID_PREFIX}{:032x}", 16),
        );
        let earlier = record_for(
            &folders.path().join("a"),
            &format!("{LINKED_ID_PREFIX}{:032x}", 15),
        );
        assert_eq!(list().unwrap(), Vec::new());
        fake_other_process_record(&later);
        fake_other_process_record(&earlier);

        assert_eq!(get(&earlier.id).unwrap(), Some(earlier.clone()));
        assert_eq!(get("paper").unwrap(), None);
        assert_eq!(
            list().unwrap(),
            vec![
                LinkEntry::Record(Box::new(earlier)),
                LinkEntry::Record(Box::new(later))
            ]
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
