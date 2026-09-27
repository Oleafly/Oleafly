use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const LINKED_CACHE_DIRECTORIES: [&str; 2] = ["build", "figbuild"];
pub(crate) const CACHEDIR_TAG: &str = "CACHEDIR.TAG";
pub(crate) const LINKED_BUILD_IDLE_LIMIT: Duration = Duration::from_secs(90 * 24 * 60 * 60);
const CACHEDIR_TAG_CONTENT: &[u8] = b"Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by Oleafly.\n# For information about cache directory tags, see:\n#\thttps://bford.info/cachedir/\n";

#[cfg(target_os = "macos")]
const BACKUP_EXCLUSION_ATTRIBUTE: &std::ffi::CStr =
    c"com.apple.metadata:com_apple_backup_excludeItem";

pub(crate) fn mark_cache_directory(directory: &Path) -> std::io::Result<()> {
    if write_cache_tag(directory)? {
        exclude_from_backups(directory)?;
    }
    Ok(())
}

pub(crate) fn mark_cache_directory_best_effort(directory: &Path) {
    static REPORTED: AtomicBool = AtomicBool::new(false);
    if let Err(error) = mark_cache_directory(directory) {
        if !REPORTED.swap(true, Ordering::Relaxed) {
            let _ = crate::project::append_app_log(format!(
                "Could not mark an opened folder's build output as a cache: {error}"
            ));
        }
    }
}

fn write_cache_tag(directory: &Path) -> std::io::Result<bool> {
    let tag = directory.join(CACHEDIR_TAG);
    match std::fs::symlink_metadata(&tag) {
        Ok(metadata) if metadata.is_file() => return Ok(false),
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "the cache tag is not a regular file",
            ))
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        Err(_) => {}
    }
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tag)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error),
    };
    std::io::Write::write_all(&mut file, CACHEDIR_TAG_CONTENT)?;
    Ok(true)
}

#[cfg(target_os = "macos")]
fn backup_exclusion_value() -> Vec<u8> {
    let mut value = b"bplist00_\x10\x11com.apple.backupd\x08".to_vec();
    value.extend([0; 6]);
    value.extend([1, 1]);
    value.extend([0; 7]);
    value.push(1);
    value.extend([0; 15]);
    value.push(0x1c);
    value
}

#[cfg(target_os = "macos")]
fn exclude_from_backups(directory: &Path) -> std::io::Result<()> {
    use std::os::unix::ffi::OsStrExt as _;
    let path = std::ffi::CString::new(directory.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    let value = backup_exclusion_value();
    let status = unsafe {
        libc::setxattr(
            path.as_ptr(),
            BACKUP_EXCLUSION_ATTRIBUTE.as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn exclude_from_backups(_directory: &Path) -> std::io::Result<()> {
    Ok(())
}

static BUILDS_IN_USE: Mutex<BTreeMap<String, usize>> = Mutex::new(BTreeMap::new());

fn builds_in_use() -> MutexGuard<'static, BTreeMap<String, usize>> {
    BUILDS_IN_USE.lock().unwrap_or_else(PoisonError::into_inner)
}

#[must_use]
pub(crate) struct BuildInUse {
    project_id: String,
}

impl BuildInUse {
    pub(crate) fn claim(project_id: &str) -> Self {
        *builds_in_use().entry(project_id.to_owned()).or_default() += 1;
        Self {
            project_id: project_id.to_owned(),
        }
    }
}

impl Drop for BuildInUse {
    fn drop(&mut self) {
        let mut builds = builds_in_use();
        if let Some(count) = builds.get_mut(&self.project_id) {
            *count -= 1;
            if *count == 0 {
                builds.remove(&self.project_id);
            }
        }
    }
}

fn build_in_use(project_id: &str) -> bool {
    builds_in_use().contains_key(project_id)
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct EvictionOutcome {
    pub(crate) evicted: Vec<String>,
    pub(crate) skipped_busy: Vec<String>,
    pub(crate) failures: Vec<String>,
}

pub(crate) fn evict_idle_linked_builds(now: SystemTime) -> Result<EvictionOutcome, String> {
    let mut outcome = EvictionOutcome::default();
    let Some(linked_root) = crate::paths::existing_linked_root()? else {
        return Ok(outcome);
    };
    for entry in crate::linked_registry::list()? {
        let crate::linked_registry::LinkEntry::Record(record) = entry else {
            continue;
        };
        let state_dir = linked_root.join(&record.id);
        match idle_caches(&state_dir, &record, now) {
            Ok(caches) if caches.is_empty() => continue,
            Ok(_) => {}
            Err(error) => {
                outcome.failures.push(format!("{}: {error}", record.id));
                continue;
            }
        }
        match crate::worktree_lock::ProjectWorktreeLock::try_exclusive(&record.id) {
            Ok(Some(_lock)) if build_in_use(&record.id) => {
                outcome.skipped_busy.push(record.id.clone());
            }
            Ok(Some(_lock)) => evict_if_still_idle(&state_dir, &record, now, &mut outcome),
            Ok(None) => outcome.skipped_busy.push(record.id.clone()),
            Err(error) => outcome.failures.push(format!("{}: {error}", record.id)),
        }
    }
    Ok(outcome)
}

fn idle_caches(
    state_dir: &Path,
    record: &crate::linked_registry::LinkRecord,
    now: SystemTime,
) -> Result<Vec<PathBuf>, String> {
    let caches = linked_caches(state_dir)?;
    Ok(if idle(record, &caches, now) {
        caches
    } else {
        Vec::new()
    })
}

fn evict_if_still_idle(
    state_dir: &Path,
    record: &crate::linked_registry::LinkRecord,
    now: SystemTime,
    outcome: &mut EvictionOutcome,
) {
    let caches = match idle_caches(state_dir, record, now) {
        Ok(caches) if caches.is_empty() => return,
        Ok(caches) => caches,
        Err(error) => {
            outcome.failures.push(format!("{}: {error}", record.id));
            return;
        }
    };
    let mut removed = true;
    for cache in &caches {
        if let Err(error) = std::fs::remove_dir_all(cache) {
            removed = false;
            outcome
                .failures
                .push(format!("{}: {error}", cache.display()));
        }
    }
    if removed {
        outcome.evicted.push(record.id.clone());
    }
}

pub(crate) fn evict_idle_linked_builds_at_startup() {
    match evict_idle_linked_builds(SystemTime::now()) {
        Ok(outcome) => {
            if !outcome.evicted.is_empty() {
                let _ = crate::project::append_app_log(format!(
                    "Removed idle build output for {} opened folders",
                    outcome.evicted.len()
                ));
            }
            for failure in outcome.failures {
                let _ = crate::project::append_app_log(format!(
                    "Could not remove idle build output for an opened folder: {failure}"
                ));
            }
        }
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not check opened folders for idle build output: {error}"
            ));
        }
    }
}

fn linked_caches(state_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut caches = Vec::new();
    for name in LINKED_CACHE_DIRECTORIES {
        if let Some(cache) =
            crate::paths::linked_state_directory(state_dir, Path::new(name), false)?
        {
            caches.push(cache);
        }
    }
    Ok(caches)
}

fn idle(record: &crate::linked_registry::LinkRecord, caches: &[PathBuf], now: SystemTime) -> bool {
    let opened = UNIX_EPOCH
        .checked_add(Duration::from_millis(record.last_opened_at))
        .unwrap_or(now);
    let used = caches
        .iter()
        .flat_map(|cache| {
            [
                cache.clone(),
                cache.join(format!("{}.pdf", crate::paths::ENTRY_STEM)),
                cache.join("_figure.pdf"),
            ]
        })
        .filter_map(|path| std::fs::symlink_metadata(path).ok()?.modified().ok())
        .fold(opened, SystemTime::max);
    now.duration_since(used)
        .is_ok_and(|elapsed| elapsed >= LINKED_BUILD_IDLE_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_directories_are_tagged_once() {
        let directory = tempfile::tempdir().unwrap();
        mark_cache_directory(directory.path()).unwrap();
        mark_cache_directory(directory.path()).unwrap();
        let tag = std::fs::read(directory.path().join(CACHEDIR_TAG)).unwrap();
        assert!(tag.starts_with(b"Signature: 8a477f597d28d172789f06886806bc55"));
    }

    #[cfg(unix)]
    #[test]
    fn a_substituted_cache_tag_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join(CACHEDIR_TAG)).unwrap();
        assert!(mark_cache_directory(directory.path()).is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cache_directories_are_excluded_from_time_machine_with_tmutils_value() {
        let expected = "62706C69737430305F1011636F6D2E6170706C652E6261636B75706408000000000000010100000000000000010000000000000000000000000000001C";
        let hex: String = backup_exclusion_value()
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect();
        assert_eq!(hex, expected);
        let directory = tempfile::tempdir().unwrap();
        mark_cache_directory(directory.path()).unwrap();
        use std::os::unix::ffi::OsStrExt as _;
        let path = std::ffi::CString::new(directory.path().as_os_str().as_bytes()).unwrap();
        let mut buffer = vec![0_u8; 256];
        let read = unsafe {
            libc::getxattr(
                path.as_ptr(),
                BACKUP_EXCLUSION_ATTRIBUTE.as_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                0,
                libc::XATTR_NOFOLLOW,
            )
        };
        assert!(read >= 0);
        buffer.truncate(read as usize);
        assert_eq!(buffer, backup_exclusion_value());
    }

    const DAY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

    struct Fixture {
        _data: tempfile::TempDir,
        folders: tempfile::TempDir,
        _env: std::sync::MutexGuard<'static, ()>,
    }

    impl Fixture {
        fn new() -> Self {
            let env = crate::paths::data_dir_env_lock();
            let data = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", data.path());
            Self {
                _data: data,
                folders: tempfile::tempdir().unwrap(),
                _env: env,
            }
        }

        fn linked(&self) -> (crate::linked_registry::LinkRecord, std::path::PathBuf) {
            let folder = self.folders.path().join("thesis");
            std::fs::create_dir(&folder).unwrap();
            std::fs::write(folder.join("main.tex"), b"keep").unwrap();
            (
                crate::linked_registry::register_folder_for_test(&folder),
                folder,
            )
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    #[test]
    fn idle_folder_builds_are_evicted_and_everything_else_is_kept() {
        let fixture = Fixture::new();
        let (record, folder) = fixture.linked();
        let build = crate::paths::build_dir(&record.id).unwrap();
        let figures = crate::paths::figure_build_dir(&record.id).unwrap();
        let provenance = crate::paths::builds_metadata_dir(&record.id).unwrap();
        std::fs::write(build.join("_oleafly_entry.pdf"), b"%PDF").unwrap();
        std::fs::write(provenance.join("build-0000000001.json"), b"{}").unwrap();
        crate::paths::create_project_dir("paper").unwrap();
        let library_build = crate::paths::build_dir("paper").unwrap();
        std::fs::write(library_build.join("_oleafly_entry.pdf"), b"%PDF").unwrap();
        let before = crate::linked_registry::folder_snapshot_for_test(&folder);

        let recent = evict_idle_linked_builds(std::time::SystemTime::now() + 30 * DAY).unwrap();
        assert!(recent.evicted.is_empty());
        assert!(build.join("_oleafly_entry.pdf").is_file());

        let idle = evict_idle_linked_builds(std::time::SystemTime::now() + 91 * DAY).unwrap();
        assert_eq!(idle.evicted, vec![record.id.clone()]);
        assert!(!build.exists());
        assert!(!figures.exists());
        assert!(provenance.join("build-0000000001.json").is_file());
        let state = crate::paths::existing_linked_root()
            .unwrap()
            .unwrap()
            .join(&record.id);
        assert!(state.join(crate::linked_registry::LINK_FILE).is_file());
        assert!(library_build.join("_oleafly_entry.pdf").is_file());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&folder),
            before
        );
    }

    #[test]
    fn a_busy_folder_keeps_its_build() {
        let fixture = Fixture::new();
        let (record, _) = fixture.linked();
        let build = crate::paths::build_dir(&record.id).unwrap();
        let _held = crate::worktree_lock::ProjectWorktreeLock::exclusive(&record.id).unwrap();
        let outcome = evict_idle_linked_builds(std::time::SystemTime::now() + 91 * DAY).unwrap();
        assert_eq!(outcome.skipped_busy, vec![record.id.clone()]);
        assert!(build.is_dir());
    }

    #[test]
    fn a_folder_with_a_compile_in_flight_keeps_its_build() {
        let fixture = Fixture::new();
        let (record, _) = fixture.linked();
        let build = crate::paths::build_dir(&record.id).unwrap();
        std::fs::write(build.join("_oleafly_entry.log"), b"running").unwrap();
        let compile = BuildInUse::claim(&record.id);
        let second = BuildInUse::claim(&record.id);
        drop(second);
        let outcome = evict_idle_linked_builds(std::time::SystemTime::now() + 91 * DAY).unwrap();
        assert_eq!(outcome.skipped_busy, vec![record.id.clone()]);
        assert!(outcome.evicted.is_empty());
        assert!(build.join("_oleafly_entry.log").is_file());
        drop(compile);
        let outcome = evict_idle_linked_builds(std::time::SystemTime::now() + 91 * DAY).unwrap();
        assert_eq!(outcome.evicted, vec![record.id.clone()]);
        assert!(!build.exists());
    }

    #[test]
    fn a_build_used_after_the_first_idle_check_is_kept() {
        let fixture = Fixture::new();
        let (record, _) = fixture.linked();
        let build = crate::paths::build_dir(&record.id).unwrap();
        let state_dir = crate::paths::existing_linked_root()
            .unwrap()
            .unwrap()
            .join(&record.id);
        let later = std::time::SystemTime::now() + 91 * DAY;
        assert!(!idle_caches(&state_dir, &record, later).unwrap().is_empty());
        let pdf = build.join("_oleafly_entry.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&pdf)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let mut outcome = EvictionOutcome::default();
        evict_if_still_idle(&state_dir, &record, later, &mut outcome);
        assert_eq!(outcome, EvictionOutcome::default());
        assert!(pdf.is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_substituted_build_directory_is_never_followed() {
        let fixture = Fixture::new();
        let (record, _) = fixture.linked();
        let build = crate::paths::build_dir(&record.id).unwrap();
        std::fs::remove_dir_all(&build).unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(outside.path(), &build).unwrap();
        let outcome = evict_idle_linked_builds(std::time::SystemTime::now() + 91 * DAY).unwrap();
        assert!(outcome.evicted.is_empty());
        assert!(!outcome.failures.is_empty());
        assert!(outside.path().join("keep.txt").is_file());
    }
}
