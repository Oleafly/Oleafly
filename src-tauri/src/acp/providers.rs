//! "Let agents use my Oleafly API keys" (Experimental): an agent that
//! supports `providers/*` is routed through a key the user keeps in
//! Oleafly. The key goes only into the `providers/set` headers, is added to
//! the session's redactor first and is cleared from memory afterwards.
use serde::Serialize;
use std::collections::BTreeMap;
use zeroize::Zeroizing;

use oleafly_acp::providers::{
    parse_list, provider_for, ProviderRoute, PROVIDERS_LIST, PROVIDERS_SET,
};
use oleafly_acp::redact::Redactor;
use oleafly_acp::AcpClient;

use super::preferences::AgentPreferences;
use crate::config::AppConfig;

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChoice {
    pub id: String,
    pub label: String,
    pub api_type: String,
}

/// Where Oleafly's key for `provider` sends requests: the agent protocol
/// (`anthropic` or `openai`), the base URL and the key. Providers without a
/// key, Google and local models are not routed.
pub(super) fn oleafly_route(
    provider: &str,
    config: &AppConfig,
) -> Option<(&'static str, String, Zeroizing<String>)> {
    let key = config
        .ai_keys
        .get(provider)
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())?;
    let key = Zeroizing::new(key.to_owned());
    match provider {
        "anthropic" => Some(("anthropic", "https://api.anthropic.com".into(), key)),
        "openai" => Some(("openai", oleafly_agent::provider::OPENAI_BASE.into(), key)),
        "google" | "ollama" => None,
        _ => {
            if let Some(entry) = oleafly_agent::provider::CATALOG
                .iter()
                .find(|entry| entry.id == provider && !entry.is_host)
            {
                return entry.base_url.map(|url| ("openai", url.to_string(), key));
            }
            config
                .ai_custom_providers
                .iter()
                .find(|custom| custom.id == provider)
                .map(|custom| custom.base_url.trim().to_string())
                .filter(|url| url.starts_with("https://"))
                .map(|url| ("openai", url, key))
        }
    }
}

fn label(provider: &str, config: &AppConfig) -> String {
    match provider {
        "anthropic" => "Anthropic".into(),
        "openai" => "OpenAI".into(),
        "openrouter" => "OpenRouter".into(),
        "zai" => "Z.ai".into(),
        "groq" => "Groq".into(),
        "deepseek" => "DeepSeek".into(),
        "mistral" => "Mistral".into(),
        "xai" => "xAI".into(),
        "perplexity" => "Perplexity".into(),
        other => config
            .ai_custom_providers
            .iter()
            .find(|custom| custom.id == other)
            .map(|custom| custom.name.clone())
            .unwrap_or_else(|| other.to_string()),
    }
}

/// The Oleafly providers (with a saved key) an agent could be routed
/// through, given the protocols it supports (all, when not known yet).
/// Never returns keys.
pub(super) fn provider_choices(supported: &[String], config: &AppConfig) -> Vec<ProviderChoice> {
    let mut ids: Vec<&String> = config.ai_keys.keys().collect();
    ids.sort();
    ids.into_iter()
        .filter_map(|id| {
            let (api_type, _, _) = oleafly_route(id, config)?;
            if !supported.is_empty() && !supported.iter().any(|kind| kind == api_type) {
                return None;
            }
            Some(ProviderChoice {
                id: id.clone(),
                label: label(id, config),
                api_type: api_type.into(),
            })
        })
        .collect()
}

/// What routing settled on: the Oleafly provider and the agent provider it
/// was set on, and the protocols the agent supports.
#[derive(Default)]
pub(super) struct Routed {
    pub provider: Option<String>,
    pub agent_provider: Option<String>,
    pub supported: Vec<String>,
}

/// Lists the agent's providers and sets the chosen Oleafly key on the first
/// one that accepts its protocol. Runs before `session/new`.
pub(super) async fn route_agent(
    client: &AcpClient,
    redactor: &Redactor,
    agent_prefs: &AgentPreferences,
    config: &AppConfig,
) -> Result<Routed, String> {
    let listed = client
        .request(PROVIDERS_LIST, serde_json::json!({}), REQUEST_TIMEOUT)
        .await
        .map_err(|error| redactor.text(&error.to_string()))?;
    let providers = parse_list(&listed);
    let mut supported: Vec<String> = providers
        .iter()
        .flat_map(|provider| provider.supported.iter().cloned())
        .collect();
    supported.sort();
    supported.dedup();
    let Some(provider) = agent_prefs.provider.as_deref() else {
        return Ok(Routed {
            supported,
            ..Default::default()
        });
    };
    let (api_type, base_url, key) =
        oleafly_route(provider, config).ok_or("There is no saved key for this provider.")?;
    let target = provider_for(&providers, api_type)
        .ok_or("This agent cannot use this kind of key.")?
        .provider_id
        .clone();
    redactor.add_secret(&key);
    let header = if api_type == "anthropic" {
        ("x-api-key".to_string(), key.to_string())
    } else {
        (
            "Authorization".to_string(),
            format!("Bearer {}", key.as_str()),
        )
    };
    let route = ProviderRoute {
        provider_id: target.clone(),
        api_type: api_type.into(),
        base_url,
        headers: BTreeMap::from([header]),
    };
    let result = client
        .request(PROVIDERS_SET, route.params(), REQUEST_TIMEOUT)
        .await;
    drop(route);
    result.map_err(|error| redactor.text(&error.to_string()))?;
    Ok(Routed {
        provider: Some(provider.to_owned()),
        agent_provider: Some(target),
        supported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(keys: &[(&str, &str)]) -> AppConfig {
        let mut config = AppConfig::default();
        for (id, key) in keys {
            config.ai_keys.insert((*id).into(), (*key).into());
        }
        config
    }

    #[test]
    fn routes_put_the_key_only_in_headers() {
        let config = config(&[
            ("anthropic", "sk-ant-123456789"),
            ("openai", "sk-oa-123456789"),
        ]);
        let (kind, url, key) = oleafly_route("anthropic", &config).unwrap();
        assert_eq!(
            (kind, url.as_str()),
            ("anthropic", "https://api.anthropic.com")
        );
        assert_eq!(key.as_str(), "sk-ant-123456789");
        let (kind, url, _) = oleafly_route("openai", &config).unwrap();
        assert_eq!(kind, "openai");
        assert!(!url.contains("sk-"));
        assert!(oleafly_route("google", &config).is_none());
        assert!(oleafly_route("groq", &config).is_none());
    }

    #[test]
    fn choices_follow_the_agent_protocols_and_never_carry_keys() {
        let config = config(&[("anthropic", "sk-ant-123456789"), ("groq", "gsk-123456789")]);
        let all = provider_choices(&[], &config);
        assert_eq!(all.len(), 2);
        let anthropic_only = provider_choices(&["anthropic".into()], &config);
        assert_eq!(anthropic_only.len(), 1);
        assert!(!serde_json::to_string(&all).unwrap().contains("sk-ant"));
    }
}
