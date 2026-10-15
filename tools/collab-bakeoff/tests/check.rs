use collab_bakeoff::check::{converged, evaluate, Verdict};
use collab_bakeoff::loro_engine::LoroEngine;
use collab_bakeoff::scenarios::{self, MAIN};
use collab_bakeoff::sim::{self, Sim};
use collab_bakeoff::trace::{Check, Op};
use collab_bakeoff::tree::Materialized;

fn local_insert(actor: usize, text: &str) -> Op {
    Op::Splice {
        actor,
        id: MAIN.to_owned(),
        pos: 0,
        delete: 0,
        insert: text.to_owned(),
    }
}

#[test]
fn convergence_reports_the_first_differing_path() {
    let mut left = Materialized::default();
    left.files.insert("a.tex".to_owned(), "x".to_owned());
    let mut right = left.clone();
    right.files.insert("a.tex".to_owned(), "y".to_owned());
    let error = converged(&[(0, left.clone()), (1, right)]).expect_err("diverged");
    assert!(
        error.contains("actor 1") && error.contains("a.tex"),
        "{error}"
    );
    assert!(converged(&[(0, left.clone()), (1, left)]).is_ok());
}

#[test]
fn evaluate_flags_a_replica_that_never_synced() {
    let mut scenario = scenarios::blank("diverge", 3);
    scenario.checks = vec![Check::Converged];
    let mut sim = Sim::<LoroEngine>::start(&scenario).expect("start");
    sim.apply(&local_insert(2, "local only "));
    let outcome = evaluate(&sim, &scenario);
    assert!(
        matches!(outcome.verdict, Verdict::Fail { .. }),
        "{outcome:?}"
    );
}

#[test]
fn the_replay_check_catches_edits_the_server_never_received() {
    let mut scenario = scenarios::blank("replay", 2);
    scenario.checks = vec![Check::ReplayMatches];
    let mut sim = Sim::<LoroEngine>::start(&scenario).expect("start");
    sim.apply(&local_insert(0, "unsent "));
    let outcome = evaluate(&sim, &scenario);
    assert!(
        matches!(outcome.verdict, Verdict::Fail { .. }),
        "{outcome:?}"
    );
}

#[test]
fn a_full_run_passes_when_everyone_converges() {
    let outcome = sim::run::<LoroEngine>(&scenarios::rename_and_edit());
    assert_eq!(outcome.verdict, Verdict::Pass, "{outcome:?}");
    assert_eq!(outcome.engine, "loro");
}
