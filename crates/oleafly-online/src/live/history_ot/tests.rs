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
fn a_tracked_change_whose_end_overflows_is_malformed() {
    for (pos, length) in [(1, u64::MAX), (u64::MAX, 1), (u64::MAX, u64::MAX), (2, 2)] {
        let snapshot = json!({
            "content": "abc",
            "trackedChanges": [{ "range": { "pos": pos, "length": length }, "tracking": reviewer() }],
        });
        assert!(
            matches!(RawDoc::from_raw(&snapshot), Err(CodecError::Malformed(_))),
            "{snapshot}"
        );
    }
}

#[test]
fn server_lengths_that_cannot_fit_a_document_are_malformed() {
    let huge = u64::MAX / 2;
    for op in [
        json!([huge, huge, huge]),
        json!([{ "r": huge }, { "r": huge }, 1]),
        json!([i64::MIN]),
        json!([-1, i64::MIN]),
        json!([{ "r": u64::MAX }]),
    ] {
        assert!(
            matches!(RawOp::from_json(&op), Err(CodecError::Malformed(_))),
            "{op}"
        );
    }
    let ranges =
        json!([{ "commentId": "c1", "ranges": [{ "pos": u64::MAX, "length": u64::MAX }] }]);
    assert!(matches!(
        edits_from_json(&ranges),
        Err(CodecError::Malformed(_))
    ));
    let mut doc = doc("abc", &[]);
    let wide = CommentRanges {
        id: "c1".into(),
        ranges: vec![(usize::MAX - 1, usize::MAX)],
        resolved: false,
    };
    doc.edit_comments(&Edit::AddComment(wide));
    let mut grow = RawOp::default();
    grow.retain(3, None, None);
    grow.insert("de".encode_utf16().collect(), None, None);
    doc.apply(&grow).unwrap();
    assert_eq!(doc.content().unwrap(), "abcde");
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

fn marked(kind: &str, user: &str, ts: &str) -> Value {
    json!({ "type": kind, "userId": user, "ts": ts })
}

fn tracked_doc(content: &str, changes: &[(usize, usize, Value)], comments: Value) -> RawDoc {
    let changes: Vec<Value> = changes
        .iter()
        .map(|(pos, length, tracking)| json!({ "range": { "pos": pos, "length": length }, "tracking": tracking }))
        .collect();
    RawDoc::from_raw(
        &json!({ "content": content, "trackedChanges": changes, "comments": comments }),
    )
    .unwrap()
}

fn raw_op(wire: Value) -> RawOp {
    RawOp::from_json(&wire).unwrap()
}

#[test]
fn raw_positions_after_hidden_text_map_to_the_start_of_what_follows() {
    let doc = doc("abXYcd", &[(2, 2)]);
    assert_eq!((doc.to_raw(2), doc.to_raw_after(2)), (2, 4));
    assert_eq!((doc.to_raw(0), doc.to_raw_after(0)), (0, 0));
    assert_eq!(doc.to_raw_after(4), 6);
    assert_eq!(
        (doc.to_visible(3), doc.to_visible(4), doc.to_visible(5)),
        (2, 2, 3)
    );
    let trailing = self::doc("abXY", &[(2, 2)]);
    assert_eq!((trailing.to_raw(2), trailing.to_raw_after(2)), (2, 4));
}

#[test]
fn the_review_shows_changes_and_comments_where_the_editor_sees_them() {
    let doc = tracked_doc(
        "One old new two",
        &[
            (4, 4, marked("delete", "bob", "2025-11-15T09:46:40.123Z")),
            (8, 4, marked("insert", "carol", "2025-11-15T09:46:41.000Z")),
        ],
        json!([
            { "id": "c1", "ranges": [{ "pos": 0, "length": 13 }] },
            { "id": "c2", "ranges": [{ "pos": 4, "length": 4 }], "resolved": true },
            { "id": "c3", "ranges": [{ "pos": 12, "length": 3 }, { "pos": 0, "length": 3 }] },
        ]),
    );
    assert_eq!(doc.visible().unwrap(), "One new two");
    let review = doc.review();
    type Shown<'a> = (
        ChangeKind,
        usize,
        usize,
        &'a str,
        Option<&'a str>,
        Option<i64>,
    );
    let changes: Vec<Shown> = review
        .changes
        .iter()
        .map(|change| {
            (
                change.kind,
                change.from,
                change.to,
                change.text.as_str(),
                change.user.as_deref(),
                change.ts,
            )
        })
        .collect();
    assert_eq!(
        changes,
        vec![
            (
                ChangeKind::Delete,
                4,
                4,
                "old ",
                Some("bob"),
                Some(1_763_200_000_123)
            ),
            (
                ChangeKind::Insert,
                4,
                8,
                "new ",
                Some("carol"),
                Some(1_763_200_001_000)
            ),
        ]
    );
    assert_ne!(review.changes[0].id, review.changes[1].id);
    type Anchored<'a> = (&'a str, Vec<(usize, usize)>, bool);
    let comments: Vec<Anchored> = review
        .comments
        .iter()
        .map(|comment| {
            (
                comment.id.as_str(),
                comment.ranges.clone(),
                comment.resolved,
            )
        })
        .collect();
    assert_eq!(
        comments,
        vec![
            ("c1", vec![(0, 9)], false),
            ("c2", vec![], true),
            ("c3", vec![(0, 3), (8, 11)], false),
        ]
    );
    assert_eq!(doc.counts(), (3, 2));
}

#[test]
fn change_ids_stay_put_across_unrelated_edits_and_a_rejoin() {
    let doc = tracked_doc(
        "aaaa bbbb cccc",
        &[
            (0, 4, marked("insert", "carol", "2025-11-15T09:46:41.000Z")),
            (10, 4, marked("delete", "bob", "2025-11-15T09:46:42.000Z")),
        ],
        json!([]),
    );
    let ids = |doc: &RawDoc| -> Vec<String> {
        doc.review()
            .changes
            .into_iter()
            .map(|change| change.id)
            .collect()
    };
    let before = ids(&doc);
    let moved = applied(&doc, &raw_op(json!([5, "zz", 9])));
    assert_eq!(ids(&moved), before);
    let rejoined = RawDoc::from_raw(&moved.to_json().unwrap()).unwrap();
    assert_eq!(ids(&rejoined), before);
    let split = applied(&doc, &raw_op(json!([2, "q", 12])));
    let after = ids(&split);
    assert_eq!(after.len(), 3);
    assert_eq!((&after[0], &after[2]), (&before[0], &before[1]));
    assert!(!before.contains(&after[1]));
    assert!(after.iter().all(|id| crate::realtime::events::plain_id(id)));
}

#[test]
fn neighbouring_changes_by_one_author_merge_and_keep_the_earliest_time() {
    let doc = tracked_doc("abcdef", &[], json!([]));
    let first = raw_op(
        json!([2, { "r": 1, "tracking": marked("delete", "bob", "2025-11-15T09:46:42.000Z") }, 3]),
    );
    let second = raw_op(
        json!([3, { "r": 1, "tracking": marked("delete", "bob", "2025-11-15T09:46:41.000Z") }, 2]),
    );
    let other = raw_op(
        json!([4, { "r": 1, "tracking": marked("delete", "carol", "2025-11-15T09:46:40.000Z") }, 1]),
    );
    let after = applied(&applied(&applied(&doc, &first), &second), &other);
    let tracked = after.tracked();
    assert_eq!(tracked.len(), 2);
    assert_eq!((tracked[0].pos, tracked[0].length), (2, 2));
    assert_eq!(tracked[0].tracking["ts"], json!("2025-11-15T09:46:41.000Z"));
    assert_eq!(tracked[1].tracking["userId"], json!("carol"));
}

#[test]
fn accepting_or_rejecting_builds_one_raw_operation_over_the_snapshot() {
    let doc = tracked_doc(
        "keep old new end",
        &[
            (5, 4, marked("delete", "bob", "2025-11-15T09:46:40.000Z")),
            (9, 4, marked("insert", "carol", "2025-11-15T09:46:41.000Z")),
        ],
        json!([]),
    );
    assert_eq!(doc.visible().unwrap(), "keep new end");
    let ids: Vec<String> = doc
        .review()
        .changes
        .iter()
        .map(|change| change.id.clone())
        .collect();
    let cases = [
        (
            Decision::Accept,
            json!([5, -4, { "r": 4, "tracking": { "type": "none" } }, 3]),
            "keep new end",
            TextOperation::new(),
        ),
        (
            Decision::Reject,
            json!([5, "old ", -8, 3]),
            "keep old end",
            {
                let mut op = TextOperation::new();
                op.retain(5).insert("old ").delete(4).retain(3);
                op
            },
        ),
    ];
    for (decision, wire, visible, projected) in cases {
        let op = doc.decision_op(&ids, decision).unwrap();
        assert_eq!(op.to_json().unwrap(), wire, "{decision:?}");
        let after = applied(&doc, &op);
        assert_eq!(after.visible().unwrap(), visible, "{decision:?}");
        assert!(after.tracked().is_empty(), "{decision:?}");
        let shown = doc.project(&op).unwrap();
        if projected.base_len() == 0 {
            assert!(shown.is_noop(), "{decision:?}");
        } else {
            assert_eq!(shown, projected, "{decision:?}");
        }
    }
    let only_insert = doc.decision_op(&ids[1..], Decision::Reject).unwrap();
    assert_eq!(only_insert.to_json().unwrap(), json!([9, -4, 3]));
    assert_eq!(doc.decision_op(&["missing".into()], Decision::Accept), None);
}

#[test]
fn comments_split_grow_and_rejoin_like_the_editor_core() {
    let doc = tracked_doc(
        "abcdefgh",
        &[],
        json!([{ "id": "c1", "ranges": [{ "pos": 2, "length": 4 }] }]),
    );
    let ranges = |doc: &RawDoc| doc.comment("c1").unwrap().ranges.clone();
    let split = applied(&doc, &raw_op(json!([4, "XY", 4])));
    assert_eq!(ranges(&split), vec![(2, 2), (6, 2)]);
    let rejoined = applied(&split, &raw_op(json!([4, -2, 4])));
    assert_eq!(ranges(&rejoined), vec![(2, 4)]);
    let grown = applied(
        &doc,
        &raw_op(json!([4, { "i": "XY", "commentIds": ["c1"] }, 4])),
    );
    assert_eq!(ranges(&grown), vec![(2, 6)]);
    let at_end = applied(
        &doc,
        &raw_op(json!([6, { "i": "Z", "commentIds": ["c1"] }, 2])),
    );
    assert_eq!(ranges(&at_end), vec![(2, 5)]);
    let elsewhere = applied(
        &doc,
        &raw_op(json!([7, { "i": "Z", "commentIds": ["c1"] }, 1])),
    );
    assert_eq!(ranges(&elsewhere), vec![(2, 4), (7, 1)]);
    let at_start = applied(&doc, &raw_op(json!([2, "W", 6])));
    assert_eq!(ranges(&at_start), vec![(3, 4)]);
    let gone = applied(&doc, &raw_op(json!([1, -6, 1])));
    assert_eq!(ranges(&gone), vec![]);
    assert_eq!(gone.comments().len(), 1);
    let comment = doc.comment("c1").unwrap();
    assert_eq!(
        comment.moved(&raw_op(json!([4, "XY", 4]))).ranges,
        vec![(2, 2), (6, 2)]
    );
}

#[test]
fn comment_edits_round_trip_and_anchor_past_hidden_text() {
    let doc = doc("abXYcdef", &[(2, 2)]);
    assert_eq!(doc.visible().unwrap(), "abcdef");
    let added = doc.add_comment("c1", 2, 4, false).unwrap();
    assert_eq!(
        added.to_json().unwrap(),
        json!({ "commentId": "c1", "ranges": [{ "pos": 4, "length": 2 }] })
    );
    let spanning = doc.add_comment("c1", 1, 3, true).unwrap();
    assert_eq!(
        spanning.to_json().unwrap(),
        json!({ "commentId": "c1", "ranges": [{ "pos": 1, "length": 4 }], "resolved": true })
    );
    assert_eq!(doc.add_comment("c1", 3, 3, false), None);
    assert_eq!(doc.add_comment("c1", 3, 9, false), None);
    let edits = vec![
        added.clone(),
        Edit::SetCommentState {
            id: "c1".into(),
            resolved: true,
        },
        Edit::DeleteComment("c1".into()),
        Edit::NoOp,
        Edit::Text(raw_op(json!([1, "x", 7]))),
    ];
    let wire = edits_to_json(&edits).unwrap();
    assert_eq!(
        wire,
        json!([
            { "commentId": "c1", "ranges": [{ "pos": 4, "length": 2 }] },
            { "commentId": "c1", "resolved": true },
            { "deleteComment": "c1" },
            { "noOp": true },
            { "textOperation": [1, "x", 7] },
        ])
    );
    assert_eq!(edits_from_json(&wire).unwrap(), edits);
    assert!(edits[..3].iter().all(Edit::is_comment) && !edits[3].is_comment());
    let mut commented = doc.clone();
    assert_eq!(commented.edit_comments(&added), RangeChange::Reshaped);
    assert_eq!(commented.edit_comments(&edits[1]), RangeChange::Reshaped);
    let restored = commented
        .comment_edit("c1", &[(3, 4), (3, 3), (2, 3)], true)
        .unwrap();
    assert_eq!(
        restored.to_json().unwrap(),
        json!({ "commentId": "c1", "ranges": [{ "pos": 4, "length": 2 }], "resolved": true })
    );
    assert_eq!(commented.edit_comments(&edits[2]), RangeChange::Reshaped);
    assert!(commented.comments().is_empty());
}

#[test]
fn rejecting_a_hidden_deletion_inserts_a_plain_copy_and_keeps_comments_over_it() {
    let doc = tracked_doc(
        "one two three four",
        &[(4, 4, marked("delete", "carol", "2025-11-15T09:46:40.000Z"))],
        json!([
            { "id": "c1", "ranges": [{ "pos": 4, "length": 4 }] },
            { "id": "c2", "ranges": [{ "pos": 0, "length": 6 }] },
            { "id": "c3", "ranges": [{ "pos": 6, "length": 7 }] },
            { "id": "c4", "ranges": [{ "pos": 0, "length": 3 }] },
        ]),
    );
    assert_eq!(doc.visible().unwrap(), "one three four");
    let ids: Vec<String> = doc
        .review()
        .changes
        .iter()
        .map(|change| change.id.clone())
        .collect();
    let op = doc.decision_op(&ids, Decision::Reject).unwrap();
    assert_eq!(
        op.to_json().unwrap(),
        json!([
            4,
            { "i": "tw", "commentIds": ["c1", "c2"] },
            { "i": "o ", "commentIds": ["c1", "c3"] },
            -4,
            10
        ])
    );
    let mut shown = TextOperation::new();
    shown.retain(4).insert("two ").retain(10);
    assert_eq!(doc.project(&op).unwrap(), shown);
    let after = applied(&doc, &op);
    assert_eq!(after.visible().unwrap(), "one two three four");
    assert!(after.tracked().is_empty());
    let ranges = |id: &str| after.comment(id).unwrap().ranges.clone();
    assert_eq!(ranges("c1"), vec![(4, 4)]);
    assert_eq!(ranges("c2"), vec![(0, 6)]);
    assert_eq!(ranges("c3"), vec![(6, 7)]);
    assert_eq!(ranges("c4"), vec![(0, 3)]);
}

#[test]
fn an_undo_shows_your_own_hidden_text_again_instead_of_inserting_it() {
    let doc = doc("abXYcdef", &[(2, 2)]);
    let undo = insertion(6, 2, "XY");
    let plain = doc.encode_with(&undo, None, None).unwrap();
    assert_eq!(plain.to_json().unwrap(), json!([2, "XY", 6]));
    let shown = doc.encode_with(&undo, None, Some("bob")).unwrap();
    assert_eq!(shown.to_json().unwrap(), json!([2, "XY", -2, 4]));
    assert_eq!(doc.project(&shown).unwrap(), undo);
    assert_eq!(applied(&doc, &shown).visible().unwrap(), "abXYcdef");
    assert_eq!(
        doc.encode_with(&undo, None, Some("carol"))
            .unwrap()
            .to_json()
            .unwrap(),
        json!([2, "XY", 6])
    );
    let prefix = doc
        .encode_with(&insertion(6, 2, "X"), None, Some(""))
        .unwrap();
    assert_eq!(prefix.to_json().unwrap(), json!([2, "X", -1, 5]));
    assert_eq!(applied(&doc, &prefix).visible().unwrap(), "abXcdef");
    let other = doc
        .encode_with(&insertion(6, 2, "Q"), None, Some(""))
        .unwrap();
    assert_eq!(other.to_json().unwrap(), json!([2, "Q", 6]));
}

#[test]
fn applying_an_op_reports_a_shift_apart_from_a_change_of_shape() {
    let doc = tracked_doc(
        "abc def ghi",
        &[(4, 3, marked("insert", "carol", "2025-11-15T09:46:41.000Z"))],
        json!([{ "id": "c1", "ranges": [{ "pos": 8, "length": 3 }] }]),
    );
    let mut copy = doc.clone();
    assert_eq!(
        copy.apply(&raw_op(json!([11, "!"]))).unwrap(),
        RangeChange::Same
    );
    assert_eq!(
        copy.apply(&raw_op(json!(["> ", 12]))).unwrap(),
        RangeChange::Moved
    );
    assert_eq!(
        copy.apply(&raw_op(json!([7, "x", 7]))).unwrap(),
        RangeChange::Reshaped
    );
    assert_eq!(
        copy.apply(&raw_op(json!([2, { "r": 1, "tracking": marked("delete", "bob", "2025-11-15T09:46:42.000Z") }, 12]))).unwrap(),
        RangeChange::Reshaped
    );
    assert!(raw_op(json!([4])).is_noop());
    assert!(!raw_op(json!([{ "r": 4, "tracking": { "type": "none" } }])).is_noop());
}
