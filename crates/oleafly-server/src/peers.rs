use std::collections::HashMap;

use loro::{EncodedBlobMode, ImportBlobMetadata, LoroDoc, VersionVector};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::snapshots::ProjectPeer;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::parse_id;
use crate::error::ServerError;

pub type Span = (u64, i32);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reach {
    pub starts: Vec<Span>,
    pub ends: Vec<Span>,
    pub deps: Vec<Span>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bound {
    Accepted,
    Known,
    Refused(u64),
    Detached,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Claim {
    Fresh(Vec<Span>),
    Known,
    Taken(u64),
}

fn peer_to_sql(peer: u64) -> i64 {
    i64::from_be_bytes(peer.to_be_bytes())
}

fn peer_from_sql(stored: i64) -> u64 {
    u64::from_be_bytes(stored.to_be_bytes())
}

fn spans_of(version: &VersionVector) -> Vec<Span> {
    let mut spans: Vec<Span> = version.iter().map(|(peer, end)| (*peer, *end)).collect();
    spans.sort_unstable();
    spans
}

fn reach_of(meta: &ImportBlobMetadata) -> Reach {
    let mut deps: Vec<Span> = meta
        .start_frontiers
        .iter()
        .map(|id| (id.peer, id.counter))
        .collect();
    deps.sort_unstable();
    Reach {
        starts: spans_of(&meta.partial_start_vv),
        ends: spans_of(&meta.partial_end_vv),
        deps,
    }
}

pub fn update_reach(payload: &[u8]) -> Option<Reach> {
    let meta = LoroDoc::decode_import_blob_meta(payload, true).ok()?;
    (meta.mode == EncodedBlobMode::Updates).then(|| reach_of(&meta))
}

pub fn snapshot_reach(bytes: &[u8]) -> Option<Reach> {
    let meta = LoroDoc::decode_import_blob_meta(bytes, true).ok()?;
    (meta.mode == EncodedBlobMode::Snapshot).then(|| reach_of(&meta))
}

fn known_end(
    conn: &Connection,
    project: SharedProjectId,
    peer: u64,
) -> Result<Option<(DeviceId, i64)>, ServerError> {
    let known: Option<(String, i64)> = conn
        .query_row(
            "SELECT device_id, counter_end FROM project_peers WHERE project_id = ?1 AND peer = ?2",
            params![project.to_string(), peer_to_sql(peer)],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    known
        .map(|(device, counter)| Ok((parse_id(&device)?, counter)))
        .transpose()
}

fn complete(conn: &Connection, project: SharedProjectId) -> Result<bool, ServerError> {
    Ok(conn
        .query_row(
            "SELECT peers_known FROM projects WHERE id = ?1",
            [project.to_string()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some_and(|known| known != 0))
}

fn attached(
    conn: &Connection,
    project: SharedProjectId,
    reach: &Reach,
) -> Result<bool, ServerError> {
    let counter = |peer: u64| -> Result<i64, ServerError> {
        Ok(known_end(conn, project, peer)?.map_or(0, |(_, counter)| counter))
    };
    for (peer, start) in &reach.starts {
        if counter(*peer)? < i64::from(*start) {
            return Ok(false);
        }
    }
    for (peer, at) in &reach.deps {
        if counter(*peer)? <= i64::from(*at) {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn claim(
    conn: &Connection,
    project: SharedProjectId,
    device: DeviceId,
    reach: &Reach,
) -> Result<Claim, ServerError> {
    let mut fresh = Vec::new();
    for (peer, end) in &reach.ends {
        match known_end(conn, project, *peer)? {
            Some((bound, _)) if bound != device => return Ok(Claim::Taken(*peer)),
            Some((_, counter)) if i64::from(*end) <= counter => {}
            _ => fresh.push((*peer, *end)),
        }
    }
    Ok(if fresh.is_empty() {
        Claim::Known
    } else {
        Claim::Fresh(fresh)
    })
}

pub fn bind(
    conn: &Connection,
    project: SharedProjectId,
    device: DeviceId,
    account: AccountId,
    reach: &Reach,
    now: i64,
) -> Result<Bound, ServerError> {
    let fresh = match claim(conn, project, device, reach)? {
        Claim::Fresh(fresh) => fresh,
        Claim::Known => return Ok(Bound::Known),
        Claim::Taken(peer) => return Ok(Bound::Refused(peer)),
    };
    if complete(conn, project)? && !attached(conn, project, reach)? {
        return Ok(Bound::Detached);
    }
    for (peer, end) in fresh {
        conn.execute(
            "INSERT INTO project_peers (project_id, peer, device_id, account_id, counter_end, bound_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT (project_id, peer) DO UPDATE SET counter_end = MAX(counter_end, excluded.counter_end)",
            params![
                project.to_string(),
                peer_to_sql(peer),
                device.to_string(),
                account.to_string(),
                i64::from(end),
                now
            ],
        )?;
    }
    Ok(Bound::Accepted)
}

pub fn bind_first_snapshot(
    conn: &Connection,
    project: SharedProjectId,
    device: DeviceId,
    account: AccountId,
    reach: &Reach,
    now: i64,
) -> Result<(), ServerError> {
    if let Bound::Refused(peer) = bind(conn, project, device, account, reach, now)? {
        return Err(ServerError::Conflict(format!(
            "The first snapshot uses a writer id ({peer}) another device already wrote with."
        )));
    }
    conn.execute(
        "UPDATE projects SET peers_known = 1 WHERE id = ?1",
        [project.to_string()],
    )?;
    Ok(())
}

pub fn table(conn: &Connection, project: SharedProjectId) -> Result<Vec<ProjectPeer>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT peer, device_id, account_id FROM project_peers WHERE project_id = ?1 ORDER BY bound_at, peer",
    )?;
    let rows = statement
        .query_map([project.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(peer, device, account)| {
            Ok(ProjectPeer {
                peer: peer_from_sql(peer),
                device_id: parse_id(&device)?,
                account_id: parse_id(&account)?,
            })
        })
        .collect()
}

pub fn bound_devices(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<HashMap<u64, DeviceId>, ServerError> {
    Ok(table(conn, project)?
        .into_iter()
        .map(|bound| (bound.peer, bound.device_id))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use loro::ExportMode;

    #[test]
    fn a_peer_id_keeps_every_bit_through_the_database() {
        for peer in [0, 1, i64::MAX as u64, u64::MAX, u64::MAX - 7] {
            assert_eq!(peer_from_sql(peer_to_sql(peer)), peer);
        }
    }

    #[test]
    fn only_changes_and_snapshots_of_the_right_kind_are_read() {
        let doc = LoroDoc::new();
        doc.set_peer_id(42).unwrap();
        doc.get_text("text").insert(0, "hello").unwrap();
        doc.commit();
        let update = doc.export(ExportMode::all_updates()).unwrap();
        let snapshot = doc.export(ExportMode::Snapshot).unwrap();
        assert_eq!(
            update_reach(&update).map(|reach| reach.ends),
            Some(vec![(42, 5)])
        );
        assert_eq!(update_reach(&snapshot), None);
        assert_eq!(
            snapshot_reach(&snapshot).map(|reach| reach.ends),
            Some(vec![(42, 5)])
        );
        assert_eq!(snapshot_reach(&update), None);
        assert_eq!(update_reach(b"not a change"), None);
        let mut damaged = update.clone();
        let last = damaged.len() - 1;
        damaged[last] ^= 0xff;
        assert_eq!(update_reach(&damaged), None);
    }

    #[test]
    fn a_change_names_where_it_starts_and_what_it_builds_on() {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        doc.get_text("text").insert(0, "abc").unwrap();
        doc.commit();
        let before = doc.oplog_vv();
        doc.set_peer_id(2).unwrap();
        doc.get_text("text").insert(3, "de").unwrap();
        doc.commit();
        let reach = update_reach(&doc.export(ExportMode::updates(&before)).unwrap()).unwrap();
        assert_eq!(reach.starts, vec![(2, 0)]);
        assert_eq!(reach.ends, vec![(2, 2)]);
        assert_eq!(reach.deps, vec![(1, 2)]);
    }

    #[tokio::test]
    async fn a_range_bound_to_another_device_is_taken_even_when_the_server_holds_it() {
        let db = crate::db::Db::open_in_memory().unwrap();
        db.call(|conn| {
            let project = SharedProjectId::new_v7();
            let account = crate::members::create_account(
                conn,
                "Ada",
                None,
                oleafly_collab_protocol::roles::ServerRole::Member,
                1,
            )?;
            conn.execute(
                "INSERT INTO projects (id, owner_account, title, status, created_at) VALUES (?1, ?2, 'Thesis', 'active', 1)",
                params![project.to_string(), account.to_string()],
            )?;
            let (alice, mallory) = (DeviceId::new_v7(), DeviceId::new_v7());
            for device in [alice, mallory] {
                conn.execute(
                    "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES (?1, ?2, ?3, 'Laptop', 'test', 1)",
                    params![device.to_string(), account.to_string(), device.to_string()],
                )?;
            }
            let reach = |ends: Vec<Span>| Reach {
                starts: ends.iter().map(|(peer, _)| (*peer, 0)).collect(),
                ends,
                deps: Vec::new(),
            };
            assert_eq!(
                bind(conn, project, alice, account, &reach(vec![(7, 10)]), 1)?,
                Bound::Accepted
            );
            assert_eq!(
                claim(conn, project, alice, &reach(vec![(7, 10)]))?,
                Claim::Known
            );
            assert_eq!(
                bind(conn, project, alice, account, &reach(vec![(7, 10)]), 1)?,
                Bound::Known
            );
            assert_eq!(
                claim(conn, project, mallory, &reach(vec![(7, 4), (9, 2)]))?,
                Claim::Taken(7)
            );
            assert_eq!(
                bind(conn, project, mallory, account, &reach(vec![(7, 4), (9, 2)]), 1)?,
                Bound::Refused(7)
            );
            assert_eq!(
                claim(conn, project, mallory, &reach(vec![(9, 2)]))?,
                Claim::Fresh(vec![(9, 2)])
            );
            Ok(())
        })
        .await
        .unwrap();
    }
}
