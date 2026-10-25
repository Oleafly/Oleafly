//! Web search and fetch run by the provider itself, where the provider and
//! model offer them. Everywhere else the run uses the local web tools.
use serde_json::{json, Value};

use crate::complete::WebTools;
use crate::provider::Wire;
use crate::wire::reasoning::claude_version;

/// The hosted web tools a request uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NativeWeb {
    pub search: bool,
    pub fetch: bool,
}

pub(crate) struct AnthropicWebVersions {
    pub search: &'static str,
    pub fetch: &'static str,
}

const DYNAMIC: AnthropicWebVersions = AnthropicWebVersions {
    search: "web_search_20260209",
    fetch: "web_fetch_20260209",
};

const BASIC: AnthropicWebVersions = AnthropicWebVersions {
    search: "web_search_20250305",
    fetch: "web_fetch_20250910",
};

/// The web tool versions a Claude model takes: dynamic filtering on newer
/// models, the basic tools on older ones, none on the oldest.
pub(crate) fn anthropic_web_versions(model_id: &str) -> Option<AnthropicWebVersions> {
    let id = model_id.to_ascii_lowercase();
    if id.contains("claude-fable-") || id.contains("claude-mythos-") {
        return Some(DYNAMIC);
    }
    match claude_version(&id) {
        Some((family, major, minor)) => match (family.as_str(), major) {
            ("opus" | "sonnet", 5..) => Some(DYNAMIC),
            ("opus" | "sonnet", 4) if minor >= 6 => Some(DYNAMIC),
            ("haiku", 5..) => Some(BASIC),
            ("haiku", 4) if minor == 5 => Some(BASIC),
            ("sonnet", 4) if minor == 5 || minor == 0 => Some(BASIC),
            ("opus", 4) if minor <= 5 => Some(BASIC),
            _ => None,
        },
        None if id.contains("claude-3-7-sonnet") || id.contains("claude-3-5-haiku") => Some(BASIC),
        None => None,
    }
}

/// Whether the Responses API runs web search for the model. The families
/// support it, except `gpt-4.1-nano` and `o3-mini`, which answer a request
/// that names the tool with a 400.
fn responses_web_model(model_id: &str) -> bool {
    let id = model_id.to_ascii_lowercase();
    if id.starts_with("gpt-4.1-nano") || id.starts_with("o3-mini") {
        return false;
    }
    ["gpt-4o", "gpt-4.1", "gpt-5", "gpt-6", "gpt-7", "o3", "o4"]
        .iter()
        .any(|prefix| id.starts_with(prefix))
}

/// Which of the requested web tools the provider runs itself.
pub fn native_web(
    provider_id: &str,
    wire: &Wire,
    model_id: &str,
    web: Option<WebTools>,
) -> NativeWeb {
    let Some(web) = web else {
        return NativeWeb::default();
    };
    match wire {
        Wire::Anthropic { .. }
            if provider_id == "anthropic" && anthropic_web_versions(model_id).is_some() =>
        {
            NativeWeb {
                search: web.search,
                fetch: web.fetch,
            }
        }
        Wire::OpenAiResponses { .. }
            if provider_id == "openai" && responses_web_model(model_id) =>
        {
            NativeWeb {
                search: web.search,
                fetch: false,
            }
        }
        _ => NativeWeb::default(),
    }
}

/// Anthropic server tool definitions for the hosted web tools in use.
pub(crate) fn anthropic_server_tools(model_id: &str, native: NativeWeb) -> Vec<Value> {
    let Some(versions) = anthropic_web_versions(model_id) else {
        return Vec::new();
    };
    let mut tools = Vec::new();
    if native.search {
        tools.push(json!({ "type": versions.search, "name": "web_search", "max_uses": 8 }));
    }
    if native.fetch {
        tools.push(json!({
            "type": versions.fetch,
            "name": "web_fetch",
            "max_uses": 8,
            "max_content_tokens": 50_000,
            "citations": { "enabled": true },
        }));
    }
    tools
}

/// The Responses hosted web search tool, when in use.
pub(crate) fn responses_web_tool(native: NativeWeb) -> Option<Value> {
    native.search.then(|| json!({ "type": "web_search" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_web_versions_follow_the_model_family() {
        assert_eq!(
            anthropic_web_versions("claude-opus-5-5").unwrap().search,
            "web_search_20260209"
        );
        assert_eq!(
            anthropic_web_versions("claude-sonnet-4-6").unwrap().fetch,
            "web_fetch_20260209"
        );
        assert_eq!(
            anthropic_web_versions("claude-haiku-5-5").unwrap().fetch,
            "web_fetch_20250910"
        );
        assert_eq!(
            anthropic_web_versions("claude-opus-4-1-20250805")
                .unwrap()
                .search,
            "web_search_20250305"
        );
        assert!(anthropic_web_versions("claude-3-7-sonnet-latest").is_some());
        assert!(anthropic_web_versions("claude-3-haiku-20240307").is_none());
    }

    #[test]
    fn models_without_hosted_web_search_use_the_local_tools() {
        for model in [
            "gpt-4.1-nano",
            "gpt-4.1-nano-2025-04-14",
            "o3-mini",
            "O3-mini-high",
        ] {
            assert!(!responses_web_model(model), "{model}");
        }
        for model in [
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "o3",
            "o3-pro",
            "o4-mini",
            "gpt-5",
            "gpt-6.1-sol",
        ] {
            assert!(responses_web_model(model), "{model}");
        }
        let responses = Wire::OpenAiResponses {
            base_url: "https://api.openai.com/v1".into(),
        };
        let on = Some(WebTools {
            search: true,
            fetch: true,
        });
        assert_eq!(
            native_web("openai", &responses, "gpt-4.1-nano", on),
            NativeWeb::default()
        );
    }

    #[test]
    fn only_the_providers_own_endpoints_run_hosted_tools() {
        let on = Some(WebTools {
            search: true,
            fetch: true,
        });
        let anthropic = Wire::Anthropic {
            base_url: "https://api.anthropic.com/v1".into(),
        };
        assert_eq!(
            native_web("anthropic", &anthropic, "claude-opus-5-5", on),
            NativeWeb {
                search: true,
                fetch: true
            }
        );
        assert_eq!(
            native_web("my-proxy", &anthropic, "claude-opus-5-5", on),
            NativeWeb::default()
        );
        let responses = Wire::OpenAiResponses {
            base_url: "https://api.openai.com/v1".into(),
        };
        assert_eq!(
            native_web("openai", &responses, "gpt-6.1-sol", on),
            NativeWeb {
                search: true,
                fetch: false
            }
        );
        assert_eq!(
            native_web("openai", &responses, "gpt-6.1-sol", None),
            NativeWeb::default()
        );
    }
}
