//! The helper's side of the research runtime's ports. What only the app can
//! know (trust, where the project is, its linked folders, the model's
//! metadata, the spend so far, which skills are off, a CLI agent's sandboxed
//! launch) comes from the grant the app wrote when it handed the task over.
//! Keys and MCP values come from the app's settings, read again for each
//! task, so a key the user changes while the helper runs is used.
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use oleafly_agent::{AgentEvent, InputTokenSemantics, Usage};
use oleafly_research::builtin::{
    TaskBridge, TaskHost, TaskMcpTool, TaskProvider, UsageSink, WebTools,
};
use oleafly_research::handoff::{GrantedRoot, TaskGrant, TRUST_MCP, TRUST_RESEARCH_TASKS};
use oleafly_research::host::{
    default_git_env, ConnectorSecrets, GitEnv, IsolationEnv, Notification, OwnerKind,
    ProjectLocation, ResearchHost, WorkspaceTools,
};
use oleafly_research::literature::LiteratureClient;
use oleafly_research::mcp::{BridgeServices, LinkedRoots, McpStart};
use oleafly_research::model::{
    ResearchTask, ResearchTaskStatus, TaskRunContext, TaskTranscriptEvent,
};
use oleafly_research::runs::supervisor::SUPERVISOR_FLAG;
use oleafly_research::runs::SupervisorCommand;
use oleafly_research::scheduler::TaskRuntimeFuture;
use oleafly_research::store::TaskStore;
use oleafly_research::task_tools::extra::TaskBinding;
use serde_json::{json, Value};

use super::log::HelperLog;
use super::notify::Notifier;
use crate::agent::desktop_config::{
    self, search_key_from, secret_values, DesktopConfig, McpServer, Prefs,
};
use crate::agent::mcp::{acp_server_specs, McpHub, McpSelection};
use crate::agent::policy::{AllowSet, RunPolicy, WriteMode};
use crate::agent::provider::{resolve, Price, ProviderChoice};
use crate::agent::tools::{
    skill_prompt, web_user_agent, CliSkills, CliWorkspaceTools, SkillAudience, StoreSecrets,
};
use crate::agent::usage_spool::{self, UsageSpoolEvent};

const OPEN_OLEAFLY: &str = "Open Oleafly to continue this task.";
const PROJECT_MOVED: &str = "The project folder is no longer where it was when Oleafly closed.";
const LINKED_MOVED: &str =
    "A linked folder of this project is no longer where it was when Oleafly closed.";
const NO_SEARCH_KEY: &str = "Web search needs a search key. Add one in Oleafly's settings.";
const MAX_WEB_TEXT: usize = 48 * 1024;

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The app's error envelope for a trust code, so the app shows its own
/// message for it.
fn trust_error(code: &str) -> String {
    format!(
        "@oleafly/error:{}",
        json!({"code": code, "params": {}, "detail": null})
    )
}

/// The grant the app wrote for `task_id` when it handed the task over.
pub fn grant_for(store: &TaskStore, task_id: &str) -> Option<TaskGrant> {
    store
        .handoff_record(task_id)
        .ok()
        .flatten()
        .and_then(|record| record.grant)
}

fn daemon_store(tasks_root: &Path) -> Result<TaskStore, String> {
    TaskStore::with_owner_kind(tasks_root.to_path_buf(), OwnerKind::Daemon)
}

/// The grant of a project: from the newest of its tasks the helper holds.
fn project_grant(tasks_root: &Path, project_id: &str) -> Result<TaskGrant, String> {
    let store = daemon_store(tasks_root)?;
    let mut tasks: Vec<ResearchTask> = store
        .daemon_tasks()?
        .into_iter()
        .filter(|task| task.project_id == project_id)
        .collect();
    tasks.sort_by_key(|task| std::cmp::Reverse(task.updated_at));
    tasks
        .iter()
        .find_map(|task| grant_for(&store, &task.id))
        .ok_or_else(|| OPEN_OLEAFLY.to_string())
}

fn task_grant(tasks_root: &Path, task_id: &str) -> Result<TaskGrant, String> {
    grant_for(&daemon_store(tasks_root)?, task_id).ok_or_else(|| OPEN_OLEAFLY.to_string())
}

fn grant_root(grant: &TaskGrant) -> Result<PathBuf, String> {
    let root = PathBuf::from(&grant.project_root);
    if grant.project_root.is_empty() || !root.is_dir() {
        return Err(PROJECT_MOVED.into());
    }
    Ok(root)
}

fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// The skills a task's grant allows.
fn grant_skills(data_root: &Path, resources_dir: Option<&Path>, grant: &TaskGrant) -> CliSkills {
    CliSkills {
        root: data_root.join("skills"),
        pack: grant
            .skills_pack_root
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .or_else(|| resources_dir.map(|dir| dir.join("skills"))),
        disabled: grant
            .disabled_skills
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>(),
    }
}

/// The run supervisor's command: this binary, or the AppImage it runs from
/// (a binary inside the helper's own image mount goes away with it).
pub(crate) fn supervisor_command_for(
    appimage: Option<PathBuf>,
    current_exe: Option<PathBuf>,
) -> Option<SupervisorCommand> {
    let program = appimage.filter(|path| path.is_file()).or(current_exe)?;
    Some(SupervisorCommand {
        program,
        args: vec![SUPERVISOR_FLAG.into()],
    })
}

/// What the helper's tasks spent while it ran them, per task, not yet in
/// the spool (a turn still running).
#[derive(Default)]
pub struct LiveSpend {
    by_task: Mutex<HashMap<String, f64>>,
}

impl LiveSpend {
    fn set(&self, task_id: &str, cost: f64) {
        lock(&self.by_task).insert(task_id.to_string(), cost);
    }

    fn clear(&self, task_id: &str) {
        lock(&self.by_task).remove(task_id);
    }

    fn get(&self, task_id: &str) -> f64 {
        lock(&self.by_task).get(task_id).copied().unwrap_or(0.0)
    }
}

/// The helper's research host.
pub struct DaemonResearchHost {
    tasks_root: PathBuf,
    data_root: PathBuf,
    resources_dir: Option<PathBuf>,
    prefs: Prefs,
    notifier: Arc<Notifier>,
    log: Arc<HelperLog>,
    live: Arc<LiveSpend>,
}

impl DaemonResearchHost {
    pub fn new(
        data_root: &Path,
        resources_dir: Option<PathBuf>,
        prefs: Prefs,
        notifier: Arc<Notifier>,
        log: Arc<HelperLog>,
        live: Arc<LiveSpend>,
    ) -> Self {
        Self {
            tasks_root: data_root.join("research-tasks"),
            data_root: data_root.to_path_buf(),
            resources_dir,
            prefs,
            notifier,
            log,
            live,
        }
    }
}

impl IsolationEnv for DaemonResearchHost {
    fn require_trusted(&self, project_id: &str) -> Result<(), String> {
        let grant = project_grant(&self.tasks_root, project_id)?;
        if grant.allows(TRUST_RESEARCH_TASKS) {
            Ok(())
        } else {
            Err(trust_error(TRUST_RESEARCH_TASKS))
        }
    }

    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String> {
        let grant = project_grant(&self.tasks_root, project_id)?;
        Ok(ProjectLocation {
            root: grant_root(&grant)?,
            linked: grant.linked,
        })
    }

    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String> {
        if !valid_project_id(project_id) {
            return Err("The project id isn't valid.".into());
        }
        let grant = project_grant(&self.tasks_root, project_id)?;
        let root = grant_root(&grant)?;
        if let Some(identity) = crate::app_paths::project_identity(&root, &self.data_root) {
            if crate::app_paths::restore_pending(&root, &identity) {
                return Err("A checkpoint restore of this project is unfinished. Open Oleafly to finish it.".into());
            }
        }
        shared_worktree_lock(&self.data_root, project_id)
    }

    fn git(&self) -> Option<GitEnv> {
        default_git_env()
    }
}

/// A shared hold on the app's project lock
/// (`<data>/project-worktree-locks/<id>.lock`); `None` while a writer has it.
pub(crate) fn shared_worktree_lock(
    data_root: &Path,
    project_id: &str,
) -> Result<Option<Box<dyn std::any::Any + Send>>, String> {
    let locks = data_root.join("project-worktree-locks");
    std::fs::create_dir_all(&locks)
        .map_err(|error| format!("could not open the project lock folder: {error}"))?;
    let path = locks.join(format!("{project_id}.lock"));
    if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("The project lock is a link.".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("could not open the project lock: {error}"))?;
    match fs4::FileExt::try_lock_shared(&file) {
        Ok(()) => Ok(Some(Box::new(file))),
        Err(fs4::TryLockError::WouldBlock) => Ok(None),
        Err(fs4::TryLockError::Error(error)) => {
            Err(format!("could not take the project lock: {error}"))
        }
    }
}

impl ResearchHost for DaemonResearchHost {
    fn admit_project(&self, project_id: &str) -> Result<(), String> {
        if !valid_project_id(project_id) {
            return Err("The project id isn't valid.".into());
        }
        let grant = project_grant(&self.tasks_root, project_id)?;
        grant_root(&grant)?;
        self.require_trusted(project_id)
    }

    fn project_present(&self, project_id: &str) -> bool {
        project_grant(&self.tasks_root, project_id)
            .and_then(|grant| grant_root(&grant))
            .is_ok()
    }

    fn unavailable_skill(
        &self,
        project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String> {
        if skill_ids.is_empty() {
            return Ok(None);
        }
        let grant = project_grant(&self.tasks_root, project_id)?;
        let skills = grant_skills(&self.data_root, self.resources_dir.as_deref(), &grant);
        Ok(skill_ids.iter().find_map(|id| {
            skill_prompt(
                &skills,
                Some(project_id),
                std::slice::from_ref(id),
                SkillAudience::Task,
            )
            .err()
        }))
    }

    fn task_changed(&self, task: &ResearchTask) {
        let status = serde_json::to_value(task.status)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        self.log.event(
            "info",
            "task_changed",
            &[("task", &task.id), ("status", &status)],
        );
        if matches!(
            task.status,
            ResearchTaskStatus::Completed
                | ResearchTaskStatus::Failed
                | ResearchTaskStatus::Cancelled
                | ResearchTaskStatus::AwaitingReview
                | ResearchTaskStatus::PlanReady
        ) {
            self.live.clear(&task.id);
        }
    }

    fn transcript_appended(&self, _event: &TaskTranscriptEvent) {}

    fn owner(&self) -> OwnerKind {
        OwnerKind::Daemon
    }

    fn supervisor_command(&self) -> Option<SupervisorCommand> {
        let appimage = if cfg!(target_os = "linux") {
            std::env::var_os("APPIMAGE").map(PathBuf::from)
        } else {
            None
        };
        supervisor_command_for(appimage, std::env::current_exe().ok())
    }

    fn notify(&self, notification: Notification) {
        if !self.prefs.notifications {
            return;
        }
        // An open app tells the user itself (finishing a task clears its
        // reclaim request, so that flag can't say the app is open).
        if !super::control::app_is_open(&super::paths::helper_paths(&self.data_root).app_open) {
            self.notifier.notify(&notification);
        }
    }

    fn keep_awake_enabled(&self) -> bool {
        self.prefs.keep_awake
    }

    fn task_spend_usd(&self, task_id: &str) -> Option<f64> {
        let store = daemon_store(&self.tasks_root).ok()?;
        let record = store.handoff_record(task_id).ok().flatten()?;
        let granted = record
            .grant
            .as_ref()
            .and_then(|grant| grant.spent_usd)
            .unwrap_or(0.0);
        let spooled: f64 = usage_spool::read_since(&self.data_root, task_id, record.created_at)
            .unwrap_or_default()
            .iter()
            .filter_map(|event| event.cost_usd)
            .sum();
        Some(granted + spooled + self.live.get(task_id))
    }

    fn workspace_tools(&self) -> Option<Arc<dyn WorkspaceTools>> {
        Some(Arc::new(CliWorkspaceTools))
    }
}

/// Linked folders as the grant recorded them; a folder that moved is refused.
pub struct GrantLinkedRoots {
    roots: Vec<GrantedRoot>,
}

impl GrantLinkedRoots {
    pub fn new(grant: &TaskGrant) -> Self {
        Self {
            roots: grant.linked_roots.clone(),
        }
    }
}

impl LinkedRoots for GrantLinkedRoots {
    fn resolve(&self, _project_id: &str, root_id: &str) -> Result<PathBuf, String> {
        let root = self
            .roots
            .iter()
            .find(|root| root.id == root_id)
            .ok_or_else(|| "This linked folder was not granted to the task.".to_string())?;
        let path = PathBuf::from(&root.canonical_path);
        match dunce::canonicalize(&path) {
            Ok(current) if current == path && current.is_dir() => Ok(current),
            _ => Err(LINKED_MOVED.into()),
        }
    }
}

/// Records a task's model use in the usage spool: one event per turn,
/// cost from the model's price.
pub struct SpoolUsage {
    data_root: PathBuf,
    task_id: String,
    project_id: String,
    provider: String,
    model: String,
    price: Option<Price>,
    live: Arc<LiveSpend>,
    log: Arc<HelperLog>,
    state: Mutex<SpoolState>,
}

#[derive(Default)]
struct SpoolState {
    /// Usage of the turns that ended (a run restarts its totals per turn).
    finished: Usage,
    latest: Option<Usage>,
    recorded: bool,
}

fn add(left: Usage, right: Usage) -> Usage {
    Usage {
        input: left.input.saturating_add(right.input),
        output: left.output.saturating_add(right.output),
        cache_read: match (left.cache_read, right.cache_read) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
        },
        cache_write: match (left.cache_write, right.cache_write) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
        },
        input_semantics: if right.input_semantics == InputTokenSemantics::Unknown {
            left.input_semantics
        } else {
            right.input_semantics
        },
        ..Usage::default()
    }
}

impl SpoolUsage {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        data_root: &Path,
        task_id: &str,
        project_id: &str,
        provider: &str,
        model: &str,
        price: Option<Price>,
        live: Arc<LiveSpend>,
        log: Arc<HelperLog>,
    ) -> Self {
        Self {
            data_root: data_root.to_path_buf(),
            task_id: task_id.into(),
            project_id: project_id.into(),
            provider: provider.into(),
            model: model.into(),
            price,
            live,
            log,
            state: Mutex::new(SpoolState::default()),
        }
    }

    fn total(state: &SpoolState) -> Usage {
        state
            .latest
            .map_or(state.finished, |latest| add(state.finished, latest))
    }

    fn cost(&self, usage: &Usage) -> Option<f64> {
        self.price.map(|price| price.cost(usage))
    }
}

impl UsageSink for SpoolUsage {
    fn observe(&self, event: &AgentEvent) {
        let AgentEvent::Usage { usage, .. } = event else {
            return;
        };
        let mut state = lock(&self.state);
        if state.recorded {
            return;
        }
        if let Some(latest) = state.latest {
            // A new turn starts its totals again.
            if usage.input < latest.input || usage.output < latest.output {
                state.finished = add(state.finished, latest);
            }
        }
        state.latest = Some(*usage);
        if let Some(cost) = self.cost(&Self::total(&state)) {
            self.live.set(&self.task_id, cost);
        }
    }

    fn finish(&self, status: &str) {
        let mut state = lock(&self.state);
        if state.recorded {
            return;
        }
        state.recorded = true;
        let total = Self::total(&state);
        drop(state);
        self.live.clear(&self.task_id);
        if total.input == 0 && total.output == 0 {
            return;
        }
        let event = UsageSpoolEvent {
            id: usage_spool::event_id("daemon"),
            source: "daemon".into(),
            task_id: Some(self.task_id.clone()),
            project_id: Some(self.project_id.clone()),
            project_path: None,
            provider: self.provider.clone(),
            model: self.model.clone(),
            input_tokens: Some(total.input),
            output_tokens: Some(total.output),
            cache_read_tokens: total.cache_read,
            cache_write_tokens: total.cache_write,
            cost_usd: self.cost(&total),
            status: status.into(),
            at: super::state::now_ms(),
        };
        if let Err(error) = usage_spool::append(&self.data_root, &event) {
            self.log
                .event("error", "usage_spool", &[("message", &error.to_string())]);
        }
    }
}

/// Web reads for tasks with network permission.
pub struct CliWebTools {
    client: oleafly_agent::tools::web::WebClient,
    data_root: PathBuf,
}

impl CliWebTools {
    pub fn new(data_root: &Path) -> Option<Self> {
        oleafly_agent::tools::web::WebClient::new(&web_user_agent())
            .ok()
            .map(|client| Self {
                client,
                data_root: data_root.to_path_buf(),
            })
    }
}

#[async_trait::async_trait]
impl WebTools for CliWebTools {
    async fn fetch(&self, url: &str) -> Result<Value, String> {
        let options = oleafly_agent::tools::web::WebFetchOptions {
            user_agent: web_user_agent(),
            ..Default::default()
        };
        let page = oleafly_agent::tools::web::web_fetch(&self.client, url, &options)
            .await
            .map_err(|error| error.to_string())?;
        let truncated = page.truncated || page.markdown.len() > MAX_WEB_TEXT;
        let text = oleafly_research::task_tools::bounded(&page.markdown, MAX_WEB_TEXT);
        Ok(json!({
            "url": page.url,
            "title": page.title,
            "contentType": page.content_type,
            "text": text,
            "truncated": truncated,
        }))
    }

    async fn search(&self, query: &str) -> Result<Value, String> {
        let root = self.data_root.clone();
        let key = tokio::task::spawn_blocking(move || {
            desktop_config::load(&root)
                .ok()
                .and_then(|config| search_key_from(&config.connector))
        })
        .await
        .ok()
        .flatten()
        .ok_or_else(|| NO_SEARCH_KEY.to_string())?;
        let hits = oleafly_agent::tools::web::web_search(&self.client, query, &key)
            .await
            .map_err(|error| error.to_string())?;
        Ok(json!({ "results": hits }))
    }
}

/// The helper's task host.
pub struct DaemonTaskHost {
    data_root: PathBuf,
    tasks_root: PathBuf,
    resources_dir: Option<PathBuf>,
    log: Arc<HelperLog>,
    live: Arc<LiveSpend>,
    web: Option<Arc<dyn WebTools>>,
    literature: Arc<LiteratureClient>,
}

impl DaemonTaskHost {
    pub fn new(
        data_root: &Path,
        resources_dir: Option<PathBuf>,
        log: Arc<HelperLog>,
        live: Arc<LiveSpend>,
    ) -> Self {
        Self {
            data_root: data_root.to_path_buf(),
            tasks_root: data_root.join("research-tasks"),
            resources_dir,
            log,
            live,
            web: CliWebTools::new(data_root).map(|web| Arc::new(web) as Arc<dyn WebTools>),
            literature: LiteratureClient::new(data_root.join("literature-cache.sqlite3")),
        }
    }

    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    pub fn tasks_root(&self) -> &Path {
        &self.tasks_root
    }

    pub fn log(&self) -> &Arc<HelperLog> {
        &self.log
    }

    pub(crate) fn grant(&self, task_id: &str) -> Result<TaskGrant, String> {
        task_grant(&self.tasks_root, task_id)
    }

    /// The app's settings now; their secrets join the log's list.
    pub(crate) fn config(&self) -> Result<DesktopConfig, String> {
        let config = desktop_config::load(&self.data_root).map_err(|error| error.to_string())?;
        self.log.add_secrets(secret_values(&config));
        Ok(config)
    }

    fn skills(&self, grant: &TaskGrant) -> CliSkills {
        grant_skills(&self.data_root, self.resources_dir.as_deref(), grant)
    }

    /// The servers research tasks may use, as the user set them.
    fn task_servers(&self, config: &DesktopConfig) -> Vec<McpServer> {
        config
            .mcp_servers
            .iter()
            .filter(|server| config.task_mcp_servers.contains(&server.name))
            .cloned()
            .collect()
    }
}

impl TaskHost for DaemonTaskHost {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String> {
        if context.skill_ids.is_empty() {
            return Ok(String::new());
        }
        let grant = self.grant(&context.task_id)?;
        skill_prompt(
            &self.skills(&grant),
            Some(&context.project_id),
            &context.skill_ids,
            SkillAudience::Task,
        )
    }

    fn skill_read_paths(&self, context: &TaskRunContext) -> Vec<PathBuf> {
        self.grant(&context.task_id)
            .map(|grant| self.skills(&grant).read_paths(&context.skill_ids))
            .unwrap_or_default()
    }

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        let data_root = self.data_root.clone();
        let tasks_root = self.tasks_root.clone();
        let log = self.log.clone();
        let live = self.live.clone();
        Box::pin(async move {
            let grant = task_grant(&tasks_root, &context.task_id)?;
            let root = data_root.clone();
            let config = tokio::task::spawn_blocking(move || desktop_config::load(&root))
                .await
                .map_err(|_| "Oleafly's settings could not be read.".to_string())?
                .map_err(|error| error.to_string())?;
            log.add_secrets(secret_values(&config));
            let choice = ProviderChoice {
                provider: Some(context.agent_id.clone()),
                model: Some(context.model_id.clone()),
                effort: None,
            };
            // The helper never takes keys from its environment.
            let mut resolved =
                resolve(&data_root, &config, &choice, &|_| None).map_err(|error| {
                    let error: crate::contract::CliError = error.into();
                    error.message
                })?;
            log.add_secrets([resolved.resolved.credential.clone()]);
            if let Some(entry) = &grant.model_metadata {
                resolved.resolved.caps = oleafly_agent::ModelCaps::from_metadata_json(entry);
                resolved.price = Price::from_entry(entry).or(resolved.price);
            }
            let usage = SpoolUsage::new(
                &data_root,
                &context.task_id,
                &context.project_id,
                &resolved.resolved.provider_id,
                &resolved.resolved.model_id,
                resolved.price,
                live,
                log,
            );
            Ok(TaskProvider {
                client: oleafly_agent::build_client().map_err(|error| error.to_string())?,
                resolved: resolved.resolved,
                usage: Box::new(usage),
            })
        })
    }

    fn bridge(
        &self,
        context: TaskRunContext,
        binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
        let grant = self.grant(&context.task_id);
        let config = self.config();
        let skills = grant
            .as_ref()
            .ok()
            .map(|grant| self.skills(grant))
            .unwrap_or_default();
        Box::pin(async move {
            let grant = grant?;
            if !grant.allows(TRUST_MCP) {
                return Err(trust_error(TRUST_MCP));
            }
            let config = config?;
            let bridge = oleafly_research::mcp::serve(McpStart {
                project_id: context.project_id.clone(),
                root: PathBuf::from(&context.execution_root),
                allowed: Some(context.allowed_paths.clone()),
                linked_roots: grant.linked_root_infos(),
                services: BridgeServices {
                    skills: Arc::new(skills),
                    linked: Arc::new(GrantLinkedRoots::new(&grant)),
                    secrets: Arc::new(StoreSecrets::from_config(&config)),
                },
                task: binding,
            })
            .await?;
            Ok(Arc::new(bridge) as Arc<dyn TaskBridge>)
        })
    }

    fn linked_folders(
        &self,
        context: &TaskRunContext,
    ) -> Vec<oleafly_sandbox::profile::LinkedFolder> {
        let Ok(grant) = self.grant(&context.task_id) else {
            return Vec::new();
        };
        let linked = GrantLinkedRoots::new(&grant);
        grant
            .linked_roots
            .iter()
            .filter_map(|root| {
                linked
                    .resolve(&context.project_id, &root.id)
                    .ok()
                    .map(|path| oleafly_sandbox::profile::LinkedFolder {
                        id: root.id.clone(),
                        label: root.label.clone(),
                        path,
                    })
            })
            .collect()
    }

    fn project_root(&self, project_id: &str) -> Option<PathBuf> {
        project_grant(&self.tasks_root, project_id)
            .ok()
            .and_then(|grant| grant_root(&grant).ok())
    }

    fn linked_root(&self, project_id: &str, root_id: &str) -> Option<PathBuf> {
        let grant = project_grant(&self.tasks_root, project_id).ok()?;
        GrantLinkedRoots::new(&grant)
            .resolve(project_id, root_id)
            .ok()
    }

    fn web(&self) -> Option<Arc<dyn WebTools>> {
        self.web.clone()
    }

    fn task_mcp_tools(&self, context: &TaskRunContext) -> TaskRuntimeFuture<Vec<TaskMcpTool>> {
        let config = self.config();
        let brief = context.brief.clone();
        let log = self.log.clone();
        let grant = self.grant(&context.task_id);
        Box::pin(async move {
            let config = config?;
            if !grant.is_ok_and(|grant| grant.allows(TRUST_MCP)) {
                return Ok(Vec::new());
            }
            let names = config.task_mcp_servers.clone();
            if names.is_empty() {
                return Ok(Vec::new());
            }
            let policy = RunPolicy {
                allow: AllowSet {
                    write: false,
                    commands: brief.permissions.commands
                        != oleafly_research::model::CommandPolicy::Off,
                    network: brief.permissions.network,
                },
                mode: WriteMode::ReadOnly,
                question: false,
            };
            let secrets = secret_values(&config);
            let (hub, warnings) = McpHub::connect(
                &config.mcp_servers,
                &policy,
                &McpSelection::Named(names),
                &secrets,
                &oleafly_agent::CancellationToken::new(),
            )
            .await;
            for warning in warnings {
                log.event("warning", "task_mcp", &[("message", &warning)]);
            }
            Ok(Arc::new(hub).as_task_tools())
        })
    }

    fn task_mcp_servers(&self, context: &TaskRunContext) -> Vec<Value> {
        if !self
            .grant(&context.task_id)
            .is_ok_and(|grant| grant.allows(TRUST_MCP))
        {
            return Vec::new();
        }
        self.config()
            .map(|config| acp_server_specs(&self.task_servers(&config)))
            .unwrap_or_default()
    }

    fn literature(&self) -> Arc<LiteratureClient> {
        self.literature.clone()
    }

    fn secrets(&self) -> Arc<dyn ConnectorSecrets> {
        match self.config() {
            Ok(config) => Arc::new(StoreSecrets::from_config(&config)),
            Err(_) => Arc::new(StoreSecrets::default()),
        }
    }
}

#[cfg(test)]
mod tests;
