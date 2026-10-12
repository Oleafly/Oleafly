use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, SessionTokens};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::ServerId;
use oleafly_server::test_support::{
    github_provider, sign_in, test_config, MockGithub, MockGithubUser, TestDevice, TestServer,
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

fn ws_url(server: &TestServer) -> String {
    format!("{}/ws", server.url().replacen("http://", "ws://", 1))
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

async fn open(server: &TestServer) -> (Socket, String, ServerId) {
    let (mut socket, _) = connect_async(ws_url(server)).await.expect("connect");
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
    }
}

#[tokio::test]
async fn a_hello_is_welcomed_and_pings_are_answered() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server).await;
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
async fn another_protocol_version_is_refused() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server).await;
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
    let (mut socket, nonce, server_id) = open(&server).await;
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
    let (mut socket, _nonce, server_id) = open(&server).await;
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
    let (mut socket, nonce, server_id) = open(&server).await;
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
    let (mut socket, nonce, server_id) = open(&server).await;
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
        Some(ServerFrame::SessionRevoked)
    );
    assert_eq!(next_frame(&mut socket).await, None);
    assert_eq!(server.state().sockets.count(laptop_tokens.device_id), 0);
}

#[tokio::test]
async fn signing_out_closes_my_own_socket() {
    let (server, _github) = server_with_carol().await;
    let device = TestDevice::generate();
    let tokens = first_session(&server, &device).await;
    let (mut socket, nonce, server_id) = open(&server).await;
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
        Some(ServerFrame::SessionRevoked)
    );
    assert_eq!(next_frame(&mut socket).await, None);
}

#[tokio::test(start_paused = true)]
async fn the_hello_must_arrive_within_ten_seconds() {
    let server = TestServer::start(test_config()).await;
    let (mut socket, _nonce, _server_id) = open(&server).await;
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
    let (mut socket, nonce, server_id) = open(server).await;
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
    server
        .state()
        .db
        .call(|conn| {
            conn.execute_batch("ALTER TABLE access_tokens RENAME TO access_tokens_away")?;
            Ok(())
        })
        .await
        .expect("move the token table away");
    let (mut socket, nonce, server_id) = open(&server).await;
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
    let (mut socket, nonce, server_id) = open(&server).await;
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
