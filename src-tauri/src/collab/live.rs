use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::ot::TextOperation;
use oleafly_collab::sync::{
    spawn_live, EndReason, LiveEvent, LiveHandle, LiveLink, LiveStatus, SharedLive,
};
use oleafly_collab::{
    load_binding, remove_binding, save_binding, CollabError, ServerClient, ServerUrl,
};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::Emitter;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;

use super::commands::CollabCommandError;
use super::disk::{
    as_text, excluded_name, exists_exact, safe_target, scan_folder, sha256_hex, write_file,
    DiskState,
};
use super::state::CollabState;
use crate::folder_watch::FolderChange;

pub const LIVE_STATUS_EVENT: &str = "collab-live-status";
pub const LIVE_ROLE_EVENT: &str = "collab-live-role";
pub const LIVE_MERGED_EVENT: &str = "collab-live-merged";
pub const PRESENCE_EVENT: &str = "collab-presence";
pub const PRESENCE_LEFT_EVENT: &str = "collab-presence-left";
const WRITE_DEBOUNCE: Duration = Duration::from_millis(120);
const BLOB_RETRY: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub project_id: String,
    pub status: LiveStatus,
    pub pending: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePayload {
    pub project_id: String,
    pub role: ProjectRole,
}

#[derive(Clone, Debug, Serialize)]
pub struct MergedFile {
    pub path: String,
    pub changes: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedPayload {
    pub project_id: String,
    pub files: Vec<MergedFile>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub project_id: String,
    pub device_id: DeviceId,
    pub account_id: AccountId,
    pub path: Option<String>,
    pub cursor: Option<u32>,
    pub anchor: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceLeftPayload {
    pub project_id: String,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, Serialize)]
pub struct LiveInfo {
    pub role: ProjectRole,
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, Serialize)]
pub struct DocOpened {
    pub file_id: String,
    pub rev: u64,
    pub text: String,
}

pub trait LiveHost: Send + Sync + 'static {
    fn status(&self, payload: StatusPayload);
    fn role(&self, payload: RolePayload);
    fn merged(&self, payload: MergedPayload);
    fn presence(&self, payload: PresencePayload);
    fn presence_left(&self, payload: PresenceLeftPayload);
    fn folder_changed(&self, change: FolderChange);
}

pub struct AppLiveHost {
    app: tauri::AppHandle,
}

impl AppLiveHost {
    pub fn new(app: tauri::AppHandle) -> AppLiveHost {
        AppLiveHost { app }
    }
}

impl LiveHost for AppLiveHost {
    fn status(&self, payload: StatusPayload) {
        let _ = self.app.emit(LIVE_STATUS_EVENT, payload);
    }

    fn role(&self, payload: RolePayload) {
        let _ = self.app.emit(LIVE_ROLE_EVENT, payload);
    }

    fn merged(&self, payload: MergedPayload) {
        let _ = self.app.emit(LIVE_MERGED_EVENT, payload);
    }

    fn presence(&self, payload: PresencePayload) {
        let _ = self.app.emit(PRESENCE_EVENT, payload);
    }

    fn presence_left(&self, payload: PresenceLeftPayload) {
        let _ = self.app.emit(PRESENCE_LEFT_EVENT, payload);
    }

    fn folder_changed(&self, change: FolderChange) {
        let _ = self
            .app
            .emit(crate::folder_watch::FOLDER_CHANGED_EVENT, change);
    }
}

enum WriterSignal {
    Kick,
    Flush(oneshot::Sender<()>),
}

pub struct Active {
    project_id: String,
    root: PathBuf,
    document_dir: PathBuf,
    disk_file: PathBuf,
    live: SharedLive,
    handle: LiveHandle,
    link: LiveLink,
    disk: Mutex<DiskState>,
    host: Arc<dyn LiveHost>,
    writer: UnboundedSender<WriterSignal>,
    account_id: AccountId,
    quiet_merge: AtomicBool,
    waiting: AtomicBool,
    last_status: Mutex<LiveStatus>,
    bases: Mutex<HashMap<String, String>>,
}

static ACTIVE: LazyLock<Mutex<Option<Arc<Active>>>> = LazyLock::new(|| Mutex::new(None));
static LIFECYCLE: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static FRESH_JOINS: LazyLock<Mutex<BTreeSet<String>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));

fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn lock(live: &SharedLive) -> MutexGuard<'_, LiveProject> {
    live.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn active_for(project_id: &str) -> Option<Arc<Active>> {
    guard(&ACTIVE)
        .as_ref()
        .filter(|active| active.project_id == project_id)
        .cloned()
}

pub fn note_fresh_join(project_id: &str) {
    guard(&FRESH_JOINS).insert(project_id.to_owned());
}

fn not_live() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not live".to_owned(),
    }
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

fn parent_of(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

fn name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

fn by_path(layout: &Layout) -> HashMap<String, (String, NodeKind, Option<String>)> {
    layout
        .iter()
        .map(|(id, placed)| {
            (
                placed.path.clone(),
                (id.clone(), placed.kind, placed.blob.clone()),
            )
        })
        .collect()
}

#[derive(Default)]
struct LocalImport {
    texts: Vec<(String, String, String)>,
    blobs: Vec<(String, String, Vec<u8>)>,
    removed: Vec<String>,
    dirs: Vec<String>,
}

impl LocalImport {
    fn is_empty(&self) -> bool {
        self.texts.is_empty()
            && self.blobs.is_empty()
            && self.removed.is_empty()
            && self.dirs.is_empty()
    }
}

fn read_local_changes(
    root: &Path,
    disk: &DiskState,
    live: &LiveProject,
    only: Option<&[String]>,
) -> Result<LocalImport, CollabError> {
    let layout = materialize::layout(&live.doc().nodes()?);
    let placed = by_path(&layout);
    let mut candidates: BTreeSet<String> = BTreeSet::new();
    match only {
        Some(paths) => {
            for path in paths {
                candidates.insert(path.trim_matches('/').to_owned());
                let prefix = format!("{}/", path.trim_matches('/'));
                candidates.extend(
                    placed
                        .keys()
                        .filter(|known| known.starts_with(&prefix))
                        .cloned(),
                );
                if let Some(target) = safe_target(root, path) {
                    if target.is_dir() {
                        if let Ok(scan) = scan_folder(root) {
                            candidates.extend(
                                scan.files
                                    .into_iter()
                                    .map(|(file, _)| file)
                                    .filter(|file| file.starts_with(&prefix)),
                            );
                            candidates.extend(
                                scan.dirs.into_iter().filter(|dir| dir.starts_with(&prefix)),
                            );
                        }
                    }
                }
            }
        }
        None => {
            let scan = scan_folder(root).map_err(CollabError::Io)?;
            candidates.extend(scan.files.into_iter().map(|(path, _)| path));
            candidates.extend(scan.dirs);
            candidates.extend(placed.keys().cloned());
        }
    }
    let mut import = LocalImport::default();
    for path in candidates {
        if path.is_empty() || excluded_name(&path) {
            continue;
        }
        let Some(target) = safe_target(root, &path) else {
            continue;
        };
        let known = placed.get(&path);
        let present = if exists_exact(root, &path) {
            std::fs::symlink_metadata(&target)
        } else {
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        };
        match present {
            Ok(metadata) if metadata.is_file() => {
                let bytes = std::fs::read(&target).map_err(io)?;
                let hash = sha256_hex(&bytes);
                if disk.hashes.get(&path) == Some(&hash) && known.is_some() {
                    continue;
                }
                match (as_text(&bytes), known) {
                    (Some(text), Some((id, NodeKind::Text, _))) => {
                        if live.doc().text(id)? != text {
                            import.texts.push((path, text, hash));
                        }
                    }
                    (Some(text), None) => import.texts.push((path, text, hash)),
                    (_, Some((_, NodeKind::Blob, Some(blob)))) if *blob == hash => {}
                    (None, _) | (Some(_), Some(_)) => import.blobs.push((path, hash, bytes)),
                }
            }
            Ok(metadata) if metadata.is_dir() => {
                if known.is_none() {
                    import.dirs.push(path);
                }
            }
            Ok(_) => {}
            Err(_) => {
                let written = disk.hashes.contains_key(&path);
                let known_dir = known.is_some_and(|(_, kind, _)| *kind == NodeKind::Dir)
                    && disk.layout.values().any(|entry| entry.path == path);
                if known.is_some() && (written || known_dir) {
                    import.removed.push(path);
                }
            }
        }
    }
    Ok(import)
}

fn ensure_dir(
    live: &mut LiveProject,
    placed: &mut HashMap<String, (String, NodeKind, Option<String>)>,
    path: Option<&str>,
) -> Result<Option<String>, CollabError> {
    let Some(path) = path.filter(|path| !path.is_empty()) else {
        return Ok(None);
    };
    if let Some((id, NodeKind::Dir, _)) = placed.get(path) {
        return Ok(Some(id.clone()));
    }
    let parent = ensure_dir(live, placed, parent_of(path))?;
    let id = live
        .doc_mut()
        .add_node(parent.as_deref(), name_of(path), NodeKind::Dir, None, "")?;
    placed.insert(path.to_owned(), (id.clone(), NodeKind::Dir, None));
    Ok(Some(id))
}

fn writable(root: &Path, disk: &DiskState, path: &str) -> bool {
    let Some(target) = safe_target(root, path) else {
        return false;
    };
    match std::fs::read(&target) {
        Err(_) => true,
        Ok(bytes) => disk
            .hashes
            .get(path)
            .is_some_and(|known| *known == sha256_hex(&bytes)),
    }
}

fn initial_bases(root: &Path, disk: &DiskState, live: &LiveProject) -> HashMap<String, String> {
    let mut bases = HashMap::new();
    for (id, placed) in disk
        .layout
        .iter()
        .filter(|(_, placed)| placed.kind == NodeKind::Text)
    {
        let Some(known) = disk.hashes.get(&placed.path) else {
            continue;
        };
        let on_disk = safe_target(root, &placed.path)
            .and_then(|target| std::fs::read(target).ok())
            .filter(|bytes| sha256_hex(bytes) == *known)
            .and_then(|bytes| as_text(&bytes));
        let text = on_disk.or_else(|| {
            live.doc()
                .text(id)
                .ok()
                .filter(|text| sha256_hex(text.as_bytes()) == *known)
        });
        if let Some(text) = text {
            bases.insert(placed.path.clone(), text);
        }
    }
    bases
}

fn merged_onto(base: &str, disk: &str, current: &str) -> Option<TextOperation> {
    if base == current {
        return None;
    }
    let from_disk = TextOperation::between(base, disk);
    let from_doc = TextOperation::between(base, current);
    TextOperation::transform(&from_disk, &from_doc)
        .ok()
        .map(|(after_doc, _)| after_doc)
}

fn apply_local_import(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut HashMap<String, String>,
    import: LocalImport,
    root: &Path,
) -> Result<bool, CollabError> {
    let mut placed = by_path(&materialize::layout(&live.doc().nodes()?));
    let mut changed = false;
    let still = |path: &str, hash: &str| {
        safe_target(root, path)
            .and_then(|target| std::fs::read(target).ok())
            .is_some_and(|bytes| sha256_hex(&bytes) == hash)
    };
    for path in import.dirs {
        ensure_dir(live, &mut placed, Some(&path))?;
        changed = true;
    }
    for (path, text, hash) in import.texts {
        if !still(&path, &hash) {
            continue;
        }
        match placed.get(&path).cloned() {
            Some((id, NodeKind::Text, _)) => {
                let current = live.doc().text(&id)?;
                let merged = bases
                    .get(&path)
                    .and_then(|base| merged_onto(base, &text, &current));
                changed |= match merged {
                    Some(operation) => live.local_operation(&id, &operation)?,
                    None => live.local_text(&id, &text)?,
                };
            }
            Some((id, _, _)) => {
                live.doc_mut().trash(&id)?;
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                changed = true;
            }
            None => {
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let id = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                placed.insert(path.clone(), (id, NodeKind::Text, None));
                changed = true;
            }
        }
        bases.insert(path.clone(), text.clone());
        disk.hashes.insert(path, hash);
    }
    for (path, hash, _) in import.blobs {
        if !still(&path, &hash) {
            continue;
        }
        match placed.get(&path).cloned() {
            Some((id, NodeKind::Blob, _)) => live.doc_mut().set_blob(&id, &hash)?,
            Some((id, _, _)) => {
                live.doc_mut().trash(&id)?;
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
            }
            None => {
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
            }
        }
        disk.hashes.insert(path, hash);
        changed = true;
    }
    for path in import.removed {
        if let Some((id, _, _)) = placed.get(&path) {
            live.doc_mut().trash(id)?;
            disk.hashes.remove(&path);
            changed = true;
        }
    }
    if changed {
        disk.layout = materialize::layout(&live.doc().nodes()?);
    }
    Ok(changed)
}

async fn upload_blobs(link: &LiveLink, blobs: &[(String, String, Vec<u8>)]) -> BTreeSet<String> {
    let mut failed = BTreeSet::new();
    if blobs.is_empty() {
        return failed;
    }
    let Ok(access) = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
    else {
        return blobs.iter().map(|(_, hash, _)| hash.clone()).collect();
    };
    let mut sent = BTreeSet::new();
    for (_, hash, bytes) in blobs {
        if sent.insert(hash.clone())
            && link
                .client
                .put_blob(&access, link.project, hash, bytes.clone())
                .await
                .is_err()
        {
            failed.insert(hash.clone());
        }
    }
    failed
}

impl Active {
    fn kick(&self) {
        let _ = self.writer.send(WriterSignal::Kick);
    }

    fn emit_status(&self, status: LiveStatus) {
        let pending = lock(&self.live).pending_changes();
        self.waiting.store(pending > 0, Ordering::SeqCst);
        *guard(&self.last_status) = status.clone();
        self.host.status(StatusPayload {
            project_id: self.project_id.clone(),
            status,
            pending,
        });
    }

    fn refresh_pending(&self) {
        let status = guard(&self.last_status).clone();
        let waiting = lock(&self.live).pending_changes() > 0;
        let flipped = self.waiting.swap(waiting, Ordering::SeqCst) != waiting;
        if flipped || matches!(status, LiveStatus::Offline { .. } | LiveStatus::Connecting) {
            self.emit_status(status);
        }
    }

    fn save_now(&self) {
        let live = lock(&self.live);
        let _ = live.save(&self.document_dir);
        drop(live);
        let _ = guard(&self.disk).save(&self.disk_file);
    }

    async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        let snapshot = guard(&self.disk).clone();
        let mut import = {
            let live = lock(&self.live);
            read_local_changes(&self.root, &snapshot, &live, only.as_deref())?
        };
        if import.is_empty() {
            return Ok(());
        }
        if !lock(&self.live).can_edit() {
            return Ok(());
        }
        let failed = upload_blobs(&self.link, &import.blobs).await;
        import.blobs.retain(|(_, hash, _)| !failed.contains(hash));
        let changed = {
            let mut disk = guard(&self.disk);
            let mut live = lock(&self.live);
            let mut bases = guard(&self.bases);
            apply_local_import(&mut live, &mut disk, &mut bases, import, &self.root)?
        };
        if changed {
            self.handle.flush();
            self.kick();
            self.refresh_pending();
        }
        Ok(())
    }

    async fn write_out(&self) -> Result<Vec<String>, CollabError> {
        let previous = guard(&self.disk).layout.clone();
        let (work, next, texts) = {
            let mut live = lock(&self.live);
            let work = live.take_disk_work();
            if work.is_empty() {
                return Ok(Vec::new());
            }
            let next = materialize::layout(&live.doc().nodes()?);
            let mut ids: BTreeSet<String> = work.texts.clone();
            for (id, placed) in &next {
                let moved_or_new = previous
                    .get(id)
                    .is_none_or(|before| before.path != placed.path);
                if placed.kind == NodeKind::Text && moved_or_new {
                    ids.insert(id.clone());
                }
            }
            let mut texts = Vec::new();
            for id in ids {
                if let Some(placed) = next.get(&id).filter(|placed| placed.kind == NodeKind::Text) {
                    texts.push((placed.path.clone(), live.doc().text(&id)?));
                }
            }
            live.save(&self.document_dir)?;
            (work, next, texts)
        };
        let plan = materialize::plan(&previous, &next);
        let mut conflicts: Vec<String> = Vec::new();
        let mut changed: BTreeSet<String> = BTreeSet::new();
        let structural = !plan.moved.is_empty()
            || !plan.removed.is_empty()
            || !plan.dirs.is_empty()
            || work.tree;
        let mut blobs = Vec::new();
        {
            let mut disk = guard(&self.disk);
            let mut bases = guard(&self.bases);
            for (from, to) in &plan.moved {
                if !super::disk::move_path(&self.root, from, to) {
                    continue;
                }
                if let Some(hash) = disk.hashes.remove(from) {
                    disk.hashes.insert(to.clone(), hash);
                }
                if let Some(base) = bases.remove(from) {
                    bases.insert(to.clone(), base);
                }
                changed.insert(from.clone());
                changed.insert(to.clone());
            }
            for dir in &plan.dirs {
                if let Some(target) = safe_target(&self.root, dir) {
                    let _ = std::fs::create_dir_all(target);
                    changed.insert(dir.clone());
                }
            }
            for (path, text) in &texts {
                if !writable(&self.root, &disk, path) {
                    conflicts.push(path.clone());
                    continue;
                }
                if write_file(&self.root, path, text.as_bytes()).map_err(CollabError::Io)? {
                    changed.insert(path.clone());
                }
                disk.hashes
                    .insert(path.clone(), sha256_hex(text.as_bytes()));
                bases.insert(path.clone(), text.clone());
            }
            for id in &plan.written {
                if let Some(placed) = next.get(id).filter(|placed| placed.kind == NodeKind::Blob) {
                    if let Some(hash) = &placed.blob {
                        let on_disk = safe_target(&self.root, &placed.path)
                            .and_then(|target| std::fs::read(target).ok())
                            .is_some_and(|bytes| sha256_hex(&bytes) == *hash);
                        if on_disk {
                            disk.hashes.insert(placed.path.clone(), hash.clone());
                        } else if writable(&self.root, &disk, &placed.path) {
                            blobs.push((placed.path.clone(), hash.clone()));
                        } else {
                            conflicts.push(placed.path.clone());
                        }
                    }
                }
            }
            for path in &plan.removed {
                if !writable(&self.root, &disk, path) {
                    conflicts.push(path.clone());
                    continue;
                }
                super::disk::remove_path(&self.root, path);
                disk.hashes.remove(path);
                bases.remove(path);
                changed.insert(path.clone());
            }
            disk.layout = next;
        }
        let mut missing = false;
        if !blobs.is_empty() {
            let access = self
                .link
                .sessions
                .access_token(self.link.server_id, &self.link.client)
                .await;
            for (path, hash) in blobs {
                let fetched = match &access {
                    Ok(access) => self
                        .link
                        .client
                        .get_blob(access, self.link.project, &hash)
                        .await
                        .ok()
                        .filter(|bytes| sha256_hex(bytes) == hash),
                    Err(_) => None,
                };
                let Some(bytes) = fetched else {
                    missing = true;
                    continue;
                };
                let mut disk = guard(&self.disk);
                write_file(&self.root, &path, &bytes).map_err(CollabError::Io)?;
                disk.hashes.insert(path.clone(), hash);
                changed.insert(path);
            }
        }
        let _ = guard(&self.disk).save(&self.disk_file);
        if missing {
            lock(&self.live).mark_all_dirty()?;
            let writer = self.writer.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(BLOB_RETRY).await;
                let _ = writer.send(WriterSignal::Kick);
            });
        }
        if !changed.is_empty() || structural {
            self.host.folder_changed(FolderChange {
                project_id: self.project_id.clone(),
                paths: changed.into_iter().collect(),
                rescan: false,
                structural,
            });
        }
        Ok(conflicts)
    }

    fn detach(&self, paths: &oleafly_collab::CollabPaths) {
        let _ = remove_binding(paths, &self.project_id);
        super::registry::invalidate(&self.project_id);
    }
}

async fn writer_loop(active: Weak<Active>, mut signals: UnboundedReceiver<WriterSignal>) {
    while let Some(first) = signals.recv().await {
        let mut waiters = Vec::new();
        if let WriterSignal::Flush(done) = first {
            waiters.push(done);
        } else {
            tokio::time::sleep(WRITE_DEBOUNCE).await;
        }
        while let Ok(more) = signals.try_recv() {
            if let WriterSignal::Flush(done) = more {
                waiters.push(done);
            }
        }
        let Some(active) = active.upgrade() else {
            return;
        };
        if let Ok(conflicts) = active.write_out().await {
            if !conflicts.is_empty() {
                let _ = active.import_paths(Some(conflicts)).await;
            }
        }
        for done in waiters {
            let _ = done.send(());
        }
    }
}

async fn pump(
    active: Weak<Active>,
    mut events: UnboundedReceiver<LiveEvent>,
    paths: oleafly_collab::CollabPaths,
) {
    while let Some(event) = events.recv().await {
        let Some(active) = active.upgrade() else {
            return;
        };
        match event {
            LiveEvent::Status(status) => {
                let ended = match &status {
                    LiveStatus::Ended { reason } => Some(*reason),
                    _ => None,
                };
                if let Some(reason) = ended {
                    let _ = active.write_out().await;
                    active.save_now();
                    if matches!(reason, EndReason::Removed | EndReason::Archived) {
                        active.detach(&paths);
                    }
                    let mut slot = guard(&ACTIVE);
                    if slot
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &active))
                    {
                        *slot = None;
                    }
                }
                active.emit_status(status);
            }
            LiveEvent::Role(role) => {
                if let Ok(Some(mut binding)) = load_binding(&paths, &active.project_id) {
                    if binding.role != role {
                        binding.role = role;
                        let _ = save_binding(&paths, &active.project_id, &binding);
                    }
                }
                active.host.role(RolePayload {
                    project_id: active.project_id.clone(),
                    role,
                });
            }
            LiveEvent::Changed => active.kick(),
            LiveEvent::Acknowledged => active.refresh_pending(),
            LiveEvent::Presence {
                device_id,
                account_id,
                state,
            } => active.host.presence(PresencePayload {
                project_id: active.project_id.clone(),
                device_id,
                account_id,
                path: state.file_id,
                cursor: state.cursor,
                anchor: state.anchor,
            }),
            LiveEvent::PresenceLeft { device_id } => {
                active.host.presence_left(PresenceLeftPayload {
                    project_id: active.project_id.clone(),
                    device_id,
                })
            }
            LiveEvent::Merged(counts) => {
                if active.quiet_merge.swap(false, Ordering::SeqCst) {
                    continue;
                }
                let layout =
                    materialize::layout(&lock(&active.live).doc().nodes().unwrap_or_default());
                let files: Vec<MergedFile> = counts
                    .into_iter()
                    .filter_map(|(id, changes)| {
                        layout.get(&id).map(|placed| MergedFile {
                            path: placed.path.clone(),
                            changes,
                        })
                    })
                    .collect();
                if !files.is_empty() {
                    active.host.merged(MergedPayload {
                        project_id: active.project_id.clone(),
                        files,
                    });
                }
            }
        }
    }
}

pub async fn start(
    state: &CollabState,
    host: Arc<dyn LiveHost>,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    let _lifecycle = LIFECYCLE.lock().await;
    if let Some(active) = active_for(project_id) {
        let role = lock(&active.live).role();
        active.emit_status(guard(&active.last_status).clone());
        active.host.role(RolePayload {
            project_id: project_id.to_owned(),
            role,
        });
        return Ok(LiveInfo {
            role,
            account_id: active.account_id,
            device_id: active.link.device_id,
        });
    }
    stop_any().await;
    let paths = state.paths()?.clone();
    let binding = load_binding(&paths, project_id)?.ok_or_else(not_live)?;
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let keys = state.keys().await?;
    let tokens = keys
        .sessions
        .tokens(binding.server_id)?
        .ok_or(CollabError::Unauthorized)?;
    let client = Arc::new(ServerClient::new(ServerUrl::parse(&binding.server_url)?)?);
    let link = LiveLink {
        client,
        server_id: binding.server_id,
        project: binding.shared_project_id,
        device_id: tokens.device_id,
        key: Arc::clone(&keys.key),
        sessions: Arc::clone(&keys.sessions),
    };
    let document_dir = paths.document_dir(project_id)?;
    let disk_file = paths.materializer_index_file(project_id)?;
    let role = binding.role;
    let loaded = {
        let document_dir = document_dir.clone();
        let disk_file = disk_file.clone();
        tauri::async_runtime::spawn_blocking(move || {
            LiveProject::load(&document_dir, role).map(|live| (live, DiskState::load(&disk_file)))
        })
        .await
        .map_err(io)??
    };
    let (mut live, mut disk) = loaded;
    let mut bases = initial_bases(&root, &disk, &live);
    let mut import = read_local_changes(&root, &disk, &live, None)?;
    if !import.is_empty() && live.can_edit() {
        let failed = upload_blobs(&link, &import.blobs).await;
        import.blobs.retain(|(_, hash, _)| !failed.contains(hash));
        apply_local_import(&mut live, &mut disk, &mut bases, import, &root)?;
    }
    let shared: SharedLive = Arc::new(Mutex::new(live));
    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let (writer_tx, writer_rx) = mpsc::unbounded_channel();
    let handle = spawn_live(link.clone(), Arc::clone(&shared), events_tx);
    let fresh = guard(&FRESH_JOINS).remove(project_id);
    let active = Arc::new(Active {
        project_id: project_id.to_owned(),
        root,
        document_dir,
        disk_file,
        live: Arc::clone(&shared),
        handle,
        link,
        disk: Mutex::new(disk),
        host,
        writer: writer_tx,
        account_id: tokens.account_id,
        quiet_merge: AtomicBool::new(fresh),
        waiting: AtomicBool::new(false),
        last_status: Mutex::new(LiveStatus::Connecting),
        bases: Mutex::new(bases),
    });
    lock(&shared).mark_all_dirty()?;
    tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
    tauri::async_runtime::spawn(pump(Arc::downgrade(&active), events_rx, paths));
    active.kick();
    *guard(&ACTIVE) = Some(Arc::clone(&active));
    Ok(LiveInfo {
        role,
        account_id: tokens.account_id,
        device_id: tokens.device_id,
    })
}

async fn finish(active: Arc<Active>) {
    let (done, wait) = oneshot::channel();
    let _ = active.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(5), wait).await;
    active.save_now();
    active.handle.stop();
}

async fn stop_any() {
    let previous = guard(&ACTIVE).take();
    if let Some(active) = previous {
        finish(active).await;
    }
}

pub async fn stop(project_id: &str) {
    let _lifecycle = LIFECYCLE.lock().await;
    let previous = {
        let mut slot = guard(&ACTIVE);
        if slot
            .as_ref()
            .is_some_and(|active| active.project_id == project_id)
        {
            slot.take()
        } else {
            None
        }
    };
    if let Some(active) = previous {
        finish(active).await;
    }
}

pub async fn flush(project_id: &str) {
    let Some(active) = active_for(project_id) else {
        return;
    };
    let (done, wait) = oneshot::channel();
    let _ = active.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
}

pub fn doc_open(
    project_id: &str,
    path: &str,
    sink: DocSink,
) -> Result<Option<DocOpened>, CollabError> {
    let Some(active) = active_for(project_id) else {
        return Ok(None);
    };
    let mut live = lock(&active.live);
    let layout = materialize::layout(&live.doc().nodes()?);
    let Some((id, _)) = layout
        .iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
    else {
        return Ok(None);
    };
    let id = id.clone();
    let (rev, text) = live.open_file(&id, sink)?;
    Ok(Some(DocOpened {
        file_id: id,
        rev,
        text,
    }))
}

pub fn doc_change(
    project_id: &str,
    file_id: &str,
    rev: u64,
    operation: TextOperation,
) -> Result<(), CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    lock(&active.live).editor_change(file_id, rev, operation)?;
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    Ok(())
}

pub fn doc_close(project_id: &str, file_id: &str) {
    if let Some(active) = active_for(project_id) {
        lock(&active.live).close_file(file_id);
    }
}

pub fn presence_set(
    project_id: &str,
    path: Option<String>,
    cursor: Option<u32>,
    anchor: Option<u32>,
) {
    if let Some(active) = active_for(project_id) {
        active.handle.presence(PresenceState {
            file_id: path.filter(|path| path.len() <= 256),
            cursor,
            anchor,
        });
    }
}

pub fn app_wrote(project_id: &str, path: &str) {
    if let Some(active) = active_for(project_id) {
        let paths = vec![path.to_owned()];
        tauri::async_runtime::spawn(async move {
            let _ = active.import_paths(Some(paths)).await;
        });
    }
}

fn accept_local(root: &Path, disk: &mut DiskState) {
    for placed in disk.layout.values() {
        if placed.kind == NodeKind::Dir {
            continue;
        }
        if let Some(bytes) =
            safe_target(root, &placed.path).and_then(|target| std::fs::read(target).ok())
        {
            disk.hashes.insert(placed.path.clone(), sha256_hex(&bytes));
        }
    }
}

pub async fn resume(project_id: &str, send: bool) -> Result<(), CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    if send {
        return active.import_paths(None).await;
    }
    let mut disk = guard(&active.disk);
    accept_local(&active.root, &mut disk);
    disk.save(&active.disk_file)
}

pub fn folder_changed(change: &FolderChange) {
    if let Some(active) = active_for(&change.project_id) {
        let only = (!change.rescan).then(|| change.paths.clone());
        tauri::async_runtime::spawn(async move {
            let _ = active.import_paths(only).await;
        });
    }
}

pub async fn forget(project_id: &str, paths: &oleafly_collab::CollabPaths) {
    stop(project_id).await;
    let _ = remove_binding(paths, project_id);
    if let Ok(dir) = paths.project_dir(project_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    super::registry::invalidate(project_id);
}

#[tauri::command]
pub async fn collab_live_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<LiveInfo, CollabCommandError> {
    let host: Arc<dyn LiveHost> = Arc::new(AppLiveHost::new(app.clone()));
    let info = start(state.inner(), host, &project_id)
        .await
        .map_err(CollabCommandError::from)?;
    if !crate::folder_watch::is_watching(&project_id) {
        let _ = crate::folder_watch::watch_project_folder(app, project_id).await;
    }
    Ok(info)
}

#[tauri::command]
pub async fn collab_live_stop(project_id: String) -> Result<(), CollabCommandError> {
    stop(&project_id).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_live_flush(project_id: String) -> Result<(), CollabCommandError> {
    flush(&project_id).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_doc_open(
    project_id: String,
    path: String,
    channel: Channel<DocMessage>,
) -> Result<Option<DocOpened>, CollabCommandError> {
    let sink: DocSink = Arc::new(move |message| {
        let _ = channel.send(message);
    });
    doc_open(&project_id, &path, sink).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_doc_change(
    project_id: String,
    file_id: String,
    rev: u64,
    op: TextOperation,
) -> Result<(), CollabCommandError> {
    doc_change(&project_id, &file_id, rev, op).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_doc_close(
    project_id: String,
    file_id: String,
) -> Result<(), CollabCommandError> {
    doc_close(&project_id, &file_id);
    Ok(())
}

#[tauri::command]
pub async fn collab_sync_resume(project_id: String, send: bool) -> Result<(), CollabCommandError> {
    resume(&project_id, send)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_presence_set(
    project_id: String,
    path: Option<String>,
    cursor: Option<u32>,
    anchor: Option<u32>,
) -> Result<(), CollabCommandError> {
    presence_set(&project_id, path, cursor, anchor);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::doc::ProjectDoc;

    fn project(root: &Path) -> (LiveProject, DiskState, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        std::fs::write(root.join("main.tex"), "abc").unwrap();
        let layout = materialize::layout(&doc.nodes().unwrap());
        let mut hashes = std::collections::BTreeMap::new();
        hashes.insert("main.tex".to_owned(), sha256_hex(b"abc"));
        (
            LiveProject::new(doc, 0, ProjectRole::Owner),
            DiskState { layout, hashes },
            main,
        )
    }

    fn paths_of(live: &LiveProject) -> Vec<String> {
        let mut paths: Vec<String> = materialize::layout(&live.doc().nodes().unwrap())
            .values()
            .map(|placed| placed.path.clone())
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn edits_new_files_and_folders_on_disk_reach_the_document() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        std::fs::write(root.join("main.tex"), "abcd").unwrap();
        std::fs::write(root.join("new.tex"), "x").unwrap();
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("chapters/one.tex"), "y").unwrap();
        std::fs::write(root.join("figure.png"), [0x89, b'P', 0, 7]).unwrap();
        std::fs::write(root.join("project.json"), "{}").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        assert_eq!(import.blobs.len(), 1);
        assert!(
            apply_local_import(&mut live, &mut disk, &mut HashMap::new(), import, root).unwrap()
        );
        assert_eq!(live.doc().text(&main).unwrap(), "abcd");
        assert_eq!(
            paths_of(&live),
            vec![
                "chapters",
                "chapters/one.tex",
                "figure.png",
                "main.tex",
                "new.tex"
            ]
        );
        assert!(read_local_changes(root, &disk, &live, None)
            .unwrap()
            .is_empty());
        std::fs::remove_file(root.join("new.tex")).unwrap();
        let removed =
            read_local_changes(root, &disk, &live, Some(&["new.tex".to_owned()])).unwrap();
        assert_eq!(removed.removed, vec!["new.tex".to_owned()]);
        apply_local_import(&mut live, &mut disk, &mut HashMap::new(), removed, root).unwrap();
        assert!(!paths_of(&live).contains(&"new.tex".to_owned()));
    }

    #[test]
    fn a_disk_edit_is_merged_onto_newer_remote_text_instead_of_reverting_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        let mut bases = HashMap::new();
        bases.insert("main.tex".to_owned(), "abc".to_owned());
        live.local_text(&main, "abcX").unwrap();
        std::fs::write(root.join("main.tex"), "Zabc").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
        assert_eq!(live.doc().text(&main).unwrap(), "ZabcX");
        assert_eq!(bases.get("main.tex").map(String::as_str), Some("Zabc"));
    }

    #[test]
    fn a_rename_that_only_changes_case_keeps_one_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, _main) = project(root);
        let mut bases = HashMap::new();
        std::fs::rename(root.join("main.tex"), root.join("tmp.tex")).unwrap();
        std::fs::rename(root.join("tmp.tex"), root.join("Main.tex")).unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
        assert_eq!(paths_of(&live), vec!["Main.tex"]);
    }

    #[test]
    fn only_a_file_left_as_last_written_may_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (_live, disk, _main) = project(root);
        assert!(writable(root, &disk, "main.tex"));
        assert!(writable(root, &disk, "new.tex"));
        std::fs::write(root.join("main.tex"), "changed here").unwrap();
        assert!(!writable(root, &disk, "main.tex"));
        std::fs::write(root.join("new.tex"), "made here").unwrap();
        assert!(!writable(root, &disk, "new.tex"));
    }

    #[test]
    fn a_file_untouched_since_it_was_written_keeps_the_newer_document_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, disk, main) = project(root);
        live.local_text(&main, "remote edit").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        assert!(import.is_empty());
    }

    #[test]
    fn keeping_changes_local_stops_them_from_being_sent_later() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (live, mut disk, _main) = project(root);
        std::fs::write(root.join("main.tex"), "kept here").unwrap();
        assert!(!read_local_changes(root, &disk, &live, None)
            .unwrap()
            .is_empty());
        accept_local(root, &mut disk);
        assert!(read_local_changes(root, &disk, &live, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_file_changed_again_before_import_is_left_for_the_next_pass() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        std::fs::write(root.join("main.tex"), "first").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        std::fs::write(root.join("main.tex"), "second").unwrap();
        apply_local_import(&mut live, &mut disk, &mut HashMap::new(), import, root).unwrap();
        assert_eq!(live.doc().text(&main).unwrap(), "abc");
    }
}
