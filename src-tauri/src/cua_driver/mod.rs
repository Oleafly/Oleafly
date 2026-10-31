pub(crate) mod agent;
pub(crate) mod apps;
pub(crate) mod bridge;
pub(crate) mod browser;
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

pub(crate) const DESKTOP_APPS_TOOL: &str = "desktop_apps";

pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RuntimeKind {
    Desktop,
    Browser,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Surface {
    Chat,
    Acp,
    Task,
}

#[derive(Clone, Debug)]
pub(crate) struct CuaScope {
    pub grant_key: String,
    pub session_key: String,
    pub project_id: Option<String>,
    pub agent_label: String,
    pub surface: Surface,
    pub task_title: Option<String>,
}

pub(crate) struct CuaDriverState {
    pub(crate) config: Arc<RwLock<CuaDriverConfig>>,
    pub(crate) runtimes: runtime::Runtimes,
    pub(crate) labels: Mutex<HashMap<String, String>>,
    pub(crate) acp: Mutex<HashMap<String, String>>,
    pub(crate) grants: Mutex<gate::GrantStore>,
    pub(crate) seen: Mutex<gate::Seen>,
    pub(crate) approver: Arc<dyn gate::Approver>,
    pub(crate) data_root: Option<PathBuf>,
    pub(crate) apply: tokio::sync::Mutex<()>,
    turns: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
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

    pub(crate) fn turn_signal(&self, session_key: &str) -> tokio::sync::watch::Receiver<bool> {
        lock(&self.turns)
            .entry(session_key.to_string())
            .or_insert_with(|| tokio::sync::watch::channel(false).0)
            .subscribe()
    }

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

pub(crate) fn global() -> Option<Arc<CuaDriverState>> {
    GLOBAL.get().cloned()
}

pub fn attach(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let stored = crate::config::read_config()
        .map(|config| config.cua_driver)
        .unwrap_or_default();
    let root = crate::paths::oleafly_root()?;
    let platform = Platform::current().ok_or("Computer Use isn't available on this system.")?;
    let own_exe = commands::own_exe();
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

pub(crate) fn shutdown_for_quit(budget: Duration) {
    let Some(state) = global() else {
        return;
    };
    tauri::async_runtime::block_on(async move { stop_everything(&state, budget).await });
}

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

#[cfg(test)]
pub(crate) static TEST_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub(crate) fn log(message: String) {
    #[cfg(test)]
    lock(&TEST_LOG).push(message);
    #[cfg(not(test))]
    {
        let _ = crate::project::append_app_log(message);
    }
}

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
