use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, RefreshRequest, SessionTokens,
};
use oleafly_collab_protocol::ids::ServerId;
use reqwest::header::{HeaderMap, DATE};

use super::http::{check_status, network_error, SESSION_GONE};
use super::{now_ms, ServerClient};
use crate::device_key::server_key_account;
use crate::{CollabError, DeviceKey, SecretPort};

const REFRESH_MARGIN_MS: i64 = 60_000;
const REFRESH_ATTEMPTS: usize = 3;
const REFRESH_RETRY_DELAY: Duration = Duration::from_millis(300);

pub fn session_account(server: ServerId) -> String {
    format!("collab_session:{server}")
}

#[derive(Clone, Copy)]
enum Renewal<'a> {
    IfStale,
    Always,
    Replacing(&'a str),
}

impl Renewal<'_> {
    // Whether a good token in `now` will do instead of a refresh. A forced
    // refresh takes only a token another caller got while this one waited.
    fn takes(self, seen: &SessionTokens, now: &SessionTokens) -> bool {
        match self {
            Renewal::IfStale => true,
            Renewal::Always => now.access_token != seen.access_token,
            Renewal::Replacing(rejected) => now.access_token != rejected,
        }
    }
}

pub struct SessionManager {
    secrets: Arc<dyn SecretPort>,
    key: Arc<DeviceKey>,
    server_keys: Mutex<HashMap<ServerId, Arc<DeviceKey>>>,
    refreshing: Mutex<HashMap<ServerId, Arc<tokio::sync::Mutex<()>>>>,
    server_clocks: Mutex<HashMap<ServerId, i64>>,
}

impl SessionManager {
    pub fn new(secrets: Arc<dyn SecretPort>, key: Arc<DeviceKey>) -> SessionManager {
        SessionManager {
            secrets,
            key,
            server_keys: Mutex::new(HashMap::new()),
            refreshing: Mutex::new(HashMap::new()),
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

    // Reads the stored session off the async workers: the secret store can
    // wait on a file lock held by another process.
    async fn stored(&self, server: ServerId) -> Result<Option<SessionTokens>, CollabError> {
        let secrets = Arc::clone(&self.secrets);
        let json = tokio::task::spawn_blocking(move || secrets.get(&session_account(server)))
            .await
            .map_err(|error| CollabError::Secret(error.to_string()))??;
        json.map(|json| {
            serde_json::from_str(&json).map_err(|error| CollabError::Corrupt(error.to_string()))
        })
        .transpose()
    }

    // Writes the stored session off the async workers, for the same reason.
    async fn kept(
        &self,
        server: ServerId,
        tokens: Option<SessionTokens>,
    ) -> Result<(), CollabError> {
        let secrets = Arc::clone(&self.secrets);
        tokio::task::spawn_blocking(move || match tokens {
            Some(tokens) => {
                let json = serde_json::to_string(&tokens)
                    .map_err(|error| CollabError::Corrupt(error.to_string()))?;
                secrets.set(&session_account(server), &json)
            }
            None => secrets.remove(&session_account(server)),
        })
        .await
        .map_err(|error| CollabError::Secret(error.to_string()))?
    }

    fn fresh(&self, server: ServerId, tokens: &SessionTokens) -> bool {
        tokens.access_expires_at - self.server_now(server) >= REFRESH_MARGIN_MS
    }

    fn refresh_lock(&self, server: ServerId) -> Arc<tokio::sync::Mutex<()>> {
        Arc::clone(
            self.refreshing
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .entry(server)
                .or_default(),
        )
    }

    pub async fn access_token(
        &self,
        server: ServerId,
        client: &ServerClient,
    ) -> Result<String, CollabError> {
        self.renew(server, client, Renewal::IfStale).await
    }

    pub async fn force_refresh(
        &self,
        server: ServerId,
        client: &ServerClient,
    ) -> Result<String, CollabError> {
        self.renew(server, client, Renewal::Always).await
    }

    // For a caller the server turned away with `rejected`: a good token
    // other than that one, say one another connection got meanwhile, is
    // returned as it is instead of being rotated again.
    pub async fn refresh_rejected(
        &self,
        server: ServerId,
        client: &ServerClient,
        rejected: &str,
    ) -> Result<String, CollabError> {
        self.renew(server, client, Renewal::Replacing(rejected))
            .await
    }

    async fn renew(
        &self,
        server: ServerId,
        client: &ServerClient,
        renewal: Renewal<'_>,
    ) -> Result<String, CollabError> {
        // A good token needs no lock, and each server refreshes under its
        // own, so a refresh that hangs on one server holds up nobody else.
        let seen = self
            .stored(server)
            .await?
            .ok_or(CollabError::Unauthorized)?;
        if renewal.takes(&seen, &seen) && self.fresh(server, &seen) {
            return Ok(seen.access_token);
        }
        let lock = self.refresh_lock(server);
        let _guard = lock.lock().await;
        let tokens = self
            .stored(server)
            .await?
            .ok_or(CollabError::Unauthorized)?;
        if renewal.takes(&seen, &tokens) && self.fresh(server, &tokens) {
            return Ok(tokens.access_token);
        }
        let mut attempt = 1;
        let mut fresh_check = false;
        loop {
            match self.refresh_once(server, client, &tokens).await {
                Ok(fresh) => {
                    let access = fresh.access_token.clone();
                    self.kept(server, Some(fresh)).await?;
                    return Ok(access);
                }
                Err(CollabError::SessionEnded(reason)) => {
                    self.kept(server, None).await?;
                    return Err(CollabError::SessionEnded(reason));
                }
                Err(error) if is_revocation(&error) => {
                    self.kept(server, None).await?;
                    return Err(CollabError::Unauthorized);
                }
                // The check expires two minutes after it is handed out, by
                // the server's clock: a laptop that slept in between needs
                // one new check, not a new sign-in.
                Err(error) if nonce_expired(&error) && !fresh_check => fresh_check = true,
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
        CollabError::Api {
            status: 401, code, ..
        } => SESSION_GONE.contains(&code.as_str()),
        _ => false,
    }
}

fn nonce_expired(error: &CollabError) -> bool {
    matches!(error, CollabError::Api { status: 401, code, .. } if code == "expired_nonce")
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

    async fn silent() -> (crate::ServerUrl, Arc<tokio::sync::Notify>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("address").port();
        let reached = Arc::new(tokio::sync::Notify::new());
        let signal = Arc::clone(&reached);
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((stream, _)) = listener.accept().await {
                held.push(stream);
                signal.notify_one();
            }
        });
        let url = crate::ServerUrl::parse(&format!("http://127.0.0.1:{port}")).expect("url");
        (url, reached)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refresh_that_hangs_on_one_server_holds_up_no_other_server() {
        let (_secrets, manager) = manager();
        let manager = Arc::new(manager);
        let (stuck, fine, renewing) = (ServerId::new_v7(), ServerId::new_v7(), ServerId::new_v7());
        manager.store(stuck, &tokens("stale", 0)).expect("store");
        manager
            .store(fine, &tokens("good", now_ms() + 300_000))
            .expect("store");
        let original = tokens("old", 0);
        manager.store(renewing, &original).expect("store");
        let (url, reached) = silent().await;
        let hanging = {
            let manager = Arc::clone(&manager);
            let client = ServerClient::new(url).expect("client");
            tokio::spawn(async move { manager.access_token(stuck, &client).await })
        };
        reached.notified().await;
        let offline = ServerClient::new(closed_url().await).expect("client");
        let good =
            tokio::time::timeout(Duration::from_secs(2), manager.access_token(fine, &offline))
                .await
                .expect("a good token is not held up")
                .expect("token");
        assert_eq!(good, "good");
        let answering =
            ServerClient::new(answering(now_ms(), &original, "renewed").await).expect("client");
        let renewed = tokio::time::timeout(
            Duration::from_secs(5),
            manager.force_refresh(renewing, &answering),
        )
        .await
        .expect("another server's refresh is not held up")
        .expect("token");
        assert_eq!(renewed, "renewed");
        assert!(!hanging.is_finished());
        hanging.abort();
    }

    async fn refreshing_with(
        refresh_replies: Vec<String>,
        original: &SessionTokens,
    ) -> crate::ServerUrl {
        use crate::client::test_util::{http_response, routed};
        let json = [("Content-Type", "application/json")];
        let challenge = serde_json::json!({
            "nonce": "nonce",
            "expires_at": now_ms() + 120_000,
        })
        .to_string();
        let renewed = serde_json::json!({
            "account_id": original.account_id,
            "device_id": original.device_id,
            "access_token": "renewed",
            "access_expires_at": now_ms() + 600_000,
            "refresh_token": "renewed-refresh",
        })
        .to_string();
        let replies = refresh_replies
            .into_iter()
            .map(|reply| {
                if reply == "renewed" {
                    http_response("200 OK", &json, &renewed)
                } else {
                    reply
                }
            })
            .collect();
        let (url, _heard) = routed(|_| {
            vec![
                (
                    "/auth/challenge",
                    vec![http_response("200 OK", &json, &challenge)],
                ),
                ("/auth/refresh", replies),
            ]
        })
        .await;
        url
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_caller_whose_old_token_was_turned_away_gets_the_newer_one_without_another_rotation()
    {
        use crate::client::test_util::{http_response, routed};
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        let original = tokens("old", now_ms() + 300_000);
        manager.store(server, &original).expect("store");
        let json = [("Content-Type", "application/json")];
        let challenge =
            serde_json::json!({ "nonce": "nonce", "expires_at": now_ms() + 120_000 }).to_string();
        let renewed = |access: &str| {
            serde_json::json!({
                "account_id": original.account_id,
                "device_id": original.device_id,
                "access_token": access,
                "access_expires_at": now_ms() + 600_000,
                "refresh_token": format!("{access}-refresh"),
            })
            .to_string()
        };
        let (url, heard) = routed(|_| {
            vec![
                (
                    "/auth/challenge",
                    vec![http_response("200 OK", &json, &challenge)],
                ),
                (
                    "/auth/refresh",
                    vec![
                        http_response("200 OK", &json, &renewed("first")),
                        http_response("200 OK", &json, &renewed("second")),
                    ],
                ),
            ]
        })
        .await;
        let client = ServerClient::new(url).expect("client");
        for _ in 0..2 {
            assert_eq!(
                manager
                    .refresh_rejected(server, &client, "old")
                    .await
                    .expect("renewed"),
                "first"
            );
        }
        let refreshes = || {
            heard
                .lock()
                .expect("heard")
                .iter()
                .filter(|request| request.starts_with("POST /auth/refresh "))
                .count()
        };
        assert_eq!(refreshes(), 1);
        assert_eq!(
            manager
                .refresh_rejected(server, &client, "first")
                .await
                .expect("renewed"),
            "second"
        );
        assert_eq!(refreshes(), 2);
        assert_eq!(
            manager
                .tokens(server)
                .expect("read")
                .map(|kept| kept.access_token),
            Some("second".to_owned())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_expired_sign_in_check_is_tried_again_and_keeps_the_session() {
        use crate::client::test_util::http_response;
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        let original = tokens("old", 0);
        manager.store(server, &original).expect("store");
        let expired = http_response(
            "401 Unauthorized",
            &[("Content-Type", "application/json")],
            r#"{"code":"expired_nonce","message":"The sign-in check expired. Try again."}"#,
        );
        let url = refreshing_with(vec![expired, "renewed".to_owned()], &original).await;
        let client = ServerClient::new(url).expect("client");
        assert_eq!(
            manager
                .force_refresh(server, &client)
                .await
                .expect("renewed"),
            "renewed"
        );
        let stored = manager
            .tokens(server)
            .expect("read")
            .expect("still signed in");
        assert_eq!(stored.refresh_token, "renewed-refresh");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_401_from_something_in_front_of_the_server_keeps_the_session() {
        use crate::client::test_util::http_response;
        let (_secrets, manager) = manager();
        let server = ServerId::new_v7();
        let original = tokens("old", 0);
        manager.store(server, &original).expect("store");
        let bare = http_response("401 Unauthorized", &[("WWW-Authenticate", "Basic")], "");
        let url = refreshing_with(vec![bare], &original).await;
        let client = ServerClient::new(url).expect("client");
        assert!(matches!(
            manager.force_refresh(server, &client).await,
            Err(CollabError::Network(_))
        ));
        assert_eq!(
            manager
                .tokens(server)
                .expect("read")
                .map(|kept| kept.refresh_token),
            Some(original.refresh_token.clone())
        );
        let still_expired = http_response(
            "401 Unauthorized",
            &[("Content-Type", "application/json")],
            r#"{"code":"expired_nonce","message":"m"}"#,
        );
        let url = refreshing_with(vec![still_expired], &original).await;
        let client = ServerClient::new(url).expect("client");
        assert!(matches!(
            manager.force_refresh(server, &client).await,
            Err(CollabError::Api { status: 401, ref code, .. }) if code == "expired_nonce"
        ));
        assert!(manager.tokens(server).expect("read").is_some());
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
