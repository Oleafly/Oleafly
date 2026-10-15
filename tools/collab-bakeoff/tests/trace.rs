use collab_bakeoff::engine::NodeKind;
use collab_bakeoff::rng::Rng;
use collab_bakeoff::trace::{generate, lorem, Op, TraceConfig};

#[test]
fn the_same_seed_gives_the_same_trace() {
    assert_eq!(
        generate(TraceConfig::small(), 11),
        generate(TraceConfig::small(), 11)
    );
    assert_ne!(
        generate(TraceConfig::small(), 11).ops,
        generate(TraceConfig::small(), 12).ops
    );
}

#[test]
fn the_full_trace_has_fifty_files_twenty_people_and_half_a_megabyte() {
    let scenario = generate(TraceConfig::full(), 20_261_011);
    let files = scenario
        .setup
        .iter()
        .filter(|op| matches!(op, Op::Create { kind, .. } if *kind != NodeKind::Dir))
        .count();
    assert_eq!(files, 50);
    let bytes: usize = scenario
        .setup
        .iter()
        .map(|op| match op {
            Op::Create { text, .. } => text.len(),
            _ => 0,
        })
        .sum();
    assert!((500_000..=510_000).contains(&bytes), "{bytes}");
    assert_eq!(scenario.actors, 20);
    assert!(scenario
        .ops
        .iter()
        .filter_map(Op::actor)
        .all(|actor| actor < 20));
}

#[test]
fn the_trace_exercises_every_kind_of_operation() {
    let scenario = generate(TraceConfig::full(), 20_261_011);
    let has = |wanted: fn(&Op) -> bool| scenario.ops.iter().any(wanted);
    assert!(has(|op| matches!(op, Op::Edit { .. })));
    assert!(has(|op| matches!(op, Op::Rename { .. })));
    assert!(has(|op| matches!(op, Op::Move { .. })));
    assert!(has(|op| matches!(op, Op::Trash { .. })));
    assert!(has(|op| matches!(op, Op::Restore { .. })));
    assert!(has(|op| matches!(op, Op::Create { .. })));
    assert!(has(|op| matches!(op, Op::Offline { .. })));
    assert!(has(|op| matches!(op, Op::Compact { .. })));
    assert!(has(|op| matches!(op, Op::SyncAll)));
}

#[test]
fn lorem_reaches_the_requested_size_and_mixes_scripts() {
    let text = lorem(&mut Rng::new(1), 4_000);
    assert!(text.len() >= 4_000);
    assert!(text.ends_with('\n'));
    assert!(!text.is_ascii());
}
