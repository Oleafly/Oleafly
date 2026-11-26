use std::collections::BTreeMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use super::state::IdsReady;
use super::OverleafSession;
use crate::live::doc::{ChangeSpan, CommentSpan, ReviewOp};
use crate::live::format::{new_thread_id, Decision, DocFormat};
use crate::live::rest::{within, DeleteAs, ReviewError};
use crate::live::DocId;
use crate::realtime::events::{ReviewEvent, Thread, ThreadMessage};
use crate::realtime::project::Role;

const ID_POLL: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReviewSupport {
    pub probed: bool,
    pub threads: bool,
    pub accept_rest: bool,
    pub switch_rest: bool,
    pub plan_allows_tracking: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReviewChange {
    pub docs: Vec<DocId>,
    pub threads: bool,
    pub support: bool,
    pub dropped: Vec<(DocId, ReviewOp)>,
    pub trouble: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocReview {
    pub rev: Option<u64>,
    pub format: DocFormat,
    pub comments: Vec<CommentSpan>,
    pub changes: Vec<ChangeSpan>,
    pub can_accept: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReviewCounts {
    pub open: usize,
    pub resolved: usize,
    pub changes: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThreadsView {
    pub loaded: bool,
    pub threads: Arc<BTreeMap<String, Thread>>,
    pub anchored: BTreeMap<String, DocId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrackScope {
    Me,
    Everyone,
    Guests,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeLock {
    Reviewer,
    Everyone,
    Plan,
    Server,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditModeView {
    pub tracking: bool,
    pub role: Role,
    pub switchable: bool,
    pub locked: Option<ModeLock>,
    pub everyone: bool,
    pub guests: bool,
    pub manage: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewComment {
    pub thread: String,
    pub message: Option<ThreadMessage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decided {
    pub missing: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReviewWriteError {
    #[error("the project is no longer live")]
    Ended,
    #[error("that file is not a live document")]
    UnknownDoc,
    #[error("the editor moved on since the selection was made")]
    Stale,
    #[error("this server does not offer it")]
    Absent,
    #[error("your role does not allow it")]
    NotAllowed,
    #[error("link viewers can't use it")]
    Restricted,
    #[error("it is no longer there")]
    Gone,
    #[error("not a valid review request: {0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Rest(ReviewError),
}

impl ReviewWriteError {
    pub fn is_temporary(&self) -> bool {
        matches!(self, ReviewWriteError::Rest(error) if error.is_temporary())
    }
}

impl OverleafSession {
    fn judged(&self, error: ReviewError) -> ReviewWriteError {
        match error {
            ReviewError::Absent if self.review_support().threads => ReviewWriteError::Gone,
            ReviewError::Absent => ReviewWriteError::Absent,
            ReviewError::Invalid(reason) => ReviewWriteError::Invalid(reason),
            ReviewError::Rest(crate::live::rest::RestError::NotAllowed) => {
                ReviewWriteError::NotAllowed
            }
            other => ReviewWriteError::Rest(other),
        }
    }

    pub(super) async fn bounded<T>(
        &self,
        work: impl Future<Output = Result<T, ReviewWriteError>>,
    ) -> Result<T, ReviewWriteError> {
        within(
            self.review_deadline,
            |limit| ReviewWriteError::Rest(ReviewError::TimedOut(limit)),
            work,
        )
        .await
    }

    pub fn review_support(&self) -> ReviewSupport {
        self.shared.lock().review_support()
    }

    pub fn review(&self, doc: &DocId) -> Option<DocReview> {
        self.shared.lock().doc_review(doc)
    }

    pub fn review_counts(&self) -> Vec<(DocId, ReviewCounts)> {
        let counts = self.shared.with(|state| {
            state.want_every_doc();
            state.review_counts()
        });
        self.poke();
        counts
    }

    pub fn threads(&self) -> ThreadsView {
        let threads = self.shared.with(|state| {
            state.want_every_doc();
            state.threads_view()
        });
        self.poke();
        threads
    }

    pub fn edit_mode(&self) -> EditModeView {
        self.shared.lock().edit_mode()
    }

    pub async fn comment(
        &self,
        doc: &DocId,
        from: usize,
        to: usize,
        rev: Option<u64>,
        content: &str,
    ) -> Result<NewComment, ReviewWriteError> {
        let thread = new_thread_id().map_err(|_| ReviewWriteError::Invalid("no random source"))?;
        let key = self
            .shared
            .with(|state| state.reserve_comment(doc, from, to, rev))?;
        let session = self.shared.session();
        let posted = self
            .bounded(async {
                self.rest
                    .post_message(&session, &thread, content)
                    .await
                    .map_err(|error| self.judged(error))
            })
            .await;
        let finished = self
            .shared
            .with(|state| state.finish_comment(doc, key, &thread, posted.as_ref().ok().cloned()));
        self.poke();
        let message = posted?;
        finished?;
        Ok(NewComment { thread, message })
    }

    pub async fn reply(
        &self,
        thread: &str,
        content: &str,
    ) -> Result<Option<ThreadMessage>, ReviewWriteError> {
        self.shared.lock().threads_writable()?;
        let session = self.shared.session();
        let message = self
            .bounded(async {
                self.rest
                    .post_message(&session, thread, content)
                    .await
                    .map_err(|error| self.judged(error))
            })
            .await?;
        if let Some(message) = &message {
            self.shared
                .with(|state| state.add_own_message(thread, message.clone()));
        }
        Ok(message)
    }

    pub async fn edit_message(
        &self,
        thread: &str,
        message: &str,
        content: &str,
    ) -> Result<(), ReviewWriteError> {
        self.shared.lock().threads_writable()?;
        let session = self.shared.session();
        self.bounded(async {
            self.rest
                .edit_message(&session, thread, message, content)
                .await
                .map_err(|error| self.judged(error))
        })
        .await?;
        self.shared.with(|state| {
            state.patch_threads(ReviewEvent::MessageEdited {
                thread: thread.to_string(),
                message: message.to_string(),
                content: content.to_string(),
            })
        });
        Ok(())
    }

    pub async fn delete_message(
        &self,
        thread: &str,
        message: &str,
        own: bool,
    ) -> Result<(), ReviewWriteError> {
        self.shared.lock().threads_writable()?;
        let session = self.shared.session();
        let by = if own {
            DeleteAs::Author
        } else {
            DeleteAs::Moderator
        };
        self.bounded(async {
            self.rest
                .delete_message(&session, thread, message, by)
                .await
                .map_err(|error| self.judged(error))
        })
        .await?;
        self.shared.with(|state| {
            state.patch_threads(ReviewEvent::MessageDeleted {
                thread: thread.to_string(),
                message: message.to_string(),
            })
        });
        Ok(())
    }

    fn by_op(&self, doc: &DocId) -> Result<bool, ReviewWriteError> {
        let state = self.shared.lock();
        state.review_writable()?;
        Ok(state.doc_format(doc) == Some(DocFormat::HistoryOt) && state.may_send_comment_ops())
    }

    pub async fn set_resolved(
        &self,
        doc: &DocId,
        thread: &str,
        resolved: bool,
    ) -> Result<(), ReviewWriteError> {
        if self.by_op(doc)? {
            let queued = self.shared.with(|state| {
                state.queue_doc_review(
                    doc,
                    ReviewOp::Resolve {
                        thread: thread.to_string(),
                        resolved,
                    },
                )
            });
            self.poke();
            return queued;
        }
        self.shared.lock().threads_writable()?;
        let session = self.shared.session();
        self.bounded(async {
            let call = if resolved {
                self.rest.resolve_thread(&session, doc, thread).await
            } else {
                self.rest.reopen_thread(&session, doc, thread).await
            };
            call.map_err(|error| self.judged(error))
        })
        .await?;
        self.shared.with(|state| {
            let event = if resolved {
                ReviewEvent::Resolved {
                    thread: thread.to_string(),
                    by: Some(Box::new(state.me_as_user())),
                }
            } else {
                ReviewEvent::Reopened {
                    thread: thread.to_string(),
                }
            };
            state.patch_threads(event);
        });
        Ok(())
    }

    pub async fn delete_thread(&self, doc: &DocId, thread: &str) -> Result<(), ReviewWriteError> {
        if self.by_op(doc)? {
            let queued = self.shared.with(|state| {
                state.queue_doc_review(
                    doc,
                    ReviewOp::Uncomment {
                        thread: thread.to_string(),
                    },
                )
            });
            self.poke();
            return queued;
        }
        self.shared.lock().threads_writable()?;
        let session = self.shared.session();
        self.bounded(async {
            self.rest
                .delete_thread(&session, doc, thread)
                .await
                .map_err(|error| self.judged(error))
        })
        .await?;
        self.shared
            .with(|state| state.thread_removed_by_rest(thread));
        Ok(())
    }

    pub async fn decide(
        &self,
        ids: &[String],
        decision: Decision,
    ) -> Result<Decided, ReviewWriteError> {
        let (found, missing) = {
            let state = self.shared.lock();
            state.review_writable()?;
            state.docs_of_changes(ids)
        };
        if found.is_empty() {
            return Err(ReviewWriteError::Gone);
        }
        self.bounded(async {
            for (doc, ids) in found {
                let format = self.shared.lock().doc_format(&doc);
                let by_rest = format == Some(DocFormat::ShareJs) && decision == Decision::Accept;
                if by_rest {
                    match self.accept_by_rest(&doc, &ids).await {
                        Err(ReviewWriteError::Absent) => {}
                        other => {
                            other?;
                            continue;
                        }
                    }
                }
                self.shared
                    .with(|state| state.queue_decision(&doc, ids, decision))?;
                self.poke();
            }
            Ok(())
        })
        .await?;
        Ok(Decided { missing })
    }

    async fn accept_by_rest(&self, doc: &DocId, ids: &[String]) -> Result<(), ReviewWriteError> {
        {
            let state = self.shared.lock();
            let support = state.review_support();
            if support.probed && !support.accept_rest {
                return Err(ReviewWriteError::Absent);
            }
            if !state.project.role.can_edit() {
                return Err(ReviewWriteError::NotAllowed);
            }
        }
        let mut asked = false;
        let server_ids = loop {
            let ready = self.shared.lock().server_ids(doc, ids, asked);
            match ready {
                IdsReady::Known(found) => break found,
                IdsReady::Failed => return Err(ReviewWriteError::Gone),
                IdsReady::Waiting if !asked => {
                    self.shared.with(|state| state.want_ranges(doc));
                    asked = true;
                    self.poke();
                }
                IdsReady::Waiting => tokio::time::sleep(ID_POLL).await,
            }
        };
        let session = self.shared.session();
        self.rest
            .accept_changes(&session, doc, &server_ids)
            .await
            .map_err(|error| self.judged(error))?;
        self.shared
            .with(|state| state.accepted_by_rest(doc, &server_ids));
        Ok(())
    }

    pub async fn set_track_changes(
        &self,
        scope: TrackScope,
        on: bool,
    ) -> Result<(), ReviewWriteError> {
        let (update, state_after) = self.shared.lock().track_changes_body(scope, on)?;
        let session = self.shared.session();
        self.bounded(async {
            self.rest
                .set_track_changes(&session, &update)
                .await
                .map_err(|error| self.judged(error))
        })
        .await?;
        self.shared
            .with(|state| state.track_changes_saved(state_after));
        Ok(())
    }
}
