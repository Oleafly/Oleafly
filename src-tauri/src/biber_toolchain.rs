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

pub fn tool_path_env(preferred_executable: &Path) -> std::ffi::OsString {
    compile_path_env_with_inherited(
        std::env::var_os("PATH").as_deref(),
        preferred_executable.parent(),
        None,
    )
}

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

/// Identity of the .bbl on disk: enough to tell whether a compile rewrote it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BblStamp {
    modified: Option<std::time::SystemTime>,
    len: u64,
}

pub fn bbl_stamp(out_dir: &Path, entry_stem: &str) -> Option<BblStamp> {
    let bbl = out_dir.join(format!("{entry_stem}.bbl"));
    let meta = std::fs::metadata(&bbl).ok()?;
    Some(BblStamp {
        modified: meta.modified().ok(),
        len: meta.len(),
    })
}

/// True when this compile produced the .bbl: either its stamp differs from the
/// one taken before the run, or the .blg (cleared before every compile) says
/// Biber wrote it. Filesystems with two-second timestamps can leave a rewritten
/// .bbl with an unchanged stamp, which is what the .blg evidence covers.
pub fn bbl_refreshed(out_dir: &Path, entry_stem: &str, before: Option<BblStamp>) -> bool {
    match bbl_stamp(out_dir, entry_stem) {
        Some(after) => {
            after.len > 0 && (Some(after) != before || biber_wrote_bbl(out_dir, entry_stem))
        }
        None => false,
    }
}

fn biber_wrote_bbl(out_dir: &Path, entry_stem: &str) -> bool {
    let Ok(log) = std::fs::read_to_string(out_dir.join(format!("{entry_stem}.blg"))) else {
        return false;
    };
    let marker = format!("INFO - Output to {entry_stem}.bbl");
    log.lines()
        .map(strip_biber_log_prefix)
        .any(|line| line.trim_end_matches('\r') == marker)
}

/// Keep only Biber's warning and error lines for the user-facing log. The
/// .blg file prefixes every line with `[ms] Module.pm:line> `; console output
/// does not.
pub fn biber_message_excerpt(log: &str) -> String {
    let mut excerpt = String::new();
    for line in log
        .lines()
        .map(strip_biber_log_prefix)
        .filter(|line| line.starts_with("WARN - ") || line.starts_with("ERROR - "))
        .take(40)
    {
        excerpt.push_str(line.trim_end_matches('\r'));
        excerpt.push('\n');
    }
    excerpt
}

fn strip_biber_log_prefix(line: &str) -> &str {
    let rest = line.strip_prefix('[').unwrap_or(line);
    if rest.len() == line.len() {
        return line;
    }
    let Some(close) = rest.find("] ") else {
        return line;
    };
    if !rest[..close].bytes().all(|byte| byte.is_ascii_digit()) {
        return line;
    }
    let after = &rest[close + 2..];
    match after.find("> ") {
        Some(marker) if !after[..marker].contains(' ') => &after[marker + 2..],
        _ => line,
    }
}

/// Classify a failed or incomplete Biber step for the user-facing log.
pub fn diagnose_biber_gap(log: &str, biber: Option<&Path>) -> String {
    let mut message = String::from(
        "\n[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.\n",
    );
    if let Some(file) = missing_data_source(log) {
        message.push_str(&format!(
            "[Oleafly] Biber could not find the bibliography file {file} (mode C). Check the name \
in \\addbibresource or \\bibliography; Oleafly resolves it from the project root.\n"
        ));
    } else if log.contains("versions are incompatible") || log.contains("control file version") {
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

fn missing_data_source(log: &str) -> Option<&str> {
    let start = log.find("ERROR - Cannot find '")? + "ERROR - Cannot find '".len();
    let rest = &log[start..];
    let end = rest.find('\'')?;
    Some(&rest[..end])
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

pub(crate) fn host_triple_guess() -> Option<&'static str> {
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
        let directory = tempfile::tempdir().unwrap();
        let absolute = directory.path().to_owned();
        let inherited = std::env::join_paths([PathBuf::from("."), absolute.clone()]).unwrap();
        let hardened = compile_path_env_with_inherited(Some(&inherited), None, None);
        let entries: Vec<_> = std::env::split_paths(&hardened).collect();
        assert!(entries.iter().all(|entry| entry.is_absolute()));
        assert!(entries.contains(&absolute));
        assert!(!entries.contains(&PathBuf::from(".")));
    }

    #[test]
    fn compiler_path_prefers_selected_distribution_and_excludes_project() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
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

    const FULL_BBL: &str = "% $ biblatex auxiliary file $\n\\refsection{0}\n\\datalist[entry]{none/global//global/global}\n\\entry{miles2004laddering}{article}{}\n\\enddatalist\n\\endrefsection\n\\endinput\n";

    #[test]
    fn bbl_refreshed_compares_against_the_stamp_taken_before_the_compile() {
        let dir = scratch_dir("stamp");
        assert!(bbl_stamp(&dir, "main").is_none());
        assert!(!bbl_refreshed(&dir, "main", None));
        std::fs::write(dir.join("main.bbl"), b"").unwrap();
        assert!(!bbl_refreshed(&dir, "main", None));
        std::fs::write(dir.join("main.bbl"), FULL_BBL).unwrap();
        assert!(bbl_refreshed(&dir, "main", None));
        let before = bbl_stamp(&dir, "main");
        assert!(!bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.bbl"),
            format!(
                "{FULL_BBL}
"
            ),
        )
        .unwrap();
        assert!(bbl_refreshed(&dir, "main", before));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_fresh_biber_log_proves_the_bbl_was_written_even_with_an_unchanged_stamp() {
        let dir = scratch_dir("blg-evidence");
        std::fs::write(dir.join("main.bbl"), FULL_BBL).unwrap();
        let before = bbl_stamp(&dir, "main");
        assert!(!bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.blg"),
            "[0] Config.pm:310> INFO - Logfile is 'main.blg'\r\n[118] bbl.pm:654> INFO - Writing 'main.bbl' with encoding 'UTF-8'\r\n[118] bbl.pm:757> INFO - Output to main.bbl\r\n",
        )
        .unwrap();
        assert!(bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.blg"),
            "[0] Config.pm:310> INFO - Logfile is 'main.blg'\nERROR - Cannot find 'refs.bib'!\n",
        )
        .unwrap();
        assert!(!bbl_refreshed(&dir, "main", before));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diagnose_mode_c_when_biber_cannot_find_the_bib_file() {
        let msg = diagnose_biber_gap(
            "INFO - Reading '_oleafly_entry.bcf'\nERROR - Cannot find 'references.bib'!",
            Some(Path::new("/app/tectonic-biber")),
        );
        assert!(msg.contains("mode C"));
        assert!(msg.contains("references.bib"));
        assert!(msg.contains("addbibresource"));
    }

    #[test]
    fn biber_message_excerpt_keeps_errors_and_warnings_only() {
        let excerpt = biber_message_excerpt(
            "[0] Config.pm:307> INFO - This is Biber 2.17\r\n[122] Biber.pm:130> WARN - I didn't find a database entry for 'x' (section 0)\r\nINFO - Writing 'main.bbl'\nERROR - Cannot find 'refs.bib'!\n",
        );
        assert_eq!(
            excerpt,
            "WARN - I didn't find a database entry for 'x' (section 0)\nERROR - Cannot find 'refs.bib'!\n"
        );
        assert_eq!(biber_message_excerpt("INFO - fine\n"), "");
    }
}
