use std::path::{Path, PathBuf};

use oleafly_core::context::{scan_project, ContextLimits};
use serde_json::{json, Value};

fn cases() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/context");
    let mut cases: Vec<PathBuf> = std::fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    cases.sort();
    cases
}

fn main_of(case: &Path) -> String {
    let fixture: Value =
        serde_json::from_slice(&std::fs::read(case.join("fixture.json")).unwrap()).unwrap();
    fixture["main"].as_str().unwrap().to_string()
}

fn sorted(value: &Value) -> Value {
    let mut items: Vec<Value> = value.as_array().cloned().unwrap_or_default();
    items.sort_by_key(|item| item.to_string());
    Value::Array(items)
}

fn normalized(map: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for (key, value) in map.as_object().unwrap() {
        out.insert(key.clone(), sorted(value));
    }
    Value::Object(out)
}

#[test]
fn every_context_fixture_matches_the_app_project_map() {
    for case in cases() {
        let expected_path = case.join("expected.map.json");
        let expected: Value = match std::fs::read(&expected_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap(),
            Err(_) => panic!(
                "{} is missing. Run `OLEAFLY_UPDATE_GOLDEN=1 pnpm vitest run src/lib/project-intelligence/context-golden.test.ts`.",
                expected_path.display()
            ),
        };
        let scan = scan_project(&case, &main_of(&case), &ContextLimits::default()).unwrap();
        let actual = serde_json::to_value(&scan.map).unwrap();
        assert_eq!(
            normalized(&actual),
            normalized(&expected),
            "{}",
            case.display()
        );
    }
}

#[test]
fn every_context_fixture_matches_its_extras() {
    for case in cases() {
        let scan = scan_project(&case, &main_of(&case), &ContextLimits::default()).unwrap();
        let mut roles = scan.roles.clone();
        roles.retain(|path, _| path != "fixture.json" && !path.starts_with("expected."));
        let actual = json!({
            "roles": roles,
            "unused_cites": scan.unused_cites,
            "unused_labels": scan.unused_labels,
            "missing_files": scan.missing_files,
            "packages": scan.packages,
        });
        let path = case.join("expected.extras.json");
        if std::env::var_os("OLEAFLY_WRITE_GOLDENS").is_some() {
            std::fs::write(
                &path,
                format!("{}\n", serde_json::to_string_pretty(&actual).unwrap()),
            )
            .unwrap();
            continue;
        }
        let expected: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(actual, expected, "{}", case.display());
    }
}
