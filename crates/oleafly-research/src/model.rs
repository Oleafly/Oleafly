//! Research task records shared by the app, the CLI and the daemon.
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::host::OwnerKind;
pub use crate::RunProfile;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResearchTaskStatus {
    Queued,
    Running,
    AwaitingReview,
    Completed,
    Failed,
    Cancelled,
    /// The agent wrote its plan and waits for the user to approve it.
    PlanReady,
}

impl ResearchTaskStatus {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "awaiting_review" => Ok(Self::AwaitingReview),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "plan_ready" => Ok(Self::PlanReady),
            _ => Err(format!("unknown research task state: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskIsolationKind {
    GitWorktree,
    StagedProject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    /// The project had a link to a file inside it here; the copy holds the
    /// file itself. Review shows changes to it, but they cannot be applied.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub resolved_link: bool,
}

/// A project file the task's copy left out, and why.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    TooLarge,
    LinkOutside,
    LinkToFolder,
    BrokenLink,
    NotUnicode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskIsolation {
    pub kind: TaskIsolationKind,
    pub execution_root: String,
    pub baseline_root: String,
    pub source_revision: String,
    pub baseline_hash: String,
    pub baseline: Vec<ManifestEntry>,
    pub allowed_paths: Vec<String>,
    pub created_at: i64,
    /// Project files left out of the copy.
    #[serde(default)]
    pub skipped: Vec<SkippedEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskFileChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskFileChange {
    pub path: String,
    pub kind: TaskFileChangeKind,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    pub before_size: Option<u64>,
    pub after_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifact {
    pub path: String,
    pub label: String,
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskResultMetadata {
    pub summary: String,
    pub changed_files: Vec<TaskFileChange>,
    pub artifacts: Vec<TaskArtifact>,
    pub native_session_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskReviewResult {
    pub selected_paths: Vec<String>,
    pub applied_at: i64,
    pub project_mutation_generation: u64,
}

/// What a task is for and how far it may go. Every field has a default, so
/// tasks saved before briefs existed read as the default brief.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ResearchBrief {
    pub goal: String,
    pub success_criteria: Vec<String>,
    pub scope: String,
    pub constraints: String,
    pub primary_metric: Option<PrimaryMetric>,
    pub review_plan_first: bool,
    pub permissions: TaskPermissions,
    pub budget: TaskBudget,
    pub profile: RunProfile,
    pub compute: ComputeTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryMetric {
    pub name: String,
    pub goal: MetricGoal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetricGoal {
    Maximize,
    Minimize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskPermissions {
    /// Commands and runs may reach the network.
    pub network: bool,
    pub commands: CommandPolicy,
    pub desktop_apps: bool,
}

/// Whether the task's commands run, wait for the user's approval, or never run.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandPolicy {
    #[default]
    Allow,
    Ask,
    Off,
}

pub const DEFAULT_TIME_BUDGET_MINUTES: u32 = 120;
pub const DEFAULT_RUN_TIMEOUT_MINUTES: u32 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskBudget {
    /// Active time; waiting for approvals does not count. 5–1,440.
    pub wall_clock_minutes: u32,
    /// Stop when the task's model spend reaches this many US dollars.
    pub usd_cap: Option<f64>,
    pub max_runs: Option<u32>,
    /// Each run stops after this long. 1–720.
    pub run_timeout_minutes: u32,
}

impl Default for TaskBudget {
    fn default() -> Self {
        Self {
            wall_clock_minutes: DEFAULT_TIME_BUDGET_MINUTES,
            usd_cap: None,
            max_runs: None,
            run_timeout_minutes: DEFAULT_RUN_TIMEOUT_MINUTES,
        }
    }
}

/// Where the task's runs execute: this computer, or a configured target.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ComputeTarget {
    pub executor: String,
    pub target: Option<String>,
    pub resources: Option<Resources>,
}

impl Default for ComputeTarget {
    fn default() -> Self {
        Self {
            executor: "local".into(),
            target: None,
            resources: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Resources {
    pub time_minutes: Option<u32>,
    pub partition: Option<String>,
    pub gpus: Option<u32>,
    pub cpus: Option<u32>,
    pub memory_gb: Option<u32>,
    /// Slurm account and quality of service, when the cluster needs them.
    pub account: Option<String>,
    pub qos: Option<String>,
}

/// What a running task is doing now.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    Preparing,
    Planning,
    Working,
    WaitingRuns,
    WaitingApproval,
    WrappingUp,
    CheckingEvidence,
}

impl TaskPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Planning => "planning",
            Self::Working => "working",
            Self::WaitingRuns => "waiting_runs",
            Self::WaitingApproval => "waiting_approval",
            Self::WrappingUp => "wrapping_up",
            Self::CheckingEvidence => "checking_evidence",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Preparing,
            Self::Planning,
            Self::Working,
            Self::WaitingRuns,
            Self::WaitingApproval,
            Self::WrappingUp,
            Self::CheckingEvidence,
        ]
        .into_iter()
        .find(|phase| phase.as_str() == value)
    }
}

/// Why a task stopped before the agent finished: a budget ran out.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    BudgetTime,
    BudgetCost,
    BudgetRuns,
}

impl StopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BudgetTime => "budget_time",
            Self::BudgetCost => "budget_cost",
            Self::BudgetRuns => "budget_runs",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [Self::BudgetTime, Self::BudgetCost, Self::BudgetRuns]
            .into_iter()
            .find(|reason| reason.as_str() == value)
    }
}

/// Retry in the same workspace, or from a fresh copy of the project.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RetryMode {
    Resume,
    #[default]
    Fresh,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResumeReason {
    Retry,
    PlanApproved,
    Handoff,
}

/// How the next generation of a task starts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PendingStart {
    /// In the saved workspace, with a new conversation seeded from the record.
    Resume {
        isolation: TaskIsolation,
        reason: ResumeReason,
        #[serde(default)]
        previous_native_session_id: Option<String>,
    },
    /// From a fresh copy, carrying the research record over from `carry_from`.
    Fresh { carry_from: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
}

/// The checks run on a task's result before review (never blocking it).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceReport {
    pub checked_at: i64,
    pub checks: Vec<EvidenceCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceCheck {
    pub id: EvidenceCheckId,
    pub status: EvidenceStatus,
    pub items: Vec<EvidenceItem>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCheckId {
    Build,
    References,
    Bibliography,
    Numbers,
    Figures,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    Pass,
    Warn,
    Skipped,
}

/// One finding. `code` names the message the UI shows; `params` fill it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceItem {
    pub code: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub params: BTreeMap<String, String>,
}

/// A supervised run's state.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Starting,
    Running,
    Succeeded,
    Failed,
    TimedOut,
    Cancelled,
    Lost,
}

impl RunState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::TimedOut => "timed_out",
            Self::Cancelled => "cancelled",
            Self::Lost => "lost",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        [
            Self::Starting,
            Self::Running,
            Self::Succeeded,
            Self::Failed,
            Self::TimedOut,
            Self::Cancelled,
            Self::Lost,
        ]
        .into_iter()
        .find(|state| state.as_str() == value)
        .ok_or_else(|| format!("unknown run state: {value}"))
    }

    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Starting | Self::Running)
    }
}

/// A run the task started (`research_task_runs`). The command is stored as
/// text; environment values never are.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub task_id: String,
    pub run_id: String,
    pub execution_generation: u64,
    pub name: String,
    pub executor: String,
    pub command: String,
    pub cwd_rel: String,
    pub state: RunState,
    pub exit_code: Option<i32>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub run_dir: String,
    pub metrics: BTreeMap<String, f64>,
    pub reported: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalKind {
    Command,
    Run,
    Mcp,
}

impl ApprovalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::Run => "run",
            Self::Mcp => "mcp",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "command" => Ok(Self::Command),
            "run" => Ok(Self::Run),
            "mcp" => Ok(Self::Mcp),
            _ => Err(format!("unknown approval kind: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Expired,
    Withdrawn,
}

impl ApprovalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Withdrawn => "withdrawn",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        [
            Self::Pending,
            Self::Approved,
            Self::Denied,
            Self::Expired,
            Self::Withdrawn,
        ]
        .into_iter()
        .find(|status| status.as_str() == value)
        .ok_or_else(|| format!("unknown approval status: {value}"))
    }
}

/// A request for the user's approval (`research_task_approvals`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    pub id: String,
    pub task_id: String,
    pub execution_generation: u64,
    pub kind: ApprovalKind,
    pub summary: String,
    pub detail: String,
    pub status: ApprovalStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub decided_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTask {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub runtime_id: String,
    pub agent_id: String,
    pub model_id: String,
    pub skill_ids: Vec<String>,
    pub dependency_ids: Vec<String>,
    pub status: ResearchTaskStatus,
    pub execution_generation: u64,
    pub session_id: Option<String>,
    pub native_session_id: Option<String>,
    pub source_revision: Option<String>,
    pub isolation: Option<TaskIsolation>,
    pub error: Option<String>,
    pub result: Option<TaskResultMetadata>,
    pub review: Option<TaskReviewResult>,
    pub start_requested: bool,
    pub cancel_requested: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub brief: ResearchBrief,
    /// The research record lives in `research/<record_slug>/`.
    #[serde(default)]
    pub record_slug: String,
    /// Start no earlier than this time (epoch ms).
    #[serde(default)]
    pub run_after: Option<i64>,
    #[serde(default)]
    pub keep_running_after_quit: bool,
    #[serde(default)]
    pub owner: OwnerKind,
    #[serde(default)]
    pub phase: Option<TaskPhase>,
    #[serde(default)]
    pub plan_approved: bool,
    #[serde(default)]
    pub stop_reason: Option<StopReason>,
    #[serde(default)]
    pub evidence: Option<EvidenceReport>,
    #[serde(default)]
    pub pending_approvals: u32,
    /// Active time used so far, across generations since the last fresh start.
    #[serde(default)]
    pub active_ms: u64,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
    #[serde(default)]
    pub pending_start: Option<PendingStart>,
    // 0.4.8 L: work the background helper runs and the app takes back.
    /// The app asked the helper to give this task back at its next step.
    #[serde(default)]
    pub reclaim_requested: bool,
    /// The generation this one continues (a resume or a handoff).
    #[serde(default)]
    pub resumed_from: Option<u64>,
}

impl ResearchTask {
    /// `research/<slug>`: where the task keeps its brief, plan and ledger.
    pub fn record_dir(&self) -> String {
        crate::record::record_dir(&self.record_slug)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTaskDraft {
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub runtime_id: String,
    pub agent_id: String,
    pub model_id: String,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub dependency_ids: Vec<String>,
    #[serde(default)]
    pub brief: Option<ResearchBrief>,
    #[serde(default)]
    pub run_after: Option<i64>,
    #[serde(default)]
    pub keep_running_after_quit: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTaskEdit {
    pub title: String,
    pub prompt: String,
    pub runtime_id: String,
    pub agent_id: String,
    pub model_id: String,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub dependency_ids: Vec<String>,
    #[serde(default)]
    pub brief: Option<ResearchBrief>,
    #[serde(default)]
    pub run_after: Option<i64>,
    #[serde(default)]
    pub keep_running_after_quit: bool,
}

/// The workspace a task runs in, without the baseline manifest or the
/// allowed-path list (which can be large).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskIsolationSummary {
    pub kind: TaskIsolationKind,
    pub execution_root: String,
    pub source_revision: String,
    pub baseline_hash: String,
    pub file_count: usize,
    pub created_at: i64,
    /// Project files the copy left out (at most 200 listed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<SkippedEntry>,
}

impl From<&TaskIsolation> for TaskIsolationSummary {
    fn from(isolation: &TaskIsolation) -> Self {
        Self {
            kind: isolation.kind,
            execution_root: isolation.execution_root.clone(),
            source_revision: isolation.source_revision.clone(),
            baseline_hash: isolation.baseline_hash.clone(),
            file_count: isolation.baseline.len(),
            created_at: isolation.created_at,
            skipped: isolation.skipped.iter().take(200).cloned().collect(),
        }
    }
}

/// What commands and events send to the webview: the task without the
/// isolation manifest and without the pending start.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTaskView {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub runtime_id: String,
    pub agent_id: String,
    pub model_id: String,
    pub skill_ids: Vec<String>,
    pub dependency_ids: Vec<String>,
    pub status: ResearchTaskStatus,
    pub execution_generation: u64,
    pub session_id: Option<String>,
    pub native_session_id: Option<String>,
    pub source_revision: Option<String>,
    pub isolation: Option<TaskIsolationSummary>,
    pub error: Option<String>,
    pub result: Option<TaskResultMetadata>,
    pub review: Option<TaskReviewResult>,
    pub start_requested: bool,
    pub cancel_requested: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub brief: ResearchBrief,
    pub record_slug: String,
    pub record_dir: String,
    pub run_after: Option<i64>,
    pub keep_running_after_quit: bool,
    pub owner: OwnerKind,
    pub phase: Option<TaskPhase>,
    pub plan_approved: bool,
    pub stop_reason: Option<StopReason>,
    pub evidence: Option<EvidenceReport>,
    pub pending_approvals: u32,
    pub active_ms: u64,
    pub todos: Vec<TodoItem>,
    // 0.4.8 L
    #[serde(default)]
    pub reclaim_requested: bool,
    #[serde(default)]
    pub resumed_from: Option<u64>,
}

impl From<&ResearchTask> for ResearchTaskView {
    fn from(task: &ResearchTask) -> Self {
        Self {
            id: task.id.clone(),
            project_id: task.project_id.clone(),
            title: task.title.clone(),
            prompt: task.prompt.clone(),
            runtime_id: task.runtime_id.clone(),
            agent_id: task.agent_id.clone(),
            model_id: task.model_id.clone(),
            skill_ids: task.skill_ids.clone(),
            dependency_ids: task.dependency_ids.clone(),
            status: task.status,
            execution_generation: task.execution_generation,
            session_id: task.session_id.clone(),
            native_session_id: task.native_session_id.clone(),
            source_revision: task.source_revision.clone(),
            isolation: task.isolation.as_ref().map(TaskIsolationSummary::from),
            error: task.error.clone(),
            result: task.result.clone(),
            review: task.review.clone(),
            start_requested: task.start_requested,
            cancel_requested: task.cancel_requested,
            created_at: task.created_at,
            updated_at: task.updated_at,
            started_at: task.started_at,
            finished_at: task.finished_at,
            brief: task.brief.clone(),
            record_slug: task.record_slug.clone(),
            record_dir: task.record_dir(),
            run_after: task.run_after,
            keep_running_after_quit: task.keep_running_after_quit,
            owner: task.owner,
            phase: task.phase,
            plan_approved: task.plan_approved,
            stop_reason: task.stop_reason,
            evidence: task.evidence.clone(),
            pending_approvals: task.pending_approvals,
            active_ms: task.active_ms,
            todos: task.todos.clone(),
            reclaim_requested: task.reclaim_requested,
            resumed_from: task.resumed_from,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskTranscriptEvent {
    pub task_id: String,
    pub execution_generation: u64,
    pub sequence: u64,
    pub event: TaskRuntimeEvent,
    pub created_at: i64,
}

/// Text added to a transcript row since the last update, sent only to the
/// windows that watch the task.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskTranscriptDelta {
    pub task_id: String,
    pub execution_generation: u64,
    pub sequence: u64,
    /// `text` or `reasoning`.
    pub kind: String,
    pub append: String,
    pub created_at: i64,
    /// The row's text length after this append, in UTF-16 units (what
    /// JavaScript counts), so a window can tell what it already has.
    pub text_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskTranscriptPage {
    pub events: Vec<TaskTranscriptEvent>,
    pub next_sequence: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolPhase {
    #[default]
    Request,
    Result,
    Update,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskRuntimeEvent {
    SessionBound {
        native_session_id: String,
    },
    Status {
        message: String,
    },
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    Tool {
        #[serde(default)]
        call_id: Option<String>,
        name: String,
        #[serde(default)]
        phase: ToolPhase,
        detail: String,
        #[serde(default)]
        status: Option<String>,
    },
    Artifact {
        artifact: TaskArtifact,
    },
    Usage {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    /// A supervised run changed state.
    Run {
        run_id: String,
        name: String,
        state: RunState,
        #[serde(default)]
        exit_code: Option<i32>,
    },
    /// A request for the user's approval changed state.
    Approval {
        approval_id: String,
        /// Not `kind`: that name tags the event.
        approval_kind: ApprovalKind,
        status: ApprovalStatus,
        summary: String,
    },
    Phase {
        phase: TaskPhase,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeOutcome {
    pub summary: String,
    #[serde(default)]
    pub artifacts: Vec<TaskArtifact>,
    pub native_session_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunContext {
    pub task_id: String,
    pub execution_generation: u64,
    pub session_id: String,
    pub project_id: String,
    pub execution_root: String,
    pub title: String,
    pub prompt: String,
    pub runtime_id: String,
    pub agent_id: String,
    pub model_id: String,
    pub skill_ids: Vec<String>,
    pub source_revision: String,
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub brief: ResearchBrief,
    /// `research/<slug>`, relative to the execution root.
    #[serde(default)]
    pub record_dir: String,
    #[serde(default)]
    pub dependencies: Vec<DependencyResult>,
    #[serde(default)]
    pub resume: Option<ResumeContext>,
    /// Write the plan and stop; no runs or other changes yet.
    #[serde(default)]
    pub plan_phase: bool,
    /// The workspace a fresh retry carried the record over from.
    #[serde(default)]
    pub carry_from: Option<String>,
    /// 0.4.8 I: the brief allows desktop apps and someone is there to
    /// approve them (see [`task_desktop_apps_conflict`]).
    #[serde(default)]
    pub desktop_apps: bool,
    /// 0.4.8 L: set when this generation continues a handoff: the saved
    /// conversation, an interrupted turn and a CLI agent's session.
    #[serde(default)]
    pub handoff: Option<HandoffResume>,
}

// 0.4.8 L: what a generation continues from, and what a suspended one leaves.
/// How a generation that continues a handoff picks up.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffResume {
    /// The generation that handed the task over.
    pub from_generation: u64,
    /// The saved conversation, a file name beside the workspace.
    #[serde(default)]
    pub conversation: Option<String>,
    /// The previous owner stopped in the middle of a turn.
    #[serde(default)]
    pub turn_interrupted: bool,
    /// A CLI agent's own session and home to resume.
    #[serde(default)]
    pub acp: Option<crate::handoff::AcpHandoff>,
}

/// What a generation that suspended for a handoff leaves for the next owner.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspendState {
    /// The saved conversation (a file name beside the workspace).
    #[serde(default)]
    pub conversation: Option<String>,
    /// The turn was cut short.
    #[serde(default)]
    pub turn_interrupted: bool,
    #[serde(default)]
    pub acp: Option<crate::handoff::AcpHandoff>,
}

// 0.4.8 I: desktop apps ask the user before every action, so a task that
// may run with nobody at the computer can't use them.
/// The error code when a task can't use desktop apps: scheduled tasks and
/// tasks that keep running after Oleafly closes have nobody to approve.
pub fn task_desktop_apps_conflict(
    desktop_apps: bool,
    keep_running_after_quit: bool,
    scheduled: bool,
) -> Option<&'static str> {
    (desktop_apps && (keep_running_after_quit || scheduled))
        .then_some("desktop_apps.task_unattended")
}

/// A finished task this one builds on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyResult {
    pub task_id: String,
    pub title: String,
    /// At most 2,000 characters.
    pub summary: String,
    pub record_dir: String,
}

/// What a resumed generation is told about the work so far.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResumeContext {
    pub reason: ResumeReason,
    pub handoff: String,
    pub plan: String,
    pub ledger_tail: String,
    pub previous_native_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskApplyRequest {
    pub task_id: String,
    pub expected_project_generation: u64,
    pub selected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPreviewContent {
    pub exists: bool,
    pub text: Option<String>,
    pub base64: Option<String>,
    pub media_type: Option<String>,
    pub binary: bool,
    pub truncated: bool,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilePreview {
    pub path: String,
    pub change: TaskFileChangeKind,
    pub before: TaskPreviewContent,
    pub after: TaskPreviewContent,
    pub project_sha256: Option<String>,
    pub base_is_current: bool,
    pub merges_with_shared: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifactPreview {
    pub artifact: TaskArtifact,
    pub content: TaskPreviewContent,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
