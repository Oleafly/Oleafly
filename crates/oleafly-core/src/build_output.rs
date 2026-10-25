//! Sharing a build folder between the app and the CLI (or two CLIs): one
//! build at a time through a lock file beside the folder, outputs written to
//! a staging folder and renamed into place only when the build ends, and a
//! snapshot that tells a fresh PDF from one a failed build left behind.
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// Staging folders inside a build folder start with this.
pub const STAGING_PREFIX: &str = ".oleafly-staging-";
const FIRST_WAIT: Duration = Duration::from_millis(50);
const LONGEST_WAIT: Duration = Duration::from_millis(500);

/// `<parent>/<name>.lock` beside the build folder (`.oleafly/build.lock`,
/// `linked/<id>/build.lock`).
pub fn build_lock_path(build_dir: &Path) -> PathBuf {
    let name = build_dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "build".into());
    let parent = build_dir.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{name}.lock"))
}

/// An exclusive hold on a build folder; released when dropped.
#[derive(Debug)]
pub struct BuildLock {
    file: File,
    path: PathBuf,
}

impl BuildLock {
    fn open(build_dir: &Path) -> io::Result<(File, PathBuf)> {
        let path = build_lock_path(build_dir);
        if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "{} is a symbolic link, so Oleafly won't lock through it",
                    path.display()
                ),
            ));
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)?;
        Ok((file, path))
    }

    /// The lock now, or `None` while another build holds it.
    pub fn try_acquire(build_dir: &Path) -> io::Result<Option<BuildLock>> {
        let (file, path) = Self::open(build_dir)?;
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => Ok(Some(BuildLock { file, path })),
            Err(fs4::TryLockError::WouldBlock) => Ok(None),
            Err(fs4::TryLockError::Error(error)) => Err(error),
        }
    }

    /// Waits up to `budget` for the lock; `on_wait` runs once, when the
    /// first try finds it held. Times out with `ErrorKind::TimedOut`.
    pub fn acquire(
        build_dir: &Path,
        budget: Duration,
        on_wait: &mut dyn FnMut(),
    ) -> io::Result<BuildLock> {
        let deadline = Instant::now() + budget;
        let mut wait = FIRST_WAIT;
        let mut waited = false;
        loop {
            if let Some(lock) = Self::try_acquire(build_dir)? {
                return Ok(lock);
            }
            if !waited {
                waited = true;
                on_wait();
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "another build of this project is still running",
                ));
            }
            std::thread::sleep(wait.min(deadline - now));
            wait = (wait * 2).min(LONGEST_WAIT);
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for BuildLock {
    fn drop(&mut self) {
        let _ = fs4::FileExt::unlock(&self.file);
    }
}

/// Whether a [`BuildLock`] error says the file system can't lock files at
/// all (NFS without a lock service, some cluster file systems), rather than
/// that something is wrong with this lock file (a link, no permission, a
/// full disk). Only then may a build take turns through a [`DirLock`]
/// instead; any other lock error stops the build, because two builds in one
/// folder overwrite each other's files. The app and the CLI both ask this.
pub fn locks_unsupported(error: &io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error().is_some_and(|code| {
            [
                libc::ENOLCK,
                libc::ENOTSUP,
                libc::EOPNOTSUPP,
                libc::ENOSYS,
                libc::EINVAL,
            ]
            .contains(&code)
        })
    }
    #[cfg(windows)]
    {
        const ERROR_INVALID_FUNCTION: i32 = 1;
        const ERROR_NOT_SUPPORTED: i32 = 50;
        matches!(
            error.raw_os_error(),
            Some(ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED)
        )
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = error;
        false
    }
}

/// The lock for build folders whose file system can't lock files: the
/// folder `<build>.lock.d` beside the build folder, made with a create that
/// fails when it is there, holding the process id and the time its build
/// started. Removed when dropped. One older than `stale_after` (longer than
/// any build may run) is a stopped build's and is taken over.
#[derive(Debug)]
pub struct DirLock {
    path: PathBuf,
}

impl DirLock {
    pub fn path_for(build_dir: &Path) -> PathBuf {
        let mut name = build_lock_path(build_dir).into_os_string();
        name.push(".d");
        PathBuf::from(name)
    }

    /// The lock now, or `None` while another build holds it.
    pub fn try_acquire(build_dir: &Path, stale_after: Duration) -> io::Result<Option<DirLock>> {
        let path = Self::path_for(build_dir);
        for _ in 0..2 {
            match std::fs::create_dir(&path) {
                Ok(()) => {
                    let started = SystemTime::now()
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_millis())
                        .unwrap_or_default();
                    let _ = std::fs::write(
                        path.join("owner"),
                        format!("{} {started}\n", std::process::id()),
                    );
                    return Ok(Some(DirLock { path }));
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    let metadata = std::fs::symlink_metadata(&path)?;
                    let age = metadata
                        .modified()
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .unwrap_or_default();
                    if metadata.is_dir() && age <= stale_after {
                        return Ok(None);
                    }
                    // A stopped build's folder, or something else in the way
                    // (a file, a link, never followed): removed, then tried
                    // once more.
                    if metadata.is_dir() {
                        std::fs::remove_dir_all(&path)?;
                    } else {
                        std::fs::remove_file(&path)?;
                    }
                }
                Err(error) => return Err(error),
            }
        }
        Ok(None)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for DirLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A private folder inside the build folder for one build's outputs.
#[derive(Debug)]
pub struct OutputStaging {
    dir: PathBuf,
    build_dir: PathBuf,
    promoted: bool,
}

impl OutputStaging {
    pub fn create(build_dir: &Path) -> io::Result<OutputStaging> {
        std::fs::create_dir_all(build_dir)?;
        let name = format!(
            "{STAGING_PREFIX}{}-{}",
            std::process::id(),
            &uuid::Uuid::now_v7().simple().to_string()[16..]
        );
        let dir = build_dir.join(name);
        std::fs::create_dir(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(OutputStaging {
            dir,
            build_dir: build_dir.to_path_buf(),
            promoted: false,
        })
    }

    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// Renames every staged file over the build folder's file of the same
    /// name and removes the staging folder. Returns the replaced paths.
    ///
    /// A rename that hits a sharing violation (a scanner, an indexer, a sync
    /// client or a viewer holding the file) is retried for a few seconds on
    /// Windows. The PDF and SyncTeX file go first: a viewer holding the PDF
    /// is the usual reason a rename fails, and failing before anything is
    /// replaced leaves the old, matching set of outputs in place rather than
    /// a new log beside an old PDF.
    pub fn promote_all(mut self) -> io::Result<Vec<PathBuf>> {
        let mut entries: Vec<_> = std::fs::read_dir(&self.dir)?
            .filter_map(Result::ok)
            .collect();
        entries.sort_by_key(|entry| (!is_viewed_output(&entry.file_name()), entry.file_name()));
        let mut promoted = Vec::new();
        for entry in entries {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }
            let destination = self.build_dir.join(entry.file_name());
            crate::atomic::persist_with_retry(|| std::fs::rename(entry.path(), &destination))?;
            promoted.push(destination);
        }
        self.promoted = true;
        let _ = std::fs::remove_dir_all(&self.dir);
        Ok(promoted)
    }
}

/// The outputs a viewer or an editor keeps open.
fn is_viewed_output(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy().to_ascii_lowercase();
    name.ends_with(".pdf") || name.ends_with(".synctex.gz") || name.ends_with(".synctex")
}

impl Drop for OutputStaging {
    fn drop(&mut self) {
        if !self.promoted {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

/// Removes staging folders older than `older_than` (left by a crash).
/// Returns how many went.
pub fn sweep_stale_staging(build_dir: &Path, older_than: Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(build_dir) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.filter_map(Result::ok) {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
        {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let age = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .unwrap_or_default();
        if age >= older_than && std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn content_identity(path: &Path) -> Option<(u64, [u8; 32])> {
    use sha2::Digest;
    use std::io::Read;
    // A link or a special file planted in the build folder is not an output:
    // following it could hash another file, and opening a FIFO would block.
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => hasher.update(&buffer[..read]),
            Err(_) => return None,
        }
    }
    Some((metadata.len(), hasher.finalize().into()))
}

/// What a set of build outputs looked like before a build ran in place.
#[derive(Clone, Debug, Default)]
pub struct ArtifactSnapshot {
    before: BTreeMap<PathBuf, Option<(u64, [u8; 32])>>,
}

impl ArtifactSnapshot {
    pub fn capture(paths: &[PathBuf]) -> ArtifactSnapshot {
        ArtifactSnapshot {
            before: paths
                .iter()
                .map(|path| (path.clone(), content_identity(path)))
                .collect(),
        }
    }

    /// The file exists and its length or content changed since the capture
    /// (or it was not captured and exists now).
    pub fn is_fresh(&self, path: &Path) -> bool {
        let now = content_identity(path);
        match self.before.get(path) {
            None => now.is_some(),
            Some(before) => now.is_some() && &now != before,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lock_lives_beside_the_build_folder() {
        assert_eq!(
            build_lock_path(Path::new("/p/.oleafly/build")),
            PathBuf::from("/p/.oleafly/build.lock")
        );
        let linked = Path::new("C:\\Users\\Ada\\.oleafly\\linked\\abc").join("build");
        assert_eq!(
            build_lock_path(&linked),
            Path::new("C:\\Users\\Ada\\.oleafly\\linked\\abc").join("build.lock")
        );
    }

    #[test]
    fn a_second_build_waits_for_the_lock_and_reports_the_wait() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        let held = BuildLock::try_acquire(&build).unwrap().unwrap();
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(held);
        });
        let started = Instant::now();
        let mut waits = 0;
        let _lock = BuildLock::acquire(&build, Duration::from_secs(5), &mut || waits += 1).unwrap();
        assert!(started.elapsed() >= Duration::from_millis(250));
        assert_eq!(waits, 1);
        releaser.join().unwrap();
    }

    #[test]
    fn a_lock_wait_times_out_with_timed_out() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        let _held = BuildLock::try_acquire(&build).unwrap().unwrap();
        let error = BuildLock::acquire(&build, Duration::from_millis(100), &mut || {}).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[cfg(unix)]
    #[test]
    fn only_file_systems_without_locks_may_build_without_the_lock_file() {
        for code in [libc::ENOLCK, libc::ENOTSUP, libc::ENOSYS, libc::EINVAL] {
            assert!(locks_unsupported(&io::Error::from_raw_os_error(code)));
        }
        // A broken lock file is not a reason to build unlocked.
        for code in [libc::EACCES, libc::ENOSPC, libc::EROFS] {
            assert!(!locks_unsupported(&io::Error::from_raw_os_error(code)));
        }
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("elsewhere");
        std::fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("build.lock")).unwrap();
        let linked = BuildLock::try_acquire(&dir.path().join("build")).unwrap_err();
        assert!(!locks_unsupported(&linked));
    }

    #[test]
    fn a_lock_folder_lets_one_build_in_at_a_time() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        let hour = Duration::from_secs(3600);
        let held = DirLock::try_acquire(&build, hour).unwrap().unwrap();
        assert_eq!(held.path(), dir.path().join("build.lock.d"));
        let owner = std::fs::read_to_string(held.path().join("owner")).unwrap();
        assert!(owner.starts_with(&format!("{} ", std::process::id())));
        assert!(DirLock::try_acquire(&build, hour).unwrap().is_none());
        drop(held);
        assert!(!dir.path().join("build.lock.d").exists());
        assert!(DirLock::try_acquire(&build, hour).unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn a_stopped_builds_lock_folder_is_taken_over() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        let left = DirLock::path_for(&build);
        std::fs::create_dir(&left).unwrap();
        let long_ago = SystemTime::now() - Duration::from_secs(3600);
        std::fs::File::open(&left)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        let taken = DirLock::try_acquire(&build, Duration::from_secs(60)).unwrap();
        assert!(taken.is_some());
        // A link in the way is removed, never followed.
        drop(taken);
        let elsewhere = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), &left).unwrap();
        assert!(DirLock::try_acquire(&build, Duration::from_secs(60))
            .unwrap()
            .is_some());
        assert!(elsewhere.path().is_dir());
        assert_eq!(std::fs::read_dir(elsewhere.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_lock_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("elsewhere");
        std::fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("build.lock")).unwrap();
        assert!(BuildLock::try_acquire(&dir.path().join("build")).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"keep");
    }

    #[test]
    fn promotion_replaces_outputs_in_one_rename_each() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        std::fs::create_dir_all(&build).unwrap();
        std::fs::write(build.join("_oleafly_entry.pdf"), b"old").unwrap();
        let staging = OutputStaging::create(&build).unwrap();
        let staged = staging.path().to_path_buf();
        std::fs::write(staged.join("_oleafly_entry.pdf"), b"new").unwrap();
        std::fs::write(staged.join("_oleafly_entry.log"), b"log").unwrap();
        let promoted = staging.promote_all().unwrap();
        assert_eq!(
            std::fs::read(build.join("_oleafly_entry.pdf")).unwrap(),
            b"new"
        );
        assert!(!staged.exists());
        assert_eq!(promoted.len(), 2);
    }

    // A directory in the PDF's place fails the rename the same way on every
    // system, but Windows retries that kind of error for seconds first.
    #[cfg(unix)]
    #[test]
    fn the_pdf_is_promoted_before_the_auxiliary_files() {
        // A destination that cannot be replaced (a directory stands in for a
        // PDF a viewer holds) fails the promotion at the first rename. The
        // PDF goes first, so the log and aux files were not replaced yet.
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        std::fs::create_dir_all(build.join("main.pdf")).unwrap();
        std::fs::write(build.join("main.aux"), b"old aux").unwrap();
        std::fs::write(build.join("main.log"), b"old log").unwrap();
        let staging = OutputStaging::create(&build).unwrap();
        for name in ["main.aux", "main.log", "main.pdf", "main.synctex.gz"] {
            std::fs::write(staging.path().join(name), b"new").unwrap();
        }
        assert!(staging.promote_all().is_err());
        assert_eq!(std::fs::read(build.join("main.aux")).unwrap(), b"old aux");
        assert_eq!(std::fs::read(build.join("main.log")).unwrap(), b"old log");
        assert!(!build.join("main.synctex.gz").exists());
    }

    #[test]
    fn promotion_orders_viewed_outputs_first_and_the_rest_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path().join("build");
        let staging = OutputStaging::create(&build).unwrap();
        for name in [
            "main.aux",
            "main.log",
            "main.pdf",
            "main.synctex.gz",
            "a.bbl",
        ] {
            std::fs::write(staging.path().join(name), b"new").unwrap();
        }
        let promoted: Vec<String> = staging
            .promote_all()
            .unwrap()
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            promoted,
            [
                "main.pdf",
                "main.synctex.gz",
                "a.bbl",
                "main.aux",
                "main.log"
            ]
        );
    }

    #[test]
    fn a_dropped_staging_folder_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let staging = OutputStaging::create(dir.path()).unwrap();
        let staged = staging.path().to_path_buf();
        drop(staging);
        assert!(!staged.exists());
    }

    #[test]
    fn stale_staging_folders_are_swept() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(format!("{STAGING_PREFIX}1-a"))).unwrap();
        std::fs::create_dir(dir.path().join(format!("{STAGING_PREFIX}2-b"))).unwrap();
        std::fs::write(dir.path().join("_oleafly_entry.pdf"), b"pdf").unwrap();
        assert_eq!(
            sweep_stale_staging(dir.path(), Duration::from_secs(3600)),
            0
        );
        assert_eq!(sweep_stale_staging(dir.path(), Duration::ZERO), 2);
        assert!(dir.path().join("_oleafly_entry.pdf").is_file());
    }

    #[test]
    fn snapshots_tell_a_rewritten_file_from_an_untouched_one() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("out.pdf");
        std::fs::write(&pdf, b"same").unwrap();
        let snapshot = ArtifactSnapshot::capture(std::slice::from_ref(&pdf));
        assert!(!snapshot.is_fresh(&pdf));
        std::fs::write(&pdf, b"same").unwrap();
        assert!(!snapshot.is_fresh(&pdf));
        std::fs::write(&pdf, b"different").unwrap();
        assert!(snapshot.is_fresh(&pdf));
        let new = dir.path().join("new.pdf");
        assert!(!snapshot.is_fresh(&new));
        std::fs::write(&new, b"x").unwrap();
        assert!(snapshot.is_fresh(&new));
    }

    #[cfg(unix)]
    #[test]
    fn a_planted_link_is_not_hashed_as_an_output() {
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, b"private").unwrap();
        let pdf = dir.path().join("out.pdf");
        std::os::unix::fs::symlink(&secret, &pdf).unwrap();
        assert_eq!(content_identity(&pdf), None);
        let snapshot = ArtifactSnapshot::capture(std::slice::from_ref(&pdf));
        // Replacing the link with a real output counts as a new build.
        std::fs::remove_file(&pdf).unwrap();
        std::fs::write(&pdf, b"private").unwrap();
        assert!(snapshot.is_fresh(&pdf));
    }
}
