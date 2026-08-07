use std::collections::BTreeMap;

use crate::error::{AgentError, Result};

/// How a provider's HTTP API is shaped.
///
/// Eleven providers ship in the catalog, but they speak three wire formats.
/// Everything with a `base_url` in the catalog is OpenAI-compatible, which is
/// why adding a provider is usually a catalog entry and no new code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wire {
    /// `POST {base}/chat/completions`, bearer auth.
    OpenAiChat {
        base_url: String,
        /// Whether the provider streams its thinking phase as
        /// `reasoning_content`. Inert for one-shot completions; the streaming
        /// path in [`crate::stream`] depends on it.
        reasoning_content: bool,
    },
    /// `POST {base}/messages`, `x-api-key` auth.
    Anthropic { base_url: String },
    /// `POST {base}/models/{model}:generateContent`, key as a query parameter.
    Google { base_url: String },
}

pub const OPENAI_BASE: &str = "https://api.openai.com/v1";
pub const ANTHROPIC_BASE: &str = "https://api.anthropic.com/v1";
pub const GOOGLE_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
pub const OLLAMA_DEFAULT_HOST: &str = "http://localhost:11434";

/// A catalog provider: its id, its OpenAI-compatible base (when it has one),
/// and the model chosen when the user has not picked one.
pub struct CatalogEntry {
    pub id: &'static str,
    pub base_url: Option<&'static str>,
    pub default_model: &'static str,
    /// Credential is a host URL rather than an API key (Ollama).
    pub is_host: bool,
}

/// Mirrors `PROVIDERS` in `packages/ai-core/src/providers.ts`, in the same
/// order, which decides the fallback below.
///
/// Only what a completion needs lives here: routing and the default model. The
/// full model catalog with display names still drives Settings from the
/// TypeScript side, and folds into this crate when that path is retired.
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "openai",
        base_url: None,
        default_model: "gpt-4o",
        is_host: false,
    },
    CatalogEntry {
        id: "anthropic",
        base_url: None,
        default_model: "claude-sonnet-4-20250514",
        is_host: false,
    },
    CatalogEntry {
        id: "google",
        base_url: None,
        default_model: "gemini-2.5-pro",
        is_host: false,
    },
    CatalogEntry {
        id: "zai",
        base_url: Some("https://api.z.ai/api/coding/paas/v4"),
        default_model: "glm-5.2",
        is_host: false,
    },
    CatalogEntry {
        id: "groq",
        base_url: Some("https://api.groq.com/openai/v1"),
        default_model: "llama-3.3-70b-versatile",
        is_host: false,
    },
    CatalogEntry {
        id: "openrouter",
        base_url: Some("https://openrouter.ai/api/v1"),
        default_model: "openai/gpt-4o-mini",
        is_host: false,
    },
    CatalogEntry {
        id: "deepseek",
        base_url: Some("https://api.deepseek.com"),
        default_model: "deepseek-chat",
        is_host: false,
    },
    CatalogEntry {
        id: "mistral",
        base_url: Some("https://api.mistral.ai/v1"),
        default_model: "mistral-large-latest",
        is_host: false,
    },
    CatalogEntry {
        id: "xai",
        base_url: Some("https://api.x.ai/v1"),
        default_model: "grok-2",
        is_host: false,
    },
    CatalogEntry {
        id: "perplexity",
        base_url: Some("https://api.perplexity.ai"),
        default_model: "sonar",
        is_host: false,
    },
    CatalogEntry {
        id: "ollama",
        base_url: None,
        default_model: "llama3.2",
        is_host: true,
    },
];

pub fn catalog_entry(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|p| p.id == id)
}

/// Position in [`CATALOG`], used to break ties deterministically.
fn catalog_rank(id: &str) -> usize {
    CATALOG
        .iter()
        .position(|p| p.id == id)
        .unwrap_or(CATALOG.len())
}

pub fn default_model(provider_id: &str) -> &str {
    catalog_entry(provider_id)
        .map(|p| p.default_model)
        .unwrap_or("gpt-4o-mini")
}

#[derive(Debug, Clone, Default)]
pub struct CustomProvider {
    pub id: String,
    pub base_url: String,
    pub key_optional: bool,
}

/// The AI slice of the app config, decoupled from the Tauri `AppConfig` so the
/// crate stays usable from a plain binary.
#[derive(Debug, Clone, Default)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    /// Legacy single key, applied to the saved provider when it has no entry
    /// in `keys`.
    pub legacy_key: String,
    pub keys: BTreeMap<String, String>,
    pub custom: Vec<CustomProvider>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub provider_id: String,
    pub model_id: String,
    pub credential: String,
    /// What to send as the request credential, when anything should be sent.
    ///
    /// Not the same as `credential`: Ollama stores a host URL there, and a
    /// custom provider marked key_optional stores nothing at all. Sending
    /// either as a bearer token is wrong, and an empty one makes a malformed
    /// header that some servers reject outright.
    pub auth: Option<String>,
    pub wire: Wire,
}

/// Pick the provider a request should go to.
///
/// Mirrors `pickActiveProvider` in `providers.ts`: the saved provider wins when
/// it has a credential, otherwise the first configured one stands in, and a
/// custom provider marked `key_optional` counts as configured without any
/// credential at all.
pub fn pick_provider(cfg: &ProviderConfig) -> (String, String, String) {
    let saved = if cfg.provider.is_empty() {
        "openai".to_string()
    } else {
        cfg.provider.clone()
    };

    let mut keys = cfg.keys.clone();
    if !cfg.legacy_key.is_empty() && !keys.contains_key(&saved) {
        keys.insert(saved.clone(), cfg.legacy_key.clone());
    }

    let key_optional: Vec<&str> = cfg
        .custom
        .iter()
        .filter(|c| c.key_optional)
        .map(|c| c.id.as_str())
        .collect();

    let has_credential = |id: &str| {
        keys.get(id).map(|k| !k.trim().is_empty()).unwrap_or(false) || key_optional.contains(&id)
    };

    let provider_id = if has_credential(&saved) {
        saved.clone()
    } else {
        // The TypeScript version falls back to whichever key appears first in
        // config.json, which depends on the order the file happened to be
        // written in. Catalog order is the same choice made reproducibly.
        let mut candidates: Vec<&str> = keys
            .keys()
            .map(|k| k.as_str())
            .chain(key_optional.iter().copied())
            .filter(|id| has_credential(id))
            .collect();
        candidates.sort_by_key(|id| (catalog_rank(id), *id));
        candidates.dedup();
        candidates
            .first()
            .map(|s| s.to_string())
            .unwrap_or_else(|| saved.clone())
    };

    let credential = keys.get(&provider_id).cloned().unwrap_or_default();
    let model_id = if provider_id == saved && !cfg.model.is_empty() {
        cfg.model.clone()
    } else {
        default_model(&provider_id).to_string()
    };

    (provider_id, model_id, credential)
}

/// Choose the wire format and endpoint for a provider.
///
/// Mirrors `buildModel` in `providers.ts`, including the reason z.ai and
/// DeepSeek take the compatible path: both stream their thinking phase as
/// `reasoning_content`, which the strict OpenAI shape drops.
pub fn wire_for(provider_id: &str, credential: &str, custom_base: Option<&str>) -> Wire {
    match provider_id {
        "anthropic" => Wire::Anthropic {
            base_url: ANTHROPIC_BASE.to_string(),
        },
        "google" => Wire::Google {
            base_url: GOOGLE_BASE.to_string(),
        },
        "ollama" => {
            let host = if credential.trim().is_empty() {
                OLLAMA_DEFAULT_HOST
            } else {
                credential.trim()
            };
            Wire::OpenAiChat {
                base_url: format!("{}/v1", host.trim_end_matches('/')),
                reasoning_content: false,
            }
        }
        "zai" | "deepseek" => Wire::OpenAiChat {
            base_url: catalog_entry(provider_id)
                .and_then(|p| p.base_url)
                .unwrap_or_default()
                .to_string(),
            reasoning_content: true,
        },
        other => match catalog_entry(other) {
            Some(entry) => Wire::OpenAiChat {
                base_url: entry.base_url.unwrap_or(OPENAI_BASE).to_string(),
                reasoning_content: false,
            },
            // Not in the catalog, so it is a user-defined provider. Nearly
            // every self-hosted or third-party base is OpenAI-compatible.
            None => Wire::OpenAiChat {
                base_url: custom_base
                    .unwrap_or(OPENAI_BASE)
                    .trim_end_matches('/')
                    .to_string(),
                reasoning_content: true,
            },
        },
    }
}

/// Resolve the active provider all the way to a callable endpoint.
pub fn resolve(cfg: &ProviderConfig) -> Result<Resolved> {
    let (provider_id, model_id, credential) = pick_provider(cfg);
    build_resolved(cfg, provider_id, model_id, credential)
}

/// Resolve a caller-named provider and model instead of the active one.
///
/// Template generation lets the user try one specific model without changing
/// what the rest of the app uses. The credential still comes from the stored
/// config, so naming a provider never means passing a key in.
pub fn resolve_specific(
    cfg: &ProviderConfig,
    provider_id: &str,
    model_id: &str,
) -> Result<Resolved> {
    let credential = cfg
        .keys
        .get(provider_id)
        .cloned()
        // The legacy single key only ever belonged to the saved provider.
        .or_else(|| (cfg.provider == provider_id).then(|| cfg.legacy_key.clone()))
        .unwrap_or_default();
    let model = if model_id.is_empty() {
        default_model(provider_id).to_string()
    } else {
        model_id.to_string()
    };
    build_resolved(cfg, provider_id.to_string(), model, credential)
}

fn auth_for(provider_id: &str, is_host: bool, credential: &str) -> Option<String> {
    if is_host {
        // A local runtime authenticates nothing, but OpenAI-compatible clients
        // still send a token, so keep the placeholder the app has always used.
        return Some(provider_id.to_string());
    }
    let trimmed = credential.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn build_resolved(
    cfg: &ProviderConfig,
    provider_id: String,
    model_id: String,
    credential: String,
) -> Result<Resolved> {
    let custom = cfg.custom.iter().find(|c| c.id == provider_id);
    let key_optional = custom.map(|c| c.key_optional).unwrap_or(false);
    let is_host = catalog_entry(&provider_id)
        .map(|p| p.is_host)
        .unwrap_or(false);

    if credential.trim().is_empty() && !key_optional && !is_host {
        return Err(AgentError::NotConfigured(format!(
            "No API key is set for {provider_id}. Add one in Settings under AI."
        )));
    }

    let wire = wire_for(
        &provider_id,
        &credential,
        custom.map(|c| c.base_url.as_str()),
    );
    let auth = auth_for(&provider_id, is_host, &credential);
    Ok(Resolved {
        provider_id,
        model_id,
        credential,
        auth,
        wire,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with(keys: &[(&str, &str)]) -> ProviderConfig {
        ProviderConfig {
            keys: keys
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn saved_provider_wins_when_it_has_a_key() {
        let mut cfg = cfg_with(&[("openai", "sk-a"), ("anthropic", "sk-b")]);
        cfg.provider = "anthropic".into();
        let (id, _, cred) = pick_provider(&cfg);
        assert_eq!(id, "anthropic");
        assert_eq!(cred, "sk-b");
    }

    #[test]
    fn falls_back_in_catalog_order_when_the_saved_provider_has_no_key() {
        let mut cfg = cfg_with(&[("zai", "z"), ("anthropic", "a")]);
        cfg.provider = "google".into();
        let (id, _, _) = pick_provider(&cfg);
        // anthropic is second in the catalog, zai fourth.
        assert_eq!(id, "anthropic");
    }

    #[test]
    fn blank_and_whitespace_keys_do_not_count_as_configured() {
        let mut cfg = cfg_with(&[("openai", "   "), ("groq", "g")]);
        cfg.provider = "openai".into();
        let (id, _, _) = pick_provider(&cfg);
        assert_eq!(id, "groq");
    }

    #[test]
    fn legacy_key_backfills_only_the_saved_provider() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "mistral".into();
        cfg.legacy_key = "sk-legacy".into();
        let (id, _, cred) = pick_provider(&cfg);
        assert_eq!(id, "mistral");
        assert_eq!(cred, "sk-legacy");
    }

    #[test]
    fn an_explicit_key_beats_the_legacy_one() {
        let mut cfg = cfg_with(&[("mistral", "sk-new")]);
        cfg.provider = "mistral".into();
        cfg.legacy_key = "sk-legacy".into();
        let (_, _, cred) = pick_provider(&cfg);
        assert_eq!(cred, "sk-new");
    }

    #[test]
    fn key_optional_custom_provider_is_configured_without_a_credential() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "local-vllm".into();
        cfg.custom = vec![CustomProvider {
            id: "local-vllm".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            key_optional: true,
        }];
        let resolved = resolve(&cfg).unwrap();
        assert_eq!(resolved.provider_id, "local-vllm");
        assert!(matches!(
            resolved.wire,
            Wire::OpenAiChat { ref base_url, .. } if base_url == "http://127.0.0.1:8000/v1"
        ));
    }

    #[test]
    fn the_saved_model_survives_only_when_the_saved_provider_is_used() {
        let mut cfg = cfg_with(&[("openai", "sk-a")]);
        cfg.provider = "openai".into();
        cfg.model = "gpt-4.1-mini".into();
        assert_eq!(pick_provider(&cfg).1, "gpt-4.1-mini");

        // Saved provider unusable: its model must not leak to the fallback.
        cfg.provider = "anthropic".into();
        assert_eq!(pick_provider(&cfg).1, "gpt-4o");
    }

    #[test]
    fn an_override_uses_its_own_provider_and_the_stored_key() {
        let mut cfg = cfg_with(&[("openai", "sk-a"), ("groq", "gsk-1")]);
        cfg.provider = "openai".into();
        cfg.model = "gpt-4o".into();

        let resolved = resolve_specific(&cfg, "groq", "llama-3.1-8b-instant").unwrap();
        assert_eq!(resolved.provider_id, "groq");
        assert_eq!(resolved.model_id, "llama-3.1-8b-instant");
        assert_eq!(resolved.credential, "gsk-1");
        // The active provider's model must not leak into the override.
        assert_ne!(resolved.model_id, cfg.model);
    }

    #[test]
    fn an_override_without_a_model_falls_back_to_the_catalog_default() {
        let cfg = cfg_with(&[("mistral", "m")]);
        assert_eq!(
            resolve_specific(&cfg, "mistral", "").unwrap().model_id,
            "mistral-large-latest"
        );
    }

    #[test]
    fn an_override_for_an_unconfigured_provider_is_refused() {
        let cfg = cfg_with(&[("openai", "sk-a")]);
        assert!(matches!(
            resolve_specific(&cfg, "anthropic", "claude-3-5-haiku-20241022"),
            Err(AgentError::NotConfigured(_))
        ));
    }

    #[test]
    fn the_legacy_key_reaches_an_override_only_for_the_saved_provider() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "xai".into();
        cfg.legacy_key = "sk-legacy".into();
        assert_eq!(
            resolve_specific(&cfg, "xai", "grok-2").unwrap().credential,
            "sk-legacy"
        );
        assert!(resolve_specific(&cfg, "groq", "llama-3.3-70b-versatile").is_err());
    }

    #[test]
    fn the_ollama_host_is_never_sent_as_a_bearer_token() {
        let mut cfg = cfg_with(&[("ollama", "http://box:11434")]);
        cfg.provider = "ollama".into();
        let resolved = resolve(&cfg).unwrap();

        assert_eq!(resolved.credential, "http://box:11434");
        assert_eq!(resolved.auth.as_deref(), Some("ollama"));
    }

    #[test]
    fn a_key_optional_custom_provider_sends_no_credential_at_all() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "local-vllm".into();
        cfg.custom = vec![CustomProvider {
            id: "local-vllm".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            key_optional: true,
        }];
        // An empty bearer token is a malformed header, and some servers reject
        // the request outright rather than treating it as unauthenticated.
        assert_eq!(resolve(&cfg).unwrap().auth, None);
    }

    #[test]
    fn a_custom_provider_with_a_key_authenticates_with_it() {
        let mut cfg = cfg_with(&[("my-gateway", "  sk-gateway  ")]);
        cfg.provider = "my-gateway".into();
        cfg.custom = vec![CustomProvider {
            id: "my-gateway".into(),
            base_url: "https://gateway.example.com/v1/".into(),
            key_optional: false,
        }];
        let resolved = resolve(&cfg).unwrap();

        // Surrounding whitespace comes from pasting a key into Settings.
        assert_eq!(resolved.auth.as_deref(), Some("sk-gateway"));
        assert_eq!(
            resolved.wire,
            Wire::OpenAiChat {
                base_url: "https://gateway.example.com/v1".into(),
                reasoning_content: true
            }
        );
    }

    #[test]
    fn openrouter_uses_its_own_base_and_the_stored_key() {
        let mut cfg = cfg_with(&[("openrouter", "sk-or-1")]);
        cfg.provider = "openrouter".into();
        cfg.model = "anthropic/claude-3.5-sonnet".into();
        let resolved = resolve(&cfg).unwrap();

        assert_eq!(resolved.auth.as_deref(), Some("sk-or-1"));
        assert_eq!(resolved.model_id, "anthropic/claude-3.5-sonnet");
        assert_eq!(
            resolved.wire,
            Wire::OpenAiChat {
                base_url: "https://openrouter.ai/api/v1".into(),
                reasoning_content: false
            }
        );
    }

    #[test]
    fn the_zai_coding_plan_keeps_its_coding_endpoint_and_thinking_phase() {
        let mut cfg = cfg_with(&[("zai", "sk-zai-1")]);
        cfg.provider = "zai".into();
        cfg.model = "glm-5.2".into();
        let resolved = resolve(&cfg).unwrap();

        assert_eq!(resolved.auth.as_deref(), Some("sk-zai-1"));
        assert_eq!(resolved.model_id, "glm-5.2");
        // The general /api/paas/v4 endpoint bills separately from the plan.
        assert_eq!(
            resolved.wire,
            Wire::OpenAiChat {
                base_url: "https://api.z.ai/api/coding/paas/v4".into(),
                reasoning_content: true
            }
        );
    }

    #[test]
    fn resolve_refuses_a_provider_with_no_credential() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "openai".into();
        let err = resolve(&cfg).unwrap_err();
        assert!(matches!(err, AgentError::NotConfigured(_)));
        assert!(!err.retryable());
    }

    #[test]
    fn ollama_needs_no_key_and_gets_a_v1_suffix() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "ollama".into();
        let resolved = resolve(&cfg).unwrap();
        assert_eq!(
            resolved.wire,
            Wire::OpenAiChat {
                base_url: "http://localhost:11434/v1".into(),
                reasoning_content: false
            }
        );
    }

    #[test]
    fn ollama_host_override_is_normalized() {
        // Trailing slashes came from users pasting the host out of a browser.
        for host in [
            "http://box:11434",
            "http://box:11434/",
            "http://box:11434///",
        ] {
            assert_eq!(
                wire_for("ollama", host, None),
                Wire::OpenAiChat {
                    base_url: "http://box:11434/v1".into(),
                    reasoning_content: false
                }
            );
        }
    }

    #[test]
    fn reasoning_providers_take_the_compatible_path() {
        for id in ["zai", "deepseek"] {
            match wire_for(id, "k", None) {
                Wire::OpenAiChat {
                    reasoning_content, ..
                } => assert!(reasoning_content, "{id} must keep reasoning_content"),
                other => panic!("{id} routed to {other:?}"),
            }
        }
    }

    #[test]
    fn catalog_bases_match_the_typescript_registry() {
        assert_eq!(
            wire_for("groq", "k", None),
            Wire::OpenAiChat {
                base_url: "https://api.groq.com/openai/v1".into(),
                reasoning_content: false
            }
        );
        assert_eq!(
            wire_for("openai", "k", None),
            Wire::OpenAiChat {
                base_url: OPENAI_BASE.into(),
                reasoning_content: false
            }
        );
        assert!(matches!(
            wire_for("anthropic", "k", None),
            Wire::Anthropic { .. }
        ));
        assert!(matches!(wire_for("google", "k", None), Wire::Google { .. }));
    }
}
