#[cfg(unix)]
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_collab::doc::ProjectDoc;
use oleafly_collab::live::{LiveProject, MergeReport};
use oleafly_collab::sync::{spawn_live, EndReason, LiveEvent, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{load_binding, save_binding, ServerClient, ServerUrl};
use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::frames::{MemberChange, MemberChangeKind};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use oleafly_collab_protocol::projects::ProjectRole;
use tokio::sync::mpsc;
#[cfg(unix)]
use tokio::sync::mpsc::UnboundedReceiver;

use super::import_tests::project;
#[cfg(unix)]
use super::WriterSignal;
use super::{
    guard, lock, pump, start, write, Active, ChangeSkippedPayload, LiveHost, MembersPayload,
    MergeMarks, MergedAuthor, MergedFile, MergedPayload, NewDevicePayload, PresenceLeftPayload,
    PresencePayload, RolePayload, StatusPayload, WrittenTexts, ACTIVE,
};
use crate::collab::state::CollabState;
use crate::folder_watch::FolderChange;

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
        let _turn = write::rig::live_turn();
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
                upkeep: Default::default(),
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

#[derive(Default)]
struct RecordingHost {
    new_devices: Mutex<Vec<NewDevicePayload>>,
    merged: Mutex<Vec<MergedPayload>>,
    skipped: Mutex<Vec<ChangeSkippedPayload>>,
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
    fn change_skipped(&self, payload: ChangeSkippedPayload) {
        guard(&self.skipped).push(payload);
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
            upkeep: Default::default(),
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
    let _turn = write::rig::live_turn();
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
        let (paused, gone, plain, removed) = (
            ServerId::new_v7(),
            ServerId::new_v7(),
            ServerId::new_v7(),
            ServerId::new_v7(),
        );
        for (project, server) in [
            ("paused", paused),
            ("gone", gone),
            ("plain", plain),
            ("removed", removed),
        ] {
            save_binding(&paths, project, &binding_on(server)).unwrap();
        }
        LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Editor)
            .save(&paths.document_dir("gone").unwrap())
            .unwrap();
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
        for (project, code) in [
            ("paused", "signed_out"),
            ("gone", "signed_out"),
            ("plain", "signed_out"),
            ("removed", "server_removed"),
        ] {
            let started = start(&state, Arc::clone(&host) as Arc<dyn LiveHost>, project).await;
            let refused = crate::collab::commands::CollabCommandError::from(
                started.expect_err("a project without a session never goes live"),
            );
            assert_eq!(refused.code, code, "{project}");
        }
        let ended = |reason| LiveStatus::Ended { reason };
        assert_eq!(
            ended_with(&guard(&host.statuses)),
            vec![
                ("paused".to_owned(), ended(EndReason::AccountSuspended)),
                ("gone".to_owned(), ended(EndReason::AccessEnded)),
                ("plain".to_owned(), ended(EndReason::SignedOut)),
                ("removed".to_owned(), ended(EndReason::SignedOut)),
            ]
        );
        assert!(load_binding(&paths, "paused").unwrap().is_some());
        assert!(load_binding(&paths, "gone").unwrap().is_none());
        assert!(super::local_copy::has_origin(&paths, "gone"));
        assert!(load_binding(&paths, "plain").unwrap().is_some());
        assert!(load_binding(&paths, "removed").unwrap().is_some());
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
            upkeep: Default::default(),
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

#[test]
fn the_pump_tells_the_window_about_a_change_it_had_to_skip() {
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
            server_id: ServerId::new_v7(),
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
        let host = Arc::new(RecordingHost::default());
        let active = Arc::new(Active {
            project_id: "skipping".to_owned(),
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
            upkeep: Default::default(),
        });
        let (events, receiver) = mpsc::unbounded_channel();
        let pumping = tokio::spawn(pump(
            Arc::downgrade(&active),
            receiver,
            state.paths().unwrap().clone(),
        ));
        let laptop = DeviceId::new_v7();
        events
            .send(LiveEvent::Unreadable {
                seq: 7,
                device_id: Some(laptop),
            })
            .unwrap();
        events
            .send(LiveEvent::Unreadable {
                seq: 9,
                device_id: None,
            })
            .unwrap();
        drop(events);
        pumping.await.unwrap();
        active.handle.stop();
        let skipped = guard(&host.skipped).clone();
        assert_eq!(
            skipped,
            vec![
                ChangeSkippedPayload {
                    project_id: "skipping".to_owned(),
                    seq: 7,
                    device_id: Some(laptop),
                },
                ChangeSkippedPayload {
                    project_id: "skipping".to_owned(),
                    seq: 9,
                    device_id: None,
                },
            ]
        );
        assert_eq!(
            serde_json::to_value(&skipped[1]).unwrap(),
            serde_json::json!({ "projectId": "skipping", "seq": 9, "deviceId": null })
        );
        assert_eq!(
            serde_json::to_value(&skipped[0]).unwrap()["deviceId"],
            serde_json::json!(laptop.to_string())
        );
        assert_eq!(
            super::payloads::CHANGE_SKIPPED_EVENT,
            "collab-change-skipped"
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
            upkeep: Default::default(),
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
            upkeep: Default::default(),
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

#[derive(Default)]
struct Watching {
    changes: Mutex<Vec<FolderChange>>,
    unwritten: Mutex<Vec<super::unwritten::UnwrittenPayload>>,
}

impl Watching {
    fn changed_paths(&self) -> Vec<String> {
        guard(&self.changes)
            .iter()
            .flat_map(|change| change.paths.clone())
            .collect()
    }

    #[cfg(unix)]
    fn told(&self) -> Option<Vec<super::unwritten::UnwrittenFile>> {
        guard(&self.unwritten)
            .last()
            .map(|payload| payload.files.clone())
    }
}

impl LiveHost for Watching {
    fn status(&self, _: StatusPayload) {}
    fn role(&self, _: RolePayload) {}
    fn merged(&self, _: MergedPayload) {}
    fn presence(&self, _: PresencePayload) {}
    fn presence_left(&self, _: PresenceLeftPayload) {}
    fn folder_changed(&self, change: FolderChange) {
        guard(&self.changes).push(change);
    }
    fn new_device(&self, _: NewDevicePayload) {}
    fn unwritten(&self, payload: super::unwritten::UnwrittenPayload) {
        guard(&self.unwritten).push(payload);
    }
}

fn watched_rig(
    project_id: &str,
    files: &[(&str, &str)],
) -> (
    tempfile::TempDir,
    std::path::PathBuf,
    Arc<Watching>,
    write::rig::LiveRig,
) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    std::fs::create_dir_all(&root).unwrap();
    let host = Arc::new(Watching::default());
    let rig = write::rig::LiveRig::heard_by(
        project_id,
        &root,
        files,
        Arc::clone(&host) as Arc<dyn LiveHost>,
    );
    (dir, root, host, rig)
}

#[test]
fn typing_in_an_open_file_reaches_disk_without_calling_it_an_outside_change() {
    let (_dir, root, host, rig) = watched_rig("echo", &[("main.tex", "abc"), ("refs.bib", "@a")]);
    let (main, rev) = rig.open("main.tex");
    rig.typed(&main, rev, "d");
    rig.remote("refs.bib", "@b");
    rig.settle();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abcd"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("refs.bib")).unwrap(),
        "@b"
    );
    let changed = host.changed_paths();
    assert!(!changed.contains(&"main.tex".to_owned()), "{changed:?}");
    assert!(changed.contains(&"refs.bib".to_owned()), "{changed:?}");
}

#[test]
fn a_file_blocked_by_a_folder_does_not_hold_back_the_others_and_is_written_once_it_can_be() {
    let (_dir, root, _host, rig) = watched_rig("blocked", &[("main.tex", "abc")]);
    rig.remote_new("table.tex", "T");
    std::fs::create_dir_all(root.join("table.tex/inner")).unwrap();
    rig.remote("main.tex", "abcd");
    rig.settle();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abcd"
    );
    assert!(root.join("table.tex").is_dir());
    std::fs::remove_dir_all(root.join("table.tex")).unwrap();
    rig.settle();
    assert_eq!(
        std::fs::read_to_string(root.join("table.tex")).unwrap(),
        "T"
    );
}

fn fail_main(rig: &write::rig::LiveRig, times: usize) {
    let active = rig.active();
    let layout = guard(&active.disk).layout.clone();
    for _ in 0..times {
        active.settle_unwritten(
            &layout,
            super::unwritten::Settled {
                failed: vec![(
                    "main.tex".to_owned(),
                    super::unwritten::UnwrittenReason::Locked,
                )],
                ..Default::default()
            },
        );
    }
}

#[test]
fn a_file_that_keeps_failing_is_tried_again_on_every_pass() {
    let (_dir, _root, _host, rig) = watched_rig("still-failing", &[("main.tex", "abc")]);
    let active = rig.active();
    let main = guard(&active.disk)
        .layout
        .iter()
        .find(|(_, placed)| placed.path == "main.tex")
        .map(|(id, _)| id.clone())
        .unwrap();
    let _ = lock(&active.live).take_disk_work();
    for attempt in 1..=10 {
        fail_main(&rig, 1);
        let work = lock(&active.live).take_disk_work();
        assert!(
            work.texts.contains(&main),
            "attempt {attempt} was not retried"
        );
    }
}

#[test]
fn a_new_session_starts_without_the_failures_of_the_last_one() {
    let told = |host: &Watching| {
        guard(&host.unwritten)
            .iter()
            .map(|payload| payload.files.len())
            .collect::<Vec<_>>()
    };
    {
        let (_dir, _root, host, rig) = watched_rig("fresh-books", &[("main.tex", "abc")]);
        fail_main(&rig, 3);
        assert_eq!(told(&host), vec![1]);
    }
    let (_dir, _root, host, rig) = watched_rig("fresh-books", &[("main.tex", "abc")]);
    fail_main(&rig, 1);
    assert_eq!(told(&host), Vec::<usize>::new());
    fail_main(&rig, 1);
    assert_eq!(told(&host), vec![1]);
}

#[test]
fn a_file_that_cannot_be_written_waits_for_its_next_try_while_others_are_written() {
    let (_dir, root, _host, rig) = watched_rig("waiting-try", &[("main.tex", "abc")]);
    rig.remote_new_dir("figs");
    rig.settle();
    assert!(root.join("figs").is_dir());
    std::fs::remove_dir(root.join("figs")).unwrap();
    std::fs::write(root.join("figs"), "a file in the way").unwrap();
    rig.remote_new_in("figs", "a.tex", "A");
    let active = rig.active();
    tauri::async_runtime::block_on(active.write_out_paced(false)).unwrap();
    assert_eq!(active.tries_of("figs/a.tex"), 1);
    for round in 0..4 {
        let text = format!("abc {round}");
        rig.remote("main.tex", &text);
        tauri::async_runtime::block_on(active.write_out_paced(false)).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            text
        );
    }
    assert_eq!(
        active.tries_of("figs/a.tex"),
        1,
        "the file that cannot be written was tried on every pass"
    );
    tauri::async_runtime::block_on(active.write_out()).unwrap();
    assert_eq!(active.tries_of("figs/a.tex"), 2, "a flush tries it once");
}

#[cfg(unix)]
#[test]
fn a_file_in_a_folder_that_refuses_writes_is_retried_reported_and_written_once_it_can_be() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, root, host, rig) = watched_rig("locked", &[("main.tex", "abc")]);
    rig.remote_new_dir("locked");
    rig.settle();
    let locked = root.join("locked");
    assert!(locked.is_dir());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
    if std::fs::write(locked.join("probe"), "x").is_ok() {
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }
    rig.remote_new_in("locked", "a.tex", "A");
    rig.remote("main.tex", "abcd");
    rig.settle();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abcd"
    );
    assert!(!locked.join("a.tex").exists());
    rig.settle();
    let told = host.told();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        told,
        Some(vec![super::unwritten::UnwrittenFile {
            path: "locked/a.tex".to_owned(),
            reason: super::unwritten::UnwrittenReason::ReadOnly,
        }])
    );
    rig.settle();
    assert_eq!(std::fs::read_to_string(locked.join("a.tex")).unwrap(), "A");
    assert_eq!(host.told(), Some(Vec::new()));
}

#[test]
fn files_the_project_leaves_out_never_enter_the_shared_tree_but_shared_ones_keep_syncing() {
    let (_dir, root, _host, rig) =
        watched_rig("ignored", &[("main.tex", "abc"), ("old.aux", "kept")]);
    std::fs::write(root.join(".gitignore"), "*.aux\nbuild/\n").unwrap();
    std::fs::create_dir_all(root.join("build")).unwrap();
    for (path, text) in [
        ("main.aux", "aux"),
        (".main.tex.swp", "swap"),
        ("main.tex~", "backup"),
        ("#main.tex#", "autosave"),
        ("build/main.log", "log"),
        ("notes.tex", "notes"),
        ("old.aux", "kept and changed"),
    ] {
        std::fs::write(root.join(path), text).unwrap();
    }
    rig.import(&[
        "main.aux",
        ".main.tex.swp",
        "main.tex~",
        "#main.tex#",
        "build",
        "build/main.log",
        "notes.tex",
        "old.aux",
    ]);
    assert_eq!(rig.paths(), ["main.tex", "notes.tex", "old.aux"]);
    assert_eq!(rig.text("old.aux").as_deref(), Some("kept and changed"));
}

#[test]
fn a_viewer_write_is_refused_as_read_only_and_never_reaches_the_document() {
    let (_dir, root, _host, rig) = watched_rig("viewing", &[("main.tex", "abc")]);
    let _live = rig.go_live();
    rig.set_role(ProjectRole::Viewer);
    let outcome = tauri::async_runtime::block_on(write::write_text(
        "viewing",
        "main.tex",
        Some("abc"),
        "abc and more",
    ))
    .unwrap();
    assert_eq!(
        outcome,
        write::WriteOutcome {
            handled: false,
            reason: Some("read_only".to_owned()),
        }
    );
    assert_eq!(
        serde_json::to_value(&outcome).unwrap(),
        serde_json::json!({ "handled": false, "reason": "read_only" })
    );
    assert_eq!(rig.text("main.tex").as_deref(), Some("abc"));
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abc"
    );
    let outside =
        tauri::async_runtime::block_on(write::write_text("viewing", "project.json", None, "{}"))
            .unwrap();
    assert_eq!(outside.reason, None);
}

#[test]
fn closing_an_older_editor_channel_leaves_the_newer_one_open() {
    let (_dir, _root, _host, rig) = watched_rig("channels", &[("main.tex", "abc")]);
    let _live = rig.go_live();
    let quiet: oleafly_collab::live::DocSink = Arc::new(|_| {});
    let first = super::editor::doc_open("channels", "main.tex", Arc::clone(&quiet))
        .unwrap()
        .expect("main.tex opens");
    let second = super::editor::doc_open("channels", "main.tex", quiet)
        .unwrap()
        .expect("main.tex opens again");
    assert_ne!(first.session, second.session);
    super::editor::doc_close("channels", &first.file_id, first.session);
    let active = super::active_for("channels").unwrap();
    assert!(super::lock(&active.live).is_open(&second.file_id));
    super::editor::doc_close("channels", &second.file_id, second.session);
    assert!(!super::lock(&active.live).is_open(&second.file_id));
}

#[test]
fn reconnecting_now_reaches_the_running_session_and_is_harmless_without_one() {
    let (_dir, _root, _host, rig) = watched_rig("reconnecting", &[("main.tex", "abc")]);
    {
        let _live = rig.go_live();
        assert!(super::lifecycle::reconnect_now());
    }
    let _turn = write::rig::live_turn();
    assert!(!super::lifecycle::reconnect_now());
    assert!(tauri::async_runtime::block_on(super::commands::collab_live_reconnect_now()).is_ok());
}

#[test]
fn quitting_right_after_typing_offline_keeps_the_edit_in_the_document_and_on_disk() {
    let (_dir, root, _host, rig) = watched_rig("quitting", &[("main.tex", "abc")]);
    let _live = rig.go_live();
    let (main, rev) = rig.open("main.tex");
    rig.typed(&main, rev, " typed just before quitting");
    super::finish_for_quit(Duration::from_secs(5));
    assert!(super::active_for("quitting").is_none());
    assert_eq!(
        rig.saved_text("main.tex").as_deref(),
        Some("abc typed just before quitting")
    );
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abc typed just before quitting"
    );
}

#[test]
fn typing_reaches_the_disk_while_the_shared_document_cannot_be_saved() {
    let (_dir, root, _host, rig) = watched_rig("unsaved", &[("main.tex", "abc")]);
    let (main, rev) = rig.open("main.tex");
    let document = rig.document_dir();
    let _ = std::fs::remove_dir_all(&document);
    std::fs::write(&document, "in the way").unwrap();
    rig.typed(&main, rev, " typed while the document cannot be saved");
    rig.settle();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abc typed while the document cannot be saved"
    );
    std::fs::remove_file(&document).unwrap();
    rig.settle();
    assert_eq!(
        rig.saved_text("main.tex").as_deref(),
        Some("abc typed while the document cannot be saved")
    );
}

#[test]
fn an_index_saved_outside_a_pass_is_never_taken_for_the_one_a_pass_would_write() {
    let (_dir, _root, _host, rig) = watched_rig("index-books", &[("main.tex", "abc")]);
    let active = rig.active();
    lock(&active.live).mark_all_dirty().unwrap();
    rig.settle();
    let on_disk = || crate::collab::disk::DiskState::load(&active.disk_file).hashes;
    let passed = guard(&active.disk).hashes.clone();
    assert_eq!(on_disk(), passed);
    guard(&active.disk)
        .hashes
        .insert("extra.tex".to_owned(), "1234".to_owned());
    active.save_now();
    assert!(on_disk().contains_key("extra.tex"));
    guard(&active.disk).hashes.remove("extra.tex");
    lock(&active.live).mark_all_dirty().unwrap();
    rig.settle();
    assert_eq!(on_disk(), passed);
}

#[test]
fn quitting_while_a_stop_is_still_writing_waits_for_it() {
    let (_dir, root, _host, rig) = watched_rig("quit-mid-stop", &[("main.tex", "abc")]);
    let _live = rig.go_live();
    let (main, rev) = rig.open("main.tex");
    let active = rig.active();
    let held = guard(&active.disk);
    rig.typed(&main, rev, " typed as the session stops");
    let stopping = std::thread::spawn(|| {
        tauri::async_runtime::block_on(super::stop("quit-mid-stop"));
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while super::active_for("quit-mid-stop").is_some() {
        assert!(std::time::Instant::now() < deadline, "the stop never began");
        std::thread::sleep(Duration::from_millis(10));
    }
    let (quit, quitted) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        super::finish_for_quit(Duration::from_secs(10));
        let _ = quit.send(());
    });
    let early = quitted.recv_timeout(Duration::from_millis(300)).is_ok();
    drop(held);
    quitted
        .recv_timeout(Duration::from_secs(20))
        .unwrap_or_else(|_| assert!(early, "quitting never finished"));
    stopping.join().unwrap();
    assert!(!early, "quitting returned while the stop was still writing");
    assert_eq!(
        rig.saved_text("main.tex").as_deref(),
        Some("abc typed as the session stops")
    );
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        "abc typed as the session stops"
    );
}

#[test]
fn a_sooner_wake_up_is_not_held_back_by_a_later_one() {
    let (writer, mut woken) = mpsc::unbounded_channel();
    let alarm = super::session::Alarm::default();
    tauri::async_runtime::block_on(async {
        alarm.ring_in(&writer, Duration::from_secs(60));
        alarm.ring_in(&writer, Duration::from_millis(50));
        let first = tokio::time::timeout(Duration::from_secs(5), woken.recv()).await;
        assert!(matches!(first, Ok(Some(super::WriterSignal::Kick))));
    });
}

#[test]
fn reading_a_folder_for_an_import_leaves_the_shared_document_free() {
    let (_dir, root, _host, rig) = watched_rig("lock-free", &[("main.tex", "abc")]);
    std::fs::create_dir_all(root.join("figs")).unwrap();
    std::fs::write(root.join("figs/a.tex"), "a").unwrap();
    std::fs::write(root.join("figs/held-open.tex"), "slow").unwrap();
    let (reading, read) = std::sync::mpsc::channel::<()>();
    let (go, wait) = std::sync::mpsc::channel::<()>();
    let (reading, wait) = (Mutex::new(reading), Mutex::new(wait));
    *guard(&super::import::BEFORE_READ) = Some(Arc::new(move |path: &str| {
        if path == "figs/held-open.tex" {
            let _ = guard(&reading).send(());
            let _ = guard(&wait).recv_timeout(Duration::from_secs(20));
        }
    }));
    let live = rig.shared_live();
    let importing = std::thread::spawn(move || {
        rig.import(&["figs"]);
        rig
    });
    let reached = read.recv_timeout(Duration::from_secs(20)).is_ok();
    let (taken, took) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _held = live.lock();
        let _ = taken.send(());
    });
    let free = took.recv_timeout(Duration::from_secs(5)).is_ok();
    let _ = go.send(());
    let rig = importing.join().unwrap();
    *guard(&super::import::BEFORE_READ) = None;
    assert!(reached, "the import never read the folder");
    assert!(
        free,
        "typing and syncing waited while the import read files"
    );
    assert_eq!(
        rig.paths(),
        ["figs", "figs/a.tex", "figs/held-open.tex", "main.tex"]
    );
}

#[test]
fn opening_a_project_takes_in_local_text_at_once_and_leaves_new_figures_for_later() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    std::fs::create_dir_all(root.join("figs")).unwrap();
    let (live, disk, main) = project(&root);
    std::fs::write(root.join("main.tex"), "abc edited while closed").unwrap();
    std::fs::write(root.join("figs/new.png"), [0x89, b'P', 0, 9]).unwrap();
    let caught = tauri::async_runtime::block_on(super::sync_hold::catch_up(
        root.clone(),
        dir.path().join("collab"),
        live,
        disk,
    ))
    .unwrap();
    assert_eq!(caught.to_upload, ["figs/new.png"]);
    assert_eq!(
        caught.live.doc().text(&main).unwrap(),
        "abc edited while closed"
    );
    let shared: Vec<String> =
        oleafly_collab::materialize::layout(&caught.live.doc().nodes().unwrap())
            .into_values()
            .map(|placed| placed.path)
            .collect();
    assert!(!shared.contains(&"figs/new.png".to_owned()), "{shared:?}");
}

#[test]
fn typing_saves_the_document_and_writes_the_file_about_once_a_second() {
    let (_dir, root, _host, rig) = watched_rig("paced", &[("main.tex", "abc")]);
    let (main, rev) = rig.open("main.tex");
    let keys: Vec<char> = ('a'..='z').chain('a'..='n').collect();
    let started = std::time::Instant::now();
    for (at, key) in keys.iter().enumerate() {
        rig.typed(&main, rev + at as u64, &key.to_string());
        rig.kick();
        std::thread::sleep(Duration::from_millis(30));
    }
    let elapsed = started.elapsed();
    rig.settle();
    let typed: String = keys.iter().collect();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        format!("abc{typed}")
    );
    let counted = rig.counted();
    let bound = elapsed.as_secs() as usize + 3;
    assert!(counted.saves <= bound, "{counted:?} in {elapsed:?}");
    assert!(counted.writes <= bound, "{counted:?} in {elapsed:?}");
    assert!(counted.indexes <= bound, "{counted:?} in {elapsed:?}");
    assert_eq!(rig.saved_text("main.tex"), Some(format!("abc{typed}")));
}
