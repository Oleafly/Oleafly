use std::{collections::HashMap, hash::Hash, net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{
        connect_info::ConnectInfo,
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use oleafly_realtime_protocol::{
    decode_client_to_server_frame_v1, encode_server_to_client_frame_v1,
    negotiate_realtime_protocol_version, ActorId, ClientToServerMessageV1, ProjectCapability,
    ReplicaId, ServerPresenceV1, ServerToClientFrameV1, ServerToClientMessageV1,
    ServerYjsSyncKindV1, ServerYjsSyncMessageV1, SharedProjectId, FRAME_HEADER_LENGTH,
    REALTIME_PROTOCOL_VERSION,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::{
    sync::{Mutex, Semaphore},
    time::{timeout, Instant},
};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::{
    config::{ServerConfig, DEFAULT_MAX_FRAME_BYTES},
    crypto::digest,
    rooms::{DecodeAdmission, Room, RoomEvent, RoomRegistry},
    storage::{
        access_token_lifetime_seconds, decode_secret, encode_secret, encode_ticket,
        BootstrapResult, CommitMutation, DevBootstrap, ProductionBootstrap, RoomMustReload,
        Storage, TicketSession,
    },
};

const OPENING_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct AppState {
    pub config: ServerConfig,
    pub storage: Storage,
    pub instance_id: Uuid,
    rooms: Arc<RoomRegistry>,
    decode_admission: Arc<DecodeAdmission>,
    connection_limit: Arc<Semaphore>,
    login_global_rate: Arc<Mutex<TokenBucketRate>>,
    login_rates: Arc<Mutex<KeyedTokenBucketRate<String>>>,
    ticket_global_rate: Arc<Mutex<TokenBucketRate>>,
    ticket_rates: Arc<Mutex<KeyedTokenBucketRate<ActorId>>>,
    setup_rate: Arc<Mutex<TokenBucketRate>>,
}

impl AppState {
    pub async fn initialize(config: ServerConfig) -> Result<Self> {
        config.validate()?;
        let storage = Storage::connect(&config.database_url, config.master_key).await?;
        if config.auto_migrate {
            storage.migrate().await?;
        }
        let instance_id = storage.instance_id().await?;
        let auth_rate_per_second = f64::from(config.limits.auth_rate_per_minute) / 60.0;
        let global_rate_per_second = (auth_rate_per_second * 32.0).max(16.0);
        let global_burst = config.limits.auth_burst.saturating_mul(32).max(128);
        Ok(Self {
            connection_limit: Arc::new(Semaphore::new(config.limits.max_connections)),
            decode_admission: Arc::new(DecodeAdmission::new(config.limits.clone())),
            login_global_rate: Arc::new(Mutex::new(TokenBucketRate::new(
                global_rate_per_second,
                global_burst,
            ))),
            login_rates: Arc::new(Mutex::new(KeyedTokenBucketRate::new(
                auth_rate_per_second,
                config.limits.auth_burst,
                4_096,
            ))),
            ticket_global_rate: Arc::new(Mutex::new(TokenBucketRate::new(
                global_rate_per_second,
                global_burst,
            ))),
            ticket_rates: Arc::new(Mutex::new(KeyedTokenBucketRate::new(
                auth_rate_per_second,
                config.limits.auth_burst,
                4_096,
            ))),
            setup_rate: Arc::new(Mutex::new(TokenBucketRate::new(0.2, 3))),
            config,
            storage,
            instance_id,
            rooms: Arc::new(RoomRegistry::default()),
        })
    }
}

pub fn router(state: AppState) -> Router {
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/.well-known/oleafly-realtime", get(discovery))
        .route("/v1/projects/{project_id}/sync", get(sync_upgrade));
    if state.config.dev_routes_enabled() {
        router = router
            .route("/v1/dev/bootstrap", post(dev_bootstrap))
            .route(
                "/v1/dev/projects/{project_id}/tickets",
                post(issue_dev_ticket),
            );
    }
    if state.config.production_routes_enabled() {
        router = router
            .route("/v1/auth/local/login", post(local_login))
            .route(
                "/v1/projects/{project_id}/sync-tickets",
                post(issue_authenticated_ticket),
            );
    }
    if state.config.setup_route_enabled() {
        router = router.route("/v1/setup/bootstrap", post(production_bootstrap));
    }
    router.with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn ready(State(state): State<AppState>) -> StatusCode {
    if state.storage.ready().await {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Discovery {
    server_instance_id: Uuid,
    protocol_versions: &'static [u16],
    web_socket_url_template: String,
    experimental: bool,
}

async fn discovery(State(state): State<AppState>) -> Json<Discovery> {
    let mut base = state.config.public_url.to_string();
    while base.ends_with('/') {
        base.pop();
    }
    let websocket_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base
    };
    Json(Discovery {
        server_instance_id: state.instance_id,
        protocol_versions: &[REALTIME_PROTOCOL_VERSION],
        web_socket_url_template: format!("{websocket_base}/v1/projects/{{projectId}}/sync"),
        experimental: true,
    })
}

async fn dev_bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DevBootstrap>, ApiError> {
    require_dev_token(&state, &headers)?;
    Ok(Json(state.storage.dev_bootstrap().await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetupRequest {
    username: String,
    password: String,
    display_name: String,
}

async fn production_bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SetupRequest>,
) -> Result<Json<ProductionBootstrap>, ApiError> {
    // The setup bearer is 256 bits of operator-generated entropy. Check it in constant time before
    // consuming the tiny one-time setup bucket so unauthenticated traffic cannot starve bootstrap.
    require_setup_token(&state, &headers)?;
    if !state.setup_rate.lock().await.allow() {
        return Err(ApiError::too_many_requests("setup rate limit exceeded"));
    }
    if state.storage.is_initialized().await? {
        return Err(ApiError::not_found("setup is no longer available"));
    }
    let username = normalize_username(&request.username)?;
    validate_password(&request.password)?;
    let display_name = request.display_name.trim().to_owned();
    if display_name.is_empty() || display_name.len() > 200 {
        return Err(ApiError::bad_request(
            "displayName must contain 1 to 200 UTF-8 bytes",
        ));
    }
    let password = request.password;
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|_| ApiError::internal("password hashing task failed"))??;
    match state
        .storage
        .production_bootstrap(username, password_hash, display_name)
        .await?
    {
        BootstrapResult::Created(result) => Ok(Json(result)),
        BootstrapResult::AlreadyInitialized => {
            Err(ApiError::not_found("setup is no longer available"))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    access_token: String,
    token_type: &'static str,
    expires_in_seconds: u64,
}

async fn local_login(
    State(state): State<AppState>,
    ConnectInfo(source): ConnectInfo<SocketAddr>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let username = normalize_username(&request.username)?;
    if !state.login_global_rate.lock().await.allow() {
        return Err(ApiError::too_many_requests(
            "authentication rate limit exceeded",
        ));
    }
    let rate_key = format!("{username}@{}", source.ip());
    if !state.login_rates.lock().await.allow(rate_key) {
        return Err(ApiError::too_many_requests(
            "authentication rate limit exceeded",
        ));
    }
    let credential = state.storage.local_account_credential(&username).await?;
    let password = request.password;
    let (expected_hash, actor_id) = match credential {
        Some(credential) => (credential.password_hash, Some(credential.actor_id)),
        None => {
            let dummy = tokio::task::spawn_blocking(|| hash_password("invalid-account-password"))
                .await
                .map_err(|_| ApiError::internal("password hashing task failed"))??;
            (dummy, None)
        }
    };
    let verified = tokio::task::spawn_blocking(move || verify_password(&password, &expected_hash))
        .await
        .map_err(|_| ApiError::internal("password verification task failed"))?;
    let actor_id = actor_id
        .filter(|_| verified)
        .ok_or_else(|| ApiError::unauthorized("username or password is incorrect"))?;
    let token = state.storage.issue_access_token(actor_id).await?;
    Ok(Json(LoginResponse {
        access_token: encode_secret(&token),
        token_type: "Bearer",
        expires_in_seconds: access_token_lifetime_seconds(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IssueTicketRequest {
    actor_id: ActorId,
    replica_id: ReplicaId,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthenticatedTicketRequest {
    replica_id: ReplicaId,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueTicketResponse {
    ticket: String,
    expires_in_seconds: u64,
}

async fn issue_dev_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    Json(request): Json<IssueTicketRequest>,
) -> Result<Json<IssueTicketResponse>, ApiError> {
    require_dev_token(&state, &headers)?;
    let project_id = SharedProjectId::parse(&project_id).map_err(ApiError::bad_request)?;
    let ticket = state
        .storage
        .issue_dev_ticket(project_id, request.actor_id, request.replica_id)
        .await?;
    Ok(Json(IssueTicketResponse {
        ticket: encode_ticket(&ticket),
        expires_in_seconds: 60,
    }))
}

async fn issue_authenticated_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    Json(request): Json<AuthenticatedTicketRequest>,
) -> Result<Json<IssueTicketResponse>, ApiError> {
    let access_token = bearer_secret(&headers)?;
    let actor_id = state
        .storage
        .authenticate_access_token(&access_token)
        .await
        .map_err(|_| ApiError::unauthorized("access token is invalid or expired"))?;
    // Ticket issuance has separate global and per-actor buckets. Bearer validation happens first so
    // invalid callers cannot spend a real actor's allowance.
    if !state.ticket_global_rate.lock().await.allow()
        || !state.ticket_rates.lock().await.allow(actor_id)
    {
        return Err(ApiError::too_many_requests(
            "sync ticket rate limit exceeded",
        ));
    }
    let project_id = SharedProjectId::parse(&project_id).map_err(ApiError::bad_request)?;
    let ticket = state
        .storage
        .issue_member_ticket(project_id, actor_id, request.replica_id)
        .await
        .map_err(|_| ApiError::forbidden("project membership is required"))?;
    Ok(Json(IssueTicketResponse {
        ticket: encode_ticket(&ticket),
        expires_in_seconds: 60,
    }))
}

fn require_dev_token(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !state.config.dev_routes_enabled() {
        return Err(ApiError::not_found("dev routes are disabled"));
    }
    require_configured_bearer(
        headers,
        state.config.dev_bootstrap_token.as_deref(),
        "invalid development bootstrap token",
    )
}

fn require_setup_token(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !state.config.setup_route_enabled() {
        return Err(ApiError::not_found("setup is disabled"));
    }
    require_configured_bearer(
        headers,
        state.config.setup_token.as_deref(),
        "invalid setup token",
    )
}

fn require_configured_bearer(
    headers: &HeaderMap,
    configured: Option<&str>,
    error: &str,
) -> Result<(), ApiError> {
    let supplied = bearer_value(headers);
    let matches = supplied
        .zip(configured)
        .is_some_and(|(supplied, configured)| {
            bool::from(digest(supplied.as_bytes()).ct_eq(&digest(configured.as_bytes())))
        });
    if !matches {
        return Err(ApiError::unauthorized(error));
    }
    Ok(())
}

fn bearer_value(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

fn bearer_secret(headers: &HeaderMap) -> Result<[u8; 32], ApiError> {
    bearer_value(headers)
        .ok_or_else(|| ApiError::unauthorized("Bearer access token is required"))
        .and_then(|value| {
            decode_secret(value).map_err(|_| ApiError::unauthorized("access token is malformed"))
        })
}

fn normalize_username(value: &str) -> Result<String, ApiError> {
    let username = value.trim().to_ascii_lowercase();
    if username.len() < 3
        || username.len() > 100
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(ApiError::bad_request(
            "username must contain 3 to 100 letters, digits, dots, underscores, or hyphens",
        ));
    }
    Ok(username)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 12 || password.len() > 1024 {
        return Err(ApiError::bad_request(
            "password must contain 12 to 1024 UTF-8 bytes",
        ));
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let mut salt = [0; 16];
    rand::rng().fill_bytes(&mut salt);
    let salt = SaltString::encode_b64(&salt)
        .map_err(|_| ApiError::internal("could not encode password salt"))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::internal("could not hash password"))
}

fn verify_password(password: &str, encoded_hash: &str) -> bool {
    PasswordHash::new(encoded_hash).is_ok_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

async fn sync_upgrade(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let project_id = SharedProjectId::parse(&project_id).map_err(ApiError::bad_request)?;
    let permit = state
        .connection_limit
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::service_unavailable("realtime connection limit reached"))?;
    let max_write_buffer = state.config.limits.max_write_buffer_bytes;
    Ok(ws
        .max_frame_size(DEFAULT_MAX_FRAME_BYTES)
        .max_message_size(DEFAULT_MAX_FRAME_BYTES)
        .write_buffer_size(64 * 1024)
        .max_write_buffer_size(max_write_buffer)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            if let Err(error) = realtime_session(state, project_id, socket).await {
                debug!(?error, "realtime session closed");
            }
        }))
}

async fn realtime_session(
    state: AppState,
    requested_project_id: SharedProjectId,
    mut socket: WebSocket,
) -> Result<()> {
    let (protocol_version, session) = authenticate_opening(&state, &mut socket).await?;
    if session.project_id != requested_project_id {
        bail!("sync ticket belongs to a different project");
    }
    send_frame(
        &mut socket,
        ServerToClientFrameV1 {
            protocol_version,
            message: ServerToClientMessageV1::OpeningAccepted,
        },
    )
    .await?;

    let room = state
        .rooms
        .get(
            &state.storage,
            session.project_id,
            state.config.limits.room_broadcast_capacity(),
            &state.decode_admission,
        )
        .await?;
    let connection_id = Uuid::new_v4();
    let result = realtime_session_in_room(
        &state,
        &session,
        protocol_version,
        connection_id,
        &room,
        &mut socket,
    )
    .await;
    let cleanup = room.clear_presence(connection_id).await;
    state.rooms.release(session.project_id, &room).await;
    if let Err(error) = cleanup {
        warn!(?error, "failed to broadcast presence cleanup");
    }
    result
}

async fn realtime_session_in_room(
    state: &AppState,
    session: &TicketSession,
    protocol_version: u16,
    connection_id: Uuid,
    room: &Arc<Room>,
    socket: &mut WebSocket,
) -> Result<()> {
    let mut events = room.subscribe();
    for presence in room.existing_presence().await {
        send_frame(
            socket,
            ServerToClientFrameV1 {
                protocol_version,
                message: ServerToClientMessageV1::ServerPresence(presence),
            },
        )
        .await?;
    }

    let limits = &state.config.limits;
    let mut mutation_rate = TokenBucketRate::new(
        f64::from(limits.mutation_rate_per_second),
        limits.mutation_burst,
    );
    let mut state_vector_rate = TokenBucketRate::new(
        f64::from(limits.state_vector_rate_per_second),
        limits.state_vector_burst,
    );
    let mut presence_rate = TokenBucketRate::new(
        f64::from(limits.presence_rate_per_second),
        limits.presence_burst,
    );
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(bytes))) => {
                        if bytes.len() < FRAME_HEADER_LENGTH || bytes.len() > DEFAULT_MAX_FRAME_BYTES {
                            return Err(anyhow!("realtime frame is outside configured bounds"));
                        }
                        let frame = decode_client_to_server_frame_v1(&bytes)?;
                        if frame.protocol_version != protocol_version {
                            return Err(anyhow!("client changed protocol version after negotiation"));
                        }
                        match frame.message {
                            ClientToServerMessageV1::StateVectorRequest(request) => {
                                if !state_vector_rate.allow() {
                                    return Err(anyhow!("state vector rate limit exceeded"));
                                }
                                state.storage.authorize_session(session, ProjectCapability::SourceRead).await?;
                                let update = room.diff(&request.payload, &state.decode_admission).await?;
                                send_frame(socket, ServerToClientFrameV1 {
                                    protocol_version,
                                    message: ServerToClientMessageV1::YjsSync(ServerYjsSyncMessageV1 {
                                        kind: ServerYjsSyncKindV1::SyncUpdate,
                                        payload: update,
                                    }),
                                }).await?;
                            }
                            ClientToServerMessageV1::Mutation(envelope) => {
                                if !mutation_rate.allow() {
                                    return Err(anyhow!("mutation rate limit exceeded"));
                                }
                                state.storage.authorize_session(session, ProjectCapability::SourceWrite).await?;
                                let mutation_order = room.serialize_mutations().await;
                                let candidate = room.stage_update(&envelope.update, &state.decode_admission).await?;
                                let committed = match state.storage.commit_mutation(
                                    session,
                                    &envelope,
                                    room.project_key(),
                                    candidate.full_state(),
                                    candidate.base_server_sequence(),
                                ).await {
                                    Ok(committed) => committed,
                                    Err(error) => {
                                        if error.downcast_ref::<RoomMustReload>().is_some() {
                                            state.rooms.invalidate(session.project_id, room).await;
                                        }
                                        return Err(error);
                                    }
                                };
                                let (receipt, is_new) = match committed {
                                    CommitMutation::New(receipt) => (receipt, true),
                                    CommitMutation::Recovered(receipt) => (receipt, true),
                                    CommitMutation::Duplicate(receipt) => {
                                        if candidate.base_server_sequence() < receipt.server_sequence {
                                            state.rooms.invalidate(session.project_id, room).await;
                                            return Err(RoomMustReload::new(
                                                "duplicate receipt is ahead of the in-memory room",
                                            ).into());
                                        }
                                        (receipt, false)
                                    }
                                };
                                room.promote(candidate, receipt.server_sequence).await;
                                if is_new {
                                    room.broadcast_authoring(&ServerToClientFrameV1 {
                                        protocol_version,
                                        message: ServerToClientMessageV1::YjsSync(ServerYjsSyncMessageV1 {
                                            kind: ServerYjsSyncKindV1::Broadcast,
                                            payload: envelope.update,
                                        }),
                                    })?;
                                }
                                // Release project ordering immediately after durable commit, exact candidate
                                // promotion, and peer enqueue. Sender backpressure or failure must not block the
                                // next editor's mutation.
                                drop(mutation_order);
                                send_frame(socket, ServerToClientFrameV1 {
                                    protocol_version,
                                    message: ServerToClientMessageV1::DurableReceipt(receipt),
                                }).await?;
                            }
                            ClientToServerMessageV1::ClientPresence(client_presence) => {
                                if !presence_rate.allow() {
                                    return Err(anyhow!("presence rate limit exceeded"));
                                }
                                state.storage.authorize_session(session, ProjectCapability::PresenceJoin).await?;
                                room.set_presence(connection_id, ServerPresenceV1 {
                                    actor_id: session.actor_id,
                                    replica_id: session.replica_id,
                                    display_name: session.display_name.clone(),
                                    color_token: session.color_token.clone(),
                                    selection: client_presence.selection,
                                }).await?;
                            }
                            ClientToServerMessageV1::OpeningAuth(_) => {
                                return Err(anyhow!("opening authentication may only be sent once"));
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => socket.send(Message::Pong(payload)).await?,
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Ok(Message::Text(_))) => return Err(anyhow!("realtime endpoint accepts binary frames only")),
                    Some(Err(error)) => return Err(error.into()),
                }
            }
            event = events.recv() => {
                match event {
                    Ok(RoomEvent::Frame { encoded, required_capability }) => {
                        state.storage.authorize_session(session, required_capability).await?;
                        socket.send(Message::Binary(encoded.into())).await?;
                    }
                    Ok(RoomEvent::Fenced) => {
                        return Err(anyhow!("authoring room was fenced; reconnect to reconcile durable state"));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(skipped, "closing slow realtime client");
                        return Err(anyhow!("slow realtime client exceeded outbound buffer"));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
                }
            }
        }
    }
}

async fn authenticate_opening(
    state: &AppState,
    socket: &mut WebSocket,
) -> Result<(u16, TicketSession)> {
    let message = timeout(OPENING_TIMEOUT, socket.recv())
        .await
        .context("opening authentication timed out")?
        .ok_or_else(|| anyhow!("socket closed before opening authentication"))??;
    let Message::Binary(bytes) = message else {
        bail!("first WebSocket message must be binary opening authentication");
    };
    if bytes.len() < FRAME_HEADER_LENGTH || bytes.len() > DEFAULT_MAX_FRAME_BYTES {
        bail!("opening authentication frame is outside configured bounds");
    }
    let frame = decode_client_to_server_frame_v1(&bytes)?;
    let ClientToServerMessageV1::OpeningAuth(opening) = frame.message else {
        bail!("first realtime frame must be opening authentication");
    };
    let protocol_version = negotiate_realtime_protocol_version(&opening.supported_versions)
        .ok_or_else(|| anyhow!("client and server have no common realtime protocol version"))?;
    let session = state.storage.consume_ticket(&opening.ticket).await?;
    Ok((protocol_version, session))
}

async fn send_frame(socket: &mut WebSocket, frame: ServerToClientFrameV1) -> Result<()> {
    socket
        .send(Message::Binary(
            encode_server_to_client_frame_v1(&frame)?.into(),
        ))
        .await?;
    Ok(())
}

struct TokenBucketRate {
    last_refill: Instant,
    refill_per_second: f64,
    capacity: f64,
    tokens: f64,
}

impl TokenBucketRate {
    fn new(refill_per_second: f64, burst: u32) -> Self {
        Self {
            last_refill: Instant::now(),
            refill_per_second,
            capacity: f64::from(burst),
            tokens: f64::from(burst),
        }
    }

    fn allow(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens
            + now.duration_since(self.last_refill).as_secs_f64() * self.refill_per_second)
            .min(self.capacity);
        self.last_refill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

struct KeyedTokenBucketRate<K> {
    buckets: HashMap<K, TokenBucketRate>,
    refill_per_second: f64,
    burst: u32,
    max_keys: usize,
}

impl<K> KeyedTokenBucketRate<K>
where
    K: Eq + Hash,
{
    fn new(refill_per_second: f64, burst: u32, max_keys: usize) -> Self {
        Self {
            buckets: HashMap::new(),
            refill_per_second,
            burst,
            max_keys,
        }
    }

    fn allow(&mut self, key: K) -> bool {
        if !self.buckets.contains_key(&key) && self.buckets.len() >= self.max_keys {
            let stale_before = Instant::now() - Duration::from_secs(15 * 60);
            self.buckets
                .retain(|_, bucket| bucket.last_refill >= stale_before);
            if self.buckets.len() >= self.max_keys {
                return false;
            }
        }
        self.buckets
            .entry(key)
            .or_insert_with(|| TokenBucketRate::new(self.refill_per_second, self.burst))
            .allow()
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: error.to_string(),
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn too_many_requests(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: message.into(),
        }
    }

    fn service_unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::internal(error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_allows_only_the_configured_burst_without_refill() {
        let mut rate = TokenBucketRate::new(0.000_001, 2);
        assert!(rate.allow());
        assert!(rate.allow());
        assert!(!rate.allow());
    }

    #[test]
    fn local_passwords_use_argon2id_and_verify() {
        let encoded = hash_password("a sufficiently long password").unwrap();
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify_password("a sufficiently long password", &encoded));
        assert!(!verify_password("the wrong password", &encoded));
    }

    #[test]
    fn keyed_authentication_buckets_do_not_starve_other_accounts() {
        let mut rates = KeyedTokenBucketRate::new(0.000_001, 1, 8);
        assert!(rates.allow("alice@127.0.0.1"));
        assert!(!rates.allow("alice@127.0.0.1"));
        assert!(rates.allow("bob@127.0.0.1"));
    }
}
