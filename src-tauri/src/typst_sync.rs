mod protocol;
mod session;
mod ws;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::ffi::OsString;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

use oleafly_core::typst_toolchain::ToolchainVersion;
use serde::Deserialize;
use tauri::{AppHandle, RunEvent, Runtime};
use tokio::sync::OwnedMutexGuard;

use crate::project::ProjectMeta;
use crate::synctex::{SynctexHit, SynctexRect};
use protocol::DocumentPoint;
use session::{KillSwitch, PortPicker, ServerSpec, Session, SessionKey, Timeouts};

const MAX_SOURCE_FILES: usize = 4096;
const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_DISK_SOURCE_BYTES: u64 = 16 * 1024 * 1024;
const OPERATION_ATTEMPTS: usize = 2;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone)]
pub(crate) struct Config {
    timeouts: Timeouts,
    ports: PortPicker,
    idle: Duration,
    max_sessions: usize,
    max_starts: usize,
    start_window: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            timeouts: Timeouts::default(),
            ports: Arc::new(session::reserve_ports),
            idle: Duration::from_secs(10 * 60),
            max_sessions: 3,
            max_starts: 3,
            start_window: Duration::from_secs(120),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    project_id: String,
    root: PathBuf,
    roots: Vec<PathBuf>,
    main: PathBuf,
    tinymist: String,
    environment: Vec<(String, OsString)>,
}

impl Target {
    fn key(&self) -> SessionKey {
        SessionKey {
            root: self.root.clone(),
            main: self.main.clone(),
            tinymist: self.tinymist.clone(),
        }
    }
}

#[derive(Default)]
pub(crate) struct SlotState {
    session: Option<Session>,
    starts: VecDeque<Instant>,
}

struct Slot {
    touched: Mutex<Instant>,
    state: Arc<tokio::sync::Mutex<SlotState>>,
}

impl Slot {
    fn touch(&self) {
        *lock(&self.touched) = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        lock(&self.touched).elapsed()
    }
}

pub(crate) struct Registry {
    config: Config,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    kills: Arc<Mutex<Vec<Weak<KillSwitch>>>>,
    serial: AtomicU64,
}

static REGISTRY: LazyLock<Registry> = LazyLock::new(|| Registry::new(Config::default()));

fn remember_kill_switch(kills: &Mutex<Vec<Weak<KillSwitch>>>, switch: Arc<KillSwitch>) {
    let mut kills = lock(kills);
    kills.retain(|weak| weak.strong_count() > 0);
    kills.push(Arc::downgrade(&switch));
}

async fn stop_slot(slot: Arc<Slot>, timeout: Duration) {
    let session = slot.state.lock().await.session.take();
    if let Some(session) = session {
        session.stop(timeout).await;
    }
}

async fn watch_idle(slot: Weak<Slot>, serial: u64, idle: Duration, stop_timeout: Duration) {
    let interval = (idle / 4).max(Duration::from_millis(10));
    loop {
        tokio::time::sleep(interval).await;
        let Some(slot) = slot.upgrade() else {
            return;
        };
        if slot.idle_for() < idle {
            continue;
        }
        let mut state = slot.state.lock().await;
        if state.session.as_ref().map(|session| session.serial) != Some(serial) {
            return;
        }
        if slot.idle_for() < idle {
            continue;
        }
        if let Some(session) = state.session.take() {
            session.stop(stop_timeout).await;
        }
        return;
    }
}

impl Registry {
    pub(crate) fn new(config: Config) -> Self {
        Self {
            config,
            slots: Mutex::new(HashMap::new()),
            kills: Arc::new(Mutex::new(Vec::new())),
            serial: AtomicU64::new(1),
        }
    }

    fn slot(&self, project_id: &str) -> Arc<Slot> {
        let mut slots = lock(&self.slots);
        let slot = slots
            .entry(project_id.to_owned())
            .or_insert_with(|| {
                Arc::new(Slot {
                    touched: Mutex::new(Instant::now()),
                    state: Arc::new(tokio::sync::Mutex::new(SlotState::default())),
                })
            })
            .clone();
        slot.touch();
        while slots.len() > self.config.max_sessions {
            let Some(oldest) = slots
                .iter()
                .filter(|(id, _)| id.as_str() != project_id)
                .max_by_key(|(_, slot)| slot.idle_for())
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            if let Some(evicted) = slots.remove(&oldest) {
                tokio::spawn(stop_slot(evicted, self.config.timeouts.stop));
            }
        }
        slot
    }

    async fn acquire<F, Fut>(
        &self,
        target: &Target,
        resolve: F,
    ) -> Result<OwnedMutexGuard<SlotState>, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<PathBuf, String>>,
    {
        let slot = self.slot(&target.project_id);
        let mut state = slot.state.clone().lock_owned().await;
        let key = target.key();
        let stale = state
            .session
            .as_mut()
            .is_some_and(|session| session.key != key || !session.healthy());
        if stale {
            if let Some(session) = state.session.take() {
                session.stop(self.config.timeouts.stop).await;
            }
        }
        if state.session.is_none() {
            let now = Instant::now();
            let window = self.config.start_window;
            state
                .starts
                .retain(|started| now.duration_since(*started) < window);
            if state.starts.len() >= self.config.max_starts {
                return Err("the Typst preview server keeps stopping".into());
            }
            state.starts.push_back(now);
            let spec = ServerSpec {
                program: resolve().await?,
                root: target.root.clone(),
                main: target.main.clone(),
                environment: target.environment.clone(),
            };
            let serial = self.serial.fetch_add(1, Ordering::Relaxed);
            let kills = self.kills.clone();
            let session = Session::start(
                &spec,
                key,
                serial,
                &*self.config.ports,
                &self.config.timeouts,
                &move |switch| remember_kill_switch(&kills, switch),
            )
            .await?;
            state.session = Some(session);
            tokio::spawn(watch_idle(
                Arc::downgrade(&slot),
                serial,
                self.config.idle,
                self.config.timeouts.stop,
            ));
        }
        slot.touch();
        Ok(state)
    }

    async fn run<F, Fut, T, Op, OpFut>(
        &self,
        target: &Target,
        resolve: F,
        operation: Op,
    ) -> Result<T, String>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Result<PathBuf, String>>,
        Op: Fn(OwnedMutexGuard<SlotState>) -> OpFut,
        OpFut: Future<Output = (OwnedMutexGuard<SlotState>, Result<T, String>)>,
    {
        let mut last_error = String::new();
        for _ in 0..OPERATION_ATTEMPTS {
            let state = self.acquire(target, &resolve).await?;
            let (mut state, outcome) = operation(state).await;
            match outcome {
                Ok(value) => return Ok(value),
                Err(error) => {
                    last_error = error;
                    if let Some(session) = state.session.take() {
                        session.stop(self.config.timeouts.stop).await;
                    }
                }
            }
        }
        Err(last_error)
    }

    pub(crate) async fn stop_project(&self, project_id: &str) {
        let slot = lock(&self.slots).remove(project_id);
        if let Some(slot) = slot {
            stop_slot(slot, self.config.timeouts.stop).await;
        }
    }

    pub(crate) async fn stop_all(&self) {
        let slots: Vec<Arc<Slot>> = lock(&self.slots).drain().map(|(_, slot)| slot).collect();
        for slot in slots {
            stop_slot(slot, self.config.timeouts.stop).await;
        }
    }

    pub(crate) fn kill_all_now(&self) {
        let switches: Vec<Arc<KillSwitch>> = lock(&self.kills)
            .drain(..)
            .filter_map(|weak| weak.upgrade())
            .collect();
        for switch in switches {
            switch.kill_now();
        }
        lock(&self.slots).clear();
    }

    #[cfg(test)]
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    async fn running_pid(&self, project_id: &str) -> Option<u32> {
        let slot = lock(&self.slots).get(project_id).cloned()?;
        let state = slot.state.lock().await;
        state.session.as_ref().map(Session::pid)
    }
}

fn matched_tinymist(meta: &ProjectMeta) -> Option<String> {
    let typst = crate::typst_toolchain::tinymist::project_typst_version(meta);
    let version = crate::typst_toolchain::tinymist::tinymist_version_for(&typst.to_string())?;
    let parsed = ToolchainVersion::parse(&version)?;
    protocol::tinymist_supports_sync(&parsed).then_some(version)
}

pub(crate) fn supported_for_project(meta: &ProjectMeta) -> bool {
    crate::typst_toolchain::is_typst_project(meta) && matched_tinymist(meta).is_some()
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("the project folder is unavailable: {error}"))?;
    Ok(crate::project_availability::without_verbatim_prefix(
        &canonical,
    ))
}

fn resolve_target(project_id: &str, main_doc: &str) -> Result<Option<Target>, String> {
    crate::paths::validate_project_id(project_id)?;
    let meta = crate::project::read_meta(project_id)?;
    if !crate::typst_toolchain::is_typst_project(&meta) {
        return Ok(None);
    }
    let Some(tinymist) = matched_tinymist(&meta) else {
        return Ok(None);
    };
    let relative_main = protocol::validate_relative(main_doc)
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
        })
        .ok_or_else(|| "the main document is not a Typst file in the project".to_string())?;
    let original = crate::project_location::locate(project_id)?.root;
    let root = canonical_root(&original)?;
    let main = root.join(relative_main);
    if !main.is_file() {
        return Ok(None);
    }
    let mut roots = vec![root.clone()];
    if original != root {
        roots.push(original);
    }
    let environment = crate::typst_packages::language_server_environment(project_id)
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect();
    Ok(Some(Target {
        project_id: project_id.to_owned(),
        root,
        roots,
        main,
        tinymist,
        environment,
    }))
}

async fn target_off_thread(project_id: String, main_doc: String) -> Result<Option<Target>, String> {
    tokio::task::spawn_blocking(move || resolve_target(&project_id, &main_doc))
        .await
        .map_err(|error| error.to_string())?
}

fn memory_files(
    root: &Path,
    sources: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    if sources.len() > MAX_SOURCE_FILES {
        return Err("too many source files to sync".into());
    }
    let total: usize = sources.values().map(String::len).sum();
    if total > MAX_SOURCE_BYTES {
        return Err("the project sources are too large to sync".into());
    }
    let mut files = BTreeMap::new();
    for (path, text) in sources {
        let relative = protocol::validate_relative(path)
            .ok_or_else(|| "a source path is outside the project".to_string())?;
        let Some(absolute) = root.join(relative).to_str().map(str::to_owned) else {
            continue;
        };
        files.insert(absolute, text.clone());
    }
    Ok(files)
}

fn read_disk_source(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_DISK_SOURCE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

async fn source_text(
    target: &Target,
    sources: &BTreeMap<String, String>,
    relative: &str,
) -> Option<String> {
    if let Some(text) = sources.get(relative) {
        return Some(text.clone());
    }
    let path = target.root.join(protocol::validate_relative(relative)?);
    tokio::task::spawn_blocking(move || read_disk_source(&path))
        .await
        .ok()
        .flatten()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstSyncForwardRequest {
    project_id: String,
    main_doc: String,
    file: String,
    line: u32,
    column: Option<u32>,
    #[serde(default)]
    sources: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstSyncInverseRequest {
    project_id: String,
    main_doc: String,
    page: u32,
    x: f64,
    y: f64,
    #[serde(default)]
    sources: BTreeMap<String, String>,
}

async fn forward_with<F, Fut>(
    registry: &Registry,
    target: &Target,
    request: &TypstSyncForwardRequest,
    resolve: F,
) -> Result<Option<SynctexRect>, String>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<PathBuf, String>>,
{
    let Some(relative) = protocol::validate_relative(&request.file) else {
        return Ok(None);
    };
    let Some(line) = request.line.checked_sub(1) else {
        return Ok(None);
    };
    let Some(text) = source_text(target, &request.sources, &request.file).await else {
        return Ok(None);
    };
    let candidates = protocol::forward_candidates(
        &text,
        line as usize,
        request.column.map(|column| column as usize),
    );
    if candidates.is_empty() {
        return Ok(None);
    }
    let Some(filepath) = target.root.join(relative).to_str().map(str::to_owned) else {
        return Ok(None);
    };
    let files = memory_files(&target.root, &request.sources)?;
    let timeouts = registry.config.timeouts;
    let point = registry
        .run(target, resolve, |mut state| {
            let files = &files;
            let filepath = &filepath;
            let candidates = &candidates;
            async move {
                let outcome = match state.session.as_mut() {
                    Some(session) => match session.push_sources(files, timeouts.compile).await {
                        Ok(()) => session.forward(filepath, candidates, &timeouts).await,
                        Err(error) => Err(error),
                    },
                    None => Ok(None),
                };
                (state, outcome)
            }
        })
        .await?;
    Ok(point.map(protocol::rect_for_jump))
}

async fn inverse_with<F, Fut>(
    registry: &Registry,
    target: &Target,
    request: &TypstSyncInverseRequest,
    resolve: F,
) -> Result<Option<SynctexHit>, String>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<PathBuf, String>>,
{
    if request.page == 0 || !request.x.is_finite() || !request.y.is_finite() {
        return Ok(None);
    }
    let probes = protocol::inverse_probes(DocumentPoint {
        page: request.page,
        x: request.x,
        y: request.y,
    });
    let files = memory_files(&target.root, &request.sources)?;
    let timeouts = registry.config.timeouts;
    let source = registry
        .run(target, resolve, |mut state| {
            let files = &files;
            let probes = &probes;
            async move {
                let outcome = match state.session.as_mut() {
                    Some(session) => match session.push_sources(files, timeouts.compile).await {
                        Ok(()) => session.inverse(probes, &timeouts).await,
                        Err(error) => Err(error),
                    },
                    None => Ok(None),
                };
                (state, outcome)
            }
        })
        .await?;
    let Some(source) = source else {
        return Ok(None);
    };
    let Some(file) = protocol::relative_source(Path::new(&source.filepath), &target.roots) else {
        return Ok(None);
    };
    let column = source_text(target, &request.sources, &file)
        .await
        .and_then(|text| {
            protocol::source_lines(&text)
                .get(source.line as usize)
                .map(|line| protocol::char_to_utf16_column(line, source.character as usize))
        })
        .unwrap_or(0);
    Ok(Some(SynctexHit {
        file,
        line: i32::try_from(source.line)
            .unwrap_or(i32::MAX)
            .saturating_add(1),
        column: i32::try_from(column).unwrap_or(0),
    }))
}

fn tinymist_resolver(
    app: AppHandle,
    project_id: String,
) -> impl Fn() -> std::pin::Pin<Box<dyn Future<Output = Result<PathBuf, String>> + Send>> {
    move || {
        let app = app.clone();
        let project_id = project_id.clone();
        Box::pin(async move {
            crate::language_service::tinymist_executable(&app, &project_id)
                .await
                .map_err(|error| error.message)
        })
    }
}

#[tauri::command]
pub async fn typst_sync_forward(
    app: AppHandle,
    request: TypstSyncForwardRequest,
) -> Result<Option<SynctexRect>, String> {
    let Some(target) =
        target_off_thread(request.project_id.clone(), request.main_doc.clone()).await?
    else {
        return Ok(None);
    };
    let resolve = tinymist_resolver(app, request.project_id.clone());
    forward_with(&REGISTRY, &target, &request, resolve).await
}

#[tauri::command]
pub async fn typst_sync_inverse(
    app: AppHandle,
    request: TypstSyncInverseRequest,
) -> Result<Option<SynctexHit>, String> {
    let Some(target) =
        target_off_thread(request.project_id.clone(), request.main_doc.clone()).await?
    else {
        return Ok(None);
    };
    let resolve = tinymist_resolver(app, request.project_id.clone());
    inverse_with(&REGISTRY, &target, &request, resolve).await
}

#[tauri::command]
pub async fn typst_sync_stop(project_id: Option<String>) -> Result<(), String> {
    match project_id {
        Some(project_id) => REGISTRY.stop_project(&project_id).await,
        None => REGISTRY.stop_all().await,
    }
    Ok(())
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("typst-sync-lifecycle")
        .on_event(|_app, event| {
            if let RunEvent::Exit = event {
                REGISTRY.kill_all_now();
            }
        })
        .build()
}
