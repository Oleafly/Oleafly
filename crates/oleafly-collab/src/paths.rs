use crate::error::CollabError;
use ring::rand::{SecureRandom, SystemRandom};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CollabPaths {
    root: PathBuf,
}

impl CollabPaths {
    pub fn new(root: PathBuf) -> Self {
        CollabPaths { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn servers_file(&self) -> PathBuf {
        self.root.join("servers.json")
    }

    pub fn project_dir(&self, local_project_id: &str) -> Result<PathBuf, CollabError> {
        validate_local_id(local_project_id)?;
        Ok(self.root.join(local_project_id))
    }

    pub fn binding_file(&self, id: &str) -> Result<PathBuf, CollabError> {
        Ok(self.project_dir(id)?.join("binding.json"))
    }

    pub fn file_ids_file(&self, id: &str) -> Result<PathBuf, CollabError> {
        Ok(self.project_dir(id)?.join("file-ids.json"))
    }

    pub fn materializer_index_file(&self, id: &str) -> Result<PathBuf, CollabError> {
        Ok(self.project_dir(id)?.join("materializer-index.json"))
    }

    pub fn document_dir(&self, id: &str) -> Result<PathBuf, CollabError> {
        Ok(self.project_dir(id)?.join("document"))
    }

    pub fn outbox_dir(&self, id: &str) -> Result<PathBuf, CollabError> {
        Ok(self.project_dir(id)?.join("outbox"))
    }
}

fn validate_local_id(id: &str) -> Result<(), CollabError> {
    let safe = !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if safe {
        Ok(())
    } else {
        Err(CollabError::InvalidPath(format!(
            "illegal project id: {id:?}"
        )))
    }
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), CollabError> {
    write_atomic_with(path, bytes, sync_directory)
}

fn write_atomic_with(
    path: &Path,
    bytes: &[u8],
    sync_parent: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), CollabError> {
    let (parent, name) = match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => (parent, name),
        _ => {
            return Err(CollabError::InvalidPath(format!(
                "{} has no parent directory",
                path.display()
            )))
        }
    };
    std::fs::create_dir_all(parent).map_err(|error| {
        CollabError::Io(format!("failed to create {}: {error}", parent.display()))
    })?;
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(CollabError::InvalidPath(format!(
                "{} is not a regular file",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CollabError::Io(format!(
                "failed to inspect {}: {error}",
                path.display()
            )))
        }
    }
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        temp_suffix()?
    ));
    if let Err(error) = write_temp(&temp, bytes).and_then(|()| replace(&temp, path)) {
        let _ = std::fs::remove_file(&temp);
        return Err(CollabError::Io(format!(
            "failed to write {}: {error}",
            path.display()
        )));
    }
    sync_parent(parent)
        .map_err(|error| CollabError::Io(format!("failed to sync {}: {error}", parent.display())))
}

fn temp_suffix() -> Result<String, CollabError> {
    let mut bytes = [0u8; 8];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| CollabError::Crypto("failed to pick a temporary file name".to_string()))?;
    let random: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("{}.{random}", std::process::id()))
}

fn write_temp(temp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(temp)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(windows))]
fn replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut delay = std::time::Duration::from_millis(10);
    loop {
        match std::fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if matches!(error.raw_os_error(), Some(5 | 32 | 33 | 1224))
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(delay);
                delay = (delay * 2).min(std::time::Duration::from_millis(250));
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}

#[cfg(windows)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt as _;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?
        .sync_all()
}

#[cfg(not(any(unix, windows)))]
fn sync_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layout_matches_the_contract() {
        let root = PathBuf::from("/data/collab");
        let paths = CollabPaths::new(root.clone());
        let project = root.join("paper");
        assert_eq!(paths.root(), root.as_path());
        assert_eq!(paths.servers_file(), root.join("servers.json"));
        assert_eq!(paths.project_dir("paper").unwrap(), project);
        assert_eq!(
            paths.binding_file("paper").unwrap(),
            project.join("binding.json")
        );
        assert_eq!(
            paths.file_ids_file("paper").unwrap(),
            project.join("file-ids.json")
        );
        assert_eq!(
            paths.materializer_index_file("paper").unwrap(),
            project.join("materializer-index.json")
        );
        assert_eq!(
            paths.document_dir("paper").unwrap(),
            project.join("document")
        );
        assert_eq!(paths.outbox_dir("paper").unwrap(), project.join("outbox"));
    }

    #[test]
    fn project_ids_must_be_one_safe_segment() {
        let paths = CollabPaths::new(PathBuf::from("/data/collab"));
        for id in ["paper", "project-0123abcd", "linked-ab_12", "A-z_9"] {
            assert!(paths.project_dir(id).is_ok(), "{id}");
        }
        for id in [
            "", ".", "..", "../x", "a/b", "a\\b", "/etc", "C:", "a.b", "a b", "naïve",
        ] {
            assert!(
                matches!(paths.project_dir(id), Err(CollabError::InvalidPath(_))),
                "{id}"
            );
            assert!(paths.binding_file(id).is_err(), "{id}");
            assert!(paths.file_ids_file(id).is_err(), "{id}");
            assert!(paths.materializer_index_file(id).is_err(), "{id}");
            assert!(paths.document_dir(id).is_err(), "{id}");
            assert!(paths.outbox_dir(id).is_err(), "{id}");
        }
    }

    #[test]
    fn write_atomic_creates_the_parent_and_replaces_content_without_leftovers() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("paper").join("binding.json");
        write_atomic(&target, b"first").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"first");
        write_atomic(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        let names: Vec<String> = std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["binding.json"]);
    }

    #[test]
    fn a_failed_parent_sync_is_reported_after_the_new_content_is_in_place() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("file-ids.json");
        std::fs::write(&target, b"old").unwrap();
        let mut synced = None;
        let error = write_atomic_with(&target, b"new", |parent| {
            synced = Some(parent.to_path_buf());
            Err(std::io::Error::other("injected directory sync failure"))
        })
        .unwrap_err();
        assert_eq!(synced.as_deref(), Some(directory.path()));
        assert!(
            matches!(&error, CollabError::Io(message) if message.contains("injected directory sync failure")),
            "{error:?}"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn write_atomic_refuses_directories_and_symbolic_links() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("document");
        std::fs::create_dir(&folder).unwrap();
        assert!(matches!(
            write_atomic(&folder, b"x"),
            Err(CollabError::InvalidPath(_))
        ));
        assert!(folder.is_dir());
        #[cfg(unix)]
        {
            let real = directory.path().join("real.json");
            std::fs::write(&real, b"untouched").unwrap();
            let link = directory.path().join("binding.json");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert!(matches!(
                write_atomic(&link, b"x"),
                Err(CollabError::InvalidPath(_))
            ));
            assert_eq!(std::fs::read(&real).unwrap(), b"untouched");
        }
    }

    #[cfg(unix)]
    #[test]
    fn written_files_are_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("binding.json");
        write_atomic(&target, b"{}").unwrap();
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
