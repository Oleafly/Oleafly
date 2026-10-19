//! A label, reference and bibliography-key index of the project.
//!
//! The app builds these facts with its project-intelligence analyzer
//! (`src/lib/project-intelligence/analyze-file.ts`) and turns them into the
//! legacy symbol index the preflight store reads. This module ports the parts
//! preflight uses: label definitions, bibliography keys and reference uses,
//! with the same scoping and the same definition order (files in collation
//! order, then by the position of each name).

mod bibtex;
mod latex;
mod markdown;
mod typst;

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::bib::is_hayagriva_path;
use crate::collate::locale_compare;
use crate::text::SourceText;

pub use self::bibtex::bibtex_keys;
pub use self::typst::mask_typst_source;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum IndexEngine {
    Latex,
    Typst,
    Markdown,
    Bibtex,
}

impl IndexEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Typst => "typst",
            Self::Markdown => "markdown",
            Self::Bibtex => "bibtex",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SymKind {
    Label,
    Bibentry,
    Ref,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sym {
    pub kind: SymKind,
    pub name: String,
    pub file: String,
    pub line: u32,
    pub from: usize,
    pub to: usize,
    /// A `file#anchor` link's target (`paper.tex#sec:intro`).
    pub target: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectIndex {
    pub defs: Vec<Sym>,
    pub uses: Vec<Sym>,
}

/// `engineForPath`: the engine that owns a source file.
pub fn engine_for_path(path: &str) -> Option<IndexEngine> {
    let lower = path.to_lowercase();
    if lower.ends_with(".bib") {
        return Some(IndexEngine::Bibtex);
    }
    if lower.ends_with(".typ") {
        return Some(IndexEngine::Typst);
    }
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        return Some(IndexEngine::Markdown);
    }
    let latex = [".tex", ".ltx", ".latex", ".sty", ".cls"];
    latex
        .iter()
        .any(|ext| lower.ends_with(ext))
        .then_some(IndexEngine::Latex)
}

/// `analysisEngineForPath`: Hayagriva YAML is analysed as a bibliography.
pub fn analysis_engine_for_path(path: &str) -> Option<IndexEngine> {
    engine_for_path(path).or_else(|| is_hayagriva_path(path).then_some(IndexEngine::Bibtex))
}

/// The pool a label lives in: one per engine, and one per file for Markdown.
pub fn label_scope(file: &str) -> String {
    match engine_for_path(file) {
        Some(IndexEngine::Markdown) => format!("markdown:{file}"),
        Some(engine) => engine.as_str().to_string(),
        None => "unknown".to_string(),
    }
}

fn reference_target_file(target: Option<&str>) -> Option<&str> {
    let target = target?;
    let hash = target.find('#')?;
    Some(&target[..hash])
}

/// `nameTarget("label", sym)`: the scope a symbol's name is looked up in and
/// the one file it must be in (`None` for any file in the scope).
pub fn name_target_label(sym: &Sym) -> (String, Option<String>) {
    if sym.kind != SymKind::Ref {
        return (label_scope(&sym.file), Some(sym.file.clone()));
    }
    if let Some(file) = reference_target_file(sym.target.as_deref()) {
        return (label_scope(file), Some(file.to_string()));
    }
    (label_scope(&sym.file), None)
}

/// A definition found in one file, with the offset the index sorts by.
pub(crate) struct Definition {
    pub kind: SymKind,
    pub name: String,
    pub from: usize,
    pub to: usize,
}

pub(crate) struct Reference {
    pub name: String,
    pub from: usize,
    pub to: usize,
    pub target: Option<String>,
}

#[derive(Default)]
pub(crate) struct FileSymbols {
    pub defs: Vec<Definition>,
    pub uses: Vec<Reference>,
}

fn analyze_file(file: &str, text: &str) -> FileSymbols {
    match analysis_engine_for_path(file) {
        Some(IndexEngine::Latex) => latex::analyze(text),
        Some(IndexEngine::Typst) => typst::analyze(text),
        Some(IndexEngine::Markdown) => markdown::analyze(file, text),
        Some(IndexEngine::Bibtex) if is_hayagriva_path(file) => bibtex::analyze_hayagriva(text),
        Some(IndexEngine::Bibtex) => bibtex::analyze_bibtex(text),
        None => FileSymbols::default(),
    }
}

/// Builds the index from the project's indexable texts (path → LF text).
pub fn build_index(texts: &BTreeMap<String, String>) -> ProjectIndex {
    let mut files: Vec<(&String, &String)> = texts.iter().collect();
    files.sort_by(|left, right| locale_compare(left.0, right.0).then_with(|| left.0.cmp(right.0)));
    let mut index = ProjectIndex::default();
    for (file, text) in files {
        let symbols = analyze_file(file, text);
        let source = SourceText::new(text.clone());
        let mut defs = symbols.defs;
        defs.sort_by(|left, right| {
            left.from
                .cmp(&right.from)
                .then_with(|| left.kind.cmp(&right.kind))
                .then_with(|| left.name.cmp(&right.name))
                .then(Ordering::Equal)
        });
        index.defs.extend(defs.into_iter().map(|def| Sym {
            kind: def.kind,
            name: def.name,
            file: file.clone(),
            line: source.position(def.from).line,
            from: def.from,
            to: def.to,
            target: None,
        }));
        index
            .uses
            .extend(symbols.uses.into_iter().map(|reference| Sym {
                kind: SymKind::Ref,
                name: reference.name,
                file: file.clone(),
                line: source.position(reference.from).line,
                from: reference.from,
                to: reference.to,
                target: reference.target,
            }));
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(path, text)| (path.to_string(), text.to_string()))
            .collect()
    }

    #[test]
    fn latex_labels_skip_verbatim_and_comments() {
        let index = build_index(&texts(&[(
            "main.tex",
            "\\label{a}\n% \\label{b}\n\\begin{verbatim}\\label{c}\\end{verbatim}\n\\label{ d }",
        )]));
        let names: Vec<_> = index.defs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["a", "d"]);
    }

    #[test]
    fn references_and_bib_keys_are_indexed() {
        let index = build_index(&texts(&[
            ("main.tex", "\\cref{fig:a,tab:b}\n\\bibitem{item}"),
            (
                "refs.bib",
                "@article{Smith2020,\n title={x}}\n@comment{skip,}\n@book(jones, title={y})",
            ),
        ]));
        let refs: Vec<_> = index.uses.iter().map(|u| u.name.as_str()).collect();
        assert_eq!(refs, vec!["fig:a", "tab:b"]);
        let bib: Vec<_> = index
            .defs
            .iter()
            .filter(|d| d.kind == SymKind::Bibentry)
            .map(|d| d.name.as_str())
            .collect();
        assert_eq!(bib, vec!["item", "Smith2020", "jones"]);
    }

    #[test]
    fn typst_labels_and_at_references() {
        let index = build_index(&texts(&[(
            "main.typ",
            "#figure[x] <fig:plot>\nSee @fig:plot and #ref(<tab:t>).\n#cite(<smith>)",
        )]));
        let labels: Vec<_> = index.defs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(labels, vec!["fig:plot"]);
        let refs: Vec<_> = index.uses.iter().map(|u| u.name.as_str()).collect();
        assert!(refs.contains(&"fig:plot") && refs.contains(&"tab:t"));
    }

    #[test]
    fn scopes_follow_the_engine_and_markdown_files() {
        assert_eq!(label_scope("a/main.tex"), "latex");
        assert_eq!(label_scope("notes.md"), "markdown:notes.md");
        assert_eq!(label_scope("data.csv"), "unknown");
    }
}
