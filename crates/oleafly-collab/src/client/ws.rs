use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use hyper_util::client::proxy::matcher::{Intercept, Matcher};
use oleafly_collab_protocol::auth::{
    challenge_message, ApiError, ChallengePurpose, SessionEndReason,
};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use rustls::pki_types::CertificateDer;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

use super::{ServerUrl, CONNECT_TIMEOUT};
use crate::{CollabError, DeviceKey};

const FRAME_TIMEOUT: Duration = Duration::from_secs(10);
// The server's own limit: an 8 MiB change in base64 with its envelope fits.
pub(crate) const MAX_MESSAGE_BYTES: usize = 12 * 1024 * 1024;

fn socket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES))
}

pub(crate) type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct SocketConnection {
    socket: Socket,
    account_id: AccountId,
    protocol: u32,
    next_ping: u64,
}

pub async fn connect_socket(
    url: &ServerUrl,
    server_id: ServerId,
    access_token: &str,
    device_id: DeviceId,
    key: &DeviceKey,
) -> Result<SocketConnection, CollabError> {
    let mut socket = open_socket(url, Some(access_token)).await?;
    let nonce = match next_frame(&mut socket).await? {
        ServerFrame::Challenge {
            nonce,
            server_id: found,
        } if found == server_id => nonce,
        ServerFrame::Challenge {
            server_id: found, ..
        } => {
            return Err(CollabError::ServerChanged {
                expected: server_id,
                found,
            })
        }
        other => return Err(frame_error(other)),
    };
    let message = challenge_message(ChallengePurpose::Socket, server_id, &nonce);
    let hello = ClientFrame::Hello {
        protocol: PROTOCOL_VERSION,
        device_id,
        access_token: access_token.to_string(),
        signature: key.sign_b64(&message),
        nonce,
        understands: crate::sync::UNDERSTOOD_CODES.to_vec(),
    };
    send_frame(&mut socket, &hello).await?;
    match next_frame(&mut socket).await? {
        ServerFrame::Welcome {
            protocol,
            account_id,
        } => Ok(SocketConnection {
            socket,
            account_id,
            protocol,
            next_ping: 1,
        }),
        other => Err(frame_error(other)),
    }
}

impl SocketConnection {
    pub fn account_id(&self) -> AccountId {
        self.account_id
    }

    pub fn protocol(&self) -> u32 {
        self.protocol
    }

    pub async fn ping(&mut self) -> Result<(), CollabError> {
        let id = self.next_ping;
        self.next_ping += 1;
        send_frame(&mut self.socket, &ClientFrame::Ping { id }).await?;
        loop {
            match next_frame(&mut self.socket).await? {
                ServerFrame::Pong { id: answered } if answered == id => return Ok(()),
                ServerFrame::Pong { .. } => {}
                other => return Err(frame_error(other)),
            }
        }
    }

    pub(crate) fn into_socket(self) -> Socket {
        self.socket
    }

    pub async fn close(mut self) {
        let _ = self.socket.close(None).await;
    }
}

pub(crate) async fn open_socket(
    url: &ServerUrl,
    access: Option<&str>,
) -> Result<Socket, CollabError> {
    let target = url.websocket();
    let mut request = target.as_str().into_client_request().map_err(ws_error)?;
    if let Some(access) = access {
        let bearer = HeaderValue::from_str(&format!("Bearer {access}"))
            .map_err(|_| CollabError::Unauthorized)?;
        request.headers_mut().insert(AUTHORIZATION, bearer);
    }
    let stream = connect_tcp(&target).await?;
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
    match tokio::time::timeout(FRAME_TIMEOUT, handshake).await {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(error)) => Err(ws_error(error)),
        Err(_) => Err(CollabError::Network(
            "the WebSocket upgrade timed out".to_string(),
        )),
    }
}

// Connects the way the HTTPS client does: through the proxy the system or
// HTTPS_PROXY names (with a CONNECT tunnel, honouring NO_PROXY), and racing
// the server's addresses so a dead IPv6 route falls back to IPv4 quickly.
pub(crate) async fn connect_tcp(target: &::url::Url) -> Result<TcpStream, CollabError> {
    let host = target
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = target
        .port_or_known_default()
        .ok_or_else(|| CollabError::Network("the address has no port".to_string()))?;
    let attempt = async {
        #[cfg(feature = "e2e-hooks")]
        if let Some(address) = super::e2e_route::route_for(&host) {
            return TcpStream::connect(address).await;
        }
        match proxy_for(target, &Matcher::from_system()) {
            Some(proxy) => through_proxy(&proxy, &host, port).await,
            None => connect_host(&host, port).await,
        }
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, attempt).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(error)) => Err(CollabError::Network(error.to_string())),
        Err(_) => Err(CollabError::Network(
            "connecting to the server timed out".to_string(),
        )),
    }
}

const NEXT_ADDRESS_AFTER: Duration = Duration::from_millis(250);
const PROXY_ANSWER_BYTES: usize = 8 * 1024;

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

async fn race(addresses: Vec<SocketAddr>) -> std::io::Result<TcpStream> {
    if addresses.is_empty() {
        return Err(std::io::Error::other(
            "the server's address did not resolve",
        ));
    }
    let attempts = interleaved(addresses)
        .into_iter()
        .enumerate()
        .map(|(index, address)| {
            Box::pin(async move {
                let wait =
                    NEXT_ADDRESS_AFTER.saturating_mul(u32::try_from(index).unwrap_or(u32::MAX));
                tokio::time::sleep(wait).await;
                TcpStream::connect(address).await
            })
        });
    futures_util::future::select_ok(attempts)
        .await
        .map(|(stream, _)| stream)
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

fn proxy_for(target: &::url::Url, matcher: &Matcher) -> Option<Intercept> {
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

fn tls_config() -> Result<Arc<rustls::ClientConfig>, CollabError> {
    let roots = root_store(rustls_native_certs::load_native_certs());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|error| CollabError::Crypto(error.to_string()))?
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

pub(crate) async fn send_frame(
    socket: &mut Socket,
    frame: &ClientFrame,
) -> Result<(), CollabError> {
    let text =
        serde_json::to_string(frame).map_err(|error| CollabError::Network(error.to_string()))?;
    socket.send(Message::text(text)).await.map_err(ws_error)
}

async fn next_frame(socket: &mut Socket) -> Result<ServerFrame, CollabError> {
    match tokio::time::timeout(FRAME_TIMEOUT, read_frame(socket)).await {
        Ok(frame) => frame,
        Err(_) => Err(CollabError::Network(
            "the server did not answer in time".to_string(),
        )),
    }
}

pub(crate) async fn read_frame(socket: &mut Socket) -> Result<ServerFrame, CollabError> {
    while let Some(message) = socket.next().await {
        match message.map_err(ws_error)? {
            Message::Text(text) => match ServerFrame::from_json(text.as_str()) {
                Ok(ServerFrame::Unknown) => {}
                read => {
                    return read.map_err(|error| {
                        CollabError::Network(format!("unreadable frame: {error}"))
                    })
                }
            },
            Message::Close(_) => break,
            _ => {}
        }
    }
    Err(CollabError::Network(
        "the server closed the connection".to_string(),
    ))
}

pub(crate) fn frame_error(frame: ServerFrame) -> CollabError {
    match frame {
        ServerFrame::SessionRevoked {
            reason:
                Some(reason @ (SessionEndReason::AccountSuspended | SessionEndReason::AccessEnded)),
        } => CollabError::SessionEnded(reason),
        ServerFrame::SessionRevoked { .. }
        | ServerFrame::Error {
            code: FrameErrorCode::Unauthorized,
            ..
        } => CollabError::Unauthorized,
        ServerFrame::Error { code, message } => {
            let (status, name) = match code {
                FrameErrorCode::ProtocolMismatch => (426, "protocol_mismatch"),
                FrameErrorCode::RateLimited => (429, "rate_limited"),
                FrameErrorCode::BadFrame => (400, "bad_frame"),
                FrameErrorCode::Forbidden => (403, "forbidden"),
                FrameErrorCode::CommentsOff => (403, "comments_off"),
                FrameErrorCode::NotFound => (404, "not_found"),
                FrameErrorCode::TooLarge => (413, "too_large"),
                FrameErrorCode::Internal
                | FrameErrorCode::Unauthorized
                | FrameErrorCode::Unknown => (500, "internal"),
            };
            CollabError::Api {
                status,
                code: name.to_string(),
                message,
            }
        }
        _ => CollabError::Network("the server sent an unexpected frame".to_string()),
    }
}

fn ws_error(error: WsError) -> CollabError {
    match error {
        WsError::Http(response) => {
            let status = response.status().as_u16();
            let said = response
                .body()
                .as_deref()
                .and_then(|body| serde_json::from_slice::<ApiError>(body).ok());
            match said {
                Some(error) if status == 401 => match SessionEndReason::from_code(&error.code) {
                    Some(reason) => CollabError::SessionEnded(reason),
                    None => CollabError::Unauthorized,
                },
                _ => CollabError::Api {
                    status,
                    code: "websocket_refused".to_string(),
                    message: "the server refused the WebSocket upgrade".to_string(),
                },
            }
        }
        other => CollabError::Network(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::test_util::{
        device_key, http_response, refusal_with, signed_in_admin, UpgradeFront,
    };

    #[test]
    fn tls_config_builds_on_the_ring_provider() {
        assert!(tls_config().is_ok());
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn hello_is_welcomed_and_pings_are_answered() {
        let signed = signed_in_admin().await;
        let mut socket = connect_socket(
            &signed.url,
            signed.manifest.server_id,
            &signed.tokens.access_token,
            signed.tokens.device_id,
            &signed.key,
        )
        .await
        .expect("socket");
        assert_eq!(socket.account_id(), signed.tokens.account_id);
        assert_eq!(socket.protocol(), PROTOCOL_VERSION);
        socket.ping().await.expect("first pong");
        socket.ping().await.expect("second pong");
        socket.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bad_token_is_unauthorized() {
        let signed = signed_in_admin().await;
        let result = connect_socket(
            &signed.url,
            signed.manifest.server_id,
            "not-a-token",
            signed.tokens.device_id,
            &signed.key,
        )
        .await;
        assert!(matches!(result, Err(CollabError::Unauthorized)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn signature_from_another_device_is_unauthorized() {
        let signed = signed_in_admin().await;
        let result = connect_socket(
            &signed.url,
            signed.manifest.server_id,
            &signed.tokens.access_token,
            signed.tokens.device_id,
            &device_key(),
        )
        .await;
        assert!(matches!(result, Err(CollabError::Unauthorized)));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_challenge_from_another_server_gets_no_token() {
        let signed = signed_in_admin().await;
        let expected = oleafly_collab_protocol::ids::ServerId::new_v7();
        let result = connect_socket(
            &signed.url,
            expected,
            &signed.tokens.access_token,
            signed.tokens.device_id,
            &signed.key,
        )
        .await;
        assert!(matches!(
            result,
            Err(CollabError::ServerChanged { expected: e, found: f })
                if e == expected && f == signed.manifest.server_id
        ));
    }

    fn bearer_of(head: &str) -> Option<&str> {
        head.lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.trim().eq_ignore_ascii_case("authorization"))
            .map(|(_, value)| value.trim())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_upgrade_carries_the_access_token() {
        let signed = signed_in_admin().await;
        let front = UpgradeFront::start(&signed.url, None).await;
        let socket = connect_socket(
            &front.url,
            signed.manifest.server_id,
            &signed.tokens.access_token,
            signed.tokens.device_id,
            &signed.key,
        )
        .await
        .expect("socket");
        socket.close().await;
        let upgrades = front.upgrades();
        assert_eq!(upgrades.len(), 1);
        assert_eq!(
            bearer_of(&upgrades[0]),
            Some(format!("Bearer {}", signed.tokens.access_token).as_str())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn only_the_servers_own_401_on_the_upgrade_means_the_session_is_gone() {
        let signed = signed_in_admin().await;
        let connect = |front: UpgradeFront| {
            let signed = &signed;
            async move {
                connect_socket(
                    &front.url,
                    signed.manifest.server_id,
                    &signed.tokens.access_token,
                    signed.tokens.device_id,
                    &signed.key,
                )
                .await
                .map(|_| ())
            }
        };
        let refused = UpgradeFront::start(
            &signed.url,
            Some(refusal_with("401 Unauthorized", "unauthorized")),
        )
        .await;
        assert_eq!(connect(refused).await, Err(CollabError::Unauthorized));
        let suspended = UpgradeFront::start(
            &signed.url,
            Some(refusal_with("401 Unauthorized", "account_suspended")),
        )
        .await;
        assert_eq!(
            connect(suspended).await,
            Err(CollabError::SessionEnded(
                SessionEndReason::AccountSuspended
            ))
        );
        let bare = UpgradeFront::start(
            &signed.url,
            Some(http_response("401 Unauthorized", &[], "")),
        )
        .await;
        assert!(matches!(
            connect(bare).await,
            Err(CollabError::Api { status: 401, ref code, .. }) if code == "websocket_refused"
        ));
    }

    async fn sending(message: String) -> ServerUrl {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await {
                    let _ = socket.send(Message::text(message)).await;
                    let _ = socket.next().await;
                }
            }
        });
        ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("address")
    }

    fn padded_pong(bytes: usize) -> String {
        let mut text = String::from(r#"{"type":"pong","id":7,"x":""#);
        text.push_str(&"0".repeat(bytes.saturating_sub(text.len() + 2)));
        text.push_str("\"}");
        text
    }

    #[tokio::test]
    async fn a_message_over_the_servers_own_limit_closes_the_socket_before_it_is_read() {
        let fits = padded_pong(MAX_MESSAGE_BYTES - 1024);
        let mut socket = open_socket(&sending(fits).await, None)
            .await
            .expect("socket");
        assert_eq!(
            read_frame(&mut socket).await,
            Ok(ServerFrame::Pong { id: 7 })
        );
        let over = padded_pong(MAX_MESSAGE_BYTES + 1024);
        let mut socket = open_socket(&sending(over).await, None)
            .await
            .expect("socket");
        let refused = read_frame(&mut socket).await;
        assert!(
            matches!(refused, Err(CollabError::Network(ref message)) if message.contains("Message too long")),
            "{refused:?}"
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

    async fn connect_proxy(
        answer: &'static str,
    ) -> (SocketAddr, Arc<std::sync::Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
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
                    let target = head
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or_default()
                        .to_owned();
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

    fn proxied_by(proxy: SocketAddr) -> Intercept {
        Matcher::builder()
            .all(format!("http://user:secret@{proxy}"))
            .build()
            .intercept(&http::Uri::from_static("https://uni.edu"))
            .expect("the proxy applies")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_connection_through_a_proxy_tunnels_to_the_server() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let server = oleafly_server::test_support::TestServer::start(
            oleafly_server::test_support::test_config(),
        )
        .await;
        let upstream: SocketAddr = server
            .url()
            .trim_start_matches("http://")
            .parse()
            .expect("server address");
        let (proxy, asked) = connect_proxy("HTTP/1.1 200 Connection established\r\n\r\n").await;
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
        assert!(answer.contains(&server.state().server_id.to_string()));
        let asked = asked.lock().expect("asked").clone();
        assert!(asked[0].starts_with(&format!("CONNECT {upstream} HTTP/1.1\r\n")));
        assert!(asked[0].contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
        let (refusing, _) =
            connect_proxy("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n").await;
        let refused = through_proxy(&proxied_by(refusing), "uni.edu", 443)
            .await
            .expect_err("the proxy said no");
        assert!(refused.to_string().contains("407"), "{refused}");
    }

    #[test]
    fn only_remote_secure_sockets_go_through_the_proxy_and_no_proxy_is_honoured() {
        let matcher = Matcher::builder()
            .all("http://127.0.0.1:3128")
            .no("skip.example")
            .build();
        let url = |text: &str| ::url::Url::parse(text).expect("url");
        assert!(proxy_for(&url("wss://uni.edu/ws"), &matcher).is_some());
        assert!(proxy_for(&url("https://uni.edu/"), &matcher).is_some());
        assert!(proxy_for(&url("wss://skip.example/ws"), &matcher).is_none());
        assert!(proxy_for(&url("ws://127.0.0.1:8080/ws"), &matcher).is_none());
        assert!(proxy_for(&url("ws://[::1]:8080/ws"), &matcher).is_none());
        assert!(proxy_for(&url("wss://uni.edu/ws"), &Matcher::builder().build()).is_none());
    }

    #[test]
    fn a_revoked_session_that_says_why_keeps_the_reason() {
        assert_eq!(
            frame_error(ServerFrame::SessionRevoked {
                reason: Some(SessionEndReason::AccessEnded)
            }),
            CollabError::SessionEnded(SessionEndReason::AccessEnded)
        );
        assert_eq!(
            frame_error(ServerFrame::SessionRevoked { reason: None }),
            CollabError::Unauthorized
        );
        assert_eq!(
            frame_error(ServerFrame::SessionRevoked {
                reason: Some(SessionEndReason::Unknown)
            }),
            CollabError::Unauthorized
        );
    }
}
