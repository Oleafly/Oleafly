//! Tauri surface for `oleafly-agent`.
//!
//! The point of this module is what it does *not* do: the provider credential
//! is read from the config here, in the backend, and never travels to the
//! webview. Callers name a request and get text back.

use std::collections::HashMap;
use std::sync::Mutex;

use oleafly_agent::{CompletionRequest, CompletionResponse, ProviderConfig};
use tauri::State;

use crate::config::AppConfig;

#[derive(Default)]
pub struct AgentState {
    client: Mutex<Option<reqwest::Client>>,
    /// In-flight completions, so `agent_cancel` can drop one mid-request.
    running: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

impl AgentState {
    /// One pooled client for the process. Built lazily so app startup does not
    /// pay for TLS setup that a user without an AI key never needs.
    fn client(&self) -> reqwest::Client {
        let mut slot = self.client.lock().unwrap();
        slot.get_or_insert_with(oleafly_agent::build_client).clone()
    }
}

/// Project the AI slice of the app config onto the crate's own shape.
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

/// Which implementation the frontend should use for AI calls.
///
/// The Rust path is the default on this branch. `OLEAFLY_AGENT=ts` restores
/// the previous in-webview path so the two can be compared on one build.
#[tauri::command]
pub fn agent_backend() -> String {
    backend_from(std::env::var("OLEAFLY_AGENT").ok().as_deref())
}

fn backend_from(value: Option<&str>) -> String {
    match value {
        Some("ts") => "ts".to_string(),
        _ => "rust".to_string(),
    }
}

/// Naming a provider and model for one call without changing the active one.
/// Only ids travel; the credential is still looked up in the backend.
#[derive(serde::Deserialize)]
pub struct ProviderOverride {
    pub provider_id: String,
    #[serde(default)]
    pub model_id: String,
}

/// Run one completion against the user's active provider.
#[tauri::command]
pub async fn agent_complete(
    state: State<'_, AgentState>,
    request_id: String,
    request: CompletionRequest,
    provider_override: Option<ProviderOverride>,
) -> Result<CompletionResponse, String> {
    let cfg = crate::config::read_config()?;
    let projected = provider_config(&cfg);
    let resolved = match provider_override {
        Some(o) => {
            oleafly_agent::provider::resolve_specific(&projected, &o.provider_id, &o.model_id)
        }
        None => oleafly_agent::resolve(&projected),
    }
    .map_err(|e| e.to_string())?;
    let client = state.client();

    // The work runs in its own task so that cancelling means dropping the
    // request rather than waiting for a reply nobody wants any more.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = tauri::async_runtime::spawn(async move {
        let result = oleafly_agent::complete(&client, &resolved, &request).await;
        let _ = tx.send(result);
    });

    {
        let mut running = state.running.lock().unwrap();
        // A repeated id means the caller reused it; the older request loses.
        if let Some(previous) = running.insert(request_id.clone(), handle) {
            previous.abort();
        }
    }

    let outcome = rx.await;
    state.running.lock().unwrap().remove(&request_id);

    match outcome {
        Ok(result) => result.map_err(|e| e.to_string()),
        // The sender was dropped without sending, which only happens when the
        // task was aborted by `agent_cancel`.
        Err(_) => Err(oleafly_agent::AgentError::Cancelled.to_string()),
    }
}

/// Abandon an in-flight completion. Unknown ids are not an error: the request
/// may have finished between the user's click and this call.
#[tauri::command]
pub fn agent_cancel(state: State<'_, AgentState>, request_id: String) {
    if let Some(handle) = state.running.lock().unwrap().remove(&request_id) {
        handle.abort();
    }
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

    #[test]
    fn the_backend_flag_defaults_to_rust_and_only_ts_opts_out() {
        // Driven through the pure helper: cargo test runs in parallel, so
        // mutating the process environment here would race other tests.
        assert_eq!(backend_from(None), "rust");
        assert_eq!(backend_from(Some("ts")), "ts");
        assert_eq!(backend_from(Some("rust")), "rust");
        assert_eq!(backend_from(Some("nonsense")), "rust");
    }
}
