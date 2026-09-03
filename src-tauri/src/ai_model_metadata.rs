use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;

const DEFAULT_METADATA_URL: &str = "https://cdn.oleafly.com/catalogs/model-metadata.json";
const BUNDLED_METADATA: &str = include_str!("../resources/model-metadata.json");
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const REFRESH_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_PROVIDERS: usize = 64;
const MAX_MODELS_PER_PROVIDER: usize = 4_096;
const MAX_MODELS: usize = 16_384;
const CACHE_FILE: &str = "model-metadata.json";
const CACHE_STAMP_FILE: &str = "model-metadata.fetched-at";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetadata {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_limit: Option<u64>,
    #[serde(default)]
    pub input_modalities: Vec<String>,
    #[serde(default)]
    pub output_modalities: Vec<String>,
    #[serde(default)]
    pub tool_call: bool,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub attachment: bool,
    #[serde(default)]
    pub structured_output: bool,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<ModelCost>,
}

fn default_status() -> String {
    "active".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataDocument {
    schema_version: u32,
    generated_at: String,
    providers: BTreeMap<String, BTreeMap<String, ModelMetadata>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MetadataSnapshot {
    generated_at: String,
    providers: BTreeMap<String, BTreeMap<String, ModelMetadata>>,
}

impl MetadataSnapshot {
    pub fn lookup(&self, provider_id: &str, model_id: &str) -> Option<&ModelMetadata> {
        let models = self.providers.get(provider_id)?;
        if let Some(found) = models.get(model_id) {
            return Some(found);
        }
        if provider_id != "google" {
            return None;
        }
        model_id
            .strip_prefix("models/")
            .and_then(|stripped| models.get(stripped))
    }
}

fn valid_provider_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn parse_snapshot(source: &str) -> Result<MetadataSnapshot, String> {
    if source.len() > MAX_METADATA_BYTES {
        return Err("model metadata snapshot is too large".into());
    }
    let document: MetadataDocument = serde_json::from_str(source)
        .map_err(|error| format!("invalid model metadata snapshot: {error}"))?;
    if document.schema_version != 1 {
        return Err(format!(
            "unsupported model metadata schema version: {}",
            document.schema_version
        ));
    }
    if document.generated_at.trim().is_empty() {
        return Err("model metadata snapshot has no generation time".into());
    }
    if document.providers.len() > MAX_PROVIDERS {
        return Err("model metadata snapshot has too many providers".into());
    }
    let mut total = 0usize;
    for (provider_id, models) in &document.providers {
        if !valid_provider_id(provider_id) {
            return Err(format!(
                "invalid provider id in model metadata snapshot: {provider_id}"
            ));
        }
        if models.len() > MAX_MODELS_PER_PROVIDER {
            return Err(format!(
                "model metadata snapshot has too many models for {provider_id}"
            ));
        }
        total = total.saturating_add(models.len());
        if total > MAX_MODELS {
            return Err("model metadata snapshot contains too many models".into());
        }
    }
    Ok(MetadataSnapshot {
        generated_at: document.generated_at,
        providers: document.providers,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MetadataSource {
    Cdn,
    Bundled,
    Cache,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataStatus {
    pub source: MetadataSource,
    pub generated_at: String,
    pub refreshed_at: Option<u64>,
}

struct ServiceState {
    snapshot: Arc<MetadataSnapshot>,
    source: MetadataSource,
    refreshed_at: Option<u64>,
    last_attempt_at: Option<u64>,
    refresh_in_flight: bool,
}

pub(crate) struct MetadataService {
    bundled: Arc<MetadataSnapshot>,
    cache_dir: Option<PathBuf>,
    state: Mutex<ServiceState>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn stale(refreshed_at: Option<u64>, now: u64) -> bool {
    match refreshed_at {
        None => true,
        Some(at) => now.saturating_sub(at) >= REFRESH_INTERVAL_MS,
    }
}

fn read_cache(dir: &Path) -> (Option<MetadataSnapshot>, Option<u64>) {
    let snapshot = std::fs::metadata(dir.join(CACHE_FILE))
        .ok()
        .filter(|metadata| metadata.is_file() && metadata.len() <= MAX_METADATA_BYTES as u64)
        .and_then(|_| std::fs::read_to_string(dir.join(CACHE_FILE)).ok())
        .and_then(|text| parse_snapshot(&text).ok());
    if snapshot.is_none() {
        return (None, None);
    }
    let stamp = std::fs::read_to_string(dir.join(CACHE_STAMP_FILE))
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok());
    (snapshot, stamp)
}

fn write_cache(dir: &Path, source: &str, fetched_at: u64) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("failed to create catalogs directory: {error}"))?;
    crate::sandbox::atomic_write(&dir.join(CACHE_FILE), source.as_bytes())?;
    crate::sandbox::atomic_write(
        &dir.join(CACHE_STAMP_FILE),
        fetched_at.to_string().as_bytes(),
    )
}

impl MetadataService {
    pub(crate) fn open(cache_dir: Option<PathBuf>) -> Self {
        let bundled = Arc::new(parse_snapshot(BUNDLED_METADATA).unwrap_or_default());
        let (cached, stamp) = cache_dir.as_deref().map(read_cache).unwrap_or((None, None));
        let (snapshot, source) = match cached {
            Some(cached) if cached.generated_at >= bundled.generated_at => {
                (Arc::new(cached), MetadataSource::Cache)
            }
            _ => (bundled.clone(), MetadataSource::Bundled),
        };
        Self {
            bundled,
            cache_dir,
            state: Mutex::new(ServiceState {
                snapshot,
                source,
                refreshed_at: stamp,
                last_attempt_at: None,
                refresh_in_flight: false,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, ServiceState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn snapshot(&self) -> Arc<MetadataSnapshot> {
        self.lock().snapshot.clone()
    }

    pub(crate) fn status(&self) -> MetadataStatus {
        let state = self.lock();
        MetadataStatus {
            source: state.source,
            generated_at: state.snapshot.generated_at.clone(),
            refreshed_at: state.refreshed_at,
        }
    }

    fn needs_refresh(&self, now: u64) -> bool {
        stale(self.lock().refreshed_at, now)
    }

    fn begin_background_attempt(&self, now: u64) -> bool {
        let mut state = self.lock();
        if state.refresh_in_flight
            || !stale(state.refreshed_at, now)
            || !stale(state.last_attempt_at, now)
        {
            return false;
        }
        state.refresh_in_flight = true;
        state.last_attempt_at = Some(now);
        true
    }

    fn adopt(&self, fetched: MetadataSnapshot, fetched_at: u64) {
        let mut state = self.lock();
        if fetched.generated_at >= self.bundled.generated_at {
            state.snapshot = Arc::new(fetched);
            state.source = MetadataSource::Cdn;
        } else {
            state.snapshot = self.bundled.clone();
            state.source = MetadataSource::Bundled;
        }
        state.refreshed_at = Some(fetched_at);
    }

    pub(crate) async fn refresh(
        &self,
        client: &reqwest::Client,
        url: &str,
        force: bool,
    ) -> Result<MetadataStatus, String> {
        let now = now_ms();
        if !force && !self.needs_refresh(now) {
            return Ok(self.status());
        }
        {
            let mut state = self.lock();
            state.last_attempt_at = Some(now);
            state.refresh_in_flight = true;
        }
        let fetched = fetch_remote(client, url).await;
        self.lock().refresh_in_flight = false;
        let source = fetched?;
        let snapshot = parse_snapshot(&source)?;
        let fetched_at = now_ms();
        self.adopt(snapshot, fetched_at);
        if let Some(dir) = &self.cache_dir {
            let _ = write_cache(dir, &source, fetched_at);
        }
        Ok(self.status())
    }
}

fn metadata_url() -> String {
    std::env::var("OLEAFLY_MODEL_METADATA_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(|url| url.trim().to_string())
        .unwrap_or_else(|| DEFAULT_METADATA_URL.to_string())
}

async fn fetch_remote(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .timeout(METADATA_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("model metadata request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "model metadata request returned HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_METADATA_BYTES as u64)
    {
        return Err("model metadata response is too large".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = tokio::time::timeout(METADATA_TIMEOUT, stream.next())
        .await
        .map_err(|_| "model metadata request timed out".to_string())?
    {
        let chunk = chunk.map_err(|error| format!("model metadata response failed: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_METADATA_BYTES {
            return Err("model metadata response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "model metadata snapshot is not UTF-8".into())
}

static SERVICE: OnceLock<MetadataService> = OnceLock::new();

fn service() -> &'static MetadataService {
    SERVICE.get_or_init(|| MetadataService::open(crate::paths::catalogs_root().ok()))
}

pub(crate) fn snapshot() -> Arc<MetadataSnapshot> {
    service().snapshot()
}

#[cfg(test)]
pub(crate) fn bundled_snapshot() -> MetadataSnapshot {
    parse_snapshot(BUNDLED_METADATA).unwrap()
}

pub(crate) fn schedule_background_refresh(client: reqwest::Client) {
    let service = service();
    if !service.begin_background_attempt(now_ms()) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let _ = service.refresh(&client, &metadata_url(), true).await;
    });
}

#[tauri::command]
pub async fn agent_model_metadata_status() -> Result<MetadataStatus, String> {
    tauri::async_runtime::spawn_blocking(|| service().status())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_refresh_model_metadata(
    state: State<'_, crate::agent::AgentState>,
    force: Option<bool>,
) -> Result<MetadataStatus, String> {
    let client = state.client()?;
    let service = tauri::async_runtime::spawn_blocking(service)
        .await
        .map_err(|error| error.to_string())?;
    service
        .refresh(&client, &metadata_url(), force.unwrap_or(false))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot_json(generated_at: &str, provider: &str, model: &str, tool_call: bool) -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "source": "models.dev",
            "generatedAt": generated_at,
            "providers": {
                provider: {
                    model: {
                        "name": "Test Model",
                        "contextWindow": 1000,
                        "outputLimit": 100,
                        "inputModalities": ["text"],
                        "outputModalities": ["text"],
                        "toolCall": tool_call,
                        "reasoning": false,
                        "attachment": false,
                        "structuredOutput": false,
                        "status": "active",
                        "cost": { "input": 1.5, "output": 3 }
                    }
                }
            }
        })
        .to_string()
    }

    fn write_cache_files(dir: &Path, json: &str, stamp: Option<u64>) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(CACHE_FILE), json).unwrap();
        if let Some(stamp) = stamp {
            std::fs::write(dir.join(CACHE_STAMP_FILE), stamp.to_string()).unwrap();
        }
    }

    #[test]
    fn the_bundled_snapshot_parses_and_resolves_known_models() {
        let snapshot = parse_snapshot(BUNDLED_METADATA).unwrap();
        let gpt4o = snapshot.lookup("openai", "gpt-4o").unwrap();
        assert_eq!(gpt4o.name, "GPT-4o");
        assert!(gpt4o.tool_call);
        assert_eq!(gpt4o.context_window, Some(128_000));
        assert_eq!(gpt4o.cost.as_ref().unwrap().cache_read, Some(1.25));
        assert!(snapshot.lookup("ollama", "llama3.2").is_none());
        assert!(snapshot.lookup("openai", "gpt-5-2025-08-07").is_none());
        assert!(!snapshot.generated_at.is_empty());
    }

    #[test]
    fn a_metadata_entry_serializes_in_the_snapshot_shape() {
        let snapshot = parse_snapshot(&snapshot_json(
            "2026-01-01T00:00:00.000Z",
            "openai",
            "m",
            true,
        ))
        .unwrap();
        let json = serde_json::to_value(snapshot.lookup("openai", "m").unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "name": "Test Model",
                "contextWindow": 1000,
                "outputLimit": 100,
                "inputModalities": ["text"],
                "outputModalities": ["text"],
                "toolCall": true,
                "reasoning": false,
                "attachment": false,
                "structuredOutput": false,
                "status": "active",
                "cost": { "input": 1.5, "output": 3.0 }
            })
        );
    }

    #[test]
    fn google_ids_resolve_after_stripping_the_models_prefix_only_for_google() {
        let snapshot = parse_snapshot(&snapshot_json(
            "2026-01-01T00:00:00.000Z",
            "google",
            "gemini-3.7-flash",
            true,
        ))
        .unwrap();
        assert!(snapshot.lookup("google", "gemini-3.7-flash").is_some());
        assert!(snapshot
            .lookup("google", "models/gemini-3.7-flash")
            .is_some());
        assert!(snapshot.lookup("google", "models/other").is_none());

        let openai = parse_snapshot(&snapshot_json(
            "2026-01-01T00:00:00.000Z",
            "openai",
            "gpt-4o",
            true,
        ))
        .unwrap();
        assert!(openai.lookup("openai", "models/gpt-4o").is_none());
    }

    #[test]
    fn malformed_snapshots_are_rejected() {
        assert!(parse_snapshot("not json").is_err());
        assert!(parse_snapshot(
            r#"{"schemaVersion":2,"generatedAt":"2026-01-01T00:00:00Z","providers":{}}"#
        )
        .is_err());
        assert!(parse_snapshot(r#"{"schemaVersion":1,"generatedAt":"","providers":{}}"#).is_err());
        assert!(parse_snapshot(
            r#"{"schemaVersion":1,"generatedAt":"2026-01-01T00:00:00Z","providers":{"bad provider":{}}}"#
        )
        .is_err());
    }

    #[test]
    fn opening_without_a_cache_uses_the_bundled_snapshot_and_wants_a_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let service = MetadataService::open(Some(dir.path().join("catalogs")));

        let status = service.status();
        assert_eq!(status.source, MetadataSource::Bundled);
        assert_eq!(status.refreshed_at, None);
        assert_eq!(
            status.generated_at,
            parse_snapshot(BUNDLED_METADATA).unwrap().generated_at
        );
        assert!(service.needs_refresh(now_ms()));
        assert!(service.snapshot().lookup("openai", "gpt-4o").is_some());
    }

    #[test]
    fn a_newer_cached_snapshot_wins_and_carries_its_fetch_stamp() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        let stamp = now_ms();
        write_cache_files(
            &cache,
            &snapshot_json("9999-01-01T00:00:00.000Z", "openai", "future-model", true),
            Some(stamp),
        );
        let service = MetadataService::open(Some(cache));

        let status = service.status();
        assert_eq!(status.source, MetadataSource::Cache);
        assert_eq!(status.refreshed_at, Some(stamp));
        assert_eq!(status.generated_at, "9999-01-01T00:00:00.000Z");
        assert!(!service.needs_refresh(now_ms()));
        assert!(service
            .snapshot()
            .lookup("openai", "future-model")
            .is_some());
    }

    #[test]
    fn an_older_cache_than_the_bundle_is_ignored_but_its_stamp_still_counts() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        let stamp = now_ms() - 2 * REFRESH_INTERVAL_MS;
        write_cache_files(
            &cache,
            &snapshot_json("2000-01-01T00:00:00.000Z", "openai", "ancient-model", true),
            Some(stamp),
        );
        let service = MetadataService::open(Some(cache));

        let status = service.status();
        assert_eq!(status.source, MetadataSource::Bundled);
        assert_eq!(status.refreshed_at, Some(stamp));
        assert!(service.needs_refresh(now_ms()));
        assert!(service
            .snapshot()
            .lookup("openai", "ancient-model")
            .is_none());
    }

    #[test]
    fn a_corrupt_cache_falls_back_to_the_bundle_and_is_fetched_again() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        write_cache_files(&cache, "{ this is not a snapshot", Some(now_ms()));
        let service = MetadataService::open(Some(cache));

        let status = service.status();
        assert_eq!(status.source, MetadataSource::Bundled);
        assert_eq!(status.refreshed_at, None);
        assert!(service.needs_refresh(now_ms()));
        assert!(service.begin_background_attempt(now_ms()));
        assert!(service.snapshot().lookup("openai", "gpt-4o").is_some());
    }

    #[test]
    fn background_refreshes_are_attempted_at_most_once_per_day() {
        let dir = tempfile::tempdir().unwrap();
        let service = MetadataService::open(Some(dir.path().join("catalogs")));
        let now = now_ms();

        assert!(service.begin_background_attempt(now));
        assert!(!service.begin_background_attempt(now));
        service.lock().refresh_in_flight = false;
        assert!(!service.begin_background_attempt(now + 1000));
        assert!(service.begin_background_attempt(now + REFRESH_INTERVAL_MS));

        let stamped = MetadataService::open(Some(dir.path().join("other")));
        stamped.lock().refreshed_at = Some(now);
        assert!(!stamped.begin_background_attempt(now + 1000));
    }

    #[tokio::test]
    async fn a_fresh_stamp_makes_an_unforced_refresh_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        write_cache_files(
            &cache,
            &snapshot_json("9999-01-01T00:00:00.000Z", "openai", "future-model", true),
            Some(now_ms()),
        );
        let service = MetadataService::open(Some(cache));
        let client = oleafly_agent::build_client().unwrap();

        let status = service
            .refresh(&client, "http://127.0.0.1:1/never-contacted", false)
            .await
            .unwrap();

        assert_eq!(status.source, MetadataSource::Cache);
    }

    async fn serve(
        body: String,
        status: axum::http::StatusCode,
    ) -> (String, tokio::task::JoinHandle<()>) {
        use axum::routing::get;
        use axum::Router;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/catalogs/model-metadata.json",
            get(move || {
                let body = body.clone();
                async move { (status, body) }
            }),
        );
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (
            format!("http://{address}/catalogs/model-metadata.json"),
            task,
        )
    }

    #[tokio::test]
    async fn a_forced_refresh_fetches_writes_the_cache_and_reports_cdn() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        let service = MetadataService::open(Some(cache.clone()));
        let (url, server) = serve(
            snapshot_json("9999-06-01T00:00:00.000Z", "groq", "fresh-model", false),
            axum::http::StatusCode::OK,
        )
        .await;
        let client = oleafly_agent::build_client().unwrap();

        let status = service.refresh(&client, &url, true).await.unwrap();
        server.abort();

        assert_eq!(status.source, MetadataSource::Cdn);
        assert_eq!(status.generated_at, "9999-06-01T00:00:00.000Z");
        assert!(status.refreshed_at.is_some());
        assert!(!service.needs_refresh(now_ms()));
        let fetched = service.snapshot();
        assert!(!fetched.lookup("groq", "fresh-model").unwrap().tool_call);
        assert!(fetched.lookup("openai", "gpt-4o").is_none());

        let reopened = MetadataService::open(Some(cache));
        let status = reopened.status();
        assert_eq!(status.source, MetadataSource::Cache);
        assert_eq!(status.generated_at, "9999-06-01T00:00:00.000Z");
        assert!(status.refreshed_at.is_some());
    }

    #[tokio::test]
    async fn a_fetched_snapshot_is_used_even_when_the_cache_cannot_be_written() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("catalogs");
        std::fs::write(&cache, "a file where the cache directory should be").unwrap();
        let service = MetadataService::open(Some(cache.clone()));
        let (url, server) = serve(
            snapshot_json("9999-06-01T00:00:00.000Z", "groq", "fresh-model", true),
            axum::http::StatusCode::OK,
        )
        .await;
        let client = oleafly_agent::build_client().unwrap();

        let status = service.refresh(&client, &url, true).await.unwrap();
        server.abort();

        assert_eq!(status.source, MetadataSource::Cdn);
        assert_eq!(status.generated_at, "9999-06-01T00:00:00.000Z");
        assert!(status.refreshed_at.is_some());
        assert!(!service.needs_refresh(now_ms()));
        assert!(service.snapshot().lookup("groq", "fresh-model").is_some());
        assert!(cache.is_file());
        assert_eq!(
            MetadataService::open(Some(cache)).status().source,
            MetadataSource::Bundled
        );
    }

    #[tokio::test]
    async fn a_failed_fetch_keeps_the_current_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let service = MetadataService::open(Some(dir.path().join("catalogs")));
        let (url, server) = serve(
            "busy".to_string(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
        )
        .await;
        let client = oleafly_agent::build_client().unwrap();

        let error = service.refresh(&client, &url, true).await.unwrap_err();
        server.abort();

        assert!(error.contains("HTTP 503"));
        let status = service.status();
        assert_eq!(status.source, MetadataSource::Bundled);
        assert_eq!(status.refreshed_at, None);
        assert!(!service.lock().refresh_in_flight);
    }

    #[tokio::test]
    async fn a_malformed_or_oversized_response_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let service = MetadataService::open(Some(dir.path().join("catalogs")));
        let client = oleafly_agent::build_client().unwrap();

        let (url, server) = serve("{".to_string(), axum::http::StatusCode::OK).await;
        assert!(service.refresh(&client, &url, true).await.is_err());
        server.abort();

        let oversized = " ".repeat(MAX_METADATA_BYTES + 1);
        let (url, server) = serve(oversized, axum::http::StatusCode::OK).await;
        let error = service.refresh(&client, &url, true).await.unwrap_err();
        server.abort();
        assert!(error.contains("too large"));
        assert_eq!(service.status().source, MetadataSource::Bundled);
    }
}
