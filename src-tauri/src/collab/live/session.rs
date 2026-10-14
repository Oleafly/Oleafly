use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::{save_shared, DiskWork, LiveProject};
use oleafly_collab::materialize::{self, Layout};
use oleafly_collab::remove_binding;
use oleafly_collab::sync::{LiveHandle, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::AccountId;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;

use super::bases::WrittenTexts;
use super::disk_pass::{apply_to_disk, DiskPass};
use super::host::LiveHost;
use super::import::{apply_local_import, placed_now, scan_local};
use super::payloads::StatusPayload;
use super::unwritten::{reason_of, Settled, UnwrittenReason};
use super::{kept, local_copy, moves, settings, sync_hold, uploads};
use crate::collab::commands::with_access;
use crate::collab::disk::{sha256_hex, write_file_over, DiskState, Stamp, WriteOutcome};
use crate::folder_watch::FolderChange;

const WRITE_DEBOUNCE: Duration = Duration::from_millis(120);

struct Outgoing {
    work: DiskWork,
    next: Layout,
    texts: Vec<(String, String)>,
    crlf: BTreeSet<String>,
    kept: Vec<kept::KeptFile>,
    copied: bool,
}

pub(super) enum WriterSignal {
    Kick,
    Flush(oneshot::Sender<()>),
}

pub struct Active {
    pub(super) project_id: String,
    pub(super) root: PathBuf,
    pub(super) document_dir: PathBuf,
    pub(super) disk_file: PathBuf,
    pub(super) live: SharedLive,
    pub(super) handle: LiveHandle,
    pub(super) link: LiveLink,
    pub(super) disk: Mutex<DiskState>,
    pub(super) host: Arc<dyn LiveHost>,
    pub(super) writer: UnboundedSender<WriterSignal>,
    pub(super) account_id: AccountId,
    pub(super) quiet_merge: AtomicBool,
    pub(super) waiting: AtomicBool,
    pub(super) last_status: Mutex<LiveStatus>,
    pub(super) bases: Mutex<WrittenTexts>,
    pub(super) upkeep: Upkeep,
}

#[derive(Default)]
pub(super) struct Upkeep {
    pub(super) pace: Mutex<super::pacing::Pace>,
    pub(super) failing: Mutex<super::unwritten::Failing>,
}

pub(super) static ACTIVE: LazyLock<Mutex<Option<Arc<Active>>>> = LazyLock::new(|| Mutex::new(None));
pub(super) static LIFECYCLE: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
pub(super) static FRESH_JOINS: LazyLock<Mutex<BTreeSet<String>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));

pub(super) fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(super) fn lock(live: &SharedLive) -> MutexGuard<'_, LiveProject> {
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

pub(super) fn not_live() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not live".to_owned(),
    }
}

pub(super) fn io(error: impl std::fmt::Display) -> CollabError {
    CollabError::Io(error.to_string())
}

impl Active {
    pub(super) fn kick(&self) {
        let _ = self.writer.send(WriterSignal::Kick);
    }

    pub(super) fn emit_status(&self, status: LiveStatus) {
        let pending = lock(&self.live).pending_changes();
        self.waiting.store(pending > 0, Ordering::SeqCst);
        *guard(&self.last_status) = status.clone();
        self.host.status(StatusPayload {
            project_id: self.project_id.clone(),
            status,
            pending,
        });
    }

    pub(super) fn refresh_pending(&self) {
        let status = guard(&self.last_status).clone();
        let waiting = lock(&self.live).pending_changes() > 0;
        let flipped = self.waiting.swap(waiting, Ordering::SeqCst) != waiting;
        if flipped || matches!(status, LiveStatus::Offline { .. } | LiveStatus::Connecting) {
            self.emit_status(status);
        }
    }

    pub(super) fn save_now(&self) {
        let _ = save_shared(&self.live, &self.document_dir);
        let _ = self.save_index(&guard(&self.disk));
    }

    pub(super) async fn persist(&self) -> Result<(), CollabError> {
        let live = Arc::clone(&self.live);
        let dir = self.document_dir.clone();
        tauri::async_runtime::spawn_blocking(move || save_shared(&live, &dir))
            .await
            .map_err(io)?
    }

    pub(super) async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        if !self.root.is_dir() {
            return Ok(());
        }
        let snapshot = guard(&self.disk).clone();
        let placed = placed_now(&lock(&self.live))?;
        let root = self.root.clone();
        let (scanned, snapshot) = tauri::async_runtime::spawn_blocking(move || {
            let scanned = scan_local(&root, &snapshot, &placed, only.as_deref());
            (scanned, snapshot)
        })
        .await
        .map_err(io)?;
        let mut import = scanned?.classify(&lock(&self.live));
        let edits = sync_hold::screen(&self.hold_dir(), &self.root, &snapshot, &mut import)?;
        if import.is_empty() && edits.is_empty() {
            return Ok(());
        }
        if !lock(&self.live).can_edit() {
            return Ok(());
        }
        let failed = uploads::send(&self.link, &import.blobs, self.online()).await;
        import.blobs.retain(|(_, hash, _)| !failed.contains(hash));
        self.announce_uploads();
        let changed = {
            let mut disk = guard(&self.disk);
            let mut live = lock(&self.live);
            let mut bases = guard(&self.bases);
            moves::adopt_folder_moves(&mut live, &mut disk, &mut bases, &mut import)?;
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

    pub(super) async fn write_out(&self) -> Result<Vec<String>, CollabError> {
        self.write_out_paced(true).await
    }

    pub(super) async fn write_out_paced(&self, urgent: bool) -> Result<Vec<String>, CollabError> {
        if !self.root.is_dir() {
            return Ok(Vec::new());
        }
        let (mut previous, hashes) = {
            let disk = guard(&self.disk);
            (disk.layout.clone(), disk.hashes.clone())
        };
        let Some(Outgoing {
            work,
            next,
            mut texts,
            crlf,
            kept,
            copied,
        }) = self.take_outgoing(&mut previous, &hashes)?
        else {
            if self.save_owed() && self.save_due(urgent) {
                self.save_document().await;
            }
            return Ok(Vec::new());
        };
        if copied {
            self.handle.flush();
            self.refresh_pending();
        }
        if self.save_due(urgent) {
            self.save_document().await;
        }
        let mut plan = materialize::plan(&previous, &next);
        if !urgent {
            self.hold_back_typing(&next, &mut texts);
        }
        let shaped = sync_hold::shape(&self.hold_dir(), &self.root, &mut plan, &mut texts, &next);
        let structural = !plan.moved.is_empty()
            || !plan.removed.is_empty()
            || !plan.dirs.is_empty()
            || work.tree;
        let blocked = |path: &str| shaped.blocks(path);
        let DiskPass {
            mut changed,
            mut conflicts,
            blobs,
            moved,
            removed,
            written,
            done,
            failed,
        } = {
            let mut disk = guard(&self.disk);
            let mut bases = guard(&self.bases);
            apply_to_disk(
                &self.root, &mut disk, &mut bases, plan, next, &texts, &crlf, &blocked,
            )?
        };
        conflicts.extend(shaped.conflicts.iter().cloned());
        sync_hold::settle(&self.hold_dir(), shaped, &conflicts);
        if !kept.is_empty() {
            self.host.kept(kept::KeptPayload {
                project_id: self.project_id.clone(),
                files: kept,
            });
        }
        self.announce_removed(&previous, &removed);
        self.note_arrivals(&previous, &changed);
        let mut settled = Settled {
            done,
            failed,
            conflicts: Vec::new(),
        };
        self.fetch_blobs(blobs, &mut conflicts, &mut changed, &mut settled)
            .await;
        self.note_written(&written);
        let layout = {
            let disk = guard(&self.disk);
            self.save_index_if_changed(&disk);
            disk.layout.clone()
        };
        settled.conflicts.clone_from(&conflicts);
        self.settle_unwritten(&layout, settled);
        let typed_here = self.open_texts(&layout, &written, &moved);
        changed.retain(|path| !typed_here.contains(path));
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
        if work.tree {
            if let Some(active) = active_for(&self.project_id) {
                settings::schedule(&active);
            }
        }
        Ok(conflicts)
    }

    fn take_outgoing(
        &self,
        previous: &mut Layout,
        hashes: &BTreeMap<String, String>,
    ) -> Result<Option<Outgoing>, CollabError> {
        let mut live = lock(&self.live);
        let work = live.take_disk_work();
        if work.is_empty() {
            return Ok(None);
        }
        let lost = if work.tree {
            kept::keep_lost_figures(&mut live, previous, hashes)?
        } else {
            Vec::new()
        };
        let copied = !lost.is_empty();
        let nodes = live.doc().nodes()?;
        let next = materialize::layout(&nodes);
        let kept = if work.tree {
            kept::notices(&live, &nodes, previous, &next, lost)
        } else {
            Vec::new()
        };
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
        Ok(Some(Outgoing {
            work,
            next,
            texts,
            crlf,
            kept,
            copied,
        }))
    }

    fn open_texts(
        &self,
        layout: &Layout,
        written: &BTreeSet<String>,
        moved: &[(String, String)],
    ) -> BTreeSet<String> {
        let live = lock(&self.live);
        layout
            .iter()
            .filter(|(id, placed)| {
                placed.kind == NodeKind::Text
                    && written.contains(&placed.path)
                    && !moved
                        .iter()
                        .any(|(from, to)| *from == placed.path || *to == placed.path)
                    && live.is_open(id)
            })
            .map(|(_, placed)| placed.path.clone())
            .collect()
    }

    async fn fetch_blobs(
        &self,
        blobs: Vec<(String, String, Option<Stamp>)>,
        conflicts: &mut Vec<String>,
        changed: &mut BTreeSet<String>,
        settled: &mut Settled,
    ) {
        let project = self.link.project;
        for (path, hash, stamp) in blobs {
            let fetched = with_access(
                &self.link.sessions,
                self.link.server_id,
                &self.link.client,
                |client, access| {
                    let hash = hash.clone();
                    Box::pin(async move { client.get_blob(access, project, &hash).await })
                },
            )
            .await
            .ok()
            .filter(|bytes| sha256_hex(bytes) == hash);
            let Some(bytes) = fetched else {
                settled.failed.push((path, UnwrittenReason::NotDownloaded));
                continue;
            };
            let mut disk = guard(&self.disk);
            match write_file_over(&self.root, &path, &bytes, stamp.as_ref()) {
                Ok(WriteOutcome::ChangedOutside) => conflicts.push(path),
                Ok(_) => {
                    disk.hashes.insert(path.clone(), hash);
                    changed.insert(path.clone());
                    settled.done.insert(path);
                }
                Err(error) => settled.failed.push((path, reason_of(&error))),
            }
        }
    }

    pub(super) fn detach(&self, paths: &oleafly_collab::CollabPaths) {
        local_copy::keep_origin(
            paths,
            &self.project_id,
            lock(&self.live).doc(),
            &self.document_dir,
        );
        let _ = remove_binding(paths, &self.project_id);
        crate::collab::registry::invalidate(&self.project_id);
        local_copy::name_local_copy(&self.project_id);
    }
}

pub(super) async fn writer_loop(
    active: Weak<Active>,
    mut signals: UnboundedReceiver<WriterSignal>,
) {
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
        if let Ok(conflicts) = active.write_out_paced(!waiters.is_empty()).await {
            if !conflicts.is_empty() {
                let _ = active.import_paths(Some(conflicts)).await;
            }
        }
        for done in waiters {
            let _ = done.send(());
        }
    }
}
