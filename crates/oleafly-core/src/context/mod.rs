//! A project map for agents and the CLI: the same outline, labels, citation
//! keys, macros, include graph and unresolved references the app's
//! `project_map` tool reports (a small Rust port of
//! `src/lib/project-intelligence`), plus a few extras only the CLI shows
//! (file roles, unused citations and labels, missing files, packages).
//!
//! Golden fixtures in `tests/fixtures/context/` hold the app's output for
//! each case; `tests/context_golden.rs` checks this port against them.
mod bib;
mod latex;
mod markdown;
mod text;
mod typst;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use serde::Serialize;

use self::text::{dirname, normalize_project_path, resolve_project_path_from};

/// How much of a project a scan reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextLimits {
    /// Source files read (the rest are skipped and named).
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for ContextLimits {
    fn default() -> Self {
        Self {
            max_files: 5_000,
            max_file_bytes: 4 * 1024 * 1024,
            max_total_bytes: 64 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMap {
    pub files: Vec<String>,
    pub sections: Vec<SectionEntry>,
    pub labels: Vec<String>,
    pub bib_keys: Vec<String>,
    pub macros: Vec<String>,
    pub theorems: Vec<String>,
    pub glossary: Vec<String>,
    pub input_graph: Vec<InputEdge>,
    pub unresolved_refs: Vec<String>,
    pub unresolved_cites: Vec<String>,
    pub ambiguous_typst_at_uses: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct SectionEntry {
    pub title: String,
    pub level: u32,
    pub file: String,
    pub line: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct InputEdge {
    pub from: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileRole {
    Main,
    Source,
    Bibliography,
    Figure,
    Style,
    Data,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MissingFile {
    pub file: String,
    pub line: u32,
    pub target: String,
    /// `figure`, `input` or `bibliography`.
    pub kind: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PackageUse {
    pub name: String,
    pub file: String,
    pub line: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ContextScan {
    pub map: ProjectMap,
    pub roles: BTreeMap<String, FileRole>,
    pub unused_cites: Vec<String>,
    pub unused_labels: Vec<String>,
    pub missing_files: Vec<MissingFile>,
    pub packages: Vec<PackageUse>,
    pub truncated: bool,
    pub skipped: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DefKind {
    Section,
    /// Labels, anchors and glossary entries, as the app files them.
    Label,
    Macro,
    Bibentry,
}

#[derive(Clone, Debug)]
pub(crate) struct Def {
    pub kind: DefKind,
    pub name: String,
    pub file: String,
    /// Character offset of the name.
    pub from: usize,
    pub line: u32,
    pub level: Option<u32>,
    /// Written by the author (not a Markdown heading's automatic anchor).
    pub explicit: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UseKind {
    Ref,
    Cite,
    Include,
    Import,
    Bibliography,
    Asset,
}

#[derive(Clone, Debug)]
pub(crate) struct Use {
    pub kind: UseKind,
    pub name: String,
    pub file: String,
    pub from: usize,
    pub line: u32,
    pub target: Option<String>,
    /// A Typst `@name`, which may be a label or a citation.
    pub typst_at: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct FileFacts {
    pub defs: Vec<Def>,
    pub uses: Vec<Use>,
    pub packages: Vec<PackageUse>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Engine {
    Latex,
    Typst,
    Markdown,
    Bibtex,
}

fn lower_extension(path: &str) -> String {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.rfind('.')
        .map(|dot| last[dot + 1..].to_ascii_lowercase())
        .unwrap_or_default()
}

fn engine_for(path: &str) -> Option<Engine> {
    match lower_extension(path).as_str() {
        "bib" => Some(Engine::Bibtex),
        "typ" => Some(Engine::Typst),
        "md" | "markdown" => Some(Engine::Markdown),
        "tex" | "ltx" | "latex" | "sty" | "cls" => Some(Engine::Latex),
        _ => None,
    }
}

fn is_hayagriva(path: &str) -> bool {
    matches!(lower_extension(path).as_str(), "yml" | "yaml")
}

/// `isBibliographyYamlCandidate`: YAML outside dot folders, not a lockfile.
fn is_bibliography_yaml(path: &str) -> bool {
    if !is_hayagriva(path) {
        return false;
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().any(|part| part.starts_with('.')) {
        return false;
    }
    let last = parts.last().unwrap_or(&"").to_ascii_lowercase();
    let stem = last.trim_end_matches(".yaml").trim_end_matches(".yml");
    !(stem == "lock"
        || stem.ends_with("-lock")
        || stem.ends_with("_lock")
        || stem.ends_with(".lock"))
}

pub(crate) fn is_vendored_typst(path: &str) -> bool {
    path.split('/').next() == Some("typst-packages")
}

/// The files the app's analyzer reads.
pub fn is_context_path(path: &str) -> bool {
    !is_vendored_typst(path) && (engine_for(path).is_some() || is_bibliography_yaml(path))
}

fn analyze_file(path: &str, text: &str) -> FileFacts {
    match engine_for(path) {
        Some(Engine::Latex) => latex::analyze(path, text),
        Some(Engine::Typst) => typst::analyze(path, text),
        Some(Engine::Markdown) => markdown::analyze(path, text),
        Some(Engine::Bibtex) => bib::analyze_bibtex(path, text),
        None if is_hayagriva(path) => bib::analyze_hayagriva(path, text),
        None => FileFacts::default(),
    }
}

/// The pool a label lives in: per engine, per file for Markdown.
fn label_scope(file: &str) -> String {
    match engine_for(file) {
        Some(Engine::Markdown) => format!("markdown:{file}"),
        Some(Engine::Latex) => "latex".into(),
        Some(Engine::Typst) => "typst".into(),
        Some(Engine::Bibtex) => "bibtex".into(),
        None => "unknown".into(),
    }
}

const INCLUDE_EXTENSIONS: [&str; 6] = [".tex", ".ltx", ".latex", ".typ", ".md", ".markdown"];
const FIGURE_EXTENSIONS: [&str; 6] = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];

struct Known {
    exact: BTreeSet<String>,
    folded: HashMap<String, Vec<String>>,
}

impl Known {
    fn new(files: &[String]) -> Known {
        let exact: BTreeSet<String> = files
            .iter()
            .filter_map(|file| normalize_project_path(file))
            .collect();
        let mut folded: HashMap<String, Vec<String>> = HashMap::new();
        for file in &exact {
            folded
                .entry(file.to_lowercase())
                .or_default()
                .push(file.clone());
        }
        Known { exact, folded }
    }

    /// `candidatesForPath`: the file itself (case-insensitively too), and
    /// with each extension when it has none.
    fn candidates(&self, normalized: &str, extensions: &[&str]) -> Vec<String> {
        let mut found: BTreeSet<String> = BTreeSet::new();
        let mut add = |path: &str| {
            if self.exact.contains(path) {
                found.insert(path.to_string());
            }
            for file in self.folded.get(&path.to_lowercase()).into_iter().flatten() {
                found.insert(file.clone());
            }
        };
        add(normalized);
        let last = normalized.rsplit('/').next().unwrap_or(normalized);
        let has_extension = last.rfind('.').is_some_and(|dot| {
            let extension = &last[dot + 1..];
            !extension.is_empty()
                && extension
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        });
        if !has_extension {
            for extension in extensions {
                add(&format!("{normalized}{extension}"));
            }
        }
        found.into_iter().collect()
    }

    fn in_directories(
        &self,
        directories: &[String],
        raw: &str,
        extensions: &[&str],
        default_extension: Option<&str>,
    ) -> Vec<String> {
        for directory in directories {
            let Some(target) = resolve_project_path_from(directory, raw, default_extension) else {
                continue;
            };
            let found = self.candidates(&target, extensions);
            if !found.is_empty() {
                return found;
            }
        }
        Vec::new()
    }
}

fn unique_directories(directories: [&str; 3]) -> Vec<String> {
    let mut unique: Vec<String> = Vec::new();
    for directory in directories {
        if !unique.iter().any(|existing| existing == directory) {
            unique.push(directory.to_string());
        }
    }
    unique
}

/// Resolves include and import targets like the app: against the known
/// files, and for LaTeX includes reached from the main document also from
/// the main document's folder.
fn resolve_inputs(uses: &mut [Use], known: &Known, main_document: &str) -> Vec<bool> {
    let mut resolved = vec![false; uses.len()];
    for (index, use_) in uses.iter_mut().enumerate() {
        if !matches!(use_.kind, UseKind::Include | UseKind::Import) {
            continue;
        }
        let Some(target) = use_.target.as_deref().and_then(normalize_project_path) else {
            continue;
        };
        let found = known.candidates(&target, &INCLUDE_EXTENSIONS);
        if found.len() == 1 {
            use_.target = Some(found[0].clone());
            resolved[index] = true;
        }
    }
    if main_document.is_empty() {
        return resolved;
    }
    let main_directory = dirname(main_document).to_string();
    let original: Vec<Option<String>> = uses.iter().map(|use_| use_.target.clone()).collect();
    let mut reachable: BTreeSet<String> = BTreeSet::new();
    let mut pending = vec![main_document.to_string()];
    while let Some(file) = pending.pop() {
        if !reachable.insert(file.clone()) {
            continue;
        }
        for index in 0..uses.len() {
            let use_ = &uses[index];
            if use_.file != file || !matches!(use_.kind, UseKind::Include | UseKind::Import) {
                continue;
            }
            if use_.kind == UseKind::Include
                && engine_for(&use_.file) == Some(Engine::Latex)
                && original[index].is_some()
            {
                let directories =
                    unique_directories([main_directory.as_str(), "", dirname(&use_.file)]);
                let found =
                    known.in_directories(&directories, &use_.name, &INCLUDE_EXTENSIONS, None);
                if found.len() == 1 {
                    uses[index].target = Some(found[0].clone());
                    resolved[index] = true;
                } else {
                    resolved[index] = false;
                }
            }
            if resolved[index] {
                if let Some(target) = uses[index].target.clone() {
                    pending.push(target);
                }
            }
        }
    }
    resolved
}

fn role_of(path: &str, main_document: &str) -> FileRole {
    if path == main_document {
        return FileRole::Main;
    }
    match lower_extension(path).as_str() {
        "tex" | "ltx" | "latex" | "typ" | "md" | "markdown" => FileRole::Source,
        "sty" | "cls" | "bst" | "bbx" | "cbx" | "csl" => FileRole::Style,
        "bib" => FileRole::Bibliography,
        "yml" | "yaml" if is_bibliography_yaml(path) => FileRole::Bibliography,
        "png" | "jpg" | "jpeg" | "pdf" | "eps" | "svg" | "webp" | "gif" | "tif" | "tiff" => {
            FileRole::Figure
        }
        "csv" | "tsv" | "json" | "dat" | "txt" | "yml" | "yaml" | "xml" => FileRole::Data,
        _ => FileRole::Other,
    }
}

/// The scan of a set of sources. `sources` maps project paths to their
/// text (line endings `\n`); `all_files` lists every file in the project.
pub fn scan_sources(
    sources: &BTreeMap<String, String>,
    all_files: &[String],
    main_document: &str,
) -> ContextScan {
    let mut defs: Vec<Def> = Vec::new();
    let mut uses: Vec<Use> = Vec::new();
    let mut packages: Vec<PackageUse> = Vec::new();
    for (path, text) in sources {
        let facts = analyze_file(path, text);
        defs.extend(facts.defs);
        uses.extend(facts.uses);
        packages.extend(facts.packages);
    }
    defs.sort_by(|left, right| left.file.cmp(&right.file).then(left.from.cmp(&right.from)));
    uses.sort_by(|left, right| left.file.cmp(&right.file).then(left.from.cmp(&right.from)));

    let known = Known::new(&sources.keys().cloned().collect::<Vec<_>>());
    let resolved = resolve_inputs(&mut uses, &known, main_document);

    let labels_by_scope: BTreeSet<(String, String)> = defs
        .iter()
        .filter(|def| def.kind == DefKind::Label)
        .map(|def| (label_scope(&def.file), def.name.clone()))
        .collect();
    let bib_keys: BTreeSet<&str> = defs
        .iter()
        .filter(|def| def.kind == DefKind::Bibentry)
        .map(|def| def.name.as_str())
        .collect();

    let mut unresolved_refs: Vec<String> = Vec::new();
    let mut unresolved_cites: Vec<String> = Vec::new();
    let mut cited: BTreeSet<String> = BTreeSet::new();
    let mut referenced: BTreeSet<(String, String)> = BTreeSet::new();
    for use_ in &uses {
        match use_.kind {
            UseKind::Ref => {
                let key = (label_scope(&use_.file), use_.name.clone());
                if labels_by_scope.contains(&key) {
                    referenced.insert(key);
                } else if use_.typst_at && bib_keys.contains(use_.name.as_str()) {
                    cited.insert(use_.name.clone());
                } else if !unresolved_refs.contains(&use_.name) {
                    unresolved_refs.push(use_.name.clone());
                }
            }
            UseKind::Cite => {
                cited.insert(use_.name.clone());
                if !bib_keys.contains(use_.name.as_str()) && !unresolved_cites.contains(&use_.name)
                {
                    unresolved_cites.push(use_.name.clone());
                }
            }
            _ => {}
        }
    }

    let names = |kind: DefKind| {
        defs.iter()
            .filter(|def| def.kind == kind)
            .map(|def| def.name.clone())
            .collect::<Vec<_>>()
    };
    let mut files: Vec<String> = sources.keys().cloned().collect();
    files.sort();
    let map = ProjectMap {
        files,
        sections: defs
            .iter()
            .filter(|def| def.kind == DefKind::Section)
            .map(|def| SectionEntry {
                title: def.name.clone(),
                level: def.level.unwrap_or(0),
                file: def.file.clone(),
                line: def.line,
            })
            .collect(),
        labels: names(DefKind::Label),
        bib_keys: names(DefKind::Bibentry),
        macros: names(DefKind::Macro),
        theorems: Vec::new(),
        glossary: Vec::new(),
        input_graph: uses
            .iter()
            .filter(|use_| matches!(use_.kind, UseKind::Include | UseKind::Import))
            .map(|use_| InputEdge {
                from: use_.file.clone(),
                to: use_.target.clone(),
            })
            .collect(),
        unresolved_refs,
        unresolved_cites,
        ambiguous_typst_at_uses: Vec::new(),
    };

    let unused_cites: Vec<String> = bib_keys
        .iter()
        .filter(|key| !cited.contains(**key))
        .map(|key| key.to_string())
        .collect();
    let unused_labels: Vec<String> = defs
        .iter()
        .filter(|def| {
            def.kind == DefKind::Label
                && def.explicit
                && engine_for(&def.file) != Some(Engine::Bibtex)
        })
        .filter(|def| !referenced.contains(&(label_scope(&def.file), def.name.clone())))
        .map(|def| def.name.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let all_known = Known::new(all_files);
    let main_directory = dirname(main_document).to_string();
    let mut missing_files: Vec<MissingFile> = Vec::new();
    for (index, use_) in uses.iter().enumerate() {
        let directories = unique_directories([main_directory.as_str(), "", dirname(&use_.file)]);
        let (kind, found) = match use_.kind {
            UseKind::Include | UseKind::Import => {
                ("input", resolved[index] || use_.target.is_none())
            }
            UseKind::Asset => (
                "figure",
                use_.target.is_none()
                    || !all_known
                        .in_directories(&directories, &use_.name, &FIGURE_EXTENSIONS, None)
                        .is_empty(),
            ),
            UseKind::Bibliography => {
                let default = match engine_for(&use_.file) {
                    Some(Engine::Latex) if !use_.name.contains('.') => Some(".bib"),
                    _ => None,
                };
                (
                    "bibliography",
                    use_.target.is_none()
                        || !all_known
                            .in_directories(&directories, &use_.name, &[], default)
                            .is_empty(),
                )
            }
            UseKind::Ref | UseKind::Cite => continue,
        };
        if !found {
            missing_files.push(MissingFile {
                file: use_.file.clone(),
                line: use_.line,
                target: use_.name.clone(),
                kind,
            });
        }
    }
    packages.sort_by(|left, right| left.file.cmp(&right.file).then(left.line.cmp(&right.line)));

    ContextScan {
        map,
        roles: all_files
            .iter()
            .map(|file| (file.clone(), role_of(file, main_document)))
            .collect(),
        unused_cites,
        unused_labels,
        missing_files,
        packages,
        truncated: false,
        skipped: Vec::new(),
    }
}

/// Text as the app's analyzer sees it: lossy UTF-8, `\r\n` and `\r` as `\n`.
pub fn normalize_source(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

const MAX_LISTED_FILES: usize = 50_000;

/// Scans the project at `root` (bounded by `limits`).
pub fn scan_project(
    root: &Path,
    main_document: &str,
    limits: &ContextLimits,
) -> crate::Result<ContextScan> {
    let mut all_files: Vec<String> = Vec::new();
    let mut candidates: Vec<(String, std::path::PathBuf)> = Vec::new();
    crate::walk_source_tree(root, "project context scan", &mut |relative, absolute| {
        let path = crate::slash_path(relative);
        if is_vendored_typst(&path) {
            return Ok(());
        }
        if all_files.len() < MAX_LISTED_FILES {
            all_files.push(path.clone());
        }
        if is_context_path(&path) {
            candidates.push((path, absolute.to_path_buf()));
        }
        Ok(())
    })?;
    all_files.sort();
    candidates.sort();
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    let mut total: u64 = 0;
    let mut truncated = false;
    let mut skipped: Vec<String> = Vec::new();
    for (path, absolute) in candidates {
        if sources.len() >= limits.max_files || total >= limits.max_total_bytes {
            truncated = true;
            if skipped.len() < 50 {
                skipped.push(path);
            }
            continue;
        }
        use std::io::Read;
        let Ok(file) = std::fs::File::open(&absolute) else {
            continue;
        };
        let budget = limits.max_file_bytes.min(limits.max_total_bytes - total);
        let mut bytes = Vec::new();
        if file.take(budget).read_to_end(&mut bytes).is_err() {
            continue;
        }
        total += bytes.len() as u64;
        sources.insert(path, normalize_source(&bytes));
    }
    let mut scan = scan_sources(&sources, &all_files, main_document);
    scan.truncated = truncated;
    scan.skipped = skipped;
    Ok(scan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(files: &[(&str, &str)]) -> BTreeMap<String, String> {
        files
            .iter()
            .map(|(path, text)| (path.to_string(), text.to_string()))
            .collect()
    }

    #[test]
    fn a_latex_project_maps_outline_labels_citations_and_inputs() {
        let files = sources(&[
            ("main.tex", "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\n\\input{chapters/intro}\nSee \\ref{sec:intro} and \\ref{sec:missing}. \\cite{knuth,nobody}\n\\bibliography{refs}\n\\end{document}\n"),
            ("chapters/intro.tex", "\\subsection{Background}\n\\includegraphics{fig/missing}\n"),
            ("refs.bib", "@book{knuth, title={T}}\n@book{unused, title={U}}\n"),
        ]);
        let all: Vec<String> = files.keys().cloned().collect();
        let scan = scan_sources(&files, &all, "main.tex");
        assert_eq!(
            scan.map.files,
            ["chapters/intro.tex", "main.tex", "refs.bib"]
        );
        let titles: Vec<&str> = scan
            .map
            .sections
            .iter()
            .map(|section| section.title.as_str())
            .collect();
        assert_eq!(titles, ["Background", "Intro"]);
        assert_eq!(scan.map.labels, ["sec:intro"]);
        assert_eq!(scan.map.bib_keys, ["knuth", "unused"]);
        assert_eq!(
            scan.map.input_graph,
            [InputEdge {
                from: "main.tex".into(),
                to: Some("chapters/intro.tex".into())
            }]
        );
        assert_eq!(scan.map.unresolved_refs, ["sec:missing"]);
        assert_eq!(scan.map.unresolved_cites, ["nobody"]);
        assert_eq!(scan.unused_cites, ["unused"]);
        assert!(scan.unused_labels.is_empty());
        assert_eq!(scan.missing_files.len(), 1);
        assert_eq!(scan.missing_files[0].kind, "figure");
        assert_eq!(scan.roles["main.tex"], FileRole::Main);
        assert_eq!(scan.roles["refs.bib"], FileRole::Bibliography);
    }

    #[test]
    fn typst_at_uses_resolve_to_labels_or_citations() {
        let files = sources(&[
            (
                "main.typ",
                "= Intro <sec:a>\nSee @sec:a, @knuth and @ghost.\n#bibliography(\"refs.bib\")\n",
            ),
            ("refs.bib", "@book{knuth, title={T}}\n"),
        ]);
        let all: Vec<String> = files.keys().cloned().collect();
        let scan = scan_sources(&files, &all, "main.typ");
        assert_eq!(scan.map.unresolved_refs, ["ghost"]);
        assert!(scan.map.unresolved_cites.is_empty());
        assert!(scan.unused_cites.is_empty());
    }

    #[test]
    fn crlf_sources_give_the_same_map_as_lf() {
        let lf = normalize_source(b"\\section{A}\n\\label{a}\n");
        let crlf = normalize_source(b"\\section{A}\r\n\\label{a}\r\n");
        assert_eq!(lf, crlf);
    }

    #[test]
    fn context_stops_at_the_file_limit_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..5 {
            std::fs::write(dir.path().join(format!("part{index}.tex")), "\\section{x}").unwrap();
        }
        let limits = ContextLimits {
            max_files: 3,
            ..ContextLimits::default()
        };
        let scan = scan_project(dir.path(), "part0.tex", &limits).unwrap();
        assert!(scan.truncated);
        assert_eq!(scan.map.files.len(), 3);
        assert_eq!(scan.skipped.len(), 2);
    }

    #[test]
    fn vendored_typst_packages_and_generated_dirs_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("typst-packages/local/x/0.1.0")).unwrap();
        std::fs::write(
            dir.path().join("typst-packages/local/x/0.1.0/lib.typ"),
            "= Vendored",
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join(".oleafly/build")).unwrap();
        std::fs::write(
            dir.path().join(".oleafly/build/x.tex"),
            "\\section{Generated}",
        )
        .unwrap();
        std::fs::write(dir.path().join("main.typ"), "= Mine").unwrap();
        let scan = scan_project(dir.path(), "main.typ", &ContextLimits::default()).unwrap();
        assert_eq!(scan.map.files, ["main.typ"]);
    }

    #[test]
    fn non_ascii_paths_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("kapitoly")).unwrap();
        std::fs::write(dir.path().join("kapitoly/úvod.tex"), "\\section{Úvod}").unwrap();
        std::fs::write(dir.path().join("main.tex"), "\\input{kapitoly/úvod}").unwrap();
        let scan = scan_project(dir.path(), "main.tex", &ContextLimits::default()).unwrap();
        assert!(scan.map.files.contains(&"kapitoly/úvod.tex".to_string()));
        assert_eq!(
            scan.map.input_graph[0].to.as_deref(),
            Some("kapitoly/úvod.tex")
        );
        assert_eq!(scan.map.sections[0].title, "Úvod");
    }
}
