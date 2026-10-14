use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::test_support::{seed_member, socket_request, test_config, TestServer};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::{Error, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

const MIB: usize = 1024 * 1024;

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

fn measure_from_now() -> usize {
    let live = LIVE.load(Ordering::Relaxed);
    PEAK.store(live, Ordering::Relaxed);
    live
}

fn rise_since(start: usize) -> usize {
    PEAK.load(Ordering::Relaxed).saturating_sub(start)
}

fn padded_hello(bytes: usize) -> String {
    let mut text = String::with_capacity(bytes + 64);
    text.push_str(r#"{"type":"hello","x":["#);
    while text.len() < bytes {
        text.push_str("[0],");
    }
    text.push_str("[0]]}");
    text
}

async fn next_frame(socket: &mut Socket) -> Option<ServerFrame> {
    while let Some(message) = socket.next().await {
        match message {
            Ok(Message::Text(text)) => return serde_json::from_str(text.as_str()).ok(),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fifty_strangers_never_get_a_socket_to_send_into() {
    let _one = ONE_AT_A_TIME.lock().await;
    let server = TestServer::start(test_config()).await;
    let member = seed_member(server.app(), ServerRole::Member).await;
    let start = measure_from_now();
    for attempt in 0..50 {
        match connect_async(socket_request(&server.url(), None)).await {
            Err(Error::Http(response)) => assert_eq!(
                response.status().as_u16(),
                401,
                "attempt {attempt} was not refused"
            ),
            Ok(_) => panic!("attempt {attempt} got a socket without signing in"),
            Err(other) => panic!("attempt {attempt} failed another way: {other}"),
        }
    }
    let rise = rise_since(start);
    assert!(
        rise < 4 * MIB,
        "refusing 50 strangers took {rise} bytes of heap"
    );
    assert_eq!(server.state().sockets.open_sockets(), 0);
    let (mut socket, _) = connect_async(server.socket_request(&member.access_token))
        .await
        .expect("a member still connects");
    assert!(matches!(
        next_frame(&mut socket).await,
        Some(ServerFrame::Challenge { .. })
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn padded_first_frames_are_refused_without_parsing_them() {
    let _one = ONE_AT_A_TIME.lock().await;
    let server = TestServer::start(test_config()).await;
    let mut members = Vec::new();
    for _ in 0..4 {
        members.push(seed_member(server.app(), ServerRole::Member).await);
    }
    let frame = 4 * MIB;
    let padded = padded_hello(frame);
    let start = measure_from_now();
    for member in &members {
        let (mut socket, _) = connect_async(server.socket_request(&member.access_token))
            .await
            .expect("connect");
        assert!(matches!(
            next_frame(&mut socket).await,
            Some(ServerFrame::Challenge { .. })
        ));
        socket
            .send(Message::text(padded.clone()))
            .await
            .expect("send the padded frame");
        assert!(matches!(
            next_frame(&mut socket).await,
            Some(ServerFrame::Error {
                code: FrameErrorCode::BadFrame,
                ..
            })
        ));
    }
    let rise = rise_since(start);
    assert!(
        rise < 8 * frame,
        "four padded {frame} byte frames peaked at {rise} bytes of heap"
    );
}

async fn status_line(stream: &mut TcpStream) -> String {
    let mut seen = Vec::new();
    let mut byte = [0u8; 1];
    while !seen.ends_with(b"\r\n") {
        match stream.read(&mut byte).await {
            Ok(1) => seen.push(byte[0]),
            _ => break,
        }
    }
    String::from_utf8_lossy(&seen).trim().to_owned()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn posted_frames_without_a_poll_key_are_refused_before_the_body_arrives() {
    let _one = ONE_AT_A_TIME.lock().await;
    let server = TestServer::start(test_config()).await;
    let address = server.url().trim_start_matches("http://").to_owned();
    let start = measure_from_now();
    let mut held = Vec::new();
    for attempt in 0..20 {
        let mut stream = TcpStream::connect(&address).await.expect("connect");
        let head = format!(
            "POST /api/v1/projects/{}/frames HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: 12000000\r\n\r\n",
            SharedProjectId::new_v7()
        );
        stream
            .write_all(head.as_bytes())
            .await
            .expect("send the head");
        stream
            .write_all(&[b' '; 1024])
            .await
            .expect("send the first kilobyte");
        let status = tokio::time::timeout(Duration::from_secs(2), status_line(&mut stream))
            .await
            .unwrap_or_else(|_| panic!("attempt {attempt} waited for the rest of the body"));
        assert!(
            status.starts_with("HTTP/1.1 404"),
            "attempt {attempt}: {status}"
        );
        held.push(stream);
    }
    let rise = rise_since(start);
    assert!(
        rise < 4 * MIB,
        "twenty posts declaring 12 MB each took {rise} bytes of heap"
    );
}
