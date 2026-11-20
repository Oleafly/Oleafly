use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use loro::{ContainerID, ExportMode, Frontiers, LoroDoc, ID};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::console::CommentChangeWhileOff;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::schema::COMMENTS;
use rusqlite::{params, Connection};
use serde_json::json;
use tokio::sync::{Mutex, Notify};

use crate::db::{parse_id, Db};
use crate::error::ServerError;
use crate::mentions::{self, Span};
use crate::peers::{self, Reach};
use crate::projects;
use crate::role_guard::{self, Judged, RoleRule, RoleVerdict};
use crate::security_log::{self, NewSecurityEvent};
use crate::snapshots::{self, Budgeted, Current, Keep, Replay, Snapshots};
use crate::state::AppState;

const IDLE: Duration = Duration::from_secs(15 * 60);
const MAX_SLOTS: usize = 1_024;
const BUSY_TRIES: u32 = 20;
const BUSY_PAUSE: Duration = Duration::from_millis(100);
const BUILD_WAIT: Duration = Duration::from_secs(60);
const WARN_EVERY: Duration = Duration::from_secs(60 * 60);
const RECHECK_PAGE: i64 = 64;
const RECHECK_RETRY: Duration = Duration::from_secs(60);
const MAX_RECHECKS: i64 = 5;
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

struct Slot {
    turn: Mutex<()>,
    editors: Mutex<()>,
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
    #[cfg(feature = "test-support")]
    role_gate: Arc<std::sync::Mutex<Option<Arc<tokio::sync::Semaphore>>>>,
}

#[derive(Default)]
pub(crate) struct MissedTries(std::sync::Mutex<HashMap<SharedProjectId, i64>>);

impl MissedTries {
    pub(crate) fn due(&self, project: SharedProjectId, now: i64) -> bool {
        let mut missed = locked(&self.0);
        if missed.get(&project).is_some_and(|due| now < *due) {
            return false;
        }
        missed.insert(project, next_try(now));
        true
    }

    pub(crate) fn hold(&self, project: SharedProjectId, now: i64) {
        locked(&self.0).insert(project, next_try(now));
    }

    pub(crate) fn forget(&self, project: SharedProjectId) {
        locked(&self.0).remove(&project);
    }
}

#[derive(Default)]
struct Rechecks {
    waiting: std::sync::Mutex<HashSet<SharedProjectId>>,
    running: std::sync::Mutex<HashMap<SharedProjectId, bool>>,
    retrying: std::sync::Mutex<HashSet<SharedProjectId>>,
    missed: MissedTries,
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
    rule: Option<RoleRule>,
}

enum Rechecked {
    Clean,
    ChangedComments,
    BrokeRole,
    NotHeld,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn queue_recheck(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
    reach: &Reach,
    account: AccountId,
    device: DeviceId,
    now: i64,
    rule: Option<RoleRule>,
) -> Result<(), ServerError> {
    let spans = mentions::spans_of(reach);
    if spans.is_empty() {
        return Ok(());
    }
    let spans = serde_json::to_string(&spans).map_err(|error| {
        ServerError::Internal(format!("could not note a comment check: {error}"))
    })?;
    conn.execute(
        "INSERT OR IGNORE INTO comment_rechecks (project_id, seq, spans, account_id, device_id, queued_at, role, comments_off) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            project.to_string(),
            seq_sql(seq),
            spans,
            account.to_string(),
            device.to_string(),
            now,
            rule.map(|rule| projects::role_to_str(rule.role)),
            rule.is_some_and(|rule| rule.comments_off)
        ],
    )?;
    Ok(())
}

fn waiting_rechecks(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<Waiting>, ServerError> {
    let mut statement = conn.prepare_cached(
        "SELECT seq, spans, account_id, device_id, role, comments_off FROM comment_rechecks WHERE project_id = ?1 ORDER BY attempts, seq LIMIT ?2",
    )?;
    let rows = statement
        .query_map(params![project.to_string(), RECHECK_PAGE], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(seq, spans, account, device, role, comments_off)| {
            let account: Option<AccountId> = account.parse().ok();
            Waiting {
                seq: u64::try_from(seq).unwrap_or(0),
                spans: serde_json::from_str(&spans).unwrap_or_default(),
                rule: role.and_then(|role| {
                    Some(RoleRule {
                        role: projects::role_from_str(&role).ok()?,
                        account: account?,
                        comments_off,
                    })
                }),
                account,
                device,
            }
        })
        .collect())
}

struct Settled {
    given_up: usize,
    scans: usize,
}

fn settle_rechecks(
    conn: &mut Connection,
    project: SharedProjectId,
    rechecked: &[(Waiting, Rechecked, bool)],
    mail: bool,
    now: i64,
) -> Result<Settled, ServerError> {
    let transaction = conn.transaction()?;
    let mut scans = 0;
    for (waiting, outcome, touched) in rechecked {
        if *touched
            && mail
            && mentions::queue_spans(&transaction, project, waiting.seq, &waiting.spans)?
        {
            scans += 1;
        }
        let kind = match outcome {
            Rechecked::NotHeld => {
                transaction.execute(
                    "UPDATE comment_rechecks SET attempts = attempts + 1 WHERE project_id = ?1 AND seq = ?2",
                    params![project.to_string(), seq_sql(waiting.seq)],
                )?;
                continue;
            }
            Rechecked::ChangedComments => {
                tracing::warn!(
                    "Change {} to project {project} changed comments while they were off. It was stored before it could be checked, so the project's members have it.",
                    waiting.seq
                );
                Some(SecurityEventKind::CommentsChangedWhileOff)
            }
            Rechecked::BrokeRole => {
                tracing::warn!(
                    "Change {} to project {project} from device {} did something its writer's role does not allow, such as changing or taking back what someone else wrote. It was stored before it could be checked, so the project's members have it.",
                    waiting.seq,
                    waiting.device
                );
                Some(SecurityEventKind::ChangeBrokeRole)
            }
            Rechecked::Clean => None,
        };
        if let Some(kind) = kind {
            security_log::record(
                &transaction,
                now,
                NewSecurityEvent {
                    actor: waiting.account,
                    kind,
                    target: Some(project.to_string()),
                    ip: None,
                    detail: json!({
                        "project": project.to_string(),
                        "seq": waiting.seq,
                        "device": waiting.device,
                    }),
                },
            )?;
        }
        transaction.execute(
            "DELETE FROM comment_rechecks WHERE project_id = ?1 AND seq = ?2",
            params![project.to_string(), seq_sql(waiting.seq)],
        )?;
    }
    let given_up = give_up(&transaction, project)?;
    transaction.commit()?;
    Ok(Settled { given_up, scans })
}

fn next_try(now: i64) -> i64 {
    now.saturating_add(i64::try_from(RECHECK_RETRY.as_millis()).unwrap_or(i64::MAX))
}

fn give_up(conn: &Connection, project: SharedProjectId) -> Result<usize, ServerError> {
    Ok(conn.execute(
        "DELETE FROM comment_rechecks WHERE project_id = ?1 AND attempts >= ?2",
        params![project.to_string(), MAX_RECHECKS],
    )?)
}

fn missed_read(conn: &mut Connection, project: SharedProjectId) -> Result<usize, ServerError> {
    let transaction = conn.transaction()?;
    transaction.execute(
        "UPDATE comment_rechecks SET attempts = attempts + 1 WHERE project_id = ?1",
        [project.to_string()],
    )?;
    let given_up = give_up(&transaction, project)?;
    transaction.commit()?;
    Ok(given_up)
}

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

fn rechecked(doc: &LoroDoc, spans: &[Span], rule: Option<&RoleRule>) -> (Rechecked, bool) {
    let held = doc.oplog_vv();
    let trimmed = doc.shallow_since_vv();
    let whole = spans.iter().all(|(peer, start, end)| {
        held.get(peer).copied().unwrap_or(0) >= *end
            && trimmed.get(peer).copied().unwrap_or(0) <= *start
    });
    if !whole {
        return (Rechecked::NotHeld, false);
    }
    let touched = spans.iter().any(|(peer, start, end)| {
        let length = usize::try_from(end.saturating_sub(*start)).unwrap_or(0);
        doc.get_changed_containers_in(ID::new(*peer, *start), length)
            .iter()
            .any(|container| in_comments(doc, container))
    });
    let outcome = match rule {
        Some(rule) => match role_guard::judge_imported(doc, spans, rule) {
            RoleVerdict::Refused => Rechecked::BrokeRole,
            RoleVerdict::ChangesComments => Rechecked::ChangedComments,
            _ => Rechecked::Clean,
        },
        None if touched => Rechecked::ChangedComments,
        None => Rechecked::Clean,
    };
    (outcome, touched)
}

pub async fn resume(state: &AppState) {
    let waiting = state
        .db
        .call(|conn| {
            let projects: Vec<(String, bool)> = conn
                .prepare(
                    "SELECT project_id, MAX(attempts) > 0 FROM comment_rechecks GROUP BY project_id",
                )?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            projects
                .iter()
                .map(|(project, tried)| Ok((parse_id::<SharedProjectId>(project)?, *tried)))
                .collect::<Result<Vec<_>, ServerError>>()
        })
        .await;
    match waiting {
        Ok(projects) => {
            let now = state.clock.now_ms();
            for (project, tried) in projects {
                if tried {
                    state.comment_guard.rechecks.missed.hold(project, now);
                }
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
            rechecks.missed.forget(project);
            return;
        }
        locked(&rechecks.waiting).insert(project);
        match recheck_page(state, project, page).await {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                tracing::warn!(
                    "Could not check the changes to project {project} that were stored without a check: {error}"
                );
                state.comment_guard.recheck_later(state, project);
                return;
            }
        }
    }
}

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
            Current::TooLarge { .. } | Current::Missing => {
                drop(turn);
                if guard.rechecks.missed.due(project, state.clock.now_ms()) {
                    let given_up = state
                        .db
                        .call(move |conn| missed_read(conn, project))
                        .await?;
                    if given_up > 0 {
                        tracing::warn!(
                            "Gave up checking {given_up} changes to project {project} that were stored without a check, because the server could not read the project in {MAX_RECHECKS} tries. If it is too large for OLEAFLY_SNAPSHOT_MEMORY_MB, raise it."
                        );
                    }
                }
                guard.recheck_later(state, project);
                return Ok(false);
            }
        },
    };
    let (replay, seq) = current;
    let (outcomes, replay) = tokio::task::spawn_blocking(move || {
        let outcomes: Vec<(Waiting, Rechecked, bool)> = page
            .into_iter()
            .map(|waiting| {
                let (outcome, touched) =
                    rechecked(replay.doc(), &waiting.spans, waiting.rule.as_ref());
                (waiting, outcome, touched)
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
        .any(|(_, outcome, _)| !matches!(outcome, Rechecked::NotHeld));
    let now = state.clock.now_ms();
    let mail = state.mailer.is_configured();
    let Settled { given_up, scans } = state
        .db
        .call(move |conn| settle_rechecks(conn, project, &outcomes, mail, now))
        .await?;
    if scans > 0 {
        state.mentions.wake(state, project);
    }
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
                editors: Mutex::new(()),
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
        reach: &Reach,
    ) -> Result<Verdict, ServerError> {
        let slot = self.slot(project);
        let current = self
            .current(&slot, db, snapshots, project, reach, true, true)
            .await?;
        let Some((_turn, replay, seq)) = current else {
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

    pub async fn check_role(
        &self,
        db: &Db,
        snapshots: &Snapshots,
        project: SharedProjectId,
        payload: Vec<u8>,
        reach: &Reach,
        rule: RoleRule,
    ) -> Result<Judged, ServerError> {
        #[cfg(feature = "test-support")]
        self.pass_role_gate().await;
        let slot = self.slot(project);
        let patient = rule.role != ProjectRole::Editor;
        let current = self
            .current(&slot, db, snapshots, project, reach, false, patient)
            .await?;
        let Some((_turn, replay, seq)) = current else {
            return Ok(RoleVerdict::Unchecked.into());
        };
        let (judged, replay) = tokio::task::spawn_blocking(move || {
            let before = replay.doc().oplog_frontiers();
            let (judged, intact) = role_guard::judge_change(replay.doc(), &payload, &rule);
            let replay = if intact {
                Some(replay)
            } else {
                rewound(project, &replay, &before).map(|fresh| replay.replaced(fresh))
            };
            (judged, replay)
        })
        .await
        .map_err(|error| ServerError::Internal(format!("a role check failed: {error}")))?;
        if let Some(replay) = replay {
            snapshots.keep(Keep::CommentChecks, project, replay, seq);
        }
        Ok(judged)
    }

    pub async fn spares_comments(
        &self,
        db: &Db,
        snapshots: &Snapshots,
        project: SharedProjectId,
        payload: Vec<u8>,
        reach: &Reach,
    ) -> Result<Option<bool>, ServerError> {
        let slot = self.slot(project);
        let _lane = slot.editors.lock().await;
        let kept = snapshots.take_kept(Keep::EditorChecks, project);
        let current = match snapshots.caught_up(db, project, kept).await? {
            Some(current) if !holds(current.0.doc(), reach) => Some(current),
            _ => match snapshots.read_detached(db, project).await? {
                Current::Read(replay, head) => Some((replay, head)),
                _ => None,
            },
        };
        let Some((replay, seq)) = current else {
            return Ok(None);
        };
        let (spared, replay) = tokio::task::spawn_blocking(move || {
            (role_guard::spares_comments(replay.doc(), &payload), replay)
        })
        .await
        .map_err(|error| ServerError::Internal(format!("an editor check failed: {error}")))?;
        match spared {
            Some(spared) => {
                snapshots.keep(Keep::EditorChecks, project, replay, seq);
                Ok(Some(spared))
            }
            None => {
                snapshots.free([replay]);
                Ok(Some(false))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn current<'s>(
        &self,
        slot: &'s Slot,
        db: &Db,
        snapshots: &Snapshots,
        project: SharedProjectId,
        reach: &Reach,
        warn: bool,
        patient: bool,
    ) -> Result<Option<(tokio::sync::MutexGuard<'s, ()>, Budgeted, u64)>, ServerError> {
        let mut waited_for_build = false;
        for _ in 0..BUSY_TRIES {
            let turn = slot.turn.lock().await;
            let kept = snapshots.take_kept(Keep::CommentChecks, project);
            if let Some((replay, seq)) = snapshots.caught_up(db, project, kept).await? {
                if !holds(replay.doc(), reach) {
                    return Ok(Some((turn, replay, seq)));
                }
            }
            match snapshots.read_current(db, project).await? {
                Current::Read(replay, head) => return Ok(Some((turn, replay, head))),
                Current::Busy if !patient => return Ok(None),
                Current::Busy => {
                    drop(turn);
                    match snapshots.build_running(project) {
                        Some(mut finished) if !waited_for_build => {
                            waited_for_build = true;
                            let _ =
                                tokio::time::timeout(BUILD_WAIT, finished.wait_for(|done| *done))
                                    .await;
                        }
                        _ => tokio::time::sleep(BUSY_PAUSE).await,
                    }
                }
                Current::TooLarge { .. } | Current::Missing if !warn => return Ok(None),
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
        if warn {
            self.warn(
                project,
                "snapshot builds and other reads held the memory budget",
            );
        }
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

    #[cfg(feature = "test-support")]
    pub fn hold_role_checks(&self) -> Arc<tokio::sync::Semaphore> {
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        *self
            .role_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Arc::clone(&gate));
        gate
    }

    #[cfg(feature = "test-support")]
    async fn pass_role_gate(&self) {
        let gate = self
            .role_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(gate) = gate {
            if let Ok(permit) = gate.acquire().await {
                permit.forget();
            }
        }
    }

    pub async fn forget(&self, snapshots: &Snapshots, project: SharedProjectId) {
        let slot = self.slot(project);
        {
            let _turn = slot.turn.lock().await;
            snapshots.forget_kept(Keep::CommentChecks, project);
        }
        let _lane = slot.editors.lock().await;
        snapshots.forget_kept(Keep::EditorChecks, project);
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

fn holds(doc: &LoroDoc, reach: &Reach) -> bool {
    let known = doc.oplog_vv();
    !reach.ends.is_empty()
        && reach
            .ends
            .iter()
            .all(|(peer, end)| known.get(peer).is_some_and(|at| at >= end))
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
    fn a_change_stored_unchecked_with_comments_on_is_judged_later_by_its_writers_role() {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        let message = doc
            .get_map(COMMENTS)
            .insert_container("file-1/thread-1", LoroMap::new())
            .unwrap()
            .insert_container("messages", loro::LoroList::new())
            .unwrap()
            .insert_container(0, LoroMap::new())
            .unwrap();
        message.insert("id", "m1").unwrap();
        message
            .insert("author", "01920000-0000-7000-8000-0000000000b1")
            .unwrap();
        message.insert("body", "first").unwrap();
        doc.commit();
        let base = doc.export(ExportMode::Snapshot).unwrap();
        let editor: AccountId = "01920000-0000-7000-8000-0000000000e1".parse().unwrap();
        let rule = RoleRule {
            role: ProjectRole::Editor,
            account: editor,
            comments_off: false,
        };
        let messages = |doc: &LoroDoc| match thread_of(doc).get("messages") {
            Some(loro::ValueOrContainer::Container(loro::Container::List(messages))) => messages,
            _ => panic!("the messages exist"),
        };
        let later = |edit: &dyn Fn(&LoroDoc), rule: Option<&RoleRule>| {
            let update = change(&base, 2, edit);
            let held = LoroDoc::new();
            held.import(&base).unwrap();
            held.import(&update).unwrap();
            let end = held.oplog_vv().get(&2).copied().unwrap_or(0);
            rechecked(&held, &[(2, 0, end)], rule).0
        };
        let removal = |doc: &LoroDoc| {
            let Some(loro::ValueOrContainer::Container(loro::Container::Map(theirs))) =
                messages(doc).get(0)
            else {
                panic!("the message exists");
            };
            theirs.insert("removed", true).unwrap();
            theirs.insert("deleted", true).unwrap();
            theirs.insert("body", "").unwrap();
        };
        let reply = |doc: &LoroDoc| {
            let own = messages(doc).insert_container(1, LoroMap::new()).unwrap();
            own.insert("id", "m2").unwrap();
            own.insert("author", editor.to_string()).unwrap();
            own.insert("body", "mine").unwrap();
        };
        assert!(matches!(later(&removal, Some(&rule)), Rechecked::BrokeRole));
        assert!(matches!(later(&reply, Some(&rule)), Rechecked::Clean));
        assert!(matches!(later(&reply, None), Rechecked::ChangedComments));
        let off = RoleRule {
            comments_off: true,
            ..rule
        };
        assert!(matches!(
            later(&reply, Some(&off)),
            Rechecked::ChangedComments
        ));
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
