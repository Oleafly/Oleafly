use reqwest::Response;
use serde_json::{json, Value};

use super::review::{comment_text, reviewed, segment};
use super::{json_of, ProjectRest, RestError};
use crate::live::rest::ReviewError;
use crate::realtime::events::ThreadMessage;
use crate::session::SessionHandle;

pub const CHAT_PAGE_LIMIT: usize = 200;

impl ProjectRest {
    pub async fn chat_messages(
        &self,
        session: &SessionHandle,
        before: Option<i64>,
        limit: usize,
    ) -> Result<Vec<ThreadMessage>, ReviewError> {
        let limit = limit.clamp(1, CHAT_PAGE_LIMIT);
        let path = match before {
            Some(before) => self.route(&format!("/messages?limit={limit}&before={before}")),
            None => self.route(&format!("/messages?limit={limit}")),
        };
        let response = self.get(session, &path).await.map_err(reviewed)?;
        let reply = json_of(response).await?;
        let listed = reply
            .as_array()
            .ok_or_else(|| RestError::Unreadable("the chat messages are not a list".into()))?;
        Ok(listed
            .iter()
            .filter_map(ThreadMessage::from_value)
            .collect())
    }

    async fn chat_write(
        &self,
        session: &SessionHandle,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Response, ReviewError> {
        self.write(session, |cookie| match body {
            Some(body) => self.http.post(path, cookie).json(body),
            None => self.http.delete(path, cookie),
        })
        .await
        .map_err(reviewed)
    }

    pub async fn post_chat(
        &self,
        session: &SessionHandle,
        content: &str,
        client_id: &str,
    ) -> Result<(), ReviewError> {
        let body = json!({ "content": comment_text(content)?, "client_id": client_id });
        let path = self.route("/messages");
        self.chat_write(session, &path, Some(&body)).await.map(drop)
    }

    pub async fn edit_chat(
        &self,
        session: &SessionHandle,
        message: &str,
        content: &str,
    ) -> Result<(), ReviewError> {
        let body = json!({ "content": comment_text(content)? });
        let path = self.route(&format!("/messages/{}/edit", segment(message)?));
        self.chat_write(session, &path, Some(&body)).await.map(drop)
    }

    pub async fn delete_chat(
        &self,
        session: &SessionHandle,
        message: &str,
    ) -> Result<(), ReviewError> {
        let path = self.route(&format!("/messages/{}", segment(message)?));
        self.chat_write(session, &path, None).await.map(drop)
    }
}

#[cfg(test)]
mod tests;
