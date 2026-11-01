use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};

use oleafly_research::builtin::{BuiltinTaskAdapter, TaskHost};
use oleafly_research::handoff::{HandoffReason, HandoffRecord};
use oleafly_research::host::OwnerKind;
use oleafly_research::model::{ResearchTask, ResearchTaskStatus};
use oleafly_research::scheduler::{handoff_record_for, ResearchTaskState, SuspendMode};
use oleafly_research::store::TaskStore;

use super::acp_task::{default_launcher, DaemonAcpAdapter};
use super::hosts::{grant_for, DaemonResearchHost, DaemonTaskHost, LiveSpend};
use super::lock::HelperLock;
use super::log::HelperLog;
use super::notify::Notifier;
use super::paths::{ensure_dir, helper_paths, HelperPaths};
use super::state::{now_ms, HelperState, Phase, StateWriter, STATE_VERSION};
use crate::agent::desktop_config::{self, secret_values, Prefs};

pub use super::state::ServeMode;

pub const TICK: Duration = Duration::from_secs(1);
pub const HEARTBEAT: Duration = Duration::from_secs(5);
pub const LOCK_BUDGET: Duration = Duration::from_secs(10);
const FOREGROUND_LOCK_BUDGET: Duration = Duration::from_secs(2);
const STOP_SUSPEND: Duration = Duration::from_secs(30);
const SIGNAL_SUSPEND: Duration = Duration::from_secs(10);
const RELEASE_MARGIN: Duration = Duration::from_secs(10);
const PREFS_REFRESH: Duration = Duration::from_secs(10);
const IN_FLIGHT_POLL: Duration = Duration::from_millis(200);
const CONCURRENCY: usize = 2;
pub const ALREADY_RUNNING: i32 = 8;

pub type Localizer = Arc<dyn Fn(&str, &[(&str, &str)]) -> String + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AppLaunch {
    MacBundle(&'static str),
    Program(PathBuf),
    AppImage(PathBuf),
}

impl AppLaunch {
    pub fn open(&self) {
        let mut command = match self {
            Self::MacBundle(bundle) => {
                let mut command = std::process::Command::new("/usr/bin/open");
                command.args(["-b", bundle]);
                command
            }
            Self::Program(program) => std::process::Command::new(program),
            Self::AppImage(image) => {
                let mut command = std::process::Command::new(image);
                for name in super::client::APPIMAGE_ENV {
                    command.env_remove(name);
                }
                command
            }
        };
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        crate::process::detach(&mut command);
        if let Ok(mut child) = command.spawn() {
            let _ = std::thread::Builder::new()
                .name("oleafly-open-app".into())
                .spawn(move || {
                    let _ = child.wait();
                });
        }
    }
}

pub struct ServeOptions {
    pub mode: ServeMode,
    pub data_root: PathBuf,
    pub exe: PathBuf,
    pub resources_dir: Option<PathBuf>,
    pub app_launch: Option<AppLaunch>,
    pub localize: Option<Localizer>,
    pub stay: bool,
    pub log_to_stderr: bool,
    pub idle_grace: Duration,
}

#[cfg(test)]
#[allow(clippy::type_complexity)]
pub(crate) static BEFORE_FINAL_CHECK: std::sync::Mutex<Option<(PathBuf, Box<dyn Fn() + Send>)>> =
    std::sync::Mutex::new(None);

fn store(tasks_root: &Path) -> Result<TaskStore, String> {
    TaskStore::with_owner_kind(tasks_root.to_path_buf(), OwnerKind::Daemon)
}

pub fn serve(options: ServeOptions) -> i32 {
    let paths = helper_paths(&options.data_root);
    if let Err(error) = ensure_dir(&paths) {
        if options.log_to_stderr {
            eprintln!("The background helper's folder could not be made: {error}");
        }
        return 1;
    }
    let config = desktop_config::load(&options.data_root);
    let secrets = config.as_ref().map(secret_values).unwrap_or_default();
    let log = Arc::new(HelperLog::open(&paths.log, secrets, options.log_to_stderr));
    let prefs = match &config {
        Ok(config) => config.prefs,
        Err(error) => {
            log.event(
                "error",
                "settings_unreadable",
                &[("message", &error.to_string())],
            );
            Prefs {
                notifications: false,
                keep_awake: false,
                ..Prefs::default()
            }
        }
    };
    if options.mode == ServeMode::AtLogin && !prefs.background_enabled {
        log.event("info", "background_off", &[]);
        return 0;
    }
    let budget = if options.mode == ServeMode::Foreground {
        FOREGROUND_LOCK_BUDGET
    } else {
        LOCK_BUDGET
    };
    let lock = match HelperLock::acquire(&paths.lock, budget) {
        Ok(Some(lock)) => lock,
        Ok(None) => {
            log.event("info", "already_running", &[]);
            return if options.mode == ServeMode::Foreground {
                ALREADY_RUNNING
            } else {
                0
            };
        }
        Err(error) => {
            log.event("error", "lock_failed", &[("message", &error.to_string())]);
            return 1;
        }
    };
    log.take_rotation();
    let identity = oleafly_sandbox::process::identity::current();
    let started_ms = now_ms();
    let state = Arc::new(StateWriter::new(
        paths.state.clone(),
        HelperState {
            version: STATE_VERSION,
            pid: identity.pid,
            started: identity.started,
            app_version: crate::version::APP_VERSION.to_string(),
            mode: options.mode,
            phase: Phase::Starting,
            started_at: started_ms,
            heartbeat_at: started_ms,
        },
    ));
    if let Err(error) = state.write() {
        log.event(
            "error",
            "state_unwritable",
            &[("message", &error.to_string())],
        );
    }
    let (stop_heartbeat, heartbeat_stopped) = std::sync::mpsc::channel::<()>();
    let heartbeat = {
        let state = state.clone();
        std::thread::Builder::new()
            .name("oleafly-helper-heartbeat".into())
            .spawn(move || {
                while let Err(RecvTimeoutError::Timeout) = heartbeat_stopped.recv_timeout(HEARTBEAT)
                {
                    let _ = state.beat();
                }
            })
    };
    log.event(
        "info",
        "started",
        &[
            ("mode", &format!("{:?}", options.mode)),
            ("pid", &identity.pid.to_string()),
        ],
    );
    let code = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => {
            let code = runtime.block_on(run(&options, &paths, prefs, &log, &state, started_ms));
            runtime.shutdown_timeout(Duration::from_secs(5));
            code
        }
        Err(error) => {
            log.event(
                "error",
                "runtime_failed",
                &[("message", &error.to_string())],
            );
            1
        }
    };
    drop(stop_heartbeat);
    if let Ok(heartbeat) = heartbeat {
        let _ = heartbeat.join();
    }
    let _ = state.set_phase(Phase::Exiting);
    drop(lock);
    state.remove();
    log.event("info", "exited", &[("code", &code.to_string())]);
    code
}

/// Resolves on SIGTERM, SIGINT or SIGHUP (Unix), Ctrl+C on a Windows console.
/// `agent run`, `ask` and `mcp` use it too: a process ended by a signal never
/// runs its destructors, so the commands it started would keep running.
pub(crate) fn termination() -> impl std::future::Future<Output = ()> {
    // The handlers are registered here, when the future is made, not when it
    // is first polled: a signal that arrives in between (a client that stops
    // the MCP server right after its first reply) would otherwise end the
    // process with the default action, before the work is wound down.
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let signals = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
            signal(SignalKind::hangup()),
        );
        async move {
            match signals {
                (Ok(mut terminate), Ok(mut interrupt), Ok(mut hangup)) => {
                    tokio::select! {
                        _ = terminate.recv() => {}
                        _ = interrupt.recv() => {}
                        _ = hangup.recv() => {}
                    }
                }
                _ => std::future::pending::<()>().await,
            }
        }
    }
    #[cfg(windows)]
    {
        use tokio::signal::windows::{ctrl_c, ctrl_close, ctrl_logoff, ctrl_shutdown};
        let signals = (ctrl_c(), ctrl_close(), ctrl_logoff(), ctrl_shutdown());
        async move {
            match signals {
                (Ok(mut interrupt), Ok(mut close), Ok(mut logoff), Ok(mut shutdown)) => {
                    tokio::select! {
                        _ = interrupt.recv() => {}
                        _ = close.recv() => {}
                        _ = logoff.recv() => {}
                        _ = shutdown.recv() => {}
                    }
                }
                _ => {
                    if tokio::signal::ctrl_c().await.is_err() {
                        std::future::pending::<()>().await;
                    }
                }
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        async {
            if tokio::signal::ctrl_c().await.is_err() {
                std::future::pending::<()>().await;
            }
        }
    }
}

/// The helper's own resources (bundled skills): those beside the binary it
/// runs as. An AppImage helper runs from a mount of its own, and the
/// quitting app's mount, which a grant names, is gone by then.
fn own_resources(executable: Option<PathBuf>) -> Option<PathBuf> {
    let executable = executable?;
    let bin_dir = executable.parent()?;
    crate::app_paths::resources_candidates(bin_dir, crate::app_paths::Platform::current())
        .into_iter()
        .find(|folder| folder.is_dir())
}

fn status_of(task: &ResearchTask) -> bool {
    task.status == ResearchTaskStatus::Running
}

async fn release(
    tasks: &ResearchTaskState,
    store: &TaskStore,
    to: OwnerKind,
    reason: HandoffReason,
    deadline: Duration,
    log: &HelperLog,
    in_flight: &std::collections::HashSet<String>,
) {
    tasks.stop_admitting();
    let running_ids = || -> Vec<String> {
        store
            .daemon_tasks()
            .unwrap_or_default()
            .iter()
            .filter(|task| status_of(task))
            .map(|task| task.id.clone())
            .collect()
    };
    let started = Instant::now();
    let mut running = running_ids();
    while running.iter().any(|id| in_flight.contains(id)) && started.elapsed() < deadline {
        tokio::time::sleep(IN_FLIGHT_POLL).await;
        running = running_ids();
    }
    let deadline = deadline
        .saturating_sub(started.elapsed())
        .max(IN_FLIGHT_POLL);
    let bound = deadline + oleafly_acp::limits::CANCEL_GRACE + RELEASE_MARGIN;
    let results = match tokio::time::timeout(
        bound,
        tasks.suspend(&running, SuspendMode::Prompt, Some(deadline)),
    )
    .await
    {
        Ok(results) => results,
        Err(_) => {
            log.event("error", "release_timed_out", &[]);
            Vec::new()
        }
    };
    for (id, result) in results {
        let Some((generation, mut record)) =
            handoff_record_for(&result, OwnerKind::Daemon, to, reason)
        else {
            continue;
        };
        if to == OwnerKind::Daemon {
            record.grant = grant_for(store, &id);
        }
        match tasks.hand_off_suspended(&id, generation, to, record).await {
            Ok(true) => log.event(
                "info",
                "handed_off",
                &[("task", &id), ("to", &format!("{to:?}"))],
            ),
            Ok(false) => log.event("info", "not_handed_off", &[("task", &id)]),
            Err(error) => log.event(
                "error",
                "hand_off_failed",
                &[("task", &id), ("message", &error)],
            ),
        }
    }
    if to == OwnerKind::App {
        for task in store
            .daemon_tasks()
            .unwrap_or_default()
            .into_iter()
            .filter(|task| task.status == ResearchTaskStatus::Queued)
        {
            let record = HandoffRecord::new(
                OwnerKind::Daemon,
                OwnerKind::App,
                reason,
                task.execution_generation,
            );
            if let Err(error) = store.hand_off_queued(&task.id, OwnerKind::App, &record) {
                log.event(
                    "error",
                    "hand_off_failed",
                    &[("task", &task.id), ("message", &error)],
                );
            }
        }
    }
    tasks.shutdown().await;
}

fn reap_orphans(acp_root: &Path) {
    use oleafly_sandbox::process::identity::{current, owner_is_live, probe, ProcessProbe};
    let me = current();
    let _ = oleafly_acp::orphans::PidRegistry::reap(
        acp_root,
        |owner| owner.identity.pid == me.pid || owner_is_live(Some(owner.identity), me, probe),
        |pid, started| match probe(pid) {
            ProcessProbe::Running { started: now } => {
                started.is_none() || now.is_none() || started == now
            }
            ProcessProbe::Gone => false,
        },
    );
}

struct Started {
    store: TaskStore,
    notifier: Arc<Notifier>,
    tasks: ResearchTaskState,
    research_host: Arc<DaemonResearchHost>,
}

async fn start_tasks(
    options: &ServeOptions,
    prefs: Prefs,
    log: &Arc<HelperLog>,
    state: &StateWriter,
) -> Option<Started> {
    let data_root = &options.data_root;
    let tasks_root = data_root.join("research-tasks");
    let store = match store(&tasks_root) {
        Ok(store) => store,
        Err(error) => {
            log.event("error", "store_unavailable", &[("message", &error)]);
            return None;
        }
    };
    let notifier = Arc::new(Notifier::new(
        prefs.notifications,
        options.localize.clone(),
        options.app_launch.clone(),
    ));
    let live = Arc::new(LiveSpend::default());
    let resources_dir = options
        .resources_dir
        .clone()
        .or_else(|| own_resources(std::env::current_exe().ok()));
    let tasks = ResearchTaskState::new(Ok(tasks_root.clone()), CONCURRENCY);
    let research_host = Arc::new(DaemonResearchHost::new(
        data_root,
        resources_dir.clone(),
        prefs,
        notifier.clone(),
        log.clone(),
        live.clone(),
    ));
    tasks.attach(research_host.clone(), tokio::runtime::Handle::current());
    let services = match tasks.services() {
        Ok(services) => services,
        Err(error) => {
            log.event("error", "services_unavailable", &[("message", &error)]);
            return None;
        }
    };
    let task_host = Arc::new(DaemonTaskHost::new(
        data_root,
        resources_dir,
        log.clone(),
        live,
    ));
    let builtin: Arc<dyn TaskHost> = task_host.clone();
    if let Err(error) = tasks.register_runtime(
        "builtin",
        Arc::new(BuiltinTaskAdapter::new(builtin, services.clone())),
    ) {
        log.event("error", "runtime_unavailable", &[("message", &error)]);
    }
    let acp_root = data_root.join("acp");
    match DaemonAcpAdapter::new(acp_root.clone(), task_host, services, default_launcher()) {
        Ok(adapter) => {
            let _ = tasks.register_runtime("acp", Arc::new(adapter));
        }
        Err(error) => log.event(
            "error",
            "acp_unavailable",
            &[("message", &error.to_string())],
        ),
    }
    reap_orphans(&acp_root);
    match store.requeue_interrupted_keep_running() {
        Ok(ids) if !ids.is_empty() => log.event(
            "info",
            "resumed_interrupted",
            &[("count", &ids.len().to_string())],
        ),
        Ok(_) => {}
        Err(error) => log.event("error", "resume_failed", &[("message", &error)]),
    }
    if let Err(error) = tasks.recover_runs(false).await {
        log.event("error", "recover_failed", &[("message", &error)]);
    }
    let _ = state.set_phase(Phase::Ready);
    log.event("info", "ready", &[]);
    Some(Started {
        store,
        notifier,
        tasks,
        research_host,
    })
}

async fn reload_prefs(data_root: &Path, research_host: &DaemonResearchHost) {
    let root = data_root.to_path_buf();
    if let Ok(Ok(prefs)) =
        tokio::task::spawn_blocking(move || desktop_config::load_prefs(&root)).await
    {
        research_host.set_prefs(prefs);
    }
}

fn forget_finished_requests(store: &TaskStore, in_flight: &mut std::collections::HashSet<String>) {
    if in_flight.is_empty() {
        return;
    }
    let running: std::collections::HashSet<String> = store
        .daemon_tasks()
        .unwrap_or_default()
        .into_iter()
        .filter(status_of)
        .map(|task| task.id)
        .collect();
    in_flight.retain(|id| running.contains(id));
}

fn announce_started(app_open: &Path, notifier: &Notifier) {
    if !super::control::app_is_open(app_open) {
        notifier.started();
    }
}

#[cfg(test)]
fn run_before_final_check_hook(data_root: &Path) {
    let hook = BEFORE_FINAL_CHECK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    match hook {
        Some((root, hook)) if root == data_root => hook(),
        Some(other) => {
            *BEFORE_FINAL_CHECK
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(other)
        }
        None => {}
    }
}

async fn run(
    options: &ServeOptions,
    paths: &HelperPaths,
    prefs: Prefs,
    log: &Arc<HelperLog>,
    state: &Arc<StateWriter>,
    started_ms: i64,
) -> i32 {
    let data_root = &options.data_root;
    let Some(Started {
        store,
        notifier,
        tasks,
        research_host,
    }) = start_tasks(options, prefs, log, state).await
    else {
        return 1;
    };

    let signal = termination();
    tokio::pin!(signal);
    let mut idle_since = Instant::now();
    let mut announced = false;
    let mut prefs_read = Instant::now();
    let mut in_flight = std::collections::HashSet::new();
    loop {
        if prefs_read.elapsed() >= PREFS_REFRESH {
            prefs_read = Instant::now();
            reload_prefs(data_root, &research_host).await;
        }
        tokio::select! {
            _ = tokio::time::sleep(TICK) => {}
            _ = &mut signal => {
                log.event("info", "signal", &[]);
                let _ = state.set_phase(Phase::Stopping);
                release(&tasks, &store, OwnerKind::Daemon, HandoffReason::Signal, SIGNAL_SUSPEND, log, &in_flight).await;
                return 0;
            }
        }
        if super::control::fresh_stop_request(&paths.stop_request, started_ms) {
            log.event("info", "stop_requested", &[]);
            let _ = state.set_phase(Phase::Stopping);
            release(
                &tasks,
                &store,
                OwnerKind::App,
                HandoffReason::Stop,
                STOP_SUSPEND,
                log,
                &in_flight,
            )
            .await;
            return 0;
        }
        if let Err(error) = tasks.launch_ready().await {
            log.event("error", "launch_failed", &[("message", &error)]);
        }
        let grant = |task: &ResearchTask| grant_for(&store, &task.id);
        match tasks.apply_foreign_requests(&grant).await {
            Ok(started) => in_flight.extend(started),
            Err(error) => log.event("error", "requests_failed", &[("message", &error)]),
        }
        forget_finished_requests(&store, &mut in_flight);
        let work = store.owned_work().unwrap_or_default();
        if options.mode == ServeMode::App && !announced && work.running > 0 {
            announced = true;
            announce_started(&paths.app_open, &notifier);
        }
        if work.running + work.queued > 0 || options.stay {
            idle_since = Instant::now();
            continue;
        }
        if idle_since.elapsed() < options.idle_grace {
            continue;
        }
        let _ = state.set_phase(Phase::Exiting);
        #[cfg(test)]
        run_before_final_check_hook(data_root);
        let last_look = store.owned_work().unwrap_or_default();
        if last_look.running + last_look.queued > 0 {
            let _ = state.set_phase(Phase::Ready);
            idle_since = Instant::now();
            continue;
        }
        log.event("info", "idle_exit", &[]);
        tasks.shutdown().await;
        return 0;
    }
}

#[cfg(test)]
mod tests;
