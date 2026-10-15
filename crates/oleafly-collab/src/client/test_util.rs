use std::sync::Arc;
use std::time::Duration;

use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, EncryptionSupport, Features, Limits, ProtocolRange, ProviderInfo,
    ProviderKind,
};
use oleafly_collab_protocol::ids::ServerId;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::{Clock, ManualClock};
use oleafly_server::config::ProviderConfig;
use oleafly_server::test_support::{
    seed_member, test_config, MockGithub, MockGithubUser, SeededMember, TestApp, TestServer,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{sign_in, ServerUrl, SignInRequest};
use crate::{CollabError, DeviceKey, MemorySecrets};

pub(crate) const LONG: Duration = Duration::from_secs(20);

pub(crate) struct SignedIn {
    pub(crate) _github: MockGithub,
    pub(crate) _server: TestServer,
    pub(crate) url: ServerUrl,
    pub(crate) key: Arc<DeviceKey>,
    pub(crate) manifest: CapabilityManifest,
    pub(crate) tokens: SessionTokens,
}

pub(crate) fn server_url(server: &TestServer) -> ServerUrl {
    ServerUrl::parse(&server.url()).expect("test server address")
}

pub(crate) async fn seed(server: &TestServer, role: ServerRole) -> SeededMember {
    let state = server.state().clone();
    let app = TestApp {
        router: oleafly_server::build_router(state.clone()),
        clock: ManualClock::new(Clock::now_ms(state.clock.as_ref())),
        state,
    };
    seed_member(&app, role).await
}

pub(crate) fn http_response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
    let mut response = format!("HTTP/1.1 {status}\r\n");
    for (name, value) in headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    response.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ));
    response
}

pub(crate) async fn canned(response: String) -> ServerUrl {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let response = response.clone();
            tokio::spawn(async move {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer).await;
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("canned address")
}

pub(crate) type Heard = Arc<std::sync::Mutex<Vec<String>>>;

// A server that answers each path with its own list of responses, one per
// request and the last one again after that, and keeps every request it got.
pub(crate) async fn routed(
    routes: impl FnOnce(&ServerUrl) -> Vec<(&'static str, Vec<String>)>,
) -> (ServerUrl, Heard) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    let url = ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("routed address");
    let routes: Vec<(&'static str, Vec<String>)> = routes(&url);
    let answers = Arc::new(std::sync::Mutex::new(
        routes
            .into_iter()
            .map(|(path, replies)| (path, replies.into_iter().collect()))
            .collect::<Vec<(&'static str, std::collections::VecDeque<String>)>>(),
    ));
    let heard: Heard = Arc::default();
    let kept = Arc::clone(&heard);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let answers = Arc::clone(&answers);
            let kept = Arc::clone(&kept);
            tokio::spawn(async move {
                let Some(request) = read_whole_request(&mut stream).await else {
                    return;
                };
                let path = request
                    .split_whitespace()
                    .nth(1)
                    .and_then(|target| target.split('?').next())
                    .unwrap_or_default()
                    .to_owned();
                kept.lock().expect("heard").push(request);
                let answer = {
                    let mut answers = answers.lock().expect("answers");
                    match answers.iter_mut().find(|(route, _)| *route == path) {
                        Some((_, replies)) if replies.len() > 1 => replies.pop_front(),
                        Some((_, replies)) => replies.front().cloned(),
                        None => None,
                    }
                };
                let answer = answer.unwrap_or_else(|| http_response("404 Not Found", &[], ""));
                let _ = stream.write_all(answer.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    (url, heard)
}

async fn read_whole_request(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut request = Vec::new();
    let mut buffer = [0u8; 8192];
    let end = loop {
        if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break end + 4;
        }
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return None,
            Ok(read) => request.extend_from_slice(&buffer[..read]),
        }
    };
    let head = String::from_utf8_lossy(&request[..end]).to_string();
    let length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        })
        .unwrap_or(0);
    while request.len() < end + length {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => request.extend_from_slice(&buffer[..read]),
        }
    }
    Some(String::from_utf8_lossy(&request).to_string())
}

pub(crate) struct UpgradeFront {
    pub(crate) url: ServerUrl,
    pub(crate) upgrades: Heard,
}

impl UpgradeFront {
    // Passes everything on to `upstream` and keeps the head of every
    // WebSocket upgrade, answering those with `refusal` when one is given.
    pub(crate) async fn start(upstream: &ServerUrl, refusal: Option<String>) -> UpgradeFront {
        let target = upstream.endpoint("/");
        let upstream = format!(
            "{}:{}",
            target.host_str().expect("host"),
            target.port_or_known_default().expect("port")
        );
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let port = listener.local_addr().expect("address").port();
        let upgrades: Heard = Arc::default();
        let kept = Arc::clone(&upgrades);
        tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let (upstream, refusal, kept) =
                    (upstream.clone(), refusal.clone(), Arc::clone(&kept));
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buffer = [0u8; 8192];
                    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
                        match client.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => head.extend_from_slice(&buffer[..read]),
                        }
                    }
                    let text = String::from_utf8_lossy(&head).to_string();
                    if text.to_ascii_lowercase().contains("upgrade: websocket") {
                        kept.lock().expect("upgrades").push(text);
                        if let Some(refusal) = refusal {
                            let _ = client.write_all(refusal.as_bytes()).await;
                            let _ = client.shutdown().await;
                            return;
                        }
                    }
                    let Ok(mut server) = tokio::net::TcpStream::connect(&upstream).await else {
                        return;
                    };
                    if server.write_all(&head).await.is_ok() {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                    }
                });
            }
        });
        UpgradeFront {
            url: ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("front address"),
            upgrades,
        }
    }

    pub(crate) fn upgrades(&self) -> Vec<String> {
        self.upgrades.lock().expect("upgrades").clone()
    }
}

pub(crate) fn refusal_with(status: &str, code: &str) -> String {
    http_response(
        status,
        &[("Content-Type", "application/json")],
        &format!("{{\"code\":\"{code}\",\"message\":\"Sign in to this server again.\"}}"),
    )
}

pub(crate) async fn closed_url() -> ServerUrl {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    drop(listener);
    ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("closed address")
}

pub(crate) fn github_user(id: u64, login: &str) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_string(),
        name: login.to_string(),
        emails: vec![(format!("{login}@uni.edu"), true)],
    }
}

pub(crate) async fn github_server(users: Vec<MockGithubUser>) -> (MockGithub, TestServer) {
    let github = MockGithub::start(users).await;
    let mut config = test_config();
    config.providers.push(ProviderConfig::Github {
        id: "github".to_string(),
        label: "GitHub".to_string(),
        client_id: "oleafly-test".to_string(),
        client_secret: "oleafly-test-secret".to_string(),
        web_url: github.web_url(),
        api_url: github.api_url(),
    });
    let server = TestServer::start(config).await;
    (github, server)
}

pub(crate) fn device_key() -> DeviceKey {
    DeviceKey::load_or_create(&MemorySecrets::default()).expect("device key")
}

// Follows redirects like a browser.
pub(crate) async fn browse(url: &str) -> Option<reqwest::Response> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let mut url = ::url::Url::parse(url).ok()?;
    for _ in 0..20 {
        let response = client.get(url.clone()).send().await.ok()?;
        if !response.status().is_redirection() {
            return Some(response);
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)?
            .to_str()
            .ok()?;
        url = url.join(location).ok()?;
    }
    None
}

pub(crate) fn follow_browser(url: &str) -> Result<(), CollabError> {
    let url = url.to_string();
    tokio::spawn(async move {
        let _ = browse(&url).await;
    });
    Ok(())
}

pub(crate) type Pages = Arc<std::sync::Mutex<Vec<String>>>;

pub(crate) fn recording_browser(
    pages: Pages,
) -> impl Fn(&str) -> Result<(), CollabError> + Send + Sync {
    move |url: &str| {
        let url = url.to_string();
        let pages = Arc::clone(&pages);
        tokio::spawn(async move {
            if let Some(response) = browse(&url).await {
                if let Ok(page) = response.text().await {
                    pages.lock().expect("pages").push(page);
                }
            }
        });
        Ok(())
    }
}

pub(crate) async fn last_page(pages: &Pages) -> String {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(page) = pages.lock().expect("pages").last().cloned() {
            return page;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the browser never got a page"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

pub(crate) async fn bob_and_alice_server() -> (MockGithub, MockGithub, TestServer) {
    let bob_github = MockGithub::start(vec![github_user(1, "bob")]).await;
    let alice_github = MockGithub::start(vec![github_user(2, "alice")]).await;
    let mut config = test_config();
    config
        .providers
        .push(github_provider("github", &bob_github));
    config
        .providers
        .push(github_provider("github2", &alice_github));
    let server = TestServer::start(config).await;
    (bob_github, alice_github, server)
}

pub(crate) async fn allow_alice(server: &TestServer, admin: &SessionTokens) {
    super::ServerClient::new(server_url(server))
        .expect("client")
        .admin_add_allowlist(
            &admin.access_token,
            &oleafly_collab_protocol::admin::NewAllowlistEntry {
                matcher: oleafly_collab_protocol::admin::AllowlistMatcher::ProviderLogin {
                    provider: "github2".to_string(),
                    login: "alice".to_string(),
                },
                role: ServerRole::Member,
            },
        )
        .await
        .expect("allowlist alice");
}

pub(crate) fn sign_in_request(server: &TestServer, setup_code: Option<String>) -> SignInRequest {
    SignInRequest {
        url: server_url(server),
        provider_id: "github".to_string(),
        device_name: "Test Mac".to_string(),
        platform: "macos".to_string(),
        setup_code,
    }
}

pub(crate) fn sample_manifest(protocol: ProtocolRange) -> CapabilityManifest {
    CapabilityManifest {
        server_id: ServerId::new_v7(),
        name: "Smith Lab".to_string(),
        icon_url: None,
        version: "0.1.0".to_string(),
        protocol,
        needs_setup: false,
        providers: vec![ProviderInfo {
            id: "github".to_string(),
            kind: ProviderKind::Github,
            label: "GitHub".to_string(),
        }],
        features: Features {
            email: true,
            guests: false,
            link_sharing: false,
            access_logs: false,
            comments: false,
            encryption: EncryptionSupport::None,
        },
        limits: Limits {
            max_project_mb: 200,
            max_file_mb: 50,
            max_members_per_project: 20,
        },
    }
}

pub(crate) async fn signed_in_admin() -> SignedIn {
    let (github, server) = github_server(vec![github_user(1, "carol")]).await;
    let key = Arc::new(device_key());
    let (manifest, tokens) = sign_in(
        sign_in_request(&server, Some(server.setup_code())),
        &key,
        &follow_browser,
        LONG,
    )
    .await
    .expect("setup sign-in");
    SignedIn {
        _github: github,
        url: server_url(&server),
        _server: server,
        key,
        manifest,
        tokens,
    }
}

pub(crate) struct Person {
    pub(crate) key: Arc<DeviceKey>,
    pub(crate) tokens: SessionTokens,
    pub(crate) sessions: Arc<crate::SessionManager>,
}

pub(crate) struct Pair {
    pub(crate) _providers: (MockGithub, MockGithub),
    pub(crate) _server: TestServer,
    pub(crate) url: ServerUrl,
    pub(crate) server_id: ServerId,
    pub(crate) bob: Person,
    pub(crate) alice: Person,
}

fn github_provider(id: &str, github: &MockGithub) -> ProviderConfig {
    ProviderConfig::Github {
        id: id.to_string(),
        label: "GitHub".to_string(),
        client_id: "oleafly-test".to_string(),
        client_secret: "oleafly-test-secret".to_string(),
        web_url: github.web_url(),
        api_url: github.api_url(),
    }
}

async fn person(
    server: &TestServer,
    provider: &str,
    setup_code: Option<String>,
) -> (Person, ServerId) {
    let key = Arc::new(device_key());
    let mut request = sign_in_request(server, setup_code);
    request.provider_id = provider.to_string();
    let (manifest, tokens) = sign_in(request, &key, &follow_browser, LONG)
        .await
        .expect("sign in");
    let sessions = Arc::new(crate::SessionManager::new(
        Arc::new(MemorySecrets::default()),
        Arc::clone(&key),
    ));
    sessions
        .store(manifest.server_id, &tokens)
        .expect("store session");
    (
        Person {
            key,
            tokens,
            sessions,
        },
        manifest.server_id,
    )
}

pub(crate) async fn another_alice_device(pair: &Pair) -> Person {
    person(&pair._server, "github2", None).await.0
}

pub(crate) async fn two_people() -> Pair {
    let (bob_github, alice_github, server) = bob_and_alice_server().await;
    let (bob, server_id) = person(&server, "github", Some(server.setup_code())).await;
    allow_alice(&server, &bob.tokens).await;
    let (alice, _) = person(&server, "github2", None).await;
    Pair {
        _providers: (bob_github, alice_github),
        url: server_url(&server),
        _server: server,
        server_id,
        bob,
        alice,
    }
}

// A copy that keeps only the history after its current state, and a change
// someone made from an earlier state. The change reads like any other but
// the copy cannot take it in: the shape of a change from a modified client
// or one that hits a Loro bug.
pub(crate) fn trimmed_and_unreadable(doc: &crate::doc::ProjectDoc) -> (Vec<u8>, Vec<u8>) {
    let loro = doc.loro();
    let trimmed = loro
        .export(loro::ExportMode::shallow_snapshot(&loro.oplog_frontiers()))
        .expect("a trimmed copy");
    let first_writer = *loro
        .oplog_vv()
        .iter()
        .next()
        .expect("the document has a history")
        .0;
    let earliest = loro::Frontiers::from_id(loro::ID::new(first_writer, 0));
    let writer = loro.fork_at(&earliest).expect("an early copy");
    writer.set_peer_id(u64::MAX >> 3).expect("a writer id");
    let since = writer.oplog_vv();
    writer
        .get_map("meta")
        .insert("written_early", true)
        .expect("a change");
    writer.commit();
    let update = writer
        .export(loro::ExportMode::updates(&since))
        .expect("the change");
    (trimmed, update)
}

pub(crate) fn noise(length: usize, seed: u64) -> String {
    let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..length)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            char::from(b'a' + (state % 26) as u8)
        })
        .collect()
}

pub(crate) struct PathProxy {
    pub(crate) url: ServerUrl,
    answer: Arc<std::sync::Mutex<Option<&'static str>>>,
    answered: Arc<std::sync::atomic::AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl PathProxy {
    pub(crate) async fn start(upstream: &str, path: &'static str) -> PathProxy {
        let upstream = upstream.trim_start_matches("http://").to_owned();
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let port = listener.local_addr().expect("address").port();
        let answer: Arc<std::sync::Mutex<Option<&'static str>>> = Arc::default();
        let answered: Arc<std::sync::atomic::AtomicUsize> = Arc::default();
        let (shared, count) = (Arc::clone(&answer), Arc::clone(&answered));
        let task = tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                let fixed = *shared
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let count = Arc::clone(&count);
                tokio::spawn(answer_or_forward(
                    client,
                    upstream.clone(),
                    path,
                    fixed,
                    count,
                ));
            }
        });
        PathProxy {
            url: ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("proxy address"),
            answer,
            answered,
            task,
        }
    }

    pub(crate) fn answered(&self) -> usize {
        self.answered.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn answer(&self, status: Option<&'static str>) {
        *self
            .answer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = status;
    }
}

impl Drop for PathProxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn answer_or_forward(
    mut client: tokio::net::TcpStream,
    upstream: String,
    path: &'static str,
    fixed: Option<&'static str>,
    answered: Arc<std::sync::atomic::AtomicUsize>,
) {
    let mut head = Vec::new();
    let mut chunk = [0u8; 8192];
    let end = loop {
        if let Some(end) = head.windows(4).position(|window| window == b"\r\n\r\n") {
            break end;
        }
        match client.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(read) => head.extend_from_slice(&chunk[..read]),
        }
    };
    let text = String::from_utf8_lossy(&head[..end]).to_string();
    let target = text.split_whitespace().nth(1).unwrap_or_default();
    if let Some(status) = fixed.filter(|_| target.contains(path)) {
        answered.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _ = client
            .write_all(http_response(status, &[], "").as_bytes())
            .await;
        let _ = client.shutdown().await;
        return;
    }
    let Ok(mut server) = tokio::net::TcpStream::connect(&upstream).await else {
        return;
    };
    let upgrade = text.to_ascii_lowercase().contains("upgrade: websocket");
    let mut request = head[..end].to_vec();
    if !upgrade {
        request.extend_from_slice(b"\r\nConnection: close");
    }
    request.extend_from_slice(&head[end..]);
    if server.write_all(&request).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
}
