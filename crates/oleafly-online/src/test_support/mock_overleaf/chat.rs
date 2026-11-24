use std::collections::HashMap;

use serde_json::{json, Value};

use super::{
    json_reply, now_ms, restricted, text_reply, MockOverleaf, MockPeer, PeerReply, Reply, State,
};

const MAX_MESSAGE_UNITS: usize = 10 * 1024;
const DEFAULT_LIMIT: usize = 50;
const HIDDEN_FROM_RESTRICTED: [&str; 3] = [
    "new-chat-message",
    "edit-global-message",
    "delete-global-message",
];

#[derive(Clone, Debug)]
pub(super) struct ChatMessage {
    id: String,
    user_id: String,
    content: String,
    timestamp: u64,
    edited_at: Option<u64>,
}

pub(super) fn hidden_from_restricted(name: &str) -> bool {
    HIDDEN_FROM_RESTRICTED.contains(&name)
}

pub(super) fn is_chat_route(route: &str) -> bool {
    matches!(
        route.split('/').collect::<Vec<_>>().as_slice(),
        ["messages"] | ["messages", _] | ["messages", _, "edit"]
    )
}

fn content_of(body: &[u8]) -> Option<String> {
    let body: Value = serde_json::from_slice(body).ok()?;
    let content = body["content"].as_str()?;
    let units = content.encode_utf16().count();
    (1..=MAX_MESSAGE_UNITS)
        .contains(&units)
        .then(|| content.to_string())
}

impl State {
    fn chat_json(&self, message: &ChatMessage) -> Value {
        let mut value = json!({
            "id": message.id,
            "content": message.content,
            "timestamp": message.timestamp,
            "user_id": message.user_id,
        });
        if let Some(edited) = message.edited_at {
            value["edited_at"] = json!(edited);
        }
        if let Some(user) = self.user(&message.user_id) {
            value["user"] = json!({
                "id": user.id,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "email": user.email,
            });
        }
        value
    }

    pub(super) fn chat_route(
        &mut self,
        method: &str,
        parts: &[&str],
        query: &HashMap<String, String>,
        user: &str,
        body: &[u8],
    ) -> Option<Reply> {
        if !is_chat_route(&parts.join("/")) {
            return None;
        }
        if !self.config.chat {
            return Some(Reply::status(404));
        }
        if self.restricted(user) {
            return Some(restricted());
        }
        Some(match (method, parts) {
            ("GET", ["messages"]) => self.chat_page(query),
            ("POST", ["messages"]) => self.post_chat(user, body),
            ("POST", ["messages", id, "edit"]) => self.edit_chat(id, user, body),
            ("DELETE", ["messages", id]) => self.delete_chat(id, user),
            _ => Reply::status(404),
        })
    }

    fn chat_page(&self, query: &HashMap<String, String>) -> Reply {
        let limit = query
            .get("limit")
            .and_then(|limit| limit.parse::<usize>().ok())
            .unwrap_or(DEFAULT_LIMIT);
        let before = query
            .get("before")
            .and_then(|before| before.parse::<u64>().ok());
        let page: Vec<Value> = self
            .chat
            .iter()
            .rev()
            .filter(|message| before.is_none_or(|before| message.timestamp < before))
            .take(limit)
            .map(|message| self.chat_json(message))
            .collect();
        json_reply(&Value::Array(page))
    }

    fn post_chat(&mut self, user: &str, body: &[u8]) -> Reply {
        let Some(content) = content_of(body) else {
            return text_reply(400, "invalid message");
        };
        let client = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|body| body["client_id"].as_str().map(str::to_string));
        let latest = self.chat.last().map_or(0, |message| message.timestamp);
        let message = ChatMessage {
            id: self.new_id(),
            user_id: user.to_string(),
            content,
            timestamp: (now_ms() as u64).max(latest + 1),
            edited_at: None,
        };
        let mut sent = self.chat_json(&message);
        sent["room_id"] = json!(self.project_id);
        if let Some(client) = client {
            sent["clientId"] = json!(client);
        }
        self.chat.push(message);
        self.emit_room("new-chat-message", &[sent], None);
        Reply::status(204)
    }

    fn edit_chat(&mut self, id: &str, user: &str, body: &[u8]) -> Reply {
        let Some(content) = content_of(body) else {
            return text_reply(500, "Internal Server Error");
        };
        let Some(found) = self.chat.iter_mut().find(|message| message.id == id) else {
            return Reply::status(404);
        };
        if found.user_id != user {
            return restricted();
        }
        found.content.clone_from(&content);
        found.edited_at = Some(now_ms() as u64);
        self.emit_room(
            "edit-global-message",
            &[json!({ "messageId": id, "userId": user, "content": content })],
            None,
        );
        Reply::status(204)
    }

    fn delete_chat(&mut self, id: &str, user: &str) -> Reply {
        let Some(at) = self.chat.iter().position(|message| message.id == id) else {
            return text_reply(500, "Internal Server Error");
        };
        if self.chat[at].user_id != user {
            return restricted();
        }
        self.chat.remove(at);
        self.emit_room(
            "delete-global-message",
            &[json!({ "messageId": id, "userId": user })],
            None,
        );
        Reply::status(204)
    }
}

impl MockOverleaf {
    pub fn chat_messages(&self) -> Value {
        let state = self.state();
        Value::Array(
            state
                .chat
                .iter()
                .map(|message| state.chat_json(message))
                .collect(),
        )
    }
}

impl MockPeer {
    pub fn post_chat(&self, content: &str, client_id: Option<&str>) -> PeerReply {
        let mut body = json!({ "content": content });
        if let Some(client) = client_id {
            body["client_id"] = json!(client);
        }
        self.rest("POST", "/messages", Some(body))
    }

    pub fn edit_chat(&self, id: &str, content: &str) -> PeerReply {
        self.rest(
            "POST",
            &format!("/messages/{id}/edit"),
            Some(json!({ "content": content })),
        )
    }

    pub fn delete_chat(&self, id: &str) -> PeerReply {
        self.rest("DELETE", &format!("/messages/{id}"), None)
    }

    pub fn chat_page(&self, before: Option<u64>, limit: usize) -> PeerReply {
        let query = match before {
            Some(before) => format!("/messages?limit={limit}&before={before}"),
            None => format!("/messages?limit={limit}"),
        };
        self.rest("GET", &query, None)
    }
}

#[cfg(test)]
mod tests;
