use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use oleafly_core::typst_toolchain::{
    ArchiveType, ResolvedTypst, SystemTypst, TinymistRelease, ToolchainVersion, TypstResolveError,
    TypstResolveRequest, TypstSource, TypstToolchainCatalog,
};
use serde::Serialize;

use crate::toolchain::{
    install_toolchain, is_installing, ArchiveKind, CancelToken, DownloadTimeouts, InstallPhase,
    InstallProgress, ToolchainInstallError, ToolchainInstallErrorKind, ToolchainInstallRequest,
};

pub const VERSION_MISSING: &str = "typst_version_missing";
const SYSTEM_RECHECK_AFTER: Duration = Duration::from_secs(30);

static SYSTEM_TYPST: Mutex<Option<(Instant, Option<SystemTypst>)>> = Mutex::new(None);
static INSTALLING: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstToolchainError {
    pub code: Option<&'static str>,
    pub version: Option<String>,
    pub message: String,
    pub install: Option<ToolchainInstallErrorKind>,
}

impl TypstToolchainError {
    pub fn coded(code: &'static str, version: &str) -> Self {
        let version = version.trim();
        let message = match code {
            "typst_toolchain.unknown_version" => {
                format!("Typst {version} isn't a version Oleafly knows.")
            }
            "typst_toolchain.busy" => format!("Oleafly is already installing Typst {version}."),
            "typst_toolchain.not_offered" => {
                format!("Typst {version} has no download for this computer.")
            }
            "typst_toolchain.remove_default" => {
                format!("Typst {version} is the default version, so it can't be removed.")
            }
            "typst_toolchain.remove_not_downloaded" => {
                format!("Typst {version} isn't a downloaded version.")
            }
            "typst_toolchain.install_unverified" => format!(
                "The downloaded Typst {version} failed its check, so Oleafly didn't keep it."
            ),
            VERSION_MISSING => format!("Typst {version} isn't installed."),
            _ => format!("Typst {version}: {code}"),
        };
        Self {
            code: Some(code),
            version: Some(version.to_string()),
            message,
            install: None,
        }
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self {
            code: None,
            version: None,
            message: message.into(),
            install: None,
        }
    }
}

impl std::fmt::Display for TypstToolchainError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TypstToolchainError {}

#[derive(Serialize)]
struct Envelope<'a> {
    code: &'a str,
    params: BTreeMap<&'a str, &'a str>,
    detail: Option<&'a str>,
}

impl From<&TypstToolchainError> for String {
    fn from(error: &TypstToolchainError) -> Self {
        let Some(code) = error.code else {
            return error.message.clone();
        };
        let mut params = BTreeMap::new();
        if let Some(version) = error.version.as_deref() {
            params.insert("version", version);
        }
        let envelope = Envelope {
            code,
            params,
            detail: None,
        };
        match serde_json::to_string(&envelope) {
            Ok(json) => format!("@oleafly/error:{json}"),
            Err(_) => error.message.clone(),
        }
    }
}

impl From<TypstToolchainError> for String {
    fn from(error: TypstToolchainError) -> Self {
        String::from(&error)
    }
}

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
pub enum SystemLookup {
    Lazy,
    Cached,
    Fresh,
}

#[derive(Clone, Debug)]
pub struct TypstToolchain {
    pub data_root: PathBuf,
    pub target: Option<&'static str>,
    pub bundled: Option<PathBuf>,
    pub default_choice: Option<String>,
    pub system: Option<SystemTypst>,
    pub system_known: bool,
}

pub fn catalog() -> &'static TypstToolchainCatalog {
    TypstToolchainCatalog::embedded()
}

pub fn bundled_version() -> String {
    catalog().bundled_version().to_string()
}

fn version_missing(error: &TypstResolveError) -> TypstToolchainError {
    TypstToolchainError::coded(VERSION_MISSING, error.version())
}

pub fn parse_version(version: &str) -> Result<ToolchainVersion, TypstToolchainError> {
    ToolchainVersion::parse(version).ok_or_else(|| {
        TypstToolchainError::coded("typst_toolchain.unknown_version", version.trim())
    })
}

pub fn system_typst(
    data_root: &Path,
    bundled: Option<&Path>,
    refresh: bool,
) -> Option<SystemTypst> {
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

pub fn installing_version() -> Option<String> {
    INSTALLING
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

pub struct InstallClaim;

impl InstallClaim {
    pub fn take(version: &str) -> Result<Self, TypstToolchainError> {
        let mut installing = INSTALLING.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(running) = installing.as_deref() {
            return Err(TypstToolchainError::coded("typst_toolchain.busy", running));
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

pub fn archive_kind(archive: ArchiveType) -> Option<ArchiveKind> {
    serde_json::to_value(archive)
        .ok()?
        .as_str()
        .and_then(ArchiveKind::parse)
}

fn install_failure(error: &ToolchainInstallError, version: &str) -> TypstToolchainError {
    match error.kind() {
        ToolchainInstallErrorKind::AlreadyInstalling => {
            TypstToolchainError::coded("typst_toolchain.busy", version)
        }
        kind => TypstToolchainError {
            install: Some(kind),
            ..TypstToolchainError::other(error.message())
        },
    }
}

fn minor_key(text: &str) -> Option<(u64, u64)> {
    let (major, minor) = text.trim().split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}

pub fn release_for_typst<'a>(
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

pub fn tinymist_version_for(typst: &str) -> Option<String> {
    let typst = ToolchainVersion::parse(typst)?;
    release_for_typst(catalog(), &typst).map(|release| release.version.to_string())
}

impl TypstToolchain {
    pub fn new(
        data_root: PathBuf,
        target: Option<&'static str>,
        bundled: Option<PathBuf>,
        default_choice: Option<String>,
        lookup: SystemLookup,
    ) -> Self {
        let mut toolchain = Self {
            data_root,
            target,
            bundled,
            default_choice,
            system: None,
            system_known: false,
        };
        match lookup {
            SystemLookup::Lazy => {}
            SystemLookup::Cached => toolchain.detect_system(false),
            SystemLookup::Fresh => toolchain.detect_system(true),
        }
        toolchain
    }

    pub fn detect_system(&mut self, refresh: bool) {
        self.system = system_typst(&self.data_root, self.bundled.as_deref(), refresh);
        self.system_known = true;
    }

    pub fn default_version(&self) -> String {
        self.default_choice.clone().unwrap_or_else(bundled_version)
    }

    pub fn resolve(&self, pin: Option<&str>) -> Result<ResolvedTypst, TypstResolveError> {
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

    pub fn resolve_lazily(
        &mut self,
        pin: Option<&str>,
    ) -> Result<ResolvedTypst, TypstResolveError> {
        match self.resolve(pin) {
            Err(_) if !self.system_known => {
                self.detect_system(false);
                self.resolve(pin)
            }
            resolved => resolved,
        }
    }

    pub fn downloaded(&self, version: &ToolchainVersion) -> bool {
        self.target
            .is_some_and(|target| catalog().verify_typst_install(&self.data_root, version, target))
    }

    pub fn install_dir(&self, version: &ToolchainVersion) -> PathBuf {
        oleafly_core::typst_toolchain::typst_install_dir(&self.data_root, version)
    }

    pub fn status(&self, installing: Option<String>) -> TypstToolchainStatus {
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
                entry.tinymist_version = tinymist_version_for(&entry.version);
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
            .filter_map(|version| release_for_typst(catalog, version))
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

    pub fn unused_tinymist(&self) -> Vec<(ToolchainVersion, PathBuf)> {
        let needed = self.needed_tinymist();
        self.tinymist_downloads()
            .into_iter()
            .filter(|(version, directory)| !needed.contains(version) && !is_installing(directory))
            .collect()
    }

    fn remove_tinymist_for(&self, typst: &ToolchainVersion) {
        let Some(release) = release_for_typst(catalog(), typst) else {
            return;
        };
        if self.needed_tinymist().contains(&release.version) {
            return;
        }
        let directory =
            oleafly_core::typst_toolchain::tinymist_install_dir(&self.data_root, &release.version);
        if directory.is_dir() && !is_installing(&directory) {
            let _ = std::fs::remove_dir_all(&directory);
        }
    }

    pub fn remove_downloaded(
        &self,
        version: &str,
        installing: Option<&str>,
    ) -> Result<TypstToolchainStatus, TypstToolchainError> {
        let directory = self.removable(version, installing)?;
        if is_installing(&directory) {
            return Err(TypstToolchainError::coded(
                "typst_toolchain.busy",
                version.trim(),
            ));
        }
        std::fs::remove_dir_all(&directory).map_err(|error| {
            TypstToolchainError::other(format!("Could not remove {}: {error}", directory.display()))
        })?;
        if let Ok(parsed) = parse_version(version) {
            self.remove_tinymist_for(&parsed);
        }
        Ok(self.status(installing.map(str::to_owned)))
    }

    pub fn remove_unused_tinymist(&self) -> Result<TypstToolchainStatus, TypstToolchainError> {
        let mut failure = None;
        for (_, directory) in self.unused_tinymist() {
            if let Err(error) = std::fs::remove_dir_all(&directory) {
                failure.get_or_insert_with(|| {
                    format!("Could not remove {}: {error}", directory.display())
                });
            }
        }
        match failure {
            Some(message) => Err(TypstToolchainError::other(message)),
            None => Ok(self.status(installing_version())),
        }
    }

    pub fn accepted_pin(&self, version: &str) -> Result<String, TypstToolchainError> {
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
            Err(TypstToolchainError::coded(
                "typst_toolchain.unknown_version",
                version.trim(),
            ))
        }
    }

    pub fn default_choice_for(
        &self,
        version: Option<&str>,
    ) -> Result<Option<String>, TypstToolchainError> {
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

    pub fn removable(
        &self,
        version: &str,
        installing: Option<&str>,
    ) -> Result<PathBuf, TypstToolchainError> {
        let parsed = parse_version(version)?;
        let version = parsed.to_string();
        if installing == Some(version.as_str()) {
            return Err(TypstToolchainError::coded("typst_toolchain.busy", &version));
        }
        if version == self.default_version() {
            return Err(TypstToolchainError::coded(
                "typst_toolchain.remove_default",
                &version,
            ));
        }
        if !self.downloaded(&parsed) {
            return Err(TypstToolchainError::coded(
                "typst_toolchain.remove_not_downloaded",
                &version,
            ));
        }
        Ok(self.install_dir(&parsed))
    }

    pub fn install_request(
        &self,
        version: &str,
    ) -> Result<(ToolchainVersion, ToolchainInstallRequest), TypstToolchainError> {
        let parsed = parse_version(version)?;
        let not_offered =
            || TypstToolchainError::coded("typst_toolchain.not_offered", &parsed.to_string());
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
}

pub fn progress_percent(progress: &InstallProgress) -> Option<u64> {
    (progress.total_bytes > 0)
        .then(|| progress.received_bytes.min(progress.total_bytes) * 100 / progress.total_bytes)
}

pub fn throttled_progress<F>(
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

pub async fn install_version<F>(
    toolchain: &TypstToolchain,
    version: &str,
    send: F,
) -> Result<PathBuf, TypstToolchainError>
where
    F: Fn(TypstInstallProgress) -> bool + Send + Sync + 'static,
{
    let (parsed, request) = toolchain.install_request(version)?;
    let version = parsed.to_string();
    let claim = InstallClaim::take(&version)?;
    let cancel = CancelToken::new();
    let outcome = install_toolchain(
        request,
        cancel.clone(),
        throttled_progress(version.clone(), cancel, send),
    )
    .await
    .map_err(|error| install_failure(&error, &version))?;
    let binary = outcome.binary_path().to_path_buf();
    let target = toolchain.target.unwrap_or_default();
    let checked = version.clone();
    let checked_binary = binary.clone();
    let verified = tokio::task::spawn_blocking(move || {
        catalog()
            .typst_artifact(&checked, target)
            .is_some_and(|artifact| {
                oleafly_core::typst_toolchain::verify_toolchain_binary(&checked_binary, artifact)
            })
    })
    .await
    .map_err(|error| TypstToolchainError::other(format!("The Typst check stopped: {error}")))?;
    if !verified {
        return Err(TypstToolchainError::coded(
            "typst_toolchain.install_unverified",
            &version,
        ));
    }
    drop(claim);
    Ok(binary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coded_errors_become_the_apps_envelope() {
        let error = TypstToolchainError::coded("typst_toolchain.unknown_version", " 9.9.9 ");
        assert_eq!(error.message, "Typst 9.9.9 isn't a version Oleafly knows.");
        assert_eq!(
            String::from(&error),
            r#"@oleafly/error:{"code":"typst_toolchain.unknown_version","params":{"version":"9.9.9"},"detail":null}"#
        );
        assert_eq!(
            String::from(TypstToolchainError::other("disk full")),
            "disk full"
        );
    }

    #[test]
    fn tinymist_builds_follow_the_typst_minor() {
        let bundled = catalog().bundled_version().clone();
        let release = release_for_typst(catalog(), &bundled).unwrap();
        assert!(minor_key(&release.typst_minor).unwrap() <= (bundled.major, bundled.minor));
        assert!(tinymist_version_for("not a version").is_none());
    }

    #[test]
    fn a_toolchain_without_a_target_offers_no_downloads() {
        let root = tempfile::tempdir().unwrap();
        let toolchain = TypstToolchain::new(
            root.path().to_path_buf(),
            None,
            None,
            None,
            SystemLookup::Lazy,
        );
        let latest = catalog().curated_typst_versions()[0].version.to_string();
        let error = toolchain.install_request(&latest).unwrap_err();
        assert_eq!(error.code, Some("typst_toolchain.not_offered"));
        assert_eq!(toolchain.default_version(), bundled_version());
    }
}
