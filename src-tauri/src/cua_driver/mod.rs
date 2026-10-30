//! 0.4.8 I: Desktop apps through Cua Driver.
//!
//! Agents (the built-in assistant, CLI agents and attended research tasks)
//! get one small dispatcher tool, `desktop_apps`, that drives the apps and
//! websites the user allowed in Settings › Integrations › Desktop apps.
//!
//! Oleafly never bundles or installs Cua Driver. When the user turns the
//! connector on, Oleafly starts up to three `cua-driver serve` daemons of its
//! own, each in bounded mode with a capability manifest Oleafly writes:
//! one for desktop apps, one for websites in a separate browser profile and
//! one for websites in the user's signed-in browser. It talks to each over a
//! persistent `cua-driver mcp --socket` session. Observation runs right away;
//! every action asks through a native dialog first (see `gate`).
//!
//! Settings live in `AppConfig.cua_driver` and are written only by
//! `cua_driver_settings_set`, which asks natively before widening control.

pub(crate) mod agent;
pub(crate) mod apps;
pub(crate) mod bridge;
pub(crate) mod commands;
pub(crate) mod config;
pub(crate) mod detect;
pub(crate) mod dispatch;
pub(crate) mod gate;
pub(crate) mod icons;
pub(crate) mod manifest;
pub(crate) mod policy;
pub(crate) mod running;
pub(crate) mod runtime;
pub(crate) mod task;

#[cfg(test)]
mod runtime_tests;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

pub use config::CuaDriverConfig;

pub(crate) use agent::{agent_tool, RunScope, TurnEndGuard, SESSION_TAG};
pub(crate) use bridge::{acp_bridge, bind_acp_session, CuaBridge};
pub(crate) use dispatch::acp_turn_ended;

/// The one tool agents see.
pub(crate) const DESKTOP_APPS_TOOL: &str = "desktop_apps";

/// src-tauri has no async-trait; traits here return boxed futures like
/// `TaskBridge` does.
pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// How often idle runtimes are looked at.
const IDLE_SWEEP: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Platform {
    Macos,
    Windows,
    Linux,
}

impl Platform {
    pub(crate) fn current() -> Option<Self> {
        if cfg!(target_os = "macos") {
            Some(Self::Macos)
        } else if cfg!(windows) {
            Some(Self::Windows)
        } else if cfg!(target_os = "linux") {
            Some(Self::Linux)
        } else {
            None
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Macos => "macos",
            Self::Windows => "windows",
            Self::Linux => "linux",
        }
    }
}

/// One `cua-driver serve` daemon Oleafly runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RuntimeKind {
    /// Desktop apps the user allowed.
    Desktop,
    /// Allowed websites in a separate (isolated) browser profile.
    Browser,
    /// Websites the user marked, in their own signed-in browser profile.
    SignedInBrowser,
}

impl RuntimeKind {
    pub(crate) const ALL: [Self; 3] = [Self::Desktop, Self::Browser, Self::SignedInBrowser];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Browser => "browser",
            Self::SignedInBrowser => "signed-in-browser",
        }
    }
}

/// Where a call comes from; it picks the session option on the dialog and
/// how long the dialog may wait.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Surface {
    Chat,
    Acp,
    Task,
}

/// Who is calling: grants are kept per `grant_key` (a chat thread, an ACP
/// session, a task), Cua sessions per `session_key` (a turn).
#[derive(Clone, Debug)]
pub(crate) struct CuaScope {
    pub grant_key: String,
    pub session_key: String,
    pub project_id: Option<String>,
    pub agent_label: String,
    pub surface: Surface,
    /// The research task's title, for its dialogs.
    pub task_title: Option<String>,
}

/// Everything desktop apps keep while the app runs.
pub(crate) struct CuaDriverState {
    pub(crate) config: Arc<RwLock<CuaDriverConfig>>,
    pub(crate) runtimes: runtime::Runtimes,
    /// Session key → the Cua session label used for it.
    pub(crate) labels: Mutex<HashMap<String, String>>,
    /// ACP session id → the session key of its bridge.
    pub(crate) acp: Mutex<HashMap<String, String>>,
    pub(crate) grants: Mutex<gate::GrantStore>,
    /// What the driver said about apps, windows and elements, for dialogs.
    pub(crate) seen: Mutex<gate::Seen>,
    pub(crate) approver: Arc<dyn gate::Approver>,
    /// The data folder whose `approvals.toml` deny rules apply.
    pub(crate) data_root: Option<PathBuf>,
    /// One settings change at a time: it reads the settings, may wait on a
    /// native dialog, then writes them.
    pub(crate) apply: tokio::sync::Mutex<()>,
    /// Session key → a signal that flips when the turn that owns it ends.
    /// Calls waiting on a dialog stop waiting then.
    turns: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    /// Session keys of live subagents (see `TurnEndGuard`): the only keys a
    /// model's own `__cuaSession` may name.
    children: Mutex<HashSet<String>>,
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl CuaDriverState {
    pub(crate) fn new(
        config: CuaDriverConfig,
        launcher: Arc<dyn runtime::Launcher>,
        approver: Arc<dyn gate::Approver>,
        root: PathBuf,
        platform: Platform,
    ) -> Self {
        let config = Arc::new(RwLock::new(config));
        Self {
            runtimes: runtime::Runtimes::new(config.clone(), launcher, root.clone(), platform),
            config,
            labels: Mutex::new(HashMap::new()),
            acp: Mutex::new(HashMap::new()),
            grants: Mutex::new(gate::GrantStore::default()),
            seen: Mutex::new(gate::Seen::default()),
            approver,
            data_root: Some(root),
            apply: tokio::sync::Mutex::new(()),
            turns: Mutex::new(HashMap::new()),
            children: Mutex::new(HashSet::new()),
        }
    }

    /// Becomes `true` when the turn behind `session_key` ends.
    pub(crate) fn turn_signal(&self, session_key: &str) -> tokio::sync::watch::Receiver<bool> {
        lock(&self.turns)
            .entry(session_key.to_string())
            .or_insert_with(|| tokio::sync::watch::channel(false).0)
            .subscribe()
    }

    /// Ends the turn behind `session_key` for everything waiting on it.
    pub(crate) fn end_turn(&self, session_key: &str) {
        if let Some(signal) = lock(&self.turns).remove(session_key) {
            let _ = signal.send(true);
        }
    }

    pub(crate) fn register_child(&self, session_key: &str) {
        lock(&self.children).insert(session_key.to_string());
    }

    pub(crate) fn unregister_child(&self, session_key: &str) {
        lock(&self.children).remove(session_key);
    }

    pub(crate) fn is_child(&self, session_key: &str) -> bool {
        lock(&self.children).contains(session_key)
    }

    /// A copy of the current settings.
    pub(crate) fn settings(&self) -> CuaDriverConfig {
        self.config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn set_settings(&self, next: CuaDriverConfig) {
        *self
            .config
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = next;
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        config: CuaDriverConfig,
        launcher: Arc<dyn runtime::Launcher>,
        approver: Arc<dyn gate::Approver>,
        root: PathBuf,
    ) -> Self {
        // `root` is a temporary folder: its approvals.toml is the test's own.
        Self::new(
            config,
            launcher,
            approver,
            root,
            Platform::current().unwrap_or(Platform::Linux),
        )
    }
}

static GLOBAL: OnceLock<Arc<CuaDriverState>> = OnceLock::new();

/// The app's desktop apps state, once `attach` ran.
pub(crate) fn global() -> Option<Arc<CuaDriverState>> {
    GLOBAL.get().cloned()
}

/// Loads the settings, manages the state, cleans up daemons a crashed run
/// left behind and starts the idle reaper.
pub fn attach(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let stored = crate::config::read_config()
        .map(|config| config.cua_driver)
        .unwrap_or_default();
    let root = crate::paths::oleafly_root()?;
    let platform = Platform::current().ok_or("Computer Use isn't available on this system.")?;
    let own_exe = commands::own_exe();
    // What is on disk was not necessarily written by Settings: keep only
    // what a save would have accepted. The names are checked here; the
    // programs themselves in the background, because one on a share that
    // can't be reached would hold up the app's window.
    let (config, quick_dropped) =
        config::sanitize_loaded(stored, platform, &config::NameOnlyProbe, &own_exe);
    let state = Arc::new(CuaDriverState::new(
        config,
        Arc::new(runtime::ProcessLauncher::new(platform)),
        Arc::new(gate::NativeApprover::new(app.clone())),
        root.clone(),
        platform,
    ));
    app.manage(state.clone());
    let _ = GLOBAL.set(state.clone());
    let checking = state.clone();
    tauri::async_runtime::spawn(async move {
        let dropped = quick_dropped
            + resanitize(&checking, platform, Arc::new(config::SystemProbe), own_exe).await;
        if dropped > 0 {
            log(format!(
                "desktop apps: dropped {dropped} saved apps or websites that aren't allowed"
            ));
            let cleaned = checking.settings();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                crate::config::update_config(|config| {
                    config.cua_driver = cleaned;
                    Ok(())
                })
            })
            .await;
        }
    });
    tauri::async_runtime::spawn_blocking(move || {
        for kind in RuntimeKind::ALL {
            runtime::stop_stale_daemon(&runtime::runtime_paths(&root, kind, platform));
        }
    });
    let reaper = state;
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(IDLE_SWEEP).await;
            reaper.runtimes.stop_idle(Instant::now()).await;
        }
    });
    Ok(())
}

/// Checks the settings' programs on the file system (off the async
/// threads) and keeps only what a save would keep. Runs as one settings
/// change, so a save can't interleave; daemons whose manifest it changed
/// stop. Returns how many entries it dropped.
pub(crate) async fn resanitize(
    state: &Arc<CuaDriverState>,
    platform: Platform,
    probe: Arc<dyn config::ExecutableProbe>,
    own_exe: String,
) -> usize {
    let _applying = state.apply.lock().await;
    let current = state.settings();
    let checked = current.clone();
    let Ok((cleaned, dropped)) = tauri::async_runtime::spawn_blocking(move || {
        config::sanitize_loaded(checked, platform, probe.as_ref(), &own_exe)
    })
    .await
    else {
        return 0;
    };
    if cleaned != current {
        state.set_settings(cleaned);
        let stale = state.runtimes.stale_kinds();
        if !stale.is_empty() {
            state.runtimes.cancel(&stale);
            state.runtimes.stop_changed().await;
        }
    }
    dropped
}

/// Stops every daemon Oleafly started, within `budget`. Runs on quit.
pub(crate) fn shutdown_for_quit(budget: Duration) {
    let Some(state) = global() else {
        return;
    };
    tauri::async_runtime::block_on(async move { stop_everything(&state, budget).await });
}

/// Ends every daemon: calls waiting on a daemon are cancelled, the runtimes
/// stop within `budget`, and a daemon a call or a start still holds (or that
/// never got that far) is ended by its owner record.
pub(crate) async fn stop_everything(state: &CuaDriverState, budget: Duration) {
    let runtimes = &state.runtimes;
    if !runtimes.has_daemons() && !runtimes.has_owner_records() {
        return;
    }
    runtimes.cancel(&RuntimeKind::ALL);
    let _ = tokio::time::timeout(budget, runtimes.stop_within(&RuntimeKind::ALL, budget / 2)).await;
    if runtimes.has_daemons() || runtimes.has_owner_records() {
        runtimes.kill_by_records().await;
    }
}

/// Lines tests log instead of writing the developer's app.log.
#[cfg(test)]
pub(crate) static TEST_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Writes one line to app.log. Never pass arguments, typed text or tokens.
pub(crate) fn log(message: String) {
    #[cfg(test)]
    lock(&TEST_LOG).push(message);
    #[cfg(not(test))]
    {
        let _ = crate::project::append_app_log(message);
    }
}

/// Runs `future` on the current runtime when there is one (tests, agent
/// runs), else on the app's.
pub(crate) fn spawn_background(future: impl Future<Output = ()> + Send + 'static) {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(future);
        }
        Err(_) => {
            tauri::async_runtime::spawn(future);
        }
    }
}
