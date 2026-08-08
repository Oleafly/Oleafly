use std::collections::BTreeMap;

use crate::error::{AgentError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wire {
    OpenAiChat {
        base_url: String,
        reasoning_content: bool,
    },
    Anthropic {
        base_url: String,
    },
    Google {
        base_url: String,
    },
}

pub const OPENAI_BASE: &str = "https://api.openai.com/v1";
pub const ANTHROPIC_BASE: &str = "https://api.anthropic.com/v1";
pub const GOOGLE_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
pub const OLLAMA_DEFAULT_HOST: &str = "http://localhost:11434";

pub struct CatalogEntry {
    pub id: &'static str,
    pub base_url: Option<&'static str>,
    pub default_model: &'static str,
    pub is_host: bool,
}

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

fn catalog_rank(id: &str) -> usize {
    CATALOG
        .iter()
        .position(|p| p.id == id)
        .unwrap_or(CATALOG.len())
}

pub fn default_model(provider_id: &str) -> &str {
    catalog_entry(provider_id)
        .map(|p| p.default_model)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Default)]
pub struct CustomProvider {
    pub id: String,
    pub base_url: String,
    pub key_optional: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    pub legacy_key: String,
    pub keys: BTreeMap<String, String>,
    /// Provider ids explicitly present with an empty list have no enabled model.
    pub enabled_models: BTreeMap<String, Vec<String>>,
    pub custom: Vec<CustomProvider>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub provider_id: String,
    pub model_id: String,
    pub credential: String,
    pub auth: Option<String>,
    pub wire: Wire,
}

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
        .filter(|c| c.key_optional && catalog_entry(&c.id).is_none())
        .map(|c| c.id.as_str())
        .collect();

    let has_credential = |id: &str| {
        keys.get(id).map(|k| !k.trim().is_empty()).unwrap_or(false)
            || key_optional.contains(&id)
            || catalog_entry(id)
                .map(|entry| entry.is_host)
                .unwrap_or(false)
    };

    let provider_id = if has_credential(&saved) && saved_model(cfg, &saved).is_some() {
        saved.clone()
    } else {
        let mut candidates: Vec<&str> = keys
            .keys()
            .map(|k| k.as_str())
            .chain(key_optional.iter().copied())
            .filter(|id| has_credential(id) && enabled_model(cfg, id).is_some())
            .collect();
        candidates.sort_by_key(|id| (catalog_rank(id), *id));
        candidates.dedup();
        candidates
            .first()
            .map(|s| s.to_string())
            .unwrap_or_else(|| saved.clone())
    };

    let credential = keys.get(&provider_id).cloned().unwrap_or_default();
    let model_id = if provider_id == saved {
        saved_model(cfg, &saved).unwrap_or_default()
    } else {
        enabled_model(cfg, &provider_id).unwrap_or_default()
    };

    (provider_id, model_id, credential)
}

fn saved_model(cfg: &ProviderConfig, provider_id: &str) -> Option<String> {
    match cfg.enabled_models.get(provider_id) {
        None if !cfg.model.trim().is_empty() => Some(cfg.model.clone()),
        Some(models)
            if !cfg.model.trim().is_empty() && models.iter().any(|model| model == &cfg.model) =>
        {
            Some(cfg.model.clone())
        }
        _ => enabled_model(cfg, provider_id),
    }
}

fn enabled_model(cfg: &ProviderConfig, provider_id: &str) -> Option<String> {
    match cfg.enabled_models.get(provider_id) {
        Some(models) => {
            let catalog_default = default_model(provider_id);
            models
                .iter()
                .filter(|model| !model.trim().is_empty())
                .find(|model| !catalog_default.is_empty() && model.as_str() == catalog_default)
                .or_else(|| models.iter().find(|model| !model.trim().is_empty()))
                .cloned()
        }
        None => {
            let catalog_default = default_model(provider_id);
            (!catalog_default.is_empty()).then(|| catalog_default.to_string())
        }
    }
}

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

pub fn resolve(cfg: &ProviderConfig) -> Result<Resolved> {
    let (provider_id, model_id, credential) = pick_provider(cfg);
    build_resolved(cfg, provider_id, model_id, credential)
}

pub fn resolve_specific(
    cfg: &ProviderConfig,
    provider_id: &str,
    model_id: &str,
) -> Result<Resolved> {
    let credential = credential_for(cfg, provider_id);
    let model = if model_id.is_empty() {
        enabled_model(cfg, provider_id).unwrap_or_default()
    } else {
        if cfg
            .enabled_models
            .get(provider_id)
            .map(|models| !models.iter().any(|enabled| enabled == model_id))
            .unwrap_or(false)
        {
            return Err(AgentError::NotConfigured(format!(
                "Model {model_id} is not enabled for {provider_id}. Enable it in Settings under AI."
            )));
        }
        model_id.to_string()
    };
    build_resolved(cfg, provider_id.to_string(), model, credential)
}

/// Model listing needs provider credentials and an endpoint before a model can be selected.
pub fn resolve_for_model_listing(cfg: &ProviderConfig, provider_id: &str) -> Result<Resolved> {
    let placeholder = enabled_model(cfg, provider_id).unwrap_or_else(|| provider_id.to_string());
    build_resolved(
        cfg,
        provider_id.to_string(),
        placeholder,
        credential_for(cfg, provider_id),
    )
}

fn credential_for(cfg: &ProviderConfig, provider_id: &str) -> String {
    cfg.keys
        .get(provider_id)
        .cloned()
        .or_else(|| (cfg.provider == provider_id).then(|| cfg.legacy_key.clone()))
        .unwrap_or_default()
}

fn auth_for(is_host: bool, credential: &str) -> Option<String> {
    if is_host {
        return None;
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
    if model_id.trim().is_empty() {
        return Err(AgentError::NotConfigured(format!(
            "No enabled model is configured for {provider_id}. Enable one in Settings under AI."
        )));
    }
    let catalog = catalog_entry(&provider_id);
    let custom = catalog
        .is_none()
        .then(|| cfg.custom.iter().find(|c| c.id == provider_id))
        .flatten();
    if catalog.is_none() && custom.is_none() {
        return Err(AgentError::NotConfigured(format!(
            "Unknown AI provider {provider_id}. Add it as a custom provider before use."
        )));
    }
    let key_optional = custom.map(|c| c.key_optional).unwrap_or(false);
    let is_host = catalog.map(|provider| provider.is_host).unwrap_or(false);

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
    if matches!(wire, Wire::Google { .. }) && !valid_google_model_id(&model_id) {
        return Err(AgentError::NotConfigured(format!(
            "Invalid Google model id {model_id}. Choose a model listed by Google."
        )));
    }
    let auth = auth_for(is_host, &credential);
    Ok(Resolved {
        provider_id,
        model_id,
        credential,
        auth,
        wire,
    })
}

fn valid_google_model_id(model_id: &str) -> bool {
    !model_id.is_empty()
        && model_id.len() <= 256
        && model_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_custom_entry_cannot_repoint_a_catalog_provider() {
        let cfg = ProviderConfig {
            provider: "openai".into(),
            model: "gpt-4o".into(),
            keys: BTreeMap::from([("openai".to_string(), "sk-real".to_string())]),
            custom: vec![CustomProvider {
                id: "openai".into(),
                base_url: "http://attacker.example".into(),
                key_optional: false,
            }],
            ..Default::default()
        };
        let r = resolve(&cfg).unwrap();
        match r.wire {
            Wire::OpenAiChat { base_url, .. } => {
                assert!(
                    !base_url.contains("attacker"),
                    "catalog base was overridden: {base_url}"
                )
            }
            other => panic!("unexpected wire {other:?}"),
        }
    }

    #[test]
    fn a_custom_duplicate_cannot_make_catalog_auth_optional() {
        let cfg = ProviderConfig {
            provider: "openai".into(),
            model: "gpt-4o".into(),
            custom: vec![CustomProvider {
                id: "openai".into(),
                base_url: "http://attacker.example".into(),
                key_optional: true,
            }],
            ..Default::default()
        };

        assert!(matches!(resolve(&cfg), Err(AgentError::NotConfigured(_))));
    }

    #[test]
    fn google_model_ids_cannot_escape_the_models_path_segment() {
        let cfg = cfg_with(&[("google", "google-key")]);

        assert!(resolve_specific(&cfg, "google", "gemini-2.5-pro").is_ok());
        for model in ["../other", "gemini?key=attacker", "gemini#fragment", "a/b"] {
            assert!(
                resolve_specific(&cfg, "google", model).is_err(),
                "should reject {model}"
            );
        }
    }

    #[test]
    fn a_custom_provider_reaches_its_own_base_url() {
        let cfg = ProviderConfig {
            provider: "mycorp".into(),
            model: "m".into(),
            keys: BTreeMap::from([("mycorp".to_string(), "sk-real".to_string())]),
            custom: vec![CustomProvider {
                id: "mycorp".into(),
                base_url: "http://attacker.example".into(),
                key_optional: false,
            }],
            ..Default::default()
        };
        let r = resolve(&cfg).unwrap();
        match r.wire {
            Wire::OpenAiChat { base_url, .. } => assert!(base_url.contains("attacker")),
            other => panic!("unexpected wire {other:?}"),
        }
        assert_eq!(r.auth.as_deref(), Some("sk-real"));
    }

    #[test]
    fn an_unknown_provider_key_is_never_sent_to_the_openai_fallback() {
        let mut cfg = cfg_with(&[("unknown-provider", "provider-secret")]);
        cfg.provider = "unknown-provider".into();
        cfg.model = "unknown-model".into();
        cfg.enabled_models
            .insert("unknown-provider".into(), vec!["unknown-model".into()]);

        let error = resolve(&cfg).unwrap_err();
        assert!(
            matches!(error, AgentError::NotConfigured(message) if message.contains("Unknown AI provider"))
        );
        assert!(resolve_specific(&cfg, "unknown-provider", "unknown-model").is_err());
    }

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
    fn a_saved_host_provider_does_not_need_a_stored_host_value() {
        let mut cfg = cfg_with(&[("openai", "sk-cloud")]);
        cfg.provider = "ollama".into();

        let resolved = resolve(&cfg).unwrap();
        assert_eq!(resolved.provider_id, "ollama");
        assert_eq!(resolved.model_id, default_model("ollama"));
        assert_eq!(resolved.credential, "");
        assert!(matches!(
            resolved.wire,
            Wire::OpenAiChat { ref base_url, .. }
                if base_url == &format!("{OLLAMA_DEFAULT_HOST}/v1")
        ));
    }

    #[test]
    fn falls_back_in_catalog_order_when_the_saved_provider_has_no_key() {
        let mut cfg = cfg_with(&[("zai", "z"), ("anthropic", "a")]);
        cfg.provider = "google".into();
        let (id, _, _) = pick_provider(&cfg);
        assert_eq!(id, "anthropic");
    }

    #[test]
    fn fallback_uses_the_enabled_catalog_default_or_first_model() {
        let mut cfg = cfg_with(&[("anthropic", "a")]);
        cfg.provider = "google".into();
        cfg.enabled_models.insert(
            "anthropic".into(),
            vec!["claude-small".into(), default_model("anthropic").into()],
        );
        assert_eq!(pick_provider(&cfg).1, default_model("anthropic"));

        cfg.enabled_models
            .insert("anthropic".into(), vec!["claude-small".into()]);
        assert_eq!(pick_provider(&cfg).1, "claude-small");
    }

    #[test]
    fn fallback_custom_provider_uses_its_first_enabled_model() {
        let mut cfg = cfg_with(&[("corp", "secret")]);
        cfg.provider = "openai".into();
        cfg.custom.push(CustomProvider {
            id: "corp".into(),
            base_url: "https://models.example/v1".into(),
            key_optional: false,
        });
        cfg.enabled_models
            .insert("corp".into(), vec!["corp-reasoner".into()]);

        let resolved = resolve(&cfg).unwrap();
        assert_eq!(resolved.provider_id, "corp");
        assert_eq!(resolved.model_id, "corp-reasoner");
    }

    #[test]
    fn explicitly_empty_models_are_not_eligible_for_fallback() {
        let mut cfg = cfg_with(&[("anthropic", "a"), ("groq", "g")]);
        cfg.provider = "google".into();
        cfg.enabled_models.insert("anthropic".into(), vec![]);
        cfg.enabled_models
            .insert("groq".into(), vec!["llama-enabled".into()]);

        let resolved = resolve(&cfg).unwrap();
        assert_eq!(resolved.provider_id, "groq");
        assert_eq!(resolved.model_id, "llama-enabled");

        cfg.keys.remove("groq");
        assert!(matches!(resolve(&cfg), Err(AgentError::NotConfigured(_))));

        let mut active = cfg_with(&[("anthropic", "a")]);
        active.provider = "anthropic".into();
        active.model = "stale-disabled-model".into();
        active.enabled_models.insert("anthropic".into(), vec![]);
        let error = resolve(&active).unwrap_err();
        assert!(
            matches!(error, AgentError::NotConfigured(message) if message.contains("No enabled model"))
        );
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
        cfg.model = "local-model".into();
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

        // Legacy configurations without a projected catalog retain their saved model.
        assert_eq!(pick_provider(&cfg).1, "gpt-4.1-mini");

        cfg.enabled_models.insert(
            "openai".into(),
            vec!["gpt-enabled".into(), "gpt-4.1-mini".into()],
        );
        assert_eq!(pick_provider(&cfg).1, "gpt-4.1-mini");

        cfg.enabled_models
            .insert("openai".into(), vec!["gpt-enabled".into()]);
        assert_eq!(pick_provider(&cfg).1, "gpt-enabled");

        cfg.enabled_models.remove("openai");
        cfg.provider = "anthropic".into();
        assert_eq!(pick_provider(&cfg).1, "gpt-4o");
    }

    #[test]
    fn a_saved_provider_with_no_enabled_model_falls_back_to_an_eligible_provider() {
        let mut cfg = cfg_with(&[("openai", "sk-a"), ("groq", "g")]);
        cfg.provider = "openai".into();
        cfg.model = "stale-disabled-model".into();
        cfg.enabled_models.insert("openai".into(), vec![]);
        cfg.enabled_models
            .insert("groq".into(), vec!["llama-enabled".into()]);

        let resolved = resolve(&cfg).unwrap();
        assert_eq!(resolved.provider_id, "groq");
        assert_eq!(resolved.model_id, "llama-enabled");
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
    fn an_override_without_an_enabled_model_is_refused() {
        let mut cfg = cfg_with(&[("mistral", "m")]);
        cfg.enabled_models.insert("mistral".into(), vec![]);

        assert!(matches!(
            resolve_specific(&cfg, "mistral", ""),
            Err(AgentError::NotConfigured(message)) if message.contains("No enabled model")
        ));
        assert!(matches!(
            resolve_specific(&cfg, "mistral", "disabled-model"),
            Err(AgentError::NotConfigured(message)) if message.contains("not enabled")
        ));
    }

    #[test]
    fn model_listing_can_resolve_a_provider_before_a_model_is_enabled() {
        let mut cfg = cfg_with(&[("corp", "secret")]);
        cfg.custom.push(CustomProvider {
            id: "corp".into(),
            base_url: "https://models.example/v1".into(),
            key_optional: false,
        });
        cfg.enabled_models.insert("corp".into(), vec![]);

        let resolved = resolve_for_model_listing(&cfg, "corp").unwrap();
        assert_eq!(resolved.provider_id, "corp");
        assert_eq!(resolved.model_id, "corp");
        assert_eq!(resolved.auth.as_deref(), Some("secret"));
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
        assert_eq!(resolved.auth, None);
        assert!(crate::wire::auth_headers(&resolved).is_empty());
    }

    #[test]
    fn a_key_optional_custom_provider_sends_no_credential_at_all() {
        let mut cfg = cfg_with(&[]);
        cfg.provider = "local-vllm".into();
        cfg.model = "local-model".into();
        cfg.custom = vec![CustomProvider {
            id: "local-vllm".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            key_optional: true,
        }];
        assert_eq!(resolve(&cfg).unwrap().auth, None);
    }

    #[test]
    fn a_custom_provider_with_a_key_authenticates_with_it() {
        let mut cfg = cfg_with(&[("my-gateway", "  sk-gateway  ")]);
        cfg.provider = "my-gateway".into();
        cfg.model = "gateway-model".into();
        cfg.custom = vec![CustomProvider {
            id: "my-gateway".into(),
            base_url: "https://gateway.example.com/v1/".into(),
            key_optional: false,
        }];
        let resolved = resolve(&cfg).unwrap();

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
