use std::collections::VecDeque;
use std::ffi::OsString;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use hyper_util::client::proxy::matcher::{Intercept, Matcher};
use rustls::pki_types::CertificateDer;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{self, HeaderMap};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};
use url::Url;

#[cfg(feature = "e2e-hooks")]
pub mod e2e_route;
pub mod reconnect;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_MESSAGE_BYTES: usize = 12 * 1024 * 1024;
const UPGRADE_TIMEOUT: Duration = Duration::from_secs(10);
const NEXT_ADDRESS_AFTER: Duration = Duration::from_millis(250);
const PROXY_ANSWER_BYTES: usize = 8 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Tls(String),
    #[error("{0}")]
    Handshake(Box<WsError>),
}

impl From<WsError> for NetError {
    fn from(error: WsError) -> NetError {
        NetError::Handshake(Box::new(error))
    }
}

fn socket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES))
}

pub type WebSocket = WebSocketStream<MaybeTlsStream<Counted>>;

fn clock() -> &'static std::time::Instant {
    static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    STARTED.get_or_init(std::time::Instant::now)
}

fn now_ticks() -> u64 {
    u64::try_from(clock().elapsed().as_millis()).unwrap_or(u64::MAX)
}

struct Arrived {
    at: AtomicU64,
    bytes: AtomicU64,
}

pub struct Counted {
    stream: TcpStream,
    heard: Arc<Arrived>,
}

impl Counted {
    fn new(stream: TcpStream) -> Counted {
        Counted {
            stream,
            heard: Arc::new(Arrived {
                at: AtomicU64::new(now_ticks()),
                bytes: AtomicU64::new(0),
            }),
        }
    }
}

#[derive(Clone)]
pub struct Heard(Arc<Arrived>);

impl Heard {
    pub fn of(socket: &WebSocket) -> Option<Heard> {
        let counted = match socket.get_ref() {
            MaybeTlsStream::Rustls(tls) => tls.get_ref().0,
            MaybeTlsStream::Plain(plain) => plain,
            _ => return None,
        };
        Some(Heard(Arc::clone(&counted.heard)))
    }

    pub fn silent_for(&self) -> Duration {
        let last = self.0.at.load(Ordering::Relaxed);
        Duration::from_millis(now_ticks().saturating_sub(last))
    }

    pub fn bytes(&self) -> u64 {
        self.0.bytes.load(Ordering::Relaxed)
    }
}

impl tokio::io::AsyncRead for Counted {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let before = buffer.filled().len();
        let read = std::pin::Pin::new(&mut self.stream).poll_read(context, buffer);
        let arrived = buffer.filled().len().saturating_sub(before);
        if arrived > 0 {
            self.heard.at.store(now_ticks(), Ordering::Relaxed);
            self.heard.bytes.fetch_add(
                u64::try_from(arrived).unwrap_or(u64::MAX),
                Ordering::Relaxed,
            );
        }
        read
    }
}

impl tokio::io::AsyncWrite for Counted {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.stream).poll_write(context, bytes)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_flush(context)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_shutdown(context)
    }
}

pub async fn open_websocket(target: &Url, headers: HeaderMap) -> Result<WebSocket, NetError> {
    open_through(target, headers, Matcher::from_system).await
}

#[cfg(any(test, feature = "test-support"))]
pub async fn open_websocket_through(
    target: &Url,
    headers: HeaderMap,
    proxy: &str,
) -> Result<WebSocket, NetError> {
    let invalid = || NetError::Network("the proxy address is not valid".to_string());
    let host = target.host_str().ok_or_else(invalid)?;
    let port = target.port_or_known_default().ok_or_else(invalid)?;
    let uri: http::Uri = format!("http://{host}:{port}")
        .parse()
        .map_err(|_| invalid())?;
    let route = Matcher::builder()
        .all(proxy.to_string())
        .build()
        .intercept(&uri)
        .ok_or_else(invalid)?;
    open_routed(target, headers, Some(route)).await
}

async fn open_through(
    target: &Url,
    headers: HeaderMap,
    matcher: impl FnOnce() -> Matcher,
) -> Result<WebSocket, NetError> {
    open_routed(target, headers, proxy_for(target, &matcher())).await
}

async fn open_routed(
    target: &Url,
    headers: HeaderMap,
    proxy: Option<Intercept>,
) -> Result<WebSocket, NetError> {
    let mut request = target.as_str().into_client_request()?;
    request.headers_mut().extend(headers);
    let stream = Counted::new(connect_routed(target, proxy).await?);
    let connector = if target.scheme() == "wss" {
        Connector::Rustls(tls_config()?)
    } else {
        Connector::Plain
    };
    let handshake = tokio_tungstenite::client_async_tls_with_config(
        request,
        stream,
        Some(socket_config()),
        Some(connector),
    );
    match tokio::time::timeout(UPGRADE_TIMEOUT, handshake).await {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Err(NetError::Network(
            "the WebSocket upgrade timed out".to_string(),
        )),
    }
}

pub async fn connect_tcp(target: &Url) -> Result<TcpStream, NetError> {
    connect_with(target, Matcher::from_system).await
}

async fn connect_with(
    target: &Url,
    matcher: impl FnOnce() -> Matcher,
) -> Result<TcpStream, NetError> {
    connect_routed(target, proxy_for(target, &matcher())).await
}

async fn connect_routed(target: &Url, proxy: Option<Intercept>) -> Result<TcpStream, NetError> {
    let host = target
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = target
        .port_or_known_default()
        .ok_or_else(|| NetError::Network("the address has no port".to_string()))?;
    let attempt = async {
        #[cfg(feature = "e2e-hooks")]
        if let Some(address) = e2e_route::route_for(&host) {
            return TcpStream::connect(address).await;
        }
        match proxy {
            Some(proxy) => through_proxy(&proxy, &host, port).await,
            None => connect_host(&host, port).await,
        }
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, attempt).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(error)) => Err(NetError::Network(error.to_string())),
        Err(_) => Err(NetError::Network(
            "connecting to the server timed out".to_string(),
        )),
    }
}

fn interleaved(addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let first_v6 = addresses.first().is_some_and(SocketAddr::is_ipv6);
    let (mut first, mut second): (VecDeque<SocketAddr>, VecDeque<SocketAddr>) = addresses
        .into_iter()
        .partition(|address| address.is_ipv6() == first_v6);
    let mut ordered = Vec::with_capacity(first.len() + second.len());
    while !first.is_empty() || !second.is_empty() {
        ordered.extend(first.pop_front());
        ordered.extend(second.pop_front());
    }
    ordered
}

// Each address gets 250 ms before the next one starts, as in RFC 8305, and
// the next one starts at once when an attempt fails, so an address with no
// route doesn't cost its whole slot.
async fn race(addresses: Vec<SocketAddr>) -> std::io::Result<TcpStream> {
    race_with(addresses, TcpStream::connect).await
}

async fn race_with<Connect, Connecting, Stream>(
    addresses: Vec<SocketAddr>,
    connect: Connect,
) -> std::io::Result<Stream>
where
    Connect: Fn(SocketAddr) -> Connecting,
    Connecting: std::future::Future<Output = std::io::Result<Stream>>,
{
    let mut waiting = interleaved(addresses).into_iter();
    let mut trying = futures_util::stream::FuturesUnordered::new();
    let mut failed = None;
    loop {
        if trying.is_empty() {
            match waiting.next() {
                Some(address) => trying.push(connect(address)),
                None => {
                    return Err(failed.unwrap_or_else(|| {
                        std::io::Error::other("the server's address did not resolve")
                    }))
                }
            }
        }
        tokio::select! {
            finished = trying.next() => match finished {
                Some(Ok(stream)) => return Ok(stream),
                Some(Err(error)) => {
                    failed = Some(error);
                    if let Some(address) = waiting.next() {
                        trying.push(connect(address));
                    }
                }
                None => {}
            },
            () = tokio::time::sleep(NEXT_ADDRESS_AFTER), if !waiting.as_slice().is_empty() => {
                if let Some(address) = waiting.next() {
                    trying.push(connect(address));
                }
            }
        }
    }
}

async fn connect_host(host: &str, port: u16) -> std::io::Result<TcpStream> {
    race(tokio::net::lookup_host((host, port)).await?.collect()).await
}

fn authority(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn proxy_for(target: &Url, matcher: &Matcher) -> Option<Intercept> {
    let host = target.host_str()?;
    if matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
        return None;
    }
    let scheme = match target.scheme() {
        "wss" | "https" => "https",
        _ => "http",
    };
    let port = target.port_or_known_default()?;
    let uri: http::Uri = format!("{scheme}://{host}:{port}").parse().ok()?;
    matcher.intercept(&uri)
}

async fn through_proxy(proxy: &Intercept, host: &str, port: u16) -> std::io::Result<TcpStream> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = proxy.uri();
    let (Some("http"), Some(proxy_host)) = (address.scheme_str(), address.host()) else {
        return connect_host(host, port).await;
    };
    let proxy_host = proxy_host.trim_start_matches('[').trim_end_matches(']');
    let mut stream = connect_host(proxy_host, address.port_u16().unwrap_or(80)).await?;
    let to = authority(host, port);
    let mut request = format!("CONNECT {to} HTTP/1.1\r\nHost: {to}\r\n");
    if let Some(credentials) = proxy.basic_auth().and_then(|value| value.to_str().ok()) {
        request.push_str(&format!("Proxy-Authorization: {credentials}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await?;
    let mut answer = Vec::new();
    while !answer.ends_with(b"\r\n\r\n") {
        if answer.len() >= PROXY_ANSWER_BYTES {
            return Err(std::io::Error::other("the proxy's answer is too long"));
        }
        let mut byte = [0u8; 1];
        if stream.read(&mut byte).await? == 0 {
            return Err(std::io::Error::other("the proxy closed the connection"));
        }
        answer.push(byte[0]);
    }
    let answer = String::from_utf8_lossy(&answer);
    let status = answer.lines().next().unwrap_or_default();
    if status.split_whitespace().nth(1) == Some("200") {
        Ok(stream)
    } else {
        Err(std::io::Error::other(format!(
            "the proxy refused the connection: {status}"
        )))
    }
}

type RootsFrom = (Option<OsString>, Option<OsString>);

type BuiltTls = Option<(RootsFrom, Arc<rustls::ClientConfig>)>;

fn roots_from() -> RootsFrom {
    (
        std::env::var_os("SSL_CERT_FILE"),
        std::env::var_os("SSL_CERT_DIR"),
    )
}

fn tls_config() -> Result<Arc<rustls::ClientConfig>, NetError> {
    static BUILT: Mutex<BuiltTls> = Mutex::new(None);
    let from = roots_from();
    if let Some((seen, config)) = BUILT
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
    {
        if *seen == from {
            return Ok(Arc::clone(config));
        }
    }
    let config = build_tls_config()?;
    *BUILT.lock().unwrap_or_else(PoisonError::into_inner) = Some((from, Arc::clone(&config)));
    Ok(config)
}

fn build_tls_config() -> Result<Arc<rustls::ClientConfig>, NetError> {
    let roots = root_store(rustls_native_certs::load_native_certs());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|error| NetError::Tls(error.to_string()))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Arc::new(config))
}

fn root_store(native: rustls_native_certs::CertificateResult) -> rustls::RootCertStore {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let os_roots: Vec<CertificateDer<'static>> = native.certs;
    roots.add_parsable_certificates(os_roots);
    roots
}

#[cfg(any(test, feature = "test-support"))]
pub mod testing {
    use std::net::SocketAddr;
    use std::sync::Arc;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    pub async fn connect_proxy(
        answer: &'static str,
        upstream: Option<SocketAddr>,
    ) -> (SocketAddr, Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let address = listener.local_addr().expect("address");
        let asked: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
        let kept = Arc::clone(&asked);
        tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let kept = Arc::clone(&kept);
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        match client.read(&mut byte).await {
                            Ok(0) | Err(_) => return,
                            Ok(_) => head.push(byte[0]),
                        }
                    }
                    let head = String::from_utf8_lossy(&head).to_string();
                    kept.lock().expect("asked").push(head.clone());
                    let target = upstream.map_or_else(
                        || {
                            head.split_whitespace()
                                .nth(1)
                                .unwrap_or_default()
                                .to_owned()
                        },
                        |upstream| upstream.to_string(),
                    );
                    if !answer.starts_with("HTTP/1.1 200") {
                        let _ = client.write_all(answer.as_bytes()).await;
                        return;
                    }
                    let Ok(mut server) = TcpStream::connect(target).await else {
                        return;
                    };
                    if client.write_all(answer.as_bytes()).await.is_ok() {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                    }
                });
            }
        });
        (address, asked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{
        Callback, ErrorResponse, Request, Response,
    };
    use tokio_tungstenite::tungstenite::http::HeaderValue;

    #[test]
    fn tls_config_builds_on_the_ring_provider() {
        assert!(tls_config().is_ok());
    }

    #[test]
    fn the_tls_config_is_built_once_while_the_root_settings_stay_the_same() {
        let first = tls_config().expect("a config");
        let second = tls_config().expect("a config");
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn heard_counts_the_bytes_a_socket_reads() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await {
                    use futures_util::SinkExt;
                    let _ = socket
                        .send(tokio_tungstenite::tungstenite::Message::text(
                            "x".repeat(4096),
                        ))
                        .await;
                    let _ = socket.next().await;
                }
            }
        });
        let target = Url::parse(&format!("ws://{address}/socket")).expect("url");
        let mut socket = open_websocket(&target, HeaderMap::new())
            .await
            .expect("a socket");
        let heard = Heard::of(&socket).expect("a counted socket");
        assert!(heard.bytes() > 0);
        let message = socket.next().await.expect("a message").expect("text");
        assert_eq!(message.len(), 4096);
        assert!(heard.bytes() > 4096);
        assert!(heard.silent_for() < Duration::from_secs(5));
        let _ = socket.close(None).await;
    }

    #[test]
    fn unreadable_os_roots_leave_the_webpki_roots() {
        let mut broken = rustls_native_certs::CertificateResult::default();
        broken.certs.push(CertificateDer::from(vec![1u8, 2, 3]));
        assert_eq!(
            root_store(broken).len(),
            webpki_roots::TLS_SERVER_ROOTS.len()
        );
        assert_eq!(
            root_store(rustls_native_certs::CertificateResult::default()).len(),
            webpki_roots::TLS_SERVER_ROOTS.len()
        );
    }

    #[test]
    fn addresses_alternate_between_the_two_families() {
        let address = |text: &str| text.parse::<SocketAddr>().expect("address");
        let resolved = vec![
            address("[2001:db8::1]:443"),
            address("[2001:db8::2]:443"),
            address("192.0.2.1:443"),
            address("192.0.2.2:443"),
            address("192.0.2.3:443"),
        ];
        assert_eq!(
            interleaved(resolved),
            vec![
                address("[2001:db8::1]:443"),
                address("192.0.2.1:443"),
                address("[2001:db8::2]:443"),
                address("192.0.2.2:443"),
                address("192.0.2.3:443"),
            ]
        );
    }

    #[tokio::test]
    async fn an_address_that_never_answers_does_not_hold_up_one_that_does() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let working = listener.local_addr().expect("address");
        let dead: SocketAddr = "[100::1]:9".parse().expect("address");
        let started = tokio::time::Instant::now();
        let stream = tokio::time::timeout(Duration::from_secs(5), race(vec![dead, working]))
            .await
            .expect("the race finished")
            .expect("the working address answered");
        assert_eq!(stream.peer_addr().expect("peer"), working);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn an_address_that_turns_the_connection_away_is_passed_over_for_the_next() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let working = listener.local_addr().expect("address");
        let closed = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let refusing = closed.local_addr().expect("address");
        drop(closed);
        let stream = race(vec![refusing, working])
            .await
            .expect("the working address answered");
        assert_eq!(stream.peer_addr().expect("peer"), working);
        assert!(race(vec![refusing]).await.is_err());
        assert!(race(Vec::new()).await.is_err());
    }

    // How fast a refused connect comes back depends on the system: Windows
    // tries a refused loopback port again for about a second. So the
    // attempts here fail when the test says, and the clock starts when the
    // first one fails.
    #[tokio::test]
    async fn an_address_that_turns_the_connection_away_lets_the_next_one_start_at_once() {
        type Moment = Arc<std::sync::Mutex<Option<std::time::Instant>>>;
        let refusing: SocketAddr = "192.0.2.1:443".parse().expect("address");
        let working: SocketAddr = "192.0.2.2:443".parse().expect("address");
        let (failed, started): (Moment, Moment) = (Arc::default(), Arc::default());
        let (failing, starting) = (Arc::clone(&failed), Arc::clone(&started));
        let reached = race_with(vec![refusing, working], move |address| {
            let (failing, starting) = (Arc::clone(&failing), Arc::clone(&starting));
            async move {
                let now = Some(std::time::Instant::now());
                if address == refusing {
                    *failing.lock().expect("failed") = now;
                    return Err(std::io::Error::from(std::io::ErrorKind::ConnectionRefused));
                }
                *starting.lock().expect("started") = now;
                Ok(address)
            }
        })
        .await
        .expect("the next address answered");
        assert_eq!(reached, working);
        let failed = failed
            .lock()
            .expect("failed")
            .expect("the first one failed");
        let started = started
            .lock()
            .expect("started")
            .expect("the next one started");
        let gap = started.duration_since(failed);
        assert!(
            gap < NEXT_ADDRESS_AFTER,
            "the next one started {gap:?} after"
        );
    }

    fn proxied_by(proxy: SocketAddr) -> Intercept {
        Matcher::builder()
            .all(format!("http://user:secret@{proxy}"))
            .build()
            .intercept(&http::Uri::from_static("https://uni.edu"))
            .expect("the proxy applies")
    }

    async fn answering_with(id: &'static str) -> SocketAddr {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        match stream.read(&mut byte).await {
                            Ok(0) | Err(_) => return,
                            Ok(_) => head.push(byte[0]),
                        }
                    }
                    let body = format!("{{\"server_id\":\"{id}\"}}");
                    let answer = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(answer.as_bytes()).await;
                });
            }
        });
        address
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_connection_through_a_proxy_tunnels_to_the_server() {
        let server_id = "0192f0c4-7a3e-7c2b-9d4e-5f6a7b8c9d0e";
        let upstream = answering_with(server_id).await;
        let (proxy, asked) =
            testing::connect_proxy("HTTP/1.1 200 Connection established\r\n\r\n", None).await;
        let mut stream = through_proxy(
            &proxied_by(proxy),
            &upstream.ip().to_string(),
            upstream.port(),
        )
        .await
        .expect("a tunnel");
        stream
            .write_all(
                b"GET /.well-known/oleafly-server HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n",
            )
            .await
            .expect("request");
        let mut answer = String::new();
        stream.read_to_string(&mut answer).await.expect("answer");
        assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
        assert!(answer.contains(server_id));
        let asked = asked.lock().expect("asked").clone();
        assert!(asked[0].starts_with(&format!("CONNECT {upstream} HTTP/1.1\r\n")));
        assert!(asked[0].contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
        let (refusing, _) =
            testing::connect_proxy("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n", None)
                .await;
        let refused = through_proxy(&proxied_by(refusing), "uni.edu", 443)
            .await
            .expect_err("the proxy said no");
        assert!(refused.to_string().contains("407"), "{refused}");
    }

    struct Looked(Arc<std::sync::Mutex<Option<HeaderMap>>>);

    impl Callback for Looked {
        fn on_request(
            self,
            request: &Request,
            response: Response,
        ) -> Result<Response, ErrorResponse> {
            *self.0.lock().expect("seen") = Some(request.headers().clone());
            Ok(response)
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn open_websocket_sends_the_given_headers_through_the_proxy() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let upstream = listener.local_addr().expect("address");
        let seen: Arc<std::sync::Mutex<Option<HeaderMap>>> = Arc::default();
        let kept = Arc::clone(&seen);
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(mut socket) =
                    tokio_tungstenite::accept_hdr_async(stream, Looked(kept)).await
                {
                    let _ = socket.next().await;
                }
            }
        });
        let (proxy, asked) = testing::connect_proxy(
            "HTTP/1.1 200 Connection established\r\n\r\n",
            Some(upstream),
        )
        .await;
        let mut headers = HeaderMap::new();
        headers.insert(
            http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer token-1"),
        );
        headers.insert("x-oleafly-check", HeaderValue::from_static("yes"));
        let target = Url::parse("ws://uni.edu/api/v1/socket").expect("url");
        let mut socket = open_through(&target, headers, || {
            Matcher::builder()
                .all(format!("http://user:secret@{proxy}"))
                .build()
        })
        .await
        .expect("a socket through the proxy");
        let _ = socket.close(None).await;
        let seen = seen
            .lock()
            .expect("seen")
            .clone()
            .expect("the server saw the upgrade");
        let header = |name: &str| seen.get(name).and_then(|value| value.to_str().ok());
        assert_eq!(header("authorization"), Some("Bearer token-1"));
        assert_eq!(header("x-oleafly-check"), Some("yes"));
        assert_eq!(header("host"), Some("uni.edu"));
        let asked = asked.lock().expect("asked").clone();
        assert!(
            asked[0].starts_with("CONNECT uni.edu:80 HTTP/1.1\r\n"),
            "{asked:?}"
        );
        assert!(asked[0].contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
    }

    #[test]
    fn only_remote_secure_sockets_go_through_the_proxy_and_no_proxy_is_honoured() {
        let matcher = Matcher::builder()
            .all("http://127.0.0.1:3128")
            .no("skip.example")
            .build();
        let url = |text: &str| Url::parse(text).expect("url");
        assert!(proxy_for(&url("wss://uni.edu/ws"), &matcher).is_some());
        assert!(proxy_for(&url("https://uni.edu/"), &matcher).is_some());
        assert!(proxy_for(&url("wss://skip.example/ws"), &matcher).is_none());
        assert!(proxy_for(&url("ws://127.0.0.1:8080/ws"), &matcher).is_none());
        assert!(proxy_for(&url("ws://[::1]:8080/ws"), &matcher).is_none());
        assert!(proxy_for(&url("wss://uni.edu/ws"), &Matcher::builder().build()).is_none());
    }
}
