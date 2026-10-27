//! "Let agents use my Oleafly API keys" (Experimental): an agent that
//! supports `providers/*` is routed through a key the user keeps in
//! Oleafly. The key goes only into the `providers/set` headers, is added to
//! the session's redactor first and is cleared from memory afterwards.
use serde::Serialize;
use std::collections::BTreeMap;
use zeroize::Zeroizing;

use oleafly_acp::providers::{parse_list, ProviderRoute, PROVIDERS_LIST, PROVIDERS_SET};
use oleafly_acp::redact::Redactor;
use oleafly_acp::AcpClient;

use super::failures;
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Route {
    pub api_type: &'static str,
    pub base_url: String,
    pub bearer: bool,
}

impl Route {
    fn new(api_type: &'static str, base_url: impl Into<String>) -> Self {
        Self {
            api_type,
            base_url: base_url.into(),
            bearer: api_type != "anthropic",
        }
    }

    fn gateway(base_url: &str) -> Self {
        Self {
            bearer: true,
            ..Self::new("anthropic", base_url)
        }
    }

    fn header(&self, key: &str) -> (String, String) {
        if self.bearer {
            ("Authorization".to_string(), format!("Bearer {key}"))
        } else {
            ("x-api-key".to_string(), key.to_string())
        }
    }
}

const ANTHROPIC_GATEWAYS: [(&str, &str); 2] = [
    ("deepseek", "https://api.deepseek.com/anthropic"),
    ("zai", "https://api.z.ai/api/anthropic"),
];

/// Where Oleafly's key for `provider` can send requests, in order: each
/// route's agent protocol (`anthropic` or `openai`) and base URL, then the
/// key. Providers without a key, Google and local models are not routed.
pub(super) fn oleafly_routes(
    provider: &str,
    config: &AppConfig,
) -> Option<(Vec<Route>, Zeroizing<String>)> {
    let key = config
        .ai_keys
        .get(provider)
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())?;
    let key = Zeroizing::new(key.to_owned());
    let mut routes = match provider {
        "anthropic" => vec![Route::new("anthropic", "https://api.anthropic.com")],
        "openai" => vec![Route::new("openai", oleafly_agent::provider::OPENAI_BASE)],
        "google" | "ollama" => Vec::new(),
        _ => match oleafly_agent::provider::CATALOG
            .iter()
            .find(|entry| entry.id == provider && !entry.is_host)
        {
            Some(entry) => entry
                .base_url
                .map(|url| Route::new("openai", url))
                .into_iter()
                .collect(),
            None => config
                .ai_custom_providers
                .iter()
                .find(|custom| custom.id == provider)
                .map(|custom| custom.base_url.trim().to_string())
                .filter(|url| url.starts_with("https://"))
                .map(|url| Route::new("openai", url))
                .into_iter()
                .collect(),
        },
    };
    routes.extend(
        ANTHROPIC_GATEWAYS
            .iter()
            .filter(|(id, _)| *id == provider)
            .map(|(_, url)| Route::gateway(url)),
    );
    (!routes.is_empty()).then_some((routes, key))
}

pub(super) fn agent_routes(
    agent_id: &str,
    provider: &str,
    config: &AppConfig,
) -> Option<(Vec<Route>, Zeroizing<String>)> {
    if agent_id == "codex" && provider != "openai" {
        return None;
    }
    oleafly_routes(provider, config)
}

pub(super) fn provider_label(provider: &str) -> String {
    let config = crate::config::read_config().unwrap_or_default();
    label(provider, &config)
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
/// through, given the protocols it supports (all, when not known yet), each
/// with the first of its routes the agent accepts; Codex only the OpenAI
/// key. Never returns keys.
pub(super) fn provider_choices(
    agent_id: &str,
    supported: &[String],
    config: &AppConfig,
) -> Vec<ProviderChoice> {
    let mut ids: Vec<&String> = config.ai_keys.keys().collect();
    ids.sort();
    ids.into_iter()
        .filter_map(|id| {
            let (routes, _) = agent_routes(agent_id, id, config)?;
            let route = routes.into_iter().find(|route| {
                supported.is_empty() || supported.iter().any(|kind| kind == route.api_type)
            })?;
            Some(ProviderChoice {
                id: id.clone(),
                label: label(id, config),
                api_type: route.api_type.into(),
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
/// one that accepts one of its routes, in the order the agent lists its
/// protocols. Runs before `session/new`.
pub(super) async fn route_agent(
    client: &AcpClient,
    redactor: &Redactor,
    agent_id: &str,
    agent_prefs: &AgentPreferences,
    config: &AppConfig,
) -> Result<Routed, String> {
    let listed = client
        .request(PROVIDERS_LIST, serde_json::json!({}), REQUEST_TIMEOUT)
        .await
        .map_err(|error| failures::redacted(redactor, &failures::rpc_message(&error)))?;
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
    if agent_id == "codex" && provider != "openai" {
        return Err(failures::coded(failures::CODEX_OPENAI_ONLY));
    }
    let (routes, key) = agent_routes(agent_id, provider, config)
        .ok_or_else(|| failures::coded(failures::NO_SAVED_KEY))?;
    let (target, chosen) = providers
        .iter()
        .find_map(|agent| {
            agent.supported.iter().find_map(|kind| {
                routes
                    .iter()
                    .find(|route| route.api_type == kind)
                    .map(|route| (agent.provider_id.clone(), route.clone()))
            })
        })
        .ok_or_else(|| failures::coded(failures::KEY_KIND_UNSUPPORTED))?;
    redactor.add_secret(&key);
    let route = ProviderRoute {
        provider_id: target.clone(),
        api_type: chosen.api_type.into(),
        headers: BTreeMap::from([chosen.header(&key)]),
        base_url: chosen.base_url,
    };
    let result = client
        .request(PROVIDERS_SET, route.params(), REQUEST_TIMEOUT)
        .await;
    drop(route);
    result.map_err(|error| failures::redacted(redactor, &failures::rpc_message(&error)))?;
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

    fn kinds(routes: &[Route]) -> Vec<(&'static str, &str)> {
        routes
            .iter()
            .map(|route| (route.api_type, route.base_url.as_str()))
            .collect()
    }

    #[test]
    fn routes_put_the_key_only_in_headers() {
        let config = config(&[
            ("anthropic", "sk-ant-123456789"),
            ("openai", "sk-oa-123456789"),
        ]);
        let (routes, key) = oleafly_routes("anthropic", &config).unwrap();
        assert_eq!(kinds(&routes), [("anthropic", "https://api.anthropic.com")]);
        assert_eq!(key.as_str(), "sk-ant-123456789");
        assert_eq!(
            routes[0].header(&key),
            ("x-api-key".to_string(), "sk-ant-123456789".to_string())
        );
        let (routes, key) = oleafly_routes("openai", &config).unwrap();
        assert_eq!(kinds(&routes)[0].0, "openai");
        assert!(!routes[0].base_url.contains("sk-"));
        assert_eq!(
            routes[0].header(&key),
            (
                "Authorization".to_string(),
                "Bearer sk-oa-123456789".to_string()
            )
        );
        assert!(oleafly_routes("google", &config).is_none());
        assert!(oleafly_routes("groq", &config).is_none());
    }

    #[test]
    fn deepseek_and_zai_keys_also_reach_anthropic_agents_through_their_gateways() {
        let config = config(&[("deepseek", "sk-ds-123456789"), ("zai", "zai-123456789")]);
        let (routes, key) = oleafly_routes("deepseek", &config).unwrap();
        assert_eq!(
            kinds(&routes),
            [
                ("openai", "https://api.deepseek.com"),
                ("anthropic", "https://api.deepseek.com/anthropic")
            ]
        );
        assert_eq!(
            routes[1].header(&key),
            (
                "Authorization".to_string(),
                "Bearer sk-ds-123456789".to_string()
            ),
            "DeepSeek documents ANTHROPIC_AUTH_TOKEN for Claude Code"
        );
        let (routes, _) = oleafly_routes("zai", &config).unwrap();
        assert_eq!(
            kinds(&routes),
            [
                ("openai", "https://api.z.ai/api/coding/paas/v4"),
                ("anthropic", "https://api.z.ai/api/anthropic")
            ]
        );
    }

    #[test]
    fn claude_code_is_offered_deepseek_as_an_anthropic_provider() {
        let config = config(&[
            ("deepseek", "sk-ds-123456789"),
            ("groq", "gsk-123456789"),
            ("openrouter", "sk-or-123456789"),
        ]);
        let claude: Vec<String> = ["anthropic", "bedrock", "vertex"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(
            provider_choices("claude", &claude, &config),
            [ProviderChoice {
                id: "deepseek".into(),
                label: "DeepSeek".into(),
                api_type: "anthropic".into(),
            }]
        );
        let openai = provider_choices("fixture-agent", &["openai".into()], &config);
        assert_eq!(openai.len(), 3);
        assert!(openai.iter().all(|choice| choice.api_type == "openai"));
        let unknown = provider_choices("fixture-agent", &[], &config);
        assert_eq!(
            unknown
                .iter()
                .find(|choice| choice.id == "deepseek")
                .map(|choice| choice.api_type.as_str()),
            Some("openai")
        );
    }

    #[tokio::test]
    async fn routing_deepseek_for_an_anthropic_agent_sets_the_anthropic_gateway() {
        let temp = crate::acp::tests::fixture_temp();
        let definition =
            crate::acp::tests::fixture_definition(vec!["--record-requests".into()], temp.path());
        let command = definition.distribution.command.unwrap();
        let project = temp.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let mut spawn = tokio::process::Command::new(&command.executable);
        spawn.args(&command.args).current_dir(&project);
        let client = AcpClient::spawn(spawn, std::sync::Arc::new(oleafly_acp::NullHost))
            .await
            .unwrap();
        client
            .initialize(&super::super::runtime::client_options(false, false))
            .await
            .unwrap();
        let redactor = Redactor::new(&[]);
        let prefs = AgentPreferences {
            provider: Some("deepseek".into()),
            ..Default::default()
        };
        let routed = route_agent(
            &client,
            &redactor,
            "fixture-agent",
            &prefs,
            &config(&[("deepseek", "fixture-deepseek-key")]),
        )
        .await
        .unwrap();
        client.shutdown().await;
        assert_eq!(routed.provider.as_deref(), Some("deepseek"));
        assert_eq!(routed.agent_provider.as_deref(), Some("main"));
        let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
        let set = requests
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|line| line["method"] == PROVIDERS_SET)
            .unwrap();
        assert_eq!(
            set["params"],
            serde_json::json!({
                "providerId": "main",
                "apiType": "anthropic",
                "baseUrl": "https://api.deepseek.com/anthropic",
                "headers": {"Authorization": "Bearer fixture-deepseek-key"},
            })
        );
        assert!(!redactor
            .text("refused fixture-deepseek-key")
            .contains("fixture-deepseek-key"));
    }

    #[test]
    fn choices_follow_the_agent_protocols_and_never_carry_keys() {
        let config = config(&[("anthropic", "sk-ant-123456789"), ("groq", "gsk-123456789")]);
        let all = provider_choices("fixture-agent", &[], &config);
        assert_eq!(all.len(), 2);
        let anthropic_only = provider_choices("fixture-agent", &["anthropic".into()], &config);
        assert_eq!(anthropic_only.len(), 1);
        assert!(!serde_json::to_string(&all).unwrap().contains("sk-ant"));
    }

    #[test]
    fn codex_is_offered_only_the_openai_key() {
        let config = config(&[
            ("openai", "sk-oa-123456789"),
            ("deepseek", "sk-ds-123456789"),
            ("groq", "gsk-123456789"),
            ("zai", "zai-123456789"),
        ]);
        let openai: Vec<String> = vec!["openai".into()];
        assert_eq!(
            provider_choices("codex", &openai, &config),
            [ProviderChoice {
                id: "openai".into(),
                label: "OpenAI".into(),
                api_type: "openai".into(),
            }]
        );
        assert_eq!(provider_choices("codex", &[], &config).len(), 1);
        assert_eq!(provider_choices("opencode", &openai, &config).len(), 4);
        let (routes, _) = agent_routes("codex", "openai", &config).unwrap();
        assert_eq!(
            kinds(&routes),
            [("openai", oleafly_agent::provider::OPENAI_BASE)]
        );
        assert!(agent_routes("codex", "deepseek", &config).is_none());
        assert!(agent_routes("opencode", "deepseek", &config).is_some());
    }

    #[tokio::test]
    async fn codex_is_never_routed_through_a_chat_completions_key() {
        let temp = crate::acp::tests::fixture_temp();
        let definition =
            crate::acp::tests::fixture_definition(vec!["--record-requests".into()], temp.path());
        let command = definition.distribution.command.unwrap();
        let project = temp.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let mut spawn = tokio::process::Command::new(&command.executable);
        spawn.args(&command.args).current_dir(&project);
        let client = AcpClient::spawn(spawn, std::sync::Arc::new(oleafly_acp::NullHost))
            .await
            .unwrap();
        client
            .initialize(&super::super::runtime::client_options(false, false))
            .await
            .unwrap();
        let prefs = AgentPreferences {
            provider: Some("deepseek".into()),
            ..Default::default()
        };
        let error = route_agent(
            &client,
            &Redactor::new(&[]),
            "codex",
            &prefs,
            &config(&[("deepseek", "fixture-deepseek-key")]),
        )
        .await
        .err()
        .unwrap();
        client.shutdown().await;
        assert_eq!(
            crate::app_error::english(&error).as_deref(),
            Some("Codex can only use an OpenAI key.")
        );
        let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
        assert!(!requests.contains(PROVIDERS_SET));
    }
}
