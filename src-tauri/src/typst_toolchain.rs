pub(crate) mod tinymist;

use std::sync::Arc;

use oleafly_core::typst_toolchain::{ResolvedTypst, TypstResolveError};
pub(crate) use oleafly_downloads::typst::archive_kind;
pub(crate) use oleafly_downloads::typst::{
    bundled_version, catalog, installing_version, SystemLookup, TypstInstallProgress,
    TypstToolchain, TypstToolchainStatus,
};
#[cfg(test)]
pub(crate) use oleafly_downloads::typst::{throttled_progress, InstallClaim};

use crate::app_error::AppError;
use crate::document_engine::{DocumentEngineId, EngineDescriptor, TypstResolvedDescriptor};
use crate::project::ProjectMeta;
#[cfg(test)]
use crate::toolchain_download::{ArchiveKind, CancelToken, InstallPhase, InstallProgress};
#[cfg(test)]
use oleafly_core::typst_toolchain::{ArchiveType, SystemTypst, ToolchainVersion, TypstSource};
#[cfg(test)]
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::Mutex;

const TYPST_SIDECAR: &str = "typst";
const VERSION_MISSING: &str = oleafly_downloads::typst::VERSION_MISSING;

pub(crate) fn default_version() -> String {
    crate::config::typst_default_choice().unwrap_or_else(bundled_version)
}

fn typst_error(code: &'static str, version: &str) -> String {
    AppError::new(code).param("version", version).into()
}

fn version_missing(error: &TypstResolveError) -> String {
    typst_error(VERSION_MISSING, error.version())
}

fn parse_version(version: &str) -> Result<oleafly_core::typst_toolchain::ToolchainVersion, String> {
    oleafly_downloads::typst::parse_version(version).map_err(String::from)
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

/// The app's side of the shared Typst toolchain: its data folder, bundled
/// sidecar and default version, and the editor's engine descriptors.
pub(crate) trait AppTypstToolchain: Sized {
    fn load(lookup: SystemLookup) -> Result<Self, String>;
    fn describe(&mut self, descriptor: &mut EngineDescriptor, pin: Option<&str>);
}

impl AppTypstToolchain for TypstToolchain {
    fn load(lookup: SystemLookup) -> Result<Self, String> {
        Ok(TypstToolchain::new(
            crate::paths::oleafly_root()?,
            oleafly_core::typst_toolchain::host_target(),
            crate::document_engine::resolve_bundled_sidecar(TYPST_SIDECAR).ok(),
            crate::config::typst_default_choice(),
            lookup,
        ))
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

pub(crate) async fn install_version<F>(
    version: String,
    send: F,
) -> Result<TypstToolchainStatus, String>
where
    F: Fn(TypstInstallProgress) -> bool + Send + Sync + 'static,
{
    let toolchain = blocking(|| TypstToolchain::load(SystemLookup::Lazy)).await?;
    oleafly_downloads::typst::install_version(&toolchain, &version, send).await?;
    blocking(|| current_status(SystemLookup::Cached)).await
}

fn remove_version_blocking(version: &str) -> Result<TypstToolchainStatus, String> {
    TypstToolchain::load(SystemLookup::Cached)?
        .remove_downloaded(version, installing_version().as_deref())
        .map_err(String::from)
}

fn remove_unused_tinymist_blocking() -> Result<TypstToolchainStatus, String> {
    TypstToolchain::load(SystemLookup::Cached)?
        .remove_unused_tinymist()
        .map_err(String::from)
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
    crate::collab::settings::refuse_viewer(&project_id)?;
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
    crate::collab::settings::local_changed(&project_id);
    Ok(meta)
}

#[cfg(test)]
mod tests;
