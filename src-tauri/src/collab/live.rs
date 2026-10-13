use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::{save_shared, DocSink, LiveProject, MergeReport};
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::ot::TextOperation;
use oleafly_collab::sync::{
    spawn_live, EndReason, LiveEvent, LiveHandle, LiveLink, LiveStatus, SharedLive,
};
use oleafly_collab::{
    load_binding, remove_binding, save_binding, CollabError, ServerClient, ServerUrl,
};
use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::frames::MemberChangeKind;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use oleafly_collab_protocol::projects::{PresenceState, ProjectRole};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::Emitter;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;

use super::commands::CollabCommandError;
use super::disk::{
    as_text, crlf_only, excluded_name, exists_exact, safe_target, scan_folder, sha256_hex,
    with_line_endings, written_as, DiskState,
};
use super::state::CollabState;
use crate::folder_watch::FolderChange;

pub mod write;

mod sync_hold;
pub(crate) use sync_hold::{announce, outside_change, root_returned, SyncDecision};

#[cfg(test)]
mod outside_tests;

pub const LIVE_STATUS_EVENT: &str = "collab-live-status";
pub const LIVE_ROLE_EVENT: &str = "collab-live-role";
pub const LIVE_MERGED_EVENT: &str = "collab-live-merged";
pub const PRESENCE_EVENT: &str = "collab-presence";
pub const PRESENCE_LEFT_EVENT: &str = "collab-presence-left";
pub const LIVE_NEW_DEVICE_EVENT: &str = "collab-live-new-device";
pub const LIVE_MEMBERS_EVENT: &str = "collab-live-members";
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MergedFile {
    pub path: String,
    pub changes: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedAuthor {
    pub account_id: AccountId,
    pub files: Vec<MergedFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MergeMarks {
    pub before: String,
    pub after: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedPayload {
    pub project_id: String,
    pub files: Vec<MergedFile>,
    pub authors: Vec<MergedAuthor>,
    pub review: MergeMarks,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDevicePayload {
    pub project_id: String,
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembersPayload {
    pub project_id: String,
    pub account_id: AccountId,
    pub by: AccountId,
    pub kind: MemberChangeKind,
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
    fn new_device(&self, payload: NewDevicePayload);
    fn renamed(&self, _payload: super::tree::RenamedPayload) {}
    fn comments_changed(&self, _payload: super::comments::CommentsChangedPayload) {}
    fn members(&self, _payload: MembersPayload) {}
    fn session_ended(&self, _server: ServerId, _reason: SessionEndReason) {}
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

    fn new_device(&self, payload: NewDevicePayload) {
        let _ = self.app.emit(LIVE_NEW_DEVICE_EVENT, payload);
    }

    fn renamed(&self, payload: super::tree::RenamedPayload) {
        let _ = self.app.emit(super::tree::LIVE_RENAMED_EVENT, payload);
    }

    fn comments_changed(&self, payload: super::comments::CommentsChangedPayload) {
        let _ = self
            .app
            .emit(super::comments::COMMENTS_CHANGED_EVENT, payload);
    }

    fn members(&self, payload: MembersPayload) {
        let _ = self.app.emit(LIVE_MEMBERS_EVENT, payload);
    }

    fn session_ended(&self, server: ServerId, reason: SessionEndReason) {
        use tauri::Manager;
        let state = self.app.state::<CollabState>();
        let host = super::commands::AppHost::new(self.app.clone());
        let _ = super::commands::note_session_end(state.inner(), &host, server, reason);
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
    bases: Mutex<WrittenTexts>,
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
    restamped: Vec<(String, String)>,
    crlf: BTreeSet<String>,
}

impl LocalImport {
    fn is_empty(&self) -> bool {
        self.texts.is_empty()
            && self.blobs.is_empty()
            && self.removed.is_empty()
            && self.dirs.is_empty()
            && self.restamped.is_empty()
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
                let text = as_text(&bytes);
                if text.is_some() && crlf_only(&bytes) == Some(true) {
                    import.crlf.insert(path.clone());
                }
                match (text, known) {
                    (Some(text), Some((id, NodeKind::Text, _))) => {
                        if live.doc().text(id)? != text {
                            import.texts.push((path, text, hash));
                        } else {
                            import.restamped.push((path, hash));
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
    checked(root, disk, path).is_some()
}

fn checked(root: &Path, disk: &DiskState, path: &str) -> Option<Option<super::disk::Stamp>> {
    inspected(root, disk, path).map(|(stamp, _)| stamp)
}

fn inspected(
    root: &Path,
    disk: &DiskState,
    path: &str,
) -> Option<(Option<super::disk::Stamp>, Option<bool>)> {
    let target = safe_target(root, path)?;
    let stamp = super::disk::stamp_of(&target);
    match std::fs::read(&target) {
        Err(_) => Some((None, None)),
        Ok(bytes) => disk
            .hashes
            .get(path)
            .is_some_and(|known| *known == sha256_hex(&bytes))
            .then(|| (stamp, crlf_only(&bytes))),
    }
}

const WRITTEN_KEPT: usize = 4;

#[derive(Default)]
struct WrittenTexts(HashMap<String, std::collections::VecDeque<String>>);

impl WrittenTexts {
    fn record(&mut self, path: &str, text: &str) {
        let kept = self.0.entry(path.to_owned()).or_default();
        if kept.back().is_some_and(|last| last == text) {
            return;
        }
        kept.push_back(text.to_owned());
        while kept.len() > WRITTEN_KEPT {
            kept.pop_front();
        }
    }

    fn latest(&self, path: &str) -> Option<&String> {
        self.0.get(path)?.back()
    }

    fn kept(&self, path: &str) -> impl Iterator<Item = &String> {
        self.0
            .get(path)
            .into_iter()
            .flat_map(|kept| kept.iter().rev())
    }

    fn base_for(&self, path: &str, found: &str) -> Option<&String> {
        let latest = self.latest(path)?;
        if self.kept(path).any(|text| text == found) {
            return Some(latest);
        }
        nearest(self.kept(path), found)
    }

    fn forget(&mut self, path: &str) {
        self.0.remove(path);
    }

    fn rename(&mut self, from: &str, to: &str) {
        if let Some(kept) = self.0.remove(from) {
            self.0.insert(to.to_owned(), kept);
        }
    }
}

fn nearest<'a>(candidates: impl Iterator<Item = &'a String>, found: &str) -> Option<&'a String> {
    let mut distinct: Vec<&'a String> = Vec::new();
    for candidate in candidates {
        if candidate == found {
            return Some(candidate);
        }
        if !distinct.contains(&candidate) {
            distinct.push(candidate);
        }
    }
    distinct
        .into_iter()
        .min_by_key(|candidate| oleafly_collab::merge::distance(candidate, found))
}

fn initial_bases(root: &Path, disk: &DiskState, live: &LiveProject) -> WrittenTexts {
    let mut bases = WrittenTexts::default();
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
                .filter(|text| written_as(text, known))
        });
        if let Some(text) = text {
            bases.record(&placed.path, &text);
        }
    }
    bases
}

fn merged_onto(base: &str, disk: &str, current: &str) -> Option<TextOperation> {
    if base == current {
        return None;
    }
    oleafly_collab::merge::rebase(base, disk, current)
}

fn apply_local_import(
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
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
    let mut import = import;
    for old in import.removed.clone() {
        let Some((id, kind, blob)) = placed.get(&old).cloned() else {
            continue;
        };
        let Some(known) = disk.hashes.get(&old).cloned() else {
            continue;
        };
        let arrived = |path: &str, hash: &str| {
            hash == known && !placed.contains_key(path) && still(path, hash)
        };
        let found = match kind {
            NodeKind::Text => import
                .texts
                .iter()
                .position(|(path, _, hash)| arrived(path, hash))
                .map(|index| import.texts.remove(index).0),
            NodeKind::Blob => import
                .blobs
                .iter()
                .position(|(path, hash, _)| arrived(path, hash))
                .map(|index| import.blobs.remove(index).0),
            NodeKind::Dir => None,
        };
        let Some(new) = found else {
            continue;
        };
        let parent = ensure_dir(live, &mut placed, parent_of(&new))?;
        live.doc_mut().move_to(&id, parent.as_deref())?;
        if name_of(&old) != name_of(&new) {
            live.doc_mut().rename(&id, name_of(&new))?;
        }
        placed.remove(&old);
        placed.insert(new.clone(), (id, kind, blob));
        if let Some(hash) = disk.hashes.remove(&old) {
            disk.hashes.insert(new.clone(), hash);
        }
        bases.rename(&old, &new);
        import.removed.retain(|path| *path != old);
        changed = true;
    }
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
                    .base_for(&path, &text)
                    .and_then(|base| merged_onto(base, &text, &current));
                changed |= match merged {
                    Some(operation) => live.local_operation(&id, &operation)?,
                    None => live.local_text(&id, &text)?,
                };
                if live.doc().text(&id)? != text {
                    live.mark_dirty(&id);
                    changed = true;
                }
            }
            Some((id, _, _)) => {
                live.doc_mut().trash(&id)?;
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let id = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Text,
                    None,
                    &text,
                )?;
                live.doc_mut().set_crlf(&id, import.crlf.contains(&path))?;
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
                live.doc_mut().set_crlf(&id, import.crlf.contains(&path))?;
                placed.insert(path.clone(), (id, NodeKind::Text, None));
                changed = true;
            }
        }
        bases.record(&path, &text);
        disk.hashes.insert(path, hash);
    }
    for (path, hash) in import.restamped {
        if still(&path, &hash) {
            disk.hashes.insert(path, hash);
        }
    }
    let mut beside = Vec::new();
    for (path, hash, _) in import.blobs {
        if !still(&path, &hash) {
            continue;
        }
        match placed.get(&path).cloned() {
            Some((id, NodeKind::Blob, _)) if disk.hashes.contains_key(&path) => {
                live.doc_mut().set_blob(&id, &hash)?
            }
            Some((theirs, NodeKind::Blob, _)) => {
                let parent = ensure_dir(live, &mut placed, parent_of(&path))?;
                let ours = live.doc_mut().add_node(
                    parent.as_deref(),
                    name_of(&path),
                    NodeKind::Blob,
                    Some(&hash),
                    "",
                )?;
                beside.push((ours, theirs, path.clone()));
            }
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
        super::tree::keep_beside(&mut disk.layout, beside);
    }
    Ok(changed)
}

struct DiskPass {
    changed: BTreeSet<String>,
    conflicts: Vec<String>,
    blobs: Vec<(String, String, Option<super::disk::Stamp>)>,
    moved: Vec<(String, String)>,
    removed: Vec<String>,
}

fn apply_to_disk(
    root: &Path,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    mut plan: materialize::DiskPlan,
    next: Layout,
    texts: &[(String, String)],
    crlf: &BTreeSet<String>,
) -> Result<DiskPass, CollabError> {
    let mut conflicts: Vec<String> = Vec::new();
    let mut changed: BTreeSet<String> = BTreeSet::new();
    let mut blobs = Vec::new();
    let mut renamed: Vec<(String, String)> = Vec::new();
    let mut gone: Vec<String> = Vec::new();
    let mut aliased = Vec::new();
    plan.removed.retain(|path| {
        match next
            .values()
            .find(|placed| super::disk::same_file(root, path, &placed.path))
        {
            Some(placed) => {
                aliased.push((path.clone(), placed.path.clone()));
                false
            }
            None => true,
        }
    });
    plan.moved.extend(aliased);
    plan.moved
        .sort_by_key(|(from, _)| from.matches('/').count());
    for (from, to) in &plan.moved {
        let moved = super::disk::move_path(root, from, to)
            || (!super::disk::exists_exact(root, from) && super::disk::exists_exact(root, to));
        if !moved {
            continue;
        }
        if !renamed
            .iter()
            .any(|(parent, _): &(String, String)| from.starts_with(&format!("{parent}/")))
        {
            renamed.push((from.clone(), to.clone()));
        }
        if let Some(hash) = disk.hashes.remove(from) {
            disk.hashes.insert(to.clone(), hash);
        }
        bases.rename(from, to);
        changed.insert(from.clone());
        changed.insert(to.clone());
    }
    for dir in &plan.dirs {
        if let Some(target) = safe_target(root, dir) {
            let _ = std::fs::create_dir_all(target);
            changed.insert(dir.clone());
        }
    }
    for (path, text) in texts {
        let Some((stamp, style)) = inspected(root, disk, path) else {
            conflicts.push(path.clone());
            continue;
        };
        let bytes = with_line_endings(text, style.unwrap_or_else(|| crlf.contains(path)));
        match super::disk::write_file_over(root, path, &bytes, stamp.as_ref())
            .map_err(CollabError::Io)?
        {
            super::disk::WriteOutcome::ChangedOutside => {
                conflicts.push(path.clone());
                continue;
            }
            super::disk::WriteOutcome::Written => {
                changed.insert(path.clone());
            }
            super::disk::WriteOutcome::Same => {}
        }
        disk.hashes.insert(path.clone(), sha256_hex(&bytes));
        bases.record(path, text);
    }
    for id in &plan.written {
        if let Some(placed) = next.get(id).filter(|placed| placed.kind == NodeKind::Blob) {
            if let Some(hash) = &placed.blob {
                let on_disk = safe_target(root, &placed.path)
                    .and_then(|target| std::fs::read(target).ok())
                    .is_some_and(|bytes| sha256_hex(&bytes) == *hash);
                if on_disk {
                    disk.hashes.insert(placed.path.clone(), hash.clone());
                } else if let Some(stamp) = checked(root, disk, &placed.path) {
                    blobs.push((placed.path.clone(), hash.clone(), stamp));
                } else {
                    conflicts.push(placed.path.clone());
                }
            }
        }
    }
    for path in &plan.removed {
        if !writable(root, disk, path) {
            conflicts.push(path.clone());
            continue;
        }
        super::disk::remove_path(root, path);
        disk.hashes.remove(path);
        bases.forget(path);
        changed.insert(path.clone());
        gone.push(path.clone());
    }
    disk.layout = next;
    let removed: Vec<String> = gone
        .iter()
        .filter(|path| {
            !gone
                .iter()
                .any(|parent| path.starts_with(&format!("{parent}/")))
        })
        .cloned()
        .collect();
    Ok(DiskPass {
        changed,
        conflicts,
        blobs,
        moved: renamed,
        removed,
    })
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
        let _ = save_shared(&self.live, &self.document_dir);
        let _ = guard(&self.disk).save(&self.disk_file);
    }

    async fn persist(&self) -> Result<(), CollabError> {
        let live = Arc::clone(&self.live);
        let dir = self.document_dir.clone();
        tauri::async_runtime::spawn_blocking(move || save_shared(&live, &dir))
            .await
            .map_err(io)?
    }

    async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        if !self.root.is_dir() {
            return Ok(());
        }
        let snapshot = guard(&self.disk).clone();
        let mut import = {
            let live = lock(&self.live);
            read_local_changes(&self.root, &snapshot, &live, only.as_deref())?
        };
        let edits = sync_hold::screen(&self.hold_dir(), &self.root, &snapshot, &mut import)?;
        if import.is_empty() && edits.is_empty() {
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
            let imported =
                apply_local_import(&mut live, &mut disk, &mut bases, import, &self.root)?;
            let kept = sync_hold::apply_kept_edits(
                &self.hold_dir(),
                &self.root,
                &mut live,
                &mut disk,
                &mut bases,
                edits,
            )?;
            imported || kept
        };
        if changed {
            self.handle.flush();
            self.kick();
            self.refresh_pending();
        }
        Ok(())
    }

    async fn write_out(&self) -> Result<Vec<String>, CollabError> {
        if !self.root.is_dir() {
            return Ok(Vec::new());
        }
        let previous = guard(&self.disk).layout.clone();
        let (work, next, mut texts, crlf) = {
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
            let mut crlf = BTreeSet::new();
            for id in ids {
                if let Some(placed) = next.get(&id).filter(|placed| placed.kind == NodeKind::Text) {
                    texts.push((placed.path.clone(), live.doc().text(&id)?));
                    if live.doc().crlf(&id) {
                        crlf.insert(placed.path.clone());
                    }
                }
            }
            (work, next, texts, crlf)
        };
        self.persist().await?;
        let mut plan = materialize::plan(&previous, &next);
        let shaped = sync_hold::shape(&self.hold_dir(), &self.root, &mut plan, &mut texts, &next);
        let structural = !plan.moved.is_empty()
            || !plan.removed.is_empty()
            || !plan.dirs.is_empty()
            || work.tree;
        let DiskPass {
            mut changed,
            mut conflicts,
            blobs,
            moved,
            removed,
        } = {
            let mut disk = guard(&self.disk);
            let mut bases = guard(&self.bases);
            apply_to_disk(&self.root, &mut disk, &mut bases, plan, next, &texts, &crlf)?
        };
        conflicts.extend(shaped.conflicts.iter().cloned());
        sync_hold::settle(&self.hold_dir(), shaped, &conflicts);
        let mut missing = false;
        if !blobs.is_empty() {
            let access = self
                .link
                .sessions
                .access_token(self.link.server_id, &self.link.client)
                .await;
            for (path, hash, stamp) in blobs {
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
                match super::disk::write_file_over(&self.root, &path, &bytes, stamp.as_ref())
                    .map_err(CollabError::Io)?
                {
                    super::disk::WriteOutcome::ChangedOutside => conflicts.push(path),
                    _ => {
                        disk.hashes.insert(path.clone(), hash);
                        changed.insert(path);
                    }
                }
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
                renamed: moved,
                deleted: removed,
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

fn placed_files(
    layout: &Layout,
    counts: std::collections::BTreeMap<String, u32>,
) -> Vec<MergedFile> {
    counts
        .into_iter()
        .filter_map(|(id, changes)| {
            layout.get(&id).map(|placed| MergedFile {
                path: placed.path.clone(),
                changes,
            })
        })
        .collect()
}

fn merged_payload(project_id: &str, layout: &Layout, report: MergeReport) -> Option<MergedPayload> {
    let files = placed_files(layout, report.files);
    if files.is_empty() {
        return None;
    }
    let authors = report
        .authors
        .into_iter()
        .map(|(account_id, counts)| MergedAuthor {
            account_id,
            files: placed_files(layout, counts),
        })
        .filter(|author| !author.files.is_empty())
        .collect();
    Some(MergedPayload {
        project_id: project_id.to_owned(),
        files,
        authors,
        review: MergeMarks {
            before: oleafly_collab::review::encode_mark(&report.before),
            after: oleafly_collab::review::encode_mark(&report.after),
        },
    })
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
                    if matches!(
                        reason,
                        EndReason::Removed | EndReason::Archived | EndReason::AccessEnded
                    ) {
                        active.detach(&paths);
                    }
                    if let Some(session) = reason.session() {
                        active.host.session_ended(active.link.server_id, session);
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
            LiveEvent::Changed => {
                let settled = super::tree::settle(&active.project_id, &active.live);
                if settled.merged {
                    active.handle.flush();
                }
                for renamed in settled.renamed {
                    active.host.renamed(renamed);
                }
                active.kick();
                super::comments::announce(
                    &active.project_id,
                    &active.live,
                    active.account_id,
                    active.host.as_ref(),
                );
            }
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
            LiveEvent::Members(change) => active.host.members(MembersPayload {
                project_id: active.project_id.clone(),
                account_id: change.account_id,
                by: change.by,
                kind: change.kind,
            }),
            LiveEvent::Merged(report) => {
                if active.quiet_merge.swap(false, Ordering::SeqCst) {
                    continue;
                }
                let layout =
                    materialize::layout(&lock(&active.live).doc().nodes().unwrap_or_default());
                if let Some(payload) = merged_payload(&active.project_id, &layout, report) {
                    active.host.merged(payload);
                }
            }
            LiveEvent::NewDevice {
                account_id,
                device_id,
            } => active.host.new_device(NewDevicePayload {
                project_id: active.project_id.clone(),
                account_id,
                device_id,
            }),
            LiveEvent::Untrusted { device_id, seq } => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration skipped change {seq} in project {}: device {device_id} did not sign it with a key this app knows",
                    active.project_id
                ));
            }
            LiveEvent::Unsendable => {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration stopped sending changes in project {}: one edit is larger than the server accepts in a single change",
                    active.project_id
                ));
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
        let status = guard(&active.last_status).clone();
        active.emit_status(status);
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
    let keys = state.keys().await?;
    let Some(tokens) = keys.sessions.tokens(binding.server_id)? else {
        if let Some(reason) = state.registry()?.ended(binding.server_id) {
            if reason == SessionEndReason::AccessEnded {
                let _ = remove_binding(&paths, project_id);
                super::registry::invalidate(project_id);
            }
            host.status(StatusPayload {
                project_id: project_id.to_owned(),
                status: LiveStatus::Ended {
                    reason: EndReason::of_session(Some(reason)),
                },
                pending: 0,
            });
        }
        return Err(CollabError::Unauthorized);
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
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
    super::tree::sign(&mut live, state, binding.server_id, tokens.account_id);
    let mut bases = initial_bases(&root, &disk, &live);
    let hold_dir = paths.project_dir(project_id)?;
    sync_hold::catch_up(&root, &hold_dir, &link, &mut live, &mut disk, &mut bases).await?;
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

pub fn document_snapshot(project_id: &str) -> Option<Result<Vec<u8>, CollabError>> {
    active_for(project_id).map(|active| lock(&active.live).doc().snapshot())
}

pub(super) fn read_live<T>(project_id: &str, work: impl FnOnce(&LiveProject) -> T) -> Option<T> {
    active_for(project_id).map(|active| work(&lock(&active.live)))
}

pub(super) fn comment_live<T>(
    project_id: &str,
    work: impl FnOnce(&mut LiveProject, AccountId) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let outcome = work(&mut lock(&active.live), active.account_id)?;
    active.save_now();
    active.handle.flush();
    active.refresh_pending();
    Ok(outcome)
}

pub(super) fn edit_live<T>(
    project_id: &str,
    work: impl FnOnce(&mut LiveProject) -> Result<T, CollabError>,
) -> Result<T, CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    let outcome = work(&mut lock(&active.live))?;
    active.handle.flush();
    active.kick();
    active.refresh_pending();
    Ok(outcome)
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

pub fn presence_leave(project_id: &str) {
    if let Some(active) = active_for(project_id) {
        active.handle.leave_presence();
    }
}

pub(crate) struct KnownContent {
    active: Option<Arc<Active>>,
    hashes: std::collections::BTreeMap<String, String>,
}

pub(crate) fn known_content(project_id: &str) -> KnownContent {
    if let Some(active) = active_for(project_id) {
        let hashes = guard(&active.disk).hashes.clone();
        return KnownContent {
            active: Some(active),
            hashes,
        };
    }
    let hashes = crate::paths::collab_root()
        .ok()
        .and_then(|root| {
            oleafly_collab::CollabPaths::new(root)
                .materializer_index_file(project_id)
                .ok()
        })
        .map(|file| DiskState::load(&file).hashes)
        .unwrap_or_default();
    KnownContent {
        active: None,
        hashes,
    }
}

impl KnownContent {
    pub(crate) fn holds(&self, root: &Path, path: &str) -> bool {
        let Some(bytes) = safe_target(root, path).and_then(|target| std::fs::read(target).ok())
        else {
            return false;
        };
        if self
            .hashes
            .get(path)
            .is_some_and(|known| *known == sha256_hex(&bytes))
        {
            return true;
        }
        let (Some(active), Some(text)) = (&self.active, as_text(&bytes)) else {
            return false;
        };
        let live = lock(&active.live);
        let Ok(nodes) = live.doc().nodes() else {
            return false;
        };
        materialize::layout(&nodes)
            .iter()
            .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
            .and_then(|(id, _)| live.doc().text(id).ok())
            .is_some_and(|shared| shared == text)
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

pub async fn resume(project_id: &str, decision: SyncDecision) -> Result<(), CollabError> {
    let active = active_for(project_id).ok_or_else(not_live)?;
    active.decide(decision).await
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
        let _ = tokio::fs::remove_dir_all(dir).await;
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
    announce(&project_id, &app);
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
pub async fn collab_sync_resume(
    project_id: String,
    decision: SyncDecision,
) -> Result<(), CollabCommandError> {
    resume(&project_id, decision)
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

#[tauri::command]
pub async fn collab_presence_leave(project_id: String) -> Result<(), CollabCommandError> {
    presence_leave(&project_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::doc::ProjectDoc;
    use oleafly_collab_protocol::frames::MemberChange;

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
    fn a_different_figure_under_a_name_never_written_here_is_kept_beside_the_shared_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, _main) = project(root);
        live.doc_mut().set_author("acct-bob", "Bob Smith");
        let mut alice = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
        alice.set_author("acct-alice", "Alice Chen");
        let theirs = alice
            .add_node(None, "plot.png", NodeKind::Blob, Some("alicehash"), "")
            .unwrap();
        let update = alice.export_since(&live.doc().version()).unwrap();
        assert!(live.import_update(1, &update).unwrap());
        let bytes = [0x89, b'P', 1, 2];
        std::fs::write(root.join("plot.png"), bytes).unwrap();
        let only = ["plot.png".to_owned()];
        let import = read_local_changes(root, &disk, &live, Some(&only)).unwrap();
        apply_local_import(
            &mut live,
            &mut disk,
            &mut WrittenTexts::default(),
            import,
            root,
        )
        .unwrap();
        let nodes = live.doc().nodes().unwrap();
        let ours = nodes
            .iter()
            .find(|node| node.kind == NodeKind::Blob && node.id != theirs)
            .expect("the local figure became its own file")
            .id
            .clone();
        let next = materialize::layout(&nodes);
        assert_eq!(next[&theirs].blob.as_deref(), Some("alicehash"));
        assert_eq!(next[&ours].blob, Some(sha256_hex(&bytes)));
        assert_eq!(next[&theirs].path, "plot.png");
        assert_eq!(next[&ours].path, "plot (from Bob Smith).png");
        assert_eq!(
            disk.layout.get(&ours).map(|placed| placed.path.as_str()),
            Some("plot.png")
        );
        assert!(!disk.layout.contains_key(&theirs));
        let plan = materialize::plan(&disk.layout, &next);
        let pass = apply_to_disk(
            root,
            &mut disk,
            &mut WrittenTexts::default(),
            plan,
            next,
            &[],
            &BTreeSet::new(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(root.join("plot (from Bob Smith).png")).unwrap(),
            bytes
        );
        let fetched: Vec<(&str, &str)> = pass
            .blobs
            .iter()
            .map(|(path, hash, _)| (path.as_str(), hash.as_str()))
            .collect();
        assert_eq!(fetched, vec![("plot.png", "alicehash")]);
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
        assert!(apply_local_import(
            &mut live,
            &mut disk,
            &mut WrittenTexts::default(),
            import,
            root
        )
        .unwrap());
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
        apply_local_import(
            &mut live,
            &mut disk,
            &mut WrittenTexts::default(),
            removed,
            root,
        )
        .unwrap();
        assert!(!paths_of(&live).contains(&"new.tex".to_owned()));
    }

    #[test]
    fn a_disk_edit_is_merged_onto_newer_remote_text_instead_of_reverting_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        let mut bases = WrittenTexts::default();
        bases.record("main.tex", "abc");
        live.local_text(&main, "abcX").unwrap();
        std::fs::write(root.join("main.tex"), "Zabc").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
        assert_eq!(live.doc().text(&main).unwrap(), "ZabcX");
        assert_eq!(bases.latest("main.tex").map(String::as_str), Some("Zabc"));
    }

    #[test]
    fn an_outside_write_from_an_older_read_keeps_the_newer_remote_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        let mut bases = WrittenTexts::default();
        bases.record("main.tex", "abc");
        live.local_text(&main, "abcX").unwrap();
        bases.record("main.tex", "abcX");
        std::fs::write(root.join("main.tex"), "Zabc").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
        assert_eq!(live.doc().text(&main).unwrap(), "ZabcX");
    }

    struct SilentHost;

    impl LiveHost for SilentHost {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
    }

    #[test]
    fn starting_live_again_for_a_live_project_answers() {
        let (done, outcome) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                let dir = tempfile::tempdir().unwrap();
                let state = CollabState::new(
                    oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                    Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
                );
                let keys = state.keys().await.unwrap();
                let link = LiveLink {
                    client: Arc::new(
                        ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                    ),
                    server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                    project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                    device_id: DeviceId::new_v7(),
                    key: Arc::clone(&keys.key),
                    sessions: Arc::clone(&keys.sessions),
                };
                let root = dir.path().join("project");
                std::fs::create_dir_all(&root).unwrap();
                let (live, disk, _) = project(&root);
                let shared: SharedLive = Arc::new(Mutex::new(live));
                let (events, _events) = mpsc::unbounded_channel();
                let (writer, _writer) = mpsc::unbounded_channel();
                let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
                let active = Arc::new(Active {
                    project_id: "already-live".to_owned(),
                    root,
                    document_dir: dir.path().join("document"),
                    disk_file: dir.path().join("disk.json"),
                    live: shared,
                    handle,
                    link,
                    disk: Mutex::new(disk),
                    host: Arc::new(SilentHost),
                    writer,
                    account_id: AccountId::new_v7(),
                    quiet_merge: AtomicBool::new(false),
                    waiting: AtomicBool::new(false),
                    last_status: Mutex::new(LiveStatus::Connecting),
                    bases: Mutex::new(WrittenTexts::default()),
                });
                *guard(&ACTIVE) = Some(Arc::clone(&active));
                let again = start(&state, Arc::new(SilentHost), "already-live").await;
                *guard(&ACTIVE) = None;
                active.handle.stop();
                let _ = done.send(again.is_ok());
            });
        });
        let answered = outcome.recv_timeout(Duration::from_secs(10));
        assert_eq!(
            answered,
            Ok(true),
            "starting a project that is already live never answered"
        );
    }

    fn hashes_for(entries: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
        entries
            .iter()
            .map(|(path, text)| ((*path).to_owned(), sha256_hex(text.as_bytes())))
            .collect()
    }

    #[test]
    fn a_case_rename_that_arrives_as_remove_and_add_keeps_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("data/sites.tex"), "s").unwrap();
        let mut doc = ProjectDoc::create().unwrap();
        let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
        let old = doc
            .add_node(Some(&folder), "sites.tex", NodeKind::Text, None, "s")
            .unwrap();
        let previous = materialize::layout(&doc.nodes().unwrap());
        doc.trash(&old).unwrap();
        doc.add_node(Some(&folder), "Sites.tex", NodeKind::Text, None, "s")
            .unwrap();
        let next = materialize::layout(&doc.nodes().unwrap());
        let mut disk = DiskState {
            layout: previous.clone(),
            hashes: hashes_for(&[("data/sites.tex", "s")]),
        };
        let plan = materialize::plan(&previous, &next);
        let texts = vec![("data/Sites.tex".to_owned(), "s".to_owned())];
        let pass = apply_to_disk(
            root,
            &mut disk,
            &mut WrittenTexts::default(),
            plan,
            next,
            &texts,
            &BTreeSet::new(),
        )
        .unwrap();
        assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
        if root.join("DATA").exists() || std::fs::metadata(root.join("data/SITES.TEX")).is_ok() {
            assert_eq!(
                pass.moved,
                vec![("data/sites.tex".to_owned(), "data/Sites.tex".to_owned())]
            );
        }
        assert!(super::super::disk::exists_exact(root, "data/Sites.tex"));
        assert_eq!(
            std::fs::read_to_string(root.join("data/Sites.tex")).unwrap(),
            "s"
        );
        assert!(disk.hashes.contains_key("data/Sites.tex"));
    }

    #[test]
    fn files_in_a_folder_renamed_elsewhere_stay_writable() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("data/x.tex"), "x").unwrap();
        let mut doc = ProjectDoc::create().unwrap();
        let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
        doc.add_node(Some(&folder), "x.tex", NodeKind::Text, None, "x")
            .unwrap();
        let previous = materialize::layout(&doc.nodes().unwrap());
        doc.rename(&folder, "results").unwrap();
        let next = materialize::layout(&doc.nodes().unwrap());
        let mut disk = DiskState {
            layout: previous.clone(),
            hashes: hashes_for(&[("data/x.tex", "x")]),
        };
        let plan = materialize::plan(&previous, &next);
        let texts = vec![("results/x.tex".to_owned(), "x".to_owned())];
        let pass = apply_to_disk(
            root,
            &mut disk,
            &mut WrittenTexts::default(),
            plan,
            next,
            &texts,
            &BTreeSet::new(),
        )
        .unwrap();
        assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
        assert_eq!(
            std::fs::read_to_string(root.join("results/x.tex")).unwrap(),
            "x"
        );
        assert_eq!(pass.moved, vec![("data".to_owned(), "results".to_owned())]);
        assert!(pass.removed.is_empty());
        assert!(!root.join("data").exists());
        assert!(disk.hashes.contains_key("results/x.tex"));
        assert!(!disk.hashes.contains_key("data/x.tex"));
    }

    #[test]
    fn a_folder_removed_elsewhere_is_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("data/x.tex"), "x").unwrap();
        std::fs::write(root.join("keep.tex"), "k").unwrap();
        let mut doc = ProjectDoc::create().unwrap();
        let folder = doc.add_node(None, "data", NodeKind::Dir, None, "").unwrap();
        doc.add_node(Some(&folder), "x.tex", NodeKind::Text, None, "x")
            .unwrap();
        doc.add_node(None, "keep.tex", NodeKind::Text, None, "k")
            .unwrap();
        let previous = materialize::layout(&doc.nodes().unwrap());
        doc.trash(&folder).unwrap();
        let next = materialize::layout(&doc.nodes().unwrap());
        let mut disk = DiskState {
            layout: previous.clone(),
            hashes: hashes_for(&[("data/x.tex", "x"), ("keep.tex", "k")]),
        };
        let plan = materialize::plan(&previous, &next);
        let pass = apply_to_disk(
            root,
            &mut disk,
            &mut WrittenTexts::default(),
            plan,
            next,
            &[],
            &BTreeSet::new(),
        )
        .unwrap();
        assert!(!root.join("data").exists());
        assert!(root.join("keep.tex").exists());
        assert_eq!(pass.removed, vec!["data".to_owned()]);
    }

    #[test]
    fn a_file_renamed_here_keeps_its_identity() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        std::fs::create_dir_all(root.join("parts")).unwrap();
        std::fs::rename(root.join("main.tex"), root.join("parts/intro.tex")).unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(
            &mut live,
            &mut disk,
            &mut WrittenTexts::default(),
            import,
            root,
        )
        .unwrap();
        assert_eq!(paths_of(&live), vec!["parts", "parts/intro.tex"]);
        let layout = materialize::layout(&live.doc().nodes().unwrap());
        assert_eq!(
            layout.get(&main).map(|placed| placed.path.as_str()),
            Some("parts/intro.tex")
        );
        assert_eq!(live.doc().text(&main).unwrap(), "abc");
        assert!(disk.hashes.contains_key("parts/intro.tex"));
        assert!(!disk.hashes.contains_key("main.tex"));
    }

    #[test]
    fn a_rename_that_only_changes_case_keeps_one_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        let mut bases = WrittenTexts::default();
        std::fs::rename(root.join("main.tex"), root.join("tmp.tex")).unwrap();
        std::fs::rename(root.join("tmp.tex"), root.join("Main.tex")).unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        apply_local_import(&mut live, &mut disk, &mut bases, import, root).unwrap();
        assert_eq!(paths_of(&live), vec!["Main.tex"]);
        let layout = materialize::layout(&live.doc().nodes().unwrap());
        assert_eq!(
            layout.get(&main).map(|placed| placed.path.as_str()),
            Some("Main.tex")
        );
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
    fn a_file_changed_again_before_import_is_left_for_the_next_pass() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (mut live, mut disk, main) = project(root);
        std::fs::write(root.join("main.tex"), "first").unwrap();
        let import = read_local_changes(root, &disk, &live, None).unwrap();
        std::fs::write(root.join("main.tex"), "second").unwrap();
        apply_local_import(
            &mut live,
            &mut disk,
            &mut WrittenTexts::default(),
            import,
            root,
        )
        .unwrap();
        assert_eq!(live.doc().text(&main).unwrap(), "abc");
    }

    #[derive(Default)]
    struct RecordingHost {
        new_devices: Mutex<Vec<NewDevicePayload>>,
        merged: Mutex<Vec<MergedPayload>>,
    }

    impl LiveHost for RecordingHost {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, payload: MergedPayload) {
            guard(&self.merged).push(payload);
        }
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, payload: NewDevicePayload) {
            guard(&self.new_devices).push(payload);
        }
    }

    #[derive(Default)]
    struct EndingHost {
        statuses: Mutex<Vec<StatusPayload>>,
        members: Mutex<Vec<MembersPayload>>,
        ended: Mutex<Vec<(ServerId, SessionEndReason)>>,
    }

    impl LiveHost for EndingHost {
        fn status(&self, payload: StatusPayload) {
            guard(&self.statuses).push(payload);
        }
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn members(&self, payload: MembersPayload) {
            guard(&self.members).push(payload);
        }
        fn session_ended(&self, server: ServerId, reason: SessionEndReason) {
            guard(&self.ended).push((server, reason));
        }
    }

    fn binding_on(server: ServerId) -> oleafly_collab::ShareBinding {
        oleafly_collab::ShareBinding {
            server_url: "http://127.0.0.1:9".to_owned(),
            server_id: server,
            shared_project_id: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
            role: ProjectRole::Editor,
            created_at: 1,
        }
    }

    fn ended_with(statuses: &[StatusPayload]) -> Vec<(String, LiveStatus)> {
        statuses
            .iter()
            .map(|payload| (payload.project_id.clone(), payload.status.clone()))
            .collect()
    }

    #[test]
    fn the_pump_forwards_people_changes_and_lets_go_when_access_ended() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let server = ServerId::new_v7();
            let paths = state.paths().unwrap().clone();
            save_binding(&paths, "ending", &binding_on(server)).unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: server,
                project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            let (live, disk, _main) = project(&root);
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (unused, _unused) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
            let host = Arc::new(EndingHost::default());
            let active = Arc::new(Active {
                project_id: "ending".to_owned(),
                root,
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(disk),
                host: Arc::clone(&host) as Arc<dyn LiveHost>,
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
            });
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(Arc::downgrade(&active), receiver, paths.clone()));
            let (carol, owner) = (AccountId::new_v7(), AccountId::new_v7());
            events
                .send(LiveEvent::Members(MemberChange {
                    account_id: carol,
                    by: owner,
                    kind: MemberChangeKind::Removed,
                }))
                .unwrap();
            events
                .send(LiveEvent::Status(LiveStatus::Ended {
                    reason: EndReason::AccessEnded,
                }))
                .unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
            assert_eq!(
                *guard(&host.members),
                vec![MembersPayload {
                    project_id: "ending".to_owned(),
                    account_id: carol,
                    by: owner,
                    kind: MemberChangeKind::Removed,
                }]
            );
            assert_eq!(
                *guard(&host.ended),
                vec![(server, SessionEndReason::AccessEnded)]
            );
            assert!(load_binding(&paths, "ending").unwrap().is_none());
        });
    }

    #[test]
    fn opening_a_project_after_its_session_ended_says_why() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let paths = state.paths().unwrap().clone();
            let (paused, gone, plain) =
                (ServerId::new_v7(), ServerId::new_v7(), ServerId::new_v7());
            for (project, server) in [("paused", paused), ("gone", gone), ("plain", plain)] {
                save_binding(&paths, project, &binding_on(server)).unwrap();
            }
            state
                .update_registry(|registry| {
                    for server in [paused, gone, plain] {
                        registry.upsert(oleafly_collab::ServerEntry {
                            server_id: server,
                            url: "http://127.0.0.1:9".to_owned(),
                            name: "Smith Lab".to_owned(),
                            icon_url: None,
                            account: None,
                            added_at: 1,
                        });
                    }
                    registry.set_ended(paused, Some(SessionEndReason::AccountSuspended));
                    registry.set_ended(gone, Some(SessionEndReason::AccessEnded));
                })
                .unwrap();
            let host = Arc::new(EndingHost::default());
            for project in ["paused", "gone", "plain"] {
                let started = start(&state, Arc::clone(&host) as Arc<dyn LiveHost>, project).await;
                assert!(
                    matches!(started, Err(CollabError::Unauthorized)),
                    "{project}"
                );
            }
            assert_eq!(
                ended_with(&guard(&host.statuses)),
                vec![
                    (
                        "paused".to_owned(),
                        LiveStatus::Ended {
                            reason: EndReason::AccountSuspended
                        }
                    ),
                    (
                        "gone".to_owned(),
                        LiveStatus::Ended {
                            reason: EndReason::AccessEnded
                        }
                    ),
                ]
            );
            assert!(load_binding(&paths, "paused").unwrap().is_some());
            assert!(load_binding(&paths, "gone").unwrap().is_none());
            assert!(load_binding(&paths, "plain").unwrap().is_some());
        });
    }

    #[test]
    fn the_pump_forwards_new_devices_and_merges_with_their_authors_and_review_marks() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            let (live, disk, main) = project(&root);
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (unused, _unused) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
            let host = Arc::new(RecordingHost::default());
            let active = Arc::new(Active {
                project_id: "reviewed".to_owned(),
                root,
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(disk),
                host: Arc::clone(&host) as Arc<dyn LiveHost>,
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
            });
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(
                Arc::downgrade(&active),
                receiver,
                state.paths().unwrap().clone(),
            ));
            let (alice, tablet) = (AccountId::new_v7(), DeviceId::new_v7());
            events
                .send(LiveEvent::NewDevice {
                    account_id: alice,
                    device_id: tablet,
                })
                .unwrap();
            let counts = std::collections::BTreeMap::from([(main.clone(), 2)]);
            events
                .send(LiveEvent::Merged(MergeReport {
                    before: vec![1, 2],
                    after: vec![3],
                    files: counts.clone(),
                    authors: std::collections::BTreeMap::from([(alice, counts)]),
                }))
                .unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
            assert_eq!(
                *guard(&host.new_devices),
                vec![NewDevicePayload {
                    project_id: "reviewed".to_owned(),
                    account_id: alice,
                    device_id: tablet,
                }]
            );
            let merged = guard(&host.merged).clone();
            assert_eq!(merged.len(), 1);
            let main_file = MergedFile {
                path: "main.tex".to_owned(),
                changes: 2,
            };
            assert_eq!(merged[0].files, vec![main_file.clone()]);
            assert_eq!(
                merged[0].authors,
                vec![MergedAuthor {
                    account_id: alice,
                    files: vec![main_file],
                }]
            );
            assert_eq!(
                merged[0].review,
                MergeMarks {
                    before: oleafly_collab::review::encode_mark(&[1, 2]),
                    after: oleafly_collab::review::encode_mark(&[3]),
                }
            );
        });
    }

    #[derive(Default)]
    struct CommentHost(Mutex<Vec<super::super::comments::CommentsChangedPayload>>);

    impl LiveHost for CommentHost {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn comments_changed(&self, payload: super::super::comments::CommentsChangedPayload) {
            guard(&self.0).push(payload);
        }
    }

    #[test]
    fn the_pump_announces_comments_that_arrive_from_others() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let root = dir.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            let (mut live, disk, main) = project(&root);
            let mut other = LiveProject::new(
                ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap(),
                0,
                ProjectRole::Editor,
            );
            other
                .comment_doc()
                .create_comment_thread(&main, 0, 2, AccountId::new_v7(), 1, "Hi", &[])
                .unwrap();
            let sent = other.next_outgoing().unwrap().unwrap();
            assert!(live.import_update(1, &sent.payload).unwrap());
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (unused, _unused) = mpsc::unbounded_channel();
            let (writer, _writer) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), unused);
            let host = Arc::new(CommentHost::default());
            let active = Arc::new(Active {
                project_id: "commented".to_owned(),
                root,
                document_dir: dir.path().join("document"),
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(disk),
                host: Arc::clone(&host) as Arc<dyn LiveHost>,
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
            });
            let (events, receiver) = mpsc::unbounded_channel();
            let pumping = tokio::spawn(pump(
                Arc::downgrade(&active),
                receiver,
                state.paths().unwrap().clone(),
            ));
            events.send(LiveEvent::Changed).unwrap();
            events.send(LiveEvent::Changed).unwrap();
            drop(events);
            pumping.await.unwrap();
            active.handle.stop();
            let heard = guard(&host.0).clone();
            assert_eq!(heard.len(), 1);
            assert_eq!(heard[0].project_id, "commented");
            assert_eq!(heard[0].file_ids, vec![main]);
            assert_eq!(heard[0].paths, vec!["main.tex".to_owned()]);
        });
    }

    #[cfg(unix)]
    struct BlockedSave {
        runtime: tokio::runtime::Runtime,
        active: Arc<Active>,
        log: PathBuf,
        _dir: tempfile::TempDir,
        _channels: (
            UnboundedReceiver<LiveEvent>,
            UnboundedReceiver<WriterSignal>,
        ),
    }

    #[cfg(unix)]
    fn blocked_save() -> BlockedSave {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        let document_dir = dir.path().join("document");
        std::fs::create_dir_all(&root).unwrap();
        let (mut live, disk, main) = project(&root);
        live.save(&document_dir).unwrap();
        let log = document_dir.join("doc.log");
        assert!(std::process::Command::new("mkfifo")
            .arg(&log)
            .status()
            .unwrap()
            .success());
        let mut seed = 0x2545_f491_4f6c_dd1d_u64;
        let large: String = (0..1_000_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                char::from(b'a' + (seed % 26) as u8)
            })
            .collect();
        live.local_text(&main, &large).unwrap();
        live.mark_all_dirty().unwrap();
        let (active, channels) = runtime.block_on(async {
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(dir.path().join("collab")),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
            let keys = state.keys().await.unwrap();
            let link = LiveLink {
                client: Arc::new(
                    ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
                ),
                server_id: oleafly_collab_protocol::ids::ServerId::new_v7(),
                project: oleafly_collab_protocol::ids::SharedProjectId::new_v7(),
                device_id: DeviceId::new_v7(),
                key: Arc::clone(&keys.key),
                sessions: Arc::clone(&keys.sessions),
            };
            let shared: SharedLive = Arc::new(Mutex::new(live));
            let (events, events_rx) = mpsc::unbounded_channel();
            let (writer, writer_rx) = mpsc::unbounded_channel();
            let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
            let active = Arc::new(Active {
                project_id: "saving".to_owned(),
                root,
                document_dir,
                disk_file: dir.path().join("disk.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(disk),
                host: Arc::new(SilentHost),
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(WrittenTexts::default()),
            });
            (active, (events_rx, writer_rx))
        });
        BlockedSave {
            runtime,
            active,
            log,
            _dir: dir,
            _channels: channels,
        }
    }

    #[cfg(unix)]
    fn live_lock_free_while_the_log_is_written(blocked: &BlockedSave) -> bool {
        use std::io::Read;
        let (opened, reader) = std::sync::mpsc::channel();
        let path = blocked.log.clone();
        std::thread::spawn(move || {
            let _ = opened.send(std::fs::File::open(path));
        });
        let mut reader = reader
            .recv_timeout(Duration::from_secs(30))
            .expect("the save never opened its change log")
            .unwrap();
        let mut first = [0u8; 1];
        reader.read_exact(&mut first).unwrap();
        let (taken, took) = std::sync::mpsc::channel();
        let shared = Arc::clone(&blocked.active.live);
        std::thread::spawn(move || {
            let _held = lock(&shared);
            let _ = taken.send(());
        });
        let free = took.recv_timeout(Duration::from_secs(5)).is_ok();
        std::io::copy(&mut reader, &mut std::io::sink()).unwrap();
        free
    }

    #[cfg(unix)]
    #[test]
    fn saving_now_leaves_the_live_document_free_while_the_disk_is_written() {
        let blocked = blocked_save();
        let (done, finished) = std::sync::mpsc::channel();
        let active = Arc::clone(&blocked.active);
        std::thread::spawn(move || {
            active.save_now();
            let _ = done.send(());
        });
        let free = live_lock_free_while_the_log_is_written(&blocked);
        finished.recv_timeout(Duration::from_secs(30)).unwrap();
        blocked.active.handle.stop();
        assert!(
            free,
            "typing and comment reads waited for the change log to reach the disk"
        );
    }

    #[cfg(unix)]
    #[test]
    fn writing_out_leaves_the_live_document_free_while_the_disk_is_written() {
        let blocked = blocked_save();
        let active = Arc::clone(&blocked.active);
        let writing = blocked
            .runtime
            .spawn(async move { active.write_out().await.map(|_| ()) });
        let free = live_lock_free_while_the_log_is_written(&blocked);
        let outcome = blocked
            .runtime
            .block_on(async { tokio::time::timeout(Duration::from_secs(30), writing).await });
        assert!(matches!(outcome, Ok(Ok(_))), "writing out never finished");
        blocked.active.handle.stop();
        assert!(
            free,
            "typing and comment reads waited for the change log to reach the disk"
        );
    }
}
