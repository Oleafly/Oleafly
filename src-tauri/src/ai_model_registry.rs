use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::ai_model_metadata::{MetadataSnapshot, ModelMetadata};
use crate::config::{model_probe_key, ModelProbe, ProbeVerdict};

const DEFAULT_REGISTRY_URL: &str = "https://cdn.oleafly.com/catalogs/ai-models.json";
const BUNDLED_REGISTRY: &str = include_str!("../resources/ai-models.json");
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REGISTRY_BYTES: usize = 512 * 1024;
const MAX_PROVIDERS: usize = 64;
const MAX_MODELS_PER_PROVIDER: usize = 512;
const MAX_MODELS: usize = 8_192;
const MAX_BLOCKED_REASON_CHARS: usize = 200;

pub(crate) const BLOCKED_RUN_PREFIX: &str = "This model is blocked for the assistant: ";
pub(crate) const NO_TOOLS_RUN_REFUSAL: &str =
    "This model cannot use tools, so the assistant cannot run on it.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryDocument {
    schema_version: u32,
    providers: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderTrustDocument {
    verified: Vec<String>,
    #[serde(default)]
    blocked: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ProviderCatalog {
    verified: BTreeSet<String>,
    blocked: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ModelRegistry {
    providers: BTreeMap<String, ProviderCatalog>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CatalogTrust {
    Verified,
    Blocked(String),
    Untested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelTrust {
    Verified,
    Untested,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrustSource {
    Catalog,
    Probe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrustResolution {
    pub(crate) trust: ModelTrust,
    pub(crate) blocked_reason: Option<String>,
    pub(crate) source: Option<TrustSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub trust: ModelTrust,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_source: Option<TrustSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ModelMetadata>,
}

impl ModelRegistry {
    pub(crate) fn catalog_trust(&self, provider_id: &str, model_id: &str) -> CatalogTrust {
        let Some(catalog) = self.providers.get(provider_id) else {
            return CatalogTrust::Untested;
        };
        if let Some(reason) = catalog.blocked.get(model_id) {
            return CatalogTrust::Blocked(reason.clone());
        }
        if catalog.verified.contains(model_id) {
            return CatalogTrust::Verified;
        }
        CatalogTrust::Untested
    }
}

pub(crate) fn resolve_trust(catalog: CatalogTrust, probe: Option<&ModelProbe>) -> TrustResolution {
    let (trust, blocked_reason, source) = match (catalog, probe) {
        (CatalogTrust::Blocked(reason), _) => (
            ModelTrust::Blocked,
            Some(reason),
            Some(TrustSource::Catalog),
        ),
        (_, Some(probe)) if probe.verdict == ProbeVerdict::Blocked => (
            ModelTrust::Blocked,
            Some(probe.reason.clone()),
            Some(TrustSource::Probe),
        ),
        (CatalogTrust::Verified, _) => (ModelTrust::Verified, None, Some(TrustSource::Catalog)),
        (_, Some(probe)) if probe.verdict == ProbeVerdict::Verified => {
            (ModelTrust::Verified, None, Some(TrustSource::Probe))
        }
        _ => (ModelTrust::Untested, None, None),
    };
    TrustResolution {
        trust,
        blocked_reason,
        source,
    }
}

pub(crate) fn classify(
    registry: &ModelRegistry,
    provider_id: &str,
    available: Vec<oleafly_agent::ModelInfo>,
    probes: &BTreeMap<String, ModelProbe>,
    snapshot: &MetadataSnapshot,
) -> Vec<ProviderModel> {
    available
        .into_iter()
        .map(|model| {
            let probe = probes.get(&model_probe_key(provider_id, &model.id));
            let resolution = resolve_trust(registry.catalog_trust(provider_id, &model.id), probe);
            ProviderModel {
                metadata: snapshot.lookup(provider_id, &model.id).cloned(),
                id: model.id,
                name: model.name,
                trust: resolution.trust,
                trust_source: resolution.source,
                blocked_reason: resolution.blocked_reason,
            }
        })
        .collect()
}

pub(crate) fn run_refusal(
    registry: &ModelRegistry,
    provider_id: &str,
    model_id: &str,
    probes: &BTreeMap<String, ModelProbe>,
    snapshot: &MetadataSnapshot,
    has_tools: bool,
) -> Option<String> {
    let probe = probes.get(&model_probe_key(provider_id, model_id));
    let resolution = resolve_trust(registry.catalog_trust(provider_id, model_id), probe);
    match resolution.trust {
        ModelTrust::Blocked => Some(format!(
            "{BLOCKED_RUN_PREFIX}{}",
            resolution.blocked_reason.unwrap_or_default()
        )),
        ModelTrust::Verified => None,
        ModelTrust::Untested if has_tools => snapshot
            .lookup(provider_id, model_id)
            .filter(|metadata| !metadata.tool_call)
            .map(|_| NO_TOOLS_RUN_REFUSAL.to_string()),
        ModelTrust::Untested => None,
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

fn first_sentence(text: &str) -> &str {
    let mut end = text.len();
    for (index, ch) in text.char_indices() {
        if matches!(ch, '.' | '!' | '?') {
            let after = index + ch.len_utf8();
            if text[after..].starts_with(' ') {
                end = after;
                break;
            }
        }
    }
    &text[..end]
}

fn normalize_blocked_reason(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let sentence = first_sentence(&collapsed);
    if sentence.is_empty() || sentence.chars().count() > MAX_BLOCKED_REASON_CHARS {
        return None;
    }
    Some(sentence.to_string())
}

fn provider_lists(
    schema_version: u32,
    provider_id: &str,
    value: serde_json::Value,
) -> Result<(Vec<String>, BTreeMap<String, String>), String> {
    match schema_version {
        1 => serde_json::from_value::<Vec<String>>(value)
            .map(|verified| (verified, BTreeMap::new()))
            .map_err(|error| format!("invalid AI model catalog entry for {provider_id}: {error}")),
        2 => serde_json::from_value::<ProviderTrustDocument>(value)
            .map(|document| (document.verified, document.blocked))
            .map_err(|error| format!("invalid AI model catalog entry for {provider_id}: {error}")),
        other => Err(format!(
            "unsupported AI model catalog schema version: {other}"
        )),
    }
}

fn parse_registry(source: &str) -> Result<ModelRegistry, String> {
    let document: RegistryDocument = serde_json::from_str(source)
        .map_err(|error| format!("invalid AI model catalog: {error}"))?;
    if !matches!(document.schema_version, 1 | 2) {
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
    for (provider_id, value) in document.providers {
        if !valid_provider_id(&provider_id) {
            return Err(format!(
                "invalid provider id in AI model catalog: {provider_id}"
            ));
        }
        let (verified_list, blocked_map) =
            provider_lists(document.schema_version, &provider_id, value)?;
        let count = verified_list.len().saturating_add(blocked_map.len());
        if count == 0 || count > MAX_MODELS_PER_PROVIDER {
            return Err(format!(
                "AI model catalog has an invalid model count for {provider_id}"
            ));
        }
        total_models = total_models.saturating_add(count);
        if total_models > MAX_MODELS {
            return Err("AI model catalog contains too many models".into());
        }

        let mut verified = BTreeSet::new();
        for model_id in verified_list {
            if !valid_model_id(&model_id) {
                return Err(format!(
                    "invalid model id in AI model catalog for {provider_id}"
                ));
            }
            if !verified.insert(model_id.clone()) {
                return Err(format!(
                    "duplicate model id in AI model catalog for {provider_id}: {model_id}"
                ));
            }
        }
        let mut blocked = BTreeMap::new();
        for (model_id, reason) in blocked_map {
            if !valid_model_id(&model_id) {
                return Err(format!(
                    "invalid blocked model id in AI model catalog for {provider_id}"
                ));
            }
            let Some(reason) = normalize_blocked_reason(&reason) else {
                return Err(format!(
                    "invalid blocked reason in AI model catalog for {provider_id}: {model_id}"
                ));
            };
            blocked.insert(model_id, reason);
        }
        providers.insert(provider_id, ProviderCatalog { verified, blocked });
    }
    Ok(ModelRegistry { providers })
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

static BUNDLED: OnceLock<Arc<ModelRegistry>> = OnceLock::new();
static REMOTE: OnceLock<Mutex<Option<Arc<ModelRegistry>>>> = OnceLock::new();

fn bundled_registry() -> Arc<ModelRegistry> {
    BUNDLED
        .get_or_init(|| Arc::new(parse_registry(BUNDLED_REGISTRY).unwrap_or_default()))
        .clone()
}

fn remote_slot() -> &'static Mutex<Option<Arc<ModelRegistry>>> {
    REMOTE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn current_registry() -> Arc<ModelRegistry> {
    remote_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .unwrap_or_else(bundled_registry)
}

fn adopt_remote(
    slot: &Mutex<Option<Arc<ModelRegistry>>>,
    remote: Option<&str>,
) -> Option<Arc<ModelRegistry>> {
    let registry = Arc::new(parse_registry(remote?).ok()?);
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(registry.clone());
    Some(registry)
}

pub(crate) async fn load_registry(client: &reqwest::Client) -> Arc<ModelRegistry> {
    let remote = fetch_remote(client).await.ok();
    adopt_remote(remote_slot(), remote.as_deref()).unwrap_or_else(current_registry)
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

    fn no_probes() -> BTreeMap<String, ModelProbe> {
        BTreeMap::new()
    }

    fn probe(verdict: ProbeVerdict, reason: &str) -> ModelProbe {
        ModelProbe {
            verdict,
            reason: reason.into(),
            probed_at: 1,
        }
    }

    fn trusts(
        models: &[ProviderModel],
    ) -> Vec<(&str, ModelTrust, Option<&str>, Option<TrustSource>)> {
        models
            .iter()
            .map(|model| {
                (
                    model.id.as_str(),
                    model.trust,
                    model.blocked_reason.as_deref(),
                    model.trust_source,
                )
            })
            .collect()
    }

    fn resolution(
        trust: ModelTrust,
        blocked_reason: Option<&str>,
        source: Option<TrustSource>,
    ) -> TrustResolution {
        TrustResolution {
            trust,
            blocked_reason: blocked_reason.map(str::to_string),
            source,
        }
    }

    const CATALOG: Option<TrustSource> = Some(TrustSource::Catalog);
    const PROBE: Option<TrustSource> = Some(TrustSource::Probe);

    #[test]
    fn bundled_catalog_is_valid_and_marks_specialized_openai_models_untested() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let openai = registry.providers.get("openai").unwrap();
        assert!(openai.verified.contains("gpt-5.6-luna"));
        for id in [
            "gpt-audio-1.5",
            "gpt-image-2",
            "text-embedding-ada-002",
            "gpt-realtime-2",
        ] {
            assert_eq!(registry.catalog_trust("openai", id), CatalogTrust::Untested);
        }
        assert_eq!(
            registry.catalog_trust("google", "gemini-3-flash-preview"),
            CatalogTrust::Blocked(
                "This preview model's thinking output breaks the assistant loop.".into()
            )
        );
        assert_eq!(bundled_registry().as_ref(), &registry);
    }

    #[test]
    fn bundled_catalog_verifies_the_supported_local_ollama_tags() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let available = vec![
            model("llama3.2:3b"),
            model("llama3.2:latest"),
            model("embeddinggemma:latest"),
        ];

        let classified = classify(
            &registry,
            "ollama",
            available,
            &no_probes(),
            &MetadataSnapshot::default(),
        );
        assert_eq!(
            trusts(&classified),
            vec![
                ("llama3.2:3b", ModelTrust::Verified, None, CATALOG),
                ("llama3.2:latest", ModelTrust::Verified, None, CATALOG),
                ("embeddinggemma:latest", ModelTrust::Untested, None, None),
            ]
        );
        assert!(classified.iter().all(|model| model.metadata.is_none()));
    }

    #[test]
    fn a_version_one_catalog_is_a_verified_list_with_nothing_blocked() {
        let registry = parse_registry(
            r#"{"schemaVersion":1,"providers":{"openai":["architecture-alpha","architecture-beta"]}}"#,
        )
        .unwrap();
        assert_eq!(
            registry.providers["openai"],
            ProviderCatalog {
                verified: BTreeSet::from(["architecture-alpha".into(), "architecture-beta".into()]),
                blocked: BTreeMap::new(),
            }
        );
        assert!(
            parse_registry(r#"{"schemaVersion":1,"providers":{"openai":{"verified":["a"]}}}"#)
                .is_err()
        );
    }

    #[test]
    fn a_version_two_catalog_parses_and_blocked_wins_over_verified() {
        let registry = parse_registry(
            r#"{"schemaVersion":2,"providers":{
                "google":{"verified":["gemini-a","gemini-b"],"blocked":{"gemini-b":"Breaks the loop."}},
                "groq":{"verified":["llama"]}
            }}"#,
        )
        .unwrap();
        assert_eq!(
            registry.catalog_trust("google", "gemini-b"),
            CatalogTrust::Blocked("Breaks the loop.".into())
        );
        assert_eq!(
            registry.catalog_trust("google", "gemini-a"),
            CatalogTrust::Verified
        );
        assert_eq!(
            registry.catalog_trust("google", "gemini-c"),
            CatalogTrust::Untested
        );
        assert_eq!(
            registry.catalog_trust("groq", "llama"),
            CatalogTrust::Verified
        );
        assert!(parse_registry(r#"{"schemaVersion":2,"providers":{"openai":["a"]}}"#).is_err());
        assert!(parse_registry(
            r#"{"schemaVersion":2,"providers":{"openai":{"verified":["a"],"extra":1}}}"#
        )
        .is_err());
        assert!(parse_registry(r#"{"schemaVersion":3,"providers":{"openai":["a"]}}"#).is_err());
    }

    #[test]
    fn a_provider_with_only_blocked_models_still_parses() {
        let registry = parse_registry(
            r#"{"schemaVersion":2,"providers":{"x":{"verified":[],"blocked":{"m":"No tools."}}}}"#,
        )
        .unwrap();
        assert_eq!(
            registry.catalog_trust("x", "m"),
            CatalogTrust::Blocked("No tools.".into())
        );
        assert!(
            parse_registry(r#"{"schemaVersion":2,"providers":{"x":{"verified":[]}}}"#).is_err()
        );
    }

    #[test]
    fn blocked_reasons_are_trimmed_to_one_short_sentence() {
        assert_eq!(
            normalize_blocked_reason("  Breaks the\n  loop.  Second sentence here. "),
            Some("Breaks the loop.".into())
        );
        assert_eq!(
            normalize_blocked_reason("Runs at v1.5 only"),
            Some("Runs at v1.5 only".into())
        );
        assert_eq!(normalize_blocked_reason("   \n "), None);
        assert_eq!(normalize_blocked_reason(&"x".repeat(201)), None);
        assert_eq!(
            normalize_blocked_reason(&"x".repeat(200)),
            Some("x".repeat(200))
        );
        assert!(parse_registry(
            r#"{"schemaVersion":2,"providers":{"x":{"verified":["a"],"blocked":{"b":"   "}}}}"#
        )
        .is_err());
    }

    #[test]
    fn classification_keeps_provider_order_names_and_marks_unknown_models_untested() {
        let registry = parse_registry(
            r#"{"schemaVersion":2,"providers":{"openai":{"verified":["architecture-alpha","architecture-beta"],"blocked":{"gpt-audio-1.5":"Audio only."}}}}"#,
        )
        .unwrap();
        let available = vec![
            model("architecture-beta"),
            model("gpt-audio-1.5"),
            model("architecture-alpha"),
            model("architecture-alpha-preview"),
        ];

        let classified = classify(
            &registry,
            "openai",
            available,
            &no_probes(),
            &MetadataSnapshot::default(),
        );
        assert_eq!(
            trusts(&classified),
            vec![
                ("architecture-beta", ModelTrust::Verified, None, CATALOG),
                (
                    "gpt-audio-1.5",
                    ModelTrust::Blocked,
                    Some("Audio only."),
                    CATALOG
                ),
                ("architecture-alpha", ModelTrust::Verified, None, CATALOG),
                (
                    "architecture-alpha-preview",
                    ModelTrust::Untested,
                    None,
                    None
                ),
            ]
        );
        assert_eq!(classified[0].name, "Name for architecture-beta");
    }

    #[test]
    fn provider_boundaries_are_not_inferred_and_unknown_providers_are_untested() {
        let registry = parse_registry(
            r#"{"schemaVersion":1,"providers":{"openai":["shared-id"],"groq":["groq-only"]}}"#,
        )
        .unwrap();

        let groq = classify(
            &registry,
            "groq",
            vec![model("shared-id")],
            &no_probes(),
            &MetadataSnapshot::default(),
        );
        assert_eq!(
            trusts(&groq),
            vec![("shared-id", ModelTrust::Untested, None, None)]
        );
        let custom = classify(
            &registry,
            "my-gateway",
            vec![model("shared-id"), model("anything")],
            &no_probes(),
            &MetadataSnapshot::default(),
        );
        assert_eq!(
            trusts(&custom),
            vec![
                ("shared-id", ModelTrust::Untested, None, None),
                ("anything", ModelTrust::Untested, None, None),
            ]
        );
    }

    #[test]
    fn persisted_probes_upgrade_untested_and_block_below_the_catalog() {
        let catalog_verified = CatalogTrust::Verified;
        let catalog_blocked = CatalogTrust::Blocked("Catalog says no.".into());
        let verified_probe = probe(ProbeVerdict::Verified, "Called the tool.");
        let blocked_probe = probe(ProbeVerdict::Blocked, "No tool call.");

        assert_eq!(
            resolve_trust(catalog_blocked.clone(), Some(&verified_probe)),
            resolution(ModelTrust::Blocked, Some("Catalog says no."), CATALOG)
        );
        assert_eq!(
            resolve_trust(catalog_blocked, Some(&blocked_probe)),
            resolution(ModelTrust::Blocked, Some("Catalog says no."), CATALOG)
        );
        assert_eq!(
            resolve_trust(catalog_verified.clone(), Some(&blocked_probe)),
            resolution(ModelTrust::Blocked, Some("No tool call."), PROBE)
        );
        assert_eq!(
            resolve_trust(catalog_verified.clone(), Some(&verified_probe)),
            resolution(ModelTrust::Verified, None, CATALOG)
        );
        assert_eq!(
            resolve_trust(catalog_verified, None),
            resolution(ModelTrust::Verified, None, CATALOG)
        );
        assert_eq!(
            resolve_trust(CatalogTrust::Untested, Some(&verified_probe)),
            resolution(ModelTrust::Verified, None, PROBE)
        );
        assert_eq!(
            resolve_trust(CatalogTrust::Untested, Some(&blocked_probe)),
            resolution(ModelTrust::Blocked, Some("No tool call."), PROBE)
        );
        assert_eq!(
            resolve_trust(CatalogTrust::Untested, None),
            resolution(ModelTrust::Untested, None, None)
        );
    }

    #[test]
    fn listings_attach_metadata_and_apply_persisted_probes_by_provider_and_model() {
        let registry =
            parse_registry(r#"{"schemaVersion":2,"providers":{"openai":{"verified":["gpt-4o"]}}}"#)
                .unwrap();
        let probes = BTreeMap::from([
            (
                model_probe_key("openai", "gpt-4o-mini"),
                probe(ProbeVerdict::Verified, "Called the tool."),
            ),
            (
                model_probe_key("groq", "gpt-4o"),
                probe(ProbeVerdict::Blocked, "Wrong provider."),
            ),
        ]);
        let snapshot = crate::ai_model_metadata::MetadataSnapshot::default();

        let classified = classify(
            &registry,
            "openai",
            vec![model("gpt-4o"), model("gpt-4o-mini"), model("gpt-image-2")],
            &probes,
            &snapshot,
        );
        assert_eq!(
            trusts(&classified),
            vec![
                ("gpt-4o", ModelTrust::Verified, None, CATALOG),
                ("gpt-4o-mini", ModelTrust::Verified, None, PROBE),
                ("gpt-image-2", ModelTrust::Untested, None, None),
            ]
        );
        let json = serde_json::to_value(&classified[1]).unwrap();
        assert_eq!(json["trustSource"], "probe");

        let live = crate::ai_model_metadata::bundled_snapshot();
        let with_metadata = classify(
            &registry,
            "openai",
            vec![model("gpt-4o"), model("gpt-5-2025-08-07")],
            &no_probes(),
            &live,
        );
        assert_eq!(with_metadata[0].metadata.as_ref().unwrap().name, "GPT-4o");
        assert!(with_metadata[1].metadata.is_none());
        let json = serde_json::to_value(&with_metadata[1]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "gpt-5-2025-08-07",
                "name": "Name for gpt-5-2025-08-07",
                "trust": "untested"
            })
        );
        let json = serde_json::to_value(&with_metadata[0]).unwrap();
        assert_eq!(json["trust"], "verified");
        assert_eq!(json["trustSource"], "catalog");
        assert_eq!(json["metadata"]["toolCall"], true);
        assert_eq!(json["metadata"]["cost"]["cacheRead"], 1.25);
        assert!(json.get("blockedReason").is_none());
    }

    #[test]
    fn a_probe_blocked_listing_carries_the_probe_as_its_source() {
        let registry =
            parse_registry(r#"{"schemaVersion":2,"providers":{"openai":{"verified":["gpt-4o"]}}}"#)
                .unwrap();
        let probes = BTreeMap::from([(
            model_probe_key("openai", "gpt-4o"),
            probe(ProbeVerdict::Blocked, "No tool call."),
        )]);

        let classified = classify(
            &registry,
            "openai",
            vec![model("gpt-4o")],
            &probes,
            &MetadataSnapshot::default(),
        );
        let json = serde_json::to_value(&classified[0]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "gpt-4o",
                "name": "Name for gpt-4o",
                "trust": "blocked",
                "trustSource": "probe",
                "blockedReason": "No tool call."
            })
        );
    }

    #[test]
    fn the_run_path_refuses_blocked_and_untested_no_tool_models_only() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        let refusal = |provider: &str, model: &str, has_tools: bool| {
            run_refusal(
                &registry,
                provider,
                model,
                &no_probes(),
                &snapshot,
                has_tools,
            )
        };

        assert_eq!(
            refusal("google", "gemini-3-flash-preview", true),
            Some(
                "This model is blocked for the assistant: This preview model's thinking output breaks the assistant loop."
                    .into()
            )
        );
        assert_eq!(
            refusal("openai", "gpt-image-2", true),
            Some(NO_TOOLS_RUN_REFUSAL.into())
        );
        assert_eq!(refusal("openai", "gpt-4o", true), None);
        assert_eq!(refusal("ollama", "mystery:latest", true), None);
        assert_eq!(refusal("my-gateway", "anything", true), None);

        let probes = BTreeMap::from([
            (
                model_probe_key("openai", "gpt-image-2"),
                probe(ProbeVerdict::Verified, "Called the tool."),
            ),
            (
                model_probe_key("openai", "gpt-4o"),
                probe(
                    ProbeVerdict::Blocked,
                    "The model answered without calling the tool.",
                ),
            ),
        ]);
        assert_eq!(
            run_refusal(&registry, "openai", "gpt-image-2", &probes, &snapshot, true),
            None
        );
        assert_eq!(
            run_refusal(&registry, "openai", "gpt-4o", &probes, &snapshot, true),
            Some(
                "This model is blocked for the assistant: The model answered without calling the tool."
                    .into()
            )
        );
    }

    #[test]
    fn a_run_that_declares_no_tools_is_not_refused_for_a_chat_only_model() {
        let registry = parse_registry(BUNDLED_REGISTRY).unwrap();
        let snapshot = crate::ai_model_metadata::bundled_snapshot();
        assert!(!snapshot.lookup("openai", "gpt-image-2").unwrap().tool_call);

        assert_eq!(
            run_refusal(
                &registry,
                "openai",
                "gpt-image-2",
                &no_probes(),
                &snapshot,
                false
            ),
            None
        );
        assert_eq!(
            run_refusal(
                &registry,
                "google",
                "gemini-3-flash-preview",
                &no_probes(),
                &snapshot,
                false
            ),
            Some(
                "This model is blocked for the assistant: This preview model's thinking output breaks the assistant loop."
                    .into()
            )
        );
    }

    #[test]
    fn an_invalid_remote_catalog_is_not_adopted_and_the_bundled_copy_stays_current() {
        let slot = Mutex::new(None);

        assert!(adopt_remote(
            &slot,
            Some(r#"{"schemaVersion":3,"providers":{"openai":["bad"]}}"#)
        )
        .is_none());
        assert!(adopt_remote(&slot, None).is_none());
        assert!(slot.lock().unwrap().is_none());

        let adopted = adopt_remote(
            &slot,
            Some(r#"{"schemaVersion":2,"providers":{"openai":{"verified":["fresh"]}}}"#),
        )
        .unwrap();
        assert_eq!(
            adopted.catalog_trust("openai", "fresh"),
            CatalogTrust::Verified
        );
        assert_eq!(slot.lock().unwrap().as_ref(), Some(&adopted));
        assert_eq!(
            current_registry().catalog_trust("openai", "gpt-4o"),
            CatalogTrust::Verified
        );
    }

    #[test]
    fn malformed_ids_and_duplicates_are_rejected() {
        for source in [
            r#"{"schemaVersion":1,"providers":{"bad provider":["model"]}}"#,
            r#"{"schemaVersion":1,"providers":{"openai":["bad model"]}}"#,
            r#"{"schemaVersion":1,"providers":{"openai":["same","same"]}}"#,
            r#"{"schemaVersion":2,"providers":{"openai":{"verified":["a"],"blocked":{"bad id":"Reason."}}}}"#,
        ] {
            assert!(parse_registry(source).is_err());
        }
    }
}
