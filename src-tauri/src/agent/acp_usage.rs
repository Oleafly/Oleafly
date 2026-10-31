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
    #[serde(default)]
    last_cost: Option<f64>,
}

const AGENT_REPORTED: &str = "acp-agent-reported";

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
    #[serde(default)]
    cost_at_start: Option<f64>,
    #[serde(default)]
    cost_latest: Option<f64>,
    #[serde(default)]
    cost_currency: Option<String>,
}

fn billing(session: &SessionRecord) -> &'static str {
    if session.routed_provider.is_some() {
        return "api";
    }
    match session
        .usage
        .as_ref()
        .and_then(|usage| usage.auth.as_ref())
        .map(|auth| auth.kind.as_str())
    {
        Some("api_key" | "gateway") => "api",
        Some("account") => "subscription",
        _ => "unknown",
    }
}

impl TurnUsage {
    fn new(event: &AcpEvent, turn_id: String, cost_at_start: Option<f64>) -> Self {
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
            cost_at_start,
            cost_latest: None,
            cost_currency: None,
        }
    }

    fn estimated_cost(&self, billing: &str) -> Option<f64> {
        let latest = self.cost_latest?;
        if billing != "api" || self.cost_currency.as_deref().unwrap_or("USD") != "USD" {
            return None;
        }
        Some((latest - self.cost_at_start.unwrap_or(0.0)).max(0.0))
    }

    fn observation(&self, event: &AcpEvent, session: &SessionRecord) -> UsageEventInput {
        let billing = billing(session);
        let estimated_cost_usd = self.estimated_cost(billing);
        UsageEventInput {
            event_id: format!("{}:{}", event.session_id, event.sequence),
            source_id: format!("acp:{}", event.session_id),
            source_turn_id: self.turn_id.clone(),
            project_id: event.project_id.clone(),
            task_id: event.task_id.clone(),
            session_id: event.session_id.clone(),
            parent_session_id: session.parent_session_id.clone(),
            parent_record_key: None,
            runtime_id: acp_runtime_id(&event.agent_id),
            provider_id: session
                .routed_provider
                .clone()
                .or_else(|| acp_provider_id(&event.agent_id)),
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
            billing_mode: billing.into(),
            estimated_cost_usd,
            price_version: estimated_cost_usd.map(|_| AGENT_REPORTED.to_string()),
            duration_ms: Some(self.duration_ms),
            status: self.status.clone(),
            aggregation_scope: "self".into(),
        }
    }
}

fn signed(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

pub const ACP_RUNTIME: &str = "acp";

pub fn acp_runtime_id(agent_id: &str) -> String {
    let agent = agent_id.trim();
    if agent.is_empty() {
        ACP_RUNTIME.into()
    } else {
        format!("{ACP_RUNTIME}:{agent}")
    }
}

fn acp_provider_id(agent_id: &str) -> Option<String> {
    let agent = agent_id.trim();
    (!agent.is_empty()).then(|| agent.to_string())
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
    let reported_cost = (event.kind == "usage" && event.data["source"] == "acp_context")
        .then(|| event.data["costAmount"].as_f64())
        .flatten()
        .filter(|cost| cost.is_finite() && *cost >= 0.0);
    let Some(turn_id) = event.turn_id.as_ref() else {
        if let Some(cost) = reported_cost {
            state.last_cost = Some(cost);
        }
        return None;
    };
    if state
        .turn
        .as_ref()
        .is_none_or(|turn| &turn.turn_id != turn_id)
    {
        state.turn = Some(TurnUsage::new(event, turn_id.clone(), state.last_cost));
    }
    if let Some(cost) = reported_cost {
        if state.last_cost.is_some_and(|last| cost < last) {
            if let Some(turn) = state.turn.as_mut() {
                turn.cost_at_start = Some(0.0);
            }
        }
        state.last_cost = Some(cost);
    }
    let turn = state.turn.as_mut()?;
    turn.model_id = event.model_id.clone().or_else(|| turn.model_id.clone());
    let mut changed = false;
    match event.kind.as_str() {
        "user_message" => changed = true,
        "usage" if reported_cost.is_some() => {
            turn.cost_latest = reported_cost;
            turn.cost_currency = event.data["costCurrency"].as_str().map(str::to_owned);
            changed = true;
        }
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

fn open_replay_db(root: &Path) -> Result<rusqlite::Connection, String> {
    let db = crate::library_db::open(root)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS native_usage_replay (session_id TEXT PRIMARY KEY, state TEXT NOT NULL)")
        .map_err(|error| error.to_string())?;
    Ok(db)
}

fn replay_session(
    root: &Path,
    runtime: &AcpRuntime,
    session: &SessionRecord,
) -> Result<(), String> {
    replay_session_in(&open_replay_db(root)?, root, runtime, session)
}

fn replay_session_in(
    db: &rusqlite::Connection,
    root: &Path,
    runtime: &AcpRuntime,
    session: &SessionRecord,
) -> Result<(), String> {
    let stored: Option<String> = db
        .query_row(
            "SELECT state FROM native_usage_replay WHERE session_id=?1",
            [&session.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let mut state: ReplayState = stored
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let inherited = session.fork_sequence.unwrap_or(0);
    loop {
        let page = runtime.events(&session.id, state.sequence, 500)?;
        for event in page.events {
            if let Some(observation) = consume(&mut state, &event, session) {
                if event.sequence > inherited {
                    record_usage_observation(root, &observation)?;
                }
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
                owner: None,
            };
            let mut observation = turn.observation(&event, session);
            observation.observation_sequence = observation
                .observation_sequence
                .map(|value| value.saturating_add(1));
            if state.sequence > inherited {
                record_usage_observation(root, &observation)?;
            }
        }
    }
    let state = serde_json::to_string(&state).map_err(|error| error.to_string())?;
    if stored.as_deref() != Some(state.as_str()) {
        db.execute("INSERT INTO native_usage_replay VALUES (?1,?2) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state",
            params![session.id, state])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn replay_all(root: &Path, runtime: &AcpRuntime) -> Result<(), String> {
    let db = open_replay_db(root)?;
    let mut seen = std::collections::HashSet::new();
    let mut failure: Option<String> = None;
    let mut after = None;
    loop {
        let sessions = runtime.sessions_page(after.as_deref(), 200)?;
        if sessions.is_empty() {
            break;
        }
        for session in &sessions {
            seen.insert(session.id.clone());
            if let Err(error) = replay_session_in(&db, root, runtime, session) {
                failure.get_or_insert(format!("{}: {error}", session.id));
            }
        }
        after = sessions.last().map(|session| session.id.clone());
    }
    forget_deleted_sessions(&db, &seen)?;
    failure.map_or(Ok(()), Err)
}

fn forget_deleted_sessions(
    db: &rusqlite::Connection,
    existing: &std::collections::HashSet<String>,
) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT session_id FROM native_usage_replay")
        .map_err(|error| error.to_string())?;
    let stale = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|id| !existing.contains(id))
        .collect::<Vec<_>>();
    drop(statement);
    for id in stale {
        db.execute("DELETE FROM native_usage_replay WHERE session_id=?1", [id])
            .map_err(|error| error.to_string())?;
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
            parent_session_id: Some("parent".into()),
            task_id: Some("task".into()),
            status: SessionStatus::Ready,
            created_at: 1000,
            updated_at: 3000,
            turn_id: Some("turn".into()),
            last_sequence: 3,
            ..SessionRecord::default()
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
            owner: None,
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
        assert_eq!(measured.runtime_id, "acp:codex");
        assert_eq!(measured.provider_id.as_deref(), Some("codex"));
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
            "INSERT INTO sessions (id, project_id, updated_at, record) VALUES (?1,?2,?3,?4)",
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
        let row:(i64,i64,Option<i64>,String,String) = library.query_row(
            "SELECT COUNT(*), SUM(input_tokens), MAX(cache_read_tokens), MIN(status), MIN(runtime_id) FROM usage_records",[],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
        ).unwrap();
        assert_eq!(row, (1, 100, None, "completed".into(), "acp:codex".into()));
    }

    fn store_session(
        root: &Path,
        session: &SessionRecord,
        events: &[(u64, &str, &str, serde_json::Value)],
    ) -> Arc<AcpRuntime> {
        let acp_root = root.join("acp");
        let runtime = AcpRuntime::new(acp_root.clone()).unwrap();
        let db = rusqlite::Connection::open(acp_root.join("sessions.sqlite")).unwrap();
        db.execute(
            "INSERT INTO sessions (id, project_id, updated_at, record) VALUES (?1,?2,?3,?4)",
            params![
                session.id,
                session.project_id,
                session.updated_at,
                serde_json::to_string(session).unwrap()
            ],
        )
        .unwrap();
        for (sequence, turn, kind, data) in events {
            let mut event = AcpEvent {
                session_id: session.id.clone(),
                ..event(*sequence, kind, data.clone())
            };
            event.turn_id = Some((*turn).into());
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
        runtime
    }

    fn turn_events() -> Vec<(u64, &'static str, &'static str, serde_json::Value)> {
        vec![
            (1, "t1", "user_message", serde_json::json!({})),
            (
                2,
                "t1",
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
            (3, "t2", "user_message", serde_json::json!({})),
            (
                4,
                "t2",
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
        ]
    }

    fn recorded_turns(root: &Path) -> Vec<String> {
        let library = crate::library_db::open(root).unwrap();
        let mut statement = library
            .prepare("SELECT source_turn_id FROM usage_records ORDER BY source_turn_id")
            .unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn a_fork_records_only_the_turns_after_the_fork_point() {
        let root = tempfile::tempdir().unwrap();
        let mut fork = session();
        fork.fork_sequence = Some(2);
        let runtime = store_session(root.path(), &fork, &turn_events());
        replay_session(root.path(), &runtime, &fork).unwrap();
        assert_eq!(recorded_turns(root.path()), ["t2"]);

        let other = tempfile::tempdir().unwrap();
        let plain = session();
        let runtime = store_session(other.path(), &plain, &turn_events());
        replay_session(other.path(), &runtime, &plain).unwrap();
        assert_eq!(recorded_turns(other.path()), ["t1", "t2"]);
    }

    #[test]
    fn a_fork_keeps_the_cost_of_the_turns_it_inherited() {
        let root = tempfile::tempdir().unwrap();
        let mut fork = api_session();
        fork.fork_sequence = Some(2);
        let events = vec![
            (
                1,
                "t1",
                "usage",
                serde_json::json!({"source":"acp_context","costAmount":0.40,"costCurrency":"USD"}),
            ),
            (
                2,
                "t1",
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
            (
                3,
                "t2",
                "usage",
                serde_json::json!({"source":"acp_context","costAmount":0.55,"costCurrency":"USD"}),
            ),
            (
                4,
                "t2",
                "turn_complete",
                serde_json::json!({"stopReason":"end_turn"}),
            ),
        ];
        let runtime = store_session(root.path(), &fork, &events);
        replay_session(root.path(), &runtime, &fork).unwrap();
        let library = crate::library_db::open(root.path()).unwrap();
        let cost: f64 = library
            .query_row(
                "SELECT SUM(estimated_cost_usd) FROM usage_records",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            (cost - 0.15).abs() < 1e-9,
            "only the new turn's cost: {cost}"
        );
    }

    fn turn_cost_event(sequence: u64, turn: Option<&str>, cost: f64) -> AcpEvent {
        let mut event = event(
            sequence,
            "usage",
            serde_json::json!({"source":"acp_context","costAmount":cost,"costCurrency":"USD"}),
        );
        event.turn_id = turn.map(Into::into);
        event
    }

    #[test]
    fn a_cost_total_that_starts_again_charges_the_turn_all_of_it() {
        let session = api_session();
        let mut state = ReplayState::default();
        consume(&mut state, &turn_cost_event(1, Some("t1"), 2.40), &session).unwrap();
        let next = consume(&mut state, &turn_cost_event(2, Some("t2"), 0.30), &session).unwrap();
        assert!(
            (next.estimated_cost_usd.unwrap() - 0.30).abs() < 1e-9,
            "{:?}",
            next.estimated_cost_usd
        );
    }

    #[test]
    fn a_plan_usage_refresh_is_not_charged_to_the_next_turn() {
        let session = api_session();
        let mut state = ReplayState::default();
        consume(&mut state, &turn_cost_event(1, Some("t1"), 1.00), &session).unwrap();
        assert!(consume(&mut state, &turn_cost_event(2, None, 1.04), &session).is_none());
        let next = consume(&mut state, &turn_cost_event(3, Some("t2"), 1.10), &session).unwrap();
        assert!(
            (next.estimated_cost_usd.unwrap() - 0.06).abs() < 1e-9,
            "{:?}",
            next.estimated_cost_usd
        );
    }

    #[test]
    fn a_session_that_fails_does_not_stop_the_ones_after_it() {
        let root = tempfile::tempdir().unwrap();
        let mut broken = session();
        broken.id = "a-broken".into();
        let mut healthy = session();
        healthy.id = "b-healthy".into();
        let runtime = store_session(root.path(), &broken, &turn_events());
        let acp_root = root.path().join("acp");
        {
            let db = rusqlite::Connection::open(acp_root.join("sessions.sqlite")).unwrap();
            db.execute(
                "UPDATE events SET event='{not json' WHERE session_id='a-broken' AND sequence=2",
                [],
            )
            .unwrap();
            db.execute(
                "INSERT INTO sessions (id, project_id, updated_at, record) VALUES (?1,?2,?3,?4)",
                params![
                    healthy.id,
                    healthy.project_id,
                    healthy.updated_at,
                    serde_json::to_string(&healthy).unwrap()
                ],
            )
            .unwrap();
            for (sequence, turn, kind, data) in turn_events() {
                let mut event = AcpEvent {
                    session_id: healthy.id.clone(),
                    ..event(sequence, kind, data)
                };
                event.turn_id = Some(turn.into());
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
        }
        let error = replay_all(root.path(), &runtime).unwrap_err();
        assert!(error.starts_with("a-broken"), "{error}");
        let library = crate::library_db::open(root.path()).unwrap();
        let healthy_rows: i64 = library
            .query_row(
                "SELECT COUNT(*) FROM usage_records WHERE session_id='b-healthy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(healthy_rows, 2);
    }

    #[test]
    fn replay_rows_of_deleted_sessions_are_dropped_and_unchanged_ones_are_not_rewritten() {
        let root = tempfile::tempdir().unwrap();
        let live = session();
        let runtime = store_session(root.path(), &live, &turn_events());
        replay_all(root.path(), &runtime).unwrap();
        let library = crate::library_db::open(root.path()).unwrap();
        library
            .execute(
                "INSERT INTO native_usage_replay VALUES ('deleted-session', '{\"sequence\":9}')",
                [],
            )
            .unwrap();
        library
            .execute(
                "CREATE TRIGGER no_rewrite BEFORE UPDATE ON native_usage_replay
                 WHEN OLD.session_id = 'session' BEGIN SELECT RAISE(ABORT, 'rewritten'); END",
                [],
            )
            .unwrap();
        drop(library);
        replay_all(root.path(), &runtime).unwrap();
        let library = crate::library_db::open(root.path()).unwrap();
        let rows: Vec<String> = library
            .prepare("SELECT session_id FROM native_usage_replay")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows, ["session"]);
    }

    fn cost_event(sequence: u64, turn: &str, amount: f64) -> AcpEvent {
        let mut event = event(
            sequence,
            "usage",
            serde_json::json!({"source": "acp_context", "costAmount": amount, "costCurrency": "USD"}),
        );
        event.turn_id = Some(turn.into());
        event
    }

    fn api_session() -> SessionRecord {
        let mut session = session();
        session.usage = Some(crate::acp::SessionUsage {
            auth: Some(oleafly_acp::usage::AuthStatus {
                kind: "api_key".into(),
                label: "API key".into(),
                ..Default::default()
            }),
            ..Default::default()
        });
        session
    }

    #[test]
    fn acp_turn_cost_comes_from_the_agent_cumulative_cost() {
        let session = api_session();
        let mut state = ReplayState::default();
        let first = consume(&mut state, &cost_event(1, "t1", 0.10), &session).unwrap();
        assert_eq!(first.estimated_cost_usd, Some(0.10));
        let second = consume(&mut state, &cost_event(2, "t2", 0.25), &session).unwrap();
        assert!((second.estimated_cost_usd.unwrap() - 0.15).abs() < 1e-9);
        assert_eq!(second.price_version.as_deref(), Some("acp-agent-reported"));
        assert_eq!(second.billing_mode, "api");
    }

    #[test]
    fn subscription_sessions_record_no_cost() {
        let mut session = api_session();
        session.usage.as_mut().unwrap().auth.as_mut().unwrap().kind = "account".into();
        let mut state = ReplayState::default();
        let observed = consume(&mut state, &cost_event(1, "t1", 0.30), &session).unwrap();
        assert_eq!(observed.billing_mode, "subscription");
        assert_eq!(observed.estimated_cost_usd, None);
    }

    #[test]
    fn plan_probe_usage_never_reaches_the_ledger() {
        let session = api_session();
        let mut state = ReplayState::default();
        let mut probe = event(
            1,
            "usage",
            serde_json::json!({"source": "acp_plan", "costAmount": 9.0}),
        );
        probe.turn_id = Some("t1".into());
        assert!(consume(&mut state, &probe, &session).is_none());
        assert_eq!(state.last_cost, None);
    }

    #[test]
    fn routed_sessions_record_api_billing_in_the_ledger() {
        let mut session = session();
        session.routed_provider = Some("anthropic".into());
        let mut state = ReplayState::default();
        let observed = consume(
            &mut state,
            &event(
                1,
                "usage",
                serde_json::json!({"source": "acp_prompt", "inputTokens": 5}),
            ),
            &session,
        )
        .unwrap();
        assert_eq!(observed.billing_mode, "api");
        assert_eq!(observed.provider_id.as_deref(), Some("anthropic"));
    }

    #[test]
    fn acp_runtime_ids_carry_the_agent_and_fall_back_to_the_family() {
        assert_eq!(acp_runtime_id("claude"), "acp:claude");
        assert_eq!(acp_runtime_id("  "), "acp");
        assert_eq!(acp_provider_id(""), None);
    }
}
