use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::ids::{AccountId, BatchId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    PersonSummary, ProjectDevice, ProjectMember, ProjectPatch, ProjectRole, ProjectStatus,
    ProjectSummary,
};
use rusqlite::{params, Connection, OptionalExtension};

use crate::blobs::snapshot_key;
use crate::db::parse_id;
use crate::error::ServerError;
use crate::members;

pub const DIRECTORY_LIMIT: usize = 20;
pub const BACKLOG_LIMIT: usize = 2_000;
pub const BACKLOG_BYTES: usize = 4 * 1024 * 1024;

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
    pub comments_enabled: bool,
    pub access_log: bool,
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

impl Appended {
    // A change made only of operations the server already holds is
    // acknowledged with seq 0 and never stored, so it can't be logged twice.
    pub fn nothing_new() -> Appended {
        Appended {
            seq: 0,
            duplicate: true,
        }
    }
}

pub fn role_to_str(role: ProjectRole) -> &'static str {
    debug_assert_ne!(
        role,
        ProjectRole::Unknown,
        "a role this server does not know is never stored"
    );
    match role {
        ProjectRole::Owner => "owner",
        ProjectRole::Editor => "editor",
        ProjectRole::Viewer => "viewer",
        ProjectRole::Unknown => "unknown",
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

// A savepoint works whether or not the caller already holds a transaction,
// and undoes every statement of `work` if one of them fails.
fn all_or_nothing<T>(
    conn: &Connection,
    name: &str,
    work: impl FnOnce(&Connection) -> Result<T, ServerError>,
) -> Result<T, ServerError> {
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;
    match work(conn) {
        Ok(value) => {
            conn.execute_batch(&format!("RELEASE {name}"))?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"));
            Err(error)
        }
    }
}

pub fn create_pending(
    conn: &Connection,
    owner: AccountId,
    title: &str,
    now: i64,
) -> Result<SharedProjectId, ServerError> {
    all_or_nothing(conn, "create_project", |conn| {
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
    })
}

pub fn project_row(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Option<ProjectRow>, ServerError> {
    let row = conn
        .query_row(
            "SELECT owner_account, title, status, created_at, link_sharing, link_role, head_seq, comments_enabled, access_log FROM projects WHERE id = ?1",
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
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        owner,
        title,
        status,
        created_at,
        link_sharing,
        link_role,
        head_seq,
        comments,
        access_log,
    )) = row
    else {
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
        comments_enabled: comments != 0,
        access_log: access_log != 0,
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
        guest: summary.server_role == oleafly_collab_protocol::roles::ServerRole::Guest,
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
        comments_enabled: row.comments_enabled,
        access_log: row.access_log,
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
    if patch.link_role == Some(ProjectRole::Unknown) {
        return Err(ServerError::BadRequest(
            "A link can give Editor or Viewer access.".to_string(),
        ));
    }
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
    if let Some(comments) = patch.comments_enabled {
        conn.execute(
            "UPDATE projects SET comments_enabled = ?2 WHERE id = ?1",
            params![project.to_string(), i64::from(comments)],
        )?;
    }
    if let Some(access_log) = patch.access_log {
        conn.execute(
            "UPDATE projects SET access_log = ?2 WHERE id = ?1",
            params![project.to_string(), i64::from(access_log)],
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
    if role == ProjectRole::Unknown {
        return Err(ServerError::BadRequest(
            "This server doesn't know that role.".to_string(),
        ));
    }
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

pub fn account_is_active(conn: &Connection, account: AccountId) -> Result<bool, ServerError> {
    Ok(matches!(
        members::account_status(conn, account)?,
        Some(MemberStatus::Active)
    ))
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
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO project_blobs (project_id, hash, size, used_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (project_id, hash) DO UPDATE SET used_at = MAX(used_at, excluded.used_at)",
        params![
            project.to_string(),
            hash,
            i64::try_from(size).unwrap_or(i64::MAX),
            now
        ],
    )?;
    finish_removal(conn, Removal::File, None, hash)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Removal {
    File,
    Snapshot,
}

impl Removal {
    fn as_str(self) -> &'static str {
        match self {
            Removal::File => "file",
            Removal::Snapshot => "snapshot",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingRemoval {
    pub kind: Removal,
    pub project: Option<SharedProjectId>,
    pub hash: String,
}

fn removal_project(project: Option<SharedProjectId>) -> String {
    project
        .map(|project| project.to_string())
        .unwrap_or_default()
}

pub fn queue_removal(
    conn: &Connection,
    kind: Removal,
    project: Option<SharedProjectId>,
    hash: &str,
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO pending_removals (kind, project_id, hash, queued_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (kind, project_id, hash) DO NOTHING",
        params![kind.as_str(), removal_project(project), hash, now],
    )?;
    Ok(())
}

pub fn finish_removal(
    conn: &Connection,
    kind: Removal,
    project: Option<SharedProjectId>,
    hash: &str,
) -> Result<(), ServerError> {
    conn.execute(
        "DELETE FROM pending_removals WHERE kind = ?1 AND project_id = ?2 AND hash = ?3",
        params![kind.as_str(), removal_project(project), hash],
    )?;
    Ok(())
}

pub fn removal_failed(
    conn: &Connection,
    kind: Removal,
    project: Option<SharedProjectId>,
    hash: &str,
) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE pending_removals SET attempts = attempts + 1 WHERE kind = ?1 AND project_id = ?2 AND hash = ?3",
        params![kind.as_str(), removal_project(project), hash],
    )?;
    Ok(())
}

pub fn pending_removals(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<PendingRemoval>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT kind, project_id, hash FROM pending_removals ORDER BY attempts, queued_at LIMIT ?1",
    )?;
    let rows = statement
        .query_map([i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut pending = Vec::with_capacity(rows.len());
    for (kind, project, hash) in rows {
        let kind = match kind.as_str() {
            "file" => Removal::File,
            _ => Removal::Snapshot,
        };
        let project = if project.is_empty() {
            None
        } else {
            Some(parse_id(&project)?)
        };
        pending.push(PendingRemoval {
            kind,
            project,
            hash,
        });
    }
    Ok(pending)
}

pub fn blob_in_use(conn: &Connection, hash: &str) -> Result<bool, ServerError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM project_blobs WHERE hash = ?1 LIMIT 1",
            [hash],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn blobs_unused_since(
    conn: &Connection,
    used_before: i64,
) -> Result<Vec<(SharedProjectId, String)>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT b.project_id, b.hash FROM project_blobs b JOIN projects p ON p.id = b.project_id \
         WHERE p.status = 'active' AND b.used_at < ?1 ORDER BY b.project_id, b.hash",
    )?;
    let rows = statement
        .query_map([used_before], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(project, hash)| Ok((parse_id(&project)?, hash)))
        .collect()
}

pub fn blobs_used(
    conn: &Connection,
    project: SharedProjectId,
    hashes: &[String],
    now: i64,
) -> Result<(), ServerError> {
    let mut statement = conn.prepare_cached(
        "UPDATE project_blobs SET used_at = MAX(used_at, ?3) WHERE project_id = ?1 AND hash = ?2",
    )?;
    for hash in hashes {
        statement.execute(params![project.to_string(), hash, now])?;
    }
    Ok(())
}

pub fn drop_unused_blob(
    conn: &mut Connection,
    project: SharedProjectId,
    hash: &str,
    used_before: i64,
    now: i64,
) -> Result<bool, ServerError> {
    let transaction = conn.transaction()?;
    let dropped = transaction.execute(
        "DELETE FROM project_blobs WHERE project_id = ?1 AND hash = ?2 AND used_at < ?3",
        params![project.to_string(), hash, used_before],
    )? > 0;
    let orphan = dropped && !blob_in_use(&transaction, hash)?;
    if orphan {
        queue_removal(&transaction, Removal::File, None, hash, now)?;
    }
    transaction.commit()?;
    Ok(orphan)
}

// What a project keeps on this server: its files and its change log.
// Snapshots are left out because they are rebuilt from those.
pub fn stored_bytes(conn: &Connection, project: SharedProjectId) -> Result<u64, ServerError> {
    let bytes: i64 = conn.query_row(
        "SELECT (SELECT COALESCE(SUM(size), 0) FROM project_blobs WHERE project_id = ?1) \
         + (SELECT COALESCE(SUM(length(envelope)), 0) FROM project_updates WHERE project_id = ?1)",
        [project.to_string()],
        |row| row.get(0),
    )?;
    Ok(seq_from(bytes))
}

pub fn too_large_for(limit_mb: u64) -> ServerError {
    ServerError::Refused {
        status: axum::http::StatusCode::PAYLOAD_TOO_LARGE,
        code: "project_too_large",
        message: format!(
            "This project has reached this server's size limit of {limit_mb} MB. Ask the admin to raise OLEAFLY_MAX_PROJECT_MB."
        ),
    }
}

pub fn blob_size(
    conn: &Connection,
    project: SharedProjectId,
    hash: &str,
) -> Result<Option<u64>, ServerError> {
    Ok(conn
        .query_row(
            "SELECT size FROM project_blobs WHERE project_id = ?1 AND hash = ?2",
            [project.to_string(), hash.to_string()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(seq_from))
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
    let appended = append_update_in(&transaction, project, batch, device, account, envelope, now)?;
    transaction.commit()?;
    Ok(appended)
}

pub fn stored_batch(
    conn: &Connection,
    project: SharedProjectId,
    batch: BatchId,
) -> Result<Option<u64>, ServerError> {
    Ok(conn
        .query_row(
            "SELECT seq FROM project_updates WHERE project_id = ?1 AND batch_id = ?2",
            [project.to_string(), batch.to_string()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(seq_from))
}

pub fn append_update_in(
    transaction: &Connection,
    project: SharedProjectId,
    batch: BatchId,
    device: DeviceId,
    account: AccountId,
    envelope: &[u8],
    now: i64,
) -> Result<Appended, ServerError> {
    if let Some(seq) = stored_batch(transaction, project, batch)? {
        return Ok(Appended {
            seq,
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
    Ok(Appended {
        seq: seq_from(seq),
        duplicate: false,
    })
}

fn page_end(
    conn: &Connection,
    project: SharedProjectId,
    after: u64,
    through: u64,
    budget: usize,
) -> Result<Option<u64>, ServerError> {
    let mut statement = conn.prepare_cached(
        "SELECT seq, length(envelope) FROM project_updates WHERE project_id = ?1 AND seq > ?2 AND seq <= ?3 ORDER BY seq LIMIT ?4",
    )?;
    let mut rows = statement.query(params![
        project.to_string(),
        seq_to(after),
        seq_to(through),
        i64::try_from(BACKLOG_LIMIT).unwrap_or(i64::MAX)
    ])?;
    let mut end = None;
    let mut held = 0usize;
    while let Some(row) = rows.next()? {
        if end.is_some() && held >= budget {
            break;
        }
        end = Some(seq_from(row.get::<_, i64>(0)?));
        held = held.saturating_add(usize::try_from(row.get::<_, i64>(1)?).unwrap_or(usize::MAX));
    }
    Ok(end)
}

pub fn page_is_full(sizes: impl IntoIterator<Item = usize>) -> bool {
    let (count, bytes) = sizes
        .into_iter()
        .fold((0usize, 0usize), |(count, bytes), size| {
            (count + 1, bytes.saturating_add(size))
        });
    count >= BACKLOG_LIMIT || bytes >= BACKLOG_BYTES
}

pub fn updates_since(
    conn: &Connection,
    project: SharedProjectId,
    since: u64,
) -> Result<Vec<StoredUpdate>, ServerError> {
    let Some(end) = page_end(conn, project, since, u64::MAX, BACKLOG_BYTES)? else {
        return Ok(Vec::new());
    };
    let mut statement = conn.prepare_cached(
        "SELECT seq, account_id, envelope FROM project_updates WHERE project_id = ?1 AND seq > ?2 AND seq <= ?3 ORDER BY seq",
    )?;
    let rows = statement
        .query_map(
            params![project.to_string(), seq_to(since), seq_to(end)],
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
            OR d.id IN (SELECT signed_by FROM project_snapshots WHERE project_id = ?1 AND signed_by IS NOT NULL) \
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
    pub hash: Option<String>,
}

impl SnapshotRow {
    pub fn in_blob_store(&self, project: SharedProjectId) -> bool {
        self.hash
            .as_deref()
            .is_some_and(|hash| self.file == snapshot_key(project, hash))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedSnapshot {
    pub replaced: Option<SnapshotRow>,
}

const SNAPSHOT_COLUMNS: &str = "SELECT seq, file, hash FROM project_snapshots";

fn snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SnapshotRow> {
    Ok(SnapshotRow {
        seq: seq_from(row.get::<_, i64>(0)?),
        file: row.get::<_, String>(1)?,
        hash: row.get::<_, Option<String>>(2)?,
    })
}

pub fn latest_snapshot(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Option<SnapshotRow>, ServerError> {
    Ok(conn
        .query_row(
            &format!("{SNAPSHOT_COLUMNS} WHERE project_id = ?1 ORDER BY seq DESC LIMIT 1"),
            [project.to_string()],
            snapshot_row,
        )
        .optional()?)
}

pub fn snapshots(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<SnapshotRow>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "{SNAPSHOT_COLUMNS} WHERE project_id = ?1 ORDER BY seq DESC"
    ))?;
    let rows = statement
        .query_map([project.to_string()], snapshot_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn covered_by_log(row: &SnapshotRow, head: u64, oldest: Option<u64>) -> bool {
    row.seq >= head || oldest.is_some_and(|oldest| oldest <= row.seq.saturating_add(1))
}

fn log_bounds(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<(u64, Option<u64>), ServerError> {
    let head = project_row(conn, project)?.map_or(0, |row| row.head_seq);
    Ok((head, oldest_kept_update(conn, project)?))
}

pub fn readable_snapshots(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<SnapshotRow>, ServerError> {
    let (head, oldest) = log_bounds(conn, project)?;
    Ok(snapshots(conn, project)?
        .into_iter()
        .enumerate()
        .filter(|(index, row)| *index == 0 || covered_by_log(row, head, oldest))
        .map(|(_, row)| row)
        .collect())
}

pub fn superseded_snapshots(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<SnapshotRow>, ServerError> {
    let (head, oldest) = log_bounds(conn, project)?;
    Ok(snapshots(conn, project)?
        .into_iter()
        .skip(2)
        .filter(|row| !covered_by_log(row, head, oldest))
        .collect())
}

pub fn projects_with_superseded_snapshots(
    conn: &Connection,
) -> Result<Vec<SharedProjectId>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT project_id FROM project_snapshots GROUP BY project_id HAVING COUNT(*) > 2 ORDER BY project_id",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter().map(|id| parse_id(id)).collect()
}

pub fn forget_snapshot(
    conn: &mut Connection,
    project: SharedProjectId,
    row: &SnapshotRow,
    now: i64,
) -> Result<bool, ServerError> {
    let transaction = conn.transaction()?;
    transaction.execute(
        "DELETE FROM project_snapshots WHERE project_id = ?1 AND seq = ?2",
        params![project.to_string(), seq_to(row.seq)],
    )?;
    let queued = match &row.hash {
        Some(hash) if !snapshot_hash_in_use(&transaction, project, hash)? => {
            queue_removal(&transaction, Removal::Snapshot, Some(project), hash, now)?;
            true
        }
        _ => false,
    };
    transaction.commit()?;
    Ok(queued)
}

pub fn snapshot_hash_in_use(
    conn: &Connection,
    project: SharedProjectId,
    hash: &str,
) -> Result<bool, ServerError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM project_snapshots WHERE project_id = ?1 AND hash = ?2 LIMIT 1",
            [project.to_string(), hash.to_string()],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub fn record_snapshot(
    conn: &mut Connection,
    project: SharedProjectId,
    seq: u64,
    hash: &str,
    size: u64,
    by: AccountId,
    now: i64,
) -> Result<RecordedSnapshot, ServerError> {
    let transaction = conn.transaction()?;
    let file = snapshot_key(project, hash);
    let replaced = transaction
        .query_row(
            &format!("{SNAPSHOT_COLUMNS} WHERE project_id = ?1 AND seq = ?2"),
            params![project.to_string(), seq_to(seq)],
            snapshot_row,
        )
        .optional()?
        .filter(|old| old.hash.as_deref() != Some(hash) || old.file != file);
    transaction.execute(
        "INSERT INTO project_snapshots (project_id, seq, file, size, created_at, created_by, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT (project_id, seq) DO UPDATE SET file = excluded.file, size = excluded.size, created_at = excluded.created_at, created_by = excluded.created_by, hash = excluded.hash",
        params![
            project.to_string(),
            seq_to(seq),
            file,
            i64::try_from(size).unwrap_or(i64::MAX),
            now,
            by.to_string(),
            hash
        ],
    )?;
    finish_removal(&transaction, Removal::Snapshot, Some(project), hash)?;
    if let Some(old_hash) = replaced.as_ref().and_then(|old| old.hash.as_deref()) {
        if !snapshot_hash_in_use(&transaction, project, old_hash)? {
            queue_removal(
                &transaction,
                Removal::Snapshot,
                Some(project),
                old_hash,
                now,
            )?;
        }
    }
    transaction.commit()?;
    Ok(RecordedSnapshot { replaced })
}

pub fn set_snapshot_signature(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
    signed: Option<(DeviceId, &str)>,
) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE project_snapshots SET signed_by = ?3, signature = ?4 WHERE project_id = ?1 AND seq = ?2",
        params![
            project.to_string(),
            seq_to(seq),
            signed.map(|(device, _)| device.to_string()),
            signed.map(|(_, signature)| signature.to_string())
        ],
    )?;
    Ok(())
}

pub fn snapshot_signature(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
) -> Result<Option<(DeviceId, String)>, ServerError> {
    let found: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT signed_by, signature FROM project_snapshots WHERE project_id = ?1 AND seq = ?2",
            params![project.to_string(), seq_to(seq)],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match found {
        Some((Some(device), Some(signature))) => Ok(Some((parse_id(&device)?, signature))),
        _ => Ok(None),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoggedUpdate {
    pub seq: u64,
    pub device: DeviceId,
    pub envelope: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LogSpan {
    pub count: u64,
    pub bytes: u64,
}

pub fn log_span(
    conn: &Connection,
    project: SharedProjectId,
    after: u64,
    through: u64,
) -> Result<LogSpan, ServerError> {
    let (count, bytes) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(length(envelope)), 0) FROM project_updates WHERE project_id = ?1 AND seq > ?2 AND seq <= ?3",
        params![project.to_string(), seq_to(after), seq_to(through)],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    Ok(LogSpan {
        count: seq_from(count),
        bytes: seq_from(bytes),
    })
}

pub fn snapshot_size(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
) -> Result<Option<u64>, ServerError> {
    let size: Option<i64> = conn
        .query_row(
            "SELECT size FROM project_snapshots WHERE project_id = ?1 AND seq = ?2",
            params![project.to_string(), seq_to(seq)],
            |row| row.get(0),
        )
        .optional()?;
    Ok(size.map(seq_from))
}

pub fn logged_between(
    conn: &Connection,
    project: SharedProjectId,
    after: u64,
    through: u64,
) -> Result<Vec<LoggedUpdate>, ServerError> {
    let Some(end) = page_end(conn, project, after, through, BACKLOG_BYTES)? else {
        return Ok(Vec::new());
    };
    let mut statement = conn.prepare_cached(
        "SELECT seq, device_id, envelope FROM project_updates WHERE project_id = ?1 AND seq > ?2 AND seq <= ?3 ORDER BY seq",
    )?;
    let rows = statement
        .query_map(
            params![project.to_string(), seq_to(after), seq_to(end)],
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
        .map(|(seq, device, envelope)| {
            Ok(LoggedUpdate {
                seq,
                device: parse_id(&device)?,
                envelope,
            })
        })
        .collect()
}

pub fn readable_snapshots_before(
    conn: &Connection,
    project: SharedProjectId,
    before: u64,
) -> Result<Vec<SnapshotRow>, ServerError> {
    let (head, oldest) = log_bounds(conn, project)?;
    Ok(snapshots(conn, project)?
        .into_iter()
        .filter(|row| row.seq < before && covered_by_log(row, head, oldest))
        .collect())
}

pub fn compaction_floor(
    conn: &Connection,
    project: SharedProjectId,
    newest: u64,
    keep_updates: u64,
) -> Result<Option<(SnapshotRow, u64)>, ServerError> {
    let Some(limit) = newest.checked_sub(keep_updates.max(1)) else {
        return Ok(None);
    };
    Ok(conn
        .query_row(
            "SELECT seq, file, hash, size FROM project_snapshots WHERE project_id = ?1 AND seq <= ?2 ORDER BY seq DESC LIMIT 1",
            params![project.to_string(), seq_to(limit)],
            |row| Ok((snapshot_row(row)?, u64::try_from(row.get::<_, i64>(3)?).unwrap_or(0))),
        )
        .optional()?)
}

pub fn compact_updates(
    conn: &Connection,
    project: SharedProjectId,
    through: u64,
) -> Result<usize, ServerError> {
    Ok(conn.execute(
        "DELETE FROM project_updates WHERE project_id = ?1 AND seq <= ?2",
        params![project.to_string(), seq_to(through)],
    )?)
}

pub fn snapshots_to_move(
    conn: &Connection,
) -> Result<Vec<(SharedProjectId, SnapshotRow)>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT project_id, seq, file, hash FROM project_snapshots ORDER BY project_id, seq",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                SnapshotRow {
                    seq: seq_from(row.get::<_, i64>(1)?),
                    file: row.get::<_, String>(2)?,
                    hash: row.get::<_, Option<String>>(3)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut pending = Vec::new();
    for (project, row) in rows {
        let project: SharedProjectId = parse_id(&project)?;
        if !row.in_blob_store(project) {
            pending.push((project, row));
        }
    }
    Ok(pending)
}

pub fn project_ids(conn: &Connection) -> Result<Vec<SharedProjectId>, ServerError> {
    let mut statement = conn.prepare("SELECT id FROM projects ORDER BY id")?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter().map(|id| parse_id(id)).collect()
}

pub fn record_moved_hash(
    conn: &Connection,
    project: SharedProjectId,
    row: &SnapshotRow,
    hash: &str,
) -> Result<bool, ServerError> {
    Ok(conn.execute(
        "UPDATE project_snapshots SET hash = ?4 WHERE project_id = ?1 AND seq = ?2 AND file = ?3 AND hash IS NULL",
        params![project.to_string(), seq_to(row.seq), row.file, hash],
    )? > 0)
}

pub fn finish_moved_snapshot(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
    hash: &str,
) -> Result<bool, ServerError> {
    Ok(conn.execute(
        "UPDATE project_snapshots SET file = ?4 WHERE project_id = ?1 AND seq = ?2 AND hash = ?3",
        params![
            project.to_string(),
            seq_to(seq),
            hash,
            snapshot_key(project, hash)
        ],
    )? > 0)
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
            guest: false,
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
    pub snapshots: Vec<SnapshotRow>,
    pub orphan_blobs: Vec<String>,
}

pub fn delete_project(
    conn: &mut Connection,
    project: SharedProjectId,
    now: i64,
) -> Result<Deleted, ServerError> {
    let transaction = conn.transaction()?;
    let snapshots = snapshots(&transaction, project)?;
    let hashes = transaction
        .prepare("SELECT hash FROM project_blobs WHERE project_id = ?1")?
        .query_map([project.to_string()], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
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
            queue_removal(&transaction, Removal::File, None, &hash, now)?;
            orphan_blobs.push(hash);
        }
    }
    for row in &snapshots {
        if let Some(hash) = &row.hash {
            queue_removal(&transaction, Removal::Snapshot, Some(project), hash, now)?;
        }
    }
    transaction.commit()?;
    Ok(Deleted {
        snapshots,
        orphan_blobs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use oleafly_collab_protocol::roles::ServerRole;

    #[tokio::test]
    async fn a_role_this_server_does_not_know_is_never_written() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let owner = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let other = members::create_account(conn, "Bo", None, ServerRole::Member, 1)?;
                let project = create_pending(conn, owner, "Thesis", 1)?;
                assert!(matches!(
                    grant(conn, project, other, ProjectRole::Unknown, owner, 2),
                    Err(ServerError::BadRequest(_))
                ));
                assert_eq!(role_of(conn, project, other)?, None);
                let patch = ProjectPatch {
                    title: Some("Renamed".to_string()),
                    link_role: Some(ProjectRole::Unknown),
                    ..ProjectPatch::default()
                };
                assert!(matches!(
                    apply_patch(conn, project, &patch),
                    Err(ServerError::BadRequest(_))
                ));
                let row = project_row(conn, project)?.expect("the project");
                assert_eq!(row.title, "Thesis");
                assert_eq!(row.link_role, ProjectRole::Viewer);
                Ok(())
            })
            .await
            .unwrap();
    }
}
