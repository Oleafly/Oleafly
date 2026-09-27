use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use crate::app_error::AppError;
use crate::project_location::{ProjectKind, ProjectLocation};

pub(crate) const READ_ONLY: &str = "project.folder_read_only";

#[derive(Debug)]
pub(crate) struct WriteFailure {
    message: String,
    cause: Option<io::Error>,
}

impl WriteFailure {
    pub(crate) fn io(context: &str, error: io::Error) -> Self {
        Self {
            message: format!("{context}: {error}"),
            cause: Some(error),
        }
    }

    pub(crate) fn with_cause(message: String, error: io::Error) -> Self {
        Self {
            message,
            cause: Some(error),
        }
    }

    pub(crate) fn context(self, context: &str) -> Self {
        Self {
            message: format!("{context}: {}", self.message),
            cause: self.cause,
        }
    }

    pub(crate) fn read_only(&self) -> bool {
        self.cause.as_ref().is_some_and(is_read_only)
    }
}

impl From<io::Error> for WriteFailure {
    fn from(error: io::Error) -> Self {
        Self {
            message: error.to_string(),
            cause: Some(error),
        }
    }
}

impl From<String> for WriteFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            cause: None,
        }
    }
}

impl From<&str> for WriteFailure {
    fn from(message: &str) -> Self {
        Self::from(message.to_string())
    }
}

impl From<AppError> for WriteFailure {
    fn from(error: AppError) -> Self {
        Self::from(String::from(error))
    }
}

impl From<WriteFailure> for String {
    fn from(failure: WriteFailure) -> Self {
        failure.message
    }
}

impl fmt::Display for WriteFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

pub(crate) fn is_read_only(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem
    ) || windows_write_refused(error.raw_os_error())
}

#[cfg(windows)]
fn windows_write_refused(code: Option<i32>) -> bool {
    use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_WRITE_PROTECT};
    code.and_then(|code| u32::try_from(code).ok())
        .is_some_and(|code| code == ERROR_ACCESS_DENIED || code == ERROR_WRITE_PROTECT)
}

#[cfg(not(windows))]
fn windows_write_refused(_code: Option<i32>) -> bool {
    false
}

pub(crate) fn read_only(name: &str) -> String {
    AppError::new(READ_ONLY).param("name", name).into()
}

pub(crate) fn is_read_only_refusal(text: &str) -> bool {
    text.strip_prefix(crate::app_error::PREFIX)
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .is_some_and(|value| value["code"] == READ_ONLY)
}

#[derive(Clone, Copy)]
pub(crate) struct Folder<'a> {
    kind: ProjectKind,
    root: &'a Path,
}

impl<'a> Folder<'a> {
    pub(crate) fn new(kind: ProjectKind, root: &'a Path) -> Self {
        Self { kind, root }
    }

    pub(crate) fn of(location: &'a ProjectLocation) -> Self {
        Self::new(location.kind, &location.root)
    }

    pub(crate) fn refuses_writes_at(self, target: &Path) -> bool {
        self.kind == ProjectKind::Linked
            && nearest_folder(self.root, target)
                .is_some_and(crate::folder_status::folder_is_read_only)
    }

    #[cfg(unix)]
    fn refuses_writes_in(self, folder: &Path) -> bool {
        self.kind == ProjectKind::Linked
            && folder.starts_with(self.root)
            && std::fs::symlink_metadata(folder).is_ok_and(|metadata| metadata.is_dir())
            && crate::folder_status::folder_is_read_only(folder)
    }

    #[cfg(unix)]
    pub(crate) fn refuses_move_of(self, src: &Path, dst: &Path) -> bool {
        src.parent() != dst.parent() && self.refuses_writes_in(src)
    }

    #[cfg(not(unix))]
    pub(crate) fn refuses_move_of(self, _src: &Path, _dst: &Path) -> bool {
        false
    }

    pub(crate) fn refuses_trash(self, target: &Path) -> bool {
        self.refuses_writes_at(target) || self.locks_contents_of(target)
    }

    #[cfg(unix)]
    fn locks_contents_of(self, folder: &Path) -> bool {
        self.refuses_writes_in(folder)
            && !std::fs::read_dir(folder).is_ok_and(|mut entries| entries.next().is_none())
    }

    #[cfg(not(unix))]
    fn locks_contents_of(self, _folder: &Path) -> bool {
        false
    }

    pub(crate) fn refused_removal(self, target: &Path) -> Option<PathBuf> {
        if self.kind != ProjectKind::Linked {
            return None;
        }
        let entry = remaining_entry(target, 0).unwrap_or_else(|| target.to_path_buf());
        self.refuses_writes_at(&entry).then_some(entry)
    }

    pub(crate) fn describe(
        self,
        target: &Path,
        name: &str,
        failure: impl Into<WriteFailure>,
        fallback: impl FnOnce(WriteFailure) -> String,
    ) -> String {
        self.describe_any(&[(target, name)], failure, fallback)
    }

    pub(crate) fn describe_any(
        self,
        targets: &[(&Path, &str)],
        failure: impl Into<WriteFailure>,
        fallback: impl FnOnce(WriteFailure) -> String,
    ) -> String {
        self.describe_with(
            failure,
            |folder| {
                targets
                    .iter()
                    .find(|(target, _)| folder.refuses_writes_at(target))
                    .map(|(_, name)| name.to_string())
            },
            fallback,
        )
    }

    pub(crate) fn describe_with(
        self,
        failure: impl Into<WriteFailure>,
        refused: impl FnOnce(Self) -> Option<String>,
        fallback: impl FnOnce(WriteFailure) -> String,
    ) -> String {
        let failure = failure.into();
        match failure.read_only().then(|| refused(self)).flatten() {
            Some(name) => read_only(&name),
            None => fallback(failure),
        }
    }
}

fn nearest_folder<'p>(root: &Path, target: &'p Path) -> Option<&'p Path> {
    target
        .ancestors()
        .skip(1)
        .take_while(|folder| folder.starts_with(root))
        .find(|folder| folder.is_dir())
}

const MAX_REMOVAL_DEPTH: usize = 256;

fn remaining_entry(directory: &Path, depth: usize) -> Option<PathBuf> {
    if depth >= MAX_REMOVAL_DEPTH
        || !std::fs::symlink_metadata(directory).is_ok_and(|metadata| metadata.is_dir())
    {
        return None;
    }
    let entry = std::fs::read_dir(directory).ok()?.next()?.ok()?;
    let path = entry.path();
    if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
        return Some(remaining_entry(&path, depth + 1).unwrap_or(path));
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decoded(text: &str) -> serde_json::Value {
        let json = text
            .strip_prefix(crate::app_error::PREFIX)
            .unwrap_or_else(|| panic!("not an app error: {text}"));
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn permission_and_read_only_volume_errors_are_read_only() {
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::ReadOnlyFilesystem,
        ] {
            assert!(is_read_only(&io::Error::from(kind)), "{kind:?}");
        }
        for kind in [
            io::ErrorKind::NotFound,
            io::ErrorKind::AlreadyExists,
            io::ErrorKind::StorageFull,
            io::ErrorKind::Other,
        ] {
            assert!(!is_read_only(&io::Error::from(kind)), "{kind:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn unix_errno_values_are_read_by_meaning_not_by_number() {
        for code in [libc::EACCES, libc::EPERM, libc::EROFS] {
            assert!(is_read_only(&io::Error::from_raw_os_error(code)), "{code}");
        }
        for code in [libc::EIO, libc::ENODEV, libc::ENOSPC, libc::EBUSY] {
            assert!(!is_read_only(&io::Error::from_raw_os_error(code)), "{code}");
        }
        assert!(!is_read_only(&io::Error::from_raw_os_error(5)));
        assert!(!is_read_only(&io::Error::from_raw_os_error(19)));
    }

    #[cfg(windows)]
    #[test]
    fn windows_access_denied_and_write_protect_are_read_only() {
        for code in [5, 19] {
            assert!(is_read_only(&io::Error::from_raw_os_error(code)), "{code}");
        }
        for code in [2, 32, 33, 112] {
            assert!(!is_read_only(&io::Error::from_raw_os_error(code)), "{code}");
        }
    }

    #[cfg(unix)]
    struct Mode(std::path::PathBuf);

    #[cfg(unix)]
    impl Drop for Mode {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
        }
    }

    #[cfg(unix)]
    fn locked(folder: &Path) -> Option<Mode> {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o555)).unwrap();
        let guard = Mode(folder.to_path_buf());
        let probe = folder.join(".probe");
        if std::fs::File::create(&probe).is_ok() {
            let _ = std::fs::remove_file(&probe);
            return None;
        }
        Some(guard)
    }

    fn denied() -> io::Error {
        io::Error::from(io::ErrorKind::PermissionDenied)
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_linked_folder_names_the_file_and_drops_the_os_text() {
        let root = tempfile::tempdir().unwrap();
        let figures = root.path().join("figures");
        std::fs::create_dir(&figures).unwrap();
        let Some(_locked) = locked(&figures) else {
            return;
        };
        let target = figures.join("new").join("plot.png");
        let text = Folder::new(ProjectKind::Linked, root.path()).describe(
            &target,
            "figures/new/plot.png",
            WriteFailure::io("failed to create staging file", denied()),
            String::from,
        );
        let json = decoded(&text);
        assert_eq!(json["code"], READ_ONLY);
        assert_eq!(json["params"]["name"], "figures/new/plot.png");
        assert!(json["detail"].is_null());
        assert!(!text.contains("staging"), "{text}");
        assert!(is_read_only_refusal(&text));
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_file_in_a_writable_linked_folder_keeps_the_os_text() {
        use std::os::unix::fs::PermissionsExt as _;
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("notes.tex");
        std::fs::write(&target, "notes").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o444)).unwrap();
        let Err(error) = std::fs::OpenOptions::new().write(true).open(&target) else {
            return;
        };
        assert!(is_read_only(&error));
        let expected = format!("failed to write the linked file: {error}");
        let text = Folder::new(ProjectKind::Linked, root.path()).describe(
            &target,
            "notes.tex",
            WriteFailure::io("failed to write the linked file", error),
            String::from,
        );
        assert_eq!(text, expected);
        assert!(!is_read_only_refusal(&text));
    }

    #[cfg(target_os = "macos")]
    struct Unlock(std::ffi::CString);

    #[cfg(target_os = "macos")]
    impl Drop for Unlock {
        fn drop(&mut self) {
            unsafe { libc::chflags(self.0.as_ptr(), 0) };
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_finder_locked_file_in_a_writable_linked_folder_keeps_the_os_text() {
        use std::os::unix::ffi::OsStrExt as _;
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("notes.tex");
        std::fs::write(&target, "notes").unwrap();
        let path = std::ffi::CString::new(target.as_os_str().as_bytes()).unwrap();
        assert_eq!(
            unsafe { libc::chflags(path.as_ptr(), libc::UF_IMMUTABLE) },
            0
        );
        let _unlock = Unlock(path);
        let error = std::fs::remove_file(&target).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::EPERM));
        assert!(is_read_only(&error));
        let expected = format!("failed to delete notes.tex: {error}");
        let text = Folder::new(ProjectKind::Linked, root.path()).describe(
            &target,
            "notes.tex",
            error,
            |failure| format!("failed to delete notes.tex: {failure}"),
        );
        assert_eq!(text, expected);
    }

    #[cfg(unix)]
    #[test]
    fn a_library_project_keeps_the_original_message() {
        let root = tempfile::tempdir().unwrap();
        let Some(_locked) = locked(root.path()) else {
            return;
        };
        let expected = format!("move failed: {}", denied());
        let text = Folder::new(ProjectKind::Library, root.path()).describe(
            &root.path().join("main.tex"),
            "main.tex",
            WriteFailure::io("move failed", denied()),
            String::from,
        );
        assert_eq!(text, expected);
    }

    #[cfg(unix)]
    #[test]
    fn the_first_refusing_target_is_named() {
        let root = tempfile::tempdir().unwrap();
        let figures = root.path().join("figures");
        std::fs::create_dir(&figures).unwrap();
        let Some(_locked) = locked(&figures) else {
            return;
        };
        let folder = Folder::new(ProjectKind::Linked, root.path());
        let text = folder.describe_any(
            &[
                (&root.path().join("notes.tex"), "notes.tex"),
                (&figures.join("notes.tex"), "figures/notes.tex"),
            ],
            denied(),
            String::from,
        );
        assert_eq!(decoded(&text)["params"]["name"], "figures/notes.tex");
    }

    #[cfg(unix)]
    #[test]
    fn other_failures_and_plain_messages_are_left_alone() {
        let root = tempfile::tempdir().unwrap();
        let Some(_locked) = locked(root.path()) else {
            return;
        };
        let folder = Folder::new(ProjectKind::Linked, root.path());
        let target = root.path().join("main.tex");
        let text = folder.describe(
            &target,
            "main.tex",
            io::Error::from(io::ErrorKind::StorageFull),
            |failure| format!("failed to write main.tex: {failure}"),
        );
        assert!(text.starts_with("failed to write main.tex: "), "{text}");
        let text = folder.describe(
            &target,
            "main.tex",
            "the new content is kept elsewhere",
            String::from,
        );
        assert_eq!(text, "the new content is kept elsewhere");
    }

    #[test]
    fn the_refusal_names_the_path_and_carries_no_detail() {
        let text = read_only("figures/plot.png");
        let json = decoded(&text);
        assert_eq!(json["code"], READ_ONLY);
        assert_eq!(json["params"]["name"], "figures/plot.png");
        assert!(json["detail"].is_null());
        assert!(is_read_only_refusal(&text));
        assert!(!is_read_only_refusal("figures/plot.png"));
        let other: String = AppError::new("project.trash_unavailable")
            .param("path", "figures/plot.png")
            .into();
        assert!(!is_read_only_refusal(&other));
    }

    #[test]
    fn the_nearest_folder_stays_inside_the_root() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("figures")).unwrap();
        let deep = root.path().join("figures").join("new").join("plot.png");
        assert_eq!(
            nearest_folder(root.path(), &deep),
            Some(root.path().join("figures").as_path())
        );
        let outside = root.path().parent().unwrap().join("elsewhere.tex");
        assert_eq!(nearest_folder(root.path(), &outside), None);
        assert!(!Folder::new(ProjectKind::Linked, root.path()).refuses_writes_at(&deep));
    }

    #[test]
    fn context_keeps_the_cause() {
        let failure = WriteFailure::from(denied()).context("import failed");
        assert!(failure.to_string().starts_with("import failed: "));
        assert!(failure.read_only());
    }
}
