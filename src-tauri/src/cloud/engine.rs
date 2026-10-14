use super::merge::{self, PROJECT_META};
use super::state::{BaseEntry, Hold, ProjectState};
use super::store::{CloudStore, StoreError, WriteMode};
use crate::checkpoint_capture::FileStamp;
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::ContentHash;
use oleafly_core::exclude::{decide, Decision, EntryInfo, EntryKind, PolicyFields};
use oleafly_core::hlc::{Hlc, HlcClock, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use oleafly_core::portable;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const FORMAT_VERSION: u32 = 1;
const MAX_FILES: usize = 100_000;
pub(crate) const MAX_VERSION_BYTES: usize = 64 * 1024 * 1024;
const MASS_DELETE_MIN: usize = 20;
const PUBLISH_EVERY_FILES: usize = 200;
const PUBLISH_EVERY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FUTURE_SKEW_MS: u64 = 24 * 60 * 60 * 1000;
const DOWNLOAD_CONCURRENCY: usize = 4;
const STALE_TEMP_AGE: Duration = Duration::from_secs(60 * 60);

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
        match self {
            Self::Store(error) => error.to_app_error(),
            Self::NewerVersion => crate::app_error::AppError::new("cloud.newer_version").into(),
            Self::Busy => crate::app_error::AppError::new("cloud.project_busy").into(),
            Self::Local(detail) => crate::app_error::AppError::new("cloud.local_io")
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
            Self::Local(detail) => formatter.write_str(detail),
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
    pub(crate) dirty: BTreeSet<String>,
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
}

pub(crate) struct RoundEnv {
    pub(crate) root: PathBuf,
    pub(crate) staging: PathBuf,
    pub(crate) trash: PathBuf,
    pub(crate) lock_id: Option<String>,
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
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    false
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
        permissions.set_mode(if exec { mode | 0o755 } else { mode & !0o111 });
        let _ = std::fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn apply_exec(_path: &Path, _portable: &str, _exec: bool) {}

#[derive(Clone, Debug, Default)]
pub(crate) struct OwnedPolicy {
    compile_dir: Option<String>,
    main_doc: String,
    include: Vec<String>,
    exclude: Vec<String>,
}

impl OwnedPolicy {
    fn fields(&self) -> PolicyFields<'_> {
        PolicyFields {
            compile_dir: self.compile_dir.as_deref(),
            main_doc: &self.main_doc,
            sync_include: &self.include,
            sync_exclude: &self.exclude,
        }
    }
}

pub(crate) fn read_meta_value(root: &Path) -> Option<serde_json::Value> {
    let path = root.join(PROJECT_META);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(&path).ok()?).ok()
}

fn policy_for(meta: Option<&serde_json::Value>) -> OwnedPolicy {
    let manifest = meta
        .and_then(|value| serde_json::to_vec(value).ok())
        .and_then(|bytes| oleafly_core::sniff_oleafly_manifest(&bytes))
        .unwrap_or_default();
    OwnedPolicy {
        compile_dir: manifest.compile_dir,
        main_doc: manifest.main_doc,
        include: manifest.sync_include,
        exclude: manifest.sync_exclude,
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LocalFile {
    pub(crate) path: String,
    pub(crate) hash: String,
    stamp: FileStamp,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Capture {
    pub(crate) files: BTreeMap<String, LocalFile>,
    pub(crate) unobserved: BTreeSet<String>,
    pub(crate) skipped: usize,
    policy: OwnedPolicy,
    meta: Option<serde_json::Value>,
}

impl Capture {
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
        Decision::Include if !is_reparse(&metadata) => {}
        _ => return Seen::Skip,
    }
    let Some(portable) = portable_path(relative)
        .filter(|portable| portable::synced_path_problem(portable).is_none())
    else {
        out.skipped += 1;
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

fn record_file(out: &mut Capture, portable: String, path: &Path, metadata: &std::fs::Metadata) {
    let file_key = key(&portable);
    if out.files.contains_key(&file_key) {
        out.skipped += 1;
        return;
    }
    let hash = if portable == PROJECT_META {
        std::fs::read(path).map(|bytes| merge::meta_digest(&bytes))
    } else {
        crate::checkpoint_capture::cached_capture_hash(path, &portable, metadata)
    };
    match hash {
        Ok(hash) => {
            out.files.insert(
                file_key,
                LocalFile {
                    path: portable,
                    hash: hash.to_hex(),
                    stamp: FileStamp::of(metadata),
                },
            );
        }
        Err(_) => {
            out.unobserved.insert(file_key);
        }
    }
}

pub(crate) fn capture(root: &Path) -> Result<Capture, RoundError> {
    let meta = read_meta_value(root);
    let policy = policy_for(meta.as_ref());
    let mut out = Capture {
        meta,
        ..Capture::default()
    };
    let fields = policy.fields();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let read =
            std::fs::read_dir(&directory).map_err(|error| RoundError::Local(error.to_string()))?;
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
                    record_file(&mut out, portable, &path, &metadata);
                    if out.files.len() > MAX_FILES {
                        return Err(RoundError::Local(
                            "project has too many files to sync".into(),
                        ));
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
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

pub(crate) async fn fetch_version<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
) -> Result<Option<Remote>, RoundError> {
    let Some((bytes, rev)) = store.get(&version_remote(cloud), MAX_VERSION_BYTES).await? else {
        return Ok(None);
    };
    let probe: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| StoreError::Server("the remote version record is unreadable".into()))?;
    if probe
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|v| v > u64::from(FORMAT_VERSION))
    {
        return Err(RoundError::NewerVersion);
    }
    let version: VersionManifest = serde_json::from_value(probe)
        .map_err(|_| StoreError::Server("the remote version record is unreadable".into()))?;
    if version.project != cloud {
        return Err(
            StoreError::Server("the remote version record names another project".into()).into(),
        );
    }
    if version.files.len() > MAX_FILES {
        return Err(
            StoreError::Server("the remote version record lists too many files".into()).into(),
        );
    }
    Ok(Some(Remote { version, rev }))
}

pub(crate) fn sanitize_label(name: &str) -> String {
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
    if trimmed.is_empty() {
        "conflict".into()
    } else {
        trimmed.to_string()
    }
}

fn conflict_path(portable: &str, label: &str, date: &str, taken: &dyn Fn(&str) -> bool) -> String {
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
        if !taken(&candidate) {
            return candidate;
        }
    }
    build(&format!("{label} {date} {:08x}", rand::random::<u32>()))
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
}

struct RemoteView {
    usable: BTreeMap<String, FileRecord>,
    foreign: Vec<FileRecord>,
}

fn split_remote(remote: Option<&Remote>, policy: &OwnedPolicy) -> RemoteView {
    let mut view = RemoteView {
        usable: BTreeMap::new(),
        foreign: Vec::new(),
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
            view.foreign.push(record.clone());
        }
    }
    view
}

fn plan(
    capture: &Capture,
    remote: &RemoteView,
    base: &BTreeMap<String, BaseEntry>,
    root: &Path,
    options: &RoundOptions,
) -> Vec<Planned> {
    let base_by_key: BTreeMap<String, (&String, &BaseEntry)> = base
        .iter()
        .map(|(path, entry)| (key(path), (path, entry)))
        .collect();
    let mut keys: BTreeSet<&String> = BTreeSet::new();
    keys.extend(capture.files.keys());
    keys.extend(remote.usable.keys());
    keys.extend(base_by_key.keys());
    let mut planned = Vec::new();
    for entry_key in keys {
        let local = capture.files.get(entry_key);
        let remote_record = remote.usable.get(entry_key);
        let base_entry = base_by_key.get(entry_key);
        let unobserved = local.is_none()
            && (capture.unobserved.contains(entry_key)
                || base_entry.is_some_and(|(path, _)| on_disk(root, path))
                || remote_record.is_some_and(|record| on_disk(root, &record.path)));
        let local_hash = local.map(|file| file.hash.as_str());
        let remote_hash = remote_record.map(|record| record.hash.as_str());
        let base_hash = base_entry.map(|(_, entry)| entry.hash.as_str());
        let dirty = options.dirty.contains(entry_key);
        let action = if unobserved {
            Action::Carry
        } else if local_hash == remote_hash {
            Action::Keep
        } else {
            let local_changed = local_hash != base_hash;
            let remote_changed = remote_hash != base_hash;
            let is_meta = entry_key == PROJECT_META;
            match (
                local_changed,
                remote_changed,
                local.is_some(),
                remote_record.is_some(),
            ) {
                (true, false, true, _) => Action::Upload,
                (true, false, false, _) => {
                    if options.restore_deleted && remote_record.is_some() {
                        Action::Download
                    } else {
                        Action::RemoteDelete
                    }
                }
                (false, true, _, true) => Action::Download,
                (false, true, _, false) => Action::LocalDelete,
                (true, true, true, true) if is_meta => Action::MetaMerge,
                (true, true, true, true) => Action::Conflict,
                (true, true, true, false) => Action::Upload,
                (true, true, false, true) => Action::Download,
                _ => Action::Keep,
            }
        };
        let action = match action {
            Action::Download | Action::LocalDelete | Action::MetaMerge if dirty => Action::Carry,
            other => other,
        };
        planned.push(Planned {
            key: entry_key.clone(),
            local: local.cloned(),
            remote: remote_record.cloned(),
            base: base_entry.map(|(_, entry)| (*entry).clone()),
            action,
        });
    }
    planned
}

fn mass_delete(planned: &[Planned], base_len: usize) -> Option<Hold> {
    let count = planned
        .iter()
        .filter(|item| item.action == Action::RemoteDelete)
        .count();
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
    let limit = if pinned {
        record.size
    } else {
        oleafly_core::exclude::MAX_SYNC_FILE_BYTES
    };
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
    skipped: usize,
}

struct ApplyJob {
    root: PathBuf,
    trash: PathBuf,
    lock_id: Option<String>,
    staged: BTreeMap<String, PathBuf>,
    items: Vec<(String, Action, Option<LocalFile>, Option<FileRecord>)>,
    conflict_names: BTreeMap<String, String>,
    meta_base: Option<serde_json::Value>,
}

fn apply_download(
    root: &Path,
    item_key: &str,
    temp: &Path,
    local: Option<&LocalFile>,
    record: &FileRecord,
    applied: &mut Applied,
) {
    let portable_path = local.map_or(record.path.as_str(), |file| file.path.as_str());
    let Some(target) = resolve_target(root, portable_path) else {
        applied.skipped += 1;
        return;
    };
    if !unchanged_since_capture(&target, local) {
        return;
    }
    let placed = if item_key == PROJECT_META {
        place_meta(
            temp,
            &target,
            local.and_then(|_| read_json(&target)).as_ref(),
        )
    } else {
        move_into(temp, &target).map_err(|error| error.to_string())
    };
    if placed.is_ok() {
        apply_exec(&target, portable_path, record.exec);
        applied.downloaded.insert(item_key.to_string());
    }
}

fn apply_delete(
    root: &Path,
    trash: &Path,
    item_key: &str,
    local: &LocalFile,
    applied: &mut Applied,
) {
    let Some(target) = resolve_target(root, &local.path) else {
        return;
    };
    if !unchanged_since_capture(&target, Some(local)) {
        return;
    }
    if trash_file(&target, trash).is_ok() {
        prune_empty_parents(root, &target);
        applied.deleted.insert(item_key.to_string());
    }
}

fn apply_conflict(
    root: &Path,
    item_key: &str,
    temp: &Path,
    copy: &str,
    remote: Option<&FileRecord>,
    applied: &mut Applied,
) {
    let Some(target) = resolve_target(root, copy).filter(|target| !target.exists()) else {
        return;
    };
    if move_into(temp, &target).is_err() {
        return;
    }
    if let Some(record) = remote {
        apply_exec(&target, copy, record.exec);
    }
    applied
        .conflict_copies
        .insert(item_key.to_string(), copy.to_string());
}

fn apply_meta_merge(
    root: &Path,
    temp: &Path,
    local: &LocalFile,
    meta_base: Option<&serde_json::Value>,
    applied: &mut Applied,
) {
    let target = root.join(PROJECT_META);
    let (Some(incoming), Some(current)) = (read_json(temp), read_json(&target)) else {
        return;
    };
    if !unchanged_since_capture(&target, Some(local)) {
        return;
    }
    let base = meta_base.map(merge::portable_meta);
    let merged = merge::merge3(
        base.as_ref(),
        &merge::portable_meta(&current),
        &merge::portable_meta(&incoming),
    );
    let written = merge::with_device_fields(&merged, Some(&current));
    let Ok(bytes) = merge::pretty(&written) else {
        return;
    };
    if crate::sandbox::atomic_write(&target, &bytes).is_ok() {
        applied.merged_meta = Some((merge::meta_digest(&bytes).to_hex(), bytes));
    }
}

fn apply_local(job: ApplyJob) -> Applied {
    let mut applied = Applied::default();
    let lock = match &job.lock_id {
        Some(id) => crate::worktree_lock::ProjectWorktreeLock::try_shared(id)
            .ok()
            .flatten(),
        None => None,
    };
    let mut staged = job.staged;
    if (job.lock_id.is_some() && lock.is_none()) || !job.root.is_dir() {
        for temp in staged.values() {
            let _ = std::fs::remove_file(temp);
        }
        return applied;
    }
    for (item_key, action, local, remote) in &job.items {
        let temp = staged.remove(item_key);
        match (action, temp.as_deref(), local, remote) {
            (Action::Download, Some(temp), local, Some(record)) => {
                apply_download(
                    &job.root,
                    item_key,
                    temp,
                    local.as_ref(),
                    record,
                    &mut applied,
                );
            }
            (Action::LocalDelete, _, Some(local), _) => {
                apply_delete(&job.root, &job.trash, item_key, local, &mut applied);
            }
            (Action::Conflict, Some(temp), _, remote) => {
                if let Some(copy) = job.conflict_names.get(item_key) {
                    apply_conflict(
                        &job.root,
                        item_key,
                        temp,
                        copy,
                        remote.as_ref(),
                        &mut applied,
                    );
                }
            }
            (Action::MetaMerge, Some(temp), Some(local), _) => {
                apply_meta_merge(&job.root, temp, local, job.meta_base.as_ref(), &mut applied);
            }
            _ => {}
        }
        if let Some(temp) = temp {
            let _ = std::fs::remove_file(temp);
        }
    }
    for leftover in staged.values() {
        let _ = std::fs::remove_file(leftover);
    }
    drop(lock);
    applied
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn place_meta(temp: &Path, target: &Path, local: Option<&serde_json::Value>) -> Result<(), String> {
    let incoming = read_json(temp).ok_or("the incoming project.json is unreadable")?;
    let merged = merge::with_device_fields(&incoming, local);
    let bytes = merge::pretty(&merged)?;
    crate::sandbox::atomic_write(target, &bytes)
}

fn record_from_upload(
    path: &str,
    uploaded: &super::store::Uploaded,
    exec: bool,
    hash: String,
) -> FileRecord {
    FileRecord {
        path: path.to_string(),
        hash,
        size: uploaded.size,
        exec,
        rev: Some(uploaded.rev.clone()),
        extra: serde_json::Map::new(),
    }
}

async fn upload_one<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    root: &Path,
    path: &str,
    meta_bytes: Option<&[u8]>,
) -> Result<FileRecord, StoreError> {
    let absolute = native(root, path);
    let exec = tokio::fs::symlink_metadata(&absolute)
        .await
        .map(|metadata| is_executable(&metadata))
        .unwrap_or(false);
    if path == PROJECT_META {
        let bytes = match meta_bytes {
            Some(bytes) => bytes.to_vec(),
            None => tokio::fs::read(&absolute)
                .await
                .map_err(|error| StoreError::Io(error.to_string()))?,
        };
        let digest = merge::meta_digest(&bytes).to_hex();
        let size = bytes.len() as u64;
        let rev = store
            .put(&file_remote(cloud, path), bytes, WriteMode::Overwrite)
            .await?;
        return Ok(FileRecord {
            path: path.to_string(),
            hash: digest,
            size,
            exec: false,
            rev: Some(rev),
            extra: serde_json::Map::new(),
        });
    }
    let checked = {
        let root = root.to_path_buf();
        let path = path.to_string();
        tauri::async_runtime::spawn_blocking(move || resolve_target(&root, &path).is_some())
            .await
            .unwrap_or(false)
    };
    if !checked {
        return Err(StoreError::Io(format!(
            "{path} is not a regular file in the project"
        )));
    }
    let uploaded = store.put_path(&file_remote(cloud, path), &absolute).await?;
    let hash = uploaded.hash.to_hex();
    Ok(record_from_upload(path, &uploaded, exec, hash))
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
    }
}

fn utc_date() -> String {
    crate::project_ids::rfc3339_from_unix_ms(now_ms())[..10].to_string()
}

async fn capture_locked(env: &RoundEnv) -> Result<Option<Capture>, RoundError> {
    let root = env.root.clone();
    let lock_id = env.lock_id.clone();
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
        capture(&root).map(Some)
    })
    .await
    .map_err(|error| RoundError::Local(error.to_string()))?
}

fn unchanged(project: ProjectState, clock: &HlcClock, outcome: SyncOutcome) -> RoundResult {
    RoundResult {
        outcome: SyncOutcome {
            unchanged: true,
            ..outcome
        },
        project,
        hlc: clock.last().raw(),
        error: None,
    }
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
                .map(|tombstone| sanitize_label(&tombstone.device))
                .unwrap_or_else(|_| sanitize_label(""))
        }))
}

struct UploadJob {
    key: String,
    path: String,
    meta: Option<Vec<u8>>,
}

#[allow(clippy::too_many_lines)]
pub(crate) async fn sync_project<S: CloudStore>(
    store: &S,
    env: &RoundEnv,
    context: &SyncContext,
    cloud: ProjectId,
    previous: &ProjectState,
    hlc: u64,
    options: &RoundOptions,
) -> Result<RoundResult, RoundError> {
    let Some(captured) = capture_locked(env).await? else {
        return Err(RoundError::Busy);
    };
    let root = env.root.clone();
    let mut project = previous.clone();
    project.cloud = Some(cloud);
    let mut clock = HlcClock::restore(Hlc::from_raw(hlc));
    let mut outcome = SyncOutcome {
        skipped: captured.skipped,
        ..SyncOutcome::default()
    };

    let forced = options.allow_mass_delete || options.restore_deleted;
    let quiet = !forced
        && captured.matches_base(&project.base)
        && project.pending_deletes.is_empty()
        && project.hold.is_none();
    if quiet && !project.remote_dirty {
        return Ok(unchanged(project, &clock, outcome));
    }
    if quiet {
        if let Some(rev) = project.remote_rev.clone() {
            let current = store.metadata(&version_remote(cloud)).await?;
            if current.is_some_and(|meta| meta.rev == rev) {
                project.remote_dirty = false;
                return Ok(unchanged(project, &clock, outcome));
            }
        }
    }

    let remote = fetch_version(store, cloud).await?;
    if let Some(remote) = &remote {
        observe_remote(&mut clock, remote);
    } else {
        if let Some(device) = read_tombstone(store, cloud).await? {
            project.paused = true;
            project.removed_by = Some(device);
            project.base.clear();
            project.meta_base = None;
            project.remote_rev = None;
            project.remote_dirty = false;
            project.hold = None;
            project.pending_deletes.clear();
            outcome.removed_by = project.removed_by.clone();
            return Ok(RoundResult {
                outcome,
                project,
                hlc: clock.last().raw(),
                error: None,
            });
        }
        project.base.clear();
        project.meta_base = None;
        project.remote_rev = None;
        project.pending_deletes.clear();
    }

    let view = split_remote(remote.as_ref(), &captured.policy);
    let mut planned = plan(&captured, &view, &project.base, &root, options);
    if !options.allow_uploads {
        for item in &mut planned {
            if matches!(
                item.action,
                Action::Upload | Action::Conflict | Action::MetaMerge
            ) {
                item.action = Action::Carry;
                outcome.quota_hit = true;
            }
        }
    }
    if !forced {
        if let Some(hold) = mass_delete(&planned, project.base.len()) {
            project.hold = Some(hold);
            project.remote_dirty = true;
            outcome.held = true;
            return Ok(RoundResult {
                outcome,
                project,
                hlc: clock.last().raw(),
                error: None,
            });
        }
    }
    project.hold = None;

    let label = sanitize_label(
        remote
            .as_ref()
            .and_then(|remote| remote.version.device.as_deref())
            .unwrap_or("conflict"),
    );
    let date = utc_date();
    let mut reserved: BTreeSet<String> = BTreeSet::new();
    let mut conflict_names: BTreeMap<String, String> = BTreeMap::new();
    for item in &planned {
        if item.action != Action::Conflict {
            continue;
        }
        let Some(local) = &item.local else {
            continue;
        };
        let name = {
            let taken = |candidate: &str| {
                let candidate_key = key(candidate);
                captured.files.contains_key(&candidate_key)
                    || view.usable.contains_key(&candidate_key)
                    || view
                        .foreign
                        .iter()
                        .any(|record| key(&record.path) == candidate_key)
                    || reserved.contains(&candidate_key)
                    || on_disk(&root, candidate)
            };
            conflict_path(&local.path, &label, &date, &taken)
        };
        reserved.insert(key(&name));
        conflict_names.insert(item.key.clone(), name);
    }

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
    let mut round_error: Option<RoundError> = None;
    let mut incomplete = false;
    let staged = if downloads.is_empty() {
        Vec::new()
    } else {
        tokio::fs::create_dir_all(&env.staging)
            .await
            .map_err(|error| RoundError::Local(error.to_string()))?;
        let (staged, failed) = stage_downloads(store, cloud, downloads, &env.staging).await;
        for (_, error) in failed {
            incomplete = true;
            if error.ends_round() {
                if round_error.is_none() {
                    round_error = Some(RoundError::Store(error));
                }
            } else {
                outcome.skipped += 1;
            }
        }
        staged
    };
    let fixes = corrections(&staged, &view);
    let needs_apply = planned.iter().any(|item| {
        matches!(
            item.action,
            Action::Download | Action::LocalDelete | Action::Conflict | Action::MetaMerge
        )
    });
    let applied = if needs_apply {
        let job = ApplyJob {
            root: root.clone(),
            trash: env.trash.clone(),
            lock_id: env.lock_id.clone(),
            staged: staged
                .into_iter()
                .map(|staged| (staged.key, staged.path))
                .collect(),
            items: planned
                .iter()
                .filter(|item| {
                    matches!(
                        item.action,
                        Action::Download
                            | Action::LocalDelete
                            | Action::Conflict
                            | Action::MetaMerge
                    )
                })
                .map(|item| {
                    (
                        item.key.clone(),
                        item.action.clone(),
                        item.local.clone(),
                        item.remote.clone(),
                    )
                })
                .collect(),
            conflict_names,
            meta_base: project.meta_base.clone(),
        };
        tauri::async_runtime::spawn_blocking(move || apply_local(job))
            .await
            .map_err(|error| RoundError::Local(error.to_string()))?
    } else {
        Applied::default()
    };
    outcome.skipped += applied.skipped;
    outcome.downloaded = applied.downloaded.len();
    outcome.conflicts = applied.conflict_copies.len();
    outcome.deleted_local = applied.deleted.len();

    let mut base: BTreeMap<String, (String, BaseEntry)> = project
        .base
        .iter()
        .map(|(path, entry)| (key(path), (path.clone(), entry.clone())))
        .collect();
    let mut records: BTreeMap<String, FileRecord> = view.usable.clone();
    let mut uploads: Vec<UploadJob> = Vec::new();
    for item in &planned {
        let local_path = item.local.as_ref().map(|file| file.path.clone());
        let remote_hash = item.remote.as_ref().map(|record| record.hash.as_str());
        let base_hash = item.base.as_ref().map(|entry| entry.hash.as_str());
        let local_hash = item.local.as_ref().map(|file| file.hash.as_str());
        match item.action {
            Action::Keep => match (&item.remote, &local_path) {
                (Some(record), Some(path)) => {
                    base.insert(item.key.clone(), (path.clone(), base_entry(record)));
                }
                _ => {
                    base.remove(&item.key);
                }
            },
            Action::Carry => {
                let excluded = item.local.is_none()
                    && !captured.unobserved.contains(&item.key)
                    && !options.dirty.contains(&item.key);
                if excluded {
                    base.remove(&item.key);
                } else if remote_hash != base_hash
                    || (item.local.is_some() && local_hash != base_hash)
                {
                    incomplete = true;
                }
            }
            Action::Download => match &item.remote {
                Some(record) if applied.downloaded.contains(&item.key) => {
                    let agreed = fixes.get(&item.key).unwrap_or(record);
                    let path = local_path.unwrap_or_else(|| record.path.clone());
                    base.insert(item.key.clone(), (path, base_entry(agreed)));
                    if let Some(fix) = fixes.get(&item.key) {
                        records.insert(item.key.clone(), fix.clone());
                    }
                }
                _ => incomplete = true,
            },
            Action::LocalDelete => {
                if applied.deleted.contains(&item.key) {
                    base.remove(&item.key);
                } else {
                    incomplete = true;
                }
            }
            Action::Upload => {
                if let Some(path) = local_path {
                    uploads.push(UploadJob {
                        key: item.key.clone(),
                        path,
                        meta: None,
                    });
                }
            }
            Action::Conflict => match (
                applied.conflict_copies.get(&item.key),
                &item.remote,
                local_path,
            ) {
                (Some(copy), Some(record), Some(path)) => {
                    base.insert(item.key.clone(), (path.clone(), base_entry(record)));
                    uploads.push(UploadJob {
                        key: key(copy),
                        path: copy.clone(),
                        meta: None,
                    });
                    uploads.push(UploadJob {
                        key: item.key.clone(),
                        path,
                        meta: None,
                    });
                }
                _ => incomplete = true,
            },
            Action::MetaMerge => match (&applied.merged_meta, &item.remote) {
                (Some((_, bytes)), Some(record)) => {
                    base.insert(
                        item.key.clone(),
                        (PROJECT_META.to_string(), base_entry(record)),
                    );
                    uploads.push(UploadJob {
                        key: item.key.clone(),
                        path: PROJECT_META.to_string(),
                        meta: Some(bytes.clone()),
                    });
                }
                _ => incomplete = true,
            },
            Action::RemoteDelete => {}
        }
    }

    let mut publisher = Publisher {
        store,
        cloud,
        context,
        clock,
        rev: remote.as_ref().map(|remote| remote.rev.clone()),
        published: remote
            .as_ref()
            .map(|remote| remote.version.files.clone())
            .unwrap_or_default(),
        name: captured
            .meta
            .as_ref()
            .and_then(|meta| meta.get("name"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map_or_else(
                || context.fallback_name.clone(),
                |name| name.chars().take(200).collect(),
            ),
        manifest: captured
            .meta
            .as_ref()
            .map(merge::portable_meta)
            .unwrap_or_default(),
        extra: remote
            .as_ref()
            .map(|remote| remote.version.extra.clone())
            .unwrap_or_default(),
    };

    let mut uploaded: BTreeMap<String, FileRecord> = BTreeMap::new();
    let mut published: BTreeSet<String> = BTreeSet::new();
    let mut since_publish_files = 0usize;
    let mut since_publish_bytes = 0u64;
    if round_error.is_none() {
        for job in &uploads {
            match upload_one(store, cloud, &root, &job.path, job.meta.as_deref()).await {
                Ok(record) => {
                    since_publish_files += 1;
                    since_publish_bytes += record.size;
                    records.insert(job.key.clone(), record.clone());
                    uploaded.insert(job.key.clone(), record);
                }
                Err(StoreError::QuotaFull) => {
                    outcome.quota_hit = true;
                    break;
                }
                Err(error) if error.ends_round() => {
                    round_error = Some(RoundError::Store(error));
                    break;
                }
                Err(_) => outcome.skipped += 1,
            }
            if since_publish_files >= PUBLISH_EVERY_FILES
                || since_publish_bytes >= PUBLISH_EVERY_BYTES
            {
                let mut interim = view.usable.clone();
                interim.extend(
                    uploaded
                        .iter()
                        .map(|(record_key, record)| (record_key.clone(), record.clone())),
                );
                match publisher
                    .publish(manifest_files(&interim, &view.foreign))
                    .await
                {
                    Ok(_) => {
                        published.extend(uploaded.keys().cloned());
                        since_publish_files = 0;
                        since_publish_bytes = 0;
                    }
                    Err(error) => {
                        round_error = Some(RoundError::Store(error));
                        break;
                    }
                }
            }
        }
    }
    for job in &uploads {
        if uploaded.contains_key(&job.key) {
            continue;
        }
        incomplete = true;
        match view.usable.get(&job.key) {
            Some(record) => {
                records.insert(job.key.clone(), record.clone());
            }
            None => {
                records.remove(&job.key);
            }
        }
    }
    let deletions: Vec<&Planned> = planned
        .iter()
        .filter(|item| item.action == Action::RemoteDelete)
        .collect();
    for item in &deletions {
        records.remove(&item.key);
    }
    let final_files = manifest_files(&records, &view.foreign);
    let mut final_published = false;
    if round_error.is_none() {
        match publisher.publish(final_files.clone()).await {
            Ok(_) => {
                final_published = true;
                published.extend(uploaded.keys().cloned());
            }
            Err(error) => round_error = Some(RoundError::Store(error)),
        }
    }
    for (record_key, record) in &uploaded {
        if published.contains(record_key) {
            base.insert(
                record_key.clone(),
                (record.path.clone(), base_entry(record)),
            );
        }
    }
    if final_published {
        for item in &deletions {
            base.remove(&item.key);
        }
        outcome.deleted_remote = deletions.len();
        let live: BTreeSet<String> = final_files.iter().map(|record| key(&record.path)).collect();
        let mut pending: Vec<String> = project.pending_deletes.clone();
        pending.extend(
            deletions
                .iter()
                .filter_map(|item| item.remote.as_ref().map(|record| record.path.clone())),
        );
        pending.sort();
        pending.dedup();
        let mut still_pending = Vec::new();
        for path in pending {
            if live.contains(&key(&path)) {
                continue;
            }
            match store.delete(&file_remote(cloud, &path)).await {
                Ok(()) => {}
                Err(error) => {
                    if error.ends_round() && round_error.is_none() {
                        round_error = Some(RoundError::Store(error));
                    }
                    still_pending.push(path);
                }
            }
        }
        project.pending_deletes = still_pending;
    } else {
        incomplete = true;
    }
    if publisher.rev.is_some() && (final_published || !published.is_empty()) {
        project.remote_rev = publisher.rev.clone();
    }
    outcome.uploaded = published.len();

    project.base = base.into_values().collect();
    let agreed_meta = project
        .base
        .get(PROJECT_META)
        .map(|entry| entry.hash.clone());
    let local_meta = tokio::fs::read(root.join(PROJECT_META)).await.ok();
    if let (Some(agreed), Some(bytes)) = (agreed_meta, local_meta) {
        if merge::meta_digest(&bytes).to_hex() == agreed {
            project.meta_base = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .map(|value| merge::portable_meta(&value));
        }
    }
    project.skipped = outcome.skipped;
    project.conflicts = outcome.conflicts;
    project.remote_dirty = incomplete || outcome.quota_hit || round_error.is_some();
    if project.remote_dirty {
        project.remote_rev = None;
    }
    if round_error.is_none() {
        project.last_synced_ms = now_ms();
    }
    Ok(RoundResult {
        outcome,
        project,
        hlc: publisher.clock.last().raw(),
        error: round_error,
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
) -> Result<Vec<RemoteProject>, RoundError> {
    let entries = store.list("/projects").await?;
    let unknown: Vec<ProjectId> = entries
        .iter()
        .filter(|entry| entry.folder)
        .filter_map(|entry| ProjectId::parse(&entry.name).ok())
        .filter(|cloud| !known.contains(cloud))
        .take(500)
        .collect();
    let fetched: Vec<Result<Option<RemoteProject>, RoundError>> = stream::iter(unknown)
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
    let mut projects = Vec::new();
    for result in fetched {
        match result {
            Ok(Some(project)) => projects.push(project),
            Ok(None) => {}
            Err(error) if error.ends_round() => return Err(error),
            Err(_) => {}
        }
    }
    projects.sort_by_key(|project| std::cmp::Reverse(project.stamp_ms));
    Ok(projects)
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
            place_meta(&staged.path, &target, None)
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
    let (staged, failed) = stage_downloads(store, cloud, jobs, staging).await;
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
