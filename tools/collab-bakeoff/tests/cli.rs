use std::path::PathBuf;

use collab_bakeoff::cli::{parse, Options, DEFAULT_SEED};
use collab_bakeoff::matrix::EngineKind;
use collab_bakeoff::trace::Scale;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn defaults_match_the_documented_run() {
    let options = parse(&[]).expect("defaults");
    assert_eq!(
        options.out,
        PathBuf::from("tools/collab-bakeoff/target/bakeoff")
    );
    assert_eq!(options.seed, DEFAULT_SEED);
    assert_eq!(options.scale, Scale::Full);
    assert_eq!(options.engines, EngineKind::ALL.to_vec());
    assert_eq!(options.months.days, 180);
    assert_eq!(options, Options::default());
}

#[test]
fn reads_every_flag() {
    let options = parse(&args(&[
        "--out",
        "x",
        "--seed",
        "9",
        "--scale",
        "small",
        "--engines",
        "yrs,loro",
        "--only",
        "kill",
        "--days",
        "3",
        "--edits-per-day",
        "4",
        "--decision",
        "D.md",
        "--skip-measurements",
    ]))
    .expect("flags");
    assert_eq!(options.out, PathBuf::from("x"));
    assert_eq!(options.seed, 9);
    assert_eq!(options.scale, Scale::Small);
    assert_eq!(options.engines, vec![EngineKind::Yrs, EngineKind::Loro]);
    assert_eq!(options.only.as_deref(), Some("kill"));
    assert_eq!((options.months.days, options.months.edits_per_day), (3, 4));
    assert_eq!(options.decision, Some(PathBuf::from("D.md")));
    assert!(options.skip_measurements);
}

#[test]
fn rejects_unknown_flags_and_missing_values() {
    assert!(parse(&args(&["--nope"])).is_err());
    assert!(parse(&args(&["--seed"])).is_err());
    assert!(parse(&args(&["--seed", "many"])).is_err());
}

#[test]
fn rejects_unknown_engines() {
    let error = parse(&args(&["--engines", "loro,diamond"])).expect_err("unknown engine");
    assert!(error.contains("diamond"), "{error}");
}
