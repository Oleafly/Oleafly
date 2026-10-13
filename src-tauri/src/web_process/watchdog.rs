use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub(crate) const TICK: Duration = Duration::from_secs(1);
pub(crate) const PROBE_INTERVAL: Duration = Duration::from_secs(10);
pub(crate) const UNANSWERED_LIMIT: Duration = Duration::from_secs(30);
pub(crate) const UI_TICK_STALE: Duration = Duration::from_secs(3);
pub(crate) const CPU_WINDOW: Duration = Duration::from_secs(10);
pub(crate) const IDLE_CPU: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Healthy,
    Wait,
    Reset,
    Kill,
    GiveUp,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Observation {
    pub(crate) unanswered: Option<Duration>,
    pub(crate) ui_alive: Duration,
    pub(crate) cpu_in_window: Option<Duration>,
    pub(crate) same_process: bool,
    pub(crate) budget_left: bool,
}

pub(crate) fn verdict(observation: Observation) -> Verdict {
    let Some(unanswered) = observation.unanswered else {
        return Verdict::Healthy;
    };
    if !observation.same_process {
        return Verdict::Reset;
    }
    if unanswered < UNANSWERED_LIMIT || observation.ui_alive < UNANSWERED_LIMIT {
        return Verdict::Wait;
    }
    if !observation
        .cpu_in_window
        .is_some_and(|used| used <= IDLE_CPU)
    {
        return Verdict::Wait;
    }
    if observation.budget_left {
        Verdict::Kill
    } else {
        Verdict::GiveUp
    }
}

#[derive(Debug, Default)]
pub(crate) struct UiPulse {
    last: Option<Instant>,
    alive_since: Option<Instant>,
}

impl UiPulse {
    pub(crate) fn beat(&mut self, now: Instant) {
        if !self.is_fresh(now) {
            self.alive_since = Some(now);
        }
        self.last = Some(now);
    }

    pub(crate) fn alive_for(&self, now: Instant) -> Duration {
        match self.alive_since {
            Some(since) if self.is_fresh(now) => now.saturating_duration_since(since),
            _ => Duration::ZERO,
        }
    }

    fn is_fresh(&self, now: Instant) -> bool {
        self.last
            .is_some_and(|last| now.saturating_duration_since(last) <= UI_TICK_STALE)
    }
}

#[derive(Debug, Default)]
pub(crate) struct CpuSamples {
    pid: Option<i32>,
    samples: VecDeque<(Instant, Duration)>,
}

impl CpuSamples {
    pub(crate) fn record(&mut self, pid: i32, now: Instant, used: Option<Duration>) {
        let Some(used) = used else {
            self.clear();
            return;
        };
        if self.pid != Some(pid) {
            self.clear();
            self.pid = Some(pid);
        }
        self.samples.push_back((now, used));
        while self
            .samples
            .get(1)
            .is_some_and(|(at, _)| now.saturating_duration_since(*at) >= CPU_WINDOW)
        {
            self.samples.pop_front();
        }
    }

    pub(crate) fn used_over(&self, now: Instant, window: Duration) -> Option<Duration> {
        let base = self
            .samples
            .iter()
            .rev()
            .find(|(at, _)| now.saturating_duration_since(*at) >= window)?;
        let latest = self.samples.back()?;
        Some(latest.1.saturating_sub(base.1))
    }

    pub(crate) fn clear(&mut self) {
        self.pid = None;
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stuck() -> Observation {
        Observation {
            unanswered: Some(Duration::from_secs(31)),
            ui_alive: Duration::from_secs(120),
            cpu_in_window: Some(Duration::ZERO),
            same_process: true,
            budget_left: true,
        }
    }

    #[test]
    fn kills_an_idle_process_that_stopped_answering() {
        assert_eq!(verdict(stuck()), Verdict::Kill);
        let barely_used = Observation {
            cpu_in_window: Some(Duration::from_millis(40)),
            ..stuck()
        };
        assert_eq!(verdict(barely_used), Verdict::Kill);
    }

    #[test]
    fn waits_while_the_page_is_busy() {
        let busy = Observation {
            cpu_in_window: Some(Duration::from_secs(9)),
            ..stuck()
        };
        assert_eq!(verdict(busy), Verdict::Wait);
        let unmeasured = Observation {
            cpu_in_window: None,
            ..stuck()
        };
        assert_eq!(verdict(unmeasured), Verdict::Wait);
    }

    #[test]
    fn waits_when_the_app_main_thread_has_not_been_running() {
        let stale_ui = Observation {
            ui_alive: Duration::from_secs(2),
            ..stuck()
        };
        assert_eq!(verdict(stale_ui), Verdict::Wait);
    }

    #[test]
    fn waits_until_the_probe_has_gone_unanswered_long_enough() {
        let recent = Observation {
            unanswered: Some(Duration::from_secs(29)),
            ..stuck()
        };
        assert_eq!(verdict(recent), Verdict::Wait);
    }

    #[test]
    fn resets_when_the_web_content_process_changed() {
        let replaced = Observation {
            same_process: false,
            ..stuck()
        };
        assert_eq!(verdict(replaced), Verdict::Reset);
        let replaced_early = Observation {
            unanswered: Some(Duration::from_secs(5)),
            same_process: false,
            ..stuck()
        };
        assert_eq!(verdict(replaced_early), Verdict::Reset);
    }

    #[test]
    fn gives_up_once_the_reload_budget_is_spent() {
        let spent = Observation {
            budget_left: false,
            ..stuck()
        };
        assert_eq!(verdict(spent), Verdict::GiveUp);
    }

    #[test]
    fn leaves_an_idle_hidden_window_that_still_answers() {
        let answering = Observation {
            unanswered: None,
            ..stuck()
        };
        assert_eq!(verdict(answering), Verdict::Healthy);
    }

    #[test]
    fn the_ui_pulse_counts_only_unbroken_main_thread_turns() {
        let start = Instant::now();
        let mut pulse = UiPulse::default();
        assert_eq!(pulse.alive_for(start), Duration::ZERO);
        for second in 0..=40 {
            pulse.beat(start + Duration::from_secs(second));
        }
        assert_eq!(
            pulse.alive_for(start + Duration::from_secs(40)),
            Duration::from_secs(40)
        );
        assert_eq!(
            pulse.alive_for(start + Duration::from_secs(44)),
            Duration::ZERO
        );
        pulse.beat(start + Duration::from_secs(50));
        pulse.beat(start + Duration::from_secs(51));
        assert_eq!(
            pulse.alive_for(start + Duration::from_secs(52)),
            Duration::from_secs(2)
        );
    }

    #[test]
    fn cpu_use_is_measured_over_a_full_window_of_one_process() {
        let start = Instant::now();
        let mut cpu = CpuSamples::default();
        cpu.record(7, start, Some(Duration::from_millis(500)));
        assert_eq!(
            cpu.used_over(start + Duration::from_secs(5), CPU_WINDOW),
            None
        );
        for second in 1..=12 {
            cpu.record(
                7,
                start + Duration::from_secs(second),
                Some(Duration::from_millis(500)),
            );
        }
        assert_eq!(
            cpu.used_over(start + Duration::from_secs(12), CPU_WINDOW),
            Some(Duration::ZERO)
        );
        cpu.record(
            7,
            start + Duration::from_secs(13),
            Some(Duration::from_millis(2_500)),
        );
        assert_eq!(
            cpu.used_over(start + Duration::from_secs(13), CPU_WINDOW),
            Some(Duration::from_secs(2))
        );
        cpu.record(
            8,
            start + Duration::from_secs(14),
            Some(Duration::from_millis(10)),
        );
        assert_eq!(
            cpu.used_over(start + Duration::from_secs(14), CPU_WINDOW),
            None
        );
        cpu.record(8, start + Duration::from_secs(15), None);
        assert_eq!(
            cpu.used_over(start + Duration::from_secs(30), CPU_WINDOW),
            None
        );
    }
}
