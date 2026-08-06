//! System TeX distribution discovery.
//!
//! One shared enumeration of TeX binary directories (managed TinyTeX, MacTeX,
//! TeX Live, MiKTeX, user TinyTeX) feeds three consumers: the PATH injected
//! into compile children (`biber_toolchain`), the latexmk engine's tool
//! lookup (`document_engine`), and the tagged-export engine probe
//! (`latex_engine`). GUI apps launch with a minimal PATH, so relying on the
//! inherited environment alone misses most real installs.

use std::path::{Path, PathBuf};

/// Append the platform executable suffix.
pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// TeX binary directories to probe, best-first: full system installs (MacTeX,
/// TeX Live by year, MiKTeX), then Oleafly's managed TinyTeX, then generic
/// locations. A complete system distribution must outrank the compact TinyTeX:
/// installing TinyTeX next to a full TeX Live used to silently downgrade every
/// latexmk compile to the smaller package set and break previously working
/// projects. Only existing directories are returned.
pub fn tex_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = crate::paths::home_dir().ok();

    #[cfg(target_os = "macos")]
    {
        push_existing(&mut dirs, PathBuf::from("/Library/TeX/texbin"));
        push_texlive_year_bins(&mut dirs, Path::new("/usr/local/texlive"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_texlive_year_bins(&mut dirs, Path::new("/usr/local/texlive"));
        push_texlive_year_bins(&mut dirs, Path::new("/opt/texlive"));
    }

    #[cfg(windows)]
    {
        // TeX Live: C:\texlive\<year>\bin\windows (2023+) or bin\win32.
        push_texlive_year_bins(&mut dirs, Path::new("C:\\texlive"));
        // MiKTeX: per-user install first (the installer default), then machine-wide.
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            push_existing(
                &mut dirs,
                PathBuf::from(&local).join("Programs\\MiKTeX\\miktex\\bin\\x64"),
            );
        }
        push_existing(
            &mut dirs,
            PathBuf::from("C:\\Program Files\\MiKTeX\\miktex\\bin\\x64"),
        );
        push_existing(
            &mut dirs,
            PathBuf::from("C:\\Program Files\\MiKTeX 2.9\\miktex\\bin\\x64"),
        );
    }

    // Oleafly's own TinyTeX (managed install; may nest TinyTeX/bin/<platform>).
    if let Ok(root) = crate::paths::oleafly_root() {
        push_texdir_bins(&mut dirs, &root.join("tinytex"));
    }

    // A user-installed TinyTeX in the home directory (any platform).
    if let Some(home) = &home {
        push_texdir_bins(&mut dirs, &home.join(".TinyTeX"));
    }

    // Generic locations last: these usually hold symlinks into one of the real
    // distributions above.
    #[cfg(target_os = "macos")]
    {
        push_existing(&mut dirs, PathBuf::from("/usr/local/bin"));
        push_existing(&mut dirs, PathBuf::from("/opt/homebrew/bin"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_existing(&mut dirs, PathBuf::from("/usr/local/bin"));
        push_existing(&mut dirs, PathBuf::from("/usr/bin"));
    }

    dirs
}

/// Locate a TeX tool (latexmk, lualatex, tlmgr, ...) by probing `tex_bin_dirs`
/// and then the inherited PATH. Pure stat-based: never executes anything, so it
/// is cheap enough to call from every compile-spec preparation.
pub fn find_tex_tool(name: &str) -> Option<PathBuf> {
    let file = exe(name);
    for dir in tex_bin_dirs() {
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Fall back to the inherited PATH (covers package-manager installs in
    // unusual prefixes when the app is launched from a shell).
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(&file))
        .find(|candidate| candidate.is_file())
}

/// One detected TeX distribution, for the Settings "Manage TeX distributions"
/// panel and the engine-picker modal.
#[derive(Clone, serde::Serialize)]
pub struct TexDistribution {
    /// "oleafly-tinytex" | "mactex" | "texlive" | "miktex" | "tinytex" | "other"
    pub kind: String,
    pub label: String,
    pub bin_dir: String,
    pub latexmk: Option<String>,
    pub tlmgr: Option<String>,
}

/// Detected TeX distributions for the Settings panel and the engine-picker
/// modal. Stat-only (no process spawns), but still off the main thread since
/// it walks several directories.
#[tauri::command]
pub async fn tex_distributions() -> Vec<TexDistribution> {
    tauri::async_runtime::spawn_blocking(list_distributions)
        .await
        .unwrap_or_default()
}

/// Enumerate distinct TeX distributions by classifying each discovered bin dir.
/// Only the first bin dir of each root is reported so one install does not show
/// up once per nested platform directory.
pub fn list_distributions() -> Vec<TexDistribution> {
    let mut seen_roots: Vec<PathBuf> = Vec::new();
    let mut result = Vec::new();
    for dir in tex_bin_dirs() {
        let (kind, root) = classify_bin_dir(&dir);
        if seen_roots.iter().any(|r| r == &root) {
            continue;
        }
        // Generic locations (/usr/local/bin, homebrew) only count as a TeX
        // distribution when a TeX tool is actually present there.
        let latexmk = dir.join(exe("latexmk"));
        let tlmgr = dir.join(exe("tlmgr"));
        let has_tex = latexmk.is_file()
            || tlmgr.is_file()
            || dir.join(exe("pdflatex")).is_file()
            || dir.join(exe("xelatex")).is_file()
            || dir.join(exe("lualatex")).is_file();
        if !has_tex {
            continue;
        }
        seen_roots.push(root.clone());
        result.push(TexDistribution {
            label: label_for(&kind, &root),
            kind,
            bin_dir: dir.to_string_lossy().into_owned(),
            latexmk: latexmk
                .is_file()
                .then(|| latexmk.to_string_lossy().into_owned()),
            tlmgr: tlmgr
                .is_file()
                .then(|| tlmgr.to_string_lossy().into_owned()),
        });
    }
    result
}

fn classify_bin_dir(dir: &Path) -> (String, PathBuf) {
    let text = dir.to_string_lossy().replace('\\', "/");
    let lower = text.to_ascii_lowercase();
    if lower.contains("/.oleafly/tinytex") || lower.contains("oleafly") && lower.contains("tinytex")
    {
        let root = crate::paths::oleafly_root()
            .map(|r| r.join("tinytex"))
            .unwrap_or_else(|_| dir.to_owned());
        return ("oleafly-tinytex".into(), root);
    }
    if lower.contains("/.tinytex") {
        let root = crate::paths::home_dir()
            .map(|h| h.join(".TinyTeX"))
            .unwrap_or_else(|_| dir.to_owned());
        return ("tinytex".into(), root);
    }
    if lower.starts_with("/library/tex") {
        return ("mactex".into(), PathBuf::from("/Library/TeX/texbin"));
    }
    if lower.contains("miktex") {
        return ("miktex".into(), dir.to_owned());
    }
    if lower.contains("texlive") {
        // Root at the year directory: /usr/local/texlive/2025 or C:\texlive\2025.
        let mut root = dir.to_owned();
        while let Some(parent) = root.parent() {
            let name = root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.len() == 4 && name.chars().all(|c| c.is_ascii_digit()) {
                break;
            }
            root = parent.to_owned();
            if root.parent().is_none() {
                break;
            }
        }
        return ("texlive".into(), root);
    }
    ("other".into(), dir.to_owned())
}

fn label_for(kind: &str, root: &Path) -> String {
    match kind {
        "oleafly-tinytex" => "TinyTeX (managed by Oleafly)".into(),
        "tinytex" => "TinyTeX".into(),
        "mactex" => "MacTeX / TeX Live".into(),
        "miktex" => "MiKTeX".into(),
        "texlive" => {
            let year = root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if year.chars().all(|c| c.is_ascii_digit()) && !year.is_empty() {
                format!("TeX Live {year}")
            } else {
                "TeX Live".into()
            }
        }
        _ => format!("TeX tools in {}", root.display()),
    }
}

fn push_existing(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if dir.is_dir() && !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

/// TeX-dir layout: `<root>/bin/<platform>/` (TeX Live, TinyTeX), possibly with
/// one extra nesting level from archive extraction (`<root>/TinyTeX/bin/...`).
fn push_texdir_bins(dirs: &mut Vec<PathBuf>, root: &Path) {
    if !root.is_dir() {
        return;
    }
    let mut candidates = vec![root.to_owned()];
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path());
            }
        }
    }
    for candidate in candidates {
        let bin = candidate.join("bin");
        if !bin.is_dir() {
            continue;
        }
        if let Ok(platforms) = std::fs::read_dir(&bin) {
            for platform in platforms.flatten() {
                if platform.path().is_dir() {
                    push_existing(dirs, platform.path());
                }
            }
        }
    }
}

/// TeX Live installs under `<root>/<year>/bin/<platform>/`; probe years
/// newest-first so a machine with several TeX Live releases prefers the latest.
fn push_texlive_year_bins(dirs: &mut Vec<PathBuf>, root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut years: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.len() == 4 && name.chars().all(|c| c.is_ascii_digit()))
        })
        .collect();
    years.sort();
    years.reverse();
    for year in years {
        let bin = year.join("bin");
        if let Ok(platforms) = std::fs::read_dir(&bin) {
            for platform in platforms.flatten() {
                if platform.path().is_dir() {
                    push_existing(dirs, platform.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_appends_suffix_only_on_windows() {
        if cfg!(windows) {
            assert_eq!(exe("latexmk"), "latexmk.exe");
        } else {
            assert_eq!(exe("latexmk"), "latexmk");
        }
    }

    #[test]
    fn texlive_year_bins_prefer_newest() {
        let root = std::env::temp_dir().join(format!("oleafly-texdist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for year in ["2023", "2025"] {
            std::fs::create_dir_all(root.join(year).join("bin/x86_64-test")).unwrap();
        }
        std::fs::create_dir_all(root.join("texmf")).unwrap();
        let mut dirs = Vec::new();
        push_texlive_year_bins(&mut dirs, &root);
        assert_eq!(dirs.len(), 2);
        assert!(dirs[0].to_string_lossy().contains("2025"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn classify_recognizes_texlive_year_root() {
        let (kind, root) =
            classify_bin_dir(Path::new("/usr/local/texlive/2025/bin/universal-darwin"));
        assert_eq!(kind, "texlive");
        assert!(root.to_string_lossy().ends_with("2025"));
    }

    #[test]
    fn tex_bin_dirs_never_duplicates() {
        let dirs = tex_bin_dirs();
        for (index, dir) in dirs.iter().enumerate() {
            assert!(!dirs[index + 1..].contains(dir), "duplicate {dir:?}");
        }
    }
}
