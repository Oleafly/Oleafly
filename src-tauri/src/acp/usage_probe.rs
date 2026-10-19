//! "Refresh plan usage": a hidden turn sends the agent's own `/usage` (or
//! `/status`) command and keeps its answer as the plan summary. Nothing of
//! it reaches the transcript, the before-turn copies or the usage ledger.
use oleafly_acp::TurnTiming;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

use super::runtime::AcpRuntime;
use super::types::{now_ms, SessionSnapshot, SessionStatus, SessionUsage, UsageCounters};

const HIDDEN_INACTIVITY: Duration = Duration::from_secs(60);
const HIDDEN_ABSOLUTE: Duration = Duration::from_secs(90);

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
        let command = ["usage", "status"]
            .into_iter()
            .find(|name| {
                record
                    .available_commands
                    .iter()
                    .any(|command| command.name == *name)
            })
            .ok_or("This agent does not report plan usage.")?;
        let native = record
            .native_session_id
            .clone()
            .ok_or("The ACP session is not ready.")?;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.hidden = Some(String::new());
            state.record.status = SessionStatus::Running;
            state.turn_closed = false;
        }
        let result = session
            .client
            .prompt(
                &native,
                vec![json!({"type": "text", "text": format!("/{command}")})],
                TurnTiming {
                    inactivity: Some(HIDDEN_INACTIVITY),
                    absolute: Some(HIDDEN_ABSOLUTE),
                    hold: None,
                },
            )
            .await;
        let closed = session.client.is_closed();
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let text = state.hidden.take().unwrap_or_default();
            state.record.status = if closed {
                SessionStatus::Disconnected
            } else {
                SessionStatus::Ready
            };
            if result.is_ok() {
                let markdown = session.redactor.text(&text);
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
                self.emit_locked(&session, &mut state, "usage", data)?;
            }
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
}
