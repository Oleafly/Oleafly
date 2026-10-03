#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_core::typst_toolchain::ToolchainVersion;
use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, Runtime};
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot, watch};

use crate::document_engine::{CompileError, CompileTarget, DocumentEngineId, EngineExecutable};
use crate::proc::{contain_process_tree, isolate_process_tree, NoConsole, ProcessTreeGuard};

pub(crate) const RESULT_EVENT: &str = "typst-watch:result";
pub(crate) const STATUS_EVENT: &str = "typst-watch:status";
const MAX_CYCLE_LOG_BYTES: usize = 256 * 1024;
const MAX_STRAY_BYTES: usize = 16 * 1024;
const MAX_LINE_BYTES: usize = 64 * 1024;
const LOG_TRUNCATED: &str = "\n[Oleafly: live preview output truncated]\n";
const SERVE_FLAGS_SINCE: &str = "0.14.0";
const STAGING_DIR: &str = "typst-watch";
const CHUNK_CAPACITY: usize = 64;

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;
type DiagnosedLog = (String, Vec<oleafly_core::LogDiagnostic>, Vec<CompileError>);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CycleOutcome {
    Success,
    Warnings,
    Errors,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ParsedEvent {
    Started,
    Finished {
        outcome: CycleOutcome,
        duration_ms: Option<u64>,
        log: String,
    },
}

struct PendingCycle {
    outcome: CycleOutcome,
    duration_ms: Option<u64>,
    log: String,
}

#[derive(Default)]
pub(crate) struct WatchParser {
    partial: String,
    pending: Option<PendingCycle>,
    stray: String,
}

fn strip_escape_codes(line: &str) -> String {
    let mut clean = String::with_capacity(line.len());
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            clean.push(character);
            continue;
        }
        if characters.peek() == Some(&'[') {
            characters.next();
            for code in characters.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    clean
}

fn append_bounded(target: &mut String, text: &str, limit: usize) {
    if target.ends_with(LOG_TRUNCATED) {
        return;
    }
    if target.len() + text.len() <= limit {
        target.push_str(text);
        return;
    }
    let room = limit.saturating_sub(target.len());
    let boundary = (0..=room.min(text.len()))
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0);
    target.push_str(&text[..boundary]);
    target.push_str(LOG_TRUNCATED);
}

pub(crate) fn parse_duration_ms(text: &str) -> Option<u64> {
    let text = text.trim();
    let split = text
        .find(|character: char| !(character.is_ascii_digit() || character == '.'))
        .unwrap_or(text.len());
    let value: f64 = text[..split].parse().ok()?;
    let factor = match text[split..].trim() {
        "s" => 1000.0,
        "ms" => 1.0,
        "µs" | "μs" | "us" => 0.001,
        "ns" => 0.000_001,
        _ => return None,
    };
    Some((value * factor).round() as u64)
}

fn status_text(line: &str) -> Option<&str> {
    match line.strip_prefix('[').and_then(|rest| rest.split_once(']')) {
        Some((_, after)) => Some(after.trim()),
        None => Some(line.trim()).filter(|text| text.starts_with("compil")),
    }
}

impl WatchParser {
    pub(crate) fn push(&mut self, text: &str) -> Vec<ParsedEvent> {
        let mut events = Vec::new();
        self.partial.push_str(text);
        while let Some(newline) = self.partial.find('\n') {
            let line: String = self.partial.drain(..=newline).collect();
            self.line(line.trim_end_matches(['\n', '\r']), &mut events);
        }
        if self.partial.len() > MAX_LINE_BYTES {
            let line = std::mem::take(&mut self.partial);
            self.line(&line, &mut events);
        }
        events
    }

    pub(crate) fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    pub(crate) fn flush(&mut self) -> Option<ParsedEvent> {
        let mut events = Vec::new();
        if !self.partial.is_empty() {
            let line = std::mem::take(&mut self.partial);
            self.line(line.trim_end_matches('\r'), &mut events);
        }
        self.finish(&mut events);
        events
            .into_iter()
            .rev()
            .find(|event| matches!(event, ParsedEvent::Finished { .. }))
    }

    pub(crate) fn take_stray(&mut self) -> String {
        std::mem::take(&mut self.stray)
    }

    fn finish(&mut self, events: &mut Vec<ParsedEvent>) {
        if let Some(cycle) = self.pending.take() {
            events.push(ParsedEvent::Finished {
                outcome: cycle.outcome,
                duration_ms: cycle.duration_ms,
                log: cycle.log,
            });
        }
    }

    fn line(&mut self, raw: &str, events: &mut Vec<ParsedEvent>) {
        let line = strip_escape_codes(raw);
        if line.starts_with("watching ")
            || line.starts_with("writing to ")
            || line.starts_with("serving at ")
        {
            self.finish(events);
            return;
        }
        if let Some(status) = status_text(&line) {
            if status.starts_with("compiling") {
                self.finish(events);
                events.push(ParsedEvent::Started);
                return;
            }
            let parsed = if let Some(duration) = status.strip_prefix("compiled successfully in") {
                Some((CycleOutcome::Success, parse_duration_ms(duration)))
            } else if let Some(duration) = status.strip_prefix("compiled with warnings in") {
                Some((CycleOutcome::Warnings, parse_duration_ms(duration)))
            } else if status.starts_with("compiled with errors") {
                Some((CycleOutcome::Errors, None))
            } else {
                None
            };
            if let Some((outcome, duration_ms)) = parsed {
                self.finish(events);
                self.pending = Some(PendingCycle {
                    outcome,
                    duration_ms,
                    log: format!("{line}\n"),
                });
                if outcome == CycleOutcome::Success {
                    self.finish(events);
                }
                return;
            }
        }
        match &mut self.pending {
            Some(cycle) => {
                append_bounded(&mut cycle.log, &format!("{line}\n"), MAX_CYCLE_LOG_BYTES)
            }
            None if !line.trim().is_empty() => {
                let mut stray = std::mem::take(&mut self.stray);
                if stray.len() + line.len() + 1 > MAX_STRAY_BYTES {
                    stray.clear();
                }
                if line.len() < MAX_STRAY_BYTES {
                    stray.push_str(&line);
                    stray.push('\n');
                }
                self.stray = stray;
            }
            None => {}
        }
    }
}

pub(crate) fn watch_args(
    compile_args: &[String],
    version: &ToolchainVersion,
) -> Result<Vec<String>, String> {
    let position = compile_args
        .iter()
        .take(2)
        .position(|argument| argument == "compile")
        .ok_or_else(|| "the Typst compile command has an unexpected shape".to_string())?;
    let mut arguments = compile_args.to_vec();
    arguments[position] = "watch".into();
    let serve_flags_since =
        ToolchainVersion::parse(SERVE_FLAGS_SINCE).expect("valid Typst version literal");
    if *version >= serve_flags_since {
        arguments.push("--no-serve".into());
        arguments.push("--no-reload".into());
    }
    Ok(arguments)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WatchCommand {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) working_dir: PathBuf,
    pub(crate) variables: Vec<(String, String)>,
}

impl WatchCommand {
    fn key(&self) -> (PathBuf, Vec<String>, PathBuf, Vec<(String, String)>) {
        let variables = self
            .variables
            .iter()
            .filter(|(name, _)| name != "SOURCE_DATE_EPOCH")
            .cloned()
            .collect();
        (
            self.program.clone(),
            self.args.clone(),
            self.working_dir.clone(),
            variables,
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WatchTarget {
    pub(crate) project_id: String,
    pub(crate) main_document: String,
    pub(crate) command: WatchCommand,
    pub(crate) project_dir: PathBuf,
    pub(crate) staging_dir: PathBuf,
    pub(crate) staged_pdf: PathBuf,
    pub(crate) build_pdf: PathBuf,
    pub(crate) staged_deps: Option<PathBuf>,
    pub(crate) build_deps: Option<PathBuf>,
    pub(crate) engine_name: String,
    pub(crate) toolchain_identity: String,
}

type TargetKey = (
    String,
    (PathBuf, Vec<String>, PathBuf, Vec<(String, String)>),
    PathBuf,
);

impl WatchTarget {
    fn key(&self) -> TargetKey {
        (
            self.main_document.clone(),
            self.command.key(),
            self.build_pdf.clone(),
        )
    }

    pub(crate) fn publish_paths(&self) -> PublishPaths {
        PublishPaths {
            staged_pdf: self.staged_pdf.clone(),
            build_pdf: self.build_pdf.clone(),
            staged_deps: self.staged_deps.clone(),
            build_deps: self.build_deps.clone(),
        }
    }
}

pub(crate) struct PublishPaths {
    pub(crate) staged_pdf: PathBuf,
    pub(crate) build_pdf: PathBuf,
    pub(crate) staged_deps: Option<PathBuf>,
    pub(crate) build_deps: Option<PathBuf>,
}

fn complete_pdf(bytes: &[u8]) -> bool {
    let trimmed = bytes
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .map_or(&[][..], |end| &bytes[..=end]);
    bytes.starts_with(b"%PDF-") && trimmed.ends_with(b"%%EOF")
}

fn replace_file(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| format!("{} has no parent folder", destination.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    let name = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let staging = parent.join(format!(".{name}.live-{}", std::process::id()));
    std::fs::write(&staging, bytes)
        .map_err(|error| format!("failed to write {}: {error}", staging.display()))?;
    std::fs::rename(&staging, destination).map_err(|error| {
        let _ = std::fs::remove_file(&staging);
        format!("failed to replace {}: {error}", destination.display())
    })
}

pub(crate) fn publish_files(paths: &PublishPaths) -> Result<String, String> {
    let bytes = std::fs::read(&paths.staged_pdf)
        .map_err(|error| format!("failed to read the live preview PDF: {error}"))?;
    if !complete_pdf(&bytes) {
        return Err("the live preview PDF was still being written".into());
    }
    replace_file(&paths.build_pdf, &bytes)?;
    if let (Some(staged), Some(build)) = (&paths.staged_deps, &paths.build_deps) {
        if let Ok(deps) = std::fs::read(staged) {
            replace_file(build, &deps)?;
        }
    }
    Ok(crate::document_engine::fingerprint_compile_output(&bytes))
}

#[derive(Clone, Debug)]
pub(crate) struct WatchConfig {
    pub(crate) quiet: Duration,
    pub(crate) cycle_timeout: Duration,
    pub(crate) idle: Duration,
    pub(crate) backoff: Duration,
    pub(crate) max_backoff: Duration,
    pub(crate) max_failures: u32,
    pub(crate) stable_after: Duration,
    pub(crate) stop_timeout: Duration,
    pub(crate) grace: Duration,
    pub(crate) wait_timeout: Duration,
    pub(crate) max_sessions: usize,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            quiet: Duration::from_millis(60),
            cycle_timeout: Duration::from_secs(300),
            idle: Duration::from_secs(30 * 60),
            backoff: Duration::from_millis(500),
            max_backoff: Duration::from_secs(30),
            max_failures: 5,
            stable_after: Duration::from_secs(60),
            stop_timeout: Duration::from_secs(2),
            grace: Duration::from_millis(300),
            wait_timeout: Duration::from_secs(300),
            max_sessions: 3,
        }
    }
}

impl WatchConfig {
    pub(crate) fn backoff_for(&self, failures: u32) -> Duration {
        let exponent = failures.saturating_sub(1).min(16);
        self.backoff
            .saturating_mul(1_u32 << exponent)
            .min(self.max_backoff)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WatchState {
    Starting,
    Watching,
    Compiling,
    Restarting,
    Stopped,
    Failed,
    Idle,
}

impl WatchState {
    fn ended(self) -> bool {
        matches!(self, Self::Stopped | Self::Failed | Self::Idle)
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct LiveCompileResult {
    pub(crate) ok: bool,
    pub(crate) has_pdf: bool,
    pub(crate) output_id: Option<String>,
    pub(crate) output_revision: Option<u64>,
    pub(crate) log: String,
    pub(crate) errors: Vec<CompileError>,
    pub(crate) diagnostics: Vec<oleafly_core::LogDiagnostic>,
    pub(crate) synctex_path: Option<String>,
    pub(crate) out_dir: Option<String>,
    pub(crate) compile_time_ms: u64,
    pub(crate) stopped: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusPayload {
    pub(crate) project_id: String,
    pub(crate) main_document: String,
    pub(crate) session_id: u64,
    pub(crate) state: WatchState,
    pub(crate) message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultPayload {
    pub(crate) project_id: String,
    pub(crate) main_document: String,
    pub(crate) session_id: u64,
    pub(crate) cycle: u64,
    pub(crate) result: LiveCompileResult,
}

pub(crate) struct Published {
    pub(crate) output_id: String,
    pub(crate) output_revision: u64,
}

pub(crate) trait WatchHost: Send + Sync + 'static {
    fn emit_status(&self, payload: &StatusPayload);
    fn emit_result(&self, payload: &ResultPayload);
    fn publish(&self, target: Arc<WatchTarget>) -> BoxFuture<Result<Published, String>>;
    fn diagnose(&self, target: Arc<WatchTarget>, log: String) -> BoxFuture<DiagnosedLog>;
}

#[derive(Debug)]
pub(crate) struct CycleRecord {
    pub(crate) id: u64,
    pub(crate) generation: u64,
    pub(crate) result: LiveCompileResult,
}

enum Control {
    Stop(oneshot::Sender<()>),
    Restart(oneshot::Sender<u64>),
}

#[derive(Default)]
struct KillSwitch {
    stopped: AtomicBool,
    guard: Mutex<Option<ProcessTreeGuard>>,
}

impl KillSwitch {
    fn arm(&self, guard: ProcessTreeGuard) {
        *lock(&self.guard) = Some(guard);
    }

    fn release(&self) {
        drop(lock(&self.guard).take());
    }

    fn kill_now(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.release();
    }

    fn stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }
}

pub(crate) struct Session {
    pub(crate) serial: u64,
    key: TargetKey,
    config: WatchConfig,
    control: mpsc::Sender<Control>,
    results: watch::Receiver<Option<Arc<CycleRecord>>>,
    state: watch::Receiver<WatchState>,
    kill: Arc<KillSwitch>,
    touched: Mutex<Instant>,
}

impl Session {
    fn touch(&self) {
        *lock(&self.touched) = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        lock(&self.touched).elapsed()
    }

    pub(crate) fn state(&self) -> WatchState {
        *self.state.borrow()
    }

    pub(crate) fn latest(&self) -> Option<Arc<CycleRecord>> {
        self.results.borrow().clone()
    }

    pub(crate) fn latest_id(&self) -> u64 {
        self.latest().map_or(0, |record| record.id)
    }

    async fn wait_for<F>(&self, accept: F) -> Result<Arc<CycleRecord>, String>
    where
        F: Fn(&CycleRecord) -> bool,
    {
        let mut results = self.results.clone();
        let mut state = self.state.clone();
        let wait = async {
            loop {
                if let Some(record) = results.borrow_and_update().clone() {
                    if accept(&record) {
                        return Ok(record);
                    }
                }
                let current = *state.borrow_and_update();
                if current.ended() {
                    return Err(stopped_message(current));
                }
                tokio::select! {
                    changed = results.changed() => {
                        if changed.is_err() {
                            return Err(stopped_message(*state.borrow()));
                        }
                    }
                    changed = state.changed() => {
                        if changed.is_err() {
                            return Err(stopped_message(WatchState::Stopped));
                        }
                    }
                }
            }
        };
        tokio::time::timeout(self.config.wait_timeout, wait)
            .await
            .map_err(|_| "the live preview did not finish compiling in time".to_string())?
    }

    pub(crate) async fn wait_after(&self, id: u64) -> Result<Arc<CycleRecord>, String> {
        self.wait_for(|record| record.id > id).await
    }

    async fn restart(&self) -> Result<u64, String> {
        let (sender, receiver) = oneshot::channel();
        self.control
            .send(Control::Restart(sender))
            .await
            .map_err(|_| stopped_message(self.state()))?;
        receiver.await.map_err(|_| stopped_message(self.state()))
    }

    pub(crate) async fn compile(
        &self,
        fresh: bool,
        just_started: bool,
    ) -> Result<Arc<CycleRecord>, String> {
        self.touch();
        if fresh && !just_started {
            let generation = self.restart().await?;
            return self
                .wait_for(|record| record.generation >= generation)
                .await;
        }
        let latest = self.latest_id();
        if just_started || latest == 0 || self.state() == WatchState::Compiling {
            return self.wait_after(latest).await;
        }
        let mut state = self.state.clone();
        let mut results = self.results.clone();
        let noticed = tokio::time::timeout(self.config.grace, async {
            loop {
                if *state.borrow_and_update() == WatchState::Compiling
                    || results
                        .borrow_and_update()
                        .as_ref()
                        .map_or(0, |record| record.id)
                        > latest
                {
                    return true;
                }
                tokio::select! {
                    changed = state.changed() => if changed.is_err() { return false; },
                    changed = results.changed() => if changed.is_err() { return false; },
                }
            }
        })
        .await
        .unwrap_or(false);
        if noticed {
            return self.wait_after(latest).await;
        }
        self.latest().ok_or_else(|| stopped_message(self.state()))
    }

    async fn stop(&self) {
        let (sender, receiver) = oneshot::channel();
        if self.control.send(Control::Stop(sender)).await.is_ok()
            && tokio::time::timeout(self.config.stop_timeout, receiver)
                .await
                .is_ok()
        {
            return;
        }
        self.kill.kill_now();
    }
}

fn stopped_message(state: WatchState) -> String {
    match state {
        WatchState::Failed => "the live preview stopped after repeated failures".into(),
        WatchState::Idle => "the live preview stopped after a long idle period".into(),
        _ => "the live preview stopped".into(),
    }
}

pub(crate) struct Registry {
    config: WatchConfig,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    serial: AtomicU64,
    changes: tokio::sync::Mutex<()>,
}

static REGISTRY: LazyLock<Registry> = LazyLock::new(|| Registry::new(WatchConfig::default()));

impl Registry {
    pub(crate) fn new(config: WatchConfig) -> Self {
        Self {
            config,
            sessions: Mutex::new(HashMap::new()),
            serial: AtomicU64::new(1),
            changes: tokio::sync::Mutex::new(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        lock(&self.sessions).len()
    }

    #[cfg(test)]
    pub(crate) fn session(&self, project_id: &str) -> Option<Arc<Session>> {
        lock(&self.sessions).get(project_id).cloned()
    }

    pub(crate) async fn ensure(
        &self,
        host: Arc<dyn WatchHost>,
        target: WatchTarget,
    ) -> (Arc<Session>, bool) {
        let key = target.key();
        let _changes = self.changes.lock().await;
        let replaced = {
            let mut sessions = lock(&self.sessions);
            match sessions.get(&target.project_id) {
                Some(session) if session.key == key && !session.state().ended() => {
                    session.touch();
                    return (session.clone(), false);
                }
                Some(_) => sessions.remove(&target.project_id),
                None => None,
            }
        };
        if let Some(old) = replaced {
            old.stop().await;
        }
        let mut retired = Vec::new();
        let session = {
            let mut sessions = lock(&self.sessions);
            let session = self.spawn(host, target.clone(), key);
            sessions.insert(target.project_id.clone(), session.clone());
            while sessions.len() > self.config.max_sessions {
                let Some(oldest) = sessions
                    .iter()
                    .filter(|(id, _)| **id != target.project_id)
                    .max_by_key(|(_, session)| session.idle_for())
                    .map(|(id, _)| id.clone())
                else {
                    break;
                };
                retired.extend(sessions.remove(&oldest));
            }
            session
        };
        for old in retired {
            old.stop().await;
        }
        (session, true)
    }

    pub(crate) async fn stop(&self, project_id: &str) -> bool {
        let _changes = self.changes.lock().await;
        let session = lock(&self.sessions).remove(project_id);
        match session {
            Some(session) => {
                session.stop().await;
                true
            }
            None => false,
        }
    }

    pub(crate) fn kill_all_now(&self) {
        let sessions: Vec<Arc<Session>> = lock(&self.sessions).drain().map(|(_, s)| s).collect();
        for session in sessions {
            session.kill.kill_now();
        }
    }

    fn spawn(&self, host: Arc<dyn WatchHost>, target: WatchTarget, key: TargetKey) -> Arc<Session> {
        let serial = self.serial.fetch_add(1, Ordering::SeqCst);
        let (control, control_receiver) = mpsc::channel(8);
        let (results_sender, results) = watch::channel(None);
        let (state_sender, state) = watch::channel(WatchState::Starting);
        let kill = Arc::new(KillSwitch::default());
        let supervisor = Supervisor {
            serial,
            host,
            target: Arc::new(target),
            config: self.config.clone(),
            control: control_receiver,
            results: results_sender,
            state: state_sender,
            kill: kill.clone(),
            next_cycle: 1,
            generation: 0,
            last_activity: Instant::now(),
        };
        tokio::spawn(supervisor.run());
        Arc::new(Session {
            serial,
            key,
            config: self.config.clone(),
            control,
            results,
            state,
            kill,
            touched: Mutex::new(Instant::now()),
        })
    }
}

enum ProcessEnd {
    Stopped(Option<oneshot::Sender<()>>),
    Restart(oneshot::Sender<u64>),
    Exited(String),
    CycleTimeout,
    Idle,
}

struct Supervisor {
    serial: u64,
    host: Arc<dyn WatchHost>,
    target: Arc<WatchTarget>,
    config: WatchConfig,
    control: mpsc::Receiver<Control>,
    results: watch::Sender<Option<Arc<CycleRecord>>>,
    state: watch::Sender<WatchState>,
    kill: Arc<KillSwitch>,
    next_cycle: u64,
    generation: u64,
    last_activity: Instant,
}

fn spawn_watch(
    command: &WatchCommand,
) -> Result<(tokio::process::Child, ProcessTreeGuard), String> {
    let mut process = tokio::process::Command::new(&command.program);
    process.no_console();
    process
        .args(&command.args)
        .current_dir(&command.working_dir)
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (name, value) in &command.variables {
        process.env(name, value);
    }
    isolate_process_tree(&mut process);
    let mut child = process
        .spawn()
        .map_err(|error| format!("failed to start Typst for the live preview: {error}"))?;
    let Some(pid) = child.id() else {
        let _ = child.start_kill();
        return Err("the live preview process did not expose a process id".into());
    };
    match contain_process_tree(pid) {
        Ok(guard) => Ok((child, guard)),
        Err(error) => {
            let _ = child.start_kill();
            Err(format!(
                "failed to contain the live preview process: {error}"
            ))
        }
    }
}

fn pump<R>(mut reader: R, sender: mpsc::Sender<String>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut decoder = oleafly_core::Utf8StreamDecoder::default();
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) | Err(_) => {
                    let tail = decoder.push(&[], true);
                    if !tail.is_empty() {
                        let _ = sender.send(tail).await;
                    }
                    return;
                }
                Ok(read) => {
                    let text = decoder.push(&buffer[..read], false);
                    if !text.is_empty() && sender.send(text).await.is_err() {
                        return;
                    }
                }
            }
        }
    });
}

impl Supervisor {
    fn status(&self, state: WatchState, message: Option<String>) {
        self.state.send_replace(state);
        self.host.emit_status(&StatusPayload {
            project_id: self.target.project_id.clone(),
            main_document: self.target.main_document.clone(),
            session_id: self.serial,
            state,
            message,
        });
    }

    async fn run(mut self) {
        let _build = crate::build_hygiene::BuildInUse::claim(&self.target.project_id);
        let mut failures: u32 = 0;
        let mut restart_ack: Option<oneshot::Sender<u64>> = None;
        let mut stop_ack: Option<oneshot::Sender<()>> = None;
        let mut final_state = WatchState::Stopped;
        let mut final_message = None;
        'sessions: loop {
            if self.kill.stopped() {
                break;
            }
            self.generation += 1;
            if let Some(ack) = restart_ack.take() {
                let _ = ack.send(self.generation);
            }
            let started_at = Instant::now();
            let _ = tokio::fs::create_dir_all(&self.target.staging_dir).await;
            let end = match spawn_watch(&self.target.command) {
                Ok((child, guard)) => {
                    self.kill.arm(guard);
                    if self.kill.stopped() {
                        self.kill.release();
                        break;
                    }
                    self.status(WatchState::Watching, None);
                    self.last_activity = Instant::now();
                    let end = self.drive(child).await;
                    self.kill.release();
                    end
                }
                Err(error) => ProcessEnd::Exited(error),
            };
            match end {
                ProcessEnd::Stopped(ack) => {
                    stop_ack = ack;
                    break;
                }
                ProcessEnd::Restart(ack) => {
                    failures = 0;
                    restart_ack = Some(ack);
                    self.status(WatchState::Restarting, None);
                }
                ProcessEnd::Idle => {
                    final_state = WatchState::Idle;
                    break;
                }
                ProcessEnd::Exited(_) | ProcessEnd::CycleTimeout if self.kill.stopped() => break,
                ProcessEnd::Exited(_) | ProcessEnd::CycleTimeout => {
                    let message = match end {
                        ProcessEnd::Exited(text) => text,
                        _ => "Typst did not finish compiling in time".to_owned(),
                    };
                    if started_at.elapsed() >= self.config.stable_after {
                        failures = 0;
                    }
                    failures += 1;
                    if failures >= self.config.max_failures {
                        final_state = WatchState::Failed;
                        final_message = Some(message);
                        break;
                    }
                    self.status(WatchState::Restarting, Some(message));
                    tokio::select! {
                        _ = tokio::time::sleep(self.config.backoff_for(failures)) => {}
                        control = self.control.recv() => match control {
                            Some(Control::Stop(ack)) => {
                                stop_ack = Some(ack);
                                break 'sessions;
                            }
                            Some(Control::Restart(ack)) => {
                                failures = 0;
                                restart_ack = Some(ack);
                            }
                            None => break 'sessions,
                        },
                    }
                }
            }
        }
        self.kill.kill_now();
        let _ = tokio::fs::remove_dir_all(&self.target.staging_dir).await;
        self.status(final_state, final_message);
        if let Some(ack) = stop_ack {
            let _ = ack.send(());
        }
    }

    async fn drive(&mut self, mut child: tokio::process::Child) -> ProcessEnd {
        let (sender, mut chunks) = mpsc::channel::<String>(CHUNK_CAPACITY);
        if let Some(stdout) = child.stdout.take() {
            pump(stdout, sender.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            pump(stderr, sender);
        }
        let mut parser = WatchParser::default();
        let mut quiet_until: Option<tokio::time::Instant> = None;
        let mut cycle_started: Option<Instant> = None;
        let end = loop {
            let idle_at = tokio::time::Instant::from_std(self.last_activity + self.config.idle);
            let timeout_at = cycle_started
                .map(|started| tokio::time::Instant::from_std(started + self.config.cycle_timeout))
                .unwrap_or(idle_at);
            let deadline = quiet_until.map_or(timeout_at, |quiet| quiet.min(timeout_at));
            tokio::select! {
                chunk = chunks.recv() => match chunk {
                    Some(text) => {
                        for event in parser.push(&text) {
                            self.handle(event, &mut cycle_started).await;
                        }
                        quiet_until = parser
                            .has_pending()
                            .then(|| tokio::time::Instant::now() + self.config.quiet);
                    }
                    None => {
                        if let Some(event) = parser.flush() {
                            self.handle(event, &mut cycle_started).await;
                        }
                        let _ = tokio::time::timeout(self.config.stop_timeout, child.wait()).await;
                        break ProcessEnd::Exited(exit_message(parser.take_stray()));
                    }
                },
                control = self.control.recv() => match control {
                    Some(Control::Stop(ack)) => break ProcessEnd::Stopped(Some(ack)),
                    Some(Control::Restart(ack)) => break ProcessEnd::Restart(ack),
                    None => break ProcessEnd::Stopped(None),
                },
                _ = tokio::time::sleep_until(deadline) => {
                    let now = tokio::time::Instant::now();
                    if quiet_until.is_some_and(|quiet| quiet <= now) {
                        quiet_until = None;
                        if let Some(event) = parser.flush() {
                            self.handle(event, &mut cycle_started).await;
                        }
                    } else if cycle_started.is_some() && timeout_at <= now {
                        break ProcessEnd::CycleTimeout;
                    } else if cycle_started.is_none() && idle_at <= now {
                        break ProcessEnd::Idle;
                    }
                }
            }
        };
        let _ = child.start_kill();
        let _ = tokio::time::timeout(self.config.stop_timeout, child.wait()).await;
        end
    }

    async fn handle(&mut self, event: ParsedEvent, cycle_started: &mut Option<Instant>) {
        self.last_activity = Instant::now();
        match event {
            ParsedEvent::Started => {
                *cycle_started = Some(Instant::now());
                self.status(WatchState::Compiling, None);
            }
            ParsedEvent::Finished {
                outcome,
                duration_ms,
                log,
            } => {
                let elapsed = cycle_started
                    .take()
                    .map(|started| started.elapsed().as_millis() as u64);
                let result = self
                    .cycle_result(outcome, log, duration_ms.or(elapsed))
                    .await;
                let id = self.next_cycle;
                self.next_cycle += 1;
                self.host.emit_result(&ResultPayload {
                    project_id: self.target.project_id.clone(),
                    main_document: self.target.main_document.clone(),
                    session_id: self.serial,
                    cycle: id,
                    result: result.clone(),
                });
                self.results.send_replace(Some(Arc::new(CycleRecord {
                    id,
                    generation: self.generation,
                    result,
                })));
                self.last_activity = Instant::now();
                self.status(WatchState::Watching, None);
            }
        }
    }

    async fn cycle_result(
        &self,
        outcome: CycleOutcome,
        log: String,
        compile_time_ms: Option<u64>,
    ) -> LiveCompileResult {
        let (published, publish_note) = if outcome == CycleOutcome::Errors {
            (None, None)
        } else {
            match self.host.publish(self.target.clone()).await {
                Ok(published) => (Some(published), None),
                Err(error) => (None, Some(error)),
            }
        };
        let (mut log, diagnostics, errors) = self.host.diagnose(self.target.clone(), log).await;
        if let Some(note) = publish_note {
            append_bounded(
                &mut log,
                &format!("\nOleafly could not show the live preview PDF: {note}\n"),
                MAX_CYCLE_LOG_BYTES,
            );
        }
        let reported_errors = errors.iter().any(|error| error.kind == "error");
        let ok = published.is_some() && !reported_errors;
        LiveCompileResult {
            ok,
            has_pdf: published.is_some(),
            output_id: published
                .as_ref()
                .map(|published| published.output_id.clone()),
            output_revision: published
                .as_ref()
                .filter(|_| ok)
                .map(|published| published.output_revision),
            log,
            errors,
            diagnostics,
            synctex_path: None,
            out_dir: self
                .target
                .build_pdf
                .parent()
                .map(|parent| parent.to_string_lossy().into_owned()),
            compile_time_ms: compile_time_ms.unwrap_or(0),
            stopped: false,
        }
    }
}

fn exit_message(stray: String) -> String {
    let stray = stray.trim();
    if stray.is_empty() {
        "Typst stopped watching the project".to_owned()
    } else {
        stray.to_owned()
    }
}

fn staging_dir(project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    Ok(crate::paths::oleafly_root()?
        .join(STAGING_DIR)
        .join(project_id))
}

async fn prepare_target(
    project_id: &str,
    main_doc: &str,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<WatchTarget, String> {
    let main = {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
        let options = crate::commands::requested_compile_options(offline, None, None);
        crate::commands::MainCompile::prepare(project_id, main_doc, typst_variant, options).await?
    };
    if main.engine.id() != DocumentEngineId::Typst {
        return Err("Live preview is only available for Typst projects.".into());
    }
    let staging = staging_dir(project_id)?;
    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|error| format!("failed to prepare the live preview folder: {error}"))?;
    let spec = main.spec(main_doc, &staging, main.options.clone()).await?;
    let program = match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            crate::document_engine::resolve_bundled_sidecar(name)?
        }
        EngineExecutable::ExternalPath(path) => path.clone(),
    };
    let version = main.options.typst.as_ref().map_or_else(
        || oleafly_core::typst_toolchain::bundled_typst_version().clone(),
        |typst| typst.version.clone(),
    );
    let build = main.engine.artifacts(
        &main.build_dir,
        CompileTarget::Main {
            main_document: main_doc,
        },
    );
    let deps = main.options.external_build.then(|| {
        (
            crate::typst_options::dependency_file(&staging),
            crate::typst_options::dependency_file(&main.build_dir),
        )
    });
    Ok(WatchTarget {
        project_id: project_id.to_owned(),
        main_document: main_doc.to_owned(),
        command: WatchCommand {
            program,
            args: watch_args(&spec.args, &version)?,
            working_dir: spec.working_dir.clone(),
            variables: spec.environment.variables().to_vec(),
        },
        project_dir: main.project_dir.clone(),
        staging_dir: staging,
        staged_pdf: spec
            .artifacts
            .pdf
            .clone()
            .ok_or("the Typst live preview has no PDF output")?,
        build_pdf: build.pdf.ok_or("the Typst build has no PDF output")?,
        staged_deps: deps.as_ref().map(|(staged, _)| staged.clone()),
        build_deps: deps.map(|(_, build)| build),
        engine_name: main.meta.engine.clone(),
        toolchain_identity: main.toolchain_identity(),
    })
}

struct AppHost {
    app: tauri::AppHandle,
}

impl WatchHost for AppHost {
    fn emit_status(&self, payload: &StatusPayload) {
        let _ = self.app.emit(STATUS_EVENT, payload);
    }

    fn emit_result(&self, payload: &ResultPayload) {
        let _ = self.app.emit(RESULT_EVENT, payload);
    }

    fn publish(&self, target: Arc<WatchTarget>) -> BoxFuture<Result<Published, String>> {
        let app = self.app.clone();
        Box::pin(async move {
            let state = app.state::<crate::state::AppState>();
            let _guard = state.compile_lock.lock().await;
            let output_id = tauri::async_runtime::spawn_blocking(move || {
                let _worktree =
                    crate::worktree_lock::ProjectWorktreeLock::shared(&target.project_id)?;
                publish_files(&target.publish_paths())
            })
            .await
            .map_err(|error| format!("failed to publish the live preview PDF: {error}"))??;
            let output_revision = state.compile_output_revision.fetch_add(1, Ordering::SeqCst) + 1;
            Ok(Published {
                output_id,
                output_revision,
            })
        })
    }

    fn diagnose(&self, target: Arc<WatchTarget>, log: String) -> BoxFuture<DiagnosedLog> {
        Box::pin(async move {
            crate::document_engine::typst_log_errors(
                log.clone(),
                &target.main_document,
                target.project_dir.clone(),
                target.command.working_dir.clone(),
            )
            .await
            .unwrap_or((log, Vec::new(), Vec::new()))
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstWatchStarted {
    session_id: u64,
    started: bool,
}

async fn ensure_session(
    app: tauri::AppHandle,
    project_id: &str,
    main_doc: &str,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<(Arc<Session>, bool, Arc<WatchTarget>), String> {
    let target = prepare_target(project_id, main_doc, offline, typst_variant).await?;
    let shared = Arc::new(target.clone());
    let (session, started) = REGISTRY.ensure(Arc::new(AppHost { app }), target).await;
    Ok((session, started, shared))
}

#[tauri::command]
pub async fn typst_watch_start(
    app: tauri::AppHandle,
    project_id: String,
    main_doc: String,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<TypstWatchStarted, String> {
    let (session, started, _) =
        ensure_session(app, &project_id, &main_doc, offline, typst_variant).await?;
    Ok(TypstWatchStarted {
        session_id: session.serial,
        started,
    })
}

#[tauri::command]
pub async fn typst_watch_compile(
    app: tauri::AppHandle,
    project_id: String,
    main_doc: String,
    offline: Option<bool>,
    typst_variant: Option<String>,
    fresh: Option<bool>,
) -> Result<LiveCompileResult, String> {
    let (session, started, target) =
        ensure_session(app.clone(), &project_id, &main_doc, offline, typst_variant).await?;
    let record = session.compile(fresh.unwrap_or(false), started).await?;
    if record.result.ok {
        crate::checkpoint_publication::schedule_after_successful_compile(
            &app,
            &project_id,
            &target.project_dir,
            &target.engine_name,
            &target.main_document,
            &target.toolchain_identity,
        );
    }
    Ok(record.result.clone())
}

#[tauri::command]
pub async fn typst_watch_stop(project_id: String) -> Result<bool, String> {
    Ok(REGISTRY.stop(&project_id).await)
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("typst-watch-lifecycle")
        .on_event(|_app, event| {
            if let RunEvent::Exit = event {
                REGISTRY.kill_all_now();
            }
        })
        .build()
}
