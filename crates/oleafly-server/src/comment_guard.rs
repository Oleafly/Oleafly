use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use loro::{ContainerID, ExportMode, Frontiers, LoroDoc, ID};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::console::CommentChangeWhileOff;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use rusqlite::{params, Connection};
use serde_json::json;
use tokio::sync::{Mutex, Notify};

use crate::db::{parse_id, Db};
use crate::error::ServerError;
use crate::mentions::{self, Span};
use crate::peers::{self, Reach};
use crate::security_log::{self, NewSecurityEvent};
use crate::snapshots::{self, Budgeted, Current, Keep, Replay, Snapshots};
use crate::state::AppState;

pub const COMMENTS: &str = "comments";
const IDLE: Duration = Duration::from_secs(15 * 60);
const MAX_SLOTS: usize = 1_024;
const BUSY_TRIES: u32 = 20;
const BUSY_PAUSE: Duration = Duration::from_millis(100);
// How long a check waits for a snapshot build of its own project, whose
// reservation may have taken the check's kept document.
const BUILD_WAIT: Duration = Duration::from_secs(60);
const WARN_EVERY: Duration = Duration::from_secs(60 * 60);
// Changes stored unchecked are checked in pages of this many, a check the
// budget turned away is tried again after RECHECK_RETRY, and a change the
// project's document doesn't hold is given up after MAX_RECHECKS tries.
const RECHECK_PAGE: i64 = 64;
const RECHECK_RETRY: Duration = Duration::from_secs(60);
const MAX_RECHECKS: i64 = 5;
// The admin overview names changes found in this many recent days.
const NOTICE_DAYS: i64 = 30;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const NOTICES: i64 = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    ChangesComments,
    Unreadable,
    Unchecked,
}

// One check per project runs at a time, so two changes that arrive together
// don't both read the project. The document itself is kept with the
// snapshots, inside their memory budget.
struct Slot {
    turn: Mutex<()>,
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
    warned: Arc<std::sync::Mutex<HashMap<SharedProjectId, Instant>>>,
    rechecks: Arc<Rechecks>,
}

// Changes stored while comments were off but without their check, because
// the project's document didn't fit the snapshot memory budget then. Each
// is checked once it does: when a later check reads the project, a minute
// after the budget was busy, and when the server starts, which is when a
// larger budget takes effect. A change found to change comments is already
// stored and sent, so it goes in the security log and the admin overview.
#[derive(Default)]
struct Rechecks {
    waiting: std::sync::Mutex<HashSet<SharedProjectId>>,
    // Projects being checked, each with whether to go again once done.
    running: std::sync::Mutex<HashMap<SharedProjectId, bool>>,
    retrying: std::sync::Mutex<HashSet<SharedProjectId>>,
    busy: AtomicUsize,
    idle: Notify,
}

struct Running(Arc<Rechecks>);

impl Drop for Running {
    fn drop(&mut self) {
        if self.0.busy.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

fn locked<T>(mutex: &std::sync::Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn seq_sql(seq: u64) -> i64 {
    i64::try_from(seq).unwrap_or(i64::MAX)
}

struct Waiting {
    seq: u64,
    spans: Vec<Span>,
    account: Option<AccountId>,
    device: String,
}

// How a stored change stood once its project's document was read.
enum Rechecked {
    Clean,
    ChangedComments,
    NotHeld,
}

// Notes a change stored without its comment check, in the transaction that
// stores it.
pub(crate) fn queue_recheck(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
    reach: &Reach,
    account: AccountId,
    device: DeviceId,
    now: i64,
) -> Result<(), ServerError> {
    let spans = mentions::spans_of(reach);
    if spans.is_empty() {
        return Ok(());
    }
    let spans = serde_json::to_string(&spans).map_err(|error| {
        ServerError::Internal(format!("could not note a comment check: {error}"))
    })?;
    conn.execute(
        "INSERT OR IGNORE INTO comment_rechecks (project_id, seq, spans, account_id, device_id, queued_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            project.to_string(),
            seq_sql(seq),
            spans,
            account.to_string(),
            device.to_string(),
            now
        ],
    )?;
    Ok(())
}

// Changes tried fewer times come first, so one the document doesn't hold
// never keeps the rest waiting.
fn waiting_rechecks(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<Waiting>, ServerError> {
    let mut statement = conn.prepare_cached(
        "SELECT seq, spans, account_id, device_id FROM comment_rechecks WHERE project_id = ?1 ORDER BY attempts, seq LIMIT ?2",
    )?;
    let rows = statement
        .query_map(params![project.to_string(), RECHECK_PAGE], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(seq, spans, account, device)| Waiting {
            seq: u64::try_from(seq).unwrap_or(0),
            spans: serde_json::from_str(&spans).unwrap_or_default(),
            account: account.parse().ok(),
            device,
        })
        .collect())
}

fn settle_rechecks(
    conn: &mut Connection,
    project: SharedProjectId,
    rechecked: &[(Waiting, Rechecked)],
    now: i64,
) -> Result<usize, ServerError> {
    let transaction = conn.transaction()?;
    for (waiting, outcome) in rechecked {
        match outcome {
            Rechecked::NotHeld => {
                transaction.execute(
                    "UPDATE comment_rechecks SET attempts = attempts + 1 WHERE project_id = ?1 AND seq = ?2",
                    params![project.to_string(), seq_sql(waiting.seq)],
                )?;
                continue;
            }
            Rechecked::ChangedComments => {
                security_log::record(
                    &transaction,
                    now,
                    NewSecurityEvent {
                        actor: waiting.account,
                        kind: SecurityEventKind::CommentsChangedWhileOff,
                        target: Some(project.to_string()),
                        ip: None,
                        detail: json!({
                            "project": project.to_string(),
                            "seq": waiting.seq,
                            "device": waiting.device,
                        }),
                    },
                )?;
                tracing::warn!(
                    "Change {} to project {project} changed comments while they were off. It was stored before it could be checked, so the project's members have it.",
                    waiting.seq
                );
            }
            Rechecked::Clean => {}
        }
        transaction.execute(
            "DELETE FROM comment_rechecks WHERE project_id = ?1 AND seq = ?2",
            params![project.to_string(), seq_sql(waiting.seq)],
        )?;
    }
    let given_up = transaction.execute(
        "DELETE FROM comment_rechecks WHERE project_id = ?1 AND attempts >= ?2",
        params![project.to_string(), MAX_RECHECKS],
    )?;
    transaction.commit()?;
    Ok(given_up)
}

// Changes found to have changed comments while they were off, newest first.
pub fn noticed(conn: &Connection, now: i64) -> Result<Vec<CommentChangeWhileOff>, ServerError> {
    let mut statement = conn.prepare_cached(
        "SELECT s.target, p.title, s.actor, s.at FROM security_log s LEFT JOIN projects p ON p.id = s.target \
         WHERE s.kind = ?1 AND s.at >= ?2 ORDER BY s.id DESC LIMIT ?3",
    )?;
    let rows = statement
        .query_map(
            params![
                security_log::kind_to_str(&SecurityEventKind::CommentsChangedWhileOff),
                now - NOTICE_DAYS * DAY_MS,
                NOTICES
            ],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(project, title, actor, at)| {
            Some(CommentChangeWhileOff {
                project_id: project?.parse().ok()?,
                project_title: title,
                account_id: actor.and_then(|actor| actor.parse().ok()),
                at,
            })
        })
        .collect())
}

// Whether the stored change with these spans changed comments, read from a
// document that holds it.
fn rechecked(doc: &LoroDoc, spans: &[Span]) -> Rechecked {
    let held = doc.oplog_vv();
    let trimmed = doc.shallow_since_vv();
    let whole = spans.iter().all(|(peer, start, end)| {
        held.get(peer).copied().unwrap_or(0) >= *end
            && trimmed.get(peer).copied().unwrap_or(0) <= *start
    });
    if !whole {
        return Rechecked::NotHeld;
    }
    let changed = spans.iter().any(|(peer, start, end)| {
        let length = usize::try_from(end.saturating_sub(*start)).unwrap_or(0);
        doc.get_changed_containers_in(ID::new(*peer, *start), length)
            .iter()
            .any(|container| in_comments(doc, container))
    });
    if changed {
        Rechecked::ChangedComments
    } else {
        Rechecked::Clean
    }
}

// Reads which projects have changes waiting and checks them.
pub async fn resume(state: &AppState) {
    let waiting = state
        .db
        .call(|conn| {
            let projects: Vec<String> = conn
                .prepare("SELECT DISTINCT project_id FROM comment_rechecks")?
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            projects
                .iter()
                .map(|project| parse_id::<SharedProjectId>(project))
                .collect::<Result<Vec<_>, _>>()
        })
        .await;
    match waiting {
        Ok(projects) => {
            for project in projects {
                state.comment_guard.recheck(state, project);
            }
        }
        Err(error) => {
            tracing::warn!("Could not find changes waiting to be checked for comments: {error}")
        }
    }
}

async fn recheck_project(state: &AppState, project: SharedProjectId) {
    loop {
        let page = match state
            .db
            .read(move |conn| waiting_rechecks(conn, project))
            .await
        {
            Ok(page) => page,
            Err(error) => {
                tracing::warn!(
                    "Could not read the changes to project {project} waiting for a comment check: {error}"
                );
                return;
            }
        };
        let rechecks = &state.comment_guard.rechecks;
        if page.is_empty() {
            locked(&rechecks.waiting).remove(&project);
            return;
        }
        locked(&rechecks.waiting).insert(project);
        match recheck_page(state, project, page).await {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                tracing::warn!(
                    "Could not check the changes to project {project} stored while comments were off: {error}"
                );
                state.comment_guard.recheck_later(state, project);
                return;
            }
        }
    }
}

// Checks one page. False when the project's document can't be read now,
// or the document doesn't hold any of the page's changes yet.
async fn recheck_page(
    state: &AppState,
    project: SharedProjectId,
    page: Vec<Waiting>,
) -> Result<bool, ServerError> {
    let guard = &state.comment_guard;
    let slot = guard.slot(project);
    let turn = slot.turn.lock().await;
    let kept = state.snapshots.take_kept(Keep::CommentChecks, project);
    let current = match state.snapshots.caught_up(&state.db, project, kept).await? {
        Some(current) => current,
        None => match state.snapshots.read_current(&state.db, project).await? {
            Current::Read(replay, head) => (replay, head),
            Current::Busy => {
                guard.recheck_later(state, project);
                return Ok(false);
            }
            // The budget only grows when the server starts again, and that
            // checks every project with changes waiting.
            Current::TooLarge { .. } | Current::Missing => return Ok(false),
        },
    };
    let (replay, seq) = current;
    let (outcomes, replay) = tokio::task::spawn_blocking(move || {
        let outcomes: Vec<(Waiting, Rechecked)> = page
            .into_iter()
            .map(|waiting| {
                let outcome = rechecked(replay.doc(), &waiting.spans);
                (waiting, outcome)
            })
            .collect();
        (outcomes, replay)
    })
    .await
    .map_err(|error| ServerError::Internal(format!("a comment check failed: {error}")))?;
    state
        .snapshots
        .keep(Keep::CommentChecks, project, replay, seq);
    drop(turn);
    let progress = outcomes
        .iter()
        .any(|(_, outcome)| !matches!(outcome, Rechecked::NotHeld));
    let now = state.clock.now_ms();
    let given_up = state
        .db
        .call(move |conn| settle_rechecks(conn, project, &outcomes, now))
        .await?;
    if given_up > 0 {
        tracing::warn!(
            "Gave up checking {given_up} changes to project {project} for comment changes, because the server's copy of the project does not hold them."
        );
    }
    if !progress {
        guard.recheck_later(state, project);
    }
    Ok(progress)
}

impl CommentGuard {
    // Checks the project's changes waiting for a check, now or once the
    // check running for it is done.
    pub fn recheck(&self, state: &AppState, project: SharedProjectId) {
        locked(&self.rechecks.waiting).insert(project);
        {
            let mut running = locked(&self.rechecks.running);
            if let Some(again) = running.get_mut(&project) {
                *again = true;
                return;
            }
            running.insert(project, false);
        }
        self.rechecks.busy.fetch_add(1, Ordering::SeqCst);
        let running = Running(Arc::clone(&self.rechecks));
        let state = state.clone();
        tokio::spawn(async move {
            let _running = running;
            loop {
                recheck_project(&state, project).await;
                let mut running = locked(&state.comment_guard.rechecks.running);
                match running.get_mut(&project) {
                    Some(again) if *again => *again = false,
                    _ => {
                        running.remove(&project);
                        return;
                    }
                }
            }
        });
    }

    // A check that could read the project's document shows the budget has
    // room for it, so the changes waiting for the project go next.
    pub fn read_project(&self, state: &AppState, project: SharedProjectId) {
        if locked(&self.rechecks.waiting).contains(&project) {
            self.recheck(state, project);
        }
    }

    fn recheck_later(&self, state: &AppState, project: SharedProjectId) {
        if !locked(&self.rechecks.retrying).insert(project) {
            return;
        }
        let state = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(RECHECK_RETRY).await;
            locked(&state.comment_guard.rechecks.retrying).remove(&project);
            state.comment_guard.recheck(&state, project);
        });
    }

    // Waits until no check of changes stored unchecked is running.
    pub async fn rechecks_settled(&self) {
        loop {
            let idle = self.rechecks.idle.notified();
            if self.rechecks.busy.load(Ordering::SeqCst) == 0 {
                return;
            }
            idle.await;
        }
    }

    fn slot(&self, project: SharedProjectId) -> Arc<Slot> {
        let now = Instant::now();
        let mut slots = self.slots.lock().unwrap_or_else(PoisonError::into_inner);
        slots.retain(|key, slot| {
            *key == project || Arc::strong_count(slot) > 1 || slot.idle(now) < IDLE
        });
        if !slots.contains_key(&project) && slots.len() >= MAX_SLOTS {
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
                turn: Mutex::new(()),
                used: std::sync::Mutex::new(now),
            })
        });
        *slot.used.lock().unwrap_or_else(PoisonError::into_inner) = now;
        Arc::clone(slot)
    }

    #[cfg(test)]
    fn slots(&self) -> usize {
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
        let _turn = slot.turn.lock().await;
        let kept = snapshots.take_kept(Keep::CommentChecks, project);
        let current = match snapshots.caught_up(db, project, kept).await? {
            Some(current) => Some(current),
            None => self.read(db, snapshots, project).await?,
        };
        let Some((replay, seq)) = current else {
            return Ok(Verdict::Unchecked);
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
            snapshots.keep(Keep::CommentChecks, project, replay, seq);
        }
        Ok(verdict)
    }

    // Kept documents already give their memory to this read when it needs
    // it, so waiting here only waits for documents in use and builds. A
    // build of this very project is waited for to its end, once, since its
    // memory comes back when it finishes.
    async fn read(
        &self,
        db: &Db,
        snapshots: &Snapshots,
        project: SharedProjectId,
    ) -> Result<Option<(Budgeted, u64)>, ServerError> {
        let mut waited_for_build = false;
        for _ in 0..BUSY_TRIES {
            match snapshots.read_current(db, project).await? {
                Current::Read(replay, head) => return Ok(Some((replay, head))),
                Current::Busy => match snapshots.build_running(project) {
                    Some(mut finished) if !waited_for_build => {
                        waited_for_build = true;
                        let _ =
                            tokio::time::timeout(BUILD_WAIT, finished.wait_for(|done| *done)).await;
                    }
                    _ => tokio::time::sleep(BUSY_PAUSE).await,
                },
                Current::TooLarge { needed, allowed } => {
                    self.warn(project, &format!(
                        "reading it needs about {} MB and OLEAFLY_SNAPSHOT_MEMORY_MB allows {} MB. Raise OLEAFLY_SNAPSHOT_MEMORY_MB to keep comments off for it",
                        needed.div_ceil(1024 * 1024),
                        allowed.div_ceil(1024 * 1024)
                    ));
                    return Ok(None);
                }
                Current::Missing => {
                    self.warn(project, "its document could not be read");
                    return Ok(None);
                }
            }
        }
        self.warn(
            project,
            "snapshot builds and other reads held the memory budget",
        );
        Ok(None)
    }

    fn warn(&self, project: SharedProjectId, why: &str) {
        let now = Instant::now();
        let mut warned = self.warned.lock().unwrap_or_else(PoisonError::into_inner);
        warned.retain(|_, at| now.saturating_duration_since(*at) < WARN_EVERY);
        if warned.len() < MAX_SLOTS && !warned.contains_key(&project) {
            warned.insert(project, now);
            tracing::warn!(
                "Stored a change to project {project} without checking it for comments, because {why}. The server checks it once it can read the project."
            );
        }
    }

    pub async fn forget(&self, snapshots: &Snapshots, project: SharedProjectId) {
        let slot = self.slot(project);
        let _turn = slot.turn.lock().await;
        snapshots.forget_kept(Keep::CommentChecks, project);
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
    fn the_guard_keeps_a_bounded_number_of_slots() {
        let guard = CommentGuard::default();
        for _ in 0..(MAX_SLOTS + 5) {
            guard.slot(SharedProjectId::new_v7());
        }
        assert!(guard.slots() <= MAX_SLOTS);
    }
}
