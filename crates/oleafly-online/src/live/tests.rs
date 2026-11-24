use std::collections::VecDeque;
use std::time::{Duration, Instant};

use oleafly_ot::testing::Rng;
use oleafly_ot::{utf16_len, TextOperation};
use serde_json::{json, Value};

use super::doc::{Applied, OverleafDoc, ReviewOp, Target};
use super::format::{
    accepted_pieces, operation_of, pieces_from_json, Accepted, Author, ChangeKind, Decision,
    DocFormat, FormatState, Piece, ShareJsRanges,
};
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
    repaired: usize,
    mock: MockOverleaf,
    check_ranges: bool,
    refresh: bool,
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
            let clashed = self.doc.clashed();
            let outcome = self.doc.applied(&update, &self.wire.own);
            self.refresh |= self.doc.take_doubt();
            match outcome {
                Ok(Applied::Remote(op)) => self.editor.remote(op),
                Ok(_) => {}
                Err(super::doc::DocError::OutOfStep) if clashed => {
                    self.resync();
                    return;
                }
                Err(error) => panic!("round {round}: {error} on {update:?}"),
            }
            self.check_caught_up(round, &update);
        }
    }

    fn check_caught_up(&self, round: usize, update: &AppliedUpdate) {
        if self.check_ranges
            && !self.refresh
            && !self.doc.in_flight()
            && self.doc.version() == self.mock.doc_version(&self.id)
        {
            if let FormatState::ShareJs(ranges) = self.doc.format() {
                let (ours, theirs) = (
                    sharejs_ranges(&ranges.to_json(false)),
                    sharejs_ranges(&self.mock.ranges(&self.id)),
                );
                assert!(
                    ours == theirs,
                    "round {round}: ranges out of step after {update:?}: {}",
                    shape_difference(&ours, &theirs)
                );
            }
        }
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
        let next = self.doc.next_update(&on, mode, now);
        for op in self.doc.take_shown() {
            self.editor.remote(op);
        }
        match next {
            Ok(Some(update)) => self.wire.send(&update),
            Ok(None) => {}
            Err(super::doc::DocError::OutOfStep) => self.resync(),
            Err(error) => panic!("round {round}: the gate refused a send: {error}"),
        }
    }

    fn resync(&mut self) {
        self.inbox.clear();
        let fresh = self.wire.join(&self.id, None).unwrap();
        self.rejoins += 1;
        let repairs = self.doc.repairs();
        let rejoin = self
            .doc
            .rejoin_fresh(fresh.version, fresh.text, fresh.format);
        if self.doc.repairs() > repairs {
            self.repaired += 1;
        }
        self.editor.rejoined(rejoin);
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
                if self.doc.needs_rejoin() {
                    self.resync();
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
        peer.type_at(id, rng.below(length + 1), &peer_text(rng));
    }
    false
}

fn peer_text(rng: &mut Rng) -> String {
    (0..1 + rng.below(3))
        .map(|_| *rng.pick(&["p", "q", " ", "\n", "ü"]))
        .collect()
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
    review: Option<ReviewRun>,
}

struct ReviewRun {
    rest: MockPeer,
    refreshes: usize,
    anchors: usize,
    rejects: usize,
    accepts: usize,
    tracked_inserts: usize,
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
            repaired: 0,
            mock: mock.clone(),
            check_ranges: false,
            refresh: false,
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
            review: None,
        }
    }

    fn round(&mut self, rng: &mut Rng, round: usize, now: Instant) {
        if self.review.is_some() && rng.chance(12) {
            self.review_unit(rng);
            return;
        }
        if rng.chance(5) {
            self.refresh_ranges(round);
        }
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

    fn refresh_ranges(&mut self, round: usize) {
        if self.review.is_none() || !self.oleafly.refresh {
            return;
        }
        self.oleafly.process(usize::MAX, round);
        if self.oleafly.doc.in_flight() {
            return;
        }
        let version = self.oleafly.doc.version();
        let Ok(joined) = self.oleafly.wire.join(&self.id, Some(version)) else {
            return;
        };
        if self
            .oleafly
            .doc
            .adopt_ranges(joined.version, &joined.format)
        {
            self.oleafly.refresh = false;
            if let Some(review) = self.review.as_mut() {
                review.refreshes += 1;
            }
        }
    }

    fn review_unit(&mut self, rng: &mut Rng) {
        let Some(review) = self.review.as_mut() else {
            return;
        };
        let doc = &mut self.oleafly.doc;
        match rng.below(4) {
            0 => {
                let index = rng.below(PEERS.len());
                let peer = &mut self.peers[index];
                let length = utf16_len(&peer.text(&self.id));
                peer.track_insert(&self.id, rng.below(length + 1), &peer_text(rng));
                review.tracked_inserts += 1;
            }
            1 => {
                let text = doc.text().to_string();
                let length = utf16_len(&text);
                if length < 2 {
                    return;
                }
                let from = rng.below(length - 1);
                let to = (from + 1 + rng.below(6)).min(length);
                let units: Vec<u16> = text.encode_utf16().collect();
                let quoted = String::from_utf16(&units[from..to]);
                if quoted.is_err() {
                    return;
                }
                review.anchors += 1;
                doc.queue_review(ReviewOp::Anchor {
                    thread: format!("{:024x}", 0x5eed_0000 + review.anchors),
                    ranges: vec![(from, to)],
                    ride: false,
                });
            }
            _ => {
                let changes = doc.review().changes;
                if changes.is_empty() {
                    return;
                }
                let change = &changes[rng.below(changes.len())];
                let accept = rng.chance(50);
                if accept && !self.history_ot && rng.chance(50) {
                    if let Some(id) = doc.server_change_id(&change.id) {
                        let reply = review.rest.accept(&self.id, std::slice::from_ref(&id));
                        assert_eq!(reply.status, 204, "{reply:?}");
                        doc.accept_locally(&[id]);
                        review.accepts += 1;
                        self.oleafly.refresh = true;
                    }
                    return;
                }
                let decision = if accept {
                    review.accepts += 1;
                    Decision::Accept
                } else {
                    review.rejects += 1;
                    Decision::Reject
                };
                doc.queue_review(ReviewOp::Decide {
                    changes: vec![Target::of(change)],
                    decision,
                });
            }
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
            self.refresh_ranges(ROUNDS + pass);
            let oleafly = &mut self.oleafly;
            oleafly.editor.drain(&mut oleafly.doc);
            oleafly.send(&SendMode::Edit, start + clock, ROUNDS + pass);
            oleafly.process(usize::MAX, ROUNDS + pass);
            self.peers.iter_mut().for_each(MockPeer::sync);
            oleafly.pull();
            let refreshed = self.review.is_none() || !oleafly.refresh;
            if refreshed
                && oleafly.doc.is_settled()
                && !oleafly.editor.has_work()
                && oleafly.inbox.is_empty()
            {
                return;
            }
        }
    }
}

async fn converge(format: MockFormat) -> Converged {
    let run = Converged::start(format).await;
    drive(run, ROUNDS).await
}

async fn drive(mut run: Converged, rounds: usize) -> Converged {
    let mut rng = Rng::new(run.seed);
    let start = Instant::now();
    let mut clock = Duration::ZERO;
    for round in 0..rounds {
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

const REVIEW_ROUNDS: usize = 3_000;
const REVIEW_SEEDS: u64 = 3;

type ShareJsShape = (
    Vec<(String, u64, String, String)>,
    Vec<(String, u64, String)>,
);

fn shape_difference(ours: &ShareJsShape, theirs: &ShareJsShape) -> String {
    let only = |a: &ShareJsShape, b: &ShareJsShape| {
        let changes: Vec<_> = a.0.iter().filter(|item| !b.0.contains(item)).collect();
        let comments: Vec<_> = a.1.iter().filter(|item| !b.1.contains(item)).collect();
        format!("{changes:?} {comments:?}")
    };
    format!(
        "only ours {}, only theirs {}",
        only(ours, theirs),
        only(theirs, ours)
    )
}

fn sharejs_ranges(ranges: &Value) -> ShareJsShape {
    let list = |name: &str| ranges[name].as_array().cloned().unwrap_or_default();
    let mut changes: Vec<(String, u64, String, String)> = list("changes")
        .iter()
        .map(|change| {
            let (kind, text) = match change["op"]["i"].as_str() {
                Some(text) => ("i", text),
                None => ("d", change["op"]["d"].as_str().unwrap_or_default()),
            };
            (
                kind.to_string(),
                change["op"]["p"].as_u64().unwrap(),
                text.to_string(),
                change["metadata"]["user_id"].to_string(),
            )
        })
        .collect();
    let mut comments: Vec<(String, u64, String)> = list("comments")
        .iter()
        .map(|comment| {
            (
                comment["op"]["t"].as_str().unwrap_or_default().to_string(),
                comment["op"]["p"].as_u64().unwrap(),
                comment["op"]["c"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    changes.sort();
    comments.sort();
    (changes, comments)
}

type RawShape = (
    String,
    Vec<(u64, u64, Value, Value)>,
    Vec<(String, Value, bool)>,
);

fn history_ot_ranges(raw: &Value) -> RawShape {
    let tracked = raw["trackedChanges"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|change| {
            (
                change["range"]["pos"].as_u64().unwrap(),
                change["range"]["length"].as_u64().unwrap(),
                change["tracking"]["type"].clone(),
                change["tracking"]["userId"].clone(),
            )
        })
        .collect();
    let mut comments: Vec<(String, Value, bool)> = raw["comments"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|comment| {
            (
                comment["id"].as_str().unwrap_or_default().to_string(),
                comment["ranges"].clone(),
                comment["resolved"].as_bool().unwrap_or(false),
            )
        })
        .collect();
    comments.sort_by(|a, b| a.0.cmp(&b.0));
    (
        raw["content"].as_str().unwrap_or_default().to_string(),
        tracked,
        comments,
    )
}

fn assert_review_converged(run: &mut Converged) {
    let Converged {
        seed,
        mock,
        id,
        oleafly,
        peers,
        review,
        ..
    } = run;
    let review = review.as_ref().unwrap();
    let server = mock.doc_text(id);
    assert!(oleafly.doc.is_settled(), "seed {seed}: unsent work");
    assert_eq!(oleafly.doc.text(), server, "seed {seed}: OverleafDoc");
    assert_eq!(
        oleafly.editor.channel.text(),
        server,
        "seed {seed}: channel"
    );
    assert_eq!(oleafly.editor.doc.content, server, "seed {seed}: editor");
    assert_eq!(oleafly.doc.version(), mock.doc_version(id), "seed {seed}");
    for (name, peer) in PEERS.iter().zip(peers.iter_mut()) {
        assert!(peer.is_connected(), "seed {seed}: {name} was dropped");
        assert_eq!(peer.text(id), server, "seed {seed}: {name}");
    }
    oleafly.wire.assert_healthy();
    match oleafly.doc.format() {
        FormatState::ShareJs(ranges) => {
            let (ours, theirs) = (ranges.to_json(false), mock.ranges(id));
            let (our_changes, our_comments) = sharejs_ranges(&ours);
            let (their_changes, their_comments) = sharejs_ranges(&theirs);
            assert_eq!(our_changes, their_changes, "seed {seed}: tracked changes");
            assert_eq!(our_comments, their_comments, "seed {seed}: comments");
            for change in ranges.changes() {
                let Some(known) = change.id() else {
                    continue;
                };
                let matching = theirs["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| entry["id"] == known);
                assert!(
                    matching,
                    "seed {seed}: change id {known} is not on the server"
                );
            }
        }
        FormatState::HistoryOt(raw) => {
            let ours = history_ot_ranges(&raw.to_json().unwrap());
            let theirs = history_ot_ranges(&mock.raw_doc(id));
            assert_eq!(ours, theirs, "seed {seed}: raw doc");
        }
    }
    assert!(
        review.anchors > 20,
        "seed {seed}: {} anchors",
        review.anchors
    );
    assert!(
        review.rejects > 10,
        "seed {seed}: {} rejects",
        review.rejects
    );
    assert!(
        review.accepts > 5,
        "seed {seed}: {} accepts",
        review.accepts
    );
    assert!(
        review.tracked_inserts > 20,
        "seed {seed}: {} tracked inserts",
        review.tracked_inserts
    );
}

async fn review_converges(format: MockFormat) {
    for offset in 0..REVIEW_SEEDS {
        let mut run = Converged::start(format).await;
        run.mock.configure(|config| config.review = true);
        run.seed = seed().wrapping_add(offset);
        run.oleafly.check_ranges = true;
        run.review = Some(ReviewRun {
            rest: run.mock.peer("alice"),
            refreshes: 0,
            anchors: 0,
            rejects: 0,
            accepts: 0,
            tracked_inserts: 0,
        });
        let mut run = drive(run, REVIEW_ROUNDS).await;
        assert_review_converged(&mut run);
        if run.history_ot {
            assert_eq!(run.oleafly.repaired, 0, "seed {}", run.seed);
        }
    }
}

#[tokio::test]
async fn random_sharejs_review_units_converge_with_the_server() {
    review_converges(MockFormat::ShareJs).await;
}

#[tokio::test]
async fn random_history_ot_review_units_converge_with_the_server() {
    review_converges(MockFormat::HistoryOt).await;
}

#[tokio::test]
async fn a_reject_a_concurrent_edit_transformed_converges_with_the_text_once_and_no_marker() {
    let mut run = Converged::start(MockFormat::ShareJs).await;
    run.oleafly.check_ranges = true;
    let id = run.id.clone();
    run.peers[0].track_delete(&id, 1, 7);
    run.peers[0].sync();
    run.oleafly.process(usize::MAX, 0);
    let changes = run.oleafly.doc.review().changes;
    assert_eq!(changes.len(), 1, "{changes:?}");
    assert_eq!(changes[0].text, "section");
    run.oleafly.doc.queue_review(ReviewOp::Decide {
        changes: vec![Target::of(&changes[0])],
        decision: Decision::Reject,
    });
    run.peers[1].type_at(&id, 7, "x");
    run.peers[1].sync();
    let start = Instant::now();
    run.oleafly.send(&SendMode::Edit, start, 1);
    run.oleafly.process(usize::MAX, 2);
    assert_eq!(run.oleafly.rejoins, 1);
    assert_eq!(run.oleafly.repaired, 1);
    run.settle(start, Duration::ZERO);
    let server = run.mock.doc_text(&id);
    assert_eq!(server, "\\section{Introx}\nShared text.\n");
    assert_eq!(server.matches("section").count(), 1);
    assert_eq!(run.mock.ranges(&id), json!({}));
    assert!(run.oleafly.doc.review().changes.is_empty());
    assert_eq!(run.oleafly.doc.text(), server);
    assert_eq!(run.oleafly.editor.doc.content, server);
    assert!(run.oleafly.doc.take_dropped().is_empty());
    run.oleafly.wire.assert_healthy();
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

const REVIEW_FIXTURES: [&str; 12] = [
    "sharejs-tracked-change-ids",
    "sharejs-comment-anchors",
    "sharejs-comment-mismatch",
    "sharejs-reject",
    "sharejs-withdraw-own",
    "sharejs-cut-paste-comment",
    "history-ot-comment-anchors",
    "history-ot-comment-out-of-range",
    "history-ot-accept",
    "history-ot-reject",
    "history-ot-withdraw-own",
    "history-ot-cut-paste-comment",
];

fn fixture(name: &str, file: &str) -> Value {
    let path = std::path::Path::new(crate::test_support::overleaf_rt::FIXTURES)
        .join(name)
        .join(file);
    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
}

fn packed_ranges(ranges: &Value) -> Value {
    let mut packed = ranges.clone();
    for (list, fields) in [
        ("changes", ["i", "d"].as_slice()),
        ("comments", ["c"].as_slice()),
    ] {
        for entry in packed[list].as_array_mut().into_iter().flatten() {
            for field in fields {
                if let Some(text) = entry["op"][field].as_str() {
                    entry["op"][field] = json!(super::format::pack(text));
                }
            }
        }
    }
    packed
}

fn server_state(format: DocFormat, server: &Value) -> FormatState {
    match format {
        DocFormat::ShareJs => {
            FormatState::from_join(
                format,
                &json!(server["text"]
                    .as_str()
                    .unwrap()
                    .split('\n')
                    .map(super::format::pack)
                    .collect::<Vec<_>>()),
                &packed_ranges(&server["ranges"]),
            )
            .unwrap()
            .1
        }
        DocFormat::HistoryOt => {
            FormatState::from_join(format, &server["raw"], &Value::Null)
                .unwrap()
                .1
        }
    }
}

fn sent_updates(step: &Value) -> Vec<Value> {
    let mut updates = Vec::new();
    if step["result"]["outcome"] == "applied" {
        updates.push(step["sent"].clone());
    }
    for (_, web) in step["web"].as_object().into_iter().flatten() {
        updates.extend(web["sent"].as_array().cloned().unwrap_or_default());
    }
    updates
}

fn assert_like_server(name: &str, step: u64, state: &FormatState, text: &str, server: &Value) {
    assert_eq!(text, server["text"].as_str().unwrap(), "{name} step {step}");
    match state {
        FormatState::ShareJs(ranges) => {
            let ours = sharejs_ranges(&ranges.to_json(false));
            let theirs = sharejs_ranges(&server["ranges"]);
            assert!(
                ours == theirs,
                "{name} step {step}: {}",
                shape_difference(&ours, &theirs)
            );
            for change in ranges.changes() {
                let Some(id) = change.id() else {
                    continue;
                };
                let listed = server["ranges"]["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| entry["id"] == id);
                assert!(listed, "{name} step {step}: {id} was never given out");
            }
        }
        FormatState::HistoryOt(raw) => {
            let ours = history_ot_ranges(&raw.to_json().unwrap());
            let mut theirs = server["raw"].clone();
            for comment in theirs["comments"].as_array_mut().into_iter().flatten() {
                if comment.get("ranges").is_none() {
                    comment["ranges"] = json!([]);
                }
            }
            assert_eq!(ours, history_ot_ranges(&theirs), "{name} step {step}");
        }
    }
}

fn recorded_decision(label: &str) -> Option<Decision> {
    let label = label.to_lowercase();
    if label.contains("bob accepts") {
        Some(Decision::Accept)
    } else if label.contains("bob rejects") {
        Some(Decision::Reject)
    } else {
        None
    }
}

fn check_decision_encoding(
    name: &str,
    step: &Value,
    state: &FormatState,
    text: &str,
    sent: &Value,
) -> bool {
    let Some(decision) = recorded_decision(step["label"].as_str().unwrap_or_default()) else {
        return false;
    };
    let number = step["step"].as_u64().unwrap();
    match state {
        FormatState::HistoryOt(raw) => {
            let op = RawOpOf::from_json(&sent["op"][0]["textOperation"]).unwrap();
            let touched: Vec<String> = raw
                .review()
                .changes
                .into_iter()
                .filter(|change| {
                    raw.decision_op(std::slice::from_ref(&change.id), decision)
                        .is_some_and(|single| touches(&single, &op))
                })
                .map(|change| change.id)
                .collect();
            let ours = raw.decision_op(&touched, decision).unwrap();
            let wire = ours.to_json().unwrap();
            if decision == Decision::Reject {
                assert!(!unhides(&wire), "{name} step {number}: {wire}");
            }
            if decision == Decision::Reject && unhides(&sent["op"][0]["textOperation"]) {
                let (mut mine, mut theirs) = (raw.clone(), raw.clone());
                mine.apply(&ours).unwrap();
                theirs.apply(&op).unwrap();
                assert_eq!(
                    mine.to_json().unwrap(),
                    theirs.to_json().unwrap(),
                    "{name} step {number}"
                );
            } else {
                assert_eq!(wire, sent["op"][0]["textOperation"], "{name} step {number}");
            }
            true
        }
        FormatState::ShareJs(ranges) if decision == Decision::Reject => {
            let pieces = pieces_from_json(&sent["op"]).unwrap();
            if !pieces.iter().all(|piece| match piece {
                Piece::Insert { undo, .. } | Piece::Delete { undo, .. } => *undo,
                Piece::Comment { .. } => false,
            }) {
                return false;
            }
            let theirs = operation_of(text, &pieces).unwrap();
            let keys: Vec<u64> = ranges
                .changes()
                .iter()
                .filter(|change| {
                    ranges
                        .reject_op(&[change.key()], utf16_len(text))
                        .is_some_and(|single| touches_text(&single, &theirs))
                })
                .map(super::format::TrackedChange::key)
                .collect();
            let ours = ranges.reject_op(&keys, utf16_len(text)).unwrap();
            assert_eq!(ours, theirs, "{name} step {number}");
            true
        }
        FormatState::ShareJs(ranges) => {
            let pieces = pieces_from_json(&sent["op"]).unwrap();
            let accepts = recorded_accepts(&pieces);
            if accepts.is_empty() {
                return false;
            }
            let ours = accepted_pieces(&accepts);
            let after = |pieces: &[Piece]| operation_of(text, pieces).unwrap().apply(text).unwrap();
            assert_eq!(after(&ours), after(&pieces), "{name} step {number}");
            assert_eq!(after(&ours), text, "{name} step {number}");
            let (mut mine, mut theirs) = (ranges.clone(), ranges.clone());
            mine.apply_update(&ours, &Author::default()).unwrap();
            theirs.apply_update(&pieces, &Author::default()).unwrap();
            let shape = |ranges: &ShareJsRanges| -> Vec<(ChangeKind, Vec<u16>)> {
                let mut shape: Vec<_> = ranges
                    .changes()
                    .iter()
                    .map(|change| (change.kind, change.text.clone()))
                    .collect();
                shape.sort_by(|a, b| a.1.cmp(&b.1));
                shape
            };
            assert_eq!(shape(&mine), shape(&theirs), "{name} step {number}");
            for change in mine.changes() {
                assert!(
                    ranges
                        .changes()
                        .iter()
                        .any(|before| before.kind == change.kind
                            && before.at == change.at
                            && before.text == change.text),
                    "{name} step {number}: accepting moved {change:?}"
                );
            }
            true
        }
    }
}

fn recorded_accepts(pieces: &[Piece]) -> Vec<Accepted> {
    pieces
        .chunks(2)
        .filter_map(|pair| match pair {
            [Piece::Delete {
                p,
                text,
                undo: false,
            }, Piece::Insert {
                p: again,
                text: back,
                undo: false,
            }] if p == again && text == back => Some(Accepted {
                kind: ChangeKind::Insert,
                at: *p,
                text: text.clone(),
            }),
            [Piece::Insert {
                p,
                text,
                undo: true,
            }, Piece::Delete {
                p: again,
                text: gone,
                undo: false,
            }] if p == again && text == gone => Some(Accepted {
                kind: ChangeKind::Delete,
                at: *p,
                text: text.clone(),
            }),
            _ => None,
        })
        .collect()
}

use super::history_ot::RawOp as RawOpOf;

fn unhides(op: &Value) -> bool {
    op.as_array()
        .into_iter()
        .flatten()
        .any(|part| part.get("r").is_some() && part["tracking"]["type"].as_str() == Some("none"))
}

fn check_comment_encoding(state: &FormatState, text: &str, sent: &Value) -> bool {
    let edits = sent["op"].as_array().unwrap();
    match state {
        FormatState::ShareJs(_) => {
            let Ok(pieces) = pieces_from_json(&sent["op"]) else {
                return false;
            };
            let all_comments = pieces
                .iter()
                .all(|piece| matches!(piece, Piece::Comment { text, .. } if !text.is_empty()));
            if !all_comments {
                return false;
            }
            for (piece, wire) in pieces.iter().zip(edits) {
                let Piece::Comment {
                    p,
                    text: quoted,
                    thread,
                } = piece
                else {
                    return false;
                };
                let ours =
                    super::format::comment_piece(text, *p, p + utf16_len(quoted), thread).unwrap();
                assert_eq!(super::format::piece_to_json(&ours), *wire);
            }
            true
        }
        FormatState::HistoryOt(raw) => {
            let inside = |edit: &Value| {
                edit["ranges"].as_array().is_some_and(|ranges| {
                    ranges.iter().all(|range| {
                        range["pos"].as_u64().unwrap_or(u64::MAX)
                            + range["length"].as_u64().unwrap_or(u64::MAX)
                            <= raw.length() as u64
                    })
                })
            };
            let adds = edits
                .iter()
                .all(|edit| inside(edit) && edit.get("resolved").is_none());
            if !adds {
                return false;
            }
            for wire in edits {
                let ranges: Vec<(usize, usize)> = wire["ranges"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|range| {
                        let pos = range["pos"].as_u64().unwrap() as usize;
                        let end = pos + range["length"].as_u64().unwrap() as usize;
                        (raw.to_visible(pos), raw.to_visible(end))
                    })
                    .collect();
                if ranges.iter().any(|(from, to)| from >= to) || raw.visible_len() < 1 {
                    return false;
                }
                let ours = raw
                    .comment_edit(wire["commentId"].as_str().unwrap(), &ranges, false)
                    .unwrap();
                assert_eq!(ours.to_json().unwrap(), *wire);
            }
            true
        }
    }
}

fn touches(single: &RawOpOf, recorded: &RawOpOf) -> bool {
    let changed = |op: &RawOpOf| -> Vec<(usize, usize)> {
        let mut spans = Vec::new();
        let mut at = 0;
        for part in op.to_json().unwrap().as_array().unwrap() {
            match part.as_i64() {
                Some(count) if count >= 0 => at += count as usize,
                Some(count) => {
                    let count = count.unsigned_abs() as usize;
                    spans.push((at, at + count));
                    at += count;
                }
                None if part.get("r").is_some() => {
                    let count = part["r"].as_u64().unwrap() as usize;
                    if part.get("tracking").is_some() {
                        spans.push((at, at + count));
                    }
                    at += count;
                }
                None => {}
            }
        }
        spans
    };
    let recorded = changed(recorded);
    changed(single).iter().all(|span| {
        recorded
            .iter()
            .any(|other| other.0 <= span.0 && span.1 <= other.1)
    })
}

fn touches_text(single: &TextOperation, recorded: &TextOperation) -> bool {
    let composed = |op: &TextOperation| -> Vec<(usize, bool)> {
        let mut at = 0;
        let mut points = Vec::new();
        for component in op.components() {
            match component {
                oleafly_ot::Component::Retain(count) => at += count,
                oleafly_ot::Component::Insert(text) => points.push((at, !text.is_empty())),
                oleafly_ot::Component::Delete(count) => {
                    points.push((at, false));
                    at += count;
                }
            }
        }
        points
    };
    let recorded = composed(recorded);
    composed(single)
        .iter()
        .all(|point| recorded.iter().any(|other| other.0 == point.0))
}

#[test]
fn recorded_review_sessions_replay_ranges_ids_and_encodings_like_ce() {
    let (mut replayed, mut encoded, mut anchored) = (0, 0, 0);
    for name in REVIEW_FIXTURES {
        let steps = fixture(name, "steps.json");
        let scenario = fixture(name, "scenario.json");
        let users: std::collections::BTreeMap<String, String> = scenario["participants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|user| {
                (
                    user["name"].as_str().unwrap().to_string(),
                    user["userId"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        let format = DocFormat::from_join_type(steps["format"].as_str().unwrap()).unwrap();
        let doc = DocId(steps["doc"].as_str().unwrap().to_string());
        let list = steps["steps"].as_array().unwrap();
        let mut state = server_state(format, &list[0]["server"]);
        let mut text = list[0]["server"]["text"].as_str().unwrap().to_string();
        let mut version = list[0]["server"]["version"].as_u64().unwrap();
        let mut checked = 0;
        for step in &list[1..] {
            let number = step["step"].as_u64().unwrap();
            let server = &step["server"];
            let target = server["version"].as_u64().unwrap();
            let updates = sent_updates(step);
            if target == version {
                assert_like_server(name, number, &state, &text, server);
                continue;
            }
            if updates.len() as u64 != target - version {
                state = server_state(format, server);
                text = server["text"].as_str().unwrap().to_string();
                version = target;
                continue;
            }
            let who = users[step["who"].as_str().unwrap()].clone();
            for sent in updates {
                encoded += usize::from(check_decision_encoding(name, step, &state, &text, &sent));
                anchored += usize::from(check_comment_encoding(&state, &text, &sent));
                let update = AppliedUpdate {
                    doc: doc.clone(),
                    v: version,
                    op: Some(sent["op"].clone()),
                    source: None,
                    user_id: Some(who.clone()),
                    tc: sent["meta"]["tc"].as_str().map(str::to_string),
                    ts: None,
                    dup: false,
                    external: false,
                };
                let (steps, _) = state.decode_ranges(&text, &update, None).unwrap();
                for step in steps {
                    text = step.confirmed.apply(&text).unwrap();
                }
                version += 1;
            }
            assert_like_server(name, number, &state, &text, server);
            checked += 1;
        }
        replayed += checked;
    }
    assert!(replayed > 80, "only {replayed} steps replayed");
    assert!(encoded >= 11, "only {encoded} decisions checked");
    assert!(anchored >= 10, "only {anchored} comment anchors checked");
}
