use std::pin::pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::chat::refetch_latest;
use super::people::{fetch_change_authors, fetch_invites};
use super::state::ChatTicket;
use super::{SessionTuning, Shared};
use crate::client::Http;
use crate::live::rest::{ProjectRest, ReviewError};
use crate::realtime::project::CapabilityCache;
use crate::realtime::ProjectPage;

const FETCH_TRIES: u32 = 3;
const IDLE_CHECK: Duration = Duration::from_secs(30);
const RETRY_MOST: Duration = Duration::from_secs(5 * 60);
const PROBE_UNSURE: &str = "the server did not say whether it has comments";

pub(super) enum Fetched {
    Done,
    Again(String),
    Refused(String),
}

#[derive(Default)]
struct Backoff {
    due: Option<Instant>,
    wait: Duration,
    failures: u32,
}

impl Backoff {
    fn settled(&mut self) {
        *self = Backoff::default();
    }

    fn failed(&mut self, first: Duration) -> bool {
        self.failures = self.failures.saturating_add(1);
        self.wait = if self.wait.is_zero() {
            first
        } else {
            self.wait.saturating_mul(2).min(RETRY_MOST)
        };
        self.due = Some(Instant::now() + self.wait);
        self.failures >= FETCH_TRIES
    }

    fn settle(&mut self, fetched: Fetched, first: Duration) -> Result<(), Option<String>> {
        match fetched {
            Fetched::Done => {
                self.settled();
                Ok(())
            }
            Fetched::Refused(reason) => {
                self.settled();
                Err(Some(reason))
            }
            Fetched::Again(reason) => Err(self.failed(first).then_some(reason)),
        }
    }

    fn take_due(&mut self, now: Instant) -> bool {
        let due = self.due.is_some_and(|due| due <= now);
        if due {
            self.due = None;
        }
        due
    }
}

pub(super) struct ReviewWorker {
    shared: Arc<Shared>,
    rest: Arc<ProjectRest>,
    http: Http,
    page: Arc<ProjectPage>,
    project_id: String,
    capabilities: CapabilityCache,
    deadline: Duration,
    retry: Duration,
    probe_again: Backoff,
    threads_again: Backoff,
    chat_again: Backoff,
}

impl ReviewWorker {
    pub(super) fn new(
        shared: Arc<Shared>,
        rest: Arc<ProjectRest>,
        http: Http,
        page: Arc<ProjectPage>,
        project_id: String,
        tuning: &SessionTuning,
    ) -> ReviewWorker {
        ReviewWorker {
            shared,
            rest,
            http,
            page,
            project_id,
            capabilities: CapabilityCache::default(),
            deadline: tuning.review_deadline,
            retry: tuning.review_retry,
            probe_again: Backoff::default(),
            threads_again: Backoff::default(),
            chat_again: Backoff::default(),
        }
    }

    fn over(&self) -> bool {
        self.shared.is_stopping() || self.shared.lock().ended.is_some()
    }

    async fn until_stopped<T>(&self, work: impl std::future::Future<Output = T>) -> Option<T> {
        let mut work = pin!(work);
        loop {
            let notified = self.shared.review_wake.notified();
            let mut notified = pin!(notified);
            notified.as_mut().enable();
            if self.shared.is_stopping() {
                return None;
            }
            tokio::select! {
                done = work.as_mut() => return Some(done),
                () = notified => {}
            }
        }
    }

    fn next_retry(&self) -> Option<Instant> {
        [
            self.probe_again.due,
            self.threads_again.due,
            self.chat_again.due,
        ]
        .into_iter()
        .flatten()
        .min()
    }

    async fn idle(&self) {
        let notified = self.shared.review_wake.notified();
        let mut notified = pin!(notified);
        notified.as_mut().enable();
        if self.over() || self.has_work() {
            return;
        }
        let nap = self.next_retry().map_or(IDLE_CHECK, |due| {
            due.saturating_duration_since(Instant::now())
                .min(IDLE_CHECK)
        });
        tokio::select! {
            () = notified => {}
            () = tokio::time::sleep(nap) => {}
        }
    }

    fn has_work(&self) -> bool {
        let state = self.shared.lock();
        state.review_probe_wanted()
            || state.thread_fetch_wanted()
            || state.chat_fetch_wanted()
            || state.invite_fetch_wanted()
            || state.authors_fetch_wanted()
    }

    fn rearm(&mut self, now: Instant) {
        let probe = self.probe_again.take_due(now);
        let threads = self.threads_again.take_due(now);
        let chat = self.chat_again.take_due(now);
        if !(probe || threads || chat) {
            return;
        }
        self.shared.with(|state| {
            if probe {
                state.review_rejoined();
            }
            if threads {
                state.refetch_threads();
            }
            if chat {
                state.chat_rejoined();
            }
        });
    }

    pub(super) async fn run(mut self) {
        while !self.over() {
            self.rearm(Instant::now());
            let probe = self.shared.with(|state| state.take_review_probe());
            if let Some(restricted) = probe {
                if self.probe(restricted).await.is_none() {
                    return;
                }
                continue;
            }
            if self.shared.with(|state| state.take_thread_fetch()) {
                if self.fetch().await.is_none() {
                    return;
                }
                continue;
            }
            if let Some(ticket) = self.shared.with(|state| state.take_chat_fetch()) {
                if self.fetch_chat(ticket).await.is_none() {
                    return;
                }
                continue;
            }
            if self.shared.with(|state| state.take_invite_fetch()) {
                let failed = self
                    .until_stopped(fetch_invites(&self.shared, &self.rest, self.deadline))
                    .await;
                match failed {
                    None => return,
                    Some(Some(trouble)) => self.trouble(trouble),
                    Some(None) => {}
                }
                continue;
            }
            if self.shared.with(|state| state.take_authors_fetch()) {
                let failed = self
                    .until_stopped(fetch_change_authors(
                        &self.shared,
                        &self.rest,
                        self.deadline,
                    ))
                    .await;
                match failed {
                    None => return,
                    Some(Some(trouble)) => self.trouble(trouble),
                    Some(None) => {}
                }
                continue;
            }
            self.idle().await;
        }
    }

    async fn probe(&mut self, restricted: bool) -> Option<()> {
        if restricted {
            self.probe_again.settled();
            self.shared.with(|state| {
                state.set_review_support(false);
                state.set_chat_support(false);
                state.report_review();
                state.report_chat();
            });
            return Some(());
        }
        let mut features = self.shared.lock().project.features.clone();
        let paged_chat = self.page.capability("chat");
        if let (Some(chat), Some(known)) = (paged_chat, features.as_object_mut()) {
            known.insert("chat".into(), serde_json::Value::Bool(chat));
        }
        let session = self.shared.session();
        let refresh = self
            .capabilities
            .refresh(&self.http, &session, &self.project_id, &features);
        let found = self
            .until_stopped(tokio::time::timeout(self.deadline, refresh))
            .await?;
        let (threads, chat) = found.map_or((None, None), |found| (found.review, found.chat));
        let chat = paged_chat.or(chat).unwrap_or(true);
        let unsure = threads.is_none();
        let threads = threads.unwrap_or_else(|| self.page.has_track_changes_feature());
        if unsure && !threads {
            self.probe_again.failed(self.retry);
        } else {
            self.probe_again.settled();
        }
        self.shared.with(|state| {
            state.set_review_support(threads);
            state.set_chat_support(chat);
            if unsure {
                state.review_trouble(PROBE_UNSURE.to_string());
            }
            state.report_review();
            state.report_chat();
        });
        Some(())
    }

    async fn fetch_chat(&mut self, ticket: ChatTicket) -> Option<()> {
        let fetched = refetch_latest(&self.shared, &self.rest, ticket, self.deadline);
        let fetched = self.until_stopped(fetched).await?;
        if let Err(Some(reason)) = self.chat_again.settle(fetched, self.retry) {
            self.shared.with(|state| {
                state.chat_trouble(reason);
                state.report_chat();
            });
        }
        Some(())
    }

    fn trouble(&self, reason: String) {
        self.shared.with(|state| {
            state.review_trouble(reason);
            state.report_review();
        });
    }

    async fn fetch_once(&self) -> Fetched {
        let session = self.shared.session();
        let fetched = tokio::time::timeout(self.deadline, self.rest.threads(&session)).await;
        match fetched {
            Err(_) => Fetched::Again(format!(
                "the comment threads did not arrive within {} s",
                self.deadline.as_secs()
            )),
            Ok(Ok(threads)) => {
                self.shared.with(|state| {
                    state.threads_fetched(threads);
                    state.report_review();
                });
                Fetched::Done
            }
            Ok(Err(ReviewError::Absent)) => {
                self.shared.with(|state| {
                    state.set_review_support(false);
                    state.report_review();
                });
                Fetched::Done
            }
            Ok(Err(error)) if error.is_temporary() => Fetched::Again(error.to_string()),
            Ok(Err(error)) => Fetched::Refused(error.to_string()),
        }
    }

    async fn fetch(&mut self) -> Option<()> {
        let fetched = self.until_stopped(self.fetch_once()).await?;
        if let Err(trouble) = self.threads_again.settle(fetched, self.retry) {
            self.shared.with(|state| {
                state.thread_fetch_failed(trouble);
                state.report_review();
            });
        }
        Some(())
    }
}
