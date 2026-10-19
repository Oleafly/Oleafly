//! The research task store: one SQLite file under the research-tasks root.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::de::DeserializeOwned;

// 0.4.8 L: handoffs between the app and the background helper.
use crate::handoff::{
    AcpHandoff, ForeignRequests, HandoffReason, HandoffRecord, OwnedWork, HANDOFF_VERSION,
};
use crate::host::{AttentionSummary, OwnerKind};
use crate::model::{
    now_ms, DependencyResult, EvidenceReport, PendingStart, ResearchBrief, ResearchTask,
    ResearchTaskDraft, ResearchTaskEdit, ResearchTaskStatus, ResumeReason, RetryMode, StopReason,
    TaskIsolation, TaskPhase, TaskResultMetadata, TaskReviewResult, TaskRuntimeEvent,
    TaskTranscriptEvent, TaskTranscriptPage, TodoItem,
};
use oleafly_sandbox::process::identity::{ProcessIdentity, ProcessProbe};

pub mod approvals;
pub mod runs;

const MAX_TASKS_PER_PROJECT: usize = 500;
pub const MAX_EVENTS_PER_RUN: u64 = 5_000;
const TEXT_EVENT_KINDS: [&str; 2] = ["text", "reasoning"];

#[derive(Clone)]
pub struct TaskStore {
    root: PathBuf,
    owner: ProcessIdentity,
    probe: fn(u32) -> ProcessProbe,
    /// Which kind of process claims queued work through this store.
    owner_kind: OwnerKind,
}

/// A running task's id and the process that owns it (pid, start time).
type OwnerRow = (String, Option<i64>, Option<i64>);

/// The task columns every read selects, in `read_stored_task` order.
const TASK_COLUMNS: &str = "id, project_id, title, prompt, runtime_id, agent_id, model_id,
    skill_ids_json, status, execution_generation, session_id,
    native_session_id, source_revision, isolation_json, error,
    result_json, review_json, start_requested, cancel_requested, created_at, updated_at,
    started_at, finished_at, brief_json, record_slug, run_after, keep_running_after_quit,
    owner_kind, phase, plan_approved, pending_start_json, evidence_json, todos_json,
    stop_reason, active_ms,
    (SELECT COUNT(*) FROM research_task_approvals approval
     WHERE approval.task_id = research_tasks.id AND approval.status = 'pending'
       AND research_tasks.status = 'running'
       AND approval.execution_generation = research_tasks.execution_generation),
    reclaim_requested, resumed_from";

/// One transcript row for [`TaskStore::write_events`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventWrite {
    pub task_id: String,
    pub generation: u64,
    pub sequence: u64,
    pub event_json: String,
    pub created_at: i64,
    /// Update an existing row (a growing text segment) instead of adding one.
    pub replace: bool,
}

#[derive(Debug, Clone)]
pub struct PendingApply {
    pub task_id: String,
    pub project_id: String,
    pub selected_paths: Vec<String>,
}

struct StoredTask {
    id: String,
    project_id: String,
    title: String,
    prompt: String,
    runtime_id: String,
    agent_id: String,
    model_id: String,
    skill_ids_json: String,
    status: String,
    execution_generation: i64,
    session_id: Option<String>,
    native_session_id: Option<String>,
    source_revision: Option<String>,
    isolation_json: Option<String>,
    error: Option<String>,
    result_json: Option<String>,
    review_json: Option<String>,
    start_requested: bool,
    cancel_requested: bool,
    created_at: i64,
    updated_at: i64,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    brief_json: Option<String>,
    record_slug: String,
    run_after: Option<i64>,
    keep_running_after_quit: bool,
    owner_kind: String,
    phase: Option<String>,
    plan_approved: bool,
    pending_start_json: Option<String>,
    evidence_json: Option<String>,
    todos_json: Option<String>,
    stop_reason: Option<String>,
    active_ms: i64,
    pending_approvals: i64,
    // 0.4.8 L
    reclaim_requested: bool,
    resumed_from: Option<i64>,
}

impl TaskStore {
    /// The app's store: it claims tasks the app runs.
    pub fn new(root: PathBuf) -> Result<Self, String> {
        Self::with_owner_kind(root, OwnerKind::App)
    }

    /// A store that claims only tasks owned by `owner` (the app or the daemon).
    pub fn with_owner_kind(root: PathBuf, owner: OwnerKind) -> Result<Self, String> {
        ensure_real_directory(&root)?;
        let store = Self {
            root,
            owner: oleafly_sandbox::process::identity::current(),
            probe: oleafly_sandbox::process::identity::probe,
            owner_kind: owner,
        };
        store.open()?;
        Ok(store)
    }

    pub fn owner_kind(&self) -> OwnerKind {
        self.owner_kind
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_owner(&self, id: &str, owner: Option<ProcessIdentity>) -> Result<(), String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET owner_pid = ?2, owner_started = ?3 WHERE id = ?1",
                params![
                    id,
                    owner.map(|owner| i64::from(owner.pid)),
                    owner.and_then(owner_started_column)
                ],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn text_event_count(&self, id: &str, generation: u64) -> Result<i64, String> {
        let connection = self.open()?;
        let kinds = encode_json(&TEXT_EVENT_KINDS)?;
        connection
            .query_row(
                "SELECT COUNT(*) FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2
                   AND json_extract(event_json, '$.kind') IN (SELECT value FROM json_each(?3))",
                params![id, generation as i64, kinds],
                |row| row.get(0),
            )
            .map_err(store_error)
    }

    fn open(&self) -> Result<Connection, String> {
        ensure_real_directory(&self.root)?;
        let database = self.root.join("tasks.sqlite3");
        reject_symlink(&database)?;
        let mut connection = Connection::open(&database)
            .map_err(|error| format!("could not open the research task store: {error}"))?;
        reject_symlink(&database)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("could not configure the research task store: {error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| format!("could not configure the research task store: {error}"))?;
        // Creating and migrating the schema runs only for a new or older store.
        if schema_version(&connection)? < SCHEMA_VERSION {
            initialize_schema(&mut connection)?;
        }
        Ok(connection)
    }

    pub fn create(&self, draft: ResearchTaskDraft) -> Result<ResearchTask, String> {
        validate_draft(
            &draft.title,
            &draft.prompt,
            &draft.runtime_id,
            &draft.agent_id,
            &draft.model_id,
            &draft.skill_ids,
        )?;
        let brief = draft.brief.unwrap_or_default();
        validate_brief(&brief)?;
        let now = now_ms();
        validate_run_after(draft.run_after, now)?;
        validate_desktop_apps(
            brief.permissions.desktop_apps,
            draft.keep_running_after_quit,
            draft.run_after,
        )?;
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        validate_dependencies(&transaction, &draft.project_id, None, &draft.dependency_ids)?;
        let id = fresh_id("task");
        let skills = encode_json(&dedupe(draft.skill_ids))?;
        let slug = crate::record::record_slug(draft.title.trim(), &id);
        transaction
            .execute(
                "INSERT INTO research_tasks (
                   id, project_id, title, prompt, runtime_id, agent_id, model_id,
                   skill_ids_json, status, created_at, updated_at,
                   brief_json, record_slug, run_after, keep_running_after_quit
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    draft.project_id,
                    draft.title.trim(),
                    draft.prompt.trim(),
                    draft.runtime_id.trim(),
                    draft.agent_id.trim(),
                    draft.model_id.trim(),
                    skills,
                    now,
                    encode_json(&brief)?,
                    slug,
                    draft.run_after,
                    draft.keep_running_after_quit
                ],
            )
            .map_err(store_error)?;
        replace_dependencies(&transaction, &id, &dedupe(draft.dependency_ids))?;
        transaction.commit().map_err(store_error)?;
        self.require(&id)
    }

    pub fn edit(&self, id: &str, edit: ResearchTaskEdit) -> Result<ResearchTask, String> {
        validate_draft(
            &edit.title,
            &edit.prompt,
            &edit.runtime_id,
            &edit.agent_id,
            &edit.model_id,
            &edit.skill_ids,
        )?;
        if let Some(brief) = &edit.brief {
            validate_brief(brief)?;
        }
        validate_run_after(edit.run_after, now_ms())?;
        let desktop_apps = match &edit.brief {
            Some(brief) => brief.permissions.desktop_apps,
            None => self
                .require(id)
                .is_ok_and(|task| task.brief.permissions.desktop_apps),
        };
        validate_desktop_apps(desktop_apps, edit.keep_running_after_quit, edit.run_after)?;
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let project_id: String = transaction
            .query_row(
                "SELECT project_id FROM research_tasks WHERE id = ?1 AND status = 'queued'",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| "Only queued tasks can be edited.".to_string())?;
        validate_dependencies(&transaction, &project_id, Some(id), &edit.dependency_ids)?;
        let brief_json = edit.brief.as_ref().map(encode_json).transpose()?;
        let updated = transaction
            .execute(
                "UPDATE research_tasks SET
                   title = ?2, prompt = ?3, runtime_id = ?4, agent_id = ?5,
                   model_id = ?6, skill_ids_json = ?7, updated_at = ?8,
                   brief_json = COALESCE(?9, brief_json), run_after = ?10,
                   keep_running_after_quit = ?11
                 WHERE id = ?1 AND status = 'queued'",
                params![
                    id,
                    edit.title.trim(),
                    edit.prompt.trim(),
                    edit.runtime_id.trim(),
                    edit.agent_id.trim(),
                    edit.model_id.trim(),
                    encode_json(&dedupe(edit.skill_ids))?,
                    now_ms(),
                    brief_json,
                    edit.run_after,
                    edit.keep_running_after_quit
                ],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("The task changed before it could be edited.".into());
        }
        replace_dependencies(&transaction, id, &dedupe(edit.dependency_ids))?;
        transaction.commit().map_err(store_error)?;
        self.require(id)
    }

    pub fn list(&self, project_id: &str) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {TASK_COLUMNS} FROM research_tasks WHERE project_id = ?1
                     ORDER BY created_at DESC LIMIT ?2"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map(
                params![project_id, MAX_TASKS_PER_PROJECT as i64],
                read_stored_task,
            )
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error)?;
        drop(statement);
        rows.into_iter()
            .map(|row| materialize_task(&connection, row))
            .collect()
    }

    pub fn require(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let stored = connection
            .query_row(
                &format!("SELECT {TASK_COLUMNS} FROM research_tasks WHERE id = ?1"),
                [id],
                read_stored_task,
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| "Research task not found.".to_string())?;
        materialize_task(&connection, stored)
    }

    pub fn request_start(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let stopped: Option<String> = connection
            .query_row(
                "SELECT required.title FROM research_task_dependencies dependency
                 JOIN research_tasks required ON required.id = dependency.dependency_id
                 WHERE dependency.task_id = ?1 AND required.status IN ('failed', 'cancelled')
                 ORDER BY required.created_at ASC LIMIT 1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        if let Some(title) = stopped {
            return Err(format!("Retry \"{title}\" first. This task depends on it."));
        }
        let updated = connection
            .execute(
                "UPDATE research_tasks SET start_requested = 1, updated_at = ?2
                 WHERE id = ?1 AND status = 'queued'",
                params![id, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("Only a queued task can be started.".into());
        }
        self.require(id)
    }

    /// Claims the oldest started task this store's owner kind runs, whose
    /// dependencies are complete and whose start time has come.
    pub fn claim_next(&self) -> Result<Option<ResearchTask>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let now = now_ms();
        let claimed: Option<(String, Option<String>)> = transaction
            .query_row(
                "SELECT task.id, task.pending_start_json
                 FROM research_tasks task
                 WHERE task.status = 'queued' AND task.start_requested = 1
                   AND task.owner_kind = ?1
                   AND (task.run_after IS NULL OR task.run_after <= ?2)
                   AND NOT EXISTS (
                     SELECT 1 FROM research_task_dependencies dependency
                     JOIN research_tasks required ON required.id = dependency.dependency_id
                     WHERE dependency.task_id = task.id AND required.status <> 'completed'
                   )
                 -- 0.4.8 L: work that resumes (a handoff, a retry) takes free
                 -- slots before tasks that have not started yet.
                 ORDER BY (task.pending_start_json IS NOT NULL
                           AND json_extract(task.pending_start_json, '$.mode') = 'resume') DESC,
                          task.created_at ASC LIMIT 1",
                params![owner_kind_column(self.owner_kind), now],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(store_error)?;
        let Some((id, pending_start)) = claimed else {
            transaction.commit().map_err(store_error)?;
            return Ok(None);
        };
        let pending: Option<PendingStart> = decode_optional(pending_start, "task pending start")?;
        // A resumed generation keeps the saved workspace. The pending start
        // stays until the run reads it (`clear_pending_start`).
        let (isolation_json, source_revision, plan_approved) = match &pending {
            Some(PendingStart::Resume {
                isolation, reason, ..
            }) => (
                Some(encode_json(isolation)?),
                Some(isolation.source_revision.clone()),
                *reason == ResumeReason::PlanApproved,
            ),
            _ => (None, None, false),
        };
        let session_id = fresh_id("research-session");
        // 0.4.8 L: a resumed generation remembers the one it continues.
        let resumed = matches!(pending, Some(PendingStart::Resume { .. }));
        let updated = transaction
            .execute(
                "UPDATE research_tasks SET
                   status = 'running', execution_generation = execution_generation + 1,
                   session_id = ?2, native_session_id = NULL, start_requested = 0,
                   cancel_requested = 0,
                   source_revision = ?6, isolation_json = ?7, error = NULL,
                   result_json = NULL, review_json = NULL,
                   apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL, started_at = ?3,
                   finished_at = NULL, updated_at = ?3, owner_pid = ?4, owner_started = ?5,
                   phase = 'preparing', stop_reason = NULL, evidence_json = NULL,
                   plan_approved = CASE WHEN ?8 THEN 1 ELSE plan_approved END,
                   resumed_from = CASE WHEN ?9 THEN execution_generation ELSE NULL END,
                   reclaim_requested = 0
                 WHERE id = ?1 AND status = 'queued' AND start_requested = 1",
                params![
                    id,
                    session_id,
                    now,
                    i64::from(self.owner.pid),
                    owner_started_column(self.owner),
                    source_revision,
                    isolation_json,
                    plan_approved,
                    resumed
                ],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("The task changed before it could start.".into());
        }
        transaction.commit().map_err(store_error)?;
        self.require(&id).map(Some)
    }

    pub fn set_isolation(
        &self,
        id: &str,
        generation: u64,
        isolation: &TaskIsolation,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET source_revision = ?3, isolation_json = ?4,
                   pending_start_json = NULL, updated_at = ?5
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![
                    id,
                    generation as i64,
                    isolation.source_revision,
                    encode_json(isolation)?,
                    now_ms()
                ],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub fn set_native_session(
        &self,
        id: &str,
        generation: u64,
        native_session_id: &str,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET native_session_id = ?3, updated_at = ?4
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, native_session_id, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub fn append_event(
        &self,
        id: &str,
        generation: u64,
        event: &TaskRuntimeEvent,
    ) -> Result<Option<TaskTranscriptEvent>, String> {
        let encoded = encode_json(event)?;
        if encoded.len() > 128 * 1024 {
            return Err("A research task event exceeded the 128 KiB limit.".into());
        }
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let current: Option<i64> = transaction
            .query_row(
                "SELECT execution_generation FROM research_tasks
                 WHERE id = ?1 AND status = 'running'",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        if current != Some(generation as i64) {
            transaction.commit().map_err(store_error)?;
            return Ok(None);
        }
        let sequence: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2",
                params![id, generation as i64],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        let created_at = now_ms();
        transaction
            .execute(
                "INSERT INTO research_task_events (
                   task_id, execution_generation, sequence, event_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, generation as i64, sequence, encoded, created_at],
            )
            .map_err(store_error)?;
        prune_text_events(&transaction, id, generation, sequence)?;
        transaction.commit().map_err(store_error)?;
        Ok(Some(TaskTranscriptEvent {
            task_id: id.to_string(),
            execution_generation: generation,
            sequence: sequence as u64,
            event: event.clone(),
            created_at,
        }))
    }

    pub fn replace_event(
        &self,
        id: &str,
        generation: u64,
        sequence: u64,
        event: &TaskRuntimeEvent,
    ) -> Result<Option<TaskTranscriptEvent>, String> {
        let encoded = encode_json(event)?;
        if encoded.len() > 128 * 1024 {
            return Err("A research task event exceeded the 128 KiB limit.".into());
        }
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let current: Option<i64> = transaction
            .query_row(
                "SELECT execution_generation FROM research_tasks
                 WHERE id = ?1 AND status = 'running'",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        if current != Some(generation as i64) {
            transaction.commit().map_err(store_error)?;
            return Ok(None);
        }
        let created_at: Option<i64> = transaction
            .query_row(
                "SELECT created_at FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2 AND sequence = ?3",
                params![id, generation as i64, sequence as i64],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        let Some(created_at) = created_at else {
            transaction.commit().map_err(store_error)?;
            return Ok(None);
        };
        transaction
            .execute(
                "UPDATE research_task_events SET event_json = ?4
                 WHERE task_id = ?1 AND execution_generation = ?2 AND sequence = ?3",
                params![id, generation as i64, sequence as i64, encoded],
            )
            .map_err(store_error)?;
        transaction.commit().map_err(store_error)?;
        Ok(Some(TaskTranscriptEvent {
            task_id: id.to_string(),
            execution_generation: generation,
            sequence,
            event: event.clone(),
            created_at,
        }))
    }

    /// The next free transcript sequence of a generation.
    pub fn next_event_sequence(&self, id: &str, generation: u64) -> Result<u64, String> {
        self.open()?
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2",
                params![id, generation as i64],
                |row| row.get::<_, i64>(0),
            )
            .map(|sequence| sequence.max(1) as u64)
            .map_err(store_error)
    }

    /// Writes a batch of transcript rows in one transaction. Rows of a
    /// generation that stopped running are dropped (the running fence).
    pub fn write_events(&self, writes: &[EventWrite]) -> Result<(), String> {
        if writes.is_empty() {
            return Ok(());
        }
        let mut connection = self.open()?;
        Self::write_events_on(&mut connection, writes)
    }

    /// A connection a transcript writer keeps open between its batches.
    pub(crate) fn writer_connection(&self) -> Result<Connection, String> {
        self.open()
    }

    /// [`TaskStore::write_events`] on a connection the caller keeps open.
    pub(crate) fn write_events_on(
        connection: &mut Connection,
        writes: &[EventWrite],
    ) -> Result<(), String> {
        if writes.is_empty() {
            return Ok(());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let mut appended: HashMap<(String, u64), i64> = HashMap::new();
        for write in writes {
            if write.event_json.len() > 128 * 1024 {
                continue;
            }
            if write.replace {
                transaction
                    .execute(
                        "UPDATE research_task_events SET event_json = ?4
                         WHERE task_id = ?1 AND execution_generation = ?2 AND sequence = ?3
                           AND EXISTS (SELECT 1 FROM research_tasks
                                       WHERE id = ?1 AND status = 'running' AND execution_generation = ?2)",
                        params![write.task_id, write.generation as i64, write.sequence as i64, write.event_json],
                    )
                    .map_err(store_error)?;
            } else {
                let inserted = transaction
                    .execute(
                        "INSERT OR IGNORE INTO research_task_events (
                           task_id, execution_generation, sequence, event_json, created_at)
                         SELECT ?1, ?2, ?3, ?4, ?5
                         WHERE EXISTS (SELECT 1 FROM research_tasks
                                       WHERE id = ?1 AND status = 'running' AND execution_generation = ?2)",
                        params![
                            write.task_id,
                            write.generation as i64,
                            write.sequence as i64,
                            write.event_json,
                            write.created_at
                        ],
                    )
                    .map_err(store_error)?;
                if inserted == 1 {
                    let highest = appended
                        .entry((write.task_id.clone(), write.generation))
                        .or_insert(0);
                    *highest = (*highest).max(write.sequence as i64);
                }
            }
        }
        for ((task_id, generation), sequence) in appended {
            prune_text_events(&transaction, &task_id, generation, sequence)?;
        }
        transaction.commit().map_err(store_error)
    }

    pub fn finish_success(
        &self,
        id: &str,
        generation: u64,
        result: &TaskResultMetadata,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET status = 'awaiting_review', result_json = ?3,
                   error = NULL, cancel_requested = 0, updated_at = ?4, finished_at = ?4,
                   owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, encode_json(result)?, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub fn finish_failure(&self, id: &str, generation: u64, error: &str) -> Result<bool, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let failed = transaction
            .execute(
                "UPDATE research_tasks SET status = 'failed', error = ?3,
                   updated_at = ?4, finished_at = ?4, start_requested = 0,
                   cancel_requested = 0,
                   owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, bound_error(error), now_ms()],
            )
            .map_err(store_error)?
            == 1;
        if failed {
            fail_waiting_dependents(&transaction, id, false)?;
        }
        transaction.commit().map_err(store_error)?;
        Ok(failed)
    }

    pub fn request_cancel(&self, id: &str) -> Result<ResearchTask, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let status: Option<String> = transaction
            .query_row(
                "SELECT status FROM research_tasks WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        match status.as_deref() {
            Some("queued") => {
                transaction
                    .execute(
                        "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                           cancel_requested = 0, error = NULL, updated_at = ?2, finished_at = ?2
                         WHERE id = ?1 AND status = 'queued'",
                        params![id, now_ms()],
                    )
                    .map_err(store_error)?;
                fail_waiting_dependents(&transaction, id, true)?;
            }
            Some("plan_ready") => {
                transaction
                    .execute(
                        "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                           cancel_requested = 0, error = NULL, phase = NULL,
                           pending_start_json = NULL, updated_at = ?2, finished_at = ?2
                         WHERE id = ?1 AND status = 'plan_ready'",
                        params![id, now_ms()],
                    )
                    .map_err(store_error)?;
                fail_waiting_dependents(&transaction, id, true)?;
            }
            Some("awaiting_review") => {
                let updated = transaction
                    .execute(
                        "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                           cancel_requested = 0, updated_at = ?2, finished_at = ?2
                         WHERE id = ?1 AND status = 'awaiting_review' AND apply_state IS NULL",
                        params![id, now_ms()],
                    )
                    .map_err(store_error)?;
                if updated != 1 {
                    return Err("This task cannot be discarded while changes are being applied or recovered.".into());
                }
                fail_waiting_dependents(&transaction, id, true)?;
            }
            Some("running") => {
                transaction
                    .execute(
                        "UPDATE research_tasks SET cancel_requested = 1, updated_at = ?2
                         WHERE id = ?1 AND status = 'running'",
                        params![id, now_ms()],
                    )
                    .map_err(store_error)?;
            }
            _ => {
                return Err(
                    "You can cancel tasks that are queued, running, waiting for plan approval or awaiting review."
                        .into(),
                )
            }
        }
        transaction.commit().map_err(store_error)?;
        self.require(id)
    }

    pub fn finalize_cancel(&self, id: &str, generation: u64) -> Result<bool, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let cancelled = transaction
            .execute(
                "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                   cancel_requested = 0, error = NULL, updated_at = ?3, finished_at = ?3,
                   owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 1",
                params![id, generation as i64, now_ms()],
            )
            .map_err(store_error)?
            == 1;
        if cancelled {
            fail_waiting_dependents(&transaction, id, true)?;
        }
        transaction.commit().map_err(store_error)?;
        Ok(cancelled)
    }

    /// Every task that waits for `id`, directly or through other tasks.
    pub fn dependent_ids(&self, id: &str) -> Result<Vec<String>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "WITH RECURSIVE waiting(id) AS (
                   SELECT task_id FROM research_task_dependencies WHERE dependency_id = ?1
                   UNION
                   SELECT dependency.task_id FROM research_task_dependencies dependency
                   JOIN waiting ON dependency.dependency_id = waiting.id
                 )
                 SELECT id FROM waiting",
            )
            .map_err(store_error)?;
        let ids = statement
            .query_map([id], |row| row.get::<_, String>(0))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(store_error)?;
        Ok(ids)
    }

    /// Queues a failed or cancelled task again. Resume keeps its workspace
    /// and starts a new conversation from the record; Fresh copies the
    /// project again and carries the research record over.
    pub fn retry_with(&self, id: &str, mode: RetryMode) -> Result<ResearchTask, String> {
        let task = self.require(id)?;
        if !matches!(
            task.status,
            ResearchTaskStatus::Failed | ResearchTaskStatus::Cancelled
        ) {
            return Err("Only a failed or cancelled task can be retried.".into());
        }
        let pending = match mode {
            RetryMode::Resume => PendingStart::Resume {
                isolation: task.isolation.clone().ok_or_else(|| {
                    "This task has no saved workspace. Start over instead.".to_string()
                })?,
                reason: ResumeReason::Retry,
                previous_native_session_id: task.native_session_id.clone(),
            },
            RetryMode::Fresh => PendingStart::Fresh {
                carry_from: task
                    .isolation
                    .as_ref()
                    .map(|isolation| isolation.execution_root.clone()),
            },
        };
        let fresh = mode == RetryMode::Fresh;
        let connection = self.open()?;
        let updated = connection
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 0,
                   error = NULL, session_id = NULL, native_session_id = NULL,
                   cancel_requested = 0, phase = NULL, stop_reason = NULL,
                   updated_at = ?2, started_at = NULL, finished_at = NULL,
                   apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL, pending_start_json = ?3,
                   active_ms = CASE WHEN ?4 THEN 0 ELSE active_ms END,
                   todos_json = CASE WHEN ?4 THEN NULL ELSE todos_json END,
                   plan_approved = CASE WHEN ?4 THEN 0 ELSE plan_approved END,
                   owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL
                 WHERE id = ?1 AND status IN ('failed', 'cancelled')",
                params![id, now_ms(), encode_json(&pending)?, fresh],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("Only a failed or cancelled task can be retried.".into());
        }
        self.withdraw_all_approvals(id)?;
        self.require(id)
    }

    /// Ends a planning generation: the plan is written, the workspace kept.
    pub fn finish_plan_ready(&self, id: &str, generation: u64) -> Result<bool, String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET status = 'plan_ready', phase = NULL, error = NULL,
                   start_requested = 0, cancel_requested = 0, updated_at = ?3, finished_at = ?3,
                   owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// The user approved the plan: queue the task to continue in its workspace.
    pub fn approve_plan(&self, id: &str) -> Result<ResearchTask, String> {
        let task = self.require(id)?;
        if task.status != ResearchTaskStatus::PlanReady {
            return Err("This task is not waiting for plan approval.".into());
        }
        let isolation = task
            .isolation
            .clone()
            .ok_or_else(|| "The saved workspace is gone. Start over instead.".to_string())?;
        let pending = PendingStart::Resume {
            isolation,
            reason: ResumeReason::PlanApproved,
            previous_native_session_id: task.native_session_id.clone(),
        };
        let updated = self
            .open()?
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 1,
                   pending_start_json = ?2, updated_at = ?3, finished_at = NULL
                 WHERE id = ?1 AND status = 'plan_ready'",
                params![id, encode_json(&pending)?, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("This task is not waiting for plan approval.".into());
        }
        self.require(id)
    }

    /// Moves a running task to another owner (the daemon after the app
    /// quits): it is queued to resume in its workspace there.
    pub fn hand_off(&self, id: &str, generation: u64, to: OwnerKind) -> Result<bool, String> {
        let task = self.require(id)?;
        let Some(isolation) = task.isolation.clone() else {
            return Ok(false);
        };
        let pending = PendingStart::Resume {
            isolation,
            reason: ResumeReason::Handoff,
            previous_native_session_id: task.native_session_id.clone(),
        };
        self.open()?
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 1,
                   owner_kind = ?3, pending_start_json = ?4, phase = NULL,
                   owner_pid = NULL, owner_started = NULL, updated_at = ?5
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![
                    id,
                    generation as i64,
                    owner_kind_column(to),
                    encode_json(&pending)?,
                    now_ms()
                ],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    fn update_running(
        &self,
        id: &str,
        generation: u64,
        set: &str,
        value: &dyn rusqlite::ToSql,
    ) -> Result<bool, String> {
        self.open()?
            .execute(
                &format!(
                    "UPDATE research_tasks SET {set} = ?3, updated_at = ?4
                     WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'"
                ),
                params![id, generation as i64, value, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// The phase of a generation: while it runs, and while its evidence is
    /// checked after it finished.
    pub fn set_phase(&self, id: &str, generation: u64, phase: TaskPhase) -> Result<bool, String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET phase = ?3, updated_at = ?4
                 WHERE id = ?1 AND execution_generation = ?2
                   AND (status = 'running' OR ?3 = 'checking_evidence')
                   AND (phase IS NULL OR phase <> ?3)",
                params![id, generation as i64, phase.as_str(), now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// The start mode was read by the run that just began.
    pub fn clear_pending_start(&self, id: &str, generation: u64) -> Result<(), String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET pending_start_json = NULL
                 WHERE id = ?1 AND execution_generation = ?2",
                params![id, generation as i64],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    /// The task's record folder name, assigned now for tasks created before
    /// records existed.
    pub fn ensure_record_slug(&self, id: &str) -> Result<String, String> {
        let task = self.require(id)?;
        if !task.record_slug.is_empty() {
            return Ok(task.record_slug);
        }
        let slug = crate::record::record_slug(&task.title, &task.id);
        self.open()?
            .execute(
                "UPDATE research_tasks SET record_slug = ?2 WHERE id = ?1 AND record_slug = ''",
                params![id, slug],
            )
            .map_err(store_error)?;
        Ok(self.require(id)?.record_slug)
    }

    /// Every task in the store (for maintenance sweeps).
    pub fn all_tasks(&self) -> Result<Vec<ResearchTask>, String> {
        let projects = self
            .open()?
            .prepare("SELECT DISTINCT project_id FROM research_tasks")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        let mut tasks = Vec::new();
        for project in projects {
            tasks.extend(self.list(&project)?);
        }
        Ok(tasks)
    }

    pub fn set_active_ms(&self, id: &str, generation: u64, active_ms: u64) -> Result<bool, String> {
        self.update_running(
            id,
            generation,
            "active_ms",
            &(active_ms.min(i64::MAX as u64) as i64),
        )
    }

    pub fn set_stop_reason(
        &self,
        id: &str,
        generation: u64,
        reason: StopReason,
    ) -> Result<bool, String> {
        self.update_running(id, generation, "stop_reason", &reason.as_str())
    }

    pub fn set_todos(&self, id: &str, generation: u64, todos: &[TodoItem]) -> Result<bool, String> {
        self.update_running(id, generation, "todos_json", &encode_json(todos)?)
    }

    /// Stores the evidence report of a finished generation (any status).
    pub fn set_evidence(
        &self,
        id: &str,
        generation: u64,
        report: &EvidenceReport,
    ) -> Result<bool, String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET evidence_json = ?3, updated_at = ?4
                 WHERE id = ?1 AND execution_generation = ?2",
                params![id, generation as i64, encode_json(report)?, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// Clears the phase once a generation stopped running.
    pub fn clear_phase(&self, id: &str, generation: u64) -> Result<(), String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET phase = NULL
                 WHERE id = ?1 AND execution_generation = ?2 AND status <> 'running'",
                params![id, generation as i64],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    /// The completed tasks `id` depends on, with their summaries.
    pub fn dependency_results(&self, id: &str) -> Result<Vec<DependencyResult>, String> {
        let task = self.require(id)?;
        task.dependency_ids
            .iter()
            .map(|dependency| self.require(dependency))
            .filter_map(|dependency| match dependency {
                Ok(dependency)
                    if dependency.status == ResearchTaskStatus::Completed
                        || dependency.status == ResearchTaskStatus::AwaitingReview =>
                {
                    Some(Ok(dependency))
                }
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .map(|dependency| {
                dependency.map(|dependency| DependencyResult {
                    summary: dependency
                        .result
                        .as_ref()
                        .map(|result| result.summary.chars().take(2_000).collect())
                        .unwrap_or_default(),
                    record_dir: dependency.record_dir(),
                    task_id: dependency.id,
                    title: dependency.title,
                })
            })
            .collect()
    }

    /// The earliest future start time of a started task this store claims.
    pub fn next_run_after(&self) -> Result<Option<i64>, String> {
        self.open()?
            .query_row(
                "SELECT MIN(run_after) FROM research_tasks
                 WHERE status = 'queued' AND start_requested = 1 AND owner_kind = ?1
                   AND run_after IS NOT NULL",
                [owner_kind_column(self.owner_kind)],
                |row| row.get(0),
            )
            .map_err(store_error)
    }

    /// Per project: tasks waiting for review, for plan approval, or running
    /// with an approval request open.
    pub fn attention(&self) -> Result<AttentionSummary, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT project_id, COUNT(*) FROM research_tasks task
                 WHERE (task.status = 'awaiting_review' AND task.review_json IS NULL)
                    OR task.status = 'plan_ready'
                    OR (task.status = 'running' AND EXISTS (
                         SELECT 1 FROM research_task_approvals approval
                         WHERE approval.task_id = task.id AND approval.status = 'pending'
                           AND approval.execution_generation = task.execution_generation))
                 GROUP BY project_id",
            )
            .map_err(store_error)?;
        let by_project = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(store_error)?
            .into_iter()
            .map(|(project, count)| (project, u32::try_from(count.max(0)).unwrap_or(u32::MAX)))
            .collect();
        Ok(AttentionSummary { by_project })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let status: Option<String> = transaction
            .query_row(
                "SELECT status FROM research_tasks WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        let status = status.ok_or_else(|| "Research task not found.".to_string())?;
        if status == "running" {
            return Err("Stop this task before deleting it.".into());
        }
        let applying: Option<String> = transaction
            .query_row(
                "SELECT apply_state FROM research_tasks WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?
            .flatten();
        if applying.is_some() {
            return Err("This task is applying its result. Try again in a moment.".into());
        }
        let dependents: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM research_task_dependencies WHERE dependency_id = ?1",
                [id],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        if dependents > 0 {
            return Err("Another task waits for this one. Remove that dependency first.".into());
        }
        transaction
            .execute(
                "DELETE FROM research_task_dependencies WHERE task_id = ?1",
                [id],
            )
            .map_err(store_error)?;
        transaction
            .execute("DELETE FROM research_task_events WHERE task_id = ?1", [id])
            .map_err(store_error)?;
        transaction
            .execute("DELETE FROM research_tasks WHERE id = ?1", [id])
            .map_err(store_error)?;
        transaction.commit().map_err(store_error)
    }

    pub fn recover_interrupted(&self) -> Result<Vec<ResearchTask>, String> {
        self.recover_stopped("Oleafly closed before this run finished. Review its saved workspace or retry the task.")
    }

    pub fn recover_after_failed_update(&self) -> Result<Vec<ResearchTask>, String> {
        self.recover_stopped(
            "This run stopped to install an update. Review its saved workspace or retry the task.",
        )
    }

    pub fn disown_current(&self) -> Result<usize, String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET owner_pid = NULL, owner_started = NULL
                 WHERE owner_pid = ?1 AND (status = 'running' OR apply_state = 'applying')",
                [i64::from(self.owner.pid)],
            )
            .map_err(store_error)
    }

    fn owned_by_live_process(&self, pid: Option<i64>, started: Option<i64>) -> bool {
        oleafly_sandbox::process::identity::owner_is_live(
            owner_from_columns(pid, started),
            self.owner,
            self.probe,
        )
    }

    fn recover_stopped(&self, reason: &str) -> Result<Vec<ResearchTask>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        // 0.4.8 L: keep-running tasks and the other owner kind's tasks are
        // recovered by `requeue_interrupted_keep_running` and the handoff
        // functions instead.
        let running = transaction
            .prepare(
                "SELECT id, owner_pid, owner_started FROM research_tasks
                 WHERE status = 'running' AND owner_kind = ?1 AND keep_running_after_quit = 0",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([owner_kind_column(self.owner_kind)], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<i64>>(1)?,
                            row.get::<_, Option<i64>>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        let now = now_ms();
        for (id, owner_pid, owner_started) in running {
            if self.owned_by_live_process(owner_pid, owner_started) {
                continue;
            }
            let failed = transaction
                .execute(
                    "UPDATE research_tasks SET status = 'failed', start_requested = 0,
                       cancel_requested = 0, error = ?3,
                       updated_at = ?2, finished_at = ?2
                     WHERE id = ?1 AND status = 'running'",
                    params![id, now, reason],
                )
                .map_err(store_error)?;
            if failed == 1 {
                // Its open approval requests can no longer be answered.
                transaction
                    .execute(
                        "UPDATE research_task_approvals SET status = 'withdrawn', decided_at = ?2
                         WHERE task_id = ?1 AND status = 'pending'",
                        params![id, now],
                    )
                    .map_err(store_error)?;
                fail_waiting_dependents(&transaction, &id, false)?;
            }
        }
        transaction.commit().map_err(store_error)?;
        let project_ids = connection
            .prepare("SELECT DISTINCT project_id FROM research_tasks")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        project_ids
            .into_iter()
            .map(|project_id| self.list(&project_id))
            .collect::<Result<Vec<_>, _>>()
            .map(|groups| groups.into_iter().flatten().collect())
    }

    pub fn events(
        &self,
        id: &str,
        generation: u64,
        after_sequence: Option<u64>,
        limit: usize,
    ) -> Result<TaskTranscriptPage, String> {
        let connection = self.open()?;
        let limit = limit.clamp(1, 200);
        let after = after_sequence.unwrap_or(0);
        let mut statement = connection
            .prepare(
                "SELECT sequence, event_json, created_at FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2 AND sequence > ?3
                 ORDER BY sequence ASC LIMIT ?4",
            )
            .map_err(store_error)?;
        let rows = statement
            .query_map(
                params![id, generation as i64, after as i64, (limit + 1) as i64],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error)?;
        let has_more = rows.len() > limit;
        let mut events = Vec::with_capacity(rows.len().min(limit));
        for (sequence, encoded, created_at) in rows.into_iter().take(limit) {
            events.push(TaskTranscriptEvent {
                task_id: id.to_string(),
                execution_generation: generation,
                sequence: sequence as u64,
                event: decode_json(&encoded, "task transcript event")?,
                created_at,
            });
        }
        let next_sequence = has_more
            .then(|| events.last().map(|event| event.sequence))
            .flatten();
        Ok(TaskTranscriptPage {
            events,
            next_sequence,
        })
    }

    pub fn begin_apply(
        &self,
        id: &str,
        execution_generation: u64,
        expected_project_generation: u64,
        selected_paths: &[String],
    ) -> Result<(), String> {
        let connection = self.open()?;
        let updated = connection
            .execute(
                "UPDATE research_tasks SET apply_state = 'applying',
                   apply_selection_json = ?3, apply_expected_generation = ?4,
                   updated_at = ?5, owner_pid = ?6, owner_started = ?7
                 WHERE id = ?1 AND execution_generation = ?2
                   AND status = 'awaiting_review' AND apply_state IS NULL",
                params![
                    id,
                    execution_generation as i64,
                    encode_json(selected_paths)?,
                    expected_project_generation as i64,
                    now_ms(),
                    i64::from(self.owner.pid),
                    owner_started_column(self.owner)
                ],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("This task is no longer ready to apply.".into());
        }
        Ok(())
    }

    pub fn clear_apply(&self, id: &str, error: Option<&str>) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL, error = ?2, updated_at = ?3
                 WHERE id = ?1 AND status = 'awaiting_review'",
                params![id, error.map(bound_error), now_ms()],
            )
            .map_err(store_error)?;
        Ok(())
    }

    pub fn complete_apply(
        &self,
        id: &str,
        review: &TaskReviewResult,
    ) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let updated = connection
            .execute(
                "UPDATE research_tasks SET status = 'completed', review_json = ?2,
                   apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL, error = NULL,
                   updated_at = ?3, finished_at = ?3
                 WHERE id = ?1 AND status = 'awaiting_review' AND apply_state = 'applying'",
                params![id, encode_json(review)?, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("The task changed before its review could be recorded.".into());
        }
        self.require(id)
    }

    pub fn complete_without_apply(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let task = self.require(id)?;
        if task
            .result
            .as_ref()
            .is_some_and(|result| !result.changed_files.is_empty())
        {
            return Err("Review and apply or dismiss the changed files first.".into());
        }
        let review = TaskReviewResult {
            selected_paths: Vec::new(),
            applied_at: now_ms(),
            project_mutation_generation: 0,
        };
        let updated = connection
            .execute(
                "UPDATE research_tasks SET status = 'completed', review_json = ?2,
                   error = NULL, updated_at = ?3, finished_at = ?3
                 WHERE id = ?1 AND status = 'awaiting_review' AND apply_state IS NULL",
                params![id, encode_json(&review)?, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("This task is no longer waiting for review.".into());
        }
        self.require(id)
    }

    pub fn pending_applies(&self) -> Result<Vec<PendingApply>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, project_id, apply_selection_json, owner_pid, owner_started
                 FROM research_tasks
                 WHERE status = 'awaiting_review' AND apply_state = 'applying'",
            )
            .map_err(store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error)?;
        rows.into_iter()
            .filter(|(_, _, _, owner_pid, owner_started)| {
                !self.owned_by_live_process(*owner_pid, *owner_started)
            })
            .map(|(task_id, project_id, paths, _, _)| {
                Ok(PendingApply {
                    task_id,
                    project_id,
                    selected_paths: decode_json(&paths, "pending review selection")?,
                })
            })
            .collect()
    }
}

// 0.4.8 L: handoffs between the app and the background helper. Exactly one
// process runs a task: a handoff moves a running generation to `queued`
// for the other owner kind (fenced on this process owning the row and on no
// cancel being pending), and the other side claims it as a new generation
// in the same workspace.
impl TaskStore {
    /// This process, exactly (pid and start time).
    fn is_me(&self, pid: Option<i64>, started: Option<i64>) -> bool {
        owner_from_columns(pid, started) == Some(self.owner)
    }

    /// The row's owner stopped: no owner recorded, or one that is neither
    /// this process nor still running.
    fn owner_gone(&self, pid: Option<i64>, started: Option<i64>) -> bool {
        match owner_from_columns(pid, started) {
            None => true,
            Some(owner) if owner == self.owner => false,
            Some(owner) => !oleafly_sandbox::process::identity::owner_is_live(
                Some(owner),
                self.owner,
                self.probe,
            ),
        }
    }

    /// Hands a running generation to `to`: queued to resume in its workspace
    /// (a row still preparing its workspace starts fresh), with `record`.
    /// Refused when a cancel is pending (the cancel finishes the task) or
    /// when another process owns the row.
    pub fn hand_off_with(
        &self,
        id: &str,
        generation: u64,
        to: OwnerKind,
        record: &HandoffRecord,
    ) -> Result<bool, String> {
        let task = self.require(id)?;
        let pending = task
            .isolation
            .clone()
            .map(|isolation| PendingStart::Resume {
                isolation,
                reason: ResumeReason::Handoff,
                previous_native_session_id: task.native_session_id.clone(),
            });
        let pending_json = pending.as_ref().map(encode_json).transpose()?;
        let mut record = record.clone();
        record.from_generation = generation;
        record.to = to;
        self.open()?
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 1,
                   owner_kind = ?3, pending_start_json = COALESCE(?4, pending_start_json),
                   phase = NULL, owner_pid = NULL, owner_started = NULL, updated_at = ?5,
                   handoff_json = ?6, reclaim_requested = 0
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0
                   AND (owner_pid IS NULL OR (owner_pid = ?7 AND owner_started IS ?8))",
                params![
                    id,
                    generation as i64,
                    owner_kind_column(to),
                    pending_json,
                    now_ms(),
                    encode_json(&record)?,
                    i64::from(self.owner.pid),
                    owner_started_column(self.owner)
                ],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// Hands a queued task of this owner kind to `to`. A conversation an
    /// earlier handoff saved for it is kept.
    pub fn hand_off_queued(
        &self,
        id: &str,
        to: OwnerKind,
        record: &HandoffRecord,
    ) -> Result<bool, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let existing: Option<Option<String>> = transaction
            .query_row(
                "SELECT handoff_json FROM research_tasks
                 WHERE id = ?1 AND status = 'queued' AND owner_kind = ?2",
                params![id, owner_kind_column(self.owner_kind)],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        let Some(existing) = existing else {
            transaction.commit().map_err(store_error)?;
            return Ok(false);
        };
        let merged =
            match existing.and_then(|json| serde_json::from_str::<HandoffRecord>(&json).ok()) {
                Some(mut earlier) => {
                    earlier.from = record.from;
                    earlier.to = to;
                    earlier.reason = record.reason;
                    earlier.grant = record.grant.clone();
                    earlier.created_at = record.created_at;
                    earlier
                }
                None => HandoffRecord {
                    to,
                    ..record.clone()
                },
            };
        let updated = transaction
            .execute(
                "UPDATE research_tasks SET owner_kind = ?2, handoff_json = ?3, reclaim_requested = 0,
                   owner_pid = NULL, owner_started = NULL, updated_at = ?4
                 WHERE id = ?1 AND status = 'queued' AND owner_kind = ?5",
                params![
                    id,
                    owner_kind_column(to),
                    encode_json(&merged)?,
                    now_ms(),
                    owner_kind_column(self.owner_kind)
                ],
            )
            .map_err(store_error)?;
        transaction.commit().map_err(store_error)?;
        Ok(updated == 1)
    }

    /// The task's handoff record. An unreadable record, or one from a newer
    /// version, reads as none: the next owner then resumes from the
    /// research record alone.
    pub fn handoff_record(&self, id: &str) -> Result<Option<HandoffRecord>, String> {
        let json: Option<String> = self
            .open()?
            .query_row(
                "SELECT handoff_json FROM research_tasks WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?
            .flatten();
        Ok(json
            .and_then(|json| serde_json::from_str::<HandoffRecord>(&json).ok())
            .filter(|record| record.version <= HANDOFF_VERSION))
    }

    /// Tasks of this owner kind marked to keep running that can move now:
    /// running ones this process owns, and started queued ones that do not
    /// wait for ordinary work (which stays with the app).
    pub fn handoff_candidates(&self) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        let ids = connection
            .prepare(
                "SELECT task.id FROM research_tasks task
                 WHERE task.owner_kind = ?1 AND task.keep_running_after_quit = 1
                   AND task.cancel_requested = 0
                   AND ((task.status = 'running'
                         AND (task.owner_pid IS NULL
                              OR (task.owner_pid = ?2 AND task.owner_started IS ?3)))
                     OR (task.status = 'queued' AND task.start_requested = 1
                         AND NOT EXISTS (
                           SELECT 1 FROM research_task_dependencies dependency
                           JOIN research_tasks required ON required.id = dependency.dependency_id
                           WHERE dependency.task_id = task.id AND required.status <> 'completed'
                             AND required.keep_running_after_quit = 0)))
                 ORDER BY task.created_at ASC",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(
                        params![
                            owner_kind_column(self.owner_kind),
                            i64::from(self.owner.pid),
                            owner_started_column(self.owner)
                        ],
                        |row| row.get::<_, String>(0),
                    )?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        drop(connection);
        ids.iter().map(|id| self.require(id)).collect()
    }

    /// Re-queues a running row whose owner stopped without handing over:
    /// it resumes in its workspace for `to`, told that its last turn was cut
    /// short. A CLI agent's home from an earlier handoff is kept when it
    /// still exists; the grant is kept.
    fn requeue_recovered(
        &self,
        transaction: &Transaction<'_>,
        id: &str,
        to: OwnerKind,
    ) -> Result<bool, String> {
        type Row = (
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            bool,
        );
        let row: Option<Row> = transaction
            .query_row(
                "SELECT execution_generation, isolation_json, native_session_id, handoff_json, owner_kind,
                   cancel_requested
                 FROM research_tasks WHERE id = ?1 AND status = 'running'",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .optional()
            .map_err(store_error)?;
        let Some((generation, isolation_json, native, handoff_json, from_kind, cancel_requested)) =
            row
        else {
            return Ok(false);
        };
        if cancel_requested {
            // The user cancelled it before its owner stopped: it ends here.
            let cancelled = transaction
                .execute(
                    "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                       cancel_requested = 0, error = NULL, updated_at = ?2, finished_at = ?2,
                       owner_kind = 'app', reclaim_requested = 0, handoff_json = NULL,
                       owner_pid = NULL, owner_started = NULL
                     WHERE id = ?1 AND status = 'running'",
                    params![id, now_ms()],
                )
                .map_err(store_error)?
                == 1;
            if cancelled {
                fail_waiting_dependents(transaction, id, true)?;
            }
            return Ok(false);
        }
        let generation = generation.max(0) as u64;
        let isolation: Option<TaskIsolation> = decode_optional(isolation_json, "task isolation")?;
        let pending = isolation.map(|isolation| PendingStart::Resume {
            isolation,
            reason: ResumeReason::Handoff,
            previous_native_session_id: native.clone(),
        });
        let previous: Option<HandoffRecord> =
            handoff_json.and_then(|json| serde_json::from_str::<HandoffRecord>(&json).ok());
        let mut record = HandoffRecord::new(
            owner_kind_from(&from_kind),
            to,
            HandoffReason::Recovered,
            generation,
        );
        // A snapshot from an earlier handoff predates the lost work.
        record.conversation = None;
        record.turn_interrupted = true;
        record.acp = previous
            .as_ref()
            .and_then(|earlier| earlier.acp.clone())
            .filter(|acp| acp.home.is_dir())
            .and_then(|acp| {
                native
                    .clone()
                    .filter(|session| !session.is_empty())
                    .map(|agent_session_id| AcpHandoff {
                        agent_session_id,
                        home: acp.home,
                    })
            });
        record.grant = previous.and_then(|earlier| earlier.grant);
        transaction
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 1, owner_kind = ?2,
                   pending_start_json = COALESCE(?3, pending_start_json), phase = NULL,
                   owner_pid = NULL, owner_started = NULL, reclaim_requested = 0,
                   handoff_json = ?4, updated_at = ?5
                 WHERE id = ?1 AND status = 'running' AND execution_generation = ?6
                   AND cancel_requested = 0",
                params![
                    id,
                    owner_kind_column(to),
                    pending.as_ref().map(encode_json).transpose()?,
                    encode_json(&record)?,
                    now_ms(),
                    generation as i64
                ],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    fn running_rows(
        transaction: &Transaction<'_>,
        sql: &str,
        parameters: impl rusqlite::Params,
    ) -> Result<Vec<OwnerRow>, String> {
        transaction
            .prepare(sql)
            .and_then(|mut statement| {
                statement
                    .query_map(parameters, |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)
    }

    /// The app opened while the helper runs tasks: queued helper tasks and
    /// running ones whose helper is gone come back at once; the helper is
    /// asked to give back the rest at their next step. Returns how many
    /// tasks were moved or marked.
    pub fn request_reclaim(&self) -> Result<usize, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let now = now_ms();
        let mut count = transaction
            .execute(
                "UPDATE research_tasks SET owner_kind = 'app', reclaim_requested = 0, updated_at = ?1
                 WHERE owner_kind = 'daemon' AND status = 'queued'",
                [now],
            )
            .map_err(store_error)?;
        let running = Self::running_rows(
            &transaction,
            "SELECT id, owner_pid, owner_started FROM research_tasks
             WHERE owner_kind = 'daemon' AND status = 'running'",
            [],
        )?;
        for (id, pid, started) in running {
            if self.owner_gone(pid, started) {
                if self.requeue_recovered(&transaction, &id, OwnerKind::App)? {
                    count += 1;
                }
            } else {
                count += transaction
                    .execute(
                        "UPDATE research_tasks SET reclaim_requested = 1, updated_at = ?2
                         WHERE id = ?1 AND status = 'running' AND owner_kind = 'daemon'",
                        params![id, now],
                    )
                    .map_err(store_error)?;
            }
        }
        transaction.commit().map_err(store_error)?;
        Ok(count)
    }

    /// The app is quitting: the helper keeps the tasks it was asked to give
    /// back.
    pub fn cancel_reclaim_requests(&self) -> Result<usize, String> {
        self.open()?
            .execute(
                "UPDATE research_tasks SET reclaim_requested = 0, updated_at = ?1
                 WHERE reclaim_requested = 1",
                [now_ms()],
            )
            .map_err(store_error)
    }

    /// Cancels and reclaims the other process asked for, among the tasks
    /// this process runs.
    pub fn foreign_requests(&self) -> Result<ForeignRequests, String> {
        let connection = self.open()?;
        let rows = connection
            .prepare(
                "SELECT id, execution_generation, cancel_requested, reclaim_requested
                 FROM research_tasks
                 WHERE status = 'running' AND owner_pid = ?1 AND owner_started IS ?2
                   AND (cancel_requested = 1 OR reclaim_requested = 1)
                 ORDER BY updated_at ASC",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(
                        params![i64::from(self.owner.pid), owner_started_column(self.owner)],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, bool>(2)?,
                                row.get::<_, bool>(3)?,
                            ))
                        },
                    )?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        let mut requests = ForeignRequests::default();
        for (id, generation, cancel, reclaim) in rows {
            if cancel {
                requests.cancel.push(id);
            } else if reclaim {
                requests.reclaim.push((id, generation.max(0) as u64));
            }
        }
        Ok(requests)
    }

    /// The helper is not running: its queued tasks and the running ones it
    /// left come back to the app. Returns their ids.
    pub fn adopt_orphaned_daemon_tasks(&self) -> Result<Vec<String>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let mut adopted: Vec<String> = transaction
            .prepare(
                "SELECT id FROM research_tasks WHERE owner_kind = 'daemon' AND status = 'queued'",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        transaction
            .execute(
                "UPDATE research_tasks SET owner_kind = 'app', reclaim_requested = 0, updated_at = ?1
                 WHERE owner_kind = 'daemon' AND status = 'queued'",
                [now_ms()],
            )
            .map_err(store_error)?;
        let running = Self::running_rows(
            &transaction,
            "SELECT id, owner_pid, owner_started FROM research_tasks
             WHERE owner_kind = 'daemon' AND status = 'running'",
            [],
        )?;
        for (id, pid, started) in running {
            if self.owner_gone(pid, started)
                && self.requeue_recovered(&transaction, &id, OwnerKind::App)?
            {
                adopted.push(id);
            }
        }
        transaction.commit().map_err(store_error)?;
        Ok(adopted)
    }

    /// Keep-running tasks of this owner kind whose process stopped without
    /// handing them over (a crash, a reboot, a sign-out) resume instead of
    /// failing. Returns their ids.
    pub fn requeue_interrupted_keep_running(&self) -> Result<Vec<String>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let running = Self::running_rows(
            &transaction,
            "SELECT id, owner_pid, owner_started FROM research_tasks
             WHERE owner_kind = ?1 AND status = 'running' AND keep_running_after_quit = 1",
            [owner_kind_column(self.owner_kind)],
        )?;
        let mut requeued = Vec::new();
        for (id, pid, started) in running {
            if self.owner_gone(pid, started)
                && self.requeue_recovered(&transaction, &id, self.owner_kind)?
            {
                requeued.push(id);
            }
        }
        transaction.commit().map_err(store_error)?;
        Ok(requeued)
    }

    /// What this process runs, and the queued tasks of its owner kind that
    /// can still run here.
    pub fn owned_work(&self) -> Result<OwnedWork, String> {
        self.open()?
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM research_tasks
                    WHERE status = 'running' AND owner_kind = ?1
                      AND owner_pid = ?2 AND owner_started IS ?3),
                   (SELECT COUNT(*) FROM research_tasks task
                    WHERE task.status = 'queued' AND task.start_requested = 1 AND task.owner_kind = ?1
                      AND NOT EXISTS (
                        SELECT 1 FROM research_task_dependencies dependency
                        JOIN research_tasks required ON required.id = dependency.dependency_id
                        WHERE dependency.task_id = task.id AND required.status <> 'completed'
                          AND NOT (required.owner_kind = ?1 AND required.status IN ('queued', 'running'))))",
                params![
                    owner_kind_column(self.owner_kind),
                    i64::from(self.owner.pid),
                    owner_started_column(self.owner)
                ],
                |row| {
                    Ok(OwnedWork {
                        running: row.get::<_, i64>(0)?.max(0) as usize,
                        queued: row.get::<_, i64>(1)?.max(0) as usize,
                    })
                },
            )
            .map_err(store_error)
    }

    /// Turns "keep running when Oleafly is closed" on or off for a task
    /// that has not finished, while it waits or runs.
    pub fn set_keep_running(&self, id: &str, keep: bool) -> Result<ResearchTask, String> {
        let task = self.require(id)?;
        if !matches!(
            task.status,
            ResearchTaskStatus::Queued
                | ResearchTaskStatus::Running
                | ResearchTaskStatus::PlanReady
        ) {
            return Err(
                "Only a task that has not finished can keep running after Oleafly closes.".into(),
            );
        }
        validate_desktop_apps(task.brief.permissions.desktop_apps, keep, task.run_after)?;
        let updated = self
            .open()?
            .execute(
                "UPDATE research_tasks SET keep_running_after_quit = ?2, updated_at = ?3
                 WHERE id = ?1 AND status IN ('queued', 'running', 'plan_ready')",
                params![id, keep, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("The task finished before this could change.".into());
        }
        self.require(id)
    }

    /// Tasks updated after `updated_after` (epoch ms), oldest change first,
    /// at most `limit` (1–500).
    pub fn changed_since(
        &self,
        updated_after: i64,
        limit: usize,
    ) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {TASK_COLUMNS} FROM research_tasks WHERE updated_at > ?1
                 ORDER BY updated_at ASC, id ASC LIMIT ?2"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map(
                params![updated_after, limit.clamp(1, 500) as i64],
                read_stored_task,
            )
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error)?;
        drop(statement);
        rows.into_iter()
            .map(|row| materialize_task(&connection, row))
            .collect()
    }

    /// The row is running under another process that is still alive.
    pub fn owned_by_other_live_process(&self, id: &str) -> Result<bool, String> {
        let row: Option<(Option<i64>, Option<i64>)> = self
            .open()?
            .query_row(
                "SELECT owner_pid, owner_started FROM research_tasks WHERE id = ?1 AND status = 'running'",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(store_error)?;
        Ok(row.is_some_and(|(pid, started)| {
            !self.is_me(pid, started) && !self.owner_gone(pid, started)
        }))
    }

    /// Whether the helper owns work, or the app asked for work back.
    pub fn has_daemon_work(&self) -> Result<bool, String> {
        self.open()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM research_tasks
                   WHERE (owner_kind = 'daemon' AND status IN ('queued', 'running'))
                      OR reclaim_requested = 1)",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(store_error)
    }

    /// The helper's tasks, queued or running.
    pub fn daemon_tasks(&self) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {TASK_COLUMNS} FROM research_tasks
                 WHERE owner_kind = 'daemon' AND status IN ('queued', 'running')
                 ORDER BY created_at ASC LIMIT 200"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map([], read_stored_task)
            .map_err(store_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(store_error)?;
        drop(statement);
        rows.into_iter()
            .map(|row| materialize_task(&connection, row))
            .collect()
    }
}

fn initialize_schema(connection: &mut Connection) -> Result<(), String> {
    #[cfg(test)]
    SCHEMA_INITIALIZATIONS.with(|count| count.set(count.get() + 1));
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS research_tasks (
                   id TEXT PRIMARY KEY,
                   project_id TEXT NOT NULL,
                   title TEXT NOT NULL,
                   prompt TEXT NOT NULL,
                   runtime_id TEXT NOT NULL,
                   agent_id TEXT NOT NULL,
                   model_id TEXT NOT NULL,
                   skill_ids_json TEXT NOT NULL,
                   status TEXT NOT NULL,
                   execution_generation INTEGER NOT NULL DEFAULT 0,
                   session_id TEXT,
                   native_session_id TEXT,
                   source_revision TEXT,
                   isolation_json TEXT,
                   error TEXT,
                   result_json TEXT,
                   review_json TEXT,
                   start_requested INTEGER NOT NULL DEFAULT 0,
                   cancel_requested INTEGER NOT NULL DEFAULT 0,
                   apply_state TEXT,
                   apply_selection_json TEXT,
                   apply_expected_generation INTEGER,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   started_at INTEGER,
                   finished_at INTEGER
                 );
                 CREATE INDEX IF NOT EXISTS research_tasks_project_status
                   ON research_tasks(project_id, status, updated_at DESC);
                 CREATE INDEX IF NOT EXISTS research_tasks_requested
                   ON research_tasks(start_requested, status, created_at);
                 CREATE TABLE IF NOT EXISTS research_task_dependencies (
                   task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
                   dependency_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE RESTRICT,
                   PRIMARY KEY(task_id, dependency_id),
                   CHECK(task_id <> dependency_id)
                 );
                 CREATE INDEX IF NOT EXISTS research_task_dependency_lookup
                   ON research_task_dependencies(dependency_id);
                 CREATE TABLE IF NOT EXISTS research_task_events (
                   task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
                   execution_generation INTEGER NOT NULL,
                   sequence INTEGER NOT NULL,
                   event_json TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   PRIMARY KEY(task_id, execution_generation, sequence)
                 );",
        )
        .map_err(|error| format!("could not initialize the research task store: {error}"))?;
    migrate(connection)
}

#[cfg(test)]
thread_local! {
    /// Schema initializations on this thread (each test runs on its own).
    pub(crate) static SCHEMA_INITIALIZATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn read_stored_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredTask> {
    Ok(StoredTask {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        runtime_id: row.get(4)?,
        agent_id: row.get(5)?,
        model_id: row.get(6)?,
        skill_ids_json: row.get(7)?,
        status: row.get(8)?,
        execution_generation: row.get(9)?,
        session_id: row.get(10)?,
        native_session_id: row.get(11)?,
        source_revision: row.get(12)?,
        isolation_json: row.get(13)?,
        error: row.get(14)?,
        result_json: row.get(15)?,
        review_json: row.get(16)?,
        start_requested: row.get(17)?,
        cancel_requested: row.get(18)?,
        created_at: row.get(19)?,
        updated_at: row.get(20)?,
        started_at: row.get(21)?,
        finished_at: row.get(22)?,
        brief_json: row.get(23)?,
        record_slug: row.get(24)?,
        run_after: row.get(25)?,
        keep_running_after_quit: row.get(26)?,
        owner_kind: row.get(27)?,
        phase: row.get(28)?,
        plan_approved: row.get(29)?,
        pending_start_json: row.get(30)?,
        evidence_json: row.get(31)?,
        todos_json: row.get(32)?,
        stop_reason: row.get(33)?,
        active_ms: row.get(34)?,
        pending_approvals: row.get(35)?,
        // 0.4.8 L
        reclaim_requested: row.get(36)?,
        resumed_from: row.get(37)?,
    })
}

fn materialize_task(connection: &Connection, stored: StoredTask) -> Result<ResearchTask, String> {
    let mut statement = connection
        .prepare(
            "SELECT dependency_id FROM research_task_dependencies
             WHERE task_id = ?1 ORDER BY dependency_id",
        )
        .map_err(store_error)?;
    let dependency_ids = statement
        .query_map([&stored.id], |row| row.get(0))
        .map_err(store_error)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(store_error)?;
    Ok(ResearchTask {
        id: stored.id,
        project_id: stored.project_id,
        title: stored.title,
        prompt: stored.prompt,
        runtime_id: stored.runtime_id,
        agent_id: stored.agent_id,
        model_id: stored.model_id,
        skill_ids: decode_json(&stored.skill_ids_json, "task skill list")?,
        dependency_ids,
        status: ResearchTaskStatus::parse(&stored.status)?,
        execution_generation: stored.execution_generation.max(0) as u64,
        session_id: stored.session_id,
        native_session_id: stored.native_session_id,
        source_revision: stored.source_revision,
        isolation: decode_optional(stored.isolation_json, "task isolation")?,
        error: stored.error,
        result: decode_optional(stored.result_json, "task result")?,
        review: decode_optional(stored.review_json, "task review")?,
        start_requested: stored.start_requested,
        cancel_requested: stored.cancel_requested,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        started_at: stored.started_at,
        finished_at: stored.finished_at,
        brief: decode_optional::<ResearchBrief>(stored.brief_json, "task brief")?
            .unwrap_or_default(),
        record_slug: stored.record_slug,
        run_after: stored.run_after,
        keep_running_after_quit: stored.keep_running_after_quit,
        owner: owner_kind_from(&stored.owner_kind),
        phase: stored.phase.as_deref().and_then(TaskPhase::parse),
        plan_approved: stored.plan_approved,
        stop_reason: stored.stop_reason.as_deref().and_then(StopReason::parse),
        evidence: decode_optional(stored.evidence_json, "task evidence")?,
        pending_approvals: u32::try_from(stored.pending_approvals.max(0)).unwrap_or(u32::MAX),
        active_ms: stored.active_ms.max(0) as u64,
        todos: decode_optional(stored.todos_json, "task todos")?.unwrap_or_default(),
        pending_start: decode_optional(stored.pending_start_json, "task pending start")?,
        // 0.4.8 L
        reclaim_requested: stored.reclaim_requested,
        resumed_from: stored
            .resumed_from
            .and_then(|generation| u64::try_from(generation).ok()),
    })
}

fn owner_kind_from(value: &str) -> OwnerKind {
    if value == "daemon" {
        OwnerKind::Daemon
    } else {
        OwnerKind::App
    }
}

fn owner_kind_column(owner: OwnerKind) -> &'static str {
    match owner {
        OwnerKind::App => "app",
        OwnerKind::Daemon => "daemon",
    }
}

fn validate_draft(
    title: &str,
    prompt: &str,
    runtime_id: &str,
    agent_id: &str,
    model_id: &str,
    skill_ids: &[String],
) -> Result<(), String> {
    validate_text(title, "Task title", 1, 160)?;
    validate_text(prompt, "Task prompt", 1, 32_000)?;
    validate_text(runtime_id, "Runtime", 1, 80)?;
    validate_text(agent_id, "Agent", 1, 160)?;
    validate_text(model_id, "Model", 0, 200)?;
    if skill_ids.len() > 32 {
        return Err("A task can use at most 32 skills.".into());
    }
    for skill in skill_ids {
        validate_text(skill, "Skill ID", 1, 200)?;
    }
    Ok(())
}

/// Fails the tasks that were started and wait for `dependency_id`, which just
/// failed or was cancelled, and in turn the tasks that wait for them. Tasks
/// that were never started stay queued: starting them later is refused until
/// the dependency is retried.
fn fail_waiting_dependents(
    transaction: &Transaction<'_>,
    dependency_id: &str,
    cancelled: bool,
) -> Result<(), String> {
    let now = now_ms();
    let mut pending = vec![(dependency_id.to_owned(), cancelled)];
    while let Some((stopped, cancelled)) = pending.pop() {
        let title: String = transaction
            .query_row(
                "SELECT title FROM research_tasks WHERE id = ?1",
                [&stopped],
                |row| row.get(0),
            )
            .map_err(store_error)?;
        let outcome = if cancelled { "was cancelled" } else { "failed" };
        let error = format!(
            "This task waits for \"{title}\", which {outcome}. Retry that task first, then retry this one."
        );
        let waiting = transaction
            .prepare(
                "SELECT task.id FROM research_task_dependencies dependency
                 JOIN research_tasks task ON task.id = dependency.task_id
                 WHERE dependency.dependency_id = ?1
                   AND task.status = 'queued' AND task.start_requested = 1",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([&stopped], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(store_error)?;
        for id in waiting {
            let updated = transaction
                .execute(
                    "UPDATE research_tasks SET status = 'failed', start_requested = 0,
                       error = ?2, updated_at = ?3, finished_at = ?3
                     WHERE id = ?1 AND status = 'queued' AND start_requested = 1",
                    params![id, bound_error(&error), now],
                )
                .map_err(store_error)?;
            if updated == 1 {
                pending.push((id, false));
            }
        }
    }
    Ok(())
}

const MAX_GOAL_CHARS: usize = 4_000;
const MAX_CRITERIA: usize = 12;
const MAX_CRITERION_CHARS: usize = 500;
const MAX_SCOPE_CHARS: usize = 2_000;
const MAX_SCHEDULE_AHEAD_MS: i64 = 30 * 24 * 60 * 60 * 1000;

fn valid_metric_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.len() <= 64
        && chars.all(|character| character.is_ascii_alphanumeric() || "_./-".contains(character))
}

/// The limits of a brief, checked when a task is created or edited.
pub fn validate_brief(brief: &ResearchBrief) -> Result<(), String> {
    if brief.goal.chars().count() > MAX_GOAL_CHARS {
        return Err("The brief goal is too long.".into());
    }
    if brief.success_criteria.len() > MAX_CRITERIA {
        return Err("Use at most 12 success criteria.".into());
    }
    if brief
        .success_criteria
        .iter()
        .any(|criterion| criterion.chars().count() > MAX_CRITERION_CHARS)
    {
        return Err("Each success criterion can be up to 500 characters.".into());
    }
    if brief.scope.chars().count() > MAX_SCOPE_CHARS
        || brief.constraints.chars().count() > MAX_SCOPE_CHARS
    {
        return Err("The scope and constraints can be up to 2,000 characters each.".into());
    }
    if let Some(metric) = &brief.primary_metric {
        if !valid_metric_name(&metric.name) {
            return Err(
                "Use a metric name made of letters, numbers, dots, dashes or underscores.".into(),
            );
        }
    }
    let budget = &brief.budget;
    if !(5..=1_440).contains(&budget.wall_clock_minutes) {
        return Err("The time budget must be between 5 minutes and 24 hours.".into());
    }
    if budget
        .usd_cap
        .is_some_and(|cap| !cap.is_finite() || cap <= 0.0 || cap > 10_000.0)
    {
        return Err("The cost limit must be above zero.".into());
    }
    if budget
        .max_runs
        .is_some_and(|runs| !(1..=1_000).contains(&runs))
    {
        return Err("The run limit must be between 1 and 1,000.".into());
    }
    if !(1..=720).contains(&budget.run_timeout_minutes) {
        return Err("Each run can last up to 12 hours.".into());
    }
    let executor = brief.compute.executor.trim();
    if executor.is_empty() || executor.len() > 40 {
        return Err("Choose where the task's runs execute.".into());
    }
    Ok(())
}

// 0.4.8 I: desktop apps ask before every action, so they need someone at
// the computer: no scheduled start, no running after Oleafly closes.
fn validate_desktop_apps(
    desktop_apps: bool,
    keep_running_after_quit: bool,
    run_after: Option<i64>,
) -> Result<(), String> {
    match crate::model::task_desktop_apps_conflict(
        desktop_apps,
        keep_running_after_quit,
        run_after.is_some(),
    ) {
        Some(code) => Err(format!(
            "@oleafly/error:{}",
            serde_json::json!({"code": code, "params": {}, "detail": null})
        )),
        None => Ok(()),
    }
}

fn validate_run_after(run_after: Option<i64>, now: i64) -> Result<(), String> {
    match run_after {
        Some(at) if at < now - 60_000 || at > now + MAX_SCHEDULE_AHEAD_MS => {
            Err("The start time must be within the next 30 days.".into())
        }
        _ => Ok(()),
    }
}

fn validate_text(value: &str, label: &str, minimum: usize, maximum: usize) -> Result<(), String> {
    let length = value.trim().chars().count();
    if length < minimum {
        return Err(format!("{label} is required."));
    }
    if length > maximum {
        return Err(format!("{label} is too long."));
    }
    if value.contains('\0') {
        return Err(format!("{label} contains an invalid character."));
    }
    Ok(())
}

fn validate_dependencies(
    transaction: &Transaction<'_>,
    project_id: &str,
    task_id: Option<&str>,
    dependencies: &[String],
) -> Result<(), String> {
    let dependencies = dedupe(dependencies.to_vec());
    if dependencies.len() > 64 {
        return Err("A task can depend on at most 64 other tasks.".into());
    }
    for dependency in &dependencies {
        if task_id == Some(dependency.as_str()) {
            return Err("A task cannot depend on itself.".into());
        }
        let found: Option<String> = transaction
            .query_row(
                "SELECT project_id FROM research_tasks WHERE id = ?1",
                [dependency],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        if found.as_deref() != Some(project_id) {
            return Err("Every dependency must belong to the same project.".into());
        }
    }
    let Some(task_id) = task_id else {
        return Ok(());
    };
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    let mut statement = transaction
        .prepare(
            "SELECT dependency.task_id, dependency.dependency_id
             FROM research_task_dependencies dependency
             JOIN research_tasks task ON task.id = dependency.task_id
             WHERE task.project_id = ?1",
        )
        .map_err(store_error)?;
    for row in statement
        .query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(store_error)?
    {
        let (from, to) = row.map_err(store_error)?;
        graph.entry(from).or_default().push(to);
    }
    graph.insert(task_id.to_string(), dependencies);
    if dependency_cycle(&graph, task_id) {
        return Err("These dependencies create a cycle.".into());
    }
    Ok(())
}

fn dependency_cycle(graph: &HashMap<String, Vec<String>>, start: &str) -> bool {
    fn visit(
        graph: &HashMap<String, Vec<String>>,
        node: &str,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(node) {
            return true;
        }
        if !visited.insert(node.to_string()) {
            return false;
        }
        visiting.insert(node.to_string());
        let cycle = graph.get(node).is_some_and(|dependencies| {
            dependencies
                .iter()
                .any(|dependency| visit(graph, dependency, visiting, visited))
        });
        visiting.remove(node);
        cycle
    }
    visit(graph, start, &mut HashSet::new(), &mut HashSet::new())
}

fn replace_dependencies(
    transaction: &Transaction<'_>,
    task_id: &str,
    dependencies: &[String],
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM research_task_dependencies WHERE task_id = ?1",
            [task_id],
        )
        .map_err(store_error)?;
    for dependency in dependencies {
        transaction
            .execute(
                "INSERT INTO research_task_dependencies (task_id, dependency_id)
                 VALUES (?1, ?2)",
                params![task_id, dependency],
            )
            .map_err(store_error)?;
    }
    Ok(())
}

fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

fn encode_json<T: serde::Serialize + ?Sized>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("could not encode task data: {error}"))
}

fn prune_text_events(
    transaction: &Transaction<'_>,
    id: &str,
    generation: u64,
    sequence: i64,
) -> Result<(), String> {
    if sequence as u64 <= MAX_EVENTS_PER_RUN {
        return Ok(());
    }
    let kinds = encode_json(&TEXT_EVENT_KINDS)?;
    let stored: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM research_task_events
             WHERE task_id = ?1 AND execution_generation = ?2
               AND json_extract(event_json, '$.kind') IN (SELECT value FROM json_each(?3))",
            params![id, generation as i64, kinds],
            |row| row.get(0),
        )
        .map_err(store_error)?;
    let excess = stored - MAX_EVENTS_PER_RUN as i64;
    if excess <= 0 {
        return Ok(());
    }
    transaction
        .execute(
            "DELETE FROM research_task_events
             WHERE task_id = ?1 AND execution_generation = ?2
               AND sequence IN (
                 SELECT sequence FROM research_task_events
                 WHERE task_id = ?1 AND execution_generation = ?2
                   AND json_extract(event_json, '$.kind') IN (SELECT value FROM json_each(?3))
                 ORDER BY sequence ASC LIMIT ?4)",
            params![id, generation as i64, kinds, excess],
        )
        .map_err(store_error)?;
    Ok(())
}

fn decode_json<T: DeserializeOwned>(value: &str, label: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|error| format!("could not decode {label}: {error}"))
}

fn decode_optional<T: DeserializeOwned>(
    value: Option<String>,
    label: &str,
) -> Result<Option<T>, String> {
    value
        .map(|encoded| decode_json(&encoded, label))
        .transpose()
}

fn fresh_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let suffix = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{prefix}-{suffix}")
}

fn bound_error(error: &str) -> String {
    error.chars().take(2_000).collect()
}

fn store_error(error: rusqlite::Error) -> String {
    format!("research task store failed: {error}")
}

const OWNER_SCHEMA_VERSION: i64 = 1;
const BRIEF_SCHEMA_VERSION: i64 = 2;
/// The store's `user_version`.
pub const SCHEMA_VERSION: i64 = 3;

/// Brings an older store up to [`SCHEMA_VERSION`] step by step. Version 1
/// (0.4.7) added the run owner; version 2 (0.4.8) adds briefs, phases,
/// budgets, runs and approvals; version 3 (0.4.8 L) adds handoffs between
/// the app and the background helper.
fn migrate(connection: &mut Connection) -> Result<(), String> {
    if schema_version(connection)? >= SCHEMA_VERSION {
        return Ok(());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(store_error)?;
    let version = schema_version(&transaction)?;
    let upgrade = |sql: &str| {
        transaction
            .execute_batch(sql)
            .map_err(|error| format!("could not upgrade the research task store: {error}"))
    };
    // Columns are added only when missing, so a store whose version lags its
    // columns (an interrupted or mixed-version upgrade) still opens.
    let columns: HashSet<String> = {
        let mut statement = transaction
            .prepare("PRAGMA table_info(research_tasks)")
            .map_err(store_error)?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(1))
            .and_then(|rows| rows.collect::<Result<HashSet<_>, _>>())
            .map_err(store_error)?;
        names
    };
    let add_columns = |added: &[(&str, &str)]| {
        added
            .iter()
            .filter(|(name, _)| !columns.contains(*name))
            .try_for_each(|(name, definition)| {
                upgrade(&format!(
                    "ALTER TABLE research_tasks ADD COLUMN {name} {definition};"
                ))
            })
    };
    if version < OWNER_SCHEMA_VERSION {
        add_columns(&[("owner_pid", "INTEGER"), ("owner_started", "INTEGER")])?;
    }
    if version < BRIEF_SCHEMA_VERSION {
        add_columns(&[
            ("brief_json", "TEXT"),
            ("record_slug", "TEXT NOT NULL DEFAULT ''"),
            ("run_after", "INTEGER"),
            ("keep_running_after_quit", "INTEGER NOT NULL DEFAULT 0"),
            ("owner_kind", "TEXT NOT NULL DEFAULT 'app'"),
            ("phase", "TEXT"),
            ("plan_approved", "INTEGER NOT NULL DEFAULT 0"),
            ("pending_start_json", "TEXT"),
            ("evidence_json", "TEXT"),
            ("todos_json", "TEXT"),
            ("stop_reason", "TEXT"),
            ("active_ms", "INTEGER NOT NULL DEFAULT 0"),
        ])?;
        upgrade(
            "CREATE TABLE IF NOT EXISTS research_task_runs (
               task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
               run_id TEXT NOT NULL,
               execution_generation INTEGER NOT NULL,
               name TEXT NOT NULL,
               executor TEXT NOT NULL,
               command TEXT NOT NULL,
               cwd_rel TEXT NOT NULL,
               state TEXT NOT NULL,
               exit_code INTEGER,
               started_at INTEGER NOT NULL,
               finished_at INTEGER,
               run_dir TEXT NOT NULL,
               handle_json TEXT,
               metrics_json TEXT,
               reported INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY(task_id, run_id)
             );
             CREATE INDEX IF NOT EXISTS research_task_runs_live ON research_task_runs(state);
             CREATE TABLE IF NOT EXISTS research_task_approvals (
               id TEXT PRIMARY KEY,
               task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
               execution_generation INTEGER NOT NULL,
               kind TEXT NOT NULL,
               summary TEXT NOT NULL,
               detail TEXT NOT NULL,
               status TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               expires_at INTEGER NOT NULL,
               decided_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS research_task_approvals_pending
               ON research_task_approvals(status, task_id);",
        )?;
    }
    // 0.4.8 L: reclaim requests, handoff records and the generation a
    // resumed one continues.
    if version < SCHEMA_VERSION {
        add_columns(&[
            ("reclaim_requested", "INTEGER NOT NULL DEFAULT 0"),
            ("handoff_json", "TEXT"),
            ("resumed_from", "INTEGER"),
        ])?;
        upgrade(
            "CREATE INDEX IF NOT EXISTS research_tasks_owner_kind
               ON research_tasks(owner_kind, status);",
        )?;
    }
    upgrade(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    transaction.commit().map_err(store_error)
}

fn schema_version(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(store_error)
}

fn owner_started_column(owner: ProcessIdentity) -> Option<i64> {
    owner
        .started
        .and_then(|started| i64::try_from(started).ok())
}

fn owner_from_columns(pid: Option<i64>, started: Option<i64>) -> Option<ProcessIdentity> {
    let pid = u32::try_from(pid?).ok()?;
    Some(ProcessIdentity {
        pid,
        started: started.and_then(|value| u64::try_from(value).ok()),
    })
}

fn ensure_real_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("The research task data path is not a real directory.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("could not create research task storage: {error}"))?;
            let metadata = std::fs::symlink_metadata(path)
                .map_err(|error| format!("could not inspect research task storage: {error}"))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("The research task data path is not a real directory.".into());
            }
        }
        Err(error) => {
            return Err(format!("could not inspect research task storage: {error}"));
        }
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("The research task database path is not a regular file.".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not inspect the research task database: {error}"
        )),
    }
}

#[cfg(test)]
mod tests;
