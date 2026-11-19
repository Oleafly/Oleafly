mod catch_up;
mod driver;
mod pacing;
mod state;
#[cfg(test)]
mod tests;
mod tree_worker;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

use oleafly_ot::{DocOpened, DocSink, OtError, TextOperation};
use serde::Serialize;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::doc::DocFault;
use super::journal::Journal;
use super::rest::{RestError, TreeRest};
use super::tree_queue::{LocalFile, Queued, TreeChange, TreeRefusal};
use super::DocId;
use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::connection::{connect_tuned, Carrier, Connection, RealtimeError, Tuning};
use crate::realtime::events::{EntityId, ProjectEvent, PublicId, Rejection};
use crate::realtime::project::{Member, ProjectState, Role};
use crate::realtime::tree::{OverleafNode, PathChange};
use crate::realtime::ProjectPage;
use crate::session::SessionHandle;

pub trait LivePort: Send + Sync + 'static {
    fn state(&self, state: LiveState);
    fn role(&self, role: Role, tracking: bool);
    fn texts_changed(&self, docs: Vec<DocId>);
    fn tree_changed(&self, changes: Vec<PathChange>);
    fn peer(&self, peer: LivePeer);
    fn peer_left(&self, id: &PublicId);
    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason);
    fn project_event(&self, event: ProjectEvent);
    fn merged(&self, doc: &DocId, review: MergeReview);
    fn journal_failed(&self, reason: Option<String>);
    fn disk_text(&self, path: &str) -> Option<String>;
    fn adopt_file_text(&self, path: &str) -> Option<String> {
        self.disk_text(path)
    }
    fn account_changed(&self, _typed_as: Account) {}
    fn doc_pending(&self, _doc: &DocId, _pending: bool) {}
    fn maintenance(&self, _message: &str, _delay: Duration) {}
    fn slow_ack(&self, _waiting: bool) {}
    fn doc_unsteady(&self, _doc: &DocId) {}
    fn tree_queue(&self, _changes: Vec<Queued>) {}
    fn uploaded(&self, _path: &str, _tag: &str, _hash: Option<&str>) {}
    fn project_flags(&self, _restricted: bool, _deleted_externally: bool) {}
    fn members_changed(&self) {}
    fn local_file(&self, _path: &str) -> Option<LocalFile> {
        None
    }
    fn never_online(&self, path: &str) -> bool {
        crate::sync::excluded(path)
    }
    fn external_update(&self, _doc: &DocId) {}
    fn characters_replaced(&self, _doc: &DocId) {}
    fn session_started(&self, _session: Weak<OverleafSession>) {}
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LivePeer {
    pub id: PublicId,
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub doc: Option<DocId>,
    pub offset: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveState {
    Connecting,
    Online { pending: u64 },
    Offline { retry_in: Duration, pending: u64 },
    SignedOut { pending: u64 },
    Idle,
    Ended(LiveEnd),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub user_id: String,
    pub email: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignedIn {
    Resumed,
    AccountChanged { typed_as: Account },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnsentDoc {
    pub doc: DocId,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveEnd {
    SignedOut,
    AccessEnded,
    Removed,
    ProjectGone,
    Unsupported(String),
    Stopped,
    Failed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocStopReason {
    Fault(DocFault),
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeReview {
    Merged { before: String, after: String },
    NeedsReview { mine: String, theirs: String },
    Kept { text: String },
    InFile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Resolution {
    Mine,
    Theirs,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDetails {
    pub server: String,
    pub transport: Option<String>,
    pub public_id: Option<String>,
    pub last_rejection: Option<String>,
    pub pending_docs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LiveError {
    #[error("the project is no longer live")]
    Ended,
    #[error("that file is not a live document")]
    UnknownDoc,
    #[error("the change does not fit the document: {0}")]
    Invalid(OtError),
    #[error("this document can't take changes right now")]
    NotWritable,
    #[error("live editing stopped for that file")]
    Stopped,
}

#[derive(Clone, Debug)]
pub struct SessionTuning {
    pub connection: Tuning,
    pub tick: Duration,
    pub trickle_every: Duration,
    pub legacy_check: Duration,
    pub legacy_batch: usize,
    pub legacy_every: Duration,
    pub legacy_grace: Duration,
    pub urgent_batch: usize,
    pub call_timeout: Duration,
    pub join_limit: usize,
    pub join_window: Duration,
    pub drain_within: Duration,
    pub typing_pause: Duration,
    pub idle_after: Duration,
    pub slow_ack_after: Duration,
    pub doc_limit: usize,
    pub folder_limit: usize,
    pub create_window: Duration,
    pub upload_limit: usize,
    pub upload_window: Duration,
    pub rate_floor: Duration,
    pub tree_retry: Duration,
    pub delete_settle: Duration,
    pub presence_with_peers: Duration,
    pub presence_alone: Duration,
    pub peer_reemit: Duration,
    pub project_check_every: Duration,
}

impl Default for SessionTuning {
    fn default() -> SessionTuning {
        SessionTuning {
            connection: Tuning::default(),
            tick: Duration::from_millis(250),
            trickle_every: Duration::from_secs(1),
            legacy_check: Duration::from_secs(10),
            legacy_batch: 4,
            legacy_every: Duration::from_secs(1),
            legacy_grace: Duration::from_secs(1),
            urgent_batch: 8,
            call_timeout: Duration::from_secs(30),
            join_limit: 40,
            join_window: Duration::from_secs(60),
            drain_within: Duration::from_secs(45),
            typing_pause: Duration::from_secs(2),
            idle_after: Duration::from_secs(30 * 60),
            slow_ack_after: Duration::from_secs(60),
            doc_limit: 25,
            folder_limit: 50,
            create_window: Duration::from_secs(60),
            upload_limit: 450,
            upload_window: Duration::from_secs(15 * 60),
            rate_floor: Duration::from_secs(15),
            tree_retry: Duration::from_secs(2),
            delete_settle: Duration::from_secs(3),
            presence_with_peers: Duration::from_millis(500),
            presence_alone: Duration::from_secs(5 * 60),
            peer_reemit: Duration::from_secs(10),
            project_check_every: Duration::from_secs(60),
        }
    }
}

#[derive(Clone)]
pub struct SessionConfig {
    pub http: Http,
    pub session: SessionHandle,
    pub project_id: String,
    pub carriers: Vec<Carrier>,
    pub tuning: SessionTuning,
    pub seeds: Vec<Seed>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seed {
    pub path: String,
    pub base: Option<String>,
    pub local: String,
}

struct Activity {
    last: tokio::time::Instant,
    typed: tokio::time::Instant,
    focused: bool,
}

#[derive(Default)]
struct Link {
    transport: Option<&'static str>,
    public_id: Option<PublicId>,
    rejection: Option<String>,
}

struct Shared {
    state: Mutex<state::State>,
    journal: Mutex<Journal>,
    sign_in: Mutex<Option<SessionHandle>>,
    session: Mutex<SessionHandle>,
    wake: Notify,
    tree_wake: Notify,
    nudge: Notify,
    nudged: AtomicBool,
    stopping: AtomicBool,
    port: Arc<dyn LivePort>,
    activity: Mutex<Activity>,
    link: Mutex<Link>,
    server: String,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, state::State> {
        locked(&self.state)
    }

    fn journal(&self) -> MutexGuard<'_, Journal> {
        locked(&self.journal)
    }

    fn take_sign_in(&self) -> Option<SessionHandle> {
        let session = locked(&self.sign_in).take()?;
        *locked(&self.session) = session.clone();
        Some(session)
    }

    fn session(&self) -> SessionHandle {
        locked(&self.session).clone()
    }

    fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    fn touched(&self, typed: bool) {
        let now = tokio::time::Instant::now();
        let mut activity = locked(&self.activity);
        activity.last = now;
        if typed {
            activity.typed = now;
        }
    }

    fn active_since(&self, since: tokio::time::Instant) -> bool {
        let activity = locked(&self.activity);
        activity.focused || activity.last > since
    }

    fn quiet_for(&self, idle_after: Duration) -> bool {
        let activity = locked(&self.activity);
        !activity.focused && activity.last.elapsed() >= idle_after
    }

    fn typing_paused(&self, pause: Duration) -> bool {
        locked(&self.activity).typed.elapsed() >= pause
    }

    fn linked(&self, transport: &'static str, public_id: PublicId) {
        let mut link = locked(&self.link);
        link.transport = Some(transport);
        link.public_id = Some(public_id);
    }

    fn rejected(&self, rejection: String) {
        locked(&self.link).rejection = Some(rejection);
    }

    fn with<T>(&self, work: impl FnOnce(&mut state::State) -> T) -> T {
        let (value, notices) = {
            let mut state = self.lock();
            let value = work(&mut state);
            state.report_pending(false);
            state.report_docs();
            (value, std::mem::take(&mut state.notices))
        };
        state::deliver(self.port.as_ref(), notices);
        value
    }

    fn write_journal(&self, batch: &state::JournalBatch) -> Result<(), String> {
        let mut journal = self.journal();
        if let Some(manifest) = &batch.manifest {
            journal.set_manifest(manifest.clone());
        }
        for (doc, record) in &batch.docs {
            journal.put(doc, record.clone());
        }
        if let Some(changes) = &batch.tree {
            journal.set_tree_queue(changes.clone());
        }
        journal.flush()
    }

    fn persist(&self, forced: bool) {
        let now = Instant::now();
        let Some(batch) = self.with(|state| state.take_journal_batch(now, forced)) else {
            return;
        };
        let result = self.write_journal(&batch);
        self.with(|state| state.journal_result(batch, result, now));
    }
}

pub struct OverleafSession {
    shared: Arc<Shared>,
    driver: Mutex<Option<JoinHandle<()>>>,
    tree: Mutex<Option<JoinHandle<()>>>,
    rest: Arc<TreeRest>,
}

pub(super) fn online_error(error: RealtimeError) -> OnlineError {
    match error {
        RealtimeError::Page(error) => error,
        RealtimeError::Rejected(Rejection::SignedOut) => {
            OnlineError::new(OnlineErrorKind::SignedOut)
        }
        RealtimeError::Rejected(Rejection::NotAuthorized | Rejection::ProjectGone) => {
            OnlineError::new(OnlineErrorKind::ProjectUnavailable)
        }
        RealtimeError::Rejected(Rejection::RateLimited) => {
            OnlineError::new(OnlineErrorKind::RateLimited)
        }
        other => OnlineError::new(OnlineErrorKind::Unreachable).detail(other),
    }
}

async fn first_connect(
    config: &SessionConfig,
    page: &ProjectPage,
    journal: &mut Journal,
) -> Result<(ProjectState, Option<Connection>), OnlineError> {
    if let Some(project) = journal
        .joined()
        .cloned()
        .and_then(|join| ProjectState::from_join(join).ok())
    {
        return Ok((project, None));
    }
    let attempt = match page.reload(&config.http, &config.session, false).await {
        Ok(()) => {
            connect_tuned(
                &config.http,
                &config.session,
                page,
                &config.carriers,
                &config.tuning.connection,
            )
            .await
        }
        Err(error) => Err(RealtimeError::Page(error)),
    };
    match attempt {
        Ok((connection, join)) => {
            journal.remember_join(join.response.clone());
            let _ = journal.flush();
            let project = ProjectState::from_join(join.response).map_err(|unsupported| {
                OnlineError::new(OnlineErrorKind::Unrecognized).detail(format!("{unsupported:?}"))
            })?;
            Ok((project, Some(connection)))
        }
        Err(error) if error.retry_after(0).is_none() || driver::signed_out_error(&error) => {
            Err(online_error(error))
        }
        Err(_) => Ok((ProjectState::unjoined(), None)),
    }
}

impl OverleafSession {
    pub async fn start(
        mut config: SessionConfig,
        port: Arc<dyn LivePort>,
        mut journal: Journal,
    ) -> Result<Arc<OverleafSession>, OnlineError> {
        port.state(LiveState::Connecting);
        let page = Arc::new(ProjectPage::unloaded(&config.project_id)?);
        let (project, connection) = first_connect(&config, &page, &mut journal).await?;
        let account = Account {
            user_id: config.session.user_id().to_string(),
            email: config.session.email().to_string(),
        };
        let mut state = state::State::new(project, account, &journal, Arc::clone(&port));
        state.seed(std::mem::take(&mut config.seeds));
        state.page_limit = page.max_doc_length().map(|limit| limit as usize);
        if let Some(connection) = &connection {
            state.connected(connection.public_id().clone(), state::now_ms());
        }
        let now = tokio::time::Instant::now();
        let shared = Arc::new(Shared {
            state: Mutex::new(state),
            journal: Mutex::new(journal),
            sign_in: Mutex::new(None),
            session: Mutex::new(config.session.clone()),
            wake: Notify::new(),
            tree_wake: Notify::new(),
            nudge: Notify::new(),
            nudged: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            port,
            activity: Mutex::new(Activity {
                last: now,
                typed: now,
                focused: true,
            }),
            link: Mutex::new(Link::default()),
            server: config.http.url(""),
        });
        if let Some(connection) = &connection {
            shared.linked(
                connection.carrier().wire_name(),
                connection.public_id().clone(),
            );
            shared.with(state::State::announce);
        }
        let rest = Arc::new(TreeRest::new(
            config.http.clone(),
            Arc::clone(&page),
            &config.project_id,
        ));
        let worker = tree_worker::TreeWorker::new(
            Arc::clone(&shared),
            Arc::clone(&rest),
            config.tuning.clone(),
        );
        let driver = driver::Driver::new(Arc::clone(&shared), connection, page, config);
        let session = Arc::new(OverleafSession {
            shared,
            driver: Mutex::new(None),
            tree: Mutex::new(None),
            rest,
        });
        session
            .shared
            .port
            .session_started(Arc::downgrade(&session));
        *locked(&session.driver) = Some(tokio::spawn(driver.run()));
        *locked(&session.tree) = Some(tokio::spawn(worker.run()));
        Ok(session)
    }

    fn poke(&self) {
        self.shared.wake.notify_one();
    }

    pub fn open(&self, path: &str, sink: DocSink) -> Option<DocOpened> {
        let opened = self.shared.with(|state| state.open(path, sink));
        self.poke();
        opened
    }

    pub fn editor_change(&self, doc: &DocId, rev: u64, op: TextOperation) -> Result<(), LiveError> {
        let result = self.shared.with(|state| state.editor_change(doc, rev, op));
        self.shared.touched(true);
        self.poke();
        result
    }

    pub fn close(&self, doc: &DocId, session: u64) {
        self.shared.with(|state| state.close(doc, session));
    }

    pub fn local_edit_with(
        &self,
        doc: &DocId,
        edit: impl FnOnce(&str) -> Option<TextOperation>,
    ) -> Result<bool, LiveError> {
        let result = self.shared.with(|state| state.local_edit_with(doc, edit));
        self.shared.touched(true);
        self.poke();
        result
    }

    pub fn resolve(&self, doc: &DocId, choice: Resolution) -> Result<(), LiveError> {
        let result = self.shared.with(|state| state.resolve(doc, choice));
        self.shared.touched(false);
        self.poke();
        result
    }

    pub fn retry(&self, doc: &DocId) -> Result<(), LiveError> {
        let result = self.shared.with(|state| state.retry(doc));
        self.poke();
        result
    }

    pub fn keep_and_reload(&self, doc: &DocId) -> Result<(), LiveError> {
        let result = self.shared.with(|state| state.keep_and_reload(doc));
        self.poke();
        result
    }

    pub fn set_focused(&self, focused: bool) {
        locked(&self.shared.activity).focused = focused;
        self.shared.touched(false);
        self.poke();
    }

    pub fn touch(&self) {
        self.shared.touched(false);
        self.poke();
    }

    pub fn reconnect_now(&self) {
        self.shared.touched(false);
        if !self.shared.lock().is_online() {
            self.shared.nudged.store(true, Ordering::SeqCst);
            self.shared.nudge.notify_waiters();
        }
        self.poke();
    }

    pub fn details(&self) -> ConnectionDetails {
        let pending_docs = self
            .shared
            .lock()
            .unsent()
            .into_iter()
            .map(|unsent| unsent.path)
            .collect();
        let link = locked(&self.shared.link);
        ConnectionDetails {
            server: self.shared.server.clone(),
            transport: link.transport.map(str::to_string),
            public_id: link.public_id.as_ref().map(|id| id.0.clone()),
            last_rejection: link.rejection.clone(),
            pending_docs,
        }
    }

    pub fn text(&self, doc: &DocId) -> Option<String> {
        self.shared.lock().text(doc)
    }

    pub fn doc_at(&self, path: &str) -> Option<DocId> {
        self.shared.lock().doc_at(path)
    }

    pub fn members(&self) -> Vec<Member> {
        self.shared.lock().project.members.all().cloned().collect()
    }

    pub fn nodes(&self) -> Vec<OverleafNode> {
        self.shared.lock().project.tree.nodes()
    }

    pub fn tree_settling(&self) -> bool {
        self.shared
            .lock()
            .project
            .tree
            .next_due()
            .is_some_and(|due| due > Instant::now())
    }

    pub fn change_tree(&self, change: TreeChange) -> Result<(), TreeRefusal> {
        let result = self.shared.with(|state| state.change_tree(change));
        self.after_tree_change();
        result
    }

    pub fn keep_away(&self, path: &str) -> Result<(), TreeRefusal> {
        let result = self.shared.with(|state| state.keep_away(path));
        self.after_tree_change();
        result
    }

    pub fn kept_away(&self) -> Vec<String> {
        self.shared.lock().kept_away()
    }

    pub fn tree_queue(&self) -> Vec<Queued> {
        self.shared.lock().tree_queue()
    }

    pub fn retry_tree(&self, path: Option<&str>) {
        self.shared.with(|state| state.retry_tree(path));
        self.after_tree_change();
    }

    pub fn dismiss_tree(&self, path: &str) {
        self.shared.with(|state| state.dismiss_tree(path));
        self.after_tree_change();
    }

    fn after_tree_change(&self) {
        self.shared.persist(true);
        self.shared.touched(false);
        self.shared.tree_wake.notify_one();
        self.poke();
    }

    pub async fn download(
        &self,
        file: &EntityId,
        progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<Vec<u8>, RestError> {
        let hash = self
            .shared
            .lock()
            .project
            .tree
            .server_node(file)
            .and_then(|node| node.hash.clone());
        let session = self.shared.session();
        self.rest
            .download(&session, file, hash.as_deref(), progress)
            .await
    }

    pub fn presence(&self, at: Option<(DocId, usize)>) {
        self.shared.with(|state| state.set_presence(at));
        self.poke();
    }

    pub fn journal_dir(&self) -> PathBuf {
        self.shared.journal().dir().to_path_buf()
    }

    pub async fn settle(&self, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        loop {
            if self.shared.lock().is_settled() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            self.poke();
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub fn signed_in(&self, session: SessionHandle) -> SignedIn {
        let account = Account {
            user_id: session.user_id().to_string(),
            email: session.email().to_string(),
        };
        let outcome = self.shared.with(|state| state.signed_in(account));
        *locked(&self.shared.sign_in) = Some(session);
        self.poke();
        outcome
    }

    pub async fn unsent(&self, wait: Duration) -> Vec<UnsentDoc> {
        self.settle(wait).await;
        self.shared.lock().unsent()
    }

    pub async fn stop(&self) {
        self.shared.stopping.store(true, Ordering::SeqCst);
        self.shared.wake.notify_waiters();
        self.poke();
        self.shared.tree_wake.notify_waiters();
        let handle = locked(&self.driver).take();
        if let Some(handle) = handle {
            let _ = handle.await;
        }
        let tree = locked(&self.tree).take();
        if let Some(tree) = tree {
            let _ = tree.await;
        }
    }
}

impl Drop for OverleafSession {
    fn drop(&mut self) {
        if let Some(handle) = locked(&self.driver).take() {
            handle.abort();
        }
        if let Some(tree) = locked(&self.tree).take() {
            tree.abort();
        }
    }
}
