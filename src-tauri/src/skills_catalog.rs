use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::skills::{
    ManagedManifest, SkillOrigin, SkillRecord, SkillSource, SkillTier,
    MANAGED_MANIFEST_SCHEMA_VERSION, MAX_PACK_BYTES, MAX_PACK_DEPTH, MAX_PACK_ENTRIES,
};

const BUNDLED_CATALOG: &str = include_str!("../resources/skills-catalog.json");
const DEFAULT_BASE_URL: &str = "https://cdn.oleafly.com";
const CATALOG_PATH: &str = "/catalogs/skills.json";
const CATALOG_SCHEMA_VERSION: u32 = 1;
const CACHE_FILE: &str = "skills.json";
const CACHE_STAMP_FILE: &str = "skills.fetched-at";
const MAX_CATALOG_BYTES: usize = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const REFRESH_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
const CATALOG_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const DEFAULT_HOSTS: [&str; 2] = ["cdn.oleafly.com", "mirrors.oleafly.com"];
const MAX_REDIRECTS: usize = 5;

static ADOPTED: Mutex<Option<CatalogDocument>> = Mutex::new(None);

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPack {
    pub id: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub files: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<SkillOrigin>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDocument {
    pub schema_version: u32,
    pub generated_at: String,
    #[serde(default)]
    pub packs: Vec<CatalogPack>,
    #[serde(default)]
    pub skills: Vec<CatalogEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Bundled,
    Cached,
    Fetched,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    pub license: String,
    pub version: String,
    pub bytes: u64,
    pub files: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<SkillOrigin>,
    pub bundled: bool,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub update_available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsCatalog {
    pub source: CatalogSource,
    pub generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub skills: Vec<CatalogSkill>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillProgress {
    kind: &'static str,
    id: String,
    phase: &'static str,
    received: u64,
    total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit(app: &AppHandle, id: &str, phase: &'static str, received: u64, total: u64) {
    let _ = app.emit(
        "asset-progress",
        SkillProgress {
            kind: "skill",
            id: id.to_string(),
            phase,
            received,
            total,
            message: None,
        },
    );
}

fn emit_error(app: &AppHandle, id: &str, message: &str) {
    let _ = app.emit(
        "asset-progress",
        SkillProgress {
            kind: "skill",
            id: id.to_string(),
            phase: "error",
            received: 0,
            total: 0,
            message: Some(message.to_string()),
        },
    );
}

pub(crate) fn parse_document(source: &str) -> Result<CatalogDocument, String> {
    if source.len() > MAX_CATALOG_BYTES {
        return Err("The skills catalog is too large.".into());
    }
    let document: CatalogDocument =
        serde_json::from_str(source).map_err(|error| format!("Invalid skills catalog: {error}"))?;
    if document.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported skills catalog version {}.",
            document.schema_version
        ));
    }
    if document.generated_at.trim().is_empty() {
        return Err("The skills catalog has no generation time.".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for entry in &document.skills {
        if crate::skills::validate_skill_id(&entry.id).is_err() {
            return Err(format!("Invalid skill id in the catalog: {}", entry.id));
        }
        if !seen.insert(entry.id.clone()) {
            return Err(format!("The catalog lists \"{}\" twice.", entry.id));
        }
    }
    Ok(document)
}

pub(crate) fn bundled_document() -> CatalogDocument {
    parse_document(BUNDLED_CATALOG).unwrap_or_default()
}

fn extends(candidate: &CatalogDocument, chosen: &CatalogDocument) -> bool {
    let candidate_ids: std::collections::BTreeSet<&str> = candidate
        .skills
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    let chosen_ids: std::collections::BTreeSet<&str> = chosen
        .skills
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    if candidate_ids.len() <= chosen_ids.len() || !chosen_ids.is_subset(&candidate_ids) {
        return false;
    }
    chosen.packs.iter().all(|pack| {
        candidate
            .packs
            .iter()
            .any(|other| other.id == pack.id && other.version == pack.version)
    })
}

fn supersedes(candidate: &CatalogDocument, chosen: &CatalogDocument) -> bool {
    candidate.generated_at >= chosen.generated_at || extends(candidate, chosen)
}

pub(crate) fn merge(
    bundled: &str,
    cached: Option<&str>,
    fetched: Option<&str>,
) -> (CatalogSource, CatalogDocument) {
    let bundled = parse_document(bundled).unwrap_or_default();
    let mut source = CatalogSource::Bundled;
    let mut chosen = bundled.clone();
    if let Some(document) = cached.and_then(|raw| parse_document(raw).ok()) {
        if supersedes(&document, &chosen) {
            chosen = document;
            source = CatalogSource::Cached;
        }
    }
    if let Some(document) = fetched.and_then(|raw| parse_document(raw).ok()) {
        if supersedes(&document, &chosen) {
            chosen = document;
            source = CatalogSource::Fetched;
        }
    }
    (source, chosen)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

pub(crate) fn iso8601(epoch_ms: u64) -> String {
    let seconds = (epoch_ms / 1000) as i64;
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn base_url() -> String {
    std::env::var("OLEAFLY_SKILLS_BASE_URL")
        .ok()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn catalog_url() -> String {
    format!("{}{CATALOG_PATH}", base_url())
}

fn host_of(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') {
        return None;
    }
    let host = authority
        .rsplit_once(':')
        .filter(|(head, _)| !head.contains(':') || head.ends_with(']'))
        .map(|(head, _)| head)
        .unwrap_or(authority);
    Some((scheme.to_ascii_lowercase(), host.to_ascii_lowercase()))
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

pub(crate) fn validate_url(url: &str) -> Result<(), String> {
    let Some((scheme, host)) = host_of(url) else {
        return Err("That download address is not allowed.".into());
    };
    if host.is_empty() {
        return Err("That download address is not allowed.".into());
    }
    match scheme.as_str() {
        "https" => {}
        "http" if is_loopback(&host) => {}
        _ => return Err("Skills are downloaded over HTTPS only.".into()),
    }
    let allowed_host = host_of(&base_url())
        .map(|(_, base)| base == host)
        .unwrap_or(false)
        || DEFAULT_HOSTS.contains(&host.as_str())
        || is_loopback(&host);
    if !allowed_host {
        return Err(format!("Skills are not downloaded from {host}."));
    }
    Ok(())
}

fn cache_dir() -> Option<PathBuf> {
    crate::paths::catalogs_root().ok()
}

fn read_cache(dir: &Path) -> (Option<String>, Option<u64>) {
    let raw = std::fs::metadata(dir.join(CACHE_FILE))
        .ok()
        .filter(|metadata| metadata.is_file() && metadata.len() <= MAX_CATALOG_BYTES as u64)
        .and_then(|_| std::fs::read_to_string(dir.join(CACHE_FILE)).ok());
    if raw.is_none() {
        return (None, None);
    }
    let stamp = std::fs::read_to_string(dir.join(CACHE_STAMP_FILE))
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok());
    (raw, stamp)
}

fn write_cache(dir: &Path, source: &str, fetched_at: u64) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Could not create the catalogs directory: {error}"))?;
    crate::sandbox::atomic_write(&dir.join(CACHE_FILE), source.as_bytes())?;
    crate::sandbox::atomic_write(
        &dir.join(CACHE_STAMP_FILE),
        fetched_at.to_string().as_bytes(),
    )
}

fn redirect_refusal(url: &str, previous: usize) -> Option<&'static str> {
    if previous >= MAX_REDIRECTS {
        return Some("too many redirects");
    }
    if validate_url(url).is_err() {
        return Some("redirect target is outside the download allowlist");
    }
    None
}

fn client(connect: Duration, total: Duration) -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        match redirect_refusal(attempt.url().as_str(), attempt.previous().len()) {
            Some(reason) => attempt.error(reason),
            None => attempt.follow(),
        }
    });
    reqwest::Client::builder()
        .connect_timeout(connect)
        .timeout(total)
        .user_agent("Oleafly-skills")
        .redirect(policy)
        .build()
        .map_err(|error| format!("Could not start the download: {error}"))
}

async fn fetch_catalog(url: &str) -> Result<String, String> {
    validate_url(url)?;
    let response = client(CONNECT_TIMEOUT, CATALOG_TIMEOUT)?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("The skills catalog could not be reached: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The skills catalog returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_BYTES as u64)
    {
        return Err("The skills catalog is too large.".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = tokio::time::timeout(CATALOG_TIMEOUT, stream.next())
        .await
        .map_err(|_| "The skills catalog request timed out.".to_string())?
    {
        let chunk =
            chunk.map_err(|error| format!("The skills catalog download failed: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_CATALOG_BYTES {
            return Err("The skills catalog is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "The skills catalog is not valid UTF-8.".into())
}

struct Installed {
    version: Option<String>,
    catalog_source: bool,
}

fn installed_map(project: Option<&str>) -> BTreeMap<String, Installed> {
    let Ok(root) = crate::paths::oleafly_root() else {
        return BTreeMap::new();
    };
    let records = crate::skills::list_with(
        &root,
        crate::skills_pack::cached_pack_root().as_deref(),
        project,
    )
    .unwrap_or_default();
    records
        .into_iter()
        .map(|record| {
            (
                record.id,
                Installed {
                    version: record.pack_version.or(record.version),
                    catalog_source: record.source == SkillSource::Catalog,
                },
            )
        })
        .collect()
}

fn present(
    document: &CatalogDocument,
    bundled_ids: &std::collections::BTreeSet<String>,
    installed: &BTreeMap<String, Installed>,
) -> Vec<CatalogSkill> {
    let mut skills: Vec<CatalogSkill> = document
        .skills
        .iter()
        .map(|entry| {
            let known = installed.get(&entry.id);
            let installed_version = known.and_then(|state| state.version.clone());
            let update_available = known
                .map(|state| {
                    state.catalog_source
                        && !entry.version.is_empty()
                        && installed_version.as_deref() != Some(entry.version.as_str())
                })
                .unwrap_or(false);
            CatalogSkill {
                id: entry.id.clone(),
                name: if entry.name.is_empty() {
                    entry.id.clone()
                } else {
                    entry.name.clone()
                },
                description: entry.description.clone(),
                phase: entry.phase.clone(),
                domain: entry.domain.clone(),
                license: entry.license.clone(),
                version: entry.version.clone(),
                bytes: entry.bytes,
                files: entry.files,
                sha256: entry.sha256.clone(),
                url: entry.url.clone(),
                pack: entry.pack.clone(),
                origin: entry.origin.clone(),
                bundled: bundled_ids.contains(&entry.id),
                installed: known.is_some(),
                installed_version,
                update_available,
            }
        })
        .collect();
    skills.sort_by(|left, right| left.id.cmp(&right.id));
    skills
}

fn remember(document: &CatalogDocument) {
    if let Ok(mut adopted) = ADOPTED.lock() {
        *adopted = Some(document.clone());
    }
}

fn adopted_document() -> CatalogDocument {
    if let Ok(adopted) = ADOPTED.lock() {
        if let Some(document) = adopted.as_ref() {
            return document.clone();
        }
    }
    let cached = cache_dir().map(|dir| read_cache(&dir).0).unwrap_or(None);
    merge(BUNDLED_CATALOG, cached.as_deref(), None).1
}

async fn resolve_catalog(refresh: bool) -> SkillsCatalog {
    let dir = cache_dir();
    let (cached, stamp) = dir.as_deref().map(read_cache).unwrap_or((None, None));
    let now = now_ms();
    let stale = stamp.map_or(true, |at| now.saturating_sub(at) >= REFRESH_INTERVAL_MS);
    let mut error = None;
    let mut fetched = None;
    let mut fetched_at = stamp;
    if refresh || stale {
        match fetch_catalog(&catalog_url()).await {
            Ok(text) => match parse_document(&text) {
                Ok(_) => {
                    let at = now_ms();
                    if let Some(dir) = dir.as_deref() {
                        let _ = write_cache(dir, &text, at);
                    }
                    fetched_at = Some(at);
                    fetched = Some(text);
                }
                Err(message) => error = Some(message),
            },
            Err(message) => error = Some(message),
        }
    }
    let (source, document) = merge(BUNDLED_CATALOG, cached.as_deref(), fetched.as_deref());
    remember(&document);
    let bundled_ids = bundled_document()
        .skills
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    let installed = installed_map(None);
    SkillsCatalog {
        source,
        generated_at: document.generated_at.clone(),
        fetched_at: if matches!(source, CatalogSource::Bundled) && fetched_at.is_none() {
            None
        } else {
            fetched_at.map(iso8601)
        },
        error,
        skills: present(&document, &bundled_ids, &installed),
    }
}

fn relative_member(path: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => parts.push(part),
            _ => return Err("The skill archive contains an unsafe path.".into()),
        }
    }
    let Some((head, tail)) = parts.split_first() else {
        return Ok(None);
    };
    if head.to_string_lossy() != id {
        return Err(format!(
            "The skill archive does not unpack into a \"{id}\" folder."
        ));
    }
    if tail.is_empty() {
        return Ok(None);
    }
    if tail.len() > MAX_PACK_DEPTH {
        return Err("The skill archive is nested too deeply.".into());
    }
    let mut relative = PathBuf::new();
    for part in tail {
        let name = part.to_string_lossy();
        if name.is_empty() || name == "." || name == ".." || name.contains('\0') {
            return Err("The skill archive contains an unsafe path.".into());
        }
        relative.push(part);
    }
    Ok(Some(relative))
}

pub(crate) fn extract_archive(bytes: &[u8], id: &str, destination: &Path) -> Result<(), String> {
    let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
    let mut archive = tar::Archive::new(decoder);
    archive.set_preserve_permissions(false);
    archive.set_preserve_mtime(false);
    archive.set_unpack_xattrs(false);
    let mut entries = 0usize;
    let mut total = 0u64;
    let mut has_skill = false;
    let iterator = archive
        .entries()
        .map_err(|error| format!("The skill archive could not be read: {error}"))?;
    for entry in iterator {
        let mut entry =
            entry.map_err(|error| format!("The skill archive could not be read: {error}"))?;
        let kind = entry.header().entry_type();
        if !matches!(kind, tar::EntryType::Regular | tar::EntryType::Directory) {
            return Err("The skill archive contains an entry that is not a file or folder.".into());
        }
        let path = entry
            .path()
            .map_err(|error| format!("The skill archive contains an unreadable path: {error}"))?
            .into_owned();
        let Some(relative) = relative_member(&path, id)? else {
            continue;
        };
        entries += 1;
        if entries > MAX_PACK_ENTRIES {
            return Err(format!(
                "The skill archive exceeds the limit of {MAX_PACK_ENTRIES} entries."
            ));
        }
        let target = destination.join(&relative);
        if kind == tar::EntryType::Directory {
            std::fs::create_dir_all(&target)
                .map_err(|error| format!("Could not create a skill folder: {error}"))?;
            continue;
        }
        let size = entry.header().size().unwrap_or(0);
        total = total.saturating_add(size);
        if total > MAX_PACK_BYTES {
            return Err(format!(
                "The skill archive exceeds the limit of {MAX_PACK_BYTES} bytes."
            ));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create a skill folder: {error}"))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("Could not write a skill file: {error}"))?;
        let written = std::io::copy(
            &mut Read::by_ref(&mut entry).take(MAX_PACK_BYTES + 1),
            &mut file,
        )
        .map_err(|error| format!("Could not write a skill file: {error}"))?;
        if written > MAX_PACK_BYTES {
            return Err(format!(
                "The skill archive exceeds the limit of {MAX_PACK_BYTES} bytes."
            ));
        }
        file.flush()
            .map_err(|error| format!("Could not finish writing a skill file: {error}"))?;
        if relative == Path::new("SKILL.md") {
            has_skill = true;
        }
    }
    if !has_skill {
        return Err("The skill archive does not contain a SKILL.md file.".into());
    }
    Ok(())
}

fn verify_archive(bytes: &[u8], entry: &CatalogEntry) -> Result<(), String> {
    if entry.bytes > 0 && bytes.len() as u64 != entry.bytes {
        return Err("The downloaded skill does not match its published size.".into());
    }
    let Some(expected) = entry.sha256.as_deref() else {
        return Err("That skill has no published checksum.".into());
    };
    let digest = format!("{:x}", Sha256::digest(bytes));
    if !digest.eq_ignore_ascii_case(expected.trim()) {
        return Err("The downloaded skill does not match its published checksum.".into());
    }
    Ok(())
}

async fn download_archive(app: &AppHandle, entry: &CatalogEntry) -> Result<Vec<u8>, String> {
    let url = entry
        .url
        .as_deref()
        .ok_or_else(|| "That skill has no download address.".to_string())?;
    validate_url(url)?;
    let response = client(CONNECT_TIMEOUT, DOWNLOAD_TIMEOUT)?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("The skill could not be downloaded: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The skill download returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let declared = response.content_length();
    if declared.is_some_and(|length| length > MAX_ARCHIVE_BYTES) {
        return Err("That skill download is too large.".into());
    }
    let total = declared.unwrap_or(entry.bytes);
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = tokio::time::timeout(DOWNLOAD_TIMEOUT, stream.next())
        .await
        .map_err(|_| "The skill download timed out.".to_string())?
    {
        let chunk = chunk.map_err(|error| format!("The skill download failed: {error}"))?;
        if bytes.len() as u64 + chunk.len() as u64 > MAX_ARCHIVE_BYTES {
            return Err("That skill download is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
        emit(app, &entry.id, "download", bytes.len() as u64, total);
    }
    Ok(bytes)
}

pub(crate) fn manifest_for(entry: &CatalogEntry) -> ManagedManifest {
    ManagedManifest {
        schema_version: MANAGED_MANIFEST_SCHEMA_VERSION,
        id: entry.id.clone(),
        source: SkillSource::Catalog,
        pack: Some("shelf".to_string()),
        pack_version: Some(entry.version.clone()).filter(|version| !version.is_empty()),
        tree_sha256: String::new(),
        license: Some(entry.license.clone()).filter(|license| !license.is_empty()),
        tier: Some(SkillTier::Shelf),
        phase: entry.phase.clone(),
        origin: entry.origin.clone(),
    }
}

pub(crate) fn install_from_archive(
    root: &Path,
    entry: &CatalogEntry,
    bytes: &[u8],
) -> Result<SkillRecord, String> {
    verify_archive(bytes, entry)?;
    let skills = crate::skills::managed_skills_root(root)?;
    let staging = crate::skills::staging_path(&skills, ".skill-import-");
    std::fs::create_dir(&staging)
        .map_err(|error| format!("Could not stage the skill download: {error}"))?;
    let staged = extract_archive(bytes, &entry.id, &staging).and_then(|()| {
        crate::skills::install_staged_skill(root, &entry.id, &staging, &manifest_for(entry))
    });
    let _ = std::fs::remove_dir_all(&staging);
    staged
}

#[tauri::command]
pub async fn skills_catalog(refresh: bool) -> Result<SkillsCatalog, String> {
    Ok(resolve_catalog(refresh).await)
}

#[tauri::command]
pub async fn skills_install(app: AppHandle, id: String) -> Result<SkillRecord, String> {
    crate::skills::validate_skill_id(&id)?;
    let document = adopted_document();
    let bundled: std::collections::BTreeSet<String> = bundled_document()
        .skills
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    if bundled.contains(&id) {
        let message =
            format!("\"{id}\" already ships with Oleafly, so there is nothing to install.");
        emit_error(&app, &id, &message);
        return Err(message);
    }
    let Some(entry) = document.skills.iter().find(|entry| entry.id == id).cloned() else {
        let message = format!("The skills catalog does not list \"{id}\".");
        emit_error(&app, &id, &message);
        return Err(message);
    };
    if entry.url.is_none() || entry.sha256.is_none() {
        let message = format!("\"{id}\" cannot be downloaded yet.");
        emit_error(&app, &id, &message);
        return Err(message);
    }
    let bytes = match download_archive(&app, &entry).await {
        Ok(bytes) => bytes,
        Err(message) => {
            emit_error(&app, &id, &message);
            return Err(message);
        }
    };
    let received = bytes.len() as u64;
    emit(&app, &id, "extract", received, received);
    let root = crate::paths::oleafly_root()?;
    let installed =
        tauri::async_runtime::spawn_blocking(move || install_from_archive(&root, &entry, &bytes))
            .await
            .map_err(|error| format!("The skill install could not finish: {error}"))?;
    match installed {
        Ok(record) => {
            emit(&app, &id, "done", received, received);
            crate::skills_share::resync_now();
            Ok(record)
        }
        Err(message) => {
            emit_error(&app, &id, &message);
            Err(message)
        }
    }
}

pub(crate) fn uninstall(root: &Path, id: &str) -> Result<(), String> {
    crate::skills::validate_skill_id(id)?;
    let record = crate::skills::validate(root, id)?;
    if record.source != SkillSource::Catalog {
        return Err(format!(
            "\"{id}\" was not installed from the catalog, so it cannot be uninstalled here."
        ));
    }
    crate::skills::remove(root, id)
}

#[tauri::command]
pub fn skills_uninstall(id: String) -> Result<(), String> {
    uninstall(&crate::paths::oleafly_root()?, &id)?;
    crate::skills_share::resync_now();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUNDLED: &str = r#"{ "schemaVersion": 1, "generatedAt": "2026-09-04T00:00:00Z",
        "packs": [{ "id": "research-core", "version": "2026.09.04", "kind": "bundled" }],
        "skills": [{ "id": "paper-lookup", "name": "paper-lookup", "description": "Find papers.",
                     "phase": "research", "license": "MIT", "version": "2.1", "bytes": 10, "files": 2,
                     "pack": "research-core" }] }"#;

    fn shelf(generated_at: &str, version: &str) -> String {
        format!(
            r#"{{ "schemaVersion": 1, "generatedAt": "{generated_at}",
                  "packs": [], "skills": [
                    {{ "id": "paper-lookup", "name": "paper-lookup", "description": "Find papers.",
                       "license": "MIT", "version": "2.1", "bytes": 10, "files": 2, "pack": "research-core" }},
                    {{ "id": "gene-atlas", "name": "gene-atlas", "description": "Look up genes.",
                       "license": "MIT", "version": "{version}", "bytes": 24, "files": 1,
                       "sha256": "ab", "url": "https://cdn.oleafly.com/downloads/skills/gene-atlas/{version}/gene-atlas.tar.gz",
                       "pack": "shelf" }} ] }}"#
        )
    }

    fn gzip(raw: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(raw).unwrap();
        encoder.finish().unwrap()
    }

    fn raw_member(name: &str, kind: tar::EntryType, link: &str, body: &[u8]) -> Vec<u8> {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(kind);
        {
            let gnu = header.as_gnu_mut().unwrap();
            let name = name.as_bytes();
            gnu.name[..name.len()].copy_from_slice(name);
            let link = link.as_bytes();
            gnu.linkname[..link.len()].copy_from_slice(link);
        }
        header.set_cksum();
        let mut raw = header.as_bytes().to_vec();
        raw.extend_from_slice(body);
        let padding = (512 - body.len() % 512) % 512;
        raw.resize(raw.len() + padding, 0);
        raw
    }

    fn archive(members: &[(&str, tar::EntryType, &str, &[u8])]) -> Vec<u8> {
        let mut raw = Vec::new();
        for (name, kind, link, body) in members {
            raw.extend_from_slice(&raw_member(name, *kind, link, body));
        }
        raw.resize(raw.len() + 1024, 0);
        gzip(&raw)
    }

    fn tarball(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let members: Vec<_> = entries
            .iter()
            .map(|(name, body)| (*name, tar::EntryType::Regular, "", *body))
            .collect();
        archive(&members)
    }

    fn linked_tarball(link: tar::EntryType) -> Vec<u8> {
        archive(&[
            (
                "gene-atlas/SKILL.md",
                tar::EntryType::Regular,
                "",
                b"---\nname: gene-atlas\ndescription: d\n---\n\nDo it.\n" as &[u8],
            ),
            (
                "gene-atlas/escape",
                link,
                "../../../etc/passwd",
                b"" as &[u8],
            ),
        ])
    }

    fn valid_skill_bytes() -> Vec<u8> {
        tarball(&[
            (
                "gene-atlas/SKILL.md",
                b"---\nname: gene-atlas\ndescription: Look up genes.\n---\n\nLook the gene up, then report it.\n" as &[u8],
            ),
            ("gene-atlas/references/notes.md", b"Notes." as &[u8]),
        ])
    }

    fn entry_for(bytes: &[u8]) -> CatalogEntry {
        CatalogEntry {
            id: "gene-atlas".into(),
            name: "gene-atlas".into(),
            description: "Look up genes.".into(),
            phase: Some("research".into()),
            domain: None,
            license: "MIT".into(),
            version: "1.0.0".into(),
            bytes: bytes.len() as u64,
            files: 2,
            sha256: Some(format!("{:x}", Sha256::digest(bytes))),
            url: Some(
                "https://cdn.oleafly.com/downloads/skills/gene-atlas/1.0.0/gene-atlas.tar.gz"
                    .into(),
            ),
            pack: Some("shelf".into()),
            origin: None,
        }
    }

    #[test]
    fn the_bundled_floor_parses() {
        let document = parse_document(BUNDLED_CATALOG).unwrap();

        assert_eq!(document.schema_version, 1);
        assert!(!document.generated_at.is_empty());
        assert!(document.skills.len() >= 30);
        assert!(document.skills.iter().all(|entry| entry.url.is_none()));
        assert!(document
            .packs
            .iter()
            .any(|pack| pack.id == "research-core" && pack.kind == "bundled"));
    }

    #[test]
    fn an_unsupported_schema_or_a_missing_time_is_refused() {
        assert!(parse_document(r#"{ "schemaVersion": 2, "generatedAt": "2026-09-04" }"#).is_err());
        assert!(parse_document(r#"{ "schemaVersion": 1, "generatedAt": "  " }"#).is_err());
        assert!(parse_document(
            r#"{ "schemaVersion": 1, "generatedAt": "x", "skills": [{ "id": "../evil" }] }"#
        )
        .is_err());
        assert!(parse_document(
            r#"{ "schemaVersion": 1, "generatedAt": "x", "skills": [{ "id": "a" }, { "id": "a" }] }"#
        )
        .is_err());
    }

    #[test]
    fn a_newer_catalog_wins_and_an_older_one_is_ignored() {
        let (source, document) = merge(BUNDLED, None, None);
        assert_eq!(source, CatalogSource::Bundled);
        assert_eq!(document.skills.len(), 1);

        let (source, document) =
            merge(BUNDLED, Some(&shelf("2026-09-05T00:00:00Z", "1.0.0")), None);
        assert_eq!(source, CatalogSource::Cached);
        assert_eq!(document.skills.len(), 2);

        let (source, _) = merge(BUNDLED, Some(&shelf("2026-08-01T00:00:00Z", "1.0.0")), None);
        assert_eq!(source, CatalogSource::Bundled);

        let (source, document) = merge(
            BUNDLED,
            Some(&shelf("2026-09-05T00:00:00Z", "1.0.0")),
            Some(&shelf("2026-09-06T00:00:00Z", "2.0.0")),
        );
        assert_eq!(source, CatalogSource::Fetched);
        assert_eq!(
            document
                .skills
                .iter()
                .find(|entry| entry.id == "gene-atlas")
                .unwrap()
                .version,
            "2.0.0"
        );

        let (source, _) = merge(
            BUNDLED,
            Some(&shelf("2026-09-05T00:00:00Z", "1")),
            Some("{ nope"),
        );
        assert_eq!(source, CatalogSource::Cached);
    }

    #[test]
    fn a_fuller_shelf_is_adopted_even_when_the_bundled_floor_is_stamped_ahead() {
        let published = r#"{ "schemaVersion": 1, "generatedAt": "2026-09-02T16:25:16.000Z",
                  "packs": [{ "id": "research-core", "version": "2026.09.04", "kind": "bundled" }],
                  "skills": [
                    { "id": "paper-lookup", "name": "paper-lookup", "description": "Find papers.",
                       "license": "MIT", "version": "2.1", "bytes": 10, "files": 2, "pack": "research-core" },
                    { "id": "dask", "name": "dask", "description": "Scale dataframes.",
                       "license": "MIT", "version": "1.0.0", "bytes": 24, "files": 1,
                       "sha256": "ab", "url": "https://cdn.oleafly.com/downloads/skills/dask/1.0.0/dask.tar.gz",
                       "pack": "shelf" } ] }"#
            .to_string();

        let (source, document) = merge(BUNDLED, None, Some(&published));

        assert_eq!(source, CatalogSource::Fetched);
        assert!(document.skills.iter().any(|entry| entry.id == "dask"));

        let (cached_source, cached_document) = merge(BUNDLED, Some(&published), None);
        assert_eq!(cached_source, CatalogSource::Cached);
        assert_eq!(cached_document.skills.len(), 2);

        let renamed_pack = published.replace("2026.09.04", "2026.08.01");
        assert_eq!(
            merge(BUNDLED, None, Some(&renamed_pack)).0,
            CatalogSource::Bundled
        );

        let smaller = published.replace(
            r#"{ "id": "paper-lookup", "name": "paper-lookup", "description": "Find papers.",
                       "license": "MIT", "version": "2.1", "bytes": 10, "files": 2, "pack": "research-core" },
                    "#,
            "",
        );
        assert_eq!(
            merge(BUNDLED, None, Some(&smaller)).0,
            CatalogSource::Bundled
        );
    }

    #[test]
    fn a_redirect_is_followed_only_to_an_allowed_host() {
        assert!(redirect_refusal("https://cdn.oleafly.com/catalogs/skills.json", 0).is_none());
        assert_eq!(
            redirect_refusal("https://attacker.example/skills.json", 0),
            Some("redirect target is outside the download allowlist")
        );
        assert_eq!(
            redirect_refusal("http://cdn.oleafly.com/catalogs/skills.json", 0),
            Some("redirect target is outside the download allowlist")
        );
        assert_eq!(
            redirect_refusal(
                "https://cdn.oleafly.com/catalogs/skills.json",
                MAX_REDIRECTS
            ),
            Some("too many redirects")
        );
    }

    #[test]
    fn only_https_and_loopback_http_addresses_are_accepted() {
        assert!(validate_url("https://cdn.oleafly.com/catalogs/skills.json").is_ok());
        assert!(validate_url("https://mirrors.oleafly.com/skills/a.tar.gz").is_ok());
        assert!(validate_url("http://127.0.0.1:38999/catalogs/skills.json").is_ok());
        assert!(validate_url("http://cdn.oleafly.com/catalogs/skills.json").is_err());
        assert!(validate_url("https://example.invalid/skills.json").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("https://user@cdn.oleafly.com/x").is_err());
    }

    #[test]
    fn epoch_milliseconds_render_as_utc() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_788_480_000_000), "2026-09-04T00:00:00Z");
    }

    #[test]
    fn a_wrong_checksum_or_size_stops_an_install() {
        let bytes = valid_skill_bytes();
        let mut entry = entry_for(&bytes);
        entry.sha256 = Some("00".repeat(32));
        assert!(verify_archive(&bytes, &entry)
            .unwrap_err()
            .contains("checksum"));

        let mut entry = entry_for(&bytes);
        entry.bytes += 1;
        assert!(verify_archive(&bytes, &entry).unwrap_err().contains("size"));

        let mut entry = entry_for(&bytes);
        entry.sha256 = None;
        assert!(verify_archive(&bytes, &entry).is_err());

        assert!(verify_archive(&bytes, &entry_for(&bytes)).is_ok());
    }

    #[test]
    fn a_well_formed_archive_extracts_under_its_own_folder() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = valid_skill_bytes();

        extract_archive(&bytes, "gene-atlas", directory.path()).unwrap();

        assert!(directory.path().join("SKILL.md").is_file());
        assert!(directory.path().join("references/notes.md").is_file());
        assert!(!directory.path().join("gene-atlas").exists());
    }

    #[test]
    fn unsafe_archives_are_refused() {
        let directory = tempfile::tempdir().unwrap();

        let traversal = tarball(&[("gene-atlas/../escape.md", b"x" as &[u8])]);
        assert!(extract_archive(&traversal, "gene-atlas", directory.path()).is_err());

        let absolute = tarball(&[("/etc/passwd", b"x" as &[u8])]);
        assert!(extract_archive(&absolute, "gene-atlas", directory.path()).is_err());

        let wrong_root = tarball(&[("other-skill/SKILL.md", b"x" as &[u8])]);
        assert!(extract_archive(&wrong_root, "gene-atlas", directory.path()).is_err());

        let missing_skill = tarball(&[("gene-atlas/references/notes.md", b"x" as &[u8])]);
        assert!(extract_archive(&missing_skill, "gene-atlas", directory.path()).is_err());

        assert!(extract_archive(
            &linked_tarball(tar::EntryType::Symlink),
            "gene-atlas",
            directory.path()
        )
        .is_err());
        assert!(extract_archive(
            &linked_tarball(tar::EntryType::Link),
            "gene-atlas",
            directory.path()
        )
        .is_err());
        assert!(extract_archive(
            &linked_tarball(tar::EntryType::Fifo),
            "gene-atlas",
            directory.path()
        )
        .is_err());
    }

    #[test]
    fn a_deeply_nested_member_is_refused() {
        let deep = format!("gene-atlas/{}file.md", "a/".repeat(MAX_PACK_DEPTH + 1));
        let directory = tempfile::tempdir().unwrap();
        let bytes = tarball(&[(deep.as_str(), b"x" as &[u8])]);

        assert!(extract_archive(&bytes, "gene-atlas", directory.path())
            .unwrap_err()
            .contains("nested"));
    }

    #[test]
    fn a_catalog_install_lands_with_shelf_provenance_and_can_be_uninstalled() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let bytes = valid_skill_bytes();
        let entry = entry_for(&bytes);

        let record = install_from_archive(root, &entry, &bytes).unwrap();

        assert_eq!(record.id, "gene-atlas");
        assert_eq!(record.source, SkillSource::Catalog);
        assert_eq!(record.tier, SkillTier::Shelf);
        assert_eq!(record.pack_version.as_deref(), Some("1.0.0"));
        assert!(record.removable);
        assert!(record.enabled);
        let manifest = crate::skills::read_managed_manifest(
            &crate::skills::managed_skills_root(root)
                .unwrap()
                .join("gene-atlas"),
        )
        .unwrap();
        assert_eq!(manifest.pack.as_deref(), Some("shelf"));
        assert_eq!(manifest.tier, Some(SkillTier::Shelf));
        assert_eq!(manifest.phase.as_deref(), Some("research"));
        assert!(!manifest.tree_sha256.is_empty());

        let mut newer = entry.clone();
        newer.version = "1.1.0".into();
        let replaced = install_from_archive(root, &newer, &bytes).unwrap();
        assert_eq!(replaced.pack_version.as_deref(), Some("1.1.0"));

        assert!(crate::skills::remove(root, "gene-atlas").is_ok());
        assert!(!crate::skills::managed_skills_root(root)
            .unwrap()
            .join("gene-atlas")
            .exists());
    }

    #[test]
    fn only_catalog_skills_can_be_uninstalled() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let bytes = valid_skill_bytes();
        let entry = entry_for(&bytes);
        install_from_archive(root, &entry, &bytes).unwrap();
        let skills = crate::skills::managed_skills_root(root).unwrap();
        let mine = skills.join("my-notes");
        std::fs::create_dir_all(&mine).unwrap();
        std::fs::write(
            mine.join("SKILL.md"),
            "---\nname: my-notes\ndescription: Mine.\n---\n\nKeep notes.\n",
        )
        .unwrap();

        assert!(uninstall(root, "my-notes")
            .unwrap_err()
            .contains("not installed from the catalog"));
        assert!(mine.is_dir());
        assert!(uninstall(root, "missing-skill").is_err());
        assert!(uninstall(root, "../escape").is_err());

        uninstall(root, "gene-atlas").unwrap();
        assert!(!skills.join("gene-atlas").exists());
    }

    #[test]
    fn a_failed_install_leaves_no_staging_folder_behind() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let bytes = valid_skill_bytes();
        let mut entry = entry_for(&bytes);
        entry.sha256 = Some("00".repeat(32));

        assert!(install_from_archive(root, &entry, &bytes).is_err());

        let skills = crate::skills::managed_skills_root(root).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&skills)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".skill-import-")
            })
            .collect();
        assert!(leftovers.is_empty());
    }
}
