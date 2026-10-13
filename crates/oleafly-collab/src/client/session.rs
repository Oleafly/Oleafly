use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, RefreshRequest, SessionTokens,
};
use oleafly_collab_protocol::ids::ServerId;
use reqwest::header::{HeaderMap, DATE};

use super::http::{check_status, network_error};
use super::{now_ms, ServerClient};
use crate::device_key::server_key_account;
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
    server_keys: Mutex<HashMap<ServerId, Arc<DeviceKey>>>,
    refresh: tokio::sync::Mutex<()>,
    server_clocks: Mutex<HashMap<ServerId, i64>>,
}

impl SessionManager {
    pub fn new(secrets: Arc<dyn SecretPort>, key: Arc<DeviceKey>) -> SessionManager {
        SessionManager {
            secrets,
            key,
            server_keys: Mutex::new(HashMap::new()),
            refresh: tokio::sync::Mutex::new(()),
            server_clocks: Mutex::new(HashMap::new()),
        }
    }

    pub fn device_key(&self, server: ServerId) -> Result<Arc<DeviceKey>, CollabError> {
        if let Some(known) = self
            .server_keys
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&server)
        {
            return Ok(Arc::clone(known));
        }
        let key = match DeviceKey::load(self.secrets.as_ref(), &server_key_account(server))? {
            Some(own) => Arc::new(own),
            None => Arc::clone(&self.key),
        };
        self.server_keys
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(server, Arc::clone(&key));
        Ok(key)
    }

    pub fn renew_device_key(&self, server: ServerId) -> Result<Arc<DeviceKey>, CollabError> {
        let key = Arc::new(DeviceKey::create(
            self.secrets.as_ref(),
            &server_key_account(server),
        )?);
        self.server_keys
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(server, Arc::clone(&key));
        Ok(key)
    }

    pub fn sign_out(&self, server: ServerId) -> Result<(), CollabError> {
        self.clear(server)?;
        self.renew_device_key(server).map(|_| ())
    }

    fn server_now(&self, server: ServerId) -> i64 {
        let offset = self
            .server_clocks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&server)
            .copied()
            .unwrap_or(0);
        now_ms() + offset
    }

    fn learn_server_clock(&self, server: ServerId, server_ms: i64) {
        self.server_clocks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(server, server_ms - now_ms());
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
        if !force && tokens.access_expires_at - self.server_now(server) >= REFRESH_MARGIN_MS {
            return Ok(tokens.access_token);
        }
        let mut attempt = 1;
        loop {
            match self.refresh_once(server, client, &tokens).await {
                Ok(fresh) => {
                    self.store(server, &fresh)?;
                    return Ok(fresh.access_token);
                }
                Err(CollabError::SessionEnded(reason)) => {
                    self.clear(server)?;
                    return Err(CollabError::SessionEnded(reason));
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
            signature: self.device_key(server)?.sign_b64(&message),
            nonce: challenge.nonce,
        };
        let (tokens, server_ms) = post_refresh(client, &request).await?;
        if let Some(server_ms) = server_ms {
            self.learn_server_clock(server, server_ms);
        }
        Ok(tokens)
    }
}

async fn post_refresh(
    client: &ServerClient,
    request: &RefreshRequest,
) -> Result<(SessionTokens, Option<i64>), CollabError> {
    let response = client
        .http()
        .post(client.url().endpoint("auth/refresh"))
        .json(request)
        .send()
        .await
        .map_err(network_error)?;
    let response = check_status(response).await?;
    let server_ms = server_time(response.headers());
    let status = response.status().as_u16();
    let body = response.bytes().await.map_err(network_error)?;
    let tokens = serde_json::from_slice(&body).map_err(|error| CollabError::Api {
        status,
        code: "invalid_response".to_string(),
        message: error.to_string(),
    })?;
    Ok((tokens, server_ms))
}

fn server_time(headers: &HeaderMap) -> Option<i64> {
    headers
        .get(DATE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| httpdate::parse_http_date(value).ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
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

    #[test]
    fn signing_out_of_a_server_gives_the_next_sign_in_there_a_new_device_key() {
        let secrets = Arc::new(MemorySecrets::default());
        let shared = Arc::new(device_key());
        let manager = SessionManager::new(secrets.clone(), Arc::clone(&shared));
        let (server, other) = (ServerId::new_v7(), ServerId::new_v7());
        assert_eq!(
            manager.device_key(server).expect("key").public_key(),
            shared.public_key()
        );
        manager.store(server, &tokens("access", 1)).expect("store");
        manager.sign_out(server).expect("sign out");
        assert!(manager.tokens(server).expect("read").is_none());
        let fresh = manager.device_key(server).expect("key");
        assert_ne!(fresh.public_key(), shared.public_key());
        assert_eq!(
            manager.device_key(other).expect("key").public_key(),
            shared.public_key()
        );
        let after_restart = SessionManager::new(secrets, Arc::new(device_key()));
        assert_eq!(
            after_restart.device_key(server).expect("key").public_key(),
            fresh.public_key()
        );
    }

    #[test]
    fn a_session_the_server_ended_keeps_its_device_key() {
        let secrets = Arc::new(MemorySecrets::default());
        let shared = Arc::new(device_key());
        let manager = SessionManager::new(secrets, Arc::clone(&shared));
        let server = ServerId::new_v7();
        manager.store(server, &tokens("access", 1)).expect("store");
        manager.clear(server).expect("clear");
        assert_eq!(
            manager.device_key(server).expect("key").public_key(),
            shared.public_key()
        );
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

    async fn answering(
        server_now: i64,
        original: &SessionTokens,
        access: &str,
    ) -> crate::ServerUrl {
        use crate::client::test_util::{canned, http_response};
        let date = httpdate::fmt_http_date(
            std::time::UNIX_EPOCH + Duration::from_millis(server_now as u64),
        );
        let body = serde_json::json!({
            "nonce": "nonce",
            "expires_at": server_now + 120_000,
            "account_id": original.account_id,
            "device_id": original.device_id,
            "access_token": access,
            "access_expires_at": server_now + 600_000,
            "refresh_token": format!("{access}-refresh"),
        })
        .to_string();
        canned(http_response(
            "200 OK",
            &[("Date", &date), ("Content-Type", "application/json")],
            &body,
        ))
        .await
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_clock_running_ahead_of_the_server_does_not_refresh_on_every_call() {
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        let server_now = now_ms() - 9 * 60_000 - 30_000;
        let original = tokens("stale", 0);
        manager.store(server, &original).expect("store");
        let online =
            ServerClient::new(answering(server_now, &original, "fresh").await).expect("client");
        assert_eq!(
            manager.access_token(server, &online).await.expect("token"),
            "fresh"
        );
        let offline = ServerClient::new(closed_url().await).expect("client");
        assert_eq!(
            manager
                .access_token(server, &offline)
                .await
                .expect("a token issued a moment ago is still good"),
            "fresh"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_clock_running_behind_the_server_refreshes_before_the_server_expires_the_token() {
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        let original = tokens("stale", 0);
        manager.store(server, &original).expect("store");
        let server_now = now_ms() + 9 * 60_000 + 30_000;
        let first =
            ServerClient::new(answering(server_now, &original, "first").await).expect("client");
        assert_eq!(
            manager.access_token(server, &first).await.expect("token"),
            "first"
        );
        let mut nearly_expired = manager.tokens(server).expect("read").expect("stored");
        nearly_expired.access_expires_at = server_now + 30_000;
        manager.store(server, &nearly_expired).expect("store");
        let second =
            ServerClient::new(answering(server_now, &original, "second").await).expect("client");
        assert_eq!(
            manager.access_token(server, &second).await.expect("token"),
            "second"
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refresh_for_a_suspended_account_says_so_and_clears_the_session() {
        let pair = crate::client::test_util::two_people().await;
        let client = ServerClient::new(pair.url.clone()).expect("client");
        client
            .admin_patch_member(
                &pair.bob.tokens.access_token,
                pair.alice.tokens.account_id,
                &oleafly_collab_protocol::admin::MemberPatch {
                    role: None,
                    status: Some(oleafly_collab_protocol::admin::MemberStatus::Suspended),
                },
            )
            .await
            .expect("suspend alice");
        assert_eq!(
            pair.alice
                .sessions
                .force_refresh(pair.server_id, &client)
                .await
                .err(),
            Some(CollabError::SessionEnded(
                oleafly_collab_protocol::auth::SessionEndReason::AccountSuspended
            ))
        );
        assert!(pair
            .alice
            .sessions
            .tokens(pair.server_id)
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
