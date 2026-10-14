use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize::{self, DiskPlan, Layout};
use oleafly_collab::ot::TextOperation;
use oleafly_collab::{evaluate, write_atomic, CollabError, MassChangeThreshold, MassChangeVerdict};
use serde::{Deserialize, Serialize};

use super::super::disk::{as_text, exists_exact, safe_target, sha256_hex, written_as, DiskState};
use super::super::guard::{PauseReason, SyncPauseHost, SyncPaused};
use super::{active_for, by_path, guard, lock, Active, LocalImport, WrittenTexts};
use crate::folder_watch::FolderChange;

const HOLD_FILE: &str = "sync-hold.json";
const KEPT_DIR: &str = "sync-kept";

static HOLD_LOCK: Mutex<()> = Mutex::new(());

fn hold_lock() -> MutexGuard<'static, ()> {
    HOLD_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncDecision {
    Send,
    KeepLocal,
}

fn covers(parent: &str, path: &str) -> bool {
    path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn moved_to(from: &str, to: &str, path: &str) -> String {
    format!("{to}{}", &path[from.len()..])
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Pending {
    changed: usize,
    total: usize,
    #[serde(default)]
    everything: bool,
    #[serde(default)]
    paths: BTreeSet<String>,
}

impl Pending {
    fn holds(&self, path: &str) -> bool {
        self.everything || self.paths.iter().any(|held| covers(held, path))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Kept {
    Text,
    Blob,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct KeptText {
    doc: String,
    disk: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Hold {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<Pending>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    kept: BTreeMap<String, Kept>,
}

fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

fn kept_file(dir: &Path, path: &str) -> PathBuf {
    dir.join(KEPT_DIR)
        .join(format!("{}.json", sha256_hex(path.as_bytes())))
}

fn load_text(dir: &Path, path: &str) -> Option<KeptText> {
    std::fs::read(kept_file(dir, path))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn store_text(dir: &Path, path: &str, text: &KeptText) -> Result<(), CollabError> {
    let json = serde_json::to_vec(text).map_err(|error| CollabError::Corrupt(error.to_string()))?;
    write_atomic(&kept_file(dir, path), &json)
}

impl Hold {
    fn load(dir: &Path) -> Hold {
        std::fs::read(dir.join(HOLD_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, dir: &Path) -> Result<(), CollabError> {
        let file = dir.join(HOLD_FILE);
        if self.pending.is_none() && self.kept.is_empty() {
            return match std::fs::remove_file(&file) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io(error)),
                _ => Ok(()),
            };
        }
        let json =
            serde_json::to_vec(self).map_err(|error| CollabError::Corrupt(error.to_string()))?;
        write_atomic(&file, &json)
    }

    fn is_quiet(&self) -> bool {
        self.pending.is_none() && self.kept.is_empty()
    }

    fn holds(&self, path: &str) -> bool {
        self.pending
            .as_ref()
            .is_some_and(|pending| pending.holds(path))
    }

    fn kind(&self, path: &str) -> Option<Kept> {
        self.kept.get(path).copied()
    }

    fn forget(&mut self, dir: &Path, path: &str) {
        if self.kept.remove(path) == Some(Kept::Text) {
            let _ = std::fs::remove_file(kept_file(dir, path));
        }
    }

    fn rekey(&mut self, dir: &Path, from: &str, to: &str) {
        let moved: Vec<String> = self
            .kept
            .keys()
            .filter(|path| covers(from, path))
            .cloned()
            .collect();
        for old in moved {
            let new = moved_to(from, to, &old);
            let Some(kind) = self.kept.remove(&old) else {
                continue;
            };
            if kind == Kept::Text {
                if let Some(text) = load_text(dir, &old) {
                    let _ = store_text(dir, &new, &text);
                }
                let _ = std::fs::remove_file(kept_file(dir, &old));
            }
            self.kept.insert(new, kind);
        }
        if let Some(pending) = self.pending.as_mut() {
            let moved: Vec<String> = pending
                .paths
                .iter()
                .filter(|path| covers(from, path))
                .cloned()
                .collect();
            for old in moved {
                pending.paths.remove(&old);
                pending.paths.insert(moved_to(from, to, &old));
            }
        }
    }
}

fn rebase(base: &str, changed: &str, onto: &str) -> Option<TextOperation> {
    oleafly_collab::merge::rebase(base, changed, onto)
}

fn read_text(root: &Path, path: &str) -> Option<String> {
    safe_target(root, path)
        .and_then(|target| std::fs::read(target).ok())
        .and_then(|bytes| as_text(&bytes))
}

fn recorded(bases: &WrittenTexts, disk: &DiskState, path: &str) -> Option<String> {
    let known = disk.hashes.get(path)?;
    bases
        .0
        .get(path)?
        .iter()
        .rev()
        .find(|text| written_as(text, known))
        .cloned()
}

fn collab_dir(project_id: &str) -> Option<PathBuf> {
    oleafly_collab::CollabPaths::new(crate::paths::collab_root().ok()?)
        .project_dir(project_id)
        .ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Route {
    Import,
    Wait,
}

fn route(
    dir: &Path,
    project_id: &str,
    change: &FolderChange,
    verdict: MassChangeVerdict,
    host: &dyn SyncPauseHost,
) -> Result<Route, CollabError> {
    if verdict == MassChangeVerdict::RootUnavailable {
        return Ok(Route::Wait);
    }
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    let existed = hold.pending.is_some();
    if !existed && verdict == MassChangeVerdict::Apply {
        return Ok(Route::Import);
    }
    let pending = hold.pending.get_or_insert_with(Pending::default);
    let (held_before, everything_before) = (pending.paths.len(), pending.everything);
    if change.rescan {
        pending.everything = true;
    } else {
        pending.paths.extend(change.paths.iter().cloned());
    }
    let added = pending.paths.len() - held_before;
    match verdict {
        MassChangeVerdict::Pause { changed, total } if !existed => {
            pending.changed = changed;
            pending.total = total;
        }
        MassChangeVerdict::Pause { total, .. } => {
            pending.changed += added;
            pending.total = pending.total.max(total);
        }
        _ => pending.changed += added,
    }
    let grew = existed && (added > 0 || pending.everything != everything_before);
    let announced = SyncPaused {
        project_id: project_id.to_owned(),
        changed: pending.changed,
        total: pending.total,
        reason: PauseReason::MassChange,
    };
    hold.save(dir)?;
    if grew {
        host.sync_paused(&announced);
    }
    Ok(Route::Wait)
}

impl Active {
    pub(super) fn hold_dir(&self) -> PathBuf {
        self.disk_file
            .parent()
            .map_or_else(|| self.document_dir.clone(), Path::to_path_buf)
    }

    pub(crate) async fn outside(
        &self,
        change: &FolderChange,
        verdict: MassChangeVerdict,
        host: &dyn SyncPauseHost,
    ) -> Result<(), CollabError> {
        if route(&self.hold_dir(), &self.project_id, change, verdict, host)? == Route::Import {
            self.import_paths((!change.rescan).then(|| change.paths.clone()))
                .await?;
        }
        Ok(())
    }

    pub(crate) async fn decide(&self, decision: SyncDecision) -> Result<(), CollabError> {
        let dir = self.hold_dir();
        let only = {
            let _lock = hold_lock();
            let mut hold = Hold::load(&dir);
            let Some(pending) = hold.pending.clone() else {
                return Ok(());
            };
            if decision == SyncDecision::Send {
                hold.pending = None;
                hold.save(&dir)?;
            }
            (!pending.everything).then(|| pending.paths.into_iter().collect::<Vec<_>>())
        };
        match decision {
            SyncDecision::Send => self.import_paths(only).await,
            SyncDecision::KeepLocal => self.keep_local(only.as_deref()),
        }
    }

    fn keep_local(&self, only: Option<&[String]>) -> Result<(), CollabError> {
        let dir = self.hold_dir();
        {
            let mut disk = guard(&self.disk);
            let placed = super::import::placed_now(&lock(&self.live))?;
            let scanned = super::import::scan_local(&self.root, &disk, &placed, only)?;
            let mut live = lock(&self.live);
            let mut bases = guard(&self.bases);
            let import = scanned.classify(&live);
            let placed = by_path(&materialize::layout(&live.doc().nodes()?));
            let _lock = hold_lock();
            let mut hold = Hold::load(&dir);
            for (path, text, hash) in import.texts {
                match placed.get(&path) {
                    Some((id, NodeKind::Text, _)) => {
                        let earlier = (hold.kind(&path) == Some(Kept::Text))
                            .then(|| load_text(&dir, &path))
                            .flatten()
                            .map(|kept| kept.doc);
                        let doc = match earlier.or_else(|| recorded(&bases, &disk, &path)) {
                            Some(doc) => doc,
                            None => live.doc().text(id)?,
                        };
                        store_text(
                            &dir,
                            &path,
                            &KeptText {
                                doc,
                                disk: text.clone(),
                            },
                        )?;
                        hold.kept.insert(path.clone(), Kept::Text);
                        bases.record(&path, &text);
                        disk.hashes.insert(path, hash);
                    }
                    Some(_) => {
                        hold.forget(&dir, &path);
                        hold.kept.insert(path.clone(), Kept::Blob);
                        disk.hashes.insert(path, hash);
                    }
                    None => {
                        hold.forget(&dir, &path);
                        hold.kept.insert(path, Kept::Added);
                    }
                }
            }
            for (path, hash, _) in import.blobs {
                hold.forget(&dir, &path);
                if placed.contains_key(&path) {
                    hold.kept.insert(path.clone(), Kept::Blob);
                    disk.hashes.insert(path, hash);
                } else {
                    hold.kept.insert(path, Kept::Added);
                }
            }
            for path in import.removed {
                hold.forget(&dir, &path);
                hold.kept.insert(path.clone(), Kept::Removed);
                disk.hashes.remove(&path);
                bases.forget(&path);
            }
            for path in import.dirs {
                hold.kept.insert(path, Kept::Added);
            }
            hold.pending = None;
            hold.save(&dir)?;
            disk.save(&self.disk_file)?;
            live.mark_all_dirty()?;
        }
        self.kick();
        Ok(())
    }
}

pub(super) struct KeptEdit {
    path: String,
    text: String,
    hash: String,
    kept: KeptText,
}

pub(super) fn screen(
    dir: &Path,
    root: &Path,
    disk: &DiskState,
    import: &mut LocalImport,
) -> Result<Vec<KeptEdit>, CollabError> {
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    if hold.is_quiet() {
        return Ok(Vec::new());
    }
    let before = hold.clone();
    if let Some(pending) = &hold.pending {
        import.texts.retain(|(path, _, _)| !pending.holds(path));
        import.blobs.retain(|(path, _, _)| !pending.holds(path));
        import.removed.retain(|path| !pending.holds(path));
        import.dirs.retain(|path| !pending.holds(path));
    }
    hold.kept
        .retain(|path, kind| *kind != Kept::Added || exists_exact(root, path));
    let mut edits = Vec::new();
    let mut texts = Vec::new();
    for (path, text, hash) in std::mem::take(&mut import.texts) {
        match hold.kind(&path) {
            None => texts.push((path, text, hash)),
            Some(Kept::Added) => {}
            Some(Kept::Text) => {
                if let Some(kept) = load_text(dir, &path) {
                    edits.push(KeptEdit {
                        path,
                        text,
                        hash,
                        kept,
                    });
                }
            }
            Some(Kept::Blob | Kept::Removed) => {
                hold.forget(dir, &path);
                texts.push((path, text, hash));
            }
        }
    }
    import.texts = texts;
    let mut blobs = Vec::new();
    for (path, hash, bytes) in std::mem::take(&mut import.blobs) {
        match hold.kind(&path) {
            Some(Kept::Added) => {}
            Some(_) => {
                hold.forget(dir, &path);
                blobs.push((path, hash, bytes));
            }
            None => blobs.push((path, hash, bytes)),
        }
    }
    import.blobs = blobs;
    let mut removed = Vec::new();
    for path in std::mem::take(&mut import.removed) {
        match hold.kind(&path) {
            None => removed.push(path),
            Some(Kept::Text | Kept::Blob) => {
                let renamed = disk.hashes.get(&path).and_then(|known| {
                    import
                        .texts
                        .iter()
                        .map(|(new, _, hash)| (new, hash))
                        .chain(import.blobs.iter().map(|(new, hash, _)| (new, hash)))
                        .find(|(_, hash)| *hash == known)
                        .map(|(new, _)| new.clone())
                });
                match renamed {
                    Some(new) => hold.rekey(dir, &path, &new),
                    None => hold.forget(dir, &path),
                }
                removed.push(path);
            }
            Some(Kept::Added | Kept::Removed) => {}
        }
    }
    import.removed = removed;
    import
        .dirs
        .retain(|path| hold.kind(path) != Some(Kept::Added));
    if hold != before {
        hold.save(dir)?;
    }
    Ok(edits)
}

pub(super) fn apply_kept_edits(
    dir: &Path,
    root: &Path,
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
    edits: Vec<KeptEdit>,
) -> Result<bool, CollabError> {
    if edits.is_empty() {
        return Ok(false);
    }
    let placed = by_path(&materialize::layout(&live.doc().nodes()?));
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    let mut changed = false;
    for edit in edits {
        let Some((id, NodeKind::Text, _)) = placed.get(&edit.path) else {
            continue;
        };
        if read_text(root, &edit.path).as_deref() != Some(edit.text.as_str()) {
            continue;
        }
        let current = live.doc().text(id)?;
        let onto_doc = rebase(&edit.kept.disk, &edit.text, &current);
        let onto_base = rebase(&edit.kept.disk, &edit.text, &edit.kept.doc)
            .and_then(|operation| operation.apply(&edit.kept.doc).ok());
        let (Some(operation), Some(doc)) = (onto_doc, onto_base) else {
            continue;
        };
        changed |= live.local_operation(id, &operation)?;
        bases.record(&edit.path, &edit.text);
        disk.hashes.insert(edit.path.clone(), edit.hash.clone());
        if doc == edit.text {
            hold.forget(dir, &edit.path);
        } else {
            store_text(
                dir,
                &edit.path,
                &KeptText {
                    doc,
                    disk: edit.text,
                },
            )?;
        }
    }
    hold.save(dir)?;
    Ok(changed)
}

#[derive(Default)]
pub(super) struct Shaped {
    pub(super) conflicts: Vec<String>,
    merged: Vec<(String, KeptText)>,
    held: Option<Hold>,
}

impl Shaped {
    pub(super) fn blocks(&self, path: &str) -> bool {
        self.held
            .as_ref()
            .is_some_and(|hold| hold.holds(path) || hold.kind(path).is_some())
    }
}

pub(super) fn shape(
    dir: &Path,
    root: &Path,
    plan: &mut DiskPlan,
    texts: &mut Vec<(String, String)>,
    next: &Layout,
) -> Shaped {
    let mut shaped = Shaped::default();
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    if hold.is_quiet() {
        return shaped;
    }
    let before = hold.clone();
    for (from, to) in &plan.moved {
        hold.rekey(dir, from, to);
    }
    let mut removed = Vec::new();
    for path in std::mem::take(&mut plan.removed) {
        if hold.holds(&path) {
            continue;
        }
        match hold.kind(&path) {
            None => removed.push(path),
            Some(Kept::Removed) => hold.forget(dir, &path),
            Some(Kept::Text | Kept::Blob) => {
                hold.forget(dir, &path);
                hold.kept.insert(path, Kept::Added);
            }
            Some(Kept::Added) => {}
        }
    }
    plan.removed = removed;
    plan.written.retain(|id| {
        next.get(id)
            .is_none_or(|placed| !hold.holds(&placed.path) && hold.kind(&placed.path).is_none())
    });
    let mut kept = Vec::new();
    for (path, text) in std::mem::take(texts) {
        if hold.holds(&path) {
            continue;
        }
        match hold.kind(&path) {
            None => kept.push((path, text)),
            Some(Kept::Text) => {
                let Some(base) = load_text(dir, &path) else {
                    continue;
                };
                if read_text(root, &path).as_deref() != Some(base.disk.as_str()) {
                    shaped.conflicts.push(path);
                    continue;
                }
                if base.doc == text {
                    continue;
                }
                let Some(merged) = rebase(&base.doc, &text, &base.disk)
                    .and_then(|operation| operation.apply(&base.disk).ok())
                else {
                    continue;
                };
                shaped.merged.push((
                    path.clone(),
                    KeptText {
                        doc: text,
                        disk: merged.clone(),
                    },
                ));
                kept.push((path, merged));
            }
            Some(_) => {}
        }
    }
    *texts = kept;
    if hold != before {
        let _ = hold.save(dir);
    }
    shaped.held = Some(hold);
    shaped
}

pub(super) fn settle(dir: &Path, shaped: Shaped, conflicts: &[String]) {
    if shaped.merged.is_empty() {
        return;
    }
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    for (path, text) in shaped.merged {
        if conflicts.contains(&path) || hold.kind(&path) != Some(Kept::Text) {
            continue;
        }
        if text.doc == text.disk {
            hold.forget(dir, &path);
        } else {
            let _ = store_text(dir, &path, &text);
        }
    }
    let _ = hold.save(dir);
}

fn hold_at_start(
    dir: &Path,
    disk: &DiskState,
    import: &LocalImport,
    edits: &[KeptEdit],
) -> Result<bool, CollabError> {
    let paths: BTreeSet<String> = import
        .texts
        .iter()
        .map(|(path, _, _)| path)
        .chain(import.blobs.iter().map(|(path, _, _)| path))
        .chain(import.removed.iter())
        .chain(edits.iter().map(|edit| &edit.path))
        .cloned()
        .collect();
    let tracked = disk
        .layout
        .values()
        .filter(|placed| placed.kind != NodeKind::Dir)
        .count();
    let MassChangeVerdict::Pause { changed, total } =
        evaluate(paths.len(), tracked, true, &MassChangeThreshold::default())
    else {
        return Ok(false);
    };
    let _lock = hold_lock();
    let mut hold = Hold::load(dir);
    let existed = hold.pending.is_some();
    let pending = hold.pending.get_or_insert_with(Pending::default);
    let held = pending.paths.len();
    pending.paths.extend(paths);
    pending.paths.extend(import.dirs.iter().cloned());
    let added = pending.paths.len() - held;
    pending.changed = if existed {
        pending.changed + added
    } else {
        changed
    };
    pending.total = pending.total.max(total);
    hold.save(dir)?;
    Ok(true)
}

pub(super) struct CaughtUp {
    pub(super) live: LiveProject,
    pub(super) disk: DiskState,
    pub(super) bases: WrittenTexts,
    pub(super) to_upload: Vec<String>,
}

pub(super) async fn catch_up(
    root: PathBuf,
    dir: PathBuf,
    mut live: LiveProject,
    mut disk: DiskState,
) -> Result<CaughtUp, CollabError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut bases = super::initial_bases(&root, &disk, &live);
        let to_upload = catch_up_here(&root, &dir, &mut live, &mut disk, &mut bases)?;
        Ok(CaughtUp {
            live,
            disk,
            bases,
            to_upload,
        })
    })
    .await
    .map_err(io)?
}

fn catch_up_here(
    root: &Path,
    dir: &Path,
    live: &mut LiveProject,
    disk: &mut DiskState,
    bases: &mut WrittenTexts,
) -> Result<Vec<String>, CollabError> {
    let mut import = super::read_local_changes(root, disk, live, None)?;
    let edits = screen(dir, root, disk, &mut import)?;
    if hold_at_start(dir, disk, &import, &edits)? {
        return Ok(Vec::new());
    }
    if (import.is_empty() && edits.is_empty()) || !live.can_edit() {
        return Ok(Vec::new());
    }
    let sent: BTreeSet<&String> = disk.hashes.values().collect();
    let (fresh, known): (Vec<_>, Vec<_>) = std::mem::take(&mut import.blobs)
        .into_iter()
        .partition(|(_, hash, _)| !sent.contains(hash));
    import.blobs = known;
    let to_upload = fresh.into_iter().map(|(path, _, _)| path).collect();
    super::moves::adopt_folder_moves(live, disk, bases, &mut import)?;
    super::apply_local_import(live, disk, bases, import, root)?;
    apply_kept_edits(dir, root, live, disk, bases, edits)?;
    Ok(to_upload)
}

pub(crate) fn outside_change(
    change: &FolderChange,
    verdict: MassChangeVerdict,
    host: &dyn SyncPauseHost,
) {
    let active = active_for(&change.project_id);
    let Some(dir) = active
        .as_ref()
        .map(|active| active.hold_dir())
        .or_else(|| collab_dir(&change.project_id))
    else {
        return;
    };
    if route(&dir, &change.project_id, change, verdict, host)
        .is_ok_and(|route| route == Route::Import)
    {
        super::folder_changed(change);
    }
}

fn announce_in(dir: &Path, project_id: &str, host: &dyn SyncPauseHost) {
    let pending = {
        let _lock = hold_lock();
        Hold::load(dir).pending
    };
    if let Some(pending) = pending {
        host.sync_paused(&SyncPaused {
            project_id: project_id.to_owned(),
            changed: pending.changed,
            total: pending.total,
            reason: PauseReason::MassChange,
        });
    }
}

pub(crate) fn announce(project_id: &str, host: &dyn SyncPauseHost) {
    let dir = active_for(project_id)
        .map(|active| active.hold_dir())
        .or_else(|| collab_dir(project_id));
    if let Some(dir) = dir {
        announce_in(&dir, project_id, host);
    }
}

pub(crate) fn root_returned(project_id: &str) {
    if let Some(active) = active_for(project_id) {
        active.kick();
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        initial_bases, lock, LiveHost, MergedPayload, NewDevicePayload, PresenceLeftPayload,
        PresencePayload, RolePayload, StatusPayload, WriterSignal,
    };
    use super::*;
    use crate::collab::guard::{PauseReason, SyncPaused};
    use crate::collab::state::CollabState;
    use crate::collab::testing::RecordedPauses;
    use oleafly_collab::doc::{NodeKind, ProjectDoc};
    use oleafly_collab::materialize;
    use oleafly_collab::sync::{spawn_live, LiveLink, LiveStatus, SharedLive};
    use oleafly_collab::{ServerClient, ServerUrl};
    use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
    use oleafly_collab_protocol::projects::ProjectRole;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::sync::mpsc::{self, UnboundedReceiver};

    struct Quiet;

    impl LiveHost for Quiet {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
    }

    struct Rig {
        dir: tempfile::TempDir,
        root: PathBuf,
        state: CollabState,
        active: Arc<Active>,
        seq: AtomicU64,
        _writer: UnboundedReceiver<WriterSignal>,
    }

    fn run(test: impl std::future::Future<Output = ()>) {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(test);
    }

    fn collab_of(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("collab").join("held")
    }

    async fn rig(files: &[(&str, &str)]) -> Rig {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(collab_of(&dir)).unwrap();
        let mut doc = ProjectDoc::create().unwrap();
        let mut hashes = std::collections::BTreeMap::new();
        for (path, text) in files {
            doc.add_node(None, path, NodeKind::Text, None, text)
                .unwrap();
            std::fs::write(root.join(path), text).unwrap();
            hashes.insert(
                (*path).to_owned(),
                super::super::sha256_hex(text.as_bytes()),
            );
        }
        let disk = DiskState {
            layout: materialize::layout(&doc.nodes().unwrap()),
            hashes,
        };
        let live = LiveProject::new(doc, 0, ProjectRole::Owner);
        let bases = initial_bases(&root, &disk, &live);
        let state = CollabState::new(
            oleafly_collab::CollabPaths::new(dir.path().join("keys")),
            Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
        );
        build(dir, root, state, live, disk, bases, 0).await
    }

    async fn build(
        dir: tempfile::TempDir,
        root: PathBuf,
        state: CollabState,
        live: LiveProject,
        disk: DiskState,
        bases: WrittenTexts,
        seq: u64,
    ) -> Rig {
        let keys = state.keys().await.unwrap();
        let link = LiveLink {
            client: Arc::new(
                ServerClient::new(ServerUrl::parse("http://127.0.0.1:9").unwrap()).unwrap(),
            ),
            server_id: ServerId::new_v7(),
            project: SharedProjectId::new_v7(),
            device_id: DeviceId::new_v7(),
            key: Arc::clone(&keys.key),
            sessions: Arc::clone(&keys.sessions),
        };
        let shared: SharedLive = Arc::new(Mutex::new(live));
        let (events, _events) = mpsc::unbounded_channel();
        let (writer, writer_rx) = mpsc::unbounded_channel();
        let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
        let collab = collab_of(&dir);
        let active = Arc::new(Active {
            project_id: "held".to_owned(),
            root: root.clone(),
            document_dir: collab.join("document"),
            disk_file: collab.join("materializer-index.json"),
            live: shared,
            handle,
            link,
            disk: Mutex::new(disk),
            host: Arc::new(Quiet),
            writer,
            account_id: AccountId::new_v7(),
            quiet_merge: AtomicBool::new(false),
            waiting: AtomicBool::new(false),
            last_status: Mutex::new(LiveStatus::Connecting),
            bases: Mutex::new(bases),
        });
        Rig {
            dir,
            root,
            state,
            active,
            seq: AtomicU64::new(seq),
            _writer: writer_rx,
        }
    }

    async fn restart(rig: Rig) -> Rig {
        rig.active.save_now();
        rig.active.handle.stop();
        let Rig {
            dir,
            root,
            state,
            active,
            seq,
            ..
        } = rig;
        let document_dir = active.document_dir.clone();
        let disk_file = active.disk_file.clone();
        drop(active);
        let live = LiveProject::load(&document_dir, ProjectRole::Owner).unwrap();
        let disk = DiskState::load(&disk_file);
        let CaughtUp {
            mut live,
            disk,
            bases,
            ..
        } = catch_up(root.clone(), collab_of(&dir), live, disk)
            .await
            .unwrap();
        live.mark_all_dirty().unwrap();
        build(dir, root, state, live, disk, bases, seq.into_inner()).await
    }

    fn change(paths: &[&str]) -> FolderChange {
        FolderChange {
            project_id: "held".to_owned(),
            paths: paths.iter().map(|path| (*path).to_owned()).collect(),
            rescan: false,
            structural: true,
            renamed: Vec::new(),
            deleted: Vec::new(),
        }
    }

    fn pause_of(paths: &[&str], total: usize) -> MassChangeVerdict {
        MassChangeVerdict::Pause {
            changed: paths.len(),
            total,
        }
    }

    impl Rig {
        fn write(&self, path: &str, text: &str) {
            std::fs::write(self.root.join(path), text).unwrap();
        }

        fn remove(&self, path: &str) {
            std::fs::remove_file(self.root.join(path)).unwrap();
        }

        fn on_disk(&self, path: &str) -> Option<String> {
            std::fs::read_to_string(self.root.join(path)).ok()
        }

        fn id_of(&self, path: &str) -> Option<String> {
            let live = lock(&self.active.live);
            materialize::layout(&live.doc().nodes().unwrap())
                .into_iter()
                .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
                .map(|(id, _)| id)
        }

        fn shared(&self, path: &str) -> Option<String> {
            let id = self.id_of(path)?;
            lock(&self.active.live).doc().text(&id).ok()
        }

        fn shared_paths(&self) -> Vec<String> {
            let live = lock(&self.active.live);
            let mut paths: Vec<String> = materialize::layout(&live.doc().nodes().unwrap())
                .into_values()
                .map(|placed| placed.path)
                .collect();
            paths.sort();
            paths
        }

        fn remote(&self, path: &str, text: &str) {
            let id = self.id_of(path).unwrap();
            let mut live = lock(&self.active.live);
            let mut peer = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
            let since = live.doc().version();
            peer.set_text(&id, text).unwrap();
            let payload = peer.export_since(&since).unwrap();
            let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
            assert!(live.import_update(seq, &payload).unwrap());
        }

        async fn outside(&self, paths: &[&str], verdict: MassChangeVerdict) {
            self.active
                .outside(&change(paths), verdict, &RecordedPauses::default())
                .await
                .unwrap();
        }

        async fn write_out(&self) {
            self.active.write_out().await.unwrap();
        }

        async fn rescan(&self) {
            self.active.import_paths(None).await.unwrap();
        }

        fn stop(&self) {
            self.active.handle.stop();
        }
    }

    #[test]
    fn outside_changes_wait_for_the_decision_and_send_imports_exactly_them() {
        run(async {
            let rig = rig(&[
                ("a.tex", "a"),
                ("b.tex", "b"),
                ("c.tex", "c"),
                ("d.tex", "d"),
            ])
            .await;
            rig.write("a.tex", "A");
            rig.write("b.tex", "B");
            rig.remove("c.tex");
            rig.write("new.tex", "N");
            let paths = ["a.tex", "b.tex", "c.tex", "new.tex"];

            rig.outside(&paths, pause_of(&paths, 4)).await;
            rig.rescan().await;
            rig.active
                .import_paths(Some(vec!["a.tex".to_owned()]))
                .await
                .unwrap();
            let waiting = (rig.shared_paths(), rig.shared("a.tex"), rig.shared("b.tex"));
            rig.active.decide(SyncDecision::Send).await.unwrap();
            rig.stop();

            assert_eq!(
                waiting,
                (
                    vec![
                        "a.tex".into(),
                        "b.tex".into(),
                        "c.tex".into(),
                        "d.tex".into()
                    ],
                    Some("a".into()),
                    Some("b".into())
                )
            );
            assert_eq!(rig.shared_paths(), ["a.tex", "b.tex", "d.tex", "new.tex"]);
            assert_eq!(rig.shared("a.tex").as_deref(), Some("A"));
            assert_eq!(rig.shared("b.tex").as_deref(), Some("B"));
            assert_eq!(rig.shared("d.tex").as_deref(), Some("d"));
            assert_eq!(rig.shared("new.tex").as_deref(), Some("N"));
        });
    }

    #[test]
    fn keep_local_never_sends_them_after_an_unrelated_edit_or_a_restart() {
        run(async {
            let rig = rig(&[
                ("main.tex", "shared main"),
                ("notes.tex", "shared notes"),
                ("refs.bib", "shared refs"),
                ("other.tex", "other"),
            ])
            .await;
            rig.write("main.tex", "kept main");
            rig.remove("notes.tex");
            rig.write("extra.tex", "kept extra");
            let paths = ["main.tex", "notes.tex", "extra.tex"];
            rig.outside(&paths, pause_of(&paths, 4)).await;
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();

            rig.write("other.tex", "other edited");
            rig.outside(&["other.tex"], MassChangeVerdict::Apply).await;
            rig.rescan().await;
            lock(&rig.active.live).mark_all_dirty().unwrap();
            rig.write_out().await;
            let rig = restart(rig).await;
            rig.write_out().await;
            rig.rescan().await;
            rig.stop();

            assert_eq!(
                rig.shared_paths(),
                ["main.tex", "notes.tex", "other.tex", "refs.bib"]
            );
            assert_eq!(rig.shared("main.tex").as_deref(), Some("shared main"));
            assert_eq!(rig.shared("notes.tex").as_deref(), Some("shared notes"));
            assert_eq!(rig.shared("other.tex").as_deref(), Some("other edited"));
            assert_eq!(rig.on_disk("main.tex").as_deref(), Some("kept main"));
            assert_eq!(rig.on_disk("notes.tex"), None);
            assert_eq!(rig.on_disk("extra.tex").as_deref(), Some("kept extra"));
        });
    }

    #[test]
    fn a_later_edit_to_a_kept_file_sends_only_that_edit() {
        run(async {
            let rig = rig(&[("main.tex", "one\n"), ("a.tex", "a"), ("b.tex", "b")]).await;
            rig.write("main.tex", "one\nkept\n");
            rig.outside(&["main.tex"], pause_of(&["main.tex"], 3)).await;
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();

            rig.write("main.tex", "one\nkept\nlater\n");
            rig.outside(&["main.tex"], MassChangeVerdict::Apply).await;
            let after_edit = rig.shared("main.tex");
            let rig = restart(rig).await;
            rig.write_out().await;
            rig.write("main.tex", "one\nkept\nlater\nafter restart\n");
            rig.outside(&["main.tex"], MassChangeVerdict::Apply).await;
            rig.stop();

            assert_eq!(after_edit.as_deref(), Some("one\nlater\n"));
            assert_eq!(
                rig.shared("main.tex").as_deref(),
                Some("one\nlater\nafter restart\n")
            );
            assert_eq!(
                rig.on_disk("main.tex").as_deref(),
                Some("one\nkept\nlater\nafter restart\n")
            );
        });
    }

    #[test]
    fn a_remote_change_to_a_kept_file_is_merged_into_the_local_copy() {
        run(async {
            let rig = rig(&[
                ("main.tex", "alpha\nbeta\n"),
                ("a.tex", "a"),
                ("b.tex", "b"),
            ])
            .await;
            rig.write("main.tex", "alpha\nlocal\nbeta\n");
            rig.outside(&["main.tex"], pause_of(&["main.tex"], 3)).await;
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();

            rig.remote("main.tex", "alpha\nbeta\nremote\n");
            rig.write_out().await;
            let merged = (rig.on_disk("main.tex"), rig.shared("main.tex"));
            let rig = restart(rig).await;
            rig.write_out().await;
            rig.remote("main.tex", "zero\nalpha\nbeta\nremote\n");
            rig.write_out().await;
            rig.rescan().await;
            rig.stop();

            assert_eq!(
                merged,
                (
                    Some("alpha\nlocal\nbeta\nremote\n".into()),
                    Some("alpha\nbeta\nremote\n".into())
                )
            );
            assert_eq!(
                rig.on_disk("main.tex").as_deref(),
                Some("zero\nalpha\nlocal\nbeta\nremote\n")
            );
            assert_eq!(
                rig.shared("main.tex").as_deref(),
                Some("zero\nalpha\nbeta\nremote\n")
            );
        });
    }

    #[test]
    fn remote_changes_that_arrive_while_the_decision_waits_reach_the_kept_copy() {
        run(async {
            let rig = rig(&[
                ("main.tex", "alpha\nbeta\n"),
                ("a.tex", "a"),
                ("b.tex", "b"),
            ])
            .await;
            rig.write("main.tex", "alpha\nlocal\nbeta\n");
            rig.outside(&["main.tex"], pause_of(&["main.tex"], 3)).await;

            rig.remote("main.tex", "alpha\nbeta\nremote\n");
            rig.write_out().await;
            let waiting = (rig.on_disk("main.tex"), rig.shared("main.tex"));
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();
            rig.write_out().await;
            rig.stop();

            assert_eq!(
                waiting,
                (
                    Some("alpha\nlocal\nbeta\n".into()),
                    Some("alpha\nbeta\nremote\n".into())
                )
            );
            assert_eq!(
                rig.on_disk("main.tex").as_deref(),
                Some("alpha\nlocal\nbeta\nremote\n")
            );
            assert_eq!(
                rig.shared("main.tex").as_deref(),
                Some("alpha\nbeta\nremote\n")
            );
        });
    }

    #[test]
    fn a_kept_file_deleted_by_someone_else_stays_here_and_is_never_sent() {
        run(async {
            let rig = rig(&[("main.tex", "shared"), ("a.tex", "a"), ("b.tex", "b")]).await;
            rig.write("main.tex", "kept here");
            rig.outside(&["main.tex"], pause_of(&["main.tex"], 3)).await;
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();

            let id = rig.id_of("main.tex").unwrap();
            {
                let mut live = lock(&rig.active.live);
                let mut peer = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
                let since = live.doc().version();
                peer.trash(&id).unwrap();
                let payload = peer.export_since(&since).unwrap();
                assert!(live.import_update(1, &payload).unwrap());
            }
            rig.write_out().await;
            rig.rescan().await;
            rig.write("main.tex", "kept here, edited again");
            rig.outside(&["main.tex"], MassChangeVerdict::Apply).await;
            rig.stop();

            assert_eq!(rig.shared_paths(), ["a.tex", "b.tex"]);
            assert_eq!(
                rig.on_disk("main.tex").as_deref(),
                Some("kept here, edited again")
            );
        });
    }

    #[test]
    fn a_vanished_folder_never_reads_as_deletions_and_disk_writes_wait_for_it() {
        run(async {
            let rig = rig(&[("a.tex", "a"), ("b.tex", "b"), ("c.tex", "c")]).await;
            let parked = rig.root.with_file_name("parked");
            std::fs::rename(&rig.root, &parked).unwrap();

            let every = ["a.tex", "b.tex", "c.tex"];
            rig.outside(&every, MassChangeVerdict::RootUnavailable)
                .await;
            let named = rig
                .active
                .import_paths(Some(every.iter().map(|path| (*path).to_owned()).collect()))
                .await;
            assert_eq!(rig.shared_paths(), ["a.tex", "b.tex", "c.tex"]);
            let rescanned = rig.active.import_paths(None).await;
            rig.remote("a.tex", "a from elsewhere");
            let written = rig.active.write_out().await;
            let recreated = rig.root.exists();
            let paths = rig.shared_paths();
            std::fs::rename(&parked, &rig.root).unwrap();
            rig.write_out().await;
            rig.stop();

            assert!(named.is_ok() && rescanned.is_ok() && written.is_ok());
            assert_eq!(paths, ["a.tex", "b.tex", "c.tex"]);
            assert!(!recreated);
            assert_eq!(rig.on_disk("a.tex").as_deref(), Some("a from elsewhere"));
            assert_eq!(rig.on_disk("b.tex").as_deref(), Some("b"));
        });
    }

    #[test]
    fn an_unavailable_folder_neither_imports_nor_asks_for_a_decision() {
        let dir = tempfile::tempdir().unwrap();
        let host = RecordedPauses::default();
        let every = change(&["a.tex", "b.tex", "c.tex"]);

        let routed = route(
            dir.path(),
            "held",
            &every,
            MassChangeVerdict::RootUnavailable,
            &host,
        )
        .unwrap();
        let applied = route(dir.path(), "held", &every, MassChangeVerdict::Apply, &host).unwrap();

        assert_eq!(routed, Route::Wait);
        assert_eq!(applied, Route::Import);
        assert!(host.taken().is_empty());
        assert_eq!(Hold::load(dir.path()), Hold::default());
    }

    #[test]
    fn outside_changes_while_a_decision_waits_join_it_and_update_the_count() {
        run(async {
            let rig = rig(&[
                ("a.tex", "a"),
                ("b.tex", "b"),
                ("c.tex", "c"),
                ("d.tex", "d"),
            ])
            .await;
            let paths = ["a.tex", "b.tex", "c.tex"];
            for path in paths {
                rig.write(path, "changed");
            }
            let host = RecordedPauses::default();
            rig.active
                .outside(&change(&paths), pause_of(&paths, 4), &host)
                .await
                .unwrap();
            rig.write("d.tex", "changed too");
            rig.active
                .outside(&change(&["d.tex"]), MassChangeVerdict::Apply, &host)
                .await
                .unwrap();
            let waiting = rig.shared("d.tex");
            rig.active.decide(SyncDecision::KeepLocal).await.unwrap();
            rig.rescan().await;
            rig.stop();

            assert_eq!(waiting.as_deref(), Some("d"));
            assert_eq!(
                host.taken(),
                [SyncPaused {
                    project_id: "held".into(),
                    changed: 4,
                    total: 4,
                    reason: PauseReason::MassChange,
                }]
            );
            assert_eq!(rig.shared("d.tex").as_deref(), Some("d"));
            assert_eq!(rig.on_disk("d.tex").as_deref(), Some("changed too"));
        });
    }

    #[test]
    fn a_decision_left_open_survives_a_restart_and_is_announced_again() {
        run(async {
            let rig = rig(&[
                ("a.tex", "a"),
                ("b.tex", "b"),
                ("c.tex", "c"),
                ("d.tex", "d"),
            ])
            .await;
            let paths = ["a.tex", "b.tex", "c.tex"];
            for path in paths {
                rig.write(path, "changed");
            }
            rig.outside(&paths, pause_of(&paths, 4)).await;

            let rig = restart(rig).await;
            rig.write_out().await;
            rig.rescan().await;
            let waiting = rig.shared("a.tex");
            let host = RecordedPauses::default();
            announce_in(&collab_of(&rig.dir), "held", &host);
            rig.active.decide(SyncDecision::Send).await.unwrap();
            rig.stop();

            assert_eq!(waiting.as_deref(), Some("a"));
            assert_eq!(
                host.taken(),
                [SyncPaused {
                    project_id: "held".into(),
                    changed: 3,
                    total: 4,
                    reason: PauseReason::MassChange,
                }]
            );
            assert_eq!(rig.shared("a.tex").as_deref(), Some("changed"));
            assert_eq!(rig.on_disk("a.tex").as_deref(), Some("changed"));
        });
    }

    #[test]
    fn sending_a_restore_made_while_two_people_type_reverts_it_once_and_keeps_their_typing() {
        run(async {
            let checkpoint: String = (1..=12)
                .map(|part| format!("Method part {part}. The text about step {part}.\n"))
                .collect();
            let edited = checkpoint.replace(
                "The text about step 4.",
                "Bob rewrote the sentence about step 4.",
            );
            let others: Vec<(String, String)> = (0..22)
                .map(|index| (format!("f{index:02}.tex"), format!("file {index}\n")))
                .collect();
            let mut files: Vec<(&str, &str)> = vec![("method.tex", edited.as_str())];
            files.extend(
                others
                    .iter()
                    .map(|(path, text)| (path.as_str(), text.as_str())),
            );
            let rig = rig(&files).await;
            for (path, text) in &others {
                rig.write(path, text);
            }
            rig.write("method.tex", &checkpoint);
            let every: Vec<&str> = files.iter().map(|(path, _)| *path).collect();
            rig.outside(&every, pause_of(&every, every.len())).await;
            let typed = edited
                .replace("Method part 1. ", "Method part 1. alice typed. ")
                .replace("Method part 7. ", "Method part 7. carol typed. ");
            rig.remote("method.tex", &typed);
            rig.write_out().await;
            rig.active.decide(SyncDecision::Send).await.unwrap();
            rig.write_out().await;
            rig.stop();

            let expected = checkpoint
                .replace("Method part 1. ", "Method part 1. alice typed. ")
                .replace("Method part 7. ", "Method part 7. carol typed. ");
            assert_eq!(rig.shared("method.tex"), Some(expected.clone()));
            assert_eq!(rig.on_disk("method.tex"), Some(expected));
            assert_eq!(rig.shared("f03.tex").as_deref(), Some("file 3\n"));
        });
    }

    #[test]
    fn many_files_changed_while_the_app_was_closed_wait_for_a_decision_and_one_does_not() {
        run(async {
            let rig = rig(&[
                ("a.tex", "a"),
                ("b.tex", "b"),
                ("c.tex", "c"),
                ("d.tex", "d"),
            ])
            .await;
            rig.write("a.tex", "one while closed");
            let rig = restart(rig).await;
            let one = rig.shared("a.tex");
            for path in ["b.tex", "c.tex", "d.tex"] {
                rig.write(path, "many while closed");
            }
            let rig = restart(rig).await;
            rig.write_out().await;
            let waiting = rig.shared("b.tex");
            let host = RecordedPauses::default();
            announce_in(&collab_of(&rig.dir), "held", &host);
            rig.stop();

            assert_eq!(one.as_deref(), Some("one while closed"));
            assert_eq!(waiting.as_deref(), Some("b"));
            assert_eq!(rig.on_disk("b.tex").as_deref(), Some("many while closed"));
            assert_eq!(
                host.taken(),
                [SyncPaused {
                    project_id: "held".into(),
                    changed: 3,
                    total: 4,
                    reason: PauseReason::MassChange,
                }]
            );
        });
    }
}
