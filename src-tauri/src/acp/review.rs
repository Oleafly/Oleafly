//! Before-turn copies and the Git revision a conversation started from.
//!
//! The runtime reaches `agent_turns` and `git` through [`ReviewHooks`] so the
//! protocol tests can observe the calls without writing into the user's data
//! folder or needing Git.

use crate::agent_turns::{BeginTicket, TurnBegin, TurnChanges, TurnUnavailable};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Duration};

/// Outer guard around the store's own budgets (5 s per `begin`/`finish`), so a
/// stuck copy can never hold a turn open.
const HOOK_DEADLINE: Duration = Duration::from_secs(10);

type BeginHook = dyn Fn(&str, &str, &BeginTicket) -> TurnBegin + Send + Sync;
type FinishHook = dyn Fn(&str, &str) -> TurnChanges + Send + Sync;
type HeadStateHook = dyn Fn(&Path) -> Option<(String, bool)> + Send + Sync;

#[derive(Clone)]
pub(crate) struct ReviewHooks {
    /// `(project_id, label, ticket)`; see `agent_turns::begin_for`.
    pub turn_begin: Arc<BeginHook>,
    /// `(project_id, snapshot_id)`; see `agent_turns::finish`.
    pub turn_finish: Arc<FinishHook>,
    /// See `git::head_state`.
    pub head_state: Arc<HeadStateHook>,
}

impl ReviewHooks {
    #[cfg_attr(test, allow(dead_code))]
    pub(crate) fn production() -> Self {
        Self {
            turn_begin: Arc::new(crate::agent_turns::begin_for),
            turn_finish: Arc::new(|project_id, snapshot_id| {
                crate::agent_turns::finish(project_id, snapshot_id, None)
            }),
            head_state: Arc::new(crate::git::head_state),
        }
    }

    /// Takes no copies and reports no revision.
    #[cfg(test)]
    pub(crate) fn inert() -> Self {
        Self {
            turn_begin: Arc::new(|_, _, _| TurnBegin::default()),
            turn_finish: Arc::new(|_, _| TurnChanges::default()),
            head_state: Arc::new(|_| None),
        }
    }
}

impl Default for ReviewHooks {
    fn default() -> Self {
        // Unit tests never write before-turn copies into the real data folder;
        // the tests that exercise these hooks inject their own.
        #[cfg(test)]
        return Self::inert();
        #[cfg(not(test))]
        Self::production()
    }
}

/// Only interactive conversations get a before-turn copy: research tasks
/// already work on an isolated copy, and a child agent's changes belong to the
/// parent assistant run that took its own copy.
pub(super) fn takes_turn_copy(is_task: bool, parent_session_id: Option<&str>) -> bool {
    !is_task && parent_session_id.is_none()
}

pub(super) async fn begin_turn(hooks: &ReviewHooks, project_id: &str, label: &str) -> TurnBegin {
    begin_turn_within(hooks, project_id, label, HOOK_DEADLINE).await
}

/// Takes the before-turn copy, waiting at most `deadline`. The copy keeps
/// running on its blocking thread when the wait ends early (a timeout, a
/// failed task, or this future being dropped), so the wait gives up its
/// ticket: that copy never leaves a turn open that nothing will finish.
pub(super) async fn begin_turn_within(
    hooks: &ReviewHooks,
    project_id: &str,
    label: &str,
    deadline: Duration,
) -> TurnBegin {
    let hook = hooks.turn_begin.clone();
    let project_id = project_id.to_owned();
    let label = label.to_owned();
    let ticket = Arc::new(BeginTicket::default());
    let waiting = AbandonUnlessKept(Some(ticket.clone()));
    let task = tokio::task::spawn_blocking(move || hook(&project_id, &label, &ticket));
    match tokio::time::timeout(deadline, task).await {
        Ok(Ok(begin)) => {
            waiting.keep();
            begin
        }
        Ok(Err(_)) => unavailable_begin(TurnUnavailable::Error),
        Err(_) => unavailable_begin(TurnUnavailable::Timeout),
    }
}

/// Abandons the ticket when dropped, unless the copy's result was received.
struct AbandonUnlessKept(Option<Arc<BeginTicket>>);

impl AbandonUnlessKept {
    fn keep(mut self) {
        self.0 = None;
    }
}

impl Drop for AbandonUnlessKept {
    fn drop(&mut self) {
        if let Some(ticket) = self.0.take() {
            ticket.abandon();
        }
    }
}

fn unavailable_begin(reason: TurnUnavailable) -> TurnBegin {
    TurnBegin {
        snapshot_id: None,
        unavailable: Some(reason),
    }
}

/// Compares the project with the before-turn copy. A copy that could not be
/// taken reports why, so the card can say Undo is unavailable.
pub(super) async fn finish_turn(
    hooks: &ReviewHooks,
    project_id: &str,
    begin: &TurnBegin,
) -> Option<TurnChanges> {
    let Some(snapshot_id) = begin.snapshot_id.clone() else {
        return begin.unavailable.map(|reason| TurnChanges {
            unavailable: Some(reason),
            ..TurnChanges::default()
        });
    };
    let hook = hooks.turn_finish.clone();
    let project_id = project_id.to_owned();
    let expected = snapshot_id.clone();
    let task = tokio::task::spawn_blocking(move || hook(&project_id, &expected));
    let reason = match tokio::time::timeout(HOOK_DEADLINE, task).await {
        Ok(Ok(changes)) => return Some(changes),
        Ok(Err(_)) => TurnUnavailable::Error,
        Err(_) => TurnUnavailable::Timeout,
    };
    Some(TurnChanges {
        snapshot_id: Some(snapshot_id),
        unavailable: Some(reason),
        ..TurnChanges::default()
    })
}

/// A card is shown only when files changed or Undo is unavailable.
pub(super) fn worth_reporting(changes: &TurnChanges) -> bool {
    !changes.files.is_empty() || changes.more_files > 0 || changes.unavailable.is_some()
}

/// The `turn_changes` event payload: `{ turnId, ...TurnChanges }`.
pub(super) fn turn_changes_event(turn_id: Option<&str>, changes: &TurnChanges) -> Value {
    let mut value = serde_json::to_value(changes).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("turnId".into(), json!(turn_id));
    }
    value
}

/// HEAD and whether the tree had uncommitted changes, for a project that is
/// its own Git repository. Git is never started for other folders.
pub(super) async fn start_revision(
    hooks: &ReviewHooks,
    root: &Path,
) -> (Option<String>, Option<bool>) {
    if !root.join(".git").exists() {
        return (None, None);
    }
    let hook = hooks.head_state.clone();
    let root = root.to_path_buf();
    let task = tokio::task::spawn_blocking(move || hook(&root));
    match tokio::time::timeout(HOOK_DEADLINE, task).await {
        Ok(Ok(Some((revision, dirty)))) => (Some(revision), Some(dirty)),
        _ => (None, None),
    }
}
