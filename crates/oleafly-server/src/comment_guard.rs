use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, PoisonError};
use std::time::{Duration, Instant};

use loro::{ContainerID, ExportMode, Frontiers, LoroDoc, ID};
use oleafly_collab_protocol::ids::SharedProjectId;
use tokio::sync::Mutex;

use crate::db::Db;
use crate::error::ServerError;
use crate::peers;
use crate::projects;
use crate::snapshots::{self, Budgeted, Replay, Snapshots};

pub const COMMENTS: &str = "comments";
const IDLE: Duration = Duration::from_secs(15 * 60);
const MAX_KEPT: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    ChangesComments,
    Unreadable,
}

struct Kept {
    replay: Budgeted,
    seq: u64,
}

struct Slot {
    kept: Mutex<Option<Kept>>,
    used: std::sync::Mutex<Instant>,
}

impl Slot {
    fn idle(&self, now: Instant) -> Duration {
        now.saturating_duration_since(*self.used.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

#[derive(Clone, Default)]
pub struct CommentGuard {
    slots: Arc<std::sync::Mutex<HashMap<SharedProjectId, Arc<Slot>>>>,
}

impl CommentGuard {
    fn slot(&self, project: SharedProjectId) -> Arc<Slot> {
        let now = Instant::now();
        let mut slots = self.slots.lock().unwrap_or_else(PoisonError::into_inner);
        slots.retain(|key, slot| {
            *key == project || Arc::strong_count(slot) > 1 || slot.idle(now) < IDLE
        });
        if !slots.contains_key(&project) && slots.len() >= MAX_KEPT {
            let oldest = slots
                .iter()
                .filter(|(_, slot)| Arc::strong_count(slot) == 1)
                .max_by_key(|(_, slot)| slot.idle(now))
                .map(|(key, _)| *key);
            if let Some(oldest) = oldest {
                slots.remove(&oldest);
            }
        }
        let slot = slots.entry(project).or_insert_with(|| {
            Arc::new(Slot {
                kept: Mutex::new(None),
                used: std::sync::Mutex::new(now),
            })
        });
        *slot.used.lock().unwrap_or_else(PoisonError::into_inner) = now;
        Arc::clone(slot)
    }

    #[cfg(test)]
    fn kept(&self) -> usize {
        self.slots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    pub async fn check(
        &self,
        db: &Db,
        snapshots: &Snapshots,
        project: SharedProjectId,
        payload: Vec<u8>,
    ) -> Result<Verdict, ServerError> {
        let slot = self.slot(project);
        let mut kept = slot.kept.lock().await;
        let (replay, seq) = match caught_up(db, project, kept.take()).await? {
            Some(current) => current,
            None => snapshots.current(db, project).await?.ok_or_else(|| {
                ServerError::Internal(format!(
                    "the document of project {project} could not be read to check a change"
                ))
            })?,
        };
        let (verdict, replay) = tokio::task::spawn_blocking(move || {
            let before = replay.doc().oplog_frontiers();
            let (verdict, intact) = judge(replay.doc(), &payload);
            let replay = if intact {
                Some(replay)
            } else {
                rewound(project, &replay, &before).map(|fresh| replay.replaced(fresh))
            };
            (verdict, replay)
        })
        .await
        .map_err(|error| ServerError::Internal(format!("a comment check failed: {error}")))?;
        if let Some(replay) = replay {
            *kept = Some(Kept { replay, seq });
        }
        Ok(verdict)
    }

    pub async fn forget(&self, project: SharedProjectId) {
        let slot = self
            .slots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&project)
            .cloned();
        if let Some(slot) = slot {
            *slot.kept.lock().await = None;
        }
    }
}

fn rewound(project: SharedProjectId, replay: &Replay, before: &Frontiers) -> Option<Replay> {
    let bytes = replay
        .doc()
        .export(ExportMode::SnapshotAt {
            version: Cow::Borrowed(before),
        })
        .ok()?;
    Replay::start(project, &bytes)
}

async fn caught_up(
    db: &Db,
    project: SharedProjectId,
    kept: Option<Kept>,
) -> Result<Option<(Budgeted, u64)>, ServerError> {
    let Some(Kept { replay, seq }) = kept else {
        return Ok(None);
    };
    let (head, bindings) = db
        .call(move |conn| {
            Ok((
                projects::project_row(conn, project)?.map_or(0, |row| row.head_seq),
                peers::bound_devices(conn, project)?,
            ))
        })
        .await?;
    if head < seq {
        return Ok(None);
    }
    let advanced = snapshots::advance(db, project, replay, seq, head, &Arc::new(bindings)).await?;
    Ok(advanced.map(|replay| (replay, head)))
}

fn judge(doc: &LoroDoc, payload: &[u8]) -> (Verdict, bool) {
    let attached = peers::update_reach(payload)
        .is_some_and(|reach| snapshots::builds_on(&reach, &doc.oplog_vv()));
    if !attached {
        return (Verdict::Unreadable, true);
    }
    let verdict = read_in(doc, payload);
    (verdict, verdict == Verdict::Allowed)
}

fn read_in(doc: &LoroDoc, payload: &[u8]) -> Verdict {
    let Ok(status) = snapshots::import_update(doc, payload) else {
        return Verdict::Unreadable;
    };
    if status.pending.is_some() {
        return Verdict::Unreadable;
    }
    for (peer, (start, end)) in status.success.iter() {
        let length = usize::try_from(end.saturating_sub(*start)).unwrap_or(0);
        if doc
            .get_changed_containers_in(ID::new(*peer, *start), length)
            .iter()
            .any(|container| in_comments(doc, container))
        {
            return Verdict::ChangesComments;
        }
    }
    Verdict::Allowed
}

fn in_comments(doc: &LoroDoc, container: &ContainerID) -> bool {
    let root = match container {
        ContainerID::Root { .. } => Some(container.clone()),
        ContainerID::Normal { .. } => doc
            .get_path_to_container(container)
            .and_then(|path| path.into_iter().next().map(|(root, _)| root)),
    };
    matches!(root, Some(ContainerID::Root { name, .. }) if name.as_str() == COMMENTS)
}

#[cfg(test)]
mod tests {
    use loro::{ExportMode, LoroMap};

    use super::*;

    fn shared() -> (LoroDoc, Vec<u8>) {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        doc.get_text("text").insert(0, "Hello").unwrap();
        let thread = doc
            .get_map(COMMENTS)
            .insert_container("file-1/thread-1", LoroMap::new())
            .unwrap();
        let messages = thread
            .insert_container("messages", loro::LoroList::new())
            .unwrap();
        let message = messages.insert_container(0, LoroMap::new()).unwrap();
        message.insert("body", "first").unwrap();
        doc.commit();
        let snapshot = doc.export(ExportMode::Snapshot).unwrap();
        (doc, snapshot)
    }

    fn change(base: &[u8], peer: u64, edit: impl FnOnce(&LoroDoc)) -> Vec<u8> {
        let doc = LoroDoc::new();
        doc.import(base).unwrap();
        doc.set_peer_id(peer).unwrap();
        let before = doc.oplog_vv();
        edit(&doc);
        doc.commit();
        doc.export(ExportMode::updates(&before)).unwrap()
    }

    fn thread_of(doc: &LoroDoc) -> LoroMap {
        match doc.get_map(COMMENTS).get("file-1/thread-1") {
            Some(loro::ValueOrContainer::Container(loro::Container::Map(thread))) => thread,
            _ => panic!("the thread exists"),
        }
    }

    fn checked(base: &[u8], update: &[u8]) -> Verdict {
        let doc = LoroDoc::new();
        doc.import(base).unwrap();
        judge(&doc, update).0
    }

    #[test]
    fn typing_in_a_file_is_not_a_comment_change() {
        let (_, base) = shared();
        let update = change(&base, 2, |doc| {
            doc.get_text("text").insert(5, " world").unwrap();
        });
        assert_eq!(checked(&base, &update), Verdict::Allowed);
    }

    #[test]
    fn a_new_thread_a_resolve_and_a_reply_are_all_comment_changes() {
        let (_, base) = shared();
        let new_thread = change(&base, 2, |doc| {
            doc.get_map(COMMENTS)
                .insert_container("file-1/thread-2", LoroMap::new())
                .unwrap()
                .insert("quote", "x")
                .unwrap();
        });
        assert_eq!(checked(&base, &new_thread), Verdict::ChangesComments);
        let resolve = change(&base, 3, |doc| {
            thread_of(doc).insert("resolved", true).unwrap();
        });
        assert_eq!(checked(&base, &resolve), Verdict::ChangesComments);
        let reply = change(&base, 4, |doc| {
            let Some(loro::ValueOrContainer::Container(loro::Container::List(messages))) =
                thread_of(doc).get("messages")
            else {
                panic!("the messages exist");
            };
            let message = messages.insert_container(1, LoroMap::new()).unwrap();
            message.insert("body", "reply").unwrap();
        });
        assert_eq!(checked(&base, &reply), Verdict::ChangesComments);
        let edit_body = change(&base, 5, |doc| {
            let Some(loro::ValueOrContainer::Container(loro::Container::List(messages))) =
                thread_of(doc).get("messages")
            else {
                panic!("the messages exist");
            };
            let Some(loro::ValueOrContainer::Container(loro::Container::Map(message))) =
                messages.get(0)
            else {
                panic!("the message exists");
            };
            message.insert("body", "edited").unwrap();
        });
        assert_eq!(checked(&base, &edit_body), Verdict::ChangesComments);
    }

    #[test]
    fn a_change_that_hides_a_comment_inside_typing_is_still_a_comment_change() {
        let (_, base) = shared();
        let mixed = change(&base, 2, |doc| {
            doc.get_text("text").insert(0, "Oh ").unwrap();
            thread_of(doc).insert("deleted", true).unwrap();
        });
        assert_eq!(checked(&base, &mixed), Verdict::ChangesComments);
    }

    #[test]
    fn a_change_that_builds_on_unknown_changes_cannot_be_checked() {
        let (_, base) = shared();
        let first = change(&base, 2, |doc| {
            doc.get_text("text").insert(0, "A").unwrap();
        });
        let doc = LoroDoc::new();
        doc.import(&base).unwrap();
        doc.import(&first).unwrap();
        doc.set_peer_id(2).unwrap();
        let before = doc.oplog_vv();
        doc.get_text("text").insert(0, "B").unwrap();
        doc.commit();
        let second = doc.export(ExportMode::updates(&before)).unwrap();
        assert_eq!(checked(&base, &second), Verdict::Unreadable);
        assert_eq!(checked(&base, b"not a change"), Verdict::Unreadable);
    }

    #[test]
    fn the_guard_keeps_a_bounded_number_of_documents() {
        let guard = CommentGuard::default();
        for _ in 0..(MAX_KEPT + 5) {
            guard.slot(SharedProjectId::new_v7());
        }
        assert!(guard.kept() <= MAX_KEPT);
    }
}
