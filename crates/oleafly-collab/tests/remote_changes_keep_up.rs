use std::borrow::Cow;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use loro::{ExportMode, IdSpan, LoroDoc, VersionVector};
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::{Arrival, LiveProject};
use oleafly_collab_protocol::projects::ProjectRole;

const WRITERS: usize = 4;
const ROUNDS: usize = 24;
const LAG: usize = 2;
const BIG_FILE: usize = 1_500_000;
const PASTE: usize = 70_000;

struct Load {
    copy: Vec<u8>,
    stream: Vec<Vec<u8>>,
}

struct Seed(u64);

impl Seed {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

fn lines(bytes: usize, word: &str) -> String {
    let mut text = String::with_capacity(bytes + 80);
    let mut line = 0;
    while text.len() < bytes {
        text.push_str(&format!(
            "{word} line {line} with a few ordinary words in it.\n"
        ));
        line += 1;
    }
    text
}

fn own_changes(writer: &LoroDoc, from: i32) -> Vec<u8> {
    let peer = writer.peer_id();
    let to = writer.oplog_vv().get(&peer).copied().unwrap_or(0);
    writer
        .export(ExportMode::UpdatesInRange {
            spans: Cow::Owned(vec![IdSpan::new(peer, from, to)]),
        })
        .unwrap()
}

fn people_typing_through_the_arrival_of_a_large_file(paste_rounds: &[usize]) -> Load {
    let mut seed = Seed(17);
    let mut owner = ProjectDoc::create().unwrap();
    let main = owner
        .add_node(
            None,
            "main.tex",
            NodeKind::Text,
            None,
            &lines(120_000, "main"),
        )
        .unwrap();
    let before_big = owner.snapshot().unwrap();
    owner
        .add_node(
            None,
            "big.tex",
            NodeKind::Text,
            None,
            &lines(BIG_FILE, "big"),
        )
        .unwrap();
    let copy = owner.snapshot().unwrap();
    let mut writers: Vec<LoroDoc> = (0..WRITERS)
        .map(|index| {
            let writer = LoroDoc::new();
            writer.import(&before_big).unwrap();
            writer.set_peer_id(u64::MAX - 1 - index as u64).unwrap();
            writer
        })
        .collect();
    let paster = LoroDoc::new();
    paster.import(&copy).unwrap();
    paster.set_peer_id(u64::MAX - 1 - WRITERS as u64).unwrap();
    let mut own: Vec<Vec<Vec<u8>>> = vec![Vec::new(); WRITERS];
    let mut sent = [0i32; WRITERS];
    let mut in_flight: Vec<Vec<(usize, Vec<u8>)>> = Vec::new();
    let mut stream = Vec::new();
    for round in 0..ROUNDS {
        let mut out = Vec::new();
        for (index, writer) in writers.iter().enumerate() {
            let text = writer.get_text(format!("text:{main}"));
            let at = (seed.next() as usize) % (text.len_unicode() + 1);
            text.insert(at, &format!("[w{index} r{round}]")).unwrap();
            writer.commit();
            let payload = own_changes(writer, sent[index]);
            own[index].push(payload.clone());
            out.push((index, payload));
            sent[index] = writer
                .oplog_vv()
                .get(&writer.peer_id())
                .copied()
                .unwrap_or(0);
        }
        if round == 1 {
            for (index, writer) in writers.iter_mut().enumerate() {
                let caught_up = LoroDoc::new();
                caught_up.import(&copy).unwrap();
                caught_up.import_batch(&own[index]).unwrap();
                caught_up.export(ExportMode::Snapshot).unwrap();
                caught_up.set_peer_id(writer.peer_id()).unwrap();
                *writer = caught_up;
            }
        }
        if paste_rounds.contains(&round) {
            let text = paster.get_text(format!("text:{main}"));
            let from = paster
                .oplog_vv()
                .get(&paster.peer_id())
                .copied()
                .unwrap_or(0);
            text.insert(text.len_unicode() / 2, &lines(PASTE, "pasted"))
                .unwrap();
            paster.commit();
            out.push((WRITERS, own_changes(&paster, from)));
        }
        in_flight.push(out);
        if in_flight.len() > LAG {
            let arrived = in_flight.remove(0);
            for (index, writer) in writers.iter().enumerate() {
                let theirs: Vec<Vec<u8>> = arrived
                    .iter()
                    .filter(|(from, _)| *from != index && *from < WRITERS)
                    .map(|(_, payload)| payload.clone())
                    .collect();
                writer.import_batch(&theirs).unwrap();
                writer.export(ExportMode::Snapshot).unwrap();
            }
            stream.extend(arrived.into_iter().map(|(_, payload)| payload));
        }
    }
    for arrived in in_flight {
        stream.extend(arrived.into_iter().map(|(_, payload)| payload));
    }
    Load { copy, stream }
}

fn alone() -> MutexGuard<'static, ()> {
    static TIMED: Mutex<()> = Mutex::new(());
    TIMED.lock().unwrap_or_else(PoisonError::into_inner)
}

fn typing_only() -> &'static Load {
    static LOAD: OnceLock<Load> = OnceLock::new();
    LOAD.get_or_init(|| people_typing_through_the_arrival_of_a_large_file(&[]))
}

fn typing_and_pasting() -> &'static Load {
    static LOAD: OnceLock<Load> = OnceLock::new();
    LOAD.get_or_init(|| people_typing_through_the_arrival_of_a_large_file(&[6, 14]))
}

fn plain_batch(snapshot: &[u8], payloads: &[Vec<u8>]) -> Duration {
    let plain = LoroDoc::new();
    plain.import(snapshot).unwrap();
    let started = Instant::now();
    plain.import_batch(payloads).unwrap();
    started.elapsed()
}

fn one_at_a_time(doc: &mut ProjectDoc, payloads: &[Vec<u8>]) -> Duration {
    let started = Instant::now();
    for payload in payloads {
        doc.import(payload).unwrap();
    }
    started.elapsed()
}

fn framed(records: &[Vec<u8>]) -> Vec<u8> {
    let mut log = Vec::new();
    for record in records {
        log.extend_from_slice(&u32::try_from(record.len()).unwrap().to_le_bytes());
        log.extend_from_slice(record);
    }
    log
}

fn saved_project(dir: &Path, load: &Load, per_save: usize) -> Vec<Vec<u8>> {
    let builder = LoroDoc::new();
    builder.import(&load.copy).unwrap();
    let mut records = Vec::new();
    for group in load.stream.chunks(per_save) {
        let before: VersionVector = builder.oplog_vv();
        builder.import_batch(group).unwrap();
        records.push(builder.export(ExportMode::updates(&before)).unwrap());
    }
    std::fs::write(dir.join("doc.bin"), &load.copy).unwrap();
    std::fs::write(dir.join("doc.log"), framed(&records)).unwrap();
    std::fs::write(dir.join("sync.json"), br#"{"last_seq":0,"confirmed":""}"#).unwrap();
    records
}

#[test]
fn a_copy_that_took_in_many_changes_from_new_writers_imports_the_next_ones_as_fast_as_a_fresh_copy()
{
    let _alone = alone();
    let load = typing_only();
    let half = load.stream.len() / 2;
    let mut kept = ProjectDoc::load(&load.copy).unwrap();
    one_at_a_time(&mut kept, &load.stream[..half]);
    let twin = LoroDoc::new();
    twin.import(&load.copy).unwrap();
    twin.import_batch(&load.stream[..half]).unwrap();
    let mut fresh = ProjectDoc::load(&twin.export(ExportMode::Snapshot).unwrap()).unwrap();

    let after_fresh = one_at_a_time(&mut fresh, &load.stream[half..]);
    let after_kept = one_at_a_time(&mut kept, &load.stream[half..]);

    assert_eq!(kept.version(), fresh.version());
    assert!(
        after_kept.as_secs_f64() <= 2.0 * after_fresh.as_secs_f64(),
        "the copy that kept running took {after_kept:?} for {} changes, a fresh copy at the same version took {after_fresh:?}",
        load.stream.len() - half
    );
}

#[test]
fn a_project_with_a_long_saved_change_log_opens_within_a_few_plain_batch_imports() {
    let _alone = alone();
    let load = typing_only();
    let dir = tempfile::tempdir().unwrap();
    let records = saved_project(dir.path(), load, WRITERS);
    let plain = plain_batch(&load.copy, &records);

    let started = Instant::now();
    let opened = LiveProject::load(dir.path(), ProjectRole::Editor).unwrap();
    let took = started.elapsed();

    let reference = LoroDoc::new();
    reference.import(&load.copy).unwrap();
    reference.import_batch(&load.stream).unwrap();
    assert_eq!(opened.doc().version(), reference.oplog_vv());
    assert!(
        took.as_secs_f64() <= 4.0 * plain.as_secs_f64() + 0.05,
        "opening a project with {} saved records took {took:?}, one plain batch import of them took {plain:?}",
        records.len()
    );
}

fn pasted_by_one_writer(pastes: usize) -> (Vec<u8>, Vec<Vec<u8>>) {
    let mut owner = ProjectDoc::create().unwrap();
    let main = owner
        .add_node(
            None,
            "main.tex",
            NodeKind::Text,
            None,
            &lines(120_000, "main"),
        )
        .unwrap();
    owner
        .add_node(
            None,
            "big.tex",
            NodeKind::Text,
            None,
            &lines(BIG_FILE, "big"),
        )
        .unwrap();
    let copy = owner.snapshot().unwrap();
    let paster = LoroDoc::new();
    paster.import(&copy).unwrap();
    paster.set_peer_id(u64::MAX - 100).unwrap();
    let mut payloads = Vec::new();
    for paste in 0..pastes {
        let from = paster
            .oplog_vv()
            .get(&paster.peer_id())
            .copied()
            .unwrap_or(0);
        let text = paster.get_text(format!("text:{main}"));
        text.insert(
            text.len_unicode(),
            &lines(200_000, &format!("paste {paste}")),
        )
        .unwrap();
        paster.commit();
        payloads.push(own_changes(&paster, from));
    }
    (copy, payloads)
}

#[test]
fn pastes_from_one_writer_onto_an_idle_copy_import_about_as_fast_as_plain_imports_and_resends_cost_nothing(
) {
    let _alone = alone();
    let (copy, pastes) = pasted_by_one_writer(5);
    assert!(pastes.iter().all(|payload| payload.len() >= 64 * 1024));
    let plain = LoroDoc::new();
    plain.import(&copy).unwrap();
    plain.import(&pastes[0]).unwrap();
    let started = Instant::now();
    for payload in &pastes[1..] {
        plain.import(payload).unwrap();
    }
    let plain_took = started.elapsed();
    let mut live = LiveProject::new(ProjectDoc::load(&copy).unwrap(), 0, ProjectRole::Editor);
    assert!(live.import_update(1, &pastes[0]).unwrap());

    let started = Instant::now();
    for (index, payload) in pastes[1..].iter().enumerate() {
        assert!(live.import_update(index as u64 + 2, payload).unwrap());
    }
    let took = started.elapsed();

    assert_eq!(live.doc().version(), plain.oplog_vv());
    assert!(
        took.as_secs_f64() <= 3.0 * plain_took.as_secs_f64() + 0.05,
        "{} pastes onto the copy's own head took {took:?}, plain imports took {plain_took:?}",
        pastes.len() - 1
    );
    let started = Instant::now();
    let _ = plain.fork();
    let fork_took = started.elapsed();
    let started = Instant::now();
    assert!(live.import_update(9, &pastes[2]).unwrap());
    let resent = started.elapsed();
    assert_eq!(live.doc().version(), plain.oplog_vv());
    assert!(
        resent * 4 < fork_took,
        "a paste the copy already held took {resent:?}, one fork of the document takes {fork_took:?}"
    );
}

#[test]
fn a_queue_of_concurrent_changes_some_over_64_kib_is_taken_in_within_a_few_plain_batch_imports() {
    let _alone = alone();
    let load = typing_and_pasting();
    let large = load
        .stream
        .iter()
        .filter(|payload| payload.len() >= 64 * 1024)
        .count();
    assert!(large >= 2 && large * 10 < load.stream.len());
    let plain = plain_batch(&load.copy, &load.stream);
    let mut live = LiveProject::new(
        ProjectDoc::load(&load.copy).unwrap(),
        0,
        ProjectRole::Editor,
    );
    let arrivals: Vec<Arrival> = load
        .stream
        .iter()
        .enumerate()
        .map(|(index, payload)| Arrival {
            seq: index as u64 + 1,
            payload: payload.clone(),
            device: None,
            author: None,
        })
        .collect();

    let started = Instant::now();
    let taken = live.import_arrivals(arrivals).unwrap();
    let took = started.elapsed();

    let reference = LoroDoc::new();
    reference.import(&load.copy).unwrap();
    reference.import_batch(&load.stream).unwrap();
    assert_eq!(taken, load.stream.len());
    assert_eq!(live.last_seq(), load.stream.len() as u64);
    assert_eq!(live.doc().version(), reference.oplog_vv());
    assert!(
        took.as_secs_f64() <= 12.0 * plain.as_secs_f64() + 0.05,
        "taking in {} queued changes ({large} of 64 KiB or more) took {took:?}, one plain batch import of them took {plain:?}",
        load.stream.len()
    );
}
