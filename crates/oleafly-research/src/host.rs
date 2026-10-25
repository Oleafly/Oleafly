//! Ports the research runtime uses to reach whoever hosts it: the desktop
//! app, or the background daemon after the app quits.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{ResearchTask, TaskTranscriptDelta, TaskTranscriptEvent};
use crate::runs::{supervisor::SUPERVISOR_FLAG, SupervisorCommand};
use crate::scheduler::TaskRuntimeFuture;

/// Where a project's files live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectLocation {
    pub root: PathBuf,
    /// A linked folder (outside the library). Linked projects are isolated
    /// from a plain copy so their own repository is never touched.
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

/// Git from `PATH`, for hosts without the app's program locator (the
/// daemon and tests). `None` when no Git executable is on `PATH`.
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

/// What workspace isolation needs from its host.
pub trait IsolationEnv: Send + Sync {
    /// Refuse when the project may not run research tasks. The error is the
    /// app's JSON error text (`trust.research_tasks`).
    fn require_trusted(&self, project_id: &str) -> Result<(), String>;
    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String>;
    /// A shared hold on the project's working tree while it is copied, or
    /// `None` while a writer has it.
    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String>;
    /// `None` when Git is unavailable; isolation then copies the project.
    fn git(&self) -> Option<GitEnv>;
    /// How long preparation waits for a writer to let go of the project.
    fn project_lock_timeout(&self) -> std::time::Duration {
        crate::isolation::PREPARATION_LOCK_TIMEOUT
    }
}

/// Which process runs a task: the app, or the daemon that keeps working
/// after the app quits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerKind {
    #[default]
    App,
    Daemon,
}

/// How many tasks in each project need the user: a result to review, a
/// plan to approve, or a request to answer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSummary {
    pub by_project: BTreeMap<String, u32>,
}

/// Why a task wants the user's attention (an OS notification).
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

/// What a build of the task workspace reported.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompileSummary {
    pub ok: bool,
    pub errors: u32,
    pub warnings: u32,
    /// At most 16 KiB.
    pub log_tail: String,
    /// Why the build was not checked, when it was not.
    pub skipped: Option<String>,
}

/// Project services task tools and evidence checks use.
pub trait WorkspaceTools: Send + Sync {
    /// Builds the workspace with the command-line tool. `source` is the
    /// project folder it was copied from: a copy of a folder the app opened
    /// in place has no settings of its own, so it is built with the folder's.
    fn compile(&self, root: PathBuf, source: Option<PathBuf>) -> TaskRuntimeFuture<CompileSummary>;
    /// The project's outline, labels, references and citations.
    fn project_map(&self, root: PathBuf) -> TaskRuntimeFuture<Value>;
}

/// The supervisor command of a binary that handles
/// `--oleafly-run-supervisor` first thing in `main` (the app and the CLI).
pub fn self_supervisor() -> Option<SupervisorCommand> {
    Some(SupervisorCommand {
        program: std::env::current_exe().ok()?,
        args: vec![SUPERVISOR_FLAG.into()],
    })
}

/// Everything the scheduler needs from its host.
pub trait ResearchHost: IsolationEnv {
    /// The project id is valid, its folder exists and it is trusted.
    fn admit_project(&self, project_id: &str) -> Result<(), String>;
    fn project_present(&self, project_id: &str) -> bool;
    /// An error message when one of `skill_ids` is turned off or missing.
    fn unavailable_skill(
        &self,
        project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String>;
    fn task_changed(&self, task: &ResearchTask);
    fn transcript_appended(&self, event: &TaskTranscriptEvent);
    /// Text added to a transcript row (for windows watching the task).
    fn transcript_delta(&self, _delta: &TaskTranscriptDelta) {}
    fn owner(&self) -> OwnerKind {
        OwnerKind::App
    }
    /// How local runs start their supervisor. `None` leaves this host
    /// without local runs.
    fn supervisor_command(&self) -> Option<SupervisorCommand> {
        self_supervisor()
    }
    fn notify(&self, _notification: Notification) {}
    fn attention_changed(&self, _summary: &AttentionSummary) {}
    fn keep_awake_enabled(&self) -> bool {
        false
    }
    /// What the task's model calls cost so far; `None` when unknown.
    fn task_spend_usd(&self, _task_id: &str) -> Option<f64> {
        None
    }
    fn workspace_tools(&self) -> Option<Arc<dyn WorkspaceTools>> {
        None
    }
    /// What runs on other computers need (program lookup, MCP calls).
    /// `None` gives them a host that searches `PATH` and has no MCP client.
    fn compute_host(&self) -> Option<Arc<dyn crate::runs::remote::ComputeHost>> {
        None
    }
}

/// Connector keys the literature and citation tools may use
/// (`openalex-api-key`, `openalex-email`, `semantic-scholar`, `serper`).
pub trait ConnectorSecrets: Send + Sync {
    fn get(&self, name: &str) -> Option<zeroize::Zeroizing<String>>;
}

/// No connector keys (tests, hosts without a secret store).
pub struct NoSecrets;

impl ConnectorSecrets for NoSecrets {
    fn get(&self, _name: &str) -> Option<zeroize::Zeroizing<String>> {
        None
    }
}
