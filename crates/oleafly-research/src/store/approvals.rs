use rusqlite::{params, OptionalExtension};

use super::{fresh_id, store_error, TaskStore};
use crate::model::{now_ms, ApprovalKind, ApprovalRecord, ApprovalStatus};

const APPROVAL_COLUMNS: &str = "id, task_id, execution_generation, kind, summary, detail, status,
    created_at, expires_at, decided_at";

fn read_approval(row: &rusqlite::Row<'_>) -> rusqlite::Result<(ApprovalRecord, String, String)> {
    let kind: String = row.get(3)?;
    let status: String = row.get(6)?;
    Ok((
        ApprovalRecord {
            id: row.get(0)?,
            task_id: row.get(1)?,
            execution_generation: row.get::<_, i64>(2)?.max(0) as u64,
            kind: ApprovalKind::Command,
            summary: row.get(4)?,
            detail: row.get(5)?,
            status: ApprovalStatus::Pending,
            created_at: row.get(7)?,
            expires_at: row.get(8)?,
            decided_at: row.get(9)?,
        },
        kind,
        status,
    ))
}

fn typed(
    (mut record, kind, status): (ApprovalRecord, String, String),
) -> Result<ApprovalRecord, String> {
    record.kind = ApprovalKind::parse(&kind)?;
    record.status = ApprovalStatus::parse(&status)?;
    Ok(record)
}

pub const NO_LONGER_WAITING: &str = "This approval is no longer waiting.";

impl TaskStore {
    pub fn insert_approval(
        &self,
        task_id: &str,
        generation: u64,
        kind: ApprovalKind,
        summary: &str,
        detail: &str,
        expires_at: i64,
    ) -> Result<ApprovalRecord, String> {
        let id = fresh_id("approval");
        let inserted = self
            .open()?
            .execute(
                "INSERT INTO research_task_approvals (
                   id, task_id, execution_generation, kind, summary, detail, status,
                   created_at, expires_at, decided_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, NULL
                 WHERE EXISTS (SELECT 1 FROM research_tasks
                               WHERE id = ?2 AND status = 'running' AND execution_generation = ?3)",
                params![
                    id,
                    task_id,
                    generation as i64,
                    kind.as_str(),
                    summary,
                    detail,
                    now_ms(),
                    expires_at
                ],
            )
            .map_err(store_error)?;
        if inserted != 1 {
            return Err("The task stopped before it could ask.".into());
        }
        self.approval(&id)
    }

    pub fn approval(&self, id: &str) -> Result<ApprovalRecord, String> {
        let row = self
            .open()?
            .query_row(
                &format!("SELECT {APPROVAL_COLUMNS} FROM research_task_approvals WHERE id = ?1"),
                [id],
                read_approval,
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| "This approval request was not found.".to_string())?;
        typed(row)
    }

    pub fn decide_approval(&self, id: &str, approve: bool) -> Result<ApprovalRecord, String> {
        let status = if approve {
            ApprovalStatus::Approved
        } else {
            ApprovalStatus::Denied
        };
        let now = now_ms();
        let updated = self
            .open()?
            .execute(
                "UPDATE research_task_approvals SET status = ?2, decided_at = ?3
                 WHERE id = ?1 AND status = 'pending' AND expires_at > ?3
                   AND EXISTS (SELECT 1 FROM research_tasks task
                               WHERE task.id = research_task_approvals.task_id
                                 AND task.status = 'running'
                                 AND task.execution_generation = research_task_approvals.execution_generation)",
                params![id, status.as_str(), now],
            )
            .map_err(store_error)?;
        if updated != 1 {
            return Err(NO_LONGER_WAITING.into());
        }
        self.approval(id)
    }

    pub fn expire_approval(&self, id: &str) -> Result<ApprovalRecord, String> {
        self.open()?
            .execute(
                "UPDATE research_task_approvals SET status = 'expired', decided_at = ?2
                 WHERE id = ?1 AND status = 'pending' AND expires_at <= ?2",
                params![id, now_ms()],
            )
            .map_err(store_error)?;
        self.approval(id)
    }

    pub fn withdraw_approval(&self, id: &str) -> Result<usize, String> {
        self.open()?
            .execute(
                "UPDATE research_task_approvals SET status = 'withdrawn', decided_at = ?2
                 WHERE id = ?1 AND status = 'pending'",
                params![id, now_ms()],
            )
            .map_err(store_error)
    }

    pub fn withdraw_approvals(&self, task_id: &str, generation: u64) -> Result<usize, String> {
        self.open()?
            .execute(
                "UPDATE research_task_approvals SET status = 'withdrawn', decided_at = ?3
                 WHERE task_id = ?1 AND execution_generation = ?2 AND status = 'pending'",
                params![task_id, generation as i64, now_ms()],
            )
            .map_err(store_error)
    }

    pub fn withdraw_all_approvals(&self, task_id: &str) -> Result<usize, String> {
        self.open()?
            .execute(
                "UPDATE research_task_approvals SET status = 'withdrawn', decided_at = ?2
                 WHERE task_id = ?1 AND status = 'pending'",
                params![task_id, now_ms()],
            )
            .map_err(store_error)
    }

    pub fn pending_approvals(&self, project_id: &str) -> Result<Vec<ApprovalRecord>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {APPROVAL_COLUMNS} FROM research_task_approvals approval
                 WHERE approval.status = 'pending' AND EXISTS (
                   SELECT 1 FROM research_tasks task
                   WHERE task.id = approval.task_id AND task.project_id = ?1
                     AND task.status = 'running'
                     AND task.execution_generation = approval.execution_generation)
                 ORDER BY approval.created_at ASC LIMIT 200"
            ))
            .map_err(store_error)?;
        let rows = statement
            .query_map([project_id], read_approval)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .map_err(store_error)?;
        rows.into_iter().map(typed).collect()
    }
}
