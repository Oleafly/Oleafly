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

pub fn expected(suite: &str) -> Map<String, Value> {
    match read_json(
        &fixture_root()
            .join("expected")
            .join(format!("{suite}.json")),
    ) {
        Value::Object(map) => map,
        other => panic!("expected/{suite}.json is not an object: {other}"),
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

pub fn run_suite(suite: &str, minimum: usize, mut run: impl FnMut(&Value) -> Value) {
    let cases = cases(suite);
    assert!(
        cases.len() >= minimum,
        "{suite} has {} cases, fewer than {minimum}",
        cases.len()
    );
    let expected = expected(suite);
    let mut names = HashSet::new();
    for case in &cases {
        let name = case["name"].as_str().expect("every case has a name");
        assert!(
            names.insert(name.to_string()),
            "duplicate case {suite}/{name}"
        );
        let want = expected.get(name).unwrap_or_else(|| {
            panic!("no expected output for {suite}/{name}. Run `{REGENERATE}`.")
        });
        let got = run(case);
        assert_golden(&format!("{suite}/{name}"), &got, want);
    }
}

pub fn string<'a>(case: &'a Value, key: &str) -> &'a str {
    case[key]
        .as_str()
        .unwrap_or_else(|| panic!("case field {key} is not a string"))
}

pub fn optional_string<'a>(case: &'a Value, key: &str) -> Option<&'a str> {
    case.get(key).and_then(Value::as_str)
}

pub fn bool_or(case: &Value, key: &str, default: bool) -> bool {
    case.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("bad case input {value}: {error}"))
}

pub fn parse_optional<T: serde::de::DeserializeOwned>(case: &Value, key: &str) -> Option<T> {
    case.get(key).filter(|value| !value.is_null()).map(parse)
}
