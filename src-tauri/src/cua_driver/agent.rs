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

/// The session a call belongs to: a live subagent's tag, else the run's own.
/// The runner that tags a subagent's calls overwrites whatever the model
/// wrote; a root call's tag came from the model, so it only counts when it
/// names a subagent that is running (its guard registered the key).
fn session_key_for(state: &CuaDriverState, run: &RunScope, arguments: &Value) -> String {
    arguments
        .get(SESSION_TAG)
        .and_then(Value::as_str)
        .filter(|key| {
            key.starts_with(CHILD_SESSION_PREFIX) && key.len() <= 128 && state.is_child(key)
        })
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
        Self::registered(global(), session_key)
    }

    #[cfg(test)]
    pub(crate) fn with_state(state: Arc<CuaDriverState>, session_key: String) -> Self {
        Self::registered(Some(state), session_key)
    }

    /// A subagent's key (`external:…`) is registered while its guard lives:
    /// its tagged calls may use it.
    fn registered(state: Option<Arc<CuaDriverState>>, session_key: String) -> Self {
        if let Some(state) = &state {
            if session_key.starts_with(CHILD_SESSION_PREFIX) {
                state.register_child(&session_key);
            }
        }
        Self {
            key: session_key,
            state,
        }
    }
}

impl Drop for TurnEndGuard {
    fn drop(&mut self) {
        if let Some(state) = &self.state {
            state.unregister_child(&self.key);
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
    let Some(state) = global() else {
        return tool_error("Desktop apps aren't available.");
    };
    let scope = CuaScope {
        grant_key: run.grant_key.clone(),
        session_key: session_key_for(&state, run, &arguments),
        project_id: project_id.map(str::to_string),
        agent_label: run.agent_label.clone(),
        surface: Surface::Chat,
        task_title: None,
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

    fn state() -> (Arc<CuaDriverState>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(CuaDriverState::for_test(
            Default::default(),
            Arc::new(crate::cua_driver::runtime::testing::NoDriver),
            Arc::new(crate::cua_driver::gate::testing::ScriptedApprover::default()),
            dir.path().to_path_buf(),
        ));
        (state, dir)
    }

    #[test]
    fn root_calls_use_the_run_session_and_children_use_their_tag() {
        let (state, _dir) = state();
        let run = RunScope::for_chat(Some("thread-1"), "run-1");
        let _child = TurnEndGuard::with_state(state.clone(), "external:abc".into());
        assert_eq!(
            session_key_for(&state, &run, &json!({"tool": "click"})),
            "run-1"
        );
        assert_eq!(
            session_key_for(
                &state,
                &run,
                &json!({"tool": "click", SESSION_TAG: "external:abc"})
            ),
            "external:abc"
        );
        // Only the shape the child tagging uses counts.
        assert_eq!(
            session_key_for(
                &state,
                &run,
                &json!({"tool": "click", SESSION_TAG: "run-2"})
            ),
            "run-1"
        );
    }

    #[test]
    fn a_tag_the_model_wrote_cannot_name_a_session_that_does_not_exist() {
        let (state, _dir) = state();
        let run = RunScope::for_chat(Some("thread-1"), "run-1");
        let forged = json!({"tool": "click", SESSION_TAG: "external:made-up"});
        assert_eq!(session_key_for(&state, &run, &forged), "run-1");
        // A live subagent's key works while it lives, and not after.
        let child = TurnEndGuard::with_state(state.clone(), "external:made-up".into());
        assert_eq!(session_key_for(&state, &run, &forged), "external:made-up");
        drop(child);
        assert_eq!(session_key_for(&state, &run, &forged), "run-1");
        // A run's own key is never registered as a subagent's.
        let _run_guard = TurnEndGuard::with_state(state.clone(), "run-1".into());
        assert!(!state.is_child("run-1"));
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
