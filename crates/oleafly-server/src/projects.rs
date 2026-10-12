use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::ids::{AccountId, BatchId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectDevice, ProjectMember, ProjectPatch, ProjectRole, ProjectStatus,
    ProjectSummary,
};
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::parse_id;
use crate::error::ServerError;
use crate::members;

pub const DIRECTORY_LIMIT: usize = 20;
pub const BACKLOG_LIMIT: usize = 2_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectRow {
    pub id: SharedProjectId,
    pub owner: AccountId,
    pub title: String,
    pub status: ProjectStatus,
    pub created_at: i64,
    pub link_sharing: bool,
    pub link_role: ProjectRole,
    pub head_seq: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredUpdate {
    pub seq: u64,
    pub account: AccountId,
    pub envelope: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Appended {
    pub seq: u64,
    pub duplicate: bool,
}

pub fn role_to_str(role: ProjectRole) -> &'static str {
    match role {
        ProjectRole::Owner => "owner",
        ProjectRole::Editor => "editor",
        ProjectRole::Viewer => "viewer",
    }
}

pub fn role_from_str(text: &str) -> Result<ProjectRole, ServerError> {
    match text {
        "owner" => Ok(ProjectRole::Owner),
        "editor" => Ok(ProjectRole::Editor),
        "viewer" => Ok(ProjectRole::Viewer),
        other => Err(ServerError::Internal(format!(
            "unknown project role {other}"
        ))),
    }
}

fn status_from_str(text: &str) -> Result<ProjectStatus, ServerError> {
    match text {
        "pending" => Ok(ProjectStatus::Pending),
        "active" => Ok(ProjectStatus::Active),
        "archived" => Ok(ProjectStatus::Archived),
        other => Err(ServerError::Internal(format!(
            "unknown project status {other}"
        ))),
    }
}

fn seq_from(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn seq_to(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

pub fn create_pending(
    conn: &Connection,
    owner: AccountId,
    title: &str,
    now: i64,
) -> Result<SharedProjectId, ServerError> {
    let id = SharedProjectId::new_v7();
    conn.execute(
        "INSERT INTO projects (id, owner_account, title, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)",
        params![id.to_string(), owner.to_string(), title, now],
    )?;
    conn.execute(
        "INSERT INTO project_grants (project_id, account_id, role, granted_at, granted_by) VALUES (?1, ?2, 'owner', ?3, ?2)",
        params![id.to_string(), owner.to_string(), now],
    )?;
    Ok(id)
}

pub fn project_row(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Option<ProjectRow>, ServerError> {
    let row = conn
        .query_row(
            "SELECT owner_account, title, status, created_at, link_sharing, link_role, head_seq FROM projects WHERE id = ?1",
            [project.to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((owner, title, status, created_at, link_sharing, link_role, head_seq)) = row else {
        return Ok(None);
    };
    Ok(Some(ProjectRow {
        id: project,
        owner: parse_id(&owner)?,
        title,
        status: status_from_str(&status)?,
        created_at,
        link_sharing: link_sharing != 0,
        link_role: role_from_str(&link_role)?,
        head_seq: seq_from(head_seq),
    }))
}

pub fn role_of(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<Option<ProjectRole>, ServerError> {
    let role = conn
        .query_row(
            "SELECT role FROM project_grants WHERE project_id = ?1 AND account_id = ?2",
            [project.to_string(), account.to_string()],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    role.map(|role| role_from_str(&role)).transpose()
}

pub fn person(
    conn: &Connection,
    account: AccountId,
    include_email: bool,
) -> Result<Option<PersonSummary>, ServerError> {
    let Some(summary) = members::account_summary(conn, account)? else {
        return Ok(None);
    };
    Ok(Some(PersonSummary {
        account_id: summary.account_id,
        display_name: summary.display_name,
        avatar_url: summary.avatar_url,
        email: include_email
            .then(|| summary.emails.first().cloned())
            .flatten(),
        login: summary.logins.first().cloned(),
    }))
}

pub fn summary(
    conn: &Connection,
    row: &ProjectRow,
    role: ProjectRole,
) -> Result<ProjectSummary, ServerError> {
    let owner = person(conn, row.owner, false)?.ok_or(ServerError::NotFound)?;
    Ok(ProjectSummary {
        project_id: row.id,
        title: row.title.clone(),
        owner,
        role,
        status: row.status,
        created_at: row.created_at,
        link_sharing: row.link_sharing,
        link_role: row.link_role,
        head_seq: row.head_seq,
    })
}

pub fn list_for_account(
    conn: &Connection,
    account: AccountId,
) -> Result<Vec<ProjectSummary>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT g.project_id, g.role FROM project_grants g JOIN projects p ON p.id = g.project_id \
         WHERE g.account_id = ?1 AND p.status = 'active' ORDER BY p.created_at, p.id",
    )?;
    let rows = statement
        .query_map([account.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut summaries = Vec::with_capacity(rows.len());
    for (project, role) in rows {
        let project: SharedProjectId = parse_id(&project)?;
        if let Some(row) = project_row(conn, project)? {
            summaries.push(summary(conn, &row, role_from_str(&role)?)?);
        }
    }
    Ok(summaries)
}

pub fn set_status(
    conn: &Connection,
    project: SharedProjectId,
    status: ProjectStatus,
    now: i64,
) -> Result<(), ServerError> {
    let (text, column) = match status {
        ProjectStatus::Active => ("active", "committed_at"),
        ProjectStatus::Archived => ("archived", "archived_at"),
        ProjectStatus::Pending | ProjectStatus::Unknown => {
            return Err(ServerError::Internal(
                "a project cannot go back to pending".to_string(),
            ))
        }
    };
    conn.execute(
        &format!("UPDATE projects SET status = ?2, {column} = ?3 WHERE id = ?1"),
        params![project.to_string(), text, now],
    )?;
    Ok(())
}

pub fn apply_patch(
    conn: &Connection,
    project: SharedProjectId,
    patch: &ProjectPatch,
) -> Result<(), ServerError> {
    if let Some(title) = &patch.title {
        conn.execute(
            "UPDATE projects SET title = ?2 WHERE id = ?1",
            params![project.to_string(), title],
        )?;
    }
    if let Some(link_sharing) = patch.link_sharing {
        conn.execute(
            "UPDATE projects SET link_sharing = ?2 WHERE id = ?1",
            params![project.to_string(), i64::from(link_sharing)],
        )?;
    }
    if let Some(role) = patch.link_role {
        conn.execute(
            "UPDATE projects SET link_role = ?2 WHERE id = ?1",
            params![project.to_string(), role_to_str(role)],
        )?;
    }
    Ok(())
}

pub fn members(
    conn: &Connection,
    project: SharedProjectId,
    include_email: bool,
) -> Result<Vec<ProjectMember>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT account_id, role, granted_at FROM project_grants WHERE project_id = ?1 \
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, granted_at",
    )?;
    let rows = statement
        .query_map([project.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut list = Vec::with_capacity(rows.len());
    for (account, role, granted_at) in rows {
        let account: AccountId = parse_id(&account)?;
        if let Some(person) = person(conn, account, include_email)? {
            list.push(ProjectMember {
                person,
                role: role_from_str(&role)?,
                granted_at,
            });
        }
    }
    Ok(list)
}

pub fn member_count(conn: &Connection, project: SharedProjectId) -> Result<u32, ServerError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_grants WHERE project_id = ?1",
        [project.to_string()],
        |row| row.get(0),
    )?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

pub fn grant(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
    role: ProjectRole,
    by: AccountId,
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO project_grants (project_id, account_id, role, granted_at, granted_by) VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role",
        params![
            project.to_string(),
            account.to_string(),
            role_to_str(role),
            now,
            by.to_string()
        ],
    )?;
    Ok(())
}

pub fn revoke(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<bool, ServerError> {
    Ok(conn.execute(
        "DELETE FROM project_grants WHERE project_id = ?1 AND account_id = ?2",
        [project.to_string(), account.to_string()],
    )? > 0)
}

pub fn account_can_join(conn: &Connection, account: AccountId) -> Result<bool, ServerError> {
    let active = matches!(
        members::account_status(conn, account)?,
        Some(MemberStatus::Active)
    );
    let role = members::account_role(conn, account)?;
    Ok(active
        && !matches!(
            role,
            Some(oleafly_collab_protocol::roles::ServerRole::Guest) | None
        ))
}

pub fn add_blob(
    conn: &Connection,
    project: SharedProjectId,
    hash: &str,
    size: u64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT OR IGNORE INTO project_blobs (project_id, hash, size) VALUES (?1, ?2, ?3)",
        params![
            project.to_string(),
            hash,
            i64::try_from(size).unwrap_or(i64::MAX)
        ],
    )?;
    Ok(())
}

pub fn has_blob(
    conn: &Connection,
    project: SharedProjectId,
    hash: &str,
) -> Result<bool, ServerError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM project_blobs WHERE project_id = ?1 AND hash = ?2",
            [project.to_string(), hash.to_string()],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn append_update(
    conn: &mut Connection,
    project: SharedProjectId,
    batch: BatchId,
    device: DeviceId,
    account: AccountId,
    envelope: &[u8],
    now: i64,
) -> Result<Appended, ServerError> {
    let transaction = conn.transaction()?;
    let existing = transaction
        .query_row(
            "SELECT seq FROM project_updates WHERE project_id = ?1 AND batch_id = ?2",
            [project.to_string(), batch.to_string()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if let Some(seq) = existing {
        return Ok(Appended {
            seq: seq_from(seq),
            duplicate: true,
        });
    }
    let head: i64 = transaction.query_row(
        "SELECT head_seq FROM projects WHERE id = ?1",
        [project.to_string()],
        |row| row.get(0),
    )?;
    let seq = head + 1;
    transaction.execute(
        "INSERT INTO project_updates (project_id, seq, batch_id, device_id, account_id, envelope, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            project.to_string(),
            seq,
            batch.to_string(),
            device.to_string(),
            account.to_string(),
            envelope,
            now
        ],
    )?;
    transaction.execute(
        "UPDATE projects SET head_seq = ?2 WHERE id = ?1",
        params![project.to_string(), seq],
    )?;
    transaction.commit()?;
    Ok(Appended {
        seq: seq_from(seq),
        duplicate: false,
    })
}

pub fn updates_since(
    conn: &Connection,
    project: SharedProjectId,
    since: u64,
) -> Result<Vec<StoredUpdate>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT seq, account_id, envelope FROM project_updates WHERE project_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
    )?;
    let rows = statement
        .query_map(
            params![
                project.to_string(),
                seq_to(since),
                i64::try_from(BACKLOG_LIMIT).unwrap_or(i64::MAX)
            ],
            |row| {
                Ok((
                    seq_from(row.get::<_, i64>(0)?),
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(seq, account, envelope)| {
            Ok(StoredUpdate {
                seq,
                account: parse_id(&account)?,
                envelope,
            })
        })
        .collect()
}

pub fn devices(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<ProjectDevice>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT d.id, d.account_id, d.public_key, d.created_at FROM devices d \
         WHERE (d.revoked_at IS NULL AND d.account_id IN \
                (SELECT account_id FROM project_grants WHERE project_id = ?1)) \
            OR d.id IN (SELECT device_id FROM project_updates WHERE project_id = ?1) \
         ORDER BY d.created_at, d.id",
    )?;
    let rows = statement
        .query_map([project.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(device, account, public_key, added_at)| {
            Ok(ProjectDevice {
                device_id: parse_id(&device)?,
                account_id: parse_id(&account)?,
                public_key,
                added_at,
            })
        })
        .collect()
}

pub fn oldest_kept_update(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Option<u64>, ServerError> {
    let oldest: Option<i64> = conn.query_row(
        "SELECT MIN(seq) FROM project_updates WHERE project_id = ?1",
        [project.to_string()],
        |row| row.get(0),
    )?;
    Ok(oldest.map(seq_from))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotRow {
    pub seq: u64,
    pub file: String,
}

pub fn latest_snapshot(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Option<SnapshotRow>, ServerError> {
    Ok(conn
        .query_row(
            "SELECT seq, file FROM project_snapshots WHERE project_id = ?1 ORDER BY seq DESC LIMIT 1",
            [project.to_string()],
            |row| {
                Ok(SnapshotRow {
                    seq: seq_from(row.get::<_, i64>(0)?),
                    file: row.get::<_, String>(1)?,
                })
            },
        )
        .optional()?)
}

pub fn record_snapshot(
    conn: &mut Connection,
    project: SharedProjectId,
    seq: u64,
    file: &str,
    size: u64,
    by: AccountId,
    now: i64,
) -> Result<Vec<String>, ServerError> {
    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT INTO project_snapshots (project_id, seq, file, size, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (project_id, seq) DO UPDATE SET file = excluded.file, size = excluded.size, created_at = excluded.created_at, created_by = excluded.created_by",
        params![
            project.to_string(),
            seq_to(seq),
            file,
            i64::try_from(size).unwrap_or(i64::MAX),
            now,
            by.to_string()
        ],
    )?;
    let kept: Vec<(i64, String)> = {
        let mut statement = transaction.prepare(
            "SELECT seq, file FROM project_snapshots WHERE project_id = ?1 ORDER BY seq DESC",
        )?;
        let rows = statement
            .query_map([project.to_string()], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let mut dropped = Vec::new();
    for (old_seq, old_file) in kept.iter().skip(2) {
        transaction.execute(
            "DELETE FROM project_snapshots WHERE project_id = ?1 AND seq = ?2",
            params![project.to_string(), old_seq],
        )?;
        if old_file != file {
            dropped.push(old_file.clone());
        }
    }
    if let Some((floor, _)) = kept.get(1) {
        transaction.execute(
            "DELETE FROM project_updates WHERE project_id = ?1 AND seq <= ?2",
            params![project.to_string(), floor],
        )?;
    }
    transaction.commit()?;
    Ok(dropped)
}

pub fn directory(
    conn: &Connection,
    query: &str,
    include_email: bool,
    exclude: AccountId,
) -> Result<Vec<PersonSummary>, ServerError> {
    let needle = query.trim().to_lowercase();
    let mut statement = conn.prepare(
        "SELECT id FROM accounts WHERE status = 'active' AND server_role != 'guest' AND id != ?1 ORDER BY display_name, id",
    )?;
    let ids = statement
        .query_map([exclude.to_string()], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut found = Vec::new();
    for id in ids {
        let account: AccountId = parse_id(&id)?;
        let Some(summary) = members::account_summary(conn, account)? else {
            continue;
        };
        let matches = needle.is_empty()
            || summary.display_name.to_lowercase().contains(&needle)
            || summary
                .logins
                .iter()
                .any(|login| login.to_lowercase().contains(&needle))
            || (include_email
                && summary
                    .emails
                    .iter()
                    .any(|email| email.to_lowercase().contains(&needle)));
        if !matches {
            continue;
        }
        found.push(PersonSummary {
            account_id: summary.account_id,
            display_name: summary.display_name,
            avatar_url: summary.avatar_url,
            email: include_email
                .then(|| summary.emails.first().cloned())
                .flatten(),
            login: summary.logins.first().cloned(),
        });
        if found.len() >= DIRECTORY_LIMIT {
            break;
        }
    }
    Ok(found)
}

pub fn exact_email(
    conn: &Connection,
    query: &str,
    exclude: AccountId,
) -> Result<Vec<PersonSummary>, ServerError> {
    let Some(email) = members::normalize_email(query) else {
        return Ok(Vec::new());
    };
    let account = conn
        .query_row(
            "SELECT e.account_id FROM account_emails e JOIN accounts a ON a.id = e.account_id \
             WHERE e.email = ?1 AND a.status = 'active' AND a.server_role != 'guest' AND a.id != ?2",
            [email.clone(), exclude.to_string()],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(account) = account else {
        return Ok(Vec::new());
    };
    let account: AccountId = parse_id(&account)?;
    Ok(person(conn, account, false)?
        .map(|found| PersonSummary {
            email: Some(email),
            ..found
        })
        .into_iter()
        .collect())
}

pub fn expired_projects(
    conn: &Connection,
    pending_before: i64,
    archived_before: i64,
) -> Result<Vec<SharedProjectId>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT id FROM projects WHERE (status = 'pending' AND created_at < ?1) OR (status = 'archived' AND archived_at < ?2)",
    )?;
    let ids = statement
        .query_map(params![pending_before, archived_before], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter().map(|id| parse_id(id)).collect()
}

pub struct Deleted {
    pub snapshot_files: Vec<String>,
    pub orphan_blobs: Vec<String>,
}

pub fn delete_project(
    conn: &mut Connection,
    project: SharedProjectId,
) -> Result<Deleted, ServerError> {
    let transaction = conn.transaction()?;
    let snapshot_files = {
        let mut statement =
            transaction.prepare("SELECT file FROM project_snapshots WHERE project_id = ?1")?;
        let rows = statement
            .query_map([project.to_string()], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let hashes = {
        let mut statement =
            transaction.prepare("SELECT hash FROM project_blobs WHERE project_id = ?1")?;
        let rows = statement
            .query_map([project.to_string()], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    transaction.execute("DELETE FROM projects WHERE id = ?1", [project.to_string()])?;
    let mut orphan_blobs = Vec::new();
    for hash in hashes {
        let still_used = transaction
            .query_row(
                "SELECT 1 FROM project_blobs WHERE hash = ?1 LIMIT 1",
                [&hash],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !still_used {
            orphan_blobs.push(hash);
        }
    }
    transaction.commit()?;
    Ok(Deleted {
        snapshot_files,
        orphan_blobs,
    })
}
