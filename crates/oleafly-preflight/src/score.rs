//! Check scores (`packages/preflight/src/score.ts`).

use crate::types::{CheckId, CheckScores, Finding, Lens, Severity, CHECK_IDS};

pub fn points(severity: Severity) -> i64 {
    match severity {
        Severity::Error => 15,
        Severity::Warning => 6,
        Severity::Info => 2,
    }
}

/// A `both` finding counts against ATS and accessibility.
pub fn finding_applies_to(finding: &Finding, check: CheckId) -> bool {
    match finding.lens {
        Lens::Both => matches!(check, CheckId::Ats | CheckId::A11y),
        Lens::Ats => check == CheckId::Ats,
        Lens::Compile => check == CheckId::Compile,
        Lens::A11y => check == CheckId::A11y,
        Lens::Refs => check == CheckId::Refs,
        Lens::Submission => check == CheckId::Submission,
        Lens::Privacy => check == CheckId::Privacy,
    }
}

pub fn compute_scores(findings: &[Finding]) -> CheckScores {
    let mut scores: CheckScores = CHECK_IDS.iter().map(|id| (*id, 100)).collect();
    for finding in findings {
        let cost = points(finding.severity);
        for check in CHECK_IDS {
            if finding_applies_to(finding, check) {
                if let Some(score) = scores.get_mut(&check) {
                    *score -= cost;
                }
            }
        }
    }
    for score in scores.values_mut() {
        *score = (*score).clamp(0, 100);
    }
    scores
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::message;

    #[test]
    fn scores_charge_both_lens_to_ats_and_a11y_and_clamp_at_zero() {
        let findings: Vec<Finding> = (0..7)
            .map(|_| Finding::new("x", Lens::Both, Severity::Error, message("a"), message("b")))
            .collect();
        let scores = compute_scores(&findings);
        assert_eq!(scores[&CheckId::Ats], 0);
        assert_eq!(scores[&CheckId::A11y], 0);
        assert_eq!(scores[&CheckId::Refs], 100);
    }
}
