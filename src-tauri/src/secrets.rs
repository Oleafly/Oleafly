//! OS keychain / credential-store helpers for long-lived secrets.
//!
use keyring::Entry;
use ring::{aead, rand as ring_rand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const SERVICE: &str = "com.openleaf.app";

/// The OS keychain is global: `OPENLEAF_DATA_DIR` isolates the disk for e2e
/// runs and dev sandboxes, but NOT keychain entries, so a test that saved or
/// cleared a token would clobber the real app's secrets. When the override is
/// set we skip the keyring entirely and rely on the 0600-config fallback.
fn keyring_disabled() -> bool {
    std::env::var_os("OPENLEAF_DATA_DIR").is_some()
}

fn entry(account: &str) -> Result<Entry, String> {
    if keyring_disabled() {
        return Err("keyring disabled (OPENLEAF_DATA_DIR is set)".into());
    }
    Entry::new(SERVICE, account).map_err(|e| format!("keyring entry: {e}"))
}

/// Persist a secret. Empty value deletes the entry.
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    let e = entry(account)?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            // Already absent is fine.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("keyring delete: {err}")),
        }
    } else {
        e.set_password(value)
            .map_err(|err| format!("keyring set: {err}"))
    }
}

/// Read a secret. Returns `None` when missing or keyring is unavailable.
pub fn get_secret(account: &str) -> Option<String> {
    let e = entry(account).ok()?;
    match e.get_password() {
        Ok(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}

pub fn github_token_account() -> &'static str {
    "github_token"
}

pub fn mcp_token_account() -> &'static str {
    "mcp_token"
}

/// 256-bit random bearer token, lowercase hex.
pub fn generate_mcp_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize, Deserialize)]
struct EncryptedAiSecrets {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn ai_secrets_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::openleaf_root()?.join("ai-secrets.json"))
}

fn ai_secrets_key_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::openleaf_root()?.join("ai-secrets.key"))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    for candidate in [path, tmp.as_path()] {
        match std::fs::symlink_metadata(candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("secret path cannot be a symbolic link".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to inspect secret path: {error}")),
        }
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    {
        use std::io::Write;
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("failed to open secret temp file: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("failed to write secret file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("failed to sync secret file: {e}"))?;
    }
    crate::fsperm::harden_file(&tmp);
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace secret file: {e}")
    })
}

fn load_or_create_ai_key(path: &Path) -> Result<[u8; 32], String> {
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("AI secret key cannot be a symbolic link".to_string());
    }
    match std::fs::read(path) {
        Ok(bytes) => bytes
            .try_into()
            .map_err(|_| "AI secret key has an invalid length".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut key = [0u8; 32];
            ring_rand::SecureRandom::fill(&ring_rand::SystemRandom::new(), &mut key)
                .map_err(|_| "failed to generate AI secret key".to_string())?;
            write_private(path, &key)?;
            Ok(key)
        }
        Err(error) => Err(format!("failed to read AI secret key: {error}")),
    }
}

fn read_ai_secrets_at(
    data_path: &Path,
    key_path: &Path,
) -> Result<HashMap<String, String>, String> {
    if std::fs::symlink_metadata(data_path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("AI secrets file cannot be a symbolic link".to_string());
    }
    let raw = match std::fs::read(data_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(format!("failed to read AI secrets: {error}")),
    };
    let envelope: EncryptedAiSecrets =
        serde_json::from_slice(&raw).map_err(|e| format!("AI secrets file is corrupt: {e}"))?;
    if envelope.version != 1 {
        return Err("AI secrets file has an unsupported version".to_string());
    }
    let nonce_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, envelope.nonce)
            .map_err(|e| format!("AI secrets nonce is corrupt: {e}"))?;
    let nonce_array: [u8; 12] = nonce_bytes
        .try_into()
        .map_err(|_| "AI secrets nonce has an invalid length".to_string())?;
    let mut ciphertext = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        envelope.ciphertext,
    )
    .map_err(|e| format!("AI secrets ciphertext is corrupt: {e}"))?;
    let key = load_or_create_ai_key(key_path)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "failed to load AI secret key".to_string())?;
    let key = aead::LessSafeKey::new(key);
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce_array),
            aead::Aad::empty(),
            &mut ciphertext,
        )
        .map_err(|_| "AI secrets could not be decrypted".to_string())?;
    serde_json::from_slice(plaintext).map_err(|e| format!("AI secrets payload is corrupt: {e}"))
}

fn write_ai_secrets_at(
    data_path: &Path,
    key_path: &Path,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    let key = load_or_create_ai_key(key_path)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "failed to load AI secret key".to_string())?;
    let key = aead::LessSafeKey::new(key);
    let mut nonce = [0u8; 12];
    ring_rand::SecureRandom::fill(&ring_rand::SystemRandom::new(), &mut nonce)
        .map_err(|_| "failed to generate AI secret nonce".to_string())?;
    let mut ciphertext = serde_json::to_vec(values).map_err(|e| e.to_string())?;
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::empty(),
        &mut ciphertext,
    )
    .map_err(|_| "failed to encrypt AI secrets".to_string())?;
    let envelope = EncryptedAiSecrets {
        version: 1,
        nonce: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce),
        ciphertext: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, ciphertext),
    };
    let bytes = serde_json::to_vec_pretty(&envelope).map_err(|e| e.to_string())?;
    write_private(data_path, &bytes)
}

pub fn read_ai_secrets() -> Result<HashMap<String, String>, String> {
    read_ai_secrets_at(&ai_secrets_path()?, &ai_secrets_key_path()?)
}

pub fn write_ai_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    write_ai_secrets_at(&ai_secrets_path()?, &ai_secrets_key_path()?, values)
}

/// Best-effort: migrate a plaintext value from config into the keyring and
/// return the value that should remain in the config file (empty when migration
/// succeeded, original when keyring is unavailable).
pub fn migrate_to_keyring(account: &str, plaintext: &str) -> String {
    if plaintext.is_empty() {
        return String::new();
    }
    match set_secret(account, plaintext) {
        Ok(()) => String::new(),
        Err(_) => plaintext.to_string(),
    }
}

/// Resolve a secret: prefer keyring, fall back to the config value (legacy).
pub fn resolve_secret(account: &str, config_value: &str) -> String {
    if let Some(s) = get_secret(account) {
        return s;
    }
    config_value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_token_shape() {
        let t = generate_mcp_token();
        assert_eq!(t.len(), 64);
        assert!(t
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(generate_mcp_token(), t, "tokens must be random");
    }

    #[test]
    fn ai_secrets_round_trip_without_plaintext() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-ai-secrets-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data = dir.join("ai-secrets.json");
        let key = dir.join("ai-secrets.key");
        let values = HashMap::from([
            ("openai".to_string(), "sk-test-secret".to_string()),
            ("ollama".to_string(), "http://localhost:11434".to_string()),
        ]);
        write_ai_secrets_at(&data, &key, &values).unwrap();
        let stored = std::fs::read_to_string(&data).unwrap();
        assert!(!stored.contains("sk-test-secret"));
        assert!(!stored.contains("localhost"));
        assert_eq!(read_ai_secrets_at(&data, &key).unwrap(), values);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ai_secrets_reject_tampering() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-ai-secrets-tamper-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data = dir.join("ai-secrets.json");
        let key = dir.join("ai-secrets.key");
        write_ai_secrets_at(
            &data,
            &key,
            &HashMap::from([("anthropic".to_string(), "secret".to_string())]),
        )
        .unwrap();
        let mut envelope: EncryptedAiSecrets =
            serde_json::from_slice(&std::fs::read(&data).unwrap()).unwrap();
        envelope.ciphertext.push('A');
        write_private(&data, &serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(read_ai_secrets_at(&data, &key).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
