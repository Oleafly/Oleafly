#![allow(dead_code)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub const REGENERATE: &str = "OLEAFLY_WRITE_GOLDENS=1 pnpm vitest run src/lib/cli-goldens";

pub fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

pub fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|error| {
        panic!(
            "{}: {error}. Run `{REGENERATE}` to create it.",
            path.display()
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

pub fn cases(suite: &str) -> Vec<Value> {
    match read_json(&fixture_root().join("cases").join(format!("{suite}.json"))) {
        Value::Array(cases) => cases,
        other => panic!("cases/{suite}.json is not an array: {other}"),
    }
}

pub fn expected(name: &str) -> Map<String, Value> {
    match read_json(&fixture_root().join("expected").join(format!("{name}.json"))) {
        Value::Object(map) => map,
        other => panic!("expected/{name}.json is not an object: {other}"),
    }
}

/// Rebuilds every object with sorted keys, so two values print the same way
/// whatever map order serde_json was built with.
pub fn canonical(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical(&map[key]));
            }
            Value::Object(sorted)
        }
        other => other.clone(),
    }
}

pub fn assert_golden(name: &str, actual: &Value, expected: &Value) {
    if actual == expected {
        return;
    }
    let actual = serde_json::to_string_pretty(&canonical(actual)).unwrap();
    let expected = serde_json::to_string_pretty(&canonical(expected)).unwrap();
    pretty_assertions::assert_eq!(expected, actual, "golden mismatch for {name}");
}

pub fn run_suite(suite: &str, golden: &str, minimum: usize, mut run: impl FnMut(&Value) -> Value) {
    let cases = cases(suite);
    assert!(
        cases.len() >= minimum,
        "{suite} has {} cases, fewer than {minimum}",
        cases.len()
    );
    let expected = expected(golden);
    let mut names = HashSet::new();
    for case in &cases {
        let name = string(case, "name");
        assert!(
            names.insert(name.to_string()),
            "duplicate case {suite}/{name}"
        );
        let want = expected.get(name).unwrap_or_else(|| {
            panic!("no expected output for {golden}/{name}. Run `{REGENERATE}`.")
        });
        let got = run(case);
        assert_golden(&format!("{golden}/{name}"), &got, want);
    }
}

pub fn string<'a>(case: &'a Value, key: &str) -> &'a str {
    case[key]
        .as_str()
        .unwrap_or_else(|| panic!("case field {key} is not a string"))
}
