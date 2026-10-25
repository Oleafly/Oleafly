//! Programs shipped beside an executable (the app's bundled engines, the
//! CLI's copy of them).
use std::path::{Path, PathBuf};

/// `name` with `.exe` on Windows.
pub fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// The folder of `executable` with links resolved; a `deps` folder (where
/// `cargo test` puts binaries) stands for its parent. On Windows the folder
/// is spelled `C:\…`, not `\\?\C:\…`: bundled engines start from it and
/// it goes on PATH, where the verbatim spelling breaks tools such as Biber.
pub fn executable_dir_of(executable: &Path) -> Option<PathBuf> {
    let real = executable
        .canonicalize()
        .map(|real| crate::plain_path(&real))
        .unwrap_or_else(|_| executable.to_path_buf());
    let folder = real.parent()?;
    Some(if folder.ends_with("deps") {
        folder.parent().unwrap_or(folder).to_path_buf()
    } else {
        folder.to_path_buf()
    })
}

/// The running program's folder (see [`executable_dir_of`]).
pub fn executable_dir() -> Option<PathBuf> {
    executable_dir_of(&std::env::current_exe().ok()?)
}

/// `dir/name` (with `.exe` on Windows) when that file exists. `name` must
/// be a single plain file name.
pub fn sidecar_in(dir: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return None;
    }
    let path = dir.join(exe_name(name));
    path.is_file().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_lookup_strips_deps_and_adds_exe_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let root = crate::plain_path(&dir.path().canonicalize().unwrap());
        std::fs::create_dir_all(root.join("deps")).unwrap();
        std::fs::write(root.join("deps/x"), b"").unwrap();
        assert_eq!(executable_dir_of(&root.join("deps/x")), Some(root.clone()));
        std::fs::write(root.join(exe_name("tectonic")), b"").unwrap();
        assert_eq!(
            sidecar_in(&root, "tectonic"),
            Some(root.join(exe_name("tectonic")))
        );
        assert_eq!(sidecar_in(&root, "../x"), None);
        assert_eq!(sidecar_in(&root, "a/b"), None);
    }

    #[cfg(windows)]
    #[test]
    fn the_program_folder_has_no_verbatim_prefix() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("x.exe"), b"").unwrap();
        let folder = executable_dir_of(&dir.path().join("x.exe")).unwrap();
        assert!(
            !folder.to_string_lossy().starts_with(r"\\?\"),
            "{}",
            folder.display()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_command_resolves_to_its_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("bundle")).unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::fs::write(root.join("bundle/oleafly-cli"), b"").unwrap();
        std::os::unix::fs::symlink(root.join("bundle/oleafly-cli"), root.join("bin/oleafly"))
            .unwrap();
        assert_eq!(
            executable_dir_of(&root.join("bin/oleafly")),
            Some(root.join("bundle"))
        );
    }
}
