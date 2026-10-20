//! Runs on an SSH host, and the lifecycle the Slurm executor shares: probe,
//! upload, start detached, poll with a bounded log copy, and at the end the
//! rest of the log and the files the run made, copied into
//! `runs/<run id>/outputs/` in the task workspace.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use serde::{Deserialize, Serialize};

use super::archive::{
    pack_reader, unpack_into, workspace_bytes, PackLimits, UnpackLimits, UnpackSummary,
};
use super::mirror::{RemoteMirror, POLL_LOG_BYTES};
use super::rsync::{local_rsync, rsync_args, rsync_shell};
use super::scripts::{self, sh_quote, Detach, Probe, RemoteRun, RemoteState};
use super::settings::{self, ComputeTarget};
use super::transport::{
    self, no_window, HostKeyMode, SshContext, SshEndpoint, SshInput, SshLimits,
};
use super::{handle_data, outputs_folder, ComputeHost};
use crate::model::now_ms;
use crate::runs::{
    LogQuery, RunError, RunExecutor, RunHandle, RunOutcomeKind, RunSpec, RunStatus, HANDLE_VERSION,
};

pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const SMALL_OUTPUT: usize = 256 * 1024;
const POLL_OUTPUT: usize = 2 * 1024 * 1024;
const OUTPUTS_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const TAIL_BYTES: u64 = 256 * 1024;
/// How long past its own time limit a run may stay out of reach before it
/// counts as lost.
const LOST_AFTER_MS: i64 = 60 * 60 * 1000;
/// `read_log` brings the copy up to date when it is older than this.
pub(crate) const SYNC_EVERY_MS: i64 = 5_000;
const CANCEL_GRACE_SECS: u64 = 10;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncMode {
    Rsync,
    Tar,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshHandleData {
    pub target_id: String,
    pub endpoint: SshEndpoint,
    pub remote_dir: String,
    pub remote_home: String,
    pub sync: SyncMode,
    pub detach: Detach,
    /// The task workspace the outputs come back to.
    pub workspace: PathBuf,
    pub timeout_secs: u64,
}

/// The compute target a run names, from `compute.json`.
pub(crate) fn load_target(
    host: &dyn ComputeHost,
    target: Option<&str>,
) -> Result<ComputeTarget, RunError> {
    let id = target.ok_or_else(|| {
        RunError::Config("This task has no compute target. Choose one in the task's brief.".into())
    })?;
    let saved = settings::load(&host.data_root());
    settings::find(&saved, id).cloned().ok_or_else(|| {
        RunError::Config(
            "The task's compute target was removed. Choose another one in the task's brief.".into(),
        )
    })
}

pub(crate) fn save_handle(handle: &RunHandle) -> Result<(), RunError> {
    let json =
        serde_json::to_vec_pretty(handle).map_err(|error| RunError::Io(error.to_string()))?;
    std::fs::create_dir_all(&handle.run_dir).map_err(|error| RunError::Io(error.to_string()))?;
    crate::runs::local::write_private(&handle.run_dir.join("handle.json"), &json)
        .map_err(RunError::Io)
}

pub(crate) fn running(handle: &RunHandle, note: Option<String>) -> RunStatus {
    RunStatus::Running {
        started_at: handle.started_at,
        note,
    }
}

pub(crate) fn finished(exit_code: Option<i32>, outcome: RunOutcomeKind) -> RunStatus {
    RunStatus::Finished {
        exit_code,
        finished_at: now_ms(),
        outcome,
        note: None,
    }
}

pub(crate) fn outcome_for(code: i32) -> RunOutcomeKind {
    if code == 0 {
        RunOutcomeKind::Succeeded
    } else {
        RunOutcomeKind::Failed
    }
}

fn with_note(status: RunStatus, extra: Option<String>) -> RunStatus {
    let Some(extra) = extra else {
        return status;
    };
    match status {
        RunStatus::Finished {
            exit_code,
            finished_at,
            outcome,
            note,
        } => RunStatus::Finished {
            exit_code,
            finished_at,
            outcome,
            note: Some(match note {
                Some(note) => format!("{note} {extra}"),
                None => extra,
            }),
        },
        RunStatus::Lost { reason } => RunStatus::Lost {
            reason: format!("{reason} {extra}"),
        },
        other => other,
    }
}

fn exit_code_of(status: &RunStatus) -> Option<i32> {
    match status {
        RunStatus::Finished { exit_code, .. } => *exit_code,
        _ => None,
    }
}

/// A run that cannot be reached right now keeps running with a note, until
/// its time limit and another hour have passed.
pub(crate) fn unreachable(
    handle: &RunHandle,
    timeout_secs: u64,
    mirror: &RemoteMirror,
    host: &str,
    error: &RunError,
) -> Result<RunStatus, RunError> {
    let deadline = handle.started_at + (timeout_secs as i64).saturating_mul(1000) + LOST_AFTER_MS;
    if now_ms() < deadline {
        return Ok(running(
            handle,
            Some(format!("Connection lost, retrying. {error}")),
        ));
    }
    let lost = RunStatus::Lost {
        reason: format!("Oleafly lost contact with {host}. {error}"),
    };
    mirror.finalize(&lost, None)?;
    Ok(lost)
}

fn summary_note(summary: &UnpackSummary, run_id: &str) -> Option<String> {
    let folder = outputs_folder(run_id);
    let mut note = match summary.files {
        0 => {
            return (!summary.skipped.is_empty()).then(|| {
                format!(
                    "{} output files were too large to copy.",
                    summary.skipped.len()
                )
            })
        }
        1 => format!("Copied 1 output file to {folder}/."),
        count => format!("Copied {count} output files to {folder}/."),
    };
    if !summary.skipped.is_empty() {
        note.push_str(&format!(
            " Skipped {} (over 64 MiB, over the 512 MiB total or not a plain file): {}",
            summary.skipped.len(),
            summary
                .skipped
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    Some(note)
}

/// `runs/<id>/outputs` in the workspace, emptied of an earlier partial copy,
/// opened so no link can lead out of the workspace.
fn fresh_outputs(workspace: &Path, run_id: &str) -> Result<cap_std::fs::Dir, RunError> {
    let root = cap_std::fs::Dir::open_ambient_dir(workspace, cap_std::ambient_authority())
        .map_err(|error| {
            RunError::Io(format!("The task workspace could not be opened: {error}"))
        })?;
    let relative = outputs_folder(run_id);
    let _ = root.remove_dir_all(&relative);
    root.create_dir_all(&relative).map_err(|error| {
        RunError::Io(format!("The outputs folder could not be created: {error}"))
    })?;
    root.open_dir(&relative)
        .map_err(|error| RunError::Io(format!("The outputs folder could not be opened: {error}")))
}

fn outputs_done(run_dir: &Path) -> bool {
    run_dir.join("outputs.done").exists()
}

/// One host as every call of a run reaches it.
pub(crate) struct Remote {
    pub(crate) ctx: SshContext,
    pub(crate) endpoint: SshEndpoint,
    cancel: CancellationToken,
}

impl Remote {
    pub(crate) fn new(host: &dyn ComputeHost, endpoint: SshEndpoint) -> Result<Self, RunError> {
        let ctx = SshContext::new(&host.data_root(), &|name| host.locate_program(name))?;
        Ok(Self {
            ctx,
            endpoint,
            cancel: CancellationToken::new(),
        })
    }

    pub(crate) fn host(&self) -> &str {
        &self.endpoint.host
    }

    /// Runs a script with `sh -s` and returns what it printed.
    pub(crate) async fn script(
        &self,
        script: &str,
        timeout: Duration,
        max_output: usize,
    ) -> Result<String, RunError> {
        transport::run_ok(
            &self.ctx,
            &self.endpoint,
            &HostKeyMode::Strict,
            "sh -s",
            SshInput::Script(script.to_string()),
            SshLimits::new(timeout, max_output),
            &self.cancel,
        )
        .await
        .map(|output| output.text())
    }

    pub(crate) async fn probe(&self) -> Result<Probe, RunError> {
        scripts::parse_probe(
            &self
                .script(scripts::probe_script(), CALL_TIMEOUT, SMALL_OUTPUT)
                .await?,
        )
    }

    /// Sends the workspace to `<dir>/work`: rsync when both ends have it,
    /// else a streamed `tar.gz`.
    pub(crate) async fn upload(
        &self,
        workspace: &Path,
        dir: &str,
        rsync: Option<&Path>,
    ) -> Result<SyncMode, RunError> {
        let bytes = workspace_bytes(workspace);
        let timeout = Duration::from_secs((bytes / (1024 * 1024)).max(600));
        let quoted = sh_quote(dir);
        if let Some(program) = rsync {
            self.script(
                &format!("mkdir -p {quoted}/work\n"),
                CALL_TIMEOUT,
                SMALL_OUTPUT,
            )
            .await?;
            let shell = rsync_shell(&self.ctx, &self.endpoint);
            let mut command = tokio::process::Command::new(program);
            command
                .args(rsync_args(
                    &shell,
                    workspace,
                    dir,
                    &self.endpoint.destination(),
                ))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);
            no_window(&mut command);
            let output = tokio::time::timeout(timeout, command.output())
                .await
                .map_err(|_| {
                    RunError::Network(format!(
                        "Sending the workspace to {} took too long.",
                        self.host()
                    ))
                })?
                .map_err(|error| {
                    RunError::Unavailable(format!("rsync could not start: {error}"))
                })?;
            if !output.status.success() {
                return Err(transport::classify(
                    output.status.code(),
                    &String::from_utf8_lossy(&output.stderr),
                    self.host(),
                ));
            }
            return Ok(SyncMode::Rsync);
        }
        let (reader, packing) = pack_reader(workspace.to_path_buf(), PackLimits::default());
        let unpack = format!("mkdir -p {quoted}/work && tar -xzmf - -C {quoted}/work");
        let sent = transport::run(
            &self.ctx,
            &self.endpoint,
            &HostKeyMode::Strict,
            &format!("sh -c {}", sh_quote(&unpack)),
            SshInput::Reader(Box::new(reader)),
            SshLimits::new(timeout, SMALL_OUTPUT),
            &self.cancel,
        )
        .await;
        // A packing error (a workspace that is too large) explains more.
        packing.await.map_err(|error| {
            RunError::Io(format!("The workspace could not be packed: {error}"))
        })??;
        let sent = sent?;
        if sent.code != Some(0) {
            return Err(transport::classify(sent.code, &sent.stderr, self.host()));
        }
        Ok(SyncMode::Tar)
    }

    /// Runs a poll script, adds its log chunk to the copy and returns
    /// everything it printed.
    pub(crate) async fn exchange(
        &self,
        mirror: &RemoteMirror,
        dir: &str,
        script: &str,
    ) -> Result<String, RunError> {
        let stdout = self.script(script, CALL_TIMEOUT, POLL_OUTPUT).await?;
        let (_, chunk) = scripts::parse_log(&stdout)?;
        mirror.append_log(&chunk, dir)?;
        Ok(stdout)
    }

    /// The rest of the log, up to what the local copy holds.
    pub(crate) async fn drain(
        &self,
        mirror: &RemoteMirror,
        dir: &str,
        run_dir: &Path,
    ) -> Result<(), RunError> {
        let room = mirror.room();
        if room == 0 {
            return Ok(());
        }
        let command = format!(
            "tail -c +{} {}/stdout.log 2>/dev/null | head -c {}",
            mirror.remote_offset() + 1,
            sh_quote(dir),
            room + 1
        );
        let run_dir = run_dir.to_path_buf();
        let remote_dir = dir.to_string();
        let (result, output) = transport::run_streaming(
            &self.ctx,
            &self.endpoint,
            &HostKeyMode::Strict,
            &format!("sh -c {}", sh_quote(&command)),
            SshInput::Empty,
            OUTPUTS_TIMEOUT,
            &self.cancel,
            move |reader| -> Result<(), RunError> {
                let mirror = RemoteMirror::open(&run_dir)?;
                let mut buffer = vec![0u8; POLL_LOG_BYTES as usize];
                loop {
                    let read = reader
                        .read(&mut buffer)
                        .map_err(|error| RunError::Io(error.to_string()))?;
                    if read == 0 {
                        return Ok(());
                    }
                    mirror.append_log(&buffer[..read], &remote_dir)?;
                }
            },
        )
        .await?;
        result?;
        if output.code != Some(0) {
            return Err(transport::classify(
                output.code,
                &output.stderr,
                self.host(),
            ));
        }
        if mirror.capped() {
            let tail = format!("tail -c {TAIL_BYTES} {}/stdout.log", sh_quote(dir));
            let output = transport::run_ok(
                &self.ctx,
                &self.endpoint,
                &HostKeyMode::Strict,
                &format!("sh -c {}", sh_quote(&tail)),
                SshInput::Empty,
                SshLimits::new(CALL_TIMEOUT, TAIL_BYTES as usize + 1),
                &self.cancel,
            )
            .await?;
            mirror.record_tail(&output.stdout)?;
        }
        Ok(())
    }

    /// The files the run made, into `runs/<id>/outputs/` of the workspace.
    pub(crate) async fn fetch_outputs(
        &self,
        dir: &str,
        workspace: &Path,
        run_id: &str,
    ) -> Result<UnpackSummary, RunError> {
        let dest = fresh_outputs(workspace, run_id)?;
        let (summary, output) = transport::run_streaming(
            &self.ctx,
            &self.endpoint,
            &HostKeyMode::Strict,
            "sh -s",
            SshInput::Script(scripts::outputs_script(dir, false)),
            OUTPUTS_TIMEOUT,
            &self.cancel,
            move |reader| unpack_into(reader, &dest, &UnpackLimits::default()),
        )
        .await?;
        let summary = summary?;
        // Stopping early at a cap ends the transfer, so the exit status of
        // a copy that was cut short is not an error.
        if output.code != Some(0) && summary.files == 0 && summary.skipped.is_empty() {
            return Err(transport::classify(
                output.code,
                &output.stderr,
                self.host(),
            ));
        }
        Ok(summary)
    }

    /// The end of a run: the rest of the log, its outputs, the final status.
    /// A connection problem keeps the run open to try again.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn settle(
        &self,
        mirror: &RemoteMirror,
        handle: &RunHandle,
        dir: &str,
        workspace: &Path,
        timeout_secs: u64,
        end: RunStatus,
        fetch: bool,
    ) -> Result<RunStatus, RunError> {
        if let Err(error) = self.drain(mirror, dir, &handle.run_dir).await {
            return unreachable(handle, timeout_secs, mirror, self.host(), &error);
        }
        let mut note = None;
        if fetch && !outputs_done(&handle.run_dir) {
            match self.fetch_outputs(dir, workspace, &handle.run_id).await {
                Ok(summary) => {
                    let _ = tokio::fs::write(handle.run_dir.join("outputs.done"), b"").await;
                    note = summary_note(&summary, &handle.run_id);
                }
                Err(error @ (RunError::Network(_) | RunError::Io(_))) => {
                    return unreachable(handle, timeout_secs, mirror, self.host(), &error);
                }
                Err(error) => {
                    note = Some(format!("The run's outputs could not be copied: {error}"))
                }
            }
        }
        let end = with_note(end, note);
        mirror.finalize(&end, exit_code_of(&end))?;
        Ok(end)
    }

    pub(crate) async fn cancel(&self, dir: &str) -> Result<(), RunError> {
        self.script(
            &scripts::cancel_script(dir, CANCEL_GRACE_SECS),
            CALL_TIMEOUT,
            SMALL_OUTPUT,
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn cleanup(&self, dir: &str) -> Result<(), RunError> {
        self.script(&scripts::cleanup_script(dir)?, CALL_TIMEOUT, SMALL_OUTPUT)
            .await
            .map(|_| ())
    }
}

pub struct SshExecutor {
    host: Arc<dyn ComputeHost>,
}

impl SshExecutor {
    pub fn new(host: Arc<dyn ComputeHost>) -> Self {
        Self { host }
    }
}

/// Answers a log query, bringing an active run's copy up to date first
/// when it is a few seconds old.
pub(crate) async fn read_remote_log(
    remote: Result<Remote, RunError>,
    mirror: &RemoteMirror,
    dir: &str,
    script: &str,
    query: &LogQuery,
) -> Result<String, RunError> {
    if mirror.finished().is_none() && mirror.synced_ago() > SYNC_EVERY_MS {
        if let (Some(_lock), Ok(remote)) = (mirror.try_poll_lock(), remote) {
            let _ = remote.exchange(mirror, dir, script).await;
        }
    }
    mirror.answer(query)
}

#[async_trait::async_trait]
impl RunExecutor for SshExecutor {
    fn id(&self) -> &'static str {
        "ssh"
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        let ComputeTarget::Ssh {
            id,
            host,
            user,
            port,
            remote_root,
            prelude,
            ..
        } = load_target(&*self.host, spec.target.as_deref())?
        else {
            return Err(RunError::Config(
                "The task's compute target is not an SSH host.".into(),
            ));
        };
        let endpoint = SshEndpoint { host, user, port };
        let remote = Remote::new(&*self.host, endpoint.clone())?;
        let probe = remote.probe().await?;
        let remote_dir = scripts::run_dir(remote_root.as_deref(), &spec.task_id, &spec.run_id)?;
        let rsync = local_rsync(&|name| self.host.locate_program(name)).filter(|_| probe.rsync);
        let data = SshHandleData {
            target_id: id,
            endpoint,
            remote_dir,
            remote_home: probe.home.clone(),
            sync: if rsync.is_some() {
                SyncMode::Rsync
            } else {
                SyncMode::Tar
            },
            detach: probe.detach,
            workspace: spec.workspace.clone(),
            timeout_secs: spec.timeout.as_secs(),
        };
        let handle = RunHandle {
            version: HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir: spec.run_dir.clone(),
            started_at: now_ms(),
            data: serde_json::to_value(&data).map_err(|error| RunError::Io(error.to_string()))?,
        };
        // Written before anything changes remotely, so a restart finds the run.
        save_handle(&handle)?;
        remote
            .upload(&spec.workspace, &data.remote_dir, rsync.as_deref())
            .await?;
        let run = RemoteRun {
            dir: &data.remote_dir,
            command: &spec.command,
            cwd_rel: &spec.cwd_rel,
            env: &spec.env,
            timeout_secs: spec.timeout.as_secs(),
            prelude: &prelude,
        };
        let printed = remote
            .script(
                &scripts::start_script(&run, data.detach)?,
                CALL_TIMEOUT,
                SMALL_OUTPUT,
            )
            .await?;
        if !printed.contains("OLEAFLY_STARTED") && !printed.contains("OLEAFLY_ALREADY") {
            return Err(RunError::Remote(format!(
                "The run did not start on {}.",
                remote.host()
            )));
        }
        Ok(handle)
    }

    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError> {
        let data: SshHandleData = handle_data(handle)?;
        let mirror = RemoteMirror::open(&handle.run_dir)?;
        if let Some(done) = mirror.finished() {
            return Ok(done);
        }
        let Some(_lock) = mirror.try_poll_lock() else {
            return Ok(running(handle, None));
        };
        if let Some(done) = mirror.finished() {
            return Ok(done);
        }
        let host = data.endpoint.host.clone();
        let remote = match Remote::new(&*self.host, data.endpoint.clone()) {
            Ok(remote) => remote,
            Err(error) => return unreachable(handle, data.timeout_secs, &mirror, &host, &error),
        };
        let script = scripts::poll_script(&data.remote_dir, mirror.remote_offset(), POLL_LOG_BYTES);
        let printed = match remote.exchange(&mirror, &data.remote_dir, &script).await {
            Ok(printed) => printed,
            Err(error) => return unreachable(handle, data.timeout_secs, &mirror, &host, &error),
        };
        let state = scripts::parse_poll(&printed)?.state;
        let end = match state {
            RemoteState::Running => return Ok(running(handle, None)),
            RemoteState::Missing => RunStatus::Lost {
                reason: format!("The run's folder on {host} is gone."),
            },
            RemoteState::Exited(code) => finished(Some(code), outcome_for(code)),
            RemoteState::TimedOut => finished(None, RunOutcomeKind::TimedOut),
            RemoteState::Cancelled => finished(None, RunOutcomeKind::Cancelled),
            RemoteState::Lost => RunStatus::Lost {
                reason: format!("The run on {host} stopped without recording an exit code."),
            },
        };
        let fetch = state != RemoteState::Missing;
        remote
            .settle(
                &mirror,
                handle,
                &data.remote_dir,
                &data.workspace,
                data.timeout_secs,
                end,
                fetch,
            )
            .await
    }

    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError> {
        let data: SshHandleData = handle_data(handle)?;
        let mirror = RemoteMirror::open(&handle.run_dir)?;
        let script = scripts::poll_script(&data.remote_dir, mirror.remote_offset(), POLL_LOG_BYTES);
        let remote = Remote::new(&*self.host, data.endpoint.clone());
        read_remote_log(remote, &mirror, &data.remote_dir, &script, &query).await
    }

    async fn cancel(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: SshHandleData = handle_data(handle)?;
        Remote::new(&*self.host, data.endpoint)?
            .cancel(&data.remote_dir)
            .await
    }

    async fn cleanup(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: SshHandleData = handle_data(handle)?;
        Remote::new(&*self.host, data.endpoint)?
            .cleanup(&data.remote_dir)
            .await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::runs::remote::testing::{ssh_world, wait_for_end, World};

    async fn start(world: &World, command: &str) -> RunHandle {
        let executor = SshExecutor::new(world.host.clone());
        let spec = world.spec("r001", command);
        executor.start(&spec).await.unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn end_to_end_run_with_fake_ssh() {
        let world = ssh_world(false);
        let handle = start(
            &world,
            "echo \"loss: 0.5\"; mkdir -p results; echo ok > results/a.txt",
        )
        .await;
        let executor = SshExecutor::new(world.host.clone());
        let status = wait_for_end(&executor, &handle).await;
        assert!(
            matches!(
                status,
                RunStatus::Finished {
                    exit_code: Some(0),
                    ..
                }
            ),
            "{status:?}"
        );
        let log = std::fs::read_to_string(handle.run_dir.join("stdout.log")).unwrap();
        assert!(log.contains("loss: 0.5"), "{log}");
        assert_eq!(
            std::fs::read_to_string(world.workspace().join("runs/r001/outputs/results/a.txt"))
                .unwrap(),
            "ok\n"
        );
        assert_eq!(
            std::fs::read_to_string(handle.run_dir.join("exit_code")).unwrap(),
            "0"
        );
        let metrics = std::fs::read_to_string(handle.run_dir.join("metrics.jsonl")).unwrap();
        assert!(metrics.contains("\"loss\":0.5"), "{metrics}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn tar_is_used_when_the_remote_has_no_rsync() {
        let world = ssh_world(false);
        std::fs::write(world.workspace().join("input.txt"), "data").unwrap();
        let handle = start(&world, "cat input.txt").await;
        let data: SshHandleData = handle_data(&handle).unwrap();
        assert_eq!(data.sync, SyncMode::Tar);
        let status = wait_for_end(&SshExecutor::new(world.host.clone()), &handle).await;
        assert!(matches!(
            status,
            RunStatus::Finished {
                exit_code: Some(0),
                ..
            }
        ));
        assert!(std::fs::read_to_string(handle.run_dir.join("stdout.log"))
            .unwrap()
            .contains("data"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_stops_the_remote_process() {
        let world = ssh_world(false);
        let handle = start(&world, "sleep 60").await;
        let executor = SshExecutor::new(world.host.clone());
        executor.cancel(&handle).await.unwrap();
        let status = wait_for_end(&executor, &handle).await;
        assert!(
            matches!(
                status,
                RunStatus::Finished {
                    outcome: RunOutcomeKind::Cancelled,
                    ..
                }
            ),
            "{status:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn poll_lock_admits_one_poller() {
        let world = ssh_world(false);
        let handle = start(&world, "sleep 30").await;
        let mirror = RemoteMirror::open(&handle.run_dir).unwrap();
        let _held = mirror.try_poll_lock().unwrap();
        let calls = world.calls();
        let status = SshExecutor::new(world.host.clone())
            .poll(&handle)
            .await
            .unwrap();
        assert!(matches!(status, RunStatus::Running { .. }));
        assert_eq!(world.calls(), calls);
        SshExecutor::new(world.host.clone())
            .cancel(&handle)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reattach_from_handle_json() {
        let world = ssh_world(false);
        let handle = start(&world, "sleep 1; echo done").await;
        let stored = std::fs::read_to_string(handle.run_dir.join("handle.json")).unwrap();
        let handle = RunHandle::parse(&stored).unwrap();
        let status = wait_for_end(&SshExecutor::new(world.host.clone()), &handle).await;
        assert!(matches!(
            status,
            RunStatus::Finished {
                exit_code: Some(0),
                ..
            }
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn log_mirror_is_bounded_per_poll() {
        let world = ssh_world(false);
        let handle = start(&world, "head -c 3145728 /dev/zero | tr '\\0' 'x'; sleep 3").await;
        let executor = SshExecutor::new(world.host.clone());
        tokio::time::sleep(Duration::from_millis(1500)).await;
        executor.poll(&handle).await.unwrap();
        let first = std::fs::metadata(handle.run_dir.join("stdout.log"))
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        assert!(first <= POLL_LOG_BYTES, "{first}");
        wait_for_end(&executor, &handle).await;
        let last = std::fs::metadata(handle.run_dir.join("stdout.log"))
            .unwrap()
            .len();
        assert_eq!(last, 3 * 1024 * 1024);
    }

    #[tokio::test]
    async fn unknown_handle_version_is_refused() {
        let world = ssh_world(false);
        let mut handle = RunHandle {
            version: 99,
            executor: "ssh".into(),
            task_id: "t1".into(),
            run_id: "r001".into(),
            run_dir: world.run_dir("r001"),
            started_at: now_ms(),
            data: serde_json::json!({}),
        };
        let error = SshExecutor::new(world.host.clone())
            .poll(&handle)
            .await
            .unwrap_err();
        assert!(matches!(error, RunError::Config(_)));
        handle.version = HANDLE_VERSION;
        assert!(SshExecutor::new(world.host.clone())
            .poll(&handle)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn unknown_host_key_fails_with_a_settings_hint() {
        let world = ssh_world(false);
        world.fail_ssh_with(255, "Host key verification failed.");
        let spec = world.spec("r001", "true");
        let error = SshExecutor::new(world.host.clone())
            .start(&spec)
            .await
            .unwrap_err();
        assert!(
            matches!(error, RunError::HostKeyUnknown(ref message) if message.contains("Settings")),
            "{error:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn workspace_paths_with_spaces_and_non_ascii_upload() {
        let world = ssh_world(false);
        let folder = world.workspace().join("Prüfung Ordner");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("daten.txt"), "inhalt").unwrap();
        let handle = start(&world, "cat 'Prüfung Ordner/daten.txt'").await;
        wait_for_end(&SshExecutor::new(world.host.clone()), &handle).await;
        assert!(std::fs::read_to_string(handle.run_dir.join("stdout.log"))
            .unwrap()
            .contains("inhalt"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn network_errors_keep_the_run_running_with_a_note() {
        let world = ssh_world(false);
        let handle = start(&world, "sleep 30").await;
        world.fail_ssh_with(255, "ssh: connect to host h port 22: Connection timed out");
        let status = SshExecutor::new(world.host.clone())
            .poll(&handle)
            .await
            .unwrap();
        assert!(
            matches!(status, RunStatus::Running { note: Some(_), .. }),
            "{status:?}"
        );
        world.heal_ssh();
        SshExecutor::new(world.host.clone())
            .cancel(&handle)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn metrics_are_parsed_from_remote_logs() {
        let world = ssh_world(false);
        let handle = start(
            &world,
            "printf 'loss: 0.'; sleep 1; printf '5\\n{\"acc\": 0.9}\\n'",
        )
        .await;
        let executor = SshExecutor::new(world.host.clone());
        tokio::time::sleep(Duration::from_millis(500)).await;
        let _ = executor.poll(&handle).await;
        wait_for_end(&executor, &handle).await;
        let summary = crate::runs::metrics::summarize_file(&handle.run_dir.join("metrics.jsonl"));
        assert_eq!(summary.last.get("loss"), Some(&0.5));
        assert_eq!(summary.last.get("acc"), Some(&0.9));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_start_mid_upload_leaves_no_remote_process() {
        let world = ssh_world(false);
        world.slow_tar();
        let executor = SshExecutor::new(world.host.clone());
        let spec = world.spec("r001", "sleep 30");
        let started = tokio::time::timeout(Duration::from_millis(200), executor.start(&spec)).await;
        assert!(started.is_err(), "the start should still be uploading");
        tokio::time::sleep(Duration::from_millis(500)).await;
        let remote = world.remote_home().join(".oleafly-runs/t1/r001");
        assert!(!remote.join("started").exists());
        assert!(!remote.join("pid").exists());
    }
}
