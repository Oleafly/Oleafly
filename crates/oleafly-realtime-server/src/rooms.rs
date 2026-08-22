use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{Context, Result};
use oleafly_realtime_protocol::{
    authoring_doc, encode_server_to_client_frame_v1, snapshot_authoring_doc_v1,
    AuthoringDocSnapshotV1, AuthoringNodeSnapshotV1, ProjectCapability, ServerPresenceV1,
    ServerToClientFrameV1, ServerToClientMessageV1, SharedProjectId, AUTHORING_ROOTS,
    REALTIME_PROTOCOL_VERSION,
};
use tokio::{
    sync::{broadcast, Mutex, MutexGuard, Semaphore},
    time::timeout,
};
use uuid::Uuid;
use yrs::{updates::decoder::Decode, ReadTxn, StateVector, Transact, Update};
use zeroize::Zeroizing;

use crate::{
    config::ServerLimits,
    storage::{LoadedProject, Storage},
    yjs_preflight::{preflight_state_vector_v1, preflight_update_v1},
};

#[derive(Clone, Debug)]
pub enum RoomEvent {
    Frame {
        encoded: Vec<u8>,
        required_capability: ProjectCapability,
    },
    Fenced,
}

struct RoomState {
    full_state: Arc<Vec<u8>>,
    presence: HashMap<Uuid, ServerPresenceV1>,
    through_server_sequence: u64,
}

pub struct CandidateAuthoringDoc {
    full_state: Arc<Vec<u8>>,
    base_server_sequence: u64,
}

impl CandidateAuthoringDoc {
    pub fn full_state(&self) -> &[u8] {
        self.full_state.as_slice()
    }

    pub const fn base_server_sequence(&self) -> u64 {
        self.base_server_sequence
    }
}

#[derive(Clone)]
pub struct DecodeAdmission {
    permits: Arc<Semaphore>,
    timeout: Duration,
    limits: ServerLimits,
}

impl DecodeAdmission {
    pub fn new(limits: ServerLimits) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(limits.decode_concurrency)),
            timeout: Duration::from_millis(limits.decode_timeout_ms),
            limits,
        }
    }

    async fn run<T, F>(&self, task: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T> + Send + 'static,
    {
        let permit = self
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| anyhow::anyhow!("Yjs decode workers are saturated"))?;
        let worker = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            task()
        });
        timeout(self.timeout, worker)
            .await
            .context("Yjs decode and validation timed out")?
            .context("Yjs decode worker failed")?
    }
}

pub struct Room {
    project_key: Zeroizing<[u8; 32]>,
    state: Mutex<RoomState>,
    mutation_serial: Mutex<()>,
    events: broadcast::Sender<RoomEvent>,
    fenced: AtomicBool,
}

impl Room {
    fn load(
        loaded: LoadedProject,
        broadcast_capacity: usize,
        limits: &ServerLimits,
    ) -> Result<Self> {
        let doc = authoring_doc();
        register_authoring_roots(&doc);
        let had_state = loaded.snapshot.is_some() || !loaded.updates.is_empty();
        if let Some(snapshot) = loaded.snapshot {
            apply_trusted_update(&doc, &snapshot).context("replay encrypted authoring snapshot")?;
        }
        for update in loaded.updates {
            apply_trusted_update(&doc, &update)
                .context("replay encrypted authoring journal tail")?;
        }
        let full_state = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        if had_state {
            let snapshot =
                snapshot_authoring_doc_v1(&doc).context("validate reconstructed AuthoringDoc")?;
            validate_candidate_limits(&snapshot, &full_state, limits)?;
        }
        let (events, _) = broadcast::channel(broadcast_capacity);
        Ok(Self {
            project_key: loaded.project_key,
            state: Mutex::new(RoomState {
                full_state: Arc::new(full_state),
                presence: HashMap::new(),
                through_server_sequence: loaded.through_server_sequence,
            }),
            mutation_serial: Mutex::new(()),
            events,
            fenced: AtomicBool::new(false),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RoomEvent> {
        self.events.subscribe()
    }

    pub fn project_key(&self) -> &[u8; 32] {
        &self.project_key
    }

    pub async fn serialize_mutations(&self) -> MutexGuard<'_, ()> {
        self.mutation_serial.lock().await
    }

    pub async fn stage_update(
        &self,
        bytes: &[u8],
        admission: &DecodeAdmission,
    ) -> Result<CandidateAuthoringDoc> {
        self.ensure_active()?;
        let state = self.state.lock().await;
        let current = state.full_state.clone();
        let base_server_sequence = state.through_server_sequence;
        drop(state);
        let bytes = bytes.to_vec();
        let limits = admission.limits.clone();
        admission
            .run(move || {
                preflight_update_v1(&bytes, &limits)?;
                let candidate = authoring_doc();
                register_authoring_roots(&candidate);
                apply_trusted_update(&candidate, current.as_slice())
                    .context("stage current AuthoringDoc state")?;
                apply_trusted_update(&candidate, &bytes).context("stage AuthoringDoc mutation")?;
                let snapshot = snapshot_authoring_doc_v1(&candidate)
                    .context("validate staged AuthoringDoc mutation")?;
                let full_state = candidate
                    .transact()
                    .encode_state_as_update_v1(&StateVector::default());
                validate_candidate_limits(&snapshot, &full_state, &limits)?;
                Ok(CandidateAuthoringDoc {
                    full_state: Arc::new(full_state),
                    base_server_sequence,
                })
            })
            .await
    }

    pub async fn promote(&self, candidate: CandidateAuthoringDoc, server_sequence: u64) {
        let mut state = self.state.lock().await;
        state.full_state = candidate.full_state;
        state.through_server_sequence = state.through_server_sequence.max(server_sequence);
    }

    pub async fn diff(&self, state_vector: &[u8], admission: &DecodeAdmission) -> Result<Vec<u8>> {
        self.ensure_active()?;
        let current = self.state.lock().await.full_state.clone();
        let state_vector = state_vector.to_vec();
        let limits = admission.limits.clone();
        admission
            .run(move || {
                preflight_state_vector_v1(&state_vector, &limits)?;
                let doc = authoring_doc();
                register_authoring_roots(&doc);
                apply_trusted_update(&doc, current.as_slice())
                    .context("load AuthoringDoc for diff")?;
                let state_vector =
                    StateVector::decode_v1(&state_vector).context("decode Yjs state vector")?;
                let update = doc.transact().encode_state_as_update_v1(&state_vector);
                Ok(update)
            })
            .await
    }

    pub fn broadcast_authoring(&self, frame: &ServerToClientFrameV1) -> Result<()> {
        self.broadcast_frame(frame, ProjectCapability::SourceRead)
    }

    fn broadcast_frame(
        &self,
        frame: &ServerToClientFrameV1,
        required_capability: ProjectCapability,
    ) -> Result<()> {
        let encoded = encode_server_to_client_frame_v1(frame)?;
        self.ensure_active()?;
        let _ = self.events.send(RoomEvent::Frame {
            encoded,
            required_capability,
        });
        Ok(())
    }

    pub async fn set_presence(
        &self,
        connection_id: Uuid,
        presence: ServerPresenceV1,
    ) -> Result<()> {
        self.ensure_active()?;
        self.state
            .lock()
            .await
            .presence
            .insert(connection_id, presence.clone());
        self.broadcast_presence(presence)
    }

    pub async fn clear_presence(&self, connection_id: Uuid) -> Result<()> {
        let removed = self.state.lock().await.presence.remove(&connection_id);
        if let Some(mut presence) = removed {
            presence.selection = None;
            self.broadcast_presence(presence)?;
        }
        Ok(())
    }

    pub async fn existing_presence(&self) -> Vec<ServerPresenceV1> {
        self.state.lock().await.presence.values().cloned().collect()
    }

    fn broadcast_presence(&self, presence: ServerPresenceV1) -> Result<()> {
        self.broadcast_frame(
            &ServerToClientFrameV1 {
                protocol_version: REALTIME_PROTOCOL_VERSION,
                message: ServerToClientMessageV1::ServerPresence(presence),
            },
            ProjectCapability::PresenceJoin,
        )
    }

    pub fn fence(&self) {
        if !self.fenced.swap(true, Ordering::AcqRel) {
            let _ = self.events.send(RoomEvent::Fenced);
        }
    }

    fn ensure_active(&self) -> Result<()> {
        if self.fenced.load(Ordering::Acquire) {
            anyhow::bail!("authoring room was fenced and must reconnect");
        }
        Ok(())
    }
}

fn validate_candidate_limits(
    snapshot: &AuthoringDocSnapshotV1,
    full_state: &[u8],
    limits: &ServerLimits,
) -> Result<()> {
    if full_state.len() > limits.max_project_state_bytes {
        anyhow::bail!("AuthoringDoc state exceeds the configured project limit");
    }
    if snapshot.nodes.len() > limits.max_project_nodes {
        anyhow::bail!("AuthoringDoc contains too many nodes");
    }

    let mut materialized_bytes = 0usize;
    let mut total_text_bytes = 0usize;
    for node in &snapshot.nodes {
        let (name, collision_key) = match node {
            AuthoringNodeSnapshotV1::Directory {
                name,
                collision_key,
                ..
            }
            | AuthoringNodeSnapshotV1::Text {
                name,
                collision_key,
                ..
            }
            | AuthoringNodeSnapshotV1::Binary {
                name,
                collision_key,
                ..
            } => (name, collision_key),
        };
        if name.len() > limits.max_file_name_bytes {
            anyhow::bail!("AuthoringDoc file name exceeds the configured limit");
        }
        materialized_bytes = materialized_bytes
            .checked_add(name.len())
            .and_then(|value| value.checked_add(collision_key.len()))
            .context("AuthoringDoc materialized size overflow")?;
        match node {
            AuthoringNodeSnapshotV1::Text { text, .. } => {
                if text.len() > limits.max_text_file_bytes {
                    anyhow::bail!("AuthoringDoc text file exceeds the configured limit");
                }
                total_text_bytes = total_text_bytes
                    .checked_add(text.len())
                    .context("AuthoringDoc text size overflow")?;
                materialized_bytes = materialized_bytes
                    .checked_add(text.len())
                    .context("AuthoringDoc materialized size overflow")?;
            }
            AuthoringNodeSnapshotV1::Binary { binary_heads, .. } => {
                materialized_bytes = materialized_bytes
                    .checked_add(binary_heads.len().saturating_mul(71))
                    .context("AuthoringDoc materialized size overflow")?;
            }
            AuthoringNodeSnapshotV1::Directory { .. } => {}
        }
    }
    if total_text_bytes > limits.max_total_text_bytes {
        anyhow::bail!("AuthoringDoc total text exceeds the configured limit");
    }
    if materialized_bytes > limits.max_materialized_project_bytes {
        anyhow::bail!("AuthoringDoc materialized state exceeds the configured limit");
    }
    Ok(())
}

fn apply_trusted_update(doc: &yrs::Doc, bytes: &[u8]) -> Result<()> {
    doc.transact_mut().apply_update(Update::decode_v1(bytes)?)?;
    Ok(())
}

fn register_authoring_roots(doc: &yrs::Doc) {
    doc.get_or_insert_map(AUTHORING_ROOTS.metadata);
    doc.get_or_insert_map(AUTHORING_ROOTS.nodes);
    doc.get_or_insert_map(AUTHORING_ROOTS.texts);
    doc.get_or_insert_map(AUTHORING_ROOTS.binary_heads);
    doc.get_or_insert_array(AUTHORING_ROOTS.conflicts);
}

#[derive(Default)]
pub struct RoomRegistry {
    rooms: Mutex<HashMap<SharedProjectId, Arc<Room>>>,
}

impl RoomRegistry {
    pub async fn get(
        &self,
        storage: &Storage,
        project_id: SharedProjectId,
        broadcast_capacity: usize,
        admission: &DecodeAdmission,
    ) -> Result<Arc<Room>> {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get(&project_id) {
            return Ok(room.clone());
        }
        let loaded = storage.load_project(project_id).await?;
        let limits = admission.limits.clone();
        let room = Arc::new(
            admission
                .run(move || Room::load(loaded, broadcast_capacity, &limits))
                .await?,
        );
        rooms.insert(project_id, room.clone());
        Ok(room)
    }

    pub async fn invalidate(&self, project_id: SharedProjectId, room: &Arc<Room>) {
        room.fence();
        let mut rooms = self.rooms.lock().await;
        if rooms
            .get(&project_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, room))
        {
            rooms.remove(&project_id);
        }
    }

    pub async fn release(&self, project_id: SharedProjectId, room: &Arc<Room>) {
        let mut rooms = self.rooms.lock().await;
        let is_same_room = rooms
            .get(&project_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, room));
        if is_same_room && Arc::strong_count(room) <= 2 {
            rooms.remove(&project_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_room(capacity: usize) -> Arc<Room> {
        Arc::new(
            Room::load(
                LoadedProject {
                    project_key: Zeroizing::new([9; 32]),
                    snapshot: None,
                    updates: Vec::new(),
                    through_server_sequence: 0,
                },
                capacity,
                &ServerLimits::default(),
            )
            .unwrap(),
        )
    }

    #[tokio::test]
    async fn final_session_release_evicts_the_room() {
        let registry = RoomRegistry::default();
        let project_id = SharedProjectId::parse(&Uuid::now_v7().to_string()).unwrap();
        let room = empty_room(2);
        registry.rooms.lock().await.insert(project_id, room.clone());
        assert_eq!(registry.rooms.lock().await.len(), 1);
        registry.release(project_id, &room).await;
        assert!(registry.rooms.lock().await.is_empty());
    }

    #[tokio::test]
    async fn bounded_broadcast_marks_a_slow_receiver_as_lagged() {
        let room = empty_room(1);
        let mut receiver = room.subscribe();
        let frame = ServerToClientFrameV1 {
            protocol_version: REALTIME_PROTOCOL_VERSION,
            message: ServerToClientMessageV1::OpeningAccepted,
        };
        room.broadcast_authoring(&frame).unwrap();
        room.broadcast_authoring(&frame).unwrap();
        assert!(matches!(
            receiver.recv().await,
            Err(broadcast::error::RecvError::Lagged(_))
        ));
    }

    #[tokio::test]
    async fn saturated_decode_admission_rejects_before_binary_preflight() {
        let limits = ServerLimits {
            decode_concurrency: 1,
            decode_timeout_ms: 1_000,
            ..ServerLimits::default()
        };
        let admission = Arc::new(DecodeAdmission::new(limits));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker_admission = admission.clone();
        let worker = tokio::spawn(async move {
            worker_admission
                .run(move || {
                    let _ = started_tx.send(());
                    release_rx.recv().context("release decode worker")?;
                    Ok(())
                })
                .await
        });
        started_rx.await.unwrap();

        let room = empty_room(2);
        let stage_error = match room.stage_update(&[0xff], &admission).await {
            Ok(_) => panic!("saturated admission unexpectedly staged an update"),
            Err(error) => error,
        };
        for error in [
            stage_error,
            room.diff(&[0xff], &admission).await.unwrap_err(),
        ] {
            assert_eq!(error.to_string(), "Yjs decode workers are saturated");
        }

        release_tx.send(()).unwrap();
        worker.await.unwrap().unwrap();
    }
}
