use std::collections::HashMap;

use serde_json::{json, Value};

use super::{json_reply, text_reply, MockOverleaf, MockUser, Privilege, Reply, State};

const READ_TOKEN: &str = "qwertyuiopas";
const EDIT_TOKEN: &str = "4815162342asdfghjklzxc";
const EDIT_HASH: &str = "a1b2c3";

fn not_found() -> Reply {
    text_reply(404, "<html>Not found</html>").header("Content-Type", "text/html; charset=utf-8")
}

fn rank(privilege: Privilege) -> u8 {
    match privilege {
        Privilege::Owner => 3,
        Privilege::ReadAndWrite => 2,
        Privilege::Review => 1,
        Privilege::ReadOnly => 0,
    }
}

impl State {
    pub(super) fn notifications_for(&self, user: &MockUser) -> Value {
        let notifications: Vec<Value> = self
            .invites
            .iter()
            .filter(|invite| invite.email == user.email)
            .map(|invite| {
                json!({
                    "_id": format!("n{}", invite.id),
                    "user_id": user.id,
                    "key": format!("project-invite-{}", invite.id),
                    "expires": "2026-12-23T10:00:00.000Z",
                    "messageOpts": {
                        "userName": self.owner.first_name,
                        "projectName": self.project_name,
                        "projectId": self.project_id,
                        "token": invite.token,
                    },
                    "templateKey": "notification_project_invite",
                    "html": "notification_project_invite",
                })
            })
            .collect();
        Value::Array(notifications)
    }

    pub(super) fn links_route(
        &mut self,
        method: &str,
        path: &str,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> Option<Reply> {
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        let route = match (method, parts.as_slice()) {
            ("POST", ["read", token, "grant"]) => Some((true, (*token).to_string())),
            ("POST", [token, "grant"]) if *token != "project" => {
                Some((false, (*token).to_string()))
            }
            ("POST", ["project", project, "share"]) => {
                let sent: Value = serde_json::from_slice(body).unwrap_or_default();
                let token = sent["token"].as_str().unwrap_or_default().to_string();
                return Some(self.accept_route(project, &token, headers));
            }
            ("POST", ["project", project, "invite", "token", token, "accept"]) => {
                let (project, token) = ((*project).to_string(), (*token).to_string());
                return Some(self.accept_route(&project, &token, headers));
            }
            _ => None,
        }?;
        let (read_only, token) = route;
        Some(self.grant_route(read_only, &token, headers, body))
    }

    fn caller(&self, headers: &HashMap<String, String>) -> Result<String, Reply> {
        let Some(user) = self.user_for(headers) else {
            return Err(Reply::status(302).header("Location", "/login"));
        };
        if headers.get("x-csrf-token") != Some(&self.csrf) {
            return Err(text_reply(403, "Forbidden"));
        }
        Ok(user)
    }

    fn grant_route(
        &mut self,
        read_only: bool,
        token: &str,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> Reply {
        let user = match self.caller(headers) {
            Ok(user) => user,
            Err(refused) => return refused,
        };
        let known = if read_only {
            self.read_token.as_deref() == Some(token)
        } else {
            self.edit_token.as_deref() == Some(token)
        };
        if !known || self.deleted {
            return not_found();
        }
        let body: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        self.grants.push(body.clone());
        let redirect = format!("/project/{}", self.project_id);
        let granted = if read_only {
            Privilege::ReadOnly
        } else {
            Privilege::ReadAndWrite
        };
        if self
            .privilege(&user)
            .is_some_and(|has| rank(has) >= rank(granted))
        {
            return json_reply(&json!({ "redirect": redirect, "higherAccess": true }));
        }
        if body.get("confirmedByUser").and_then(Value::as_bool) != Some(true) {
            return json_reply(&json!({ "requireAccept": { "projectName": self.project_name } }));
        }
        let Some(person) = self.people().find(|person| person.id == user).cloned() else {
            return not_found();
        };
        self.outsiders.retain(|outsider| outsider.id != user);
        if read_only {
            self.token_viewers.push(person);
            return json_reply(&json!({ "redirect": redirect, "tokenAccessGranted": "readOnly" }));
        }
        self.token_viewers.retain(|viewer| viewer.id != user);
        self.members.push((person, Privilege::ReadAndWrite));
        self.emit_room(
            "project:membership:changed",
            &[json!({ "members": true, "invites": true })],
            None,
        );
        json_reply(&json!({ "redirect": redirect }))
    }

    fn accept_route(
        &mut self,
        project: &str,
        token: &str,
        headers: &HashMap<String, String>,
    ) -> Reply {
        let user = match self.caller(headers) {
            Ok(user) => user,
            Err(refused) => return refused,
        };
        let found = self
            .invites
            .iter()
            .position(|invite| invite.token == token && project == self.project_id);
        let Some(at) = found.filter(|_| !self.deleted) else {
            return not_found();
        };
        let person = self.people().find(|person| person.id == user).cloned();
        self.accept_invite_at(at, person);
        if headers.get("x-requested-with").map(String::as_str) == Some("XMLHttpRequest") {
            return Reply::status(204);
        }
        Reply::status(302).header("Location", &format!("/project/{project}"))
    }
}

impl MockOverleaf {
    pub fn share_by_link(&self) -> (String, String) {
        let mut state = self.state();
        state.read_token = Some(READ_TOKEN.to_string());
        state.edit_token = Some(EDIT_TOKEN.to_string());
        (
            format!("{}/read/{READ_TOKEN}", self.base),
            format!("{}/{EDIT_TOKEN}#{EDIT_HASH}", self.base),
        )
    }

    pub fn grants(&self) -> Vec<Value> {
        self.state().grants.clone()
    }

    pub fn privilege_of(&self, name: &str) -> Option<Privilege> {
        let state = self.state();
        let user = state
            .people()
            .find(|user| user.email.starts_with(&format!("{name}@")))?
            .id
            .clone();
        state.privilege(&user)
    }

    pub fn invite_token(&self, email: &str) -> Option<String> {
        self.state()
            .invites
            .iter()
            .find(|invite| invite.email == email)
            .map(|invite| invite.token.clone())
    }
}
