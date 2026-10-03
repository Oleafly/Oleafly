use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use oleafly_core::typst_toolchain::{
    TinymistRelease, ToolchainArtifact, ToolchainVersion, TypstToolchainCatalog,
};

use crate::project::ProjectMeta;
use crate::toolchain_download::{
    DownloadTimeouts, ToolchainInstallErrorKind, ToolchainInstallRequest,
};

type Gate = Arc<tokio::sync::Mutex<()>>;

static GATES: Mutex<BTreeMap<PathBuf, Gate>> = Mutex::new(BTreeMap::new());
static FAILURES: Mutex<BTreeMap<PathBuf, String>> = Mutex::new(BTreeMap::new());

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TinymistChoice {
    Bundled,
    Catalog(Box<CatalogTinymist>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CatalogTinymist {
    pub(crate) version: ToolchainVersion,
    pub(crate) typst_minor: String,
    pub(crate) binary: PathBuf,
    pub(crate) artifact: ToolchainArtifact,
    allowed_hosts: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TinymistInstallState {
    Installed,
    Installing,
    Missing,
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TinymistFailureKind {
    Download,
    Integrity,
    Install,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TinymistInstallFailure {
    pub(crate) kind: TinymistFailureKind,
    pub(crate) message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TinymistEnsured {
    Installed(PathBuf),
    AlreadyInstalled(PathBuf),
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn minor_key(text: &str) -> Option<(u64, u64)> {
    let (major, minor) = text.trim().split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}

pub(crate) fn release_for_typst<'a>(
    catalog: &'a TypstToolchainCatalog,
    typst: &ToolchainVersion,
) -> Option<&'a TinymistRelease> {
    let wanted = (typst.major, typst.minor);
    let mut releases: Vec<((u64, u64), &TinymistRelease)> = catalog
        .tinymist
        .versions
        .iter()
        .filter_map(|release| Some((minor_key(&release.typst_minor)?, release)))
        .collect();
    releases.sort_by_key(|(key, _)| *key);
    releases
        .iter()
        .rev()
        .find(|(key, _)| *key <= wanted)
        .or_else(|| releases.first())
        .map(|(_, release)| *release)
}

pub(crate) fn tinymist_version_for(typst: &str) -> Option<String> {
    let typst = ToolchainVersion::parse(typst)?;
    release_for_typst(super::catalog(), &typst).map(|release| release.version.to_string())
}

pub(crate) fn choose(
    catalog: &TypstToolchainCatalog,
    typst: &ToolchainVersion,
    data_root: &Path,
    target: Option<&str>,
) -> TinymistChoice {
    let Some(release) = release_for_typst(catalog, typst) else {
        return TinymistChoice::Bundled;
    };
    if release.version == catalog.tinymist.bundled {
        return TinymistChoice::Bundled;
    }
    let Some((target, artifact)) = target.and_then(|target| {
        release
            .targets
            .get(target)
            .map(|artifact| (target, artifact))
    }) else {
        return TinymistChoice::Bundled;
    };
    TinymistChoice::Catalog(Box::new(CatalogTinymist {
        version: release.version.clone(),
        typst_minor: release.typst_minor.clone(),
        binary: oleafly_core::typst_toolchain::tinymist_binary_path(
            data_root,
            &release.version,
            target,
        ),
        artifact: artifact.clone(),
        allowed_hosts: catalog.allowed_download_hosts.clone(),
    }))
}

pub(crate) fn project_typst_version(meta: &ProjectMeta) -> ToolchainVersion {
    meta.typst_version_pin()
        .and_then(ToolchainVersion::parse)
        .or_else(|| ToolchainVersion::parse(&super::default_version()))
        .unwrap_or_else(|| super::catalog().bundled_version().clone())
}

pub(crate) fn choice_for_project(project_id: &str) -> Result<TinymistChoice, String> {
    let meta = crate::project::read_meta(project_id)?;
    let data_root = crate::paths::oleafly_root()?;
    Ok(choose(
        super::catalog(),
        &project_typst_version(&meta),
        &data_root,
        oleafly_core::typst_toolchain::host_target(),
    ))
}

fn failure_kind(kind: ToolchainInstallErrorKind) -> TinymistFailureKind {
    match kind {
        ToolchainInstallErrorKind::DownloadFailed => TinymistFailureKind::Download,
        ToolchainInstallErrorKind::IntegrityFailure => TinymistFailureKind::Integrity,
        _ => TinymistFailureKind::Install,
    }
}

impl CatalogTinymist {
    fn unusable(&self) -> TinymistInstallFailure {
        TinymistInstallFailure {
            kind: TinymistFailureKind::Install,
            message: format!(
                "Tinymist {} cannot be installed on this computer.",
                self.version
            ),
        }
    }

    fn request(&self) -> Result<ToolchainInstallRequest, TinymistInstallFailure> {
        let binary_name = self
            .binary
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| self.unusable())?
            .to_owned();
        let install_dir = self
            .binary
            .parent()
            .ok_or_else(|| self.unusable())?
            .to_path_buf();
        Ok(ToolchainInstallRequest {
            urls: vec![
                self.artifact.mirror_url.clone(),
                self.artifact.github_url.clone(),
            ],
            allowed_hosts: self.allowed_hosts.clone(),
            archive_kind: super::archive_kind(self.artifact.archive_type)
                .ok_or_else(|| self.unusable())?,
            archive_size: self.artifact.archive_size,
            archive_sha256: self.artifact.archive_sha256.clone(),
            archive_member: self.artifact.archive_member.clone(),
            binary_size: self.artifact.binary_size,
            binary_sha256: self.artifact.binary_sha256.clone(),
            install_dir,
            binary_name,
            timeouts: DownloadTimeouts::default(),
        })
    }

    pub(crate) fn verified(&self) -> bool {
        oleafly_core::typst_toolchain::verify_toolchain_binary(&self.binary, &self.artifact)
    }

    fn busy(&self) -> bool {
        let gate = lock(&GATES).get(&self.binary).cloned();
        gate.is_some_and(|gate| gate.try_lock().is_err())
            || self
                .binary
                .parent()
                .is_some_and(crate::toolchain_download::is_installing)
    }

    pub(crate) fn state(&self) -> TinymistInstallState {
        if self.verified() {
            return TinymistInstallState::Installed;
        }
        if self.busy() {
            return TinymistInstallState::Installing;
        }
        match lock(&FAILURES).get(&self.binary).cloned() {
            Some(message) => TinymistInstallState::Failed(message),
            None => TinymistInstallState::Missing,
        }
    }

    fn remember(&self, outcome: Result<(), &TinymistInstallFailure>) {
        let mut failures = lock(&FAILURES);
        match outcome {
            Ok(()) => {
                failures.remove(&self.binary);
            }
            Err(failure) => {
                failures.insert(self.binary.clone(), failure.message.clone());
            }
        }
    }
}

async fn verified_off_thread(choice: &CatalogTinymist) -> bool {
    let choice = choice.clone();
    tokio::task::spawn_blocking(move || choice.verified())
        .await
        .unwrap_or(false)
}

pub(crate) async fn ensure_installed<F, Fut>(
    choice: &CatalogTinymist,
    install: F,
) -> Result<TinymistEnsured, TinymistInstallFailure>
where
    F: FnOnce(ToolchainInstallRequest) -> Fut,
    Fut: Future<Output = Result<(), TinymistInstallFailure>>,
{
    let gate = lock(&GATES)
        .entry(choice.binary.clone())
        .or_default()
        .clone();
    let _held = gate.lock().await;
    if verified_off_thread(choice).await {
        choice.remember(Ok(()));
        return Ok(TinymistEnsured::AlreadyInstalled(choice.binary.clone()));
    }
    let outcome = async {
        install(choice.request()?).await?;
        if verified_off_thread(choice).await {
            Ok(())
        } else {
            Err(TinymistInstallFailure {
                kind: TinymistFailureKind::Integrity,
                message: format!(
                    "Tinymist {} did not match its pinned checksum after the download.",
                    choice.version
                ),
            })
        }
    }
    .await;
    choice.remember(outcome.as_ref().map(|_| ()));
    outcome.map(|()| TinymistEnsured::Installed(choice.binary.clone()))
}

pub(crate) async fn ensure_downloaded(
    choice: &CatalogTinymist,
) -> Result<TinymistEnsured, TinymistInstallFailure> {
    ensure_installed(choice, |request| async move {
        crate::toolchain_download::install_toolchain_in_background(request, |_| {})
            .await
            .map(|_| ())
            .map_err(|error| TinymistInstallFailure {
                kind: failure_kind(error.kind()),
                message: error.message().to_owned(),
            })
    })
    .await
}

#[cfg(test)]
mod tests;
