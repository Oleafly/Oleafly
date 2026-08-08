//! System TeX distribution discovery.
//!
//! One shared enumeration of TeX binary directories (MacTeX, TeX Live, MiKTeX,
//! managed TinyTeX, user TinyTeX) feeds three consumers: the PATH injected
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
    let mut system = Vec::new();
    let mut managed = Vec::new();
    let mut user_tinytex = Vec::new();
    let mut generic = Vec::new();
    let home = crate::paths::home_dir().ok();

    #[cfg(target_os = "macos")]
    {
        push_existing(&mut system, PathBuf::from("/Library/TeX/texbin"));
        push_texlive_year_bins(&mut system, Path::new("/usr/local/texlive"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_texlive_year_bins(&mut system, Path::new("/usr/local/texlive"));
        push_texlive_year_bins(&mut system, Path::new("/opt/texlive"));
        // Distribution packages (apt, dnf, pacman, ...) normally install TeX
        // into /usr/bin rather than a versioned TeX Live directory. Keep that
        // complete system toolchain ahead of Oleafly's compact TinyTeX.
        push_existing(&mut system, PathBuf::from("/usr/bin"));
    }

    #[cfg(windows)]
    {
        // TeX Live: C:\texlive\<year>\bin\windows (2023+) or bin\win32.
        push_texlive_year_bins(&mut system, Path::new("C:\\texlive"));
        // MiKTeX: per-user install first (the installer default), then machine-wide.
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            push_existing(
                &mut system,
                PathBuf::from(&local).join("Programs\\MiKTeX\\miktex\\bin\\x64"),
            );
        }
        push_existing(
            &mut system,
            PathBuf::from("C:\\Program Files\\MiKTeX\\miktex\\bin\\x64"),
        );
        push_existing(
            &mut system,
            PathBuf::from("C:\\Program Files\\MiKTeX 2.9\\miktex\\bin\\x64"),
        );
    }

    // Oleafly's own TinyTeX (managed install; may nest TinyTeX/bin/<platform>).
    if let Ok(root) = crate::paths::oleafly_root() {
        push_texdir_bins(&mut managed, &root.join("tinytex"));
    }

    // User-managed TinyTeX uses a different documented root on each OS. Keep
    // the legacy ~/.TinyTeX probe as well because existing installations use it.
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let programdata = std::env::var_os("PROGRAMDATA").map(PathBuf::from);
    for root in user_tinytex_roots_for(
        std::env::consts::OS,
        home.as_deref(),
        appdata.as_deref(),
        programdata.as_deref(),
    ) {
        push_texdir_bins(&mut user_tinytex, &root);
    }

    // Generic locations last: these usually hold symlinks into one of the real
    // distributions above.
    #[cfg(target_os = "macos")]
    {
        push_existing(&mut generic, PathBuf::from("/usr/local/bin"));
        push_existing(&mut generic, PathBuf::from("/opt/homebrew/bin"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_existing(&mut generic, PathBuf::from("/usr/local/bin"));
    }

    let inherited = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .filter(|dir| dir.is_dir() && bin_dir_has_tex(dir))
                .collect()
        })
        .unwrap_or_default();
    compose_tex_bin_dirs(system, inherited, managed, user_tinytex, generic)
}

/// Locate a TeX tool (latexmk, lualatex, tlmgr, ...) by probing `tex_bin_dirs`
/// and then the inherited PATH. Pure stat-based: never executes anything, so it
/// is cheap enough to call from every compile-spec preparation.
pub fn find_tex_tool(name: &str) -> Option<PathBuf> {
    find_tex_tool_in_dirs(name, tex_bin_dirs())
}

/// Every existing candidate for a TeX tool in the same priority order used by
/// `find_tex_tool`. Callers that need to execute a probe can continue to the
/// next distribution when an earlier file exists but is not runnable on this
/// host (for example, a stale or wrong-architecture binary).
pub(crate) fn tex_tool_candidates(name: &str) -> Vec<PathBuf> {
    tex_tool_candidates_in_dirs(name, tex_bin_dirs())
}

fn compose_tex_bin_dirs(
    system: Vec<PathBuf>,
    inherited: Vec<PathBuf>,
    managed: Vec<PathBuf>,
    user_tinytex: Vec<PathBuf>,
    generic: Vec<PathBuf>,
) -> Vec<PathBuf> {
    let (inherited_tinytex, inherited_system): (Vec<_>, Vec<_>) = inherited
        .into_iter()
        .partition(|dir| bin_dir_is_tinytex(dir));
    let mut dirs = Vec::new();
    for tier in [
        system,
        inherited_system,
        managed,
        user_tinytex,
        inherited_tinytex,
        generic,
    ] {
        for dir in tier {
            push_existing(&mut dirs, dir);
        }
    }
    dirs
}

fn bin_dir_has_tex(dir: &Path) -> bool {
    ["latexmk", "tlmgr", "pdflatex", "xelatex", "lualatex"]
        .into_iter()
        .any(|tool| dir.join(exe(tool)).is_file())
}

fn bin_dir_is_tinytex(dir: &Path) -> bool {
    if named_tinytex_root(dir).is_some() {
        return true;
    }
    ["latexmk", "tlmgr", "pdflatex", "xelatex", "lualatex"]
        .into_iter()
        .filter_map(|tool| std::fs::canonicalize(dir.join(exe(tool))).ok())
        .any(|tool| named_tinytex_root(&tool).is_some())
}

fn tex_tool_candidates_in_dirs<I, P>(name: &str, dirs: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let file = exe(name);
    let mut candidates = Vec::new();
    for dir in dirs {
        let candidate = dir.as_ref().join(&file);
        if candidate.is_file() && !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn find_tex_tool_in_dirs<I, P>(name: &str, dirs: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let file = exe(name);
    dirs.into_iter()
        .map(|dir| dir.as_ref().join(&file))
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

/// The distribution that owns the exact `latexmk` selected for compilation.
/// Package queries and mutations must resolve through this value as well: using
/// a separately discovered `tlmgr` can inspect or modify a different TeX tree.
pub fn active_latexmk_distribution() -> Option<TexDistribution> {
    let latexmk = find_tex_tool("latexmk")?;
    distribution_for_bin_dir(latexmk.parent()?)
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
        let (_, root) = classify_bin_dir(&dir);
        if seen_roots.iter().any(|r| r == &root) {
            continue;
        }
        let Some(distribution) = distribution_for_bin_dir(&dir) else {
            continue;
        };
        seen_roots.push(root.clone());
        result.push(distribution);
    }
    result
}

fn distribution_for_bin_dir(dir: &Path) -> Option<TexDistribution> {
    let (kind, root) = classify_bin_dir(dir);
    // Generic locations (/usr/local/bin, homebrew, inherited PATH entries) only
    // count as a TeX distribution when a TeX tool is actually present there.
    let latexmk = dir.join(exe("latexmk"));
    let tlmgr = dir.join(exe("tlmgr"));
    let has_tex = latexmk.is_file()
        || tlmgr.is_file()
        || dir.join(exe("pdflatex")).is_file()
        || dir.join(exe("xelatex")).is_file()
        || dir.join(exe("lualatex")).is_file();
    has_tex.then(|| TexDistribution {
        label: label_for(&kind, &root),
        kind,
        bin_dir: dir.to_string_lossy().into_owned(),
        latexmk: latexmk
            .is_file()
            .then(|| latexmk.to_string_lossy().into_owned()),
        tlmgr: tlmgr
            .is_file()
            .then(|| tlmgr.to_string_lossy().into_owned()),
    })
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
    if let Some(root) = named_tinytex_root(dir) {
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

fn user_tinytex_roots_for(
    os: &str,
    home: Option<&Path>,
    appdata: Option<&Path>,
    programdata: Option<&Path>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home {
        roots.push(home.join(".TinyTeX"));
        if os == "macos" {
            roots.push(home.join("Library/TinyTeX"));
        }
    }
    if os == "windows" {
        if let Some(appdata) = appdata {
            roots.push(appdata.join("TinyTeX"));
        }
        if let Some(programdata) = programdata {
            roots.push(programdata.join("TinyTeX"));
        }
    }
    roots.dedup();
    roots
}

fn named_tinytex_root(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().find_map(|ancestor| {
        let name = ancestor.file_name()?.to_string_lossy();
        (name.eq_ignore_ascii_case("TinyTeX") || name.eq_ignore_ascii_case(".TinyTeX"))
            .then(|| ancestor.to_owned())
    })
}

fn platform_dir_rank_for(os: &str, arch: &str, name: &str) -> Option<u8> {
    let lower = name.to_ascii_lowercase();
    let os_matches = match os {
        "macos" => lower.contains("darwin"),
        "linux" => lower.contains("linux"),
        "windows" => lower == "windows" || lower.contains("win32") || lower.contains("mingw"),
        other => lower.contains(other),
    };
    if !os_matches {
        return None;
    }
    if (os == "macos" && lower.contains("universal")) || (os == "windows" && lower == "windows") {
        return Some(0);
    }

    let arch_matches = match arch {
        "x86_64" => ["x86_64", "amd64"]
            .into_iter()
            .any(|alias| lower.contains(alias)),
        "aarch64" => ["aarch64", "arm64"]
            .into_iter()
            .any(|alias| lower.contains(alias)),
        "x86" | "i686" => ["i386", "i686"]
            .into_iter()
            .any(|alias| lower.contains(alias)),
        "arm" => ["armhf", "armv7"]
            .into_iter()
            .any(|alias| lower.contains(alias)),
        other => lower.contains(other),
    };
    if arch_matches {
        return Some(0);
    }

    let names_an_architecture = [
        "x86_64", "amd64", "aarch64", "arm64", "i386", "i686", "armhf", "armv7", "powerpc", "ppc",
    ]
    .into_iter()
    .any(|known| lower.contains(known));
    if names_an_architecture {
        return None;
    }

    // TeX Live's historic `win32` directory is usable on x86/x64 Windows, but
    // it must not outrank the current architecture-neutral `windows` layout.
    if os == "windows" && lower.contains("win32") {
        return matches!(arch, "x86_64" | "x86" | "i686").then_some(1);
    }
    Some(2)
}

fn push_platform_bins_for(dirs: &mut Vec<PathBuf>, bin: &Path, os: &str, arch: &str) {
    let Ok(platforms) = std::fs::read_dir(bin) else {
        return;
    };
    let mut ranked: Vec<(u8, String, PathBuf)> = platforms
        .flatten()
        .filter_map(|platform| {
            let path = platform.path();
            if !path.is_dir() {
                return None;
            }
            let name = platform.file_name().to_string_lossy().into_owned();
            platform_dir_rank_for(os, arch, &name).map(|rank| (rank, name, path))
        })
        .collect();
    ranked.sort_by(|left, right| (left.0, &left.1).cmp(&(right.0, &right.1)));
    for (_, _, path) in ranked {
        push_existing(dirs, path);
    }
}

/// TeX-dir layout: `<root>/bin/<platform>/` (TeX Live, TinyTeX), possibly with
/// one extra nesting level from archive extraction (`<root>/TinyTeX/bin/...`).
fn push_texdir_bins(dirs: &mut Vec<PathBuf>, root: &Path) {
    for bin in texdir_bin_dirs(root) {
        push_existing(dirs, bin);
    }
}

/// Host-compatible `bin/<platform>` directories under a TeX-style root,
/// including the one archive nesting level used by TinyTeX releases.
pub(crate) fn texdir_bin_dirs(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut candidates = vec![root.to_owned()];
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path());
            }
        }
    }
    let mut dirs = Vec::new();
    for candidate in candidates {
        let bin = candidate.join("bin");
        if !bin.is_dir() {
            continue;
        }
        push_platform_bins_for(
            &mut dirs,
            &bin,
            std::env::consts::OS,
            std::env::consts::ARCH,
        );
    }
    dirs
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
        push_platform_bins_for(dirs, &bin, std::env::consts::OS, std::env::consts::ARCH);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "oleafly-texdist-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn create_tool(dir: &Path, name: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(exe(name)), b"test tool").unwrap();
    }

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
        let platform = match std::env::consts::OS {
            "macos" => "universal-darwin",
            "linux" if std::env::consts::ARCH == "aarch64" => "aarch64-linux",
            "linux" => "x86_64-linux",
            "windows" => "windows",
            other => other,
        };
        for year in ["2023", "2025"] {
            std::fs::create_dir_all(root.join(year).join("bin").join(platform)).unwrap();
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
    fn user_tinytex_roots_cover_official_platform_locations() {
        let home = Path::new("/Users/researcher");
        let mac = user_tinytex_roots_for("macos", Some(home), None, None);
        assert!(mac.contains(&home.join(".TinyTeX")));
        assert!(mac.contains(&home.join("Library/TinyTeX")));

        let appdata = Path::new("C:/Users/researcher/AppData/Roaming");
        let programdata = Path::new("C:/ProgramData");
        let windows =
            user_tinytex_roots_for("windows", Some(home), Some(appdata), Some(programdata));
        assert!(windows.contains(&appdata.join("TinyTeX")));
        assert!(windows.contains(&programdata.join("TinyTeX")));

        let linux = user_tinytex_roots_for("linux", Some(home), None, None);
        assert_eq!(linux, vec![home.join(".TinyTeX")]);
    }

    #[test]
    fn official_user_tinytex_paths_are_classified_as_tinytex() {
        for path in [
            "/Users/researcher/Library/TinyTeX/bin/universal-darwin",
            "C:/Users/researcher/AppData/Roaming/TinyTeX/bin/windows",
            "/home/researcher/.TinyTeX/bin/x86_64-linux",
        ] {
            let (kind, root) = classify_bin_dir(Path::new(path));
            assert_eq!(kind, "tinytex");
            assert!(root.file_name().is_some_and(|name| name
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains("tinytex")));
        }
    }

    #[test]
    fn platform_ranking_rejects_wrong_architecture() {
        assert_eq!(
            platform_dir_rank_for("linux", "aarch64", "aarch64-linux"),
            Some(0)
        );
        assert_eq!(
            platform_dir_rank_for("linux", "aarch64", "x86_64-linux"),
            None
        );
        assert_eq!(
            platform_dir_rank_for("linux", "x86_64", "aarch64-linux"),
            None
        );
        assert_eq!(
            platform_dir_rank_for("macos", "aarch64", "universal-darwin"),
            Some(0)
        );
        assert_eq!(
            platform_dir_rank_for("macos", "aarch64", "x86_64-darwin"),
            None
        );
        assert_eq!(
            platform_dir_rank_for("windows", "x86_64", "windows"),
            Some(0)
        );
        assert_eq!(platform_dir_rank_for("windows", "x86_64", "win32"), Some(1));
        assert_eq!(platform_dir_rank_for("windows", "aarch64", "win32"), None);
    }

    #[test]
    fn platform_bin_enumeration_is_deterministic_and_host_specific() {
        let root = test_dir("platforms");
        let bin = root.join("bin");
        for platform in ["x86_64-linux", "aarch64-linux", "universal-darwin"] {
            std::fs::create_dir_all(bin.join(platform)).unwrap();
        }
        let mut dirs = Vec::new();
        push_platform_bins_for(&mut dirs, &bin, "linux", "aarch64");
        assert_eq!(dirs, vec![bin.join("aarch64-linux")]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tex_bin_dirs_never_duplicates() {
        let dirs = tex_bin_dirs();
        for (index, dir) in dirs.iter().enumerate() {
            assert!(!dirs[index + 1..].contains(dir), "duplicate {dir:?}");
        }
    }

    #[test]
    fn tool_lookup_respects_distribution_priority() {
        let root = test_dir("priority");
        let system = root.join("system/bin");
        let managed = root.join("managed/bin");
        create_tool(&system, "latexmk");
        create_tool(&managed, "latexmk");

        let candidates = tex_tool_candidates_in_dirs("latexmk", [&system, &managed]);
        assert_eq!(
            candidates,
            vec![system.join(exe("latexmk")), managed.join(exe("latexmk"))]
        );
        assert_eq!(
            find_tex_tool_in_dirs("latexmk", [&system, &managed]),
            candidates.first().cloned()
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_unusual_system_path_outranks_managed_tinytex() {
        let root = test_dir("inherited-priority");
        let inherited_system = root.join("custom-system/bin");
        let managed = root.join(".oleafly/tinytex/bin/host");
        create_tool(&inherited_system, "latexmk");
        create_tool(&managed, "latexmk");

        let dirs = compose_tex_bin_dirs(
            Vec::new(),
            vec![inherited_system.clone()],
            vec![managed.clone()],
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(dirs, vec![inherited_system, managed]);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_path_symlink_into_tinytex_stays_in_the_tinytex_tier() {
        let root = test_dir("symlink-priority");
        let system = root.join("custom-system/bin");
        let tinytex = root.join("TinyTeX/bin/host");
        let inherited_wrapper = root.join("wrapper/bin");
        create_tool(&system, "latexmk");
        create_tool(&tinytex, "latexmk");
        std::fs::create_dir_all(&inherited_wrapper).unwrap();
        std::os::unix::fs::symlink(
            tinytex.join(exe("latexmk")),
            inherited_wrapper.join(exe("latexmk")),
        )
        .unwrap();

        let dirs = compose_tex_bin_dirs(
            vec![system.clone()],
            vec![inherited_wrapper.clone()],
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(dirs, vec![system, inherited_wrapper]);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn distribution_does_not_borrow_tlmgr_from_another_bin_dir() {
        let root = test_dir("siblings");
        let active = root.join("system/bin");
        let inactive = root.join("managed/bin");
        create_tool(&active, "latexmk");
        create_tool(&inactive, "tlmgr");

        let distribution = distribution_for_bin_dir(&active).unwrap();
        let expected_latexmk = active.join(exe("latexmk")).to_string_lossy().into_owned();
        assert_eq!(
            distribution.latexmk.as_deref(),
            Some(expected_latexmk.as_str())
        );
        assert_eq!(distribution.tlmgr, None);

        std::fs::remove_dir_all(root).unwrap();
    }
}
