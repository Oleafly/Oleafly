use futures_util::{StreamExt, TryStreamExt};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager};
use tokio::sync::{OnceCell, Semaphore};

use crate::paths;

pub(crate) const DEFAULT_BASE_URL: &str =
    "https://raw.githubusercontent.com/Oleafly/template-packs/main";
const OFFICIAL_HOST: &str = "raw.githubusercontent.com";
const OFFICIAL_PATH: &str = "/Oleafly/template-packs/";
const MIRROR_HOST: &str = "mirrors.oleafly.com";
const MIRROR_PATH: &str = "/template-files/";
const V1_CACHE: &str = "catalog-cache.json";
const V2_CACHE: &str = "catalog-v2-cache.json";
const INDEXES_DIR: &str = "indexes";
const FRESH_FOR: Duration = Duration::from_secs(30 * 60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(60);
const DOWNLOAD_CONCURRENCY: usize = 8;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 5;
const MANIFEST: &str = "template.json";
const PREVIEW_FILE: &str = "preview.webp";
const V1_PREVIEW: &str = "preview.png";
const COVERS: usize = 4;
const GROUPS: &[&str] = &["curated", "community", "typst", "university"];

pub(crate) fn packs_base_url() -> String {
    match std::env::var("OLEAFLY_PACKS_BASE_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().trim_end_matches('/').to_string(),
        _ => DEFAULT_BASE_URL.to_string(),
    }
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct PackFile {
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct TemplatePack {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub approx_bytes: u64,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub license_summary: String,
    pub files: Vec<PackFile>,
}

#[derive(Deserialize)]
struct CatalogV2 {
    #[serde(default)]
    version: u32,
    packs: Vec<PackEntry>,
}

#[derive(Deserialize)]
struct PackEntry {
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    count: u32,
    #[serde(default)]
    bytes: u64,
    #[serde(default)]
    license_summary: String,
    index_url: String,
    #[serde(default)]
    covers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PackSource {
    Index(String),
    Files(Vec<PackFile>),
}

#[derive(Clone, Debug)]
pub(crate) struct CatalogPack {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) description: String,
    pub(crate) category: String,
    pub(crate) group: String,
    pub(crate) count: u32,
    pub(crate) bytes: u64,
    pub(crate) license_summary: String,
    pub(crate) covers: Vec<String>,
    pub(crate) source: PackSource,
}

#[derive(Serialize)]
pub struct PackInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub group: String,
    pub approx_bytes: u64,
    pub count: u32,
    pub license_summary: String,
    pub covers: Vec<String>,
    pub installed: bool,
    pub installed_count: u32,
    pub version: u32,
}

#[derive(Deserialize)]
struct PackIndex {
    #[serde(default)]
    version: u32,
    id: String,
    templates: Vec<IndexTemplate>,
}

#[derive(Deserialize)]
struct IndexLicense {
    #[serde(default, deserialize_with = "lenient_text")]
    spdx: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    label: Option<String>,
}

#[derive(Deserialize)]
struct IndexCredit {
    #[serde(default, deserialize_with = "lenient_text")]
    url: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    author: Option<String>,
}

#[derive(Deserialize)]
struct IndexTemplate {
    id: String,
    #[serde(default, deserialize_with = "lenient_text")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    description: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    category: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    engine: Option<String>,
    #[serde(default)]
    license: Option<IndexLicense>,
    #[serde(default)]
    bytes: u64,
    files: Vec<PackFile>,
    #[serde(default)]
    credit: Option<IndexCredit>,
    #[serde(default, deserialize_with = "lenient_text")]
    thumb_url: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    preview_url: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient_list")]
    languages: Vec<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    country: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    institution: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PackTemplateLicense {
    pub spdx: Option<String>,
    pub label: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PackTemplateCredit {
    pub url: String,
    pub author: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PackTemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub engine: String,
    pub license: PackTemplateLicense,
    pub credit: Option<PackTemplateCredit>,
    pub thumb_url: Option<String>,
    pub preview_url: Option<String>,
    pub kind: Option<String>,
    pub languages: Vec<String>,
    pub country: Option<String>,
    pub institution: Option<String>,
    pub bytes: u64,
    pub file_count: usize,
    pub installed: bool,
}

#[derive(Serialize)]
pub struct PackIndexInfo {
    pub pack_id: String,
    pub version: u32,
    pub templates: Vec<PackTemplateInfo>,
}

#[derive(Clone, Debug)]
pub(crate) struct PackTemplate {
    pub(crate) info: PackTemplateInfo,
    pub(crate) files: Vec<PackFile>,
}

fn lenient_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::String(text) if !text.trim().is_empty() => Some(text),
        _ => None,
    })
}

fn lenient_list<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    let keep = |value: serde_json::Value| match value {
        serde_json::Value::String(text) if !text.trim().is_empty() => Some(text),
        _ => None,
    };
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Array(items) => items.into_iter().filter_map(keep).collect(),
        other => keep(other).into_iter().collect(),
    })
}

pub(crate) fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn is_safe_rel_file(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains(':')
        && !name
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

fn parsed_url(candidate: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(candidate).ok()?;
    let plain = matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some();
    plain.then_some(url)
}

fn under(url: &reqwest::Url, host: &str, path: &str) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(host)
        && url.port().is_none()
        && url.path().starts_with(path)
}

pub(crate) fn url_allowed(candidate: &str, base: &str) -> bool {
    let Some(url) = parsed_url(candidate) else {
        return false;
    };
    if under(&url, OFFICIAL_HOST, OFFICIAL_PATH) {
        return true;
    }
    let Some(base) = parsed_url(&format!("{}/", base.trim_end_matches('/'))) else {
        return false;
    };
    url.scheme() == base.scheme()
        && url.host_str() == base.host_str()
        && url.port_or_known_default() == base.port_or_known_default()
        && url.path().starts_with(base.path())
}

pub(crate) fn file_url_allowed(candidate: &str, base: &str) -> bool {
    url_allowed(candidate, base)
        || parsed_url(candidate).is_some_and(|url| under(&url, MIRROR_HOST, MIRROR_PATH))
}

fn validate_file(file: &PackFile, base: &str) -> Result<(), String> {
    if !is_safe_rel_file(&file.name) {
        return Err(format!("illegal pack file name: {}", file.name));
    }
    if !file_url_allowed(&file.url, base) {
        return Err(format!("pack file url is not allowed: {}", file.url));
    }
    Ok(())
}

fn validate_catalog(packs: &[TemplatePack], base: &str) -> Result<(), String> {
    for pack in packs {
        if !is_valid_id(&pack.id) {
            return Err(format!("illegal pack id: {}", pack.id));
        }
        for file in &pack.files {
            validate_file(file, base)?;
        }
    }
    Ok(())
}

pub(crate) fn parse_catalog(s: &str, base: &str) -> Result<Vec<TemplatePack>, String> {
    let packs: Vec<TemplatePack> =
        serde_json::from_str(s).map_err(|e| format!("invalid pack catalog: {e}"))?;
    validate_catalog(&packs, base)?;
    Ok(packs)
}

fn normalize_group(group: &str) -> String {
    if GROUPS.contains(&group) {
        group.to_string()
    } else {
        "community".to_string()
    }
}

pub(crate) fn parse_catalog_v2(s: &str, base: &str) -> Result<Vec<CatalogPack>, String> {
    let catalog: CatalogV2 =
        serde_json::from_str(s).map_err(|e| format!("invalid pack catalog: {e}"))?;
    if catalog.version != 2 {
        return Err(format!(
            "unsupported pack catalog version: {}",
            catalog.version
        ));
    }
    let mut seen = HashSet::new();
    let mut packs = Vec::with_capacity(catalog.packs.len());
    for entry in catalog.packs {
        if !is_valid_id(&entry.id) {
            return Err(format!("illegal pack id: {}", entry.id));
        }
        if !seen.insert(entry.id.clone()) {
            return Err(format!("duplicate pack id: {}", entry.id));
        }
        if !url_allowed(&entry.index_url, base) {
            return Err(format!(
                "pack index url is not allowed: {}",
                entry.index_url
            ));
        }
        if let Some(cover) = entry.covers.iter().find(|c| !url_allowed(c, base)) {
            return Err(format!("pack cover url is not allowed: {cover}"));
        }
        packs.push(CatalogPack {
            label: if entry.label.trim().is_empty() {
                entry.id.clone()
            } else {
                entry.label
            },
            id: entry.id,
            description: entry.description,
            category: entry.category,
            group: normalize_group(&entry.group),
            count: entry.count,
            bytes: entry.bytes,
            license_summary: entry.license_summary,
            covers: entry.covers.into_iter().take(COVERS).collect(),
            source: PackSource::Index(entry.index_url),
        });
    }
    Ok(packs)
}

fn template_of(name: &str) -> &str {
    name.split('/').next().unwrap_or_default()
}

fn group_v1_files(files: &[PackFile]) -> BTreeMap<String, Vec<PackFile>> {
    let mut grouped: BTreeMap<String, Vec<PackFile>> = BTreeMap::new();
    for file in files {
        let id = template_of(&file.name);
        if file.name.len() > id.len() && is_valid_id(id) {
            grouped
                .entry(id.to_string())
                .or_default()
                .push(file.clone());
        }
    }
    grouped
}

fn v1_preview(id: &str, files: &[PackFile]) -> Option<String> {
    let name = format!("{id}/{V1_PREVIEW}");
    files.iter().find(|f| f.name == name).map(|f| f.url.clone())
}

pub(crate) fn from_v1(pack: TemplatePack) -> CatalogPack {
    let grouped = group_v1_files(&pack.files);
    let covers = grouped
        .iter()
        .filter_map(|(id, files)| v1_preview(id, files))
        .take(COVERS)
        .collect();
    let count = if pack.count > 0 {
        pack.count
    } else {
        u32::try_from(grouped.len()).unwrap_or(u32::MAX)
    };
    CatalogPack {
        group: normalize_group(if pack.id.starts_with("open-") {
            "community"
        } else {
            "curated"
        }),
        label: pack.label,
        description: pack.description,
        category: pack.category,
        count,
        bytes: pack.approx_bytes,
        license_summary: pack.license_summary,
        covers,
        id: pack.id,
        source: PackSource::Files(pack.files),
    }
}

fn humanize(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

#[derive(Deserialize, Default)]
struct LocalManifest {
    #[serde(default, deserialize_with = "lenient_text")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    description: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    category: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    engine: Option<String>,
}

fn local_manifest(dir: Option<&Path>, id: &str) -> LocalManifest {
    dir.and_then(|dir| std::fs::read_to_string(dir.join(id).join(MANIFEST)).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(crate) fn v1_templates(pack: &CatalogPack, dir: Option<&Path>) -> Vec<PackTemplate> {
    let PackSource::Files(files) = &pack.source else {
        return Vec::new();
    };
    group_v1_files(files)
        .into_iter()
        .map(|(id, files)| {
            let local = local_manifest(dir, &id);
            let preview = v1_preview(&id, &files);
            PackTemplate {
                info: PackTemplateInfo {
                    name: local.name.unwrap_or_else(|| humanize(&id)),
                    description: local.description.unwrap_or_default(),
                    category: local.category.unwrap_or_else(|| pack.category.clone()),
                    engine: local.engine.unwrap_or_default(),
                    license: PackTemplateLicense {
                        spdx: None,
                        label: pack.license_summary.clone(),
                    },
                    credit: None,
                    thumb_url: preview.clone(),
                    preview_url: preview,
                    kind: None,
                    languages: Vec::new(),
                    country: None,
                    institution: None,
                    bytes: 0,
                    file_count: files.len(),
                    installed: false,
                    id,
                },
                files,
            }
        })
        .collect()
}

fn credit_of(credit: Option<IndexCredit>) -> Option<PackTemplateCredit> {
    let credit = credit?;
    let url = credit.url?;
    let ok = parsed_url(&url).is_some();
    ok.then_some(PackTemplateCredit {
        url,
        author: credit.author,
    })
}

fn optional_url(url: Option<String>, base: &str, what: &str) -> Result<Option<String>, String> {
    match url {
        Some(url) if !url_allowed(&url, base) => Err(format!("{what} url is not allowed: {url}")),
        other => Ok(other),
    }
}

fn index_template(template: IndexTemplate, base: &str) -> Result<Option<PackTemplate>, String> {
    if !is_valid_id(&template.id) {
        return Err(format!("illegal template id: {}", template.id));
    }
    for file in &template.files {
        validate_file(file, base)?;
    }
    let thumb_url = optional_url(template.thumb_url, base, "thumbnail")?;
    let preview_url = optional_url(template.preview_url, base, "preview")?;
    let prefix = format!("{}/", template.id);
    if template.files.is_empty() || template.files.iter().any(|f| !f.name.starts_with(&prefix)) {
        return Ok(None);
    }
    let mut names = HashSet::new();
    let files: Vec<PackFile> = template
        .files
        .into_iter()
        .filter(|f| names.insert(f.name.clone()))
        .collect();
    let license = template.license.unwrap_or(IndexLicense {
        spdx: None,
        label: None,
    });
    Ok(Some(PackTemplate {
        info: PackTemplateInfo {
            name: template.name.unwrap_or_else(|| humanize(&template.id)),
            description: template.description.unwrap_or_default(),
            category: template.category.unwrap_or_default(),
            engine: template.engine.unwrap_or_default(),
            license: PackTemplateLicense {
                label: license
                    .label
                    .or_else(|| license.spdx.clone())
                    .unwrap_or_default(),
                spdx: license.spdx,
            },
            credit: credit_of(template.credit),
            thumb_url,
            preview_url,
            kind: template.kind,
            languages: template.languages,
            country: template.country,
            institution: template.institution,
            bytes: template.bytes,
            file_count: files.len(),
            installed: false,
            id: template.id,
        },
        files,
    }))
}

pub(crate) fn parse_index(s: &str, pack_id: &str, base: &str) -> Result<Vec<PackTemplate>, String> {
    let index: PackIndex =
        serde_json::from_str(s).map_err(|e| format!("invalid pack index: {e}"))?;
    if index.version != 2 {
        return Err(format!("unsupported pack index version: {}", index.version));
    }
    if index.id != pack_id {
        return Err(format!(
            "pack index {} does not belong to {pack_id}",
            index.id
        ));
    }
    let mut seen = HashSet::new();
    let mut templates = Vec::with_capacity(index.templates.len());
    for template in index.templates {
        let Some(template) = index_template(template, base)? else {
            continue;
        };
        if seen.insert(template.info.id.clone()) {
            templates.push(template);
        }
    }
    Ok(templates)
}

pub(crate) fn fresh(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified)
        .map(|age| age < FRESH_FOR)
        .unwrap_or(false)
}

fn file_fresh(path: &Path, now: SystemTime) -> bool {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map(|modified| fresh(modified, now))
        .unwrap_or(false)
}

fn write_atomic(path: &Path, body: &str) -> Result<(), String> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(
        ".{}-{}.part",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = PathBuf::from(tmp);
    if let Err(error) = std::fs::write(&tmp, body).and_then(|()| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

fn bundled_catalog_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve(
        "resources/template-packs.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("template-packs.json");
    dev.is_file().then_some(dev)
}

pub(crate) fn catalog_from(
    root: Option<&Path>,
    bundled: Option<&Path>,
    base: &str,
) -> Result<Vec<CatalogPack>, String> {
    if let Some(root) = root {
        if let Ok(text) = std::fs::read_to_string(root.join(V2_CACHE)) {
            if let Ok(packs) = parse_catalog_v2(&text, base) {
                return Ok(packs);
            }
        }
        if let Ok(text) = std::fs::read_to_string(root.join(V1_CACHE)) {
            if let Ok(packs) = parse_catalog(&text, base) {
                return Ok(packs.into_iter().map(from_v1).collect());
            }
        }
    }
    let Some(bundled) = bundled else {
        return Ok(Vec::new());
    };
    let text = std::fs::read_to_string(bundled).map_err(|e| e.to_string())?;
    Ok(parse_catalog(&text, base)?
        .into_iter()
        .map(from_v1)
        .collect())
}

pub(crate) fn catalog(app: &AppHandle) -> Result<Vec<CatalogPack>, String> {
    let root = paths::templates_data_root().ok();
    catalog_from(
        root.as_deref(),
        bundled_catalog_path(app).as_deref(),
        &packs_base_url(),
    )
}

pub(crate) fn pack_install_dir(id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal pack id: {id}"));
    }
    Ok(paths::templates_data_root()?.join("packs").join(id))
}

fn indexes_dir() -> Result<PathBuf, String> {
    Ok(paths::templates_data_root()?.join(INDEXES_DIR))
}

pub(crate) fn template_installed(dir: &Path, files: &[PackFile]) -> bool {
    !files.is_empty() && files.iter().all(|f| dir.join(&f.name).is_file())
}

pub(crate) fn installed_template_count(dir: &Path) -> u32 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let count = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !name.starts_with('.')
                && entry.file_type().is_ok_and(|kind| kind.is_dir())
                && entry.path().join(MANIFEST).is_file()
        })
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

pub(crate) fn pack_info(pack: &CatalogPack, dir: &Path) -> PackInfo {
    let (installed, installed_count, version) = match &pack.source {
        PackSource::Files(files) => {
            let grouped = group_v1_files(files);
            let complete = grouped
                .values()
                .filter(|files| template_installed(dir, files))
                .count();
            (
                template_installed(dir, files),
                u32::try_from(complete).unwrap_or(u32::MAX),
                1,
            )
        }
        PackSource::Index(_) => {
            let complete = installed_template_count(dir);
            (pack.count > 0 && complete >= pack.count, complete, 2)
        }
    };
    PackInfo {
        id: pack.id.clone(),
        label: pack.label.clone(),
        description: pack.description.clone(),
        category: pack.category.clone(),
        group: pack.group.clone(),
        approx_bytes: pack.bytes,
        count: pack.count,
        license_summary: pack.license_summary.clone(),
        covers: pack.covers.clone(),
        installed,
        installed_count,
        version,
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("template pack task failed: {error}"))?
}

#[tauri::command]
pub async fn list_template_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    blocking(move || {
        let packs = catalog(&app)?;
        let root = paths::templates_data_root()?.join("packs");
        Ok(packs
            .iter()
            .map(|pack| pack_info(pack, &root.join(&pack.id)))
            .collect())
    })
    .await
}

fn build_client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        if file_url_allowed(attempt.url().as_str(), &packs_base_url()) {
            attempt.follow()
        } else {
            attempt.error("redirect to a host outside the template packs")
        }
    });
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .user_agent("Oleafly-template-packs")
        .redirect(policy)
        .build()
        .map_err(|error| format!("could not start the download: {error}"))
}

fn shared_client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = build_client()?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("fetch failed: {e}"))
}

fn catalog_fresh(root: &Path, now: SystemTime) -> bool {
    file_fresh(&root.join(V2_CACHE), now) || file_fresh(&root.join(V1_CACHE), now)
}

static LAST_FAILURE: Mutex<Option<Instant>> = Mutex::new(None);

pub(crate) fn retry_due(last_failure: Option<Instant>, now: Instant) -> bool {
    last_failure.is_none_or(|at| now.duration_since(at) >= RETRY_AFTER_FAILURE)
}

fn failed_recently() -> bool {
    let last = *LAST_FAILURE.lock().unwrap_or_else(|p| p.into_inner());
    !retry_due(last, Instant::now())
}

fn note_refresh(failed: bool) {
    *LAST_FAILURE.lock().unwrap_or_else(|p| p.into_inner()) = failed.then(Instant::now);
}

pub(crate) async fn refresh_catalog_at(
    client: &reqwest::Client,
    root: &Path,
    base: &str,
) -> Result<(), String> {
    let v2 = match fetch_text(client, &format!("{base}/catalog-v2.json")).await {
        Ok(body) => parse_catalog_v2(&body, base).map(|_| body),
        Err(error) => Err(error),
    };
    let (name, body) = match v2 {
        Ok(body) => (V2_CACHE, body),
        Err(v2_error) => {
            let body = fetch_text(client, &format!("{base}/catalog.json"))
                .await
                .map_err(|error| format!("catalog fetch failed: {v2_error}; {error}"))?;
            parse_catalog(&body, base)?;
            (V1_CACHE, body)
        }
    };
    let path = root.join(name);
    blocking(move || write_atomic(&path, &body)).await
}

#[tauri::command]
pub async fn refresh_pack_catalog(force: Option<bool>) -> Result<bool, String> {
    let force = force.unwrap_or(false);
    let root = paths::templates_data_root()?;
    if !force && (catalog_fresh(&root, SystemTime::now()) || failed_recently()) {
        return Ok(false);
    }
    let result = refresh_catalog_at(&shared_client()?, &root, &packs_base_url()).await;
    note_refresh(result.is_err());
    result.map(|()| true)
}

async fn find_pack(app: &AppHandle, id: &str) -> Result<CatalogPack, String> {
    if !is_valid_id(id) {
        return Err(format!("illegal pack id: {id}"));
    }
    let app = app.clone();
    let id = id.to_string();
    blocking(move || {
        catalog(&app)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("unknown template pack: {id}"))
    })
    .await
}

pub(crate) async fn load_pack_templates(
    client: &reqwest::Client,
    pack: &CatalogPack,
    cache: &Path,
    install_dir: &Path,
    base: &str,
    force: bool,
) -> Result<Vec<PackTemplate>, String> {
    let url = match &pack.source {
        PackSource::Index(url) => url.clone(),
        PackSource::Files(_) => {
            let pack = pack.clone();
            let dir = install_dir.to_path_buf();
            return blocking(move || Ok(v1_templates(&pack, Some(&dir)))).await;
        }
    };
    let read_cache = |cache: PathBuf, id: String, base: String| {
        blocking(move || {
            let text = std::fs::read_to_string(&cache).map_err(|e| e.to_string())?;
            parse_index(&text, &id, &base)
        })
    };
    if !force && file_fresh(cache, SystemTime::now()) {
        if let Ok(templates) =
            read_cache(cache.to_path_buf(), pack.id.clone(), base.to_string()).await
        {
            return Ok(templates);
        }
    }
    let fetched = match fetch_text(client, &url).await {
        Ok(body) => {
            let (cache, id, base) = (cache.to_path_buf(), pack.id.clone(), base.to_string());
            blocking(move || {
                let templates = parse_index(&body, &id, &base)?;
                let _ = write_atomic(&cache, &body);
                Ok(templates)
            })
            .await
        }
        Err(error) => Err(error),
    };
    match fetched {
        Ok(templates) => Ok(templates),
        Err(error) if cache.is_file() => {
            read_cache(cache.to_path_buf(), pack.id.clone(), base.to_string())
                .await
                .map_err(|_| error)
        }
        Err(error) => Err(error),
    }
}

async fn pack_templates(pack: &CatalogPack, force: bool) -> Result<Vec<PackTemplate>, String> {
    let cache = indexes_dir()?.join(format!("{}.json", pack.id));
    let dir = pack_install_dir(&pack.id)?;
    load_pack_templates(
        &shared_client()?,
        pack,
        &cache,
        &dir,
        &packs_base_url(),
        force,
    )
    .await
}

pub(crate) fn mark_installed(dir: &Path, templates: Vec<PackTemplate>) -> Vec<PackTemplateInfo> {
    templates
        .into_iter()
        .map(|template| PackTemplateInfo {
            installed: template_installed(dir, &template.files),
            ..template.info
        })
        .collect()
}

#[tauri::command]
pub async fn pack_index(
    app: AppHandle,
    pack_id: String,
    force: Option<bool>,
) -> Result<PackIndexInfo, String> {
    let pack = find_pack(&app, &pack_id).await?;
    let templates = pack_templates(&pack, force.unwrap_or(false)).await?;
    let dir = pack_install_dir(&pack.id)?;
    let version = match pack.source {
        PackSource::Index(_) => 2,
        PackSource::Files(_) => 1,
    };
    blocking(move || {
        Ok(PackIndexInfo {
            pack_id: pack.id,
            version,
            templates: mark_installed(&dir, templates),
        })
    })
    .await
}

pub(crate) struct DownloadProgress {
    pub(crate) file: String,
    pub(crate) done: usize,
    pub(crate) total: usize,
    pub(crate) received: u64,
    pub(crate) file_total: Option<u64>,
}

pub(crate) struct TemplateJob {
    pub(crate) id: String,
    pub(crate) missing: Vec<PackFile>,
    pub(crate) preview: Option<String>,
}

pub(crate) struct DownloadPlan {
    pub(crate) jobs: Vec<TemplateJob>,
    pub(crate) present: usize,
    pub(crate) total: usize,
}

pub(crate) fn plan_downloads(
    dir: &Path,
    templates: Vec<PackTemplate>,
    with_previews: bool,
) -> DownloadPlan {
    let mut present = 0;
    let mut total = 0;
    let mut jobs = Vec::new();
    for template in templates {
        let count = template.files.len();
        total += count;
        let missing: Vec<PackFile> = template
            .files
            .into_iter()
            .filter(|f| !dir.join(&f.name).is_file())
            .collect();
        present += count - missing.len();
        let preview = if with_previews && !dir.join(&template.info.id).join(PREVIEW_FILE).is_file()
        {
            template.info.preview_url.or(template.info.thumb_url)
        } else {
            None
        };
        if !missing.is_empty() || preview.is_some() {
            jobs.push(TemplateJob {
                id: template.info.id,
                missing,
                preview,
            });
        }
    }
    DownloadPlan {
        jobs,
        present,
        total,
    }
}

struct Tracker<'a, F> {
    done: AtomicUsize,
    total: usize,
    last: Mutex<Option<Instant>>,
    emit: &'a F,
}

impl<F: Fn(DownloadProgress) + Sync> Tracker<'_, F> {
    fn complete(&self, file: &str, received: u64, file_total: Option<u64>) {
        let done = self.done.fetch_add(1, Ordering::SeqCst) + 1;
        let now = Instant::now();
        let mut last = self.last.lock().unwrap_or_else(|p| p.into_inner());
        let due =
            done >= self.total || last.is_none_or(|at| now.duration_since(at) >= PROGRESS_INTERVAL);
        if !due {
            return;
        }
        *last = Some(now);
        (self.emit)(DownloadProgress {
            file: file.to_string(),
            done,
            total: self.total,
            received,
            file_total,
        });
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

async fn download_file(
    client: &reqwest::Client,
    permits: &Semaphore,
    url: &str,
    sha256: Option<&str>,
    dest: &Path,
) -> Result<(u64, Option<u64>), String> {
    use tokio::io::AsyncWriteExt as _;
    let _permit = permits
        .acquire()
        .await
        .map_err(|_| "download cancelled".to_string())?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let tmp = part_path(dest);
    let result = async {
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("download failed: {e}"))?;
        let file_total = response.content_length();
        let mut out = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut received: u64 = 0;
        let mut digest = Sha256::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
            received += chunk.len() as u64;
            digest.update(&chunk);
            out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        out.flush().await.map_err(|e| e.to_string())?;
        drop(out);
        if !crate::assets::checksum_matches(sha256, &digest.finalize()) {
            return Err(format!("download of {url} did not match its checksum"));
        }
        tokio::fs::rename(&tmp, dest)
            .await
            .map_err(|e| e.to_string())?;
        Ok((received, file_total))
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}

type SharedDownload = Arc<OnceCell<Result<(PathBuf, u64), String>>>;

#[derive(Default)]
struct SharedFiles(Mutex<HashMap<String, SharedDownload>>);

impl SharedFiles {
    fn slot(&self, sha256: &str) -> SharedDownload {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entry(sha256.to_ascii_lowercase())
            .or_default()
            .clone()
    }
}

async fn link_or_copy(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    if tokio::fs::hard_link(source, dest).await.is_ok() {
        return Ok(());
    }
    let tmp = part_path(dest);
    let copied = async {
        tokio::fs::copy(source, &tmp)
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::rename(&tmp, dest)
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    if copied.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    copied
}

async fn fetch_file(
    client: &reqwest::Client,
    permits: &Semaphore,
    shared: &SharedFiles,
    file: &PackFile,
    dest: &Path,
) -> Result<(u64, Option<u64>), String> {
    let Some(sha256) = file.sha256.as_deref() else {
        return download_file(client, permits, &file.url, None, dest).await;
    };
    let slot = shared.slot(sha256);
    let (source, bytes) = slot
        .get_or_init(|| async {
            download_file(client, permits, &file.url, Some(sha256), dest)
                .await
                .map(|(received, _)| (dest.to_path_buf(), received))
        })
        .await
        .clone()?;
    if source != dest {
        link_or_copy(&source, dest).await?;
    }
    Ok((bytes, Some(bytes)))
}

async fn download_job<F: Fn(DownloadProgress) + Sync>(
    client: &reqwest::Client,
    permits: &Semaphore,
    shared: &SharedFiles,
    dir: &Path,
    job: TemplateJob,
    tracker: &Tracker<'_, F>,
) -> Result<(), String> {
    let manifest = format!("{}/{MANIFEST}", job.id);
    let (manifests, rest): (Vec<PackFile>, Vec<PackFile>) =
        job.missing.into_iter().partition(|f| f.name == manifest);
    let fetch = |file: PackFile| async move {
        let (received, total) =
            fetch_file(client, permits, shared, &file, &dir.join(&file.name)).await?;
        tracker.complete(&file.name, received, total);
        Ok::<(), String>(())
    };
    futures_util::stream::iter(rest.into_iter().map(Ok))
        .try_for_each_concurrent(DOWNLOAD_CONCURRENCY, fetch)
        .await?;
    if let Some(url) = job.preview {
        let dest = dir.join(&job.id).join(PREVIEW_FILE);
        let _ = download_file(client, permits, &url, None, &dest).await;
    }
    for file in manifests {
        fetch(file).await?;
    }
    Ok(())
}

pub(crate) async fn download_templates<F: Fn(DownloadProgress) + Sync>(
    client: &reqwest::Client,
    dir: &Path,
    plan: DownloadPlan,
    emit: &F,
) -> Result<(), String> {
    let permits = Semaphore::new(DOWNLOAD_CONCURRENCY);
    let shared = SharedFiles::default();
    let tracker = Tracker {
        done: AtomicUsize::new(plan.present),
        total: plan.total,
        last: Mutex::new(None),
        emit,
    };
    let (permits, shared, tracker) = (&permits, &shared, &tracker);
    futures_util::stream::iter(plan.jobs.into_iter().map(Ok))
        .try_for_each_concurrent(DOWNLOAD_CONCURRENCY, |job| {
            download_job(client, permits, shared, dir, job, tracker)
        })
        .await
}

async fn install_templates(
    app: &AppHandle,
    pack: &CatalogPack,
    templates: Vec<PackTemplate>,
) -> Result<(), String> {
    use tauri::Emitter;
    let dir = pack_install_dir(&pack.id)?;
    let with_previews = matches!(pack.source, PackSource::Index(_));
    let plan_dir = dir.clone();
    let plan = blocking(move || Ok(plan_downloads(&plan_dir, templates, with_previews))).await?;
    let emit = |progress: DownloadProgress| {
        let _ = app.emit(
            "asset-progress",
            crate::assets::AssetProgress {
                component: pack.id.clone(),
                label: pack.label.clone(),
                file: progress.file,
                index: progress.done,
                total: progress.total,
                received: progress.received,
                file_total: progress.file_total,
            },
        );
    };
    download_templates(&shared_client()?, &dir, plan, &emit).await
}

#[tauri::command]
pub async fn install_template_pack(app: AppHandle, id: String) -> Result<(), String> {
    let pack = find_pack(&app, &id).await?;
    let templates = pack_templates(&pack, false).await?;
    install_templates(&app, &pack, templates).await
}

#[tauri::command]
pub async fn install_pack_template(
    app: AppHandle,
    pack_id: String,
    template_id: String,
) -> Result<(), String> {
    if !is_valid_id(&template_id) {
        return Err(format!("illegal template id: {template_id}"));
    }
    let pack = find_pack(&app, &pack_id).await?;
    let templates: Vec<PackTemplate> = pack_templates(&pack, false)
        .await?
        .into_iter()
        .filter(|template| template.info.id == template_id)
        .collect();
    if templates.is_empty() {
        return Err(format!("unknown template: {template_id}"));
    }
    install_templates(&app, &pack, templates).await
}

#[tauri::command]
pub fn remove_template_pack(id: String) -> Result<(), String> {
    let dir = pack_install_dir(&id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
