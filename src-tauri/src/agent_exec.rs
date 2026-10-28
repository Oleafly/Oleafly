use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use tauri::State;
use tokio::io::AsyncReadExt;

use crate::proc::NoConsole;

const EXEC_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_OUTPUT_BYTES: usize = 200 * 1024;
const MAX_CANCELLED_RUNS: usize = 256;
const EXEC_APPROVAL_TTL: Duration = Duration::from_secs(30);
const MAX_EXEC_APPROVALS: usize = 256;
const EXTERNAL_OWNER_TTL: Duration = Duration::from_secs(600);
const MAX_EXTERNAL_OWNERS: usize = 256;

#[derive(Default)]
pub struct AgentExecState {
    registry: Mutex<ExecRegistry>,
}

#[derive(Default)]
struct ExecRegistry {
    approvals: HashMap<String, ExecApproval>,
    approval_order: VecDeque<String>,
    active: HashMap<String, HashMap<String, ActiveExec>>,
    completions: HashMap<String, HashMap<String, tokio::sync::watch::Receiver<bool>>>,
    cancelled_runs: VecDeque<String>,
    // Renderer-minted `external:` owners are only trusted once registered
    // through a live command. Membership is TTL-bounded and cleared on cancel,
    // so a compromised renderer cannot execute under an arbitrary forged id.
    external_owners: HashMap<String, Instant>,
}

struct ExecApproval {
    project_id: String,
    command: String,
    run_id: String,
    expires_at: Instant,
}

fn drop_dangling_order(registry: &mut ExecRegistry) {
    let approvals = &registry.approvals;
    registry
        .approval_order
        .retain(|token| approvals.contains_key(token));
}

fn purge_exec_approvals(registry: &mut ExecRegistry, now: Instant) {
    registry
        .approvals
        .retain(|_, approval| approval.expires_at > now);
    drop_dangling_order(registry);
}

struct ActiveExec {
    pid: Option<u32>,
    _containment: Option<crate::proc::ProcessTreeGuard>,
}

#[derive(Clone, Copy)]
struct ExecRequest<'a> {
    root: &'a Path,
    project_id: &'a str,
    cwd: &'a Path,
    command: &'a str,
    run_id: &'a str,
}

struct ExecLease<'a> {
    state: &'a AgentExecState,
    run_id: String,
    exec_id: Option<String>,
    pid: Option<u32>,
    completed: bool,
    completion_id: String,
    completion: tokio::sync::watch::Sender<bool>,
}

enum UnregisterResult {
    Removed(Option<ActiveExec>),
    RegistryUnavailable,
}

impl AgentExecState {
    fn register_external_owner(&self, run_id: &str) -> Result<(), String> {
        self.register_external_owner_at(run_id, Instant::now())
    }

    fn register_external_owner_at(&self, run_id: &str, now: Instant) -> Result<(), String> {
        if !external_owner_has_valid_syntax(run_id) {
            return Err("the external command owner id is malformed".to_string());
        }
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "run_command approval registry is unavailable".to_string())?;
        registry.external_owners.retain(|_, expiry| *expiry > now);
        while registry.external_owners.len() >= MAX_EXTERNAL_OWNERS {
            let Some(oldest) = registry
                .external_owners
                .iter()
                .min_by_key(|(_, expiry)| **expiry)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            registry.external_owners.remove(&oldest);
        }
        registry
            .external_owners
            .insert(run_id.to_string(), now + EXTERNAL_OWNER_TTL);
        Ok(())
    }

    fn external_owner_is_live(&self, run_id: &str, now: Instant) -> Result<bool, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "run_command approval registry is unavailable".to_string())?;
        registry.external_owners.retain(|_, expiry| *expiry > now);
        Ok(registry.external_owners.contains_key(run_id))
    }

    fn authorize(&self, project_id: &str, command: &str, run_id: &str) -> Result<String, String> {
        self.authorize_at(project_id, command, run_id, Instant::now())
    }

    fn authorize_at(
        &self,
        project_id: &str,
        command: &str,
        run_id: &str,
        now: Instant,
    ) -> Result<String, String> {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "run_command approval registry is unavailable".to_string())?;
        if registry.cancelled_runs.iter().any(|id| id == run_id) {
            return Err("the agent run was cancelled".to_string());
        }
        purge_exec_approvals(&mut registry, now);
        while registry.approvals.len() >= MAX_EXEC_APPROVALS {
            let Some(oldest) = registry.approval_order.pop_front() else {
                registry.approvals.clear();
                break;
            };
            registry.approvals.remove(&oldest);
        }
        registry.approval_order.push_back(token.clone());
        registry.approvals.insert(
            token.clone(),
            ExecApproval {
                project_id: project_id.to_string(),
                command: command.to_string(),
                run_id: run_id.to_string(),
                expires_at: now + EXEC_APPROVAL_TTL,
            },
        );
        Ok(token)
    }

    fn begin_execution<'a>(
        &'a self,
        project_id: &str,
        command: &str,
        run_id: &str,
        token: &str,
    ) -> Result<ExecLease<'a>, String> {
        self.begin_execution_at(project_id, command, run_id, token, Instant::now())
    }

    fn begin_execution_at<'a>(
        &'a self,
        project_id: &str,
        command: &str,
        run_id: &str,
        token: &str,
        now: Instant,
    ) -> Result<ExecLease<'a>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "run_command approval registry is unavailable".to_string())?;
        purge_exec_approvals(&mut registry, now);
        let approval = registry
            .approvals
            .remove(token)
            .ok_or_else(|| "run_command approval is invalid or already used".to_string())?;
        if approval.project_id != project_id
            || approval.command != command
            || approval.run_id != run_id
        {
            return Err("run_command approval does not match this execution".to_string());
        }
        if registry.cancelled_runs.iter().any(|id| id == run_id) {
            return Err("the agent run was cancelled".to_string());
        }
        let (completion, receiver) = tokio::sync::watch::channel(false);
        registry
            .completions
            .entry(run_id.to_string())
            .or_default()
            .insert(token.to_string(), receiver);
        registry
            .active
            .entry(run_id.to_string())
            .or_default()
            .insert(
                token.to_string(),
                ActiveExec {
                    pid: None,
                    _containment: None,
                },
            );
        Ok(ExecLease {
            state: self,
            run_id: run_id.to_string(),
            exec_id: Some(token.to_string()),
            pid: None,
            completed: false,
            completion_id: token.to_string(),
            completion,
        })
    }
}

impl ExecLease<'_> {
    fn activate(
        &mut self,
        pid: u32,
        containment: crate::proc::ProcessTreeGuard,
    ) -> Result<(), String> {
        let mut registry = self
            .state
            .registry
            .lock()
            .map_err(|_| "run_command registry is unavailable".to_string())?;
        if registry.cancelled_runs.iter().any(|id| id == &self.run_id) {
            return Err("the agent run was cancelled".to_string());
        }
        let exec_id = self
            .exec_id
            .as_deref()
            .ok_or_else(|| "the command execution is no longer active".to_string())?;
        let active = registry
            .active
            .get_mut(&self.run_id)
            .and_then(|runs| runs.get_mut(exec_id))
            .ok_or_else(|| "the agent run was cancelled".to_string())?;
        active.pid = Some(pid);
        active._containment = Some(containment);
        self.pid = Some(pid);
        Ok(())
    }

    fn unregister(&mut self) -> UnregisterResult {
        let Some(exec_id) = self.exec_id.as_deref() else {
            return UnregisterResult::Removed(None);
        };
        let Ok(mut registry) = self.state.registry.lock() else {
            return UnregisterResult::RegistryUnavailable;
        };
        let active = registry
            .active
            .get_mut(&self.run_id)
            .and_then(|runs| runs.remove(exec_id));
        if registry
            .active
            .get(&self.run_id)
            .is_some_and(HashMap::is_empty)
        {
            registry.active.remove(&self.run_id);
        }
        self.exec_id = None;
        UnregisterResult::Removed(active)
    }

    fn complete(&mut self) {
        if let UnregisterResult::Removed(Some(mut active)) = self.unregister() {
            if let Some(containment) = active._containment.take() {
                containment.disarm();
            }
        }
        self.exec_id = None;
        self.pid = None;
        self.completed = true;
        self.finish_completion();
    }

    fn finish_completion(&self) {
        let _ = self.completion.send(true);
        if let Ok(mut registry) = self.state.registry.lock() {
            if let Some(entries) = registry.completions.get_mut(&self.run_id) {
                entries.remove(&self.completion_id);
                if entries.is_empty() {
                    registry.completions.remove(&self.run_id);
                }
            }
        }
    }

    fn stop_process_tree(&mut self) {
        let process = match self.unregister() {
            UnregisterResult::Removed(process) => process.and_then(|entry| entry.pid),
            UnregisterResult::RegistryUnavailable => self.pid,
        };
        if let Some(pid) = process {
            terminate_process(pid);
        }
        self.pid = None;
    }
}

impl Drop for ExecLease<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        self.stop_process_tree();
        self.finish_completion();
    }
}

pub fn cancel_run(state: &AgentExecState, run_id: &str) {
    let processes = state.registry.lock().map_or_else(
        |_| Vec::new(),
        |mut registry| {
            registry
                .approvals
                .retain(|_, approval| approval.run_id != run_id);
            drop_dangling_order(&mut registry);
            registry.external_owners.remove(run_id);
            remember_cancelled_run(&mut registry.cancelled_runs, run_id);
            registry
                .active
                .remove(run_id)
                .into_iter()
                .flat_map(|active| active.into_values().filter_map(|entry| entry.pid))
                .collect()
        },
    );
    for pid in processes {
        terminate_process(pid);
    }
}

pub async fn cancel_run_and_wait(state: &AgentExecState, run_id: &str) {
    let receivers = state.registry.lock().map_or_else(
        |_| Vec::new(),
        |registry| {
            registry
                .completions
                .get(run_id)
                .map(|entries| entries.values().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        },
    );
    cancel_run(state, run_id);
    for mut receiver in receivers {
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}

pub async fn cancel_all_and_wait(state: &AgentExecState) {
    let receivers = state.registry.lock().map_or_else(
        |_| Vec::new(),
        |registry| {
            registry
                .completions
                .values()
                .flat_map(|entries| entries.values().cloned())
                .collect::<Vec<_>>()
        },
    );
    cancel_all(state);
    for mut receiver in receivers {
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}

pub fn cancel_all(state: &AgentExecState) {
    let processes = state.registry.lock().map_or_else(
        |_| Vec::new(),
        |mut registry| {
            let run_ids = registry
                .approvals
                .values()
                .map(|approval| approval.run_id.clone())
                .chain(registry.active.keys().cloned())
                .collect::<HashSet<_>>();
            registry.approvals.clear();
            registry.approval_order.clear();
            registry.external_owners.clear();
            for run_id in run_ids {
                remember_cancelled_run(&mut registry.cancelled_runs, &run_id);
            }
            registry
                .active
                .drain()
                .flat_map(|(_, active)| active.into_values().filter_map(|entry| entry.pid))
                .collect()
        },
    );
    for pid in processes {
        terminate_process(pid);
    }
}

fn remember_cancelled_run(cancelled: &mut VecDeque<String>, run_id: &str) {
    if cancelled.iter().any(|id| id == run_id) {
        return;
    }
    if cancelled.len() == MAX_CANCELLED_RUNS {
        cancelled.pop_front();
    }
    cancelled.push_back(run_id.to_string());
}

#[cfg(unix)]
fn terminate_process(pid: u32) {
    if let Ok(group) = i32::try_from(pid) {
        unsafe {
            let _ = libc::kill(-group, libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
fn terminate_process(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !process.is_null() {
            let _ = TerminateProcess(process, 1);
            CloseHandle(process);
        }
    }
}

#[derive(Serialize)]
pub struct ExecResult {
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub status: String,
    pub truncated: bool,
    pub timed_out: bool,
}

fn status_line(exit_code: Option<i32>, timed_out: bool) -> String {
    if timed_out {
        return "Stopped: timed out".to_string();
    }
    match exit_code {
        Some(0) => "Success".to_string(),
        Some(code) => format!("Failed with exit code {code}"),
        None => "Stopped".to_string(),
    }
}

#[tauri::command]
pub async fn agent_exec(
    state: State<'_, AgentExecState>,
    agent_state: State<'_, crate::agent::AgentState>,
    project_id: String,
    command: String,
    run_id: String,
    approval_token: String,
) -> Result<ExecResult, String> {
    let cwd = crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    execute_command_for_owner(
        agent_state.inner(),
        state.inner(),
        ExecRequest {
            root: &root,
            project_id: &project_id,
            cwd: &cwd,
            command: &command,
            run_id: &run_id,
        },
        &approval_token,
    )
    .await
}

#[tauri::command]
pub fn agent_exec_register_external(
    state: State<'_, AgentExecState>,
    run_id: String,
) -> Result<(), String> {
    state.register_external_owner(&run_id)
}

#[tauri::command]
pub async fn agent_exec_authorize(
    state: State<'_, AgentExecState>,
    agent_state: State<'_, crate::agent::AgentState>,
    project_id: String,
    command: String,
    run_id: String,
) -> Result<String, String> {
    let cwd = crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    authorize_approved(
        state.inner(),
        agent_state.inner(),
        ExecRequest {
            root: &root,
            project_id: &project_id,
            cwd: &cwd,
            command: &command,
            run_id: &run_id,
        },
    )
}

fn authorize_approved(
    state: &AgentExecState,
    agent_state: &crate::agent::AgentState,
    request: ExecRequest<'_>,
) -> Result<String, String> {
    if request.command.trim().is_empty() {
        return Err("the command was empty".to_string());
    }
    if request.run_id.trim().is_empty() {
        return Err("the agent run id was empty".to_string());
    }
    validate_execution_owner(state, agent_state, request.run_id)?;
    crate::trust::require_trusted(request.project_id, crate::trust::Capability::RunCommand)?;
    let (_, decision) =
        crate::approvals::policy_for(request.root, request.project_id, "run_command")?;
    if decision == Some(crate::approvals::ToolDecision::Deny) {
        return Err("run_command is denied for this project".to_string());
    }
    state.authorize(request.project_id, request.command, request.run_id)
}

fn validate_execution_owner(
    state: &AgentExecState,
    agent_state: &crate::agent::AgentState,
    run_id: &str,
) -> Result<(), String> {
    if crate::agent::request_is_active(agent_state, run_id) {
        return Ok(());
    }
    if run_id.starts_with("external:") {
        return if state.external_owner_is_live(run_id, Instant::now())? {
            Ok(())
        } else {
            Err("the external command owner is not registered".to_string())
        };
    }
    Err("the agent run is not active".to_string())
}

fn external_owner_has_valid_syntax(run_id: &str) -> bool {
    let Some(id) = run_id.strip_prefix("external:") else {
        return false;
    };
    let bytes = id.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
        && bytes[14] == b'4'
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
}

#[tauri::command]
pub fn agent_exec_cwd(project_id: String) -> Result<String, String> {
    crate::paths::project_dir(&project_id)?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "project path is not valid UTF-8".to_string())
}

/// Keeps the start and the end of one output stream. The end, where commands
/// print their errors and summaries, gets two thirds of the room.
struct StreamCapture {
    head: Vec<u8>,
    tail: VecDeque<u8>,
    len: usize,
    head_limit: usize,
    tail_limit: usize,
}

impl StreamCapture {
    fn new(limit: usize) -> Self {
        let head_limit = limit / 3;
        Self {
            head: Vec::with_capacity(head_limit),
            tail: VecDeque::new(),
            len: 0,
            head_limit,
            tail_limit: limit - head_limit,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.len = self.len.saturating_add(bytes.len());
        let to_head = self
            .head_limit
            .saturating_sub(self.head.len())
            .min(bytes.len());
        self.head.extend_from_slice(&bytes[..to_head]);
        self.tail.extend(&bytes[to_head..]);
        let excess = self.tail.len().saturating_sub(self.tail_limit);
        self.tail.drain(..excess);
    }

    /// The stream cut to `budget` bytes (at most the capture's limit), with a
    /// note where the middle was dropped.
    fn into_bytes(self, budget: usize) -> Vec<u8> {
        let tail = Vec::from(self.tail);
        let mut out = self.head;
        if self.len <= budget {
            out.extend_from_slice(&tail);
            return out;
        }
        let keep_tail = (budget - budget / 3).min(tail.len());
        let keep_head = (budget - keep_tail).min(out.len());
        out.truncate(keep_head);
        let dropped = self.len - keep_head - keep_tail;
        out.extend_from_slice(
            format!("\n… [truncated {dropped} bytes from the middle] …\n").as_bytes(),
        );
        out.extend_from_slice(&tail[tail.len() - keep_tail..]);
        out
    }
}

async fn capture_stream<R>(reader: &mut R, capture: &mut StreamCapture)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => capture.push(&chunk[..read]),
        }
    }
}

/// Splits the output budget between stdout and stderr. A stream that fits in
/// half of it is kept whole and the other gets the rest, so a long build log
/// on stdout cannot crowd out the error printed on stderr.
fn split_output_budget(stdout_len: usize, stderr_len: usize, budget: usize) -> (usize, usize) {
    let stderr_budget = stderr_len.min(budget - stdout_len.min(budget / 2));
    (budget - stderr_budget, stderr_budget)
}

async fn execute_command(
    state: &AgentExecState,
    root: &Path,
    project_id: &str,
    cwd: &Path,
    command: String,
    run_id: &str,
    approval_token: &str,
) -> Result<ExecResult, String> {
    execute_command_with_timeout(
        state,
        ExecRequest {
            root,
            project_id,
            cwd,
            command: &command,
            run_id,
        },
        approval_token,
        EXEC_TIMEOUT,
    )
    .await
}

/// The shell that runs an agent's command. When the app knows where the
/// `oleafly` CLI is, its folder goes first on the inherited PATH and
/// `OLEAFLY_CLI` names it, so commands can call `oleafly` by name.
fn shell_command(command: &str, cli: &crate::terminal::env::CliEnv) -> tokio::process::Command {
    #[cfg(windows)]
    let mut c = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(command);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = tokio::process::Command::new(crate::program_locator::user_shell());
        c.arg("-lc").arg(command);
        crate::proc::clear_appimage_env(c.as_std_mut());
        c
    };
    if let Some(dir) = &cli.dir {
        c.env(
            "PATH",
            crate::terminal::env::prepend_path(std::env::var_os("PATH").as_deref(), dir),
        );
    }
    if let Some(exe) = &cli.exe {
        c.env("OLEAFLY_CLI", exe);
    }
    c
}

async fn execute_command_with_timeout(
    state: &AgentExecState,
    request: ExecRequest<'_>,
    approval_token: &str,
    timeout: Duration,
) -> Result<ExecResult, String> {
    let ExecRequest {
        root,
        project_id,
        cwd,
        command,
        run_id,
    } = request;
    if command.trim().is_empty() {
        return Err("the command was empty".to_string());
    }
    let mut lease = state
        .begin_execution(project_id, command, run_id, approval_token)
        .map_err(|error| {
            if approval_token.is_empty() {
                "run_command approval is required".to_string()
            } else {
                error
            }
        })?;
    if crate::approvals::effective_decision_for(root, project_id, "run_command")
        == Some(crate::approvals::ToolDecision::Deny)
    {
        return Err("run_command is denied for this project".to_string());
    }

    let mut cmd = shell_command(command, &crate::terminal::env::CliEnv::current());
    cmd.no_console()
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start command: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "failed to identify command process".to_string())?;
    let containment = match crate::proc::contain_process_tree(pid) {
        Ok(containment) => containment,
        Err(error) => {
            terminate_process(pid);
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            return Err(format!("failed to contain command process: {error}"));
        }
    };
    if let Err(error) = lease.activate(pid, containment) {
        terminate_process(pid);
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        return Err(error);
    }

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut stdout_capture = StreamCapture::new(MAX_OUTPUT_BYTES);
    let mut stderr_capture = StreamCapture::new(MAX_OUTPUT_BYTES);
    let read_streams = async {
        let read_stdout = async {
            if let Some(out) = stdout.as_mut() {
                capture_stream(out, &mut stdout_capture).await;
            }
        };
        let read_stderr = async {
            if let Some(err) = stderr.as_mut() {
                capture_stream(err, &mut stderr_capture).await;
            }
        };
        tokio::join!(read_stdout, read_stderr);
    };

    let completion = tokio::time::timeout(timeout, async {
        let (_, status) = tokio::join!(read_streams, child.wait());
        status.ok()
    })
    .await;
    let timed_out = completion.is_err();
    let status = match completion {
        Ok(status) => {
            lease.complete();
            status
        }
        Err(_) => {
            // Close the owned Job Object before waiting, so grandchildren
            // cannot outlive a timed-out command while cleanup is pending.
            lease.stop_process_tree();
            let _ = child.start_kill();
            let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
                .await
                .ok()
                .and_then(Result::ok);
            drop(lease);
            status
        }
    };

    let exit_code = status.and_then(|s| s.code());
    let truncated = stdout_capture.len.saturating_add(stderr_capture.len) > MAX_OUTPUT_BYTES;
    let (stdout_budget, stderr_budget) =
        split_output_budget(stdout_capture.len, stderr_capture.len, MAX_OUTPUT_BYTES);
    let mut combined = stdout_capture.into_bytes(stdout_budget);
    combined.extend(stderr_capture.into_bytes(stderr_budget));
    let output = String::from_utf8_lossy(&combined).into_owned();

    Ok(ExecResult {
        command: command.to_string(),
        output,
        exit_code,
        status: status_line(exit_code, timed_out),
        truncated,
        timed_out,
    })
}

async fn execute_command_for_owner(
    agent_state: &crate::agent::AgentState,
    state: &AgentExecState,
    request: ExecRequest<'_>,
    approval_token: &str,
) -> Result<ExecResult, String> {
    validate_execution_owner(state, agent_state, request.run_id)?;
    crate::trust::require_trusted(request.project_id, crate::trust::Capability::RunCommand)?;
    execute_command(
        state,
        request.root,
        request.project_id,
        request.cwd,
        request.command.to_string(),
        request.run_id,
        approval_token,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_wait;

    fn test_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("oleafly-agent-exec-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("projects/proj")).unwrap();
        root
    }

    fn exec_request<'a>(
        root: &'a Path,
        cwd: &'a Path,
        command: &'a str,
        run_id: &'a str,
    ) -> ExecRequest<'a> {
        ExecRequest {
            root,
            project_id: "proj",
            cwd,
            command,
            run_id,
        }
    }

    #[tokio::test]
    async fn run_command_gets_the_cli_folder_on_path() {
        let tools = tempfile::tempdir().unwrap();
        let exe = tools.path().join(if cfg!(windows) {
            "oleafly.exe"
        } else {
            "oleafly"
        });
        let cli = crate::terminal::env::CliEnv {
            dir: Some(tools.path().to_path_buf()),
            exe: Some(exe.clone()),
        };
        #[cfg(unix)]
        let script = "printf '%s\\n' \"$OLEAFLY_CLI\"; printf '%s\\n' \"$PATH\"";
        #[cfg(windows)]
        let script = "echo %OLEAFLY_CLI%& echo %PATH%";
        let output = shell_command(script, &cli)
            .no_console()
            .stdin(Stdio::null())
            .output()
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        let mut lines = text.lines().map(str::trim);
        assert_eq!(lines.next(), Some(exe.to_string_lossy().as_ref()), "{text}");
        let path = lines.next().unwrap_or_default();
        // A login shell may reorder PATH (macOS path_helper), so look for
        // the folder rather than insist on the first place.
        assert!(
            std::env::split_paths(path).any(|entry| entry == tools.path()),
            "{path}"
        );

        let plain = shell_command(script, &crate::terminal::env::CliEnv::default());
        let envs: Vec<_> = plain.as_std().get_envs().collect();
        assert!(envs.is_empty(), "{envs:?}");
    }

    #[tokio::test]
    async fn commands_that_close_output_still_hit_the_execution_deadline() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let cwd = root.join("projects/proj");
        std::fs::create_dir_all(&cwd).unwrap();
        let state = AgentExecState::default();
        #[cfg(unix)]
        let command = "exec >/dev/null 2>&1; sleep 10; touch finished";
        #[cfg(windows)]
        let command = "powershell -NoProfile -Command \"[Console]::Out.Close(); [Console]::Error.Close(); Start-Sleep -Seconds 10; New-Item finished\" >NUL 2>&1";
        let token = state.authorize("proj", command, "run-deadline").unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            execute_command_with_timeout(
                &state,
                exec_request(root, &cwd, command, "run-deadline"),
                &token,
                Duration::from_millis(250),
            ),
        )
        .await
        .expect("command exceeded its deadline")
        .unwrap();
        assert!(result.timed_out);
        assert_eq!(result.status, "Stopped: timed out");
        assert!(!cwd.join("finished").exists());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn restricted_folder_never_mints_or_runs_a_command() {
        let root = test_root("restricted-folder");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let owner = "external:00000000-0000-4000-8000-00000000000b";
        state.register_external_owner(owner).unwrap();
        let _restricted = crate::trust::testing::restrict("restricted-exec-proj");
        let request = || ExecRequest {
            root: &root,
            project_id: "restricted-exec-proj",
            cwd: &cwd,
            command: "touch restricted-marker",
            run_id: owner,
        };
        let minted = authorize_approved(&state, &agent_state, request());
        let token = state
            .authorize("restricted-exec-proj", "touch restricted-marker", owner)
            .unwrap();
        let ran = execute_command_for_owner(&agent_state, &state, request(), &token).await;
        let marker = cwd.join("restricted-marker").exists();
        std::fs::remove_dir_all(&root).ok();
        let minted = minted.unwrap_err();
        assert!(
            minted.contains("\"code\":\"trust.run_command\""),
            "{minted}"
        );
        let ran = ran.err().unwrap();
        assert!(ran.contains("\"code\":\"trust.run_command\""), "{ran}");
        assert!(!marker);
    }

    #[test]
    fn status_line_matches_reference_labels() {
        assert_eq!(status_line(Some(0), false), "Success");
        assert_eq!(status_line(Some(2), false), "Failed with exit code 2");
        assert_eq!(status_line(None, false), "Stopped");
        assert_eq!(status_line(Some(0), true), "Stopped: timed out");
    }

    #[test]
    fn exec_results_serialize_an_explicit_timeout_state() {
        let result = ExecResult {
            command: "true".into(),
            output: String::new(),
            exit_code: Some(0),
            status: "Success".into(),
            truncated: false,
            timed_out: false,
        };

        let value = serde_json::to_value(result).unwrap();

        assert_eq!(value["timed_out"], false);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_deny_rule_does_not_mint_an_exec_approval() {
        let root = test_root("deny-rule");
        crate::approvals::set_decision(
            &root,
            "proj",
            "run_command",
            Some(crate::approvals::ToolDecision::Deny),
        )
        .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000001")
            .unwrap();

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch denied-marker",
                "external:00000000-0000-4000-8000-000000000001",
            ),
        );
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command is denied for this project")
        );
        assert!(approvals_are_empty);
    }

    #[test]
    fn exec_approvals_expire_and_are_capped() {
        let state = AgentExecState::default();
        let now = Instant::now();

        let token = state.authorize_at("proj", "true", "run-ttl", now).unwrap();
        let expired = state.begin_execution_at(
            "proj",
            "true",
            "run-ttl",
            &token,
            now + EXEC_APPROVAL_TTL + Duration::from_secs(1),
        );
        assert!(expired.is_err());

        for index in 0..(MAX_EXEC_APPROVALS + 8) {
            state
                .authorize_at("proj", "true", &format!("run-{index}"), now)
                .unwrap();
        }
        let registry = state.registry.lock().unwrap();
        assert!(registry.approvals.len() <= MAX_EXEC_APPROVALS);
        assert_eq!(registry.approvals.len(), registry.approval_order.len());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn inactive_chat_run_does_not_mint_an_exec_approval() {
        let root = test_root("inactive-chat-run");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch inactive-marker",
                "agent:forged-session:1:00000000-0000-4000-8000-000000000000",
            ),
        );
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the agent run is not active"));
        assert!(approvals_are_empty);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn malformed_external_owner_does_not_mint_an_exec_approval() {
        let root = test_root("malformed-external-owner");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch malformed-marker", "external:forged"),
        );
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("the external command owner is not registered")
        );
        assert!(approvals_are_empty);
    }

    #[test]
    fn external_owner_registration_requires_valid_syntax() {
        let state = AgentExecState::default();
        assert!(state.register_external_owner("external:forged").is_err());
        assert!(state
            .register_external_owner("external:00000000-0000-4000-8000-00000000000a")
            .is_ok());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn unregistered_external_owner_cannot_execute_even_under_full_access() {
        let root = test_root("unregistered-under-full-access");
        crate::approvals::set_mode(&root, "proj", crate::approvals::ApprovalMode::FullAccess)
            .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "external:00000000-0000-4000-8000-000000000009";

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch escalation-marker", run_id),
        );

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("the external command owner is not registered")
        );
    }

    #[test]
    fn full_access_confirmation_only_gates_transitions_into_full_access() {
        use crate::approvals::{full_access_needs_confirmation, ApprovalMode};
        assert!(full_access_needs_confirmation(
            ApprovalMode::ApproveForMe,
            ApprovalMode::FullAccess
        ));
        assert!(full_access_needs_confirmation(
            ApprovalMode::Custom,
            ApprovalMode::FullAccess
        ));
        assert!(!full_access_needs_confirmation(
            ApprovalMode::FullAccess,
            ApprovalMode::FullAccess
        ));
        assert!(!full_access_needs_confirmation(
            ApprovalMode::FullAccess,
            ApprovalMode::ApproveForMe
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_finished_chat_run_does_not_mint_an_exec_approval() {
        let root = test_root("run-finished-before-approval");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "agent:test-session:3:00000000-0000-4000-8000-000000000005";
        let generation = crate::agent::register_active_request_for_test(&agent_state, run_id);
        crate::agent::finish_active_request_for_test(&agent_state, run_id, generation);

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch late-marker", run_id),
        );
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the agent run is not active"));
        assert!(approvals_are_empty);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn an_approved_command_mints_a_usable_token_without_a_native_prompt() {
        let root = test_root("approved-without-prompt");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000002")
            .unwrap();
        let command = if cfg!(windows) {
            "type nul > native-approved-marker"
        } else {
            "touch native-approved-marker"
        };

        let token = authorize_approved(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                command,
                "external:00000000-0000-4000-8000-000000000002",
            ),
        )
        .unwrap();
        let result = execute_command_for_owner(
            &agent_state,
            &state,
            exec_request(
                &root,
                &cwd,
                command,
                "external:00000000-0000-4000-8000-000000000002",
            ),
            &token,
        )
        .await;
        let marker_exists = cwd.join("native-approved-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.unwrap().exit_code, Some(0));
        assert!(marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn full_access_mints_a_usable_one_time_token() {
        let root = test_root("full-access-token");
        crate::approvals::set_mode(&root, "proj", crate::approvals::ApprovalMode::FullAccess)
            .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "external:00000000-0000-4000-8000-000000000006";
        state.register_external_owner(run_id).unwrap();
        let command = if cfg!(windows) {
            "type nul > full-access-marker"
        } else {
            "touch full-access-marker"
        };

        let token = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
        )
        .unwrap();
        let result = execute_command_for_owner(
            &agent_state,
            &state,
            exec_request(&root, &cwd, command, run_id),
            &token,
        )
        .await;
        let marker_exists = cwd.join("full-access-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.unwrap().exit_code, Some(0));
        assert!(marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_deny_rule_refuses_run_command_under_full_access() {
        let root = test_root("full-access-deny");
        crate::approvals::set_mode(&root, "proj", crate::approvals::ApprovalMode::FullAccess)
            .unwrap();
        crate::approvals::set_decision(
            &root,
            "proj",
            "run_command",
            Some(crate::approvals::ToolDecision::Deny),
        )
        .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "external:00000000-0000-4000-8000-00000000000c";
        state.register_external_owner(run_id).unwrap();
        let command = if cfg!(windows) {
            "type nul > full-access-denied-marker"
        } else {
            "touch full-access-denied-marker"
        };

        let minted = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
        );
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();
        let token = state.authorize("proj", command, run_id).unwrap();
        let ran = execute_command_for_owner(
            &agent_state,
            &state,
            exec_request(&root, &cwd, command, run_id),
            &token,
        )
        .await;
        let marker_exists = cwd.join("full-access-denied-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            minted.err().as_deref(),
            Some("run_command is denied for this project")
        );
        assert!(approvals_are_empty);
        assert_eq!(
            ran.err().as_deref(),
            Some("run_command is denied for this project")
        );
        assert!(!marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn custom_allow_mints_a_token() {
        let root = test_root("custom-allow-token");
        crate::approvals::set_decision(
            &root,
            "proj",
            "run_command",
            Some(crate::approvals::ToolDecision::Allow),
        )
        .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000007")
            .unwrap();

        let result = authorize_approved(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch custom-allow-marker",
                "external:00000000-0000-4000-8000-000000000007",
            ),
        );

        std::fs::remove_dir_all(&root).ok();
        assert!(result.is_ok());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn active_chat_run_can_authorize_and_execute() {
        let root = test_root("active-chat-run");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "agent:test-session:1:00000000-0000-4000-8000-000000000003";
        let generation = crate::agent::register_active_request_for_test(&agent_state, run_id);
        let command = if cfg!(windows) {
            "type nul > active-marker"
        } else {
            "touch active-marker"
        };

        let token = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
        )
        .unwrap();
        let result = execute_command_for_owner(
            &agent_state,
            &state,
            exec_request(&root, &cwd, command, run_id),
            &token,
        )
        .await;
        crate::agent::finish_active_request_for_test(&agent_state, run_id, generation);
        let marker_exists = cwd.join("active-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.unwrap().exit_code, Some(0));
        assert!(marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn approval_token_cannot_execute_after_chat_run_finishes() {
        let root = test_root("finished-chat-run");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "agent:test-session:2:00000000-0000-4000-8000-000000000004";
        let generation = crate::agent::register_active_request_for_test(&agent_state, run_id);
        let command = if cfg!(windows) {
            "type nul > finished-marker"
        } else {
            "touch finished-marker"
        };
        let token = authorize_approved(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
        )
        .unwrap();

        crate::agent::finish_active_request_for_test(&agent_state, run_id, generation);
        let result = execute_command_for_owner(
            &agent_state,
            &state,
            exec_request(&root, &cwd, command, run_id),
            &token,
        )
        .await;
        let marker_exists = cwd.join("finished-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the agent run is not active"));
        assert!(!marker_exists);
    }

    #[tokio::test]
    async fn rejects_empty_commands() {
        let state = AgentExecState::default();
        let root = test_root("empty");
        let cwd = root.join("projects/proj");
        let result = execute_command(&state, &root, "proj", &cwd, "   ".into(), "run-1", "").await;
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the command was empty"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn persisted_deny_prevents_command_execution() {
        let root = test_root("deny");
        crate::approvals::set_decision(
            &root,
            "proj",
            "run_command",
            Some(crate::approvals::ToolDecision::Deny),
        )
        .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let token = state
            .authorize("proj", "touch denied-marker", "run-deny")
            .unwrap();

        let result = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            "touch denied-marker".into(),
            "run-deny",
            &token,
        )
        .await;
        let marker_exists = root.join("projects/proj/denied-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command is denied for this project")
        );
        assert!(!marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn execution_requires_a_one_time_approval() {
        let root = test_root("approval-required");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();

        let result = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            "touch unapproved-marker".into(),
            "run-unapproved",
            "",
        )
        .await;
        let marker_exists = cwd.join("unapproved-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command approval is required")
        );
        assert!(!marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn arbitrary_approval_tokens_are_rejected() {
        let root = test_root("forged-approval");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();

        let result = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            "touch forged-marker".into(),
            "run-forged",
            "forged-token",
        )
        .await;
        let marker_exists = cwd.join("forged-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command approval is invalid or already used")
        );
        assert!(!marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn approvals_are_bound_to_project_command_and_run() {
        let root = test_root("approval-binding");
        std::fs::create_dir_all(root.join("projects/other")).unwrap();
        let project = root.join("projects/proj");
        let other = root.join("projects/other");
        let state = AgentExecState::default();

        let project_token = state
            .authorize("proj", "touch project-marker", "run-1")
            .unwrap();
        let project_result = execute_command(
            &state,
            &root,
            "other",
            &other,
            "touch project-marker".into(),
            "run-1",
            &project_token,
        )
        .await;

        let command_token = state
            .authorize("proj", "touch approved-marker", "run-2")
            .unwrap();
        let command_result = execute_command(
            &state,
            &root,
            "proj",
            &project,
            "touch command-marker".into(),
            "run-2",
            &command_token,
        )
        .await;

        let run_token = state
            .authorize("proj", "touch run-marker", "run-3")
            .unwrap();
        let run_result = execute_command(
            &state,
            &root,
            "proj",
            &project,
            "touch run-marker".into(),
            "run-other",
            &run_token,
        )
        .await;

        let burned_result = execute_command(
            &state,
            &root,
            "proj",
            &project,
            "touch project-marker".into(),
            "run-1",
            &project_token,
        )
        .await;

        let markers_exist = other.join("project-marker").exists()
            || project.join("command-marker").exists()
            || project.join("run-marker").exists();
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            project_result.err().as_deref(),
            Some("run_command approval does not match this execution")
        );
        assert_eq!(
            command_result.err().as_deref(),
            Some("run_command approval does not match this execution")
        );
        assert_eq!(
            run_result.err().as_deref(),
            Some("run_command approval does not match this execution")
        );
        assert_eq!(
            burned_result.err().as_deref(),
            Some("run_command approval is invalid or already used")
        );
        assert!(!markers_exist);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn approval_tokens_can_execute_only_once() {
        let root = test_root("approval-replay");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let command = if cfg!(windows) {
            "type nul > approved-once"
        } else {
            "touch approved-once"
        };
        let token = state.authorize("proj", command, "run-once").unwrap();

        let first = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            command.into(),
            "run-once",
            &token,
        )
        .await;
        let second = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            command.into(),
            "run-once",
            &token,
        )
        .await;
        let marker_exists = cwd.join("approved-once").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(first.unwrap().exit_code, Some(0));
        assert_eq!(
            second.err().as_deref(),
            Some("run_command approval is invalid or already used")
        );
        assert!(marker_exists);
    }

    #[cfg(unix)]
    fn command_with_a_background_child() -> String {
        format!(
            "sleep {} & printf '%s' \"$!\" > child.pid; wait",
            (2 * test_wait::CHILD_PATIENCE).as_secs()
        )
    }

    #[cfg(unix)]
    async fn background_child(cwd: &Path) -> i32 {
        test_wait::read_until(
            &cwd.join("child.pid"),
            test_wait::CHILD_PATIENCE,
            test_wait::pid,
        )
        .await
        .expect("the command must record its background child's process id")
    }

    #[cfg(unix)]
    async fn stopped_or_killed(pid: i32) -> bool {
        let stopped = tokio::time::timeout(test_wait::CHILD_PATIENCE, async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .is_ok();
        if !stopped {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        stopped
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_a_run_kills_its_command_process_group() {
        let root = test_root("cancel-process-group");
        let cwd = root.join("projects/proj");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = command_with_a_background_child();
        let token = state.authorize("proj", &command, "run-cancel").unwrap();
        let task_state = std::sync::Arc::clone(&state);
        let task_root = root.clone();
        let task_cwd = cwd.clone();
        let task = tokio::spawn(async move {
            execute_command(
                task_state.as_ref(),
                &task_root,
                "proj",
                &task_cwd,
                command,
                "run-cancel",
                &token,
            )
            .await
        });

        let child = background_child(&cwd).await;
        cancel_run(state.as_ref(), "run-cancel");
        let finished = tokio::time::timeout(test_wait::CHILD_PATIENCE, task)
            .await
            .is_ok();
        let stopped = stopped_or_killed(child).await;

        std::fs::remove_dir_all(&root).ok();
        assert!(finished, "cancelled command did not stop");
        assert!(
            stopped,
            "the command's background child outlived the cancel"
        );
    }

    #[cfg(windows)]
    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_a_run_kills_its_windows_job_descendants() {
        let root = test_root("cancel-windows-job");
        let cwd = root.join("projects/proj");
        let started = cwd.join("started-marker");
        let completed = cwd.join("completed-marker");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = "type nul > started-marker & start \"\" /B cmd /D /S /C \"ping -n 3 127.0.0.1 >NUL & type nul > completed-marker\" & ping -n 30 127.0.0.1 >NUL";
        let token = state.authorize("proj", command, "run-cancel").unwrap();
        let task_state = std::sync::Arc::clone(&state);
        let task_root = root.clone();
        let task_cwd = cwd.clone();
        let task = tokio::spawn(async move {
            execute_command(
                task_state.as_ref(),
                &task_root,
                "proj",
                &task_cwd,
                command.into(),
                "run-cancel",
                &token,
            )
            .await
        });

        let deadline = tokio::time::Instant::now() + test_wait::CHILD_PATIENCE;
        while !started.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cancel_run(state.as_ref(), "run-cancel");
        let _ = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("cancelled command did not stop");
        tokio::time::sleep(Duration::from_secs(3)).await;
        let started_exists = started.exists();
        let completed_exists = completed.exists();

        std::fs::remove_dir_all(&root).ok();
        assert!(started_exists);
        assert!(!completed_exists);
    }

    #[test]
    fn cancelling_a_run_invalidates_pending_and_late_approvals() {
        let state = AgentExecState::default();
        let token = state.authorize("proj", "true", "run-cancelled").unwrap();

        cancel_run(&state, "run-cancelled");
        let pending = state.begin_execution("proj", "true", "run-cancelled", &token);
        let late = state.authorize("proj", "true", "run-cancelled");

        assert_eq!(
            pending.err().as_deref(),
            Some("run_command approval is invalid or already used")
        );
        assert_eq!(late.err().as_deref(), Some("the agent run was cancelled"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancel_wait_reaps_a_command_after_an_earlier_cancel_request() {
        let root = test_root("cancel-wait-reap");
        let cwd = root.join("projects/proj");
        let started = cwd.join("started-reap");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = "touch started-reap; sleep 30";
        let token = state.authorize("proj", command, "run-reap").unwrap();
        let task_state = state.clone();
        let task_root = root.clone();
        let task = tokio::spawn(async move {
            execute_command(
                &task_state,
                &task_root,
                "proj",
                &cwd,
                command.into(),
                "run-reap",
                &token,
            )
            .await
        });
        tokio::time::timeout(test_wait::CHILD_PATIENCE, async {
            while !started.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid = state.registry.lock().unwrap().active["run-reap"]
            .values()
            .next()
            .unwrap()
            .pid
            .unwrap();
        cancel_run(&state, "run-reap");
        tokio::time::timeout(
            Duration::from_secs(3),
            cancel_run_and_wait(&state, "run-reap"),
        )
        .await
        .unwrap();
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert!(!state
            .registry
            .lock()
            .unwrap()
            .completions
            .contains_key("run-reap"));
        task.await.unwrap().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_all_runs_kills_active_commands() {
        let root = test_root("cancel-all-processes");
        let cwd = root.join("projects/proj");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = command_with_a_background_child();
        let token = state.authorize("proj", &command, "run-all").unwrap();
        let task_state = std::sync::Arc::clone(&state);
        let task_root = root.clone();
        let task_cwd = cwd.clone();
        let task = tokio::spawn(async move {
            execute_command(
                task_state.as_ref(),
                &task_root,
                "proj",
                &task_cwd,
                command,
                "run-all",
                &token,
            )
            .await
        });

        let child = background_child(&cwd).await;
        cancel_all(state.as_ref());
        let finished = tokio::time::timeout(test_wait::CHILD_PATIENCE, task)
            .await
            .is_ok();
        let stopped = stopped_or_killed(child).await;

        std::fs::remove_dir_all(&root).ok();
        assert!(finished, "cancelled command did not stop");
        assert!(
            stopped,
            "the command's background child outlived the cancel"
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn completing_an_exec_lease_does_not_kill_the_registered_process() {
        let state = AgentExecState::default();
        let token = state.authorize("proj", "sleep", "run-complete").unwrap();
        let mut lease = state
            .begin_execution("proj", "sleep", "run-complete", &token)
            .unwrap();
        let mut command = tokio::process::Command::new("/bin/sh");
        command.no_console().arg("-c").arg("sleep 2");
        crate::proc::isolate_process_tree(&mut command);
        let mut child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let containment = crate::proc::contain_process_tree(pid).unwrap();
        lease.activate(pid, containment).unwrap();

        lease.complete();
        drop(lease);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let still_running = child.try_wait().unwrap().is_none();
        terminate_process(pid);
        let _ = child.wait().await;

        assert!(still_running);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stream_collection_drains_input_while_retaining_only_the_cap() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, mut reader) = tokio::io::duplex(1024);
        let write = tokio::spawn(async move {
            let chunk = [b'x'; 1024];
            for _ in 0..64 {
                writer.write_all(&chunk).await.unwrap();
            }
        });

        let mut capture = StreamCapture::new(1024);
        capture_stream(&mut reader, &mut capture).await;
        write.await.unwrap();

        assert_eq!(capture.len, 64 * 1024);
        assert_eq!(capture.head.len() + capture.tail.len(), 1024);
    }

    #[test]
    fn a_long_stream_keeps_its_start_and_end() {
        let mut capture = StreamCapture::new(300);
        capture.push(b"START");
        for _ in 0..100 {
            capture.push(&[b'x'; 100]);
        }
        capture.push(b"END");

        let text = String::from_utf8(capture.into_bytes(300)).unwrap();

        assert!(text.starts_with("START"), "{text}");
        assert!(text.ends_with("END"), "{text}");
        assert!(
            text.contains("[truncated 9708 bytes from the middle]"),
            "{text}"
        );
    }

    #[test]
    fn a_stream_within_its_budget_is_kept_whole() {
        let stream = b"0123456789".repeat(25);
        let mut capture = StreamCapture::new(300);
        for chunk in stream.chunks(7) {
            capture.push(chunk);
        }

        assert_eq!(capture.into_bytes(300), stream);
    }

    #[test]
    fn a_short_stream_keeps_all_of_its_share_of_the_output() {
        // A long build log on stdout must not crowd out the error on stderr.
        assert_eq!(split_output_budget(1_000, 40, 100), (60, 40));
        assert_eq!(split_output_budget(40, 1_000, 100), (40, 60));
        assert_eq!(split_output_budget(1_000, 1_000, 100), (50, 50));
        assert_eq!(split_output_budget(30, 40, 100), (60, 40));
    }

    #[cfg(not(windows))]
    #[tokio::test(flavor = "current_thread")]
    async fn oversized_stdout_keeps_its_end_and_stderr() {
        let root = test_root("oversized-output");
        let cwd = root.join("projects/proj");
        let command = "head -c 307200 /dev/zero | tr '\\0' x; printf 'stdout-end\\n'; printf 'fatal: boom\\n' >&2; exit 3";
        let state = AgentExecState::default();
        let token = state.authorize("proj", command, "run-oversized").unwrap();

        let result = execute_command(
            &state,
            &root,
            "proj",
            &cwd,
            command.into(),
            "run-oversized",
            &token,
        )
        .await;

        std::fs::remove_dir_all(&root).ok();
        let exec = result.unwrap();
        let skip = exec.output.chars().count().saturating_sub(200);
        let end: String = exec.output.chars().skip(skip).collect();
        assert!(exec.truncated);
        assert_eq!(exec.exit_code, Some(3));
        assert!(exec.output.starts_with("xxx"));
        assert!(exec.output.contains("stdout-end\n"), "{end:?}");
        assert!(exec.output.ends_with("fatal: boom\n"), "{end:?}");
        assert!(exec.output.len() <= MAX_OUTPUT_BYTES + 100);
    }

    #[cfg(not(windows))]
    #[tokio::test(flavor = "current_thread")]
    async fn stderr_flood_does_not_block_stdout_collection() {
        let root = test_root("stderr-flood");
        let cwd = root.join("projects/proj");
        let command = "(sleep 4; kill -TERM $$) </dev/null >/dev/null 2>&1 & watchdog=$!; dd if=/dev/zero bs=1024 count=128 1>&2 2>/dev/null; printf stdout-done; kill \"$watchdog\" 2>/dev/null; wait \"$watchdog\" 2>/dev/null || true";
        let state = AgentExecState::default();
        let token = state.authorize("proj", command, "run-flood").unwrap();

        let result = tokio::time::timeout(
            test_wait::CHILD_PATIENCE,
            execute_command(
                &state,
                &root,
                "proj",
                &cwd,
                command.into(),
                "run-flood",
                &token,
            ),
        )
        .await;

        std::fs::remove_dir_all(&root).ok();
        let exec = result
            .expect("stderr flood blocked command completion")
            .unwrap();
        // A blocked collection shows up here: the fixture's 4 s watchdog ends
        // the shell before it prints.
        assert!(
            exec.output.contains("stdout-done"),
            "stderr flood blocked stdout collection: {:?}",
            exec.output
        );
        assert!(!exec.truncated);
    }
}
