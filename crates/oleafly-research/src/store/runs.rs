//! Rows of `research_task_runs`: the runs each task started. Updates of a
//! live run only apply while it is still starting or running, so the app and
//! the daemon can both watch the same run.
use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};

use super::{decode_optional, encode_json, store_error, TaskStore};
use crate::model::{now_ms, RunRecord, RunState};

const RUN_COLUMNS: &str = "task_id, run_id, execution_generation, name, executor, command,
    cwd_rel, state, exit_code, started_at, finished_at, run_dir, metrics_json, reported";

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<(RunRecord, Option<String>)> {
    let state: String = row.get(7)?;
    let metrics: Option<String> = row.get(12)?;
    Ok((
        RunRecord {
            task_id: row.get(0)?,
            run_id: row.get(1)?,
            execution_generation: row.get::<_, i64>(2)?.max(0) as u64,
            name: row.get(3)?,
            executor: row.get(4)?,
            command: row.get(5)?,
            cwd_rel: row.get(6)?,
            state: RunState::parse(&state).unwrap_or(RunState::Lost),
            exit_code: row.get(8)?,
            started_at: row.get(9)?,
            finished_at: row.get(10)?,
            run_dir: row.get(11)?,
            metrics: BTreeMap::new(),
            reported: row.get(13)?,
        },
        metrics,
    ))
}

fn with_metrics((mut record, metrics): (RunRecord, Option<String>)) -> Result<RunRecord, String> {
    record.metrics = decode_optional(metrics, "run metrics")?.unwrap_or_default();
    Ok(record)
}

impl TaskStore {
    /// Records a new run as starting.
    pub fn insert_run(&self, record: &RunRecord) -> Result<(), String> {
        self.open()?
            .execute(
                "INSERT INTO research_task_runs (
                   task_id, run_id, execution_generation, name, executor, command, cwd_rel,
                   state, exit_code, started_at, finished_at, run_dir, metrics_json, reported
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, NULL, ?10, NULL, 0)",
                params![
                    record.task_id,
                    record.run_id,
                    record.execution_generation as i64,
                    record.name,
                    record.executor,
                    record.command,
                    record.cwd_rel,
                    record.state.as_str(),
                    record.started_at,
                    record.run_dir
                ],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    /// Stores the executor's handle once the run started.
    pub fn set_run_handle(
        &self,
        task_id: &str,
        run_id: &str,
        handle_json: &str,
    ) -> Result<(), String> {
        self.open()?
            .execute(
                "UPDATE research_task_runs SET handle_json = ?3,
                   state = CASE WHEN state = 'starting' THEN 'running' ELSE state END
                 WHERE task_id = ?1 AND run_id = ?2",
                params![task_id, run_id, handle_json],
            )
            .map(|_| ())
            .map_err(store_error)
    }

    pub fn run_handle(&self, task_id: &str, run_id: &str) -> Result<Option<String>, String> {
        self.open()?
            .query_row(
                "SELECT handle_json FROM research_task_runs WHERE task_id = ?1 AND run_id = ?2",
                params![task_id, run_id],
                |row| row.get(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(store_error)
    }

    /// Every run a task has started, oldest first.
    pub fn runs(&self, task_id: &str) -> Result<Vec<RunRecord>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {RUN_COLUMNS} FROM research_task_runs WHERE task_id = ?1
                 ORDER BY started_at ASC, run_id ASC"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map([task_id], read_run)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(store_error)?;
        rows.into_iter().map(with_metrics).collect()
    }

    pub fn run(&self, task_id: &str, run_id: &str) -> Result<RunRecord, String> {
        let row = self
            .open()?
            .query_row(
                &format!("SELECT {RUN_COLUMNS} FROM research_task_runs WHERE task_id = ?1 AND run_id = ?2"),
                params![task_id, run_id],
                read_run,
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| format!("No run {run_id} in this task."))?;
        with_metrics(row)
    }

    pub fn run_count(&self, task_id: &str) -> Result<usize, String> {
        self.open()?
            .query_row(
                "SELECT COUNT(*) FROM research_task_runs WHERE task_id = ?1",
                [task_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count.max(0) as usize)
            .map_err(store_error)
    }

    /// Runs that are starting or running, in every task, with their handles.
    pub fn live_runs(&self) -> Result<Vec<(RunRecord, Option<String>)>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {RUN_COLUMNS}, handle_json FROM research_task_runs
                 WHERE state IN ('starting', 'running') ORDER BY started_at ASC"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((read_run(row)?, row.get::<_, Option<String>>(14)?))
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(store_error)?;
        rows.into_iter()
            .map(|(row, handle)| Ok((with_metrics(row)?, handle)))
            .collect()
    }

    /// Records how a live run ended. Returns false when another process
    /// already did.
    pub fn finish_run(
        &self,
        task_id: &str,
        run_id: &str,
        state: RunState,
        exit_code: Option<i32>,
        finished_at: i64,
        metrics: &BTreeMap<String, f64>,
    ) -> Result<bool, String> {
        self.open()?
            .execute(
                "UPDATE research_task_runs SET state = ?3, exit_code = ?4, finished_at = ?5,
                   metrics_json = ?6
                 WHERE task_id = ?1 AND run_id = ?2 AND state IN ('starting', 'running')",
                params![
                    task_id,
                    run_id,
                    state.as_str(),
                    exit_code,
                    finished_at,
                    encode_json(metrics)?
                ],
            )
            .map(|count| count == 1)
            .map_err(store_error)
    }

    /// Runs of a task that finished and were not yet reported to its agent.
    pub fn unreported_runs(&self, task_id: &str) -> Result<Vec<RunRecord>, String> {
        Ok(self
            .runs(task_id)?
            .into_iter()
            .filter(|run| run.state.is_terminal() && !run.reported)
            .collect())
    }

    pub fn mark_runs_reported(&self, task_id: &str, run_ids: &[String]) -> Result<(), String> {
        let connection = self.open()?;
        for run_id in run_ids {
            connection
                .execute(
                    "UPDATE research_task_runs SET reported = 1 WHERE task_id = ?1 AND run_id = ?2",
                    params![task_id, run_id],
                )
                .map_err(store_error)?;
        }
        Ok(())
    }

    /// Marks a run lost when no executor can report on it any more.
    pub fn lose_run(&self, task_id: &str, run_id: &str) -> Result<bool, String> {
        self.finish_run(
            task_id,
            run_id,
            RunState::Lost,
            None,
            now_ms(),
            &BTreeMap::new(),
        )
    }
}
