use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::Response;
use serde_json::{json, Value};

use super::{json_of, ProjectRest, RestError};
use crate::client::{self, SMALL_BODY_BYTES};
use crate::realtime::events::{plain_id, DocId, Thread, ThreadMessage};
use crate::session::SessionHandle;

pub const MAX_COMMENT_UNITS: usize = 10 * 1024;
pub const REVIEW_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReviewError {
    #[error("this server has no comments and review, or the item is gone")]
    Absent,
    #[error("not a valid review request: {0}")]
    Invalid(&'static str),
    #[error("no reply within {} s", .0.as_secs())]
    TimedOut(Duration),
    #[error(transparent)]
    Rest(#[from] RestError),
}

impl ReviewError {
    pub fn is_temporary(&self) -> bool {
        match self {
            ReviewError::TimedOut(_) => true,
            ReviewError::Rest(error) => error.is_temporary(),
            ReviewError::Absent | ReviewError::Invalid(_) => false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeleteAs {
    Author,
    Moderator,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrackChangesUpdate {
    Members(BTreeMap<String, bool>),
    Guests(bool),
}

pub(super) fn reviewed(error: RestError) -> ReviewError {
    match error {
        RestError::Refused { status: 404, .. } => ReviewError::Absent,
        RestError::Refused { status: 403, .. } => ReviewError::Rest(RestError::NotAllowed),
        other => ReviewError::Rest(other),
    }
}

pub(super) fn segment(id: &str) -> Result<&str, ReviewError> {
    if plain_id(id) {
        Ok(id)
    } else {
        Err(ReviewError::Invalid("an id with unexpected characters"))
    }
}

pub(super) fn comment_text(content: &str) -> Result<&str, ReviewError> {
    match content.encode_utf16().count() {
        0 => Err(ReviewError::Invalid("an empty message")),
        units if units > MAX_COMMENT_UNITS => Err(ReviewError::Invalid("a message over 10 KiB")),
        _ => Ok(content),
    }
}

impl ProjectRest {
    pub async fn threads(&self, session: &SessionHandle) -> Result<Vec<Thread>, ReviewError> {
        let response = self
            .get(session, &self.route("/threads"))
            .await
            .map_err(reviewed)?;
        let reply = json_of(response).await?;
        Thread::list_from_value(&reply)
            .ok_or_else(|| RestError::Unreadable("the threads are not a map".into()).into())
    }

    async fn review_write(
        &self,
        session: &SessionHandle,
        path: &str,
        delete: bool,
        body: Option<&Value>,
    ) -> Result<Response, ReviewError> {
        self.write(session, |cookie| match (delete, body) {
            (true, _) => self.http.delete(path, cookie),
            (false, Some(body)) => self.http.post(path, cookie).json(body),
            (false, None) => self.http.post(path, cookie),
        })
        .await
        .map_err(reviewed)
    }

    pub async fn post_message(
        &self,
        session: &SessionHandle,
        thread: &str,
        content: &str,
    ) -> Result<Option<ThreadMessage>, ReviewError> {
        let path = self.route(&format!("/thread/{}/messages", segment(thread)?));
        let body = json!({ "content": comment_text(content)? });
        let response = self
            .review_write(session, &path, false, Some(&body))
            .await?;
        let reply = client::read_capped(response, SMALL_BODY_BYTES)
            .await
            .unwrap_or_default();
        Ok(serde_json::from_slice::<Value>(&reply)
            .ok()
            .as_ref()
            .and_then(ThreadMessage::from_value))
    }

    pub async fn edit_message(
        &self,
        session: &SessionHandle,
        thread: &str,
        message: &str,
        content: &str,
    ) -> Result<(), ReviewError> {
        let path = self.route(&format!(
            "/thread/{}/messages/{}/edit",
            segment(thread)?,
            segment(message)?
        ));
        let body = json!({ "content": comment_text(content)? });
        self.review_write(session, &path, false, Some(&body))
            .await
            .map(drop)
    }

    pub async fn delete_message(
        &self,
        session: &SessionHandle,
        thread: &str,
        message: &str,
        by: DeleteAs,
    ) -> Result<(), ReviewError> {
        let (thread, message) = (segment(thread)?, segment(message)?);
        let route = |kind: &str| self.route(&format!("/thread/{thread}/{kind}/{message}"));
        if by == DeleteAs::Author {
            match self
                .review_write(session, &route("own-messages"), true, None)
                .await
            {
                Err(ReviewError::Absent) => {}
                other => return other.map(drop),
            }
        }
        self.review_write(session, &route("messages"), true, None)
            .await
            .map(drop)
    }

    fn thread_route(&self, doc: &DocId, thread: &str, rest: &str) -> Result<String, ReviewError> {
        Ok(self.route(&format!(
            "/doc/{}/thread/{}{rest}",
            segment(&doc.0)?,
            segment(thread)?
        )))
    }

    pub async fn resolve_thread(
        &self,
        session: &SessionHandle,
        doc: &DocId,
        thread: &str,
    ) -> Result<(), ReviewError> {
        let path = self.thread_route(doc, thread, "/resolve")?;
        self.review_write(session, &path, false, None)
            .await
            .map(drop)
    }

    pub async fn reopen_thread(
        &self,
        session: &SessionHandle,
        doc: &DocId,
        thread: &str,
    ) -> Result<(), ReviewError> {
        let path = self.thread_route(doc, thread, "/reopen")?;
        self.review_write(session, &path, false, None)
            .await
            .map(drop)
    }

    pub async fn delete_thread(
        &self,
        session: &SessionHandle,
        doc: &DocId,
        thread: &str,
    ) -> Result<(), ReviewError> {
        let path = self.thread_route(doc, thread, "")?;
        self.review_write(session, &path, true, None)
            .await
            .map(drop)
    }

    pub async fn accept_changes(
        &self,
        session: &SessionHandle,
        doc: &DocId,
        changes: &[String],
    ) -> Result<(), ReviewError> {
        if changes.is_empty() {
            return Err(ReviewError::Invalid("no changes to accept"));
        }
        for change in changes {
            segment(change)?;
        }
        let path = self.route(&format!("/doc/{}/changes/accept", segment(&doc.0)?));
        let body = json!({ "change_ids": changes });
        self.review_write(session, &path, false, Some(&body))
            .await
            .map(drop)
    }

    pub async fn set_track_changes(
        &self,
        session: &SessionHandle,
        update: &TrackChangesUpdate,
    ) -> Result<(), ReviewError> {
        let body = match update {
            TrackChangesUpdate::Members(members) => {
                for member in members.keys() {
                    segment(member)?;
                }
                json!({ "on_for": members })
            }
            TrackChangesUpdate::Guests(on) => json!({ "on_for_guests": on }),
        };
        let path = self.route("/track_changes");
        self.review_write(session, &path, false, Some(&body))
            .await
            .map(drop)
    }
}
