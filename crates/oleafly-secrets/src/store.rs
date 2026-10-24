//! The encrypted secret files and their lock.
//!
//! Every file is a JSON map of account → value, encrypted with AES-256-GCM
//! under one shared 32-byte key (`ai-secrets.key`, named for backward
//! compatibility). One lock file per data folder serializes readers and
//! writers across processes; a process-wide mutex serializes threads.
use ring::{aead, rand as ring_rand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// The shared key file inside the data folder.
pub const KEY_FILE: &str = "ai-secrets.key";
const LOCK_FILE: &str = ".secret-store.lock";

/// One encrypted file in the data folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecretFile {
    /// Git, Git-host, MCP, online-service and collaboration secrets.
    App,
    /// AI provider keys.
    Ai,
    /// Research connector keys (alphaXiv, Mathpix, …).
    Connector,
    /// Secrets for user-configured MCP servers.
    McpServer,
}

impl SecretFile {
    pub const fn file_name(self) -> &'static str {
        match self {
            SecretFile::App => "app-secrets.json",
            SecretFile::Ai => "ai-secrets.json",
            SecretFile::Connector => "connector-secrets.json",
            SecretFile::McpServer => "mcp-server-secrets.json",
        }
    }
}

/// The secret files of one data folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SecretStore {
    root: PathBuf,
}

static SECRET_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct SecretLock {
    _file: std::fs::File,
    _guard: MutexGuard<'static, ()>,
}

fn lock_file(file: &std::fs::File) -> Result<(), String> {
    oleafly_core::locking::lock_file(file, true, oleafly_core::locking::STORAGE_LOCK_TIMEOUT)
        .map_err(|error| format!("failed to lock secret store: {error}"))
}

fn lock_secrets(parent: &Path) -> Result<SecretLock, String> {
    let guard = oleafly_core::locking::lock_mutex(
        SECRET_LOCK.get_or_init(|| Mutex::new(())),
        oleafly_core::locking::STORAGE_LOCK_TIMEOUT,
    )
    .map_err(|error| format!("failed to lock secret store: {error}"))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let path = parent.join(LOCK_FILE);
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|e| format!("failed to open secret store lock: {e}"))?;
    crate::fsperm::harden_file(path.as_path());
    lock_file(&file)?;
    Ok(SecretLock {
        _file: file,
        _guard: guard,
    })
}

impl SecretStore {
    /// The store of the data folder `root`.
    pub fn at(root: impl Into<PathBuf>) -> SecretStore {
        SecretStore { root: root.into() }
    }

    /// The store of [`crate::paths::data_root`].
    pub fn open_default() -> Result<SecretStore, String> {
        Ok(SecretStore::at(crate::paths::data_root()?))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path_of(&self, file: SecretFile) -> PathBuf {
        self.root.join(file.file_name())
    }

    fn key_path(&self) -> PathBuf {
        self.root.join(KEY_FILE)
    }

    fn lock(&self) -> Result<SecretLock, String> {
        lock_secrets(&self.root)
    }

    /// Every account in `file`. A missing file reads as empty and creates no
    /// key.
    pub fn read(&self, file: SecretFile) -> Result<HashMap<String, String>, String> {
        let _lock = self.lock()?;
        read_secret_map_at(&self.path_of(file), &self.key_path())
    }

    /// Replace every account in `file` with `values`.
    pub fn write(&self, file: SecretFile, values: &HashMap<String, String>) -> Result<(), String> {
        let _lock = self.lock()?;
        write_secret_map_at(&self.path_of(file), &self.key_path(), values)
    }

    /// One account of the app file. An empty value reads as `None`.
    pub fn get(&self, account: &str) -> Result<Option<String>, String> {
        let _lock = self.lock()?;
        Ok(
            read_secret_map_at(&self.path_of(SecretFile::App), &self.key_path())?
                .get(account)
                .filter(|value| !value.is_empty())
                .cloned(),
        )
    }

    /// Set accounts in the app file. An empty value removes the account.
    pub fn set(&self, values: &[(&str, &str)]) -> Result<(), String> {
        set_secrets_at(&self.path_of(SecretFile::App), &self.key_path(), values)
    }

    pub fn contains(&self, account: &str) -> Result<bool, String> {
        Ok(self.get(account)?.is_some())
    }

    /// Edit one account of the app file under the store lock. `edit` sees the
    /// current value (`None` when missing or empty) and may change it; the
    /// file is only written when the value changed. `None` or `""` removes
    /// the account.
    pub fn update<T>(
        &self,
        account: &str,
        edit: impl FnOnce(&mut Option<String>) -> T,
    ) -> Result<T, String> {
        let data = self.path_of(SecretFile::App);
        let key = self.key_path();
        let _lock = self.lock()?;
        let mut map = read_secret_map_at(&data, &key)?;
        let current = map.get(account).filter(|value| !value.is_empty()).cloned();
        let mut slot = current.clone();
        let output = edit(&mut slot);
        let slot = slot.filter(|value| !value.is_empty());
        if slot != current {
            match slot {
                Some(value) => {
                    map.insert(account.to_string(), value);
                }
                None => {
                    map.remove(account);
                }
            }
            write_secret_map_at(&data, &key, &map)?;
        }
        Ok(output)
    }
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

#[derive(Serialize, Deserialize)]
struct EncryptedSecrets {
    version: u8,
    nonce: String,
    ciphertext: String,
}

pub(crate) fn load_or_create_key(path: &Path) -> Result<[u8; 32], String> {
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("secret key cannot be a symbolic link".to_string());
    }
    match std::fs::read(path) {
        Ok(bytes) => match bytes.try_into() {
            Ok(key) => Ok(key),
            Err(_) => read_key_after_concurrent_create(path),
        },
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
                    read_key_after_concurrent_create(path)
                }
                Err(error) => Err(format!("failed to create secret key: {error}")),
            }
        }
        Err(error) => Err(format!("failed to read secret key: {error}")),
    }
}

fn read_key_after_concurrent_create(path: &Path) -> Result<[u8; 32], String> {
    for _ in 0..100 {
        let bytes = std::fs::read(path).map_err(|e| format!("failed to read secret key: {e}"))?;
        if let Ok(key) = bytes.try_into() {
            return Ok(key);
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    Err("secret key has an invalid length".to_string())
}

pub(crate) fn read_secret_map_at(
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

pub(crate) fn write_secret_map_at(
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
    crate::fs::write_private(data_path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generate_token;

    fn temp(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            generate_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(windows)]
    fn no_console(command: &mut std::process::Command) -> &mut std::process::Command {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn no_console(command: &mut std::process::Command) -> &mut std::process::Command {
        command
    }

    #[test]
    fn ai_secrets_round_trip_without_plaintext() {
        let dir = temp("oleafly-ai-secrets");
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
        let dir = temp("oleafly-app-secrets");
        let data = dir.join("app-secrets.json");
        let key = dir.join("secrets.key");
        let map = HashMap::from([
            (
                crate::accounts::GITHUB_TOKEN_ACCOUNT.to_string(),
                "ghp_secrettoken".to_string(),
            ),
            (
                crate::accounts::MCP_TOKEN_ACCOUNT.to_string(),
                "mcp-bearer-secret".to_string(),
            ),
        ]);
        write_secret_map_at(&data, &key, &map).unwrap();
        let stored = std::fs::read_to_string(&data).unwrap();
        assert!(!stored.contains("ghp_secrettoken"));
        assert!(!stored.contains("mcp-bearer-secret"));
        let back = read_secret_map_at(&data, &key).unwrap();
        assert_eq!(
            back.get(crate::accounts::GITHUB_TOKEN_ACCOUNT).unwrap(),
            "ghp_secrettoken"
        );
        assert_eq!(
            back.get(crate::accounts::MCP_TOKEN_ACCOUNT).unwrap(),
            "mcp-bearer-secret"
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ai_secrets_reject_tampering() {
        let dir = temp("oleafly-ai-secrets-tamper");
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
        crate::fs::write_private(&data, &serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(read_secret_map_at(&data, &key).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn first_run_key_creation_is_atomic() {
        let dir = temp("oleafly-key-race");
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
        let dir = temp("oleafly-secret-poison");
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
        let dir = temp("oleafly-secret-updates");
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
        let Some(dir) = std::env::var_os("OLEAFLY_SECRET_PROCESS_WORKER") else {
            return;
        };
        let index = std::env::var("OLEAFLY_SECRET_PROCESS_INDEX").unwrap();
        let dir = PathBuf::from(dir);
        let data = dir.join("app-secrets.json");
        let key = dir.join("ai-secrets.key");
        let account = format!("process-{index}");
        let value = format!("value-{index}");
        set_secrets_at(&data, &key, &[(account.as_str(), value.as_str())]).unwrap();
    }

    #[test]
    fn concurrent_process_updates_share_one_key_and_preserve_accounts() {
        let dir = temp("oleafly-secret-processes");
        let executable = std::env::current_exe().unwrap();
        let mut children: Vec<_> = (0..8)
            .map(|index| {
                let mut command = std::process::Command::new(&executable);
                no_console(&mut command)
                    .arg("--exact")
                    .arg("store::tests::secret_update_process_worker")
                    .env("OLEAFLY_SECRET_PROCESS_WORKER", &dir)
                    .env("OLEAFLY_SECRET_PROCESS_INDEX", index.to_string())
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
        let dir = temp("oleafly-secret-corrupt");
        let data = dir.join("app-secrets.json");
        let key = dir.join("ai-secrets.key");
        std::fs::write(&data, b"not-json").unwrap();
        let error = read_secret_map_at(&data, &key).unwrap_err();
        assert!(error.contains("secrets file is corrupt"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn update_edits_one_account_under_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        store.set(&[("other", "keep")]).unwrap();
        let seen = store
            .update("map", |slot| {
                let before = slot.clone();
                *slot = Some("{\"a\":1}".into());
                before
            })
            .unwrap();
        assert_eq!(seen, None);
        assert_eq!(store.get("map").unwrap().as_deref(), Some("{\"a\":1}"));
        store.update("map", |slot| *slot = None).unwrap();
        assert_eq!(store.get("map").unwrap(), None);
        assert_eq!(store.get("other").unwrap().as_deref(), Some("keep"));
    }

    #[test]
    fn update_without_a_change_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        store.update("missing", |_| ()).unwrap();
        assert!(!store.path_of(SecretFile::App).exists());
    }

    #[test]
    fn update_process_worker() {
        let Some(dir) = std::env::var_os("OLEAFLY_UPDATE_WORKER") else {
            return;
        };
        let index = std::env::var("OLEAFLY_UPDATE_INDEX").unwrap();
        let store = SecretStore::at(PathBuf::from(dir));
        store
            .update("shared", |slot| {
                let mut map: serde_json::Map<String, serde_json::Value> = slot
                    .as_deref()
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or_default();
                map.insert(index.clone(), serde_json::Value::Bool(true));
                *slot = Some(serde_json::Value::Object(map).to_string());
            })
            .unwrap();
    }

    #[test]
    fn concurrent_process_updates_of_one_account_keep_every_entry() {
        let dir = tempfile::tempdir().unwrap();
        let executable = std::env::current_exe().unwrap();
        let mut children: Vec<_> = (0..8)
            .map(|index| {
                let mut command = std::process::Command::new(&executable);
                no_console(&mut command)
                    .arg("--exact")
                    .arg("store::tests::update_process_worker")
                    .env("OLEAFLY_UPDATE_WORKER", dir.path())
                    .env("OLEAFLY_UPDATE_INDEX", index.to_string())
                    .spawn()
                    .unwrap()
            })
            .collect();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let raw = SecretStore::at(dir.path()).get("shared").unwrap().unwrap();
        let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert_eq!(map.len(), 8);
        for index in 0..8 {
            assert!(map.contains_key(&index.to_string()));
        }
    }

    #[test]
    fn reading_a_missing_store_creates_no_key_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::at(dir.path());
        assert_eq!(store.get("x").unwrap(), None);
        assert!(store.read(SecretFile::Connector).unwrap().is_empty());
        assert!(!dir.path().join(KEY_FILE).exists());
    }

    #[test]
    fn a_0_4_7_store_decrypts_and_keeps_every_account() {
        // Write the envelope exactly as 0.4.7 did, independently of this
        // module's writer: a 32-byte key file and an AES-256-GCM sealed JSON
        // map in a version-1 envelope.
        let dir = tempfile::tempdir().unwrap();
        let key_bytes = [7u8; 32];
        std::fs::write(dir.path().join(KEY_FILE), key_bytes).unwrap();
        let accounts = serde_json::json!({
            "overleaf_sessions": "{\"https://www.example.edu\":{\"cookie\":\"c\"}}",
            "overleaf_git_tokens": "{\"https://www.example.edu\":\"olp_x\"}",
            "collab_device_key": "device-key-value"
        });
        let mut plaintext = serde_json::to_vec(&accounts).unwrap();
        let nonce = [9u8; 12];
        let key =
            aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes).unwrap());
        key.seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::empty(),
            &mut plaintext,
        )
        .unwrap();
        let envelope = serde_json::json!({
            "version": 1,
            "nonce": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce),
            "ciphertext": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &plaintext),
        });
        std::fs::write(
            dir.path().join("app-secrets.json"),
            serde_json::to_vec_pretty(&envelope).unwrap(),
        )
        .unwrap();

        let store = SecretStore::at(dir.path());
        assert_eq!(
            store.get("collab_device_key").unwrap().as_deref(),
            Some("device-key-value")
        );
        store.set(&[("forge_tokens", "{}")]).unwrap();
        for account in [
            "overleaf_sessions",
            "overleaf_git_tokens",
            "collab_device_key",
        ] {
            assert!(store.contains(account).unwrap(), "{account}");
        }
        assert_eq!(std::fs::read(dir.path().join(KEY_FILE)).unwrap(), key_bytes);
    }
}
