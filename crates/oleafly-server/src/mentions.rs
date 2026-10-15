use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use loro::{
    Container, ContainerID, ContainerTrait, LoroDoc, LoroMap, LoroValue, TreeID, TreeParentId,
    ValueOrContainer, ID,
};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectStatus;
use rusqlite::{params, Connection};
use tokio::sync::Notify;

use crate::db::{parse_id, Db};
use crate::error::ServerError;
use crate::mail::messages::{self, Mention};
use crate::mail::{notify, preferences, EmailKind, OutgoingEmail};
use crate::members;
use crate::peers::{self, Reach};
use crate::projects;
use crate::settings;
use crate::snapshots::{self, Budgeted};
use crate::state::AppState;

pub type Span = (u64, i32, i32);

pub const WINDOW_MS: i64 = 60_000;
const SCAN_PAGE: i64 = 64;
const MAX_ATTEMPTS: i64 = 5;
const RETRY: Duration = Duration::from_secs(60);
const KEPT_CHARS: usize = 2_000;
const KEPT_DOCUMENTS: usize = 4;
const KEPT_IDLE: Duration = Duration::from_secs(5 * 60);

const WATCHED_KEYS: [&[u8]; 3] = [b"\x08mentions", b"\x07deleted", b"\x04body"];
const COMMENTS: &str = "comments";
const MESSAGES: &str = "messages";
const TREE: &str = "tree";
const TRASH: &str = "~trash";
const WRITTEN: [&str; 3] = ["author", "body", "mentions"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub file_id: String,
    pub thread_id: String,
    pub message_id: String,
    pub author: AccountId,
    pub mentions: Vec<AccountId>,
    pub writers: Vec<u64>,
    pub path: Option<String>,
    pub quote: String,
    pub body: String,
}

pub fn may_mention(payload: &[u8]) -> bool {
    WATCHED_KEYS
        .iter()
        .any(|key| payload.windows(key.len()).any(|window| window == *key))
}

fn text_of(value: Option<&LoroValue>) -> Option<String> {
    match value {
        Some(LoroValue::String(text)) => Some(text.to_string()),
        _ => None,
    }
}

fn accounts_of(value: Option<&LoroValue>) -> Vec<AccountId> {
    let Some(LoroValue::List(items)) = value else {
        return Vec::new();
    };
    let mut accounts = Vec::new();
    for item in items.iter() {
        if let Some(account) = text_of(Some(item)).and_then(|text| text.parse().ok()) {
            if !accounts.contains(&account) {
                accounts.push(account);
            }
        }
    }
    accounts
}

struct Message {
    id: String,
    author: AccountId,
    mentions: Vec<AccountId>,
    writers: Vec<u64>,
    body: String,
}

fn is_deleted(value: Option<&LoroValue>) -> bool {
    matches!(value, Some(LoroValue::Bool(true)))
}

fn read_message(map: &LoroMap, thread_deleted: bool) -> Option<Message> {
    let LoroValue::Map(fields) = map.get_deep_value() else {
        return None;
    };
    let id = text_of(fields.get("id"))?;
    let author = text_of(fields.get("author"))?.parse().ok()?;
    if thread_deleted || is_deleted(fields.get("deleted")) {
        return Some(Message {
            id,
            author,
            mentions: Vec::new(),
            writers: Vec::new(),
            body: String::new(),
        });
    }
    let mentions = accounts_of(fields.get("mentions"));
    let mut writers = Vec::new();
    if !mentions.is_empty() {
        for key in WRITTEN {
            let peer = map.get_last_editor(key)?;
            if !writers.contains(&peer) {
                writers.push(peer);
            }
        }
        writers.sort_unstable();
    }
    Some(Message {
        id,
        author,
        mentions,
        writers,
        body: text_of(fields.get("body")).unwrap_or_default(),
    })
}

fn changed_in(doc: &LoroDoc, spans: &[Span]) -> HashSet<ContainerID> {
    let mut changed = HashSet::new();
    for (peer, start, end) in spans {
        let length = usize::try_from(end.saturating_sub(*start)).unwrap_or(0);
        if length > 0 {
            changed.extend(doc.get_changed_containers_in(ID::new(*peer, *start), length));
        }
    }
    changed
}

struct Files {
    nodes: HashMap<TreeID, (String, Option<TreeID>, bool)>,
    ids: HashMap<String, TreeID>,
}

impl Files {
    fn read(doc: &LoroDoc) -> Files {
        let tree = doc.get_tree(TREE);
        let mut nodes = HashMap::new();
        let mut ids = HashMap::new();
        for node in tree.get_nodes(false) {
            let parent = match node.parent {
                TreeParentId::Root => None,
                TreeParentId::Node(parent) => Some(parent),
                _ => continue,
            };
            let Ok(meta) = tree.get_meta(node.id) else {
                continue;
            };
            let LoroValue::Map(fields) = meta.get_deep_value() else {
                continue;
            };
            let id = text_of(fields.get("id")).unwrap_or_default();
            let name = text_of(fields.get("name")).unwrap_or_default();
            nodes.insert(node.id, (name, parent, id == TRASH));
            if !id.is_empty() {
                ids.insert(id, node.id);
            }
        }
        Files { nodes, ids }
    }

    fn path(&self, file_id: &str) -> Option<String> {
        let mut names = Vec::new();
        let mut next = self.ids.get(file_id).copied();
        while let Some(node) = next {
            let (name, parent, trash) = self.nodes.get(&node)?;
            if *trash || names.len() > self.nodes.len() {
                return None;
            }
            names.push(name.clone());
            next = *parent;
        }
        if names.is_empty() {
            return None;
        }
        names.reverse();
        Some(names.join("/"))
    }
}

pub fn found_in(doc: &LoroDoc, spans: &[Span]) -> Vec<Found> {
    let changed = changed_in(doc, spans);
    if changed.is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    doc.get_map(COMMENTS).for_each(|key, value| {
        let Some((file_id, thread_id)) = key.split_once('/') else {
            return;
        };
        let ValueOrContainer::Container(Container::Map(thread)) = value else {
            return;
        };
        let Some(ValueOrContainer::Container(Container::List(messages))) = thread.get(MESSAGES)
        else {
            return;
        };
        let quote = match thread.get("quote") {
            Some(ValueOrContainer::Value(value)) => text_of(Some(&value)).unwrap_or_default(),
            _ => String::new(),
        };
        let thread_deleted = match thread.get("deleted") {
            Some(ValueOrContainer::Value(value)) => is_deleted(Some(&value)),
            _ => false,
        };
        let thread_withdrawn = thread_deleted && changed.contains(&thread.id());
        for index in 0..messages.len() {
            let Some(ValueOrContainer::Container(Container::Map(map))) = messages.get(index) else {
                continue;
            };
            if !thread_withdrawn && !changed.contains(&map.id()) {
                continue;
            }
            if let Some(message) = read_message(&map, thread_deleted) {
                found.push(Found {
                    file_id: file_id.to_string(),
                    thread_id: thread_id.to_string(),
                    message_id: message.id,
                    author: message.author,
                    mentions: message.mentions,
                    writers: message.writers,
                    path: None,
                    quote: quote.clone(),
                    body: message.body,
                });
            }
        }
    });
    if !found.is_empty() {
        let files = Files::read(doc);
        for item in &mut found {
            item.path = files.path(&item.file_id);
        }
    }
    found
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn seq_sql(seq: u64) -> i64 {
    i64::try_from(seq).unwrap_or(i64::MAX)
}

fn kept(text: &str) -> String {
    text.chars().take(KEPT_CHARS).collect()
}

pub fn queue(
    conn: &Connection,
    project: SharedProjectId,
    seq: u64,
    reach: &Reach,
) -> Result<(), ServerError> {
    let spans: Vec<Span> = reach
        .ends
        .iter()
        .map(|(peer, end)| {
            let start = reach
                .starts
                .iter()
                .find(|(started, _)| started == peer)
                .map_or(0, |(_, start)| *start);
            (*peer, start, *end)
        })
        .filter(|(_, start, end)| start < end)
        .collect();
    if spans.is_empty() || !settings::load(conn)?.email_notifications {
        return Ok(());
    }
    let spans = serde_json::to_string(&spans).map_err(|error| {
        ServerError::Internal(format!("could not note a mention scan: {error}"))
    })?;
    conn.execute(
        "INSERT OR IGNORE INTO mention_scans (project_id, seq, spans) VALUES (?1, ?2, ?3)",
        params![project.to_string(), seq_sql(seq), spans],
    )?;
    Ok(())
}

#[derive(Default)]
struct Inner {
    scanning: Mutex<HashMap<SharedProjectId, bool>>,
    busy: AtomicUsize,
    idle: Notify,
    delivering: AtomicBool,
    due: Notify,
    sending: tokio::sync::Mutex<()>,
    kept: Mutex<HashMap<SharedProjectId, Kept>>,
    built: AtomicUsize,
}

struct Kept {
    replay: Budgeted,
    seq: u64,
    used: Instant,
}

#[derive(Clone, Default)]
pub struct Mentions {
    inner: Arc<Inner>,
}

struct Busy(Arc<Inner>);

impl Drop for Busy {
    fn drop(&mut self) {
        if self.0.busy.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

impl Mentions {
    pub fn wake(&self, state: &AppState, project: SharedProjectId) {
        if !state.mailer.is_configured() {
            return;
        }
        {
            let mut scanning = locked(&self.inner.scanning);
            if let Some(again) = scanning.get_mut(&project) {
                *again = true;
                return;
            }
            scanning.insert(project, false);
        }
        self.inner.busy.fetch_add(1, Ordering::SeqCst);
        let busy = Busy(Arc::clone(&self.inner));
        let state = state.clone();
        tokio::spawn(async move {
            let _busy = busy;
            loop {
                scan(&state, project).await;
                let mut scanning = locked(&state.mentions.inner.scanning);
                match scanning.get_mut(&project) {
                    Some(again) if *again => *again = false,
                    _ => {
                        scanning.remove(&project);
                        return;
                    }
                }
            }
        });
    }

    pub async fn settled(&self) {
        loop {
            let idle = self.inner.idle.notified();
            if self.inner.busy.load(Ordering::SeqCst) == 0 {
                return;
            }
            idle.await;
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn documents_built(&self) -> usize {
        self.inner.built.load(Ordering::SeqCst)
    }

    fn take_kept(&self, project: SharedProjectId) -> Option<(Budgeted, u64)> {
        let mut kept = locked(&self.inner.kept);
        let now = Instant::now();
        kept.retain(|_, document| now.duration_since(document.used) < KEPT_IDLE);
        kept.remove(&project)
            .map(|document| (document.replay, document.seq))
    }

    fn keep(&self, project: SharedProjectId, replay: Budgeted, seq: u64) {
        let mut kept = locked(&self.inner.kept);
        let now = Instant::now();
        kept.retain(|_, document| now.duration_since(document.used) < KEPT_IDLE);
        if !kept.contains_key(&project) && kept.len() >= KEPT_DOCUMENTS {
            let oldest = kept
                .iter()
                .min_by_key(|(_, document)| document.used)
                .map(|(key, _)| *key);
            if let Some(oldest) = oldest {
                kept.remove(&oldest);
            }
        }
        kept.insert(
            project,
            Kept {
                replay,
                seq,
                used: now,
            },
        );
    }

    fn deliver_soon(&self, state: &AppState) {
        if !self.inner.delivering.swap(true, Ordering::SeqCst) {
            tokio::spawn(delivery_loop(state.clone()));
        }
        self.inner.due.notify_one();
    }
}

fn waiting_scans(
    conn: &Connection,
    project: SharedProjectId,
) -> Result<Vec<(u64, Vec<Span>)>, ServerError> {
    if !settings::load(conn)?.email_notifications {
        conn.execute(
            "DELETE FROM mention_scans WHERE project_id = ?1",
            [project.to_string()],
        )?;
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare_cached(
        "SELECT seq, spans FROM mention_scans WHERE project_id = ?1 ORDER BY seq LIMIT ?2",
    )?;
    let rows = statement
        .query_map(params![project.to_string(), SCAN_PAGE], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(seq, spans)| {
            (
                u64::try_from(seq).unwrap_or(0),
                serde_json::from_str(&spans).unwrap_or_default(),
            )
        })
        .collect())
}

async fn scan(state: &AppState, project: SharedProjectId) {
    loop {
        let waiting = match state
            .db
            .call(move |conn| waiting_scans(conn, project))
            .await
        {
            Ok(waiting) => waiting,
            Err(error) => {
                tracing::warn!("Could not look for mentions in project {project}: {error}");
                return;
            }
        };
        if waiting.is_empty() {
            return;
        }
        match scan_page(state, project, &waiting).await {
            Ok(recorded) => {
                if recorded > 0 {
                    state.mentions.deliver_soon(state);
                }
            }
            Err(error) => {
                give_back(state, project, &waiting, &error).await;
                return;
            }
        }
    }
}

async fn caught_up(
    db: &Db,
    project: SharedProjectId,
    kept: Option<(Budgeted, u64)>,
) -> Result<Option<(Budgeted, u64)>, ServerError> {
    let Some((replay, seq)) = kept else {
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

async fn document(
    state: &AppState,
    project: SharedProjectId,
) -> Result<(Budgeted, u64), ServerError> {
    let kept = state.mentions.take_kept(project);
    if let Some(current) = caught_up(&state.db, project, kept).await? {
        return Ok(current);
    }
    state.mentions.inner.built.fetch_add(1, Ordering::SeqCst);
    state
        .snapshots
        .current(&state.db, project)
        .await?
        .ok_or_else(|| {
            ServerError::Internal("the project's document could not be read".to_string())
        })
}

async fn scan_page(
    state: &AppState,
    project: SharedProjectId,
    waiting: &[(u64, Vec<Span>)],
) -> Result<usize, ServerError> {
    let (replay, seq) = document(state, project).await?;
    let spans: Vec<Span> = waiting
        .iter()
        .flat_map(|(_, spans)| spans.iter().copied())
        .collect();
    let (found, replay) = tokio::task::spawn_blocking(move || {
        let found = found_in(replay.doc(), &spans);
        (found, replay)
    })
    .await
    .map_err(|error| ServerError::Internal(format!("looking for mentions failed: {error}")))?;
    state.mentions.keep(project, replay, seq);
    let seqs: Vec<u64> = waiting.iter().map(|(seq, _)| *seq).collect();
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let recorded = record(&transaction, project, &found, now)?;
            for seq in seqs {
                transaction.execute(
                    "DELETE FROM mention_scans WHERE project_id = ?1 AND seq = ?2",
                    params![project.to_string(), seq_sql(seq)],
                )?;
            }
            transaction.commit()?;
            Ok(recorded)
        })
        .await
}

async fn give_back(
    state: &AppState,
    project: SharedProjectId,
    waiting: &[(u64, Vec<Span>)],
    error: &ServerError,
) {
    let seqs: Vec<u64> = waiting.iter().map(|(seq, _)| *seq).collect();
    let counted = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            for seq in seqs {
                transaction.execute(
                    "UPDATE mention_scans SET attempts = attempts + 1 WHERE project_id = ?1 AND seq = ?2",
                    params![project.to_string(), seq_sql(seq)],
                )?;
            }
            let dropped = transaction.execute(
                "DELETE FROM mention_scans WHERE project_id = ?1 AND attempts >= ?2",
                params![project.to_string(), MAX_ATTEMPTS],
            )?;
            let left: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM mention_scans WHERE project_id = ?1",
                [project.to_string()],
                |row| row.get(0),
            )?;
            transaction.commit()?;
            Ok((dropped, left))
        })
        .await;
    match counted {
        Ok((dropped, left)) => {
            if dropped > 0 {
                tracing::warn!(
                    "Gave up looking for mentions in {dropped} changes to project {project}: {error}"
                );
            }
            if left > 0 {
                tracing::warn!(
                    "Could not look for mentions in project {project} yet: {error}. Trying again in 1 min."
                );
                let state = state.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(RETRY).await;
                    state.mentions.wake(&state, project);
                });
            }
        }
        Err(failed) => {
            tracing::warn!("Could not look for mentions in project {project}: {failed}");
        }
    }
}

fn reachable(
    conn: &Connection,
    project: SharedProjectId,
    person: AccountId,
) -> Result<bool, ServerError> {
    Ok(projects::role_of(conn, project, person)?.is_some()
        && notify::is_active(conn, person)?
        && preferences::mentions(conn, person)?
        && !notify::verified_emails(conn, person)?.is_empty())
}

fn waiting_due(conn: &Connection, person: AccountId) -> Result<Option<i64>, ServerError> {
    Ok(conn.query_row(
        "SELECT MIN(due_at) FROM mention_emails WHERE recipient_id = ?1 AND sent_at IS NULL",
        [person.to_string()],
        |row| row.get(0),
    )?)
}

fn record(
    conn: &Connection,
    project: SharedProjectId,
    found: &[Found],
    now: i64,
) -> Result<usize, ServerError> {
    if found.is_empty() || !settings::load(conn)?.email_notifications {
        return Ok(0);
    }
    let Some(row) = projects::project_row(conn, project)? else {
        return Ok(0);
    };
    if row.status != ProjectStatus::Active {
        return Ok(0);
    }
    let writers: HashMap<u64, AccountId> = peers::table(conn, project)?
        .into_iter()
        .map(|peer| (peer.peer, peer.account_id))
        .collect();
    let mut recorded = 0;
    for item in found {
        let written_by_author = !item.writers.is_empty()
            && item
                .writers
                .iter()
                .all(|peer| writers.get(peer) == Some(&item.author));
        let still_mentioned: &[AccountId] = if written_by_author {
            &item.mentions
        } else {
            &[]
        };
        withdraw(conn, project, &item.message_id, still_mentioned)?;
        if !written_by_author {
            continue;
        }
        for recipient in &item.mentions {
            if *recipient == item.author || !reachable(conn, project, *recipient)? {
                continue;
            }
            let due = waiting_due(conn, *recipient)?.unwrap_or(now + WINDOW_MS);
            recorded += conn.execute(
                "INSERT INTO mention_emails (project_id, message_id, recipient_id, author_id, file_id, thread_id, path, quote, body, noticed_at, due_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) \
                 ON CONFLICT (project_id, message_id, recipient_id) DO UPDATE SET \
                 path = excluded.path, quote = excluded.quote, body = excluded.body \
                 WHERE mention_emails.sent_at IS NULL",
                params![
                    project.to_string(),
                    item.message_id,
                    recipient.to_string(),
                    item.author.to_string(),
                    item.file_id,
                    item.thread_id,
                    item.path.as_deref().map(kept),
                    kept(&item.quote),
                    kept(&item.body),
                    now,
                    due
                ],
            )?;
        }
    }
    Ok(recorded)
}

fn withdraw(
    conn: &Connection,
    project: SharedProjectId,
    message_id: &str,
    still_mentioned: &[AccountId],
) -> Result<usize, ServerError> {
    let waiting: Vec<String> = conn
        .prepare_cached(
            "SELECT recipient_id FROM mention_emails \
             WHERE project_id = ?1 AND message_id = ?2 AND sent_at IS NULL",
        )?
        .query_map(params![project.to_string(), message_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut withdrawn = 0;
    for recipient in waiting {
        if still_mentioned
            .iter()
            .any(|kept| kept.to_string() == recipient)
        {
            continue;
        }
        withdrawn += conn.execute(
            "DELETE FROM mention_emails WHERE project_id = ?1 AND message_id = ?2 \
             AND recipient_id = ?3 AND sent_at IS NULL",
            params![project.to_string(), message_id, recipient],
        )?;
    }
    Ok(withdrawn)
}

struct Waiting {
    project: String,
    author: String,
    file_id: String,
    thread_id: String,
    path: Option<String>,
    quote: Option<String>,
    body: Option<String>,
}

fn waiting_for(conn: &Connection, recipient: &str) -> Result<Vec<Waiting>, ServerError> {
    let mut statement = conn.prepare_cached(
        "SELECT project_id, author_id, file_id, thread_id, path, quote, body FROM mention_emails \
         WHERE recipient_id = ?1 AND sent_at IS NULL ORDER BY noticed_at, rowid",
    )?;
    let rows = statement
        .query_map([recipient], |row| {
            Ok(Waiting {
                project: row.get(0)?,
                author: row.get(1)?,
                file_id: row.get(2)?,
                thread_id: row.get(3)?,
                path: row.get(4)?,
                quote: row.get(5)?,
                body: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn listed(
    conn: &Connection,
    person: AccountId,
    waiting: Vec<Waiting>,
) -> Result<Vec<Mention>, ServerError> {
    let mut mentions = Vec::new();
    for row in waiting {
        let project: SharedProjectId = parse_id(&row.project)?;
        let Some(found) = projects::project_row(conn, project)? else {
            continue;
        };
        if found.status != ProjectStatus::Active
            || projects::role_of(conn, project, person)?.is_none()
        {
            continue;
        }
        let author = parse_id::<AccountId>(&row.author)
            .ok()
            .map(|author| members::account_summary(conn, author))
            .transpose()?
            .flatten()
            .map_or_else(|| "Someone".to_string(), |summary| summary.display_name);
        mentions.push(Mention {
            project,
            file_id: row.file_id,
            thread_id: row.thread_id,
            author,
            title: found.title,
            path: row.path,
            quote: row.quote.unwrap_or_default(),
            body: row.body.unwrap_or_default(),
        });
    }
    Ok(mentions)
}

type Batch = (Vec<String>, Vec<Mention>);

fn claim(conn: &mut Connection, now: i64) -> Result<Vec<Batch>, ServerError> {
    let transaction = conn.transaction()?;
    let recipients: Vec<String> = transaction
        .prepare_cached(
            "SELECT DISTINCT recipient_id FROM mention_emails WHERE sent_at IS NULL AND due_at <= ?1",
        )?
        .query_map([now], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let on = settings::load(&transaction)?.email_notifications;
    let mut batches = Vec::new();
    for recipient in recipients {
        let waiting = waiting_for(&transaction, &recipient)?;
        transaction.execute(
            "UPDATE mention_emails SET sent_at = ?2, path = NULL, quote = NULL, body = NULL \
             WHERE recipient_id = ?1 AND sent_at IS NULL",
            params![recipient, now],
        )?;
        let person: AccountId = parse_id(&recipient)?;
        if !on
            || !notify::is_active(&transaction, person)?
            || !preferences::mentions(&transaction, person)?
        {
            continue;
        }
        let to = notify::verified_emails(&transaction, person)?;
        let mentions = listed(&transaction, person, waiting)?;
        if !to.is_empty() && !mentions.is_empty() {
            batches.push((to, mentions));
        }
    }
    transaction.commit()?;
    Ok(batches)
}

pub async fn deliver_due(state: &AppState) -> Result<usize, ServerError> {
    let _sending = state.mentions.inner.sending.lock().await;
    let now = state.clock.now_ms();
    let batches = state.db.call(move |conn| claim(conn, now)).await?;
    let sent = batches.len();
    for (to, mentions) in batches {
        let content = messages::mentioned_you(
            &state.config.server_name,
            &state.config.public_url,
            &mentions,
        );
        state
            .mailer
            .enqueue(OutgoingEmail::new(EmailKind::Mention, to, content));
    }
    Ok(sent)
}

fn next_due(conn: &Connection) -> Result<Option<i64>, ServerError> {
    Ok(conn.query_row(
        "SELECT MIN(due_at) FROM mention_emails WHERE sent_at IS NULL",
        [],
        |row| row.get(0),
    )?)
}

async fn delivery_loop(state: AppState) {
    let inner = Arc::clone(&state.mentions.inner);
    loop {
        let next = state.db.call(|conn| next_due(conn)).await;
        let failed = match next {
            Err(error) => Some(error),
            Ok(None) => {
                inner.due.notified().await;
                None
            }
            Ok(Some(at)) => {
                let wait = at.saturating_sub(state.clock.now_ms());
                if wait > 0 {
                    let sleep =
                        tokio::time::sleep(Duration::from_millis(u64::try_from(wait).unwrap_or(0)));
                    tokio::select! {
                        () = sleep => {}
                        () = inner.due.notified() => continue,
                    }
                }
                deliver_due(&state).await.err()
            }
        };
        if let Some(error) = failed {
            tracing::warn!("Could not send mention emails: {error}. Trying again in 1 min.");
            tokio::time::sleep(RETRY).await;
        }
    }
}

pub async fn resume(state: &AppState) {
    if !state.mailer.is_configured() {
        let now = state.clock.now_ms();
        let cleared = state
            .db
            .call(move |conn| {
                conn.execute("DELETE FROM mention_scans WHERE seq >= 0", [])?;
                conn.execute(
                    "UPDATE mention_emails SET sent_at = ?1, path = NULL, quote = NULL, body = NULL WHERE sent_at IS NULL",
                    [now],
                )?;
                Ok(())
            })
            .await;
        if let Err(error) = cleared {
            tracing::warn!("Could not clear waiting mention emails: {error}");
        }
        return;
    }
    let waiting = state
        .db
        .call(|conn| {
            let projects: Vec<String> = conn
                .prepare("SELECT DISTINCT project_id FROM mention_scans")?
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
                state.mentions.wake(state, project);
            }
        }
        Err(error) => {
            tracing::warn!("Could not find changes waiting to be checked for mentions: {error}")
        }
    }
    state.mentions.deliver_soon(state);
}

#[cfg(test)]
mod tests {
    use loro::{
        Container, ExportMode, LoroList, LoroMap, LoroValue, TreeParentId, ValueOrContainer,
        VersionVector,
    };

    use super::*;

    const ALICE: &str = "01920000-0000-7000-8000-00000000a11c";
    const BOB: &str = "01920000-0000-7000-8000-000000000b0b";
    const CAROL: &str = "01920000-0000-7000-8000-0000000ca201";

    fn account(text: &str) -> AccountId {
        text.parse().unwrap()
    }

    fn add_node(doc: &LoroDoc, parent: Option<loro::TreeID>, id: &str, name: &str) -> loro::TreeID {
        let tree = doc.get_tree("tree");
        let node = tree
            .create(parent.map_or(TreeParentId::Root, TreeParentId::Node))
            .unwrap();
        let meta = tree.get_meta(node).unwrap();
        meta.insert("id", id).unwrap();
        meta.insert("name", name).unwrap();
        meta.insert("kind", if name.contains('.') { "text" } else { "folder" })
            .unwrap();
        node
    }

    fn project() -> LoroDoc {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).unwrap();
        let chapters = add_node(&doc, None, "folder-1", "chapters");
        add_node(&doc, Some(chapters), "file-1", "intro.tex");
        add_node(&doc, None, "file-2", "main.tex");
        let trash = add_node(&doc, None, "~trash", "trash");
        add_node(&doc, Some(trash), "file-3", "old.tex");
        doc.get_text("text:file-1")
            .insert(0, "The quick brown fox")
            .unwrap();
        doc.commit();
        doc
    }

    fn message(messages: &LoroList, id: &str, author: &str, body: &str, mentions: &[&str]) {
        let map = messages.push_container(LoroMap::new()).unwrap();
        map.insert("id", id).unwrap();
        map.insert("author", author).unwrap();
        map.insert("at", 5_i64).unwrap();
        map.insert("body", body).unwrap();
        map.insert(
            "mentions",
            LoroValue::from(mentions.iter().map(|m| m.to_string()).collect::<Vec<_>>()),
        )
        .unwrap();
    }

    fn thread(doc: &LoroDoc, file: &str, id: &str, quote: &str) -> LoroList {
        let thread = doc
            .get_map("comments")
            .insert_container(&format!("{file}/{id}"), LoroMap::new())
            .unwrap();
        thread.insert("quote", quote).unwrap();
        thread.insert("created_by", ALICE).unwrap();
        thread
            .insert_container("messages", LoroList::new())
            .unwrap()
    }

    fn messages_of(doc: &LoroDoc, file: &str, id: &str) -> LoroList {
        let Some(ValueOrContainer::Container(Container::Map(thread))) =
            doc.get_map("comments").get(&format!("{file}/{id}"))
        else {
            panic!("the thread exists");
        };
        let Some(ValueOrContainer::Container(Container::List(messages))) = thread.get("messages")
        else {
            panic!("the messages exist");
        };
        messages
    }

    fn written(doc: &LoroDoc, peer: u64, edit: impl FnOnce(&LoroDoc)) -> (Vec<Span>, Vec<u8>) {
        doc.set_peer_id(peer).unwrap();
        let before: VersionVector = doc.oplog_vv();
        edit(doc);
        doc.commit();
        let after = doc.oplog_vv();
        let mut spans = Vec::new();
        for (writer, end) in after.iter() {
            let start = before.get(writer).copied().unwrap_or(0);
            if start < *end {
                spans.push((*writer, start, *end));
            }
        }
        (spans, doc.export(ExportMode::updates(&before)).unwrap())
    }

    #[test]
    fn a_new_comment_a_reply_and_an_edit_that_adds_someone_are_found_with_their_writer() {
        let doc = project();
        let (spans, _) = written(&doc, 21, |doc| {
            let messages = thread(doc, "file-1", "thread-1", "brown fox");
            message(&messages, "message-1", ALICE, "@Bob which fox?", &[BOB]);
        });
        let found = found_in(&doc, &spans);
        assert_eq!(
            found,
            vec![Found {
                file_id: "file-1".to_string(),
                thread_id: "thread-1".to_string(),
                message_id: "message-1".to_string(),
                author: account(ALICE),
                mentions: vec![account(BOB)],
                writers: vec![21],
                path: Some("chapters/intro.tex".to_string()),
                quote: "brown fox".to_string(),
                body: "@Bob which fox?".to_string(),
            }]
        );
        let (spans, _) = written(&doc, 22, |doc| {
            message(
                &messages_of(doc, "file-1", "thread-1"),
                "message-2",
                BOB,
                "@Alice @Carol this one",
                &[ALICE, CAROL],
            );
        });
        let found = found_in(&doc, &spans);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_id, "message-2");
        assert_eq!(found[0].author, account(BOB));
        assert_eq!(found[0].mentions, vec![account(ALICE), account(CAROL)]);
        assert_eq!(found[0].writers, vec![22]);
        let (spans, _) = written(&doc, 23, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(first))) =
                messages_of(doc, "file-1", "thread-1").get(0)
            else {
                panic!("the first message exists");
            };
            first.insert("body", "@Bob @Carol which fox?").unwrap();
            first
                .insert(
                    "mentions",
                    LoroValue::from(vec![BOB.to_string(), CAROL.to_string()]),
                )
                .unwrap();
        });
        let found = found_in(&doc, &spans);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_id, "message-1");
        assert_eq!(found[0].mentions, vec![account(BOB), account(CAROL)]);
        assert_eq!(found[0].writers, vec![21, 23]);
    }

    #[test]
    fn typing_resolving_a_comment_without_mentions_and_a_deleted_message_mention_nobody() {
        let doc = project();
        let (spans, _) = written(&doc, 21, |doc| {
            doc.get_text("text:file-1").insert(0, "@Bob ").unwrap();
        });
        assert!(found_in(&doc, &spans).is_empty());
        let mentioned = |found: Vec<Found>| -> Vec<(String, Vec<AccountId>)> {
            found
                .into_iter()
                .map(|found| (found.message_id, found.mentions))
                .collect()
        };
        let (spans, _) = written(&doc, 21, |doc| {
            let messages = thread(doc, "file-2", "thread-2", "quiet");
            message(&messages, "message-3", ALICE, "no one", &[]);
        });
        assert_eq!(
            mentioned(found_in(&doc, &spans)),
            vec![("message-3".to_string(), vec![])]
        );
        let (spans, _) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(thread))) =
                doc.get_map("comments").get("file-2/thread-2")
            else {
                panic!("the thread exists");
            };
            thread.insert("resolved", true).unwrap();
        });
        assert!(found_in(&doc, &spans).is_empty());
        let (spans, _) = written(&doc, 21, |doc| {
            let messages = thread(doc, "file-2", "thread-3", "gone");
            message(&messages, "message-4", ALICE, "@Bob", &[BOB]);
            let Some(ValueOrContainer::Container(Container::Map(written))) = messages.get(0) else {
                panic!("the message exists");
            };
            written.insert("deleted", true).unwrap();
        });
        assert_eq!(
            mentioned(found_in(&doc, &spans)),
            vec![("message-4".to_string(), vec![])]
        );
    }

    #[test]
    fn deleting_a_thread_or_a_message_and_editing_one_are_reported_with_what_they_mention_now() {
        let doc = project();
        written(&doc, 21, |doc| {
            let first = thread(doc, "file-1", "thread-8", "fox");
            message(&first, "message-9", ALICE, "@Bob look", &[BOB]);
            message(&first, "message-10", ALICE, "@Carol and you", &[CAROL]);
            let second = thread(doc, "file-1", "thread-9", "dog");
            message(&second, "message-11", ALICE, "@Bob here", &[BOB]);
        });
        let (spans, _) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(gone))) =
                doc.get_map("comments").get("file-1/thread-8")
            else {
                panic!("the thread exists");
            };
            gone.insert("deleted", true).unwrap();
        });
        let mut withdrawn: Vec<(String, Vec<AccountId>)> = found_in(&doc, &spans)
            .into_iter()
            .map(|found| (found.message_id, found.mentions))
            .collect();
        withdrawn.sort();
        assert_eq!(
            withdrawn,
            vec![
                ("message-10".to_string(), vec![]),
                ("message-9".to_string(), vec![])
            ]
        );
        let (spans, _) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(edited))) =
                messages_of(doc, "file-1", "thread-9").get(0)
            else {
                panic!("the message exists");
            };
            edited.insert("body", "@Bob over here").unwrap();
        });
        let found = found_in(&doc, &spans);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].message_id, "message-11");
        assert_eq!(found[0].mentions, vec![account(BOB)]);
        assert_eq!(found[0].body, "@Bob over here");
        let (spans, _) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(deleted))) =
                messages_of(doc, "file-1", "thread-9").get(0)
            else {
                panic!("the message exists");
            };
            deleted.insert("deleted", true).unwrap();
            deleted.insert("body", "").unwrap();
        });
        let found = found_in(&doc, &spans);
        assert_eq!(found.len(), 1);
        assert!(found[0].mentions.is_empty());
        assert!(found[0].body.is_empty());
    }

    #[test]
    fn only_changes_to_comment_keys_ask_for_a_scan_and_words_in_the_text_do_not() {
        let doc = project();
        let (_, prose) = written(&doc, 21, |doc| {
            doc.get_text("text:file-1")
                .insert(0, "As Smith mentions in [3], the body of work was deleted.")
                .unwrap();
        });
        assert!(!may_mention(&prose));
        let (_, comment) = written(&doc, 21, |doc| {
            let messages = thread(doc, "file-1", "thread-10", "fox");
            message(&messages, "message-12", ALICE, "@Bob", &[BOB]);
        });
        assert!(may_mention(&comment));
        let (_, edit) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(edited))) =
                messages_of(doc, "file-1", "thread-10").get(0)
            else {
                panic!("the message exists");
            };
            edited.insert("body", "@Bob, fixed").unwrap();
        });
        assert!(may_mention(&edit));
        let (_, gone) = written(&doc, 21, |doc| {
            let Some(ValueOrContainer::Container(Container::Map(thread))) =
                doc.get_map("comments").get("file-1/thread-10")
            else {
                panic!("the thread exists");
            };
            thread.insert("deleted", true).unwrap();
        });
        assert!(may_mention(&gone));
    }

    #[test]
    fn a_file_in_the_trash_has_no_path_and_a_file_at_the_top_is_its_name() {
        let doc = project();
        let (spans, _) = written(&doc, 21, |doc| {
            let top = thread(doc, "file-2", "thread-4", "x");
            message(&top, "message-5", ALICE, "@Bob", &[BOB]);
            let trashed = thread(doc, "file-3", "thread-5", "y");
            message(&trashed, "message-6", ALICE, "@Bob", &[BOB]);
        });
        let mut paths: Vec<(String, Option<String>)> = found_in(&doc, &spans)
            .into_iter()
            .map(|found| (found.message_id, found.path))
            .collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                ("message-5".to_string(), Some("main.tex".to_string())),
                ("message-6".to_string(), None),
            ]
        );
    }

    #[test]
    fn a_change_that_writes_mentions_is_noticed_even_inside_a_large_offline_batch() {
        let doc = project();
        let (_, typing) = written(&doc, 21, |doc| {
            doc.get_text("text:file-1")
                .insert(0, "plain typing")
                .unwrap();
        });
        assert!(!may_mention(&typing));
        let (_, comment) = written(&doc, 21, |doc| {
            let messages = thread(doc, "file-1", "thread-6", "fox");
            message(&messages, "message-7", ALICE, "@Bob", &[BOB]);
        });
        assert!(may_mention(&comment));
        let (_, offline) = written(&doc, 24, |doc| {
            let text = doc.get_text("text:file-1");
            for round in 0..400 {
                text.insert(0, &format!("paragraph {round} {}\n", "words ".repeat(40)))
                    .unwrap();
            }
            let messages = thread(doc, "file-1", "thread-7", "fox");
            message(&messages, "message-8", ALICE, "@Bob offline", &[BOB]);
            for round in 0..400 {
                text.insert(0, &format!("more {round} {}\n", "text ".repeat(40)))
                    .unwrap();
            }
        });
        assert!(offline.len() > 64 * 1024, "{}", offline.len());
        assert!(may_mention(&offline));
    }
}
