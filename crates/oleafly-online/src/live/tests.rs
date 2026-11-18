use std::collections::VecDeque;
use std::time::{Duration, Instant};

use oleafly_ot::testing::Rng;
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::doc::{Applied, OverleafDoc};
use super::format::{operation_of, pieces_from_json, DocFormat, FormatState};
use super::harness::{Editor, Wire};
use super::join::parse_join;
use super::{AppliedUpdate, DocId, PublicId, SendMode, Tracking};
use crate::test_support::mock_overleaf::{
    DocFormat as MockFormat, MockOverleaf, MockPeer, MockProject, MockUser, Privilege,
};
use crate::test_support::overleaf_rt::{recordings, DocEvent, Recording, Trace};
use crate::test_support::sharejs_text::{self, Component};

const ROUNDS: usize = 10_000;
const PEERS: [&str; 3] = ["bob", "erin", "frank"];
const COMMENTER: &str = "grace";
const TYPED: [&str; 10] = ["a", "b", " ", "\n", "é", "x", "ok ", "😀", "\0", "\r\n"];

fn seed() -> u64 {
    std::env::var("OLEAFLY_LIVE_SEED")
        .ok()
        .and_then(|seed| seed.parse().ok())
        .unwrap_or(0x07_458)
}

fn project(format: MockFormat) -> MockProject {
    PEERS
        .iter()
        .chain([&COMMENTER])
        .fold(MockProject::new("converge"), |project, name| {
            project.member(MockUser::named(name), Privilege::ReadAndWrite)
        })
        .format(format)
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
    mock: MockOverleaf,
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
            let outcome = self.doc.applied(&update, &self.wire.own);
            match outcome {
                Ok(Applied::Remote(op)) => self.editor.remote(op),
                Ok(_) => {}
                Err(error) => panic!("round {round}: {error} on {update:?}"),
            }
            self.check_caught_up(round, &update);
        }
    }

    fn check_caught_up(&self, round: usize, update: &AppliedUpdate) {
        if !self.doc.is_settled() || self.doc.version() != self.mock.doc_version(&self.id) {
            return;
        }
        match self.doc.format() {
            FormatState::ShareJs(_) => assert_eq!(
                self.doc.text(),
                self.mock.doc_text(&self.id),
                "round {round}: out of step after {update:?}"
            ),
            FormatState::HistoryOt(raw) => assert_eq!(
                raw.content().unwrap(),
                self.mock.raw_doc(&self.id)["content"].as_str().unwrap(),
                "round {round}: raw content out of step after {update:?}"
            ),
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

fn peer_edit(peer: &mut MockPeer, id: &str, rng: &mut Rng, tracked_deletes: bool) -> bool {
    let text = peer.text(id);
    let length = utf16_len(&text);
    if length > 30 && rng.chance(45) {
        let at = rng.below(length);
        let count = (1 + rng.below(4)).min(length - at);
        if tracked_deletes && rng.chance(40) {
            peer.track_delete(id, at, count);
            return true;
        }
        peer.delete(id, at, count);
    } else {
        let typed: String = (0..1 + rng.below(3))
            .map(|_| *rng.pick(&["p", "q", " ", "\n", "ü"]))
            .collect();
        peer.type_at(id, rng.below(length + 1), &typed);
    }
    false
}

fn comment(mock: &MockOverleaf, commenter: &mut MockPeer, id: &str, rng: &mut Rng, count: usize) {
    let length = utf16_len(mock.raw_doc(id)["content"].as_str().unwrap_or_default());
    if length < 2 {
        return;
    }
    let pos = rng.below(length - 1);
    let span = (1 + rng.below(5)).min(length - pos);
    let edit =
        json!({ "commentId": format!("{count:024x}"), "ranges": [{ "pos": pos, "length": span }] });
    let update = json!({ "doc": id, "v": mock.doc_version(id), "op": [edit] });
    let reply = commenter
        .emit("applyOtUpdate", vec![json!(id), update])
        .unwrap();
    assert!(reply.first().is_none_or(Value::is_null), "{reply:?}");
    commenter.take_events("otUpdateApplied");
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

struct Converged {
    seed: u64,
    mock: MockOverleaf,
    id: String,
    oleafly: Oleafly,
    peers: Vec<MockPeer>,
    commenter: MockPeer,
    held: [bool; PEERS.len()],
    history_ot: bool,
    reconnects: usize,
    tracked_deletes: usize,
    comments: usize,
}

impl Converged {
    async fn start(format: MockFormat) -> Converged {
        let mock = MockOverleaf::start(project(format)).await;
        mock.configure(|config| config.rate_limits.joins_per_minute = usize::MAX);
        let id = mock.doc_id("main.tex");
        let joined = |name: &str| {
            let mut peer = mock.peer(name);
            peer.join(&id);
            peer
        };
        let peers: Vec<MockPeer> = PEERS.iter().map(|name| joined(name)).collect();
        let commenter = joined(COMMENTER);
        let mut wire = Wire::connect(&mock, "alice");
        let doc = wire.open(&id);
        let oleafly = Oleafly {
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
            mock: mock.clone(),
        };
        Converged {
            seed: seed(),
            mock,
            id,
            oleafly,
            peers,
            commenter,
            held: [false; PEERS.len()],
            history_ot: format == MockFormat::HistoryOt,
            reconnects: 0,
            tracked_deletes: 0,
            comments: 0,
        }
    }

    fn round(&mut self, rng: &mut Rng, round: usize, now: Instant) {
        match rng.below(100) {
            0..=17 => self.peer_edits(rng),
            18..=21 => self.toggle_hold(rng),
            22..=41 => editor_edit(&mut self.oleafly.editor, rng),
            42..=56 => self.deliver(rng),
            57..=72 => self.oleafly_sends(rng, now, round),
            73..=96 => {
                let count = 1 + rng.below(4);
                self.oleafly.process(count, round);
            }
            97 if self.history_ot => {
                self.comments += 1;
                comment(
                    &self.mock,
                    &mut self.commenter,
                    &self.id,
                    rng,
                    self.comments,
                );
            }
            _ => self.maybe_reconnect(rng, round),
        }
        self.oleafly.pull();
        if self.oleafly.inbox.len() > 30 {
            self.oleafly.process(usize::MAX, round);
        }
    }

    fn peer_edits(&mut self, rng: &mut Rng) {
        let index = rng.below(PEERS.len());
        if peer_edit(&mut self.peers[index], &self.id, rng, self.history_ot) {
            self.tracked_deletes += 1;
        }
    }

    fn toggle_hold(&mut self, rng: &mut Rng) {
        let index = rng.below(PEERS.len());
        if self.held[index] {
            self.peers[index].release();
        } else {
            self.peers[index].hold();
        }
        self.held[index] = !self.held[index];
    }

    fn deliver(&mut self, rng: &mut Rng) {
        if rng.chance(50) {
            self.oleafly
                .editor
                .deliver_to_channel(&mut self.oleafly.doc);
        } else {
            self.oleafly.editor.deliver_to_editor();
        }
    }

    fn oleafly_sends(&mut self, rng: &mut Rng, now: Instant, round: usize) {
        let mode = if rng.chance(20) {
            SendMode::Suggest(self.oleafly.tracking.clone())
        } else {
            SendMode::Edit
        };
        self.oleafly.send(&mode, now, round);
    }

    fn maybe_reconnect(&mut self, rng: &mut Rng, round: usize) {
        if rng.chance(30) {
            self.reconnects += 1;
            self.oleafly.reconnect(&self.mock, round);
        }
    }

    fn settle(&mut self, start: Instant, mut clock: Duration) {
        for (peer, held) in self.peers.iter_mut().zip(self.held) {
            if held {
                peer.release();
            }
        }
        for pass in 0..200 {
            clock += Duration::from_secs(6);
            let oleafly = &mut self.oleafly;
            oleafly.editor.drain(&mut oleafly.doc);
            oleafly.send(&SendMode::Edit, start + clock, ROUNDS + pass);
            oleafly.process(usize::MAX, ROUNDS + pass);
            self.peers.iter_mut().for_each(MockPeer::sync);
            oleafly.pull();
            if oleafly.doc.is_settled() && !oleafly.editor.has_work() && oleafly.inbox.is_empty() {
                return;
            }
        }
    }
}

async fn converge(format: MockFormat) -> Converged {
    let mut run = Converged::start(format).await;
    let mut rng = Rng::new(run.seed);
    let start = Instant::now();
    let mut clock = Duration::ZERO;
    for round in 0..ROUNDS {
        clock += Duration::from_millis(rng.below(1_200) as u64);
        run.round(&mut rng, round, start + clock);
    }
    run.settle(start, clock);
    run
}

fn assert_converged(run: &mut Converged) -> String {
    let Converged {
        seed,
        mock,
        id,
        oleafly,
        peers,
        reconnects,
        ..
    } = run;
    let server = mock.doc_text(id);
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
    assert_eq!(oleafly.doc.version(), mock.doc_version(id));
    for (name, peer) in PEERS.iter().zip(peers.iter_mut()) {
        assert!(
            peer.is_connected(),
            "seed {seed}: {name} was disconnected: {:?}",
            peer.events("otUpdateError")
        );
        assert_eq!(peer.text(id), server, "seed {seed}: {name}");
    }
    assert!(!server.contains(['\0', '\r']), "seed {seed}");
    assert!(server.chars().all(|c| c.len_utf16() == 1), "seed {seed}");
    assert!(
        oleafly.editor.corrections > 0,
        "seed {seed}: no sanitising happened"
    );
    assert!(*reconnects > 0, "seed {seed}: never reconnected");
    assert_eq!(oleafly.editor.doc.resyncs + oleafly.editor.doc.resets, 0);
    assert_eq!(
        oleafly.rejoins, 0,
        "seed {seed}: catch-up fell back to a fresh join"
    );
    oleafly.wire.assert_healthy();
    assert!(
        mock.doc_version(id) > 1_000,
        "seed {seed}: only {} updates reached the server",
        mock.doc_version(id)
    );
    server
}

#[tokio::test]
async fn random_sharejs_clients_converge_with_one_oleafly_editor() {
    let mut run = converge(MockFormat::ShareJs).await;
    assert_converged(&mut run);
}

#[tokio::test]
async fn random_history_ot_clients_converge_with_one_oleafly_editor() {
    let mut run = converge(MockFormat::HistoryOt).await;
    assert_converged(&mut run);
    let seed = run.seed;
    let FormatState::HistoryOt(raw) = run.oleafly.doc.format() else {
        panic!("seed {seed}: the doc is not history-ot")
    };
    let server = run.mock.raw_doc(&run.id);
    assert_eq!(
        raw.content().unwrap(),
        server["content"].as_str().unwrap(),
        "seed {seed}: raw content"
    );
    let ours: Vec<(usize, usize, Value)> = raw
        .tracked()
        .into_iter()
        .map(|range| (range.pos, range.length, range.tracking["type"].clone()))
        .collect();
    let theirs: Vec<(usize, usize, Value)> = server["trackedChanges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| {
            (
                change["range"]["pos"].as_u64().unwrap() as usize,
                change["range"]["length"].as_u64().unwrap() as usize,
                change["tracking"]["type"].clone(),
            )
        })
        .collect();
    assert_eq!(ours, theirs, "seed {seed}: tracked changes");
    assert!(
        ours.iter().any(|(_, _, kind)| kind == "delete"),
        "seed {seed}: nothing is hidden at the end"
    );
    assert!(
        run.tracked_deletes > 100,
        "seed {seed}: {} tracked deletes",
        run.tracked_deletes
    );
    assert!(
        run.comments > 20,
        "seed {seed}: {} comment ops",
        run.comments
    );
    assert!(!raw.comments().is_empty(), "seed {seed}: no comments kept");
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

#[derive(Default)]
struct Totals {
    replayed: usize,
    sends: usize,
    exact: usize,
    remote: usize,
}

struct Replay {
    label: String,
    doc_id: DocId,
    doc: OverleafDoc,
    on: PublicId,
    start: Instant,
}

impl Replay {
    fn new(recording: &Recording, trace: &Trace) -> (Replay, Vec<DocEvent>) {
        let (reply, events) = trace.last_session(&recording.doc_id).unwrap();
        let joined = parse_join(&DocId(recording.doc_id.clone()), &reply).unwrap();
        let doc = OverleafDoc::joined(
            DocId(recording.doc_id.clone()),
            joined.version,
            joined.text,
            joined.format,
        );
        let replay = Replay {
            label: format!("{}: {}", recording.name, trace.name),
            doc_id: DocId(recording.doc_id.clone()),
            doc,
            on: PublicId(trace.public_ids().last().cloned().unwrap()),
            start: Instant::now(),
        };
        (replay, events)
    }

    fn send(&mut self, mode: &SendMode, step: usize) -> super::doc::OutgoingUpdate {
        let now = self.start + Duration::from_secs(10 * step as u64);
        self.doc
            .next_update(&self.on, mode, now)
            .unwrap()
            .unwrap_or_else(|| panic!("{}: nothing to send", self.label))
    }

    fn play(
        &mut self,
        events: Vec<DocEvent>,
        sent: &impl Fn(&mut Replay, u64, &Value, usize) -> bool,
        totals: &mut Totals,
    ) {
        for (step, event) in events.into_iter().enumerate() {
            match event {
                DocEvent::Sent { v, update } => {
                    assert!(
                        self.doc.is_settled(),
                        "{}: sent with work in flight",
                        self.label
                    );
                    totals.sends += 1;
                    totals.exact += usize::from(sent(self, v, &update, step));
                }
                DocEvent::Acked { v } => self.ack(v),
                DocEvent::Remote { update, .. } => {
                    self.remote(&update);
                    totals.remote += 1;
                }
                DocEvent::Error { args } => panic!("{}: {args:?}", self.label),
            }
        }
    }

    fn ack(&mut self, v: u64) {
        let ack = AppliedUpdate::from_value(&json!({ "v": v }), Some(&self.doc_id)).unwrap();
        assert_eq!(
            self.doc
                .applied(&ack, std::slice::from_ref(&self.on))
                .unwrap(),
            Applied::Acknowledged,
            "{}",
            self.label
        );
    }

    fn remote(&mut self, update: &Value) {
        let update = AppliedUpdate::from_value(update, None).unwrap();
        if let Err(error) = self.doc.applied(&update, std::slice::from_ref(&self.on)) {
            panic!("{}: {error}", self.label);
        }
    }
}

fn replay_sessions(
    format: &str,
    sent: impl Fn(&mut Replay, u64, &Value, usize) -> bool,
    finish: impl Fn(&Recording, &Replay),
) -> Totals {
    let mut totals = Totals::default();
    for recording in recordings()
        .iter()
        .filter(|recording| recording.format == format && recording.converged)
    {
        for trace in recording.traces.iter().filter(|trace| !trace.scripted) {
            let Some(expected) = recording.final_text(&trace.name) else {
                continue;
            };
            let (mut replay, events) = Replay::new(recording, trace);
            replay.play(events, &sent, &mut totals);
            assert_eq!(replay.doc.text(), expected, "{}", replay.label);
            finish(recording, &replay);
            totals.replayed += 1;
        }
    }
    totals
}

fn sharejs_sent(replay: &mut Replay, v: u64, update: &Value, step: usize) -> bool {
    let label = replay.label.clone();
    let pieces = pieces_from_json(&update["op"]).unwrap();
    let before = replay.doc.text().to_string();
    let op = operation_of(&before, &pieces).unwrap();
    assert_eq!(replay.doc.local(op.clone()).unwrap(), None, "{label}");
    let ours = replay.send(&SendMode::Edit, step);
    assert_eq!(ours.v, v, "{label}");
    let replayed = operation_of(&before, &pieces_from_json(&ours.op).unwrap()).unwrap();
    assert_eq!(replayed, op, "{label}");
    if let (Some(mine), Some(theirs)) = (ours.last_v, update["lastV"].as_u64()) {
        assert_eq!(mine, theirs, "{label}: lastV");
    }
    assert!(ours.tc.is_none() && ours.dup_if_source.is_empty());
    ours.op == update["op"]
}

#[test]
fn recorded_sharejs_sessions_replay_through_overleaf_doc() {
    let totals = replay_sessions("sharejs-text-ot", sharejs_sent, |_, _| {});
    assert!(
        totals.replayed >= 10,
        "only {} sessions replayed",
        totals.replayed
    );
    assert!(
        totals.sends >= 20,
        "only {} recorded sends replayed",
        totals.sends
    );
    assert!(
        totals.exact * 10 >= totals.sends * 9,
        "only {} of {} sends matched exactly",
        totals.exact,
        totals.sends
    );
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

fn history_ot_project() -> MockProject {
    MockProject::new("history")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .format(MockFormat::HistoryOt)
        .doc("main.tex", "Keep this sentence. Remove this word please.\n")
}

fn raw_of(doc: &OverleafDoc) -> &super::history_ot::RawDoc {
    match doc.format() {
        FormatState::HistoryOt(raw) => raw,
        FormatState::ShareJs(_) => panic!("a history-ot doc"),
    }
}

fn settle(wire: &mut Wire, doc: &mut OverleafDoc, id: &str) {
    for update in wire.incoming(id) {
        doc.applied(&update, &wire.own).unwrap();
    }
}

fn suggesting(user_id: &str) -> SendMode {
    SendMode::Suggest(Tracking {
        user_id: user_id.to_string(),
        ts: "2026-11-15T11:00:00.000Z".into(),
    })
}

#[tokio::test]
async fn an_emoji_on_a_history_ot_doc_matches_overleaf_web() {
    let mock = MockOverleaf::start(history_ot_project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    let mut editor = Editor::new(doc.text());
    editor.doc.jump(4);
    editor.type_text(" 😀");
    editor.drain(&mut doc);
    assert_eq!(editor.corrections, 1);
    let update = doc
        .next_update(&wire.public_id(), &SendMode::Edit, Instant::now())
        .unwrap()
        .unwrap();
    assert_eq!(
        update.op,
        json!([{ "textOperation": [4, " \u{FFFD}\u{FFFD}", 41] }])
    );
    assert!(update.tc.is_none());
    wire.send(&update);
    settle(&mut wire, &mut doc, &id);
    let expected = "Keep \u{FFFD}\u{FFFD} this sentence. Remove this word please.\n";
    for text in [
        mock.doc_text(&id),
        bob.text(&id),
        doc.text().to_string(),
        editor.channel.text(),
        editor.doc.content.clone(),
    ] {
        assert_eq!(text, expected);
    }
    wire.assert_healthy();
}

#[tokio::test]
async fn an_unknown_edit_operation_stops_that_document_only() {
    let mock = MockOverleaf::start(history_ot_project().doc("other.tex", "Other\n")).await;
    let (main, other) = (mock.doc_id("main.tex"), mock.doc_id("other.tex"));
    let mut wire = Wire::connect(&mock, "alice");
    let mut stopped = wire.open(&main);
    let mut going = wire.open(&other);
    let unknown = AppliedUpdate::from_value(
        &json!({ "doc": main, "v": 0, "op": [{ "moveFile": { "to": "x" } }], "meta": { "source": "P.web" } }),
        None,
    )
    .unwrap();
    assert!(matches!(
        stopped.applied(&unknown, &wire.own),
        Err(super::doc::DocError::Codec(
            super::format::CodecError::Unsupported(_)
        ))
    ));
    let mut bob = mock.peer("bob");
    bob.join(&other);
    bob.type_at(&other, 0, "Still ");
    settle(&mut wire, &mut going, &other);
    assert_eq!(going.text(), "Still Other\n");
    assert_eq!(
        going.applied(&unknown, &wire.own).unwrap(),
        Applied::Ignored
    );
}

#[tokio::test]
async fn a_history_ot_resend_keeps_its_encoding_until_a_new_connection() {
    let mock = MockOverleaf::start(history_ot_project()).await;
    let id = mock.doc_id("main.tex");
    let mut wire = Wire::connect(&mock, "alice");
    let mut doc = wire.open(&id);
    let mut bob = mock.peer("bob");
    bob.join(&id);
    let start = Instant::now();
    let alice = mock.user("alice").id;
    let total = utf16_len(doc.text());
    doc.local(oleafly_ot::testing::deletion(total, 32, 5))
        .unwrap();
    let on = wire.public_id();
    let plain = doc
        .next_update(&on, &SendMode::Edit, start)
        .unwrap()
        .unwrap();
    wire.send(&plain);
    bob.type_at(&id, 0, ">> ");
    let later = start + Duration::from_secs(6);
    assert_eq!(
        doc.next_update(&on, &suggesting(&alice), later).unwrap(),
        None
    );
    let same = doc
        .next_update(&on, &SendMode::Edit, later)
        .unwrap()
        .unwrap();
    assert_eq!(same.op, plain.op);
    assert_eq!(same.dup_if_source, vec![on.clone()]);
    wire.send(&same);
    settle(&mut wire, &mut doc, &id);
    assert!(doc.is_settled());
    assert_eq!(
        raw_of(&doc).content().unwrap(),
        mock.raw_doc(&id)["content"].as_str().unwrap()
    );

    let total = utf16_len(doc.text());
    doc.local(oleafly_ot::testing::insertion(total, 3, "!"))
        .unwrap();
    let first = doc
        .next_update(&wire.public_id(), &SendMode::Edit, later)
        .unwrap()
        .unwrap();
    assert!(!first.op.to_string().contains("tracking"));
    wire.reconnect(&mock, "alice");
    let joined = wire.join(&id, Some(doc.version())).unwrap();
    doc.catch_up(&joined.updates, &wire.own).unwrap();
    let reencoded = doc
        .next_update(&wire.public_id(), &suggesting(&alice), later)
        .unwrap()
        .unwrap();
    assert!(reencoded.op.to_string().contains("\"tracking\""));
    wire.send(&reencoded);
    settle(&mut wire, &mut doc, &id);
    assert!(doc.is_settled());
    let server = mock.raw_doc(&id);
    assert_eq!(
        raw_of(&doc).content().unwrap(),
        server["content"].as_str().unwrap()
    );
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert_eq!(doc.version(), mock.doc_version(&id));
    wire.assert_healthy();
}

#[tokio::test]
async fn a_reviewer_on_a_history_ot_doc_sends_only_suggestions() {
    let mock = MockOverleaf::start(history_ot_project()).await;
    let id = mock.doc_id("main.tex");
    let mut bob = mock.peer("bob");
    bob.join(&id);
    bob.track_delete(&id, 32, 5);
    let mut wire = Wire::connect(&mock, "carol");
    let mut doc = wire.open(&id);
    assert_eq!(doc.text(), "Keep this sentence. Remove this please.\n");
    let carol = mock.user("carol").id;
    let mut editor = Editor::new(doc.text());
    editor.doc.jump(31);
    let deleted = editor.doc.delete_ahead(2).unwrap();
    editor.typed(deleted);
    editor.doc.jump(20);
    editor.type_text("Do ");
    editor.drain(&mut doc);
    let start = Instant::now();
    let update = doc
        .next_update(&wire.public_id(), &suggesting(&carol), start)
        .unwrap()
        .unwrap();
    let scans = update.op[0]["textOperation"].as_array().unwrap().clone();
    assert!(scans.iter().all(|scan| scan.as_u64().is_some()
        || scan
            .get("tracking")
            .is_some_and(|tracking| tracking["type"] != "none")));
    assert!(scans.iter().any(|scan| scan["r"].as_u64() == Some(7)));
    wire.send(&update);
    settle(&mut wire, &mut doc, &id);
    assert_eq!(doc.text(), mock.doc_text(&id));
    assert_eq!(doc.text(), "Keep this sentence. Do Remove thislease.\n");
    assert_eq!(
        raw_of(&doc).content().unwrap(),
        "Keep this sentence. Do Remove this word please.\n"
    );
    assert_eq!(bob.text(&id), doc.text());
    let plain = {
        let total = utf16_len(doc.text());
        doc.local(oleafly_ot::testing::insertion(total, 0, "x"))
            .unwrap();
        doc.next_update(&wire.public_id(), &SendMode::Edit, start)
            .unwrap()
            .unwrap()
    };
    assert_eq!(wire.send_raw(&plain)[0]["message"], "not authorized");
}

fn tracking_in(scans: &Value) -> Option<Tracking> {
    scans.as_array()?.iter().find_map(|scan| {
        let tracking = scan.get("tracking")?;
        Some(Tracking {
            user_id: tracking["userId"].as_str()?.to_string(),
            ts: tracking["ts"].as_str()?.to_string(),
        })
    })
}

fn history_ot_sent(replay: &mut Replay, v: u64, update: &Value, step: usize) -> bool {
    let label = replay.label.clone();
    let scans = &update["op"][0]["textOperation"];
    let raw = super::history_ot::RawOp::from_json(scans).unwrap();
    let op = raw_of(&replay.doc).project(&raw).unwrap();
    assert_eq!(replay.doc.local(op).unwrap(), None, "{label}");
    let mode = tracking_in(scans).map_or(SendMode::Edit, SendMode::Suggest);
    let ours = replay.send(&mode, step);
    assert_eq!(ours.v, v, "{label}");
    assert!(ours.tc.is_none());
    ours.op[0]["textOperation"] == *scans
}

fn raw_matches_the_final_snapshot(recording: &Recording, replay: &Replay) {
    let Some(raw) = recording.extra("final.raw.json") else {
        return;
    };
    let raw: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        raw_of(&replay.doc).content().unwrap(),
        raw["raw"]["content"].as_str().unwrap(),
        "{}: raw",
        replay.label
    );
}

#[test]
fn recorded_history_ot_sessions_replay_through_overleaf_doc() {
    let totals = replay_sessions(
        "history-ot",
        history_ot_sent,
        raw_matches_the_final_snapshot,
    );
    assert!(
        totals.replayed >= 4,
        "only {} sessions replayed",
        totals.replayed
    );
    assert!(
        totals.sends >= 4,
        "only {} recorded sends replayed",
        totals.sends
    );
    assert_eq!(
        totals.exact, totals.sends,
        "only {} of {} sends matched exactly",
        totals.exact, totals.sends
    );
    assert!(
        totals.remote >= 4,
        "only {} remote updates replayed",
        totals.remote
    );
}
