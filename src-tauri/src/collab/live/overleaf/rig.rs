use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::live::journal::{Journal, ProjectManifest};
use oleafly_online::live::session::{SessionConfig, SessionTuning};
use oleafly_online::realtime::Carrier;
use oleafly_online::session::{Session, SessionHandle};
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject};
use oleafly_ot::{DocMessage, DocSink};

use super::{OverleafLive, Parts};
use crate::collab::live::host::LiveHost;
use crate::collab::live::payloads::{
    MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload,
    StatusPayload,
};
use crate::collab::live::session::{guard, Live, ACTIVE};
use crate::folder_watch::FolderChange;
use crate::overleaf::OverleafLink;

pub(crate) const WAIT: Duration = Duration::from_secs(20);

pub(crate) struct Quiet;

impl LiveHost for Quiet {
    fn status(&self, _: StatusPayload) {}
    fn role(&self, _: RolePayload) {}
    fn merged(&self, _: MergedPayload) {}
    fn presence(&self, _: PresencePayload) {}
    fn presence_left(&self, _: PresenceLeftPayload) {}
    fn folder_changed(&self, _: FolderChange) {}
    fn new_device(&self, _: NewDevicePayload) {}
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
    pub(crate) project_id: String,
    pub(crate) root: PathBuf,
    _dir: tempfile::TempDir,
}

pub(crate) enum Place {
    Scratch,
    Library,
}

pub(crate) struct LetGo {
    _mock: MockOverleaf,
    _dir: tempfile::TempDir,
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
        let dir = tempfile::tempdir().unwrap();
        let mock = MockOverleaf::start(project).await;
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
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, text).unwrap();
        }
        let user = mock.user("alice");
        let session = SessionHandle::new(
            &mock.base,
            Session {
                cookie: user.cookie(),
                user_id: user.id.clone(),
                email: user.email.clone(),
                saved_by: None,
            },
            None,
        );
        let mut journal = Journal::open(&data, &mock.base, &mock.project_id(), None).unwrap();
        journal.set_manifest(ProjectManifest {
            user_id: user.id.clone(),
            history_version: Some(0),
            ..ProjectManifest::default()
        });
        journal.flush().unwrap();
        let parts = Parts {
            project_id: project_id.clone(),
            root: root.clone(),
            mirror_dir: dir.path().join("mirror"),
            host: Arc::new(Quiet),
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
            },
            journal,
        };
        let live = OverleafLive::start_with(parts).await.unwrap();
        *guard(&ACTIVE) = Some(Live::Overleaf(Arc::clone(&live)));
        OverleafRig {
            mock,
            live,
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

pub(crate) async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
