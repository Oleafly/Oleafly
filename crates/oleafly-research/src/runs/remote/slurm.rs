//! Runs on a Slurm cluster, reached over SSH: the same upload, log copy and
//! outputs as an SSH host, but started with `sbatch` and followed with
//! `squeue` (and `sacct` once the job leaves the queue).
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::mirror::{RemoteMirror, POLL_LOG_BYTES};
use super::rsync::local_rsync;
use super::scripts::{self, sh_quote, RemoteRun};
use super::settings::{validate_resources, ComputeTarget, GpuFlag};
use super::ssh::{
    finished, load_target, outcome_for, read_remote_log, running, save_handle, unreachable, Remote,
    SshHandleData, SyncMode, CALL_TIMEOUT,
};
use super::transport::SshEndpoint;
use super::{handle_data, ComputeHost};
use crate::model::{now_ms, Resources};
use crate::runs::{
    LogQuery, RunError, RunExecutor, RunHandle, RunOutcomeKind, RunSpec, RunStatus, HANDLE_VERSION,
};

const SMALL_OUTPUT: usize = 256 * 1024;

pub struct SlurmExecutor {
    host: Arc<dyn ComputeHost>,
}

impl SlurmExecutor {
    pub fn new(host: Arc<dyn ComputeHost>) -> Self {
        Self { host }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlurmHandleData {
    #[serde(flatten)]
    pub ssh: SshHandleData,
    pub job_id: Option<String>,
}

/// The brief's resources over the target's defaults. The job's time limit is
/// the shortest of what the brief asks for, the target's default and the
/// run's timeout, so a cluster default of a day cannot outlast a run limit of
/// half an hour; the timeout alone sets it when neither asks.
pub fn merge_resources(
    requested: Option<&Resources>,
    defaults: &Resources,
    timeout: Duration,
) -> Resources {
    let requested = requested.cloned().unwrap_or_default();
    let minutes = u32::try_from(timeout.as_secs().div_ceil(60).max(1)).unwrap_or(u32::MAX);
    Resources {
        time_minutes: Some(
            requested
                .time_minutes
                .or(defaults.time_minutes)
                .map_or(minutes, |asked| asked.min(minutes)),
        ),
        partition: requested.partition.or_else(|| defaults.partition.clone()),
        gpus: requested.gpus.or(defaults.gpus),
        cpus: requested.cpus.or(defaults.cpus),
        memory_gb: requested.memory_gb.or(defaults.memory_gb),
        account: requested.account.or_else(|| defaults.account.clone()),
        qos: requested.qos.or_else(|| defaults.qos.clone()),
    }
}

/// The batch script: `#SBATCH` lines from checked resources, then the same
/// environment, folder and exit-code handling as an SSH run.
pub fn sbatch_script(
    run: &RemoteRun<'_>,
    resources: &Resources,
    gpu_flag: GpuFlag,
    job_name: &str,
) -> Result<String, RunError> {
    validate_resources(resources)?;
    if !job_name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(RunError::Config("The job name is not valid.".into()));
    }
    let mut script = String::from("#!/bin/sh\n");
    script.push_str(&format!("#SBATCH --job-name={job_name}\n"));
    script.push_str("#SBATCH --output=stdout.log\n");
    script.push_str("#SBATCH --open-mode=append\n");
    if let Some(minutes) = resources.time_minutes {
        script.push_str(&format!("#SBATCH --time={minutes}\n"));
    }
    if let Some(partition) = &resources.partition {
        script.push_str(&format!("#SBATCH --partition={partition}\n"));
    }
    if let Some(account) = &resources.account {
        script.push_str(&format!("#SBATCH --account={account}\n"));
    }
    if let Some(qos) = &resources.qos {
        script.push_str(&format!("#SBATCH --qos={qos}\n"));
    }
    if let Some(gpus) = resources.gpus.filter(|gpus| *gpus > 0) {
        match gpu_flag {
            GpuFlag::Gres => script.push_str(&format!("#SBATCH --gres=gpu:{gpus}\n")),
            GpuFlag::Gpus => script.push_str(&format!("#SBATCH --gpus={gpus}\n")),
        }
    }
    if let Some(cpus) = resources.cpus {
        script.push_str(&format!("#SBATCH --cpus-per-task={cpus}\n"));
    }
    if let Some(memory) = resources.memory_gb {
        script.push_str(&format!("#SBATCH --mem={memory}G\n"));
    }
    script.push_str("RUN=\"${SLURM_SUBMIT_DIR:-$(pwd)}\"\n");
    script.push_str("trap 'date +%s > \"$RUN/terminated\"' TERM\n");
    script.push_str(
        "oleafly_finish() { echo \"$1\" > \"$RUN/exit_code.tmp\" && mv \"$RUN/exit_code.tmp\" \"$RUN/exit_code\"; }\n",
    );
    if !run.prelude.trim().is_empty() {
        script.push_str(run.prelude.trim_end());
        script.push('\n');
    }
    for (name, value) in run.env {
        if !scripts::valid_env_name(name) {
            return Err(RunError::Config(format!(
                "{name} isn't a valid environment variable name."
            )));
        }
        script.push_str(&format!("export {name}={}\n", sh_quote(value)));
    }
    let folder = if run.cwd_rel.is_empty() {
        "\"$RUN/work\"".to_string()
    } else {
        format!("\"$RUN/work/\"{}", sh_quote(run.cwd_rel))
    };
    script.push_str(&format!(
        "cd {folder} || {{ oleafly_finish 97; exit 97; }}\n"
    ));
    script.push_str("sh \"$RUN/command.sh\" < /dev/null\n");
    script.push_str("CODE=$?\n");
    script.push_str("oleafly_finish \"$CODE\"\n");
    script.push_str("exit \"$CODE\"\n");
    Ok(script)
}

fn heredoc(file: &str, content: &str) -> String {
    let mut end;
    loop {
        end = format!("OLEAFLY_{:016x}", rand::random::<u64>());
        if !content
            .lines()
            .any(|line| line.trim_end_matches('\r') == end)
        {
            break;
        }
    }
    let mut text = format!("cat > {file} <<'{end}'\n{content}");
    if !content.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&end);
    text.push('\n');
    text
}

/// Writes the command and batch script, submits once and prints the job id.
fn submit_script(dir: &str, command: &str, batch: &str) -> String {
    let dir = sh_quote(dir);
    format!(
        "set -eu\numask 077\ncd\nmkdir -p {dir}/work\ncd {dir}\n\
         if ! mkdir start.lock 2>/dev/null; then if [ -s job_id ]; then echo \"OLEAFLY_JOB $(cat job_id)\"; else echo OLEAFLY_ALREADY; fi; exit 0; fi\n\
         date +%s > started\n\
         find work -newer started -exec touch -r started {{}} + 2>/dev/null || :\n\
         {command_file}{batch_file}\
         if ! out=$(sbatch --parsable job.sbatch 2> sbatch.err); then echo \"OLEAFLY_SBATCH_ERROR $(tail -n 1 sbatch.err)\"; exit 0; fi\n\
         echo \"OLEAFLY_SBATCH $out\"\n\
         echo \"${{out%%;*}}\" > job_id\n",
        command_file = heredoc("command.sh", command),
        batch_file = heredoc("job.sbatch", batch),
    )
}

/// The job id from `sbatch --parsable` (`12345` or `12345;cluster`).
pub fn parse_sbatch_parsable(stdout: &str) -> Result<String, RunError> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let id = line.split(';').next().unwrap_or("").trim();
    if !id.is_empty() && id.chars().all(|character| character.is_ascii_digit()) {
        return Ok(id.to_string());
    }
    Err(RunError::Remote(format!(
        "Slurm did not accept the job: {}",
        line.chars()
            .filter(|character| !character.is_control())
            .take(300)
            .collect::<String>()
    )))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SlurmState {
    Pending(String),
    Running,
    Completed,
    Failed,
    Cancelled,
    Timeout,
    OutOfMemory,
    NodeFail,
    Preempted,
    BootFail,
    Other(String),
}

fn state_named(name: &str, reason: &str) -> SlurmState {
    let name = name.trim();
    let upper = name
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches('+')
        .to_ascii_uppercase();
    match upper.as_str() {
        "PENDING" | "CONFIGURING" | "REQUEUED" | "REQUEUE_HOLD" | "REQUEUE_FED" | "SUSPENDED"
        | "RESV_DEL_HOLD" => {
            let reason = reason.trim();
            SlurmState::Pending(if reason.is_empty() || reason == "None" {
                upper.to_ascii_lowercase()
            } else {
                reason.to_string()
            })
        }
        "RUNNING" | "COMPLETING" | "SIGNALING" | "STAGE_OUT" | "STOPPED" => SlurmState::Running,
        "COMPLETED" => SlurmState::Completed,
        "FAILED" => SlurmState::Failed,
        "CANCELLED" => SlurmState::Cancelled,
        "TIMEOUT" | "DEADLINE" => SlurmState::Timeout,
        "OUT_OF_MEMORY" => SlurmState::OutOfMemory,
        "NODE_FAIL" => SlurmState::NodeFail,
        "PREEMPTED" => SlurmState::Preempted,
        "BOOT_FAIL" => SlurmState::BootFail,
        _ => SlurmState::Other(name.to_string()),
    }
}

/// The first line of `squeue -h -t all -o '%T|%r'`; `None` when the job is
/// not in the queue.
pub fn parse_squeue(stdout: &str) -> Option<SlurmState> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let (state, reason) = line.split_once('|').unwrap_or((line, ""));
    Some(state_named(state, reason))
}

/// `State|ExitCode` from `sacct -n -P -X`; the exit code is the part before
/// the signal (`2:0` → 2).
pub fn parse_sacct(stdout: &str) -> Option<(SlurmState, Option<i32>)> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let (state, code) = line.split_once('|').unwrap_or((line, ""));
    let exit = code
        .split(':')
        .next()
        .and_then(|code| code.trim().parse().ok());
    Some((state_named(state, ""), exit))
}

fn ended(state: &SlurmState, code: Option<i32>, exit_file: Option<i32>) -> Option<RunStatus> {
    let failed = |note: &str| RunStatus::Finished {
        exit_code: exit_file.or(code),
        finished_at: now_ms(),
        outcome: RunOutcomeKind::Failed,
        note: Some(note.to_string()),
    };
    Some(match state {
        SlurmState::Completed | SlurmState::Failed => {
            let code = exit_file
                .or(code)
                .unwrap_or(if *state == SlurmState::Completed {
                    0
                } else {
                    1
                });
            finished(Some(code), outcome_for(code))
        }
        SlurmState::Cancelled => finished(exit_file, RunOutcomeKind::Cancelled),
        SlurmState::Timeout => finished(exit_file, RunOutcomeKind::TimedOut),
        SlurmState::OutOfMemory => {
            failed("The job ran out of memory. Ask for more with the memory setting.")
        }
        SlurmState::NodeFail => failed("A node of the cluster failed while the job ran."),
        SlurmState::Preempted => {
            failed("The cluster stopped the job to make room for another one.")
        }
        SlurmState::BootFail => failed("The cluster could not start a node for the job."),
        SlurmState::Other(name) => failed(&format!("Slurm reported the job as {name}.")),
        SlurmState::Pending(_) | SlurmState::Running => return None,
    })
}

/// The run's status from what the queue, the accounting and the job's own
/// marker files say, in that order.
pub fn slurm_status(
    started_at: i64,
    queue: Option<SlurmState>,
    acct: Option<(SlurmState, Option<i32>)>,
    exit_file: Option<i32>,
    terminated: bool,
    accounting_disabled: bool,
) -> RunStatus {
    let running = RunStatus::Running {
        started_at,
        note: None,
    };
    match queue {
        Some(SlurmState::Pending(reason)) => return RunStatus::Queued { reason },
        Some(SlurmState::Running) => return running,
        Some(state) => {
            if let Some(status) = ended(&state, None, exit_file) {
                return status;
            }
        }
        None => {}
    }
    if !accounting_disabled {
        if let Some((state, code)) = acct {
            return match state {
                SlurmState::Pending(reason) => RunStatus::Queued { reason },
                SlurmState::Running => running,
                state => ended(&state, code, exit_file).unwrap_or(running),
            };
        }
    }
    match (exit_file, terminated) {
        (Some(code), _) => finished(Some(code), outcome_for(code)),
        (None, true) => RunStatus::Finished {
            exit_code: None,
            finished_at: now_ms(),
            outcome: RunOutcomeKind::Failed,
            note: Some("The job was stopped without an exit code.".into()),
        },
        (None, false) => RunStatus::Lost {
            reason: "Slurm no longer lists the job and it left no exit code.".into(),
        },
    }
}

fn poll_script(dir: &str, log_offset: u64) -> String {
    format!(
        r#"cd || exit 1
d={dir}
if [ ! -d "$d" ]; then echo 'OLEAFLY_SLURM missing'; exit 0; fi
cd "$d"
job=$(cat job_id 2>/dev/null || :)
echo "OLEAFLY_JOBID $job"
if [ -n "$job" ]; then
  q=$(squeue -h --jobs="$job" -t all -o '%T|%r' 2>/dev/null | head -n 1)
  echo "OLEAFLY_SQUEUE $q"
  if [ -z "$q" ]; then
    a=$(sacct -n -P -X -j "$job" --format=State,ExitCode 2> sacct.err | head -n 1)
    echo "OLEAFLY_SACCT $a"
    if grep -qi 'accounting storage is disabled' sacct.err 2>/dev/null; then echo OLEAFLY_NOACCT; fi
  fi
fi
if [ -e exit_code ]; then echo "OLEAFLY_EXIT $(cat exit_code)"; fi
if [ -e terminated ]; then echo OLEAFLY_TERMINATED; fi
{log}"#,
        dir = sh_quote(dir),
        log = scripts::log_section(log_offset, POLL_LOG_BYTES),
    )
}

struct SlurmReport {
    missing: bool,
    job_id: Option<String>,
    queue: Option<SlurmState>,
    acct: Option<(SlurmState, Option<i32>)>,
    exit_file: Option<i32>,
    terminated: bool,
    accounting_disabled: bool,
}

fn parse_report(stdout: &str) -> SlurmReport {
    let mut report = SlurmReport {
        missing: false,
        job_id: None,
        queue: None,
        acct: None,
        exit_file: None,
        terminated: false,
        accounting_disabled: false,
    };
    for line in stdout.lines().map(|line| line.trim_end_matches('\r')) {
        if line == "OLEAFLY_SLURM missing" {
            report.missing = true;
        } else if let Some(value) = line.strip_prefix("OLEAFLY_JOBID") {
            report.job_id = Some(value.trim().to_string()).filter(|id| !id.is_empty());
        } else if let Some(value) = line.strip_prefix("OLEAFLY_SQUEUE") {
            report.queue = parse_squeue(value);
        } else if let Some(value) = line.strip_prefix("OLEAFLY_SACCT") {
            report.acct = parse_sacct(value);
        } else if let Some(value) = line.strip_prefix("OLEAFLY_EXIT ") {
            report.exit_file = value.trim().parse().ok();
        } else if line == "OLEAFLY_TERMINATED" {
            report.terminated = true;
        } else if line == "OLEAFLY_NOACCT" {
            report.accounting_disabled = true;
        }
    }
    report
}

fn cancel_script(dir: &str) -> String {
    format!(
        "cd || exit 1\ncd {dir} 2>/dev/null || exit 0\n[ -e exit_code ] && exit 0\n: > cancelled\njob=$(cat job_id 2>/dev/null || :)\nif [ -n \"$job\" ]; then scancel -Q \"$job\"; fi\necho OLEAFLY_CANCELLED\n",
        dir = sh_quote(dir),
    )
}

#[async_trait::async_trait]
impl RunExecutor for SlurmExecutor {
    fn id(&self) -> &'static str {
        "slurm"
    }

    fn poll_every(&self) -> Duration {
        super::REMOTE_POLL_EVERY
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        let ComputeTarget::Slurm {
            id,
            host,
            user,
            port,
            remote_root,
            prelude,
            defaults,
            gpu_flag,
            ..
        } = load_target(&*self.host, spec.target.as_deref())?
        else {
            return Err(RunError::Config(
                "The task's compute target is not a Slurm cluster.".into(),
            ));
        };
        let endpoint = SshEndpoint { host, user, port };
        let remote = Remote::new(&*self.host, endpoint.clone())?;
        let probe = remote.probe().await?;
        let remote_dir = scripts::run_dir(remote_root.as_deref(), &spec.task_id, &spec.run_id)?;
        let resources = merge_resources(spec.resources.as_ref(), &defaults, spec.timeout);
        let run = RemoteRun {
            dir: &remote_dir,
            command: &spec.command,
            cwd_rel: &spec.cwd_rel,
            env: &spec.env,
            timeout_secs: spec.timeout.as_secs(),
            prelude: &prelude,
        };
        let short: String = spec.run_id.chars().take(8).collect();
        let batch = sbatch_script(&run, &resources, gpu_flag, &format!("oleafly-{short}"))?;
        let rsync = local_rsync(&|name| self.host.locate_program(name)).filter(|_| probe.rsync);
        let mut data = SlurmHandleData {
            ssh: SshHandleData {
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
            },
            job_id: None,
        };
        let mut handle = RunHandle {
            version: HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir: spec.run_dir.clone(),
            started_at: now_ms(),
            data: serde_json::to_value(&data).map_err(|error| RunError::Io(error.to_string()))?,
        };
        save_handle(&handle)?;
        remote
            .upload(&spec.workspace, &data.ssh.remote_dir, rsync.as_deref())
            .await?;
        let printed = remote
            .script(
                &submit_script(&data.ssh.remote_dir, &spec.command, &batch),
                CALL_TIMEOUT,
                SMALL_OUTPUT,
            )
            .await?;
        if let Some(error) = printed
            .lines()
            .find_map(|line| line.strip_prefix("OLEAFLY_SBATCH_ERROR "))
        {
            return Err(RunError::Remote(format!(
                "Slurm did not accept the job: {}",
                error
                    .chars()
                    .filter(|character| !character.is_control())
                    .take(300)
                    .collect::<String>()
            )));
        }
        let job = printed
            .lines()
            .find_map(|line| {
                line.strip_prefix("OLEAFLY_SBATCH ")
                    .or_else(|| line.strip_prefix("OLEAFLY_JOB "))
            })
            .map(parse_sbatch_parsable)
            .transpose()?;
        if job.is_none() && !printed.contains("OLEAFLY_ALREADY") {
            return Err(RunError::Remote(format!(
                "The job was not submitted on {}.",
                remote.host()
            )));
        }
        data.job_id = job;
        handle.data =
            serde_json::to_value(&data).map_err(|error| RunError::Io(error.to_string()))?;
        save_handle(&handle)?;
        Ok(handle)
    }

    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError> {
        let data: SlurmHandleData = handle_data(handle)?;
        let ssh = &data.ssh;
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
        let host = ssh.endpoint.host.clone();
        let remote = match Remote::new(&*self.host, ssh.endpoint.clone()) {
            Ok(remote) => remote,
            Err(error) => return unreachable(handle, ssh.timeout_secs, &mirror, &host, &error),
        };
        let script = poll_script(&ssh.remote_dir, mirror.remote_offset());
        let printed = match remote.exchange(&mirror, &ssh.remote_dir, &script).await {
            Ok(printed) => printed,
            Err(error) => return unreachable(handle, ssh.timeout_secs, &mirror, &host, &error),
        };
        let report = parse_report(&printed);
        if report.missing {
            let lost = RunStatus::Lost {
                reason: format!("The run's folder on {host} is gone."),
            };
            mirror.finalize(&lost, None)?;
            return Ok(lost);
        }
        // A job id written remotely before a crash is picked up here.
        if report.job_id.is_none() && data.job_id.is_none() {
            let lost = RunStatus::Lost {
                reason: "The job was never submitted.".into(),
            };
            mirror.finalize(&lost, None)?;
            return Ok(lost);
        }
        let status = slurm_status(
            handle.started_at,
            report.queue,
            report.acct,
            report.exit_file,
            report.terminated,
            report.accounting_disabled,
        );
        match status {
            RunStatus::Queued { .. } | RunStatus::Running { .. } | RunStatus::Starting => {
                Ok(status)
            }
            end => {
                remote
                    .settle(
                        &mirror,
                        handle,
                        &ssh.remote_dir,
                        &ssh.workspace,
                        ssh.timeout_secs,
                        end,
                        true,
                    )
                    .await
            }
        }
    }

    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError> {
        let data: SlurmHandleData = handle_data(handle)?;
        let mirror = RemoteMirror::open(&handle.run_dir)?;
        let script = poll_script(&data.ssh.remote_dir, mirror.remote_offset());
        let remote = Remote::new(&*self.host, data.ssh.endpoint.clone());
        read_remote_log(remote, &mirror, &data.ssh.remote_dir, &script, &query).await
    }

    async fn cancel(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: SlurmHandleData = handle_data(handle)?;
        Remote::new(&*self.host, data.ssh.endpoint)?
            .script(
                &cancel_script(&data.ssh.remote_dir),
                CALL_TIMEOUT,
                SMALL_OUTPUT,
            )
            .await
            .map(|_| ())
    }

    async fn cleanup(&self, handle: &RunHandle) -> Result<(), RunError> {
        let data: SlurmHandleData = handle_data(handle)?;
        Remote::new(&*self.host, data.ssh.endpoint)?
            .cleanup(&data.ssh.remote_dir)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn run<'a>(env: &'a BTreeMap<String, String>) -> RemoteRun<'a> {
        RemoteRun {
            dir: "d",
            command: "python train.py",
            cwd_rel: "",
            env,
            timeout_secs: 3600,
            prelude: "",
        }
    }

    #[test]
    fn sbatch_script_renders_resources() {
        let env = BTreeMap::new();
        let resources = Resources {
            time_minutes: Some(120),
            partition: Some("gpu".into()),
            gpus: Some(2),
            ..Resources::default()
        };
        let script = sbatch_script(&run(&env), &resources, GpuFlag::Gres, "oleafly-r001").unwrap();
        assert!(script.contains("#SBATCH --gres=gpu:2\n"), "{script}");
        assert!(script.contains("#SBATCH --partition=gpu\n"));
        assert!(script.contains("#SBATCH --time=120\n"));
        assert!(!script.contains("--account"));
        let script = sbatch_script(&run(&env), &resources, GpuFlag::Gpus, "oleafly-r001").unwrap();
        assert!(script.contains("#SBATCH --gpus=2\n"));
    }

    #[test]
    fn time_comes_from_the_timeout_when_unset() {
        let merged = merge_resources(None, &Resources::default(), Duration::from_secs(90 * 60));
        let env = BTreeMap::new();
        let script = sbatch_script(&run(&env), &merged, GpuFlag::Gres, "oleafly-r001").unwrap();
        assert!(script.contains("#SBATCH --time=90\n"), "{script}");
        let defaults = Resources {
            partition: Some("cpu".into()),
            ..Resources::default()
        };
        let requested = Resources {
            partition: Some("gpu".into()),
            ..Resources::default()
        };
        assert_eq!(
            merge_resources(Some(&requested), &defaults, Duration::from_secs(60))
                .partition
                .as_deref(),
            Some("gpu")
        );
    }

    #[test]
    fn the_run_timeout_caps_what_the_cluster_default_or_the_brief_ask_for() {
        let day = Resources {
            time_minutes: Some(24 * 60),
            ..Resources::default()
        };
        let quarter = Resources {
            time_minutes: Some(15),
            ..Resources::default()
        };
        let half_hour = Duration::from_secs(30 * 60);
        // A target default of a day is cut to the run limit...
        assert_eq!(
            merge_resources(None, &day, half_hour).time_minutes,
            Some(30)
        );
        // ...and so is a request in the brief.
        assert_eq!(
            merge_resources(Some(&day), &Resources::default(), half_hour).time_minutes,
            Some(30)
        );
        // A shorter ask stands; the brief's ask wins over the target's default.
        assert_eq!(
            merge_resources(Some(&quarter), &day, half_hour).time_minutes,
            Some(15)
        );
        assert_eq!(
            merge_resources(None, &quarter, half_hour).time_minutes,
            Some(15)
        );
    }

    #[test]
    fn sbatch_rejects_newline_injection() {
        let env = BTreeMap::new();
        let resources = Resources {
            partition: Some("gpu\n#SBATCH --x".into()),
            ..Resources::default()
        };
        assert!(matches!(
            sbatch_script(&run(&env), &resources, GpuFlag::Gres, "j"),
            Err(RunError::Config(_))
        ));
    }

    #[test]
    fn parsable_output_variants() {
        assert_eq!(parse_sbatch_parsable("12345\n").unwrap(), "12345");
        assert_eq!(parse_sbatch_parsable("12345;cluster1").unwrap(), "12345");
        assert!(matches!(
            parse_sbatch_parsable("sbatch: error: Batch job submission failed"),
            Err(RunError::Remote(_))
        ));
    }

    #[test]
    fn squeue_states_map_to_queued_running_and_finished() {
        for state in [
            "PENDING|Priority",
            "CONFIGURING|None",
            "REQUEUED|None",
            "SUSPENDED|None",
        ] {
            let status = slurm_status(1, parse_squeue(state), None, None, false, false);
            assert!(
                matches!(status, RunStatus::Queued { .. }),
                "{state}: {status:?}"
            );
        }
        assert_eq!(
            slurm_status(
                1,
                parse_squeue("PENDING|Resources"),
                None,
                None,
                false,
                false
            ),
            RunStatus::Queued {
                reason: "Resources".into()
            }
        );
        for state in ["RUNNING|None", "COMPLETING|None"] {
            assert!(matches!(
                slurm_status(1, parse_squeue(state), None, None, false, false),
                RunStatus::Running { .. }
            ));
        }
        let done = slurm_status(
            1,
            parse_squeue("COMPLETED|None"),
            None,
            Some(0),
            false,
            false,
        );
        assert!(matches!(
            done,
            RunStatus::Finished {
                exit_code: Some(0),
                outcome: RunOutcomeKind::Succeeded,
                ..
            }
        ));
        let timeout = slurm_status(1, parse_squeue("TIMEOUT|None"), None, None, false, false);
        assert!(matches!(
            timeout,
            RunStatus::Finished {
                outcome: RunOutcomeKind::TimedOut,
                ..
            }
        ));
    }

    #[test]
    fn sacct_states_map_to_run_status() {
        let status = |line: &str| slurm_status(1, None, parse_sacct(line), None, false, false);
        assert!(matches!(
            status("COMPLETED|0:0"),
            RunStatus::Finished {
                exit_code: Some(0),
                outcome: RunOutcomeKind::Succeeded,
                ..
            }
        ));
        assert!(matches!(
            status("FAILED|2:0"),
            RunStatus::Finished {
                exit_code: Some(2),
                outcome: RunOutcomeKind::Failed,
                ..
            }
        ));
        assert!(matches!(
            status("CANCELLED by 1000|0:15"),
            RunStatus::Finished {
                outcome: RunOutcomeKind::Cancelled,
                ..
            }
        ));
        assert!(matches!(
            status("TIMEOUT|0:15"),
            RunStatus::Finished {
                outcome: RunOutcomeKind::TimedOut,
                ..
            }
        ));
        assert!(matches!(
            status("OUT_OF_MEMORY|0:125"),
            RunStatus::Finished { outcome: RunOutcomeKind::Failed, note: Some(ref note), .. } if note.contains("memory")
        ));
        assert!(matches!(
            status("NODE_FAIL|0:0"),
            RunStatus::Finished {
                outcome: RunOutcomeKind::Failed,
                ..
            }
        ));
    }

    #[test]
    fn accounting_disabled_falls_back_to_markers() {
        let acct = parse_sacct("COMPLETED|0:0");
        assert!(matches!(
            slurm_status(1, None, acct.clone(), Some(0), false, true),
            RunStatus::Finished {
                exit_code: Some(0),
                ..
            }
        ));
        assert!(matches!(
            slurm_status(1, None, None, None, true, true),
            RunStatus::Finished { exit_code: None, note: Some(ref note), .. } if note.contains("without an exit code")
        ));
        assert!(matches!(
            slurm_status(1, None, None, None, false, true),
            RunStatus::Lost { .. }
        ));
    }

    #[cfg(unix)]
    mod remote {
        use super::*;
        use crate::runs::remote::testing::{wait_for_end, world_with, write_script, World};

        fn slurm_world() -> World {
            let world = world_with(
                |id| ComputeTarget::Slurm {
                    id,
                    label: "Cluster".into(),
                    host: "fakehost".into(),
                    user: None,
                    port: None,
                    remote_root: None,
                    prelude: String::new(),
                    defaults: Resources::default(),
                    gpu_flag: GpuFlag::Gres,
                },
                false,
            );
            let state = world.remote("slurm-state");
            std::fs::create_dir_all(&state).unwrap();
            let bin = world.remote_home().parent().unwrap().join("bin-remote");
            let state = state.display().to_string();
            write_script(
                &bin.join("sbatch"),
                &format!(
                    r#"#!/bin/sh
S='{state}'
script="$2"
id=$(( $(cat "$S/next" 2>/dev/null || echo 1000) + 1 ))
echo $id > "$S/next"
echo RUNNING > "$S/$id.state"
( SLURM_SUBMIT_DIR="$(pwd)" SLURM_JOB_ID=$id sh "$script" >> stdout.log 2>&1; echo $? > "$S/$id.code"; echo COMPLETED > "$S/$id.state" ) < /dev/null > /dev/null 2>&1 &
echo "$id"
"#
                ),
            );
            write_script(
                &bin.join("squeue"),
                &format!(
                    r#"#!/bin/sh
S='{state}'
for a in "$@"; do case "$a" in --jobs=*) id="${{a#--jobs=}}";; esac; done
[ -f "$S/$id.state" ] || exit 1
echo "$(cat "$S/$id.state")|None"
"#
                ),
            );
            write_script(&bin.join("sacct"), "#!/bin/sh\nexit 1\n");
            write_script(
                &bin.join("scancel"),
                &format!("#!/bin/sh\nS='{state}'\nfor a in \"$@\"; do case \"$a\" in -*) ;; *) echo CANCELLED > \"$S/$a.state\";; esac; done\n"),
            );
            world
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn end_to_end_with_fake_slurm() {
            let world = slurm_world();
            let executor = SlurmExecutor::new(world.host.clone());
            let handle = executor
                .start(&world.spec(
                    "r001",
                    "echo \"loss: 0.25\"; mkdir -p results; echo ok > results/a.txt",
                ))
                .await
                .unwrap();
            let data: SlurmHandleData = handle_data(&handle).unwrap();
            assert_eq!(data.job_id.as_deref(), Some("1001"));
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
            assert!(std::fs::read_to_string(handle.run_dir.join("stdout.log"))
                .unwrap()
                .contains("loss: 0.25"));
            assert!(world
                .workspace()
                .join("runs/r001/outputs/results/a.txt")
                .is_file());
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        async fn recovers_a_job_id_written_before_a_crash() {
            let world = slurm_world();
            let executor = SlurmExecutor::new(world.host.clone());
            let mut handle = executor
                .start(&world.spec("r001", "sleep 1"))
                .await
                .unwrap();
            let mut data: SlurmHandleData = handle_data(&handle).unwrap();
            data.job_id = None;
            handle.data = serde_json::to_value(&data).unwrap();
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
        }
    }
}
