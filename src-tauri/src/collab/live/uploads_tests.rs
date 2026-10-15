use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::sync::{spawn_live, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{DeviceKey, MemorySecrets, ServerClient, ServerUrl, SessionManager};
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, EncryptionSupport, Features, Limits, ProtocolRange, PROTOCOL_VERSION,
};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{seed_person, test_config, PersonSeed, TestServer};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::super::{
    guard, initial_bases, lock, pump, writer_loop, Active, LiveHost, MergedPayload,
    NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload, StatusPayload,
    WriterSignal,
};
use super::{attach, progress_for, Retry, UploadFile, UploadProgress, UploadState, UploadsPayload};
use crate::collab::disk::{sha256_hex, DiskState};
use crate::folder_watch::FolderChange;

const WAIT: Duration = Duration::from_secs(25);

#[derive(Default)]
struct Recording {
    uploads: Mutex<Vec<UploadsPayload>>,
    statuses: Mutex<Vec<LiveStatus>>,
    progress: Mutex<Vec<UploadProgress>>,
}

impl Recording {
    fn last_uploads(&self) -> Option<Vec<UploadFile>> {
        self.uploads
            .lock()
            .unwrap()
            .last()
            .map(|payload| payload.files.clone())
    }

    fn status(&self) -> Option<LiveStatus> {
        self.statuses.lock().unwrap().last().cloned()
    }
}

impl LiveHost for Recording {
    fn status(&self, payload: StatusPayload) {
        self.statuses.lock().unwrap().push(payload.status);
    }
    fn role(&self, _: RolePayload) {}
    fn merged(&self, _: MergedPayload) {}
    fn presence(&self, _: PresencePayload) {}
    fn presence_left(&self, _: PresenceLeftPayload) {}
    fn folder_changed(&self, _: FolderChange) {}
    fn new_device(&self, _: NewDevicePayload) {}
    fn uploads(&self, payload: UploadsPayload) {
        self.uploads.lock().unwrap().push(payload);
    }
    fn upload_progress(&self, payload: UploadProgress) {
        self.progress.lock().unwrap().push(payload);
    }
}

fn run(test: impl std::future::Future<Output = ()>) {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(test);
}

async fn until(what: &str, mut check: impl FnMut() -> bool) {
    tokio::time::timeout(WAIT, async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

struct Side {
    active: Arc<Active>,
    host: Arc<Recording>,
    root: PathBuf,
    _dir: tempfile::TempDir,
}

impl Side {
    fn write(&self, path: &str, bytes: &[u8]) {
        let target = self.root.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
    }

    fn shared_blob(&self, path: &str) -> Option<String> {
        materialize::layout(&lock(&self.active.live).doc().nodes().unwrap())
            .into_values()
            .find(|placed| placed.path == path && placed.kind == NodeKind::Blob)
            .and_then(|placed| placed.blob)
    }

    fn online(&self) {
        *guard(&self.active.last_status) = LiveStatus::Online;
    }

    fn arrived(&self, folder: &str, name: &str, bytes: &[u8]) {
        self.arrived_all(folder, &[(name, bytes)]);
    }

    fn arrived_all(&self, folder: &str, figures: &[(&str, &[u8])]) {
        let mut live = lock(&self.active.live);
        let mut peer = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
        let since = live.doc().version();
        let parent = peer
            .add_node(None, folder, NodeKind::Dir, None, "")
            .unwrap();
        for (name, bytes) in figures {
            peer.add_node(
                Some(&parent),
                name,
                NodeKind::Blob,
                Some(&sha256_hex(bytes)),
                "",
            )
            .unwrap();
        }
        let payload = peer.export_since(&since).unwrap();
        assert!(live.import_update(1, &payload).unwrap());
    }

    async fn pass(&self) {
        lock(&self.active.live).mark_all_dirty().unwrap();
        self.active.write_out().await.unwrap();
    }

    fn figure(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.root.join(path)).ok()
    }

    fn replaced(&self, path: &str, old: &[u8], new: &[u8]) {
        let mut live = lock(&self.active.live);
        let mut peer = ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap();
        let since = live.doc().version();
        let id = materialize::layout(&peer.nodes().unwrap())
            .into_iter()
            .find(|(_, placed)| placed.path == path)
            .map(|(id, _)| id)
            .expect("the replaced figure is shared");
        peer.replace_blob(&id, &sha256_hex(old), &sha256_hex(new))
            .unwrap();
        let payload = peer.export_since(&since).unwrap();
        assert!(live.import_update(2, &payload).unwrap());
    }

    fn go_live(&self) -> LiveHere {
        let turn = super::super::write::rig::live_turn();
        *guard(&super::super::ACTIVE) = Some(Arc::clone(&self.active));
        LiveHere { _turn: turn }
    }

    fn type_in(&self, path: &str, text: &str) {
        let mut live = lock(&self.active.live);
        let id = materialize::layout(&live.doc().nodes().unwrap())
            .into_iter()
            .find(|(_, placed)| placed.path == path)
            .map(|(id, _)| id)
            .unwrap();
        live.local_text(&id, text).unwrap();
    }

    async fn flush(&self) {
        let (done, flushed) = tokio::sync::oneshot::channel();
        let _ = self.active.writer.send(WriterSignal::Flush(done));
        let _ = flushed.await;
    }
}

impl Drop for Side {
    fn drop(&mut self) {
        self.active.handle.stop();
    }
}

struct LiveHere {
    _turn: std::sync::MutexGuard<'static, ()>,
}

impl Drop for LiveHere {
    fn drop(&mut self) {
        *guard(&super::super::ACTIVE) = None;
    }
}

struct Seat<'a> {
    url: &'a str,
    server_id: ServerId,
    project: SharedProjectId,
    key: Arc<DeviceKey>,
    tokens: &'a SessionTokens,
}

async fn side(seat: Seat<'_>, live: LiveProject, files: &[(&str, &str)], pumped: bool) -> Side {
    let Seat {
        url,
        server_id,
        project,
        key,
        tokens,
    } = seat;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let mut hashes = BTreeMap::new();
    for (path, text) in files {
        tokio::fs::write(root.join(path), text).await.unwrap();
        hashes.insert((*path).to_owned(), sha256_hex(text.as_bytes()));
    }
    let disk = DiskState {
        layout: materialize::layout(&live.doc().nodes().unwrap()),
        hashes,
        owed: Default::default(),
    };
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::default()),
        Arc::clone(&key),
    ));
    sessions.store(server_id, tokens).unwrap();
    let link = LiveLink {
        client: Arc::new(ServerClient::new(ServerUrl::parse(url).unwrap()).unwrap()),
        server_id,
        project,
        device_id: tokens.device_id,
        key,
        sessions,
    };
    let bases = initial_bases(&root, &disk, &live);
    let shared: SharedLive = Arc::new(Mutex::new(live));
    let (events, events_rx) = mpsc::unbounded_channel();
    let (writer, writer_rx) = mpsc::unbounded_channel();
    let handle = spawn_live(link.clone(), Arc::clone(&shared), events);
    let collab = dir.path().join("collab");
    tokio::fs::create_dir_all(&collab).await.unwrap();
    let host = Arc::new(Recording::default());
    let active = Arc::new(Active {
        project_id: "uploads".to_owned(),
        root: root.clone(),
        document_dir: collab.join("document"),
        disk_file: collab.join("materializer-index.json"),
        live: shared,
        handle,
        link,
        disk: Mutex::new(disk),
        host: Arc::clone(&host) as Arc<dyn LiveHost>,
        writer,
        account_id: tokens.account_id,
        quiet_merge: AtomicBool::new(false),
        waiting: AtomicBool::new(false),
        last_status: Mutex::new(LiveStatus::Connecting),
        bases: Mutex::new(bases),
        upkeep: Default::default(),
    });
    attach(&active);
    tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
    if pumped {
        tauri::async_runtime::spawn(pump(
            Arc::downgrade(&active),
            events_rx,
            oleafly_collab::CollabPaths::new(dir.path().join("paths")),
        ));
    }
    Side {
        active,
        host,
        root,
        _dir: dir,
    }
}

fn manifest(max_file_mb: u64, max_project_mb: u64) -> String {
    serde_json::to_string(&CapabilityManifest {
        server_id: ServerId::new_v7(),
        name: "Lab".to_owned(),
        icon_url: None,
        version: "0.1.0".to_owned(),
        protocol: ProtocolRange {
            min: PROTOCOL_VERSION,
            max: PROTOCOL_VERSION,
        },
        needs_setup: false,
        providers: Vec::new(),
        features: Features {
            email: false,
            guests: false,
            link_sharing: false,
            access_logs: false,
            comments: true,
            encryption: EncryptionSupport::None,
        },
        limits: Limits {
            max_project_mb,
            max_file_mb,
            max_members_per_project: 20,
        },
    })
    .unwrap()
}

struct Canned {
    url: String,
    puts: Arc<AtomicUsize>,
    gets: Arc<AtomicUsize>,
    stall: Arc<AtomicBool>,
    full: Arc<AtomicBool>,
    figures: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    stalled: Arc<Mutex<Option<String>>>,
    slow_ms: Arc<AtomicU64>,
    asked: Arc<Mutex<Vec<String>>>,
    project_mb: Arc<AtomicU64>,
    retry_after: Arc<AtomicU64>,
}

impl Canned {
    fn serve(&self, bytes: &[u8]) {
        self.figures
            .lock()
            .unwrap()
            .insert(sha256_hex(bytes), bytes.to_vec());
    }

    // How many times a figure was asked for.
    fn asked(&self, bytes: &[u8]) -> usize {
        let hash = sha256_hex(bytes);
        self.asked
            .lock()
            .unwrap()
            .iter()
            .filter(|line| line.contains(&hash))
            .count()
    }
}

#[derive(Clone)]
struct Counters {
    puts: Arc<AtomicUsize>,
    gets: Arc<AtomicUsize>,
    stall: Arc<AtomicBool>,
    full: Arc<AtomicBool>,
    figures: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    stalled: Arc<Mutex<Option<String>>>,
    slow_ms: Arc<AtomicU64>,
    asked: Arc<Mutex<Vec<String>>>,
    project_mb: Arc<AtomicU64>,
    retry_after: Arc<AtomicU64>,
}

async fn answer(mut stream: TcpStream, counters: Counters, max_file_mb: u64, fail: usize) {
    let mut seen = Vec::new();
    let mut chunk = [0u8; 65_536];
    let head_end = loop {
        let Ok(read) = stream.read(&mut chunk).await else {
            return;
        };
        if read == 0 {
            return;
        }
        seen.extend_from_slice(&chunk[..read]);
        if let Some(at) = seen.windows(4).position(|window| window == b"\r\n\r\n") {
            break at + 4;
        }
    };
    let head = String::from_utf8_lossy(&seen[..head_end]).to_string();
    let length: usize = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().ok())?
        })
        .unwrap_or(0);
    let mut body = seen.len() - head_end;
    while body < length {
        let Ok(read) = stream.read(&mut chunk).await else {
            return;
        };
        if read == 0 {
            break;
        }
        body += read;
    }
    let line = head.lines().next().unwrap_or_default();
    if line.starts_with("GET ") && line.contains("/blobs/") {
        counters.gets.fetch_add(1, Ordering::SeqCst);
        counters.asked.lock().unwrap().push(line.to_owned());
        let stalled = counters
            .stalled
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|hash| line.contains(hash.as_str()));
        if counters.stall.load(Ordering::SeqCst) || stalled {
            std::future::pending::<()>().await;
        }
        tokio::time::sleep(Duration::from_millis(
            counters.slow_ms.load(Ordering::SeqCst),
        ))
        .await;
        let served = counters
            .figures
            .lock()
            .unwrap()
            .iter()
            .find(|(hash, _)| line.contains(hash.as_str()))
            .map(|(_, bytes)| bytes.clone());
        if let Some(bytes) = served {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            );
            let _ = stream.write_all(head.as_bytes()).await;
            let _ = stream.write_all(&bytes).await;
            let _ = stream.shutdown().await;
            return;
        }
    }
    let mut extra = String::new();
    let (status, reply) = if line.starts_with("GET /.well-known/oleafly-server") {
        let project_mb = counters.project_mb.load(Ordering::SeqCst);
        ("200 OK", manifest(max_file_mb, project_mb))
    } else if line.starts_with("PUT ") && line.contains("/blobs/") {
        let count = counters.puts.fetch_add(1, Ordering::SeqCst) + 1;
        if counters.full.load(Ordering::SeqCst) {
            (
                "413 Payload Too Large",
                "{\"code\":\"project_too_large\",\"message\":\"full\"}".to_owned(),
            )
        } else if count <= fail {
            let wait = counters.retry_after.load(Ordering::SeqCst);
            if wait > 0 {
                extra = format!("Retry-After: {wait}\r\n");
            }
            (
                "503 Service Unavailable",
                "{\"code\":\"unavailable\",\"message\":\"busy\"}".to_owned(),
            )
        } else if length > 1024 * 1024 {
            (
                "400 Bad Request",
                "{\"code\":\"bad_request\",\"message\":\"This file is larger than the server allows (1 MB).\"}"
                    .to_owned(),
            )
        } else {
            ("204 No Content", String::new())
        }
    } else {
        (
            "404 Not Found",
            "{\"code\":\"not_found\",\"message\":\"no\"}".to_owned(),
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{reply}",
        reply.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn canned(fail: usize, max_file_mb: u64) -> Canned {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let counters = Counters {
        puts: Arc::new(AtomicUsize::new(0)),
        gets: Arc::new(AtomicUsize::new(0)),
        stall: Arc::new(AtomicBool::new(false)),
        full: Arc::new(AtomicBool::new(false)),
        figures: Arc::default(),
        stalled: Arc::default(),
        slow_ms: Arc::new(AtomicU64::new(0)),
        asked: Arc::default(),
        project_mb: Arc::new(AtomicU64::new(200)),
        retry_after: Arc::new(AtomicU64::new(0)),
    };
    let counted = counters.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(answer(stream, counted.clone(), max_file_mb, fail));
        }
    });
    Canned {
        url: format!("http://127.0.0.1:{port}"),
        puts: counters.puts,
        gets: counters.gets,
        stall: counters.stall,
        full: counters.full,
        figures: counters.figures,
        stalled: counters.stalled,
        slow_ms: counters.slow_ms,
        asked: counters.asked,
        project_mb: counters.project_mb,
        retry_after: counters.retry_after,
    }
}

fn offline_tokens() -> SessionTokens {
    SessionTokens {
        account_id: AccountId::new_v7(),
        device_id: DeviceId::new_v7(),
        access_token: "access".to_owned(),
        access_expires_at: i64::MAX / 2,
        refresh_token: "refresh".to_owned(),
    }
}

async fn canned_side(server: &Canned) -> Side {
    let mut doc = ProjectDoc::create().unwrap();
    doc.add_node(None, "main.tex", NodeKind::Text, None, "x")
        .unwrap();
    let key = Arc::new(DeviceKey::load_or_create(&MemorySecrets::default()).unwrap());
    side(
        Seat {
            url: &server.url,
            server_id: ServerId::new_v7(),
            project: SharedProjectId::new_v7(),
            key,
            tokens: &offline_tokens(),
        },
        LiveProject::new(doc, 0, ProjectRole::Owner),
        &[("main.tex", "x")],
        false,
    )
    .await
}

#[test]
fn a_figure_whose_upload_fails_stays_waiting_and_is_retried_until_it_is_shared() {
    run(async {
        let server = canned(1, 50).await;
        let alice = canned_side(&server).await;
        alice.online();
        let figure = [0x89, b'P', b'N', b'G', 7, 7];
        alice.write("figures/plot.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/plot.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(alice.shared_blob("figures/plot.png"), None);
        let waiting = alice
            .host
            .last_uploads()
            .expect("the waiting figure is shown");
        assert_eq!(
            waiting,
            vec![UploadFile {
                path: "figures/plot.png".to_owned(),
                state: UploadState::Waiting,
                size: figure.len() as u64,
                limit: None,
            }]
        );
        until("the retried upload", || {
            alice.shared_blob("figures/plot.png").is_some()
        })
        .await;
        assert_eq!(
            alice.shared_blob("figures/plot.png"),
            Some(sha256_hex(&figure))
        );
        until("the cleared upload list", || {
            alice.host.last_uploads() == Some(Vec::new())
        })
        .await;
        assert_eq!(server.puts.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn a_figure_the_server_asked_to_wait_for_is_sent_again_no_sooner_than_asked() {
    run(async {
        let server = canned(1, 50).await;
        server.retry_after.store(4, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.online();
        let figure = [0x89, b'P', b'N', b'G', 4, 4];
        alice.write("figures/plot.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/plot.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(server.puts.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_millis(3000)).await;
        assert_eq!(
            server.puts.load(Ordering::SeqCst),
            1,
            "the figure went again before the server's Retry-After"
        );
        until("the upload after the asked wait", || {
            alice.shared_blob("figures/plot.png").is_some()
        })
        .await;
        assert_eq!(server.puts.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn upload_progress_reaches_the_window_a_few_times_a_second_and_at_the_end() {
    let host = Arc::new(Recording::default());
    let progress = progress_for(Arc::clone(&host) as Arc<dyn LiveHost>, "p", "figs/a.png");
    for done in 1..=100 {
        progress(done, 100);
    }
    let told: Vec<(u64, u64)> = host
        .progress
        .lock()
        .unwrap()
        .iter()
        .map(|payload| (payload.done, payload.total))
        .collect();
    assert_eq!(told, vec![(1, 100), (100, 100)]);
    std::thread::sleep(Duration::from_millis(300));
    progress(101, 200);
    assert_eq!(host.progress.lock().unwrap().len(), 3);
}

#[test]
fn a_figure_upload_tells_the_window_how_far_it_got() {
    run(async {
        let server = canned(0, 50).await;
        let alice = canned_side(&server).await;
        alice.online();
        let mut figure = vec![0u8; 300 * 1024];
        figure[..4].copy_from_slice(&[0x89, b'P', b'N', b'G']);
        alice.write("figures/big.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/big.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(server.puts.load(Ordering::SeqCst), 1);
        let told = alice.host.progress.lock().unwrap().clone();
        let size = figure.len() as u64;
        assert_eq!(
            told.last(),
            Some(&UploadProgress {
                project_id: "uploads".to_owned(),
                path: "figures/big.png".to_owned(),
                done: size,
                total: size,
            })
        );
        assert!(told.iter().all(|payload| payload.done <= payload.total));
    });
}

#[test]
fn a_figure_refused_because_the_project_is_full_waits_with_the_project_limit() {
    run(async {
        let server = canned(0, 50).await;
        server.full.store(true, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.online();
        let figure = [0x89, b'P', b'N', b'G', 9, 9];
        alice.write("figures/plot.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/plot.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(alice.shared_blob("figures/plot.png"), None);
        assert_eq!(
            alice.host.last_uploads(),
            Some(vec![UploadFile {
                path: "figures/plot.png".to_owned(),
                state: UploadState::ProjectTooLarge,
                size: figure.len() as u64,
                limit: Some(200 * 1024 * 1024),
            }])
        );
        assert_eq!(
            serde_json::to_value(UploadState::ProjectTooLarge).unwrap(),
            serde_json::json!("project_too_large")
        );
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert_eq!(
            server.puts.load(Ordering::SeqCst),
            1,
            "a full project is not tried again on a timer"
        );
        server.full.store(false, Ordering::SeqCst);
        alice.active.retry_uploads(Retry::Asked).await;
        until("the upload once the project has room", || {
            alice.shared_blob("figures/plot.png").is_some()
        })
        .await;
        assert_eq!(server.puts.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn a_reconnect_sends_a_figure_refused_for_a_full_project_again_only_once_the_limit_changed() {
    run(async {
        let server = canned(0, 50).await;
        server.full.store(true, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.online();
        let figure = [0x89, b'P', b'N', b'G', 8, 8];
        alice.write("figures/plot.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/plot.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(server.puts.load(Ordering::SeqCst), 1);
        for _ in 0..3 {
            alice.active.retry_uploads(Retry::Reconnect).await;
        }
        assert_eq!(
            server.puts.load(Ordering::SeqCst),
            1,
            "a reconnect sent the figure again although the limit stayed the same"
        );
        assert_eq!(
            alice.active.upload_list()[0].state,
            UploadState::ProjectTooLarge
        );
        server.project_mb.store(400, Ordering::SeqCst);
        server.full.store(false, Ordering::SeqCst);
        alice.active.retry_uploads(Retry::Reconnect).await;
        until("the upload once the server allows more", || {
            alice.shared_blob("figures/plot.png").is_some()
        })
        .await;
        assert_eq!(server.puts.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn a_figure_larger_than_the_server_allows_is_named_with_the_limit_and_never_retried() {
    run(async {
        let server = canned(0, 1).await;
        let alice = canned_side(&server).await;
        alice.online();
        alice.write("figures/big.png", &vec![0u8; 2 * 1024 * 1024]);
        alice
            .active
            .import_paths(Some(vec!["figures/big.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(server.puts.load(Ordering::SeqCst), 1);
        alice.write("figures/huge.png", &vec![0u8; 5 * 1024 * 1024]);
        alice
            .active
            .import_paths(Some(vec!["figures/huge.png".to_owned()]))
            .await
            .unwrap();
        let limit = Some(1024 * 1024);
        let expected = vec![
            UploadFile {
                path: "figures/big.png".to_owned(),
                state: UploadState::TooLarge,
                size: 2 * 1024 * 1024,
                limit,
            },
            UploadFile {
                path: "figures/huge.png".to_owned(),
                state: UploadState::TooLarge,
                size: 5 * 1024 * 1024,
                limit,
            },
        ];
        assert_eq!(alice.host.last_uploads(), Some(expected.clone()));
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert_eq!(server.puts.load(Ordering::SeqCst), 1);
        assert_eq!(alice.active.upload_list(), expected);
        assert_eq!(alice.shared_blob("figures/huge.png"), None);
        alice.active.dismiss_upload("figures/huge.png");
        assert_eq!(alice.host.last_uploads(), Some(expected[..1].to_vec()));
    });
}

struct Relay {
    url: String,
    up: Arc<AtomicBool>,
    open: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Relay {
    async fn start(upstream: std::net::SocketAddr) -> Relay {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let up = Arc::new(AtomicBool::new(true));
        let open: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::default();
        let (gate, tasks) = (Arc::clone(&up), Arc::clone(&open));
        tokio::spawn(async move {
            while let Ok((mut inbound, _)) = listener.accept().await {
                if !gate.load(Ordering::SeqCst) {
                    continue;
                }
                let task = tokio::spawn(async move {
                    if let Ok(mut outbound) = TcpStream::connect(upstream).await {
                        let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
                    }
                });
                tasks.lock().unwrap().push(task);
            }
        });
        Relay {
            url: format!("http://127.0.0.1:{port}"),
            up,
            open,
        }
    }

    fn down(&self) {
        self.up.store(false, Ordering::SeqCst);
        for task in self.open.lock().unwrap().drain(..) {
            task.abort();
        }
    }

    fn up(&self) {
        self.up.store(true, Ordering::SeqCst);
    }
}

async fn person(
    server: &TestServer,
    name: &str,
    role: ServerRole,
) -> (Arc<DeviceKey>, SessionTokens) {
    let key = Arc::new(DeviceKey::load_or_create(&MemorySecrets::default()).unwrap());
    let tokens = seed_person(
        server.state(),
        PersonSeed {
            name: name.to_owned(),
            email: format!("{}@uni.edu", name.to_lowercase()),
            role,
            device_public_key: key.public_key_b64(),
            device_name: format!("{name}'s laptop"),
        },
    )
    .await
    .unwrap();
    (key, tokens)
}

#[test]
fn a_figure_added_while_the_link_is_down_reaches_the_other_person_after_reconnecting() {
    run(async {
        let server = TestServer::start(test_config()).await;
        let server_id = server.state().server_id;
        let (alice_key, alice_tokens) = person(&server, "Alice", ServerRole::Admin).await;
        let (bob_key, bob_tokens) = person(&server, "Bob", ServerRole::Member).await;
        let client = ServerClient::new(ServerUrl::parse(&server.url()).unwrap()).unwrap();
        let access = &alice_tokens.access_token;
        let mut doc = ProjectDoc::create().unwrap();
        doc.add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let project = client
            .create_project(access, "Thesis")
            .await
            .unwrap()
            .project_id;
        client
            .put_snapshot(access, project, 0, doc.snapshot().unwrap())
            .await
            .unwrap();
        client.commit_project(access, project).await.unwrap();
        client
            .grant_member(access, project, bob_tokens.account_id, ProjectRole::Editor)
            .await
            .unwrap();
        let (seq, snapshot) = client.get_snapshot(access, project).await.unwrap();
        let joined = |role| LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), seq, role);
        let upstream: std::net::SocketAddr =
            server.url().trim_start_matches("http://").parse().unwrap();
        let relay = Relay::start(upstream).await;
        let alice = side(
            Seat {
                url: &relay.url,
                server_id,
                project,
                key: alice_key,
                tokens: &alice_tokens,
            },
            joined(ProjectRole::Owner),
            &[("main.tex", "abc")],
            true,
        )
        .await;
        let bob = side(
            Seat {
                url: &server.url(),
                server_id,
                project,
                key: bob_key,
                tokens: &bob_tokens,
            },
            joined(ProjectRole::Editor),
            &[("main.tex", "abc")],
            true,
        )
        .await;
        until("both online", || {
            alice.host.status() == Some(LiveStatus::Online)
                && bob.host.status() == Some(LiveStatus::Online)
        })
        .await;
        relay.down();
        until("alice offline", || {
            matches!(alice.host.status(), Some(LiveStatus::Offline { .. }))
        })
        .await;
        let figure = [0x89, b'P', b'N', b'G', 1, 2, 3];
        alice.write("figures/offline.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/offline.png".to_owned()]))
            .await
            .unwrap();
        assert_eq!(alice.host.last_uploads().map(|files| files.len()), Some(1));
        relay.up();
        until("the figure on bob's disk", || {
            std::fs::read(bob.root.join("figures/offline.png"))
                .ok()
                .as_deref()
                == Some(&figure[..])
        })
        .await;
        assert_eq!(alice.host.last_uploads(), Some(Vec::new()));
    });
}

#[test]
fn a_figure_whose_download_failed_arrives_later_and_after_a_restart_without_another_edit() {
    run(async {
        let server = TestServer::start(test_config()).await;
        let server_id = server.state().server_id;
        let (alice_key, alice_tokens) = person(&server, "Alice", ServerRole::Admin).await;
        let (bob_key, bob_tokens) = person(&server, "Bob", ServerRole::Member).await;
        let client = ServerClient::new(ServerUrl::parse(&server.url()).unwrap()).unwrap();
        let access = &alice_tokens.access_token;
        let mut doc = ProjectDoc::create().unwrap();
        doc.add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let project = client
            .create_project(access, "Thesis")
            .await
            .unwrap()
            .project_id;
        client
            .put_snapshot(access, project, 0, doc.snapshot().unwrap())
            .await
            .unwrap();
        client.commit_project(access, project).await.unwrap();
        client
            .grant_member(access, project, bob_tokens.account_id, ProjectRole::Editor)
            .await
            .unwrap();
        let (seq, snapshot) = client.get_snapshot(access, project).await.unwrap();
        let joined = |role| LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), seq, role);
        let relay = crate::collab::testing::Relay::start(
            server.url().trim_start_matches("http://").to_owned(),
        )
        .await;
        let alice = side(
            Seat {
                url: &server.url(),
                server_id,
                project,
                key: alice_key,
                tokens: &alice_tokens,
            },
            joined(ProjectRole::Owner),
            &[("main.tex", "abc")],
            true,
        )
        .await;
        let bob_seat = || Seat {
            url: &relay.url,
            server_id,
            project,
            key: Arc::clone(&bob_key),
            tokens: &bob_tokens,
        };
        let bob = side(
            bob_seat(),
            joined(ProjectRole::Editor),
            &[("main.tex", "abc")],
            true,
        )
        .await;
        until("both online", || {
            alice.host.status() == Some(LiveStatus::Online)
                && bob.host.status() == Some(LiveStatus::Online)
        })
        .await;
        relay.refuse(Some("/blobs/"));
        let figure = [0x89, b'P', b'N', b'G', 4, 5, 6];
        alice.write("figures/late.png", &figure);
        alice
            .active
            .import_paths(Some(vec!["figures/late.png".to_owned()]))
            .await
            .unwrap();
        until("bob's download refused", || relay.refusals() > 0).await;
        assert!(!bob.root.join("figures/late.png").exists());
        relay.refuse(None);
        until("the figure on bob's disk", || {
            std::fs::read(bob.root.join("figures/late.png"))
                .ok()
                .as_deref()
                == Some(&figure[..])
        })
        .await;
        let seen = lock(&bob.active.live).doc().snapshot().unwrap();
        drop(bob);
        let again = side(
            bob_seat(),
            LiveProject::new(ProjectDoc::load(&seen).unwrap(), 0, ProjectRole::Editor),
            &[("main.tex", "abc")],
            false,
        )
        .await;
        assert!(!again.root.join("figures/late.png").exists());
        lock(&again.active.live).mark_all_dirty().unwrap();
        again.active.write_out().await.unwrap();
        until("the figure after the restart", || {
            std::fs::read(again.root.join("figures/late.png"))
                .ok()
                .as_deref()
                == Some(&figure[..])
        })
        .await;
    });
}

#[test]
fn a_figure_the_server_cannot_send_is_asked_for_again_only_after_a_growing_wait() {
    run(async {
        let server = canned(0, 50).await;
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", b"plot");
        for _ in 0..8 {
            lock(&alice.active.live).mark_all_dirty().unwrap();
            alice.active.write_out().await.unwrap();
        }
        until("the first request", || {
            server.gets.load(Ordering::SeqCst) >= 1
        })
        .await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(server.gets.load(Ordering::SeqCst), 1);
        until("the request after the wait", || {
            server.gets.load(Ordering::SeqCst) >= 2
        })
        .await;
        assert!(!alice.root.join("figures/plot.png").exists());
    });
}

#[test]
fn a_stalled_figure_download_holds_back_neither_the_other_figures_nor_the_session_stop() {
    run(async {
        let server = canned(0, 50).await;
        let (slow, quick) = (b"slow figure".as_slice(), b"quick figure".as_slice());
        server.serve(slow);
        server.serve(quick);
        *server.stalled.lock().unwrap() = Some(sha256_hex(slow));
        let alice = canned_side(&server).await;
        alice.arrived_all("figures", &[("a.png", slow), ("b.png", quick)]);
        alice.pass().await;
        until("the quick figure beside the stalled one", || {
            alice.figure("figures/b.png").as_deref() == Some(quick)
        })
        .await;
        assert_eq!(alice.figure("figures/a.png"), None);
        alice.active.close_figures();
        until("the stalled download stopped with the session", || {
            !alice.active.figures_running()
        })
        .await;
    });
}

#[test]
fn a_figure_that_downloaded_but_could_not_be_written_is_written_later_without_downloading_again() {
    run(async {
        let server = canned(0, 50).await;
        let figure = b"figure".as_slice();
        server.serve(figure);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", figure);
        alice.write("figures", b"a file where the folder goes");
        alice.pass().await;
        until("the download", || server.gets.load(Ordering::SeqCst) >= 1).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(alice.figure("figures/plot.png"), None);
        std::fs::remove_file(alice.root.join("figures")).unwrap();
        until("the figure written on a later try", || {
            alice.figure("figures/plot.png").as_deref() == Some(figure)
        })
        .await;
        assert_eq!(server.gets.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn a_figure_replaced_while_it_downloads_is_fetched_once_in_its_new_version() {
    run(async {
        let server = canned(0, 50).await;
        let (old, new) = (b"old plot".as_slice(), b"new plot".as_slice());
        server.serve(old);
        server.serve(new);
        *server.stalled.lock().unwrap() = Some(sha256_hex(old));
        server.slow_ms.store(500, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", old);
        alice.pass().await;
        until("the download of the old version", || server.asked(old) == 1).await;
        alice.replaced("figures/plot.png", old, new);
        alice.pass().await;
        until("the new version on disk", || {
            alice.figure("figures/plot.png").as_deref() == Some(new)
        })
        .await;
        tokio::time::sleep(Duration::from_millis(800)).await;
        assert_eq!(
            server.asked(new),
            1,
            "the stopped download of the old version let the new one start twice"
        );
        until("the worker to finish", || !alice.active.figures_running()).await;
    });
}

#[test]
fn a_figure_waiting_to_be_written_holds_up_neither_closing_nor_a_bounded_wait() {
    run(async {
        let server = canned(0, 50).await;
        let figure = b"waits for the disk".as_slice();
        server.serve(figure);
        server.slow_ms.store(300, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", figure);
        alice.pass().await;
        // Holding the index stands in for a write that Windows holds up.
        let writing = guard(&alice.active.disk);
        let deadline = std::time::Instant::now() + WAIT;
        while server.gets.load(Ordering::SeqCst) < 1 {
            assert!(
                std::time::Instant::now() < deadline,
                "the download never started"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(700));
        let on_its_own = |work: Box<dyn FnOnce(&Active) + Send>| {
            let active = Arc::clone(&alice.active);
            let (done, finished) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                work(&active);
                let _ = done.send(());
            });
            finished
        };
        let waited = on_its_own(Box::new(|active| {
            tauri::async_runtime::block_on(active.wait_for_figures(Duration::from_millis(300)));
        }));
        assert!(
            waited.recv_timeout(Duration::from_secs(2)).is_ok(),
            "the flush wait outlasted its limit while the figure waited to be written"
        );
        let closed = on_its_own(Box::new(Active::close_figures));
        assert!(
            closed.recv_timeout(Duration::from_secs(2)).is_ok(),
            "closing waited for the figure write"
        );
        drop(writing);
        until("the worker to stop", || !alice.active.figures_running()).await;
        assert_eq!(alice.figure("figures/plot.png"), None);
    });
}

#[test]
fn only_the_compile_barrier_waits_for_a_figure_still_downloading() {
    run(async {
        let server = canned(0, 50).await;
        server.stall.store(true, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", b"plot");
        alice.pass().await;
        until("the stalled request", || {
            server.gets.load(Ordering::SeqCst) >= 1
        })
        .await;
        let _live = alice.go_live();
        let started = std::time::Instant::now();
        super::super::lifecycle::flush("uploads", false).await;
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "a flush that is not for a compile waited for the figure"
        );
        let started = std::time::Instant::now();
        super::super::lifecycle::flush("uploads", true).await;
        assert!(started.elapsed() >= Duration::from_secs(4));
    });
}

#[test]
fn a_flush_waits_a_little_for_a_figure_that_is_downloading() {
    run(async {
        let server = canned(0, 50).await;
        let figure = b"slow to arrive".as_slice();
        server.serve(figure);
        server.slow_ms.store(400, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", figure);
        alice.pass().await;
        alice.active.wait_for_figures(Duration::from_secs(5)).await;
        assert_eq!(alice.figure("figures/plot.png").as_deref(), Some(figure));
    });
}

#[test]
fn a_flush_waits_no_longer_than_its_limit_for_a_stalled_figure() {
    run(async {
        let server = canned(0, 50).await;
        server.stall.store(true, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "late.png", b"never arrives");
        alice.pass().await;
        let started = std::time::Instant::now();
        alice
            .active
            .wait_for_figures(Duration::from_millis(300))
            .await;
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(alice.figure("figures/late.png"), None);
    });
}

#[test]
fn a_stalled_figure_download_holds_back_neither_typing_nor_a_flush() {
    run(async {
        let server = canned(0, 50).await;
        server.stall.store(true, Ordering::SeqCst);
        let alice = canned_side(&server).await;
        alice.arrived("figures", "plot.png", b"plot");
        alice.active.kick();
        until("the stalled request", || {
            server.gets.load(Ordering::SeqCst) >= 1
        })
        .await;
        alice.type_in("main.tex", "typed meanwhile");
        let flushed = tokio::time::timeout(Duration::from_secs(5), alice.flush()).await;
        assert!(flushed.is_ok(), "the flush waited for the stalled download");
        assert_eq!(
            std::fs::read_to_string(alice.root.join("main.tex")).unwrap(),
            "typed meanwhile"
        );
        assert!(!alice.root.join("figures/plot.png").exists());
    });
}
