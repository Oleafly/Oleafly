mod support;

use std::collections::BTreeMap;

use oleafly_lint::proofread::{
    harper_version, ACADEMIC_PROFILE_RULES, BUILTIN_PROOFREADING_WORDS, GRAMMAR_CHARACTER_LIMIT,
    HARPER_PANICKING_RULES,
};
use oleafly_lint::PROSE_PLACEHOLDER;
use oleafly_lint::{
    lint_bibtex_text, lint_latex_text, prose_for, LintDiagnostic, LintMessage, ProseFormat,
    ProseInput,
};
use oleafly_preflight::text::{normalize_line_endings, SourceText};
use serde_json::{json, Value};

use support::{assert_golden, cases, fixture_root, read_json, run_suite, string};

fn source(case: &Value) -> SourceText {
    SourceText::new(normalize_line_endings(string(case, "text")).into_owned())
}

fn diagnostics_json(diagnostics: &[LintDiagnostic]) -> Value {
    Value::Array(
        diagnostics
            .iter()
            .map(|diagnostic| {
                let LintMessage::Catalog(message) = &diagnostic.message else {
                    panic!("LaTeX and BibTeX findings carry catalog messages");
                };
                json!({
                    "from": diagnostic.from,
                    "to": diagnostic.to,
                    "severity": diagnostic.severity.as_str(),
                    "key": message.key,
                    "params": serde_json::to_value(&message.params).unwrap(),
                })
            })
            .collect(),
    )
}

#[test]
fn golden_latex() {
    run_suite("latex", "latex", 70, |case| {
        diagnostics_json(&lint_latex_text(&source(case)))
    });
}

#[test]
fn golden_bibtex() {
    run_suite("bibtex", "bibtex", 25, |case| {
        diagnostics_json(&lint_bibtex_text(&source(case)))
    });
}

fn prose_format(case: &Value) -> ProseFormat {
    match string(case, "format") {
        "latex" => ProseFormat::Latex,
        "markdown" => ProseFormat::Markdown,
        "typst" => ProseFormat::Typst,
        other => panic!("unknown prose format {other}"),
    }
}

fn compress_map(map: &[u32]) -> Vec<[u32; 3]> {
    let mut runs: Vec<[u32; 3]> = Vec::new();
    for (index, &value) in map.iter().enumerate() {
        let index = index as u32;
        match runs.last_mut() {
            Some(last) if last[0] + last[2] == index && last[1] + last[2] == value => last[2] += 1,
            _ => runs.push([index, value, 1]),
        }
    }
    runs
}

fn mask_json(input: &ProseInput) -> Value {
    let mut out = json!({ "prose": input.prose.as_str() });
    match &input.map {
        Some(map) => out["map"] = json!(compress_map(map)),
        None => {
            out["masked"] = json!(input
                .masked
                .iter()
                .map(|span| [span.from, span.to])
                .collect::<Vec<_>>())
        }
    }
    out
}

#[test]
fn golden_masks() {
    let mut per_format: BTreeMap<String, usize> = BTreeMap::new();
    for case in cases("prose") {
        *per_format
            .entry(string(&case, "format").to_string())
            .or_default() += 1;
    }
    assert_eq!(
        per_format.len(),
        3,
        "prose cases cover LaTeX, Markdown and Typst"
    );
    assert!(
        per_format.values().all(|&count| count >= 4),
        "{per_format:?}"
    );
    run_suite("prose", "masks", 15, |case| {
        mask_json(&prose_for(prose_format(case), &source(case)))
    });
}

#[cfg(feature = "proofread")]
#[test]
fn golden_harper() {
    use oleafly_lint::proofread::{Dialect, IgnoredWords, Proofreader};

    let masks = support::expected("masks");
    let mut proofreader =
        Proofreader::new(Dialect::American, &IgnoredWords::default()).expect("harper builds");
    run_suite("prose", "harper", 15, |case| {
        let name = string(case, "name");
        let prose = masks[name]["prose"]
            .as_str()
            .unwrap_or_else(|| panic!("masks/{name} has no prose"));
        let mut lints = proofreader.raw_lints(prose).expect("harper lints");
        lints.sort_by(|left, right| {
            (left.from, left.to, &left.rule, &left.message).cmp(&(
                right.from,
                right.to,
                &right.rule,
                &right.message,
            ))
        });
        Value::Array(
            lints
                .into_iter()
                .map(|lint| {
                    json!({
                        "rule": lint.rule,
                        "kind": lint.kind,
                        "from": lint.from,
                        "to": lint.to,
                        "message": lint.message,
                        "suggestions": serde_json::to_value(&lint.suggestions).unwrap(),
                    })
                })
                .collect(),
        )
    });
}

#[test]
fn golden_lint_tables() {
    let expected = read_json(&fixture_root().join("expected/tables.json"));
    let mut actual = json!({
        "academicRules": ACADEMIC_PROFILE_RULES,
        "panickingRules": HARPER_PANICKING_RULES,
        "builtinWords": BUILTIN_PROOFREADING_WORDS,
        "placeholder": PROSE_PLACEHOLDER,
        "grammarCharacterLimit": GRAMMAR_CHARACTER_LIMIT,
        "harperVersion": expected["harperVersion"].clone(),
    });
    if let Some(version) = harper_version() {
        actual["harperVersion"] = json!(version);
    }
    assert_golden("tables", &actual, &expected);
}
