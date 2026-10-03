pub(crate) mod tinymist;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use oleafly_core::typst_toolchain::{
    ArchiveType, ResolvedTypst, SystemTypst, ToolchainVersion, TypstResolveError,
    TypstResolveRequest, TypstSource, TypstToolchainCatalog,
};
use serde::Serialize;

use crate::app_error::AppError;
use crate::document_engine::{DocumentEngineId, EngineDescriptor, TypstResolvedDescriptor};
use crate::project::ProjectMeta;
use crate::toolchain_download::{
    ArchiveKind, CancelToken, DownloadTimeouts, InstallPhase, InstallProgress,
    ToolchainInstallError, ToolchainInstallErrorKind, ToolchainInstallRequest,
};

const TYPST_SIDECAR: &str = "typst";
const VERSION_MISSING: &str = "typst_version_missing";
const SYSTEM_RECHECK_AFTER: Duration = Duration::from_secs(30);

static SYSTEM_TYPST: Mutex<Option<(Instant, Option<SystemTypst>)>> = Mutex::new(None);
static INSTALLING: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstSystemInstall {
    pub version: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstVersionEntry {
    pub version: String,
    pub released_at: Option<String>,
    pub in_catalog: bool,
    pub sources: Vec<TypstSource>,
    pub download_bytes: Option<u64>,
    pub tinymist_version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstToolchainStatus {
    pub bundled_version: String,
    pub default_version: String,
    pub default_choice: Option<String>,
    pub system: Option<TypstSystemInstall>,
    pub installing: Option<String>,
    pub versions: Vec<TypstVersionEntry>,
    pub unused_tinymist: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstInstallProgress {
    pub version: String,
    pub phase: InstallPhase,
    pub received_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SystemLookup {
    Lazy,
    Cached,
    Fresh,
}

#[derive(Clone, Debug)]
pub(crate) struct TypstToolchain {
    data_root: PathBuf,
    target: Option<&'static str>,
    bundled: Option<PathBuf>,
    default_choice: Option<String>,
    system: Option<SystemTypst>,
    system_known: bool,
}

fn catalog() -> &'static TypstToolchainCatalog {
    TypstToolchainCatalog::embedded()
}

pub(crate) fn bundled_version() -> String {
    catalog().bundled_version().to_string()
}

pub(crate) fn default_version() -> String {
    crate::config::typst_default_choice().unwrap_or_else(bundled_version)
}

fn typst_error(code: &'static str, version: &str) -> String {
    AppError::new(code).param("version", version).into()
}

fn version_missing(error: &TypstResolveError) -> String {
    typst_error(VERSION_MISSING, error.version())
}

fn parse_version(version: &str) -> Result<ToolchainVersion, String> {
    ToolchainVersion::parse(version)
        .ok_or_else(|| typst_error("typst_toolchain.unknown_version", version.trim()))
}

fn system_typst(data_root: &Path, bundled: Option<&Path>, refresh: bool) -> Option<SystemTypst> {
    let mut cached = SYSTEM_TYPST.lock().unwrap_or_else(PoisonError::into_inner);
    let stale = cached.as_ref().is_none_or(|(checked, system)| {
        checked.elapsed() >= SYSTEM_RECHECK_AFTER
            || system.as_ref().is_some_and(|system| !system.path.is_file())
    });
    if refresh || stale {
        *cached = Some((
            Instant::now(),
            oleafly_core::typst_toolchain::detect_system_typst(data_root, bundled),
        ));
    }
    cached.as_ref().and_then(|(_, system)| system.clone())
}

fn installing_version() -> Option<String> {
    INSTALLING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

struct InstallClaim;

impl InstallClaim {
    fn take(version: &str) -> Result<Self, String> {
        let mut installing = INSTALLING.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(running) = installing.as_deref() {
            return Err(typst_error("typst_toolchain.busy", running));
        }
        *installing = Some(version.to_owned());
        Ok(Self)
    }
}

impl Drop for InstallClaim {
    fn drop(&mut self) {
        *INSTALLING.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

fn archive_kind(archive: ArchiveType) -> Option<ArchiveKind> {
    serde_json::to_value(archive)
        .ok()?
        .as_str()
        .and_then(ArchiveKind::parse)
}

fn install_failure(error: &ToolchainInstallError, version: &str) -> String {
    match error.kind() {
        ToolchainInstallErrorKind::AlreadyInstalling => {
            typst_error("typst_toolchain.busy", version)
        }
        _ => error.message().to_owned(),
    }
}

pub(crate) fn is_typst_project(meta: &ProjectMeta) -> bool {
    crate::document_engine::engine_for(&meta.engine, &meta.main_doc)
        .is_ok_and(|engine| engine.id() == DocumentEngineId::Typst)
}

pub(crate) fn creation_pin(engine: &str) -> Option<oleafly_core::TypstSpec> {
    matches!(
        oleafly_core::Engine::named(engine),
        Some(oleafly_core::Engine::Typst)
    )
    .then(|| oleafly_core::TypstSpec {
        version: Some(default_version()),
        ..oleafly_core::TypstSpec::default()
    })
}

impl TypstToolchain {
    fn load(lookup: SystemLookup) -> Result<Self, String> {
        let mut toolchain = Self {
            data_root: crate::paths::oleafly_root()?,
            target: oleafly_core::typst_toolchain::host_target(),
            bundled: crate::document_engine::resolve_bundled_sidecar(TYPST_SIDECAR).ok(),
            default_choice: crate::config::typst_default_choice(),
            system: None,
            system_known: false,
        };
        match lookup {
            SystemLookup::Lazy => {}
            SystemLookup::Cached => toolchain.detect_system(false),
            SystemLookup::Fresh => toolchain.detect_system(true),
        }
        Ok(toolchain)
    }

    fn detect_system(&mut self, refresh: bool) {
        self.system = system_typst(&self.data_root, self.bundled.as_deref(), refresh);
        self.system_known = true;
    }

    fn default_version(&self) -> String {
        self.default_choice.clone().unwrap_or_else(bundled_version)
    }

    fn resolve(&self, pin: Option<&str>) -> Result<ResolvedTypst, TypstResolveError> {
        let bundled_version = bundled_version();
        catalog().resolve_typst(&TypstResolveRequest {
            pin,
            default_choice: self.default_choice.as_deref(),
            bundled: self
                .bundled
                .as_deref()
                .map(|path| (path, bundled_version.as_str())),
            data_root: &self.data_root,
            target: self.target.unwrap_or_default(),
            system: self.system.as_ref(),
        })
    }

    fn resolve_lazily(&mut self, pin: Option<&str>) -> Result<ResolvedTypst, TypstResolveError> {
        match self.resolve(pin) {
            Err(_) if !self.system_known => {
                self.detect_system(false);
                self.resolve(pin)
            }
            resolved => resolved,
        }
    }

    fn downloaded(&self, version: &ToolchainVersion) -> bool {
        self.target
            .is_some_and(|target| catalog().verify_typst_install(&self.data_root, version, target))
    }

    fn install_dir(&self, version: &ToolchainVersion) -> PathBuf {
        oleafly_core::typst_toolchain::typst_install_dir(&self.data_root, version)
    }

    fn status(&self, installing: Option<String>) -> TypstToolchainStatus {
        let catalog = catalog();
        let mut entries: BTreeMap<ToolchainVersion, TypstVersionEntry> = BTreeMap::new();
        for release in catalog.curated_typst_versions() {
            let mut sources = Vec::new();
            if self.downloaded(&release.version) {
                sources.push(TypstSource::Downloaded);
            }
            entries.insert(
                release.version.clone(),
                TypstVersionEntry {
                    version: release.version.to_string(),
                    released_at: Some(release.released_at.clone()),
                    in_catalog: true,
                    sources,
                    download_bytes: self
                        .target
                        .and_then(|target| release.targets.get(target))
                        .map(|artifact| artifact.archive_size),
                    tinymist_version: None,
                },
            );
        }
        let mut add_source = |version: &ToolchainVersion, source: TypstSource| {
            let entry = entries
                .entry(version.clone())
                .or_insert_with(|| TypstVersionEntry {
                    version: version.to_string(),
                    released_at: None,
                    in_catalog: false,
                    sources: Vec::new(),
                    download_bytes: None,
                    tinymist_version: None,
                });
            if !entry.sources.contains(&source) {
                entry.sources.push(source);
            }
        };
        if self.bundled.is_some() {
            add_source(catalog.bundled_version(), TypstSource::Bundled);
        }
        if let Some(system) = &self.system {
            add_source(&system.version, TypstSource::System);
        }
        let versions = entries
            .into_values()
            .rev()
            .map(|mut entry| {
                entry.sources.sort_by_key(|source| match source {
                    TypstSource::Bundled => 0,
                    TypstSource::Downloaded => 1,
                    TypstSource::System => 2,
                });
                entry.tinymist_version = tinymist::tinymist_version_for(&entry.version);
                entry
            })
            .collect();
        TypstToolchainStatus {
            bundled_version: bundled_version(),
            default_version: self.default_version(),
            default_choice: self.default_choice.clone(),
            system: self.system.as_ref().map(|system| TypstSystemInstall {
                version: system.version.to_string(),
                path: system.path.display().to_string(),
            }),
            installing,
            versions,
            unused_tinymist: self
                .unused_tinymist()
                .into_iter()
                .map(|(version, _)| version.to_string())
                .collect(),
        }
    }

    fn needed_tinymist(&self) -> BTreeSet<ToolchainVersion> {
        let catalog = catalog();
        let mut typst: Vec<ToolchainVersion> = catalog
            .curated_typst_versions()
            .into_iter()
            .map(|release| release.version.clone())
            .filter(|version| self.downloaded(version))
            .collect();
        typst.push(catalog.bundled_version().clone());
        typst.extend(self.system.as_ref().map(|system| system.version.clone()));
        typst.extend(ToolchainVersion::parse(&self.default_version()));
        typst
            .iter()
            .filter_map(|version| tinymist::release_for_typst(catalog, version))
            .map(|release| release.version.clone())
            .collect()
    }

    fn tinymist_downloads(&self) -> Vec<(ToolchainVersion, PathBuf)> {
        let root = oleafly_core::typst_toolchain::toolchains_root(&self.data_root).join("tinymist");
        let Ok(entries) = std::fs::read_dir(&root) else {
            return Vec::new();
        };
        let mut found: Vec<(ToolchainVersion, PathBuf)> = entries
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .filter_map(|entry| {
                let name = entry.file_name().to_str()?.to_owned();
                let version =
                    ToolchainVersion::parse(&name).filter(|version| version.to_string() == name)?;
                Some((version, entry.path()))
            })
            .collect();
        found.sort_by(|left, right| right.0.cmp(&left.0));
        found
    }

    fn unused_tinymist(&self) -> Vec<(ToolchainVersion, PathBuf)> {
        let needed = self.needed_tinymist();
        self.tinymist_downloads()
            .into_iter()
            .filter(|(version, directory)| {
                !needed.contains(version) && !crate::toolchain_download::is_installing(directory)
            })
            .collect()
    }

    fn remove_tinymist_for(&self, typst: &ToolchainVersion) {
        let Some(release) = tinymist::release_for_typst(catalog(), typst) else {
            return;
        };
        if self.needed_tinymist().contains(&release.version) {
            return;
        }
        let directory =
            oleafly_core::typst_toolchain::tinymist_install_dir(&self.data_root, &release.version);
        if directory.is_dir() && !crate::toolchain_download::is_installing(&directory) {
            let _ = std::fs::remove_dir_all(&directory);
        }
    }

    fn remove_downloaded(
        &self,
        version: &str,
        installing: Option<&str>,
    ) -> Result<TypstToolchainStatus, String> {
        let directory = self.removable(version, installing)?;
        if crate::toolchain_download::is_installing(&directory) {
            return Err(typst_error("typst_toolchain.busy", version.trim()));
        }
        std::fs::remove_dir_all(&directory)
            .map_err(|error| format!("Could not remove {}: {error}", directory.display()))?;
        if let Ok(parsed) = parse_version(version) {
            self.remove_tinymist_for(&parsed);
        }
        Ok(self.status(installing.map(str::to_owned)))
    }

    fn remove_unused_tinymist(&self) -> Result<TypstToolchainStatus, String> {
        let mut failure = None;
        for (_, directory) in self.unused_tinymist() {
            if let Err(error) = std::fs::remove_dir_all(&directory) {
                failure.get_or_insert_with(|| {
                    format!("Could not remove {}: {error}", directory.display())
                });
            }
        }
        match failure {
            Some(message) => Err(message),
            None => Ok(self.status(installing_version())),
        }
    }

    fn accepted_pin(&self, version: &str) -> Result<String, String> {
        let parsed = parse_version(version)?;
        let known = catalog().typst_release(&parsed.to_string()).is_some()
            || parsed == *catalog().bundled_version()
            || self
                .system
                .as_ref()
                .is_some_and(|system| system.version == parsed);
        if known {
            Ok(parsed.to_string())
        } else {
            Err(typst_error(
                "typst_toolchain.unknown_version",
                version.trim(),
            ))
        }
    }

    fn default_choice_for(&self, version: Option<&str>) -> Result<Option<String>, String> {
        let Some(version) = version.map(str::trim).filter(|version| !version.is_empty()) else {
            return Ok(None);
        };
        let pin = self.accepted_pin(version)?;
        if pin == bundled_version() {
            return Ok(None);
        }
        self.resolve(Some(&pin))
            .map_err(|error| version_missing(&error))?;
        Ok(Some(pin))
    }

    fn removable(&self, version: &str, installing: Option<&str>) -> Result<PathBuf, String> {
        let parsed = parse_version(version)?;
        let version = parsed.to_string();
        if installing == Some(version.as_str()) {
            return Err(typst_error("typst_toolchain.busy", &version));
        }
        if version == self.default_version() {
            return Err(typst_error("typst_toolchain.remove_default", &version));
        }
        if !self.downloaded(&parsed) {
            return Err(typst_error(
                "typst_toolchain.remove_not_downloaded",
                &version,
            ));
        }
        Ok(self.install_dir(&parsed))
    }

    fn install_request(
        &self,
        version: &str,
    ) -> Result<(ToolchainVersion, ToolchainInstallRequest), String> {
        let parsed = parse_version(version)?;
        let not_offered = || typst_error("typst_toolchain.not_offered", &parsed.to_string());
        let target = self.target.ok_or_else(not_offered)?;
        let artifact = catalog()
            .typst_artifact(&parsed.to_string(), target)
            .ok_or_else(not_offered)?;
        let binary =
            oleafly_core::typst_toolchain::typst_binary_path(&self.data_root, &parsed, target);
        let binary_name = binary
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(not_offered)?;
        let request = ToolchainInstallRequest {
            urls: vec![artifact.mirror_url.clone(), artifact.github_url.clone()],
            allowed_hosts: catalog().allowed_download_hosts.clone(),
            archive_kind: archive_kind(artifact.archive_type).ok_or_else(not_offered)?,
            archive_size: artifact.archive_size,
            archive_sha256: artifact.archive_sha256.clone(),
            archive_member: artifact.archive_member.clone(),
            binary_size: artifact.binary_size,
            binary_sha256: artifact.binary_sha256.clone(),
            install_dir: self.install_dir(&parsed),
            binary_name,
            timeouts: DownloadTimeouts::default(),
        };
        Ok((parsed, request))
    }

    fn describe(&mut self, descriptor: &mut EngineDescriptor, pin: Option<&str>) {
        descriptor.typst_version = pin.map(str::to_owned);
        match self.resolve_lazily(pin) {
            Ok(resolved) => {
                descriptor.typst_resolved = Some(TypstResolvedDescriptor {
                    version: resolved.version.to_string(),
                    source: resolved.source,
                });
            }
            Err(error) => descriptor.typst_missing = Some(error.version().to_owned()),
        }
    }
}

pub(crate) fn describe_project(descriptor: &mut EngineDescriptor, meta: &ProjectMeta) {
    if descriptor.id != DocumentEngineId::Typst.as_str() {
        return;
    }
    descriptor.typst_vendor_packages = crate::typst_packages::vendor_flag(meta);
    descriptor.capabilities.supports_synctex = crate::typst_sync::supported_for_project(meta);
    match TypstToolchain::load(SystemLookup::Lazy) {
        Ok(mut toolchain) => toolchain.describe(descriptor, meta.typst_version_pin()),
        Err(_) => descriptor.typst_version = meta.typst_version_pin().map(str::to_owned),
    }
}

pub(crate) fn resolve_for_compile(
    meta: &ProjectMeta,
) -> Result<Option<Arc<ResolvedTypst>>, String> {
    if !is_typst_project(meta) {
        return Ok(None);
    }
    let mut toolchain = TypstToolchain::load(SystemLookup::Lazy)?;
    toolchain
        .resolve_lazily(meta.typst_version_pin())
        .map(|resolved| Some(Arc::new(resolved)))
        .map_err(|error| version_missing(&error))
}

pub(crate) fn resolve_version(version: &str) -> Result<Arc<ResolvedTypst>, String> {
    let parsed = parse_version(version)?;
    let mut toolchain = TypstToolchain::load(SystemLookup::Lazy)?;
    toolchain
        .resolve_lazily(Some(&parsed.to_string()))
        .map(Arc::new)
        .map_err(|error| version_missing(&error))
}

pub(crate) fn compile_identity(meta: &ProjectMeta, typst: Option<&ResolvedTypst>) -> String {
    match typst {
        Some(resolved) => format!("{} {}", meta.engine, resolved.version),
        None => meta.engine.clone(),
    }
}

pub(crate) fn snippet_typst(project_id: Option<&str>) -> Result<ResolvedTypst, String> {
    let pin = match project_id {
        Some(project_id) => {
            let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
            let meta = crate::trust::restrict_compile_meta(
                project_id,
                crate::project::read_meta(project_id)?,
            )?;
            meta.typst_version_pin().map(str::to_owned)
        }
        None => None,
    };
    let mut toolchain = TypstToolchain::load(SystemLookup::Lazy)?;
    toolchain
        .resolve_lazily(pin.as_deref())
        .map_err(|error| version_missing(&error))
}

fn current_status(lookup: SystemLookup) -> Result<TypstToolchainStatus, String> {
    Ok(TypstToolchain::load(lookup)?.status(installing_version()))
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the Typst toolchain task stopped: {error}"))?
}

fn progress_percent(progress: &InstallProgress) -> Option<u64> {
    (progress.total_bytes > 0)
        .then(|| progress.received_bytes.min(progress.total_bytes) * 100 / progress.total_bytes)
}

fn throttled_progress<F>(
    version: String,
    cancel: CancelToken,
    send: F,
) -> impl Fn(InstallProgress) + Send + Sync
where
    F: Fn(TypstInstallProgress) -> bool + Send + Sync,
{
    let last: Mutex<Option<(InstallPhase, Option<u64>)>> = Mutex::new(None);
    move |progress: InstallProgress| {
        let mark = (progress.phase, progress_percent(&progress));
        {
            let mut last = last.lock().unwrap_or_else(PoisonError::into_inner);
            if *last == Some(mark) {
                return;
            }
            *last = Some(mark);
        }
        let delivered = send(TypstInstallProgress {
            version: version.clone(),
            phase: progress.phase,
            received_bytes: progress.received_bytes,
            total_bytes: progress.total_bytes,
        });
        if !delivered {
            cancel.cancel();
        }
    }
}

pub(crate) async fn install_version<F>(
    version: String,
    send: F,
) -> Result<TypstToolchainStatus, String>
where
    F: Fn(TypstInstallProgress) -> bool + Send + Sync + 'static,
{
    let toolchain = blocking(|| TypstToolchain::load(SystemLookup::Lazy)).await?;
    let (parsed, request) = toolchain.install_request(&version)?;
    let version = parsed.to_string();
    let claim = InstallClaim::take(&version)?;
    let cancel = CancelToken::new();
    let outcome = crate::toolchain_download::install_toolchain(
        request,
        cancel.clone(),
        throttled_progress(version.clone(), cancel, send),
    )
    .await
    .map_err(|error| install_failure(&error, &version))?;
    let binary = outcome.binary_path().to_path_buf();
    let target = toolchain.target.unwrap_or_default();
    let checked = version.clone();
    let verified = blocking(move || {
        Ok(catalog()
            .typst_artifact(&checked, target)
            .is_some_and(|artifact| {
                oleafly_core::typst_toolchain::verify_toolchain_binary(&binary, artifact)
            }))
    })
    .await?;
    if !verified {
        return Err(typst_error("typst_toolchain.install_unverified", &version));
    }
    drop(claim);
    blocking(|| current_status(SystemLookup::Cached)).await
}

fn remove_version_blocking(version: &str) -> Result<TypstToolchainStatus, String> {
    TypstToolchain::load(SystemLookup::Cached)?
        .remove_downloaded(version, installing_version().as_deref())
}

fn remove_unused_tinymist_blocking() -> Result<TypstToolchainStatus, String> {
    TypstToolchain::load(SystemLookup::Cached)?.remove_unused_tinymist()
}

fn set_default_blocking(version: Option<String>) -> Result<TypstToolchainStatus, String> {
    let toolchain = TypstToolchain::load(SystemLookup::Cached)?;
    let choice = toolchain.default_choice_for(version.as_deref())?;
    crate::config::set_typst_default_choice(choice)?;
    current_status(SystemLookup::Cached)
}

fn set_project_version_blocking(
    project_id: &str,
    version: Option<String>,
) -> Result<ProjectMeta, String> {
    let pin = match version.as_deref().map(str::trim) {
        Some(version) if !version.is_empty() => {
            Some(TypstToolchain::load(SystemLookup::Cached)?.accepted_pin(version)?)
        }
        _ => None,
    };
    crate::project::set_project_typst_version_unlocked(project_id, pin)
}

#[tauri::command]
pub async fn typst_toolchain_status() -> Result<TypstToolchainStatus, String> {
    blocking(|| current_status(SystemLookup::Fresh)).await
}

#[tauri::command]
pub async fn install_typst_version(
    version: String,
    on_progress: tauri::ipc::Channel<TypstInstallProgress>,
) -> Result<TypstToolchainStatus, String> {
    install_version(version, move |progress| on_progress.send(progress).is_ok()).await
}

#[tauri::command]
pub async fn remove_typst_version(version: String) -> Result<TypstToolchainStatus, String> {
    blocking(move || remove_version_blocking(&version)).await
}

#[tauri::command]
pub async fn remove_unused_tinymist_downloads() -> Result<TypstToolchainStatus, String> {
    blocking(remove_unused_tinymist_blocking).await
}

#[tauri::command]
pub async fn set_default_typst_version(
    version: Option<String>,
) -> Result<TypstToolchainStatus, String> {
    blocking(move || set_default_blocking(version)).await
}

#[tauri::command]
pub async fn set_project_typst_version(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    version: Option<String>,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let owned = project_id.clone();
    let meta = blocking(move || set_project_version_blocking(&owned, version)).await?;
    let _ = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        meta.clone(),
        "engine-changed",
        false,
        crate::project::project_mutation_generation(project_id.clone()).ok(),
    );
    Ok(meta)
}

#[cfg(test)]
mod tests;
