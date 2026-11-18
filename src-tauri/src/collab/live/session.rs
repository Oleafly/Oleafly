use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_collab::live::{save_shared, LiveProject};
use oleafly_collab::materialize;
use oleafly_collab::remove_binding;
use oleafly_collab::sync::{LiveHandle, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::AccountId;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;

use super::bases::WrittenTexts;
use super::downloads::FigureHost;
use super::host::LiveHost;
use super::live_disk::{LiveWriter, Mirrored};
use super::live_tree::LiveTree;
use super::overleaf::OverleafLive;
use super::payloads::StatusPayload;
use super::{local_copy, settings};
use crate::collab::disk::DiskState;
use crate::folder_watch::FolderChange;

pub(super) enum WriterSignal {
    Kick,
    Flush(oneshot::Sender<()>),
}

pub struct LiveDisk {
    pub(super) project_id: String,
    pub(super) root: PathBuf,
    pub(super) disk_file: PathBuf,
    pub(super) disk: Mutex<DiskState>,
    pub(super) bases: Mutex<WrittenTexts>,
    pub(super) host: Arc<dyn LiveHost>,
    pub(super) writer: UnboundedSender<WriterSignal>,
    pub(super) upkeep: Upkeep,
}

pub struct Active {
    pub(super) local: LiveDisk,
    pub(super) document_dir: PathBuf,
    pub(super) live: SharedLive,
    pub(super) handle: LiveHandle,
    pub(super) link: LiveLink,
    pub(super) account_id: AccountId,
    pub(super) quiet_merge: AtomicBool,
    pub(super) waiting: AtomicBool,
    pub(super) last_status: Mutex<LiveStatus>,
}

#[derive(Clone, Default)]
pub(super) struct Alarm(Arc<Mutex<Option<Instant>>>);

impl Alarm {
    pub(super) fn ring_in(&self, writer: &UnboundedSender<WriterSignal>, delay: Duration) {
        let at = Instant::now() + delay;
        {
            let mut pending = guard(&self.0);
            if pending.is_some_and(|due| due <= at) {
                return;
            }
            *pending = Some(at);
        }
        let (alarm, writer) = (Arc::clone(&self.0), writer.clone());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            {
                let mut pending = guard(&alarm);
                if *pending == Some(at) {
                    *pending = None;
                }
            }
            let _ = writer.send(WriterSignal::Kick);
        });
    }
}

#[derive(Default)]
pub(super) struct Upkeep {
    pub(super) pace: Mutex<super::pacing::Pace>,
    pub(super) failing: Mutex<super::unwritten::Failing>,
    pub(super) figures: Mutex<super::downloads::Figures>,
    pub(super) figures_closed: AtomicBool,
    pub(super) owed: Mutex<super::owed::OwedTries>,
    pub(super) unannounced: Mutex<BTreeSet<String>>,
}

#[derive(Clone)]
pub enum Live {
    Server(Arc<Active>),
    Overleaf(Arc<OverleafLive>),
}

impl Live {
    pub fn project_id(&self) -> &str {
        match self {
            Live::Server(active) => &active.local.project_id,
            Live::Overleaf(live) => live.project_id(),
        }
    }

    pub(super) fn server(&self) -> Option<&Arc<Active>> {
        match self {
            Live::Server(active) => Some(active),
            Live::Overleaf(_) => None,
        }
    }

    pub(super) fn overleaf(&self) -> Option<&Arc<OverleafLive>> {
        match self {
            Live::Overleaf(live) => Some(live),
            Live::Server(_) => None,
        }
    }
}

pub(super) static ACTIVE: LazyLock<Mutex<Option<Live>>> = LazyLock::new(|| Mutex::new(None));
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

pub fn live_for(project_id: &str) -> Option<Live> {
    guard(&ACTIVE)
        .as_ref()
        .filter(|live| live.project_id() == project_id)
        .cloned()
}

pub fn active_for(project_id: &str) -> Option<Arc<Active>> {
    live_for(project_id).and_then(|live| live.server().cloned())
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
        let _ = self.local.writer.send(WriterSignal::Kick);
    }

    pub(super) fn emit_status(&self, status: LiveStatus) {
        let pending = lock(&self.live).pending_changes();
        self.waiting.store(pending > 0, Ordering::SeqCst);
        *guard(&self.last_status) = status.clone();
        self.local.host.status(StatusPayload {
            project_id: self.local.project_id.clone(),
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
        let _ = self.local.save_index(&guard(&self.local.disk));
    }

    pub(super) async fn persist(&self) -> Result<(), CollabError> {
        let live = Arc::clone(&self.live);
        let dir = self.document_dir.clone();
        tauri::async_runtime::spawn_blocking(move || save_shared(&live, &dir))
            .await
            .map_err(io)?
    }

    pub(super) async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        self.local.import(self, &self.hold_dir(), only).await
    }

    pub(super) async fn write_out(self: &Arc<Self>) -> Result<Vec<String>, CollabError> {
        self.write_out_paced(true).await
    }

    pub(super) async fn write_out_paced(
        self: &Arc<Self>,
        urgent: bool,
    ) -> Result<Vec<String>, CollabError> {
        if !self.local.root.is_dir() {
            return Ok(Vec::new());
        }
        let followed = self.settle_owed_moves();
        let (mut previous, hashes, owed) = self.local.snapshot();
        let Some(mirror) = self.read_out(&mut previous, &hashes)? else {
            if self.save_owed() && self.save_due(urgent) {
                self.save_document().await;
            }
            return Ok(self.written_at(&followed));
        };
        if mirror.copied {
            self.handle.flush();
            self.refresh_pending();
        }
        if self.save_due(urgent) {
            self.save_document().await;
        }
        let tree_changed = mirror.work.tree;
        let Mirrored { conflicts, blobs } =
            self.local
                .mirror(&**self, &self.hold_dir(), &previous, &owed, mirror, urgent)?;
        self.want_figures(blobs);
        if tree_changed {
            if let Some(active) = active_for(&self.local.project_id) {
                settings::schedule(&active);
            }
        }
        let mut reread = conflicts;
        reread.extend(self.written_at(&followed));
        Ok(reread)
    }

    pub(super) fn announce_new_names(&self, renamed: Vec<(String, String)>) {
        if renamed.is_empty() {
            return;
        }
        announce_renames(self.local.host.as_ref(), &self.local.project_id, &renamed);
        if !self.moves_the_main_file(&renamed) {
            return;
        }
        if let Some(applied) =
            crate::collab::settings::follow_renamed_main(&self.local.project_id, &renamed)
        {
            self.local.host.settings_changed(applied);
        }
    }

    fn moves_the_main_file(&self, renamed: &[(String, String)]) -> bool {
        let live = lock(&self.live);
        let Some(main) = live.doc().settings().main_doc() else {
            return false;
        };
        let Ok(nodes) = live.doc().nodes() else {
            return false;
        };
        materialize::layout(&nodes)
            .get(&main.to_string())
            .is_some_and(|placed| {
                renamed
                    .iter()
                    .any(|(_, to)| crate::collab::disk::inside(&placed.path, to))
            })
    }

    pub(super) fn detach(&self, paths: &oleafly_collab::CollabPaths) {
        local_copy::keep_origin(paths, &self.local.project_id, &lock(&self.live));
        let _ = remove_binding(paths, &self.local.project_id);
        crate::collab::registry::invalidate(&self.local.project_id);
        local_copy::name_local_copy(&self.local.project_id);
    }
}

pub fn announce_renames(host: &dyn LiveHost, project_id: &str, renamed: &[(String, String)]) {
    if renamed.is_empty() {
        return;
    }
    for (from, to) in renamed {
        host.renamed(crate::collab::tree::RenamedPayload {
            project_id: project_id.to_owned(),
            account_id: None,
            before: from.clone(),
            ours: from.clone(),
            theirs: to.clone(),
        });
    }
    host.folder_changed(FolderChange {
        project_id: project_id.to_owned(),
        paths: renamed
            .iter()
            .flat_map(|(from, to)| [from.clone(), to.clone()])
            .collect(),
        rescan: false,
        structural: true,
        renamed: renamed.to_vec(),
        deleted: Vec::new(),
    });
}

impl LiveWriter for Active {
    async fn write_pass(self: Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        self.write_out_paced(urgent).await
    }

    async fn import_pass(self: Arc<Self>, only: Vec<String>) -> Result<(), CollabError> {
        self.import_paths(Some(only)).await
    }
}

impl LiveDisk {
    pub(super) fn note_unannounced(
        &self,
        typed_here: &BTreeSet<String>,
        told: &BTreeSet<String>,
        moved: &[(String, String)],
        removed: &[String],
    ) {
        let mut unannounced = guard(&self.upkeep.unannounced);
        if unannounced.is_empty() && typed_here.is_empty() {
            return;
        }
        let kept = std::mem::take(&mut *unannounced);
        *unannounced = kept
            .into_iter()
            .filter(|path| {
                !told.contains(path)
                    && !removed
                        .iter()
                        .any(|gone| crate::collab::disk::inside(path, gone))
            })
            .map(|path| {
                moved
                    .iter()
                    .find_map(|(from, to)| crate::collab::disk::moved_key(&path, from, to))
                    .unwrap_or(path)
            })
            .collect();
        unannounced.extend(typed_here.iter().cloned());
    }

    pub(super) fn announce_written(&self) {
        let paths = std::mem::take(&mut *guard(&self.upkeep.unannounced));
        if paths.is_empty() {
            return;
        }
        let known: Vec<(String, String)> = {
            let disk = guard(&self.disk);
            paths
                .into_iter()
                .filter_map(|path| {
                    let hash = disk.hashes.get(&path)?.clone();
                    Some((path, hash))
                })
                .collect()
        };
        let files: Vec<super::payloads::WrittenFile> = known
            .into_iter()
            .filter_map(|(path, hash)| {
                let target = crate::collab::disk::safe_target(&self.root, &path)?;
                let bytes = std::fs::read(target).ok()?;
                if crate::collab::disk::sha256_hex(&bytes) != hash {
                    return None;
                }
                let text = std::str::from_utf8(&bytes).ok()?;
                Some(super::payloads::WrittenFile {
                    hash: super::payloads::window_hash(&bytes),
                    crlf: crate::collab::disk::crlf_only(&bytes) == Some(true),
                    length: text.encode_utf16().count(),
                    path,
                })
            })
            .collect();
        if !files.is_empty() {
            self.host.written(super::payloads::WrittenPayload {
                project_id: self.project_id.clone(),
                files,
            });
        }
    }
}
