use std::sync::Arc;
use std::time::Instant;

use loro::{ExportMode, LoroDoc, VersionVector};
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::{DocSink, LiveProject};
use oleafly_collab_protocol::projects::ProjectRole;

use crate::content;
use crate::measure::Percentiles;
use crate::typist::{phrase, Rng};

pub struct Cost {
    pub writers: usize,
    pub lag: usize,
    pub doc_bytes: usize,
    pub updates: usize,
    pub live: Percentiles,
    pub raw: Percentiles,
    pub live_total_ms: f64,
    pub raw_total_ms: f64,
}

struct Writer {
    doc: LoroDoc,
    sent: VersionVector,
    delivered: usize,
}

fn micros(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX)
}

pub fn measure(writers: usize, lag: usize, doc_bytes: usize, updates: usize, seed: u64) -> Cost {
    let mut rng = Rng::new(seed);
    let mut base = ProjectDoc::create().expect("project doc");
    let main = base
        .add_node(
            None,
            "main.tex",
            NodeKind::Text,
            None,
            &content::latex_main(doc_bytes, &mut rng),
        )
        .expect("main.tex");
    let snapshot = base.snapshot().expect("snapshot");
    let container = format!("text:{main}");
    let mut crowd: Vec<Writer> = (0..writers)
        .map(|_| {
            let doc = LoroDoc::new();
            doc.import(&snapshot).expect("writer import");
            let sent = doc.oplog_vv();
            Writer {
                doc,
                sent,
                delivered: 0,
            }
        })
        .collect();
    let mut observer = LiveProject::new(
        ProjectDoc::load(&snapshot).expect("observer"),
        0,
        ProjectRole::Editor,
    );
    let sink: DocSink = Arc::new(|_| {});
    observer.open_file(&main, sink).expect("open main.tex");
    let raw = LoroDoc::new();
    raw.import(&snapshot).expect("raw import");
    let mut log: Vec<Vec<u8>> = Vec::new();
    let mut live_samples = Vec::new();
    let mut raw_samples = Vec::new();
    let mut round = 0usize;
    while log.len() < updates {
        for writer in crowd.iter_mut() {
            if log.len() >= updates {
                break;
            }
            let text = writer.doc.get_text(container.as_str());
            let length = text.len_unicode();
            let at = rng.below(length + 1);
            if rng.chance(15) && length > 4 && at + 3 <= length {
                text.delete(at, 3).expect("delete");
            } else {
                text.insert(at, &phrase(&mut rng)).expect("insert");
            }
            writer.doc.commit();
            let payload = writer
                .doc
                .export(ExportMode::updates(&writer.sent))
                .expect("export");
            writer.sent = writer.doc.oplog_vv();
            log.push(payload);
            let seq = log.len() as u64;
            let started = Instant::now();
            observer
                .import_update(seq, &log[log.len() - 1])
                .expect("observer import");
            live_samples.push(micros(started));
            let started = Instant::now();
            raw.import(&log[log.len() - 1]).expect("raw import");
            raw_samples.push(micros(started));
        }
        round += 1;
        if round.is_multiple_of(lag.max(1)) {
            for writer in crowd.iter_mut() {
                writer
                    .doc
                    .import_batch(&log[writer.delivered..])
                    .expect("writer catch up");
                writer.delivered = log.len();
                writer.sent = writer.doc.oplog_vv();
            }
        }
    }
    let live_total_ms = live_samples.iter().sum::<u64>() as f64 / 1000.0;
    let raw_total_ms = raw_samples.iter().sum::<u64>() as f64 / 1000.0;
    assert_eq!(
        observer.doc().text(&main).expect("observer text"),
        raw.get_text(container.as_str()).to_string(),
        "the observer and the raw document disagree"
    );
    Cost {
        writers,
        lag,
        doc_bytes,
        updates,
        live: Percentiles::of(&mut live_samples),
        raw: Percentiles::of(&mut raw_samples),
        live_total_ms,
        raw_total_ms,
    }
}

impl Cost {
    pub fn print(&self) {
        println!(
            "  | {} writers | resync every {} rounds | {:.0} KB | {} updates | LiveProject::import_update p50 {:.2} ms, p95 {:.2} ms, mean {:.2} ms | raw LoroDoc::import p50 {:.2} ms, p95 {:.2} ms, mean {:.2} ms | {:.1}x |",
            self.writers,
            self.lag,
            self.doc_bytes as f64 / 1024.0,
            self.updates,
            self.live.p50,
            self.live.p95,
            self.live_total_ms / self.updates as f64,
            self.raw.p50,
            self.raw.p95,
            self.raw_total_ms / self.updates as f64,
            self.live_total_ms / self.raw_total_ms.max(0.001)
        );
    }
}
