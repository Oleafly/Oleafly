use super::{
    catalog,
    protocol::{Connection, Incoming},
    redact::Redactor,
    store::Store,
    types::*,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{broadcast, watch, Mutex as AsyncMutex};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const PERMISSION_TIMEOUT_MS: u64 = 120_000;
const MAX_SESSION_BYTES: usize = 64 * 1024 * 1024;

struct PendingPermission {
    request: PermissionRequest,
    wire_id: Value,
}
struct LiveState {
    record: SessionRecord,
    permissions: HashMap<String, PendingPermission>,
    replaying: bool,
    cancelled: bool,
    bytes: usize,
}

struct TaskTemp(PathBuf);
impl Drop for TaskTemp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct LiveSession {
    state: Mutex<LiveState>,
    connection: Arc<Connection>,
    operation: AsyncMutex<()>,
    owner: Option<String>,
    mcp_servers: Vec<Value>,
    redactor: Redactor,
    task_temp: Option<TaskTemp>,
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        fn clear(value: &mut Value) {
            use zeroize::Zeroize;
            match value {
                Value::String(text) => text.zeroize(),
                Value::Array(values) => {
                    for value in values {
                        clear(value);
                    }
                }
                Value::Object(values) => {
                    for value in values.values_mut() {
                        clear(value);
                    }
                }
                _ => {}
            }
        }
        for server in &mut self.mcp_servers {
            clear(server);
        }
    }
}

#[derive(Default)]
struct StartupState {
    stopping: bool,
    pending: usize,
}

pub struct StartupGuard<'a> {
    runtime: &'a AcpRuntime,
}

impl Drop for StartupGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.runtime.startup.lock() {
            state.pending -= 1;
            self.runtime.startup_count.send_replace(state.pending);
        }
    }
}

pub struct AcpRuntime {
    root: PathBuf,
    store: Store,
    live: AsyncMutex<HashMap<String, Arc<LiveSession>>>,
    events: broadcast::Sender<AcpEvent>,
    installing: AsyncMutex<HashSet<String>>,
    registry: AsyncMutex<Option<(u64, Vec<catalog::RegistryEntry>)>>,
    resources: Mutex<HashMap<String, Box<dyn std::any::Any + Send + Sync>>>,
    owner_epochs: Mutex<HashMap<String, u64>>,
    startup: Mutex<StartupState>,
    startup_count: watch::Sender<usize>,
}

impl AcpRuntime {
    pub fn new(root: PathBuf) -> Result<Arc<Self>, String> {
        let store = Store::open(&root)?;
        let (events, _) = broadcast::channel(2048);
        Ok(Arc::new(Self {
            root,
            store,
            live: AsyncMutex::new(HashMap::new()),
            events,
            installing: AsyncMutex::new(HashSet::new()),
            registry: AsyncMutex::new(None),
            resources: Mutex::new(HashMap::new()),
            owner_epochs: Mutex::new(HashMap::new()),
            startup: Mutex::new(StartupState::default()),
            startup_count: watch::channel(0).0,
        }))
    }

    pub fn begin_startup(&self) -> Result<StartupGuard<'_>, String> {
        let mut state = self
            .startup
            .lock()
            .map_err(|_| "The ACP runtime is unavailable.")?;
        if state.stopping {
            return Err("Oleafly is closing. The agent cannot start.".into());
        }
        state.pending += 1;
        self.startup_count.send_replace(state.pending);
        Ok(StartupGuard { runtime: self })
    }

    pub async fn retain_resource<T: Send + Sync + 'static>(
        &self,
        id: &str,
        resource: T,
    ) -> Result<(), String> {
        let sessions = self.live.lock().await;
        let session = sessions
            .get(id)
            .ok_or("This ACP session disconnected before its resources could be attached.")?;
        if session.connection.is_closed() {
            return Err("This ACP session is disconnected.".into());
        }
        self.resources
            .lock()
            .map_err(|_| "The ACP session resources are unavailable.")?
            .insert(id.into(), Box::new(resource));
        Ok(())
    }

    pub fn owner_generation(&self, owner: &str) -> u64 {
        self.owner_epochs
            .lock()
            .ok()
            .and_then(|epochs| epochs.get(owner).copied())
            .unwrap_or(0)
    }

    fn owner_is_current(&self, owner: Option<&str>, generation: Option<u64>) -> bool {
        self.startup.lock().is_ok_and(|state| !state.stopping)
            && owner.zip(generation).map_or(true, |(owner, generation)| {
                self.owner_generation(owner) == generation
            })
    }

    pub fn stop_all_now(&self) {
        if let Ok(mut state) = self.startup.lock() {
            state.stopping = true;
        }
        if let Ok(sessions) = self.live.try_lock() {
            for session in sessions.values() {
                session.connection.request_stop();
            }
        }
        if let Ok(mut resources) = self.resources.lock() {
            resources.clear();
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AcpEvent> {
        self.events.subscribe()
    }
    pub fn events(&self, id: &str, after: u64, limit: usize) -> Result<EventPage, String> {
        self.store.events(id, after, limit)
    }
    pub fn list(&self, project_id: &str) -> Result<Vec<SessionRecord>, String> {
        self.store.list(Some(project_id), 200)
    }
    pub fn all_sessions(
        &self,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SessionRecord>, String> {
        self.store.sessions_page(after_id, limit)
    }
    pub fn sessions_page(
        &self,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SessionRecord>, String> {
        self.all_sessions(after_id, limit)
    }
    pub fn record(&self, id: &str) -> Result<SessionRecord, String> {
        self.store.get(id)
    }

    fn definition(&self, id: &str) -> Result<AgentDefinition, String> {
        catalog::builtins()
            .into_iter()
            .chain(self.store.agents()?)
            .find(|value| value.id == id)
            .ok_or_else(|| "This ACP agent is not registered.".into())
    }

    pub async fn catalog(&self, probe: bool) -> Result<Vec<AgentStatus>, String> {
        let mut results = Vec::new();
        for definition in catalog::builtins().into_iter().chain(self.store.agents()?) {
            results.push(catalog::status(&self.root, definition, probe).await);
        }
        Ok(results)
    }

    pub fn register(&self, json: &str) -> Result<AgentDefinition, String> {
        if json.len() > 64 * 1024 {
            return Err("The agent definition exceeds 64 KiB.".into());
        }
        let mut definition: AgentDefinition = serde_json::from_str(json)
            .map_err(|_| "The agent definition is not valid distribution JSON.")?;
        if catalog::builtins()
            .iter()
            .any(|value| value.id == definition.id)
        {
            return Err("Built-in agent definitions cannot be replaced.".into());
        }
        if self.store.agents()?.len() >= 100
            && !self.store.agents()?.iter().any(|v| v.id == definition.id)
        {
            return Err("You can register up to 100 custom agents.".into());
        }
        definition.builtin = false;
        catalog::validate(&definition)?;
        self.store.register(&definition)?;
        Ok(definition)
    }

    pub async fn remove_agent(&self, id: &str) -> Result<(), String> {
        if self.live.lock().await.values().any(|session| {
            session
                .state
                .lock()
                .is_ok_and(|state| state.record.agent_id == id)
        }) {
            return Err("Disconnect this agent's sessions before removing its definition.".into());
        }
        self.store.remove_agent(id)
    }

    pub async fn install(&self, id: &str) -> Result<AgentStatus, String> {
        let definition = self.definition(id)?;
        {
            let mut installing = self.installing.lock().await;
            if !installing.insert(id.into()) {
                return Err("This agent is already being installed.".into());
            }
        }
        let result = catalog::install(&self.root, &definition).await;
        self.installing.lock().await.remove(id);
        result?;
        Ok(catalog::status(&self.root, definition, true).await)
    }

    pub async fn registry_search(
        &self,
        query: &str,
    ) -> Result<Vec<catalog::RegistryEntry>, String> {
        if query.len() > 200 {
            return Err("The registry search is too long.".into());
        }
        let mut cache = self.registry.lock().await;
        if cache
            .as_ref()
            .map_or(true, |(time, _)| now_ms().saturating_sub(*time) > 300_000)
        {
            *cache = Some((now_ms(), catalog::registry_search("").await?));
        }
        let query = query.to_lowercase();
        Ok(cache
            .as_ref()
            .map(|(_, entries)| {
                entries
                    .iter()
                    .filter(|v| {
                        format!("{} {} {}", v.id, v.name, v.description)
                            .to_lowercase()
                            .contains(&query)
                    })
                    .take(100)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default())
    }

    #[cfg(test)]
    pub async fn start(self: &Arc<Self>, options: StartSession) -> Result<SessionSnapshot, String> {
        self.start_with_mcp(options, Vec::new()).await
    }

    pub async fn start_with_mcp(
        self: &Arc<Self>,
        options: StartSession,
        mcp_servers: Vec<Value>,
    ) -> Result<SessionSnapshot, String> {
        let generation = options
            .owner
            .as_deref()
            .map(|owner| self.owner_generation(owner));
        self.start_with_mcp_at_generation(options, mcp_servers, generation)
            .await
    }

    pub async fn start_with_mcp_at_generation(
        self: &Arc<Self>,
        options: StartSession,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        if options.allowed_paths.is_some() && options.task_id.is_none() {
            return Err("An isolated ACP session needs a research task ID.".into());
        }
        let root = canonical_root(&options.project_path)?;
        let definition = self.definition(&options.agent_id)?;
        if options.allowed_paths.is_some() {
            if let Some(reason) = catalog::task_unavailable_reason(&definition) {
                return Err(reason);
            }
        }
        let time = now_ms();
        let record = SessionRecord {
            id: new_id(),
            project_id: options.project_id,
            project_path: root.to_string_lossy().into_owned(),
            agent_id: definition.id.clone(),
            agent_version: None,
            native_session_id: None,
            parent_session_id: options.parent_session_id,
            task_id: options.task_id,
            title: format!("{} conversation", definition.name),
            status: SessionStatus::Connecting,
            created_at: time,
            updated_at: time,
            turn_id: None,
            capabilities: Capabilities::default(),
            controls: SessionControls::default(),
            auth_methods: Vec::new(),
            error: None,
            last_sequence: 0,
        };
        self.connect(
            record,
            options.owner,
            mcp_servers,
            options.allowed_paths,
            generation,
        )
        .await
    }

    #[cfg(test)]
    pub async fn reconnect(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        self.reconnect_with_mcp(id, owner, Vec::new()).await
    }

    pub async fn reconnect_with_mcp(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
    ) -> Result<SessionSnapshot, String> {
        let generation = owner.as_deref().map(|owner| self.owner_generation(owner));
        self.reconnect_with_mcp_at_generation(id, owner, mcp_servers, generation)
            .await
    }

    pub async fn reconnect_with_mcp_at_generation(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        if let Ok(session) = self.get_live(id).await {
            if session.owner != owner {
                return Err("This ACP session belongs to another window or task.".into());
            }
            return Err("This ACP session is already connected.".into());
        }
        let mut record = self.store.get(id)?;
        if record.task_id.is_some() {
            return Err("Resume isolated work through its research task.".into());
        }
        canonical_root(Path::new(&record.project_path))?;
        if record.native_session_id.is_some()
            && !record.capabilities.load_session
            && !record.capabilities.resume
        {
            return Err("This agent cannot resume saved sessions. Start a new conversation to continue working.".into());
        }
        record.status = SessionStatus::Connecting;
        record.error = None;
        self.connect(record, owner, mcp_servers, None, generation)
            .await
    }

    async fn connect(
        self: &Arc<Self>,
        record: SessionRecord,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
        allowed_paths: Option<Vec<String>>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        let _startup = self.begin_startup()?;
        if !self.owner_is_current(owner.as_deref(), generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        let definition = self.definition(&record.agent_id)?;
        if let Some(required) = definition
            .distribution
            .npx
            .as_ref()
            .and_then(|v| v.node_major)
        {
            catalog::check_node(required).await?;
        }
        if !self.owner_is_current(owner.as_deref(), generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        let launch = catalog::resolve(&self.root, &definition)?;
        if mcp_servers.len() > 32
            || serde_json::to_vec(&mcp_servers)
                .map_err(|e| e.to_string())?
                .len()
                > 64 * 1024
        {
            return Err("The ACP MCP configuration is too large.".into());
        }
        let mut sessions = self.live.lock().await;
        if sessions.len() >= 8 {
            return Err(
                "Eight ACP sessions are already connected. Disconnect one before starting another."
                    .into(),
            );
        }
        if sessions.contains_key(&record.id) {
            return Err("This ACP session is already connected.".into());
        }
        if !self.owner_is_current(owner.as_deref(), generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        let task_temp = if allowed_paths.is_some() {
            let path = self.root.join("task-temp").join(new_id());
            std::fs::create_dir_all(&path)
                .map_err(|_| "The task temporary directory could not be created.")?;
            Some(TaskTemp(path))
        } else {
            None
        };
        let redactor = if let Some(temporary) = &task_temp {
            super::task_launch::prepare_credentials(
                &crate::paths::home_dir()?,
                &temporary.0,
                &definition.id,
                &mcp_servers,
            )?
        } else {
            Redactor::new(&mcp_servers)
        };
        let mut command = if let Some(paths) = &allowed_paths {
            crate::agent::task_runtime::sandbox_task_command_with_reads(
                &launch.executable,
                &launch.args,
                Path::new(&record.project_path),
                paths,
                &task_temp
                    .as_ref()
                    .ok_or("The task temporary directory is missing.")?
                    .0,
                true,
                &super::task_launch::runtime_reads(&self.root, &definition, &launch),
            )?
        } else {
            let mut command = tokio::process::Command::new(&launch.executable);
            command.args(&launch.args);
            command
        };
        command.current_dir(&record.project_path);
        let id = record.id.clone();
        let bytes = self.store.byte_count(&id)?;
        let (connection, incoming) = Connection::spawn(command).await?;
        if let Err(error) = self.store.save(&record) {
            connection.shutdown().await;
            return Err(error);
        }
        let session = Arc::new(LiveSession {
            state: Mutex::new(LiveState {
                record,
                permissions: HashMap::new(),
                replaying: true,
                cancelled: false,
                bytes,
            }),
            connection,
            operation: AsyncMutex::new(()),
            owner,
            redactor,
            mcp_servers,
            task_temp,
        });
        sessions.insert(id.clone(), session.clone());
        drop(sessions);
        self.spawn_reader(session.clone(), incoming);
        let result = self.initialize(&session).await;
        if let Err(error) = result {
            let _ = self.fail(&session, &error);
            session.connection.shutdown().await;
            self.release_live(&session).await;
            return Err(session.redactor.text(&error));
        }
        if !self.owner_is_current(session.owner.as_deref(), generation) {
            self.cancel(&id).await?;
            return Err("The window or task closed while the agent was starting.".into());
        }
        self.snapshot(&id).await
    }

    async fn initialize(&self, session: &Arc<LiveSession>) -> Result<(), String> {
        let response = session.connection.request("initialize", json!({"protocolVersion":1,"clientInfo":{"name":"oleafly","title":"Oleafly","version":env!("CARGO_PKG_VERSION")},"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}), REQUEST_TIMEOUT).await.map_err(|e| e.to_string())?;
        let capabilities = Capabilities::from_initialize(&response)?;
        session
            .redactor
            .validate_metadata_ids(&response["authMethods"])?;
        if session.mcp_servers.iter().any(|v| v["type"] == "http") && !capabilities.mcp_http {
            return Err("This agent does not support the workspace's HTTP tool connection.".into());
        }
        if session.mcp_servers.iter().any(|v| v["type"] == "sse") {
            return Err("SSE tool connections are not supported by this ACP runtime.".into());
        }
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.capabilities = capabilities;
            state.record.agent_version = response["agentInfo"]["version"]
                .as_str()
                .map(|v| session.redactor.text(v));
            state.record.auth_methods = response["authMethods"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .take(12)
                        .filter_map(|value| {
                            serde_json::from_value(session.redactor.value(value)).ok()
                        })
                        .collect()
                })
                .unwrap_or_default();
        }
        self.establish(session).await
    }

    async fn establish(&self, session: &Arc<LiveSession>) -> Result<(), String> {
        let record = self.copy_record(session)?;
        let (method, params) = if let Some(native) = &record.native_session_id {
            let method = if record.capabilities.resume {
                "session/resume"
            } else if record.capabilities.load_session {
                "session/load"
            } else {
                return Err("This agent no longer supports resuming this conversation.".into());
            };
            (
                method,
                json!({"sessionId":native,"cwd":record.project_path,"mcpServers":session.mcp_servers}),
            )
        } else {
            (
                "session/new",
                json!({"cwd":record.project_path,"mcpServers":session.mcp_servers}),
            )
        };
        let result = session
            .connection
            .request(method, params, REQUEST_TIMEOUT)
            .await;
        match result {
            Ok(value) => {
                let mut state = session
                    .state
                    .lock()
                    .map_err(|_| "The ACP session is unavailable.")?;
                if state.record.native_session_id.is_none() {
                    let id = value["sessionId"]
                        .as_str()
                        .filter(|id| !id.is_empty() && id.len() <= 512)
                        .ok_or("The agent returned no valid session ID.")?;
                    state.record.native_session_id = Some(session.redactor.opaque_id(id)?);
                }
                session.redactor.validate_metadata_ids(&value)?;
                state.record.controls.merge(&session.redactor.value(&value));
                state.record.status = SessionStatus::Ready;
                state.record.error = None;
                state.replaying = false;
                self.emit_locked(session, &mut state, "status", json!({"status":"ready"}))?;
                Ok(())
            }
            Err(error) if error.auth_required() => {
                let mut state = session
                    .state
                    .lock()
                    .map_err(|_| "The ACP session is unavailable.")?;
                state.record.status = SessionStatus::AuthRequired;
                state.record.error =
                    Some("Sign in through this agent's CLI account, then reconnect.".into());
                state.replaying = false;
                self.emit_locked(
                    session,
                    &mut state,
                    "status",
                    json!({"status":"auth_required"}),
                )?;
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    }

    pub async fn authenticate(
        self: &Arc<Self>,
        id: &str,
        method_id: &str,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "This ACP session is busy.")?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::AuthRequired
            || !record
                .auth_methods
                .iter()
                .any(|method| method.id == method_id)
        {
            return Err("This sign-in method is no longer available.".into());
        }
        session
            .connection
            .request(
                "authenticate",
                json!({"methodId":method_id}),
                Duration::from_secs(180),
            )
            .await
            .map_err(|_| {
                "Sign-in did not complete. Use the agent's CLI to sign in, then reconnect."
            })?;
        if let Err(error) = self.establish(&session).await {
            let _ = self.fail(&session, &error);
            session.connection.shutdown().await;
            self.release_live(&session).await;
            return Err(session.redactor.text(&error));
        }
        self.snapshot(id).await
    }

    pub async fn set_model(
        self: &Arc<Self>,
        id: &str,
        model_id: &str,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "Wait for this turn to finish before changing the model.")?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::Ready
            || !record
                .controls
                .models
                .iter()
                .any(|model| model.model_id == model_id)
        {
            return Err("This model is not available in the current ACP session.".into());
        }
        let native = record
            .native_session_id
            .ok_or("The ACP session is not ready.")?;
        let (method, params) = if let Some(config_id) = record.controls.model_config_id {
            (
                "session/set_config_option",
                json!({"sessionId":native,"configId":config_id,"value":model_id}),
            )
        } else {
            (
                "session/set_model",
                json!({"sessionId":native,"modelId":model_id}),
            )
        };
        let result = session
            .connection
            .request(method, params, REQUEST_TIMEOUT)
            .await
            .map_err(|e| e.to_string())?;
        if let Err(error) = session.redactor.validate_metadata_ids(&result) {
            let _ = self.fail(&session, &error);
            session.connection.shutdown().await;
            self.release_live(&session).await;
            return Err(error);
        }
        if method == "session/set_config_option" {
            let mut controls = SessionControls::default();
            controls.merge(&result);
            if controls.model_id.as_deref() != Some(model_id) {
                return Err("The agent did not confirm that model. Reconnect to refresh its available models.".into());
            }
        }
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.controls.model_id = Some(model_id.into());
            state
                .record
                .controls
                .merge(&session.redactor.value(&result));
            self.emit_locked(
                &session,
                &mut state,
                "controls",
                json!({"controls":state_controls(&result)}),
            )?;
        }
        self.snapshot(id).await
    }

    pub async fn prompt(
        self: &Arc<Self>,
        id: &str,
        text: String,
        images: Vec<ImagePrompt>,
    ) -> Result<SessionSnapshot, String> {
        if text.trim().is_empty() && images.is_empty() {
            return Err("Write a message before sending.".into());
        }
        if text.len() > 256 * 1024 || images.len() > 4 {
            return Err("This message is too large. Shorten it or send fewer images.".into());
        }
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "This ACP agent is already working on a turn.")?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::Ready {
            return Err("Connect and sign in to this agent before sending a message.".into());
        }
        if !images.is_empty() && !record.capabilities.image {
            return Err("This agent does not accept images.".into());
        }
        let mut prompt = vec![json!({"type":"text","text":text})];
        for image in &images {
            if !matches!(
                image.mime_type.as_str(),
                "image/png" | "image/jpeg" | "image/webp" | "image/gif"
            ) || image.data.len() > 640 * 1024
            {
                return Err("Use a PNG, JPEG, WebP or GIF image smaller than 480 KiB.".into());
            }
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(&image.data)
                .map_err(|_| "The image data is invalid.")?;
            prompt.push(json!({"type":"image","mimeType":image.mime_type,"data":image.data}));
        }
        let params = json!({"sessionId":record.native_session_id,"prompt":prompt});
        if serde_json::to_vec(&params)
            .map_err(|e| e.to_string())?
            .len()
            > super::protocol::MAX_FRAME - 1024
        {
            return Err("The combined message and images exceed the ACP frame limit.".into());
        }
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.turn_id = Some(new_id());
            state.record.status = SessionStatus::Running;
            state.record.error = None;
            state.cancelled = false;
            if state.record.last_sequence <= 1 {
                state.record.title = session
                    .redactor
                    .text(text.trim())
                    .chars()
                    .take(80)
                    .collect();
            }
            self.emit_locked(&session, &mut state, "user_message", json!({"text":text,"images":images.iter().map(|v| json!({"mimeType":v.mime_type})).collect::<Vec<_>>()}))?;
        }
        let result = session
            .connection
            .request("session/prompt", params, PROMPT_TIMEOUT)
            .await;
        self.expire_permissions(&session).await;
        let error;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let (status, stop, message) = match &result {
                Ok(value) if !state.cancelled => (
                    if session.connection.is_closed() {
                        SessionStatus::Disconnected
                    } else {
                        SessionStatus::Ready
                    },
                    value["stopReason"]
                        .as_str()
                        .unwrap_or("end_turn")
                        .to_owned(),
                    None,
                ),
                _ if state.cancelled => (SessionStatus::Cancelled, "cancelled".into(), None),
                Err(error) => (
                    SessionStatus::Failed,
                    "error".into(),
                    Some(session.redactor.text(&error.to_string())),
                ),
                _ => (
                    SessionStatus::Failed,
                    "error".into(),
                    Some("The agent stopped before completing this turn.".into()),
                ),
            };
            if let Ok(value) = &result {
                if let Some(usage) = prompt_usage(value) {
                    self.emit_locked(
                        &session,
                        &mut state,
                        "usage",
                        serde_json::to_value(usage).map_err(|e| e.to_string())?,
                    )?;
                }
            }
            state.record.status = status;
            state.record.error = message.clone();
            error = message;
            self.emit_locked(
                &session,
                &mut state,
                "turn_complete",
                json!({"stopReason":stop,"error":error}),
            )?;
        }
        if let Some(error) = error {
            session.connection.shutdown().await;
            self.release_live(&session).await;
            return Err(error);
        }
        self.snapshot(id).await
    }

    pub async fn cancel(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let session = match self.get_live(id).await {
            Ok(session) => session,
            Err(_) => return Ok(()),
        };
        let cancelling = (|| {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.cancelled = true;
            state.record.status = SessionStatus::Cancelling;
            self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status":"cancelling"}),
            )
        })();
        self.expire_permissions(&session).await;
        if let Ok(record) = self.copy_record(&session) {
            if let Some(native) = record.native_session_id {
                let _ = session.connection.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":native}})).await;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        session.connection.shutdown().await;
        let cancelled = (|| {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.status = SessionStatus::Cancelled;
            self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status":"cancelled"}),
            )
        })();
        self.release_live(&session).await;
        cancelling.and(cancelled)
    }

    pub async fn close(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let session = match self.get_live(id).await {
            Ok(session) => session,
            Err(_) => return Ok(()),
        };
        if self.copy_record(&session)?.status == SessionStatus::Running {
            return self.cancel(id).await;
        }
        self.expire_permissions(&session).await;
        session.connection.shutdown().await;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            if !matches!(
                state.record.status,
                SessionStatus::Failed | SessionStatus::Cancelled | SessionStatus::Disconnected
            ) {
                state.record.status = SessionStatus::Disconnected;
                self.emit_locked(
                    &session,
                    &mut state,
                    "status",
                    json!({"status":"disconnected"}),
                )?;
            }
        }
        self.release_live(&session).await;
        Ok(())
    }

    async fn release_live(&self, session: &Arc<LiveSession>) {
        if session.connection.is_closed() {
            if let Some(temporary) = &session.task_temp {
                let _ = std::fs::remove_dir_all(&temporary.0);
            }
        }
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        let mut sessions = self.live.lock().await;
        if sessions
            .get(&record.id)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            sessions.remove(&record.id);
            if let Ok(mut resources) = self.resources.lock() {
                resources.remove(&record.id);
            }
        }
    }

    pub async fn close_owner(self: &Arc<Self>, owner: &str) {
        if let Ok(mut epochs) = self.owner_epochs.lock() {
            let epoch = epochs.entry(owner.into()).or_default();
            *epoch = epoch.wrapping_add(1);
        }
        let ids: Vec<_> = self
            .live
            .lock()
            .await
            .iter()
            .filter(|(_, session)| session.owner.as_deref() == Some(owner))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let _ = self.close(&id).await;
        }
    }

    pub async fn shutdown_all(self: &Arc<Self>) {
        if let Ok(mut state) = self.startup.lock() {
            state.stopping = true;
        }
        let mut settled = self.startup_count.subscribe();
        let ids: Vec<_> = self.live.lock().await.keys().cloned().collect();
        for id in ids {
            let _ = self.close(&id).await;
        }
        let _ = settled.wait_for(|count| *count == 0).await;
    }

    pub async fn assert_owner(&self, id: &str, owner: &str) -> Result<(), String> {
        let session = self.get_live(id).await?;
        if session.owner.as_deref() != Some(owner) {
            return Err("This window does not own the ACP session.".into());
        }
        Ok(())
    }

    pub async fn snapshot(&self, id: &str) -> Result<SessionSnapshot, String> {
        if let Some(session) = self.live.lock().await.get(id) {
            let state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            return Ok(SessionSnapshot {
                session: state.record.clone(),
                permissions: state
                    .permissions
                    .values()
                    .map(|v| v.request.clone())
                    .collect(),
            });
        }
        Ok(SessionSnapshot {
            session: self.store.get(id)?,
            permissions: Vec::new(),
        })
    }

    async fn get_live(&self, id: &str) -> Result<Arc<LiveSession>, String> {
        self.live
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| "This ACP session is disconnected.".into())
    }
    fn copy_record(&self, session: &LiveSession) -> Result<SessionRecord, String> {
        Ok(session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?
            .record
            .clone())
    }

    fn emit_locked(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        kind: &str,
        data: Value,
    ) -> Result<(), String> {
        let data = session.redactor.value(&data);
        let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?.len();
        if bytes > 256 * 1024
            || (state.bytes + bytes > MAX_SESSION_BYTES
                && !matches!(kind, "turn_complete" | "status" | "permission_resolved"))
        {
            session.connection.request_stop();
            return Err(
                "This session reached its transcript size limit. Start a new conversation.".into(),
            );
        }
        state.record.updated_at = now_ms();
        state.record.last_sequence += 1;
        let event = AcpEvent {
            session_id: state.record.id.clone(),
            project_id: state.record.project_id.clone(),
            agent_id: state.record.agent_id.clone(),
            model_id: state.record.controls.model_id.clone(),
            task_id: state.record.task_id.clone(),
            turn_id: state.record.turn_id.clone(),
            sequence: state.record.last_sequence,
            timestamp: state.record.updated_at,
            kind: kind.into(),
            data,
        };
        if self.store.append(&state.record, &event).is_err() {
            session.connection.request_stop();
            state.record.last_sequence -= 1;
            state.record.status = SessionStatus::Failed;
            state.record.error = Some("The ACP transcript could not be saved. The agent was stopped to preserve the saved history.".into());
            return Err(state.record.error.clone().unwrap_or_default());
        }
        state.bytes += bytes;
        let _ = self.events.send(event);
        Ok(())
    }

    fn fail(&self, session: &LiveSession, error: &str) -> Result<(), String> {
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        state.record.status = SessionStatus::Failed;
        state.record.error = Some(session.redactor.text(error));
        self.emit_locked(
            session,
            &mut state,
            "status",
            json!({"status":"failed","error":error}),
        )
    }

    fn spawn_reader(
        self: &Arc<Self>,
        session: Arc<LiveSession>,
        mut incoming: tokio::sync::mpsc::Receiver<Incoming>,
    ) {
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some(message) = incoming.recv().await {
                let Some(runtime) = weak.upgrade() else {
                    break;
                };
                match message {
                    Incoming::Message(value) => {
                        if let Err(error) = runtime.handle_message(&session, value).await {
                            let _ = runtime.fail(&session, &error);
                            session.connection.shutdown().await;
                            break;
                        }
                    }
                    Incoming::Barrier(sender) => {
                        let _ = sender.send(());
                    }
                    Incoming::Disconnected => break,
                }
            }
            if let Some(runtime) = weak.upgrade() {
                runtime.expire_permissions(&session).await;
                if let Ok(mut state) = session.state.lock() {
                    if !matches!(
                        state.record.status,
                        SessionStatus::Failed
                            | SessionStatus::Cancelled
                            | SessionStatus::Cancelling
                    ) {
                        state.record.status = SessionStatus::Disconnected;
                        let _ = runtime.emit_locked(
                            &session,
                            &mut state,
                            "status",
                            json!({"status":"disconnected"}),
                        );
                    }
                }
                runtime.release_live(&session).await;
            }
        });
    }

    async fn handle_message(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        value: Value,
    ) -> Result<(), String> {
        match value["method"].as_str() {
            Some("session/update") if value.get("id").is_none() => {
                let mut state = session.state.lock().map_err(|_| "The ACP session is unavailable.")?;
                if state.replaying { return Ok(()); }
                if value["params"]["sessionId"].as_str() != state.record.native_session_id.as_deref() { return Err("The agent sent an update for another session.".into()); }
                let update = &value["params"]["update"];
                let kind = update["sessionUpdate"].as_str().ok_or("The agent update has no type.")?;
                match kind {
                    "config_option_update" | "config_options_update" => { session.redactor.validate_metadata_ids(update)?; state.record.controls.merge(&session.redactor.value(update)); self.emit_locked(session, &mut state, "controls", update.clone())?; },
                    "current_model_update" => { state.record.controls.model_id = update["currentModelId"].as_str().map(|id| session.redactor.opaque_id(id)).transpose()?; self.emit_locked(session, &mut state, "controls", update.clone())?; },
                    "usage_update" => {
                        let usage = UsageCounters { input_tokens: None, output_tokens: None, cache_read_tokens: None, cache_write_tokens: None, total_tokens: None, context_used: update["used"].as_u64(), context_size: update["size"].as_u64(), source: "acp_context".into() };
                        self.emit_locked(session, &mut state, "usage", serde_json::to_value(usage).map_err(|e| e.to_string())?)?;
                    },
                    "agent_message_chunk" | "agent_thought_chunk" | "tool_call" | "tool_call_update" | "plan" | "available_commands_update" => {
                        if matches!(state.record.status, SessionStatus::Running | SessionStatus::Cancelling) { self.emit_locked(session, &mut state, kind, update.clone())?; }
                    },
                    _ => {},
                }
                Ok(())
            },
            Some("session/request_permission") if value.get("id").is_some() => self.permission_requested(session, &value).await,
            Some(_) if value.get("id").is_some() => session.connection.send(json!({"jsonrpc":"2.0","id":value["id"],"error":{"code":-32601,"message":"This client capability is not available."}})).await.map_err(|e| e.to_string()),
            _ => Ok(()),
        }
    }

    async fn permission_requested(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        value: &Value,
    ) -> Result<(), String> {
        let params = &value["params"];
        let record = self.copy_record(session)?;
        let allowed = (session.owner.is_some() || session.task_temp.is_some())
            && record.status == SessionStatus::Running
            && params["sessionId"].as_str() == record.native_session_id.as_deref()
            && permission_paths_allowed(Path::new(&record.project_path), &params["toolCall"]);
        if !allowed {
            return session.connection.send(json!({"jsonrpc":"2.0","id":value["id"],"result":{"outcome":{"outcome":"cancelled"}}})).await.map_err(|e| e.to_string());
        }
        session.redactor.validate_metadata_ids(&params["options"])?;
        let request = PermissionRequest {
            id: new_id(),
            session_id: record.id.clone(),
            turn_id: record.turn_id.ok_or("No ACP turn is active.")?,
            title: session.redactor.text(
                params["toolCall"]["title"]
                    .as_str()
                    .unwrap_or("Allow this agent action?"),
            ),
            tool_call_id: params["toolCall"]["toolCallId"]
                .as_str()
                .map(|id| session.redactor.opaque_id(id))
                .transpose()?,
            options: params["options"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .take(16)
                        .filter_map(|value| {
                            serde_json::from_value(session.redactor.value(value)).ok()
                        })
                        .collect()
                })
                .unwrap_or_default(),
            expires_at: now_ms() + PERMISSION_TIMEOUT_MS,
        };
        let auto_option = if session.task_temp.is_some() {
            request
                .options
                .iter()
                .find(|option| option.kind == "allow_once")
                .map(|option| option.option_id.clone())
        } else {
            None
        };
        let permission_id = request.id.clone();
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            if state.permissions.len() >= 16
                || state
                    .permissions
                    .values()
                    .any(|entry| entry.wire_id == value["id"])
            {
                return Err("The agent sent too many or duplicate permission requests.".into());
            }
            self.emit_locked(
                session,
                &mut state,
                "permission",
                serde_json::to_value(&request).map_err(|e| e.to_string())?,
            )?;
            state.permissions.insert(
                permission_id.clone(),
                PendingPermission {
                    request,
                    wire_id: value["id"].clone(),
                },
            );
        }
        if session.task_temp.is_some() {
            return self
                .resolve_permission(&record.id, &permission_id, auto_option)
                .await;
        }
        let weak = Arc::downgrade(self);
        let session_id = record.id;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(PERMISSION_TIMEOUT_MS)).await;
            if let Some(runtime) = weak.upgrade() {
                let _ = runtime
                    .resolve_permission(&session_id, &permission_id, None)
                    .await;
            }
        });
        Ok(())
    }

    pub async fn resolve_permission(
        &self,
        id: &str,
        permission_id: &str,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let session = self.get_live(id).await?;
        let (pending, outcome) = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let pending = state
                .permissions
                .get(permission_id)
                .ok_or("This permission request has expired.")?;
            let expired = pending.request.expires_at <= now_ms()
                || state.record.status != SessionStatus::Running
                || state.record.turn_id.as_deref() != Some(&pending.request.turn_id);
            if option_id.is_some() && expired {
                return Err("This permission request has expired.".into());
            }
            if let Some(option) = &option_id {
                if !pending
                    .request
                    .options
                    .iter()
                    .any(|value| &value.option_id == option)
                {
                    return Err("This permission option is not available.".into());
                }
            }
            let outcome = match &option_id {
                Some(option) => json!({"outcome":"selected","optionId":option}),
                None => json!({"outcome":"cancelled"}),
            };
            self.emit_locked(
                &session,
                &mut state,
                "permission_resolved",
                json!({"id":permission_id,"optionId":option_id,"outcome":outcome["outcome"]}),
            )?;
            (
                state
                    .permissions
                    .remove(permission_id)
                    .ok_or("This permission request has expired.")?,
                outcome,
            )
        };
        session
            .connection
            .send(json!({"jsonrpc":"2.0","id":pending.wire_id,"result":{"outcome":outcome}}))
            .await
            .map_err(|e| e.to_string())
    }

    async fn expire_permissions(&self, session: &LiveSession) {
        let pending = if let Ok(mut state) = session.state.lock() {
            state.permissions.drain().collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        for (id, entry) in pending {
            if let Ok(mut state) = session.state.lock() {
                let _ = self.emit_locked(
                    session,
                    &mut state,
                    "permission_resolved",
                    json!({"id":id,"outcome":"cancelled"}),
                );
            }
            let _ = session.connection.send(json!({"jsonrpc":"2.0","id":entry.wire_id,"result":{"outcome":{"outcome":"cancelled"}}})).await;
        }
    }
}

fn state_controls(value: &Value) -> Value {
    value
        .get("configOptions")
        .or_else(|| value.get("models"))
        .cloned()
        .unwrap_or(Value::Null)
}

fn canonical_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(
            "The ACP project root must be an absolute directory without parent traversal.".into(),
        );
    }
    let root = path
        .canonicalize()
        .map_err(|_| "The ACP project directory could not be resolved.")?;
    if !root.is_dir() {
        return Err("The ACP project root is not a directory.".into());
    }
    Ok(root)
}

pub(super) fn equivalent_path_prefixes(
    left: std::path::Prefix<'_>,
    right: std::path::Prefix<'_>,
) -> bool {
    use std::path::Prefix;
    match (left, right) {
        (
            Prefix::Disk(left) | Prefix::VerbatimDisk(left),
            Prefix::Disk(right) | Prefix::VerbatimDisk(right),
        ) => left.eq_ignore_ascii_case(&right),
        (
            Prefix::UNC(left_server, left_share) | Prefix::VerbatimUNC(left_server, left_share),
            Prefix::UNC(right_server, right_share) | Prefix::VerbatimUNC(right_server, right_share),
        ) => left_server == right_server && left_share == right_share,
        (left, right) => left == right,
    }
}

fn lexical_path_within(path: &Path, root: &Path) -> bool {
    let mut components = path.components();
    root.components()
        .all(|root_component| match (components.next(), root_component) {
            (Some(Component::Prefix(path)), Component::Prefix(root)) => {
                equivalent_path_prefixes(path.kind(), root.kind())
            }
            (Some(path), root) => path == root,
            (None, _) => false,
        })
}

pub fn permission_paths_allowed(root: &Path, tool: &Value) -> bool {
    let paths = tool["locations"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value["path"].as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    paths
        .into_iter()
        .chain(
            ["path", "file_path", "filePath", "cwd", "directory"]
                .iter()
                .filter_map(|key| tool["rawInput"][key].as_str()),
        )
        .all(|path| {
            let path = Path::new(path);
            if path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
            {
                return false;
            }
            let candidate = if path.is_absolute() {
                path.to_path_buf()
            } else {
                root.join(path)
            };
            let mut existing = candidate.as_path();
            while !existing.exists() {
                let Some(parent) = existing.parent() else {
                    return false;
                };
                existing = parent;
            }
            existing
                .canonicalize()
                .is_ok_and(|path| path.starts_with(root))
                && lexical_path_within(&candidate, root)
        })
}

pub fn prompt_usage(value: &Value) -> Option<UsageCounters> {
    let usage = value.get("usage")?;
    Some(UsageCounters {
        input_tokens: usage["inputTokens"].as_u64(),
        output_tokens: usage["outputTokens"].as_u64(),
        cache_read_tokens: usage["cachedReadTokens"].as_u64(),
        cache_write_tokens: usage["cachedWriteTokens"].as_u64(),
        total_tokens: usage["totalTokens"].as_u64(),
        context_used: None,
        context_size: None,
        source: "acp_prompt".into(),
    })
}
