//! Where the background helper keeps its files: `<data>/daemon/`.
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HelperPaths {
    pub dir: PathBuf,
    /// Held for the helper's whole life; one helper at a time.
    pub lock: PathBuf,
    /// Who runs, since when, and the last heartbeat.
    pub state: PathBuf,
    /// Written by the app, the CLI or the installer to ask the helper to stop.
    pub stop_request: PathBuf,
    pub log: PathBuf,
    /// The app that is open (it shows task notifications itself).
    pub app_open: PathBuf,
}

/// `<data>/daemon/{daemon.lock, state.json, stop-request, helper.log, app-open.json}`.
pub fn helper_paths(data_root: &Path) -> HelperPaths {
    let dir = data_root.join("daemon");
    HelperPaths {
        lock: dir.join("daemon.lock"),
        state: dir.join("state.json"),
        stop_request: dir.join("stop-request"),
        log: dir.join("helper.log"),
        app_open: dir.join("app-open.json"),
        dir,
    }
}

/// Creates the folder, private to the user.
pub fn ensure_dir(paths: &HelperPaths) -> std::io::Result<()> {
    std::fs::create_dir_all(&paths.dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&paths.dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_helper_files_sit_in_the_daemon_folder() {
        let paths = helper_paths(Path::new("/home/me/.oleafly"));
        assert_eq!(paths.dir, Path::new("/home/me/.oleafly/daemon"));
        assert_eq!(
            paths.lock,
            Path::new("/home/me/.oleafly/daemon/daemon.lock")
        );
        assert_eq!(
            paths.state,
            Path::new("/home/me/.oleafly/daemon/state.json")
        );
        assert_eq!(
            paths.stop_request,
            Path::new("/home/me/.oleafly/daemon/stop-request")
        );
        assert_eq!(paths.log, Path::new("/home/me/.oleafly/daemon/helper.log"));
        assert_eq!(
            paths.app_open,
            Path::new("/home/me/.oleafly/daemon/app-open.json")
        );
    }

    #[test]
    fn the_folder_is_created_under_a_non_ascii_profile() {
        let home = tempfile::tempdir().unwrap();
        let paths = helper_paths(&home.path().join("Zoë Müller").join(".oleafly"));
        ensure_dir(&paths).unwrap();
        assert!(paths.dir.is_dir());
    }
}
