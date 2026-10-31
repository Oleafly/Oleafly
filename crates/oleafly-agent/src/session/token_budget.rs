use crate::complete::Usage;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionReason {
    ContextLimit,
    CompHashChanged,
    ModelDownshift,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactionPhase {
    PreTurn,
    MidTurn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialContextInjection {
    BeforeLastUserMessage,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TokenBudget {
    pub input: u64,
    pub output: u64,
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
            ..Usage::default()
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
            ..Usage::default()
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
            ..Usage::default()
        });
        assert!(!limited.token_limit_reached());
        assert_eq!(limited.remaining(), Some(1));
        limited.record(Usage {
            input: 1,
            output: 0,
            ..Usage::default()
        });
        assert!(limited.token_limit_reached());
        assert_eq!(limited.remaining(), Some(0));
    }

    #[test]
    fn roll_over_requires_both_a_reason_to_continue_and_a_window_signal() {
        assert!(!should_roll_over(false, true, true));
        assert!(!should_roll_over(true, false, false));
        assert!(should_roll_over(true, true, false));
        assert!(should_roll_over(true, false, true));
        assert!(should_roll_over(true, true, true));
    }
}
