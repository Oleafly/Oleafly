use oleafly_core::context::units::{LatexUnits, UnitTier};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Unit {
    root: String,
    files: Vec<String>,
    open: bool,
}

#[derive(Deserialize)]
struct Select {
    from: String,
    pool: Vec<String>,
    tier: String,
    items: Vec<String>,
    ambiguous: bool,
    #[serde(default)]
    citation: bool,
}

#[derive(Deserialize)]
struct Rows {
    files: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[derive(Deserialize)]
struct Reaches {
    from: String,
    to: String,
    value: bool,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    files: BTreeMap<String, String>,
    #[serde(default)]
    main: String,
    #[serde(default, rename = "compileFolder")]
    compile_folder: String,
    #[serde(default)]
    known: Vec<String>,
    units: Option<Vec<Unit>>,
    #[serde(default)]
    orphans: Vec<String>,
    #[serde(default)]
    select: Vec<Select>,
    #[serde(default)]
    rows: Vec<Rows>,
    #[serde(default)]
    reaches: Vec<Reaches>,
}

fn tier_name(tier: UnitTier) -> &'static str {
    match tier {
        UnitTier::Unit => "unit",
        UnitTier::Orphans => "orphans",
        UnitTier::Open => "open",
        UnitTier::All => "all",
        UnitTier::None => "none",
    }
}

fn build(case: &Case) -> Option<LatexUnits> {
    let mut known: Vec<String> = case.files.keys().cloned().collect();
    known.extend(case.known.iter().cloned());
    LatexUnits::build_in(
        case.files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
        &known,
        &case.main,
        &case.compile_folder,
    )
}

#[test]
fn every_rule_gives_the_answer_the_app_gives() {
    let fixture: Fixture = serde_json::from_str(include_str!("fixtures/latex-units.json")).unwrap();
    assert!(fixture.cases.len() >= 45);
    for case in &fixture.cases {
        let units = build(case);
        let Some(expected) = &case.units else {
            assert!(units.is_none(), "{}", case.name);
            continue;
        };
        let units = units.unwrap_or_else(|| panic!("{}: expected units", case.name));
        let summary = units.summary();
        assert_eq!(summary.len(), expected.len(), "{}", case.name);
        for (actual, expected) in summary.iter().zip(expected) {
            assert_eq!(actual.root, expected.root, "{}", case.name);
            assert_eq!(actual.files, expected.files, "{}", case.name);
            assert_eq!(actual.open, expected.open, "{}", case.name);
        }
        let orphans: Vec<String> = case
            .files
            .keys()
            .filter(|file| units.is_orphan(file))
            .cloned()
            .collect();
        assert_eq!(orphans, case.orphans, "{}", case.name);
        for query in &case.select {
            let pool = units.pool(query.pool.iter().map(String::as_str));
            let (items, tier) = units.select(&query.from, &pool, query.citation);
            let label = format!("{}: {} -> {:?}", case.name, query.from, query.pool);
            assert_eq!(tier_name(tier), query.tier, "{label}");
            assert_eq!(*items, query.items, "{label}");
            assert_eq!(
                units.is_ambiguous(&query.from, &items),
                query.ambiguous,
                "{label}"
            );
        }
        for query in &case.rows {
            assert_eq!(
                units.duplicate_rows(&query.files),
                query.rows,
                "{}",
                case.name
            );
        }
        for query in &case.reaches {
            assert_eq!(
                units.reaches(&query.from, &query.to),
                query.value,
                "{}: {} -> {}",
                case.name,
                query.from,
                query.to
            );
        }
    }
}

fn hub() -> Vec<(String, String)> {
    let mut files = Vec::new();
    let chapters: Vec<String> = (0..999)
        .map(|chapter| format!("\\input{{bank/p{chapter}}}"))
        .collect();
    files.push(("shared/hub.tex".to_string(), chapters.join("\n")));
    for chapter in 0..999 {
        files.push((format!("shared/bank/p{chapter}.tex"), String::new()));
    }
    for root in 0..1000 {
        files.push((
            format!("exams/e{root}/main.tex"),
            "\\documentclass{article}\n\\input{../../shared/hub}\n".to_string(),
        ));
    }
    files
}

#[test]
fn a_thousand_roots_can_share_a_thousand_files() {
    let files = hub();
    let known: Vec<String> = files.iter().map(|(path, _)| path.clone()).collect();
    let units = LatexUnits::build(
        files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
        &known,
        "",
    )
    .unwrap();
    assert_eq!(units.summary().len(), 1000);
    assert!(units.connected("exams/e1/main.tex", "shared/bank/p7.tex"));
    assert!(!units.connected("exams/e1/main.tex", "exams/e2/main.tex"));
}

#[test]
fn a_deep_chain_of_imports_ends_within_the_budget() {
    let mut sources: Vec<(String, String)> = (0..400)
        .map(|at| {
            (
                format!("d{at}/f{at}.tex"),
                format!("\\import{{d{}/}}{{f{}}}\n", at + 1, at + 1),
            )
        })
        .collect();
    sources.push((
        "a.tex".to_string(),
        "\\documentclass{article}\n\\import{d0/}{f0}\n".to_string(),
    ));
    sources.push((
        "b.tex".to_string(),
        "\\documentclass{article}\n".to_string(),
    ));
    let known: Vec<String> = sources.iter().map(|(path, _)| path.clone()).collect();
    let units = LatexUnits::build(
        sources
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
        &known,
        "",
    )
    .expect("two documents");
    let chain = units.summary();
    let root = chain
        .iter()
        .find(|unit| unit.root == "a.tex")
        .expect("a.tex");
    assert_eq!(root.files.len(), 401);
}

#[test]
fn the_cost_of_finding_a_path_counts_against_the_budget() {
    let text = "\\documentclass{article}\n\\input{chapter}\n";
    let mut known = vec!["a.tex".to_string(), "b.tex".to_string()];
    known.extend((0..2000).map(|folder| format!("f{folder}/chapter.tex")));
    let build = |max_steps| {
        LatexUnits::build_within(
            [("a.tex", text), ("b.tex", text)].into_iter(),
            &known,
            "",
            "",
            max_steps,
        )
    };
    assert!(build(1000).is_none());
    assert!(build(100_000).is_some());
}

#[test]
fn a_project_past_the_step_budget_keeps_the_pool() {
    let files = hub();
    let known: Vec<String> = files.iter().map(|(path, _)| path.clone()).collect();
    let units = LatexUnits::build_within(
        files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
        &known,
        "",
        "",
        1000,
    );
    assert!(units.is_none());
}
