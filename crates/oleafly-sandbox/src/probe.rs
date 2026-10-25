//! Availability checks that start a program or call the OS: a success is
//! remembered for the life of the process, a failure for a short while, so
//! one transient error (a locked file, a busy profile service) doesn't switch
//! the sandbox off until the app restarts.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::Availability;

/// How long a failed check is remembered.
pub(crate) const RETRY_AFTER: Duration = Duration::from_secs(30);

pub(crate) struct ProbeCache {
    slot: Mutex<Option<(Instant, Availability)>>,
}

impl ProbeCache {
    pub(crate) const fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }

    /// The remembered answer, or the answer of `probe`. Callers that arrive
    /// while a probe runs wait for it instead of starting their own.
    pub(crate) fn get(&self, probe: impl FnOnce() -> Availability) -> Availability {
        self.get_at(Instant::now(), probe)
    }

    fn get_at(&self, now: Instant, probe: impl FnOnce() -> Availability) -> Availability {
        let mut slot = self
            .slot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((at, result)) = slot.as_ref() {
            let fresh = now.saturating_duration_since(*at) < RETRY_AFTER;
            if *result == Availability::Available || fresh {
                return result.clone();
            }
        }
        let result = probe();
        *slot = Some((now, result.clone()));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn unavailable() -> Availability {
        Availability::Unavailable("busy".into())
    }

    #[test]
    fn get_uses_the_clock() {
        let cache = ProbeCache::new();
        assert_eq!(
            cache.get(|| Availability::Available),
            Availability::Available
        );
        assert_eq!(cache.get(unavailable), Availability::Available);
    }

    #[test]
    fn success_is_kept_for_good() {
        let cache = ProbeCache::new();
        let calls = Cell::new(0);
        let start = Instant::now();
        let probe = || {
            calls.set(calls.get() + 1);
            Availability::Available
        };
        assert_eq!(cache.get_at(start, probe), Availability::Available);
        let later = start + RETRY_AFTER * 100;
        assert_eq!(cache.get_at(later, probe), Availability::Available);
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn failure_is_retried_after_a_short_while() {
        let cache = ProbeCache::new();
        let calls = Cell::new(0);
        let start = Instant::now();
        let fail_then_work = || {
            calls.set(calls.get() + 1);
            if calls.get() == 1 {
                unavailable()
            } else {
                Availability::Available
            }
        };
        assert_eq!(cache.get_at(start, fail_then_work), unavailable());
        // Within the retry window the failure is served again.
        let soon = start + RETRY_AFTER / 2;
        assert_eq!(cache.get_at(soon, fail_then_work), unavailable());
        assert_eq!(calls.get(), 1);
        let after = start + RETRY_AFTER + Duration::from_secs(1);
        assert_eq!(cache.get_at(after, fail_then_work), Availability::Available);
        assert_eq!(calls.get(), 2);
    }
}
