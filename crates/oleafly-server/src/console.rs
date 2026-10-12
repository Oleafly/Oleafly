use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::PathBuf;

use oleafly_collab_protocol::console::{
    AdminProject, AdminProjectSort, FilesLocation, ServerCounts, SortOrder, StorageUsage,
};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::{PersonSummary, ProjectStatus};
use rusqlite::{params_from_iter, Connection, Statement};

use crate::db::parse_id;
use crate::error::ServerError;
use crate::projects;

const PROJECT_COLUMNS: &str = "SELECT p.id, p.title, p.status, p.owner_account, p.created_at, \
     MAX(p.created_at, COALESCE(p.committed_at, 0), COALESCE(p.archived_at, 0), \
         COALESCE((SELECT u.created_at FROM project_updates u WHERE u.project_id = p.id ORDER BY u.seq DESC LIMIT 1), 0), \
         COALESCE((SELECT MAX(s.created_at) FROM project_snapshots s WHERE s.project_id = p.id), 0)), \
     p.archived_at, \
     (SELECT COUNT(*) FROM project_grants g WHERE g.project_id = p.id), \
     (SELECT COALESCE(SUM(s.size), 0) FROM project_snapshots s WHERE s.project_id = p.id) \
       + (SELECT COALESCE(SUM(b.size), 0) FROM project_blobs b WHERE b.project_id = p.id) \
     FROM projects p";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectFilter {
    pub search: String,
    pub status: Option<ProjectStatus>,
    pub sort: AdminProjectSort,
    pub order: SortOrder,
}

fn count(conn: &Connection, sql: &str) -> Result<u32, ServerError> {
    let value: i64 = conn.query_row(sql, [], |row| row.get(0))?;
    Ok(u32::try_from(value).unwrap_or(u32::MAX))
}

fn bytes(conn: &Connection, sql: &str) -> Result<u64, ServerError> {
    let value: i64 = conn.query_row(sql, [], |row| row.get(0))?;
    Ok(u64::try_from(value).unwrap_or(0))
}

pub fn counts(conn: &Connection) -> Result<ServerCounts, ServerError> {
    let mut by_status: HashMap<String, u32> = HashMap::new();
    let mut statement = conn.prepare("SELECT status, COUNT(*) FROM projects GROUP BY status")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (status, total) in rows {
        by_status.insert(status, u32::try_from(total).unwrap_or(u32::MAX));
    }
    let of = |status: &str| by_status.get(status).copied().unwrap_or(0);
    Ok(ServerCounts {
        people: count(
            conn,
            "SELECT COUNT(*) FROM accounts WHERE status = 'active'",
        )?,
        suspended_people: count(
            conn,
            "SELECT COUNT(*) FROM accounts WHERE status = 'suspended'",
        )?,
        devices: count(
            conn,
            "SELECT COUNT(*) FROM devices d JOIN accounts a ON a.id = d.account_id \
             WHERE d.revoked_at IS NULL AND a.status = 'active'",
        )?,
        projects: of("active"),
        archived_projects: of("archived"),
        pending_projects: of("pending"),
        open_rooms: 0,
        people_online: 0,
    })
}

pub fn storage(conn: &Connection, location: FilesLocation) -> Result<StorageUsage, ServerError> {
    let pages = bytes(conn, "PRAGMA page_count")?;
    let page_size = bytes(conn, "PRAGMA page_size")?;
    Ok(StorageUsage {
        database_bytes: pages.saturating_mul(page_size),
        snapshot_bytes: bytes(
            conn,
            "SELECT COALESCE(SUM(size), 0) FROM project_snapshots",
        )?,
        file_bytes: bytes(
            conn,
            "SELECT COALESCE(SUM(size), 0) FROM (SELECT MAX(size) AS size FROM project_blobs GROUP BY hash)",
        )?,
        files_location: location,
    })
}

pub async fn data_dir_writable(dir: PathBuf) -> bool {
    tokio::task::spawn_blocking(move || {
        let probe = dir.join(format!(
            ".oleafly-write-check-{}",
            crate::tokens::random_token()
        ));
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .is_ok();
        if written {
            let _ = std::fs::remove_file(&probe);
        }
        written
    })
    .await
    .unwrap_or(false)
}

struct Record {
    project: AdminProject,
    size: u64,
}

fn owners(
    conn: &Connection,
    cache: &mut HashMap<AccountId, PersonSummary>,
    owner: AccountId,
) -> Result<PersonSummary, ServerError> {
    if let Some(person) = cache.get(&owner) {
        return Ok(person.clone());
    }
    let person = projects::person(conn, owner, false)?
        .ok_or_else(|| ServerError::Internal(format!("project owner {owner} has no account")))?;
    cache.insert(owner, person.clone());
    Ok(person)
}

fn status_of(text: &str) -> ProjectStatus {
    match text {
        "pending" => ProjectStatus::Pending,
        "active" => ProjectStatus::Active,
        "archived" => ProjectStatus::Archived,
        _ => ProjectStatus::Unknown,
    }
}

fn status_text(status: ProjectStatus) -> &'static str {
    match status {
        ProjectStatus::Pending => "pending",
        ProjectStatus::Active => "active",
        ProjectStatus::Archived => "archived",
        ProjectStatus::Unknown => "unknown",
    }
}

#[derive(Clone, Copy)]
enum Scope {
    One(SharedProjectId),
    All(Option<ProjectStatus>),
}

fn listing(conn: &Connection, scope: Scope) -> Result<(Statement<'_>, Vec<String>), ServerError> {
    let (sql, bound) = match scope {
        Scope::One(project) => (
            format!("{PROJECT_COLUMNS} WHERE p.id = ?1"),
            vec![project.to_string()],
        ),
        Scope::All(Some(status)) => (
            format!("{PROJECT_COLUMNS} WHERE p.status = ?1"),
            vec![status_text(status).to_string()],
        ),
        Scope::All(None) => (PROJECT_COLUMNS.to_string(), Vec::new()),
    };
    Ok((conn.prepare(&sql)?, bound))
}

fn records(conn: &Connection, scope: Scope, sees_size: bool) -> Result<Vec<Record>, ServerError> {
    let (mut statement, bound) = listing(conn, scope)?;
    let map = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, Option<i64>>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    };
    let rows = statement
        .query_map(params_from_iter(bound), map)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut cache = HashMap::new();
    let mut found = Vec::with_capacity(rows.len());
    for (id, title, status, owner, created_at, activity, archived_at, members, size) in rows {
        let status = status_of(&status);
        let size = u64::try_from(size).unwrap_or(0);
        found.push(Record {
            project: AdminProject {
                project_id: parse_id(&id)?,
                title,
                owner: owners(conn, &mut cache, parse_id(&owner)?)?,
                status,
                member_count: u32::try_from(members).unwrap_or(u32::MAX),
                size_bytes: sees_size.then_some(size),
                created_at,
                last_activity_at: activity,
                archived_at: archived_at.filter(|_| status == ProjectStatus::Archived),
            },
            size,
        });
    }
    Ok(found)
}

pub fn project(
    conn: &Connection,
    project: SharedProjectId,
    sees_size: bool,
) -> Result<AdminProject, ServerError> {
    records(conn, Scope::One(project), sees_size)?
        .into_iter()
        .next()
        .map(|record| record.project)
        .ok_or(ServerError::NotFound)
}

fn matches(record: &Record, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    let owner = &record.project.owner;
    record.project.title.to_lowercase().contains(needle)
        || owner.display_name.to_lowercase().contains(needle)
        || owner
            .login
            .as_deref()
            .is_some_and(|login| login.to_lowercase().contains(needle))
}

fn compare(left: &Record, right: &Record, sort: AdminProjectSort) -> Ordering {
    let (a, b) = (&left.project, &right.project);
    match sort {
        AdminProjectSort::Title => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
        AdminProjectSort::Owner => a
            .owner
            .display_name
            .to_lowercase()
            .cmp(&b.owner.display_name.to_lowercase()),
        AdminProjectSort::Members => a.member_count.cmp(&b.member_count),
        AdminProjectSort::Size => left.size.cmp(&right.size),
        AdminProjectSort::Activity => a.last_activity_at.cmp(&b.last_activity_at),
        AdminProjectSort::Created => a.created_at.cmp(&b.created_at),
    }
}

pub fn list_projects(
    conn: &Connection,
    filter: &ProjectFilter,
    sees_size: bool,
) -> Result<Vec<AdminProject>, ServerError> {
    let needle = filter.search.trim().to_lowercase();
    let mut found: Vec<Record> = records(conn, Scope::All(filter.status), sees_size)?
        .into_iter()
        .filter(|record| matches(record, &needle))
        .collect();
    found.sort_by(|left, right| {
        let primary = compare(left, right, filter.sort);
        let primary = match filter.order {
            SortOrder::Asc => primary,
            SortOrder::Desc => primary.reverse(),
        };
        primary
            .then_with(|| right.project.created_at.cmp(&left.project.created_at))
            .then_with(|| {
                left.project
                    .project_id
                    .to_string()
                    .cmp(&right.project.project_id.to_string())
            })
    });
    Ok(found.into_iter().map(|record| record.project).collect())
}

pub fn restore_archived(conn: &Connection, project: SharedProjectId) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE projects SET status = 'active', archived_at = NULL WHERE id = ?1 AND status = 'archived'",
        [project.to_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use oleafly_collab_protocol::ids::BatchId;
    use rusqlite::{params, StatementStatus};

    const START: i64 = 1_760_000_000_000;

    async fn with_db<T: Send + 'static>(
        work: impl FnOnce(&mut Connection) -> T + Send + 'static,
    ) -> T {
        Db::open_in_memory()
            .unwrap()
            .call(move |conn| Ok(work(conn)))
            .await
            .unwrap()
    }

    fn seed(
        conn: &mut Connection,
        count: i64,
        updates: i64,
        status: ProjectStatus,
    ) -> Vec<(SharedProjectId, i64)> {
        let transaction = conn.transaction().unwrap();
        let owner = AccountId::new_v7();
        transaction
            .execute(
                "INSERT INTO accounts (id, display_name, server_role, created_at, updated_at) VALUES (?1, 'Owner', 'member', 1, 1)",
                [owner.to_string()],
            )
            .unwrap();
        let mut newest = Vec::new();
        for index in 0..count {
            let opened = START + index * 1_000_000;
            let project =
                projects::create_pending(&transaction, owner, &format!("Project {index}"), opened)
                    .unwrap();
            projects::set_status(&transaction, project, ProjectStatus::Active, opened).unwrap();
            if status == ProjectStatus::Archived {
                projects::set_status(&transaction, project, status, opened).unwrap();
            }
            let mut last = opened;
            for seq in 1..=updates {
                last = opened + seq * 1_000;
                transaction
                    .execute(
                        "INSERT INTO project_updates (project_id, seq, batch_id, device_id, account_id, envelope, created_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)",
                        params![
                            project.to_string(),
                            seq,
                            BatchId::new_v7().to_string(),
                            owner.to_string(),
                            vec![7u8; 600],
                            last
                        ],
                    )
                    .unwrap();
            }
            transaction
                .execute(
                    "UPDATE projects SET head_seq = ?2 WHERE id = ?1",
                    params![project.to_string(), updates],
                )
                .unwrap();
            newest.push((project, last));
        }
        transaction.commit().unwrap();
        newest
    }

    fn listing_steps(conn: &Connection, scope: Scope) -> i32 {
        let (mut statement, bound) = listing(conn, scope).unwrap();
        let mut rows = statement.query(params_from_iter(bound)).unwrap();
        while rows.next().unwrap().is_some() {}
        drop(rows);
        statement.get_status(StatementStatus::VmStep)
    }

    #[tokio::test]
    async fn listing_projects_costs_the_same_however_many_updates_they_keep() {
        let few = with_db(|conn| {
            seed(conn, 40, 1, ProjectStatus::Active);
            listing_steps(conn, Scope::All(None))
        })
        .await;
        let many = with_db(|conn| {
            seed(conn, 40, 500, ProjectStatus::Active);
            listing_steps(conn, Scope::All(None))
        })
        .await;
        assert!(few > 0);
        assert!(
            many <= few + few / 10,
            "listing 40 projects took {few} steps with 1 update each and {many} with 500"
        );
    }

    #[tokio::test]
    async fn listing_one_status_costs_nothing_for_projects_in_other_states() {
        let archived = Scope::All(Some(ProjectStatus::Archived));
        let alone = with_db(move |conn| {
            seed(conn, 5, 1, ProjectStatus::Archived);
            listing_steps(conn, archived)
        })
        .await;
        let crowded = with_db(move |conn| {
            seed(conn, 5, 1, ProjectStatus::Archived);
            seed(conn, 200, 1, ProjectStatus::Active);
            listing_steps(conn, archived)
        })
        .await;
        assert!(alone > 0);
        assert!(
            crowded <= alone + alone / 10,
            "listing 5 archived projects took {alone} steps alone and {crowded} next to 200 active ones"
        );
    }

    #[tokio::test]
    async fn last_activity_is_the_newest_kept_update() {
        with_db(|conn| {
            let seeded = seed(conn, 3, 30, ProjectStatus::Active);
            let filter = ProjectFilter {
                search: String::new(),
                status: None,
                sort: AdminProjectSort::Activity,
                order: SortOrder::Desc,
            };
            let listed = list_projects(conn, &filter, true).unwrap();
            assert_eq!(listed.len(), 3);
            for (project, newest) in seeded {
                let item = listed
                    .iter()
                    .find(|item| item.project_id == project)
                    .unwrap();
                assert_eq!(item.last_activity_at, newest);
            }
        })
        .await;
    }
}
