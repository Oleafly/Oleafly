use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_collab::{
    session_account, CollabError, CollabPaths, DeviceKey, SecretPort, ServerClient, ServerEntry,
    ServerRegistry, ServerUrl, SessionManager,
};
use oleafly_collab_protocol::capabilities::CapabilityManifest;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use tokio::sync::{oneshot, watch, OnceCell};

use super::secrets_adapter::AppSecrets;

pub struct CollabKeys {
    pub key: Arc<DeviceKey>,
    pub sessions: Arc<SessionManager>,
}

type JoinKey = (ServerId, SharedProjectId);

const PIN_KEPT: Duration = Duration::from_secs(120);

struct Connection {
    url: String,
    client: Arc<ServerClient>,
    verified: Option<(CapabilityManifest, Instant)>,
}

pub struct CollabState {
    paths: Result<CollabPaths, String>,
    secrets: Arc<dyn SecretPort>,
    keys: OnceCell<Arc<CollabKeys>>,
    registry: Mutex<()>,
    sign_in: Mutex<Option<oneshot::Sender<()>>>,
    sharing: Mutex<BTreeSet<String>>,
    joins: Mutex<HashMap<JoinKey, Arc<JoinSlot>>>,
    connections: Mutex<HashMap<ServerId, Connection>>,
}

pub(crate) struct ShareTurn<'a> {
    state: &'a CollabState,
    project_id: String,
}

impl Drop for ShareTurn<'_> {
    fn drop(&mut self) {
        locked(&self.state.sharing).remove(&self.project_id);
    }
}

pub(crate) struct JoinSlot {
    turn: tokio::sync::Mutex<()>,
    cancels: watch::Sender<u64>,
}

pub(crate) struct JoinTicket<'a> {
    state: &'a CollabState,
    key: JoinKey,
    slot: Arc<JoinSlot>,
    since: u64,
}

impl JoinTicket<'_> {
    pub(crate) async fn turn(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.slot.turn.lock().await
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        *self.slot.cancels.borrow() > self.since
    }

    pub(crate) async fn until_cancelled(&self) {
        let mut cancels = self.slot.cancels.subscribe();
        let _ = cancels.wait_for(|count| *count > self.since).await;
    }
}

impl Drop for JoinTicket<'_> {
    fn drop(&mut self) {
        let mut joins = locked(&self.state.joins);
        if Arc::strong_count(&self.slot) == 2 {
            joins.remove(&self.key);
        }
    }
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl CollabState {
    pub fn new(paths: CollabPaths, secrets: Arc<dyn SecretPort>) -> CollabState {
        CollabState::with(Ok(paths), secrets)
    }

    pub fn for_app() -> CollabState {
        CollabState::with(
            crate::paths::collab_root().map(CollabPaths::new),
            Arc::new(AppSecrets),
        )
    }

    fn with(paths: Result<CollabPaths, String>, secrets: Arc<dyn SecretPort>) -> CollabState {
        CollabState {
            paths,
            secrets,
            keys: OnceCell::new(),
            registry: Mutex::new(()),
            sign_in: Mutex::new(None),
            sharing: Mutex::new(BTreeSet::new()),
            joins: Mutex::new(HashMap::new()),
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn client(&self, entry: &ServerEntry) -> Result<Arc<ServerClient>, CollabError> {
        let mut connections = locked(&self.connections);
        if let Some(known) = connections
            .get(&entry.server_id)
            .filter(|known| known.url == entry.url)
        {
            return Ok(Arc::clone(&known.client));
        }
        let client = Arc::new(ServerClient::new(ServerUrl::parse(&entry.url)?)?);
        connections.insert(
            entry.server_id,
            Connection {
                url: entry.url.clone(),
                client: Arc::clone(&client),
                verified: None,
            },
        );
        Ok(client)
    }

    pub(crate) fn verified_manifest(&self, server: ServerId) -> Option<CapabilityManifest> {
        locked(&self.connections)
            .get(&server)
            .and_then(|known| known.verified.as_ref())
            .filter(|(_, at)| at.elapsed() < PIN_KEPT)
            .map(|(manifest, _)| manifest.clone())
    }

    pub(crate) fn note_verified(&self, server: ServerId, manifest: CapabilityManifest) {
        if let Some(known) = locked(&self.connections).get_mut(&server) {
            known.verified = Some((manifest, Instant::now()));
        }
    }

    pub(crate) fn forget_verified(&self, server: ServerId) {
        if let Some(known) = locked(&self.connections).get_mut(&server) {
            known.verified = None;
        }
    }

    pub(crate) fn begin_share(&self, project_id: &str) -> Option<ShareTurn<'_>> {
        locked(&self.sharing)
            .insert(project_id.to_owned())
            .then(|| ShareTurn {
                state: self,
                project_id: project_id.to_owned(),
            })
    }

    pub(crate) fn begin_join(&self, server: ServerId, shared: SharedProjectId) -> JoinTicket<'_> {
        let mut joins = locked(&self.joins);
        let slot = Arc::clone(joins.entry((server, shared)).or_insert_with(|| {
            Arc::new(JoinSlot {
                turn: tokio::sync::Mutex::new(()),
                cancels: watch::Sender::new(0),
            })
        }));
        let since = *slot.cancels.borrow();
        JoinTicket {
            state: self,
            key: (server, shared),
            slot,
            since,
        }
    }

    pub(crate) fn cancel_joins(&self) {
        for slot in locked(&self.joins).values() {
            if Arc::strong_count(slot) > 1 {
                slot.cancels.send_modify(|count| *count += 1);
            }
        }
    }

    pub(crate) fn cancel_join(&self, server: ServerId, shared: SharedProjectId) -> bool {
        match locked(&self.joins).get(&(server, shared)) {
            Some(slot) if Arc::strong_count(slot) > 1 => {
                slot.cancels.send_modify(|count| *count += 1);
                true
            }
            _ => false,
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

    pub(crate) fn paths(&self) -> Result<&CollabPaths, CollabError> {
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
            sessions: Arc::new(SessionManager::new(
                Arc::clone(&self.secrets),
                Arc::clone(&key),
            )),
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
    fn only_one_share_of_a_project_runs_at_a_time() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let first = state.begin_share("paper").expect("the first share runs");
        assert!(state.begin_share("paper").is_none());
        let other = state.begin_share("thesis").expect("another project shares");
        drop(first);
        assert!(state.begin_share("paper").is_some());
        drop(other);
    }

    #[tokio::test]
    async fn cancelling_a_join_stops_the_running_ones_but_not_a_later_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let (server, shared) = (ServerId::new_v7(), SharedProjectId::new_v7());
        assert!(!state.cancel_join(server, shared));
        let running = state.begin_join(server, shared);
        let other = state.begin_join(server, SharedProjectId::new_v7());
        assert!(!running.is_cancelled());
        assert!(state.cancel_join(server, shared));
        assert!(running.is_cancelled());
        tokio::time::timeout(std::time::Duration::from_secs(5), running.until_cancelled())
            .await
            .expect("the cancel wakes the join");
        assert!(!other.is_cancelled());
        let later = state.begin_join(server, shared);
        assert!(!later.is_cancelled());
        drop(running);
        drop(later);
        assert!(!state.cancel_join(server, shared));
        assert!(locked(&state.joins).get(&(server, shared)).is_none());
    }

    #[tokio::test]
    async fn joins_of_one_project_take_turns() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_secrets, state) = collab_state(&dir);
        let (server, shared) = (ServerId::new_v7(), SharedProjectId::new_v7());
        let first = state.begin_join(server, shared);
        let second = state.begin_join(server, shared);
        let held = first.turn().await;
        assert!(second.slot.turn.try_lock().is_err());
        drop(held);
        assert!(second.slot.turn.try_lock().is_ok());
    }

    #[test]
    fn missing_collaboration_root_is_an_internal_error() {
        let state = CollabState::with(
            Err("no home folder".to_string()),
            Arc::new(MemorySecrets::default()),
        );
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
