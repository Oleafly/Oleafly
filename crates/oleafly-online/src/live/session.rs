mod catch_up;
mod driver;
mod state;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_ot::{DocOpened, DocSink, OtError, TextOperation};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::journal::Journal;
use super::DocId;
use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::connection::{connect_tuned, Carrier, RealtimeError, Tuning};
use crate::realtime::events::{PeerPosition, ProjectEvent, PublicId, Rejection};
use crate::realtime::project::{ProjectState, Role};
use crate::realtime::tree::{OverleafNode, PathChange};
use crate::realtime::ProjectPage;
use crate::session::SessionHandle;

pub trait LivePort: Send + Sync + 'static {
    fn state(&self, state: LiveState);
    fn role(&self, role: Role, tracking: bool);
    fn texts_changed(&self, docs: Vec<DocId>);
    fn tree_changed(&self, changes: Vec<PathChange>);
    fn peer(&self, peer: PeerPosition);
    fn peer_left(&self, id: &PublicId);
    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason);
    fn project_event(&self, event: ProjectEvent);
    fn merged(&self, doc: &DocId, review: MergeReview);
    fn journal_failed(&self, reason: Option<String>);
    fn disk_text(&self, path: &str) -> Option<String>;
    fn account_changed(&self, _typed_as: Account) {}
    fn doc_pending(&self, _doc: &DocId, _pending: bool) {}
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiveState {
    Connecting,
    Online { pending: u64 },
    Offline { retry_in: Duration, pending: u64 },
    SignedOut { pending: u64 },
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
    ProjectGone,
    Unsupported(String),
    Stopped,
    Failed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocStopReason {
    Unsupported(String),
    TooLarge,
    Removed,
    Server(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeReview {
    Merged { before: String, after: String },
    NeedsReview { mine: String, theirs: String },
    Kept { text: String },
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
}

struct Shared {
    state: Mutex<state::State>,
    journal: Mutex<Journal>,
    wake: Notify,
    stopping: AtomicBool,
    port: Arc<dyn LivePort>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, state::State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn journal(&self) -> MutexGuard<'_, Journal> {
        self.journal.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
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
        journal.flush()
    }
}

pub struct OverleafSession {
    shared: Arc<Shared>,
    driver: Mutex<Option<JoinHandle<()>>>,
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

impl OverleafSession {
    pub async fn start(
        config: SessionConfig,
        port: Arc<dyn LivePort>,
        journal: Journal,
    ) -> Result<Arc<OverleafSession>, OnlineError> {
        port.state(LiveState::Connecting);
        let page =
            ProjectPage::load(&config.http, &config.session, &config.project_id, false).await?;
        let (connection, join) = connect_tuned(
            &config.http,
            &config.session,
            &page,
            &config.carriers,
            &config.tuning.connection,
        )
        .await
        .map_err(online_error)?;
        let project = ProjectState::from_join(join.response).map_err(|unsupported| {
            OnlineError::new(OnlineErrorKind::Unrecognized).detail(format!("{unsupported:?}"))
        })?;
        let me = config.session.user_id().to_string();
        let mut state = state::State::new(project, me, &journal, Arc::clone(&port));
        state.page_limit = page.max_doc_length().map(|limit| limit as usize);
        state.connected(connection.public_id().clone(), state::now_ms());
        let shared = Arc::new(Shared {
            state: Mutex::new(state),
            journal: Mutex::new(journal),
            wake: Notify::new(),
            stopping: AtomicBool::new(false),
            port,
        });
        shared.with(state::State::announce);
        let driver = driver::Driver::new(Arc::clone(&shared), connection, page, config);
        let handle = tokio::spawn(driver.run());
        Ok(Arc::new(OverleafSession {
            shared,
            driver: Mutex::new(Some(handle)),
        }))
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
        self.poke();
        result
    }

    pub fn text(&self, doc: &DocId) -> Option<String> {
        self.shared.lock().text(doc)
    }

    pub fn nodes(&self) -> Vec<OverleafNode> {
        self.shared.lock().project.tree.nodes()
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

    pub async fn unsent(&self, wait: Duration) -> Vec<UnsentDoc> {
        self.settle(wait).await;
        self.shared.lock().unsent()
    }

    pub async fn stop(&self) {
        self.shared.stopping.store(true, Ordering::SeqCst);
        self.shared.wake.notify_waiters();
        self.poke();
        let handle = self
            .driver
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(handle) = handle {
            let _ = handle.await;
        }
    }
}

impl Drop for OverleafSession {
    fn drop(&mut self) {
        if let Some(handle) = self
            .driver
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            handle.abort();
        }
    }
}
