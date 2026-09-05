use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::acp::{AcpEvent, AcpRuntime, SessionRecord, SessionStatus};
use crate::usage_report::{record_usage_observation, UsageEventInput};

#[derive(Default, Serialize, Deserialize)]
struct ReplayState {
    sequence: u64,
    turn: Option<TurnUsage>,
}

#[derive(Serialize, Deserialize)]
struct TurnUsage {
    turn_id: String,
    started_at_ms: u64,
    model_id: Option<String>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    cache_write_tokens: Option<i64>,
    status: String,
    measured: bool,
    duration_ms: i64,
}

impl TurnUsage {
    fn new(event: &AcpEvent, turn_id: String) -> Self {
        Self {
            turn_id,
            started_at_ms: event.timestamp,
            model_id: event.model_id.clone(),
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            status: "in_progress".into(),
            measured: false,
            duration_ms: 0,
        }
    }

    fn observation(&self, event: &AcpEvent, session: &SessionRecord) -> UsageEventInput {
        UsageEventInput {
            event_id: format!("{}:{}", event.session_id, event.sequence),
            source_id: format!("acp:{}", event.session_id),
            source_turn_id: self.turn_id.clone(),
            project_id: event.project_id.clone(),
            task_id: event.task_id.clone(),
            session_id: event.session_id.clone(),
            parent_session_id: session.parent_session_id.clone(),
            parent_record_key: None,
            runtime_id: "acp".into(),
            provider_id: None,
            model_id: self.model_id.clone(),
            occurred_at_ms: signed(self.started_at_ms),
            observation_sequence: Some(signed(event.sequence.saturating_mul(2))),
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cache_read_tokens: self.cache_read_tokens,
            cache_write_tokens: self.cache_write_tokens,
            input_semantics: "unknown".into(),
            counter_semantics: "cumulative".into(),
            measurement: if self.measured {
                "runtime_reported"
            } else {
                "unavailable"
            }
            .into(),
            billing_mode: "unknown".into(),
            estimated_cost_usd: None,
            price_version: None,
            duration_ms: Some(self.duration_ms),
            status: self.status.clone(),
            aggregation_scope: "self".into(),
        }
    }
}

fn signed(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn merge_counter(current: &mut Option<i64>, data: &serde_json::Value, key: &str) {
    if let Some(value) = data[key].as_u64() {
        *current = Some(current.unwrap_or(0).max(signed(value)));
    }
}

fn consume(
    state: &mut ReplayState,
    event: &AcpEvent,
    session: &SessionRecord,
) -> Option<UsageEventInput> {
    let turn_id = event.turn_id.as_ref()?;
    if state
        .turn
        .as_ref()
        .map_or(true, |turn| &turn.turn_id != turn_id)
    {
        state.turn = Some(TurnUsage::new(event, turn_id.clone()));
    }
    let turn = state.turn.as_mut()?;
    turn.model_id = event.model_id.clone().or_else(|| turn.model_id.clone());
    let mut changed = false;
    match event.kind.as_str() {
        "user_message" => changed = true,
        "usage" if event.data["source"] == "acp_prompt" => {
            merge_counter(&mut turn.input_tokens, &event.data, "inputTokens");
            merge_counter(&mut turn.output_tokens, &event.data, "outputTokens");
            merge_counter(&mut turn.cache_read_tokens, &event.data, "cacheReadTokens");
            merge_counter(
                &mut turn.cache_write_tokens,
                &event.data,
                "cacheWriteTokens",
            );
            turn.measured = [
                turn.input_tokens,
                turn.output_tokens,
                turn.cache_read_tokens,
                turn.cache_write_tokens,
            ]
            .iter()
            .any(Option::is_some);
            changed = true;
        }
        "turn_complete" => {
            turn.status = if event.data["stopReason"] == "cancelled" {
                "cancelled"
            } else if event.data["error"].as_str().is_some() || event.data["stopReason"] == "error"
            {
                "failed"
            } else {
                "completed"
            }
            .into();
            changed = true;
        }
        "status" if turn.status == "in_progress" => {
            let terminal = match event.data["status"].as_str() {
                Some("cancelled") => Some("cancelled"),
                Some("failed") => Some("failed"),
                Some("disconnected") => Some("interrupted"),
                _ => None,
            };
            if let Some(status) = terminal {
                turn.status = status.into();
                changed = true;
            }
        }
        _ => {}
    }
    if changed {
        turn.duration_ms = signed(event.timestamp.saturating_sub(turn.started_at_ms));
        Some(turn.observation(event, session))
    } else {
        None
    }
}

fn replay_session(
    root: &Path,
    runtime: &AcpRuntime,
    session: &SessionRecord,
) -> Result<(), String> {
    let db = crate::library_db::open(root)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS native_usage_replay (session_id TEXT PRIMARY KEY, state TEXT NOT NULL)")
        .map_err(|error| error.to_string())?;
    let stored: Option<String> = db
        .query_row(
            "SELECT state FROM native_usage_replay WHERE session_id=?1",
            [&session.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let mut state: ReplayState = stored
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    loop {
        let page = runtime.events(&session.id, state.sequence, 500)?;
        for event in page.events {
            if let Some(observation) = consume(&mut state, &event, session) {
                record_usage_observation(root, &observation)?;
            }
            state.sequence = event.sequence;
        }
        if !page.has_more {
            break;
        }
    }
    if let Some(turn) = state.turn.as_mut() {
        if turn.status == "in_progress"
            && matches!(
                session.status,
                SessionStatus::Disconnected | SessionStatus::Cancelled | SessionStatus::Failed
            )
        {
            turn.status = match session.status {
                SessionStatus::Cancelled => "cancelled",
                SessionStatus::Failed => "failed",
                _ => "interrupted",
            }
            .into();
            turn.duration_ms = signed(session.updated_at.saturating_sub(turn.started_at_ms));
            let event = AcpEvent {
                session_id: session.id.clone(),
                project_id: session.project_id.clone(),
                agent_id: session.agent_id.clone(),
                model_id: turn.model_id.clone(),
                task_id: session.task_id.clone(),
                turn_id: Some(turn.turn_id.clone()),
                sequence: state.sequence,
                timestamp: session.updated_at,
                kind: "status".into(),
                data: serde_json::Value::Null,
            };
            let mut observation = turn.observation(&event, session);
            observation.observation_sequence = observation
                .observation_sequence
                .map(|value| value.saturating_add(1));
            record_usage_observation(root, &observation)?;
        }
    }
    db.execute("INSERT INTO native_usage_replay VALUES (?1,?2) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state",
        params![session.id, serde_json::to_string(&state).map_err(|error| error.to_string())?])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn replay_all(root: &Path, runtime: &AcpRuntime) -> Result<(), String> {
    let mut after = None;
    loop {
        let sessions = runtime.sessions_page(after.as_deref(), 200)?;
        if sessions.is_empty() {
            break;
        }
        for session in &sessions {
            replay_session(root, runtime, session)?;
        }
        after = sessions.last().map(|session| session.id.clone());
    }
    Ok(())
}

pub fn attach_acp_usage(app: &tauri::AppHandle) -> Result<(), String> {
    let runtime = app
        .try_state::<Arc<AcpRuntime>>()
        .ok_or("The ACP runtime is unavailable.")?
        .inner()
        .clone();
    let root = crate::paths::oleafly_root()?;
    let mut events = runtime.subscribe();
    tauri::async_runtime::spawn(async move {
        replay_work(root.clone(), runtime.clone(), None).await;
        loop {
            match events.recv().await {
                Ok(event)
                    if matches!(
                        event.kind.as_str(),
                        "user_message" | "usage" | "turn_complete" | "status"
                    ) =>
                {
                    replay_work(root.clone(), runtime.clone(), Some(event.session_id)).await
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    replay_work(root.clone(), runtime.clone(), None).await
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    Ok(())
}

async fn replay_work(root: PathBuf, runtime: Arc<AcpRuntime>, session_id: Option<String>) {
    let result = tauri::async_runtime::spawn_blocking(move || {
        if let Some(id) = session_id {
            replay_session(&root, &runtime, &runtime.record(&id)?)
        } else {
            replay_all(&root, &runtime)
        }
    })
    .await;
    if let Err(error) = result
        .map_err(|error| error.to_string())
        .and_then(|result| result)
    {
        crate::logsafe::info(
            "ACP usage persistence",
            serde_json::json!({"error": error}),
            serde_json::Value::Null,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> SessionRecord {
        SessionRecord {
            id: "session".into(),
            project_id: "project".into(),
            project_path: "/project".into(),
            agent_id: "codex".into(),
            agent_version: None,
            native_session_id: None,
            parent_session_id: Some("parent".into()),
            task_id: Some("task".into()),
            title: String::new(),
            status: SessionStatus::Ready,
            created_at: 1000,
            updated_at: 3000,
            turn_id: Some("turn".into()),
            capabilities: Default::default(),
            controls: Default::default(),
            auth_methods: Vec::new(),
            error: None,
            last_sequence: 3,
        }
    }

    fn event(sequence: u64, kind: &str, data: serde_json::Value) -> AcpEvent {
        AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "codex".into(),
            model_id: Some("model".into()),
            task_id: Some("task".into()),
            turn_id: Some("turn".into()),
            sequence,
            timestamp: sequence * 1000,
            kind: kind.into(),
            data,
        }
    }

    #[test]
    fn context_usage_stays_unbilled_and_idle_cleanup_preserves_completed_turn() {
        let session = session();
        let mut state = ReplayState::default();
        consume(
            &mut state,
            &event(1, "user_message", serde_json::json!({})),
            &session,
        )
        .unwrap();
        assert!(consume(
            &mut state,
            &event(
                2,
                "usage",
                serde_json::json!({
                    "source":"acp_context", "contextUsed":90000, "contextSize":100000,
                })
            ),
            &session
        )
        .is_none());
        let measured = consume(
            &mut state,
            &event(
                3,
                "usage",
                serde_json::json!({
                    "source":"acp_prompt", "inputTokens":100, "outputTokens":20,
                }),
            ),
            &session,
        )
        .unwrap();
        assert_eq!(measured.input_tokens, Some(100));
        assert_eq!(measured.cache_read_tokens, None);
        assert_eq!(measured.billing_mode, "unknown");
        assert_eq!(measured.estimated_cost_usd, None);
        let completed = consume(
            &mut state,
            &event(
                4,
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
            &session,
        )
        .unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.duration_ms, Some(3000));
        assert!(consume(
            &mut state,
            &event(5, "status", serde_json::json!({"status":"cancelled"})),
            &session
        )
        .is_none());
        assert_eq!(state.turn.unwrap().status, "completed");
    }

    #[test]
    fn durable_replay_updates_one_usage_record_and_retains_missing_counters() {
        let root = tempfile::tempdir().unwrap();
        let acp_root = root.path().join("acp");
        let runtime = AcpRuntime::new(acp_root.clone()).unwrap();
        let session = session();
        let db = rusqlite::Connection::open(acp_root.join("sessions.sqlite")).unwrap();
        db.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4)",
            params![
                session.id,
                session.project_id,
                session.updated_at,
                serde_json::to_string(&session).unwrap()
            ],
        )
        .unwrap();
        let events = [
            event(1, "user_message", serde_json::json!({})),
            event(
                2,
                "usage",
                serde_json::json!({"source":"acp_prompt","inputTokens":100,"outputTokens":20}),
            ),
            event(
                3,
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
        ];
        for event in events {
            db.execute(
                "INSERT INTO events VALUES (?1,?2,?3)",
                params![
                    event.session_id,
                    event.sequence,
                    serde_json::to_string(&event).unwrap()
                ],
            )
            .unwrap();
        }
        replay_session(root.path(), &runtime, &session).unwrap();
        replay_session(root.path(), &runtime, &session).unwrap();
        let library = crate::library_db::open(root.path()).unwrap();
        let row:(i64,i64,Option<i64>,String) = library.query_row(
            "SELECT COUNT(*), SUM(input_tokens), MAX(cache_read_tokens), MIN(status) FROM usage_records",[],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
        ).unwrap();
        assert_eq!(row, (1, 100, None, "completed".into()));
    }
}
