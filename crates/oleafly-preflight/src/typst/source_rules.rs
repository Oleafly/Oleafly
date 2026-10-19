//! Typst source rules (`packages/preflight/src/typst-source-rules.ts`).

use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::messages::{message, MessageRef};
use crate::msg;
use crate::standards::annotate;
use crate::text::{is_js_space_unit, js_trim, js_trim_end, lines_with_offsets, utf16_len};
use crate::types::{Certainty, Finding, FindingMethod, Lens, Severity};
use crate::typst::references::{typst_path_references, typst_template_calls};
use crate::typst::scan::{
    call_at, closing_bracket, is_blank_value, named_argument, positional_argument, scan_typst,
    string_value, typst_calls, typst_version_at_least, TypstCall, TypstScan, MARKUP,
};
use crate::typst::DEFAULT_TYPST_VERSION;

const FIGURE_ALT_SINCE: &[u32] = &[0, 14, 0];

fn make(
    id: &str,
    lens: Lens,
    severity: Severity,
    title: MessageRef,
    detail: MessageRef,
    range: Option<(usize, usize)>,
    certainty: Option<Certainty>,
) -> Finding {
    let mut finding = Finding::new(id, lens, severity, title, detail);
    if let Some((from, to)) = range {
        finding.from = Some(from);
        finding.to = Some(to);
    }
    finding.certainty = certainty;
    finding
}

fn file_name(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    replaced
        .rsplit('/')
        .next()
        .unwrap_or(&replaced)
        .to_lowercase()
}

fn figure_alt_covers(scan: &TypstScan, figures: &[TypstCall], offset: usize) -> bool {
    figures.iter().any(|figure| {
        if offset <= figure.open || offset >= figure.close {
            return false;
        }
        named_argument(figure, "alt")
            .is_some_and(|alt| !is_blank_value(scan, alt.value_from, alt.value_to))
    })
}

fn weak_alt(scan: &TypstScan, call: &TypstCall) -> bool {
    let Some(alt) = named_argument(call, "alt") else {
        return true;
    };
    if is_blank_value(scan, alt.value_from, alt.value_to) {
        return true;
    }
    let value = string_value(scan, alt.value_from, alt.value_to);
    let source = positional_argument(scan, call, 0)
        .and_then(|path| string_value(scan, path.value_from, path.value_to));
    let (Some(value), Some(source)) = (value, source) else {
        return false;
    };
    let description = js_trim(&value.value).to_lowercase();
    description == js_trim(&source.value).to_lowercase() || description == file_name(&source.value)
}

fn figure_alt(scan: &TypstScan, version: Option<&str>) -> Vec<Finding> {
    let supported = typst_version_at_least(
        Some(version.unwrap_or(DEFAULT_TYPST_VERSION)),
        FIGURE_ALT_SINCE,
    );
    let figures = if supported {
        typst_calls(scan, &["figure"])
    } else {
        Vec::new()
    };
    typst_calls(scan, &["image"])
        .into_iter()
        .filter(|call| weak_alt(scan, call) && !figure_alt_covers(scan, &figures, call.from))
        .map(|call| {
            make(
                "figure-alt",
                Lens::A11y,
                Severity::Warning,
                message("rules.figure-alt.title"),
                message(if supported {
                    "rules.figure-alt.detailTypstFigure"
                } else {
                    "rules.figure-alt.detailTypst"
                }),
                Some((call.from, call.close + 1)),
                None,
            )
        })
        .collect()
}

static TRAILING_LABEL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"<[^<>\s]*>\s*$"));

fn heading_markers(scan: &TypstScan) -> Vec<Finding> {
    let mut out = Vec::new();
    for (offset, line) in lines_with_offsets(scan.masked.as_str()) {
        let indent = line
            .bytes()
            .take_while(|&b| b == b' ' || b == b'\t')
            .count();
        let equals = line[indent..].bytes().take_while(|&b| b == b'=').count();
        if equals == 0 {
            continue;
        }
        let marker_end = indent + equals;
        if !matches!(
            line.as_bytes().get(marker_end),
            None | Some(b' ') | Some(b'\t')
        ) {
            continue;
        }
        if scan.kind_at(offset + indent) != Some(MARKUP) {
            continue;
        }
        let rest = &line[marker_end..];
        let without_label = match TRAILING_LABEL.first_str(rest) {
            Some(found) => format!("{}{}", &rest[..found.start], &rest[found.end..]),
            None => rest.to_string(),
        };
        if !js_trim(&without_label).is_empty() {
            continue;
        }
        let from = offset + indent;
        out.push(make(
            "empty-heading",
            Lens::A11y,
            Severity::Warning,
            message("rules.empty-heading.title"),
            message("rules.empty-heading.detail"),
            Some((from, offset + utf16_len(js_trim_end(line)))),
            None,
        ));
    }
    out
}

fn trailing_content_empty(scan: &TypstScan, open: usize) -> Option<bool> {
    if scan.code_unit(open) != Some(b'[' as u16) {
        return None;
    }
    let close = closing_bracket(scan, open);
    Some(js_trim(&scan.text.slice(open + 1, close)).is_empty())
}

fn heading_call_is_empty(scan: &TypstScan, name_end: usize) -> (bool, usize) {
    let mut cursor = name_end;
    while scan.code_unit(cursor).is_some_and(is_js_space_unit) {
        cursor += 1;
    }
    if scan.code_unit(cursor) == Some(b'[' as u16) {
        let close = closing_bracket(scan, cursor);
        return (
            trailing_content_empty(scan, cursor) == Some(true),
            close + 1,
        );
    }
    let call = call_at(scan, "heading", name_end, cursor);
    let mut after = call.close + 1;
    while matches!(scan.code_unit(after), Some(0x20) | Some(0x09)) {
        after += 1;
    }
    if let Some(trailing) = trailing_content_empty(scan, after) {
        return (trailing, closing_bracket(scan, after) + 1);
    }
    let empty = match positional_argument(scan, &call, 0) {
        None => true,
        Some(body) => is_blank_value(scan, body.value_from, body.value_to),
    };
    (empty, call.close + 1)
}

static HEADING_CALL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![\p{L}\p{N}_.-])heading\s*(?=[(\[])"));
static SET_OR_SHOW: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?:set|show)\s+$"));

fn heading_calls(scan: &TypstScan) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in HEADING_CALL.find_all(&scan.code).matches {
        let before = scan.code.slice(found.from.saturating_sub(8), found.from);
        if SET_OR_SHOW.is_match(&before) {
            continue;
        }
        let (empty, to) = heading_call_is_empty(scan, found.from + "heading".len());
        if !empty {
            continue;
        }
        out.push(make(
            "empty-heading",
            Lens::A11y,
            Severity::Warning,
            message("rules.empty-heading.title"),
            message("rules.empty-heading.detail"),
            Some((found.from, to)),
            None,
        ));
    }
    out
}

static DRAFT_NOTE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?-u:\b)(?:TODO|FIXME|TBD)(?-u:\b)"));

fn draft_notes(scan: &TypstScan) -> Vec<Finding> {
    DRAFT_NOTE
        .find_all(&scan.markup)
        .matches
        .into_iter()
        .map(|found| {
            make(
                "todo-in-text",
                Lens::Submission,
                Severity::Warning,
                message("rules.todo-in-text.title"),
                message("rules.todo-in-text.detail"),
                Some((found.from, found.to)),
                Some(Certainty::Advisory),
            )
        })
        .collect()
}

static LOCAL_PATH: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(
        r"^(?:~[\\/]|/(?:Users|home|root|Volumes|mnt|media|private|tmp|var)/[^/\\]|[A-Za-z]:[\\/]|\\\\[^\\])",
    )
});

fn local_paths(scan: &TypstScan) -> Vec<Finding> {
    typst_path_references(scan)
        .into_iter()
        .filter(|reference| LOCAL_PATH.is_match(&reference.raw))
        .map(|reference| {
            make(
                "privacy-local-path",
                Lens::Privacy,
                Severity::Warning,
                msg!("rules.privacy-local-path.title", "path" => &reference.raw),
                message("rules.privacy-local-path.detail"),
                Some((reference.from, reference.to)),
                None,
            )
        })
        .collect()
}

pub fn typst_source_findings(scan: &TypstScan, version: Option<&str>) -> Vec<Finding> {
    let mut findings: Vec<Finding> = [
        figure_alt(scan, version),
        heading_markers(scan),
        heading_calls(scan),
        draft_notes(scan),
        local_paths(scan),
    ]
    .into_iter()
    .flatten()
    .map(|finding| annotate(finding, FindingMethod::SourceHeuristic))
    .collect();
    findings.sort_by_key(|finding| finding.from.unwrap_or(0));
    findings
}

pub fn run_typst_source_rules(text: &str, version: Option<&str>) -> Vec<Finding> {
    typst_source_findings(&scan_typst(text), version)
}

fn present_in(scan: &TypstScan, call: &TypstCall, name: &JsRegex) -> bool {
    call.args.iter().any(|arg| {
        arg.name
            .as_deref()
            .is_some_and(|arg_name| name.is_match(arg_name))
            && !is_blank_value(scan, arg.value_from, arg.value_to)
    })
}

static SET_BEFORE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![\p{L}\p{N}_.-])set\s+$"));
static TITLE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^title$"));
static TEMPLATE_TITLE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^title(?:[-_][^\n\r\x{2028}\x{2029}]+)?$"));
static AUTHOR: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^author$"));
static TEMPLATE_AUTHOR: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^authors?(?:[-_][^\n\r\x{2028}\x{2029}]+)?$"));

fn metadata_presence(scan: &TypstScan) -> (bool, bool) {
    let documents: Vec<TypstCall> = typst_calls(scan, &["document"])
        .into_iter()
        .filter(|call| {
            SET_BEFORE.is_match(&scan.code.slice(call.from.saturating_sub(8), call.from))
        })
        .collect();
    let templates = typst_template_calls(scan);
    let title = documents.iter().any(|call| present_in(scan, call, &TITLE))
        || templates
            .iter()
            .any(|call| present_in(scan, call, &TEMPLATE_TITLE));
    let author = documents.iter().any(|call| present_in(scan, call, &AUTHOR))
        || templates
            .iter()
            .any(|call| present_in(scan, call, &TEMPLATE_AUTHOR));
    (title, author)
}

/// `no-title` and `no-author` across every Typst file of the project.
pub fn typst_metadata_findings(
    sources: &[(String, String)],
    anonymous_review: bool,
) -> Vec<Finding> {
    let (title, author) = sources
        .iter()
        .map(|(_, content)| metadata_presence(&scan_typst(content)))
        .fold((false, false), |all, next| {
            (all.0 || next.0, all.1 || next.1)
        });
    let mut out = Vec::new();
    if !title {
        out.push(annotate(
            make(
                "no-title",
                Lens::A11y,
                Severity::Warning,
                message("rules.no-title.title"),
                message("rules.no-title.detailTypst"),
                None,
                None,
            ),
            FindingMethod::SourceHeuristic,
        ));
    }
    if !author && !anonymous_review {
        out.push(make(
            "no-author",
            Lens::Submission,
            Severity::Info,
            message("rules.no-author.title"),
            message("rules.no-author.detail"),
            None,
            Some(Certainty::Advisory),
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_without_alt_is_flagged_unless_a_figure_describes_it() {
        let bare = run_typst_source_rules("#image(\"a.png\")", Some("0.14.0"));
        assert_eq!(bare.iter().filter(|f| f.id == "figure-alt").count(), 1);
        let covered = run_typst_source_rules(
            "#figure(image(\"a.png\"), alt: \"A chart\")",
            Some("0.14.0"),
        );
        assert!(covered.iter().all(|f| f.id != "figure-alt"));
        let old = run_typst_source_rules(
            "#figure(image(\"a.png\"), alt: \"A chart\")",
            Some("0.13.0"),
        );
        assert_eq!(old.iter().filter(|f| f.id == "figure-alt").count(), 1);
    }

    #[test]
    fn empty_headings_in_markup_and_calls() {
        let found = run_typst_source_rules("= \n== Intro\n#heading[]\n#heading[Body]", None);
        assert_eq!(found.iter().filter(|f| f.id == "empty-heading").count(), 2);
    }

    #[test]
    fn local_paths_are_privacy_findings() {
        let found = run_typst_source_rules("#image(\"/Users/ana/x.png\")", None);
        assert!(found.iter().any(|f| f.id == "privacy-local-path"));
    }

    #[test]
    fn template_metadata_counts_as_title_and_author() {
        let sources = vec![(
            "main.typ".to_string(),
            "#import \"@preview/charged-ieee:0.1.0\": ieee\n#show: ieee.with(title: [Paper], authors: ((name: \"A\"),))".to_string(),
        )];
        assert!(typst_metadata_findings(&sources, false).is_empty());
        let bare = vec![("main.typ".to_string(), "Hello".to_string())];
        let ids: Vec<_> = typst_metadata_findings(&bare, false)
            .into_iter()
            .map(|f| f.id)
            .collect();
        assert_eq!(ids, vec!["no-title", "no-author"]);
    }
}
