use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const RESERVE_TRIES: usize = 8;

pub(crate) struct StagedFile(PathBuf);

impl StagedFile {
    pub(crate) fn in_dir(parent: &Path, prefix: &str) -> Result<StagedFile, String> {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        for _ in 0..RESERVE_TRIES {
            let candidate = crate::project::unique_temporary_path(parent, prefix)?;
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(_) => return Ok(StagedFile(candidate)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("could not stage a download: {error}")),
            }
        }
        Err("could not stage a download".into())
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        match std::fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Could not remove the staged download {}: {error}",
                    self.0.display()
                ));
            }
        }
    }
}

pub(crate) fn sweep_stale(dir: &Path, prefixes: &[&str], older_than: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !prefixes.iter().any(|prefix| name.starts_with(prefix)) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > older_than);
        if !stale {
            continue;
        }
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(error) = removed {
            let _ = crate::project::append_app_log(format!(
                "Could not remove the leftover {}: {error}",
                path.display()
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_files_get_their_own_names_and_go_away_when_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let first = StagedFile::in_dir(&dir.path().join("root"), ".download").unwrap();
        let second = StagedFile::in_dir(&dir.path().join("root"), ".download").unwrap();
        assert_ne!(first.path(), second.path());
        assert!(first.path().is_file() && second.path().is_file());
        assert!(first
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".download-"));
        let (one, two) = (first.path().to_path_buf(), second.path().to_path_buf());
        std::fs::write(&one, b"PK").unwrap();
        drop(first);
        drop(second);
        assert!(!one.exists() && !two.exists());
    }

    #[test]
    fn only_old_leftovers_with_a_known_prefix_are_swept() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join(".import-old");
        let fresh = dir.path().join(".import-fresh");
        let other = dir.path().join("thesis");
        for file in [&old, &fresh, &other] {
            std::fs::write(file, b"zip").unwrap();
        }
        let long_ago = SystemTime::now() - Duration::from_secs(7200);
        for path in [&old, &other] {
            std::fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(long_ago)
                .unwrap();
        }
        sweep_stale(dir.path(), &[".import-"], Duration::from_secs(3600));
        assert!(!old.exists());
        assert!(fresh.exists());
        assert!(other.exists());
    }
}
