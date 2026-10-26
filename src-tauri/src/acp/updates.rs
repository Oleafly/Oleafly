//! What an agent sends as `session/update`: streamed output (text is
//! coalesced before it is stored), controls, usage, slash commands, titles,
//! notices and compaction summaries. Output kinds are kept only during a
//! turn; the rest are kept at any time.
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::coalesce::{chunk_text, Pushed};
use super::permission_view;
use super::redact::Redactor;
use super::runtime::{AcpRuntime, LiveSession, LiveState};
use super::types::{now_ms, AvailableCommand, SessionStatus, SessionUsage, UsageCounters};

const MAX_COMMANDS: usize = 128;
const MAX_HIDDEN_TEXT: usize = 64 * 1024;
const MAX_SUMMARY: usize = 64 * 1024;
const MAX_COMPACTIONS: usize = 8;
const MAX_TITLE: usize = 80;
const MAX_SYSTEM_ERROR: usize = 16 * 1024;
const FLUSH_TICK: Duration = Duration::from_millis(100);

/// A compaction the agent is reporting, merged from its updates.
#[derive(Clone, Debug, Default)]
pub(super) struct Compaction {
    status: String,
    summary: String,
    error: Option<String>,
}

fn bounded(text: &str, limit: usize) -> String {
    text.chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(limit)
        .collect()
}

/// The agent's slash commands: at most 128; names of `[A-Za-z0-9:_./-]`,
/// at most 64 characters; descriptions and hints redacted and cut.
pub(super) fn parse_commands(value: &Value, redactor: &Redactor) -> Vec<AvailableCommand> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item["name"].as_str()?.trim().trim_start_matches('/');
                    if name.is_empty()
                        || name.len() > 64
                        || !name
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || ":_./-".contains(c))
                    {
                        return None;
                    }
                    Some(AvailableCommand {
                        name: name.to_owned(),
                        description: bounded(
                            &redactor.text(item["description"].as_str().unwrap_or("")),
                            300,
                        ),
                        hint: item["input"]["hint"]
                            .as_str()
                            .map(|hint| bounded(&redactor.text(hint), 120)),
                    })
                })
                .take(MAX_COMMANDS)
                .collect()
        })
        .unwrap_or_default()
}

/// A notice: severity info, warning or error; title and description cut.
pub(super) fn parse_notice(update: &Value, redactor: &Redactor) -> Value {
    let severity = update["severity"]
        .as_str()
        .filter(|level| matches!(*level, "info" | "warning" | "error"))
        .unwrap_or("info");
    let description = update["description"]
        .as_str()
        .or(update["message"].as_str())
        .unwrap_or("");
    json!({
        "severity": severity,
        "title": bounded(&redactor.text(update["title"].as_str().unwrap_or("")), 200),
        "description": bounded(&redactor.text(description), 2000),
    })
}

fn block_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block["text"].as_str().or(block["content"]["text"].as_str()))
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(_) => value["text"].as_str().unwrap_or("").to_owned(),
        _ => String::new(),
    }
}

/// Whether an update still applies while a loading session replays history
/// that is already stored: only the agent's state (options, usage,
/// commands).
fn applies_while_replaying(kind: &str) -> bool {
    matches!(
        kind,
        "config_option_update"
            | "config_options_update"
            | "current_model_update"
            | "current_mode_update"
            | "usage_update"
            | "available_commands_update"
    )
}

/// An update for a session other than the live one: ignored when the live
/// session is forking or resuming or the id is one it set aside (a fork, or
/// a session the agent opened in place of the resumed one), an error
/// otherwise.
fn foreign_update(session: &LiveSession, native: Option<&str>) -> Result<(), String> {
    let forked = session.forking.load(Ordering::Acquire)
        || session.resuming.load(Ordering::Acquire)
        || native.is_some_and(|id| {
            session
                .known_foreign
                .lock()
                .is_ok_and(|ids| ids.contains(id))
        });
    if forked {
        return Ok(());
    }
    Err("The agent sent an update for another session.".into())
}

impl AcpRuntime {
    /// A `session/update` from the agent, in wire order.
    pub(super) fn handle_update(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        params: &Value,
    ) -> Result<(), String> {
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        if state.record.native_session_id.is_none() {
            // `session/new` answered, but its id is not recorded yet.
            if state.early.len() < 64 {
                state.early.push(params.clone());
            }
            return Ok(());
        }
        let native = params["sessionId"].as_str();
        if native != state.record.native_session_id.as_deref() {
            return foreign_update(session, native);
        }
        let update = &params["update"];
        let kind = update["sessionUpdate"]
            .as_str()
            .ok_or("The agent update has no type.")?;
        // A loading session replays history that is already stored; only
        // the agent's state (options, usage, commands) still applies.
        if state.replaying && !applies_while_replaying(kind) {
            return Ok(());
        }
        // During a hidden plan-usage turn the agent's controls and commands
        // still apply (the mode guard included); its output stays hidden.
        if state.hidden.is_some() && !Self::kept_while_hidden(kind) {
            Self::hidden_update(session, &mut state, kind, update);
            return Ok(());
        }
        match kind {
            "config_option_update"
            | "config_options_update"
            | "current_model_update"
            | "current_mode_update" => self.controls_update(session, &mut state, update)?,
            "usage_update" => self.usage_update(session, &mut state, update)?,
            "available_commands_update" => {
                let commands = parse_commands(&update["availableCommands"], &session.redactor);
                state.record.available_commands = commands.clone();
                self.emit_locked(
                    session,
                    &mut state,
                    "available_commands",
                    json!({"commands": commands}),
                )?;
            }
            "session_info_update" => self.session_info_update(session, &mut state, update)?,
            "notice" => {
                let notice = parse_notice(update, &session.redactor);
                self.emit_locked(session, &mut state, "notice", notice)?;
            }
            "compaction_update" | "compaction_summary_chunk" => {
                self.compaction(session, &mut state, kind, update)?;
            }
            "agent_message_chunk"
            | "agent_thought_chunk"
            | "tool_call"
            | "tool_call_update"
            | "plan" => self.agent_output(session, &mut state, kind, update)?,
            _ => {}
        }
        Ok(())
    }

    /// The agent changed its options, model or mode.
    fn controls_update(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        state: &mut LiveState,
        update: &Value,
    ) -> Result<(), String> {
        session.redactor.validate_metadata_ids(update)?;
        state
            .record
            .controls
            .apply_update(&session.redactor.value(update));
        let controls = serde_json::to_value(&state.record.controls).map_err(|e| e.to_string())?;
        let blocked = !state.replaying && state.record.controls.blocked_mode(None).is_some();
        self.emit_locked(session, state, "controls", json!({"controls": controls}))?;
        // The agent went into a mode with permission checks off.
        if blocked {
            let (runtime, session) = (self.clone(), session.clone());
            tokio::spawn(async move { runtime.leave_blocked_mode(&session).await });
        }
        Ok(())
    }

    /// The agent reported its context and cost counters.
    fn usage_update(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        update: &Value,
    ) -> Result<(), String> {
        let counters = {
            let usage = state.record.usage.get_or_insert_with(SessionUsage::default);
            usage.apply_usage_update(update, now_ms());
            usage.redact(&session.redactor);
            UsageCounters {
                context_used: usage.context_used,
                context_size: usage.context_size,
                cost_amount: usage.cost_amount,
                cost_currency: usage.cost_currency.clone(),
                session: Some(usage.without_plan()),
                source: "acp_context".into(),
                ..UsageCounters::default()
            }
        };
        self.emit_locked(
            session,
            state,
            "usage",
            serde_json::to_value(counters).map_err(|e| e.to_string())?,
        )
    }

    /// The agent named the session; a title the user set stays.
    fn session_info_update(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        update: &Value,
    ) -> Result<(), String> {
        let running = !state.turn_closed
            && matches!(
                state.record.status,
                SessionStatus::Running | SessionStatus::Cancelling
            );
        if running && update["_meta"]["codex"]["threadStatus"]["type"] == "systemError" {
            state.system_error.get_or_insert_with(String::new);
        }
        let title = update["title"]
            .as_str()
            .map(str::trim)
            .filter(|title| !title.is_empty());
        let Some(title) = title else {
            return Ok(());
        };
        if state.record.title_locked {
            return Ok(());
        }
        let title: String = bounded(&session.redactor.text(title), MAX_TITLE);
        state.record.title = title.clone();
        state.default_title = false;
        self.emit_locked(session, state, "session_info", json!({"title": title}))
    }

    /// Streamed output, tool calls and plans: kept only during a turn.
    fn agent_output(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        state: &mut LiveState,
        kind: &str,
        update: &Value,
    ) -> Result<(), String> {
        // Outside a turn, or after the agent ended it: the status
        // only changes once the turn task runs, which can be after
        // the agent's next updates arrive.
        if state.turn_closed
            || !matches!(
                state.record.status,
                SessionStatus::Running | SessionStatus::Cancelling
            )
        {
            return Ok(());
        }
        state.turn_output = true;
        if kind == "agent_message_chunk" {
            if let (Some(text), Some(held)) = (chunk_text(update), state.system_error.as_mut()) {
                if held.len() + text.len() <= MAX_SYSTEM_ERROR {
                    held.push_str(text);
                }
                return Ok(());
            }
        }
        if matches!(kind, "agent_message_chunk" | "agent_thought_chunk") {
            if let Some(text) = chunk_text(update) {
                return self.hold_chunk(session, state, kind, update, text);
            }
        }
        if matches!(kind, "tool_call" | "tool_call_update") {
            permission_view::track(&mut state.tool_calls, update);
        }
        self.emit_locked(session, state, kind, update.clone())
    }

    /// Holds a text chunk for coalescing; held text of another message is
    /// stored, and the rest is stored once it is due.
    fn hold_chunk(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        state: &mut LiveState,
        kind: &str,
        update: &Value,
        text: &str,
    ) -> Result<(), String> {
        let turn = state.record.turn_id.clone();
        let now = Instant::now();
        let pushed = state.coalescer.push(
            kind,
            turn.as_deref(),
            update["messageId"].as_str(),
            text,
            now,
        );
        if let Pushed::Flush(previous) = pushed {
            let previous_kind = previous["sessionUpdate"]
                .as_str()
                .unwrap_or("agent_message_chunk")
                .to_owned();
            self.store_event(session, state, &previous_kind, previous)?;
        }
        if state.coalescer.due(now) {
            self.flush_due(session, state)?;
        } else if !state.flush_timer && !state.coalescer.only_carry() {
            state.flush_timer = true;
            self.schedule_flush(session);
        }
        Ok(())
    }

    /// Stores held text once it is 100 ms old, while nothing else arrives.
    fn schedule_flush(self: &Arc<Self>, session: &Arc<LiveSession>) {
        let runtime = Arc::downgrade(self);
        let session = Arc::downgrade(session);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(FLUSH_TICK).await;
                let (Some(runtime), Some(session)) = (runtime.upgrade(), session.upgrade()) else {
                    return;
                };
                let Ok(mut state) = session.state.lock() else {
                    return;
                };
                // Text held back by a due flush waits for the message's next
                // text or its end, which store it.
                if !state.coalescer.is_holding() || state.coalescer.only_carry() {
                    state.flush_timer = false;
                    return;
                }
                if state.coalescer.due(Instant::now()) {
                    let _ = runtime.flush_due(&session, &mut state);
                    state.flush_timer = false;
                    return;
                }
            }
        });
    }

    /// Updates handled as usual during a hidden plan-usage turn.
    fn kept_while_hidden(kind: &str) -> bool {
        matches!(
            kind,
            "config_option_update"
                | "config_options_update"
                | "current_model_update"
                | "current_mode_update"
                | "available_commands_update"
        )
    }

    /// During a hidden plan-usage turn only the answer text and usage count.
    /// A tool call means the command runs the model (a prompt command the
    /// project defines under that name): the turn is cancelled.
    fn hidden_update(session: &LiveSession, state: &mut LiveState, kind: &str, update: &Value) {
        match kind {
            "tool_call" | "tool_call_update" if !state.hidden_tools => {
                state.hidden_tools = true;
                if let Some(native) = state.record.native_session_id.as_deref() {
                    let _ = session.client.cancel(native);
                }
            }
            "agent_message_chunk" if !state.turn_closed => {
                if let (Some(text), Some(buffer)) = (chunk_text(update), state.hidden.as_mut()) {
                    if buffer.len() + text.len() <= MAX_HIDDEN_TEXT {
                        buffer.push_str(text);
                    }
                }
            }
            "usage_update" => {
                let usage = state.record.usage.get_or_insert_with(SessionUsage::default);
                usage.apply_usage_update(update, now_ms());
                usage.redact(&session.redactor);
            }
            _ => {}
        }
    }

    fn compaction(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        kind: &str,
        update: &Value,
    ) -> Result<(), String> {
        let Some(id) = update["compactionId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .map(str::to_owned)
        else {
            return Ok(());
        };
        if !state.compactions.contains_key(&id) && state.compactions.len() >= MAX_COMPACTIONS {
            state.compactions.clear();
        }
        let entry = state.compactions.entry(id.clone()).or_default();
        if kind == "compaction_summary_chunk" {
            let text = block_text(&update["content"]);
            if entry.summary.len() + text.len() <= MAX_SUMMARY {
                entry.summary.push_str(&text);
            }
            return Ok(());
        }
        match update.get("status") {
            Some(Value::String(status)) => entry.status = bounded(status, 32),
            Some(Value::Null) => entry.status.clear(),
            _ => {}
        }
        match update.get("summary") {
            Some(Value::Null) => entry.summary.clear(),
            Some(Value::Array(blocks)) if blocks.is_empty() => entry.summary.clear(),
            Some(value @ (Value::String(_) | Value::Array(_) | Value::Object(_))) => {
                entry.summary = block_text(value).chars().take(MAX_SUMMARY).collect();
            }
            _ => {}
        }
        match update.get("error") {
            Some(Value::Null) => entry.error = None,
            Some(Value::String(error)) => entry.error = Some(bounded(error, 2000)),
            Some(value @ Value::Object(_)) => {
                entry.error = value["message"].as_str().map(|error| bounded(error, 2000));
            }
            _ => {}
        }
        let data = json!({
            "compactionId": id,
            "status": entry.status,
            "summary": session.redactor.text(&entry.summary),
            "error": entry.error.as_deref().map(|error| session.redactor.text(error)),
        });
        if matches!(entry.status.as_str(), "completed" | "failed" | "cancelled") {
            state.compactions.remove(&id);
        }
        self.emit_locked(session, state, "compaction", data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_bounded_and_cleaned() {
        let redactor = Redactor::new(&[]);
        let commands = parse_commands(
            &json!([
                {"name": "/review", "description": "Review the diff", "input": {"hint": "file"}},
                {"name": "bad name", "description": "x"},
                {"name": "x".repeat(65), "description": "x"},
                {"name": "plugin:run", "description": "d".repeat(400)},
            ]),
            &redactor,
        );
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0].name, "review");
        assert_eq!(commands[0].hint.as_deref(), Some("file"));
        assert_eq!(commands[1].description.len(), 300);
    }

    #[test]
    fn notices_keep_known_severities_and_cut_text() {
        let redactor = Redactor::new(&[]);
        let notice = parse_notice(
            &json!({"severity": "fatal", "title": "Rate limited", "description": "d".repeat(5000)}),
            &redactor,
        );
        assert_eq!(notice["severity"], "info");
        assert_eq!(notice["description"].as_str().unwrap().len(), 2000);
    }
}
