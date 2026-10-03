use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const BUNDLED_PACKAGES: &str = include_str!("../../public/latex-intelligence/package-names.json");
const BUNDLED_CLASSES: &str = include_str!("../../public/latex-intelligence/class-names.json");
const INDEX_URL: &str = "https://ctan.org/json/2.0/packages";
const CACHE_FILE: &str = "ctan-packages.json";
const INDEX_MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FETCH_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_INDEX_BYTES: usize = 16 * 1024 * 1024;
const MAX_NAME_LEN: usize = 128;
const MAX_CAPTION_CHARS: usize = 400;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CtanPackage {
    key: String,
    caption: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedIndex {
    fetched_at: u64,
    packages: Vec<CtanPackage>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LatexIndexSource {
    Ctan,
    Bundled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexPackageEntry {
    pub name: String,
    pub caption: String,
    pub ctan: bool,
    pub bundled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_class: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexPackageIndex {
    pub source: LatexIndexSource,
    pub fetched_at: Option<u64>,
    pub stale: bool,
    pub packages: Vec<LatexPackageEntry>,
}

#[derive(Deserialize)]
struct RawCtanPackage {
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    caption: Option<String>,
}

#[derive(Default, Deserialize)]
struct NameList {
    #[serde(default)]
    names: Vec<String>,
    #[serde(default)]
    details: BTreeMap<String, String>,
}

struct Bundled {
    packages: NameList,
    classes: BTreeMap<String, String>,
}

fn bundled() -> &'static Bundled {
    static BUNDLED: OnceLock<Bundled> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        let packages: NameList = serde_json::from_str(BUNDLED_PACKAGES).unwrap_or_default();
        let classes: NameList = serde_json::from_str(BUNDLED_CLASSES).unwrap_or_default();
        Bundled {
            packages,
            classes: classes
                .names
                .into_iter()
                .map(|name| (name.to_ascii_lowercase(), name))
                .collect(),
        }
    })
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name.as_bytes()[0].is_ascii_alphanumeric()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && !name.contains("..")
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ => {
            let number = entity.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code)
        }
    }
}

fn strip_tags(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        plain.push_str(&rest[..start]);
        let Some(length) = rest[start..].find('>') else {
            plain.push_str(&rest[start..]);
            return plain;
        };
        let tag = rest[start + 1..start + length].trim().to_ascii_lowercase();
        if tag == "q" || tag == "/q" {
            plain.push('"');
        }
        rest = &rest[start + length + 1..];
    }
    plain.push_str(rest);
    plain
}

fn decode_entities(text: &str) -> String {
    let mut decoded = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let entity = tail
            .find(';')
            .filter(|end| *end <= 10)
            .and_then(|end| decode_entity(&tail[..end]).map(|character| (character, end)));
        match entity {
            Some((character, end)) => {
                decoded.push(character);
                rest = &tail[end + 1..];
            }
            None => {
                decoded.push('&');
                rest = tail;
            }
        }
    }
    decoded.push_str(rest);
    decoded
}

fn plain_caption(caption: &str) -> String {
    let text = decode_entities(&strip_tags(caption));
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_CAPTION_CHARS {
        return collapsed;
    }
    collapsed
        .chars()
        .take(MAX_CAPTION_CHARS)
        .collect::<String>()
        .trim_end()
        .to_owned()
}

fn parse_ctan_packages(bytes: &[u8]) -> Result<Vec<CtanPackage>, String> {
    let entries: Vec<serde_json::Value> = serde_json::from_slice(bytes)
        .map_err(|error| format!("CTAN's package list is not a list: {error}"))?;
    let mut seen = BTreeSet::new();
    let packages: Vec<CtanPackage> = entries
        .into_iter()
        .filter_map(|value| serde_json::from_value::<RawCtanPackage>(value).ok())
        .filter_map(|raw| {
            let key = raw.key?.trim().to_owned();
            (valid_name(&key) && seen.insert(key.to_ascii_lowercase())).then(|| CtanPackage {
                caption: plain_caption(raw.caption.as_deref().unwrap_or_default()),
                key,
            })
        })
        .collect();
    if packages.is_empty() {
        return Err("CTAN's package list has no packages".into());
    }
    Ok(packages)
}

fn merge_packages(ctan: Option<&[CtanPackage]>) -> Vec<LatexPackageEntry> {
    let bundled = bundled();
    let mut entries: BTreeMap<String, LatexPackageEntry> = BTreeMap::new();
    for name in &bundled.packages.names {
        if !valid_name(name) {
            continue;
        }
        entries.insert(
            name.to_ascii_lowercase(),
            LatexPackageEntry {
                name: name.clone(),
                caption: bundled
                    .packages
                    .details
                    .get(name)
                    .map(|detail| plain_caption(detail))
                    .unwrap_or_default(),
                ctan: false,
                bundled: true,
                document_class: None,
            },
        );
    }
    for package in ctan.unwrap_or_default() {
        let lower = package.key.to_ascii_lowercase();
        let entry = entries
            .entry(lower.clone())
            .or_insert_with(|| LatexPackageEntry {
                name: package.key.clone(),
                caption: String::new(),
                ctan: false,
                bundled: false,
                document_class: None,
            });
        entry.ctan = true;
        if !package.caption.is_empty() {
            entry.caption = package.caption.clone();
        }
        if !entry.bundled {
            entry.document_class = bundled.classes.get(&lower).cloned();
        }
    }
    entries.into_values().collect()
}

fn bundled_index() -> LatexPackageIndex {
    LatexPackageIndex {
        source: LatexIndexSource::Bundled,
        fetched_at: None,
        stale: false,
        packages: merge_packages(None),
    }
}

fn from_cache(cached: &CachedIndex, now: u64) -> LatexPackageIndex {
    LatexPackageIndex {
        source: LatexIndexSource::Ctan,
        fetched_at: Some(cached.fetched_at),
        stale: now.saturating_sub(cached.fetched_at) >= INDEX_MAX_AGE_MS,
        packages: merge_packages(Some(&cached.packages)),
    }
}

fn read_cached_index(cache: &Path) -> Option<CachedIndex> {
    let cached: CachedIndex = serde_json::from_slice(&std::fs::read(cache).ok()?).ok()?;
    (!cached.packages.is_empty()).then_some(cached)
}

fn write_cached_index(cache: &Path, index: &CachedIndex) {
    let Ok(bytes) = serde_json::to_vec(index) else {
        return;
    };
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = crate::sandbox::atomic_write(cache, &bytes);
}

async fn load_index<F, Fut>(
    cache: &Path,
    now: u64,
    offline: bool,
    refresh: bool,
    fetch: F,
) -> LatexPackageIndex
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    let cached = read_cached_index(cache);
    if offline {
        return cached.map_or_else(bundled_index, |cached| from_cache(&cached, now));
    }
    if let Some(cached) = cached
        .as_ref()
        .filter(|cached| !refresh && now.saturating_sub(cached.fetched_at) < INDEX_MAX_AGE_MS)
    {
        return from_cache(cached, now);
    }
    match fetch().await.and_then(|bytes| parse_ctan_packages(&bytes)) {
        Ok(packages) => {
            let fresh = CachedIndex {
                fetched_at: now,
                packages,
            };
            write_cached_index(cache, &fresh);
            from_cache(&fresh, now)
        }
        Err(_) => cached.map_or_else(bundled_index, |cached| from_cache(&cached, now)),
    }
}

async fn fetch_ctan_bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Oleafly")
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "CTAN's package list returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("CTAN's package list is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("network error: {error}"))?;
    if bytes.len() > limit {
        return Err("CTAN's package list is too large".into());
    }
    Ok(bytes.to_vec())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn cache_path() -> Result<PathBuf, String> {
    Ok(crate::paths::catalogs_root()?.join(CACHE_FILE))
}

#[tauri::command]
pub async fn latex_package_index(
    offline: Option<bool>,
    refresh: Option<bool>,
) -> Result<LatexPackageIndex, String> {
    let offline = offline.unwrap_or(false);
    let Ok(cache) = cache_path() else {
        return Ok(bundled_index());
    };
    Ok(
        load_index(&cache, now_ms(), offline, refresh.unwrap_or(false), || {
            fetch_ctan_bytes(INDEX_URL, MAX_INDEX_BYTES)
        })
        .await,
    )
}

#[cfg(test)]
mod tests;
