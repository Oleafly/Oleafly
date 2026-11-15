use std::collections::VecDeque;
use std::time::{Duration, Instant};

use oleafly_ot::testing::Rng;
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::doc::{Applied, OverleafDoc};
use super::format::{operation_of, pieces_from_json, DocFormat, FormatState};
use super::harness::{parse_join, Editor, Wire};
use super::{AppliedUpdate, DocId, PublicId, SendMode, Tracking};
use crate::test_support::mock_overleaf::{
    MockOverleaf, MockPeer, MockProject, MockUser, Privilege,
};
use crate::test_support::overleaf_rt::{recordings, DocEvent};
use crate::test_support::sharejs_text::{self, Component};

const ROUNDS: usize = 10_000;
const PEERS: [&str; 3] = ["bob", "erin", "frank"];
const TYPED: [&str; 10] = ["a", "b", " ", "\n", "é", "x", "ok ", "😀", "\0", "\r\n"];

fn seed() -> u64 {
    std::env::var("OLEAFLY_LIVE_SEED")
        .ok()
        .and_then(|seed| seed.parse().ok())
        .unwrap_or(0x07_458)
}

fn sharejs_project() -> MockProject {
    PEERS
        .iter()
        .fold(MockProject::new("converge"), |project, name| {
            project.member(MockUser::named(name), Privilege::ReadAndWrite)
        })
        .doc("main.tex", "\\section{Intro}\nShared text.\n")
}

struct Oleafly {
    wire: Wire,
    doc: OverleafDoc,
    editor: Editor,
    inbox: VecDeque<AppliedUpdate>,
    id: String,
    tracking: Tracking,
    rejoins: usize,
}

impl Oleafly {
    fn pull(&mut self) {
        let fresh = self.wire.incoming(&self.id);
        self.inbox.extend(fresh);
    }

    fn process(&mut self, count: usize, round: usize) {
        self.pull();
        for _ in 0..count {
            let Some(update) = self.inbox.pop_front() else {
                return;
            };
            match self.doc.applied(&update, &self.wire.own) {
                Ok(Applied::Remote(op)) => self.editor.remote(op),
                Ok(_) => {}
                Err(error) => panic!("round {round}: {error} on {update:?}"),
            }
        }
    }

    fn send(&mut self, mode: &SendMode, now: Instant, round: usize) {
        let on = self.wire.public_id();
        match self.doc.next_update(&on, mode, now) {
            Ok(Some(update)) => self.wire.send(&update),
            Ok(None) => {}
            Err(error) => panic!("round {round}: the gate refused a send: {error}"),
        }
    }

    fn reconnect(&mut self, mock: &MockOverleaf, round: usize) {
        self.inbox.clear();
        self.wire.reconnect(mock, "alice");
        match self.wire.join(&self.id, Some(self.doc.version())) {
            Ok(joined) => {
                let ops = self
                    .doc
                    .catch_up(&joined.updates, &self.wire.own)
                    .unwrap_or_else(|error| panic!("round {round}: catch-up failed: {error}"));
                for op in ops {
                    self.editor.remote(op);
                }
            }
            Err(_) => {
                let fresh = self.wire.join(&self.id, None).unwrap();
                self.rejoins += 1;
                let rejoin = self
                    .doc
                    .rejoin_fresh(fresh.version, fresh.text, fresh.format);
                self.editor.rejoined(rejoin);
            }
        }
    }
}

fn random_insert(rng: &mut Rng) -> String {
    (0..1 + rng.below(3)).map(|_| *rng.pick(&TYPED)).collect()
}

fn peer_edit(peer: &mut MockPeer, id: &str, rng: &mut Rng) {
    let text = peer.text(id);
    let length = utf16_len(&text);
    if length > 30 && rng.chance(45) {
        let at = rng.below(length);
        let count = (1 + rng.below(4)).min(length - at);
        peer.delete(id, at, count);
    } else {
        let typed: String = (0..1 + rng.below(3))
            .map(|_| *rng.pick(&["p", "q", " ", "\n", "ü"]))
            .collect();
        peer.type_at(id, rng.below(length + 1), &typed);
    }
}

fn editor_edit(editor: &mut Editor, rng: &mut Rng) {
    let doc = &mut editor.doc;
    let sent = match rng.below(10) {
        0..=4 => doc.type_text(&random_insert(rng)),
        5..=6 if doc.length > 20 => doc.backspace(1 + rng.below(3)),
        7 if doc.length > 20 => doc.delete_ahead(1 + rng.below(3)),
        _ => {
            doc.jump_random(rng);
            Ok(None)
        }
    };
    editor.typed(sent.expect("the editor edit applies"));
}

#[tokio::test]
async fn random_sharejs_clients_converge_with_one_oleafly_editor() {
    let seed = seed();
    let mut rng = Rng::new(seed);
    let mock = MockOverleaf::start(sharejs_project()).await;
    mock.configure(|config| config.rate_limits.joins_per_minute = usize::MAX);
    let id = mock.doc_id("main.tex");
    let mut peers: Vec<MockPeer> = PEERS
        .iter()
        .map(|name| {
            let mut peer = mock.peer(name);
            peer.join(&id);
            peer
        })
        .collect();
    let mut held = [false; PEERS.len()];
    let mut wire = Wire::connect(&mock, "alice");
    let doc = wire.open(&id);
    let mut oleafly = Oleafly {
        editor: Editor::new(doc.text()),
        doc,
        wire,
        inbox: VecDeque::new(),
        tracking: Tracking {
            user_id: mock.user("alice").id,
            ts: "2026-11-15T10:00:00.000Z".into(),
        },
        id: id.clone(),
        rejoins: 0,
    };
    let start = Instant::now();
    let mut clock = Duration::ZERO;
    let mut reconnects = 0;
    for round in 0..ROUNDS {
        clock += Duration::from_millis(rng.below(1_200) as u64);
        let now = start + clock;
        match rng.below(100) {
            0..=17 => {
                let index = rng.below(PEERS.len());
                peer_edit(&mut peers[index], &id, &mut rng);
            }
            18..=21 => {
                let index = rng.below(PEERS.len());
                if held[index] {
                    peers[index].release();
                } else {
                    peers[index].hold();
                }
                held[index] = !held[index];
            }
            22..=41 => editor_edit(&mut oleafly.editor, &mut rng),
            42..=56 => {
                if rng.chance(50) {
                    oleafly.editor.deliver_to_channel(&mut oleafly.doc);
                } else {
                    oleafly.editor.deliver_to_editor();
                }
            }
            57..=72 => {
                let mode = if rng.chance(20) {
                    SendMode::Suggest(oleafly.tracking.clone())
                } else {
                    SendMode::Edit
                };
                oleafly.send(&mode, now, round);
            }
            73..=96 => {
                let count = 1 + rng.below(4);
                oleafly.process(count, round);
            }
            _ => {
                if rng.chance(30) {
                    reconnects += 1;
                    oleafly.reconnect(&mock, round);
                }
            }
        }
        oleafly.pull();
        if oleafly.inbox.len() > 30 {
            oleafly.process(usize::MAX, round);
        }
    }
    for (peer, held) in peers.iter_mut().zip(held) {
        if held {
            peer.release();
        }
    }
    for pass in 0..200 {
        clock += Duration::from_secs(6);
        oleafly.editor.drain(&mut oleafly.doc);
        oleafly.send(&SendMode::Edit, start + clock, ROUNDS + pass);
        oleafly.process(usize::MAX, ROUNDS + pass);
        for peer in &mut peers {
            peer.sync();
        }
        oleafly.pull();
        let quiet =
            oleafly.doc.is_settled() && !oleafly.editor.has_work() && oleafly.inbox.is_empty();
        if quiet {
            break;
        }
    }
    let server = mock.doc_text(&id);
    assert!(
        oleafly.doc.is_settled(),
        "seed {seed}: unsent work at the end"
    );
    assert_eq!(oleafly.doc.text(), server, "seed {seed}: OverleafDoc");
    assert_eq!(
        oleafly.editor.channel.text(),
        server,
        "seed {seed}: EditorChannel"
    );
    assert_eq!(oleafly.editor.doc.content, server, "seed {seed}: editor");
    assert_eq!(oleafly.doc.version(), mock.doc_version(&id));
    for (name, peer) in PEERS.iter().zip(&mut peers) {
        assert!(
            peer.is_connected(),
            "seed {seed}: {name} was disconnected: {:?}",
            peer.events("otUpdateError")
        );
        assert_eq!(peer.text(&id), server, "seed {seed}: {name}");
    }
    assert!(!server.contains(['\0', '\r']), "seed {seed}");
    assert!(server.chars().all(|c| c.len_utf16() == 1), "seed {seed}");
    assert!(
        oleafly.editor.corrections > 0,
        "seed {seed}: no sanitising happened"
    );
    assert!(reconnects > 0, "seed {seed}: never reconnected");
    assert_eq!(oleafly.editor.doc.resyncs + oleafly.editor.doc.resets, 0);
    assert_eq!(
        oleafly.rejoins, 0,
        "seed {seed}: catch-up fell back to a fresh join"
    );
    oleafly.wire.assert_healthy();
    assert!(
        mock.doc_version(&id) > 1_000,
        "seed {seed}: only {} updates reached the server",
        mock.doc_version(&id)
    );
}

fn random_sharejs_op(rng: &mut Rng, text: &str) -> Vec<Component> {
    let mut working = sharejs_text::units(text);
    let mut op = Vec::new();
    let typed = |rng: &mut Rng| -> String {
        (0..1 + rng.below(3))
            .map(|_| *rng.pick(&["a", "b", "é", "\n"]))
            .collect()
    };
    for _ in 0..1 + rng.below(3) {
        let mut components = Vec::new();
        if working.is_empty() || rng.chance(40) {
            components.push(Component::insert(rng.below(working.len() + 1), &typed(rng)));
        } else {
            let at = rng.below(working.len());
            let end = (at + 1 + rng.below(3)).min(working.len());
            components.push(Component::Delete {
                p: at,
                d: working[at..end].to_vec(),
            });
            if rng.chance(50) {
                components.push(Component::insert(at, &typed(rng)));
            }
        }
        for component in components {
            sharejs_text::apply_units(&mut working, std::slice::from_ref(&component)).unwrap();
            sharejs_text::append(&mut op, component);
        }
    }
    op
}

fn ours(text: &str, op: &[Component]) -> TextOperation {
    let wire = sharejs_text::op_to_json(op);
    operation_of(text, &pieces_from_json(&wire).unwrap()).unwrap()
}

fn update_of(v: u64, op: &[Component]) -> AppliedUpdate {
    AppliedUpdate::from_value(
        &json!({
            "doc": "doc", "v": v, "op": sharejs_text::op_to_json(op),
            "meta": { "source": "P.web", "user_id": "web" },
        }),
        None,
    )
    .unwrap()
}

#[test]
fn transcribed_sharejs_and_text_operation_transforms_agree() {
    let mut rng = Rng::new(seed());
    let start = Instant::now();
    let me = PublicId("P.me".into());
    let mut replacements = 0;
    for round in 0..ROUNDS {
        let text: String = (0..rng.below(14))
            .map(|_| *rng.pick(&["k", "l", "m", "é", "\n"]))
            .collect();
        let left = random_sharejs_op(&mut rng, &text);
        let right = random_sharejs_op(&mut rng, &text);
        let (left_after, right_after) = sharejs_text::transform_x(&left, &right).unwrap();
        let oracle =
            sharejs_text::apply(&sharejs_text::apply(&text, &left).unwrap(), &right_after).unwrap();
        let oracle_other =
            sharejs_text::apply(&sharejs_text::apply(&text, &right).unwrap(), &left_after).unwrap();
        assert_eq!(oracle, oracle_other, "round {round}: ShareJS TP1");
        let (our_left, our_right) = (ours(&text, &left), ours(&text, &right));
        let (left_prime, right_prime) = TextOperation::transform(&our_left, &our_right).unwrap();
        assert_eq!(
            right_prime.apply(&our_left.apply(&text).unwrap()).unwrap(),
            left_prime.apply(&our_right.apply(&text).unwrap()).unwrap(),
            "round {round}: TextOperation TP1"
        );
        let packed: String = text.bytes().map(char::from).collect();
        let (joined, format) =
            FormatState::from_join(DocFormat::ShareJs, &json!([packed]), &json!({})).unwrap();
        let mut doc = OverleafDoc::joined(DocId("doc".into()), 0, joined, format);
        doc.local(our_left.clone()).unwrap();
        let Some(sent) = doc.next_update(&me, &SendMode::Edit, start).unwrap() else {
            continue;
        };
        let sent_op = sharejs_text::op_from_json(&sent.op).unwrap();
        let mut server = sharejs_text::apply(&text, &right).unwrap();
        let arriving = sharejs_text::transform(&sent_op, &right, sharejs_text::Side::Left).unwrap();
        server = sharejs_text::apply(&server, &arriving).unwrap();
        doc.applied(&update_of(0, &right), std::slice::from_ref(&me))
            .unwrap();
        assert_eq!(
            doc.text(),
            server,
            "round {round}: {text:?} ours {sent_op:?} theirs {right:?}"
        );
        let ack = AppliedUpdate::from_value(&json!({ "doc": "doc", "v": 1 }), None).unwrap();
        assert_eq!(doc.applied(&ack, &[]).unwrap(), Applied::Acknowledged);
        assert_eq!((doc.text(), doc.is_settled()), (server.as_str(), true));
        if right.windows(2).any(|pair| matches!(pair, [Component::Delete { p: a, .. }, Component::Insert { p: b, .. }] if a == b)) {
            replacements += 1;
        }
    }
    assert!(
        replacements > ROUNDS / 10,
        "only {replacements} replacements"
    );
}

#[test]
fn recorded_sharejs_sessions_replay_through_overleaf_doc() {
    let start = Instant::now();
    let mut replayed = 0;
    let mut sends = 0;
    let mut exact = 0;
    let mut hashes = 0;
    for recording in recordings()
        .iter()
        .filter(|recording| recording.format == "sharejs-text-ot")
    {
        for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
            let Some(expected) = recording.final_text(&trace.name) else {
                continue;
            };
            let label = format!("{}: {}", recording.name, trace.name);
            let (reply, events) = trace.last_session(&recording.doc_id).unwrap();
            let joined = parse_join(&reply).unwrap();
            let mut doc = OverleafDoc::joined(
                DocId(recording.doc_id.clone()),
                joined.version,
                joined.text,
                joined.format,
            );
            let on = PublicId(trace.public_ids().last().cloned().unwrap());
            let own = [on.clone()];
            let mut clock = Duration::ZERO;
            for event in events {
                clock += Duration::from_secs(1);
                match event {
                    DocEvent::Sent { v, update } => {
                        assert!(doc.is_settled(), "{label}: sent with work in flight");
                        let pieces = pieces_from_json(&update["op"]).unwrap();
                        let before = doc.text().to_string();
                        let op = operation_of(&before, &pieces).unwrap();
                        assert_eq!(doc.local(op.clone()).unwrap(), None, "{label}");
                        let ours = doc
                            .next_update(&on, &SendMode::Edit, start + clock)
                            .unwrap()
                            .unwrap_or_else(|| panic!("{label}: nothing to send"));
                        assert_eq!(ours.v, v, "{label}");
                        let replayed_op =
                            operation_of(&before, &pieces_from_json(&ours.op).unwrap()).unwrap();
                        assert_eq!(replayed_op, op, "{label}");
                        if ours.op == update["op"] {
                            exact += 1;
                        }
                        if let (Some(mine), Some(theirs)) = (&ours.hash, update["hash"].as_str()) {
                            assert_eq!(mine, theirs, "{label}: hash");
                            hashes += 1;
                        }
                        if let (Some(mine), Some(theirs)) = (ours.last_v, update["lastV"].as_u64())
                        {
                            assert_eq!(mine, theirs, "{label}: lastV");
                        }
                        assert!(ours.tc.is_none() && ours.dup_if_source.is_empty());
                        sends += 1;
                    }
                    DocEvent::Acked { v } => {
                        let ack = AppliedUpdate::from_value(
                            &json!({ "doc": recording.doc_id, "v": v }),
                            None,
                        )
                        .unwrap();
                        assert_eq!(
                            doc.applied(&ack, &own).unwrap(),
                            Applied::Acknowledged,
                            "{label}"
                        );
                    }
                    DocEvent::Remote { update, .. } => {
                        let update = AppliedUpdate::from_value(&update, None).unwrap();
                        doc.applied(&update, &own)
                            .unwrap_or_else(|error| panic!("{label}: {error}"));
                    }
                    DocEvent::Error { args } => panic!("{label}: {args:?}"),
                }
            }
            assert_eq!(doc.text(), expected, "{label}");
            replayed += 1;
        }
    }
    assert!(replayed >= 10, "only {replayed} sessions replayed");
    assert!(sends >= 20, "only {sends} recorded sends replayed");
    assert!(
        exact * 10 >= sends * 9,
        "only {exact} of {sends} sends matched exactly"
    );
    assert!(hashes >= 5, "only {hashes} hashes compared");
}

#[test]
fn applied_update_payloads_decode_from_the_wire() {
    let ack = AppliedUpdate::from_value(&json!({ "v": 3, "doc": "d1" }), None).unwrap();
    assert_eq!(
        (ack.v, ack.op.is_none(), ack.source.is_none()),
        (3, true, true)
    );
    let full = AppliedUpdate::from_value(
        &json!({
            "doc": "d1", "op": [{ "p": 0, "i": "x" }], "v": 4, "lastV": 2, "hash": "h",
            "meta": { "source": "P.a", "user_id": "u", "ts": 1, "tc": "0123456789abcdef01" },
        }),
        None,
    )
    .unwrap();
    assert_eq!(full.source, Some(PublicId("P.a".into())));
    assert_eq!(full.user_id.as_deref(), Some("u"));
    assert_eq!(full.tc.as_deref(), Some("0123456789abcdef01"));
    assert!(!full.dup);
    let dup =
        AppliedUpdate::from_value(&json!({ "doc": "d1", "v": 4, "dup": true }), None).unwrap();
    assert!(dup.dup);
    for bad in [
        json!({ "v": 1 }),
        json!({ "doc": "d1" }),
        json!("x"),
        Value::Null,
    ] {
        assert_eq!(AppliedUpdate::from_value(&bad, None), None, "{bad}");
    }
}
