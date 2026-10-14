use super::store::{CloudStore, StoreError};
use oleafly_core::content::ContentHash;
use oleafly_core::exclude::{decide, Decision, EntryInfo, EntryKind, PolicyFields};
use oleafly_core::hlc::{Hlc, HlcClock, Stamp};
use oleafly_core::ids::{DeviceId, ProjectId};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILES: usize = 100_000;
const MAX_VERSION_BYTES: usize = 16 * 1024 * 1024;

pub(crate) type EngineResult<T> = std::result::Result<T, StoreError>;

fn io_error(error: impl std::fmt::Display) -> StoreError {
    StoreError::Io(error.to_string())
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct FileRecord {
    pub(crate) path: String,
    pub(crate) hash: String,
    pub(crate) size: u64,
    #[serde(default)]
    pub(crate) exec: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct VersionManifest {
    pub(crate) v: u32,
    pub(crate) project: ProjectId,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) manifest: serde_json::Value,
    pub(crate) stamp: Stamp,
    pub(crate) files: Vec<FileRecord>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ProjectState {
    pub(crate) cloud: Option<ProjectId>,
    #[serde(default)]
    pub(crate) paused: bool,
    #[serde(default)]
    pub(crate) base: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) base_stamp: u64,
    #[serde(default)]
    pub(crate) last_synced_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct EngineState {
    #[serde(default)]
    pub(crate) hlc: u64,
    #[serde(default)]
    pub(crate) projects: BTreeMap<String, ProjectState>,
    #[serde(default)]
    pub(crate) settings_stamp: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct SyncOutcome {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
    pub(crate) deleted_remote: usize,
    pub(crate) deleted_local: usize,
    pub(crate) conflicts: usize,
}

struct Captured {
    record: FileRecord,
    absolute: PathBuf,
}

fn state_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?
        .join("cloud")
        .join("state.json"))
}

pub(crate) fn read_state() -> Result<EngineState, String> {
    read_state_at(&state_path()?)
}

pub(crate) fn read_state_at(path: &Path) -> Result<EngineState, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 64 * 1024 * 1024 {
                return Err("cloud sync state is too large".into());
            }
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(EngineState::default()),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn write_state(state: &EngineState) -> Result<(), String> {
    write_state_at(&state_path()?, state)
}

pub(crate) fn write_state_at(path: &Path, state: &EngineState) -> Result<(), String> {
    let parent = path.parent().ok_or("cloud sync state path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(path, &bytes)
}

fn manifest_fields(root: &Path) -> (oleafly_core::ProjectManifest, serde_json::Value, String) {
    let raw = std::fs::read(root.join("project.json"))
        .ok()
        .filter(|bytes| bytes.len() as u64 <= oleafly_core::MAX_MANIFEST_BYTES);
    let value: serde_json::Value = raw
        .as_deref()
        .and_then(|bytes| serde_json::from_slice(bytes).ok())
        .unwrap_or_default();
    let manifest = raw
        .as_deref()
        .and_then(oleafly_core::sniff_oleafly_manifest)
        .unwrap_or_default();
    let name = value
        .get("name")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_default()
        .to_string();
    (manifest, value, name)
}

fn capture(root: &Path) -> EngineResult<Vec<Captured>> {
    let (manifest, _value, _name) = manifest_fields(root);
    let fields = PolicyFields {
        compile_dir: manifest.compile_dir.as_deref(),
        main_doc: &manifest.main_doc,
        sync_include: &manifest.sync_include,
        sync_exclude: &manifest.sync_exclude,
    };
    let mut out = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let read = std::fs::read_dir(&directory).map_err(io_error)?;
        let mut children: Vec<_> = read
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(io_error)?;
        children.sort_by_key(std::fs::DirEntry::file_name);
        for entry in children {
            let file_type = entry.file_type().map_err(io_error)?;
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(io_error)?;
            let kind = if file_type.is_symlink() {
                EntryKind::Symlink
            } else if file_type.is_dir() {
                EntryKind::Directory
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let metadata = entry.metadata().map_err(io_error)?;
            let info = EntryInfo {
                kind,
                len: metadata.len(),
                placeholder: oleafly_core::is_cloud_placeholder(&metadata),
                git_tracked: false,
                git_pointer_inside: None,
            };
            if decide(relative, &info, &fields) != Decision::Include {
                continue;
            }
            if kind == EntryKind::Directory {
                pending.push(path);
                continue;
            }
            let Some(portable) = portable_path(relative) else {
                continue;
            };
            let hash = ContentHash::digest_file(&path).map_err(io_error)?;
            out.push(Captured {
                record: FileRecord {
                    path: portable,
                    hash: hash.to_hex(),
                    size: metadata.len(),
                    exec: is_executable(&metadata),
                },
                absolute: path,
            });
            if out.len() > MAX_FILES {
                return Err(StoreError::Io("project has too many files to sync".into()));
            }
        }
    }
    out.sort_by(|left, right| left.record.path.cmp(&right.record.path));
    Ok(out)
}

fn portable_path(relative: &Path) -> Option<String> {
    let mut portable = String::new();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if !portable.is_empty() {
            portable.push('/');
        }
        portable.push_str(part);
    }
    (!portable.is_empty()).then_some(portable)
}

fn safe_local_path(root: &Path, portable: &str) -> Option<PathBuf> {
    if portable.is_empty() || portable.starts_with('/') || portable.contains('\\') {
        return None;
    }
    let mut path = root.to_path_buf();
    for part in portable.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        path.push(part);
    }
    Some(path)
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn apply_exec(path: &Path, exec: bool) {
    use std::os::unix::fs::PermissionsExt as _;
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        let mode = permissions.mode();
        permissions.set_mode(if exec { mode | 0o755 } else { mode & !0o111 });
        let _ = std::fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn apply_exec(_path: &Path, _exec: bool) {}

fn project_remote(cloud: ProjectId) -> String {
    format!("/projects/{cloud}")
}

fn version_remote(cloud: ProjectId) -> String {
    format!("{}/version.json", project_remote(cloud))
}

fn file_remote(cloud: ProjectId, portable: &str) -> String {
    format!("{}/files/{portable}", project_remote(cloud))
}

async fn fetch_version<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
) -> EngineResult<Option<VersionManifest>> {
    let Some(bytes) = store.get(&version_remote(cloud)).await? else {
        return Ok(None);
    };
    if bytes.len() > MAX_VERSION_BYTES {
        return Err(StoreError::Server(
            "remote version record is too large".into(),
        ));
    }
    let version: VersionManifest =
        serde_json::from_slice(&bytes).map_err(|error| StoreError::Server(error.to_string()))?;
    if version.project != cloud {
        return Err(StoreError::Server(
            "remote version record names another project".into(),
        ));
    }
    Ok(Some(version))
}

fn conflict_name(portable: &str, device_name: &str, date: &str) -> String {
    let (directory, name) = match portable.rsplit_once('/') {
        Some((directory, name)) => (Some(directory), name),
        None => (None, portable),
    };
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    };
    let conflict = match extension {
        Some(extension) => format!("{stem} ({device_name} {date}).{extension}"),
        None => format!("{stem} ({device_name} {date})"),
    };
    match directory {
        Some(directory) => format!("{directory}/{conflict}"),
        None => conflict,
    }
}

pub(crate) struct SyncContext {
    pub(crate) device: DeviceId,
    pub(crate) device_name: String,
    pub(crate) account_id: String,
}

pub(crate) async fn sync_project_at<S: CloudStore>(
    store: &S,
    state: &mut EngineState,
    context: &SyncContext,
    local_id: &str,
    root: &Path,
    cloud: ProjectId,
) -> EngineResult<SyncOutcome> {
    let local_files = capture(root)?;
    let local_map: BTreeMap<&str, &Captured> = local_files
        .iter()
        .map(|file| (file.record.path.as_str(), file))
        .collect();
    let remote = fetch_version(store, cloud).await?;
    let remote_map: BTreeMap<&str, &FileRecord> = remote
        .as_ref()
        .map(|version| {
            version
                .files
                .iter()
                .map(|file| (file.path.as_str(), file))
                .collect()
        })
        .unwrap_or_default();
    let project_state = state.projects.get(local_id).cloned().unwrap_or_default();
    let base = &project_state.base;

    let mut paths: BTreeSet<&str> = BTreeSet::new();
    paths.extend(local_map.keys().copied());
    paths.extend(remote_map.keys().copied());
    paths.extend(base.keys().map(String::as_str));

    let mut outcome = SyncOutcome::default();
    let date = crate::project_ids::rfc3339_from_unix_ms(now_ms());
    let date = &date[..10];

    for path in &paths {
        let local = local_map.get(path).map(|file| file.record.hash.as_str());
        let remote_hash = remote_map.get(path).map(|file| file.hash.as_str());
        let base_hash = base.get(*path).map(String::as_str);
        if local == remote_hash {
            continue;
        }
        let local_changed = local != base_hash;
        let remote_changed = remote_hash != base_hash;
        match (local_changed, remote_changed) {
            (true, false) => match local_map.get(path) {
                Some(file) => {
                    store
                        .put_path(&file_remote(cloud, path), &file.absolute)
                        .await?;
                    outcome.uploaded += 1;
                }
                None => {
                    store.delete(&file_remote(cloud, path)).await?;
                    outcome.deleted_remote += 1;
                }
            },
            (false, true) => match remote_map.get(path) {
                Some(record) => {
                    let Some(target) = safe_local_path(root, path) else {
                        continue;
                    };
                    if store
                        .get_to_path(&file_remote(cloud, path), &target)
                        .await?
                    {
                        apply_exec(&target, record.exec);
                        outcome.downloaded += 1;
                    }
                }
                None => {
                    if base_hash.is_some() {
                        if let Some(target) = safe_local_path(root, path) {
                            if target.is_file() {
                                std::fs::remove_file(&target).map_err(io_error)?;
                                outcome.deleted_local += 1;
                            }
                        }
                    }
                }
            },
            (true, true) => match (local_map.get(path), remote_map.get(path)) {
                (Some(local_file), Some(remote_record)) => {
                    let conflict = conflict_name(path, &context.device_name, date);
                    if let Some(target) = safe_local_path(root, &conflict) {
                        if store
                            .get_to_path(&file_remote(cloud, path), &target)
                            .await?
                        {
                            apply_exec(&target, remote_record.exec);
                            store
                                .put_path(&file_remote(cloud, &conflict), &target)
                                .await?;
                        }
                    }
                    store
                        .put_path(&file_remote(cloud, path), &local_file.absolute)
                        .await?;
                    outcome.conflicts += 1;
                    outcome.uploaded += 1;
                    outcome.downloaded += 1;
                }
                (Some(local_file), None) => {
                    store
                        .put_path(&file_remote(cloud, path), &local_file.absolute)
                        .await?;
                    outcome.uploaded += 1;
                }
                (None, Some(record)) => {
                    let Some(target) = safe_local_path(root, path) else {
                        continue;
                    };
                    if store
                        .get_to_path(&file_remote(cloud, path), &target)
                        .await?
                    {
                        apply_exec(&target, record.exec);
                        outcome.downloaded += 1;
                    }
                }
                (None, None) => {}
            },
            (false, false) => {}
        }
    }

    let final_files = capture(root)?;
    let mut clock = HlcClock::restore(Hlc::from_raw(state.hlc));
    if let Some(remote) = &remote {
        clock.observe(remote.stamp.hlc);
    }
    let changed = outcome != SyncOutcome::default()
        || remote.is_none()
        || final_files
            .iter()
            .map(|file| (&file.record.path, &file.record.hash))
            .ne(remote_map
                .values()
                .map(|record| (&record.path, &record.hash)));
    if changed {
        let stamp = Stamp::new(clock.tick(now_ms()), context.device);
        state.hlc = clock.last().raw();
        let (_manifest, raw_manifest, name) = manifest_fields(root);
        let version = VersionManifest {
            v: 1,
            project: cloud,
            name: if name.is_empty() {
                local_id.to_string()
            } else {
                name
            },
            manifest: raw_manifest,
            stamp,
            files: final_files.iter().map(|file| file.record.clone()).collect(),
        };
        let bytes = serde_json::to_vec_pretty(&version).map_err(io_error)?;
        store.put(&version_remote(cloud), bytes).await?;
    } else if let Some(remote) = &remote {
        clock.observe(remote.stamp.hlc);
        state.hlc = clock.last().raw();
    }

    let entry = state.projects.entry(local_id.to_string()).or_default();
    entry.cloud = Some(cloud);
    entry.base = final_files
        .iter()
        .map(|file| (file.record.path.clone(), file.record.hash.clone()))
        .collect();
    entry.base_stamp = state.hlc;
    entry.last_synced_ms = now_ms();
    Ok(outcome)
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteProject {
    pub(crate) cloud: ProjectId,
    pub(crate) name: String,
    pub(crate) stamp_ms: u64,
}

pub(crate) async fn list_remote_projects<S: CloudStore>(
    store: &S,
) -> EngineResult<Vec<RemoteProject>> {
    let entries = store.list("/projects").await?;
    let mut projects = Vec::new();
    for entry in entries.iter().filter(|entry| entry.folder).take(500) {
        let Ok(cloud) = ProjectId::parse(&entry.name) else {
            continue;
        };
        if let Some(version) = fetch_version(store, cloud).await? {
            projects.push(RemoteProject {
                cloud,
                name: version.name,
                stamp_ms: version.stamp.hlc.wall_ms(),
            });
        }
    }
    projects.sort_by_key(|project| std::cmp::Reverse(project.stamp_ms));
    Ok(projects)
}

pub(crate) async fn download_into<S: CloudStore>(
    store: &S,
    cloud: ProjectId,
    root: &Path,
) -> EngineResult<Option<VersionManifest>> {
    let Some(version) = fetch_version(store, cloud).await? else {
        return Ok(None);
    };
    for record in &version.files {
        let Some(target) = safe_local_path(root, &record.path) else {
            return Err(StoreError::Server(
                "remote version record has an unsafe path".into(),
            ));
        };
        if !store
            .get_to_path(&file_remote(cloud, &record.path), &target)
            .await?
        {
            return Err(StoreError::Server(
                "a file in the remote version is missing".into(),
            ));
        }
        apply_exec(&target, record.exec);
        let hash = ContentHash::digest_file(&target).map_err(io_error)?;
        if hash.to_hex() != record.hash {
            return Err(StoreError::Server(
                "a downloaded file failed verification".into(),
            ));
        }
    }
    if !version.manifest.is_null() && !version.files.iter().any(|file| file.path == "project.json")
    {
        let bytes = serde_json::to_vec_pretty(&version.manifest).map_err(io_error)?;
        crate::sandbox::atomic_write(&root.join("project.json"), &bytes).map_err(StoreError::Io)?;
    }
    Ok(Some(version))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SettingsBlob {
    stamp: Stamp,
    values: serde_json::Value,
}

#[derive(Debug)]
pub(crate) enum SettingsSync {
    Pushed(u64),
    Applied(serde_json::Value, u64),
    Current(u64),
}

pub(crate) async fn download_settings<S: CloudStore>(
    store: &S,
) -> EngineResult<Option<(serde_json::Value, u64)>> {
    let Some(bytes) = store.get("/settings/settings.json").await? else {
        return Ok(None);
    };
    let blob: SettingsBlob =
        serde_json::from_slice(&bytes).map_err(|error| StoreError::Server(error.to_string()))?;
    Ok(Some((blob.values, blob.stamp.hlc.raw())))
}

pub(crate) async fn sync_settings<S: CloudStore>(
    store: &S,
    state: &mut EngineState,
    context: &SyncContext,
    values: serde_json::Value,
) -> EngineResult<SettingsSync> {
    let remote = match store.get("/settings/settings.json").await? {
        Some(bytes) => Some(
            serde_json::from_slice::<SettingsBlob>(&bytes)
                .map_err(|error| StoreError::Server(error.to_string()))?,
        ),
        None => None,
    };
    let mut clock = HlcClock::restore(Hlc::from_raw(state.hlc.max(state.settings_stamp)));
    if let Some(remote) = &remote {
        clock.observe(remote.stamp.hlc);
        let remote_stamp = remote.stamp.hlc.raw();
        if remote_stamp > state.settings_stamp && remote.values != values {
            state.settings_stamp = remote_stamp;
            state.hlc = clock.last().raw();
            return Ok(SettingsSync::Applied(remote.values.clone(), remote_stamp));
        }
        if remote.values == values {
            state.settings_stamp = state.settings_stamp.max(remote_stamp);
            state.hlc = clock.last().raw();
            return Ok(SettingsSync::Current(state.settings_stamp));
        }
    }
    let stamp = Stamp::new(clock.tick(now_ms()), context.device);
    let raw = stamp.hlc.raw();
    let blob = SettingsBlob { stamp, values };
    let bytes = serde_json::to_vec_pretty(&blob).map_err(io_error)?;
    store.put("/settings/settings.json", bytes).await?;
    state.settings_stamp = raw;
    state.hlc = clock.last().raw();
    Ok(SettingsSync::Pushed(raw))
}

#[cfg(test)]
mod tests {
    use super::{
        download_into, list_remote_projects, sync_project_at, sync_settings, EngineState,
        SettingsSync, SyncContext, SyncOutcome,
    };
    use crate::cloud::store::{CloudStore, RemoteEntry, StoreResult};
    use oleafly_core::ids::{DeviceId, ProjectId};
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryStore {
        files: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl CloudStore for MemoryStore {
        async fn get(&self, remote: &str) -> StoreResult<Option<Vec<u8>>> {
            Ok(self.files.lock().unwrap().get(remote).cloned())
        }

        async fn get_to_path(&self, remote: &str, local: &Path) -> StoreResult<bool> {
            let Some(bytes) = self.get(remote).await? else {
                return Ok(false);
            };
            if let Some(parent) = local.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(local, bytes).unwrap();
            Ok(true)
        }

        async fn put(&self, remote: &str, bytes: Vec<u8>) -> StoreResult<()> {
            self.files.lock().unwrap().insert(remote.to_string(), bytes);
            Ok(())
        }

        async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<()> {
            self.put(remote, std::fs::read(local).unwrap()).await
        }

        async fn delete(&self, remote: &str) -> StoreResult<()> {
            self.files.lock().unwrap().remove(remote);
            Ok(())
        }

        async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
            let prefix = format!("{remote_dir}/");
            let mut seen: Vec<RemoteEntry> = Vec::new();
            for key in self.files.lock().unwrap().keys() {
                let Some(rest) = key.strip_prefix(&prefix) else {
                    continue;
                };
                let (name, folder) = match rest.split_once('/') {
                    Some((head, _)) => (head.to_string(), true),
                    None => (rest.to_string(), false),
                };
                if !seen.iter().any(|entry| entry.name == name) {
                    seen.push(RemoteEntry { name, folder });
                }
            }
            seen.sort_by(|left, right| left.name.cmp(&right.name));
            Ok(seen)
        }
    }

    fn context(name: &str) -> SyncContext {
        SyncContext {
            device: DeviceId::new(),
            device_name: name.into(),
            account_id: "dbid:test".into(),
        }
    }

    fn project(root: &Path) {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(
            root.join("project.json"),
            r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk"}"#,
        )
        .unwrap();
        std::fs::write(root.join("main.tex"), "one").unwrap();
        std::fs::write(root.join("main.aux"), "build").unwrap();
    }

    #[tokio::test]
    async fn two_computers_share_writes_and_deletes_without_losing_edits() {
        let store = MemoryStore::default();
        let cloud = ProjectId::new();
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let a = dir_a.path();
        let b = dir_b.path();
        project(a);
        let mut state_a = EngineState::default();
        let mut state_b = EngineState::default();
        let ctx_a = context("Desk");
        let ctx_b = context("Laptop");

        let uploaded = sync_project_at(&store, &mut state_a, &ctx_a, "thesis", a, cloud)
            .await
            .unwrap();
        assert_eq!(uploaded.uploaded, 2);
        assert!(store
            .get(&format!("/projects/{cloud}/files/main.aux"))
            .await
            .unwrap()
            .is_none());

        std::fs::create_dir_all(b).unwrap();
        let version = download_into(&store, cloud, b).await.unwrap().unwrap();
        assert_eq!(version.name, "Thesis");
        assert_eq!(std::fs::read_to_string(b.join("main.tex")).unwrap(), "one");
        let seeded = sync_project_at(&store, &mut state_b, &ctx_b, "thesis-b", b, cloud)
            .await
            .unwrap();
        assert_eq!(seeded, SyncOutcome::default());

        std::fs::write(b.join("main.tex"), "two from laptop").unwrap();
        std::fs::write(b.join("notes.md"), "new").unwrap();
        sync_project_at(&store, &mut state_b, &ctx_b, "thesis-b", b, cloud)
            .await
            .unwrap();
        sync_project_at(&store, &mut state_a, &ctx_a, "thesis", a, cloud)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(a.join("main.tex")).unwrap(),
            "two from laptop"
        );
        assert_eq!(std::fs::read_to_string(a.join("notes.md")).unwrap(), "new");

        std::fs::write(a.join("main.tex"), "desk edit").unwrap();
        std::fs::write(b.join("main.tex"), "laptop edit").unwrap();
        sync_project_at(&store, &mut state_b, &ctx_b, "thesis-b", b, cloud)
            .await
            .unwrap();
        let conflicted = sync_project_at(&store, &mut state_a, &ctx_a, "thesis", a, cloud)
            .await
            .unwrap();
        assert_eq!(conflicted.conflicts, 1);
        assert_eq!(
            std::fs::read_to_string(a.join("main.tex")).unwrap(),
            "desk edit"
        );
        let copies: Vec<_> = std::fs::read_dir(a)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains("(Desk "))
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(
            std::fs::read_to_string(copies[0].path()).unwrap(),
            "laptop edit"
        );

        std::fs::remove_file(a.join("notes.md")).unwrap();
        sync_project_at(&store, &mut state_a, &ctx_a, "thesis", a, cloud)
            .await
            .unwrap();
        sync_project_at(&store, &mut state_b, &ctx_b, "thesis-b", b, cloud)
            .await
            .unwrap();
        assert!(!b.join("notes.md").exists());

        let remote = list_remote_projects(&store).await.unwrap();
        assert_eq!(remote.len(), 1);
        assert_eq!(remote[0].cloud, cloud);
    }

    #[tokio::test]
    async fn settings_blob_round_trips_between_computers() {
        let store = MemoryStore::default();
        let mut state_a = EngineState::default();
        let mut state_b = EngineState::default();
        let ctx_a = context("Desk");
        let ctx_b = context("Laptop");
        let pushed = sync_settings(
            &store,
            &mut state_a,
            &ctx_a,
            serde_json::json!({"accent": "red"}),
        )
        .await
        .unwrap();
        assert!(matches!(pushed, SettingsSync::Pushed(_)));
        match sync_settings(&store, &mut state_b, &ctx_b, serde_json::json!({}))
            .await
            .unwrap()
        {
            SettingsSync::Applied(values, _) => assert_eq!(values["accent"], "red"),
            other => panic!("expected applied settings, got {other:?}"),
        }
        let current = sync_settings(
            &store,
            &mut state_b,
            &ctx_b,
            serde_json::json!({"accent": "red"}),
        )
        .await
        .unwrap();
        assert!(matches!(current, SettingsSync::Current(_)));
    }
}
