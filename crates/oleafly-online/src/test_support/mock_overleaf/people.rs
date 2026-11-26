use serde_json::{json, Value};

use super::{json_reply, restricted, MockOverleaf, MockUser, Privilege, Reply, State};

#[derive(Clone, Debug)]
pub(super) struct Invite {
    pub(super) id: String,
    pub(super) email: String,
    pub(super) privilege: Privilege,
    pub(super) token: String,
}

impl State {
    pub(super) fn person_named(&self, name: &str) -> MockUser {
        self.people()
            .find(|user| user.first_name.eq_ignore_ascii_case(name))
            .cloned()
            .unwrap_or_else(|| MockUser::named(name))
    }

    pub(super) fn accept_invite_at(&mut self, at: usize, person: Option<MockUser>) {
        let invite = self.invites.remove(at);
        if let Some(person) = person {
            self.outsiders.retain(|outsider| outsider.id != person.id);
            self.token_viewers.retain(|viewer| viewer.id != person.id);
            if self.privilege(&person.id).is_none() {
                self.members.push((person, invite.privilege));
            }
        }
        self.emit_room(
            "project:membership:changed",
            &[json!({ "invites": true, "members": true })],
            None,
        );
    }

    pub(super) fn invites_json(&self) -> Vec<Value> {
        self.invites
            .iter()
            .map(|invite| {
                json!({
                    "_id": invite.id,
                    "email": invite.email,
                    "privileges": invite.privilege.wire_name(),
                })
            })
            .collect()
    }

    pub(super) fn people_route(
        &mut self,
        method: &str,
        parts: &[&str],
        user: &str,
    ) -> Option<Reply> {
        match (method, parts) {
            ("GET", ["invites"]) if self.privilege(user) == Some(Privilege::Owner) => {
                Some(json_reply(&json!({ "invites": self.invites_json() })))
            }
            ("GET", ["invites"]) => Some(restricted()),
            ("GET", ["changes", "users"]) if !self.config.review => Some(Reply::status(404)),
            ("GET", ["changes", "users"]) => Some(self.change_users()),
            _ => None,
        }
    }

    fn change_users(&self) -> Reply {
        let mut authors: Vec<String> = Vec::new();
        for doc in self.docs.values() {
            for change in doc.ranges.changes() {
                authors.extend(change.user.clone());
            }
            for mark in doc.tracked.iter().flatten() {
                authors.extend(mark["userId"].as_str().map(str::to_string));
            }
        }
        authors.sort();
        authors.dedup();
        let users: Vec<Value> = authors
            .iter()
            .filter_map(|id| self.user(id))
            .map(|user| {
                json!({
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                })
            })
            .collect();
        json_reply(&Value::Array(users))
    }
}

impl MockOverleaf {
    pub fn invite(&self, email: &str, privilege: Privilege) -> String {
        let mut state = self.state();
        let id = state.new_id();
        state.invites.push(Invite {
            token: format!("{id}{id}"),
            id: id.clone(),
            email: email.to_string(),
            privilege,
        });
        state.emit_room(
            "project:membership:changed",
            &[json!({ "invites": true })],
            None,
        );
        id
    }

    pub fn accept_invite(&self, email: &str, name: &str) {
        let mut state = self.state();
        let Some(at) = state
            .invites
            .iter()
            .position(|invite| invite.email == email)
        else {
            return;
        };
        let person = state.person_named(name);
        state.accept_invite_at(at, Some(person));
    }
}
