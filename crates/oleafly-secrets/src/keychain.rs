//! The OS keychain backend for cloud-sync credentials, with the encrypted
//! file store as the fallback. Release builds probe the keychain once without
//! a prompt; development builds and isolated data folders always use the
//! file.
use crate::SecretStore;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretBackend {
    Keychain,
    File,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackendChoice {
    pub backend: SecretBackend,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

const KEYCHAIN_SERVICE: &str = "com.oleafly.app";
const KEYCHAIN_PROBE_ACCOUNT: &str = "cloud/keychain-probe";

static CLOUD_BACKEND: OnceLock<BackendChoice> = OnceLock::new();

fn file_choice(reason: impl Into<String>) -> BackendChoice {
    BackendChoice {
        backend: SecretBackend::File,
        reason: Some(reason.into()),
    }
}

fn choose_backend(
    release_build: bool,
    data_dir_override: bool,
    platform_supported: bool,
    probe: &dyn Fn() -> Result<(), String>,
) -> BackendChoice {
    if !release_build {
        return file_choice("development build");
    }
    if data_dir_override {
        return file_choice("isolated data directory");
    }
    if !platform_supported {
        return file_choice("no promptless keychain probe on this platform");
    }
    match probe() {
        Ok(()) => BackendChoice {
            backend: SecretBackend::Keychain,
            reason: None,
        },
        Err(reason) => file_choice(reason),
    }
}

#[cfg(any(target_os = "macos", windows))]
fn platform_supports_promptless_probe() -> bool {
    true
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_supports_promptless_probe() -> bool {
    false
}

fn cloud_backend_choice() -> BackendChoice {
    choose_backend(
        !cfg!(debug_assertions),
        std::env::var_os(crate::paths::DATA_DIR_VARIABLE).is_some_and(|value| !value.is_empty()),
        platform_supports_promptless_probe(),
        &probe_keychain,
    )
}

pub fn cloud_secret_backend() -> BackendChoice {
    CLOUD_BACKEND.get_or_init(cloud_backend_choice).clone()
}

#[cfg(target_os = "macos")]
fn keychain_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    let store: std::sync::Arc<keyring_core::CredentialStore> =
        apple_native_keyring_store::keychain::Store::new().map_err(|error| error.to_string())?;
    Ok(store)
}

#[cfg(windows)]
fn keychain_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    let store: std::sync::Arc<keyring_core::CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(|error| error.to_string())?;
    Ok(store)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn keychain_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    Err("no promptless keychain probe on this platform".into())
}

fn keychain_entry(account: &str) -> Result<keyring_core::Entry, String> {
    keychain_store()?
        .build(KEYCHAIN_SERVICE, account, None)
        .map_err(|error| error.to_string())
}

fn probe_keychain() -> Result<(), String> {
    match keychain_entry(KEYCHAIN_PROBE_ACCOUNT)?.get_password() {
        Ok(_) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn keychain_set(account: &str, value: &str) -> Result<(), String> {
    let entry = keychain_entry(account)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    entry.set_password(value).map_err(|error| error.to_string())
}

fn keychain_get(account: &str) -> Result<Option<String>, String> {
    match keychain_entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_cloud_secret(
    store: &SecretStore,
    account: &str,
    value: &str,
) -> Result<BackendChoice, String> {
    let choice = cloud_secret_backend();
    if choice.backend == SecretBackend::Keychain {
        match keychain_set(account, value) {
            Ok(()) => return Ok(choice),
            Err(error) => {
                store.set(&[(account, value)])?;
                return Ok(file_choice(error));
            }
        }
    }
    store.set(&[(account, value)])?;
    Ok(choice)
}

pub fn get_cloud_secret(
    store: &SecretStore,
    account: &str,
    backend: SecretBackend,
) -> Result<Option<String>, String> {
    match backend {
        SecretBackend::Keychain => keychain_get(account),
        SecretBackend::File => store.get(account),
    }
}

pub fn delete_cloud_secret(
    store: &SecretStore,
    account: &str,
    backend: SecretBackend,
) -> Result<(), String> {
    match backend {
        SecretBackend::Keychain => keychain_set(account, ""),
        SecretBackend::File => store.set(&[(account, "")]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_backend_never_probes_the_keychain_outside_release_builds() {
        let probed = std::cell::Cell::new(false);
        let probe = || {
            probed.set(true);
            Ok(())
        };
        assert_eq!(
            choose_backend(false, false, true, &probe),
            BackendChoice {
                backend: SecretBackend::File,
                reason: Some("development build".into())
            }
        );
        assert!(!probed.get());
        assert_eq!(
            choose_backend(true, true, true, &probe).reason.as_deref(),
            Some("isolated data directory")
        );
        assert!(!probed.get());
        assert_eq!(
            choose_backend(true, false, false, &probe).backend,
            SecretBackend::File
        );
        assert!(!probed.get());
        assert_eq!(
            choose_backend(true, false, true, &probe).backend,
            SecretBackend::Keychain
        );
        assert!(probed.get());
        let locked = choose_backend(true, false, true, &|| Err("keychain is locked".to_string()));
        assert_eq!(locked.backend, SecretBackend::File);
        assert_eq!(locked.reason.as_deref(), Some("keychain is locked"));
    }

    #[test]
    fn backend_choice_round_trips_for_the_connection_record() {
        let choice = BackendChoice {
            backend: SecretBackend::File,
            reason: Some("keychain is locked".into()),
        };
        let value = serde_json::to_value(&choice).unwrap();
        assert_eq!(value["backend"], "file");
        assert_eq!(
            serde_json::from_value::<BackendChoice>(value).unwrap(),
            choice
        );
    }
}
