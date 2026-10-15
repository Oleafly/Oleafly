use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::capabilities::ProtocolRange;
use oleafly_collab_protocol::frames::ServerFrame;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::*;
use crate::client::test_util::{device_key, sample_manifest};
use crate::MemorySecrets;

const REFUSAL: &str = "This server speaks another protocol version.";

async fn head_of(stream: &TcpStream) -> Option<String> {
    let mut buffer = vec![0u8; 8192];
    for _ in 0..200 {
        let seen = stream.peek(&mut buffer).await.ok()?;
        let text = String::from_utf8_lossy(&buffer[..seen]).to_string();
        if text.contains("\r\n\r\n") {
            return Some(text);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    None
}

async fn answer(mut stream: TcpStream, manifest: String, server_id: ServerId, sockets: bool) {
    let Some(head) = head_of(&stream).await else {
        return;
    };
    if head.to_ascii_lowercase().contains("upgrade: websocket") {
        if !sockets {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        }
        let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        let say = |frame: &ServerFrame| {
            tokio_tungstenite::tungstenite::Message::text(serde_json::to_string(frame).unwrap())
        };
        let challenge = ServerFrame::Challenge {
            nonce: "nonce".to_owned(),
            server_id,
        };
        if futures_util::SinkExt::send(&mut socket, say(&challenge))
            .await
            .is_err()
        {
            return;
        }
        let _ = futures_util::StreamExt::next(&mut socket).await;
        let refused = ServerFrame::Error {
            code: FrameErrorCode::ProtocolMismatch,
            message: REFUSAL.to_owned(),
        };
        let _ = futures_util::SinkExt::send(&mut socket, say(&refused)).await;
        let _ = futures_util::SinkExt::close(&mut socket).await;
        return;
    }
    let mut request = vec![0u8; head.len()];
    if stream.read_exact(&mut request).await.is_err() {
        return;
    }
    let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
    let body = if path.starts_with("/.well-known/oleafly-server") {
        manifest
    } else if path.starts_with("/auth/challenge") {
        serde_json::json!({ "nonce": "nonce", "expires_at": 4_102_444_800_000_i64 }).to_string()
    } else if path.contains("/poll") {
        serde_json::json!({
            "frames": [{ "type": "error", "code": "protocol_mismatch", "message": REFUSAL }]
        })
        .to_string()
    } else {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
        return;
    };
    let reply = crate::client::test_util::http_response(
        "200 OK",
        &[("Content-Type", "application/json")],
        &body,
    );
    let _ = stream.write_all(reply.as_bytes()).await;
    let _ = stream.shutdown().await;
}

// A server at the project's address that can never carry it on: its
// manifest has `protocol` and `server_id`, and it refuses this app's protocol
// version on the socket and on long-poll, or refuses WebSockets outright.
async fn answering_at_the_address(
    server_id: ServerId,
    protocol: ProtocolRange,
    sockets: bool,
) -> crate::ServerUrl {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut manifest = sample_manifest(protocol);
    manifest.server_id = server_id;
    let manifest = serde_json::to_string(&manifest).unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(answer(stream, manifest.clone(), server_id, sockets));
        }
    });
    crate::ServerUrl::parse(&format!("http://127.0.0.1:{port}")).unwrap()
}

fn signed_in(server_id: ServerId, url: crate::ServerUrl) -> LiveLink {
    let key = Arc::new(device_key());
    let sessions = Arc::new(SessionManager::new(
        Arc::new(MemorySecrets::default()),
        Arc::clone(&key),
    ));
    let device_id = DeviceId::new_v7();
    sessions
        .store(
            server_id,
            &SessionTokens {
                account_id: AccountId::new_v7(),
                device_id,
                access_token: "access".to_owned(),
                access_expires_at: crate::client::now_ms() + 3_600_000,
                refresh_token: "refresh".to_owned(),
            },
        )
        .unwrap();
    LiveLink {
        client: Arc::new(ServerClient::new(url).unwrap()),
        server_id,
        project: SharedProjectId::new_v7(),
        device_id,
        key,
        sessions,
    }
}

async fn ending_against(
    project_server: ServerId,
    answering: ServerId,
    protocol: ProtocolRange,
    sockets: bool,
) -> (Vec<LiveEvent>, Side) {
    let url = answering_at_the_address(answering, protocol, sockets).await;
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    let mut side = side(LiveProject::new(doc, 3, ProjectRole::Editor), &main);
    lock(&side.live).local_text(&main, "abc kept").unwrap();
    start_with(&mut side, signed_in(project_server, url), quick());
    let mut heard = Vec::new();
    tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(event) = side.events.recv().await {
            let ended = matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }));
            heard.push(event);
            if ended {
                return;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("the session never ended, it heard {heard:?}"));
    (heard, side)
}

fn offline(heard: &[LiveEvent]) -> usize {
    heard
        .iter()
        .filter(|event| matches!(event, LiveEvent::Status(LiveStatus::Offline { .. })))
        .count()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_speaks_only_a_newer_protocol_ends_the_session_once_and_keeps_the_changes() {
    let server = ServerId::new_v7();
    let (heard, side) =
        ending_against(server, server, ProtocolRange { min: 2, max: 3 }, true).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ClientTooOld
        }))
    );
    assert_eq!(offline(&heard), 0, "{heard:?}");
    assert!(lock(&side.live).has_unsent());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_speaks_only_an_older_protocol_says_the_server_needs_an_update() {
    let server = ServerId::new_v7();
    let (heard, _side) =
        ending_against(server, server, ProtocolRange { min: 0, max: 0 }, true).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ServerTooOld
        }))
    );
    assert_eq!(offline(&heard), 0, "{heard:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_different_server_at_the_address_ends_the_session() {
    let (heard, side) = ending_against(
        ServerId::new_v7(),
        ServerId::new_v7(),
        ProtocolRange { min: 1, max: 1 },
        true,
    )
    .await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ServerChanged
        }))
    );
    assert_eq!(offline(&heard), 0, "{heard:?}");
    assert!(lock(&side.live).has_unsent());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_version_refusal_over_long_poll_ends_the_session_the_same_way() {
    let server = ServerId::new_v7();
    let (heard, _side) =
        ending_against(server, server, ProtocolRange { min: 2, max: 3 }, false).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ClientTooOld
        }))
    );
}
