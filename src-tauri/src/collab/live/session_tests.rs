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
use super::{
    guard, pump, start, write, Active, ChangeSkippedPayload, LiveHost, MembersPayload, MergeMarks,
    MergedAuthor, MergedFile, MergedPayload, NewDevicePayload, PresenceLeftPayload,
    PresencePayload, RolePayload, StatusPayload, WrittenTexts, ACTIVE,
};
#[cfg(unix)]
use super::{lock, WriterSignal};
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
