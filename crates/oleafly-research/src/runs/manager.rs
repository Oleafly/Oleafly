//! Starts runs, watches them until they end, and wakes the tasks that wait.
//! Every update of a live run row only applies while it is still live, so
//! the app and the daemon can both watch the same run safely.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use oleafly_agent::CancellationToken;
use serde::Serialize;
use tokio::sync::{broadcast, Semaphore};

use super::metrics::{summarize_file, summarize_log};
use super::{
    next_run_id, validate_cwd_rel, validate_run_env, LogQuery, RunError, RunExecutor, RunHandle,
    RunOutcomeKind, RunSpec, RunStatus, MAX_IN_FLIGHT_RUNS, MAX_RUN_COMMAND_BYTES, POLL_EVERY,
    WAIT_MAX,
};
use crate::model::{now_ms, CommandPolicy, ResearchTask, RunRecord, RunState, TaskRuntimeEvent};
use crate::scheduler::{lock, TaskEventSink};
use crate::store::TaskStore;
use oleafly_sandbox::profile::{
    detect_runtimes_cached, prepare_home, spec_for_run, task_home, DetectInputs, LinkedFolder,
    RunInputs,
};

/// Checks that may run at once. Each live run is checked in a task of its
/// own, so a host that answers slowly (or a run that ends and copies its
/// outputs) holds up only that run.
const MAX_CONCURRENT_CHECKS: usize = 32;
/// A run whose checks keep failing is checked up to `2^3` times less often.
const MAX_BACKOFF_STEPS: u32 = 3;
/// A run whose start never finished (the app quit while it started) is lost
/// after this long.
const START_DEADLINE_MS: i64 = 10 * 60 * 1000;
/// Metrics of runs that left only a log are read from its last 64 MiB.
const LOG_METRICS_WINDOW: u64 = 64 * 1024 * 1024;
const LOG_TAIL_LINES: usize = 40;
const MAX_LOG_TAIL_BYTES: usize = 4 * 1024;

/// What the task asked to run.
pub struct StartRun {
    pub task: ResearchTask,
    pub execution_root: PathBuf,
    pub allowed_paths: Vec<String>,
    /// Extra read-only grants (skill folders).
    pub read_paths: Vec<PathBuf>,
    /// The project's linked data folders.
    pub linked: Vec<LinkedFolder>,
    /// Where interpreters are looked for.
    pub search_dirs: Vec<PathBuf>,
    /// The real project folder (its virtual environments).
    pub project_root: Option<PathBuf>,
    pub name: String,
    pub command: String,
    pub cwd_rel: Option<String>,
    pub env: BTreeMap<String, String>,
    pub timeout_minutes: Option<u32>,
}

/// A finished run as the agent is told about it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub name: String,
    pub state: RunState,
    pub exit_code: Option<i32>,
    pub metrics: BTreeMap<String, f64>,
    /// At most 4 KiB.
    pub log_tail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WaitOutcome {
    pub finished: Vec<RunSummary>,
    pub still_running: Vec<String>,
    pub timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A run ended (sent to every waiter of every task).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunCompletion {
    pub task_id: String,
    pub run_id: String,
}

/// A run the monitor checks: when it is due next, and how often in a row its
/// checks went wrong.
struct Watch {
    next_at: Instant,
    checking: bool,
    troubles: u32,
}

/// How a check of one run went.
enum Checked {
    /// The run ended (or was lost) and is recorded.
    Settled,
    /// Still going.
    Pending,
    /// The executor could not reach the run.
    Trouble,
}

/// A run's executor state kept for the cleanup of a deleted task.
pub struct RunCleanup {
    handle: RunHandle,
    /// The run had not ended: it is stopped before its folder goes.
    live: bool,
}

pub struct RunManager {
    tasks_root: PathBuf,
    runtime: tokio::runtime::Handle,
    executors: Mutex<HashMap<&'static str, Arc<dyn RunExecutor>>>,
    completions: broadcast::Sender<RunCompletion>,
    monitoring: AtomicBool,
    /// Live runs the monitor checks, by task and run id.
    watches: Mutex<HashMap<(String, String), Watch>>,
    checks: Arc<Semaphore>,
    /// Transcript sinks of running generations, by task.
    sinks: Mutex<HashMap<String, (u64, TaskEventSink)>>,
    /// Runs whose start is under way in this process, by task and run id.
    /// A remote start can take longer than [`START_DEADLINE_MS`] (a large
    /// upload), so these are never lost for taking long.
    starting: Mutex<HashSet<(String, String)>>,
    this: Weak<RunManager>,
}

/// Takes a run off [`RunManager::starting`] when its start ends, however it
/// ends.
struct Starting {
    manager: Arc<RunManager>,
    key: (String, String),
}

impl Drop for Starting {
    fn drop(&mut self) {
        lock(&self.manager.starting).remove(&self.key);
    }
}

fn state_of(outcome: RunOutcomeKind) -> RunState {
    match outcome {
        RunOutcomeKind::Succeeded => RunState::Succeeded,
        RunOutcomeKind::Failed => RunState::Failed,
        RunOutcomeKind::TimedOut => RunState::TimedOut,
        RunOutcomeKind::Cancelled => RunState::Cancelled,
    }
}

fn valid_name(name: &str) -> bool {
    let count = name.chars().count();
    (1..=80).contains(&count) && !name.chars().any(char::is_control)
}

fn append_to_log(run_dir: &std::path::Path, line: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(run_dir.join("stdout.log"))
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Stops and clears what a start that failed may have left on the other
/// side: an upload, or a job whose answer was lost. The executors write
/// `handle.json` before they change anything remotely.
async fn abandon_start(executor: &Arc<dyn RunExecutor>, run_dir: &std::path::Path) {
    let Some(handle) = tokio::fs::read_to_string(run_dir.join("handle.json"))
        .await
        .ok()
        .and_then(|json| RunHandle::parse(&json).ok())
    else {
        return;
    };
    let _ = executor.cancel(&handle).await;
    let _ = executor.discard(&handle).await;
}

fn bounded_tail(text: String) -> String {
    if text.len() <= MAX_LOG_TAIL_BYTES {
        return text;
    }
    let mut start = text.len() - MAX_LOG_TAIL_BYTES;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_owned()
}

impl RunManager {
    pub fn new(tasks_root: PathBuf, runtime: tokio::runtime::Handle) -> Arc<Self> {
        let (completions, _) = broadcast::channel(64);
        Arc::new_cyclic(|this| Self {
            tasks_root,
            runtime,
            executors: Mutex::new(HashMap::new()),
            completions,
            monitoring: AtomicBool::new(false),
            watches: Mutex::new(HashMap::new()),
            checks: Arc::new(Semaphore::new(MAX_CONCURRENT_CHECKS)),
            sinks: Mutex::new(HashMap::new()),
            starting: Mutex::new(HashSet::new()),
            this: this.clone(),
        })
    }

    pub fn register_executor(&self, executor: Arc<dyn RunExecutor>) {
        lock(&self.executors).insert(executor.id(), executor);
    }

    pub fn executor_ids(&self) -> Vec<&'static str> {
        let mut ids: Vec<_> = lock(&self.executors).keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    fn executor(&self, id: &str) -> Option<Arc<dyn RunExecutor>> {
        lock(&self.executors).get(id).cloned()
    }

    fn store(&self) -> Result<TaskStore, String> {
        TaskStore::new(self.tasks_root.clone())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RunCompletion> {
        self.completions.subscribe()
    }

    /// Run events of a task go to the transcript of its running generation.
    pub fn attach_sink(&self, task_id: &str, generation: u64, sink: TaskEventSink) {
        lock(&self.sinks).insert(task_id.to_owned(), (generation, sink));
    }

    pub fn detach_sink(&self, task_id: &str, generation: u64) {
        let mut sinks = lock(&self.sinks);
        if sinks
            .get(task_id)
            .is_some_and(|(current, _)| *current == generation)
        {
            sinks.remove(task_id);
        }
    }

    fn emit(&self, record: &RunRecord) {
        let sink = lock(&self.sinks)
            .get(&record.task_id)
            .filter(|(generation, _)| *generation == record.execution_generation)
            .map(|(_, sink)| sink.clone());
        if let Some(sink) = sink {
            sink(TaskRuntimeEvent::Run {
                run_id: record.run_id.clone(),
                name: record.name.clone(),
                state: record.state,
                exit_code: record.exit_code,
            });
        }
    }

    fn completed(&self, task_id: &str, run_id: &str) {
        if let Ok(record) = self.store().and_then(|store| store.run(task_id, run_id)) {
            self.emit(&record);
        }
        let _ = self.completions.send(RunCompletion {
            task_id: task_id.to_owned(),
            run_id: run_id.to_owned(),
        });
    }

    /// Checks the request, records the run and starts it in the background
    /// (a remote start uploads the workspace first). Returns at once with
    /// the run starting.
    pub async fn start(&self, request: StartRun) -> Result<RunRecord, String> {
        let manager = self.this.upgrade().ok_or("Runs are shutting down.")?;
        // The checks and the sandbox spec read SQLite and walk the
        // workspace's allowed paths: off the async workers.
        let preparing = manager.clone();
        let (store, executor, spec, record) = self
            .runtime
            .spawn_blocking(move || preparing.prepare_start(request))
            .await
            .map_err(|error| format!("The run could not be prepared: {error}"))??;
        self.emit(&record);
        let starting = Starting {
            manager: manager.clone(),
            key: (record.task_id.clone(), record.run_id.clone()),
        };
        lock(&self.starting).insert(starting.key.clone());
        self.runtime.spawn(async move {
            let started = executor.start(&spec).await;
            manager.started(&store, &executor, &spec, started).await;
            drop(starting);
        });
        Ok(record)
    }

    /// Checks a run request, prepares its sandbox and records it as
    /// starting (blocking).
    fn prepare_start(
        &self,
        request: StartRun,
    ) -> Result<(TaskStore, Arc<dyn RunExecutor>, RunSpec, RunRecord), String> {
        let task = &request.task;
        let brief = &task.brief;
        if brief.permissions.commands == CommandPolicy::Off {
            return Err("Commands are turned off for this task.".into());
        }
        let name = request.name.trim();
        if !valid_name(name) {
            return Err("Name the run in 1 to 80 characters.".into());
        }
        let command = request.command.trim();
        if command.is_empty() || command.len() > MAX_RUN_COMMAND_BYTES {
            return Err("A run command can be up to 16 KiB.".into());
        }
        validate_run_env(&request.env)?;
        let cwd_rel = validate_cwd_rel(request.cwd_rel.as_deref().unwrap_or(""))?;
        let limit = brief.budget.run_timeout_minutes;
        let minutes = request.timeout_minutes.unwrap_or(limit);
        if minutes == 0 || minutes > limit {
            return Err(format!("Runs in this task can last up to {limit} minutes."));
        }
        let store = self.store()?;
        let runs = store.runs(&task.id)?;
        if let Some(max) = brief.budget.max_runs {
            // Runs from before a fresh start don't count.
            let counted = runs.len().saturating_sub(store.runs_baseline(&task.id)?);
            if counted >= max as usize {
                return Err(format!("The task reached its run limit of {max}."));
            }
        }
        if runs.iter().filter(|run| !run.state.is_terminal()).count() >= MAX_IN_FLIGHT_RUNS {
            return Err("Wait for a run to finish before starting another.".into());
        }
        let executor_id = brief.compute.executor.trim();
        let executor = self
            .executor(executor_id)
            .ok_or_else(|| format!("The {executor_id} compute target isn't available."))?;
        if executor_id == "local" {
            let data_root = self.tasks_root.parent().unwrap_or(&self.tasks_root);
            if let Some(reason) =
                super::remote::settings::local_commands_unavailable_reason(data_root)
            {
                return Err(reason);
            }
        }
        let run_id = next_run_id(runs.len());
        let run_dir = self.tasks_root.join("runs").join(&task.id).join(&run_id);
        std::fs::create_dir_all(&run_dir)
            .map_err(|error| format!("The run folder could not be created: {error}"))?;
        // One home per task: package installs and caches carry over between runs.
        let home = task_home(&self.tasks_root, &task.id);
        prepare_home(&home)
            .map_err(|error| format!("The task's home folder could not be created: {error}"))?;
        let network = brief.permissions.network;
        let root = &request.execution_root;
        let writable = crate::task_tools::task_writable_paths(root, &request.allowed_paths)?;
        let user_home = oleafly_sandbox::home_dir();
        let env = |name: &str| std::env::var_os(name);
        let runtimes = detect_runtimes_cached(&DetectInputs {
            search_dirs: &request.search_dirs,
            project_root: request.project_root.as_deref(),
            home: user_home.as_deref(),
            env: &env,
        });
        let host_env = |name: &str| std::env::var(name).ok();
        let owner = format!("task:{}", task.id);
        let mut sandbox = spec_for_run(&RunInputs {
            profile: brief.profile,
            owner: &owner,
            project: Some(&task.project_id),
            workspace: root,
            writable: &writable,
            protected: &[root.join(".git"), root.join(".oleafly")],
            home: &home,
            network,
            linked: &request.linked,
            extra_read: &request.read_paths,
            runtimes: &runtimes,
            host_env: &host_env,
        })?;
        // Runs start `uv`, `pixi`, `cargo` and the like, which spawn helpers;
        // Seatbelt refuses that unless the spec allows it. Short task
        // commands keep the stricter rule.
        sandbox.child_processes = true;
        let spec = RunSpec {
            task_id: task.id.clone(),
            run_id: run_id.clone(),
            command: command.to_owned(),
            cwd_rel: cwd_rel.clone(),
            env: request.env.clone(),
            timeout: Duration::from_secs(u64::from(minutes) * 60),
            profile: brief.profile,
            workspace: request.execution_root.clone(),
            resources: brief.compute.resources.clone(),
            target: brief.compute.target.clone(),
            run_dir: run_dir.clone(),
            network,
            sandbox: Some(sandbox),
        };
        let record = RunRecord {
            task_id: task.id.clone(),
            run_id: run_id.clone(),
            execution_generation: task.execution_generation,
            name: name.to_owned(),
            executor: executor_id.to_owned(),
            command: command.to_owned(),
            cwd_rel,
            state: RunState::Starting,
            exit_code: None,
            started_at: now_ms(),
            finished_at: None,
            run_dir: run_dir.to_string_lossy().into_owned(),
            metrics: BTreeMap::new(),
            reported: false,
        };
        store.insert_run(&record)?;
        Ok((store, executor, spec, record))
    }

    /// Records how a run's start went (it ran in the background).
    async fn started(
        &self,
        store: &TaskStore,
        executor: &Arc<dyn RunExecutor>,
        spec: &RunSpec,
        started: Result<RunHandle, RunError>,
    ) {
        match started {
            Ok(handle) => {
                let saved = match serde_json::to_string(&handle) {
                    Ok(json) => {
                        let _ = tokio::fs::write(spec.run_dir.join("handle.json"), &json).await;
                        store.set_run_handle(&spec.task_id, &spec.run_id, &json)
                    }
                    Err(error) => Err(error.to_string()),
                };
                if let Err(error) = saved {
                    append_to_log(
                        &spec.run_dir,
                        &format!("[Oleafly lost track of this run: {error}]"),
                    );
                }
                // A cancel that came while the run started had no handle to
                // stop: stop the run now that it has one.
                if store
                    .run(&spec.task_id, &spec.run_id)
                    .is_ok_and(|run| run.state.is_terminal())
                {
                    let _ = executor.cancel(&handle).await;
                    return;
                }
                self.ensure_monitor();
            }
            Err(error) => {
                append_to_log(
                    &spec.run_dir,
                    &format!("[Oleafly could not start this run: {error}]"),
                );
                if store
                    .finish_run(
                        &spec.task_id,
                        &spec.run_id,
                        RunState::Failed,
                        None,
                        now_ms(),
                        &BTreeMap::new(),
                    )
                    .unwrap_or(false)
                {
                    self.completed(&spec.task_id, &spec.run_id);
                }
                abandon_start(executor, &spec.run_dir).await;
            }
        }
    }

    pub fn list(&self, task_id: &str) -> Result<Vec<RunRecord>, String> {
        self.store()?.runs(task_id)
    }

    pub fn in_flight(&self, task_id: &str) -> Result<Vec<RunRecord>, String> {
        Ok(self
            .list(task_id)?
            .into_iter()
            .filter(|run| !run.state.is_terminal())
            .collect())
    }

    /// Finished runs that the agent was not told about yet.
    pub fn unreported(&self, task_id: &str) -> Result<Vec<RunRecord>, String> {
        self.store()?.unreported_runs(task_id)
    }

    fn handle_of(&self, task_id: &str, run_id: &str) -> Result<RunHandle, String> {
        let json = self
            .store()?
            .run_handle(task_id, run_id)?
            .ok_or_else(|| format!("Run {run_id} has not started yet."))?;
        RunHandle::parse(&json)
    }

    pub async fn read_log(
        &self,
        task_id: &str,
        run_id: &str,
        query: LogQuery,
    ) -> Result<String, String> {
        let record = self.store()?.run(task_id, run_id)?;
        match self.handle_of(task_id, run_id) {
            Ok(handle) => match self.executor(&handle.executor) {
                Some(executor) => executor
                    .read_log(&handle, query)
                    .await
                    .map_err(|error| error.to_string()),
                None => {
                    super::log::answer_blocking(
                        PathBuf::from(&record.run_dir).join("stdout.log"),
                        query,
                    )
                    .await
                }
            },
            // A run that failed to start still has the log of why.
            Err(_) => {
                super::log::answer_blocking(
                    PathBuf::from(&record.run_dir).join("stdout.log"),
                    query,
                )
                .await
            }
        }
    }

    pub async fn cancel(&self, task_id: &str, run_id: &str) -> Result<(), String> {
        let store = self.store()?;
        let record = store.run(task_id, run_id)?;
        if record.state.is_terminal() {
            return Ok(());
        }
        let Ok(handle) = self.handle_of(task_id, run_id) else {
            // The run is still starting (an upload can take minutes), so there
            // is nothing to stop yet. Record the cancel: the start stops the
            // run as soon as it has a handle.
            if store.finish_run(
                task_id,
                run_id,
                RunState::Cancelled,
                None,
                now_ms(),
                &BTreeMap::new(),
            )? {
                self.completed(task_id, run_id);
            }
            // A start that finished meanwhile has a handle by now.
            if let Ok(handle) = self.handle_of(task_id, run_id) {
                self.stop(&handle).await?;
            }
            return Ok(());
        };
        // Kept on the row: while the run still reports running, the monitor
        // sends the cancel again (its host may be out of reach right now).
        store.request_run_cancel(task_id, run_id)?;
        let stopped = self.stop(&handle).await;
        self.ensure_monitor();
        stopped
    }

    async fn stop(&self, handle: &RunHandle) -> Result<(), String> {
        let executor = self
            .executor(&handle.executor)
            .ok_or_else(|| format!("The {} compute target isn't available.", handle.executor))?;
        executor
            .cancel(handle)
            .await
            .map_err(|error| error.to_string())
    }

    /// Stops every live run of a task (its generation ended).
    pub async fn cancel_all(&self, task_id: &str) {
        for run in self.in_flight(task_id).unwrap_or_default() {
            let _ = self.cancel(task_id, &run.run_id).await;
        }
    }

    /// What a task's runs left on other computers. Read it before the task's
    /// rows go: deleting the task deletes its run rows with it.
    pub fn cleanup_handles(&self, task_id: &str) -> Vec<RunCleanup> {
        let Ok(store) = self.store() else {
            return Vec::new();
        };
        store
            .runs(task_id)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|run| {
                if let Some(handle) = store
                    .run_handle(task_id, &run.run_id)
                    .ok()
                    .flatten()
                    .and_then(|json| RunHandle::parse(&json).ok())
                {
                    return Some(RunCleanup {
                        handle,
                        live: !run.state.is_terminal(),
                    });
                }
                // A start cut off by a quit or a crash recorded no handle, but
                // the executor wrote `handle.json` before it changed anything
                // remotely: an upload, or a job, may still be there.
                let json = std::fs::read_to_string(PathBuf::from(&run.run_dir).join("handle.json"))
                    .ok()?;
                Some(RunCleanup {
                    handle: RunHandle::parse(&json).ok()?,
                    live: true,
                })
            })
            .collect()
    }

    /// Removes what a deleted task's runs left behind (`runs` from
    /// [`Self::cleanup_handles`]): remote folders, per-task Spaces, then the
    /// local run folders, the cache and the sandbox home.
    pub async fn cleanup_task(&self, task_id: &str, runs: Vec<RunCleanup>) {
        for run in runs {
            if let Some(executor) = self.executor(&run.handle.executor) {
                if run.live {
                    let _ = executor.cancel(&run.handle).await;
                }
                let _ = executor.cleanup(&run.handle).await;
            }
        }
        let _ = tokio::fs::remove_dir_all(self.tasks_root.join("runs").join(task_id)).await;
        let _ = tokio::fs::remove_dir_all(self.tasks_root.join("cache").join(task_id)).await;
        // The task's sandbox profile (Windows) and its home folder go with it.
        let owner = format!("task:{task_id}");
        let home = task_home(&self.tasks_root, task_id);
        let _ = tokio::task::spawn_blocking(move || {
            let _ = oleafly_sandbox::release(&owner);
            let _ = std::fs::remove_dir_all(home);
        })
        .await;
    }

    /// Waits until a run of the task (one of `ids`, when given) finishes,
    /// the timeout passes or the task is cancelled. Finished runs the agent
    /// has not seen return at once, each only once.
    pub async fn wait(
        &self,
        task_id: &str,
        ids: Option<Vec<String>>,
        timeout: Duration,
        cancel: &CancellationToken,
    ) -> Result<WaitOutcome, String> {
        let deadline = Instant::now() + timeout.min(WAIT_MAX);
        let mut completions = self.subscribe();
        loop {
            let runs = self.list(task_id)?;
            let wanted =
                |run: &&RunRecord| ids.as_ref().is_none_or(|ids| ids.contains(&run.run_id));
            let finished: Vec<RunRecord> = runs
                .iter()
                .filter(wanted)
                .filter(|run| run.state.is_terminal() && !run.reported)
                .cloned()
                .collect();
            let running: Vec<String> = runs
                .iter()
                .filter(wanted)
                .filter(|run| !run.state.is_terminal())
                .map(|run| run.run_id.clone())
                .collect();
            if !finished.is_empty() {
                let ids: Vec<String> = finished.iter().map(|run| run.run_id.clone()).collect();
                self.store()?.mark_runs_reported(task_id, &ids)?;
                let mut summaries = Vec::with_capacity(finished.len());
                for run in finished {
                    let log_tail = self
                        .read_log(
                            task_id,
                            &run.run_id,
                            LogQuery::Tail {
                                lines: LOG_TAIL_LINES,
                            },
                        )
                        .await
                        .unwrap_or_default();
                    summaries.push(RunSummary {
                        run_id: run.run_id,
                        name: run.name,
                        state: run.state,
                        exit_code: run.exit_code,
                        metrics: run.metrics,
                        log_tail: bounded_tail(log_tail),
                    });
                }
                return Ok(WaitOutcome {
                    finished: summaries,
                    still_running: running,
                    timed_out: false,
                    note: None,
                });
            }
            if running.is_empty() {
                return Ok(WaitOutcome {
                    finished: Vec::new(),
                    still_running: Vec::new(),
                    timed_out: false,
                    note: Some("No runs are in flight.".into()),
                });
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(WaitOutcome {
                    finished: Vec::new(),
                    still_running: running,
                    timed_out: true,
                    note: None,
                });
            }
            self.ensure_monitor();
            tokio::select! {
                _ = completions.recv() => {}
                _ = tokio::time::sleep(remaining.min(Duration::from_secs(5))) => {}
                _ = cancel.cancelled() => return Err("The task was cancelled.".into()),
            }
        }
    }

    /// Starts watching when live runs exist (after a restart, too).
    pub fn reattach(&self) {
        self.ensure_monitor();
    }

    fn ensure_monitor(&self) {
        if self.monitoring.swap(true, Ordering::AcqRel) {
            return;
        }
        self.runtime.spawn(Self::monitor(self.this.clone()));
    }

    /// Watches the live runs until none are left. It holds the manager only
    /// while it hands them out, so a manager that is dropped (or replaced)
    /// stops watching instead of racing the one that took over its runs.
    async fn monitor(this: Weak<Self>) {
        loop {
            let Some(manager) = this.upgrade() else {
                return;
            };
            let live = manager
                .store()
                .and_then(|store| store.live_runs())
                .unwrap_or_default();
            if live.is_empty() {
                manager.monitoring.store(false, Ordering::Release);
                // A run may have started between the read and the flag.
                let again = manager
                    .store()
                    .and_then(|store| store.live_runs())
                    .unwrap_or_default();
                if again.is_empty() || manager.monitoring.swap(true, Ordering::AcqRel) {
                    return;
                }
                continue;
            }
            manager.dispatch(live);
            drop(manager);
            tokio::time::sleep(POLL_EVERY).await;
        }
    }

    /// Starts a check, in a task of its own, for every live run that is due
    /// and not being checked already.
    fn dispatch(self: &Arc<Self>, live: Vec<(RunRecord, Option<String>)>) {
        let now = Instant::now();
        let mut watches = lock(&self.watches);
        let ids: HashSet<(&str, &str)> = live
            .iter()
            .map(|(record, _)| (record.task_id.as_str(), record.run_id.as_str()))
            .collect();
        watches.retain(|(task_id, run_id), _| ids.contains(&(task_id.as_str(), run_id.as_str())));
        for (record, handle) in live {
            let key = (record.task_id.clone(), record.run_id.clone());
            let watch = watches.entry(key.clone()).or_insert(Watch {
                next_at: now,
                checking: false,
                troubles: 0,
            });
            if watch.checking || watch.next_at > now {
                continue;
            }
            watch.checking = true;
            let every = self.poll_every(handle.as_deref());
            let manager = self.clone();
            self.runtime.spawn(async move {
                let checked = match manager.checks.clone().acquire_owned().await {
                    Ok(_slot) => manager.check(record, handle).await,
                    Err(_) => Checked::Pending,
                };
                if let Some(watch) = lock(&manager.watches).get_mut(&key) {
                    watch.checking = false;
                    watch.troubles = match checked {
                        Checked::Trouble => (watch.troubles + 1).min(MAX_BACKOFF_STEPS),
                        _ => 0,
                    };
                    watch.next_at = Instant::now() + every * 2u32.pow(watch.troubles);
                }
            });
        }
    }

    /// How often the run behind `handle` is checked.
    fn poll_every(&self, handle: Option<&str>) -> Duration {
        handle
            .and_then(|json| RunHandle::parse(json).ok())
            .and_then(|handle| self.executor(&handle.executor))
            .map_or(POLL_EVERY, |executor| executor.poll_every())
    }

    async fn check(&self, record: RunRecord, handle: Option<String>) -> Checked {
        let Ok(store) = self.store() else {
            return Checked::Pending;
        };
        let Some(handle) = handle else {
            // A start still under way, here or in another live process, may
            // take as long as its upload: it records how it went itself.
            let key = (record.task_id.clone(), record.run_id.clone());
            if lock(&self.starting).contains(&key)
                || store
                    .run_starting_elsewhere(&record.task_id, &record.run_id)
                    .unwrap_or(false)
            {
                return Checked::Pending;
            }
            if now_ms() - record.started_at > START_DEADLINE_MS
                && store
                    .lose_run(&record.task_id, &record.run_id)
                    .unwrap_or(false)
            {
                let run_dir = PathBuf::from(&record.run_dir);
                append_to_log(&run_dir, "[The run never finished starting.]");
                self.completed(&record.task_id, &record.run_id);
                // The cut-off start may have left an upload or a job behind.
                if let Some(executor) = self.executor(&record.executor) {
                    abandon_start(&executor, &run_dir).await;
                }
                return Checked::Settled;
            }
            return Checked::Pending;
        };
        let handle = match RunHandle::parse(&handle) {
            Ok(handle) => handle,
            Err(error) => {
                if store
                    .lose_run(&record.task_id, &record.run_id)
                    .unwrap_or(false)
                {
                    append_to_log(&PathBuf::from(&record.run_dir), &format!("[{error}]"));
                    self.completed(&record.task_id, &record.run_id);
                    return Checked::Settled;
                }
                return Checked::Pending;
            }
        };
        // Another host may run executors this one does not have.
        let Some(executor) = self.executor(&handle.executor) else {
            return Checked::Pending;
        };
        let status = match executor.poll(&handle).await {
            Ok(status) => status,
            Err(_) => return Checked::Trouble,
        };
        let (state, exit_code, finished_at) = match status {
            RunStatus::Finished {
                exit_code,
                finished_at,
                outcome,
                note,
            } => {
                if let Some(note) = note {
                    append_to_log(&handle.run_dir, &format!("[{note}]"));
                }
                (state_of(outcome), exit_code, finished_at)
            }
            RunStatus::Lost { reason } => {
                append_to_log(&handle.run_dir, &format!("[{reason}]"));
                (RunState::Lost, None, now_ms())
            }
            // A note on a running run says the host could not be reached.
            RunStatus::Running { note: Some(_), .. } => return Checked::Trouble,
            RunStatus::Starting | RunStatus::Queued { .. } | RunStatus::Running { .. } => {
                // A cancel that never reached the host goes again, less
                // often while the host stays out of reach.
                if store
                    .run_cancel_requested(&record.task_id, &record.run_id)
                    .unwrap_or(false)
                    && executor.cancel(&handle).await.is_err()
                {
                    return Checked::Trouble;
                }
                return Checked::Pending;
            }
        };
        let run_dir = handle.run_dir.clone();
        let summary = tokio::task::spawn_blocking(move || {
            let summary = summarize_file(&run_dir.join("metrics.jsonl"));
            if summary.points == 0 {
                summarize_log(&run_dir.join("stdout.log"), LOG_METRICS_WINDOW)
            } else {
                summary
            }
        })
        .await
        .unwrap_or_default();
        if store
            .finish_run(
                &record.task_id,
                &record.run_id,
                state,
                exit_code,
                finished_at,
                &summary.last,
            )
            .unwrap_or(false)
        {
            self.completed(&record.task_id, &record.run_id);
        }
        Checked::Settled
    }
}
