use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use oleafly_agent::{
    AgentEvent, CompletionRequest, CompletionResponse, ProviderConfig, RunConfig, ToolOutput,
};
use tauri::{Manager, State};

use crate::config::AppConfig;

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

fn begin_request(state: &AgentState, request_id: &str) -> Option<(u64, AbortRegistration)> {
    let (handle, registration) = AbortHandle::new_pair();
    let (generation, previous) = {
        let mut registry = lock_or_recover(&state.requests);
        match (
            registry.session_id.as_deref(),
            request_session_id(request_id),
        ) {
            (Some(current), Some(request)) if current == request => {}
            (Some(_), _) => return None,
            (None, Some(request)) => registry.session_id = Some(request.to_string()),
            (None, None) => {}
        }
        if let Some(index) = registry
            .early_cancellations
            .iter()
            .position(|pending| pending == request_id)
        {
            registry.early_cancellations.remove(index);
            return None;
        }

        registry.next_generation = registry.next_generation.wrapping_add(1);
        let generation = registry.next_generation;
        let previous = registry
            .active
            .insert(request_id.to_string(), ActiveRequest { generation, handle });
        (generation, previous)
    };

    if let Some(previous) = previous {
        previous.handle.abort();
    }
    Some((generation, registration))
}

fn finish_request(state: &AgentState, request_id: &str, generation: u64) {
    let mut registry = lock_or_recover(&state.requests);
    let owns_registration = registry
        .active
        .get(request_id)
        .map(|active| active.generation == generation)
        .unwrap_or(false);
    if owns_registration {
        registry.active.remove(request_id);
    }
}

fn cancel_request(state: &AgentState, request_id: &str) -> Option<u64> {
    let active = {
        let mut registry = lock_or_recover(&state.requests);
        let active = registry.active.remove(request_id);
        if active.is_none()
            && !registry
                .early_cancellations
                .iter()
                .any(|pending| pending == request_id)
        {
            if registry.early_cancellations.len() == MAX_EARLY_CANCELLATIONS {
                registry.early_cancellations.pop_front();
            }
            registry
                .early_cancellations
                .push_back(request_id.to_string());
        }
        active
    };
    let generation = active.as_ref().map(|active| active.generation);
    if let Some(active) = active {
        active.handle.abort();
    }
    generation
}

fn cancel_all_requests(state: &AgentState, session_id: &str) {
    let handles: Vec<AbortHandle> = {
        let mut registry = lock_or_recover(&state.requests);
        registry.session_id = Some(session_id.to_string());
        registry.early_cancellations.clear();
        registry
            .active
            .drain()
            .map(|(_, active)| active.handle)
            .collect()
    };
    for handle in handles {
        handle.abort();
    }
}

fn request_session_id(request_id: &str) -> Option<&str> {
    let rest = request_id.strip_prefix("agent:")?;
    let (session, _) = rest.split_once(':')?;
    (!session.is_empty()).then_some(session)
}

struct RequestGuard<'a> {
    state: &'a AgentState,
    request_id: &'a str,
    generation: u64,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        finish_request(self.state, self.request_id, self.generation);
    }
}

async fn run_registered<T, Factory, Work>(
    state: &AgentState,
    request_id: &str,
    work: Factory,
) -> Result<T, String>
where
    Factory: FnOnce(u64) -> Work,
    Work: Future<Output = Result<T, String>>,
{
    let _request_slot = acquire_request_slot(state)?;
    let Some((generation, registration)) = begin_request(state, request_id) else {
        return Err(tagged(oleafly_agent::AgentError::Cancelled));
    };
    let _guard = RequestGuard {
        state,
        request_id,
        generation,
    };

    let result = Abortable::new(work(generation), registration)
        .await
        .map_err(|_| tagged(oleafly_agent::AgentError::Cancelled));
    drop_pending_tools(state, request_id, Some(generation));
    result?
}

fn acquire_request_slot(state: &AgentState) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    state
        .request_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            tagged(oleafly_agent::AgentError::Decode(format!(
                "too many concurrent agent requests (limit {MAX_CONCURRENT_AGENT_REQUESTS})"
            )))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(provider: &str, keys: &[(&str, &str)]) -> AppConfig {
        AppConfig {
            ai_provider: provider.into(),
            ai_keys: keys
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..AppConfig::default()
        }
    }

    fn with_custom(provider: &str, key: &str, base_url: &str) -> ProviderConfig {
        let mut cfg = provider_config(&config_with(provider, &[(provider, key)]));
        cfg.custom.push(oleafly_agent::CustomProvider {
            id: provider.into(),
            base_url: base_url.into(),
            key_optional: false,
        });
        cfg
    }

    #[test]
    fn a_stored_key_never_travels_to_a_caller_chosen_endpoint() {
        let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
        assert!(!endpoint_override_allowed(
            &cfg,
            "gateway",
            false,
            &Some("https://attacker.example.com/v1".into())
        ));
    }

    #[test]
    fn supplying_the_key_with_the_endpoint_is_allowed() {
        let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
        assert!(endpoint_override_allowed(
            &cfg,
            "gateway",
            true,
            &Some("https://new.example.com/v1".into())
        ));
    }

    #[test]
    fn a_provider_with_no_stored_key_may_name_its_endpoint() {
        let cfg = provider_config(&AppConfig::default());
        assert!(endpoint_override_allowed(
            &cfg,
            "brand-new",
            false,
            &Some("http://127.0.0.1:8000/v1".into())
        ));
    }

    #[test]
    fn listing_without_an_endpoint_override_is_always_allowed() {
        let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
        assert!(endpoint_override_allowed(&cfg, "gateway", false, &None));
    }

    #[test]
    fn provider_config_carries_every_field_resolution_depends_on() {
        let cfg = AppConfig {
            ai_model: "claude-3-5-haiku-20241022".into(),
            ai_api_key: "legacy".into(),
            ai_provider_models: std::collections::HashMap::from([
                (
                    "anthropic".into(),
                    vec![
                        crate::config::StoredModel {
                            id: "claude-enabled".into(),
                            name: "Enabled".into(),
                            enabled: true,
                            source: "custom".into(),
                        },
                        crate::config::StoredModel {
                            id: "claude-disabled".into(),
                            name: "Disabled".into(),
                            enabled: false,
                            source: "custom".into(),
                        },
                    ],
                ),
                ("explicitly-empty".into(), vec![]),
            ]),
            ai_custom_providers: vec![crate::config::CustomProvider {
                id: "local".into(),
                name: "Local".into(),
                base_url: "http://127.0.0.1:8000/v1".into(),
                key_optional: true,
            }],
            ..config_with("anthropic", &[("anthropic", "sk-ant")])
        };

        let projected = provider_config(&cfg);
        assert_eq!(projected.provider, "anthropic");
        assert_eq!(projected.model, "claude-3-5-haiku-20241022");
        assert_eq!(projected.legacy_key, "legacy");
        assert_eq!(projected.keys.get("anthropic").unwrap(), "sk-ant");
        assert_eq!(
            projected.enabled_models.get("anthropic").unwrap(),
            &["claude-enabled"]
        );
        assert!(projected
            .enabled_models
            .get("explicitly-empty")
            .unwrap()
            .is_empty());
        assert_eq!(projected.custom[0].base_url, "http://127.0.0.1:8000/v1");
        assert!(projected.custom[0].key_optional);
    }

    #[test]
    fn a_configured_key_resolves_end_to_end_from_app_config() {
        let cfg = config_with("groq", &[("groq", "gsk-1")]);
        let resolved = oleafly_agent::resolve(&provider_config(&cfg)).unwrap();
        assert_eq!(resolved.provider_id, "groq");
        assert_eq!(resolved.model_id, "llama-3.3-70b-versatile");
        assert_eq!(resolved.credential, "gsk-1");
    }

    #[test]
    fn renderer_run_budgets_are_clamped_to_backend_limits() {
        let config = sanitized_run_config(Some(RunConfig {
            max_steps: u32::MAX,
            max_retries: u32::MAX,
            retry_base_ms: u64::MAX,
        }));

        assert_eq!(config.max_steps, MAX_RUN_STEPS);
        assert_eq!(config.max_retries, MAX_RUN_RETRIES);
        assert_eq!(config.retry_base_ms, MAX_RETRY_BASE_MS);
    }

    #[test]
    fn renderer_run_budgets_have_safe_minimums() {
        let config = sanitized_run_config(Some(RunConfig {
            max_steps: 0,
            max_retries: 0,
            retry_base_ms: 0,
        }));

        assert_eq!(config.max_steps, 1);
        assert_eq!(config.max_retries, 0);
        assert_eq!(config.retry_base_ms, MIN_RETRY_BASE_MS);
    }

    #[test]
    fn renderer_requests_are_bounded_before_provider_resolution() {
        let request = CompletionRequest {
            messages: vec![oleafly_agent::Message::user(""); 129],
            ..Default::default()
        };

        let error = oleafly_agent::validate_completion_request(&request).unwrap_err();
        assert!(matches!(error, oleafly_agent::AgentError::Decode(_)));
    }

    #[test]
    fn aggregate_agent_concurrency_is_bounded() {
        let state = AgentState::default();
        let permits: Vec<_> = (0..MAX_CONCURRENT_AGENT_REQUESTS)
            .map(|_| acquire_request_slot(&state).unwrap())
            .collect();

        let error = acquire_request_slot(&state).unwrap_err();
        assert!(error.contains("too many concurrent agent requests"));

        drop(permits);
        assert!(acquire_request_slot(&state).is_ok());
    }

    #[test]
    fn tool_bridge_failures_are_structured_for_the_model() {
        let output = tool_error("the tool request could not be delivered");
        let value: serde_json::Value = serde_json::from_str(&output.output).unwrap();

        assert_eq!(value["error"], "the tool request could not be delivered");
        assert!(output.images.is_empty());
    }

    #[tokio::test]
    async fn tool_results_have_a_deadline() {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let error = await_tool_result(receiver, Duration::ZERO)
            .await
            .unwrap_err();
        assert_eq!(error, "the tool execution timed out");
        drop(sender);

        let (sender, receiver) = tokio::sync::oneshot::channel();
        drop(sender);
        let error = await_tool_result(receiver, Duration::from_secs(1))
            .await
            .unwrap_err();
        assert_eq!(error, "the tool was not executed");
    }

    #[test]
    fn tool_results_are_bounded_at_the_command_boundary() {
        let bounded = oleafly_agent::bound_tool_output(ToolOutput {
            output: "x".repeat(128 * 1024),
            images: vec!["data:image/png;base64,AA".into(); 20],
        });

        assert!(bounded.output.len() <= 64 * 1024);
        assert!(bounded.output.contains("backend safety limit"));
        assert!(bounded.images.len() <= 6);
    }

    #[test]
    fn repeated_provider_call_ids_get_distinct_transport_ids() {
        let first = tool_reply_id(7, 0, "call_read_file_1");
        let second = tool_reply_id(7, 1, "call_read_file_1");

        assert_ne!(first, second);
        assert!(first.ends_with("call_read_file_1"));
        assert!(second.ends_with("call_read_file_1"));
    }

    #[tokio::test]
    async fn an_early_cancellation_prevents_work_from_starting() {
        let state = AgentState::default();
        let polled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let _ = cancel_request(&state, "early");

        let observed = polled.clone();
        let result = run_registered(&state, "early", |_| async move {
            observed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok::<_, String>(())
        })
        .await;

        assert!(result.unwrap_err().starts_with("[cancelled]"));
        assert!(!polled.load(std::sync::atomic::Ordering::SeqCst));
        assert!(lock_or_recover(&state.requests)
            .early_cancellations
            .is_empty());
    }

    #[tokio::test]
    async fn cancel_all_rejects_commands_from_the_previous_renderer_session() {
        let state = AgentState::default();
        cancel_all_requests(&state, "new-session");

        let old_polled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed = old_polled.clone();
        let old = run_registered(&state, "agent:old-session:1:uuid", |_| async move {
            observed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok::<_, String>(())
        })
        .await;
        assert!(old.unwrap_err().starts_with("[cancelled]"));
        assert!(!old_polled.load(std::sync::atomic::Ordering::SeqCst));

        let new = run_registered(&state, "agent:new-session:1:uuid", |_| async {
            Ok::<_, String>(())
        })
        .await;
        assert!(new.is_ok());
    }

    #[tokio::test]
    async fn cancelling_registered_work_aborts_it() {
        let state = AgentState::default();
        let (_, registration) = begin_request(&state, "active").unwrap();
        let _ = cancel_request(&state, "active");

        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            Abortable::new(std::future::pending::<()>(), registration),
        )
        .await
        .unwrap();

        assert!(outcome.is_err());
        assert!(lock_or_recover(&state.requests).active.is_empty());
    }

    #[tokio::test]
    async fn an_old_completion_cannot_unregister_a_replacement() {
        let state = AgentState::default();
        let (first_generation, first_registration) = begin_request(&state, "same").unwrap();
        let (second_generation, second_registration) = begin_request(&state, "same").unwrap();

        assert!(
            Abortable::new(std::future::pending::<()>(), first_registration)
                .await
                .is_err()
        );
        finish_request(&state, "same", first_generation);
        assert_eq!(
            lock_or_recover(&state.requests)
                .active
                .get("same")
                .map(|active| active.generation),
            Some(second_generation)
        );

        let _ = cancel_request(&state, "same");
        assert!(
            Abortable::new(std::future::pending::<()>(), second_registration)
                .await
                .is_err()
        );
    }

    #[test]
    fn unmatched_cancellations_are_bounded() {
        let state = AgentState::default();
        for index in 0..=MAX_EARLY_CANCELLATIONS {
            let _ = cancel_request(&state, &format!("pending-{index}"));
        }

        let registry = lock_or_recover(&state.requests);
        assert_eq!(registry.early_cancellations.len(), MAX_EARLY_CANCELLATIONS);
        assert!(!registry
            .early_cancellations
            .iter()
            .any(|request_id| request_id == "pending-0"));
    }

    #[test]
    fn stale_request_cleanup_cannot_remove_replacement_tools() {
        let state = AgentState::default();
        let key = tool_key("same", "call");
        let (sender, _receiver) = tokio::sync::oneshot::channel();
        lock_or_recover(&state.pending_tools).insert(
            key.clone(),
            PendingTool {
                generation: 2,
                sender,
            },
        );

        drop_pending_tools(&state, "same", Some(1));
        assert!(lock_or_recover(&state.pending_tools).contains_key(&key));

        drop_pending_tools(&state, "same", Some(2));
        assert!(!lock_or_recover(&state.pending_tools).contains_key(&key));
    }
}
