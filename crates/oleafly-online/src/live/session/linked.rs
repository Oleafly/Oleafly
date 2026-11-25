use std::future::Future;
use std::time::Duration;

use super::OverleafSession;
use crate::live::rest::{RestError, REFRESH_DEADLINE};
use crate::realtime::events::EntityId;
use crate::realtime::tree::NodeKind;

const STOP_POLL: Duration = Duration::from_millis(100);
const REPLY_SLACK: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LinkedError {
    #[error("the project is no longer live")]
    Ended,
    #[error("that file is not on Overleaf")]
    Unknown,
    #[error("that file is not linked to a source")]
    NotLinked,
    #[error("this server doesn't refresh linked files")]
    Off,
    #[error("the file changed on Overleaf before the refresh")]
    Gone,
    #[error("your role does not allow it")]
    NotAllowed,
    #[error("Overleaf refused it ({status}): {message}")]
    Refused { status: u16, message: String },
    #[error("no reply within {} s", .0.as_secs())]
    TimedOut(Duration),
    #[error(transparent)]
    Rest(RestError),
}

pub(super) enum Raced<T> {
    Done(T),
    TimedOut(Duration),
    Stopped,
}

const LINKED_OFF: &str = "Bad Request";

fn linked_error(error: RestError) -> LinkedError {
    match error {
        RestError::Refused {
            status: 400,
            message,
        } if message == LINKED_OFF => LinkedError::Off,
        RestError::Refused {
            status: 404,
            message,
        } if message.is_empty() => LinkedError::Gone,
        RestError::Refused { status: 409, .. } => LinkedError::NotLinked,
        RestError::Refused { status, message } => LinkedError::Refused { status, message },
        RestError::ServerFailed { status, message } if !message.is_empty() => {
            LinkedError::Refused { status, message }
        }
        RestError::NotAllowed => LinkedError::NotAllowed,
        other => LinkedError::Rest(other),
    }
}

impl OverleafSession {
    pub(super) async fn raced<T>(
        &self,
        limit: Duration,
        work: impl Future<Output = T>,
    ) -> Raced<T> {
        let stopped = async {
            while !self.shared.is_stopping() {
                tokio::time::sleep(STOP_POLL).await;
            }
        };
        tokio::select! {
            biased;
            () = stopped => Raced::Stopped,
            outcome = tokio::time::timeout(limit, work) => match outcome {
                Ok(value) => Raced::Done(value),
                Err(_) => Raced::TimedOut(limit),
            },
        }
    }

    pub async fn refresh_linked(&self, file: &EntityId) -> Result<EntityId, LinkedError> {
        let (node, ended) = {
            let state = self.shared.lock();
            (
                state.project.tree.server_node(file).cloned(),
                state.ended.is_some(),
            )
        };
        if ended || self.shared.is_stopping() {
            return Err(LinkedError::Ended);
        }
        let node = node.ok_or(LinkedError::Unknown)?;
        if node.kind != NodeKind::File || node.linked.is_none() {
            return Err(LinkedError::NotLinked);
        }
        let reindex = node.name.to_ascii_lowercase().ends_with(".bib");
        let session = self.shared.session();
        let refresh =
            self.rest
                .refresh_linked(&session, file, reindex, REFRESH_DEADLINE + REPLY_SLACK);
        match self.raced(REFRESH_DEADLINE, refresh).await {
            Raced::Done(outcome) => outcome.map_err(linked_error),
            Raced::TimedOut(limit) => Err(LinkedError::TimedOut(limit)),
            Raced::Stopped => Err(LinkedError::Ended),
        }
    }
}
