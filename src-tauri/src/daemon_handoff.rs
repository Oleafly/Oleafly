//! 0.4.8 L: research tasks and the background helper, from the app's side.
//!
//! The helper is this executable started with `--oleafly-daemon`. When the
//! app quits, tasks marked "keep running when Oleafly is closed" stop at a
//! step boundary and move to it with a grant of what only the app knows;
//! on a restart, an update or with background tasks off they wait for the
//! next launch instead. When the app opens, it takes them back: at once
//! from a helper that is gone, at their next step from a live one. While
//! the helper still runs tasks, a watcher shows their progress, notifies
//! for them and imports their usage.
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use oleafly_cli::agent::usage_spool::{self, UsageSpoolEvent};
use oleafly_cli::daemon::client::{self, HelperStatus};
use oleafly_cli::daemon::control;
use oleafly_cli::daemon::lock::HelperLock;
use oleafly_cli::daemon::login_item::{self, LoginEnv, LoginExec, LoginItemState};
use oleafly_cli::daemon::{
    helper_paths, serve, AppLaunch, Localizer, Phase, ServeMode, ServeOptions,
};
use oleafly_research::handoff::{
    acp_home_path, AcpGrant, GrantedRoot, HandoffReason, HandoffRecord, TaskGrant, TRUST_AGENTS,
    TRUST_MCP, TRUST_RESEARCH_TASKS,
};
use oleafly_research::host::{Notification, NotificationKind, OwnerKind, ResearchHost};
use oleafly_research::model::{
    now_ms, ResearchTask, ResearchTaskStatus, ResearchTaskView, SuspendState,
};
use oleafly_research::scheduler::{
    handoff_record_for, ResearchTaskState, SuspendMode, SuspendResult,
};
use oleafly_research::store::TaskStore;
use serde::Serialize;
use tauri::{Emitter, Manager};

#[cfg(test)]
#[path = "daemon_handoff/tests.rs"]
mod tests;

pub(crate) const DAEMON_FLAG: &str = "--oleafly-daemon";
pub(crate) const AT_LOGIN_FLAG: &str = "--at-login";
/// How long running tasks get to reach a step boundary when the app quits.
pub(crate) const QUIT_SUSPEND_DEADLINE: Duration = Duration::from_secs(15);
/// How long the app waits for a helper it started to say it is ready.
pub(crate) const SPAWN_READY_WAIT: Duration = Duration::from_secs(3);
/// A heartbeat unchanged this long means the helper stopped answering.
pub(crate) const HUNG_OBSERVATION: Duration = Duration::from_secs(12);
/// How long the helper gives its running tasks to stop when told to end
/// (`STOP_SUSPEND` in `oleafly_cli::daemon::serve`).
const HELPER_STOP_SUSPEND: Duration = Duration::from_secs(30);
/// How long the helper gets to hand its tasks back and exit before it is
/// ended: its stop budget, then the grace a stopped agent gets, and a
/// margin for the handoffs and the transcript flush. Ending it sooner
/// leaves its tasks running with a dead owner.
const STOP_WAIT: Duration = Duration::from_secs(
    HELPER_STOP_SUSPEND.as_secs() + oleafly_acp::limits::CANCEL_GRACE.as_secs() + 20,
);
/// How long a helper that was ended takes to let go of its lock.
const AFTER_TERMINATE: Duration = Duration::from_secs(5);
/// The helper writes its heartbeat every 5 seconds; older than this is late.
const HEARTBEAT_LATE_MS: i64 = 11_000;
const WATCH_TICK: Duration = Duration::from_secs(1);
const WATCH_PAGE: usize = 200;
/// The watcher gives up after this many ticks in a row that fail.
const WATCH_MAX_FAILURES: u32 = 30;
const APP_IDLE_GRACE: Duration = Duration::from_secs(30);
const LOGIN_IDLE_GRACE: Duration = Duration::from_secs(5);
const BUNDLE_ID: &str = "com.oleafly.app";
/// The event the Settings card listens to.
pub(crate) const CHANGED_EVENT: &str = "background-helper-changed";
/// The ACP request kinds a grant records the project's rules for.
const PERMISSION_KINDS: [&str; 10] = [
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
];

/// The process is the helper: `--oleafly-daemon` is its first argument
/// (the app and the sign-in entry always start it that way).
pub(crate) fn daemon_requested(args: impl IntoIterator<Item = OsString>) -> bool {
    args.into_iter()
        .nth(1)
        .is_some_and(|argument| argument == DAEMON_FLAG)
}

fn at_login_requested(args: impl IntoIterator<Item = OsString>) -> bool {
    args.into_iter()
        .skip(2)
        .any(|argument| argument == AT_LOGIN_FLAG)
}

/// The AppImage the app runs from (Linux).
fn appimage() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::env::var_os("APPIMAGE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

/// What a notification click starts.
fn app_launch(appimage: Option<&Path>) -> Option<AppLaunch> {
    if cfg!(target_os = "macos") {
        return Some(AppLaunch::MacBundle(BUNDLE_ID));
    }
    match appimage {
        Some(image) => Some(AppLaunch::AppImage(image.to_path_buf())),
        None => std::env::current_exe().ok().map(AppLaunch::Program),
    }
}

/// Runs the helper in this process (the app binary started with
/// `--oleafly-daemon`), before Tauri starts. Returns the exit code.
pub(crate) fn serve_daemon() -> i32 {
    let Ok(data_root) = crate::paths::oleafly_root() else {
        return 1;
    };
    crate::i18n::startup();
    let at_login = at_login_requested(std::env::args_os());
    let image = appimage();
    let localize: Localizer =
        Arc::new(|key: &str, params: &[(&str, &str)]| crate::i18n::t_with(key, params));
    serve(ServeOptions {
        mode: if at_login {
            ServeMode::AtLogin
        } else {
            ServeMode::App
        },
        data_root,
        exe: image
            .clone()
            .or_else(|| std::env::current_exe().ok())
            .unwrap_or_default(),
        // Each task's grant names the bundled skills of the app that
        // handed it over.
        resources_dir: None,
        app_launch: app_launch(image.as_deref()),
        localize: Some(localize),
        stay: false,
        log_to_stderr: false,
        idle_grace: if at_login {
            LOGIN_IDLE_GRACE
        } else {
            APP_IDLE_GRACE
        },
    })
}

/// Why the app is exiting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExitMode {
    Quit,
    Restart,
    Update,
}

/// An install, or the restart after one, is an update (no helper starts);
/// a restart waits for the relaunch; anything else is a quit.
pub(crate) fn exit_mode(updating: bool, installing: bool, restart_pending: bool) -> ExitMode {
    if updating || installing {
        ExitMode::Update
    } else if restart_pending {
        ExitMode::Restart
    } else {
        ExitMode::Quit
    }
}

/// Where the tasks went at exit. A task the helper could not take (its
/// grant failed) is in `failed` and waits for the next launch.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct HandoffSummary {
    pub to_helper: Vec<String>,
    pub to_next_launch: Vec<String>,
    pub spawned: bool,
    pub failed: Vec<String>,
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct ReclaimSummary {
    pub adopted: Vec<String>,
    pub requested: usize,
    pub helper_hung: bool,
}

/// What the app checked for a task it hands to the helper.
#[async_trait::async_trait]
pub(crate) trait GrantSource: Send + Sync {
    async fn grant(
        &self,
        task: &ResearchTask,
        suspended: Option<&SuspendState>,
    ) -> Result<TaskGrant, String>;
}

/// The helper as the app sees it. Every call blocks briefly.
pub(crate) trait HelperControl: Send + Sync {
    fn status(&self) -> HelperStatus;
    /// Starts the helper unless one runs; `true` when this call started it.
    fn ensure_running(&self) -> Result<bool, String>;
    fn request_stop(&self) -> Result<(), String>;
    fn wait_stopped(&self, timeout: Duration) -> bool;
    /// Ends a helper whose heartbeat stopped; `true` when it did.
    fn terminate_if_hung(&self, observe: Duration) -> bool;
    /// Ends the helper whatever it is doing; `true` when it did.
    fn terminate(&self) -> bool;
}

/// The real helper, through its files in the data folder.
pub(crate) struct AppHelper {
    data_root: PathBuf,
    /// Who a stop request names in the helper's log.
    requester: &'static str,
}

impl AppHelper {
    pub(crate) fn new(data_root: PathBuf) -> Self {
        Self {
            data_root,
            requester: "app",
        }
    }

    fn for_update(data_root: PathBuf) -> Self {
        Self {
            data_root,
            requester: "update",
        }
    }

    fn not_running(&self) -> HelperStatus {
        HelperStatus {
            running: false,
            pid: None,
            app_version: None,
            phase: None,
            mode: None,
            started_at: None,
            heartbeat_at: None,
            log_path: helper_paths(&self.data_root).log,
            tasks: Vec::new(),
        }
    }
}

/// Whether a helper has to be started for tasks the app is handing over:
/// none runs, or the one that runs is on its way out. An exiting helper
/// has taken its last look at the work, and a stopping one (a stop request,
/// background tasks turned off, a sign-out) has already listed the tasks it
/// hands back, so neither would see them. A held lock with no state file is
/// a helper that removed its state on the way out (or has not written it
/// yet): a new one starts too, and at worst waits out the old one's lock.
/// The new helper waits for the old one's lock.
fn needs_new_helper(status: &HelperStatus) -> bool {
    !status.running || matches!(status.phase, None | Some(Phase::Exiting | Phase::Stopping))
}

/// The running helper was started by another version of Oleafly (the app
/// was replaced while it ran). An unknown version counts as the same.
fn helper_is_stale(status: &HelperStatus) -> bool {
    status.running
        && status
            .app_version
            .as_deref()
            .is_some_and(|version| version != oleafly_cli::version::APP_VERSION)
}

/// The helper wrote its heartbeat recently.
fn heartbeat_is_fresh(status: &HelperStatus, now: i64) -> bool {
    status
        .heartbeat_at
        .is_some_and(|beat| now.saturating_sub(beat) < HEARTBEAT_LATE_MS)
}

impl HelperControl for AppHelper {
    fn status(&self) -> HelperStatus {
        client::status(&self.data_root).unwrap_or_else(|_| self.not_running())
    }

    fn ensure_running(&self) -> Result<bool, String> {
        // The helper looks for programs where the app does: its own PATH is
        // minimal, and the app's list comes from the login shell (macOS and
        // Linux) or the registry (Windows). A helper that already runs
        // reads the fresh list for its next task.
        let _ = oleafly_cli::daemon::search_dirs::write(
            &helper_paths(&self.data_root).search_dirs,
            &crate::program_locator::search_dirs(),
        );
        let status = self.status();
        if !needs_new_helper(&status) {
            return Ok(false);
        }
        let exe = std::env::current_exe()
            .map_err(|error| format!("The background helper could not start: {error}"))?;
        let spec = client::spawn_spec(
            oleafly_cli::app_paths::Platform::current(),
            &exe,
            appimage().as_deref(),
            &self.data_root,
        );
        let pid = client::spawn(&spec)
            .map_err(|error| format!("The background helper could not start: {error}"))?;
        if client::wait_ready(&self.data_root, pid, SPAWN_READY_WAIT) {
            Ok(true)
        } else {
            // It may still be waiting for an exiting helper's lock.
            Err("The background helper did not say it was ready in time.".into())
        }
    }

    fn request_stop(&self) -> Result<(), String> {
        client::request_stop(&self.data_root, self.requester).map_err(|error| error.to_string())
    }

    fn wait_stopped(&self, timeout: Duration) -> bool {
        client::wait_stopped(&self.data_root, timeout).unwrap_or(false)
    }

    fn terminate_if_hung(&self, observe: Duration) -> bool {
        let status = self.status();
        if !status.running || heartbeat_is_fresh(&status, now_ms()) {
            return false;
        }
        if !client::is_hung(&self.data_root, observe).unwrap_or(false) {
            return false;
        }
        self.terminate()
    }

    fn terminate(&self) -> bool {
        let ended = client::terminate(&self.data_root).unwrap_or(false);
        if ended {
            let _ = client::wait_stopped(&self.data_root, AFTER_TERMINATE);
        }
        ended
    }
}

/// The CLI agent's home for a task: the one its session moved to when it
/// was handed off, else a new one beside the task's workspaces.
pub(crate) fn grant_home(
    tasks_root: &Path,
    task: &ResearchTask,
    suspended: Option<&SuspendState>,
) -> PathBuf {
    suspended
        .and_then(|state| state.acp.as_ref())
        .map(|acp| acp.home.clone())
        .unwrap_or_else(|| acp_home_path(tasks_root, &task.id, task.execution_generation))
}

/// The grants the app writes: trust, where the project is, its linked
/// folders, the model's metadata, the spend so far, the skills, and a CLI
/// agent's sandboxed launch. Never a key: the helper reads keys from the
/// encrypted store itself.
pub(crate) struct AppGrants<R: tauri::Runtime> {
    pub(crate) app: tauri::AppHandle<R>,
}

/// What the app knows about a task's project (blocking: files and the
/// library database). Returns the grant without its CLI-agent part, and
/// the data folder.
fn app_facts(task: &ResearchTask) -> Result<(TaskGrant, PathBuf), String> {
    crate::trust::require_trusted(&task.project_id, crate::trust::Capability::ResearchTasks)?;
    let location = crate::project_location::locate(&task.project_id)?;
    let data_root = crate::paths::oleafly_root()?;
    let linked_roots = crate::research_workspace::get_research_workspace(task.project_id.clone())
        .map(|workspace| {
            workspace
                .roots
                .into_iter()
                .map(|root| GrantedRoot {
                    role: serde_json::to_value(root.role)
                        .ok()
                        .and_then(|role| role.as_str().map(str::to_owned))
                        .unwrap_or_default(),
                    id: root.id,
                    label: root.label,
                    canonical_path: root.canonical_path,
                })
                .collect()
        })
        .unwrap_or_default();
    let model_metadata = crate::ai_model_metadata::snapshot()
        .lookup(&task.agent_id, &task.model_id)
        .and_then(|entry| serde_json::to_value(entry).ok());
    let pack = crate::skills_pack::cached_pack_root();
    let disabled_skills =
        crate::skills::list_with(&data_root, pack.as_deref(), Some(&task.project_id))
            .map(|records| {
                records
                    .into_iter()
                    .filter(|record| record.is_valid() && !record.is_available())
                    .map(|record| record.id)
                    .collect()
            })
            .unwrap_or_default();
    let grant = TaskGrant {
        project_root: location.root.to_string_lossy().into_owned(),
        linked: location.kind == crate::project_location::ProjectKind::Linked,
        // Trust is the project's: one check covers the three codes.
        capabilities: vec![
            TRUST_RESEARCH_TASKS.into(),
            TRUST_AGENTS.into(),
            TRUST_MCP.into(),
        ],
        linked_roots,
        model_metadata,
        spent_usd: crate::library_db::task_usage_cost(&data_root, &task.id)
            .ok()
            .flatten(),
        skills_pack_root: pack.map(|path| path.to_string_lossy().into_owned()),
        disabled_skills,
        acp: None,
    };
    Ok((grant, data_root))
}

impl<R: tauri::Runtime> AppGrants<R> {
    async fn acp_grant(
        &self,
        task: &ResearchTask,
        suspended: Option<&SuspendState>,
        data_root: &Path,
        project_root: &Path,
    ) -> Result<AcpGrant, String> {
        let runtime = self
            .app
            .try_state::<Arc<crate::acp::AcpRuntime>>()
            .ok_or("The CLI agent runtime is unavailable.")?
            .inner()
            .clone();
        let home = grant_home(&data_root.join("research-tasks"), task, suspended);
        // The workspace of the generation that ran. A task that never
        // started gets its own when the helper starts it; the helper then
        // rebuilds the sandbox for that folder.
        let (root, allowed) = match &task.isolation {
            Some(isolation) if Path::new(&isolation.execution_root).is_dir() => (
                PathBuf::from(&isolation.execution_root),
                isolation.allowed_paths.clone(),
            ),
            _ => (project_root.to_path_buf(), Vec::new()),
        };
        // A queued task may wait for the helper a long time: its home gets
        // the sign-in files only when the helper starts it.
        let launch = if task.status == ResearchTaskStatus::Queued {
            runtime
                .task_launch_without_sign_in(
                    &task.agent_id,
                    &task.project_id,
                    &task.id,
                    &root,
                    &allowed,
                    &home,
                )
                .await?
        } else {
            runtime
                .task_launch(
                    &task.agent_id,
                    &task.project_id,
                    &task.id,
                    &root,
                    &allowed,
                    &home,
                )
                .await?
        };
        Ok(AcpGrant {
            agent_id: task.agent_id.clone(),
            launch,
            refused_kinds: PERMISSION_KINDS
                .into_iter()
                .filter(|kind| {
                    crate::approvals::task_request_refused(
                        Some(data_root),
                        &task.project_id,
                        Some(*kind),
                    )
                })
                .map(str::to_owned)
                .collect(),
            refuse_unlisted: crate::approvals::task_request_refused(
                Some(data_root),
                &task.project_id,
                None,
            ),
        })
    }
}

#[async_trait::async_trait]
impl<R: tauri::Runtime> GrantSource for AppGrants<R> {
    async fn grant(
        &self,
        task: &ResearchTask,
        suspended: Option<&SuspendState>,
    ) -> Result<TaskGrant, String> {
        let owned = task.clone();
        let (mut grant, data_root) =
            tauri::async_runtime::spawn_blocking(move || app_facts(&owned))
                .await
                .map_err(|error| format!("The task's grant could not be prepared: {error}"))??;
        if task.runtime_id == "acp" {
            let project_root = PathBuf::from(&grant.project_root);
            grant.acp = Some(
                self.acp_grant(task, suspended, &data_root, &project_root)
                    .await?,
            );
        }
        Ok(grant)
    }
}

fn log(message: String) {
    let _ = crate::project::append_app_log(message);
}

/// Hands over the tasks that were running and have stopped at a step
/// boundary. A task whose grant fails stays with the app.
async fn hand_off_suspended(
    tasks: &ResearchTaskState,
    candidates: &[ResearchTask],
    results: Vec<(String, SuspendResult)>,
    to: OwnerKind,
    reason: HandoffReason,
    grants: &dyn GrantSource,
    summary: &mut HandoffSummary,
) {
    for (id, result) in results {
        let Some(task) = candidates.iter().find(|task| task.id == id) else {
            continue;
        };
        let mut target = to;
        let mut grant = None;
        if to == OwnerKind::Daemon {
            let state = match &result {
                SuspendResult::Suspended { state, .. } => Some(state),
                _ => None,
            };
            match grants.grant(task, state).await {
                Ok(value) => grant = Some(value),
                Err(error) => {
                    // It continues at the next launch instead.
                    log(format!(
                        "Background helper: task {id} stays with Oleafly: {error}"
                    ));
                    summary.failed.push(id.clone());
                    target = OwnerKind::App;
                }
            }
        }
        let Some((generation, mut record)) =
            handoff_record_for(&result, OwnerKind::App, target, reason)
        else {
            continue;
        };
        record.grant = grant;
        match tasks
            .hand_off_suspended(&id, generation, target, record)
            .await
        {
            Ok(true) if target == OwnerKind::Daemon => summary.to_helper.push(id),
            Ok(true) => summary.to_next_launch.push(id),
            _ => {
                if !summary.failed.contains(&id) {
                    summary.failed.push(id);
                }
            }
        }
    }
}

/// Hands the queued tasks to the helper. A task whose grant fails stays
/// with the app.
async fn hand_off_queued(
    store: &TaskStore,
    candidates: &[ResearchTask],
    reason: HandoffReason,
    grants: &dyn GrantSource,
    summary: &mut HandoffSummary,
) {
    for task in candidates
        .iter()
        .filter(|task| task.status == ResearchTaskStatus::Queued)
    {
        let grant = match grants.grant(task, None).await {
            Ok(grant) => grant,
            Err(error) => {
                log(format!(
                    "Background helper: task {} stays with Oleafly: {error}",
                    task.id
                ));
                summary.failed.push(task.id.clone());
                continue;
            }
        };
        let mut record = HandoffRecord::new(
            OwnerKind::App,
            OwnerKind::Daemon,
            reason,
            task.execution_generation,
        );
        record.grant = Some(grant);
        match store.hand_off_queued(&task.id, OwnerKind::Daemon, &record) {
            Ok(true) => summary.to_helper.push(task.id.clone()),
            _ => summary.failed.push(task.id.clone()),
        }
    }
}

/// Moves the tasks marked to keep running: to the helper on a quit with
/// background tasks on, else to the next launch. Running ones stop at a
/// step boundary first (at most [`QUIT_SUSPEND_DEADLINE`]).
pub(crate) async fn hand_off(
    tasks: &ResearchTaskState,
    mode: ExitMode,
    background_enabled: bool,
    grants: &dyn GrantSource,
    helper: &dyn HelperControl,
) -> HandoffSummary {
    let mut summary = HandoffSummary::default();
    tasks.stop_admitting();
    let Ok(store) = tasks.store() else {
        return summary;
    };
    // The helper keeps what the app had asked back and never got.
    let _ = store.cancel_reclaim_requests();
    let candidates = store.handoff_candidates().unwrap_or_default();
    if candidates.is_empty() {
        return summary;
    }
    let to = if mode == ExitMode::Quit && background_enabled {
        OwnerKind::Daemon
    } else {
        OwnerKind::App
    };
    let reason = match (mode, to) {
        (ExitMode::Quit, OwnerKind::Daemon) => HandoffReason::Quit,
        (ExitMode::Quit, OwnerKind::App) => HandoffReason::BackgroundOff,
        (ExitMode::Restart, _) => HandoffReason::Restart,
        (ExitMode::Update, _) => HandoffReason::Update,
    };
    let running: Vec<String> = candidates
        .iter()
        .filter(|task| task.status == ResearchTaskStatus::Running)
        .map(|task| task.id.clone())
        .collect();
    let results = if running.is_empty() {
        Vec::new()
    } else {
        tasks
            .suspend(&running, SuspendMode::Prompt, Some(QUIT_SUSPEND_DEADLINE))
            .await
    };
    hand_off_suspended(
        tasks,
        &candidates,
        results,
        to,
        reason,
        grants,
        &mut summary,
    )
    .await;
    if to == OwnerKind::Daemon {
        hand_off_queued(&store, &candidates, reason, grants, &mut summary).await;
    }
    if !summary.to_helper.is_empty() {
        match helper.ensure_running() {
            Ok(started) => summary.spawned = started,
            // The tasks wait for the next launch, or a helper at sign-in.
            Err(error) => log(format!("Background helper: {error}")),
        }
    }
    summary
}

/// [`hand_off`] with the app's grants and helper, at exit.
pub(crate) async fn hand_off_on_exit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mode: ExitMode,
) -> HandoffSummary {
    let Ok(data_root) = crate::paths::oleafly_root() else {
        return HandoffSummary::default();
    };
    // From here the helper tells the user about its tasks itself.
    control::mark_app_closed(&helper_paths(&data_root).app_open);
    let Some(tasks) = app
        .try_state::<ResearchTaskState>()
        .map(|state| state.inner().clone())
    else {
        return HandoffSummary::default();
    };
    let (background_enabled, has_work) = {
        let tasks = tasks.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let enabled = crate::config::read_config()
                .map(|config| config.research_background_enabled)
                .unwrap_or(true);
            let has_work = tasks
                .store()
                .and_then(|store| store.handoff_candidates())
                .is_ok_and(|candidates| !candidates.is_empty());
            (enabled, has_work)
        })
        .await
        .unwrap_or((true, true))
    };
    if mode == ExitMode::Quit && has_work {
        // The window goes at once; the tasks reach their next step behind it.
        for window in app.webview_windows().values() {
            let _ = window.hide();
        }
    }
    let grants = AppGrants { app: app.clone() };
    let helper = AppHelper::new(data_root);
    let summary = hand_off(&tasks, mode, background_enabled, &grants, &helper).await;
    if !(summary.to_helper.is_empty()
        && summary.to_next_launch.is_empty()
        && summary.failed.is_empty())
    {
        log(format!(
            "Research tasks at exit: {} to the background helper ({}), {} for the next launch, {} kept here.",
            summary.to_helper.len(),
            if summary.spawned { "started" } else { "already running or not started" },
            summary.to_next_launch.len(),
            summary.failed.len(),
        ));
    }
    summary
}

/// Takes the helper's tasks back when the app opens: at once from a helper
/// that is gone or hung, at their next step from a live one. Blocking: a
/// helper whose heartbeat is late is watched for [`HUNG_OBSERVATION`].
pub(crate) fn reclaim(tasks: &ResearchTaskState, helper: &dyn HelperControl) -> ReclaimSummary {
    let mut summary = ReclaimSummary::default();
    let Ok(store) = tasks.store() else {
        return summary;
    };
    let status = helper.status();
    let running = status.running;
    if running && helper.terminate_if_hung(HUNG_OBSERVATION) {
        summary.helper_hung = true;
    }
    if running && !summary.helper_hung {
        if helper_is_stale(&status) {
            // A helper of an older version may not read this version's
            // hand-off: it hands every task back and exits, and a fresh one
            // starts the next time tasks go to the background.
            let _ = helper.request_stop();
        }
        summary.requested = store.request_reclaim().unwrap_or(0);
    } else {
        summary.adopted = store.adopt_orphaned_daemon_tasks().unwrap_or_default();
    }
    summary
}

/// Records the spool's usage events in the app's usage ledger through
/// `insert` (which returns whether the event was new). An event `insert`
/// fails for is skipped and tried again at the next import. Returns how
/// many were new.
pub(crate) fn import_usage_spool(
    data_root: &Path,
    insert: &mut dyn FnMut(&UsageSpoolEvent) -> Result<bool, String>,
) -> Result<usize, String> {
    let events = usage_spool::read_all(data_root).map_err(|error| error.to_string())?;
    let mut inserted = 0;
    for event in &events {
        if let Ok(true) = insert(event) {
            inserted += 1;
        }
    }
    // Only events older than the import window go.
    let _ = usage_spool::compact(data_root, now_ms() - usage_spool::KEEP_FOR_MS);
    Ok(inserted)
}

/// A spool event as a usage ledger row. Its id keeps it unique: the
/// ledger records each id once.
pub(crate) fn ledger_event(event: &UsageSpoolEvent) -> crate::usage_report::UsageEventInput {
    let tokens = |value: Option<u32>| value.map(i64::from);
    let measured = event.input_tokens.is_some() || event.output_tokens.is_some();
    let cost = event
        .cost_usd
        .filter(|cost| cost.is_finite() && *cost >= 0.0);
    crate::usage_report::UsageEventInput {
        event_id: event.id.clone(),
        source_id: format!(
            "{}:{}",
            event.source,
            event.task_id.as_deref().unwrap_or("run")
        ),
        source_turn_id: event.id.clone(),
        project_id: event
            .project_id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| "global".into()),
        task_id: event.task_id.clone().filter(|id| !id.trim().is_empty()),
        session_id: event.task_id.clone().unwrap_or_else(|| event.id.clone()),
        parent_session_id: None,
        parent_record_key: None,
        runtime_id: "builtin".into(),
        provider_id: Some(event.provider.clone()).filter(|id| !id.trim().is_empty()),
        model_id: Some(event.model.clone()).filter(|id| !id.trim().is_empty()),
        occurred_at_ms: event.at.max(0),
        observation_sequence: Some(0),
        input_tokens: tokens(event.input_tokens),
        output_tokens: tokens(event.output_tokens),
        cache_read_tokens: tokens(event.cache_read_tokens),
        cache_write_tokens: tokens(event.cache_write_tokens),
        input_semantics: "unknown".into(),
        counter_semantics: "delta".into(),
        measurement: if measured {
            "provider_reported"
        } else {
            "unavailable"
        }
        .into(),
        billing_mode: if cost.is_some() { "api" } else { "unknown" }.into(),
        estimated_cost_usd: cost,
        price_version: cost.map(|_| "spool".into()),
        duration_ms: None,
        status: match event.status.as_str() {
            "completed" | "failed" | "cancelled" | "interrupted" => event.status.clone(),
            _ => "completed".into(),
        },
        aggregation_scope: "self".into(),
    }
}

/// What the last import saw: the spool's size and time (an unchanged spool
/// is not read again) and the events already in the ledger.
struct SpoolCursor {
    root: PathBuf,
    file: Option<SpoolSignature>,
    imported: HashSet<String>,
}

static SPOOL_CURSOR: Mutex<Option<SpoolCursor>> = Mutex::new(None);

fn spool_signature(data_root: &Path) -> Option<SpoolSignature> {
    std::fs::metadata(usage_spool::spool_path(data_root))
        .ok()
        .map(|metadata| (metadata.len(), metadata.modified().ok()))
}

/// Imports the spool into the ledger of `data_root` (blocking).
pub(crate) fn import_spool_into_ledger(data_root: &Path) -> Result<usize, String> {
    let Some(file) = spool_signature(data_root) else {
        return Ok(0);
    };
    let mut slot = SPOOL_CURSOR.lock().unwrap_or_else(PoisonError::into_inner);
    let mut cursor = slot
        .take()
        .filter(|cursor| cursor.root == data_root)
        .unwrap_or_else(|| SpoolCursor {
            root: data_root.to_path_buf(),
            file: None,
            imported: HashSet::new(),
        });
    if cursor.file == Some(file) {
        *slot = Some(cursor);
        return Ok(0);
    }
    let connection = match crate::library_db::open(data_root) {
        Ok(connection) => connection,
        Err(error) => {
            *slot = Some(cursor);
            return Err(error);
        }
    };
    let mut retry = false;
    let imported = &mut cursor.imported;
    let result = import_usage_spool(data_root, &mut |event| {
        if imported.contains(&event.id) {
            return Ok(false);
        }
        let input = ledger_event(event);
        if crate::usage_report::validate_usage_event(&input).is_err() {
            // Never valid: not tried again.
            imported.insert(event.id.clone());
            return Ok(false);
        }
        match crate::usage_report::record_usage_observation_with(&connection, &input) {
            Ok(recorded) => {
                imported.insert(event.id.clone());
                Ok(recorded.inserted)
            }
            Err(error) => {
                retry = true;
                Err(error)
            }
        }
    });
    // The signature taken before the import counts as seen. Compaction may
    // have rewritten the file, and the helper may have appended an event
    // after the read: the file's new signature is kept only when every
    // event in it was imported.
    let after = spool_signature(data_root);
    let keep = signature_to_keep(file, after, retry, || {
        spool_fully_imported(data_root, &cursor.imported)
    });
    cursor.file = keep;
    *slot = Some(cursor);
    result
}

type SpoolSignature = (u64, Option<SystemTime>);

/// What the cursor remembers of the spool after an import. `before` was
/// read before the import's own read of the events, so an event appended
/// since is not covered by it; `after` is the signature now (compaction
/// rewrote the file, or the helper appended). A failed insert reads the
/// spool again.
fn signature_to_keep(
    before: SpoolSignature,
    after: Option<SpoolSignature>,
    retry: bool,
    fully_imported: impl FnOnce() -> bool,
) -> Option<SpoolSignature> {
    if retry {
        return None;
    }
    if after == Some(before) {
        return Some(before);
    }
    if fully_imported() {
        after
    } else {
        None
    }
}

/// Every event now in the spool has been imported (or can never be).
fn spool_fully_imported(data_root: &Path, imported: &HashSet<String>) -> bool {
    usage_spool::read_all(data_root)
        .is_ok_and(|events| events.iter().all(|event| imported.contains(&event.id)))
}

/// At launch, off the startup path: marks the app open, imports the
/// helper's usage, takes its tasks back, resumes keep-running tasks a
/// crash interrupted, and watches the helper while it still runs tasks.
pub(crate) fn on_launch(app: &tauri::AppHandle, host: Arc<dyn ResearchHost>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(data_root) = crate::paths::oleafly_root() else {
            return;
        };
        let Some(tasks) = app
            .try_state::<ResearchTaskState>()
            .map(|state| state.inner().clone())
        else {
            return;
        };
        let launched = {
            let tasks = tasks.clone();
            let root = data_root.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = control::mark_app_open(&helper_paths(&root).app_open);
                let _ = import_spool_into_ledger(&root);
                let summary = reclaim(&tasks, &AppHelper::new(root));
                let store = tasks.store().ok();
                if let Some(store) = &store {
                    let _ = store.requeue_interrupted_keep_running();
                    for id in &summary.adopted {
                        if let Ok(task) = store.require(id) {
                            tasks.emit_task(&task);
                        }
                    }
                }
                let watch = summary.requested > 0
                    || store.is_some_and(|store| store.has_daemon_work().unwrap_or(false));
                (summary, watch)
            })
            .await
        };
        let Ok((summary, watch)) = launched else {
            return;
        };
        if summary.helper_hung {
            log("The background helper stopped answering, so Oleafly ended it and took its tasks back.".into());
        }
        // The tasks that came back start once recovery has found no apply
        // left half done (it runs beside this and starts them itself when it
        // ends later).
        let starting = tasks.clone();
        tauri::async_runtime::spawn(async move {
            if crate::research_tasks::recovered_cleanly().await {
                let _ = starting.launch_ready().await;
            }
        });
        let _ = app.emit(CHANGED_EVENT, ());
        if watch {
            start_watcher(app, tasks, host, data_root);
        }
    });
}

/// What the watcher remembers between ticks.
#[derive(Default)]
pub(crate) struct WatchState {
    /// Changes after this time (epoch ms) are new.
    cursor: i64,
    /// The helper's tasks (and tasks the app asked back) as last seen.
    known: HashMap<String, ResearchTask>,
    /// The last transcript row forwarded, per task generation.
    transcript: HashMap<(String, u64), u64>,
}

impl WatchState {
    /// Starts from the helper's tasks as they are now.
    pub(crate) fn seeded(store: &TaskStore, since: i64) -> Self {
        Self {
            cursor: since,
            known: store
                .daemon_tasks()
                .unwrap_or_default()
                .into_iter()
                .map(|task| (task.id.clone(), task))
                .collect(),
            transcript: HashMap::new(),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct TickReport {
    /// A task came back from the helper; start it here.
    pub came_back: bool,
    /// The helper still owns work, or the app still waits for some.
    pub has_work: bool,
}

/// The notification a change the helper made deserves, if any (the kinds
/// the app's own scheduler sends).
pub(crate) fn transition_notice(
    before: &ResearchTask,
    now: &ResearchTask,
) -> Option<NotificationKind> {
    if before.status == now.status {
        return (now.pending_approvals > before.pending_approvals)
            .then_some(NotificationKind::ApprovalNeeded);
    }
    match now.status {
        ResearchTaskStatus::AwaitingReview if now.stop_reason.is_some() => {
            Some(NotificationKind::BudgetReached)
        }
        ResearchTaskStatus::AwaitingReview => Some(NotificationKind::ReviewReady),
        ResearchTaskStatus::PlanReady => Some(NotificationKind::PlanReady),
        ResearchTaskStatus::Failed => Some(NotificationKind::Failed),
        _ => None,
    }
}

/// Forwards the next page of a generation's transcript to the windows
/// watching it, the last row forwarded again (streamed text grows in place).
fn forward_transcript(
    state: &mut WatchState,
    tasks: &ResearchTaskState,
    host: &dyn ResearchHost,
    task_id: &str,
    generation: u64,
) {
    let key = (task_id.to_owned(), generation);
    let after = state
        .transcript
        .get(&key)
        .map(|last| last.saturating_sub(1));
    let Ok(page) = tasks.events(task_id, generation, after, WATCH_PAGE) else {
        return;
    };
    for event in &page.events {
        host.transcript_appended(event);
    }
    if let Some(last) = page.events.last() {
        state.transcript.insert(key, last.sequence);
    }
}

/// One watcher tick (blocking: task storage): sends the helper's task
/// changes and transcript rows to the windows and notifies for what its
/// tasks need. The app's own work reports itself and is skipped.
pub(crate) fn watch_tick(
    state: &mut WatchState,
    tasks: &ResearchTaskState,
    host: &dyn ResearchHost,
) -> Result<TickReport, String> {
    let store = tasks.store()?;
    let mut report = TickReport::default();
    let mut paged = HashSet::new();
    for task in store.changed_since(state.cursor, WATCH_PAGE)? {
        state.cursor = state.cursor.max(task.updated_at);
        let helper_side = task.owner == OwnerKind::Daemon || task.reclaim_requested;
        let before = state.known.remove(&task.id);
        if before.is_none() && !helper_side {
            continue;
        }
        tasks.emit_task(&task);
        let generation = before.as_ref().map_or(task.execution_generation, |before| {
            before.execution_generation
        });
        if let Some(before) = &before {
            if before.owner == OwnerKind::Daemon
                && task.owner == OwnerKind::App
                && task.status == ResearchTaskStatus::Queued
            {
                report.came_back = true;
            }
            if let Some(kind) = transition_notice(before, &task) {
                host.notify(Notification {
                    kind,
                    task_id: task.id.clone(),
                    project_id: task.project_id.clone(),
                    task_title: task.title.clone(),
                });
            }
        }
        // The rows the helper wrote up to this change.
        forward_transcript(state, tasks, host, &task.id, generation);
        paged.insert(task.id.clone());
        if helper_side {
            state.known.insert(task.id.clone(), task);
        }
    }
    // Rows of running helper tasks whose own row did not change.
    let running: Vec<(String, u64)> = state
        .known
        .values()
        .filter(|task| task.status == ResearchTaskStatus::Running && !paged.contains(&task.id))
        .map(|task| (task.id.clone(), task.execution_generation))
        .collect();
    for (id, generation) in running {
        forward_transcript(state, tasks, host, &id, generation);
    }
    report.has_work = store.has_daemon_work()?;
    Ok(report)
}

/// Takes back the helper's tasks once its lock is free (blocking): a
/// helper that died while the app was open (killed, crashed) never handed
/// them back, so they would stay "running" with a dead owner. Not while the
/// app quits, when the tasks it just queued for a helper that is still
/// starting stay with that helper. Returns the ids adopted.
pub(crate) fn adopt_if_helper_gone(tasks: &ResearchTaskState, lock: &Path) -> Vec<String> {
    if !tasks.admitting() || !matches!(HelperLock::is_held_elsewhere(lock), Ok(false)) {
        return Vec::new();
    }
    let Ok(store) = tasks.store() else {
        return Vec::new();
    };
    let adopted = store.adopt_orphaned_daemon_tasks().unwrap_or_default();
    for id in &adopted {
        if let Ok(task) = store.require(id) {
            tasks.emit_task(&task);
        }
    }
    adopted
}

static WATCHING: AtomicBool = AtomicBool::new(false);

/// Watches the helper's tasks while there are any (one watcher at a time):
/// a tick a second, the usage spool imported, tasks that came back
/// started, and `background-helper-changed` when the helper starts or stops.
fn start_watcher(
    app: tauri::AppHandle,
    tasks: ResearchTaskState,
    host: Arc<dyn ResearchHost>,
    data_root: PathBuf,
) {
    if WATCHING.swap(true, Ordering::AcqRel) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut state = {
            let tasks = tasks.clone();
            tauri::async_runtime::spawn_blocking(move || {
                tasks
                    .store()
                    .map(|store| WatchState::seeded(&store, now_ms() - 1_000))
                    .unwrap_or_default()
            })
            .await
            .unwrap_or_default()
        };
        let mut helper_running = None;
        let mut failures = 0;
        loop {
            tokio::time::sleep(WATCH_TICK).await;
            let tick = {
                let tasks = tasks.clone();
                let host = host.clone();
                let root = data_root.clone();
                let mut moved = std::mem::take(&mut state);
                tauri::async_runtime::spawn_blocking(move || {
                    let report = watch_tick(&mut moved, &tasks, host.as_ref());
                    let _ = import_spool_into_ledger(&root);
                    let lock = helper_paths(&root).lock;
                    let running = HelperLock::is_held_elsewhere(&lock).unwrap_or(false);
                    let adopted = adopt_if_helper_gone(&tasks, &lock);
                    (moved, report, running, adopted)
                })
                .await
            };
            let Ok((returned, report, running, adopted)) = tick else {
                break;
            };
            state = returned;
            if helper_running != Some(running) {
                helper_running = Some(running);
                let _ = app.emit(CHANGED_EVENT, ());
            }
            if !adopted.is_empty() {
                log(format!(
                    "The background helper stopped without handing back {} task(s); they run here now.",
                    adopted.len()
                ));
                let _ = tasks.launch_ready().await;
            }
            match report {
                Ok(report) => {
                    failures = 0;
                    if report.came_back {
                        let _ = tasks.launch_ready().await;
                    }
                    if !report.has_work {
                        break;
                    }
                }
                Err(error) => {
                    failures += 1;
                    if failures >= WATCH_MAX_FAILURES {
                        log(format!("Background helper watcher stopped: {error}"));
                        break;
                    }
                }
            }
        }
        WATCHING.store(false, Ordering::Release);
        let _ = tasks.launch_ready().await;
        let _ = app.emit(CHANGED_EVENT, ());
    });
}

/// Asks the helper to stop and waits; ends it if it stays.
pub(crate) fn stop_helper(helper: &dyn HelperControl, wait: Duration) -> bool {
    if !helper.status().running {
        return true;
    }
    if helper.request_stop().is_ok() && helper.wait_stopped(wait) {
        return true;
    }
    helper.terminate() || helper.wait_stopped(AFTER_TERMINATE)
}

/// Before an update installs: the helper hands its tasks back and exits,
/// so it never runs an older binary beside the new app (and on Windows
/// never holds the files the installer replaces).
pub(crate) async fn stop_for_update<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {
    let Ok(data_root) = crate::paths::oleafly_root() else {
        return;
    };
    let _ = tauri::async_runtime::spawn_blocking(move || {
        stop_helper(&AppHelper::for_update(data_root), STOP_WAIT)
    })
    .await;
}

/// Turns background tasks on or off. Off also removes the sign-in entry
/// and asks a running helper to give its tasks back.
pub(crate) fn set_background_enabled(
    enabled: bool,
    login: Option<&LoginEnv>,
    exec: &LoginExec,
    helper: &dyn HelperControl,
) -> Result<(), String> {
    crate::config::update_config(|config| {
        config.research_background_enabled = enabled;
        if !enabled {
            config.research_background_at_login = false;
        }
        Ok(())
    })?;
    if !enabled {
        if let Some(env) = login {
            login_item::set(env, exec, false)?;
        }
        if helper.status().running {
            helper.request_stop()?;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundHelperStatus {
    pub enabled: bool,
    pub at_login: LoginItemState,
    pub running: bool,
    pub hung: bool,
    pub phase: Option<Phase>,
    pub task_count: usize,
    pub log_path: String,
}

fn login_exec() -> LoginExec {
    let exe = std::env::current_exe().unwrap_or_default();
    login_item::login_exec(&exe, appimage().as_deref())
}

fn current_status(data_root: &Path) -> BackgroundHelperStatus {
    let enabled = crate::config::read_config()
        .map(|config| config.research_background_enabled)
        .unwrap_or(true);
    let at_login = match LoginEnv::current() {
        Some(env) => login_item::status(&env, &login_exec()),
        None => LoginItemState::Unsupported {
            reason: "Oleafly can't find your home folder.".into(),
        },
    };
    let helper = AppHelper::new(data_root.to_path_buf()).status();
    BackgroundHelperStatus {
        enabled,
        at_login,
        running: helper.running,
        hung: helper.running && helper.phase.is_some() && !heartbeat_is_fresh(&helper, now_ms()),
        phase: helper.phase,
        task_count: helper.tasks.len(),
        log_path: helper.log_path.to_string_lossy().into_owned(),
    }
}

async fn status_off_thread() -> Result<BackgroundHelperStatus, String> {
    let data_root = crate::paths::oleafly_root()?;
    tauri::async_runtime::spawn_blocking(move || current_status(&data_root))
        .await
        .map_err(|error| format!("background helper worker failed: {error}"))
}

#[tauri::command]
pub async fn background_helper_status() -> Result<BackgroundHelperStatus, String> {
    status_off_thread().await
}

#[tauri::command]
pub async fn background_helper_stop(
    app: tauri::AppHandle,
) -> Result<BackgroundHelperStatus, String> {
    let data_root = crate::paths::oleafly_root()?;
    let stopped = tauri::async_runtime::spawn_blocking(move || {
        stop_helper(&AppHelper::new(data_root), STOP_WAIT)
    })
    .await
    .map_err(|error| format!("background helper worker failed: {error}"))?;
    if !stopped {
        return Err("The helper did not stop. Try again.".into());
    }
    // Its tasks came back: they run here now.
    if let Some(tasks) = app.try_state::<ResearchTaskState>() {
        let tasks = tasks.inner().clone();
        let adopted = {
            let tasks = tasks.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let Ok(store) = tasks.store() else {
                    return;
                };
                for id in store.adopt_orphaned_daemon_tasks().unwrap_or_default() {
                    if let Ok(task) = store.require(&id) {
                        tasks.emit_task(&task);
                    }
                }
            })
            .await
        };
        if adopted.is_ok() {
            let _ = tasks.launch_ready().await;
        }
    }
    let _ = app.emit(CHANGED_EVENT, ());
    status_off_thread().await
}

#[tauri::command]
pub async fn background_helper_set_login_item(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<BackgroundHelperStatus, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if enabled && !crate::config::read_config()?.research_background_enabled {
            return Err("Turn on background tasks first.".into());
        }
        let env = LoginEnv::current().ok_or("Oleafly can't find your home folder.")?;
        let state = login_item::set(&env, &login_exec(), enabled)?;
        crate::config::update_config(|config| {
            config.research_background_at_login = state == LoginItemState::Enabled;
            Ok(())
        })
    })
    .await
    .map_err(|error| format!("background helper worker failed: {error}"))??;
    let _ = app.emit(CHANGED_EVENT, ());
    status_off_thread().await
}

#[tauri::command]
pub async fn background_tasks_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let data_root = crate::paths::oleafly_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        set_background_enabled(
            enabled,
            LoginEnv::current().as_ref(),
            &login_exec(),
            &AppHelper::new(data_root),
        )
    })
    .await
    .map_err(|error| format!("background helper worker failed: {error}"))??;
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub async fn background_helper_reveal_log() -> Result<(), String> {
    let paths = helper_paths(&crate::paths::oleafly_root()?);
    let target = if paths.log.is_file() {
        paths.log
    } else {
        paths.dir
    };
    let canonical = target
        .canonicalize()
        .map_err(|_| "The background helper has no log yet.".to_string())?;
    crate::commands::reveal_canonical_path(&canonical)
}

#[tauri::command]
pub async fn research_task_set_keep_running(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    keep: bool,
) -> Result<ResearchTaskView, String> {
    let tasks = state.inner().clone();
    let task = tauri::async_runtime::spawn_blocking(move || {
        tasks.store()?.set_keep_running(&task_id, keep)
    })
    .await
    .map_err(|error| format!("task storage worker failed: {error}"))??;
    state.emit_task(&task);
    Ok(ResearchTaskView::from(&task))
}
