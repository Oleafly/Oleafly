use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use futures_util::future::AbortHandle;
#[cfg(test)]
use futures_util::future::Abortable;
use oleafly_agent::{
    AgentEvent, CompletionRequest, CompletionResponse, ProviderConfig, RunConfig, ToolOutput,
};
use tauri::{Manager, State};

use crate::config::AppConfig;

mod registry;
use registry::{acquire_request_slot, cancel_all_requests, cancel_request, run_registered};
#[cfg(test)]
use registry::{begin_request, finish_request};

const MAX_EARLY_CANCELLATIONS: usize = 256;
const MAX_RUN_STEPS: u32 = 50;
const MAX_RUN_RETRIES: u32 = 4;
const MIN_RETRY_BASE_MS: u64 = 100;
const MAX_RETRY_BASE_MS: u64 = 10_000;
const MAX_TOOL_EXECUTION_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_CONCURRENT_AGENT_REQUESTS: usize = 8;

fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct ActiveRequest {
    generation: u64,
    handle: AbortHandle,
}

struct PendingTool {
    generation: u64,
    sender: tokio::sync::oneshot::Sender<ToolOutput>,
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, ActiveRequest>,
    early_cancellations: VecDeque<String>,
    next_generation: u64,
    session_id: Option<String>,
}

pub struct AgentState {
    client: Mutex<Option<reqwest::Client>>,
    requests: Mutex<RequestRegistry>,
    pending_tools: Mutex<HashMap<String, PendingTool>>,
    request_slots: std::sync::Arc<tokio::sync::Semaphore>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
            requests: Mutex::new(RequestRegistry::default()),
            pending_tools: Mutex::new(HashMap::new()),
            request_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(
                MAX_CONCURRENT_AGENT_REQUESTS,
            )),
        }
    }
}

impl AgentState {
    fn client(&self) -> Result<reqwest::Client, String> {
        let mut slot = lock_or_recover(&self.client);
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = oleafly_agent::build_client().map_err(tagged)?;
        *slot = Some(client.clone());
        Ok(client)
    }
}

pub fn provider_config(cfg: &AppConfig) -> ProviderConfig {
    ProviderConfig {
        provider: cfg.ai_provider.clone(),
        model: cfg.ai_model.clone(),
        legacy_key: cfg.ai_api_key.clone(),
        keys: cfg
            .ai_keys
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        enabled_models: cfg
            .ai_provider_models
            .iter()
            .map(|(provider, models)| {
                (
                    provider.clone(),
                    models
                        .iter()
                        .filter(|model| model.enabled && !model.id.trim().is_empty())
                        .map(|model| model.id.clone())
                        .collect(),
                )
            })
            .collect(),
        custom: cfg
            .ai_custom_providers
            .iter()
            .map(|c| oleafly_agent::CustomProvider {
                id: c.id.clone(),
                base_url: c.base_url.clone(),
                key_optional: c.key_optional,
            })
            .collect(),
    }
}

#[derive(serde::Deserialize)]
pub struct ProviderOverride {
    pub provider_id: String,
    #[serde(default)]
    pub model_id: String,
}

fn tagged(error: oleafly_agent::AgentError) -> String {
    format!("[{}] {error}", error.kind())
}

async fn resolve_off_thread(
    provider_override: Option<ProviderOverride>,
) -> Result<oleafly_agent::Resolved, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_for(provider_override))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_complete(
    state: State<'_, AgentState>,
    request_id: String,
    request: CompletionRequest,
    provider_override: Option<ProviderOverride>,
) -> Result<CompletionResponse, String> {
    let agent_state = state.inner();
    run_registered(agent_state, &request_id, |_| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        oleafly_agent::complete(&client, &resolved, &request)
            .await
            .map_err(tagged)
    })
    .await
}

#[tauri::command]
pub fn agent_cancel_all(state: State<'_, AgentState>, session_id: String) {
    cancel_all_requests(state.inner(), &session_id);
    lock_or_recover(&state.pending_tools).clear();
}

#[tauri::command]
pub fn agent_cancel(state: State<'_, AgentState>, request_id: String) {
    if let Some(generation) = cancel_request(state.inner(), &request_id) {
        drop_pending_tools(state.inner(), &request_id, Some(generation));
    }
}

#[tauri::command]
pub async fn agent_stream(
    state: State<'_, AgentState>,
    request_id: String,
    request: CompletionRequest,
    provider_override: Option<ProviderOverride>,
    on_event: tauri::ipc::Channel<oleafly_agent::AgentEvent>,
) -> Result<(), String> {
    let agent_state = state.inner();
    run_registered(agent_state, &request_id, |_| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        oleafly_agent::stream_completion(&client, &resolved, &request, |event| {
            let _ = on_event.send(event);
        })
        .await
        .map(|_| ())
        .map_err(tagged)
    })
    .await
}

#[tauri::command]
pub async fn agent_run(
    state: State<'_, AgentState>,
    app: tauri::AppHandle,
    request_id: String,
    request: CompletionRequest,
    config: Option<RunConfig>,
    provider_override: Option<ProviderOverride>,
    on_event: tauri::ipc::Channel<AgentEvent>,
) -> Result<oleafly_agent::RunOutcome, String> {
    let agent_state = state.inner();
    let config = sanitized_run_config(config);
    let run_id = request_id.clone();
    run_registered(agent_state, &request_id, |generation| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        let sink = on_event.clone();
        let run_tool = webview_tool_runner(app, run_id, generation, on_event);
        oleafly_agent::run_agent(
            &client,
            &resolved,
            request,
            &config,
            run_tool,
            move |event| {
                let _ = sink.send(event);
            },
        )
        .await
        .map_err(tagged)
    })
    .await
}

fn webview_tool_runner(
    app: tauri::AppHandle,
    request_id: String,
    generation: u64,
    tool_sink: tauri::ipc::Channel<AgentEvent>,
) -> oleafly_agent::ToolRunner {
    let sequence = std::sync::Arc::new(AtomicU64::new(0));
    std::sync::Arc::new(move |call| {
        let tool_sink = tool_sink.clone();
        let handle = app.clone();
        let run_id = request_id.clone();
        let reply_id = tool_reply_id(
            generation,
            sequence.fetch_add(1, Ordering::Relaxed),
            &call.id,
        );
        Box::pin(async move {
            let key = tool_key(&run_id, &reply_id);
            let (tx, rx) = tokio::sync::oneshot::channel();
            {
                let state = handle.state::<AgentState>();
                lock_or_recover(&state.pending_tools).insert(
                    key.clone(),
                    PendingTool {
                        generation,
                        sender: tx,
                    },
                );
            }
            let _guard = PendingToolGuard {
                handle: handle.clone(),
                key: key.clone(),
                generation,
            };
            if tool_sink
                .send(AgentEvent::ToolRequest {
                    id: reply_id,
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                })
                .is_err()
            {
                return tool_error("the tool request could not be delivered");
            }
            match await_tool_result(rx, MAX_TOOL_EXECUTION_DURATION).await {
                Ok(output) => output,
                Err(message) => tool_error(message),
            }
        })
    })
}

async fn await_tool_result(
    receiver: tokio::sync::oneshot::Receiver<ToolOutput>,
    timeout: Duration,
) -> Result<ToolOutput, &'static str> {
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) => Err("the tool was not executed"),
        Err(_) => Err("the tool execution timed out"),
    }
}

fn tool_error(message: &str) -> ToolOutput {
    ToolOutput::text(serde_json::json!({ "error": message }).to_string())
}

struct PendingToolGuard {
    handle: tauri::AppHandle,
    key: String,
    generation: u64,
}

impl Drop for PendingToolGuard {
    fn drop(&mut self) {
        let state = self.handle.state::<AgentState>();
        remove_pending_tool(state.inner(), &self.key, self.generation);
    }
}

#[tauri::command]
pub fn agent_tool_result(
    state: State<'_, AgentState>,
    request_id: String,
    call_id: String,
    output: ToolOutput,
) {
    let key = tool_key(&request_id, &call_id);
    let pending = { lock_or_recover(&state.pending_tools).remove(&key) };
    if let Some(pending) = pending {
        let _ = pending
            .sender
            .send(oleafly_agent::bound_tool_output(output));
    }
}

fn tool_key(request_id: &str, call_id: &str) -> String {
    format!("{request_id}\u{1f}{call_id}")
}

fn tool_reply_id(generation: u64, sequence: u64, provider_call_id: &str) -> String {
    format!("tool-{generation}-{sequence}-{provider_call_id}")
}

fn remove_pending_tool(state: &AgentState, key: &str, generation: u64) {
    let mut pending = lock_or_recover(&state.pending_tools);
    let owned = pending
        .get(key)
        .map(|tool| tool.generation == generation)
        .unwrap_or(false);
    if owned {
        pending.remove(key);
    }
}

fn drop_pending_tools(state: &AgentState, request_id: &str, generation: Option<u64>) {
    let prefix = format!("{request_id}\u{1f}");
    lock_or_recover(&state.pending_tools).retain(|key, tool| {
        let matching_generation = generation
            .map(|generation| generation == tool.generation)
            .unwrap_or(true);
        !(key.starts_with(&prefix) && matching_generation)
    });
}

fn sanitized_run_config(config: Option<RunConfig>) -> RunConfig {
    let mut config = config.unwrap_or_default();
    config.max_steps = config.max_steps.clamp(1, MAX_RUN_STEPS);
    config.max_retries = config.max_retries.min(MAX_RUN_RETRIES);
    config.retry_base_ms = config
        .retry_base_ms
        .clamp(MIN_RETRY_BASE_MS, MAX_RETRY_BASE_MS);
    config
}

fn endpoint_override_allowed(
    projected: &ProviderConfig,
    provider_id: &str,
    key_supplied: bool,
    base_url: &Option<String>,
) -> bool {
    if base_url.is_none() || key_supplied {
        return true;
    }
    let stored = projected
        .keys
        .get(provider_id)
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    !stored
}

#[tauri::command]
pub async fn agent_list_models(
    state: State<'_, AgentState>,
    provider_id: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<oleafly_agent::ModelInfo>, String> {
    let _request_slot = acquire_request_slot(state.inner())?;
    let cfg = tauri::async_runtime::spawn_blocking(crate::config::read_config)
        .await
        .map_err(|e| e.to_string())??;
    let mut projected = provider_config(&cfg);
    let supplied_key = key.filter(|k| !k.trim().is_empty());
    let base_url = base_url.filter(|b| !b.trim().is_empty());

    if !endpoint_override_allowed(&projected, &provider_id, supplied_key.is_some(), &base_url) {
        return Err(format!(
            "Re-enter the API key to change the endpoint for {provider_id}."
        ));
    }

    if let Some(key) = supplied_key {
        projected.keys.insert(provider_id.clone(), key);
    }
    if let Some(base_url) = base_url {
        match projected.custom.iter_mut().find(|c| c.id == provider_id) {
            Some(existing) => existing.base_url = base_url,
            None => projected.custom.push(oleafly_agent::CustomProvider {
                id: provider_id.clone(),
                base_url,
                key_optional: true,
            }),
        }
    }

    let resolved = oleafly_agent::provider::resolve_for_model_listing(&projected, &provider_id)
        .map_err(|e| e.to_string())?;
    let client = state.client()?;
    oleafly_agent::list_models(&client, &resolved)
        .await
        .map_err(|e| format!("[{}] {e}", e.kind()))
}

fn resolve_for(
    provider_override: Option<ProviderOverride>,
) -> Result<oleafly_agent::Resolved, String> {
    let cfg = crate::config::read_config()?;
    let projected = provider_config(&cfg);
    match provider_override {
        Some(o) => {
            oleafly_agent::provider::resolve_specific(&projected, &o.provider_id, &o.model_id)
        }
        None => oleafly_agent::resolve(&projected),
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
