use crate::error::CollabError;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub trait SecretPort: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, CollabError>;
    fn set(&self, account: &str, value: &str) -> Result<(), CollabError>;
    fn remove(&self, account: &str) -> Result<(), CollabError>;
}

#[derive(Default)]
pub struct MemorySecrets {
    values: Mutex<HashMap<String, String>>,
}

impl MemorySecrets {
    pub fn new() -> MemorySecrets {
        MemorySecrets::default()
    }

    fn values(&self) -> MutexGuard<'_, HashMap<String, String>> {
        self.values.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl SecretPort for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, CollabError> {
        Ok(self.values().get(account).cloned())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), CollabError> {
        if value.is_empty() {
            return Err(CollabError::Secret(format!(
                "refusing to store an empty value for {account}"
            )));
        }
        self.values().insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn remove(&self, account: &str) -> Result<(), CollabError> {
        self.values().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn memory_secrets_store_read_and_remove_values() {
        let secrets = MemorySecrets::new();
        assert_eq!(secrets.get("collab_device_key"), Ok(None));
        secrets.set("collab_device_key", "first").unwrap();
        secrets.set("collab_device_key", "second").unwrap();
        assert_eq!(
            secrets.get("collab_device_key"),
            Ok(Some("second".to_string()))
        );
        secrets.remove("collab_device_key").unwrap();
        assert_eq!(secrets.get("collab_device_key"), Ok(None));
        assert_eq!(secrets.remove("never-set"), Ok(()));
    }

    #[test]
    fn empty_values_are_refused_so_set_never_means_remove() {
        let secrets = MemorySecrets::default();
        secrets.set("account", "value").unwrap();
        assert!(matches!(
            secrets.set("account", ""),
            Err(CollabError::Secret(_))
        ));
        assert_eq!(secrets.get("account"), Ok(Some("value".to_string())));
    }

    #[test]
    fn the_port_works_as_a_shared_trait_object_across_threads() {
        let secrets: Arc<dyn SecretPort> = Arc::new(MemorySecrets::new());
        let writer = Arc::clone(&secrets);
        std::thread::spawn(move || writer.set("collab_session:a", "token").unwrap())
            .join()
            .unwrap();
        assert_eq!(
            secrets.get("collab_session:a"),
            Ok(Some("token".to_string()))
        );
    }
}
