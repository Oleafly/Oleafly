//! Writes the app makes, as the user, inside a task's home folder. A sandboxed
//! command can write there too and can turn a folder into a link (a
//! symbolic link, or a junction on Windows), so the app must never create or
//! write through one: a link would send the write anywhere the user can.
use std::fs::Metadata;
use std::io;
use std::path::{Component, Path, PathBuf};
#[cfg(any(windows, test))]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(any(windows, test))]
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Whether `metadata` (from `symlink_metadata`) describes a link of any kind:
/// a symbolic link, a junction or another reparse point.
pub(crate) fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Whether `error` came from finding a link where a folder was needed.
pub(crate) fn is_link_error(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::InvalidInput
}

fn link_error(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{} is a link, not a folder.", path.display()),
    )
}

/// Creates `relative` below `base` one folder at a time, without ever
/// following a link: a link at any level is an error (see [`is_link_error`]),
/// whether it was there already or appeared while the folder was made.
pub(crate) fn create_folders_below(base: &Path, relative: &Path) -> io::Result<PathBuf> {
    let mut current = base.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a home folder path stays below the home folder",
            ));
        };
        current.push(name);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if is_link(&metadata) => return Err(link_error(&current)),
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("{} is not a folder.", current.display()),
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match std::fs::create_dir(&current) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error),
                }
                let made = std::fs::symlink_metadata(&current)?;
                if is_link(&made) || !made.is_dir() {
                    return Err(link_error(&current));
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(current)
}

/// Writes `contents` as the file `path` without writing through a link that
/// is there: the bytes go into a new file beside it (a new file is never an
/// existing link), which then replaces whatever `path` was.
#[cfg(any(windows, test))]
pub(crate) fn replace_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_nested_folders_below_the_base() {
        let base = tempfile::tempdir().unwrap();
        let made = create_folders_below(base.path(), Path::new("AppData/Roaming")).unwrap();
        assert!(made.is_dir());
        assert_eq!(made, base.path().join("AppData").join("Roaming"));
        // An existing folder is fine, and so is doing it twice.
        create_folders_below(base.path(), Path::new("AppData/Roaming")).unwrap();
    }

    #[test]
    fn refuses_paths_that_leave_the_base() {
        let base = tempfile::tempdir().unwrap();
        for relative in ["../outside", "/etc", "a/../b"] {
            let error = create_folders_below(base.path(), Path::new(relative)).unwrap_err();
            assert!(is_link_error(&error), "{relative}");
        }
    }

    #[test]
    fn a_file_where_a_folder_belongs_is_an_error_but_not_a_link_error() {
        let base = tempfile::tempdir().unwrap();
        std::fs::write(base.path().join("tmp"), "x").unwrap();
        let error = create_folders_below(base.path(), Path::new("tmp")).unwrap_err();
        assert!(!is_link_error(&error));
    }

    #[cfg(unix)]
    #[test]
    fn never_creates_through_a_link() {
        let base = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), base.path().join(".local")).unwrap();
        let error = create_folders_below(base.path(), Path::new(".local/state")).unwrap_err();
        assert!(is_link_error(&error));
        assert!(!outside.path().join("state").exists());
        // A link at the last level is refused too.
        std::os::unix::fs::symlink(outside.path(), base.path().join("tmp")).unwrap();
        assert!(is_link_error(
            &create_folders_below(base.path(), Path::new("tmp")).unwrap_err()
        ));
    }

    #[cfg(unix)]
    #[test]
    fn replacing_a_file_leaves_a_link_target_alone() {
        let folder = tempfile::tempdir().unwrap();
        let target = folder.path().join("users-sitecustomize.py");
        std::fs::write(&target, "mine").unwrap();
        let shim = folder.path().join("sitecustomize.py");
        std::os::unix::fs::symlink(&target, &shim).unwrap();
        replace_file(&shim, b"shim").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "mine");
        assert_eq!(std::fs::read_to_string(&shim).unwrap(), "shim");
        assert!(!std::fs::symlink_metadata(&shim)
            .unwrap()
            .file_type()
            .is_symlink());
        // No temporary file is left behind.
        let names: Vec<_> = std::fs::read_dir(folder.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names.iter().all(|name| !name.ends_with(".tmp")),
            "{names:?}"
        );
    }

    #[test]
    fn replacing_a_file_overwrites_the_old_contents() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("sitecustomize.py");
        replace_file(&file, b"one").unwrap();
        replace_file(&file, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
    }
}
