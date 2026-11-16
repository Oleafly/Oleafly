use std::time::{Duration, Instant};

use oleafly_ot::testing::{deletion, insertion};
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::*;
use crate::live::format::{ChangeKind, DocFormat, FormatState};
use crate::live::harness::{Editor, Wire};
use crate::live::{AppliedUpdate, DocId, PublicId, SendMode, Tracking};
use crate::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};

const SECOND: Duration = Duration::from_secs(1);

fn me() -> PublicId {
    PublicId("P.me".into())
}

fn sharejs(text: &str) -> FormatState {
    let packed: String = text.bytes().map(char::from).collect();
    FormatState::from_join(DocFormat::ShareJs, &json!([packed]), &json!({}))
        .unwrap()
        .1
}

fn doc(text: &str) -> OverleafDoc {
    OverleafDoc::joined(DocId("doc".into()), 0, text.to_string(), sharejs(text))
}

fn ack(v: u64) -> AppliedUpdate {
    AppliedUpdate {
        doc: DocId("doc".into()),
        v,
        op: None,
        source: None,
        user_id: None,
        tc: None,
        dup: false,
        external: false,
    }
}

fn remote(v: u64, op: Value) -> AppliedUpdate {
    AppliedUpdate {
        doc: DocId("doc".into()),
        v,
        op: Some(op),
        source: Some(PublicId("P.them".into())),
        user_id: Some("them".into()),
        tc: None,
        dup: false,
        external: false,
    }
}

fn type_at(doc: &mut OverleafDoc, at: usize, text: &str) {
    let total = utf16_len(doc.text());
    assert_eq!(doc.local(insertion(total, at, text)).unwrap(), None);
}

fn suggest(user: &str) -> SendMode {
    SendMode::Suggest(Tracking {
        user_id: user.into(),
        ts: "2026-11-15T09:00:00.000Z".into(),
    })
}

fn send(doc: &mut OverleafDoc, now: Instant) -> OutgoingUpdate {
    doc.next_update(&me(), &SendMode::Edit, now)
        .unwrap()
        .expect("an update to send")
}

fn is_hex(text: &str, length: usize) -> bool {
    text.len() == length
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn assert_strict(update: &Value) {
    let object = update.as_object().expect("an update object");
    for key in object.keys() {
        assert!(
            ["doc", "op", "v", "lastV", "hash", "dupIfSource", "meta"].contains(&key.as_str()),
            "{key} is not in the server's schema: {update}"
        );
    }
    assert!(object["doc"].is_string());
    assert!(object["v"].is_u64());
    let op = object["op"].as_array().expect("op is a list");
    assert!(!op.is_empty(), "an empty op: {update}");
    for component in op {
        let mut keys: Vec<&str> = component
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert!(
            keys == ["i", "p"] || keys == ["d", "p"] || keys == ["c", "p", "t"],
            "{component}"
        );
        assert!(component["p"].is_u64());
    }
    if let Some(meta) = object.get("meta") {
        let meta = meta.as_object().unwrap();
        assert_eq!(meta.keys().collect::<Vec<_>>(), ["tc"], "{update}");
        assert!(is_hex(meta["tc"].as_str().unwrap(), 18));
    }
    assert!(object.get("hash").is_none(), "a hash: {update}");
    if let Some(last_v) = object.get("lastV") {
        assert!(last_v.is_u64());
    }
    if let Some(sources) = object.get("dupIfSource") {
        assert!(sources.as_array().unwrap().iter().all(Value::is_string));
    }
    assert!(update.pointer("/meta/source").is_none());
}

fn project() -> MockProject {
    MockProject::new("live")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .member(MockUser::named("erin"), Privilege::ReadAndWrite)
        .doc("main.tex", "Hello world\n")
}

#[tokio::test]
async fn outbound_update_matches_server_schema() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let start = Instant::now();
    let on = wire.public_id();
    let total = utf16_len(doc.text());
    doc.local(insertion(total, 5, ",")).unwrap();
    let first = doc
        .next_update(&on, &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert!(first.last_v.is_none() && first.dup_if_source.is_empty() && first.tc.is_none());
    let resend = doc
        .next_update(&on, &SendMode::Edit, start + 6 * SECOND)
        .unwrap()
        .unwrap();
    assert_eq!(resend.dup_if_source, vec![on.clone()]);
    for update in [&first, &resend] {
        assert_strict(&update.payload());
        wire.send(update);
    }
    for update in wire.incoming(&id) {
        doc.applied(&update, &wire.own).unwrap();
    }
    assert!(doc.is_settled());
    let total = utf16_len(doc.text());
    doc.local(deletion(total, 0, 5)).unwrap();
    let suggestion = doc
        .next_update(&on, &suggest(&mock.user("alice").id), start + 7 * SECOND)
        .unwrap()
        .unwrap();
    assert_eq!(suggestion.op, json!([{ "p": 0, "d": "Hello" }]));
    assert_eq!(suggestion.last_v, Some(0));
    assert_strict(&suggestion.payload());
    wire.send(&suggestion);
    wire.reconnect(&mock, "alice");
    let joined = wire.join(&id, Some(doc.version())).unwrap();
    doc.catch_up(&joined.updates, &wire.own).unwrap();
    assert!(doc.is_settled());
    assert_eq!(doc.text(), mock.doc_text(&id));
    wire.assert_healthy();
}

#[tokio::test]
async fn concurrent_inserts_at_one_place_land_in_the_server_order() {
    for oleafly_first in [true, false] {
        let mock = MockOverleaf::start(project()).await;
        let id = mock.doc_id("main.tex");
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        let mut bob = mock.peer("bob");
        bob.join(&id);
        bob.hold();
        bob.type_at(&id, 5, "B");
        type_at(&mut doc, 5, "A");
        let update = send(&mut doc, Instant::now());
        if oleafly_first {
            wire.send(&update);
            bob.release();
        } else {
            bob.release();
            wire.send(&update);
        }
        for update in wire.incoming(&id) {
            doc.applied(&update, &wire.own).unwrap();
        }
        let expected = if oleafly_first {
            "HelloBA world\n"
        } else {
            "HelloAB world\n"
        };
        assert_eq!(mock.doc_text(&id), expected);
        assert_eq!(doc.text(), expected);
        assert_eq!(bob.text(&id), expected);
        assert!(doc.is_settled());
        wire.assert_healthy();
    }
}

#[test]
fn an_empty_op_is_never_sent() {
    let start = Instant::now();
    let mut doc = doc("abc");
    let mut noop = TextOperation::new();
    noop.retain(3);
    assert_eq!(doc.local(noop).unwrap(), None);
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start).unwrap(),
        None
    );
    type_at(&mut doc, 1, "x");
    doc.local(deletion(4, 1, 1)).unwrap();
    assert!(doc.is_settled());
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start).unwrap(),
        None
    );
    doc.local(deletion(3, 1, 1)).unwrap();
    send(&mut doc, start);
    assert_eq!(
        doc.applied(&remote(0, json!([{ "p": 1, "d": "b" }])), &[me()])
            .unwrap(),
        Applied::Ignored
    );
    assert_eq!(doc.text(), "ac");
    let later = start + 30 * SECOND;
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, later).unwrap(),
        None
    );
    type_at(&mut doc, 2, "!");
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, later).unwrap(),
        None
    );
    let fresh = PublicId("P.fresh".into());
    let update = doc
        .next_update(&fresh, &SendMode::Edit, later)
        .unwrap()
        .expect("the pending op goes out on the new connection");
    assert_eq!(update.op, json!([{ "p": 2, "i": "!" }]));
    assert!(update.dup_if_source.is_empty());
    assert_eq!(update.v, 1);
}

#[tokio::test]
async fn a_resend_after_reconnect_names_every_earlier_connection() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let start = Instant::now();
    type_at(&mut doc, 0, ">");
    let mut earlier = Vec::new();
    for round in 0..3 {
        let on = wire.public_id();
        let update = doc
            .next_update(&on, &SendMode::Edit, start + round * SECOND)
            .unwrap()
            .unwrap();
        assert_eq!(update.dup_if_source, earlier);
        assert_eq!(update.v, 0);
        earlier.push(on);
        wire.reconnect(&mock, "alice");
        let joined = wire.join(&id, Some(doc.version())).unwrap();
        assert!(joined.updates.is_empty());
        doc.catch_up(&joined.updates, &wire.own).unwrap();
    }
    let on = wire.public_id();
    let update = doc
        .next_update(&on, &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(update.dup_if_source, earlier);
    wire.send(&update);
    wire.reconnect(&mock, "alice");
    wire.join(&id, Some(doc.version())).unwrap();
    let again = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(again.dup_if_source.len(), 4);
    assert_strict(&again.payload());
    wire.send(&again);
    for update in wire.incoming(&id) {
        assert_eq!(
            doc.applied(&update, &wire.own).unwrap(),
            Applied::Acknowledged
        );
    }
    assert!(doc.is_settled());
    assert_eq!(mock.doc_text(&id), ">Hello world\n");
    assert_eq!(mock.doc_version(&id), 1);
    assert_eq!(doc.text(), mock.doc_text(&id));
    wire.assert_healthy();
}

#[tokio::test]
async fn our_own_replayed_op_is_an_ack() {
    let mut doc = doc("abc");
    let start = Instant::now();
    type_at(&mut doc, 3, "!");
    send(&mut doc, start);
    let replay = AppliedUpdate {
        source: Some(me()),
        ..remote(0, json!([{ "p": 3, "i": "!" }]))
    };
    let later = PublicId("P.later".into());
    assert_eq!(
        doc.catch_up(std::slice::from_ref(&replay), &[me(), later.clone()])
            .unwrap(),
        Vec::<TextOperation>::new()
    );
    assert_eq!((doc.text(), doc.version()), ("abc!", 1));
    assert!(doc.is_settled());
    let from_before = AppliedUpdate { v: 1, ..replay };
    assert_eq!(
        doc.applied(&from_before, &[me(), later]).unwrap(),
        Applied::Remote(insertion(4, 3, "!"))
    );
    assert_eq!(doc.text(), "abc!!");

    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    type_at(&mut doc, 0, "#");
    let update = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    wire.send(&update);
    wire.reconnect(&mock, "alice");
    let joined = wire.join(&id, Some(doc.version())).unwrap();
    assert_eq!(joined.updates.len(), 1);
    assert!(doc.catch_up(&joined.updates, &wire.own).unwrap().is_empty());
    assert!(doc.is_settled());
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert_eq!(doc.version(), mock.doc_version(&id));
}

#[test]
fn an_op_older_than_80_versions_asks_for_a_rejoin() {
    let start = Instant::now();
    let mut doc = doc("abc");
    type_at(&mut doc, 0, "x");
    assert_eq!(
        doc.applied(&remote(85, json!([{ "p": 0, "i": "y" }])), &[me()]),
        Err(DocError::Gap {
            expected: 0,
            got: 85
        })
    );
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start),
        Err(DocError::Blocked(Limit::TooOld))
    );
    assert!(!doc.is_settled());
    let mut near = self::doc("abc");
    type_at(&mut near, 0, "x");
    let _ = near.applied(&remote(79, json!([{ "p": 0, "i": "y" }])), &[me()]);
    assert!(near
        .next_update(&me(), &SendMode::Edit, start)
        .unwrap()
        .is_some());
}

#[test]
fn a_doc_over_two_mebibytes_is_held_not_sent() {
    let start = Instant::now();
    let text = "a".repeat(2 * 1024 * 1024 - 4);
    let mut doc = doc(&text);
    type_at(&mut doc, 0, "123456");
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start),
        Err(DocError::Blocked(Limit::DocLength))
    );
    assert_eq!(utf16_len(doc.text()), 2 * 1024 * 1024 + 2);
    assert!(!doc.is_settled());
    doc.local(deletion(utf16_len(doc.text()), 10, 2)).unwrap();
    let update = send(&mut doc, start);
    assert_eq!(update.v, 0);
    let mut small = self::doc("abc");
    small.limit_length(4);
    type_at(&mut small, 0, "xy");
    assert_eq!(
        small.next_update(&me(), &SendMode::Edit, start),
        Err(DocError::Blocked(Limit::DocLength))
    );
}

#[test]
fn a_huge_update_is_held_not_sent() {
    let start = Instant::now();
    let mut doc = doc("");
    doc.limit_length(usize::MAX);
    type_at(&mut doc, 0, &"\"".repeat(1024 * 1024));
    send(&mut doc, start);
    let mut doc = self::doc(&"\"".repeat(2_000_000));
    doc.local(deletion(2_000_000, 0, 2_000_000)).unwrap();
    type_at(&mut doc, 0, &"\\".repeat(2_000_000));
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start),
        Err(DocError::Blocked(Limit::UpdateSize))
    );
}

#[test]
fn outgoing_updates_never_carry_a_hash() {
    let start = Instant::now();
    let mut doc = doc("abc");
    let mut sent = Vec::new();
    type_at(&mut doc, 3, "d");
    sent.push(send(&mut doc, start));
    type_at(&mut doc, 4, "e");
    let resend = send(&mut doc, start + 6 * SECOND);
    assert_eq!(resend.op, json!([{ "p": 3, "i": "d" }]));
    sent.push(resend);
    assert_eq!(
        doc.applied(&ack(0), &[me()]).unwrap(),
        Applied::Acknowledged
    );
    sent.push(send(&mut doc, start + 12 * SECOND));
    assert_eq!(
        doc.applied(&remote(1, json!([{ "p": 0, "i": ">" }])), &[me()])
            .unwrap(),
        Applied::Remote(insertion(5, 0, ">"))
    );
    let resend = send(&mut doc, start + 18 * SECOND);
    assert_eq!(
        (resend.v, resend.op.clone()),
        (2, json!([{ "p": 5, "i": "e" }]))
    );
    sent.push(resend);
    sent.push(
        doc.next_update(&me(), &suggest("u1"), start + 24 * SECOND)
            .unwrap()
            .unwrap(),
    );
    assert_eq!(doc.text(), ">abcde");
    let (text, format) = FormatState::from_join(
        DocFormat::HistoryOt,
        &json!({ "content": "abc" }),
        &json!({}),
    )
    .unwrap();
    let mut history = OverleafDoc::joined(DocId("doc".into()), 0, text, format);
    type_at(&mut history, 0, "x");
    sent.push(send(&mut history, start));
    for update in &sent {
        assert!(
            update.payload().get("hash").is_none(),
            "{}",
            update.payload()
        );
        if update.op[0].get("textOperation").is_none() {
            assert_strict(&update.payload());
        }
    }
}

#[tokio::test]
async fn an_emoji_typed_here_on_a_sharejs_doc_becomes_two_replacement_chars_everywhere() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    let mut editor = Editor::new(doc.text());
    editor.doc.jump(5);
    editor.type_text("😀!\0");
    editor.drain(&mut doc);
    assert_eq!(editor.corrections, 1);
    let update = send(&mut doc, Instant::now());
    assert_eq!(
        update.op,
        json!([{ "p": 5, "i": "\u{FFFD}\u{FFFD}!\u{FFFD}" }])
    );
    wire.send(&update);
    for update in wire.incoming(&id) {
        doc.applied(&update, &wire.own).unwrap();
    }
    let mut erin = mock.peer("erin");
    erin.join(&id);
    erin.type_at(&id, 0, "🙂");
    for update in wire.incoming(&id) {
        if let Applied::Remote(op) = doc.applied(&update, &wire.own).unwrap() {
            editor.remote(op);
        }
    }
    editor.drain(&mut doc);
    let expected = "\u{FFFD}\u{FFFD}Hello\u{FFFD}\u{FFFD}!\u{FFFD} world\n";
    assert_eq!(mock.doc_text(&id), expected);
    assert_eq!(bob.text(&id), expected);
    assert_eq!(doc.text(), expected);
    assert_eq!(editor.channel.text(), expected);
    assert_eq!(editor.doc.content, expected);
    assert!(doc.is_settled() && editor.doc.synchronized());
    wire.assert_healthy();
}

#[tokio::test]
async fn resend_on_same_connection_after_five_seconds_names_current_public_id() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let start = Instant::now();
    let on = wire.public_id();
    type_at(&mut doc, 0, "%");
    let first = doc
        .next_update(&on, &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    wire.send(&first);
    for wait in [0, 1, 4] {
        assert_eq!(
            doc.next_update(&on, &SendMode::Edit, start + wait * SECOND)
                .unwrap(),
            None
        );
    }
    let resend = doc
        .next_update(&on, &SendMode::Edit, start + 5 * SECOND)
        .unwrap()
        .unwrap();
    assert_eq!(resend.dup_if_source, vec![on.clone()]);
    assert_eq!(resend.op, first.op);
    wire.send(&resend);
    let outcomes: Vec<Applied> = wire
        .incoming(&id)
        .iter()
        .map(|update| doc.applied(update, &wire.own).unwrap())
        .collect();
    assert_eq!(outcomes, [Applied::Acknowledged, Applied::Ignored]);
    assert_eq!(mock.doc_text(&id), "%Hello world\n");
    assert_eq!((doc.text(), doc.version()), ("%Hello world\n", 1));
    wire.assert_healthy();
}

#[tokio::test]
async fn role_downgrade_with_inflight_op_never_loops() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "carol");
    let mut doc = wire.open(&id);
    let carol = mock.user("carol").id;
    let start = Instant::now();
    type_at(&mut doc, 0, "Hi. ");
    let plain = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(wire.send_raw(&plain)[0]["message"], "not authorized");
    let mut sends = 1;
    wire.reconnect(&mock, "carol");
    let joined = wire.join(&id, Some(doc.version())).unwrap();
    doc.catch_up(&joined.updates, &wire.own).unwrap();
    let suggestion = doc
        .next_update(&wire.public_id(), &suggest(&carol), start + SECOND)
        .unwrap()
        .unwrap();
    assert!(suggestion.tc.is_some());
    assert_eq!(suggestion.op, plain.op);
    wire.send(&suggestion);
    sends += 1;
    for update in wire.incoming(&id) {
        assert_eq!(
            doc.applied(&update, &wire.own).unwrap(),
            Applied::Acknowledged
        );
    }
    type_at(&mut doc, 0, "Again. ");
    for wait in 2..40 {
        assert_eq!(
            doc.next_update(&wire.public_id(), &SendMode::Hold, start + wait * SECOND)
                .unwrap(),
            None
        );
    }
    assert_eq!(sends, 2);
    assert!(!doc.is_settled());
    assert_eq!(doc.text(), "Again. Hi. Hello world\n");
    assert_eq!(doc.record().unwrap().base_text, "Hi. Hello world\n");
    assert_eq!(mock.doc_text(&id), "Hi. Hello world\n");
    wire.assert_healthy();
}

#[test]
fn tracking_turned_on_mid_flight_reencodes_the_resend() {
    let start = Instant::now();
    let mut doc = doc("abc");
    type_at(&mut doc, 1, "X");
    let first = send(&mut doc, start);
    assert_eq!(first.tc, None);
    let resend = doc
        .next_update(&me(), &suggest("u1"), start + 5 * SECOND)
        .unwrap()
        .unwrap();
    assert!(resend.tc.is_some());
    assert_eq!(resend.op, first.op);
    let back = doc
        .next_update(&me(), &SendMode::Edit, start + 10 * SECOND)
        .unwrap()
        .unwrap();
    assert_eq!(back.tc, None);
    let again = doc
        .next_update(&me(), &suggest("u1"), start + 15 * SECOND)
        .unwrap()
        .unwrap();
    assert_ne!(again.tc, resend.tc);
    assert_eq!(
        doc.applied(&ack(0), &[me()]).unwrap(),
        Applied::Acknowledged
    );
    let FormatState::ShareJs(ranges) = doc.format() else {
        panic!("a ShareJS doc")
    };
    let change = &ranges.changes()[0];
    assert_eq!(
        (change.kind, change.at, change.user.as_deref()),
        (ChangeKind::Insert, 1, Some("u1"))
    );
}

#[test]
fn range_count_limit_blocks_send() {
    let start = Instant::now();
    let text = "xy.".repeat(MAX_CHANGES);
    let changes: Vec<Value> = (0..MAX_CHANGES)
        .map(|at| json!({ "id": format!("c{at}"), "op": { "i": "xy", "p": at * 3 }, "metadata": { "user_id": "u1" } }))
        .collect();
    let format = FormatState::from_join(
        DocFormat::ShareJs,
        &json!([text]),
        &json!({ "changes": changes }),
    )
    .unwrap()
    .1;
    let fresh = || OverleafDoc::joined(DocId("doc".into()), 0, text.clone(), format.clone());
    let mut splitting = fresh();
    type_at(&mut splitting, 1, "!");
    assert_eq!(
        splitting.next_update(&me(), &SendMode::Edit, start),
        Err(DocError::Blocked(Limit::RangeCount))
    );
    let mut tracked = fresh();
    type_at(&mut tracked, 2, "!");
    assert_eq!(
        tracked.next_update(&me(), &suggest("u2"), start),
        Err(DocError::Blocked(Limit::RangeCount))
    );
    assert!(tracked
        .next_update(&me(), &suggest("u1"), start)
        .unwrap()
        .is_some());
    let mut beside = fresh();
    type_at(&mut beside, 2, "!");
    assert!(beside
        .next_update(&me(), &SendMode::Edit, start)
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn a_reviewer_and_a_tracked_editor_send_tc() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut bob = mock.peer("bob");
    bob.join(&id);
    let start = Instant::now();
    for (name, at, typed) in [("carol", 0, "Reviewed. "), ("alice", 0, "Owner. ")] {
        let mut wire = Wire::connect(&mock, name);
        let mut doc = wire.open(&id);
        type_at(&mut doc, at, typed);
        let update = doc
            .next_update(&wire.public_id(), &suggest(&mock.user(name).id), start)
            .unwrap()
            .unwrap();
        assert!(is_hex(update.tc.as_deref().unwrap(), 18));
        wire.send(&update);
        for update in wire.incoming(&id) {
            assert_eq!(
                doc.applied(&update, &wire.own).unwrap(),
                Applied::Acknowledged
            );
        }
        wire.assert_healthy();
        let seen = bob.events("otUpdateApplied");
        let broadcast = &seen.last().unwrap()[0];
        assert_eq!(broadcast["meta"]["tc"], json!(update.tc.unwrap()));
        assert_eq!(broadcast["meta"]["user_id"], json!(mock.user(name).id));
    }
    assert_eq!(mock.doc_text(&id), "Owner. Reviewed. Hello world\n");
}

#[test]
fn editor_rev_is_never_read_as_overleaf_version() {
    let start = Instant::now();
    let mut doc = OverleafDoc::joined(DocId("doc".into()), 37, "abc".into(), sharejs("abc"));
    let mut editor = Editor::new("abc");
    for v in 37..40 {
        if let Applied::Remote(op) = doc
            .applied(&remote(v, json!([{ "p": 0, "i": "r" }])), &[me()])
            .unwrap()
        {
            editor.remote(op);
        }
    }
    editor.drain(&mut doc);
    editor.doc.jump(6);
    editor.type_text("!");
    editor.type_text("?");
    editor.drain(&mut doc);
    assert_eq!(editor.channel.rev(), 5);
    let update = send(&mut doc, start);
    assert_eq!(update.v, 40);
    assert_eq!(update.op, json!([{ "p": 6, "i": "!?" }]));
    assert_eq!(
        doc.applied(&ack(40), &[me()]).unwrap(),
        Applied::Acknowledged
    );
    assert_eq!(doc.version(), 41);
    assert_eq!(editor.channel.rev(), 5);
    assert_eq!(doc.text(), "rrrabc!?");
}

#[test]
fn a_gap_in_versions_asks_for_a_catch_up() {
    let mut doc = doc("abc");
    assert_eq!(
        doc.applied(&remote(2, json!([{ "p": 0, "i": "z" }])), &[me()]),
        Err(DocError::Gap {
            expected: 0,
            got: 2
        })
    );
    let missed = [
        remote(0, json!([{ "p": 0, "i": "x" }])),
        remote(1, json!([{ "p": 0, "i": "y" }])),
        remote(2, json!([{ "p": 0, "i": "z" }])),
    ];
    assert_eq!(doc.catch_up(&missed, &[me()]).unwrap().len(), 3);
    assert_eq!((doc.text(), doc.version()), ("zyxabc", 3));
    assert_eq!(doc.applied(&missed[0], &[me()]).unwrap(), Applied::Ignored);
    assert_eq!(
        doc.applied(&remote(3, json!([{ "p": 1, "d": "q" }])), &[me()]),
        Err(DocError::Codec(crate::live::format::CodecError::Mismatch))
    );
}

#[test]
fn a_fresh_rejoin_merges_unsent_work_or_keeps_both() {
    let start = Instant::now();
    let mut clean = doc("hello world");
    assert_eq!(
        clean.rejoin_fresh(9, "hello world!".into(), sharejs("hello world!")),
        Rejoin::Clean(insertion(11, 11, "!"))
    );
    assert_eq!((clean.text(), clean.version()), ("hello world!", 9));

    let mut merged = doc("hello world");
    type_at(&mut merged, 6, "brave ");
    let rejoin = merged.rejoin_fresh(9, "hello world!".into(), sharejs("hello world!"));
    assert_eq!(rejoin, Rejoin::Merged(insertion(17, 17, "!")));
    assert_eq!(merged.text(), "hello brave world!");
    let update = send(&mut merged, start);
    assert_eq!(
        (update.v, update.op.clone()),
        (9, json!([{ "p": 6, "i": "brave " }]))
    );

    let mut applied = doc("hello world");
    type_at(&mut applied, 6, "brave ");
    send(&mut applied, start);
    type_at(&mut applied, 0, "Oh, ");
    let rejoin = applied.rejoin_fresh(4, "hello brave world".into(), sharejs("hello brave world"));
    assert!(matches!(rejoin, Rejoin::Merged(ref op) if op.is_noop()));
    assert_eq!(applied.text(), "Oh, hello brave world");
    assert_eq!(
        send(&mut applied, start).op,
        json!([{ "p": 0, "i": "Oh, " }])
    );

    let mut conflict = doc("hello world");
    conflict.local(deletion(11, 6, 5)).unwrap();
    type_at(&mut conflict, 6, "there");
    let rejoin = conflict.rejoin_fresh(2, "hello WORLD".into(), sharejs("hello WORLD"));
    assert_eq!(
        rejoin,
        Rejoin::Conflict {
            mine: "hello there".into(),
            theirs: "hello WORLD".into()
        }
    );
    assert_eq!(conflict.text(), "hello WORLD");
    assert!(conflict.is_settled());
}
