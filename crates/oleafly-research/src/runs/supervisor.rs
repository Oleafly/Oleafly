//! The process that owns a local run. The app (or the daemon) starts it
//! detached with `--oleafly-run-supervisor <run dir>`; it starts the
//! confined command, writes `stdout.log`, `metrics.jsonl`, `status.json` and
//! `exit_code`, stops the command on `cancel` or at its timeout, and exits.
//! Because it is its own process, a run keeps going when Oleafly quits.
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::metrics::{parse_metrics_line, MetricsPoint};
use super::{RunOutcomeKind, RunSpec, MAX_METRIC_LINES, MAX_RUN_LOG_BYTES};
use crate::model::now_ms;
use oleafly_sandbox::process::identity::{self, ProcessProbe};

pub const SUPERVISOR_FLAG: &str = "--oleafly-run-supervisor";
const POLL: Duration = Duration::from_millis(500);
const TERMINATE_GRACE: Duration = Duration::from_secs(5);
const LOG_CAPPED: &str = "[Oleafly stopped saving this log at 2 GiB]\n";

/// What `status.json` says about a run.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    /// `running` or `finished`.
    pub state: String,
    pub child_pid: Option<u32>,
    /// When the process `child_pid` names started, so a pid another process
    /// has reused is never mistaken for it.
    pub child_started: Option<u64>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub outcome: Option<RunOutcomeKind>,
    pub note: Option<String>,
}

pub fn read_status(run_dir: &Path) -> Option<StatusFile> {
    serde_json::from_slice(&std::fs::read(run_dir.join("status.json")).ok()?).ok()
}

/// Writes `status.json` through a rename, so a reader never sees half.
pub fn write_status(run_dir: &Path, status: &StatusFile) -> Result<(), String> {
    let staging = run_dir.join(format!("status.json.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(status).map_err(|error| error.to_string())?;
    std::fs::write(&staging, bytes)
        .map_err(|error| format!("The run status could not be saved: {error}"))?;
    std::fs::rename(&staging, run_dir.join("status.json"))
        .map_err(|error| format!("The run status could not be saved: {error}"))
}

/// Handles `--oleafly-run-supervisor <dir>` when it is the first argument.
/// Call it first in `main`, before any app setup.
pub fn run_if_requested() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next()? != SUPERVISOR_FLAG {
        return None;
    }
    Some(match args.next() {
        Some(dir) => run_supervisor(Path::new(&dir)),
        None => 2,
    })
}

/// Supervises the run in `run_dir` until it ends. Returns the process exit
/// code of the supervisor itself (0 once the outcome is recorded).
pub fn run_supervisor(run_dir: &Path) -> i32 {
    let started_at = now_ms();
    let spec = match std::fs::read(run_dir.join("spec.json"))
        .map_err(|_| "The run's settings are missing.".to_string())
        .and_then(|bytes| {
            serde_json::from_slice::<RunSpec>(&bytes)
                .map_err(|_| "The run's settings are unreadable.".to_string())
        }) {
        Ok(spec) => spec,
        Err(error) => {
            record_failure(run_dir, started_at, &error);
            return 1;
        }
    };
    match supervise(run_dir, &spec, started_at) {
        Ok(()) => 0,
        Err(error) => {
            record_failure(run_dir, started_at, &error);
            1
        }
    }
}

fn record_failure(run_dir: &Path, started_at: i64, error: &str) {
    let _ = write_status(
        run_dir,
        &StatusFile {
            state: "finished".into(),
            child_pid: None,
            child_started: None,
            started_at,
            finished_at: Some(now_ms()),
            exit_code: None,
            outcome: Some(RunOutcomeKind::Failed),
            note: Some(error.to_owned()),
        },
    );
}

fn run_folder(spec: &RunSpec) -> Result<PathBuf, String> {
    let workspace = spec
        .workspace
        .canonicalize()
        .map_err(|_| "The task workspace is gone.".to_string())?;
    let folder = if spec.cwd_rel.is_empty() {
        workspace.clone()
    } else {
        workspace.join(&spec.cwd_rel)
    };
    let metadata = std::fs::symlink_metadata(&folder).map_err(|_| {
        format!(
            "The folder {} doesn't exist in the workspace.",
            spec.cwd_rel
        )
    })?;
    let resolved = folder.canonicalize().map_err(|_| {
        format!(
            "The folder {} doesn't exist in the workspace.",
            spec.cwd_rel
        )
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || !resolved.starts_with(&workspace)
    {
        return Err("Runs start in a real folder inside the task workspace.".into());
    }
    Ok(resolved)
}

/// Appends lines to the log, up to its cap, and their metrics to
/// `metrics.jsonl`.
struct Recorder {
    log: std::fs::File,
    metrics: std::fs::File,
    written: u64,
    capped: bool,
    line: u64,
    metric_lines: usize,
}

impl Recorder {
    fn record(&mut self, bytes: &[u8]) {
        self.line += 1;
        if !self.capped {
            if self.written + bytes.len() as u64 > MAX_RUN_LOG_BYTES {
                self.capped = true;
                let _ = self.log.write_all(LOG_CAPPED.as_bytes());
            } else if self.log.write_all(bytes).is_ok() {
                self.written += bytes.len() as u64;
            }
        }
        if self.metric_lines < MAX_METRIC_LINES {
            let text = String::from_utf8_lossy(bytes);
            let metrics = parse_metrics_line(&text);
            if !metrics.is_empty() {
                let point = MetricsPoint {
                    t: now_ms(),
                    line: self.line,
                    metrics: metrics.into_iter().collect(),
                };
                if let Ok(mut json) = serde_json::to_vec(&point) {
                    json.push(b'\n');
                    let _ = self.metrics.write_all(&json);
                    self.metric_lines += 1;
                }
            }
        }
    }
}

/// The longest piece of output held in memory at once. A longer line (a
/// progress bar that only returns the carriage, binary data) is recorded in
/// pieces of this size instead of being buffered whole.
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Reads up to the next newline into `buffer`, but at most `max` bytes in
/// all. Returns how many bytes were read; 0 at the end of the stream.
fn read_line_capped(
    reader: &mut impl BufRead,
    buffer: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<usize> {
    let mut total = 0;
    while buffer.len() < max {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if available.is_empty() {
            break;
        }
        let window = &available[..available.len().min(max - buffer.len())];
        let (used, line_end) = match window.iter().position(|byte| *byte == b'\n') {
            Some(index) => (index + 1, true),
            None => (window.len(), false),
        };
        buffer.extend_from_slice(&window[..used]);
        reader.consume(used);
        total += used;
        if line_end {
            break;
        }
    }
    Ok(total)
}

fn drain(
    source: impl std::io::Read + Send + 'static,
    recorder: Arc<Mutex<Recorder>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(source);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match read_line_capped(&mut reader, &mut buffer, MAX_LINE_BYTES) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if !buffer.ends_with(b"\n") {
                        buffer.push(b'\n');
                    }
                    recorder
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .record(&buffer);
                }
            }
        }
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stop {
    Exited,
    Cancelled,
    TimedOut,
}

fn wait_with_stop(child: &mut Child, run_dir: &Path, timeout: Duration) -> Result<Stop, String> {
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("The run could not be watched: {error}"))?
            .is_some()
        {
            return Ok(Stop::Exited);
        }
        if run_dir.join("cancel").exists() {
            return Ok(Stop::Cancelled);
        }
        if started.elapsed() >= timeout {
            return Ok(Stop::TimedOut);
        }
        std::thread::sleep(POLL);
    }
}

/// Asks the run's process group to stop, then kills it after a grace period.
fn terminate(child: &mut Child, guard: oleafly_sandbox::process::ProcessTreeGuard) {
    #[cfg(unix)]
    {
        oleafly_sandbox::process::signal_process_group(guard.process_group(), libc::SIGTERM);
        let deadline = Instant::now() + TERMINATE_GRACE;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    // Dropping the guard kills the group (Unix) or closes the kill-on-close
    // job (Windows).
    drop(guard);
    let _ = child.wait();
}

fn supervise(run_dir: &Path, spec: &RunSpec, started_at: i64) -> Result<(), String> {
    let sandbox = spec
        .sandbox
        .clone()
        .ok_or_else(|| "This run has no sandbox settings.".to_string())?;
    let folder = run_folder(spec)?;
    // The shell line goes through as written: `/bin/sh -c` on macOS and Linux,
    // and `cmd.exe /D /S /C "<line>"` on Windows, where quoting it like an
    // argument would turn every `"` of the command into `\"`.
    let mut command =
        oleafly_sandbox::shell_command(&sandbox, &spec.command).map_err(String::from)?;
    // `cmd.exe` refuses a `\\?\` working folder and starts in the Windows
    // folder instead, so the child gets the plain form of the path.
    command
        .current_dir(oleafly_core::plain_path(&folder))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    oleafly_sandbox::process::isolate_std_process_tree(&mut command);
    let open = |name: &str| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(run_dir.join(name))
            .map_err(|error| format!("The run log could not be opened: {error}"))
    };
    let recorder = Arc::new(Mutex::new(Recorder {
        log: open("stdout.log")?,
        metrics: open("metrics.jsonl")?,
        written: 0,
        capped: false,
        line: 0,
        metric_lines: 0,
    }));
    let mut child = command
        .spawn()
        .map_err(|error| format!("The run could not start: {error}"))?;
    let guard = match oleafly_sandbox::process::contain_process_tree(child.id()) {
        Ok(guard) => guard,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("The run could not be contained: {error}"));
        }
    };
    let child_started = match identity::probe(child.id()) {
        ProcessProbe::Running { started } => started,
        ProcessProbe::Gone => None,
    };
    write_status(
        run_dir,
        &StatusFile {
            state: "running".into(),
            child_pid: Some(child.id()),
            child_started,
            started_at,
            ..StatusFile::default()
        },
    )?;
    let readers: Vec<_> = [
        child.stdout.take().map(|out| drain(out, recorder.clone())),
        child.stderr.take().map(|err| drain(err, recorder.clone())),
    ]
    .into_iter()
    .flatten()
    .collect();
    let stop = wait_with_stop(&mut child, run_dir, spec.timeout)?;
    let exit_code = if stop == Stop::Exited {
        // Background jobs the command left behind end with it.
        let status = child.wait().ok();
        drop(guard);
        status.and_then(|status| status.code())
    } else {
        terminate(&mut child, guard);
        None
    };
    // Pipes close once every process of the group is gone; do not wait
    // forever on a process that escaped the group.
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for reader in readers {
            let _ = reader.join();
        }
        let _ = sender.send(());
    });
    let _ = receiver.recv_timeout(TERMINATE_GRACE);
    let outcome = match stop {
        Stop::Cancelled => RunOutcomeKind::Cancelled,
        Stop::TimedOut => RunOutcomeKind::TimedOut,
        Stop::Exited if exit_code == Some(0) => RunOutcomeKind::Succeeded,
        Stop::Exited => RunOutcomeKind::Failed,
    };
    let code_text = exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "none".into());
    let _ = std::fs::write(run_dir.join("exit_code"), format!("{code_text}\n"));
    write_status(
        run_dir,
        &StatusFile {
            state: "finished".into(),
            child_pid: None,
            child_started: None,
            started_at,
            finished_at: Some(now_ms()),
            exit_code,
            outcome: Some(outcome),
            note: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recorder(dir: &Path) -> Arc<Mutex<Recorder>> {
        let open = |name: &str| std::fs::File::create(dir.join(name)).unwrap();
        Arc::new(Mutex::new(Recorder {
            log: open("stdout.log"),
            metrics: open("metrics.jsonl"),
            written: 0,
            capped: false,
            line: 0,
            metric_lines: 0,
        }))
    }

    #[test]
    fn output_without_a_newline_is_recorded_in_bounded_pieces() {
        let dir = tempfile::tempdir().unwrap();
        let recorder = recorder(dir.path());
        // A progress bar that never ends its line, then a normal line.
        let mut output = vec![b'x'; 3 * MAX_LINE_BYTES + 100];
        output.extend_from_slice(b"\nloss=0.5\n");
        drain(std::io::Cursor::new(output), recorder.clone())
            .join()
            .unwrap();

        let log = std::fs::read(dir.path().join("stdout.log")).unwrap();
        let lines: Vec<&[u8]> = log.split(|byte| *byte == b'\n').collect();
        // Three full pieces (each gets the newline it lacked), the 100 byte
        // rest of the long line, the metric line and the empty tail after the
        // last newline.
        assert_eq!(lines.len(), 6, "{}", log.len());
        assert!(lines[..3].iter().all(|line| line.len() == MAX_LINE_BYTES));
        assert!(lines[..3]
            .iter()
            .flat_map(|line| line.iter())
            .all(|byte| *byte == b'x'));
        assert_eq!(lines[4], b"loss=0.5");
        assert_eq!(recorder.lock().unwrap().line, 5);
        let metrics = std::fs::read_to_string(dir.path().join("metrics.jsonl")).unwrap();
        assert!(metrics.contains("\"loss\":0.5"), "{metrics}");
    }

    #[test]
    fn a_line_ends_at_its_newline_even_across_reads() {
        let mut reader =
            std::io::BufReader::with_capacity(4, std::io::Cursor::new(b"ab\ncdefgh\ni".to_vec()));
        let mut seen = Vec::new();
        loop {
            let mut buffer = Vec::new();
            if read_line_capped(&mut reader, &mut buffer, 1024).unwrap() == 0 {
                break;
            }
            seen.push(String::from_utf8(buffer).unwrap());
        }
        assert_eq!(seen, vec!["ab\n", "cdefgh\n", "i"]);
    }
}
