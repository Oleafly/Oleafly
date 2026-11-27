use std::fs::Metadata;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

const WINDOW: Duration = Duration::from_secs(10);
const MAX_WRITES: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stamp {
    length: u64,
    modified: Option<SystemTime>,
    identity: u64,
}

impl Stamp {
    fn of(metadata: &Metadata) -> Stamp {
        Stamp {
            length: metadata.len(),
            modified: metadata.modified().ok(),
            identity: identity(metadata),
        }
    }
}

#[cfg(unix)]
fn identity(metadata: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt as _;
    metadata.ino()
}

#[cfg(not(unix))]
fn identity(_metadata: &Metadata) -> u64 {
    0
}

pub fn stamp_of(path: &Path) -> Option<Stamp> {
    std::fs::symlink_metadata(path)
        .ok()
        .map(|metadata| Stamp::of(&metadata))
}

struct OwnWrite {
    path: PathBuf,
    stamp: Option<Stamp>,
    at: Instant,
}

static LEDGER: Mutex<Vec<OwnWrite>> = Mutex::new(Vec::new());

fn ledger() -> MutexGuard<'static, Vec<OwnWrite>> {
    LEDGER.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn file_stamp(path: &Path) -> Option<Stamp> {
    std::fs::symlink_metadata(path)
        .ok()
        .filter(Metadata::is_file)
        .map(|metadata| Stamp::of(&metadata))
}

pub fn note_write(path: &Path) {
    note_stamp(path, file_stamp(path));
}

pub fn note_stamp(path: &Path, stamp: Option<Stamp>) {
    if let Some(stamp) = stamp {
        remember(path, Some(stamp));
    }
}

pub fn commit_own(staged: tempfile::NamedTempFile, target: &Path) -> std::io::Result<()> {
    let stamp = file_stamp(staged.path());
    crate::atomic::commit_staged(staged, target)?;
    note_stamp(target, stamp);
    Ok(())
}

pub fn write_own(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    commit_own(crate::atomic::stage_beside(target, bytes)?, target)
}

pub fn note_removal(path: &Path) {
    remember(path, None);
}

fn remember(path: &Path, stamp: Option<Stamp>) {
    let now = Instant::now();
    let mut writes = ledger();
    writes.retain(|write| now.duration_since(write.at) < WINDOW && write.path != path);
    if writes.len() >= MAX_WRITES {
        writes.remove(0);
    }
    writes.push(OwnWrite {
        path: path.to_path_buf(),
        stamp,
        at: now,
    });
}

fn recorded(path: &Path) -> Option<Option<Stamp>> {
    let now = Instant::now();
    let mut writes = ledger();
    writes.retain(|write| now.duration_since(write.at) < WINDOW);
    writes
        .iter()
        .find(|write| write.path == path)
        .map(|write| write.stamp.clone())
}

pub fn is_own(path: &Path) -> bool {
    recorded(path).is_some_and(|stamp| stamp_of(path) == stamp)
}

#[cfg(test)]
mod tests {
    use super::{
        commit_own, file_stamp, is_own, note_removal, note_stamp, note_write, stamp_of, write_own,
    };
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    #[test]
    fn a_recorded_removal_matches_only_while_nothing_is_back() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("gone.tex");
        std::fs::write(&path, "before").unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(!is_own(&path));

        note_removal(&path);
        assert!(is_own(&path));

        std::fs::write(&path, "made again elsewhere").unwrap();
        assert!(!is_own(&path));
    }

    #[test]
    fn only_files_are_recorded_and_a_rewrite_or_replacement_has_a_new_stamp() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("chapters");
        std::fs::create_dir(&folder).unwrap();
        note_write(&folder);
        assert!(!is_own(&folder));
        assert!(stamp_of(&folder).is_some());

        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let write_at = |path: &Path, text: &str, modified: SystemTime| {
            std::fs::write(path, text).unwrap();
            std::fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(modified)
                .unwrap();
        };
        let path = directory.path().join("main.tex");
        write_at(&path, "one", at);
        let first = stamp_of(&path).unwrap();
        write_at(&path, "two", at + Duration::from_secs(2));
        let rewritten = stamp_of(&path).unwrap();
        assert_eq!(
            (rewritten.length, rewritten.identity),
            (first.length, first.identity)
        );
        assert_ne!(rewritten, first);

        #[cfg(unix)]
        {
            let replacement = directory.path().join("main.tex.new");
            write_at(&replacement, "six", at + Duration::from_secs(2));
            std::fs::rename(&replacement, &path).unwrap();
            let replaced = stamp_of(&path).unwrap();
            assert_eq!(
                (replaced.length, replaced.modified),
                (rewritten.length, rewritten.modified)
            );
            assert_ne!(replaced, rewritten);
        }
        assert_eq!(stamp_of(&directory.path().join("missing")), None);
    }

    #[test]
    fn an_edit_that_lands_right_after_our_rename_is_not_taken_for_ours() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("main.tex");
        std::fs::write(&target, "Hello\n").unwrap();
        let staged = crate::atomic::stage_beside(&target, b"Hello again\n").unwrap();
        let ours = file_stamp(staged.path());
        crate::atomic::commit_staged(staged, &target).unwrap();
        std::fs::write(&target, "Hello, shorter\n").unwrap();
        note_stamp(&target, ours);
        assert!(!is_own(&target));

        write_own(&target, b"Hello\n").unwrap();
        assert!(is_own(&target));
        let staged = crate::atomic::stage_beside(&target, b"Hello there\n").unwrap();
        commit_own(staged, &target).unwrap();
        assert!(is_own(&target));
        std::fs::write(&target, "Hello there!\n").unwrap();
        assert!(!is_own(&target));
    }
}
