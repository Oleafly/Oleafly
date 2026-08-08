use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use oleafly_agent::{
    AgentEvent, CompletionRequest, CompletionResponse, ProviderConfig, RunConfig, ToolOutput,
};
use tauri::State;

use crate::config::AppConfig;

fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Default)]
pub struct AgentState {
    client: Mutex<Option<reqwest::Client>>,
    running: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    pending_tools: Mutex<HashMap<String, tokio::sync::oneshot::Sender<ToolOutput>>>,
}

impl AgentState {
    fn client(&self) -> reqwest::Client {
        let mut slot = lock_or_recover(&self.client);
        slot.get_or_insert_with(oleafly_agent::build_client).clone()
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
    let resolved = resolve_off_thread(provider_override).await?;
    let client = state.client();

    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = tauri::async_runtime::spawn(async move {
        let result = oleafly_agent::complete(&client, &resolved, &request).await;
        let _ = tx.send(result);
    });

    register(&state, &request_id, handle);
    let outcome = rx.await;
    unregister(&state, &request_id);

    match outcome {
        Ok(result) => result.map_err(tagged),
        Err(_) => Err(tagged(oleafly_agent::AgentError::Cancelled)),
    }
}

#[tauri::command]
pub fn agent_cancel_all(state: State<'_, AgentState>) {
    for (_, handle) in lock_or_recover(&state.running).drain() {
        handle.abort();
    }
    lock_or_recover(&state.pending_tools).clear();
}

#[tauri::command]
pub fn agent_cancel(state: State<'_, AgentState>, request_id: String) {
    if let Some(handle) = lock_or_recover(&state.running).remove(&request_id) {
        handle.abort();
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
    let resolved = resolve_off_thread(provider_override).await?;
    let client = state.client();

    let (tx, rx) = tokio::sync::oneshot::channel();
    let sink = on_event.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let outcome = oleafly_agent::stream_completion(&client, &resolved, &request, |event| {
            let _ = sink.send(event);
        })
        .await;
        let _ = tx.send(outcome.map(|_| ()));
    });

    register(&state, &request_id, handle);
    let outcome = rx.await;
    unregister(&state, &request_id);

    match outcome {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(tagged(error)),
        Err(_) => Err(tagged(oleafly_agent::AgentError::Cancelled)),
    }
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
    let resolved = resolve_off_thread(provider_override).await?;
    let client = state.client();
    let config = config.unwrap_or_default();

    let sink = on_event.clone();
    let run_tool = webview_tool_runner(app.clone(), request_id.clone(), on_event.clone());

    let (tx, rx) = tokio::sync::oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        let outcome = oleafly_agent::run_agent(
            &client,
            &resolved,
            request,
            &config,
            run_tool,
            move |event| {
                let _ = sink.send(event);
            },
        )
        .await;
        let _ = tx.send(outcome);
    });

    register(&state, &request_id, task);
    let outcome = rx.await;
    unregister(&state, &request_id);
    drop_pending_tools(&state, &request_id);

    match outcome {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) => Err(tagged(error)),
        Err(_) => Err(tagged(oleafly_agent::AgentError::Cancelled)),
    }
}

fn webview_tool_runner(
    app: tauri::AppHandle,
    request_id: String,
    tool_sink: tauri::ipc::Channel<AgentEvent>,
) -> oleafly_agent::ToolRunner {
    std::sync::Arc::new(move |call| {
        let tool_sink = tool_sink.clone();
        let handle = app.clone();
        let run_id = request_id.clone();
        Box::pin(async move {
            let key = tool_key(&run_id, &call.id);
            let (tx, rx) = tokio::sync::oneshot::channel();
            {
                use tauri::Manager;
                let state = handle.state::<AgentState>();
                lock_or_recover(&state.pending_tools).insert(key.clone(), tx);
            }
            let _ = tool_sink.send(AgentEvent::ToolRequest {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            });
            match rx.await {
                Ok(output) => output,
                Err(_) => ToolOutput::text("{\"error\":\"the tool was not executed\"}"),
            }
        })
    })
}

#[tauri::command]
pub fn agent_tool_result(
    state: State<'_, AgentState>,
    request_id: String,
    call_id: String,
    output: ToolOutput,
) {
    let key = tool_key(&request_id, &call_id);
    if let Some(sender) = lock_or_recover(&state.pending_tools).remove(&key) {
        let _ = sender.send(output);
    }
}

fn tool_key(request_id: &str, call_id: &str) -> String {
    format!("{request_id}\u{1f}{call_id}")
}

fn drop_pending_tools(state: &State<'_, AgentState>, request_id: &str) {
    let prefix = format!("{request_id}\u{1f}");
    lock_or_recover(&state.pending_tools).retain(|key, _| !key.starts_with(&prefix));
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

    let resolved = oleafly_agent::provider::resolve_specific(&projected, &provider_id, "")
        .map_err(|e| e.to_string())?;
    oleafly_agent::list_models(&state.client(), &resolved)
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

fn register(
    state: &State<'_, AgentState>,
    request_id: &str,
    handle: tauri::async_runtime::JoinHandle<()>,
) {
    if let Some(previous) = lock_or_recover(&state.running).insert(request_id.to_string(), handle) {
        previous.abort();
    }
}

fn unregister(state: &State<'_, AgentState>, request_id: &str) {
    lock_or_recover(&state.running).remove(request_id);
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
}
