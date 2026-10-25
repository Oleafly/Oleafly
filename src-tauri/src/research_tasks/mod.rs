mod apply;
pub(crate) mod host;
pub(crate) mod pdf_text;
mod preview;
#[cfg(test)]
#[path = "tests/scheduler.rs"]
mod scheduler_tests;

use std::sync::Arc;

use serde::Serialize;

#[cfg(test)]
use oleafly_research::model::ResearchTask;
pub use oleafly_research::model::{
    ResearchTaskView, TaskRunContext, TaskRuntimeEvent, TaskRuntimeOutcome, ToolPhase,
};
pub use oleafly_research::scheduler::{
    ResearchTaskState, TaskEventSink, TaskRuntimeAdapter, TaskRuntimeFuture,
};
// The task model, store and isolation live in the research crate; the app
// keeps apply and preview, which need the live collaboration document.
pub(crate) use oleafly_research::{isolation, model, store};

use model::{
    now_ms, ResearchTaskDraft, ResearchTaskEdit, ResearchTaskStatus, RetryMode, TaskApplyRequest,
    TaskArtifactPreview, TaskFilePreview, TaskReviewResult, TaskTranscriptPage,
};
use store::TaskStore;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskApplyResult {
    pub task: ResearchTaskView,
    pub project_state: crate::project::ProjectStateChanged,
}

/// The app's task queue over `~/.oleafly/research-tasks`, two tasks at once.
pub fn new_state() -> ResearchTaskState {
    ResearchTaskState::new(
        crate::paths::oleafly_root().map(|root| root.join("research-tasks")),
        2,
    )
}

/// Connect the queue to the app: trust, projects, skills and webview events.
/// Queued work waits for [`recover`]: the launch handoff runs beside it and
/// must not start a task over a project an interrupted apply left half done.
pub fn attach(state: &ResearchTaskState, app: &tauri::AppHandle) {
    state.hold_launches();
    // 0.4.8: experimental and off until the user turns tasks on; a config
    // that cannot be read keeps them off.
    state.set_enabled(
        crate::config::read_config()
            .map(|config| config.research_tasks_enabled)
            .unwrap_or(false),
    );
    state.attach(
        Arc::new(host::AppResearchHost::new(app.clone())),
        tauri::async_runtime::handle().inner().clone(),
    );
}

/// What a caller gets while research tasks are off (the CLI, an agent over
/// MCP, or a window that loaded before the switch was flipped).
pub(crate) const TASKS_OFF: &str = "Research tasks are turned off. They are experimental in this version: turn them on under Settings, Research, at your own risk.";

fn ensure_enabled(state: &ResearchTaskState) -> Result<(), String> {
    if state.enabled() {
        Ok(())
    } else {
        Err(TASKS_OFF.to_string())
    }
}

/// Turns research tasks on or off: the setting, the queue, and the work
/// under way. Turning them on starts queued work; turning them off cancels
/// every running task, so nothing keeps working behind a hidden panel.
pub(crate) async fn set_enabled(state: &ResearchTaskState, enabled: bool) -> Result<(), String> {
    let stored = tauri::async_runtime::spawn_blocking(move || {
        crate::config::update_config(|config| {
            config.research_tasks_enabled = enabled;
            Ok(())
        })
    })
    .await
    .map_err(|error| format!("configuration worker failed: {error}"))?;
    stored?;
    state.set_enabled(enabled);
    if enabled {
        state.launch_ready().await?;
        return Ok(());
    }
    let mut failures = Vec::new();
    for id in state.active_task_ids() {
        if let Err(error) = state.cancel(id.clone()).await {
            failures.push(format!("{id}: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Research tasks are off, but some running tasks could not be stopped: {}",
            failures.join("; ")
        ))
    }
}

#[tauri::command]
pub async fn research_tasks_set_enabled(
    state: tauri::State<'_, ResearchTaskState>,
    enabled: bool,
) -> Result<(), String> {
    set_enabled(&state, enabled).await
}

/// Finish applies a previous run left half done, recover interrupted runs,
/// then start queued work unless an apply is still unresolved.
pub async fn recover(
    state: &ResearchTaskState,
    app_state: &crate::state::AppState,
) -> Result<(), String> {
    // However recovery ends, work the user starts from now on runs; the
    // launch handoff starts queued work only after a clean recovery.
    struct Release<'a> {
        state: &'a ResearchTaskState,
        clean: bool,
    }
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.state.release_launches();
            recovery().send_replace(Some(self.clean));
        }
    }
    let mut release = Release {
        state,
        clean: false,
    };
    let store = state.store()?;
    let mut failures = Vec::new();
    let mut unresolved = 0usize;
    for pending in store.pending_applies()? {
        if let Err(error) = recover_pending(state, app_state, &store, pending.clone()).await {
            if project_is_missing(&pending.project_id) {
                let _ = store.clear_apply(&pending.task_id, Some(&error));
                if let Ok(task) = store.require(&pending.task_id) {
                    state.emit_task(&task);
                }
            } else {
                unresolved += 1;
            }
            failures.push(format!("{}: {error}", pending.task_id));
        }
    }
    // Queued work starts now only when no apply is left unresolved.
    release.clean = unresolved == 0;
    drop(release);
    state.recover_runs(unresolved == 0).await?;
    // Sandbox profiles of tasks that no longer exist (Windows) go now.
    if let Ok(tasks) = store.all_tasks() {
        let owners: Vec<String> = tasks
            .iter()
            .map(|task| format!("task:{}", task.id))
            .collect();
        let _ =
            tauri::async_runtime::spawn_blocking(move || oleafly_sandbox::release_stale(&owners))
                .await;
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Some interrupted task applies could not be recovered: {}",
            failures.join("; ")
        ))
    }
}

/// How the launch's [`recover`] went: `None` until it ends, then whether it
/// left no apply unresolved.
fn recovery() -> &'static tokio::sync::watch::Sender<Option<bool>> {
    static RECOVERY: std::sync::OnceLock<tokio::sync::watch::Sender<Option<bool>>> =
        std::sync::OnceLock::new();
    RECOVERY.get_or_init(|| tokio::sync::watch::channel(None).0)
}

/// Waits for the launch's [`recover`]; `true` when queued work may start
/// (no interrupted apply is left unresolved).
pub(crate) async fn recovered_cleanly() -> bool {
    let mut outcome = recovery().subscribe();
    outcome
        .wait_for(Option::is_some)
        .await
        .is_ok_and(|outcome| *outcome == Some(true))
}

async fn recover_pending(
    state: &ResearchTaskState,
    app_state: &crate::state::AppState,
    store: &TaskStore,
    pending: store::PendingApply,
) -> Result<(), String> {
    let task = store.require(&pending.task_id)?;
    let recover_store = store.clone();
    let recover_task = task.clone();
    let selected_paths = pending.selected_paths.clone();
    let mutation = crate::project::mutate_project_worktree(
        app_state,
        pending.project_id.clone(),
        None,
        move |project_root| {
            let fully_applied = apply::recover_pending_apply(
                &recover_store,
                &recover_task,
                project_root,
                &selected_paths,
            )?;
            Ok((fully_applied, !fully_applied))
        },
    )
    .await?;
    match mutation.value {
        Ok(true) => {
            let review = TaskReviewResult {
                selected_paths: pending.selected_paths,
                applied_at: now_ms(),
                project_mutation_generation: mutation.generation,
            };
            let task = store.complete_apply(&pending.task_id, &review)?;
            state.emit_task(&task);
            Ok(())
        }
        Ok(false) => {
            store.clear_apply(
                &pending.task_id,
                Some(
                    "An interrupted apply was rolled back. Review the result, then apply it again.",
                ),
            )?;
            state.emit_task(&store.require(&pending.task_id)?);
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn project_is_missing(project_id: &str) -> bool {
    !crate::paths::project_dir(project_id)
        .map(|directory| directory.is_dir())
        .unwrap_or(false)
}

// Store initialization, SQLite queries, and preview file reads can block on
// disk or another connection. Keep them off the main WebView event loop.
async fn blocking_task_command<T: Send + 'static>(
    state: &ResearchTaskState,
    operation: impl FnOnce(&ResearchTaskState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || operation(&state))
        .await
        .map_err(|error| format!("task storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn research_task_list(
    state: tauri::State<'_, ResearchTaskState>,
    project_id: String,
) -> Result<Vec<ResearchTaskView>, String> {
    blocking_task_command(&state, move |state| {
        crate::paths::validate_project_id(&project_id)?;
        Ok(state
            .list(&project_id)?
            .iter()
            .map(ResearchTaskView::from)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn research_task_create(
    state: tauri::State<'_, ResearchTaskState>,
    draft: ResearchTaskDraft,
) -> Result<ResearchTaskView, String> {
    ensure_enabled(&state)?;
    blocking_task_command(&state, move |state| {
        state.create(draft).map(|task| (&task).into())
    })
    .await
}

#[tauri::command]
pub async fn research_task_edit(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    edit: ResearchTaskEdit,
) -> Result<ResearchTaskView, String> {
    blocking_task_command(&state, move |state| {
        state.edit(&task_id, edit).map(|task| (&task).into())
    })
    .await
}

#[tauri::command]
pub async fn research_task_start(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTaskView, String> {
    ensure_enabled(&state)?;
    let requested_id = task_id.clone();
    blocking_task_command(&state, move |state| state.request_start(&requested_id)).await?;
    state.launch_ready().await?;
    blocking_task_command(&state, move |state| {
        state.store()?.require(&task_id).map(|task| (&task).into())
    })
    .await
}

#[tauri::command]
pub async fn research_task_cancel(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTaskView, String> {
    state.cancel(task_id).await.map(|task| (&task).into())
}

#[tauri::command]
/// Without a mode a retry starts over, as in 0.4.7.
pub async fn research_task_retry(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    mode: Option<RetryMode>,
) -> Result<ResearchTaskView, String> {
    ensure_enabled(&state)?;
    blocking_task_command(&state, move |state| {
        state
            .retry(&task_id, mode.unwrap_or_default())
            .map(|task| (&task).into())
    })
    .await
}

/// A page of a generation's transcript. Forward from `after_sequence`, or,
/// with `before_sequence`, backwards from the newest rows below it (a value
/// above every row, such as `Number.MAX_SAFE_INTEGER`, reads the newest page).
#[tauri::command]
pub async fn research_task_events(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    execution_generation: u64,
    after_sequence: Option<u64>,
    limit: Option<usize>,
    before_sequence: Option<u64>,
) -> Result<TaskTranscriptPage, String> {
    blocking_task_command(&state, move |state| {
        state.events_page(
            &task_id,
            execution_generation,
            after_sequence,
            before_sequence,
            limit.unwrap_or(100),
        )
    })
    .await
}

#[tauri::command]
pub async fn research_task_file_preview(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    path: String,
) -> Result<TaskFilePreview, String> {
    blocking_task_command(&state, move |state| {
        preview::file_preview(&state.store()?, &task_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn research_task_artifact_preview(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    path: String,
) -> Result<TaskArtifactPreview, String> {
    blocking_task_command(&state, move |state| {
        preview::artifact_preview(&state.store()?, &task_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn research_task_apply(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, crate::state::AppState>,
    state: tauri::State<'_, ResearchTaskState>,
    request: TaskApplyRequest,
) -> Result<TaskApplyResult, String> {
    let admitted = request.clone();
    let task = blocking_task_command(&state, move |state| {
        let store = state.store()?;
        let task = store.require(&admitted.task_id)?;
        if task.status != ResearchTaskStatus::AwaitingReview {
            return Err("This task is not waiting for review.".into());
        }
        store.begin_apply(
            &task.id,
            task.execution_generation,
            admitted.expected_project_generation,
            &admitted.selected_paths,
        )?;
        Ok(task)
    })
    .await?;
    let store = state.store()?;
    let apply_store = store.clone();
    let apply_task = task.clone();
    let selected_paths = request.selected_paths.clone();
    let mutation = crate::project::mutate_project_worktree(
        &app_state,
        task.project_id.clone(),
        Some(request.expected_project_generation),
        move |project_root| {
            apply::apply_review(&apply_store, &apply_task, project_root, &selected_paths)
                .map(|changed| ((), changed))
        },
    )
    .await;
    let failed = match &mutation {
        Err(error) => Some(error.clone()),
        Ok(mutation) => mutation.value.as_ref().err().cloned(),
    };
    if let Some(error) = failed {
        let failed_task = task.clone();
        let reported = error.clone();
        blocking_task_command(&state, move |state| {
            let store = state.store()?;
            if !apply::has_recovery_journal(&store, &failed_task)? {
                store.clear_apply(&failed_task.id, Some(&reported))?;
            }
            Ok(())
        })
        .await?;
        return Err(error);
    }
    let mutation = mutation?;
    let review = TaskReviewResult {
        selected_paths: request.selected_paths,
        applied_at: now_ms(),
        project_mutation_generation: mutation.generation,
    };
    let completed_id = task.id.clone();
    let task = blocking_task_command(&state, move |state| {
        let store = state.store()?;
        let task = store.complete_apply(&completed_id, &review)?;
        apply::release_completed_journal(&store, &task);
        state.emit_task(&task);
        Ok(task)
    })
    .await?;
    let project_state = crate::project::publish_project_state_changed(
        &app,
        &app_state,
        &task.project_id,
        mutation.project,
        "research-task-apply",
        true,
        Some(mutation.generation),
    )?;
    state.launch_ready().await?;
    Ok(TaskApplyResult {
        task: (&task).into(),
        project_state,
    })
}

#[tauri::command]
pub async fn research_task_delete(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<(), String> {
    blocking_task_command(&state, move |state| state.delete(&task_id)).await
}

#[tauri::command]
pub async fn research_task_accept_result(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTaskView, String> {
    let task = blocking_task_command(&state, move |state| state.accept_result(&task_id)).await?;
    state.launch_ready().await?;
    Ok((&task).into())
}

// 0.4.8 E: plan approval, runs, approvals, attention, evidence, progress
// and watching a task.

const MAX_TASK_ID: usize = 128;

fn check_task_id(task_id: &str) -> Result<(), String> {
    if task_id.trim().is_empty() || task_id.len() > MAX_TASK_ID {
        return Err("The task id is invalid.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn research_task_plan(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<model::TaskPlanText, String> {
    blocking_task_command(&state, move |state| state.plan(&task_id)).await
}

#[tauri::command]
pub async fn research_task_approve_plan(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    edited_plan: Option<String>,
) -> Result<ResearchTaskView, String> {
    ensure_enabled(&state)?;
    state
        .approve_plan(task_id, edited_plan)
        .await
        .map(|task| (&task).into())
}

#[tauri::command]
pub async fn research_task_run_cancel(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    run_id: String,
) -> Result<(), String> {
    check_task_id(&task_id)?;
    state.services()?.runs.cancel(&task_id, &run_id).await
}

#[tauri::command]
pub async fn research_task_run_log(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    run_id: String,
    tail: Option<u32>,
) -> Result<String, String> {
    check_task_id(&task_id)?;
    let lines = tail.unwrap_or(200).clamp(1, 2_000) as usize;
    state
        .services()?
        .runs
        .read_log(
            &task_id,
            &run_id,
            oleafly_research::runs::LogQuery::Tail { lines },
        )
        .await
}

#[tauri::command]
pub async fn research_task_attention(
    state: tauri::State<'_, ResearchTaskState>,
) -> Result<oleafly_research::host::AttentionSummary, String> {
    blocking_task_command(&state, |state| state.store()?.attention()).await
}

#[tauri::command]
pub async fn research_notification_permission(
    app: tauri::AppHandle,
    request: bool,
) -> Result<String, String> {
    host::notification_permission(&app, request)
}

#[tauri::command]
pub async fn research_task_approvals(
    state: tauri::State<'_, ResearchTaskState>,
    project_id: String,
) -> Result<Vec<model::ApprovalRecord>, String> {
    crate::paths::validate_project_id(&project_id)?;
    let services = state.services()?;
    tauri::async_runtime::spawn_blocking(move || services.approvals.pending(&project_id))
        .await
        .map_err(|error| format!("task storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn research_task_approval_decide(
    state: tauri::State<'_, ResearchTaskState>,
    approval_id: String,
    approve: bool,
) -> Result<model::ApprovalRecord, String> {
    blocking_task_command(&state, move |state| {
        let record = state.services()?.approvals.decide(&approval_id, approve)?;
        if let Ok(task) = state.store()?.require(&record.task_id) {
            state.emit_task(&task);
        }
        state.refresh_attention();
        Ok(record)
    })
    .await
}

#[tauri::command]
pub async fn research_task_evidence_refresh(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTaskView, String> {
    check_task_id(&task_id)?;
    state
        .refresh_evidence(task_id)
        .await
        .map(|task| (&task).into())
}

#[tauri::command]
pub async fn research_task_progress(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<oleafly_research::progress::TaskProgress, String> {
    check_task_id(&task_id)?;
    blocking_task_command(&state, move |state| state.progress(&task_id)).await
}

/// Transcript rows and text deltas go only to the windows showing the task.
#[tauri::command]
pub fn research_task_watch(webview: tauri::Webview, task_id: Option<String>) -> Result<(), String> {
    if let Some(task_id) = &task_id {
        check_task_id(task_id)?;
    }
    host::watch(webview.label(), task_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use oleafly_agent::CancellationToken;

    use super::*;

    fn attached(state: &ResearchTaskState) {
        state.attach(
            Arc::new(host::AppResearchHost::detached()),
            tauri::async_runtime::handle().inner().clone(),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn task_storage_queries_leave_the_calling_thread_and_preserve_errors() {
        let temp = tempfile::tempdir().unwrap();
        let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
        let caller = std::thread::current().id();
        let (worker, tasks) = blocking_task_command(&state, |state| {
            Ok((std::thread::current().id(), state.store()?.list("paper")?))
        })
        .await
        .unwrap();
        assert_ne!(worker, caller);
        assert!(tasks.is_empty());
        let error = blocking_task_command::<()>(&state, |_| Err("storage failed".into()))
            .await
            .unwrap_err();
        assert_eq!(error, "storage failed");
    }

    #[test]
    fn restricted_projects_cannot_queue_retry_or_isolate_research_tasks() {
        use tauri::Manager as _;
        let _env = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
        let project = crate::paths::create_project_dir("restricted-paper").unwrap();
        std::fs::write(project.join("main.tex"), "source").unwrap();
        let app = tauri::test::mock_builder()
            .manage(ResearchTaskState::for_test(temp.path().join("tasks"), 1))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let draft = ResearchTaskDraft {
            project_id: "restricted-paper".into(),
            title: "Review".into(),
            prompt: "Check".into(),
            runtime_id: "fixture".into(),
            agent_id: "fixture-agent".into(),
            model_id: "fixture-model".into(),
            skill_ids: Vec::new(),
            dependency_ids: Vec::new(),
            ..Default::default()
        };
        attached(&app.state::<ResearchTaskState>());
        tauri::async_runtime::block_on(async {
            let state = || app.state::<ResearchTaskState>();
            let queued = research_task_create(state(), draft.clone()).await.unwrap();
            let waiting = research_task_create(state(), draft.clone()).await.unwrap();
            let _restricted = crate::trust::testing::restrict("restricted-paper");
            let start = state().request_start(&waiting.id).unwrap_err();
            assert!(
                start.contains("\"code\":\"trust.research_tasks\""),
                "{start}"
            );
            assert_eq!(
                state()
                    .store()
                    .unwrap()
                    .require(&waiting.id)
                    .unwrap()
                    .status,
                waiting.status
            );
            let refused = research_task_create(state(), draft).await.unwrap_err();
            assert!(
                refused.contains("\"code\":\"trust.research_tasks\""),
                "{refused}"
            );
            let store = state().store().unwrap();
            store.request_cancel(&queued.id).unwrap();
            let retry = research_task_retry(state(), queued.id.clone(), None)
                .await
                .unwrap_err();
            assert!(retry.contains("trust.research_tasks"), "{retry}");
            let task = store.require(&queued.id).unwrap();
            let isolation = isolation::prepare(
                &store,
                &host::AppResearchHost::detached(),
                &task,
                &CancellationToken::new(),
            )
            .unwrap_err();
            assert!(isolation.contains("trust.research_tasks"), "{isolation}");
        });
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_projects_isolate_from_a_snapshot_and_leave_the_folder_repository_alone() {
        use tauri::Manager as _;
        let fixture = crate::trust::testing::LinkedFixture::new();
        let (id, folder) = fixture.link("paper");
        std::fs::write(folder.join("main.tex"), "manuscript").unwrap();
        let away = fixture.folders.path().join("away");
        let git = |args: &[&str]| {
            let mut command = std::process::Command::new("git");
            crate::git::clear_inherited_git_env(&mut command);
            let output = command
                .current_dir(&folder)
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        git(&["add", "main.tex"]);
        git(&["commit", "--quiet", "-m", "base"]);
        git(&[
            "worktree",
            "add",
            "--quiet",
            "--detach",
            away.to_str().unwrap(),
        ]);
        std::fs::remove_dir_all(&away).unwrap();
        let registrations = folder.join(".git").join("worktrees");
        let registered = || {
            std::fs::read_dir(&registrations)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect::<Vec<_>>()
        };
        let user_worktrees = registered();
        assert_eq!(user_worktrees.len(), 1);
        fixture.trust(&id, crate::trust::TrustScope::Folder);
        let tasks = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .manage(ResearchTaskState::for_test(tasks.path().join("tasks"), 1))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let draft = ResearchTaskDraft {
            project_id: id.clone(),
            title: "Review".into(),
            prompt: "Check".into(),
            runtime_id: "fixture".into(),
            agent_id: "fixture-agent".into(),
            model_id: "fixture-model".into(),
            skill_ids: Vec::new(),
            dependency_ids: Vec::new(),
            ..Default::default()
        };
        attached(&app.state::<ResearchTaskState>());
        tauri::async_runtime::block_on(async {
            let state = || app.state::<ResearchTaskState>();
            let created = research_task_create(state(), draft).await.unwrap();
            let store = state().store().unwrap();
            let task = store.require(&created.id).unwrap();
            let isolation = isolation::prepare(
                &store,
                &host::AppResearchHost::detached(),
                &task,
                &CancellationToken::new(),
            )
            .unwrap();
            assert_eq!(isolation.kind, model::TaskIsolationKind::StagedProject);
            assert_eq!(
                std::fs::read_to_string(
                    std::path::Path::new(&isolation.execution_root).join("main.tex")
                )
                .unwrap(),
                "manuscript"
            );
            assert_eq!(registered(), user_worktrees);
            research_task_delete(state(), task.id.clone())
                .await
                .unwrap();
        });
        assert_eq!(registered(), user_worktrees);
    }

    #[test]
    fn async_storage_commands_preserve_task_lifecycle_and_preview_errors() {
        use tauri::Manager as _;

        let _env = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
        let project = crate::paths::create_project_dir("command-paper").unwrap();
        std::fs::write(project.join("main.tex"), "original source").unwrap();
        let app = tauri::test::mock_builder()
            .manage(ResearchTaskState::for_test(temp.path().join("tasks"), 1))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        attached(&app.state::<ResearchTaskState>());
        tauri::async_runtime::block_on(async {
            let state = || app.state::<ResearchTaskState>();
            assert!(research_task_list(state(), "../outside".into())
                .await
                .is_err());
            let draft = ResearchTaskDraft {
                project_id: "command-paper".into(),
                title: "Review source".into(),
                prompt: "Check the manuscript".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
                ..Default::default()
            };
            let task = research_task_create(state(), draft.clone()).await.unwrap();
            assert_eq!(task.status, ResearchTaskStatus::Queued);
            assert_eq!(
                research_task_list(state(), draft.project_id.clone())
                    .await
                    .unwrap(),
                vec![task.clone()]
            );
            let edited = research_task_edit(
                state(),
                task.id.clone(),
                ResearchTaskEdit {
                    title: "Revised review".into(),
                    prompt: draft.prompt,
                    runtime_id: draft.runtime_id,
                    agent_id: draft.agent_id,
                    model_id: draft.model_id,
                    skill_ids: Vec::new(),
                    dependency_ids: Vec::new(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            assert_eq!(edited.title, "Revised review");
            assert!(research_task_retry(state(), task.id.clone(), None)
                .await
                .unwrap_err()
                .contains("failed or cancelled"));
            state().store().unwrap().request_cancel(&task.id).unwrap();
            let retried = research_task_retry(state(), task.id.clone(), None)
                .await
                .unwrap();
            assert_eq!(retried.status, ResearchTaskStatus::Queued);
            assert_eq!(retried.title, edited.title);
            let transcript = research_task_events(state(), task.id.clone(), 0, None, None, None)
                .await
                .unwrap();
            assert!(transcript.events.is_empty());
            assert_eq!(transcript.next_sequence, None);
            for path in ["main.tex", "../outside"] {
                let expected_file =
                    preview::file_preview(&state().store().unwrap(), &task.id, path).unwrap_err();
                assert_eq!(
                    research_task_file_preview(state(), task.id.clone(), path.into())
                        .await
                        .unwrap_err(),
                    expected_file
                );
                let expected_artifact =
                    preview::artifact_preview(&state().store().unwrap(), &task.id, path)
                        .unwrap_err();
                assert_eq!(
                    research_task_artifact_preview(state(), task.id.clone(), path.into())
                        .await
                        .unwrap_err(),
                    expected_artifact
                );
            }
            assert_eq!(
                std::fs::read_to_string(project.join("main.tex")).unwrap(),
                "original source"
            );
        });
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
