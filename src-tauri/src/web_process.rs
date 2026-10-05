#[cfg(target_os = "linux")]
mod linux_gtk;

#[cfg(target_os = "linux")]
pub(crate) use linux_gtk::plugin;

#[cfg(any(target_os = "linux", test))]
use std::time::{Duration, Instant};

#[cfg(any(target_os = "linux", test))]
const RELOAD_WINDOW: Duration = Duration::from_secs(60);

#[cfg(any(target_os = "linux", test))]
const MAX_RELOADS: usize = 3;

#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
struct ReloadBudget(Vec<Instant>);

#[cfg(any(target_os = "linux", test))]
impl ReloadBudget {
    fn spend(&mut self, now: Instant) -> bool {
        self.0
            .retain(|at| now.saturating_duration_since(*at) < RELOAD_WINDOW);
        if self.0.len() >= MAX_RELOADS {
            return false;
        }
        self.0.push(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reloads_a_few_times_a_minute_and_then_stops() {
        let start = Instant::now();
        let mut budget = ReloadBudget::default();
        assert!(budget.spend(start));
        assert!(budget.spend(start + Duration::from_secs(5)));
        assert!(budget.spend(start + Duration::from_secs(10)));
        assert!(!budget.spend(start + Duration::from_secs(20)));
        assert!(!budget.spend(start + Duration::from_secs(59)));
    }

    #[test]
    fn the_budget_refills_as_old_reloads_age_out() {
        let start = Instant::now();
        let mut budget = ReloadBudget::default();
        for second in [0, 1, 2] {
            assert!(budget.spend(start + Duration::from_secs(second)));
        }
        assert!(!budget.spend(start + Duration::from_secs(30)));
        for second in [61, 62, 63] {
            assert!(budget.spend(start + Duration::from_secs(second)));
        }
        assert!(!budget.spend(start + Duration::from_secs(64)));
    }
}
