use serde_json::{json, Value};

use super::{
    content_hash, json_reply, text_reply, Blob, Folder, MockOverleaf, Reply, State, WithStatus,
};

const BODY_KEYS: [&str; 2] = ["clientId", "shouldReindexReferences"];

#[derive(Clone, Debug)]
pub(super) struct Linked {
    pub(super) data: Value,
    pub(super) source: Vec<u8>,
}

fn holder_of(folder: &Folder, file: &str) -> Option<String> {
    if folder.files.iter().any(|id| id == file) {
        return Some(folder.id.clone());
    }
    folder
        .folders
        .iter()
        .find_map(|child| holder_of(child, file))
}

fn imported(data: &Value, at: u64) -> Value {
    let mut data = data.clone();
    data["importedAt"] = json!(format!("2026-11-23T00:00:{:02}.000Z", at % 60));
    data
}

impl State {
    pub(super) fn linked_data(&self, file: &str) -> Value {
        self.linked
            .get(file)
            .map_or(Value::Null, |linked| linked.data.clone())
    }

    pub(super) fn linked_route(
        &mut self,
        method: &str,
        parts: &[&str],
        user: &str,
        body: &[u8],
    ) -> Option<Reply> {
        match (method, parts) {
            ("POST", ["linked_file", file, "refresh"]) => {
                Some(self.refresh_linked(file, user, body))
            }
            _ => None,
        }
    }

    fn refresh_linked(&mut self, file: &str, user: &str, body: &[u8]) -> Reply {
        let Ok(Value::Object(request)) = serde_json::from_slice::<Value>(body) else {
            return text_reply(400, "Bad Request");
        };
        if let Some(extra) = request
            .keys()
            .find(|key| !BODY_KEYS.contains(&key.as_str()))
        {
            return text_reply(400, &format!("Unrecognized key: \"{extra}\" at \"body\""));
        }
        let (Some(old), Some(folder)) =
            (self.files.get(file).cloned(), holder_of(&self.root, file))
        else {
            return Reply::ok("<!DOCTYPE html><html><body>Not found</body></html>")
                .with_status(404);
        };
        let Some(linked) = self.linked.remove(file) else {
            return text_reply(409, "Conflict");
        };
        self.remove_entity(file, json!("upload"));
        let id = self.new_id();
        let hash = content_hash(&linked.source);
        let data = imported(&linked.data, self.next_id);
        if let Some(target) = self.root.find_mut(&folder) {
            target.files.push(id.clone());
        }
        self.files.insert(
            id.clone(),
            Blob {
                name: old.name.clone(),
                bytes: linked.source.clone(),
                hash: hash.clone(),
            },
        );
        self.linked.insert(
            id.clone(),
            Linked {
                data: data.clone(),
                source: linked.source,
            },
        );
        let entry = json!({ "_id": id, "name": old.name, "linkedFileData": data, "created": "2026-11-23T00:00:00.000Z", "hash": hash, "rev": 0 });
        self.emit_room(
            "reciveNewFile",
            &[json!(folder), entry, json!("upload"), data, json!(user)],
            None,
        );
        if request
            .get("shouldReindexReferences")
            .and_then(Value::as_bool)
            == Some(true)
        {
            self.emit_room(
                "references:keys:updated",
                &[json!([]), json!(true), Value::Null],
                None,
            );
        }
        json_reply(&json!({ "new_file_id": id }))
    }
}

impl MockOverleaf {
    pub fn add_linked_file(&self, name: &str, data: Value, source: &[u8]) -> String {
        let mut state = self.state();
        let id = state.new_id();
        let folder = state.root.id.clone();
        let hash = content_hash(source);
        state.root.files.push(id.clone());
        state.files.insert(
            id.clone(),
            Blob {
                name: name.to_string(),
                bytes: source.to_vec(),
                hash: hash.clone(),
            },
        );
        state.linked.insert(
            id.clone(),
            Linked {
                data: data.clone(),
                source: source.to_vec(),
            },
        );
        let owner = state.owner.id.clone();
        let entry = json!({ "_id": id, "name": name, "linkedFileData": data, "created": "2026-11-23T00:00:00.000Z", "hash": hash, "rev": 0 });
        state.emit_room(
            "reciveNewFile",
            &[json!(folder), entry, json!("upload"), data, json!(owner)],
            None,
        );
        id
    }

    pub fn link_file(&self, path: &str, data: Value, source: &[u8]) {
        let mut state = self.state();
        let id = state
            .id_for_path(path)
            .filter(|id| state.files.contains_key(id))
            .unwrap_or_else(|| panic!("the mock has no file {path}"));
        state.linked.insert(
            id,
            Linked {
                data,
                source: source.to_vec(),
            },
        );
    }

    pub fn change_link_source(&self, path: &str, source: &[u8]) {
        let mut state = self.state();
        let Some(id) = state.id_for_path(path) else {
            return;
        };
        if let Some(linked) = state.linked.get_mut(&id) {
            linked.source = source.to_vec();
        }
    }

    pub fn linked_data(&self, path: &str) -> Value {
        let state = self.state();
        state
            .id_for_path(path)
            .map_or(Value::Null, |id| state.linked_data(&id))
    }
}
