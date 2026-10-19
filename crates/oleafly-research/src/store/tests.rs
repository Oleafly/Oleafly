use tempfile::TempDir;

use super::*;

fn draft(project_id: &str, title: &str) -> ResearchTaskDraft {
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

fn store() -> (TempDir, TaskStore) {
    let temp = tempfile::tempdir().unwrap();
    let store = TaskStore::new(temp.path().join("tasks")).unwrap();
    (temp, store)
}

fn claimed(store: &TaskStore, title: &str) -> ResearchTask {
    let task = store.create(draft("paper", title)).unwrap();
    store.request_start(&task.id).unwrap();
    store.claim_next().unwrap().unwrap()
}

fn owner_columns(store: &TaskStore, id: &str) -> (Option<i64>, Option<i64>) {
    store
        .open()
        .unwrap()
        .query_row(
            "SELECT owner_pid, owner_started FROM research_tasks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn a_claim_records_this_process_as_the_run_owner() {
    let (_temp, store) = store();
    let running = claimed(&store, "Owned run");
    let current = oleafly_sandbox::process::identity::current();
    assert_eq!(
        owner_columns(&store, &running.id),
        (
            Some(i64::from(current.pid)),
            current
                .started
                .and_then(|started| i64::try_from(started).ok())
        )
    );
}

#[test]
fn beginning_an_apply_records_this_process_as_the_apply_owner() {
    let (_temp, store) = store();
    let reviewed = reviewable_task(&store);
    store.set_owner(&reviewed.id, None).unwrap();
    store
        .begin_apply(
            &reviewed.id,
            reviewed.execution_generation,
            1,
            &["main.tex".into()],
        )
        .unwrap();
    assert_eq!(
        owner_columns(&store, &reviewed.id).0,
        Some(i64::from(std::process::id()))
    );
}

const FOREIGN: ProcessIdentity = ProcessIdentity {
    pid: u32::MAX - 1,
    started: Some(11),
};

#[test]
fn recovery_leaves_a_run_owned_by_another_live_process_running() {
    let (_temp, store) = store();
    let running = claimed(&store, "Foreign run");
    store.set_owner(&running.id, Some(FOREIGN)).unwrap();
    let store = TaskStore {
        probe: |_| ProcessProbe::Running { started: Some(11) },
        ..store
    };
    store.recover_interrupted().unwrap();
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Running
    );
}

#[test]
fn recovery_fails_a_run_whose_owner_has_exited() {
    let (_temp, store) = store();
    let running = claimed(&store, "Crashed run");
    store.set_owner(&running.id, Some(FOREIGN)).unwrap();
    let store = TaskStore {
        probe: |_| ProcessProbe::Gone,
        ..store
    };
    store.recover_interrupted().unwrap();
    let recovered = store.require(&running.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::Failed);
    assert!(recovered.error.unwrap().contains("closed before"));
}

#[test]
fn recovery_fails_a_run_whose_pid_now_belongs_to_another_process() {
    let (_temp, store) = store();
    let running = claimed(&store, "Reused pid");
    store.set_owner(&running.id, Some(FOREIGN)).unwrap();
    let store = TaskStore {
        probe: |_| ProcessProbe::Running { started: Some(12) },
        ..store
    };
    store.recover_interrupted().unwrap();
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Failed
    );
}

#[test]
fn recovery_fails_a_run_recorded_before_owners_existed() {
    let (_temp, store) = store();
    let running = claimed(&store, "Unowned run");
    store.set_owner(&running.id, None).unwrap();
    let store = TaskStore {
        probe: |_| ProcessProbe::Running { started: Some(11) },
        ..store
    };
    store.recover_interrupted().unwrap();
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Failed
    );
}

#[test]
fn an_apply_owned_by_another_live_process_is_not_pending_here() {
    let (_temp, store) = store();
    let reviewed = reviewable_task(&store);
    store
        .begin_apply(
            &reviewed.id,
            reviewed.execution_generation,
            1,
            &["main.tex".into()],
        )
        .unwrap();
    store.set_owner(&reviewed.id, Some(FOREIGN)).unwrap();
    let live = TaskStore {
        probe: |_| ProcessProbe::Running { started: Some(11) },
        ..store.clone()
    };
    assert!(live.pending_applies().unwrap().is_empty());
    let exited = TaskStore {
        probe: |_| ProcessProbe::Gone,
        ..store
    };
    assert_eq!(exited.pending_applies().unwrap().len(), 1);
}

#[test]
fn disowning_hands_this_process_runs_and_applies_to_the_next_launch() {
    let (_temp, store) = store();
    let running = claimed(&store, "Run at exit");
    let reviewed = reviewable_task(&store);
    store
        .begin_apply(
            &reviewed.id,
            reviewed.execution_generation,
            1,
            &["main.tex".into()],
        )
        .unwrap();
    let foreign = claimed(&store, "Other instance");
    store.set_owner(&foreign.id, Some(FOREIGN)).unwrap();

    assert_eq!(store.disown_current().unwrap(), 2);
    assert_eq!(owner_columns(&store, &running.id), (None, None));
    assert_eq!(owner_columns(&store, &reviewed.id), (None, None));
    assert_eq!(
        owner_columns(&store, &foreign.id),
        (Some(i64::from(u32::MAX - 1)), Some(11))
    );
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Running
    );
}

#[test]
fn a_store_created_before_owners_gains_the_columns_and_keeps_its_rows() {
    let (_temp, store) = store();
    let running = claimed(&store, "Legacy run");
    Connection::open(store.root().join("tasks.sqlite3"))
        .unwrap()
        .execute_batch(
            "ALTER TABLE research_tasks DROP COLUMN owner_pid;
             ALTER TABLE research_tasks DROP COLUMN owner_started;
             PRAGMA user_version = 0;",
        )
        .unwrap();
    assert_eq!(owner_columns(&store, &running.id), (None, None));
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Running
    );
}

fn reviewable_task(store: &TaskStore) -> ResearchTask {
    let task = store.create(draft("paper", "Revise results")).unwrap();
    store.request_start(&task.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    let workspace = store.root().join(&task.id).join("saved-workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(workspace.join("main.tex"), "reviewed result").unwrap();
    let isolation = TaskIsolation {
        kind: crate::model::TaskIsolationKind::StagedProject,
        execution_root: workspace.to_string_lossy().into_owned(),
        baseline_root: store
            .root()
            .join(&task.id)
            .join("baseline")
            .to_string_lossy()
            .into_owned(),
        source_revision: "snapshot:base".into(),
        baseline_hash: "base".into(),
        baseline: Vec::new(),
        allowed_paths: vec!["main.tex".into()],
        created_at: now_ms(),
        skipped: Vec::new(),
    };
    assert!(store
        .set_isolation(&task.id, running.execution_generation, &isolation)
        .unwrap());
    assert!(store
        .set_native_session(&task.id, running.execution_generation, "native-session")
        .unwrap());
    store
        .append_event(
            &task.id,
            running.execution_generation,
            &TaskRuntimeEvent::Text {
                text: "Saved a revised manuscript.".into(),
            },
        )
        .unwrap();
    let result = TaskResultMetadata {
        summary: "Revised results".into(),
        changed_files: vec![crate::model::TaskFileChange {
            path: "main.tex".into(),
            kind: crate::model::TaskFileChangeKind::Modified,
            before_sha256: Some("before".into()),
            after_sha256: Some("after".into()),
            before_size: Some(4),
            after_size: Some(15),
        }],
        artifacts: Vec::new(),
        native_session_id: Some("native-session".into()),
        input_tokens: Some(10),
        output_tokens: Some(5),
    };
    assert!(store
        .finish_success(&task.id, running.execution_generation, &result)
        .unwrap());
    store.require(&task.id).unwrap()
}

#[test]
fn deleting_a_task_drops_its_transcript_and_spares_tasks_that_depend_on_it() {
    let (_temp, store) = store();
    let dependency = store.create(draft("paper", "Collect evidence")).unwrap();
    let mut dependent = draft("paper", "Write the summary");
    dependent.dependency_ids = vec![dependency.id.clone()];
    let dependent = store.create(dependent).unwrap();
    store
        .append_event(
            &dependency.id,
            0,
            &TaskRuntimeEvent::Text {
                text: "Collected sources.".into(),
            },
        )
        .unwrap();

    let error = store.delete(&dependency.id).unwrap_err();
    assert!(error.contains("Another task waits for this one"));
    assert!(store.require(&dependency.id).is_ok());

    store.delete(&dependent.id).unwrap();
    assert!(store.require(&dependent.id).is_err());
    store.delete(&dependency.id).unwrap();
    assert!(store.require(&dependency.id).is_err());
    assert!(store.list("paper").unwrap().is_empty());
    let connection = store.open().unwrap();
    let events: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM research_task_events WHERE task_id = ?1",
            [&dependency.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(events, 0);
    assert!(store.delete(&dependency.id).is_err());
}

#[test]
fn a_running_task_cannot_be_deleted_until_it_settles() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Long run")).unwrap();
    store.request_start(&task.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    let error = store.delete(&task.id).unwrap_err();
    assert!(error.contains("Stop this task before deleting it."));
    assert!(store
        .finish_failure(&task.id, running.execution_generation, "stopped")
        .unwrap());
    store.delete(&task.id).unwrap();
    assert!(store.require(&task.id).is_err());
}

#[test]
fn discarding_review_keeps_saved_work_until_a_new_generation_is_claimed() {
    let (_temp, store) = store();
    let reviewed = reviewable_task(&store);
    store
        .clear_apply(
            &reviewed.id,
            Some("The project changed since this task started."),
        )
        .unwrap();
    let cancelled = store.request_cancel(&reviewed.id).unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert_eq!(cancelled.result, reviewed.result);
    assert_eq!(cancelled.isolation, reviewed.isolation);
    assert_eq!(cancelled.session_id, reviewed.session_id);
    assert_eq!(cancelled.native_session_id, reviewed.native_session_id);
    assert!(cancelled.error.is_some());
    let queued = store
        .retry_with(&reviewed.id, crate::model::RetryMode::Fresh)
        .unwrap();
    assert_eq!(queued.status, ResearchTaskStatus::Queued);
    assert_eq!(queued.result, reviewed.result);
    assert_eq!(queued.isolation, reviewed.isolation);
    assert_eq!(queued.execution_generation, reviewed.execution_generation);
    store.request_start(&reviewed.id).unwrap();
    let claimed = store.claim_next().unwrap().unwrap();
    assert_eq!(
        claimed.execution_generation,
        reviewed.execution_generation + 1
    );
    assert!(claimed.result.is_none());
    assert!(claimed.review.is_none());
    assert!(claimed.isolation.is_none());
    let history = store
        .events(&reviewed.id, reviewed.execution_generation, None, 100)
        .unwrap();
    assert_eq!(history.events.len(), 1);
    let saved = Path::new(&reviewed.isolation.as_ref().unwrap().execution_root).join("main.tex");
    assert_eq!(std::fs::read_to_string(saved).unwrap(), "reviewed result");
}

#[test]
fn discarding_review_is_blocked_until_an_apply_is_cleared() {
    let (_temp, store) = store();
    let reviewed = reviewable_task(&store);
    store
        .begin_apply(
            &reviewed.id,
            reviewed.execution_generation,
            1,
            &["main.tex".into()],
        )
        .unwrap();
    assert!(store
        .request_cancel(&reviewed.id)
        .unwrap_err()
        .contains("being applied or recovered"));
    assert!(store
        .retry_with(&reviewed.id, crate::model::RetryMode::Fresh)
        .is_err());
    assert_eq!(
        store.require(&reviewed.id).unwrap().status,
        ResearchTaskStatus::AwaitingReview
    );
    assert_eq!(store.pending_applies().unwrap().len(), 1);
    store.clear_apply(&reviewed.id, None).unwrap();
    assert_eq!(
        store.request_cancel(&reviewed.id).unwrap().status,
        ResearchTaskStatus::Cancelled
    );
}

#[test]
fn review_cancellation_and_apply_claim_cannot_both_win() {
    let (_temp, store) = store();
    let reviewed = reviewable_task(&store);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let cancel_store = store.clone();
    let cancel_id = reviewed.id.clone();
    let cancel_barrier = barrier.clone();
    let cancellation = std::thread::spawn(move || {
        cancel_barrier.wait();
        cancel_store.request_cancel(&cancel_id)
    });
    barrier.wait();
    let applying = store.begin_apply(
        &reviewed.id,
        reviewed.execution_generation,
        1,
        &["main.tex".into()],
    );
    let cancellation = cancellation.join().unwrap();
    assert_ne!(applying.is_ok(), cancellation.is_ok());
    let current = store.require(&reviewed.id).unwrap();
    if applying.is_ok() {
        assert_eq!(current.status, ResearchTaskStatus::AwaitingReview);
        assert_eq!(store.pending_applies().unwrap().len(), 1);
    } else {
        assert_eq!(current.status, ResearchTaskStatus::Cancelled);
        assert!(store.pending_applies().unwrap().is_empty());
    }
    assert_eq!(current.result, reviewed.result);
    assert_eq!(current.isolation, reviewed.isolation);
}

#[test]
fn claim_is_atomic_and_a_second_launch_finds_nothing() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Audit evidence")).unwrap();
    store.request_start(&task.id).unwrap();

    let claimed = store.claim_next().unwrap().unwrap();
    assert_eq!(claimed.status, ResearchTaskStatus::Running);
    assert_eq!(claimed.execution_generation, 1);
    assert!(store.claim_next().unwrap().is_none());
}

#[test]
fn stale_completion_cannot_finish_a_retried_generation() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Revise results")).unwrap();
    store.request_start(&task.id).unwrap();
    let first = store.claim_next().unwrap().unwrap();
    store
        .finish_failure(&task.id, first.execution_generation, "failed")
        .unwrap();
    store
        .retry_with(&task.id, crate::model::RetryMode::Fresh)
        .unwrap();
    store.request_start(&task.id).unwrap();
    let second = store.claim_next().unwrap().unwrap();

    let stale = TaskResultMetadata {
        summary: "old".into(),
        changed_files: Vec::new(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    };
    assert!(!store
        .finish_success(&task.id, first.execution_generation, &stale)
        .unwrap());
    assert_eq!(store.require(&task.id).unwrap().execution_generation, 2);
    assert_eq!(second.execution_generation, 2);
}

#[test]
fn a_persisted_cancel_request_wins_over_task_completion() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Review results")).unwrap();
    store.request_start(&task.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    store.request_cancel(&task.id).unwrap();
    let result = TaskResultMetadata {
        summary: "finished concurrently".into(),
        changed_files: Vec::new(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    };

    assert!(!store
        .finish_success(&task.id, running.execution_generation, &result)
        .unwrap());
    let stopping = store.require(&task.id).unwrap();
    assert_eq!(stopping.status, ResearchTaskStatus::Running);
    assert!(stopping.cancel_requested);
    assert!(store
        .finalize_cancel(&task.id, running.execution_generation)
        .unwrap());
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::Cancelled
    );
}

#[test]
fn dependency_cycles_are_rejected() {
    let (_temp, store) = store();
    let first = store.create(draft("paper", "First")).unwrap();
    let mut second_draft = draft("paper", "Second");
    second_draft.dependency_ids = vec![first.id.clone()];
    let second = store.create(second_draft).unwrap();
    let edit = ResearchTaskEdit {
        title: first.title.clone(),
        prompt: first.prompt.clone(),
        runtime_id: first.runtime_id.clone(),
        agent_id: first.agent_id.clone(),
        model_id: first.model_id.clone(),
        skill_ids: Vec::new(),
        dependency_ids: vec![second.id],
        ..Default::default()
    };

    assert_eq!(
        store.edit(&first.id, edit).unwrap_err(),
        "These dependencies create a cycle."
    );
}

#[test]
fn interrupted_runs_recover_as_failures_with_the_workspace_intact() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Check analysis")).unwrap();
    store.request_start(&task.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    let isolation = TaskIsolation {
        kind: crate::model::TaskIsolationKind::StagedProject,
        execution_root: "/managed/task".into(),
        baseline_root: "/managed/task-baseline".into(),
        source_revision: "snapshot:abc".into(),
        baseline_hash: "abc".into(),
        baseline: Vec::new(),
        allowed_paths: Vec::new(),
        created_at: now_ms(),
        skipped: Vec::new(),
    };
    store
        .set_isolation(&task.id, running.execution_generation, &isolation)
        .unwrap();

    store.recover_interrupted().unwrap();
    let recovered = store.require(&task.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::Failed);
    assert_eq!(recovered.isolation, Some(isolation));
    assert!(recovered.error.unwrap().contains("closed before"));
}

fn dependent(store: &TaskStore, title: &str, on: &ResearchTask) -> ResearchTask {
    let mut next = draft("paper", title);
    next.dependency_ids = vec![on.id.clone()];
    store.create(next).unwrap()
}

#[test]
fn a_failed_dependency_fails_waiting_dependents_with_a_reason() {
    let (_temp, store) = store();
    let a = store.create(draft("paper", "A")).unwrap();
    let b = dependent(&store, "B", &a);
    let c = dependent(&store, "C", &b);
    let d = dependent(&store, "D", &a);
    store.request_start(&a.id).unwrap();
    store.request_start(&b.id).unwrap();
    store.request_start(&c.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    assert_eq!(running.id, a.id);

    assert!(store
        .finish_failure(&a.id, running.execution_generation, "stopped")
        .unwrap());

    let b = store.require(&b.id).unwrap();
    assert_eq!(b.status, ResearchTaskStatus::Failed);
    assert_eq!(
        b.error.as_deref(),
        Some(
            "This task waits for \"A\", which failed. Retry that task first, then retry this one."
        )
    );
    let c = store.require(&c.id).unwrap();
    assert_eq!(c.status, ResearchTaskStatus::Failed);
    assert!(c.error.unwrap().contains("\"B\""));
    // Never started, so it waits in the queue for a retry of A.
    assert_eq!(
        store.require(&d.id).unwrap().status,
        ResearchTaskStatus::Queued
    );
    let mut waiting = store.dependent_ids(&a.id).unwrap();
    waiting.sort();
    let mut expected = vec![b.id, c.id, d.id];
    expected.sort();
    assert_eq!(waiting, expected);
}

#[test]
fn a_cancelled_dependency_fails_waiting_dependents() {
    let (_temp, store) = store();
    let a = store.create(draft("paper", "A")).unwrap();
    let b = dependent(&store, "B", &a);
    store.request_start(&b.id).unwrap();

    store.request_cancel(&a.id).unwrap();

    let b = store.require(&b.id).unwrap();
    assert_eq!(b.status, ResearchTaskStatus::Failed);
    assert_eq!(
        b.error.as_deref(),
        Some("This task waits for \"A\", which was cancelled. Retry that task first, then retry this one.")
    );
}

#[test]
fn starting_a_task_whose_dependency_failed_is_refused() {
    let (_temp, store) = store();
    let a = store.create(draft("paper", "A")).unwrap();
    let b = dependent(&store, "B", &a);
    store.request_start(&a.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    store
        .finish_failure(&a.id, running.execution_generation, "stopped")
        .unwrap();

    assert_eq!(
        store.request_start(&b.id).unwrap_err(),
        "Retry \"A\" first. This task depends on it."
    );
}

#[test]
fn recovery_fails_the_dependents_of_an_interrupted_run() {
    let (_temp, store) = store();
    let a = store.create(draft("paper", "A")).unwrap();
    let b = dependent(&store, "B", &a);
    store.request_start(&a.id).unwrap();
    store.request_start(&b.id).unwrap();
    let running = store.claim_next().unwrap().unwrap();
    store.set_owner(&running.id, None).unwrap();

    let recovered = store.recover_interrupted().unwrap();

    let b = recovered.iter().find(|task| task.id == b.id).unwrap();
    assert_eq!(b.status, ResearchTaskStatus::Failed);
}

fn isolation_with(workspace: &std::path::Path, files: usize) -> TaskIsolation {
    TaskIsolation {
        kind: crate::model::TaskIsolationKind::StagedProject,
        execution_root: workspace.to_string_lossy().into_owned(),
        baseline_root: workspace.join("baseline").to_string_lossy().into_owned(),
        source_revision: "snapshot:base".into(),
        baseline_hash: "base".into(),
        baseline: (0..files)
            .map(|index| crate::model::ManifestEntry {
                path: format!("sections/{index}.tex"),
                sha256: "0".repeat(64),
                size: 1,
                resolved_link: false,
            })
            .collect(),
        allowed_paths: vec!["sections".into()],
        created_at: now_ms(),
        skipped: Vec::new(),
    }
}

#[test]
fn a_0_4_7_store_migrates_to_version_2_without_losing_rows() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("tasks");
    std::fs::create_dir_all(&root).unwrap();
    let connection = Connection::open(root.join("tasks.sqlite3")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE research_tasks (
               id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
               prompt TEXT NOT NULL, runtime_id TEXT NOT NULL, agent_id TEXT NOT NULL,
               model_id TEXT NOT NULL, skill_ids_json TEXT NOT NULL, status TEXT NOT NULL,
               execution_generation INTEGER NOT NULL DEFAULT 0, session_id TEXT,
               native_session_id TEXT, source_revision TEXT, isolation_json TEXT, error TEXT,
               result_json TEXT, review_json TEXT,
               start_requested INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
               apply_state TEXT, apply_selection_json TEXT, apply_expected_generation INTEGER,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
               started_at INTEGER, finished_at INTEGER,
               owner_pid INTEGER, owner_started INTEGER);
             CREATE TABLE research_task_dependencies (
               task_id TEXT NOT NULL, dependency_id TEXT NOT NULL, PRIMARY KEY(task_id, dependency_id));
             CREATE TABLE research_task_events (
               task_id TEXT NOT NULL, execution_generation INTEGER NOT NULL, sequence INTEGER NOT NULL,
               event_json TEXT NOT NULL, created_at INTEGER NOT NULL,
               PRIMARY KEY(task_id, execution_generation, sequence));
             INSERT INTO research_tasks (id, project_id, title, prompt, runtime_id, agent_id, model_id,
               skill_ids_json, status, created_at, updated_at)
               VALUES ('task-old', 'paper', 'Old task', 'Do it', 'builtin', 'openai', 'gpt', '[]', 'queued', 1, 1);
             INSERT INTO research_task_events VALUES ('task-old', 0, 1, '{\"kind\":\"text\",\"text\":\"hi\"}', 1);
             PRAGMA user_version = 1;",
        )
        .unwrap();
    drop(connection);

    let store = TaskStore::new(root.clone()).unwrap();
    let version: i64 = Connection::open(root.join("tasks.sqlite3"))
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    // 0.4.8 L: the store migrates on to the handoff columns too.
    assert_eq!(version, SCHEMA_VERSION);
    let task = store.require("task-old").unwrap();
    assert_eq!(task.brief, ResearchBrief::default());
    assert_eq!(task.record_slug, "");
    assert_eq!(task.owner, OwnerKind::App);
    assert_eq!(
        store.events("task-old", 0, None, 10).unwrap().events.len(),
        1
    );
}

#[test]
fn a_task_created_without_a_brief_gets_the_defaults() {
    let (_temp, store) = store();
    let task = store.create(draft("paper", "Defaults")).unwrap();
    assert_eq!(task.brief.budget.wall_clock_minutes, 120);
    assert_eq!(task.brief.budget.run_timeout_minutes, 60);
    assert_eq!(
        task.brief.permissions.commands,
        crate::model::CommandPolicy::Allow
    );
    assert!(!task.brief.permissions.network);
    assert_eq!(task.brief.compute.executor, "local");
    assert!(task.record_slug.starts_with("defaults-"));
    assert_eq!(task.record_dir(), format!("research/{}", task.record_slug));
}

#[test]
fn brief_limits_are_enforced() {
    let (_temp, store) = store();
    let with = |change: &dyn Fn(&mut ResearchBrief)| {
        let mut brief = ResearchBrief::default();
        change(&mut brief);
        let mut next = draft("paper", "Limits");
        next.brief = Some(brief);
        store.create(next).unwrap_err()
    };
    assert_eq!(
        with(&|brief| brief.goal = "x".repeat(4_001)),
        "The brief goal is too long."
    );
    assert_eq!(
        with(&|brief| brief.success_criteria = vec!["c".into(); 13]),
        "Use at most 12 success criteria."
    );
    assert_eq!(
        with(&|brief| brief.success_criteria = vec!["c".repeat(501)]),
        "Each success criterion can be up to 500 characters."
    );
    assert_eq!(
        with(&|brief| brief.budget.wall_clock_minutes = 4),
        "The time budget must be between 5 minutes and 24 hours."
    );
    assert_eq!(
        with(&|brief| brief.budget.usd_cap = Some(0.0)),
        "The cost limit must be above zero."
    );
    assert_eq!(
        with(&|brief| brief.budget.max_runs = Some(1_001)),
        "The run limit must be between 1 and 1,000."
    );
    assert_eq!(
        with(&|brief| brief.budget.run_timeout_minutes = 721),
        "Each run can last up to 12 hours."
    );
    assert_eq!(
        with(&|brief| {
            brief.primary_metric = Some(crate::model::PrimaryMetric {
                name: "a b".into(),
                goal: crate::model::MetricGoal::Maximize,
            })
        }),
        "Use a metric name made of letters, numbers, dots, dashes or underscores."
    );
    let mut late = draft("paper", "Later");
    late.run_after = Some(now_ms() + 31 * 24 * 60 * 60 * 1000);
    assert_eq!(
        store.create(late).unwrap_err(),
        "The start time must be within the next 30 days."
    );
}

// 0.4.8 I: desktop apps need someone at the computer.
#[test]
fn tasks_with_desktop_apps_cannot_run_unattended() {
    let (_temp, store) = store();
    let desktop_brief = || {
        let mut brief = crate::model::ResearchBrief::default();
        brief.permissions.desktop_apps = true;
        brief
    };
    let code = |error: String| -> String {
        let json: serde_json::Value =
            serde_json::from_str(error.strip_prefix("@oleafly/error:").unwrap()).unwrap();
        json["code"].as_str().unwrap().to_string()
    };

    let mut scheduled = draft("paper", "Scheduled");
    scheduled.brief = Some(desktop_brief());
    scheduled.run_after = Some(now_ms() + 60 * 60 * 1000);
    assert_eq!(
        code(store.create(scheduled).unwrap_err()),
        "desktop_apps.task_unattended"
    );

    let mut after_quit = draft("paper", "After quit");
    after_quit.brief = Some(desktop_brief());
    after_quit.keep_running_after_quit = true;
    assert_eq!(
        code(store.create(after_quit).unwrap_err()),
        "desktop_apps.task_unattended"
    );

    let mut attended = draft("paper", "Attended");
    attended.brief = Some(desktop_brief());
    let task = store.create(attended).unwrap();
    let edit = crate::model::ResearchTaskEdit {
        title: task.title.clone(),
        prompt: task.prompt.clone(),
        runtime_id: task.runtime_id.clone(),
        agent_id: task.agent_id.clone(),
        model_id: task.model_id.clone(),
        keep_running_after_quit: true,
        ..Default::default()
    };
    assert_eq!(
        code(store.edit(&task.id, edit).unwrap_err()),
        "desktop_apps.task_unattended"
    );
}

#[test]
fn the_view_drops_the_baseline_manifest_and_allowed_paths() {
    let (temp, store) = store();
    let running = claimed(&store, "Big workspace");
    let isolation = isolation_with(temp.path(), 3_000);
    assert!(store
        .set_isolation(&running.id, running.execution_generation, &isolation)
        .unwrap());
    let view = crate::model::ResearchTaskView::from(&store.require(&running.id).unwrap());
    let json = serde_json::to_string(&view).unwrap();
    assert!(!json.contains("\"baseline\""));
    assert!(!json.contains("allowedPaths"));
    assert_eq!(view.isolation.unwrap().file_count, 3_000);
}

#[test]
fn plan_ready_keeps_the_workspace_and_approval_resumes_it() {
    let (temp, store) = store();
    let running = claimed(&store, "Plan first");
    let isolation = isolation_with(temp.path(), 2);
    store
        .set_isolation(&running.id, running.execution_generation, &isolation)
        .unwrap();
    assert!(store
        .finish_plan_ready(&running.id, running.execution_generation)
        .unwrap());
    let ready = store.require(&running.id).unwrap();
    assert_eq!(ready.status, ResearchTaskStatus::PlanReady);
    assert_eq!(ready.isolation.as_ref(), Some(&isolation));

    let queued = store.approve_plan(&running.id).unwrap();
    assert_eq!(queued.status, ResearchTaskStatus::Queued);
    assert!(queued.start_requested);
    let resumed = store.claim_next().unwrap().unwrap();
    assert_eq!(
        resumed.execution_generation,
        running.execution_generation + 1
    );
    assert_eq!(resumed.isolation.as_ref(), Some(&isolation));
    assert!(resumed.plan_approved);
    assert!(matches!(
        resumed.pending_start,
        Some(PendingStart::Resume {
            reason: crate::model::ResumeReason::PlanApproved,
            ..
        })
    ));
    store
        .clear_pending_start(&resumed.id, resumed.execution_generation)
        .unwrap();
    assert_eq!(store.require(&resumed.id).unwrap().pending_start, None);
}

#[test]
fn resume_retry_reuses_the_workspace_and_fresh_retry_does_not() {
    let (temp, store) = store();
    let running = claimed(&store, "Retry me");
    let isolation = isolation_with(temp.path(), 1);
    store
        .set_isolation(&running.id, running.execution_generation, &isolation)
        .unwrap();
    store
        .finish_failure(&running.id, running.execution_generation, "stopped")
        .unwrap();

    store
        .retry_with(&running.id, crate::model::RetryMode::Resume)
        .unwrap();
    store.request_start(&running.id).unwrap();
    let resumed = store.claim_next().unwrap().unwrap();
    assert_eq!(resumed.isolation.as_ref(), Some(&isolation));
    store
        .finish_failure(&resumed.id, resumed.execution_generation, "stopped again")
        .unwrap();

    store
        .retry_with(&running.id, crate::model::RetryMode::Fresh)
        .unwrap();
    store.request_start(&running.id).unwrap();
    let fresh = store.claim_next().unwrap().unwrap();
    assert_eq!(fresh.isolation, None);
    assert_eq!(
        fresh.pending_start,
        Some(PendingStart::Fresh {
            carry_from: Some(isolation.execution_root.clone())
        })
    );
    assert_eq!(fresh.active_ms, 0);
}

#[test]
fn a_daemon_store_claims_only_daemon_tasks() {
    let (temp, store) = store();
    let running = claimed(&store, "Hand me off");
    store
        .set_isolation(
            &running.id,
            running.execution_generation,
            &isolation_with(temp.path(), 1),
        )
        .unwrap();
    assert!(store
        .hand_off(&running.id, running.execution_generation, OwnerKind::Daemon)
        .unwrap());
    assert!(store.claim_next().unwrap().is_none());
    let daemon = TaskStore::with_owner_kind(store.root().to_path_buf(), OwnerKind::Daemon).unwrap();
    let claimed = daemon.claim_next().unwrap().unwrap();
    assert_eq!(claimed.id, running.id);
    assert_eq!(claimed.owner, OwnerKind::Daemon);
}

#[test]
fn scheduled_tasks_wait_for_their_start_time() {
    let (_temp, store) = store();
    let mut later = draft("paper", "Tonight");
    let at = now_ms() + 60_000;
    later.run_after = Some(at);
    let task = store.create(later).unwrap();
    store.request_start(&task.id).unwrap();
    assert!(store.claim_next().unwrap().is_none());
    assert_eq!(store.next_run_after().unwrap(), Some(at));
}

#[test]
fn attention_counts_review_plan_and_pending_approvals_per_project() {
    let (temp, store) = store();
    reviewable_task(&store);
    let planning = claimed(&store, "Plan");
    store
        .set_isolation(
            &planning.id,
            planning.execution_generation,
            &isolation_with(temp.path(), 1),
        )
        .unwrap();
    store
        .finish_plan_ready(&planning.id, planning.execution_generation)
        .unwrap();
    let mut other = draft("other", "Asks");
    other.project_id = "other".into();
    let asking = store.create(other).unwrap();
    store.request_start(&asking.id).unwrap();
    let asking = store.claim_next().unwrap().unwrap();
    store
        .insert_approval(
            &asking.id,
            asking.execution_generation,
            crate::model::ApprovalKind::Command,
            "Run pytest",
            "pytest -q",
            now_ms() + 60_000,
        )
        .unwrap();

    let summary = store.attention().unwrap();
    assert_eq!(summary.by_project.get("paper"), Some(&2));
    assert_eq!(summary.by_project.get("other"), Some(&1));
    assert_eq!(store.require(&asking.id).unwrap().pending_approvals, 1);
}

#[test]
fn old_tool_rows_and_new_event_kinds_round_trip() {
    let events = [
        TaskRuntimeEvent::Run {
            run_id: "r001".into(),
            name: "baseline".into(),
            state: crate::model::RunState::Succeeded,
            exit_code: Some(0),
        },
        TaskRuntimeEvent::Approval {
            approval_id: "a1".into(),
            approval_kind: crate::model::ApprovalKind::Run,
            status: crate::model::ApprovalStatus::Pending,
            summary: "Train".into(),
        },
        TaskRuntimeEvent::Phase {
            phase: TaskPhase::WaitingRuns,
        },
    ];
    for (event, kind) in events.iter().zip(["run", "approval", "phase"]) {
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["kind"], kind);
        assert_eq!(
            &serde_json::from_value::<TaskRuntimeEvent>(json).unwrap(),
            event
        );
    }
    let old: TaskRuntimeEvent =
        serde_json::from_str(r#"{"kind":"tool","name":"read_file","detail":"main.tex"}"#).unwrap();
    assert!(matches!(old, TaskRuntimeEvent::Tool { .. }));
}

#[test]
fn schema_initialization_runs_once_per_store() {
    let before = SCHEMA_INITIALIZATIONS.with(std::cell::Cell::get);
    let (_temp, store) = store();
    for _ in 0..50 {
        store.open().unwrap();
    }
    assert_eq!(
        SCHEMA_INITIALIZATIONS.with(std::cell::Cell::get) - before,
        1
    );
}

#[test]
fn a_plan_ready_task_can_be_cancelled() {
    let (temp, store) = store();
    let running = claimed(&store, "Plan");
    store
        .set_isolation(
            &running.id,
            running.execution_generation,
            &isolation_with(temp.path(), 1),
        )
        .unwrap();
    store
        .finish_plan_ready(&running.id, running.execution_generation)
        .unwrap();
    assert_eq!(
        store.request_cancel(&running.id).unwrap().status,
        ResearchTaskStatus::Cancelled
    );
}

// 0.4.8 L: handoffs between the app and the background helper.
mod handoff {
    use std::collections::BTreeSet;

    use super::*;

    const OTHER_PROCESS: ProcessIdentity = ProcessIdentity {
        pid: u32::MAX - 2,
        started: Some(21),
    };
    const LIVE_HELPER: ProcessIdentity = ProcessIdentity {
        pid: u32::MAX - 5,
        started: Some(31),
    };
    const DEAD_HELPER: ProcessIdentity = ProcessIdentity {
        pid: u32::MAX - 6,
        started: Some(32),
    };

    fn record(reason: HandoffReason) -> HandoffRecord {
        HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, reason, 0)
    }

    fn keep_running(store: &TaskStore, title: &str) -> ResearchTask {
        let mut draft = draft("paper", title);
        draft.keep_running_after_quit = true;
        let task = store.create(draft).unwrap();
        store.request_start(&task.id).unwrap()
    }

    fn claimed_keep_running(temp: &TempDir, store: &TaskStore, title: &str) -> ResearchTask {
        let task = keep_running(store, title);
        let running = store.claim_next().unwrap().unwrap();
        assert_eq!(running.id, task.id);
        let workspace = temp.path().join(format!("workspace-{}", task.id));
        std::fs::create_dir_all(&workspace).unwrap();
        assert!(store
            .set_isolation(
                &running.id,
                running.execution_generation,
                &isolation_with(&workspace, 1)
            )
            .unwrap());
        store.require(&running.id).unwrap()
    }

    fn helper_as(store: &TaskStore, owner: ProcessIdentity) -> TaskStore {
        TaskStore {
            owner,
            owner_kind: OwnerKind::Daemon,
            ..store.clone()
        }
    }

    fn result() -> TaskResultMetadata {
        TaskResultMetadata {
            summary: "done".into(),
            changed_files: Vec::new(),
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        }
    }

    #[test]
    fn a_version_2_store_gains_the_columns_and_keeps_its_rows() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("tasks");
        std::fs::create_dir_all(&root).unwrap();
        let connection = Connection::open(root.join("tasks.sqlite3")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE research_tasks (
                   id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                   prompt TEXT NOT NULL, runtime_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                   model_id TEXT NOT NULL, skill_ids_json TEXT NOT NULL, status TEXT NOT NULL,
                   execution_generation INTEGER NOT NULL DEFAULT 0, session_id TEXT,
                   native_session_id TEXT, source_revision TEXT, isolation_json TEXT, error TEXT,
                   result_json TEXT, review_json TEXT,
                   start_requested INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
                   apply_state TEXT, apply_selection_json TEXT, apply_expected_generation INTEGER,
                   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                   started_at INTEGER, finished_at INTEGER,
                   owner_pid INTEGER, owner_started INTEGER,
                   brief_json TEXT, record_slug TEXT NOT NULL DEFAULT '', run_after INTEGER,
                   keep_running_after_quit INTEGER NOT NULL DEFAULT 0,
                   owner_kind TEXT NOT NULL DEFAULT 'app', phase TEXT,
                   plan_approved INTEGER NOT NULL DEFAULT 0, pending_start_json TEXT,
                   evidence_json TEXT, todos_json TEXT, stop_reason TEXT,
                   active_ms INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE research_task_dependencies (
                   task_id TEXT NOT NULL, dependency_id TEXT NOT NULL, PRIMARY KEY(task_id, dependency_id));
                 CREATE TABLE research_task_events (
                   task_id TEXT NOT NULL, execution_generation INTEGER NOT NULL, sequence INTEGER NOT NULL,
                   event_json TEXT NOT NULL, created_at INTEGER NOT NULL,
                   PRIMARY KEY(task_id, execution_generation, sequence));
                 CREATE TABLE research_task_runs (
                   task_id TEXT NOT NULL, run_id TEXT NOT NULL, execution_generation INTEGER NOT NULL,
                   name TEXT NOT NULL, executor TEXT NOT NULL, command TEXT NOT NULL, cwd_rel TEXT NOT NULL,
                   state TEXT NOT NULL, exit_code INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER,
                   run_dir TEXT NOT NULL, handle_json TEXT, metrics_json TEXT,
                   reported INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(task_id, run_id));
                 CREATE TABLE research_task_approvals (
                   id TEXT PRIMARY KEY, task_id TEXT NOT NULL, execution_generation INTEGER NOT NULL,
                   kind TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL,
                   created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER);
                 INSERT INTO research_tasks (id, project_id, title, prompt, runtime_id, agent_id, model_id,
                   skill_ids_json, status, created_at, updated_at, keep_running_after_quit, owner_kind)
                   VALUES ('task-v2', 'paper', 'Kept', 'Do it', 'builtin', 'openai', 'gpt', '[]',
                           'queued', 1, 1, 1, 'daemon');
                 PRAGMA user_version = 2;",
            )
            .unwrap();
        drop(connection);

        let store = TaskStore::new(root.clone()).unwrap();
        let version: i64 = Connection::open(root.join("tasks.sqlite3"))
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 3);
        let task = store.require("task-v2").unwrap();
        assert!(task.keep_running_after_quit);
        assert_eq!(task.owner, OwnerKind::Daemon);
        assert!(!task.reclaim_requested);
        assert_eq!(task.resumed_from, None);
        assert!(store.handoff_record("task-v2").unwrap().is_none());
    }

    #[test]
    fn a_handoff_keeps_the_workspace_and_the_next_claim_continues_from_it() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Overnight");
        assert!(app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &record(HandoffReason::Quit)
            )
            .unwrap());
        assert_eq!(
            app.require(&running.id).unwrap().status,
            ResearchTaskStatus::Queued
        );
        assert!(app.claim_next().unwrap().is_none());
        let daemon =
            TaskStore::with_owner_kind(app.root().to_path_buf(), OwnerKind::Daemon).unwrap();
        let claimed = daemon.claim_next().unwrap().unwrap();
        assert_eq!(
            (claimed.execution_generation, claimed.resumed_from),
            (
                running.execution_generation + 1,
                Some(running.execution_generation)
            )
        );
        assert_eq!(
            claimed.isolation.unwrap().execution_root,
            running.isolation.unwrap().execution_root
        );
        assert!(matches!(
            claimed.pending_start,
            Some(PendingStart::Resume {
                reason: ResumeReason::Handoff,
                ..
            })
        ));
        let handed = daemon.handoff_record(&running.id).unwrap().unwrap();
        assert_eq!(
            (handed.reason, handed.to, handed.from_generation),
            (
                HandoffReason::Quit,
                OwnerKind::Daemon,
                running.execution_generation
            )
        );
    }

    #[test]
    fn the_old_owner_cannot_write_after_handing_off() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Moved");
        let generation = running.execution_generation;
        assert!(app
            .hand_off_with(
                &running.id,
                generation,
                OwnerKind::Daemon,
                &record(HandoffReason::Quit)
            )
            .unwrap());
        let daemon =
            TaskStore::with_owner_kind(app.root().to_path_buf(), OwnerKind::Daemon).unwrap();
        daemon.claim_next().unwrap().unwrap();
        let late = TaskRuntimeEvent::Text {
            text: "late".into(),
        };
        assert_eq!(
            app.append_event(&running.id, generation, &late).unwrap(),
            None
        );
        assert!(!app
            .finish_success(&running.id, generation, &result())
            .unwrap());
        assert!(!app.finish_failure(&running.id, generation, "late").unwrap());
        assert!(!app
            .hand_off_with(
                &running.id,
                generation,
                OwnerKind::App,
                &record(HandoffReason::Reclaim)
            )
            .unwrap());
    }

    #[test]
    fn a_handoff_by_another_process_is_refused() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Someone else's");
        app.set_owner(&running.id, Some(FOREIGN)).unwrap();
        assert!(!app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &record(HandoffReason::Quit)
            )
            .unwrap());
        assert_eq!(
            app.require(&running.id).unwrap().status,
            ResearchTaskStatus::Running
        );
    }

    #[test]
    fn a_cancel_wins_over_a_handoff() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Cancelled");
        app.request_cancel(&running.id).unwrap();
        assert!(!app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &record(HandoffReason::Quit)
            )
            .unwrap());
        assert!(app
            .finalize_cancel(&running.id, running.execution_generation)
            .unwrap());
    }

    #[test]
    fn a_task_still_preparing_its_workspace_starts_fresh_after_a_handoff() {
        let (_temp, app) = store();
        keep_running(&app, "Preparing");
        let running = app.claim_next().unwrap().unwrap();
        assert!(running.isolation.is_none());
        assert!(app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &record(HandoffReason::Quit)
            )
            .unwrap());
        let queued = app.require(&running.id).unwrap();
        assert_eq!(queued.status, ResearchTaskStatus::Queued);
        assert!(queued.pending_start.is_none());
        assert_eq!(queued.owner, OwnerKind::Daemon);
    }

    #[test]
    fn two_helpers_claiming_at_once_never_share_a_task() {
        let (_temp, app) = store();
        let mut ids = Vec::new();
        for index in 0..20 {
            let task = keep_running(&app, &format!("Task {index}"));
            assert!(app
                .hand_off_queued(&task.id, OwnerKind::Daemon, &record(HandoffReason::Quit))
                .unwrap());
            ids.push(task.id);
        }
        let claim_all = |store: TaskStore| {
            std::thread::spawn(move || {
                let mut claimed = Vec::new();
                while let Ok(Some(task)) = store.claim_next() {
                    claimed.push(task.id);
                }
                claimed
            })
        };
        let first = claim_all(helper_as(&app, LIVE_HELPER));
        let second = claim_all(helper_as(&app, DEAD_HELPER));
        let (first, second) = (first.join().unwrap(), second.join().unwrap());
        let union: BTreeSet<&String> = first.iter().chain(&second).collect();
        assert_eq!(union.len(), 20);
        assert!(first.iter().all(|id| !second.contains(id)));
    }

    #[test]
    fn a_queued_task_waiting_on_ordinary_work_stays_with_the_app() {
        let (_temp, app) = store();
        let ordinary = app.create(draft("paper", "Ordinary")).unwrap();
        app.request_start(&ordinary.id).unwrap();
        let mut waiting = draft("paper", "Waits");
        waiting.keep_running_after_quit = true;
        waiting.dependency_ids = vec![ordinary.id.clone()];
        let waiting = app.create(waiting).unwrap();
        app.request_start(&waiting.id).unwrap();
        let alone = keep_running(&app, "Alone");
        let candidates: Vec<String> = app
            .handoff_candidates()
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert_eq!(candidates, vec![alone.id]);
    }

    #[test]
    fn reclaim_marks_live_helper_work_and_takes_unheld_work_directly() {
        let (_temp, app) = store();
        let ids: Vec<String> = (0..3)
            .map(|index| {
                let task = keep_running(&app, &format!("Helper task {index}"));
                assert!(app
                    .hand_off_queued(&task.id, OwnerKind::Daemon, &record(HandoffReason::Quit))
                    .unwrap());
                task.id
            })
            .collect();
        let live_helper = helper_as(&app, LIVE_HELPER);
        let held = live_helper.claim_next().unwrap().unwrap();
        let dead_helper = helper_as(&app, DEAD_HELPER);
        let abandoned = dead_helper.claim_next().unwrap().unwrap();
        assert_eq!(
            (held.id.clone(), abandoned.id.clone()),
            (ids[0].clone(), ids[1].clone())
        );
        let app = TaskStore {
            probe: |pid| {
                if pid == u32::MAX - 5 {
                    ProcessProbe::Running { started: Some(31) }
                } else {
                    ProcessProbe::Gone
                }
            },
            ..app
        };

        assert_eq!(app.request_reclaim().unwrap(), 3);

        let marked = app.require(&held.id).unwrap();
        assert!(marked.reclaim_requested);
        assert_eq!(
            (marked.status, marked.owner),
            (ResearchTaskStatus::Running, OwnerKind::Daemon)
        );
        let taken = app.require(&abandoned.id).unwrap();
        assert_eq!(
            (taken.status, taken.owner),
            (ResearchTaskStatus::Queued, OwnerKind::App)
        );
        assert_eq!(
            app.handoff_record(&abandoned.id).unwrap().unwrap().reason,
            HandoffReason::Recovered
        );
        let waiting = app.require(&ids[2]).unwrap();
        assert_eq!(
            (waiting.status, waiting.owner),
            (ResearchTaskStatus::Queued, OwnerKind::App)
        );
        let live_helper = TaskStore {
            probe: |_| ProcessProbe::Gone,
            ..live_helper
        };
        assert_eq!(
            live_helper.foreign_requests().unwrap().reclaim,
            vec![(held.id.clone(), held.execution_generation)]
        );
        // Quitting again cancels the request: the helper keeps its task.
        assert_eq!(app.cancel_reclaim_requests().unwrap(), 1);
        assert!(!app.require(&held.id).unwrap().reclaim_requested);
    }

    #[test]
    fn interrupted_keep_running_tasks_re_queue_instead_of_failing() {
        let (temp, app) = store();
        let keep = claimed_keep_running(&temp, &app, "Keep going");
        let plain = claimed(&app, "plain");
        let later = TaskStore {
            owner: OTHER_PROCESS,
            probe: |_| ProcessProbe::Gone,
            ..app.clone()
        };
        assert_eq!(
            later.requeue_interrupted_keep_running().unwrap(),
            vec![keep.id.clone()]
        );
        later.recover_interrupted().unwrap();
        assert_eq!(
            later.require(&keep.id).unwrap().status,
            ResearchTaskStatus::Queued
        );
        assert_eq!(
            later.require(&plain.id).unwrap().status,
            ResearchTaskStatus::Failed
        );
        let resumed = later.claim_next().unwrap().unwrap();
        assert_eq!(resumed.id, keep.id);
        assert_eq!(resumed.resumed_from, Some(keep.execution_generation));
        let record = later.handoff_record(&keep.id).unwrap().unwrap();
        assert_eq!(
            (record.reason, record.turn_interrupted),
            (HandoffReason::Recovered, true)
        );
    }

    #[test]
    fn the_running_process_never_requeues_its_own_tasks() {
        let (temp, app) = store();
        let keep = claimed_keep_running(&temp, &app, "Mine");
        assert!(app.requeue_interrupted_keep_running().unwrap().is_empty());
        assert_eq!(
            app.require(&keep.id).unwrap().status,
            ResearchTaskStatus::Running
        );
    }

    #[test]
    fn recovery_leaves_keep_running_rows_and_other_owners_alone() {
        let (temp, app) = store();
        let handed = keep_running(&app, "Helper's");
        app.hand_off_queued(&handed.id, OwnerKind::Daemon, &record(HandoffReason::Quit))
            .unwrap();
        let helper = helper_as(&app, DEAD_HELPER);
        let helper_row = helper.claim_next().unwrap().unwrap();
        let keep = claimed_keep_running(&temp, &app, "App keep-running");
        let plain = claimed(&app, "Plain");
        let later = TaskStore {
            owner: OTHER_PROCESS,
            probe: |_| ProcessProbe::Gone,
            ..app.clone()
        };
        later.recover_interrupted().unwrap();
        assert_eq!(
            later.require(&helper_row.id).unwrap().status,
            ResearchTaskStatus::Running
        );
        assert_eq!(
            later.require(&keep.id).unwrap().status,
            ResearchTaskStatus::Running
        );
        assert_eq!(
            later.require(&plain.id).unwrap().status,
            ResearchTaskStatus::Failed
        );
    }

    #[test]
    fn recovered_handoffs_carry_no_conversation_but_keep_the_agent_home() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Agent task");
        let home = temp.path().join("acp-home-1");
        std::fs::create_dir_all(&home).unwrap();
        let mut first = record(HandoffReason::Quit);
        first.conversation = Some("1-conversation.json".into());
        first.acp = Some(AcpHandoff {
            agent_session_id: "agent-session-1".into(),
            home: home.clone(),
        });
        first.grant = Some(crate::handoff::TaskGrant {
            project_root: "/home/ada/paper".into(),
            ..Default::default()
        });
        assert!(app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &first
            )
            .unwrap());
        let helper = helper_as(&app, DEAD_HELPER);
        let claimed = helper.claim_next().unwrap().unwrap();
        assert!(helper
            .set_native_session(&claimed.id, claimed.execution_generation, "agent-session-2")
            .unwrap());
        // The helper crashes; the app opens.
        let app = TaskStore {
            probe: |_| ProcessProbe::Gone,
            ..app
        };
        assert_eq!(
            app.adopt_orphaned_daemon_tasks().unwrap(),
            vec![running.id.clone()]
        );
        let recovered = app.handoff_record(&running.id).unwrap().unwrap();
        assert_eq!(recovered.reason, HandoffReason::Recovered);
        assert!(recovered.conversation.is_none() && recovered.turn_interrupted);
        assert_eq!(
            recovered.acp,
            Some(AcpHandoff {
                agent_session_id: "agent-session-2".into(),
                home,
            })
        );
        assert_eq!(recovered.grant.unwrap().project_root, "/home/ada/paper");
        assert_eq!(app.require(&running.id).unwrap().owner, OwnerKind::App);
    }

    #[test]
    fn finishing_and_retrying_give_the_task_back_to_the_app() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Back to the app");
        app.hand_off_with(
            &running.id,
            running.execution_generation,
            OwnerKind::Daemon,
            &record(HandoffReason::Quit),
        )
        .unwrap();
        let helper =
            TaskStore::with_owner_kind(app.root().to_path_buf(), OwnerKind::Daemon).unwrap();
        let claimed = helper.claim_next().unwrap().unwrap();
        assert!(helper
            .finish_failure(&claimed.id, claimed.execution_generation, "boom")
            .unwrap());
        let failed = app.require(&claimed.id).unwrap();
        assert_eq!(failed.owner, OwnerKind::App);
        assert!(app.handoff_record(&claimed.id).unwrap().is_none());
        let retried = app.retry_with(&claimed.id, RetryMode::Resume).unwrap();
        assert_eq!(retried.owner, OwnerKind::App);

        let other = claimed_keep_running(&temp, &app, "Reviewed");
        app.hand_off_with(
            &other.id,
            other.execution_generation,
            OwnerKind::Daemon,
            &record(HandoffReason::Quit),
        )
        .unwrap();
        let claimed = helper.claim_next().unwrap().unwrap();
        assert!(helper
            .finish_success(&claimed.id, claimed.execution_generation, &result())
            .unwrap());
        assert_eq!(app.require(&claimed.id).unwrap().owner, OwnerKind::App);
    }

    #[test]
    fn foreign_requests_list_only_my_running_tasks() {
        let (temp, app) = store();
        let mine = claimed_keep_running(&temp, &app, "Mine");
        let theirs = claimed(&app, "Theirs");
        app.set_owner(&theirs.id, Some(FOREIGN)).unwrap();
        app.request_cancel(&mine.id).unwrap();
        app.request_cancel(&theirs.id).unwrap();
        let requests = app.foreign_requests().unwrap();
        assert_eq!(requests.cancel, vec![mine.id.clone()]);
        assert!(requests.reclaim.is_empty());
    }

    #[test]
    fn set_keep_running_works_while_running_and_refuses_finished_tasks() {
        let (_temp, app) = store();
        let running = claimed(&app, "Toggle");
        assert!(
            app.set_keep_running(&running.id, true)
                .unwrap()
                .keep_running_after_quit
        );
        assert!(
            !app.set_keep_running(&running.id, false)
                .unwrap()
                .keep_running_after_quit
        );
        app.finish_failure(&running.id, running.execution_generation, "done")
            .unwrap();
        assert!(app.set_keep_running(&running.id, true).is_err());
    }

    #[test]
    fn changed_since_pages_by_update_time() {
        let (_temp, app) = store();
        let first = app.create(draft("paper", "First")).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        let second = app.create(draft("paper", "Second")).unwrap();
        let page = app.changed_since(0, 1).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, first.id);
        let rest: Vec<String> = app
            .changed_since(page[0].updated_at, 10)
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert_eq!(rest, vec![second.id]);
    }

    #[test]
    fn queued_handoffs_keep_an_earlier_conversation() {
        let (temp, app) = store();
        let running = claimed_keep_running(&temp, &app, "Twice");
        let mut first =
            HandoffRecord::new(OwnerKind::Daemon, OwnerKind::App, HandoffReason::Restart, 0);
        first.conversation = Some(format!(
            "{}-conversation.json",
            running.execution_generation
        ));
        assert!(app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::App,
                &first
            )
            .unwrap());
        // The app quits again before the task starts.
        assert!(app
            .hand_off_queued(&running.id, OwnerKind::Daemon, &record(HandoffReason::Quit))
            .unwrap());
        let merged = app.handoff_record(&running.id).unwrap().unwrap();
        assert_eq!(
            (merged.reason, merged.to),
            (HandoffReason::Quit, OwnerKind::Daemon)
        );
        assert_eq!(merged.conversation, first.conversation);
    }

    #[test]
    fn owned_work_counts_what_this_helper_can_run() {
        let (_temp, app) = store();
        let helper =
            TaskStore::with_owner_kind(app.root().to_path_buf(), OwnerKind::Daemon).unwrap();
        assert!(helper.owned_work().unwrap().is_empty());
        let task = keep_running(&app, "For the helper");
        assert!(app
            .hand_off_queued(&task.id, OwnerKind::Daemon, &record(HandoffReason::Quit))
            .unwrap());
        assert_eq!(
            helper.owned_work().unwrap(),
            OwnedWork {
                running: 0,
                queued: 1
            }
        );
        helper.claim_next().unwrap().unwrap();
        assert_eq!(
            helper.owned_work().unwrap(),
            OwnedWork {
                running: 1,
                queued: 0
            }
        );
        assert!(app.has_daemon_work().unwrap());
        assert_eq!(app.daemon_tasks().unwrap().len(), 1);
    }

    #[test]
    fn a_row_another_live_process_runs_is_reported_as_such() {
        let (_temp, app) = store();
        let running = claimed(&app, "Elsewhere");
        assert!(!app.owned_by_other_live_process(&running.id).unwrap());
        app.set_owner(&running.id, Some(FOREIGN)).unwrap();
        let live = TaskStore {
            probe: |_| ProcessProbe::Running { started: Some(11) },
            ..app.clone()
        };
        assert!(live.owned_by_other_live_process(&running.id).unwrap());
        let gone = TaskStore {
            probe: |_| ProcessProbe::Gone,
            ..app
        };
        assert!(!gone.owned_by_other_live_process(&running.id).unwrap());
    }
}

// 0.4.8 E: schema setup once per root, resumes, and the approval and run rows.

#[test]
fn schema_initialization_runs_once_per_root() {
    let before = SCHEMA_INITIALIZATIONS.with(std::cell::Cell::get);
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("tasks");
    for _ in 0..50 {
        TaskStore::new(root.clone()).unwrap().list("paper").unwrap();
    }
    assert_eq!(
        SCHEMA_INITIALIZATIONS.with(std::cell::Cell::get) - before,
        1
    );
    TaskStore::new(temp.path().join("other-tasks")).unwrap();
    assert_eq!(
        SCHEMA_INITIALIZATIONS.with(std::cell::Cell::get) - before,
        2
    );
}

#[test]
fn resume_needs_a_saved_workspace() {
    let (_temp, store) = store();
    let running = claimed(&store, "Never isolated");
    store
        .finish_failure(&running.id, running.execution_generation, "stopped")
        .unwrap();
    assert_eq!(
        store
            .retry_with(&running.id, RetryMode::Resume)
            .unwrap_err(),
        "This task has no saved workspace. Start over instead."
    );
    assert_eq!(
        store.require(&running.id).unwrap().status,
        ResearchTaskStatus::Failed
    );
    let fresh = store.retry_with(&running.id, RetryMode::Fresh).unwrap();
    assert_eq!(
        fresh.pending_start,
        Some(PendingStart::Fresh { carry_from: None })
    );
}

mod approval_rows {
    use super::*;
    use crate::model::{ApprovalKind, ApprovalRecord, ApprovalStatus};
    use crate::store::approvals::NO_LONGER_WAITING;

    fn ask(store: &TaskStore, task: &ResearchTask, expires_at: i64) -> ApprovalRecord {
        store
            .insert_approval(
                &task.id,
                task.execution_generation,
                ApprovalKind::Command,
                "Run the tests",
                "pytest -q",
                expires_at,
            )
            .unwrap()
    }

    #[test]
    fn only_the_running_generation_of_a_task_can_ask() {
        let (_temp, store) = store();
        let waiting = store.create(draft("paper", "Not started")).unwrap();
        assert_eq!(
            store
                .insert_approval(
                    &waiting.id,
                    0,
                    ApprovalKind::Command,
                    "Run",
                    "ls",
                    now_ms() + 60_000
                )
                .unwrap_err(),
            "The task stopped before it could ask."
        );
        let running = claimed(&store, "Running");
        assert!(store
            .insert_approval(
                &running.id,
                running.execution_generation + 1,
                ApprovalKind::Command,
                "Run",
                "ls",
                now_ms() + 60_000
            )
            .is_err());
        let asked = store
            .insert_approval(
                &running.id,
                running.execution_generation,
                ApprovalKind::Mcp,
                "Use search",
                "{\"query\":\"dropout\"}",
                now_ms() + 60_000,
            )
            .unwrap();
        assert_eq!(
            (asked.kind, asked.status, asked.decided_at),
            (ApprovalKind::Mcp, ApprovalStatus::Pending, None)
        );
        assert_eq!(asked.detail, "{\"query\":\"dropout\"}");
        assert_eq!(store.approval(&asked.id).unwrap(), asked);
        assert_eq!(
            store.approval("approval-missing").unwrap_err(),
            "This approval request was not found."
        );
    }

    #[test]
    fn a_decision_for_an_earlier_generation_is_refused() {
        let (_temp, store) = store();
        let first = claimed(&store, "Asks twice");
        let old = ask(&store, &first, now_ms() + 60_000);
        store
            .finish_failure(&first.id, first.execution_generation, "stopped")
            .unwrap();
        // Nobody can answer for a task that stopped.
        assert_eq!(
            store.decide_approval(&old.id, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        store.retry_with(&first.id, RetryMode::Fresh).unwrap();
        store.request_start(&first.id).unwrap();
        let second = store.claim_next().unwrap().unwrap();
        // The task runs again, as a newer generation: still refused.
        assert_eq!(
            store.decide_approval(&old.id, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        let current = ask(&store, &second, now_ms() + 60_000);
        let denied = store.decide_approval(&current.id, false).unwrap();
        assert_eq!(denied.status, ApprovalStatus::Denied);
        assert!(denied.decided_at.is_some());
    }

    #[test]
    fn withdrawing_and_expiring_touch_only_waiting_requests() {
        let (_temp, store) = store();
        let running = claimed(&store, "Waits");
        let approved = ask(&store, &running, now_ms() + 60_000);
        store.decide_approval(&approved.id, true).unwrap();
        let waiting = ask(&store, &running, now_ms() + 60_000);
        let overdue = ask(&store, &running, now_ms() - 1);

        assert_eq!(
            store.expire_approval(&waiting.id).unwrap().status,
            ApprovalStatus::Pending,
            "a request with time left does not expire"
        );
        let expired = store.expire_approval(&overdue.id).unwrap();
        assert_eq!(expired.status, ApprovalStatus::Expired);
        assert!(expired.decided_at.is_some());
        assert_eq!(
            store
                .withdraw_approvals(&running.id, running.execution_generation + 1)
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .withdraw_approvals(&running.id, running.execution_generation)
                .unwrap(),
            1
        );
        assert_eq!(
            store.approval(&waiting.id).unwrap().status,
            ApprovalStatus::Withdrawn
        );
        assert_eq!(
            store.approval(&approved.id).unwrap().status,
            ApprovalStatus::Approved
        );
        assert_eq!(
            store.approval(&overdue.id).unwrap().status,
            ApprovalStatus::Expired
        );
        assert_eq!(store.require(&running.id).unwrap().pending_approvals, 0);
    }
}

mod run_rows {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::{ApprovalKind, RunRecord, RunState};

    fn run(task: &ResearchTask, run_id: &str, state: RunState, started_at: i64) -> RunRecord {
        RunRecord {
            task_id: task.id.clone(),
            run_id: run_id.into(),
            execution_generation: task.execution_generation,
            name: format!("run {run_id}"),
            executor: "local".into(),
            command: "python train.py".into(),
            cwd_rel: String::new(),
            state,
            exit_code: None,
            started_at,
            finished_at: None,
            run_dir: format!("/runs/{run_id}"),
            metrics: BTreeMap::new(),
            reported: false,
        }
    }

    fn ids(runs: &[RunRecord]) -> Vec<&str> {
        runs.iter().map(|run| run.run_id.as_str()).collect()
    }

    #[test]
    fn the_runs_table_follows_a_run_from_start_to_report() {
        let (_temp, store) = store();
        let task = claimed(&store, "Train");
        store
            .insert_run(&run(&task, "r002", RunState::Running, 20))
            .unwrap();
        store
            .insert_run(&run(&task, "r001", RunState::Starting, 10))
            .unwrap();
        assert_eq!(store.run_count(&task.id).unwrap(), 2);
        assert_eq!(ids(&store.runs(&task.id).unwrap()), ["r001", "r002"]);
        assert_eq!(store.run_handle(&task.id, "r001").unwrap(), None);
        store
            .set_run_handle(&task.id, "r001", "{\"executor\":\"local\"}")
            .unwrap();
        assert_eq!(
            store.run(&task.id, "r001").unwrap().state,
            RunState::Running
        );
        assert_eq!(
            store.run_handle(&task.id, "r001").unwrap().as_deref(),
            Some("{\"executor\":\"local\"}")
        );
        assert_eq!(store.live_runs().unwrap().len(), 2);

        let metrics = BTreeMap::from([("loss".to_owned(), 0.25)]);
        assert!(store
            .finish_run(&task.id, "r001", RunState::Succeeded, Some(0), 30, &metrics)
            .unwrap());
        assert!(
            !store
                .finish_run(
                    &task.id,
                    "r001",
                    RunState::Failed,
                    Some(1),
                    40,
                    &BTreeMap::new()
                )
                .unwrap(),
            "a finished run keeps its first outcome"
        );
        let finished = store.run(&task.id, "r001").unwrap();
        assert_eq!(
            (finished.state, finished.exit_code, finished.finished_at),
            (RunState::Succeeded, Some(0), Some(30))
        );
        assert_eq!(finished.metrics, metrics);
        let live: Vec<String> = store
            .live_runs()
            .unwrap()
            .into_iter()
            .map(|(run, _)| run.run_id)
            .collect();
        assert_eq!(live, ["r002"]);
        assert_eq!(ids(&store.unreported_runs(&task.id).unwrap()), ["r001"]);
        store
            .mark_runs_reported(&task.id, &["r001".to_owned()])
            .unwrap();
        assert!(store.unreported_runs(&task.id).unwrap().is_empty());
        assert!(store.lose_run(&task.id, "r002").unwrap());
        assert_eq!(store.run(&task.id, "r002").unwrap().state, RunState::Lost);
        assert!(!store.lose_run(&task.id, "r002").unwrap());
        assert_eq!(
            store.run(&task.id, "r009").unwrap_err(),
            "No run r009 in this task."
        );
    }

    #[test]
    fn deleting_a_task_removes_its_runs_and_approval_requests() {
        let (_temp, store) = store();
        let task = claimed(&store, "Short-lived");
        store
            .insert_run(&run(&task, "r001", RunState::Running, 10))
            .unwrap();
        let request = store
            .insert_approval(
                &task.id,
                task.execution_generation,
                ApprovalKind::Run,
                "Start run train",
                "train\npython train.py",
                now_ms() + 60_000,
            )
            .unwrap();
        store
            .finish_failure(&task.id, task.execution_generation, "stopped")
            .unwrap();
        store.delete(&task.id).unwrap();
        assert!(store.runs(&task.id).unwrap().is_empty());
        assert_eq!(
            store.approval(&request.id).unwrap_err(),
            "This approval request was not found."
        );
    }
}
