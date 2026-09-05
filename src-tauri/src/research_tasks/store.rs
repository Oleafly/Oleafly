use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::de::DeserializeOwned;

use super::model::{
    now_ms, ResearchTask, ResearchTaskDraft, ResearchTaskEdit, ResearchTaskStatus, TaskIsolation,
    TaskResultMetadata, TaskReviewResult, TaskRuntimeEvent, TaskTranscriptEvent,
    TaskTranscriptPage,
};

const MAX_TASKS_PER_PROJECT: usize = 500;
const MAX_EVENTS_PER_RUN: u64 = 5_000;

#[derive(Clone)]
pub(crate) struct TaskStore {
    root: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct PendingApply {
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
}

impl TaskStore {
    pub(crate) fn new(root: PathBuf) -> Result<Self, String> {
        ensure_real_directory(&root)?;
        let store = Self { root };
        store.open()?;
        Ok(store)
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    fn open(&self) -> Result<Connection, String> {
        ensure_real_directory(&self.root)?;
        let database = self.root.join("tasks.sqlite3");
        reject_symlink(&database)?;
        let connection = Connection::open(&database)
            .map_err(|error| format!("could not open the research task store: {error}"))?;
        reject_symlink(&database)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("could not configure the research task store: {error}"))?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
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
        Ok(connection)
    }

    pub(crate) fn create(&self, draft: ResearchTaskDraft) -> Result<ResearchTask, String> {
        validate_draft(
            &draft.title,
            &draft.prompt,
            &draft.runtime_id,
            &draft.agent_id,
            &draft.model_id,
            &draft.skill_ids,
        )?;
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        validate_dependencies(&transaction, &draft.project_id, None, &draft.dependency_ids)?;
        let id = fresh_id("task");
        let now = now_ms();
        let skills = encode_json(&dedupe(draft.skill_ids))?;
        transaction
            .execute(
                "INSERT INTO research_tasks (
                   id, project_id, title, prompt, runtime_id, agent_id, model_id,
                   skill_ids_json, status, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?9)",
                params![
                    id,
                    draft.project_id,
                    draft.title.trim(),
                    draft.prompt.trim(),
                    draft.runtime_id.trim(),
                    draft.agent_id.trim(),
                    draft.model_id.trim(),
                    skills,
                    now
                ],
            )
            .map_err(store_error)?;
        replace_dependencies(&transaction, &id, &dedupe(draft.dependency_ids))?;
        transaction.commit().map_err(store_error)?;
        self.require(&id)
    }

    pub(crate) fn edit(&self, id: &str, edit: ResearchTaskEdit) -> Result<ResearchTask, String> {
        validate_draft(
            &edit.title,
            &edit.prompt,
            &edit.runtime_id,
            &edit.agent_id,
            &edit.model_id,
            &edit.skill_ids,
        )?;
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
        let updated = transaction
            .execute(
                "UPDATE research_tasks SET
                   title = ?2, prompt = ?3, runtime_id = ?4, agent_id = ?5,
                   model_id = ?6, skill_ids_json = ?7, updated_at = ?8
                 WHERE id = ?1 AND status = 'queued'",
                params![
                    id,
                    edit.title.trim(),
                    edit.prompt.trim(),
                    edit.runtime_id.trim(),
                    edit.agent_id.trim(),
                    edit.model_id.trim(),
                    encode_json(&dedupe(edit.skill_ids))?,
                    now_ms()
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

    pub(crate) fn list(&self, project_id: &str) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, project_id, title, prompt, runtime_id, agent_id, model_id,
                        skill_ids_json, status, execution_generation, session_id,
                        native_session_id, source_revision, isolation_json, error,
                        result_json, review_json, start_requested, cancel_requested, created_at, updated_at,
                        started_at, finished_at
                 FROM research_tasks WHERE project_id = ?1
                 ORDER BY created_at DESC LIMIT ?2",
            )
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

    pub(crate) fn require(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let stored = connection
            .query_row(
                "SELECT id, project_id, title, prompt, runtime_id, agent_id, model_id,
                        skill_ids_json, status, execution_generation, session_id,
                        native_session_id, source_revision, isolation_json, error,
                        result_json, review_json, start_requested, cancel_requested, created_at, updated_at,
                        started_at, finished_at
                 FROM research_tasks WHERE id = ?1",
                [id],
                read_stored_task,
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| "Research task not found.".to_string())?;
        materialize_task(&connection, stored)
    }

    pub(crate) fn request_start(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
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

    pub(crate) fn claim_next(&self) -> Result<Option<ResearchTask>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(store_error)?;
        let id: Option<String> = transaction
            .query_row(
                "SELECT task.id
                 FROM research_tasks task
                 WHERE task.status = 'queued' AND task.start_requested = 1
                   AND NOT EXISTS (
                     SELECT 1 FROM research_task_dependencies dependency
                     JOIN research_tasks required ON required.id = dependency.dependency_id
                     WHERE dependency.task_id = task.id AND required.status <> 'completed'
                   )
                 ORDER BY task.created_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(store_error)?;
        let Some(id) = id else {
            transaction.commit().map_err(store_error)?;
            return Ok(None);
        };
        let session_id = fresh_id("research-session");
        let now = now_ms();
        let updated = transaction
            .execute(
                "UPDATE research_tasks SET
                   status = 'running', execution_generation = execution_generation + 1,
                   session_id = ?2, native_session_id = NULL, start_requested = 0,
                   cancel_requested = 0,
                   source_revision = NULL, isolation_json = NULL, error = NULL,
                   result_json = NULL, review_json = NULL,
                   apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL, started_at = ?3,
                   finished_at = NULL, updated_at = ?3
                 WHERE id = ?1 AND status = 'queued' AND start_requested = 1",
                params![id, session_id, now],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("The task changed before it could start.".into());
        }
        transaction.commit().map_err(store_error)?;
        self.require(&id).map(Some)
    }

    pub(crate) fn set_isolation(
        &self,
        id: &str,
        generation: u64,
        isolation: &TaskIsolation,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET source_revision = ?3, isolation_json = ?4,
                   updated_at = ?5
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

    pub(crate) fn set_native_session(
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

    pub(crate) fn append_event(
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
        if sequence as u64 > MAX_EVENTS_PER_RUN {
            transaction
                .execute(
                    "DELETE FROM research_task_events
                     WHERE task_id = ?1 AND execution_generation = ?2
                       AND sequence <= ?3",
                    params![id, generation as i64, sequence - MAX_EVENTS_PER_RUN as i64],
                )
                .map_err(store_error)?;
        }
        transaction.commit().map_err(store_error)?;
        Ok(Some(TaskTranscriptEvent {
            task_id: id.to_string(),
            execution_generation: generation,
            sequence: sequence as u64,
            event: event.clone(),
            created_at,
        }))
    }

    pub(crate) fn finish_success(
        &self,
        id: &str,
        generation: u64,
        result: &TaskResultMetadata,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET status = 'awaiting_review', result_json = ?3,
                   error = NULL, cancel_requested = 0, updated_at = ?4, finished_at = ?4
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, encode_json(result)?, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub(crate) fn finish_failure(
        &self,
        id: &str,
        generation: u64,
        error: &str,
    ) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET status = 'failed', error = ?3,
                   updated_at = ?4, finished_at = ?4, start_requested = 0,
                   cancel_requested = 0
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 0",
                params![id, generation as i64, bound_error(error), now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub(crate) fn request_cancel(&self, id: &str) -> Result<ResearchTask, String> {
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
                    "You can cancel tasks that are queued, running or awaiting review.".into(),
                )
            }
        }
        transaction.commit().map_err(store_error)?;
        self.require(id)
    }

    pub(crate) fn finalize_cancel(&self, id: &str, generation: u64) -> Result<bool, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET status = 'cancelled', start_requested = 0,
                   cancel_requested = 0, error = NULL, updated_at = ?3, finished_at = ?3
                 WHERE id = ?1 AND execution_generation = ?2 AND status = 'running'
                   AND cancel_requested = 1",
                params![id, generation as i64, now_ms()],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    pub(crate) fn retry(&self, id: &str) -> Result<ResearchTask, String> {
        let connection = self.open()?;
        let updated = connection
            .execute(
                "UPDATE research_tasks SET status = 'queued', start_requested = 0,
                   error = NULL, session_id = NULL, native_session_id = NULL,
                   cancel_requested = 0,
                   updated_at = ?2, started_at = NULL, finished_at = NULL,
                   apply_state = NULL, apply_selection_json = NULL,
                   apply_expected_generation = NULL
                 WHERE id = ?1 AND status IN ('failed', 'cancelled')",
                params![id, now_ms()],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("Only a failed or cancelled task can be retried.".into());
        }
        self.require(id)
    }

    pub(crate) fn recover_interrupted(&self) -> Result<Vec<ResearchTask>, String> {
        let connection = self.open()?;
        connection
            .execute(
                "UPDATE research_tasks SET status = 'failed', start_requested = 0,
                   cancel_requested = 0,
                   error = 'Oleafly closed before this run finished. Review its saved workspace or retry the task.',
                   updated_at = ?1, finished_at = ?1
                 WHERE status = 'running'",
                [now_ms()],
            )
            .map_err(store_error)?;
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

    pub(crate) fn events(
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

    pub(crate) fn begin_apply(
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
                   updated_at = ?5
                 WHERE id = ?1 AND execution_generation = ?2
                   AND status = 'awaiting_review' AND apply_state IS NULL",
                params![
                    id,
                    execution_generation as i64,
                    encode_json(selected_paths)?,
                    expected_project_generation as i64,
                    now_ms()
                ],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err("This task is no longer ready to apply.".into());
        }
        Ok(())
    }

    pub(crate) fn clear_apply(&self, id: &str, error: Option<&str>) -> Result<(), String> {
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

    pub(crate) fn complete_apply(
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

    pub(crate) fn complete_without_apply(&self, id: &str) -> Result<ResearchTask, String> {
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

    pub(crate) fn pending_applies(&self) -> Result<Vec<PendingApply>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, project_id, apply_selection_json
                 FROM research_tasks
                 WHERE status = 'awaiting_review' AND apply_state = 'applying'",
            )
            .map_err(store_error)?;
        let pending = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(store_error)?
            .map(|row| {
                let (task_id, project_id, paths) = row.map_err(store_error)?;
                Ok(PendingApply {
                    task_id,
                    project_id,
                    selected_paths: decode_json(&paths, "pending review selection")?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(pending)
    }
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
    })
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
mod tests {
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
        }
    }

    fn store() -> (TempDir, TaskStore) {
        let temp = tempfile::tempdir().unwrap();
        let store = TaskStore::new(temp.path().join("tasks")).unwrap();
        (temp, store)
    }

    fn reviewable_task(store: &TaskStore) -> ResearchTask {
        let task = store.create(draft("paper", "Revise results")).unwrap();
        store.request_start(&task.id).unwrap();
        let running = store.claim_next().unwrap().unwrap();
        let workspace = store.root().join(&task.id).join("saved-workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(workspace.join("main.tex"), "reviewed result").unwrap();
        let isolation = TaskIsolation {
            kind: super::super::model::TaskIsolationKind::StagedProject,
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
            changed_files: vec![super::super::model::TaskFileChange {
                path: "main.tex".into(),
                kind: super::super::model::TaskFileChangeKind::Modified,
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
        let queued = store.retry(&reviewed.id).unwrap();
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
        let saved =
            Path::new(&reviewed.isolation.as_ref().unwrap().execution_root).join("main.tex");
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
        assert!(store.retry(&reviewed.id).is_err());
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
        store.retry(&task.id).unwrap();
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
            kind: super::super::model::TaskIsolationKind::StagedProject,
            execution_root: "/managed/task".into(),
            baseline_root: "/managed/task-baseline".into(),
            source_revision: "snapshot:abc".into(),
            baseline_hash: "abc".into(),
            baseline: Vec::new(),
            allowed_paths: Vec::new(),
            created_at: now_ms(),
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
}
