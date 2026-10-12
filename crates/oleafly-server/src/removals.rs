use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ServerError;

pub fn record(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
    by: AccountId,
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO project_removals (project_id, account_id, removed_by, removed_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (project_id, account_id) DO UPDATE SET removed_by = excluded.removed_by, removed_at = excluded.removed_at",
        params![project.to_string(), account.to_string(), by.to_string(), now],
    )?;
    Ok(())
}

pub fn clear(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<bool, ServerError> {
    Ok(conn.execute(
        "DELETE FROM project_removals WHERE project_id = ?1 AND account_id = ?2",
        [project.to_string(), account.to_string()],
    )? > 0)
}

pub fn is_removed(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<bool, ServerError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM project_removals WHERE project_id = ?1 AND account_id = ?2",
            [project.to_string(), account.to_string()],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}
