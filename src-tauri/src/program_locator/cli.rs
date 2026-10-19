//! `oleafly` for every program the app starts (CLI agents, terminals,
//! research commands): the folder `<data>/cli/bin` holds `oleafly`
//! (`oleafly.exe`), a link to the command-line tool that ships with the app,
//! or a copy on Windows and in AppImages. Agents get the folder first on
//! their PATH through `crate::acp::cli_program`.
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

#[cfg(unix)]
fn link_shim(shim: &Path, bundled: &Path) -> io::Result<()> {
    let target = bundled.canonicalize()?;
    if std::fs::read_link(shim).is_ok_and(|current| current == target) {
        return Ok(());
    }
    let temporary = staging_name(shim, "link");
    std::os::unix::fs::symlink(&target, &temporary)?;
    if let Err(error) = std::fs::rename(&temporary, shim) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
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
    let temporary = staging_name(shim, "copy");
    std::fs::copy(bundled, &temporary)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o755))?;
    }
    if let Err(error) = std::fs::rename(&temporary, shim) {
        let in_use = shim.exists() && cfg!(windows);
        if !in_use {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        let old = shim.with_file_name(format!(
            "{}.old-{}",
            shim.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        if let Err(error) =
            std::fs::rename(shim, &old).and_then(|()| std::fs::rename(&temporary, shim))
        {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
    }
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
    let shim = dir.join(executable("oleafly"));
    match method {
        // A file system without links still gets a working command.
        ShimMethod::Symlink => link_shim(&shim, bundled).or_else(|_| copy_shim(&shim, bundled))?,
        ShimMethod::Copy => copy_shim(&shim, bundled)?,
    }
    Ok(shim)
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
