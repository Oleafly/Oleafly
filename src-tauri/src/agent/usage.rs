use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
        }
    }

    pub fn observe(&self, event: &AgentEvent) {
        let AgentEvent::Usage { usage } = event else {
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
            guard.observe(&AgentEvent::Usage {
                usage: response.usage,
            });
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
            guard.observe(&AgentEvent::Usage {
                usage: Usage::default(),
            });
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
        guard.observe(&AgentEvent::Usage {
            usage: Usage {
                input: 100,
                output: 20,
                input_known: Some(true),
                output_known: Some(true),
                ..Usage::default()
            },
        });
        guard.observe(&AgentEvent::Usage {
            usage: Usage {
                input: 100,
                output: 20,
                input_known: Some(false),
                output_known: Some(false),
                ..Usage::default()
            },
        });
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
            let event = AgentEvent::Usage {
                usage: Usage {
                    input: 100,
                    output: 20,
                    input_known: Some(true),
                    output_known: Some(true),
                    cache_read: Some(40),
                    cache_write: None,
                    input_semantics: InputTokenSemantics::Inclusive,
                },
            };
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
}
