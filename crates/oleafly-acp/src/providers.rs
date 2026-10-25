//! `providers/*` (unstable): routing an agent's model traffic through an
//! API key the user keeps in Oleafly. Keys travel only in request headers
//! and are never printed.
use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Value};

pub const PROVIDERS_LIST: &str = "providers/list";
pub const PROVIDERS_SET: &str = "providers/set";
pub const PROVIDERS_DISABLE: &str = "providers/disable";

/// Where an agent provider sends its requests, with the credential headers.
#[derive(Clone, PartialEq, Eq)]
pub struct ProviderRoute {
    pub provider_id: String,
    /// `anthropic`, `openai`, …
    pub api_type: String,
    pub base_url: String,
    pub headers: BTreeMap<String, String>,
}

impl std::fmt::Debug for ProviderRoute {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let headers: BTreeMap<&str, &str> = self
            .headers
            .keys()
            .map(|name| (name.as_str(), "[credential omitted]"))
            .collect();
        f.debug_struct("ProviderRoute")
            .field("provider_id", &self.provider_id)
            .field("api_type", &self.api_type)
            .field("base_url", &self.base_url)
            .field("headers", &headers)
            .finish()
    }
}

impl ProviderRoute {
    /// The `providers/set` params.
    pub fn params(&self) -> Value {
        json!({
            "providerId": self.provider_id,
            "apiType": self.api_type,
            "baseUrl": self.base_url,
            "headers": self.headers,
        })
    }

    /// Clears the header values (the keys) from memory.
    pub fn clear(&mut self) {
        use zeroize::Zeroize;
        for value in self.headers.values_mut() {
            value.zeroize();
        }
    }
}

impl Drop for ProviderRoute {
    fn drop(&mut self) {
        self.clear();
    }
}

/// One provider an agent can route, as `providers/list` reports it.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProvider {
    pub provider_id: String,
    pub supported: Vec<String>,
    pub required: bool,
    pub current_api_type: Option<String>,
    pub current_base_url: Option<String>,
}

fn word(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 64)
        .filter(|text| {
            text.chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-.:".contains(c))
        })
        .map(str::to_owned)
}

/// The providers in a `providers/list` answer (at most 16; invalid entries
/// are skipped).
pub fn parse_list(response: &Value) -> Vec<AgentProvider> {
    response["providers"]
        .as_array()
        .map(|providers| {
            providers
                .iter()
                .filter_map(|provider| {
                    Some(AgentProvider {
                        provider_id: word(&provider["providerId"])?,
                        supported: provider["supported"]
                            .as_array()
                            .map(|kinds| kinds.iter().filter_map(word).take(16).collect())
                            .unwrap_or_default(),
                        required: provider["required"].as_bool().unwrap_or(false),
                        current_api_type: word(&provider["current"]["apiType"]),
                        current_base_url: provider["current"]["baseUrl"]
                            .as_str()
                            .filter(|url| url.len() <= 2048)
                            .map(str::to_owned),
                    })
                })
                .take(16)
                .collect()
        })
        .unwrap_or_default()
}

/// The first agent provider that accepts `api_type`.
pub fn provider_for<'a>(
    providers: &'a [AgentProvider],
    api_type: &str,
) -> Option<&'a AgentProvider> {
    providers
        .iter()
        .find(|provider| provider.supported.iter().any(|kind| kind == api_type))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route() -> ProviderRoute {
        ProviderRoute {
            provider_id: "main".into(),
            api_type: "anthropic".into(),
            base_url: "https://api.anthropic.com".into(),
            headers: BTreeMap::from([(
                "x-api-key".to_string(),
                "sk-ant-secret-123456".to_string(),
            )]),
        }
    }

    #[test]
    fn route_debug_never_prints_the_key() {
        let text = format!("{:?}", route());
        assert!(!text.contains("sk-ant-secret-123456"));
        assert!(text.contains("x-api-key"));
    }

    #[test]
    fn route_params_carry_the_key_only_in_headers() {
        let params = route().params();
        assert_eq!(params["headers"]["x-api-key"], "sk-ant-secret-123456");
        assert_eq!(params["apiType"], "anthropic");
        assert!(!params["baseUrl"].as_str().unwrap().contains("sk-"));
    }

    #[test]
    fn provider_lists_parse_and_skip_invalid_entries() {
        let providers = parse_list(&json!({"providers": [
            {"providerId": "main", "supported": ["anthropic", "openai"], "required": true,
             "current": {"apiType": "anthropic", "baseUrl": "https://api.anthropic.com"}},
            {"providerId": "bad id with spaces", "supported": []},
            {"supported": ["openai"]},
        ]}));
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].current_api_type.as_deref(), Some("anthropic"));
        assert_eq!(
            provider_for(&providers, "openai").unwrap().provider_id,
            "main"
        );
        assert!(provider_for(&providers, "bedrock").is_none());
    }
}
