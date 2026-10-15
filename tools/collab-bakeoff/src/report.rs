use serde::Serialize;

use crate::check::Outcome;
use crate::matrix::EngineKind;
use crate::measure::Measurement;
use crate::trace::Scale;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Versions {
    pub loro: String,
    pub yrs: String,
    pub automerge: String,
}

pub fn versions() -> Versions {
    Versions {
        loro: "1.16.2".to_owned(),
        yrs: "0.28.0".to_owned(),
        automerge: "0.12.0".to_owned(),
    }
}

pub fn platform() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Report {
    pub versions: Versions,
    pub seed: u64,
    pub scale: Scale,
    pub platform: String,
    pub engines: Vec<EngineKind>,
    pub matrix: Vec<Outcome>,
    pub measurements: Vec<Measurement>,
}

pub fn to_json(report: &Report) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(report)
}

fn escape(cell: &str) -> String {
    cell.replace('|', "\\|").replace('\n', " ")
}

fn kib(bytes: usize) -> String {
    format!("{:.1} KiB", bytes as f64 / 1024.0)
}

const LABELS: [&str; 17] = [
    "p50 propagation (ms)",
    "p95 propagation (ms)",
    "max propagation (ms)",
    "mean update size (bytes)",
    "cold join (ms)",
    "cold join download",
    "cold join peak heap",
    "rejoin after 1,000 edits (ms)",
    "rejoin download",
    "simulated days",
    "edits in the simulation",
    "snapshot after the simulation",
    "compacted after the simulation",
    "saved file after the simulation",
    "server log after the simulation",
    "peak heap during the simulation",
    "error",
];

fn cells(measurement: &Measurement) -> [String; 17] {
    [
        format!("{:.1}", measurement.propagation_p50_ms),
        format!("{:.1}", measurement.propagation_p95_ms),
        format!("{:.1}", measurement.propagation_max_ms),
        format!("{:.0}", measurement.update_bytes_mean),
        format!("{:.1}", measurement.cold_join_ms),
        kib(measurement.join_download_bytes),
        kib(measurement.peak_join_bytes),
        format!("{:.1}", measurement.rejoin_ms),
        kib(measurement.rejoin_bytes),
        measurement.months_days.to_string(),
        measurement.months_ops.to_string(),
        kib(measurement.snapshot_bytes),
        kib(measurement.compact_bytes),
        kib(measurement.save_bytes),
        kib(measurement.server_log_bytes),
        kib(measurement.peak_months_bytes),
        measurement
            .error
            .clone()
            .unwrap_or_else(|| "none".to_owned()),
    ]
}

fn matrix_table(report: &Report) -> String {
    let mut out = String::from("### Failure matrix\n\n| Scenario |");
    for engine in &report.engines {
        out.push_str(&format!(" {} |", engine.name()));
    }
    out.push_str("\n|---|");
    for _ in &report.engines {
        out.push_str("---|");
    }
    out.push('\n');
    let mut scenarios: Vec<&str> = Vec::new();
    for outcome in &report.matrix {
        if !scenarios.contains(&outcome.scenario.as_str()) {
            scenarios.push(&outcome.scenario);
        }
    }
    for scenario in scenarios {
        out.push_str(&format!("| {scenario} |"));
        for engine in &report.engines {
            let cell = report
                .matrix
                .iter()
                .find(|outcome| outcome.scenario == scenario && outcome.engine == engine.name())
                .map_or_else(|| "not run".to_owned(), |outcome| outcome.verdict.cell());
            out.push_str(&format!(" {} |", escape(&cell)));
        }
        out.push('\n');
    }
    out
}

fn measurement_table(measurements: &[Measurement]) -> String {
    let mut out = String::from("### Measurements\n\n| Metric |");
    for measurement in measurements {
        out.push_str(&format!(" {} |", measurement.engine));
    }
    out.push_str("\n|---|");
    for _ in measurements {
        out.push_str("---|");
    }
    out.push('\n');
    let columns: Vec<[String; 17]> = measurements.iter().map(cells).collect();
    for (row, label) in LABELS.iter().enumerate() {
        out.push_str(&format!("| {label} |"));
        for column in &columns {
            out.push_str(&format!(" {} |", escape(&column[row])));
        }
        out.push('\n');
    }
    out
}

pub fn to_markdown(report: &Report) -> String {
    let mut out = format!(
        "Versions: loro {}, yrs {}, automerge {}. Seed {}. Scale {}. Platform {}.\n\n",
        report.versions.loro,
        report.versions.yrs,
        report.versions.automerge,
        report.seed,
        report.scale.name(),
        report.platform
    );
    out.push_str(&matrix_table(report));
    if !report.measurements.is_empty() {
        out.push('\n');
        out.push_str(&measurement_table(&report.measurements));
    }
    out
}

pub fn splice_results(document: &str, results: &str) -> String {
    let mut out = String::new();
    let mut skipping = false;
    let mut replaced = false;
    for line in document.lines() {
        if line.trim_end() == "## Results" {
            out.push_str(line);
            out.push_str("\n\n");
            out.push_str(results.trim_end());
            out.push_str("\n\n");
            skipping = true;
            replaced = true;
            continue;
        }
        if skipping && line.starts_with("## ") {
            skipping = false;
        }
        if !skipping {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !replaced {
        out.push_str("\n## Results\n\n");
        out.push_str(results.trim_end());
        out.push('\n');
    }
    out
}
