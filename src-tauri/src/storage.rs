use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

const RECYCLE_MANIFEST: &str = "recycle.json";
const RECYCLED_PROJECT_DIRECTORY: &str = "project";
const CHECKPOINT_CLEANUP_DIRECTORY: &str = "checkpoint-cleanup-pending";
const CHECKPOINT_CLEANUP_SUFFIX: &str = ".json";
const CHECKPOINT_CLEANUP_VERSION: u8 = 1;

#[cfg(test)]
thread_local! {
    static DIRECTORY_SYNC_FAILURE: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static DIRECTORY_SYNC_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static RECYCLE_CRASH_POINT: std::cell::Cell<Option<RecycleCrashPoint>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
#[derive(Clone, Copy, Eq, PartialEq)]
enum RecycleCrashPoint {
    Manifest,
    RecycleMove,
    RestoreMove,
}

#[cfg(test)]
fn inject_directory_sync_failure(at: usize) {
    DIRECTORY_SYNC_COUNT.with(|count| count.set(0));
    DIRECTORY_SYNC_FAILURE.with(|failure| failure.set(Some(at)));
}

#[cfg(test)]
fn maybe_fail_directory_sync() -> Result<(), String> {
    let current = DIRECTORY_SYNC_COUNT.with(|count| {
        let current = count.get() + 1;
        count.set(current);
        current
    });
    if DIRECTORY_SYNC_FAILURE.with(|failure| failure.get()) == Some(current) {
        DIRECTORY_SYNC_FAILURE.with(|failure| failure.set(None));
        return Err("injected storage directory sync failure".into());
    }
    Ok(())
}

#[cfg(test)]
fn inject_recycle_crash(point: RecycleCrashPoint) {
    RECYCLE_CRASH_POINT.with(|requested| requested.set(Some(point)));
}

#[cfg(test)]
fn maybe_inject_recycle_crash(point: RecycleCrashPoint) -> Result<(), String> {
    if RECYCLE_CRASH_POINT.with(|requested| requested.get()) == Some(point) {
        RECYCLE_CRASH_POINT.with(|requested| requested.set(None));
        return Err("injected recycle crash".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct LibraryStorageSummary {
    pub total_bytes: u64,
    pub projects_bytes: u64,
    pub source_bytes: u64,
    pub image_bytes: u64,
    pub pdf_bytes: u64,
    pub git_bytes: u64,
    pub build_bytes: u64,
    pub recycle_bin_bytes: u64,
    pub app_data_bytes: u64,
    pub project_count: u64,
    pub recycled_project_count: u64,
    pub file_count: u64,
    pub directory_count: u64,
    pub image_count: u64,
    pub pdf_count: u64,
    pub unreadable_entries: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecycledProjectInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub deleted_at: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct RecycleManifest {
    project_id: String,
    name: String,
    deleted_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PendingCheckpointCleanup {
    version: u8,
    project_id: String,
    recycle_id: String,
}

#[derive(Clone, Copy)]
enum FileClass {
    Source,
    Image,
    Pdf,
    Git,
    Build,
    RecycleBin,
    AppData,
}

fn has_component(path: &Path, expected: &str) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(value) if value == expected))
}

fn is_project_build_file(relative: &Path) -> bool {
    let components = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    components
        .windows(2)
        .any(|pair| pair == [".oleafly", "build"])
}

fn classify_file(relative: &Path, in_projects: bool) -> FileClass {
    if relative.starts_with("recycle-bin") {
        return FileClass::RecycleBin;
    }
    if !in_projects {
        return FileClass::AppData;
    }
    if has_component(relative, ".git") {
        return FileClass::Git;
    }
    if is_project_build_file(relative) {
        return FileClass::Build;
    }
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff"
    ) {
        FileClass::Image
    } else if extension == "pdf" {
        FileClass::Pdf
    } else {
        FileClass::Source
    }
}

fn count_projects(projects_root: &Path, summary: &mut LibraryStorageSummary) {
    let Ok(entries) = std::fs::read_dir(projects_root) else {
        if projects_root.exists() {
            summary.unreadable_entries += 1;
        }
        return;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            summary.unreadable_entries += 1;
            continue;
        };
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            summary.unreadable_entries += 1;
            continue;
        };
        if metadata.is_dir()
            && !metadata.file_type().is_symlink()
            && entry.path().join("project.json").is_file()
        {
            summary.project_count += 1;
        }
    }
}

fn count_recycled_projects(recycle_root: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(recycle_root) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && entry.path().join(RECYCLE_MANIFEST).is_file()
                && entry.path().join(RECYCLED_PROJECT_DIRECTORY).is_dir()
        })
        .count() as u64
}

fn scan_storage(root: &Path) -> LibraryStorageSummary {
    let mut summary = LibraryStorageSummary::default();
    if !root.is_dir() {
        return summary;
    }

    let projects_root = root.join("projects");
    count_projects(&projects_root, &mut summary);
    let mut pending = vec![PathBuf::from(root)];

    while let Some(directory) = pending.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                summary.unreadable_entries += 1;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    summary.unreadable_entries += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    summary.unreadable_entries += 1;
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                summary.directory_count += 1;
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }

            let bytes = metadata.len();
            summary.file_count += 1;
            summary.total_bytes = summary.total_bytes.saturating_add(bytes);
            let relative = path.strip_prefix(root).unwrap_or(&path);
            let in_projects = relative.starts_with("projects");
            if in_projects {
                summary.projects_bytes = summary.projects_bytes.saturating_add(bytes);
            }
            match classify_file(relative, in_projects) {
                FileClass::Source => {
                    summary.source_bytes = summary.source_bytes.saturating_add(bytes)
                }
                FileClass::Image => {
                    summary.image_count += 1;
                    summary.image_bytes = summary.image_bytes.saturating_add(bytes);
                }
                FileClass::Pdf => {
                    summary.pdf_count += 1;
                    summary.pdf_bytes = summary.pdf_bytes.saturating_add(bytes);
                }
                FileClass::Git => summary.git_bytes = summary.git_bytes.saturating_add(bytes),
                FileClass::Build => summary.build_bytes = summary.build_bytes.saturating_add(bytes),
                FileClass::RecycleBin => {
                    summary.recycle_bin_bytes = summary.recycle_bin_bytes.saturating_add(bytes)
                }
                FileClass::AppData => {
                    summary.app_data_bytes = summary.app_data_bytes.saturating_add(bytes)
                }
            }
        }
    }
    summary.recycled_project_count = count_recycled_projects(&root.join("recycle-bin"));
    summary
}

fn timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn validate_real_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("failed to inspect {label}: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(format!("{label} is not a real directory"));
    }
    Ok(())
}

fn existing_recycle_bin_root() -> Result<Option<PathBuf>, String> {
    let data = crate::paths::oleafly_root()?;
    match std::fs::symlink_metadata(&data) {
        Ok(_) => validate_real_directory(&data, "Oleafly data directory")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("failed to inspect Oleafly data directory: {error}"));
        }
    }
    let data = data
        .canonicalize()
        .map_err(|error| format!("failed to resolve Oleafly data directory: {error}"))?;
    let root = data.join("recycle-bin");
    match std::fs::symlink_metadata(&root) {
        Ok(_) => validate_real_directory(&root, "recycle bin")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to inspect recycle bin: {error}")),
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve recycle bin: {error}"))?;
    if root.parent() != Some(data.as_path()) {
        return Err("recycle bin escapes the Oleafly data directory".into());
    }
    Ok(Some(root))
}

fn existing_checkpoint_cleanup_root() -> Result<Option<PathBuf>, String> {
    let data = crate::paths::oleafly_root()?;
    match std::fs::symlink_metadata(&data) {
        Ok(_) => validate_real_directory(&data, "Oleafly data directory")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("failed to inspect Oleafly data directory: {error}"));
        }
    }
    let data = data
        .canonicalize()
        .map_err(|error| format!("failed to resolve Oleafly data directory: {error}"))?;
    let root = data.join(CHECKPOINT_CLEANUP_DIRECTORY);
    match std::fs::symlink_metadata(&root) {
        Ok(_) => validate_real_directory(&root, "Checkpoint cleanup queue")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to inspect Checkpoint cleanup queue: {error}"
            ));
        }
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve Checkpoint cleanup queue: {error}"))?;
    if root.parent() != Some(data.as_path()) {
        return Err("Checkpoint cleanup queue escapes the Oleafly data directory".into());
    }
    Ok(Some(root))
}

fn checkpoint_cleanup_root() -> Result<PathBuf, String> {
    if let Some(root) = existing_checkpoint_cleanup_root()? {
        return Ok(root);
    }

    // Recycle operations already require this secured root. Its canonical
    // parent is the exact application-data directory that owns the queue.
    let recycle_root = crate::paths::recycle_bin_root()?;
    let data = recycle_root
        .parent()
        .ok_or_else(|| "recycle bin has no data-directory parent".to_string())?;
    let root = data.join(CHECKPOINT_CLEANUP_DIRECTORY);
    match std::fs::create_dir(&root) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!(
                "failed to create Checkpoint cleanup queue: {error}"
            ));
        }
    }
    validate_real_directory(&root, "Checkpoint cleanup queue")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("failed to protect Checkpoint cleanup queue: {error}"))?;
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve Checkpoint cleanup queue: {error}"))?;
    if root.parent() != Some(data) {
        return Err("Checkpoint cleanup queue escapes the Oleafly data directory".into());
    }
    // Persist the queue directory entry itself before any job is published.
    sync_directory(data)?;
    sync_directory(&root)?;
    Ok(root)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(test)]
    maybe_fail_directory_sync()?;
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("failed to save Checkpoint cleanup progress: {error}"))
}

#[cfg(windows)]
fn sync_directory(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;

    #[cfg(test)]
    maybe_fail_directory_sync()?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("failed to save Checkpoint cleanup progress: {error}"))
}

#[cfg(not(any(unix, windows)))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    #[cfg(test)]
    maybe_fail_directory_sync()?;
    Ok(())
}

fn open_regular_file_no_follow(path: &Path, label: &str) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("failed to open {label}: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("failed to inspect {label}: {error}"))?;
    let path_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("failed to inspect {label} path: {error}"))?;
    if !metadata.is_file()
        || is_reparse_point(&metadata)
        || !path_metadata.is_file()
        || path_metadata.file_type().is_symlink()
        || is_reparse_point(&path_metadata)
    {
        return Err(format!("{label} is not a regular file"));
    }
    Ok(file)
}

fn recycle_id_hash(recycle_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"oleafly-checkpoint-cleanup-v1\0");
    digest.update(recycle_id.as_bytes());
    format!("{:x}", digest.finalize())
}

fn cleanup_job_path(root: &Path, project_id: &str, recycle_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    crate::paths::validate_project_id(recycle_id)?;
    Ok(root.join(format!(
        "{project_id}.{}{CHECKPOINT_CLEANUP_SUFFIX}",
        recycle_id_hash(recycle_id)
    )))
}

fn cleanup_job_filename_identity(path: &Path) -> Result<(String, String), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "cleanup metadata name is not valid Unicode".to_string())?;
    let stem = name
        .strip_suffix(CHECKPOINT_CLEANUP_SUFFIX)
        .ok_or_else(|| "cleanup metadata has an unsupported name".to_string())?;
    let (project_id, recycle_hash) = stem
        .rsplit_once('.')
        .ok_or_else(|| "cleanup metadata has an unsupported name".to_string())?;
    crate::paths::validate_project_id(project_id)?;
    if recycle_hash.len() != 64
        || !recycle_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err("cleanup metadata has an invalid recycle identity".into());
    }
    Ok((project_id.to_string(), recycle_hash.to_string()))
}

fn read_cleanup_job(path: &Path) -> Result<PendingCheckpointCleanup, String> {
    let (project_id, recycle_hash) = cleanup_job_filename_identity(path)?;
    let mut file = open_regular_file_no_follow(path, "cleanup metadata")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read cleanup metadata: {error}"))?;
    let job: PendingCheckpointCleanup = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse cleanup metadata: {error}"))?;
    if job.version != CHECKPOINT_CLEANUP_VERSION {
        return Err("cleanup metadata has an unsupported version".into());
    }
    crate::paths::validate_project_id(&job.project_id)?;
    crate::paths::validate_project_id(&job.recycle_id)?;
    if job.project_id != project_id || recycle_id_hash(&job.recycle_id) != recycle_hash {
        return Err("cleanup metadata identity does not match its filename".into());
    }
    Ok(job)
}

fn write_cleanup_job(job: &PendingCheckpointCleanup) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(&job.project_id)?;
    crate::paths::validate_project_id(&job.recycle_id)?;
    if job.version != CHECKPOINT_CLEANUP_VERSION {
        return Err("cleanup metadata has an unsupported version".into());
    }
    let root = checkpoint_cleanup_root()?;
    let destination = cleanup_job_path(&root, &job.project_id, &job.recycle_id)?;
    match std::fs::symlink_metadata(&destination) {
        Ok(_) => {
            if read_cleanup_job(&destination)? == *job {
                return Ok(destination);
            }
            return Err("a conflicting Checkpoint cleanup job already exists".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to inspect Checkpoint cleanup destination: {error}"
            ));
        }
    }

    let bytes = serde_json::to_vec(job)
        .map_err(|error| format!("failed to encode Checkpoint cleanup metadata: {error}"))?;
    for _ in 0..10_000 {
        let temporary = root.join(format!(
            ".cleanup-{}-{:016x}.tmp",
            std::process::id(),
            rand::random::<u64>()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt as _;
            use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let mut file = match options.open(&temporary) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create Checkpoint cleanup metadata: {error}"
                ));
            }
        };
        #[cfg(windows)]
        crate::fsperm::harden_file(&temporary);
        let result = (|| {
            file.write_all(&bytes)
                .map_err(|error| format!("failed to write Checkpoint cleanup metadata: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("failed to save Checkpoint cleanup metadata: {error}"))?;
            drop(file);
            std::fs::rename(&temporary, &destination).map_err(|error| {
                format!("failed to publish Checkpoint cleanup metadata: {error}")
            })?;
            sync_directory(&root)?;
            Ok(destination.clone())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        return result;
    }
    Err("could not reserve Checkpoint cleanup metadata".into())
}

fn pending_cleanup_jobs() -> Result<Vec<(PathBuf, PendingCheckpointCleanup)>, String> {
    let Some(root) = existing_checkpoint_cleanup_root()? else {
        return Ok(Vec::new());
    };
    let entries = std::fs::read_dir(&root)
        .map_err(|error| format!("failed to read Checkpoint cleanup queue: {error}"))?;
    let mut jobs = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("failed to inspect Checkpoint cleanup queue: {error}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err("Checkpoint cleanup queue contains a non-Unicode entry".into());
        };
        if name.starts_with(".cleanup-") && name.ends_with(".tmp") {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("failed to inspect Checkpoint cleanup entry: {error}"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("Checkpoint cleanup queue contains an unsafe entry".into());
        }
        jobs.push((path.clone(), read_cleanup_job(&path)?));
    }
    jobs.sort_by(|left, right| left.1.recycle_id.cmp(&right.1.recycle_id));
    Ok(jobs)
}

fn pending_cleanup_project_ids() -> Result<std::collections::HashSet<String>, String> {
    let Some(root) = existing_checkpoint_cleanup_root()? else {
        return Ok(std::collections::HashSet::new());
    };
    let entries = std::fs::read_dir(&root)
        .map_err(|error| format!("failed to read Checkpoint cleanup queue: {error}"))?;
    let mut project_ids = std::collections::HashSet::new();
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("failed to inspect Checkpoint cleanup queue: {error}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err("Checkpoint cleanup queue contains a non-Unicode entry".into());
        };
        if name.starts_with(".cleanup-") && name.ends_with(".tmp") {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("failed to inspect Checkpoint cleanup entry: {error}"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("Checkpoint cleanup queue contains an unsafe entry".into());
        }
        let (project_id, _) = cleanup_job_filename_identity(&path)?;
        project_ids.insert(project_id);
    }
    Ok(project_ids)
}

fn clear_cleanup_job(path: &Path, expected: &PendingCheckpointCleanup) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to inspect completed Checkpoint cleanup metadata: {error}"
            ));
        }
        Ok(_) => {}
    }
    if read_cleanup_job(path)? != *expected {
        return Err("Checkpoint cleanup metadata changed before completion".into());
    }
    let root = path
        .parent()
        .ok_or_else(|| "Checkpoint cleanup metadata has no parent".to_string())?;
    std::fs::remove_file(path)
        .map_err(|error| format!("failed to clear Checkpoint cleanup metadata: {error}"))?;
    sync_directory(root)
}

fn recycle_entry_dir(recycle_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(recycle_id)?;
    let root = crate::paths::recycle_bin_root()?;
    let entry = root.join(recycle_id);
    let metadata = std::fs::symlink_metadata(&entry).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("recycled project does not exist: {recycle_id}")
        } else {
            format!("failed to inspect recycled project: {error}")
        }
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("recycled project path is not a real directory".into());
    }
    let entry = entry
        .canonicalize()
        .map_err(|error| format!("failed to resolve recycled project: {error}"))?;
    if entry.parent() != Some(root.as_path()) {
        return Err("recycled project path escapes the recycle bin".into());
    }
    Ok(entry)
}

fn read_recycle_manifest(entry: &Path) -> Result<RecycleManifest, String> {
    let path = entry.join(RECYCLE_MANIFEST);
    let mut file = open_regular_file_no_follow(&path, "recycle metadata")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read recycle metadata: {error}"))?;
    let manifest: RecycleManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse recycle metadata: {error}"))?;
    crate::paths::validate_project_id(&manifest.project_id)?;
    Ok(manifest)
}

fn recycled_project_dir(entry: &Path) -> Result<PathBuf, String> {
    let project = entry.join(RECYCLED_PROJECT_DIRECTORY);
    let metadata = std::fs::symlink_metadata(&project)
        .map_err(|error| format!("failed to inspect recycled project files: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("recycled project files are not a real directory".into());
    }
    let project = project
        .canonicalize()
        .map_err(|error| format!("failed to resolve recycled project files: {error}"))?;
    if project.parent() != Some(entry) {
        return Err("recycled project files escape their recycle entry".into());
    }
    Ok(project)
}

fn active_project_identity_exists(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let projects_root = crate::paths::projects_root()?
        .canonicalize()
        .map_err(|error| format!("failed to resolve projects root: {error}"))?;
    let project = projects_root.join(project_id);
    match std::fs::symlink_metadata(project) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to inspect active project identity: {error}"
        )),
    }
}

fn valid_active_project_owner_exists(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let projects_root = crate::paths::projects_root()?
        .canonicalize()
        .map_err(|error| format!("failed to resolve projects root: {error}"))?;
    let project = projects_root.join(project_id);
    let metadata = match std::fs::symlink_metadata(&project) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("failed to inspect active project owner: {error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("active project owner is not a real directory".into());
    }
    let resolved = project
        .canonicalize()
        .map_err(|error| format!("failed to resolve active project owner: {error}"))?;
    if resolved.parent() != Some(projects_root.as_path()) {
        return Err("active project owner escapes the projects directory".into());
    }
    Ok(true)
}

fn reconcile_manifest_only_recycle_entries(project_id: &str) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    let root = crate::paths::recycle_bin_root()?;
    let mut manifest_only = Vec::new();
    let mut payload_owner = false;
    for entry in std::fs::read_dir(&root)
        .map_err(|error| format!("failed to inspect recycle owners: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect recycle owner: {error}"))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("failed to inspect recycle owner path: {error}"))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("cannot reconcile an unsafe recycle owner".into());
        }
        if !metadata.is_dir() {
            continue;
        }
        let path = path
            .canonicalize()
            .map_err(|error| format!("failed to resolve recycle owner: {error}"))?;
        if path.parent() != Some(root.as_path()) {
            return Err("recycle owner escapes the recycle bin".into());
        }
        let manifest_path = path.join(RECYCLE_MANIFEST);
        match std::fs::symlink_metadata(&manifest_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if std::fs::symlink_metadata(path.join(RECYCLED_PROJECT_DIRECTORY)).is_ok() {
                    return Err(
                        "a recycle owner has project files without identity metadata".into(),
                    );
                }
                continue;
            }
            Err(error) => return Err(format!("failed to inspect recycle owner metadata: {error}")),
            Ok(_) => {}
        }
        let manifest = read_recycle_manifest(&path)?;
        if manifest.project_id != project_id {
            continue;
        }
        let project = path.join(RECYCLED_PROJECT_DIRECTORY);
        match std::fs::symlink_metadata(&project) {
            Ok(metadata) => {
                if !metadata.is_dir()
                    || metadata.file_type().is_symlink()
                    || is_reparse_point(&metadata)
                {
                    return Err("recycle owner project is not a real directory".into());
                }
                let resolved = project
                    .canonicalize()
                    .map_err(|error| format!("failed to resolve recycle owner project: {error}"))?;
                if resolved.parent() != Some(path.as_path()) {
                    return Err("recycle owner project escapes its entry".into());
                }
                payload_owner = true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                manifest_only.push(path);
            }
            Err(error) => {
                return Err(format!("failed to inspect recycle owner project: {error}"));
            }
        }
    }

    if manifest_only.is_empty()
        || (!payload_owner && !valid_active_project_owner_exists(project_id)?)
    {
        return Ok(());
    }

    for entry in manifest_only {
        let identity = same_file::Handle::from_path(&entry)
            .map_err(|error| format!("failed to bind manifest-only recycle entry: {error}"))?;
        if read_recycle_manifest(&entry)?.project_id != project_id {
            return Err("manifest-only recycle identity changed before reconciliation".into());
        }
        match std::fs::symlink_metadata(entry.join(RECYCLED_PROJECT_DIRECTORY)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => continue,
            Err(error) => {
                return Err(format!(
                    "failed to recheck manifest-only recycle project: {error}"
                ));
            }
        }
        let entries = std::fs::read_dir(&entry)
            .map_err(|error| format!("failed to inspect manifest-only recycle entry: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to inspect manifest-only recycle entry: {error}"))?;
        if entries.len() != 1 || entries[0].file_name() != RECYCLE_MANIFEST {
            return Err("manifest-only recycle entry contains unexpected data".into());
        }
        let current = same_file::Handle::from_path(&entry)
            .map_err(|error| format!("failed to recheck manifest-only recycle entry: {error}"))?;
        if current != identity {
            return Err("manifest-only recycle entry changed before reconciliation".into());
        }
        std::fs::remove_file(entry.join(RECYCLE_MANIFEST))
            .map_err(|error| format!("failed to clear orphaned recycle metadata: {error}"))?;
        sync_directory(&entry)?;
        std::fs::remove_dir(&entry)
            .map_err(|error| format!("failed to clear orphaned recycle entry: {error}"))?;
        sync_directory(&root)?;
    }
    Ok(())
}

fn remove_cleanup_target_if_present(job: &PendingCheckpointCleanup) -> Result<(), String> {
    crate::paths::validate_project_id(&job.project_id)?;
    crate::paths::validate_project_id(&job.recycle_id)?;
    reconcile_manifest_only_recycle_entries(&job.project_id)?;
    let root = crate::paths::recycle_bin_root()?;
    let requested = root.join(&job.recycle_id);
    let metadata = match std::fs::symlink_metadata(&requested) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to inspect pending recycled project: {error}"
            ));
        }
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("pending recycled project path is not a real directory".into());
    }
    let entry = requested
        .canonicalize()
        .map_err(|error| format!("failed to resolve pending recycled project: {error}"))?;
    if entry.parent() != Some(root.as_path()) {
        return Err("pending recycled project escapes the recycle bin".into());
    }
    let identity = same_file::Handle::from_path(&entry)
        .map_err(|error| format!("failed to bind pending recycled project: {error}"))?;
    let manifest = read_recycle_manifest(&entry)?;
    if manifest.project_id != job.project_id {
        return Err("pending recycled project identity does not match its cleanup job".into());
    }
    let project = entry.join(RECYCLED_PROJECT_DIRECTORY);
    match std::fs::symlink_metadata(&project) {
        Ok(project_metadata) => {
            if !project_metadata.is_dir()
                || project_metadata.file_type().is_symlink()
                || is_reparse_point(&project_metadata)
            {
                return Err("pending recycled project files are not a real directory".into());
            }
            let project = project.canonicalize().map_err(|error| {
                format!("failed to resolve pending recycled project files: {error}")
            })?;
            if project.parent() != Some(entry.as_path()) {
                return Err("pending recycled project files escape their recycle entry".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // A prior recursive deletion may already have removed the payload.
            // The exact durable job plus the still-matching manifest prove the
            // remaining entry's identity, so finishing its removal is safe.
        }
        Err(error) => {
            return Err(format!(
                "failed to inspect pending recycled project files: {error}"
            ));
        }
    }
    let current_identity = same_file::Handle::from_path(&requested)
        .map_err(|error| format!("failed to recheck pending recycled project: {error}"))?;
    if current_identity != identity {
        return Err("pending recycled project changed before deletion".into());
    }
    std::fs::remove_dir_all(&requested)
        .map_err(|error| format!("failed to permanently delete recycled project: {error}"))?;
    sync_directory(&root)
}

fn recycled_identity_exists_in_root(project_id: &str, root: &Path) -> Result<bool, String> {
    let entries =
        std::fs::read_dir(root).map_err(|error| format!("failed to read recycle bin: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to inspect recycle bin: {error}"))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("failed to inspect recycle entry: {error}"))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(
                "cannot prove Checkpoint ownership while the recycle bin contains an unsafe entry"
                    .into(),
            );
        }
        if !metadata.is_dir() {
            continue;
        }
        let path = path
            .canonicalize()
            .map_err(|error| format!("failed to resolve recycle entry: {error}"))?;
        if path.parent() != Some(root) {
            return Err("recycle entry escapes the recycle bin".into());
        }

        let manifest_path = path.join(RECYCLE_MANIFEST);
        match std::fs::symlink_metadata(&manifest_path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // An empty allocation left behind before the project move does
                // not own history. A recoverable worktree without readable
                // identity data does, so fail closed instead of guessing.
                if std::fs::symlink_metadata(path.join(RECYCLED_PROJECT_DIRECTORY)).is_ok() {
                    return Err(
                        "cannot prove Checkpoint ownership for a recycled project without metadata"
                            .into(),
                    );
                }
                continue;
            }
            Err(error) => {
                return Err(format!("failed to inspect recycle metadata: {error}"));
            }
        }
        let manifest = read_recycle_manifest(&path)?;
        if manifest.project_id == project_id {
            return Ok(true);
        }
    }
    Ok(false)
}

fn recycled_identity_exists(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let root = crate::paths::recycle_bin_root()?;
    recycled_identity_exists_in_root(project_id, &root)
}

/// Checks recycle and cleanup reservations while the caller already holds the
/// project's external worktree lock. This deliberately performs no retry or
/// cleanup work, so it cannot recursively acquire that lock.
pub(crate) fn recycled_project_identity_reserved_lock_held(
    project_id: &str,
) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    if let Some(root) = existing_recycle_bin_root()? {
        if recycled_identity_exists_in_root(project_id, &root)? {
            return Ok(true);
        }
    }
    Ok(pending_cleanup_project_ids()?.contains(project_id))
}

fn complete_cleanup_job_locked(
    path: &Path,
    expected: &PendingCheckpointCleanup,
) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to inspect pending Checkpoint cleanup: {error}"
            ));
        }
        Ok(_) => {}
    }
    if read_cleanup_job(path)? != *expected {
        return Err("Checkpoint cleanup metadata changed before retry".into());
    }
    // The job may have been published immediately before a crash. Resume the
    // exact intended recycle deletion first, while its manifest still proves
    // the project identity. A mismatched or partially unprovable entry stays
    // fail-closed with the durable job intact.
    remove_cleanup_target_if_present(expected)?;
    if active_project_identity_exists(&expected.project_id)?
        || recycled_identity_exists(&expected.project_id)?
    {
        // This identity still has a visible owner. The pending deletion stays
        // durable and reserved, but must not erase shared external history.
        return Ok(());
    }
    crate::checkpoints::remove_project_checkpoint_data(&expected.project_id)?;
    clear_cleanup_job(path, expected)
}

pub(crate) fn retry_pending_checkpoint_cleanup() -> Result<(), String> {
    let jobs = pending_cleanup_jobs()?;
    let mut failures = Vec::new();
    for (path, job) in jobs {
        let result = (|| {
            let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&job.project_id)?;
            complete_cleanup_job_locked(&path, &job)
        })();
        if let Err(error) = result {
            failures.push(format!("{}: {error}", job.project_id));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "could not finish pending Checkpoint cleanup: {}",
            failures.join(", ")
        ))
    }
}

fn directory_size(root: &Path) -> u64 {
    let Ok(root) = root.canonicalize() else {
        return 0;
    };
    let mut bytes = 0_u64;
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
            } else if metadata.is_dir() {
                let Ok(resolved) = path.canonicalize() else {
                    continue;
                };
                if resolved.starts_with(&root) {
                    pending.push(resolved);
                }
            }
        }
    }
    bytes
}

pub(crate) fn recycle_project_directory(
    project_id: &str,
    name: &str,
    project_directory: &Path,
) -> Result<String, String> {
    crate::paths::validate_project_id(project_id)?;
    let recycle_root = crate::paths::recycle_bin_root()?;
    let deleted_at = timestamp_seconds();
    let timestamp = timestamp_millis();
    let (recycle_id, entry) = (0_u16..1000)
        .find_map(|suffix| {
            let id = format!("{timestamp}-{suffix}-{project_id}");
            let entry = recycle_root.join(&id);
            match std::fs::create_dir(&entry) {
                Ok(()) => Some(Ok((id, entry))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(format!("failed to create recycle entry: {error}"))),
            }
        })
        .transpose()?
        .ok_or_else(|| "failed to allocate a unique recycle entry".to_string())?;

    if let Err(error) = sync_directory(&recycle_root) {
        let _ = std::fs::remove_dir(&entry);
        let _ = sync_directory(&recycle_root);
        return Err(error);
    }

    let manifest = RecycleManifest {
        project_id: project_id.to_string(),
        name: if name.trim().is_empty() {
            project_id.to_string()
        } else {
            name.to_string()
        },
        deleted_at,
    };
    let manifest_path = entry.join(RECYCLE_MANIFEST);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("failed to encode recycle metadata: {error}"))?;
    let manifest_result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt as _;
            use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let mut file = options
            .open(&manifest_path)
            .map_err(|error| format!("failed to create recycle metadata: {error}"))?;
        #[cfg(windows)]
        crate::fsperm::harden_file(&manifest_path);
        file.write_all(&manifest_bytes)
            .map_err(|error| format!("failed to write recycle metadata: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("failed to save recycle metadata: {error}"))?;
        sync_directory(&entry)
    })();
    if let Err(error) = manifest_result {
        let _ = std::fs::remove_file(&manifest_path);
        let _ = std::fs::remove_dir(&entry);
        let _ = sync_directory(&recycle_root);
        return Err(error);
    }

    #[cfg(test)]
    maybe_inject_recycle_crash(RecycleCrashPoint::Manifest)?;

    let recycled_project = entry.join(RECYCLED_PROJECT_DIRECTORY);
    let project_parent = project_directory
        .parent()
        .ok_or_else(|| "project directory has no parent".to_string())?;
    if let Err(error) = std::fs::rename(project_directory, &recycled_project) {
        let _ = std::fs::remove_file(manifest_path);
        let _ = std::fs::remove_dir(entry);
        let _ = sync_directory(&recycle_root);
        return Err(format!(
            "failed to move project to the recycle bin: {error}"
        ));
    }
    if let Err(error) = sync_directory(&entry).and_then(|_| sync_directory(project_parent)) {
        let rollback = std::fs::rename(&recycled_project, project_directory)
            .map_err(|rollback_error| rollback_error.to_string())
            .and_then(|_| sync_directory(project_parent))
            .and_then(|_| sync_directory(&entry));
        if rollback.is_ok() {
            let _ = std::fs::remove_file(&manifest_path);
            let _ = std::fs::remove_dir(&entry);
            let _ = sync_directory(&recycle_root);
            return Err(error);
        }
        return Err(format!(
            "{error}. The project also could not be returned to the active library: {}",
            rollback.unwrap_err()
        ));
    }
    #[cfg(test)]
    maybe_inject_recycle_crash(RecycleCrashPoint::RecycleMove)?;
    Ok(recycle_id)
}

#[cfg(test)]
pub(crate) fn recycled_project_ids() -> Result<std::collections::HashSet<String>, String> {
    let _ = retry_pending_checkpoint_cleanup();
    let root = crate::paths::recycle_bin_root()?;
    let entries =
        std::fs::read_dir(&root).map_err(|error| format!("failed to read recycle bin: {error}"))?;
    let mut ids = std::collections::HashSet::new();
    for entry in entries.flatten() {
        let recycle_id = entry.file_name().to_string_lossy().into_owned();
        let Ok(entry) = recycle_entry_dir(&recycle_id) else {
            continue;
        };
        let Ok(manifest) = read_recycle_manifest(&entry) else {
            continue;
        };
        ids.insert(manifest.project_id);
    }
    ids.extend(pending_cleanup_project_ids()?);
    Ok(ids)
}

fn list_recycled_projects_sync() -> Result<Vec<RecycledProjectInfo>, String> {
    let _ = retry_pending_checkpoint_cleanup();
    let root = crate::paths::recycle_bin_root()?;
    let entries =
        std::fs::read_dir(&root).map_err(|error| format!("failed to read recycle bin: {error}"))?;
    let mut projects = Vec::new();
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        let Ok(entry) = recycle_entry_dir(&id) else {
            continue;
        };
        let Ok(manifest) = read_recycle_manifest(&entry) else {
            continue;
        };
        let Ok(project) = recycled_project_dir(&entry) else {
            continue;
        };
        projects.push(RecycledProjectInfo {
            id,
            project_id: manifest.project_id,
            name: manifest.name,
            deleted_at: manifest.deleted_at,
            size_bytes: directory_size(&project),
        });
    }
    projects.sort_by_key(|project| std::cmp::Reverse(project.deleted_at));
    Ok(projects)
}

fn restore_recycled_project_sync(recycle_id: &str) -> Result<String, String> {
    let entry = recycle_entry_dir(recycle_id)?;
    let recycle_root = entry
        .parent()
        .ok_or_else(|| "recycled project has no recycle-bin parent".to_string())?
        .to_path_buf();
    let manifest = read_recycle_manifest(&entry)?;
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&manifest.project_id)?;
    let project = recycled_project_dir(&entry)?;
    let projects_root = crate::paths::projects_root()?
        .canonicalize()
        .map_err(|error| format!("failed to resolve projects root: {error}"))?;
    let destination = projects_root.join(&manifest.project_id);
    if destination.exists() {
        return Err(format!(
            "a project with id {} already exists; rename or remove it before restoring",
            manifest.project_id
        ));
    }
    std::fs::rename(&project, &destination)
        .map_err(|error| format!("failed to restore project: {error}"))?;
    if let Err(error) = sync_directory(&projects_root).and_then(|_| sync_directory(&entry)) {
        return match move_active_project_back_to_recycle(
            &destination,
            &project,
            &entry,
            &projects_root,
        ) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}. The project also could not be returned to the Recycle Bin: {rollback_error}"
            )),
        };
    }
    #[cfg(test)]
    maybe_inject_recycle_crash(RecycleCrashPoint::RestoreMove)?;
    // The destination lock was acquired while the active path was absent. A
    // recycle entry written by an older build may still carry a durable
    // Checkpoint restore marker, so recover it under this already-held
    // exclusive lock before exposing the active project. If recovery cannot
    // be proven, move the complete worktree back into the recycle entry.
    if let Err(recovery_error) =
        crate::checkpoints::recover_interrupted_restore_lock_held(&manifest.project_id)
    {
        return match move_active_project_back_to_recycle(
            &destination,
            &project,
            &entry,
            &projects_root,
        ) {
            Ok(()) => Err(format!(
                "the recycled project still needs Checkpoint recovery and was kept in the Recycle Bin: {recovery_error}"
            )),
            Err(rollback_error) => Err(format!(
                "Checkpoint recovery failed after restoring the project: {recovery_error}. The project also could not be returned to the Recycle Bin: {rollback_error}"
            )),
        };
    }
    std::fs::remove_file(entry.join(RECYCLE_MANIFEST))
        .map_err(|error| format!("failed to clear restored recycle metadata: {error}"))?;
    sync_directory(&entry)?;
    std::fs::remove_dir(&entry)
        .map_err(|error| format!("failed to clear restored recycle entry: {error}"))?;
    sync_directory(&recycle_root)?;
    Ok(manifest.project_id)
}

fn move_active_project_back_to_recycle(
    active: &Path,
    recycled: &Path,
    recycle_entry: &Path,
    projects_root: &Path,
) -> Result<(), String> {
    std::fs::rename(active, recycled)
        .map_err(|error| format!("failed to move project back to the Recycle Bin: {error}"))?;
    sync_directory(recycle_entry)?;
    sync_directory(projects_root)
}

fn permanently_delete_recycled_project_sync(recycle_id: &str) -> Result<(), String> {
    let entry = recycle_entry_dir(recycle_id)?;
    let manifest = read_recycle_manifest(&entry)?;
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&manifest.project_id)?;
    let cleanup = PendingCheckpointCleanup {
        version: CHECKPOINT_CLEANUP_VERSION,
        project_id: manifest.project_id.clone(),
        recycle_id: recycle_id.to_string(),
    };
    // The durable job is published before the recoverable worktree disappears.
    // A crash or later Store::destroy failure therefore remains retryable.
    let cleanup_path = write_cleanup_job(&cleanup)?;
    remove_cleanup_target_if_present(&cleanup)?;
    complete_cleanup_job_locked(&cleanup_path, &cleanup).map_err(|error| {
        format!("the project was deleted, but its Checkpoints cleanup failed: {error}")
    })
}

#[tauri::command]
pub async fn library_storage_summary() -> Result<LibraryStorageSummary, String> {
    let root = crate::paths::oleafly_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _ = retry_pending_checkpoint_cleanup();
        scan_storage(&root)
    })
    .await
    .map_err(|error| format!("failed to inspect Oleafly storage: {error}"))
}

#[tauri::command]
pub async fn list_recycled_projects() -> Result<Vec<RecycledProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_recycled_projects_sync)
        .await
        .map_err(|error| format!("failed to inspect recycle bin: {error}"))?
}

#[tauri::command]
pub async fn restore_recycled_project(
    recycle_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || restore_recycled_project_sync(&recycle_id))
        .await
        .map_err(|error| format!("failed to restore recycled project: {error}"))?
}

#[tauri::command]
pub async fn permanently_delete_recycled_project(
    recycle_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        permanently_delete_recycled_project_sync(&recycle_id)
    })
    .await
    .map_err(|error| format!("failed to permanently delete recycled project: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_scan_reports_disjoint_categories_without_following_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let project = root.join("projects/paper");
        std::fs::create_dir_all(project.join("figures")).unwrap();
        std::fs::create_dir_all(project.join(".git/objects")).unwrap();
        std::fs::create_dir_all(project.join(".oleafly/build")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::create_dir_all(root.join("recycle-bin/deleted/project")).unwrap();
        std::fs::write(project.join("project.json"), b"{}").unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();
        std::fs::write(project.join("figures/chart.png"), b"image").unwrap();
        std::fs::write(project.join("paper.pdf"), b"pdf").unwrap();
        std::fs::write(project.join(".git/objects/a"), b"git!").unwrap();
        std::fs::write(project.join(".oleafly/build/main.aux"), b"build").unwrap();
        std::fs::write(root.join("assets/font.bin"), b"asset").unwrap();
        std::fs::write(root.join("recycle-bin/deleted/project/main.tex"), b"old").unwrap();

        let summary = scan_storage(root);
        assert_eq!(summary.project_count, 1);
        assert_eq!(summary.file_count, 8);
        assert_eq!(summary.image_count, 1);
        assert_eq!(summary.pdf_count, 1);
        assert_eq!(summary.image_bytes, 5);
        assert_eq!(summary.pdf_bytes, 3);
        assert_eq!(summary.git_bytes, 4);
        assert_eq!(summary.build_bytes, 5);
        assert_eq!(summary.app_data_bytes, 5);
        assert_eq!(summary.recycle_bin_bytes, 3);
        assert_eq!(
            summary.source_bytes
                + summary.image_bytes
                + summary.pdf_bytes
                + summary.git_bytes
                + summary.build_bytes
                + summary.recycle_bin_bytes
                + summary.app_data_bytes,
            summary.total_bytes
        );
    }

    #[test]
    fn recycled_project_can_be_listed_restored_and_permanently_deleted() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();

        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        assert!(!project.exists());
        assert!(checkpoint_store.exists());
        let listed = list_recycled_projects_sync().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, recycle_id);
        assert_eq!(listed[0].project_id, project_id);
        assert_eq!(listed[0].name, "Paper");
        assert!(listed[0].size_bytes > 0);

        assert_eq!(
            restore_recycled_project_sync(&recycle_id).unwrap(),
            project_id
        );
        assert!(project.join("main.tex").is_file());
        assert!(checkpoint_store.exists());
        assert!(list_recycled_projects_sync().unwrap().is_empty());

        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        permanently_delete_recycled_project_sync(&recycle_id).unwrap();
        assert!(list_recycled_projects_sync().unwrap().is_empty());
        assert!(!checkpoint_store.exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn recycling_requires_durable_directory_updates_before_reporting_success() {
        let _env_guard = crate::paths::data_dir_env_lock();
        for failed_sync in 1..=4 {
            let directory = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
            let project = crate::paths::projects_root().unwrap().join("paper");
            std::fs::create_dir(&project).unwrap();
            std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

            inject_directory_sync_failure(failed_sync);
            let error = recycle_project_directory("paper", "Paper", &project).unwrap_err();

            assert!(error.contains("injected storage directory sync failure"));
            assert!(
                project.exists(),
                "failed sync {failed_sync} lost the active project"
            );
        }
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn crash_after_recycle_manifest_publish_keeps_the_active_owner_reserved() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::projects_root().unwrap().join("paper");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

        inject_recycle_crash(RecycleCrashPoint::Manifest);
        let error = recycle_project_directory("paper", "Paper", &project).unwrap_err();

        assert!(error.contains("injected recycle crash"));
        assert!(project.exists());
        assert!(recycled_project_ids().unwrap().contains("paper"));
        assert!(list_recycled_projects_sync().unwrap().is_empty());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn later_payload_owner_allows_manifest_only_crash_record_to_be_reaped() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::projects_root().unwrap().join("paper");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let store_path = crate::paths::checkpoint_store_dir("paper").unwrap();
        oleafly_history::Store::open(&store_path).unwrap();

        inject_recycle_crash(RecycleCrashPoint::Manifest);
        recycle_project_directory("paper", "Paper", &project).unwrap_err();
        let recycle_id = recycle_project_directory("paper", "Paper", &project).unwrap();
        permanently_delete_recycled_project_sync(&recycle_id).unwrap();

        assert!(!store_path.exists());
        assert!(!recycled_project_ids().unwrap().contains("paper"));
        let queue = directory.path().join(CHECKPOINT_CLEANUP_DIRECTORY);
        assert_eq!(std::fs::read_dir(queue).unwrap().count(), 0);
        assert_eq!(
            std::fs::read_dir(crate::paths::recycle_bin_root().unwrap())
                .unwrap()
                .count(),
            0
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn crash_after_recycle_move_keeps_the_recycled_owner_discoverable() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::projects_root().unwrap().join("paper");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();

        inject_recycle_crash(RecycleCrashPoint::RecycleMove);
        let error = recycle_project_directory("paper", "Paper", &project).unwrap_err();

        assert!(error.contains("injected recycle crash"));
        assert!(!project.exists());
        let recycled = list_recycled_projects_sync().unwrap();
        assert_eq!(recycled.len(), 1);
        assert_eq!(recycled[0].project_id, "paper");
        assert!(recycled_project_ids().unwrap().contains("paper"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restoring_requires_durable_directory_updates_and_keeps_one_worktree_owner() {
        let _env_guard = crate::paths::data_dir_env_lock();
        for failed_sync in 1..=4 {
            let directory = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
            let project = crate::paths::projects_root().unwrap().join("paper");
            std::fs::create_dir(&project).unwrap();
            std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
            std::fs::write(project.join("main.tex"), b"source").unwrap();
            let recycle_id = recycle_project_directory("paper", "Paper", &project).unwrap();
            let recycled = recycle_entry_dir(&recycle_id)
                .unwrap()
                .join(RECYCLED_PROJECT_DIRECTORY);

            inject_directory_sync_failure(failed_sync);
            let error = restore_recycled_project_sync(&recycle_id).unwrap_err();

            assert!(error.contains("injected storage directory sync failure"));
            assert_ne!(
                project.exists(),
                recycled.exists(),
                "failed sync {failed_sync} left zero or two worktree owners"
            );
            let owner = if project.exists() {
                &project
            } else {
                &recycled
            };
            assert_eq!(std::fs::read(owner.join("main.tex")).unwrap(), b"source");
        }
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn crash_after_restore_move_keeps_exactly_one_active_worktree_owner() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::projects_root().unwrap().join("paper");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();
        let recycle_id = recycle_project_directory("paper", "Paper", &project).unwrap();
        let entry = recycle_entry_dir(&recycle_id).unwrap();

        inject_recycle_crash(RecycleCrashPoint::RestoreMove);
        let error = restore_recycled_project_sync(&recycle_id).unwrap_err();

        assert!(error.contains("injected recycle crash"));
        assert!(project.exists());
        assert_eq!(std::fs::read(project.join("main.tex")).unwrap(), b"source");
        assert!(!entry.join(RECYCLED_PROJECT_DIRECTORY).exists());
        assert!(entry.join(RECYCLE_MANIFEST).is_file());
        assert!(list_recycled_projects_sync().unwrap().is_empty());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn recycled_project_ids_skip_corrupt_entries_and_keep_valid_reservations() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "reserved-project";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        recycle_project_directory(project_id, "Reserved", &project).unwrap();

        let corrupt_entry = crate::paths::recycle_bin_root()
            .unwrap()
            .join("corrupt-entry");
        std::fs::create_dir(&corrupt_entry).unwrap();
        std::fs::write(corrupt_entry.join(RECYCLE_MANIFEST), b"not json").unwrap();

        let ids = recycled_project_ids().unwrap();
        assert_eq!(
            ids,
            std::collections::HashSet::from([project_id.to_string()])
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn lock_held_reservation_check_is_targeted_and_does_not_mutate_storage() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("missing-data-root");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        assert!(!recycled_project_identity_reserved_lock_held("available-project").unwrap());
        assert!(
            !data.exists(),
            "a read-only reservation check must not create application storage"
        );

        let recycled_id = "recycled-project";
        let project = crate::paths::projects_root().unwrap().join(recycled_id);
        std::fs::create_dir(&project).unwrap();
        let recycle_entry = recycle_project_directory(recycled_id, "Recycled", &project).unwrap();
        assert!(recycled_project_identity_reserved_lock_held(recycled_id).unwrap());
        assert!(recycle_entry_dir(&recycle_entry).unwrap().exists());

        let pending_id = "pending-project";
        let pending = PendingCheckpointCleanup {
            version: CHECKPOINT_CLEANUP_VERSION,
            project_id: pending_id.into(),
            recycle_id: "pending-recycle".into(),
        };
        let pending_path = write_cleanup_job(&pending).unwrap();
        assert!(recycled_project_identity_reserved_lock_held(pending_id).unwrap());
        assert!(
            pending_path.exists(),
            "the check must not consume cleanup jobs"
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn deleting_a_recycled_identity_never_removes_an_active_projects_history() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Old"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Old", &project).unwrap();
        assert!(recycled_project_ids().unwrap().contains(project_id));

        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Active"}"#).unwrap();
        permanently_delete_recycled_project_sync(&recycle_id).unwrap();

        assert!(project.exists());
        assert!(checkpoint_store.exists());
        assert!(list_recycled_projects_sync().unwrap().is_empty());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn failed_checkpoint_cleanup_stays_reserved_and_retries_from_listing() {
        use std::os::unix::fs::symlink;

        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "pending-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

        let checkpoints = directory.path().join("checkpoints");
        std::fs::create_dir(&checkpoints).unwrap();
        let outside = directory.path().join("outside-store");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, checkpoints.join(project_id)).unwrap();

        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let error = permanently_delete_recycled_project_sync(&recycle_id).unwrap_err();
        assert!(error.contains("Checkpoints cleanup failed"));
        assert!(!project.exists());
        assert!(list_recycled_projects_sync().unwrap().is_empty());
        assert!(recycled_project_ids().unwrap().contains(project_id));

        std::fs::remove_file(checkpoints.join(project_id)).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();

        assert!(list_recycled_projects_sync().unwrap().is_empty());
        assert!(!checkpoint_store.exists());
        assert!(!recycled_project_ids().unwrap().contains(project_id));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn corrupt_cleanup_metadata_fails_closed_and_keeps_the_project_id_reserved() {
        use std::os::unix::fs::symlink;

        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "corrupt-pending-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

        let checkpoints = directory.path().join("checkpoints");
        std::fs::create_dir(&checkpoints).unwrap();
        let outside = directory.path().join("outside-store");
        std::fs::create_dir(&outside).unwrap();
        let linked_store = checkpoints.join(project_id);
        symlink(&outside, &linked_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        permanently_delete_recycled_project_sync(&recycle_id).unwrap_err();

        let queue = directory.path().join(CHECKPOINT_CLEANUP_DIRECTORY);
        let cleanup = std::fs::read_dir(&queue)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        std::fs::write(&cleanup, b"corrupt").unwrap();

        assert!(retry_pending_checkpoint_cleanup().is_err());
        assert!(recycled_project_ids().unwrap().contains(project_id));
        assert!(linked_store.is_symlink());
        assert!(outside.exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn detached_store_cleanup_failure_keeps_the_durable_job_until_retry_finishes() {
        use std::os::unix::ffi::OsStrExt as _;

        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "detached-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let blocked = checkpoint_store.join("blocked.fifo");
        let blocked_c = std::ffi::CString::new(blocked.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(blocked_c.as_ptr(), 0o600) }, 0);
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();

        permanently_delete_recycled_project_sync(&recycle_id).unwrap_err();
        assert!(!checkpoint_store.exists());
        assert!(recycled_project_ids().unwrap().contains(project_id));
        let queue = directory.path().join(CHECKPOINT_CLEANUP_DIRECTORY);
        assert_eq!(std::fs::read_dir(&queue).unwrap().count(), 1);

        let checkpoints = directory.path().join("checkpoints");
        let detached = std::fs::read_dir(&checkpoints)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".detached-paper.deleting."))
            })
            .expect("Store::destroy keeps its detached directory on failure");
        std::fs::remove_file(detached.join("blocked.fifo")).unwrap();

        assert!(list_recycled_projects_sync().unwrap().is_empty());
        assert!(!detached.exists());
        assert_eq!(std::fs::read_dir(&queue).unwrap().count(), 0);
        assert!(!recycled_project_ids().unwrap().contains(project_id));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn pending_job_resumes_after_crash_before_recycle_entry_removal() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "crash-window-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let job = PendingCheckpointCleanup {
            version: CHECKPOINT_CLEANUP_VERSION,
            project_id: project_id.to_string(),
            recycle_id: recycle_id.clone(),
        };
        write_cleanup_job(&job).unwrap();

        retry_pending_checkpoint_cleanup().unwrap();

        assert!(list_recycled_projects_sync().unwrap().is_empty());
        assert!(!checkpoint_store.exists());
        assert!(!recycled_project_ids().unwrap().contains(project_id));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn pending_job_resumes_partial_recycle_removal_with_identity_evidence() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "partial-delete-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let job = PendingCheckpointCleanup {
            version: CHECKPOINT_CLEANUP_VERSION,
            project_id: project_id.to_string(),
            recycle_id: recycle_id.clone(),
        };
        write_cleanup_job(&job).unwrap();
        let entry = recycle_entry_dir(&recycle_id).unwrap();
        std::fs::remove_file(entry.join(RECYCLED_PROJECT_DIRECTORY).join("main.tex")).unwrap();

        retry_pending_checkpoint_cleanup().unwrap();

        assert!(!entry.exists());
        assert!(!checkpoint_store.exists());
        assert!(!recycled_project_ids().unwrap().contains(project_id));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn pending_job_resumes_when_partial_removal_left_only_the_matching_manifest() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "manifest-only-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let job = PendingCheckpointCleanup {
            version: CHECKPOINT_CLEANUP_VERSION,
            project_id: project_id.to_string(),
            recycle_id: recycle_id.clone(),
        };
        write_cleanup_job(&job).unwrap();
        let entry = recycle_entry_dir(&recycle_id).unwrap();
        std::fs::remove_dir_all(entry.join(RECYCLED_PROJECT_DIRECTORY)).unwrap();

        retry_pending_checkpoint_cleanup().unwrap();

        assert!(!entry.exists());
        assert!(!checkpoint_store.exists());
        assert!(!recycled_project_ids().unwrap().contains(project_id));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn pending_job_fails_closed_when_recycle_manifest_identity_changes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "identity-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let job = PendingCheckpointCleanup {
            version: CHECKPOINT_CLEANUP_VERSION,
            project_id: project_id.to_string(),
            recycle_id: recycle_id.clone(),
        };
        write_cleanup_job(&job).unwrap();
        let entry = recycle_entry_dir(&recycle_id).unwrap();
        let mismatched = RecycleManifest {
            project_id: "different-project".into(),
            name: "Different".into(),
            deleted_at: 1,
        };
        std::fs::write(
            entry.join(RECYCLE_MANIFEST),
            serde_json::to_vec(&mismatched).unwrap(),
        )
        .unwrap();

        assert!(retry_pending_checkpoint_cleanup().is_err());
        assert!(entry.exists());
        assert!(checkpoint_store.exists());
        assert!(pending_cleanup_project_ids().unwrap().contains(project_id));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn deleting_one_of_two_recycled_entries_preserves_shared_checkpoint_history() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "duplicate-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"First"}"#).unwrap();
        let checkpoint_store = crate::paths::checkpoint_store_dir(project_id).unwrap();
        oleafly_history::Store::open(&checkpoint_store).unwrap();
        let first = recycle_project_directory(project_id, "First", &project).unwrap();

        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Second"}"#).unwrap();
        let second = recycle_project_directory(project_id, "Second", &project).unwrap();

        permanently_delete_recycled_project_sync(&first).unwrap();

        assert!(checkpoint_store.exists());
        let listed = list_recycled_projects_sync().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, second);
        assert!(recycled_project_ids().unwrap().contains(project_id));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn recycled_project_with_unprovable_restore_marker_is_not_exposed_as_active() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "pending-recycled-paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        let entry = recycle_entry_dir(&recycle_id).unwrap();
        let recycled = recycled_project_dir(&entry).unwrap();
        let internal = recycled.join(".oleafly");
        std::fs::create_dir(&internal).unwrap();
        std::fs::write(internal.join("checkpoint-restore-pending"), b"").unwrap();

        let error = restore_recycled_project_sync(&recycle_id).unwrap_err();

        assert!(error.contains("kept in the Recycle Bin"));
        assert!(!crate::paths::projects_root()
            .unwrap()
            .join(project_id)
            .exists());
        assert!(recycled_project_dir(&entry).unwrap().exists());
        assert!(entry.join(RECYCLE_MANIFEST).is_file());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
