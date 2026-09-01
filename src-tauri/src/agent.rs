use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use futures_util::future::AbortHandle;
#[cfg(test)]
use futures_util::future::Abortable;
use oleafly_agent::{
    AgentEvent, CompletionRequest, CompletionResponse, ProviderConfig, RunConfig, ToolOutput,
};
use tauri::{Manager, State};

use crate::config::AppConfig;

mod registry;
mod subagents;
use registry::{acquire_request_slot, cancel_all_requests, cancel_request, run_registered};
#[cfg(test)]
use registry::{begin_request, finish_request};
pub use subagents::SubagentManager;

const MAX_EARLY_CANCELLATIONS: usize = 256;
const MAX_RUN_STEPS: u32 = 50;
const MAX_RUN_RETRIES: u32 = 4;
const MIN_RETRY_BASE_MS: u64 = 100;
const MAX_RETRY_BASE_MS: u64 = 10_000;
const MAX_TOOL_EXECUTION_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_CONCURRENT_AGENT_REQUESTS: usize = 8;

fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct ActiveRequest {
    generation: u64,
    handle: AbortHandle,
}

struct PendingTool {
    generation: u64,
    sender: tokio::sync::oneshot::Sender<ToolOutput>,
    tool_name: String,
    project_id: Option<String>,
}

struct RunResource<T> {
    generation: u64,
    value: T,
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, ActiveRequest>,
    early_cancellations: VecDeque<String>,
    next_generation: u64,
    session_id: Option<String>,
}

pub struct AgentState {
    client: Mutex<Option<reqwest::Client>>,
    requests: Mutex<RequestRegistry>,
    pending_tools: Mutex<HashMap<String, PendingTool>>,
    request_slots: std::sync::Arc<tokio::sync::Semaphore>,
    /// Steer senders and cancellation tokens for in-flight runs; registered
    /// at run start, cleaned up at run end and on cancel.
    steer_senders: Mutex<HashMap<String, RunResource<oleafly_agent::SteerHandle>>>,
    run_tokens: Mutex<HashMap<String, RunResource<oleafly_agent::CancellationToken>>>,
    run_projects: Mutex<HashMap<String, RunResource<Option<String>>>>,
    run_tools: Mutex<HashMap<String, RunResource<HashSet<String>>>>,
    /// Per-run subagent managers, so "stop all subagents" can reach the
    /// children without stopping the parent run.
    subagent_managers: Mutex<HashMap<String, RunResource<std::sync::Arc<SubagentManager>>>>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
            requests: Mutex::new(RequestRegistry::default()),
            pending_tools: Mutex::new(HashMap::new()),
            request_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(
                MAX_CONCURRENT_AGENT_REQUESTS,
            )),
            steer_senders: Mutex::new(HashMap::new()),
            run_tokens: Mutex::new(HashMap::new()),
            run_projects: Mutex::new(HashMap::new()),
            run_tools: Mutex::new(HashMap::new()),
            subagent_managers: Mutex::new(HashMap::new()),
        }
    }
}

impl AgentState {
    fn client(&self) -> Result<reqwest::Client, String> {
        let mut slot = lock_or_recover(&self.client);
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = oleafly_agent::build_client().map_err(tagged)?;
        *slot = Some(client.clone());
        Ok(client)
    }
}

pub(crate) fn request_is_active(state: &AgentState, request_id: &str) -> bool {
    lock_or_recover(&state.requests)
        .active
        .contains_key(request_id)
}

pub(crate) fn request_owns_project(state: &AgentState, request_id: &str, project_id: &str) -> bool {
    let generation = lock_or_recover(&state.requests)
        .active
        .get(request_id)
        .map(|request| request.generation);
    let projects = lock_or_recover(&state.run_projects);
    generation.is_some_and(|generation| {
        projects.get(request_id).is_some_and(|project| {
            project.generation == generation && project.value.as_deref() == Some(project_id)
        })
    })
}

#[cfg(test)]
pub(crate) fn request_allows_tool(
    state: &AgentState,
    request_id: &str,
    project_id: &str,
    tool_name: &str,
) -> bool {
    request_tool_generation(state, request_id, project_id, tool_name).is_some()
}

pub(crate) fn request_tool_generation(
    state: &AgentState,
    request_id: &str,
    project_id: &str,
    tool_name: &str,
) -> Option<u64> {
    let generation = lock_or_recover(&state.requests)
        .active
        .get(request_id)
        .map(|request| request.generation);
    generation.filter(|generation| {
        let owns_project = lock_or_recover(&state.run_projects)
            .get(request_id)
            .is_some_and(|project| {
                project.generation == *generation && project.value.as_deref() == Some(project_id)
            });
        owns_project
            && lock_or_recover(&state.run_tools)
                .get(request_id)
                .is_some_and(|tools| {
                    tools.generation == *generation && tools.value.contains(tool_name)
                })
    })
}

#[cfg(test)]
pub(crate) fn register_active_request_for_test(state: &AgentState, request_id: &str) -> u64 {
    begin_request(state, request_id)
        .expect("test request must register")
        .0
}

#[cfg(test)]
pub(crate) fn register_run_project_for_test(
    state: &AgentState,
    request_id: &str,
    generation: u64,
    project_id: &str,
) {
    lock_or_recover(&state.run_projects).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: Some(project_id.to_string()),
        },
    );
}

#[cfg(test)]
pub(crate) fn register_run_tools_for_test(
    state: &AgentState,
    request_id: &str,
    generation: u64,
    tools: impl IntoIterator<Item = String>,
) {
    lock_or_recover(&state.run_tools).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: tools.into_iter().collect(),
        },
    );
}

#[cfg(test)]
pub(crate) fn finish_active_request_for_test(
    state: &AgentState,
    request_id: &str,
    generation: u64,
) {
    remove_run_resource(&state.run_projects, request_id, generation);
    remove_run_resource(&state.run_tools, request_id, generation);
    finish_request(state, request_id, generation);
}

pub fn provider_config(cfg: &AppConfig) -> ProviderConfig {
    ProviderConfig {
        provider: cfg.ai_provider.clone(),
        model: cfg.ai_model.clone(),
        legacy_key: cfg.ai_api_key.clone(),
        keys: cfg
            .ai_keys
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        enabled_models: cfg
            .ai_provider_models
            .iter()
            .map(|(provider, models)| {
                (
                    provider.clone(),
                    models
                        .iter()
                        .filter(|model| model.enabled && !model.id.trim().is_empty())
                        .map(|model| model.id.clone())
                        .collect(),
                )
            })
            .collect(),
        custom: cfg
            .ai_custom_providers
            .iter()
            .map(|c| oleafly_agent::CustomProvider {
                id: c.id.clone(),
                base_url: c.base_url.clone(),
                key_optional: c.key_optional,
            })
            .collect(),
    }
}

#[derive(serde::Deserialize)]
pub struct ProviderOverride {
    pub provider_id: String,
    #[serde(default)]
    pub model_id: String,
}

fn tagged(error: oleafly_agent::AgentError) -> String {
    format!("[{}] {error}", error.kind())
}

async fn resolve_off_thread(
    provider_override: Option<ProviderOverride>,
) -> Result<oleafly_agent::Resolved, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_for(provider_override))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_complete(
    state: State<'_, AgentState>,
    request_id: String,
    request: CompletionRequest,
    provider_override: Option<ProviderOverride>,
) -> Result<CompletionResponse, String> {
    let agent_state = state.inner();
    run_registered(agent_state, &request_id, |_| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        oleafly_agent::complete(&client, &resolved, &request)
            .await
            .map_err(tagged)
    })
    .await
}

#[tauri::command]
pub fn agent_cancel_all(
    state: State<'_, AgentState>,
    exec_state: State<'_, crate::agent_exec::AgentExecState>,
    session_id: String,
) {
    crate::agent_exec::cancel_all(exec_state.inner());
    // Cancel every run token first so in-flight tools (including subagent
    // children sharing the token) wind down before their futures drop.
    let tokens: Vec<_> = {
        let mut tokens = lock_or_recover(&state.run_tokens);
        tokens.drain().map(|(_, token)| token.value).collect()
    };
    for token in tokens {
        token.cancel();
    }
    lock_or_recover(&state.steer_senders).clear();
    lock_or_recover(&state.run_projects).clear();
    lock_or_recover(&state.run_tools).clear();
    let managers: Vec<_> = lock_or_recover(&state.subagent_managers)
        .drain()
        .map(|(_, manager)| manager.value)
        .collect();
    for manager in managers {
        manager.interrupt_all();
    }
    cancel_all_requests(state.inner(), &session_id);
    lock_or_recover(&state.pending_tools).clear();
}

#[tauri::command]
pub fn agent_cancel(
    state: State<'_, AgentState>,
    exec_state: State<'_, crate::agent_exec::AgentExecState>,
    request_id: String,
) {
    crate::agent_exec::cancel_run(exec_state.inner(), &request_id);
    cancel_run(state.inner(), &request_id);
}

fn cancel_run(state: &AgentState, request_id: &str) {
    let token = {
        let mut tokens = lock_or_recover(&state.run_tokens);
        tokens.remove(request_id).map(|token| token.value)
    };
    if let Some(token) = &token {
        // Cascades to subagent children through the shared pipeline token.
        token.cancel();
    }
    lock_or_recover(&state.steer_senders).remove(request_id);
    if let Some(generation) = lock_or_recover(&state.requests)
        .active
        .get(request_id)
        .map(|request| request.generation)
    {
        remove_run_resource(&state.run_projects, request_id, generation);
        remove_run_resource(&state.run_tools, request_id, generation);
    }
    if let Some(manager) = lock_or_recover(&state.subagent_managers).remove(request_id) {
        manager.value.interrupt_all();
    }
    if let Some(generation) = cancel_request(state, request_id) {
        drop_pending_tools(state, request_id, Some(generation));
    }
}

fn remove_run_resource<T>(
    resources: &Mutex<HashMap<String, RunResource<T>>>,
    request_id: &str,
    generation: u64,
) -> Option<T> {
    let mut resources = lock_or_recover(resources);
    if resources
        .get(request_id)
        .is_some_and(|resource| resource.generation == generation)
    {
        resources.remove(request_id).map(|resource| resource.value)
    } else {
        None
    }
}

#[allow(clippy::too_many_arguments)]
fn register_run_resources(
    state: &AgentState,
    request_id: &str,
    generation: u64,
    steer: oleafly_agent::SteerHandle,
    token: oleafly_agent::CancellationToken,
    manager: std::sync::Arc<SubagentManager>,
    project: Option<String>,
    tools: HashSet<String>,
) {
    lock_or_recover(&state.steer_senders).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: steer,
        },
    );
    if let Some(previous) = lock_or_recover(&state.run_tokens).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: token,
        },
    ) {
        previous.value.cancel();
    }
    if let Some(previous) = lock_or_recover(&state.subagent_managers).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: manager,
        },
    ) {
        previous.value.interrupt_all();
    }
    lock_or_recover(&state.run_projects).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: project,
        },
    );
    lock_or_recover(&state.run_tools).insert(
        request_id.to_string(),
        RunResource {
            generation,
            value: tools,
        },
    );
}

struct RunResourcesGuard<'a> {
    state: &'a AgentState,
    request_id: &'a str,
    generation: u64,
}

impl<'a> RunResourcesGuard<'a> {
    fn new(state: &'a AgentState, request_id: &'a str, generation: u64) -> Self {
        Self {
            state,
            request_id,
            generation,
        }
    }
}

impl Drop for RunResourcesGuard<'_> {
    fn drop(&mut self) {
        if let Some(token) =
            remove_run_resource(&self.state.run_tokens, self.request_id, self.generation)
        {
            token.cancel();
        }
        remove_run_resource(&self.state.steer_senders, self.request_id, self.generation);
        remove_run_resource(&self.state.run_projects, self.request_id, self.generation);
        remove_run_resource(&self.state.run_tools, self.request_id, self.generation);
        if let Some(manager) = remove_run_resource(
            &self.state.subagent_managers,
            self.request_id,
            self.generation,
        ) {
            manager.interrupt_all();
        }
    }
}

/// Inject mid-run input into an active run; it lands at the next message
/// boundary (after the pending tool batch completes).
#[tauri::command]
pub async fn agent_steer(
    state: State<'_, AgentState>,
    request_id: String,
    message: oleafly_agent::Message,
) -> Result<(), String> {
    steer_run(state.inner(), &request_id, message).await
}

/// Stop every running subagent of a run without stopping the run itself.
#[tauri::command]
pub fn agent_subagents_stop(
    state: State<'_, AgentState>,
    request_id: String,
) -> Result<u32, String> {
    subagents_stop(state.inner(), &request_id)
}

fn subagents_stop(state: &AgentState, request_id: &str) -> Result<u32, String> {
    let manager = {
        let managers = lock_or_recover(&state.subagent_managers);
        managers
            .get(request_id)
            .map(|manager| manager.value.clone())
    };
    match manager {
        Some(manager) => Ok(u32::try_from(manager.interrupt_all()).unwrap_or(u32::MAX)),
        None => Err(format!("no active run {request_id}")),
    }
}

async fn steer_run(
    state: &AgentState,
    request_id: &str,
    message: oleafly_agent::Message,
) -> Result<(), String> {
    if message.role != oleafly_agent::Role::User {
        return Err("a steer must be a user message".into());
    }
    let has_content = message.content.iter().any(|part| match part {
        oleafly_agent::ContentPart::Text { text } => !text.trim().is_empty(),
        oleafly_agent::ContentPart::Image { image } => !image.trim().is_empty(),
        _ => false,
    });
    if !has_content {
        return Err("a steer must contain text or an image".into());
    }
    let sender = {
        let senders = lock_or_recover(&state.steer_senders);
        senders.get(request_id).map(|sender| sender.value.clone())
    };
    match sender {
        Some(handle) if handle.steer(message).await => Ok(()),
        Some(_) => Err(format!(
            "run {request_id} stopped before receiving the steer"
        )),
        None => Err(format!("no active run {request_id} to steer")),
    }
}

fn initiating_user_text(request: &CompletionRequest) -> String {
    request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == oleafly_agent::Role::User)
        .map(|message| {
            message
                .content
                .iter()
                .filter_map(|part| match part {
                    oleafly_agent::ContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

fn turn_recorder_for_request(
    turn_id: String,
    client_turn_id: Option<String>,
    request: &CompletionRequest,
) -> oleafly_agent::items::TurnRecorder {
    let mut recorder = oleafly_agent::items::TurnRecorder::new(turn_id);
    recorder.seed_user_message(initiating_user_text(request));
    if let Some(client_turn_id) = client_turn_id {
        recorder.bind_client_turn_id(client_turn_id);
    }
    recorder
}

#[tauri::command]
pub async fn agent_stream(
    state: State<'_, AgentState>,
    request_id: String,
    request: CompletionRequest,
    provider_override: Option<ProviderOverride>,
    on_event: tauri::ipc::Channel<oleafly_agent::AgentEvent>,
) -> Result<(), String> {
    let agent_state = state.inner();
    run_registered(agent_state, &request_id, |_| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        oleafly_agent::stream_completion(&client, &resolved, &request, |event| {
            let _ = on_event.send(event);
        })
        .await
        .map(|_| ())
        .map_err(tagged)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command surface; each arg is IPC-named.
pub async fn agent_run(
    state: State<'_, AgentState>,
    app: tauri::AppHandle,
    request_id: String,
    request: CompletionRequest,
    config: Option<RunConfig>,
    provider_override: Option<ProviderOverride>,
    project_id: Option<String>,
    thread_id: Option<String>,
    client_turn_id: Option<String>,
    on_event: tauri::ipc::Channel<AgentEvent>,
) -> Result<oleafly_agent::RunOutcome, String> {
    let agent_state = state.inner();
    let config = sanitized_run_config(config);
    let run_id = request_id.clone();
    // The run is pinned to the project it started in; an invalid id disables
    // native dispatch rather than failing the run.
    let pinned_project = project_id.filter(|id| crate::paths::validate_project_id(id).is_ok());
    // Recorder inputs are captured before `run_registered` borrows the id.
    let record_scope = thread_id
        .as_deref()
        .map(|id| (id.to_string(), request_id.clone(), client_turn_id.clone()));
    // The closure owns its own id copy; `run_registered` borrows the original.
    let run_registration_id = request_id.clone();
    run_registered(agent_state, &request_id, |generation| async move {
        oleafly_agent::validate_completion_request(&request).map_err(tagged)?;
        let resolved = resolve_off_thread(provider_override).await?;
        let client = agent_state.client()?;
        let sink = on_event.clone();
        let allowed_tools: std::collections::HashSet<_> =
            request.tools.iter().map(|tool| tool.name.clone()).collect();
        let app_for_exec_cancel = app.clone();
        let base_tool = composite_tool_runner(
            app,
            run_id,
            generation,
            on_event.clone(),
            pinned_project.clone(),
        );
        // Pre-classify every call: project denials short-circuit before any
        // webview round trip; read-class tools may run concurrently under the
        // pipeline's shared gate.
        let classified_tool = oleafly_agent::ToolOrchestrator::wrap(
            base_tool.clone(),
            approval_classifier(pinned_project.clone()),
        );
        let classified_tool = allowlisted_tool_runner(allowed_tools.clone(), classified_tool);
        let pipeline = tool_pipeline();
        // Sub-agents: threads in this run, managed by the tool dispatcher.
        let multi_agent = crate::agent_config::MultiAgentConfig::load(
            &crate::paths::oleafly_root().unwrap_or_default(),
        );
        let subagent_manager = std::sync::Arc::new(SubagentManager::with_exec_canceller(
            std::sync::Arc::new(move |owner: &str| {
                let exec_state = app_for_exec_cancel.state::<crate::agent_exec::AgentExecState>();
                crate::agent_exec::cancel_run(exec_state.inner(), owner);
            }),
        ));
        let run_context = subagents::RunContext {
            client: client.clone(),
            resolved: resolved.clone(),
            request_template: request.clone(),
            config: config.clone(),
            registry: pipeline.registry.clone(),
            gate: pipeline.gate.clone(),
            parent_token: pipeline.token.clone(),
            tool_runner: classified_tool.clone(),
            parent_sink: sink.clone(),
            project_id: pinned_project.clone().unwrap_or_default(),
            depth: 0,
            task_path: subagents::RunContext::root_task_path(),
            multi_agent,
        };
        let subagent_manager_for_registry = subagent_manager.clone();
        let run_tool = subagents::multi_agent_tool_runner(
            run_context,
            subagent_manager,
            classified_tool.clone(),
        );
        let run_tool = allowlisted_tool_runner(allowed_tools.clone(), run_tool);
        // Steer channel + token registration: the shell can inject input or
        // interrupt (cascading to subagents through the shared token) while
        // the run is in flight.
        let (steer_handle, steer_rx) = oleafly_agent::SteerHandle::channel();
        register_run_resources(
            agent_state,
            &run_registration_id,
            generation,
            steer_handle,
            pipeline.token.clone(),
            subagent_manager_for_registry,
            pinned_project.clone(),
            allowed_tools,
        );
        let _run_resources = RunResourcesGuard::new(agent_state, &run_registration_id, generation);

        // A run scoped to a thread records its items into that thread's
        // rollout as it completes.
        let record_sink = record_scope.map(|(thread_id, turn_id, client_turn_id)| {
            let recorder = turn_recorder_for_request(turn_id, client_turn_id, &request);
            (thread_id, std::sync::Arc::new(Mutex::new(recorder)))
        });
        let mut persist_guard = InterruptedRunPersist {
            thread_id: record_sink.as_ref().map(|(id, _)| id.clone()),
            recorder: record_sink.as_ref().map(|(_, shared)| shared.clone()),
            root: crate::paths::oleafly_root().unwrap_or_else(|_| std::path::PathBuf::from(".")),
            project: pinned_project.clone().unwrap_or_default(),
            settled: false,
        };
        let outcome = oleafly_agent::run_agent_with_pipeline(
            &client,
            &resolved,
            request,
            &config,
            pipeline,
            Some(steer_rx),
            run_tool,
            |event| {
                if let Some((_, shared)) = &record_sink {
                    if let Ok(mut recorder) = shared.lock() {
                        recorder.record(&event);
                    }
                }
                let _ = sink.send(event);
            },
        )
        .await;
        persist_guard.settled = true;
        if let Some((thread_id, shared)) = &record_sink {
            // The guard must drop before the persist await keeps this future
            // Send; a poisoned lock simply skips persistence.
            let snapshot = shared.lock().ok().map(|mut recorder| {
                let stopped_at_cap = matches!(&outcome, Ok(outcome) if outcome.stopped_at_cap);
                recorder.finish(stopped_at_cap);
                recorder.snapshot().clone()
            });
            if let Some(snapshot) = snapshot {
                let thread_id = thread_id.clone();
                let project = pinned_project.clone().unwrap_or_default();
                let persist = tauri::async_runtime::spawn_blocking(move || {
                    let Ok(root) = crate::paths::oleafly_root() else {
                        return;
                    };
                    if crate::rollout::append_turn(&root, &thread_id, &snapshot).is_ok() {
                        if let Ok(turns) = crate::rollout::read_turns(&root, &thread_id) {
                            let _ = crate::library_db::resync_thread(
                                &root, &thread_id, &project, &turns,
                            );
                        }
                    }
                });
                let _ = persist.await;
            }
        }
        outcome.map_err(tagged)
    })
    .await
}

/// The legacy batch delegation tool, still dispatched for older prompts.
pub const SUBAGENT_TOOL: &str = "spawn_subagents";

/// Risk classification mirroring the shell's approval-risk table
/// (packages/ai-tools/src/approval-risk.ts): read tools run unprompted and
/// may execute concurrently; everything else confirms, and unknown tools
/// classify as write so nothing new runs silently.
const PARALLEL_SAFE_TOOLS: [&str; 24] = [
    "read_file",
    "list_files",
    "project_map",
    "search_project",
    "project_library_search",
    "get_pdf_text",
    "get_log",
    "get_todos",
    "update_todos",
    "list_notes",
    "remember_note",
    "forget_note",
    "load_image",
    "preview_figure",
    "verify_pdf_pages",
    "toggle_theme",
    "compile",
    "spawn_agent",
    "send_message",
    "followup_task",
    "wait_agent",
    "interrupt_agent",
    "list_agents",
    "close_agent",
];

const NETWORK_TOOLS: [&str; 4] = [
    "literature_search",
    "alphaxiv_search",
    "alphaxiv_paper_content",
    "verify_citation",
];

fn tool_risk(name: &str) -> oleafly_agent::ToolRisk {
    if name == "run_command" {
        return oleafly_agent::ToolRisk::Shell;
    }
    if PARALLEL_SAFE_TOOLS.contains(&name) {
        return oleafly_agent::ToolRisk::Read;
    }
    if NETWORK_TOOLS.contains(&name) {
        return oleafly_agent::ToolRisk::Network;
    }
    oleafly_agent::ToolRisk::Write
}

// Control-plane delegation tools inherit the run's shared tool gate, and
// wait_agent blocks on a child that needs that same gate to mutate. They take
// no gate so a parent waiting on a child never starves the child.
const ORCHESTRATION_TOOLS: [&str; 8] = [
    "spawn_agent",
    "spawn_subagents",
    "wait_agent",
    "send_message",
    "followup_task",
    "interrupt_agent",
    "list_agents",
    "close_agent",
];

fn tool_pipeline() -> oleafly_agent::ToolPipeline {
    let mut registry = oleafly_agent::ToolRegistry::default();
    for name in PARALLEL_SAFE_TOOLS {
        registry.register_trusted(name, oleafly_agent::RegisteredTool::parallel());
    }
    for name in ORCHESTRATION_TOOLS {
        registry.register_trusted(name, oleafly_agent::RegisteredTool::unguarded());
    }
    oleafly_agent::ToolPipeline::from_registry(registry)
}

/// Classify every tool call against the project's persisted decisions: a
/// denial is Forbidden (never executes, never asks), an explicit allow or a
/// read-class tool is Skip, everything else asks.
fn approval_classifier(
    project_id: Option<String>,
) -> oleafly_agent::tools::orchestrator::Classifier {
    std::sync::Arc::new(move |call| {
        let risk = tool_risk(&call.name);
        let decision = project_id.as_deref().and_then(|project| {
            crate::paths::oleafly_root().ok().and_then(|root| {
                crate::approvals::effective_decision_for(&root, project, &call.name).map(
                    |decision| match decision {
                        crate::approvals::ToolDecision::Allow => {
                            oleafly_agent::PolicyDecision::Allow
                        }
                        crate::approvals::ToolDecision::Deny => oleafly_agent::PolicyDecision::Deny,
                    },
                )
            })
        });
        oleafly_agent::classification_from_policy(risk, decision)
    })
}
/// Execute a backend-capable tool natively, without a webview round trip.
///
/// `Some(output)` means the tool was answered natively — including native
/// failures, which must NOT fall through to the webview (the two paths could
/// diverge). `None` means the tool is not native and the webview runner owns
/// it. Native coverage is the read-only set shared with the MCP server;
/// mutating tools keep the webview path until the approval flow moves.
async fn native_agent_tool(
    project_id: &str,
    name: &str,
    arguments_json: &str,
) -> Option<oleafly_agent::ToolOutput> {
    if !crate::mcp::native::handles(name, "") {
        return None;
    }
    let arguments: serde_json::Value = match serde_json::from_str(arguments_json) {
        Ok(value) => value,
        Err(_) => return Some(tool_error("the tool arguments were not valid JSON")),
    };
    match crate::mcp::native::call(project_id, name, &arguments).await {
        Ok(outcome) => Some(oleafly_agent::ToolOutput::text(unwrap_mcp_text(
            &outcome.result,
        ))),
        Err(error) => Some(tool_error(&error)),
    }
}

fn unwrap_mcp_text(result: &serde_json::Value) -> String {
    let texts: Vec<&str> = result
        .get("content")
        .and_then(|content| content.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(|text| text.as_str()))
                .collect()
        })
        .unwrap_or_default();
    if texts.is_empty() {
        result.to_string()
    } else {
        texts.join("\n")
    }
}

/// A run stays pinned to the project it started in; native dispatch is only
/// allowed while that project is still the active one. This mirrors the
/// webview-side run guard, so a run surviving a project switch cannot read
/// the old project's files into the model from either path.
fn native_dispatch_allowed(pinned: &str, active_project: Option<&str>) -> bool {
    active_project == Some(pinned)
}

fn composite_tool_runner(
    app: tauri::AppHandle,
    request_id: String,
    generation: u64,
    tool_sink: tauri::ipc::Channel<AgentEvent>,
    project_id: Option<String>,
) -> oleafly_agent::ToolRunner {
    let handle = app.clone();
    let webview = webview_tool_runner(app, request_id, generation, tool_sink, project_id.clone());
    std::sync::Arc::new(move |call| {
        let webview = webview.clone();
        let project = project_id.clone();
        let handle = handle.clone();
        Box::pin(async move {
            if let Some(project) = project.as_deref() {
                if crate::mcp::native::handles(&call.name, "") {
                    let active = {
                        let state = handle.state::<crate::mcp::server::McpState>();
                        let guard = state.active_project.lock().await;
                        guard.clone()
                    };
                    if !native_dispatch_allowed(project, active.as_deref()) {
                        return tool_error(
                            "the open project changed while this run was active; \
                             the tool was not executed",
                        );
                    }
                }
                if let Some(output) = native_agent_tool(project, &call.name, &call.arguments).await
                {
                    return output;
                }
            }
            webview(call).await
        })
    })
}

fn webview_tool_runner(
    app: tauri::AppHandle,
    request_id: String,
    generation: u64,
    tool_sink: tauri::ipc::Channel<AgentEvent>,
    project_id: Option<String>,
) -> oleafly_agent::ToolRunner {
    let sequence = std::sync::Arc::new(AtomicU64::new(0));
    std::sync::Arc::new(move |call| {
        let tool_sink = tool_sink.clone();
        let handle = app.clone();
        let run_id = request_id.clone();
        let project_id = project_id.clone();
        let reply_id = tool_reply_id(
            generation,
            sequence.fetch_add(1, Ordering::Relaxed),
            &call.id,
        );
        Box::pin(async move {
            let key = tool_key(&run_id, &reply_id);
            let (tx, rx) = tokio::sync::oneshot::channel();
            {
                let state = handle.state::<AgentState>();
                lock_or_recover(&state.pending_tools).insert(
                    key.clone(),
                    PendingTool {
                        generation,
                        sender: tx,
                        tool_name: call.name.clone(),
                        project_id: project_id.clone(),
                    },
                );
            }
            let _guard = PendingToolGuard {
                handle: handle.clone(),
                key: key.clone(),
                generation,
            };
            if tool_sink
                .send(AgentEvent::ToolRequest {
                    id: reply_id,
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                })
                .is_err()
            {
                return tool_error("the tool request could not be delivered");
            }
            match await_tool_result(rx, MAX_TOOL_EXECUTION_DURATION).await {
                Ok(output) => output,
                Err(message) => tool_error(message),
            }
        })
    })
}

async fn await_tool_result(
    receiver: tokio::sync::oneshot::Receiver<ToolOutput>,
    timeout: Duration,
) -> Result<ToolOutput, &'static str> {
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) => Err("the tool was not executed"),
        Err(_) => Err("the tool execution timed out"),
    }
}

fn tool_error(message: &str) -> ToolOutput {
    ToolOutput::text(serde_json::json!({ "error": message }).to_string())
}

fn allowlisted_tool_runner(
    allowed: std::collections::HashSet<String>,
    inner: oleafly_agent::ToolRunner,
) -> oleafly_agent::ToolRunner {
    let allowed = std::sync::Arc::new(allowed);
    std::sync::Arc::new(move |call| {
        let allowed = allowed.clone();
        let inner = inner.clone();
        Box::pin(async move {
            if !allowed.contains(&call.name) {
                return tool_error(&format!("Unknown tool: {}", call.name));
            }
            inner(call).await
        })
    })
}

/// Persists an interrupted turn when a run's future is dropped by a cancel:
/// the natural completion path disarms the guard first.
struct InterruptedRunPersist {
    thread_id: Option<String>,
    recorder: Option<std::sync::Arc<Mutex<oleafly_agent::items::TurnRecorder>>>,
    root: std::path::PathBuf,
    project: String,
    settled: bool,
}

impl Drop for InterruptedRunPersist {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        let (Some(thread_id), Some(shared)) = (&self.thread_id, &self.recorder) else {
            return;
        };
        if let Ok(mut recorder) = shared.lock() {
            recorder.mark_interrupted();
            let record = recorder.snapshot().clone();
            if crate::rollout::append_turn(&self.root, thread_id, &record).is_ok() {
                if let Ok(turns) = crate::rollout::read_turns(&self.root, thread_id) {
                    let _ = crate::library_db::resync_thread(
                        &self.root,
                        thread_id,
                        &self.project,
                        &turns,
                    );
                }
            }
        }
    }
}

struct PendingToolGuard {
    handle: tauri::AppHandle,
    key: String,
    generation: u64,
}

impl Drop for PendingToolGuard {
    fn drop(&mut self) {
        let state = self.handle.state::<AgentState>();
        remove_pending_tool(state.inner(), &self.key, self.generation);
    }
}

#[tauri::command]
pub fn agent_tool_result(
    state: State<'_, AgentState>,
    request_id: String,
    call_id: String,
    output: ToolOutput,
) {
    let key = tool_key(&request_id, &call_id);
    let pending = { lock_or_recover(&state.pending_tools).remove(&key) };
    if let Some(pending) = pending {
        // Defense-in-depth for persisted per-project denials: even if the
        // webview ran a denied tool, its output never reaches the model.
        let denied = pending.project_id.as_deref().is_some_and(|project| {
            crate::paths::oleafly_root().is_ok_and(|root| {
                crate::approvals::effective_decision_for(&root, project, &pending.tool_name)
                    == Some(crate::approvals::ToolDecision::Deny)
            })
        });
        let output = if denied {
            tool_error("this tool is denied for this project in approval settings")
        } else {
            output
        };
        let _ = pending
            .sender
            .send(oleafly_agent::bound_tool_output(output));
    }
}

fn tool_key(request_id: &str, call_id: &str) -> String {
    format!("{request_id}\u{1f}{call_id}")
}

fn tool_reply_id(generation: u64, sequence: u64, provider_call_id: &str) -> String {
    format!("tool-{generation}-{sequence}-{provider_call_id}")
}

fn remove_pending_tool(state: &AgentState, key: &str, generation: u64) {
    let mut pending = lock_or_recover(&state.pending_tools);
    let owned = pending
        .get(key)
        .map(|tool| tool.generation == generation)
        .unwrap_or(false);
    if owned {
        pending.remove(key);
    }
}

fn drop_pending_tools(state: &AgentState, request_id: &str, generation: Option<u64>) {
    let prefix = format!("{request_id}\u{1f}");
    lock_or_recover(&state.pending_tools).retain(|key, tool| {
        let matching_generation = generation
            .map(|generation| generation == tool.generation)
            .unwrap_or(true);
        !(key.starts_with(&prefix) && matching_generation)
    });
}

fn sanitized_run_config(config: Option<RunConfig>) -> RunConfig {
    let mut config = config.unwrap_or_default();
    config.max_steps = config.max_steps.clamp(1, MAX_RUN_STEPS);
    config.max_retries = config.max_retries.min(MAX_RUN_RETRIES);
    config.retry_base_ms = config
        .retry_base_ms
        .clamp(MIN_RETRY_BASE_MS, MAX_RETRY_BASE_MS);
    config
}

fn endpoint_override_allowed(
    projected: &ProviderConfig,
    provider_id: &str,
    key_supplied: bool,
    base_url: &Option<String>,
) -> bool {
    if base_url.is_none() || key_supplied {
        return true;
    }
    let stored = projected
        .keys
        .get(provider_id)
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    !stored
}

#[tauri::command]
pub async fn agent_list_models(
    state: State<'_, AgentState>,
    provider_id: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<oleafly_agent::ModelInfo>, String> {
    let _request_slot = acquire_request_slot(state.inner())?;
    let (client, resolved) =
        model_listing_request(state.inner(), provider_id, key, base_url).await?;
    let available = oleafly_agent::list_models(&client, &resolved)
        .await
        .map_err(|e| format!("[{}] {e}", e.kind()))?;
    crate::ai_model_registry::filter_supported_models(&client, &resolved.provider_id, available)
        .await
}

async fn model_listing_request(
    state: &AgentState,
    provider_id: String,
    key: Option<String>,
    base_url: Option<String>,
) -> Result<(reqwest::Client, oleafly_agent::Resolved), String> {
    let cfg = tauri::async_runtime::spawn_blocking(crate::config::read_config)
        .await
        .map_err(|e| e.to_string())??;
    let mut projected = provider_config(&cfg);
    let supplied_key = key.filter(|k| !k.trim().is_empty());
    let base_url = base_url.filter(|b| !b.trim().is_empty());

    if !endpoint_override_allowed(&projected, &provider_id, supplied_key.is_some(), &base_url) {
        return Err(format!(
            "Re-enter the API key to change the endpoint for {provider_id}."
        ));
    }

    if let Some(key) = supplied_key {
        projected.keys.insert(provider_id.clone(), key);
    }
    if let Some(base_url) = base_url {
        match projected.custom.iter_mut().find(|c| c.id == provider_id) {
            Some(existing) => existing.base_url = base_url,
            None => projected.custom.push(oleafly_agent::CustomProvider {
                id: provider_id.clone(),
                base_url,
                key_optional: true,
            }),
        }
    }

    let resolved = oleafly_agent::provider::resolve_for_model_listing(&projected, &provider_id)
        .map_err(|e| e.to_string())?;
    let client = state.client()?;
    Ok((client, resolved))
}

fn resolve_for(
    provider_override: Option<ProviderOverride>,
) -> Result<oleafly_agent::Resolved, String> {
    let cfg = crate::config::read_config()?;
    let projected = provider_config(&cfg);
    match provider_override {
        Some(o) => {
            oleafly_agent::provider::resolve_specific(&projected, &o.provider_id, &o.model_id)
        }
        None => oleafly_agent::resolve(&projected),
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) fn register_steer_for_test(
    state: &AgentState,
    request_id: &str,
    handle: oleafly_agent::SteerHandle,
) {
    lock_or_recover(&state.steer_senders).insert(
        request_id.to_string(),
        RunResource {
            generation: 0,
            value: handle,
        },
    );
}

#[cfg(test)]
pub(crate) fn register_manager_for_test(
    state: &AgentState,
    request_id: &str,
    manager: std::sync::Arc<SubagentManager>,
) {
    lock_or_recover(&state.subagent_managers).insert(
        request_id.to_string(),
        RunResource {
            generation: 0,
            value: manager,
        },
    );
}

#[cfg(test)]
pub(crate) fn register_token_for_test(
    state: &AgentState,
    request_id: &str,
    token: oleafly_agent::CancellationToken,
) {
    lock_or_recover(&state.run_tokens).insert(
        request_id.to_string(),
        RunResource {
            generation: 0,
            value: token,
        },
    );
}

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
