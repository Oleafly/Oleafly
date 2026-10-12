use std::collections::hash_map::Entry;
use std::collections::HashMap;

use oleafly_collab_protocol::access_log::{AccessEntry, AccessKind, JoinedVia};
use oleafly_collab_protocol::admin::Page;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::PersonSummary;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::parse_id;
use crate::error::ServerError;
use crate::projects;
use crate::settings;
use crate::state::AppState;

pub const COALESCE_MS: i64 = 30 * 60 * 1000;
pub const DEFAULT_PAGE_SIZE: u32 = 50;
pub const MAX_PAGE_SIZE: u32 = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Visit {
    pub project: SharedProjectId,
    pub account: AccountId,
    pub device: DeviceId,
    pub kind: AccessKind,
    pub via: Option<JoinedVia>,
}

impl Visit {
    pub fn opened(project: SharedProjectId, account: AccountId, device: DeviceId) -> Visit {
        Visit {
            project,
            account,
            device,
            kind: AccessKind::Opened,
            via: None,
        }
    }

    pub fn downloaded(project: SharedProjectId, account: AccountId, device: DeviceId) -> Visit {
        Visit {
            kind: AccessKind::Downloaded,
            ..Visit::opened(project, account, device)
        }
    }

    pub fn joined(
        project: SharedProjectId,
        account: AccountId,
        device: DeviceId,
        via: JoinedVia,
    ) -> Visit {
        Visit {
            kind: AccessKind::Joined,
            via: Some(via),
            ..Visit::opened(project, account, device)
        }
    }
}

pub fn kind_to_str(kind: AccessKind) -> &'static str {
    match kind {
        AccessKind::Opened => "opened",
        AccessKind::Joined => "joined",
        AccessKind::Downloaded => "downloaded",
        AccessKind::Unknown => "unknown",
    }
}

fn kind_from_str(text: &str) -> AccessKind {
    match text {
        "opened" => AccessKind::Opened,
        "joined" => AccessKind::Joined,
        "downloaded" => AccessKind::Downloaded,
        _ => AccessKind::Unknown,
    }
}

fn via_to_str(via: JoinedVia) -> &'static str {
    match via {
        JoinedVia::Link => "link",
        JoinedVia::Share => "share",
        JoinedVia::Unknown => "unknown",
    }
}

fn via_from_str(text: &str) -> JoinedVia {
    match text {
        "link" => JoinedVia::Link,
        "share" => JoinedVia::Share,
        _ => JoinedVia::Unknown,
    }
}

pub fn recording(conn: &Connection, project: SharedProjectId) -> Result<bool, ServerError> {
    let on = conn
        .query_row(
            "SELECT access_log FROM projects WHERE id = ?1",
            [project.to_string()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    Ok(on == Some(1) && settings::load(conn)?.access_logs_allowed)
}

fn fold(conn: &Connection, now: i64, visit: &Visit) -> Result<bool, ServerError> {
    let folded = conn.execute(
        "UPDATE project_access_log SET last_at = MAX(last_at, ?4), times = times + 1 \
         WHERE id = (SELECT id FROM project_access_log WHERE project_id = ?1 AND device_id = ?2 AND kind = ?3 ORDER BY id DESC LIMIT 1) \
         AND account_id = ?5 AND last_at >= ?6",
        params![
            visit.project.to_string(),
            visit.device.to_string(),
            kind_to_str(visit.kind),
            now,
            visit.account.to_string(),
            now - COALESCE_MS
        ],
    )?;
    Ok(folded > 0)
}

pub fn record(conn: &Connection, now: i64, visit: Visit) -> Result<bool, ServerError> {
    if !recording(conn, visit.project)? {
        return Ok(false);
    }
    if visit.kind != AccessKind::Joined && fold(conn, now, &visit)? {
        return Ok(true);
    }
    let device_name = conn
        .query_row(
            "SELECT name FROM devices WHERE id = ?1",
            [visit.device.to_string()],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    conn.execute(
        "INSERT INTO project_access_log (project_id, account_id, device_id, device_name, kind, via, at, last_at, times) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1)",
        params![
            visit.project.to_string(),
            visit.account.to_string(),
            visit.device.to_string(),
            device_name,
            kind_to_str(visit.kind),
            visit.via.map(via_to_str),
            now
        ],
    )?;
    Ok(true)
}

fn accept(
    conn: &Connection,
    now: i64,
    project: SharedProjectId,
    account: AccountId,
) -> Result<bool, ServerError> {
    let accepted = conn.execute(
        "UPDATE project_grants SET accepted_at = ?3 WHERE project_id = ?1 AND account_id = ?2 AND accepted_at IS NULL AND role <> 'owner'",
        params![project.to_string(), account.to_string(), now],
    )?;
    Ok(accepted > 0)
}

pub fn joined_by_link(
    conn: &Connection,
    now: i64,
    project: SharedProjectId,
    account: AccountId,
    device: DeviceId,
) -> Result<(), ServerError> {
    accept(conn, now, project, account)?;
    record(
        conn,
        now,
        Visit::joined(project, account, device, JoinedVia::Link),
    )?;
    Ok(())
}

pub fn downloaded(
    conn: &Connection,
    now: i64,
    project: SharedProjectId,
    account: AccountId,
    device: DeviceId,
) -> Result<(), ServerError> {
    if accept(conn, now, project, account)? {
        record(
            conn,
            now,
            Visit::joined(project, account, device, JoinedVia::Share),
        )?;
    }
    record(conn, now, Visit::downloaded(project, account, device))?;
    Ok(())
}

struct RawEntry {
    id: i64,
    account: String,
    device_name: String,
    kind: String,
    via: Option<String>,
    at: i64,
    last_at: i64,
    times: i64,
}

pub fn page(
    conn: &Connection,
    project: SharedProjectId,
    cursor: Option<&str>,
    limit: u32,
    emails: bool,
) -> Result<Page<AccessEntry>, ServerError> {
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let before = match cursor {
        None => i64::MAX,
        Some(text) => text
            .parse::<i64>()
            .ok()
            .filter(|id| *id > 0)
            .ok_or_else(|| {
                ServerError::BadRequest("That access log cursor is not valid.".to_string())
            })?,
    };
    let mut statement = conn.prepare(
        "SELECT id, account_id, device_name, kind, via, at, last_at, times FROM project_access_log \
         WHERE project_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
    )?;
    let rows = statement
        .query_map(
            params![project.to_string(), before, i64::from(limit) + 1],
            |row| {
                Ok(RawEntry {
                    id: row.get(0)?,
                    account: row.get(1)?,
                    device_name: row.get(2)?,
                    kind: row.get(3)?,
                    via: row.get(4)?,
                    at: row.get(5)?,
                    last_at: row.get(6)?,
                    times: row.get(7)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let wanted = usize::try_from(limit).unwrap_or(usize::MAX);
    let has_more = rows.len() > wanted;
    let mut people: HashMap<AccountId, Option<PersonSummary>> = HashMap::new();
    let mut items = Vec::with_capacity(wanted.min(rows.len()));
    let mut last_id = None;
    for raw in rows.into_iter().take(wanted) {
        last_id = Some(raw.id);
        let account: AccountId = parse_id(&raw.account)?;
        let person = match people.entry(account) {
            Entry::Occupied(found) => found.get().clone(),
            Entry::Vacant(slot) => slot
                .insert(projects::person(conn, account, emails)?)
                .clone(),
        };
        let Some(person) = person else {
            continue;
        };
        items.push(AccessEntry {
            id: raw.id,
            kind: kind_from_str(&raw.kind),
            via: raw.via.as_deref().map(via_from_str),
            person,
            device_name: raw.device_name,
            at: raw.at,
            last_at: raw.last_at,
            times: u32::try_from(raw.times).unwrap_or(u32::MAX),
        });
    }
    let next_cursor = if has_more {
        last_id.map(|id| id.to_string())
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

pub fn quietly(result: Result<(), ServerError>) {
    if let Err(error) = result {
        tracing::warn!("Could not write to a project's access log: {error}");
    }
}

pub async fn note_open(
    state: &AppState,
    project: SharedProjectId,
    account: AccountId,
    device: DeviceId,
) {
    let now = state.clock.now_ms();
    let visit = Visit::opened(project, account, device);
    quietly(
        state
            .db
            .call(move |conn| record(conn, now, visit).map(|_| ()))
            .await,
    );
}

pub async fn note_download(
    state: &AppState,
    project: SharedProjectId,
    account: AccountId,
    device: DeviceId,
) {
    let now = state.clock.now_ms();
    quietly(
        state
            .db
            .call(move |conn| downloaded(conn, now, project, account, device))
            .await,
    );
}

pub fn prune(conn: &Connection, older_than: i64) -> Result<usize, ServerError> {
    Ok(conn.execute(
        "DELETE FROM project_access_log WHERE last_at < ?1",
        [older_than],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
    use oleafly_collab_protocol::projects::{ProjectPatch, ProjectRole};

    const NOW: i64 = 1_760_000_000_000;
    const MINUTE: i64 = 60 * 1000;

    struct Seeded {
        project: SharedProjectId,
        owner: AccountId,
        owner_laptop: DeviceId,
        alice: AccountId,
        alice_laptop: DeviceId,
        alice_desktop: DeviceId,
    }

    fn person(conn: &Connection, name: &str) -> AccountId {
        let id = AccountId::new_v7();
        conn.execute(
            "INSERT INTO accounts (id, display_name, server_role, created_at, updated_at) VALUES (?1, ?2, 'member', 1, 1)",
            params![id.to_string(), name],
        )
        .unwrap();
        id
    }

    fn device(conn: &Connection, account: AccountId, name: &str) -> DeviceId {
        let id = DeviceId::new_v7();
        conn.execute(
            "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES (?1, ?2, ?3, ?4, 'macos', 1)",
            params![id.to_string(), account.to_string(), id.to_string(), name],
        )
        .unwrap();
        id
    }

    fn switch(conn: &Connection, project: SharedProjectId, on: bool) {
        projects::apply_patch(
            conn,
            project,
            &ProjectPatch {
                access_log: Some(on),
                ..ProjectPatch::default()
            },
        )
        .unwrap();
    }

    fn allow(conn: &Connection, allowed: bool) {
        settings::patch(
            conn,
            &RuntimeSettingsPatch {
                access_logs_allowed: Some(allowed),
                ..RuntimeSettingsPatch::default()
            },
        )
        .unwrap();
    }

    fn seed(conn: &Connection, on: bool) -> Seeded {
        let owner = person(conn, "Bob Smith");
        let owner_laptop = device(conn, owner, "Bob's laptop");
        let alice = person(conn, "Alice Chen");
        let alice_laptop = device(conn, alice, "Alice's laptop");
        let alice_desktop = device(conn, alice, "Alice's desktop");
        let project = projects::create_pending(conn, owner, "Thesis", NOW).unwrap();
        switch(conn, project, on);
        Seeded {
            project,
            owner,
            owner_laptop,
            alice,
            alice_laptop,
            alice_desktop,
        }
    }

    fn rows(conn: &Connection, project: SharedProjectId) -> Vec<AccessEntry> {
        page(conn, project, None, MAX_PAGE_SIZE, true)
            .unwrap()
            .items
    }

    fn kinds(entries: &[AccessEntry]) -> Vec<(AccessKind, Option<JoinedVia>)> {
        entries
            .iter()
            .map(|entry| (entry.kind, entry.via))
            .collect()
    }

    async fn with_db<T: Send + 'static>(
        work: impl FnOnce(&mut Connection) -> T + Send + 'static,
    ) -> T {
        Db::open_in_memory()
            .unwrap()
            .call(move |conn| Ok(work(conn)))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn nothing_is_written_until_the_owner_turns_the_log_on() {
        with_db(|conn| {
            let seeded = seed(conn, false);
            let visit = Visit::opened(seeded.project, seeded.alice, seeded.alice_laptop);
            assert!(!record(conn, NOW, visit).unwrap());
            assert!(rows(conn, seeded.project).is_empty());
            switch(conn, seeded.project, true);
            assert!(record(conn, NOW, visit).unwrap());
            assert_eq!(rows(conn, seeded.project).len(), 1);
            switch(conn, seeded.project, false);
            assert!(!record(conn, NOW + 2 * COALESCE_MS, visit).unwrap());
            assert_eq!(rows(conn, seeded.project).len(), 1);
        })
        .await;
    }

    #[tokio::test]
    async fn nothing_is_written_while_the_server_does_not_allow_access_logs() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            allow(conn, false);
            let visit = Visit::opened(seeded.project, seeded.alice, seeded.alice_laptop);
            assert!(!record(conn, NOW, visit).unwrap());
            assert!(rows(conn, seeded.project).is_empty());
            allow(conn, true);
            assert!(record(conn, NOW, visit).unwrap());
            assert_eq!(rows(conn, seeded.project).len(), 1);
        })
        .await;
    }

    #[tokio::test]
    async fn each_kind_keeps_the_person_device_name_and_time_newest_first() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice, laptop) = (seeded.project, seeded.alice, seeded.alice_laptop);
            record(
                conn,
                NOW,
                Visit::joined(project, alice, laptop, JoinedVia::Link),
            )
            .unwrap();
            record(
                conn,
                NOW + MINUTE,
                Visit::downloaded(project, alice, laptop),
            )
            .unwrap();
            record(
                conn,
                NOW + 2 * MINUTE,
                Visit::opened(project, alice, laptop),
            )
            .unwrap();
            let listed = rows(conn, project);
            assert_eq!(
                kinds(&listed),
                [
                    (AccessKind::Opened, None),
                    (AccessKind::Downloaded, None),
                    (AccessKind::Joined, Some(JoinedVia::Link)),
                ]
            );
            assert_eq!(
                listed.iter().map(|entry| entry.at).collect::<Vec<_>>(),
                [NOW + 2 * MINUTE, NOW + MINUTE, NOW]
            );
            for entry in &listed {
                assert_eq!(entry.person.account_id, alice);
                assert_eq!(entry.person.display_name, "Alice Chen");
                assert_eq!(entry.device_name, "Alice's laptop");
                assert_eq!(entry.times, 1);
                assert_eq!(entry.last_at, entry.at);
            }
        })
        .await;
    }

    #[tokio::test]
    async fn a_flapping_connection_folds_into_one_entry_per_device() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice) = (seeded.project, seeded.alice);
            for minute in 0..300 {
                record(
                    conn,
                    NOW + minute * MINUTE,
                    Visit::opened(project, alice, seeded.alice_laptop),
                )
                .unwrap();
            }
            record(
                conn,
                NOW,
                Visit::opened(project, alice, seeded.alice_desktop),
            )
            .unwrap();
            let listed = rows(conn, project);
            assert_eq!(listed.len(), 2);
            let laptop = &listed[1];
            assert_eq!(laptop.device_name, "Alice's laptop");
            assert_eq!((laptop.at, laptop.last_at), (NOW, NOW + 299 * MINUTE));
            assert_eq!(laptop.times, 300);
            assert_eq!(listed[0].device_name, "Alice's desktop");
            let later = NOW + 299 * MINUTE + COALESCE_MS + 1;
            record(
                conn,
                later,
                Visit::opened(project, alice, seeded.alice_laptop),
            )
            .unwrap();
            let listed = rows(conn, project);
            assert_eq!(listed.len(), 3);
            assert_eq!((listed[0].at, listed[0].times), (later, 1));
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM project_access_log", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 3);
        })
        .await;
    }

    #[tokio::test]
    async fn joins_are_never_folded_together() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let joined = Visit::joined(
                seeded.project,
                seeded.alice,
                seeded.alice_laptop,
                JoinedVia::Link,
            );
            record(conn, NOW, joined).unwrap();
            record(conn, NOW + MINUTE, joined).unwrap();
            assert_eq!(rows(conn, seeded.project).len(), 2);
        })
        .await;
    }

    #[tokio::test]
    async fn the_first_download_after_a_share_counts_as_joining_once() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice, laptop) = (seeded.project, seeded.alice, seeded.alice_laptop);
            projects::grant(conn, project, alice, ProjectRole::Editor, seeded.owner, NOW).unwrap();
            downloaded(conn, NOW + MINUTE, project, alice, laptop).unwrap();
            downloaded(conn, NOW + 2 * MINUTE, project, alice, laptop).unwrap();
            projects::grant(conn, project, alice, ProjectRole::Viewer, seeded.owner, NOW).unwrap();
            downloaded(conn, NOW + 3 * MINUTE, project, alice, laptop).unwrap();
            downloaded(
                conn,
                NOW + 4 * MINUTE,
                project,
                seeded.owner,
                seeded.owner_laptop,
            )
            .unwrap();
            let listed = rows(conn, project);
            assert_eq!(
                kinds(&listed),
                [
                    (AccessKind::Downloaded, None),
                    (AccessKind::Downloaded, None),
                    (AccessKind::Joined, Some(JoinedVia::Share)),
                ]
            );
            assert_eq!(listed[0].person.account_id, seeded.owner);
            assert_eq!(listed[1].times, 3);
        })
        .await;
    }

    #[tokio::test]
    async fn someone_added_back_after_removal_joins_again() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice, laptop) = (seeded.project, seeded.alice, seeded.alice_laptop);
            projects::grant(conn, project, alice, ProjectRole::Editor, seeded.owner, NOW).unwrap();
            downloaded(conn, NOW, project, alice, laptop).unwrap();
            projects::revoke(conn, project, alice).unwrap();
            projects::grant(conn, project, alice, ProjectRole::Editor, seeded.owner, NOW).unwrap();
            downloaded(conn, NOW + MINUTE, project, alice, laptop).unwrap();
            let joins = rows(conn, project)
                .into_iter()
                .filter(|entry| entry.kind == AccessKind::Joined)
                .count();
            assert_eq!(joins, 2);
        })
        .await;
    }

    #[tokio::test]
    async fn joining_by_link_is_not_counted_again_at_the_first_download() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice, laptop) = (seeded.project, seeded.alice, seeded.alice_laptop);
            projects::grant(conn, project, alice, ProjectRole::Viewer, seeded.owner, NOW).unwrap();
            joined_by_link(conn, NOW, project, alice, laptop).unwrap();
            downloaded(conn, NOW + MINUTE, project, alice, laptop).unwrap();
            assert_eq!(
                kinds(&rows(conn, project)),
                [
                    (AccessKind::Downloaded, None),
                    (AccessKind::Joined, Some(JoinedVia::Link)),
                ]
            );
        })
        .await;
    }

    #[tokio::test]
    async fn a_share_accepted_while_the_log_was_off_is_not_counted_later() {
        with_db(|conn| {
            let seeded = seed(conn, false);
            let (project, alice, laptop) = (seeded.project, seeded.alice, seeded.alice_laptop);
            projects::grant(conn, project, alice, ProjectRole::Editor, seeded.owner, NOW).unwrap();
            downloaded(conn, NOW, project, alice, laptop).unwrap();
            switch(conn, project, true);
            downloaded(conn, NOW + MINUTE, project, alice, laptop).unwrap();
            assert_eq!(
                kinds(&rows(conn, project)),
                [(AccessKind::Downloaded, None)]
            );
        })
        .await;
    }

    #[tokio::test]
    async fn pruning_removes_entries_last_used_before_the_cutoff() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let (project, alice) = (seeded.project, seeded.alice);
            record(
                conn,
                NOW,
                Visit::opened(project, alice, seeded.alice_laptop),
            )
            .unwrap();
            record(
                conn,
                NOW,
                Visit::opened(project, alice, seeded.alice_desktop),
            )
            .unwrap();
            record(
                conn,
                NOW + 20 * MINUTE,
                Visit::opened(project, alice, seeded.alice_desktop),
            )
            .unwrap();
            assert_eq!(prune(conn, NOW + 10 * MINUTE).unwrap(), 1);
            let listed = rows(conn, project);
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].device_name, "Alice's desktop");
        })
        .await;
    }

    #[tokio::test]
    async fn pages_run_newest_first_and_end_without_a_cursor() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            for index in 0..5 {
                record(
                    conn,
                    NOW + index,
                    Visit::joined(
                        seeded.project,
                        seeded.alice,
                        seeded.alice_laptop,
                        JoinedVia::Share,
                    ),
                )
                .unwrap();
            }
            let at = |listed: &Page<AccessEntry>| -> Vec<i64> {
                listed.items.iter().map(|entry| entry.at - NOW).collect()
            };
            let first = page(conn, seeded.project, None, 2, true).unwrap();
            assert_eq!(at(&first), [4, 3]);
            let second = page(conn, seeded.project, first.next_cursor.as_deref(), 2, true).unwrap();
            assert_eq!(at(&second), [2, 1]);
            let third = page(conn, seeded.project, second.next_cursor.as_deref(), 2, true).unwrap();
            assert_eq!(at(&third), [0]);
            assert_eq!(third.next_cursor, None);
            assert_eq!(
                page(conn, seeded.project, None, 0, true)
                    .unwrap()
                    .items
                    .len(),
                1
            );
            for cursor in ["abc", "0", "-3", ""] {
                assert!(
                    matches!(
                        page(conn, seeded.project, Some(cursor), 10, true),
                        Err(ServerError::BadRequest(_))
                    ),
                    "{cursor}"
                );
            }
        })
        .await;
    }

    #[tokio::test]
    async fn each_project_reads_only_its_own_entries() {
        with_db(|conn| {
            let seeded = seed(conn, true);
            let other = projects::create_pending(conn, seeded.owner, "Other", NOW).unwrap();
            switch(conn, other, true);
            record(
                conn,
                NOW,
                Visit::opened(other, seeded.alice, seeded.alice_laptop),
            )
            .unwrap();
            assert!(rows(conn, seeded.project).is_empty());
            assert_eq!(rows(conn, other).len(), 1);
        })
        .await;
    }
}
