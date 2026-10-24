//! Atomic file replacement for build outputs and project files: write a
//! temporary file beside the destination, flush it, then rename it over the
//! destination, so a reader never sees half a file. A destination that is a
//! symbolic link is refused, an existing file keeps its permissions, and on
//! Windows a rename that hits a sharing violation (an antivirus scanner, an
//! indexer or a sync client holding the file) is retried for up to 8 s.
use std::io::{self, BufReader, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use tempfile::NamedTempFile;

/// How long Windows renames are retried (the app's policy since 0.4.7).
const WINDOWS_RETRY_FOR: Duration = Duration::from_secs(8);
const FIRST_RETRY_DELAY: Duration = Duration::from_millis(10);
const MAX_RETRY_DELAY: Duration = Duration::from_millis(250);

/// Access denied, sharing and lock violations, and a file still mapped by
/// another process: a short wait can clear each.
fn retryable(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::PermissionDenied
        || matches!(error.raw_os_error(), Some(5 | 32 | 33 | 1224))
}

/// Runs `attempt` until it succeeds, retrying the errors above for up to
/// `retry_for` with a growing delay (once when it is zero).
fn retry_policy(
    mut attempt: impl FnMut() -> io::Result<()>,
    retry_for: Duration,
) -> io::Result<()> {
    let deadline = Instant::now() + retry_for;
    let mut delay = FIRST_RETRY_DELAY;
    loop {
        match attempt() {
            Ok(()) => return Ok(()),
            Err(error) if retryable(&error) && Instant::now() < deadline => {
                std::thread::sleep(delay.min(deadline.saturating_duration_since(Instant::now())));
                delay = (delay * 2).min(MAX_RETRY_DELAY);
            }
            Err(error) => return Err(error),
        }
    }
}

/// [`retry_policy`] for this system: 8 s on Windows, one attempt elsewhere.
pub fn persist_with_retry(attempt: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    let retry_for = if cfg!(windows) {
        WINDOWS_RETRY_FOR
    } else {
        Duration::ZERO
    };
    retry_policy(attempt, retry_for)
}

/// A staging file beside `destination`, named `.{name}.oleafly-….tmp` so
/// Oleafly's own folder scans skip it (`exclude::is_oleafly_owned_name`).
/// It is created the way any new file is, so on Unix the umask decides its
/// mode (the `tempfile` default of 0600 would leave a new output unreadable
/// to a web server or another user), or with `tempfile`'s 0600 when
/// `private`; an existing destination's permissions replace either
/// afterwards (`keep_permissions`).
fn staging_file(parent: &Path, destination: &Path, private: bool) -> io::Result<NamedTempFile> {
    let name: String = destination
        .file_name()
        .map(|name| name.to_string_lossy().chars().take(64).collect())
        .unwrap_or_default();
    let prefix = format!(".{name}.oleafly-");
    let mut builder = tempfile::Builder::new();
    builder.prefix(&prefix).suffix(".tmp");
    if private {
        return builder.tempfile_in(parent);
    }
    builder.make_in(parent, |path| {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)
    })
}

fn refuse_symlink(path: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "{} is a symbolic link, so Oleafly won't write through it",
                path.display()
            ),
        )),
        _ => Ok(()),
    }
}

fn parent_of(path: &Path) -> io::Result<&Path> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("the folder {} doesn't exist", parent.display()),
        ));
    }
    Ok(parent)
}

fn keep_permissions(destination: &Path, temporary: &Path) {
    if let Ok(metadata) = std::fs::metadata(destination) {
        let _ = std::fs::set_permissions(temporary, metadata.permissions());
    }
}

fn sync_parent(parent: &Path) {
    #[cfg(unix)]
    if let Ok(folder) = std::fs::File::open(parent) {
        let _ = folder.sync_all();
    }
    #[cfg(not(unix))]
    let _ = parent;
}

fn persist(temporary: NamedTempFile, destination: &Path) -> io::Result<()> {
    let mut pending = Some(temporary);
    persist_with_retry(|| {
        let file = pending
            .take()
            .ok_or_else(|| io::Error::other("the staged file is gone"))?;
        match file.persist(destination) {
            Ok(_) => Ok(()),
            Err(error) => {
                pending = Some(error.file);
                Err(error.error)
            }
        }
    })
}

/// Writes `bytes` to a temporary file beside `path`, ready for
/// [`commit_staged`] (so several files can be staged before any is replaced).
pub fn stage_beside(path: &Path, bytes: &[u8]) -> io::Result<NamedTempFile> {
    stage(path, bytes, false)
}

fn stage(path: &Path, bytes: &[u8], private: bool) -> io::Result<NamedTempFile> {
    refuse_symlink(path)?;
    let parent = parent_of(path)?;
    let mut temporary = staging_file(parent, path, private)?;
    keep_permissions(path, temporary.path());
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    Ok(temporary)
}

/// Moves a staged file over `path`.
pub fn commit_staged(staged: NamedTempFile, path: &Path) -> io::Result<()> {
    refuse_symlink(path)?;
    let parent = parent_of(path)?.to_path_buf();
    persist(staged, path)?;
    sync_parent(&parent);
    Ok(())
}

/// Replaces `path` with `bytes` in one rename.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let staged = stage_beside(path, bytes)?;
    commit_staged(staged, path)
}

/// [`write_atomic`] for content only its owner should read (a copy of a file
/// that may hold credentials): a new file is created with mode 0600 on Unix.
pub fn write_atomic_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let staged = stage(path, bytes, true)?;
    commit_staged(staged, path)
}

/// Copies `source` over `destination` in one rename, streaming the bytes.
/// Returns how many bytes were copied.
pub fn copy_atomic(source: &Path, destination: &Path) -> io::Result<u64> {
    refuse_symlink(destination)?;
    let parent = parent_of(destination)?.to_path_buf();
    let mut temporary = staging_file(&parent, destination, false)?;
    keep_permissions(destination, temporary.path());
    let input = std::fs::File::open(source)?;
    let copied = io::copy(
        &mut BufReader::with_capacity(64 * 1024, input),
        temporary.as_file_mut(),
    )?;
    temporary.as_file().sync_all()?;
    persist(temporary, destination)?;
    sync_parent(&parent);
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out.txt");
        write_atomic(&target, b"one").unwrap();
        write_atomic(&target, b"two").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"two");
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("out.txt")]);
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_refuses_a_symlink_and_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.txt");
        std::fs::write(&real, b"keep").unwrap();
        let link = dir.path().join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let error = write_atomic(&link, b"x").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(std::fs::read(&real).unwrap(), b"keep");

        let private = dir.path().join("private.txt");
        std::fs::write(&private, b"a").unwrap();
        std::fs::set_permissions(&private, std::fs::Permissions::from_mode(0o640)).unwrap();
        write_atomic(&private, b"b").unwrap();
        assert_eq!(
            std::fs::metadata(&private).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_new_file_gets_the_mode_any_new_file_gets() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        // What the umask makes of a plain create here.
        let plain = dir.path().join("plain.txt");
        std::fs::File::create(&plain).unwrap();
        let expected = std::fs::metadata(&plain).unwrap().permissions().mode() & 0o777;

        let written = dir.path().join("written.txt");
        write_atomic(&written, b"x").unwrap();
        let source = dir.path().join("source.txt");
        std::fs::write(&source, b"y").unwrap();
        let copied = dir.path().join("copied.txt");
        copy_atomic(&source, &copied).unwrap();
        for path in [written, copied] {
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                expected,
                "{}",
                path.display()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_private_write_creates_an_owner_only_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("secrets.json.bak");
        write_atomic_private(&target, b"{}").unwrap();
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"{}");
    }

    #[test]
    fn copy_atomic_streams_large_files() {
        use sha2::{Digest, Sha256};
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("big.bin");
        let bytes: Vec<u8> = (0..8 * 1024 * 1024u32)
            .map(|index| (index.wrapping_mul(2_654_435_761) >> 11) as u8)
            .collect();
        std::fs::write(&source, &bytes).unwrap();
        let destination = dir.path().join("copy.bin");
        assert_eq!(copy_atomic(&source, &destination).unwrap(), 8 * 1024 * 1024);
        assert_eq!(
            Sha256::digest(std::fs::read(&destination).unwrap()),
            Sha256::digest(&bytes)
        );
    }

    #[test]
    fn write_atomic_into_a_missing_parent_fails_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let error = write_atomic(&dir.path().join("missing/out.txt"), b"x").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(!dir.path().join("missing").exists());
    }

    #[test]
    fn persist_retries_are_bounded() {
        let mut calls = 0;
        retry_policy(
            || {
                calls += 1;
                if calls < 3 {
                    Err(io::Error::from_raw_os_error(32))
                } else {
                    Ok(())
                }
            },
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(calls, 3);
        // A violation that never clears ends with its error once the window
        // closes.
        let mut calls = 0;
        let started = Instant::now();
        assert!(retry_policy(
            || {
                calls += 1;
                Err(io::Error::from_raw_os_error(33))
            },
            Duration::from_millis(200),
        )
        .is_err());
        assert!(calls > 1, "{calls}");
        assert!(started.elapsed() < Duration::from_secs(2));
        // Other errors, and every error without a window, are not retried.
        let mut calls = 0;
        assert!(retry_policy(
            || {
                calls += 1;
                Err(io::Error::from_raw_os_error(2))
            },
            Duration::from_secs(5),
        )
        .is_err());
        assert_eq!(calls, 1);
        let mut calls = 0;
        assert!(retry_policy(
            || {
                calls += 1;
                Err(io::Error::from_raw_os_error(1224))
            },
            Duration::ZERO,
        )
        .is_err());
        assert_eq!(calls, 1);
    }

    #[test]
    fn staging_files_are_named_for_oleaflys_scans_to_skip() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("main.tex");
        let staged = stage_beside(&destination, b"x").unwrap();
        let name = staged
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(crate::exclude::is_oleafly_owned_name(&name), "{name}");
    }
}
