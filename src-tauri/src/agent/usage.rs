use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::State;

use oleafly_agent::{AgentEvent, InputTokenSemantics, Resolved, Usage, Wire};
use rusqlite::Connection;

pub use super::acp_usage::attach_acp_usage;
use crate::usage_report::{
    apply_model_metadata_cost, record_usage_observation_with, validate_usage_event, UsageEventInput,
};

pub const BUILTIN_RUNTIME: &str = "built-in";
pub const HELPER_RUNTIME: &str = "built-in:helper";
const PERSIST_INTERVAL: Duration = Duration::from_millis(750);

pub struct UsageScope {
    pub session_id: String,
    pub turn_id: String,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub parent_session_id: Option<String>,
}

pub struct NativeUsageGuard {
    root: PathBuf,
    started: Instant,
    state: Mutex<UsageState>,
    tally: Option<Arc<CostTally>>,
}

/// What a run and its subagents cost, summed as each one settles.
#[derive(Default)]
pub struct CostTally {
    total: Mutex<Option<f64>>,
}

impl CostTally {
    pub fn add(&self, usd: f64) {
        if !usd.is_finite() {
            return;
        }
        let mut total = super::lock_or_recover(&self.total);
        *total = Some(total.unwrap_or(0.0) + usd);
    }

    pub fn total(&self) -> Option<f64> {
        *super::lock_or_recover(&self.total)
    }
}

struct UsageState {
    event: UsageEventInput,
    latest: Option<Usage>,
    settled: bool,
    connection: Option<Connection>,
    last_persist: Option<Instant>,
}

fn runtime_id(scope: &UsageScope) -> &'static str {
    let one_shot = scope.session_id == scope.turn_id
        && scope.parent_session_id.is_none()
        && scope.task_id.is_none();
    if one_shot {
        HELPER_RUNTIME
    } else {
        BUILTIN_RUNTIME
    }
}

impl NativeUsageGuard {
    pub fn new(root: PathBuf, scope: UsageScope, resolved: &Resolved) -> Self {
        let occurred_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(i64::MAX as u128) as i64;
        let runtime = runtime_id(&scope);
        Self {
            root,
            started: Instant::now(),
            state: Mutex::new(UsageState {
                event: UsageEventInput {
                    event_id: format!("{}:usage", scope.turn_id),
                    source_id: format!("builtin:{}", scope.session_id),
                    source_turn_id: scope.turn_id,
                    project_id: scope.project_id.unwrap_or_else(|| "global".into()),
                    task_id: scope.task_id,
                    session_id: scope.session_id,
                    parent_session_id: scope.parent_session_id,
                    parent_record_key: None,
                    runtime_id: runtime.into(),
                    provider_id: Some(resolved.provider_id.clone()),
                    model_id: Some(resolved.model_id.clone()),
                    occurred_at_ms,
                    observation_sequence: Some(0),
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    input_semantics: "unknown".into(),
                    counter_semantics: "cumulative".into(),
                    measurement: "unavailable".into(),
                    billing_mode: billing_mode(resolved).into(),
                    estimated_cost_usd: None,
                    price_version: None,
                    duration_ms: Some(0),
                    status: "in_progress".into(),
                    aggregation_scope: "self".into(),
                },
                latest: None,
                settled: false,
                connection: None,
                last_persist: None,
            }),
            tally: None,
        }
    }

    /// Adds this guard's final cost to `tally` when it settles.
    pub fn with_tally(mut self, tally: Arc<CostTally>) -> Self {
        self.tally = Some(tally);
        self
    }

    /// The cost so far from the model's prices, when they are known.
    #[cfg(test)]
    pub fn estimated_cost_usd(&self) -> Option<f64> {
        super::lock_or_recover(&self.state).event.estimated_cost_usd
    }

    pub fn observe(&self, event: &AgentEvent) {
        let AgentEvent::Usage { usage, .. } = event else {
            return;
        };
        let mut state = super::lock_or_recover(&self.state);
        if state.settled || state.latest.as_ref() == Some(usage) {
            return;
        }
        state.latest = Some(*usage);
        state.event.input_tokens = usage.reported_input().map(i64::from);
        state.event.output_tokens = usage.reported_output().map(i64::from);
        state.event.cache_read_tokens = usage.cache_read.map(i64::from);
        state.event.cache_write_tokens = usage.cache_write.map(i64::from);
        state.event.input_semantics = match usage.input_semantics {
            InputTokenSemantics::Inclusive => "inclusive",
            InputTokenSemantics::Exclusive => "exclusive",
            InputTokenSemantics::Unknown => "unknown",
        }
        .into();
        state.event.measurement = if [
            state.event.input_tokens,
            state.event.output_tokens,
            state.event.cache_read_tokens,
            state.event.cache_write_tokens,
        ]
        .iter()
        .any(Option::is_some)
        {
            "provider_reported"
        } else {
            "unavailable"
        }
        .into();
        let due = match state.last_persist {
            Some(last) => last.elapsed() >= PERSIST_INTERVAL,
            None => true,
        };
        if due {
            self.persist(&mut state);
        }
    }

    pub fn finish(&self, status: &str) {
        let mut state = super::lock_or_recover(&self.state);
        if state.settled {
            return;
        }
        state.event.status = status.into();
        self.persist(&mut state);
        state.settled = true;
        state.connection = None;
        if let (Some(tally), Some(cost)) = (&self.tally, state.event.estimated_cost_usd) {
            tally.add(cost);
        }
    }

    fn persist(&self, state: &mut UsageState) {
        state.event.observation_sequence = Some(
            state
                .event
                .observation_sequence
                .unwrap_or(0)
                .saturating_add(1),
        );
        state.event.duration_ms =
            Some(self.started.elapsed().as_millis().min(i64::MAX as u128) as i64);
        state.event.estimated_cost_usd = None;
        state.event.price_version = None;
        apply_model_metadata_cost(&crate::ai_model_metadata::snapshot(), &mut state.event);
        state.last_persist = Some(Instant::now());
        let result = validate_usage_event(&state.event).and_then(|()| {
            if state.connection.is_none() {
                state.connection = Some(crate::library_db::open(&self.root)?);
            }
            let connection = state
                .connection
                .as_ref()
                .expect("connection was just opened");
            record_usage_observation_with(connection, &state.event).map(|_| ())
        });
        if let Err(error) = result {
            state.connection = None;
            crate::logsafe::info(
                "usage persistence",
                serde_json::json!({"error": error}),
                serde_json::Value::Null,
            );
        }
    }
}

impl Drop for NativeUsageGuard {
    fn drop(&mut self) {
        self.finish("cancelled");
    }
}

/// A provider account's remaining credit, where the provider reports it.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredit {
    pub source: String,
    pub currency: String,
    pub remaining: Option<f64>,
    pub limit: Option<f64>,
    pub used: Option<f64>,
    pub label: Option<String>,
    pub available: Option<bool>,
}

const CREDIT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CREDIT_BODY_BYTES: usize = 64 * 1024;

/// OpenRouter `GET /key`.
pub(crate) fn parse_openrouter_key(body: &Value) -> Option<ProviderCredit> {
    let data = body.get("data").filter(|data| data.is_object())?;
    Some(ProviderCredit {
        source: "openrouter".into(),
        currency: "USD".into(),
        remaining: data.get("limit_remaining").and_then(Value::as_f64),
        limit: data.get("limit").and_then(Value::as_f64),
        used: data.get("usage").and_then(Value::as_f64),
        label: data
            .get("label")
            .and_then(Value::as_str)
            .map(str::to_string),
        available: None,
    })
}

/// DeepSeek `GET /user/balance`: the USD balance when there is one, else
/// the first currency.
pub(crate) fn parse_deepseek_balance(body: &Value) -> Option<ProviderCredit> {
    let infos = body.get("balance_infos").and_then(Value::as_array)?;
    let info = infos
        .iter()
        .find(|info| info.get("currency").and_then(Value::as_str) == Some("USD"))
        .or_else(|| infos.first())?;
    Some(ProviderCredit {
        source: "deepseek".into(),
        currency: info.get("currency").and_then(Value::as_str)?.to_string(),
        remaining: info
            .get("total_balance")
            .and_then(Value::as_str)
            .and_then(|balance| balance.trim().parse().ok()),
        limit: None,
        used: None,
        label: None,
        available: body.get("is_available").and_then(Value::as_bool),
    })
}

fn credit_failed(provider: &str) -> String {
    crate::app_error::AppError::new("provider_credit.failed")
        .param("provider", provider)
        .into()
}

/// Reads a balance endpoint. Errors name the provider only; nothing from
/// the response (which could echo the key) reaches the message.
async fn fetch_credit(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    provider: &str,
    parse: fn(&Value) -> Option<ProviderCredit>,
) -> Result<Option<ProviderCredit>, String> {
    let mut authorization = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
        .map_err(|_| credit_failed(provider))?;
    authorization.set_sensitive(true);
    let mut response = client
        .get(url)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .timeout(CREDIT_TIMEOUT)
        .send()
        .await
        .map_err(|_| credit_failed(provider))?;
    if !response.status().is_success() {
        return Err(credit_failed(provider));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| credit_failed(provider))?
    {
        if body.len() + chunk.len() > MAX_CREDIT_BODY_BYTES {
            return Err(credit_failed(provider));
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| credit_failed(provider))?;
    parse(&value)
        .map(Some)
        .ok_or_else(|| credit_failed(provider))
}

/// The remaining credit of the provider's account, for providers that
/// publish it (OpenRouter, DeepSeek). Others answer `None`.
#[tauri::command]
pub async fn agent_provider_credit(
    state: State<'_, super::AgentState>,
    provider_id: String,
) -> Result<Option<ProviderCredit>, String> {
    type Parse = fn(&Value) -> Option<ProviderCredit>;
    let (path, name, parse): (&str, &str, Parse) = match provider_id.as_str() {
        "openrouter" => ("/key", "OpenRouter", parse_openrouter_key),
        "deepseek" => ("/user/balance", "DeepSeek", parse_deepseek_balance),
        _ => return Ok(None),
    };
    let Some(base) =
        oleafly_agent::provider::catalog_entry(&provider_id).and_then(|entry| entry.base_url)
    else {
        return Ok(None);
    };
    let lookup_id = provider_id.clone();
    let key = tauri::async_runtime::spawn_blocking(move || {
        crate::config::read_config().map(|cfg| {
            cfg.ai_keys
                .get(&lookup_id)
                .map(|key| key.trim().to_string())
                .filter(|key| !key.is_empty())
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(key) = key else {
        return Ok(None);
    };
    let client = state.client()?;
    fetch_credit(
        &client,
        &format!("{}{path}", base.trim_end_matches('/')),
        &key,
        name,
        parse,
    )
    .await
}

fn billing_mode(resolved: &Resolved) -> &'static str {
    let base_url = match &resolved.wire {
        Wire::OpenAiResponses { base_url }
        | Wire::OpenAiChat { base_url, .. }
        | Wire::Anthropic { base_url }
        | Wire::Google { base_url } => base_url,
    };
    crate::ai_model_metadata::classify_billing(&resolved.provider_id, base_url).as_str()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn provider_responses_keep_missing_counters_unknown_in_native_ledger() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let bodies = [
            (serde_json::json!({"output": []}), None, None),
            (
                serde_json::json!({"output": [], "usage": {"input_tokens": 0, "output_tokens": 0}}),
                Some(0),
                Some(0),
            ),
            (
                serde_json::json!({"output": [], "usage": {"input_tokens": 12}}),
                Some(12),
                None,
            ),
            (
                serde_json::json!({"output": [], "usage": {"output_tokens": 3}}),
                None,
                Some(3),
            ),
        ];
        for (body, expected_input, expected_output) in bodies {
            let root = tempfile::tempdir().unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut buffer = [0; 4096];
                    let read = socket.read(&mut buffer).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                    assert!(request.len() <= 65536);
                    let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                    else {
                        continue;
                    };
                    let length = String::from_utf8_lossy(&request[..header_end])
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= header_end + 4 + length {
                        break;
                    }
                }
                let body = body.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                socket.shutdown().await.unwrap();
            });
            let resolved = Resolved {
                provider_id: "test".into(),
                model_id: "test-model".into(),
                credential: String::new(),
                auth: None,
                wire: Wire::OpenAiResponses {
                    base_url: format!("http://{address}"),
                },
                caps: oleafly_agent::ModelCaps::default(),
            };
            let guard = NativeUsageGuard::new(
                root.path().into(),
                UsageScope {
                    session_id: "session".into(),
                    turn_id: "turn".into(),
                    project_id: Some("project".into()),
                    task_id: None,
                    parent_session_id: None,
                },
                &resolved,
            );
            let response = oleafly_agent::complete(
                &reqwest::Client::new(),
                &resolved,
                &oleafly_agent::CompletionRequest::prompt("test", "test"),
            )
            .await
            .unwrap();
            guard.observe(&AgentEvent::usage(response.usage));
            guard.finish("completed");
            server.await.unwrap();
            let connection = crate::library_db::open(root.path()).unwrap();
            let row: (Option<i64>, Option<i64>, Option<f64>, String) = connection.query_row(
                "SELECT input_tokens, output_tokens, estimated_cost_usd, measurement FROM usage_records", [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            ).unwrap();
            assert_eq!(row.0, expected_input);
            assert_eq!(row.1, expected_output);
            assert_eq!(row.2, None);
            assert_eq!(
                row.3,
                if expected_input.is_some() || expected_output.is_some() {
                    "provider_reported"
                } else {
                    "unavailable"
                }
            );
            guard.observe(&AgentEvent::usage(Usage::default()));
        }
    }

    #[test]
    fn later_missing_step_clears_earlier_known_native_totals() {
        let root = tempfile::tempdir().unwrap();
        let resolved = Resolved {
            provider_id: "test".into(),
            model_id: "test-model".into(),
            credential: String::new(),
            auth: None,
            wire: Wire::OpenAiResponses {
                base_url: "https://example.test".into(),
            },
            caps: oleafly_agent::ModelCaps::default(),
        };
        let guard = NativeUsageGuard::new(
            root.path().into(),
            UsageScope {
                session_id: "session".into(),
                turn_id: "turn".into(),
                project_id: Some("project".into()),
                task_id: None,
                parent_session_id: None,
            },
            &resolved,
        );
        guard.observe(&AgentEvent::usage(Usage {
            input: 100,
            output: 20,
            input_known: Some(true),
            output_known: Some(true),
            ..Usage::default()
        }));
        guard.observe(&AgentEvent::usage(Usage {
            input: 100,
            output: 20,
            input_known: Some(false),
            output_known: Some(false),
            ..Usage::default()
        }));
        guard.finish("completed");
        let connection = crate::library_db::open(root.path()).unwrap();
        let row: (Option<i64>, Option<i64>, String) = connection
            .query_row(
                "SELECT input_tokens, output_tokens, measurement FROM usage_records",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, (None, None, "unavailable".into()));
    }

    #[test]
    fn drop_preserves_observed_counters_and_marks_cancellation() {
        let root = tempfile::tempdir().unwrap();
        let resolved = Resolved {
            provider_id: "test".into(),
            model_id: "test-model".into(),
            credential: String::new(),
            auth: None,
            wire: Wire::OpenAiResponses {
                base_url: "https://example.test".into(),
            },
            caps: oleafly_agent::ModelCaps::default(),
        };
        {
            let guard = NativeUsageGuard::new(
                root.path().into(),
                UsageScope {
                    session_id: "child".into(),
                    turn_id: "turn-1".into(),
                    project_id: Some("project".into()),
                    task_id: None,
                    parent_session_id: Some("parent".into()),
                },
                &resolved,
            );
            let event = AgentEvent::usage(Usage {
                input: 100,
                output: 20,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(40),
                cache_write: None,
                input_semantics: InputTokenSemantics::Inclusive,
                reasoning: None,
            });
            guard.observe(&event);
            guard.observe(&event);
        }
        let connection = crate::library_db::open(root.path()).unwrap();
        let row: (i64, i64, Option<i64>, String, String, i64) = connection.query_row(
            "SELECT input_tokens, output_tokens, cache_write_tokens, status, parent_session_id, COUNT(*) FROM usage_records",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
        ).unwrap();
        assert_eq!(row, (100, 20, None, "cancelled".into(), "parent".into(), 1));
    }

    #[test]
    fn the_cost_tally_sums_parent_and_child_costs() {
        let tally = CostTally::default();
        assert_eq!(tally.total(), None);
        tally.add(0.25);
        tally.add(0.5);
        tally.add(f64::NAN);
        assert_eq!(tally.total(), Some(0.75));
    }

    #[test]
    fn a_settled_guard_adds_its_cost_once() {
        let root = tempfile::tempdir().unwrap();
        let resolved = Resolved {
            provider_id: "anthropic".into(),
            model_id: "claude-opus-5-5".into(),
            credential: "k".into(),
            auth: Some("k".into()),
            wire: Wire::Anthropic {
                base_url: "https://api.anthropic.com/v1".into(),
            },
            caps: oleafly_agent::ModelCaps::default(),
        };
        let tally = Arc::new(CostTally::default());
        let guard = NativeUsageGuard::new(
            root.path().to_path_buf(),
            UsageScope {
                session_id: "s".into(),
                turn_id: "t".into(),
                project_id: None,
                task_id: None,
                parent_session_id: None,
            },
            &resolved,
        )
        .with_tally(tally.clone());
        // Exclusive input counts are priced only with the cache counts known.
        guard.observe(&AgentEvent::usage(Usage {
            input: 1_000,
            output: 1_000,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(0),
            cache_write: Some(0),
            input_semantics: InputTokenSemantics::Exclusive,
            ..Usage::default()
        }));
        guard.finish("completed");
        guard.finish("completed");
        let cost = guard.estimated_cost_usd();
        assert!(cost.is_some_and(|cost| cost > 0.0), "{cost:?}");
        assert_eq!(tally.total(), cost);
    }

    #[test]
    fn provider_credit_parses_openrouter_and_deepseek() {
        let openrouter = parse_openrouter_key(&serde_json::json!({
            "data": {"label":"k","limit":20.0,"limit_remaining":12.5,"usage":7.5,"is_free_tier":false}
        }))
        .unwrap();
        assert_eq!(
            (
                openrouter.currency.as_str(),
                openrouter.remaining,
                openrouter.limit,
                openrouter.used
            ),
            ("USD", Some(12.5), Some(20.0), Some(7.5))
        );
        let deepseek = parse_deepseek_balance(&serde_json::json!({
            "is_available": true,
            "balance_infos": [
                {"currency":"CNY","total_balance":"110.00"},
                {"currency":"USD","total_balance":"3.50"}
            ]
        }))
        .unwrap();
        assert_eq!(
            (
                deepseek.currency.as_str(),
                deepseek.remaining,
                deepseek.available
            ),
            ("USD", Some(3.5), Some(true))
        );
        assert!(parse_deepseek_balance(&serde_json::json!({"balance_infos": []})).is_none());
    }

    #[tokio::test]
    async fn provider_credit_errors_never_contain_the_key() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer).await;
            let body = r#"{"error":"bad key sk-or-SECRET-123"}"#;
            let reply = format!(
                "HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(reply.as_bytes()).await;
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let error = fetch_credit(
            &client,
            &format!("http://{address}/key"),
            "sk-or-SECRET-123",
            "OpenRouter",
            parse_openrouter_key,
        )
        .await
        .unwrap_err();
        assert!(!error.contains("SECRET"), "{error}");
        assert!(error.contains("provider_credit.failed"), "{error}");
    }
}
