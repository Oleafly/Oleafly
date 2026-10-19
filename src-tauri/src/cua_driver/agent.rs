//! The built-in assistant's side of desktop apps: native dispatch of the
//! `desktop_apps` tool, the run scope, the tag a subagent's calls carry, and
//! the guard that ends a turn's Cua session however the turn ends.

use std::sync::Arc;

use serde_json::{json, Value};

use super::dispatch::{call_desktop_apps, turn_ended_in};
use super::{global, CuaDriverState, CuaScope, Surface};

/// Set by `exec_owner_tagging_runner` on a subagent's calls: the child's own
/// session key (its exec owner).
pub(crate) const SESSION_TAG: &str = "__cuaSession";

/// Exec owners minted for children look like `external:<uuid>`.
const CHILD_SESSION_PREFIX: &str = "external:";

/// Who a chat run's desktop calls belong to.
#[derive(Clone, Debug)]
pub(crate) struct RunScope {
    /// "Allow for this chat" grants live here: the chat thread, or the run.
    pub grant_key: String,
    /// The run's own Cua session; the turn-end guard uses the same key.
    pub root_session_key: String,
    pub agent_label: String,
}

impl RunScope {
    pub(crate) fn for_chat(thread_id: Option<&str>, run_id: &str) -> Self {
        let thread = thread_id
            .map(str::trim)
            .filter(|thread| !thread.is_empty())
            .unwrap_or(run_id);
        Self {
            grant_key: format!("chat:{thread}"),
            root_session_key: run_id.to_string(),
            agent_label: "Assistant".into(),
        }
    }
}

/// The session a call belongs to: a subagent's tag, else the run's own.
fn session_key_for(run: &RunScope, arguments: &Value) -> String {
    arguments
        .get(SESSION_TAG)
        .and_then(Value::as_str)
        .filter(|key| key.starts_with(CHILD_SESSION_PREFIX) && key.len() <= 128)
        .map(str::to_string)
        .unwrap_or_else(|| run.root_session_key.clone())
}

/// Ends the Cua session of `key` when dropped, so a finished, cancelled or
/// dropped run ends its session too.
pub(crate) struct TurnEndGuard {
    key: String,
    state: Option<Arc<CuaDriverState>>,
}

impl TurnEndGuard {
    pub(crate) fn new(session_key: String) -> Self {
        Self {
            key: session_key,
            state: global(),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_state(state: Arc<CuaDriverState>, session_key: String) -> Self {
        Self {
            key: session_key,
            state: Some(state),
        }
    }
}

impl Drop for TurnEndGuard {
    fn drop(&mut self) {
        if let Some(state) = &self.state {
            turn_ended_in(state, &self.key);
        }
    }
}

fn tool_error(message: &str) -> oleafly_agent::ToolOutput {
    oleafly_agent::ToolOutput::text(json!({ "error": message }).to_string())
}

/// Native dispatch for the built-in agent and its subagents.
pub(crate) async fn agent_tool(
    run: &RunScope,
    project_id: Option<&str>,
    arguments_json: &str,
) -> oleafly_agent::ToolOutput {
    let Ok(arguments) = serde_json::from_str::<Value>(arguments_json) else {
        return tool_error("The tool arguments were not valid JSON.");
    };
    let scope = CuaScope {
        grant_key: run.grant_key.clone(),
        session_key: session_key_for(run, &arguments),
        project_id: project_id.map(str::to_string),
        agent_label: run.agent_label.clone(),
        surface: Surface::Chat,
    };
    let Some(state) = global() else {
        return tool_error("Desktop apps aren't available.");
    };
    let outcome = call_desktop_apps(&state, &scope, arguments).await;
    oleafly_agent::ToolOutput {
        output: if outcome.is_error {
            json!({ "error": outcome.text }).to_string()
        } else {
            outcome.text
        },
        images: outcome.images,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_calls_use_the_run_session_and_children_use_their_tag() {
        let run = RunScope::for_chat(Some("thread-1"), "run-1");
        assert_eq!(session_key_for(&run, &json!({"tool": "click"})), "run-1");
        assert_eq!(
            session_key_for(&run, &json!({"tool": "click", SESSION_TAG: "external:abc"})),
            "external:abc"
        );
        // Only the shape the child tagging uses counts.
        assert_eq!(
            session_key_for(&run, &json!({"tool": "click", SESSION_TAG: "run-2"})),
            "run-1"
        );
    }

    #[test]
    fn chat_grants_follow_the_thread_across_turns() {
        assert_eq!(
            RunScope::for_chat(Some("t1"), "r1").grant_key,
            RunScope::for_chat(Some("t1"), "r2").grant_key
        );
        assert_ne!(
            RunScope::for_chat(None, "r1").grant_key,
            RunScope::for_chat(None, "r2").grant_key
        );
        assert_eq!(RunScope::for_chat(Some("t1"), "r1").root_session_key, "r1");
    }
}
