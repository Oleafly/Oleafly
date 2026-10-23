//! The app's side of the research runtime's ports: trust, project
//! locations, the project lock, Git, skills, webview events, notifications,
//! spend, keep-awake and the workspace build tool.
use std::any::Any;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use oleafly_research::host::{
    AttentionSummary, CompileSummary, GitEnv, IsolationEnv, Notification, NotificationKind,
    ProjectLocation, ResearchHost, WorkspaceTools,
};
use oleafly_research::model::{
    ResearchTask, ResearchTaskView, TaskTranscriptDelta, TaskTranscriptEvent,
};
use oleafly_research::runs::{supervisor::SUPERVISOR_FLAG, SupervisorCommand};
use oleafly_research::scheduler::TaskRuntimeFuture;
use serde_json::Value;
use tauri::{Emitter, Manager};

use crate::proc::NoConsole as _;

const MAIN_WINDOW: &str = "main";
const CLI_UNAVAILABLE: &str = "The command-line tool isn't available.";
const BUILD_TIMEOUT_SECONDS: u64 = 300;
const MAX_LOG_TAIL: usize = 16 * 1024;

/// Which task each webview shows (webview label → task id). Transcript rows
/// and text deltas go only to the webviews watching their task.
fn watchers() -> &'static Mutex<HashMap<String, String>> {
    static WATCHERS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    WATCHERS.get_or_init(Default::default)
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Records the task a webview shows; `None` stops watching.
pub(crate) fn watch(label: &str, task_id: Option<String>) {
    let mut watchers = lock(watchers());
    match task_id {
        Some(task_id) => {
            watchers.insert(label.to_owned(), task_id);
        }
        None => {
            watchers.remove(label);
        }
    }
}

fn watching(task_id: &str) -> Vec<String> {
    lock(watchers())
        .iter()
        .filter(|(_, watched)| watched.as_str() == task_id)
        .map(|(label, _)| label.clone())
        .collect()
}

pub struct AppResearchHost {
    app: Option<tauri::AppHandle>,
}

impl AppResearchHost {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app: Some(app) }
    }

    /// A host that emits nothing (tests and early startup).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn detached() -> Self {
        Self { app: None }
    }

    fn emit_to_watchers<T: serde::Serialize + Clone>(
        &self,
        task_id: &str,
        event: &str,
        payload: &T,
    ) {
        let Some(app) = &self.app else {
            return;
        };
        let open: Vec<String> = app.webview_windows().keys().cloned().collect();
        for label in watching(task_id) {
            if open.contains(&label) {
                let _ = app.emit_to(
                    tauri::EventTarget::webview_window(label.as_str()),
                    event,
                    payload.clone(),
                );
            } else {
                watch(&label, None);
            }
        }
    }

    fn any_window_focused(app: &tauri::AppHandle) -> bool {
        app.webview_windows()
            .values()
            .any(|window| window.is_focused().unwrap_or(false))
    }
}

impl IsolationEnv for AppResearchHost {
    fn require_trusted(&self, project_id: &str) -> Result<(), String> {
        crate::trust::require_trusted(project_id, crate::trust::Capability::ResearchTasks)
            .map_err(String::from)
    }

    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String> {
        let location = crate::project_location::locate(project_id)?;
        Ok(ProjectLocation {
            linked: location.kind == crate::project_location::ProjectKind::Linked,
            root: location.root,
        })
    }

    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn Any + Send>>, String> {
        Ok(
            crate::worktree_lock::ProjectWorktreeLock::try_shared(project_id)?
                .map(|lock| Box::new(lock) as Box<dyn Any + Send>),
        )
    }

    fn git(&self) -> Option<GitEnv> {
        crate::git::git_available().then(|| GitEnv {
            program: crate::git::git_program(),
            clear: &crate::git::GIT_REPOSITORY_ENV,
        })
    }
}

impl ResearchHost for AppResearchHost {
    fn admit_project(&self, project_id: &str) -> Result<(), String> {
        crate::paths::validate_project_id(project_id)?;
        crate::paths::project_dir(project_id)?;
        self.require_trusted(project_id)
    }

    fn project_present(&self, project_id: &str) -> bool {
        crate::paths::project_dir(project_id)
            .map(|directory| directory.is_dir())
            .unwrap_or(false)
    }

    fn unavailable_skill(
        &self,
        project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String> {
        if skill_ids.is_empty() {
            return Ok(None);
        }
        let root = crate::paths::oleafly_root()?;
        let pack = crate::skills_pack::cached_pack_root();
        let records = crate::skills::list_with(&root, pack.as_deref(), Some(project_id))?;
        Ok(unavailable_skill(&records, skill_ids))
    }

    fn task_changed(&self, task: &ResearchTask) {
        if let Some(app) = &self.app {
            let _ = app.emit("research-task-changed", ResearchTaskView::from(task));
        }
    }

    fn transcript_appended(&self, event: &TaskTranscriptEvent) {
        self.emit_to_watchers(&event.task_id, "research-task-event", event);
    }

    fn transcript_delta(&self, delta: &TaskTranscriptDelta) {
        self.emit_to_watchers(&delta.task_id, "research-task-delta", delta);
    }

    /// Run supervisors start from the app binary. Inside an AppImage that
    /// binary lives in a mount that goes away when the app quits, so they
    /// start from the AppImage file instead.
    fn supervisor_command(&self) -> Option<SupervisorCommand> {
        #[cfg(target_os = "linux")]
        if let Some(image) = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
        {
            return Some(SupervisorCommand {
                program: image,
                args: vec![SUPERVISOR_FLAG.into()],
            });
        }
        Some(SupervisorCommand {
            program: std::env::current_exe().ok()?,
            args: vec![SUPERVISOR_FLAG.into()],
        })
    }

    fn notify(&self, notification: Notification) {
        let Some(app) = &self.app else {
            return;
        };
        if !crate::config::read_config()
            .map(|config| config.research_notifications)
            .unwrap_or(true)
            || Self::any_window_focused(app)
        {
            return;
        }
        let key = match notification.kind {
            NotificationKind::ReviewReady => "reviewReady",
            NotificationKind::PlanReady => "planReady",
            NotificationKind::ApprovalNeeded => "approvalNeeded",
            NotificationKind::Failed => "failed",
            NotificationKind::BudgetReached => "budgetReached",
        };
        let params = [("title", notification.task_title.as_str())];
        let title = crate::i18n::t(&format!("researchTasks.notify.{key}.title"));
        let body = crate::i18n::t_with(&format!("researchTasks.notify.{key}.body"), &params);
        use tauri_plugin_notification::NotificationExt as _;
        let _ = app.notification().builder().title(title).body(body).show();
    }

    fn attention_changed(&self, summary: &AttentionSummary) {
        if let Some(app) = &self.app {
            let _ = app.emit_to(MAIN_WINDOW, "research-attention", summary);
        }
    }

    fn keep_awake_enabled(&self) -> bool {
        self.app.is_some()
            && crate::config::read_config()
                .map(|config| config.research_keep_awake)
                .unwrap_or(true)
    }

    fn task_spend_usd(&self, task_id: &str) -> Option<f64> {
        let root = crate::paths::oleafly_root().ok()?;
        crate::library_db::task_usage_cost(&root, task_id)
            .ok()
            .flatten()
    }

    fn workspace_tools(&self) -> Option<Arc<dyn WorkspaceTools>> {
        Some(Arc::new(AppWorkspaceTools))
    }

    fn compute_host(&self) -> Option<Arc<dyn oleafly_research::runs::remote::ComputeHost>> {
        crate::research_compute::AppComputeHost::shared()
    }
}

/// Builds task workspaces with the bundled command-line tool.
struct AppWorkspaceTools;

/// The command-line tool next to the app (or the one the CLI install set
/// up), when there is one.
fn cli_binary() -> Option<PathBuf> {
    if let Some(program) = crate::acp::cli_program().filter(|path| path.is_file()) {
        return Some(program);
    }
    let folder = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let suffix = std::env::consts::EXE_SUFFIX;
    ["oleaflyc", "oleafly-cli"]
        .iter()
        .map(|name| folder.join(format!("{name}{suffix}")))
        .find(|path| path.is_file())
}

fn tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_owned()
}

/// Reads the CLI's `--json build` report.
pub(crate) fn compile_summary(report: &Value) -> CompileSummary {
    let build = &report["build"];
    let (mut errors, mut warnings) = (0u32, 0u32);
    for entry in build["errors"].as_array().into_iter().flatten() {
        let kind = entry["kind"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if kind.contains("warning") {
            warnings += 1;
        } else {
            errors += 1;
        }
    }
    let ok = report["ok"].as_bool().unwrap_or(false);
    if !ok && errors == 0 {
        errors = 1;
    }
    CompileSummary {
        ok,
        errors,
        warnings,
        log_tail: tail(build["log"].as_str().unwrap_or_default(), MAX_LOG_TAIL),
        skipped: None,
    }
}

async fn compile_with_cli(root: PathBuf) -> Result<CompileSummary, String> {
    let Some(cli) = cli_binary() else {
        return Ok(CompileSummary {
            skipped: Some(CLI_UNAVAILABLE.into()),
            ..CompileSummary::default()
        });
    };
    let mut command = tokio::process::Command::new(&cli);
    command
        .arg("-C")
        .arg(&root)
        .args([
            "--json",
            "build",
            "--timeout",
            &BUILD_TIMEOUT_SECONDS.to_string(),
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .no_console();
    let output = tokio::time::timeout(
        Duration::from_secs(BUILD_TIMEOUT_SECONDS + 30),
        command.output(),
    )
    .await
    .map_err(|_| "The build took longer than five minutes.".to_string())?
    .map_err(|error| format!("The command-line tool could not start: {error}"))?;
    let report: Value = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| {
            let detail = tail(String::from_utf8_lossy(&output.stderr).trim(), 2_000);
            if detail.is_empty() {
                "The command-line tool returned no build report.".to_string()
            } else {
                format!("The command-line tool returned no build report: {detail}")
            }
        })?;
    Ok(compile_summary(&report))
}

impl WorkspaceTools for AppWorkspaceTools {
    fn compile(&self, root: PathBuf) -> TaskRuntimeFuture<CompileSummary> {
        Box::pin(compile_with_cli(root))
    }

    fn project_map(&self, root: PathBuf) -> TaskRuntimeFuture<Value> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || project_map_of(&root))
                .await
                .map_err(|_| "The project map could not be read.".to_string())?
        })
    }
}

/// The task workspace's outline, labels, references and citations, with any
/// that do not resolve (what the command-line tool's helper answers too).
pub(crate) fn project_map_of(root: &Path) -> Result<Value, String> {
    let workspace = match oleafly_core::Workspace::open(root) {
        Ok(workspace) => workspace,
        // A copy of a folder without a project.json: the main file is guessed.
        Err(error) if error.kind() == oleafly_core::ErrorKind::NotInitialized => {
            oleafly_core::Workspace::detected(root, None)
                .map_err(|error| error.message().to_string())?
        }
        Err(error) => return Err(error.message().to_string()),
    };
    let main = workspace.manifest().main_doc.clone();
    let scan = oleafly_core::context::scan_project(
        workspace.root(),
        &main,
        &oleafly_core::context::ContextLimits::default(),
    )
    .map_err(|error| error.message().to_string())?;
    serde_json::to_value(scan.map).map_err(|error| error.to_string())
}

pub(crate) fn unavailable_skill(
    records: &[crate::skills::SkillRecord],
    skill_ids: &[String],
) -> Option<String> {
    skill_ids
        .iter()
        .find_map(|id| match records.iter().find(|record| record.id == *id) {
            Some(record) if record.is_available() => None,
            Some(_) => Some(format!(
                "The skill {id} is turned off. Enable it in Settings, AI, Skills."
            )),
            None => Some(format!("The skill {id} is not installed.")),
        })
}

/// The notification permission as the settings page shows it, asking the
/// system first when `request` is set.
pub(crate) fn notification_permission(
    app: &tauri::AppHandle,
    request: bool,
) -> Result<String, String> {
    use tauri_plugin_notification::{NotificationExt as _, PermissionState};
    let notifications = app.notification();
    let mut state = notifications
        .permission_state()
        .map_err(|error| error.to_string())?;
    if request && state != PermissionState::Granted {
        state = notifications
            .request_permission()
            .map_err(|error| error.to_string())?;
    }
    Ok(match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        _ => "prompt",
    }
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_cli_build_report_becomes_a_compile_summary() {
        let report = json!({
            "ok": false,
            "command": "build",
            "build": {
                "ok": false,
                "log": "! Undefined control sequence.",
                "errors": [
                    {"kind": "error", "message": "Undefined control sequence."},
                    {"kind": "warning", "message": "Overfull \\hbox"}
                ]
            }
        });
        let summary = compile_summary(&report);
        assert_eq!(
            (summary.ok, summary.errors, summary.warnings),
            (false, 1, 1)
        );
        assert_eq!(summary.log_tail, "! Undefined control sequence.");
        assert_eq!(summary.skipped, None);
    }

    #[test]
    fn the_project_map_reads_the_task_workspace() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\nSee \\ref{sec:missing}.\n\\end{document}\n",
        )
        .unwrap();
        let map = project_map_of(root.path()).unwrap();
        let text = map.to_string();
        assert!(text.contains("sec:intro"), "{text}");
        // What does not resolve is reported, so the evidence check can use it.
        assert!(text.contains("sec:missing"), "{text}");
        assert!(project_map_of(&root.path().join("missing")).is_err());
    }

    #[test]
    fn a_failed_build_without_diagnostics_still_counts_one_error() {
        let summary = compile_summary(&json!({"ok": false, "build": {"log": ""}}));
        assert_eq!(summary.errors, 1);
    }

    #[test]
    fn log_tails_keep_the_end_on_a_character_boundary() {
        let text = format!("{}é", "a".repeat(10));
        assert_eq!(tail(&text, 2), "é");
    }

    #[test]
    fn watchers_follow_the_last_task_a_webview_showed() {
        watch("research-test-window", Some("task-a".into()));
        assert_eq!(watching("task-a"), vec!["research-test-window".to_string()]);
        watch("research-test-window", Some("task-b".into()));
        assert!(watching("task-a").is_empty());
        watch("research-test-window", None);
        assert!(watching("task-b").is_empty());
    }
}
