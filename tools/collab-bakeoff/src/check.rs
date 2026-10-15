use std::collections::BTreeMap;

use serde::Serialize;

use crate::engine::{Engine, EngineError};
use crate::sim::{peer_id, Server, Sim, REPLAY_ACTOR};
use crate::trace::{Check, Scenario};
use crate::tree::Materialized;

pub const MAX_NOTES: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Verdict {
    Pass,
    Fail { reason: String },
    Panicked { message: String },
    SetupError { message: String },
}

impl Verdict {
    pub fn is_pass(&self) -> bool {
        matches!(self, Verdict::Pass)
    }

    pub fn cell(&self) -> String {
        match self {
            Verdict::Pass => "pass".to_owned(),
            Verdict::Fail { reason } => format!("FAIL: {}", shorten(reason)),
            Verdict::Panicked { message } => format!("PANIC: {}", shorten(message)),
            Verdict::SetupError { message } => format!("SETUP: {}", shorten(message)),
        }
    }
}

fn shorten(text: &str) -> String {
    let flat = text.replace('\n', " ");
    if flat.chars().count() <= 90 {
        flat
    } else {
        format!("{}...", flat.chars().take(90).collect::<String>())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Outcome {
    pub scenario: String,
    pub engine: String,
    pub verdict: Verdict,
    pub import_errors: usize,
    pub rejected_ops: usize,
    pub tree_repairs: usize,
    pub notes: Vec<String>,
}

impl Outcome {
    pub fn new(scenario: &str, engine: &str, verdict: Verdict) -> Outcome {
        Outcome {
            scenario: scenario.to_owned(),
            engine: engine.to_owned(),
            verdict,
            import_errors: 0,
            rejected_ops: 0,
            tree_repairs: 0,
            notes: Vec::new(),
        }
    }
}

fn collect_notes<E: Engine>(sim: &Sim<E>) -> Vec<String> {
    let mut notes = sim.notes.clone();
    notes.extend(sim.rejected.iter().cloned());
    for replica in sim.replicas.values() {
        notes.extend(
            replica
                .errors
                .iter()
                .map(|error| format!("actor {}: {error}", replica.actor)),
        );
        if replica.pending {
            notes.push(format!("actor {} still has pending updates", replica.actor));
        }
    }
    let total = notes.len();
    notes.truncate(MAX_NOTES);
    if total > MAX_NOTES {
        notes.push(format!("{} more notes not shown", total - MAX_NOTES));
    }
    notes
}

pub fn materialize_all<E: Engine>(sim: &Sim<E>) -> Result<Vec<(usize, Materialized)>, EngineError> {
    sim.replicas
        .iter()
        .map(|(actor, replica)| replica.engine.materialize().map(|view| (*actor, view)))
        .collect()
}

pub fn evaluate<E: Engine>(sim: &Sim<E>, scenario: &Scenario) -> Outcome {
    let mut outcome = Outcome::new(&scenario.name, E::NAME, Verdict::Pass);
    outcome.import_errors = sim
        .replicas
        .values()
        .map(|replica| replica.errors.len())
        .sum();
    outcome.rejected_ops = sim.rejected.len();
    outcome.notes = collect_notes(sim);
    let views = match materialize_all(sim) {
        Ok(views) => views,
        Err(error) => {
            outcome.verdict = Verdict::Fail {
                reason: format!("materialize: {error}"),
            };
            return outcome;
        }
    };
    outcome.tree_repairs = views.first().map_or(0, |(_, view)| view.repaired);
    for check in &scenario.checks {
        if let Err(reason) = run_check(sim, &views, check) {
            outcome.verdict = Verdict::Fail { reason };
            break;
        }
    }
    outcome
}

fn run_check<E: Engine>(
    sim: &Sim<E>,
    views: &[(usize, Materialized)],
    check: &Check,
) -> Result<(), String> {
    match check {
        Check::Converged => converged(views),
        Check::ReplayMatches => replay_matches::<E>(&sim.server, views),
        Check::FileContains { path, needle } => {
            each_view(views, |actor, view| match view.files.get(path) {
                Some(text) if text.contains(needle.as_str()) => Ok(()),
                Some(_) => Err(format!("actor {actor}: {path} lacks {needle:?}")),
                None => Err(format!("actor {actor}: {path} is missing")),
            })
        }
        Check::NoFile { path } => each_view(views, |actor, view| {
            if view.files.contains_key(path) {
                Err(format!("actor {actor}: {path} is still there"))
            } else {
                Ok(())
            }
        }),
        Check::FileCount(count) => each_view(views, |actor, view| {
            if view.files.len() == *count {
                Ok(())
            } else {
                Err(format!(
                    "actor {actor}: {} files, expected {count}",
                    view.files.len()
                ))
            }
        }),
        Check::MarkersPresent(markers) => each_view(views, |actor, view| {
            for marker in markers {
                if !contains_anywhere(view, marker) {
                    return Err(format!("actor {actor}: lost {marker:?}"));
                }
            }
            Ok(())
        }),
        Check::CorruptionRejected { author } => corruption_rejected(sim, views, *author),
    }
}

fn each_view(
    views: &[(usize, Materialized)],
    check: impl Fn(usize, &Materialized) -> Result<(), String>,
) -> Result<(), String> {
    for (actor, view) in views {
        check(*actor, view)?;
    }
    Ok(())
}

fn contains_anywhere(view: &Materialized, needle: &str) -> bool {
    view.files
        .values()
        .chain(view.trash.values())
        .any(|text| text.contains(needle))
}

pub fn converged(views: &[(usize, Materialized)]) -> Result<(), String> {
    let Some((first_actor, first)) = views.first() else {
        return Ok(());
    };
    for (actor, view) in views.iter().skip(1) {
        if let Some(difference) = difference(first, view) {
            return Err(format!(
                "actor {actor} differs from actor {first_actor}: {difference}"
            ));
        }
    }
    Ok(())
}

pub fn difference(left: &Materialized, right: &Materialized) -> Option<String> {
    if let Some(path) = first_difference(&left.files, &right.files) {
        return Some(format!("file {path}"));
    }
    if left.dirs != right.dirs {
        return Some("directories".to_owned());
    }
    first_difference(&left.trash, &right.trash).map(|id| format!("trash {id}"))
}

fn first_difference(
    left: &BTreeMap<String, String>,
    right: &BTreeMap<String, String>,
) -> Option<String> {
    left.keys()
        .chain(right.keys())
        .find(|key| left.get(*key) != right.get(*key))
        .cloned()
}

pub fn replay<E: Engine>(server: &Server) -> Result<E, EngineError> {
    let snapshot = server
        .newest_snapshot()
        .ok_or_else(|| EngineError::Decode("the server has no snapshot".to_owned()))?;
    let mut engine = E::load(&snapshot.bytes, peer_id(REPLAY_ACTOR, 0))?;
    for batch in server.since(snapshot.upto).unwrap_or_default() {
        let _ = engine.import(&batch.bytes);
    }
    Ok(engine)
}

fn replay_matches<E: Engine>(
    server: &Server,
    views: &[(usize, Materialized)],
) -> Result<(), String> {
    let Some((actor, reference)) = views.first() else {
        return Ok(());
    };
    let replayed = replay::<E>(server).map_err(|error| format!("replay failed: {error}"))?;
    let view = replayed
        .materialize()
        .map_err(|error| format!("replay materialize: {error}"))?;
    match difference(reference, &view) {
        Some(difference) => Err(format!(
            "a fresh replay of the server differs from actor {actor}: {difference}"
        )),
        None => Ok(()),
    }
}

fn corruption_rejected<E: Engine>(
    sim: &Sim<E>,
    views: &[(usize, Materialized)],
    author: usize,
) -> Result<(), String> {
    let rejected = sim
        .replicas
        .values()
        .any(|replica| replica.actor != author && !replica.errors.is_empty());
    if rejected {
        return Ok(());
    }
    let Some((_, reference)) = views.iter().find(|(actor, _)| *actor == author) else {
        return Ok(());
    };
    for (actor, view) in views.iter().filter(|(actor, _)| *actor != author) {
        if let Some(difference) = difference(reference, view) {
            return Err(format!(
                "no error, and actor {actor} now differs from the author: {difference}"
            ));
        }
    }
    Ok(())
}
