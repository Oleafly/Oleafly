//! The folders the app looks for programs in, for the helper. A window app
//! gets a minimal `PATH`, so the app rebuilds its search path (the login
//! shell's `PATH` on macOS and Linux, the registry `PATH` and the usual
//! install folders on Windows). The helper is the same executable, started
//! by the app or at sign-in with that minimal `PATH`; without this list it
//! would not find `python3`, `node` or `uv`, or the user's MCP servers
//! (`npx`, `uvx`), that work in the app.
//!
//! The app writes the list to `<data>/daemon/search-dirs.json` when it
//! hands tasks over. The helper reads it for program lookup and for stdio
//! MCP servers, and adds what is left of its own `PATH`.
use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_DIRS: usize = 512;

/// Writes the app's search folders (absolute, UTF-8 ones).
pub fn write(path: &Path, dirs: &[PathBuf]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let listed: Vec<&str> = dirs
        .iter()
        .filter(|dir| dir.is_absolute())
        .filter_map(|dir| dir.to_str())
        .take(MAX_DIRS)
        .collect();
    let bytes = serde_json::to_vec(&listed).map_err(io::Error::other)?;
    oleafly_secrets::fs::write_atomic(path, &bytes).map_err(io::Error::other)?;
    oleafly_secrets::fsperm::harden_file(path);
    Ok(())
}

/// The folders the app wrote; empty when there is no usable list.
pub fn read(path: &Path) -> Vec<PathBuf> {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return Vec::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Vec::new();
    }
    let Some(listed) = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
    else {
        return Vec::new();
    };
    listed
        .into_iter()
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .take(MAX_DIRS)
        .collect()
}

/// The app's folders first, then the folders of `process_path` that are not
/// in them already.
pub fn merged(app: Vec<PathBuf>, process_path: Option<&OsStr>) -> Vec<PathBuf> {
    let mut dirs = app;
    if let Some(path) = process_path {
        for dir in std::env::split_paths(path) {
            if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// What the helper searches: the app's list, then its own `PATH`.
pub fn for_helper(path: &Path) -> Vec<PathBuf> {
    merged(read(path), std::env::var_os("PATH").as_deref())
}

/// The first of `names` that is a file in one of `dirs`.
pub fn find_program(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) && !name.contains('.') {
        vec![format!("{name}.exe"), name.to_string()]
    } else {
        vec![name.to_string()]
    };
    dirs.iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::*;

    fn absolute(name: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!(r"C:\{name}"))
        } else {
            PathBuf::from(format!("/{name}"))
        }
    }

    #[test]
    fn the_list_round_trips_and_keeps_only_absolute_folders() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemon").join("search-dirs.json");
        write(
            &path,
            &[
                absolute("opt/homebrew/bin"),
                PathBuf::from("relative/bin"),
                absolute("usr/local/bin"),
            ],
        )
        .unwrap();
        assert_eq!(
            read(&path),
            [absolute("opt/homebrew/bin"), absolute("usr/local/bin")]
        );
    }

    #[test]
    fn a_missing_oversized_or_garbled_list_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search-dirs.json");
        assert!(read(&path).is_empty());
        std::fs::write(&path, "not json").unwrap();
        assert!(read(&path).is_empty());
        std::fs::write(&path, vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(read(&path).is_empty());
        std::fs::write(&path, r#"["relative", 5]"#).unwrap();
        assert!(read(&path).is_empty());
    }

    #[test]
    fn the_apps_folders_come_first_and_the_process_path_fills_in_the_rest() {
        let process = std::env::join_paths([
            absolute("usr/bin"),
            absolute("opt/homebrew/bin"),
            absolute("bin"),
        ])
        .unwrap();
        let result = merged(
            vec![absolute("opt/homebrew/bin"), absolute("usr/local/bin")],
            Some(process.as_os_str()),
        );
        assert_eq!(
            result,
            [
                absolute("opt/homebrew/bin"),
                absolute("usr/local/bin"),
                absolute("usr/bin"),
                absolute("bin"),
            ]
        );
        assert_eq!(
            merged(Vec::new(), Some(OsString::new().as_os_str())),
            Vec::<PathBuf>::new()
        );
    }

    #[test]
    fn a_program_is_found_in_the_apps_folder_and_not_on_the_process_path() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "uv.exe" } else { "uv" };
        std::fs::write(dir.path().join(name), "").unwrap();
        let other = tempfile::tempdir().unwrap();
        let dirs = [other.path().to_path_buf(), dir.path().to_path_buf()];
        assert_eq!(find_program(&dirs, "uv"), Some(dir.path().join(name)));
        assert_eq!(find_program(&dirs[..1], "uv"), None);
    }
}
