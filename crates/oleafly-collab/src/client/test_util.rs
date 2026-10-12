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

pub(crate) fn follow_browser(url: &str) -> Result<(), CollabError> {
    let url = url.to_string();
    tokio::spawn(async move {
        if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
            let _ = client.get(url).send().await;
        }
    });
    Ok(())
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

pub(crate) async fn two_people() -> Pair {
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
    let (bob, server_id) = person(&server, "github", Some(server.setup_code())).await;
    let client = super::ServerClient::new(server_url(&server)).expect("client");
    client
        .admin_add_allowlist(
            &bob.tokens.access_token,
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
