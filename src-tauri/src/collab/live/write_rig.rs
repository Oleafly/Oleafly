use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::sync::{spawn_live, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{ServerClient, ServerUrl};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use tokio::sync::{mpsc, oneshot};

use super::super::{
    guard, initial_bases, lock, writer_loop, Active, LiveHost, MergedPayload, NewDevicePayload,
    PresenceLeftPayload, PresencePayload, RolePayload, StatusPayload, WriterSignal, ACTIVE,
};
use super::SharedDocument;
use crate::collab::disk::{sha256_hex, DiskState};
use crate::collab::state::CollabState;
use crate::folder_watch::FolderChange;

static LIVE_TURN: Mutex<()> = Mutex::new(());

pub(crate) fn live_turn() -> MutexGuard<'static, ()> {
    LIVE_TURN.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) struct LiveNow {
    _turn: MutexGuard<'static, ()>,
}

impl Drop for LiveNow {
    fn drop(&mut self) {
        *guard(&ACTIVE) = None;
    }
}

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

pub(crate) struct LiveRig {
    active: Arc<Active>,
    seq: AtomicU64,
    _dir: tempfile::TempDir,
}

impl LiveRig {
    pub(crate) fn start(project_id: &str, root: &Path, files: &[(&str, &str)]) -> LiveRig {
        LiveRig::heard_by(project_id, root, files, Arc::new(Quiet))
    }

    pub(crate) fn heard_by(
        project_id: &str,
        root: &Path,
        files: &[(&str, &str)],
        host: Arc<dyn LiveHost>,
    ) -> LiveRig {
        let dir = tempfile::tempdir().unwrap();
        let mut doc = ProjectDoc::create().unwrap();
        let mut hashes = BTreeMap::new();
        for (path, text) in files {
            assert!(!path.contains('/'), "the rig shares top-level files only");
            std::fs::write(root.join(path), text).unwrap();
            doc.add_node(None, path, NodeKind::Text, None, text)
                .unwrap();
            hashes.insert((*path).to_owned(), sha256_hex(text.as_bytes()));
        }
        let disk = DiskState {
            layout: materialize::layout(&doc.nodes().unwrap()),
            hashes,
            owed: Default::default(),
        };
        let live = LiveProject::new(doc, 0, ProjectRole::Owner);
        let bases = initial_bases(root, &disk, &live);
        let collab = dir.path().join("collab");
        std::fs::create_dir_all(&collab).unwrap();
        let project_id = project_id.to_owned();
        let root: PathBuf = root.to_path_buf();
        let keys_dir = dir.path().join("keys");
        let active = tauri::async_runtime::block_on(async move {
            let state = CollabState::new(
                oleafly_collab::CollabPaths::new(keys_dir),
                Arc::new(oleafly_collab::secret_port::MemorySecrets::default()),
            );
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
            let active = Arc::new(Active {
                project_id,
                root,
                document_dir: collab.join("document"),
                disk_file: collab.join("materializer-index.json"),
                live: shared,
                handle,
                link,
                disk: Mutex::new(disk),
                host,
                writer,
                account_id: AccountId::new_v7(),
                quiet_merge: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
                last_status: Mutex::new(LiveStatus::Connecting),
                bases: Mutex::new(bases),
                upkeep: Default::default(),
            });
            tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
            active
        });
        LiveRig {
            active,
            seq: AtomicU64::new(0),
            _dir: dir,
        }
    }

    pub(crate) fn document(&self) -> SharedDocument {
        SharedDocument(Arc::clone(&self.active))
    }

    pub(in crate::collab::live) fn active(&self) -> Arc<Active> {
        Arc::clone(&self.active)
    }

    pub(crate) fn document_dir(&self) -> PathBuf {
        self.active.document_dir.clone()
    }

    fn id_of(&self, path: &str) -> Option<String> {
        let live = lock(&self.active.live);
        materialize::layout(&live.doc().nodes().unwrap())
            .into_iter()
            .find(|(_, placed)| placed.path == path)
            .map(|(id, _)| id)
    }

    pub(crate) fn text(&self, path: &str) -> Option<String> {
        let id = self.id_of(path)?;
        lock(&self.active.live).doc().text(&id).ok()
    }

    pub(crate) fn paths(&self) -> Vec<String> {
        let live = lock(&self.active.live);
        let mut paths: Vec<String> = materialize::layout(&live.doc().nodes().unwrap())
            .into_values()
            .map(|placed| placed.path)
            .collect();
        paths.sort();
        paths
    }

    fn arrive(&self, change: impl FnOnce(&mut ProjectDoc)) {
        let mut live = lock(&self.active.live);
        let mut peer = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
        let since = live.doc().version();
        change(&mut peer);
        let payload = peer.export_since(&since).unwrap();
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(live.import_update(seq, &payload).unwrap());
    }

    pub(crate) fn remote(&self, path: &str, text: &str) {
        let id = self
            .id_of(path)
            .expect("the remote edit names a shared file");
        self.arrive(|peer| {
            peer.set_text(&id, text).unwrap();
        });
    }

    pub(crate) fn remote_new(&self, path: &str, text: &str) {
        self.arrive(|peer| {
            peer.add_node(None, path, NodeKind::Text, None, text)
                .unwrap();
        });
    }

    pub(crate) fn remote_remove(&self, path: &str) {
        let id = self.id_of(path).expect("the removed path is shared");
        self.arrive(|peer| {
            peer.trash(&id).unwrap();
        });
    }

    pub(crate) fn remote_rename(&self, path: &str, name: &str) {
        let id = self.id_of(path).expect("the renamed path is shared");
        self.arrive(|peer| {
            peer.rename(&id, name).unwrap();
        });
    }

    pub(crate) fn remote_new_dir(&self, path: &str) {
        self.arrive(|peer| {
            peer.add_node(None, path, NodeKind::Dir, None, "").unwrap();
        });
    }

    pub(crate) fn remote_new_in(&self, folder: &str, name: &str, text: &str) {
        let parent = self.id_of(folder).expect("the folder is shared");
        self.arrive(|peer| {
            peer.add_node(Some(&parent), name, NodeKind::Text, None, text)
                .unwrap();
        });
    }

    pub(crate) fn set_role(&self, role: ProjectRole) {
        lock(&self.active.live).set_role(role);
    }

    pub(crate) fn open(&self, path: &str) -> (String, u64) {
        let id = self.id_of(path).expect("the opened path is shared");
        let sink: oleafly_collab::live::DocSink = Arc::new(|_| {});
        let opened = lock(&self.active.live).open_file(&id, sink).unwrap();
        (id, opened.rev)
    }

    pub(crate) fn typed(&self, id: &str, rev: u64, at_end: &str) {
        let mut live = lock(&self.active.live);
        let text = live.doc().text(id).unwrap();
        let mut operation = oleafly_collab::ot::TextOperation::new();
        operation.retain(text.encode_utf16().count()).insert(at_end);
        live.editor_change(id, rev, operation).unwrap();
    }

    pub(crate) fn go_live(&self) -> LiveNow {
        let turn = live_turn();
        *guard(&ACTIVE) = Some(Arc::clone(&self.active));
        LiveNow { _turn: turn }
    }

    pub(crate) fn trashed(&self) -> Vec<String> {
        let live = lock(&self.active.live);
        let mut names: Vec<String> = crate::collab::tree::trash_list(&live)
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        names.sort();
        names
    }

    pub(crate) fn kick(&self) {
        self.active.kick();
    }

    pub(in crate::collab::live) fn counted(&self) -> super::super::pacing::Counted {
        self.active.counted()
    }

    pub(crate) fn shared_live(&self) -> SharedLive {
        Arc::clone(&self.active.live)
    }

    pub(crate) fn saved_text(&self, path: &str) -> Option<String> {
        let id = self.id_of(path)?;
        let saved = LiveProject::load(&self.active.document_dir, ProjectRole::Owner).ok()?;
        saved.doc().text(&id).ok()
    }

    pub(crate) fn import(&self, paths: &[&str]) {
        let paths = paths.iter().map(|path| (*path).to_owned()).collect();
        tauri::async_runtime::block_on(self.active.import_paths(Some(paths))).unwrap();
    }

    pub(crate) fn settle(&self) {
        let (done, wait) = oneshot::channel();
        let _ = self.active.writer.send(WriterSignal::Flush(done));
        tauri::async_runtime::block_on(async move {
            let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
        });
    }
}

impl Drop for LiveRig {
    fn drop(&mut self) {
        self.active.handle.stop();
    }
}
