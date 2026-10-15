use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::materialize::Layout;
use serde::Serialize;

use super::session::{guard, lock, Active, WriterSignal};
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

#[derive(Default)]
pub(super) struct Failing {
    attempts: BTreeMap<String, (u32, Option<UnwrittenReason>)>,
    told: Vec<UnwrittenFile>,
    timer: Arc<AtomicBool>,
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
                let entry = failing.attempts.entry(path.clone()).or_insert((0, None));
                entry.0 = entry.0.saturating_add(1);
                if reason.is_some() {
                    entry.1 = reason;
                }
                if reason != Some(UnwrittenReason::NotDownloaded) {
                    retry.insert(path);
                }
            }
            let told: Vec<UnwrittenFile> = failing
                .attempts
                .iter()
                .filter(|(_, (attempts, _))| *attempts >= TELL_AFTER)
                .filter_map(|(path, (_, reason))| {
                    reason.map(|reason| UnwrittenFile {
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
                .map(|(attempts, _)| *attempts)
                .max();
            let delay = most
                .map(backoff)
                .filter(|_| !failing.timer.swap(true, Ordering::SeqCst));
            (retry, payload, delay, Arc::clone(&failing.timer))
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
            let writer = self.writer.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(delay).await;
                timer.store(false, Ordering::SeqCst);
                let _ = writer.send(WriterSignal::Kick);
            });
        }
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
