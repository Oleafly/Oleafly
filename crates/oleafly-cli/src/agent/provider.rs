use std::path::Path;

use oleafly_agent::provider::{
    catalog_entry, default_model, legacy_key_applies, resolve_for_probe, resolve_specific, CATALOG,
};
use oleafly_agent::{Effort, InputTokenSemantics, ModelCaps, Usage};
use serde_json::Value;

use super::desktop_config::{model_entry, DesktopConfig};
use super::EffortArg;
use crate::contract::{CliError, ErrorKind};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProviderChoice {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub effort: Option<Effort>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CredentialSource {
    Store,
    Env(&'static str),
    NotNeeded,
}

impl CredentialSource {
    pub fn label(self) -> String {
        match self {
            Self::Store => "store".into(),
            Self::Env(name) => format!("env:{name}"),
            Self::NotNeeded => "none".into(),
        }
    }
}

pub struct ResolvedProvider {
    pub resolved: oleafly_agent::Resolved,
    pub source: CredentialSource,
    pub price: Option<Price>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    pub cache_read_per_mtok: Option<f64>,
    pub cache_write_per_mtok: Option<f64>,
    pub peak_hours: bool,
}

impl Price {
    pub fn from_entry(entry: &Value) -> Option<Price> {
        let cost = entry.get("cost")?;
        let rate = |name: &str| {
            cost.get(name)
                .and_then(Value::as_f64)
                .filter(|rate| rate.is_finite() && *rate >= 0.0)
        };
        Some(Price {
            input_per_mtok: rate("input")?,
            output_per_mtok: rate("output")?,
            cache_read_per_mtok: rate("cacheRead"),
            cache_write_per_mtok: rate("cacheWrite"),
            peak_hours: false,
        })
    }

    pub fn for_provider(self, provider_id: &str) -> Price {
        Price {
            peak_hours: oleafly_agent::pricing::has_peak_hours(provider_id),
            ..self
        }
    }

    pub fn cost(&self, usage: &Usage) -> f64 {
        self.cost_at(usage, oleafly_agent::pricing::now_unix_ms())
    }

    pub fn cost_at(&self, usage: &Usage, unix_ms: i64) -> f64 {
        let input = f64::from(usage.input);
        let output = f64::from(usage.output);
        let cache_read = f64::from(usage.cache_read.unwrap_or(0));
        let cache_write = f64::from(usage.cache_write.unwrap_or(0));
        let fresh = match usage.input_semantics {
            InputTokenSemantics::Exclusive => input,
            _ => (input - cache_read - cache_write).max(0.0),
        };
        let total = fresh * self.input_per_mtok
            + output * self.output_per_mtok
            + cache_read * self.cache_read_per_mtok.unwrap_or(self.input_per_mtok)
            + cache_write * self.cache_write_per_mtok.unwrap_or(self.input_per_mtok);
        let multiplier = if self.peak_hours {
            oleafly_agent::pricing::peak_hours_multiplier(unix_ms)
        } else {
            1.0
        };
        total / 1_000_000.0 * multiplier
    }
}

#[derive(Debug)]
pub enum ResolveError {
    NoProvider {
        hint: String,
    },
    MissingKey {
        provider: String,
        env_names: &'static [&'static str],
    },
    Unknown(String),
}

impl From<ResolveError> for CliError {
    fn from(error: ResolveError) -> Self {
        match error {
            ResolveError::NoProvider { hint } => CliError::new(
                ErrorKind::MissingTool,
                "agent.no_provider",
                "No AI provider is set up.",
            )
            .hint(hint),
            ResolveError::MissingKey {
                provider,
                env_names,
            } => {
                let variables = if env_names.is_empty() {
                    "OLEAFLY_API_KEY".to_string()
                } else {
                    env_names.join(" or ")
                };
                CliError::new(
                    ErrorKind::Auth,
                    "agent.missing_key",
                    format!("There is no API key for {provider}."),
                )
                .hint(format!(
                    "Add one in Oleafly's settings, or set {variables}."
                ))
            }
            ResolveError::Unknown(message) => {
                CliError::new(ErrorKind::InvalidInput, "agent.unknown_provider", message)
            }
        }
    }
}

pub fn env_key_names(provider_id: &str) -> &'static [&'static str] {
    match provider_id {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" => &["ANTHROPIC_API_KEY"],
        "google" => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "openrouter" => &["OPENROUTER_API_KEY"],
        "groq" => &["GROQ_API_KEY"],
        "deepseek" => &["DEEPSEEK_API_KEY"],
        "mistral" => &["MISTRAL_API_KEY"],
        "xai" => &["XAI_API_KEY"],
        "perplexity" => &["PERPLEXITY_API_KEY"],
        "zai" => &["ZAI_API_KEY"],
        "ollama" => &["OLLAMA_HOST"],
        _ => &[],
    }
}

/// Every variable that may hold a provider key (children never see them).
/// Ollama's host is an address, not a key, so `OLLAMA_HOST` stays out: a
/// command that talks to a remote Ollama needs it, and it isn't a secret.
pub fn all_key_variables() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = CATALOG
        .iter()
        .filter(|entry| !entry.is_host)
        .flat_map(|entry| env_key_names(entry.id).iter().copied())
        .collect();
    names.push("OLEAFLY_API_KEY");
    names.sort_unstable();
    names.dedup();
    names
}

pub fn effort_from_arg(arg: EffortArg) -> Option<Effort> {
    match arg {
        EffortArg::Auto => None,
        EffortArg::None => Some(Effort::Off),
        EffortArg::Minimal => Some(Effort::Minimal),
        EffortArg::Low => Some(Effort::Low),
        EffortArg::Medium => Some(Effort::Medium),
        EffortArg::High => Some(Effort::High),
        EffortArg::Xhigh => Some(Effort::Xhigh),
        EffortArg::Max => Some(Effort::Max),
    }
}

const NO_PROVIDER_HINT: &str =
    "Pick a model in Oleafly's settings, or pass --provider and --model.";

fn configured(config: &DesktopConfig) -> bool {
    !config.ai.provider.trim().is_empty()
        || config.ai.keys.values().any(|key| !key.trim().is_empty())
        || !config.ai.legacy_key.trim().is_empty()
        || config.ai.custom.iter().any(|custom| custom.key_optional)
}

pub fn resolve(
    root: &Path,
    config: &DesktopConfig,
    choice: &ProviderChoice,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
) -> Result<ResolvedProvider, ResolveError> {
    let env_value = |name: &str| {
        env(name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let mut warnings = Vec::new();
    let flag = |value: &Option<String>| {
        value
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let explicit_provider = flag(&choice.provider).or_else(|| env_value("OLEAFLY_PROVIDER"));
    let explicit_model = flag(&choice.model).or_else(|| env_value("OLEAFLY_MODEL"));
    let mut ai = config.ai.clone();
    let provider_id = match explicit_provider {
        Some(provider) => provider,
        None if configured(config) => oleafly_agent::provider::pick_provider(&ai).0,
        None => CATALOG
            .iter()
            .find(|entry| {
                !entry.is_host
                    && env_key_names(entry.id)
                        .iter()
                        .any(|name| env_value(name).is_some())
            })
            .map(|entry| entry.id.to_string())
            .ok_or_else(|| ResolveError::NoProvider {
                hint: NO_PROVIDER_HINT.into(),
            })?,
    };
    let custom = ai
        .custom
        .iter()
        .find(|custom| custom.id == provider_id)
        .cloned();
    let catalog = catalog_entry(&provider_id);
    if catalog.is_none() && custom.is_none() {
        return Err(ResolveError::Unknown(format!(
            "Oleafly doesn't know the provider {provider_id}."
        )));
    }
    let model_id = explicit_model.unwrap_or_else(|| {
        if ai.provider == provider_id && !ai.model.trim().is_empty() {
            ai.model.clone()
        } else {
            ai.enabled_models
                .get(&provider_id)
                .and_then(|models| models.first().cloned())
                .unwrap_or_else(|| default_model(&provider_id).to_string())
        }
    });
    if model_id.trim().is_empty() {
        return Err(ResolveError::NoProvider {
            hint: format!("Pass --model with a model of {provider_id}."),
        });
    }
    let key_optional =
        catalog.is_none() && custom.as_ref().is_some_and(|custom| custom.key_optional);
    let is_host = catalog.is_some_and(|entry| entry.is_host);
    let env_credential = env_key_names(&provider_id)
        .iter()
        .find_map(|name| env_value(name).map(|value| (*name, value)))
        .or_else(|| {
            if key_optional {
                return None;
            }
            env_value("OLEAFLY_API_KEY").map(|value| ("OLEAFLY_API_KEY", value))
        });
    if let Some((_, value)) = &env_credential {
        ai.keys.insert(provider_id.clone(), value.clone());
    }
    let stored_key = ai
        .keys
        .get(&provider_id)
        .cloned()
        .or_else(|| {
            (ai.provider == provider_id && legacy_key_applies(&provider_id))
                .then(|| ai.legacy_key.clone())
        })
        .unwrap_or_default();
    let keyless = catalog.is_none() && config.keyless_custom.contains(&provider_id);
    let source = match &env_credential {
        Some((name, _)) => CredentialSource::Env(name),
        None if !stored_key.trim().is_empty() => CredentialSource::Store,
        None if key_optional || is_host => CredentialSource::NotNeeded,
        None if keyless => {
            if let Some(custom) = ai.custom.iter_mut().find(|custom| custom.id == provider_id) {
                custom.key_optional = true;
            }
            CredentialSource::NotNeeded
        }
        None => {
            let env_names = env_key_names(&provider_id);
            return Err(ResolveError::MissingKey {
                provider: provider_id,
                env_names,
            });
        }
    };
    let enabled = ai.enabled_models.get(&provider_id);
    let turned_on = enabled.is_none_or(|models| models.iter().any(|model| model == &model_id));
    let resolution = if turned_on {
        resolve_specific(&ai, &provider_id, &model_id)
    } else {
        warnings.push(format!(
            "Model {model_id} is not turned on in Oleafly's settings. Using it anyway."
        ));
        resolve_for_probe(&ai, &provider_id, &model_id)
    };
    let mut resolved = resolution.map_err(|error| ResolveError::Unknown(error.to_string()))?;
    let entry = model_entry(root, config, &resolved.provider_id, &resolved.model_id);
    let price = entry
        .as_ref()
        .and_then(Price::from_entry)
        .map(|price| price.for_provider(&resolved.provider_id));
    if let Some(entry) = &entry {
        resolved.caps = ModelCaps::from_metadata_json(entry);
    }
    Ok(ResolvedProvider {
        resolved,
        source,
        price,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn choice(provider: Option<&str>, model: Option<&str>) -> ProviderChoice {
        ProviderChoice {
            provider: provider.map(str::to_owned),
            model: model.map(str::to_owned),
            effort: None,
        }
    }

    fn config_with(ai: oleafly_agent::ProviderConfig) -> DesktopConfig {
        DesktopConfig {
            ai,
            ..DesktopConfig::empty()
        }
    }

    fn openai_and_anthropic() -> DesktopConfig {
        config_with(oleafly_agent::ProviderConfig {
            provider: "openai".into(),
            model: "gpt-6.1-sol".into(),
            keys: BTreeMap::from([
                ("openai".to_string(), "sk-openai-1".to_string()),
                ("anthropic".to_string(), "sk-ant-1".to_string()),
            ]),
            ..Default::default()
        })
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn flags_beat_env_and_env_beats_config() {
        let root = tempfile::tempdir().unwrap();
        let env = |name: &str| (name == "OLEAFLY_PROVIDER").then(|| "anthropic".to_string());
        assert_eq!(
            resolve(
                root.path(),
                &openai_and_anthropic(),
                &choice(None, None),
                &env
            )
            .unwrap()
            .resolved
            .provider_id,
            "anthropic"
        );
        assert_eq!(
            resolve(
                root.path(),
                &openai_and_anthropic(),
                &choice(Some("openai"), None),
                &env
            )
            .unwrap()
            .resolved
            .provider_id,
            "openai"
        );
        assert_eq!(
            resolve(
                root.path(),
                &openai_and_anthropic(),
                &choice(None, None),
                &no_env
            )
            .unwrap()
            .resolved
            .provider_id,
            "openai"
        );
    }

    #[test]
    fn a_provider_env_key_overrides_the_store_and_reports_its_name() {
        let root = tempfile::tempdir().unwrap();
        let env = |name: &str| (name == "OPENAI_API_KEY").then(|| "sk-env".to_string());
        let resolved = resolve(
            root.path(),
            &openai_and_anthropic(),
            &choice(Some("openai"), None),
            &env,
        )
        .unwrap();
        assert_eq!(
            (resolved.source, resolved.resolved.credential.as_str()),
            (CredentialSource::Env("OPENAI_API_KEY"), "sk-env")
        );
        let stored = resolve(
            root.path(),
            &openai_and_anthropic(),
            &choice(Some("openai"), None),
            &no_env,
        )
        .unwrap();
        assert_eq!(stored.source, CredentialSource::Store);
    }

    #[test]
    fn env_key_names_cover_every_catalog_provider() {
        assert_eq!(
            env_key_names("google"),
            ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
        );
        assert_eq!(env_key_names("ollama"), ["OLLAMA_HOST"]);
        for entry in CATALOG {
            assert!(!env_key_names(entry.id).is_empty(), "{}", entry.id);
        }
        assert!(env_key_names("my-custom").is_empty());
        assert!(all_key_variables().contains(&"OLEAFLY_API_KEY"));
    }

    #[test]
    fn the_ollama_host_is_not_treated_as_a_secret() {
        let names = all_key_variables();
        assert!(!names.contains(&"OLLAMA_HOST"));
        for key in ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] {
            assert!(names.contains(&key), "{key}");
        }
    }

    #[test]
    fn no_configured_provider_explains_how_to_set_one() {
        let root = tempfile::tempdir().unwrap();
        let error = resolve(
            root.path(),
            &DesktopConfig::empty(),
            &choice(None, None),
            &no_env,
        )
        .err()
        .unwrap();
        assert!(
            matches!(error, ResolveError::NoProvider { ref hint } if hint.contains("--provider"))
        );
        let cli: CliError = error.into();
        assert_eq!(
            (cli.code.as_ref(), cli.exit() as u8),
            ("agent.no_provider", 4)
        );
    }

    #[test]
    fn a_key_in_the_environment_works_without_any_settings() {
        let root = tempfile::tempdir().unwrap();
        let env = |name: &str| (name == "ANTHROPIC_API_KEY").then(|| "sk-ant-env".to_string());
        let resolved = resolve(
            root.path(),
            &DesktopConfig::empty(),
            &choice(None, None),
            &env,
        )
        .unwrap();
        assert_eq!(resolved.resolved.provider_id, "anthropic");
        assert_eq!(resolved.source, CredentialSource::Env("ANTHROPIC_API_KEY"));
    }

    #[test]
    fn a_missing_key_names_the_variables() {
        let root = tempfile::tempdir().unwrap();
        let config = config_with(oleafly_agent::ProviderConfig {
            provider: "openai".into(),
            ..Default::default()
        });
        let error: CliError = resolve(
            root.path(),
            &config,
            &choice(Some("openai"), Some("gpt-6.1-sol")),
            &no_env,
        )
        .err()
        .unwrap()
        .into();
        assert_eq!(
            (error.code.as_ref(), error.exit() as u8),
            ("agent.missing_key", 6)
        );
        assert!(error.hint.unwrap().contains("OPENAI_API_KEY"));
    }

    #[test]
    fn an_explicit_model_that_is_not_enabled_still_runs_with_a_warning() {
        let root = tempfile::tempdir().unwrap();
        let mut config = openai_and_anthropic();
        config.ai.enabled_models =
            BTreeMap::from([("openai".to_string(), vec!["gpt-6.1-sol".to_string()])]);
        let resolved = resolve(
            root.path(),
            &config,
            &choice(Some("openai"), Some("gpt-5-mini")),
            &no_env,
        )
        .unwrap();
        assert_eq!(resolved.resolved.model_id, "gpt-5-mini");
        assert!(resolved.warnings[0].contains("not turned on"));
    }

    #[test]
    fn caps_and_price_come_from_the_model_entry() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("catalogs")).unwrap();
        std::fs::write(
            root.path().join("catalogs/model-metadata.json"),
            r#"{"schemaVersion":1,"providers":{"anthropic":{"claude-fable-5":{
                "contextWindow":1000000,"outputLimit":128000,"cost":{"input":10,"output":50,"cacheRead":1,"cacheWrite":12.5}}}}}"#,
        )
        .unwrap();
        let key_env = |name: &str| (name == "ANTHROPIC_API_KEY").then(|| "sk-ant".to_string());
        let resolved = resolve(
            root.path(),
            &DesktopConfig::empty(),
            &choice(Some("anthropic"), Some("claude-fable-5")),
            &key_env,
        )
        .unwrap();
        assert_eq!(resolved.resolved.caps.context_window, Some(1_000_000));
        let price = resolved.price.unwrap();
        assert_eq!(price.output_per_mtok, 50.0);
        let usage = Usage {
            input: 1_000_000,
            output: 1_000_000,
            cache_read: Some(0),
            cache_write: Some(0),
            input_semantics: InputTokenSemantics::Inclusive,
            ..Usage::default()
        };
        assert!((price.cost(&usage) - 60.0).abs() < 1e-9);
    }

    fn deepseek_flash(root: &Path) -> ResolvedProvider {
        std::fs::create_dir_all(root.join("catalogs")).unwrap();
        std::fs::write(
            root.join("catalogs/model-metadata.json"),
            r#"{"schemaVersion":1,"providers":{"deepseek":{"deepseek-flash":{
                "outputLimit":393216,"reasoning":true,
                "reasoningOptions":[{"type":"toggle"},{"type":"effort","values":["low","high","max"]}],
                "cost":{"input":0.15,"output":0.6,"cacheRead":0.003}}}}}"#,
        )
        .unwrap();
        let key_env = |name: &str| (name == "DEEPSEEK_API_KEY").then(|| "sk-ds".to_string());
        resolve(
            root,
            &DesktopConfig::empty(),
            &choice(Some("deepseek"), Some("deepseek-flash")),
            &key_env,
        )
        .unwrap()
    }

    #[test]
    fn deepseek_runs_cost_double_in_its_peak_hours() {
        let root = tempfile::tempdir().unwrap();
        let price = deepseek_flash(root.path()).price.unwrap();
        let usage = Usage {
            input: 1_000_000,
            output: 1_000_000,
            cache_read: Some(0),
            cache_write: Some(0),
            input_semantics: InputTokenSemantics::Inclusive,
            ..Usage::default()
        };
        let monday_peak = 1_792_981_800_000;
        let saturday = 1_793_412_000_000;
        assert!((price.cost_at(&usage, monday_peak) - 1.5).abs() < 1e-9);
        assert!((price.cost_at(&usage, saturday) - 0.75).abs() < 1e-9);
        let flat =
            Price::from_entry(&serde_json::json!({"cost":{"input":0.15,"output":0.6}})).unwrap();
        assert!((flat.cost_at(&usage, monday_peak) - 0.75).abs() < 1e-9);
    }

    #[test]
    fn effort_none_turns_deepseek_thinking_off() {
        let root = tempfile::tempdir().unwrap();
        let resolved = deepseek_flash(root.path()).resolved;
        let request = oleafly_agent::CompletionRequest {
            effort: effort_from_arg(EffortArg::None),
            ..oleafly_agent::CompletionRequest::prompt("s", "u")
        };
        let body = oleafly_agent::complete::wire_body(&resolved, &request).unwrap();
        assert_eq!(body["thinking"], serde_json::json!({"type": "disabled"}));
        let request = oleafly_agent::CompletionRequest {
            effort: effort_from_arg(EffortArg::Low),
            ..request
        };
        let body = oleafly_agent::complete::wire_body(&resolved, &request).unwrap();
        assert_eq!(body["reasoning_effort"], "low");
    }

    #[test]
    fn a_key_optional_custom_provider_needs_no_key() {
        let root = tempfile::tempdir().unwrap();
        let config = config_with(oleafly_agent::ProviderConfig {
            custom: vec![oleafly_agent::CustomProvider {
                id: "mock".into(),
                base_url: "http://127.0.0.1:9/v1".into(),
                key_optional: true,
            }],
            ..Default::default()
        });
        let resolved = resolve(
            root.path(),
            &config,
            &choice(Some("mock"), Some("mock-model")),
            &no_env,
        )
        .unwrap();
        assert_eq!(resolved.source, CredentialSource::NotNeeded);
        assert_eq!(resolved.resolved.credential, "");
    }

    fn custom_config(key_optional: bool) -> DesktopConfig {
        config_with(oleafly_agent::ProviderConfig {
            custom: vec![oleafly_agent::CustomProvider {
                id: "lemonade".into(),
                base_url: "http://localhost:13305/v1".into(),
                key_optional,
            }],
            ..Default::default()
        })
    }

    #[test]
    fn the_shared_env_key_is_not_sent_to_a_key_optional_custom_provider() {
        let root = tempfile::tempdir().unwrap();
        let env = |name: &str| (name == "OLEAFLY_API_KEY").then(|| "sk-other-service".to_string());
        let resolved = resolve(
            root.path(),
            &custom_config(true),
            &choice(Some("lemonade"), Some("Qwen3-8B")),
            &env,
        )
        .unwrap();
        assert_eq!(resolved.source, CredentialSource::NotNeeded);
        assert_eq!(resolved.resolved.credential, "");
        assert_eq!(resolved.resolved.auth, None);
    }

    #[test]
    fn the_shared_env_key_still_serves_providers_that_need_a_key() {
        let root = tempfile::tempdir().unwrap();
        let env = |name: &str| (name == "OLEAFLY_API_KEY").then(|| "sk-shared".to_string());
        let keyed = resolve(
            root.path(),
            &custom_config(false),
            &choice(Some("lemonade"), Some("Qwen3-8B")),
            &env,
        )
        .unwrap();
        assert_eq!(keyed.source, CredentialSource::Env("OLEAFLY_API_KEY"));
        assert_eq!(keyed.resolved.auth.as_deref(), Some("sk-shared"));

        let catalog = resolve(
            root.path(),
            &DesktopConfig::empty(),
            &choice(Some("openai"), Some("gpt-6.1-sol")),
            &env,
        )
        .unwrap();
        assert_eq!(catalog.source, CredentialSource::Env("OLEAFLY_API_KEY"));
    }

    #[test]
    fn an_older_entry_without_a_stored_key_takes_the_shared_key_or_runs_without_one() {
        let root = tempfile::tempdir().unwrap();
        let mut config = custom_config(false);
        config.keyless_custom.insert("lemonade".into());

        let shared = |name: &str| (name == "OLEAFLY_API_KEY").then(|| "sk-shared".to_string());
        let with_env = resolve(
            root.path(),
            &config,
            &choice(Some("lemonade"), Some("Qwen3-8B")),
            &shared,
        )
        .unwrap();
        assert_eq!(with_env.source, CredentialSource::Env("OLEAFLY_API_KEY"));
        assert_eq!(with_env.resolved.auth.as_deref(), Some("sk-shared"));

        let without = resolve(
            root.path(),
            &config,
            &choice(Some("lemonade"), Some("Qwen3-8B")),
            &|_| None,
        )
        .unwrap();
        assert_eq!(without.source, CredentialSource::NotNeeded);
        assert_eq!(without.resolved.auth, None);
    }

    #[test]
    fn a_guessed_key_less_entry_does_not_count_as_a_configured_provider() {
        let mut config = custom_config(false);
        config.keyless_custom.insert("lemonade".into());
        assert!(!configured(&config));
    }

    #[test]
    fn a_key_optional_custom_provider_still_uses_a_provider_variable_it_is_given() {
        let root = tempfile::tempdir().unwrap();
        let mut config = custom_config(true);
        config.ai.keys.insert("lemonade".into(), "sk-stored".into());
        let resolved = resolve(
            root.path(),
            &config,
            &choice(Some("lemonade"), Some("Qwen3-8B")),
            &no_env,
        )
        .unwrap();
        assert_eq!(resolved.source, CredentialSource::Store);
        assert_eq!(resolved.resolved.auth.as_deref(), Some("sk-stored"));
    }

    #[test]
    fn the_legacy_key_is_neither_used_nor_reported_for_a_custom_provider() {
        let root = tempfile::tempdir().unwrap();
        let mut config = custom_config(true);
        config.ai.provider = "lemonade".into();
        config.ai.legacy_key = "sk-old-openai".into();
        let resolved = resolve(
            root.path(),
            &config,
            &choice(None, Some("Qwen3-8B")),
            &no_env,
        )
        .unwrap();
        assert_eq!(resolved.source, CredentialSource::NotNeeded);
        assert_eq!(resolved.resolved.credential, "");
        assert_eq!(resolved.resolved.auth, None);

        let mut keyed = custom_config(false);
        keyed.ai.provider = "lemonade".into();
        keyed.ai.legacy_key = "sk-old-openai".into();
        let error = resolve(
            root.path(),
            &keyed,
            &choice(None, Some("Qwen3-8B")),
            &no_env,
        )
        .err()
        .unwrap();
        assert!(
            matches!(error, ResolveError::MissingKey { ref provider, .. } if provider == "lemonade")
        );
    }

    #[test]
    fn a_saved_catalog_provider_still_uses_the_legacy_key() {
        let root = tempfile::tempdir().unwrap();
        let config = config_with(oleafly_agent::ProviderConfig {
            provider: "openai".into(),
            model: "gpt-6.1-sol".into(),
            legacy_key: "sk-legacy".into(),
            ..Default::default()
        });
        let resolved = resolve(root.path(), &config, &choice(None, None), &no_env).unwrap();
        assert_eq!(resolved.source, CredentialSource::Store);
        assert_eq!(resolved.resolved.auth.as_deref(), Some("sk-legacy"));
    }

    #[test]
    fn a_saved_custom_provider_with_no_model_is_not_swapped_for_a_cloud_provider() {
        let root = tempfile::tempdir().unwrap();
        let mut config = custom_config(true);
        config.ai.provider = "lemonade".into();
        config.ai.keys.insert("groq".into(), "gsk-cloud".into());
        config
            .ai
            .enabled_models
            .insert("lemonade".into(), Vec::new());
        config
            .ai
            .enabled_models
            .insert("groq".into(), vec!["llama-enabled".into()]);

        let error = resolve(root.path(), &config, &choice(None, None), &no_env)
            .err()
            .unwrap();
        match error {
            ResolveError::NoProvider { hint } => {
                assert!(hint.contains("lemonade"), "{hint}");
                assert!(!hint.contains("groq"), "{hint}");
            }
            other => panic!("unexpected error {other:?}"),
        }
    }

    #[test]
    fn an_unknown_provider_is_named() {
        let root = tempfile::tempdir().unwrap();
        let error: CliError = resolve(
            root.path(),
            &DesktopConfig::empty(),
            &choice(Some("nope"), Some("x")),
            &no_env,
        )
        .err()
        .unwrap()
        .into();
        assert_eq!(error.code, "agent.unknown_provider");
        assert!(error.message.contains("nope"));
    }

    #[test]
    fn effort_levels_map_to_the_agent_levels() {
        assert_eq!(effort_from_arg(EffortArg::Auto), None);
        assert_eq!(effort_from_arg(EffortArg::None), Some(Effort::Off));
        assert_eq!(effort_from_arg(EffortArg::Xhigh), Some(Effort::Xhigh));
    }
}
