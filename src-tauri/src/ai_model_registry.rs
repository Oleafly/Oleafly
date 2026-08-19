use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;

const DEFAULT_REGISTRY_URL: &str = "https://cdn.oleafly.com/catalogs/ai-models.json";
const BUNDLED_REGISTRY: &str = include_str!("../resources/ai-models.json");
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REGISTRY_BYTES: usize = 512 * 1024;
const MAX_PROVIDERS: usize = 64;
const MAX_MODELS_PER_PROVIDER: usize = 512;
const MAX_MODELS: usize = 8_192;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryDocument {
    schema_version: u32,
    providers: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, PartialEq, Eq)]
struct ModelRegistry {
    providers: BTreeMap<String, BTreeSet<String>>,
}

impl ModelRegistry {
    fn filter(
        &self,
        provider_id: &str,
        available: Vec<oleafly_agent::ModelInfo>,
    ) -> Vec<oleafly_agent::ModelInfo> {
        let Some(supported) = self.providers.get(provider_id) else {
            return Vec::new();
        };
        available
            .into_iter()
            .filter(|model| supported.contains(&model.id))
            .collect()
    }
}

fn registry_url() -> String {
    std::env::var("OLEAFLY_AI_MODELS_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(|url| url.trim().to_string())
        .unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string())
}

fn valid_provider_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|byte| !byte.is_ascii_whitespace() && !byte.is_ascii_control())
}

fn parse_registry(source: &str) -> Result<ModelRegistry, String> {
    let document: RegistryDocument = serde_json::from_str(source)
        .map_err(|error| format!("invalid AI model catalog: {error}"))?;
    if document.schema_version != 1 {
        return Err(format!(
            "unsupported AI model catalog schema version: {}",
            document.schema_version
        ));
    }
    if document.providers.is_empty() || document.providers.len() > MAX_PROVIDERS {
        return Err("AI model catalog has an invalid provider count".into());
    }

    let mut total_models = 0usize;
    let mut providers = BTreeMap::new();
    for (provider_id, models) in document.providers {
        if !valid_provider_id(&provider_id) {
            return Err(format!(
                "invalid provider id in AI model catalog: {provider_id}"
            ));
        }
        if models.is_empty() || models.len() > MAX_MODELS_PER_PROVIDER {
            return Err(format!(
                "AI model catalog has an invalid model count for {provider_id}"
            ));
        }
        total_models = total_models.saturating_add(models.len());
        if total_models > MAX_MODELS {
            return Err("AI model catalog contains too many models".into());
        }

        let mut unique = BTreeSet::new();
        for model_id in models {
            if !valid_model_id(&model_id) {
                return Err(format!(
                    "invalid model id in AI model catalog for {provider_id}"
                ));
            }
            if !unique.insert(model_id.clone()) {
                return Err(format!(
                    "duplicate model id in AI model catalog for {provider_id}: {model_id}"
                ));
            }
        }
        providers.insert(provider_id, unique);
    }
    Ok(ModelRegistry { providers })
}

fn parse_remote_or_bundled(remote: Option<&str>, bundled: &str) -> Result<ModelRegistry, String> {
    if let Some(source) = remote {
        if let Ok(registry) = parse_registry(source) {
            return Ok(registry);
        }
    }
    parse_registry(bundled).map_err(|error| format!("bundled {error}"))
}

async fn fetch_remote(client: &reqwest::Client) -> Result<String, String> {
    let response = client
        .get(registry_url())
        .timeout(REGISTRY_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("AI model catalog request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "AI model catalog request returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_REGISTRY_BYTES as u64)
    {
        return Err("AI model catalog response is too large".into());
    }

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("AI model catalog response failed: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_REGISTRY_BYTES {
            return Err("AI model catalog response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "AI model catalog is not UTF-8".into())
}

pub(crate) async fn filter_supported_models(
    client: &reqwest::Client,
    provider_id: &str,
    available: Vec<oleafly_agent::ModelInfo>,
) -> Result<Vec<oleafly_agent::ModelInfo>, String> {
    let remote = fetch_remote(client).await.ok();
    let registry = parse_remote_or_bundled(remote.as_deref(), BUNDLED_REGISTRY)?;
    Ok(registry.filter(provider_id, available))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str) -> oleafly_agent::ModelInfo {
        oleafly_agent::ModelInfo {
            id: id.into(),
            name: format!("Name for {id}"),
        }
    }

    #[test]
    fn bundled_catalog_is_valid_and_excludes_specialized_openai_models() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let openai = registry.providers.get("openai").unwrap();
        assert!(openai.contains("gpt-5.6-luna"));
        assert!(!openai.contains("gpt-audio-1.5"));
        assert!(!openai.contains("gpt-image-2"));
        assert!(!openai.contains("text-embedding-ada-002"));
        assert!(!openai.contains("gpt-realtime-2"));
    }

    #[test]
    fn bundled_catalog_includes_the_supported_local_ollama_tags() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let available = vec![
            model("llama3.2:3b"),
            model("llama3.2:latest"),
            model("embeddinggemma:latest"),
        ];

        assert_eq!(
            registry.filter("ollama", available),
            vec![model("llama3.2:3b"), model("llama3.2:latest")]
        );
    }

    #[test]
    fn intersection_is_exact_and_preserves_provider_order_and_names() {
        let registry = parse_registry(
            r#"{"schemaVersion":1,"providers":{"openai":["architecture-alpha","architecture-beta"]}}"#,
        )
        .unwrap();
        let available = vec![
            model("architecture-beta"),
            model("gpt-audio-1.5"),
            model("architecture-alpha"),
            model("architecture-alpha-preview"),
        ];

        assert_eq!(
            registry.filter("openai", available),
            vec![model("architecture-beta"), model("architecture-alpha")]
        );
    }

    #[test]
    fn provider_boundaries_are_not_inferred_from_model_ids() {
        let registry = parse_registry(
            r#"{"schemaVersion":1,"providers":{"openai":["shared-id"],"groq":["groq-only"]}}"#,
        )
        .unwrap();

        assert!(registry.filter("groq", vec![model("shared-id")]).is_empty());
        assert!(registry
            .filter("unknown-provider", vec![model("shared-id")])
            .is_empty());
    }

    #[test]
    fn invalid_remote_catalog_falls_back_to_the_bundled_copy() {
        let registry = parse_remote_or_bundled(
            Some(r#"{"schemaVersion":2,"providers":{"openai":["bad"]}}"#),
            r#"{"schemaVersion":1,"providers":{"openai":["fallback"]}}"#,
        )
        .unwrap();

        assert_eq!(
            registry.filter("openai", vec![model("bad"), model("fallback")]),
            vec![model("fallback")]
        );
    }

    #[test]
    fn malformed_ids_and_duplicates_are_rejected() {
        for source in [
            r#"{"schemaVersion":1,"providers":{"bad provider":["model"]}}"#,
            r#"{"schemaVersion":1,"providers":{"openai":["bad model"]}}"#,
            r#"{"schemaVersion":1,"providers":{"openai":["same","same"]}}"#,
        ] {
            assert!(parse_registry(source).is_err());
        }
    }
}
