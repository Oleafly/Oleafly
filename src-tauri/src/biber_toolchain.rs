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
pub fn compile_path_env() -> std::ffi::OsString {
    let dirs = compile_path_dirs();
    let mut path = std::env::var_os("PATH").unwrap_or_default();
    if dirs.is_empty() {
        return path;
    }
    #[cfg(windows)]
    let sep = std::ffi::OsString::from(";");
    #[cfg(not(windows))]
    let sep = std::ffi::OsString::from(":");

    let mut prefix = std::ffi::OsString::new();
    for (index, dir) in dirs.iter().enumerate() {
        if index > 0 {
            prefix.push(&sep);
        }
        prefix.push(dir.as_os_str());
    }
    if !path.is_empty() {
        prefix.push(&sep);
        prefix.push(&path);
        path = prefix;
    } else {
        path = prefix;
    }
    path
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
    let mut dirs = vec![
        PathBuf::from("/Library/TeX/texbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".oleafly/tinytex/bin"));
        dirs.push(home.join(".TinyTeX/bin"));
        // TinyTeX nests bin/<platform>/
        if let Ok(entries) = std::fs::read_dir(home.join(".oleafly/tinytex")) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.is_dir() {
                    dirs.push(bin.clone());
                    if let Ok(platforms) = std::fs::read_dir(&bin) {
                        for platform in platforms.flatten() {
                            if platform.path().is_dir() {
                                dirs.push(platform.path());
                            }
                        }
                    }
                }
            }
        }
    }
    dirs
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
