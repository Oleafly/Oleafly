//! "Refresh plan usage": a hidden turn sends the agent's own `/usage` (or
//! `/status`) command and keeps its answer as the plan summary. None of its
//! messages reach the transcript or the before-turn copies; the session
//! shows as working meanwhile, its permission requests are refused, and a
//! command that starts a tool (one the project defines under that name,
//! which runs the model) is cancelled. Its cost is noted as the agent's
//! latest total, outside any turn, so the next turn is not charged for it.
use oleafly_acp::TurnTiming;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

use super::runtime::AcpRuntime;
use super::types::{
    now_ms, AvailableCommand, SessionSnapshot, SessionStatus, SessionUsage, UsageCounters,
};

const HIDDEN_INACTIVITY: Duration = Duration::from_secs(60);
const HIDDEN_ABSOLUTE: Duration = Duration::from_secs(90);

/// The command that reports plan usage: `usage`, else `status`. A command
/// the agent marks as the project's or the user's own is a prompt, not a
/// report, and is never used.
fn usage_command(commands: &[AvailableCommand]) -> Option<&'static str> {
    ["usage", "status"].into_iter().find(|name| {
        commands.iter().any(|command| {
            let description = command.description.to_ascii_lowercase();
            command.name == *name
                && !description.ends_with("(project)")
                && !description.ends_with("(user)")
        })
    })
}

impl AcpRuntime {
    pub async fn refresh_plan_usage(self: &Arc<Self>, id: &str) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "Wait for this turn to finish before refreshing plan usage.")?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::Ready {
            return Err("Connect and sign in to this agent first.".into());
        }
        let command = usage_command(&record.available_commands)
            .ok_or("This agent does not report plan usage.")?;
        let native = record
            .native_session_id
            .clone()
            .ok_or("The ACP session is not ready.")?;
        // The hidden turn's events belong to no turn: the last turn keeps
        // its id once it ends.
        let last_turn = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.hidden = Some(String::new());
            state.hidden_tools = false;
            state.record.status = SessionStatus::Running;
            state.turn_closed = false;
            let last_turn = state.record.turn_id.take();
            if let Err(error) =
                self.emit_locked(&session, &mut state, "status", json!({"status": "running"}))
            {
                state.hidden = None;
                state.record.status = SessionStatus::Ready;
                state.record.turn_id = last_turn;
                return Err(error);
            }
            last_turn
        };
        // Running out of time ends the refresh, not the agent.
        let result = session
            .client
            .prompt_or_cancel(
                &native,
                vec![json!({"type": "text", "text": format!("/{command}")})],
                TurnTiming {
                    inactivity: Some(HIDDEN_INACTIVITY),
                    absolute: Some(HIDDEN_ABSOLUTE),
                    hold: None,
                },
            )
            .await;
        self.expire_permissions(&session).await;
        let closed = session.client.is_closed();
        let ran_tools = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let text = state.hidden.take().unwrap_or_default();
            let ran_tools = std::mem::take(&mut state.hidden_tools);
            state.record.status = if closed {
                SessionStatus::Disconnected
            } else {
                SessionStatus::Ready
            };
            let finished =
                self.finish_hidden(&session, &mut state, result.is_ok() && !ran_tools, &text);
            if !closed {
                let _ =
                    self.emit_locked(&session, &mut state, "status", json!({"status": "ready"}));
            }
            state.record.turn_id = last_turn;
            finished?;
            ran_tools
        };
        if ran_tools {
            return Err(format!(
                "The agent's /{command} command is not a usage report: it started a tool, so Oleafly stopped it."
            ));
        }
        if let Err(error) = result {
            if closed {
                session.client.shutdown().await;
                self.release_live(&session).await;
            }
            return Err(session.redactor.text(&format!(
                "The agent did not report its plan usage. {}",
                error.message
            )));
        }
        self.snapshot(id).await
    }

    /// Stores what the hidden turn brought: the plan summary when it
    /// answered, and the agent's counters (its cumulative cost included, so
    /// the usage ledger charges the next turn only for that turn).
    fn finish_hidden(
        &self,
        session: &super::runtime::LiveSession,
        state: &mut super::runtime::LiveState,
        answered: bool,
        text: &str,
    ) -> Result<(), String> {
        if answered {
            let markdown = session.redactor.text(text);
            let usage = state.record.usage.get_or_insert_with(SessionUsage::default);
            usage.set_plan_markdown(&markdown, now_ms());
            let counters = UsageCounters {
                context_used: usage.context_used,
                context_size: usage.context_size,
                session: Some(usage.clone()),
                source: "acp_plan".into(),
                ..UsageCounters::default()
            };
            let data = serde_json::to_value(counters).map_err(|e| e.to_string())?;
            self.emit_locked(session, state, "usage", data)?;
        }
        if let Some(usage) = &state.record.usage {
            let counters = UsageCounters {
                context_used: usage.context_used,
                context_size: usage.context_size,
                cost_amount: usage.cost_amount,
                cost_currency: usage.cost_currency.clone(),
                session: Some(usage.without_plan()),
                source: "acp_context".into(),
                ..UsageCounters::default()
            };
            let data = serde_json::to_value(counters).map_err(|e| e.to_string())?;
            self.emit_locked(session, state, "usage", data)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(name: &str, description: &str) -> AvailableCommand {
        AvailableCommand {
            name: name.into(),
            description: description.into(),
            hint: None,
        }
    }

    #[test]
    fn a_projects_own_status_prompt_is_not_a_usage_report() {
        assert_eq!(
            usage_command(&[command("status", "Show account status")]),
            Some("status")
        );
        assert_eq!(
            usage_command(&[
                command("status", "Summarize progress and update NOTES.md (project)"),
                command("usage", "Track my usage (user)"),
            ]),
            None
        );
        assert_eq!(
            usage_command(&[
                command("usage", "Show plan usage"),
                command("status", "Show status")
            ]),
            Some("usage")
        );
    }
}
