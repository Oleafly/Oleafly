use oleafly_ot::testing::{random_unit, Rng};
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::*;
use crate::live::{AppliedUpdate, DocId, PublicId, Tracking};

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

fn apply_steps(text: &str, steps: &[TextOperation]) -> String {
    steps
        .iter()
        .fold(text.to_string(), |text, step| step.apply(&text).unwrap())
}

fn ranges(state: &FormatState) -> &ShareJsRanges {
    let FormatState::ShareJs(ranges) = state;
    ranges
}

fn update(op: Value, tc: bool, user: &str) -> AppliedUpdate {
    AppliedUpdate {
        doc: DocId("d".into()),
        v: 0,
        op: Some(op),
        source: Some(PublicId("P.other".into())),
        user_id: Some(user.into()),
        tc: tc.then(|| "0123456789abcdef01".into()),
        dup: false,
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
    let pieces = pieces_of(text, &edit).unwrap();
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
            pieces_of(&text, &edit)
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
fn the_hash_is_sha1_of_the_utf16_length_and_utf8_text() {
    assert_eq!(
        blob_hash("Keep this sentence. Remove this word please.\nSecond line.\n"),
        "4d4d198e695485906c39cc5fd9e5d50dceea66ea"
    );
    assert_eq!(blob_hash(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    assert_ne!(blob_hash("😀"), blob_hash("\u{FFFD}\u{FFFD}"));
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
    let first = state.encode("abc", &edit, Some(&tracking)).unwrap();
    let second = state.encode("abc", &edit, Some(&tracking)).unwrap();
    let seed = first.tc.clone().unwrap();
    assert_eq!(seed.len(), 18);
    assert!(seed
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_ne!(first.tc, second.tc);
    assert_eq!(
        first.echo,
        Echo::ShareJs {
            tracked_by: Some("u1".into())
        }
    );
    assert_eq!(state.encode("abc", &edit, None).unwrap().tc, None);
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
            .decode(text, &update(wire, false, "u2"), None)
            .unwrap();
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
        .acknowledge(
            &text,
            &op(|o| {
                o.insert(">> ").retain(utf16_len(&before));
            }),
            &Echo::ShareJs { tracked_by: None },
        )
        .unwrap();
    assert_eq!(ranges(&state).comments()[1].at, 3);
    assert_eq!(ranges(&state).comments()[0].at, 11);
    let wrong = state.decode(
        &text,
        &update(json!([{ "p": 9, "d": "XY" }]), false, "u2"),
        None,
    );
    assert_eq!(wrong, Err(CodecError::Mismatch));
}

#[test]
fn tracked_changes_merge_split_and_cancel_like_overleaf() {
    let mut state = sharejs("abcdef");
    let mut text = "abcdef".to_string();
    let apply = |state: &mut FormatState, text: &mut String, wire: Value, tc: bool, user: &str| {
        let steps = state.decode(text, &update(wire, tc, user), None).unwrap();
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

#[test]
fn random_untracked_and_tracked_edits_keep_ranges_inside_the_text() {
    let mut rng = Rng::new(0x07);
    for _ in 0..300 {
        let mut text = random_text(&mut rng, 20);
        let mut state = sharejs(&text);
        for _ in 0..40 {
            let edit = random_operation(&mut rng, &text);
            let tracked = rng.chance(50);
            let user = *rng.pick(&["u1", "u2"]);
            let wire = Value::Array(
                pieces_of(&text, &edit)
                    .unwrap()
                    .iter()
                    .map(piece_to_json)
                    .collect(),
            );
            let steps = state
                .decode(&text, &update(wire, tracked, user), None)
                .unwrap();
            text = apply_steps(&text, &steps);
            if rng.chance(10) && !text.is_empty() {
                let at = random_unit(&text, &mut rng);
                let end = (at + 1 + rng.below(3)).min(utf16_len(&text));
                let units: Vec<u16> = text.encode_utf16().collect();
                let commented = String::from_utf16_lossy(&units[at..end]);
                if commented.contains('\u{FFFD}') || end == at {
                    continue;
                }
                let wire = json!([{ "p": at, "c": commented, "t": format!("t{}", rng.below(4)) }]);
                state
                    .decode(&text, &update(wire, false, user), None)
                    .unwrap();
            }
            let units: Vec<u16> = text.encode_utf16().collect();
            for change in ranges(&state).changes() {
                assert!(change.at <= units.len());
                if change.kind == ChangeKind::Insert {
                    assert_eq!(
                        &units[change.at..change.at + change.text.len()],
                        change.text.as_slice()
                    );
                }
            }
            for comment in ranges(&state).comments() {
                assert_eq!(
                    &units[comment.at..comment.at + comment.text.len()],
                    comment.text.as_slice()
                );
            }
        }
    }
}
