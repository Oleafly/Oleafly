use collab_bakeoff::matrix::EngineKind;
use collab_bakeoff::measure::{measure_kind, percentile, MeasureConfig};
use collab_bakeoff::trace::{months, MonthsConfig, Op, TraceConfig};

#[test]
fn percentiles_pick_the_nearest_rank() {
    let values: Vec<f64> = (1..=101_i32).map(f64::from).collect();
    assert_eq!(percentile(&values, 50.0), 51.0);
    assert_eq!(percentile(&values, 95.0), 96.0);
    assert_eq!(percentile(&values, 100.0), 101.0);
    assert_eq!(percentile(&[], 95.0), 0.0);
}

#[test]
fn six_months_means_180_days_of_300_edits() {
    let config = MonthsConfig::six_months();
    assert_eq!(
        (config.days, config.edits_per_day, config.actors),
        (180, 300, 20)
    );
    let scenario = months(MonthsConfig::smoke(), TraceConfig::small(), 3);
    let edits = scenario
        .ops
        .iter()
        .filter(|op| matches!(op, Op::Edit { .. }))
        .count();
    assert_eq!(edits, 90);
    assert!(scenario
        .ops
        .iter()
        .any(|op| matches!(op, Op::Compact { .. })));
}

#[test]
fn smoke_measurements_run_for_every_engine() {
    for kind in EngineKind::ALL {
        let measurement = measure_kind(kind, &MeasureConfig::smoke(7));
        assert_eq!(measurement.error, None, "{measurement:?}");
        assert_eq!(measurement.engine, kind.name());
        assert!(measurement.propagation_p50_ms >= 40.0, "{measurement:?}");
        assert!(measurement.propagation_p95_ms >= measurement.propagation_p50_ms);
        assert!(measurement.snapshot_bytes > 0 && measurement.save_bytes > 0);
        assert!(measurement.months_ops > 0 && measurement.rejoin_bytes > 0);
    }
}
