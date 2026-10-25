//! Typst submission and privacy rules
//! (`packages/preflight/src/typst-submission-rules.ts`).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::messages::{message, MessageRef};
use crate::msg;
use crate::profiles::{
    extract_typst_templates, submission_profile, submission_profiles, SubmissionProfile,
};
use crate::submission_rules::{
    file_privacy_findings, generated_file_findings, has_internal_comment, pdf_author_findings,
    pdf_submission_findings, portable_name_findings, SubmissionRuleInput, INTERNAL_COMMENT_TERMS,
};
use crate::text::{lines_with_offsets, utf16_len, SourceText};
use crate::types::{Certainty, Finding, Lens, PdfFacts, ProjectContext, ProjectFile, Severity};
use crate::typst::references::{
    typst_path_references, typst_template_calls, TypstPathKind, TypstPathReference,
};
use crate::typst::scan::{
    is_blank_value, is_external_typst_path, named_argument, normalize_project_path,
    positional_argument, resolve_typst_path, scan_typst, typst_calls, TypstCall, TypstScan, MARKUP,
};
use crate::typst::LARGE_IMAGE_BYTES;

const LARGE_IMAGE_LABEL: &str = "5 MB";

struct ScannedFile {
    path: String,
    scan: TypstScan,
}

fn make(
    id: &str,
    lens: Lens,
    severity: Severity,
    title: MessageRef,
    detail: MessageRef,
    file: Option<&str>,
    certainty: Certainty,
) -> Finding {
    let mut finding = Finding::new(id, lens, severity, title, detail).with_certainty(certainty);
    finding.file = file.map(str::to_string);
    finding
}

static TYPST_FILE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.typ$"));

fn is_typst_file(path: &str) -> bool {
    TYPST_FILE.is_match(path)
}

fn typst_files(project: &ProjectContext) -> Vec<ScannedFile> {
    project
        .files
        .iter()
        .filter(|file| file.content.is_some() && is_typst_file(&file.path))
        .map(|file| ScannedFile {
            path: file.path.clone(),
            scan: scan_typst(file.content.as_deref().unwrap_or("")),
        })
        .collect()
}

/// Whether a line of the masked text matches `pattern` (anchored, with the
/// leading whitespace as group 1) at a markup position.
fn markup_lines(scan: &TypstScan, pattern: &JsRegex) -> bool {
    for (offset, line) in lines_with_offsets(scan.masked.as_str()) {
        let Some(found) = pattern.first_str(line) else {
            continue;
        };
        let lead = found.group(line, 1).map(utf16_len).unwrap_or(0);
        let at = offset + utf16_len(&line[..found.start]) + lead;
        if scan.kind_at(at) == Some(MARKUP) {
            return true;
        }
    }
    false
}

fn code_mentions(scans: &[ScannedFile], pattern: &JsRegex) -> bool {
    scans
        .iter()
        .any(|file| pattern.is_match(file.scan.code.as_str()))
}

fn template_finding(scans: &[ScannedFile], profile: &SubmissionProfile) -> Option<Finding> {
    let recommended = profile.source.recommended_typst_templates?;
    let imported: Vec<String> = scans
        .iter()
        .flat_map(|file| extract_typst_templates(file.scan.masked.as_str()))
        .collect();
    if imported
        .iter()
        .any(|name| recommended.contains(&name.as_str()))
    {
        return None;
    }
    let known: HashSet<&str> = submission_profiles()
        .iter()
        .flat_map(|item| {
            item.source
                .recommended_typst_templates
                .unwrap_or(&[])
                .iter()
                .copied()
        })
        .collect();
    let actual = imported.iter().find(|name| known.contains(name.as_str()));
    let expected = recommended.join(" or ");
    let detail = match actual {
        Some(actual) => msg!(
            "rules.submission-document-class.detailTypst",
            "expected" => expected,
            "actual" => actual
        ),
        None => {
            msg!("rules.submission-document-class.detailNoTemplateTypst", "expected" => expected)
        }
    };
    Some(make(
        "submission-document-class",
        Lens::Submission,
        Severity::Warning,
        msg!("rules.submission-document-class.titleTypst", "profile" => profile.label),
        detail,
        None,
        Certainty::Advisory,
    ))
}

static ABSTRACT_CODE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(concat!(
        r"(?<![\p{L}\p{N}_.-])abstract[\p{L}\p{N}_-]*\s*",
        r"(?::(?!\s*(?:\(\s*\)|none(?![0-9A-Za-z_])))|[(\[])",
    ))
});
static ABSTRACT_HEADING: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^([ \t]*)=+[ \t]+Abstract(?-u:\b)"));
static KEYWORDS_ARGUMENT: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(
        r"(?<![\p{L}\p{N}_.-])(?:keywords|index-terms)\s*:(?!\s*(?:\(\s*\)|none(?![0-9A-Za-z_])))",
    )
});
static KEYWORDS_CALL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![\p{L}\p{N}_.-])[\p{L}-]*keywords\s*\("));
static KEYWORDS_HEADING: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^([ \t]*)(?:=+[ \t]+)?(?:Keywords|Index Terms)(?-u:\b)"));

fn structure_findings(scans: &[ScannedFile], profile: &SubmissionProfile) -> Vec<Finding> {
    let mut out = Vec::new();
    out.extend(template_finding(scans, profile));
    let has_abstract = code_mentions(scans, &ABSTRACT_CODE)
        || scans
            .iter()
            .any(|file| markup_lines(&file.scan, &ABSTRACT_HEADING));
    if profile.source.require_abstract == Some(true) && !has_abstract {
        out.push(make(
            "submission-no-abstract",
            Lens::Submission,
            Severity::Warning,
            message("rules.submission-no-abstract.title"),
            message("rules.submission-no-abstract.detailTypst"),
            None,
            Certainty::Advisory,
        ));
    }
    let has_keywords = code_mentions(scans, &KEYWORDS_ARGUMENT)
        || code_mentions(scans, &KEYWORDS_CALL)
        || scans
            .iter()
            .any(|file| markup_lines(&file.scan, &KEYWORDS_HEADING));
    if profile.source.require_keywords == Some(true) && !has_keywords {
        out.push(make(
            "submission-no-keywords",
            Lens::Submission,
            Severity::Warning,
            message("rules.submission-no-keywords.title"),
            msg!("rules.submission-no-keywords.detailTypst", "profile" => profile.label),
            None,
            Certainty::Advisory,
        ));
    }
    out
}

static LOREM_CALL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![\p{L}\p{N}_.-])lorem\s*\("));
static LOREM_TEXT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)(?-u:\b)lorem ipsum(?-u:\b)"));

fn placeholder_findings(scans: &[ScannedFile]) -> Vec<Finding> {
    let placeholder = scans.iter().any(|file| {
        LOREM_CALL.is_match(file.scan.code.as_str())
            || LOREM_TEXT.is_match(file.scan.markup.as_str())
    });
    if !placeholder {
        return Vec::new();
    }
    vec![make(
        "submission-placeholder",
        Lens::Submission,
        Severity::Warning,
        message("rules.submission-placeholder.title"),
        message("rules.submission-placeholder.detailTypst"),
        None,
        Certainty::Advisory,
    )]
}

fn missing_path_finding(
    reference: &TypstPathReference,
    path: &str,
    exact: &HashSet<String>,
    folded: &HashMap<String, String>,
) -> Option<Finding> {
    if !matches!(
        reference.kind,
        TypstPathKind::Image | TypstPathKind::Include
    ) {
        return None;
    }
    if is_external_typst_path(&reference.raw) {
        return None;
    }
    let resolved = resolve_typst_path(Some(path), &reference.raw);
    if resolved
        .as_ref()
        .is_some_and(|resolved| exact.contains(resolved))
    {
        return None;
    }
    let kind = if reference.kind == TypstPathKind::Image {
        "Figure"
    } else {
        "Include"
    };
    let case_match = resolved
        .as_ref()
        .and_then(|resolved| folded.get(&resolved.to_lowercase()));
    Some(match case_match {
        Some(case_match) => make(
            "submission-path-case",
            Lens::Submission,
            Severity::Error,
            msg!("rules.submission-path-case.title", "target" => &reference.raw),
            msg!(format!("rules.submission-path-case.detail{kind}"), "match" => case_match),
            Some(path),
            Certainty::Verified,
        ),
        None => make(
            "submission-missing-project-file",
            Lens::Submission,
            Severity::Error,
            msg!(format!("rules.submission-missing-project-file.title{kind}"), "target" => &reference.raw),
            msg!("rules.submission-missing-project-file.detail", "file" => path),
            Some(path),
            Certainty::Verified,
        ),
    })
}

fn project_path(file: &ProjectFile) -> String {
    normalize_project_path(&file.path).unwrap_or_else(|| file.path.clone())
}

fn path_findings(
    scans: &[ScannedFile],
    project: &ProjectContext,
    profile: &SubmissionProfile,
) -> Vec<Finding> {
    if profile.source.exact_case_paths != Some(true) {
        return Vec::new();
    }
    let paths: Vec<String> = project.files.iter().map(project_path).collect();
    let exact: HashSet<String> = paths.iter().cloned().collect();
    let folded: HashMap<String, String> = paths
        .iter()
        .map(|path| (path.to_lowercase(), path.clone()))
        .collect();
    let mut out = Vec::new();
    for file in scans {
        for reference in typst_path_references(&file.scan) {
            out.extend(missing_path_finding(
                &reference, &file.path, &exact, &folded,
            ));
        }
    }
    out
}

static TABLE_KIND: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^table(?-u:\b)"));
static TABLE_CALL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^table\s*\("));
static TABLE_CONTENT: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^\s*#table\s*\("));

fn is_table_figure(scan: &TypstScan, call: &TypstCall) -> bool {
    if let Some(kind) = named_argument(call, "kind") {
        if TABLE_KIND.is_match(&scan.code.slice(kind.value_from, kind.value_to)) {
            return true;
        }
    }
    let Some(body) = positional_argument(scan, call, 0) else {
        return false;
    };
    let code = scan.code.slice(body.value_from, body.value_to);
    if TABLE_CALL.is_match(&code) {
        return true;
    }
    code.starts_with('[')
        && TABLE_CONTENT.is_match(&scan.text.slice(body.value_from + 1, body.value_to))
}

fn caption_findings(scans: &[ScannedFile]) -> Vec<Finding> {
    let mut out = Vec::new();
    for file in scans {
        for figure in typst_calls(&file.scan, &["figure"]) {
            if let Some(caption) = named_argument(&figure, "caption") {
                if !is_blank_value(&file.scan, caption.value_from, caption.value_to) {
                    continue;
                }
            }
            let title = if is_table_figure(&file.scan, &figure) {
                "rules.submission-missing-caption.titleTable"
            } else {
                "rules.submission-missing-caption.titleFigure"
            };
            out.push(make(
                "submission-missing-caption",
                Lens::Submission,
                Severity::Warning,
                message(title),
                message("rules.submission-missing-caption.detail"),
                Some(&file.path),
                Certainty::Verified,
            ));
        }
    }
    out
}

/// Indexes into `files` of the images the Typst files reference, in first
/// reference order.
fn referenced_image_files(scans: &[ScannedFile], files: &[ProjectFile]) -> Vec<usize> {
    let by_lower: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .map(|(index, file)| (project_path(file).to_lowercase(), index))
        .collect();
    let mut seen = Vec::new();
    for file in scans {
        for reference in typst_path_references(&file.scan) {
            if reference.kind != TypstPathKind::Image {
                continue;
            }
            let found = resolve_typst_path(Some(&file.path), &reference.raw)
                .and_then(|resolved| by_lower.get(&resolved.to_lowercase()).copied());
            if let Some(index) = found {
                if !seen.contains(&index) {
                    seen.push(index);
                }
            }
        }
    }
    seen
}

/// Project paths of the images the Typst sources reference.
pub fn typst_referenced_images(project: &ProjectContext) -> Vec<String> {
    referenced_image_files(&typst_files(project), &project.files)
        .into_iter()
        .map(|index| project.files[index].path.clone())
        .collect()
}

fn large_image_findings(scans: &[ScannedFile], project: &ProjectContext) -> Vec<Finding> {
    referenced_image_files(scans, &project.files)
        .into_iter()
        .map(|index| &project.files[index])
        .filter(|file| file.size.unwrap_or(0) > LARGE_IMAGE_BYTES)
        .map(|file| {
            make(
                "submission-large-image",
                Lens::Submission,
                Severity::Warning,
                msg!("rules.submission-large-image.title", "file" => &file.path),
                msg!("rules.submission-large-image.detail", "limit" => LARGE_IMAGE_LABEL),
                Some(&file.path),
                Certainty::Verified,
            )
        })
        .collect()
}

fn typst_internal_note(scan: &TypstScan) -> bool {
    scan.comments
        .iter()
        .any(|&(from, to)| INTERNAL_COMMENT_TERMS.is_match(&scan.text.slice(from, to)))
}

static ANY_LETTER: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"\p{L}"));
static ANONYMOUS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)anonymous|omitted|blind review"));

fn identifying_value(scan: &TypstScan, from: usize, to: usize) -> bool {
    if is_blank_value(scan, from, to) {
        return false;
    }
    let text = scan.text.slice(from, to);
    ANY_LETTER.is_match(&text) && !ANONYMOUS.is_match(&text)
}

fn names_authors(scan: &TypstScan) -> bool {
    let mut calls = typst_calls(scan, &["document"]);
    calls.extend(typst_template_calls(scan));
    calls.iter().any(|call| {
        ["author", "authors", "affiliation", "affiliations"]
            .iter()
            .any(|name| {
                named_argument(call, name)
                    .is_some_and(|arg| identifying_value(scan, arg.value_from, arg.value_to))
            })
    })
}

fn email_local_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit))
        .is_some_and(|ch| ch.is_ascii_alphanumeric() || "._%+-".contains(ch))
}

static EMAIL_DOMAIN: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"));

fn email_domain_end(text: &SourceText, from: usize) -> Option<usize> {
    let byte = text.byte_at(from);
    let found = EMAIL_DOMAIN.first_str(&text.as_str()[byte..])?;
    Some(text.utf16_at(byte + found.end))
}

/// The first `local@domain.tld` in `text`, as UTF-16 offsets.
fn find_email(text: &SourceText) -> Option<(usize, usize)> {
    let units = text.units();
    let at_sign = b'@' as u16;
    for at in units
        .iter()
        .enumerate()
        .filter(|(_, &unit)| unit == at_sign)
        .map(|(index, _)| index)
    {
        let mut from = at;
        while from > 0 && email_local_unit(units[from - 1]) {
            from -= 1;
        }
        if from < at {
            if let Some(to) = email_domain_end(text, at + 1) {
                return Some((from, to));
            }
        }
    }
    None
}

static ACKNOWLEDGEMENTS_HEADING: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^([ \t]*)=+[ \t]+Acknowledg"));
static ACKNOWLEDGEMENTS_ARGUMENT: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(
        r"(?i)(?<![\p{L}\p{N}_.-])acknowledge?ments?\s*:(?!\s*(?:\(\s*\)|none(?![0-9A-Za-z_])))",
    )
});

fn blind_review_findings(scans: &[ScannedFile], pdf: Option<&PdfFacts>) -> Vec<Finding> {
    let mut out = Vec::new();
    if scans.iter().any(|file| names_authors(&file.scan)) {
        out.push(make(
            "privacy-blind-author",
            Lens::Privacy,
            Severity::Error,
            message("rules.privacy-blind-author.title"),
            message("rules.privacy-blind-author.detailTypst"),
            None,
            Certainty::Verified,
        ));
    }
    for file in scans {
        let Some((from, to)) = find_email(&file.scan.masked) else {
            continue;
        };
        out.push(
            make(
                "privacy-blind-email",
                Lens::Privacy,
                Severity::Error,
                msg!("rules.privacy-blind-email.title", "file" => &file.path),
                message("rules.privacy-blind-email.detail"),
                Some(&file.path),
                Certainty::Verified,
            )
            .with_range(from, to),
        );
    }
    let acknowledgements = scans.iter().any(|file| {
        markup_lines(&file.scan, &ACKNOWLEDGEMENTS_HEADING)
            || ACKNOWLEDGEMENTS_ARGUMENT.is_match(file.scan.code.as_str())
    });
    if acknowledgements {
        out.push(make(
            "privacy-blind-acknowledgements",
            Lens::Privacy,
            Severity::Warning,
            message("rules.privacy-blind-acknowledgements.title"),
            message("rules.privacy-blind-acknowledgements.detail"),
            None,
            Certainty::Advisory,
        ));
    }
    out.extend(pdf_author_findings(pdf));
    out
}

fn privacy_findings(
    scans: &[ScannedFile],
    project: &ProjectContext,
    pdf: Option<&PdfFacts>,
    anonymous_review: bool,
) -> Vec<Finding> {
    // `new Map(...)`: a later file with the same path wins.
    let scanned: HashMap<&str, &TypstScan> = scans
        .iter()
        .map(|file| (file.path.as_str(), &file.scan))
        .collect();
    let mut out: Vec<Finding> = project
        .files
        .iter()
        .flat_map(|file| match scanned.get(file.path.as_str()) {
            Some(scan) => file_privacy_findings(file, &|_| typst_internal_note(scan)),
            None => file_privacy_findings(file, &has_internal_comment),
        })
        .collect();
    if anonymous_review {
        out.extend(blind_review_findings(scans, pdf));
    }
    out
}

pub fn run_typst_submission_rules(input: &SubmissionRuleInput) -> Vec<Finding> {
    let profile = submission_profile(input.profile_id);
    let project = input.project;
    let scans = typst_files(project);
    let mut out = Vec::new();
    if profile.source.portable_file_names == Some(true) {
        out.extend(portable_name_findings(project));
    }
    out.extend(generated_file_findings(project));
    out.extend(structure_findings(&scans, profile));
    out.extend(placeholder_findings(&scans));
    out.extend(pdf_submission_findings(profile, input.pdf));
    out.extend(path_findings(&scans, project, profile));
    out.extend(caption_findings(&scans));
    out.extend(large_image_findings(&scans, project));
    out.extend(privacy_findings(
        &scans,
        project,
        input.pdf,
        input.anonymous_review,
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::SubmissionProfileId;

    fn typ(path: &str, content: &str) -> ProjectFile {
        ProjectFile {
            path: path.into(),
            content: Some(content.into()),
            size: None,
        }
    }

    fn run(
        files: Vec<ProjectFile>,
        profile_id: SubmissionProfileId,
        anonymous_review: bool,
    ) -> Vec<Finding> {
        let project = ProjectContext {
            main_file: "main.typ".into(),
            files,
        };
        run_typst_submission_rules(&SubmissionRuleInput {
            project: &project,
            profile_id,
            pdf: None,
            anonymous_review,
        })
    }

    #[test]
    fn emails_in_markup_are_blind_review_findings_with_a_range() {
        let found = run(
            vec![typ("main.typ", "Write to ana@example.com.")],
            SubmissionProfileId::Generic,
            true,
        );
        let email = found
            .iter()
            .find(|f| f.id == "privacy-blind-email")
            .unwrap();
        assert_eq!((email.from, email.to), (Some(9), Some(24)));
    }

    #[test]
    fn figures_without_captions_and_lorem_are_reported() {
        let found = run(
            vec![typ(
                "main.typ",
                "#figure(table(columns: 2)[a][b])\n#lorem(5)",
            )],
            SubmissionProfileId::Generic,
            false,
        );
        let caption = found
            .iter()
            .find(|f| f.id == "submission-missing-caption")
            .unwrap();
        assert_eq!(
            caption.title.key,
            "rules.submission-missing-caption.titleTable"
        );
        assert!(found.iter().any(|f| f.id == "submission-placeholder"));
    }

    #[test]
    fn ieee_profile_wants_its_template() {
        let found = run(
            vec![typ("main.typ", "= Abstract\nx")],
            SubmissionProfileId::Ieee,
            false,
        );
        let ids: Vec<_> = found.iter().map(|f| f.id.as_str()).collect();
        assert!(ids.contains(&"submission-document-class"));
        assert!(!ids.contains(&"submission-no-abstract"));
        assert!(ids.contains(&"submission-no-keywords"));
    }
}
