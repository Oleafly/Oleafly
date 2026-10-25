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

static INSTALLING: Mutex<BTreeSet<NotebookTool>> = Mutex::new(BTreeSet::new());

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
    offered: bool,
    download_bytes: Option<u64>,
    license: String,
    installing: bool,
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

pub(crate) fn find_tool(tool: NotebookTool) -> Option<PathBuf> {
    system_tool(tool).or_else(|| managed_tool(tool))
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

fn probe_version(path: &Path) -> Option<String> {
    let mut command = std::process::Command::new(path);
    command.arg("--version").no_console();
    let output = crate::proc::output_contained_with_timeout(command, PROBE_TIMEOUT).ok()?;
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
    ToolStatus {
        tool,
        pinned_version: release.version.clone(),
        active: system.clone().or_else(|| managed.clone()),
        system,
        managed,
        offered: artifact.is_some(),
        download_bytes: artifact.map(|artifact| artifact.archive_size),
        license: release.license.clone(),
        installing: installing(tool),
    }
}

fn locate(name: &str) -> Option<PathBuf> {
    crate::program_locator::locate_native(name).map(|located| located.path)
}

fn windows_r_installations() -> Vec<PathBuf> {
    let Some(programs) = std::env::var_os("ProgramFiles") else {
        return Vec::new();
    };
    let root = PathBuf::from(programs).join("R");
    let Ok(entries) = std::fs::read_dir(&root) else {
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

pub(crate) fn quarto_runtime_variables() -> Vec<(&'static str, String)> {
    let mut variables = Vec::new();
    if unset("QUARTO_R") {
        if let Some(path) = rscript() {
            variables.push(("QUARTO_R", path.to_string_lossy().into_owned()));
        }
    }
    if unset("QUARTO_PYTHON") {
        if let Some(path) = python() {
            variables.push(("QUARTO_PYTHON", path.to_string_lossy().into_owned()));
        }
    }
    variables
}

pub(crate) fn calepin_runtime_variables(project_dir: &Path) -> Vec<(&'static str, String)> {
    let mut variables = Vec::new();
    if unset("CALEPIN_PYTHON") && !project_dir.join(".venv").is_dir() {
        if let Some(path) = python() {
            variables.push(("CALEPIN_PYTHON", path.to_string_lossy().into_owned()));
        }
    }
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
        urls: vec![artifact.url.clone()],
        allowed_hosts: manifest().allowed_download_hosts.clone(),
        archive_kind,
        archive_size: artifact.archive_size,
        archive_sha256: artifact.archive_sha256.clone(),
        install_dir: install_dir(tool)?,
        executables: artifact.executables.clone(),
        timeouts: DownloadTimeouts::default(),
    })
}

fn install_failure(tool: NotebookTool, error: &ToolchainInstallError) -> String {
    match error.kind() {
        ToolchainInstallErrorKind::AlreadyInstalling => tool_error("notebook.busy", tool),
        ToolchainInstallErrorKind::IntegrityFailure => {
            tool_error("notebook.install_unverified", tool)
        }
        _ => error.message().to_owned(),
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
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&root)
            .map_err(|error| format!("Could not remove {}: {error}", root.display()))?,
        _ => return Err(tool_error("notebook.not_managed", tool)),
    }
    Ok(current_status())
}

fn compiled_html(project_id: &str) -> Result<PathBuf, String> {
    let build = crate::paths::existing_build_dir(project_id)?
        .ok_or_else(|| String::from(AppError::new("notebook.no_html_output")))?;
    let html = build.join(format!("{}.html", crate::paths::ENTRY_STEM));
    if !std::fs::symlink_metadata(&html).is_ok_and(|metadata| metadata.is_file()) {
        return Err(AppError::new("notebook.no_html_output").into());
    }
    Ok(html)
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
    open::that_detached(&html)
        .map_err(|error| format!("Oleafly could not open the HTML output: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_manifest_pins_both_tools_for_every_release_target() {
        let manifest = parse_manifest(MANIFEST_JSON).unwrap();
        assert_eq!(manifest.tools.quarto.version, "1.10.19");
        assert_eq!(manifest.tools.calepin.version, "0.0.61");
        for release in [&manifest.tools.quarto, &manifest.tools.calepin] {
            assert_eq!(release.license, "MIT");
            for target in [
                "aarch64-apple-darwin",
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
