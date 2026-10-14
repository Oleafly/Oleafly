use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use oleafly_collab_protocol::auth::{
    challenge_message, ApiError, ChallengePurpose, SessionEndReason,
};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use rustls::pki_types::CertificateDer;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
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
        TcpStream::connect((host.as_str(), port)).await
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, attempt).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(error)) => Err(CollabError::Network(error.to_string())),
        Err(_) => Err(CollabError::Network(
            "connecting to the server timed out".to_string(),
        )),
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
