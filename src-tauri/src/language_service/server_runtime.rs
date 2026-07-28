use super::{LanguageServiceError, LanguageServiceErrorCode, LanguageServiceKind};
use futures_util::StreamExt;
use rand::{rngs::OsRng, RngCore};
use reqwest::{redirect, Client, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{File, Metadata, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

const MANIFEST_JSON: &str = include_str!("../../../scripts/language-servers/manifest.json");
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const INSTALL_DIRECTORY: &str = "language-servers";
const MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_MEMBERS: usize = 256;
const MAX_REDIRECTS: usize = 5;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    supported_targets: Vec<String>,
    allowed_download_hosts: Vec<String>,
    servers: HashMap<String, ManifestServer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestServer {
    version: String,
    binary_base_name: String,
    tauri_external_bin: Option<String>,
    lsp: LspProfile,
    distribution: DistributionProfile,
    targets: HashMap<String, ManifestTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LspProfile {
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistributionProfile {
    default_policy: String,
    runtime_location: String,
    requires_user_consent: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestTarget {
    asset: String,
    archive_type: String,
    archive_member: String,
    archive_sha256: String,
    archive_size: u64,
    binary_sha256: String,
    binary_size: u64,
    output_filename: String,
    resource_relative_path: Option<String>,
    url: String,
}

#[derive(Debug, Clone)]
struct ServerProfile {
    kind: LanguageServiceKind,
    version: String,
    binary_base_name: String,
    args: Vec<String>,
    target_triple: String,
    target: ManifestTarget,
}

#[derive(Debug)]
struct ValidatedManifest {
    allowed_download_hosts: Vec<String>,
    profiles: HashMap<LanguageServiceKind, ServerProfile>,
}

#[derive(Debug)]
pub(super) struct ServerLaunch {
    pub(super) executable: PathBuf,
    pub(super) args: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct BundledResourcePaths {
    pub(super) root: PathBuf,
    pub(super) archive: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum InstallOutcome {
    Installed,
    AlreadyInstalled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum InstallStatus {
    Installed,
    Missing,
    Installing,
    Failed(String),
}

#[derive(Default)]
pub(super) struct InstallerState {
    installing_texlab: AtomicBool,
    tinymist_install: Mutex<()>,
    last_failures: Mutex<HashMap<LanguageServiceKind, String>>,
}

struct InstallGuard {
    state: Arc<InstallerState>,
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        self.state.installing_texlab.store(false, Ordering::Release);
    }
}

impl LanguageServiceKind {
    fn manifest_key(self) -> &'static str {
        match self {
            Self::TexLab => "texlab",
            Self::Tinymist => "tinymist",
        }
    }
}

pub(super) fn resolve_for_launch(
    app_local_data: &Path,
    state: &InstallerState,
    kind: LanguageServiceKind,
    resource: Option<&BundledResourcePaths>,
) -> Result<ServerLaunch, LanguageServiceError> {
    let profile = profile(kind)?;
    let executable = match kind {
        LanguageServiceKind::TexLab => resolve_texlab(app_local_data, &profile)?,
        LanguageServiceKind::Tinymist => ensure_tinymist_from_resource(
            app_local_data,
            state,
            &profile,
            required_resource(resource)?,
        )?,
    };
    Ok(ServerLaunch {
        executable,
        args: profile.args,
    })
}

pub(super) async fn install_texlab(
    app_local_data: PathBuf,
    state: Arc<InstallerState>,
) -> Result<(String, InstallOutcome), LanguageServiceError> {
    let kind = LanguageServiceKind::TexLab;
    let profile = profile(kind)?;
    if state
        .installing_texlab
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::Backpressure,
            "TexLab installation is already in progress",
        ));
    }
    clear_failure(&state, kind);
    let _guard = InstallGuard {
        state: state.clone(),
    };

    let destination = install_binary_path(&app_local_data, &profile);
    match verify_binary(&destination, &profile.target) {
        Ok(Some(_)) => {
            return Ok((profile.version, InstallOutcome::AlreadyInstalled));
        }
        Ok(None) => {}
        Err(error) => {
            // A corrupt regular file is repaired by the atomic publisher below.
            if !is_replaceable_regular_file(&destination)? {
                remember_failure(&state, kind, &error);
                return Err(error);
            }
        }
    }

    let archive = match download_archive(&profile).await {
        Ok(bytes) => bytes,
        Err(error) => {
            remember_failure(&state, kind, &error);
            return Err(error);
        }
    };
    let binary = match extract_pinned_binary(&archive, &profile.target) {
        Ok(bytes) => bytes,
        Err(error) => {
            remember_failure(&state, kind, &error);
            return Err(error);
        }
    };
    let outcome = match publish_binary_atomically(&app_local_data, &profile, &binary) {
        Ok(outcome) => outcome,
        Err(error) => {
            remember_failure(&state, kind, &error);
            return Err(error);
        }
    };
    clear_failure(&state, kind);
    Ok((profile.version, outcome))
}

pub(super) fn install_tinymist(
    app_local_data: &Path,
    state: &InstallerState,
    resource: &BundledResourcePaths,
) -> Result<(String, InstallOutcome), LanguageServiceError> {
    let profile = profile(LanguageServiceKind::Tinymist)?;
    let destination = install_binary_path(app_local_data, &profile);
    let existed = matches!(verify_binary(&destination, &profile.target), Ok(Some(_)));
    ensure_tinymist_from_resource(app_local_data, state, &profile, resource)?;
    Ok((
        profile.version,
        if existed {
            InstallOutcome::AlreadyInstalled
        } else {
            InstallOutcome::Installed
        },
    ))
}

pub(super) fn install_status(
    app_local_data: &Path,
    state: &InstallerState,
    kind: LanguageServiceKind,
    resource: Option<&BundledResourcePaths>,
) -> Result<(String, InstallStatus), LanguageServiceError> {
    let profile = profile(kind)?;
    if kind == LanguageServiceKind::TexLab && state.installing_texlab.load(Ordering::Acquire) {
        return Ok((profile.version, InstallStatus::Installing));
    }

    let verification = match kind {
        LanguageServiceKind::TexLab => verify_binary(
            &install_binary_path(app_local_data, &profile),
            &profile.target,
        ),
        LanguageServiceKind::Tinymist => ensure_tinymist_from_resource(
            app_local_data,
            state,
            &profile,
            required_resource(resource)?,
        )
        .map(Some),
    };
    let status = match verification {
        Ok(Some(_)) => InstallStatus::Installed,
        Ok(None) => lock_unpoisoned(&state.last_failures)
            .get(&kind)
            .cloned()
            .map(InstallStatus::Failed)
            .unwrap_or(InstallStatus::Missing),
        Err(error) => InstallStatus::Failed(error.message),
    };
    Ok((profile.version, status))
}

pub(super) fn bundled_resource_relative_path(
    kind: LanguageServiceKind,
) -> Result<Option<PathBuf>, LanguageServiceError> {
    let profile = profile(kind)?;
    Ok(profile.target.resource_relative_path.map(PathBuf::from))
}

fn required_resource(
    resource: Option<&BundledResourcePaths>,
) -> Result<&BundledResourcePaths, LanguageServiceError> {
    resource.ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::SidecarUnavailable,
            "the pinned Tinymist resource archive path is unavailable",
        )
    })
}

fn remember_failure(
    state: &InstallerState,
    kind: LanguageServiceKind,
    error: &LanguageServiceError,
) {
    lock_unpoisoned(&state.last_failures).insert(kind, bounded_message(&error.message));
}

fn clear_failure(state: &InstallerState, kind: LanguageServiceKind) {
    lock_unpoisoned(&state.last_failures).remove(&kind);
}

fn profile(kind: LanguageServiceKind) -> Result<ServerProfile, LanguageServiceError> {
    let manifest = profile_manifest()?;
    manifest.profiles.get(&kind).cloned().ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::ManifestInvalid,
            format!(
                "language-server manifest has no {} profile",
                kind.manifest_key()
            ),
        )
    })
}

fn parse_manifest(json: &str) -> Result<ValidatedManifest, String> {
    let manifest: Manifest = serde_json::from_str(json)
        .map_err(|error| format!("language-server manifest is invalid JSON: {error}"))?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "unsupported language-server manifest schema {}",
            manifest.schema_version
        ));
    }
    let expected_targets: HashSet<&str> = [
        "aarch64-apple-darwin",
        "aarch64-unknown-linux-gnu",
        "x86_64-unknown-linux-gnu",
        "x86_64-pc-windows-msvc",
    ]
    .into_iter()
    .collect();
    let supported_targets: HashSet<&str> = manifest
        .supported_targets
        .iter()
        .map(String::as_str)
        .collect();
    if supported_targets.len() != manifest.supported_targets.len()
        || supported_targets != expected_targets
    {
        return Err("language-server manifest has an unexpected target allowlist".into());
    }
    if manifest.allowed_download_hosts.is_empty()
        || manifest.allowed_download_hosts.len() > 8
        || manifest
            .allowed_download_hosts
            .iter()
            .any(|host| !valid_dns_name(host))
    {
        return Err("language-server manifest has an invalid download-host allowlist".into());
    }
    let host_set: HashSet<&str> = manifest
        .allowed_download_hosts
        .iter()
        .map(String::as_str)
        .collect();
    if host_set.len() != manifest.allowed_download_hosts.len() {
        return Err("language-server manifest download hosts must be unique".into());
    }
    if manifest.servers.len() != 2
        || !manifest.servers.contains_key("texlab")
        || !manifest.servers.contains_key("tinymist")
    {
        return Err("language-server manifest must contain only TexLab and Tinymist".into());
    }

    let current_target = current_target_triple()?;
    let mut profiles = HashMap::new();
    for kind in [LanguageServiceKind::TexLab, LanguageServiceKind::Tinymist] {
        let key = kind.manifest_key();
        let server = manifest
            .servers
            .get(key)
            .ok_or_else(|| format!("language-server manifest is missing {key}"))?;
        validate_server(kind, server, &expected_targets, &host_set)?;
        let target =
            server.targets.get(current_target).cloned().ok_or_else(|| {
                format!("{key} has no manifest entry for target {current_target}")
            })?;
        profiles.insert(
            kind,
            ServerProfile {
                kind,
                version: server.version.clone(),
                binary_base_name: server.binary_base_name.clone(),
                args: server.lsp.args.clone(),
                target_triple: current_target.to_owned(),
                target,
            },
        );
    }
    Ok(ValidatedManifest {
        allowed_download_hosts: manifest.allowed_download_hosts,
        profiles,
    })
}

fn validate_server(
    kind: LanguageServiceKind,
    server: &ManifestServer,
    expected_targets: &HashSet<&str>,
    allowed_hosts: &HashSet<&str>,
) -> Result<(), String> {
    let key = kind.manifest_key();
    if server.binary_base_name != key {
        return Err(format!("{key} has an unexpected binaryBaseName"));
    }
    if !valid_version(&server.version) {
        return Err(format!("{key} has an invalid pinned version"));
    }
    match kind {
        LanguageServiceKind::TexLab => {
            if server.tauri_external_bin.is_some()
                || server.distribution.default_policy != "app-data-download"
                || server.distribution.runtime_location != "app-data"
                || !server.distribution.requires_user_consent
            {
                return Err("TexLab manifest distribution profile is unsafe".into());
            }
        }
        LanguageServiceKind::Tinymist => {
            if server.tauri_external_bin.is_some()
                || server.distribution.default_policy != "resource-archive"
                || server.distribution.runtime_location != "app-data-from-resource"
                || server.distribution.requires_user_consent
            {
                return Err("Tinymist manifest distribution profile is unsafe".into());
            }
        }
    }
    validate_lsp_profile(key, &server.lsp)?;
    let targets: HashSet<&str> = server.targets.keys().map(String::as_str).collect();
    if targets != *expected_targets {
        return Err(format!(
            "{key} target entries do not match supportedTargets"
        ));
    }
    for (triple, target) in &server.targets {
        validate_target(kind, server, triple, target, allowed_hosts)?;
    }
    Ok(())
}

fn validate_lsp_profile(key: &str, profile: &LspProfile) -> Result<(), String> {
    if profile.args.is_empty()
        || profile.args.len() > 16
        || profile.args.iter().any(|arg| {
            arg.is_empty()
                || arg.len() > 256
                || arg.contains('\0')
                || arg.contains('\r')
                || arg.contains('\n')
        })
    {
        return Err(format!("{key} has invalid lsp.args"));
    }
    Ok(())
}

fn validate_target(
    kind: LanguageServiceKind,
    server: &ManifestServer,
    triple: &str,
    target: &ManifestTarget,
    allowed_hosts: &HashSet<&str>,
) -> Result<(), String> {
    if !valid_path_segment(&target.asset) {
        return Err(format!("{triple} has an unsafe release asset name"));
    }
    if target.archive_type != "tar.gz" && target.archive_type != "zip" {
        return Err(format!("{triple} has an unsupported archive type"));
    }
    validate_member_path(&target.archive_member)
        .map_err(|message| format!("{triple} archive member is invalid: {message}"))?;
    let windows = triple.ends_with("-windows-msvc");
    if (windows && target.archive_type != "zip")
        || (!windows && target.archive_type != "tar.gz")
        || Path::new(&target.archive_member).file_name()
            != Some(std::ffi::OsStr::new(&platform_executable_name(
                &server.binary_base_name,
                windows,
            )))
    {
        return Err(format!("{triple} has an unexpected archive profile"));
    }
    if !valid_sha256(&target.archive_sha256) || !valid_sha256(&target.binary_sha256) {
        return Err(format!("{triple} has an invalid SHA-256 digest"));
    }
    if target.archive_size == 0
        || target.archive_size > MAX_ARCHIVE_BYTES
        || target.binary_size == 0
        || target.binary_size > MAX_BINARY_BYTES
    {
        return Err(format!("{triple} has an unsafe pinned size"));
    }
    let expected_output =
        target_suffixed_executable_name(&server.binary_base_name, triple, windows);
    if target.output_filename != expected_output {
        return Err(format!("{triple} has an unexpected outputFilename"));
    }
    validate_download_url(&target.url, allowed_hosts)
        .map_err(|message| format!("{triple} download URL is invalid: {message}"))?;
    match kind {
        LanguageServiceKind::TexLab => {
            if target.resource_relative_path.is_some() {
                return Err(format!(
                    "{triple} unexpectedly declares a bundled TexLab resource"
                ));
            }
        }
        LanguageServiceKind::Tinymist => {
            let expected = format!(
                "resources/language-servers/{}/{}/{}",
                kind.manifest_key(),
                server.version,
                target.asset
            );
            if target.resource_relative_path.as_deref() != Some(expected.as_str()) {
                return Err(format!("{triple} has an unexpected Tinymist resource path"));
            }
            validate_member_path(&expected)
                .map_err(|message| format!("{triple} resource path is invalid: {message}"))?;
        }
    }
    Ok(())
}

async fn download_archive(profile: &ServerProfile) -> Result<Vec<u8>, LanguageServiceError> {
    let manifest = profile_manifest()?;
    let allowed_hosts: HashSet<String> = manifest.allowed_download_hosts.iter().cloned().collect();
    let redirect_hosts = allowed_hosts.clone();
    let policy = redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        if validate_download_url_owned(attempt.url(), &redirect_hosts).is_err() {
            return attempt.error("redirect target is outside the download allowlist");
        }
        attempt.follow()
    });
    let client = Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(policy)
        .build()
        .map_err(|error| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::DownloadFailed,
                format!(
                    "failed to initialize the TexLab downloader: {}",
                    redacted_http_error(error)
                ),
            )
        })?;
    let response = client
        .get(&profile.target.url)
        .header("User-Agent", "Oleafly-language-server-installer")
        .send()
        .await
        .map_err(|error| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::DownloadFailed,
                format!(
                    "failed to download the pinned TexLab archive: {}",
                    redacted_http_error(error)
                ),
            )
        })?;
    if !response.status().is_success() {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::DownloadFailed,
            format!(
                "TexLab archive download returned HTTP {}",
                response.status()
            ),
        ));
    }
    if let Some(length) = response.content_length() {
        if length != profile.target.archive_size {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "TexLab archive Content-Length does not match the pinned size",
            ));
        }
    }

    let expected_size = usize::try_from(profile.target.archive_size).map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::ManifestInvalid,
            "TexLab archive size cannot be represented on this platform",
        )
    })?;
    let mut archive = Vec::with_capacity(expected_size);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::DownloadFailed,
                format!(
                    "TexLab archive download failed: {}",
                    redacted_http_error(error)
                ),
            )
        })?;
        let next_size = archive.len().checked_add(chunk.len());
        if next_size.is_none() || next_size.unwrap_or(usize::MAX) > expected_size {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "TexLab archive exceeded the pinned size",
            ));
        }
        archive.extend_from_slice(&chunk);
    }
    verify_bytes(
        &archive,
        profile.target.archive_size,
        &profile.target.archive_sha256,
        "TexLab archive",
    )?;
    Ok(archive)
}

fn redacted_http_error(error: reqwest::Error) -> String {
    bounded_message(&error.without_url().to_string())
}

fn profile_manifest() -> Result<&'static ValidatedManifest, LanguageServiceError> {
    static MANIFEST: OnceLock<Result<ValidatedManifest, String>> = OnceLock::new();
    match MANIFEST.get_or_init(|| parse_manifest(MANIFEST_JSON)) {
        Ok(manifest) => Ok(manifest),
        Err(message) => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::ManifestInvalid,
            message.clone(),
        )),
    }
}

fn extract_pinned_binary(
    archive: &[u8],
    target: &ManifestTarget,
) -> Result<Vec<u8>, LanguageServiceError> {
    verify_bytes(
        archive,
        target.archive_size,
        &target.archive_sha256,
        "language-server archive",
    )?;
    let binary = match target.archive_type.as_str() {
        "tar.gz" => extract_tar_gz_member(archive, target)?,
        "zip" => extract_zip_member(archive, target)?,
        _ => {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::ManifestInvalid,
                "language-server archive type is unsupported",
            ))
        }
    };
    verify_bytes(
        &binary,
        target.binary_size,
        &target.binary_sha256,
        "language-server binary",
    )?;
    Ok(binary)
}

fn extract_tar_gz_member(
    archive: &[u8],
    target: &ManifestTarget,
) -> Result<Vec<u8>, LanguageServiceError> {
    let decoder = flate2::read::GzDecoder::new(Cursor::new(archive));
    let mut tar = tar::Archive::new(decoder);
    let entries = tar.entries().map_err(archive_error)?;
    let expected = Path::new(&target.archive_member);
    let mut found = None;
    let mut names = HashSet::new();
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ARCHIVE_MEMBERS {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive contains too many members",
            ));
        }
        let entry = entry.map_err(archive_error)?;
        let path = entry.path().map_err(archive_error)?.into_owned();
        validate_member_path_os(&path).map_err(|message| {
            LanguageServiceError::new(LanguageServiceErrorCode::IntegrityFailure, message)
        })?;
        if !names.insert(path.clone()) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive contains a duplicate member",
            ));
        }
        let entry_type = entry.header().entry_type();
        if !entry_type.is_file() && !entry_type.is_dir() {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive contains a link or unsupported member type",
            ));
        }
        if entry_type.is_dir() && entry.size() != 0 {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive contains a directory with content",
            ));
        }
        if path != expected {
            continue;
        }
        if found.is_some() || !entry_type.is_file() {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive has an unsafe duplicate or non-file target member",
            ));
        }
        if entry.size() != target.binary_size {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server archive member size does not match the manifest",
            ));
        }
        let mut bytes = Vec::with_capacity(target.binary_size as usize);
        entry
            .take(target.binary_size + 1)
            .read_to_end(&mut bytes)
            .map_err(archive_error)?;
        found = Some(bytes);
    }
    found.ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server archive does not contain the pinned member",
        )
    })
}

fn extract_zip_member(
    archive: &[u8],
    target: &ManifestTarget,
) -> Result<Vec<u8>, LanguageServiceError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(archive_error)?;
    if zip.len() > MAX_ARCHIVE_MEMBERS {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server archive contains too many members",
        ));
    }
    let expected = Path::new(&target.archive_member);
    let mut found = None;
    let mut names = HashSet::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(archive_error)?;
        let path = entry.enclosed_name().ok_or_else(|| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server zip contains an unsafe member path",
            )
        })?;
        validate_member_path_os(&path).map_err(|message| {
            LanguageServiceError::new(LanguageServiceErrorCode::IntegrityFailure, message)
        })?;
        if !names.insert(path.clone()) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server zip contains a duplicate member",
            ));
        }
        if entry.encrypted() || (!entry.is_file() && !entry.is_dir()) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server zip contains an encrypted, linked, or unsupported member",
            ));
        }
        if path != expected {
            continue;
        }
        if found.is_some() || !entry.is_file() || entry.size() != target.binary_size {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server zip has an unsafe duplicate, non-file, or wrong-size target member",
            ));
        }
        let mut bytes = Vec::with_capacity(target.binary_size as usize);
        entry
            .by_ref()
            .take(target.binary_size + 1)
            .read_to_end(&mut bytes)
            .map_err(archive_error)?;
        found = Some(bytes);
    }
    found.ok_or_else(|| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server archive does not contain the pinned member",
        )
    })
}

fn archive_error(error: impl std::fmt::Display) -> LanguageServiceError {
    LanguageServiceError::new(
        LanguageServiceErrorCode::IntegrityFailure,
        format!("language-server archive is invalid: {error}"),
    )
}

fn publish_binary_atomically(
    app_local_data: &Path,
    profile: &ServerProfile,
    binary: &[u8],
) -> Result<InstallOutcome, LanguageServiceError> {
    verify_bytes(
        binary,
        profile.target.binary_size,
        &profile.target.binary_sha256,
        "language-server binary",
    )?;
    let directory = secure_install_directory(app_local_data, profile)?;
    let destination = directory.join(platform_executable_name(
        &profile.binary_base_name,
        cfg!(windows),
    ));
    match verify_binary(&destination, &profile.target) {
        Ok(Some(_)) => return Ok(InstallOutcome::AlreadyInstalled),
        Ok(None) => {}
        Err(error) => {
            if !is_replaceable_regular_file(&destination)? {
                return Err(error);
            }
        }
    }

    let (temporary_path, mut temporary) = create_staging_file(&directory, "install")?;
    let mut cleanup = StagedPath::new(temporary_path.clone());
    temporary.write_all(binary).map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            format!("failed to write the staged language server: {error}"),
        )
    })?;
    temporary.sync_all().map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            format!("failed to sync the staged language server: {error}"),
        )
    })?;
    drop(temporary);
    make_executable(&temporary_path)?;
    verify_binary(&temporary_path, &profile.target)?;

    if !is_replaceable_regular_file(&destination)? {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "existing language-server install is not a replaceable regular file",
        ));
    }
    replace_file_atomically(&temporary_path, &destination).map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            format!("failed to publish the language server atomically: {error}"),
        )
    })?;
    cleanup.committed = true;
    verify_binary(&destination, &profile.target)?;
    sync_directory(&directory)?;
    Ok(InstallOutcome::Installed)
}

struct StagedPath {
    path: PathBuf,
    committed: bool,
}

impl StagedPath {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }
}

impl Drop for StagedPath {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn create_staging_file(
    directory: &Path,
    label: &str,
) -> Result<(PathBuf, File), LanguageServiceError> {
    for _ in 0..16 {
        let path = unused_sibling_path(directory, label);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o700).custom_flags(libc::O_CLOEXEC);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(LanguageServiceError::new(
                    LanguageServiceErrorCode::InstallFailed,
                    format!("failed to create a staged language-server file: {error}"),
                ))
            }
        }
    }
    Err(LanguageServiceError::new(
        LanguageServiceErrorCode::InstallFailed,
        "failed to allocate a unique staged language-server file",
    ))
}

fn unused_sibling_path(directory: &Path, label: &str) -> PathBuf {
    let mut random = [0_u8; 16];
    OsRng.fill_bytes(&mut random);
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    directory.join(format!(".oleafly-{label}-{suffix}"))
}

fn secure_install_directory(
    app_local_data: &Path,
    profile: &ServerProfile,
) -> Result<PathBuf, LanguageServiceError> {
    ensure_trusted_base(app_local_data)?;
    let base = std::fs::canonicalize(app_local_data).map_err(install_io_error)?;
    let language_servers = ensure_secure_child_directory(&base, INSTALL_DIRECTORY)?;
    let server = ensure_secure_child_directory(&language_servers, profile.kind.manifest_key())?;
    let version = ensure_secure_child_directory(&server, &profile.version)?;
    ensure_secure_child_directory(&version, &profile.target_triple)
}

fn ensure_trusted_base(path: &Path) -> Result<(), LanguageServiceError> {
    std::fs::create_dir_all(path).map_err(install_io_error)?;
    let metadata = std::fs::symlink_metadata(path).map_err(install_io_error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "application local-data path is not a real directory",
        ));
    }
    Ok(())
}

fn ensure_secure_child_directory(
    parent: &Path,
    name: &str,
) -> Result<PathBuf, LanguageServiceError> {
    if !valid_path_segment(name) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::ManifestInvalid,
            "language-server install path contains an unsafe segment",
        ));
    }
    let candidate = parent.join(name);
    match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => {
            if !metadata.is_dir()
                || metadata.file_type().is_symlink()
                || is_reparse_point(&metadata)
            {
                return Err(LanguageServiceError::new(
                    LanguageServiceErrorCode::InstallFailed,
                    "language-server install directory is not a real directory",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&candidate).map_err(install_io_error)?;
        }
        Err(error) => return Err(install_io_error(error)),
    }
    let metadata = std::fs::symlink_metadata(&candidate).map_err(install_io_error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "language-server install directory is not a real directory",
        ));
    }
    let resolved = std::fs::canonicalize(&candidate).map_err(install_io_error)?;
    let resolved_parent = std::fs::canonicalize(parent).map_err(install_io_error)?;
    if resolved.parent() != Some(resolved_parent.as_path()) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            "language-server install directory escapes its parent",
        ));
    }
    Ok(resolved)
}

fn install_io_error(error: std::io::Error) -> LanguageServiceError {
    LanguageServiceError::new(
        LanguageServiceErrorCode::InstallFailed,
        format!("language-server install filesystem operation failed: {error}"),
    )
}

fn install_binary_path(app_local_data: &Path, profile: &ServerProfile) -> PathBuf {
    app_local_data
        .join(INSTALL_DIRECTORY)
        .join(profile.kind.manifest_key())
        .join(&profile.version)
        .join(&profile.target_triple)
        .join(platform_executable_name(
            &profile.binary_base_name,
            cfg!(windows),
        ))
}

fn resolve_texlab(
    app_local_data: &Path,
    profile: &ServerProfile,
) -> Result<PathBuf, LanguageServiceError> {
    let installed = install_binary_path(app_local_data, profile);
    match verify_binary(&installed, &profile.target) {
        Ok(Some(path)) => return Ok(path),
        Ok(None) => {}
        Err(error) => return Err(error),
    }
    if let Some(path) = verified_debug_binary(profile)? {
        return Ok(path);
    }
    Err(LanguageServiceError::setup_required(
        profile.kind,
        profile.version.clone(),
        "TexLab is not installed; install the pinned language server before starting it",
    ))
}

fn ensure_tinymist_from_resource(
    app_local_data: &Path,
    state: &InstallerState,
    profile: &ServerProfile,
    resource: &BundledResourcePaths,
) -> Result<PathBuf, LanguageServiceError> {
    let destination = install_binary_path(app_local_data, profile);
    match verify_binary(&destination, &profile.target) {
        Ok(Some(path)) => {
            clear_failure(state, profile.kind);
            return Ok(path);
        }
        Ok(None) => {}
        Err(error) => {
            if !is_replaceable_regular_file(&destination)? {
                remember_failure(state, profile.kind, &error);
                return Err(error);
            }
        }
    }

    let _install_guard = lock_unpoisoned(&state.tinymist_install);
    match verify_binary(&destination, &profile.target) {
        Ok(Some(path)) => {
            clear_failure(state, profile.kind);
            return Ok(path);
        }
        Ok(None) => {}
        Err(error) => {
            if !is_replaceable_regular_file(&destination)? {
                remember_failure(state, profile.kind, &error);
                return Err(error);
            }
        }
    }

    let result = (|| {
        let archive = read_bundled_resource_archive(resource, profile)?;
        let binary = extract_pinned_binary(&archive, &profile.target)?;
        publish_binary_atomically(app_local_data, profile, &binary)?;
        verify_binary(&destination, &profile.target)?.ok_or_else(|| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::InstallFailed,
                "Tinymist disappeared after its atomic resource installation",
            )
        })
    })();
    match result {
        Ok(path) => {
            clear_failure(state, profile.kind);
            Ok(path)
        }
        Err(error) => {
            remember_failure(state, profile.kind, &error);
            Err(error)
        }
    }
}

fn read_bundled_resource_archive(
    resource: &BundledResourcePaths,
    profile: &ServerProfile,
) -> Result<Vec<u8>, LanguageServiceError> {
    let relative = profile
        .target
        .resource_relative_path
        .as_deref()
        .ok_or_else(|| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::ManifestInvalid,
                "Tinymist has no pinned resource archive path",
            )
        })?;
    validate_member_path(relative).map_err(|message| {
        LanguageServiceError::new(LanguageServiceErrorCode::ManifestInvalid, message)
    })?;
    let expected = resource.root.join(relative);
    if resource.archive != expected {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "resolved Tinymist resource path does not match the pinned manifest",
        ));
    }
    validate_resource_path(&resource.root, &resource.archive, relative)?;
    let mut file = open_regular_nofollow(&resource.archive, "Tinymist resource archive")?;
    let metadata = file.metadata().map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("failed to inspect the opened Tinymist resource archive: {error}"),
        )
    })?;
    if metadata.len() != profile.target.archive_size {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "Tinymist resource archive size does not match the pinned manifest",
        ));
    }
    let capacity = usize::try_from(profile.target.archive_size).map_err(|_| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::ManifestInvalid,
            "Tinymist resource archive size cannot be represented on this platform",
        )
    })?;
    let mut bytes = Vec::with_capacity(capacity);
    Read::by_ref(&mut file)
        .take(profile.target.archive_size + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                format!("failed to read the Tinymist resource archive: {error}"),
            )
        })?;
    verify_bytes(
        &bytes,
        profile.target.archive_size,
        &profile.target.archive_sha256,
        "Tinymist resource archive",
    )?;
    validate_resource_path(&resource.root, &resource.archive, relative)?;
    Ok(bytes)
}

fn validate_resource_path(
    root: &Path,
    archive: &Path,
    relative: &str,
) -> Result<(), LanguageServiceError> {
    if !root.is_absolute() || !archive.is_absolute() {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "Tinymist resource paths must be absolute",
        ));
    }
    validate_absolute_directory_chain(root)?;
    let canonical_root = std::fs::canonicalize(root).map_err(resource_integrity_io)?;

    let components: Vec<_> = Path::new(relative).components().collect();
    let mut parent = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(segment) = component else {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::ManifestInvalid,
                "Tinymist resource path contains an unsafe segment",
            ));
        };
        let current = parent.join(segment);
        let metadata = match std::fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(LanguageServiceError::new(
                    LanguageServiceErrorCode::SidecarUnavailable,
                    "the pinned Tinymist resource archive is missing; reinstall Oleafly",
                ))
            }
            Err(error) => return Err(resource_integrity_io(error)),
        };
        let is_leaf = index + 1 == components.len();
        let expected_type = if is_leaf {
            metadata.is_file()
        } else {
            metadata.is_dir()
        };
        if !expected_type || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "Tinymist resource path contains a linked, reparsed, or wrong-type node",
            ));
        }
        let canonical = std::fs::canonicalize(&current).map_err(resource_integrity_io)?;
        let canonical_parent = std::fs::canonicalize(&parent).map_err(resource_integrity_io)?;
        if canonical.parent() != Some(canonical_parent.as_path()) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "Tinymist resource path escapes its resource directory",
            ));
        }
        parent = current;
    }
    if parent != archive {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "Tinymist resource archive resolved to an unexpected path",
        ));
    }
    let canonical_archive = std::fs::canonicalize(archive).map_err(resource_integrity_io)?;
    if !canonical_archive.starts_with(&canonical_root) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "Tinymist resource archive escapes its resource root",
        ));
    }
    Ok(())
}

fn validate_absolute_directory_chain(path: &Path) -> Result<(), LanguageServiceError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&current).map_err(resource_integrity_io)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "Tinymist resource directory contains a linked or reparsed ancestor",
            ));
        }
    }
    Ok(())
}

fn resource_integrity_io(error: std::io::Error) -> LanguageServiceError {
    LanguageServiceError::new(
        LanguageServiceErrorCode::IntegrityFailure,
        format!("Tinymist resource validation failed: {error}"),
    )
}

fn verified_debug_binary(profile: &ServerProfile) -> Result<Option<PathBuf>, LanguageServiceError> {
    #[cfg(debug_assertions)]
    {
        let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&profile.target.output_filename);
        verify_binary(&candidate, &profile.target)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = profile;
        Ok(None)
    }
}

fn verify_binary(
    path: &Path,
    target: &ManifestTarget,
) -> Result<Option<PathBuf>, LanguageServiceError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                format!("failed to inspect the language-server binary: {error}"),
            ))
        }
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server binary is not a real regular file",
        ));
    }
    if metadata.len() != target.binary_size {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server binary size does not match the pinned manifest",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server binary is not executable",
            ));
        }
    }
    let mut file = open_regular_nofollow(path, "language-server binary")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                format!("failed to read the language-server binary: {error}"),
            )
        })?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > target.binary_size {
            return Err(LanguageServiceError::new(
                LanguageServiceErrorCode::IntegrityFailure,
                "language-server binary exceeded the pinned size while hashing",
            ));
        }
        hasher.update(&buffer[..read]);
    }
    let digest = format!("{:x}", hasher.finalize());
    if total != target.binary_size || digest != target.binary_sha256 {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            "language-server binary SHA-256 does not match the pinned manifest",
        ));
    }
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("failed to resolve the language-server binary: {error}"),
        )
    })?;
    Ok(Some(canonical))
}

fn open_regular_nofollow(path: &Path, label: &str) -> Result<File, LanguageServiceError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("failed to open the {label} safely: {error}"),
        )
    })?;
    let metadata = file.metadata().map_err(|error| {
        LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("failed to inspect the opened {label}: {error}"),
        )
    })?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("opened {label} is not a real regular file"),
        ));
    }
    Ok(file)
}

fn is_replaceable_regular_file(path: &Path) -> Result<bool, LanguageServiceError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.is_file()
            && !metadata.file_type().is_symlink()
            && !is_reparse_point(&metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(LanguageServiceError::new(
            LanguageServiceErrorCode::InstallFailed,
            format!("failed to inspect the existing language-server install: {error}"),
        )),
    }
}

fn make_executable(path: &Path) -> Result<(), LanguageServiceError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(install_io_error)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), LanguageServiceError> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(install_io_error)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    const RETRY_DELAYS_MS: [u64; 9] = [10, 20, 40, 80, 160, 320, 500, 500, 500];
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    for attempt in 0..=RETRY_DELAYS_MS.len() {
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if attempt == RETRY_DELAYS_MS.len()
            || !matches!(error.raw_os_error(), Some(5 | 32 | 33 | 1224))
        {
            return Err(error);
        }
        std::thread::sleep(Duration::from_millis(RETRY_DELAYS_MS[attempt]));
    }
    unreachable!("the bounded Windows replacement loop always returns")
}

fn verify_bytes(
    bytes: &[u8],
    expected_size: u64,
    expected_sha256: &str,
    label: &str,
) -> Result<(), LanguageServiceError> {
    if bytes.len() as u64 != expected_size {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("{label} size does not match the pinned manifest"),
        ));
    }
    let digest = format!("{:x}", Sha256::digest(bytes));
    if digest != expected_sha256 {
        return Err(LanguageServiceError::new(
            LanguageServiceErrorCode::IntegrityFailure,
            format!("{label} SHA-256 does not match the pinned manifest"),
        ));
    }
    Ok(())
}

fn validate_download_url(url: &str, allowed_hosts: &HashSet<&str>) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "URL cannot be parsed")?;
    let owned: HashSet<String> = allowed_hosts
        .iter()
        .map(|host| (*host).to_owned())
        .collect();
    validate_download_url_owned(&parsed, &owned)
}

fn validate_download_url_owned(url: &Url, allowed_hosts: &HashSet<String>) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("URL must use HTTPS".into());
    }
    let host = url.host_str().ok_or("URL has no host")?;
    if !allowed_hosts.contains(host) {
        return Err("URL host is not allowlisted".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !matches!(url.port(), None | Some(443))
    {
        return Err("URL contains unsafe authority or fragment data".into());
    }
    Ok(())
}

fn validate_member_path(value: &str) -> Result<(), String> {
    if value.is_empty() || value.contains('\\') || value.contains('\0') {
        return Err("archive path is empty or contains forbidden characters".into());
    }
    validate_member_path_os(Path::new(value))
}

fn validate_member_path_os(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("archive path is not a safe relative member".into());
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_version(value: &str) -> bool {
    let components: Vec<&str> = value.split('.').collect();
    components.len() == 3
        && components.iter().all(|component| {
            !component.is_empty()
                && component.len() <= 5
                && component.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn valid_dns_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn valid_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

fn platform_executable_name(base: &str, windows: bool) -> String {
    if windows {
        format!("{base}.exe")
    } else {
        base.to_owned()
    }
}

fn target_suffixed_executable_name(base: &str, target: &str, windows: bool) -> String {
    if windows {
        format!("{base}-{target}.exe")
    } else {
        format!("{base}-{target}")
    }
}

#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
fn current_target_triple() -> Result<&'static str, String> {
    Ok("aarch64-apple-darwin")
}

#[cfg(all(target_arch = "aarch64", target_os = "linux", target_env = "gnu"))]
fn current_target_triple() -> Result<&'static str, String> {
    Ok("aarch64-unknown-linux-gnu")
}

#[cfg(all(target_arch = "x86_64", target_os = "linux", target_env = "gnu"))]
fn current_target_triple() -> Result<&'static str, String> {
    Ok("x86_64-unknown-linux-gnu")
}

#[cfg(all(target_arch = "x86_64", target_os = "windows", target_env = "msvc"))]
fn current_target_triple() -> Result<&'static str, String> {
    Ok("x86_64-pc-windows-msvc")
}

#[cfg(not(any(
    all(target_arch = "aarch64", target_os = "macos"),
    all(target_arch = "aarch64", target_os = "linux", target_env = "gnu"),
    all(target_arch = "x86_64", target_os = "linux", target_env = "gnu"),
    all(target_arch = "x86_64", target_os = "windows", target_env = "msvc")
)))]
fn current_target_triple() -> Result<&'static str, String> {
    Err("this platform has no pinned language-server artifacts".into())
}

fn bounded_message(message: &str) -> String {
    const MAX_ERROR_BYTES: usize = 2 * 1024;
    if message.len() <= MAX_ERROR_BYTES {
        return message.to_owned();
    }
    let mut end = MAX_ERROR_BYTES;
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message[..end].to_owned()
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use serde_json::Value;
    fn target_for(
        archive_type: &str,
        member: &str,
        archive: &[u8],
        binary: &[u8],
    ) -> ManifestTarget {
        ManifestTarget {
            asset: format!("fixture.{archive_type}"),
            archive_type: archive_type.into(),
            archive_member: member.into(),
            archive_sha256: format!("{:x}", Sha256::digest(archive)),
            archive_size: archive.len() as u64,
            binary_sha256: format!("{:x}", Sha256::digest(binary)),
            binary_size: binary.len() as u64,
            output_filename: "fixture".into(),
            resource_relative_path: None,
            url: "https://github.com/fixture".into(),
        }
    }

    fn tar_fixture(member: &str, binary: &[u8]) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(binary.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, member, Cursor::new(binary))
            .unwrap();
        let encoder = builder.into_inner().unwrap();
        encoder.finish().unwrap()
    }

    fn zip_fixture(member: &str, binary: &[u8]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(member, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(binary).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn temp_dir(label: &str) -> PathBuf {
        let mut random = [0_u8; 8];
        OsRng.fill_bytes(&mut random);
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("oleafly-ls-{label}-{suffix}"));
        std::fs::create_dir(&path).unwrap();
        std::fs::canonicalize(path).unwrap()
    }

    fn resource_fixture(
        root: &Path,
        version: &str,
        binary: &[u8],
    ) -> (ServerProfile, BundledResourcePaths) {
        let archive = zip_fixture("tinymist.exe", binary);
        let mut target = target_for("zip", "tinymist.exe", &archive, binary);
        target.asset = "tinymist-fixture.zip".into();
        let relative = format!(
            "resources/language-servers/tinymist/{version}/{}",
            target.asset
        );
        target.resource_relative_path = Some(relative.clone());
        let archive_path = root.join(&relative);
        std::fs::create_dir_all(archive_path.parent().unwrap()).unwrap();
        std::fs::write(&archive_path, archive).unwrap();
        (
            ServerProfile {
                kind: LanguageServiceKind::Tinymist,
                version: version.into(),
                binary_base_name: "tinymist".into(),
                args: vec!["lsp".into()],
                target_triple: current_target_triple().unwrap().into(),
                target,
            },
            BundledResourcePaths {
                root: root.to_path_buf(),
                archive: archive_path,
            },
        )
    }

    #[test]
    fn embedded_manifest_is_valid_and_launch_args_are_pinned() {
        let manifest = parse_manifest(MANIFEST_JSON).unwrap();
        let texlab = manifest.profiles.get(&LanguageServiceKind::TexLab).unwrap();
        let tinymist = manifest
            .profiles
            .get(&LanguageServiceKind::Tinymist)
            .unwrap();
        assert_eq!(texlab.args, ["run"]);
        assert_eq!(tinymist.args, ["lsp"]);
        assert_eq!(texlab.version, "5.26.0");
        assert_eq!(tinymist.version, "0.15.2");
    }

    #[test]
    fn manifest_rejects_non_https_and_unsafe_profile_shapes() {
        let mut value: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        value["servers"]["texlab"]["targets"]["aarch64-apple-darwin"]["url"] =
            Value::String("http://github.com/texlab".into());
        assert!(parse_manifest(&value.to_string()).is_err());

        let mut value: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        value["servers"]["texlab"]["lsp"]["args"] = Value::Array(Vec::new());
        assert!(parse_manifest(&value.to_string()).is_err());
    }

    #[tokio::test]
    async fn download_errors_do_not_expose_request_urls_or_query_secrets() {
        let secret = "private-signed-download-token";
        let error = Client::new()
            .get(format!(
                "https://127.0.0.1:1/releases/archive?token={secret}"
            ))
            .timeout(Duration::from_millis(100))
            .send()
            .await
            .expect_err("closed local port must reject the fixture request");
        let message = redacted_http_error(error);
        assert!(!message.contains(secret));
        assert!(!message.contains("127.0.0.1"));
        assert!(!message.contains("/releases/archive"));
    }

    #[test]
    fn extracts_only_the_exact_pinned_tar_and_zip_member() {
        let binary = b"fixture-language-server";
        let tar = tar_fixture("nested/server", binary);
        let tar_target = target_for("tar.gz", "nested/server", &tar, binary);
        assert_eq!(extract_pinned_binary(&tar, &tar_target).unwrap(), binary);

        let zip = zip_fixture("server.exe", binary);
        let zip_target = target_for("zip", "server.exe", &zip, binary);
        assert_eq!(extract_pinned_binary(&zip, &zip_target).unwrap(), binary);

        let wrong_target = target_for("zip", "../server.exe", &zip, binary);
        assert_eq!(
            extract_pinned_binary(&zip, &wrong_target).unwrap_err().code,
            LanguageServiceErrorCode::IntegrityFailure
        );
    }

    #[test]
    fn archive_and_binary_hash_or_size_mismatch_fails_closed() {
        let binary = b"fixture-language-server";
        let archive = zip_fixture("server", binary);
        let mut target = target_for("zip", "server", &archive, binary);
        target.archive_sha256 = "0".repeat(64);
        assert_eq!(
            extract_pinned_binary(&archive, &target).unwrap_err().code,
            LanguageServiceErrorCode::IntegrityFailure
        );

        let mut target = target_for("zip", "server", &archive, binary);
        target.binary_size += 1;
        assert_eq!(
            extract_pinned_binary(&archive, &target).unwrap_err().code,
            LanguageServiceErrorCode::IntegrityFailure
        );
    }

    #[test]
    fn tar_extractor_rejects_a_link_even_when_it_is_not_the_target() {
        let binary = b"fixture-language-server";
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut link = tar::Header::new_gnu();
        link.set_size(0);
        link.set_mode(0o777);
        link.set_entry_type(tar::EntryType::Symlink);
        link.set_link_name("server").unwrap();
        link.set_cksum();
        builder
            .append_data(&mut link, "unrelated-link", Cursor::new([]))
            .unwrap();
        let mut file = tar::Header::new_gnu();
        file.set_size(binary.len() as u64);
        file.set_mode(0o755);
        file.set_cksum();
        builder
            .append_data(&mut file, "server", Cursor::new(binary))
            .unwrap();
        let archive = builder.into_inner().unwrap().finish().unwrap();
        let target = target_for("tar.gz", "server", &archive, binary);
        assert_eq!(
            extract_pinned_binary(&archive, &target).unwrap_err().code,
            LanguageServiceErrorCode::IntegrityFailure
        );
    }

    #[test]
    fn atomic_publisher_repairs_a_corrupt_regular_install() {
        let app_data = temp_dir("atomic");
        let binary = b"fixture-language-server";
        let archive = zip_fixture("server", binary);
        let target = target_for("zip", "server", &archive, binary);
        let profile = ServerProfile {
            kind: LanguageServiceKind::TexLab,
            version: "1.2.3".into(),
            binary_base_name: "texlab".into(),
            args: vec!["run".into()],
            target_triple: current_target_triple().unwrap().into(),
            target,
        };
        let destination = install_binary_path(&app_data, &profile);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(&destination, b"corrupt").unwrap();

        assert_eq!(
            publish_binary_atomically(&app_data, &profile, binary).unwrap(),
            InstallOutcome::Installed
        );
        assert!(verify_binary(&destination, &profile.target)
            .unwrap()
            .is_some());
        assert_eq!(
            publish_binary_atomically(&app_data, &profile, binary).unwrap(),
            InstallOutcome::AlreadyInstalled
        );
        std::fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn missing_texlab_returns_structured_setup_metadata_without_downloading() {
        let app_data = temp_dir("missing");
        let binary = b"fixture-language-server";
        let archive = zip_fixture("server", binary);
        let profile = ServerProfile {
            kind: LanguageServiceKind::TexLab,
            version: "9.8.7".into(),
            binary_base_name: "texlab".into(),
            args: vec!["run".into()],
            target_triple: current_target_triple().unwrap().into(),
            target: target_for("zip", "server", &archive, binary),
        };
        let error = resolve_texlab(&app_data, &profile).unwrap_err();
        assert_eq!(error.code, LanguageServiceErrorCode::SidecarSetupRequired);
        assert_eq!(error.kind, Some(LanguageServiceKind::TexLab));
        assert_eq!(error.version.as_deref(), Some("9.8.7"));
        std::fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn bundled_resource_install_is_atomic_and_repairs_a_corrupt_install() {
        let resource_root = temp_dir("resource-install");
        let app_data = temp_dir("resource-app-data");
        let binary = b"fixture-language-server";
        let (profile, resource) = resource_fixture(&resource_root, "1.2.3", binary);
        let state = InstallerState::default();

        let installed =
            ensure_tinymist_from_resource(&app_data, &state, &profile, &resource).unwrap();
        assert!(verify_binary(&installed, &profile.target)
            .unwrap()
            .is_some());
        std::fs::write(&installed, b"corrupt").unwrap();
        let repaired =
            ensure_tinymist_from_resource(&app_data, &state, &profile, &resource).unwrap();
        assert_eq!(repaired, installed);
        assert!(verify_binary(&repaired, &profile.target).unwrap().is_some());

        std::fs::remove_dir_all(resource_root).unwrap();
        std::fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn bundled_resource_missing_or_tampered_archive_fails_closed() {
        let resource_root = temp_dir("resource-tamper");
        let app_data = temp_dir("resource-tamper-app-data");
        let binary = b"fixture-language-server";
        let (profile, resource) = resource_fixture(&resource_root, "1.2.3", binary);
        std::fs::write(&resource.archive, b"tampered").unwrap();
        let state = InstallerState::default();
        assert_eq!(
            ensure_tinymist_from_resource(&app_data, &state, &profile, &resource,)
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::IntegrityFailure
        );
        std::fs::remove_file(&resource.archive).unwrap();
        assert_eq!(
            ensure_tinymist_from_resource(&app_data, &state, &profile, &resource,)
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::SidecarUnavailable
        );

        std::fs::remove_dir_all(resource_root).unwrap();
        std::fs::remove_dir_all(app_data).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn bundled_resource_rejects_a_symlinked_path_ancestor() {
        use std::os::unix::fs::symlink;
        let root = temp_dir("resource-linked");
        let real = root.join("real");
        std::fs::create_dir(&real).unwrap();
        let linked = root.join("resources");
        symlink(&real, &linked).unwrap();
        let binary = b"fixture-language-server";
        let archive = zip_fixture("tinymist.exe", binary);
        let mut target = target_for("zip", "tinymist.exe", &archive, binary);
        target.asset = "tinymist-fixture.zip".into();
        let relative = "resources/language-servers/tinymist/1.2.3/tinymist-fixture.zip";
        target.resource_relative_path = Some(relative.into());
        let real_archive = real.join("language-servers/tinymist/1.2.3/tinymist-fixture.zip");
        std::fs::create_dir_all(real_archive.parent().unwrap()).unwrap();
        std::fs::write(&real_archive, archive).unwrap();
        let profile = ServerProfile {
            kind: LanguageServiceKind::Tinymist,
            version: "1.2.3".into(),
            binary_base_name: "tinymist".into(),
            args: vec!["lsp".into()],
            target_triple: current_target_triple().unwrap().into(),
            target,
        };
        let resource = BundledResourcePaths {
            root: root.clone(),
            archive: root.join(relative),
        };
        assert_eq!(
            read_bundled_resource_archive(&resource, &profile)
                .unwrap_err()
                .code,
            LanguageServiceErrorCode::IntegrityFailure
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn verifier_rejects_symlinked_binary() {
        use std::os::unix::fs::symlink;
        let root = temp_dir("symlink");
        let binary = b"fixture";
        let real = root.join("real");
        std::fs::write(&real, binary).unwrap();
        make_executable(&real).unwrap();
        let link = root.join("link");
        symlink(&real, &link).unwrap();
        let archive = zip_fixture("server", binary);
        let target = target_for("zip", "server", &archive, binary);
        assert_eq!(
            verify_binary(&link, &target).unwrap_err().code,
            LanguageServiceErrorCode::IntegrityFailure
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
