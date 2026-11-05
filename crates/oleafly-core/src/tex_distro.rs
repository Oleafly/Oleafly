//! TeX distribution discovery, shared by the desktop app and the CLI.
//!
//! Every input that depends on the machine (home folder, Oleafly's data
//! folder, `PATH` and the Windows profile folders) comes in through
//! [`TexSearch`], so both runtimes rank distributions the same way and tests
//! can describe a machine without touching the environment. GUI apps launch
//! with a minimal PATH, so relying on the inherited environment alone misses
//! most real installs.

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::TexFlavor;

#[derive(Clone, Debug, Default)]
pub struct TexSearch {
    pub home: Option<PathBuf>,
    pub data_root: Option<PathBuf>,
    pub path: Option<OsString>,
    pub local_app_data: Option<PathBuf>,
    pub app_data: Option<PathBuf>,
    pub program_data: Option<PathBuf>,
    pub preferred_bin_dir: Option<PathBuf>,
    pub relocated_parent_refused: bool,
}

fn is_ascii_path(path: &Path) -> bool {
    path.to_str().is_some_and(str::is_ascii)
}

pub fn managed_tinytex_parent_for(
    os: &str,
    data_root: Option<&Path>,
    program_data: Option<&Path>,
) -> Option<PathBuf> {
    use sha2::Digest as _;
    let data_root = data_root?;
    if os != "windows" || is_ascii_path(data_root) {
        return Some(data_root.to_owned());
    }
    let program_data = program_data.filter(|path| is_ascii_path(path))?;
    let digest = sha2::Sha256::digest(data_root.to_string_lossy().as_bytes());
    let key: String = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Some(program_data.join(format!("Oleafly-{key}")))
}

impl TexSearch {
    pub fn managed_tinytex_parent(&self) -> Option<PathBuf> {
        if self.relocated_parent_refused {
            return None;
        }
        managed_tinytex_parent_for(
            std::env::consts::OS,
            self.data_root.as_deref(),
            self.program_data.as_deref(),
        )
    }

    pub fn refusing_foreign_parent(self, owned: impl Fn(&Path) -> bool) -> Self {
        self.refusing_foreign_parent_on(std::env::consts::OS, owned)
    }

    fn refusing_foreign_parent_on(mut self, os: &str, owned: impl Fn(&Path) -> bool) -> Self {
        let relocated =
            managed_tinytex_parent_for(os, self.data_root.as_deref(), self.program_data.as_deref())
                .filter(|parent| self.data_root.as_deref() != Some(parent.as_path()));
        let Some(parent) = relocated else {
            return self;
        };
        let missing = std::fs::symlink_metadata(&parent)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound);
        if missing || owned(&parent) {
            return self;
        }
        self.relocated_parent_refused = true;
        self.preferred_bin_dir = self
            .preferred_bin_dir
            .filter(|dir| !dir.starts_with(&parent));
        self
    }

    pub fn managed_tinytex_root(&self) -> Option<PathBuf> {
        self.managed_tinytex_parent()
            .map(|parent| parent.join("tinytex"))
    }

    pub fn managed_tinytex_roots(&self) -> Vec<PathBuf> {
        let mut roots: Vec<PathBuf> = self.managed_tinytex_root().into_iter().collect();
        if let Some(data_root) = &self.data_root {
            let beside_data = data_root.join("tinytex");
            if !roots.contains(&beside_data) {
                roots.push(beside_data);
            }
        }
        roots
    }

    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        let home = var("HOME")
            .or_else(|| var("USERPROFILE"))
            .map(PathBuf::from);
        let data_root = var("OLEAFLY_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|home| home.join(".oleafly")));
        Self {
            home,
            data_root,
            path: var("PATH"),
            local_app_data: var("LOCALAPPDATA").map(PathBuf::from),
            app_data: var("APPDATA").map(PathBuf::from),
            program_data: var("PROGRAMDATA").map(PathBuf::from),
            preferred_bin_dir: None,
            relocated_parent_refused: false,
        }
    }
}

pub fn host_platform_dirs() -> &'static [&'static str] {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => &["universal-darwin", "aarch64-darwin"],
        ("macos", _) => &["universal-darwin", "x86_64-darwin"],
        ("linux", "aarch64") => &["aarch64-linux"],
        ("linux", "x86" | "i686") => &["i386-linux"],
        ("linux", _) => &["x86_64-linux"],
        ("windows", _) => &["windows", "win32"],
        _ => &[],
    }
}

pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// File names a TeX tool may resolve to, best-first. TeX Live on Windows
/// ships most tools as `.exe` wrappers but installs `tlmgr` as `tlmgr.bat`,
/// so `.exe`-only lookups miss it and TinyTeX validation fails with "no
/// host-compatible tlmgr binary".
fn tool_file_names(name: &str) -> Vec<String> {
    tool_file_names_for(cfg!(windows), name)
}

fn tool_file_names_for(windows: bool, name: &str) -> Vec<String> {
    if windows {
        vec![format!("{name}.exe"), format!("{name}.bat")]
    } else {
        vec![name.to_string()]
    }
}

pub fn find_tool_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    tool_file_names(name)
        .into_iter()
        .map(|file| dir.join(file))
        .find(|candidate| candidate.is_file())
}

/// TeX binary directories to probe, best-first: full system installs (MacTeX,
/// TeX Live by year, MiKTeX), then Oleafly's managed TinyTeX, then generic
/// locations. A complete system distribution must outrank the compact TinyTeX:
/// installing TinyTeX next to a full TeX Live used to silently downgrade every
/// latexmk compile to the smaller package set and break previously working
/// projects. Only existing directories are returned.
pub fn tex_bin_dirs(search: &TexSearch) -> Vec<PathBuf> {
    let mut system = Vec::new();
    let mut managed = Vec::new();
    let mut user_tinytex = Vec::new();
    #[cfg(not(windows))]
    let mut generic = Vec::new();
    #[cfg(windows)]
    let generic = Vec::new();
    let home = search.home.clone();

    #[cfg(target_os = "macos")]
    {
        push_existing(&mut system, PathBuf::from("/Library/TeX/texbin"));
        push_texlive_year_bins(&mut system, Path::new("/usr/local/texlive"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_texlive_year_bins(&mut system, Path::new("/usr/local/texlive"));
        push_texlive_year_bins(&mut system, Path::new("/opt/texlive"));
    }

    #[cfg(unix)]
    if let Some(home) = &home {
        push_texlive_year_bins(&mut system, &home.join("texlive"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_existing(&mut system, PathBuf::from("/usr/bin"));
    }

    #[cfg(windows)]
    {
        // TeX Live: C:\texlive\<year>\bin\windows (2023+) or bin\win32.
        push_texlive_year_bins(&mut system, Path::new("C:\\texlive"));
        // MiKTeX: per-user install first (the installer default), then machine-wide.
        if let Some(local) = &search.local_app_data {
            push_existing(
                &mut system,
                local.join("Programs\\MiKTeX\\miktex\\bin\\x64"),
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

    for root in search.managed_tinytex_roots() {
        push_texdir_bins(&mut managed, &root);
    }

    for root in user_tinytex_roots_for(
        std::env::consts::OS,
        home.as_deref(),
        search.app_data.as_deref(),
        search.program_data.as_deref(),
    ) {
        push_texdir_bins(&mut user_tinytex, &root);
    }

    #[cfg(target_os = "macos")]
    {
        push_existing(&mut generic, PathBuf::from("/usr/local/bin"));
        push_existing(&mut generic, PathBuf::from("/opt/homebrew/bin"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        push_existing(&mut generic, PathBuf::from("/usr/local/bin"));
    }

    let inherited = search
        .path
        .as_ref()
        .map(|path| {
            std::env::split_paths(path)
                .filter(|dir| dir.is_dir() && bin_dir_has_tex(dir))
                .collect()
        })
        .unwrap_or_default();
    prefer_bin_dir(
        demote_perlless_miktex(
            search,
            compose_tex_bin_dirs(system, inherited, managed, user_tinytex, generic),
        ),
        search.preferred_bin_dir.as_deref(),
    )
}

fn prefer_bin_dir(mut dirs: Vec<PathBuf>, preferred: Option<&Path>) -> Vec<PathBuf> {
    let Some(preferred) = preferred.filter(|dir| dir.is_dir() && bin_dir_has_tex(dir)) else {
        return dirs;
    };
    dirs.retain(|dir| dir != preferred);
    dirs.insert(0, preferred.to_owned());
    dirs
}

pub fn find_tex_tool(search: &TexSearch, name: &str) -> Option<PathBuf> {
    find_tex_tool_in_dirs(name, tex_bin_dirs(search))
}

pub fn tex_tool_candidates(search: &TexSearch, name: &str) -> Vec<PathBuf> {
    tex_tool_candidates_in_dirs(name, tex_bin_dirs(search))
}

pub fn tool_on_path(path_env: &OsStr, name: &str) -> bool {
    std::env::split_paths(path_env)
        .any(|dir| dir.is_absolute() && find_tool_in_dir(&dir, name).is_some())
}

fn script_engine_file_names(windows: bool, name: &str) -> Vec<String> {
    if windows {
        ["com", "exe", "cmd", "bat"]
            .into_iter()
            .map(|extension| format!("{name}.{extension}"))
            .collect()
    } else {
        vec![name.to_string()]
    }
}

pub fn find_perl(search: &TexSearch) -> Option<PathBuf> {
    let names = script_engine_file_names(cfg!(windows), "perl");
    std::env::split_paths(search.path.as_deref()?)
        .filter(|dir| dir.is_absolute())
        .find_map(|dir| {
            names
                .iter()
                .map(|name| dir.join(name))
                .find(|candidate| candidate.is_file())
        })
}

pub fn latexmk_needs_perl(search: &TexSearch, latexmk: &Path) -> bool {
    distribution_kind_for_tool(search, latexmk) == "miktex" && find_perl(search).is_none()
}

fn demote_perlless_miktex(search: &TexSearch, dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let is_miktex = |dir: &PathBuf| classify_bin_dir(search, dir).0 == "miktex";
    if !dirs.iter().any(is_miktex) || find_perl(search).is_some() {
        return dirs;
    }
    let (blocked, usable): (Vec<_>, Vec<_>) = dirs.into_iter().partition(is_miktex);
    usable.into_iter().chain(blocked).collect()
}

fn compose_tex_bin_dirs(
    system: Vec<PathBuf>,
    inherited: Vec<PathBuf>,
    managed: Vec<PathBuf>,
    user_tinytex: Vec<PathBuf>,
    generic: Vec<PathBuf>,
) -> Vec<PathBuf> {
    let (complete_system, incomplete_system): (Vec<_>, Vec<_>) = system
        .into_iter()
        .partition(|dir| bin_dir_has_complete_tex(dir));
    let (inherited_tinytex, inherited_system): (Vec<_>, Vec<_>) = inherited
        .into_iter()
        .partition(|dir| bin_dir_is_tinytex(dir));
    let (complete_inherited_system, incomplete_inherited_system): (Vec<_>, Vec<_>) =
        inherited_system
            .into_iter()
            .partition(|dir| bin_dir_has_complete_tex(dir));
    let (complete_generic, incomplete_generic): (Vec<_>, Vec<_>) = generic
        .into_iter()
        .partition(|dir| bin_dir_has_complete_tex(dir));
    let mut dirs = Vec::new();
    for tier in [
        complete_system,
        complete_inherited_system,
        complete_generic,
        managed,
        user_tinytex,
        inherited_tinytex,
        incomplete_system,
        incomplete_inherited_system,
        incomplete_generic,
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
        .any(|tool| find_tool_in_dir(dir, tool).is_some())
}

fn bin_dir_has_complete_tex(dir: &Path) -> bool {
    [
        "latexmk",
        "pdflatex",
        "xelatex",
        "lualatex",
        "kpsewhich",
        "biber",
    ]
    .into_iter()
    .all(|tool| find_tool_in_dir(dir, tool).is_some())
}

fn bin_dir_is_tinytex(dir: &Path) -> bool {
    if named_tinytex_root(dir).is_some() {
        return true;
    }
    ["latexmk", "tlmgr", "pdflatex", "xelatex", "lualatex"]
        .into_iter()
        .filter_map(|tool| find_tool_in_dir(dir, tool))
        .filter_map(|tool| std::fs::canonicalize(tool).ok())
        .any(|tool| named_tinytex_root(&tool).is_some())
}

fn tex_tool_candidates_in_dirs<I, P>(name: &str, dirs: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let mut candidates = Vec::new();
    for dir in dirs {
        let Some(candidate) = find_tool_in_dir(dir.as_ref(), name) else {
            continue;
        };
        if !candidates.contains(&candidate) {
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
    dirs.into_iter()
        .find_map(|dir| find_tool_in_dir(dir.as_ref(), name))
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct TexDistribution {
    pub kind: String,
    pub label: String,
    pub bin_dir: String,
    pub latexmk: Option<String>,
    pub tlmgr: Option<String>,
    pub system_package_manager: Option<String>,
    pub complete: bool,
    pub needs_perl: bool,
    pub active: bool,
    pub preferred: bool,
}

pub fn distribution_kind_for_tool(search: &TexSearch, tool: &Path) -> String {
    tool.parent()
        .map(|dir| classify_bin_dir(search, dir).0)
        .unwrap_or_else(|| "other".into())
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct TexBlocker {
    pub code: &'static str,
    pub params: BTreeMap<String, String>,
}

impl TexBlocker {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
        }
    }

    fn param(mut self, name: &str, value: impl Into<String>) -> Self {
        self.params.insert(name.to_string(), value.into());
        self
    }

    fn with_command(
        code: &'static str,
        command_code: &'static str,
        command: Option<String>,
    ) -> Self {
        match command {
            Some(command) => Self::new(command_code).param("command", command),
            None => Self::new(code),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TexPackage {
    Latexmk,
    Pdflatex,
    Xelatex,
    Lualatex,
    Japanese,
    Biber,
}

struct PackageNames {
    tlmgr: &'static str,
    apt: &'static str,
    dnf: &'static str,
    pacman: &'static str,
}

impl TexPackage {
    fn for_flavor(flavor: TexFlavor) -> Self {
        match flavor {
            TexFlavor::Pdflatex => Self::Pdflatex,
            TexFlavor::Xelatex => Self::Xelatex,
            TexFlavor::Lualatex => Self::Lualatex,
            TexFlavor::Uplatex | TexFlavor::Platex => Self::Japanese,
        }
    }

    fn names(self) -> PackageNames {
        let (tlmgr, apt, dnf, pacman) = match self {
            Self::Latexmk => ("latexmk", "latexmk", "latexmk", "texlive-binextra"),
            Self::Pdflatex | Self::Lualatex => (
                "latex-bin",
                "texlive-latex-base",
                "texlive-latex",
                "texlive-latex",
            ),
            Self::Xelatex => ("xetex", "texlive-xetex", "texlive-xetex", "texlive-xetex"),
            Self::Japanese => (
                "collection-langjapanese",
                "texlive-lang-japanese",
                "texlive-collection-langjapanese",
                "texlive-langjapanese",
            ),
            Self::Biber => ("biber", "biber", "biber", "biber"),
        };
        PackageNames {
            tlmgr,
            apt,
            dnf,
            pacman,
        }
    }
}

fn linux_install_command(names: &PackageNames, os_release: &str) -> Option<String> {
    let ids: Vec<&str> = os_release
        .lines()
        .filter_map(|line| {
            line.strip_prefix("ID=")
                .or_else(|| line.strip_prefix("ID_LIKE="))
        })
        .flat_map(|value| value.trim().trim_matches(['"', '\'']).split_whitespace())
        .collect();
    let family = |members: &[&str]| ids.iter().any(|id| members.contains(id));
    if family(&["debian", "ubuntu"]) {
        Some(format!("sudo apt install {}", names.apt))
    } else if family(&["fedora", "rhel", "centos"]) {
        Some(format!("sudo dnf install {}", names.dnf))
    } else if family(&["arch"]) {
        Some(format!("sudo pacman -S {}", names.pacman))
    } else {
        None
    }
}

pub fn install_command_for(
    package: TexPackage,
    kind: &str,
    os: &str,
    os_release: &str,
) -> Option<String> {
    let names = package.names();
    match kind {
        "mactex" => Some(format!("sudo tlmgr install {}", names.tlmgr)),
        "texlive" | "tinytex" | "oleafly-tinytex" => Some(format!("tlmgr install {}", names.tlmgr)),
        "other" if os == "linux" => linux_install_command(&names, os_release),
        _ => None,
    }
}

pub fn linux_package_command(
    apt: &'static str,
    dnf: &'static str,
    pacman: &'static str,
    os_release: &str,
) -> Option<String> {
    let names = PackageNames {
        tlmgr: "",
        apt,
        dnf,
        pacman,
    };
    linux_install_command(&names, os_release)
}

pub fn host_os_release() -> String {
    if cfg!(target_os = "linux") {
        ["/etc/os-release", "/usr/lib/os-release"]
            .into_iter()
            .find_map(|path| std::fs::read_to_string(path).ok())
            .unwrap_or_default()
    } else {
        String::new()
    }
}

fn install_command(package: TexPackage, kind: &str) -> Option<String> {
    install_command_for(package, kind, std::env::consts::OS, &host_os_release())
}

fn latexmk_gap(search: &TexSearch, dirs: &[PathBuf]) -> TexBlocker {
    let Some(distribution) = dirs
        .iter()
        .find_map(|dir| distribution_for_bin_dir(search, dir))
    else {
        return TexBlocker::new("tex.latexmk_missing");
    };
    TexBlocker::with_command(
        "tex.latexmk_not_in_distribution",
        "tex.latexmk_not_in_distribution_command",
        install_command(TexPackage::Latexmk, &distribution.kind),
    )
    .param("binDir", distribution.bin_dir)
}

fn resolve_latexmk_in(search: &TexSearch, dirs: &[PathBuf]) -> Result<PathBuf, TexBlocker> {
    match find_tex_tool_in_dirs("latexmk", dirs) {
        Some(latexmk) if latexmk_needs_perl(search, &latexmk) => {
            Err(TexBlocker::new("tex.latexmk_needs_perl"))
        }
        Some(latexmk) => Ok(latexmk),
        None => Err(latexmk_gap(search, dirs)),
    }
}

pub fn resolve_latexmk(search: &TexSearch) -> Result<PathBuf, TexBlocker> {
    resolve_latexmk_in(search, &tex_bin_dirs(search))
}

pub fn compiler_blocker(
    search: &TexSearch,
    latexmk: &Path,
    flavor: TexFlavor,
    label: &str,
) -> TexBlocker {
    TexBlocker::with_command(
        "tex.compiler_missing",
        "tex.compiler_missing_command",
        install_command(
            TexPackage::for_flavor(flavor),
            &distribution_kind_for_tool(search, latexmk),
        ),
    )
    .param("compiler", label)
}

pub fn japanese_compiler_blocker(search: &TexSearch, latexmk: &Path, label: &str) -> TexBlocker {
    TexBlocker::with_command(
        "tex.japanese_compiler_missing",
        "tex.japanese_compiler_missing_command",
        install_command(
            TexPackage::Japanese,
            &distribution_kind_for_tool(search, latexmk),
        ),
    )
    .param("compiler", label)
}

pub fn tool_blocker(search: &TexSearch, latexmk: &Path, tool: &str) -> TexBlocker {
    if tool != "biber" {
        return TexBlocker::new("tex.tool_missing").param("tool", tool);
    }
    TexBlocker::with_command(
        "tex.biber_missing",
        "tex.biber_missing_command",
        install_command(
            TexPackage::Biber,
            &distribution_kind_for_tool(search, latexmk),
        ),
    )
}

pub fn distribution_for_tool(search: &TexSearch, tool: &Path) -> Option<TexDistribution> {
    distribution_for_bin_dir(search, tool.parent()?)
}

pub fn active_latexmk_distribution(search: &TexSearch) -> Option<TexDistribution> {
    let latexmk = find_tex_tool(search, "latexmk")?;
    distribution_for_bin_dir(search, latexmk.parent()?)
}

fn real_dir(dir: &Path) -> PathBuf {
    std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_owned())
}

pub fn list_distributions(search: &TexSearch) -> Vec<TexDistribution> {
    let active_dir =
        find_tex_tool(search, "latexmk").and_then(|latexmk| latexmk.parent().map(real_dir));
    let preferred_dir = search.preferred_bin_dir.as_deref().map(real_dir);
    let mut seen_roots: Vec<PathBuf> = Vec::new();
    let mut seen_dirs: Vec<PathBuf> = Vec::new();
    let mut result = Vec::new();
    for dir in tex_bin_dirs(search) {
        let (_, root) = classify_bin_dir(search, &dir);
        let real = real_dir(&dir);
        if seen_roots.iter().any(|r| r == &root) || seen_dirs.contains(&real) {
            continue;
        }
        let Some(mut distribution) = distribution_for_bin_dir(search, &dir) else {
            continue;
        };
        distribution.active = active_dir.as_ref() == Some(&real);
        distribution.preferred = preferred_dir.as_ref() == Some(&real);
        seen_roots.push(root.clone());
        seen_dirs.push(real);
        result.push(distribution);
    }
    result
}

fn distribution_for_bin_dir(search: &TexSearch, dir: &Path) -> Option<TexDistribution> {
    let (kind, root) = classify_bin_dir(search, dir);
    let latexmk = find_tool_in_dir(dir, "latexmk");
    let tlmgr = find_tool_in_dir(dir, "tlmgr");
    let has_tex = latexmk.is_some()
        || tlmgr.is_some()
        || find_tool_in_dir(dir, "pdflatex").is_some()
        || find_tool_in_dir(dir, "xelatex").is_some()
        || find_tool_in_dir(dir, "lualatex").is_some();
    let system_package_manager = tlmgr
        .as_deref()
        .and_then(|tool| distro_package_manager(tool, search.home.as_deref()));
    let needs_perl = latexmk
        .as_deref()
        .is_some_and(|tool| latexmk_needs_perl(search, tool));
    has_tex.then(|| TexDistribution {
        label: label_for(&kind, &root),
        kind,
        bin_dir: dir.to_string_lossy().into_owned(),
        needs_perl,
        latexmk: latexmk.map(|tool| tool.to_string_lossy().into_owned()),
        tlmgr: tlmgr
            .filter(|_| system_package_manager.is_none())
            .map(|tool| tool.to_string_lossy().into_owned()),
        system_package_manager: system_package_manager.map(str::to_owned),
        complete: bin_dir_has_complete_tex(dir),
        active: false,
        preferred: false,
    })
}

const DEBIAN_TLMGR_MARKER: &str = "running on Debian, switching to user mode";
const FEDORA_TLMGR_MARKER: &str = "destroy the Fedora TeXLive install";
const MAX_TLMGR_SCRIPT_BYTES: u64 = 4 * 1024 * 1024;

fn tlmgr_script_text(tlmgr: &Path) -> Option<String> {
    let script = std::fs::File::open(std::fs::canonicalize(tlmgr).ok()?).ok()?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(script, MAX_TLMGR_SCRIPT_BYTES),
        &mut bytes,
    )
    .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn distro_package_manager(tlmgr: &Path, home: Option<&Path>) -> Option<&'static str> {
    let script = tlmgr_script_text(tlmgr)?;
    if script.contains(FEDORA_TLMGR_MARKER) {
        return Some("dnf");
    }
    if !script.contains(DEBIAN_TLMGR_MARKER) {
        return None;
    }
    let user_tree_ready = home.is_some_and(|home| home.join("texmf/tlpkg/texlive.tlpdb").is_file());
    (!user_tree_ready).then_some("apt")
}

fn classify_bin_dir(search: &TexSearch, dir: &Path) -> (String, PathBuf) {
    let text = dir.to_string_lossy().replace('\\', "/");
    let lower = text.to_ascii_lowercase();
    let managed = search
        .managed_tinytex_roots()
        .into_iter()
        .find(|root| dir.starts_with(root));
    if managed.is_some()
        || lower.contains("/.oleafly/tinytex")
        || lower.contains("oleafly") && lower.contains("tinytex")
    {
        let root = managed.unwrap_or_else(|| {
            search
                .managed_tinytex_root()
                .unwrap_or_else(|| dir.to_owned())
        });
        return ("oleafly-tinytex".into(), root);
    }
    if let Some(root) = named_tinytex_root(dir) {
        return ("tinytex".into(), root);
    }
    if lower.starts_with("/library/tex") {
        return ("mactex".into(), PathBuf::from("/Library/TeX/texbin"));
    }
    if lower.contains("miktex") || find_tool_in_dir(dir, "initexmf").is_some() {
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
    if !platform_os_matches(os, &lower) {
        return None;
    }
    if platform_is_preferred_universal(os, &lower) || platform_arch_matches(arch, &lower) {
        return Some(0);
    }
    if platform_names_architecture(&lower) {
        return None;
    }
    if os == "windows" && lower.contains("win32") {
        return matches!(arch, "x86_64" | "x86" | "i686").then_some(1);
    }
    Some(2)
}

fn platform_os_matches(os: &str, name: &str) -> bool {
    match os {
        "macos" => name.contains("darwin"),
        "linux" => name.contains("linux"),
        "windows" => name == "windows" || name.contains("win32") || name.contains("mingw"),
        other => name.contains(other),
    }
}

fn platform_is_preferred_universal(os: &str, name: &str) -> bool {
    (os == "macos" && name.contains("universal")) || (os == "windows" && name == "windows")
}

fn platform_arch_matches(arch: &str, name: &str) -> bool {
    match arch {
        "x86_64" => ["x86_64", "amd64"]
            .into_iter()
            .any(|alias| name.contains(alias)),
        "aarch64" => ["aarch64", "arm64"]
            .into_iter()
            .any(|alias| name.contains(alias)),
        "x86" | "i686" => ["i386", "i686"]
            .into_iter()
            .any(|alias| name.contains(alias)),
        "arm" => ["armhf", "armv7"]
            .into_iter()
            .any(|alias| name.contains(alias)),
        other => name.contains(other),
    }
}

fn platform_names_architecture(name: &str) -> bool {
    [
        "x86_64", "amd64", "aarch64", "arm64", "i386", "i686", "armhf", "armv7", "powerpc", "ppc",
    ]
    .into_iter()
    .any(|known| name.contains(known))
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

pub fn texdir_bin_dirs(root: &Path) -> Vec<PathBuf> {
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
                    .and_then(std::ffi::OsStr::to_str)
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
        tempfile::Builder::new()
            .prefix(&format!("oleafly-texdist-{name}-"))
            .tempdir()
            .unwrap()
            .keep()
    }

    fn create_tool(dir: &Path, name: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(exe(name)), b"test tool").unwrap();
    }

    fn create_complete_tex(dir: &Path) {
        for tool in [
            "latexmk",
            "pdflatex",
            "xelatex",
            "lualatex",
            "kpsewhich",
            "biber",
        ] {
            create_tool(dir, tool);
        }
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
    fn windows_tool_names_include_bat_fallback() {
        assert_eq!(
            tool_file_names_for(true, "tlmgr"),
            vec!["tlmgr.exe".to_string(), "tlmgr.bat".to_string()]
        );
        assert_eq!(
            tool_file_names_for(false, "tlmgr"),
            vec!["tlmgr".to_string()]
        );
    }

    #[test]
    fn find_tool_in_dir_resolves_windows_bat_scripts() {
        let directory = tempfile::tempdir().unwrap();
        let dir = directory.path();
        std::fs::write(dir.join("tlmgr.bat"), b"@echo off").unwrap();
        std::fs::write(dir.join(exe("latexmk")), b"tool").unwrap();

        assert_eq!(
            find_tool_in_dir(dir, "latexmk"),
            Some(dir.join(exe("latexmk")))
        );
        if cfg!(windows) {
            assert_eq!(find_tool_in_dir(dir, "tlmgr"), Some(dir.join("tlmgr.bat")));
            std::fs::write(dir.join("tlmgr.exe"), b"tool").unwrap();
            assert_eq!(find_tool_in_dir(dir, "tlmgr"), Some(dir.join("tlmgr.exe")));
        } else {
            assert_eq!(find_tool_in_dir(dir, "tlmgr"), None);
        }
    }

    #[test]
    fn texlive_year_bins_prefer_newest() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
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
        push_texlive_year_bins(&mut dirs, root);
        assert_eq!(dirs.len(), 2);
        assert!(dirs[0].to_string_lossy().contains("2025"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn classify_recognizes_texlive_year_root() {
        let (kind, root) = classify_bin_dir(
            &TexSearch::default(),
            Path::new("/usr/local/texlive/2025/bin/universal-darwin"),
        );
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
            let (kind, root) = classify_bin_dir(&TexSearch::default(), Path::new(path));
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
        let dirs = tex_bin_dirs(&TexSearch::from_env());
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
        create_complete_tex(&inherited_system);
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

    #[test]
    fn an_incomplete_system_install_remains_available_below_managed_tinytex() {
        let root = test_dir("incomplete-system");
        let incomplete = root.join("system/bin");
        let managed = root.join(".oleafly/tinytex/bin/host");
        create_tool(&incomplete, "pdflatex");
        create_tool(&managed, "latexmk");

        let dirs = compose_tex_bin_dirs(
            vec![incomplete.clone()],
            Vec::new(),
            vec![managed.clone()],
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(dirs, vec![managed, incomplete]);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_platform_discovery_selects_the_windows_bin_directory() {
        let root = test_dir("windows-platform");
        let bin = root.join("TinyTeX/bin");
        let windows = bin.join("windows");
        let linux = bin.join("x86_64-linux");
        std::fs::create_dir_all(&windows).unwrap();
        std::fs::create_dir_all(&linux).unwrap();

        let mut dirs = Vec::new();
        push_platform_bins_for(&mut dirs, &bin, "windows", "x86_64");
        assert_eq!(dirs, vec![windows]);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_path_symlink_into_tinytex_stays_in_the_tinytex_tier() {
        let root = test_dir("symlink-priority");
        let system = root.join("custom-system/bin");
        let tinytex = root.join("TinyTeX/bin/host");
        let inherited_wrapper = root.join("wrapper/bin");
        create_complete_tex(&system);
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
    fn a_complete_tex_in_a_generic_folder_outranks_tinytex() {
        let root = test_dir("homebrew");
        let homebrew = root.join("opt/homebrew/bin");
        let scattered = root.join("usr/local/bin");
        let managed = root.join(".oleafly/tinytex/bin/host");
        create_complete_tex(&homebrew);
        create_tool(&scattered, "pdflatex");
        create_tool(&managed, "latexmk");

        let dirs = compose_tex_bin_dirs(
            Vec::new(),
            Vec::new(),
            vec![managed.clone()],
            Vec::new(),
            vec![scattered.clone(), homebrew.clone()],
        );
        assert_eq!(dirs, vec![homebrew, managed, scattered]);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_windows_profiles_with_non_ascii_names_move_the_managed_tinytex() {
        let ascii = Path::new("C:\\Users\\Ada Lovelace\\.oleafly");
        let accented = Path::new("C:\\Users\\Jos\u{e9}\\.oleafly");
        let chinese = Path::new("C:\\Users\\\u{5f20}\u{4e09}\\.oleafly");
        let program_data = Path::new("C:\\ProgramData");

        assert_eq!(
            managed_tinytex_parent_for("windows", Some(ascii), Some(program_data)),
            Some(ascii.to_owned())
        );
        assert_eq!(
            managed_tinytex_parent_for("linux", Some(chinese), Some(program_data)),
            Some(chinese.to_owned())
        );
        assert_eq!(
            managed_tinytex_parent_for("macos", Some(accented), None),
            Some(accented.to_owned())
        );

        let moved = managed_tinytex_parent_for("windows", Some(accented), Some(program_data))
            .expect("a usable ProgramData");
        assert!(moved.starts_with(program_data), "{}", moved.display());
        assert!(is_ascii_path(&moved), "{}", moved.display());
        let name = moved.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("Oleafly-"), "{name}");
        assert_eq!(name.len(), "Oleafly-".len() + 16, "{name}");

        let other_account =
            managed_tinytex_parent_for("windows", Some(chinese), Some(program_data));
        assert!(other_account.is_some());
        assert_ne!(other_account, Some(moved));
    }

    #[test]
    fn a_non_ascii_profile_without_a_usable_program_data_has_no_managed_location() {
        let accented = Path::new("C:\\Users\\Jos\u{e9}\\.oleafly");
        assert_eq!(
            managed_tinytex_parent_for("windows", Some(accented), None),
            None
        );
        assert_eq!(
            managed_tinytex_parent_for(
                "windows",
                Some(accented),
                Some(Path::new("D:\\\u{6570}\u{636e}"))
            ),
            None
        );
        assert_eq!(managed_tinytex_parent_for("windows", None, None), None);
    }

    #[test]
    fn the_data_folder_tinytex_stays_a_search_root() {
        let data = test_dir("managed-roots");
        let search = TexSearch {
            data_root: Some(data.clone()),
            ..TexSearch::default()
        };
        assert_eq!(search.managed_tinytex_roots(), vec![data.join("tinytex")]);
        assert_eq!(search.managed_tinytex_root(), Some(data.join("tinytex")));
        std::fs::remove_dir_all(data).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_relocated_tinytex_is_found_and_labelled_as_oleaflys() {
        let root = test_dir("relocated");
        let data = root.join("Users/Jos\u{e9}/.oleafly");
        std::fs::create_dir_all(&data).unwrap();
        let program_data = tempfile::Builder::new()
            .prefix("oleafly-programdata-")
            .tempdir()
            .unwrap();
        let search = TexSearch {
            data_root: Some(data.clone()),
            program_data: Some(program_data.path().to_path_buf()),
            ..TexSearch::default()
        };
        let moved = search.managed_tinytex_root().unwrap();
        let bin = moved.join("bin").join("windows");
        create_tool(&bin, "latexmk");

        assert!(tex_bin_dirs(&search).contains(&bin));
        assert_eq!(
            distribution_kind_for_tool(&search, &bin.join("latexmk.exe")),
            "oleafly-tinytex"
        );
        assert_eq!(
            search.managed_tinytex_roots(),
            vec![moved, data.join("tinytex")]
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_relocated_folder_held_by_another_account_is_refused() {
        let root = test_dir("foreign-parent");
        let data = root.join("Jos\u{e9}");
        let program_data = root.join("ProgramData");
        let elsewhere = root.join("texlive/bin");
        let parent = managed_tinytex_parent_for("windows", Some(&data), Some(&program_data))
            .expect("a usable ProgramData");
        std::fs::create_dir_all(&parent).unwrap();
        let search = TexSearch {
            data_root: Some(data.clone()),
            program_data: Some(program_data.clone()),
            preferred_bin_dir: Some(parent.join("tinytex/bin/windows")),
            ..TexSearch::default()
        };

        let kept = search
            .clone()
            .refusing_foreign_parent_on("windows", |_| true);
        assert!(!kept.relocated_parent_refused);
        assert_eq!(kept.preferred_bin_dir, search.preferred_bin_dir);

        let refused = search
            .clone()
            .refusing_foreign_parent_on("windows", |_| false);
        assert!(refused.relocated_parent_refused);
        assert_eq!(refused.managed_tinytex_parent(), None);
        assert_eq!(refused.managed_tinytex_root(), None);
        assert_eq!(refused.managed_tinytex_roots(), vec![data.join("tinytex")]);
        assert_eq!(refused.preferred_bin_dir, None);
        assert_eq!(refused.program_data, Some(program_data));

        let other_choice = TexSearch {
            preferred_bin_dir: Some(elsewhere.clone()),
            ..search
        }
        .refusing_foreign_parent_on("windows", |_| false);
        assert_eq!(other_choice.preferred_bin_dir, Some(elsewhere));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_a_relocated_folder_that_exists_is_asked_about() {
        let root = test_dir("unasked-parent");
        let accented = root.join("Jos\u{e9}");
        let plain = root.join("Ada Lovelace");
        let program_data = root.join("ProgramData");
        let search = |data: &Path| TexSearch {
            data_root: Some(data.to_owned()),
            program_data: Some(program_data.clone()),
            ..TexSearch::default()
        };
        let never_asked = |folder: &Path| panic!("asked about {}", folder.display());

        for (os, data) in [
            ("windows", &accented),
            ("windows", &plain),
            ("linux", &accented),
            ("macos", &accented),
        ] {
            let checked = search(data).refusing_foreign_parent_on(os, never_asked);
            assert!(!checked.relocated_parent_refused, "{os} {}", data.display());
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_planted_tinytex_is_not_run_and_the_machine_wide_one_still_is() {
        let root = test_dir("planted");
        let data = root.join("Users/Jos\u{e9}/.oleafly");
        std::fs::create_dir_all(&data).unwrap();
        let program_data = tempfile::Builder::new()
            .prefix("oleafly-programdata-")
            .tempdir()
            .unwrap();
        let search = TexSearch {
            data_root: Some(data),
            program_data: Some(program_data.path().to_path_buf()),
            ..TexSearch::default()
        };
        let planted = search
            .managed_tinytex_root()
            .unwrap()
            .join("bin")
            .join("windows");
        let machine_wide = program_data.path().join("TinyTeX/bin/windows");
        create_tool(&planted, "latexmk");
        create_tool(&machine_wide, "latexmk");
        let refused = TexSearch {
            preferred_bin_dir: Some(planted.clone()),
            ..search
        }
        .refusing_foreign_parent(|_| false);

        let dirs = tex_bin_dirs(&refused);
        assert!(!dirs.contains(&planted), "{dirs:?}");
        assert!(dirs.contains(&machine_wide), "{dirs:?}");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_chosen_distribution_goes_first_and_a_vanished_choice_is_ignored() {
        let root = test_dir("preferred");
        let system = root.join("system/bin");
        let managed = root.join("managed/bin");
        create_complete_tex(&system);
        create_tool(&managed, "latexmk");
        let dirs = vec![system.clone(), managed.clone()];

        assert_eq!(
            prefer_bin_dir(dirs.clone(), Some(&managed)),
            vec![managed.clone(), system.clone()]
        );
        assert_eq!(prefer_bin_dir(dirs.clone(), None), dirs);
        assert_eq!(
            prefer_bin_dir(dirs.clone(), Some(&root.join("gone/bin"))),
            dirs
        );
        let empty = root.join("no-tex");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(prefer_bin_dir(dirs.clone(), Some(&empty)), dirs);

        std::fs::remove_dir_all(root).unwrap();
    }

    fn inherited_search(root: &Path, dirs: &[&Path]) -> TexSearch {
        TexSearch {
            path: Some(std::env::join_paths(dirs).unwrap()),
            home: Some(root.join("home")),
            data_root: Some(root.join("data")),
            ..TexSearch::default()
        }
    }

    #[test]
    fn the_listing_marks_the_folder_latexmk_runs_from_and_the_chosen_one() {
        let root = test_dir("active-row");
        let first = root.join("texlive/2031/bin/host");
        let second = root.join("texlive/2030/bin/host");
        create_complete_tex(&first);
        create_complete_tex(&second);

        let search = inherited_search(&root, &[&first, &second]);
        let row = |dir: &Path, rows: &[TexDistribution]| {
            rows.iter()
                .find(|row| row.bin_dir == dir.to_string_lossy())
                .cloned()
                .unwrap()
        };
        let rows = list_distributions(&search);
        assert!(rows.iter().all(|row| !row.preferred));
        assert_eq!(rows.iter().filter(|row| row.active).count(), 1, "{rows:?}");

        for (chosen, other) in [(&first, &second), (&second, &first)] {
            let rows = list_distributions(&TexSearch {
                preferred_bin_dir: Some(chosen.clone()),
                ..search.clone()
            });
            assert!(row(chosen, &rows).active);
            assert!(row(chosen, &rows).preferred);
            assert!(!row(other, &rows).active);
            assert!(!row(other, &rows).preferred);
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_bin_folder_is_listed_once() {
        let root = test_dir("linked-bin");
        let real = root.join("real/bin/host");
        create_complete_tex(&real);
        let link = root.join("texbin");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let search = TexSearch {
            preferred_bin_dir: Some(link.clone()),
            ..inherited_search(&root, &[&link, &real])
        };
        let rows: Vec<_> = list_distributions(&search)
            .into_iter()
            .filter(|row| row.bin_dir.starts_with(&*root.to_string_lossy()))
            .collect();
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(rows[0].bin_dir, link.to_string_lossy());
        assert!(rows[0].active);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn distribution_does_not_borrow_tlmgr_from_another_bin_dir() {
        let root = test_dir("siblings");
        let active = root.join("system/bin");
        let inactive = root.join("managed/bin");
        create_tool(&active, "latexmk");
        create_tool(&inactive, "tlmgr");

        let distribution = distribution_for_bin_dir(&TexSearch::default(), &active).unwrap();
        let expected_latexmk = active.join(exe("latexmk")).to_string_lossy().into_owned();
        assert_eq!(
            distribution.latexmk.as_deref(),
            Some(expected_latexmk.as_str())
        );
        assert_eq!(distribution.tlmgr, None);

        std::fs::remove_dir_all(root).unwrap();
    }

    fn write_tlmgr_script(dir: &Path, text: &str) {
        std::fs::create_dir_all(dir).unwrap();
        for name in tool_file_names_for(cfg!(windows), "tlmgr") {
            std::fs::write(dir.join(name), text).unwrap();
        }
    }

    #[test]
    fn a_debian_tlmgr_is_not_offered_until_the_user_sets_up_a_personal_tree() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        write_tlmgr_script(
            &bin,
            "print \"(running on Debian, switching to user mode!)\\n\";",
        );
        create_tool(&bin, "latexmk");
        let home = root.path().join("home");
        let search = TexSearch {
            home: Some(home.clone()),
            ..TexSearch::default()
        };

        let distribution = distribution_for_bin_dir(&search, &bin).unwrap();
        assert_eq!(distribution.tlmgr, None);
        assert_eq!(distribution.system_package_manager.as_deref(), Some("apt"));
        assert!(!distribution.complete);

        std::fs::create_dir_all(home.join("texmf/tlpkg")).unwrap();
        std::fs::write(home.join("texmf/tlpkg/texlive.tlpdb"), b"name 00texlive").unwrap();
        let distribution = distribution_for_bin_dir(&search, &bin).unwrap();
        assert!(distribution.tlmgr.is_some());
        assert_eq!(distribution.system_package_manager, None);
    }

    #[test]
    fn a_fedora_tlmgr_is_never_offered_because_it_only_prints_a_warning() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        write_tlmgr_script(
            &bin,
            "will likely destroy the Fedora TeXLive install on your system",
        );
        let home = root.path().join("home");
        std::fs::create_dir_all(home.join("texmf/tlpkg")).unwrap();
        std::fs::write(home.join("texmf/tlpkg/texlive.tlpdb"), b"name 00texlive").unwrap();
        let search = TexSearch {
            home: Some(home),
            ..TexSearch::default()
        };

        let distribution = distribution_for_bin_dir(&search, &bin).unwrap();
        assert_eq!(distribution.tlmgr, None);
        assert_eq!(distribution.system_package_manager.as_deref(), Some("dnf"));
    }

    #[test]
    fn an_upstream_tlmgr_stays_available_and_the_lookup_reads_through_a_link() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        write_tlmgr_script(&bin, "#!/usr/bin/env perl\nsub action_install {}\n");
        let distribution = distribution_for_bin_dir(&TexSearch::default(), &bin).unwrap();
        assert!(distribution.tlmgr.is_some());
        assert_eq!(distribution.system_package_manager, None);

        #[cfg(unix)]
        {
            let scripts = root.path().join("texmf-dist/scripts/texlive");
            std::fs::create_dir_all(&scripts).unwrap();
            let patched = scripts.join("tlmgr.pl");
            std::fs::write(&patched, "running on Debian, switching to user mode").unwrap();
            let linked = root.path().join("usr-bin");
            std::fs::create_dir_all(&linked).unwrap();
            std::os::unix::fs::symlink(&patched, linked.join("tlmgr")).unwrap();
            let distribution = distribution_for_bin_dir(&TexSearch::default(), &linked).unwrap();
            assert_eq!(distribution.tlmgr, None);
            assert_eq!(distribution.system_package_manager.as_deref(), Some("apt"));
        }
    }

    #[test]
    fn a_distribution_can_be_read_from_any_tool_beside_it() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        create_tool(&bin, "latexmk");
        let latexmk = bin.join(exe("latexmk"));
        let found = distribution_for_tool(&TexSearch::default(), &latexmk).unwrap();
        assert_eq!(found.bin_dir, bin.to_string_lossy());
        assert_eq!(
            distribution_for_tool(&TexSearch::default(), Path::new("latexmk")),
            None
        );
    }

    #[test]
    fn managed_tinytex_is_found_under_the_data_root() {
        let data = tempfile::tempdir().unwrap();
        let platform = host_platform_dirs()[0];
        let bin = data.path().join("tinytex/bin").join(platform);
        create_tool(&bin, "latexmk");
        let search = TexSearch {
            data_root: Some(data.path().to_path_buf()),
            ..TexSearch::default()
        };
        let managed = bin.join(exe("latexmk"));
        assert!(tex_tool_candidates(&search, "latexmk").contains(&managed));
        assert_eq!(
            distribution_kind_for_tool(&search, &managed),
            "oleafly-tinytex"
        );
        let system = find_tex_tool(&TexSearch::default(), "latexmk");
        let found = find_tex_tool(&search, "latexmk").unwrap();
        assert!(
            found == managed || system.as_ref() == Some(&found),
            "{found:?}"
        );
    }

    fn miktex_search(root: &Path, perl_dir: Option<&Path>) -> TexSearch {
        TexSearch {
            path: perl_dir.map(|dir| std::env::join_paths([dir]).unwrap()),
            data_root: Some(root.join("data")),
            ..TexSearch::default()
        }
    }

    #[test]
    fn a_miktex_without_perl_ranks_below_every_other_tex() {
        let root = test_dir("miktex-no-perl");
        let miktex = root.join("MiKTeX/miktex/bin/x64");
        let managed = root.join("data/tinytex/bin/host");
        create_complete_tex(&miktex);
        create_tool(&managed, "latexmk");
        let composed = compose_tex_bin_dirs(
            vec![miktex.clone()],
            Vec::new(),
            vec![managed.clone()],
            Vec::new(),
            Vec::new(),
        );
        assert_eq!(composed, vec![miktex.clone(), managed.clone()]);

        let search = miktex_search(&root, None);
        assert_eq!(
            demote_perlless_miktex(&search, composed),
            vec![managed.clone(), miktex.clone()]
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_miktex_with_perl_keeps_its_rank() {
        let root = test_dir("miktex-perl");
        let miktex = root.join("MiKTeX/miktex/bin/x64");
        let managed = root.join("data/tinytex/bin/host");
        let perl = root.join("Strawberry/perl/bin");
        create_complete_tex(&miktex);
        create_tool(&managed, "latexmk");
        create_tool(&perl, "perl");

        let search = miktex_search(&root, Some(&perl));
        assert_eq!(find_perl(&search), Some(perl.join(exe("perl"))));
        let dirs = vec![miktex.clone(), managed.clone()];
        assert_eq!(demote_perlless_miktex(&search, dirs.clone()), dirs);
        assert_eq!(
            resolve_latexmk_in(&search, &dirs),
            Ok(miktex.join(exe("latexmk")))
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_finds_perl_under_every_program_extension() {
        assert_eq!(
            script_engine_file_names(true, "perl"),
            vec!["perl.com", "perl.exe", "perl.cmd", "perl.bat"]
        );
        assert_eq!(script_engine_file_names(false, "perl"), vec!["perl"]);
    }

    #[test]
    fn a_custom_miktex_folder_is_recognised_by_its_tools() {
        let root = test_dir("miktex-custom");
        let bin = root.join("D-drive/tex/bin/x64");
        create_tool(&bin, "initexmf");
        create_tool(&bin, "latexmk");

        let search = miktex_search(&root, None);
        assert_eq!(
            distribution_kind_for_tool(&search, &bin.join(exe("latexmk"))),
            "miktex"
        );
        let distribution = distribution_for_bin_dir(&search, &bin).unwrap();
        assert!(distribution.needs_perl);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lone_miktex_without_perl_blocks_latexmk() {
        let root = test_dir("miktex-only");
        let miktex = root.join("MiKTeX/miktex/bin/x64");
        create_complete_tex(&miktex);

        let search = miktex_search(&root, None);
        let blocker = resolve_latexmk_in(&search, &[miktex]).unwrap_err();
        assert_eq!(blocker.code, "tex.latexmk_needs_perl");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn no_tex_at_all_blocks_latexmk_with_the_missing_code() {
        let blocker = resolve_latexmk_in(&TexSearch::default(), &[]).unwrap_err();
        assert_eq!(blocker.code, "tex.latexmk_missing");
        assert!(blocker.params.is_empty());
    }

    #[test]
    fn tex_without_latexmk_names_the_folder_it_found() {
        let root = test_dir("no-latexmk");
        let bin = root.join("MiKTeX/miktex/bin/x64");
        create_tool(&bin, "pdflatex");

        let blocker =
            resolve_latexmk_in(&TexSearch::default(), std::slice::from_ref(&bin)).unwrap_err();
        assert_eq!(blocker.code, "tex.latexmk_not_in_distribution");
        assert_eq!(
            blocker.params.get("binDir"),
            Some(&bin.to_string_lossy().into_owned())
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_commands_follow_the_distribution_not_tlmgr() {
        let ubuntu = "NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\n";
        let fedora = "NAME=\"Fedora Linux\"\nID=fedora\n";
        let rocky = "ID=\"rocky\"\nID_LIKE=\"rhel centos fedora\"\n";
        let arch = "ID=arch\n";
        let manjaro = "ID=manjaro\nID_LIKE=arch\n";
        let void = "ID=void\n";
        let cases = [
            ("other", "linux", ubuntu, "sudo apt install latexmk"),
            ("other", "linux", fedora, "sudo dnf install latexmk"),
            ("other", "linux", rocky, "sudo dnf install latexmk"),
            ("other", "linux", arch, "sudo pacman -S texlive-binextra"),
            ("other", "linux", manjaro, "sudo pacman -S texlive-binextra"),
            ("mactex", "macos", "", "sudo tlmgr install latexmk"),
            ("texlive", "linux", ubuntu, "tlmgr install latexmk"),
            ("tinytex", "windows", "", "tlmgr install latexmk"),
        ];
        for (kind, os, release, command) in cases {
            assert_eq!(
                install_command_for(TexPackage::Latexmk, kind, os, release).as_deref(),
                Some(command),
                "{kind} {os} {release}"
            );
        }
        assert_eq!(
            install_command_for(TexPackage::Latexmk, "other", "linux", void),
            None
        );
        assert_eq!(
            install_command_for(TexPackage::Latexmk, "other", "macos", ubuntu),
            None
        );
        assert_eq!(
            install_command_for(TexPackage::Latexmk, "miktex", "windows", ""),
            None
        );
    }

    #[test]
    fn engine_packages_are_named_per_distribution() {
        let ubuntu = "ID=ubuntu\n";
        let command = |package| install_command_for(package, "other", "linux", ubuntu);
        assert_eq!(
            command(TexPackage::for_flavor(TexFlavor::Xelatex)).as_deref(),
            Some("sudo apt install texlive-xetex")
        );
        assert_eq!(
            command(TexPackage::for_flavor(TexFlavor::Lualatex)).as_deref(),
            Some("sudo apt install texlive-latex-base")
        );
        assert_eq!(
            command(TexPackage::for_flavor(TexFlavor::Uplatex)).as_deref(),
            Some("sudo apt install texlive-lang-japanese")
        );
        assert_eq!(
            install_command_for(TexPackage::Japanese, "texlive", "linux", ubuntu).as_deref(),
            Some("tlmgr install collection-langjapanese")
        );
    }

    #[test]
    fn pdflatex_and_lualatex_share_the_package_that_installs_them() {
        for flavor in [TexFlavor::Pdflatex, TexFlavor::Lualatex] {
            let package = TexPackage::for_flavor(flavor);
            let command = |kind, os, release| install_command_for(package, kind, os, release);
            assert_eq!(
                command("texlive", "linux", "").as_deref(),
                Some("tlmgr install latex-bin")
            );
            assert_eq!(
                command("mactex", "macos", "").as_deref(),
                Some("sudo tlmgr install latex-bin")
            );
            assert_eq!(
                command("other", "linux", "ID=ubuntu\n").as_deref(),
                Some("sudo apt install texlive-latex-base")
            );
            assert_eq!(
                command("other", "linux", "ID=fedora\n").as_deref(),
                Some("sudo dnf install texlive-latex")
            );
            assert_eq!(
                command("other", "linux", "ID=arch\n").as_deref(),
                Some("sudo pacman -S texlive-latex")
            );
        }
    }

    #[test]
    fn a_missing_compiler_names_its_package() {
        let root = test_dir("compiler");
        let bin = root.join("texlive/2025/bin/host");
        create_tool(&bin, "latexmk");

        let blocker = compiler_blocker(
            &TexSearch::default(),
            &bin.join(exe("latexmk")),
            TexFlavor::Xelatex,
            "XeLaTeX",
        );
        assert_eq!(blocker.code, "tex.compiler_missing_command");
        assert_eq!(
            blocker.params.get("compiler").map(String::as_str),
            Some("XeLaTeX")
        );
        assert_eq!(
            blocker.params.get("command").map(String::as_str),
            Some("tlmgr install xetex")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_japanese_compiler_names_the_collection_when_it_can() {
        let root = test_dir("japanese");
        let texlive = root.join("texlive/2025/bin/host");
        let miktex = root.join("MiKTeX/miktex/bin/x64");
        create_tool(&texlive, "latexmk");
        create_tool(&miktex, "latexmk");
        let search = TexSearch::default();

        let named = japanese_compiler_blocker(&search, &texlive.join(exe("latexmk")), "upLaTeX");
        assert_eq!(named.code, "tex.japanese_compiler_missing_command");
        assert_eq!(
            named.params.get("compiler").map(String::as_str),
            Some("upLaTeX")
        );
        assert_eq!(
            named.params.get("command").map(String::as_str),
            Some("tlmgr install collection-langjapanese")
        );

        let plain = japanese_compiler_blocker(&search, &miktex.join(exe("latexmk")), "pLaTeX");
        assert_eq!(plain.code, "tex.japanese_compiler_missing");
        assert!(!plain.params.contains_key("command"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_helper_is_named_and_biber_gets_its_own_message() {
        let root = test_dir("helpers");
        let bin = root.join("texlive/2025/bin/host");
        create_tool(&bin, "latexmk");
        let latexmk = bin.join(exe("latexmk"));
        let search = TexSearch::default();

        let helper = tool_blocker(&search, &latexmk, "makeindex");
        assert_eq!(helper.code, "tex.tool_missing");
        assert_eq!(
            helper.params.get("tool").map(String::as_str),
            Some("makeindex")
        );

        let biber = tool_blocker(&search, &latexmk, "biber");
        assert_eq!(biber.code, "tex.biber_missing_command");
        assert_eq!(
            biber.params.get("command").map(String::as_str),
            Some("tlmgr install biber")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tool_on_path_skips_relative_entries() {
        let root = test_dir("path-entries");
        let bin = root.join("bin");
        create_tool(&bin, "xelatex");
        let path = std::env::join_paths([PathBuf::from("."), bin]).unwrap();
        assert!(tool_on_path(&path, "xelatex"));
        assert!(!tool_on_path(&path, "lualatex"));
        let relative = std::env::join_paths([PathBuf::from(".")]).unwrap();
        assert!(!tool_on_path(&relative, "xelatex"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_home_folder_texlive_is_found_without_a_path_entry() {
        let home = test_dir("home-texlive");
        let platform = host_platform_dirs()[0];
        let bin = home.join("texlive/2025/bin").join(platform);
        create_tool(&bin, "latexmk");

        let search = TexSearch {
            home: Some(home.clone()),
            ..TexSearch::default()
        };
        assert!(tex_bin_dirs(&search).contains(&bin));

        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn windows_miktex_and_texlive_roots_come_from_explicit_folders() {
        let local = PathBuf::from("C:\\Users\\Ada Lovelace\\AppData\\Local");
        let search = TexSearch {
            local_app_data: Some(local.clone()),
            ..TexSearch::default()
        };
        let candidate = search
            .local_app_data
            .as_ref()
            .map(|local| local.join("Programs\\MiKTeX\\miktex\\bin\\x64"))
            .unwrap();
        assert!(candidate.starts_with(&local));
        assert!(candidate.to_string_lossy().ends_with("miktex\\bin\\x64"));
    }
}
