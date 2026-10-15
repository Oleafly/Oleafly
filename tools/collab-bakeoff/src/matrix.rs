use std::any::Any;
use std::panic::{self, AssertUnwindSafe};

use serde::Serialize;

use crate::automerge_engine::AutomergeEngine;
use crate::check::{Outcome, Verdict};
use crate::engine::Engine;
use crate::loro_engine::LoroEngine;
use crate::sim;
use crate::trace::Scenario;
use crate::yrs_engine::YrsEngine;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Loro,
    Yrs,
    Automerge,
}

impl EngineKind {
    pub const ALL: [EngineKind; 3] = [EngineKind::Loro, EngineKind::Yrs, EngineKind::Automerge];

    pub fn name(self) -> &'static str {
        match self {
            EngineKind::Loro => LoroEngine::NAME,
            EngineKind::Yrs => YrsEngine::NAME,
            EngineKind::Automerge => AutomergeEngine::NAME,
        }
    }

    pub fn parse(value: &str) -> Option<EngineKind> {
        EngineKind::ALL
            .into_iter()
            .find(|kind| kind.name() == value)
    }
}

pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "panic without a message".to_owned()
    }
}

fn guarded<E: Engine>(scenario: &Scenario) -> Outcome {
    match panic::catch_unwind(AssertUnwindSafe(|| sim::run::<E>(scenario))) {
        Ok(outcome) => outcome,
        Err(payload) => Outcome::new(
            &scenario.name,
            E::NAME,
            Verdict::Panicked {
                message: panic_message(&*payload),
            },
        ),
    }
}

pub fn run_scenario(kind: EngineKind, scenario: &Scenario) -> Outcome {
    match kind {
        EngineKind::Loro => guarded::<LoroEngine>(scenario),
        EngineKind::Yrs => guarded::<YrsEngine>(scenario),
        EngineKind::Automerge => guarded::<AutomergeEngine>(scenario),
    }
}

pub fn run_matrix(scenarios: &[Scenario], engines: &[EngineKind]) -> Vec<Outcome> {
    scenarios
        .iter()
        .flat_map(|scenario| {
            engines
                .iter()
                .map(move |engine| run_scenario(*engine, scenario))
        })
        .collect()
}
