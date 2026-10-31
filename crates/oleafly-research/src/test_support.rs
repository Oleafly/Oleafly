use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::host::{
    AttentionSummary, GitEnv, IsolationEnv, Notification, OwnerKind, ProjectLocation, ResearchHost,
    WorkspaceTools,
};
use crate::model::{ResearchTask, ResearchTaskDraft, TaskTranscriptDelta, TaskTranscriptEvent};

pub const CHILD_PATIENCE: Duration = Duration::from_secs(30);

const POLL: Duration = Duration::from_millis(10);

pub async fn read_until<T>(
    path: &Path,
    timeout: Duration,
    accept: impl Fn(&str) -> Option<T>,
) -> Option<T> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = tokio::fs::read_to_string(path)
            .await
            .ok()
            .and_then(|text| accept(&text))
        {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(POLL).await;
    }
}

/// Whether this session may create symbolic links (Windows needs Developer
/// Mode or the privilege).
pub fn symlinks_permitted() -> bool {
    let Ok(probe) = tempfile::tempdir() else {
        return false;
    };
    let target = probe.path().join("target");
    if std::fs::write(&target, b"probe").is_err() {
        return false;
    }
    let link = probe.path().join("link");
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&target, &link).is_ok();
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(&target, &link).is_ok();
    if !created {
        eprintln!(
            "skipping: this session may not create symbolic links (enable Developer Mode on Windows)"
        );
    }
    created
}

pub fn draft(project_id: &str, title: &str) -> ResearchTaskDraft {
    ResearchTaskDraft {
        project_id: project_id.into(),
        title: title.into(),
        prompt: format!("Complete {title}"),
        runtime_id: "fixture".into(),
        agent_id: "fixture-agent".into(),
        model_id: "fixture-model".into(),
        skill_ids: Vec::new(),
        dependency_ids: Vec::new(),
        ..Default::default()
    }
}

pub const UNTRUSTED_ERROR: &str = r#"{"code":"trust.research_tasks","message":"This project is not trusted to run research tasks."}"#;

#[derive(Clone, Default)]
pub struct FakeEnv {
    pub projects: HashMap<String, (PathBuf, bool)>,
    pub untrusted: HashSet<String>,
    pub writer_locked: HashSet<String>,
    pub no_git: bool,
    pub lock_timeout: Option<Duration>,
}

impl FakeEnv {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_project(mut self, id: &str, root: &Path) -> Self {
        self.projects.insert(id.into(), (root.to_path_buf(), false));
        self
    }

    pub fn with_linked_project(mut self, id: &str, root: &Path) -> Self {
        self.projects.insert(id.into(), (root.to_path_buf(), true));
        self
    }

    pub fn untrusted(mut self, id: &str) -> Self {
        self.untrusted.insert(id.into());
        self
    }

    pub fn writer_locked(mut self, id: &str) -> Self {
        self.writer_locked.insert(id.into());
        self
    }

    pub fn without_git(mut self) -> Self {
        self.no_git = true;
        self
    }

    pub fn lock_timeout(mut self, timeout: Duration) -> Self {
        self.lock_timeout = Some(timeout);
        self
    }
}

impl IsolationEnv for FakeEnv {
    fn require_trusted(&self, project_id: &str) -> Result<(), String> {
        if self.untrusted.contains(project_id) {
            Err(UNTRUSTED_ERROR.into())
        } else {
            Ok(())
        }
    }

    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String> {
        self.projects
            .get(project_id)
            .map(|(root, linked)| ProjectLocation {
                root: root.clone(),
                linked: *linked,
            })
            .ok_or_else(|| format!("project does not exist: {project_id}"))
    }

    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String> {
        if self.writer_locked.contains(project_id) {
            Ok(None)
        } else {
            Ok(Some(Box::new(())))
        }
    }

    fn git(&self) -> Option<GitEnv> {
        if self.no_git {
            None
        } else {
            crate::host::default_git_env()
        }
    }

    fn project_lock_timeout(&self) -> Duration {
        self.lock_timeout
            .unwrap_or(crate::isolation::PREPARATION_LOCK_TIMEOUT)
    }
}

#[derive(Clone, Default)]
pub struct FakeHost {
    pub env: Arc<Mutex<FakeEnv>>,
    pub changed: Arc<Mutex<Vec<ResearchTask>>>,
    pub appended: Arc<Mutex<Vec<TaskTranscriptEvent>>>,
    pub missing_skills: Arc<Mutex<HashMap<String, String>>>,
    pub owner: OwnerKind,
    pub deltas: Arc<Mutex<Vec<TaskTranscriptDelta>>>,
    pub notified: Arc<Mutex<Vec<Notification>>>,
    pub attention: Arc<Mutex<Vec<AttentionSummary>>>,
    pub spend: Arc<Mutex<Option<f64>>>,
    pub workspace: Option<Arc<dyn WorkspaceTools>>,
}

impl FakeHost {
    pub fn new(env: FakeEnv) -> Self {
        Self {
            env: Arc::new(Mutex::new(env)),
            ..Self::default()
        }
    }

    fn with_env<T>(&self, f: impl FnOnce(&mut FakeEnv) -> T) -> T {
        f(&mut self
            .env
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner))
    }

    pub fn add_project(&self, id: &str, root: &Path) {
        self.with_env(|env| {
            env.projects.insert(id.into(), (root.to_path_buf(), false));
        });
    }

    pub fn set_trusted(&self, id: &str, trusted: bool) {
        self.with_env(|env| {
            if trusted {
                env.untrusted.remove(id);
            } else {
                env.untrusted.insert(id.into());
            }
        });
    }

    pub fn set_writer_locked(&self, id: &str, locked: bool) {
        self.with_env(|env| {
            if locked {
                env.writer_locked.insert(id.into());
            } else {
                env.writer_locked.remove(id);
            }
        });
    }

    pub fn changed_statuses(&self, task_id: &str) -> Vec<crate::model::ResearchTaskStatus> {
        self.changed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|task| task.id == task_id)
            .map(|task| task.status)
            .collect()
    }

    pub fn notifications(&self) -> Vec<Notification> {
        self.notified
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn latest_attention(&self) -> Option<AttentionSummary> {
        self.attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .last()
            .cloned()
    }

    pub fn set_spend(&self, spend: Option<f64>) {
        *self
            .spend
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = spend;
    }
}

impl IsolationEnv for FakeHost {
    fn require_trusted(&self, project_id: &str) -> Result<(), String> {
        self.with_env(|env| env.require_trusted(project_id))
    }

    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String> {
        self.with_env(|env| env.locate_project(project_id))
    }

    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String> {
        self.with_env(|env| env.try_shared_project_lock(project_id))
    }

    fn git(&self) -> Option<GitEnv> {
        self.with_env(|env| env.git())
    }
}

impl ResearchHost for FakeHost {
    fn admit_project(&self, project_id: &str) -> Result<(), String> {
        if !self.project_present(project_id) {
            return Err(format!("project does not exist: {project_id}"));
        }
        self.require_trusted(project_id)
    }

    fn project_present(&self, project_id: &str) -> bool {
        self.with_env(|env| {
            env.projects
                .get(project_id)
                .is_some_and(|(root, _)| root.is_dir())
        })
    }

    fn unavailable_skill(
        &self,
        _project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String> {
        let missing = self
            .missing_skills
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Ok(skill_ids.iter().find_map(|id| missing.get(id).cloned()))
    }

    fn task_changed(&self, task: &ResearchTask) {
        self.changed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(task.clone());
    }

    fn transcript_appended(&self, event: &TaskTranscriptEvent) {
        self.appended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event.clone());
    }

    fn transcript_delta(&self, delta: &TaskTranscriptDelta) {
        self.deltas
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(delta.clone());
    }

    fn owner(&self) -> OwnerKind {
        self.owner
    }

    fn notify(&self, notification: Notification) {
        self.notified
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(notification);
    }

    fn attention_changed(&self, summary: &AttentionSummary) {
        self.attention
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(summary.clone());
    }

    fn task_spend_usd(&self, _task_id: &str) -> Option<f64> {
        *self
            .spend
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn workspace_tools(&self) -> Option<Arc<dyn WorkspaceTools>> {
        self.workspace.clone()
    }
}

pub fn pid(text: &str) -> Option<i32> {
    text.trim().parse().ok().filter(|pid| *pid > 0)
}
