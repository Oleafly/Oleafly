use oleafly_collab::{CollabError, SecretPort};

pub struct AppSecrets;

impl SecretPort for AppSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, CollabError> {
        crate::secrets::get_secret(account).map_err(CollabError::Secret)
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CollabError> {
        if value.is_empty() {
            return Err(CollabError::Secret(format!(
                "refusing to store an empty value for {account}"
            )));
        }
        crate::secrets::set_secrets(&[(account, value)]).map_err(CollabError::Secret)
    }

    fn remove(&self, account: &str) -> Result<(), CollabError> {
        crate::secrets::set_secrets(&[(account, "")]).map_err(CollabError::Secret)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_collab::{DeviceKey, DEVICE_KEY_ACCOUNT};

    #[test]
    fn app_secrets_round_trip_through_the_encrypted_store() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let secrets = AppSecrets;
        let before = secrets.get("collab_test_account");
        let stored = secrets.set("collab_test_account", "device-key-material");
        let read_back = secrets.get("collab_test_account");
        let on_disk = std::fs::read_to_string(directory.path().join("app-secrets.json"));
        let refused = secrets.set("collab_test_account", "");
        let still_there = secrets.get("collab_test_account");
        let removed = secrets.remove("collab_test_account");
        let after = secrets.get("collab_test_account");
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert_eq!(before, Ok(None));
        assert_eq!(stored, Ok(()));
        assert_eq!(read_back, Ok(Some("device-key-material".to_string())));
        assert!(!on_disk.unwrap().contains("device-key-material"));
        assert!(matches!(refused, Err(CollabError::Secret(_))));
        assert_eq!(still_there, Ok(Some("device-key-material".to_string())));
        assert_eq!(removed, Ok(()));
        assert_eq!(after, Ok(None));
    }

    #[test]
    fn the_device_key_persists_encrypted_through_the_app_store() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let first = DeviceKey::load_or_create(&AppSecrets);
        let second = DeviceKey::load_or_create(&AppSecrets);
        let stored = AppSecrets.get(DEVICE_KEY_ACCOUNT);
        let on_disk = std::fs::read_to_string(directory.path().join("app-secrets.json"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert_eq!(first.unwrap().public_key(), second.unwrap().public_key());
        let stored = stored.unwrap().unwrap();
        assert!(!on_disk.unwrap().contains(&stored));
    }
}
