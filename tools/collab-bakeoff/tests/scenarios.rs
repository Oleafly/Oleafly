use collab_bakeoff::scenarios::{self, corpus, CORE, MAIN, MAIN_PREFIX};
use collab_bakeoff::trace::{Check, Op, Scale, Scenario};
use collab_bakeoff::utf16::utf16_len;

const RECORDED: [&str; 14] = [
    "offline_across_shallow_compaction",
    "malformed_random_bytes",
    "malformed_empty",
    "malformed_truncated",
    "corrupt_in_transit",
    "oversized_paste",
    "oversized_refused",
    "kill_mid_save_empty",
    "kill_mid_save_one_byte",
    "kill_mid_save_half",
    "kill_mid_save_drop_last_byte",
    "kill_after_clean_save",
    "reused_peer_after_crash",
    "surrogate_mid_pair",
];

#[test]
fn names_are_unique_and_cover_the_spec_list() {
    let corpus = corpus(Scale::Small, 7);
    let mut names: Vec<&str> = corpus
        .iter()
        .map(|scenario| scenario.name.as_str())
        .collect();
    let total = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), total);
    assert_eq!(total, CORE.len() + RECORDED.len());
    for required in CORE.iter().chain(RECORDED.iter()) {
        assert!(names.contains(required), "missing {required}");
    }
}

#[test]
fn the_surrogate_scenarios_aim_after_and_inside_the_emoji() {
    assert_eq!(utf16_len(MAIN_PREFIX), 49);
    let positions = |scenario: &Scenario| -> Vec<usize> {
        scenario
            .ops
            .iter()
            .filter_map(|op| match op {
                Op::Splice { id, pos, .. } if id == MAIN => Some(*pos),
                _ => None,
            })
            .collect()
    };
    assert_eq!(positions(&scenarios::surrogate_after_emoji()), vec![49, 47]);
    assert_eq!(positions(&scenarios::surrogate_mid_pair()), vec![48]);
}

#[test]
fn every_scenario_has_checks_and_enough_people() {
    for scenario in corpus(Scale::Small, 7) {
        assert!(!scenario.checks.is_empty(), "{}", scenario.name);
        assert!(scenario.actors >= 3, "{}", scenario.name);
        assert!(
            scenario
                .ops
                .iter()
                .filter_map(Op::actor)
                .all(|actor| actor < scenario.actors),
            "{}",
            scenario.name
        );
    }
}

#[test]
fn the_corruption_scenario_names_its_author() {
    assert_eq!(
        scenarios::corrupt_in_transit().checks,
        vec![Check::CorruptionRejected { author: 1 }]
    );
}
