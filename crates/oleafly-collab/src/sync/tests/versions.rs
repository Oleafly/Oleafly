use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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

fn turned_away(code: &str) -> String {
    crate::client::test_util::http_response(
        "401 Unauthorized",
        &[("Content-Type", "application/json")],
        &serde_json::json!({ "code": code, "message": "Sign in to this server." }).to_string(),
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Upgrade {
    Accepted,
    Forbidden,
    // A 401 with no Oleafly answer, as a proxy in front of the server sends.
    ProxyRefuses,
    // The server's own 401.
    Refuses,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Refresh {
    Missing,
    Revoked,
    Renewed,
}

#[derive(Default)]
struct PollTrace {
    polled: AtomicBool,
    missed: AtomicUsize,
}

#[derive(Clone, Copy)]
enum Manifest {
    Served,
    Missing,
    // Served until the app opens long poll, missing after: the app falls
    // back to long poll as usual, then can't read the manifest there.
    GoneAfterPoll(&'static PollTrace),
}

impl Manifest {
    fn served(self) -> bool {
        match self {
            Manifest::Served => true,
            Manifest::Missing => false,
            Manifest::GoneAfterPoll(trace) => {
                let polled = trace.polled.load(Ordering::SeqCst);
                if polled {
                    trace.missed.fetch_add(1, Ordering::SeqCst);
                }
                !polled
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Answers {
    upgrade: Upgrade,
    poll_refuses: bool,
    poll_busy: bool,
    refresh: Refresh,
    manifest: Manifest,
}

const SOCKETS: Answers = Answers {
    upgrade: Upgrade::Accepted,
    poll_refuses: false,
    poll_busy: false,
    refresh: Refresh::Missing,
    manifest: Manifest::Served,
};

const NO_SOCKETS: Answers = Answers {
    upgrade: Upgrade::Forbidden,
    ..SOCKETS
};

// A server that knows nothing of this session: it turns away the upgrade
// or the long-poll open, and a refresh, with its own 401.
fn stranger(sockets: bool) -> Answers {
    Answers {
        upgrade: if sockets {
            Upgrade::Refuses
        } else {
            Upgrade::Forbidden
        },
        poll_refuses: true,
        poll_busy: false,
        refresh: Refresh::Revoked,
        manifest: Manifest::Served,
    }
}

async fn answer(mut stream: TcpStream, manifest: String, server_id: ServerId, answers: Answers) {
    let Some(head) = head_of(&stream).await else {
        return;
    };
    if head.to_ascii_lowercase().contains("upgrade: websocket") {
        let refusal = match answers.upgrade {
            Upgrade::Accepted => None,
            Upgrade::Forbidden => Some(crate::client::test_util::http_response(
                "403 Forbidden",
                &[],
                "",
            )),
            Upgrade::ProxyRefuses => Some(crate::client::test_util::http_response(
                "401 Unauthorized",
                &[("WWW-Authenticate", "Basic")],
                "",
            )),
            Upgrade::Refuses => Some(turned_away("unauthorized")),
        };
        if let Some(refusal) = refusal {
            let _ = stream.write_all(refusal.as_bytes()).await;
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
    if let (true, Manifest::GoneAfterPoll(trace)) = (path.contains("/poll"), answers.manifest) {
        trace.polled.store(true, Ordering::SeqCst);
    }
    if path.contains("/poll") && answers.poll_busy {
        let busy = crate::client::test_util::http_response(
            "503 Service Unavailable",
            &[("Content-Type", "application/json")],
            r#"{"code":"busy","message":"Try again later."}"#,
        );
        let _ = stream.write_all(busy.as_bytes()).await;
        return;
    }
    if path.contains("/poll") && answers.poll_refuses {
        let _ = stream
            .write_all(turned_away("unauthorized").as_bytes())
            .await;
        return;
    }
    if path.starts_with("/auth/refresh") {
        let reply = match answers.refresh {
            Refresh::Missing => crate::client::test_util::http_response("404 Not Found", &[], ""),
            Refresh::Revoked => turned_away("revoked"),
            Refresh::Renewed => crate::client::test_util::http_response(
                "200 OK",
                &[("Content-Type", "application/json")],
                &serde_json::json!({
                    "account_id": AccountId::new_v7(),
                    "device_id": DeviceId::new_v7(),
                    "access_token": "renewed",
                    "access_expires_at": crate::client::now_ms() + 3_600_000,
                    "refresh_token": "renewed",
                })
                .to_string(),
            ),
        };
        let _ = stream.write_all(reply.as_bytes()).await;
        return;
    }
    let body = if path.starts_with("/.well-known/oleafly-server") && answers.manifest.served() {
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
    answers: Answers,
) -> crate::ServerUrl {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut manifest = sample_manifest(protocol);
    manifest.server_id = server_id;
    let manifest = serde_json::to_string(&manifest).unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(answer(stream, manifest.clone(), server_id, answers));
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
    answers: Answers,
) -> (Vec<LiveEvent>, Side, Arc<SessionManager>) {
    let url = answering_at_the_address(answering, protocol, answers).await;
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    let mut side = side(LiveProject::new(doc, 3, ProjectRole::Editor), &main);
    lock(&side.live).local_text(&main, "abc kept").unwrap();
    let link = signed_in(project_server, url);
    let sessions = Arc::clone(&link.sessions);
    start_with(&mut side, link, quick());
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
    (heard, side, sessions)
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
    let (heard, side, _) =
        ending_against(server, server, ProtocolRange { min: 2, max: 3 }, SOCKETS).await;
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
    let (heard, _side, _) =
        ending_against(server, server, ProtocolRange { min: 0, max: 0 }, SOCKETS).await;
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
    let (heard, side, _) = ending_against(
        ServerId::new_v7(),
        ServerId::new_v7(),
        ProtocolRange { min: 1, max: 1 },
        SOCKETS,
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
    let (heard, _side, _) =
        ending_against(server, server, ProtocolRange { min: 2, max: 3 }, NO_SOCKETS).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ClientTooOld
        }))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_server_at_the_address_that_turns_the_session_away_ends_it_as_changed_and_keeps_it() {
    for sockets in [true, false] {
        let project_server = ServerId::new_v7();
        let (heard, side, sessions) = ending_against(
            project_server,
            ServerId::new_v7(),
            ProtocolRange { min: 1, max: 1 },
            stranger(sockets),
        )
        .await;
        assert_eq!(
            heard.last(),
            Some(&LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::ServerChanged
            })),
            "sockets {sockets}: {heard:?}"
        );
        assert!(
            sessions.tokens(project_server).unwrap().is_some(),
            "sockets {sockets}"
        );
        assert!(lock(&side.live).has_unsent());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_turns_away_a_renewed_session_signs_out_the_same_way_on_either_transport() {
    for sockets in [true, false] {
        let server = ServerId::new_v7();
        let answers = Answers {
            refresh: Refresh::Renewed,
            ..stranger(sockets)
        };
        let (heard, _side, _) =
            ending_against(server, server, ProtocolRange { min: 1, max: 1 }, answers).await;
        assert_eq!(
            heard.last(),
            Some(&LiveEvent::Status(LiveStatus::Ended {
                reason: EndReason::SignedOut
            })),
            "sockets {sockets}: {heard:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_turned_away_session_is_kept_when_the_servers_manifest_does_not_load() {
    for sockets in [true, false] {
        let server = ServerId::new_v7();
        let trace: &'static PollTrace = Box::leak(Box::default());
        let answers = Answers {
            refresh: Refresh::Renewed,
            manifest: if sockets {
                Manifest::Missing
            } else {
                Manifest::GoneAfterPoll(trace)
            },
            ..stranger(sockets)
        };
        let url = answering_at_the_address(server, ProtocolRange { min: 1, max: 1 }, answers).await;
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let mut side = side(LiveProject::new(doc, 3, ProjectRole::Editor), &main);
        lock(&side.live).local_text(&main, "abc kept").unwrap();
        let link = signed_in(server, url);
        let sessions = Arc::clone(&link.sessions);
        start_with(&mut side, link, quick());
        let mut heard = Vec::new();
        tokio::time::timeout(Duration::from_secs(20), async {
            while let Some(event) = side.events.recv().await {
                heard.push(event);
                if offline(&heard) >= 3 {
                    return;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("sockets {sockets}: the session heard {heard:?}"));
        assert!(
            !heard
                .iter()
                .any(|event| matches!(event, LiveEvent::Status(LiveStatus::Ended { .. }))),
            "sockets {sockets}: {heard:?}"
        );
        assert_eq!(
            sessions
                .tokens(server)
                .unwrap()
                .map(|tokens| tokens.refresh_token),
            Some("refresh".to_owned()),
            "sockets {sockets}"
        );
        assert!(lock(&side.live).has_unsent());
        if !sockets {
            assert!(
                trace.polled.load(Ordering::SeqCst),
                "long poll was never opened"
            );
            assert!(
                trace.missed.load(Ordering::SeqCst) > 0,
                "the manifest was never read after long poll turned the session away"
            );
        }
        stopped(&mut side).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_401_from_a_proxy_on_the_upgrade_never_renews_the_session() {
    let server = ServerId::new_v7();
    let answers = Answers {
        upgrade: Upgrade::ProxyRefuses,
        refresh: Refresh::Renewed,
        ..SOCKETS
    };
    let (heard, _side, sessions) =
        ending_against(server, server, ProtocolRange { min: 2, max: 3 }, answers).await;
    assert_eq!(
        heard.last(),
        Some(&LiveEvent::Status(LiveStatus::Ended {
            reason: EndReason::ClientTooOld
        })),
        "{heard:?}"
    );
    assert_eq!(
        sessions
            .tokens(server)
            .unwrap()
            .map(|tokens| tokens.refresh_token),
        Some("refresh".to_owned())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_busy_server_on_long_poll_gets_the_long_waits_too() {
    let server = ServerId::new_v7();
    let url = answering_at_the_address(
        server,
        ProtocolRange { min: 1, max: 1 },
        Answers {
            poll_busy: true,
            ..NO_SOCKETS
        },
    )
    .await;
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    let mut side = side(LiveProject::new(doc, 0, ProjectRole::Editor), &main);
    start_with(&mut side, signed_in(server, url), quick());
    let mut waits = Vec::new();
    tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(event) = side.events.recv().await {
            if let LiveEvent::Status(LiveStatus::Offline { retry_in_ms }) = event {
                waits.push(retry_in_ms);
                if waits.len() == 2 {
                    return;
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("only these waits came: {waits:?}"));
    assert!(waits[0] <= 500, "{waits:?}");
    assert!((5_000..=10_000).contains(&waits[1]), "{waits:?}");
    stopped(&mut side).await;
}
