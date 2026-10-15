mod large_changes;
mod people;

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use large_changes::{build_every, newest_snapshot, shared_with_alice};
use loro::{ExportMode, LoroDoc};
use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
use oleafly_collab_protocol::frames::{FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{BatchId, DeviceId, SharedProjectId};
use oleafly_server::projects::{self, LoggedUpdate};
use oleafly_server::snapshots;
use people::{
    call, connect, first_snapshot, raw_envelope, send_update, signed_by, stage, subscribe, Person,
    Socket, Stage,
};
use reqwest::{Method, StatusCode};
use serde_json::json;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static ONE_AT_A_TIME: Mutex<()> = Mutex::const_new(());

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

const LARGE_FILE: usize = if cfg!(debug_assertions) {
    224 * 1024
} else {
    1_500 * 1024
};
const BIG: &str = "text:big";
const WRITERS: u64 = 6;
const CLOSING: usize = 14;

fn paper(bytes: usize, title: &str) -> String {
    let mut text = String::with_capacity(bytes + 256);
    let mut section = 0;
    while text.len() < bytes {
        text.push_str(&format!(
            "\\section{{{title} {section}}}\nMüller and Jörg measured {section} samples, and the mean rose by {} percent.\n\n",
            section % 97
        ));
        section += 1;
    }
    text
}

fn step(doc: &LoroDoc, peer: u64, edit: impl FnOnce(&LoroDoc)) -> Vec<u8> {
    doc.set_peer_id(peer).expect("peer");
    let before = doc.oplog_vv();
    edit(doc);
    doc.commit();
    doc.export(ExportMode::updates(&before)).expect("update")
}

fn typed(doc: &LoroDoc, round: usize) {
    let text = doc.get_text("text");
    let at = text.len_unicode();
    text.insert(at, &format!(" line {round}")).expect("insert");
    if round.is_multiple_of(7) {
        text.delete(at / 2, 2).expect("delete");
    }
}

fn lab(large: &str) -> (LoroDoc, Vec<Vec<u8>>) {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    let mut log: Vec<Vec<u8>> = (0..200)
        .map(|round| step(&doc, 21, |doc| typed(doc, round)))
        .collect();
    let source = doc.fork();
    let note = step(&doc, 24, |doc| {
        doc.get_text("text").insert(0, "% notes\n").expect("insert");
    });
    log.push(step(&source, 22, |doc| {
        doc.get_text(BIG).insert(0, large).expect("insert");
    }));
    source.import(&note).expect("the note joins the source");
    log.insert(log.len() - 1, note);
    log.extend((200..220).map(|round| step(&source, 23, |doc| typed(doc, round))));
    (source, log)
}

#[derive(Clone, Copy)]
struct Cost {
    took: Duration,
    spike: usize,
}

struct Measuring {
    live: usize,
    started: Instant,
}

fn plain_import(log: &[Vec<u8>]) -> Cost {
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    let measuring = start_measuring();
    for update in log {
        doc.import(update).expect("a logged change imports");
    }
    measured(measuring)
}

fn start_measuring() -> Measuring {
    let live = LIVE.load(Ordering::Relaxed);
    PEAK.store(live, Ordering::Relaxed);
    Measuring {
        live,
        started: Instant::now(),
    }
}

fn measured(measuring: Measuring) -> Cost {
    Cost {
        took: measuring.started.elapsed(),
        spike: PEAK.load(Ordering::Relaxed).saturating_sub(measuring.live),
    }
}

fn logged(seq: u64, project: SharedProjectId, device: DeviceId, payload: Vec<u8>) -> LoggedUpdate {
    let envelope = Envelope {
        v: 1,
        project_id: project,
        batch_id: BatchId::new_v7(),
        device_id: device,
        mode: EnvelopeMode::Plain,
        key_epoch: None,
        payload,
        signature: Vec::new(),
    };
    LoggedUpdate {
        seq,
        device,
        envelope: serde_json::to_vec(&envelope).expect("json"),
    }
}

fn assert_small_and_quick(what: &str, cost: Cost, plain: Cost) {
    assert!(
        cost.spike < 40 * LARGE_FILE && cost.took * 3 < plain.took,
        "{what} took {:?} and held {} bytes at its peak for a {LARGE_FILE} byte file, a plain import of the same changes took {:?}",
        cost.took, cost.spike, plain.took
    );
}

async fn append(stage: &Stage, project: SharedProjectId, log: &[Vec<u8>]) {
    let person = &stage.alice;
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    let stored: Vec<_> = log
        .iter()
        .map(|update| {
            let envelope = signed_by(person, &person.device, project, update);
            (
                envelope.batch_id,
                serde_json::to_vec(&envelope).expect("json"),
                update.clone(),
            )
        })
        .collect();
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            for (batch, envelope, update) in stored {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &envelope, 1)?;
            }
            Ok(())
        })
        .await
        .expect("append changes");
}

async fn reply(socket: &mut Socket) -> ServerFrame {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(1_800), socket.next())
            .await
            .expect("a reply in time")
            .expect("the socket stays open")
            .expect("a message");
        let Message::Text(text) = message else {
            continue;
        };
        match serde_json::from_str(text.as_str()).expect("server frame") {
            ServerFrame::Update { .. }
            | ServerFrame::Presence { .. }
            | ServerFrame::PresenceLeft { .. } => {}
            frame => return frame,
        }
    }
}

fn person(stage: &Stage, index: u64) -> &Person {
    if index.is_multiple_of(2) {
        &stage.alice
    } else {
        &stage.bob
    }
}

#[test]
fn replaying_a_log_that_holds_a_large_file_someone_else_added_stays_small_and_quick() {
    let _alone = ONE_AT_A_TIME.blocking_lock();
    let project = SharedProjectId::new_v7();
    let laptop = DeviceId::new_v7();
    let large = paper(LARGE_FILE, "Results");
    let (source, log) = lab(&large);
    let entries: Vec<LoggedUpdate> = log
        .iter()
        .zip(1..)
        .map(|(update, seq)| logged(seq, project, laptop, update.clone()))
        .collect();

    let measuring = start_measuring();
    let built = snapshots::replay(project, &first_snapshot(), &entries, &HashMap::new());
    let cost = measured(measuring);
    let plain = plain_import(&log);

    let loaded = LoroDoc::new();
    loaded.import(&built.expect("a snapshot")).expect("loads");
    assert_eq!(loaded.get_text(BIG).to_string(), large);
    assert_eq!(
        loaded.get_text("text").to_string(),
        source.get_text("text").to_string()
    );
    assert_small_and_quick("replaying the log", cost, plain);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn everyone_closing_a_project_with_a_large_file_at_once_builds_one_snapshot_quickly() {
    let _alone = ONE_AT_A_TIME.lock().await;
    let large = paper(LARGE_FILE, "Results");
    let (source, log) = lab(&large);
    let head = log.len() as u64;
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    build_every(&stage, 10);
    append(&stage, project, &log).await;
    let url = format!(
        "{}/api/v1/projects/{project}/snapshot?seq={head}",
        stage.server.url()
    );

    let client = reqwest::Client::new();
    let closing: Vec<_> = (0..CLOSING)
        .map(|index| {
            client
                .put(&url)
                .bearer_auth(person(&stage, index as u64).token())
                .send()
        })
        .collect();

    let measuring = start_measuring();
    let replies: Vec<reqwest::Response> = futures_util::future::join_all(closing)
        .await
        .into_iter()
        .map(|reply| reply.expect("hint"))
        .collect();
    let cost = measured(measuring);
    let plain = plain_import(&log);

    for reply in &replies {
        assert_eq!(reply.status(), StatusCode::NO_CONTENT);
    }
    let rows = stage
        .server
        .state()
        .db
        .call(move |conn| projects::snapshots(conn, project))
        .await
        .expect("rows");
    let seqs: Vec<u64> = rows.iter().map(|row| row.seq).collect();
    assert_eq!(seqs, vec![head, 0]);
    let (seq, bytes) = newest_snapshot(&stage, project).await;
    assert_eq!(seq, Some(head));
    let loaded = LoroDoc::new();
    loaded.import(&bytes).expect("loads");
    assert_eq!(loaded.get_text(BIG).to_string(), large);
    assert_eq!(
        loaded.get_text("text").to_string(),
        source.get_text("text").to_string()
    );
    assert_small_and_quick("building the snapshot", cost, plain);
}

async fn shared_with_comments_off(stage: &Stage, log: &[Vec<u8>]) -> SharedProjectId {
    let project = shared_with_alice(stage).await;
    let switched = call(
        &stage.server,
        Method::PATCH,
        &format!("/api/v1/projects/{project}"),
        stage.bob.token(),
        Some(json!({ "comments_enabled": false })),
    )
    .await;
    assert_eq!(switched.status(), StatusCode::OK);
    append(stage, project, log).await;
    project
}

struct Writer {
    index: u64,
    doc: LoroDoc,
    socket: Socket,
}

impl Writer {
    async fn open(stage: &Stage, project: SharedProjectId, source: &LoroDoc, index: u64) -> Writer {
        let doc = source.fork();
        doc.set_peer_id(300 + index).expect("peer");
        let mut socket = connect(&stage.server, person(stage, index)).await;
        let head = stage
            .server
            .state()
            .db
            .call(move |conn| {
                Ok(projects::project_row(conn, project)?.map_or(0, |row| row.head_seq))
            })
            .await
            .expect("head");
        assert!(matches!(
            subscribe(&mut socket, project, head).await,
            ServerFrame::Subscribed { .. }
        ));
        Writer { index, doc, socket }
    }

    fn change(&self, edit: impl FnOnce(&LoroDoc)) -> Vec<u8> {
        step(&self.doc, 300 + self.index, edit)
    }

    async fn send(&mut self, stage: &Stage, project: SharedProjectId, update: &[u8]) {
        let envelope = raw_envelope(person(stage, self.index), project, update);
        send_update(&mut self.socket, &envelope).await;
    }

    async fn reply(&mut self) -> ServerFrame {
        reply(&mut self.socket).await
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn with_comments_off_people_typing_beside_a_large_file_and_adding_another_are_checked_quickly(
) {
    let _alone = ONE_AT_A_TIME.lock().await;
    let large = paper(LARGE_FILE, "Results");
    let (source, log) = lab(&large);
    let stage = stage().await;
    let project = shared_with_comments_off(&stage, &log).await;
    let mut writers = Vec::new();
    for index in 0..WRITERS {
        writers.push(Writer::open(&stage, project, &source, index).await);
    }

    let measuring = start_measuring();
    for writer in &mut writers {
        let update = writer.change(|doc| typed(doc, 1_000));
        writer.send(&stage, project, &update).await;
    }
    for writer in &mut writers {
        assert!(matches!(writer.reply().await, ServerFrame::Ack { .. }));
    }
    let typing = measured(measuring);

    let another = paper(LARGE_FILE, "Methods");
    let adder = &mut writers[0];
    let update = adder.change(|doc| {
        doc.get_text("text:methods")
            .insert(0, &another)
            .expect("insert");
    });
    let measuring = start_measuring();
    adder.send(&stage, project, &update).await;
    assert!(matches!(adder.reply().await, ServerFrame::Ack { .. }));
    let adding = measured(measuring);
    let plain = plain_import(&log);

    assert_small_and_quick("checking everyone's typing", typing, plain);
    assert_small_and_quick("checking the added file", adding, plain);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn with_comments_off_a_change_from_a_device_that_fell_behind_does_not_make_the_server_read_the_log_again(
) {
    let _alone = ONE_AT_A_TIME.lock().await;
    let large = paper(LARGE_FILE, "Results");
    let (source, log) = lab(&large);
    let stage = stage().await;
    let project = shared_with_comments_off(&stage, &log).await;
    let mut alice = Writer::open(&stage, project, &source, 0).await;
    let mut behind = Writer::open(&stage, project, &source, 1).await;
    let update = alice.change(|doc| typed(doc, 1_000));
    alice.send(&stage, project, &update).await;
    assert!(matches!(alice.reply().await, ServerFrame::Ack { .. }));
    let _never_arrived = behind.change(|doc| typed(doc, 1_001));
    let stale = behind.change(|doc| typed(doc, 1_002));
    behind.send(&stage, project, &stale).await;
    assert!(matches!(
        behind.reply().await,
        ServerFrame::Error {
            code: FrameErrorCode::BadFrame,
            ..
        }
    ));

    let measuring = start_measuring();
    let update = alice.change(|doc| typed(doc, 1_003));
    alice.send(&stage, project, &update).await;
    assert!(matches!(alice.reply().await, ServerFrame::Ack { .. }));
    let next = measured(measuring);

    assert!(
        next.spike < LARGE_FILE,
        "the next check held {} bytes at its peak, as if it read the whole log again",
        next.spike
    );
}
