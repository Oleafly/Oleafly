use std::sync::Arc;
use std::time::Duration;

use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, RefreshRequest, SessionTokens,
};
use oleafly_collab_protocol::ids::ServerId;

use super::{now_ms, ServerClient};
use crate::{CollabError, DeviceKey, SecretPort};

const REFRESH_MARGIN_MS: i64 = 60_000;
const REFRESH_ATTEMPTS: usize = 3;
const REFRESH_RETRY_DELAY: Duration = Duration::from_millis(300);

pub fn session_account(server: ServerId) -> String {
    format!("collab_session:{server}")
}

pub struct SessionManager {
    secrets: Arc<dyn SecretPort>,
    key: Arc<DeviceKey>,
    refresh: tokio::sync::Mutex<()>,
}

impl SessionManager {
    pub fn new(secrets: Arc<dyn SecretPort>, key: Arc<DeviceKey>) -> SessionManager {
        SessionManager {
            secrets,
            key,
            refresh: tokio::sync::Mutex::new(()),
        }
    }

    pub fn store(&self, server: ServerId, tokens: &SessionTokens) -> Result<(), CollabError> {
        let json = serde_json::to_string(tokens)
            .map_err(|error| CollabError::Corrupt(error.to_string()))?;
        self.secrets.set(&session_account(server), &json)
    }

    pub fn clear(&self, server: ServerId) -> Result<(), CollabError> {
        self.secrets.remove(&session_account(server))
    }

    pub fn tokens(&self, server: ServerId) -> Result<Option<SessionTokens>, CollabError> {
        match self.secrets.get(&session_account(server))? {
            Some(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|error| CollabError::Corrupt(error.to_string())),
            None => Ok(None),
        }
    }

    pub async fn access_token(
        &self,
        server: ServerId,
        client: &ServerClient,
    ) -> Result<String, CollabError> {
        self.renew(server, client, false).await
    }

    pub async fn force_refresh(
        &self,
        server: ServerId,
        client: &ServerClient,
    ) -> Result<String, CollabError> {
        self.renew(server, client, true).await
    }

    async fn renew(
        &self,
        server: ServerId,
        client: &ServerClient,
        force: bool,
    ) -> Result<String, CollabError> {
        let _guard = self.refresh.lock().await;
        let tokens = self.tokens(server)?.ok_or(CollabError::Unauthorized)?;
        if !force && tokens.access_expires_at - now_ms() >= REFRESH_MARGIN_MS {
            return Ok(tokens.access_token);
        }
        let mut attempt = 1;
        loop {
            match self.refresh_once(server, client, &tokens).await {
                Ok(fresh) => {
                    self.store(server, &fresh)?;
                    return Ok(fresh.access_token);
                }
                Err(error) if is_revocation(&error) => {
                    self.clear(server)?;
                    return Err(CollabError::Unauthorized);
                }
                Err(CollabError::Network(_)) if attempt < REFRESH_ATTEMPTS => {
                    attempt += 1;
                    tokio::time::sleep(REFRESH_RETRY_DELAY).await;
                }
                Err(error) => return Err(error),
            }
        }
    }

    async fn refresh_once(
        &self,
        server: ServerId,
        client: &ServerClient,
        tokens: &SessionTokens,
    ) -> Result<SessionTokens, CollabError> {
        let challenge = client.challenge().await?;
        let message = challenge_message(ChallengePurpose::Refresh, server, &challenge.nonce);
        let request = RefreshRequest {
            refresh_token: tokens.refresh_token.clone(),
            device_id: tokens.device_id,
            signature: self.key.sign_b64(&message),
            nonce: challenge.nonce,
        };
        client.refresh(&request).await
    }
}

fn is_revocation(error: &CollabError) -> bool {
    match error {
        CollabError::Unauthorized => true,
        CollabError::Api { code, .. } => code == "revoked" || code == "refresh_reused",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::ids::{AccountId, DeviceId};

    use super::*;
    use crate::client::test_util::{closed_url, device_key, signed_in_admin};
    use crate::MemorySecrets;

    fn tokens(access: &str, expires_at: i64) -> SessionTokens {
        SessionTokens {
            account_id: AccountId::new_v7(),
            device_id: DeviceId::new_v7(),
            access_token: access.to_string(),
            access_expires_at: expires_at,
            refresh_token: "refresh".to_string(),
        }
    }

    fn expiring(original: &SessionTokens, expires_at: i64) -> SessionTokens {
        SessionTokens {
            account_id: original.account_id,
            device_id: original.device_id,
            access_token: original.access_token.clone(),
            access_expires_at: expires_at,
            refresh_token: original.refresh_token.clone(),
        }
    }

    fn manager() -> (Arc<MemorySecrets>, SessionManager) {
        let secrets = Arc::new(MemorySecrets::default());
        let manager = SessionManager::new(secrets.clone(), Arc::new(device_key()));
        (secrets, manager)
    }

    #[test]
    fn sessions_live_under_the_server_account() {
        let (secrets, manager) = manager();
        let server = ServerId::new_v7();
        assert_eq!(session_account(server), format!("collab_session:{server}"));
        manager.store(server, &tokens("access", 1)).expect("store");
        assert!(secrets
            .get(&session_account(server))
            .expect("read")
            .is_some());
        assert_eq!(
            manager
                .tokens(server)
                .expect("read")
                .map(|stored| stored.access_token),
            Some("access".to_string())
        );
        manager.clear(server).expect("clear");
        assert!(secrets
            .get(&session_account(server))
            .expect("read")
            .is_none());
    }

    #[tokio::test]
    async fn fresh_token_is_used_without_contacting_the_server() {
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        manager
            .store(server, &tokens("still-fresh", now_ms() + 300_000))
            .expect("store");
        let client = ServerClient::new(closed_url().await).expect("client");
        assert_eq!(
            manager.access_token(server, &client).await.expect("token"),
            "still-fresh"
        );
    }

    #[tokio::test]
    async fn missing_session_is_unauthorized() {
        let (_secrets, manager) = manager();
        let client = ServerClient::new(closed_url().await).expect("client");
        assert!(matches!(
            manager.access_token(ServerId::new_v7(), &client).await,
            Err(CollabError::Unauthorized)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn token_near_expiry_is_refreshed_and_rotated() {
        let signed = signed_in_admin().await;
        let manager = SessionManager::new(Arc::new(MemorySecrets::default()), signed.key.clone());
        let server = signed.manifest.server_id;
        manager
            .store(server, &expiring(&signed.tokens, now_ms() + 30_000))
            .expect("store");
        let client = ServerClient::new(signed.url.clone()).expect("client");
        let access = manager
            .access_token(server, &client)
            .await
            .expect("refreshed");
        assert_ne!(access, signed.tokens.access_token);
        let stored = manager.tokens(server).expect("read").expect("session");
        assert_ne!(stored.refresh_token, signed.tokens.refresh_token);
        assert_eq!(stored.access_token, access);
        assert!(client.me(&access).await.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn revoked_session_is_cleared() {
        let signed = signed_in_admin().await;
        let secrets = Arc::new(MemorySecrets::default());
        let manager = SessionManager::new(secrets.clone(), signed.key.clone());
        let server = signed.manifest.server_id;
        manager.store(server, &signed.tokens).expect("store");
        let client = ServerClient::new(signed.url.clone()).expect("client");
        client
            .sign_out(&signed.tokens.access_token)
            .await
            .expect("server sign out");
        assert!(matches!(
            manager.force_refresh(server, &client).await,
            Err(CollabError::Unauthorized)
        ));
        assert!(secrets
            .get(&session_account(server))
            .expect("read")
            .is_none());
    }

    struct LossyRelay {
        url: crate::ServerUrl,
        drop_next_refresh: Arc<std::sync::atomic::AtomicBool>,
        refreshes: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl LossyRelay {
        async fn start(upstream: &crate::ServerUrl) -> LossyRelay {
            use std::sync::atomic::Ordering;
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let target = upstream.endpoint("/");
            let address = format!(
                "{}:{}",
                target.host_str().expect("host"),
                target.port_or_known_default().expect("port")
            );
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("bind");
            let port = listener.local_addr().expect("address").port();
            let drop_next_refresh = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let refreshes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let (dropping, counting) = (drop_next_refresh.clone(), refreshes.clone());
            tokio::spawn(async move {
                while let Ok((mut client, _)) = listener.accept().await {
                    let (address, dropping, counting) =
                        (address.clone(), dropping.clone(), counting.clone());
                    tokio::spawn(async move {
                        let mut request = Vec::new();
                        let mut buffer = [0u8; 8192];
                        let header_end = loop {
                            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                                break end + 4;
                            }
                            match client.read(&mut buffer).await {
                                Ok(0) | Err(_) => return,
                                Ok(count) => request.extend_from_slice(&buffer[..count]),
                            }
                        };
                        let head = String::from_utf8_lossy(&request[..header_end]).to_string();
                        let length = head
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.trim()
                                    .eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())?
                            })
                            .unwrap_or(0);
                        while request.len() < header_end + length {
                            match client.read(&mut buffer).await {
                                Ok(0) | Err(_) => return,
                                Ok(count) => request.extend_from_slice(&buffer[..count]),
                            }
                        }
                        let mut lines: Vec<&str> = head
                            .trim_end_matches("\r\n")
                            .split("\r\n")
                            .filter(|line| !line.to_ascii_lowercase().starts_with("connection:"))
                            .collect();
                        lines.push("Connection: close");
                        let mut forwarded = lines.join("\r\n").into_bytes();
                        forwarded.extend_from_slice(b"\r\n\r\n");
                        forwarded.extend_from_slice(&request[header_end..]);
                        let Ok(mut server) = tokio::net::TcpStream::connect(address).await else {
                            return;
                        };
                        if server.write_all(&forwarded).await.is_err() {
                            return;
                        }
                        let mut response = Vec::new();
                        if server.read_to_end(&mut response).await.is_err() {
                            return;
                        }
                        let is_refresh = head.starts_with("POST ")
                            && head
                                .lines()
                                .next()
                                .is_some_and(|line| line.contains("/auth/refresh "));
                        if is_refresh {
                            counting.fetch_add(1, Ordering::SeqCst);
                            if dropping.swap(false, Ordering::SeqCst) {
                                return;
                            }
                        }
                        let _ = client.write_all(&response).await;
                        let _ = client.shutdown().await;
                    });
                }
            });
            LossyRelay {
                url: crate::ServerUrl::parse(&format!("http://127.0.0.1:{port}"))
                    .expect("relay url"),
                drop_next_refresh,
                refreshes,
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refresh_reply_lost_in_transit_is_retried_and_keeps_the_session() {
        use std::sync::atomic::Ordering;
        let signed = signed_in_admin().await;
        let relay = LossyRelay::start(&signed.url).await;
        relay.drop_next_refresh.store(true, Ordering::SeqCst);
        let client = ServerClient::new(relay.url.clone()).expect("client");
        let secrets = Arc::new(MemorySecrets::default());
        let manager = SessionManager::new(secrets, signed.key.clone());
        let server = signed.manifest.server_id;
        manager
            .store(server, &expiring(&signed.tokens, 0))
            .expect("store");
        let access = manager
            .access_token(server, &client)
            .await
            .expect("the session survives a lost refresh reply");
        assert_ne!(access, signed.tokens.access_token);
        assert!(relay.refreshes.load(Ordering::SeqCst) >= 2);
        let stored = manager.tokens(server).expect("read").expect("stored");
        assert_ne!(stored.refresh_token, signed.tokens.refresh_token);
        client.me(&access).await.expect("still signed in");
    }
}
