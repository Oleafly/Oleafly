//! Token budget accounting and the auto-compaction roll-over rule. When a
//! turn needs to continue (tool calls are pending) but the context window is
//! exhausted, the session rolls over into a compacted context instead of
//! failing the turn.

use crate::complete::Usage;

/// Why a compaction was triggered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionReason {
    /// The estimated context crossed the model's window.
    ContextLimit,
    /// The compaction hash changed (history mutated behind the session).
    CompHashChanged,
    /// The model was downshifted to one with a smaller window.
    ModelDownshift,
}

/// Where in the turn lifecycle the compaction runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionPhase {
    /// Before the first sampling request of a turn.
    PreTurn,
    /// Between tool results and the next sampling request.
    MidTurn,
}

/// Where the compacted summary is injected relative to the kept history.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialContextInjection {
    /// The summary replaces older history and lands before the most recent
    /// user message, so the active instruction is never summarized away.
    BeforeLastUserMessage,
}

/// Running token totals for one session, saturating on overflow.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TokenBudget {
    pub input: u64,
    pub output: u64,
    /// Zero means unlimited.
    pub input_limit: u64,
}

impl TokenBudget {
    pub fn record(&mut self, usage: Usage) {
        self.input = self.input.saturating_add(u64::from(usage.input));
        self.output = self.output.saturating_add(u64::from(usage.output));
    }

    pub fn token_limit_reached(&self) -> bool {
        self.input_limit != 0 && self.input >= self.input_limit
    }

    pub fn remaining(&self) -> Option<u64> {
        (self.input_limit != 0).then(|| self.input_limit.saturating_sub(self.input))
    }
}

/// The roll-over rule, verbatim from the audited core: a context roll happens
/// only when the turn must continue AND the window is exhausted (either the
/// model asked for a fresh window or the token limit was reached).
pub fn should_roll_over(
    needs_follow_up: bool,
    token_limit_reached: bool,
    new_context_window_request: bool,
) -> bool {
    needs_follow_up && (new_context_window_request || token_limit_reached)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_accumulates_saturating() {
        let mut budget = TokenBudget {
            input: u64::MAX - 1,
            output: 5,
            input_limit: 0,
        };
        budget.record(Usage {
            input: 10,
            output: 10,
        });
        assert_eq!(budget.input, u64::MAX);
        assert_eq!(budget.output, 15);
    }

    #[test]
    fn the_limit_is_only_reached_when_set() {
        let mut unlimited = TokenBudget::default();
        unlimited.record(Usage {
            input: 1_000,
            output: 0,
        });
        assert!(!unlimited.token_limit_reached());
        assert_eq!(unlimited.remaining(), None);

        let mut limited = TokenBudget {
            input: 0,
            output: 0,
            input_limit: 1_000,
        };
        limited.record(Usage {
            input: 999,
            output: 0,
        });
        assert!(!limited.token_limit_reached());
        assert_eq!(limited.remaining(), Some(1));
        limited.record(Usage {
            input: 1,
            output: 0,
        });
        assert!(limited.token_limit_reached());
        assert_eq!(limited.remaining(), Some(0));
    }

    #[test]
    fn roll_over_requires_both_a_reason_to_continue_and_a_window_signal() {
        // No follow-up work: the turn simply ends, never compacts.
        assert!(!should_roll_over(false, true, true));
        // Follow-up work but the window is fine.
        assert!(!should_roll_over(true, false, false));
        // Follow-up work plus either signal rolls over.
        assert!(should_roll_over(true, true, false));
        assert!(should_roll_over(true, false, true));
        assert!(should_roll_over(true, true, true));
    }
}
