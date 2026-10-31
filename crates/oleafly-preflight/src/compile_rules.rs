use std::collections::HashSet;
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::messages::{message, MessageRef};
use crate::msg;
use crate::standards::annotate;
use crate::text::{js_number_to_string, js_round, js_to_fixed, js_trim};
use crate::types::{
    Certainty, CompileContext, CompileStatus, Finding, FindingMethod, Lens, PdfFacts, Severity,
};

fn finding(id: &str, severity: Severity, title: MessageRef, detail: MessageRef) -> Finding {
    annotate(
        Finding::new(id, Lens::Compile, severity, title, detail)
            .with_certainty(Certainty::Verified),
        FindingMethod::CompileLog,
    )
}

static REPORT_START: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^\s*Status\s+report\s+of\s+the\s+tagging\s+support\s*$"));
static REPORT_END: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^\s*End\s+of\s+status\s+report\s*$"));
static CLASS_LINE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^\s*(\S+\.cls)\s+is\s([^\n\r\x{2028}\x{2029}]*)$"));
static SECTION_LINE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^\s*([1-6])\.\s([^\n\r\x{2028}\x{2029}]*)$"));
static FILE_LINE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^\s*(\S+\.(?:sty|def|ldf|cfg|tex|clo|cls))\s*$"));
static OVERFULL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)Overfull \\hbox \(([0-9.]+)pt too wide\)"));
static RERUN: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)Label\(s\) may have changed|Rerun to get cross-references right",
        r"|Please \(re\)run (?:Biber|BibTeX)",
    ))
});

const TAGPDF_WARNING: &str = "Package tagpdf Warning:";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TaggingStatusGroup {
    Unsupported,
    Incompatible,
    Partial,
    Compatible,
    Unknown,
    Unclassified,
}

/// LaTeX's own tagging status report, from the end of a build log.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaggingStatusReport {
    pub document_class: Option<(String, String)>,
    pub unsupported: Vec<String>,
    pub incompatible: Vec<String>,
    pub partial: Vec<String>,
    pub compatible: Vec<String>,
    pub unknown: Vec<String>,
    pub unclassified: Vec<String>,
}

impl TaggingStatusReport {
    fn group_mut(&mut self, group: TaggingStatusGroup) -> &mut Vec<String> {
        match group {
            TaggingStatusGroup::Unsupported => &mut self.unsupported,
            TaggingStatusGroup::Incompatible => &mut self.incompatible,
            TaggingStatusGroup::Partial => &mut self.partial,
            TaggingStatusGroup::Compatible => &mut self.compatible,
            TaggingStatusGroup::Unknown => &mut self.unknown,
            TaggingStatusGroup::Unclassified => &mut self.unclassified,
        }
    }
}

fn group_by_section(section: &str) -> Option<TaggingStatusGroup> {
    Some(match section {
        "1" => TaggingStatusGroup::Unsupported,
        "2" => TaggingStatusGroup::Incompatible,
        "3" => TaggingStatusGroup::Partial,
        "4" => TaggingStatusGroup::Compatible,
        "5" => TaggingStatusGroup::Unknown,
        "6" => TaggingStatusGroup::Unclassified,
        _ => return None,
    })
}

pub fn parse_tagging_status_report(log_lines: &[&str]) -> Option<TaggingStatusReport> {
    let start = log_lines
        .iter()
        .position(|line| REPORT_START.is_match(line))?;
    let mut report = TaggingStatusReport::default();
    let mut group: Option<TaggingStatusGroup> = None;
    for line in &log_lines[start + 1..] {
        if REPORT_END.is_match(line) {
            break;
        }
        if let Some(section) = SECTION_LINE.first_str(line) {
            if !js_trim(section.group(line, 2).unwrap_or("")).is_empty() {
                group = group_by_section(section.group(line, 1).unwrap_or(""));
                continue;
            }
        }
        if report.document_class.is_none() {
            if let Some(class) = CLASS_LINE.first_str(line) {
                report.document_class = Some((
                    class.group(line, 1).unwrap_or("").to_string(),
                    js_trim(class.group(line, 2).unwrap_or("")).to_string(),
                ));
                continue;
            }
        }
        if let (Some(file), Some(group)) = (FILE_LINE.first_str(line), group) {
            report
                .group_mut(group)
                .push(file.group(line, 1).unwrap_or("").to_string());
        }
    }
    Some(report)
}

fn first_eight(files: &[String]) -> String {
    files.iter().take(8).cloned().collect::<Vec<_>>().join(", ")
}

fn tagging_status_finding(report: &TaggingStatusReport) -> Vec<Finding> {
    let class_status = report
        .document_class
        .as_ref()
        .map(|(_, status)| status.to_lowercase());
    let class_problem = class_status
        .as_deref()
        .is_some_and(|status| status != "compatible");
    let blocking: Vec<String> = report
        .unsupported
        .iter()
        .chain(&report.incompatible)
        .cloned()
        .collect();
    let unproven: Vec<String> = report
        .unknown
        .iter()
        .chain(&report.unclassified)
        .cloned()
        .collect();
    if !class_problem && blocking.is_empty() && unproven.is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<MessageRef> = Vec::new();
    if class_problem {
        if let Some((name, status)) = &report.document_class {
            parts.push(msg!(
                "rules.output-tagging-status.partClass",
                "name" => name,
                "status" => status
            ));
        }
    }
    if !blocking.is_empty() {
        parts.push(
            msg!("rules.output-tagging-status.partBlocking", "files" => first_eight(&blocking)),
        );
    }
    if !unproven.is_empty() {
        parts.push(
            msg!("rules.output-tagging-status.partUnproven", "files" => first_eight(&unproven)),
        );
    }
    if !report.partial.is_empty() {
        parts.push(msg!("rules.output-tagging-status.partPartial", "files" => first_eight(&report.partial)));
    }
    parts.push(message("rules.output-tagging-status.partAdvice"));
    let flagged = usize::from(class_problem) + blocking.len() + unproven.len();
    let mut finding = Finding::new(
        "output-tagging-status",
        Lens::A11y,
        Severity::Warning,
        msg!("rules.output-tagging-status.title", "count" => flagged),
        message("rules.output-tagging-status.detail"),
    )
    .with_certainty(Certainty::Verified);
    finding.detail_parts = Some(parts);
    vec![annotate(finding, FindingMethod::CompileLog)]
}

fn tagging_log_findings(log_lines: &[&str]) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut unique: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for line in log_lines {
        let Some(at) = line.find(TAGPDF_WARNING) else {
            continue;
        };
        let warning = js_trim(&line[at + TAGPDF_WARNING.len()..]);
        if !warning.is_empty() && seen.insert(warning.to_string()) {
            unique.push(warning.to_string());
        }
    }
    if !unique.is_empty() {
        let warnings = unique.iter().take(5).cloned().collect::<Vec<_>>().join(" ");
        out.push(annotate(
            Finding::new(
                "output-tagpdf-warning",
                Lens::A11y,
                Severity::Warning,
                msg!("rules.output-tagpdf-warning.title", "count" => unique.len()),
                msg!("rules.output-tagpdf-warning.detail", "warnings" => warnings),
            )
            .with_certainty(Certainty::Verified),
            FindingMethod::CompileLog,
        ));
    }
    if let Some(report) = parse_tagging_status_report(log_lines) {
        out.extend(tagging_status_finding(&report));
    }
    out
}

/// Page sizes rounded to 0.1 pt and printed like JavaScript numbers.
pub fn distinct_page_sizes(pdf: &PdfFacts) -> Vec<String> {
    let mut sizes: Vec<String> = Vec::new();
    for page in &pdf.pages {
        let width = js_round(page.width * 10.0) / 10.0;
        let height = js_round(page.height * 10.0) / 10.0;
        let size = format!(
            "{} × {}",
            js_number_to_string(width),
            js_number_to_string(height)
        );
        if !sizes.contains(&size) {
            sizes.push(size);
        }
    }
    sizes
}

fn overfull_width(text: &str) -> f64 {
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// `main.tex:12: Undefined control sequence.`, how TeX prints an error under
/// `-file-line-error` (it has no `! ` line then).
static FILE_LINE_ERROR: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^(?:[A-Za-z]:)?[^:\n]*\.(?:tex|sty|cls|ltx|def|cfg|clo|fd|bbx|cbx|lbx|dtx):\d+:\s",
    )
    .expect("the file-line-error pattern is valid")
});

/// Whether a build log shows a failed build, for a log that arrives without
/// the build's own verdict (`oleafly check --build-log`): a TeX error (a
/// `! ` line, or a `file:line:` one), a fatal error, a run with no pages of
/// output, a compiler's own `error:` line (Tectonic, Typst), a Pandoc error,
/// or latexmk giving up. Warnings and overfull boxes are not failures.
pub fn infer_compile_status(log: &str) -> CompileStatus {
    let failed = log.lines().map(str::trim_end).any(|line| {
        line.starts_with("! ")
            || line.starts_with("error:")
            || line.starts_with("error[")
            || line.starts_with("pandoc: ")
            || line == "No pages of output."
            || line == "Error producing PDF."
            || line.contains("Latexmk: Errors, so I did not complete making targets")
            || FILE_LINE_ERROR.is_match(line)
    });
    if failed {
        CompileStatus::Error
    } else {
        CompileStatus::Success
    }
}

pub fn run_compile_rules(context: Option<&CompileContext>, pdf: Option<&PdfFacts>) -> Vec<Finding> {
    let mut out = Vec::new();
    let log = context.map(|context| context.log.as_str()).unwrap_or("");
    let log_lines: Vec<&str> = log.split('\n').collect();
    let lower_log = log.to_lowercase();

    if context.is_some_and(|context| context.status == CompileStatus::Error) {
        out.push(finding(
            "compile-failed",
            Severity::Error,
            message("rules.compile-failed.title"),
            message("rules.compile-failed.detail"),
        ));
    }

    let (overfull, _) = OVERFULL.captures_str(log);
    let widths: Vec<f64> = overfull
        .iter()
        .map(|found| overfull_width(found.group(log, 1).unwrap_or("")))
        .collect();
    if !widths.is_empty() {
        let widest = if widths.iter().any(|width| width.is_nan()) {
            f64::NAN
        } else {
            widths.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        };
        out.push(finding(
            "compile-overfull-box",
            if widest >= 10.0 {
                Severity::Error
            } else {
                Severity::Warning
            },
            msg!("rules.compile-overfull-box.title", "count" => widths.len()),
            msg!("rules.compile-overfull-box.detail", "width" => js_to_fixed(widest, 1)),
        ));
    }

    let missing_glyphs = log_lines
        .iter()
        .filter(|line| {
            let lower = line.to_lowercase();
            lower.contains("missing character:") && lower.contains("there is no ")
        })
        .count();
    if missing_glyphs > 0 {
        out.push(finding(
            "compile-missing-glyph",
            Severity::Error,
            msg!("rules.compile-missing-glyph.title", "count" => missing_glyphs),
            message("rules.compile-missing-glyph.detail"),
        ));
    }

    let has_undefined_reference = lower_log.contains("there were undefined references")
        || lower_log.contains("undefined citation")
        || log_lines.iter().any(|line| {
            let lower = line.to_lowercase();
            lower.contains("reference ")
                && lower.contains(" on page ")
                && lower.contains(" undefined")
        });
    if has_undefined_reference {
        out.push(finding(
            "compile-unresolved-references",
            Severity::Error,
            message("rules.compile-unresolved-references.title"),
            message("rules.compile-unresolved-references.detail"),
        ));
    }

    if RERUN.is_match(log) {
        out.push(finding(
            "compile-rerun-required",
            Severity::Warning,
            message("rules.compile-rerun-required.title"),
            message("rules.compile-rerun-required.detail"),
        ));
    }

    let has_duplicate_destination = log_lines.iter().any(|line| {
        let lower = line.to_lowercase();
        lower.contains("destination with the same identifier")
            && lower.contains("duplicate ignored")
    });
    if has_duplicate_destination {
        out.push(finding(
            "compile-duplicate-destination",
            Severity::Warning,
            message("rules.compile-duplicate-destination.title"),
            message("rules.compile-duplicate-destination.detail"),
        ));
    }

    if let Some(pdf) = pdf {
        let sizes = distinct_page_sizes(pdf);
        if sizes.len() > 1 {
            out.push(finding(
                "compile-mixed-page-sizes",
                Severity::Warning,
                message("rules.compile-mixed-page-sizes.title"),
                msg!(
                    "rules.compile-mixed-page-sizes.detail",
                    "count" => sizes.len(),
                    "sizes" => sizes.join(", ")
                ),
            ));
        }
    }

    out.extend(tagging_log_findings(&log_lines));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::ParamValue;
    use crate::types::PdfPageFacts;

    fn log(text: &str) -> CompileContext {
        CompileContext {
            status: CompileStatus::Success,
            log: text.into(),
        }
    }

    #[test]
    fn a_log_with_a_tex_or_compiler_error_is_a_failed_build() {
        for failing in [
            "(./main.tex\n! LaTeX Error: File `missing.sty' not found.\n\nType X to quit.",
            "! Undefined control sequence.\nl.5 \\foo",
            "!  ==> Fatal error occurred, no output PDF file produced!",
            "! Emergency stop.\r\nl.3 ",
            "./main.tex:5: Undefined control sequence.\nl.5 \\foo",
            "C:\\work\\main.tex:12: LaTeX Error: Missing \\begin{document}.",
            "No pages of output.\nTranscript written on main.log.",
            "error: halted on potentially-recoverable error as specified",
            "error: unknown variable: foo\n  ┌─ main.typ:3:2",
            "pandoc: Could not find data file templates/default.latex",
            "Error producing PDF.",
            "Latexmk: Errors, so I did not complete making targets",
        ] {
            assert_eq!(
                infer_compile_status(failing),
                CompileStatus::Error,
                "{failing}"
            );
        }
    }

    #[test]
    fn a_log_with_only_warnings_is_a_good_build() {
        let good = "This is pdfTeX, Version 3.141592653\n(./main.tex\nLaTeX Warning: Reference `a' on page 1 undefined on input line 4.\nOverfull \\hbox (3.0pt too wide) in paragraph at lines 5--6\nPackage hyperref Warning: Token not allowed in a PDF string.\nOutput written on main.pdf (1 page, 12345 bytes).\nTranscript written on main.log.\n";
        assert_eq!(infer_compile_status(good), CompileStatus::Success);
        assert_eq!(infer_compile_status(""), CompileStatus::Success);
        assert_eq!(
            infer_compile_status("[]\\OT1/cmr/m/n/10 An error: here\nwarning: a hint\n"),
            CompileStatus::Success
        );
    }

    #[test]
    fn overfull_width_of_ten_points_is_an_error() {
        let found = run_compile_rules(Some(&log("Overfull \\hbox (10.0pt too wide)")), None);
        let overfull = found
            .iter()
            .find(|f| f.id == "compile-overfull-box")
            .unwrap();
        assert_eq!(overfull.severity, Severity::Error);
        assert_eq!(
            overfull.detail.params["width"],
            ParamValue::Text("10.0".into())
        );
        let narrow = run_compile_rules(Some(&log("Overfull \\hbox (9.9pt too wide)")), None);
        assert_eq!(narrow[0].severity, Severity::Warning);
    }

    #[test]
    fn mixed_page_sizes_print_like_javascript_numbers() {
        let page = |width, height| PdfPageFacts {
            width,
            height,
            rotation: 0,
        };
        let facts = PdfFacts {
            version: Some("1.7".into()),
            page_count: 2,
            pages: vec![page(612.0, 792.0), page(595.276, 841.89)],
            outline_count: 0,
            link_count: 0,
            attachment_count: 0,
            form_field_count: 0,
            restricted: Some(false),
            author: None,
            creator: None,
            producer: None,
            fonts: Vec::new(),
        };
        assert_eq!(
            distinct_page_sizes(&facts),
            vec!["612 × 792", "595.3 × 841.9"]
        );
    }

    #[test]
    fn tagging_status_report_lists_blocking_files() {
        let text = "Status report of the tagging support\n article.cls is compatible\n1. Unsupported:\n foo.sty\n5. Unknown:\n bar.sty\nEnd of status report";
        let found = run_compile_rules(Some(&log(text)), None);
        let status = found
            .iter()
            .find(|f| f.id == "output-tagging-status")
            .unwrap();
        assert_eq!(status.title.params["count"], ParamValue::Int(2));
        assert_eq!(status.detail_parts.as_ref().map(Vec::len), Some(3));
    }
}
