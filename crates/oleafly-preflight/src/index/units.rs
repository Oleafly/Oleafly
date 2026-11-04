//! Compilation units, mirroring the roots and include walk in
//! `src/lib/project-intelligence/assemble.ts`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use unicode_normalization::UnicodeNormalization;

use super::{engine_for_path, IndexEngine};
use crate::collate::locale_compare;
use crate::jsre::JsRegex;
use crate::latex::lexical::{latex_ignored_ranges, mask_latex_ignored_regions};
use crate::text::{js_trim, strip_quotes, to_units, SourceText};
use crate::typst::scan::normalize_project_path;

/// For each file, the LaTeX roots whose compilation units contain it. A root
/// is a LaTeX file with `\documentclass`, or the main document; its unit is
/// the root and every file it reaches through include and import edges.
/// Files that no root reaches are absent.
pub type CompilationUnits = BTreeMap<String, Vec<String>>;

static DOCUMENT_CLASS: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(
        r"\\(?:documentclass|LoadClass|LoadClassWithOptions)\*?\s*(?:\[[^\]]*\]\s*)?\{\s*[^\s}]",
    )
});
static INCLUDE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\(?:input|include|subfile|InputIfFileExists)\s*\{([^}]*)\}"));
static IMPORT: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(
        r"(?i)\\(?:import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)\*?\s*\{([^}]*)\}\s*\{([^}]*)\}",
    )
});
static LATEX_DOCUMENT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\.(?:tex|ltx|latex)$"));
static EXTENSION: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.[a-z0-9]+$"));
static URL_LIKE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)^[a-z][a-z0-9+.-]*:"));

const INCLUDE_EXTENSIONS: [&str; 6] = [".tex", ".ltx", ".latex", ".typ", ".md", ".markdown"];

struct Include {
    raw: String,
    /// LaTeX includes are searched from the root's folder, where LaTeX runs;
    /// imports stay relative to the file that names them.
    from_root: bool,
}

struct LatexFile {
    declares_class: bool,
    includes: Vec<Include>,
}

fn scan(text: &str) -> LatexFile {
    let units = to_units(text);
    let ignored = latex_ignored_ranges(&units);
    let masked = SourceText::from_units(mask_latex_ignored_regions(&units, &ignored));
    let masked = masked.as_str();
    let mut includes: Vec<Include> = INCLUDE
        .captures_str(masked)
        .0
        .iter()
        .map(|found| Include {
            raw: js_trim(found.group(masked, 1).unwrap_or("")).to_string(),
            from_root: true,
        })
        .collect();
    includes.extend(IMPORT.captures_str(masked).0.iter().map(|found| {
        let directory = js_trim(found.group(masked, 1).unwrap_or(""));
        let file = js_trim(found.group(masked, 2).unwrap_or(""));
        Include {
            raw: format!("{}/{file}", directory.trim_end_matches('/')),
            from_root: false,
        }
    }));
    LatexFile {
        declares_class: DOCUMENT_CLASS.is_match(masked),
        includes,
    }
}

/// Paths match regardless of case and Unicode normal form, as in the app.
fn fold_key(path: &str) -> String {
    path.nfc().collect::<String>().to_lowercase()
}

fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |slash| &path[..slash])
}

fn project_path_from(directory: &str, raw: &str) -> Option<String> {
    let raw = strip_quotes(js_trim(raw));
    if raw.is_empty()
        || raw.starts_with('#')
        || raw.starts_with('@')
        || raw.starts_with('/')
        || URL_LIKE.is_match(raw)
    {
        return None;
    }
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    let joined = if directory.is_empty() {
        relative.to_string()
    } else {
        format!("{directory}/{relative}")
    };
    normalize_project_path(&joined).filter(|path| !path.is_empty())
}

/// The project files a path names, trying the include extensions when it has
/// none.
fn candidates_for<'a>(path: &str, known: &HashMap<String, Vec<&'a str>>) -> Vec<&'a str> {
    let mut spellings = vec![path.to_string()];
    if !EXTENSION.is_match(path) {
        spellings.extend(INCLUDE_EXTENSIONS.iter().map(|ext| format!("{path}{ext}")));
    }
    let mut found: Vec<&str> = Vec::new();
    for spelling in spellings {
        for file in known.get(&fold_key(&spelling)).into_iter().flatten() {
            if !found.contains(file) {
                found.push(file);
            }
        }
    }
    found
}

/// The first folder with a match decides; more than one match leaves the
/// include unresolved.
fn resolve(raw: &str, directories: &[&str], known: &HashMap<String, Vec<&str>>) -> Option<String> {
    for directory in directories {
        let Some(path) = project_path_from(directory, raw) else {
            continue;
        };
        let candidates = candidates_for(&path, known);
        if !candidates.is_empty() {
            return (candidates.len() == 1).then(|| candidates[0].to_string());
        }
    }
    None
}

fn reached_files(
    root: &str,
    files: &HashMap<&str, LatexFile>,
    known: &HashMap<String, Vec<&str>>,
) -> HashSet<String> {
    let mut reached = HashSet::new();
    let mut pending = vec![root.to_string()];
    while let Some(file) = pending.pop() {
        if !reached.insert(file.clone()) {
            continue;
        }
        let includes = files
            .get(file.as_str())
            .map_or(&[][..], |latex| &latex.includes);
        for include in includes {
            let directories = if include.from_root {
                vec![parent(root), "", parent(&file)]
            } else {
                vec![parent(&file)]
            };
            if let Some(target) = resolve(&include.raw, &directories, known) {
                pending.push(target);
            }
        }
    }
    reached
}

pub fn compilation_units(
    main_document: &str,
    texts: &[(String, String)],
    known_paths: &[String],
) -> CompilationUnits {
    let mut known: HashMap<String, Vec<&str>> = HashMap::new();
    for path in known_paths {
        known.entry(fold_key(path)).or_default().push(path);
    }
    let files: HashMap<&str, LatexFile> = texts
        .iter()
        .filter(|(path, _)| engine_for_path(path) == Some(IndexEngine::Latex))
        .map(|(path, text)| (path.as_str(), scan(text)))
        .collect();
    let mut roots: Vec<&str> = files
        .iter()
        .filter(|(path, file)| file.declares_class && LATEX_DOCUMENT.is_match(path))
        .map(|(path, _)| *path)
        .collect();
    if LATEX_DOCUMENT.is_match(main_document) && !roots.contains(&main_document) {
        roots.push(main_document);
    }
    roots.sort_by(|left, right| locale_compare(left, right).then_with(|| left.cmp(right)));
    let mut units = CompilationUnits::new();
    for root in roots {
        for file in reached_files(root, &files, &known) {
            units.entry(file).or_default().push(root.to_string());
        }
    }
    units
}

/// Whether a name defined in one file is visible from another. Two files that
/// both belong to compilation units see each other only when they share one;
/// a file in no unit sees, and is seen from, every file.
pub fn share_compilation_unit(units: &CompilationUnits, left: &str, right: &str) -> bool {
    match (units.get(left), units.get(right)) {
        (Some(left), Some(right)) => left.iter().any(|root| right.contains(root)),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn units(main: &str, files: &[(&str, &str)], extra: &[&str]) -> CompilationUnits {
        let texts: Vec<(String, String)> = files
            .iter()
            .map(|(path, text)| (path.to_string(), text.to_string()))
            .collect();
        let known: Vec<String> = files
            .iter()
            .map(|(path, _)| path.to_string())
            .chain(extra.iter().map(|path| path.to_string()))
            .collect();
        compilation_units(main, &texts, &known)
    }

    fn roots(units: &CompilationUnits, file: &str) -> Option<Vec<String>> {
        units.get(file).cloned()
    }

    #[test]
    fn separate_documents_get_separate_units() {
        let units = units(
            "manuscript.tex",
            &[
                (
                    "manuscript.tex",
                    "\\documentclass{article}\n\\input{shared}",
                ),
                (
                    "manuscript_v1.tex",
                    "\\documentclass[11pt]{article}\n\\input{shared}",
                ),
                ("shared.tex", "\\label{fig:a}"),
            ],
            &[],
        );
        assert_eq!(
            roots(&units, "manuscript.tex"),
            Some(vec!["manuscript.tex".into()])
        );
        assert_eq!(
            roots(&units, "shared.tex"),
            Some(vec!["manuscript_v1.tex".into(), "manuscript.tex".into()])
        );
        assert!(!share_compilation_unit(
            &units,
            "manuscript.tex",
            "manuscript_v1.tex"
        ));
        assert!(share_compilation_unit(
            &units,
            "manuscript.tex",
            "shared.tex"
        ));
    }

    #[test]
    fn the_main_document_is_a_root_without_a_class() {
        let units = units(
            "main.tex",
            &[("main.tex", "\\input{body}"), ("body.tex", "Body.")],
            &[],
        );
        assert_eq!(roots(&units, "body.tex"), Some(vec!["main.tex".into()]));
    }

    #[test]
    fn includes_resolve_from_the_root_folder() {
        let units = units(
            "paper/main.tex",
            &[
                (
                    "paper/main.tex",
                    "\\documentclass{article}\n\\subfile{sections/a}",
                ),
                (
                    "paper/sections/a.tex",
                    "\\input{figures/plot}\n\\import{parts/}{b}",
                ),
            ],
            &["paper/figures/plot.tex", "paper/sections/parts/b.tex"],
        );
        assert_eq!(
            roots(&units, "paper/figures/plot.tex"),
            Some(vec!["paper/main.tex".into()])
        );
        assert_eq!(
            roots(&units, "paper/sections/parts/b.tex"),
            Some(vec!["paper/main.tex".into()])
        );
    }

    #[test]
    fn includes_match_paths_in_any_unicode_normal_form() {
        let units = units(
            "main.tex",
            &[
                ("main.tex", "\\documentclass{article}\n\\input{caf\u{e9}}"),
                ("cafe\u{301}.tex", "\\label{x}"),
            ],
            &[],
        );
        assert_eq!(
            roots(&units, "cafe\u{301}.tex"),
            Some(vec!["main.tex".into()])
        );
    }

    #[test]
    fn a_fragment_nothing_includes_sees_every_file() {
        let units = units(
            "main.tex",
            &[
                ("main.tex", "\\documentclass{article}\n% \\input{notes}"),
                ("notes.tex", "Notes."),
            ],
            &[],
        );
        assert_eq!(roots(&units, "notes.tex"), None);
        assert!(share_compilation_unit(&units, "notes.tex", "main.tex"));
    }
}
