//! Pinned Biber support for biblatex projects.
//!
//! Tectonic 0.16 bundles biblatex 3.17, which requires Biber 2.17. System TeX
//! Live often ships a newer Biber that rejects Tectonic's control files. Oleafly
//! therefore prefers a co-packaged `tectonic-biber` (the name Tectonic looks up
//! first) and injects its directory onto PATH for the compile child.

use std::path::{Path, PathBuf};

/// Locate a version-pinned `tectonic-biber` binary for the current app layout.
pub fn find_tectonic_biber() -> Option<PathBuf> {
    tectonic_biber_candidates()
        .into_iter()
        .find(|path| path.is_file())
}

/// Directories that should precede PATH when spawning Tectonic so it can find
/// `tectonic-biber` and common system TeX helpers.
pub fn compile_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let base = if parent.ends_with("deps") {
                parent.parent().unwrap_or(parent)
            } else {
                parent
            };
            push_unique(&mut dirs, base.to_path_buf());
        }
    }

    if let Some(biber) = find_tectonic_biber() {
        if let Some(parent) = biber.parent() {
            push_unique(&mut dirs, parent.to_path_buf());
        }
    }

    for dir in tex_bin_search_dirs() {
        if dir.is_dir() {
            push_unique(&mut dirs, dir);
        }
    }

    dirs
}

/// Build a PATH value with toolchain directories first.
#[cfg(test)]
pub fn compile_path_env() -> std::ffi::OsString {
    compile_path_env_with_inherited(std::env::var_os("PATH").as_deref(), None, None)
}

/// PATH for a TeX utility that has already been resolved to an exact
/// distribution. Its sibling tools must win over every other installation.
pub fn tool_path_env(preferred_executable: &Path) -> std::ffi::OsString {
    compile_path_env_with_inherited(
        std::env::var_os("PATH").as_deref(),
        preferred_executable.parent(),
        None,
    )
}

/// Compiler PATH with the exact selected tool's directory first and all paths
/// inside the project removed. This keeps one TeX distribution coherent and
/// prevents an absolute project PATH entry from reintroducing local executable
/// shadowing after Windows current-directory search is disabled.
pub fn compile_path_env_for(
    preferred_executable: &Path,
    excluded_project_root: &Path,
) -> std::ffi::OsString {
    compile_path_env_with_inherited(
        std::env::var_os("PATH").as_deref(),
        preferred_executable.parent(),
        Some(excluded_project_root),
    )
}

fn compile_path_env_with_inherited(
    inherited: Option<&std::ffi::OsStr>,
    preferred_dir: Option<&Path>,
    excluded_root: Option<&Path>,
) -> std::ffi::OsString {
    let mut dirs = Vec::new();
    let mut add = |dir: PathBuf| {
        if dir.is_absolute() && !excluded_root.is_some_and(|root| path_is_within(&dir, root)) {
            push_unique(&mut dirs, dir);
        }
    };
    if let Some(preferred) = preferred_dir {
        add(preferred.to_path_buf());
    }
    for dir in compile_path_dirs() {
        add(dir);
    }
    if let Some(inherited) = inherited {
        for dir in std::env::split_paths(inherited) {
            // Empty/relative PATH entries mean the child working directory.
            // Never let project-local executables participate in compiler
            // helper discovery; absolute system/user tool dirs remain usable.
            if dir.is_absolute() {
                add(dir);
            }
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let resolved_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let resolved_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    resolved_path == resolved_root || resolved_path.starts_with(&resolved_root)
}

/// True when the compile produced a biblatex control file that still needs Biber.
pub fn bibliography_needs_biber(log: &str, out_dir: &Path, entry_stem: &str) -> bool {
    let bcf = out_dir.join(format!("{entry_stem}.bcf"));
    if bcf.is_file() {
        return true;
    }
    log.contains("Please (re)run Biber")
        || log.contains("Please (re)run Biber on the file")
        || log.contains(&format!("file '{entry_stem}.bbl' not found"))
        || log.contains(&format!("No file {entry_stem}.bbl"))
}

/// True when Biber did not produce a usable .bbl for the entry stem.
pub fn biber_output_missing(out_dir: &Path, entry_stem: &str) -> bool {
    let bbl = out_dir.join(format!("{entry_stem}.bbl"));
    match std::fs::metadata(&bbl) {
        Ok(meta) => meta.len() == 0,
        Err(_) => true,
    }
}

/// Classify a failed or incomplete Biber step for the user-facing log.
pub fn diagnose_biber_gap(log: &str, biber: Option<&Path>) -> String {
    let mut message = String::from(
        "\n[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.\n",
    );
    if log.contains("versions are incompatible") || log.contains("control file version") {
        message.push_str(
            "[Oleafly] Biber/biblatex version mismatch (mode B): the Biber on PATH does not match \
Tectonic's bundled biblatex. Prefer the packaged tectonic-biber (Biber 2.17 for Tectonic 0.16).\n",
        );
    } else if biber.is_none()
        || log.contains("No such file or directory (os error 2)")
        || (log.contains("Running external tool biber") && log.contains("No such file"))
    {
        message.push_str(
            "[Oleafly] Biber was not found (mode A): GUI launches often have a minimal PATH, and \
Oleafly could not locate the packaged tectonic-biber sidecar. Reinstall Oleafly or run \
scripts/fetch-biber.sh for your platform, then compile again.\n",
        );
    } else {
        message.push_str(
            "[Oleafly] Biber was available but the bibliography step still failed. Check the Biber \
messages above, then recompile.\n",
        );
        if let Some(path) = biber {
            message.push_str(&format!("[Oleafly] Using Biber at: {}\n", path.display()));
        }
    }
    message
}

/// CLI args for running Biber on the entry stem written under `out_dir`.
/// Callers should spawn via the supervised compile process path so timeout,
/// cancel, and process-group isolation match Tectonic.
pub fn biber_cli_args(out_dir: &Path, entry_stem: &str) -> Vec<String> {
    vec![
        "--output-directory".into(),
        out_dir.to_string_lossy().into_owned(),
        "--input-directory".into(),
        out_dir.to_string_lossy().into_owned(),
        entry_stem.into(),
    ]
}

fn tectonic_biber_candidates() -> Vec<PathBuf> {
    let name = if cfg!(windows) {
        "tectonic-biber.exe"
    } else {
        "tectonic-biber"
    };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let base = if parent.ends_with("deps") {
                parent.parent().unwrap_or(parent)
            } else {
                parent
            };
            candidates.push(base.join(name));
        }
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("target/debug").join(name));
    candidates.push(manifest.join("target/release").join(name));
    if let Some(triple) = host_triple_guess() {
        let triple_name = if cfg!(windows) {
            format!("tectonic-biber-{triple}.exe")
        } else {
            format!("tectonic-biber-{triple}")
        };
        candidates.push(manifest.join("binaries").join(&triple_name));
    }
    candidates
}

fn host_triple_guess() -> Option<&'static str> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
        ("aarch64", "linux") => Some("aarch64-unknown-linux-gnu"),
        ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

fn tex_bin_search_dirs() -> Vec<PathBuf> {
    // Shared discovery (MacTeX, TeX Live by year, MiKTeX, TinyTeX variants) so
    // PATH injection and the latexmk engine agree on where TeX tools live.
    crate::tex_distro::tex_bin_dirs()
}

fn push_unique(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "oleafly-biber-test-{}-{}",
            label,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn bibliography_detects_bcf_or_log_request() {
        let dir = scratch_dir("bcf");
        assert!(!bibliography_needs_biber("clean", &dir, "main"));
        assert!(bibliography_needs_biber(
            "Package biblatex Warning: Please (re)run Biber on the file:",
            &dir,
            "main"
        ));
        std::fs::write(dir.join("_oleafly_entry.bcf"), b"<bcf/>").unwrap();
        assert!(bibliography_needs_biber("ok", &dir, "_oleafly_entry"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bbl_missing_when_absent_or_empty() {
        let dir = scratch_dir("bbl");
        assert!(biber_output_missing(&dir, "main"));
        std::fs::write(dir.join("main.bbl"), b"").unwrap();
        assert!(biber_output_missing(&dir, "main"));
        std::fs::write(dir.join("main.bbl"), b"\\begin{thebibliography}").unwrap();
        assert!(!biber_output_missing(&dir, "main"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diagnose_mode_a_when_biber_missing() {
        let msg = diagnose_biber_gap(
            "note: Running external tool biber ...\nerror: No such file or directory (os error 2)",
            None,
        );
        assert!(msg.contains("mode A"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn diagnose_mode_b_on_version_skew() {
        let msg = diagnose_biber_gap(
            "ERROR - Error: Found biblatex control file version 3.8, expected version 3.11.\n\
This means that your biber (2.20) and biblatex (3.17) versions are incompatible.",
            Some(Path::new("/Library/TeX/texbin/biber")),
        );
        assert!(msg.contains("mode B"));
        assert!(msg.contains("version mismatch"));
    }

    #[test]
    fn compile_path_env_is_non_empty() {
        let env = compile_path_env();
        assert!(!env.is_empty());
    }

    #[test]
    fn compiler_path_drops_current_directory_and_relative_entries() {
        let absolute = std::env::temp_dir();
        let inherited = std::env::join_paths([PathBuf::from("."), absolute.clone()]).unwrap();
        let hardened = compile_path_env_with_inherited(Some(&inherited), None, None);
        let entries: Vec<_> = std::env::split_paths(&hardened).collect();
        assert!(entries.iter().all(|entry| entry.is_absolute()));
        assert!(entries.contains(&absolute));
        assert!(!entries.contains(&PathBuf::from(".")));
    }

    #[test]
    fn compiler_path_prefers_selected_distribution_and_excludes_project() {
        let root =
            std::env::temp_dir().join(format!("oleafly-compile-path-{}", std::process::id()));
        let project_bin = root.join("project/bin");
        let distro_a = root.join("distro-a/bin");
        let distro_b = root.join("distro-b/bin");
        std::fs::create_dir_all(&project_bin).unwrap();
        std::fs::create_dir_all(&distro_a).unwrap();
        std::fs::create_dir_all(&distro_b).unwrap();
        let inherited = std::env::join_paths([project_bin.clone(), distro_a.clone()]).unwrap();
        let preferred = distro_b.join(crate::tex_distro::exe("latexmk"));
        let hardened = compile_path_env_with_inherited(
            Some(&inherited),
            preferred.parent(),
            Some(&root.join("project")),
        );
        let entries: Vec<_> = std::env::split_paths(&hardened).collect();
        assert_eq!(entries.first(), Some(&distro_b));
        assert!(entries.contains(&distro_a));
        assert!(!entries.contains(&project_bin));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn biber_cli_args_target_out_dir_and_entry_stem() {
        let args = biber_cli_args(Path::new("/build"), "_oleafly_entry");
        assert_eq!(
            args,
            [
                "--output-directory",
                "/build",
                "--input-directory",
                "/build",
                "_oleafly_entry"
            ]
        );
    }
}
