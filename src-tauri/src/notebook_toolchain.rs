use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::proc::NoConsole;
use crate::toolchain_download::{
    ArchiveKind, CancelToken, DownloadTimeouts, InstallPhase, InstallProgress,
    ToolchainInstallError, ToolchainInstallErrorKind, TreeInstallRequest,
};

const MANIFEST_JSON: &str = include_str!("../resources/notebook-toolchains.json");
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const PYTHON_ENVIRONMENTS: [&str; 3] = [".venv", "venv", "env"];
const JUPYTER_MODULES: [&str; 5] = ["jupyter_core", "nbformat", "nbclient", "ipykernel", "yaml"];
const ENVIRONMENT_FILE_PREFIX: &str = "_environment";
const ENVIRONMENT_FILE_LIMIT: u64 = 64 * 1024;

type VersionProbe = (Option<std::time::SystemTime>, Option<String>);

static INSTALLING: Mutex<BTreeSet<NotebookTool>> = Mutex::new(BTreeSet::new());
static PROBED_VERSIONS: Mutex<BTreeMap<PathBuf, VersionProbe>> = Mutex::new(BTreeMap::new());

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NotebookTool {
    Quarto,
    Calepin,
}

impl NotebookTool {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "quarto" => Some(Self::Quarto),
            "calepin" => Some(Self::Calepin),
            _ => None,
        }
    }

    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Quarto => "quarto",
            Self::Calepin => "calepin",
        }
    }

    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Quarto => "Quarto",
            Self::Calepin => "Calepin",
        }
    }

    pub(crate) const fn missing_code(self) -> &'static str {
        match self {
            Self::Quarto => "notebook.quarto_missing",
            Self::Calepin => "notebook.calepin_missing",
        }
    }

    fn release(self) -> &'static ToolRelease {
        match self {
            Self::Quarto => &manifest().tools.quarto,
            Self::Calepin => &manifest().tools.calepin,
        }
    }

    fn artifact(self) -> Option<&'static ToolArtifact> {
        let target = oleafly_core::typst_toolchain::host_target()?;
        self.release().targets.get(target)
    }

    fn executable_name(self) -> String {
        if cfg!(windows) {
            format!("{}.exe", self.name())
        } else {
            self.name().to_owned()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    allowed_download_hosts: Vec<String>,
    tools: ManifestTools,
}

#[derive(Deserialize)]
struct ManifestTools {
    quarto: ToolRelease,
    calepin: ToolRelease,
}

#[derive(Deserialize)]
struct ToolRelease {
    version: String,
    #[serde(default, rename = "minimumVersion")]
    minimum_version: Option<String>,
    license: String,
    targets: BTreeMap<String, ToolArtifact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolArtifact {
    archive_type: String,
    archive_sha256: String,
    archive_size: u64,
    executables: Vec<String>,
    url: String,
    #[serde(default)]
    mirror_url: Option<String>,
}

impl ToolArtifact {
    fn download_urls(&self) -> Vec<String> {
        self.mirror_url
            .iter()
            .chain(std::iter::once(&self.url))
            .cloned()
            .collect()
    }
}

fn parse_manifest(text: &str) -> Result<Manifest, String> {
    serde_json::from_str(text)
        .map_err(|error| format!("invalid notebook toolchain manifest: {error}"))
}

fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        parse_manifest(MANIFEST_JSON).expect("the bundled notebook toolchain manifest is valid")
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ToolSource {
    System,
    Managed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolInstall {
    path: String,
    version: Option<String>,
    source: ToolSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolStatus {
    tool: NotebookTool,
    pinned_version: String,
    active: Option<ToolInstall>,
    system: Option<ToolInstall>,
    managed: Option<ToolInstall>,
    outdated_system: Option<String>,
    minimum_version: Option<String>,
    offered: bool,
    download_bytes: Option<u64>,
    license: String,
    installing: bool,
    superseded_versions: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuntimeName {
    R,
    Python,
    Julia,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageRuntime {
    name: RuntimeName,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotebookToolchainStatus {
    quarto: ToolStatus,
    calepin: ToolStatus,
    runtimes: Vec<LanguageRuntime>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotebookInstallProgress {
    tool: NotebookTool,
    phase: InstallPhase,
    received_bytes: u64,
    total_bytes: u64,
}

fn tools_root() -> Result<PathBuf, String> {
    Ok(oleafly_core::typst_toolchain::toolchains_root(
        &crate::paths::oleafly_root()?,
    ))
}

fn install_root(tool: NotebookTool) -> Result<PathBuf, String> {
    Ok(tools_root()?.join(tool.name()))
}

fn install_dir(tool: NotebookTool) -> Result<PathBuf, String> {
    Ok(install_root(tool)?.join(&tool.release().version))
}

fn managed_tool(tool: NotebookTool) -> Option<PathBuf> {
    let artifact = tool.artifact()?;
    let candidates = crate::toolchain_download::tree_executable_candidates(&artifact.executables);
    crate::toolchain_download::installed_tree(
        &install_dir(tool).ok()?,
        &artifact.archive_sha256,
        &candidates,
    )
}

fn superseded_in(root: &Path, pinned: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name != pinned && !name.starts_with('.'))
        .collect();
    versions.sort();
    versions
}

fn remove_superseded_in(root: &Path, pinned: &str) {
    for version in superseded_in(root, pinned) {
        let path = root.join(version);
        if let Err(error) = std::fs::remove_dir_all(&path) {
            let _ = crate::project::append_app_log(format!(
                "Could not remove the unused download {}: {error}",
                path.display()
            ));
        }
    }
}

fn superseded_versions(tool: NotebookTool) -> Vec<String> {
    install_root(tool)
        .map(|root| superseded_in(&root, &tool.release().version))
        .unwrap_or_default()
}

fn remove_superseded(tool: NotebookTool) {
    if let Ok(root) = install_root(tool) {
        remove_superseded_in(&root, &tool.release().version);
    }
}

fn known_locations(tool: NotebookTool, home: Option<&Path>) -> Vec<PathBuf> {
    let name = tool.executable_name();
    let mut paths = Vec::new();
    match tool {
        NotebookTool::Quarto if cfg!(target_os = "macos") => {
            paths.push(PathBuf::from("/Applications/quarto/bin/quarto"));
            if let Some(home) = home {
                paths.push(home.join("Applications/quarto/bin/quarto"));
            }
            paths.push(PathBuf::from(
                "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/quarto",
            ));
        }
        NotebookTool::Quarto if cfg!(windows) => {
            for variable in ["LOCALAPPDATA", "ProgramFiles"] {
                if let Some(root) = std::env::var_os(variable) {
                    let root = PathBuf::from(root);
                    let programs = if variable == "LOCALAPPDATA" {
                        root.join("Programs")
                    } else {
                        root
                    };
                    paths.push(programs.join("Quarto").join("bin").join(&name));
                }
            }
        }
        NotebookTool::Quarto => {
            paths.push(PathBuf::from("/opt/quarto/bin/quarto"));
        }
        NotebookTool::Calepin => {
            if let Some(home) = home {
                paths.push(home.join(".cargo").join("bin").join(&name));
                paths.push(home.join(".local").join("bin").join(&name));
            }
        }
    }
    paths
}

fn system_tool(tool: NotebookTool) -> Option<PathBuf> {
    let managed = tools_root().ok();
    let outside_managed = |path: &PathBuf| {
        let resolved = path.canonicalize().unwrap_or_else(|_| path.clone());
        !managed.as_ref().is_some_and(|root| {
            let root = root.canonicalize().unwrap_or_else(|_| root.clone());
            resolved.starts_with(root)
        })
    };
    crate::program_locator::locate_native(tool.name())
        .map(|located| located.path)
        .filter(outside_managed)
        .or_else(|| {
            known_locations(tool, dirs::home_dir().as_deref())
                .into_iter()
                .find(|path| path.is_file() && outside_managed(path))
        })
}

fn major_minor(version: &str) -> Option<(u64, u64)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

fn older_than(version: &str, minimum: &str) -> bool {
    matches!(
        (major_minor(version), major_minor(minimum)),
        (Some(found), Some(floor)) if found < floor
    )
}

fn cached_version(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok();
    let probed = PROBED_VERSIONS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(path)
        .filter(|(stamp, _)| *stamp == modified)
        .map(|(_, version)| version.clone());
    if let Some(version) = probed {
        return version;
    }
    let version = probe_version(path);
    PROBED_VERSIONS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(path.to_path_buf(), (modified, version.clone()));
    version
}

pub(crate) fn outdated_version(tool: NotebookTool, path: &Path) -> Option<(String, String)> {
    let minimum = tool.release().minimum_version.as_deref()?;
    let version = cached_version(path)?;
    older_than(&version, minimum).then(|| (version, minimum.to_owned()))
}

fn preferred_tool(
    system: Option<PathBuf>,
    managed: Option<PathBuf>,
    outdated: impl FnOnce(&Path) -> bool,
) -> Option<PathBuf> {
    match system {
        Some(system) if managed.is_some() && outdated(&system) => managed,
        Some(system) => Some(system),
        None => managed,
    }
}

pub(crate) fn find_tool(tool: NotebookTool) -> Option<PathBuf> {
    preferred_tool(system_tool(tool), managed_tool(tool), |path| {
        outdated_version(tool, path).is_some()
    })
}

pub(crate) fn parse_version(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|token| {
        let token = token
            .trim_start_matches(['v', 'V', '('])
            .trim_end_matches(|character: char| !character.is_ascii_alphanumeric());
        let mut parts = token.split('.');
        let first = parts.next()?;
        let second = parts.next()?;
        let numeric = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
        (numeric(first) && second.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .then(|| token.to_owned())
    })
}

fn probe_command(path: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(path);
    command.arg("--version").no_console();
    crate::proc::clear_appimage_env(&mut command);
    command
}

fn probe_version(path: &Path) -> Option<String> {
    let output =
        crate::proc::output_contained_with_timeout(probe_command(path), PROBE_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| parse_version(&String::from_utf8_lossy(&output.stderr)))
}

fn install_info(path: PathBuf, source: ToolSource) -> ToolInstall {
    ToolInstall {
        version: probe_version(&path),
        path: path.to_string_lossy().into_owned(),
        source,
    }
}

fn installing(tool: NotebookTool) -> bool {
    INSTALLING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(&tool)
}

fn tool_status(tool: NotebookTool) -> ToolStatus {
    let release = tool.release();
    let artifact = tool.artifact();
    let system = system_tool(tool).map(|path| install_info(path, ToolSource::System));
    let managed = managed_tool(tool).map(|path| install_info(path, ToolSource::Managed));
    let outdated_system = system
        .as_ref()
        .and_then(|install| outdated_version(tool, Path::new(&install.path)))
        .map(|(version, _)| version);
    let active = if outdated_system.is_some() && managed.is_some() {
        managed.clone()
    } else {
        system.clone().or_else(|| managed.clone())
    };
    ToolStatus {
        tool,
        pinned_version: release.version.clone(),
        active,
        system,
        managed,
        outdated_system,
        minimum_version: release.minimum_version.clone(),
        offered: artifact.is_some(),
        download_bytes: artifact.map(|artifact| artifact.archive_size),
        license: release.license.clone(),
        installing: installing(tool),
        superseded_versions: superseded_versions(tool),
    }
}

fn locate(name: &str) -> Option<PathBuf> {
    crate::program_locator::locate_native(name).map(|located| located.path)
}

fn r_installations_under(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path().join("bin").join("Rscript.exe"))
        .filter(|path| path.is_file())
        .collect();
    found.sort();
    found.reverse();
    found
}

fn windows_r_installations() -> Vec<PathBuf> {
    let program_files = std::env::var_os("ProgramFiles").map(|root| PathBuf::from(root).join("R"));
    let per_user =
        std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Programs").join("R"));
    program_files
        .into_iter()
        .chain(per_user)
        .flat_map(|root| r_installations_under(&root))
        .collect()
}

pub(crate) fn rscript() -> Option<PathBuf> {
    locate("Rscript").or_else(|| {
        if cfg!(target_os = "macos") {
            Some(PathBuf::from(
                "/Library/Frameworks/R.framework/Resources/bin/Rscript",
            ))
            .filter(|path| path.is_file())
        } else if cfg!(windows) {
            windows_r_installations().into_iter().next()
        } else {
            None
        }
    })
}

pub(crate) fn python() -> Option<PathBuf> {
    if cfg!(windows) {
        locate("python").or_else(|| locate("python3"))
    } else {
        locate("python3").or_else(|| locate("python"))
    }
}

pub(crate) fn julia() -> Option<PathBuf> {
    locate("julia").or_else(|| {
        let name = if cfg!(windows) { "julia.exe" } else { "julia" };
        dirs::home_dir()
            .map(|home| home.join(".juliaup").join("bin").join(name))
            .filter(|path| path.is_file())
    })
}

fn runtime(name: RuntimeName, path: Option<PathBuf>) -> LanguageRuntime {
    LanguageRuntime {
        name,
        version: path.as_deref().and_then(probe_version),
        path: path.map(|path| path.to_string_lossy().into_owned()),
    }
}

fn runtimes() -> Vec<LanguageRuntime> {
    vec![
        runtime(RuntimeName::R, rscript()),
        runtime(RuntimeName::Python, python()),
        runtime(RuntimeName::Julia, julia()),
    ]
}

fn unset(name: &str) -> bool {
    std::env::var_os(name).is_none_or(|value| value.is_empty())
}

pub(crate) fn r_installed() -> bool {
    !unset("QUARTO_R") || !unset("R_HOME") || rscript().is_some()
}

fn names_quarto_python(project_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(project_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .to_lowercase()
            .starts_with(ENVIRONMENT_FILE_PREFIX)
            && oleafly_core::read_bounded(&entry.path(), ENVIRONMENT_FILE_LIMIT)
                .is_some_and(|read| read.lossy_text().contains("QUARTO_PYTHON"))
    })
}

fn site_packages(environment: &Path) -> Vec<PathBuf> {
    let mut folders = vec![environment.join("Lib").join("site-packages")];
    if let Ok(entries) = std::fs::read_dir(environment.join("lib")) {
        folders.extend(
            entries
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("python"))
                .map(|entry| entry.path().join("site-packages")),
        );
    }
    folders
}

fn environment_python(environment: &Path) -> Option<PathBuf> {
    [
        environment.join("bin").join("python3"),
        environment.join("bin").join("python"),
        environment.join("Scripts").join("python.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn project_python(project_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    PYTHON_ENVIRONMENTS
        .iter()
        .map(|name| project_dir.join(name))
        .filter(|environment| environment.join("pyvenv.cfg").is_file())
        .find_map(|environment| {
            let folders = site_packages(&environment);
            JUPYTER_MODULES
                .iter()
                .all(|module| folders.iter().any(|folder| folder.join(module).exists()))
                .then(|| environment_python(&environment))
                .flatten()
                .map(|python| (environment, python))
        })
}

fn quarto_python_variables(project_dir: &Path, allow_code: bool) -> Vec<(&'static str, String)> {
    if allow_code {
        if names_quarto_python(project_dir) {
            return Vec::new();
        }
        if let Some((environment, python)) = project_python(project_dir) {
            // The project root is canonical, so on Windows these carry the \\?\
            // prefix, and Quarto can't start a Python named that way.
            return vec![
                (
                    "QUARTO_PYTHON",
                    oleafly_core::plain_path(&python)
                        .to_string_lossy()
                        .into_owned(),
                ),
                (
                    "VIRTUAL_ENV",
                    oleafly_core::plain_path(&environment)
                        .to_string_lossy()
                        .into_owned(),
                ),
            ];
        }
    }
    python()
        .map(|path| ("QUARTO_PYTHON", path.to_string_lossy().into_owned()))
        .into_iter()
        .collect()
}

fn locale_variable() -> Option<(&'static str, String)> {
    crate::proc::fallback_utf8_locale().map(|locale| ("LANG", locale.to_owned()))
}

/// On Windows, Python reads and writes pipes in the ANSI code page, while
/// Quarto and Calepin talk to it in UTF-8: Quarto reads back the path Python
/// reports, and Calepin hands it each chunk's source. Any non-ASCII character
/// in either arrives mangled, so the folder can't be found or the chunk fails.
fn python_io_variable() -> Option<(&'static str, String)> {
    (cfg!(windows) && unset("PYTHONIOENCODING")).then(|| ("PYTHONIOENCODING", "utf-8".to_owned()))
}

pub(crate) fn quarto_runtime_variables(
    project_dir: &Path,
    allow_code: bool,
) -> Vec<(&'static str, String)> {
    let mut variables = Vec::new();
    if unset("QUARTO_R") {
        if let Some(path) = rscript() {
            variables.push(("QUARTO_R", path.to_string_lossy().into_owned()));
        }
    }
    if unset("QUARTO_PYTHON") {
        variables.extend(quarto_python_variables(project_dir, allow_code));
    }
    if !cfg!(windows) && unset("QUARTO_JULIA") {
        if let Some(path) = julia() {
            variables.push(("QUARTO_JULIA", path.to_string_lossy().into_owned()));
        }
    }
    variables.extend(python_io_variable());
    variables.extend(locale_variable());
    variables
}

pub(crate) fn calepin_runtime_variables(project_dir: &Path) -> Vec<(&'static str, String)> {
    let mut variables = Vec::new();
    if unset("CALEPIN_PYTHON") && !project_dir.join(".venv").is_dir() {
        if let Some(path) = python() {
            variables.push(("CALEPIN_PYTHON", path.to_string_lossy().into_owned()));
        }
    }
    variables.extend(python_io_variable());
    variables.extend(locale_variable());
    variables
}

fn current_status() -> NotebookToolchainStatus {
    NotebookToolchainStatus {
        quarto: tool_status(NotebookTool::Quarto),
        calepin: tool_status(NotebookTool::Calepin),
        runtimes: runtimes(),
    }
}

fn tool_error(code: &'static str, tool: NotebookTool) -> String {
    AppError::new(code).param("tool", tool.label()).into()
}

fn parse_tool(value: &str) -> Result<NotebookTool, String> {
    NotebookTool::parse(value).ok_or_else(|| {
        AppError::new("notebook.unknown_tool")
            .param("tool", value.trim())
            .into()
    })
}

struct InstallClaim(NotebookTool);

impl InstallClaim {
    fn take(tool: NotebookTool) -> Result<Self, String> {
        let mut installing = INSTALLING.lock().unwrap_or_else(PoisonError::into_inner);
        if !installing.insert(tool) {
            return Err(tool_error("notebook.busy", tool));
        }
        Ok(Self(tool))
    }
}

impl Drop for InstallClaim {
    fn drop(&mut self) {
        INSTALLING
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.0);
    }
}

fn install_request(tool: NotebookTool) -> Result<TreeInstallRequest, String> {
    let artifact = tool
        .artifact()
        .ok_or_else(|| tool_error("notebook.not_offered", tool))?;
    let archive_kind = ArchiveKind::parse(&artifact.archive_type)
        .ok_or_else(|| tool_error("notebook.not_offered", tool))?;
    Ok(TreeInstallRequest {
        urls: artifact.download_urls(),
        allowed_hosts: manifest().allowed_download_hosts.clone(),
        archive_kind,
        archive_size: artifact.archive_size,
        archive_sha256: artifact.archive_sha256.clone(),
        install_dir: install_dir(tool)?,
        executables: artifact.executables.clone(),
        timeouts: DownloadTimeouts::default(),
    })
}

fn install_failure_code(kind: ToolchainInstallErrorKind, digest_mismatch: bool) -> &'static str {
    match kind {
        ToolchainInstallErrorKind::AlreadyInstalling => "notebook.busy",
        ToolchainInstallErrorKind::IntegrityFailure => "notebook.install_unverified",
        ToolchainInstallErrorKind::DownloadFailed if digest_mismatch => {
            "notebook.install_unverified"
        }
        ToolchainInstallErrorKind::DownloadFailed => "notebook.download_failed",
        _ => "notebook.install_failed",
    }
}

fn install_failure(tool: NotebookTool, error: &ToolchainInstallError) -> String {
    let coded = AppError::new(install_failure_code(error.kind(), error.digest_mismatch()))
        .param("tool", tool.label());
    match error.kind() {
        ToolchainInstallErrorKind::AlreadyInstalling
        | ToolchainInstallErrorKind::IntegrityFailure => coded.into(),
        _ if error.digest_mismatch() => coded.into(),
        _ => coded.detail(error.message()).into(),
    }
}

fn throttled<F>(
    tool: NotebookTool,
    cancel: CancelToken,
    send: F,
) -> impl Fn(InstallProgress) + Send + Sync
where
    F: Fn(NotebookInstallProgress) -> bool + Send + Sync,
{
    let last: Mutex<Option<(InstallPhase, Option<u64>)>> = Mutex::new(None);
    move |progress: InstallProgress| {
        let percent = (progress.total_bytes > 0).then(|| {
            progress.received_bytes.min(progress.total_bytes) * 100 / progress.total_bytes
        });
        let mark = (progress.phase, percent);
        {
            let mut last = last.lock().unwrap_or_else(PoisonError::into_inner);
            if *last == Some(mark) {
                return;
            }
            *last = Some(mark);
        }
        let delivered = send(NotebookInstallProgress {
            tool,
            phase: progress.phase,
            received_bytes: progress.received_bytes,
            total_bytes: progress.total_bytes,
        });
        if !delivered {
            cancel.cancel();
        }
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the notebook toolchain task stopped: {error}"))?
}

fn remove_blocking(tool: NotebookTool) -> Result<NotebookToolchainStatus, String> {
    let _claim = InstallClaim::take(tool)?;
    let root = install_root(tool)?;
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&root).map_err(|error| {
            String::from(
                AppError::new("notebook.remove_failed")
                    .param("tool", tool.label())
                    .detail(error),
            )
        })?,
        _ => return Err(tool_error("notebook.not_managed", tool)),
    }
    Ok(current_status())
}

fn is_plain_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
}

fn compiled_html_in(build: &Path, document: Option<&Path>) -> Option<PathBuf> {
    document
        .map(|input| crate::document_engine::quarto_html_artifact(build, input))
        .into_iter()
        .chain(std::iter::once(
            build.join(format!("{}.html", crate::paths::ENTRY_STEM)),
        ))
        .find(|html| is_plain_file(html))
}

pub(crate) fn compiled_html(project_id: &str) -> Result<PathBuf, String> {
    let build = crate::paths::existing_build_dir(project_id)?
        .ok_or_else(|| String::from(AppError::new("notebook.no_html_output")))?;
    let document = crate::project::read_meta(project_id)
        .ok()
        .zip(crate::paths::project_dir(project_id).ok())
        .map(|(meta, root)| root.join(meta.main_doc));
    compiled_html_in(&build, document.as_deref())
        .ok_or_else(|| String::from(AppError::new("notebook.no_html_output")))
}

fn html_opener_commands(html: &Path) -> Vec<std::process::Command> {
    let mut commands = open::commands(html);
    for command in &mut commands {
        crate::proc::clear_appimage_env(command);
    }
    commands
}

fn open_output_in_browser(html: &Path) -> std::io::Result<()> {
    if !cfg!(target_os = "linux") {
        return open::that_detached(html);
    }
    let mut last_error = None;
    for mut command in html_opener_commands(html) {
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        match crate::proc::spawn_contained(&mut command) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound)))
}

#[tauri::command]
pub async fn notebook_toolchain_status() -> Result<NotebookToolchainStatus, String> {
    blocking(|| Ok(current_status())).await
}

#[tauri::command]
pub async fn install_notebook_tool(
    tool: String,
    on_progress: tauri::ipc::Channel<NotebookInstallProgress>,
) -> Result<NotebookToolchainStatus, String> {
    let tool = parse_tool(&tool)?;
    let request = blocking(move || install_request(tool)).await?;
    let claim = InstallClaim::take(tool)?;
    let cancel = CancelToken::new();
    let progress = throttled(tool, cancel.clone(), move |event| {
        on_progress.send(event).is_ok()
    });
    crate::toolchain_download::install_tree(request, cancel, progress)
        .await
        .map_err(|error| install_failure(tool, &error))?;
    blocking(move || {
        remove_superseded(tool);
        Ok(())
    })
    .await?;
    drop(claim);
    blocking(|| Ok(current_status())).await
}

#[tauri::command]
pub async fn remove_notebook_tool(tool: String) -> Result<NotebookToolchainStatus, String> {
    let tool = parse_tool(&tool)?;
    blocking(move || remove_blocking(tool)).await
}

#[tauri::command]
pub async fn open_compiled_html(project_id: String) -> Result<(), String> {
    let html = blocking(move || compiled_html(&project_id)).await?;
    open_output_in_browser(&html)
        .map_err(|error| String::from(AppError::new("notebook.open_html_failed").detail(error)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn version_probes_drop_the_appimage_launcher_paths_for_host_programs() {
        let image = crate::proc::SimulatedAppImage::start();
        let applied = |program: &Path| -> BTreeMap<String, Option<std::ffi::OsString>> {
            probe_command(program)
                .get_envs()
                .map(|(name, value)| {
                    (
                        name.to_string_lossy().into_owned(),
                        value.map(std::ffi::OsStr::to_os_string),
                    )
                })
                .collect()
        };
        let rscript = applied(Path::new("/usr/bin/Rscript"));
        assert_eq!(rscript["PYTHONHOME"], None);
        assert_eq!(rscript["LD_LIBRARY_PATH"], None);
        assert!(applied(&image.root.join("usr/bin/tectonic")).is_empty());
    }

    #[test]
    fn the_bundled_manifest_pins_both_tools_for_every_release_target() {
        let manifest = parse_manifest(MANIFEST_JSON).unwrap();
        assert_eq!(manifest.tools.quarto.version, "1.10.19");
        assert_eq!(manifest.tools.calepin.version, "0.0.61");
        for release in [&manifest.tools.quarto, &manifest.tools.calepin] {
            assert_eq!(release.license, "MIT");
            for target in [
                "aarch64-apple-darwin",
                "x86_64-apple-darwin",
                "aarch64-unknown-linux-gnu",
                "x86_64-unknown-linux-gnu",
                "x86_64-pc-windows-msvc",
            ] {
                let artifact = release.targets.get(target).unwrap();
                assert_eq!(artifact.archive_sha256.len(), 64, "{target}");
                assert!(artifact
                    .archive_sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit()));
                assert!(artifact.archive_size > 1_000_000, "{target}");
                assert!(ArchiveKind::parse(&artifact.archive_type).is_some());
                assert!(artifact.url.starts_with("https://github.com/"), "{target}");
                assert!(!artifact.executables.is_empty());
                assert_eq!(
                    crate::toolchain_download::tree_executable_candidates(&artifact.executables)
                        .len(),
                    artifact.executables.len()
                );
                if target.contains("windows") {
                    assert_eq!(artifact.archive_type, "zip", "{target}");
                    assert!(artifact
                        .executables
                        .iter()
                        .all(|path| path.ends_with(".exe")));
                }
            }
        }
        assert!(manifest
            .allowed_download_hosts
            .iter()
            .any(|host| host == "github.com"));
    }

    #[test]
    fn versions_are_read_from_each_tools_version_line() {
        assert_eq!(parse_version("1.10.19\n").as_deref(), Some("1.10.19"));
        assert_eq!(parse_version("calepin 0.0.61\n").as_deref(), Some("0.0.61"));
        assert_eq!(
            parse_version("Rscript (R) version 4.4.1 (2024-06-14)\n").as_deref(),
            Some("4.4.1")
        );
        assert_eq!(parse_version("Python 3.12.4\n").as_deref(), Some("3.12.4"));
        assert_eq!(
            parse_version("julia version 1.11.1\n").as_deref(),
            Some("1.11.1")
        );
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn tool_names_round_trip() {
        for tool in [NotebookTool::Quarto, NotebookTool::Calepin] {
            assert_eq!(NotebookTool::parse(tool.name()), Some(tool));
        }
        assert_eq!(NotebookTool::parse(" Quarto "), Some(NotebookTool::Quarto));
        assert_eq!(NotebookTool::parse("pandoc"), None);
        assert!(parse_tool("pandoc")
            .unwrap_err()
            .contains("notebook.unknown_tool"));
    }

    #[test]
    fn known_locations_cover_the_usual_installers() {
        let home = Path::new("/home/writer");
        let quarto = known_locations(NotebookTool::Quarto, Some(home));
        assert!(!quarto.is_empty());
        let calepin = known_locations(NotebookTool::Calepin, Some(home));
        assert!(calepin
            .iter()
            .any(|path| path.starts_with(home.join(".cargo"))));
    }

    #[test]
    fn a_download_left_by_an_older_pin_is_reported_and_removed_without_touching_the_pinned_one() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        for folder in ["1.10.18/bin", "1.10.19/bin", "1.9.0", ".staging"] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        std::fs::write(root.join("1.10.18/bin/quarto"), "old").unwrap();
        std::fs::write(root.join("1.10.19/bin/quarto"), "pinned").unwrap();
        std::fs::write(root.join("notes"), "not a version").unwrap();

        assert_eq!(superseded_in(root, "1.10.19"), ["1.10.18", "1.9.0"]);

        remove_superseded_in(root, "1.10.19");

        assert!(superseded_in(root, "1.10.19").is_empty());
        assert!(root.join("1.10.19/bin/quarto").is_file());
        assert!(root.join(".staging").is_dir());
        assert!(root.join("notes").is_file());
        assert!(!root.join("1.10.18").exists());
        assert!(superseded_in(&root.join("missing"), "1.10.19").is_empty());
    }

    #[test]
    fn versions_compare_by_number_and_an_unknown_version_stays_usable() {
        assert!(!older_than("1.10.19", "1.5"));
        assert!(!older_than("1.5.0", "1.5"));
        assert!(older_than("1.4.557", "1.5"));
        assert!(older_than("0.9.1", "1.5"));
        assert!(!older_than("99.9.9", "1.5"));
        assert!(!older_than("unknown", "1.5"));
        assert_eq!(major_minor("1.10.19"), Some((1, 10)));
        assert_eq!(major_minor("1"), None);
    }

    #[test]
    fn only_quarto_has_a_minimum_and_it_is_the_one_oleaflys_flags_need() {
        let manifest = parse_manifest(MANIFEST_JSON).unwrap();
        assert_eq!(
            manifest.tools.quarto.minimum_version.as_deref(),
            Some("1.5")
        );
        assert_eq!(manifest.tools.calepin.minimum_version, None);
        assert!(!older_than(
            &manifest.tools.quarto.version,
            manifest.tools.quarto.minimum_version.as_deref().unwrap()
        ));
    }

    #[test]
    fn an_old_system_copy_gives_way_to_the_download_and_otherwise_stays_first() {
        let system = PathBuf::from("/usr/bin/quarto");
        let managed = PathBuf::from("/data/quarto");
        assert_eq!(
            preferred_tool(Some(system.clone()), Some(managed.clone()), |_| true),
            Some(managed.clone())
        );
        assert_eq!(
            preferred_tool(Some(system.clone()), Some(managed.clone()), |_| false),
            Some(system.clone())
        );
        assert_eq!(
            preferred_tool(Some(system.clone()), None, |_| true),
            Some(system)
        );
        assert_eq!(
            preferred_tool(None, Some(managed.clone()), |_| true),
            Some(managed)
        );
        assert_eq!(preferred_tool(None, None, |_| true), None);
    }

    #[test]
    fn a_mirror_comes_before_the_upstream_address() {
        let artifact = |mirror: &str| -> ToolArtifact {
            serde_json::from_str(&format!(
                r#"{{"archiveType":"zip","archiveSha256":"a","archiveSize":1,"executables":[],"url":"https://github.com/x"{mirror}}}"#
            ))
            .unwrap()
        };
        assert_eq!(artifact("").download_urls(), ["https://github.com/x"]);
        assert_eq!(
            artifact(r#","mirrorUrl":"https://mirrors.oleafly.com/x""#).download_urls(),
            ["https://mirrors.oleafly.com/x", "https://github.com/x"]
        );
        assert!(parse_manifest(MANIFEST_JSON)
            .unwrap()
            .allowed_download_hosts
            .iter()
            .any(|host| host == "mirrors.oleafly.com"));
    }

    #[test]
    fn install_failures_are_coded_so_the_ui_can_translate_them() {
        use ToolchainInstallErrorKind as Kind;
        assert_eq!(
            install_failure_code(Kind::DownloadFailed, false),
            "notebook.download_failed"
        );
        assert_eq!(
            install_failure_code(Kind::DownloadFailed, true),
            "notebook.install_unverified"
        );
        assert_eq!(
            install_failure_code(Kind::IntegrityFailure, false),
            "notebook.install_unverified"
        );
        assert_eq!(
            install_failure_code(Kind::InstallFailed, false),
            "notebook.install_failed"
        );
        assert_eq!(
            install_failure_code(Kind::AlreadyInstalling, false),
            "notebook.busy"
        );
    }

    fn venv(project: &Path, name: &str, modules: &[&str]) -> PathBuf {
        let environment = project.join(name);
        let packages = environment.join("lib/python3.12/site-packages");
        std::fs::create_dir_all(&packages).unwrap();
        for module in modules {
            std::fs::create_dir_all(packages.join(module)).unwrap();
        }
        std::fs::create_dir_all(environment.join("bin")).unwrap();
        std::fs::write(environment.join("bin/python3"), "").unwrap();
        std::fs::write(environment.join("pyvenv.cfg"), "home = /usr/bin\n").unwrap();
        environment
    }

    fn variable<'a>(variables: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        variables
            .iter()
            .find(|(found, _)| *found == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn a_project_environment_with_jupyter_runs_the_code_when_code_is_on() {
        let project = tempfile::tempdir().unwrap();
        let environment = venv(project.path(), ".venv", &JUPYTER_MODULES);
        let chosen = quarto_python_variables(project.path(), true);
        assert_eq!(
            variable(&chosen, "QUARTO_PYTHON"),
            Some(environment.join("bin").join("python3").to_str().unwrap())
        );
        assert_eq!(
            variable(&chosen, "VIRTUAL_ENV"),
            Some(environment.to_str().unwrap())
        );
    }

    #[test]
    fn a_project_environment_reaches_quarto_without_the_verbatim_prefix() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path().canonicalize().unwrap();
        let environment = venv(&root, ".venv", &JUPYTER_MODULES);
        let chosen = quarto_python_variables(&root, true);
        let plain = oleafly_core::plain_path(&environment);
        assert_eq!(
            variable(&chosen, "QUARTO_PYTHON"),
            Some(plain.join("bin").join("python3").to_str().unwrap())
        );
        assert_eq!(
            variable(&chosen, "VIRTUAL_ENV"),
            Some(plain.to_str().unwrap())
        );
        for (_, value) in &chosen {
            assert!(!value.starts_with(r"\\?\"), "{value}");
        }
    }

    #[test]
    fn code_off_ignores_the_project_environment() {
        let project = tempfile::tempdir().unwrap();
        venv(project.path(), ".venv", &JUPYTER_MODULES);
        assert_eq!(
            variable(
                &quarto_python_variables(project.path(), false),
                "VIRTUAL_ENV"
            ),
            None
        );
    }

    #[test]
    fn an_environment_without_jupyter_is_passed_over() {
        let project = tempfile::tempdir().unwrap();
        venv(project.path(), ".venv", &["nbformat"]);
        assert_eq!(project_python(project.path()), None);
        let complete = venv(project.path(), "env", &JUPYTER_MODULES);
        assert_eq!(project_python(project.path()).unwrap().0, complete);
    }

    #[test]
    fn a_folder_without_pyvenv_cfg_is_not_an_environment() {
        let project = tempfile::tempdir().unwrap();
        let environment = venv(project.path(), "env", &JUPYTER_MODULES);
        std::fs::remove_file(environment.join("pyvenv.cfg")).unwrap();
        assert_eq!(project_python(project.path()), None);
    }

    #[test]
    fn the_windows_layout_of_an_environment_is_found() {
        let project = tempfile::tempdir().unwrap();
        let environment = project.path().join("venv");
        let packages = environment.join("Lib").join("site-packages");
        for module in JUPYTER_MODULES {
            std::fs::create_dir_all(packages.join(module)).unwrap();
        }
        std::fs::create_dir_all(environment.join("Scripts")).unwrap();
        let python = environment.join("Scripts").join("python.exe");
        std::fs::write(&python, "").unwrap();
        std::fs::write(environment.join("pyvenv.cfg"), "").unwrap();
        assert_eq!(project_python(project.path()), Some((environment, python)));
    }

    #[test]
    fn an_environment_file_naming_the_python_wins() {
        let project = tempfile::tempdir().unwrap();
        venv(project.path(), ".venv", &JUPYTER_MODULES);
        std::fs::write(
            project.path().join("_environment"),
            "QUARTO_PYTHON=/opt/py\n",
        )
        .unwrap();
        assert!(names_quarto_python(project.path()));
        assert!(quarto_python_variables(project.path(), true).is_empty());
        std::fs::write(project.path().join("_environment"), "OTHER=1\n").unwrap();
        assert!(!names_quarto_python(project.path()));
    }

    #[test]
    fn notebook_runs_get_a_utf8_locale_when_the_launch_left_none() {
        let project = tempfile::tempdir().unwrap();
        let expected = crate::proc::fallback_utf8_locale();
        let quarto = quarto_runtime_variables(project.path(), false);
        assert_eq!(variable(&quarto, "LANG"), expected);
        let calepin = calepin_runtime_variables(project.path());
        assert_eq!(variable(&calepin, "LANG"), expected);
    }

    #[test]
    fn notebook_runs_talk_to_python_in_utf8_on_windows() {
        let project = tempfile::tempdir().unwrap();
        let expected = (cfg!(windows) && unset("PYTHONIOENCODING")).then_some("utf-8");
        for allow_code in [false, true] {
            let quarto = quarto_runtime_variables(project.path(), allow_code);
            assert_eq!(variable(&quarto, "PYTHONIOENCODING"), expected);
        }
        let calepin = calepin_runtime_variables(project.path());
        assert_eq!(variable(&calepin, "PYTHONIOENCODING"), expected);
    }

    #[test]
    fn r_installed_per_user_on_windows_is_found_newest_first() {
        let root = tempfile::tempdir().unwrap();
        for version in ["R-4.3.3", "R-4.5.0"] {
            let bin = root.path().join(version).join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::write(bin.join("Rscript.exe"), "").unwrap();
        }
        let found = r_installations_under(root.path());
        assert_eq!(found.len(), 2);
        assert!(found[0].starts_with(root.path().join("R-4.5.0")));
        assert!(r_installations_under(&root.path().join("missing")).is_empty());
    }

    #[test]
    fn nested_html_output_is_found_and_a_missing_one_is_reported() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path().canonicalize().unwrap();
        std::fs::write(root.join("_quarto.yml"), "").unwrap();
        std::fs::create_dir_all(root.join("paper")).unwrap();
        let input = root.join("paper").join("main.qmd");
        std::fs::write(&input, "").unwrap();
        let build = root.join("build");
        std::fs::create_dir_all(build.join("paper")).unwrap();
        assert_eq!(compiled_html_in(&build, Some(&input)), None);
        let nested = build
            .join("paper")
            .join(format!("{}.html", crate::paths::ENTRY_STEM));
        std::fs::write(&nested, "").unwrap();
        assert_eq!(compiled_html_in(&build, Some(&input)), Some(nested));
        let flat = build.join(format!("{}.html", crate::paths::ENTRY_STEM));
        std::fs::write(&flat, "").unwrap();
        assert_eq!(compiled_html_in(&build, None), Some(flat));
    }

    #[cfg(unix)]
    #[test]
    fn opening_html_drops_the_appimage_launcher_paths() {
        let _image = crate::proc::SimulatedAppImage::start();
        let commands = html_opener_commands(Path::new("/tmp/output.html"));
        assert!(!commands.is_empty());
        for command in &commands {
            let library_path = command
                .get_envs()
                .find(|(name, _)| *name == "LD_LIBRARY_PATH");
            assert_eq!(library_path.map(|(_, value)| value), Some(None));
        }
    }

    #[test]
    fn a_second_install_of_the_same_tool_is_refused_while_one_runs() {
        let first = InstallClaim::take(NotebookTool::Calepin).unwrap();
        assert!(InstallClaim::take(NotebookTool::Calepin)
            .err()
            .unwrap()
            .contains("notebook.busy"));
        assert!(installing(NotebookTool::Calepin));
        drop(first);
        assert!(!installing(NotebookTool::Calepin));
    }
}
