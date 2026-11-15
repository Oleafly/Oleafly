use oleafly_ot::testing::{deletion, insertion, Rng};
use oleafly_ot::{utf16_len, Component, TextOperation};
use serde_json::{json, Value};

use super::*;
use crate::test_support::overleaf_rt::recordings;

fn hidden(pos: usize, length: usize) -> Value {
    json!({ "range": { "pos": pos, "length": length }, "tracking": { "type": "delete", "userId": "bob", "ts": "2026-11-15T08:00:00.000Z" } })
}

fn doc(content: &str, deletes: &[(usize, usize)]) -> RawDoc {
    let changes: Vec<Value> = deletes
        .iter()
        .map(|(pos, length)| hidden(*pos, *length))
        .collect();
    RawDoc::from_raw(&json!({ "content": content, "trackedChanges": changes })).unwrap()
}

fn reviewer() -> Value {
    json!({ "type": "insert", "userId": "carol", "ts": "2026-11-15T09:00:00.000Z" })
}

fn applied(doc: &RawDoc, op: &RawOp) -> RawDoc {
    let mut after = doc.clone();
    after.apply(op).unwrap();
    after
}

fn random_text(rng: &mut Rng, max: usize) -> String {
    (0..rng.below(max))
        .map(|_| *rng.pick(&["a", "b", " ", "\n", "é", "x"]))
        .collect()
}

fn random_doc(rng: &mut Rng) -> RawDoc {
    let content = random_text(rng, 24);
    let length = utf16_len(&content);
    let mut deletes = Vec::new();
    let mut at = 0;
    while at < length {
        at += rng.below(5);
        let span = 1 + rng.below(3);
        if at + span <= length && rng.chance(50) {
            deletes.push((at, span));
        }
        at += span + 1;
    }
    doc(&content, &deletes)
}

fn random_visible_op(rng: &mut Rng, text: &str) -> TextOperation {
    let mut op = TextOperation::new();
    let mut rest = text;
    while !rest.is_empty() {
        let take: usize = rest
            .chars()
            .take(1 + rng.below(3))
            .map(char::len_utf8)
            .sum();
        let units = utf16_len(&rest[..take]);
        match rng.below(4) {
            0 | 1 => op.retain(units),
            2 => op.delete(units),
            _ => op.insert(&random_text(rng, 3)).retain(units),
        };
        rest = &rest[take..];
    }
    if rng.chance(30) {
        op.insert(&random_text(rng, 3));
    }
    op
}

fn ce_tracked_delete_snapshot() -> (Value, String) {
    let recording = recordings()
        .into_iter()
        .find(|recording| recording.name == "history-ot-tracked-delete")
        .unwrap();
    let raw: Value = serde_json::from_str(&recording.extra("final.raw.json").unwrap()).unwrap();
    (raw["raw"].clone(), recording.final_text("alice").unwrap())
}

#[test]
fn visible_text_hides_tracked_deletes_and_maps_positions_both_ways() {
    let (raw, visible) = ce_tracked_delete_snapshot();
    let doc = RawDoc::from_raw(&raw).unwrap();
    assert_eq!(doc.visible().unwrap(), visible);
    assert_eq!(doc.content().unwrap(), raw["content"].as_str().unwrap());
    let deleted = doc
        .tracked()
        .into_iter()
        .find(|range| range.tracking["type"] == "delete")
        .unwrap();
    let start = doc.to_visible(deleted.pos);
    assert_eq!(doc.to_raw(start), deleted.pos);
    assert_eq!(doc.to_raw(start + 1), deleted.pos + deleted.length + 1);
    for inside in deleted.pos..=deleted.pos + deleted.length {
        assert_eq!(doc.to_visible(inside), start);
    }
    assert_eq!(doc.to_visible(deleted.pos + deleted.length + 1), start + 1);
    for position in 0..=doc.visible_len() {
        assert_eq!(doc.to_visible(doc.to_raw(position)), position);
    }
    let edge = self::doc("abcXYZ", &[(3, 3)]);
    assert_eq!(edge.visible().unwrap(), "abc");
    assert_eq!(edge.to_raw(3), 3);
    assert_eq!(edge.to_visible(6), 3);
}

#[test]
fn visible_and_raw_round_trip_for_random_ops_with_tracked_deletes() {
    let mut rng = Rng::new(0x08);
    for round in 0..5_000 {
        let doc = random_doc(&mut rng);
        let visible = doc.visible().unwrap();
        let op = random_visible_op(&mut rng, &visible);
        let tracking = rng.chance(50).then(reviewer);
        let raw = doc.encode(&op, tracking.as_ref()).unwrap();
        assert_eq!(raw.base_len(), doc.length(), "round {round}");
        assert_eq!(doc.project(&raw).unwrap(), op, "round {round}: {raw:?}");
        let after = applied(&doc, &raw);
        assert_eq!(
            after.visible().unwrap(),
            op.apply(&visible).unwrap(),
            "round {round}"
        );
        assert_eq!(RawOp::from_json(&raw.to_json().unwrap()).unwrap(), raw);
        if tracking.is_some() {
            let inserted: usize = op
                .components()
                .iter()
                .map(|component| match component {
                    Component::Insert(text) => utf16_len(text),
                    _ => 0,
                })
                .sum();
            assert_eq!(after.length(), doc.length() + inserted, "round {round}");
        }
    }
}

#[test]
fn a_tracked_delete_from_a_coauthor_hides_the_text_here() {
    let content = "Keep this sentence. Remove this word please.\nSecond line.\n";
    let doc = doc(content, &[]);
    let frame = json!([32, { "r": 5, "tracking": { "type": "delete", "userId": "6af963eac9037022065bb532", "ts": "2026-11-15T08:09:51.643Z" } }, 21]);
    let op = RawOp::from_json(&frame).unwrap();
    assert_eq!(doc.project(&op).unwrap(), deletion(58, 32, 5));
    let after = applied(&doc, &op);
    assert_eq!(after.content().unwrap(), content);
    assert_eq!(
        after.visible().unwrap(),
        "Keep this sentence. Remove this please.\nSecond line.\n"
    );
    assert_eq!(after.tracked()[0].pos, 32);
    assert_eq!(after.tracked()[0].length, 5);
}

#[test]
fn rejecting_a_tracked_delete_brings_the_text_back() {
    let doc = doc("Remove this word please.", &[(12, 5)]);
    assert_eq!(doc.visible().unwrap(), "Remove this please.");
    let reject =
        RawOp::from_json(&json!([12, { "r": 5, "tracking": { "type": "none" } }, 7])).unwrap();
    assert_eq!(doc.project(&reject).unwrap(), insertion(19, 12, "word "));
    let after = applied(&doc, &reject);
    assert_eq!(after.visible().unwrap(), "Remove this word please.");
    assert!(after.tracked().is_empty());
}

#[test]
fn an_insert_inside_a_comment_carries_its_comment_id() {
    let raw = json!({
        "content": "One hidden two three",
        "trackedChanges": [hidden(4, 7)],
        "comments": [{ "id": "c1", "ranges": [{ "pos": 11, "length": 3 }] }],
    });
    let doc = RawDoc::from_raw(&raw).unwrap();
    assert_eq!(doc.visible().unwrap(), "One two three");
    let inside = doc.encode(&insertion(13, 5, "X"), None).unwrap();
    assert_eq!(
        inside.to_json().unwrap(),
        json!([12, { "i": "X", "commentIds": ["c1"] }, 8])
    );
    for edge in [4, 7] {
        let op = doc.encode(&insertion(13, edge, "X"), None).unwrap();
        assert!(
            !op.to_json().unwrap().to_string().contains("commentIds"),
            "{edge}"
        );
    }
    let after = applied(&doc, &inside);
    assert_eq!(after.comments()[0].ranges, vec![(11, 4)]);
    let before = applied(&doc, &doc.encode(&insertion(13, 0, ">> "), None).unwrap());
    assert_eq!(before.comments()[0].ranges, vec![(14, 3)]);
    let trimmed = applied(&doc, &doc.encode(&deletion(13, 3, 3), None).unwrap());
    assert_eq!(trimmed.visible().unwrap(), "Oneo three");
    assert_eq!(trimmed.comments()[0].ranges, vec![(3, 1)]);
}

#[test]
fn comment_ops_change_no_text() {
    let edits = edits_from_json(&json!([
        { "commentId": "c2", "ranges": [{ "pos": 0, "length": 3 }] },
        { "commentId": "c2", "resolved": true },
        { "deleteComment": "c1" },
        { "noOp": true },
    ]))
    .unwrap();
    let mut doc = RawDoc::from_raw(&json!({
        "content": "abc def",
        "comments": [{ "id": "c1", "ranges": [{ "pos": 4, "length": 3 }] }],
    }))
    .unwrap();
    for edit in &edits {
        assert!(!matches!(edit, Edit::Text(_)));
        doc.edit_comments(edit);
    }
    assert_eq!(doc.visible().unwrap(), "abc def");
    assert_eq!(
        doc.comments(),
        &[CommentRanges {
            id: "c2".into(),
            ranges: vec![(0, 3)],
            resolved: true
        }]
    );
}

#[test]
fn an_unknown_edit_operation_is_unsupported() {
    for edit in [
        json!([{ "moveFile": "x" }]),
        json!([{ "textOperation": [{ "x": 1 }] }]),
    ] {
        assert!(
            matches!(edits_from_json(&edit), Err(CodecError::Unsupported(_))),
            "{edit}"
        );
    }
    assert!(matches!(
        edits_from_json(&json!({})),
        Err(CodecError::Malformed(_))
    ));
    assert!(matches!(
        edits_from_json(&json!([{ "textOperation": [0] }])),
        Err(CodecError::Malformed(_))
    ));
}

#[test]
fn retain_with_comment_ids_and_content_hash_decode() {
    let edits = edits_from_json(&json!([{
        "textOperation": [3, { "r": 4, "commentIds": ["c1"] }, { "i": "x", "commentIds": ["c1"] }, 2],
        "contentHash": "0123456789abcdef0123456789abcdef01234567",
    }]))
    .unwrap();
    let Edit::Text(op) = &edits[0] else {
        panic!("a text edit")
    };
    let doc = doc("abcdefghi", &[]);
    assert_eq!(doc.project(op).unwrap(), insertion(9, 7, "x"));
    assert_eq!(applied(&doc, op).visible().unwrap(), "abcdefgxhi");
    assert_eq!(
        op.to_json().unwrap(),
        json!([3, { "r": 4, "commentIds": ["c1"] }, { "i": "x", "commentIds": ["c1"] }, 2])
    );
}

#[test]
fn a_plain_delete_across_a_hidden_span_removes_the_raw_range() {
    let doc = doc("abcHIDEdef", &[(3, 4)]);
    assert_eq!(doc.visible().unwrap(), "abcdef");
    let op = doc.encode(&deletion(6, 2, 2), None).unwrap();
    assert_eq!(op.to_json().unwrap(), json!([2, -6, 2]));
    let after = applied(&doc, &op);
    assert_eq!(
        (
            after.content().unwrap().as_str(),
            after.visible().unwrap().as_str()
        ),
        ("abef", "abef")
    );
    assert!(after.tracked().is_empty());
    let before_span = doc.encode(&deletion(6, 3, 1), None).unwrap();
    assert_eq!(before_span.to_json().unwrap(), json!([3, -5, 2]));
}

#[test]
fn a_reviewer_delete_becomes_a_tracked_delete() {
    let doc = doc("Keep this word.", &[]);
    let op = doc.encode(&deletion(15, 10, 5), Some(&reviewer())).unwrap();
    assert_eq!(
        op.to_json().unwrap(),
        json!([10, { "r": 5, "tracking": { "type": "delete", "userId": "carol", "ts": "2026-11-15T09:00:00.000Z" } }])
    );
    let after = applied(&doc, &op);
    assert_eq!(
        (
            after.content().unwrap().as_str(),
            after.visible().unwrap().as_str()
        ),
        ("Keep this word.", "Keep this ")
    );
    let typed = doc
        .encode(&insertion(15, 15, "!"), Some(&reviewer()))
        .unwrap();
    assert_eq!(
        typed.to_json().unwrap(),
        json!([15, { "i": "!", "tracking": reviewer() }])
    );
}

#[test]
fn a_reviewer_delete_across_a_hidden_span_covers_the_raw_range() {
    let doc = doc("abcHIDEdef", &[(3, 4)]);
    let op = doc.encode(&deletion(6, 2, 2), Some(&reviewer())).unwrap();
    let marked = json!({ "type": "delete", "userId": "carol", "ts": "2026-11-15T09:00:00.000Z" });
    assert_eq!(
        op.to_json().unwrap(),
        json!([2, { "r": 6, "tracking": marked }, 2])
    );
    let after = applied(&doc, &op);
    assert_eq!(after.content().unwrap(), "abcHIDEdef");
    assert_eq!(after.visible().unwrap(), "abef");
    assert_eq!(after.tracked().len(), 1);
    assert_eq!((after.tracked()[0].pos, after.tracked()[0].length), (2, 6));
}

fn reviewer_may_send(scan: &Value) -> bool {
    match scan {
        Value::Number(count) => count.as_i64().is_some_and(|count| count > 0),
        Value::Object(object) if object.contains_key("i") => object.contains_key("tracking"),
        Value::Object(object) if object.contains_key("r") => {
            object
                .get("tracking")
                .and_then(|tracking| tracking.get("type"))
                .and_then(Value::as_str)
                != Some("none")
        }
        _ => false,
    }
}

#[test]
fn reviewer_ops_contain_only_allowed_scan_ops() {
    let mut rng = Rng::new(0x5ca7);
    let mut deletes = 0;
    for _ in 0..3_000 {
        let doc = random_doc(&mut rng);
        let visible = doc.visible().unwrap();
        let op = random_visible_op(&mut rng, &visible);
        let raw = doc.encode(&op, Some(&reviewer())).unwrap();
        let wire = raw.to_json().unwrap();
        for scan in wire.as_array().unwrap() {
            assert!(reviewer_may_send(scan), "{scan} in {wire}");
        }
        deletes += op
            .components()
            .iter()
            .filter(|component| matches!(component, Component::Delete(_)))
            .count();
    }
    assert!(deletes > 1_000);
    assert!(!reviewer_may_send(&json!(-3)) && !reviewer_may_send(&json!("plain")));
}

#[test]
fn raw_transform_converges_with_tracking_marks() {
    let mut rng = Rng::new(0x0b);
    for round in 0..5_000 {
        let doc = random_doc(&mut rng);
        let visible = doc.visible().unwrap();
        let mut ops = [None, None];
        for op in &mut ops {
            let edit = random_visible_op(&mut rng, &visible);
            let tracking = rng.chance(50).then(
                || json!({ "type": "insert", "userId": format!("u{}", rng.below(3)), "ts": "t" }),
            );
            *op = Some(doc.encode(&edit, tracking.as_ref()).unwrap());
        }
        let [Some(first), Some(second)] = ops else {
            unreachable!()
        };
        let (first_after, second_after) = RawOp::transform(&first, &second).unwrap();
        let one = applied(&applied(&doc, &first), &second_after);
        let two = applied(&applied(&doc, &second), &first_after);
        assert_eq!(
            one.content().unwrap(),
            two.content().unwrap(),
            "round {round}"
        );
        assert_eq!(one.tracked(), two.tracked(), "round {round}");
        assert_eq!(
            one.visible().unwrap(),
            two.visible().unwrap(),
            "round {round}"
        );
    }
}
