use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::JoinHandle;

const MAX_HEAD_BYTES: usize = 64 * 1024;
const REFUSAL: &[u8] = b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 29\r\nConnection: close\r\n\r\nWebSockets are blocked here.\n";

pub struct BlockingProxy {
    addr: SocketAddr,
    blocking: Arc<AtomicBool>,
    online: Arc<AtomicBool>,
    cut: Arc<watch::Sender<u64>>,
    refused: Arc<AtomicU64>,
    forwarded: Arc<AtomicU64>,
    task: JoinHandle<()>,
}

impl BlockingProxy {
    pub async fn start(upstream: SocketAddr) -> BlockingProxy {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind the blocking proxy");
        let addr = listener.local_addr().expect("blocking proxy address");
        let blocking = Arc::new(AtomicBool::new(true));
        let online = Arc::new(AtomicBool::new(true));
        let (cut, _) = watch::channel(0u64);
        let cut = Arc::new(cut);
        let refused = Arc::new(AtomicU64::new(0));
        let forwarded = Arc::new(AtomicU64::new(0));
        let (block, accepting, cuts, refusals, passes) = (
            Arc::clone(&blocking),
            Arc::clone(&online),
            Arc::clone(&cut),
            Arc::clone(&refused),
            Arc::clone(&forwarded),
        );
        let task = tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                if !accepting.load(Ordering::SeqCst) {
                    drop(client);
                    continue;
                }
                let (block, refusals, passes) = (
                    Arc::clone(&block),
                    Arc::clone(&refusals),
                    Arc::clone(&passes),
                );
                let mut cut = cuts.subscribe();
                tokio::spawn(async move {
                    tokio::select! {
                        () = relay(client, upstream, &block, &refusals, &passes) => {}
                        _ = cut.changed() => {}
                    }
                });
            }
        });
        BlockingProxy {
            addr,
            blocking,
            online,
            cut,
            refused,
            forwarded,
            task,
        }
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn address(&self) -> SocketAddr {
        self.addr
    }

    pub fn block_websockets(&self, blocking: bool) {
        self.blocking.store(blocking, Ordering::SeqCst);
    }

    pub fn go_offline(&self) {
        self.online.store(false, Ordering::SeqCst);
        self.cut.send_modify(|count| *count += 1);
    }

    pub fn go_online(&self) {
        self.online.store(true, Ordering::SeqCst);
    }

    pub fn refused(&self) -> u64 {
        self.refused.load(Ordering::SeqCst)
    }

    pub fn forwarded(&self) -> u64 {
        self.forwarded.load(Ordering::SeqCst)
    }
}

impl Drop for BlockingProxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn head_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|start| start + 4)
}

fn asks_for_websocket(head: &[u8]) -> bool {
    String::from_utf8_lossy(head).lines().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.trim().eq_ignore_ascii_case("upgrade")
                && value.trim().eq_ignore_ascii_case("websocket")
        })
    })
}

async fn relay(
    mut client: TcpStream,
    upstream: SocketAddr,
    blocking: &AtomicBool,
    refused: &AtomicU64,
    forwarded: &AtomicU64,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let end = loop {
        if let Some(end) = head_end(&buffer) {
            break end;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return;
        }
        match client.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    };
    if blocking.load(Ordering::SeqCst) && asks_for_websocket(&buffer[..end]) {
        refused.fetch_add(1, Ordering::SeqCst);
        let _ = client.write_all(REFUSAL).await;
        let _ = client.shutdown().await;
        return;
    }
    let Ok(mut server) = TcpStream::connect(upstream).await else {
        return;
    };
    forwarded.fetch_add(1, Ordering::SeqCst);
    let _ = client.set_nodelay(true);
    let _ = server.set_nodelay(true);
    if server.write_all(&buffer).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_member, socket_request, test_config, TestServer};
    use oleafly_collab_protocol::roles::ServerRole;

    fn upstream(server: &TestServer) -> SocketAddr {
        server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address")
    }

    async fn upgrade_status(url: &str, token: &str) -> Result<(), u16> {
        match tokio_tungstenite::connect_async(socket_request(url, Some(token))).await {
            Ok(_) => Ok(()),
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                Err(response.status().as_u16())
            }
            Err(other) => panic!("unexpected upgrade error: {other}"),
        }
    }

    #[tokio::test]
    async fn upgrades_are_refused_while_plain_requests_reach_the_server() {
        let server = TestServer::start(test_config()).await;
        let member = seed_member(server.app(), ServerRole::Member).await;
        let token = member.access_token.as_str();
        let proxy = BlockingProxy::start(upstream(&server)).await;
        assert_eq!(upgrade_status(&proxy.url(), token).await, Err(403));
        assert_eq!(proxy.refused(), 1);
        let answer = reqwest::Client::new()
            .get(format!("{}/healthz", proxy.url()))
            .send()
            .await
            .expect("plain request");
        assert_eq!(answer.status().as_u16(), 200);
        proxy.block_websockets(false);
        assert_eq!(upgrade_status(&proxy.url(), token).await, Ok(()));
        assert_eq!(proxy.refused(), 1);
        proxy.block_websockets(true);
        assert_eq!(upgrade_status(&proxy.url(), token).await, Err(403));
        assert_eq!(proxy.refused(), 2);
    }

    #[tokio::test]
    async fn going_offline_cuts_open_connections_until_it_comes_back() {
        let server = TestServer::start(test_config()).await;
        let proxy = BlockingProxy::start(upstream(&server)).await;
        let client = reqwest::Client::new();
        let health = format!("{}/healthz", proxy.url());
        assert!(client.get(&health).send().await.is_ok());
        proxy.go_offline();
        assert!(client.get(&health).send().await.is_err());
        assert!(reqwest::Client::new().get(&health).send().await.is_err());
        proxy.go_online();
        assert_eq!(
            reqwest::Client::new()
                .get(&health)
                .send()
                .await
                .expect("back online")
                .status()
                .as_u16(),
            200
        );
    }
}
