use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::live::journal::{Journal, ProjectManifest};
use oleafly_online::live::session::{SessionConfig, SessionTuning};
use oleafly_online::realtime::Carrier;
use oleafly_online::session::{Session, SessionHandle};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser};
use oleafly_ot::{DocMessage, DocSink};

use super::notices::OverleafNoticePayload;
use super::{OverleafLive, Parts, TreeNotice, IMPORT_BASES};
use crate::collab::live::host::LiveHost;
use crate::collab::live::kept::KeptPayload;
use crate::collab::live::moves::RemovedPayload;
use crate::collab::live::payloads::{
    DocPendingPayload, MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload,
    RolePayload, StatusPayload,
};
use crate::collab::live::session::{guard, Live, ACTIVE};
use crate::collab::live::uploads::{UploadProgress, UploadsPayload};
use crate::folder_watch::FolderChange;
use crate::overleaf::OverleafLink;

pub(crate) const WAIT: Duration = Duration::from_secs(20);

#[derive(Default)]
pub(crate) struct Quiet {
    pub(crate) pending: Mutex<Vec<DocPendingPayload>>,
    pub(crate) notices: Mutex<Vec<OverleafNoticePayload>>,
    pub(crate) statuses: Mutex<Vec<StatusPayload>>,
    pub(crate) roles: Mutex<Vec<RolePayload>>,
    pub(crate) kept: Mutex<Vec<KeptPayload>>,
    pub(crate) presence: Mutex<Vec<PresencePayload>>,
    pub(crate) left: Mutex<Vec<String>>,
    pub(crate) members_changed: Mutex<usize>,
    pub(crate) changes: Mutex<Vec<FolderChange>>,
    pub(crate) removed: Mutex<Vec<RemovedPayload>>,
    pub(crate) uploads: Mutex<Vec<UploadsPayload>>,
    pub(crate) downloads: Mutex<Vec<UploadProgress>>,
    pub(crate) tree: Mutex<Vec<TreeNotice>>,
}

impl LiveHost for Quiet {
    fn status(&self, payload: StatusPayload) {
        self.statuses.lock().unwrap().push(payload);
    }
    fn role(&self, payload: RolePayload) {
        self.roles.lock().unwrap().push(payload);
    }
    fn kept(&self, payload: KeptPayload) {
        self.kept.lock().unwrap().push(payload);
    }
    fn merged(&self, _: MergedPayload) {}
    fn presence(&self, payload: PresencePayload) {
        self.presence.lock().unwrap().push(payload);
    }
    fn presence_left(&self, payload: PresenceLeftPayload) {
        self.left.lock().unwrap().push(payload.device_id);
    }
    fn overleaf_members(&self, _: crate::collab::live::payloads::OverleafMembersPayload) {
        *self.members_changed.lock().unwrap() += 1;
    }
    fn folder_changed(&self, change: FolderChange) {
        self.changes.lock().unwrap().push(change);
    }
    fn new_device(&self, _: NewDevicePayload) {}
    fn doc_pending(&self, payload: DocPendingPayload) {
        self.pending.lock().unwrap().push(payload);
    }

    fn overleaf_notice(&self, payload: OverleafNoticePayload) {
        self.notices.lock().unwrap().push(payload);
    }
    fn removed(&self, payload: RemovedPayload) {
        self.removed.lock().unwrap().push(payload);
    }
    fn uploads(&self, payload: UploadsPayload) {
        self.uploads.lock().unwrap().push(payload);
    }
    fn download_progress(&self, payload: UploadProgress) {
        self.downloads.lock().unwrap().push(payload);
    }
    fn overleaf_tree(&self, notice: TreeNotice) {
        self.tree.lock().unwrap().push(notice);
    }
}

pub(crate) struct Tab {
    pub(crate) file_id: String,
    pub(crate) text: String,
    rev: u64,
    pub(crate) inbox: Arc<Mutex<Vec<DocMessage>>>,
}

impl Tab {
    pub(crate) fn typed(&mut self, live: &OverleafLive, next: &str) {
        self.catch_up();
        let op = oleafly_ot::diff(&self.text, next);
        live.change(&self.file_id, self.rev, op).unwrap();
        self.text = next.to_owned();
    }

    pub(crate) fn catch_up(&mut self) {
        let messages = std::mem::take(&mut *self.inbox.lock().unwrap());
        for message in messages {
            match message {
                DocMessage::Ack { rev, .. } => self.rev = rev,
                DocMessage::Remote { rev, op, .. } => {
                    self.text = op.apply(&self.text).unwrap();
                    self.rev = rev;
                }
                DocMessage::Reset { rev, text } => {
                    self.text = text;
                    self.rev = rev;
                }
                DocMessage::Detached { .. } => {}
            }
        }
    }
}

pub(crate) struct OverleafRig {
    pub(crate) mock: MockOverleaf,
    pub(crate) live: Arc<OverleafLive>,
    pub(crate) host: Arc<Quiet>,
    pub(crate) project_id: String,
    pub(crate) root: PathBuf,
    _dir: tempfile::TempDir,
}

pub(crate) enum Place {
    Scratch,
    Library,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct FirstStart<'a> {
    pub(crate) imported: &'a [(&'a str, &'a str)],
    pub(crate) git_base: &'a [(&'a str, &'a str)],
    pub(crate) stalled: bool,
}

fn git(repo: &std::path::Path, args: &[&str]) {
    let mut full = vec!["-c", "user.name=Rig", "-c", "user.email=rig@example.test"];
    full.extend_from_slice(args);
    let output = crate::git::run_mirror_git(repo, &full).unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

pub(crate) fn git_base(dir: &std::path::Path, files: &[(&str, &str)]) -> Option<PathBuf> {
    if files.is_empty() {
        return None;
    }
    let repo = dir.join("git");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    for (path, text) in files {
        std::fs::write(repo.join(path), text).unwrap();
        git(&repo, &["add", path]);
    }
    git(&repo, &["commit", "-q", "-m", "base"]);
    git(&repo, &["update-ref", "refs/heads/oleafly-base", "HEAD"]);
    Some(repo)
}

fn import_base(dir: &std::path::Path, files: &[(&str, &str)]) {
    if files.is_empty() {
        return;
    }
    let bases: std::collections::BTreeMap<&str, &str> = files.iter().copied().collect();
    std::fs::create_dir_all(dir.join("mirror")).unwrap();
    std::fs::write(
        dir.join("mirror").join(IMPORT_BASES),
        serde_json::to_vec(&bases).unwrap(),
    )
    .unwrap();
}

pub(crate) struct LetGo {
    _mock: MockOverleaf,
    _dir: tempfile::TempDir,
}

pub(crate) fn session_of(user: &MockUser) -> Session {
    Session {
        cookie: user.cookie(),
        user_id: user.id.clone(),
        email: user.email.clone(),
        saved_by: None,
    }
}

fn tuning() -> SessionTuning {
    SessionTuning {
        tick: Duration::from_millis(20),
        trickle_every: Duration::from_millis(20),
        legacy_check: Duration::from_millis(400),
        legacy_grace: Duration::from_millis(50),
        legacy_every: Duration::from_millis(20),
        call_timeout: Duration::from_secs(5),
        ..SessionTuning::default()
    }
}

impl OverleafRig {
    pub(crate) async fn start(project: MockProject, disk: &[(&str, &str)]) -> OverleafRig {
        OverleafRig::start_at(project, disk, Place::Scratch).await
    }

    pub(crate) async fn start_at(
        project: MockProject,
        disk: &[(&str, &str)],
        place: Place,
    ) -> OverleafRig {
        let imported = FirstStart {
            imported: disk,
            ..FirstStart::default()
        };
        OverleafRig::start_first(project, disk, place, imported).await
    }

    pub(crate) async fn start_as(
        project: MockProject,
        disk: &[(&str, &str)],
        name: &str,
    ) -> OverleafRig {
        let imported = FirstStart {
            imported: disk,
            ..FirstStart::default()
        };
        OverleafRig::start_full(project, disk, Place::Scratch, imported, name).await
    }

    pub(crate) async fn start_first(
        project: MockProject,
        disk: &[(&str, &str)],
        place: Place,
        first: FirstStart<'_>,
    ) -> OverleafRig {
        OverleafRig::start_full(project, disk, place, first, "alice").await
    }

    async fn start_full(
        project: MockProject,
        disk: &[(&str, &str)],
        place: Place,
        first: FirstStart<'_>,
        name: &str,
    ) -> OverleafRig {
        let dir = tempfile::tempdir().unwrap();
        import_base(dir.path(), first.imported);
        let git_mirror = git_base(dir.path(), first.git_base);
        let mock = MockOverleaf::start(project).await;
        if first.stalled {
            mock.stall();
        }
        let (project_id, root, data) = match place {
            Place::Scratch => (
                "overleaf-rig".to_owned(),
                dir.path().join("project"),
                dir.path().join("data"),
            ),
            Place::Library => {
                let id = crate::project::create_blank_project("Rig".into()).unwrap();
                let mut meta = crate::project::read_meta(&id).unwrap();
                meta.extra.insert(
                    "importedFrom".to_owned(),
                    serde_json::json!({
                        "service": "overleaf",
                        "server": mock.base,
                        "projectId": mock.project_id(),
                    }),
                );
                crate::project::write_meta(&id, &meta).unwrap();
                let root = crate::paths::project_dir(&id).unwrap();
                (id, root, crate::paths::oleafly_root().unwrap())
            }
        };
        for (path, text) in disk {
            let target = root.join(path);
            tokio::fs::create_dir_all(target.parent().unwrap())
                .await
                .unwrap();
            tokio::fs::write(target, text).await.unwrap();
        }
        let user = mock.user(name);
        let session = SessionHandle::new(&mock.base, session_of(&user), None);
        let mut journal = Journal::open(&data, &mock.base, &mock.project_id(), None).unwrap();
        journal.set_manifest(ProjectManifest {
            user_id: user.id.clone(),
            history_version: Some(0),
            ..ProjectManifest::default()
        });
        journal.flush().unwrap();
        let host = Arc::new(Quiet::default());
        let parts = Parts {
            project_id: project_id.clone(),
            root: root.clone(),
            mirror_dir: dir.path().join("mirror"),
            host: Arc::clone(&host) as Arc<dyn LiveHost>,
            link: OverleafLink {
                server: mock.base.clone(),
                project_id: mock.project_id(),
            },
            config: SessionConfig {
                http: Http::new(&mock.base, "Oleafly/test").unwrap(),
                session,
                project_id: mock.project_id(),
                carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
                tuning: tuning(),
                seeds: Vec::new(),
            },
            journal,
            git_mirror,
        };
        let live = OverleafLive::start_with(parts).await.unwrap();
        *guard(&ACTIVE) = Some(Live::Overleaf(Arc::clone(&live)));
        OverleafRig {
            mock,
            live,
            host,
            project_id,
            root,
            _dir: dir,
        }
    }

    pub(crate) fn let_go(self) -> LetGo {
        let OverleafRig { mock, _dir, .. } = self;
        LetGo { _mock: mock, _dir }
    }

    pub(crate) fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).unwrap_or_default()
    }

    pub(crate) fn bytes(&self, path: &str) -> Vec<u8> {
        std::fs::read(self.root.join(path)).unwrap_or_default()
    }

    pub(crate) fn edit(&self, path: &str, text: &str) {
        std::fs::write(self.root.join(path), text).unwrap();
    }

    pub(crate) fn doc(&self, path: &str) -> String {
        self.mock.doc_id(path)
    }

    pub(crate) fn open(&self, path: &str) -> Tab {
        let inbox = Arc::new(Mutex::new(Vec::new()));
        let sink: DocSink = {
            let inbox = Arc::clone(&inbox);
            Arc::new(move |message| inbox.lock().unwrap().push(message))
        };
        let opened = self.live.open(path, sink).expect("a live document");
        Tab {
            file_id: opened.file_id,
            text: opened.text,
            rev: opened.rev,
            inbox,
        }
    }

    pub(crate) async fn finish(self) {
        let previous = guard(&ACTIVE).take();
        if let Some(Live::Overleaf(live)) = previous {
            live.finish().await;
        }
    }
}

pub(crate) fn run(test: impl std::future::Future<Output = ()>) {
    let _turn = crate::collab::live::write::rig::live_turn();
    tauri::async_runtime::block_on(test);
}

pub(crate) async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
