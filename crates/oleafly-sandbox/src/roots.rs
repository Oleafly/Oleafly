use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Top-level folders (any drive, any case) that hold home folders, other
/// people's files or whole volumes.
const BROAD_TOP: [&str; 24] = [
    "home",
    "users",
    "root",
    "var",
    "private",
    "tmp",
    "opt",
    "mnt",
    "media",
    "volumes",
    "srv",
    "run",
    "proc",
    "sys",
    "dev",
    "boot",
    "library",
    "applications",
    "network",
    "cores",
    "programdata",
    "program files",
    "program files (x86)",
    "documents and settings",
];

const HOME_CONTAINERS: [&str; 3] = ["home", "users", "documents and settings"];

const SHARED_USER_FOLDERS: [&str; 11] = [
    ".local", ".cargo", ".config", ".cache", ".ssh", ".aws", ".gnupg", ".kube", ".docker",
    ".azure", ".npm",
];

const CREDENTIAL_FILES: [&str; 9] = [
    "credentials",
    "credentials.toml",
    "credentials.json",
    "auth.json",
    ".netrc",
    ".pypirc",
    ".npmrc",
    ".git-credentials",
    "id_rsa",
];

/// `path` without a `\\?\` prefix, lowercase when `fold_case`, for matching
/// paths that were written by different calls (the ledger keeps plain
/// paths; `canonicalize` gives the verbatim form on Windows).
pub(crate) fn comparable(path: &Path, fold_case: bool) -> PathBuf {
    let text = path.to_string_lossy();
    let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.into_owned()
    };
    PathBuf::from(if fold_case {
        plain.to_lowercase()
    } else {
        plain
    })
}

fn tail(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect()
}

pub(crate) fn broad_reason(path: &Path, home: Option<&Path>) -> Option<&'static str> {
    if path.parent().is_none() {
        return Some("it is the whole disk");
    }
    if let Some(home) = home {
        let fold = cfg!(windows);
        let (home, path) = (comparable(home, fold), comparable(path, fold));
        if home.starts_with(&path) {
            return Some("it is the user's home folder or a folder that holds it");
        }
    }
    let names = tail(path);
    match names.as_slice() {
        [] => Some("it is the whole disk"),
        [top] if BROAD_TOP.contains(&top.as_str()) => {
            Some("it is a top-level folder that holds other people's files")
        }
        [top, _] if HOME_CONTAINERS.contains(&top.as_str()) => Some("it is another home folder"),
        [first, second] if first == "private" && matches!(second.as_str(), "var" | "tmp") => {
            Some("it is a top-level folder that holds other people's files")
        }
        _ => None,
    }
}

pub(crate) fn is_shared_prefix(folder: &Path) -> bool {
    let shared_name = folder.file_name().is_some_and(|name| {
        let name = name.to_string_lossy().to_ascii_lowercase();
        SHARED_USER_FOLDERS.contains(&name.as_str())
    });
    shared_name
        || CREDENTIAL_FILES
            .iter()
            .any(|name| std::fs::symlink_metadata(folder.join(name)).is_ok())
}

pub(crate) fn note_refused(path: &Path, reason: &str) {
    static SEEN: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    let mut seen = SEEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if seen.insert(path.to_path_buf()) {
        eprintln!(
            "oleafly-sandbox: refused to make {} readable to commands: {reason}.",
            path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(path: &str, home: Option<&str>) -> bool {
        broad_reason(Path::new(path), home.map(Path::new)).is_some()
    }

    #[cfg(unix)]
    #[test]
    fn refuses_the_disk_homes_and_their_parents() {
        assert!(refused("/", None));
        for path in ["/home", "/Users", "/root", "/home/alice", "/Users/bob"] {
            assert!(refused(path, None), "{path}");
        }
        assert!(refused("/Users/me", Some("/Users/me")));
        assert!(refused("/Users", Some("/Users/me")));
        assert!(refused("/srv/people", Some("/srv/people/me")));
        assert!(!refused("/Users/me/miniconda3", Some("/Users/me")));
        assert!(!refused("/Users/me/data/survey", Some("/Users/me")));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_top_level_system_folders_but_not_installs_below_them() {
        for path in ["/opt", "/var", "/private/var", "/tmp", "/mnt", "/Volumes"] {
            assert!(refused(path, None), "{path}");
        }
        for path in [
            "/opt/conda",
            "/opt/homebrew/opt/python@3.12",
            "/usr/local",
            "/Library/Frameworks/Python.framework/Versions/3.12",
        ] {
            assert!(!refused(path, Some("/Users/me")), "{path}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn refuses_windows_drives_and_user_folders() {
        for path in [
            r"C:\",
            r"C:\Users",
            r"D:\users",
            r"C:\Users\Bob",
            r"C:\Program Files",
        ] {
            assert!(refused(path, Some(r"C:\Users\Me")), "{path}");
        }
        assert!(refused(r"C:\Users\Me", Some(r"C:\users\me")));
        assert!(!refused(r"C:\Python312", Some(r"C:\Users\Me")));
        assert!(!refused(r"C:\Users\Me\miniconda3", Some(r"C:\Users\Me")));
    }

    #[test]
    fn comparable_ignores_the_verbatim_prefix_and_optionally_case() {
        assert_eq!(
            comparable(Path::new(r"\\?\C:\Data\Survey"), false),
            comparable(Path::new(r"C:\Data\Survey"), false)
        );
        assert_eq!(
            comparable(Path::new(r"\\?\UNC\srv\share\x"), false),
            PathBuf::from(r"\\srv\share\x")
        );
        assert_ne!(
            comparable(Path::new(r"C:\Data"), false),
            comparable(Path::new(r"c:\data"), false)
        );
        assert_eq!(
            comparable(Path::new(r"C:\Data"), true),
            comparable(Path::new(r"c:\data"), true)
        );
    }

    #[cfg(unix)]
    #[test]
    fn shared_user_folders_and_login_files_mark_a_shared_prefix() {
        assert!(is_shared_prefix(Path::new("/Users/me/.local")));
        assert!(is_shared_prefix(Path::new("/Users/me/.CARGO")));
        assert!(!is_shared_prefix(Path::new("/Users/me/.pyenv")));
        let folder = tempfile::tempdir().unwrap();
        assert!(!is_shared_prefix(folder.path()));
        std::fs::write(folder.path().join(".netrc"), "machine x").unwrap();
        assert!(is_shared_prefix(folder.path()));
    }
}
