use crate::error::CollabError;
use crate::secret_port::SecretPort;
use oleafly_collab_protocol::crypto::{b64url_decode, b64url_encode};
use oleafly_collab_protocol::ids::ServerId;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use std::fmt;

pub const DEVICE_KEY_ACCOUNT: &str = "collab_device_key";

pub struct DeviceKey {
    pair: Ed25519KeyPair,
}

pub fn server_key_account(server: ServerId) -> String {
    format!("{DEVICE_KEY_ACCOUNT}:{server}")
}

impl DeviceKey {
    pub fn load_or_create(secrets: &dyn SecretPort) -> Result<DeviceKey, CollabError> {
        match DeviceKey::load(secrets, DEVICE_KEY_ACCOUNT)? {
            Some(key) => Ok(key),
            None => DeviceKey::create(secrets, DEVICE_KEY_ACCOUNT),
        }
    }

    pub fn load(secrets: &dyn SecretPort, account: &str) -> Result<Option<DeviceKey>, CollabError> {
        secrets
            .get(account)?
            .map(|stored| DeviceKey::from_stored(&stored))
            .transpose()
    }

    pub fn create(secrets: &dyn SecretPort, account: &str) -> Result<DeviceKey, CollabError> {
        let document = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .map_err(|_| CollabError::Crypto("failed to generate the device key".to_string()))?;
        secrets.set(account, &b64url_encode(document.as_ref()))?;
        let stored = secrets
            .get(account)?
            .ok_or_else(|| CollabError::Secret("the device key was not saved".to_string()))?;
        DeviceKey::from_stored(&stored)
    }

    fn from_stored(stored: &str) -> Result<DeviceKey, CollabError> {
        let pkcs8 = b64url_decode(stored).map_err(|_| {
            CollabError::Crypto("the stored device key is not base64url".to_string())
        })?;
        let pair = Ed25519KeyPair::from_pkcs8(&pkcs8).map_err(|_| {
            CollabError::Crypto("the stored device key is not an Ed25519 key".to_string())
        })?;
        Ok(DeviceKey { pair })
    }

    pub fn public_key(&self) -> [u8; 32] {
        let mut key = [0u8; 32];
        key.copy_from_slice(self.pair.public_key().as_ref());
        key
    }

    pub fn public_key_b64(&self) -> String {
        b64url_encode(&self.public_key())
    }

    pub fn sign(&self, message: &[u8]) -> [u8; 64] {
        let mut signature = [0u8; 64];
        signature.copy_from_slice(self.pair.sign(message).as_ref());
        signature
    }

    pub fn sign_b64(&self, message: &[u8]) -> String {
        b64url_encode(&self.sign(message))
    }
}

impl fmt::Debug for DeviceKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceKey")
            .field("public_key", &self.public_key_b64())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret_port::MemorySecrets;
    use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
    use oleafly_collab_protocol::crypto::verify_ed25519;
    use oleafly_collab_protocol::ids::ServerId;

    struct BrokenSecrets;

    impl SecretPort for BrokenSecrets {
        fn get(&self, _account: &str) -> Result<Option<String>, CollabError> {
            Err(CollabError::Secret("store unavailable".to_string()))
        }

        fn set(&self, _account: &str, _value: &str) -> Result<(), CollabError> {
            Err(CollabError::Secret("store unavailable".to_string()))
        }

        fn remove(&self, _account: &str) -> Result<(), CollabError> {
            Err(CollabError::Secret("store unavailable".to_string()))
        }
    }

    #[test]
    fn the_first_call_creates_a_key_and_later_calls_reload_it() {
        let secrets = MemorySecrets::new();
        let first = DeviceKey::load_or_create(&secrets).unwrap();
        let stored = secrets.get(DEVICE_KEY_ACCOUNT).unwrap().unwrap();
        assert!(!stored.contains(['=', '+', '/']));
        assert!(Ed25519KeyPair::from_pkcs8(&b64url_decode(&stored).unwrap()).is_ok());
        let second = DeviceKey::load_or_create(&secrets).unwrap();
        assert_eq!(first.public_key(), second.public_key());
        assert_eq!(secrets.get(DEVICE_KEY_ACCOUNT).unwrap(), Some(stored));
        assert_eq!(first.public_key_b64(), b64url_encode(&first.public_key()));
        assert_eq!(first.public_key_b64().len(), 43);
    }

    #[test]
    fn signatures_verify_with_the_protocol_checker_and_fail_when_tampered() {
        let key = DeviceKey::load_or_create(&MemorySecrets::new()).unwrap();
        let message = challenge_message(ChallengePurpose::Socket, ServerId::new_v7(), "nonce-1");
        let signature = key.sign(&message);
        assert!(verify_ed25519(&key.public_key(), &message, &signature));
        let mut tampered = message.clone();
        tampered[0] ^= 1;
        assert!(!verify_ed25519(&key.public_key(), &tampered, &signature));
        assert_eq!(
            b64url_decode(&key.sign_b64(&message)).unwrap(),
            signature.to_vec()
        );
        assert_eq!(key.sign_b64(&message).len(), 86);
        let other = DeviceKey::load_or_create(&MemorySecrets::new()).unwrap();
        assert_ne!(other.public_key(), key.public_key());
        assert!(!verify_ed25519(&other.public_key(), &message, &signature));
    }

    #[test]
    fn a_damaged_stored_key_is_an_error_and_is_never_replaced() {
        let secrets = MemorySecrets::new();
        secrets.set(DEVICE_KEY_ACCOUNT, "not-a-key").unwrap();
        assert!(matches!(
            DeviceKey::load_or_create(&secrets),
            Err(CollabError::Crypto(_))
        ));
        assert_eq!(
            secrets.get(DEVICE_KEY_ACCOUNT).unwrap().as_deref(),
            Some("not-a-key")
        );
        secrets
            .set(DEVICE_KEY_ACCOUNT, &b64url_encode(b"short"))
            .unwrap();
        assert!(matches!(
            DeviceKey::load_or_create(&secrets),
            Err(CollabError::Crypto(_))
        ));
    }

    #[test]
    fn secret_store_failures_are_passed_through() {
        assert_eq!(
            DeviceKey::load_or_create(&BrokenSecrets).unwrap_err(),
            CollabError::Secret("store unavailable".to_string())
        );
    }

    #[test]
    fn debug_output_shows_only_the_public_key() {
        let secrets = MemorySecrets::new();
        let key = DeviceKey::load_or_create(&secrets).unwrap();
        let printed = format!("{key:?}");
        assert!(printed.contains(&key.public_key_b64()));
        assert!(!printed.contains(&secrets.get(DEVICE_KEY_ACCOUNT).unwrap().unwrap()));
    }
}
