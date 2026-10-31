use std::io;
use std::path::Path;

use oleafly_sandbox::process::identity::{self, owner_is_live, probe, ProcessIdentity};
use serde::{Deserialize, Serialize};

use super::state::now_ms;

const MAX_REQUEST_BYTES: u64 = 4 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopRequest {
    by: String,
    at: i64,
}

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

pub fn fresh_stop_request(path: &Path, started_ms: i64) -> bool {
    let Some(at) = requested_at(path) else {
        return false;
    };
    let _ = std::fs::remove_file(path);
    at >= started_ms
}

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

pub fn mark_app_closed(path: &Path) {
    if open_app(path).is_some_and(|owner| owner == identity::current()) {
        let _ = std::fs::remove_file(path);
    }
}

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
