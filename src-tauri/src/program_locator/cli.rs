//! `oleafly` for every program the app starts (CLI agents, terminals,
//! research commands): the folder `<data>/cli/bin` holds `oleafly`
//! (`oleafly.exe`), a link to the command-line tool that ships with the app,
//! or a copy on Windows and in AppImages. Agents get the folder first on
//! their PATH through `crate::acp::cli_program`.
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A staged copy or link older than this belongs to a process that is gone
/// (a copy takes seconds).
const STALE_STAGING: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShimMethod {
    Symlink,
    Copy,
}

/// Windows can't run a link to an executable the way a shell expects, and
/// an AppImage's files vanish when it exits, so both get a copy.
pub(crate) fn plan_shim(windows: bool, appimage: bool) -> ShimMethod {
    if windows || appimage {
        ShimMethod::Copy
    } else {
        ShimMethod::Symlink
    }
}

fn executable(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

/// The command-line tool beside the app (`oleafly-cli`; a development
/// build may only have `oleaflyc`).
pub(crate) fn bundled_cli() -> Option<PathBuf> {
    let dir = oleafly_core::sidecar::executable_dir()?;
    let mut names = vec![executable("oleafly-cli")];
    if cfg!(debug_assertions) {
        names.push(executable("oleaflyc"));
    }
    names
        .into_iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

fn running_from_appimage() -> bool {
    let (Some(_), Some(appdir)) = (std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR")) else {
        return false;
    };
    std::env::current_exe().is_ok_and(|exe| exe.starts_with(PathBuf::from(appdir)))
}

fn staging_name(shim: &Path, label: &str) -> PathBuf {
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    shim.with_file_name(format!(
        ".oleafly-{label}-{}-{sequence}",
        std::process::id()
    ))
}

/// A file being prepared beside the shim, removed again unless it was
/// moved into place: a copy that fails halfway (disk full, antivirus) must
/// not leave a partial binary behind.
struct Staged {
    path: PathBuf,
    in_place: bool,
}

impl Staged {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            in_place: false,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    /// The file is in place; there is nothing to remove.
    fn keep(&mut self) {
        self.in_place = true;
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        if !self.in_place {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Removes staged copies and links that a crashed or killed process left
/// beside the shim: `.oleafly-copy-*` and `.oleafly-link-*` older than
/// `older_than` (a copy another process is making right now is younger).
fn sweep_staging(dir: &Path, older_than: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with(".oleafly-copy-") || name.starts_with(".oleafly-link-")) {
            continue;
        }
        let age = entry
            .path()
            .symlink_metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok());
        if age.is_some_and(|age| age >= older_than) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(unix)]
fn link_shim(shim: &Path, bundled: &Path) -> io::Result<()> {
    let target = bundled.canonicalize()?;
    if std::fs::read_link(shim).is_ok_and(|current| current == target) {
        return Ok(());
    }
    let mut temporary = Staged::new(staging_name(shim, "link"));
    std::os::unix::fs::symlink(&target, temporary.path())?;
    std::fs::rename(temporary.path(), shim)?;
    temporary.keep();
    Ok(())
}

#[cfg(not(unix))]
fn link_shim(shim: &Path, bundled: &Path) -> io::Result<()> {
    copy_shim(shim, bundled)
}

fn same_binary(left: &Path, right: &Path) -> bool {
    let regular = std::fs::symlink_metadata(left).is_ok_and(|metadata| metadata.is_file());
    regular
        && std::fs::metadata(left).ok().map(|metadata| metadata.len())
            == std::fs::metadata(right).ok().map(|metadata| metadata.len())
        && oleafly_core::biber_env::binary_fingerprint(left).ok()
            == oleafly_core::biber_env::binary_fingerprint(right).ok()
}

/// Copies `bundled` to `shim` when it differs. A copy another program is
/// running can't be replaced on Windows, but it can be renamed out of the
/// way first.
fn copy_shim(shim: &Path, bundled: &Path) -> io::Result<()> {
    if same_binary(shim, bundled) {
        return Ok(());
    }
    // Created before the copy starts, so a copy that fails partway is removed.
    let mut temporary = Staged::new(staging_name(shim, "copy"));
    std::fs::copy(bundled, temporary.path())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The command lives in this user's own folder: they run it, and
        // nobody else needs to.
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
    }
    if let Err(error) = std::fs::rename(temporary.path(), shim) {
        let in_use = shim.exists() && cfg!(windows);
        if !in_use {
            return Err(error);
        }
        let old = shim.with_file_name(format!(
            "{}.old-{}",
            shim.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::rename(shim, &old).and_then(|()| std::fs::rename(temporary.path(), shim))?;
    }
    temporary.keep();
    sweep_old_copies(shim);
    Ok(())
}

/// Copies left behind by a replace while they were running.
fn sweep_old_copies(shim: &Path) {
    let (Some(dir), Some(name)) = (shim.parent(), shim.file_name()) else {
        return;
    };
    let prefix = format!("{}.old-", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Makes `<dir>/oleafly[.exe]` run `bundled`; returns its path.
pub(crate) fn ensure_shim_at(
    dir: &Path,
    bundled: &Path,
    method: ShimMethod,
) -> io::Result<PathBuf> {
    match std::fs::symlink_metadata(dir) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(io::Error::other(
                "the command-line tool folder isn't a real folder",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => std::fs::create_dir_all(dir)?,
        Err(error) => return Err(error),
    }
    sweep_staging(dir, STALE_STAGING);
    let shim = dir.join(executable("oleafly"));
    match method {
        // A file system without links still gets a working command.
        ShimMethod::Symlink => link_shim(&shim, bundled).or_else(|_| copy_shim(&shim, bundled))?,
        ShimMethod::Copy => copy_shim(&shim, bundled)?,
    }
    Ok(shim)
}

/// The command an earlier launch left in `dir`, at the path
/// [`ensure_shim_at`] writes it to.
fn existing_shim(dir: &Path) -> Option<PathBuf> {
    let shim = dir.join(executable("oleafly"));
    std::fs::symlink_metadata(&shim)
        .is_ok_and(|metadata| metadata.is_file() || metadata.file_type().is_symlink())
        .then_some(shim)
}

/// Where [`refresh_cli_shim`] keeps `oleafly`, when an earlier launch put it
/// there already and this build ships the tool: known before the refresh
/// runs, so a terminal or agent started meanwhile (a terminal restored at
/// launch, while Windows copies and scans the new binary) still gets it.
pub(crate) fn planned_cli_shim() -> Option<PathBuf> {
    bundled_cli()?;
    existing_shim(&crate::paths::oleafly_root().ok()?.join("cli").join("bin"))
}

/// Sets up `<data>/cli/bin/oleafly` for this build; returns its path.
pub(crate) fn refresh_cli_shim() -> Result<PathBuf, String> {
    let bundled =
        bundled_cli().ok_or("this build doesn't include the oleafly command-line tool")?;
    let dir = crate::paths::oleafly_root()?.join("cli").join("bin");
    let method = plan_shim(cfg!(windows), running_from_appimage());
    ensure_shim_at(&dir, &bundled, method)
        .map_err(|error| format!("could not set up the oleafly command for agents: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_cli(dir: &Path, bytes: &[u8]) -> PathBuf {
        let path = dir.join(executable("oleafly-cli"));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn staged_leftovers(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".oleafly-"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_staged_file_is_removed_unless_it_was_kept() {
        let dir = tempfile::tempdir().unwrap();
        let dropped = dir.path().join(".oleafly-copy-1-0");
        std::fs::write(&dropped, b"partial").unwrap();
        drop(Staged::new(dropped.clone()));
        assert!(!dropped.exists());
        let kept = dir.path().join(".oleafly-copy-1-1");
        std::fs::write(&kept, b"whole").unwrap();
        let mut staged = Staged::new(kept.clone());
        staged.keep();
        drop(staged);
        assert!(kept.exists());
    }

    #[test]
    fn a_copy_that_fails_leaves_nothing_behind() {
        let bundle = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join("cli").join("bin");
        // What the copy is made from isn't a file: the copy fails.
        assert!(ensure_shim_at(&dir, bundle.path(), ShimMethod::Copy).is_err());
        assert_eq!(staged_leftovers(&dir), Vec::<String>::new());
    }

    // On Windows a shim in the way is renamed aside, so this fails only
    // elsewhere.
    #[cfg(unix)]
    #[test]
    fn a_copy_that_cannot_be_moved_into_place_is_removed() {
        let bundle = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join("cli").join("bin");
        let cli = fake_cli(bundle.path(), b"cli");
        std::fs::create_dir_all(dir.join(executable("oleafly"))).unwrap();
        assert!(ensure_shim_at(&dir, &cli, ShimMethod::Copy).is_err());
        assert_eq!(staged_leftovers(&dir), Vec::<String>::new());
    }

    #[test]
    fn old_staged_copies_and_links_are_swept_young_ones_stay() {
        let dir = tempfile::tempdir().unwrap();
        let old_copy = dir.path().join(".oleafly-copy-99-0");
        let old_link = dir.path().join(".oleafly-link-99-1");
        let young = dir.path().join(".oleafly-copy-100-0");
        let unrelated = dir.path().join(".oleafly-settings");
        for path in [&old_copy, &old_link, &young, &unrelated] {
            std::fs::write(path, b"x").unwrap();
        }
        let long_ago = SystemTime::now() - Duration::from_secs(3600);
        for path in [&old_copy, &old_link] {
            std::fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(long_ago)
                .unwrap();
        }
        sweep_staging(dir.path(), STALE_STAGING);
        assert_eq!(
            staged_leftovers(dir.path()),
            vec![
                ".oleafly-copy-100-0".to_string(),
                ".oleafly-settings".to_string()
            ]
        );
    }

    #[test]
    fn plan_shim_copies_on_windows_and_for_appimages() {
        assert_eq!(plan_shim(false, false), ShimMethod::Symlink);
        assert_eq!(plan_shim(false, true), ShimMethod::Copy);
        assert_eq!(plan_shim(true, false), ShimMethod::Copy);
    }

    #[cfg(unix)]
    #[test]
    fn the_shim_points_oleafly_at_the_bundled_cli() {
        let bundle = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let cli = fake_cli(bundle.path(), b"cli one");
        let dir = data.path().join("cli").join("bin");
        let shim = ensure_shim_at(&dir, &cli, ShimMethod::Symlink).unwrap();
        assert_eq!(shim, dir.join("oleafly"));
        assert_eq!(
            std::fs::read_link(&shim).unwrap(),
            cli.canonicalize().unwrap()
        );
        ensure_shim_at(&dir, &cli, ShimMethod::Symlink).unwrap();
        let other = bundle.path().join("oleafly-cli-new");
        std::fs::write(&other, b"cli two").unwrap();
        ensure_shim_at(&dir, &other, ShimMethod::Symlink).unwrap();
        assert_eq!(std::fs::read(&shim).unwrap(), b"cli two");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".oleafly-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn copied_shims_refresh_only_when_the_cli_changed() {
        let bundle = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join("Ada Lovelace").join("cli").join("bin");
        let cli = fake_cli(bundle.path(), b"version one");
        let shim = ensure_shim_at(&dir, &cli, ShimMethod::Copy).unwrap();
        assert_eq!(shim, dir.join(executable("oleafly")));
        assert_eq!(std::fs::read(&shim).unwrap(), b"version one");
        assert!(!std::fs::symlink_metadata(&shim)
            .unwrap()
            .file_type()
            .is_symlink());
        let before = std::fs::metadata(&shim).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        ensure_shim_at(&dir, &cli, ShimMethod::Copy).unwrap();
        assert_eq!(
            std::fs::metadata(&shim).unwrap().modified().unwrap(),
            before
        );
        std::fs::write(&cli, b"version two, longer").unwrap();
        ensure_shim_at(&dir, &cli, ShimMethod::Copy).unwrap();
        assert_eq!(std::fs::read(&shim).unwrap(), b"version two, longer");
    }

    #[test]
    fn the_planned_shim_is_where_the_refresh_puts_it() {
        let bundle = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join("cli").join("bin");
        // Nothing yet: the first launch waits for the refresh.
        assert_eq!(existing_shim(&dir), None);
        let cli = fake_cli(bundle.path(), b"cli");
        let shim = ensure_shim_at(&dir, &cli, ShimMethod::Copy).unwrap();
        assert_eq!(existing_shim(&dir), Some(shim));
    }

    #[test]
    fn a_linked_folder_is_refused() {
        let data = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        let cli = fake_cli(bundle.path(), b"cli");
        let file = data.path().join("not-a-folder");
        std::fs::write(&file, b"x").unwrap();
        assert!(ensure_shim_at(&file, &cli, ShimMethod::Copy).is_err());
    }

    #[test]
    fn the_child_path_starts_with_the_shim_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = crate::program_locator::child_search_path(&[dir.path().to_path_buf()], &[]);
        let first = std::env::split_paths(&path).next().unwrap();
        assert_eq!(first, dir.path());
    }
}
