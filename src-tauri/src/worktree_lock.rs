//! Cross-process coordination for one project's visible worktree.
//!
//! The lock file lives in validated application data, never inside the source
//! tree. Restores can therefore replace portable project files while readers
//! and writers continue to coordinate on one stable inode.

use std::fs::{File, OpenOptions};
use std::path::Path;
use std::time::{Duration, Instant};

pub(crate) const RESTORE_PENDING_FILE: &str = "checkpoint-restore-pending";

#[derive(Debug)]
pub(crate) struct ProjectWorktreeLock {
    _file: File,
    _held: crate::stall_trace::Guard,
}

fn held(project_id: &str, mode: &str) -> crate::stall_trace::Guard {
    let project_id = project_id.to_string();
    let mode = mode.to_string();
    crate::stall_trace::watch(move || format!("worktree {mode} held on {project_id}"))
}

impl ProjectWorktreeLock {
    pub(crate) fn shared(project_id: &str) -> Result<Self, String> {
        let file = open_lock_file(project_id)?;
        {
            let _waiting =
                crate::stall_trace::watch(|| format!("worktree shared wait on {project_id}"));
            fs4::FileExt::lock_shared(&file)
                .map_err(|error| format!("could not acquire project read lock: {error}"))?;
        }
        let _held = held(project_id, "shared");
        reject_pending_restore(project_id)?;
        Ok(Self { _file: file, _held })
    }

    pub(crate) fn exclusive(project_id: &str) -> Result<Self, String> {
        let file = open_lock_file(project_id)?;
        {
            let _waiting =
                crate::stall_trace::watch(|| format!("worktree exclusive wait on {project_id}"));
            fs4::FileExt::lock(&file)
                .map_err(|error| format!("could not acquire project write lock: {error}"))?;
        }
        let _held = held(project_id, "exclusive");
        reject_pending_restore(project_id)?;
        Ok(Self { _file: file, _held })
    }

    /// Acquire the read lock, but give up instead of waiting forever. Project
    /// enumeration runs on every visit to the library and must never be able
    /// to park its caller: one holder of the write lock would otherwise stall
    /// the whole listing, and every action that triggers one after it.
    pub(crate) fn shared_bounded(project_id: &str, budget: Duration) -> Result<Self, String> {
        let file = open_lock_file(project_id)?;
        let deadline = Instant::now() + budget;
        loop {
            match fs4::FileExt::try_lock_shared(&file) {
                Ok(()) => break,
                Err(fs4::TryLockError::WouldBlock) => {
                    if Instant::now() >= deadline {
                        return Err(format!(
                            "project read lock was busy for {}ms",
                            budget.as_millis()
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(fs4::TryLockError::Error(error)) => {
                    return Err(format!("could not acquire project read lock: {error}"))
                }
            }
        }
        let _held = held(project_id, "shared-bounded");
        reject_pending_restore(project_id)?;
        Ok(Self { _file: file, _held })
    }

    /// Take the write lock only when it is free. Background maintenance that
    /// can safely run later must never queue readers behind itself: the file
    /// lock has no timeout, so one slow holder stalls every project listing.
    pub(crate) fn try_exclusive(project_id: &str) -> Result<Option<Self>, String> {
        let file = open_lock_file(project_id)?;
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => {}
            Err(fs4::TryLockError::WouldBlock) => return Ok(None),
            Err(fs4::TryLockError::Error(error)) => {
                return Err(format!("could not acquire project write lock: {error}"))
            }
        }
        let _held = held(project_id, "try-exclusive");
        reject_pending_restore(project_id)?;
        Ok(Some(Self { _file: file, _held }))
    }

    /// Identity allocation must serialize on the same stable lock, but an
    /// already-owned candidate with a pending restore is a collision to skip,
    /// not a reason to abort allocation of an unrelated new project id.
    pub(crate) fn exclusive_for_identity_allocation(project_id: &str) -> Result<Self, String> {
        let file = open_lock_file(project_id)?;
        {
            let _waiting =
                crate::stall_trace::watch(|| format!("worktree identity wait on {project_id}"));
            fs4::FileExt::lock(&file)
                .map_err(|error| format!("could not acquire project identity lock: {error}"))?;
        }
        let _held = held(project_id, "identity");
        Ok(Self { _file: file, _held })
    }

    /// Dedicated admission for project-open and Checkpoint restore recovery.
    /// Every ordinary reader and writer rejects the durable marker instead of
    /// observing a worktree whose prior restore may have stopped mid-commit.
    pub(crate) fn exclusive_for_restore_recovery(project_id: &str) -> Result<Self, String> {
        let file = open_lock_file(project_id)?;
        {
            let _waiting =
                crate::stall_trace::watch(|| format!("worktree recovery wait on {project_id}"));
            fs4::FileExt::lock(&file)
                .map_err(|error| format!("could not acquire project recovery lock: {error}"))?;
        }
        let _held = held(project_id, "recovery");
        Ok(Self { _file: file, _held })
    }
}

fn reject_pending_restore(project_id: &str) -> Result<(), String> {
    if pending_restore_marker_exists(project_id)? {
        return Err(
            "Checkpoint recovery is pending for this project. Reopen it to finish recovery before continuing."
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn pending_restore_marker_exists(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let projects = crate::paths::projects_root()?
        .canonicalize()
        .map_err(|error| format!("could not resolve projects directory: {error}"))?;
    let project = projects.join(project_id);
    match std::fs::symlink_metadata(&project) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("could not inspect project recovery state: {error}")),
        Ok(metadata) => validate_real_directory(&project, &metadata, "project")?,
    }
    let project = project
        .canonicalize()
        .map_err(|error| format!("could not resolve project recovery state: {error}"))?;
    if project.parent() != Some(projects.as_path()) {
        return Err("project recovery state escapes the projects directory".into());
    }

    let internal = project.join(".oleafly");
    match std::fs::symlink_metadata(&internal) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "could not inspect project recovery directory: {error}"
            ));
        }
        Ok(metadata) => {
            validate_real_directory(&internal, &metadata, "project recovery directory")?
        }
    }
    let internal = internal
        .canonicalize()
        .map_err(|error| format!("could not resolve project recovery directory: {error}"))?;
    if internal.parent() != Some(project.as_path()) {
        return Err("project recovery directory escapes the project".into());
    }

    let marker = internal.join(RESTORE_PENDING_FILE);
    let metadata = match std::fs::symlink_metadata(&marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("could not inspect restore marker: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("Checkpoint restore marker is not a regular file".into());
    }
    Ok(true)
}

fn validate_real_directory(
    path: &Path,
    metadata: &std::fs::Metadata,
    label: &str,
) -> Result<(), String> {
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(metadata) {
        return Err(format!(
            "{label} is not a real directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn open_lock_file(project_id: &str) -> Result<File, String> {
    let path = crate::paths::project_worktree_lock_file(project_id)?;
    let newly_created = match std::fs::symlink_metadata(&path) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            return Err(format!(
                "could not inspect project worktree lock path: {error}"
            ));
        }
    };
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
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
        .open(&path)
        .map_err(|error| format!("could not open project worktree lock: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("could not inspect project worktree lock: {error}"))?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        return Err("project worktree lock is not a regular file".into());
    }
    let path_metadata = std::fs::symlink_metadata(&path)
        .map_err(|error| format!("could not inspect project worktree lock path: {error}"))?;
    if !path_metadata.is_file()
        || path_metadata.file_type().is_symlink()
        || is_reparse_point(&path_metadata)
    {
        return Err("project worktree lock path is not a regular file".into());
    }
    let bound_file = file
        .try_clone()
        .map_err(|error| format!("could not clone project worktree lock: {error}"))?;
    let bound = same_file::Handle::from_file(bound_file)
        .map_err(|error| format!("could not bind project worktree lock: {error}"))?;
    let current = same_file::Handle::from_path(&path)
        .map_err(|error| format!("could not verify project worktree lock: {error}"))?;
    if bound != current {
        return Err("project worktree lock changed while it was opened".into());
    }
    // On Windows hardening invokes icacls, so avoid repeating it for every
    // status refresh or source read. Two first-open racers may both harden the
    // same file, which is harmless.
    if newly_created {
        crate::fsperm::harden_file(&path);
    }
    Ok(file)
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    use super::ProjectWorktreeLock;

    #[test]
    fn exclusive_lock_serializes_other_process_equivalent_handles() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let first = ProjectWorktreeLock::exclusive("paper").unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (acquired_tx, acquired_rx) = mpsc::channel();
        let waiter = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let _second = ProjectWorktreeLock::shared("paper").unwrap();
            acquired_tx.send(()).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(acquired_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());

        drop(first);
        acquired_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        waiter.join().unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn bounded_shared_lock_gives_up_instead_of_waiting_for_a_writer() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let held = ProjectWorktreeLock::exclusive("paper").unwrap();
        let started = std::time::Instant::now();
        let outcome = ProjectWorktreeLock::shared_bounded("paper", Duration::from_millis(150));
        let waited = started.elapsed();

        assert!(outcome.is_err());
        assert!(waited >= Duration::from_millis(150));
        assert!(waited < Duration::from_secs(5));

        drop(held);
        assert!(ProjectWorktreeLock::shared_bounded("paper", Duration::from_millis(150)).is_ok());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn crashed_restore_marker_rejects_normal_access_until_recovery_admission_clears_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        let internal = project.join(".oleafly");
        fs::create_dir(&internal).unwrap();

        let restore = ProjectWorktreeLock::exclusive_for_restore_recovery("paper").unwrap();
        fs::write(internal.join(super::RESTORE_PENDING_FILE), b"").unwrap();
        drop(restore);

        let read_error = ProjectWorktreeLock::shared("paper").unwrap_err();
        assert!(read_error.contains("recovery is pending"));
        let write_error = ProjectWorktreeLock::exclusive("paper").unwrap_err();
        assert!(write_error.contains("recovery is pending"));

        let recovery = ProjectWorktreeLock::exclusive_for_restore_recovery("paper").unwrap();
        fs::remove_file(internal.join(super::RESTORE_PENDING_FILE)).unwrap();
        drop(recovery);
        ProjectWorktreeLock::shared("paper").unwrap();

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_busy_project_does_not_block_the_try_lock() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let held = ProjectWorktreeLock::exclusive("busy-project").unwrap();

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            tx.send(ProjectWorktreeLock::try_exclusive("busy-project").map(|lock| lock.is_some()))
                .unwrap();
        });

        let answer = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("try_exclusive must answer while the lock is held");
        assert!(!answer.unwrap());
        drop(held);
        assert!(ProjectWorktreeLock::try_exclusive("busy-project")
            .unwrap()
            .is_some());
    }
}
