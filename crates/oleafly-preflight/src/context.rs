//! The references and project contexts preflight runs on, built exactly like
//! `src/lib/preflight-context.ts` (the pure builders the app's preflight
//! store calls).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use crate::bib::{
    bibliography_declarations, bibliography_engine_for_command, legacy_bib_keys, parse_entry,
    resolve_bibliography_path, split_bib_entries, BibliographyEngine, ParsedBib,
};
use crate::index::{engine_for_path, label_scope, name_target_label, ProjectIndex, Sym, SymKind};
use crate::jsre::JsRegex;
use crate::mask::mask_comments;
use crate::refs_rules::{
    BibKeyDefinition, BibKeyDialect, DuplicateDoi, DuplicateLabel, RefsContext, UnreferencedLabel,
    UnresolvedBibliography,
};
use crate::text::js_trim;
use crate::types::{ProjectContext, ProjectFile};

pub struct ContextInput<'a> {
    pub main_doc: &'a str,
    /// Non-folder tree paths in the app's order.
    pub tree_paths: &'a [String],
    /// Texts the project index read.
    pub index_texts: &'a BTreeMap<String, String>,
    /// Editor buffers, which win over `index_texts` (empty in the CLI).
    pub open_texts: &'a BTreeMap<String, String>,
    pub index: Option<&'a ProjectIndex>,
}

/// `{ ...indexTexts, ...openTexts }`: insertion order of the first, new keys
/// of the second appended, values of the second winning.
fn project_texts(input: &ContextInput) -> Vec<(String, String)> {
    let mut texts: Vec<(String, String)> = input
        .index_texts
        .iter()
        .map(|(path, text)| (path.clone(), text.clone()))
        .collect();
    for (path, text) in input.open_texts {
        match texts.iter_mut().find(|(existing, _)| existing == path) {
            Some(entry) => entry.1 = text.clone(),
            None => texts.push((path.clone(), text.clone())),
        }
    }
    texts
}

static TEX_SOURCE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.(?:tex|ltx)$"));
static CITE_COMMAND: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)",
        r"\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}",
    ))
});
static DOI_URL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^https?://(?:dx\.)?doi\.org/"));
static FLOAT_LABEL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^(?:fig|figure|tab|table|eq|equation)[:._-]"));

struct DeclaredBibliography {
    raw: String,
    file: String,
    engine: BibliographyEngine,
}

fn declared_bibliographies(texts: &[(String, String)]) -> Vec<DeclaredBibliography> {
    let mut declarations = Vec::new();
    for (path, content) in texts {
        if !TEX_SOURCE.is_match(path) {
            continue;
        }
        for declaration in bibliography_declarations(&mask_comments(content)) {
            declarations.push(DeclaredBibliography {
                raw: declaration.raw,
                file: path.clone(),
                engine: bibliography_engine_for_command(declaration.command),
            });
        }
    }
    declarations
}

fn unresolved_bibliographies_for(
    declared: &[DeclaredBibliography],
    known_paths: &[String],
) -> Vec<UnresolvedBibliography> {
    let mut unresolved = Vec::new();
    let mut seen = HashSet::new();
    for declaration in declared {
        if resolve_bibliography_path(
            &declaration.raw,
            &declaration.file,
            known_paths,
            declaration.engine,
        )
        .is_some()
        {
            continue;
        }
        if !seen.insert(format!("{}\n{}", declaration.file, declaration.raw)) {
            continue;
        }
        unresolved.push(UnresolvedBibliography {
            file: declaration.file.clone(),
            name: declaration.raw.clone(),
        });
    }
    unresolved
}

/// The .bib files the document loads, so conflict copies, backups and
/// template samples next to them don't count. Nothing declared keeps every
/// .bib file.
fn declared_bib_texts(
    texts: &[(String, String)],
    declared: &[DeclaredBibliography],
    known_paths: &[String],
) -> Vec<(String, String)> {
    let loaded: HashSet<String> = declared
        .iter()
        .filter_map(|declaration| {
            resolve_bibliography_path(
                &declaration.raw,
                &declaration.file,
                known_paths,
                declaration.engine,
            )
        })
        .collect();
    if loaded.is_empty() {
        return texts.to_vec();
    }
    texts
        .iter()
        .filter(|(path, _)| !path.ends_with(".bib") || loaded.contains(path))
        .cloned()
        .collect()
}

fn collect_bib_entries(texts: &[(String, String)]) -> (Vec<ParsedBib>, Vec<DuplicateDoi>) {
    let mut doi_order: Vec<String> = Vec::new();
    let mut doi_to_keys: HashMap<String, Vec<String>> = HashMap::new();
    let mut entries = Vec::new();
    for (path, content) in texts {
        if !path.ends_with(".bib") {
            continue;
        }
        for chunk in split_bib_entries(content) {
            let Some(parsed) = parse_entry(js_trim(chunk)) else {
                continue;
            };
            if let Some(doi) = parsed.fields.get("doi") {
                let lowered = js_trim(doi).to_lowercase();
                let doi = match DOI_URL.first_str(&lowered) {
                    Some(found) => lowered[found.end..].to_string(),
                    None => lowered,
                };
                if !doi.is_empty() {
                    doi_to_keys
                        .entry(doi.clone())
                        .or_insert_with(|| {
                            doi_order.push(doi.clone());
                            Vec::new()
                        })
                        .push(parsed.key.clone());
                }
            }
            entries.push(parsed);
        }
    }
    let duplicates = doi_order
        .into_iter()
        .filter_map(|doi| {
            let keys = doi_to_keys.remove(&doi)?;
            (keys.len() > 1).then_some(DuplicateDoi { doi, keys })
        })
        .collect();
    (entries, duplicates)
}

fn collect_bib_key_definitions(texts: &[(String, String)]) -> Vec<BibKeyDefinition> {
    texts
        .iter()
        .filter(|(path, _)| path.ends_with(".bib"))
        .flat_map(|(path, content)| {
            legacy_bib_keys(content)
                .into_iter()
                .map(move |key| BibKeyDefinition {
                    key: key.key,
                    file: path.clone(),
                    line: key.line,
                    from: key.from,
                    to: key.to,
                })
        })
        .collect()
}

fn collect_cited_keys(texts: &[(String, String)]) -> Vec<String> {
    let mut cited = Vec::new();
    for (path, content) in texts {
        if !TEX_SOURCE.is_match(path) {
            continue;
        }
        let masked = mask_comments(content);
        for found in CITE_COMMAND.captures_str(&masked).0 {
            cited.extend(
                found
                    .group(&masked, 1)
                    .unwrap_or("")
                    .split(',')
                    .map(js_trim)
                    .filter(|key| !key.is_empty())
                    .map(str::to_string),
            );
        }
    }
    cited
}

fn reference_key(scope: &str, file: Option<&str>, name: &str) -> String {
    let target = match file {
        None => "*".to_string(),
        Some(file) => format!("={file}"),
    };
    format!("{scope}\0{target}\0{name}")
}

fn collect_label_facts(
    index: Option<&ProjectIndex>,
) -> (Vec<DuplicateLabel>, Vec<UnreferencedLabel>) {
    let defs: &[Sym] = index.map(|index| index.defs.as_slice()).unwrap_or(&[]);
    let uses: &[Sym] = index.map(|index| index.uses.as_slice()).unwrap_or(&[]);
    // A reference counts for the label it points at, the way rename resolves
    // it: same engine, and for a `file#anchor` link only a label in that file.
    let referenced: HashSet<String> = uses
        .iter()
        .filter(|use_| use_.kind == SymKind::Ref)
        .map(|use_| {
            let (scope, file) = name_target_label(use_);
            reference_key(&scope, file.as_deref(), &use_.name)
        })
        .collect();
    let is_referenced = |definition: &Sym| {
        let (scope, _) = name_target_label(definition);
        referenced.contains(&reference_key(&scope, None, &definition.name))
            || referenced.contains(&reference_key(
                &scope,
                Some(&definition.file),
                &definition.name,
            ))
    };
    let mut order: Vec<String> = Vec::new();
    let mut label_files: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for definition in defs
        .iter()
        .filter(|definition| definition.kind == SymKind::Label)
    {
        let (scope, _) = name_target_label(definition);
        let key = format!("{scope}\0{}", definition.name);
        let entry = label_files.entry(key.clone()).or_insert_with(|| {
            order.push(key);
            (definition.name.clone(), Vec::new())
        });
        if !entry.1.contains(&definition.file) {
            entry.1.push(definition.file.clone());
        }
    }
    let duplicates = order
        .iter()
        .filter_map(|key| label_files.get(key))
        .filter(|(_, files)| files.len() > 1)
        .map(|(label, files)| DuplicateLabel {
            label: label.clone(),
            files: files.clone(),
        })
        .collect();
    let unreferenced = defs
        .iter()
        .filter(|definition| {
            definition.kind == SymKind::Label
                && FLOAT_LABEL.is_match(&definition.name)
                && !is_referenced(definition)
        })
        .map(|definition| UnreferencedLabel {
            label: definition.name.clone(),
            file: definition.file.clone(),
        })
        .collect();
    (duplicates, unreferenced)
}

fn unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

/// `buildRefsContext`: labels and bibliography keys from the index, the
/// bibliography state of the declared files, and the project-wide quality
/// facts the refs rules report.
pub fn build_refs_context(input: &ContextInput) -> RefsContext {
    let main_scope = engine_for_path(input.main_doc).map(|_| label_scope(input.main_doc));
    let defs: &[Sym] = input
        .index
        .map(|index| index.defs.as_slice())
        .unwrap_or(&[]);
    let defined_labels: Vec<String> = defs
        .iter()
        .filter(|definition| {
            definition.kind == SymKind::Label
                && main_scope
                    .as_ref()
                    .is_none_or(|scope| name_target_label(definition).0 == *scope)
        })
        .map(|definition| definition.name.clone())
        .collect();
    let bib_keys: Vec<String> = defs
        .iter()
        .filter(|definition| definition.kind == SymKind::Bibentry)
        .map(|definition| definition.name.clone())
        .collect();
    let texts = project_texts(input);
    let project_files: Vec<String> = input.tree_paths.to_vec();
    let known_paths = unique(
        input
            .tree_paths
            .iter()
            .cloned()
            .chain(input.open_texts.keys().cloned()),
    );
    let declared = declared_bibliographies(&texts);
    let unresolved = unresolved_bibliographies_for(&declared, &known_paths);
    let bib_loaded = if declared.is_empty() {
        !bib_keys.is_empty() || known_paths.iter().any(|path| path.ends_with(".bib"))
    } else {
        unresolved.is_empty()
    };
    let bib_texts = declared_bib_texts(&texts, &declared, &known_paths);
    let (bib_entries, duplicate_dois) = collect_bib_entries(&bib_texts);
    let all_cited_keys = collect_cited_keys(&texts);
    let current_bib_keys = unique(
        bib_keys
            .into_iter()
            .chain(bib_entries.iter().map(|entry| entry.key.clone())),
    );
    let (duplicate_labels, unreferenced_labels) = collect_label_facts(input.index);
    let bib_key_definitions = collect_bib_key_definitions(&bib_texts);
    let dialect = if declared
        .iter()
        .any(|declaration| declaration.engine == BibliographyEngine::Biblatex)
    {
        BibKeyDialect::Biber
    } else {
        BibKeyDialect::Bibtex
    };
    RefsContext {
        defined_labels,
        bib_keys: current_bib_keys,
        bib_loaded,
        project_files,
        unresolved_bibliographies: Some(unresolved),
        duplicate_dois,
        bib_entries: Some(bib_entries),
        all_cited_keys: Some(all_cited_keys),
        duplicate_labels: Some(duplicate_labels),
        unreferenced_labels: Some(unreferenced_labels),
        bib_key_definitions: Some(bib_key_definitions),
        bib_key_dialect: Some(dialect),
    }
}

/// `buildProjectContext`: every tree path, plus every text path, with
/// content where a text exists.
pub fn build_project_context(input: &ContextInput) -> ProjectContext {
    let texts = project_texts(input);
    let by_path: HashMap<&str, &str> = texts
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    let paths = unique(
        input
            .tree_paths
            .iter()
            .cloned()
            .chain(texts.iter().map(|(path, _)| path.clone())),
    );
    ProjectContext {
        main_file: input.main_doc.to_string(),
        files: paths
            .into_iter()
            .map(|path| ProjectFile {
                content: by_path.get(path.as_str()).map(|text| text.to_string()),
                path,
                size: None,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::build_index;

    fn texts(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(path, text)| (path.to_string(), text.to_string()))
            .collect()
    }

    fn refs_for(
        tree: &[&str],
        index_texts: &BTreeMap<String, String>,
        open: &BTreeMap<String, String>,
    ) -> RefsContext {
        let tree: Vec<String> = tree.iter().map(|path| path.to_string()).collect();
        let index = build_index(index_texts);
        build_refs_context(&ContextInput {
            main_doc: "main.tex",
            tree_paths: &tree,
            index_texts,
            open_texts: open,
            index: Some(&index),
        })
    }

    #[test]
    fn marks_the_bibliography_loaded_only_when_every_declared_file_resolves() {
        let loaded = texts(&[
            ("main.tex", "\\bibliography{refs}"),
            ("refs.bib", "@misc{a,}"),
        ]);
        assert!(refs_for(&["main.tex", "refs.bib"], &loaded, &BTreeMap::new()).bib_loaded);
        let missing = texts(&[("main.tex", "\\bibliography{missing}")]);
        assert!(!refs_for(&["main.tex"], &missing, &BTreeMap::new()).bib_loaded);
        let undeclared = texts(&[("main.tex", "x"), ("refs.bib", "")]);
        assert!(refs_for(&["main.tex", "refs.bib"], &undeclared, &BTreeMap::new()).bib_loaded);
    }

    #[test]
    fn ignores_a_conflict_copy_that_the_document_does_not_load() {
        let project = texts(&[
            ("main.tex", "\\bibliography{refs}"),
            ("refs.bib", "@misc{a,}"),
            ("refs (conflict).bib", "@misc{b,}"),
        ]);
        let refs = refs_for(
            &["main.tex", "refs (conflict).bib", "refs.bib"],
            &project,
            &BTreeMap::new(),
        );
        let keys: Vec<_> = refs
            .bib_key_definitions
            .unwrap()
            .into_iter()
            .map(|definition| definition.key)
            .collect();
        assert_eq!(keys, vec!["a"]);
    }

    #[test]
    fn uses_the_biber_dialect_for_addbibresource() {
        let project = texts(&[("main.tex", "\\addbibresource{refs.bib}"), ("refs.bib", "")]);
        let refs = refs_for(&["main.tex", "refs.bib"], &project, &BTreeMap::new());
        assert_eq!(refs.bib_key_dialect, Some(BibKeyDialect::Biber));
    }

    #[test]
    fn counts_an_unsaved_editor_buffer_as_a_known_path() {
        let project = texts(&[("main.tex", "\\bibliography{new}")]);
        let open = texts(&[("new.bib", "@misc{n,}")]);
        let refs = refs_for(&["main.tex"], &project, &open);
        assert!(refs.bib_loaded);
        assert!(refs.bib_keys.contains(&"n".to_string()));
    }

    #[test]
    fn unreferenced_float_labels_respect_engine_scopes() {
        let project = texts(&[
            ("main.tex", "\\label{fig:a}\\label{fig:b}\\ref{fig:a}"),
            ("other.typ", "<fig:b>"),
        ]);
        let refs = refs_for(&["main.tex", "other.typ"], &project, &BTreeMap::new());
        let labels: Vec<_> = refs
            .unreferenced_labels
            .unwrap()
            .into_iter()
            .map(|label| (label.label, label.file))
            .collect();
        assert_eq!(
            labels,
            vec![
                ("fig:b".to_string(), "main.tex".to_string()),
                ("fig:b".to_string(), "other.typ".to_string())
            ]
        );
        assert_eq!(refs.defined_labels, vec!["fig:a", "fig:b"]);
    }
}
