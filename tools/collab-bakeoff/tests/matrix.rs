use collab_bakeoff::check::Verdict;
use collab_bakeoff::matrix::{panic_message, run_matrix, run_scenario, EngineKind};
use collab_bakeoff::scenarios::{self, CORE};
use collab_bakeoff::trace::Scale;

#[test]
fn engine_names_round_trip() {
    for kind in EngineKind::ALL {
        assert_eq!(EngineKind::parse(kind.name()), Some(kind));
    }
    assert_eq!(EngineKind::parse("diamond"), None);
}

#[test]
fn panic_messages_come_back_as_text() {
    let payload = std::panic::catch_unwind(|| {
        let code = 7;
        panic!("boom {code}")
    })
    .expect_err("panicked");
    assert_eq!(panic_message(&*payload), "boom 7");
}

#[test]
fn core_scenarios_pass_on_every_engine() {
    let corpus = scenarios::corpus(Scale::Small, 7);
    for scenario in corpus
        .iter()
        .filter(|scenario| CORE.contains(&scenario.name.as_str()))
    {
        for engine in EngineKind::ALL {
            let outcome = run_scenario(engine, scenario);
            assert_eq!(
                outcome.verdict,
                Verdict::Pass,
                "{} on {}: {outcome:?}",
                scenario.name,
                engine.name()
            );
        }
    }
}

#[test]
fn every_scenario_produces_one_outcome_per_engine() {
    let corpus = scenarios::corpus(Scale::Small, 7);
    let outcomes = run_matrix(&corpus, &EngineKind::ALL);
    assert_eq!(outcomes.len(), corpus.len() * EngineKind::ALL.len());
    for outcome in &outcomes {
        assert!(
            !matches!(outcome.verdict, Verdict::SetupError { .. }),
            "{outcome:?}"
        );
    }
}
