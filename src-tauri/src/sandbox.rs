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
            .and_then(|value| value.to_str())
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
            }
        }
        // Staging-file fsync is best-effort. Some volumes reject fsync while
        // still accepting rename; failing the whole export after a good write
        // would tell the user the PDF was not saved when it was.
        let _ = staging_file.sync_all();
        drop(bound_staging);
        drop(current_staging);
        drop(self.staging_file.take());
        replace_file(&self.staging, &self.destination)
            .map_err(|error| format!("failed to publish staged artifact: {error}"))?;
        // From here the destination file exists. Nothing after this point may
        // turn a successful publish into a user-facing export failure.
        self.committed = true;
        sync_parent(&self.destination);
        Ok(())
    }
}

impl Drop for AtomicFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.staging);
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

pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        const RETRY_DELAYS_MS: [u64; 9] = [10, 20, 40, 80, 160, 320, 500, 500, 500];
        for delay in RETRY_DELAYS_MS {
            match atomicwrites::replace_atomic(source, destination) {
                Ok(()) => return Ok(()),
                Err(error) if is_retryable_replace_error_code(error.raw_os_error()) => {
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                }
                Err(error) => return Err(error),
            }
        }
    }
    atomicwrites::replace_atomic(source, destination)
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
