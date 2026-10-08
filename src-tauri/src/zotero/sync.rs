use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::http::{Endpoints, Http, Side, SyncError, WaitPolicy};
use super::item::{group_id, group_library, parse_item, resolve_keys, Item, Parsed, USER_LIBRARY};
use super::search::{SearchHit, SearchResult, Snapshot};

const CACHE_SCHEMA: u32 = 1;
const LOCAL_PAGE: usize = 500;
const WEB_PAGE: usize = 100;
const PROBE_PAGE: usize = 25;
const PROBE_PAGES: usize = 20;
const KEY_BATCH: usize = 50;
const BBT_BATCH: usize = 1_000;
const MIN_INTERVAL: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credentials {
    pub user_id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default)]
pub struct SyncOptions {
    pub offline: bool,
    pub force: bool,
    pub credentials: Option<Credentials>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LocalState {
    #[default]
    Unknown,
    NotRunning,
    ApiDisabled,
    Unsupported,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WebState {
    #[default]
    NotConnected,
    Ready,
    KeyRejected,
    Unreachable,
    RateLimited,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalProbe {
    pub state: LocalState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zotero_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbt_version: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub installed: bool,
    #[serde(skip)]
    pub server_id: Option<String>,
}

fn zotero_installed() -> bool {
    crate::paths::home_dir()
        .map(|home| home.join("Zotero").join("zotero.sqlite").is_file())
        .unwrap_or(false)
}

fn not_running() -> LocalProbe {
    LocalProbe {
        state: LocalState::NotRunning,
        installed: zotero_installed(),
        ..LocalProbe::default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub item_count: usize,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub local: LocalProbe,
    pub web: WebState,
    pub libraries: Vec<LibraryInfo>,
    pub item_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<u64>,
    pub syncing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub generation: u64,
    pub bbt_seen: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<u64>,
    pub loaded: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCache {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_version: Option<u64>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bbt_id: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheFile {
    pub schema: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_user_id: Option<String>,
    #[serde(default)]
    pub libraries: Vec<LibraryCache>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_source: Option<String>,
    #[serde(default)]
    pub bbt_seen: bool,
}

#[derive(Debug, Default)]
struct Meta {
    local: LocalProbe,
    web: WebState,
    syncing: bool,
    progress: Option<Progress>,
    error: Option<String>,
    generation: u64,
    retry_at: Option<SystemTime>,
    last_attempt: Option<Instant>,
    disabled: HashSet<String>,
    libraries: Vec<(String, String)>,
    counts: HashMap<String, usize>,
    last_sync: Option<u64>,
    source: Option<&'static str>,
    bbt_seen: bool,
    loaded: bool,
    bbt_ids: HashMap<String, u64>,
    desktop_items: bool,
    desktop_owner: Option<String>,
}

impl CacheFile {
    fn holds_desktop_items(&self) -> bool {
        let from_desktop = self.local_user_id.is_some()
            || self
                .libraries
                .iter()
                .any(|library| library.local_version.is_some());
        from_desktop
            && self
                .libraries
                .iter()
                .any(|library| !library.items.is_empty())
    }
}

#[derive(Default)]
struct Work {
    cache: CacheFile,
    loaded: bool,
}

pub struct ZoteroLibrary {
    endpoints: Endpoints,
    cache_path: Option<PathBuf>,
    policy: WaitPolicy,
    snapshot: RwLock<Arc<Snapshot>>,
    meta: Mutex<Meta>,
    work: tokio::sync::Mutex<Work>,
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn library_path(side: Side, library: &str, user_id: Option<&str>) -> String {
    match (side, group_id(library)) {
        (Side::Local, Some(group)) => format!("/api/groups/{group}"),
        (Side::Local, None) => "/api/users/0".to_string(),
        (Side::Web, Some(group)) => format!("/groups/{group}"),
        (Side::Web, None) => format!("/users/{}", user_id.unwrap_or("0")),
    }
}

fn items_query(path: &str, extra: &str) -> String {
    format!("{path}/items/top?format=json&include=data&itemType=-attachment{extra}")
}

fn array(reply: &super::http::Reply) -> Result<Vec<Value>, SyncError> {
    match reply.json()? {
        Value::Array(values) => Ok(values),
        _ => Err(SyncError::Invalid),
    }
}

fn user_library_owner(value: &Value) -> Option<String> {
    let library = value.get("library")?;
    if library.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    match library.get("id")? {
        Value::Number(id) => Some(id.to_string()),
        Value::String(id) if !id.trim().is_empty() => Some(id.trim().to_string()),
        _ => None,
    }
}

struct LibraryWork<'a> {
    cache: &'a mut LibraryCache,
    items: HashMap<String, Item>,
    skipped: HashSet<String>,
    changed: bool,
    owner: Option<String>,
}

impl<'a> LibraryWork<'a> {
    fn new(cache: &'a mut LibraryCache) -> Self {
        let items = std::mem::take(&mut cache.items)
            .into_iter()
            .map(|item| (item.key.clone(), item))
            .collect();
        let skipped = std::mem::take(&mut cache.skipped).into_iter().collect();
        Self {
            cache,
            items,
            skipped,
            changed: false,
            owner: None,
        }
    }

    fn apply(&mut self, values: &[Value]) {
        let library = self.cache.id.clone();
        for value in values {
            if self.owner.is_none() {
                self.owner = user_library_owner(value);
            }
            match parse_item(&library, value) {
                Some(Parsed::Item(item)) => {
                    let mut item = *item;
                    if let Some(previous) = self.items.get(&item.key) {
                        if previous.version == item.version
                            && previous.date_modified == item.date_modified
                            && previous.title == item.title
                        {
                            continue;
                        }
                        item.bbt_key = previous.bbt_key.clone();
                        item.aliases = previous.aliases.clone();
                        item.citation_key = previous.citation_key.clone();
                        item.key_source = previous.key_source;
                    }
                    self.skipped.remove(&item.key);
                    self.items.insert(item.key.clone(), item);
                    self.changed = true;
                }
                Some(Parsed::Skipped(key)) => {
                    if self.items.remove(&key).is_some() || self.skipped.insert(key) {
                        self.changed = true;
                    }
                }
                Some(Parsed::Trashed(key)) if self.items.remove(&key).is_some() => {
                    self.changed = true;
                }
                Some(Parsed::Trashed(_)) | None => {}
            }
        }
    }

    fn remove(&mut self, keys: impl IntoIterator<Item = String>) {
        for key in keys {
            if self.items.remove(&key).is_some() {
                self.changed = true;
            }
            self.skipped.remove(&key);
        }
    }

    fn finish(self) -> bool {
        let mut items: Vec<Item> = self.items.into_values().collect();
        items.sort_by(|left, right| left.key.cmp(&right.key));
        let mut skipped: Vec<String> = self.skipped.into_iter().collect();
        skipped.sort();
        self.cache.items = items;
        self.cache.skipped = skipped;
        self.changed
    }
}

async fn full_fetch(
    http: &mut Http,
    path: &str,
    page: usize,
    work: &mut LibraryWork<'_>,
    progress: &mut (dyn FnMut(usize, usize) + Send),
) -> Result<Option<u64>, SyncError> {
    let mut start = 0;
    let mut version = None;
    let mut seen = HashSet::new();
    loop {
        let query = items_query(
            path,
            &format!("&sort=dateAdded&direction=asc&limit={page}&start={start}"),
        );
        let reply = http.get(&query, None).await?;
        version = version.or(reply.version);
        let values = array(&reply)?;
        for value in &values {
            if let Some(key) = value.get("key").and_then(Value::as_str) {
                seen.insert(key.to_string());
            }
        }
        work.apply(&values);
        let total = reply.total.unwrap_or(start + values.len());
        progress((start + values.len()).min(total), total);
        if values.len() < page || start + values.len() >= total {
            break;
        }
        start += page;
    }
    let stale: Vec<String> = work
        .items
        .keys()
        .chain(work.skipped.iter())
        .filter(|key| !seen.contains(*key))
        .cloned()
        .collect();
    work.remove(stale);
    Ok(version)
}

async fn fetch_pages(
    http: &mut Http,
    query: &str,
    page: usize,
    if_modified: Option<u64>,
) -> Result<(Vec<Value>, Option<u64>, bool), SyncError> {
    let mut values = Vec::new();
    let mut start = 0;
    let mut version = None;
    loop {
        let reply = http
            .get(
                &format!("{query}&limit={page}&start={start}"),
                if start == 0 { if_modified } else { None },
            )
            .await?;
        if reply.not_modified() {
            return Ok((values, reply.version.or(if_modified), false));
        }
        version = version.or(reply.version);
        let batch = array(&reply)?;
        let count = batch.len();
        values.extend(batch);
        let total = reply.total.unwrap_or(start + count);
        if count < page || start + count >= total {
            break;
        }
        start += page;
    }
    Ok((values, version, true))
}

async fn fetch_keys(
    http: &mut Http,
    path: &str,
    keys: Vec<String>,
    work: &mut LibraryWork<'_>,
) -> Result<(), SyncError> {
    for chunk in keys.chunks(KEY_BATCH) {
        let query = format!(
            "{path}/items?format=json&include=data&itemKey={}",
            chunk.join(",")
        );
        let reply = http.get(&query, None).await?;
        work.apply(&array(&reply)?);
    }
    Ok(())
}

async fn local_incremental(
    http: &mut Http,
    path: &str,
    work: &mut LibraryWork<'_>,
) -> Result<Option<u64>, SyncError> {
    let mut version = work.cache.local_version;
    if let Some(since) = version.filter(|since| *since > 0) {
        let query = items_query(
            path,
            &format!("&since={since}&sort=dateModified&direction=asc"),
        );
        let (values, latest, _) = fetch_pages(http, &query, LOCAL_PAGE, Some(since)).await?;
        work.apply(&values);
        version = latest.or(version);
    }
    for page in 0..PROBE_PAGES {
        let query = items_query(
            path,
            &format!(
                "&sort=dateModified&direction=desc&limit={PROBE_PAGE}&start={}",
                page * PROBE_PAGE
            ),
        );
        let reply = http.get(&query, None).await?;
        version = version.max(reply.version);
        let values = array(&reply)?;
        let unchanged = values.iter().any(|value| {
            let key = value.get("key").and_then(Value::as_str).unwrap_or_default();
            let modified = value
                .pointer("/data/dateModified")
                .and_then(Value::as_str)
                .unwrap_or_default();
            work.items
                .get(key)
                .is_some_and(|item| item.date_modified == modified)
        });
        let count = values.len();
        work.apply(&values);
        if unchanged || count < PROBE_PAGE {
            break;
        }
    }
    let reply = http
        .get(
            &format!("{path}/items/top?format=keys&itemType=-attachment"),
            None,
        )
        .await?;
    version = version.max(reply.version);
    let listed: HashSet<String> = reply
        .body
        .lines()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .collect();
    let gone: Vec<String> = work
        .items
        .keys()
        .chain(work.skipped.iter())
        .filter(|key| !listed.contains(*key))
        .cloned()
        .collect();
    work.remove(gone);
    let mut missing: Vec<String> = listed
        .into_iter()
        .filter(|key| !work.items.contains_key(key) && !work.skipped.contains(key))
        .collect();
    missing.sort();
    fetch_keys(http, path, missing, work).await?;
    Ok(version)
}

async fn web_incremental(
    http: &mut Http,
    path: &str,
    work: &mut LibraryWork<'_>,
    since: u64,
) -> Result<Option<u64>, SyncError> {
    let query = items_query(
        path,
        &format!("&since={since}&sort=dateModified&direction=asc"),
    );
    let (values, version, modified) = fetch_pages(http, &query, WEB_PAGE, Some(since)).await?;
    if !modified {
        return Ok(Some(since));
    }
    work.apply(&values);
    let reply = http
        .get(&format!("{path}/deleted?since={since}"), None)
        .await?;
    let deleted: Vec<String> = reply
        .json()?
        .get("items")
        .and_then(Value::as_array)
        .map(|keys| {
            keys.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    work.remove(deleted);
    Ok(version.or(Some(since)))
}

async fn list_groups(
    http: &mut Http,
    side: Side,
    user_id: Option<&str>,
) -> Result<Vec<(String, String)>, SyncError> {
    let path = match side {
        Side::Local => "/api/users/0/groups?format=json".to_string(),
        Side::Web => format!(
            "/users/{}/groups?format=json&limit=100",
            user_id.unwrap_or("0")
        ),
    };
    let reply = http.get(&path, None).await?;
    let mut groups: Vec<(String, String)> = array(&reply)?
        .iter()
        .filter_map(|group| {
            let id = group
                .get("id")
                .and_then(Value::as_u64)
                .or_else(|| group.pointer("/data/id").and_then(Value::as_u64))?;
            let name = group
                .pointer("/data/name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some((group_library(id), name))
        })
        .collect();
    groups.sort();
    Ok(groups)
}

pub async fn probe_local(endpoints: &Endpoints) -> LocalProbe {
    let Ok(mut http) = Http::new(Side::Local, &endpoints.local, None) else {
        return not_running();
    };
    let ping = match http.get_raw("/connector/ping", None).await {
        Ok(reply) if (200..300).contains(&reply.status) => reply,
        _ => return not_running(),
    };
    let zotero_version = ping.zotero_version.clone();
    let state_for = |state| LocalProbe {
        state,
        zotero_version: zotero_version.clone(),
        ..LocalProbe::default()
    };
    let api = match http.get_raw("/api/", None).await {
        Ok(reply) => reply,
        Err(_) => return not_running(),
    };
    match api.status {
        403 => state_for(LocalState::ApiDisabled),
        200..=299
            if api
                .api_version
                .as_deref()
                .is_none_or(|version| version == "3") =>
        {
            let bbt_version = match http.rpc("api.ready", json!([])).await {
                Ok(Some(ready)) => ready
                    .get("betterbibtex")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| Some(String::new())),
                _ => None,
            };
            LocalProbe {
                state: LocalState::Ready,
                zotero_version: zotero_version.or(api.zotero_version),
                bbt_version,
                installed: true,
                server_id: api.server_id,
            }
        }
        _ => state_for(LocalState::Unsupported),
    }
}

async fn refresh_bbt_keys(http: &mut Http, cache: &mut CacheFile) -> Result<bool, SyncError> {
    let groups = http.rpc("user.groups", json!([false])).await?;
    let mut by_name: HashMap<String, Vec<u64>> = HashMap::new();
    for library in groups
        .as_ref()
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let (Some(id), Some(name)) = (
            library.get("id").and_then(Value::as_u64),
            library.get("name").and_then(Value::as_str),
        ) {
            by_name.entry(name.to_string()).or_default().push(id);
        }
    }
    let mut changed = false;
    let disabled: HashSet<String> = cache.disabled.iter().cloned().collect();
    for library in cache.libraries.iter_mut() {
        if disabled.contains(&library.id) {
            continue;
        }
        let prefix = if library.id == USER_LIBRARY {
            String::new()
        } else {
            match by_name.get(&library.name).map(Vec::as_slice) {
                Some([id]) => {
                    library.bbt_id = Some(*id);
                    format!("{id}:")
                }
                _ => continue,
            }
        };
        let keys: Vec<String> = library
            .items
            .iter()
            .map(|item| format!("{prefix}{}", item.key))
            .collect();
        let mut found: HashMap<String, Option<String>> = HashMap::new();
        for chunk in keys.chunks(BBT_BATCH) {
            let Some(result) = http.rpc("item.citationkey", json!([chunk])).await? else {
                return Ok(changed);
            };
            for (requested, value) in result.as_object().into_iter().flatten() {
                let key = requested
                    .strip_prefix(&prefix)
                    .unwrap_or(requested)
                    .to_string();
                found.insert(
                    key,
                    value
                        .as_str()
                        .map(str::trim)
                        .filter(|key| !key.is_empty())
                        .map(str::to_string),
                );
            }
        }
        for item in library.items.iter_mut() {
            if let Some(key) = found.remove(&item.key) {
                if key.is_some() && item.bbt_key != key {
                    item.bbt_key = key;
                    changed = true;
                }
            }
        }
    }
    if !cache.bbt_seen {
        cache.bbt_seen = true;
        changed = true;
    }
    Ok(changed)
}

fn reconcile_libraries(cache: &mut CacheFile, groups: &[(String, String)]) -> bool {
    let mut changed = false;
    if !cache
        .libraries
        .iter()
        .any(|library| library.id == USER_LIBRARY)
    {
        cache.libraries.insert(
            0,
            LibraryCache {
                id: USER_LIBRARY.to_string(),
                name: String::new(),
                ..LibraryCache::default()
            },
        );
        changed = true;
    }
    let wanted: HashSet<&str> = groups.iter().map(|(id, _)| id.as_str()).collect();
    let before = cache.libraries.len();
    cache
        .libraries
        .retain(|library| library.id == USER_LIBRARY || wanted.contains(library.id.as_str()));
    changed |= before != cache.libraries.len();
    for (id, name) in groups {
        match cache.libraries.iter_mut().find(|library| &library.id == id) {
            Some(library) => {
                if &library.name != name {
                    library.name = name.clone();
                    changed = true;
                }
            }
            None => {
                cache.libraries.push(LibraryCache {
                    id: id.clone(),
                    name: name.clone(),
                    ..LibraryCache::default()
                });
                changed = true;
            }
        }
    }
    changed
}

fn resolve_all(cache: &mut CacheFile) -> bool {
    let before: Vec<(String, String)> = cache
        .libraries
        .iter()
        .flat_map(|library| library.items.iter())
        .map(|item| (item.key.clone(), item.citation_key.clone()))
        .collect();
    resolve_keys(
        cache
            .libraries
            .iter_mut()
            .flat_map(|library| library.items.iter_mut()),
    );
    let after: Vec<(String, String)> = cache
        .libraries
        .iter()
        .flat_map(|library| library.items.iter())
        .map(|item| (item.key.clone(), item.citation_key.clone()))
        .collect();
    before != after
}

struct Outcome {
    changed: bool,
    source: Option<&'static str>,
    error: Option<SyncError>,
}

impl ZoteroLibrary {
    pub fn new(endpoints: Endpoints, cache_path: Option<PathBuf>) -> Self {
        Self {
            endpoints,
            cache_path,
            policy: WaitPolicy::default(),
            snapshot: RwLock::new(Arc::new(Snapshot::empty())),
            meta: Mutex::new(Meta::default()),
            work: tokio::sync::Mutex::new(Work::default()),
        }
    }

    #[cfg(test)]
    pub fn with_policy(mut self, policy: WaitPolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn endpoints(&self) -> &Endpoints {
        &self.endpoints
    }

    pub fn snapshot(&self) -> Arc<Snapshot> {
        self.snapshot
            .read()
            .map(|snapshot| Arc::clone(&snapshot))
            .unwrap_or_else(|poisoned| Arc::clone(&poisoned.into_inner()))
    }

    fn meta(&self) -> std::sync::MutexGuard<'_, Meta> {
        self.meta
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn disabled(&self) -> HashSet<String> {
        self.meta().disabled.clone()
    }

    pub fn generation(&self) -> u64 {
        self.meta().generation
    }

    pub fn bbt_ids(&self) -> HashMap<String, u64> {
        self.meta().bbt_ids.clone()
    }

    pub fn web_matches_index(&self, user_id: &str) -> bool {
        let meta = self.meta();
        !meta.desktop_items || meta.desktop_owner.as_deref() == Some(user_id)
    }

    pub fn status(&self) -> Status {
        let meta = self.meta();
        let libraries = meta
            .libraries
            .iter()
            .map(|(id, name)| LibraryInfo {
                id: id.clone(),
                name: name.clone(),
                kind: if id == USER_LIBRARY { "user" } else { "group" },
                item_count: meta.counts.get(id).copied().unwrap_or_default(),
                enabled: !meta.disabled.contains(id),
            })
            .collect::<Vec<_>>();
        let item_count = libraries
            .iter()
            .filter(|library| library.enabled)
            .map(|library| library.item_count)
            .sum();
        Status {
            local: meta.local.clone(),
            web: meta.web,
            libraries,
            item_count,
            source: meta.source,
            last_sync: meta.last_sync,
            syncing: meta.syncing,
            progress: meta.progress,
            error: meta.error.clone(),
            generation: meta.generation,
            bbt_seen: meta.bbt_seen,
            retry_at: meta
                .retry_at
                .filter(|retry| *retry > SystemTime::now())
                .map(millis),
            loaded: meta.loaded,
        }
    }

    fn publish(&self, cache: &CacheFile, rebuild: bool) {
        if rebuild {
            let items: Vec<Item> = cache
                .libraries
                .iter()
                .flat_map(|library| library.items.iter().cloned())
                .collect();
            let snapshot = Arc::new(Snapshot::new(items));
            match self.snapshot.write() {
                Ok(mut current) => *current = snapshot,
                Err(poisoned) => *poisoned.into_inner() = snapshot,
            }
        }
        let mut meta = self.meta();
        meta.libraries = cache
            .libraries
            .iter()
            .map(|library| (library.id.clone(), library.name.clone()))
            .collect();
        meta.counts = cache
            .libraries
            .iter()
            .map(|library| (library.id.clone(), library.items.len()))
            .collect();
        meta.disabled = cache.disabled.iter().cloned().collect();
        meta.last_sync = cache.last_sync;
        meta.bbt_seen = cache.bbt_seen;
        meta.bbt_ids = cache
            .libraries
            .iter()
            .filter_map(|library| Some((library.id.clone(), library.bbt_id?)))
            .collect();
        meta.desktop_items = cache.holds_desktop_items();
        meta.desktop_owner = cache.local_user_id.clone();
        meta.loaded = true;
        if rebuild {
            meta.generation += 1;
        }
    }

    fn read_cache(&self) -> CacheFile {
        let Some(path) = &self.cache_path else {
            return CacheFile::default();
        };
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CacheFile>(&bytes).ok())
            .filter(|cache| cache.schema == CACHE_SCHEMA)
            .unwrap_or_default()
    }

    fn write_cache(&self, cache: &CacheFile) {
        let Some(path) = &self.cache_path else {
            return;
        };
        let Ok(bytes) = serde_json::to_vec(cache) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let file =
            atomicwrites::AtomicFile::new(path, atomicwrites::OverwriteBehavior::AllowOverwrite);
        let _ = file.write(|handle| std::io::Write::write_all(handle, &bytes));
    }

    async fn loaded(&self) -> tokio::sync::MutexGuard<'_, Work> {
        let mut work = self.work.lock().await;
        if !work.loaded {
            let mut cache = self.read_cache();
            cache.schema = CACHE_SCHEMA;
            work.cache = cache;
            work.loaded = true;
            self.publish(&work.cache, true);
        }
        work
    }

    pub async fn load(&self) -> Status {
        drop(self.loaded().await);
        self.status()
    }

    pub async fn set_enabled(&self, library: &str, enabled: bool) -> Status {
        let mut work = self.loaded().await;
        let disabled = &mut work.cache.disabled;
        let had = disabled.iter().any(|id| id == library);
        if enabled && had {
            disabled.retain(|id| id != library);
        } else if !enabled && !had {
            disabled.push(library.to_string());
            disabled.sort();
        } else {
            return self.status();
        }
        self.write_cache(&work.cache);
        self.publish(&work.cache, false);
        self.meta().generation += 1;
        drop(work);
        self.status()
    }

    pub async fn sync(
        &self,
        options: SyncOptions,
        progress: &mut (dyn FnMut(Status) + Send),
    ) -> Status {
        let mut work = match self.work.try_lock() {
            Ok(work) => work,
            Err(_) => return self.status(),
        };
        if !work.loaded {
            drop(work);
            work = self.loaded().await;
        }
        let (recent, waiting) = {
            let meta = self.meta();
            (
                !options.force
                    && meta
                        .last_attempt
                        .is_some_and(|last| last.elapsed() < MIN_INTERVAL),
                meta.retry_at.is_some_and(|retry| retry > SystemTime::now()),
            )
        };
        let mut probe = None;
        if recent || waiting {
            let fresh = probe_local(&self.endpoints).await;
            let moved = {
                let mut meta = self.meta();
                let moved = meta.local.state != fresh.state;
                meta.local = fresh.clone();
                moved
            };
            if waiting || !moved {
                drop(work);
                return self.status();
            }
            probe = Some(fresh);
        }
        {
            let mut meta = self.meta();
            meta.last_attempt = Some(Instant::now());
            meta.syncing = true;
            meta.progress = None;
            meta.error = None;
        }
        progress(self.status());
        let outcome = self.run(&mut work.cache, &options, probe, progress).await;
        let mut rebuild = outcome.changed;
        if resolve_all(&mut work.cache) {
            rebuild = true;
        }
        if outcome.source.is_some() && outcome.error.is_none() {
            work.cache.last_sync = Some(now_millis());
            work.cache.last_source = outcome.source.map(str::to_string);
        }
        if rebuild || outcome.source.is_some() {
            self.write_cache(&work.cache);
        }
        self.publish(&work.cache, rebuild);
        {
            let mut meta = self.meta();
            meta.syncing = false;
            meta.progress = None;
            meta.source = outcome.source;
            meta.error = outcome.error.as_ref().map(|error| error.app_error().into());
            meta.retry_at = match &outcome.error {
                Some(SyncError::RateLimited { seconds }) => {
                    Some(SystemTime::now() + Duration::from_secs((*seconds).max(1)))
                }
                _ => None,
            };
        }
        drop(work);
        self.status()
    }

    async fn run(
        &self,
        cache: &mut CacheFile,
        options: &SyncOptions,
        probe: Option<LocalProbe>,
        progress: &mut (dyn FnMut(Status) + Send),
    ) -> Outcome {
        let probe = match probe {
            Some(probe) => probe,
            None => probe_local(&self.endpoints).await,
        };
        self.meta().local = probe.clone();
        if probe.state == LocalState::Ready {
            let mut changed = false;
            if probe.server_id.is_some() && cache.server_id != probe.server_id {
                for library in cache.libraries.iter_mut() {
                    library.local_version = None;
                }
                cache.server_id = probe.server_id.clone();
                changed = true;
            }
            return match self
                .sync_side(cache, Side::Local, None, &mut changed, progress)
                .await
            {
                Ok(()) => {
                    if probe.bbt_version.is_some() {
                        if let Ok(mut http) = Http::new(Side::Local, &self.endpoints.local, None) {
                            changed |= refresh_bbt_keys(&mut http, cache).await.unwrap_or(false);
                        }
                    }
                    Outcome {
                        changed,
                        source: Some("local"),
                        error: None,
                    }
                }
                Err(error) => {
                    let state = match error {
                        SyncError::NotRunning | SyncError::Http(503) => {
                            Some(LocalState::NotRunning)
                        }
                        SyncError::ApiDisabled => Some(LocalState::ApiDisabled),
                        _ => None,
                    };
                    if let Some(state) = state {
                        self.meta().local.state = state;
                    }
                    Outcome {
                        changed,
                        source: None,
                        error: Some(error),
                    }
                }
            };
        }
        let Some(credentials) = options.credentials.clone() else {
            self.meta().web = WebState::NotConnected;
            return Outcome {
                changed: false,
                source: None,
                error: None,
            };
        };
        if options.offline {
            self.meta().web = WebState::Offline;
            return Outcome {
                changed: false,
                source: None,
                error: None,
            };
        }
        if !self.web_matches_index(&credentials.user_id) {
            return Outcome {
                changed: false,
                source: None,
                error: None,
            };
        }
        if cache.user_id.as_deref() != Some(credentials.user_id.as_str()) {
            for library in cache.libraries.iter_mut() {
                library.web_version = None;
            }
            cache.user_id = Some(credentials.user_id.clone());
        }
        let mut changed = false;
        match self
            .sync_side(cache, Side::Web, Some(&credentials), &mut changed, progress)
            .await
        {
            Ok(()) => {
                self.meta().web = WebState::Ready;
                Outcome {
                    changed,
                    source: Some("web"),
                    error: None,
                }
            }
            Err(error) => {
                self.meta().web = match error {
                    SyncError::KeyRejected => WebState::KeyRejected,
                    SyncError::RateLimited { .. } => WebState::RateLimited,
                    _ => WebState::Unreachable,
                };
                Outcome {
                    changed,
                    source: None,
                    error: Some(error),
                }
            }
        }
    }

    async fn sync_side(
        &self,
        cache: &mut CacheFile,
        side: Side,
        credentials: Option<&Credentials>,
        changed: &mut bool,
        progress: &mut (dyn FnMut(Status) + Send),
    ) -> Result<(), SyncError> {
        let (base, key) = match side {
            Side::Local => (self.endpoints.local.clone(), None),
            Side::Web => (
                self.endpoints.web.clone(),
                credentials.map(|credentials| credentials.api_key.clone()),
            ),
        };
        let mut http = Http::new(side, &base, key)?.with_policy(self.policy);
        let user_id = credentials.map(|credentials| credentials.user_id.as_str());
        let groups = list_groups(&mut http, side, user_id).await?;
        *changed |= reconcile_libraries(cache, &groups);
        let disabled: HashSet<String> = cache.disabled.iter().cloned().collect();
        let total_libraries = cache.libraries.len();
        for index in 0..total_libraries {
            let library_id = cache.libraries[index].id.clone();
            if disabled.contains(&library_id) {
                continue;
            }
            let path = library_path(side, &library_id, user_id);
            let library = &mut cache.libraries[index];
            let cursor = match side {
                Side::Local => library.local_version,
                Side::Web => library.web_version,
            };
            let empty = library.items.is_empty() && library.skipped.is_empty();
            let mut work = LibraryWork::new(library);
            let result = match (side, cursor) {
                (_, None) => {
                    let page = if side == Side::Local {
                        LOCAL_PAGE
                    } else {
                        WEB_PAGE
                    };
                    let meta = &self.meta;
                    let mut report = |done: usize, total: usize| {
                        if let Ok(mut meta) = meta.lock() {
                            meta.progress = Some(Progress { done, total });
                        }
                    };
                    let fetched = full_fetch(&mut http, &path, page, &mut work, &mut report).await;
                    progress(self.status());
                    fetched
                }
                (_, Some(_)) if empty && side == Side::Web => {
                    let mut ignore = |_: usize, _: usize| {};
                    full_fetch(&mut http, &path, WEB_PAGE, &mut work, &mut ignore).await
                }
                (Side::Local, Some(_)) => local_incremental(&mut http, &path, &mut work).await,
                (Side::Web, Some(since)) => {
                    web_incremental(&mut http, &path, &mut work, since).await
                }
            };
            let owner = work.owner.take();
            *changed |= work.finish();
            if side == Side::Local && library_id == USER_LIBRARY && owner.is_some() {
                cache.local_user_id = owner;
            }
            let version = result?;
            let library = &mut cache.libraries[index];
            match side {
                Side::Local => library.local_version = version.or(Some(0)),
                Side::Web => library.web_version = version.or(Some(0)),
            }
        }
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> (u64, SearchResult) {
        let generation = self.generation();
        let disabled = self.disabled();
        (generation, self.snapshot().search(query, limit, &disabled))
    }

    pub fn lookup(&self, keys: &[String]) -> Vec<Option<SearchHit>> {
        let snapshot = self.snapshot();
        let disabled = self.disabled();
        keys.iter()
            .map(|key| {
                snapshot
                    .by_citation_key(key)
                    .filter(|item| !disabled.contains(&item.library))
                    .map(|item| snapshot.hit_for(item))
            })
            .collect()
    }

    pub fn keys(&self) -> (u64, Vec<String>) {
        let disabled = self.disabled();
        (self.generation(), self.snapshot().keys(&disabled))
    }

    pub fn items(&self, refs: &[(String, String)]) -> Vec<Option<SearchHit>> {
        let snapshot = self.snapshot();
        refs.iter()
            .map(|(library, key)| {
                snapshot
                    .item(library, key)
                    .map(|item| snapshot.hit_for(item))
            })
            .collect()
    }

    pub async fn libraries_with_counts(
        &self,
        options: &SyncOptions,
    ) -> Result<(Side, Vec<(String, String, Option<usize>)>), SyncError> {
        let probe = probe_local(&self.endpoints).await;
        self.meta().local = probe.clone();
        let (side, credentials) = if probe.state == LocalState::Ready {
            (Side::Local, None)
        } else if let Some(credentials) = options.credentials.clone() {
            if options.offline {
                return Err(SyncError::Offline);
            }
            (Side::Web, Some(credentials))
        } else {
            return Err(match probe.state {
                LocalState::ApiDisabled => SyncError::ApiDisabled,
                LocalState::Unsupported => SyncError::Unsupported,
                _ => SyncError::NotRunning,
            });
        };
        let base = if side == Side::Local {
            &self.endpoints.local
        } else {
            &self.endpoints.web
        };
        let mut http = Http::new(side, base, credentials.as_ref().map(|c| c.api_key.clone()))?
            .with_policy(self.policy);
        let user_id = credentials.as_ref().map(|c| c.user_id.as_str());
        let mut libraries = vec![(USER_LIBRARY.to_string(), String::new())];
        libraries.extend(list_groups(&mut http, side, user_id).await?);
        let mut counted = Vec::new();
        for (id, name) in libraries {
            let path = library_path(side, &id, user_id);
            let limit = if side == Side::Local { "" } else { "&limit=1" };
            let reply = http
                .get(
                    &format!("{path}/items/top?format=keys&itemType=-attachment{limit}"),
                    None,
                )
                .await?;
            let count = if side == Side::Local {
                Some(
                    reply
                        .body
                        .lines()
                        .filter(|key| !key.trim().is_empty())
                        .count(),
                )
            } else {
                reply.total
            };
            counted.push((id, name, count));
        }
        if side == Side::Web {
            self.meta().web = WebState::Ready;
        }
        Ok((side, counted))
    }

    #[cfg(test)]
    pub(crate) async fn cache_for_test(&self) -> CacheFile {
        self.loaded().await.cache.clone()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::zotero::mock::MockZotero;

    fn library(mock: &MockZotero, cache: Option<PathBuf>) -> ZoteroLibrary {
        ZoteroLibrary::new(mock.endpoints(), cache).with_policy(WaitPolicy {
            max_single: Duration::from_secs(1),
            max_total: Duration::from_secs(2),
        })
    }

    fn credentials(mock: &MockZotero) -> Option<Credentials> {
        Some(Credentials {
            user_id: mock.user_id().to_string(),
            api_key: mock.api_key().to_string(),
        })
    }

    async fn sync(library: &ZoteroLibrary, options: SyncOptions) -> Status {
        library
            .sync(
                SyncOptions {
                    force: true,
                    ..options
                },
                &mut |_| {},
            )
            .await
    }

    async fn refresh(library: &ZoteroLibrary) -> Status {
        library.sync(SyncOptions::default(), &mut |_| {}).await
    }

    #[tokio::test]
    async fn tells_a_closed_zotero_from_a_disabled_local_api() {
        let mock = MockZotero::start().await;
        mock.set(|state| state.local_api = false);
        let probe = probe_local(&mock.endpoints()).await;
        assert_eq!(probe.state, LocalState::ApiDisabled);
        assert_eq!(probe.zotero_version.as_deref(), Some("7.0.11"));
        mock.set(|state| state.local_api = true);
        let ready = probe_local(&mock.endpoints()).await;
        assert_eq!(ready.state, LocalState::Ready);
        assert_eq!(ready.bbt_version.as_deref(), Some("6.7.240"));
        mock.set(|state| state.bbt = false);
        assert_eq!(probe_local(&mock.endpoints()).await.bbt_version, None);
        let closed = Endpoints {
            local: "http://127.0.0.1:9".to_string(),
            web: mock.endpoints().web,
        };
        assert_eq!(probe_local(&closed).await.state, LocalState::NotRunning);
    }

    #[tokio::test]
    async fn syncs_the_local_library_with_better_bibtex_keys() {
        let mock = MockZotero::start().await;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("zotero/library.json");
        let zotero = library(&mock, Some(path.clone()));
        let status = sync(&zotero, SyncOptions::default()).await;
        assert_eq!(status.local.state, LocalState::Ready);
        assert_eq!(status.source, Some("local"));
        assert_eq!(status.item_count, 4);
        assert!(status.bbt_seen);
        assert_eq!(status.libraries.len(), 2);
        let snapshot = zotero.snapshot();
        let smith = snapshot.item(USER_LIBRARY, "SMITH234").unwrap();
        assert_eq!(smith.citation_key, "smithBBT2020");
        let native = snapshot.item(USER_LIBRARY, "NATIV234").unwrap();
        assert_eq!(native.citation_key, "nativeKey2019");
        let group = snapshot.item("group:777", "GROUP234").unwrap();
        assert_eq!(group.citation_key, "groupBBT2021");
        assert!(snapshot.item(USER_LIBRARY, "NOTE2345").is_none());
        assert!(path.exists());
        let reloaded = library(&mock, Some(path.clone()));
        let loaded = reloaded.load().await;
        assert_eq!(loaded.item_count, 4);
        assert_eq!(
            reloaded.search("smith", 5).1.hits[0].citation_key,
            "smithBBT2020"
        );
    }

    #[tokio::test]
    async fn local_refresh_picks_up_unsynced_edits_new_items_and_deletions() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        sync(&zotero, SyncOptions::default()).await;
        let before = mock.request_count();
        mock.set(|state| {
            state.edit("user", "SMITH234", "title", "Edited title", false);
            state.add("user", "NEWIT234", "Brand new paper", false);
            state.delete("user", "NATIV234");
        });
        let status = sync(&zotero, SyncOptions::default()).await;
        assert_eq!(status.error, None);
        let snapshot = zotero.snapshot();
        assert_eq!(
            snapshot.item(USER_LIBRARY, "SMITH234").unwrap().title,
            "Edited title"
        );
        assert!(snapshot.item(USER_LIBRARY, "NEWIT234").is_some());
        assert!(snapshot.item(USER_LIBRARY, "NATIV234").is_none());
        assert!(mock.request_count() - before < 20);
        assert!(!mock.paths().iter().any(|path| path.contains("since=0")));
    }

    #[tokio::test]
    async fn web_sync_is_incremental_and_reports_deletions() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        sync(&zotero, SyncOptions::default()).await;
        mock.set(|state| state.running = false);
        let options = SyncOptions {
            credentials: credentials(&mock),
            ..SyncOptions::default()
        };
        let first = sync(&zotero, options.clone()).await;
        assert_eq!(first.local.state, LocalState::NotRunning);
        assert_eq!(first.source, Some("web"));
        assert_eq!(first.web, WebState::Ready);
        assert_eq!(first.item_count, 4);
        let cache = zotero.cache_for_test().await;
        let user = cache
            .libraries
            .iter()
            .find(|library| library.id == USER_LIBRARY)
            .unwrap();
        assert_eq!(user.web_version, Some(mock.version("user")));
        mock.clear_requests();
        let unchanged = sync(&zotero, options.clone()).await;
        assert_eq!(unchanged.error, None);
        assert!(mock.paths().iter().all(|path| !path.contains("start=100")));
        assert!(mock.not_modified_count() >= 1);
        mock.set(|state| {
            state.edit("user", "SMITH234", "title", "Web edit", true);
            state.delete("user", "NATIV234");
        });
        mock.clear_requests();
        sync(&zotero, options.clone()).await;
        let snapshot = zotero.snapshot();
        assert_eq!(
            snapshot.item(USER_LIBRARY, "SMITH234").unwrap().title,
            "Web edit"
        );
        assert!(snapshot.item(USER_LIBRARY, "NATIV234").is_none());
        assert!(mock
            .paths()
            .iter()
            .any(|path| path.contains("since=") && path.contains("/users/475425/items/top")));
        assert!(mock
            .paths()
            .iter()
            .any(|path| path.contains("/users/475425/deleted?since=")));
        let smith = snapshot.item(USER_LIBRARY, "SMITH234").unwrap();
        assert_eq!(smith.citation_key, "smithBBT2020");
    }

    #[tokio::test]
    async fn honours_backoff_and_retry_after() {
        let mock = MockZotero::start().await;
        mock.set(|state| {
            state.running = false;
            state.backoff = Some(5);
        });
        let zotero = library(&mock, None);
        let options = SyncOptions {
            credentials: credentials(&mock),
            ..SyncOptions::default()
        };
        let status = sync(&zotero, options.clone()).await;
        assert_eq!(status.web, WebState::RateLimited);
        assert!(status.retry_at.is_some());
        assert_eq!(mock.web_request_count(), 1);
        let again = sync(&zotero, options.clone()).await;
        assert_eq!(mock.web_request_count(), 1);
        assert!(again.retry_at.is_some());
        let fresh = library(&mock, None);
        mock.set(|state| {
            state.backoff = None;
            state.rate_limit = 2;
            state.retry_after = 0;
        });
        let recovered = sync(&fresh, options.clone()).await;
        assert_eq!(recovered.error, None);
        assert_eq!(recovered.item_count, 4);
        mock.set(|state| {
            state.rate_limit = 1;
            state.retry_after = 120;
        });
        let limited = library(&mock, None);
        let refused = sync(&limited, options).await;
        assert_eq!(refused.web, WebState::RateLimited);
        assert!(refused.error.unwrap().contains("zotero.rate_limited"));
    }

    #[tokio::test]
    async fn web_sync_reports_a_revoked_key_and_skips_when_offline() {
        let mock = MockZotero::start().await;
        mock.set(|state| state.running = false);
        let zotero = library(&mock, None);
        let offline = sync(
            &zotero,
            SyncOptions {
                offline: true,
                credentials: credentials(&mock),
                ..SyncOptions::default()
            },
        )
        .await;
        assert_eq!(offline.web, WebState::Offline);
        assert_eq!(mock.web_request_count(), 0);
        let revoked = sync(
            &zotero,
            SyncOptions {
                credentials: Some(Credentials {
                    user_id: mock.user_id().into(),
                    api_key: "WRONGKEY".into(),
                }),
                ..SyncOptions::default()
            },
        )
        .await;
        assert_eq!(revoked.web, WebState::KeyRejected);
        assert!(revoked.error.unwrap().contains("zotero.key_rejected"));
        let unconfigured = sync(&zotero, SyncOptions::default()).await;
        assert_eq!(unconfigured.web, WebState::NotConnected);
    }

    #[tokio::test]
    async fn keeps_better_bibtex_keys_from_the_cache_when_zotero_closes() {
        let mock = MockZotero::start().await;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.json");
        let zotero = library(&mock, Some(path.clone()));
        sync(&zotero, SyncOptions::default()).await;
        mock.set(|state| state.running = false);
        let closed = library(&mock, Some(path));
        let status = sync(&closed, SyncOptions::default()).await;
        assert_eq!(status.local.state, LocalState::NotRunning);
        assert_eq!(status.item_count, 4);
        assert!(status.last_sync.is_some());
        assert_eq!(
            closed.search("smith", 3).1.hits[0].citation_key,
            "smithBBT2020"
        );
    }

    #[tokio::test]
    async fn a_throttled_refresh_still_notices_zotero_closing_and_opening() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        let first = refresh(&zotero).await;
        assert_eq!(first.local.state, LocalState::Ready);
        assert_eq!(first.source, Some("local"));
        mock.set(|state| state.running = false);
        let closed = refresh(&zotero).await;
        assert_eq!(closed.local.state, LocalState::NotRunning);
        assert_eq!(closed.source, None);
        assert_eq!(closed.item_count, 4);
        assert_eq!(closed.last_sync, first.last_sync);
        assert!(!closed.syncing);
        let still = refresh(&zotero).await;
        assert_eq!(still.local.state, LocalState::NotRunning);
        mock.set(|state| {
            state.running = true;
            state.add("user", "NEWIT234", "Brand new paper", false);
        });
        let reopened = refresh(&zotero).await;
        assert_eq!(reopened.local.state, LocalState::Ready);
        assert_eq!(reopened.source, Some("local"));
        assert!(zotero.snapshot().item(USER_LIBRARY, "NEWIT234").is_some());
        mock.clear_requests();
        let quiet = refresh(&zotero).await;
        assert_eq!(quiet.local.state, LocalState::Ready);
        assert!(!mock.paths().iter().any(|path| path.contains("/items")));
    }

    #[tokio::test]
    async fn never_swaps_the_desktop_library_for_a_different_zotero_org_library() {
        let mock = MockZotero::start().await;
        mock.set(|state| {
            state.local_user_id = 0;
            state.web_other_library = true;
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.json");
        let zotero = library(&mock, Some(path.clone()));
        let synced = sync(&zotero, SyncOptions::default()).await;
        assert_eq!(synced.item_count, 4);
        assert_eq!(
            zotero.cache_for_test().await.local_user_id.as_deref(),
            Some("0")
        );
        mock.set(|state| state.running = false);
        mock.clear_requests();
        let options = SyncOptions {
            credentials: credentials(&mock),
            ..SyncOptions::default()
        };
        let closed = sync(&zotero, options.clone()).await;
        assert_eq!(closed.local.state, LocalState::NotRunning);
        assert_eq!(closed.source, None);
        assert_eq!(closed.error, None);
        assert_eq!(closed.item_count, 4);
        assert_eq!(closed.last_sync, synced.last_sync);
        assert_eq!(mock.web_request_count(), 0);
        assert_eq!(
            zotero.search("smith", 3).1.hits[0].citation_key,
            "smithBBT2020"
        );
        let mut legacy: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("localUserId");
        std::fs::write(&path, legacy.to_string()).unwrap();
        let restarted = library(&mock, Some(path));
        let status = sync(&restarted, options).await;
        assert_eq!(status.item_count, 4);
        assert_eq!(status.source, None);
        assert_eq!(mock.web_request_count(), 0);
    }

    #[tokio::test]
    async fn an_empty_desktop_index_still_fills_from_zotero_org() {
        let mock = MockZotero::start().await;
        mock.set(|state| {
            state.local_user_id = 0;
            for library in state.libraries.iter_mut() {
                library.items.clear();
            }
        });
        let zotero = library(&mock, None);
        assert_eq!(sync(&zotero, SyncOptions::default()).await.item_count, 0);
        mock.set(|state| {
            state.running = false;
            state.add("user", "WEBIT234", "Only on zotero.org", true);
        });
        let status = sync(
            &zotero,
            SyncOptions {
                credentials: credentials(&mock),
                ..SyncOptions::default()
            },
        )
        .await;
        assert_eq!(status.source, Some("web"));
        assert!(zotero.snapshot().item(USER_LIBRARY, "WEBIT234").is_some());
    }

    #[tokio::test]
    async fn records_the_old_key_when_better_bibtex_renames_an_item() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        sync(&zotero, SyncOptions::default()).await;
        mock.set(|state| state.set_bbt_key("SMITH234", "smithRenamed2020"));
        sync(&zotero, SyncOptions::default()).await;
        let snapshot = zotero.snapshot();
        let smith = snapshot.item(USER_LIBRARY, "SMITH234").unwrap();
        assert_eq!(smith.citation_key, "smithRenamed2020");
        assert_eq!(smith.aliases, vec!["smithBBT2020".to_string()]);
        assert_eq!(
            snapshot.by_citation_key("smithBBT2020").unwrap().key,
            "SMITH234"
        );
    }

    #[tokio::test]
    async fn disabled_libraries_are_not_searched_or_fetched() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        sync(&zotero, SyncOptions::default()).await;
        let status = zotero.set_enabled("group:777", false).await;
        assert_eq!(status.item_count, 3);
        assert!(zotero.search("group", 5).1.hits.is_empty());
        mock.clear_requests();
        sync(&zotero, SyncOptions::default()).await;
        assert!(!mock
            .paths()
            .iter()
            .any(|path| path.contains("/api/groups/777/items")));
    }

    #[tokio::test]
    async fn counts_items_for_the_connection_test() {
        let mock = MockZotero::start().await;
        let zotero = library(&mock, None);
        let (side, libraries) = zotero
            .libraries_with_counts(&SyncOptions::default())
            .await
            .unwrap();
        assert_eq!(side, Side::Local);
        assert_eq!(libraries[0].2, Some(4));
        assert_eq!(libraries[1].1, "Lab Group");
        mock.set(|state| state.local_total_extra = 1);
        let (_, inflated) = zotero
            .libraries_with_counts(&SyncOptions::default())
            .await
            .unwrap();
        assert_eq!(inflated[0].2, Some(4));
        mock.set(|state| state.local_api = false);
        assert_eq!(
            zotero
                .libraries_with_counts(&SyncOptions::default())
                .await
                .unwrap_err(),
            SyncError::ApiDisabled
        );
    }
}
