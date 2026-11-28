use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{
    blocking, current_status, environment_python, manifest, python, rscript, site_packages,
    tools_root, NotebookToolchainStatus, RuntimeName, JUPYTER_MODULES,
};
use crate::app_error::AppError;
use crate::proc::NoConsole;
use crate::toolchain_download::{
    ArchiveKind, CancelToken, DownloadTimeouts, InstallPhase, InstallProgress,
    ToolchainInstallRequest,
};

const PACKAGE_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PACKAGES: usize = 20;
const OUTPUT_TAIL: usize = 12;
const CRAN: &str = "https://cloud.r-project.org";
const R_DOCUMENT_PACKAGES: [&str; 2] = ["knitr", "rmarkdown"];
const JUPYTER_PACKAGE: &str = "jupyter";
const JUPYTER_FOR_QUARTO: [&str; 5] = [
    "jupyter-core",
    "nbformat",
    "nbclient",
    "ipykernel",
    "pyyaml",
];
const MANAGED_ENVIRONMENT: &str = "python-environment";
const INSTALLERS_FOLDER: &str = "installers";
const R_INSTALL_SCRIPT: &str = r#"args <- commandArgs(trailingOnly = TRUE)
repos <- args[1]
packages <- args[-1]
writable <- function(path) nzchar(path) && dir.exists(path) && file.access(path, 2) == 0
target <- .libPaths()[1]
if (!writable(target)) {
  target <- strsplit(Sys.getenv("R_LIBS_USER"), .Platform$path.sep)[[1]][1]
  dir.create(target, recursive = TRUE, showWarnings = FALSE)
}
.libPaths(unique(c(target, .libPaths())))
install.packages(packages, lib = target, repos = c(CRAN = repos))
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  message("Not installed: ", paste(missing, collapse = ", "))
  quit(status = 1)
}
"#;
const R_CHECK_SCRIPT: &str = r#"for (name in commandArgs(trailingOnly = TRUE)) cat(name, nzchar(system.file(package = name)), "\n")
"#;
const PYTHON_CHECK_SCRIPT: &str = "import importlib.util, sys\nfor name in sys.argv[1:]:\n    print(name, importlib.util.find_spec(name) is not None)\n";

static BUSY: Mutex<BTreeSet<Work>> = Mutex::new(BTreeSet::new());

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Work {
    Installer(RuntimeName),
    RPackages,
    PythonPackages,
}

struct Claim(Work);

impl Claim {
    fn take(work: Work, label: &str) -> Result<Self, String> {
        if !BUSY
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(work)
        {
            return Err(AppError::new("notebook.busy").param("tool", label).into());
        }
        Ok(Self(work))
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        BUSY.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.0);
    }
}

#[derive(Deserialize)]
pub(super) struct Installers {
    r: InstallerRelease,
    python: InstallerRelease,
}

#[derive(Deserialize)]
struct InstallerRelease {
    version: String,
    targets: BTreeMap<String, InstallerArtifact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallerArtifact {
    file_name: String,
    sha256: String,
    size: u64,
    url: String,
    #[serde(default)]
    fallback_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeInstaller {
    version: String,
    download_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimePackage {
    name: String,
    installed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeInstallProgress {
    runtime: RuntimeName,
    phase: InstallPhase,
    received_bytes: u64,
    total_bytes: u64,
}

fn release(runtime: RuntimeName) -> Option<&'static InstallerRelease> {
    let installers = &manifest().installers;
    match runtime {
        RuntimeName::R => Some(&installers.r),
        RuntimeName::Python => Some(&installers.python),
        RuntimeName::Julia => None,
    }
}

fn artifact(
    runtime: RuntimeName,
) -> Option<(&'static InstallerRelease, &'static InstallerArtifact)> {
    let release = release(runtime)?;
    let target = oleafly_core::typst_toolchain::host_target()?;
    release
        .targets
        .get(target)
        .map(|artifact| (release, artifact))
}

pub(super) fn installer(runtime: RuntimeName) -> Option<RuntimeInstaller> {
    artifact(runtime).map(|(release, artifact)| RuntimeInstaller {
        version: release.version.clone(),
        download_bytes: artifact.size,
    })
}

fn parse_runtime(value: &str) -> Result<RuntimeName, String> {
    match value.trim() {
        "r" => Ok(RuntimeName::R),
        "python" => Ok(RuntimeName::Python),
        other => Err(AppError::new("notebook.not_offered")
            .param("tool", other)
            .into()),
    }
}

fn runtime_label(runtime: RuntimeName) -> &'static str {
    match runtime {
        RuntimeName::R => "R",
        RuntimeName::Python => "Python",
        RuntimeName::Julia => "Julia",
    }
}

fn installer_request(runtime: RuntimeName) -> Result<ToolchainInstallRequest, String> {
    let (release, artifact) = artifact(runtime).ok_or_else(|| {
        String::from(AppError::new("notebook.not_offered").param("tool", runtime_label(runtime)))
    })?;
    let folder = format!(
        "{}-{}",
        runtime_label(runtime).to_lowercase(),
        release.version
    );
    Ok(ToolchainInstallRequest {
        urls: std::iter::once(artifact.url.clone())
            .chain(artifact.fallback_url.clone())
            .collect(),
        allowed_hosts: manifest().allowed_download_hosts.clone(),
        archive_kind: ArchiveKind::Binary,
        archive_size: artifact.size,
        archive_sha256: artifact.sha256.clone(),
        archive_member: None,
        binary_size: artifact.size,
        binary_sha256: artifact.sha256.clone(),
        install_dir: tools_root()?.join(INSTALLERS_FOLDER).join(folder),
        binary_name: artifact.file_name.clone(),
        timeouts: DownloadTimeouts::default(),
    })
}

fn valid_r_package(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '.')
        && !name.ends_with('.')
}

fn valid_python_package(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && name
            .chars()
            .last()
            .is_some_and(|last| last.is_ascii_alphanumeric())
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn checked_packages(packages: Vec<String>, valid: fn(&str) -> bool) -> Result<Vec<String>, String> {
    let mut unique: Vec<String> = Vec::new();
    for package in packages {
        let package = package.trim().to_owned();
        if !valid(&package) || package.len() > 100 {
            return Err(AppError::new("notebook.package_name_invalid")
                .param("package", package)
                .into());
        }
        if !unique.contains(&package) {
            unique.push(package);
        }
    }
    if unique.is_empty() || unique.len() > MAX_PACKAGES {
        return Err(AppError::new("notebook.package_name_invalid")
            .param("package", "")
            .into());
    }
    Ok(unique)
}

fn with_document_packages(mut packages: Vec<String>) -> Vec<String> {
    if packages
        .iter()
        .any(|package| R_DOCUMENT_PACKAGES.contains(&package.as_str()))
    {
        for package in R_DOCUMENT_PACKAGES {
            if !packages.iter().any(|known| known == package) {
                packages.push(package.to_owned());
            }
        }
    }
    packages
}

fn output_tail(output: &std::process::Output) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(OUTPUT_TAIL)..].join("\n")
}

fn run_install(command: std::process::Command, failure: AppError) -> Result<(), String> {
    match crate::proc::output_contained_with_timeout(command, PACKAGE_TIMEOUT) {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(failure.detail(output_tail(&output)).into()),
        Err(error) => Err(failure.detail(error).into()),
    }
}

fn host_command(program: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    command
        .no_console()
        .current_dir(std::env::temp_dir())
        .env("PYTHONSAFEPATH", "1");
    crate::proc::clear_appimage_env(&mut command);
    command
}

fn r_script_file(name: &str, text: &str) -> Result<PathBuf, String> {
    let folder = tools_root()?.join("r");
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let script = folder.join(name);
    if std::fs::read_to_string(&script).ok().as_deref() != Some(text) {
        crate::sandbox::atomic_write(&script, text.as_bytes())?;
    }
    Ok(script)
}

fn allowed_without_code(
    project_id: Option<&str>,
    packages: &[String],
    document_packages: &[&str],
) -> Result<(), String> {
    let beyond = packages
        .iter()
        .any(|package| !document_packages.contains(&package.as_str()));
    if beyond && !project_id.is_some_and(project_code_allowed) {
        return Err(AppError::new("notebook.packages_need_code")
            .param("packages", packages.join(", "))
            .into());
    }
    Ok(())
}

fn install_r_packages_blocking(
    project_id: Option<String>,
    packages: Vec<String>,
) -> Result<NotebookToolchainStatus, String> {
    let packages = with_document_packages(checked_packages(packages, valid_r_package)?);
    allowed_without_code(project_id.as_deref(), &packages, &R_DOCUMENT_PACKAGES)?;
    let rscript = rscript().ok_or_else(|| String::from(AppError::new("notebook.r_missing")))?;
    let _claim = Claim::take(Work::RPackages, &packages.join(", "))?;
    let mut command = host_command(&rscript);
    command
        .args(["--no-save", "--no-restore", "--no-init-file"])
        .arg(r_script_file("install-packages.R", R_INSTALL_SCRIPT)?)
        .arg(CRAN)
        .args(&packages);
    run_install(
        command,
        AppError::new("notebook.r_packages_failed").param("packages", packages.join(", ")),
    )?;
    Ok(current_status())
}

pub(super) fn managed_environment() -> Option<PathBuf> {
    tools_root().ok().map(|root| root.join(MANAGED_ENVIRONMENT))
}

fn complete_environment(environment: &Path) -> Option<PathBuf> {
    let has_pip = site_packages(environment)
        .iter()
        .any(|folder| folder.join("pip").is_dir());
    (environment.join("pyvenv.cfg").is_file() && has_pip)
        .then(|| environment_python(environment))
        .flatten()
}

pub(super) fn managed_python() -> Option<PathBuf> {
    complete_environment(&managed_environment()?)
}

fn create_managed_environment(base: &Path, environment: &Path) -> Result<(), String> {
    let staging = environment.with_extension("partial");
    let _ = std::fs::remove_dir_all(&staging);
    let mut command = host_command(base);
    command
        .args(["-m", "venv", "--system-site-packages"])
        .arg(&staging);
    let created = run_install(command, AppError::new("notebook.python_environment_failed"))
        .and_then(|()| {
            complete_environment(&staging)
                .map(|_| ())
                .ok_or_else(|| String::from(AppError::new("notebook.python_environment_failed")))
        });
    if let Err(error) = created {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = std::fs::remove_dir_all(environment);
    std::fs::rename(&staging, environment).map_err(|error| {
        let _ = std::fs::remove_dir_all(&staging);
        String::from(AppError::new("notebook.python_environment_failed").detail(error))
    })
}

fn conda_roots(home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = home {
        if let Some(listed) =
            oleafly_core::read_bounded(&home.join(".conda").join("environments.txt"), 64 * 1024)
        {
            roots.extend(
                listed
                    .lossy_text()
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .filter_map(|line| Path::new(line).parent().map(Path::to_path_buf)),
            );
        }
        for base in [
            "miniconda3",
            "miniforge3",
            "mambaforge",
            "anaconda3",
            "opt/anaconda3",
            "opt/miniconda3",
            ".conda",
        ] {
            roots.push(home.join(base).join("envs"));
        }
    }
    roots.extend(
        [
            "/opt/homebrew/Caskroom/miniforge/base/envs",
            "/opt/conda/envs",
        ]
        .map(PathBuf::from),
    );
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("miniconda3").join("envs"));
    }
    roots.dedup();
    roots
}

fn conda_environment_name(project_dir: &Path) -> Option<String> {
    ["environment.yml", "environment.yaml"]
        .iter()
        .find_map(|name| {
            let read = oleafly_core::read_bounded(&project_dir.join(name), 256 * 1024)?;
            read.lossy_text().lines().find_map(|line| {
                let value = line.strip_prefix("name:")?.trim().trim_matches(['"', '\'']);
                (!value.is_empty()
                    && value.chars().all(|character| {
                        character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
                    }))
                .then(|| value.to_owned())
            })
        })
}

fn conda_python_in(environment: &Path) -> Option<PathBuf> {
    [
        environment.join("bin").join("python"),
        environment.join("python.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

pub(super) fn conda_python(project_dir: &Path, home: Option<&Path>) -> Option<PathBuf> {
    let name = conda_environment_name(project_dir)?;
    conda_roots(home)
        .into_iter()
        .find_map(|root| conda_python_in(&root.join(&name)))
}

pub(super) fn project_environment(project_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    super::project_environment_where(project_dir, |_| true)
}

fn project_code_allowed(project_id: &str) -> bool {
    crate::project::read_meta(project_id)
        .and_then(|meta| crate::trust::restrict_compile_meta(project_id, meta))
        .is_ok_and(|meta| meta.allow_shell_escape)
}

fn python_target(project_id: Option<&str>) -> Result<PathBuf, String> {
    if let Some(project_id) = project_id.filter(|id| project_code_allowed(id)) {
        let project_dir = crate::paths::project_dir(project_id)?;
        if let Some((_, python)) = project_environment(&project_dir) {
            return Ok(oleafly_core::plain_path(&python));
        }
        if let Some(python) = conda_python(&project_dir, dirs::home_dir().as_deref()) {
            return Ok(python);
        }
    }
    if let Some(python) = managed_python() {
        return Ok(python);
    }
    let base = python().ok_or_else(|| String::from(AppError::new("notebook.python_missing")))?;
    let environment = managed_environment()
        .ok_or_else(|| String::from(AppError::new("notebook.python_missing")))?;
    create_managed_environment(&base, &environment)?;
    managed_python()
        .ok_or_else(|| String::from(AppError::new("notebook.python_environment_failed")))
}

fn install_python_packages_blocking(
    project_id: Option<String>,
    packages: Vec<String>,
) -> Result<NotebookToolchainStatus, String> {
    let mut packages = checked_packages(packages, valid_python_package)?;
    allowed_without_code(project_id.as_deref(), &packages, &[JUPYTER_PACKAGE])?;
    let _claim = Claim::take(Work::PythonPackages, &packages.join(", "))?;
    let python = python_target(project_id.as_deref())?;
    let has_jupyter = python_packages(&python)
        .first()
        .is_some_and(|package| package.installed);
    let wants_jupyter = packages.iter().any(|package| package == JUPYTER_PACKAGE);
    packages.retain(|package| package != JUPYTER_PACKAGE);
    if wants_jupyter || !has_jupyter {
        packages.extend(
            JUPYTER_FOR_QUARTO
                .iter()
                .map(|package| (*package).to_owned()),
        );
    }
    let mut command = host_command(&python);
    command
        .args([
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
        ])
        .args(&packages)
        .env("PIP_REQUIRE_VIRTUALENV", "false");
    run_install(
        command,
        AppError::new("notebook.python_packages_failed").param("packages", packages.join(", ")),
    )?;
    Ok(current_status())
}

fn checked_lines(output: &std::process::Output) -> BTreeMap<String, bool> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            let found = parts.next()?;
            Some((name.to_owned(), matches!(found, "TRUE" | "True")))
        })
        .collect()
}

fn package_states(names: &[&str], found: Option<BTreeMap<String, bool>>) -> Vec<RuntimePackage> {
    let Some(found) = found else {
        return Vec::new();
    };
    names
        .iter()
        .map(|name| RuntimePackage {
            name: (*name).to_owned(),
            installed: found.get(*name).copied().unwrap_or(false),
        })
        .collect()
}

pub(super) fn r_packages(rscript: &Path) -> Vec<RuntimePackage> {
    let Ok(script) = r_script_file("check-packages.R", R_CHECK_SCRIPT) else {
        return Vec::new();
    };
    let mut command = host_command(rscript);
    command
        .args(["--no-save", "--no-restore", "--no-init-file"])
        .arg(script)
        .args(R_DOCUMENT_PACKAGES);
    let found = crate::proc::output_contained_with_timeout(command, CHECK_TIMEOUT)
        .ok()
        .filter(|output| output.status.success())
        .map(|output| checked_lines(&output));
    package_states(&R_DOCUMENT_PACKAGES, found)
}

pub(super) fn python_packages(python: &Path) -> Vec<RuntimePackage> {
    let mut command = host_command(python);
    command
        .args(["-c", PYTHON_CHECK_SCRIPT])
        .args(JUPYTER_MODULES);
    let found = crate::proc::output_contained_with_timeout(command, CHECK_TIMEOUT)
        .ok()
        .filter(|output| output.status.success())
        .map(|output| checked_lines(&output));
    let jupyter = found.map(|found| {
        let all = JUPYTER_MODULES
            .iter()
            .all(|module| found.get(*module).copied().unwrap_or(false));
        BTreeMap::from([(JUPYTER_PACKAGE.to_owned(), all)])
    });
    package_states(&[JUPYTER_PACKAGE], jupyter)
}

fn open_installer(path: &Path) -> Result<(), String> {
    open::that_detached(path).map_err(|error| {
        String::from(AppError::new("notebook.installer_open_failed").detail(error))
    })
}

#[tauri::command]
pub async fn install_language_runtime(
    runtime: String,
    on_progress: tauri::ipc::Channel<RuntimeInstallProgress>,
) -> Result<(), String> {
    let runtime = parse_runtime(&runtime)?;
    let request = blocking(move || installer_request(runtime)).await?;
    let claim = Claim::take(Work::Installer(runtime), runtime_label(runtime))?;
    let cancel = CancelToken::new();
    let stop = cancel.clone();
    let last: Mutex<Option<(InstallPhase, u64)>> = Mutex::new(None);
    let progress = move |event: InstallProgress| {
        let percent = (event.received_bytes.min(event.total_bytes) * 100)
            .checked_div(event.total_bytes)
            .unwrap_or(0);
        {
            let mut last = last.lock().unwrap_or_else(PoisonError::into_inner);
            if *last == Some((event.phase, percent)) {
                return;
            }
            *last = Some((event.phase, percent));
        }
        let delivered = on_progress.send(RuntimeInstallProgress {
            runtime,
            phase: event.phase,
            received_bytes: event.received_bytes,
            total_bytes: event.total_bytes,
        });
        if delivered.is_err() {
            stop.cancel();
        }
    };
    let outcome = crate::toolchain_download::install_toolchain(request, cancel, progress)
        .await
        .map_err(|error| {
            String::from(
                AppError::new("notebook.download_failed")
                    .param("tool", runtime_label(runtime))
                    .detail(error.message()),
            )
        })?;
    let installer = outcome.binary_path().to_path_buf();
    blocking(move || open_installer(&installer)).await?;
    drop(claim);
    Ok(())
}

#[tauri::command]
pub async fn install_r_packages(
    project_id: Option<String>,
    packages: Vec<String>,
) -> Result<NotebookToolchainStatus, String> {
    blocking(move || install_r_packages_blocking(project_id, packages)).await
}

#[tauri::command]
pub async fn install_python_packages(
    project_id: Option<String>,
    packages: Vec<String>,
) -> Result<NotebookToolchainStatus, String> {
    blocking(move || install_python_packages_blocking(project_id, packages)).await
}

fn remove_installers_in(folder: &Path, installed: impl Fn(RuntimeName) -> bool) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let finished: Vec<String> = [RuntimeName::R, RuntimeName::Python]
        .into_iter()
        .filter(|runtime| installed(*runtime))
        .map(|runtime| format!("{}-", runtime_label(runtime).to_lowercase()))
        .collect();
    for entry in entries.flatten() {
        let name = entry.file_name();
        if finished
            .iter()
            .any(|prefix| name.to_string_lossy().starts_with(prefix.as_str()))
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[tauri::command]
pub async fn recheck_notebook_toolchain() -> Result<NotebookToolchainStatus, String> {
    blocking(|| {
        crate::program_locator::refresh();
        if let Ok(root) = tools_root() {
            remove_installers_in(&root.join(INSTALLERS_FOLDER), |runtime| match runtime {
                RuntimeName::R => rscript().is_some(),
                RuntimeName::Python => python().is_some(),
                RuntimeName::Julia => false,
            });
        }
        Ok(current_status())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_downloaded_installer_is_removed_once_its_runtime_is_found() {
        let folder = tempfile::tempdir().unwrap();
        for name in ["r-4.6.2", "python-3.14.10", "notes"] {
            std::fs::create_dir(folder.path().join(name)).unwrap();
        }
        remove_installers_in(folder.path(), |runtime| runtime == RuntimeName::R);
        assert!(!folder.path().join("r-4.6.2").exists());
        assert!(folder.path().join("python-3.14.10").exists());
        assert!(folder.path().join("notes").exists());
        remove_installers_in(&folder.path().join("missing"), |_| true);
    }

    #[test]
    fn package_names_are_checked_before_they_reach_r_or_pip() {
        assert!(valid_r_package("knitr"));
        assert!(valid_r_package("data.table"));
        assert!(!valid_r_package("2pkg"));
        assert!(!valid_r_package("bad;rm"));
        assert!(!valid_r_package("trailing."));
        assert!(valid_python_package("scikit-learn"));
        assert!(valid_python_package("ruamel.yaml"));
        assert!(!valid_python_package("-e"));
        assert!(!valid_python_package("pkg==1.0"));
        assert!(!valid_python_package("../evil"));
        assert!(checked_packages(vec!["--index-url".to_owned()], valid_python_package).is_err());
        assert!(checked_packages(Vec::new(), valid_r_package).is_err());
        assert_eq!(
            checked_packages(
                vec!["knitr".to_owned(), " knitr ".to_owned()],
                valid_r_package
            )
            .unwrap(),
            vec!["knitr"]
        );
    }

    #[test]
    fn only_document_packages_install_without_a_project_that_allows_code() {
        let names = |list: &[&str]| {
            list.iter()
                .map(|name| (*name).to_owned())
                .collect::<Vec<_>>()
        };
        assert!(
            allowed_without_code(None, &names(&["knitr", "rmarkdown"]), &R_DOCUMENT_PACKAGES)
                .is_ok()
        );
        assert!(allowed_without_code(None, &names(&["jupyter"]), &[JUPYTER_PACKAGE]).is_ok());
        assert!(allowed_without_code(None, &names(&["ggplot2"]), &R_DOCUMENT_PACKAGES).is_err());
        assert!(allowed_without_code(None, &names(&["requests"]), &[JUPYTER_PACKAGE]).is_err());
        assert!(allowed_without_code(
            Some("no-such-project"),
            &names(&["requests"]),
            &[JUPYTER_PACKAGE]
        )
        .is_err());
    }

    #[test]
    fn knitr_and_rmarkdown_are_installed_together() {
        assert_eq!(
            with_document_packages(vec!["rmarkdown".to_owned()]),
            vec!["rmarkdown", "knitr"]
        );
        assert_eq!(
            with_document_packages(vec!["ggplot2".to_owned()]),
            vec!["ggplot2"]
        );
    }

    #[test]
    fn the_manifest_offers_signed_installers_for_desktop_targets() {
        let installers = &manifest().installers;
        for (release, targets) in [
            (
                &installers.r,
                [
                    "aarch64-apple-darwin",
                    "x86_64-apple-darwin",
                    "x86_64-pc-windows-msvc",
                ],
            ),
            (
                &installers.python,
                [
                    "aarch64-apple-darwin",
                    "x86_64-apple-darwin",
                    "x86_64-pc-windows-msvc",
                ],
            ),
        ] {
            for target in targets {
                let artifact = &release.targets[target];
                assert_eq!(artifact.sha256.len(), 64, "{target}");
                assert!(artifact.size > 10 * 1024 * 1024, "{target}");
                let host = artifact
                    .url
                    .strip_prefix("https://")
                    .unwrap()
                    .split('/')
                    .next()
                    .unwrap();
                assert!(
                    manifest()
                        .allowed_download_hosts
                        .iter()
                        .any(|allowed| allowed == host),
                    "{host}"
                );
                assert!(artifact.url.ends_with(&artifact.file_name));
            }
            assert!(!release.targets.contains_key("x86_64-unknown-linux-gnu"));
        }
    }

    #[test]
    fn package_checks_read_one_line_per_name() {
        let output = std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: b"knitr TRUE \nrmarkdown FALSE \n".to_vec(),
            stderr: Vec::new(),
        };
        assert_eq!(
            package_states(&R_DOCUMENT_PACKAGES, Some(checked_lines(&output))),
            vec![
                RuntimePackage {
                    name: "knitr".to_owned(),
                    installed: true
                },
                RuntimePackage {
                    name: "rmarkdown".to_owned(),
                    installed: false
                },
            ]
        );
        assert!(package_states(&R_DOCUMENT_PACKAGES, None).is_empty());
    }

    #[test]
    fn a_conda_environment_is_found_by_the_name_environment_yml_gives() {
        let home = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("environment.yml"),
            "name: thesis-env\ndependencies:\n  - python=3.12\n",
        )
        .unwrap();
        let environment = home
            .path()
            .join("miniforge3")
            .join("envs")
            .join("thesis-env");
        let python = if cfg!(windows) {
            environment.join("python.exe")
        } else {
            environment.join("bin").join("python")
        };
        std::fs::create_dir_all(python.parent().unwrap()).unwrap();
        std::fs::write(&python, "").unwrap();
        assert_eq!(
            conda_python(project.path(), Some(home.path())),
            Some(python)
        );
        std::fs::write(project.path().join("environment.yml"), "name: other\n").unwrap();
        assert_eq!(conda_python(project.path(), Some(home.path())), None);
    }

    #[test]
    fn a_managed_environment_without_pip_is_not_ready() {
        let folder = tempfile::tempdir().unwrap();
        let environment = folder.path().join("python-environment");
        let python = if cfg!(windows) {
            environment.join("Scripts").join("python.exe")
        } else {
            environment.join("bin").join("python3")
        };
        std::fs::create_dir_all(python.parent().unwrap()).unwrap();
        std::fs::write(&python, "").unwrap();
        std::fs::write(environment.join("pyvenv.cfg"), "home = /usr\n").unwrap();
        assert_eq!(complete_environment(&environment), None);
        let site = if cfg!(windows) {
            environment.join("Lib").join("site-packages")
        } else {
            environment
                .join("lib")
                .join("python3.12")
                .join("site-packages")
        };
        std::fs::create_dir_all(site.join("pip")).unwrap();
        assert_eq!(complete_environment(&environment), Some(python));
    }

    #[test]
    fn a_project_virtual_environment_counts_without_jupyter_in_it() {
        let project = tempfile::tempdir().unwrap();
        let environment = project.path().join(".venv");
        let python = if cfg!(windows) {
            environment.join("Scripts").join("python.exe")
        } else {
            environment.join("bin").join("python3")
        };
        std::fs::create_dir_all(python.parent().unwrap()).unwrap();
        std::fs::write(&python, "").unwrap();
        assert_eq!(project_environment(project.path()), None);
        std::fs::write(environment.join("pyvenv.cfg"), "home = /usr\n").unwrap();
        assert_eq!(
            project_environment(project.path()),
            Some((environment, python))
        );
    }
}
