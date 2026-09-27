use std::path::{Component, Path, PathBuf};

const BROAD_HOME_FOLDERS: &[&str] = &[
    "applications",
    "desktop",
    "documents",
    "downloads",
    "dropbox",
    "google drive",
    "icloud drive",
    "library",
    "movies",
    "music",
    "pictures",
    "public",
    "videos",
];
const CLOUD_ROOT_PARENTS: &[&str] = &["Library/CloudStorage", "Library/Mobile Documents"];
const SHARED_ROOTS: &[&str] = &[
    "/tmp",
    "/var/tmp",
    "/private/tmp",
    "/private/var/tmp",
    "/Users/Shared",
    "/dev/shm",
];
const TOP_LEVEL_CONTAINERS: &[&str] = &[
    "/Users", "/Volumes", "/Network", "/private", "/home", "/mnt", "/media", "/opt", "/srv",
    "/var", "/run", "/root", "/usr",
];
const MOUNT_PARENTS: &[&str] = &["/Volumes", "/mnt", "/media"];
const USER_MEDIA_ROOT: &str = "/media";
const PER_USER_MOUNT_ROOT: &str = "/run/media";
#[cfg(target_os = "macos")]
const SYSTEM_FOLDERS: &[&str] = &[
    "/System",
    "/Library",
    "/Applications",
    "/bin",
    "/sbin",
    "/usr",
    "/private/etc",
    "/dev",
    "/cores",
];
#[cfg(target_os = "linux")]
const SYSTEM_FOLDERS: &[&str] = &[
    "/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/proc", "/sbin",
    "/snap", "/sys", "/usr",
];
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
const SYSTEM_FOLDERS: &[&str] = &[];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FolderScope {
    Narrow,
    Broad,
    AppData,
    Protected(PathBuf),
}

#[derive(Clone, Debug, Default)]
pub(crate) struct KnownFolders {
    pub(crate) home: Option<PathBuf>,
    pub(crate) enclosing: Vec<PathBuf>,
    pub(crate) app_data: Vec<PathBuf>,
    pub(crate) protected: Vec<PathBuf>,
    pub(crate) exact: Vec<PathBuf>,
    pub(crate) cloud_parents: Vec<PathBuf>,
}

impl KnownFolders {
    pub(crate) fn current() -> Self {
        let home = crate::paths::home_dir().ok().map(resolved);
        let mut enclosing = vec![resolved(std::env::temp_dir())];
        enclosing.extend(home.clone());
        enclosing.extend(std::env::var_os("PUBLIC").map(PathBuf::from).map(resolved));
        let app_data = crate::paths::app_data_roots().unwrap_or_else(|_| {
            crate::paths::oleafly_root()
                .map(resolved)
                .into_iter()
                .collect()
        });
        let mut known = Self {
            home,
            enclosing,
            app_data,
            protected: SYSTEM_FOLDERS
                .iter()
                .map(|folder| resolved(PathBuf::from(folder)))
                .chain(app_bundle())
                .collect(),
            exact: [
                dirs::desktop_dir(),
                dirs::document_dir(),
                dirs::download_dir(),
                dirs::picture_dir(),
                dirs::audio_dir(),
                dirs::video_dir(),
                dirs::public_dir(),
                dirs::template_dir(),
            ]
            .into_iter()
            .flatten()
            .map(resolved)
            .collect(),
            cloud_parents: Vec::new(),
        };
        add_platform_folders(&mut known);
        known
    }
}

#[cfg(target_os = "macos")]
fn add_platform_folders(known: &mut KnownFolders) {
    if let Some(home) = known.home.clone() {
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        known
            .exact
            .extend([icloud.join("Desktop"), icloud.join("Documents")].map(resolved));
    }
}

#[cfg(target_os = "linux")]
fn add_platform_folders(known: &mut KnownFolders) {
    let user = unsafe { libc::getuid() };
    known
        .cloud_parents
        .push(resolved(PathBuf::from(format!("/run/user/{user}/gvfs"))));
}

#[cfg(windows)]
fn add_platform_folders(known: &mut KnownFolders) {
    let from_environment = |names: &[&str]| -> Vec<PathBuf> {
        names
            .iter()
            .filter_map(std::env::var_os)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .map(resolved)
            .collect()
    };
    known.protected.extend(from_environment(&[
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "ProgramData",
    ]));
    known.exact.extend(from_environment(&[
        "APPDATA",
        "OneDrive",
        "OneDriveConsumer",
        "OneDriveCommercial",
    ]));
    known.exact.extend(
        std::env::var_os("SystemDrive")
            .filter(|drive| !drive.is_empty())
            .map(|mut drive| {
                drive.push(r"\Users");
                resolved(PathBuf::from(drive))
            }),
    );
    known.protected.extend(
        std::env::var_os("SystemDrive")
            .filter(|drive| !drive.is_empty())
            .into_iter()
            .flat_map(|mut drive| {
                drive.push(r"\");
                let root = resolved(PathBuf::from(drive));
                WINDOWS_DRIVE_SYSTEM_FOLDERS
                    .iter()
                    .map(move |name| root.join(name))
            }),
    );
}

#[cfg(windows)]
const WINDOWS_DRIVE_SYSTEM_FOLDERS: &[&str] = &[
    "$Recycle.Bin",
    "System Volume Information",
    "Recovery",
    "PerfLogs",
];

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn add_platform_folders(_known: &mut KnownFolders) {}

fn app_bundle() -> Option<PathBuf> {
    let executable = resolved(std::env::current_exe().ok()?);
    if let Some(appdir) = std::env::var_os("APPDIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(resolved)
    {
        if executable.starts_with(&appdir) {
            return Some(appdir);
        }
    }
    executable
        .ancestors()
        .find(|ancestor| {
            ancestor
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        })
        .or_else(|| executable.parent())
        .map(Path::to_path_buf)
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn covers_cloud_parent(path: &Path, cloud: &Path) -> bool {
    cloud.starts_with(path) || path.parent() == Some(cloud)
}

pub(crate) fn broad_folder_among(path: &Path, home: Option<&Path>, protected: &[&Path]) -> bool {
    let depth = path
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();
    if depth == 0
        || TOP_LEVEL_CONTAINERS
            .iter()
            .any(|container| path == Path::new(container))
        || protected.iter().any(|base| base.starts_with(path))
    {
        return true;
    }
    if let Some(home) = home {
        if path.parent() == Some(home) {
            let name = folder_name(path).to_lowercase();
            if BROAD_HOME_FOLDERS.contains(&name.as_str()) || name.starts_with("onedrive") {
                return true;
            }
        }
        if CLOUD_ROOT_PARENTS
            .iter()
            .any(|parent| covers_cloud_parent(path, &home.join(parent)))
        {
            return true;
        }
    }
    if SHARED_ROOTS
        .iter()
        .any(|shared| Path::new(shared).starts_with(path))
    {
        return true;
    }
    let parent = path.parent();
    let grandparent = parent.and_then(Path::parent);
    let per_user = Some(Path::new(PER_USER_MOUNT_ROOT));
    let user_media = home
        .and_then(Path::file_name)
        .map(|user| Path::new(USER_MEDIA_ROOT).join(user));
    parent.is_some_and(|parent| MOUNT_PARENTS.iter().any(|mount| parent == Path::new(mount)))
        || [Some(path), parent, grandparent].contains(&per_user)
        || user_media.is_some_and(|media| parent == Some(media.as_path()))
}

pub(crate) fn classify(path: &Path, known: &KnownFolders) -> FolderScope {
    if known.app_data.iter().any(|root| path.starts_with(root)) {
        return FolderScope::AppData;
    }
    if let Some(root) = known.protected.iter().find(|root| path.starts_with(root)) {
        return FolderScope::Protected(root.clone());
    }
    let bases: Vec<&Path> = known
        .enclosing
        .iter()
        .chain(&known.app_data)
        .map(PathBuf::as_path)
        .collect();
    let broad = known.exact.iter().any(|folder| folder == path)
        || known
            .cloud_parents
            .iter()
            .any(|cloud| covers_cloud_parent(path, cloud))
        || broad_folder_among(path, known.home.as_deref(), &bases);
    if broad {
        FolderScope::Broad
    } else {
        FolderScope::Narrow
    }
}

pub(crate) fn scope_of(path: &Path, known: &KnownFolders) -> FolderScope {
    match classify(path, known) {
        FolderScope::Narrow if is_volume_root(path) => FolderScope::Broad,
        scope => scope,
    }
}

fn is_volume_root(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return true;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        match (std::fs::metadata(path), std::fs::metadata(parent)) {
            (Ok(folder), Ok(parent)) => folder.dev() != parent.dev(),
            _ => false,
        }
    }
    #[cfg(windows)]
    {
        match (
            crate::fs_identity::identify_directory(path),
            crate::fs_identity::identify_directory(parent),
        ) {
            (Ok(folder), Ok(parent)) => folder.identity.volume != parent.identity.volume,
            _ => false,
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = parent;
        false
    }
}

fn resolved(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

pub(crate) fn is_broad_folder(path: &Path) -> bool {
    scope_of(&resolved(path.to_path_buf()), &KnownFolders::current()) != FolderScope::Narrow
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ada() -> KnownFolders {
        let home = PathBuf::from("/Users/ada");
        KnownFolders {
            home: Some(home.clone()),
            enclosing: vec![home.clone(), PathBuf::from("/private/var/folders/xy/T")],
            app_data: vec![home.join(".oleafly")],
            protected: vec![
                PathBuf::from("/System"),
                PathBuf::from("/Applications/Oleafly.app"),
            ],
            exact: vec![
                home.join("OneDrive/Desktop"),
                home.join("Library/Mobile Documents/com~apple~CloudDocs/Documents"),
            ],
            cloud_parents: vec![PathBuf::from("/run/user/1000/gvfs")],
        }
    }

    fn scope(path: &str) -> FolderScope {
        classify(Path::new(path), &ada())
    }

    #[test]
    fn app_data_is_refused_with_its_contents_and_its_ancestors_are_broad() {
        for inside in [
            "/Users/ada/.oleafly",
            "/Users/ada/.oleafly/checkpoints/alpha",
            "/Users/ada/.oleafly/linked/linked-0/build",
            "/Users/ada/.oleafly/projects",
        ] {
            assert_eq!(scope(inside), FolderScope::AppData, "{inside}");
        }
        let mut known = ada();
        known.app_data = vec![PathBuf::from("/srv/shared/oleafly-data")];
        assert_eq!(
            classify(Path::new("/srv/shared"), &known),
            FolderScope::Broad
        );
        assert_eq!(
            classify(Path::new("/srv/shared/papers"), &known),
            FolderScope::Narrow
        );
    }

    #[test]
    fn system_folders_and_the_app_are_protected_with_their_contents() {
        let system = FolderScope::Protected(PathBuf::from("/System"));
        assert_eq!(scope("/System"), system);
        assert_eq!(scope("/System/Library/Fonts"), system);
        assert_eq!(
            scope("/Applications/Oleafly.app/Contents/Resources"),
            FolderScope::Protected(PathBuf::from("/Applications/Oleafly.app"))
        );
    }

    #[test]
    fn redirected_user_folders_and_synced_folders_are_broad_but_their_subfolders_open() {
        for broad in [
            "/Users/ada/OneDrive/Desktop",
            "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Documents",
        ] {
            assert_eq!(scope(broad), FolderScope::Broad, "{broad}");
        }
        for narrow in [
            "/Users/ada/OneDrive/Desktop/thesis",
            "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Documents/thesis",
        ] {
            assert_eq!(scope(narrow), FolderScope::Narrow, "{narrow}");
        }
    }

    #[test]
    fn network_share_parents_and_each_share_are_broad() {
        for broad in [
            "/run/user",
            "/run/user/1000",
            "/run/user/1000/gvfs",
            "/run/user/1000/gvfs/smb-share:server=lab,share=papers",
        ] {
            assert_eq!(scope(broad), FolderScope::Broad, "{broad}");
        }
        assert_eq!(
            scope("/run/user/1000/gvfs/smb-share:server=lab,share=papers/thesis"),
            FolderScope::Narrow
        );
    }

    #[test]
    fn removable_media_parents_and_per_user_media_folders_are_broad() {
        for broad in [
            "/run/media",
            "/run/media/ada",
            "/run/media/ada/USB",
            "/media/ada",
        ] {
            assert_eq!(scope(broad), FolderScope::Broad, "{broad}");
        }
        for narrow in ["/run/media/ada/USB/papers", "/media/ada/USB/papers"] {
            assert_eq!(scope(narrow), FolderScope::Narrow, "{narrow}");
        }
    }

    #[test]
    fn a_folder_directly_under_a_root_opens_but_top_level_containers_are_broad() {
        for broad in [
            "/", "/Users", "/Volumes", "/Network", "/private", "/home", "/mnt", "/media", "/opt",
            "/srv", "/var", "/run", "/root", "/usr",
        ] {
            assert_eq!(scope(broad), FolderScope::Broad, "{broad}");
        }
        for narrow in ["/work", "/Thesis", "/opt/thesis", "/home/ada/thesis"] {
            assert_eq!(scope(narrow), FolderScope::Narrow, "{narrow}");
        }
    }

    #[test]
    fn only_the_users_own_media_folder_holds_mounts_one_level_down() {
        for broad in ["/media/usb0", "/media/ada/USB", "/run/media/bob/USB"] {
            assert_eq!(scope(broad), FolderScope::Broad, "{broad}");
        }
        for narrow in ["/media/usb0/thesis", "/media/usb/thesis", "/media/bob/USB"] {
            assert_eq!(scope(narrow), FolderScope::Narrow, "{narrow}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_directly_under_a_drive_or_share_opens_but_the_roots_do_not() {
        let known = KnownFolders::default();
        for broad in [r"D:\", r"Z:\", r"\\server\share", r"\\server\share\"] {
            assert_eq!(
                classify(Path::new(broad), &known),
                FolderScope::Broad,
                "{broad}"
            );
        }
        for narrow in [
            r"D:\Thesis",
            r"Z:\Thesis",
            r"\\server\share\Thesis",
            r"\\?\D:\Thesis",
            r"\\?\UNC\server\share\Thesis",
        ] {
            assert_eq!(
                classify(Path::new(narrow), &known),
                FolderScope::Narrow,
                "{narrow}"
            );
        }
    }

    #[test]
    fn the_current_folders_cover_home_temp_app_data_the_app_and_the_system() {
        let _env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let known = KnownFolders::current();
        match previous {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        let temp = std::env::temp_dir().canonicalize().unwrap();
        let home = crate::paths::home_dir().unwrap().canonicalize().unwrap();
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        assert!(known.enclosing.contains(&temp));
        assert!(known.enclosing.contains(&home));
        assert_eq!(known.home, Some(home));
        assert!(known
            .app_data
            .contains(&data.path().canonicalize().unwrap()));
        assert!(known
            .protected
            .iter()
            .any(|folder| executable.starts_with(folder)));
        #[cfg(unix)]
        assert!(known.protected.contains(&PathBuf::from("/usr")));
        #[cfg(windows)]
        assert!(known.protected.contains(
            &PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                .canonicalize()
                .unwrap()
        ));
        #[cfg(windows)]
        {
            let drive = format!(r"{}\", std::env::var("SystemDrive").unwrap());
            let root = PathBuf::from(&drive)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&drive));
            for name in [
                "$Recycle.Bin",
                "System Volume Information",
                "Recovery",
                "PerfLogs",
            ] {
                assert!(known.protected.contains(&root.join(name)));
            }
        }
        #[cfg(windows)]
        {
            let users = PathBuf::from(format!(r"{}\Users", std::env::var("SystemDrive").unwrap()));
            let users = users.canonicalize().unwrap_or(users);
            assert!(known.exact.contains(&users));
            assert_eq!(classify(&users, &known), FolderScope::Broad);
        }
    }

    #[test]
    fn a_plain_folder_is_narrow_and_the_filesystem_root_is_a_volume_root() {
        let folder = tempfile::tempdir().unwrap();
        let paper = folder.path().canonicalize().unwrap().join("paper");
        std::fs::create_dir(&paper).unwrap();
        assert_eq!(
            scope_of(&paper, &KnownFolders::default()),
            FolderScope::Narrow
        );
        assert!(!is_volume_root(&paper));
        #[cfg(unix)]
        assert!(is_volume_root(Path::new("/")));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_folder_where_another_volume_is_mounted_is_broad() {
        #[cfg(target_os = "macos")]
        let mount = Path::new("/System/Volumes/VM");
        #[cfg(target_os = "linux")]
        let mount = Path::new("/dev/pts");
        if !mount.is_dir() {
            eprintln!("skipping: {mount:?} is not mounted here");
            return;
        }
        assert_eq!(
            classify(mount, &KnownFolders::default()),
            FolderScope::Narrow
        );
        assert_eq!(
            scope_of(mount, &KnownFolders::default()),
            FolderScope::Broad
        );
    }
}
