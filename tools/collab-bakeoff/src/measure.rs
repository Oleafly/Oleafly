use std::panic::{self, AssertUnwindSafe};
use std::time::Instant;

use serde::Serialize;

use crate::automerge_engine::AutomergeEngine;
use crate::check;
use crate::engine::{Engine, EngineError, NodeKind};
use crate::heap;
use crate::loro_engine::LoroEngine;
use crate::matrix::{panic_message, EngineKind};
use crate::rng::Rng;
use crate::sim::{apply_local, Sim};
use crate::trace::{self, MonthsConfig, Op, Scale, TraceConfig, WORDS};
use crate::yrs_engine::YrsEngine;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct MeasureConfig {
    pub seed: u64,
    pub trace: TraceConfig,
    pub months: MonthsConfig,
    pub propagation_edits: usize,
    pub latency_ms: u64,
    pub jitter_ms: u64,
    pub rejoin_edits: usize,
}

impl MeasureConfig {
    pub fn full(seed: u64, months: MonthsConfig) -> MeasureConfig {
        MeasureConfig {
            seed,
            trace: TraceConfig::full(),
            months,
            propagation_edits: 2_000,
            latency_ms: 40,
            jitter_ms: 20,
            rejoin_edits: 1_000,
        }
    }

    pub fn smoke(seed: u64) -> MeasureConfig {
        MeasureConfig {
            seed,
            trace: TraceConfig::small(),
            months: MonthsConfig::smoke(),
            propagation_edits: 50,
            latency_ms: 40,
            jitter_ms: 20,
            rejoin_edits: 30,
        }
    }

    pub fn for_scale(scale: Scale, seed: u64, months: MonthsConfig) -> MeasureConfig {
        match scale {
            Scale::Small => MeasureConfig::smoke(seed),
            Scale::Full => MeasureConfig::full(seed, months),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Measurement {
    pub engine: String,
    pub propagation_p50_ms: f64,
    pub propagation_p95_ms: f64,
    pub propagation_max_ms: f64,
    pub update_bytes_mean: f64,
    pub cold_join_ms: f64,
    pub join_download_bytes: usize,
    pub peak_join_bytes: usize,
    pub rejoin_ms: f64,
    pub rejoin_bytes: usize,
    pub months_days: u32,
    pub months_ops: usize,
    pub snapshot_bytes: usize,
    pub compact_bytes: usize,
    pub save_bytes: usize,
    pub server_log_bytes: usize,
    pub peak_months_bytes: usize,
    pub error: Option<String>,
}

pub fn percentile(sorted: &[f64], percent: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (percent / 100.0 * (sorted.len() - 1) as f64).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

pub fn measure_kind(kind: EngineKind, config: &MeasureConfig) -> Measurement {
    let result = panic::catch_unwind(AssertUnwindSafe(|| match kind {
        EngineKind::Loro => measure::<LoroEngine>(config),
        EngineKind::Yrs => measure::<YrsEngine>(config),
        EngineKind::Automerge => measure::<AutomergeEngine>(config),
    }));
    result.unwrap_or_else(|payload| Measurement {
        engine: kind.name().to_owned(),
        error: Some(format!("panic: {}", panic_message(&*payload))),
        ..Measurement::default()
    })
}

pub fn measure<E: Engine>(config: &MeasureConfig) -> Measurement {
    let mut measurement = Measurement {
        engine: E::NAME.to_owned(),
        months_days: config.months.days,
        ..Measurement::default()
    };
    if let Err(error) = measure_into::<E>(config, &mut measurement) {
        measurement.error = Some(error.to_string());
    }
    measurement
}

fn measure_into<E: Engine>(
    config: &MeasureConfig,
    out: &mut Measurement,
) -> Result<(), EngineError> {
    let scenario = trace::generate(config.trace, config.seed);
    let mut sim = Sim::<E>::start(&scenario)?;
    for op in &scenario.ops {
        sim.apply(op);
    }
    sim.settle();
    propagation(&mut sim, config, out)?;
    cold_join(&sim, out)?;
    rejoin(&mut sim, config, out)?;
    simulate_months::<E>(config, out)
}

fn missing(actor: usize) -> EngineError {
    EngineError::Other(format!("no replica for actor {actor}"))
}

fn text_ids<E: Engine>(sim: &Sim<E>) -> Result<Vec<String>, EngineError> {
    let owner = sim.replicas.get(&0).ok_or_else(|| missing(0))?;
    let ids: Vec<String> = owner
        .engine
        .nodes()?
        .into_iter()
        .filter(|node| node.kind == NodeKind::Text)
        .map(|node| node.id)
        .collect();
    if ids.is_empty() {
        Err(EngineError::Other("no text files to edit".to_owned()))
    } else {
        Ok(ids)
    }
}

fn one_way_ms(rng: &mut Rng, config: &MeasureConfig) -> f64 {
    (config.latency_ms + rng.below(2 * config.jitter_ms + 1)) as f64 - config.jitter_ms as f64
}

fn word(rng: &mut Rng) -> String {
    format!("{} ", rng.pick(&WORDS).copied().unwrap_or("x"))
}

fn exchange<E: Engine>(
    sender: &mut E,
    sent: &mut Vec<u8>,
    receiver: &mut E,
    ids: &[String],
    config: &MeasureConfig,
) -> Result<(Vec<f64>, usize), EngineError> {
    let mut rng = Rng::new(config.seed ^ 0xfeed);
    let mut samples = Vec::with_capacity(config.propagation_edits);
    let mut bytes = 0;
    for _ in 0..config.propagation_edits {
        let edit = Op::Edit {
            actor: 1,
            id: ids[rng.index(ids.len())].clone(),
            at: rng.next_u64(),
            delete: 0,
            insert: word(&mut rng),
        };
        apply_local(sender, &edit)?;
        let started = Instant::now();
        let update = sender.export_since(sent)?;
        *sent = sender.version();
        let exported = started.elapsed();
        let started = Instant::now();
        receiver.import(&update)?;
        let imported = started.elapsed();
        let network = one_way_ms(&mut rng, config) + one_way_ms(&mut rng, config);
        samples.push((exported + imported).as_secs_f64() * 1000.0 + network);
        bytes += update.len();
    }
    Ok((samples, bytes))
}

fn propagation<E: Engine>(
    sim: &mut Sim<E>,
    config: &MeasureConfig,
    out: &mut Measurement,
) -> Result<(), EngineError> {
    let ids = text_ids(sim)?;
    let mut sender = sim.replicas.remove(&1).ok_or_else(|| missing(1))?;
    let Some(mut receiver) = sim.replicas.remove(&2) else {
        sim.replicas.insert(1, sender);
        return Err(missing(2));
    };
    let base_sent = sender.sent.clone();
    let result = exchange(
        &mut sender.engine,
        &mut sender.sent,
        &mut receiver.engine,
        &ids,
        config,
    );
    sender.sent = base_sent;
    sender.dirty = true;
    sim.replicas.insert(1, sender);
    sim.replicas.insert(2, receiver);
    let (mut samples, bytes) = result?;
    sim.sync(1);
    sim.sync(2);
    samples.sort_by(f64::total_cmp);
    out.propagation_p50_ms = percentile(&samples, 50.0);
    out.propagation_p95_ms = percentile(&samples, 95.0);
    out.propagation_max_ms = samples.last().copied().unwrap_or_default();
    out.update_bytes_mean = if samples.is_empty() {
        0.0
    } else {
        bytes as f64 / samples.len() as f64
    };
    Ok(())
}

fn cold_join<E: Engine>(sim: &Sim<E>, out: &mut Measurement) -> Result<(), EngineError> {
    out.join_download_bytes = sim.server.newest_snapshot().map_or(0, |snapshot| {
        snapshot.bytes.len()
            + sim.server.since(snapshot.upto).map_or(0, |batches| {
                batches.iter().map(|batch| batch.bytes.len()).sum::<usize>()
            })
    });
    let baseline = heap::reset_peak();
    let started = Instant::now();
    let joined = check::replay::<E>(&sim.server)?;
    joined.materialize()?;
    out.cold_join_ms = started.elapsed().as_secs_f64() * 1000.0;
    out.peak_join_bytes = heap::peak().saturating_sub(baseline);
    Ok(())
}

fn rejoin<E: Engine>(
    sim: &mut Sim<E>,
    config: &MeasureConfig,
    out: &mut Measurement,
) -> Result<(), EngineError> {
    let ids = text_ids(sim)?;
    let mut rng = Rng::new(config.seed ^ 0xbeef);
    sim.apply(&Op::Offline { actor: 3 });
    for edit in 0..config.rejoin_edits {
        let actor = 1 + edit % 2;
        sim.apply(&Op::Edit {
            actor,
            id: ids[rng.index(ids.len())].clone(),
            at: rng.next_u64(),
            delete: 0,
            insert: word(&mut rng),
        });
        if edit % 10 == 9 {
            sim.apply(&Op::Sync { actor });
        }
    }
    sim.apply(&Op::Sync { actor: 1 });
    sim.apply(&Op::Sync { actor: 2 });
    let cursor = sim
        .replicas
        .get(&3)
        .map(|replica| replica.cursor)
        .ok_or_else(|| missing(3))?;
    out.rejoin_bytes = sim.server.since(cursor).map_or(0, |batches| {
        batches.iter().map(|batch| batch.bytes.len()).sum::<usize>()
    });
    sim.apply(&Op::Online { actor: 3 });
    let started = Instant::now();
    sim.sync(3);
    if let Some(replica) = sim.replicas.get(&3) {
        replica.engine.materialize()?;
    }
    out.rejoin_ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok(())
}

fn simulate_months<E: Engine>(
    config: &MeasureConfig,
    out: &mut Measurement,
) -> Result<(), EngineError> {
    let scenario = trace::months(config.months, config.trace, config.seed);
    out.months_ops = scenario
        .ops
        .iter()
        .filter(|op| matches!(op, Op::Edit { .. }))
        .count();
    let baseline = heap::reset_peak();
    let mut sim = Sim::<E>::start(&scenario)?;
    for op in &scenario.ops {
        sim.apply(op);
    }
    sim.settle();
    out.peak_months_bytes = heap::peak().saturating_sub(baseline);
    let owner = sim.replicas.get(&0).ok_or_else(|| missing(0))?;
    out.snapshot_bytes = owner.engine.snapshot()?.len();
    out.compact_bytes = owner.engine.compact()?.len();
    out.save_bytes = owner.engine.save()?.len();
    out.server_log_bytes = sim.server.log.iter().map(|batch| batch.bytes.len()).sum();
    Ok(())
}
