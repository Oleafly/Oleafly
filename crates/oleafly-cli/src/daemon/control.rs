//! Asking the helper to stop: a `stop-request` file in its folder. The app,
//! `oleafly daemon stop` and the Windows installer write it; the helper
//! checks it every second, hands its tasks back to the app and exits.
//!
//! A request older than the running helper is left over from an earlier
//! one and is ignored.
//!
//! The open app also leaves its process identity in `app-open.json`. While
//! that process runs, the helper leaves task notifications to the app,
//! which shows them by its own rules (none while a window has focus).
use std::io;
use std::path::Path;

use oleafly_sandbox::process::identity::{self, owner_is_live, probe, ProcessIdentity};
use serde::{Deserialize, Serialize};

use super::state::now_ms;

const MAX_REQUEST_BYTES: u64 = 4 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopRequest {
    /// `app`, `cli`, `update` or `installer`.
    by: String,
    /// When it was asked (epoch ms).
    at: i64,
}

/// Writes a stop request.
pub fn write_stop_request(path: &Path, by: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let request = StopRequest {
        by: by
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(32)
            .collect(),
        at: now_ms(),
    };
    let bytes = serde_json::to_vec(&request).map_err(io::Error::other)?;
    oleafly_secrets::fs::write_atomic(path, &bytes).map_err(io::Error::other)
}

/// When the request was made: its `at`, or the file's time for a request
/// without one (the installer writes plain text).
fn requested_at(path: &Path) -> Option<i64> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let from_content = (metadata.len() <= MAX_REQUEST_BYTES)
        .then(|| std::fs::read(path).ok())
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<StopRequest>(&bytes).ok())
        .map(|request| request.at);
    from_content.or_else(|| {
        metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
    })
}

/// Whether a stop request arrived since the helper started (`started_ms`).
/// The file is removed either way: a fresh request is being handled, an
/// older one is stale.
pub fn fresh_stop_request(path: &Path, started_ms: i64) -> bool {
    let Some(at) = requested_at(path) else {
        return false;
    };
    let _ = std::fs::remove_file(path);
    at >= started_ms
}

/// Records this process as the open app.
pub fn mark_app_open(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(&identity::current()).map_err(io::Error::other)?;
    oleafly_secrets::fs::write_atomic(path, &bytes).map_err(io::Error::other)
}

fn open_app(path: &Path) -> Option<ProcessIdentity> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_REQUEST_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Removes the record when this process wrote it.
pub fn mark_app_closed(path: &Path) {
    if open_app(path).is_some_and(|owner| owner == identity::current()) {
        let _ = std::fs::remove_file(path);
    }
}

/// Whether the recorded app process still runs (same pid, same start
/// time). A record left by an app that crashed reads as closed.
pub fn app_is_open(path: &Path) -> bool {
    owner_is_live(open_app(path), identity::current(), probe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_open_app_record_follows_the_process_that_wrote_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemon").join("app-open.json");
        assert!(!app_is_open(&path));
        // A record of this very process never counts (the helper is not the app).
        mark_app_open(&path).unwrap();
        assert!(!app_is_open(&path));
        mark_app_closed(&path);
        assert!(!path.exists());
        let mut other = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sleep" })
            .args(if cfg!(windows) {
                vec!["/c", "ping -n 30 127.0.0.1 >NUL"]
            } else {
                vec!["30"]
            })
            .spawn()
            .unwrap();
        let started = match probe(other.id()) {
            identity::ProcessProbe::Running { started } => started,
            identity::ProcessProbe::Gone => None,
        };
        let record = ProcessIdentity {
            pid: other.id(),
            started,
        };
        std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(app_is_open(&path));
        // Another process's record stays when this one closes.
        mark_app_closed(&path);
        assert!(path.exists());
        let _ = other.kill();
        let _ = other.wait();
        assert!(!app_is_open(&path));
    }

    #[test]
    fn a_stop_request_older_than_the_helper_is_ignored_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stop-request");
        write_stop_request(&path, "cli").unwrap();
        assert!(!fresh_stop_request(&path, now_ms() + 60_000));
        assert!(!path.exists());
    }

    #[test]
    fn a_fresh_stop_request_is_seen_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stop-request");
        let started = now_ms() - 1_000;
        assert!(!fresh_stop_request(&path, started));
        write_stop_request(&path, "app").unwrap();
        assert!(fresh_stop_request(&path, started));
        assert!(!fresh_stop_request(&path, started));
    }

    #[test]
    fn the_installers_plain_request_counts_by_its_file_time() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stop-request");
        std::fs::write(&path, "installer").unwrap();
        assert!(fresh_stop_request(&path, now_ms() - 60_000));
    }
}
