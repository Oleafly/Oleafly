#![allow(dead_code)]

use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::admin::AllowlistMatcher;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, SessionTokens};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::crypto::b64url_decode;
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use oleafly_collab_protocol::ids::{BatchId, SharedProjectId};
use oleafly_collab_protocol::projects::{MemberGrant, NewProject, ProjectRole, ProjectSummary};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::config::ServerConfig;
use oleafly_server::test_support::{
    allowlist, github_provider, sign_in, test_config, MockGithub, MockGithubUser, TestDevice,
    TestServer,
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

pub async fn share_project(server: &TestServer, owner: &Person, title: &str) -> ProjectSummary {
    let created = create_project(server, owner, title).await;
    let path = format!("/api/v1/projects/{}/snapshot?seq=0", created.project_id);
    let uploaded = put_bytes(server, &path, owner.token(), b"first snapshot".to_vec()).await;
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

fn ws_url(server: &TestServer) -> String {
    format!("{}/ws", server.url().replacen("http://", "ws://", 1))
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
    let (mut socket, _) = connect_async(ws_url(server)).await.expect("connect");
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
