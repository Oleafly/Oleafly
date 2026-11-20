use std::path::{Path, PathBuf};

const IN_USE_CODES: [u32; 6] = [32, 33, 0x8007_0020, 0x8007_0021, 0x8027_0027, 0x8027_0028];

#[derive(Debug)]
pub(crate) struct TrashFailure {
    pub(crate) in_use: bool,
    detail: String,
}

impl TrashFailure {
    fn other(detail: impl ToString) -> Self {
        Self {
            in_use: false,
            detail: detail.to_string(),
        }
    }
}

impl std::fmt::Display for TrashFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.detail)
    }
}

fn in_use_code(code: i32) -> bool {
    IN_USE_CODES.contains(&(code as u32))
}

fn failure_of(error: trash::Error) -> TrashFailure {
    let in_use =
        cfg!(windows) && matches!(&error, trash::Error::Os { code, .. } if in_use_code(*code));
    TrashFailure {
        in_use,
        detail: error.to_string(),
    }
}

pub(crate) fn move_to_trash(path: &Path) -> Result<(), TrashFailure> {
    let owned = path.to_path_buf();
    std::thread::Builder::new()
        .name("oleafly-trash".into())
        .spawn(move || platform_trash(&owned))
        .map_err(|error| {
            TrashFailure::other(format!("could not start the trash request: {error}"))
        })?
        .join()
        .map_err(|_| TrashFailure::other("the trash request stopped unexpectedly"))?
}

pub(crate) fn system_trash(path: PathBuf) -> Result<(), TrashFailure> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos as _};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path).map_err(failure_of)
}

#[cfg(not(test))]
fn platform_trash(path: &Path) -> Result<(), TrashFailure> {
    system_trash(path.to_path_buf())
}

#[cfg(test)]
fn platform_trash(path: &Path) -> Result<(), TrashFailure> {
    test_support::trash(path)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, PoisonError};

    static REFUSED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    static IN_USE: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
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

    pub(crate) fn hold_open(path: &Path) {
        IN_USE
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

    pub(super) fn trash(path: &Path) -> Result<(), super::TrashFailure> {
        let original = canonical(path);
        if IN_USE
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&original)
        {
            return Err(super::TrashFailure {
                in_use: true,
                detail: "the file is open in another program".into(),
            });
        }
        if REFUSED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&original)
        {
            return Err(super::TrashFailure::other("this volume has no trash"));
        }
        let bin = std::env::temp_dir().join(format!("oleafly-test-trash-{}", std::process::id()));
        std::fs::create_dir_all(&bin).map_err(super::TrashFailure::other)?;
        let target = bin.join(NEXT.fetch_add(1, Ordering::Relaxed).to_string());
        std::fs::rename(&original, target).map_err(super::TrashFailure::other)?;
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
    fn only_a_sharing_or_lock_violation_counts_as_in_use() {
        for code in [
            0x8027_0027_u32,
            0x8027_0028,
            0x8007_0020,
            0x8007_0021,
            32,
            33,
        ] {
            assert!(in_use_code(code as i32), "{code:#x}");
        }
        for code in [0x8027_0011_u32, 0x8027_0010, 0x8007_0005, 5, 0] {
            assert!(!in_use_code(code as i32), "{code:#x}");
        }
        let failure = failure_of(trash::Error::Os {
            code: 0x8027_0027_u32 as i32,
            description: "the source is in use by another process".into(),
        });
        assert_eq!(failure.in_use, cfg!(windows));
        assert!(
            !failure_of(trash::Error::Unknown {
                description: "no trash".into()
            })
            .in_use
        );
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
