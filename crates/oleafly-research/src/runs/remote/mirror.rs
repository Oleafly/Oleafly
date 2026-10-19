//! The local copy of a remote run: `stdout.log`, `metrics.jsonl`,
//! `exit_code` and the final status in the run's folder, the same files a
//! local run writes, so everything that reads runs stays executor-agnostic.
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::now_ms;
use crate::runs::metrics::{parse_metrics_line, MetricsPoint};
use crate::runs::{RunError, RunStatus};

/// Log bytes one poll brings back, at most.
pub const POLL_LOG_BYTES: u64 = 1024 * 1024;
/// The local copy of a log stops here; the full log stays remote.
pub const MIRROR_CAP: u64 = 64 * 1024 * 1024;
const MAX_PARTIAL: usize = 4 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorState {
    /// Bytes of the remote log already read.
    remote_offset: u64,
    /// Bytes written to the local log (without the cap note).
    local_bytes: u64,
    capped: bool,
    lines: u64,
    /// An unfinished last line, kept for the metrics parser.
    partial: String,
    /// When the log was last brought up to date.
    synced_at: i64,
}

pub(crate) struct RemoteMirror {
    run_dir: PathBuf,
}

fn io(error: std::io::Error) -> RunError {
    RunError::Io(error.to_string())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), RunError> {
    let folder = path
        .parent()
        .ok_or_else(|| RunError::Io("The run folder is missing.".into()))?;
    let temporary = tempfile::NamedTempFile::new_in(folder).map_err(io)?;
    std::fs::write(temporary.path(), bytes).map_err(io)?;
    temporary.persist(path).map_err(|error| io(error.error))?;
    Ok(())
}

impl RemoteMirror {
    pub(crate) fn open(run_dir: &Path) -> Result<Self, RunError> {
        std::fs::create_dir_all(run_dir).map_err(io)?;
        Ok(Self {
            run_dir: run_dir.to_path_buf(),
        })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.run_dir.join(name)
    }

    fn state(&self) -> MirrorState {
        std::fs::read(self.path("mirror.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, state: &MirrorState) -> Result<(), RunError> {
        let bytes = serde_json::to_vec(state).map_err(|error| RunError::Io(error.to_string()))?;
        write_atomic(&self.path("mirror.json"), &bytes)
    }

    /// One poller at a time (the app and the daemon may both watch a run);
    /// the lock holds until the returned file drops.
    pub(crate) fn try_poll_lock(&self) -> Option<std::fs::File> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.path(".poll.lock"))
            .ok()?;
        fs4::FileExt::try_lock(&file).ok()?;
        Some(file)
    }

    /// Where the next read of the remote log starts.
    pub(crate) fn remote_offset(&self) -> u64 {
        self.state().remote_offset
    }

    /// Milliseconds since the log was last synced.
    pub(crate) fn synced_ago(&self) -> i64 {
        now_ms() - self.state().synced_at
    }

    pub(crate) fn log_path(&self) -> PathBuf {
        self.path("stdout.log")
    }

    fn record_metrics(
        &self,
        state: &mut MirrorState,
        text: &str,
        flush: bool,
    ) -> Result<(), RunError> {
        let mut combined = std::mem::take(&mut state.partial);
        combined.push_str(text);
        let mut pieces: Vec<&str> = combined.split('\n').collect();
        let rest = if flush {
            String::new()
        } else {
            pieces.pop().unwrap_or("").to_string()
        };
        let mut points = Vec::new();
        for line in pieces {
            state.lines += 1;
            let metrics = parse_metrics_line(line);
            if !metrics.is_empty() {
                points.push(MetricsPoint {
                    t: now_ms(),
                    line: state.lines,
                    metrics: metrics.into_iter().collect(),
                });
            }
        }
        // A line longer than any metrics line can be dropped.
        state.partial = if rest.len() > MAX_PARTIAL {
            String::new()
        } else {
            rest
        };
        if points.is_empty() {
            return Ok(());
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path("metrics.jsonl"))
            .map_err(io)?;
        for point in points {
            let mut json =
                serde_json::to_vec(&point).map_err(|error| RunError::Io(error.to_string()))?;
            json.push(b'\n');
            file.write_all(&json).map_err(io)?;
        }
        Ok(())
    }

    /// Adds a chunk of the remote log: to the local log (up to 64 MiB, then
    /// one note), its finished lines to `metrics.jsonl`.
    pub(crate) fn append_log(&self, chunk: &[u8], remote_dir: &str) -> Result<(), RunError> {
        let mut state = self.state();
        state.remote_offset += chunk.len() as u64;
        state.synced_at = now_ms();
        if !chunk.is_empty() {
            if !state.capped {
                let room = MIRROR_CAP.saturating_sub(state.local_bytes);
                let take = (chunk.len() as u64).min(room) as usize;
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(self.log_path())
                    .map_err(io)?;
                file.write_all(&chunk[..take]).map_err(io)?;
                state.local_bytes += take as u64;
                if take < chunk.len() {
                    state.capped = true;
                    let _ = writeln!(
                        file,
                        "\n[Oleafly stopped copying this log at 64 MiB. The full log is on the remote computer in {remote_dir}/stdout.log.]"
                    );
                }
            }
            self.record_metrics(&mut state, &String::from_utf8_lossy(chunk), false)?;
        }
        self.save(&state)
    }

    /// The local log stopped at its cap.
    pub(crate) fn capped(&self) -> bool {
        self.state().capped
    }

    /// Log bytes the local copy can still take.
    pub(crate) fn room(&self) -> u64 {
        let state = self.state();
        if state.capped {
            return 0;
        }
        MIRROR_CAP.saturating_sub(state.local_bytes)
    }

    fn tail_path(&self) -> PathBuf {
        self.path("stdout.tail.log")
    }

    /// Keeps the end of a log that outgrew the local copy (the agent reads
    /// its tail), and the metrics on its complete lines.
    pub(crate) fn record_tail(&self, bytes: &[u8]) -> Result<(), RunError> {
        write_atomic(&self.tail_path(), bytes)?;
        let text = String::from_utf8_lossy(bytes);
        let complete = text.find('\n').map_or("", |index| &text[index + 1..]);
        let mut state = self.state();
        state.partial.clear();
        self.record_metrics(&mut state, complete, true)?;
        self.save(&state)
    }

    /// Answers a log query from the local copy (a tail from the kept end
    /// when the copy was capped).
    pub(crate) fn answer(&self, query: &crate::runs::LogQuery) -> Result<String, RunError> {
        let tail = self.tail_path();
        let path = match query {
            crate::runs::LogQuery::Tail { .. } if tail.is_file() => tail,
            _ => self.log_path(),
        };
        crate::runs::log::answer(&path, query).map_err(RunError::Io)
    }

    /// Replaces the local log with a complete copy (Cua downloads it whole).
    pub(crate) fn replace_log(&self, source: &Path) -> Result<(), RunError> {
        let length = std::fs::metadata(source).map_err(io)?.len();
        if length > MIRROR_CAP {
            return Ok(());
        }
        let mut state = self.state();
        let mut rest = Vec::new();
        if length > state.remote_offset {
            use std::io::{Read, Seek, SeekFrom};
            let mut file = std::fs::File::open(source).map_err(io)?;
            file.seek(SeekFrom::Start(state.remote_offset))
                .map_err(io)?;
            file.read_to_end(&mut rest).map_err(io)?;
        }
        std::fs::copy(source, self.log_path()).map_err(io)?;
        state.local_bytes = length;
        state.remote_offset = length;
        state.capped = false;
        state.synced_at = now_ms();
        self.record_metrics(&mut state, &String::from_utf8_lossy(&rest), false)?;
        self.save(&state)
    }

    /// Records how the run ended: `exit_code` and `remote-status.json`.
    pub(crate) fn finalize(
        &self,
        status: &RunStatus,
        exit_code: Option<i32>,
    ) -> Result<(), RunError> {
        let mut state = self.state();
        self.record_metrics(&mut state, "", true)?;
        self.save(&state)?;
        if let Some(code) = exit_code {
            write_atomic(&self.path("exit_code"), code.to_string().as_bytes())?;
        }
        let json = serde_json::to_vec(status).map_err(|error| RunError::Io(error.to_string()))?;
        write_atomic(&self.path("remote-status.json"), &json)
    }

    /// The recorded end of the run, once there is one.
    pub(crate) fn finished(&self) -> Option<RunStatus> {
        let bytes = std::fs::read(self.path("remote-status.json")).ok()?;
        match serde_json::from_slice(&bytes).ok()? {
            status @ (RunStatus::Finished { .. } | RunStatus::Lost { .. }) => Some(status),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::RunOutcomeKind;

    #[test]
    fn log_is_capped_with_a_note_and_offsets_keep_counting() {
        let dir = tempfile::tempdir().unwrap();
        let mirror = RemoteMirror::open(dir.path()).unwrap();
        let mut state = mirror.state();
        state.local_bytes = MIRROR_CAP - 4;
        mirror.save(&state).unwrap();
        mirror.append_log(b"abcdefgh", "runs/t/r").unwrap();
        mirror.append_log(b"ijkl", "runs/t/r").unwrap();
        let log = std::fs::read_to_string(mirror.log_path()).unwrap();
        assert!(
            log.starts_with("abcd") && log.contains("stopped copying"),
            "{log}"
        );
        assert!(!log.contains("ijkl"));
        assert_eq!(mirror.remote_offset(), 12);
    }

    #[test]
    fn metrics_survive_chunks_split_mid_line() {
        let dir = tempfile::tempdir().unwrap();
        let mirror = RemoteMirror::open(dir.path()).unwrap();
        mirror.append_log(b"loss: 0.", "d").unwrap();
        mirror.append_log(b"5\n{\"acc\": 0.9}", "d").unwrap();
        mirror
            .finalize(
                &RunStatus::Finished {
                    exit_code: Some(0),
                    finished_at: 1,
                    outcome: RunOutcomeKind::Succeeded,
                    note: None,
                },
                Some(0),
            )
            .unwrap();
        let summary = crate::runs::metrics::summarize_file(&dir.path().join("metrics.jsonl"));
        assert_eq!(summary.points, 2);
        assert_eq!(summary.last.get("loss"), Some(&0.5));
        assert_eq!(summary.last.get("acc"), Some(&0.9));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("exit_code")).unwrap(),
            "0"
        );
        assert!(mirror.finished().is_some());
    }

    #[test]
    fn poll_lock_is_exclusive() {
        let dir = tempfile::tempdir().unwrap();
        let mirror = RemoteMirror::open(dir.path()).unwrap();
        let held = mirror.try_poll_lock().unwrap();
        assert!(mirror.try_poll_lock().is_none());
        drop(held);
        assert!(mirror.try_poll_lock().is_some());
    }
}
