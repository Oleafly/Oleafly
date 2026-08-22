use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use rand::RngCore;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const KEY_VERSION: i32 = 1;
pub const LEGACY_JOURNAL_ENVELOPE_VERSION: i32 = 1;
pub const JOURNAL_ENVELOPE_VERSION: i32 = 2;
pub const SNAPSHOT_ENVELOPE_VERSION: i32 = 1;

#[derive(Clone)]
pub struct EnvelopeCrypto {
    master_key: [u8; 32],
}

#[derive(Debug)]
pub struct Ciphertext {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

impl EnvelopeCrypto {
    pub const fn new(master_key: [u8; 32]) -> Self {
        Self { master_key }
    }

    pub fn generate_project_key(&self) -> [u8; 32] {
        let mut key = [0; 32];
        rand::rng().fill_bytes(&mut key);
        key
    }

    pub fn wrap_project_key(&self, project_id: Uuid, key: &[u8; 32]) -> Result<Ciphertext> {
        encrypt(
            &self.master_key,
            key,
            format!("oleafly:project-key:v1:{project_id}").as_bytes(),
        )
    }

    pub fn unwrap_project_key(
        &self,
        project_id: Uuid,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<[u8; 32]> {
        let plaintext = decrypt(
            &self.master_key,
            nonce,
            ciphertext,
            format!("oleafly:project-key:v1:{project_id}").as_bytes(),
        )?;
        plaintext
            .try_into()
            .map_err(|_| anyhow!("unwrapped project key has an invalid length"))
    }

    pub fn encrypt_journal(
        &self,
        project_id: Uuid,
        server_sequence: i64,
        project_key: &[u8; 32],
        payload: &[u8],
    ) -> Result<Ciphertext> {
        encrypt(
            project_key,
            payload,
            format!("oleafly:journal:v2:{project_id}:{server_sequence}").as_bytes(),
        )
    }

    pub fn decrypt_journal(
        &self,
        project_id: Uuid,
        server_sequence: i64,
        project_key: &[u8; 32],
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>> {
        decrypt(
            project_key,
            nonce,
            ciphertext,
            format!("oleafly:journal:v2:{project_id}:{server_sequence}").as_bytes(),
        )
    }

    pub fn decrypt_legacy_journal(
        &self,
        project_id: Uuid,
        server_sequence: i64,
        project_key: &[u8; 32],
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>> {
        decrypt(
            project_key,
            nonce,
            ciphertext,
            format!("oleafly:journal:v1:{project_id}:{server_sequence}").as_bytes(),
        )
    }

    pub fn encrypt_snapshot(
        &self,
        project_id: Uuid,
        through_server_sequence: i64,
        project_key: &[u8; 32],
        state: &[u8],
    ) -> Result<Ciphertext> {
        encrypt(
            project_key,
            state,
            format!("oleafly:snapshot:v1:{project_id}:{through_server_sequence}").as_bytes(),
        )
    }

    pub fn decrypt_snapshot(
        &self,
        project_id: Uuid,
        through_server_sequence: i64,
        project_key: &[u8; 32],
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>> {
        decrypt(
            project_key,
            nonce,
            ciphertext,
            format!("oleafly:snapshot:v1:{project_id}:{through_server_sequence}").as_bytes(),
        )
    }
}

pub fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn encrypt(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Ciphertext> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("AES-256 key has a fixed length");
    let mut nonce = [0; 12];
    rand::rng().fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| anyhow!("AEAD encryption failed"))?;
    Ok(Ciphertext { nonce, ciphertext })
}

fn decrypt(key: &[u8; 32], nonce: &[u8], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(anyhow!("AEAD nonce has an invalid length"));
    }
    Aes256Gcm::new_from_slice(key)
        .expect("AES-256 key has a fixed length")
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| anyhow!("AEAD authentication failed"))
        .context("encrypted realtime object could not be opened")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_envelope_is_bound_to_project_and_sequence() {
        let crypto = EnvelopeCrypto::new([3; 32]);
        let project_key = crypto.generate_project_key();
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        let encrypted = crypto
            .encrypt_journal(first, 7, &project_key, b"private source")
            .unwrap();
        assert_eq!(
            crypto
                .decrypt_journal(
                    first,
                    7,
                    &project_key,
                    &encrypted.nonce,
                    &encrypted.ciphertext
                )
                .unwrap(),
            b"private source"
        );
        assert!(crypto
            .decrypt_journal(
                second,
                7,
                &project_key,
                &encrypted.nonce,
                &encrypted.ciphertext
            )
            .is_err());
        assert!(crypto
            .decrypt_journal(
                first,
                8,
                &project_key,
                &encrypted.nonce,
                &encrypted.ciphertext
            )
            .is_err());
    }

    #[test]
    fn snapshot_envelope_is_bound_to_its_watermark() {
        let crypto = EnvelopeCrypto::new([4; 32]);
        let project_key = crypto.generate_project_key();
        let project = Uuid::now_v7();
        let encrypted = crypto
            .encrypt_snapshot(project, 64, &project_key, b"full state")
            .unwrap();
        assert_eq!(
            crypto
                .decrypt_snapshot(
                    project,
                    64,
                    &project_key,
                    &encrypted.nonce,
                    &encrypted.ciphertext,
                )
                .unwrap(),
            b"full state"
        );
        assert!(crypto
            .decrypt_snapshot(
                project,
                63,
                &project_key,
                &encrypted.nonce,
                &encrypted.ciphertext,
            )
            .is_err());
    }
}
