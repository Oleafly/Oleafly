use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::auth::{challenge_message, ApiError, ChallengePurpose, SessionTokens};
use oleafly_collab_protocol::capabilities::{
    CapabilityManifest, PROTOCOL_VERSION, WELL_KNOWN_PATH,
};
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::ServerId;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::routes::ws::{MAX_HELLO_BYTES, MAX_SOCKETS_PER_ACCOUNT};
use oleafly_server::sockets::SocketLimits;
use oleafly_server::test_support::{
    github_provider, seed_member, sign_in, socket_request, test_config, MockGithub, MockGithubUser,
    TestDevice, TestServer,
};
use reqwest::StatusCode;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn server_with_carol() -> (TestServer, MockGithub) {
    let github = MockGithub::start(vec![MockGithubUser {
        id: 7,
        login: "carol".to_owned(),
        name: "Carol Diaz".to_owned(),
        emails: vec![],
    }])
    .await;
    let mut config = test_config();
    config.providers.push(github_provider("github", &github));
    (TestServer::start(config).await, github)
}

async fn first_session(server: &TestServer, device: &TestDevice) -> SessionTokens {
    sign_in(server, "github", device, Some(&server.setup_code()))
        .await
        .expect("sign in")
}

async fn next_session(server: &TestServer, device: &TestDevice) -> SessionTokens {
    sign_in(server, "github", device, None)
        .await
        .expect("sign in again")
}

async fn next_frame(socket: &mut Socket) -> Option<ServerFrame> {
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
}

async fn open(server: &TestServer, token: &str) -> (Socket, String, ServerId) {
    let (mut socket, _) = connect_async(server.socket_request(token))
        .await
        .expect("connect");
    match next_frame(&mut socket).await {
        Some(ServerFrame::Challenge { nonce, server_id }) => (socket, nonce, server_id),
        other => panic!("expected a challenge, got {other:?}"),
    }
}

async fn send_frame(socket: &mut Socket, frame: &ClientFrame) {
    let text = serde_json::to_string(frame).expect("frame json");
    socket.send(Message::text(text)).await.expect("send frame");
}

fn hello(
    device: &TestDevice,
    tokens: &SessionTokens,
    nonce: &str,
    server_id: ServerId,
    protocol: u32,
) -> ClientFrame {
    ClientFrame::Hello {
        protocol,
        device_id: tokens.device_id,
        access_token: tokens.access_token.clone(),
        nonce: nonce.to_owned(),
        signature: device.sign_b64(&challenge_message(
            ChallengePurpose::Socket,
            server_id,
            nonce,
        )),
        understands: Vec::new(),
    }
}

#[tokio::test]
async fn a_hello_is_welcomed_and_pings_are_answered() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    assert_eq!(server_id, server.state().server_id);
    send_frame(
        &mut socket,
        &hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Welcome {
            protocol: PROTOCOL_VERSION,
            account_id: tokens.account_id
        })
    );
    send_frame(&mut socket, &ClientFrame::Ping { id: 7 }).await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Pong { id: 7 })
    );
    assert_eq!(server.state().sockets.count(tokens.device_id), 1);
}

#[tokio::test]
async fn every_protocol_the_manifest_advertises_is_welcomed_with_its_own_version() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let manifest: CapabilityManifest = reqwest::Client::new()
        .get(format!("{}{WELL_KNOWN_PATH}", server.url()))
        .send()
        .await
        .expect("manifest")
        .json()
        .await
        .expect("manifest json");
    assert!(manifest.protocol.min <= manifest.protocol.max);
    for protocol in manifest.protocol.min..=manifest.protocol.max {
        let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
        send_frame(
            &mut socket,
            &hello(&device, &tokens, &nonce, server_id, protocol),
        )
        .await;
        assert_eq!(
            next_frame(&mut socket).await,
            Some(ServerFrame::Welcome {
                protocol,
                account_id: tokens.account_id
            })
        );
    }
    for outside in [manifest.protocol.min - 1, manifest.protocol.max + 1] {
        let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
        send_frame(
            &mut socket,
            &hello(&device, &tokens, &nonce, server_id, outside),
        )
        .await;
        assert!(matches!(
            next_frame(&mut socket).await,
            Some(ServerFrame::Error {
                code: FrameErrorCode::ProtocolMismatch,
                ..
            })
        ));
    }
}

#[tokio::test]
async fn another_protocol_version_is_refused() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION + 1),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::ProtocolMismatch,
            ..
        })
    ));
    assert_eq!(next_frame(&mut socket).await, None);
}

#[tokio::test]
async fn a_signature_from_another_key_is_refused() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let thief = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(&thief, &tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        })
    ));
    assert_eq!(next_frame(&mut socket).await, None);
}

#[tokio::test]
async fn a_signature_over_another_nonce_is_refused() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, _nonce, server_id) = open(&server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(
            &device,
            &tokens,
            "an-old-nonce",
            server_id,
            PROTOCOL_VERSION,
        ),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        })
    ));
}

#[tokio::test]
async fn a_token_from_another_device_is_refused() {
    let (server, _github) = server_with_carol().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = first_session(&server, &laptop).await;
    let desktop_tokens = next_session(&server, &desktop).await;
    let (mut socket, nonce, server_id) = open(&server, &laptop_tokens.access_token).await;
    let mixed = ClientFrame::Hello {
        protocol: PROTOCOL_VERSION,
        device_id: laptop_tokens.device_id,
        access_token: desktop_tokens.access_token.clone(),
        nonce: nonce.clone(),
        signature: laptop.sign_b64(&challenge_message(
            ChallengePurpose::Socket,
            server_id,
            &nonce,
        )),
        understands: Vec::new(),
    };
    send_frame(&mut socket, &mixed).await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        })
    ));
}

#[tokio::test]
async fn signing_a_device_out_closes_its_socket() {
    let (server, _github) = server_with_carol().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = first_session(&server, &laptop).await;
    let desktop_tokens = next_session(&server, &desktop).await;
    let (mut socket, nonce, server_id) = open(&server, &laptop_tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(&laptop, &laptop_tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Welcome { .. })
    ));
    let status = reqwest::Client::new()
        .delete(format!(
            "{}/api/v1/devices/{}",
            server.url(),
            laptop_tokens.device_id
        ))
        .bearer_auth(&desktop_tokens.access_token)
        .send()
        .await
        .expect("delete")
        .status();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::SessionRevoked { reason: None })
    );
    assert_eq!(next_frame(&mut socket).await, None);
    assert_eq!(server.state().sockets.count(laptop_tokens.device_id), 0);
}

#[tokio::test]
async fn signing_out_closes_my_own_socket() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Welcome { .. })
    ));
    let status = reqwest::Client::new()
        .post(format!("{}/auth/sign-out", server.url()))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .expect("sign out")
        .status();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::SessionRevoked { reason: None })
    );
    assert_eq!(next_frame(&mut socket).await, None);
}

#[tokio::test(start_paused = true)]
async fn the_hello_must_arrive_within_ten_seconds() {
    let server = TestServer::start(test_config()).await;
    let member = seed_member(server.app(), ServerRole::Member).await;
    let (mut socket, _nonce, _server_id) = open(&server, &member.access_token).await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Internal,
            ..
        })
    ));
    assert_eq!(next_frame(&mut socket).await, None);
}

async fn welcomed(server: &TestServer, device: &TestDevice, tokens: &SessionTokens) -> Socket {
    let (mut socket, nonce, server_id) = open(server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(device, tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Welcome { .. })
    ));
    socket
}

#[tokio::test]
async fn a_message_over_the_size_limit_is_answered_before_the_socket_closes() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let mut socket = welcomed(&server, &device, &tokens).await;
    let oversized = "x".repeat(oleafly_server::routes::ws::MAX_FRAME_BYTES + 64 * 1024);
    socket
        .send(Message::text(oversized))
        .await
        .expect("send the oversized message");
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::TooLarge,
            ..
        })
    ));
    let mut close_code = None;
    while let Some(Ok(message)) = socket.next().await {
        if let Message::Close(frame) = message {
            close_code = frame.map(|frame| frame.code);
            break;
        }
    }
    assert_eq!(close_code, Some(CloseCode::Size));
}

#[tokio::test]
async fn a_database_failure_while_checking_a_hello_asks_to_try_again() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    server
        .state()
        .db
        .call(|conn| {
            conn.execute_batch("ALTER TABLE access_tokens RENAME TO access_tokens_away")?;
            Ok(())
        })
        .await
        .expect("move the token table away");
    assert_eq!(
        upgrade_refusal(&server, Some(&tokens.access_token)).await,
        (500, "internal".to_owned())
    );
    send_frame(
        &mut socket,
        &hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    let answer = next_frame(&mut socket).await;
    assert!(
        matches!(
            answer,
            Some(ServerFrame::Error {
                code: FrameErrorCode::Internal,
                ..
            })
        ),
        "{answer:?}"
    );
}

#[tokio::test]
async fn a_database_that_cannot_write_still_welcomes_a_valid_session() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    server
        .state()
        .db
        .call(|conn| {
            conn.execute_batch("PRAGMA query_only = ON")?;
            Ok(())
        })
        .await
        .expect("stop writes");
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION),
    )
    .await;
    let answer = next_frame(&mut socket).await;
    assert!(
        matches!(answer, Some(ServerFrame::Welcome { .. })),
        "{answer:?}"
    );
    send_frame(&mut socket, &ClientFrame::Ping { id: 3 }).await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Pong { id: 3 })
    );
}

async fn upgrade_refusal(server: &TestServer, token: Option<&str>) -> (u16, String) {
    match connect_async(socket_request(&server.url(), token)).await {
        Ok(_) => panic!("the upgrade went through"),
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
            let status = response.status().as_u16();
            let body = response.body().clone().unwrap_or_default();
            let code = serde_json::from_slice::<ApiError>(&body)
                .map(|error| error.code)
                .unwrap_or_default();
            (status, code)
        }
        Err(other) => panic!("unexpected upgrade error: {other}"),
    }
}

#[tokio::test]
async fn an_upgrade_without_a_valid_session_is_refused_before_a_socket_opens() {
    let (server, _github) = server_with_carol().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = first_session(&server, &laptop).await;
    let desktop_tokens = next_session(&server, &desktop).await;
    assert_eq!(
        upgrade_refusal(&server, None).await,
        (401, "unauthorized".to_owned())
    );
    assert_eq!(
        upgrade_refusal(&server, Some("not-a-session")).await,
        (401, "unauthorized".to_owned())
    );
    let status = reqwest::Client::new()
        .delete(format!(
            "{}/api/v1/devices/{}",
            server.url(),
            laptop_tokens.device_id
        ))
        .bearer_auth(&desktop_tokens.access_token)
        .send()
        .await
        .expect("delete")
        .status();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        upgrade_refusal(&server, Some(&laptop_tokens.access_token)).await,
        (401, "unauthorized".to_owned())
    );
    assert_eq!(server.state().sockets.open_sockets(), 0);
    let mut socket = welcomed(&server, &desktop, &desktop_tokens).await;
    send_frame(&mut socket, &ClientFrame::Ping { id: 1 }).await;
    assert_eq!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Pong { id: 1 })
    );
}

#[tokio::test]
async fn a_hello_from_another_device_than_the_upgrade_is_refused() {
    let (server, _github) = server_with_carol().await;
    let laptop = TestDevice::generate();
    let desktop = TestDevice::generate();
    let laptop_tokens = first_session(&server, &laptop).await;
    let desktop_tokens = next_session(&server, &desktop).await;
    let (mut socket, nonce, server_id) = open(&server, &laptop_tokens.access_token).await;
    send_frame(
        &mut socket,
        &hello(
            &desktop,
            &desktop_tokens,
            &nonce,
            server_id,
            PROTOCOL_VERSION,
        ),
    )
    .await;
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        })
    ));
    assert_eq!(next_frame(&mut socket).await, None);
    assert_eq!(server.state().sockets.count(desktop_tokens.device_id), 0);
}

#[tokio::test]
async fn a_first_frame_larger_than_a_hello_is_refused_unread() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server, &tokens.access_token).await;
    let mut padded =
        serde_json::to_value(hello(&device, &tokens, &nonce, server_id, PROTOCOL_VERSION))
            .expect("hello json");
    padded["padding"] = serde_json::Value::String("x".repeat(MAX_HELLO_BYTES));
    let padded = padded.to_string();
    assert!(matches!(
        ClientFrame::from_json(&padded),
        Ok(ClientFrame::Hello { .. })
    ));
    socket
        .send(Message::text(padded))
        .await
        .expect("send the padded hello");
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        })
    ));
    assert_eq!(next_frame(&mut socket).await, None);
}

#[tokio::test]
async fn an_account_keeps_at_most_its_open_socket_allowance() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let mut open_sockets = Vec::new();
    for _ in 0..MAX_SOCKETS_PER_ACCOUNT {
        open_sockets.push(open(&server, &tokens.access_token).await.0);
    }
    assert_eq!(
        upgrade_refusal(&server, Some(&tokens.access_token)).await,
        (429, "rate_limited".to_owned())
    );
    let other = seed_member(server.app(), ServerRole::Member).await;
    let (other_socket, ..) = open(&server, &other.access_token).await;
    drop(open_sockets.pop());
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while server.state().sockets.open_sockets() > MAX_SOCKETS_PER_ACCOUNT {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the closed socket still counts"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    open_sockets.push(open(&server, &tokens.access_token).await.0);
    drop(other_socket);
}

#[tokio::test]
async fn the_server_keeps_at_most_its_open_socket_allowance() {
    let server = TestServer::start(test_config()).await;
    server.state().sockets.set_limits(SocketLimits {
        per_account: MAX_SOCKETS_PER_ACCOUNT,
        total: 3,
    });
    let mut members = Vec::new();
    for _ in 0..4 {
        members.push(seed_member(server.app(), ServerRole::Member).await);
    }
    let mut open_sockets = Vec::new();
    for member in &members[..3] {
        open_sockets.push(open(&server, &member.access_token).await.0);
    }
    assert_eq!(
        upgrade_refusal(&server, Some(&members[3].access_token)).await,
        (429, "rate_limited".to_owned())
    );
}
