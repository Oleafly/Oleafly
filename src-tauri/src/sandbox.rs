//! Project-relative path sandboxing.
//!
//! Every file path that crosses the IPC boundary is resolved through
//! `resolve_within` so absolute paths, `..` traversal, drive prefixes, and
//! symlink escapes cannot leave a project's root.

use std::fs::File;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::paths;

/// Resolve a project-relative path, rejecting traversal escapes.
pub fn resolve(project_id: &str, rel: &str) -> Result<PathBuf, String> {
    let root = paths::project_dir(project_id)?;
    resolve_within(&root, rel)
}

pub fn resolve_readable(project_id: &str, rel: &str) -> Result<PathBuf, String> {
    let location = crate::project_location::locate(project_id)?;
    resolve_readable_at(&location, rel)
}

pub(crate) fn resolve_readable_at(
    location: &crate::project_location::ProjectLocation,
    rel: &str,
) -> Result<PathBuf, String> {
    match resolve_within(&location.root, rel) {
        Ok(path) => Ok(path),
        Err(error) if location.kind == crate::project_location::ProjectKind::Linked => {
            crate::folder_listing::outbound_resource_link(&location.root, rel).ok_or(error)
        }
        Err(error) => Err(error),
    }
}

/// Public resolver for other modules (e.g. compile/export) so a user-supplied
/// `main_doc` can't escape the project via an absolute path or `..`.
pub fn resolve_in_project(project_id: &str, rel: &str) -> Result<PathBuf, String> {
    resolve(project_id, rel)
}

/// Join `rel` onto `root`, rejecting anything that would escape `root`.
///
/// Guards against three escape vectors:
///   1. Absolute paths (`/etc/passwd`) - `Path::join` would discard `root`.
///   2. `..` traversal and drive prefixes (`C:\`).
///   3. Symlinks inside the project pointing outside - the resolved real path
///      (or its nearest existing ancestor, for not-yet-created files) must stay
///      within `root`.
pub fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains('\\') {
        return Err(format!("illegal path: {rel}"));
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("illegal path: {rel}"));
    }
    if rel_path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("illegal path: {rel}"));
    }
    let joined = root.join(rel_path);
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    if let Some(anchor) = nearest_existing(&joined) {
        let real = anchor.canonicalize().map_err(|e| e.to_string())?;
        if !real.starts_with(&real_root) {
            return Err(format!("illegal path: {rel}"));
        }
    }
    Ok(joined)
}

/// The deepest ancestor of `path` (including itself) that exists on disk.
fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

/// Whether `rel` resolves to the project root itself (must never be deleted).
#[cfg(test)]
pub fn is_root_delete(root: &Path, rel: &str) -> bool {
    if rel.is_empty() || rel == "." {
        return true;
    }
    let p = match resolve_within(root, rel) {
        Ok(p) => p,
        // A path that fails to resolve is refused elsewhere; not a root delete.
        Err(_) => return false,
    };
    match (p.canonicalize(), root.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => p == root,
    }
}

/// Light hardening for a user-chosen export/save destination. These paths
/// legitimately live outside the project sandbox (a native save dialog), so we
/// do not sandbox them to the project; we only refuse directory targets, empty
/// / relative destinations, and missing parent folders. Shared by `export_pdf`,
/// `write_bytes_file`, and other "user picked this path" writers.
pub fn guard_export_dest(dest: &str) -> Result<(), String> {
    let dest = dest.trim();
    if dest.is_empty() {
        return Err("export destination is empty".into());
    }
    // Native save dialogs always return absolute paths. A relative dest is a
    // strong signal of a crafted IPC call rather than a user-chosen location.
    let p = Path::new(dest);
    if !p.is_absolute() {
        return Err("export destination must be an absolute path".into());
    }
    if p.is_dir() {
        return Err("export destination is a directory, not a file".into());
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("export destination folder does not exist".into());
        }
    }
    Ok(())
}

static ATOMIC_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A same-directory staging file that replaces its destination only after the
/// complete payload has been written and synced. Dropping an uncommitted
/// transaction removes the staging file and leaves an existing destination
/// untouched.
pub struct AtomicFile {
    parent: PathBuf,
    parent_identity: same_file::Handle,
    destination: PathBuf,
    staging: PathBuf,
    staging_file: Option<File>,
    committed: bool,
    preserve_metadata: bool,
    keep_staging: bool,
}

impl AtomicFile {
    pub fn new(destination: &Path) -> Result<Self, String> {
        let requested_parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| "file destination has no parent folder".to_string())?;
        if !requested_parent.is_dir() {
            return Err("file destination folder does not exist".into());
        }
        let parent = requested_parent
            .canonicalize()
            .map_err(|error| format!("failed to resolve file destination folder: {error}"))?;
        let parent_identity = same_file::Handle::from_path(&parent)
            .map_err(|error| format!("failed to bind file destination folder: {error}"))?;
        let name = destination
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .ok_or_else(|| "file destination name is not valid Unicode".to_string())?;
        let destination = parent.join(name);

        for _ in 0..10_000 {
            let sequence = ATOMIC_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let random = rand::random::<u64>();
            let staging = parent.join(format!(
                ".{name}.oleafly-{}-{sequence}-{random:016x}.tmp",
                std::process::id()
            ));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staging)
            {
                Ok(file) => {
                    file.sync_all()
                        .map_err(|error| format!("failed to initialize staging file: {error}"))?;
                    return Ok(Self {
                        parent,
                        parent_identity,
                        destination,
                        staging,
                        staging_file: Some(file),
                        committed: false,
                        preserve_metadata: false,
                        keep_staging: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!("failed to create staging file: {error}"));
                }
            }
        }
        Err("could not reserve a staging file".into())
    }

    pub fn for_export(destination: &str) -> Result<Self, String> {
        guard_export_dest(destination)?;
        Self::new(Path::new(destination))
    }

    pub fn staging_path(&self) -> &Path {
        &self.staging
    }

    pub fn staging_file_mut(&mut self) -> &mut File {
        self.staging_file
            .as_mut()
            .expect("staging file is available before commit")
    }

    pub fn commit(mut self) -> Result<(), String> {
        let current_parent = same_file::Handle::from_path(&self.parent)
            .map_err(|error| format!("file destination folder changed: {error}"))?;
        if current_parent != self.parent_identity {
            return Err("file destination folder changed before publish".into());
        }
        let metadata = std::fs::symlink_metadata(&self.staging)
            .map_err(|error| format!("staged artifact is unavailable: {error}"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("staged artifact is not a regular file".into());
        }
        let staging_file = self
            .staging_file
            .as_ref()
            .expect("staging file is available before commit");
        let bound_staging = same_file::Handle::from_file(
            staging_file
                .try_clone()
                .map_err(|error| format!("failed to verify staged artifact: {error}"))?,
        )
        .map_err(|error| format!("failed to verify staged artifact: {error}"))?;
        let current_staging = same_file::Handle::from_path(&self.staging)
            .map_err(|error| format!("staged artifact changed: {error}"))?;
        if bound_staging != current_staging {
            return Err("staged artifact changed before publish".into());
        }
        if let Ok(existing) = std::fs::symlink_metadata(&self.destination) {
            if existing.is_file() && !existing.file_type().is_symlink() {
                staging_file
                    .set_permissions(existing.permissions())
                    .map_err(|error| {
                        format!("failed to preserve destination permissions: {error}")
                    })?;
                if self.preserve_metadata {
                    copy_extended_metadata(&self.destination, staging_file);
                }
            }
        }
        // Staging-file fsync is best-effort. Some volumes reject fsync while
        // still accepting rename; failing the whole export after a good write
        // would tell the user the PDF was not saved when it was.
        let _ = staging_file.sync_all();
        drop(bound_staging);
        drop(current_staging);
        drop(self.staging_file.take());
        let published = if self.preserve_metadata {
            replace_file_preserving(&self.staging, &self.destination)
        } else {
            replace_file(&self.staging, &self.destination).map_err(ReplaceFailure::intact)
        };
        if let Err(failure) = published {
            if failure.staging_is_only_copy {
                self.keep_staging = true;
                return Err(format!(
                    "failed to publish staged artifact: {}. The new content is kept in {}",
                    failure.error,
                    self.staging.display()
                ));
            }
            return Err(format!(
                "failed to publish staged artifact: {}",
                failure.error
            ));
        }
        // From here the destination file exists. Nothing after this point may
        // turn a successful publish into a user-facing export failure.
        self.committed = true;
        sync_parent(&self.destination);
        Ok(())
    }
}

impl Drop for AtomicFile {
    fn drop(&mut self) {
        if !self.committed && !self.keep_staging {
            let _ = std::fs::remove_file(&self.staging);
        }
    }
}

struct ReplaceFailure {
    error: std::io::Error,
    staging_is_only_copy: bool,
}

impl ReplaceFailure {
    fn intact(error: std::io::Error) -> Self {
        Self {
            error,
            staging_is_only_copy: false,
        }
    }
}

pub fn atomic_write(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut transaction = AtomicFile::new(destination)?;
    transaction
        .staging_file_mut()
        .write_all(bytes)
        .map_err(|error| format!("failed to write staged file: {error}"))?;
    transaction.commit()
}

pub(crate) fn atomic_write_preserving(
    destination: &Path,
    bytes: &[u8],
    backups: &dyn Fn() -> Result<PathBuf, String>,
) -> Result<(), String> {
    let existing = std::fs::symlink_metadata(destination)
        .ok()
        .filter(|metadata| metadata.is_file() && !metadata.file_type().is_symlink());
    if existing.is_some_and(|metadata| link_count(destination, &metadata) > 1) {
        return write_through_links(destination, bytes, &backups()?);
    }
    let mut transaction = AtomicFile::new(destination)?;
    transaction.preserve_metadata = true;
    transaction
        .staging_file_mut()
        .write_all(bytes)
        .map_err(|error| format!("failed to write staged file: {error}"))?;
    transaction.commit()
}

fn write_in_place(destination: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(destination)?;
    file.write_all(bytes)?;
    let _ = file.sync_all();
    Ok(())
}

fn write_through_links(destination: &Path, bytes: &[u8], backups: &Path) -> Result<(), String> {
    let name = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let backup = backups.join(format!(
        "{}-{}-{name}",
        std::process::id(),
        ATOMIC_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::copy(destination, &backup)
        .map_err(|error| format!("failed to back up the linked file: {error}"))?;
    match write_in_place(destination, bytes) {
        Ok(()) => {
            let _ = std::fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let restored =
                std::fs::read(&backup).and_then(|previous| write_in_place(destination, &previous));
            match restored {
                Ok(()) => {
                    let _ = std::fs::remove_file(&backup);
                    Err(format!("failed to write the linked file: {error}"))
                }
                Err(restore_error) => Err(format!(
                    "failed to write the linked file: {error}. The previous version is kept at {}: {restore_error}",
                    backup.display()
                )),
            }
        }
    }
}

#[cfg(unix)]
fn link_count(_path: &Path, metadata: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt as _;
    metadata.nlink()
}

#[cfg(windows)]
fn link_count(path: &Path, _metadata: &std::fs::Metadata) -> u64 {
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    let Ok(file) = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)
    else {
        return 1;
    };
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
        return 1;
    }
    u64::from(information.nNumberOfLinks)
}

#[cfg(not(any(unix, windows)))]
fn link_count(_path: &Path, _metadata: &std::fs::Metadata) -> u64 {
    1
}

#[cfg(target_os = "macos")]
fn copy_extended_metadata(source: &Path, staging: &File) {
    use std::os::fd::AsRawFd as _;
    let Ok(original) = File::open(source) else {
        return;
    };
    let _ = unsafe {
        libc::fcopyfile(
            original.as_raw_fd(),
            staging.as_raw_fd(),
            std::ptr::null_mut(),
            libc::COPYFILE_ACL | libc::COPYFILE_XATTR,
        )
    };
}

#[cfg(target_os = "linux")]
fn copy_extended_metadata(source: &Path, staging: &File) {
    use std::os::fd::AsRawFd as _;
    let Ok(original) = File::open(source) else {
        return;
    };
    let (from, to) = (original.as_raw_fd(), staging.as_raw_fd());
    let size = unsafe { libc::flistxattr(from, std::ptr::null_mut(), 0) };
    if size <= 0 {
        return;
    }
    let mut names = vec![0u8; size as usize];
    let size = unsafe { libc::flistxattr(from, names.as_mut_ptr().cast(), names.len()) };
    if size <= 0 {
        return;
    }
    names.truncate(size as usize);
    for name in names
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
    {
        let Ok(name) = std::ffi::CString::new(name) else {
            continue;
        };
        let length = unsafe { libc::fgetxattr(from, name.as_ptr(), std::ptr::null_mut(), 0) };
        if length < 0 {
            continue;
        }
        let mut value = vec![0u8; length as usize];
        let length =
            unsafe { libc::fgetxattr(from, name.as_ptr(), value.as_mut_ptr().cast(), value.len()) };
        if length < 0 {
            continue;
        }
        let _ = unsafe {
            libc::fsetxattr(to, name.as_ptr(), value.as_ptr().cast(), length as usize, 0)
        };
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn copy_extended_metadata(_source: &Path, _staging: &File) {}

#[cfg(windows)]
fn replace_file_preserving(source: &Path, destination: &Path) -> Result<(), ReplaceFailure> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        ReplaceFileW, REPLACEFILE_IGNORE_ACL_ERRORS, REPLACEFILE_IGNORE_MERGE_ERRORS,
    };
    if std::fs::symlink_metadata(destination).is_err() {
        return replace_file(source, destination).map_err(ReplaceFailure::intact);
    }
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    };
    let (replaced, replacement) = (wide(destination), wide(source));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut delay = std::time::Duration::from_millis(10);
    loop {
        let replaced_ok = unsafe {
            ReplaceFileW(
                replaced.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if replaced_ok != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        match replace_recovery(error.raw_os_error()) {
            ReplaceRecovery::MoveReplacement => {
                return replace_file(source, destination).map_err(|error| ReplaceFailure {
                    error,
                    staging_is_only_copy: true,
                });
            }
            ReplaceRecovery::Retry if std::time::Instant::now() < deadline => {
                std::thread::sleep(
                    delay.min(deadline.saturating_duration_since(std::time::Instant::now())),
                );
                delay = (delay * 2).min(std::time::Duration::from_millis(250));
            }
            _ => return Err(ReplaceFailure::intact(error)),
        }
    }
}

#[cfg(not(windows))]
fn replace_file_preserving(source: &Path, destination: &Path) -> Result<(), ReplaceFailure> {
    replace_file(source, destination).map_err(ReplaceFailure::intact)
}

#[cfg(any(windows, test))]
#[derive(Debug, PartialEq, Eq)]
enum ReplaceRecovery {
    MoveReplacement,
    Retry,
    Fail,
}

#[cfg(any(windows, test))]
fn replace_recovery(code: Option<i32>) -> ReplaceRecovery {
    const ERROR_UNABLE_TO_MOVE_REPLACEMENT: i32 = 1176;
    const ERROR_UNABLE_TO_MOVE_REPLACEMENT_2: i32 = 1177;
    match code {
        Some(ERROR_UNABLE_TO_MOVE_REPLACEMENT | ERROR_UNABLE_TO_MOVE_REPLACEMENT_2) => {
            ReplaceRecovery::MoveReplacement
        }
        code if is_retryable_replace_error_code(code) => ReplaceRecovery::Retry,
        _ => ReplaceRecovery::Fail,
    }
}

pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        // Indexers and compiler processes can hold a non-delete-sharing read
        // handle for several seconds. Preserve atomic replacement while giving
        // those transient locks a bounded chance to clear.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        let mut delay = std::time::Duration::from_millis(10);
        loop {
            match atomicwrites::replace_atomic(source, destination) {
                Ok(()) => return Ok(()),
                Err(error)
                    if is_retryable_replace_error_code(error.raw_os_error())
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(
                        delay.min(deadline.saturating_duration_since(std::time::Instant::now())),
                    );
                    delay = (delay * 2).min(std::time::Duration::from_millis(250));
                }
                Err(error) => return Err(error),
            }
        }
    }
    #[cfg(not(windows))]
    {
        atomicwrites::replace_atomic(source, destination)
    }
}

#[cfg(any(windows, test))]
fn is_retryable_replace_error_code(code: Option<i32>) -> bool {
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    const ERROR_USER_MAPPED_FILE: i32 = 1224;
    matches!(
        code,
        Some(
            ERROR_ACCESS_DENIED
                | ERROR_SHARING_VIOLATION
                | ERROR_LOCK_VIOLATION
                | ERROR_USER_MAPPED_FILE
        )
    )
}

/// Best-effort directory fsync after a successful rename. Never fails the
/// caller: macOS TCC (Desktop/Downloads), iCloud, and some network volumes
/// reject directory fsync even when the file itself was published.
#[cfg(unix)]
fn sync_parent(destination: &Path) {
    let Some(parent) = destination.parent() else {
        return;
    };
    let _ = std::fs::File::open(parent).and_then(|directory| directory.sync_all());
}

#[cfg(not(unix))]
fn sync_parent(_destination: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!("oleafly-sandbox-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn rejects_absolute_paths() {
        let root = temp_root();
        assert!(resolve_within(&root, "/etc/passwd").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temp_root();
        assert!(resolve_within(&root, "../secret").is_err());
        assert!(resolve_within(&root, "a/../../secret").is_err());
        assert!(resolve_within(&root, "..\\secret").is_err());
        assert!(resolve_within(&root, "C:\\Windows\\system.ini").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn allows_normal_relative_paths() {
        let root = temp_root();
        let p = resolve_within(&root, "sub/dir/file.tex").unwrap();
        assert!(p.starts_with(&root));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_delete_of_project_root() {
        let root = temp_root();
        assert!(is_root_delete(&root, ""));
        assert!(is_root_delete(&root, "."));
        assert!(is_root_delete(&root, "./"));
        assert!(is_root_delete(&root, "././"));
        assert!(!is_root_delete(&root, "main.tex"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn guard_export_dest_rejects_relative_and_empty() {
        assert!(guard_export_dest("").is_err());
        assert!(guard_export_dest("   ").is_err());
        assert!(guard_export_dest("relative/out.pdf").is_err());
        assert!(guard_export_dest("./out.pdf").is_err());
    }

    #[test]
    fn guard_export_dest_rejects_directory_and_missing_parent() {
        let root = temp_root();
        assert!(guard_export_dest(&root.to_string_lossy()).is_err());
        let missing = root.join("no-such-dir").join("out.pdf");
        assert!(guard_export_dest(&missing.to_string_lossy()).is_err());
        let ok = root.join("out.pdf");
        assert!(guard_export_dest(&ok.to_string_lossy()).is_ok());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atomic_write_replaces_only_after_the_staged_payload_is_complete() {
        let root = temp_root();
        let destination = root.join("artifact.pdf");
        std::fs::write(&destination, b"old artifact").unwrap();

        let transaction = AtomicFile::new(&destination).unwrap();
        std::fs::write(transaction.staging_path(), b"partial artifact").unwrap();
        drop(transaction);
        assert_eq!(std::fs::read(&destination).unwrap(), b"old artifact");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);

        atomic_write(&destination, b"complete artifact").unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"complete artifact");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_file_rejects_staging_and_parent_path_substitution() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let destination = root.join("artifact.bin");
        let victim = root.join("victim.bin");
        std::fs::write(&victim, b"victim").unwrap();
        let mut transaction = AtomicFile::new(&destination).unwrap();
        transaction.staging_file_mut().write_all(b"safe").unwrap();
        let staging = transaction.staging_path().to_path_buf();
        let displaced = root.join("displaced-staging");
        std::fs::rename(&staging, &displaced).unwrap();
        symlink(&victim, &staging).unwrap();

        assert!(transaction.commit().is_err());
        assert_eq!(std::fs::read(&victim).unwrap(), b"victim");
        assert!(!destination.exists());

        let parent = root.join("parent");
        std::fs::create_dir(&parent).unwrap();
        let destination = parent.join("artifact.bin");
        let mut transaction = AtomicFile::new(&destination).unwrap();
        transaction.staging_file_mut().write_all(b"safe").unwrap();
        let moved_parent = root.join("moved-parent");
        std::fs::rename(&parent, &moved_parent).unwrap();
        std::fs::create_dir(&parent).unwrap();

        assert!(transaction.commit().is_err());
        assert!(!destination.exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sync_parent_is_best_effort_and_never_panics() {
        // Restricted parents (e.g. some Desktop/Downloads layouts) may reject
        // open/fsync; the helper must not panic or block commit.
        sync_parent(Path::new("/dev/null-oleafly-export-probe"));
        let root = temp_root();
        sync_parent(&root.join("out.pdf"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn classifies_only_transient_windows_replace_errors_as_retryable() {
        for code in [5, 32, 33, 1224] {
            assert!(is_retryable_replace_error_code(Some(code)));
        }
        for code in [2, 3, 87, 112] {
            assert!(!is_retryable_replace_error_code(Some(code)));
        }
        assert!(!is_retryable_replace_error_code(None));
    }

    #[cfg(windows)]
    #[test]
    fn atomic_save_waits_for_a_longer_lived_windows_reader_without_truncating() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("main.tex");
        std::fs::write(&destination, b"previous complete draft").unwrap();
        let reader = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&destination)
            .unwrap();
        let observed = destination.clone();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            assert_eq!(std::fs::read(observed).unwrap(), b"previous complete draft");
            drop(reader);
        });
        atomic_write(&destination, b"next complete draft").unwrap();
        release.join().unwrap();
        assert_eq!(std::fs::read(destination).unwrap(), b"next complete draft");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn concurrent_atomic_writers_never_publish_a_torn_payload() {
        let root = temp_root();
        let destination = std::sync::Arc::new(root.join("artifact.zip"));
        let payloads: Vec<Vec<u8>> = (1..=6).map(|value| vec![value; 256 * 1024]).collect();
        let workers: Vec<_> = payloads
            .iter()
            .cloned()
            .map(|payload| {
                let destination = std::sync::Arc::clone(&destination);
                std::thread::spawn(move || atomic_write(&destination, &payload).unwrap())
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }

        let published = std::fs::read(destination.as_path()).unwrap();
        assert!(payloads.iter().any(|payload| payload == &published));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_replacement_preserves_existing_destination_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root();
        let destination = root.join("executable");
        std::fs::write(&destination, b"old").unwrap();
        std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o751)).unwrap();

        atomic_write(&destination, b"new").unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert_eq!(
            std::fs::metadata(&destination)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o751
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_partial_windows_replace_moves_the_new_file_into_place() {
        assert_eq!(
            replace_recovery(Some(1176)),
            ReplaceRecovery::MoveReplacement
        );
        assert_eq!(
            replace_recovery(Some(1177)),
            ReplaceRecovery::MoveReplacement
        );
        assert_eq!(replace_recovery(Some(1175)), ReplaceRecovery::Fail);
        assert_eq!(replace_recovery(Some(32)), ReplaceRecovery::Retry);
        assert_eq!(replace_recovery(Some(5)), ReplaceRecovery::Retry);
        assert_eq!(replace_recovery(None), ReplaceRecovery::Fail);
    }

    fn backup_folder(root: &Path) -> PathBuf {
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        backups
    }

    #[test]
    fn a_preserving_save_writes_through_hard_links_and_keeps_no_backup() {
        let root = temp_root();
        let folder = root.join("folder");
        std::fs::create_dir(&folder).unwrap();
        let destination = folder.join("main.tex");
        let alias = folder.join("alias.tex");
        std::fs::write(&destination, b"old").unwrap();
        std::fs::hard_link(&destination, &alias).unwrap();
        let backups = backup_folder(&root);

        atomic_write_preserving(&destination, b"new", &|| Ok(backups.clone())).unwrap();

        assert_eq!(std::fs::read(&alias).unwrap(), b"new");
        assert!(same_file::is_same_file(&destination, &alias).unwrap());
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_preserving_save_creates_a_missing_file_without_a_backup_folder() {
        let root = temp_root();
        let destination = root.join("new.tex");

        atomic_write_preserving(&destination, b"fresh", &|| {
            Err("no backup folder was needed".into())
        })
        .unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"fresh");
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(target_os = "macos")]
    fn set_xattr(path: &Path, name: &str, value: &[u8]) {
        use std::os::unix::ffi::OsStrExt as _;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        let name = std::ffi::CString::new(name).unwrap();
        let status = unsafe {
            libc::setxattr(
                path.as_ptr(),
                name.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        assert_eq!(status, 0, "{}", std::io::Error::last_os_error());
    }

    #[cfg(target_os = "macos")]
    fn get_xattr(path: &Path, name: &str) -> Option<Vec<u8>> {
        use std::os::unix::ffi::OsStrExt as _;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        let name = std::ffi::CString::new(name).unwrap();
        let mut value = vec![0u8; 4096];
        let read = unsafe {
            libc::getxattr(
                path.as_ptr(),
                name.as_ptr(),
                value.as_mut_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        (read >= 0).then(|| {
            value.truncate(read as usize);
            value
        })
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_preserving_save_keeps_extended_attributes_and_finder_tags() {
        let root = temp_root();
        let destination = root.join("main.tex");
        std::fs::write(&destination, b"old").unwrap();
        set_xattr(&destination, "com.oleafly.test", b"kept");
        set_xattr(
            &destination,
            "com.apple.metadata:_kMDItemUserTags",
            b"bplist00\xa1\x01URed\n6\x08\x0a\x00\x00\x00\x00\x00\x00\x01\x01\x00\x00\x00\x00\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10",
        );
        let backups = backup_folder(&root);

        atomic_write_preserving(&destination, b"new", &|| Ok(backups.clone())).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert_eq!(
            get_xattr(&destination, "com.oleafly.test").as_deref(),
            Some(&b"kept"[..])
        );
        assert!(get_xattr(&destination, "com.apple.metadata:_kMDItemUserTags").is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_preserving_save_keeps_user_extended_attributes() {
        use std::os::unix::ffi::OsStrExt as _;
        let root = temp_root();
        let destination = root.join("main.tex");
        std::fs::write(&destination, b"old").unwrap();
        let path = std::ffi::CString::new(destination.as_os_str().as_bytes()).unwrap();
        let name = std::ffi::CString::new("user.oleafly").unwrap();
        let set =
            unsafe { libc::setxattr(path.as_ptr(), name.as_ptr(), b"kept".as_ptr().cast(), 4, 0) };
        if set != 0 {
            eprintln!("skipping: {}", std::io::Error::last_os_error());
            std::fs::remove_dir_all(&root).ok();
            return;
        }
        let backups = backup_folder(&root);

        atomic_write_preserving(&destination, b"new", &|| Ok(backups.clone())).unwrap();

        let path = std::ffi::CString::new(destination.as_os_str().as_bytes()).unwrap();
        let mut value = [0u8; 16];
        let read = unsafe {
            libc::getxattr(
                path.as_ptr(),
                name.as_ptr(),
                value.as_mut_ptr().cast(),
                value.len(),
            )
        };
        assert_eq!(read, 4);
        assert_eq!(&value[..4], b"kept");
        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(windows)]
    #[test]
    fn a_preserving_save_keeps_alternate_data_streams_and_the_creation_time() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("main.tex");
        std::fs::write(&destination, b"old").unwrap();
        let stream = root.path().join("main.tex:oleafly.tag");
        std::fs::write(&stream, b"kept").unwrap();
        let created = std::fs::metadata(&destination).unwrap().created().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let backups = backup_folder(root.path());

        atomic_write_preserving(&destination, b"new", &|| Ok(backups.clone())).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert_eq!(std::fs::read(&stream).unwrap(), b"kept");
        assert_eq!(
            std::fs::metadata(&destination).unwrap().created().unwrap(),
            created
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let root = temp_root();
        let outside = temp_root();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        assert!(resolve_within(&root, "escape/x.tex").is_err());
        std::fs::remove_dir_all(&outside).ok();
        std::fs::remove_dir_all(&root).ok();
    }
}
