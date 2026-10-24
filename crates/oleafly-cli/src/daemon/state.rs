//! `state.json`: which helper runs, in which phase, and its heartbeat. It
//! holds no paths to projects and no secrets.
use std::io;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const STATE_VERSION: u32 = 1;
const MAX_STATE_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Starting,
    Ready,
    Stopping,
    Exiting,
}

/// How the helper was started.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServeMode {
    /// By the app when it quit.
    App,
    /// At sign-in.
    AtLogin,
    /// `oleafly daemon run` in a terminal.
    Foreground,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperState {
    pub version: u32,
    pub pid: u32,
    /// The process start time, so a reused pid is never taken for it.
    pub started: Option<u64>,
    pub app_version: String,
    pub mode: ServeMode,
    pub phase: Phase,
    pub started_at: i64,
    pub heartbeat_at: i64,
}

pub fn write_state(path: &Path, state: &HelperState) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(state).map_err(io::Error::other)?;
    oleafly_secrets::fs::write_atomic(path, &bytes).map_err(io::Error::other)?;
    oleafly_secrets::fsperm::harden_file(path);
    Ok(())
}

/// The state file, when it is there and readable.
pub fn read_state(path: &Path) -> Option<HelperState> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_STATE_BYTES {
        return None;
    }
    serde_json::from_slice::<HelperState>(&std::fs::read(path).ok()?)
        .ok()
        .filter(|state| state.version <= STATE_VERSION)
}

/// The helper's own state, written by the serve loop and the heartbeat
/// thread through one lock.
pub struct StateWriter {
    path: std::path::PathBuf,
    state: Mutex<HelperState>,
}

impl StateWriter {
    pub fn new(path: std::path::PathBuf, state: HelperState) -> Self {
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HelperState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn write(&self) -> io::Result<()> {
        let state = self.lock();
        write_state(&self.path, &state)
    }

    pub fn set_phase(&self, phase: Phase) -> io::Result<()> {
        let mut state = self.lock();
        state.phase = phase;
        state.heartbeat_at = now_ms();
        write_state(&self.path, &state)
    }

    pub fn beat(&self) -> io::Result<()> {
        let mut state = self.lock();
        state.heartbeat_at = now_ms();
        write_state(&self.path, &state)
    }

    pub fn phase(&self) -> Phase {
        self.lock().phase
    }

    /// Removes the file when it is still this helper's.
    pub fn remove(&self) {
        let state = self.lock();
        if read_state(&self.path)
            .is_some_and(|current| current.pid == state.pid && current.started == state.started)
        {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub(crate) fn now_ms() -> i64 {
    i64::try_from(crate::record::now_ms()).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> HelperState {
        HelperState {
            version: STATE_VERSION,
            pid: 4242,
            started: Some(99),
            app_version: "0.4.8".into(),
            mode: ServeMode::App,
            phase: Phase::Ready,
            started_at: 1,
            heartbeat_at: 2,
        }
    }

    #[test]
    fn the_state_file_round_trips_and_holds_no_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        write_state(&path, &state()).unwrap();
        assert_eq!(read_state(&path), Some(state()));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"mode\": \"app\"") && text.contains("\"phase\": \"ready\""));
        for word in ["key", "token", "secret", "project"] {
            assert!(!text.to_ascii_lowercase().contains(word), "{word}");
        }
        assert_eq!(
            serde_json::to_value(ServeMode::AtLogin).unwrap(),
            "at-login"
        );
    }

    #[test]
    fn a_newer_or_broken_state_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        std::fs::write(&path, "{").unwrap();
        assert!(read_state(&path).is_none());
        let mut newer = state();
        newer.version = STATE_VERSION + 1;
        write_state(&path, &newer).unwrap();
        assert!(read_state(&path).is_none());
    }

    #[test]
    fn the_writer_removes_only_its_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let writer = StateWriter::new(path.clone(), state());
        writer.set_phase(Phase::Exiting).unwrap();
        assert_eq!(read_state(&path).unwrap().phase, Phase::Exiting);
        let mut other = state();
        other.pid = 7;
        write_state(&path, &other).unwrap();
        writer.remove();
        assert!(path.exists());
        writer.write().unwrap();
        writer.remove();
        assert!(!path.exists());
    }
}
