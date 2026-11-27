use serde_json::{json, Map, Value};

use super::{
    json_reply, now_ms, restricted, text_reply, Applied, DocFormat, Privilege, Reply, State,
    WithStatus,
};
use crate::live::history_ot::{edit_comment_list, Edit};
use crate::realtime::events::iso_time;

const MAX_MESSAGE_UNITS: usize = 10 * 1024;
const GUESTS: &str = "__guests__";
const HIDDEN_FROM_RESTRICTED: [&str; 7] = [
    "new-comment",
    "new-comment-threads",
    "edit-message",
    "delete-message",
    "resolve-thread",
    "reopen-thread",
    "delete-thread",
];

#[derive(Clone, Debug)]
pub(super) struct Message {
    id: String,
    user_id: String,
    content: String,
    timestamp: u64,
    edited_at: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct Thread {
    messages: Vec<Message>,
    resolved: Option<(String, u64)>,
}

pub(super) fn hidden_from_restricted(name: &str) -> bool {
    HIDDEN_FROM_RESTRICTED.contains(&name)
}

pub(super) fn is_review_route(route: &str) -> bool {
    let parts: Vec<&str> = route.split('/').collect();
    matches!(
        parts.as_slice(),
        ["threads"]
            | ["track_changes"]
            | ["thread", ..]
            | ["doc", _, "thread", ..]
            | ["doc", _, "changes", "accept"]
    )
}

fn object_id(id: &str) -> bool {
    id.len() == 24 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn bad_request(message: &str) -> Reply {
    text_reply(400, message)
}

fn content_of(body: &[u8]) -> Result<String, Reply> {
    let body: Value =
        serde_json::from_slice(body).map_err(|_| bad_request("No content provided"))?;
    let content = body["content"]
        .as_str()
        .ok_or_else(|| bad_request("No content provided"))?;
    match content.encode_utf16().count() {
        0 => Err(bad_request("No content provided")),
        units if units > MAX_MESSAGE_UNITS => Err(bad_request("Content too long")),
        _ => Ok(content.to_string()),
    }
}

impl State {
    fn user_json(&self, id: &str) -> Option<Value> {
        let user = self.user(id)?;
        Some(json!({
            "id": user.id,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
        }))
    }

    fn message_json(&self, message: &Message) -> Value {
        let mut value = json!({
            "id": message.id,
            "content": message.content,
            "timestamp": message.timestamp,
            "user_id": message.user_id,
        });
        if let Some(edited) = message.edited_at {
            value["edited_at"] = json!(edited);
        }
        if let Some(user) = self.user_json(&message.user_id) {
            value["user"] = user;
        }
        value
    }

    pub(super) fn threads_json(&self) -> Value {
        let mut threads = Map::new();
        for (id, thread) in &self.threads {
            if thread.messages.is_empty() {
                continue;
            }
            let mut entry = json!({
                "messages": thread.messages.iter().map(|message| self.message_json(message)).collect::<Vec<_>>(),
            });
            if let Some((by, at)) = &thread.resolved {
                entry["resolved"] = json!(true);
                entry["resolved_at"] = json!(iso_time(*at as i64));
                entry["resolved_by_user_id"] = json!(by);
                if let Some(user) = self.user_json(by) {
                    entry["resolved_by_user"] = user;
                }
            }
            threads.insert(id.clone(), entry);
        }
        Value::Object(threads)
    }

    fn may_moderate_thread(&self, user: &str, thread: &str) -> bool {
        match self.privilege(user) {
            Some(Privilege::Owner | Privilege::ReadAndWrite) => true,
            Some(Privilege::Review) => self
                .threads
                .get(thread)
                .and_then(|thread| thread.messages.first())
                .is_some_and(|first| first.user_id == user),
            _ => false,
        }
    }

    fn server_edit(&mut self, doc_id: &str, edit: &Edit, user: &str) {
        let Some(doc) = self.docs.get_mut(doc_id) else {
            return;
        };
        edit_comment_list(&mut doc.comments, edit);
        let Ok(op) = edit.to_json() else {
            return;
        };
        let at = doc.version;
        doc.version += 1;
        let update = json!({
            "doc": doc_id,
            "op": [op],
            "v": at,
            "meta": { "user_id": user, "ts": now_ms() as u64 },
        });
        doc.applied.push_back(Applied {
            at,
            source: String::new(),
            update: update.clone(),
        });
        self.broadcast(doc_id, "", &update);
    }

    pub(super) fn review_route(
        &mut self,
        method: &str,
        parts: &[&str],
        user: &str,
        body: &[u8],
    ) -> Option<Reply> {
        if !is_review_route(&parts.join("/")) {
            return None;
        }
        if !self.config.review {
            return Some(Reply::status(404));
        }
        if self.restricted(user) {
            return Some(restricted());
        }
        Some(match (method, parts) {
            ("GET", ["threads"]) => json_reply(&self.threads_json()),
            ("POST", ["thread", thread, "messages"]) => self.post_message(thread, user, body),
            ("POST", ["thread", thread, "messages", message, "edit"]) => {
                self.edit_message(thread, message, user, body)
            }
            ("DELETE", ["thread", thread, "messages", message]) => {
                if !self.privilege(user).is_some_and(Privilege::can_write) {
                    return Some(restricted());
                }
                self.delete_message(thread, message, None)
            }
            ("DELETE", ["thread", thread, "own-messages", message]) => {
                self.delete_message(thread, message, Some(user))
            }
            ("POST", ["doc", doc, "thread", thread, change @ ("resolve" | "reopen")]) => {
                self.set_resolved(doc, thread, user, *change == "resolve")
            }
            ("DELETE", ["doc", doc, "thread", thread]) => self.delete_thread(doc, thread, user),
            ("POST", ["doc", doc, "changes", "accept"]) => self.accept(doc, user, body),
            ("POST", ["track_changes"]) => self.track_changes_route(user, body),
            _ => Reply::status(404),
        })
    }

    fn post_message(&mut self, thread: &str, user: &str, body: &[u8]) -> Reply {
        if !object_id(thread) {
            return bad_request("Invalid thread id");
        }
        let content = match content_of(body) {
            Ok(content) => content,
            Err(reply) => return reply,
        };
        let message = Message {
            id: self.new_id(),
            user_id: user.to_string(),
            content,
            timestamp: now_ms() as u64,
            edited_at: None,
        };
        let sent = self.message_json(&message);
        self.threads
            .entry(thread.to_string())
            .or_default()
            .messages
            .push(message);
        self.emit_room("new-comment", &[json!(thread), sent.clone()], None);
        json_reply(&sent).with_status(201)
    }

    fn edit_message(&mut self, thread: &str, message: &str, user: &str, body: &[u8]) -> Reply {
        let content = match content_of(body) {
            Ok(content) => content,
            Err(reply) => return reply,
        };
        let Some(found) = self
            .threads
            .get_mut(thread)
            .and_then(|thread| thread.messages.iter_mut().find(|found| found.id == message))
        else {
            return Reply::status(404);
        };
        if found.user_id != user {
            return restricted();
        }
        found.content.clone_from(&content);
        found.edited_at = Some(now_ms() as u64);
        self.emit_room(
            "edit-message",
            &[json!(thread), json!(message), json!(content)],
            None,
        );
        Reply::status(204)
    }

    fn delete_message(&mut self, thread: &str, message: &str, author: Option<&str>) -> Reply {
        let Some(messages) = self
            .threads
            .get_mut(thread)
            .map(|thread| &mut thread.messages)
        else {
            return Reply::status(404);
        };
        let Some(at) = messages.iter().position(|found| found.id == message) else {
            return Reply::status(404);
        };
        if author.is_some_and(|author| messages[at].user_id != author) {
            return restricted();
        }
        messages.remove(at);
        self.emit_room("delete-message", &[json!(thread), json!(message)], None);
        Reply::status(204)
    }

    fn set_resolved(&mut self, doc: &str, thread: &str, user: &str, resolved: bool) -> Reply {
        let Some(format) = self.docs.get(doc).map(|found| found.format) else {
            return Reply::status(404);
        };
        if !self.may_moderate_thread(user, thread) {
            return restricted();
        }
        if let Some(found) = self.threads.get_mut(thread) {
            found.resolved = resolved.then(|| (user.to_string(), now_ms() as u64));
        }
        if format == DocFormat::HistoryOt {
            let edit = Edit::SetCommentState {
                id: thread.to_string(),
                resolved,
            };
            self.server_edit(doc, &edit, user);
        }
        if resolved {
            let by = self
                .user_json(user)
                .unwrap_or_else(|| json!({ "id": user }));
            self.emit_room("resolve-thread", &[json!(thread), by], None);
        } else {
            self.emit_room("reopen-thread", &[json!(thread)], None);
        }
        Reply::status(204)
    }

    fn delete_thread(&mut self, doc: &str, thread: &str, user: &str) -> Reply {
        let Some(format) = self.docs.get(doc).map(|found| found.format) else {
            return Reply::status(404);
        };
        if !self.may_moderate_thread(user, thread) {
            return restricted();
        }
        self.threads.remove(thread);
        match format {
            DocFormat::ShareJs => {
                if let Some(found) = self.docs.get_mut(doc) {
                    found.ranges.remove_comment(thread);
                }
            }
            DocFormat::HistoryOt => {
                self.server_edit(doc, &Edit::DeleteComment(thread.to_string()), user);
            }
        }
        self.emit_room("delete-thread", &[json!(thread)], None);
        Reply::status(204)
    }

    fn accept(&mut self, doc: &str, user: &str, body: &[u8]) -> Reply {
        if !self.privilege(user).is_some_and(Privilege::can_write) {
            return restricted();
        }
        let Some(found) = self.docs.get_mut(doc) else {
            return Reply::status(404);
        };
        if found.format == DocFormat::HistoryOt {
            return text_reply(422, "Cannot accept changes on a history-ot doc");
        }
        let ids: Option<Vec<String>> = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|body| body["change_ids"].as_array().cloned())
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str().map(str::to_string))
                    .collect()
            });
        let Some(ids) = ids.filter(|ids| !ids.is_empty()) else {
            return bad_request("change_ids is required");
        };
        found.ranges.remove_changes(&ids);
        self.emit_room("accept-changes", &[json!(doc), json!(ids)], None);
        Reply::status(204)
    }

    fn track_changes_route(&mut self, user: &str, body: &[u8]) -> Reply {
        let privilege = self.privilege(user);
        if !privilege.is_some_and(Privilege::can_write) {
            return restricted();
        }
        let Ok(body) = serde_json::from_slice::<Value>(body) else {
            return bad_request("a body is required");
        };
        let mut state = match &self.track_changes {
            Value::Object(map) => map.clone(),
            _ => Map::new(),
        };
        let owner = privilege == Some(Privilege::Owner);
        if let Some(members) = body["on_for"].as_object() {
            let others = |map: &Map<String, Value>| -> Vec<String> {
                map.iter()
                    .filter(|(member, on)| {
                        member.as_str() != GUESTS
                            && member.as_str() != user
                            && on.as_bool() == Some(true)
                    })
                    .map(|(member, _)| member.clone())
                    .collect()
            };
            if others(&state) != others(members) && !owner {
                return restricted();
            }
            let guests = state.remove(GUESTS);
            state = members.clone();
            if let Some(guests) = guests {
                state.insert(GUESTS.into(), guests);
            }
        } else if let Some(guests) = body["on_for_guests"].as_bool() {
            if !owner {
                return restricted();
            }
            state.insert(GUESTS.into(), json!(guests));
        } else {
            return bad_request("on_for or on_for_guests is required");
        }
        self.set_track_changes(Value::Object(state));
        Reply::status(204)
    }
}

#[cfg(test)]
mod tests;
