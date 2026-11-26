use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use oleafly_collab::live::save_shared;
use oleafly_collab::materialize;
use oleafly_collab::remove_binding;
use oleafly_collab::sync::{LiveHandle, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::AccountId;
use oleafly_core::app_log::AppLog;

pub use oleafly_live::live::session::*;

use super::downloads::FigureHost;
use super::host::LiveHost;
use super::live_disk::{LiveWriter, Mirrored};
use super::live_tree::LiveTree;
use super::overleaf::OverleafLive;
use super::payloads::StatusPayload;
use super::{local_copy, settings};
use crate::folder_watch::FolderChange;

pub struct Active {
    pub(super) local: LiveDisk,
    pub(super) host: Arc<dyn LiveHost>,
    pub(super) document_dir: PathBuf,
    pub(super) live: SharedLive,
    pub(super) handle: LiveHandle,
    pub(super) link: LiveLink,
    pub(super) account_id: AccountId,
    pub(super) quiet_merge: AtomicBool,
    pub(super) waiting: AtomicBool,
    pub(super) last_status: Mutex<LiveStatus>,
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

    pub(super) fn local(&self) -> &LiveDisk {
        match self {
            Live::Server(active) => &active.local,
            Live::Overleaf(live) => &live.mirror.disk,
        }
    }

    pub(super) fn hold_dir(&self) -> PathBuf {
        match self {
            Live::Server(active) => active.hold_dir(),
            Live::Overleaf(live) => live.hold_dir(),
        }
    }

    pub(super) fn kick(&self) {
        let _ = self.local().writer.send(WriterSignal::Kick);
    }

    pub(super) async fn import_paths(&self, only: Option<Vec<String>>) -> Result<(), CollabError> {
        match self {
            Live::Server(active) => active.import_paths(only).await,
            Live::Overleaf(live) => live.import_paths(only).await,
        }
    }

    pub(super) fn import_later(self, only: Option<Vec<String>>) {
        tauri::async_runtime::spawn(async move {
            if let Err(error) = self.import_paths(only).await {
                self.local().log_once("import", || {
                    format!("could not send local changes: {error}")
                });
            }
        });
    }
}

pub(super) static ACTIVE: LazyLock<Mutex<Option<Live>>> = LazyLock::new(|| Mutex::new(None));
pub(super) static LIFECYCLE: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
pub(super) static FRESH_JOINS: LazyLock<Mutex<BTreeSet<String>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));

pub(super) struct Starting {
    pub(super) project_id: String,
    pub(super) server: String,
    pub(super) user: String,
    pub(super) joined: Arc<tokio::sync::Mutex<()>>,
    pub(super) cancelled: Arc<tokio::sync::Notify>,
    pub(super) wanted: bool,
}

pub(super) static STARTING: LazyLock<Mutex<Option<Starting>>> = LazyLock::new(|| Mutex::new(None));
static LINKS: AtomicU64 = AtomicU64::new(0);

pub(super) fn cancel_start(project_id: Option<&str>) {
    if let Some(starting) = guard(&STARTING)
        .as_mut()
        .filter(|starting| project_id.is_none_or(|id| id == starting.project_id))
    {
        starting.wanted = false;
        starting.cancelled.notify_one();
    }
}

pub(super) fn starting_on(server: &str, user: Option<&str>) -> Option<String> {
    guard(&STARTING)
        .as_ref()
        .filter(|starting| starting.server == server)
        .filter(|starting| user.is_none_or(|user| starting.user == user))
        .map(|starting| starting.project_id.clone())
}

pub(super) fn links_seen() -> u64 {
    LINKS.load(Ordering::SeqCst)
}

pub(super) fn links_changed() {
    LINKS.fetch_add(1, Ordering::SeqCst);
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

pub(super) fn app_runtime() -> tokio::runtime::Handle {
    tauri::async_runtime::handle().inner().clone()
}

pub(super) fn app_log() -> Result<AppLog, CollabError> {
    crate::paths::oleafly_root()
        .map(|root| AppLog::at(&root))
        .map_err(CollabError::Io)
}

pub(super) fn forget_live(disk: &LiveDisk) {
    disk.forget_memory();
    super::write::forget_reads(&disk.project_id);
    super::kept::forget_arrivals(&disk.root);
}

impl Active {
    #[cfg(test)]
    pub(super) fn assembled(
        local: LiveDisk,
        host: Arc<dyn LiveHost>,
        document_dir: PathBuf,
        live: SharedLive,
        handle: LiveHandle,
        link: LiveLink,
    ) -> Active {
        Active {
            local,
            host,
            document_dir,
            live,
            handle,
            link,
            account_id: AccountId::new_v7(),
            quiet_merge: AtomicBool::new(false),
            waiting: AtomicBool::new(false),
            last_status: Mutex::new(LiveStatus::Connecting),
        }
    }

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
        announce_renames(self.host.as_ref(), &self.local.project_id, &renamed);
        if !self.moves_the_main_file(&renamed) {
            return;
        }
        if let Some(applied) =
            crate::collab::settings::follow_renamed_main(&self.local.project_id, &renamed)
        {
            self.host.settings_changed(applied);
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
    fn disk(&self) -> &LiveDisk {
        &self.local
    }

    async fn write_pass(self: Arc<Self>, urgent: bool) -> Result<Vec<String>, CollabError> {
        self.write_out_paced(urgent).await
    }

    async fn import_pass(self: Arc<Self>, only: Vec<String>) -> Result<(), CollabError> {
        self.import_paths(Some(only)).await
    }
}
