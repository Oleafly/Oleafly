use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::Duration;

use oleafly_agent::CancellationToken;
use oleafly_research::builtin::{
    ActiveTaskRun, ActiveToken, BuiltinTaskAdapter, TaskBridge, TaskHost, TaskMcpTool,
    TaskProvider, UsageSink, WebTools,
};
use oleafly_research::host::ConnectorSecrets;
use oleafly_research::literature::paper::PdfTextExtractor;
use oleafly_research::literature::{LiteratureClient, LiteratureSource};
use oleafly_research::prompt::task_prompt;
use oleafly_research::scheduler::TaskServices;
use oleafly_research::task_tools::extra::TaskBinding;
use oleafly_research::task_tools::{bounded, TaskFiles, MAX_FILE_BYTES, MAX_OUTPUT_BYTES};
use serde_json::json;
#[cfg(test)]
use serde_json::Value;
use tauri::Manager;

use crate::research_tasks::{
    ResearchTaskState, TaskEventSink, TaskRunContext, TaskRuntimeAdapter, TaskRuntimeEvent,
    TaskRuntimeFuture, TaskRuntimeOutcome, ToolPhase,
};

#[cfg(test)]
use oleafly_research::task_tools::sandbox_task_command_with_reads;
pub use oleafly_research::task_tools::task_sandbox_spec_for;

const TASK_TURN_FAILED: &str = "The agent could not complete this request.";

pub(crate) const MAX_SKILL_BYTES: usize = 192 * 1024;

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn selected_skills(
    root: &Path,
    pack: Option<&Path>,
    context: &TaskRunContext,
) -> Result<Vec<crate::skills::SkillRecord>, String> {
    if context.skill_ids.is_empty() {
        return Ok(Vec::new());
    }
    let records = crate::skills::list_with(root, pack, Some(&context.project_id))?;
    context
        .skill_ids
        .iter()
        .map(|id| {
            records
                .iter()
                .find(|skill| skill.id == *id && skill.is_available())
                .cloned()
                .ok_or_else(|| {
                    format!("The skill {id} is turned off. Enable it in Settings, AI, Skills.")
                })
        })
        .collect()
}

fn skill_read_paths_in(root: &Path, pack: Option<&Path>, context: &TaskRunContext) -> Vec<PathBuf> {
    let Ok(records) = selected_skills(root, pack, context) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = records
        .iter()
        .filter(|record| !record.dir.is_empty())
        .filter_map(|record| Path::new(&record.dir).canonicalize().ok())
        .filter(|path| path.is_dir())
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn skill_read_paths(context: &TaskRunContext) -> Vec<PathBuf> {
    if context.skill_ids.is_empty() {
        return Vec::new();
    }
    let Ok(root) = crate::paths::oleafly_root() else {
        return Vec::new();
    };
    let pack = crate::skills_pack::cached_pack_root();
    skill_read_paths_in(&root, pack.as_deref(), context)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SkillAudience {
    Task,
    CliAgent,
}

pub(crate) fn skill_section(
    record: &crate::skills::SkillRecord,
    audience: SkillAudience,
) -> String {
    if audience == SkillAudience::CliAgent {
        return cli_skill_section(record);
    }
    let mut section = format!("\n\nSelected skill: {}\n", record.name);
    if !record.dir.is_empty() {
        section.push_str(&format!(
            "Skill folder: {}\nEvery relative path in the instructions below is inside that folder, which is readable from run_command.\n",
            record.dir
        ));
    }
    let scripts = crate::skills::skill_scripts(record);
    if !scripts.is_empty() {
        section.push_str("Bundled scripts, run one with run_command:\n");
        for script in scripts {
            section.push_str(&format!("- {}: {}\n", script.path, script.command));
        }
    }
    let references: Vec<&str> = record
        .files
        .iter()
        .filter(|file| !file.path.starts_with("scripts/"))
        .map(|file| file.path.as_str())
        .collect();
    if !references.is_empty() {
        section.push_str(&format!(
            "Supporting files, read one with read_skill_file: {}\n",
            references.join(", ")
        ));
    }
    section.push_str(&record.instructions);
    section.push_str(&oleafly_research::aliases::tool_alias_note(
        &record.instructions,
        &oleafly_research::aliases::AliasAudience::Task {
            alphaxiv_tools: None,
        },
    ));
    section
}

fn cli_skill_section(record: &crate::skills::SkillRecord) -> String {
    let mut section = format!("Selected skill: {}\n", record.name);
    if !record.dir.is_empty() {
        let folder = oleafly_core::plain_path(Path::new(&record.dir));
        section.push_str(&format!(
            "Skill folder: {}\nRelative paths in the instructions below are inside that folder.\n",
            folder.display()
        ));
        let references: Vec<&str> = record
            .files
            .iter()
            .filter(|file| !file.path.starts_with("scripts/"))
            .map(|file| file.path.as_str())
            .collect();
        if !references.is_empty() {
            section.push_str(&format!(
                "Supporting files in that folder: {}\n",
                references.join(", ")
            ));
        }
    }
    section.push('\n');
    section.push_str(&record.instructions);
    section.push_str(&oleafly_research::aliases::tool_alias_note(
        &record.instructions,
        &oleafly_research::aliases::AliasAudience::CliAgent,
    ));
    section
}

fn skill_prompt_in(
    root: &Path,
    pack: Option<&Path>,
    context: &TaskRunContext,
) -> Result<String, String> {
    let mut prompt = String::new();
    for skill in selected_skills(root, pack, context)? {
        prompt.push_str(&skill_section(&skill, SkillAudience::Task));
        if prompt.len() > MAX_SKILL_BYTES {
            return Err(
                "The selected skills exceed this task's context limit. Select fewer skills.".into(),
            );
        }
    }
    Ok(prompt)
}

fn skill_prompt(app: &tauri::AppHandle, context: &TaskRunContext) -> Result<String, String> {
    if context.skill_ids.is_empty() {
        return Ok(String::new());
    }
    let root = crate::paths::oleafly_root()?;
    let pack = crate::skills_pack::pack_root(app);
    skill_prompt_in(&root, pack.as_deref(), context)
}

struct NativeTaskHost {
    app: tauri::AppHandle,
    web: Option<Arc<dyn WebTools>>,
}

struct AppWeb {
    client: oleafly_agent::tools::web::WebClient,
}

const MAX_WEB_TEXT: usize = 48 * 1024;

#[async_trait::async_trait]
impl WebTools for AppWeb {
    async fn fetch(&self, url: &str) -> Result<serde_json::Value, String> {
        let options = oleafly_agent::tools::web::WebFetchOptions {
            user_agent: super::web::WEB_USER_AGENT.into(),
            ..Default::default()
        };
        let page = oleafly_agent::tools::web::web_fetch(&self.client, url, &options)
            .await
            .map_err(|error| error.to_string())?;
        let truncated = page.truncated || page.markdown.len() > MAX_WEB_TEXT;
        Ok(json!({
            "url": page.url,
            "title": page.title,
            "contentType": page.content_type,
            "text": bounded(&page.markdown, MAX_WEB_TEXT),
            "truncated": truncated,
        }))
    }

    async fn search(&self, query: &str) -> Result<serde_json::Value, String> {
        let key = tokio::task::spawn_blocking(super::web::configured_search_key)
            .await
            .ok()
            .flatten()
            .ok_or("Web search needs a Brave, Tavily or Serper key in Settings.")?;
        let hits = oleafly_agent::tools::web::web_search(&self.client, query, &key)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "results": hits }))
    }
}

fn task_mcp_server_names() -> Vec<String> {
    crate::config::read_config()
        .map(|config| config.research_task_mcp_servers)
        .unwrap_or_default()
}

impl TaskHost for NativeTaskHost {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String> {
        skill_prompt(&self.app, context)
    }

    fn skill_read_paths(&self, context: &TaskRunContext) -> Vec<PathBuf> {
        skill_read_paths(context)
    }

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        let app = self.app.clone();
        Box::pin(async move {
            let resolved = super::resolve_for_run_off_thread(
                Some(super::ProviderOverride {
                    provider_id: context.agent_id.clone(),
                    model_id: context.model_id.clone(),
                }),
                true,
            )
            .await?;
            let usage = super::usage::NativeUsageGuard::new(
                crate::paths::oleafly_root()?,
                super::usage::UsageScope {
                    session_id: context.session_id.clone(),
                    turn_id: format!("{}:{}", context.task_id, context.execution_generation),
                    project_id: Some(context.project_id.clone()),
                    task_id: Some(context.task_id.clone()),
                    parent_session_id: None,
                },
                &resolved,
            );
            Ok(TaskProvider {
                client: app.state::<super::AgentState>().client()?,
                resolved,
                usage: Box::new(NativeUsage(usage)),
            })
        })
    }

    fn bridge(
        &self,
        context: TaskRunContext,
        binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
        let app = self.app.clone();
        Box::pin(async move {
            let desktop_apps = context.desktop_apps;
            let task_id = context.task_id.clone();
            let generation = context.execution_generation;
            let project_id = context.project_id.clone();
            let title = context.title.clone();
            let bridge = crate::research_mcp::start_restricted(
                app,
                context.project_id,
                PathBuf::from(context.execution_root),
                context.allowed_paths,
                binding,
            )
            .await?;
            let bridge = Arc::new(bridge) as Arc<dyn TaskBridge>;
            if !desktop_apps {
                return Ok(bridge);
            }
            Ok(crate::cua_driver::task::DesktopAppsTaskBridge::wrap(
                bridge.clone(),
                &task_id,
                generation,
                &project_id,
                &title,
            )
            .await
            .unwrap_or(bridge))
        })
    }

    fn linked_folders(
        &self,
        context: &TaskRunContext,
    ) -> Vec<oleafly_sandbox::profile::LinkedFolder> {
        crate::research_workspace::get_research_workspace(context.project_id.clone())
            .map(|workspace| {
                workspace
                    .roots
                    .into_iter()
                    .map(|root| oleafly_sandbox::profile::LinkedFolder {
                        id: root.id,
                        label: root.label,
                        path: PathBuf::from(root.canonical_path),
                    })
                    .filter(|folder| folder.path.is_dir())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn program_search_dirs(&self) -> Vec<PathBuf> {
        crate::program_locator::search_dirs()
    }

    fn project_root(&self, project_id: &str) -> Option<PathBuf> {
        crate::project_location::locate(project_id)
            .ok()
            .map(|location| location.root)
    }

    fn linked_root(&self, project_id: &str, root_id: &str) -> Option<PathBuf> {
        crate::research_mcp::linked_root(project_id, root_id).ok()
    }

    fn secrets(&self) -> Arc<dyn ConnectorSecrets> {
        Arc::new(crate::literature::AppSecrets)
    }

    fn web(&self) -> Option<Arc<dyn WebTools>> {
        self.web.clone()
    }

    fn task_mcp_tools(&self, _context: &TaskRunContext) -> TaskRuntimeFuture<Vec<TaskMcpTool>> {
        Box::pin(async {
            let names = tokio::task::spawn_blocking(task_mcp_server_names)
                .await
                .unwrap_or_default();
            let servers = crate::mcp::client::task_server_tools(&names).await;
            Ok(servers
                .into_iter()
                .flat_map(|server| {
                    let server_name = server.name;
                    server.tools.into_iter().map(move |tool| {
                        let server = server_name.clone();
                        let handle = tool.tool_handle.clone();
                        TaskMcpTool {
                            schema: oleafly_agent::ToolSchema {
                                name: tool.name,
                                description: tool.description.unwrap_or_default(),
                                input_schema: tool.input_schema,
                            },
                            call: Arc::new(move |arguments| {
                                let server = server.clone();
                                let handle = handle.clone();
                                Box::pin(async move {
                                    crate::mcp::client::call_enabled_server_tool(
                                        &server, &handle, arguments,
                                    )
                                    .await
                                })
                            }),
                        }
                    })
                })
                .collect())
        })
    }

    fn task_mcp_servers(&self, _context: &TaskRunContext) -> Vec<serde_json::Value> {
        crate::mcp::client::task_server_specs(&task_mcp_server_names())
    }

    fn literature(&self) -> Arc<LiteratureClient> {
        crate::literature::app_literature()
    }

    fn literature_sources(&self) -> Vec<Arc<dyn LiteratureSource>> {
        crate::literature::extra_sources()
    }

    fn pdf_extractor(&self) -> Option<Arc<dyn PdfTextExtractor>> {
        Some(Arc::new(crate::research_tasks::pdf_text::AppPdfText {
            app: self.app.clone(),
        }))
    }
}

struct NativeUsage(super::usage::NativeUsageGuard);

impl UsageSink for NativeUsage {
    fn observe(&self, event: &oleafly_agent::AgentEvent) {
        self.0.observe(event);
    }

    fn finish(&self, status: &str) {
        self.0.finish(status);
    }
}

pub fn register_task_runtimes(app: &tauri::AppHandle) -> Result<(), String> {
    let tasks = app
        .try_state::<ResearchTaskState>()
        .ok_or("Research task storage is unavailable.")?;
    let services = tasks.services()?;
    let web = oleafly_agent::tools::web::WebClient::new(super::web::WEB_USER_AGENT)
        .ok()
        .map(|client| Arc::new(AppWeb { client }) as Arc<dyn WebTools>);
    let host: Arc<dyn TaskHost> = Arc::new(NativeTaskHost {
        app: app.clone(),
        web,
    });
    tasks.register_runtime(
        "builtin",
        Arc::new(BuiltinTaskAdapter::new(host.clone(), services.clone())),
    )?;
    let runtime = app
        .try_state::<Arc<crate::acp::AcpRuntime>>()
        .ok_or("The ACP runtime is unavailable.")?
        .inner()
        .clone();
    tasks.register_runtime(
        "acp",
        Arc::new(AcpTaskAdapter {
            host,
            services,
            runtime,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }),
    )?;
    Ok(())
}

struct GateApproval {
    services: TaskServices,
    context: oleafly_research::approvals::GateContext,
    cancel: CancellationToken,
}

impl crate::acp::TaskCommandApproval for GateApproval {
    fn ask(
        &self,
        summary: String,
        detail: String,
    ) -> futures_util::future::BoxFuture<'static, Result<(), String>> {
        let services = self.services.clone();
        let context = self.context.clone();
        let cancel = self.cancel.clone();
        Box::pin(async move {
            oleafly_research::approvals::gate(
                &services,
                &context,
                oleafly_research::model::ApprovalKind::Command,
                &summary,
                &detail,
                &cancel,
            )
            .await
        })
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct PromptStart {
    resumed: bool,
    adopted: bool,
    turn_interrupted: bool,
}

enum PromptEnd {
    Finished(TaskRuntimeOutcome),
    Suspended(TaskRuntimeOutcome),
}

#[derive(Clone)]
struct AcpTaskAdapter {
    host: Arc<dyn TaskHost>,
    services: TaskServices,
    runtime: Arc<crate::acp::AcpRuntime>,
    tokens: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
}

impl TaskRuntimeAdapter for AcpTaskAdapter {
    fn supports(&self, agent_id: &str) -> bool {
        !agent_id.trim().is_empty()
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let adapter = self.clone();
        Box::pin(async move {
            let cancel = cancel.child();
            let (done, receiver) = tokio::sync::watch::channel(false);
            lock(&adapter.tokens).insert(
                context.session_id.clone(),
                ActiveTaskRun {
                    token: cancel.clone(),
                    done: receiver,
                },
            );
            let _active = ActiveToken {
                sessions: adapter.tokens.clone(),
                session_id: context.session_id.clone(),
                token: cancel.clone(),
                done,
            };
            adapter
                .run_task(context, cancel, events)
                .await
                .map_err(|error| crate::app_error::english_error(&error))
        })
    }

    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()> {
        let runtime = self.runtime.clone();
        let tokens = self.tokens.clone();
        Box::pin(async move {
            let active = lock(&tokens).get(&session_id).cloned();
            if let Some(active) = &active {
                active.token.cancel();
            }
            runtime
                .close_owner(&format!("research-task:{session_id}"))
                .await;
            if let Some(mut active) = active {
                while !*active.done.borrow_and_update() {
                    if active.done.changed().await.is_err() {
                        break;
                    }
                }
            }
            Ok(())
        })
    }
}

fn acp_task_start(
    runtime: &crate::acp::AcpRuntime,
    context: &TaskRunContext,
    execution_root: PathBuf,
) -> (crate::acp::StartSession, u64) {
    let owner = format!("research-task:{}", context.session_id);
    let generation = runtime.owner_generation(&owner);
    (
        crate::acp::StartSession {
            project_id: context.project_id.clone(),
            project_path: execution_root,
            agent_id: context.agent_id.clone(),
            parent_session_id: None,
            task_id: Some(context.task_id.clone()),
            owner: Some(owner),
            allowed_paths: Some(context.allowed_paths.clone()),
            task_commands: None,
        },
        generation,
    )
}

impl AcpTaskAdapter {
    async fn run_task(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        if cancel.is_cancelled() {
            return Err("The task was cancelled.".into());
        }
        let files = TaskFiles::open(Path::new(&context.execution_root), &context.allowed_paths)?;
        let skills = self.host.skills(&context)?;
        let (mut options, generation) = acp_task_start(&self.runtime, &context, files.root.clone());
        let mut bridge_context = context.clone();
        bridge_context.execution_root = files.root.to_string_lossy().into_owned();
        let binding = TaskBinding {
            task_id: context.task_id.clone(),
            project_id: context.project_id.clone(),
            task_title: context.title.clone(),
            generation: context.execution_generation,
            brief: context.brief.clone(),
            record_dir: context.record_dir.clone(),
            execution_root: files.root.clone(),
            allowed_paths: context.allowed_paths.clone(),
            read_paths: self.host.skill_read_paths(&context),
            linked_roots: self.host.linked_folders(&context),
            search_dirs: self.host.program_search_dirs(),
            project_root: self.host.project_root(&context.project_id),
            services: self.services.clone(),
            host: self.host.clone(),
            events: Some(events.clone()),
            cancel: cancel.clone(),
        };
        options.task_commands = Some(match context.brief.permissions.commands {
            oleafly_research::model::CommandPolicy::Allow => crate::acp::TaskCommands::Allow,
            oleafly_research::model::CommandPolicy::Off => crate::acp::TaskCommands::Off,
            oleafly_research::model::CommandPolicy::Ask => {
                crate::acp::TaskCommands::Ask(Arc::new(GateApproval {
                    services: self.services.clone(),
                    context: binding.gate_context(),
                    cancel: cancel.clone(),
                }))
            }
        });
        let bridge = self.host.bridge(bridge_context, Some(binding)).await?;
        if cancel.is_cancelled() {
            bridge.shutdown().await;
            return Err("The task was cancelled.".into());
        }
        let mut servers = bridge.mcp_servers();
        servers.extend(self.host.task_mcp_servers(&context));
        let previous = context
            .resume
            .as_ref()
            .and_then(|resume| resume.previous_native_session_id.clone());
        let mut resumed = false;
        let handed_back = context
            .handoff
            .as_ref()
            .and_then(|handoff| handoff.acp.clone())
            .filter(|acp| acp.home.is_dir());
        let turn_interrupted = context
            .handoff
            .as_ref()
            .is_some_and(|handoff| handoff.turn_interrupted);
        let mut adopted = false;
        let started = if let Some(handoff) = &handed_back {
            match self
                .runtime
                .adopt_task_session(handoff, options.clone(), servers.clone(), Some(generation))
                .await
            {
                Ok(snapshot) => {
                    adopted = true;
                    resumed = true;
                    Ok(snapshot)
                }
                Err(_) if cancel.is_cancelled() => Err("The task was cancelled.".to_string()),
                Err(_) => {
                    events(TaskRuntimeEvent::Status {
                        message: "The agent's previous session could not be resumed, so the task starts fresh.".into(),
                    });
                    let generation = self
                        .runtime
                        .owner_generation(options.owner.as_deref().unwrap_or_default());
                    self.runtime
                        .start_with_mcp_at_generation(options, servers, Some(generation))
                        .await
                }
            }
        } else {
            match previous {
                Some(native) => match self
                    .runtime
                    .resume_task_session(
                        &native,
                        options.clone(),
                        servers.clone(),
                        Some(generation),
                    )
                    .await
                {
                    Ok(snapshot) => {
                        resumed = true;
                        Ok(snapshot)
                    }
                    Err(_) if cancel.is_cancelled() => Err("The task was cancelled.".to_string()),
                    Err(_) => {
                        events(TaskRuntimeEvent::Status {
                        message: "The agent's previous session could not be resumed, so the task starts fresh.".into(),
                    });
                        let generation = self
                            .runtime
                            .owner_generation(options.owner.as_deref().unwrap_or_default());
                        self.runtime
                            .start_with_mcp_at_generation(options, servers, Some(generation))
                            .await
                    }
                },
                None => {
                    self.runtime
                        .start_with_mcp_at_generation(options, servers, Some(generation))
                        .await
                }
            }
        };
        let session = match started {
            Ok(value) => value.session,
            Err(error) => {
                self.runtime
                    .close_owner(&format!("research-task:{}", context.session_id))
                    .await;
                bridge.shutdown().await;
                return Err(error);
            }
        };
        let id = session.id.clone();
        if let Some(native) = session.native_session_id.clone() {
            events(TaskRuntimeEvent::SessionBound {
                native_session_id: native,
            });
        }
        let start = PromptStart {
            resumed,
            adopted,
            turn_interrupted,
        };
        let outcome = self
            .prompt_task(&context, &id, &skills, start, &cancel, &events)
            .await;
        match outcome {
            Ok(PromptEnd::Suspended(outcome)) => {
                let destination = oleafly_research::handoff::acp_home_path(
                    &self.services.tasks_root,
                    &context.task_id,
                    context.execution_generation,
                );
                let handed = self.runtime.close_task_for_handoff(&id, &destination).await;
                bridge.shutdown().await;
                match handed {
                    Ok(acp) => {
                        self.services.suspends.record(
                            &context.task_id,
                            oleafly_research::model::SuspendState {
                                conversation: None,
                                turn_interrupted: true,
                                acp: Some(acp),
                            },
                        );
                        Ok(outcome)
                    }
                    Err(error) => {
                        let _ = self.runtime.close(&id).await;
                        Err(error)
                    }
                }
            }
            Ok(PromptEnd::Finished(outcome)) => {
                let cleanup = self.runtime.end_task_session(&id).await;
                bridge.shutdown().await;
                cleanup?;
                Ok(outcome)
            }
            Err(error) => {
                let cleanup = self.runtime.end_task_session(&id).await;
                bridge.shutdown().await;
                cleanup?;
                Err(error)
            }
        }
    }

    async fn prompt_task(
        &self,
        context: &TaskRunContext,
        id: &str,
        skills: &str,
        start: PromptStart,
        cancel: &CancellationToken,
        events: &TaskEventSink,
    ) -> Result<PromptEnd, String> {
        if cancel.is_cancelled() {
            return Err("The task was cancelled.".into());
        }
        if self
            .runtime
            .select_model_if_offered(id, &context.model_id)
            .await?
            == crate::acp::ModelChoice::NotOffered
        {
            events(TaskRuntimeEvent::Status {
                message: format!(
                    "The agent does not offer {}, so it keeps its own model.",
                    context.model_id.trim()
                ),
            });
        }
        let before = self.runtime.snapshot(id).await?.session;
        let mut receiver = self.runtime.subscribe();
        let mut sequence = before.last_sequence;
        let mut stop_reason = None;
        let mut result = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: before.native_session_id.clone(),
            input_tokens: None,
            output_tokens: None,
        };
        let text = first_prompt(context, skills, start);
        let step = self.services.suspends.token(&context.task_id);
        let withdraw = self.services.suspends.approvals(&context.task_id);
        let mut suspending = false;
        let mut turn_cancelled = false;
        let prompt = self.runtime.prompt(id, text, Vec::new());
        tokio::pin!(prompt);
        let snapshot = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    self.runtime.cancel(id).await?;
                    return Err("The task was cancelled.".into());
                }
                _ = step.cancelled(), if !suspending => {
                    suspending = true;
                }
                _ = withdraw.cancelled(), if suspending && !turn_cancelled => {
                    turn_cancelled = true;
                    let runtime = self.runtime.clone();
                    let session = id.to_owned();
                    tokio::spawn(async move {
                        let _ = runtime.cancel(&session).await;
                    });
                }
                completed = &mut prompt => {
                    if turn_cancelled {
                        break completed.ok();
                    }
                    break Some(completed.map_err(|_| TASK_TURN_FAILED.to_string())?);
                }
                event = receiver.recv() => match event {
                    Ok(event) if event.session_id == id => { self.catch_up(id,&mut sequence,&mut result,&mut stop_reason,events)?; }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => { self.catch_up(id,&mut sequence,&mut result,&mut stop_reason,events)?; }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return Err("The ACP event stream closed before the task finished.".into()),
                    _ => {}
                }
            }
        };
        self.catch_up(id, &mut sequence, &mut result, &mut stop_reason, events)?;
        if turn_cancelled {
            return Ok(PromptEnd::Suspended(result));
        }
        let Some(snapshot) = snapshot else {
            return Err(TASK_TURN_FAILED.into());
        };
        if snapshot.session.status != crate::acp::SessionStatus::Ready {
            return Err(snapshot
                .session
                .error
                .unwrap_or_else(|| "The agent stopped before finishing the task.".into()));
        }
        if stop_reason.as_deref() != Some("end_turn") {
            return Err(format!(
                "The agent did not finish the task: {}.",
                stop_reason.as_deref().unwrap_or("no completion event")
            ));
        }
        if result.summary.trim().is_empty() {
            result.summary =
                "The agent finished. Review its workspace changes and transcript.".into();
        }
        Ok(PromptEnd::Finished(result))
    }

    fn catch_up(
        &self,
        id: &str,
        sequence: &mut u64,
        result: &mut TaskRuntimeOutcome,
        stop_reason: &mut Option<String>,
        events: &TaskEventSink,
    ) -> Result<(), String> {
        loop {
            let page = self.runtime.events(id, *sequence, 256)?;
            for event in page.events {
                *sequence = event.sequence;
                if event.kind == "turn_complete" {
                    *stop_reason = event.data["stopReason"].as_str().map(str::to_string);
                }
                if let Some(event) = acp_event(&event, result) {
                    events(event);
                }
            }
            if !page.has_more {
                return Ok(());
            }
        }
    }
}

fn first_prompt(context: &TaskRunContext, skills: &str, start: PromptStart) -> String {
    match (&context.resume, start.resumed) {
        (resume, true) if start.adopted => oleafly_cli::daemon::acp_task::continuation_prompt(
            resume.as_ref(),
            &context.record_dir,
            start.turn_interrupted,
        ),
        (Some(resume), true) => {
            oleafly_research::prompt::resume_message(resume, &context.record_dir)
        }
        (Some(resume), false) => format!(
            "{}\n\n{}",
            task_prompt(context, skills),
            oleafly_research::prompt::resume_message(resume, &context.record_dir)
        ),
        (None, _) => task_prompt(context, skills),
    }
}

fn acp_tool_status(status: &str) -> String {
    match status {
        "completed" => "done",
        "failed" | "error" | "cancelled" | "canceled" => "error",
        _ => "running",
    }
    .into()
}

pub(crate) fn acp_event(
    event: &crate::acp::AcpEvent,
    outcome: &mut TaskRuntimeOutcome,
) -> Option<TaskRuntimeEvent> {
    match event.kind.as_str() {
        "agent_message_chunk" => {
            let text = event.data["content"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if outcome.summary.len() < MAX_FILE_BYTES {
                outcome
                    .summary
                    .push_str(&bounded(&text, MAX_FILE_BYTES - outcome.summary.len()));
            }
            Some(TaskRuntimeEvent::Text { text })
        }
        "agent_thought_chunk" => Some(TaskRuntimeEvent::Reasoning {
            text: event.data["content"]["text"]
                .as_str()
                .unwrap_or_default()
                .into(),
        }),
        "tool_call" | "tool_call_update" => {
            let detail = json!({
                "kind": event.data["kind"],
                "status": event.data["status"],
                "content": event.data["content"],
            });
            Some(TaskRuntimeEvent::Tool {
                call_id: event.data["toolCallId"].as_str().map(str::to_string),
                name: event.data["title"].as_str().unwrap_or("Agent tool").into(),
                phase: if event.kind == "tool_call" {
                    ToolPhase::Request
                } else {
                    ToolPhase::Update
                },
                detail: bounded(&detail.to_string(), MAX_OUTPUT_BYTES),
                status: event.data["status"].as_str().map(acp_tool_status),
            })
        }
        "usage" if event.data["source"] != "acp_context" => {
            outcome.input_tokens = event.data["inputTokens"].as_u64().or(outcome.input_tokens);
            outcome.output_tokens = event.data["outputTokens"]
                .as_u64()
                .or(outcome.output_tokens);
            Some(TaskRuntimeEvent::Usage {
                input_tokens: outcome.input_tokens,
                output_tokens: outcome.output_tokens,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_usage_does_not_become_input_tokens() {
        let event = crate::acp::AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "agent".into(),
            model_id: None,
            task_id: Some("task".into()),
            turn_id: Some("turn".into()),
            sequence: 1,
            timestamp: 0,
            kind: "usage".into(),
            data: json!({"contextUsed":1234,"source":"acp_context"}),
            owner: None,
        };
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        assert!(acp_event(&event, &mut outcome).is_none());
        assert_eq!(outcome.input_tokens, None);
    }

    #[test]
    fn acp_tool_calls_keep_their_identity_status_and_payload() {
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        let event = |kind: &str, data: Value| crate::acp::AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "agent".into(),
            model_id: None,
            task_id: None,
            turn_id: None,
            sequence: 1,
            timestamp: 0,
            kind: kind.into(),
            data,
            owner: None,
        };
        let call = acp_event(
            &event(
                "tool_call",
                json!({
                    "toolCallId": "tool-9",
                    "title": "Read file",
                    "kind": "read",
                    "status": "pending",
                    "rawInput": {"path": "main.tex"},
                }),
            ),
            &mut outcome,
        );
        let Some(TaskRuntimeEvent::Tool {
            call_id,
            name,
            phase,
            detail,
            status,
        }) = call
        else {
            panic!("an ACP tool call must project a tool event");
        };
        assert_eq!(call_id.as_deref(), Some("tool-9"));
        assert_eq!(name, "Read file");
        assert_eq!(phase, ToolPhase::Request);
        assert_eq!(status.as_deref(), Some("running"));
        let payload: Value = serde_json::from_str(&detail).unwrap();
        assert_eq!(payload["kind"], "read");
        assert!(payload.get("rawInput").is_none());
        assert!(payload.get("rawOutput").is_none());

        let update = acp_event(
            &event(
                "tool_call_update",
                json!({
                    "toolCallId": "tool-9",
                    "title": "Read file",
                    "status": "completed",
                    "rawOutput": {"content": "body"},
                }),
            ),
            &mut outcome,
        );
        assert!(matches!(
            update,
            Some(TaskRuntimeEvent::Tool {
                call_id: Some(id),
                phase: ToolPhase::Update,
                status: Some(status),
                ..
            }) if id == "tool-9" && status == "done"
        ));
    }

    #[test]
    fn a_fresh_session_of_an_approved_plan_still_gets_the_plan() {
        let context = TaskRunContext {
            task_id: "task".into(),
            title: "Survey".into(),
            prompt: "Survey the field".into(),
            record_dir: "research/survey".into(),
            resume: Some(oleafly_research::model::ResumeContext {
                reason: oleafly_research::model::ResumeReason::PlanApproved,
                handoff: String::new(),
                plan: "1. Read the three papers".into(),
                ledger_tail: String::new(),
                previous_native_session_id: Some("agent-session".into()),
            }),
            ..Default::default()
        };
        let fresh = first_prompt(&context, "", PromptStart::default());
        assert!(fresh.contains("approved the plan"), "{fresh}");
        assert!(fresh.contains("1. Read the three papers"), "{fresh}");
        assert!(fresh.starts_with(&task_prompt(&context, "")), "{fresh}");
        let resumed = first_prompt(
            &context,
            "",
            PromptStart {
                resumed: true,
                ..PromptStart::default()
            },
        );
        assert!(!resumed.contains(&task_prompt(&context, "")));
        assert!(resumed.contains("approved the plan"));
        let first = TaskRunContext {
            resume: None,
            ..context.clone()
        };
        assert_eq!(
            first_prompt(&first, "", PromptStart::default()),
            task_prompt(&first, "")
        );
    }

    #[cfg(target_os = "macos")]
    fn context(root: &Path) -> TaskRunContext {
        TaskRunContext {
            task_id: "task".into(),
            execution_generation: 1,
            session_id: "session".into(),
            project_id: "project".into(),
            execution_root: root.to_string_lossy().into_owned(),
            title: "Task".into(),
            prompt: "Task prompt".into(),
            runtime_id: "builtin".into(),
            agent_id: "openai".into(),
            model_id: "test".into(),
            skill_ids: Vec::new(),
            source_revision: "snapshot".into(),
            allowed_paths: vec!["analysis".into()],
            ..Default::default()
        }
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn closing_a_task_during_bridge_preparation_invalidates_its_acp_start() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = temporary.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let runtime = crate::acp::AcpRuntime::new(temporary.path().join("acp")).unwrap();
        let mut context = context(&workspace);
        context.agent_id = "gemini".into();
        context.runtime_id = "acp".into();
        let owner = format!("research-task:{}", context.session_id);
        let project_id = context.project_id.clone();
        let pending = runtime.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
        let start = tokio::spawn(async move {
            let (options, generation) = acp_task_start(&pending, &context, workspace);
            ready_tx.send(()).unwrap();
            resume_rx.await.unwrap();
            pending
                .start_with_mcp_at_generation(options, Vec::new(), Some(generation))
                .await
        });
        ready_rx.await.unwrap();
        runtime.close_owner(&owner).await;
        resume_tx.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), start)
            .await
            .unwrap()
            .unwrap();
        let error = result.unwrap_err();
        assert!(crate::acp::failures::is_code(
            &error,
            crate::acp::failures::OWNER_CLOSED
        ));
        assert!(
            crate::app_error::english_error(&error).contains("closed while the agent was starting"),
            "{error}"
        );
        assert!(runtime.list(&project_id).unwrap().is_empty());
        assert!(!temporary.path().join("acp/task-temp").exists());
    }

    #[test]
    fn acp_text_uses_the_protocol_content_block() {
        let event = crate::acp::AcpEvent {
            session_id: "session".into(),
            project_id: "project".into(),
            agent_id: "agent".into(),
            model_id: None,
            task_id: None,
            turn_id: None,
            sequence: 1,
            timestamp: 0,
            kind: "agent_message_chunk".into(),
            data: json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"A result"}}),
            owner: None,
        };
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        assert!(
            matches!(acp_event(&event,&mut outcome),Some(TaskRuntimeEvent::Text { text }) if text == "A result")
        );
        assert_eq!(outcome.summary, "A result");
    }
}

#[cfg(test)]
#[path = "task_runtime/tests.rs"]
mod behavior_tests;
