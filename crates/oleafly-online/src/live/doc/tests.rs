use std::time::{Duration, Instant};

use oleafly_ot::testing::{deletion, insertion, Rng};
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::*;
use crate::live::format::{ChangeKind, Decision, DocFormat, FormatState};
use crate::live::harness::{Editor, Wire};
use crate::live::journal::DocRecord;
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
        ts: None,
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
        ts: None,
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

const T1: &str = "6b04e5f6c0ffee0010000001";
const T2: &str = "6b04e5f6c0ffee0011000001";

fn formats() -> [crate::test_support::mock_overleaf::DocFormat; 2] {
    [
        crate::test_support::mock_overleaf::DocFormat::ShareJs,
        crate::test_support::mock_overleaf::DocFormat::HistoryOt,
    ]
}

fn edit_as(user: &str) -> SendMode {
    SendMode::Review(Tracking {
        user_id: user.into(),
        ts: "2026-11-15T09:00:00.000Z".into(),
    })
}

fn settle_on(
    wire: &mut Wire,
    doc: &mut OverleafDoc,
    id: &str,
    mode: &SendMode,
    start: Instant,
) -> Vec<Value> {
    let mut sent = Vec::new();
    let mut now = start;
    for _ in 0..40 {
        let on = wire.public_id();
        if let Some(update) = doc.next_update(&on, mode, now).unwrap() {
            assert_strict_review(&update.payload());
            sent.push(update.payload());
            wire.send(&update);
        }
        for update in wire.incoming(id) {
            doc.applied(&update, &wire.own).unwrap();
        }
        if doc.is_settled() {
            return sent;
        }
        now += 6 * SECOND;
    }
    panic!("the doc never settled: {sent:?}");
}

fn assert_strict_review(update: &Value) {
    let op = update["op"].as_array().expect("op is a list");
    assert!(!op.is_empty(), "an empty op: {update}");
}

fn catch_up(wire: &mut Wire, doc: &mut OverleafDoc, id: &str) {
    for update in wire.incoming(id) {
        doc.applied(&update, &wire.own).unwrap();
    }
}

fn comment_of(doc: &OverleafDoc, thread: &str) -> CommentSpan {
    doc.review()
        .comments
        .into_iter()
        .find(|comment| comment.thread == thread)
        .unwrap_or_else(|| panic!("no comment {thread}"))
}

fn server_comment(mock: &MockOverleaf, id: &str, thread: &str, history_ot: bool) -> (usize, usize) {
    if history_ot {
        let raw = mock.raw_doc(id);
        let entry = raw["comments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|comment| comment["id"] == thread)
            .unwrap()
            .clone();
        let range = &entry["ranges"][0];
        let pos = range["pos"].as_u64().unwrap() as usize;
        (pos, pos + range["length"].as_u64().unwrap() as usize)
    } else {
        let ranges = mock.ranges(id);
        let entry = ranges["comments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|comment| comment["id"] == thread)
            .unwrap()
            .clone();
        let at = entry["op"]["p"].as_u64().unwrap() as usize;
        (
            at,
            at + entry["op"]["c"].as_str().unwrap().encode_utf16().count(),
        )
    }
}

#[tokio::test]
async fn a_comment_anchor_travels_alone_and_follows_a_concurrent_edit() {
    for format in formats() {
        let history_ot = format == crate::test_support::mock_overleaf::DocFormat::HistoryOt;
        let mock = MockOverleaf::start(project().format(format)).await;
        let id = mock.doc_id("main.tex");
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        let mut bob = mock.peer("bob");
        bob.join(&id);
        doc.queue_review(ReviewOp::Anchor {
            thread: T1.into(),
            ranges: vec![(6, 11)],
            ride: false,
        });
        let start = Instant::now();
        let update = doc
            .next_update(&wire.public_id(), &SendMode::Edit, start)
            .unwrap()
            .unwrap();
        let expected = if history_ot {
            json!([{ "commentId": T1, "ranges": [{ "pos": 6, "length": 5 }] }])
        } else {
            json!([{ "p": 6, "c": "world", "t": T1 }])
        };
        assert_eq!(update.op, expected, "{format:?}");
        assert_eq!(update.tc, None);
        bob.type_at(&id, 0, ">> ");
        wire.send(&update);
        catch_up(&mut wire, &mut doc, &id);
        assert!(doc.is_settled(), "{format:?}");
        assert_eq!(doc.text(), ">> Hello world\n");
        let comment = comment_of(&doc, T1);
        assert_eq!(
            (comment.ranges[0], comment.quote.as_str()),
            ((9, 14), "world"),
            "{format:?}"
        );
        assert_eq!(server_comment(&mock, &id, T1, history_ot), (9, 14));
        assert!(doc.take_reshaped());
        assert_eq!(doc.version(), mock.doc_version(&id));
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn a_viewer_sends_comment_anchors_but_never_text() {
    for format in formats() {
        let mock = MockOverleaf::start(project().format(format)).await;
        let id = mock.doc_id("main.tex");
        let mut wire = Wire::connect(&mock, "dave");
        let mut doc = wire.open(&id);
        let total = utf16_len(doc.text());
        doc.local(insertion(total, 0, "x")).unwrap();
        doc.queue_review(ReviewOp::Anchor {
            thread: T1.into(),
            ranges: vec![(1, 6)],
            ride: false,
        });
        let start = Instant::now();
        assert_eq!(
            doc.next_update(&wire.public_id(), &SendMode::Hold, start)
                .unwrap(),
            None,
            "{format:?}: the text unit is first and waits"
        );
        let mut viewer = wire.open(&id);
        viewer.queue_review(ReviewOp::Anchor {
            thread: T1.into(),
            ranges: vec![(0, 5)],
            ride: false,
        });
        let sent = settle_on(&mut wire, &mut viewer, &id, &SendMode::Hold, start);
        assert_eq!(sent.len(), 1, "{format:?}");
        assert!(sent[0].get("meta").is_none());
        assert_eq!(comment_of(&viewer, T1).quote, "Hello");
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn rejecting_a_tracked_insert_and_delete_sends_undo_pieces_and_shows_the_result() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_insert(&id, 6, "brave ");
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    bob.track_delete(&id, 0, 6);
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    assert_eq!(doc.text(), "brave world\n");
    let changes = doc.review().changes;
    assert_eq!(changes.len(), 2, "{changes:?}");
    let ids: Vec<String> = changes.iter().map(|change| change.id.clone()).collect();
    doc.queue_review(ReviewOp::Decide {
        changes: doc.targets(&ids).unwrap(),
        decision: Decision::Reject,
    });
    type_at(&mut doc, 12, "!");
    let start = Instant::now();
    let update = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(
        update.op,
        json!([{ "p": 0, "d": "brave ", "u": true }, { "p": 0, "i": "Hello ", "u": true }])
    );
    let shown = doc.take_shown();
    assert_eq!(shown.len(), 1);
    assert_eq!(doc.text(), "Hello world\n!");
    wire.send(&update);
    catch_up(&mut wire, &mut doc, &id);
    let sent = settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, start);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["op"], json!([{ "p": 12, "i": "!" }]));
    assert_eq!(mock.doc_text(&id), "Hello world\n!");
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert_eq!(mock.ranges(&id), json!({}));
    assert!(doc.review().changes.is_empty());
    wire.assert_healthy();
}

fn decide(doc: &mut OverleafDoc, ids: &[String], decision: Decision) {
    let changes = doc.targets(ids).unwrap();
    doc.queue_review(ReviewOp::Decide { changes, decision });
}

fn change_ids(doc: &OverleafDoc) -> Vec<String> {
    doc.review()
        .changes
        .into_iter()
        .map(|change| change.id)
        .collect()
}

fn replace_world(
    wire: &mut Wire,
    doc: &mut OverleafDoc,
    id: &str,
    mode: &SendMode,
    start: Instant,
) -> Vec<Value> {
    let mut op = TextOperation::new();
    op.retain(6).delete(5).insert("there").retain(1);
    doc.local(op).unwrap();
    settle_on(wire, doc, id, mode, start)
}

#[tokio::test]
async fn rejecting_both_halves_of_a_replacement_leaves_no_marker_in_either_format() {
    for format in formats() {
        for tracking in [false, true] {
            let history_ot = format == crate::test_support::mock_overleaf::DocFormat::HistoryOt;
            let mock = MockOverleaf::start(project().format(format)).await;
            let id = mock.doc_id("main.tex");
            let mut carol = Wire::connect(&mock, "erin");
            let mut theirs = carol.open(&id);
            let suggested = replace_world(
                &mut carol,
                &mut theirs,
                &id,
                &suggest(&mock.user("erin").id),
                Instant::now(),
            );
            if !history_ot {
                assert_eq!(
                    suggested[0]["op"],
                    json!([{ "p": 6, "d": "world" }, { "p": 6, "i": "there" }])
                );
            }
            let mut wire = Wire::connect(&mock, "alice");
            let mut doc = wire.open(&id);
            assert_eq!(doc.text(), "Hello there\n");
            let ids = change_ids(&doc);
            assert_eq!(ids.len(), 2, "{format:?}");
            decide(&mut doc, &ids, Decision::Reject);
            let mode = if tracking {
                suggest(&mock.user("alice").id)
            } else {
                SendMode::Edit
            };
            let sent = settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
            if history_ot {
                assert_eq!(
                    sent[0]["op"],
                    json!([{ "textOperation": [6, "world", -10, 1] }])
                );
                assert_eq!(mock.raw_doc(&id)["trackedChanges"], json!([]));
            } else {
                assert_eq!(
                    sent[0]["op"],
                    json!([{ "p": 6, "d": "there", "u": true }, { "p": 6, "i": "world", "u": true }])
                );
                assert_eq!(mock.ranges(&id), json!({}), "tracking {tracking}");
            }
            assert_eq!(sent.len(), 1, "{format:?}");
            assert_eq!(doc.text(), "Hello world\n");
            assert_eq!(mock.doc_text(&id), "Hello world\n");
            assert!(doc.review().changes.is_empty(), "{format:?}");
            assert!(doc.take_dropped().is_empty());
            wire.assert_healthy();
        }
    }
}

fn suggest_at_random(doc: &mut OverleafDoc, rng: &mut Rng, round: u64) {
    let text = doc.text().to_string();
    let from = rng.below(text.len() + 1);
    let to = (from + rng.below(4)).min(text.len());
    let mut op = Vec::new();
    if from < to {
        op.push(json!({ "p": from, "d": &text[from..to] }));
    }
    if rng.chance(70) {
        op.push(json!({ "p": from, "i": *rng.pick(&["X", "YZ"]) }));
    }
    let update = AppliedUpdate {
        user_id: Some((*rng.pick(&["carol", "erin"])).to_string()),
        tc: Some(format!("{round:018x}")),
        ..remote(doc.version(), Value::Array(op))
    };
    doc.applied(&update, &[me()]).unwrap();
}

fn reject_and_settle(doc: &mut OverleafDoc, ids: &[String], mode: &SendMode) {
    if ids.is_empty() {
        return;
    }
    decide(doc, ids, Decision::Reject);
    while doc
        .next_update(&me(), mode, Instant::now())
        .unwrap()
        .is_some()
    {
        doc.applied(&ack(doc.version()), &[me()]).unwrap();
    }
    assert!(doc.take_dropped().is_empty());
}

#[test]
fn rejecting_any_choice_of_suggestions_leaves_the_rest_able_to_restore_the_text() {
    let mut rng = Rng::new(0x501c);
    let hidden = |changes: &[ChangeSpan]| -> usize {
        changes
            .iter()
            .filter(|change| change.kind == ChangeKind::Delete)
            .map(|change| change.text.len())
            .sum()
    };
    for round in 0..3_000 {
        let base: String = (0..4 + rng.below(8))
            .map(|_| *rng.pick(&["a", "b", "c", "d"]))
            .collect();
        let mut doc = doc(&base);
        for step in 0..1 + rng.below(5) {
            suggest_at_random(&mut doc, &mut rng, step as u64);
        }
        let mode = if rng.chance(50) {
            suggest("alice")
        } else {
            SendMode::Edit
        };
        let before = doc.review().changes;
        let chosen: Vec<ChangeSpan> = before.iter().filter(|_| rng.chance(60)).cloned().collect();
        let ids: Vec<String> = chosen.iter().map(|change| change.id.clone()).collect();
        reject_and_settle(&mut doc, &ids, &mode);
        let after = doc.review().changes;
        assert_eq!(
            hidden(&after),
            hidden(&before) - hidden(&chosen),
            "round {round}: {before:?} without {ids:?} became {after:?}"
        );
        let left = change_ids(&doc);
        reject_and_settle(&mut doc, &left, &mode);
        assert_eq!(doc.text(), base, "round {round}: {before:?} {ids:?}");
        assert!(doc.review().changes.is_empty(), "round {round}");
    }
}

#[tokio::test]
async fn undoing_a_tracked_replacement_cancels_it_in_both_formats() {
    for format in formats() {
        let history_ot = format == crate::test_support::mock_overleaf::DocFormat::HistoryOt;
        let mock = MockOverleaf::start(project().format(format)).await;
        let id = mock.doc_id("main.tex");
        let mode = suggest(&mock.user("alice").id);
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        replace_world(&mut wire, &mut doc, &id, &mode, Instant::now());
        assert_eq!(doc.review().changes.len(), 2, "{format:?}");
        let mut undo = TextOperation::new();
        undo.retain(6).delete(5).insert("world").retain(1);
        doc.local_from(undo, Some(Origin::Undo)).unwrap();
        let sent = settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
        if history_ot {
            let tracked = mock.raw_doc(&id)["trackedChanges"].clone();
            assert_eq!(tracked.as_array().map(Vec::len), Some(1), "{tracked}");
            assert_eq!(tracked[0]["tracking"]["type"], "delete", "{tracked}");
            assert_eq!(tracked[0]["range"], json!({ "pos": 6, "length": 5 }));
        } else {
            assert_eq!(
                sent[0]["op"],
                json!([{ "p": 6, "d": "there", "u": true }, { "p": 6, "i": "world", "u": true }])
            );
            assert_eq!(mock.ranges(&id), json!({}));
            assert!(doc.review().changes.is_empty());
        }
        assert_eq!(doc.text(), "Hello world\n");
        assert_eq!(mock.doc_text(&id), "Hello world\n", "{format:?}");
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn rejecting_a_replacement_beside_another_tracked_delete_leaves_that_one_alone() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mode = suggest(&mock.user("erin").id);
    let mut carol = Wire::connect(&mock, "erin");
    let mut theirs = carol.open(&id);
    replace_world(&mut carol, &mut theirs, &id, &mode, Instant::now());
    theirs.local(deletion(12, 0, 6)).unwrap();
    settle_on(&mut carol, &mut theirs, &id, &mode, Instant::now());
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    assert_eq!(doc.text(), "there\n");
    let replacement: Vec<String> = doc
        .review()
        .changes
        .into_iter()
        .filter(|change| change.text != "Hello ")
        .map(|change| change.id)
        .collect();
    assert_eq!(replacement.len(), 2);
    decide(&mut doc, &replacement, Decision::Reject);
    let sent = settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, Instant::now());
    let ops: Vec<&Value> = sent.iter().map(|update| &update["op"]).collect();
    assert_eq!(
        ops,
        [
            &json!([{ "p": 5, "i": "world", "u": true }]),
            &json!([{ "p": 0, "d": "there", "u": true }]),
        ]
    );
    assert_eq!(mock.doc_text(&id), "world\n");
    assert_eq!(doc.text(), "world\n");
    let left = doc.review().changes;
    assert_eq!(left.len(), 1, "{left:?}");
    assert_eq!((left[0].from, left[0].text.as_str()), (0, "Hello "));
    assert!(doc.take_dropped().is_empty());
    let last = change_ids(&doc);
    decide(&mut doc, &last, Decision::Reject);
    settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, Instant::now());
    assert_eq!(mock.doc_text(&id), "Hello world\n");
    assert_eq!(mock.ranges(&id), json!({}));
    wire.assert_healthy();
}

fn applied_until_out_of_step(wire: &mut Wire, doc: &mut OverleafDoc, id: &str) -> bool {
    for update in wire.incoming(id) {
        match doc.applied(&update, &wire.own) {
            Ok(_) => {}
            Err(DocError::OutOfStep) => return true,
            Err(error) => panic!("{error} on {update:?}"),
        }
    }
    false
}

#[tokio::test]
async fn a_rejected_deletion_a_concurrent_edit_transformed_is_repaired_after_the_rejoin() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_delete(&id, 0, 6);
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    assert_eq!(doc.text(), "world\n");
    let marker = doc.review().changes[0].id.clone();
    doc.queue_review(ReviewOp::Decide {
        changes: doc.targets(std::slice::from_ref(&marker)).unwrap(),
        decision: Decision::Reject,
    });
    bob.type_at(&id, 6, "!");
    bob.sync();
    let start = Instant::now();
    let update = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(update.op, json!([{ "p": 0, "i": "Hello ", "u": true }]));
    assert_eq!(doc.text(), "Hello world\n");
    wire.send(&update);
    assert!(applied_until_out_of_step(&mut wire, &mut doc, &id));
    assert_eq!(mock.doc_text(&id), "Hello world\n!");
    assert_eq!(
        mock.ranges(&id)["changes"][0]["op"],
        json!({ "p": 6, "d": "Hello " }),
        "the server lost the u and kept the marker"
    );
    let fresh = wire.join(&id, None).unwrap();
    let rejoin = doc.rejoin_fresh(fresh.version, fresh.text, fresh.format);
    assert!(
        matches!(&rejoin, Rejoin::Clean(op) if op.is_noop()),
        "{rejoin:?}"
    );
    let sent = settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, start);
    assert_eq!(
        sent[0]["op"],
        json!([{ "p": 6, "i": "Hello ", "u": true }, { "p": 6, "d": "Hello " }])
    );
    assert_eq!(mock.doc_text(&id), "Hello world\n!");
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert_eq!(mock.ranges(&id), json!({}));
    assert!(doc.review().changes.is_empty());
    assert!(doc.take_dropped().is_empty());
    let again = doc.next_update(&wire.public_id(), &SendMode::Edit, start + 60 * SECOND);
    assert_eq!(again, Ok(None));
    wire.assert_healthy();
}

#[tokio::test]
async fn a_reject_or_accept_the_server_never_took_is_reported_and_never_replayed_as_text() {
    for decision in [Decision::Reject, Decision::Accept] {
        let mock = MockOverleaf::start(project()).await;
        let id = mock.doc_id("main.tex");
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        let mut bob = mock.peer("bob");
        bob.join(&id);
        bob.track_delete(&id, 0, 6);
        bob.sync();
        catch_up(&mut wire, &mut doc, &id);
        let marker = doc.review().changes[0].id.clone();
        doc.queue_review(ReviewOp::Decide {
            changes: doc.targets(std::slice::from_ref(&marker)).unwrap(),
            decision,
        });
        let start = Instant::now();
        let lost = doc
            .next_update(&wire.public_id(), &SendMode::Edit, start)
            .unwrap()
            .unwrap();
        assert!(
            lost.op[0]["u"] == json!(true),
            "{decision:?}: {:?}",
            lost.op
        );
        bob.type_at(&id, 6, "!");
        bob.sync();
        catch_up(&mut wire, &mut doc, &id);
        assert!(doc.clashed(), "{decision:?}");
        wire.reconnect(&mock, "alice");
        let joined = wire.join(&id, Some(doc.version())).unwrap();
        assert!(doc.catch_up(&joined.updates, &wire.own).unwrap().is_empty());
        assert_eq!(
            doc.next_update(&wire.public_id(), &SendMode::Edit, start + SECOND),
            Err(DocError::OutOfStep),
            "{decision:?}"
        );
        let fresh = wire.join(&id, None).unwrap();
        let rejoin = doc.rejoin_fresh(fresh.version, fresh.text, fresh.format);
        assert!(
            matches!(rejoin, Rejoin::Clean(_)),
            "{decision:?}: {rejoin:?}"
        );
        assert_eq!(doc.text(), "world\n!", "{decision:?}");
        assert!(doc.is_settled(), "{decision:?}: nothing is replayed");
        let dropped = doc.take_dropped();
        let ids: Vec<(String, Decision)> = dropped
            .iter()
            .filter_map(|review| match review {
                ReviewOp::Decide { changes, decision } => {
                    Some((changes.first()?.id.clone(), *decision))
                }
                _ => None,
            })
            .collect();
        assert_eq!(ids, [(marker.clone(), decision)]);
        assert_eq!(mock.doc_text(&id), "world\n!");
        assert_eq!(doc.review().changes.len(), 1, "{decision:?}");
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn accepting_sharejs_changes_by_ops_keeps_the_text_the_other_marks_and_the_comments() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_insert(&id, 6, "brave ");
    bob.track_delete(&id, 12, 5);
    bob.track_delete(&id, 5, 1);
    bob.comment(&id, 5, 5, T1);
    bob.comment(&id, 3, 4, T2);
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    assert_eq!(doc.text(), "Hellobrave \n");
    let changes = doc.review().changes;
    assert_eq!(changes.len(), 3, "{changes:?}");
    let inserted = changes
        .iter()
        .find(|change| change.kind == ChangeKind::Insert)
        .unwrap();
    let world = changes
        .iter()
        .find(|change| change.text == "world")
        .unwrap();
    let accepted = doc
        .targets(&[inserted.id.clone(), world.id.clone()])
        .unwrap();
    let mut reviewer = doc.clone();
    reviewer.queue_review(ReviewOp::Decide {
        changes: accepted.clone(),
        decision: Decision::Accept,
    });
    assert_eq!(
        reviewer
            .next_update(&wire.public_id(), &edit_as("carol"), Instant::now())
            .unwrap(),
        None
    );
    assert_eq!(reviewer.take_dropped().len(), 1);
    doc.queue_review(ReviewOp::Decide {
        changes: accepted,
        decision: Decision::Accept,
    });
    let start = Instant::now();
    let update = doc
        .next_update(&wire.public_id(), &suggest("alice"), start)
        .unwrap()
        .unwrap();
    assert_eq!(update.tc, None);
    assert_eq!(
        update.op,
        json!([
            { "p": 11, "i": "world", "u": true },
            { "p": 11, "d": "world" },
            { "p": 11, "i": "brave " },
            { "p": 5, "d": "brave " },
            { "p": 5, "c": "brave", "t": T1 },
            { "p": 3, "c": "lobr", "t": T2 },
        ])
    );
    assert!(doc.take_shown().is_empty());
    wire.send(&update);
    catch_up(&mut wire, &mut doc, &id);
    assert!(doc.is_settled());
    assert_eq!(doc.text(), "Hellobrave \n");
    assert_eq!(mock.doc_text(&id), "Hellobrave \n");
    let left = doc.review().changes;
    assert_eq!(left.len(), 1, "{left:?}");
    assert_eq!(
        (left[0].kind, left[0].from, left[0].text.as_str()),
        (ChangeKind::Delete, 5, " ")
    );
    assert_eq!(server_comment(&mock, &id, T1, false), (5, 10));
    assert_eq!(server_comment(&mock, &id, T2, false), (3, 7));
    assert_eq!(comment_of(&doc, T1).quote, "brave");
    assert_eq!(comment_of(&doc, T2).quote, "lobr");
    assert_eq!(doc.version(), mock.doc_version(&id));
    wire.assert_healthy();
}

#[test]
fn an_accept_that_a_concurrent_edit_lands_inside_rejoins_instead_of_guessing() {
    let ranges = json!({
        "changes": [{
            "id": "6b04e1bac0ffee0006000001",
            "op": { "p": 6, "i": "brave " },
            "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
        }],
    });
    let text = "Hello brave world\n";
    let joined = |text: &str| {
        let (text, format) =
            FormatState::from_join(DocFormat::ShareJs, &json!([text]), &ranges).unwrap();
        OverleafDoc::joined(DocId("doc".into()), 0, text, format)
    };
    for (remote_op, clashes, after) in [
        (
            json!([{ "p": 0, "i": ">> " }]),
            false,
            ">> Hello brave world\n",
        ),
        (
            json!([{ "p": 17, "i": "!" }]),
            false,
            "Hello brave world!\n",
        ),
        (json!([{ "p": 8, "i": "X" }]), true, "Hello brXave world\n"),
        (json!([{ "p": 12, "i": "Y" }]), true, "Hello brave Yworld\n"),
    ] {
        let mut doc = joined(text);
        let targets = doc.targets(&["6b04e1bac0ffee0006000001".into()]).unwrap();
        doc.queue_review(ReviewOp::Decide {
            changes: targets,
            decision: Decision::Accept,
        });
        let sent = send(&mut doc, Instant::now());
        assert_eq!(
            sent.op,
            json!([{ "p": 12, "i": "brave " }, { "p": 6, "d": "brave " }])
        );
        assert!(matches!(
            doc.applied(&remote(0, remote_op.clone()), &[me()]),
            Ok(Applied::Remote(_))
        ));
        assert_eq!(doc.text(), after, "{remote_op}");
        let acked = doc.applied(&ack(1), &[me()]);
        if clashes {
            assert_eq!(acked, Err(DocError::OutOfStep), "{remote_op}");
        } else {
            assert_eq!(acked, Ok(Applied::Acknowledged), "{remote_op}");
            assert!(doc.review().changes.is_empty(), "{remote_op}");
            assert_eq!(doc.text(), after);
        }
    }
}

#[tokio::test]
async fn a_reviewer_withdraws_only_their_own_suggestions() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let carol = mock.user("carol").id;
    let mut wire = Wire::connect(&mock, "carol");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_insert(&id, 0, "Bob ");
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    let total = utf16_len(doc.text());
    doc.local(insertion(total, total, " mine")).unwrap();
    let mode = edit_as(&carol);
    settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
    let changes = doc.review().changes;
    assert_eq!(changes.len(), 2);
    doc.queue_review(ReviewOp::Decide {
        changes: changes.iter().map(Target::of).collect(),
        decision: Decision::Reject,
    });
    let sent = settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["op"], json!([{ "p": 16, "d": " mine", "u": true }]));
    assert!(sent[0]["meta"]["tc"].is_string(), "{}", sent[0]);
    assert_eq!(mock.doc_text(&id), "Bob Hello world\n");
    let left = doc.review().changes;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].user, Some(mock.user("bob").id));
    wire.assert_healthy();
}

#[tokio::test]
async fn history_ot_accept_and_reject_are_raw_ops_and_reviewers_cannot_send_them() {
    let mock = MockOverleaf::start(
        project().format(crate::test_support::mock_overleaf::DocFormat::HistoryOt),
    )
    .await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_insert(&id, 6, "brave ");
    bob.track_delete(&id, 0, 6);
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    assert_eq!(doc.text(), "brave world\n");
    let changes = doc.review().changes;
    assert_eq!(changes.len(), 2, "{changes:?}");
    let deleted = changes
        .iter()
        .find(|change| change.kind == ChangeKind::Delete)
        .unwrap()
        .id
        .clone();
    let inserted = changes
        .iter()
        .find(|change| change.kind == ChangeKind::Insert)
        .unwrap()
        .id
        .clone();
    let mut reviewer = doc.clone();
    reviewer.queue_review(ReviewOp::Decide {
        changes: reviewer.targets(std::slice::from_ref(&inserted)).unwrap(),
        decision: Decision::Accept,
    });
    assert_eq!(
        reviewer
            .next_update(&wire.public_id(), &edit_as("carol"), Instant::now())
            .unwrap(),
        None
    );
    assert_eq!(reviewer.take_dropped().len(), 1);
    let accepted = doc.targets(&[inserted]).unwrap();
    let rejected = doc.targets(&[deleted]).unwrap();
    doc.queue_review(ReviewOp::Decide {
        changes: accepted,
        decision: Decision::Accept,
    });
    doc.queue_review(ReviewOp::Decide {
        changes: rejected,
        decision: Decision::Reject,
    });
    let sent = settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, Instant::now());
    assert_eq!(
        sent[0]["op"],
        json!([{ "textOperation": [6, { "r": 6, "tracking": { "type": "none" } }, 6] }])
    );
    assert_eq!(
        sent[1]["op"],
        json!([{ "textOperation": ["Hello ", -6, 12] }])
    );
    assert_eq!(doc.text(), "Hello brave world\n");
    assert_eq!(doc.take_shown().len(), 2);
    assert_eq!(mock.doc_text(&id), "Hello brave world\n");
    assert_eq!(mock.raw_doc(&id)["trackedChanges"], json!([]));
    wire.assert_healthy();
}

#[tokio::test]
async fn undoing_your_own_tracked_delete_cancels_it_in_both_formats() {
    for format in formats() {
        let history_ot = format == crate::test_support::mock_overleaf::DocFormat::HistoryOt;
        let mock = MockOverleaf::start(project().format(format)).await;
        let id = mock.doc_id("main.tex");
        let alice = mock.user("alice").id;
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        let mode = suggest(&alice);
        doc.local(deletion(12, 6, 5)).unwrap();
        settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
        assert_eq!(doc.review().changes.len(), 1, "{format:?}");
        doc.local_from(insertion(7, 6, "world"), Some(Origin::Undo))
            .unwrap();
        let sent = settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
        if history_ot {
            assert_eq!(
                sent[0]["op"],
                json!([{ "textOperation": [6, "world", -5, 1] }]),
                "{format:?}"
            );
            assert_eq!(mock.raw_doc(&id)["trackedChanges"], json!([]));
        } else {
            assert_eq!(sent[0]["op"], json!([{ "p": 6, "i": "world", "u": true }]));
            assert_eq!(mock.ranges(&id), json!({}));
        }
        assert_eq!(doc.text(), "Hello world\n");
        assert!(doc.review().changes.is_empty(), "{format:?}");
        assert_eq!(mock.doc_text(&id), "Hello world\n");
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn cut_and_paste_carries_the_comment_with_the_text() {
    for format in formats() {
        let history_ot = format == crate::test_support::mock_overleaf::DocFormat::HistoryOt;
        let mock = MockOverleaf::start(project().format(format)).await;
        let id = mock.doc_id("main.tex");
        let mut wire = Wire::connect(&mock, "alice");
        let mut doc = wire.open(&id);
        let mut bob = mock.peer("bob");
        bob.join(&id);
        bob.comment(&id, 6, 5, T2);
        bob.sync();
        catch_up(&mut wire, &mut doc, &id);
        assert_eq!(comment_of(&doc, T2).quote, "world");
        doc.local_from(deletion(12, 5, 6), Some(Origin::Cut))
            .unwrap();
        settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, Instant::now());
        let detached = comment_of(&doc, T2).ranges.clone();
        assert!(
            detached.iter().all(|(from, to)| from == to),
            "{format:?}: {detached:?}"
        );
        doc.local_from(insertion(6, 0, " world"), Some(Origin::Paste))
            .unwrap();
        let sent = settle_on(&mut wire, &mut doc, &id, &SendMode::Edit, Instant::now());
        assert_eq!(sent.len(), 1, "{format:?}: {sent:?}");
        if history_ot {
            assert_eq!(
                sent[0]["op"],
                json!([
                    { "textOperation": [" world", 6] },
                    { "commentId": T2, "ranges": [{ "pos": 1, "length": 5 }] },
                ])
            );
        } else {
            assert_eq!(
                sent[0]["op"],
                json!([{ "p": 0, "i": " world" }, { "p": 1, "c": "world", "t": T2 }])
            );
        }
        assert_eq!(doc.text(), " worldHello\n");
        assert_eq!(comment_of(&doc, T2).ranges[0], (1, 6), "{format:?}");
        assert_eq!(server_comment(&mock, &id, T2, history_ot), (1, 6));
        wire.assert_healthy();
    }
}

#[tokio::test]
async fn a_reviewer_restores_a_history_ot_comment_in_its_own_update() {
    let mock = MockOverleaf::start(
        project().format(crate::test_support::mock_overleaf::DocFormat::HistoryOt),
    )
    .await;
    let id = mock.doc_id("main.tex");
    let carol = mock.user("carol").id;
    let mut wire = Wire::connect(&mock, "carol");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.comment(&id, 6, 5, T2);
    bob.sync();
    catch_up(&mut wire, &mut doc, &id);
    let mode = edit_as(&carol);
    doc.local_from(deletion(12, 5, 6), Some(Origin::Cut))
        .unwrap();
    settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
    assert_eq!(doc.text(), "Hello\n");
    doc.local_from(insertion(6, 0, " world"), Some(Origin::Paste))
        .unwrap();
    let sent = settle_on(&mut wire, &mut doc, &id, &mode, Instant::now());
    assert_eq!(sent.len(), 2, "{sent:?}");
    assert!(sent[0]["op"][0]["textOperation"].is_array(), "{sent:?}");
    assert_eq!(sent[1]["op"][0]["commentId"], T2, "{sent:?}");
    assert_eq!(comment_of(&doc, T2).quote, "world");
    wire.assert_healthy();
}

#[test]
fn a_comment_inflight_and_queued_review_units_survive_the_journal() {
    let start = Instant::now();
    let mut doc = doc("Hello world\n");
    doc.queue_review(ReviewOp::Anchor {
        thread: T1.into(),
        ranges: vec![(6, 11)],
        ride: false,
    });
    doc.queue_review(ReviewOp::Decide {
        changes: vec![target("c1")],
        decision: Decision::Reject,
    });
    let update = send(&mut doc, start);
    assert_eq!(update.op, json!([{ "p": 6, "c": "world", "t": T1 }]));
    type_at(&mut doc, 0, ">> ");
    let record = doc.record().unwrap();
    assert_eq!(record.inflight.as_ref().unwrap().comments.len(), 1);
    assert_eq!(
        record.queued,
        vec![ReviewOp::Decide {
            changes: vec![Target {
                at: 9,
                ..target("c1")
            }],
            decision: Decision::Reject,
        }]
    );
    let text = serde_json::to_string(&record).unwrap();
    let back: DocRecord = serde_json::from_str(&text).unwrap();
    assert_eq!(back, record);
    let mut resumed = OverleafDoc::resume(DocId("doc".into()), &back, start).unwrap();
    assert_eq!(resumed.text(), ">> Hello world\n");
    let fresh = PublicId("P.fresh".into());
    let again = resumed
        .next_update(&fresh, &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(again.op, json!([{ "p": 6, "c": "world", "t": T1 }]));
    assert_eq!(again.dup_if_source, vec![me()]);
    let plain: DocRecord =
        serde_json::from_str(&serde_json::to_string(&doc_record_without_review()).unwrap())
            .unwrap();
    assert!(plain.queued.is_empty());
    assert!(!serde_json::to_string(&plain).unwrap().contains("queued"));
}

fn target(id: &str) -> Target {
    Target {
        id: id.into(),
        kind: ChangeKind::Insert,
        at: 6,
        text: "world".into(),
        user: None,
    }
}

fn doc_record_without_review() -> DocRecord {
    let mut doc = doc("abc");
    type_at(&mut doc, 0, "x");
    doc.record().unwrap()
}

#[test]
fn an_anchor_whose_text_is_gone_is_dropped_and_reported() {
    let start = Instant::now();
    let mut doc = doc("Hello world\n");
    type_at(&mut doc, 0, ">");
    let first = send(&mut doc, start);
    assert_eq!(first.op, json!([{ "p": 0, "i": ">" }]));
    doc.queue_review(ReviewOp::Anchor {
        thread: T1.into(),
        ranges: vec![(7, 12)],
        ride: false,
    });
    doc.applied(&remote(0, json!([{ "p": 5, "d": " world" }])), &[me()])
        .unwrap();
    doc.applied(&ack(1), &[me()]).unwrap();
    assert_eq!(doc.text(), ">Hello\n");
    assert_eq!(
        doc.next_update(&me(), &SendMode::Edit, start).unwrap(),
        None
    );
    assert!(doc.is_settled());
    assert_eq!(
        doc.take_dropped(),
        vec![ReviewOp::Anchor {
            thread: T1.into(),
            ranges: vec![(6, 6)],
            ride: false,
        }]
    );
}

#[test]
fn an_accept_is_never_resent_once_the_server_may_have_changed_it() {
    let ranges = json!({
        "changes": [
            {
                "id": "6b04e1bac0ffee0006000001",
                "op": { "p": 6, "i": "brave " },
                "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
            },
            {
                "id": "6b04e1bac0ffee0007000001",
                "op": { "p": 12, "d": "old " },
                "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
            },
        ],
    });
    let joined = || {
        let (text, format) =
            FormatState::from_join(DocFormat::ShareJs, &json!(["Hello brave world\n"]), &ranges)
                .unwrap();
        OverleafDoc::joined(DocId("doc".into()), 0, text, format)
    };
    let accept = |doc: &mut OverleafDoc, id: &str| {
        let targets = doc.targets(&[id.to_string()]).unwrap();
        doc.queue_review(ReviewOp::Decide {
            changes: targets,
            decision: Decision::Accept,
        });
    };
    let start = Instant::now();
    let mut far = joined();
    accept(&mut far, "6b04e1bac0ffee0007000001");
    let sent = send(&mut far, start);
    assert_eq!(
        sent.op,
        json!([{ "p": 12, "i": "old ", "u": true }, { "p": 12, "d": "old " }])
    );
    far.applied(&remote(0, json!([{ "p": 0, "i": ">" }])), &[me()])
        .unwrap();
    assert!(far.clashed(), "a transformed re-insert loses its u");
    assert_eq!(far.applied(&ack(1), &[me()]), Err(DocError::OutOfStep));
    let mut late = joined();
    accept(&mut late, "6b04e1bac0ffee0006000001");
    send(&mut late, start);
    late.applied(&remote(0, json!([{ "p": 8, "i": "X" }])), &[me()])
        .unwrap();
    assert_eq!(
        late.next_update(&me(), &SendMode::Edit, start + 6 * SECOND),
        Err(DocError::OutOfStep)
    );
    let mut moved = joined();
    accept(&mut moved, "6b04e1bac0ffee0006000001");
    send(&mut moved, start);
    assert_eq!(
        moved.next_update(&PublicId("P.again".into()), &SendMode::Edit, start + SECOND),
        Err(DocError::OutOfStep)
    );
    let mut quiet = joined();
    accept(&mut quiet, "6b04e1bac0ffee0006000001");
    let first = send(&mut quiet, start);
    let again = quiet
        .next_update(&me(), &SendMode::Edit, start + 6 * SECOND)
        .unwrap()
        .unwrap();
    assert_eq!(again.op, first.op);
    assert_eq!(again.dup_if_source, vec![me()]);
}

#[test]
fn a_clashed_undo_keeps_its_sources_until_its_ack_and_only_then_rejoins() {
    let marked = |text: &str, at: usize| {
        let ranges = json!({
            "changes": [{
                "id": "6b04e1bac0ffee0006000001",
                "op": { "p": at, "d": "world" },
                "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
            }],
        });
        FormatState::from_join(DocFormat::ShareJs, &json!([text]), &ranges).unwrap()
    };
    let start = Instant::now();
    let (text, format) = marked("Hello \n", 6);
    let mut doc = OverleafDoc::joined(DocId("doc".into()), 0, text, format);
    doc.local_from(insertion(7, 6, "world"), Some(Origin::Undo))
        .unwrap();
    let sent = send(&mut doc, start);
    assert_eq!(sent.op, json!([{ "p": 6, "i": "world", "u": true }]));
    doc.applied(&remote(0, json!([{ "p": 0, "i": ">> " }])), &[me()])
        .unwrap();
    assert!(doc.clashed());
    let mut elsewhere = doc.clone();
    assert_eq!(
        elsewhere.next_update(&PublicId("P.again".into()), &SendMode::Edit, start),
        Err(DocError::OutOfStep)
    );
    for round in 1..3 {
        let again = doc
            .next_update(&me(), &SendMode::Edit, start + round * 6 * SECOND)
            .unwrap()
            .expect("the same op again");
        assert_eq!(again.op, json!([{ "p": 9, "i": "world", "u": true }]));
        assert_eq!((again.v, again.dup_if_source), (1, vec![me()]));
        assert!(doc.clashed(), "the first copy may still land without its u");
    }
    assert_eq!(doc.applied(&ack(1), &[me()]), Err(DocError::OutOfStep));
    assert!(doc.needs_rejoin());
    let (text, format) = marked(">> Hello world\n", 14);
    let rejoin = doc.rejoin_fresh(2, text, format);
    assert!(
        matches!(&rejoin, Rejoin::Clean(op) if op.is_noop()),
        "{rejoin:?}"
    );
    assert_eq!(doc.text(), ">> Hello world\n");
    let repair = send(&mut doc, start + 60 * SECOND);
    assert_eq!(
        repair.op,
        json!([{ "p": 14, "i": "world", "u": true }, { "p": 14, "d": "world" }])
    );
}

fn two_alike() -> OverleafDoc {
    let change = |id: &str, at: usize| json!({ "id": id, "op": { "p": at, "i": "foo" }, "metadata": { "user_id": "carol", "ts": "2026-11-15T09:00:00.000Z" } });
    let (text, format) = FormatState::from_join(
        DocFormat::ShareJs,
        &json!(["foo bar foo\n"]),
        &json!({ "changes": [change("first", 0), change("second", 8)] }),
    )
    .unwrap();
    OverleafDoc::joined(DocId("doc".into()), 0, text, format)
}

fn two_alike_in_history_ot() -> OverleafDoc {
    let tracked = |at: usize, ts: &str| json!({ "range": { "pos": at, "length": 3 }, "tracking": { "type": "insert", "userId": "carol", "ts": ts } });
    let raw = json!({
        "content": "foo bar foo\n",
        "trackedChanges": [
            tracked(0, "2026-11-15T09:00:00.000Z"),
            tracked(8, "2026-11-15T09:30:00.000Z"),
        ],
    });
    let (text, format) = FormatState::from_join(DocFormat::HistoryOt, &raw, &Value::Null).unwrap();
    OverleafDoc::joined(DocId("doc".into()), 0, text, format)
}

fn dropped_targets(doc: &mut OverleafDoc) -> Vec<(usize, String)> {
    doc.take_dropped()
        .into_iter()
        .flat_map(|review| match review {
            ReviewOp::Decide { changes, .. } => changes,
            _ => Vec::new(),
        })
        .map(|target| (target.at, target.text))
        .collect()
}

#[test]
fn a_decision_whose_change_is_gone_never_falls_on_one_that_looks_the_same() {
    let start = Instant::now();
    let mut gone = two_alike();
    decide(&mut gone, &["first".into()], Decision::Reject);
    assert_eq!(gone.accept_locally(&["first".into()]), 1);
    assert_eq!(gone.next_update(&me(), &SendMode::Edit, start), Ok(None));
    assert_eq!(gone.text(), "foo bar foo\n");
    assert_eq!(dropped_targets(&mut gone), [(0, "foo".to_string())]);

    let mut half = two_alike();
    decide(
        &mut half,
        &["first".into(), "second".into()],
        Decision::Reject,
    );
    assert_eq!(half.accept_locally(&["first".into()]), 1);
    let sent = send(&mut half, start);
    assert_eq!(sent.op, json!([{ "p": 8, "d": "foo", "u": true }]));
    assert_eq!(dropped_targets(&mut half), [(0, "foo".to_string())]);

    for decision in [Decision::Accept, Decision::Reject] {
        let mut raw = two_alike_in_history_ot();
        let first = change_ids(&raw)[0].clone();
        decide(&mut raw, &[first], decision);
        let accepted =
            json!([{ "textOperation": [{ "r": 3, "tracking": { "type": "none" } }, 9] }]);
        raw.applied(&remote(0, accepted), &[me()]).unwrap();
        assert_eq!(raw.next_update(&me(), &SendMode::Edit, start), Ok(None));
        assert_eq!(raw.text(), "foo bar foo\n");
        assert_eq!(raw.review().changes.len(), 1, "{decision:?}");
        assert_eq!(dropped_targets(&mut raw), [(0, "foo".to_string())]);
    }
}

#[test]
fn a_decision_follows_its_change_when_the_text_before_it_moves() {
    let start = Instant::now();
    let mut raw = two_alike_in_history_ot();
    let second = change_ids(&raw)[1].clone();
    type_at(&mut raw, 0, "> ");
    decide(&mut raw, &[second], Decision::Reject);
    send(&mut raw, start);
    raw.applied(
        &remote(0, json!([{ "textOperation": [4, "big ", 8] }])),
        &[me()],
    )
    .unwrap();
    raw.applied(&ack(0), &[me()]).unwrap();
    assert_eq!(raw.text(), "> foo big bar foo\n");
    let sent = send(&mut raw, start);
    assert_eq!(sent.op, json!([{ "textOperation": [14, -3, 1] }]));
    assert!(raw.take_dropped().is_empty());

    let mut split = two_alike();
    split
        .applied(&remote(0, json!([{ "p": 1, "i": "-" }])), &[me()])
        .unwrap();
    let unnamed = split
        .review()
        .changes
        .into_iter()
        .find(|change| change.text == "oo")
        .unwrap();
    assert!(unnamed.id.starts_with(LOCAL_CHANGE), "{}", unnamed.id);
    decide(
        &mut split,
        std::slice::from_ref(&unnamed.id),
        Decision::Reject,
    );
    let FormatState::ShareJs(ranges) = split.format() else {
        panic!("a ShareJS doc");
    };
    let mut named = ranges.to_json(true);
    for change in named["changes"].as_array_mut().unwrap() {
        if change.get("id").is_none() {
            change["id"] = json!("third");
        }
    }
    let fresh = FormatState::from_join(DocFormat::ShareJs, &json!(["f-oo bar foo\n"]), &named)
        .unwrap()
        .1;
    assert!(split.adopt_ranges(1, &fresh));
    let sent = send(&mut split, start);
    assert_eq!(sent.op, json!([{ "p": 2, "d": "oo", "u": true }]));
    assert!(split.take_dropped().is_empty());
}

#[test]
fn a_rejoin_conflict_keeps_the_queued_review_units_and_the_reserved_selections() {
    let start = Instant::now();
    let ranges = json!({
        "changes": [{
            "id": "6b04e1bac0ffee0006000001",
            "op": { "p": 16, "i": "tail" },
            "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
        }],
    });
    let state =
        |text: &str| FormatState::from_join(DocFormat::ShareJs, &json!([text]), &ranges).unwrap();
    let (text, format) = state("Hello world and tail\n");
    let mut doc = OverleafDoc::joined(DocId("doc".into()), 0, text, format);
    let mut mine = TextOperation::new();
    mine.retain(6).delete(5).insert("there").retain(10);
    doc.local(mine).unwrap();
    doc.queue_review(ReviewOp::Anchor {
        thread: T1.into(),
        ranges: vec![(12, 15)],
        ride: false,
    });
    decide(
        &mut doc,
        &["6b04e1bac0ffee0006000001".into()],
        Decision::Reject,
    );
    let reserved = doc.mark(vec![(0, 5)]);
    let (text, format) = state("Hello earth and tail\n");
    assert!(matches!(
        doc.rejoin_fresh(4, text, format),
        Rejoin::Conflict { .. }
    ));
    assert_eq!(doc.text(), "Hello earth and tail\n");
    assert_eq!(doc.unmark(reserved), Some(vec![(0, 5)]));
    let sent = send(&mut doc, start);
    assert_eq!(sent.op, json!([{ "p": 12, "c": "and", "t": T1 }]));
    doc.applied(&ack(4), &[me()]).unwrap();
    let sent = send(&mut doc, start);
    assert_eq!(sent.op, json!([{ "p": 16, "d": "tail", "u": true }]));
    doc.applied(&ack(5), &[me()]).unwrap();
    assert!(doc.is_settled());
    assert!(doc.take_dropped().is_empty());
}

#[test]
fn an_ack_whose_ranges_do_not_fit_rejoins_with_the_op_known_to_have_landed() {
    let start = Instant::now();
    let mut doc = doc("Hello world\n");
    let mut mine = TextOperation::new();
    mine.delete(5).insert("Howdy").retain(7);
    doc.local(mine).unwrap();
    send(&mut doc, start);
    let wrong = json!({ "comments": [{ "id": T1, "op": { "c": "wrong", "p": 0, "t": T1 } }] });
    let fresh = FormatState::from_join(DocFormat::ShareJs, &json!(["Hello world\n"]), &wrong)
        .unwrap()
        .1;
    assert!(doc.adopt_ranges(0, &fresh));
    assert_eq!(doc.applied(&ack(0), &[me()]), Err(DocError::OutOfStep));
    assert!(doc.needs_rejoin());
    let text = "Howdy, big world\n";
    let rejoin = doc.rejoin_fresh(2, text.to_string(), sharejs(text));
    assert!(matches!(rejoin, Rejoin::Clean(_)), "{rejoin:?}");
    assert_eq!(doc.text(), text);
    assert!(doc.is_settled());
}

#[test]
fn a_rejected_deletion_cut_off_by_a_kill_is_reported_and_never_replayed_as_text() {
    let start = Instant::now();
    let ranges = json!({
        "changes": [{
            "id": "6b04e1bac0ffee0007000001",
            "op": { "p": 6, "d": "big " },
            "metadata": { "user_id": "bob", "ts": "2026-11-15T09:00:00.000Z" },
        }],
    });
    let state =
        |text: &str| FormatState::from_join(DocFormat::ShareJs, &json!([text]), &ranges).unwrap();
    let (text, format) = state("Hello world\n");
    let mut doc = OverleafDoc::joined(DocId("doc".into()), 0, text, format);
    decide(
        &mut doc,
        &["6b04e1bac0ffee0007000001".into()],
        Decision::Reject,
    );
    send(&mut doc, start);
    assert_eq!(doc.text(), "Hello big world\n");
    let saved = serde_json::to_value(doc.record().unwrap()).unwrap();
    let record: DocRecord = serde_json::from_value(saved.clone()).unwrap();
    let mut resumed = OverleafDoc::resume(DocId("doc".into()), &record, start).unwrap();
    let (text, format) = state("Hello world!\n");
    let rejoin = resumed.rejoin_fresh(90, text, format);
    assert!(matches!(rejoin, Rejoin::Clean(_)), "{rejoin:?}");
    assert_eq!(resumed.text(), "Hello world!\n");
    assert!(resumed.is_settled(), "nothing is replayed");
    assert_eq!(dropped_targets(&mut resumed), [(6, "big ".to_string())]);

    let mut older = saved;
    assert!(older["inflight"]
        .as_object_mut()
        .unwrap()
        .remove("decided")
        .is_some());
    let older: DocRecord = serde_json::from_value(older).unwrap();
    let resumed = OverleafDoc::resume(DocId("doc".into()), &older, start).unwrap();
    assert_eq!(resumed.text(), "Hello big world\n");
}

fn rejoin(wire: &mut Wire, doc: &mut OverleafDoc, id: &str) {
    let fresh = wire.join(id, None).unwrap();
    let rejoin = doc.rejoin_fresh(fresh.version, fresh.text, fresh.format);
    assert!(!matches!(rejoin, Rejoin::Conflict { .. }), "{rejoin:?}");
}

#[tokio::test]
async fn a_clashed_undo_the_server_takes_late_is_in_the_text_once() {
    let mock = MockOverleaf::start(project()).await;
    let id = mock.doc_id("main.tex");
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_delete(&id, 6, 5);
    bob.sync();
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    doc.local_from(insertion(7, 6, "world"), Some(Origin::Undo))
        .unwrap();
    bob.type_at(&id, 0, ">> ");
    bob.sync();
    mock.hold_updates();
    let start = Instant::now();
    let sent = doc
        .next_update(&wire.public_id(), &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    assert_eq!(sent.op, json!([{ "p": 6, "i": "world", "u": true }]));
    wire.send(&sent);
    assert!(!applied_until_out_of_step(&mut wire, &mut doc, &id));
    assert!(doc.clashed());
    for round in 1..4 {
        let on = wire.public_id();
        match doc.next_update(&on, &SendMode::Edit, start + round * 6 * SECOND) {
            Ok(Some(update)) => wire.send(&update),
            Ok(None) => {}
            Err(DocError::OutOfStep) => rejoin(&mut wire, &mut doc, &id),
            Err(error) => panic!("{error}"),
        }
    }
    mock.release_updates();
    for round in 4..10 {
        while applied_until_out_of_step(&mut wire, &mut doc, &id) {
            rejoin(&mut wire, &mut doc, &id);
        }
        let on = wire.public_id();
        if let Ok(Some(update)) = doc.next_update(&on, &SendMode::Edit, start + round * 6 * SECOND)
        {
            wire.send(&update);
        }
    }
    assert_eq!(mock.doc_text(&id), ">> Hello world\n");
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert!(doc.is_settled());
    assert_eq!(mock.ranges(&id), json!({}));
    wire.assert_healthy();
}

fn ce_fixture(name: &str, file: &str) -> Value {
    let path = std::path::Path::new(crate::test_support::overleaf_rt::FIXTURES)
        .join(name)
        .join(file);
    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
}

fn watched_ops(name: &str) -> Vec<(String, Value)> {
    let path = std::path::Path::new(crate::test_support::overleaf_rt::FIXTURES)
        .join(name)
        .join("dave.frames.jsonl");
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|frame| frame["dir"] == "in")
        .filter_map(|frame| {
            let packet = crate::realtime::codec::decode(frame["frame"].as_str()?).ok()?;
            let (event, args) = packet.into_event()?;
            let update = args
                .into_iter()
                .next()
                .filter(|_| event == "otUpdateApplied")?;
            let user = update["meta"]["user_id"].as_str()?.to_string();
            Some((user, update.get("op")?.clone()))
        })
        .collect()
}

fn comment_only(op: &Value) -> bool {
    op.as_array().is_some_and(|parts| {
        parts
            .iter()
            .all(|part| part.get("commentId").is_some() || part.get("c").is_some())
    })
}

fn assert_web_kept_up(name: &str, steps: &[Value]) {
    for step in steps {
        let web = &step["web"]["alice"];
        let label = step["label"].as_str().unwrap();
        assert_eq!(web["matchesServer"], true, "{name}: {label}");
        assert_eq!(web["disconnects"], 0, "{name}: {label}");
        assert_eq!(web["updateErrors"], json!([]), "{name}: {label}");
        if step["step"] != 1 {
            assert_eq!(web["console"], json!([]), "{name}: {label}");
        }
    }
}

fn decision_steps(steps: &[Value], verb: &str) -> Vec<(usize, Vec<String>)> {
    steps
        .iter()
        .enumerate()
        .filter(|(_, step)| {
            step["ids"].is_array() && step["label"].as_str().unwrap().contains(verb)
        })
        .map(|(index, step)| {
            let ids = step["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_string())
                .collect();
            (index, ids)
        })
        .collect()
}

#[test]
fn recorded_ce_rejects_of_hidden_text_are_plain_copies_the_web_editor_follows() {
    let name = "history-ot-reject-safe";
    let scenario = ce_fixture(name, "scenario.json");
    assert_eq!(scenario["converged"], true);
    let steps = ce_fixture(name, "steps.json")["steps"]
        .as_array()
        .unwrap()
        .clone();
    assert_web_kept_up(name, &steps);
    let ops = watched_ops(name);
    let bob = ops
        .iter()
        .find(|(_, op)| comment_only(op))
        .map(|(user, _)| user.clone())
        .unwrap();
    let sent: Vec<&Value> = ops
        .iter()
        .filter(|(user, op)| *user == bob && !comment_only(op))
        .map(|(_, op)| op)
        .collect();
    let decisions = decision_steps(&steps, "rejects");
    assert_eq!((sent.len(), decisions.len()), (2, 2));
    for ((index, ids), wire) in decisions.into_iter().zip(sent) {
        let before = &steps[index - 1]["server"];
        let raw = crate::live::history_ot::RawDoc::from_raw(&before["raw"]).unwrap();
        let ours = raw.decision_op(&ids, Decision::Reject).unwrap();
        assert_eq!(json!([{ "textOperation": ours.to_json().unwrap() }]), *wire);
        let shape = ours.to_json().unwrap().to_string();
        assert!(!shape.contains("\"none\""), "{shape}");
        let mut after = raw.clone();
        after.apply(&ours).unwrap();
        let server = &steps[index]["server"];
        assert_eq!(after.visible().unwrap(), server["text"].as_str().unwrap());
        let theirs = crate::live::history_ot::RawDoc::from_raw(&server["raw"]).unwrap();
        assert_eq!(after.comments(), theirs.comments());
        assert_eq!(after.tracked(), theirs.tracked());
    }
    let last = &steps.last().unwrap()["server"]["raw"];
    assert_eq!(
        last["comments"],
        json!([{ "id": steps[1]["thread"], "ranges": [{ "pos": 27, "length": 16 }] }])
    );
    assert!(last
        .get("trackedChanges")
        .is_none_or(|tracked| tracked == &json!([])));
}

#[test]
fn recorded_ce_accepts_by_ops_keep_the_text_and_the_comment_on_the_accepted_insert() {
    let name = "sharejs-accept-by-ops";
    let scenario = ce_fixture(name, "scenario.json");
    assert_eq!(scenario["converged"], true);
    let steps = ce_fixture(name, "steps.json")["steps"]
        .as_array()
        .unwrap()
        .clone();
    assert_web_kept_up(name, &steps);
    let ops = watched_ops(name);
    let bob = ops
        .iter()
        .find(|(_, op)| comment_only(op))
        .map(|(user, _)| user.clone())
        .unwrap();
    let sent: Vec<&Value> = ops
        .iter()
        .filter(|(user, op)| *user == bob && !comment_only(op))
        .map(|(_, op)| op)
        .collect();
    let decisions = decision_steps(&steps, "accepts");
    assert_eq!((sent.len(), decisions.len()), (1, 1));
    let (index, ids) = &decisions[0];
    let before = &steps[index - 1]["server"];
    let text = before["text"].as_str().unwrap();
    let packed: String = text.bytes().map(char::from).collect();
    let (text, format) =
        FormatState::from_join(DocFormat::ShareJs, &json!([packed]), &before["ranges"]).unwrap();
    let mut doc = OverleafDoc::joined(DocId("doc".into()), 0, text.clone(), format);
    doc.queue_review(ReviewOp::Decide {
        changes: doc.targets(ids).unwrap(),
        decision: Decision::Accept,
    });
    let update = doc
        .next_update(&me(), &SendMode::Edit, Instant::now())
        .unwrap()
        .unwrap();
    assert_eq!(update.op, *sent[0]);
    assert_eq!(update.tc, None);
    assert_eq!(doc.applied(&ack(0), &[me()]), Ok(Applied::Acknowledged));
    let server = &steps[*index]["server"];
    assert_eq!(doc.text(), server["text"].as_str().unwrap());
    let kept: Vec<(String, String)> = doc
        .review()
        .changes
        .into_iter()
        .map(|change| (change.id, change.text))
        .collect();
    let theirs: Vec<(String, String)> = server["ranges"]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| {
            (
                change["id"].as_str().unwrap().to_string(),
                change["op"]["d"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(kept, theirs);
    let comment = &server["ranges"]["comments"][0]["op"];
    assert_eq!(
        (comment["p"].clone(), comment["c"].clone()),
        (json!(10), json!("whole"))
    );
    assert_eq!(
        comment_of(&doc, steps[2]["thread"].as_str().unwrap()).quote,
        "whole"
    );
}
