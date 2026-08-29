//! Tool orchestrator: per-call approval classification before dispatch.
//! `Forbidden` calls are short-circuited without any round trip; `Skip`
//! calls may execute natively without asking; `NeedsApproval` calls pause
//! for the shell's approval flow (which the tool runner performs).

use std::sync::Arc;

use crate::run::{ToolOutput, ToolRunner};
use crate::stream::ToolCall;

/// Risk classes mirror the shell's approval-risk table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolRisk {
    Read,
    Write,
    Shell,
    Network,
}

/// A persisted per-project decision from approval settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    Deny,
}

/// What the orchestrator does with a call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalRequirement {
    /// No approval needed (read-class, or the project allowlisted the tool).
    Skip,
    /// Route through the approval flow before executing.
    NeedsApproval,
    /// The project denied the tool; never execute, never ask.
    Forbidden,
}

/// Classify one call from its risk class and the project's persisted
/// decision for that tool. A denial always wins; an explicit allow or a
/// read-class tool skips approval; everything else asks.
pub fn classification_from_policy(
    risk: ToolRisk,
    decision: Option<PolicyDecision>,
) -> ApprovalRequirement {
    match decision {
        Some(PolicyDecision::Deny) => ApprovalRequirement::Forbidden,
        Some(PolicyDecision::Allow) => ApprovalRequirement::Skip,
        None => match risk {
            ToolRisk::Read => ApprovalRequirement::Skip,
            ToolRisk::Write | ToolRisk::Shell | ToolRisk::Network => {
                ApprovalRequirement::NeedsApproval
            }
        },
    }
}

pub type Classifier = Arc<dyn Fn(&ToolCall) -> ApprovalRequirement + Send + Sync>;

/// Wraps a tool runner with classification: `Forbidden` calls return an
/// error output without invoking the runner, so a denied tool's output can
/// never reach the model even if the shell-side gate fails.
pub struct ToolOrchestrator;

impl ToolOrchestrator {
    pub fn wrap(runner: ToolRunner, classifier: Classifier) -> ToolRunner {
        Arc::new(move |call| {
            if classifier(&call) == ApprovalRequirement::Forbidden {
                let denied = ToolOutput::text(
                    serde_json::json!({
                        "error": "this tool is denied for this project in approval settings"
                    })
                    .to_string(),
                );
                return Box::pin(async move { denied });
            }
            runner(call)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runner_ledger() -> (ToolRunner, Arc<std::sync::Mutex<Vec<String>>>) {
        let invocations: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
        let ledger = invocations.clone();
        let runner: ToolRunner = Arc::new(move |call| {
            let ledger = ledger.clone();
            Box::pin(async move {
                ledger.lock().unwrap().push(call.name.clone());
                ToolOutput::text("ran")
            })
        });
        (runner, invocations)
    }

    #[test]
    fn classification_follows_the_approval_table() {
        assert_eq!(
            classification_from_policy(ToolRisk::Read, None),
            ApprovalRequirement::Skip
        );
        assert_eq!(
            classification_from_policy(ToolRisk::Write, None),
            ApprovalRequirement::NeedsApproval
        );
        assert_eq!(
            classification_from_policy(ToolRisk::Shell, None),
            ApprovalRequirement::NeedsApproval
        );
        assert_eq!(
            classification_from_policy(ToolRisk::Read, Some(PolicyDecision::Deny)),
            ApprovalRequirement::Forbidden
        );
        assert_eq!(
            classification_from_policy(ToolRisk::Shell, Some(PolicyDecision::Allow)),
            ApprovalRequirement::Skip
        );
    }

    #[tokio::test]
    async fn forbidden_calls_never_reach_the_runner() {
        let (runner, invocations) = runner_ledger();
        let classifier: Classifier = Arc::new(|_| ApprovalRequirement::Forbidden);
        let wrapped = ToolOrchestrator::wrap(runner, classifier);
        let output = wrapped(call("delete_file")).await;
        assert!(output.output.contains("denied"));
        assert!(invocations.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn other_classifications_pass_through() {
        for requirement in [
            ApprovalRequirement::Skip,
            ApprovalRequirement::NeedsApproval,
        ] {
            let (runner, invocations) = runner_ledger();
            let classifier: Classifier = Arc::new(move |_| requirement);
            let output = ToolOrchestrator::wrap(runner, classifier)(call("write_file")).await;
            assert_eq!(output.output, "ran");
            assert_eq!(*invocations.lock().unwrap(), ["write_file".to_string()]);
        }
    }

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "c1".into(),
            name: name.into(),
            arguments: "{}".into(),
            ..Default::default()
        }
    }
}
