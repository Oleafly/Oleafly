//! Encrypted, on-disk storage for long-lived secrets (GitHub token, MCP token,
//! AI provider keys).
//!
//! Nothing here touches the OS keychain. An unsigned dev build gets a fresh code
//! identity each launch, so the keychain never remembers its access grant and
//! re-prompts on every run; storing secrets in an AES-256-GCM file under the
//! app data dir (0600 on unix, owner-only ACL on Windows) avoids that entirely
//! and keeps e2e/dev sandboxes isolated via `OPENLEAF_DATA_DIR`.
use ring::{aead, rand as ring_rand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

static SECRET_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct SecretLock {
    _file: std::fs::File,
    _guard: MutexGuard<'static, ()>,
}

#[cfg(unix)]
fn lock_file(file: &std::fs::File) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
        Ok(())
    } else {
        Err(format!(
            "failed to lock secret store: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
fn lock_file(file: &std::fs::File) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
    use windows_sys::Win32::System::IO::OVERLAPPED;
    let mut overlapped = OVERLAPPED::default();
    let result = unsafe {
        LockFileEx(
            file.as_raw_handle() as _,
            LOCKFILE_EXCLUSIVE_LOCK,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if result == 0 {
        Err(format!(
            "failed to lock secret store: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

fn lock_secrets(parent: &Path) -> Result<SecretLock, String> {
    let guard = SECRET_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let path = parent.join(".secret-store.lock");
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("failed to open secret store lock: {e}"))?;
    crate::fsperm::harden_file(parent.join(".secret-store.lock").as_path());
    lock_file(&file)?;
    Ok(SecretLock {
        _file: file,
        _guard: guard,
    })
}

/// Persist a secret in the encrypted app-secrets store. An empty value removes it.
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    set_secrets(&[(account, value)])
}

pub fn set_secrets(values: &[(&str, &str)]) -> Result<(), String> {
    let data = app_secrets_path()?;
    let key = secret_key_path()?;
    set_secrets_at(&data, &key, values)
}

fn set_secrets_at(data: &Path, key: &Path, values: &[(&str, &str)]) -> Result<(), String> {
    let parent = data
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    let _lock = lock_secrets(parent)?;
    let mut map = read_secret_map_at(data, key)?;
    for (account, value) in values {
        if value.is_empty() {
            map.remove(*account);
        } else {
            map.insert((*account).to_string(), (*value).to_string());
        }
    }
    write_secret_map_at(data, key, &map)
}

/// Read a secret from the encrypted app-secrets store. `None` when missing.
pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    let data = app_secrets_path()?;
    let key = secret_key_path()?;
    let parent = data
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    let _lock = lock_secrets(parent)?;
    Ok(read_secret_map_at(&data, &key)?
        .get(account)
        .filter(|value| !value.is_empty())
        .cloned())
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
struct EncryptedSecrets {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn ai_secrets_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::openleaf_root()?.join("ai-secrets.json"))
}

// GitHub + MCP tokens live here, encrypted with the same key as the secrets.
fn app_secrets_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::openleaf_root()?.join("app-secrets.json"))
}

// Shared symmetric key for every encrypted secret file. Named `ai-secrets.key`
// for backward compatibility with existing installs.
fn secret_key_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::openleaf_root()?.join("ai-secrets.key"))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "secret path has an invalid filename".to_string())?,
        std::process::id(),
        generate_mcp_token()
    ));
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
    options.write(true).create_new(true);
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
    replace_file(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace secret file: {e}")
    })
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn load_or_create_key(path: &Path) -> Result<[u8; 32], String> {
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("secret key cannot be a symbolic link".to_string());
    }
    match std::fs::read(path) {
        Ok(bytes) => bytes
            .try_into()
            .map_err(|_| "secret key has an invalid length".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut key = [0u8; 32];
            ring_rand::SecureRandom::fill(&ring_rand::SystemRandom::new(), &mut key)
                .map_err(|_| "failed to generate secret key".to_string())?;
            let parent = path
                .parent()
                .ok_or_else(|| "secret key path has no parent directory".to_string())?;
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(path) {
                Ok(mut file) => {
                    use std::io::Write;
                    file.write_all(&key)
                        .map_err(|e| format!("failed to write secret key: {e}"))?;
                    file.sync_all()
                        .map_err(|e| format!("failed to sync secret key: {e}"))?;
                    crate::fsperm::harden_file(path);
                    Ok(key)
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    for _ in 0..100 {
                        let bytes = std::fs::read(path)
                            .map_err(|e| format!("failed to read secret key: {e}"))?;
                        if let Ok(key) = bytes.try_into() {
                            return Ok(key);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    Err("secret key has an invalid length".to_string())
                }
                Err(error) => Err(format!("failed to create secret key: {error}")),
            }
        }
        Err(error) => Err(format!("failed to read secret key: {error}")),
    }
}

fn read_secret_map_at(
    data_path: &Path,
    key_path: &Path,
) -> Result<HashMap<String, String>, String> {
    if std::fs::symlink_metadata(data_path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("secrets file cannot be a symbolic link".to_string());
    }
    let raw = match std::fs::read(data_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(format!("failed to read secrets: {error}")),
    };
    let envelope: EncryptedSecrets =
        serde_json::from_slice(&raw).map_err(|e| format!("secrets file is corrupt: {e}"))?;
    if envelope.version != 1 {
        return Err("secrets file has an unsupported version".to_string());
    }
    let nonce_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, envelope.nonce)
            .map_err(|e| format!("secrets nonce is corrupt: {e}"))?;
    let nonce_array: [u8; 12] = nonce_bytes
        .try_into()
        .map_err(|_| "secrets nonce has an invalid length".to_string())?;
    let mut ciphertext = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        envelope.ciphertext,
    )
    .map_err(|e| format!("secrets ciphertext is corrupt: {e}"))?;
    let key = load_or_create_key(key_path)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "failed to load secret key".to_string())?;
    let key = aead::LessSafeKey::new(key);
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce_array),
            aead::Aad::empty(),
            &mut ciphertext,
        )
        .map_err(|_| "secrets could not be decrypted".to_string())?;
    serde_json::from_slice(plaintext).map_err(|e| format!("secrets payload is corrupt: {e}"))
}

fn write_secret_map_at(
    data_path: &Path,
    key_path: &Path,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    let key = load_or_create_key(key_path)?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "failed to load secret key".to_string())?;
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
    .map_err(|_| "failed to encrypt secrets".to_string())?;
    let envelope = EncryptedSecrets {
        version: 1,
        nonce: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce),
        ciphertext: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, ciphertext),
    };
    let bytes = serde_json::to_vec_pretty(&envelope).map_err(|e| e.to_string())?;
    write_private(data_path, &bytes)
}

pub fn read_ai_secrets() -> Result<HashMap<String, String>, String> {
    let data = ai_secrets_path()?;
    let parent = data
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    let _lock = lock_secrets(parent)?;
    read_secret_map_at(&data, &secret_key_path()?)
}

pub fn write_ai_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    let data = ai_secrets_path()?;
    let parent = data
        .parent()
        .ok_or_else(|| "secret path has no parent directory".to_string())?;
    let _lock = lock_secrets(parent)?;
    write_secret_map_at(&data, &secret_key_path()?, values)
}

pub fn resolve_secret(account: &str, config_value: &str) -> Result<String, String> {
    if let Some(s) = get_secret(account)? {
        return Ok(s);
    }
    Ok(config_value.to_string())
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
        write_secret_map_at(&data, &key, &values).unwrap();
        let stored = std::fs::read_to_string(&data).unwrap();
        assert!(!stored.contains("sk-test-secret"));
        assert!(!stored.contains("localhost"));
        assert_eq!(read_secret_map_at(&data, &key).unwrap(), values);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn github_and_mcp_tokens_store_encrypted_off_keychain() {
        // The app-secrets store holds GitHub/MCP tokens as encrypted bytes, with
        // no plaintext and no OS keychain involvement.
        let dir = std::env::temp_dir().join(format!(
            "openleaf-app-secrets-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data = dir.join("app-secrets.json");
        let key = dir.join("secrets.key");
        let map = HashMap::from([
            (
                github_token_account().to_string(),
                "ghp_secrettoken".to_string(),
            ),
            (
                mcp_token_account().to_string(),
                "mcp-bearer-secret".to_string(),
            ),
        ]);
        write_secret_map_at(&data, &key, &map).unwrap();
        let stored = std::fs::read_to_string(&data).unwrap();
        assert!(!stored.contains("ghp_secrettoken"));
        assert!(!stored.contains("mcp-bearer-secret"));
        let back = read_secret_map_at(&data, &key).unwrap();
        assert_eq!(back.get(github_token_account()).unwrap(), "ghp_secrettoken");
        assert_eq!(back.get(mcp_token_account()).unwrap(), "mcp-bearer-secret");
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
        write_secret_map_at(
            &data,
            &key,
            &HashMap::from([("anthropic".to_string(), "secret".to_string())]),
        )
        .unwrap();
        let mut envelope: EncryptedSecrets =
            serde_json::from_slice(&std::fs::read(&data).unwrap()).unwrap();
        envelope.ciphertext.push('A');
        write_private(&data, &serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(read_secret_map_at(&data, &key).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn first_run_key_creation_is_atomic() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-key-race-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let key = std::sync::Arc::new(dir.join("ai-secrets.key"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let threads: Vec<_> = (0..16)
            .map(|_| {
                let key = key.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    load_or_create_key(&key).unwrap()
                })
            })
            .collect();
        let keys: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert!(keys.iter().all(|candidate| candidate == &keys[0]));
        assert_eq!(std::fs::read(&*key).unwrap(), keys[0]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn poisoned_process_lock_recovers() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-secret-poison-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let panic_dir = dir.clone();
        let result = std::thread::spawn(move || {
            let _lock = lock_secrets(&panic_dir).unwrap();
            panic!("poison");
        })
        .join();
        assert!(result.is_err());
        assert!(lock_secrets(&dir).is_ok());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn concurrent_secret_updates_preserve_every_account() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-secret-updates-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data = std::sync::Arc::new(dir.join("app-secrets.json"));
        let key = std::sync::Arc::new(dir.join("ai-secrets.key"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let threads: Vec<_> = (0..16)
            .map(|index| {
                let data = data.clone();
                let key = key.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let account = format!("account-{index}");
                    let value = format!("value-{index}");
                    barrier.wait();
                    set_secrets_at(&data, &key, &[(account.as_str(), value.as_str())]).unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let values = read_secret_map_at(&data, &key).unwrap();
        assert_eq!(values.len(), 16);
        for index in 0..16 {
            assert_eq!(
                values.get(&format!("account-{index}")),
                Some(&format!("value-{index}"))
            );
        }
        assert_eq!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn secret_update_process_worker() {
        let Some(dir) = std::env::var_os("OPENLEAF_SECRET_PROCESS_WORKER") else {
            return;
        };
        let index = std::env::var("OPENLEAF_SECRET_PROCESS_INDEX").unwrap();
        let dir = std::path::PathBuf::from(dir);
        let data = dir.join("app-secrets.json");
        let key = dir.join("ai-secrets.key");
        let account = format!("process-{index}");
        let value = format!("value-{index}");
        set_secrets_at(&data, &key, &[(account.as_str(), value.as_str())]).unwrap();
    }

    #[test]
    fn concurrent_process_updates_share_one_key_and_preserve_accounts() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-secret-processes-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let executable = std::env::current_exe().unwrap();
        let mut children: Vec<_> = (0..8)
            .map(|index| {
                std::process::Command::new(&executable)
                    .arg("--exact")
                    .arg("secrets::tests::secret_update_process_worker")
                    .env("OPENLEAF_SECRET_PROCESS_WORKER", &dir)
                    .env("OPENLEAF_SECRET_PROCESS_INDEX", index.to_string())
                    .spawn()
                    .unwrap()
            })
            .collect();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let data = dir.join("app-secrets.json");
        let key = dir.join("ai-secrets.key");
        let values = read_secret_map_at(&data, &key).unwrap();
        assert_eq!(values.len(), 8);
        assert_eq!(std::fs::read(&key).unwrap().len(), 32);
        for index in 0..8 {
            assert_eq!(
                values.get(&format!("process-{index}")),
                Some(&format!("value-{index}"))
            );
        }
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn corrupt_app_secret_storage_returns_an_error() {
        let dir = std::env::temp_dir().join(format!(
            "openleaf-secret-corrupt-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let data = dir.join("app-secrets.json");
        let key = dir.join("ai-secrets.key");
        std::fs::write(&data, b"not-json").unwrap();
        let error = read_secret_map_at(&data, &key).unwrap_err();
        assert!(error.contains("secrets file is corrupt"));
        std::fs::remove_dir_all(dir).ok();
    }
}
