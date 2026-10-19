//! Atomic and private file writes shared by the secret store, the online
//! service crate and the CLI.
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Replace `destination` with `source` in one step.
///
/// On Windows, indexers and compiler processes can hold a non-delete-sharing
/// read handle for several seconds. The replacement stays atomic while those
/// transient locks get a bounded chance (8 s) to clear.
pub fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
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

/// Windows error codes that a short retry can clear: access denied, sharing
/// and lock violations, and a file still mapped by another process.
pub fn is_retryable_replace_error_code(code: Option<i32>) -> bool {
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

/// The name of a staging file next to `file_name`. It starts with a dot and
/// carries `.oleafly-`, so Oleafly's own folder scans skip it
/// (`oleafly_core::exclude::is_oleafly_owned_name`).
pub fn staging_name(file_name: &str, sequence: u64, random: u64) -> String {
    format!(
        ".{file_name}.oleafly-{}-{sequence}-{random:016x}.tmp",
        std::process::id()
    )
}

static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `destination` through a staging file in the same folder,
/// keeping the destination's permissions when it already exists. Refuses a
/// symbolic-link destination, and a folder that was swapped for another one
/// while the file was written. Never leaves the staging file behind.
pub fn write_atomic(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "the destination has no parent folder".to_string())?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "the destination has an invalid file name".to_string())?;
    let existing = match std::fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("the destination cannot be a symbolic link".to_string())
        }
        Ok(metadata) if metadata.is_file() => Some(metadata.permissions()),
        Ok(_) => return Err("the destination is not a file".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "failed to inspect {}: {error}",
                destination.display()
            ))
        }
    };
    let folder = same_file::Handle::from_path(parent)
        .map_err(|e| format!("failed to inspect {}: {e}", parent.display()))?;
    let random = {
        use rand::RngCore;
        rand::rngs::OsRng.next_u64()
    };
    let staging = parent.join(staging_name(
        file_name,
        STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        random,
    ));
    let result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .map_err(|e| format!("failed to create a staging file: {e}"))?;
        if let Some(permissions) = existing.clone() {
            std::fs::set_permissions(&staging, permissions)
                .map_err(|e| format!("failed to copy file permissions: {e}"))?;
        }
        file.write_all(bytes)
            .map_err(|e| format!("failed to write {}: {e}", destination.display()))?;
        // Best effort: some volumes refuse fsync but accept the rename, and
        // failing then would report a good write as lost.
        let _ = file.sync_all();
        drop(file);
        let current = same_file::Handle::from_path(parent)
            .map_err(|e| format!("the folder of {} changed: {e}", destination.display()))?;
        if current != folder {
            return Err(format!(
                "the folder of {} changed while it was written",
                destination.display()
            ));
        }
        replace_file(&staging, destination)
            .map_err(|e| format!("failed to replace {}: {e}", destination.display()))?;
        #[cfg(unix)]
        if let Ok(folder) = std::fs::File::open(parent) {
            let _ = folder.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result
}

/// Write an owner-only file (0600 on unix, current-user ACL on Windows)
/// through a fresh staging file. Refuses symbolic links at both paths.
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "secret path has an invalid filename".to_string())?,
        std::process::id(),
        crate::generate_token()
    ));
    for candidate in [path, tmp.as_path()] {
        match std::fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("secret path cannot be a symbolic link".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to inspect secret path: {error}")),
        }
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    {
        use std::io::Write;
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("failed to open secret temp file: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("failed to write secret file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("failed to sync secret file: {e}"))?;
    }
    crate::fsperm::harden_file(&tmp);
    replace_file(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace secret file: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_uses_an_oleafly_owned_staging_name_and_keeps_permissions() {
        assert!(oleafly_core::exclude::is_oleafly_owned_name(&staging_name(
            "main.tex", 3, 0xabc
        )));
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("main.tex");
        std::fs::write(&target, "old").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
        }
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "new");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o640);
        }
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn write_atomic_creates_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("fresh.json");
        write_atomic(&target, b"{}").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"{}");
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_refuses_a_symlink_destination() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.txt");
        std::fs::write(&real, "keep").unwrap();
        let link = dir.path().join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(write_atomic(&link, b"replaced").is_err());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "keep");
    }

    #[test]
    fn retryable_codes_are_the_transient_windows_locks() {
        for code in [5, 32, 33, 1224] {
            assert!(is_retryable_replace_error_code(Some(code)), "{code}");
        }
        for code in [None, Some(2), Some(1176)] {
            assert!(!is_retryable_replace_error_code(code), "{code:?}");
        }
    }
}
