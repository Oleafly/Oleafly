//! Which provider and model a headless run uses, and its credential.
//!
//! Provider: `--provider`, then `OLEAFLY_PROVIDER`, then the app's choice.
//! Model: `--model`, then `OLEAFLY_MODEL`, then the app's choice.
//! Credential: the provider's own variable (or `OLEAFLY_API_KEY`), then
//! the app's encrypted store. The app's model trust list is not applied:
//! a model that is not turned on still runs, with a warning.
use std::path::Path;

use oleafly_agent::provider::{
    catalog_entry, default_model, resolve_for_probe, resolve_specific, CATALOG,
};
use oleafly_agent::{Effort, InputTokenSemantics, ModelCaps, Usage};
use serde_json::Value;

use super::desktop_config::{model_entry, DesktopConfig};
use super::EffortArg;
use crate::contract::{CliError, ErrorKind};

/// What the user asked for on the command line.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProviderChoice {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub effort: Option<Effort>,
}

/// Where the credential came from (reported in the result; never the value).
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
    /// With `caps` filled from the model's metadata.
    pub resolved: oleafly_agent::Resolved,
    pub source: CredentialSource,
    pub price: Option<Price>,
    pub warnings: Vec<String>,
}

/// US dollars per million tokens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    pub cache_read_per_mtok: Option<f64>,
    pub cache_write_per_mtok: Option<f64>,
}

impl Price {
    /// The metadata entry's `cost` object (`input`, `output`, `cacheRead`,
    /// `cacheWrite`).
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
        })
    }

    /// What `usage` costs at this price. Cached tokens count at their own
    /// rate (the input rate when the model has none).
    pub fn cost(&self, usage: &Usage) -> f64 {
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
        total / 1_000_000.0
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

/// The variables that hold a catalog provider's key (Ollama: its host).
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
pub fn all_key_variables() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = CATALOG
        .iter()
        .flat_map(|entry| env_key_names(entry.id).iter().copied())
        .collect();
    names.push("OLEAFLY_API_KEY");
    names.sort_unstable();
    names.dedup();
    names
}

/// `--effort auto` sends no effort; `none` turns thinking off.
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

/// Resolves the provider, model and credential for a run. `env` reads the
/// environment (`|_| None` ignores it, as the background helper does).
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
        None => {
            // Nothing set up in the app: a provider whose key is in the
            // environment still works.
            CATALOG
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
                })?
        }
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
    let env_credential = env_key_names(&provider_id)
        .iter()
        .find_map(|name| env_value(name).map(|value| (*name, value)))
        .or_else(|| env_value("OLEAFLY_API_KEY").map(|value| ("OLEAFLY_API_KEY", value)));
    if let Some((_, value)) = &env_credential {
        ai.keys.insert(provider_id.clone(), value.clone());
    }
    let stored_key = ai
        .keys
        .get(&provider_id)
        .cloned()
        .or_else(|| (ai.provider == provider_id).then(|| ai.legacy_key.clone()))
        .unwrap_or_default();
    let key_optional = custom.as_ref().is_some_and(|custom| custom.key_optional);
    let is_host = catalog.is_some_and(|entry| entry.is_host);
    let source = match &env_credential {
        Some((name, _)) => CredentialSource::Env(name),
        None if !stored_key.trim().is_empty() => CredentialSource::Store,
        None if key_optional || is_host => CredentialSource::NotNeeded,
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
    let price = entry.as_ref().and_then(Price::from_entry);
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
