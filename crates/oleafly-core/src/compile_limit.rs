use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub const COMPILE_TIME_LIMIT: Duration = Duration::from_secs(300);
pub const DOWNLOAD_TIME_LIMIT: Duration = Duration::from_secs(30 * 60);
pub const MARKDOWN_PDF_TIME_LIMIT: Duration = Duration::from_secs(15 * 60);
pub const NOTEBOOK_TIME_LIMIT: Duration = Duration::from_secs(60 * 60);
pub const TIMED_OUT_LINE: &str = "error: process timed out after";

const DOWNLOADING_NOTE: &str = " while TeX packages were downloading";
pub(crate) const DOWNLOAD_MARKERS: [&str; 2] = ["note: downloading ", "note: prefetching "];
const RECENT_DOWNLOAD: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub struct CompileClock {
    started: Instant,
    limit: Duration,
    last_download: AtomicU64,
}

impl CompileClock {
    pub fn start(limit: Duration) -> Self {
        Self::started_at(limit, Instant::now())
    }

    fn started_at(limit: Duration, started: Instant) -> Self {
        Self {
            started,
            limit,
            last_download: AtomicU64::new(0),
        }
    }

    pub fn observe(&self, text: &str) {
        self.observe_at(text, Instant::now());
    }

    fn observe_at(&self, text: &str, now: Instant) {
        if DOWNLOAD_MARKERS.iter().any(|marker| text.contains(marker)) {
            let elapsed = now.saturating_duration_since(self.started).as_millis();
            let elapsed = u64::try_from(elapsed).unwrap_or(u64::MAX - 1);
            self.last_download.store(elapsed + 1, Ordering::Relaxed);
        }
    }

    fn last_download(&self) -> Option<Duration> {
        match self.last_download.load(Ordering::Relaxed) {
            0 => None,
            stored => Some(Duration::from_millis(stored - 1)),
        }
    }

    fn enforced_limit(&self) -> Duration {
        let quiet = self.last_download().unwrap_or_default() + self.limit;
        quiet.min(extended_limit(self.limit))
    }

    pub fn deadline(&self) -> Instant {
        self.started + self.enforced_limit()
    }

    pub fn expired(&self, now: Instant) -> bool {
        now >= self.deadline()
    }

    pub fn was_downloading(&self, now: Instant) -> bool {
        self.last_download().is_some_and(|at| {
            now.saturating_duration_since(self.started)
                .saturating_sub(at)
                <= RECENT_DOWNLOAD
        })
    }

    pub fn timed_out_line(&self, now: Instant) -> String {
        let note = if self.was_downloading(now) {
            DOWNLOADING_NOTE
        } else {
            ""
        };
        format!(
            "{TIMED_OUT_LINE} {:.3}s{note} and was stopped",
            self.enforced_limit().as_secs_f64()
        )
    }
}

pub fn extended_limit(limit: Duration) -> Duration {
    limit.max(DOWNLOAD_TIME_LIMIT)
}

pub fn timed_out_during_download(line: &str) -> bool {
    line.starts_with(TIMED_OUT_LINE) && line.contains(DOWNLOADING_NOTE)
}

pub fn timed_out_minutes(line: &str) -> Option<u64> {
    let seconds = line
        .strip_prefix(TIMED_OUT_LINE)?
        .trim_start()
        .split('s')
        .next()?
        .parse::<f64>()
        .ok()?;
    Some((seconds / 60.0).ceil() as u64)
}

pub fn timed_out_line_in(log: &str) -> Option<&str> {
    log.lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with(TIMED_OUT_LINE))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMIT: Duration = Duration::from_secs(300);

    fn after(clock: &CompileClock, seconds: u64) -> Instant {
        clock.started + Duration::from_secs(seconds)
    }

    #[test]
    fn a_run_with_no_downloads_stops_at_the_plain_limit() {
        let clock = CompileClock::start(LIMIT);
        clock.observe_at("Latexmk: applying rule\n", after(&clock, 200));
        assert!(!clock.expired(after(&clock, 299)));
        assert!(clock.expired(after(&clock, 300)));
    }

    #[test]
    fn each_download_gives_the_full_limit_again() {
        let clock = CompileClock::start(LIMIT);
        clock.observe_at("note: downloading amsmath.sty\n", after(&clock, 280));
        assert!(!clock.expired(after(&clock, 500)));
        assert!(clock.expired(after(&clock, 580)));
        clock.observe_at(
            "note: prefetching 64 of 64 files (16-way concurrent)\n",
            after(&clock, 560),
        );
        assert!(!clock.expired(after(&clock, 700)));
        assert!(clock.expired(after(&clock, 860)));
    }

    #[test]
    fn downloads_never_pass_the_hard_cap() {
        let clock = CompileClock::start(LIMIT);
        clock.observe_at("note: downloading a.sty\n", after(&clock, 1790));
        assert!(!clock.expired(after(&clock, 1799)));
        assert!(clock.expired(after(&clock, 1800)));
    }

    #[test]
    fn a_limit_above_the_cap_keeps_its_own_length() {
        let clock = CompileClock::start(NOTEBOOK_TIME_LIMIT);
        assert_eq!(clock.deadline(), after(&clock, 3600));
        clock.observe_at("note: downloading a.sty\n", after(&clock, 3590));
        assert_eq!(clock.deadline(), after(&clock, 3600));
    }

    #[test]
    fn the_timeout_line_keeps_its_text_and_says_when_downloads_were_running() {
        let clock = CompileClock::start(LIMIT);
        assert_eq!(
            clock.timed_out_line(after(&clock, 300)),
            "error: process timed out after 300.000s and was stopped"
        );
        clock.observe_at("note: downloading a.sty\n", after(&clock, 1790));
        let line = clock.timed_out_line(after(&clock, 1800));
        assert_eq!(
            line,
            "error: process timed out after 1800.000s while TeX packages were downloading and was stopped"
        );
        assert!(timed_out_during_download(&line));
        assert_eq!(timed_out_minutes(&line), Some(30));
    }

    #[test]
    fn a_stalled_run_after_old_downloads_is_not_called_a_download() {
        let clock = CompileClock::start(LIMIT);
        clock.observe_at("note: downloading a.sty\n", after(&clock, 10));
        let line = clock.timed_out_line(after(&clock, 310));
        assert!(!timed_out_during_download(&line));
        assert_eq!(timed_out_minutes(&line), Some(6));
    }

    #[test]
    fn the_timeout_line_is_found_in_a_log_and_other_lines_are_left_alone() {
        let log = "Cell 2/3: 'slow'...\nerror: process timed out after 3600.000s and was stopped\n";
        assert_eq!(timed_out_minutes(timed_out_line_in(log).unwrap()), Some(60));
        assert_eq!(timed_out_line_in("! Undefined control sequence.\n"), None);
        assert_eq!(timed_out_minutes("error: something else"), None);
    }
}
