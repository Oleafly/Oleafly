use std::collections::VecDeque;
use std::time::Duration;

use tokio::time::Instant;

pub(super) struct JoinPacer {
    limit: usize,
    window: Duration,
    recent: VecDeque<Instant>,
}

impl JoinPacer {
    pub(super) fn new(limit: usize, window: Duration) -> JoinPacer {
        JoinPacer {
            limit: limit.max(1),
            window,
            recent: VecDeque::new(),
        }
    }

    pub(super) fn delay(&mut self, now: Instant) -> Duration {
        while self
            .recent
            .front()
            .is_some_and(|at| now.saturating_duration_since(*at) >= self.window)
        {
            self.recent.pop_front();
        }
        if self.recent.len() < self.limit {
            return Duration::ZERO;
        }
        self.recent.front().map_or(Duration::ZERO, |oldest| {
            (*oldest + self.window).saturating_duration_since(now)
        })
    }

    pub(super) fn record(&mut self, now: Instant) {
        self.recent.push_back(now);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Wait {
    pub(super) after: Duration,
    pub(super) held: Duration,
}

impl Wait {
    pub(super) const NOW: Wait = Wait {
        after: Duration::ZERO,
        held: Duration::ZERO,
    };

    pub(super) fn after(after: Duration) -> Wait {
        Wait {
            after,
            held: Duration::ZERO,
        }
    }

    pub(super) fn held(held: Duration) -> Wait {
        Wait { after: held, held }
    }

    pub(super) fn at_least(self, after: Duration) -> Wait {
        Wait {
            after: self.after.max(after),
            held: self.held,
        }
    }

    pub(super) fn held_at_least(self, held: Duration) -> Wait {
        Wait {
            after: self.after.max(held),
            held: self.held.max(held),
        }
    }
}
