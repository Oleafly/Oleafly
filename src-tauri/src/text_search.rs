use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

use grep_searcher::sinks::Lossy;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::search_modes::{
    fuzzy_matcher, index_ranges, utf16_ranges, FuzzyPattern, SearchMode, TextPattern,
};

const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 1000;
const MAX_BRANCHES: usize = 32;
const MAX_TERMS: usize = 32;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_SCANNED_BYTES: usize = 256 << 20;
const MAX_LINES_PER_FILE: usize = 50;
const PREVIEW_CHARS: usize = 200;
const BINARY_PROBE: usize = 8192;
const DEADLINE: Duration = Duration::from_secs(8);
const PATH_WEIGHT: f64 = 10.0;
const SKIPPED_EXTENSIONS: [&str; 14] = [
    "aux",
    "log",
    "out",
    "toc",
    "lof",
    "lot",
    "fls",
    "fdb_latexmk",
    "bbl",
    "blg",
    "synctex",
    "xdv",
    "pdf",
    "gz",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TermKind {
    Text,
    Path,
    Ext,
    Project,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TextTerm {
    pub kind: TermKind,
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TextBranch {
    #[serde(default)]
    pub all: Vec<TextTerm>,
    #[serde(default)]
    pub none: Vec<TextTerm>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TextQuery {
    pub branches: Vec<TextBranch>,
    #[serde(default)]
    pub mode: SearchMode,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextSearchHit {
    pub project_id: String,
    pub project_name: String,
    pub path: String,
    pub line: u32,
    pub preview: String,
    pub ranges: Vec<[u32; 2]>,
}

struct Term {
    kind: TermKind,
    lower: String,
    pattern: Option<TextPattern>,
    fuzzy: Option<FuzzyPattern>,
}

struct Branch {
    all: Vec<Term>,
    none: Vec<Term>,
    lines: Option<TextPattern>,
}

struct Compiled {
    mode: SearchMode,
    branches: Vec<Branch>,
    limit: usize,
}

fn term(raw: &TextTerm, mode: SearchMode) -> Result<Term, String> {
    let value = raw.value.trim();
    let text = raw.kind == TermKind::Text && mode != SearchMode::Fuzzy;
    let fuzzy = mode == SearchMode::Fuzzy && matches!(raw.kind, TermKind::Text | TermKind::Path);
    let grep_mode = if mode == SearchMode::Regex {
        SearchMode::Regex
    } else {
        SearchMode::Exact
    };
    Ok(Term {
        kind: raw.kind,
        lower: value.trim_start_matches('.').to_lowercase(),
        pattern: if text {
            Some(TextPattern::new(value, grep_mode)?)
        } else {
            None
        },
        fuzzy: fuzzy.then(|| FuzzyPattern::new(value)),
    })
}

fn compile(query: &TextQuery) -> Result<Compiled, String> {
    let mut branches = Vec::new();
    for branch in query.branches.iter().take(MAX_BRANCHES) {
        let all: Vec<Term> = branch
            .all
            .iter()
            .filter(|raw| !raw.value.trim().is_empty())
            .take(MAX_TERMS)
            .map(|raw| term(raw, query.mode))
            .collect::<Result<_, _>>()?;
        let none: Vec<Term> = branch
            .none
            .iter()
            .filter(|raw| !raw.value.trim().is_empty())
            .take(MAX_TERMS)
            .map(|raw| term(raw, query.mode))
            .collect::<Result<_, _>>()?;
        let texts: Vec<&str> = branch
            .all
            .iter()
            .filter(|raw| raw.kind == TermKind::Text && !raw.value.trim().is_empty())
            .map(|raw| raw.value.trim())
            .collect();
        let grep_mode = if query.mode == SearchMode::Regex {
            SearchMode::Regex
        } else {
            SearchMode::Exact
        };
        let lines = if texts.is_empty() || query.mode == SearchMode::Fuzzy {
            None
        } else {
            Some(TextPattern::many(&texts, grep_mode)?)
        };
        if !all.is_empty() || !none.is_empty() {
            branches.push(Branch { all, none, lines });
        }
    }
    let limit = query
        .limit
        .map_or(DEFAULT_LIMIT, |limit| limit as usize)
        .clamp(1, MAX_LIMIT);
    Ok(Compiled {
        mode: query.mode,
        branches,
        limit,
    })
}

struct Candidate<'a> {
    project: &'a str,
    rel: &'a str,
    lower_rel: String,
    extension: String,
}

struct Fuzzy {
    matcher: nucleo_matcher::Matcher,
    buffer: Vec<char>,
}

fn needs_text(term: &Term) -> bool {
    term.pattern.is_some()
}

fn path_term(term: &Term, file: &Candidate<'_>, fuzzy: &mut Fuzzy) -> Option<f64> {
    if let Some(pattern) = &term.fuzzy {
        if pattern.is_empty() {
            return Some(0.0);
        }
        return pattern
            .score(file.rel, &mut fuzzy.matcher, &mut fuzzy.buffer)
            .map(f64::from);
    }
    let found = match term.kind {
        TermKind::Path => file.lower_rel.contains(&term.lower),
        TermKind::Ext => file.extension == term.lower,
        TermKind::Project => file.project.to_lowercase().contains(&term.lower),
        TermKind::Text => return None,
    };
    found.then_some(0.0)
}

fn term_score(
    term: &Term,
    file: &Candidate<'_>,
    text: Option<&str>,
    fuzzy: &mut Fuzzy,
) -> Option<f64> {
    if let Some(pattern) = &term.pattern {
        let text = text?;
        let count = pattern.find_all(text, 64).len();
        if count == 0 {
            return None;
        }
        let path_bonus = if file.lower_rel.contains(&term.lower) {
            PATH_WEIGHT
        } else {
            0.0
        };
        return Some(1.0 + (count as f64).log2() + path_bonus);
    }
    path_term(term, file, fuzzy)
}

fn branch_score(
    branch: &Branch,
    file: &Candidate<'_>,
    text: Option<&str>,
    fuzzy: &mut Fuzzy,
) -> Option<f64> {
    let mut score = 0.0;
    for term in &branch.all {
        score += term_score(term, file, text, fuzzy)?;
    }
    if branch
        .none
        .iter()
        .any(|term| term_score(term, file, text, fuzzy).is_some())
    {
        return None;
    }
    Some(score)
}

fn could_hold(branch: &Branch, file: &Candidate<'_>, fuzzy: &mut Fuzzy) -> bool {
    branch
        .all
        .iter()
        .filter(|term| !needs_text(term))
        .all(|term| path_term(term, file, fuzzy).is_some())
        && !branch
            .none
            .iter()
            .filter(|term| !needs_text(term))
            .any(|term| path_term(term, file, fuzzy).is_some())
}

fn read_text(path: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file()
        || metadata.len() > MAX_FILE_BYTES
        || crate::cloud_files::is_placeholder(path, &metadata)
    {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes[..bytes.len().min(BINARY_PROBE)].contains(&0) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn preview(line: &str, ranges: &[(usize, usize)]) -> (String, Vec<[u32; 2]>) {
    let body = line.trim_end_matches(['\n', '\r']);
    let lead = body.len() - body.trim_start().len();
    let trimmed = &body[lead..];
    let cut = trimmed
        .char_indices()
        .nth(PREVIEW_CHARS)
        .map_or(trimmed.len(), |(at, _)| at);
    let shown = &trimmed[..cut];
    let shifted: Vec<(usize, usize)> = ranges
        .iter()
        .filter(|(start, _)| *start >= lead && start - lead < cut)
        .map(|(start, end)| (start - lead, (end - lead).min(cut)))
        .collect();
    (shown.to_string(), utf16_ranges(shown, &shifted))
}

fn matching_lines(patterns: &[&TextPattern], text: &str) -> Vec<(u32, String, Vec<[u32; 2]>)> {
    let mut lines: BTreeMap<u64, (String, Vec<(usize, usize)>)> = BTreeMap::new();
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();
    for pattern in patterns {
        let _ = searcher.search_slice(
            pattern.matcher(),
            text.as_bytes(),
            Lossy(|number, line| {
                let entry = lines
                    .entry(number)
                    .or_insert_with(|| (line.to_string(), Vec::new()));
                entry.1.extend(pattern.find_all(line, 64));
                Ok(lines.len() < MAX_LINES_PER_FILE)
            }),
        );
    }
    lines
        .into_iter()
        .map(|(number, (line, mut ranges))| {
            ranges.sort_unstable();
            let (shown, units) = preview(&line, &ranges);
            (u32::try_from(number).unwrap_or(u32::MAX), shown, units)
        })
        .collect()
}

struct Scored {
    score: f64,
    hits: Vec<TextSearchHit>,
}

struct Walk<'a> {
    compiled: &'a Compiled,
    deadline: Instant,
    found: Vec<Scored>,
    total: usize,
    scanned: usize,
    fuzzy: Fuzzy,
}

impl<'a> Walk<'a> {
    fn new(compiled: &'a Compiled) -> Self {
        Self {
            compiled,
            deadline: Instant::now() + DEADLINE,
            found: Vec::new(),
            total: 0,
            scanned: 0,
            fuzzy: Fuzzy {
                matcher: fuzzy_matcher(true),
                buffer: Vec::new(),
            },
        }
    }

    fn done(&self) -> bool {
        (self.compiled.mode.greps() && self.total >= self.compiled.limit)
            || self.scanned >= MAX_SCANNED_BYTES
            || Instant::now() > self.deadline
    }

    fn keep(&mut self, scored: Scored) {
        self.total += scored.hits.len();
        self.found.push(scored);
        if !self.compiled.mode.greps() && self.found.len() >= 2 * self.compiled.limit {
            best_first(&mut self.found);
            self.found.truncate(self.compiled.limit);
        }
    }

    fn hits(self) -> Vec<TextSearchHit> {
        ordered(self.compiled, self.found)
    }

    fn root(&mut self, id: &str, name: &str, root: &Path) {
        let walker = WalkBuilder::new(root)
            .require_git(false)
            .parents(false)
            .git_global(false)
            .follow_links(false)
            .max_depth(Some(crate::project::MAX_WALK_DEPTH))
            .filter_entry(|entry| {
                let name = entry.file_name();
                name != ".git" && name != ".oleafly" && name != "node_modules"
            })
            .build();
        let mut files = 0usize;
        for entry in walker.flatten() {
            if files >= MAX_FILES || self.done() {
                return;
            }
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            files += 1;
            let path = entry.path();
            let rel = crate::project::rel_slash(root, path);
            let lower_rel = rel.to_lowercase();
            let extension = Path::new(&rel)
                .extension()
                .map(|ext| ext.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if SKIPPED_EXTENSIONS.contains(&extension.as_str()) {
                continue;
            }
            let file = Candidate {
                project: name,
                rel: &rel,
                lower_rel,
                extension,
            };
            let open: Vec<&Branch> = self
                .compiled
                .branches
                .iter()
                .filter(|branch| could_hold(branch, &file, &mut self.fuzzy))
                .collect();
            if open.is_empty() {
                continue;
            }
            let wants_text = open
                .iter()
                .any(|branch| branch.all.iter().chain(&branch.none).any(needs_text));
            let text = if wants_text { read_text(path) } else { None };
            self.scanned += text.as_ref().map_or(0, String::len);
            let mut best: Option<f64> = None;
            let mut patterns: Vec<&TextPattern> = Vec::new();
            for branch in open {
                if let Some(score) = branch_score(branch, &file, text.as_deref(), &mut self.fuzzy) {
                    best = Some(best.map_or(score, |known| known.max(score)));
                    patterns.extend(branch.lines.as_ref());
                }
            }
            let Some(score) = best else {
                continue;
            };
            let lines = match (&text, patterns.is_empty()) {
                (Some(text), false) => matching_lines(&patterns, text),
                _ => vec![(
                    0,
                    rel.clone(),
                    path_ranges(self.compiled, &file, &mut self.fuzzy),
                )],
            };
            let room = if self.compiled.mode.greps() {
                self.compiled.limit - self.total
            } else {
                self.compiled.limit
            };
            let hits: Vec<TextSearchHit> = lines
                .into_iter()
                .take(room)
                .map(|(line, preview, ranges)| TextSearchHit {
                    project_id: id.to_string(),
                    project_name: name.to_string(),
                    path: rel.clone(),
                    line,
                    preview,
                    ranges,
                })
                .collect();
            self.keep(Scored { score, hits });
        }
    }
}

fn path_ranges(compiled: &Compiled, file: &Candidate<'_>, fuzzy: &mut Fuzzy) -> Vec<[u32; 2]> {
    let mut indices = Vec::new();
    let mut bytes = Vec::new();
    for branch in &compiled.branches {
        for term in &branch.all {
            if let Some(pattern) = term.fuzzy.as_ref().filter(|pattern| !pattern.is_empty()) {
                indices.extend(pattern.indices(file.rel, &mut fuzzy.matcher, &mut fuzzy.buffer));
            } else if term.kind == TermKind::Path {
                if let Some(at) = file.lower_rel.find(&term.lower) {
                    bytes.push((at, at + term.lower.len()));
                }
            }
        }
    }
    indices.sort_unstable();
    indices.dedup();
    let chars: Vec<(usize, char)> = file.rel.char_indices().collect();
    bytes.extend(
        index_ranges(&indices)
            .into_iter()
            .filter_map(|(start, end)| {
                let from = chars.get(start)?.0;
                let to = chars.get(end).map_or(file.rel.len(), |(at, _)| *at);
                Some((from, to))
            }),
    );
    bytes.sort_unstable();
    utf16_ranges(file.rel, &bytes)
}

fn best_first(found: &mut [Scored]) {
    fn key(scored: &Scored) -> Option<(&str, &str)> {
        scored
            .hits
            .first()
            .map(|hit| (hit.project_id.as_str(), hit.path.as_str()))
    }
    found.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| key(left).cmp(&key(right)))
    });
}

fn ordered(compiled: &Compiled, mut found: Vec<Scored>) -> Vec<TextSearchHit> {
    if !compiled.mode.greps() {
        best_first(&mut found);
    }
    found
        .into_iter()
        .flat_map(|scored| scored.hits)
        .take(compiled.limit)
        .collect()
}

pub(crate) fn search_files(
    project_id: Option<&str>,
    query: &TextQuery,
) -> Result<Vec<TextSearchHit>, String> {
    let compiled = compile(query)?;
    if compiled.branches.is_empty() {
        return Ok(Vec::new());
    }
    let mut walk = Walk::new(&compiled);
    match project_id {
        Some(id) => {
            crate::project::with_search_root(id, |root| walk.root(root.id, root.name, root.root))?
        }
        None => crate::project::visit_search_roots(|root| {
            walk.root(root.id, root.name, root.root);
            !walk.done()
        })?,
    }
    Ok(walk.hits())
}

#[tauri::command]
pub async fn text_search(
    project_id: Option<String>,
    query: TextQuery,
) -> Result<Vec<TextSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search_files(project_id.as_deref(), &query))
        .await
        .map_err(|error| format!("search failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> TextTerm {
        TextTerm {
            kind: TermKind::Text,
            value: value.into(),
        }
    }

    fn of(kind: TermKind, value: &str) -> TextTerm {
        TextTerm {
            kind,
            value: value.into(),
        }
    }

    fn query(mode: SearchMode, branches: Vec<TextBranch>) -> TextQuery {
        TextQuery {
            branches,
            mode,
            limit: None,
        }
    }

    fn branch(all: Vec<TextTerm>, none: Vec<TextTerm>) -> TextBranch {
        TextBranch { all, none }
    }

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let write = |rel: &str, body: &[u8]| {
            let path = dir.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        };
        write(
            "main.tex",
            b"\\\\section{Intro}\nThe mask ratio is 0.75.\nWe use a.b notation.\n",
        );
        write(
            "sections/results.tex",
            b"Results: mask ratio 0.60 beats 0.75.\nRatio of runs.\n",
        );
        write("refs.bib", b"@article{mae, title={Masked autoencoders}}\n");
        write("figure.png", b"\x89PNG\x00\x00binary mask");
        write("build/out.log", b"mask in a build log\n");
        write(".gitignore", b"build/\n");
        write(".oleafly/cache.txt", b"mask hidden\n");
        dir
    }

    fn run(dir: &Path, query: &TextQuery) -> Vec<(String, u32, String)> {
        let compiled = compile(query).unwrap();
        let mut walk = Walk::new(&compiled);
        walk.root("p", "Paper", dir);
        let mut hits: Vec<(String, u32, String)> = walk
            .hits()
            .into_iter()
            .map(|hit| (hit.path, hit.line, hit.preview))
            .collect();
        if !matches!(query.mode, SearchMode::Ranked | SearchMode::Fuzzy) {
            hits.sort();
        }
        hits
    }

    #[test]
    fn exact_mode_finds_literal_lines_and_skips_ignored_binary_and_app_files() {
        let dir = fixture();
        let hits = run(
            dir.path(),
            &query(
                SearchMode::Exact,
                vec![branch(vec![text("mask ratio")], vec![])],
            ),
        );
        assert_eq!(
            hits,
            vec![
                (
                    "main.tex".to_string(),
                    2,
                    "The mask ratio is 0.75.".to_string()
                ),
                (
                    "sections/results.tex".to_string(),
                    1,
                    "Results: mask ratio 0.60 beats 0.75.".to_string()
                ),
            ]
        );
        let dotted = run(
            dir.path(),
            &query(SearchMode::Exact, vec![branch(vec![text("a.b")], vec![])]),
        );
        assert_eq!(dotted.len(), 1);
    }

    #[test]
    fn regex_mode_and_boolean_branches() {
        let dir = fixture();
        let regex = run(
            dir.path(),
            &query(
                SearchMode::Regex,
                vec![branch(vec![text(r"0\.\d0")], vec![])],
            ),
        );
        assert_eq!(
            regex,
            vec![(
                "sections/results.tex".to_string(),
                1,
                "Results: mask ratio 0.60 beats 0.75.".to_string()
            )]
        );
        let either = run(
            dir.path(),
            &query(
                SearchMode::Exact,
                vec![
                    branch(vec![text("Intro")], vec![]),
                    branch(vec![text("Masked")], vec![]),
                ],
            ),
        );
        assert_eq!(
            either.iter().map(|hit| hit.0.as_str()).collect::<Vec<_>>(),
            vec!["main.tex", "refs.bib"]
        );
        let without = run(
            dir.path(),
            &query(
                SearchMode::Exact,
                vec![branch(vec![text("mask")], vec![text("Intro")])],
            ),
        );
        assert!(without.iter().all(|hit| hit.0 != "main.tex"));
        let in_path = run(
            dir.path(),
            &query(
                SearchMode::Exact,
                vec![branch(
                    vec![text("mask"), of(TermKind::Path, "sections/")],
                    vec![],
                )],
            ),
        );
        assert_eq!(in_path.len(), 1);
        let by_ext = run(
            dir.path(),
            &query(
                SearchMode::Exact,
                vec![branch(vec![of(TermKind::Ext, ".bib")], vec![])],
            ),
        );
        assert_eq!(
            by_ext,
            vec![("refs.bib".to_string(), 0, "refs.bib".to_string())]
        );
        assert!(compile(&query(
            SearchMode::Regex,
            vec![branch(vec![text("(")], vec![])]
        ))
        .is_err());
    }

    #[test]
    fn ranked_mode_puts_files_with_more_matches_first_and_fuzzy_matches_paths() {
        let dir = fixture();
        let ranked = run(
            dir.path(),
            &query(
                SearchMode::Ranked,
                vec![branch(vec![text("ratio")], vec![])],
            ),
        );
        assert_eq!(ranked[0].0, "sections/results.tex");
        let fuzzy = run(
            dir.path(),
            &query(SearchMode::Fuzzy, vec![branch(vec![text("sctrs")], vec![])]),
        );
        assert_eq!(
            fuzzy,
            vec![(
                "sections/results.tex".to_string(),
                0,
                "sections/results.tex".to_string()
            )]
        );
        let hits = {
            let compiled = compile(&query(
                SearchMode::Fuzzy,
                vec![branch(vec![text("rsl")], vec![])],
            ))
            .unwrap();
            let mut walk = Walk::new(&compiled);
            walk.root("p", "Paper", dir.path());
            walk.hits()
        };
        assert!(!hits[0].ranges.is_empty());
        assert!(compile(&query(
            SearchMode::Exact,
            vec![branch(vec![text("  ")], vec![])]
        ))
        .unwrap()
        .branches
        .is_empty());
    }

    fn folder(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (rel, body) in files {
            let path = dir.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        dir
    }

    fn across(roots: &[&Path], query: &TextQuery) -> Vec<String> {
        let compiled = compile(query).unwrap();
        let mut walk = Walk::new(&compiled);
        for (index, root) in roots.iter().enumerate() {
            walk.root(&index.to_string(), "Paper", root);
        }
        walk.hits().into_iter().map(|hit| hit.path).collect()
    }

    #[test]
    fn ranked_and_fuzzy_keep_the_best_files_found_after_the_limit_fills() {
        let weak = folder(&[
            ("a.tex", "one ratio\n"),
            ("b.tex", "two ratio\n"),
            ("c.tex", "three ratio\n"),
            ("inside/the/report.txt", "x\n"),
        ]);
        let strong = folder(&[(
            "best.tex",
            "ratio ratio\nratio\nratio\nratio\nratio\nratio\n",
        )]);
        let roots = [weak.path(), strong.path()];
        let mut ranked = query(
            SearchMode::Ranked,
            vec![branch(vec![text("ratio")], vec![])],
        );
        ranked.limit = Some(1);
        assert_eq!(across(&roots, &ranked), vec!["best.tex"]);
        ranked.limit = Some(3);
        assert_eq!(across(&roots, &ranked), vec!["best.tex"; 3]);

        let intro = folder(&[("sections/introduction.tex", "x\n")]);
        let mut fuzzy = query(SearchMode::Fuzzy, vec![branch(vec![text("intro")], vec![])]);
        fuzzy.limit = Some(1);
        assert_eq!(
            across(&[weak.path(), intro.path()], &fuzzy),
            vec!["sections/introduction.tex"]
        );

        let mut exact = query(SearchMode::Exact, vec![branch(vec![text("ratio")], vec![])]);
        exact.limit = Some(1);
        assert_eq!(across(&roots, &exact).len(), 1);
        assert!(!across(&roots, &exact).contains(&"best.tex".to_string()));
    }

    #[test]
    fn ignore_files_above_the_project_root_do_not_apply() {
        let outer = folder(&[
            (".gitignore", "*.csv\ndata/\n"),
            ("paper/.gitignore", "build/\n"),
            ("paper/data/runs.csv", "mask 1\n"),
            ("paper/notes.csv", "mask 2\n"),
            ("paper/build/out.txt", "mask 3\n"),
        ]);
        let mut hits = across(
            &[&outer.path().join("paper")],
            &query(SearchMode::Exact, vec![branch(vec![text("mask")], vec![])]),
        );
        hits.sort();
        assert_eq!(hits, vec!["data/runs.csv", "notes.csv"]);
    }

    #[test]
    fn regex_line_ends_match_in_crlf_files() {
        let dir = folder(&[("main.tex", "\\begin{a}\r\nplain\r\n\\end{a}\r\n")]);
        let hits = run(
            dir.path(),
            &query(SearchMode::Regex, vec![branch(vec![text(r"\}$")], vec![])]),
        );
        assert_eq!(
            hits,
            vec![
                ("main.tex".to_string(), 1, "\\begin{a}".to_string()),
                ("main.tex".to_string(), 3, "\\end{a}".to_string()),
            ]
        );
    }

    #[test]
    fn previews_trim_and_keep_utf16_ranges() {
        let (shown, ranges) = preview("    😀 mask here\n", &[(9, 13)]);
        assert_eq!(shown, "😀 mask here");
        assert_eq!(ranges, vec![[3, 7]]);
    }
    #[test]
    #[ignore = "timing run, prints how long each mode takes over a generated project of 2,000 files"]
    fn timing_over_a_generated_project() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..2_000 {
            let folder = dir.path().join(format!("chapter-{}", index % 20));
            std::fs::create_dir_all(&folder).unwrap();
            let body: String = (0..60)
                .map(|line| format!("Section {index}.{line}: the mask ratio of 0.{} beat the encoder baseline.\n", (index + line) % 10))
                .collect();
            std::fs::write(folder.join(format!("part-{index}.tex")), body).unwrap();
        }
        for (label, mode, branches) in [
            (
                "ranked, whole project",
                SearchMode::Ranked,
                vec![branch(vec![text("mask"), text("encoder")], vec![])],
            ),
            (
                "exact, whole project",
                SearchMode::Exact,
                vec![branch(vec![text("Section 1999.59:")], vec![])],
            ),
            (
                "regex, whole project",
                SearchMode::Regex,
                vec![branch(vec![text(r"Section 1\d\d\.5:")], vec![])],
            ),
            (
                "fuzzy paths",
                SearchMode::Fuzzy,
                vec![branch(vec![text("ch7prt1")], vec![])],
            ),
        ] {
            let started = Instant::now();
            let hits = run(dir.path(), &query(mode, branches));
            eprintln!("{label}: {} hits in {:?}", hits.len(), started.elapsed());
            assert!(!hits.is_empty(), "{label}");
        }
    }
}
