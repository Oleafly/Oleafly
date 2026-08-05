//! Project-relative path sandboxing.
//!
//! Every file path that crosses the IPC boundary is resolved through
//! `resolve_within` so absolute paths, `..` traversal, drive prefixes, and
//! symlink escapes cannot leave a project's root.

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
    destination: PathBuf,
    staging: PathBuf,
    committed: bool,
}

impl AtomicFile {
    pub fn new(destination: &Path) -> Result<Self, String> {
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| "file destination has no parent folder".to_string())?;
        if !parent.is_dir() {
            return Err("file destination folder does not exist".into());
        }
        let name = destination
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "file destination name is not valid Unicode".to_string())?;

        for _ in 0..10_000 {
            let sequence = ATOMIC_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let staging = parent.join(format!(
                ".{name}.oleafly-{}-{sequence}.tmp",
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
                        destination: destination.to_path_buf(),
                        staging,
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

    pub fn commit(mut self) -> Result<(), String> {
        let metadata = std::fs::symlink_metadata(&self.staging)
            .map_err(|error| format!("staged artifact is unavailable: {error}"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("staged artifact is not a regular file".into());
        }
        if let Ok(existing) = std::fs::symlink_metadata(&self.destination) {
            if existing.is_file() && !existing.file_type().is_symlink() {
                std::fs::set_permissions(&self.staging, existing.permissions()).map_err(
                    |error| format!("failed to preserve destination permissions: {error}"),
                )?;
            }
        }
        // Staging-file fsync is best-effort. Some volumes reject fsync while
        // still accepting rename; failing the whole export after a good write
        // would tell the user the PDF was not saved when it was.
        let _ = std::fs::OpenOptions::new()
            // Windows maps sync_all() to FlushFileBuffers, which rejects a
            // handle opened without GENERIC_WRITE. A read-only reopen works
            // on Unix but makes every atomic write fail with access denied on
            // Windows, so reopen the completed staging file for writing.
            .write(true)
            .open(&self.staging)
            .and_then(|file| file.sync_all());
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
    let transaction = AtomicFile::new(destination)?;
    std::fs::write(transaction.staging_path(), bytes)
        .map_err(|error| format!("failed to write staged file: {error}"))?;
    transaction.commit()
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(any(windows, test))]
fn is_retryable_windows_replace_error_code(code: Option<i32>) -> bool {
    // ERROR_ACCESS_DENIED can be returned while Defender or an indexer has a
    // transient handle. The remaining values are the documented sharing,
    // locking, and mapped-file conflicts emitted when a compiler is still
    // releasing the destination.
    matches!(code, Some(5 | 32 | 33 | 1224))
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::time::Duration;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    const RETRY_DELAYS_MS: [u64; 9] = [10, 20, 40, 80, 160, 320, 500, 500, 500];
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    for attempt in 0..=RETRY_DELAYS_MS.len() {
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result != 0 {
            return Ok(());
        }

        let error = std::io::Error::last_os_error();
        if attempt == RETRY_DELAYS_MS.len()
            || !is_retryable_windows_replace_error_code(error.raw_os_error())
        {
            return Err(error);
        }
        std::thread::sleep(Duration::from_millis(RETRY_DELAYS_MS[attempt]));
    }

    unreachable!("the bounded Windows replacement loop always returns")
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
    fn classifies_only_transient_windows_replace_errors_as_retryable() {
        for code in [5, 32, 33, 1224] {
            assert!(is_retryable_windows_replace_error_code(Some(code)));
        }
        for code in [2, 3, 87, 112] {
            assert!(!is_retryable_windows_replace_error_code(Some(code)));
        }
        assert!(!is_retryable_windows_replace_error_code(None));
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
