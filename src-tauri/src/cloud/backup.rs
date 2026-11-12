use super::engine::{self, RoundError};
use super::merge::PROJECT_META;
use super::store::{BatchDelete, BatchFile, CloudStore, StoreError, WriteMode};
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::{ContentHash, ContentHasher};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(crate) const FORMAT: u32 = 1;
const ROOT: &str = "/backups";
const MAX_SET_BYTES: usize = 32 * 1024 * 1024;
const UPLOAD_BATCH: usize = 32;
const UPLOAD_BATCH_BYTES: u64 = 256 * 1024 * 1024;
const FETCH_CONCURRENCY: usize = 8;
const MAX_SETS_LISTED: usize = 400;
const MAX_COPY_LABEL: usize = 80;
pub(crate) const EVERY_HOURS: [u32; 3] = [6, 24, 168];
pub(crate) const KEEP: [u32; 4] = [7, 14, 30, 90];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ItemKind {
    Note,
    Project,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct BackupFile {
    pub(crate) path: String,
    pub(crate) hash: String,
    pub(crate) size: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) exec: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rev: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct BackupItem {
    pub(crate) id: String,
    pub(crate) kind: ItemKind,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) project: Option<String>,
    pub(crate) files: Vec<BackupFile>,
}

impl BackupItem {
    fn bytes(&self) -> u64 {
        self.files
            .iter()
            .fold(0, |total: u64, file| total.saturating_add(file.size))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct BackupSet {
    pub(crate) v: u32,
    pub(crate) id: String,
    pub(crate) device: String,
    pub(crate) device_name: String,
    pub(crate) created_ms: u64,
    pub(crate) scheduled: bool,
    pub(crate) items: Vec<BackupItem>,
    #[serde(flatten)]
    pub(crate) extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct BackupSettings {
    pub(crate) auto: bool,
    pub(crate) every_hours: u32,
    pub(crate) keep: u32,
    pub(crate) include_projects: bool,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            auto: true,
            every_hours: 24,
            keep: 30,
            include_projects: false,
        }
    }
}

impl BackupSettings {
    pub(crate) fn normalized(self) -> Self {
        let defaults = Self::default();
        Self {
            every_hours: if EVERY_HOURS.contains(&self.every_hours) {
                self.every_hours
            } else {
                defaults.every_hours
            },
            keep: if KEEP.contains(&self.keep) {
                self.keep
            } else {
                defaults.keep
            },
            ..self
        }
    }

    pub(crate) fn due(&self, last_ok_ms: Option<u64>, now_ms: u64) -> bool {
        self.auto
            && last_ok_ms.is_none_or(|last| {
                now_ms.saturating_sub(last) >= u64::from(self.every_hours) * 60 * 60 * 1000
            })
    }
}

#[derive(Clone)]
pub(crate) struct Source {
    pub(crate) id: String,
    pub(crate) kind: ItemKind,
    pub(crate) name: String,
    pub(crate) link: Option<String>,
    pub(crate) project: Option<String>,
    pub(crate) root: PathBuf,
}

#[derive(Debug, Default)]
pub(crate) struct Library {
    pub(crate) folders: BTreeSet<String>,
    pub(crate) projects: BTreeSet<String>,
    pub(crate) links: BTreeSet<String>,
}

impl Library {
    pub(crate) fn has(&self, item: &BackupItem) -> bool {
        self.folders.contains(&item.id)
            || item
                .project
                .as_ref()
                .is_some_and(|project| self.projects.contains(project))
            || item
                .link
                .as_ref()
                .is_some_and(|link| self.links.contains(link))
    }
}

pub(crate) struct Run<'a> {
    pub(crate) device: &'a str,
    pub(crate) device_name: &'a str,
    pub(crate) staging: &'a Path,
    pub(crate) cache: &'a Path,
    pub(crate) keep: u32,
    pub(crate) scheduled: bool,
    pub(crate) now_ms: u64,
    pub(crate) leftovers: &'a BTreeSet<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupOutcome {
    pub(crate) id: String,
    pub(crate) notes: usize,
    pub(crate) projects: usize,
    pub(crate) bytes: u64,
    pub(crate) uploaded_bytes: u64,
    pub(crate) skipped: Vec<String>,
    pub(crate) removed_sets: usize,
    pub(crate) removed_files: usize,
    #[serde(skip)]
    pub(crate) leftovers: BTreeSet<String>,
}

fn device_root(device: &str) -> String {
    format!("{ROOT}/{device}")
}

fn blobs_dir(device: &str) -> String {
    format!("{}/blobs", device_root(device))
}

fn blob_remote(device: &str, hash: &str) -> String {
    format!("{}/{hash}", blobs_dir(device))
}

fn sets_dir(device: &str) -> String {
    format!("{}/sets", device_root(device))
}

fn set_remote(device: &str, id: &str) -> String {
    format!("{}/{id}.json", sets_dir(device))
}

pub(crate) fn set_id(now_ms: u64, salt: u32) -> String {
    format!("{now_ms:013}-{salt:08x}")
}

pub(crate) fn valid_set_id(id: &str) -> bool {
    let Some((ms, salt)) = id.split_once('-') else {
        return false;
    };
    ms.len() == 13
        && ms.bytes().all(|byte| byte.is_ascii_digit())
        && salt.len() == 8
        && salt
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(crate) fn valid_device(device: &str) -> bool {
    !device.is_empty()
        && device.len() <= 64
        && device
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn valid_hash(hash: &str) -> bool {
    ContentHash::from_hex(hash).is_ok()
}

fn valid_set(set: &BackupSet, device: &str, id: &str) -> bool {
    set.v == FORMAT
        && set.device == device
        && set.id == id
        && set.items.iter().all(|item| {
            crate::paths::validate_project_id(&item.id).is_ok()
                && item.files.iter().all(|file| {
                    valid_hash(&file.hash)
                        && oleafly_core::portable::synced_path_problem(&file.path).is_none()
                })
        })
}

fn local_error(error: impl std::fmt::Display) -> RoundError {
    RoundError::Local(error.to_string())
}

async fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RoundError> + Send + 'static,
) -> Result<T, RoundError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(local_error)?
}

fn exec_of(root: &Path, portable: &str) -> bool {
    let mut path = root.to_path_buf();
    for part in portable.split('/') {
        path.push(part);
    }
    std::fs::symlink_metadata(&path).is_ok_and(|metadata| engine::executable(&metadata, false))
}

pub(crate) fn capture_item(source: &Source) -> Result<(BackupItem, usize), RoundError> {
    let capture = engine::capture_tree(&source.root)?;
    let mut files = Vec::with_capacity(capture.files.len());
    for file in capture.files.values() {
        let hash = if file.path == PROJECT_META {
            ContentHash::digest_file(source.root.join(PROJECT_META))
                .map_err(local_error)?
                .to_hex()
        } else {
            file.hash.clone()
        };
        files.push(BackupFile {
            exec: exec_of(&source.root, &file.path),
            path: file.path.clone(),
            hash,
            size: file.size(),
            rev: None,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((
        BackupItem {
            id: source.id.clone(),
            kind: source.kind,
            name: source.name.clone(),
            link: source.link.clone(),
            project: source.project.clone(),
            files,
        },
        capture.skipped.len(),
    ))
}

struct Captured {
    items: Vec<BackupItem>,
    sources: Vec<Source>,
    skipped: Vec<String>,
}

fn capture_all(sources: Vec<Source>) -> Captured {
    let mut captured = Captured {
        items: Vec::with_capacity(sources.len()),
        sources: Vec::with_capacity(sources.len()),
        skipped: Vec::new(),
    };
    for source in sources {
        match capture_item(&source) {
            Ok((item, _)) => {
                captured.items.push(item);
                captured.sources.push(source);
            }
            Err(_) => captured.skipped.push(source.name),
        }
    }
    captured
}

fn staged_copy(source: &Path, target: &Path) -> std::io::Result<(ContentHash, u64)> {
    let mut input = std::fs::File::open(source)?;
    let mut output = std::fs::File::create(target)?;
    let mut hasher = ContentHasher::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut size = 0u64;
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        output.write_all(&buffer[..read])?;
        size += read as u64;
    }
    output.sync_all()?;
    Ok((hasher.finish(), size))
}

struct Pending {
    item: usize,
    file: usize,
    source: PathBuf,
    local: PathBuf,
}

fn batches(sizes: &[u64]) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut bytes = 0u64;
    for (index, size) in sizes.iter().enumerate() {
        if index > start
            && (index - start == UPLOAD_BATCH || bytes.saturating_add(*size) > UPLOAD_BATCH_BYTES)
        {
            ranges.push(start..index);
            start = index;
            bytes = 0;
        }
        bytes = bytes.saturating_add(*size);
    }
    if start < sizes.len() {
        ranges.push(start..sizes.len());
    }
    ranges
}

fn blob_hash(name: &str) -> Option<&str> {
    let hash = name.split_once('~').map_or(name, |(hash, _)| hash);
    valid_hash(hash).then_some(hash)
}

async fn listed_blobs<S: CloudStore>(store: &S, device: &str) -> Result<Vec<String>, RoundError> {
    Ok(store
        .list(&blobs_dir(device))
        .await?
        .into_iter()
        .filter(|entry| !entry.folder && blob_hash(&entry.name).is_some())
        .map(|entry| entry.name)
        .collect())
}

fn hashes_of(names: &[String]) -> BTreeSet<String> {
    names
        .iter()
        .filter_map(|name| blob_hash(name).map(str::to_string))
        .collect()
}

fn hashes_in<'s>(sets: impl IntoIterator<Item = &'s BackupSet>) -> BTreeSet<&'s str> {
    sets.into_iter()
        .flat_map(|set| set.items.iter().flat_map(|item| item.files.iter()))
        .map(|file| file.hash.as_str())
        .collect()
}

async fn sweep<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    listed: &[String],
    used: &BTreeSet<&str>,
) -> (usize, BTreeSet<String>) {
    let unused: Vec<&String> = listed
        .iter()
        .filter(|name| blob_hash(name).is_some_and(|hash| !used.contains(hash)))
        .collect();
    let (due, seen): (Vec<&String>, Vec<&String>) = unused
        .into_iter()
        .partition(|name| run.leftovers.contains(*name));
    let mut leftovers: BTreeSet<String> = seen.into_iter().cloned().collect();
    let removals: Vec<BatchDelete> = due
        .iter()
        .map(|name| BatchDelete {
            remote: format!("{}/{name}", blobs_dir(run.device)),
            parent_rev: None,
        })
        .collect();
    let mut removed = 0;
    for (name, result) in due.iter().zip(store.delete_paths(&removals).await) {
        if result.is_ok() {
            removed += 1;
        } else {
            leftovers.insert((*name).clone());
        }
    }
    (removed, leftovers)
}

type Known = BTreeMap<String, String>;

fn known_revs(sets: &[BackupSet], present: &BTreeSet<String>) -> Known {
    let mut known = Known::new();
    for file in sets
        .iter()
        .flat_map(|set| set.items.iter().flat_map(|item| item.files.iter()))
    {
        if let Some(rev) = file.rev.as_ref().filter(|_| present.contains(&file.hash)) {
            known.insert(file.hash.clone(), rev.clone());
        }
    }
    known
}

fn pairs(sets: &[&BackupSet]) -> BTreeSet<(String, String)> {
    sets.iter()
        .flat_map(|set| set.items.iter().flat_map(|item| item.files.iter()))
        .filter_map(|file| file.rev.clone().map(|rev| (file.hash.clone(), rev)))
        .collect()
}

async fn upload_missing<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    sources: &[Source],
    items: &mut [BackupItem],
    have: &mut Known,
) -> Result<u64, RoundError> {
    let folder = run.staging.join(format!("backup-{}", run.now_ms));
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(local_error)?;
    let result = upload_from(store, run, sources, items, have, &folder).await;
    let _ = tokio::fs::remove_dir_all(&folder).await;
    result
}

fn pending_files(
    sources: &[Source],
    items: &[BackupItem],
    have: &Known,
    folder: &Path,
) -> Vec<Pending> {
    let mut pending = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        for (file_index, file) in item.files.iter().enumerate() {
            if have.contains_key(&file.hash) {
                continue;
            }
            let mut source = sources[item_index].root.clone();
            for part in file.path.split('/') {
                source.push(part);
            }
            pending.push(Pending {
                item: item_index,
                file: file_index,
                source,
                local: folder.join(format!("{item_index}-{file_index}")),
            });
        }
    }
    pending
}

async fn stage_batch(
    batch: Vec<(PathBuf, PathBuf)>,
) -> Result<Vec<(ContentHash, u64)>, RoundError> {
    off_thread(move || {
        batch
            .iter()
            .map(|(source, local)| staged_copy(source, local).map_err(local_error))
            .collect()
    })
    .await
}

async fn upload_from<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    sources: &[Source],
    items: &mut [BackupItem],
    have: &mut Known,
    folder: &Path,
) -> Result<u64, RoundError> {
    let pending = pending_files(sources, items, have, folder);
    let sizes: Vec<u64> = pending
        .iter()
        .map(|entry| items[entry.item].files[entry.file].size)
        .collect();
    let mut claimed = BTreeSet::new();
    let mut uploaded = 0u64;
    for range in batches(&sizes) {
        let chunk: Vec<&Pending> = pending[range]
            .iter()
            .filter(|entry| {
                let hash = &items[entry.item].files[entry.file].hash;
                !have.contains_key(hash) && !claimed.contains(hash)
            })
            .collect();
        if chunk.is_empty() {
            continue;
        }
        let needed = chunk
            .iter()
            .map(|entry| items[entry.item].files[entry.file].size)
            .fold(0u64, u64::saturating_add);
        if !engine::room_for(folder, needed).await {
            return Err(RoundError::DiskFull);
        }
        let copies = stage_batch(
            chunk
                .iter()
                .map(|entry| (entry.source.clone(), entry.local.clone()))
                .collect(),
        )
        .await;
        let result = upload_chunk(store, run, items, have, &mut claimed, &chunk, copies).await;
        for entry in &chunk {
            let _ = tokio::fs::remove_file(&entry.local).await;
        }
        uploaded = uploaded.saturating_add(result?);
    }
    for file in items.iter_mut().flat_map(|item| item.files.iter_mut()) {
        file.rev = have.get(&file.hash).cloned();
    }
    Ok(uploaded)
}

async fn upload_chunk<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    items: &mut [BackupItem],
    have: &mut Known,
    claimed: &mut BTreeSet<String>,
    chunk: &[&Pending],
    copies: Result<Vec<(ContentHash, u64)>, RoundError>,
) -> Result<u64, RoundError> {
    let mut staged: Vec<&Pending> = Vec::with_capacity(chunk.len());
    for (entry, (hash, size)) in chunk.iter().copied().zip(copies?) {
        let file = &mut items[entry.item].files[entry.file];
        file.hash = hash.to_hex();
        file.size = size;
        if !have.contains_key(&file.hash) && claimed.insert(file.hash.clone()) {
            staged.push(entry);
        }
    }
    let batch: Vec<BatchFile> = staged
        .iter()
        .map(|entry| BatchFile {
            remote: blob_remote(run.device, &items[entry.item].files[entry.file].hash),
            local: entry.local.clone(),
        })
        .collect();
    let mut uploaded = 0u64;
    let results = store.put_paths(&batch, &|| {}).await;
    for (entry, result) in staged.iter().zip(results) {
        let done = result?;
        let file = &items[entry.item].files[entry.file];
        if done.hash.to_hex() != file.hash {
            return Err(StoreError::Verify(format!(
                "{} changed while it was backed up",
                file.path
            ))
            .into());
        }
        uploaded = uploaded.saturating_add(file.size);
        have.insert(file.hash.clone(), done.rev);
    }
    Ok(uploaded)
}

fn cache_path(cache: &Path, device: &str, id: &str) -> PathBuf {
    cache.join(device).join(format!("{id}.json"))
}

fn cached_set(cache: &Path, device: &str, id: &str) -> Option<BackupSet> {
    let bytes = std::fs::read(cache_path(cache, device, id)).ok()?;
    serde_json::from_slice::<BackupSet>(&bytes)
        .ok()
        .filter(|set| valid_set(set, device, id))
}

fn remember_set(cache: &Path, set: &BackupSet, bytes: &[u8]) {
    let path = cache_path(cache, &set.device, &set.id);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = crate::sandbox::atomic_write(&path, bytes);
}

pub(crate) async fn read_set<S: CloudStore>(
    store: &S,
    cache: &Path,
    device: &str,
    id: &str,
) -> Result<Option<BackupSet>, RoundError> {
    if !valid_device(device) || !valid_set_id(id) {
        return Ok(None);
    }
    let place = (cache.to_path_buf(), device.to_string(), id.to_string());
    let lookup = place.clone();
    if let Some(set) = off_thread(move || Ok(cached_set(&lookup.0, &lookup.1, &lookup.2))).await? {
        return Ok(Some(set));
    }
    let Some((bytes, _)) = store.get(&set_remote(device, id), MAX_SET_BYTES).await? else {
        return Ok(None);
    };
    off_thread(move || {
        let (cache, device, id) = place;
        let unreadable =
            || RoundError::Unreadable("a backup in the cloud could not be read".into());
        let set: BackupSet = serde_json::from_slice(&bytes).map_err(|_| unreadable())?;
        if set.v > FORMAT {
            return Err(RoundError::NewerVersion);
        }
        if !valid_set(&set, &device, &id) {
            return Err(unreadable());
        }
        remember_set(&cache, &set, &bytes);
        Ok(Some(set))
    })
    .await
}

async fn set_ids<S: CloudStore>(store: &S, device: &str) -> Result<Vec<String>, RoundError> {
    let mut ids: Vec<String> = store
        .list(&sets_dir(device))
        .await?
        .into_iter()
        .filter(|entry| !entry.folder)
        .filter_map(|entry| entry.name.strip_suffix(".json").map(str::to_string))
        .filter(|id| valid_set_id(id))
        .collect();
    ids.sort();
    Ok(ids)
}

async fn read_sets<S: CloudStore>(
    store: &S,
    cache: &Path,
    device: &str,
    ids: &[String],
) -> Result<Vec<BackupSet>, RoundError> {
    let read: Vec<Result<Option<BackupSet>, RoundError>> = stream::iter(ids.iter().cloned())
        .map(|id| async move { read_set(store, cache, device, &id).await })
        .buffered(FETCH_CONCURRENCY)
        .collect()
        .await;
    let mut sets = Vec::with_capacity(read.len());
    for set in read {
        if let Some(set) = set? {
            sets.push(set);
        }
    }
    Ok(sets)
}

async fn prune<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    sets: &[BackupSet],
    newest: &BackupSet,
) -> Result<Vec<String>, RoundError> {
    let keep = usize::try_from(run.keep.max(1)).unwrap_or(usize::MAX);
    let mut ordered: Vec<&BackupSet> = sets.iter().filter(|set| set.id != newest.id).collect();
    ordered.sort_by(|left, right| left.id.cmp(&right.id));
    ordered.push(newest);
    if ordered.len() <= keep {
        return Ok(Vec::new());
    }
    let (expired, kept) = ordered.split_at(ordered.len() - keep);
    let referenced = pairs(kept);
    let unused: Vec<(String, String)> = pairs(expired)
        .into_iter()
        .filter(|pair| !referenced.contains(pair))
        .collect();
    let removals: Vec<BatchDelete> = expired
        .iter()
        .map(|set| BatchDelete {
            remote: set_remote(run.device, &set.id),
            parent_rev: None,
        })
        .collect();
    for (set, result) in expired.iter().zip(store.delete_paths(&removals).await) {
        result?;
        let _ = tokio::fs::remove_file(cache_path(run.cache, run.device, &set.id)).await;
    }
    let blobs: Vec<BatchDelete> = unused
        .into_iter()
        .map(|(hash, rev)| BatchDelete {
            remote: blob_remote(run.device, &hash),
            parent_rev: Some(rev),
        })
        .collect();
    for result in store.delete_paths(&blobs).await {
        match result {
            Ok(()) | Err(StoreError::Conflict) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(expired.iter().map(|set| set.id.clone()).collect())
}

pub(crate) async fn back_up<S: CloudStore>(
    store: &S,
    run: &Run<'_>,
    sources: &[Source],
) -> Result<BackupOutcome, RoundError> {
    let owned = sources.to_vec();
    let Captured {
        mut items,
        sources: kept_sources,
        skipped,
    } = off_thread(move || Ok(capture_all(owned))).await?;
    let ids = set_ids(store, run.device).await?;
    let earlier = read_sets(store, run.cache, run.device, &ids).await?;
    let listed = listed_blobs(store, run.device).await?;
    let mut have = known_revs(&earlier, &hashes_of(&listed));
    let uploaded_bytes = upload_missing(store, run, &kept_sources, &mut items, &mut have).await?;
    let set = BackupSet {
        v: FORMAT,
        id: set_id(run.now_ms, rand::random()),
        device: run.device.to_string(),
        device_name: run.device_name.to_string(),
        created_ms: run.now_ms,
        scheduled: run.scheduled,
        items,
        extra: serde_json::Map::new(),
    };
    let (set, bytes) = off_thread(move || {
        let bytes = serde_json::to_vec(&set).map_err(local_error)?;
        Ok((set, bytes))
    })
    .await?;
    if bytes.len() > MAX_SET_BYTES {
        return Err(RoundError::TooManyFiles);
    }
    store
        .put(
            &set_remote(run.device, &set.id),
            bytes.clone(),
            WriteMode::Add,
        )
        .await?;
    let cache = run.cache.to_path_buf();
    let set = off_thread(move || {
        remember_set(&cache, &set, &bytes);
        Ok(set)
    })
    .await?;
    let expired = prune(store, run, &earlier, &set).await?;
    let gone = hashes_in(earlier.iter().filter(|old| expired.contains(&old.id)));
    let mut used = hashes_in(earlier.iter().filter(|old| !expired.contains(&old.id)));
    used.extend(hashes_in([&set]));
    used.extend(gone);
    let (removed_files, leftovers) = sweep(store, run, &listed, &used).await;
    Ok(BackupOutcome {
        id: set.id.clone(),
        notes: set
            .items
            .iter()
            .filter(|item| item.kind == ItemKind::Note)
            .count(),
        projects: set
            .items
            .iter()
            .filter(|item| item.kind == ItemKind::Project)
            .count(),
        bytes: set.items.iter().map(BackupItem::bytes).sum(),
        uploaded_bytes,
        skipped,
        removed_sets: expired.len(),
        removed_files,
        leftovers,
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupSummary {
    pub(crate) id: String,
    pub(crate) device: String,
    pub(crate) device_name: String,
    pub(crate) this_device: bool,
    pub(crate) created_ms: u64,
    pub(crate) scheduled: bool,
    pub(crate) notes: usize,
    pub(crate) projects: usize,
    pub(crate) bytes: u64,
}

fn summary(set: &BackupSet, this_device: &str) -> BackupSummary {
    BackupSummary {
        id: set.id.clone(),
        device: set.device.clone(),
        device_name: set.device_name.clone(),
        this_device: set.device == this_device,
        created_ms: set.created_ms,
        scheduled: set.scheduled,
        notes: set
            .items
            .iter()
            .filter(|item| item.kind == ItemKind::Note)
            .count(),
        projects: set
            .items
            .iter()
            .filter(|item| item.kind == ItemKind::Project)
            .count(),
        bytes: set.items.iter().map(BackupItem::bytes).sum(),
    }
}

pub(crate) async fn list_backups<S: CloudStore>(
    store: &S,
    cache: &Path,
    this_device: &str,
) -> Result<Vec<BackupSummary>, RoundError> {
    let devices: Vec<String> = store
        .list(ROOT)
        .await?
        .into_iter()
        .filter(|entry| entry.folder && valid_device(&entry.name))
        .map(|entry| entry.name)
        .collect();
    let mut found = Vec::new();
    for device in devices {
        let mut ids = set_ids(store, &device).await?;
        if ids.len() > MAX_SETS_LISTED {
            ids.drain(..ids.len() - MAX_SETS_LISTED);
        }
        for set in read_sets(store, cache, &device, &ids).await? {
            found.push(summary(&set, this_device));
        }
    }
    found.sort_by(|left, right| {
        right
            .created_ms
            .cmp(&left.created_ms)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(found)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupEntry {
    pub(crate) id: String,
    pub(crate) kind: ItemKind,
    pub(crate) name: String,
    pub(crate) files: usize,
    pub(crate) bytes: u64,
    pub(crate) here: bool,
}

pub(crate) fn entries(set: &BackupSet, library: &Library) -> Vec<BackupEntry> {
    let mut entries: Vec<BackupEntry> = set
        .items
        .iter()
        .map(|item| BackupEntry {
            id: item.id.clone(),
            kind: item.kind,
            name: item.name.clone(),
            files: item.files.len(),
            bytes: item.bytes(),
            here: library.has(item),
        })
        .collect();
    entries.sort_by(|left, right| {
        (left.kind == ItemKind::Project)
            .cmp(&(right.kind == ItemKind::Project))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    entries
}

pub(crate) fn copy_label(label: &str) -> Option<String> {
    let label = label.trim();
    (!label.is_empty()
        && label.chars().count() <= MAX_COPY_LABEL
        && !label.chars().any(char::is_control))
    .then(|| label.to_string())
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

pub(crate) fn renamed_note(text: &str, title: &str, note_id: &str) -> String {
    let Some(front) = oleafly_core::front_matter::split(text) else {
        return text.to_string();
    };
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let (lines, body) = front.into_parts();
    let mut saw_id = false;
    let mut saw_title = false;
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 2);
    for line in lines {
        if line.starts_with("id:") {
            saw_id = true;
            out.push(format!("id: {note_id}"));
        } else if line.starts_with("title:") {
            saw_title = true;
            out.push(format!("title: {}", yaml_string(title)));
        } else {
            out.push(line.to_string());
        }
    }
    if !saw_title {
        out.insert(0, format!("title: {}", yaml_string(title)));
    }
    if !saw_id {
        out.push(format!("id: {note_id}"));
    }
    let bom = if text.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    format!(
        "{bom}---{newline}{}{newline}---{newline}{body}",
        out.join(newline)
    )
}

pub(crate) fn renamed_meta(bytes: &[u8], name: &str) -> Option<Vec<u8>> {
    let mut meta: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    meta.as_object_mut()?
        .insert("name".into(), serde_json::Value::String(name.to_string()));
    serde_json::to_vec_pretty(&meta).ok()
}

pub(crate) async fn fetch_item<S: CloudStore>(
    store: &S,
    device: &str,
    item: &BackupItem,
    target: &Path,
    temp: &Path,
) -> Result<(), RoundError> {
    tokio::fs::create_dir_all(temp).await.map_err(local_error)?;
    for (index, file) in item.files.iter().enumerate() {
        let staged = temp.join(format!("{index}"));
        let remote = blob_remote(device, &file.hash);
        let limit = file.size.saturating_add(1);
        let mut fetched = match file.rev.as_deref() {
            Some(rev) => store
                .fetch_to(&remote, Some(rev), &staged, limit)
                .await
                .ok()
                .flatten(),
            None => None,
        };
        if fetched
            .as_ref()
            .is_none_or(|got| got.hash.to_hex() != file.hash)
        {
            let _ = tokio::fs::remove_file(&staged).await;
            fetched = store.fetch_to(&remote, None, &staged, limit).await?;
        }
        let fetched = fetched.ok_or_else(|| {
            StoreError::Verify(format!("{} is missing from the backup", file.path))
        })?;
        if fetched.hash.to_hex() != file.hash || fetched.size != file.size {
            let _ = tokio::fs::remove_file(&staged).await;
            return Err(
                StoreError::Verify(format!("{} didn't match the backup", file.path)).into(),
            );
        }
        let (root, portable, exec) = (target.to_path_buf(), file.path.clone(), file.exec);
        off_thread(move || place(&root, &portable, &staged, exec)).await?;
    }
    Ok(())
}

fn place(root: &Path, portable: &str, staged: &Path, exec: bool) -> Result<(), RoundError> {
    let Some(path) = engine::resolve_target(root, portable) else {
        let _ = std::fs::remove_file(staged);
        return Err(RoundError::Unreadable(format!(
            "{portable} has an unsafe path"
        )));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(local_error)?;
    }
    std::fs::rename(staged, &path)
        .or_else(|_| {
            std::fs::copy(staged, &path)
                .map(|_| ())
                .and_then(|()| std::fs::remove_file(staged))
        })
        .map_err(local_error)?;
    engine::apply_exec(&path, portable, exec);
    Ok(())
}

pub(crate) fn rename_copy(
    target: &Path,
    item: &BackupItem,
    name: &str,
    note_id: &str,
) -> Result<(), RoundError> {
    let meta_path = target.join(PROJECT_META);
    if let Ok(bytes) = std::fs::read(&meta_path) {
        if let Some(renamed) = renamed_meta(&bytes, name) {
            crate::sandbox::atomic_write(&meta_path, &renamed).map_err(local_error)?;
        }
    }
    if item.kind != ItemKind::Note {
        return Ok(());
    }
    let note = target.join(crate::project::NOTE_FILE);
    if let Ok(text) = std::fs::read_to_string(&note) {
        crate::sandbox::atomic_write(&note, renamed_note(&text, name, note_id).as_bytes())
            .map_err(local_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::tests::memory::MemoryStore;

    struct Bench {
        dir: tempfile::TempDir,
        store: MemoryStore,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
                store: MemoryStore::default(),
            }
        }

        fn note(&self, id: &str, body: &str) -> Source {
            let root = self.dir.path().join("projects").join(id);
            std::fs::create_dir_all(root.join("assets")).unwrap();
            std::fs::write(
                root.join(PROJECT_META),
                format!("{{\"name\":\"{id}\",\"kind\":\"note\",\"main_doc\":\"note.md\"}}"),
            )
            .unwrap();
            std::fs::write(root.join("note.md"), body).unwrap();
            std::fs::write(root.join("assets/plot.svg"), "<svg/>").unwrap();
            Source {
                id: id.to_string(),
                kind: ItemKind::Note,
                name: id.to_string(),
                link: None,
                project: None,
                root,
            }
        }

        fn run(&self, device: &str, keep: u32, now_ms: u64) -> Run<'_> {
            let staging = self.dir.path().join("staging");
            std::fs::create_dir_all(&staging).unwrap();
            let staging: &'static Path = Box::leak(staging.into_boxed_path());
            let cache: &'static Path = Box::leak(self.dir.path().join("cache").into_boxed_path());
            Run {
                device: Box::leak(device.to_string().into_boxed_str()),
                device_name: "Laptop",
                staging,
                cache,
                keep,
                scheduled: true,
                now_ms,
                leftovers: Box::leak(Box::new(BTreeSet::new())),
            }
        }

        fn blobs(&self, device: &str) -> usize {
            futures_executor(listed_blobs(&self.store, device))
                .unwrap()
                .len()
        }
    }

    fn futures_executor<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn a_second_backup_of_unchanged_notes_uploads_nothing_new() {
        let bench = Bench::new();
        let notes = [
            bench.note("ideas", "# Ideas\n"),
            bench.note("plan", "# Plan\n"),
        ];
        let first = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 1_000),
            &notes,
        ))
        .unwrap();
        assert_eq!((first.notes, first.projects), (2, 0));
        assert!(first.uploaded_bytes > 0);
        let blobs = bench.blobs("dev-a");
        let second = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 2_000),
            &notes,
        ))
        .unwrap();
        assert_eq!(second.uploaded_bytes, 0);
        assert_eq!(bench.blobs("dev-a"), blobs);
        std::fs::write(notes[0].root.join("note.md"), "# Ideas\nmore\n").unwrap();
        let third = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 3_000),
            &notes,
        ))
        .unwrap();
        assert_eq!(third.uploaded_bytes, "# Ideas\nmore\n".len() as u64);
        assert_eq!(bench.blobs("dev-a"), blobs + 1);
    }

    #[test]
    fn staging_goes_in_batches_bounded_by_count_and_bytes() {
        assert_eq!(batches(&[]), Vec::<std::ops::Range<usize>>::new());
        assert_eq!(batches(&[1; 40]), [0..32, 32..40]);
        let big = UPLOAD_BATCH_BYTES;
        assert_eq!(batches(&[big + 1, 1, 1]), [0..1, 1..3]);
        assert_eq!(batches(&[big / 2, big / 2, 1]), [0..2, 2..3]);
        assert_eq!(batches(&[1, big, 1]), [0..1, 1..2, 2..3]);
    }

    #[test]
    fn a_backup_with_more_files_than_one_batch_uploads_them_all_and_cleans_up() {
        let bench = Bench::new();
        let mut note = bench.note("ideas", "# Ideas\n");
        for index in 0..(UPLOAD_BATCH + 8) {
            std::fs::write(
                note.root.join("assets").join(format!("part-{index}.txt")),
                format!("part {index}"),
            )
            .unwrap();
        }
        std::fs::write(note.root.join("assets/copy-a.txt"), "same").unwrap();
        std::fs::write(note.root.join("assets/copy-b.txt"), "same").unwrap();
        note.link = Some("link-1".into());
        note.project = Some("0192a0b0-0000-7000-8000-000000000001".into());
        let run = bench.run("dev-a", 30, 1_000);
        let outcome =
            futures_executor(back_up(&bench.store, &run, std::slice::from_ref(&note))).unwrap();
        let set = futures_executor(read_set(&bench.store, run.cache, "dev-a", &outcome.id))
            .unwrap()
            .unwrap();
        let item = &set.items[0];
        assert_eq!(item.link.as_deref(), Some("link-1"));
        assert_eq!(
            item.project.as_deref(),
            Some("0192a0b0-0000-7000-8000-000000000001")
        );
        assert_eq!(item.files.len(), UPLOAD_BATCH + 8 + 5);
        for file in &item.files {
            assert!(file.rev.is_some(), "{}", file.path);
            assert!(bench
                .store
                .read(&blob_remote("dev-a", &file.hash))
                .is_some());
        }
        assert_eq!(bench.blobs("dev-a"), UPLOAD_BATCH + 8 + 4);
        assert_eq!(std::fs::read_dir(run.staging).unwrap().count(), 0);
    }

    #[test]
    fn a_backed_up_item_is_here_by_its_link_or_project_identity_not_only_its_folder() {
        let item = |id: &str, link: Option<&str>, project: Option<&str>| BackupItem {
            id: id.into(),
            kind: ItemKind::Note,
            name: "Ideas".into(),
            link: link.map(str::to_string),
            project: project.map(str::to_string),
            files: Vec::new(),
        };
        let library = Library {
            folders: BTreeSet::from(["brave-blue-otter".to_string()]),
            projects: BTreeSet::from(["p-1".to_string()]),
            links: BTreeSet::from(["n-1".to_string()]),
        };
        assert!(library.has(&item("brave-blue-otter", None, None)));
        assert!(library.has(&item("far-away-fox", Some("n-1"), None)));
        assert!(library.has(&item("far-away-fox", None, Some("p-1"))));
        assert!(!library.has(&item("far-away-fox", Some("n-2"), Some("p-2"))));
        let set = BackupSet {
            v: FORMAT,
            id: set_id(1, 1),
            device: "dev-b".into(),
            device_name: "Desk".into(),
            created_ms: 1,
            scheduled: true,
            items: vec![item("far-away-fox", Some("n-1"), None)],
            extra: serde_json::Map::new(),
        };
        assert!(entries(&set, &library)[0].here);
        let old: BackupItem = serde_json::from_value(serde_json::json!({
            "id": "brave-blue-otter", "kind": "note", "name": "Ideas", "files": []
        }))
        .unwrap();
        assert_eq!((old.link, old.project), (None, None));
    }

    #[test]
    fn retention_drops_the_oldest_backups_and_the_files_only_they_used() {
        let bench = Bench::new();
        let note = bench.note("ideas", "v1");
        for (step, body) in ["v1", "v2", "v3"].iter().enumerate() {
            std::fs::write(note.root.join("note.md"), body).unwrap();
            let at = 1_000 * (step as u64 + 1);
            futures_executor(back_up(
                &bench.store,
                &bench.run("dev-a", 2, at),
                std::slice::from_ref(&note),
            ))
            .unwrap();
        }
        let ids = futures_executor(set_ids(&bench.store, "dev-a")).unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.iter().all(|id| !id.starts_with("0000000001000")));
        let left = hashes_of(&futures_executor(listed_blobs(&bench.store, "dev-a")).unwrap());
        assert_eq!(left.len(), 4);
        assert!(!left.contains(&ContentHash::digest(b"v1").to_hex()));
        assert!(left.contains(&ContentHash::digest(b"v2").to_hex()));
    }

    #[test]
    fn a_file_no_backup_uses_is_removed_only_on_the_second_run_that_finds_it() {
        let bench = Bench::new();
        let note = bench.note("ideas", "kept");
        let stray = ContentHash::digest(b"left by a failed run").to_hex();
        bench.store.with(|inner| {
            inner.write(
                &blob_remote("dev-a", &stray),
                b"left by a failed run".to_vec(),
            );
        });
        let first = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 1_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        assert_eq!(first.removed_files, 0);
        assert_eq!(first.leftovers, BTreeSet::from([stray.clone()]));
        assert!(bench.store.read(&blob_remote("dev-a", &stray)).is_some());

        let mut second_run = bench.run("dev-a", 30, 2_000);
        second_run.leftovers = &first.leftovers;
        let second = futures_executor(back_up(
            &bench.store,
            &second_run,
            std::slice::from_ref(&note),
        ))
        .unwrap();
        assert_eq!(second.removed_files, 1);
        assert!(second.leftovers.is_empty());
        assert!(bench.store.read(&blob_remote("dev-a", &stray)).is_none());
        let cache = bench.dir.path().join("cache");
        let set = futures_executor(read_set(&bench.store, &cache, "dev-a", &second.id))
            .unwrap()
            .unwrap();
        for file in &set.items[0].files {
            assert!(
                bench
                    .store
                    .read(&blob_remote("dev-a", &file.hash))
                    .is_some(),
                "{}",
                file.path
            );
        }
    }

    #[test]
    fn a_leftover_that_a_backup_starts_using_again_is_kept() {
        let bench = Bench::new();
        let note = bench.note("ideas", "first");
        let reused = ContentHash::digest(b"second").to_hex();
        bench.store.with(|inner| {
            inner.write(&blob_remote("dev-a", &reused), b"second".to_vec());
        });
        let first = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 1_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        assert!(first.leftovers.contains(&reused));
        std::fs::write(note.root.join("note.md"), "second").unwrap();
        let mut second_run = bench.run("dev-a", 30, 2_000);
        second_run.leftovers = &first.leftovers;
        let second = futures_executor(back_up(
            &bench.store,
            &second_run,
            std::slice::from_ref(&note),
        ))
        .unwrap();
        assert_eq!(second.removed_files, 0);
        assert!(bench.store.read(&blob_remote("dev-a", &reused)).is_some());
    }

    #[test]
    fn every_computer_keeps_its_own_backups_and_the_list_is_newest_first() {
        let bench = Bench::new();
        let note = bench.note("ideas", "hello");
        futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 5_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        futures_executor(back_up(
            &bench.store,
            &bench.run("dev-b", 30, 9_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        let cache = bench.dir.path().join("fresh-cache");
        let listed = futures_executor(list_backups(&bench.store, &cache, "dev-a")).unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|entry| entry.device.as_str())
                .collect::<Vec<_>>(),
            ["dev-b", "dev-a"]
        );
        assert_eq!(
            listed
                .iter()
                .map(|entry| entry.this_device)
                .collect::<Vec<_>>(),
            [false, true]
        );
        assert_eq!(listed[0].notes, 1);
        assert!(listed[0].bytes > 0);
    }

    #[test]
    fn a_restored_note_has_the_bytes_that_were_backed_up() {
        let bench = Bench::new();
        let note = bench.note("ideas", "---\nid: abc\n---\n\nKeep me\n");
        let outcome = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 1_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        let cache = bench.dir.path().join("cache");
        let set = futures_executor(read_set(&bench.store, &cache, "dev-a", &outcome.id))
            .unwrap()
            .unwrap();
        let target = bench.dir.path().join("restored");
        std::fs::create_dir_all(&target).unwrap();
        futures_executor(fetch_item(
            &bench.store,
            "dev-a",
            &set.items[0],
            &target,
            &bench.dir.path().join("t"),
        ))
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("note.md")).unwrap(),
            "---\nid: abc\n---\n\nKeep me\n"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("assets/plot.svg")).unwrap(),
            "<svg/>"
        );
        assert!(target.join(PROJECT_META).is_file());
    }

    #[test]
    fn a_damaged_backup_file_is_refused_on_restore() {
        let bench = Bench::new();
        let note = bench.note("ideas", "original");
        let outcome = futures_executor(back_up(
            &bench.store,
            &bench.run("dev-a", 30, 1_000),
            std::slice::from_ref(&note),
        ))
        .unwrap();
        let cache = bench.dir.path().join("cache");
        let set = futures_executor(read_set(&bench.store, &cache, "dev-a", &outcome.id))
            .unwrap()
            .unwrap();
        let note_file = set.items[0]
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap();
        let rev = note_file.rev.clone().unwrap();
        bench.store.with(|inner| {
            inner.history.insert(rev, b"tampered".to_vec());
        });
        bench
            .store
            .overwrite(&blob_remote("dev-a", &note_file.hash), b"tampered");
        let target = bench.dir.path().join("restored");
        std::fs::create_dir_all(&target).unwrap();
        let result = futures_executor(fetch_item(
            &bench.store,
            "dev-a",
            &set.items[0],
            &target,
            &bench.dir.path().join("t"),
        ));
        assert!(matches!(
            result,
            Err(RoundError::Store(StoreError::Verify(_)))
        ));
        assert!(!target.join("note.md").exists());
    }

    #[test]
    fn a_backup_naming_a_path_outside_the_note_is_rejected() {
        let bench = Bench::new();
        let bad = serde_json::json!({
            "v": 1, "id": "0000000001000-0000abcd", "device": "dev-a", "device_name": "Laptop",
            "created_ms": 1000, "scheduled": true,
            "items": [{"id": "ideas", "kind": "note", "name": "Ideas", "files": [
                {"path": "../../escape.txt", "hash": ContentHash::digest_file(bench.note("x", "y").root.join("note.md")).unwrap().to_hex(), "size": 1}
            ]}]
        });
        bench.store.with(|inner| {
            inner.write(
                &set_remote("dev-a", "0000000001000-0000abcd"),
                serde_json::to_vec(&bad).unwrap(),
            );
        });
        let read = futures_executor(read_set(
            &bench.store,
            &bench.dir.path().join("c"),
            "dev-a",
            "0000000001000-0000abcd",
        ));
        assert!(matches!(read, Err(RoundError::Unreadable(_))));
        assert!(futures_executor(read_set(
            &bench.store,
            &bench.dir.path().join("c"),
            "../x",
            "0000000001000-0000abcd"
        ))
        .unwrap()
        .is_none());
    }

    async fn round_trip<S: CloudStore>(store: &S, bench: &Bench) {
        let note = bench.note("ideas", "---\nid: abc\n---\n\nOn every provider\n");
        let first = back_up(
            store,
            &bench.run("dev-a", 2, 1_000),
            std::slice::from_ref(&note),
        )
        .await
        .unwrap();
        let second = back_up(
            store,
            &bench.run("dev-a", 2, 2_000),
            std::slice::from_ref(&note),
        )
        .await
        .unwrap();
        assert_eq!(second.uploaded_bytes, 0);
        std::fs::write(note.root.join("note.md"), "changed").unwrap();
        back_up(
            store,
            &bench.run("dev-a", 2, 3_000),
            std::slice::from_ref(&note),
        )
        .await
        .unwrap();
        let cache = bench.dir.path().join(format!("list-{}", store.label()));
        let listed = list_backups(store, &cache, "dev-a").await.unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|entry| entry.created_ms)
                .collect::<Vec<_>>(),
            [3_000, 2_000]
        );
        assert!(listed.iter().all(|entry| entry.id != first.id));
        let set = read_set(store, &cache, "dev-a", &second.id)
            .await
            .unwrap()
            .unwrap();
        let target = bench.dir.path().join(format!("restored-{}", store.label()));
        std::fs::create_dir_all(&target).unwrap();
        fetch_item(
            store,
            "dev-a",
            &set.items[0],
            &target,
            &bench.dir.path().join("t"),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("note.md")).unwrap(),
            "---\nid: abc\n---\n\nOn every provider\n"
        );
    }

    #[tokio::test]
    async fn backups_round_trip_through_s3_compatible_storage() {
        let fake = crate::cloud::tests::fake_s3::FakeS3::start().await;
        round_trip(&fake.store("oleafly"), &Bench::new()).await;
    }

    #[tokio::test]
    async fn backups_round_trip_through_google_drive() {
        let fake = crate::cloud::tests::fake_drive::FakeDrive::start().await;
        round_trip(&fake.store(), &Bench::new()).await;
    }

    #[test]
    fn a_restored_copy_gets_its_own_title_and_link_id() {
        let text = "---\ntitle: Ideas\nkind: note\nid: 1111\ntags: [a]\n---\n\nBody: here\n";
        assert_eq!(
            renamed_note(text, "Ideas (restored Nov 11)", "2222"),
            "---\ntitle: \"Ideas (restored Nov 11)\"\nkind: note\nid: 2222\ntags: [a]\n---\n\nBody: here\n"
        );
        assert_eq!(
            renamed_note("---\r\nkind: note\r\n---\r\nx", "A: B", "9"),
            "---\r\ntitle: \"A: B\"\r\nkind: note\r\nid: 9\r\n---\r\nx"
        );
        assert_eq!(renamed_note("no front matter", "T", "1"), "no front matter");
        let meta = renamed_meta(br#"{"name":"Ideas","kind":"note"}"#, "Ideas (restored)").unwrap();
        let meta: serde_json::Value = serde_json::from_slice(&meta).unwrap();
        assert_eq!(meta["name"], "Ideas (restored)");
        assert_eq!(meta["kind"], "note");
    }

    #[test]
    fn settings_stay_within_the_offered_choices_and_say_when_a_backup_is_due() {
        let odd = BackupSettings {
            auto: true,
            every_hours: 5,
            keep: 3,
            include_projects: true,
        }
        .normalized();
        assert_eq!(
            (odd.every_hours, odd.keep, odd.include_projects),
            (24, 30, true)
        );
        let day = 24 * 60 * 60 * 1000;
        assert!(odd.due(None, 0));
        assert!(!odd.due(Some(10), 10 + day - 1));
        assert!(odd.due(Some(10), 10 + day));
        assert!(!BackupSettings { auto: false, ..odd }.due(None, 0));
    }

    #[test]
    fn ids_and_labels_are_checked_before_they_reach_a_path() {
        assert!(valid_set_id(&set_id(1_731_312_000_000, 0xabcdef01)));
        assert!(!valid_set_id("1731312000000-ABCDEF01"));
        assert!(!valid_set_id("../1731312000000-abcdef01"));
        assert!(valid_device("3f2a6c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6"));
        assert!(!valid_device("a/b"));
        assert_eq!(
            copy_label("  (restored Nov 11) "),
            Some("(restored Nov 11)".to_string())
        );
        assert_eq!(copy_label(""), None);
        assert_eq!(copy_label("a\nb"), None);
    }
}
