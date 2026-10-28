use axum::http::StatusCode;
use oleafly_collab_protocol::ids::AccountId;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ServerError;

pub const UPLOAD_WINDOW_MS: i64 = 60 * 60 * 1000;
const MB: u64 = 1024 * 1024;

fn bytes_from(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

pub fn account_bytes(conn: &Connection, account: AccountId) -> Result<u64, ServerError> {
    let (projects, outputs): (i64, i64) = conn.query_row(
        "SELECT \
           (SELECT COALESCE(SUM(log_bytes + file_bytes), 0) FROM projects WHERE owner_account = ?1), \
           (SELECT COALESCE(SUM(o.size), 0) FROM project_outputs o JOIN projects p ON p.id = o.project_id WHERE p.owner_account = ?1)",
        [account.to_string()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(bytes_from(projects).saturating_add(bytes_from(outputs)))
}

pub fn owned_projects(conn: &Connection, account: AccountId) -> Result<u32, ServerError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE owner_account = ?1 AND status IN ('pending', 'active')",
        [account.to_string()],
        |row| row.get(0),
    )?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

pub fn may_create_project(
    conn: &Connection,
    owner: AccountId,
    limit: Option<u32>,
) -> Result<(), ServerError> {
    let Some(limit) = limit else {
        return Ok(());
    };
    if owned_projects(conn, owner)? < limit {
        return Ok(());
    }
    Err(ServerError::Refused {
        status: StatusCode::TOO_MANY_REQUESTS,
        code: "too_many_projects",
        message: format!(
            "You already have {limit} shared projects on this server, which is as many as one account may have. Stop sharing one before you share another."
        ),
    })
}

pub fn count_upload(
    conn: &Connection,
    account: AccountId,
    limit: Option<u32>,
    now: i64,
) -> Result<(), ServerError> {
    let Some(limit) = limit else {
        return Ok(());
    };
    let current: Option<(i64, i64)> = conn
        .query_row(
            "SELECT window_start, uploads FROM account_uploads WHERE account_id = ?1",
            [account.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (start, uploads) = match current {
        Some((start, uploads)) if now < start.saturating_add(UPLOAD_WINDOW_MS) => (start, uploads),
        _ => (now, 0),
    };
    if uploads >= i64::from(limit) {
        let left_ms = start.saturating_add(UPLOAD_WINDOW_MS).saturating_sub(now);
        let minutes = left_ms.saturating_add(59_999) / 60_000;
        return Err(ServerError::Refused {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "too_many_uploads",
            message: format!(
                "This account made {limit} uploads in the last hour, which is as many as this server allows. Try again in {} {}.",
                minutes.max(1),
                if minutes > 1 { "minutes" } else { "minute" }
            ),
        });
    }
    conn.execute(
        "INSERT INTO account_uploads (account_id, window_start, uploads) VALUES (?1, ?2, ?3) \
         ON CONFLICT (account_id) DO UPDATE SET window_start = excluded.window_start, uploads = excluded.uploads",
        params![account.to_string(), start, uploads + 1],
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Storage {
    pub owner: AccountId,
    pub by: AccountId,
    pub limit_mb: u64,
}

impl Storage {
    pub fn for_upload(owner: AccountId, by: AccountId, limit_mb: Option<u64>) -> Option<Storage> {
        limit_mb.map(|limit_mb| Storage {
            owner,
            by,
            limit_mb,
        })
    }

    pub fn refusal(
        &self,
        conn: &Connection,
        adding: u64,
        freeing: u64,
    ) -> Result<Option<ServerError>, ServerError> {
        let after = account_bytes(conn, self.owner)?
            .saturating_sub(freeing)
            .saturating_add(adding);
        if after <= self.limit_mb.saturating_mul(MB) {
            return Ok(None);
        }
        Ok(Some(self.full()))
    }

    pub fn check(&self, conn: &Connection, adding: u64, freeing: u64) -> Result<(), ServerError> {
        match self.refusal(conn, adding, freeing)? {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn full(&self) -> ServerError {
        let limit = self.limit_mb;
        let message = if self.owner == self.by {
            format!(
                "Your projects on this server already use the {limit} MB each account may keep. Remove files or stop sharing a project to make room."
            )
        } else {
            format!(
                "This project's owner already uses the {limit} MB each account may keep on this server, so it can't take more files."
            )
        };
        ServerError::Refused {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            code: "account_storage_full",
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::members;
    use oleafly_collab_protocol::roles::ServerRole;

    #[tokio::test]
    async fn uploads_are_counted_per_account_within_an_hour_and_refusals_are_not_counted() {
        let db = Db::open_in_memory().unwrap();
        let outcome = db
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let bo = members::create_account(conn, "Bo", None, ServerRole::Member, 1)?;
                let start = 10_000;
                let mut seen = Vec::new();
                for at in 0..3 {
                    seen.push(count_upload(conn, ada, Some(2), start + at).map_err(|e| e.code()));
                }
                seen.push(count_upload(conn, bo, Some(2), start).map_err(|e| e.code()));
                seen.push(
                    count_upload(conn, ada, Some(2), start + UPLOAD_WINDOW_MS - 1)
                        .map_err(|e| e.code()),
                );
                seen.push(
                    count_upload(conn, ada, Some(2), start + UPLOAD_WINDOW_MS)
                        .map_err(|e| e.code()),
                );
                seen.push(count_upload(conn, ada, None, start).map_err(|e| e.code()));
                Ok(seen)
            })
            .await
            .unwrap();
        assert_eq!(
            outcome,
            [
                Ok(()),
                Ok(()),
                Err("too_many_uploads"),
                Ok(()),
                Err("too_many_uploads"),
                Ok(()),
                Ok(()),
            ]
        );
    }

    #[tokio::test]
    async fn a_full_upload_window_says_how_long_to_wait() {
        let db = Db::open_in_memory().unwrap();
        let refused = db
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                count_upload(conn, ada, Some(1), 0)?;
                Ok((
                    count_upload(conn, ada, Some(1), 30 * 60 * 1000 + 1),
                    count_upload(conn, ada, Some(1), UPLOAD_WINDOW_MS - 1),
                ))
            })
            .await
            .unwrap();
        let message = |result: Result<(), ServerError>| match result {
            Err(error) => {
                assert_eq!(error.status(), StatusCode::TOO_MANY_REQUESTS);
                error.public_message()
            }
            Ok(()) => panic!("the upload was counted"),
        };
        assert!(message(refused.0).ends_with("Try again in 30 minutes."));
        assert!(message(refused.1).ends_with("Try again in 1 minute."));
    }

    #[tokio::test]
    async fn account_storage_sums_the_projects_the_account_owns_and_their_outputs() {
        let db = Db::open_in_memory().unwrap();
        let (used, other, refusal, fits, freed) = db
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let bo = members::create_account(conn, "Bo", None, ServerRole::Member, 1)?;
                conn.execute_batch(&format!(
                    "INSERT INTO projects (id, owner_account, title, status, created_at, log_bytes, file_bytes) VALUES \
                       ('p1', '{ada}', 'One', 'active', 1, 300000, 400000), \
                       ('p2', '{ada}', 'Two', 'archived', 1, 0, 100000), \
                       ('p3', '{bo}', 'Three', 'active', 1, 0, 900000); \
                     INSERT INTO project_outputs (project_id, kind, blob_hash, size, compiled_by, compiled_at, main_file) VALUES \
                       ('p1', 'pdf', 'h1', 200000, '{ada}', 1, 'main.tex'), \
                       ('p3', 'pdf', 'h2', 50000, '{bo}', 1, 'main.tex');"
                ))?;
                let storage = Storage {
                    owner: ada,
                    by: bo,
                    limit_mb: 1,
                };
                Ok((
                    account_bytes(conn, ada)?,
                    account_bytes(conn, bo)?,
                    storage.refusal(conn, 100_000, 0)?,
                    storage.refusal(conn, 48_576, 0)?,
                    storage.refusal(conn, 248_576, 200_000)?,
                ))
            })
            .await
            .unwrap();
        assert_eq!(used, 1_000_000);
        assert_eq!(other, 950_000);
        let refusal = refusal.expect("the account is full");
        assert_eq!(refusal.code(), "account_storage_full");
        assert_eq!(refusal.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert!(refusal.public_message().contains("owner"));
        assert_eq!(fits, None);
        assert_eq!(freed, None);
    }

    #[tokio::test]
    async fn only_pending_and_active_projects_count_toward_the_project_limit() {
        let db = Db::open_in_memory().unwrap();
        let (two, three, none) = db
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                conn.execute_batch(&format!(
                    "INSERT INTO projects (id, owner_account, title, status, created_at) VALUES \
                       ('p1', '{ada}', 'One', 'active', 1), \
                       ('p2', '{ada}', 'Two', 'pending', 1), \
                       ('p3', '{ada}', 'Three', 'archived', 1);"
                ))?;
                Ok((
                    may_create_project(conn, ada, Some(2)).map_err(|e| e.code()),
                    may_create_project(conn, ada, Some(3)).map_err(|e| e.code()),
                    may_create_project(conn, ada, None).map_err(|e| e.code()),
                ))
            })
            .await
            .unwrap();
        assert_eq!(two, Err("too_many_projects"));
        assert_eq!(three, Ok(()));
        assert_eq!(none, Ok(()));
    }
}
