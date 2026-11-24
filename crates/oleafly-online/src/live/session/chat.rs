use std::time::Duration;

use super::review_worker::Fetched;
use super::state::{ChatTicket, Paged};
use super::{OverleafSession, Shared};
use crate::live::rest::{ProjectRest, RestError, ReviewError, CHAT_PAGE_LIMIT};
use crate::live::session::review::ReviewWriteError;
use crate::realtime::events::ThreadMessage;

pub const LATEST_PAGE: usize = 50;
const ECHO_WAIT: Duration = Duration::from_secs(3);
const ECHO_POLL: Duration = Duration::from_millis(25);
const RECENT: usize = 10;
const PAGE_ROUNDS: usize = 4;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChatSupport {
    pub probed: bool,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatEntry {
    pub message: ThreadMessage,
    pub deleted: bool,
    pub pending: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatChange {
    pub local: bool,
    pub support: bool,
    pub trouble: Option<String>,
}

struct Fetching<'a> {
    shared: &'a Shared,
    ticket: Option<ChatTicket>,
}

impl<'a> Fetching<'a> {
    fn new(shared: &'a Shared, ticket: ChatTicket) -> Fetching<'a> {
        Fetching {
            shared,
            ticket: Some(ticket),
        }
    }

    fn take(&mut self) -> Option<ChatTicket> {
        self.ticket.take()
    }
}

impl Drop for Fetching<'_> {
    fn drop(&mut self) {
        if let Some(ticket) = self.ticket.take() {
            self.shared.with(|state| state.chat_fetch_failed(ticket));
        }
    }
}

pub(super) async fn refetch_latest(
    shared: &Shared,
    rest: &ProjectRest,
    ticket: ChatTicket,
    deadline: Duration,
) -> Fetched {
    let mut fetching = Fetching::new(shared, ticket);
    let session = shared.session();
    let fetched =
        tokio::time::timeout(deadline, rest.chat_messages(&session, None, LATEST_PAGE)).await;
    match fetched {
        Err(_) => Fetched::Again(format!(
            "the chat messages did not arrive within {} s",
            deadline.as_secs()
        )),
        Ok(Ok(page)) => {
            if let Some(ticket) = fetching.take() {
                shared.with(|state| {
                    state.chat_fetched(ticket, page, LATEST_PAGE);
                    state.report_chat();
                });
            }
            Fetched::Done
        }
        Ok(Err(ReviewError::Absent)) => {
            drop(fetching);
            shared.with(|state| {
                state.set_chat_support(false);
                state.report_chat();
            });
            Fetched::Done
        }
        Ok(Err(error)) if error.is_temporary() => Fetched::Again(error.to_string()),
        Ok(Err(error)) => Fetched::Refused(error.to_string()),
    }
}

impl OverleafSession {
    fn chat_judged(&self, error: ReviewError) -> ReviewWriteError {
        match error {
            ReviewError::Absent if self.chat_support().available => ReviewWriteError::Gone,
            ReviewError::Absent => ReviewWriteError::Absent,
            ReviewError::Invalid(reason) => ReviewWriteError::Invalid(reason),
            ReviewError::Rest(RestError::NotAllowed) => ReviewWriteError::NotAllowed,
            other => ReviewWriteError::Rest(other),
        }
    }

    pub fn chat_support(&self) -> ChatSupport {
        self.shared.lock().chat_support()
    }

    pub async fn chat_page(
        &self,
        before: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ChatEntry>, ReviewWriteError> {
        let limit = limit.clamp(1, CHAT_PAGE_LIMIT);
        self.bounded(async {
            for _ in 0..PAGE_ROUNDS {
                let wanted = match self.shared.lock().chat_page(before, limit)? {
                    Paged::Ready(entries) => return Ok(entries),
                    Paged::Fetch(at) => at,
                };
                let ticket = self.shared.with(|state| state.begin_chat_fetch());
                let mut fetching = Fetching::new(&self.shared, ticket);
                let session = self.shared.session();
                let page = self
                    .rest
                    .chat_messages(&session, wanted, limit)
                    .await
                    .map_err(|error| self.chat_judged(error))?;
                let Some(ticket) = fetching.take() else {
                    continue;
                };
                self.shared.with(|state| match wanted {
                    Some(before) => state.chat_older_fetched(ticket, before, page, limit),
                    None => state.chat_fetched(ticket, page, limit),
                });
            }
            Ok(self.shared.lock().chat_served(before, limit))
        })
        .await
    }

    pub async fn send_chat(&self, content: &str) -> Result<ChatEntry, ReviewWriteError> {
        let (key, at, client_id) = self.shared.with(|state| {
            state.chat_writable()?;
            let (key, at) = state.begin_chat_send(content);
            Ok::<_, ReviewWriteError>((key, at, state.chat_client_id()))
        })?;
        let session = self.shared.session();
        let posted = self
            .bounded(async {
                self.rest
                    .post_chat(&session, content, &client_id)
                    .await
                    .map_err(|error| self.chat_judged(error))
            })
            .await;
        if let Err(error) = posted {
            self.shared.with(|state| state.cancel_chat_send(key));
            return Err(error);
        }
        let echoed = tokio::time::timeout(ECHO_WAIT.min(self.review_deadline), async {
            loop {
                if let Some(echo) = self.shared.lock().take_chat_echo(key) {
                    return echo;
                }
                tokio::time::sleep(ECHO_POLL).await;
            }
        })
        .await;
        let message = match echoed {
            Ok(echo) => Some(echo),
            Err(_) => self.find_sent(key, content, at).await,
        };
        Ok(self.shared.with(|state| match message {
            Some(message) => state.chat_sent(message),
            None => state.provisional_chat(key, content, at),
        }))
    }

    async fn find_sent(&self, key: u64, content: &str, at: i64) -> Option<ThreadMessage> {
        let session = self.shared.session();
        let recent = tokio::time::timeout(
            self.review_deadline,
            self.rest.chat_messages(&session, None, RECENT),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
        self.shared
            .with(|state| state.adopt_chat_send(key, recent, content, at))
    }

    pub async fn edit_chat(&self, id: &str, content: &str) -> Result<ChatEntry, ReviewWriteError> {
        self.shared.lock().chat_editable(id)?;
        let session = self.shared.session();
        self.bounded(async {
            self.rest
                .edit_chat(&session, id, content)
                .await
                .map_err(|error| self.chat_judged(error))
        })
        .await?;
        self.shared.with(|state| state.chat_edited(id, content))
    }

    pub async fn delete_chat(&self, id: &str) -> Result<(), ReviewWriteError> {
        self.shared.lock().chat_editable(id)?;
        let session = self.shared.session();
        self.bounded(async {
            self.rest
                .delete_chat(&session, id)
                .await
                .map_err(|error| self.chat_judged(error))
        })
        .await?;
        self.shared.with(|state| state.chat_deleted(id));
        Ok(())
    }
}
