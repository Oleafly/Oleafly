use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::capabilities::ProtocolRange;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::BatchId;
use oleafly_collab_protocol::poll::{PollBatch, PollReplies};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::*;
use crate::client::test_util::{device_key, http_response, sample_manifest};
use crate::MemorySecrets;

struct Full {
    project: SharedProjectId,
    manifest: String,
    opens: AtomicUsize,
    batches: Mutex<Vec<BatchId>>,
    drop_poll: AtomicBool,
}

async fn request_of(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut request = Vec::new();
    let mut buffer = [0u8; 8192];
    let end = loop {
        if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break end + 4;
        }
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            return None;
        }
        request.extend_from_slice(&buffer[..read]);
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
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
    }
    Some((head, String::from_utf8_lossy(&request[end..]).to_string()))
}

fn answer(body: &str) -> String {
    http_response("200 OK", &[("Content-Type", "application/json")], body)
}

async fn serve_full(mut stream: TcpStream, full: Arc<Full>) {
    let Some((head, body)) = request_of(&mut stream).await else {
        return;
    };
    let target = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
    let reply = if head.to_ascii_lowercase().contains("upgrade: websocket") {
        http_response("403 Forbidden", &[], "")
    } else if target.starts_with("/.well-known/oleafly-server") {
        answer(&full.manifest)
    } else if target.starts_with("/auth/challenge") {
        answer(
            &serde_json::json!({ "nonce": "nonce", "expires_at": 4_102_444_800_000_i64 })
                .to_string(),
        )
    } else if target.contains("/poll?since=") {
        full.opens.fetch_add(1, Ordering::SeqCst);
        let batch = PollBatch {
            cursor: Some("c".to_owned()),
            key: Some("k".to_owned()),
            frames: vec![ServerFrame::Subscribed {
                project_id: full.project,
                role: ProjectRole::Editor,
                head_seq: 0,
                since_batch: None,
            }],
        };
        answer(&serde_json::to_string(&batch).unwrap())
    } else if target.contains("/poll?cursor=") {
        if full.drop_poll.swap(false, Ordering::SeqCst) {
            http_response("404 Not Found", &[], "")
        } else {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let batch = PollBatch {
                cursor: Some("c".to_owned()),
                key: None,
                frames: Vec::new(),
            };
            answer(&serde_json::to_string(&batch).unwrap())
        }
    } else if target.contains("/frames") {
        let posted: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
        let mut replies = Vec::new();
        for frame in posted["frames"].as_array().cloned().unwrap_or_default() {
            if frame["type"] == "ping" {
                if let Some(id) = frame["id"].as_u64() {
                    replies.push(ServerFrame::Pong { id });
                }
            }
            if frame["type"] == "update" {
                if let Ok(batch) = serde_json::from_value(frame["envelope"]["batch_id"].clone()) {
                    full.batches.lock().unwrap().push(batch);
                }
                replies.push(ServerFrame::Error {
                    code: FrameErrorCode::ProjectTooLarge,
                    message: "This project reached the server's size limit.".to_owned(),
                });
            }
        }
        answer(&serde_json::to_string(&PollReplies { frames: replies }).unwrap())
    } else {
        http_response("404 Not Found", &[], "")
    };
    let _ = stream.write_all(reply.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_full_project_keeps_the_change_says_so_once_per_connection_and_stays_connected() {
    let server_id = ServerId::new_v7();
    let project = SharedProjectId::new_v7();
    let mut manifest = sample_manifest(ProtocolRange { min: 1, max: 1 });
    manifest.server_id = server_id;
    let full = Arc::new(Full {
        project,
        manifest: serde_json::to_string(&manifest).unwrap(),
        opens: AtomicUsize::new(0),
        batches: Mutex::new(Vec::new()),
        drop_poll: AtomicBool::new(false),
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let serving = Arc::clone(&full);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(serve_full(stream, Arc::clone(&serving)));
        }
    });
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
    let link = LiveLink {
        client: Arc::new(
            ServerClient::new(
                crate::ServerUrl::parse(&format!("http://127.0.0.1:{port}")).unwrap(),
            )
            .unwrap(),
        ),
        server_id,
        project,
        device_id,
        key,
        sessions,
    };
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, "abc")
        .unwrap();
    let mut side = side(LiveProject::new(doc, 0, ProjectRole::Editor), &main);
    lock(&side.live).local_text(&main, "abc kept").unwrap();
    let options = TransportOptions {
        ping_every: Duration::from_millis(500),
        quiet_for: Duration::from_secs(2),
        ..quick()
    };
    start_with(&mut side, link, options);
    let mut heard = Vec::new();
    let sent = |count: usize| {
        let full = Arc::clone(&full);
        async move {
            tokio::time::timeout(Duration::from_secs(20), async {
                while full.batches.lock().unwrap().len() < count {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap_or_else(|_| panic!("the change did not go out {count} times"));
        }
    };
    sent(1).await;
    tokio::time::sleep(options.quiet_for * 5).await;
    while let Ok(event) = side.events.try_recv() {
        heard.push(event);
    }
    assert_eq!(full.opens.load(Ordering::SeqCst), 1, "{heard:?}");
    assert_eq!(full.batches.lock().unwrap().len(), 1, "{heard:?}");
    full.drop_poll.store(true, Ordering::SeqCst);
    sent(2).await;
    tokio::time::sleep(options.quiet_for * 5).await;
    while let Ok(event) = side.events.try_recv() {
        heard.push(event);
    }
    let batches = full.batches.lock().unwrap().clone();
    assert_eq!(batches.len(), 2, "{heard:?}");
    assert_eq!(batches[0], batches[1]);
    assert_eq!(full.opens.load(Ordering::SeqCst), 2, "{heard:?}");
    assert_eq!(
        heard
            .iter()
            .filter(|event| **event == LiveEvent::ProjectFull)
            .count(),
        2,
        "{heard:?}"
    );
    assert!(!heard.contains(&LiveEvent::Unsendable), "{heard:?}");
    assert!(lock(&side.live).has_unsent());
    stopped(&mut side).await;
}
