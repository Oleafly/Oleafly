use crate::collab::guard::{SyncPauseHost, SyncPaused, SyncResumed};
use oleafly_collab::binding::{save_binding, ShareBinding};
use oleafly_collab::paths::CollabPaths;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::roles::ProjectRole;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub(crate) fn data_folder_entries() -> Vec<std::ffi::OsString> {
    let data = std::path::PathBuf::from(std::env::var_os("OLEAFLY_DATA_DIR").unwrap());
    std::fs::read_dir(data)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name())
        .filter(|name| name != "app.log")
        .collect()
}

pub(crate) struct TempLibrary {
    _data: tempfile::TempDir,
    _env: MutexGuard<'static, ()>,
}

impl TempLibrary {
    pub(crate) fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        Self {
            _data: data,
            _env: env,
        }
    }

    pub(crate) fn project(&self, project_id: &str, files: &[(&str, &str)]) -> PathBuf {
        let root = crate::paths::create_project_dir(project_id).unwrap();
        for (relative, text) in files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, text).unwrap();
        }
        root
    }
}

impl Drop for TempLibrary {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

pub(crate) struct SharedProject(String);

impl Drop for SharedProject {
    fn drop(&mut self) {
        crate::collab::registry::invalidate(&self.0);
    }
}

pub(crate) fn share(project_id: &str) -> SharedProject {
    let paths = CollabPaths::new(crate::paths::collab_root().unwrap());
    std::fs::create_dir_all(paths.project_dir(project_id).unwrap()).unwrap();
    let binding = ShareBinding {
        server_url: "https://collab.test".to_owned(),
        server_id: ServerId::new_v7(),
        shared_project_id: SharedProjectId::new_v7(),
        role: ProjectRole::Owner,
        created_at: 0,
    };
    save_binding(&paths, project_id, &binding).unwrap();
    crate::collab::registry::invalidate(project_id);
    SharedProject(project_id.to_owned())
}

#[derive(Default)]
pub(crate) struct RecordedPauses(Mutex<Vec<SyncPaused>>, Mutex<Vec<SyncResumed>>);

impl RecordedPauses {
    pub(crate) fn taken(&self) -> Vec<SyncPaused> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub(crate) fn resumed(&self) -> Vec<SyncResumed> {
        std::mem::take(&mut *self.1.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

impl SyncPauseHost for RecordedPauses {
    fn sync_paused(&self, paused: &SyncPaused) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(paused.clone());
    }

    fn sync_resumed(&self, resumed: &SyncResumed) {
        self.1
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(resumed.clone());
    }
}

pub(crate) struct Browser;

impl crate::collab::commands::CollabHost for Browser {
    fn open_browser(&self, url: &str) -> Result<(), oleafly_collab::CollabError> {
        let url = url.to_owned();
        tokio::spawn(async move {
            if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
                let _ = client.get(url).send().await;
            }
        });
        Ok(())
    }

    fn server_changed(&self, _: ServerId) {}

    fn signed_in(&self) {}

    fn device_name(&self) -> String {
        "Test Mac".to_owned()
    }

    fn platform(&self) -> String {
        "macos".to_owned()
    }
}

pub(crate) struct Lab {
    pub(crate) server: oleafly_server::test_support::TestServer,
    _github: oleafly_server::test_support::MockGithub,
}

impl Lab {
    pub(crate) async fn start() -> Lab {
        Lab::at(None).await
    }

    pub(crate) async fn behind(relay: &Relay) -> Lab {
        let lab = Lab::at(Some(&relay.url)).await;
        relay.point_at(lab.address());
        lab
    }

    async fn at(public_url: Option<&str>) -> Lab {
        use oleafly_server::test_support::{test_config, MockGithub, MockGithubUser, TestServer};
        let github = MockGithub::start(vec![MockGithubUser {
            id: 1,
            login: "alice".to_owned(),
            name: "Alice".to_owned(),
            emails: vec![("alice@uni.edu".to_owned(), true)],
        }])
        .await;
        let mut config = test_config();
        config
            .providers
            .push(oleafly_server::config::ProviderConfig::Github {
                id: "github".to_owned(),
                label: "GitHub".to_owned(),
                client_id: "oleafly-test".to_owned(),
                client_secret: "oleafly-test-secret".to_owned(),
                web_url: github.web_url(),
                api_url: github.api_url(),
            });
        let server = match public_url {
            Some(url) => TestServer::start_at(config, url).await,
            None => TestServer::start(config).await,
        };
        Lab {
            server,
            _github: github,
        }
    }

    pub(crate) fn address(&self) -> String {
        self.server.url().trim_start_matches("http://").to_owned()
    }

    pub(crate) async fn sign_in(
        &self,
        state: &crate::collab::state::CollabState,
        url: &str,
        first: bool,
    ) -> ServerId {
        crate::collab::commands::sign_in_server(
            state,
            &Browser,
            url,
            "github".to_owned(),
            first.then(|| self.server.setup_code()),
            std::time::Duration::from_secs(20),
        )
        .await
        .expect("signed in")
        .server_id
    }
}

pub(crate) struct Relay {
    pub(crate) url: String,
    upstream: std::sync::Arc<Mutex<String>>,
    down: std::sync::Arc<std::sync::atomic::AtomicBool>,
    seen: std::sync::Arc<Mutex<Vec<u8>>>,
    streams: std::sync::Arc<Mutex<Vec<Vec<u8>>>>,
    refused: std::sync::Arc<Mutex<Option<String>>>,
    refusals: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    stalled: std::sync::Arc<Mutex<Option<String>>>,
    stalls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl Relay {
    pub(crate) async fn start(upstream: String) -> Relay {
        let relay = Relay::bind().await;
        relay.point_at(upstream);
        relay
    }

    pub(crate) async fn bind() -> Relay {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let upstream: Arc<Mutex<String>> = Arc::default();
        let target = Arc::clone(&upstream);
        let down = Arc::new(AtomicBool::new(false));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let streams: Arc<Mutex<Vec<Vec<u8>>>> = Arc::default();
        let refused: Arc<Mutex<Option<String>>> = Arc::default();
        let refusals = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stalled: Arc<Mutex<Option<String>>> = Arc::default();
        let stalls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (gate, log) = (Arc::clone(&down), Arc::clone(&seen));
        let (refusing, counted) = (Arc::clone(&refused), Arc::clone(&refusals));
        let (stalling, held) = (Arc::clone(&stalled), Arc::clone(&stalls));
        let opened = Arc::clone(&streams);
        tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                if gate.load(Ordering::SeqCst) {
                    continue;
                }
                let stream = {
                    let mut opened = opened.lock().unwrap_or_else(PoisonError::into_inner);
                    opened.push(Vec::new());
                    opened.len() - 1
                };
                let sent = Arc::clone(&opened);
                let upstream = target
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                let (gate, log) = (Arc::clone(&gate), Arc::clone(&log));
                let (refusing, counted) = (Arc::clone(&refusing), Arc::clone(&counted));
                let (stalling, held) = (Arc::clone(&stalling), Arc::clone(&held));
                tokio::spawn(async move {
                    let Ok(server) = tokio::net::TcpStream::connect(upstream).await else {
                        return;
                    };
                    let (mut client_read, mut client_write) = client.into_split();
                    let (mut server_read, mut server_write) = server.into_split();
                    let upward_gate = Arc::clone(&gate);
                    let upward = async move {
                        let mut buffer = [0u8; 16384];
                        while let Ok(count) = client_read.read(&mut buffer).await {
                            if count == 0 || upward_gate.load(Ordering::SeqCst) {
                                break;
                            }
                            let chunk = String::from_utf8_lossy(&buffer[..count]);
                            let refuse = refusing
                                .lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .as_ref()
                                .is_some_and(|needle| chunk.contains(needle.as_str()));
                            if refuse {
                                counted.fetch_add(1, Ordering::SeqCst);
                                break;
                            }
                            let stall = stalling
                                .lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .as_ref()
                                .is_some_and(|needle| chunk.contains(needle.as_str()));
                            if stall {
                                held.fetch_add(1, Ordering::SeqCst);
                                std::future::pending::<()>().await;
                            }
                            log.lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .extend_from_slice(&buffer[..count]);
                            sent.lock().unwrap_or_else(PoisonError::into_inner)[stream]
                                .extend_from_slice(&buffer[..count]);
                            if server_write.write_all(&buffer[..count]).await.is_err() {
                                break;
                            }
                        }
                        let _ = server_write.shutdown().await;
                    };
                    let downward = async move {
                        let mut buffer = [0u8; 16384];
                        while let Ok(count) = server_read.read(&mut buffer).await {
                            if count == 0 || gate.load(Ordering::SeqCst) {
                                break;
                            }
                            if client_write.write_all(&buffer[..count]).await.is_err() {
                                break;
                            }
                        }
                        let _ = client_write.shutdown().await;
                    };
                    tokio::join!(upward, downward);
                });
            }
        });
        Relay {
            url,
            upstream,
            down,
            seen,
            streams,
            refused,
            refusals,
            stalled,
            stalls,
        }
    }

    pub(crate) fn point_at(&self, upstream: String) {
        *self.upstream.lock().unwrap_or_else(PoisonError::into_inner) = upstream;
    }

    pub(crate) fn refuse(&self, needle: Option<&str>) {
        *self.refused.lock().unwrap_or_else(PoisonError::into_inner) = needle.map(str::to_owned);
    }

    pub(crate) fn refusals(&self) -> usize {
        self.refusals.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn stall(&self, needle: Option<&str>) {
        *self.stalled.lock().unwrap_or_else(PoisonError::into_inner) = needle.map(str::to_owned);
    }

    pub(crate) fn stalls(&self) -> usize {
        self.stalls.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn set_down(&self, down: bool) {
        self.down.store(down, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn requests(&self, start: &str) -> usize {
        String::from_utf8_lossy(&self.seen.lock().unwrap_or_else(PoisonError::into_inner))
            .matches(start)
            .count()
    }

    pub(crate) fn forget_seen(&self) {
        self.seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        for sent in self
            .streams
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter_mut()
        {
            sent.clear();
        }
    }

    pub(crate) fn most_requests_on_one_connection(&self) -> usize {
        self.streams
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .map(|sent| {
                String::from_utf8_lossy(sent)
                    .matches(" HTTP/1.1\r\n")
                    .count()
            })
            .max()
            .unwrap_or(0)
    }
}

pub(crate) fn track(project_id: &str, files: &[&str]) {
    let file = CollabPaths::new(crate::paths::collab_root().unwrap())
        .materializer_index_file(project_id)
        .unwrap();
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let mut disk = crate::collab::disk::DiskState::load(&file);
    for relative in files {
        disk.layout.insert(
            format!("tracked-{relative}"),
            oleafly_collab::materialize::Placed {
                path: (*relative).to_owned(),
                kind: oleafly_collab::doc::NodeKind::Text,
                blob: None,
            },
        );
    }
    disk.save(&file).unwrap();
}
