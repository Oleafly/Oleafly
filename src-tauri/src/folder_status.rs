use crate::project_location::ProjectKind;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncService {
    IcloudDrive,
    OneDrive,
    Dropbox,
    GoogleDrive,
    Box,
    CloudStorage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FolderStatus {
    pub read_only: bool,
    pub synced_with: Option<SyncService>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SyncRoots {
    roots: Vec<(PathBuf, SyncService)>,
    cloud_storage: Option<PathBuf>,
}

impl SyncRoots {
    pub(crate) fn current() -> Self {
        let mut roots = Self::default();
        if let Ok(home) = crate::paths::home_dir() {
            roots.add_home_roots(&home);
        }
        roots.add_platform_roots();
        roots
    }

    #[cfg(target_os = "macos")]
    fn add_home_roots(&mut self, home: &Path) {
        let mobile = home.join("Library/Mobile Documents");
        let drive = mobile.join("com~apple~CloudDocs");
        for name in ["Desktop", "Documents"] {
            let local = home.join(name);
            if same_directory(&local, &drive.join(name)) {
                self.roots.push((local, SyncService::IcloudDrive));
            }
        }
        self.roots.push((mobile, SyncService::IcloudDrive));
        self.roots
            .push((home.join("Dropbox"), SyncService::Dropbox));
        self.cloud_storage = Some(home.join("Library/CloudStorage"));
    }

    #[cfg(windows)]
    fn add_home_roots(&mut self, home: &Path) {
        self.roots
            .push((home.join("iCloudDrive"), SyncService::IcloudDrive));
        self.roots
            .push((home.join("Dropbox"), SyncService::Dropbox));
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    fn add_home_roots(&mut self, home: &Path) {
        self.roots
            .push((home.join("Dropbox"), SyncService::Dropbox));
    }

    #[cfg(windows)]
    fn add_platform_roots(&mut self) {
        for name in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
            if let Some(root) = std::env::var_os(name).filter(|value| !value.is_empty()) {
                self.roots
                    .push((PathBuf::from(root), SyncService::OneDrive));
            }
        }
    }

    #[cfg(not(windows))]
    fn add_platform_roots(&mut self) {}

    pub(crate) fn service_of(&self, path: &Path) -> Option<SyncService> {
        let path = resolved(path);
        if let Some(entry) = self
            .cloud_storage
            .as_deref()
            .and_then(|parent| path.strip_prefix(resolved(parent)).ok())
            .and_then(|rest| rest.components().next())
        {
            return Some(cloud_storage_service(&entry.as_os_str().to_string_lossy()));
        }
        self.roots
            .iter()
            .map(|(root, service)| (resolved(root), *service))
            .filter(|(root, _)| path.starts_with(root))
            .max_by_key(|(root, _)| root.components().count())
            .map(|(_, service)| service)
    }
}

fn resolved(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(target_os = "macos")]
fn same_directory(left: &Path, right: &Path) -> bool {
    use std::os::unix::fs::MetadataExt as _;
    match (std::fs::metadata(left), std::fs::metadata(right)) {
        (Ok(left), Ok(right)) => {
            left.is_dir() && left.dev() == right.dev() && left.ino() == right.ino()
        }
        _ => false,
    }
}

fn cloud_storage_service(entry: &str) -> SyncService {
    let entry = entry.to_ascii_lowercase();
    [
        ("onedrive", SyncService::OneDrive),
        ("dropbox", SyncService::Dropbox),
        ("googledrive", SyncService::GoogleDrive),
        ("box", SyncService::Box),
        ("icloud", SyncService::IcloudDrive),
    ]
    .into_iter()
    .find(|(prefix, _)| entry.starts_with(prefix))
    .map_or(SyncService::CloudStorage, |(_, service)| service)
}

#[cfg(unix)]
pub(crate) fn folder_is_read_only(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;
    if !path.is_dir() {
        return false;
    }
    let Ok(text) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    if unsafe { libc::access(text.as_ptr(), libc::W_OK) } == 0 {
        return false;
    }
    matches!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::EACCES | libc::EROFS | libc::EPERM)
    )
}

#[cfg(windows)]
pub(crate) fn folder_is_read_only(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_WRITE_PROTECT};
    use windows_sys::Win32::Storage::FileSystem::{
        GetVolumeInformationByHandleW, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS,
    };
    const FILE_READ_ONLY_VOLUME: u32 = 0x0008_0000;
    if !path.is_dir() {
        return false;
    }
    let directory = match std::fs::OpenOptions::new()
        .access_mode(FILE_ADD_FILE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
    {
        Ok(directory) => directory,
        Err(error) => {
            return error.raw_os_error().is_some_and(|code| {
                u32::try_from(code)
                    .is_ok_and(|code| code == ERROR_ACCESS_DENIED || code == ERROR_WRITE_PROTECT)
            });
        }
    };
    let mut flags = 0u32;
    let read = unsafe {
        GetVolumeInformationByHandleW(
            directory.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut flags,
            std::ptr::null_mut(),
            0,
        )
    };
    read != 0 && flags & FILE_READ_ONLY_VOLUME != 0
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn folder_is_read_only(_path: &Path) -> bool {
    false
}

fn linked_root(project_id: &str) -> Result<Option<PathBuf>, String> {
    let location = crate::project_location::locate(project_id)?;
    Ok((location.kind == ProjectKind::Linked).then_some(location.root))
}

fn folder_status(project_id: &str) -> Result<Option<FolderStatus>, String> {
    Ok(linked_root(project_id)?.map(|root| FolderStatus {
        read_only: folder_is_read_only(&root),
        synced_with: SyncRoots::current().service_of(&root),
    }))
}

#[tauri::command]
pub async fn project_folder_status(project_id: String) -> Result<Option<FolderStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || folder_status(&project_id))
        .await
        .map_err(|error| format!("folder status task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trust::testing::LinkedFixture;

    fn roots(home: &str) -> SyncRoots {
        let home = PathBuf::from(home);
        SyncRoots {
            roots: vec![
                (
                    home.join("Library/Mobile Documents"),
                    SyncService::IcloudDrive,
                ),
                (home.join("Dropbox"), SyncService::Dropbox),
                (home.join("Desktop"), SyncService::IcloudDrive),
            ],
            cloud_storage: Some(home.join("Library/CloudStorage")),
        }
    }

    #[test]
    fn folders_inside_a_sync_root_name_its_service() {
        let roots = roots("/Users/ada");
        assert_eq!(
            roots.service_of(Path::new(
                "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/thesis"
            )),
            Some(SyncService::IcloudDrive)
        );
        assert_eq!(
            roots.service_of(Path::new("/Users/ada/Dropbox/papers/survey")),
            Some(SyncService::Dropbox)
        );
        assert_eq!(
            roots.service_of(Path::new("/Users/ada/Desktop/thesis")),
            Some(SyncService::IcloudDrive)
        );
        assert_eq!(
            roots.service_of(Path::new("/Users/ada/Projects/thesis")),
            None
        );
        assert_eq!(
            roots.service_of(Path::new("/Users/ada/Dropboxes/thesis")),
            None
        );
    }

    #[test]
    fn cloud_storage_providers_are_named_by_their_folder() {
        let roots = roots("/Users/ada");
        let service = |entry: &str| {
            roots.service_of(&Path::new("/Users/ada/Library/CloudStorage").join(entry))
        };
        assert_eq!(
            service("OneDrive-Personal/thesis"),
            Some(SyncService::OneDrive)
        );
        assert_eq!(
            service("OneDrive-SharedLibraries-Lab/paper"),
            Some(SyncService::OneDrive)
        );
        assert_eq!(service("Dropbox/paper"), Some(SyncService::Dropbox));
        assert_eq!(
            service("GoogleDrive-ada@example.org/My Drive/paper"),
            Some(SyncService::GoogleDrive)
        );
        assert_eq!(service("Box-Box/paper"), Some(SyncService::Box));
        assert_eq!(
            service("pCloudDrive/paper"),
            Some(SyncService::CloudStorage)
        );
        assert_eq!(
            roots.service_of(Path::new("/Users/ada/Library/CloudStorage")),
            None
        );
    }

    #[test]
    fn the_status_serialises_the_way_the_editor_reads_it() {
        let status = FolderStatus {
            read_only: true,
            synced_with: Some(SyncService::IcloudDrive),
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({ "read_only": true, "synced_with": "icloud_drive" })
        );
        let none = FolderStatus {
            read_only: false,
            synced_with: None,
        };
        assert_eq!(
            serde_json::to_value(&none).unwrap(),
            serde_json::json!({ "read_only": false, "synced_with": null })
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_the_user_cannot_write_is_read_only() {
        use std::os::unix::fs::PermissionsExt as _;
        let folder = tempfile::tempdir().unwrap();
        assert!(!folder_is_read_only(folder.path()));
        std::fs::set_permissions(folder.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let locked = folder_is_read_only(folder.path());
        std::fs::set_permissions(folder.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        if unsafe { libc::geteuid() } != 0 {
            assert!(locked);
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_whose_permissions_deny_new_files_is_read_only() {
        let folder = tempfile::tempdir().unwrap();
        assert!(!folder_is_read_only(folder.path()));
        let icacls = |arguments: &[&str]| {
            std::process::Command::new("icacls")
                .arg(folder.path())
                .args(arguments)
                .status()
                .is_ok_and(|status| status.success())
        };
        assert!(icacls(&["/deny", "*S-1-1-0:(WD)"]));
        let locked = folder_is_read_only(folder.path());
        assert!(icacls(&["/remove:d", "*S-1-1-0"]));
        assert!(locked);
        assert!(!folder_is_read_only(folder.path()));
    }

    #[test]
    fn a_missing_folder_is_not_reported_as_read_only() {
        let folder = tempfile::tempdir().unwrap();
        assert!(!folder_is_read_only(&folder.path().join("gone")));
    }

    #[test]
    fn only_linked_projects_report_a_folder_status() {
        let fixture = LinkedFixture::new();
        let (id, _) = fixture.link("thesis");
        let status = folder_status(&id).unwrap().expect("linked status");
        assert!(!status.read_only);
        assert_eq!(status.synced_with, None);
        let library = crate::paths::oleafly_root()
            .unwrap()
            .join("projects")
            .join("paper-1");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(
            library.join("project.json"),
            r#"{"name":"Paper","main_doc":"main.tex"}"#,
        )
        .unwrap();
        assert_eq!(folder_status("paper-1").unwrap(), None);
    }
}
