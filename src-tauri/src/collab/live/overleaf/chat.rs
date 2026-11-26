use std::sync::Mutex;

use oleafly_collab::chat::{checked_chat_body, ChatMessage};
use oleafly_online::live::rest::{RestError, ReviewError};
use oleafly_online::live::session::{ChatChange, ChatEntry, ReviewWriteError};
use oleafly_ot::utf16_len;

use super::review::rest_code;
use super::{Mirror, OverleafLive};
use crate::collab::chat::{ChatChangedPayload, CollabChatStatus};
use crate::collab::commands::CollabCommandError;
use crate::collab::live::session::guard;

pub(crate) type OnlineChatMessage = ChatMessage<String, String>;

pub(crate) const OVERLEAF_CHAT_UNITS: usize = 10_240;

#[derive(Default)]
pub(crate) struct ChatMemory {
    trouble: Mutex<Option<String>>,
}

#[derive(Clone, Copy)]
enum Act {
    List,
    Send,
    Edit,
    Delete,
}

impl Act {
    fn what(self) -> &'static str {
        match self {
            Act::List => "load the chat",
            Act::Send => "send a chat message",
            Act::Edit => "edit a chat message",
            Act::Delete => "delete a chat message",
        }
    }
}

fn code_of(error: &ReviewWriteError, act: Act, body: &str) -> &'static str {
    let absent = matches!(
        error,
        ReviewWriteError::Absent | ReviewWriteError::Rest(ReviewError::Absent)
    );
    let invalid = matches!(
        error,
        ReviewWriteError::Invalid(_) | ReviewWriteError::Rest(ReviewError::Invalid(_))
    );
    match error {
        _ if absent && matches!(act, Act::List) => "not_found",
        _ if absent => "chat_off_server",
        _ if invalid && utf16_len(body) > OVERLEAF_CHAT_UNITS => "too_large",
        _ if invalid => "invalid",
        ReviewWriteError::Restricted => "chat_role",
        ReviewWriteError::NotAllowed
        | ReviewWriteError::Rest(ReviewError::Rest(RestError::NotAllowed)) => "forbidden",
        ReviewWriteError::Rest(ReviewError::TimedOut(_)) => "unreachable",
        ReviewWriteError::Rest(ReviewError::Rest(error)) => rest_code(error),
        _ => "not_found",
    }
}

fn message_of(entry: ChatEntry) -> OnlineChatMessage {
    let ChatEntry {
        message,
        deleted,
        pending,
    } = entry;
    ChatMessage {
        id: message.id,
        author: message.user_id.unwrap_or_default(),
        at: message.timestamp.unwrap_or_default(),
        body: message.content,
        deleted,
        verified: true,
        reactions: Vec::new(),
        pending,
        mentions: Vec::new(),
        edited_at: message.edited_at,
    }
}

fn log_line(project_id: &str, line: impl std::fmt::Display) -> String {
    format!("Overleaf chat in project {project_id}: {line}")
}

impl Mirror {
    pub(super) fn chat_noticed(&self, change: &ChatChange) -> Option<String> {
        let mut logged = guard(&self.chat.trouble);
        if *logged == change.trouble {
            return None;
        }
        logged.clone_from(&change.trouble);
        let trouble = change.trouble.as_ref()?;
        Some(log_line(
            &self.disk.project_id,
            format_args!("the chat could not be read: {trouble}"),
        ))
    }

    pub(super) fn tell_chat(&self, change: &ChatChange) {
        self.host.chat_changed(ChatChangedPayload {
            project_id: self.disk.project_id.clone(),
            local: change.local,
            mentioned: Vec::new(),
        });
    }
}

impl OverleafLive {
    fn chat_refusal(&self, what: &str, code: &'static str, message: String) -> CollabCommandError {
        let _ = crate::project::append_app_log(log_line(
            self.project_id(),
            format_args!("could not {what}: {code}: {message}"),
        ));
        CollabCommandError { code, message }
    }

    fn chat_failed(&self, act: Act, body: &str, error: &ReviewWriteError) -> CollabCommandError {
        let code = code_of(error, act, body);
        if code == "not_found"
            && matches!(act, Act::List)
            && !matches!(error, ReviewWriteError::Gone)
        {
            return CollabCommandError {
                code,
                message: error.to_string(),
            };
        }
        self.chat_refusal(act.what(), code, error.to_string())
    }

    fn chat_body<'a>(&self, act: Act, body: &'a str) -> Result<&'a str, CollabCommandError> {
        checked_chat_body(body, OVERLEAF_CHAT_UNITS, utf16_len).map_err(|error| {
            let refused = CollabCommandError::from(error);
            self.chat_refusal(act.what(), refused.code, refused.message)
        })
    }

    pub(crate) fn chat_status(&self) -> CollabChatStatus {
        let available = self.session.chat_support().available;
        CollabChatStatus {
            available,
            post: available,
            reactions: false,
            edit: true,
            clear: false,
            math: true,
            markdown: false,
            max_length: OVERLEAF_CHAT_UNITS,
        }
    }

    pub(crate) async fn chat_list(
        &self,
        before: Option<&str>,
        limit: usize,
    ) -> Result<Vec<OnlineChatMessage>, CollabCommandError> {
        let page = self
            .session
            .chat_page(before, limit)
            .await
            .map_err(|error| self.chat_failed(Act::List, "", &error))?;
        Ok(page
            .into_iter()
            .filter(|entry| !entry.deleted)
            .map(message_of)
            .collect())
    }

    pub(crate) async fn chat_send(
        &self,
        body: &str,
    ) -> Result<OnlineChatMessage, CollabCommandError> {
        let body = self.chat_body(Act::Send, body)?;
        self.session
            .send_chat(body)
            .await
            .map(message_of)
            .map_err(|error| self.chat_failed(Act::Send, body, &error))
    }

    pub(crate) async fn chat_edit(
        &self,
        id: &str,
        body: &str,
    ) -> Result<OnlineChatMessage, CollabCommandError> {
        let body = self.chat_body(Act::Edit, body)?;
        self.session
            .edit_chat(id, body)
            .await
            .map(message_of)
            .map_err(|error| self.chat_failed(Act::Edit, body, &error))
    }

    pub(crate) async fn chat_delete(&self, id: &str) -> Result<(), CollabCommandError> {
        self.session
            .delete_chat(id)
            .await
            .map_err(|error| self.chat_failed(Act::Delete, "", &error))
    }

    pub(crate) fn chat_reactions_refused(&self) -> CollabCommandError {
        self.chat_refusal(
            "react to a chat message",
            "forbidden",
            "Overleaf has no reactions in chat".to_owned(),
        )
    }

    pub(crate) fn chat_clear_refused(&self) -> CollabCommandError {
        self.chat_refusal(
            "clear the chat",
            "chat_role",
            "Overleaf has no way to clear the chat".to_owned(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_chat_failure_has_a_code_the_app_knows() {
        let long = "x".repeat(OVERLEAF_CHAT_UNITS + 1);
        let cases = [
            (ReviewWriteError::Absent, Act::List, "", "not_found"),
            (ReviewWriteError::Absent, Act::Send, "hi", "chat_off_server"),
            (ReviewWriteError::Restricted, Act::Send, "hi", "chat_role"),
            (ReviewWriteError::NotAllowed, Act::Edit, "hi", "forbidden"),
            (ReviewWriteError::Gone, Act::Delete, "", "not_found"),
            (ReviewWriteError::Gone, Act::List, "", "not_found"),
            (ReviewWriteError::Ended, Act::Send, "hi", "not_found"),
            (
                ReviewWriteError::Invalid("empty"),
                Act::Send,
                " ",
                "invalid",
            ),
            (
                ReviewWriteError::Invalid("long"),
                Act::Send,
                &long,
                "too_large",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::RateLimited(None))),
                Act::Send,
                "hi",
                "rate_limited",
            ),
            (
                ReviewWriteError::Rest(ReviewError::TimedOut(std::time::Duration::from_secs(30))),
                Act::Send,
                "hi",
                "unreachable",
            ),
            (
                ReviewWriteError::Rest(ReviewError::Rest(RestError::SignedOut)),
                Act::Send,
                "hi",
                "signed_out",
            ),
        ];
        for (error, act, body, code) in cases {
            assert_eq!(code_of(&error, act, body), code, "{error:?}");
            let known = CollabCommandError::from(oleafly_collab::CollabError::Api {
                status: 400,
                code: code.to_owned(),
                message: String::new(),
            });
            assert!(
                known.code == code || code == "not_found" || code == "forbidden",
                "{code} does not pass through: {}",
                known.code
            );
        }
    }

    #[test]
    fn overleaf_entries_keep_their_raw_ids_and_tombstones_say_deleted() {
        let entry = |deleted, pending| ChatEntry {
            message: oleafly_online::realtime::events::ThreadMessage {
                id: "6b04e5f6c0ffee0010000001".into(),
                user_id: Some("6b04e5f6c0ffee0020000001".into()),
                content: "Look at $x^2$".into(),
                timestamp: Some(1_763_200_000_123),
                edited_at: Some(1_763_200_000_456),
                user: None,
            },
            deleted,
            pending,
        };
        let shown = message_of(entry(false, true));
        assert_eq!(
            serde_json::to_value(&shown).unwrap(),
            serde_json::json!({
                "id": "6b04e5f6c0ffee0010000001",
                "author": "6b04e5f6c0ffee0020000001",
                "at": 1_763_200_000_123_i64,
                "body": "Look at $x^2$",
                "deleted": false,
                "verified": true,
                "reactions": [],
                "pending": true,
                "mentions": [],
                "editedAt": 1_763_200_000_456_i64,
            })
        );
        assert!(message_of(entry(true, false)).deleted);
    }
}
