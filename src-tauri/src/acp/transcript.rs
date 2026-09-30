//! Keeps every stored ACP event under the per-event size limit.
//!
//! Agents send whole files as tool output and whole-file diffs (Pi does this
//! for every edit). One such event used to stop the session. The transcript is
//! a record of the conversation, not a backup: the before-turn copy in
//! `agent_turns` holds the real file content, so long strings are cut here.

use serde_json::{json, Map, Value};

/// Largest serialized event that is stored.
pub(super) const MAX_EVENT_BYTES: usize = 256 * 1024;
/// Longest string kept inside a tool call's `content[]`.
const MAX_CONTENT_STRING: usize = 32 * 1024;
/// A diff whose old and new text together stay under this is kept whole, so
/// the transcript can still show it as a real diff.
const MAX_WHOLE_DIFF: usize = 200 * 1024;
/// Fields kept when nothing else of an event fits.
const IDENTIFYING_FIELDS: [&str; 5] = ["sessionUpdate", "toolCallId", "status", "kind", "title"];

/// Returns `data` cut down so that it serializes to at most
/// [`MAX_EVENT_BYTES`]. Strings inside `content[]` are always bounded.
pub(super) fn bound_event(mut data: Value) -> Value {
    if let Some(items) = data.get_mut("content").and_then(Value::as_array_mut) {
        for item in items {
            bound_content_item(item);
        }
    }
    if fits(&data) {
        return data;
    }
    if let Some(object) = data.as_object_mut() {
        if object.get("content").is_some_and(Value::is_array) {
            object.insert("content".into(), json!({"truncated": true}));
            if fits(&data) {
                return data;
            }
        }
    }
    if truncate_strings(&mut data, MAX_CONTENT_STRING) {
        if let Some(object) = data.as_object_mut() {
            object.insert("truncated".into(), Value::Bool(true));
        }
    }
    if fits(&data) {
        return data;
    }
    identifying_fields(&data)
}

fn fits(data: &Value) -> bool {
    serde_json::to_vec(data).is_ok_and(|bytes| bytes.len() <= MAX_EVENT_BYTES)
}

fn bound_content_item(item: &mut Value) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    let mut truncated = false;
    if object.get("type").and_then(Value::as_str) == Some("diff") {
        let old_size = object.get("oldText").and_then(Value::as_str).map(str::len);
        let new_size = object.get("newText").and_then(Value::as_str).map(str::len);
        if old_size.unwrap_or(0) + new_size.unwrap_or(0) > MAX_WHOLE_DIFF {
            for key in ["oldText", "newText"] {
                if let Some(Value::String(text)) = object.get_mut(key) {
                    truncated |= cut(text, MAX_CONTENT_STRING);
                }
            }
            object.insert("oldSize".into(), json!(old_size));
            object.insert("newSize".into(), json!(new_size));
        }
        for (key, value) in object.iter_mut() {
            if key != "oldText" && key != "newText" {
                truncated |= truncate_strings(value, MAX_CONTENT_STRING);
            }
        }
    } else {
        for value in object.values_mut() {
            truncated |= truncate_strings(value, MAX_CONTENT_STRING);
        }
    }
    if truncated {
        object.insert("truncated".into(), Value::Bool(true));
    }
}

/// Cuts every string in `value` to `limit` bytes. Returns whether any was cut.
fn truncate_strings(value: &mut Value, limit: usize) -> bool {
    match value {
        Value::String(text) => cut(text, limit),
        Value::Array(values) => values
            .iter_mut()
            .fold(false, |cut, value| truncate_strings(value, limit) | cut),
        Value::Object(values) => values
            .values_mut()
            .fold(false, |cut, value| truncate_strings(value, limit) | cut),
        _ => false,
    }
}

/// Truncates `text` to at most `limit` bytes on a character boundary.
fn cut(text: &mut String, limit: usize) -> bool {
    if text.len() <= limit {
        return false;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    true
}

fn identifying_fields(data: &Value) -> Value {
    let mut kept = Map::new();
    for key in IDENTIFYING_FIELDS {
        if let Some(Value::String(text)) = data.get(key) {
            let mut text = text.clone();
            cut(&mut text, 1024);
            kept.insert(key.into(), Value::String(text));
        }
    }
    kept.insert("truncated".into(), Value::Bool(true));
    Value::Object(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(value: &Value) -> usize {
        serde_json::to_vec(value).unwrap().len()
    }

    #[test]
    fn small_events_are_stored_unchanged() {
        let event = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t1",
            "content": [
                {"type": "content", "content": {"type": "text", "text": "Read complete."}},
                {"type": "diff", "path": "/p/a.tex", "oldText": "a\n", "newText": "b\n"}
            ]
        });
        assert_eq!(bound_event(event.clone()), event);
    }

    #[test]
    fn long_tool_output_is_cut_to_32_kib_and_marked() {
        let text = "é".repeat(40 * 1024);
        let event = json!({
            "sessionUpdate": "tool_call_update",
            "content": [{"type": "content", "content": {"type": "text", "text": text}}]
        });
        let bounded = bound_event(event);
        let item = &bounded["content"][0];
        assert_eq!(item["truncated"], true);
        let kept = item["content"]["text"].as_str().unwrap();
        assert!(kept.len() <= MAX_CONTENT_STRING);
        assert!(kept.chars().all(|c| c == 'é'));
    }

    #[test]
    fn a_diff_under_200_kib_is_kept_whole() {
        let old = "a".repeat(90 * 1024);
        let new = "b".repeat(90 * 1024);
        let event = json!({
            "sessionUpdate": "tool_call",
            "content": [{"type": "diff", "path": "main.tex", "oldText": old, "newText": new}]
        });
        let bounded = bound_event(event.clone());
        assert_eq!(bounded, event);
    }

    #[test]
    fn a_large_diff_keeps_its_sizes_and_is_marked_truncated() {
        let old = "a".repeat(150 * 1024);
        let new = "b".repeat(151 * 1024);
        let event = json!({
            "sessionUpdate": "tool_call_update",
            "content": [{"type": "diff", "path": "refs.bib", "oldText": old, "newText": new}]
        });
        let bounded = bound_event(event);
        let diff = &bounded["content"][0];
        assert_eq!(diff["truncated"], true);
        assert_eq!(diff["oldSize"], 150 * 1024);
        assert_eq!(diff["newSize"], 151 * 1024);
        assert_eq!(diff["path"], "refs.bib");
        assert_eq!(diff["oldText"].as_str().unwrap().len(), MAX_CONTENT_STRING);
        assert_eq!(diff["newText"].as_str().unwrap().len(), MAX_CONTENT_STRING);
    }

    #[test]
    fn a_new_file_diff_reports_no_old_size() {
        let new = "b".repeat(250 * 1024);
        let event = json!({"content": [{"type": "diff", "path": "new.tex", "oldText": null, "newText": new}]});
        let diff = bound_event(event)["content"][0].clone();
        assert_eq!(diff["oldSize"], Value::Null);
        assert_eq!(diff["newSize"], 250 * 1024);
        assert_eq!(diff["oldText"], Value::Null);
    }

    #[test]
    fn too_many_items_replace_the_content_with_a_marker() {
        let diff = json!({"type": "diff", "path": "a.tex", "oldText": "a".repeat(95 * 1024), "newText": "b".repeat(95 * 1024)});
        let event = json!({"sessionUpdate": "tool_call", "toolCallId": "t", "content": [diff.clone(), diff]});
        let bounded = bound_event(event);
        assert_eq!(bounded["content"], json!({"truncated": true}));
        assert_eq!(bounded["toolCallId"], "t");
        assert!(size(&bounded) <= MAX_EVENT_BYTES);
    }

    #[test]
    fn a_huge_message_chunk_is_cut_rather_than_dropped() {
        let event = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "x".repeat(300 * 1024)}
        });
        let bounded = bound_event(event);
        assert_eq!(bounded["truncated"], true);
        assert_eq!(bounded["content"]["type"], "text");
        assert_eq!(
            bounded["content"]["text"].as_str().unwrap().len(),
            MAX_CONTENT_STRING
        );
    }

    #[test]
    fn an_event_that_cannot_be_cut_keeps_only_its_identity() {
        let entries: Vec<Value> = (0..40_000)
            .map(|index| json!({"content": format!("step {index}"), "status": "pending"}))
            .collect();
        let event = json!({"sessionUpdate": "plan", "entries": entries});
        let bounded = bound_event(event);
        assert_eq!(bounded, json!({"sessionUpdate": "plan", "truncated": true}));
    }

    #[test]
    fn every_bounded_event_fits_the_limit() {
        let events = [
            json!({"content": [{"type": "content", "content": {"type": "text", "text": "x".repeat(1024 * 1024)}}]}),
            json!({"title": "t".repeat(600 * 1024)}),
            json!({"content": (0..20).map(|_| json!({"type": "diff", "path": "p", "oldText": "a".repeat(40 * 1024), "newText": "b".repeat(40 * 1024)})).collect::<Vec<_>>()}),
        ];
        for event in events {
            assert!(size(&bound_event(event)) <= MAX_EVENT_BYTES);
        }
    }
}
