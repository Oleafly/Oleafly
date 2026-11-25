use std::fs::Metadata;
use std::path::{Path, PathBuf};

use crate::contract::{CliError, ErrorKind};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Folder {
    root: PathBuf,
    id: Option<(u64, u64)>,
}

#[cfg(unix)]
fn identity(metadata: &Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn identity(_metadata: &Metadata) -> (u64, u64) {
    (0, 0)
}

impl Folder {
    pub(crate) fn at(root: &Path) -> Folder {
        let metadata = std::fs::metadata(root).ok().filter(Metadata::is_dir);
        Folder {
            root: root.to_path_buf(),
            id: metadata.as_ref().map(identity),
        }
    }

    pub(crate) fn here(&self) -> bool {
        *self == Folder::at(&self.root)
    }

    pub(crate) fn gone(&self) -> CliError {
        CliError::new(
            ErrorKind::InvalidInput,
            "remote.folder_gone",
            format!(
                "{} was moved or deleted, so live editing stopped.",
                self.root.display()
            ),
        )
        .hint("Run oleafly remote live again in the folder's new place.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_that_was_moved_away_is_not_here_even_when_another_takes_its_place() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("paper");
        std::fs::create_dir(&root).unwrap();
        let folder = Folder::at(&root);
        std::fs::write(root.join("main.tex"), "x").unwrap();
        assert!(folder.here());
        std::fs::rename(&root, dir.path().join("moved")).unwrap();
        assert!(!folder.here());
        std::fs::create_dir(&root).unwrap();
        assert_eq!(folder.here(), cfg!(not(unix)));
        std::fs::remove_dir(&root).unwrap();
        std::fs::rename(dir.path().join("moved"), &root).unwrap();
        assert!(folder.here());
    }
}
