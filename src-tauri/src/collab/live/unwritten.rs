use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::{Duration, Instant};

use oleafly_collab::materialize::Layout;
use serde::Serialize;

use super::session::{guard, lock, Active, Alarm};
use crate::collab::disk::safe_target;

pub const LIVE_UNWRITTEN_EVENT: &str = "collab-live-unwritten";
const FIRST_RETRY: Duration = Duration::from_secs(2);
const LONGEST_RETRY: Duration = Duration::from_secs(60);
const TELL_AFTER: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnwrittenReason {
    Locked,
    ReadOnly,
    NoSpace,
    NotDownloaded,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnwrittenFile {
    pub path: String,
    pub reason: UnwrittenReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnwrittenPayload {
    pub project_id: String,
    pub files: Vec<UnwrittenFile>,
}

struct Attempt {
    count: u32,
    reason: Option<UnwrittenReason>,
    next: Instant,
}

#[derive(Default)]
pub(super) struct Failing {
    attempts: BTreeMap<String, Attempt>,
    told: Vec<UnwrittenFile>,
    timer: Alarm,
}

#[cfg(windows)]
fn reason_of_code(code: i32, target: Option<&Path>) -> UnwrittenReason {
    match code {
        32 | 33 | 1224 => UnwrittenReason::Locked,
        5 if target.is_some_and(in_use) => UnwrittenReason::Locked,
        5 | 19 => UnwrittenReason::ReadOnly,
        39 | 112 => UnwrittenReason::NoSpace,
        _ => UnwrittenReason::Other,
    }
}

#[cfg(windows)]
fn in_use(target: &Path) -> bool {
    std::fs::metadata(target)
        .is_ok_and(|metadata| metadata.is_file() && !metadata.permissions().readonly())
}

#[cfg(not(windows))]
fn reason_of_code(code: i32, _target: Option<&Path>) -> UnwrittenReason {
    match code {
        libc::EAGAIN | libc::EBUSY | libc::ETXTBSY => UnwrittenReason::Locked,
        libc::EPERM | libc::EACCES | libc::EROFS => UnwrittenReason::ReadOnly,
        libc::ENOSPC | libc::EDQUOT => UnwrittenReason::NoSpace,
        _ => UnwrittenReason::Other,
    }
}

// Another program holds the file for writing or deleting, or it is read-only.
// One open asks Windows this at once, where a write would retry for seconds.
#[cfg(windows)]
pub(super) fn held_elsewhere(target: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt as _;
    const DELETE: u32 = 0x0001_0000;
    const FILE_WRITE_DATA: u32 = 0x0002;
    match std::fs::OpenOptions::new()
        .access_mode(DELETE | FILE_WRITE_DATA)
        .open(target)
    {
        Ok(_) => false,
        Err(error) => matches!(error.raw_os_error(), Some(5 | 32 | 33 | 1224)),
    }
}

#[cfg(not(windows))]
pub(super) fn held_elsewhere(_target: &Path) -> bool {
    false
}

pub(super) fn reason_of(root: &Path, path: &str, error: &str) -> UnwrittenReason {
    let target = safe_target(root, path);
    error
        .rsplit_once("(os error ")
        .and_then(|(_, code)| code.trim_end_matches(')').parse().ok())
        .map_or(UnwrittenReason::Other, |code| {
            reason_of_code(code, target.as_deref())
        })
}

pub(super) fn backoff(attempts: u32) -> Duration {
    FIRST_RETRY
        .saturating_mul(1 << attempts.saturating_sub(1).min(8))
        .min(LONGEST_RETRY)
}

#[derive(Default)]
pub(super) struct Settled {
    pub(super) done: BTreeSet<String>,
    pub(super) failed: Vec<(String, UnwrittenReason)>,
    pub(super) conflicts: Vec<String>,
}

impl Active {
    pub(super) fn settle_unwritten(&self, layout: &Layout, settled: Settled) {
        let (retry, payload, delay, timer) = {
            let mut held = guard(&self.upkeep.failing);
            let failing = &mut *held;
            let present: BTreeSet<&str> =
                layout.values().map(|placed| placed.path.as_str()).collect();
            failing
                .attempts
                .retain(|path, _| present.contains(path.as_str()) && !settled.done.contains(path));
            let failed = settled
                .failed
                .into_iter()
                .map(|(path, reason)| (path, Some(reason)));
            let conflicts = settled.conflicts.into_iter().map(|path| (path, None));
            let mut retry = BTreeSet::new();
            for (path, reason) in failed.chain(conflicts) {
                let entry = failing.attempts.entry(path.clone()).or_insert(Attempt {
                    count: 0,
                    reason: None,
                    next: Instant::now(),
                });
                entry.count = entry.count.saturating_add(1);
                entry.next = Instant::now() + backoff(entry.count);
                if reason.is_some() {
                    entry.reason = reason;
                }
                if reason != Some(UnwrittenReason::NotDownloaded) {
                    retry.insert(path);
                }
            }
            let told: Vec<UnwrittenFile> = failing
                .attempts
                .iter()
                .filter(|(_, attempt)| attempt.count >= TELL_AFTER)
                .filter_map(|(path, attempt)| {
                    attempt.reason.map(|reason| UnwrittenFile {
                        path: path.clone(),
                        reason,
                    })
                })
                .collect();
            let payload = (told != failing.told).then(|| UnwrittenPayload {
                project_id: self.project_id.clone(),
                files: told.clone(),
            });
            failing.told = told;
            let most = retry
                .iter()
                .filter_map(|path| failing.attempts.get(path))
                .map(|attempt| attempt.count)
                .max();
            (retry, payload, most.map(backoff), failing.timer.clone())
        };
        if !retry.is_empty() {
            let mut live = lock(&self.live);
            for (id, placed) in layout {
                if retry.contains(&placed.path) {
                    live.mark_dirty(id);
                }
            }
        }
        if let Some(payload) = payload {
            for file in &payload.files {
                let _ = crate::project::append_app_log(format!(
                    "Live collaboration could not write {} in project {} ({:?}); it tries again",
                    file.path, self.project_id, file.reason
                ));
            }
            self.host.unwritten(payload);
        }
        if let Some(delay) = delay {
            timer.ring_in(&self.writer, delay);
        }
    }

    // A file that could not be written waits for its next try instead of
    // being tried on every pass, because on Windows one try can block for
    // seconds on a file another program holds. A flush tries it once anyway,
    // unless the file is still held, which one open finds out at once. The
    // files still held come back as failures of this pass.
    pub(super) fn hold_back_failing(
        &self,
        next: &Layout,
        texts: &mut Vec<(String, String)>,
        urgent: bool,
    ) -> Vec<(String, UnwrittenReason)> {
        let now = Instant::now();
        let (waiting, timer): (BTreeMap<String, (Instant, UnwrittenReason)>, Alarm) = {
            let failing = guard(&self.upkeep.failing);
            let waiting = failing
                .attempts
                .iter()
                .filter_map(|(path, attempt)| {
                    attempt
                        .reason
                        .filter(|reason| *reason != UnwrittenReason::NotDownloaded)
                        .map(|reason| (path.clone(), (attempt.next, reason)))
                })
                .collect();
            (waiting, failing.timer.clone())
        };
        if waiting.is_empty() {
            return Vec::new();
        }
        let mut held = BTreeSet::new();
        let mut still = Vec::new();
        texts.retain(|(path, _)| {
            let Some((due, reason)) = waiting.get(path) else {
                return true;
            };
            if !urgent && *due > now {
                held.insert(path.clone());
                return false;
            }
            let known = matches!(reason, UnwrittenReason::Locked | UnwrittenReason::ReadOnly);
            if known && safe_target(&self.root, path).is_some_and(|target| held_elsewhere(&target))
            {
                still.push((path.clone(), *reason));
                return false;
            }
            true
        });
        if held.is_empty() {
            return still;
        }
        {
            let mut live = lock(&self.live);
            for (id, placed) in next {
                if held.contains(&placed.path) {
                    live.mark_dirty(id);
                }
            }
        }
        let soonest = waiting
            .iter()
            .filter(|(path, _)| held.contains(*path))
            .map(|(_, (due, _))| due.saturating_duration_since(now))
            .min();
        if let Some(soonest) = soonest {
            timer.ring_in(&self.writer, soonest);
        }
        still
    }

    #[cfg(test)]
    pub(super) fn tries_of(&self, path: &str) -> u32 {
        guard(&self.upkeep.failing)
            .attempts
            .get(path)
            .map_or(0, |attempt| attempt.count)
    }

    #[cfg(test)]
    pub(super) fn next_try_in(&self, path: &str) -> Option<Duration> {
        guard(&self.upkeep.failing)
            .attempts
            .get(path)
            .map(|attempt| attempt.next.saturating_duration_since(Instant::now()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_errors_read_as_the_reasons_the_window_explains() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("open.tex"), "x").unwrap();
        let reason = |path: &str, error: &str| reason_of(root, path, error);
        #[cfg(not(windows))]
        {
            assert_eq!(
                reason("main.tex", "Permission denied (os error 13)"),
                UnwrittenReason::ReadOnly
            );
            assert_eq!(
                reason(
                    "main.tex",
                    "could not stage main.tex: No space left on device (os error 28)"
                ),
                UnwrittenReason::NoSpace
            );
            assert_eq!(
                reason("main.tex", "Read-only file system (os error 30)"),
                UnwrittenReason::ReadOnly
            );
            let busy = format!(
                "Resource temporarily unavailable (os error {})",
                libc::EAGAIN
            );
            assert_eq!(reason("main.tex", &busy), UnwrittenReason::Locked);
            let quota = format!("Disc quota exceeded (os error {})", libc::EDQUOT);
            assert_eq!(reason("main.tex", &quota), UnwrittenReason::NoSpace);
            let deadlock = format!("Resource deadlock avoided (os error {})", libc::EDEADLK);
            assert_eq!(reason("main.tex", &deadlock), UnwrittenReason::Other);
        }
        #[cfg(windows)]
        {
            assert_eq!(
                reason("main.tex", "The process cannot access the file because it is being used by another process. (os error 32)"),
                UnwrittenReason::Locked
            );
            assert_eq!(
                reason(
                    "main.tex",
                    "There is not enough space on the disk. (os error 112)"
                ),
                UnwrittenReason::NoSpace
            );
            let denied = "Access is denied. (os error 5)";
            assert_eq!(reason("open.tex", denied), UnwrittenReason::Locked);
            assert_eq!(reason("missing.tex", denied), UnwrittenReason::ReadOnly);
        }
        assert_eq!(
            reason("open.tex", "refused to write x"),
            UnwrittenReason::Other
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_file_another_program_holds_is_found_held_by_one_quick_open() {
        use std::os::windows::fs::OpenOptionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("main.tex");
        std::fs::write(&target, "x").unwrap();
        let holder = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        let started = Instant::now();
        assert!(held_elsewhere(&target));
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(holder);
        assert!(!held_elsewhere(&target));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "x");
    }

    #[test]
    fn retries_back_off_to_a_minute() {
        assert_eq!(backoff(1), Duration::from_secs(2));
        assert_eq!(backoff(2), Duration::from_secs(4));
        assert_eq!(backoff(4), Duration::from_secs(16));
        assert_eq!(backoff(30), LONGEST_RETRY);
    }

    #[test]
    fn the_notice_names_each_file_and_why_in_snake_case() {
        let payload = UnwrittenPayload {
            project_id: "paper".to_owned(),
            files: vec![UnwrittenFile {
                path: "data/results.csv".to_owned(),
                reason: UnwrittenReason::NotDownloaded,
            }],
        };
        assert_eq!(LIVE_UNWRITTEN_EVENT, "collab-live-unwritten");
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({
                "projectId": "paper",
                "files": [{ "path": "data/results.csv", "reason": "not_downloaded" }],
            })
        );
    }
}
