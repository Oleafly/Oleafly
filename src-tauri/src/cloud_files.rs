use std::path::Path;

#[cfg(not(test))]
pub(crate) fn is_placeholder(_path: &Path, metadata: &std::fs::Metadata) -> bool {
    oleafly_core::is_cloud_placeholder(metadata)
}

#[cfg(test)]
pub(crate) fn is_placeholder(path: &Path, metadata: &std::fs::Metadata) -> bool {
    oleafly_core::is_cloud_placeholder(metadata) || test_support::is_marked(path)
}

pub(crate) fn path_is_placeholder(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| is_placeholder(path, &metadata))
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, PoisonError};

    static MARKED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

    pub(crate) fn mark(path: &Path) {
        let canonical = path.canonicalize().unwrap();
        MARKED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(canonical);
    }

    pub(crate) fn is_marked(path: &Path) -> bool {
        let Ok(canonical) = path.canonicalize() else {
            return false;
        };
        MARKED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_marked_test_file_reads_as_a_placeholder_and_a_local_file_does_not() {
        let directory = tempfile::tempdir().unwrap();
        let evicted = directory.path().join("evicted.tex");
        let local = directory.path().join("local.tex");
        std::fs::write(&evicted, "x").unwrap();
        std::fs::write(&local, "x").unwrap();
        test_support::mark(&evicted);

        assert!(path_is_placeholder(&evicted));
        assert!(!path_is_placeholder(&local));
        assert!(!path_is_placeholder(&directory.path().join("missing.tex")));
    }
}
