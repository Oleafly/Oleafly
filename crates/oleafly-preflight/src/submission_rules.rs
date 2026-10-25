//! Submission and privacy rules (`packages/preflight/src/submission-rules.ts`).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::mask::mask_comments;
use crate::messages::{message, MessageRef};
use crate::msg;
use crate::profiles::{
    extract_document_class, submission_profile, SubmissionProfile, SubmissionProfileId,
};
use crate::text::{is_js_space, js_trim, strip_optional_each_end};
use crate::types::{Certainty, Finding, Lens, PdfFacts, ProjectContext, ProjectFile, Severity};

const SOURCE_EXTENSIONS: &[&str] = &[".tex", ".ltx", ".sty", ".cls"];
const GRAPHICS_EXTENSIONS: &[&str] = &[
    "", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ps", ".eps", ".svg",
];
const INPUT_EXTENSIONS: &[&str] = &["", ".tex"];
const SENSITIVE_EXTENSIONS: &[&str] = &[".pem", ".key", ".p12", ".pfx"];

static PORTABLE_NAME: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^[A-Za-z0-9_+.,=/-]+$"));
static GENERATED_FILE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"(?i)(?:^|/)(?:[^/]+\.(?:aux|log|out|toc|fls|fdb_latexmk|synctex(?:\.gz)?))$")
});
static EXTERNAL_TARGET: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^(?:https?:|data:)"));
static INCLUDE_GRAPHICS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\includegraphics\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}"));
static INPUT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\(?:input|include)\s*\{([^}]*)\}"));
static FLOAT_BEGIN: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\begin\{(figure\*?|table\*?)\}"));
static CAPTION: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\caption(?:\[[^\]]*\])?\s*\{"));
static LABEL_START: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"\\label\s*\{"));

static SECRET_PATTERNS: LazyLock<Vec<JsRegex>> = LazyLock::new(|| {
    vec![
        JsRegex::std(r"(?-u:\b)sk-(?:proj-)?[A-Za-z0-9_-]{20,}(?-u:\b)"),
        JsRegex::std(r"(?-u:\b)gh[pousr]_[A-Za-z0-9]{20,}(?-u:\b)"),
        JsRegex::std(r"(?-u:\b)AKIA[0-9A-Z]{16}(?-u:\b)"),
        JsRegex::std(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"),
    ]
});

/// `TODO`, `FIXME`, `CONFIDENTIAL`, `INTERNAL ONLY`, `DO NOT DISTRIBUTE`.
pub static INTERNAL_COMMENT_TERMS: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"(?i)(?-u:\b)(?:TODO|FIXME|CONFIDENTIAL|INTERNAL ONLY|DO NOT DISTRIBUTE)(?-u:\b)")
});
static SOURCE_LINE_BREAK: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std("\r\n|[\n\r\u{2028}\u{2029}]"));

static AUTHOR_SOURCE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)\\(?:author|IEEEauthorblockN|affiliation|address|email|thanks)",
        r"\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}",
    ))
});
static ANONYMOUS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)anonymous|omitted|blind review"));
static ACKNOWLEDGEMENTS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\\(?:section\*?|begin)\s*\{?acknowledg"));
static DRAFT_ARTIFACT: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)\\usepackage(?:\[[^\]]*\])?\{(?:draftwatermark|todonotes|showkeys|changes)\}",
        r"|\\todo\s*\{|\\documentclass\s*\[[^\]]*(?-u:\b)draft(?-u:\b)",
    ))
});
static ABSOLUTE_PATH: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"(?m)(?:^|[={\s])(?:/[A-Za-z0-9._-]+){2,}|[A-Za-z]:\\[^\s}\]]+")
});
static SHELL_ESCAPE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)\\(?:immediate\s*)?write18(?-u:\b)|\\ShellEscape(?-u:\b)",
        r"|\\usepackage(?:\[[^\]]*\])?\{(?:minted|pythontex|sagetex)\}",
    ))
});
static ABSTRACT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\\begin\{abstract\}[\s\S]*?\\end\{abstract\}"));
static KEYWORDS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\\keywords\s*\{|\\begin\{IEEEkeywords\}"));
static PLACEHOLDER: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)(?-u:\b)(?:TODO|TBD|FIXME|Lorem ipsum)(?-u:\b)|\?\?+"));

pub(crate) fn extension(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) => name[dot..].to_lowercase(),
        None => String::new(),
    }
}

fn directory(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[..=slash],
        None => "",
    }
}

/// `..` above the root is dropped rather than refused, as in the TypeScript.
pub(crate) fn normalize(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    parts.join("/")
}

fn is_sensitive_file(path: &str) -> bool {
    let normalized = normalize(path);
    let name = normalized.rsplit('/').next().unwrap_or("").to_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name == "id_rsa"
        || name == "id_ed25519"
        || SENSITIVE_EXTENSIONS.contains(&extension(&name).as_str())
}

fn referenced_candidates(source_file: &str, target: &str, extensions: &[&str]) -> Vec<String> {
    let clean = strip_optional_each_end(js_trim(target), '{', '}');
    let bases: Vec<String> = if clean.starts_with('/') {
        vec![clean.to_string()]
    } else {
        vec![
            format!("{}{clean}", directory(source_file)),
            clean.to_string(),
        ]
    };
    let mut out: Vec<String> = Vec::new();
    for base in &bases {
        for ext in extensions {
            let candidate = normalize(&format!("{base}{ext}"));
            if !out.contains(&candidate) {
                out.push(candidate);
            }
        }
    }
    out
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

fn source_files(project: &ProjectContext) -> Vec<&ProjectFile> {
    project
        .files
        .iter()
        .filter(|file| {
            file.content.is_some() && SOURCE_EXTENSIONS.contains(&extension(&file.path).as_str())
        })
        .collect()
}

fn source_corpus(project: &ProjectContext) -> String {
    source_files(project)
        .iter()
        .map(|file| mask_comments(file.content.as_deref().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Copy)]
enum ReferenceKind {
    Figure,
    Include,
}

fn check_project_references(
    project: &ProjectContext,
    profile_id: SubmissionProfileId,
) -> Vec<Finding> {
    let profile = submission_profile(profile_id);
    if profile.source.exact_case_paths != Some(true) {
        return Vec::new();
    }
    let paths: Vec<String> = project
        .files
        .iter()
        .map(|file| normalize(&file.path))
        .collect();
    let exact: HashSet<&str> = paths.iter().map(String::as_str).collect();
    // `new Map(...)`: a later path with the same lower-case spelling wins.
    let folded: HashMap<String, &str> = paths
        .iter()
        .map(|path| (path.to_lowercase(), path.as_str()))
        .collect();
    let mut out = Vec::new();
    let mut inspect = |file: &ProjectFile,
                       regex: &JsRegex,
                       extensions: &[&str],
                       kind: ReferenceKind| {
        let content = mask_comments(file.content.as_deref().unwrap_or(""));
        let (found, _) = regex.captures_str(&content);
        for reference in found {
            let target = js_trim(reference.group(&content, 1).unwrap_or(""));
            if EXTERNAL_TARGET.is_match(target) {
                continue;
            }
            let candidates = referenced_candidates(&file.path, target, extensions);
            if candidates
                .iter()
                .any(|candidate| exact.contains(candidate.as_str()))
            {
                continue;
            }
            let case_match = candidates
                .iter()
                .find_map(|candidate| folded.get(&candidate.to_lowercase()).copied());
            let suffix = match kind {
                ReferenceKind::Figure => "Figure",
                ReferenceKind::Include => "Include",
            };
            out.push(match case_match {
                Some(case_match) => make(
                    "submission-path-case",
                    Lens::Submission,
                    Severity::Error,
                    msg!("rules.submission-path-case.title", "target" => target),
                    msg!(format!("rules.submission-path-case.detail{suffix}"), "match" => case_match),
                    Some(&file.path),
                    Certainty::Verified,
                ),
                None => make(
                    "submission-missing-project-file",
                    Lens::Submission,
                    Severity::Error,
                    msg!(format!("rules.submission-missing-project-file.title{suffix}"), "target" => target),
                    msg!("rules.submission-missing-project-file.detail", "file" => &file.path),
                    Some(&file.path),
                    Certainty::Verified,
                ),
            });
        }
    };
    for file in source_files(project) {
        inspect(
            file,
            &INCLUDE_GRAPHICS,
            GRAPHICS_EXTENSIONS,
            ReferenceKind::Figure,
        );
        inspect(file, &INPUT, INPUT_EXTENSIONS, ReferenceKind::Include);
    }
    out
}

/// `\begin{NAME}…\end{NAME}` for figure and table floats, ported by hand
/// because the TypeScript uses a back-reference: each `\begin{NAME}` pairs
/// with the first literal `\end{NAME}` after it; without one the search
/// resumes after the `\begin`.
fn float_environments(content: &str) -> Vec<(String, std::ops::Range<usize>)> {
    let mut out = Vec::new();
    let mut position = 0;
    while let Some(begin) = FLOAT_BEGIN.first_str_at(content, position) {
        let name = begin.group(content, 1).unwrap_or("").to_string();
        let end_marker = format!("\\end{{{name}}}");
        match content[begin.end..].find(&end_marker) {
            Some(at) => {
                let body_end = begin.end + at;
                out.push((name, begin.end..body_end));
                position = body_end + end_marker.len();
            }
            None => {
                position = begin.start
                    + content[begin.start..]
                        .chars()
                        .next()
                        .map_or(1, char::len_utf8);
            }
        }
    }
    out
}

fn check_figures_and_tables(project: &ProjectContext) -> Vec<Finding> {
    let mut out = Vec::new();
    for file in source_files(project) {
        let content = mask_comments(file.content.as_deref().unwrap_or(""));
        for (name, body_range) in float_environments(&content) {
            let body = &content[body_range];
            let caption_at = CAPTION.first_str(body).map(|found| found.start);
            if caption_at.is_none() {
                let title = if name.replace('*', "") == "table" {
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
            let label_at = LABEL_START.first_str(body).map(|found| found.start);
            if let (Some(label_at), Some(caption_at)) = (label_at, caption_at) {
                if label_at < caption_at {
                    out.push(make(
                        "submission-label-before-caption",
                        Lens::Refs,
                        Severity::Warning,
                        message("rules.submission-label-before-caption.title"),
                        message("rules.submission-label-before-caption.detail"),
                        Some(&file.path),
                        Certainty::Verified,
                    ));
                }
            }
        }
    }
    out
}

/// Whether a whole-line `%` comment names an internal note.
pub fn has_internal_comment(content: &str) -> bool {
    let (breaks, _) = SOURCE_LINE_BREAK.captures_str(content);
    let mut start = 0;
    let mut lines = Vec::with_capacity(breaks.len() + 1);
    for found in breaks {
        lines.push(&content[start..found.start]);
        start = found.end;
    }
    lines.push(&content[start..]);
    lines.into_iter().any(|line| {
        let first = line.chars().find(|&ch| !is_js_space(ch));
        first == Some('%') && INTERNAL_COMMENT_TERMS.is_match(line)
    })
}

/// Sensitive file names, credentials and internal notes in one file. The
/// credential finding names the file only, never the secret.
pub fn file_privacy_findings(
    file: &ProjectFile,
    internal_note: &dyn Fn(&str) -> bool,
) -> Vec<Finding> {
    let mut out = Vec::new();
    if is_sensitive_file(&file.path) {
        out.push(make(
            "privacy-sensitive-file",
            Lens::Privacy,
            Severity::Error,
            msg!("rules.privacy-sensitive-file.title", "file" => &file.path),
            message("rules.privacy-sensitive-file.detail"),
            Some(&file.path),
            Certainty::Verified,
        ));
    }
    let content = file.content.as_deref().unwrap_or("");
    if content.is_empty() {
        return out;
    }
    if SECRET_PATTERNS
        .iter()
        .any(|pattern| pattern.is_match(content))
    {
        out.push(make(
            "privacy-credential",
            Lens::Privacy,
            Severity::Error,
            msg!("rules.privacy-credential.title", "file" => &file.path),
            message("rules.privacy-credential.detail"),
            Some(&file.path),
            Certainty::Verified,
        ));
    }
    if internal_note(content) {
        out.push(make(
            "privacy-internal-comment",
            Lens::Privacy,
            Severity::Warning,
            msg!("rules.privacy-internal-comment.title", "file" => &file.path),
            message("rules.privacy-internal-comment.detail"),
            Some(&file.path),
            Certainty::Advisory,
        ));
    }
    out
}

fn blind_review_findings(source: &str, pdf: Option<&PdfFacts>) -> Vec<Finding> {
    let mut out = Vec::new();
    let (authors, _) = AUTHOR_SOURCE.captures_str(source);
    let identifying = authors
        .iter()
        .any(|found| !ANONYMOUS.is_match(found.group(source, 1).unwrap_or("")));
    if identifying {
        out.push(make(
            "privacy-blind-author",
            Lens::Privacy,
            Severity::Error,
            message("rules.privacy-blind-author.title"),
            message("rules.privacy-blind-author.detail"),
            None,
            Certainty::Verified,
        ));
    }
    if ACKNOWLEDGEMENTS.is_match(source) {
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

/// A PDF author that is not marked anonymous breaks blind review.
pub fn pdf_author_findings(pdf: Option<&PdfFacts>) -> Vec<Finding> {
    let Some(author) = pdf.and_then(|pdf| pdf.author.as_deref()) else {
        return Vec::new();
    };
    if author.is_empty() || ANONYMOUS.is_match(author) {
        return Vec::new();
    }
    vec![make(
        "privacy-pdf-author",
        Lens::Privacy,
        Severity::Error,
        message("rules.privacy-pdf-author.title"),
        msg!("rules.privacy-pdf-author.detail", "author" => author),
        None,
        Certainty::Verified,
    )]
}

fn check_privacy(
    project: &ProjectContext,
    pdf: Option<&PdfFacts>,
    anonymous_review: bool,
) -> Vec<Finding> {
    let mut out: Vec<Finding> = project
        .files
        .iter()
        .flat_map(|file| file_privacy_findings(file, &has_internal_comment))
        .collect();
    let source = source_corpus(project);
    if DRAFT_ARTIFACT.is_match(&source) {
        out.push(make(
            "privacy-draft-artifact",
            Lens::Privacy,
            Severity::Warning,
            message("rules.privacy-draft-artifact.title"),
            message("rules.privacy-draft-artifact.detail"),
            None,
            Certainty::Advisory,
        ));
    }
    if anonymous_review {
        out.extend(blind_review_findings(&source, pdf));
    }
    out
}

pub struct SubmissionRuleInput<'a> {
    pub project: &'a ProjectContext,
    pub profile_id: SubmissionProfileId,
    pub pdf: Option<&'a PdfFacts>,
    pub anonymous_review: bool,
}

pub fn portable_name_findings(project: &ProjectContext) -> Vec<Finding> {
    project
        .files
        .iter()
        .filter(|file| !PORTABLE_NAME.is_match(&file.path))
        .map(|file| {
            make(
                "submission-nonportable-filename",
                Lens::Submission,
                Severity::Error,
                msg!("rules.submission-nonportable-filename.title", "file" => &file.path),
                message("rules.submission-nonportable-filename.detail"),
                Some(&file.path),
                Certainty::Verified,
            )
        })
        .collect()
}

fn source_hygiene_findings(project: &ProjectContext) -> Vec<Finding> {
    let mut out = Vec::new();
    for file in source_files(project) {
        let content = mask_comments(file.content.as_deref().unwrap_or(""));
        if ABSOLUTE_PATH.is_match(&content) {
            out.push(make(
                "submission-absolute-path",
                Lens::Submission,
                Severity::Error,
                msg!("rules.submission-absolute-path.title", "file" => &file.path),
                message("rules.submission-absolute-path.detail"),
                Some(&file.path),
                Certainty::Verified,
            ));
        }
        if SHELL_ESCAPE.is_match(&content) {
            out.push(make(
                "submission-shell-escape",
                Lens::Submission,
                Severity::Warning,
                msg!("rules.submission-shell-escape.title", "file" => &file.path),
                message("rules.submission-shell-escape.detail"),
                Some(&file.path),
                Certainty::Advisory,
            ));
        }
    }
    out
}

pub fn generated_file_findings(project: &ProjectContext) -> Vec<Finding> {
    project
        .files
        .iter()
        .filter(|file| GENERATED_FILE.is_match(&file.path))
        .map(|file| {
            make(
                "submission-generated-file",
                Lens::Submission,
                Severity::Info,
                msg!("rules.submission-generated-file.title", "file" => &file.path),
                message("rules.submission-generated-file.detail"),
                Some(&file.path),
                Certainty::Advisory,
            )
        })
        .collect()
}

fn document_class_finding(source: &str, profile: &SubmissionProfile) -> Option<Finding> {
    let recommended = profile.source.recommended_document_classes?;
    let class = extract_document_class(source);
    if let Some(class) = &class {
        if recommended
            .iter()
            .any(|name| name.to_lowercase() == class.to_lowercase())
        {
            return None;
        }
    }
    let expected = recommended.join(" or ");
    let detail = match &class {
        Some(actual) => msg!(
            "rules.submission-document-class.detail",
            "expected" => expected,
            "actual" => actual
        ),
        None => msg!("rules.submission-document-class.detailNoClass", "expected" => expected),
    };
    Some(make(
        "submission-document-class",
        Lens::Submission,
        Severity::Error,
        msg!("rules.submission-document-class.title", "profile" => profile.label),
        detail,
        None,
        Certainty::Verified,
    ))
}

fn document_structure_findings(source: &str, profile: &SubmissionProfile) -> Vec<Finding> {
    let mut out = Vec::new();
    out.extend(document_class_finding(source, profile));
    if profile.source.require_abstract == Some(true) && !ABSTRACT.is_match(source) {
        out.push(make(
            "submission-no-abstract",
            Lens::Submission,
            Severity::Warning,
            message("rules.submission-no-abstract.title"),
            message("rules.submission-no-abstract.detail"),
            None,
            Certainty::Advisory,
        ));
    }
    if profile.source.require_keywords == Some(true) && !KEYWORDS.is_match(source) {
        out.push(make(
            "submission-no-keywords",
            Lens::Submission,
            Severity::Warning,
            message("rules.submission-no-keywords.title"),
            msg!("rules.submission-no-keywords.detail", "profile" => profile.label),
            None,
            Certainty::Advisory,
        ));
    }
    out
}

fn figure_format_findings(
    project: &ProjectContext,
    profile: &SubmissionProfile,
    allowed: &[&str],
) -> Vec<Finding> {
    let mut out = Vec::new();
    for file in source_files(project) {
        let content = mask_comments(file.content.as_deref().unwrap_or(""));
        let (found, _) = INCLUDE_GRAPHICS.captures_str(&content);
        for graphic in found {
            let target = js_trim(graphic.group(&content, 1).unwrap_or(""));
            let ext = extension(target);
            if !ext.is_empty() && !allowed.contains(&ext.as_str()) {
                out.push(make(
                    "submission-figure-format",
                    Lens::Submission,
                    Severity::Error,
                    msg!("rules.submission-figure-format.title", "file" => target),
                    msg!(
                        "rules.submission-figure-format.detail",
                        "profile" => profile.label,
                        "formats" => allowed.join(", ")
                    ),
                    Some(&file.path),
                    Certainty::Verified,
                ));
            }
        }
    }
    out
}

/// JavaScript `Number(text)` for the version strings PDFs carry.
fn js_number(text: &str) -> f64 {
    let trimmed = js_trim(text);
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

pub fn pdf_submission_findings(
    profile: &SubmissionProfile,
    pdf: Option<&PdfFacts>,
) -> Vec<Finding> {
    let Some(pdf) = pdf else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let label = profile.label;
    if let (Some(minimum), Some(version)) = (profile.pdf.minimum_version, pdf.version.as_deref()) {
        if !version.is_empty() && js_number(version) < js_number(minimum) {
            out.push(make(
                "submission-pdf-version",
                Lens::Submission,
                Severity::Error,
                msg!("rules.submission-pdf-version.title", "version" => version),
                msg!("rules.submission-pdf-version.detail", "profile" => label, "minimum" => minimum),
                None,
                Certainty::Verified,
            ));
        }
    }
    let forbidden = [
        (
            profile.pdf.forbid_bookmarks,
            pdf.outline_count > 0,
            "submission-bookmarks",
        ),
        (
            profile.pdf.forbid_links,
            pdf.link_count > 0,
            "submission-links",
        ),
        (
            profile.pdf.forbid_attachments,
            pdf.attachment_count > 0,
            "submission-attachments",
        ),
        (
            profile.pdf.forbid_restrictions,
            pdf.restricted == Some(true),
            "submission-security",
        ),
    ];
    for (rule, violated, id) in forbidden {
        if rule == Some(true) && violated {
            out.push(make(
                id,
                Lens::Submission,
                Severity::Error,
                message(&format!("rules.{id}.title")),
                msg!(format!("rules.{id}.detail"), "profile" => label),
                None,
                Certainty::Verified,
            ));
        }
    }
    if profile.pdf.require_embedded_fonts == Some(true) {
        let unembedded: Vec<&str> = pdf
            .fonts
            .iter()
            .filter(|font| font.embedded == Some(false))
            .map(|font| font.name.as_str())
            .collect();
        let unknown: Vec<&str> = pdf
            .fonts
            .iter()
            .filter(|font| font.embedded.is_none())
            .map(|font| font.name.as_str())
            .collect();
        if !unembedded.is_empty() {
            out.push(make(
                "submission-unembedded-font",
                Lens::Submission,
                Severity::Error,
                msg!("rules.submission-unembedded-font.title", "count" => unembedded.len()),
                msg!(
                    "rules.submission-unembedded-font.detail",
                    "profile" => label,
                    "fonts" => unembedded.iter().take(6).copied().collect::<Vec<_>>().join(", ")
                ),
                None,
                Certainty::Verified,
            ));
        } else if !unknown.is_empty() {
            out.push(make(
                "submission-font-inspection-incomplete",
                Lens::Submission,
                Severity::Info,
                message("rules.submission-font-inspection-incomplete.title"),
                msg!(
                    "rules.submission-font-inspection-incomplete.detail",
                    "fonts" => unknown.iter().take(6).copied().collect::<Vec<_>>().join(", ")
                ),
                None,
                Certainty::Manual,
            ));
        }
    }
    out
}

pub fn run_submission_rules(input: &SubmissionRuleInput) -> Vec<Finding> {
    let profile = submission_profile(input.profile_id);
    let project = input.project;
    let source = source_corpus(project);
    let mut out = Vec::new();
    if profile.source.portable_file_names == Some(true) {
        out.extend(portable_name_findings(project));
    }
    out.extend(source_hygiene_findings(project));
    out.extend(generated_file_findings(project));
    out.extend(document_structure_findings(&source, profile));
    if let Some(allowed) = profile.source.allowed_figure_extensions {
        out.extend(figure_format_findings(project, profile, allowed));
    }
    if PLACEHOLDER.is_match(&source) {
        out.push(make(
            "submission-placeholder",
            Lens::Submission,
            Severity::Warning,
            message("rules.submission-placeholder.title"),
            message("rules.submission-placeholder.detail"),
            None,
            Certainty::Advisory,
        ));
    }
    out.extend(pdf_submission_findings(profile, input.pdf));
    out.extend(check_project_references(project, input.profile_id));
    out.extend(check_figures_and_tables(project));
    out.extend(check_privacy(project, input.pdf, input.anonymous_review));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{render_detail, Catalog};

    fn project(files: Vec<ProjectFile>) -> ProjectContext {
        ProjectContext {
            main_file: "main.tex".into(),
            files,
        }
    }

    fn text_file(path: &str, content: &str) -> ProjectFile {
        ProjectFile {
            path: path.into(),
            content: Some(content.into()),
            size: None,
        }
    }

    #[test]
    fn credential_value_is_never_in_the_finding() {
        let project = project(vec![text_file(
            "keys.tex",
            "token sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        )]);
        let found = run_submission_rules(&SubmissionRuleInput {
            project: &project,
            profile_id: SubmissionProfileId::Generic,
            pdf: None,
            anonymous_review: false,
        });
        let catalog = Catalog::preflight();
        let text = serde_json::to_string(&found).unwrap()
            + &found
                .iter()
                .map(|f| catalog.render(&f.title) + &render_detail(catalog, f))
                .collect::<String>();
        assert!(found.iter().any(|f| f.id == "privacy-credential") && !text.contains("sk-proj-"));
    }

    #[test]
    fn a_figure_without_its_end_is_skipped_like_the_backreference() {
        let project = project(vec![text_file("main.tex", "\\begin{figure}x")]);
        let found = run_submission_rules(&SubmissionRuleInput {
            project: &project,
            profile_id: SubmissionProfileId::Generic,
            pdf: None,
            anonymous_review: false,
        });
        assert!(found.iter().all(|f| f.id != "submission-missing-caption"));
    }

    #[test]
    fn floats_pair_with_their_own_end() {
        let found = float_environments(
            "\\begin{figure*}a\\end{figure}b\\end{figure*}\\begin{table}c\\end{table}",
        );
        let names: Vec<_> = found.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, vec!["figure*", "table"]);
    }

    #[test]
    fn whole_line_comments_with_terms_are_internal_notes() {
        assert!(has_internal_comment("x\n  % TODO: fix\n"));
        assert!(!has_internal_comment("text % TODO inline\n"));
    }

    #[test]
    fn referenced_candidates_strip_braces_and_keep_the_directory() {
        assert_eq!(
            referenced_candidates("sections/a.tex", "{figs/x}", &["", ".png"]),
            vec![
                "sections/figs/x",
                "sections/figs/x.png",
                "figs/x",
                "figs/x.png"
            ]
        );
    }
}
