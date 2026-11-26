use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::Duration;

use serde_json::{json, Value};

use super::{
    content_hash, json_reply, now_ms, restricted, sharejs_text, text_reply, Blob, Doc, Reply,
    State, WithStatus,
};
use crate::realtime::events::iso_time;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Saved {
    Text(String),
    Bytes(Vec<u8>),
}

pub(super) type Snapshot = BTreeMap<String, Saved>;

pub(super) struct Deferred {
    pub(super) after: Duration,
    pub(super) work: Box<dyn FnOnce(&mut State) + Send>,
}

#[derive(Clone, Debug)]
pub(super) struct Label {
    id: String,
    comment: String,
    version: u64,
    user_id: String,
    created_at: u128,
}

const ROOT_DOC_EXTENSIONS: [&str; 4] = [".tex", ".rtex", ".ltx", ".rnw"];

fn version_in(query: &HashMap<String, String>, key: &str) -> Option<u64> {
    query.get(key).and_then(|value| value.parse().ok())
}

fn decoded(text: &str) -> String {
    url::form_urlencoded::parse(format!("x={text}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

fn split_path(path: &str) -> (Vec<&str>, &str) {
    let mut parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let name = parts.pop().unwrap_or_default();
    (parts, name)
}

fn restored_name(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => {
            format!("{stem} (Restored on 23rd Nov 26 9:00:00).{extension}")
        }
        _ => format!("{name} (Restored on 23rd Nov 26 9:00:00)"),
    }
}

pub(super) fn may_root(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ROOT_DOC_EXTENSIONS
        .iter()
        .any(|extension| lower.ends_with(extension))
}

impl State {
    pub(super) fn snapshot(&self) -> Snapshot {
        self.paths()
            .into_iter()
            .filter_map(|(path, kind, id)| match kind {
                "doc" => Some((
                    path,
                    Saved::Text(sharejs_text::text(&self.docs[&id].visible())),
                )),
                "file" => Some((path, Saved::Bytes(self.files[&id].bytes.clone()))),
                _ => None,
            })
            .collect()
    }

    pub(super) fn record_history(&mut self, user_id: &str, name: &str) {
        let version = self.history.len() as u64;
        let user = self.user(user_id).cloned();
        let ts = now_ms().max(self.last_history_ms + 1);
        self.last_history_ms = ts;
        self.history.push(json!({
            "fromV": version,
            "toV": version + 1,
            "meta": {
                "users": user.map(|user| vec![json!({ "id": user.id, "first_name": user.first_name, "last_name": user.last_name, "email": user.email })]).unwrap_or_default(),
                "start_ts": ts,
                "end_ts": ts,
            },
            "pathnames": [name],
            "project_ops": [],
        }));
        let snapshot = self.snapshot();
        self.snapshots.push(snapshot);
    }

    fn saved_at(&self, version: u64) -> Option<&Snapshot> {
        self.snapshots.get(usize::try_from(version).ok()?)
    }

    fn label_json(label: &Label) -> Value {
        json!({
            "id": label.id,
            "comment": label.comment,
            "version": label.version,
            "user_id": label.user_id,
            "created_at": iso_time(label.created_at as i64),
        })
    }

    fn listed_label(&self, label: &Label) -> Value {
        let mut value = State::label_json(label);
        if let Some(user) = self.user(&label.user_id) {
            value["user_display_name"] = json!(user.display_name());
        }
        value
    }

    pub(super) fn history_route(
        &mut self,
        method: &str,
        parts: &[&str],
        query: &HashMap<String, String>,
        user: &str,
        body: &[u8],
    ) -> Option<Reply> {
        let json_body = || serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
        let reading = matches!(
            (method, parts),
            (
                "GET",
                ["updates"] | ["diff"] | ["filetree", "diff"] | ["labels"] | ["version", _, "zip"]
            )
        );
        if reading && self.restricted(user) {
            return Some(restricted());
        }
        if reading && self.config.history_status != 200 {
            return Some(Reply::status(self.config.history_status));
        }
        Some(match (method, parts) {
            ("GET", ["updates"]) => self.updates(query),
            ("GET", ["diff"]) => self.diff(query),
            ("GET", ["filetree", "diff"]) => self.filetree_diff(query),
            ("GET", ["labels"]) => json_reply(&Value::Array(
                self.labels
                    .iter()
                    .map(|label| self.listed_label(label))
                    .collect(),
            )),
            ("POST", ["labels"]) => self.add_label(&json_body(), user),
            ("DELETE", ["labels", label]) => self.delete_label(label, user),
            ("POST", ["revert_file"]) => self.revert_file(&json_body(), user),
            ("POST", ["restore_file"]) => self.restore_file(&json_body(), user),
            ("POST", ["revert-project"]) => self.revert_project(&json_body(), user),
            ("GET", ["version", version, "zip"]) => self.version_zip(version),
            _ => return None,
        })
    }

    pub(super) fn is_label_route(route: &str) -> bool {
        route == "labels" || route.starts_with("labels/")
    }

    fn updates(&self, query: &HashMap<String, String>) -> Reply {
        let wanted = query
            .get("min_count")
            .and_then(|count| count.parse::<usize>().ok())
            .unwrap_or(25)
            .max(1);
        let before = version_in(query, "before");
        let older: Vec<&Value> = self
            .history
            .iter()
            .rev()
            .filter(|entry| {
                before.is_none_or(|before| entry["toV"].as_u64().unwrap_or_default() <= before)
            })
            .collect();
        let page: Vec<Value> = older
            .iter()
            .take(wanted)
            .map(|entry| {
                let mut entry = (*entry).clone();
                let to = entry["toV"].as_u64().unwrap_or_default();
                entry["labels"] = Value::Array(
                    self.labels
                        .iter()
                        .filter(|label| label.version == to)
                        .map(State::label_json)
                        .collect(),
                );
                entry
            })
            .collect();
        let mut reply = json!({ "updates": page });
        if older.len() > wanted {
            if let Some(last) = page.last() {
                reply["nextBeforeTimestamp"] = last["fromV"].clone();
            }
        }
        json_reply(&reply)
    }

    fn diff(&self, query: &HashMap<String, String>) -> Reply {
        let (Some(from), Some(to), Some(path)) = (
            version_in(query, "from"),
            version_in(query, "to"),
            query.get("pathname").map(|path| decoded(path)),
        ) else {
            return text_reply(500, "missing from, to or pathname");
        };
        let saved = |version| self.saved_at(version).and_then(|saved| saved.get(&path));
        match (saved(from), saved(to)) {
            (_, Some(Saved::Bytes(_))) => json_reply(&json!({ "diff": { "binary": true } })),
            (Some(Saved::Text(old)), Some(Saved::Text(new))) if from == to || old == new => {
                json_reply(&json!({ "diff": [{ "u": new }] }))
            }
            (Some(Saved::Text(old)), Some(Saved::Text(new))) => {
                json_reply(&json!({ "diff": [{ "d": old }, { "i": new }] }))
            }
            (None, Some(Saved::Text(new))) => json_reply(&json!({ "diff": [{ "i": new }] })),
            _ => text_reply(500, "Internal Server Error"),
        }
    }

    fn filetree_diff(&self, query: &HashMap<String, String>) -> Reply {
        let last = self.snapshots.len().saturating_sub(1) as u64;
        let from = version_in(query, "from").unwrap_or(0).min(last);
        let to = version_in(query, "to").unwrap_or(last).min(last);
        let empty = Snapshot::new();
        let before = self.saved_at(from).unwrap_or(&empty);
        let after = self.saved_at(to).unwrap_or(&empty);
        let paths: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
        let last_with = |path: &String| {
            (from..=to).rev().find(|version| {
                self.saved_at(*version)
                    .is_some_and(|saved| saved.contains_key(path))
            })
        };
        let diff: Vec<Value> = paths
            .into_iter()
            .map(|path| match (before.get(path), after.get(path)) {
                (None, Some(saved)) => json!({
                    "pathname": path,
                    "operation": "added",
                    "editable": matches!(saved, Saved::Text(_)),
                }),
                (Some(saved), None) => json!({
                    "pathname": path,
                    "operation": "removed",
                    "deletedAtV": last_with(path),
                    "editable": matches!(saved, Saved::Text(_)),
                }),
                (Some(old), Some(new)) if old != new => {
                    json!({ "pathname": path, "operation": "edited" })
                }
                (_, saved) => {
                    json!({ "pathname": path, "editable": matches!(saved, Some(Saved::Text(_))) })
                }
            })
            .collect();
        json_reply(&json!({ "diff": diff }))
    }

    fn add_label(&mut self, body: &Value, user: &str) -> Reply {
        if !self
            .privilege(user)
            .is_some_and(|privilege| privilege.can_review())
        {
            return restricted();
        }
        let (Some(comment), Some(version)) = (body["comment"].as_str(), body["version"].as_u64())
        else {
            return text_reply(400, "comment and version are required");
        };
        let label = Label {
            id: self.new_id(),
            comment: comment.to_string(),
            version,
            user_id: user.to_string(),
            created_at: now_ms(),
        };
        let reply = self.listed_label(&label);
        self.labels.push(label);
        json_reply(&reply)
    }

    fn delete_label(&mut self, id: &str, user: &str) -> Reply {
        if !self
            .privilege(user)
            .is_some_and(|privilege| privilege.can_review())
        {
            return restricted();
        }
        let owner = self.owner.id == user;
        self.labels
            .retain(|label| !(label.id == id && (owner || label.user_id == user)));
        Reply::status(204)
    }

    fn origin(kind: &str, path: Option<&str>, version: u64) -> Value {
        let mut origin =
            json!({ "kind": kind, "version": version, "timestamp": iso_time(now_ms() as i64) });
        if let Some(path) = path {
            origin["path"] = json!(path);
        }
        origin
    }

    fn put_back(
        &mut self,
        path: &str,
        name: &str,
        saved: Saved,
        id: String,
        origin: Value,
        user: &str,
    ) -> Option<&'static str> {
        let (parts, _) = split_path(path);
        let folder = if parts.is_empty() {
            self.root.id.clone()
        } else {
            self.folder_for_path(&format!("{}/x", parts.join("/"))).0
        };
        let target = self.root.find_mut(&folder)?;
        let kind = match saved {
            Saved::Text(text) => {
                target.docs.push(id.clone());
                self.docs
                    .insert(id.clone(), Doc::new(name, &text, self.format));
                self.emit_room(
                    "reciveNewDoc",
                    &[
                        json!(folder),
                        json!({ "_id": id, "name": name }),
                        origin,
                        json!(user),
                    ],
                    None,
                );
                "doc"
            }
            Saved::Bytes(bytes) => {
                target.files.push(id.clone());
                let hash = content_hash(&bytes);
                self.files.insert(
                    id.clone(),
                    Blob {
                        name: name.to_string(),
                        bytes,
                        hash: hash.clone(),
                    },
                );
                let file = json!({ "_id": id, "name": name, "rev": 0, "linkedFileData": {}, "created": "2026-11-23T00:00:00.000Z", "hash": hash });
                self.emit_room(
                    "reciveNewFile",
                    &[json!(folder), file, origin, json!({}), json!(user)],
                    None,
                );
                "file"
            }
        };
        self.record_history(user, name);
        Some(kind)
    }

    fn revert_one(
        &mut self,
        version: u64,
        path: &str,
        origin: &Value,
        user: &str,
        gap: Duration,
    ) -> Result<Value, Reply> {
        let Some(saved) = self
            .saved_at(version)
            .and_then(|saved| saved.get(path))
            .cloned()
        else {
            return Err(text_reply(500, "file not found in snapshot"));
        };
        let name = split_path(path).1.to_string();
        let current = self.id_for_path(path);
        let was_root = current.is_some() && current == self.root_doc;
        let id = self.new_id();
        let kind = if matches!(saved, Saved::Text(_)) {
            "doc"
        } else {
            "file"
        };
        let reply = json!({ "id": id, "type": kind, "path": path });
        let removal = origin.clone();
        self.deferred.push(Deferred {
            after: Duration::ZERO,
            work: Box::new(move |state: &mut State| {
                if let Some(current) = current {
                    state.remove_entity(&current, removal);
                }
            }),
        });
        let (path, origin, user) = (path.to_string(), origin.clone(), user.to_string());
        self.deferred.push(Deferred {
            after: gap,
            work: Box::new(move |state: &mut State| {
                if kind == "doc" {
                    state.emit_room("new-comment-threads", &[json!({})], None);
                }
                if state
                    .put_back(&path, &name, saved, id.clone(), origin, &user)
                    .is_some()
                    && was_root
                {
                    state.root_doc = Some(id.clone());
                    state.emit_room("rootDocUpdated", &[json!(id)], None);
                }
            }),
        });
        Ok(reply)
    }

    fn restore_request(body: &Value) -> Option<(u64, String)> {
        Some((
            body["version"].as_u64()?,
            body["pathname"]
                .as_str()?
                .trim_start_matches('/')
                .to_string(),
        ))
    }

    fn revert_file(&mut self, body: &Value, user: &str) -> Reply {
        if !self.config.ranges_support {
            return text_reply(500, "project does not have ranges support");
        }
        let Some((version, path)) = State::restore_request(body) else {
            return text_reply(400, "version and pathname are required");
        };
        let origin = State::origin("file-restore", Some(&path), version);
        let gap = self.config.restore_gap;
        match self.revert_one(version, &path, &origin, user, gap) {
            Ok(reply) => json_reply(&json!({ "type": reply["type"], "id": reply["id"] })),
            Err(refused) => refused,
        }
    }

    fn restore_file(&mut self, body: &Value, user: &str) -> Reply {
        let Some((version, path)) = State::restore_request(body) else {
            return text_reply(400, "version and pathname are required");
        };
        let Some(saved) = self
            .saved_at(version)
            .and_then(|saved| saved.get(&path))
            .cloned()
        else {
            return text_reply(500, "file not found in snapshot");
        };
        let name = split_path(&path).1;
        let name = if self.id_for_path(&path).is_some() {
            restored_name(name)
        } else {
            name.to_string()
        };
        let id = self.new_id();
        let shown = match split_path(&path).0.as_slice() {
            [] => name.clone(),
            parts => format!("{}/{name}", parts.join("/")),
        };
        match self.put_back(&shown, &name, saved, id.clone(), json!("upload"), user) {
            Some(kind) => json_reply(&json!({ "id": id, "type": kind })),
            None => Reply::status(404),
        }
    }

    fn revert_project(&mut self, body: &Value, user: &str) -> Reply {
        if !self.config.ranges_support {
            return text_reply(500, "project does not have ranges support");
        }
        let Some(version) = body["version"].as_u64() else {
            return text_reply(400, "version is required");
        };
        let Some(then) = self.saved_at(version).cloned() else {
            return Reply::status(404);
        };
        let origin = State::origin("project-restore", None, version);
        let gap = self.config.restore_gap;
        let mut reverted = Vec::new();
        for path in then.keys() {
            match self.revert_one(version, path, &origin, user, gap) {
                Ok(reply) => reverted.push(reply),
                Err(refused) => return refused,
            }
        }
        let gone: Vec<String> = self
            .paths()
            .into_iter()
            .filter(|(path, kind, _)| *kind != "folder" && !then.contains_key(path))
            .map(|(_, _, id)| id)
            .collect();
        self.deferred.push(Deferred {
            after: Duration::ZERO,
            work: Box::new(move |state: &mut State| {
                for id in gone {
                    state.remove_entity(&id, origin.clone());
                }
            }),
        });
        json_reply(&Value::Array(reverted))
    }

    fn version_zip(&self, version: &str) -> Reply {
        if self.config.zip_status != 200 {
            return Reply::status(self.config.zip_status);
        }
        let Some(saved) = version.parse::<u64>().ok().and_then(|v| self.saved_at(v)) else {
            return Reply::status(404);
        };
        let entries: Vec<(String, Vec<u8>)> = saved
            .iter()
            .map(|(path, saved)| {
                let bytes = match saved {
                    Saved::Text(text) => text.clone().into_bytes(),
                    Saved::Bytes(bytes) => bytes.clone(),
                };
                (path.clone(), bytes)
            })
            .collect();
        Reply::ok(crate::test_support::zip_bytes(&entries))
            .header("Content-Type", "application/zip")
            .with_status(200)
    }
}
