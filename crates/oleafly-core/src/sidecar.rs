use std::path::{Path, PathBuf};

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

pub fn executable_dir() -> Option<PathBuf> {
    executable_dir_of(&std::env::current_exe().ok()?)
}

/// The folders that can hold a bundled tool, given the folder of the running
/// program. On Linux that folder is `/usr/bin`, which also holds the
/// distribution's own tools, so the packages' `libexec` folder comes first.
pub fn bundled_tool_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::with_capacity(2);
    if cfg!(target_os = "linux") {
        dirs.extend(dir.parent().map(|prefix| prefix.join("libexec/oleafly")));
    }
    dirs.push(dir.to_path_buf());
    dirs
}

pub fn sidecar_in(dir: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return None;
    }
    bundled_tool_dirs(dir)
        .into_iter()
        .map(|folder| folder.join(exe_name(name)))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn an_installed_tool_in_libexec_wins_over_a_distro_tool_beside_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("usr/bin");
        let libexec = dir.path().join("usr/libexec/oleafly");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&libexec).unwrap();
        std::fs::write(bin.join("pandoc"), b"").unwrap();
        std::fs::write(libexec.join("pandoc"), b"").unwrap();

        assert_eq!(sidecar_in(&bin, "pandoc"), Some(libexec.join("pandoc")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_tool_that_is_not_in_libexec_is_found_beside_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("target/debug");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("typst"), b"").unwrap();

        assert_eq!(sidecar_in(&bin, "typst"), Some(bin.join("typst")));
    }

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
