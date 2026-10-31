use std::net::SocketAddr;
use std::time::{Duration, Instant};

use oleafly_server::test_support::{test_config, TestServer};
use oleafly_server::ConnectionTimeouts;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

const TIMEOUTS: ConnectionTimeouts = ConnectionTimeouts {
    first_request: Duration::from_millis(300),
    keep_alive: Duration::from_secs(2),
};

async fn serving() -> (TestServer, SocketAddr, oneshot::Sender<()>) {
    let server = TestServer::start(test_config()).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    tokio::spawn(oleafly_server::serve_on_with(
        server.state().clone(),
        listener,
        async move {
            let _ = stopped.await;
        },
        TIMEOUTS,
    ));
    (server, address, stop)
}

async fn read_head(stream: &mut TcpStream) -> String {
    let mut seen = Vec::new();
    let mut buffer = [0u8; 1024];
    while !seen.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer))
            .await
            .expect("an answer")
            .expect("a read");
        assert!(
            read > 0,
            "the server closed the connection before answering"
        );
        seen.extend_from_slice(&buffer[..read]);
    }
    String::from_utf8_lossy(&seen).into_owned()
}

async fn closed_after(stream: &mut TcpStream, since: Instant) -> Duration {
    let mut buffer = [0u8; 1024];
    loop {
        let read = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buffer))
            .await
            .expect("the server closes the connection");
        if !matches!(read, Ok(read) if read > 0) {
            return since.elapsed();
        }
    }
}

#[tokio::test]
async fn a_client_that_sends_half_a_header_is_cut_off() {
    let (_server, address, _stop) = serving().await;
    let mut stream = TcpStream::connect(address).await.unwrap();
    let started = Instant::now();
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nX-Slow: ")
        .await
        .unwrap();
    let closed = closed_after(&mut stream, started).await;
    assert!(closed >= Duration::from_millis(250), "{closed:?}");
    assert!(
        closed < TIMEOUTS.keep_alive,
        "the connection was held for {closed:?}"
    );
}

#[tokio::test]
async fn an_idle_connection_is_kept_for_the_keep_alive_and_then_closed() {
    let (_server, address, _stop) = serving().await;
    let mut stream = TcpStream::connect(address).await.unwrap();
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    let answered = read_head(&mut stream).await;
    assert!(answered.starts_with("HTTP/1.1 200"), "{answered}");
    let idle = Instant::now();
    let closed = closed_after(&mut stream, idle).await;
    assert!(
        closed >= TIMEOUTS.keep_alive - Duration::from_millis(200),
        "a connection that sent a request was closed after {closed:?}"
    );
}
