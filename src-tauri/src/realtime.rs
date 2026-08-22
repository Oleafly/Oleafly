use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use base64::{engine::general_purpose, Engine};
use futures_util::{SinkExt, StreamExt};
use oleafly_realtime_protocol::{
    decode_client_to_server_frame_v1, decode_server_to_client_frame_v1,
    encode_client_to_server_frame_v1, ActorId, ClientToServerFrameV1, ClientToServerMessageV1,
    ClientUpdateId, FileId, OpeningAuthV1, ReplicaId, ServerInstanceId, ServerProfileId,
    ServerToClientMessageV1, SharedProjectId, REALTIME_PROTOCOL_VERSION,
};
use ring::{aead, rand as ring_rand};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

const EVENT_NAME: &str = "realtime://transport";
const STORAGE_VERSION: u8 = 1;
const STORAGE_DIRECTORY: &str = "realtime-v1";
const KEYRING_SERVICE: &str = "com.oleafly.desktop.realtime";
#[cfg(not(test))]
const KEYRING_MASTER_KEY_ACCOUNT: &str = "realtime-master-key-v1";

pub struct RealtimeState {
    sessions: Mutex<BTreeMap<String, SessionEntry>>,
    journal_locks: Mutex<BTreeMap<String, Arc<Mutex<()>>>>,
    binding_lock: Mutex<()>,
}

impl Default for RealtimeState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(BTreeMap::new()),
            journal_locks: Mutex::new(BTreeMap::new()),
            binding_lock: Mutex::new(()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindingIdentity {
    local_project_id: String,
    server_instance_id: ServerInstanceId,
    project_id: SharedProjectId,
    replica_id: ReplicaId,
    file_id: FileId,
}

impl BindingIdentity {
    fn validate(&self) -> Result<(), String> {
        if self.local_project_id.is_empty() || self.local_project_id.len() > 1024 {
            return Err("local project ID is invalid".into());
        }
        Ok(())
    }

    fn storage_key(&self) -> Result<String, String> {
        self.validate()?;
        canonical_hash(self)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenSessionInput {
    local_project_id: String,
    base_url: String,
    server_instance_id: ServerInstanceId,
    project_id: SharedProjectId,
    replica_id: ReplicaId,
    file_id: FileId,
    actor_id: Option<ActorId>,
    dev_token: Option<String>,
}

impl OpenSessionInput {
    fn identity(&self) -> BindingIdentity {
        BindingIdentity {
            local_project_id: self.local_project_id.clone(),
            server_instance_id: self.server_instance_id,
            project_id: self.project_id,
            replica_id: self.replica_id,
            file_id: self.file_id,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandle {
    id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistMutationInput {
    identity: BindingIdentity,
    session_id: String,
    client_update_id: ClientUpdateId,
    encoded_frame_base64: String,
    state_base64: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistMutationResult {
    pending_count: usize,
    queued: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersistReplicaStateInput {
    identity: BindingIdentity,
    state_base64: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DurableReceiptInput {
    client_update_id: ClientUpdateId,
    replica_id: ReplicaId,
    client_sequence: String,
    server_sequence: String,
    authorization_epoch: String,
    committed_at_unix_ms: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcknowledgeMutationInput {
    identity: BindingIdentity,
    receipt: DurableReceiptInput,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterializationBatch {
    identity: BindingIdentity,
    files: Vec<MaterializedFile>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterializedFile {
    file_id: FileId,
    path: String,
    content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerDescriptor {
    server_instance_id: ServerInstanceId,
    protocol_versions: Vec<u16>,
    web_socket_url_template: String,
    experimental: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBootstrap {
    project_id: SharedProjectId,
    clients: Vec<DevBootstrapClient>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    access_token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevBootstrapClient {
    actor_id: ActorId,
    replica_id: ReplicaId,
    display_name: String,
    #[serde(rename = "ticket", skip_serializing)]
    _ticket: String,
    #[serde(rename = "expiresInSeconds", skip_serializing)]
    _expires_in_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSharedProjectBinding {
    local_project_id: String,
    server_profile_id: ServerProfileId,
    server_instance_id: ServerInstanceId,
    project_id: SharedProjectId,
    replica_id: ReplicaId,
    file_id: FileId,
    path: String,
    state: String,
}

impl DesktopSharedProjectBinding {
    fn identity(&self) -> BindingIdentity {
        BindingIdentity {
            local_project_id: self.local_project_id.clone(),
            server_instance_id: self.server_instance_id,
            project_id: self.project_id,
            replica_id: self.replica_id,
            file_id: self.file_id,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplicaBundle {
    client_sequence: u64,
    state_base64: String,
    pending: Vec<PendingJournalEntry>,
    #[serde(default)]
    acknowledged: Vec<AcknowledgedMutation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingJournalEntry {
    client_update_id: ClientUpdateId,
    replica_id: ReplicaId,
    client_sequence: u64,
    encoded_frame_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcknowledgedMutation {
    client_update_id: ClientUpdateId,
    replica_id: ReplicaId,
    client_sequence: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaHydration {
    client_sequence: String,
    state_base64: String,
    pending: Vec<PendingHydrationEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingHydrationEntry {
    client_update_id: ClientUpdateId,
    replica_id: ReplicaId,
    client_sequence: String,
    encoded_frame_base64: String,
}

#[derive(Clone)]
struct SessionEntry {
    identity: BindingIdentity,
    sender: mpsc::Sender<SessionCommand>,
}

enum SessionCommand {
    SendEphemeral(Vec<u8>),
    SendPersistedMutation(Vec<u8>),
    Close,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TransportEvent<'a> {
    Connected {
        session_id: &'a str,
    },
    Disconnected {
        session_id: &'a str,
        reason: &'a str,
    },
    Frame {
        session_id: &'a str,
        bytes_base64: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedEnvelope {
    version: u8,
    nonce_base64: String,
    ciphertext_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageAad<'a> {
    version: u8,
    object_kind: &'a str,
    identity: &'a BindingIdentity,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BindingAad<'a> {
    version: u8,
    object_kind: &'a str,
    local_project_id: &'a str,
}

#[tauri::command]
pub async fn realtime_discover(base_url: String) -> Result<ServerDescriptor, String> {
    validate_base_url(&base_url)?;
    reqwest::Client::new()
        .get(format!(
            "{}/.well-known/oleafly-realtime",
            base_url.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|error| format!("server discovery failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("server discovery was rejected: {error}"))?
        .json()
        .await
        .map_err(|error| format!("server discovery response is invalid: {error}"))
}

#[tauri::command]
pub async fn realtime_dev_bootstrap(
    base_url: String,
    dev_token: String,
) -> Result<DevBootstrap, String> {
    require_loopback_development_url(&base_url)?;
    reqwest::Client::new()
        .post(format!(
            "{}/v1/dev/bootstrap",
            base_url.trim_end_matches('/')
        ))
        .bearer_auth(dev_token)
        .send()
        .await
        .map_err(|error| format!("development bootstrap failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("development bootstrap was rejected: {error}"))?
        .json()
        .await
        .map_err(|error| format!("development bootstrap response is invalid: {error}"))
}

#[tauri::command]
pub async fn realtime_local_login(
    base_url: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let normalized = normalized_base_url(&base_url)?;
    let response: LoginResponse = reqwest::Client::new()
        .post(format!("{normalized}/v1/auth/local/login"))
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .map_err(|error| format!("local login failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("local login was rejected: {error}"))?
        .json()
        .await
        .map_err(|error| format!("local login response is invalid: {error}"))?;
    set_platform_credential(&access_token_account(&normalized), &response.access_token)
}

#[tauri::command]
pub async fn realtime_get_binding(
    state: State<'_, RealtimeState>,
    local_project_id: String,
) -> Result<Option<DesktopSharedProjectBinding>, String> {
    validate_local_project_id(&local_project_id)?;
    let _guard = state.binding_lock.lock().await;
    load_binding(&local_project_id)
}

#[tauri::command]
pub async fn realtime_store_binding(
    state: State<'_, RealtimeState>,
    binding: DesktopSharedProjectBinding,
) -> Result<(), String> {
    let identity = binding.identity();
    identity.validate()?;
    if binding.path.is_empty() || binding.path.len() > 4096 {
        return Err("shared file path is invalid".into());
    }
    crate::sandbox::resolve_in_project(&binding.local_project_id, &binding.path)?;
    let _guard = state.binding_lock.lock().await;
    if let Some(existing) = load_binding(&binding.local_project_id)? {
        validate_binding_replacement(&existing, &binding)?;
    }
    save_binding(&binding)
}

#[tauri::command]
pub async fn realtime_open_session(
    app: AppHandle,
    state: State<'_, RealtimeState>,
    input: OpenSessionInput,
) -> Result<SessionHandle, String> {
    validate_base_url(&input.base_url)?;
    let identity = input.identity();
    identity.validate()?;
    if input.dev_token.is_some() {
        require_loopback_development_url(&input.base_url)?;
    }
    if input.dev_token.is_none() {
        let normalized = normalized_base_url(&input.base_url)?;
        if get_platform_credential(&access_token_account(&normalized))?.is_none() {
            return Err("this server profile is not authenticated".into());
        }
    }
    ensure_binding_matches(&identity)?;

    let random = random_bytes::<16>()?;
    let id = format!(
        "{}:{}",
        identity.storage_key()?,
        general_purpose::URL_SAFE_NO_PAD.encode(random)
    );
    let (sender, receiver) = mpsc::channel(128);
    let previous_sender = {
        let mut sessions = state.sessions.lock().await;
        let previous = sessions
            .iter()
            .find(|(_, entry)| entry.identity == identity)
            .map(|(id, entry)| (id.clone(), entry.sender.clone()));
        let previous_sender = previous.map(|(previous_id, previous_sender)| {
            sessions.remove(&previous_id);
            previous_sender
        });
        sessions.insert(id.clone(), SessionEntry { identity, sender });
        previous_sender
    };
    if let Some(previous_sender) = previous_sender {
        let _ = previous_sender.send(SessionCommand::Close).await;
    }

    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        run_session(app, task_id, input, receiver).await;
    });
    Ok(SessionHandle { id })
}

#[tauri::command]
pub async fn realtime_send_ephemeral_frame(
    state: State<'_, RealtimeState>,
    session_id: String,
    frame_base64: String,
) -> Result<(), String> {
    let entry = state
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "realtime session is not open".to_owned())?;
    let bytes = validate_ephemeral_frame(&entry.identity, &frame_base64)?;
    entry
        .sender
        .send(SessionCommand::SendEphemeral(bytes))
        .await
        .map_err(|_| "realtime session has closed".to_owned())
}

fn validate_ephemeral_frame(
    identity: &BindingIdentity,
    frame_base64: &str,
) -> Result<Vec<u8>, String> {
    let bytes = decode_base64(frame_base64, "realtime frame")?;
    let frame = decode_client_to_server_frame_v1(&bytes)
        .map_err(|error| format!("realtime client frame is invalid: {error}"))?;
    match frame.message {
        ClientToServerMessageV1::StateVectorRequest(_) => {}
        ClientToServerMessageV1::ClientPresence(presence) => {
            if let Some(selection) = presence.selection {
                if selection.file_id != identity.file_id {
                    return Err("presence FileId does not match the open shared file".into());
                }
            }
        }
        ClientToServerMessageV1::Mutation(_) => {
            return Err("mutation frames require atomic native persistence".into())
        }
        ClientToServerMessageV1::OpeningAuth(_) => {
            return Err("opening authentication is owned by the native transport".into())
        }
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn realtime_close_session(
    state: State<'_, RealtimeState>,
    session_id: String,
) -> Result<(), String> {
    if let Some(entry) = state.sessions.lock().await.remove(&session_id) {
        let _ = entry.sender.send(SessionCommand::Close).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn realtime_hydrate_replica(
    state: State<'_, RealtimeState>,
    identity: BindingIdentity,
) -> Result<ReplicaHydration, String> {
    identity.validate()?;
    ensure_binding_matches(&identity)?;
    let lock = journal_lock(&state, &identity).await?;
    let _guard = lock.lock().await;
    let bundle = load_bundle(&identity)?;
    Ok(ReplicaHydration {
        client_sequence: bundle.client_sequence.to_string(),
        state_base64: bundle.state_base64,
        pending: bundle
            .pending
            .into_iter()
            .map(|entry| PendingHydrationEntry {
                client_update_id: entry.client_update_id,
                replica_id: entry.replica_id,
                client_sequence: entry.client_sequence.to_string(),
                encoded_frame_base64: entry.encoded_frame_base64,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn realtime_persist_and_send_mutation(
    state: State<'_, RealtimeState>,
    input: PersistMutationInput,
) -> Result<PersistMutationResult, String> {
    input.identity.validate()?;
    ensure_binding_matches(&input.identity)?;
    let state_bytes = decode_base64(&input.state_base64, "replica state")?;
    if state_bytes.is_empty() {
        return Err("replica state cannot be empty for a mutation".into());
    }
    let frame_bytes = decode_base64(&input.encoded_frame_base64, "pending mutation frame")?;
    let frame = decode_client_to_server_frame_v1(&frame_bytes)
        .map_err(|error| format!("pending mutation frame is invalid: {error}"))?;
    let ClientToServerMessageV1::Mutation(envelope) = frame.message else {
        return Err("atomic mutation command accepts mutation frames only".into());
    };
    if envelope.client_update_id != input.client_update_id {
        return Err("pending mutation ID does not match its encoded frame".into());
    }
    if envelope.replica_id != input.identity.replica_id {
        return Err("pending mutation replica does not match the binding".into());
    }

    let session = state.sessions.lock().await.get(&input.session_id).cloned();
    if let Some(entry) = &session {
        if entry.identity != input.identity {
            return Err("realtime session does not match the mutation binding".into());
        }
    }

    let lock = journal_lock(&state, &input.identity).await?;
    let pending_count;
    {
        let _guard = lock.lock().await;
        let mut bundle = load_bundle(&input.identity)?;
        if let Some(existing) = bundle
            .pending
            .iter()
            .find(|entry| entry.client_update_id == input.client_update_id)
        {
            if existing.replica_id != envelope.replica_id
                || existing.client_sequence != envelope.client_sequence
                || existing.encoded_frame_base64 != input.encoded_frame_base64
            {
                return Err("client update ID was already used for a different mutation".into());
            }
        } else {
            let expected = bundle
                .client_sequence
                .checked_add(1)
                .ok_or_else(|| "realtime client sequence is exhausted".to_owned())?;
            if envelope.client_sequence != expected {
                return Err(format!(
                    "mutation client sequence must be {expected}, got {}",
                    envelope.client_sequence
                ));
            }
            bundle.client_sequence = envelope.client_sequence;
            bundle.pending.push(PendingJournalEntry {
                client_update_id: envelope.client_update_id,
                replica_id: envelope.replica_id,
                client_sequence: envelope.client_sequence,
                encoded_frame_base64: input.encoded_frame_base64,
            });
            bundle.pending.sort_by_key(|entry| entry.client_sequence);
        }
        bundle.state_base64 = general_purpose::STANDARD.encode(state_bytes);
        pending_count = bundle.pending.len();
        save_bundle(&input.identity, &bundle)?;
    }

    let queued = if let Some(entry) = session {
        entry
            .sender
            .send(SessionCommand::SendPersistedMutation(frame_bytes))
            .await
            .is_ok()
    } else {
        false
    };
    Ok(PersistMutationResult {
        pending_count,
        queued,
    })
}

#[tauri::command]
pub async fn realtime_persist_replica_state(
    state: State<'_, RealtimeState>,
    input: PersistReplicaStateInput,
) -> Result<(), String> {
    input.identity.validate()?;
    ensure_binding_matches(&input.identity)?;
    let state_bytes = decode_base64(&input.state_base64, "replica state")?;
    let lock = journal_lock(&state, &input.identity).await?;
    let _guard = lock.lock().await;
    let mut bundle = load_bundle(&input.identity)?;
    bundle.state_base64 = general_purpose::STANDARD.encode(state_bytes);
    save_bundle(&input.identity, &bundle)
}

#[tauri::command]
pub async fn realtime_acknowledge_mutation(
    state: State<'_, RealtimeState>,
    input: AcknowledgeMutationInput,
) -> Result<(), String> {
    input.identity.validate()?;
    ensure_binding_matches(&input.identity)?;
    let client_sequence = parse_receipt_u64(&input.receipt.client_sequence)?;
    for value in [
        &input.receipt.server_sequence,
        &input.receipt.authorization_epoch,
        &input.receipt.committed_at_unix_ms,
    ] {
        parse_receipt_u64(value)?;
    }
    if input.receipt.replica_id != input.identity.replica_id {
        return Err("durable receipt replica does not match the binding".into());
    }

    let lock = journal_lock(&state, &input.identity).await?;
    let _guard = lock.lock().await;
    let mut bundle = load_bundle(&input.identity)?;
    let Some(index) = bundle
        .pending
        .iter()
        .position(|entry| entry.client_update_id == input.receipt.client_update_id)
    else {
        if bundle.acknowledged.iter().any(|entry| {
            entry.client_update_id == input.receipt.client_update_id
                && entry.replica_id == input.receipt.replica_id
                && entry.client_sequence == client_sequence
        }) {
            return Ok(());
        }
        return Err("durable receipt does not match a pending mutation".into());
    };
    let stored = &bundle.pending[index];
    let stored_bytes = decode_base64(&stored.encoded_frame_base64, "stored mutation frame")?;
    let stored_frame = decode_client_to_server_frame_v1(&stored_bytes)
        .map_err(|error| format!("stored mutation frame is invalid: {error}"))?;
    let ClientToServerMessageV1::Mutation(stored_envelope) = stored_frame.message else {
        return Err("stored journal entry is not a mutation".into());
    };
    validate_receipt_identity(stored, &stored_envelope, &input.receipt, client_sequence)?;
    bundle.pending.remove(index);
    bundle.acknowledged.push(AcknowledgedMutation {
        client_update_id: input.receipt.client_update_id,
        replica_id: input.receipt.replica_id,
        client_sequence,
    });
    if bundle.acknowledged.len() > 1024 {
        let excess = bundle.acknowledged.len() - 1024;
        bundle.acknowledged.drain(..excess);
    }
    save_bundle(&input.identity, &bundle)
}

fn validate_receipt_identity(
    stored: &PendingJournalEntry,
    envelope: &oleafly_realtime_protocol::MutationEnvelopeV1,
    receipt: &DurableReceiptInput,
    client_sequence: u64,
) -> Result<(), String> {
    if stored.replica_id != receipt.replica_id
        || stored.client_sequence != client_sequence
        || envelope.client_update_id != receipt.client_update_id
        || envelope.replica_id != receipt.replica_id
        || envelope.client_sequence != client_sequence
    {
        return Err("durable receipt identity does not match the stored mutation".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn realtime_materialize(
    state: State<'_, RealtimeState>,
    batch: MaterializationBatch,
) -> Result<(), String> {
    batch.identity.validate()?;
    let binding = {
        let _guard = state.binding_lock.lock().await;
        load_binding(&batch.identity.local_project_id)?
            .ok_or_else(|| "local project has no saved realtime binding".to_owned())?
    };
    let file = materialization_target(&binding, &batch)?;
    let local_project_id = binding.local_project_id.clone();
    let saved_path = binding.path.clone();
    let content = file.content.clone();
    let lock = journal_lock(&state, &batch.identity).await?;
    let _guard = lock.lock().await;
    // Renderer paths are untrusted. Resolve and write only the immutable path
    // sealed into the encrypted native binding for this composite identity.
    crate::sandbox::resolve_in_project(&local_project_id, &saved_path)?;
    crate::project::write_file(local_project_id, saved_path, content, None).await?;
    Ok(())
}

fn validate_binding_replacement(
    existing: &DesktopSharedProjectBinding,
    incoming: &DesktopSharedProjectBinding,
) -> Result<(), String> {
    if existing.identity() != incoming.identity()
        || existing.server_profile_id != incoming.server_profile_id
        || existing.path != incoming.path
    {
        return Err(
            "saved realtime binding does not match server profile, server, project, replica, file, and path"
                .into(),
        );
    }
    Ok(())
}

fn materialization_target<'a>(
    binding: &DesktopSharedProjectBinding,
    batch: &'a MaterializationBatch,
) -> Result<&'a MaterializedFile, String> {
    if binding.identity() != batch.identity {
        return Err("realtime binding identity does not match saved binding".into());
    }
    if batch.files.len() != 1 || batch.files[0].file_id != binding.file_id {
        return Err("this collaboration slice materializes exactly its configured FileId".into());
    }
    if batch.files[0].path != binding.path {
        return Err(
            "renderer materialization path does not match the saved realtime binding".into(),
        );
    }
    Ok(&batch.files[0])
}

async fn journal_lock(
    state: &RealtimeState,
    identity: &BindingIdentity,
) -> Result<Arc<Mutex<()>>, String> {
    let key = identity.storage_key()?;
    let mut locks = state.journal_locks.lock().await;
    Ok(locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

async fn run_session(
    app: AppHandle,
    session_id: String,
    input: OpenSessionInput,
    mut receiver: mpsc::Receiver<SessionCommand>,
) {
    loop {
        let result = connect_once(&app, &session_id, &input, &mut receiver).await;
        match result {
            SessionResult::Closed => return,
            SessionResult::Reconnect(reason) => {
                emit_disconnected(&app, &session_id, &reason);
                tokio::select! {
                    () = tokio::time::sleep(Duration::from_millis(500)) => {}
                    command = receiver.recv() => match command {
                        Some(SessionCommand::Close) | None => return,
                        Some(SessionCommand::SendPersistedMutation(_))
                        | Some(SessionCommand::SendEphemeral(_)) => {}
                    }
                }
            }
        }
    }
}

enum SessionResult {
    Closed,
    Reconnect(String),
}

async fn connect_once(
    app: &AppHandle,
    session_id: &str,
    input: &OpenSessionInput,
    receiver: &mut mpsc::Receiver<SessionCommand>,
) -> SessionResult {
    let prepared = tokio::select! {
        result = prepare_connection(input) => match result {
            Ok(prepared) => prepared,
            Err(error) => return SessionResult::Reconnect(error),
        },
        command = receiver.recv() => return command_before_connection(command),
    };
    let PreparedConnection {
        ticket,
        websocket_url,
    } = prepared;
    let (mut websocket, _) = tokio::select! {
        result = connect_async(websocket_url.as_str()) => match result {
            Ok(value) => value,
            Err(error) => return SessionResult::Reconnect(format!("WebSocket connection failed: {error}")),
        },
        command = receiver.recv() => return command_before_connection(command),
    };
    let opening = ClientToServerFrameV1 {
        protocol_version: 0,
        message: ClientToServerMessageV1::OpeningAuth(OpeningAuthV1 {
            supported_versions: vec![REALTIME_PROTOCOL_VERSION],
            ticket,
        }),
    };
    let opening = match encode_client_to_server_frame_v1(&opening) {
        Ok(frame) => frame,
        Err(error) => return SessionResult::Reconnect(error.to_string()),
    };
    if let Err(error) = websocket.send(Message::Binary(opening.into())).await {
        return SessionResult::Reconnect(format!("opening authentication failed: {error}"));
    }
    let opening_response = tokio::select! {
        response = websocket.next() => response,
        command = receiver.recv() => {
            let _ = websocket.close(None).await;
            return command_before_connection(command);
        }
    };
    match opening_response {
        Some(Ok(Message::Binary(bytes))) => match decode_server_to_client_frame_v1(&bytes) {
            Ok(frame) if matches!(frame.message, ServerToClientMessageV1::OpeningAccepted) => {}
            _ => return SessionResult::Reconnect("server rejected realtime opening".into()),
        },
        other => {
            return SessionResult::Reconnect(format!(
                "server closed during realtime opening: {other:?}"
            ))
        }
    }

    let identity = input.identity();
    let bundle = match load_bundle(&identity) {
        Ok(bundle) => bundle,
        Err(error) => return SessionResult::Reconnect(error),
    };
    for entry in &bundle.pending {
        let frame = match decode_base64(&entry.encoded_frame_base64, "pending mutation") {
            Ok(frame) => frame,
            Err(error) => return SessionResult::Reconnect(error),
        };
        if websocket
            .send(Message::Binary(frame.clone().into()))
            .await
            .is_err()
        {
            return SessionResult::Reconnect(
                "connection closed while replaying safe local changes".into(),
            );
        }
        #[cfg(feature = "e2e-testing")]
        {
            let _ = app.emit(
                "realtime://e2e-replay",
                serde_json::json!({
                    "sessionId": session_id,
                    "encodedFrameBase64": general_purpose::STANDARD.encode(frame),
                }),
            );
        }
    }
    let _ = app.emit(EVENT_NAME, TransportEvent::Connected { session_id });

    loop {
        tokio::select! {
            command = receiver.recv() => match command {
                Some(SessionCommand::SendEphemeral(frame))
                | Some(SessionCommand::SendPersistedMutation(frame)) => {
                    if let Err(error) = websocket.send(Message::Binary(frame.into())).await {
                        return SessionResult::Reconnect(format!("realtime send failed: {error}"));
                    }
                }
                Some(SessionCommand::Close) | None => {
                    let _ = websocket.close(None).await;
                    return SessionResult::Closed;
                }
            },
            incoming = websocket.next() => match incoming {
                Some(Ok(Message::Binary(bytes))) => {
                    if decode_server_to_client_frame_v1(&bytes).is_err() {
                        return SessionResult::Reconnect("server sent an invalid realtime frame".into());
                    }
                    let _ = app.emit(EVENT_NAME, TransportEvent::Frame {
                        session_id,
                        bytes_base64: general_purpose::STANDARD.encode(bytes),
                    });
                }
                Some(Ok(Message::Ping(payload))) => {
                    if websocket.send(Message::Pong(payload)).await.is_err() {
                        return SessionResult::Reconnect("realtime pong failed".into());
                    }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => {
                    return SessionResult::Reconnect("realtime server closed the connection".into());
                }
                Some(Ok(_)) => return SessionResult::Reconnect("realtime server sent a non-binary message".into()),
                Some(Err(error)) => return SessionResult::Reconnect(format!("realtime receive failed: {error}")),
            }
        }
    }
}

#[derive(Debug)]
struct PreparedConnection {
    ticket: [u8; 32],
    websocket_url: Url,
}

async fn prepare_connection(input: &OpenSessionInput) -> Result<PreparedConnection, String> {
    // Discovery sends no credential. Verify instance identity, protocol,
    // transport scheme, and origin before issuing a bearer-authenticated ticket.
    let descriptor = realtime_discover(input.base_url.clone()).await?;
    if descriptor.server_instance_id != input.server_instance_id {
        return Err("server discovery instance does not match the trusted binding".into());
    }
    if !descriptor
        .protocol_versions
        .contains(&REALTIME_PROTOCOL_VERSION)
    {
        return Err("server does not support realtime protocol v1".into());
    }
    let websocket_url = descriptor
        .web_socket_url_template
        .replace("{projectId}", &input.project_id.to_string());
    let websocket_url = validate_websocket_url(&input.base_url, &websocket_url)?;
    let ticket = issue_ticket(input).await?;
    Ok(PreparedConnection {
        ticket,
        websocket_url,
    })
}

fn command_before_connection(command: Option<SessionCommand>) -> SessionResult {
    match command {
        Some(SessionCommand::Close) | None => SessionResult::Closed,
        Some(SessionCommand::SendPersistedMutation(_)) | Some(SessionCommand::SendEphemeral(_)) => {
            SessionResult::Reconnect("connection is not ready".into())
        }
    }
}

#[derive(Deserialize)]
struct TicketResponse {
    ticket: String,
}

async fn issue_ticket(input: &OpenSessionInput) -> Result<[u8; 32], String> {
    let client = reqwest::Client::new();
    let base = normalized_base_url(&input.base_url)?;
    let request = if let Some(dev_token) = &input.dev_token {
        let actor_id = input
            .actor_id
            .ok_or_else(|| "development session is missing actorId".to_owned())?;
        client
            .post(format!(
                "{base}/v1/dev/projects/{}/tickets",
                input.project_id
            ))
            .bearer_auth(dev_token)
            .json(&serde_json::json!({
                "actorId": actor_id,
                "replicaId": input.replica_id,
            }))
    } else {
        let access_token = get_platform_credential(&access_token_account(&base))?
            .ok_or_else(|| "this server profile is not authenticated".to_owned())?;
        client
            .post(format!(
                "{base}/v1/projects/{}/sync-tickets",
                input.project_id
            ))
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "replicaId": input.replica_id }))
    };
    let response: TicketResponse = request
        .send()
        .await
        .map_err(|error| format!("sync ticket request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("sync ticket request was rejected: {error}"))?
        .json()
        .await
        .map_err(|error| format!("sync ticket response is invalid: {error}"))?;
    general_purpose::URL_SAFE_NO_PAD
        .decode(response.ticket)
        .map_err(|error| format!("sync ticket is malformed: {error}"))?
        .try_into()
        .map_err(|_| "sync ticket has an invalid length".to_owned())
}

fn validate_base_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("server URL is invalid: {error}"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("realtime server URL cannot contain credentials, query, or fragment".into());
    }
    match url.scheme() {
        "https" => Ok(url),
        "http" if cfg!(debug_assertions) && is_loopback(&url) => Ok(url),
        "http" if is_loopback(&url) => {
            Err("loopback plaintext realtime is disabled in production builds".into())
        }
        "http" => Err("plaintext realtime is allowed only on loopback development builds".into()),
        _ => Err("realtime server URL must use HTTPS".into()),
    }
}

fn normalized_base_url(value: &str) -> Result<String, String> {
    let mut url = validate_base_url(value)?;
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

fn require_loopback_development_url(value: &str) -> Result<(), String> {
    let url = validate_base_url(value)?;
    if !cfg!(debug_assertions) || url.scheme() != "http" || !is_loopback(&url) {
        return Err("development bootstrap requires a debug build and loopback HTTP".into());
    }
    Ok(())
}

fn validate_websocket_url(base_url: &str, websocket_url: &str) -> Result<Url, String> {
    let base = validate_base_url(base_url)?;
    let websocket =
        Url::parse(websocket_url).map_err(|error| format!("WebSocket URL is invalid: {error}"))?;
    let expected_scheme = if base.scheme() == "https" {
        "wss"
    } else {
        "ws"
    };
    if websocket.scheme() != expected_scheme {
        return Err("discovered WebSocket URL attempts a transport downgrade".into());
    }
    if websocket.host_str() != base.host_str()
        || websocket.port_or_known_default() != base.port_or_known_default()
    {
        return Err("discovered WebSocket URL crosses the trusted server origin".into());
    }
    if expected_scheme == "ws" && (!cfg!(debug_assertions) || !is_loopback(&websocket)) {
        return Err("plaintext WebSocket is allowed only for loopback development".into());
    }
    if !websocket.username().is_empty()
        || websocket.password().is_some()
        || websocket.query().is_some()
        || websocket.fragment().is_some()
    {
        return Err("discovered WebSocket URL contains forbidden URL components".into());
    }
    Ok(websocket)
}

fn is_loopback(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    )
}

fn validate_local_project_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 1024 {
        return Err("local project ID is invalid".into());
    }
    Ok(())
}

fn access_token_account(base_url: &str) -> String {
    format!("access-token-v1:{}", hash_bytes(base_url.as_bytes()))
}

fn binding_path(local_project_id: &str) -> Result<PathBuf, String> {
    validate_local_project_id(local_project_id)?;
    Ok(storage_root()?.join(format!(
        "binding-{}.bin",
        hash_bytes(local_project_id.as_bytes())
    )))
}

fn bundle_path(identity: &BindingIdentity) -> Result<PathBuf, String> {
    Ok(storage_root()?.join(format!("replica-{}.bin", identity.storage_key()?)))
}

fn storage_root() -> Result<PathBuf, String> {
    let root = crate::paths::oleafly_root()?.join(STORAGE_DIRECTORY);
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("realtime storage path is not a real directory".into())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(&root)
                .map_err(|error| format!("could not create realtime storage: {error}"))?;
        }
        Err(error) => return Err(format!("could not inspect realtime storage: {error}")),
    }
    Ok(root)
}

fn canonical_hash(value: &impl Serialize) -> Result<String, String> {
    let encoded = serde_json::to_vec(value)
        .map_err(|error| format!("could not encode realtime storage identity: {error}"))?;
    Ok(hash_bytes(&encoded))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn load_binding(local_project_id: &str) -> Result<Option<DesktopSharedProjectBinding>, String> {
    let path = binding_path(local_project_id)?;
    let aad = serde_json::to_vec(&BindingAad {
        version: STORAGE_VERSION,
        object_kind: "binding",
        local_project_id,
    })
    .map_err(|error| format!("could not encode binding identity: {error}"))?;
    read_encrypted_json(&path, &aad)
}

fn save_binding(binding: &DesktopSharedProjectBinding) -> Result<(), String> {
    let path = binding_path(&binding.local_project_id)?;
    let aad = serde_json::to_vec(&BindingAad {
        version: STORAGE_VERSION,
        object_kind: "binding",
        local_project_id: &binding.local_project_id,
    })
    .map_err(|error| format!("could not encode binding identity: {error}"))?;
    write_encrypted_json(&path, &aad, binding)
}

fn ensure_binding_matches(identity: &BindingIdentity) -> Result<(), String> {
    match load_binding(&identity.local_project_id)? {
        Some(binding) if binding.identity() == *identity => Ok(()),
        Some(_) => Err("realtime binding identity does not match saved binding".into()),
        None => Err("local project has no saved realtime binding".into()),
    }
}

fn load_bundle(identity: &BindingIdentity) -> Result<ReplicaBundle, String> {
    let path = bundle_path(identity)?;
    let aad = serde_json::to_vec(&StorageAad {
        version: STORAGE_VERSION,
        object_kind: "replica_bundle",
        identity,
    })
    .map_err(|error| format!("could not encode replica identity: {error}"))?;
    Ok(read_encrypted_json(&path, &aad)?.unwrap_or_default())
}

fn save_bundle(identity: &BindingIdentity, bundle: &ReplicaBundle) -> Result<(), String> {
    let path = bundle_path(identity)?;
    let aad = serde_json::to_vec(&StorageAad {
        version: STORAGE_VERSION,
        object_kind: "replica_bundle",
        identity,
    })
    .map_err(|error| format!("could not encode replica identity: {error}"))?;
    write_encrypted_json(&path, &aad, bundle)
}

fn read_encrypted_json<T: for<'de> Deserialize<'de>>(
    path: &Path,
    aad: &[u8],
) -> Result<Option<T>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not read encrypted realtime data: {error}")),
    };
    let plaintext = decrypt_envelope(storage_key()?, aad, &bytes)?;
    serde_json::from_slice(&plaintext)
        .map(Some)
        .map_err(|error| format!("encrypted realtime data is corrupt: {error}"))
}

fn write_encrypted_json<T: Serialize>(path: &Path, aad: &[u8], value: &T) -> Result<(), String> {
    let plaintext = serde_json::to_vec(value)
        .map_err(|error| format!("could not encode encrypted realtime data: {error}"))?;
    let bytes = encrypt_envelope(storage_key()?, aad, &plaintext)?;
    write_private_atomic(path, &bytes)
}

fn encrypt_envelope(key: [u8; 32], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let nonce = random_bytes::<12>()?;
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "could not initialize realtime encryption".to_owned())?;
    let key = aead::LessSafeKey::new(unbound);
    let mut ciphertext = plaintext.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(aad),
        &mut ciphertext,
    )
    .map_err(|_| "could not encrypt realtime data".to_owned())?;
    serde_json::to_vec(&EncryptedEnvelope {
        version: STORAGE_VERSION,
        nonce_base64: general_purpose::STANDARD.encode(nonce),
        ciphertext_base64: general_purpose::STANDARD.encode(ciphertext),
    })
    .map_err(|error| format!("could not encode realtime encryption envelope: {error}"))
}

fn decrypt_envelope(key: [u8; 32], aad: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
    let envelope: EncryptedEnvelope = serde_json::from_slice(bytes)
        .map_err(|error| format!("realtime encryption envelope is invalid: {error}"))?;
    if envelope.version != STORAGE_VERSION {
        return Err("realtime encryption envelope version is unsupported".into());
    }
    let nonce: [u8; 12] = decode_base64(&envelope.nonce_base64, "realtime nonce")?
        .try_into()
        .map_err(|_| "realtime nonce has an invalid length".to_owned())?;
    let mut ciphertext = decode_base64(&envelope.ciphertext_base64, "realtime ciphertext")?;
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &key)
        .map_err(|_| "could not initialize realtime decryption".to_owned())?;
    let key = aead::LessSafeKey::new(unbound);
    key.open_in_place(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(aad),
        &mut ciphertext,
    )
    .map(|plaintext| plaintext.to_vec())
    .map_err(|_| "realtime data failed binding-authenticated decryption".to_owned())
}

fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_private_atomic_with_parent_sync(path, bytes, sync_realtime_parent)
}

fn write_private_atomic_with_parent_sync<F>(
    path: &Path,
    bytes: &[u8],
    sync_parent: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| "realtime storage path has no parent".to_owned())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("could not create realtime storage: {error}"))?;
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("realtime storage file cannot be a symbolic link".into());
    }
    let suffix = general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<16>()?);
    let temp = parent.join(format!(".realtime-{}-{suffix}.tmp", std::process::id()));
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
            .open(&temp)
            .map_err(|error| format!("could not create realtime temp file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("could not write realtime temp file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not sync realtime temp file: {error}"))?;
    }
    crate::fsperm::harden_file(&temp);
    crate::sandbox::replace_file(&temp, path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("could not replace encrypted realtime data: {error}")
    })?;
    // Unlike user-selected exports, an encrypted WAL/cache/binding write is not
    // safe locally until the directory entry itself survives power loss.
    sync_parent(parent)
}

#[cfg(unix)]
fn sync_realtime_parent(parent: &Path) -> Result<(), String> {
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("could not sync realtime storage directory: {error}"))
}

#[cfg(not(unix))]
fn sync_realtime_parent(_parent: &Path) -> Result<(), String> {
    // ReplaceFile/MoveFileEx durability is provided by the platform replacement
    // primitive; Windows does not expose Unix-style directory fsync handles.
    Ok(())
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0_u8; N];
    ring_rand::SecureRandom::fill(&ring_rand::SystemRandom::new(), &mut bytes)
        .map_err(|_| "operating system random number generator failed".to_owned())?;
    Ok(bytes)
}

fn decode_base64(value: &str, label: &str) -> Result<Vec<u8>, String> {
    general_purpose::STANDARD
        .decode(value)
        .map_err(|error| format!("{label} is not base64: {error}"))
}

fn parse_receipt_u64(value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| "durable receipt contains an invalid u64".to_owned())
}

fn storage_key() -> Result<[u8; 32], String> {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    if let Some(key) = KEY.get() {
        return Ok(*key);
    }
    let key = load_storage_key()?;
    let _ = KEY.set(key);
    Ok(key)
}

#[cfg(test)]
fn load_storage_key() -> Result<[u8; 32], String> {
    Ok([0x5a; 32])
}

#[cfg(all(not(test), debug_assertions))]
fn injected_development_key() -> Result<Option<[u8; 32]>, String> {
    let Some(value) = std::env::var_os("OLEAFLY_REALTIME_TEST_KEY") else {
        return Ok(None);
    };
    let bytes = general_purpose::STANDARD
        .decode(value.to_string_lossy().as_bytes())
        .map_err(|_| "OLEAFLY_REALTIME_TEST_KEY must be base64".to_owned())?;
    bytes
        .try_into()
        .map(Some)
        .map_err(|_| "OLEAFLY_REALTIME_TEST_KEY must contain exactly 32 bytes".to_owned())
}

#[cfg(all(not(test), target_os = "macos"))]
fn load_storage_key() -> Result<[u8; 32], String> {
    #[cfg(debug_assertions)]
    if let Some(key) = injected_development_key()? {
        return Ok(key);
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_MASTER_KEY_ACCOUNT)
        .map_err(|error| format!("could not open macOS credential store: {error}"))?;
    match entry.get_password() {
        Ok(value) => general_purpose::STANDARD
            .decode(value)
            .map_err(|_| "macOS credential store contains an invalid realtime key".to_owned())?
            .try_into()
            .map_err(|_| "macOS credential store contains a malformed realtime key".to_owned()),
        Err(keyring::Error::NoEntry) => {
            let key = random_bytes::<32>()?;
            entry
                .set_password(&general_purpose::STANDARD.encode(key))
                .map_err(|error| {
                    format!("could not save realtime key in macOS credential store: {error}")
                })?;
            Ok(key)
        }
        Err(error) => Err(format!(
            "could not read realtime key from macOS credential store: {error}"
        )),
    }
}

#[cfg(all(not(test), not(target_os = "macos")))]
fn load_storage_key() -> Result<[u8; 32], String> {
    #[cfg(debug_assertions)]
    if let Some(key) = injected_development_key()? {
        return Ok(key);
    }
    Err("realtime encrypted storage requires the platform credential-store integration".into())
}

#[cfg(target_os = "macos")]
fn set_platform_credential(account: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("could not open macOS credential store: {error}"))?
        .set_password(value)
        .map_err(|error| format!("could not save credential in macOS credential store: {error}"))
}

#[cfg(target_os = "macos")]
fn get_platform_credential(account: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|error| format!("could not open macOS credential store: {error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read macOS credential store: {error}")),
    }
}

#[cfg(not(target_os = "macos"))]
fn set_platform_credential(_account: &str, _value: &str) -> Result<(), String> {
    Err("realtime login requires the platform credential-store integration".into())
}

#[cfg(not(target_os = "macos"))]
fn get_platform_credential(_account: &str) -> Result<Option<String>, String> {
    Err("realtime login requires the platform credential-store integration".into())
}

fn emit_disconnected(app: &AppHandle, session_id: &str, reason: &str) {
    let _ = app.emit(
        EVENT_NAME,
        TransportEvent::Disconnected { session_id, reason },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_realtime_protocol::{EditSessionId, MutationEnvelopeV1, MutationOrigin};

    fn identity(file: &str) -> BindingIdentity {
        BindingIdentity {
            local_project_id: "local-project".into(),
            server_instance_id: ServerInstanceId::parse("1134c268-3f07-4361-b5c0-0bede22fb36b")
                .unwrap(),
            project_id: SharedProjectId::parse("0198cf35-0000-7000-8000-000000000010").unwrap(),
            replica_id: ReplicaId::parse("0198cf35-0000-7000-8000-000000000021").unwrap(),
            file_id: FileId::parse(file).unwrap(),
        }
    }

    fn binding(path: &str) -> DesktopSharedProjectBinding {
        let identity = identity("0198cf35-0000-7000-8000-000000000002");
        DesktopSharedProjectBinding {
            local_project_id: identity.local_project_id,
            server_profile_id: ServerProfileId::parse("0198cf35-0000-7000-8000-000000000051")
                .unwrap(),
            server_instance_id: identity.server_instance_id,
            project_id: identity.project_id,
            replica_id: identity.replica_id,
            file_id: identity.file_id,
            path: path.into(),
            state: "shared_active".into(),
        }
    }

    fn mutation_frame(sequence: u64) -> Vec<u8> {
        encode_client_to_server_frame_v1(&ClientToServerFrameV1 {
            protocol_version: REALTIME_PROTOCOL_VERSION,
            message: ClientToServerMessageV1::Mutation(MutationEnvelopeV1 {
                client_update_id: ClientUpdateId::parse("0198cf35-0000-7000-8000-000000000031")
                    .unwrap(),
                replica_id: ReplicaId::parse("0198cf35-0000-7000-8000-000000000021").unwrap(),
                client_sequence: sequence,
                edit_session_id: EditSessionId::parse("0198cf35-0000-7000-8000-000000000041")
                    .unwrap(),
                origin: MutationOrigin::Human,
                assistance: None,
                update: vec![1, 2, 3],
            }),
        })
        .unwrap()
    }

    #[test]
    fn encrypted_bundle_hides_plaintext_and_authenticates_binding_identity() {
        let first = identity("0198cf35-0000-7000-8000-000000000002");
        let second = identity("0198cf35-0000-7000-8000-000000000003");
        let first_aad = serde_json::to_vec(&StorageAad {
            version: STORAGE_VERSION,
            object_kind: "replica_bundle",
            identity: &first,
        })
        .unwrap();
        let second_aad = serde_json::to_vec(&StorageAad {
            version: STORAGE_VERSION,
            object_kind: "replica_bundle",
            identity: &second,
        })
        .unwrap();
        let plaintext = br#"{\"state\":\"private source text\",\"token\":\"secret-token\"}"#;
        let encrypted = encrypt_envelope([7; 32], &first_aad, plaintext).unwrap();

        assert!(!encrypted
            .windows("private source text".len())
            .any(|window| window == b"private source text"));
        assert!(!encrypted
            .windows("secret-token".len())
            .any(|window| window == b"secret-token"));
        assert!(!encrypted.windows(32).any(|window| window == [7; 32]));
        assert_eq!(
            decrypt_envelope([7; 32], &first_aad, &encrypted).unwrap(),
            plaintext
        );
        assert!(decrypt_envelope([7; 32], &second_aad, &encrypted).is_err());

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("replica.bin");
        write_private_atomic(&path, &encrypted).unwrap();
        let disk = std::fs::read(path).unwrap();
        assert!(!disk
            .windows("private source text".len())
            .any(|window| window == b"private source text"));
        assert!(!disk
            .windows("secret-token".len())
            .any(|window| window == b"secret-token"));
        assert!(!disk.windows(32).any(|window| window == [7; 32]));
    }

    #[test]
    fn generic_transport_rejects_mutation_frames_by_message_kind() {
        let encoded = general_purpose::STANDARD.encode(mutation_frame(1));
        assert_eq!(
            validate_ephemeral_frame(&identity("0198cf35-0000-7000-8000-000000000002"), &encoded,)
                .unwrap_err(),
            "mutation frames require atomic native persistence"
        );
    }

    #[test]
    fn acknowledgement_identity_check_keeps_mismatched_entry() {
        let frame = mutation_frame(1);
        let decoded = decode_client_to_server_frame_v1(&frame).unwrap();
        let ClientToServerMessageV1::Mutation(envelope) = decoded.message else {
            unreachable!();
        };
        let journal = ReplicaBundle {
            client_sequence: 1,
            state_base64: "state".into(),
            pending: vec![PendingJournalEntry {
                client_update_id: envelope.client_update_id,
                replica_id: envelope.replica_id,
                client_sequence: envelope.client_sequence,
                encoded_frame_base64: general_purpose::STANDARD.encode(frame),
            }],
            acknowledged: Vec::new(),
        };
        let stored = &journal.pending[0];
        let forged = DurableReceiptInput {
            client_update_id: envelope.client_update_id,
            replica_id: envelope.replica_id,
            client_sequence: "2".into(),
            server_sequence: "1".into(),
            authorization_epoch: "1".into(),
            committed_at_unix_ms: "1".into(),
        };
        assert!(validate_receipt_identity(stored, &envelope, &forged, 2).is_err());
        assert_eq!(journal.pending.len(), 1);
    }

    #[test]
    fn plaintext_transport_is_loopback_debug_only() {
        assert_eq!(
            validate_base_url("http://127.0.0.1:8787").is_ok(),
            cfg!(debug_assertions)
        );
        assert!(validate_base_url("http://example.test").is_err());
        assert!(validate_base_url("https://example.test").is_ok());
        assert!(validate_websocket_url(
            "https://example.test",
            "ws://example.test/v1/projects/id/sync"
        )
        .is_err());
        assert!(validate_websocket_url(
            "https://example.test",
            "wss://other.test/v1/projects/id/sync"
        )
        .is_err());
    }

    #[test]
    fn saved_binding_path_and_all_ids_are_immutable() {
        let existing = binding("main.tex");
        assert!(validate_binding_replacement(&existing, &existing).is_ok());

        let mut retargeted = existing.clone();
        retargeted.path = "chapters/retargeted.tex".into();
        assert!(validate_binding_replacement(&existing, &retargeted)
            .unwrap_err()
            .contains("path"));

        let mut reprofiled = existing.clone();
        reprofiled.server_profile_id =
            ServerProfileId::parse("0198cf35-0000-7000-8000-000000000052").unwrap();
        assert!(validate_binding_replacement(&existing, &reprofiled).is_err());
    }

    #[test]
    fn materialization_rejects_renderer_path_retargeting() {
        let saved = binding("main.tex");
        let valid = MaterializationBatch {
            identity: saved.identity(),
            files: vec![MaterializedFile {
                file_id: saved.file_id,
                path: "main.tex".into(),
                content: "trusted target".into(),
            }],
        };
        assert_eq!(
            materialization_target(&saved, &valid).unwrap().path,
            saved.path
        );

        let retargeted = MaterializationBatch {
            identity: saved.identity(),
            files: vec![MaterializedFile {
                file_id: saved.file_id,
                path: "../outside.tex".into(),
                content: "must not write".into(),
            }],
        };
        assert!(materialization_target(&saved, &retargeted)
            .unwrap_err()
            .contains("saved realtime binding"));
    }

    #[test]
    fn encrypted_replacement_reports_parent_fsync_failure_as_unsafe() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("binding.bin");
        std::fs::write(&destination, b"old").unwrap();
        let mut sync_attempted = false;
        let error = write_private_atomic_with_parent_sync(&destination, b"new", |parent| {
            sync_attempted = true;
            assert_eq!(parent, directory.path());
            Err("injected directory fsync failure".into())
        })
        .unwrap_err();
        assert!(sync_attempted);
        assert!(error.contains("injected directory fsync failure"));
        assert_eq!(std::fs::read(destination).unwrap(), b"new");
    }

    #[tokio::test]
    async fn repointed_server_is_rejected_before_any_bearer_credential_is_sent() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = vec![0_u8; 8192];
            let read = stream.read(&mut request).unwrap();
            request.truncate(read);
            let body = serde_json::json!({
                "serverInstanceId": "2134c268-3f07-4361-b5c0-0bede22fb36b",
                "protocolVersions": [REALTIME_PROTOCOL_VERSION],
                "webSocketUrlTemplate": format!("ws://{address}/v1/projects/{{projectId}}/sync"),
                "experimental": true,
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body,
            )
            .unwrap();
            stream.flush().unwrap();
            request
        });

        let input = OpenSessionInput {
            local_project_id: "local-project".into(),
            base_url: format!("http://{address}"),
            server_instance_id: identity("0198cf35-0000-7000-8000-000000000002").server_instance_id,
            project_id: SharedProjectId::parse("0198cf35-0000-7000-8000-000000000010").unwrap(),
            replica_id: ReplicaId::parse("0198cf35-0000-7000-8000-000000000021").unwrap(),
            file_id: FileId::parse("0198cf35-0000-7000-8000-000000000002").unwrap(),
            actor_id: Some(ActorId::parse("550e8400-e29b-41d4-a716-446655440001").unwrap()),
            dev_token: Some("credential-must-not-leak".into()),
        };
        let error = prepare_connection(&input).await.unwrap_err();
        assert!(error.contains("instance does not match"));
        let request = String::from_utf8(server.join().unwrap()).unwrap();
        assert!(request.starts_with("GET /.well-known/oleafly-realtime "));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert!(!request.contains("credential-must-not-leak"));
    }
}
