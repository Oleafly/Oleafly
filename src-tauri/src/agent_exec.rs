use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::io::AsyncReadExt;

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
    }
}

impl Drop for ExecLease<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let process = match self.unregister() {
            UnregisterResult::Removed(process) => process.and_then(|entry| entry.pid),
            UnregisterResult::RegistryUnavailable => self.pid,
        };
        if let Some(pid) = process {
            terminate_process(pid);
        }
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
    app: tauri::AppHandle,
    state: State<'_, AgentExecState>,
    agent_state: State<'_, crate::agent::AgentState>,
    project_id: String,
    command: String,
    run_id: String,
) -> Result<String, String> {
    let cwd = crate::paths::project_dir(&project_id)?;
    let root = crate::paths::oleafly_root()?;
    authorize_after_confirmation(
        state.inner(),
        agent_state.inner(),
        ExecRequest {
            root: &root,
            project_id: &project_id,
            cwd: &cwd,
            command: &command,
            run_id: &run_id,
        },
        move |message| native_exec_confirmation(app, message),
    )
    .await
}

async fn authorize_after_confirmation<F, Fut>(
    state: &AgentExecState,
    agent_state: &crate::agent::AgentState,
    request: ExecRequest<'_>,
    confirm: F,
) -> Result<String, String>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    if request.command.trim().is_empty() {
        return Err("the command was empty".to_string());
    }
    if request.run_id.trim().is_empty() {
        return Err("the agent run id was empty".to_string());
    }
    validate_execution_owner(state, agent_state, request.run_id)?;
    let (mode, decision) =
        crate::approvals::policy_for(request.root, request.project_id, "run_command")?;
    if decision == Some(crate::approvals::ToolDecision::Deny) {
        return Err("run_command is denied for this project".to_string());
    }
    let needs_confirmation = mode != crate::approvals::ApprovalMode::FullAccess
        && decision != Some(crate::approvals::ToolDecision::Allow);
    if needs_confirmation {
        let message = format!(
            "The assistant wants to run this command:\n\n{}\n\nWorking directory:\n\n{}\n\nRun this command?",
            request.command,
            request.cwd.display()
        );
        if !confirm(message).await? {
            return Err("run_command approval was declined".to_string());
        }
    }
    validate_execution_owner(state, agent_state, request.run_id)?;
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

async fn native_exec_confirmation(app: tauri::AppHandle, message: String) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title("Approve shell command")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Run command".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    receiver
        .await
        .map_err(|_| "the native approval dialog closed unexpectedly".to_string())
}

#[tauri::command]
pub fn agent_exec_cwd(project_id: String) -> Result<String, String> {
    crate::paths::project_dir(&project_id)?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "project path is not valid UTF-8".to_string())
}

async fn read_stream_bounded<R>(reader: &mut R, retained: &mut Vec<u8>, limit: usize)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let retained_limit = limit.saturating_add(1);
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = retained_limit.saturating_sub(retained.len());
                if remaining > 0 {
                    retained.extend_from_slice(&chunk[..read.min(remaining)]);
                }
            }
        }
    }
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
    if command.trim().is_empty() {
        return Err("the command was empty".to_string());
    }
    let mut lease = state
        .begin_execution(project_id, &command, run_id, approval_token)
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

    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut c = tokio::process::Command::new(shell);
        c.arg("-lc").arg(&command);
        c
    };
    cmd.current_dir(cwd)
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
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!("failed to contain command process: {error}"));
        }
    };
    if let Err(error) = lease.activate(pid, containment) {
        terminate_process(pid);
        let _ = child.wait().await;
        return Err(error);
    }

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut stdout_bytes = Vec::with_capacity(MAX_OUTPUT_BYTES + 1);
    let mut stderr_bytes = Vec::with_capacity(MAX_OUTPUT_BYTES + 1);
    let read_streams = async {
        let read_stdout = async {
            if let Some(out) = stdout.as_mut() {
                read_stream_bounded(out, &mut stdout_bytes, MAX_OUTPUT_BYTES).await;
            }
        };
        let read_stderr = async {
            if let Some(err) = stderr.as_mut() {
                read_stream_bounded(err, &mut stderr_bytes, MAX_OUTPUT_BYTES).await;
            }
        };
        tokio::join!(read_stdout, read_stderr);
    };

    let mut timed_out = false;
    let status = tokio::select! {
        _ = read_streams => child.wait().await.ok(),
        _ = tokio::time::sleep(EXEC_TIMEOUT) => {
            timed_out = true;
            terminate_process(pid);
            child.wait().await.ok()
        }
    };
    if timed_out {
        drop(lease);
    } else {
        lease.complete();
    }

    let exit_code = status.and_then(|s| s.code());
    let mut combined = stdout_bytes;
    combined.extend(stderr_bytes);
    let truncated = combined.len() > MAX_OUTPUT_BYTES;
    if truncated {
        combined.truncate(MAX_OUTPUT_BYTES);
    }
    let mut output = String::from_utf8_lossy(&combined).to_string();
    if truncated {
        output.push_str("\n… output truncated");
    }

    Ok(ExecResult {
        command,
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
    async fn native_denial_does_not_mint_an_exec_approval() {
        let root = test_root("native-deny");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000001")
            .unwrap();

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch denied-marker",
                "external:00000000-0000-4000-8000-000000000001",
            ),
            |_| async { Ok(false) },
        )
        .await;
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("run_command approval was declined")
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
    async fn inactive_chat_run_does_not_prompt_or_mint_an_exec_approval() {
        let root = test_root("inactive-chat-run");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let prompt_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = std::sync::Arc::clone(&prompt_count);

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch inactive-marker",
                "agent:forged-session:1:00000000-0000-4000-8000-000000000000",
            ),
            move |_| async move {
                observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(true)
            },
        )
        .await;
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the agent run is not active"));
        assert_eq!(prompt_count.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(approvals_are_empty);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn malformed_external_owner_does_not_prompt_or_mint_an_exec_approval() {
        let root = test_root("malformed-external-owner");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let prompt_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = std::sync::Arc::clone(&prompt_count);

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch malformed-marker", "external:forged"),
            move |_| async move {
                observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(true)
            },
        )
        .await;
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            result.err().as_deref(),
            Some("the external command owner is not registered")
        );
        assert_eq!(prompt_count.load(std::sync::atomic::Ordering::SeqCst), 0);
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

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch escalation-marker", run_id),
            |_| async { Ok(true) },
        )
        .await;

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
    async fn chat_run_finishing_during_confirmation_does_not_mint_an_exec_approval() {
        let root = test_root("run-finished-during-confirmation");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let run_id = "agent:test-session:3:00000000-0000-4000-8000-000000000005";
        let generation = crate::agent::register_active_request_for_test(&agent_state, run_id);

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, "touch late-marker", run_id),
            |_| {
                crate::agent::finish_active_request_for_test(&agent_state, run_id, generation);
                async { Ok(true) }
            },
        )
        .await;
        let approvals_are_empty = state.registry.lock().unwrap().approvals.is_empty();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(result.err().as_deref(), Some("the agent run is not active"));
        assert!(approvals_are_empty);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn native_approval_displays_the_execution_and_mints_a_usable_token() {
        let root = test_root("native-allow");
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let prompt = std::sync::Arc::new(std::sync::Mutex::new(None));
        let observed = std::sync::Arc::clone(&prompt);
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000002")
            .unwrap();
        let command = if cfg!(windows) {
            "type nul > native-approved-marker"
        } else {
            "touch native-approved-marker"
        };

        let token = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                command,
                "external:00000000-0000-4000-8000-000000000002",
            ),
            move |message| async move {
                *observed.lock().unwrap() = Some(message);
                Ok(true)
            },
        )
        .await
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
        let expected = format!(
            "The assistant wants to run this command:\n\n{command}\n\nWorking directory:\n\n{}\n\nRun this command?",
            cwd.display()
        );
        let marker_exists = cwd.join("native-approved-marker").exists();

        std::fs::remove_dir_all(&root).ok();
        assert_eq!(prompt.lock().unwrap().as_deref(), Some(expected.as_str()));
        assert_eq!(result.unwrap().exit_code, Some(0));
        assert!(marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn full_access_mints_a_usable_one_time_token_without_native_confirmation() {
        let root = test_root("full-access-token");
        crate::approvals::set_mode(&root, "proj", crate::approvals::ApprovalMode::FullAccess)
            .unwrap();
        let cwd = root.join("projects/proj");
        let state = AgentExecState::default();
        let agent_state = crate::agent::AgentState::default();
        let prompt_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = std::sync::Arc::clone(&prompt_count);
        let run_id = "external:00000000-0000-4000-8000-000000000006";
        state.register_external_owner(run_id).unwrap();
        let command = if cfg!(windows) {
            "type nul > full-access-marker"
        } else {
            "touch full-access-marker"
        };

        let token = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
            move |_| async move {
                observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(true)
            },
        )
        .await
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
        assert_eq!(prompt_count.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(result.unwrap().exit_code, Some(0));
        assert!(marker_exists);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn custom_allow_mints_a_token_without_native_confirmation() {
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
        let prompt_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        state
            .register_external_owner("external:00000000-0000-4000-8000-000000000007")
            .unwrap();
        let observed = std::sync::Arc::clone(&prompt_count);

        let result = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(
                &root,
                &cwd,
                "touch custom-allow-marker",
                "external:00000000-0000-4000-8000-000000000007",
            ),
            move |_| async move {
                observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(true)
            },
        )
        .await;

        std::fs::remove_dir_all(&root).ok();
        assert!(result.is_ok());
        assert_eq!(prompt_count.load(std::sync::atomic::Ordering::SeqCst), 0);
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

        let token = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
            |_| async { Ok(true) },
        )
        .await
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
        let token = authorize_after_confirmation(
            &state,
            &agent_state,
            exec_request(&root, &cwd, command, run_id),
            |_| async { Ok(true) },
        )
        .await
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
        let command = "touch approved-once";
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
        assert!(first.is_ok());
        assert_eq!(
            second.err().as_deref(),
            Some("run_command approval is invalid or already used")
        );
        assert!(marker_exists);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_a_run_kills_its_command_process_group() {
        let root = test_root("cancel-process-group");
        let cwd = root.join("projects/proj");
        let started = cwd.join("started-marker");
        let completed = cwd.join("completed-marker");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = "touch started-marker; (sleep 0.4; touch completed-marker) & wait";
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

        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while !started.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cancel_run(state.as_ref(), "run-cancel");
        let _ = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("cancelled command did not stop");
        tokio::time::sleep(Duration::from_millis(500)).await;
        let started_exists = started.exists();
        let completed_exists = completed.exists();

        std::fs::remove_dir_all(&root).ok();
        assert!(started_exists);
        assert!(!completed_exists);
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

        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
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
    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_all_runs_kills_active_commands() {
        let root = test_root("cancel-all-processes");
        let cwd = root.join("projects/proj");
        let started = cwd.join("started-all-marker");
        let completed = cwd.join("completed-all-marker");
        let state = std::sync::Arc::new(AgentExecState::default());
        let command = "touch started-all-marker; (sleep 0.4; touch completed-all-marker) & wait";
        let token = state.authorize("proj", command, "run-all").unwrap();
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
                "run-all",
                &token,
            )
            .await
        });

        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while !started.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cancel_all(state.as_ref());
        let _ = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("cancelled command did not stop");
        tokio::time::sleep(Duration::from_millis(500)).await;
        let started_exists = started.exists();
        let completed_exists = completed.exists();

        std::fs::remove_dir_all(&root).ok();
        assert!(started_exists);
        assert!(!completed_exists);
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
        command.arg("-c").arg("sleep 2");
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

        let mut retained = Vec::new();
        read_stream_bounded(&mut reader, &mut retained, 1024).await;
        write.await.unwrap();

        assert_eq!(retained.len(), 1025);
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
            Duration::from_secs(2),
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
        assert!(exec.output.contains("stdout-done"));
        assert!(!exec.truncated);
    }
}
