use collab_bakeoff::check::{Outcome, Verdict};
use collab_bakeoff::matrix::EngineKind;
use collab_bakeoff::measure::Measurement;
use collab_bakeoff::report::{splice_results, to_json, to_markdown, versions, Report};
use collab_bakeoff::trace::Scale;

fn sample() -> Report {
    Report {
        versions: versions(),
        seed: 1,
        scale: Scale::Small,
        platform: "test".to_owned(),
        engines: vec![EngineKind::Loro, EngineKind::Yrs],
        matrix: vec![
            Outcome::new("same_name_create", "loro", Verdict::Pass),
            Outcome::new(
                "same_name_create",
                "yrs",
                Verdict::Fail {
                    reason: "lost a|b".to_owned(),
                },
            ),
        ],
        measurements: vec![Measurement {
            engine: "loro".to_owned(),
            propagation_p95_ms: 81.0,
            ..Measurement::default()
        }],
    }
}

#[test]
fn markdown_has_one_row_per_scenario_and_one_column_per_engine() {
    let markdown = to_markdown(&sample());
    assert!(markdown.contains("| Scenario | loro | yrs |"), "{markdown}");
    assert!(
        markdown.contains("| same_name_create | pass | FAIL: lost a\\|b |"),
        "{markdown}"
    );
    assert!(markdown.contains("| Metric | loro |"), "{markdown}");
    assert!(
        markdown.contains("| p95 propagation (ms) | 81.0 |"),
        "{markdown}"
    );
    assert!(
        markdown.contains("loro 1.16.2, yrs 0.28.0, automerge 0.12.0"),
        "{markdown}"
    );
}

#[test]
fn json_tags_each_verdict_with_a_status() {
    let json = to_json(&sample()).expect("json");
    assert!(json.contains("\"status\": \"pass\""), "{json}");
    assert!(json.contains("\"status\": \"fail\""), "{json}");
    assert!(json.contains("\"reason\": \"lost a|b\""), "{json}");
}

#[test]
fn results_replace_only_their_own_section() {
    let document = "# Decision\n\n## Results\n\nold\n\n## Recommendation\n\nEngine:\n";
    let filled = splice_results(document, "NEW TABLE\n");
    assert_eq!(
        filled,
        "# Decision\n\n## Results\n\nNEW TABLE\n\n## Recommendation\n\nEngine:\n"
    );
    assert_eq!(
        splice_results(&filled, "NEWER\n"),
        "# Decision\n\n## Results\n\nNEWER\n\n## Recommendation\n\nEngine:\n"
    );
}
