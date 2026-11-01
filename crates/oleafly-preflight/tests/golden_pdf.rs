#![cfg(feature = "pdf")]

mod support;

use oleafly_preflight::pdf::{normalized_facts, read_pdf_facts};
use support::{assert_golden, fixture_root, read_json};

#[test]
fn golden_pdf_facts_match_pdf_js() {
    let expected = read_json(&fixture_root().join("expected/pdf-facts.json"));
    let mut files: Vec<_> = std::fs::read_dir(fixture_root().join("pdf"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "pdf"))
        .collect();
    files.sort();
    assert!(
        files.len() >= 2,
        "only {} fixture PDFs. Run `{}`.",
        files.len(),
        support::REGENERATE
    );
    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let facts = read_pdf_facts(&std::fs::read(&path).unwrap()).unwrap();
        let actual = serde_json::to_value(normalized_facts(facts)).unwrap();
        let want = expected.get(&name).unwrap_or_else(|| {
            panic!(
                "no expected facts for {name}. Run `{}`.",
                support::REGENERATE
            )
        });
        assert_golden(&name, &actual, want);
    }
}
