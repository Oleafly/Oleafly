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

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use self::text::{dirname, has_extension, normalize_project_path, resolve_project_path_from};

/// How much of a project a scan reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextLimits {
    /// Source files read (the rest are skipped and named).
    pub max_files: usize,
    pub max_file_bytes: u64,
    /// A `.bib` file may be larger: reference-manager exports run to tens of
    /// megabytes.
    pub max_bib_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for ContextLimits {
    fn default() -> Self {
        Self {
            max_files: 5_000,
            max_file_bytes: 4 * 1024 * 1024,
            max_bib_bytes: 32 * 1024 * 1024,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
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
    /// `\graphicspath` and `\svgpath` folders, as written.
    pub search_paths: Vec<String>,
    /// `\nocite{*}` or a Typst `#bibliography(..., full: true)`: every
    /// entry of the bibliography is cited.
    pub cites_all: bool,
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

/// A path as the case- and composition-blind lookup keys it: NFC, then
/// lowercase (`assemble.ts`), so an NFD file name on disk matches an NFC
/// `\input`.
fn fold(path: &str) -> String {
    path.nfc().collect::<String>().to_lowercase()
}

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
            folded.entry(fold(file)).or_default().push(file.clone());
        }
        Known { exact, folded }
    }

    /// The files `path` names: itself, and files whose names differ from it
    /// only in case or Unicode composition.
    fn matching(&self, path: &str) -> BTreeSet<String> {
        let mut found: BTreeSet<String> = BTreeSet::new();
        if self.exact.contains(path) {
            found.insert(path.to_string());
        }
        for file in self.folded.get(&fold(path)).into_iter().flatten() {
            found.insert(file.clone());
        }
        found
    }

    /// `candidatesForPath`: the file itself (case-insensitively too), and
    /// with each extension when it has none.
    fn candidates(&self, normalized: &str, extensions: &[&str]) -> Vec<String> {
        let mut found = self.matching(normalized);
        if !has_extension(normalized) {
            for extension in extensions {
                found.extend(self.matching(&format!("{normalized}{extension}")));
            }
        }
        found.into_iter().collect()
    }

    /// What TeX opens for `\input{name}`: `name.tex` first, then `name`
    /// itself, then the other source extensions when the name has none. So
    /// `chapter.v2` finds `chapter.v2.tex`, and `intro` finds `intro.tex`
    /// even when an `intro.md` sits beside it.
    fn latex_input_candidates(&self, normalized: &str) -> Vec<String> {
        let tex = self.matching(&format!("{normalized}.tex"));
        if !tex.is_empty() {
            return tex.into_iter().collect();
        }
        let own = self.matching(normalized);
        if !own.is_empty() || has_extension(normalized) {
            return own.into_iter().collect();
        }
        let mut found: BTreeSet<String> = BTreeSet::new();
        for extension in INCLUDE_EXTENSIONS
            .iter()
            .filter(|extension| **extension != ".tex")
        {
            found.extend(self.matching(&format!("{normalized}{extension}")));
        }
        found.into_iter().collect()
    }

    /// The input candidates of `normalized`, by the rules of the file that
    /// names it.
    fn input_candidates(&self, referring_file: &str, normalized: &str) -> Vec<String> {
        if engine_for(referring_file) == Some(Engine::Latex) {
            self.latex_input_candidates(normalized)
        } else {
            self.candidates(normalized, &INCLUDE_EXTENSIONS)
        }
    }

    /// What `find` gives for `raw` from the first of `directories` where it
    /// gives anything.
    fn in_directories(
        &self,
        directories: &[String],
        raw: &str,
        find: impl Fn(&str) -> Vec<String>,
    ) -> Vec<String> {
        for directory in directories {
            let Some(target) = resolve_project_path_from(directory, raw, None) else {
                continue;
            };
            let found = find(&target);
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
        let found = known.input_candidates(&use_.file, &target);
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
    // The include and import uses of each file, in order, so a file's uses
    // are found without scanning every use in the project.
    let mut inputs_by_file: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, use_) in uses.iter().enumerate() {
        if matches!(use_.kind, UseKind::Include | UseKind::Import) {
            inputs_by_file
                .entry(use_.file.clone())
                .or_default()
                .push(index);
        }
    }
    let mut reachable: BTreeSet<String> = BTreeSet::new();
    let mut pending = vec![main_document.to_string()];
    while let Some(file) = pending.pop() {
        if !reachable.insert(file.clone()) {
            continue;
        }
        for &index in inputs_by_file.get(&file).map_or(&[][..], Vec::as_slice) {
            let use_ = &uses[index];
            // `\input` and `\import` both open files from the folder TeX runs
            // in, the main document's, before the referring file's.
            if engine_for(&use_.file) == Some(Engine::Latex) && original[index].is_some() {
                let directories =
                    unique_directories([main_directory.as_str(), "", dirname(&use_.file)]);
                let found = known.in_directories(&directories, &use_.name, |target| {
                    known.latex_input_candidates(target)
                });
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

fn role_of(path: &str, main_document: &str, bibliography_yaml: &BTreeSet<String>) -> FileRole {
    if path == main_document {
        return FileRole::Main;
    }
    match lower_extension(path).as_str() {
        "tex" | "ltx" | "latex" | "typ" | "md" | "markdown" => FileRole::Source,
        "sty" | "cls" | "bst" | "bbx" | "cbx" | "csl" => FileRole::Style,
        "bib" => FileRole::Bibliography,
        "yml" | "yaml" if bibliography_yaml.contains(path) => FileRole::Bibliography,
        "png" | "jpg" | "jpeg" | "pdf" | "eps" | "svg" | "webp" | "gif" | "tif" | "tiff" => {
            FileRole::Figure
        }
        "csv" | "tsv" | "json" | "dat" | "txt" | "yml" | "yaml" | "xml" => FileRole::Data,
        _ => FileRole::Other,
    }
}

/// A step of a file in document order: one of its sections (an index into
/// the definitions) or an input it opens.
#[derive(Clone, Copy)]
enum OutlineStep<'a> {
    Section(usize),
    Input(&'a str),
}

/// The sections in document order: a depth-first walk of the resolved
/// inputs from the main document, each file's sections and inputs in the
/// order they appear in it. Sections of files the walk never reaches follow,
/// by path.
fn sections_in_document_order<'a>(
    defs: &'a [Def],
    uses: &'a [Use],
    resolved: &[bool],
    main_document: &'a str,
) -> Vec<SectionEntry> {
    let mut steps: HashMap<&'a str, Vec<(usize, OutlineStep<'a>)>> = HashMap::new();
    for (index, def) in defs.iter().enumerate() {
        if def.kind == DefKind::Section {
            steps
                .entry(def.file.as_str())
                .or_default()
                .push((def.from, OutlineStep::Section(index)));
        }
    }
    for (index, use_) in uses.iter().enumerate() {
        // A Typst `#import` brings in definitions, not text.
        let opens_text = use_.kind == UseKind::Include
            || (use_.kind == UseKind::Import && engine_for(&use_.file) == Some(Engine::Latex));
        if let (true, true, Some(target)) = (opens_text, resolved[index], use_.target.as_deref()) {
            steps
                .entry(use_.file.as_str())
                .or_default()
                .push((use_.from, OutlineStep::Input(target)));
        }
    }
    for file_steps in steps.values_mut() {
        file_steps.sort_by_key(|(from, _)| *from);
    }
    let mut emitted = vec![false; defs.len()];
    let mut order: Vec<usize> = Vec::new();
    let mut visited: HashSet<&'a str> = HashSet::new();
    let mut stack: Vec<(&'a str, usize)> = Vec::new();
    if !main_document.is_empty() {
        visited.insert(main_document);
        stack.push((main_document, 0));
    }
    while let Some(&(file, at)) = stack.last() {
        let Some(&(_, step)) = steps.get(file).and_then(|file_steps| file_steps.get(at)) else {
            stack.pop();
            continue;
        };
        if let Some(top) = stack.last_mut() {
            top.1 += 1;
        }
        match step {
            OutlineStep::Section(index) => {
                if !emitted[index] {
                    emitted[index] = true;
                    order.push(index);
                }
            }
            OutlineStep::Input(target) => {
                if visited.insert(target) {
                    stack.push((target, 0));
                }
            }
        }
    }
    for (index, def) in defs.iter().enumerate() {
        if def.kind == DefKind::Section && !emitted[index] {
            order.push(index);
        }
    }
    order
        .into_iter()
        .map(|index| {
            let def = &defs[index];
            SectionEntry {
                title: def.name.clone(),
                level: def.level.unwrap_or(0),
                file: def.file.clone(),
                line: def.line,
            }
        })
        .collect()
}

/// Adds the facts of one file to the project's.
fn add_facts(
    facts: FileFacts,
    defs: &mut Vec<Def>,
    uses: &mut Vec<Use>,
    packages: &mut Vec<PackageUse>,
    search_paths: &mut Vec<String>,
    cites_all: &mut bool,
) {
    defs.extend(facts.defs);
    uses.extend(facts.uses);
    packages.extend(facts.packages);
    for search_path in facts.search_paths {
        if !search_paths.contains(&search_path) {
            search_paths.push(search_path);
        }
    }
    *cites_all |= facts.cites_all;
}

/// The scan of a set of sources. `sources` maps project paths to their
/// text (line endings `\n`); `all_files` lists every file in the project.
pub fn scan_sources(
    sources: &BTreeMap<String, String>,
    all_files: &[String],
    main_document: &str,
) -> ContextScan {
    // `./main.tex` in a hand-edited project.json is `main.tex`.
    let main_document = normalize_project_path(main_document).unwrap_or_default();
    let main_document = main_document.as_str();
    let mut defs: Vec<Def> = Vec::new();
    let mut uses: Vec<Use> = Vec::new();
    let mut packages: Vec<PackageUse> = Vec::new();
    let mut search_paths: Vec<String> = Vec::new();
    let mut cites_all = false;
    let mut yaml: Vec<(&String, &String)> = Vec::new();
    for (path, text) in sources {
        if engine_for(path).is_none() && is_hayagriva(path) {
            yaml.push((path, text));
            continue;
        }
        let facts = analyze_file(path, text);
        add_facts(
            facts,
            &mut defs,
            &mut uses,
            &mut packages,
            &mut search_paths,
            &mut cites_all,
        );
    }
    // A YAML file is a bibliography when it looks like Hayagriva or a Typst
    // `#bibliography` names it, as in the app: a conda `environment.yml` is
    // not one.
    let named_yaml: BTreeSet<String> = uses
        .iter()
        .filter(|use_| {
            use_.kind == UseKind::Bibliography && engine_for(&use_.file) == Some(Engine::Typst)
        })
        .filter_map(|use_| use_.target.clone())
        .collect();
    let mut bibliography_yaml: BTreeSet<String> = BTreeSet::new();
    let mut hayagriva_facts: Vec<FileFacts> = Vec::new();
    for (path, text) in yaml {
        if bib::accepts_bibliography_yaml(text, named_yaml.contains(path)) {
            bibliography_yaml.insert(path.clone());
            hayagriva_facts.push(bib::analyze_hayagriva(path, text));
        }
    }
    for facts in hayagriva_facts {
        add_facts(
            facts,
            &mut defs,
            &mut uses,
            &mut packages,
            &mut search_paths,
            &mut cites_all,
        );
    }
    defs.sort_by(|left, right| left.file.cmp(&right.file).then(left.from.cmp(&right.from)));
    uses.sort_by(|left, right| left.file.cmp(&right.file).then(left.from.cmp(&right.from)));
    let read: Vec<String> = sources
        .keys()
        .filter(|path| {
            !(engine_for(path).is_none() && is_hayagriva(path)) || bibliography_yaml.contains(*path)
        })
        .cloned()
        .collect();

    let known = Known::new(&read);
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
    // What the two lists already hold, so a name is added once without
    // scanning them (thousands of distinct unresolved names are possible).
    let mut unresolved_ref_names: HashSet<&str> = HashSet::new();
    let mut unresolved_cite_names: HashSet<&str> = HashSet::new();
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
                } else if unresolved_ref_names.insert(use_.name.as_str()) {
                    unresolved_refs.push(use_.name.clone());
                }
            }
            UseKind::Cite => {
                cited.insert(use_.name.clone());
                if !bib_keys.contains(use_.name.as_str())
                    && unresolved_cite_names.insert(use_.name.as_str())
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
    let mut files = read.clone();
    files.sort();
    let map = ProjectMap {
        files,
        sections: sections_in_document_order(&defs, &uses, &resolved, main_document),
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

    let unused_cites: Vec<String> = if cites_all {
        Vec::new()
    } else {
        bib_keys
            .iter()
            .filter(|key| !cited.contains(**key))
            .map(ToString::to_string)
            .collect()
    };
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

    let missing_files = missing_files(&uses, &resolved, all_files, main_document, &search_paths);
    packages.sort_by(|left, right| left.file.cmp(&right.file).then(left.line.cmp(&right.line)));

    ContextScan {
        map,
        roles: all_files
            .iter()
            .map(|file| {
                (
                    file.clone(),
                    role_of(file, main_document, &bibliography_yaml),
                )
            })
            .collect(),
        unused_cites,
        unused_labels,
        missing_files,
        packages,
        truncated: false,
        skipped: Vec::new(),
    }
}

/// The inputs, figures and bibliographies no project file answers.
/// `search_paths` are the `\graphicspath` and `\svgpath` folders.
fn missing_files(
    uses: &[Use],
    resolved: &[bool],
    all_files: &[String],
    main_document: &str,
    search_paths: &[String],
) -> Vec<MissingFile> {
    let all_known = Known::new(all_files);
    let main_directory = dirname(main_document).to_string();
    let mut missing: Vec<MissingFile> = Vec::new();
    for (index, use_) in uses.iter().enumerate() {
        let directories = unique_directories([main_directory.as_str(), "", dirname(&use_.file)]);
        let (kind, found) = match use_.kind {
            // Resolved against the sources, or any project file: a
            // matplotlib `.pgf`, an Inkscape `.pdf_tex`, or a source the
            // scan left unread.
            UseKind::Include | UseKind::Import => (
                "input",
                resolved[index]
                    || use_.target.as_deref().is_none_or(|target| {
                        !all_known.input_candidates(&use_.file, target).is_empty()
                            || !all_known
                                .in_directories(&directories, &use_.name, |candidate| {
                                    all_known.input_candidates(&use_.file, candidate)
                                })
                                .is_empty()
                    }),
            ),
            UseKind::Asset => {
                let mut folders = directories.clone();
                for base in &directories {
                    for search_path in search_paths {
                        if let Some(folder) = resolve_project_path_from(base, search_path, None) {
                            if !folders.contains(&folder) {
                                folders.push(folder);
                            }
                        }
                    }
                }
                (
                    "figure",
                    use_.target.is_none()
                        || !all_known
                            .in_directories(&folders, &use_.name, |target| {
                                all_known.candidates(target, &FIGURE_EXTENSIONS)
                            })
                            .is_empty(),
                )
            }
            UseKind::Bibliography => {
                // `\bibliography{refs.v2}` is `refs.v2.bib` to BibTeX, and
                // `refs.bib` names itself: both spellings are tried.
                let mut spellings = vec![use_.name.clone()];
                if engine_for(&use_.file) == Some(Engine::Latex) {
                    spellings.push(format!("{}.bib", use_.name));
                }
                (
                    "bibliography",
                    use_.target.is_none()
                        || spellings.iter().any(|spelling| {
                            !all_known
                                .in_directories(&directories, spelling, |target| {
                                    all_known.candidates(target, &[])
                                })
                                .is_empty()
                        }),
                )
            }
            UseKind::Ref | UseKind::Cite => continue,
        };
        if !found {
            missing.push(MissingFile {
                file: use_.file.clone(),
                line: use_.line,
                target: use_.name.clone(),
                kind,
            });
        }
    }
    missing
}

/// Text as the app's analyzer sees it: lossy UTF-8, a leading byte-order
/// mark dropped, `\r\n` and `\r` as `\n`.
pub fn normalize_source(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{feff}')
        .unwrap_or(&text)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

const MAX_LISTED_FILES: usize = 50_000;
/// The most skipped files and folders a scan names.
const MAX_SKIPPED_LISTED: usize = 50;

fn note_skipped(skipped: &mut Vec<String>, path: String) {
    if skipped.len() < MAX_SKIPPED_LISTED {
        skipped.push(path);
    }
}

/// Scans the project at `root` (bounded by `limits`).
pub fn scan_project(
    root: &Path,
    main_document: &str,
    limits: &ContextLimits,
) -> crate::Result<ContextScan> {
    let mut all_files: Vec<String> = Vec::new();
    let mut candidates: Vec<(String, std::path::PathBuf)> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    crate::tree::walk_source_tree_noting(
        root,
        "project context scan",
        &mut |relative, absolute| {
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
        },
        &mut |folder| unreadable.push(format!("{}/", crate::slash_path(folder))),
    )?;
    unreadable.sort();
    for folder in unreadable {
        note_skipped(&mut skipped, folder);
    }
    all_files.sort();
    candidates.sort();
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    let mut total: u64 = 0;
    let mut truncated = false;
    for (path, absolute) in candidates {
        if sources.len() >= limits.max_files || total >= limits.max_total_bytes {
            truncated = true;
            note_skipped(&mut skipped, path);
            continue;
        }
        // An evicted iCloud or OneDrive file, or one that can't be opened,
        // is named rather than silently left out.
        let Ok(metadata) = std::fs::metadata(&absolute) else {
            note_skipped(&mut skipped, path);
            continue;
        };
        if crate::is_cloud_placeholder(&metadata) {
            note_skipped(&mut skipped, path);
            continue;
        }
        let file_limit = if lower_extension(&path) == "bib" {
            limits.max_bib_bytes
        } else {
            limits.max_file_bytes
        };
        let budget = file_limit.min(limits.max_total_bytes - total);
        // Half a file is worse than none: a cut `.bib` loses every key past
        // the cut and makes their citations look unresolved.
        if metadata.len() > budget {
            truncated = true;
            note_skipped(&mut skipped, path);
            continue;
        }
        use std::io::Read;
        let Ok(file) = std::fs::File::open(&absolute) else {
            note_skipped(&mut skipped, path);
            continue;
        };
        let mut bytes = Vec::new();
        if file.take(budget + 1).read_to_end(&mut bytes).is_err() {
            note_skipped(&mut skipped, path);
            continue;
        }
        if bytes.len() as u64 > budget {
            // It grew after it was measured.
            truncated = true;
            note_skipped(&mut skipped, path);
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

/// The most items a view for a model keeps from any one list.
pub const VIEW_LIST_CAP: usize = 200;
/// The most bytes a view for a model takes as JSON: below the 64 KiB an
/// agent's tool result may take, with room for what wraps it.
pub const VIEW_MAX_BYTES: usize = 56 * 1024;

/// Lists a model needs most, cut last: what doesn't resolve.
const PRIORITY_LISTS: [&str; 6] = [
    "unresolvedRefs",
    "unresolvedCites",
    "missingFiles",
    "unresolved_refs",
    "unresolved_cites",
    "missing_files",
];

/// The caps tried in turn, (other lists, priority lists), until the view
/// fits.
const VIEW_STEPS: [(usize, usize); 8] = [
    (VIEW_LIST_CAP, VIEW_LIST_CAP),
    (100, VIEW_LIST_CAP),
    (50, VIEW_LIST_CAP),
    (20, VIEW_LIST_CAP),
    (20, 100),
    (10, 50),
    (5, 20),
    (0, 0),
];

fn list_lengths(value: &Value, path: &str, lengths: &mut BTreeMap<String, usize>) {
    match value {
        Value::Array(items) => {
            lengths.insert(path.to_string(), items.len());
        }
        Value::Object(fields) => {
            for (key, field) in fields {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                list_lengths(field, &child, lengths);
            }
        }
        _ => {}
    }
}

fn cut_lists(value: &mut Value, path: &str, (other, priority): (usize, usize)) {
    match value {
        Value::Array(items) => {
            let leaf = path.rsplit('.').next().unwrap_or(path);
            items.truncate(if PRIORITY_LISTS.contains(&leaf) {
                priority
            } else {
                other
            });
        }
        Value::Object(fields) => {
            for (key, field) in fields.iter_mut() {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                cut_lists(field, &child, (other, priority));
            }
        }
        _ => {}
    }
}

/// `value` cut to fit a model's tool result. Every list in it, and in the
/// objects it holds, keeps at most [`VIEW_LIST_CAP`] items, and fewer when the
/// whole still passes `max_bytes` as JSON; unresolved references and
/// citations and missing files are cut last. `counts_key` then names how
/// many items each cut list lost, by its dotted path (`map.bibKeys`).
pub fn bounded_view(value: Value, max_bytes: usize, counts_key: &str) -> Value {
    let mut lengths: BTreeMap<String, usize> = BTreeMap::new();
    list_lengths(&value, "", &mut lengths);
    let mut base = value;
    cut_lists(&mut base, "", VIEW_STEPS[0]);
    let mut view = Value::Null;
    for caps in VIEW_STEPS {
        view = base.clone();
        cut_lists(&mut view, "", caps);
        let mut kept: BTreeMap<String, usize> = BTreeMap::new();
        list_lengths(&view, "", &mut kept);
        let lost: serde_json::Map<String, Value> = lengths
            .iter()
            .filter_map(|(path, length)| {
                let left = kept.get(path).copied().unwrap_or(0);
                (*length > left).then(|| (path.clone(), Value::from(length - left)))
            })
            .collect();
        if let (Value::Object(fields), false) = (&mut view, lost.is_empty()) {
            fields.insert(counts_key.to_string(), Value::Object(lost));
        }
        if serde_json::to_vec(&view).map_or(0, |bytes| bytes.len()) <= max_bytes {
            break;
        }
    }
    view
}

/// How many files have each role, for a view that can't list every file.
pub fn role_counts(roles: &BTreeMap<String, FileRole>) -> BTreeMap<FileRole, usize> {
    let mut counts: BTreeMap<FileRole, usize> = BTreeMap::new();
    for role in roles.values() {
        *counts.entry(*role).or_default() += 1;
    }
    counts
}

/// The project map as a model gets it: within [`VIEW_MAX_BYTES`], with
/// `truncatedCounts` naming what was cut.
pub fn map_view(map: &ProjectMap) -> Value {
    match serde_json::to_value(map) {
        Ok(value) => bounded_view(value, VIEW_MAX_BYTES, "truncatedCounts"),
        Err(_) => Value::Null,
    }
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
    fn unresolved_names_are_listed_once_in_the_order_they_first_appear() {
        let files = sources(&[(
            "main.tex",
            "\\ref{b} \\ref{a} \\ref{b}\n\\cite{z} \\cite{y} \\cite{z}\n",
        )]);
        let all: Vec<String> = files.keys().cloned().collect();
        let scan = scan_sources(&files, &all, "main.tex");
        assert_eq!(scan.map.unresolved_refs, ["b", "a"]);
        assert_eq!(scan.map.unresolved_cites, ["z", "y"]);
    }

    #[test]
    fn includes_are_followed_through_every_file_that_is_reached() {
        // main -> a -> b, with c never included: only what is reachable
        // resolves from the main document's folder.
        let files = sources(&[
            ("main.tex", "\\input{a}\n\\input{missing}\n"),
            ("a.tex", "\\input{b}\n"),
            ("b.tex", "text\n"),
            ("c.tex", "\\input{b}\n"),
        ]);
        let all: Vec<String> = files.keys().cloned().collect();
        let scan = scan_sources(&files, &all, "main.tex");
        let edges: Vec<(&str, Option<&str>)> = scan
            .map
            .input_graph
            .iter()
            .map(|edge| (edge.from.as_str(), edge.to.as_deref()))
            .collect();
        assert!(edges.contains(&("main.tex", Some("a.tex"))));
        assert!(edges.contains(&("a.tex", Some("b.tex"))));
        assert!(edges.contains(&("c.tex", Some("b.tex"))));
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
        // Document order: main's section, then the chapter it inputs.
        assert_eq!(titles, ["Intro", "Background"]);
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

    fn scan(files: &[(&str, &str)], others: &[&str], main: &str) -> ContextScan {
        let files = sources(files);
        let mut all: Vec<String> = files.keys().cloned().collect();
        all.extend(others.iter().map(ToString::to_string));
        all.sort();
        scan_sources(&files, &all, main)
    }

    fn missing(scan: &ContextScan) -> Vec<(&'static str, &str)> {
        scan.missing_files
            .iter()
            .map(|missing| (missing.kind, missing.target.as_str()))
            .collect()
    }

    #[test]
    fn an_input_that_exists_but_is_not_a_source_is_not_missing() {
        let scan = scan(
            &[(
                "main.tex",
                "\\input{figures/plot.pgf}\\input{drawing.pdf_tex}\\input{gone.pgf}\n",
            )],
            &["figures/plot.pgf", "drawing.pdf_tex"],
            "main.tex",
        );
        assert_eq!(missing(&scan), [("input", "gone.pgf")]);
    }

    #[test]
    fn figures_are_found_through_graphicspath() {
        let scan = scan(
            &[(
                "main.tex",
                "\\graphicspath{{figures/}{img/}}\n\\includegraphics{plot}\\includegraphics{photo.png}\\includegraphics{nowhere}\n",
            )],
            &["figures/plot.pdf", "img/photo.png"],
            "main.tex",
        );
        assert_eq!(missing(&scan), [("figure", "nowhere")]);
    }

    #[test]
    fn bibliography_names_with_dots_or_a_leading_dot_slash_are_found() {
        let scan = scan(
            &[(
                "paper/main.tex",
                "\\bibliography{./refs,refs.v2,../shared,absent}\n",
            )],
            &["paper/refs.bib", "paper/refs.v2.bib", "shared.bib"],
            "paper/main.tex",
        );
        assert_eq!(missing(&scan), [("bibliography", "absent")]);
    }

    #[test]
    fn inputs_prefer_tex_and_imports_fall_back_to_the_main_folder() {
        let scan = scan(
            &[
                (
                    "main.tex",
                    "\\input{chapter.v2}\\input{intro}\\input{chapters/a}\n",
                ),
                ("chapter.v2.tex", "\\section{V2}\n"),
                ("intro.tex", "\\section{Intro}\n"),
                ("intro.md", "# Not this\n"),
                ("chapters/a.tex", "\\import{figures/}{x}\n"),
                ("figures/x.tex", "\\section{X}\n"),
            ],
            &[],
            "main.tex",
        );
        let edges: Vec<(&str, Option<&str>)> = scan
            .map
            .input_graph
            .iter()
            .map(|edge| (edge.from.as_str(), edge.to.as_deref()))
            .collect();
        assert!(
            edges.contains(&("main.tex", Some("chapter.v2.tex"))),
            "{edges:?}"
        );
        assert!(
            edges.contains(&("main.tex", Some("intro.tex"))),
            "{edges:?}"
        );
        assert!(
            edges.contains(&("chapters/a.tex", Some("figures/x.tex"))),
            "{edges:?}"
        );
        assert!(scan.missing_files.is_empty(), "{:?}", scan.missing_files);
    }

    #[test]
    fn the_outline_follows_the_inputs_from_the_main_document() {
        let scan = scan(
            &[
                ("main.tex", "\\section{Start}\n\\input{chapters/intro}\n\\input{chapters/conclusion}\n\\section{Appendix}\n"),
                ("chapters/conclusion.tex", "\\section{Conclusion}\n"),
                ("chapters/intro.tex", "\\section{Intro}\n\\input{chapters/conclusion}\n"),
                ("unused.tex", "\\section{Orphan}\n"),
            ],
            &[],
            "main.tex",
        );
        let titles: Vec<&str> = scan
            .map
            .sections
            .iter()
            .map(|section| section.title.as_str())
            .collect();
        assert_eq!(
            titles,
            ["Start", "Intro", "Conclusion", "Appendix", "Orphan"]
        );
    }

    #[test]
    fn a_dot_slash_main_document_is_the_main_document() {
        let scan = scan(
            &[
                ("paper/main.tex", "\\input{chapters/a}\n"),
                ("paper/chapters/a.tex", "\\input{chapters/b}\n"),
                ("paper/chapters/b.tex", "text\n"),
            ],
            &[],
            "./paper/main.tex",
        );
        assert_eq!(scan.roles["paper/main.tex"], FileRole::Main);
        assert!(scan.missing_files.is_empty(), "{:?}", scan.missing_files);
    }

    #[test]
    fn an_nfd_file_name_matches_an_nfc_input() {
        let nfd = "kapitoly/u\u{301}vod.tex";
        let scan = scan(
            &[
                ("main.tex", "\\input{kapitoly/\u{fa}vod}\n"),
                (nfd, "text\n"),
            ],
            &[],
            "main.tex",
        );
        assert_eq!(scan.map.input_graph[0].to.as_deref(), Some(nfd));
        assert!(scan.missing_files.is_empty());
    }

    #[test]
    fn nocite_star_leaves_no_key_unused() {
        let scan = scan(
            &[
                ("main.tex", "\\nocite{*}\n\\bibliography{refs}\n"),
                ("refs.bib", "@book{a, title={A}}\n@book{b, title={B}}\n"),
            ],
            &[],
            "main.tex",
        );
        assert!(scan.unused_cites.is_empty());
        assert!(scan.map.unresolved_cites.is_empty());
    }

    #[test]
    fn yaml_that_is_not_hayagriva_is_data_not_a_bibliography() {
        let scan = scan(
            &[
                ("main.typ", "@knuth\n#bibliography(\"named.yml\")\n"),
                (
                    "environment.yml",
                    "channels:\n  - conda-forge\ndependencies:\n  - numpy\n",
                ),
                ("named.yml", "knuth:\n  note: x\n"),
                ("refs.yml", "lamport:\n  type: book\n  title: L\n"),
            ],
            &[],
            "main.typ",
        );
        assert_eq!(scan.map.bib_keys, ["knuth", "lamport"]);
        assert_eq!(scan.unused_cites, ["lamport"]);
        assert_eq!(scan.roles["environment.yml"], FileRole::Data);
        assert_eq!(scan.roles["named.yml"], FileRole::Bibliography);
        assert_eq!(scan.roles["refs.yml"], FileRole::Bibliography);
        assert!(!scan.map.files.contains(&"environment.yml".to_string()));
    }

    #[test]
    fn a_byte_order_mark_is_dropped() {
        assert_eq!(normalize_source(b"\xef\xbb\xbf---\r\nx"), "---\nx");
        let scan = scan(
            &[
                ("main.typ", "@knuth\n#bibliography(\"refs.yml\")\n"),
                (
                    "refs.yml",
                    &normalize_source(b"\xef\xbb\xbfknuth:\n  type: book\n"),
                ),
            ],
            &[],
            "main.typ",
        );
        assert_eq!(scan.map.bib_keys, ["knuth"]);
        assert!(scan.map.unresolved_refs.is_empty());
    }

    #[test]
    fn a_source_over_its_limit_is_skipped_whole_and_named() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("main.tex"),
            "\\cite{late}\n\\bibliography{refs}\n",
        )
        .unwrap();
        let mut bib = "@misc{pad, note={".to_string();
        bib.push_str(&"x".repeat(2048));
        bib.push_str("}}\n@misc{late, title={L}}\n");
        std::fs::write(dir.path().join("refs.bib"), &bib).unwrap();
        std::fs::write(dir.path().join("big.tex"), "x".repeat(2048)).unwrap();
        let limits = ContextLimits {
            max_file_bytes: 1024,
            max_bib_bytes: 4096,
            ..ContextLimits::default()
        };
        let scan = scan_project(dir.path(), "main.tex", &limits).unwrap();
        // The bibliography's own limit is higher, so its last key is read.
        assert!(scan.map.unresolved_cites.is_empty());
        assert!(scan.truncated);
        assert_eq!(scan.skipped, ["big.tex"]);
        let tighter = ContextLimits {
            max_bib_bytes: 1024,
            ..limits
        };
        let scan = scan_project(dir.path(), "main.tex", &tighter).unwrap();
        assert_eq!(scan.skipped, ["big.tex", "refs.bib"]);
        assert!(!scan.map.files.contains(&"refs.bib".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folders_and_files_are_named_and_the_scan_goes_on() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.tex"), "\\section{A}\n").unwrap();
        let locked = dir.path().join("data/pg");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("x.tex"), "").unwrap();
        std::fs::write(dir.path().join("secret.tex"), "\\section{S}\n").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::fs::set_permissions(
            dir.path().join("secret.tex"),
            std::fs::Permissions::from_mode(0o000),
        )
        .unwrap();
        let root_reads_anything = std::fs::read_dir(&locked).is_ok();
        let scan = scan_project(dir.path(), "main.tex", &ContextLimits::default());
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if root_reads_anything {
            return;
        }
        let scan = scan.unwrap();
        assert_eq!(scan.map.files, ["main.tex"]);
        assert_eq!(scan.skipped, ["data/pg/", "secret.tex"]);
    }

    #[test]
    fn a_view_for_a_model_fits_and_says_what_it_cut() {
        let mut map = ProjectMap::default();
        for index in 0..5_000 {
            map.bib_keys.push(format!("key{index}"));
            map.sections.push(SectionEntry {
                title: format!("A rather long section title number {index}"),
                level: 2,
                file: "chapters/some-chapter.tex".into(),
                line: index,
            });
        }
        map.unresolved_cites = (0..150).map(|index| format!("ghost{index}")).collect();
        map.labels = vec!["only".into()];
        let view = map_view(&map);
        assert!(serde_json::to_vec(&view).unwrap().len() <= VIEW_MAX_BYTES);
        let cut = &view["truncatedCounts"];
        assert_eq!(
            cut["bibKeys"].as_u64().unwrap() + view["bibKeys"].as_array().unwrap().len() as u64,
            5_000
        );
        assert!(cut["sections"].as_u64().unwrap() > 0);
        // What doesn't resolve is kept whole while other lists shrink.
        assert_eq!(view["unresolvedCites"].as_array().unwrap().len(), 150);
        assert!(cut.get("unresolvedCites").is_none());
        assert_eq!(view["labels"], serde_json::json!(["only"]));
        let small = map_view(&ProjectMap::default());
        assert!(small.get("truncatedCounts").is_none());
    }

    #[test]
    fn roles_are_counted_per_role() {
        let roles: BTreeMap<String, FileRole> = [
            ("main.tex", FileRole::Main),
            ("a.tex", FileRole::Source),
            ("b.tex", FileRole::Source),
            ("f.png", FileRole::Figure),
        ]
        .into_iter()
        .map(|(path, role)| (path.to_string(), role))
        .collect();
        assert_eq!(
            serde_json::to_value(role_counts(&roles)).unwrap(),
            serde_json::json!({"main": 1, "source": 2, "figure": 1})
        );
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
