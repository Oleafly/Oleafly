use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{ResearchTask, TaskTranscriptDelta, TaskTranscriptEvent};
use crate::runs::{supervisor::SUPERVISOR_FLAG, SupervisorCommand};
use crate::scheduler::TaskRuntimeFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLocation {
    pub root: PathBuf,
    pub linked: bool,
}

/// The Git program, the inherited variables to clear before running it, and
/// other changes to its environment: `None` removes a variable. The app sets
/// these inside its AppImage, whose library paths would break the system Git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitEnv {
    pub program: OsString,
    pub clear: &'static [&'static str],
    pub env: Vec<(&'static str, Option<OsString>)>,
}

/// Variables that point Git at another repository. A task's Git commands
/// never inherit them (the same list the app clears).
pub const GIT_REPOSITORY_ENV: [&str; 16] = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    // Older Git, such as 2.34, still lists it in `rev-parse --local-env-vars`.
    "GIT_INTERNAL_SUPER_PREFIX",
];

pub fn default_git_env() -> Option<GitEnv> {
    let names: &[&str] = if cfg!(windows) {
        &["git.exe", "git.cmd"]
    } else {
        &["git"]
    };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
        .map(|program| GitEnv {
            program: program.into_os_string(),
            clear: &GIT_REPOSITORY_ENV,
            env: Vec::new(),
        })
}

pub trait IsolationEnv: Send + Sync {
    fn require_trusted(&self, project_id: &str) -> Result<(), String>;
    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String>;
    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String>;
    fn git(&self) -> Option<GitEnv>;
    fn project_lock_timeout(&self) -> std::time::Duration {
        crate::isolation::PREPARATION_LOCK_TIMEOUT
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerKind {
    #[default]
    App,
    Daemon,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSummary {
    pub by_project: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    ReviewReady,
    PlanReady,
    ApprovalNeeded,
    Failed,
    BudgetReached,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub kind: NotificationKind,
    pub task_id: String,
    pub project_id: String,
    pub task_title: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompileSummary {
    pub ok: bool,
    pub errors: u32,
    pub warnings: u32,
    pub log_tail: String,
    pub skipped: Option<String>,
}

pub trait WorkspaceTools: Send + Sync {
    fn compile(&self, root: PathBuf, source: Option<PathBuf>) -> TaskRuntimeFuture<CompileSummary>;
    fn project_map(&self, root: PathBuf) -> TaskRuntimeFuture<Value>;
}

pub fn self_supervisor() -> Option<SupervisorCommand> {
    Some(SupervisorCommand {
        program: std::env::current_exe().ok()?,
        args: vec![SUPERVISOR_FLAG.into()],
    })
}

pub trait ResearchHost: IsolationEnv {
    fn admit_project(&self, project_id: &str) -> Result<(), String>;
    fn project_present(&self, project_id: &str) -> bool;
    fn unavailable_skill(
        &self,
        project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String>;
    fn task_changed(&self, task: &ResearchTask);
    fn transcript_appended(&self, event: &TaskTranscriptEvent);
    fn transcript_delta(&self, _delta: &TaskTranscriptDelta) {}
    fn owner(&self) -> OwnerKind {
        OwnerKind::App
    }
    fn supervisor_command(&self) -> Option<SupervisorCommand> {
        self_supervisor()
    }
    fn notify(&self, _notification: Notification) {}
    fn attention_changed(&self, _summary: &AttentionSummary) {}
    fn keep_awake_enabled(&self) -> bool {
        false
    }
    fn task_spend_usd(&self, _task_id: &str) -> Option<f64> {
        None
    }
    fn workspace_tools(&self) -> Option<Arc<dyn WorkspaceTools>> {
        None
    }
    fn compute_host(&self) -> Option<Arc<dyn crate::runs::remote::ComputeHost>> {
        None
    }
}

pub trait ConnectorSecrets: Send + Sync {
    fn get(&self, name: &str) -> Option<zeroize::Zeroizing<String>>;
}

pub struct NoSecrets;

impl ConnectorSecrets for NoSecrets {
    fn get(&self, _name: &str) -> Option<zeroize::Zeroizing<String>> {
        None
    }
}
