use oleafly_ot::testing::{random_unit, Rng};
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::*;
use crate::live::{AppliedUpdate, DocId, PublicId, Tracking};

fn undo_extra() -> Extra {
    Extra {
        undo: true,
        ..Extra::default()
    }
}

fn op(build: impl FnOnce(&mut TextOperation)) -> TextOperation {
    let mut operation = TextOperation::new();
    build(&mut operation);
    operation
}

fn sharejs(text: &str) -> FormatState {
    FormatState::from_join(DocFormat::ShareJs, &json!([packed(text)]), &json!({}))
        .unwrap()
        .1
}

fn apply_steps(text: &str, steps: &[Step]) -> String {
    steps.iter().fold(text.to_string(), |text, step| {
        step.confirmed.apply(&text).unwrap()
    })
}

fn ranges(state: &FormatState) -> &ShareJsRanges {
    match state {
        FormatState::ShareJs(ranges) => ranges,
        FormatState::HistoryOt(_) => panic!("a ShareJS doc"),
    }
}

fn update(op: Value, tc: bool, user: &str) -> AppliedUpdate {
    AppliedUpdate {
        doc: DocId("d".into()),
        v: 0,
        op: Some(op),
        source: Some(PublicId("P.other".into())),
        user_id: Some(user.into()),
        tc: tc.then(|| "0123456789abcdef01".into()),
        ts: None,
        dup: false,
        external: false,
    }
}

fn packed(text: &str) -> String {
    text.bytes().map(char::from).collect()
}

const ALPHABET: [&str; 7] = ["a", "b", " ", "\n", "é", "😀", "z"];

fn random_text(rng: &mut Rng, max: usize) -> String {
    (0..rng.below(max)).map(|_| *rng.pick(&ALPHABET)).collect()
}

fn random_operation(rng: &mut Rng, text: &str) -> TextOperation {
    let mut operation = TextOperation::new();
    let mut rest = text;
    while !rest.is_empty() {
        let take: usize = rest
            .chars()
            .take(1 + rng.below(3))
            .map(char::len_utf8)
            .sum();
        let units = utf16_len(&rest[..take]);
        match rng.below(3) {
            0 => operation.retain(units),
            1 => operation.delete(units),
            _ => operation.insert(&random_text(rng, 3)).retain(units),
        };
        rest = &rest[take..];
    }
    if rng.chance(30) {
        operation.insert(&random_text(rng, 4));
    }
    operation
}

#[test]
fn sharejs_ops_round_trip_to_text_operation() {
    let text = "ab😀cdéf";
    let edit = op(|o| {
        o.retain(2)
            .insert("XY")
            .delete(2)
            .retain(1)
            .delete(1)
            .retain(2);
    });
    let pieces = pieces_of_flagged(text, &edit, false).unwrap();
    let wire = Value::Array(pieces.iter().map(piece_to_json).collect());
    assert_eq!(
        wire,
        json!([{ "p": 2, "i": "XY" }, { "p": 4, "d": "😀" }, { "p": 5, "d": "d" }])
    );
    assert_eq!(
        operation_of(text, &pieces_from_json(&wire).unwrap()).unwrap(),
        edit
    );
    let unordered =
        json!([{ "p": 4, "i": "!" }, { "p": 0, "d": "ab" }, { "p": 0, "c": "😀", "t": "thread" }]);
    let decoded = operation_of(text, &pieces_from_json(&unordered).unwrap()).unwrap();
    assert_eq!(decoded.apply(text).unwrap(), "😀!cdéf");
    let mut rng = Rng::new(458);
    for round in 0..5_000 {
        let text = random_text(&mut rng, 14);
        let edit = random_operation(&mut rng, &text);
        let wire = Value::Array(
            pieces_of_flagged(&text, &edit, false)
                .unwrap()
                .iter()
                .map(piece_to_json)
                .collect(),
        );
        let back = operation_of(&text, &pieces_from_json(&wire).unwrap()).unwrap();
        assert_eq!(
            back.apply(&text).unwrap(),
            edit.apply(&text).unwrap(),
            "round {round}: {wire}"
        );
        assert_eq!(back, edit, "round {round}: {wire}");
    }
}

#[test]
fn a_remote_op_that_does_not_match_the_text_is_refused() {
    let text = "a😀b";
    for wire in [
        json!([{ "p": 1, "d": "x" }]),
        json!([{ "p": 2, "i": "x" }]),
        json!([{ "p": 9, "i": "x" }]),
        json!([{ "p": 2, "d": "\u{FFFD}" }]),
    ] {
        assert_eq!(
            operation_of(text, &pieces_from_json(&wire).unwrap()),
            Err(CodecError::Mismatch),
            "{wire}"
        );
    }
    assert!(matches!(
        pieces_from_json(&json!([{ "p": 0, "x": "y" }])),
        Err(CodecError::Unsupported(_))
    ));
    assert!(matches!(
        pieces_from_json(&json!({ "p": 0 })),
        Err(CodecError::Malformed(_))
    ));
}

#[test]
fn join_lines_and_ranges_are_unpacked_from_utf8() {
    let lines = json!([packed("\\section{Größe} 😀"), packed("second")]);
    let wire_ranges = json!({
        "comments": [{ "id": "c1", "op": { "c": packed("Größe"), "p": 9, "t": "c1" } }],
        "changes": [{ "id": "x1", "op": { "i": packed("😀"), "p": 16 }, "metadata": { "user_id": "u1" } }],
    });
    let (text, state) = FormatState::from_join(DocFormat::ShareJs, &lines, &wire_ranges).unwrap();
    assert_eq!(text, "\\section{Größe} 😀\nsecond");
    let parsed = ranges(&state);
    assert_eq!(
        parsed.comments()[0].text,
        "Größe".encode_utf16().collect::<Vec<_>>()
    );
    assert_eq!(parsed.changes()[0].user.as_deref(), Some("u1"));
    assert_eq!(parsed.counts(), (1, 1));
    assert!(matches!(
        FormatState::from_join(DocFormat::ShareJs, &json!(["Größe"]), &json!({})),
        Err(CodecError::Malformed(_))
    ));
    assert_eq!(
        DocFormat::from_join_type("history-ot").unwrap(),
        DocFormat::HistoryOt
    );
    assert!(matches!(
        DocFormat::from_join_type("json0"),
        Err(CodecError::Unsupported(_))
    ));
}

#[test]
fn lone_surrogate_and_nul_become_replacement_char() {
    let edit = op(|o| {
        o.retain(1).insert("a\0b😀c");
    });
    let sanitized = sanitize(&edit);
    assert_eq!(
        sanitized.send.apply("x").unwrap(),
        "xa\u{FFFD}b\u{FFFD}\u{FFFD}c"
    );
    let correction = sanitized.correction.unwrap();
    let typed = edit.apply("x").unwrap();
    assert_eq!(
        correction.apply(&typed).unwrap(),
        sanitized.send.apply("x").unwrap()
    );
    assert_eq!(sanitized.send.target_len(), edit.target_len());
    let line_endings = sanitize(&op(|o| {
        o.insert("one\r\ntwo\rthree");
    }));
    assert_eq!(line_endings.send.apply("").unwrap(), "one\ntwo\nthree");
    assert_eq!(
        line_endings
            .correction
            .unwrap()
            .apply("one\r\ntwo\rthree")
            .unwrap(),
        "one\ntwo\nthree"
    );
    let clean = sanitize(&op(|o| {
        o.retain(2).delete(1).insert("é\n");
    }));
    assert!(clean.correction.is_none());
    assert!(serde_json::from_str::<TextOperation>(r#"["\ud83d"]"#).is_err());
    assert!(serde_json::from_str::<Value>(r#"{"p":0,"i":"\ud800x"}"#).is_err());
    assert_eq!(
        operation_of(
            "😀",
            &pieces_from_json(&json!([{ "p": 1, "i": "x" }])).unwrap()
        ),
        Err(CodecError::Mismatch)
    );
}

#[test]
fn a_suggestion_carries_a_fresh_eighteen_hex_seed() {
    let state = sharejs("abc");
    let edit = op(|o| {
        o.retain(3).insert("d");
    });
    let tracking = Tracking {
        user_id: "u1".into(),
        ts: "2026-11-15T00:00:00.000Z".into(),
    };
    let first = state
        .encode("abc", &edit, Some(&tracking), None, &Extra::default())
        .unwrap();
    let second = state
        .encode("abc", &edit, Some(&tracking), None, &Extra::default())
        .unwrap();
    let seed = first.tc.clone().unwrap();
    assert_eq!(seed.len(), 18);
    assert!(seed
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_ne!(first.tc, second.tc);
    assert_eq!(
        first.echo,
        Echo::ShareJs {
            tracked_by: Some("u1".into()),
            tc: first.tc.clone(),
            ts: Some(1_794_700_800_000),
            undo: false,
            comments: Vec::new(),
            accepts: Vec::new(),
            clashed: false,
        }
    );
    let resent = state
        .encode(
            "abc",
            &edit,
            Some(&tracking),
            Some(&first.echo),
            &Extra::default(),
        )
        .unwrap();
    assert_eq!((resent.tc, resent.echo), (first.tc.clone(), first.echo));
    let untracked = state
        .encode("abc", &edit, None, Some(&second.echo), &Extra::default())
        .unwrap();
    assert_eq!(untracked.tc, None);
}

#[test]
fn comment_anchors_move_with_text() {
    let mut state = FormatState::from_join(
        DocFormat::ShareJs,
        &json!([packed("one two three")]),
        &json!({ "comments": [{ "id": "t1", "op": { "c": "two", "p": 4, "t": "t1" } }] }),
    )
    .unwrap()
    .1;
    let mut text = "one two three".to_string();
    let remote = |state: &mut FormatState, text: &mut String, wire: Value| {
        let steps = state
            .decode_ranges(text, &update(wire, false, "u2"), None)
            .unwrap()
            .0;
        *text = apply_steps(text, &steps);
    };
    remote(&mut state, &mut text, json!([{ "p": 0, "i": "zero " }]));
    let anchor = ranges(&state).comments()[0].clone();
    assert_eq!((anchor.at, anchor.text.len()), (9, 3));
    remote(&mut state, &mut text, json!([{ "p": 10, "i": "W" }]));
    remote(&mut state, &mut text, json!([{ "p": 13, "i": "!" }]));
    let anchor = &ranges(&state).comments()[0];
    assert_eq!(String::from_utf16(&anchor.text).unwrap(), "tWwo");
    assert_eq!(&text[anchor.at..anchor.at + 4], "tWwo");
    remote(&mut state, &mut text, json!([{ "p": 8, "d": " tW" }]));
    let anchor = &ranges(&state).comments()[0];
    assert_eq!(
        (
            anchor.at,
            String::from_utf16(&anchor.text).unwrap().as_str()
        ),
        (8, "wo")
    );
    remote(
        &mut state,
        &mut text,
        json!([{ "p": 0, "c": "zero", "t": "t2" }]),
    );
    assert_eq!(text, "zero onewo! three");
    assert_eq!(ranges(&state).counts(), (2, 0));
    let before = text.clone();
    state
        .acknowledge_ranges(
            &text,
            &op(|o| {
                o.insert(">> ").retain(utf16_len(&before));
            }),
            &Echo::ShareJs {
                tracked_by: None,
                tc: None,
                ts: None,
                undo: false,
                comments: Vec::new(),
                accepts: Vec::new(),
                clashed: false,
            },
        )
        .unwrap();
    assert_eq!(ranges(&state).comments()[1].at, 3);
    assert_eq!(ranges(&state).comments()[0].at, 11);
    let wrong = state
        .decode_ranges(
            &text,
            &update(json!([{ "p": 9, "d": "XY" }]), false, "u2"),
            None,
        )
        .map(|(steps, _)| steps);
    assert_eq!(wrong, Err(CodecError::Mismatch));
}

#[test]
fn tracked_changes_merge_split_and_cancel_like_overleaf() {
    let mut state = sharejs("abcdef");
    let mut text = "abcdef".to_string();
    let apply = |state: &mut FormatState, text: &mut String, wire: Value, tc: bool, user: &str| {
        let steps = state
            .decode_ranges(text, &update(wire, tc, user), None)
            .unwrap()
            .0;
        *text = apply_steps(text, &steps);
    };
    for (at, typed) in [(3, "X"), (4, "Y"), (5, "Z")] {
        apply(
            &mut state,
            &mut text,
            json!([{ "p": at, "i": typed }]),
            true,
            "u1",
        );
    }
    assert_eq!(text, "abcXYZdef");
    assert_eq!(ranges(&state).counts(), (0, 1));
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 4, "i": "q" }]),
        false,
        "u2",
    );
    assert_eq!(ranges(&state).counts(), (0, 2));
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 5, "i": "r" }]),
        true,
        "u2",
    );
    assert_eq!(ranges(&state).counts(), (0, 3));
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 4, "d": "qr" }]),
        false,
        "u2",
    );
    assert_eq!(text, "abcXYZdef");
    assert_eq!(ranges(&state).counts(), (0, 1));
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 3, "d": "XYZd" }]),
        true,
        "u1",
    );
    assert_eq!(text, "abcef");
    let changes = ranges(&state).changes();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].kind, ChangeKind::Delete);
    assert_eq!(String::from_utf16(&changes[0].text).unwrap(), "d");
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 2, "d": "c" }]),
        true,
        "u1",
    );
    let changes = ranges(&state).changes();
    assert_eq!(changes.len(), 1);
    assert_eq!(String::from_utf16(&changes[0].text).unwrap(), "cd");
    apply(
        &mut state,
        &mut text,
        json!([{ "p": 2, "i": "c", "u": true }]),
        false,
        "u1",
    );
    let changes = ranges(&state).changes();
    assert_eq!((changes.len(), changes[0].at), (1, 3));
    assert_eq!(String::from_utf16(&changes[0].text).unwrap(), "d");
}

fn random_remote_edit(state: &mut FormatState, text: &str, rng: &mut Rng, user: &str) -> String {
    let edit = random_operation(rng, text);
    let tracked = rng.chance(50);
    let wire = Value::Array(
        pieces_of_flagged(text, &edit, false)
            .unwrap()
            .iter()
            .map(piece_to_json)
            .collect(),
    );
    let steps = state
        .decode_ranges(text, &update(wire, tracked, user), None)
        .unwrap()
        .0;
    apply_steps(text, &steps)
}

fn random_comment(state: &mut FormatState, text: &str, rng: &mut Rng, user: &str) {
    let at = random_unit(text, rng);
    let end = (at + 1 + rng.below(3)).min(utf16_len(text));
    let units: Vec<u16> = text.encode_utf16().collect();
    let commented = String::from_utf16_lossy(&units[at..end]);
    if commented.contains('\u{FFFD}') || end == at {
        return;
    }
    let wire = json!([{ "p": at, "c": commented, "t": format!("t{}", rng.below(4)) }]);
    state
        .decode_ranges(text, &update(wire, false, user), None)
        .unwrap();
}

fn assert_ranges_inside(state: &FormatState, text: &str) {
    let units: Vec<u16> = text.encode_utf16().collect();
    for change in ranges(state).changes() {
        assert!(change.at <= units.len());
        if change.kind == ChangeKind::Insert {
            assert_eq!(
                &units[change.at..change.at + change.text.len()],
                change.text.as_slice()
            );
        }
    }
    for comment in ranges(state).comments() {
        assert_eq!(
            &units[comment.at..comment.at + comment.text.len()],
            comment.text.as_slice()
        );
    }
}

#[test]
fn random_untracked_and_tracked_edits_keep_ranges_inside_the_text() {
    let mut rng = Rng::new(0x07);
    for _ in 0..300 {
        let mut text = random_text(&mut rng, 20);
        let mut state = sharejs(&text);
        for _ in 0..40 {
            let user = *rng.pick(&["u1", "u2"]);
            text = random_remote_edit(&mut state, &text, &mut rng, user);
            if rng.chance(10) && !text.is_empty() {
                random_comment(&mut state, &text, &mut rng, user);
            }
            assert_ranges_inside(&state, &text);
        }
    }
}

fn seeded(op: Value, tc: Option<&str>, user: &str, ts: i64) -> AppliedUpdate {
    AppliedUpdate {
        tc: tc.map(str::to_string),
        ts: Some(ts),
        ..update(op, false, user)
    }
}

fn decode_into(state: &mut FormatState, text: &mut String, update: &AppliedUpdate) -> RangeChange {
    let (steps, change) = state.decode_ranges(text, update, None).unwrap();
    *text = apply_steps(text, &steps);
    change
}

type Summary = (Option<String>, usize, String, Option<String>, Option<i64>);

fn summary(state: &FormatState) -> Vec<Summary> {
    ranges(state)
        .changes()
        .iter()
        .map(|change| {
            (
                change.id().map(str::to_string),
                change.at,
                String::from_utf16(&change.text).unwrap(),
                change.user.clone(),
                change.ts,
            )
        })
        .collect()
}

const S1: &str = "aaaaaaaaaaaaaaaaa1";
const S2: &str = "aaaaaaaaaaaaaaaaa2";
const S3: &str = "aaaaaaaaaaaaaaaaa3";

#[test]
fn change_ids_follow_the_suggestion_seed_like_the_ranges_tracker() {
    let mut text = "abcdef".to_string();
    let mut state = sharejs(&text);
    let id = |seed: &str, n: u32| Some(format!("{seed}{n:06x}"));
    let change = decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 3, "i": "XYZ" }]), Some(S1), "u1", 1_000),
    );
    assert_eq!(change, RangeChange::Reshaped);
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 6, "i": "W" }]), Some(S2), "u1", 2_000),
    );
    assert_eq!(
        summary(&state),
        vec![(id(S1, 1), 3, "XYZW".into(), Some("u1".into()), Some(1_000))]
    );
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 4, "i": "q" }]), Some(S3), "u2", 3_000),
    );
    assert_eq!(text, "abcXqYZWdef");
    assert_eq!(
        summary(&state),
        vec![
            (id(S1, 1), 3, "X".into(), Some("u1".into()), Some(1_000)),
            (id(S3, 1), 4, "q".into(), Some("u2".into()), Some(3_000)),
            (id(S3, 2), 5, "YZW".into(), Some("u1".into()), Some(1_000)),
        ]
    );
    assert!(ranges(&state).all_ids_known());
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 6, "i": "!" }]), None, "u3", 4_000),
    );
    assert_eq!(text, "abcXqY!ZWdef");
    let split = summary(&state);
    assert_eq!(
        split[2],
        (id(S3, 2), 5, "Y".into(), Some("u1".into()), Some(1_000))
    );
    assert_eq!(
        split[3],
        (None, 7, "ZW".into(), Some("u1".into()), Some(1_000))
    );
    assert!(!ranges(&state).all_ids_known());
    let unknown = ranges(&state).changes()[3].key();
    assert_eq!(
        ranges(&state)
            .change_by_key(unknown)
            .map(|change| change.at),
        Some(7)
    );
    let mut joined = ranges(&state).to_json(true);
    for change in joined["changes"].as_array_mut().unwrap() {
        if change["op"]["p"] == 7 {
            change["id"] = json!("5f0000000000000000000009");
            change["metadata"]["ts"] = json!("2025-11-15T09:46:40.123Z");
        }
    }
    let fresh = ShareJsRanges::from_join(&joined).unwrap();
    let keys: Vec<u64> = ranges(&state)
        .changes()
        .iter()
        .map(TrackedChange::key)
        .collect();
    let FormatState::ShareJs(held) = &mut state else {
        panic!("a ShareJS doc");
    };
    assert_eq!(held.adopt_all(&fresh), RangeChange::Same);
    assert!(held.all_ids_known());
    assert_eq!(
        held.changes()
            .iter()
            .map(TrackedChange::key)
            .collect::<Vec<_>>(),
        keys
    );
    assert_eq!(
        held.change_by_key(unknown).and_then(TrackedChange::id),
        Some("5f0000000000000000000009")
    );
    assert_eq!(
        held.change("5f0000000000000000000009")
            .map(|change| change.ts),
        Some(Some(1_763_200_000_123))
    );
    let mut trimmed = held.clone();
    let lone =
        ShareJsRanges::from_join(&json!({ "changes": [joined["changes"][3].clone()] })).unwrap();
    assert_eq!(trimmed.adopt_all(&lone), RangeChange::Reshaped);
    assert_eq!(trimmed.changes().len(), 1);
    assert_eq!(trimmed.changes()[0].key(), unknown);
    let deleted = decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 9, "d": "d" }]), Some(S2), "u2", 5_000),
    );
    assert_eq!(deleted, RangeChange::Reshaped);
    assert_eq!(
        summary(&state).last().cloned(),
        Some((id(S2, 1), 9, "d".into(), Some("u2".into()), Some(5_000)))
    );
}

#[test]
fn a_delete_that_reuses_a_removed_delete_keeps_its_id_and_takes_the_new_author() {
    let mut text = "abcdef".to_string();
    let mut state = sharejs(&text);
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 2, "d": "c" }]), Some(S1), "u1", 1_000),
    );
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 1, "d": "bd" }]), Some(S2), "u2", 2_000),
    );
    assert_eq!(text, "aef");
    assert_eq!(
        summary(&state),
        vec![(
            Some(format!("{S1}000001")),
            1,
            "bcd".into(),
            Some("u2".into()),
            Some(2_000)
        )]
    );
}

#[test]
fn range_reports_tell_a_shift_from_a_change_of_shape() {
    let mut text = "one two three".to_string();
    let mut state = FormatState::from_join(
        DocFormat::ShareJs,
        &json!([packed(&text)]),
        &json!({ "comments": [{ "id": "t1", "op": { "c": "two", "p": 4, "t": "t1" }, "metadata": { "user_id": "u1", "ts": 1_000 } }] }),
    )
    .unwrap()
    .1;
    let plain = |op: Value| seeded(op, None, "u2", 2_000);
    assert_eq!(
        decode_into(
            &mut state,
            &mut text,
            &plain(json!([{ "p": 13, "i": "!" }]))
        ),
        RangeChange::Same
    );
    assert_eq!(
        decode_into(&mut state, &mut text, &plain(json!([{ "p": 0, "i": ">" }]))),
        RangeChange::Moved
    );
    assert_eq!(
        decode_into(&mut state, &mut text, &plain(json!([{ "p": 6, "i": "w" }]))),
        RangeChange::Reshaped
    );
    assert_eq!(
        decode_into(
            &mut state,
            &mut text,
            &plain(json!([{ "p": 0, "c": ">", "t": "t2" }]))
        ),
        RangeChange::Reshaped
    );
    let comment = ranges(&state).comment("t1").unwrap();
    assert_eq!(
        (comment.user.as_deref(), comment.ts),
        (Some("u1"), Some(1_000))
    );
    let added = ranges(&state).comment("t2").unwrap();
    assert_eq!((added.user.as_deref(), added.ts), (Some("u2"), Some(2_000)));
    assert_eq!(
        RangeChange::Moved.and(RangeChange::Same),
        RangeChange::Moved
    );
    assert!(RangeChange::Same.and(RangeChange::Reshaped).reshaped());
}

#[test]
fn accepted_changes_and_deleted_threads_leave_the_ranges() {
    let mut ranges = ShareJsRanges::from_join(&json!({
        "changes": [
            { "id": "c1", "op": { "p": 1, "i": "XY" }, "metadata": { "user_id": "u1" } },
            { "id": "c2", "op": { "p": 4, "d": "gone" }, "metadata": { "user_id": "u2" } },
        ],
        "comments": [{ "id": "t1", "op": { "c": "a", "p": 0, "t": "t1" } }],
    }))
    .unwrap();
    assert_eq!(
        ranges.change("c2").map(|change| change.kind),
        Some(ChangeKind::Delete)
    );
    assert_eq!(ranges.remove_changes(&["c1".into(), "missing".into()]), 1);
    assert!(ranges.change("c1").is_none());
    assert!(ranges.remove_comment("t1"));
    assert!(!ranges.remove_comment("t1"));
    assert_eq!(ranges.counts(), (0, 1));
}

#[test]
fn rejecting_changes_builds_one_operation_against_the_whole_text() {
    let ranges = ShareJsRanges::from_join(&json!({
        "changes": [
            { "id": "d1", "op": { "p": 3, "d": "Q" }, "metadata": { "user_id": "u1" } },
            { "id": "i1", "op": { "p": 3, "i": "XY" }, "metadata": { "user_id": "u1" } },
            { "id": "i2", "op": { "p": 6, "i": packed("é") }, "metadata": { "user_id": "u2" } },
        ],
    }))
    .unwrap();
    let text = "abcXYdéf";
    let keys: Vec<u64> = ranges.changes().iter().map(TrackedChange::key).collect();
    let all = ranges.reject_op(&keys, utf16_len(text)).unwrap();
    assert_eq!(all.apply(text).unwrap(), "abcQdf");
    let one = ranges.reject_op(&keys[2..], utf16_len(text)).unwrap();
    assert_eq!(one.apply(text).unwrap(), "abcXYdf");
    assert_eq!(ranges.reject_op(&[999], utf16_len(text)), None);
    assert_eq!(ranges.reject_op(&keys, 4), None);
    let wire = pieces_to_json(&pieces_of_flagged(text, &all, true).unwrap());
    assert_eq!(
        wire,
        json!([{ "p": 3, "i": "Q", "u": true }, { "p": 4, "d": "XY", "u": true }, { "p": 5, "d": "é", "u": true }])
    );
}

#[test]
fn an_undone_insert_cancels_a_tracked_delete_and_keeps_its_flag_on_the_wire() {
    let mut text = "abc".to_string();
    let mut state = sharejs(&text);
    decode_into(
        &mut state,
        &mut text,
        &seeded(json!([{ "p": 1, "d": "b" }]), Some(S1), "u1", 1),
    );
    let undo = op(|o| {
        o.retain(1).insert("b").retain(1);
    });
    let encoded = state
        .encode(&text, &undo, None, None, &undo_extra())
        .unwrap();
    assert_eq!(encoded.op, json!([{ "p": 1, "i": "b", "u": true }]));
    let FormatState::ShareJs(_) = &state else {
        panic!("a ShareJS doc");
    };
    assert_eq!(
        state
            .acknowledge_ranges(&text, &undo, &encoded.echo)
            .unwrap(),
        RangeChange::Reshaped
    );
    assert_eq!(ranges(&state).counts(), (0, 0));
    let plain = state
        .encode(&text, &undo, None, None, &Extra::default())
        .unwrap();
    assert_eq!(plain.op, json!([{ "p": 1, "i": "b" }]));
    let mut later = sharejs("abc");
    let mut text = "abc".to_string();
    decode_into(
        &mut later,
        &mut text,
        &seeded(json!([{ "p": 1, "d": "b" }]), Some(S1), "u1", 1),
    );
    let mut sent = undo.clone();
    let mut echo = later
        .encode(&text, &undo, None, None, &undo_extra())
        .unwrap()
        .echo;
    later
        .decode_ranges(
            &text,
            &seeded(json!([{ "p": 0, "c": "a", "t": "t1" }]), None, "u2", 2),
            Some((&mut sent, &mut echo)),
        )
        .unwrap();
    assert!(matches!(
        echo,
        Echo::ShareJs {
            undo: true,
            clashed: true,
            ..
        }
    ));
    let mut deleting = sharejs("abc");
    let mut text = "abc".to_string();
    decode_into(
        &mut deleting,
        &mut text,
        &seeded(json!([{ "p": 1, "i": "x" }]), Some(S1), "u1", 1),
    );
    let mut withdrawn = op(|o| {
        o.retain(1).delete(1).retain(2);
    });
    let mut echo = deleting
        .encode(&text, &withdrawn, None, None, &undo_extra())
        .unwrap()
        .echo;
    deleting
        .decode_ranges(
            &text,
            &seeded(json!([{ "p": 0, "c": "a", "t": "t1" }]), None, "u2", 2),
            Some((&mut withdrawn, &mut echo)),
        )
        .unwrap();
    assert!(matches!(
        echo,
        Echo::ShareJs {
            undo: false,
            clashed: false,
            ..
        }
    ));
}

#[test]
fn our_own_acknowledged_suggestion_gets_the_id_the_server_gives_it() {
    let text = "abc";
    let mut state = sharejs(text);
    let tracking = Tracking {
        user_id: "me".into(),
        ts: "2025-11-15T09:46:40.123Z".into(),
    };
    let edit = op(|o| {
        o.retain(3).insert("d");
    });
    let encoded = state
        .encode(text, &edit, Some(&tracking), None, &Extra::default())
        .unwrap();
    let tc = encoded.tc.clone().unwrap();
    state
        .acknowledge_ranges(text, &edit, &encoded.echo)
        .unwrap();
    let change = &ranges(&state).changes()[0];
    assert_eq!(change.id(), Some(format!("{tc}000001").as_str()));
    assert_eq!(
        (change.user.as_deref(), change.ts),
        (Some("me"), Some(1_763_200_000_123))
    );
}

#[test]
fn ranges_round_trip_through_the_join_form() {
    let wire = json!({
        "changes": [
            { "id": "c1", "op": { "i": packed("Größe"), "p": 0 }, "metadata": { "user_id": "u1", "ts": "2025-11-15T09:46:40.123Z" } },
            { "id": "c2", "op": { "d": packed("😀"), "p": 5 }, "metadata": { "user_id": "u2", "ts": 1_763_200_000_000_i64 } },
        ],
        "comments": [{ "id": "t1", "op": { "c": packed("ß"), "p": 3, "t": "t1" }, "metadata": { "user_id": "u3", "ts": "2025-11-15T09:46:40.000Z" } }],
    });
    let parsed = ShareJsRanges::from_join(&wire).unwrap();
    let packed_again = parsed.to_json(true);
    assert_eq!(packed_again["changes"][0]["op"], wire["changes"][0]["op"]);
    assert_eq!(
        packed_again["changes"][1]["metadata"]["ts"],
        json!("2025-11-15T09:46:40.000Z")
    );
    let back = ShareJsRanges::from_join(&packed_again).unwrap();
    assert_eq!(back.changes().len(), 2);
    for (a, b) in back.changes().iter().zip(parsed.changes()) {
        assert_eq!(
            (a.id(), a.at, &a.text, &a.user, a.ts),
            (b.id(), b.at, &b.text, &b.user, b.ts)
        );
    }
    assert_eq!(back.comments(), parsed.comments());
    assert_eq!(parsed.to_json(false)["comments"][0]["op"]["c"], json!("ß"));
    assert_eq!(ShareJsRanges::default().to_json(true), json!({}));
}

#[test]
fn a_comment_anchor_is_the_visible_text_it_covers_and_counts_toward_the_limit() {
    let text = "a😀bc";
    let piece = comment_piece(text, 1, 4, "t1").unwrap();
    assert_eq!(
        piece_to_json(&piece),
        json!({ "p": 1, "c": "😀b", "t": "t1" })
    );
    assert_eq!(comment_piece(text, 2, 3, "t1"), Err(CodecError::Mismatch));
    assert_eq!(comment_piece(text, 1, 9, "t1"), Err(CodecError::Mismatch));
    assert_eq!(comment_piece(text, 1, 2, ""), Err(CodecError::Mismatch));
    let full: Vec<Value> = (0..MAX_COMMENTS)
        .map(|at| json!({ "id": format!("t{at}"), "op": { "p": 0, "c": "a", "t": format!("t{at}") } }))
        .collect();
    let ranges = ShareJsRanges::from_join(&json!({ "comments": full })).unwrap();
    let author = Author::of(Some("u1"), None, None);
    let new = comment_piece(text, 0, 1, "fresh").unwrap();
    assert_eq!(
        ranges.counts_after(&[new], &author).unwrap(),
        (MAX_COMMENTS + 1, 0)
    );
    let moved = comment_piece(text, 0, 1, "t1").unwrap();
    assert_eq!(
        ranges.counts_after(&[moved], &author).unwrap(),
        (MAX_COMMENTS, 0)
    );
}

#[test]
fn a_new_thread_id_is_an_object_id_like_the_ranges_tracker_makes() {
    let first = new_thread_id().unwrap();
    let second = new_thread_id().unwrap();
    for id in [&first, &second] {
        assert_eq!(id.len(), 24);
        assert!(id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
        assert!(id.ends_with("000001"));
    }
    assert_ne!(first, second);
}

#[test]
fn history_ot_updates_report_comment_and_tracking_changes() {
    let snapshot = json!({
        "content": "abc def",
        "comments": [{ "id": "c1", "ranges": [{ "pos": 4, "length": 3 }] }],
    });
    let (mut text, mut state) =
        FormatState::from_join(DocFormat::HistoryOt, &snapshot, &Value::Null).unwrap();
    let edit = |op: Value| seeded(op, None, "u2", 1);
    let resolved = edit(json!([{ "commentId": "c1", "resolved": true }]));
    let (steps, change) = state.decode_ranges(&text, &resolved, None).unwrap();
    assert!(steps.is_empty());
    assert_eq!(change, RangeChange::Reshaped);
    assert_eq!(
        decode_into(
            &mut state,
            &mut text,
            &edit(json!([{ "textOperation": ["> ", 7] }]))
        ),
        RangeChange::Moved
    );
    assert_eq!(text, "> abc def");
    assert_eq!(state.counts(), (1, 0));
    let tracked = json!([{ "textOperation": [2, { "r": 3, "tracking": { "type": "delete", "userId": "u2", "ts": "2025-11-15T09:46:40.123Z" } }, 4] }]);
    assert_eq!(
        decode_into(&mut state, &mut text, &edit(tracked)),
        RangeChange::Reshaped
    );
    assert_eq!((text.as_str(), state.counts()), (">  def", (1, 1)));
}
