use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::text::{js_trim, SourceText};
use crate::typst::scan::{
    call_at, is_external_typst_path, positional_argument, string_value, strings_within,
    typst_calls, typst_method_calls, typst_show_rule_calls, unescape_typst_string, TypstCall,
    TypstScan, TypstStringValue, CODE, TYPST_LABEL,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypstPathKind {
    Image,
    Include,
    Bibliography,
    Data,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstPathReference {
    pub kind: TypstPathKind,
    pub raw: String,
    pub from: usize,
    pub to: usize,
    pub call_from: usize,
    pub call_to: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstNameUse {
    pub name: String,
    pub from: usize,
    pub to: usize,
}

const DATA_CALLS: &[&str] = &["read", "csv", "json", "yaml", "toml", "xml", "cbor"];

static BIBLIOGRAPHY_WITH: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![\p{L}\p{N}_.-])bibliography\.with\s*\("));
static STATEMENT_PATH: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r#"(?<![\p{L}\p{N}_.-])(include|import)\s+""#));
static BIBLIOGRAPHY_FILE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r#"(?<![\p{L}\p{N}_.-])bibliography-file\s*:\s*""#));
static PACKAGE_IMPORT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r#"#import\s+"@[^"\n]+"\s*:\s*([^\n]+)"#));
static IDENTIFIER: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^[\p{L}_][\p{L}\p{N}_-]*$"));
static HAS_BIBLIOGRAPHY: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(concat!(
        r"(?<![\p{L}\p{N}_.-])(?:[\p{L}\p{N}_-]*bibliography(?:\.with)?\s*\(",
        r"|bibliography(?:-file)?\s*:(?!\s*none(?![0-9A-Za-z_])))",
    ))
});
static LABEL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(&format!("<({TYPST_LABEL})>")));
static AT_REFERENCE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(&format!(
        r"(?<![\p{{L}}\p{{M}}\p{{N}}\p{{Pc}}])@({TYPST_LABEL})"
    ))
});

fn bibliography_with_calls(scan: &TypstScan) -> Vec<TypstCall> {
    BIBLIOGRAPHY_WITH
        .find_all(&scan.code)
        .matches
        .into_iter()
        .map(|found| call_at(scan, "bibliography", found.from, found.to - 1))
        .collect()
}

fn argument_strings(
    scan: &TypstScan,
    call: &TypstCall,
    value_from: usize,
    value_to: usize,
) -> Vec<TypstStringValue> {
    if let Some(single) = string_value(scan, value_from, value_to) {
        return vec![single];
    }
    if scan.code_unit(value_from) == Some(b'(' as u16) && call.name == "bibliography" {
        return strings_within(scan, value_from, value_to);
    }
    Vec::new()
}

struct FirstStrings {
    name: String,
    call_from: usize,
    call_to: usize,
    values: Vec<TypstStringValue>,
}

fn first_string_arguments(scan: &TypstScan, calls: &[TypstCall]) -> Vec<FirstStrings> {
    calls
        .iter()
        .filter_map(|call| {
            let arg = positional_argument(scan, call, 0)?;
            let values = argument_strings(scan, call, arg.value_from, arg.value_to);
            (!values.is_empty()).then(|| FirstStrings {
                name: call.name.clone(),
                call_from: call.from,
                call_to: call.close + 1,
                values,
            })
        })
        .collect()
}

fn literal_after_quote(scan: &TypstScan, quote: usize) -> Option<(usize, usize)> {
    scan.strings
        .iter()
        .copied()
        .find(|&(from, _)| from == quote + 1)
}

fn statement_paths(scan: &TypstScan) -> Vec<TypstPathReference> {
    let mut out = Vec::new();
    for found in STATEMENT_PATH.find_all(&scan.code).matches {
        let quote = found.to - 1;
        let Some((from, to)) = literal_after_quote(scan, quote) else {
            continue;
        };
        let raw = unescape_typst_string(&scan.text.slice(from, to));
        if is_external_typst_path(&raw) {
            continue;
        }
        out.push(TypstPathReference {
            kind: TypstPathKind::Include,
            raw,
            from,
            to,
            call_from: found.from,
            call_to: to + 1,
        });
    }
    out
}

fn named_bibliography_files(scan: &TypstScan) -> Vec<TypstPathReference> {
    let mut out = Vec::new();
    for found in BIBLIOGRAPHY_FILE.find_all(&scan.code).matches {
        let quote = found.to - 1;
        let Some((from, to)) = literal_after_quote(scan, quote) else {
            continue;
        };
        out.push(TypstPathReference {
            kind: TypstPathKind::Bibliography,
            raw: unescape_typst_string(&scan.text.slice(from, to)),
            from,
            to,
            call_from: found.from,
            call_to: to + 1,
        });
    }
    out
}

fn path_kind_of_call(name: &str) -> TypstPathKind {
    match name {
        "image" => TypstPathKind::Image,
        "bibliography" => TypstPathKind::Bibliography,
        _ => TypstPathKind::Data,
    }
}

pub fn typst_path_references(scan: &TypstScan) -> Vec<TypstPathReference> {
    let mut names = vec!["image", "bibliography"];
    names.extend_from_slice(DATA_CALLS);
    let mut calls = typst_calls(scan, &names);
    calls.extend(bibliography_with_calls(scan));
    let mut references: Vec<TypstPathReference> = first_string_arguments(scan, &calls)
        .into_iter()
        .flat_map(|call| {
            let kind = path_kind_of_call(&call.name);
            call.values
                .into_iter()
                .map(move |value| TypstPathReference {
                    kind,
                    raw: value.value,
                    from: value.from,
                    to: value.to,
                    call_from: call.call_from,
                    call_to: call.call_to,
                })
        })
        .collect();
    references.extend(statement_paths(scan));
    references.extend(named_bibliography_files(scan));
    references.sort_by_key(|reference| reference.from);
    references
}

fn imported_name(item: &str) -> String {
    let words: Vec<&str> = item
        .split(crate::text::is_js_space)
        .filter(|word| !word.is_empty())
        .collect();
    match words.iter().position(|&word| word == "as") {
        Some(alias) if alias > 0 && alias + 1 < words.len() => words[alias + 1].to_string(),
        _ => item.to_string(),
    }
}

pub fn typst_package_import_names(scan: &TypstScan) -> Vec<String> {
    let masked = scan.masked.as_str();
    let mut names = Vec::new();
    for found in PACKAGE_IMPORT.captures_str(masked).0 {
        for item in found.group(masked, 1).unwrap_or("").split(',') {
            let cleaned: String = item.chars().filter(|&ch| ch != '(' && ch != ')').collect();
            let name = imported_name(js_trim(&cleaned));
            if IDENTIFIER.is_match(&name) {
                names.push(name);
            }
        }
    }
    names
}

pub fn typst_template_calls(scan: &TypstScan) -> Vec<TypstCall> {
    let imported = typst_package_import_names(scan);
    let mut calls = typst_show_rule_calls(scan);
    calls.extend(typst_method_calls(scan, "with"));
    if !imported.is_empty() {
        let names: Vec<&str> = imported.iter().map(String::as_str).collect();
        calls.extend(typst_calls(scan, &names));
    }
    calls
}

pub fn typst_has_bibliography(scan: &TypstScan) -> bool {
    HAS_BIBLIOGRAPHY.is_match(scan.code.as_str())
}

fn name_uses(regex: &JsRegex, source: &SourceText) -> Vec<(String, usize, usize)> {
    regex
        .find_all(source)
        .matches
        .into_iter()
        .map(|found| {
            (
                found.text(source, 1).unwrap_or("").to_string(),
                found.from,
                found.to,
            )
        })
        .collect()
}

pub fn typst_labels(scan: &TypstScan) -> Vec<TypstNameUse> {
    name_uses(&LABEL, &scan.markup)
        .into_iter()
        .map(|(name, from, to)| TypstNameUse { name, from, to })
        .collect()
}

fn trim_reference(name: &str) -> &str {
    name.trim_end_matches(['.', ':'])
}

pub fn typst_at_references(scan: &TypstScan) -> Vec<TypstNameUse> {
    name_uses(&AT_REFERENCE, &scan.markup)
        .into_iter()
        .filter_map(|(name, from, _)| {
            let trimmed = trim_reference(&name);
            (!trimmed.is_empty()).then(|| TypstNameUse {
                name: trimmed.to_string(),
                from,
                to: from + 1 + crate::text::utf16_len(trimmed),
            })
        })
        .collect()
}

fn label_arguments(scan: &TypstScan, name: &str) -> Vec<TypstNameUse> {
    let mut out = Vec::new();
    let label_calls = typst_calls(scan, &["label"]);
    for call in typst_calls(scan, &[name]) {
        let arguments = SourceText::new(scan.text.slice(call.open, call.close));
        for found in LABEL.find_all(&arguments).matches {
            let from = call.open + found.from;
            if scan.kind_at(from) != Some(CODE) {
                continue;
            }
            out.push(TypstNameUse {
                name: found.text(&arguments, 1).unwrap_or("").to_string(),
                from: call.from,
                to: call.close + 1,
            });
        }
        for label_call in &label_calls {
            if label_call.from < call.open || label_call.from > call.close {
                continue;
            }
            let value = positional_argument(scan, label_call, 0)
                .and_then(|arg| string_value(scan, arg.value_from, arg.value_to));
            if let Some(value) = value.filter(|value| !value.value.is_empty()) {
                out.push(TypstNameUse {
                    name: value.value,
                    from: call.from,
                    to: call.close + 1,
                });
            }
        }
    }
    out
}

pub fn typst_ref_calls(scan: &TypstScan) -> Vec<TypstNameUse> {
    label_arguments(scan, "ref")
}

pub fn typst_cite_calls(scan: &TypstScan) -> Vec<TypstNameUse> {
    label_arguments(scan, "cite")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::typst::scan::scan_typst;

    #[test]
    fn path_references_cover_calls_statements_and_named_files() {
        let scan = scan_typst(
            "#image(\"figs/a.png\")\n#include \"chap.typ\"\n#bibliography(\"refs.bib\")\n#show: x.with(bibliography-file: \"b.yml\")",
        );
        let raws: Vec<_> = typst_path_references(&scan)
            .into_iter()
            .map(|r| (r.kind, r.raw))
            .collect();
        assert_eq!(
            raws,
            vec![
                (TypstPathKind::Image, "figs/a.png".to_string()),
                (TypstPathKind::Include, "chap.typ".to_string()),
                (TypstPathKind::Bibliography, "refs.bib".to_string()),
                (TypstPathKind::Bibliography, "b.yml".to_string()),
            ]
        );
    }

    #[test]
    fn at_references_trim_trailing_punctuation_and_skip_emails() {
        let scan = scan_typst("See @fig:plot. Mail ana@example.com");
        let names: Vec<_> = typst_at_references(&scan)
            .into_iter()
            .map(|use_| use_.name)
            .collect();
        assert_eq!(names, vec!["fig:plot"]);
    }

    #[test]
    fn cite_calls_read_labels_in_code() {
        let scan = scan_typst("#cite(<smith>) and #cite(label(\"jones\"))");
        let names: Vec<_> = typst_cite_calls(&scan)
            .into_iter()
            .map(|use_| use_.name)
            .collect();
        assert_eq!(names, vec!["smith", "jones"]);
    }

    #[test]
    fn package_imports_name_their_functions() {
        let scan = scan_typst("#import \"@preview/charged-ieee:0.1.0\": ieee, other as alias\n");
        assert_eq!(typst_package_import_names(&scan), vec!["ieee", "alias"]);
    }
}
