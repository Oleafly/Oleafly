use std::path::{Path, PathBuf};

use oleafly_doctools::synctex::{
    forward_hit, gunzip, inverse, parse, SynctexForwardHit, SynctexHit, MAX_SYNCTEX_FILE_BYTES,
    MAX_SYNCTEX_TEXT_BYTES,
};
use serde::Serialize;

const FIXTURES: &[(&str, &[&str])] = &[
    ("academic-article", &["main.tex"]),
    (
        "include-book",
        &[
            "main.tex",
            "chapters/intro.tex",
            "chapters/methods.tex",
            "chapters/results.tex",
        ],
    ),
    (
        "lualatex-chapters",
        &["main.tex", "sections/method.tex", "sections/results.tex"],
    ),
    ("wrapped-prose", &["main.tex"]),
];

const ROOT: &str = "/p";

#[derive(Serialize)]
struct ForwardCase<'a> {
    file: &'a str,
    line: i32,
    hit: Option<SynctexForwardHit>,
}

#[derive(Serialize)]
struct InverseCase {
    page: i32,
    x: f64,
    y: f64,
    hit: Option<SynctexHit>,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../oleafly-synctex/tests/fixtures/synctex")
}

fn rows(path: &Path) -> Vec<Vec<String>> {
    std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
        .lines()
        .filter(|row| !row.is_empty())
        .map(|row| row.split('\t').map(str::to_string).collect())
        .collect()
}

fn json<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).unwrap()
}

fn golden(name: &str, project: &[&str]) -> String {
    let dir = fixtures_dir();
    let gz = std::fs::read(dir.join(format!("{name}.synctex.gz"))).unwrap();
    let doc = parse(&gunzip(&gz, MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES).unwrap());
    let roots = vec![ROOT.to_string()];

    let mut forward: Vec<(String, i32)> = rows(&dir.join(format!("{name}.forward.tsv")))
        .into_iter()
        .map(|cells| (cells[0].clone(), cells[1].parse().unwrap()))
        .collect();
    let first = project[0].to_string();
    forward.extend([
        (first.clone(), 0),
        (first, 100_000),
        ("missing.tex".to_string(), 1),
    ]);
    let mut inverse_queries: Vec<(i32, f64, f64)> = rows(&dir.join(format!("{name}.inverse.tsv")))
        .into_iter()
        .map(|cells| {
            (
                cells[0].parse().unwrap(),
                cells[1].parse().unwrap(),
                cells[2].parse().unwrap(),
            )
        })
        .collect();
    inverse_queries.extend([
        (1, 0.0, 0.0),
        (1, 612.0, 792.0),
        (1, 306.0, 396.0),
        (999, 100.0, 100.0),
    ]);

    let forward: Vec<String> = forward
        .iter()
        .map(|(file, line)| {
            json(&ForwardCase {
                file,
                line: *line,
                hit: forward_hit(&doc, file, *line, &roots),
            })
        })
        .collect();
    let inverse: Vec<String> = inverse_queries
        .iter()
        .map(|&(page, x, y)| {
            json(&InverseCase {
                page,
                x,
                y,
                hit: inverse(&doc, page, x, y, &roots),
            })
        })
        .collect();
    format!(
        "{{\n  \"fixture\": {},\n  \"roots\": {},\n  \"projectPaths\": {},\n  \"forward\": [\n    {}\n  ],\n  \"inverse\": [\n    {}\n  ]\n}}\n",
        json(&format!("{name}.synctex.gz")),
        json(&roots),
        json(project),
        forward.join(",\n    "),
        inverse.join(",\n    "),
    )
}

#[test]
fn the_synctex_golden_files_match_the_native_search() {
    let update = std::env::var_os("UPDATE_SYNCTEX_GOLDEN").is_some_and(|value| value == "1");
    let mut stale = Vec::new();
    for (name, project) in FIXTURES {
        let expected = golden(name, project);
        let path = fixtures_dir().join(format!("{name}.expected.json"));
        if update {
            std::fs::write(&path, &expected).unwrap();
            continue;
        }
        let Ok(found) = std::fs::read_to_string(&path) else {
            stale.push(format!("{} is missing", path.display()));
            continue;
        };
        if found != expected {
            let line = found
                .lines()
                .zip(expected.lines())
                .position(|(found, expected)| found != expected)
                .unwrap_or_else(|| found.lines().count().min(expected.lines().count()));
            stale.push(format!("{} differs from line {}", path.display(), line + 1));
        }
    }
    assert!(
        stale.is_empty(),
        "{}; rerun with UPDATE_SYNCTEX_GOLDEN=1 if the change is meant",
        stale.join("; ")
    );
}
