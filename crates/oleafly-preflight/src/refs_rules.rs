use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::bib::{
    bibliography_candidate_paths, bibliography_declarations, bibliography_display_name,
    bibliography_engine_for_command, missing_bibtex_required_fields, resolve_bibliography_path,
    BibliographyEngine, ParsedBib,
};
use crate::jsre::JsRegex;
use crate::mask::mask_comments;
use crate::messages::message;
use crate::msg;
use crate::text::{is_letter_or_number, js_trim, utf16_len, SourceText};
use crate::types::{Certainty, Finding, Lens, Severity};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnresolvedBibliography {
    pub file: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DuplicateDoi {
    pub doi: String,
    pub keys: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DuplicateLabel {
    pub label: String,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnreferencedLabel {
    pub label: String,
    pub file: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BibKeyDefinition {
    pub key: String,
    pub file: String,
    pub line: u32,
    pub from: usize,
    pub to: usize,
}

/// How the project's bibliography tool compares keys: BibTeX ignores letter
/// case, biber and Typst keep `Smith2020` and `smith2020` apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BibKeyDialect {
    Bibtex,
    Biber,
    Typst,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsContext {
    #[serde(default)]
    pub defined_labels: Vec<String>,
    #[serde(default)]
    pub bib_keys: Vec<String>,
    #[serde(default)]
    pub bib_loaded: bool,
    #[serde(default)]
    pub project_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unresolved_bibliographies: Option<Vec<UnresolvedBibliography>>,
    #[serde(default)]
    pub duplicate_dois: Vec<DuplicateDoi>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bib_entries: Option<Vec<ParsedBib>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_cited_keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_labels: Option<Vec<DuplicateLabel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unreferenced_labels: Option<Vec<UnreferencedLabel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bib_key_definitions: Option<Vec<BibKeyDefinition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bib_key_dialect: Option<BibKeyDialect>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefsOptions {
    pub include_project_quality: bool,
    pub file: Option<String>,
}

impl Default for RefsOptions {
    fn default() -> Self {
        Self {
            include_project_quality: true,
            file: None,
        }
    }
}

const GRAPHICS_EXT: &[&str] = &["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];
const INPUT_EXT: &[&str] = &["", ".tex"];

static CITE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)",
        r"\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}",
    ))
});
static REF: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"\\(?:ref|eqref|autoref|cref|Cref|cpageref|pageref|vref|labelcref)\s*\{([^}]*)\}")
});
static LABEL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"\\label\s*\{([^}]*)\}"));
static GRAPHICS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\includegraphics\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}"));
static INPUT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\(?:input|include)\s*\{([^}]*)\}"));
static DOI_PREFIX: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^https?://(?:dx\.)?doi\.org/"));
static DOI_SHAPE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)^10\.[0-9]{4,9}/\S+$"));

fn resolves(reference: &str, files: &[String], extensions: &[&str]) -> bool {
    let trimmed = js_trim(reference);
    let target = trimmed.strip_prefix("./").unwrap_or(trimmed);
    let base = target.rsplit('/').next().unwrap_or(target);
    extensions.iter().any(|ext| {
        let with_ext = format!("{target}{ext}");
        let base_with_ext = format!("{base}{ext}");
        let nested = format!("/{with_ext}");
        let nested_base = format!("/{base_with_ext}");
        files.iter().any(|file| {
            *file == with_ext
                || file.ends_with(&nested)
                || *file == base_with_ext
                || file.ends_with(&nested_base)
        })
    })
}

pub fn plain(value: &str) -> String {
    let replaced: String = value
        .chars()
        .map(|ch| {
            if matches!(ch, '{' | '}' | '\\') {
                ' '
            } else {
                ch
            }
        })
        .collect();
    let mut collapsed = String::with_capacity(replaced.len());
    let mut in_run = false;
    for ch in replaced.chars() {
        if is_letter_or_number(ch) {
            collapsed.push(ch);
            in_run = false;
        } else if !in_run {
            collapsed.push(' ');
            in_run = true;
        }
    }
    js_trim(&collapsed).to_lowercase()
}

const CITABLE_MINIMUM: &[&[&str]] = &[&["title"], &["year", "date"]];

fn required_fields(entry: &ParsedBib) -> Vec<String> {
    let present: BTreeSet<String> = entry
        .fields
        .iter()
        .filter(|(_, value)| !js_trim(value).is_empty())
        .map(|(name, _)| name.clone())
        .collect();
    let mut groups: Vec<String> = Vec::new();
    let missing = missing_bibtex_required_fields(&entry.r#type, &present);
    let citable = CITABLE_MINIMUM
        .iter()
        .copied()
        .filter(|group| !group.iter().any(|name| present.contains(*name)));
    for group in missing.into_iter().chain(citable) {
        let joined = group.join("/");
        if !groups.contains(&joined) {
            groups.push(joined);
        }
    }
    groups
}

fn incomplete_metadata_finding(entries: &[ParsedBib]) -> Option<Finding> {
    let incomplete: Vec<(String, Vec<String>)> = entries
        .iter()
        .map(|entry| (entry.key.clone(), required_fields(entry)))
        .filter(|(_, missing)| !missing.is_empty())
        .collect();
    if incomplete.is_empty() {
        return None;
    }
    let examples = incomplete
        .iter()
        .take(5)
        .map(|(key, missing)| format!("{key}: {}", missing.join(", ")))
        .collect::<Vec<_>>()
        .join(" · ");
    let detail = if incomplete.len() > 5 {
        "rules.refs-incomplete-metadata.detailTruncated"
    } else {
        "rules.refs-incomplete-metadata.detail"
    };
    Some(
        Finding::new(
            "refs-incomplete-metadata",
            Lens::Refs,
            Severity::Warning,
            msg!("rules.refs-incomplete-metadata.title", "count" => incomplete.len()),
            msg!(detail, "examples" => examples),
        )
        .with_certainty(Certainty::Verified),
    )
}

fn replace_first(regex: &JsRegex, text: &str) -> String {
    match regex.first_str(text) {
        Some(found) => format!("{}{}", &text[..found.start], &text[found.end..]),
        None => text.to_string(),
    }
}

fn malformed_doi_finding(entries: &[ParsedBib]) -> Option<Finding> {
    let malformed: Vec<&ParsedBib> = entries
        .iter()
        .filter(|entry| {
            let Some(raw) = entry.fields.get("doi").map(|doi| js_trim(doi)) else {
                return false;
            };
            if raw.is_empty() {
                return false;
            }
            !DOI_SHAPE.is_match(&replace_first(&DOI_PREFIX, raw))
        })
        .collect();
    if malformed.is_empty() {
        return None;
    }
    let keys = malformed
        .iter()
        .take(8)
        .map(|entry| entry.key.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Some(
        Finding::new(
            "refs-malformed-doi",
            Lens::Refs,
            Severity::Warning,
            msg!("rules.refs-malformed-doi.title", "count" => malformed.len()),
            msg!("rules.refs-malformed-doi.detail", "keys" => keys),
        )
        .with_certainty(Certainty::Verified),
    )
}

fn duplicate_title_finding(entries: &[ParsedBib]) -> Option<Finding> {
    let mut order: Vec<String> = Vec::new();
    let mut title_map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in entries {
        let title = plain(entry.fields.get("title").map(String::as_str).unwrap_or(""));
        if utf16_len(&title) < 16 {
            continue;
        }
        let keys = title_map.entry(title.clone()).or_insert_with(|| {
            order.push(title);
            Vec::new()
        });
        keys.push(entry.key.clone());
    }
    let duplicates: Vec<&Vec<String>> = order
        .iter()
        .filter_map(|title| title_map.get(title))
        .filter(|keys| keys.len() > 1)
        .collect();
    if duplicates.is_empty() {
        return None;
    }
    let groups = duplicates
        .iter()
        .take(5)
        .map(|keys| keys.join(" / "))
        .collect::<Vec<_>>()
        .join(" · ");
    Some(
        Finding::new(
            "refs-duplicate-title",
            Lens::Refs,
            Severity::Warning,
            msg!("rules.refs-duplicate-title.title", "count" => duplicates.len()),
            msg!("rules.refs-duplicate-title.detail", "groups" => groups),
        )
        .with_certainty(Certainty::Verified),
    )
}

fn uncited_entries_finding(ctx: &RefsContext, entries: &[ParsedBib]) -> Option<Finding> {
    let cited_keys = ctx.all_cited_keys.as_ref()?;
    if cited_keys.iter().any(|key| key == "*") {
        return None;
    }
    let cited: HashSet<&str> = cited_keys.iter().map(String::as_str).collect();
    let uncited: Vec<&ParsedBib> = entries
        .iter()
        .filter(|entry| {
            !matches!(
                entry.r#type.as_str(),
                "xdata" | "string" | "preamble" | "comment"
            ) && !cited.contains(entry.key.as_str())
        })
        .collect();
    if uncited.is_empty() {
        return None;
    }
    let detail = if uncited.len() > 8 {
        "rules.refs-uncited-entries.detailTruncated"
    } else {
        "rules.refs-uncited-entries.detail"
    };
    let keys = uncited
        .iter()
        .take(8)
        .map(|entry| entry.key.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Some(
        Finding::new(
            "refs-uncited-entries",
            Lens::Refs,
            Severity::Info,
            msg!("rules.refs-uncited-entries.title", "count" => uncited.len()),
            msg!(detail, "keys" => keys),
        )
        .with_certainty(Certainty::Verified),
    )
}

pub fn bibliography_quality(ctx: &RefsContext) -> Vec<Finding> {
    let entries = ctx.bib_entries.as_deref().unwrap_or(&[]);
    if entries.is_empty() {
        return Vec::new();
    }
    [
        incomplete_metadata_finding(entries),
        malformed_doi_finding(entries),
        duplicate_title_finding(entries),
        uncited_entries_finding(ctx, entries),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn project_label_quality(ctx: &RefsContext) -> Vec<Finding> {
    let mut out = Vec::new();
    let duplicates = ctx.duplicate_labels.as_deref().unwrap_or(&[]);
    if !duplicates.is_empty() {
        let labels = duplicates
            .iter()
            .take(6)
            .map(|item| format!("{} ({})", item.label, item.files.join(", ")))
            .collect::<Vec<_>>()
            .join(" · ");
        out.push(
            Finding::new(
                "refs-project-duplicate-label",
                Lens::Refs,
                Severity::Error,
                msg!("rules.refs-project-duplicate-label.title", "count" => duplicates.len()),
                msg!("rules.refs-project-duplicate-label.detail", "labels" => labels),
            )
            .with_certainty(Certainty::Verified),
        );
    }
    let unreferenced = ctx.unreferenced_labels.as_deref().unwrap_or(&[]);
    if !unreferenced.is_empty() {
        let detail = if unreferenced.len() > 8 {
            "rules.refs-unreferenced-floats.detailTruncated"
        } else {
            "rules.refs-unreferenced-floats.detail"
        };
        let labels = unreferenced
            .iter()
            .take(8)
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        out.push(
            Finding::new(
                "refs-unreferenced-floats",
                Lens::Refs,
                Severity::Info,
                msg!("rules.refs-unreferenced-floats.title", "count" => unreferenced.len()),
                msg!(detail, "labels" => labels),
            )
            .with_certainty(Certainty::Advisory),
        );
    }
    out
}

fn resolvable_from_any_directory(
    raw: &str,
    project_files: &[String],
    engine: BibliographyEngine,
) -> bool {
    let spellings: Vec<String> = bibliography_candidate_paths(raw, "", engine)
        .into_iter()
        .map(|spelling| spelling.to_lowercase())
        .collect();
    if spellings.is_empty() {
        return false;
    }
    project_files.iter().any(|file| {
        let candidate = file.to_lowercase();
        spellings
            .iter()
            .any(|spelling| candidate == *spelling || candidate.ends_with(&format!("/{spelling}")))
    })
}

fn missing_bibliography(
    raw: &str,
    ctx: &RefsContext,
    from_file: Option<&str>,
    engine: BibliographyEngine,
) -> bool {
    if let Some(unresolved) = &ctx.unresolved_bibliographies {
        if let Some(from_file) = from_file {
            return unresolved
                .iter()
                .any(|declaration| declaration.file == from_file && declaration.name == raw);
        }
        return unresolved.iter().any(|declaration| declaration.name == raw)
            && !resolvable_from_any_directory(raw, &ctx.project_files, engine);
    }
    if ctx.project_files.is_empty() {
        return false;
    }
    resolve_bibliography_path(raw, from_file.unwrap_or(""), &ctx.project_files, engine).is_none()
}

fn collect_labels(source: &SourceText, defined: &[String]) -> HashSet<String> {
    let mut labels: HashSet<String> = defined
        .iter()
        .map(|label| js_trim(label).to_string())
        .collect();
    for found in LABEL.find_all(source).matches {
        labels.insert(js_trim(found.text(source, 1).unwrap_or("")).to_string());
    }
    labels
}

fn undefined_cite_findings(source: &SourceText, bib_keys: &HashSet<String>) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in CITE.find_all(source).matches {
        for key in found.text(source, 1).unwrap_or("").split(',').map(js_trim) {
            if key.is_empty() || key == "*" || bib_keys.contains(key) {
                continue;
            }
            out.push(
                Finding::new(
                    "refs-undefined-cite",
                    Lens::Refs,
                    Severity::Error,
                    msg!("rules.refs-undefined-cite.title", "key" => key),
                    message("rules.refs-undefined-cite.detail"),
                )
                .with_range(found.from, found.to),
            );
        }
    }
    out
}

fn undefined_ref_findings(source: &SourceText, labels: &HashSet<String>) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in REF.find_all(source).matches {
        for label in found.text(source, 1).unwrap_or("").split(',').map(js_trim) {
            if label.is_empty() || labels.contains(label) {
                continue;
            }
            out.push(
                Finding::new(
                    "refs-undefined-ref",
                    Lens::Refs,
                    Severity::Error,
                    msg!("rules.refs-undefined-ref.title", "label" => label),
                    message("rules.refs-undefined-ref.detail"),
                )
                .with_range(found.from, found.to),
            );
        }
    }
    out
}

fn duplicate_label_findings(source: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for found in LABEL.find_all(source).matches {
        let key = js_trim(found.text(source, 1).unwrap_or("")).to_string();
        if seen.contains(&key) {
            out.push(
                Finding::new(
                    "refs-duplicate-label",
                    Lens::Refs,
                    Severity::Warning,
                    msg!("rules.refs-duplicate-label.title", "label" => key),
                    message("rules.refs-duplicate-label.detail"),
                )
                .with_range(found.from, found.to),
            );
        } else {
            seen.insert(key);
        }
    }
    out
}

fn missing_asset_findings(
    source: &SourceText,
    ctx: &RefsContext,
    regex: &JsRegex,
    extensions: &[&str],
    image: bool,
) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in regex.find_all(source).matches {
        let target = found.text(source, 1).unwrap_or("");
        if resolves(target, &ctx.project_files, extensions) {
            continue;
        }
        let (title, detail) = if image {
            (
                "rules.refs-missing-asset.titleImage",
                "rules.refs-missing-asset.detailImage",
            )
        } else {
            (
                "rules.refs-missing-asset.titleInclude",
                "rules.refs-missing-asset.detailInclude",
            )
        };
        out.push(
            Finding::new(
                "refs-missing-asset",
                Lens::Refs,
                Severity::Error,
                msg!(title, "file" => js_trim(target)),
                message(detail),
            )
            .with_range(found.from, found.to),
        );
    }
    out
}

fn missing_bibliography_findings(
    source: &SourceText,
    ctx: &RefsContext,
    file: Option<&str>,
) -> Vec<Finding> {
    let mut out = Vec::new();
    for declaration in bibliography_declarations(source.as_str()) {
        let engine = bibliography_engine_for_command(declaration.command);
        if !missing_bibliography(&declaration.raw, ctx, file, engine) {
            continue;
        }
        out.push(
            Finding::new(
                "refs-bib-missing",
                Lens::Refs,
                Severity::Error,
                msg!(
                    "rules.refs-bib-missing.title",
                    "file" => bibliography_display_name(&declaration.raw, engine)
                ),
                message("rules.refs-bib-missing.detail"),
            )
            .with_certainty(Certainty::Verified)
            .with_range(declaration.from, declaration.to),
        );
    }
    out
}

fn bib_key_place(definition: &BibKeyDefinition, shown: &str) -> String {
    let place = format!("{}:{}", definition.file, definition.line);
    if definition.key == shown {
        place
    } else {
        format!("{place} ({})", definition.key)
    }
}

fn bib_key_identity(key: &str, dialect: BibKeyDialect) -> String {
    if dialect == BibKeyDialect::Bibtex {
        key.to_lowercase()
    } else {
        key.to_string()
    }
}

fn duplicate_key_detail(dialect: BibKeyDialect) -> &'static str {
    match dialect {
        BibKeyDialect::Bibtex => "rules.refs-duplicate-bib-key.detail",
        BibKeyDialect::Biber => "rules.refs-duplicate-bib-key.detailBiber",
        BibKeyDialect::Typst => "rules.refs-duplicate-bib-key.detailTypst",
    }
}

fn distinct_bib_keys(keys: &[String], dialect: BibKeyDialect) -> Vec<String> {
    let mut seen = HashSet::new();
    keys.iter()
        .filter(|key| seen.insert(bib_key_identity(key, dialect)))
        .cloned()
        .collect()
}

pub fn duplicate_doi_findings(ctx: &RefsContext, dialect: BibKeyDialect) -> Vec<Finding> {
    ctx.duplicate_dois
        .iter()
        .filter_map(|duplicate| {
            let keys = distinct_bib_keys(&duplicate.keys, dialect);
            (keys.len() >= 2).then(|| {
                Finding::new(
                    "refs-duplicate-bib",
                    Lens::Refs,
                    Severity::Warning,
                    msg!("rules.refs-duplicate-bib.title", "keys" => keys.join(", ")),
                    msg!("rules.refs-duplicate-bib.detail", "doi" => &duplicate.doi),
                )
            })
        })
        .collect()
}

pub fn duplicate_bib_key_findings(ctx: &RefsContext, dialect: BibKeyDialect) -> Vec<Finding> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<&BibKeyDefinition>> = HashMap::new();
    for definition in ctx.bib_key_definitions.as_deref().unwrap_or(&[]) {
        let identity = bib_key_identity(&definition.key, dialect);
        groups
            .entry(identity.clone())
            .or_insert_with(|| {
                order.push(identity);
                Vec::new()
            })
            .push(definition);
    }
    order
        .iter()
        .filter_map(|identity| groups.get(identity))
        .filter(|definitions| definitions.len() > 1)
        .map(|definitions| {
            let first = definitions[0];
            let places = definitions
                .iter()
                .map(|item| bib_key_place(item, &first.key))
                .collect::<Vec<_>>()
                .join(", ");
            let severity = if dialect == BibKeyDialect::Typst {
                Severity::Error
            } else {
                Severity::Warning
            };
            Finding::new(
                "refs-duplicate-bib-key",
                Lens::Refs,
                severity,
                msg!("rules.refs-duplicate-bib-key.title", "key" => &first.key),
                msg!(duplicate_key_detail(dialect), "places" => places),
            )
            .with_certainty(Certainty::Verified)
            .with_file(first.file.clone())
            .with_range(first.from, first.to)
        })
        .collect()
}

pub fn run_refs_rules(raw_source: &str, ctx: &RefsContext, options: &RefsOptions) -> Vec<Finding> {
    let source = SourceText::new(mask_comments(raw_source));
    let labels = collect_labels(&source, &ctx.defined_labels);
    let bib_keys: HashSet<String> = ctx
        .bib_keys
        .iter()
        .map(|key| js_trim(key).to_string())
        .collect();

    let mut out = Vec::new();
    if ctx.bib_loaded {
        out.extend(undefined_cite_findings(&source, &bib_keys));
    }
    out.extend(undefined_ref_findings(&source, &labels));
    out.extend(duplicate_label_findings(&source));
    out.extend(missing_asset_findings(
        &source,
        ctx,
        &GRAPHICS,
        GRAPHICS_EXT,
        true,
    ));
    out.extend(missing_asset_findings(
        &source, ctx, &INPUT, INPUT_EXT, false,
    ));
    out.extend(missing_bibliography_findings(
        &source,
        ctx,
        options.file.as_deref(),
    ));

    if options.include_project_quality {
        let dialect = ctx.bib_key_dialect.unwrap_or(BibKeyDialect::Bibtex);
        out.extend(duplicate_doi_findings(ctx, dialect));
        out.extend(bibliography_quality(ctx));
        out.extend(project_label_quality(ctx));
        out.extend(duplicate_bib_key_findings(ctx, dialect));
    }
    out.sort_by_key(|finding| finding.from.unwrap_or(0));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_cite_command_reports_each_missing_key() {
        let ctx = RefsContext {
            bib_loaded: true,
            ..RefsContext::default()
        };
        let found = run_refs_rules("\\cite{a,b}", &ctx, &RefsOptions::default());
        let cites: Vec<_> = found
            .iter()
            .filter(|f| f.id == "refs-undefined-cite")
            .collect();
        assert_eq!(cites.len(), 2);
        assert_eq!((cites[0].from, cites[0].to), (cites[1].from, cites[1].to));
    }

    #[test]
    fn plain_titles_lose_markup_and_case() {
        assert_eq!(plain("{The} \\emph{Big}  Book!"), "the emph big book");
    }

    #[test]
    fn missing_assets_resolve_by_base_name_and_extension() {
        let files = vec!["figures/plot.png".to_string()];
        assert!(resolves("./plot", &files, GRAPHICS_EXT));
        assert!(resolves("figures/plot.png", &files, GRAPHICS_EXT));
        assert!(!resolves("other", &files, GRAPHICS_EXT));
    }

    #[test]
    fn bibtex_keys_differing_in_case_are_duplicates_but_biber_keys_are_not() {
        let definition = |key: &str, line: u32| BibKeyDefinition {
            key: key.to_string(),
            file: "refs.bib".to_string(),
            line,
            from: 0,
            to: 1,
        };
        let ctx = RefsContext {
            bib_key_definitions: Some(vec![definition("Smith2020", 1), definition("smith2020", 5)]),
            ..RefsContext::default()
        };
        let bibtex = duplicate_bib_key_findings(&ctx, BibKeyDialect::Bibtex);
        assert_eq!(bibtex.len(), 1);
        assert_eq!(
            bibtex[0].detail.params["places"].to_string(),
            "refs.bib:1, refs.bib:5 (smith2020)"
        );
        assert!(duplicate_bib_key_findings(&ctx, BibKeyDialect::Biber).is_empty());
    }
}
