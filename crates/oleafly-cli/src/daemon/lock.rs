//! One background helper at a time: an exclusive lock on
//! `<data>/daemon/daemon.lock` (`flock` on macOS and Linux, `LockFileEx` on
//! Windows), held for the helper's life and released by the OS if it dies.
use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

pub struct HelperLock {
    _file: File,
}

impl Drop for HelperLock {
    fn drop(&mut self) {
        let _ = fs4::FileExt::unlock(&self._file);
    }
}

fn open(path: &Path) -> io::Result<File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the helper lock is a link",
        ));
    }
    OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
}

impl HelperLock {
    pub fn acquire(path: &Path, budget: Duration) -> io::Result<Option<HelperLock>> {
        let file = open(path)?;
        let deadline = Instant::now() + budget;
        loop {
            match fs4::FileExt::try_lock(&file) {
                Ok(()) => return Ok(Some(HelperLock { _file: file })),
                Err(fs4::TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(fs4::TryLockError::WouldBlock) => return Ok(None),
                Err(fs4::TryLockError::Error(error)) => return Err(error),
            }
        }
    }

    pub fn is_held_elsewhere(path: &Path) -> io::Result<bool> {
        let file = match OpenOptions::new().read(true).write(true).open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        match fs4::FileExt::try_lock_shared(&file) {
            Ok(()) => {
                let _ = fs4::FileExt::unlock(&file);
                Ok(false)
            }
            Err(fs4::TryLockError::WouldBlock) => Ok(true),
            Err(fs4::TryLockError::Error(error)) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_holder_of_the_helper_lock() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("daemon").join("daemon.lock");
        assert!(!HelperLock::is_held_elsewhere(&lock).unwrap());
        let first = HelperLock::acquire(&lock, Duration::ZERO).unwrap().unwrap();
        assert!(HelperLock::acquire(&lock, Duration::ZERO)
            .unwrap()
            .is_none());
        assert!(HelperLock::is_held_elsewhere(&lock).unwrap());
        drop(first);
        assert!(!HelperLock::is_held_elsewhere(&lock).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn dropping_the_lock_frees_it_while_a_copy_of_the_file_is_open() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("daemon.lock");
        let first = HelperLock::acquire(&lock, Duration::ZERO).unwrap().unwrap();
        let copy = first._file.try_clone().unwrap();
        drop(first);
        assert!(!HelperLock::is_held_elsewhere(&lock).unwrap());
        drop(copy);
    }

    #[test]
    fn a_waiting_helper_takes_over_when_the_holder_exits() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("daemon.lock");
        let first = HelperLock::acquire(&lock, Duration::ZERO).unwrap().unwrap();
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(first);
        });
        let started = Instant::now();
        let second = HelperLock::acquire(&lock, Duration::from_secs(5)).unwrap();
        assert!(second.is_some());
        assert!(started.elapsed() >= Duration::from_millis(200));
        releaser.join().unwrap();
    }
}
