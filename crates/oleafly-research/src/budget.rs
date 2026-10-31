use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::model::TaskBudget;
use crate::scheduler::lock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BudgetKind {
    Time,
    Cost,
    Runs,
}

pub const WRAP_UP_LIMIT: Duration = Duration::from_secs(5 * 60);
pub const WRAP_UP_STEPS: u32 = 20;
pub const HARD_STOP_AFTER: Duration = Duration::from_secs(7 * 60);
pub const SPEND_CHECK_EVERY: Duration = Duration::from_secs(30);

pub type SpendProbe = Arc<dyn Fn() -> Option<f64> + Send + Sync>;

struct ClockState {
    banked: Duration,
    running_since: Option<Instant>,
    pauses: u32,
    spend: Option<f64>,
    spend_checked: Option<Instant>,
}

pub struct BudgetClock {
    budget: TaskBudget,
    state: Mutex<ClockState>,
    spend: SpendProbe,
    now: Box<dyn Fn() -> Instant + Send + Sync>,
}

impl BudgetClock {
    pub fn new(budget: TaskBudget, active_ms_at_start: u64, spend: SpendProbe) -> Self {
        Self::with_clock(budget, active_ms_at_start, spend, Box::new(Instant::now))
    }

    pub fn with_clock(
        budget: TaskBudget,
        active_ms_at_start: u64,
        spend: SpendProbe,
        now: Box<dyn Fn() -> Instant + Send + Sync>,
    ) -> Self {
        let started = now();
        Self {
            budget,
            state: Mutex::new(ClockState {
                banked: Duration::from_millis(active_ms_at_start),
                running_since: Some(started),
                pauses: 0,
                spend: None,
                spend_checked: None,
            }),
            spend,
            now,
        }
    }

    fn limit(&self) -> Duration {
        Duration::from_secs(u64::from(self.budget.wall_clock_minutes) * 60)
    }

    fn active(&self, state: &ClockState) -> Duration {
        state.banked
            + state
                .running_since
                .map(|since| (self.now)().saturating_duration_since(since))
                .unwrap_or_default()
    }

    pub fn active_ms(&self) -> u64 {
        let state = lock(&self.state);
        self.active(&state).as_millis().min(u128::from(u64::MAX)) as u64
    }

    pub fn remaining(&self) -> Duration {
        let state = lock(&self.state);
        self.limit().saturating_sub(self.active(&state))
    }

    pub fn pause(&self) {
        let mut state = lock(&self.state);
        state.pauses += 1;
        if let Some(since) = state.running_since.take() {
            state.banked += (self.now)().saturating_duration_since(since);
        }
    }

    pub fn resume(&self) {
        let mut state = lock(&self.state);
        state.pauses = state.pauses.saturating_sub(1);
        if state.pauses == 0 && state.running_since.is_none() {
            state.running_since = Some((self.now)());
        }
    }

    fn spend(&self) -> Option<f64> {
        let checked = {
            let state = lock(&self.state);
            state
                .spend_checked
                .map(|at| (self.now)().saturating_duration_since(at))
        };
        if checked.is_some_and(|since| since < SPEND_CHECK_EVERY) {
            return lock(&self.state).spend;
        }
        let spend = (self.spend)();
        let mut state = lock(&self.state);
        state.spend = spend;
        state.spend_checked = Some((self.now)());
        spend
    }

    pub fn exhausted(&self) -> Option<BudgetKind> {
        if let Some(cap) = self.budget.usd_cap {
            if self.spend().is_some_and(|spend| spend >= cap) {
                return Some(BudgetKind::Cost);
            }
        }
        self.remaining().is_zero().then_some(BudgetKind::Time)
    }

    pub fn budget(&self) -> &TaskBudget {
        &self.budget
    }

    pub fn last_spend(&self) -> Option<f64> {
        lock(&self.state).spend
    }
}

pub struct ClockPause(Option<Arc<BudgetClock>>);

impl ClockPause {
    pub fn new(clock: Option<Arc<BudgetClock>>) -> Self {
        if let Some(clock) = &clock {
            clock.pause();
        }
        Self(clock)
    }
}

impl Drop for ClockPause {
    fn drop(&mut self) {
        if let Some(clock) = self.0.take() {
            clock.resume();
        }
    }
}

#[derive(Default)]
pub struct BudgetClocks {
    clocks: Mutex<HashMap<String, Arc<BudgetClock>>>,
}

impl BudgetClocks {
    pub fn insert(&self, task_id: &str, clock: Arc<BudgetClock>) {
        lock(&self.clocks).insert(task_id.to_owned(), clock);
    }

    pub fn get(&self, task_id: &str) -> Option<Arc<BudgetClock>> {
        lock(&self.clocks).get(task_id).cloned()
    }

    pub fn remove(&self, task_id: &str) {
        lock(&self.clocks).remove(task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ManualTime(Mutex<Instant>);

    impl ManualTime {
        fn advance(&self, by: Duration) {
            *lock(&self.0) += by;
        }
    }

    fn clock(budget: TaskBudget, spend: Option<f64>) -> (Arc<ManualTime>, BudgetClock) {
        let time = Arc::new(ManualTime(Mutex::new(Instant::now())));
        let source = time.clone();
        let clock = BudgetClock::with_clock(
            budget,
            0,
            Arc::new(move || spend),
            Box::new(move || *lock(&source.0)),
        );
        (time, clock)
    }

    #[test]
    fn approval_pauses_do_not_count_against_the_time_budget() {
        let (time, clock) = clock(TaskBudget::default(), None);
        time.advance(Duration::from_secs(5 * 60));
        clock.pause();
        time.advance(Duration::from_secs(5 * 60));
        clock.resume();
        assert_eq!(clock.active_ms(), 5 * 60 * 1000);
        assert_eq!(clock.remaining(), Duration::from_secs(115 * 60));
    }

    #[test]
    fn a_dropped_pause_resumes_the_clock() {
        let (time, clock) = clock(TaskBudget::default(), None);
        let clock = Arc::new(clock);
        time.advance(Duration::from_secs(60));
        let pause = ClockPause::new(Some(clock.clone()));
        time.advance(Duration::from_secs(60));
        assert_eq!(clock.active_ms(), 60 * 1000);
        drop(pause);
        time.advance(Duration::from_secs(60));
        assert_eq!(clock.active_ms(), 2 * 60 * 1000);
    }

    #[test]
    fn the_cost_cap_trips_when_spend_reaches_it_and_unknown_cost_never_trips() {
        let budget = TaskBudget {
            usd_cap: Some(2.0),
            ..TaskBudget::default()
        };
        let (_time, reached) = clock(budget.clone(), Some(2.0));
        assert_eq!(reached.exhausted(), Some(BudgetKind::Cost));
        let (_time, unknown) = clock(budget, None);
        assert_eq!(unknown.exhausted(), None);
    }

    #[test]
    fn the_time_budget_runs_out() {
        let budget = TaskBudget {
            wall_clock_minutes: 5,
            ..TaskBudget::default()
        };
        let (time, clock) = clock(budget, None);
        time.advance(Duration::from_secs(4 * 60));
        assert_eq!(clock.exhausted(), None);
        time.advance(Duration::from_secs(60));
        assert_eq!(clock.exhausted(), Some(BudgetKind::Time));
    }
}
