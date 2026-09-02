//! Durable Checkpoint publication outcome shared by compile IPC and the UI.

use oleafly_core::CheckpointPolicy;
use serde::Serialize;

/// Why a successful compile could not publish a durable Checkpoint.
// These reasons are part of the IPC contract for corrected adapters that have
// not passed the evidence gate yet.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointSkipReason {
    InvalidPolicy,
    DependencyEvidenceUnavailable,
    UntrackedExternalCommands,
    ExternalDependency,
    IgnoredRequiredDependency,
    InsufficientSpace,
}

/// Publication is supplementary to compilation. A skipped outcome never
/// changes an otherwise successful compile into a failure.
// `Published` stays in the stable result shape while all current adapters fail
// closed. Removing it would force another frontend contract migration later.
#[allow(dead_code)]
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CheckpointPublicationOutcome {
    #[default]
    NotAttempted,
    Published {
        snapshot_root: String,
        created: bool,
    },
    Skipped {
        reason: CheckpointSkipReason,
        message: String,
        suggestion: String,
    },
}

impl CheckpointPublicationOutcome {
    fn skipped(
        reason: CheckpointSkipReason,
        message: impl Into<String>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self::Skipped {
            reason,
            message: message.into(),
            suggestion: suggestion.into(),
        }
    }
}

/// Returns the truthful publication outcome for the currently shipped engine
/// adapters. This is intentionally fail-closed until an adapter returns
/// resolved, digest-bearing evidence for every input consumed by sealed replay.
pub fn current_adapter_outcome(
    engine: &str,
    allow_shell_escape: bool,
    policy: &CheckpointPolicy,
) -> CheckpointPublicationOutcome {
    if policy.validate().is_err() {
        return CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::InvalidPolicy,
            "Checkpoint not saved because this project's Checkpoints settings are invalid.",
            "Review the project Checkpoints settings, then compile again.",
        );
    }

    if allow_shell_escape {
        return CheckpointPublicationOutcome::skipped(
            CheckpointSkipReason::UntrackedExternalCommands,
            "Checkpoint not saved because this compile allowed external commands whose inputs cannot be proven.",
            "Turn off external TeX commands for this project, then compile again.",
        );
    }

    let detail = match engine.trim().to_ascii_lowercase().as_str() {
        "xetex" | "tectonic" | "latex" | "tex" | "luatex" => {
            "The bundled LaTeX engine cannot yet prove every resolved file it read."
        }
        "latexmk" => {
            "The system LaTeX engine cannot yet prove inputs from every compiler pass and helper."
        }
        "typst" | "typ" => {
            "The Typst engine cannot yet prove the local font files used by this compile."
        }
        "markdown" | "md" | "pandoc" => {
            "The Markdown engine cannot yet prove every Pandoc and LaTeX input used by this compile."
        }
        _ => "This document engine does not provide complete dependency evidence.",
    };
    CheckpointPublicationOutcome::skipped(
        CheckpointSkipReason::DependencyEvidenceUnavailable,
        format!("Checkpoint not saved. {detail}"),
        "Your document still compiled successfully. Use explicit Source Control or export a project backup for recovery.",
    )
}

#[cfg(test)]
mod tests {
    use oleafly_core::CheckpointPolicy;

    use super::{current_adapter_outcome, CheckpointPublicationOutcome, CheckpointSkipReason};

    #[test]
    fn every_current_engine_fails_closed_until_dependency_evidence_is_complete() {
        for engine in ["xetex", "latexmk", "typst", "markdown"] {
            let outcome = current_adapter_outcome(engine, false, &CheckpointPolicy::default());
            assert!(matches!(
                outcome,
                CheckpointPublicationOutcome::Skipped {
                    reason: CheckpointSkipReason::DependencyEvidenceUnavailable,
                    ..
                }
            ));
        }
    }

    #[test]
    fn invalid_policy_has_a_distinct_actionable_outcome() {
        let policy: CheckpointPolicy = serde_json::from_value(serde_json::json!({
            "mode": "engine_dependencies",
            "always_include": ["../outside"],
            "ignored": []
        }))
        .unwrap();
        let outcome = current_adapter_outcome("typst", false, &policy);
        assert!(matches!(
            outcome,
            CheckpointPublicationOutcome::Skipped {
                reason: CheckpointSkipReason::InvalidPolicy,
                ..
            }
        ));
    }

    #[test]
    fn shell_escape_is_reported_before_generic_latexmk_unavailability() {
        let outcome = current_adapter_outcome("latexmk", true, &CheckpointPolicy::default());
        assert!(matches!(
            outcome,
            CheckpointPublicationOutcome::Skipped {
                reason: CheckpointSkipReason::UntrackedExternalCommands,
                ..
            }
        ));
    }
}
