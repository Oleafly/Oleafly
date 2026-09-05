use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResearchTaskStatus {
    Queued,
    Running,
    AwaitingReview,
    Completed,
    Failed,
    Cancelled,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskTranscriptPage {
    pub events: Vec<TaskTranscriptEvent>,
    pub next_sequence: Option<u64>,
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
        name: String,
        detail: String,
    },
    Artifact {
        artifact: TaskArtifact,
    },
    Usage {
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskApplyRequest {
    pub task_id: String,
    pub expected_project_generation: u64,
    pub selected_paths: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskApplyResult {
    pub task: ResearchTask,
    pub project_state: crate::project::ProjectStateChanged,
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
