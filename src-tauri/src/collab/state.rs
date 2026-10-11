use std::sync::{Arc, Mutex, PoisonError};

use oleafly_collab::{
    session_account, CollabError, CollabPaths, DeviceKey, SecretPort, ServerRegistry,
    SessionManager,
};
use oleafly_collab_protocol::ids::ServerId;
use tokio::sync::{oneshot, OnceCell};

use super::secrets_adapter::AppSecrets;

pub struct CollabKeys {
    pub key: Arc<DeviceKey>,
    pub sessions: SessionManager,
}

pub struct CollabState {
    paths: Result<CollabPaths, String>,
    secrets: Arc<dyn SecretPort>,
    keys: OnceCell<Arc<CollabKeys>>,
    registry: Mutex<()>,
    sign_in: Mutex<Option<oneshot::Sender<()>>>,
}

impl CollabState {
    pub fn new(paths: CollabPaths, secrets: Arc<dyn SecretPort>) -> CollabState {
        CollabState {
            paths: Ok(paths),
            secrets,
            keys: OnceCell::new(),
            registry: Mutex::new(()),
            sign_in: Mutex::new(None),
        }
    }

    pub fn for_app() -> CollabState {
        CollabState {
            paths: crate::paths::collab_root().map(CollabPaths::new),
            secrets: Arc::new(AppSecrets),
            keys: OnceCell::new(),
            registry: Mutex::new(()),
            sign_in: Mutex::new(None),
        }
    }

    pub fn has_session(&self, server: ServerId) -> Result<bool, CollabError> {
        Ok(self.secrets.get(&session_account(server))?.is_some())
    }

    pub fn registry(&self) -> Result<ServerRegistry, CollabError> {
        ServerRegistry::load(self.paths()?)
    }

    pub fn update_registry<T>(
        &self,
        change: impl FnOnce(&mut ServerRegistry) -> T,
    ) -> Result<T, CollabError> {
        let paths = self.paths()?;
        let _guard = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        let mut registry = ServerRegistry::load(paths)?;
        let result = change(&mut registry);
        registry.save(paths)?;
        Ok(result)
    }

    fn paths(&self) -> Result<&CollabPaths, CollabError> {
        self.paths
            .as_ref()
            .map_err(|error| CollabError::Io(format!("collaboration folder: {error}")))
    }

    pub async fn keys(&self) -> Result<Arc<CollabKeys>, CollabError> {
        let keys = self.keys.get_or_try_init(|| self.create_keys()).await?;
        Ok(Arc::clone(keys))
    }

    pub fn begin_sign_in(&self) -> oneshot::Receiver<()> {
        let (sender, receiver) = oneshot::channel();
        *self.sign_in.lock().unwrap_or_else(PoisonError::into_inner) = Some(sender);
        receiver
    }

    pub fn cancel_sign_in(&self) {
        let pending = self
            .sign_in
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(sender) = pending {
            let _ = sender.send(());
        }
    }

    async fn create_keys(&self) -> Result<Arc<CollabKeys>, CollabError> {
        let secrets = Arc::clone(&self.secrets);
        let key = tauri::async_runtime::spawn_blocking(move || {
            DeviceKey::load_or_create(secrets.as_ref())
        })
        .await
        .map_err(|error| CollabError::Io(error.to_string()))??;
        let key = Arc::new(key);
        Ok(Arc::new(CollabKeys {
            sessions: SessionManager::new(Arc::clone(&self.secrets), Arc::clone(&key)),
            key,
        }))
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab::{MemorySecrets, ServerEntry, DEVICE_KEY_ACCOUNT};
    use tokio::sync::oneshot::error::TryRecvError;

    use super::*;

    fn collab_state(dir: &tempfile::TempDir) -> (Arc<MemorySecrets>, CollabState) {
        let secrets = Arc::new(MemorySecrets::default());
        let state = CollabState::new(CollabPaths::new(dir.path().join("collab")), secrets.clone());
        (secrets, state)
    }

    #[tokio::test]
    async fn keys_are_created_once_and_shared() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (secrets, state) = collab_state(&dir);
        assert!(secrets.get(DEVICE_KEY_ACCOUNT).expect("read").is_none());
        let first = state.keys().await.expect("keys");
        let second = state.keys().await.expect("keys");
        assert!(Arc::ptr_eq(&first, &second));
        assert!(secrets.get(DEVICE_KEY_ACCOUNT).expect("read").is_some());
    }

    #[test]
    fn a_new_sign_in_drops_the_previous_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let mut first = state.begin_sign_in();
        let mut second = state.begin_sign_in();
        assert!(matches!(first.try_recv(), Err(TryRecvError::Closed)));
        assert!(matches!(second.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn cancel_wakes_the_pending_sign_in() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let mut pending = state.begin_sign_in();
        state.cancel_sign_in();
        assert!(pending.try_recv().is_ok());
    }

    #[test]
    fn cancel_with_nothing_pending_is_harmless() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        state.cancel_sign_in();
        state.cancel_sign_in();
        let mut next = state.begin_sign_in();
        assert!(matches!(next.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn missing_collaboration_root_is_an_internal_error() {
        let state = CollabState {
            paths: Err("no home folder".to_string()),
            secrets: Arc::new(MemorySecrets::default()),
            keys: OnceCell::new(),
            registry: Mutex::new(()),
            sign_in: Mutex::new(None),
        };
        assert!(matches!(state.registry(), Err(CollabError::Io(_))));
        assert!(matches!(
            state.update_registry(|registry| registry.list().len()),
            Err(CollabError::Io(_))
        ));
    }

    #[test]
    fn registry_changes_are_saved_and_sessions_start_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let id = ServerId::new_v7();
        state
            .update_registry(|registry| {
                registry.upsert(ServerEntry {
                    server_id: id,
                    url: "https://uni.edu/oleafly".to_string(),
                    name: "Smith Lab".to_string(),
                    icon_url: None,
                    account: None,
                    added_at: 1,
                })
            })
            .expect("update");
        let names: Vec<String> = state
            .registry()
            .expect("load")
            .list()
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        assert_eq!(names, vec!["Smith Lab".to_string()]);
        assert!(!state.has_session(id).expect("session"));
    }
}
