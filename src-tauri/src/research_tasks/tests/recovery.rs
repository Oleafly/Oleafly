use std::fs;
use std::path::Path;

use super::*;

async fn pending_review(state: &ResearchTaskState, project: &Path) -> ResearchTask {
    fs::write(project.join("notes.md"), "original notes").unwrap();
    let store = state.store().unwrap();
    let created = requested(&store, draft("paper", "Review before interruption"));
    let claimed = store.claim_next().unwrap().unwrap();
    assert_eq!(claimed.id, created.id);
    let preparation_store = store.clone();
    let preparation_task = claimed.clone();
    let isolation = tokio::task::spawn_blocking(move || {
        isolation::prepare(
            &preparation_store,
            &preparation_task,
            &CancellationToken::new(),
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert!(store
        .set_isolation(&claimed.id, claimed.execution_generation, &isolation)
        .unwrap());
    let execution = PathBuf::from(&isolation.execution_root);
    fs::write(execution.join("main.tex"), "reviewed manuscript").unwrap();
    fs::write(execution.join("notes.md"), "reviewed notes").unwrap();
    let changes = isolation::collect_review_changes(&isolation, &CancellationToken::new()).unwrap();
    assert_eq!(
        changes
            .iter()
            .map(|change| change.path.as_str())
            .collect::<Vec<_>>(),
        ["main.tex", "notes.md"]
    );
    assert!(store
        .finish_success(
            &claimed.id,
            claimed.execution_generation,
            &TaskResultMetadata {
                summary: "Saved review".into(),
                changed_files: changes,
                artifacts: Vec::new(),
                native_session_id: None,
                input_tokens: Some(20),
                output_tokens: Some(10),
            },
        )
        .unwrap());
    store
        .begin_apply(
            &claimed.id,
            claimed.execution_generation,
            crate::project::project_mutation_generation("paper".into()).unwrap(),
            &["main.tex".into(), "notes.md".into()],
        )
        .unwrap();
    store.require(&claimed.id).unwrap()
}

async fn interrupt_after_first_file(
    state: &ResearchTaskState,
    app_state: &crate::state::AppState,
    task: &ResearchTask,
) -> (PathBuf, u64) {
    let store = state.store().unwrap();
    let task = task.clone();
    let mutation = crate::project::mutate_project_worktree(
        app_state,
        task.project_id.clone(),
        None,
        move |project| {
            let journal = store
                .root()
                .join("apply")
                .join(&task.id)
                .join(task.execution_generation.to_string());
            let backups = journal.join("backups");
            fs::create_dir_all(&backups).unwrap();
            let changes = &task.result.as_ref().unwrap().changed_files;
            for change in changes {
                fs::copy(project.join(&change.path), backups.join(&change.path)).unwrap();
            }
            let plan = serde_json::json!({
                "taskId": task.id,
                "projectId": task.project_id,
                "executionGeneration": task.execution_generation,
                "phase": "applying",
                "appliedCount": 1,
                "changes": changes,
            });
            fs::write(
                journal.join("plan.json"),
                serde_json::to_vec(&plan).unwrap(),
            )
            .unwrap();
            let execution = PathBuf::from(&task.isolation.as_ref().unwrap().execution_root);
            fs::copy(execution.join("main.tex"), project.join("main.tex")).unwrap();
            Ok((journal, true))
        },
    )
    .await
    .unwrap();
    (mutation.value.unwrap(), mutation.generation)
}

fn requested_dependent(store: &TaskStore, task: &ResearchTask) -> ResearchTask {
    let mut next = draft(&task.project_id, "Wait for accepted changes");
    next.dependency_ids.push(task.id.clone());
    requested(store, next)
}

#[tokio::test]
async fn completed_disk_apply_is_recorded_before_its_dependent_task_starts() {
    let data = DataRoot::new();
    let project = data.project("paper");
    let state = data.state(1);
    let app_state = crate::state::AppState::default();
    let task = pending_review(&state, &project).await;
    let store = state.store().unwrap();
    let applying_store = store.clone();
    let applying_task = task.clone();
    let mutation =
        crate::project::mutate_project_worktree(&app_state, "paper".into(), None, move |project| {
            let applied = apply::apply_review(
                &applying_store,
                &applying_task,
                project,
                &["main.tex".into(), "notes.md".into()],
            )?;
            Ok((applied, applied))
        })
        .await
        .unwrap();
    assert!(mutation.value.unwrap());
    assert_eq!(store.pending_applies().unwrap().len(), 1);
    assert!(!apply::has_recovery_journal(&store, &task).unwrap());
    let dependent = requested_dependent(&store, &task);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();

    state.recover(&app_state).await.unwrap();

    let completed = store.require(&task.id).unwrap();
    assert_eq!(completed.status, ResearchTaskStatus::Completed);
    assert_eq!(completed.result, task.result);
    let review = completed.review.unwrap();
    assert_eq!(review.selected_paths, ["main.tex", "notes.md"]);
    assert_eq!(review.project_mutation_generation, mutation.generation);
    assert!(review.applied_at > 0);
    assert!(store.pending_applies().unwrap().is_empty());
    assert_eq!(
        crate::project::project_mutation_generation("paper".into()).unwrap(),
        mutation.generation
    );
    let next = next_run(&mut starts).await;
    assert_eq!(next.context.task_id, dependent.id);
    assert_eq!(
        fs::read_to_string(PathBuf::from(&next.context.execution_root).join("main.tex")).unwrap(),
        "reviewed manuscript"
    );
    assert_eq!(
        fs::read_to_string(project.join("notes.md")).unwrap(),
        "reviewed notes"
    );
    finish_run(&state, next, Ok(outcome("accepted baseline"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn partial_disk_apply_rolls_back_and_retains_review_before_queue_admission() {
    let data = DataRoot::new();
    let project = data.project("paper");
    let state = data.state(1);
    let app_state = crate::state::AppState::default();
    let task = pending_review(&state, &project).await;
    let store = state.store().unwrap();
    let (journal, before_recovery) = interrupt_after_first_file(&state, &app_state, &task).await;
    let dependent = requested_dependent(&store, &task);
    let independent = requested(&store, draft("paper", "Continue after rollback"));
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "reviewed manuscript"
    );
    assert_eq!(
        fs::read_to_string(project.join("notes.md")).unwrap(),
        "original notes"
    );

    state.recover(&app_state).await.unwrap();

    let recovered = store.require(&task.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::AwaitingReview);
    assert_eq!(recovered.result, task.result);
    assert_eq!(recovered.isolation, task.isolation);
    assert!(recovered.review.is_none());
    assert!(recovered
        .error
        .unwrap()
        .contains("interrupted apply was rolled back"));
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "original manuscript"
    );
    assert_eq!(
        fs::read_to_string(project.join("notes.md")).unwrap(),
        "original notes"
    );
    assert!(!journal.exists());
    assert!(store.pending_applies().unwrap().is_empty());
    assert_eq!(
        crate::project::project_mutation_generation("paper".into()).unwrap(),
        before_recovery + 1
    );
    let next = next_run(&mut starts).await;
    assert_eq!(next.context.task_id, independent.id);
    assert_eq!(
        fs::read_to_string(PathBuf::from(&next.context.execution_root).join("main.tex")).unwrap(),
        "original manuscript"
    );
    assert_eq!(
        store.require(&dependent.id).unwrap().status,
        ResearchTaskStatus::Queued
    );
    assert_eq!(
        fs::read_to_string(PathBuf::from(&task.isolation.unwrap().execution_root).join("main.tex"))
            .unwrap(),
        "reviewed manuscript"
    );
    finish_run(&state, next, Ok(outcome("rolled-back baseline"))).await;
    assert!(starts.try_recv().is_err());
    stop(&state).await;
}

#[tokio::test]
async fn conflicting_recovery_preserves_evidence_and_defers_the_queue_until_resolved() {
    let data = DataRoot::new();
    let project = data.project("paper");
    let state = data.state(1);
    let app_state = crate::state::AppState::default();
    let task = pending_review(&state, &project).await;
    let store = state.store().unwrap();
    let (journal, before_recovery) = interrupt_after_first_file(&state, &app_state, &task).await;
    let plan = fs::read(journal.join("plan.json")).unwrap();
    let backup = fs::read(journal.join("backups/main.tex")).unwrap();
    fs::write(project.join("main.tex"), "new author edit").unwrap();
    let queued = requested(&store, draft("paper", "Wait until recovery succeeds"));
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();

    let error = state.recover(&app_state).await.unwrap_err();

    assert!(error.contains("main.tex changed while an interrupted task apply was being recovered"));
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "new author edit"
    );
    assert_eq!(fs::read(journal.join("plan.json")).unwrap(), plan);
    assert_eq!(fs::read(journal.join("backups/main.tex")).unwrap(), backup);
    let pending = store.pending_applies().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].task_id, task.id);
    assert_eq!(pending[0].selected_paths, ["main.tex", "notes.md"]);
    let preserved = store.require(&task.id).unwrap();
    assert_eq!(preserved.status, ResearchTaskStatus::AwaitingReview);
    assert_eq!(preserved.result, task.result);
    assert_eq!(preserved.isolation, task.isolation);
    assert!(preserved.review.is_none());
    assert_eq!(
        store.require(&queued.id).unwrap().status,
        ResearchTaskStatus::Queued
    );
    assert!(starts.try_recv().is_err());
    assert!(lock(&state.inner.active).is_empty());
    assert_eq!(
        crate::project::project_mutation_generation("paper".into()).unwrap(),
        before_recovery + 1
    );

    fs::write(project.join("main.tex"), "reviewed manuscript").unwrap();
    state.recover(&app_state).await.unwrap();

    assert!(store.pending_applies().unwrap().is_empty());
    assert!(!journal.exists());
    assert_eq!(
        fs::read_to_string(project.join("main.tex")).unwrap(),
        "original manuscript"
    );
    assert_eq!(
        crate::project::project_mutation_generation("paper".into()).unwrap(),
        before_recovery + 2
    );
    let next = next_run(&mut starts).await;
    assert_eq!(next.context.task_id, queued.id);
    finish_run(&state, next, Ok(outcome("recovery resumed"))).await;
    stop(&state).await;
}
