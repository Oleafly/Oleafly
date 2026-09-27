use std::path::{Path, PathBuf};

pub(crate) fn move_to_trash(path: &Path) -> Result<(), String> {
    let owned = path.to_path_buf();
    std::thread::Builder::new()
        .name("oleafly-trash".into())
        .spawn(move || platform_trash(&owned))
        .map_err(|error| format!("could not start the trash request: {error}"))?
        .join()
        .map_err(|_| "the trash request stopped unexpectedly".to_string())?
}

pub(crate) fn system_trash(path: PathBuf) -> Result<(), String> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos as _};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path).map_err(|error| error.to_string())
}

#[cfg(not(test))]
fn platform_trash(path: &Path) -> Result<(), String> {
    system_trash(path.to_path_buf())
}

#[cfg(test)]
fn platform_trash(path: &Path) -> Result<(), String> {
    test_support::trash(path)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, PoisonError};

    static REFUSED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    static TRASHED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn canonical(path: &Path) -> PathBuf {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    }

    pub(crate) fn refuse(path: &Path) {
        REFUSED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(canonical(path));
    }

    pub(crate) fn trashed(path: &Path) -> bool {
        let absolute = path
            .parent()
            .map(canonical)
            .zip(path.file_name())
            .map_or_else(|| path.to_path_buf(), |(parent, name)| parent.join(name));
        TRASHED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&absolute)
    }

    pub(super) fn trash(path: &Path) -> Result<(), String> {
        let original = canonical(path);
        if REFUSED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&original)
        {
            return Err("this volume has no trash".into());
        }
        let bin = std::env::temp_dir().join(format!("oleafly-test-trash-{}", std::process::id()));
        std::fs::create_dir_all(&bin).map_err(|error| error.to_string())?;
        let target = bin.join(NEXT.fetch_add(1, Ordering::Relaxed).to_string());
        std::fs::rename(&original, target).map_err(|error| error.to_string())?;
        TRASHED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(original);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trashed_item_leaves_its_folder_and_a_refused_one_stays() {
        let directory = tempfile::tempdir().unwrap();
        let kept = directory.path().join("kept.tex");
        let gone = directory.path().join("gone.tex");
        std::fs::write(&kept, "kept").unwrap();
        std::fs::write(&gone, "gone").unwrap();
        test_support::refuse(&kept);

        move_to_trash(&gone).unwrap();
        assert!(move_to_trash(&kept).is_err());

        assert!(!gone.exists());
        assert!(test_support::trashed(&gone));
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "kept");
        assert!(!test_support::trashed(&kept));
    }

    #[test]
    #[ignore = "moves a file into this machine's real trash"]
    fn the_system_trash_accepts_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let probe = directory.path().join("oleafly-trash-probe.txt");
        std::fs::write(&probe, "probe").unwrap();
        system_trash(probe.clone()).unwrap();
        assert!(!probe.exists());
    }
}
