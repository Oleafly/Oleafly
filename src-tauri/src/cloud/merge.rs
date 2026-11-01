use oleafly_core::content::ContentHash;
use serde_json::{Map, Value};

pub(crate) const PROJECT_META: &str = "project.json";
pub(crate) const DEVICE_META_FIELDS: [&str; 6] = [
    "exports",
    "hidden",
    "tex",
    "checkpoints",
    "forked_from",
    "allow_shell_escape",
];

pub(crate) fn merge3(base: Option<&Value>, local: &Value, remote: &Value) -> Value {
    if local == remote {
        return local.clone();
    }
    match base {
        Some(base) if base == local => return remote.clone(),
        Some(base) if base == remote => return local.clone(),
        _ => {}
    }
    match (local, remote) {
        (Value::Object(local), Value::Object(remote)) => {
            merge_objects(base.and_then(Value::as_object), local, remote)
        }
        (Value::Array(local), Value::Array(remote)) => {
            let base = base.and_then(Value::as_array);
            if let Some(merged) = merge_by_id(base.map(Vec::as_slice), local, remote) {
                return merged;
            }
            let in_base = |item: &Value| base.is_some_and(|base| base.contains(item));
            let mut merged: Vec<Value> = local
                .iter()
                .filter(|item| remote.contains(item) || !in_base(item))
                .cloned()
                .collect();
            for item in remote {
                if !local.contains(item) && !in_base(item) && !merged.contains(item) {
                    merged.push(item.clone());
                }
            }
            Value::Array(merged)
        }
        _ => local.clone(),
    }
}

fn item_id(item: &Value) -> Option<&str> {
    item.get("id").and_then(Value::as_str)
}

fn merge_by_id(base: Option<&[Value]>, local: &[Value], remote: &[Value]) -> Option<Value> {
    let all_have_ids = |items: &[Value]| items.iter().all(|item| item_id(item).is_some());
    if local.is_empty() && remote.is_empty()
        || !all_have_ids(local)
        || !all_have_ids(remote)
        || base.is_some_and(|base| !all_have_ids(base))
    {
        return None;
    }
    let find =
        |items: &'_ [Value], id: &str| items.iter().find(|item| item_id(item) == Some(id)).cloned();
    let before = |id: &str| base.and_then(|base| find(base, id));
    let mut merged = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for item in local {
        let id = item_id(item).unwrap_or_default();
        if !seen.insert(id.to_string()) {
            continue;
        }
        match (find(remote, id), before(id)) {
            (Some(theirs), before) => merged.push(merge3(before.as_ref(), item, &theirs)),
            (None, Some(before)) if before == *item => {}
            (None, _) => merged.push(item.clone()),
        }
    }
    for item in remote {
        let id = item_id(item).unwrap_or_default();
        if !seen.insert(id.to_string()) {
            continue;
        }
        match before(id) {
            Some(before) if before == *item => {}
            _ => merged.push(item.clone()),
        }
    }
    Some(Value::Array(merged))
}

fn merge_objects(
    base: Option<&Map<String, Value>>,
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
) -> Value {
    let unchanged_from_base = |key: &String, value: &Value| {
        base.and_then(|base| base.get(key))
            .is_some_and(|before| before == value)
    };
    let mut merged = Map::new();
    for (key, local_value) in local {
        match remote.get(key) {
            Some(remote_value) => {
                merged.insert(
                    key.clone(),
                    merge3(
                        base.and_then(|base| base.get(key)),
                        local_value,
                        remote_value,
                    ),
                );
            }
            None if unchanged_from_base(key, local_value) => {}
            None => {
                merged.insert(key.clone(), local_value.clone());
            }
        }
    }
    for (key, remote_value) in remote {
        if !local.contains_key(key) && !unchanged_from_base(key, remote_value) {
            merged.insert(key.clone(), remote_value.clone());
        }
    }
    Value::Object(merged)
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical(&map[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn canonical_bytes(value: &Value) -> Vec<u8> {
    fn write(value: &Value, out: &mut Vec<u8>) {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                out.push(b'{');
                for (index, key) in keys.into_iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    out.extend_from_slice(Value::String(key.clone()).to_string().as_bytes());
                    out.push(b':');
                    write(&map[key], out);
                }
                out.push(b'}');
            }
            Value::Array(items) => {
                out.push(b'[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    write(item, out);
                }
                out.push(b']');
            }
            other => out.extend_from_slice(other.to_string().as_bytes()),
        }
    }
    let mut out = Vec::new();
    write(value, &mut out);
    out
}

pub(crate) fn portable_meta(value: &Value) -> Value {
    let mut value = canonical(value);
    if let Value::Object(map) = &mut value {
        for field in DEVICE_META_FIELDS {
            map.remove(field);
        }
    }
    value
}

pub(crate) fn meta_digest(bytes: &[u8]) -> ContentHash {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value @ Value::Object(_)) => {
            ContentHash::digest(&canonical_bytes(&portable_meta(&value)))
        }
        _ => ContentHash::digest(bytes),
    }
}

pub(crate) fn with_device_fields(incoming: &Value, local: Option<&Value>) -> Value {
    let mut merged = portable_meta(incoming);
    if let (Value::Object(target), Some(Value::Object(local))) = (&mut merged, local) {
        for field in DEVICE_META_FIELDS {
            if let Some(value) = local.get(field) {
                target.insert(field.to_string(), value.clone());
            }
        }
    }
    merged
}

pub(crate) fn pretty(value: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{merge3, meta_digest, with_device_fields};
    use serde_json::json;

    #[test]
    fn objects_merge_per_key_and_both_sides_keep_their_own_changes() {
        let base = json!({"theme": "light", "font": 14, "words": ["a", "b"]});
        let local = json!({"theme": "dark", "font": 14, "words": ["a", "b", "c"]});
        let remote = json!({"theme": "light", "font": 16, "words": ["b", "d"], "newer": true});
        let merged = merge3(Some(&base), &local, &remote);
        assert_eq!(merged["theme"], "dark");
        assert_eq!(merged["font"], 16);
        assert_eq!(merged["words"], json!(["b", "c", "d"]));
        assert_eq!(merged["newer"], true);
    }

    #[test]
    fn keys_unknown_locally_survive_and_local_wins_true_conflicts() {
        let base = json!({"a": 1});
        let local = json!({"a": 2});
        let remote = json!({"a": 3, "only_remote": "kept"});
        let merged = merge3(Some(&base), &local, &remote);
        assert_eq!(merged["a"], 2);
        assert_eq!(merged["only_remote"], "kept");
        assert_eq!(
            merge3(None, &json!({"x": 1}), &json!({"x": 1})),
            json!({"x": 1})
        );
    }

    #[test]
    fn a_key_removed_on_one_side_stays_removed_unless_the_other_side_changed_it() {
        assert_eq!(
            merge3(Some(&json!({"k": 1})), &json!({}), &json!({"k": 1, "x": 2})),
            json!({"x": 2})
        );
        assert_eq!(
            merge3(
                Some(&json!({"k": 1, "engine": "pdflatex"})),
                &json!({"k": 1, "engine": "xelatex"}),
                &json!({"engine": "pdflatex"})
            ),
            json!({"engine": "xelatex"})
        );
        assert_eq!(
            merge3(
                Some(&json!({"k": 1, "engine": "pdflatex"})),
                &json!({"k": 2, "engine": "xelatex"}),
                &json!({"engine": "pdflatex"})
            ),
            json!({"k": 2, "engine": "xelatex"})
        );
    }

    #[test]
    fn lists_of_items_with_ids_merge_item_by_item() {
        let persona =
            |id: &str, name: &str, prompt: &str| json!({"id": id, "name": name, "prompt": prompt});
        let base = json!([
            persona("a", "Editor", "Be brief"),
            persona("b", "Critic", "Be harsh")
        ]);
        let local = json!([persona("a", "Copy editor", "Be brief")]);
        let remote = json!([
            persona("a", "Editor", "Be brief and kind"),
            persona("b", "Critic", "Be harsh"),
            persona("c", "Coach", "Encourage")
        ]);
        assert_eq!(
            merge3(Some(&base), &local, &remote),
            json!([
                persona("a", "Copy editor", "Be brief and kind"),
                persona("c", "Coach", "Encourage")
            ])
        );
        let edited = json!([
            persona("a", "Editor", "Be brief"),
            persona("b", "Critic", "Be fair")
        ]);
        let removed = json!([persona("a", "Editor", "Be brief")]);
        assert_eq!(
            merge3(Some(&base), &removed, &edited),
            json!([
                persona("a", "Editor", "Be brief"),
                persona("b", "Critic", "Be fair")
            ])
        );
    }

    #[test]
    fn project_meta_digest_ignores_device_fields_and_key_order() {
        let one = br#"{"name":"Thesis","main_doc":"main.tex","exports":[{"path":"/Users/a/x.pdf"}],"hidden":false}"#;
        let two = br#"{"main_doc":"main.tex","exports":[],"name":"Thesis"}"#;
        assert_eq!(meta_digest(one), meta_digest(two));
        let renamed = br#"{"main_doc":"main.tex","name":"Thesis 2"}"#;
        assert_ne!(meta_digest(one), meta_digest(renamed));
        assert_eq!(
            meta_digest(b"not json"),
            oleafly_core::content::ContentHash::digest(b"not json")
        );
    }

    #[test]
    fn incoming_meta_keeps_this_computers_device_fields() {
        let incoming = json!({"name": "New", "hidden": true, "exports": [{"path": "/other"}]});
        let local = json!({"name": "Old", "exports": [{"path": "/mine"}]});
        let merged = with_device_fields(&incoming, Some(&local));
        assert_eq!(merged["name"], "New");
        assert_eq!(merged["exports"][0]["path"], "/mine");
        assert!(merged.get("hidden").is_none());
    }
}
