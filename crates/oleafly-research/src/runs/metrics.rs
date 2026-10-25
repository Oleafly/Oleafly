//! Metrics a run prints: JSON lines (`{"loss": 0.5}`), `key=value` pairs
//! (`step=10 loss=0.25,lr=3e-4`) or one `key: value` line. Lines that say
//! anything else are ignored.
use std::collections::BTreeMap;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.len() <= 64
        && chars.all(|character| character.is_ascii_alphanumeric() || "_./-".contains(character))
}

fn number(text: &str) -> Option<f64> {
    let value: f64 = text.trim().trim_end_matches(['%', ',', ';']).parse().ok()?;
    value.is_finite().then_some(value)
}

/// The metrics on one line, in the order they appear (JSON keys sorted).
pub fn parse_metrics_line(line: &str) -> Vec<(String, f64)> {
    let line = line.trim().trim_end_matches('\r');
    if line.is_empty() || line.len() > 4_096 {
        return Vec::new();
    }
    if line.starts_with('{') {
        let Ok(Value::Object(object)) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        let sorted: BTreeMap<String, f64> = object
            .into_iter()
            .filter(|(name, _)| valid_name(name))
            .filter_map(|(name, value)| {
                value
                    .as_f64()
                    .filter(|value| value.is_finite())
                    .map(|value| (name, value))
            })
            .collect();
        return sorted.into_iter().collect();
    }
    if line.contains('=') {
        let mut found = Vec::new();
        for pair in line.split(|character: char| character.is_whitespace() || character == ',') {
            let Some((name, value)) = pair.split_once('=') else {
                continue;
            };
            if let (true, Some(value)) = (valid_name(name), number(value)) {
                found.push((name.to_owned(), value));
            }
        }
        return found;
    }
    if let Some((name, value)) = line.split_once(':') {
        let name = name.trim();
        if valid_name(name) {
            if let Some(value) = number(value) {
                return vec![(name.to_owned(), value)];
            }
        }
    }
    Vec::new()
}

/// The last value of every metric and how many points were recorded.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSummary {
    pub last: BTreeMap<String, f64>,
    pub points: usize,
}

/// One line of `metrics.jsonl`.
#[derive(Debug, Serialize, Deserialize)]
pub struct MetricsPoint {
    pub t: i64,
    pub line: u64,
    pub metrics: BTreeMap<String, f64>,
}

/// Reads `metrics.jsonl`.
pub fn summarize_file(path: &Path) -> MetricsSummary {
    let Ok(file) = std::fs::File::open(path) else {
        return MetricsSummary::default();
    };
    let mut summary = MetricsSummary::default();
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        if let Ok(point) = serde_json::from_str::<MetricsPoint>(&line) {
            summary.points += 1;
            summary.last.extend(point.metrics);
        }
    }
    summary
}

/// Parses the last `max_bytes` of a plain log (remote runs whose executor
/// only brought the log back).
pub fn summarize_log(path: &Path, max_bytes: u64) -> MetricsSummary {
    let Ok(mut file) = std::fs::File::open(path) else {
        return MetricsSummary::default();
    };
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let start = length.saturating_sub(max_bytes);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return MetricsSummary::default();
    }
    let mut text = Vec::new();
    if file.take(max_bytes).read_to_end(&mut text).is_err() {
        return MetricsSummary::default();
    }
    let text = String::from_utf8_lossy(&text);
    let mut lines = text.lines();
    if start > 0 {
        // The first line was cut in the middle.
        lines.next();
    }
    let mut summary = MetricsSummary::default();
    for line in lines {
        let metrics = parse_metrics_line(line);
        if !metrics.is_empty() {
            summary.points += 1;
            summary.last.extend(metrics);
        }
    }
    summary
}
