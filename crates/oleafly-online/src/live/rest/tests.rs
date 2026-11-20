use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::{RestError, TreeRest};
use crate::client::Http;
use crate::live::tree_queue::MAX_UPLOAD_BYTES;
use crate::realtime::events::EntityId;
use crate::realtime::ProjectPage;
use crate::session::{Session, SessionHandle};

const PROJECT: &str = "64f0c0ffee0123456789abcd";
const PATIENCE: Duration = Duration::from_secs(30);

async fn read_request(stream: &mut TcpStream) {
    let mut seen = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !seen.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => seen.extend_from_slice(&buffer[..read]),
        }
    }
}

async fn serve(
    head: &'static str,
    body: impl Fn(u64) -> Option<Vec<u8>> + Send + 'static,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        read_request(&mut stream).await;
        if stream.write_all(head.as_bytes()).await.is_err() {
            return;
        }
        let mut round = 0;
        while let Some(bytes) = body(round) {
            if stream.write_all(&bytes).await.is_err() {
                return;
            }
            round += 1;
        }
        tokio::time::sleep(PATIENCE * 2).await;
    });
    base
}

async fn download(base: &str) -> Result<Vec<u8>, RestError> {
    let http = Http::new(base, "Oleafly/test").unwrap();
    let page = Arc::new(ProjectPage::unloaded(PROJECT).unwrap());
    let rest = TreeRest::new(http, page, PROJECT);
    let session = SessionHandle::new(
        base,
        Session {
            cookie: "overleaf_session2=s%3Atest".into(),
            user_id: "alice".into(),
            email: "alice@example.com".into(),
            saved_by: None,
        },
        None,
    );
    let mut seen = 0;
    let mut progress = |done: u64, _: Option<u64>| seen = done;
    let file = EntityId("f1".into());
    let fetched = rest.download(&session, &file, None, &mut progress);
    let result = tokio::time::timeout(PATIENCE, fetched)
        .await
        .expect("the download gave up instead of reading forever");
    assert!(seen <= MAX_UPLOAD_BYTES, "{seen} bytes were kept");
    result
}

#[tokio::test]
async fn a_declared_length_over_the_cap_is_refused_before_reading() {
    let base = serve(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 9223372036854775808\r\n\r\n",
        |round| (round == 0).then(|| b"PNG".to_vec()),
    )
    .await;
    assert_eq!(download(&base).await, Err(RestError::TooLarge));
}

#[tokio::test]
async fn a_chunked_body_that_never_ends_stops_at_the_cap() {
    let base = serve(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
        |_| {
            let mut chunk = b"10000\r\n".to_vec();
            chunk.extend(std::iter::repeat_n(b'x', 0x10000));
            chunk.extend_from_slice(b"\r\n");
            Some(chunk)
        },
    )
    .await;
    assert_eq!(download(&base).await, Err(RestError::TooLarge));
}
