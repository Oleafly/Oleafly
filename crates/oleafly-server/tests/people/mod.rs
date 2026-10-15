#![allow(dead_code)]

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::admin::AllowlistMatcher;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, SessionTokens};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::crypto::b64url_decode;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{BatchId, SharedProjectId};
use oleafly_collab_protocol::projects::{MemberGrant, NewProject, ProjectRole, ProjectSummary};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::config::ServerConfig;
use oleafly_server::test_support::{
    allowlist, github_provider, seed_person, sign_in, socket_request, test_config, MockGithub,
    MockGithubUser, PersonSeed, TestDevice, TestServer,
};
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct Person {
    pub device: TestDevice,
    pub tokens: SessionTokens,
}

impl Person {
    pub fn token(&self) -> &str {
        &self.tokens.access_token
    }
}

pub struct Stage {
    pub server: TestServer,
    pub bob: Person,
    pub alice: Person,
    _providers: (MockGithub, MockGithub),
}

fn github_user(id: u64, login: &str, name: &str) -> MockGithubUser {
    MockGithubUser {
        id,
        login: login.to_owned(),
        name: name.to_owned(),
        emails: vec![(format!("{login}@uni.edu"), true)],
    }
}

pub async fn stage() -> Stage {
    stage_with(test_config()).await
}

pub async fn stage_with(mut config: ServerConfig) -> Stage {
    let bob_github = MockGithub::start(vec![github_user(8, "bob", "Bob Smith")]).await;
    let alice_github = MockGithub::start(vec![github_user(9, "alice", "Alice Chen")]).await;
    config
        .providers
        .push(github_provider("github", &bob_github));
    config
        .providers
        .push(github_provider("github2", &alice_github));
    let server = TestServer::start(config).await;
    let bob_device = TestDevice::generate();
    let bob_tokens = sign_in(&server, "github", &bob_device, Some(&server.setup_code()))
        .await
        .expect("bob signs in");
    let matcher = AllowlistMatcher::ProviderLogin {
        provider: "github2".to_owned(),
        login: "alice".to_owned(),
    };
    allowlist(
        &server,
        &bob_tokens.access_token,
        matcher,
        ServerRole::Member,
    )
    .await;
    let alice_device = TestDevice::generate();
    let alice_tokens = sign_in(&server, "github2", &alice_device, None)
        .await
        .expect("alice signs in");
    Stage {
        server,
        bob: Person {
            device: bob_device,
            tokens: bob_tokens,
        },
        alice: Person {
            device: alice_device,
            tokens: alice_tokens,
        },
        _providers: (bob_github, alice_github),
    }
}

pub async fn call(
    server: &TestServer,
    method: Method,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .request(method, format!("{}{path}", server.url()))
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    request.send().await.expect("request")
}

pub async fn put_bytes(
    server: &TestServer,
    path: &str,
    token: &str,
    bytes: Vec<u8>,
) -> reqwest::Response {
    reqwest::Client::new()
        .put(format!("{}{path}", server.url()))
        .bearer_auth(token)
        .body(bytes)
        .send()
        .await
        .expect("upload")
}

pub async fn read<T: DeserializeOwned>(response: reqwest::Response) -> T {
    let status = response.status();
    assert!(status.is_success(), "the request answered {status}");
    response.json().await.expect("json body")
}

pub async fn create_project(server: &TestServer, owner: &Person, title: &str) -> ProjectSummary {
    let response = call(
        server,
        Method::POST,
        "/api/v1/projects",
        owner.token(),
        Some(
            serde_json::to_value(NewProject {
                title: title.to_owned(),
            })
            .expect("json"),
        ),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    response.json().await.expect("project summary")
}

pub const SNAPSHOT_PEER: u64 = 7;
pub const SNAPSHOT_TEXT: &str = "first snapshot";

pub fn first_snapshot() -> Vec<u8> {
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(SNAPSHOT_PEER).expect("peer");
    doc.get_text("text")
        .insert(0, SNAPSHOT_TEXT)
        .expect("insert");
    doc.commit();
    doc.export(loro::ExportMode::Snapshot).expect("snapshot")
}

pub fn change(text: &[u8]) -> Vec<u8> {
    let doc = loro::LoroDoc::new();
    doc.get_text("text")
        .insert(0, &String::from_utf8_lossy(text))
        .expect("insert");
    doc.commit();
    doc.export(loro::ExportMode::all_updates()).expect("change")
}

pub fn text_of(snapshot: &[u8]) -> String {
    let doc = loro::LoroDoc::new();
    doc.import(snapshot).expect("a loro document");
    doc.get_text("text").to_string()
}

pub async fn share_project(server: &TestServer, owner: &Person, title: &str) -> ProjectSummary {
    let created = create_project(server, owner, title).await;
    let path = format!("/api/v1/projects/{}/snapshot?seq=0", created.project_id);
    let uploaded = put_bytes(server, &path, owner.token(), first_snapshot()).await;
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let commit = format!("/api/v1/projects/{}/commit", created.project_id);
    read(call(server, Method::POST, &commit, owner.token(), None).await).await
}

pub async fn grant(
    server: &TestServer,
    owner: &Person,
    project: SharedProjectId,
    person: &Person,
    role: ProjectRole,
) -> reqwest::Response {
    let path = format!(
        "/api/v1/projects/{project}/members/{}",
        person.tokens.account_id
    );
    call(
        server,
        Method::PUT,
        &path,
        owner.token(),
        Some(serde_json::to_value(MemberGrant { role }).expect("json")),
    )
    .await
}

pub async fn next_frame(socket: &mut Socket) -> Option<ServerFrame> {
    let waited = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    return Some(serde_json::from_str(text.as_str()).expect("server frame"));
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
        None
    })
    .await;
    waited.expect("a frame arrived in time")
}

pub async fn send_frame(socket: &mut Socket, frame: &ClientFrame) {
    let text = serde_json::to_string(frame).expect("frame json");
    socket.send(Message::text(text)).await.expect("send frame");
}

pub async fn connect(server: &TestServer, person: &Person) -> Socket {
    connect_understanding(server, person, Vec::new()).await
}

pub async fn connect_to(url: &str, person: &Person) -> Socket {
    hello_on(url, person, Vec::new()).await
}

pub async fn connect_understanding(
    server: &TestServer,
    person: &Person,
    understands: Vec<FrameErrorCode>,
) -> Socket {
    hello_on(&server.url(), person, understands).await
}

async fn hello_on(url: &str, person: &Person, understands: Vec<FrameErrorCode>) -> Socket {
    let (mut socket, _) = connect_async(socket_request(url, Some(person.token())))
        .await
        .expect("connect");
    let Some(ServerFrame::Challenge { nonce, server_id }) = next_frame(&mut socket).await else {
        panic!("expected a challenge");
    };
    let hello = ClientFrame::Hello {
        protocol: PROTOCOL_VERSION,
        device_id: person.tokens.device_id,
        access_token: person.tokens.access_token.clone(),
        nonce: nonce.clone(),
        signature: person.device.sign_b64(&challenge_message(
            ChallengePurpose::Socket,
            server_id,
            &nonce,
        )),
        understands,
    };
    send_frame(&mut socket, &hello).await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Welcome { .. })
    ));
    socket
}

pub async fn subscribe(socket: &mut Socket, project: SharedProjectId, since: u64) -> ServerFrame {
    send_frame(
        socket,
        &ClientFrame::Subscribe {
            project_id: project,
            since_seq: since,
        },
    )
    .await;
    next_frame(socket).await.expect("a reply to subscribe")
}

pub fn envelope(person: &Person, project: SharedProjectId, payload: &[u8]) -> Envelope {
    signed_by(person, &person.device, project, &change(payload))
}

pub fn raw_envelope(person: &Person, project: SharedProjectId, payload: &[u8]) -> Envelope {
    signed_by(person, &person.device, project, payload)
}

pub fn signed_by(
    person: &Person,
    signer: &TestDevice,
    project: SharedProjectId,
    payload: &[u8],
) -> Envelope {
    let mut envelope = Envelope {
        v: 1,
        project_id: project,
        batch_id: BatchId::new_v7(),
        device_id: person.tokens.device_id,
        mode: EnvelopeMode::Plain,
        key_epoch: None,
        payload: payload.to_vec(),
        signature: Vec::new(),
    };
    envelope.signature =
        b64url_decode(&signer.sign_b64(&envelope.signing_bytes())).expect("signature decodes");
    envelope
}

pub async fn send_update(socket: &mut Socket, envelope: &Envelope) {
    send_frame(
        socket,
        &ClientFrame::Update {
            project_id: envelope.project_id,
            envelope: envelope.clone(),
        },
    )
    .await;
}

pub async fn seeded(server: &TestServer, name: &str) -> Person {
    let device = TestDevice::generate();
    let tokens = seed_person(
        server.state(),
        PersonSeed {
            name: name.to_owned(),
            email: format!("{}@uni.edu", name.to_lowercase()),
            role: ServerRole::Member,
            device_public_key: device.public_key_b64().to_owned(),
            device_name: "Laptop".to_owned(),
        },
    )
    .await
    .expect("seed a person");
    Person { device, tokens }
}

// Large enough that reading or encoding it on the server's async thread
// shows up as a stall, and small enough to fit in one frame.
pub fn large_change(person: &Person, project: SharedProjectId) -> Envelope {
    envelope(person, project, &vec![b'x'; 7 << 20])
}

struct Finished(Arc<AtomicBool>);

impl Drop for Finished {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

// Runs `work` on a thread with a runtime of its own and sets the flag once
// it ends, even by panicking. A client's own encoding and decoding of large
// frames then never holds up the thread a test shares with its server.
pub fn beside<F>(work: F) -> (tokio::task::JoinHandle<F::Output>, Arc<AtomicBool>)
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    let done = Arc::new(AtomicBool::new(false));
    let finished = Finished(Arc::clone(&done));
    let handle = tokio::task::spawn_blocking(move || {
        let _finished = finished;
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime beside the server")
            .block_on(work)
    });
    (handle, done)
}

// How long a server that shares one thread with the test may keep a ping
// waiting while it handles a large change.
pub const LONGEST_STALL: Duration = Duration::from_millis(100);

// Pings over `socket` until `done` is set and returns the longest time a
// round took beyond its pause, which is how long the thread the test shares
// with the server was held up.
pub async fn longest_stall(socket: &mut Socket, done: &AtomicBool) -> Duration {
    let pause = Duration::from_millis(5);
    let mut slowest = Duration::ZERO;
    let mut id = 0;
    while !done.load(Ordering::SeqCst) {
        id += 1;
        let started = tokio::time::Instant::now();
        send_frame(socket, &ClientFrame::Ping { id }).await;
        loop {
            match next_frame(socket).await {
                Some(ServerFrame::Pong { id: answered }) if answered == id => break,
                Some(_) => {}
                None => panic!("the pinging connection closed"),
            }
        }
        tokio::time::sleep(pause).await;
        slowest = slowest.max(started.elapsed().saturating_sub(pause));
    }
    slowest
}

// Cursor and leave frames wait beside the edit queue and go out when no
// other frame is waiting, so after a removal the room's access change can
// arrive before the leave. Reads both, access change first.
pub async fn told_of_removal(socket: &mut Socket) -> Vec<ServerFrame> {
    let mut told = vec![
        next_frame(socket).await.expect("a frame about the removal"),
        next_frame(socket).await.expect("a frame about the removal"),
    ];
    told.sort_by_key(|frame| matches!(frame, ServerFrame::PresenceLeft { .. }));
    told
}
