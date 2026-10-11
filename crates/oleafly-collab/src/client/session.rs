use std::sync::Arc;

use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, RefreshRequest, SessionTokens,
};
use oleafly_collab_protocol::ids::ServerId;

use super::{now_ms, ServerClient};
use crate::{CollabError, DeviceKey, SecretPort};

const REFRESH_MARGIN_MS: i64 = 60_000;

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
        let challenge = client.challenge().await?;
        let message = challenge_message(ChallengePurpose::Refresh, server, &challenge.nonce);
        let request = RefreshRequest {
            refresh_token: tokens.refresh_token,
            device_id: tokens.device_id,
            signature: self.key.sign_b64(&message),
            nonce: challenge.nonce,
        };
        match client.refresh(&request).await {
            Ok(fresh) => {
                self.store(server, &fresh)?;
                Ok(fresh.access_token)
            }
            Err(error) if is_revocation(&error) => {
                self.clear(server)?;
                Err(CollabError::Unauthorized)
            }
            Err(error) => Err(error),
        }
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
}
