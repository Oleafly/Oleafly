use super::merge::{self, PROJECT_META};
use super::state::{BaseEntry, Failure, Hold, PendingDelete, ProjectState, SkippedFile};
use super::store::{BatchDelete, BatchFile, CloudStore, StoreError, WriteMode};
use crate::checkpoint_capture::FileStamp;
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::{ContentHash, ContentHasher};
use oleafly_core::exclude::{decide, Decision, EntryInfo, EntryKind, PolicyFields, SkipReason};
use oleafly_core::hlc::{Hlc, HlcClock, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use oleafly_core::portable;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const FORMAT_VERSION: u32 = 1;
const MAX_FILES: usize = 100_000;
pub(crate) const MAX_VERSION_BYTES: usize = 64 * 1024 * 1024;
const MASS_DELETE_MIN: usize = 20;
const PUBLISH_EVERY_FILES: usize = 200;
const PUBLISH_EVERY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FUTURE_SKEW_MS: u64 = 24 * 60 * 60 * 1000;
const DOWNLOAD_CONCURRENCY: usize = 16;
const ZIP_MAX_FILES: usize = 9_000;
const ZIP_SETUP_MS: u64 = 6_000;
const ZIP_BYTES_PER_MS: u64 = 3_000;
const FILE_DOWNLOAD_MS: u64 = 50;
const ZIP_MAX_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const STALE_TEMP_AGE: Duration = Duration::from_secs(60 * 60);
pub(crate) const RETRY_FAILED_MS: u64 = 60 * 60 * 1000;
const DISK_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_LISTED_SKIPS: usize = 50;
pub(crate) const MAX_CONFLICT_COPIES: usize = 100;
const MAX_TREE_DEPTH: usize = 32;
const APPLY_BATCH: usize = 32;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RoundError {
    Store(StoreError),
    NewerVersion,
    Busy,
    Unreadable(String),
    TooManyFiles,
    DiskFull,
    Local(String),
}

impl From<StoreError> for RoundError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl RoundError {
    pub(crate) fn ends_round(&self) -> bool {
        matches!(self, Self::Store(error) if error.ends_round())
    }

    pub(crate) fn to_app_error(&self) -> String {
        use crate::app_error::AppError;
        match self {
            Self::Store(error) => error.to_app_error(),
            Self::NewerVersion => AppError::new("cloud.newer_version").into(),
            Self::Busy => AppError::new("cloud.project_busy").into(),
            Self::Unreadable(detail) => AppError::new("cloud.remote_unreadable")
                .detail(detail.clone())
                .into(),
            Self::TooManyFiles => AppError::new("cloud.too_many_files").into(),
            Self::DiskFull => AppError::new("cloud.disk_full").into(),
            Self::Local(detail) => AppError::new("cloud.local_io")
                .detail(detail.clone())
                .into(),
        }
    }
}

impl std::fmt::Display for RoundError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => error.fmt(formatter),
            Self::NewerVersion => formatter.write_str("a newer Oleafly wrote this project"),
            Self::Busy => formatter.write_str("the project is busy"),
            Self::TooManyFiles => formatter.write_str("the project has too many files to sync"),
            Self::DiskFull => formatter.write_str("there isn't enough free disk space"),
            Self::Unreadable(detail) | Self::Local(detail) => formatter.write_str(detail),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct FileRecord {
    pub(crate) path: String,
    pub(crate) hash: String,
    pub(crate) size: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) exec: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rev: Option<String>,
    #[serde(flatten)]
    pub(crate) extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct VersionManifest {
    pub(crate) v: u32,
    pub(crate) project: ProjectId,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) manifest: serde_json::Value,
    pub(crate) stamp: Stamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) device: Option<String>,
    pub(crate) files: Vec<FileRecord>,
    #[serde(flatten)]
    pub(crate) extra: serde_json::Map<String, serde_json::Value>,
}

impl VersionManifest {
    pub(crate) fn total_size(&self) -> u64 {
        self.files.iter().map(|file| file.size).sum()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Remote {
    pub(crate) version: VersionManifest,
    pub(crate) rev: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Tombstone {
    pub(crate) device: String,
    pub(crate) at_ms: u64,
}

pub(crate) struct SyncContext {
    pub(crate) device: DeviceId,
    pub(crate) device_name: String,
    pub(crate) fallback_name: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RoundOptions {
    pub(crate) allow_mass_delete: bool,
    pub(crate) restore_deleted: bool,
    pub(crate) allow_uploads: bool,
    pub(crate) replace_remote: bool,
    pub(crate) free_bytes: Option<u64>,
    pub(crate) dirty: BTreeSet<String>,
    pub(crate) cancel: Option<Arc<AtomicBool>>,
}

impl RoundOptions {
    fn forced(&self) -> bool {
        self.allow_mass_delete || self.restore_deleted || self.replace_remote
    }

    fn cancelled(&self) -> bool {
        self.cancel
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Relaxed))
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct SyncOutcome {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
    pub(crate) deleted_remote: usize,
    pub(crate) deleted_local: usize,
    pub(crate) conflicts: usize,
    pub(crate) skipped: usize,
    pub(crate) held: bool,
    pub(crate) removed_by: Option<String>,
    pub(crate) quota_hit: bool,
    pub(crate) unchanged: bool,
    pub(crate) changed: Vec<String>,
}

pub(crate) type PendingHook = Arc<dyn Fn(&[PendingDelete]) + Send + Sync>;

pub(crate) struct RoundEnv {
    pub(crate) root: PathBuf,
    pub(crate) staging: PathBuf,
    pub(crate) trash: PathBuf,
    pub(crate) lock_id: Option<String>,
    pub(crate) persist_pending: Option<PendingHook>,
}

pub(crate) struct RoundResult {
    pub(crate) outcome: SyncOutcome,
    pub(crate) project: ProjectState,
    pub(crate) hlc: u64,
    pub(crate) error: Option<RoundError>,
}

pub(crate) fn project_remote(cloud: ProjectId) -> String {
    format!("/projects/{cloud}")
}

pub(crate) fn version_remote(cloud: ProjectId) -> String {
    format!("{}/version.json", project_remote(cloud))
}

fn file_remote(cloud: ProjectId, portable: &str) -> String {
    format!("{}/files/{portable}", project_remote(cloud))
}

pub(crate) fn tombstone_remote(cloud: ProjectId) -> String {
    format!("/removed/{cloud}.json")
}

fn key(path: &str) -> String {
    portable::fold(path)
}

fn native(root: &Path, portable: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for part in portable.split('/') {
        path.push(part);
    }
    path
}

fn valid_hash(hash: &str) -> bool {
    ContentHash::from_hex(hash).is_ok()
}

#[cfg(windows)]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn executable(metadata: &std::fs::Metadata, _fallback: bool) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_metadata: &std::fs::Metadata, fallback: bool) -> bool {
    fallback
}

#[cfg(unix)]
fn apply_exec(path: &Path, portable: &str, exec: bool) {
    use std::os::unix::fs::PermissionsExt as _;
    let hidden = portable
        .rsplit('/')
        .next()
        .is_some_and(|name| name.starts_with('.'));
    if hidden {
        return;
    }
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        let mode = permissions.mode();
        let wanted = if exec {
            mode | ((mode & 0o444) >> 2)
        } else {
            mode & !0o111
        };
        if wanted != mode {
            permissions.set_mode(wanted);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }
}

#[cfg(not(unix))]
fn apply_exec(_path: &Path, _portable: &str, _exec: bool) {}

#[derive(Clone, Debug, Default)]
pub(crate) struct OwnedPolicy {
    main_doc: String,
    include: Vec<String>,
    exclude: Vec<String>,
}

impl OwnedPolicy {
    fn fields(&self) -> PolicyFields<'_> {
        PolicyFields {
            main_doc: &self.main_doc,
            sync_include: &self.include,
            sync_exclude: &self.exclude,
        }
    }
}

pub(crate) fn read_meta_value(root: &Path) -> Option<serde_json::Value> {
    read_json(&root.join(PROJECT_META))
}

fn policy_for(meta: Option<&serde_json::Value>) -> OwnedPolicy {
    let manifest = meta
        .and_then(|value| serde_json::to_vec(value).ok())
        .and_then(|bytes| oleafly_core::sniff_oleafly_manifest(&bytes))
        .unwrap_or_default();
    OwnedPolicy {
        main_doc: manifest.main_doc,
        include: manifest.sync_include,
        exclude: manifest.sync_exclude,
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LocalFile {
    pub(crate) path: String,
    pub(crate) hash: String,
    size: u64,
    stamp: FileStamp,
    signature: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Capture {
    pub(crate) files: BTreeMap<String, LocalFile>,
    pub(crate) unobserved: BTreeSet<String>,
    pub(crate) skipped: Vec<SkippedFile>,
    policy: OwnedPolicy,
    meta: Option<serde_json::Value>,
}

impl Capture {
    fn skip(&mut self, path: String, reason: &str) {
        self.skipped.push(SkippedFile {
            path,
            reason: reason.to_string(),
        });
    }

    pub(crate) fn matches_base(&self, base: &BTreeMap<String, BaseEntry>) -> bool {
        let base_by_key: BTreeMap<String, &BaseEntry> = base
            .iter()
            .map(|(path, entry)| (key(path), entry))
            .collect();
        if self.files.iter().any(|(key, file)| {
            base_by_key
                .get(key)
                .is_none_or(|entry| entry.hash != file.hash)
        }) {
            return false;
        }
        base_by_key
            .keys()
            .all(|key| self.files.contains_key(key) || self.unobserved.contains(key))
    }
}

struct Prior<'a> {
    by_key: BTreeMap<String, (&'a str, &'a BaseEntry)>,
}

impl<'a> Prior<'a> {
    fn new(base: &'a BTreeMap<String, BaseEntry>) -> Self {
        Self {
            by_key: base
                .iter()
                .map(|(path, entry)| (key(path), (path.as_str(), entry)))
                .collect(),
        }
    }

    fn path(&self, file_key: &str) -> Option<&'a str> {
        self.by_key.get(file_key).map(|(path, _)| *path)
    }

    fn reusable_hash(&self, file_key: &str, portable: &str, stamp: &FileStamp) -> Option<String> {
        let (path, entry) = self.by_key.get(file_key)?;
        let stored = entry.stamp.as_deref()?;
        (*path == portable && stamp.signature().as_deref() == Some(stored))
            .then(|| entry.hash.clone())
    }
}

fn skip_code(reason: SkipReason) -> Option<&'static str> {
    match reason {
        SkipReason::BuildOutput | SkipReason::ExcludedByUser | SkipReason::OutsideGitPointer => {
            None
        }
        SkipReason::Reinstallable => Some("packageFolder"),
        SkipReason::ZipLeftovers => Some("zipLeftovers"),
        SkipReason::Symlink => Some("symlink"),
        SkipReason::SpecialFile => Some("specialFile"),
        SkipReason::NonUtf8Name => Some("unsupportedName"),
        SkipReason::TooLarge => Some("tooLarge"),
    }
}

fn shown_path(relative: &Path) -> String {
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn sweep_stale_temp(path: &Path, name: &str) {
    if !name.ends_with(".oleafly-cloud.tmp") {
        return;
    }
    let stale = std::fs::symlink_metadata(path)
        .ok()
        .filter(std::fs::Metadata::is_file)
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age > STALE_TEMP_AGE);
    if stale {
        let _ = std::fs::remove_file(path);
    }
}

fn entry_kind(file_type: std::fs::FileType) -> EntryKind {
    if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

enum Seen {
    Skip,
    Directory(PathBuf),
    File {
        portable: String,
        path: PathBuf,
        metadata: std::fs::Metadata,
    },
}

fn classify_entry(
    out: &mut Capture,
    root: &Path,
    fields: &PolicyFields<'_>,
    entry: &std::fs::DirEntry,
) -> Seen {
    let path = entry.path();
    let Ok(relative) = path.strip_prefix(root) else {
        return Seen::Skip;
    };
    let Ok(file_type) = entry.file_type() else {
        return Seen::Skip;
    };
    let kind = entry_kind(file_type);
    let Ok(metadata) = std::fs::symlink_metadata(&path) else {
        return Seen::Skip;
    };
    let info = EntryInfo {
        kind,
        len: metadata.len(),
        placeholder: oleafly_core::is_cloud_placeholder(&metadata),
        git_tracked: false,
        git_pointer_inside: None,
    };
    match decide(relative, &info, fields) {
        Decision::Ignore => {
            if let Some(name) = entry.file_name().to_str() {
                sweep_stale_temp(&path, name);
            }
            return Seen::Skip;
        }
        Decision::Hold if kind == EntryKind::File => {
            if let Some(portable) = portable_path(relative) {
                out.unobserved.insert(key(&portable));
            }
            return Seen::Skip;
        }
        Decision::Skip(reason) => {
            if let Some(code) = skip_code(reason) {
                out.skip(shown_path(relative), code);
            }
            return Seen::Skip;
        }
        Decision::Include if is_reparse(&metadata) => {
            out.skip(shown_path(relative), "symlink");
            return Seen::Skip;
        }
        Decision::Include => {}
        Decision::Hold | Decision::Git => return Seen::Skip,
    }
    let Some(portable) = portable_path(relative)
        .filter(|portable| portable::synced_path_problem(portable).is_none())
    else {
        out.skip(shown_path(relative), "unsupportedName");
        return Seen::Skip;
    };
    if kind == EntryKind::Directory {
        return Seen::Directory(path);
    }
    Seen::File {
        portable,
        path,
        metadata,
    }
}

fn hash_local(
    portable: &str,
    path: &Path,
    metadata: &std::fs::Metadata,
) -> std::io::Result<String> {
    if portable == PROJECT_META {
        return std::fs::read(path).map(|bytes| merge::meta_digest(&bytes).to_hex());
    }
    crate::checkpoint_capture::cached_capture_hash(path, portable, metadata)
        .map(|hash| hash.to_hex())
}

fn record_file(
    out: &mut Capture,
    prior: &Prior<'_>,
    portable: String,
    path: &Path,
    metadata: &std::fs::Metadata,
) {
    let file_key = key(&portable);
    if let Some(existing) = out.files.get(&file_key) {
        let wanted = prior.path(&file_key) == Some(portable.as_str()) && existing.path != portable;
        if !wanted {
            out.skip(portable, "duplicateName");
            return;
        }
        let displaced = existing.path.clone();
        out.files.remove(&file_key);
        out.skip(displaced, "duplicateName");
    }
    let stamp = FileStamp::of(metadata);
    let hash = match prior.reusable_hash(&file_key, &portable, &stamp) {
        Some(hash) => Ok(hash),
        None => hash_local(&portable, path, metadata),
    };
    match hash {
        Ok(hash) => {
            out.files.insert(
                file_key,
                LocalFile {
                    path: portable,
                    hash,
                    size: metadata.len(),
                    signature: stamp.settled_signature(SystemTime::now()),
                    stamp,
                },
            );
        }
        Err(_) => {
            out.unobserved.insert(file_key);
            out.skip(portable, "unreadable");
        }
    }
}

pub(crate) fn capture_with(
    root: &Path,
    base: &BTreeMap<String, BaseEntry>,
) -> Result<Capture, RoundError> {
    let meta = read_meta_value(root);
    let policy = policy_for(meta.as_ref());
    let prior = Prior::new(base);
    let mut out = Capture {
        meta,
        ..Capture::default()
    };
    let fields = policy.fields();
    std::fs::read_dir(root).map_err(|error| RoundError::Local(error.to_string()))?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(read) = std::fs::read_dir(&directory) else {
            if let Ok(relative) = directory.strip_prefix(root) {
                out.skip(shown_path(relative), "unreadable");
            }
            continue;
        };
        let mut children: Vec<_> = read.flatten().collect();
        children.sort_by_key(std::fs::DirEntry::file_name);
        for entry in children {
            match classify_entry(&mut out, root, &fields, &entry) {
                Seen::Skip => {}
                Seen::Directory(path) => pending.push(path),
                Seen::File {
                    portable,
                    path,
                    metadata,
                } => {
                    record_file(&mut out, &prior, portable, &path, &metadata);
                    if out.files.len() > MAX_FILES {
                        return Err(RoundError::TooManyFiles);
                    }
                }
            }
        }
    }
    out.policy = policy;
    Ok(out)
}

fn portable_path(relative: &Path) -> Option<String> {
    let mut portable = String::new();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if !portable.is_empty() {
            portable.push('/');
        }
        portable.push_str(part);
    }
    (!portable.is_empty()).then_some(portable)
}

pub(crate) fn resolve_target(root: &Path, portable: &str) -> Option<PathBuf> {
    if portable::synced_path_problem(portable).is_some() {
        return None;
    }
    let parts: Vec<&str> = portable.split('/').collect();
    let mut current = root.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || is_reparse(&metadata) {
                    return None;
                }
                let last = index + 1 == parts.len();
                if (last && !metadata.is_file()) || (!last && !metadata.is_dir()) {
                    return None;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return None,
        }
    }
    Some(native(root, portable))
}

fn on_disk(root: &Path, portable: &str) -> bool {
    match std::fs::symlink_metadata(native(root, portable)) {
        Ok(metadata) => !metadata.is_dir(),
        Err(error) => !matches!(
            error.kind(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
        ),
    }
}

pub(crate) async fn fetch_version<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
) -> Result<Option<Remote>, RoundError> {
    let Some((bytes, rev)) = store.get(&version_remote(cloud), MAX_VERSION_BYTES).await? else {
        return Ok(None);
    };
    let unreadable = || RoundError::Unreadable("the remote version record is unreadable".into());
    let probe: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| unreadable())?;
    if probe
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|v| v > u64::from(FORMAT_VERSION))
    {
        return Err(RoundError::NewerVersion);
    }
    let version: VersionManifest = serde_json::from_value(probe).map_err(|_| unreadable())?;
    if version.project != cloud {
        return Err(RoundError::Unreadable(
            "the remote version record names another project".into(),
        ));
    }
    if version.files.len() > MAX_FILES {
        return Err(RoundError::Unreadable(
            "the remote version record lists too many files".into(),
        ));
    }
    Ok(Some(Remote { version, rev }))
}

fn tidy_label(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
                && !portable::is_ignorable_code_point(*character)
        })
        .take(32)
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub(crate) fn sanitize_label(name: &str) -> String {
    tidy_label(name).unwrap_or_else(|| "conflict".into())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Slot {
    Free,
    Same,
    Taken,
}

fn conflict_path(
    portable: &str,
    label: &str,
    date: &str,
    slot: &dyn Fn(&str) -> Slot,
) -> (String, bool) {
    let (directory, name) = match portable.rsplit_once('/') {
        Some((directory, name)) => (Some(directory), name),
        None => (None, portable),
    };
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    };
    let build = |suffix: &str| {
        let file = match extension {
            Some(extension) => format!("{stem} ({suffix}).{extension}"),
            None => format!("{stem} ({suffix})"),
        };
        match directory {
            Some(directory) => format!("{directory}/{file}"),
            None => file,
        }
    };
    for attempt in 1..=999 {
        let suffix = if attempt == 1 {
            format!("{label} {date}")
        } else {
            format!("{label} {date} {attempt}")
        };
        let candidate = build(&suffix);
        match slot(&candidate) {
            Slot::Free => return (candidate, false),
            Slot::Same => return (candidate, true),
            Slot::Taken => {}
        }
    }
    (
        build(&format!("{label} {date} {:08x}", rand::random::<u32>())),
        false,
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Action {
    Keep,
    Carry,
    Upload,
    RemoteDelete,
    Download,
    LocalDelete,
    Conflict,
    MetaMerge,
}

struct Planned {
    key: String,
    local: Option<LocalFile>,
    remote: Option<FileRecord>,
    base: Option<BaseEntry>,
    action: Action,
    settled: bool,
    backed_off: bool,
}

struct RemoteView {
    usable: BTreeMap<String, FileRecord>,
    foreign: Vec<FileRecord>,
    foreign_keys: BTreeSet<String>,
}

fn split_remote(remote: Option<&Remote>, policy: &OwnedPolicy) -> RemoteView {
    let mut view = RemoteView {
        usable: BTreeMap::new(),
        foreign: Vec::new(),
        foreign_keys: BTreeSet::new(),
    };
    let Some(remote) = remote else {
        return view;
    };
    let fields = policy.fields();
    for record in &remote.version.files {
        let usable = portable::synced_path_problem(&record.path).is_none()
            && valid_hash(&record.hash)
            && record.size <= oleafly_core::exclude::MAX_SYNC_FILE_BYTES
            && record.rev.as_deref().is_none_or(super::store::valid_rev)
            && decide(
                Path::new(&record.path),
                &EntryInfo::file(record.size),
                &fields,
            ) == Decision::Include;
        let record_key = key(&record.path);
        if usable && !view.usable.contains_key(&record_key) {
            view.usable.insert(record_key, record.clone());
        } else {
            view.foreign_keys.insert(record_key);
            view.foreign.push(record.clone());
        }
    }
    view
}

struct PlanInput<'a> {
    capture: &'a Capture,
    remote: &'a RemoteView,
    base: &'a BTreeMap<String, BaseEntry>,
    root: &'a Path,
    options: &'a RoundOptions,
    failed: &'a BTreeMap<String, Failure>,
    now: u64,
}

fn decide_action(
    local: Option<&LocalFile>,
    remote: Option<&FileRecord>,
    base: Option<&BaseEntry>,
    is_meta: bool,
    restore_deleted: bool,
) -> Action {
    let local_hash = local.map(|file| file.hash.as_str());
    let remote_hash = remote.map(|record| record.hash.as_str());
    if local_hash == remote_hash {
        return Action::Keep;
    }
    let base_hash = base.map(|entry| entry.hash.as_str());
    let local_changed = local_hash != base_hash;
    let remote_changed = remote_hash != base_hash;
    match (
        local_changed,
        remote_changed,
        local.is_some(),
        remote.is_some(),
    ) {
        (true, false, true, _) | (true, true, true, false) => Action::Upload,
        (true, false, false, true) if restore_deleted => Action::Download,
        (true, false, false, _) => Action::RemoteDelete,
        (false, true, _, true) | (true, true, false, true) => Action::Download,
        (false, true, _, false) => Action::LocalDelete,
        (true, true, true, true) if is_meta => Action::MetaMerge,
        (true, true, true, true) => Action::Conflict,
        _ => Action::Keep,
    }
}

fn backed_off(input: &PlanInput<'_>, entry_key: &str, remote: Option<&FileRecord>) -> bool {
    remote.is_some_and(|record| {
        input.failed.get(entry_key).is_some_and(|failure| {
            failure.hash == record.hash && input.now.saturating_sub(failure.at_ms) < RETRY_FAILED_MS
        })
    })
}

fn plan(input: &PlanInput<'_>) -> Vec<Planned> {
    let base_by_key: BTreeMap<String, (&String, &BaseEntry)> = input
        .base
        .iter()
        .map(|(path, entry)| (key(path), (path, entry)))
        .collect();
    let mut keys: BTreeSet<&String> = BTreeSet::new();
    keys.extend(input.capture.files.keys());
    keys.extend(input.remote.usable.keys());
    keys.extend(base_by_key.keys());
    let mut planned = Vec::new();
    for entry_key in keys {
        let local = input.capture.files.get(entry_key);
        let remote_record = input.remote.usable.get(entry_key);
        let base_entry = base_by_key.get(entry_key);
        let foreign = remote_record.is_none() && input.remote.foreign_keys.contains(entry_key);
        let unobserved = local.is_none()
            && (input.capture.unobserved.contains(entry_key)
                || base_entry.is_some_and(|(path, _)| on_disk(input.root, path))
                || remote_record.is_some_and(|record| on_disk(input.root, &record.path)));
        let mut action = if unobserved || foreign {
            Action::Carry
        } else {
            decide_action(
                local,
                remote_record,
                base_entry.map(|(_, entry)| *entry),
                entry_key == PROJECT_META,
                input.options.restore_deleted,
            )
        };
        if input.options.dirty.contains(entry_key)
            && matches!(
                action,
                Action::Download | Action::LocalDelete | Action::MetaMerge
            )
        {
            action = Action::Carry;
        }
        let waiting = matches!(
            action,
            Action::Download | Action::Conflict | Action::MetaMerge
        ) && backed_off(input, entry_key, remote_record);
        if waiting {
            action = Action::Carry;
        }
        planned.push(Planned {
            key: entry_key.clone(),
            local: local.cloned(),
            remote: remote_record.cloned(),
            base: base_entry.map(|(_, entry)| (*entry).clone()),
            action,
            settled: foreign || waiting,
            backed_off: waiting,
        });
    }
    planned
}

fn mass_delete(planned: &[Planned], base_len: usize) -> Option<Hold> {
    let mut moved: BTreeMap<&str, usize> = BTreeMap::new();
    for item in planned {
        if item.action == Action::Upload && item.base.is_none() {
            if let Some(local) = &item.local {
                *moved.entry(local.hash.as_str()).or_default() += 1;
            }
        }
    }
    let mut count = 0;
    for item in planned {
        if item.action != Action::RemoteDelete {
            continue;
        }
        let reappeared = item
            .base
            .as_ref()
            .and_then(|entry| moved.get_mut(entry.hash.as_str()))
            .filter(|left| **left > 0);
        match reappeared {
            Some(left) => *left -= 1,
            None => count += 1,
        }
    }
    let all = count > 0 && count == base_len;
    (all || (count > MASS_DELETE_MIN && count * 2 > base_len)).then_some(Hold::MassDelete {
        count,
        total: base_len,
    })
}

fn staging_name(staging: &Path) -> PathBuf {
    staging.join(format!("{:032x}.part", rand::random::<u128>()))
}

pub(crate) fn sweep_staging(staging: &Path) {
    let Ok(entries) = std::fs::read_dir(staging) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > STALE_TEMP_AGE);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn move_into(staged: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(staged, target).is_ok() {
        return Ok(());
    }
    let parent = target
        .parent()
        .ok_or_else(|| std::io::Error::other("target has no parent"))?;
    let temp = parent.join(format!(".{:016x}.oleafly-cloud.tmp", rand::random::<u64>()));
    let copied = std::fs::copy(staged, &temp).and_then(|_| std::fs::rename(&temp, target));
    if copied.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    let _ = std::fs::remove_file(staged);
    copied
}

fn unchanged_since_capture(target: &Path, local: Option<&LocalFile>) -> bool {
    match (std::fs::symlink_metadata(target), local) {
        (Ok(metadata), Some(local)) => {
            metadata.is_file() && FileStamp::of(&metadata) == local.stamp
        }
        (Err(error), None) => error.kind() == std::io::ErrorKind::NotFound,
        _ => false,
    }
}

fn prune_empty_parents(root: &Path, path: &Path) {
    let mut current = path.parent();
    while let Some(directory) = current {
        if directory == root
            || !directory.starts_with(root)
            || std::fs::remove_dir(directory).is_err()
        {
            break;
        }
        current = directory.parent();
    }
}

fn trash_file(path: &Path, trash: &Path) -> Result<(), String> {
    if crate::os_trash::move_to_trash(path).is_ok() {
        return Ok(());
    }
    let name = path
        .file_name()
        .ok_or_else(|| "file has no name".to_string())?;
    let bucket = trash.join(format!("{}-{:08x}", now_ms(), rand::random::<u32>()));
    std::fs::create_dir_all(&bucket).map_err(|error| error.to_string())?;
    std::fs::rename(path, bucket.join(name)).map_err(|error| error.to_string())
}

struct Staged {
    key: String,
    path: PathBuf,
    hash: String,
    size: u64,
}

async fn stage_one<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    job_key: &str,
    record: &FileRecord,
    staging: &Path,
) -> Result<Staged, StoreError> {
    let temp = staging_name(staging);
    let pinned = record.rev.is_some();
    let mut limit = if pinned {
        record.size
    } else {
        oleafly_core::exclude::MAX_SYNC_FILE_BYTES
    };
    if job_key == PROJECT_META {
        limit = limit.min(oleafly_core::MAX_MANIFEST_BYTES);
    }
    let fetched = store
        .fetch_to(
            &file_remote(cloud, &record.path),
            record.rev.as_deref(),
            &temp,
            limit,
        )
        .await?
        .ok_or_else(|| StoreError::Verify(format!("{} is missing from dropbox", record.path)))?;
    let (hash, matches) = if job_key == PROJECT_META {
        match tokio::fs::read(&temp).await {
            Ok(bytes) => {
                let digest = merge::meta_digest(&bytes).to_hex();
                let matches = digest == record.hash || fetched.hash.to_hex() == record.hash;
                (digest, matches)
            }
            Err(error) => {
                let _ = tokio::fs::remove_file(&temp).await;
                return Err(StoreError::Io(error.to_string()));
            }
        }
    } else {
        let hash = fetched.hash.to_hex();
        let matches = hash == record.hash && fetched.size == record.size;
        (hash, matches)
    };
    if matches || !pinned {
        return Ok(Staged {
            key: job_key.to_string(),
            path: temp,
            hash,
            size: fetched.size,
        });
    }
    let _ = tokio::fs::remove_file(&temp).await;
    Err(StoreError::Verify(format!(
        "{} did not match its record",
        record.path
    )))
}

async fn stage_downloads<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    jobs: Vec<(String, FileRecord)>,
    staging: &Path,
) -> (Vec<Staged>, Vec<(String, StoreError)>) {
    let results: Vec<(String, Result<Staged, StoreError>)> = stream::iter(jobs)
        .map(|(job_key, record)| async move {
            let result = stage_one(store, cloud, &job_key, &record, staging).await;
            (job_key, result)
        })
        .buffer_unordered(DOWNLOAD_CONCURRENCY)
        .collect()
        .await;
    let mut staged = Vec::new();
    let mut failed = Vec::new();
    for (job_key, result) in results {
        match result {
            Ok(entry) => staged.push(entry),
            Err(error) => failed.push((job_key, error)),
        }
    }
    (staged, failed)
}

async fn stage_whole<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    jobs: Vec<(String, FileRecord)>,
    staging: &Path,
    folder: (usize, u64),
) -> (Vec<Staged>, Vec<(String, StoreError)>) {
    let (mut staged, rest) = stage_from_zip(store, cloud, jobs, staging, folder).await;
    let (more, failed) = stage_downloads(store, cloud, rest, staging).await;
    staged.extend(more);
    (staged, failed)
}

fn zip_is_faster(files: usize, folder_bytes: u64) -> bool {
    let one_by_one = (files as u64).saturating_mul(FILE_DOWNLOAD_MS);
    one_by_one > ZIP_SETUP_MS + folder_bytes / ZIP_BYTES_PER_MS
}

async fn stage_from_zip<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    jobs: Vec<(String, FileRecord)>,
    staging: &Path,
    (files, bytes): (usize, u64),
) -> (Vec<Staged>, Vec<(String, FileRecord)>) {
    if files > ZIP_MAX_FILES || bytes > ZIP_MAX_BYTES || !zip_is_faster(jobs.len(), bytes) {
        return (Vec::new(), jobs);
    }
    let archive = staging_name(staging);
    let limit = bytes + bytes / 16 + files as u64 * 1024 + 1024 * 1024;
    let remote_dir = format!("{}/files", project_remote(cloud));
    if !matches!(
        store.fetch_zip(&remote_dir, &archive, limit).await,
        Ok(true)
    ) {
        let _ = tokio::fs::remove_file(&archive).await;
        return (Vec::new(), jobs);
    }
    let fallback = jobs.clone();
    let dir = staging.to_path_buf();
    let unpacked = tauri::async_runtime::spawn_blocking(move || {
        let result = unpack_zip(&archive, jobs, &dir);
        let _ = std::fs::remove_file(&archive);
        result
    })
    .await;
    unpacked.unwrap_or_else(|_| (Vec::new(), fallback))
}

fn unpack_zip(
    archive: &Path,
    jobs: Vec<(String, FileRecord)>,
    staging: &Path,
) -> (Vec<Staged>, Vec<(String, FileRecord)>) {
    let opened = std::fs::File::open(archive)
        .ok()
        .and_then(|file| zip::ZipArchive::new(std::io::BufReader::new(file)).ok());
    let Some(mut zip) = opened else {
        return (Vec::new(), jobs);
    };
    let mut entries: BTreeMap<String, Option<usize>> = BTreeMap::new();
    for index in 0..zip.len() {
        let Some((_, inner)) = zip
            .name_for_index(index)
            .and_then(|name| name.split_once('/'))
        else {
            continue;
        };
        if inner.is_empty() || inner.ends_with('/') {
            continue;
        }
        entries
            .entry(key(inner))
            .and_modify(|slot| *slot = None)
            .or_insert(Some(index));
    }
    let mut staged = Vec::new();
    let mut rest = Vec::new();
    for (job_key, record) in jobs {
        let index = entries
            .get(&key(&record.path))
            .copied()
            .flatten()
            .filter(|_| job_key != PROJECT_META);
        match index.and_then(|index| unpack_entry(&mut zip, index, &job_key, &record, staging)) {
            Some(entry) => staged.push(entry),
            None => rest.push((job_key, record)),
        }
    }
    (staged, rest)
}

fn unpack_entry<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    index: usize,
    job_key: &str,
    record: &FileRecord,
    staging: &Path,
) -> Option<Staged> {
    let mut entry = zip.by_index(index).ok()?;
    if entry.size() != record.size {
        return None;
    }
    let temp = staging_name(staging);
    if !copy_verified(&mut entry, &temp, record) {
        let _ = std::fs::remove_file(&temp);
        return None;
    }
    Some(Staged {
        key: job_key.to_string(),
        path: temp,
        hash: record.hash.clone(),
        size: record.size,
    })
}

fn copy_verified(source: &mut impl std::io::Read, target: &Path, record: &FileRecord) -> bool {
    use std::io::Write;
    let Ok(mut file) = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
    else {
        return false;
    };
    let mut hasher = ContentHasher::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut size: u64 = 0;
    loop {
        let read = match source.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => return false,
        };
        size += read as u64;
        if size > record.size {
            return false;
        }
        hasher.update(&buffer[..read]);
        if file.write_all(&buffer[..read]).is_err() {
            return false;
        }
    }
    size == record.size && hasher.finish().to_hex() == record.hash && file.sync_all().is_ok()
}

async fn room_for(staging: &Path, needed: u64) -> bool {
    let staging = staging.to_path_buf();
    let available =
        tauri::async_runtime::spawn_blocking(move || fs4::available_space(&staging).ok())
            .await
            .ok()
            .flatten();
    available.is_none_or(|free| needed.saturating_add(DISK_HEADROOM_BYTES) <= free)
}

fn corrections(staged: &[Staged], view: &RemoteView) -> BTreeMap<String, FileRecord> {
    staged
        .iter()
        .filter_map(|entry| {
            let record = view.usable.get(&entry.key)?;
            (record.hash != entry.hash).then(|| FileRecord {
                hash: entry.hash.clone(),
                size: entry.size,
                rev: None,
                ..record.clone()
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|record| (key(&record.path), record))
        .collect()
}

#[derive(Default)]
struct Applied {
    downloaded: BTreeSet<String>,
    deleted: BTreeSet<String>,
    conflict_copies: BTreeMap<String, String>,
    merged_meta: Option<(String, Vec<u8>)>,
    changed: BTreeSet<String>,
    failed: BTreeSet<String>,
}

struct ApplyItem {
    key: String,
    action: Action,
    local: Option<LocalFile>,
    remote: Option<FileRecord>,
    copy: Option<(String, bool)>,
}

struct ApplyJob {
    root: PathBuf,
    trash: PathBuf,
    lock_id: Option<String>,
    staged: BTreeMap<String, PathBuf>,
    items: Vec<ApplyItem>,
    meta_base: Option<serde_json::Value>,
}

fn write_meta(lock_id: Option<&str>, target: &Path, bytes: &[u8]) -> Result<(), String> {
    match lock_id {
        Some(id) => crate::project::with_project_metadata_lock_held(id, || {
            crate::sandbox::atomic_write(target, bytes)
        }),
        None => crate::sandbox::atomic_write(target, bytes),
    }
}

fn apply_download(job: &ApplyJob, item: &ApplyItem, temp: &Path, applied: &mut Applied) {
    let Some(record) = &item.remote else {
        return;
    };
    let local = item.local.as_ref();
    let portable_path = local.map_or(record.path.as_str(), |file| file.path.as_str());
    let Some(target) = resolve_target(&job.root, portable_path) else {
        applied.failed.insert(item.key.clone());
        return;
    };
    if !unchanged_since_capture(&target, local) {
        return;
    }
    let placed = if item.key == PROJECT_META {
        place_meta(
            temp,
            &target,
            local.and_then(|_| read_json(&target)).as_ref(),
            job.lock_id.as_deref(),
        )
    } else {
        move_into(temp, &target).map_err(|error| error.to_string())
    };
    if placed.is_ok() {
        apply_exec(&target, portable_path, record.exec);
        applied.downloaded.insert(item.key.clone());
        applied.changed.insert(portable_path.to_string());
    } else {
        applied.failed.insert(item.key.clone());
    }
}

fn apply_delete(job: &ApplyJob, item: &ApplyItem, applied: &mut Applied) {
    let Some(local) = &item.local else {
        return;
    };
    let Some(target) = resolve_target(&job.root, &local.path) else {
        return;
    };
    if !unchanged_since_capture(&target, Some(local)) {
        return;
    }
    if trash_file(&target, &job.trash).is_ok() {
        prune_empty_parents(&job.root, &target);
        applied.deleted.insert(item.key.clone());
        applied.changed.insert(local.path.clone());
    }
}

fn apply_conflict(job: &ApplyJob, item: &ApplyItem, temp: &Path, applied: &mut Applied) {
    let Some((copy, reuse)) = &item.copy else {
        return;
    };
    if *reuse {
        applied
            .conflict_copies
            .insert(item.key.clone(), copy.clone());
        return;
    }
    let Some(target) = resolve_target(&job.root, copy).filter(|target| !target.exists()) else {
        return;
    };
    if move_into(temp, &target).is_err() {
        return;
    }
    if let Some(record) = &item.remote {
        apply_exec(&target, copy, record.exec);
    }
    applied
        .conflict_copies
        .insert(item.key.clone(), copy.clone());
    applied.changed.insert(copy.clone());
}

fn apply_meta_merge(job: &ApplyJob, item: &ApplyItem, temp: &Path, applied: &mut Applied) {
    let Some(local) = &item.local else {
        return;
    };
    let target = job.root.join(PROJECT_META);
    let (Some(incoming), Some(current)) = (read_json(temp), read_json(&target)) else {
        return;
    };
    if !unchanged_since_capture(&target, Some(local)) {
        return;
    }
    let base = job.meta_base.as_ref().map(merge::portable_meta);
    let merged = merge::merge3(
        base.as_ref(),
        &merge::portable_meta(&current),
        &merge::portable_meta(&incoming),
    );
    let written = merge::with_device_fields(&merged, Some(&current));
    let Ok(bytes) = merge::pretty(&written) else {
        return;
    };
    if write_meta(job.lock_id.as_deref(), &target, &bytes).is_ok() {
        applied.merged_meta = Some((merge::meta_digest(&bytes).to_hex(), bytes));
        applied.changed.insert(PROJECT_META.to_string());
    }
}

fn apply_item(job: &ApplyJob, item: &ApplyItem, temp: Option<&Path>, applied: &mut Applied) {
    match (&item.action, temp) {
        (Action::Download, Some(temp)) => apply_download(job, item, temp, applied),
        (Action::LocalDelete, _) => apply_delete(job, item, applied),
        (Action::Conflict, Some(temp)) => apply_conflict(job, item, temp, applied),
        (Action::MetaMerge, Some(temp)) => apply_meta_merge(job, item, temp, applied),
        _ => {}
    }
}

fn apply_local(mut job: ApplyJob) -> Applied {
    let mut applied = Applied::default();
    let mut staged = std::mem::take(&mut job.staged);
    if job.root.is_dir() {
        for chunk in job.items.chunks(APPLY_BATCH) {
            let lock = match job.lock_id.as_deref() {
                Some(id) => match crate::worktree_lock::ProjectWorktreeLock::try_exclusive(id) {
                    Ok(Some(lock)) => Some(lock),
                    _ => break,
                },
                None => None,
            };
            for item in chunk {
                let temp = staged.remove(&item.key);
                apply_item(&job, item, temp.as_deref(), &mut applied);
                if let Some(temp) = temp {
                    let _ = std::fs::remove_file(temp);
                }
            }
            drop(lock);
        }
    }
    for leftover in staged.values() {
        let _ = std::fs::remove_file(leftover);
    }
    applied
}

pub(crate) fn read_json(path: &Path) -> Option<serde_json::Value> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn place_meta(
    temp: &Path,
    target: &Path,
    local: Option<&serde_json::Value>,
    lock_id: Option<&str>,
) -> Result<(), String> {
    let incoming = read_json(temp).ok_or("the incoming project.json is unreadable")?;
    let merged = merge::with_device_fields(&incoming, local);
    let bytes = merge::pretty(&merged)?;
    write_meta(lock_id, target, &bytes)
}

struct UploadJob {
    key: String,
    path: String,
    meta: Option<Vec<u8>>,
    size: u64,
    replaces: u64,
    exec: bool,
    local_hash: Option<String>,
    signature: Option<String>,
}

impl UploadJob {
    fn from_local(item_key: &str, local: &LocalFile, remote: Option<&FileRecord>) -> Self {
        Self {
            key: item_key.to_string(),
            path: local.path.clone(),
            meta: None,
            size: local.size,
            replaces: remote.map_or(0, |record| record.size),
            exec: remote.is_some_and(|record| record.exec),
            local_hash: Some(local.hash.clone()),
            signature: local.signature.clone(),
        }
    }
}

async fn upload_meta<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    root: &Path,
    job: &UploadJob,
) -> Result<FileRecord, StoreError> {
    let bytes = match &job.meta {
        Some(bytes) => bytes.clone(),
        None => tokio::fs::read(native(root, &job.path))
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?,
    };
    let digest = merge::meta_digest(&bytes).to_hex();
    let size = bytes.len() as u64;
    let rev = store
        .put(&file_remote(cloud, &job.path), bytes, WriteMode::Overwrite)
        .await?;
    Ok(FileRecord {
        path: job.path.clone(),
        hash: digest,
        size,
        exec: false,
        rev: Some(rev),
        extra: serde_json::Map::new(),
    })
}

async fn prepare_upload(root: &Path, job: &UploadJob) -> Result<bool, StoreError> {
    let checked = {
        let root = root.to_path_buf();
        let path = job.path.clone();
        tauri::async_runtime::spawn_blocking(move || resolve_target(&root, &path).is_some())
            .await
            .unwrap_or(false)
    };
    if !checked {
        return Err(StoreError::Io(format!(
            "{} is not a regular file in the project",
            job.path
        )));
    }
    Ok(tokio::fs::symlink_metadata(native(root, &job.path))
        .await
        .map_or(job.exec, |metadata| executable(&metadata, job.exec)))
}

fn manifest_files(
    records: &BTreeMap<String, FileRecord>,
    foreign: &[FileRecord],
) -> Vec<FileRecord> {
    let mut files: Vec<FileRecord> = records.values().cloned().collect();
    files.extend(foreign.iter().cloned());
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}

fn same_files(left: &[FileRecord], right: &[FileRecord]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(a, b)| {
            a.path == b.path
                && a.hash == b.hash
                && a.size == b.size
                && a.exec == b.exec
                && a.rev == b.rev
        })
}

struct Publisher<'a, S: CloudStore> {
    store: &'a S,
    cloud: ProjectId,
    context: &'a SyncContext,
    clock: HlcClock,
    rev: Option<String>,
    overwrite: bool,
    published: Vec<FileRecord>,
    name: String,
    manifest: serde_json::Value,
    extra: serde_json::Map<String, serde_json::Value>,
}

impl<S: CloudStore> Publisher<'_, S> {
    async fn publish(&mut self, files: Vec<FileRecord>) -> Result<bool, StoreError> {
        if self.rev.is_some() && same_files(&files, &self.published) {
            return Ok(false);
        }
        let stamp = Stamp::new(self.clock.tick(now_ms()), self.context.device);
        let version = VersionManifest {
            v: FORMAT_VERSION,
            project: self.cloud,
            name: self.name.clone(),
            manifest: self.manifest.clone(),
            stamp,
            device: Some(self.context.device_name.clone()),
            files: files.clone(),
            extra: self.extra.clone(),
        };
        let bytes =
            serde_json::to_vec(&version).map_err(|error| StoreError::Io(error.to_string()))?;
        let mode = match &self.rev {
            Some(rev) => WriteMode::Update(rev.clone()),
            None if self.overwrite => WriteMode::Overwrite,
            None => WriteMode::Add,
        };
        let rev = self
            .store
            .put(&version_remote(self.cloud), bytes, mode)
            .await?;
        self.rev = Some(rev);
        self.published = files;
        Ok(true)
    }
}

fn observe_remote(clock: &mut HlcClock, remote: &Remote) {
    let wall = remote.version.stamp.hlc.wall_ms();
    if wall <= now_ms().saturating_add(MAX_FUTURE_SKEW_MS) {
        clock.observe(remote.version.stamp.hlc);
    }
}

fn base_entry(record: &FileRecord) -> BaseEntry {
    BaseEntry {
        hash: record.hash.clone(),
        size: record.size,
        stamp: None,
    }
}

fn utc_date() -> String {
    crate::project_ids::rfc3339_from_unix_ms(now_ms())[..10].to_string()
}

async fn capture_locked(
    env: &RoundEnv,
    base: &BTreeMap<String, BaseEntry>,
) -> Result<Option<Capture>, RoundError> {
    let root = env.root.clone();
    let lock_id = env.lock_id.clone();
    let base = base.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = match &lock_id {
            Some(id) => match crate::worktree_lock::ProjectWorktreeLock::try_shared(id) {
                Ok(Some(lock)) => Some(lock),
                Ok(None) => return Ok(None),
                Err(error) => return Err(RoundError::Local(error)),
            },
            None => None,
        };
        if !root.is_dir() {
            return Ok(None);
        }
        capture_with(&root, &base).map(Some)
    })
    .await
    .map_err(|error| RoundError::Local(error.to_string()))?
}

async fn read_tombstone<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
) -> Result<Option<String>, RoundError> {
    Ok(store
        .get(&tombstone_remote(cloud), 64 * 1024)
        .await?
        .map(|(bytes, _)| {
            serde_json::from_slice::<Tombstone>(&bytes)
                .ok()
                .and_then(|tombstone| tidy_label(&tombstone.device))
                .unwrap_or_default()
        }))
}

fn quiet_round(capture: &Capture, project: &ProjectState, options: &RoundOptions) -> bool {
    let now = now_ms();
    !options.forced()
        && capture.matches_base(&project.base)
        && project.pending_deletes.is_empty()
        && project.hold.is_none()
        && !project
            .failed
            .values()
            .any(|failure| now.saturating_sub(failure.at_ms) >= RETRY_FAILED_MS)
}

struct Settled {
    base: BTreeMap<String, (String, BaseEntry)>,
    records: BTreeMap<String, FileRecord>,
    uploads: Vec<UploadJob>,
    incomplete: bool,
}

struct SettleInput<'a> {
    planned: &'a [Planned],
    applied: &'a Applied,
    captured: &'a Capture,
    fixes: &'a BTreeMap<String, FileRecord>,
    options: &'a RoundOptions,
}

fn settle_keep(item: &Planned, out: &mut Settled) {
    match (&item.remote, &item.local) {
        (Some(record), Some(local)) => {
            let entry = BaseEntry {
                stamp: local.signature.clone(),
                ..base_entry(record)
            };
            out.base
                .insert(item.key.clone(), (local.path.clone(), entry));
        }
        _ => {
            out.base.remove(&item.key);
        }
    }
}

fn settle_carry(input: &SettleInput<'_>, item: &Planned, out: &mut Settled) {
    let excluded = item.local.is_none()
        && !input.captured.unobserved.contains(&item.key)
        && !input.options.dirty.contains(&item.key);
    if excluded {
        out.base.remove(&item.key);
        return;
    }
    if item.settled {
        return;
    }
    let remote_hash = item.remote.as_ref().map(|record| record.hash.as_str());
    let base_hash = item.base.as_ref().map(|entry| entry.hash.as_str());
    let local_hash = item.local.as_ref().map(|file| file.hash.as_str());
    if remote_hash != base_hash || (item.local.is_some() && local_hash != base_hash) {
        out.incomplete = true;
    }
}

fn settle_download(input: &SettleInput<'_>, item: &Planned, out: &mut Settled) {
    match &item.remote {
        Some(record) if input.applied.downloaded.contains(&item.key) => {
            let agreed = input.fixes.get(&item.key).unwrap_or(record);
            let path = item
                .local
                .as_ref()
                .map_or_else(|| record.path.clone(), |file| file.path.clone());
            out.base
                .insert(item.key.clone(), (path, base_entry(agreed)));
            if let Some(fix) = input.fixes.get(&item.key) {
                out.records.insert(item.key.clone(), fix.clone());
            }
        }
        _ => out.incomplete = true,
    }
}

fn settle_conflict(input: &SettleInput<'_>, item: &Planned, out: &mut Settled) {
    let copy = input.applied.conflict_copies.get(&item.key);
    let (Some(copy), Some(record), Some(local)) = (copy, &item.remote, &item.local) else {
        out.incomplete = true;
        return;
    };
    out.base
        .insert(item.key.clone(), (local.path.clone(), base_entry(record)));
    let copy_key = key(copy);
    if !input.captured.files.contains_key(&copy_key) {
        out.uploads.push(UploadJob {
            key: copy_key,
            path: copy.clone(),
            meta: None,
            size: record.size,
            replaces: 0,
            exec: record.exec,
            local_hash: None,
            signature: None,
        });
    }
    out.uploads
        .push(UploadJob::from_local(&item.key, local, Some(record)));
}

fn settle_meta(input: &SettleInput<'_>, item: &Planned, out: &mut Settled) {
    let (Some((_, bytes)), Some(record)) = (&input.applied.merged_meta, &item.remote) else {
        out.incomplete = true;
        return;
    };
    out.base.insert(
        item.key.clone(),
        (PROJECT_META.to_string(), base_entry(record)),
    );
    out.uploads.push(UploadJob {
        key: item.key.clone(),
        path: PROJECT_META.to_string(),
        meta: Some(bytes.clone()),
        size: bytes.len() as u64,
        replaces: record.size,
        exec: false,
        local_hash: None,
        signature: None,
    });
}

fn settle(
    input: &SettleInput<'_>,
    previous: &BTreeMap<String, BaseEntry>,
    view: &RemoteView,
) -> Settled {
    let mut out = Settled {
        base: previous
            .iter()
            .map(|(path, entry)| (key(path), (path.clone(), entry.clone())))
            .collect(),
        records: view.usable.clone(),
        uploads: Vec::new(),
        incomplete: false,
    };
    for item in input.planned {
        match item.action {
            Action::Keep => settle_keep(item, &mut out),
            Action::Carry => settle_carry(input, item, &mut out),
            Action::Download => settle_download(input, item, &mut out),
            Action::LocalDelete => {
                if input.applied.deleted.contains(&item.key) {
                    out.base.remove(&item.key);
                } else {
                    out.incomplete = true;
                }
            }
            Action::Upload => {
                if let Some(local) = &item.local {
                    out.uploads.push(UploadJob::from_local(
                        &item.key,
                        local,
                        item.remote.as_ref(),
                    ));
                }
            }
            Action::Conflict => settle_conflict(input, item, &mut out),
            Action::MetaMerge => settle_meta(input, item, &mut out),
            Action::RemoteDelete => {}
        }
    }
    let mut seen = BTreeSet::new();
    out.uploads.retain(|job| seen.insert(job.key.clone()));
    out
}

fn upload_skip_code(error: &StoreError) -> &'static str {
    match error {
        StoreError::Rejected(_) => "unsupportedName",
        StoreError::Io(_) => "unreadable",
        _ => "uploadFailed",
    }
}

#[derive(Default)]
struct UploadRun {
    uploaded: BTreeMap<String, FileRecord>,
    published: BTreeSet<String>,
    skipped: Vec<SkippedFile>,
    error: Option<RoundError>,
}

enum Loaded {
    Remote(Option<Remote>),
    Removed,
}

struct Round<'a, S: CloudStore> {
    store: &'a S,
    env: &'a RoundEnv,
    cloud: ProjectId,
    options: &'a RoundOptions,
    project: ProjectState,
    outcome: SyncOutcome,
    skipped: Vec<SkippedFile>,
    failures: BTreeMap<String, String>,
    error: Option<RoundError>,
    late_error: Option<RoundError>,
    incomplete: bool,
}

impl<S: CloudStore> Round<'_, S> {
    fn finish_early(self, clock: &HlcClock) -> RoundResult {
        RoundResult {
            outcome: self.outcome,
            project: self.project,
            hlc: clock.last().raw(),
            error: None,
        }
    }

    async fn quiet(&mut self, captured: &Capture) -> Result<bool, RoundError> {
        if !quiet_round(captured, &self.project, self.options) {
            return Ok(false);
        }
        if !self.project.remote_dirty {
            return Ok(true);
        }
        let Some(rev) = self.project.remote_rev.clone() else {
            return Ok(false);
        };
        let current = self.store.metadata(&version_remote(self.cloud)).await?;
        if current.is_some_and(|meta| meta.rev == rev) {
            self.project.remote_dirty = false;
            return Ok(true);
        }
        Ok(false)
    }

    async fn remote(&mut self) -> Result<Loaded, RoundError> {
        let remote = match fetch_version(self.store, self.cloud).await {
            Ok(remote) => remote,
            Err(RoundError::Unreadable(_)) if self.options.replace_remote => None,
            Err(error) => return Err(error),
        };
        if remote.is_some() {
            return Ok(Loaded::Remote(remote));
        }
        if !self.options.replace_remote {
            if let Some(device) = read_tombstone(self.store, self.cloud).await? {
                self.removed(device);
                return Ok(Loaded::Removed);
            }
        }
        self.project.base.clear();
        self.project.meta_base = None;
        self.project.remote_rev = None;
        self.project.pending_deletes.clear();
        Ok(Loaded::Remote(None))
    }

    fn removed(&mut self, device: String) {
        let project = &mut self.project;
        project.paused = true;
        project.removed_by = Some(device);
        project.base.clear();
        project.meta_base = None;
        project.remote_rev = None;
        project.remote_dirty = false;
        project.hold = None;
        project.pending_deletes.clear();
        self.outcome.removed_by = project.removed_by.clone();
    }

    fn limit_uploads(&mut self, planned: &mut [Planned]) {
        if self.options.allow_uploads {
            return;
        }
        for item in planned {
            if matches!(
                item.action,
                Action::Upload | Action::Conflict | Action::MetaMerge
            ) {
                item.action = Action::Carry;
                self.outcome.quota_hit = true;
            }
        }
    }

    fn conflict_names(
        &self,
        planned: &[Planned],
        captured: &Capture,
        view: &RemoteView,
        label: &str,
    ) -> BTreeMap<String, (String, bool)> {
        let date = utc_date();
        let mut reserved: BTreeSet<String> = BTreeSet::new();
        let mut names = BTreeMap::new();
        for item in planned {
            let (Action::Conflict, Some(local), Some(record)) =
                (&item.action, &item.local, &item.remote)
            else {
                continue;
            };
            let slot = |candidate: &str| {
                let candidate_key = key(candidate);
                if reserved.contains(&candidate_key) {
                    return Slot::Taken;
                }
                if let Some(existing) = captured.files.get(&candidate_key) {
                    return if existing.hash == record.hash && existing.path == candidate {
                        Slot::Same
                    } else {
                        Slot::Taken
                    };
                }
                let taken = view.usable.contains_key(&candidate_key)
                    || view.foreign_keys.contains(&candidate_key)
                    || on_disk(&self.env.root, candidate);
                if taken {
                    Slot::Taken
                } else {
                    Slot::Free
                }
            };
            let (name, reuse) = conflict_path(&local.path, label, &date, &slot);
            reserved.insert(key(&name));
            names.insert(item.key.clone(), (name, reuse));
        }
        names
    }

    async fn stage(&mut self, planned: &[Planned], folder: (usize, u64)) -> Vec<Staged> {
        let downloads: Vec<(String, FileRecord)> = planned
            .iter()
            .filter(|item| {
                matches!(
                    item.action,
                    Action::Download | Action::Conflict | Action::MetaMerge
                )
            })
            .filter_map(|item| item.remote.clone().map(|record| (item.key.clone(), record)))
            .collect();
        if downloads.is_empty() {
            return Vec::new();
        }
        if let Err(error) = tokio::fs::create_dir_all(&self.env.staging).await {
            self.incomplete = true;
            self.late_error = Some(RoundError::Local(error.to_string()));
            return Vec::new();
        }
        let needed: u64 = downloads.iter().map(|(_, record)| record.size).sum();
        if !room_for(&self.env.staging, needed).await {
            self.incomplete = true;
            self.late_error = Some(RoundError::DiskFull);
            return Vec::new();
        }
        let records: BTreeMap<String, FileRecord> = downloads.iter().cloned().collect();
        let whole = zip_is_faster(downloads.len(), folder.1)
            && room_for(&self.env.staging, needed.saturating_add(folder.1)).await;
        let (staged, failed) = if whole {
            stage_whole(self.store, self.cloud, downloads, &self.env.staging, folder).await
        } else {
            stage_downloads(self.store, self.cloud, downloads, &self.env.staging).await
        };
        for (job_key, error) in failed {
            self.incomplete = true;
            if error.ends_round() {
                if self.error.is_none() {
                    self.error = Some(RoundError::Store(error));
                }
                continue;
            }
            if let Some(record) = records.get(&job_key) {
                if !matches!(error, StoreError::Io(_)) {
                    self.failures.insert(job_key.clone(), record.hash.clone());
                }
                self.skipped.push(SkippedFile {
                    path: record.path.clone(),
                    reason: "downloadFailed".into(),
                });
            }
        }
        staged
    }

    async fn apply(
        &mut self,
        planned: &[Planned],
        staged: Vec<Staged>,
        names: BTreeMap<String, (String, bool)>,
    ) -> Result<Applied, RoundError> {
        let items: Vec<ApplyItem> = planned
            .iter()
            .filter(|item| {
                matches!(
                    item.action,
                    Action::Download | Action::LocalDelete | Action::Conflict | Action::MetaMerge
                )
            })
            .map(|item| ApplyItem {
                key: item.key.clone(),
                action: item.action.clone(),
                local: item.local.clone(),
                remote: item.remote.clone(),
                copy: names.get(&item.key).cloned(),
            })
            .collect();
        if items.is_empty() {
            for staged in staged {
                let _ = tokio::fs::remove_file(&staged.path).await;
            }
            return Ok(Applied::default());
        }
        let job = ApplyJob {
            root: self.env.root.clone(),
            trash: self.env.trash.clone(),
            lock_id: self.env.lock_id.clone(),
            staged: staged
                .into_iter()
                .map(|staged| (staged.key, staged.path))
                .collect(),
            items,
            meta_base: self.project.meta_base.clone(),
        };
        let applied = tauri::async_runtime::spawn_blocking(move || apply_local(job))
            .await
            .map_err(|error| RoundError::Local(error.to_string()))?;
        for item_key in &applied.failed {
            if let Some(record) = planned
                .iter()
                .find(|item| &item.key == item_key)
                .and_then(|item| item.remote.as_ref())
            {
                self.failures.insert(item_key.clone(), record.hash.clone());
                self.skipped.push(SkippedFile {
                    path: record.path.clone(),
                    reason: "downloadFailed".into(),
                });
            }
        }
        Ok(applied)
    }

    fn within_budget<'j>(&mut self, uploads: &'j [UploadJob]) -> Vec<&'j UploadJob> {
        let mut free = self.options.free_bytes;
        let mut queue = Vec::new();
        for job in uploads {
            if let Some(left) = free {
                let cost = job.size.saturating_sub(job.replaces);
                if cost > left {
                    self.outcome.quota_hit = true;
                    continue;
                }
                free = Some(left - cost);
            }
            queue.push(job);
        }
        queue
    }

    fn take_result(
        &mut self,
        job: &UploadJob,
        result: Result<FileRecord, StoreError>,
        run: &mut UploadRun,
    ) -> bool {
        match result {
            Ok(record) => {
                run.uploaded.insert(job.key.clone(), record);
                false
            }
            Err(StoreError::QuotaFull) => {
                self.outcome.quota_hit = true;
                true
            }
            Err(error) if error.ends_round() => {
                run.error.get_or_insert(RoundError::Store(error));
                true
            }
            Err(error) => {
                run.skipped.push(SkippedFile {
                    path: job.path.clone(),
                    reason: upload_skip_code(&error).into(),
                });
                false
            }
        }
    }

    async fn upload_chunk(&mut self, chunk: &[&UploadJob], run: &mut UploadRun) -> bool {
        let mut stop = false;
        let mut batch: Vec<(&UploadJob, bool)> = Vec::new();
        for job in chunk {
            if job.path == PROJECT_META {
                let result = upload_meta(self.store, self.cloud, &self.env.root, job).await;
                stop |= self.take_result(job, result, run);
                continue;
            }
            match prepare_upload(&self.env.root, job).await {
                Ok(exec) => batch.push((job, exec)),
                Err(error) => stop |= self.take_result(job, Err(error), run),
            }
        }
        if stop || batch.is_empty() {
            return stop;
        }
        let files: Vec<BatchFile> = batch
            .iter()
            .map(|(job, _)| BatchFile {
                remote: file_remote(self.cloud, &job.path),
                local: native(&self.env.root, &job.path),
            })
            .collect();
        let results = self.store.put_paths(&files).await;
        for ((job, exec), result) in batch.iter().zip(results) {
            let record = result.map(|uploaded| FileRecord {
                path: job.path.clone(),
                hash: uploaded.hash.to_hex(),
                size: uploaded.size,
                exec: *exec,
                rev: Some(uploaded.rev),
                extra: serde_json::Map::new(),
            });
            stop |= self.take_result(job, record, run);
        }
        stop
    }

    async fn upload(
        &mut self,
        uploads: &[UploadJob],
        view: &RemoteView,
        publisher: &mut Publisher<'_, S>,
    ) -> UploadRun {
        let mut run = UploadRun::default();
        if self.error.is_some() {
            return run;
        }
        let queue = self.within_budget(uploads);
        let mut next = 0;
        while next < queue.len() {
            if self.options.cancelled() {
                break;
            }
            let interval = PUBLISH_EVERY_FILES.max((view.usable.len() + run.uploaded.len()) / 4);
            let mut end = next;
            let mut bytes = 0u64;
            while end < queue.len() && end - next < interval && bytes < PUBLISH_EVERY_BYTES {
                bytes += queue[end].size;
                end += 1;
            }
            let stop = self.upload_chunk(&queue[next..end], &mut run).await;
            next = end;
            if stop || next >= queue.len() {
                break;
            }
            let mut interim = view.usable.clone();
            interim.extend(
                run.uploaded
                    .iter()
                    .map(|(record_key, record)| (record_key.clone(), record.clone())),
            );
            match publisher
                .publish(manifest_files(&interim, &view.foreign))
                .await
            {
                Ok(_) => run.published.extend(run.uploaded.keys().cloned()),
                Err(error) => {
                    run.error = Some(RoundError::Store(error));
                    break;
                }
            }
        }
        run
    }

    async fn delete_remote(&mut self, deletions: &[&Planned], final_files: &[FileRecord]) {
        let live: BTreeSet<String> = final_files.iter().map(|record| key(&record.path)).collect();
        let mut pending = self.project.pending_deletes.clone();
        pending.extend(pending_from(deletions));
        pending.sort_by(|left, right| left.path.cmp(&right.path));
        pending.dedup_by(|left, right| left.path == right.path);
        pending.retain(|entry| !live.contains(&key(&entry.path)));
        let batch: Vec<BatchDelete> = pending
            .iter()
            .map(|entry| BatchDelete {
                remote: file_remote(self.cloud, &entry.path),
                parent_rev: entry.rev.clone(),
            })
            .collect();
        let results = self.store.delete_paths(&batch).await;
        let mut still_pending = Vec::new();
        for (entry, result) in pending.into_iter().zip(results) {
            if let Err(error) = result {
                if error.ends_round() && self.error.is_none() {
                    self.error = Some(RoundError::Store(error));
                }
                still_pending.push(entry);
            }
        }
        self.project.pending_deletes = still_pending;
    }

    fn record_failures(&mut self, planned: &[Planned], applied: &Applied) {
        let now = now_ms();
        let mut failed = std::mem::take(&mut self.project.failed);
        failed.retain(|item_key, failure| {
            planned.iter().any(|item| {
                &item.key == item_key
                    && !applied.downloaded.contains(item_key)
                    && item
                        .remote
                        .as_ref()
                        .is_some_and(|record| record.hash == failure.hash)
            })
        });
        for (item_key, hash) in std::mem::take(&mut self.failures) {
            failed.insert(item_key, Failure { hash, at_ms: now });
        }
        self.project.failed = failed;
    }

    fn record_skips(&mut self, captured: &Capture, planned: &[Planned], uploads: &UploadRun) {
        let mut skipped = captured.skipped.clone();
        skipped.extend(
            planned
                .iter()
                .filter(|item| item.backed_off)
                .filter_map(|item| {
                    item.remote.as_ref().map(|record| SkippedFile {
                        path: record.path.clone(),
                        reason: "downloadFailed".into(),
                    })
                }),
        );
        skipped.append(&mut self.skipped);
        skipped.extend(uploads.skipped.iter().cloned());
        self.outcome.skipped = skipped.len();
        self.project.skipped = skipped.len();
        skipped.truncate(MAX_LISTED_SKIPS);
        self.project.skipped_files = skipped;
    }

    fn record_conflicts(&mut self, applied: &Applied) {
        self.outcome.conflicts = applied.conflict_copies.len();
        self.project.conflicts += applied.conflict_copies.len();
        for copy in applied.conflict_copies.values() {
            if !self.project.conflict_copies.contains(copy) {
                self.project.conflict_copies.push(copy.clone());
            }
        }
        let overflow = self
            .project
            .conflict_copies
            .len()
            .saturating_sub(MAX_CONFLICT_COPIES);
        self.project.conflict_copies.drain(..overflow);
    }
}

fn refresh_local_skips(project: &mut ProjectState, captured: &Capture) {
    let mut skipped = captured.skipped.clone();
    skipped.extend(
        project
            .skipped_files
            .iter()
            .filter(|file| matches!(file.reason.as_str(), "downloadFailed" | "uploadFailed"))
            .cloned(),
    );
    project.skipped = skipped.len();
    skipped.truncate(MAX_LISTED_SKIPS);
    project.skipped_files = skipped;
}

fn pending_from(deletions: &[&Planned]) -> Vec<PendingDelete> {
    deletions
        .iter()
        .filter_map(|item| {
            item.remote.as_ref().map(|record| PendingDelete {
                path: record.path.clone(),
                rev: record.rev.clone(),
            })
        })
        .collect()
}

fn publisher_name(captured: &Capture, context: &SyncContext) -> String {
    captured
        .meta
        .as_ref()
        .and_then(|meta| meta.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map_or_else(
            || context.fallback_name.clone(),
            |name| name.chars().take(200).collect(),
        )
}

async fn agreed_meta(root: &Path, project: &ProjectState) -> Option<serde_json::Value> {
    let agreed = project.base.get(PROJECT_META)?.hash.clone();
    let bytes = tokio::fs::read(root.join(PROJECT_META)).await.ok()?;
    (merge::meta_digest(&bytes).to_hex() == agreed)
        .then(|| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .flatten()
        .map(|value| merge::portable_meta(&value))
}

fn publisher_for<'a, S: CloudStore>(
    store: &'a S,
    context: &'a SyncContext,
    cloud: ProjectId,
    clock: HlcClock,
    remote: Option<&Remote>,
    captured: &Capture,
    options: &RoundOptions,
) -> Publisher<'a, S> {
    Publisher {
        store,
        cloud,
        context,
        clock,
        rev: remote.map(|remote| remote.rev.clone()),
        overwrite: options.replace_remote && remote.is_none(),
        published: remote
            .map(|remote| remote.version.files.clone())
            .unwrap_or_default(),
        name: publisher_name(captured, context),
        manifest: captured
            .meta
            .as_ref()
            .map(merge::portable_meta)
            .unwrap_or_default(),
        extra: remote
            .map(|remote| remote.version.extra.clone())
            .unwrap_or_default(),
    }
}

fn keep_unfinished(
    records: &mut BTreeMap<String, FileRecord>,
    run: &UploadRun,
    uploads: &[UploadJob],
    view: &RemoteView,
) -> bool {
    for (record_key, record) in &run.uploaded {
        records.insert(record_key.clone(), record.clone());
    }
    let mut unfinished = false;
    for job in uploads {
        if run.uploaded.contains_key(&job.key) {
            continue;
        }
        unfinished = true;
        match view.usable.get(&job.key) {
            Some(record) => records.insert(job.key.clone(), record.clone()),
            None => records.remove(&job.key),
        };
    }
    unfinished
}

fn stamp_uploads(
    base: &mut BTreeMap<String, (String, BaseEntry)>,
    run: &UploadRun,
    uploads: &[UploadJob],
) {
    let jobs: BTreeMap<&str, &UploadJob> =
        uploads.iter().map(|job| (job.key.as_str(), job)).collect();
    for (record_key, record) in &run.uploaded {
        if !run.published.contains(record_key) {
            continue;
        }
        let stamp = jobs
            .get(record_key.as_str())
            .filter(|job| job.local_hash.as_deref() == Some(record.hash.as_str()))
            .and_then(|job| job.signature.clone());
        base.insert(
            record_key.clone(),
            (
                record.path.clone(),
                BaseEntry {
                    stamp,
                    ..base_entry(record)
                },
            ),
        );
    }
}

impl<S: CloudStore> Round<'_, S> {
    async fn publish_final(
        &mut self,
        publisher: &mut Publisher<'_, S>,
        final_files: &[FileRecord],
        deletions: &[&Planned],
        run: &mut UploadRun,
    ) -> bool {
        if self.error.is_some() {
            return false;
        }
        if let Some(persist) = &self.env.persist_pending {
            let mut pending = self.project.pending_deletes.clone();
            pending.extend(pending_from(deletions));
            persist(&pending);
        }
        match publisher.publish(final_files.to_vec()).await {
            Ok(_) => {
                run.published.extend(run.uploaded.keys().cloned());
                true
            }
            Err(error) => {
                self.error = Some(RoundError::Store(error));
                false
            }
        }
    }

    async fn commit(
        &mut self,
        settled: Settled,
        planned: &[Planned],
        view: &RemoteView,
        mut publisher: Publisher<'_, S>,
    ) -> (UploadRun, u64) {
        let Settled {
            mut base,
            mut records,
            uploads,
            incomplete,
        } = settled;
        self.incomplete |= incomplete;
        let mut run = self.upload(&uploads, view, &mut publisher).await;
        if let Some(error) = run.error.take() {
            self.error.get_or_insert(error);
        }
        self.incomplete |= keep_unfinished(&mut records, &run, &uploads, view);
        let deletions: Vec<&Planned> = planned
            .iter()
            .filter(|item| item.action == Action::RemoteDelete)
            .collect();
        for item in &deletions {
            records.remove(&item.key);
        }
        let final_files = manifest_files(&records, &view.foreign);
        let final_published = self
            .publish_final(&mut publisher, &final_files, &deletions, &mut run)
            .await;
        stamp_uploads(&mut base, &run, &uploads);
        if final_published {
            for item in &deletions {
                base.remove(&item.key);
            }
            self.outcome.deleted_remote = deletions.len();
            self.delete_remote(&deletions, &final_files).await;
        } else {
            self.incomplete = true;
        }
        if publisher.rev.is_some() && (final_published || !run.published.is_empty()) {
            self.project.remote_rev = publisher.rev.clone();
        }
        self.outcome.uploaded = run.published.len();
        self.project.base = base.into_values().collect();
        self.project.meta_base = match agreed_meta(&self.env.root, &self.project).await {
            Some(meta) => Some(meta),
            None => self.project.meta_base.take(),
        };
        (run, publisher.clock.last().raw())
    }
}

pub(crate) async fn sync_project<S: CloudStore>(
    store: &S,
    env: &RoundEnv,
    context: &SyncContext,
    cloud: ProjectId,
    previous: &ProjectState,
    hlc: u64,
    options: &RoundOptions,
) -> Result<RoundResult, RoundError> {
    let Some(captured) = capture_locked(env, &previous.base).await? else {
        return Err(RoundError::Busy);
    };
    let mut project = previous.clone();
    project.cloud = Some(cloud);
    let mut clock = HlcClock::restore(Hlc::from_raw(hlc));
    let mut round = Round {
        store,
        env,
        cloud,
        options,
        project,
        outcome: SyncOutcome::default(),
        skipped: Vec::new(),
        failures: BTreeMap::new(),
        error: None,
        late_error: None,
        incomplete: false,
    };
    if round.quiet(&captured).await? {
        round.outcome.unchanged = true;
        refresh_local_skips(&mut round.project, &captured);
        round.outcome.skipped = round.project.skipped;
        return Ok(round.finish_early(&clock));
    }
    let Loaded::Remote(remote) = round.remote().await? else {
        return Ok(round.finish_early(&clock));
    };
    if let Some(remote) = &remote {
        observe_remote(&mut clock, remote);
    }
    let view = split_remote(remote.as_ref(), &captured.policy);
    let mut planned = plan(&PlanInput {
        capture: &captured,
        remote: &view,
        base: &round.project.base,
        root: &env.root,
        options,
        failed: &round.project.failed,
        now: now_ms(),
    });
    round.limit_uploads(&mut planned);
    if !options.allow_mass_delete && !options.restore_deleted {
        if let Some(hold) = mass_delete(&planned, round.project.base.len()) {
            round.project.hold = Some(hold);
            round.project.remote_dirty = true;
            round.outcome.held = true;
            return Ok(round.finish_early(&clock));
        }
    }
    round.project.hold = None;
    let label = sanitize_label(
        remote
            .as_ref()
            .and_then(|remote| remote.version.device.as_deref())
            .unwrap_or("conflict"),
    );
    let names = round.conflict_names(&planned, &captured, &view, &label);
    let folder = remote.as_ref().map_or((0, 0), |remote| {
        (remote.version.files.len(), remote.version.total_size())
    });
    let staged = round.stage(&planned, folder).await;
    let fixes = corrections(&staged, &view);
    let applied = round.apply(&planned, staged, names).await?;
    round.outcome.downloaded = applied.downloaded.len();
    round.outcome.deleted_local = applied.deleted.len();
    round.outcome.changed = applied.changed.iter().cloned().collect();
    let settled = settle(
        &SettleInput {
            planned: &planned,
            applied: &applied,
            captured: &captured,
            fixes: &fixes,
            options,
        },
        &round.project.base,
        &view,
    );
    let publisher = publisher_for(
        store,
        context,
        cloud,
        clock,
        remote.as_ref(),
        &captured,
        options,
    );
    let (run, hlc) = round.commit(settled, &planned, &view, publisher).await;
    round.record_failures(&planned, &applied);
    round.record_skips(&captured, &planned, &run);
    round.record_conflicts(&applied);
    if round.error.is_none() {
        round.error = round.late_error.take();
    }
    let failed_round = round.error.is_some();
    round.project.remote_dirty = round.incomplete || round.outcome.quota_hit || failed_round;
    if round.project.remote_dirty {
        round.project.remote_rev = None;
    }
    if !failed_round {
        round.project.last_synced_ms = now_ms();
    }
    Ok(RoundResult {
        outcome: round.outcome,
        project: round.project,
        hlc,
        error: round.error,
    })
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteProject {
    pub(crate) cloud: ProjectId,
    pub(crate) name: String,
    pub(crate) stamp_ms: u64,
    pub(crate) size: u64,
}

pub(crate) async fn list_remote_projects<S: CloudStore>(
    store: &S,
    known: &BTreeSet<ProjectId>,
    cache: &mut BTreeMap<ProjectId, RemoteProject>,
) -> Result<Vec<RemoteProject>, RoundError> {
    let entries = store.list("/projects").await?;
    let listed: BTreeSet<ProjectId> = entries
        .iter()
        .filter(|entry| entry.folder)
        .filter_map(|entry| ProjectId::parse(&entry.name).ok())
        .collect();
    cache.retain(|cloud, _| listed.contains(cloud));
    let unknown: Vec<ProjectId> = listed
        .iter()
        .filter(|cloud| !known.contains(cloud))
        .take(500)
        .copied()
        .collect();
    let missing: Vec<ProjectId> = unknown
        .iter()
        .filter(|cloud| !cache.contains_key(cloud))
        .copied()
        .collect();
    let fetched: Vec<Result<Option<RemoteProject>, RoundError>> = stream::iter(missing)
        .map(|cloud| async move {
            Ok(fetch_version(store, cloud)
                .await?
                .map(|remote| RemoteProject {
                    cloud,
                    name: remote.version.name.chars().take(200).collect(),
                    stamp_ms: remote.version.stamp.hlc.wall_ms().min(now_ms()),
                    size: remote.version.total_size(),
                }))
        })
        .buffer_unordered(DOWNLOAD_CONCURRENCY)
        .collect()
        .await;
    for result in fetched {
        match result {
            Ok(Some(project)) => {
                cache.insert(project.cloud, project);
            }
            Ok(None) => {}
            Err(error) if error.ends_round() => return Err(error),
            Err(_) => {}
        }
    }
    let mut projects: Vec<RemoteProject> = unknown
        .iter()
        .filter_map(|cloud| cache.get(cloud).cloned())
        .collect();
    projects.sort_by_key(|project| std::cmp::Reverse(project.stamp_ms));
    Ok(projects)
}

fn too_many_files(error: &StoreError) -> bool {
    matches!(error, StoreError::Server(detail) | StoreError::Rejected(detail) if detail.contains("too_many_files"))
}

pub(crate) async fn delete_project_folder<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
) -> Result<(), StoreError> {
    let mut stack = vec![(project_remote(cloud), 0usize)];
    let mut emptied = Vec::new();
    while let Some((folder, depth)) = stack.pop() {
        match store.delete(&folder, None).await {
            Ok(()) => {}
            Err(error) if too_many_files(&error) && depth < MAX_TREE_DEPTH => {
                emptied.push(folder.clone());
                let mut files = Vec::new();
                for entry in store.list(&folder).await? {
                    let child = format!("{folder}/{}", entry.name);
                    if entry.folder {
                        stack.push((child, depth + 1));
                    } else {
                        files.push(BatchDelete {
                            remote: child,
                            parent_rev: None,
                        });
                    }
                }
                for result in store.delete_paths(&files).await {
                    result?;
                }
            }
            Err(error) => return Err(error),
        }
    }
    for folder in emptied.into_iter().rev() {
        store.delete(&folder, None).await?;
    }
    Ok(())
}

pub(crate) struct Downloaded {
    pub(crate) version: VersionManifest,
    pub(crate) rev: String,
    pub(crate) base: BTreeMap<String, BaseEntry>,
    pub(crate) skipped: usize,
    pub(crate) stale: bool,
}

struct Placement {
    root: PathBuf,
    staged: Vec<Staged>,
    records: BTreeMap<String, FileRecord>,
    meta: serde_json::Value,
    name: String,
}

fn place_download(
    placement: Placement,
) -> Result<(BTreeMap<String, BaseEntry>, usize), RoundError> {
    let mut base = BTreeMap::new();
    let mut skipped = 0;
    for staged in placement.staged {
        let record = &placement.records[&staged.key];
        let Some(target) = resolve_target(&placement.root, &record.path) else {
            skipped += 1;
            let _ = std::fs::remove_file(&staged.path);
            continue;
        };
        let placed = if staged.key == PROJECT_META {
            place_meta(&staged.path, &target, None, None)
        } else {
            move_into(&staged.path, &target).map_err(|error| error.to_string())
        };
        let _ = std::fs::remove_file(&staged.path);
        placed.map_err(RoundError::Local)?;
        apply_exec(&target, &record.path, record.exec);
        base.insert(
            record.path.clone(),
            BaseEntry {
                hash: staged.hash,
                size: staged.size,
                stamp: None,
            },
        );
    }
    let meta_path = placement.root.join(PROJECT_META);
    if !meta_path.exists() {
        let fallback = if placement.meta.is_object() {
            merge::with_device_fields(&placement.meta, None)
        } else {
            serde_json::json!({ "name": placement.name })
        };
        let bytes = merge::pretty(&fallback).map_err(RoundError::Local)?;
        crate::sandbox::atomic_write(&meta_path, &bytes).map_err(RoundError::Local)?;
    }
    let meta_bytes =
        std::fs::read(&meta_path).map_err(|error| RoundError::Local(error.to_string()))?;
    crate::project::parse_project_meta(&meta_bytes).map_err(RoundError::Local)?;
    Ok((base, skipped))
}

pub(crate) async fn download_into<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    root: &Path,
    staging: &Path,
) -> Result<Option<Downloaded>, RoundError> {
    let Some(remote) = fetch_version(store, cloud).await? else {
        return Ok(None);
    };
    let meta = remote.version.manifest.clone();
    let policy = policy_for(meta.is_object().then_some(&meta));
    let view = split_remote(Some(&remote), &policy);
    let mut skipped = view.foreign.len();
    tokio::fs::create_dir_all(staging)
        .await
        .map_err(|error| RoundError::Local(error.to_string()))?;
    let jobs: Vec<(String, FileRecord)> = view
        .usable
        .iter()
        .map(|(record_key, record)| (record_key.clone(), record.clone()))
        .collect();
    let needed: u64 = jobs.iter().map(|(_, record)| record.size).sum();
    if !room_for(staging, needed.saturating_mul(2)).await {
        return Err(RoundError::DiskFull);
    }
    let folder = (remote.version.files.len(), remote.version.total_size());
    let (staged, failed) = stage_whole(store, cloud, jobs, staging, folder).await;
    if let Some((_, error)) = failed.into_iter().next() {
        for staged in &staged {
            let _ = tokio::fs::remove_file(&staged.path).await;
        }
        return Err(error.into());
    }
    let placement = Placement {
        root: root.to_path_buf(),
        staged,
        records: view.usable,
        meta,
        name: remote.version.name.clone(),
    };
    let (base, unplaced) = tauri::async_runtime::spawn_blocking(move || place_download(placement))
        .await
        .map_err(|error| RoundError::Local(error.to_string()))??;
    skipped += unplaced;
    let stale = remote.version.files.iter().any(|record| {
        base.get(&record.path)
            .is_some_and(|entry| entry.hash != record.hash)
    });
    Ok(Some(Downloaded {
        version: remote.version,
        rev: remote.rev,
        base,
        skipped,
        stale,
    }))
}
