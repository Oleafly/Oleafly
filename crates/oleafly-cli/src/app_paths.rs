//! Where the desktop app keeps things, from the CLI's side: the data folder,
//! the installed app (and the engines bundled beside it), a project's
//! identity in the app, its checkpoint store and its worktree lock.
use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::contract::{CliError, ErrorKind};

/// `OLEAFLY_DATA_DIR` when set and not empty, else `~/.oleafly`.
pub fn data_root() -> Option<PathBuf> {
    if let Some(directory) = std::env::var_os("OLEAFLY_DATA_DIR").filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(directory));
    }
    home_dir().map(|home| home.join(".oleafly"))
}

/// The user's home, as the app finds it. On Windows that is `USERPROFILE`
/// first: the app started from the Start menu has no `HOME`, while an MSYS2
/// or Cygwin shell sets one of its own (`C:\msys64\home\<user>`), and the
/// CLI must use the app's folder from there too.
pub fn home_dir() -> Option<PathBuf> {
    home_from(&|name| std::env::var_os(name), cfg!(windows))
}

fn home_from(
    variable: &dyn Fn(&str) -> Option<std::ffi::OsString>,
    windows: bool,
) -> Option<PathBuf> {
    let order: [&str; 2] = if windows {
        ["USERPROFILE", "HOME"]
    } else {
        ["HOME", "USERPROFILE"]
    };
    order
        .iter()
        .find_map(|name| variable(name).filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

/// This command's own file, links resolved.
pub fn own_executable() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|executable| executable.canonicalize().ok())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    Windows,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::MacOs
        } else if cfg!(windows) {
            Self::Windows
        } else {
            Self::Linux
        }
    }
}

/// The desktop app found on this computer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledApp {
    /// The app itself (GUI executable).
    pub executable: PathBuf,
    /// The folder its bundled engines (tectonic, typst, pandoc) sit in.
    pub bin_dir: PathBuf,
    /// Its resources folder (templates, skills), when found.
    pub resources_dir: Option<PathBuf>,
}

pub(crate) struct AppSearch {
    pub platform: Platform,
    /// The CLI's own folder (canonical).
    pub own_dir: Option<PathBuf>,
    /// `OLEAFLY_APP`.
    pub override_app: Option<PathBuf>,
    pub home: Option<PathBuf>,
    /// Windows install folders (registry, then `%LOCALAPPDATA%`, then
    /// Program Files).
    pub install_dirs: Vec<PathBuf>,
}

const MACOS_NAMES: [&str; 2] = ["oleafly", "Oleafly"];

fn macos_bundle_executables(bundle: &Path) -> Vec<(PathBuf, PathBuf)> {
    let folder = bundle.join("Contents").join("MacOS");
    MACOS_NAMES
        .iter()
        .map(|name| (folder.join(name), folder.clone()))
        .collect()
}

fn in_macos_bundle(folder: &Path) -> bool {
    folder.ends_with("Contents/MacOS")
        && folder
            .parent()
            .and_then(Path::parent)
            .and_then(Path::extension)
            .is_some_and(|extension| extension == "app")
}

/// GUI executables to look for, with the folder of their bundled engines,
/// best first.
pub(crate) fn app_bin_candidates(search: &AppSearch) -> Vec<(PathBuf, PathBuf)> {
    let mut candidates: Vec<(PathBuf, PathBuf)> = Vec::new();
    if let Some(own) = &search.own_dir {
        match search.platform {
            Platform::Windows => candidates.push((own.join("oleafly.exe"), own.clone())),
            Platform::Linux => candidates.push((own.join("oleafly-desktop"), own.clone())),
            Platform::MacOs if in_macos_bundle(own) => {
                candidates.extend(MACOS_NAMES.iter().map(|name| (own.join(name), own.clone())));
            }
            Platform::MacOs => {}
        }
    }
    if let Some(app) = &search.override_app {
        if app.extension().is_some_and(|extension| extension == "app") {
            candidates.extend(macos_bundle_executables(app));
        } else if let Some(folder) = app.parent() {
            candidates.push((app.clone(), folder.to_path_buf()));
        }
    }
    match search.platform {
        Platform::MacOs => {
            candidates.extend(macos_bundle_executables(Path::new(
                "/Applications/Oleafly.app",
            )));
            if let Some(home) = &search.home {
                candidates.extend(macos_bundle_executables(
                    &home.join("Applications").join("Oleafly.app"),
                ));
            }
        }
        Platform::Windows => {
            for folder in &search.install_dirs {
                candidates.push((folder.join("oleafly.exe"), folder.clone()));
            }
        }
        Platform::Linux => candidates.push((
            PathBuf::from("/usr/bin/oleafly-desktop"),
            PathBuf::from("/usr/bin"),
        )),
    }
    let mut unique: Vec<(PathBuf, PathBuf)> = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|(gui, _)| gui == &candidate.0) {
            unique.push(candidate);
        }
    }
    unique
}

/// Where the app's resources may be, for an engine folder.
pub(crate) fn resources_candidates(bin_dir: &Path, platform: Platform) -> Vec<PathBuf> {
    match platform {
        Platform::MacOs => bin_dir
            .parent()
            .map(|contents| vec![contents.join("Resources").join("resources")])
            .unwrap_or_default(),
        Platform::Windows => vec![bin_dir.join("resources")],
        Platform::Linux => {
            let mut candidates = vec![bin_dir.join("resources")];
            if let Some(prefix) = bin_dir.parent() {
                candidates.push(prefix.join("lib").join("Oleafly").join("resources"));
                candidates.push(prefix.join("lib").join("oleafly-desktop").join("resources"));
            }
            candidates
        }
    }
}

/// The installed app this CLI belongs to (or the first one found), never
/// this command itself.
pub fn installed_app() -> Option<InstalledApp> {
    let platform = Platform::current();
    let own = own_executable();
    let search = AppSearch {
        platform,
        own_dir: own
            .as_deref()
            .and_then(oleafly_core::sidecar::executable_dir_of),
        override_app: std::env::var_os("OLEAFLY_APP")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        home: home_dir(),
        install_dirs: crate::launcher::windows_install_dirs(),
    };
    app_bin_candidates(&search)
        .into_iter()
        .find_map(|(executable, bin_dir)| {
            if !executable.is_file()
                || crate::launcher::is_this_command(&executable, own.as_deref())
            {
                return None;
            }
            let resources_dir = resources_candidates(&bin_dir, platform)
                .into_iter()
                .find(|folder| folder.is_dir());
            Some(InstalledApp {
                executable,
                bin_dir,
                resources_dir,
            })
        })
}

/// The AppImage the app recorded for the terminal command (Linux). Its
/// engines live inside the image, so the CLI can't use them.
pub fn recorded_appimage() -> Option<PathBuf> {
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        crate::desktop_link::recorded_app().filter(|app| app.is_file())
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        None
    }
}

/// A project as the app knows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectIdentity {
    /// `<data>/projects/<id>`.
    Library { id: String },
    /// A folder the app opened in place.
    Linked { id: String, state_dir: PathBuf },
}

impl ProjectIdentity {
    pub fn id(&self) -> &str {
        match self {
            Self::Library { id } | Self::Linked { id, .. } => id,
        }
    }
}

fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// The app's id for the project at `root`, if the app knows it.
pub fn project_identity(root: &Path, data_root: &Path) -> Option<ProjectIdentity> {
    let real = root.canonicalize().ok()?;
    if let (Some(parent), Some(name)) = (real.parent(), real.file_name().and_then(OsStr::to_str)) {
        let projects = data_root.join("projects").canonicalize().ok();
        if projects.as_deref() == Some(parent) && valid_project_id(name) {
            return Some(ProjectIdentity::Library {
                id: name.to_string(),
            });
        }
    }
    crate::desktop_link::link_for(&real).map(|link| ProjectIdentity::Linked {
        id: link.id,
        state_dir: link.state_dir,
    })
}

fn is_real_directory(path: &Path) -> Result<bool, CliError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(CliError::new(
            ErrorKind::Io,
            "io.not_a_folder",
            format!("{} isn't a real folder.", path.display()),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(CliError::from(error)),
    }
}

/// The project's checkpoint store when it exists (creates nothing), with
/// the same checks the app makes: real folders, no links, no escape from
/// `<data>/checkpoints`.
pub fn existing_checkpoint_store(
    data_root: &Path,
    project_id: &str,
) -> Result<Option<PathBuf>, CliError> {
    if !valid_project_id(project_id) || !is_real_directory(data_root)? {
        return Ok(None);
    }
    let data = data_root.canonicalize().map_err(CliError::from)?;
    let checkpoints = data.join("checkpoints");
    if !is_real_directory(&checkpoints)? {
        return Ok(None);
    }
    let checkpoints = checkpoints.canonicalize().map_err(CliError::from)?;
    if checkpoints.parent() != Some(data.as_path()) {
        return Err(CliError::new(
            ErrorKind::Io,
            "io.not_a_folder",
            "The checkpoints folder escapes Oleafly's data folder.",
        ));
    }
    let store = checkpoints.join(project_id);
    if !is_real_directory(&store)? {
        return Ok(None);
    }
    let store = store.canonicalize().map_err(CliError::from)?;
    if store.parent() != Some(checkpoints.as_path()) {
        return Err(CliError::new(
            ErrorKind::Io,
            "io.not_a_folder",
            "The project's checkpoints escape the checkpoints folder.",
        ));
    }
    Ok(Some(store))
}

/// The app's exclusive lock on a project's files
/// (`<data>/project-worktree-locks/<id>.lock`), waited for up to `budget`.
pub fn worktree_lock(
    data_root: &Path,
    project_id: &str,
    budget: Duration,
) -> Result<File, CliError> {
    if !valid_project_id(project_id) {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "project.invalid_input",
            "The project id isn't valid.",
        ));
    }
    let locks = data_root.join("project-worktree-locks");
    std::fs::create_dir_all(&locks).map_err(CliError::from)?;
    if !is_real_directory(&locks)? {
        return Err(CliError::new(
            ErrorKind::Io,
            "io.not_a_folder",
            "The project lock folder isn't a real folder.",
        ));
    }
    let path = locks.join(format!("{project_id}.lock"));
    if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(CliError::new(
            ErrorKind::UnsafePath,
            "project.unsafe_path",
            "The project lock file is a link.",
        ));
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(CliError::from)?;
    let deadline = Instant::now() + budget;
    loop {
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => return Ok(file),
            Err(fs4::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(fs4::TryLockError::WouldBlock) => {
                return Err(CliError::new(
                    ErrorKind::Conflict,
                    "conflict.project_busy",
                    "The Oleafly app is changing this project right now.",
                )
                .hint("Try again in a moment.")
                .retryable())
            }
            Err(fs4::TryLockError::Error(error)) => return Err(CliError::from(error)),
        }
    }
}

/// Removes the project's shell-escape trust, as the app does whenever
/// something outside its editor changes a project's files: that trust is a
/// record kept apart from the files (`<data>/device-trust/latex-shell-escape/
/// <id>.json`), so it would otherwise carry over to whatever now sits in the
/// project. Creates nothing; a project with no trust is left as it is.
pub fn revoke_shell_escape_trust(data_root: &Path, project_id: &str) -> Result<(), CliError> {
    if !valid_project_id(project_id) {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "project.invalid_input",
            "The project id isn't valid.",
        ));
    }
    let unsafe_trust = |what: &str| {
        CliError::new(
            ErrorKind::Io,
            "io.not_a_folder",
            format!("Oleafly's {what} isn't a real folder."),
        )
    };
    let mut folder = data_root.to_path_buf();
    for (name, what) in [
        ("device-trust", "device trust folder"),
        ("latex-shell-escape", "shell trust folder"),
    ] {
        folder.push(name);
        match is_real_directory(&folder) {
            Ok(true) => {}
            // Nothing was ever trusted on this computer.
            Ok(false) => return Ok(()),
            Err(_) => return Err(unsafe_trust(what)),
        }
    }
    let path = folder.join(format!("{project_id}.json"));
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CliError::from(error)),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            Err(CliError::new(
                ErrorKind::Io,
                "io.not_a_folder",
                "Oleafly's shell trust record for this project is a folder.",
            ))
        }
        Ok(_) => std::fs::remove_file(&path).map_err(CliError::from),
    }
}

const RESTORE_PENDING_FILE: &str = "checkpoint-restore-pending";

/// A checkpoint restore the app hasn't finished recovering.
pub fn restore_pending(root: &Path, identity: &ProjectIdentity) -> bool {
    match identity {
        ProjectIdentity::Library { .. } => {
            root.join(".oleafly").join(RESTORE_PENDING_FILE).exists()
        }
        ProjectIdentity::Linked { state_dir, .. } => {
            state_dir.join("state").join(RESTORE_PENDING_FILE).exists()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_finds_the_home_the_app_uses_before_a_shells_home() {
        let shell = |name: &str| match name {
            "HOME" => Some("C:\\msys64\\home\\ada".into()),
            "USERPROFILE" => Some("C:\\Users\\ada".into()),
            _ => None,
        };
        assert_eq!(
            home_from(&shell, true),
            Some(PathBuf::from("C:\\Users\\ada"))
        );
        assert_eq!(
            home_from(&shell, false),
            Some(PathBuf::from("C:\\msys64\\home\\ada"))
        );
        let start_menu = |name: &str| (name == "USERPROFILE").then(|| "C:\\Users\\ada".into());
        assert_eq!(
            home_from(&start_menu, true),
            Some(PathBuf::from("C:\\Users\\ada"))
        );
        assert_eq!(home_from(&|_| Some("".into()), true), None);
    }

    #[test]
    fn installed_app_dirs_on_windows_read_the_registry_then_local_app_data() {
        let local = PathBuf::from(r"C:\Users\Ada Lovelace\AppData\Local\Oleafly");
        let search = AppSearch {
            platform: Platform::Windows,
            own_dir: Some(local.join("bin")),
            override_app: None,
            home: None,
            install_dirs: vec![
                PathBuf::from(r"D:\Apps\Oleafly"),
                local.clone(),
                PathBuf::from(r"C:\Program Files\Oleafly"),
            ],
        };
        let candidates: Vec<PathBuf> = app_bin_candidates(&search)
            .into_iter()
            .map(|(gui, _)| gui)
            .collect();
        assert_eq!(
            candidates,
            vec![
                local.join("bin").join("oleafly.exe"),
                PathBuf::from(r"D:\Apps\Oleafly").join("oleafly.exe"),
                local.join("oleafly.exe"),
                PathBuf::from(r"C:\Program Files\Oleafly").join("oleafly.exe"),
            ]
        );
    }

    #[test]
    fn macos_bundle_resources_sit_beside_contents_macos() {
        assert_eq!(
            resources_candidates(
                Path::new("/Applications/Oleafly.app/Contents/MacOS"),
                Platform::MacOs
            ),
            vec![PathBuf::from(
                "/Applications/Oleafly.app/Contents/Resources/resources"
            )]
        );
    }

    #[test]
    fn linux_package_resources_are_probed_in_usr_lib() {
        let candidates = resources_candidates(Path::new("/usr/bin"), Platform::Linux);
        let first = candidates
            .iter()
            .position(|path| path == Path::new("/usr/lib/Oleafly/resources"))
            .unwrap();
        let second = candidates
            .iter()
            .position(|path| path == Path::new("/usr/lib/oleafly-desktop/resources"))
            .unwrap();
        assert!(first < second);
    }

    #[cfg(unix)]
    #[test]
    fn a_command_symlinked_out_of_the_bundle_uses_its_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let macos = root.join("Oleafly.app/Contents/MacOS");
        std::fs::create_dir_all(&macos).unwrap();
        std::fs::write(macos.join("oleafly-cli"), b"").unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::os::unix::fs::symlink(macos.join("oleafly-cli"), root.join("bin/oleafly")).unwrap();
        let own_dir = oleafly_core::sidecar::executable_dir_of(&root.join("bin/oleafly")).unwrap();
        assert_eq!(own_dir, macos);
        let search = AppSearch {
            platform: Platform::MacOs,
            own_dir: Some(own_dir),
            override_app: None,
            home: None,
            install_dirs: Vec::new(),
        };
        assert_eq!(app_bin_candidates(&search)[0].0, macos.join("oleafly"));
    }

    #[test]
    fn library_projects_are_identified_by_their_folder_name() {
        let data = tempfile::tempdir().unwrap();
        let project = data.path().join("projects").join("p1");
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(
            project_identity(&project, data.path()),
            Some(ProjectIdentity::Library { id: "p1".into() })
        );
        let elsewhere = tempfile::tempdir().unwrap();
        assert_eq!(project_identity(elsewhere.path(), data.path()), None);
    }

    #[test]
    fn checkpoint_stores_are_found_without_creating_anything() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(existing_checkpoint_store(data.path(), "p1").unwrap(), None);
        assert!(!data.path().join("checkpoints").exists());
        std::fs::create_dir_all(data.path().join("checkpoints/p1")).unwrap();
        assert!(existing_checkpoint_store(data.path(), "p1")
            .unwrap()
            .is_some());
        assert_eq!(
            existing_checkpoint_store(data.path(), "../x").unwrap(),
            None
        );
    }

    #[test]
    fn shell_trust_is_revoked_for_that_project_only() {
        let data = tempfile::tempdir().unwrap();
        // No trust folder: nothing to do, and nothing is created.
        revoke_shell_escape_trust(data.path(), "p1").unwrap();
        assert!(!data.path().join("device-trust").exists());
        let trust = data.path().join("device-trust").join("latex-shell-escape");
        std::fs::create_dir_all(&trust).unwrap();
        std::fs::write(trust.join("p1.json"), "{}").unwrap();
        std::fs::write(trust.join("p2.json"), "{}").unwrap();
        revoke_shell_escape_trust(data.path(), "p1").unwrap();
        assert!(!trust.join("p1.json").exists());
        assert!(trust.join("p2.json").exists());
        revoke_shell_escape_trust(data.path(), "p1").unwrap();
        for bad in ["", "../p2", "a/b", "p2.json"] {
            assert!(
                revoke_shell_escape_trust(data.path(), bad).is_err(),
                "{bad}"
            );
        }
        assert!(trust.join("p2.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn shell_trust_revocation_does_not_follow_links_out_of_the_data_folder() {
        let data = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(elsewhere.path().join("latex-shell-escape")).unwrap();
        std::fs::write(
            elsewhere.path().join("latex-shell-escape").join("p1.json"),
            "{}",
        )
        .unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), data.path().join("device-trust")).unwrap();
        assert!(revoke_shell_escape_trust(data.path(), "p1").is_err());
        assert!(elsewhere
            .path()
            .join("latex-shell-escape")
            .join("p1.json")
            .exists());
        // A link in the record's place is removed, not its target.
        let data = tempfile::tempdir().unwrap();
        let trust = data.path().join("device-trust").join("latex-shell-escape");
        std::fs::create_dir_all(&trust).unwrap();
        let target = elsewhere.path().join("keep.txt");
        std::fs::write(&target, "x").unwrap();
        std::os::unix::fs::symlink(&target, trust.join("p1.json")).unwrap();
        revoke_shell_escape_trust(data.path(), "p1").unwrap();
        assert!(!trust.join("p1.json").exists());
        assert!(target.exists());
    }

    #[test]
    fn the_worktree_lock_waits_then_reports_a_busy_project() {
        let data = tempfile::tempdir().unwrap();
        let held = worktree_lock(data.path(), "p1", Duration::from_secs(1)).unwrap();
        let error = worktree_lock(data.path(), "p1", Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.code, "conflict.project_busy");
        drop(held);
        assert!(worktree_lock(data.path(), "p1", Duration::from_millis(100)).is_ok());
    }
}
