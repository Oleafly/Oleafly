//! Cancelling a clone or an import of a Git repository. The webview emits
//! [`IMPORT_CANCEL_EVENT`]; that flips an [`ImportCancel`], which stops the
//! Git command that is running (its whole process tree) and every step after
//! it. The event names the import it stops by the id the webview gave the
//! command, so a Cancel in one window never stops another window's import.
//! An event without an id stops every import, as before ids.
use std::io;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, EventId, Listener, Runtime};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::watch;

/// Emitted by the import dialog's Cancel button and by closing the dialog
/// while a repository is being fetched.
pub(crate) const IMPORT_CANCEL_EVENT: &str = "import-cancel";

/// A transfer's output beyond this is dropped; Git's progress lines are small.
const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

/// A switch one import checks between its steps and waits on while a command
/// runs. Cheap to clone; every clone is the same switch.
#[derive(Clone)]
pub(crate) struct ImportCancel {
    switch: Arc<watch::Sender<bool>>,
}

impl ImportCancel {
    pub(crate) fn new() -> ImportCancel {
        ImportCancel {
            switch: Arc::new(watch::channel(false).0),
        }
    }

    pub(crate) fn cancel(&self) {
        self.switch.send_replace(true);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        *self.switch.borrow()
    }

    /// Resolves once the switch is flipped (at once when it already is).
    pub(crate) async fn cancelled(&self) {
        let mut receiver = self.switch.subscribe();
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }

    /// The error a cancelled import ends with.
    pub(crate) fn error() -> String {
        crate::app_error::AppError::new("git.import_cancelled").into()
    }

    /// `Err` once cancelled, for the places between two steps.
    pub(crate) fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(ImportCancel::error())
        } else {
            Ok(())
        }
    }
}

/// Keeps an [`ImportCancel`] wired to [`IMPORT_CANCEL_EVENT`] while it lives.
pub(crate) struct CancelOnEvent<R: Runtime> {
    app: AppHandle<R>,
    id: EventId,
}

impl<R: Runtime> Drop for CancelOnEvent<R> {
    fn drop(&mut self) {
        self.app.unlisten(self.id);
    }
}

/// What the cancel event carries.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    #[serde(default)]
    cancel_id: Option<String>,
}

/// Whether a cancel event with `payload` stops the import with `cancel_id`:
/// when both name an import, only the same one.
fn stops(payload: &str, cancel_id: Option<&str>) -> bool {
    let requested = serde_json::from_str::<CancelRequest>(payload)
        .ok()
        .and_then(|request| request.cancel_id);
    match (requested, cancel_id) {
        (Some(requested), Some(own)) => requested == own,
        _ => true,
    }
}

/// A new switch that the cancel event for `cancel_id` flips until the
/// returned guard drops. Call it before the command's first await.
pub(crate) fn cancel_on_event<R: Runtime>(
    app: &AppHandle<R>,
    cancel_id: Option<String>,
) -> (ImportCancel, CancelOnEvent<R>) {
    let cancel = ImportCancel::new();
    let flipped = cancel.clone();
    let id = app.listen_any(IMPORT_CANCEL_EVENT, move |event| {
        if stops(event.payload(), cancel_id.as_deref()) {
            flipped.cancel();
        }
    });
    (
        cancel,
        CancelOnEvent {
            app: app.clone(),
            id,
        },
    )
}

/// Run `command` to its end like `proc::output_contained_with_bounds`: its
/// process tree is contained, a command that stays silent for `idle` or runs
/// past `total` is stopped. Unlike it, flipping `cancel` stops the command at
/// once (`ErrorKind::Interrupted`). Blocking: call it from a blocking worker.
pub(crate) fn output_until_cancelled(
    command: Command,
    idle: Duration,
    total: Duration,
    cancel: &ImportCancel,
) -> io::Result<Output> {
    tauri::async_runtime::block_on(collect(command, idle, total, cancel.clone()))
}

async fn collect(
    command: Command,
    idle: Duration,
    total: Duration,
    cancel: ImportCancel,
) -> io::Result<Output> {
    if cancel.is_cancelled() {
        return Err(interrupted());
    }
    let mut command = tokio::process::Command::from(command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut command);
    let mut child = command.spawn()?;
    let containment = crate::proc::contain_process_tree(
        child
            .id()
            .ok_or_else(|| io::Error::other("child has no process id"))?,
    )?;
    let mut containment = Some(containment);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("missing stderr"))?;
    let started = Instant::now();
    let activity = AtomicU64::new(0);
    let result = {
        let finished = async {
            let wait = async {
                let status = child.wait().await?;
                // A helper may leave a descendant holding a pipe open: stop
                // the owned tree as soon as its leader is done.
                drop(containment.take());
                Ok::<_, io::Error>(status)
            };
            let (status, stdout, stderr) = tokio::try_join!(
                wait,
                drain(stdout, started, &activity),
                drain(stderr, started, &activity)
            )?;
            Ok(Output {
                status,
                stdout,
                stderr,
            })
        };
        tokio::select! {
            finished = finished => finished,
            () = quiet(started, &activity, idle) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "command stopped reporting progress and was stopped",
            )),
            () = tokio::time::sleep(total) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "command timed out and was stopped",
            )),
            () = cancel.cancelled() => Err(interrupted()),
        }
    };
    drop(containment);
    if result.is_err() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(CLEANUP_TIMEOUT, child.wait()).await;
    }
    result
}

fn interrupted() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "cancelled")
}

/// Read a pipe to its end, keeping the first [`OUTPUT_LIMIT`] bytes. Every
/// read counts as the command making progress.
async fn drain(
    mut pipe: impl AsyncRead + Unpin,
    started: Instant,
    activity: &AtomicU64,
) -> io::Result<Vec<u8>> {
    let mut kept = Vec::new();
    let mut bytes = [0; 8192];
    loop {
        let count = pipe.read(&mut bytes).await?;
        activity.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
        if count == 0 {
            return Ok(kept);
        }
        let room = OUTPUT_LIMIT.saturating_sub(kept.len());
        kept.extend_from_slice(&bytes[..room.min(count)]);
    }
}

/// Resolves once neither pipe has delivered anything for `idle`.
async fn quiet(started: Instant, activity: &AtomicU64, idle: Duration) {
    loop {
        let last = Duration::from_millis(activity.load(Ordering::Relaxed));
        let silent = started.elapsed().saturating_sub(last);
        if silent >= idle {
            return;
        }
        tokio::time::sleep(idle - silent).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Emitter;

    #[test]
    fn a_cancel_stops_only_the_import_it_names() {
        let app = tauri::test::mock_app();
        let (mine, _mine) = cancel_on_event(app.handle(), Some("import-a".into()));
        let (theirs, _theirs) = cancel_on_event(app.handle(), Some("import-b".into()));
        app.handle()
            .emit(
                IMPORT_CANCEL_EVENT,
                serde_json::json!({ "cancelId": "import-b" }),
            )
            .unwrap();
        assert!(!mine.is_cancelled(), "another window's Cancel");
        assert!(theirs.is_cancelled());

        // A cancel without an id stops every import, as before ids.
        app.handle().emit(IMPORT_CANCEL_EVENT, ()).unwrap();
        assert!(mine.is_cancelled());
    }

    #[test]
    fn the_cancel_event_flips_the_switch_until_the_guard_drops() {
        let app = tauri::test::mock_app();
        let (cancel, guard) = cancel_on_event(app.handle(), None);
        assert!(!cancel.is_cancelled());
        assert!(cancel.check().is_ok());
        app.handle().emit(IMPORT_CANCEL_EVENT, ()).unwrap();
        assert!(cancel.is_cancelled());
        assert!(cancel.check().unwrap_err().contains("git.import_cancelled"));

        let (later, guard_later) = cancel_on_event(app.handle(), None);
        drop(guard_later);
        drop(guard);
        app.handle().emit(IMPORT_CANCEL_EVENT, ()).unwrap();
        assert!(!later.is_cancelled(), "a dropped guard stops listening");
    }

    #[cfg(unix)]
    fn shell(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.args(["-c", script]);
        command
    }

    #[cfg(unix)]
    #[test]
    fn output_and_the_exit_status_come_back_when_nothing_cancels() {
        let output = output_until_cancelled(
            shell("printf out; printf err >&2; exit 3"),
            Duration::from_secs(30),
            Duration::from_secs(60),
            &ImportCancel::new(),
        )
        .unwrap();
        assert_eq!(output.stdout, b"out");
        assert_eq!(output.stderr, b"err");
        assert_eq!(output.status.code(), Some(3));
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_stops_the_command_and_what_it_started() {
        let marker = tempfile::tempdir().unwrap();
        let grandchild = marker.path().join("grandchild-ran");
        // The shell starts a background sleeper and then waits for it.
        let script = format!(
            "(sleep 60; touch '{}') & wait",
            grandchild.to_string_lossy()
        );
        let cancel = ImportCancel::new();
        let stopper = cancel.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            stopper.cancel();
        });
        let started = Instant::now();
        let error = output_until_cancelled(
            shell(&script),
            Duration::from_secs(120),
            Duration::from_secs(300),
            &cancel,
        )
        .unwrap_err();
        canceller.join().unwrap();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(started.elapsed() < Duration::from_secs(20));
        assert!(!grandchild.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_switch_that_is_already_flipped_never_starts_the_command() {
        let cancel = ImportCancel::new();
        cancel.cancel();
        let marker = tempfile::tempdir().unwrap();
        let file = marker.path().join("started");
        let error = output_until_cancelled(
            shell(&format!("touch '{}'", file.to_string_lossy())),
            Duration::from_secs(30),
            Duration::from_secs(60),
            &cancel,
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_silent_command_is_stopped_without_waiting_for_the_backstop() {
        let started = Instant::now();
        let error = output_until_cancelled(
            shell("sleep 60"),
            Duration::from_millis(300),
            Duration::from_secs(300),
            &ImportCancel::new(),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(20));
    }
}
