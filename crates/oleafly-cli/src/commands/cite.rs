//! `oleafly cite` (BibTeX for a DOI, arXiv id, ISBN or PubMed id, or a
//! title search, added to the project's bibliography with `--add`),
//! `oleafly literature` (the scholarly indexes the app searches) and
//! `oleafly bib clean|check`. Lookups go to the same public registries as
//! the app's citation dialog; only the identifier or query is sent.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Args, Subcommand};
use futures_util::StreamExt;
use oleafly_core::bibkey::{add_entry, parse_entries, AddOutcome};
use oleafly_core::{Engine, Workspace};
use oleafly_doctools::bib_clean::{apply_plan_to, plan_project, BackupLocation, CleanOutcome};
use oleafly_doctools::pandoc_citations::{declared_bibliographies, BibliographySource};
use oleafly_research::host::ConnectorSecrets;
use oleafly_research::literature::{
    search_all, LiteratureClient, LiteratureQuery, LiteratureRecord, LiteratureSourceId,
};
use serde::Serialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::docs::doc_error;
use super::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Exit, Outcome};
use crate::engine::{open_project, OpenedProject, ProjectOrigin};

const MAX_BIB_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MAIN_BYTES: u64 = 8 * 1024 * 1024;
/// Entries `bib check` verifies at once.
const CHECK_CONCURRENCY: usize = 3;
const LOCK_BUDGET: Duration = Duration::from_secs(10);

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Look up a citation (DOI, arXiv id, ISBN, PubMed id or title) and add it to the bibliography
    Cite(CiteArgs),
    /// Search OpenAlex, Semantic Scholar, Crossref, arXiv and PubMed for papers
    Literature(LiteratureArgs),
    /// Clean up or check a BibTeX bibliography
    #[command(subcommand)]
    Bib(BibCommand),
}

#[derive(Debug, Args)]
pub struct CiteArgs {
    #[arg(value_name = "ID_OR_TITLE", required = true, num_args = 1.., help = "A DOI, arXiv id, ISBN or PubMed id, or words from the title")]
    pub input: Vec<String>,
    #[arg(long, help = "Add the entry to the project's bibliography")]
    pub add: bool,
    #[arg(
        long,
        value_name = "FILE",
        help = "The .bib file to add to (default: the one the document uses)"
    )]
    pub bib: Option<String>,
    #[arg(long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..), help = "For a title search: use match N")]
    pub pick: Option<u32>,
}

#[derive(Debug, Args)]
pub struct LiteratureArgs {
    #[arg(value_name = "QUERY", required = true, num_args = 1.., help = "What to search for")]
    pub query: Vec<String>,
    #[arg(
        long = "source",
        value_name = "SOURCE",
        value_delimiter = ',',
        help = "openalex, semantic-scholar, crossref, arxiv, pubmed or google-scholar (repeatable; default: all but Google Scholar)"
    )]
    pub sources: Vec<String>,
    #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u8).range(1..=25), help = "Results per index, 1 to 25")]
    pub limit: u8,
    #[arg(long, value_name = "YEAR", help = "Only papers from this year on")]
    pub since: Option<u16>,
    #[arg(long, value_name = "YEAR", help = "Only papers up to this year")]
    pub until: Option<u16>,
    #[arg(long = "open-access", help = "Only open access papers")]
    pub open_access: bool,
}

#[derive(Debug, Subcommand)]
pub enum BibCommand {
    /// Give keys the app's scheme and remove duplicate entries (a preview unless --apply)
    Clean(BibCleanArgs),
    /// Check that each entry's DOI or title matches a real record
    Check(BibCheckArgs),
}

#[derive(Debug, Args)]
pub struct BibCleanArgs {
    #[arg(
        value_name = "FILE",
        help = "The .bib file (default: the one the document uses)"
    )]
    pub bib: Option<String>,
    #[arg(
        long,
        help = "Make the changes; citations in the project's sources are updated too"
    )]
    pub apply: bool,
    #[arg(short = 'y', long, help = "Apply without asking")]
    pub yes: bool,
}

#[derive(Debug, Args)]
pub struct BibCheckArgs {
    #[arg(
        value_name = "FILE",
        help = "The .bib file (default: the one the document uses)"
    )]
    pub bib: Option<String>,
    #[arg(
        long = "key",
        value_name = "KEY",
        help = "Check only this entry (repeatable)"
    )]
    pub keys: Vec<String>,
    #[arg(long, default_value_t = 200, value_parser = clap::value_parser!(u32).range(1..=2000), help = "Check at most this many entries")]
    pub limit: u32,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Cite(_) => "cite",
            Self::Literature(_) => "literature",
            Self::Bib(BibCommand::Clean(_)) => "bib clean",
            Self::Bib(BibCommand::Check(_)) => "bib check",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Cite(args) => run_cite(ctx, args).await,
            Self::Literature(args) => run_literature(ctx, args).await,
            Self::Bib(BibCommand::Clean(args)) => run_bib_clean(ctx, args).await,
            Self::Bib(BibCommand::Check(args)) => run_bib_check(ctx, args).await,
        }
    }
}

// ------------------------------------------------------- identifiers

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InputKind {
    Doi,
    Arxiv,
    Isbn,
    Pmid,
    Title,
}

impl InputKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Doi => "doi",
            Self::Arxiv => "arxiv",
            Self::Isbn => "isbn",
            Self::Pmid => "pmid",
            Self::Title => "title",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Detected {
    pub kind: InputKind,
    pub value: String,
}

fn detected(kind: InputKind, value: impl Into<String>) -> Detected {
    Detected {
        kind,
        value: value.into(),
    }
}

/// `10.<4–9 digits>/<anything but spaces, quotes and angle brackets>`,
/// anywhere in the text, without trailing punctuation.
fn find_doi(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(offset) = text[from..].find("10.") {
        let at = from + offset;
        let mut index = at + 3;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        let digits = index - (at + 3);
        if (4..=9).contains(&digits) && bytes.get(index) == Some(&b'/') {
            let rest = index + 1;
            let end = text[rest..]
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '"' | '<' | '>')
                })
                .map_or(text.len(), |offset| rest + offset);
            if end > rest {
                return Some(
                    text[at..end]
                        .trim_end_matches(['.', ',', ';', ':'])
                        .to_string(),
                );
            }
        }
        from = at + 1;
    }
    None
}

fn strip_version(id: &str) -> &str {
    let Some(at) = id.rfind(['v', 'V']) else {
        return id;
    };
    let digits = &id[at + 1..];
    if at > 0 && !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()) {
        &id[..at]
    } else {
        id
    }
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

fn arxiv_from_url(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let at = ["arxiv.org/abs/", "arxiv.org/pdf/"]
        .iter()
        .filter_map(|marker| lower.find(marker).map(|at| at + marker.len()))
        .min()?;
    let mut rest = &text[at..];
    if rest.is_empty()
        || !rest.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '/' | '-')
        })
    {
        return None;
    }
    if rest.len() > 4 && rest[rest.len() - 4..].eq_ignore_ascii_case(".pdf") {
        rest = &rest[..rest.len() - 4];
    }
    let id = strip_version(rest);
    Some(if id.is_empty() { rest } else { id }.to_string())
}

/// `1706.03762` (with an optional version).
fn modern_arxiv(text: &str) -> Option<String> {
    let id = strip_version(text);
    let (year, number) = id.split_once('.')?;
    let ok = year.len() == 4
        && year.bytes().all(|byte| byte.is_ascii_digit())
        && (4..=5).contains(&number.len())
        && number.bytes().all(|byte| byte.is_ascii_digit());
    ok.then(|| id.to_string())
}

/// `hep-th/9901001` or `math.GT/0309136` (with an optional version).
fn old_arxiv(text: &str) -> Option<String> {
    let id = strip_version(text);
    let (archive, number) = id.split_once('/')?;
    if number.len() != 7 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (name, class) = match archive.split_once('.') {
        Some((name, class)) => (name, Some(class)),
        None => (archive, None),
    };
    let name_ok = !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphabetic() || byte == b'-');
    let class_ok = class.is_none_or(|class| {
        class.len() == 2 && class.bytes().all(|byte| byte.is_ascii_alphabetic())
    });
    (name_ok && class_ok).then(|| id.to_string())
}

fn isbn_candidate(text: &str) -> Option<String> {
    let mut rest = text;
    if let Some(after) = strip_prefix_ignore_case(rest, "isbn") {
        let after = after
            .strip_prefix("-10")
            .or_else(|| after.strip_prefix("-13"))
            .unwrap_or(after);
        if let Some(value) = after.trim_start().strip_prefix(':') {
            rest = value.trim_start();
        }
    }
    let candidate: String = rest
        .chars()
        .filter(|character| !matches!(character, '-' | ' '))
        .collect::<String>()
        .to_ascii_uppercase();
    let thirteen = candidate.len() == 13
        && candidate.bytes().all(|byte| byte.is_ascii_digit())
        && (candidate.starts_with("978") || candidate.starts_with("979"));
    // Ten bytes of ASCII, not ten bytes that may end inside a character.
    let ten = candidate.len() == 10
        && candidate.is_ascii()
        && candidate[..9].bytes().all(|byte| byte.is_ascii_digit())
        && (candidate.as_bytes()[9].is_ascii_digit() || candidate.as_bytes()[9] == b'X');
    (thirteen || ten).then_some(candidate)
}

fn pubmed_number(text: &str, max_digits: usize, min_digits: usize) -> Option<String> {
    let ok = (min_digits..=max_digits).contains(&text.len())
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && !text.starts_with('0');
    ok.then(|| text.to_string())
}

fn pmid(text: &str) -> Option<String> {
    if let Some(rest) = strip_prefix_ignore_case(text, "pmid:") {
        return pubmed_number(rest.trim_start(), 9, 1);
    }
    for prefix in [
        "https://pubmed.ncbi.nlm.nih.gov/",
        "http://pubmed.ncbi.nlm.nih.gov/",
    ] {
        if let Some(rest) = strip_prefix_ignore_case(text, prefix) {
            let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
            let tail = &rest[end..];
            let tail_ok = tail.is_empty()
                || tail.starts_with(['?', '#'])
                || tail == "/"
                || tail.starts_with("/?")
                || tail.starts_with("/#");
            return if tail_ok {
                pubmed_number(&rest[..end], 9, 1)
            } else {
                None
            };
        }
    }
    pubmed_number(text, 9, 6)
}

/// What a piece of text names, as the app's citation dialog reads it.
pub(crate) fn detect_input(raw: &str) -> Detected {
    let text = raw.trim();
    if let Some(doi) = find_doi(text) {
        return detected(InputKind::Doi, doi);
    }
    if let Some(id) = arxiv_from_url(text) {
        return detected(InputKind::Arxiv, id);
    }
    let bare = strip_prefix_ignore_case(text, "arxiv:").map_or(text, str::trim_start);
    if let Some(id) = modern_arxiv(bare).or_else(|| old_arxiv(bare)) {
        return detected(InputKind::Arxiv, id);
    }
    if let Some(isbn) = isbn_candidate(text) {
        return detected(InputKind::Isbn, isbn);
    }
    if let Some(id) = pmid(text) {
        return detected(InputKind::Pmid, id);
    }
    detected(InputKind::Title, text)
}

// ---------------------------------------------------------- BibTeX text

fn decode_xml_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        // Last, so `&amp;lt;` becomes `&lt;`, not `<`.
        .replace("&amp;", "&")
}

/// Remote metadata compiles as literal text, not LaTeX commands.
fn escape_latex(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '\\' => out.push_str("\\textbackslash{}"),
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '&' | '%' | '$' | '#' | '_' | '{' | '}' => {
                out.push('\\');
                out.push(character);
            }
            other => out.push(other),
        }
    }
    out
}

fn clean_field(text: &str) -> String {
    escape_latex(&decode_xml_entities(text))
}

/// Tags removed until none are left (so `<<b>b>` can't rebuild one).
fn strip_tags(text: &str) -> String {
    let mut current = text.to_string();
    loop {
        let mut out = String::with_capacity(current.len());
        let mut rest = current.as_str();
        while let Some(open) = rest.find('<') {
            match rest[open..].find('>') {
                Some(close) => {
                    out.push_str(&rest[..open]);
                    rest = &rest[open + close + 1..];
                }
                None => break,
            }
        }
        out.push_str(rest);
        if out == current {
            return out;
        }
        current = out;
    }
}

fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "Jane Smith" → "Smith, Jane"; names with a comma stay.
fn to_bib_name(name: &str) -> String {
    let name = name.trim();
    if name.contains(',') {
        return name.to_string();
    }
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.split_last() {
        Some((family, given)) if !given.is_empty() => format!("{family}, {}", given.join(" ")),
        _ => name.to_string(),
    }
}

/// The text of the first `<tag>…</tag>` (or `<tag attr…>…</tag>`).
fn element_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(offset) = xml[from..].find(&format!("<{tag}")) {
        let at = from + offset + tag.len() + 1;
        let next = xml[at..].chars().next()?;
        if next == '>' || next.is_whitespace() {
            let start = at + xml[at..].find('>')? + 1;
            let end = start + xml[start..].find(&format!("</{tag}>"))?;
            return Some(&xml[start..end]);
        }
        from = at;
    }
    None
}

/// BibTeX for the first entry of an arXiv Atom feed ("" when there is none).
pub(crate) fn arxiv_atom_to_bibtex(xml: &str) -> String {
    let Some(start) = xml.find("<entry") else {
        return String::new();
    };
    let Some(length) = xml[start..].find("</entry>") else {
        return String::new();
    };
    let entry = &xml[start..start + length + "</entry>".len()];
    let id_text = element_text(entry, "id").unwrap_or_default().trim();
    let id_text = ["https://arxiv.org/abs/", "http://arxiv.org/abs/"]
        .iter()
        .find_map(|prefix| id_text.strip_prefix(prefix))
        .unwrap_or(id_text);
    let id = strip_version(id_text);
    let title =
        clean_field(collapse_spaces(element_text(entry, "title").unwrap_or_default()).trim());
    let year: String = element_text(entry, "published")
        .map(str::trim)
        .filter(|published| {
            published.len() >= 4 && published.as_bytes()[..4].iter().all(u8::is_ascii_digit)
        })
        .map(|published| published[..4].to_string())
        .unwrap_or_default();
    let mut authors = Vec::new();
    let mut rest = entry;
    while let Some(at) = rest.find("<author>") {
        rest = &rest[at + "<author>".len()..];
        let body = rest.trim_start();
        if let Some(name) = body
            .strip_prefix("<name>")
            .and_then(|name| name.split_once("</name>"))
            .map(|(name, _)| name)
        {
            if !name.contains('<') && !name.trim().is_empty() {
                authors.push(to_bib_name(&clean_field(name.trim())));
            }
        }
    }
    let doi = element_text(entry, "arxiv:doi")
        .map(str::trim)
        .filter(|doi| !doi.is_empty() && !doi.contains('<'));
    let key: String = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '_')
        .collect();
    let key = if key.is_empty() {
        "arxiv".to_string()
    } else {
        key
    };
    let mut fields = vec![
        format!("  title = {{{title}}}"),
        format!("  author = {{{}}}", authors.join(" and ")),
        format!("  year = {{{year}}}"),
        format!("  eprint = {{{id}}}"),
        "  archivePrefix = {arXiv}".to_string(),
    ];
    if let Some(doi) = doi {
        fields.push(format!("  doi = {{{doi}}}"));
    }
    format!("@misc{{{key},\n{}\n}}", fields.join(",\n"))
}

/// One Crossref match for a title search.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct CitationHit {
    pub doi: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub venue: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

fn first_text(value: &Value) -> Option<String> {
    let text = match value {
        Value::Array(items) => items.first()?.as_str()?,
        Value::String(text) => text.as_str(),
        _ => return None,
    };
    Some(collapse_spaces(&decode_xml_entities(&strip_tags(text))))
}

/// The matches in a Crossref `works` answer.
pub(crate) fn parse_crossref_hits(body: &str) -> Vec<CitationHit> {
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let Some(items) = data["message"]["items"].as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .map(|item| CitationHit {
            doi: item["DOI"].as_str().map(str::to_string),
            title: first_text(&item["title"]).unwrap_or_default(),
            authors: item["author"]
                .as_array()
                .map(|authors| {
                    authors
                        .iter()
                        .filter_map(|author| {
                            match (author["family"].as_str(), author["given"].as_str()) {
                                (Some(family), Some(given)) => Some(format!("{family}, {given}")),
                                (Some(family), None) => Some(family.to_string()),
                                _ => author["name"].as_str().map(str::to_string),
                            }
                        })
                        .filter(|name| !name.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            year: match &item["issued"]["date-parts"][0][0] {
                Value::Number(number) => Some(number.to_string()),
                Value::String(text) => Some(text.clone()),
                _ => None,
            },
            venue: first_text(&item["container-title"]),
            kind: item["type"].as_str().map(str::to_string),
        })
        .collect()
}

/// The registry's BibTeX for a match with a DOI, else an entry built from
/// what the search returned.
async fn bibtex_for_hit(hit: &CitationHit) -> String {
    if let Some(doi) = &hit.doi {
        if let Ok(bibtex) = oleafly_research::citation::fetch_doi_bibtex(doi).await {
            return bibtex.trim().to_string();
        }
    }
    let mut fields = vec![format!("  title = {{{}}}", escape_latex(&hit.title))];
    if !hit.authors.is_empty() {
        fields.push(format!(
            "  author = {{{}}}",
            escape_latex(&hit.authors.join(" and "))
        ));
    }
    if let Some(year) = &hit.year {
        fields.push(format!("  year = {{{year}}}"));
    }
    if let Some(venue) = &hit.venue {
        fields.push(format!("  journal = {{{}}}", escape_latex(venue)));
    }
    if let Some(doi) = &hit.doi {
        fields.push(format!("  doi = {{{doi}}}"));
    }
    format!("@article{{ref,\n{}\n}}", fields.join(",\n"))
}

fn lookup_error(message: String) -> CliError {
    let not_found = message.starts_with("No ")
        || message.starts_with("Not a valid")
        || message.contains("returned no");
    if not_found {
        CliError::new(ErrorKind::InvalidInput, "cite.not_found", message)
    } else {
        CliError::new(
            ErrorKind::Network,
            "cite.lookup_failed",
            format!("The citation lookup failed: {message}"),
        )
        .hint("Check your internet connection, then try again.")
        .retryable()
    }
}

async fn lookup_detected(input: &Detected) -> Result<(String, &'static str), CliError> {
    use oleafly_research::citation as registry;
    let result = match input.kind {
        InputKind::Doi => registry::fetch_doi_bibtex(&input.value)
            .await
            .map(|bibtex| (bibtex.trim().to_string(), "doi")),
        InputKind::Arxiv => registry::fetch_arxiv(&input.value).await.and_then(|xml| {
            let bibtex = arxiv_atom_to_bibtex(&xml);
            if bibtex.is_empty() {
                Err("No arXiv entry has that id.".to_string())
            } else {
                Ok((bibtex, "arxiv"))
            }
        }),
        InputKind::Isbn => registry::fetch_isbn_bibtex(&input.value)
            .await
            .map(|bibtex| (bibtex.trim().to_string(), "isbn")),
        InputKind::Pmid => registry::fetch_pmid_bibtex(&input.value)
            .await
            .map(|bibtex| (bibtex.trim().to_string(), "pubmed")),
        InputKind::Title => {
            return Err(CliError::new(
                ErrorKind::InvalidInput,
                "cite.not_an_identifier",
                "That isn't a DOI, arXiv id, ISBN or PubMed id.",
            )
            .hint("Search by title with `oleafly cite <title words>`."))
        }
    };
    result.map_err(lookup_error)
}

/// BibTeX for a DOI, arXiv id, ISBN or PubMed id, and which registry gave it
/// (`doi`, `arxiv`, `isbn` or `pubmed`). Titles are refused.
pub(crate) async fn lookup_bibtex(id: &str) -> Result<(String, &'static str), CliError> {
    lookup_detected(&detect_input(id)).await
}

async fn search_titles(query: &str) -> Result<Vec<CitationHit>, CliError> {
    let body = oleafly_research::citation::crossref_search(query)
        .await
        .map_err(lookup_error)?;
    Ok(parse_crossref_hits(&body))
}

// ------------------------------------------------------- the .bib file

/// `\bibliography{a,b}` and `\addbibresource[…]{x.bib}` names in LaTeX
/// source, comments skipped.
fn latex_bibliographies(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in text.lines() {
        let line = strip_tex_comment(line);
        for command in ["\\bibliography", "\\addbibresource", "\\addglobalbib"] {
            let mut rest = line;
            while let Some(at) = rest.find(command) {
                let after = &rest[at + command.len()..];
                rest = after;
                if after.starts_with(|character: char| character.is_ascii_alphabetic()) {
                    continue;
                }
                let mut cursor = after.trim_start();
                if cursor.starts_with('[') {
                    match cursor.find(']') {
                        Some(end) => cursor = cursor[end + 1..].trim_start(),
                        None => continue,
                    }
                }
                let Some(group) = cursor.strip_prefix('{') else {
                    continue;
                };
                let Some(end) = group.find('}') else {
                    continue;
                };
                let inside = &group[..end];
                if command == "\\bibliography" {
                    names.extend(
                        inside
                            .split(',')
                            .map(str::trim)
                            .filter(|name| !name.is_empty())
                            .map(str::to_string),
                    );
                } else if !inside.trim().is_empty() {
                    names.push(inside.trim().to_string());
                }
            }
        }
    }
    names
}

fn strip_tex_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'%' => return &line[..index],
            _ => index += 1,
        }
    }
    line
}

/// The .bib file a citation goes to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BibTarget {
    /// From the project root, with forward slashes.
    pub relative: String,
    pub path: PathBuf,
    pub exists: bool,
    /// The document names it (or the user picked it).
    pub declared: bool,
}

fn read_bounded_bytes(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    std::fs::read(path).ok()
}

/// For reading only: bytes that aren't UTF-8 become U+FFFD.
fn read_bounded(path: &Path, limit: u64) -> Option<String> {
    read_bounded_bytes(path, limit).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// A path the user gave, as a path from the project root.
fn project_relative(workspace: &Workspace, given: &str) -> Result<String, CliError> {
    let path = Path::new(given);
    if path.is_absolute() {
        let root = workspace.root().canonicalize().map_err(CliError::from)?;
        let full = path.canonicalize().ok().or_else(|| {
            let parent = path.parent()?.canonicalize().ok()?;
            Some(parent.join(path.file_name()?))
        });
        let relative = full
            .as_deref()
            .and_then(|full| full.strip_prefix(&root).ok())
            .ok_or_else(|| {
                CliError::new(
                    ErrorKind::UnsafePath,
                    "project.unsafe_path",
                    format!("{given} isn't inside the project."),
                )
            })?;
        return Ok(slash(relative));
    }
    let given = if cfg!(windows) {
        given.replace('\\', "/")
    } else {
        given.to_string()
    };
    Ok(given.trim_start_matches("./").to_string())
}

/// Where a citation goes: `--bib`, else the first .bib the main document
/// names that exists, else the first one it names (created, so the build
/// finds it), else the project's first .bib, else `references.bib`.
pub(crate) fn bibliography_target(
    ctx: &Context,
    workspace: &Workspace,
    requested: Option<&str>,
) -> Result<BibTarget, CliError> {
    let root = workspace.root();
    if let Some(requested) = requested {
        let relative = project_relative(workspace, requested)?;
        if !relative.to_ascii_lowercase().ends_with(".bib") {
            return Err(CliError::usage(format!("{requested} isn't a .bib file.")));
        }
        let path = ctx.resolve_project_file(workspace, &relative)?;
        return Ok(BibTarget {
            exists: path.is_file(),
            relative,
            path,
            declared: true,
        });
    }
    let manifest = workspace.manifest();
    let main = manifest.main_doc.clone();
    let text = read_bounded(&root.join(&main), MAX_MAIN_BYTES).unwrap_or_default();
    let (declared, add_extension) = match manifest.engine()? {
        Engine::Tectonic | Engine::Latexmk => (latex_bibliographies(&text), true),
        Engine::Typst => (
            declared_bibliographies(BibliographySource::Typst, &text),
            false,
        ),
        Engine::Markdown => (
            declared_bibliographies(BibliographySource::Markdown, &text),
            false,
        ),
    };
    let main_dir = Path::new(&main)
        .parent()
        .map(slash)
        .filter(|dir| !dir.is_empty());
    let typst = manifest.engine()? == Engine::Typst;
    let mut first_declared: Option<(String, PathBuf)> = None;
    for name in declared {
        let mut name = name.replace('\\', "/");
        // In Typst a leading `/` means the project root (the usual form when
        // the main file sits in a folder).
        let rooted = typst && name.starts_with('/') && !name.starts_with("//");
        if rooted {
            name = name.trim_start_matches('/').to_string();
        }
        while let Some(rest) = name.strip_prefix("./") {
            name = rest.to_string();
        }
        if add_extension && !name.to_ascii_lowercase().ends_with(".bib") {
            name.push_str(".bib");
        }
        if !name.to_ascii_lowercase().ends_with(".bib")
            || name.is_empty()
            || name.starts_with('/')
            || name.contains(':')
        {
            continue;
        }
        let mut candidates = Vec::new();
        if let Some(dir) = main_dir.as_ref().filter(|_| !rooted) {
            candidates.push(format!("{dir}/{name}"));
        }
        candidates.push(name);
        for candidate in candidates {
            let Ok(path) = oleafly_core::resolve_project_path(root, &candidate) else {
                continue;
            };
            if path.is_file() {
                return Ok(BibTarget {
                    relative: candidate,
                    path,
                    exists: true,
                    declared: true,
                });
            }
            if first_declared.is_none() {
                first_declared = Some((candidate, path));
            }
        }
    }
    if let Some((relative, path)) = first_declared {
        return Ok(BibTarget {
            relative,
            path,
            exists: false,
            declared: true,
        });
    }
    if let Some(first) = oleafly_core::engine_spec::discover_bibliographies(root)?
        .into_iter()
        .next()
    {
        let path = oleafly_core::resolve_project_path(root, &first)?;
        return Ok(BibTarget {
            relative: first,
            path,
            exists: true,
            declared: false,
        });
    }
    let relative = "references.bib".to_string();
    Ok(BibTarget {
        path: root.join(&relative),
        relative,
        exists: false,
        declared: false,
    })
}

/// How the main document should name a new bibliography.
fn declaration_hint(engine: Engine, relative: &str) -> String {
    match engine {
        Engine::Tectonic | Engine::Latexmk => {
            format!("Add \\bibliography{{{}}} to the document (or \\addbibresource{{{relative}}} with biblatex).", relative.trim_end_matches(".bib"))
        }
        Engine::Typst => format!("Add #bibliography(\"{relative}\") to the document."),
        Engine::Markdown => {
            format!("Add `bibliography: {relative}` to the document's front matter.")
        }
    }
}

/// The app's lock on a project it knows, so the CLI never writes while the
/// app restores a checkpoint or applies changes.
pub(crate) fn app_project_lock(
    ctx: &Context,
    workspace: &Workspace,
) -> Result<Option<std::fs::File>, CliError> {
    let Some(data_root) = ctx.data_root() else {
        return Ok(None);
    };
    let Some(identity) = crate::app_paths::project_identity(workspace.root(), data_root) else {
        return Ok(None);
    };
    if crate::app_paths::restore_pending(workspace.root(), &identity) {
        return Err(CliError::new(
            ErrorKind::Conflict,
            "conflict.restore_pending",
            "The app is restoring a checkpoint of this project.",
        )
        .hint("Open the project in Oleafly to finish the restore, then try again.")
        .retryable());
    }
    crate::app_paths::worktree_lock(data_root, identity.id(), LOCK_BUDGET).map(Some)
}

/// `updated` is `content` with an entry appended, in LF; in a CRLF file the
/// appended part gets CRLF too.
fn keep_line_endings(content: &str, updated: String) -> String {
    let kept = content.trim_end();
    match updated.strip_prefix(kept) {
        Some(appended) if content.contains("\r\n") => format!(
            "{kept}{}",
            appended.replace("\r\n", "\n").replace('\n', "\r\n")
        ),
        _ => updated,
    }
}

fn add_to_bibliography(
    ctx: &Context,
    workspace: &Workspace,
    target: &BibTarget,
    bibtex: &str,
) -> Result<AddOutcome, CliError> {
    let _lock = app_project_lock(ctx, workspace)?;
    let content = if target.path.is_file() {
        let bytes = read_bounded_bytes(&target.path, MAX_BIB_BYTES).ok_or_else(|| {
            CliError::new(
                ErrorKind::InvalidInput,
                "bib.unreadable",
                format!("Oleafly couldn't read {}.", target.relative),
            )
        })?;
        // The file is written back whole, so a Latin-1 or Windows-1252 one
        // would lose every accented letter to U+FFFD.
        String::from_utf8(bytes).map_err(|_| {
            CliError::new(
                ErrorKind::InvalidInput,
                "bib.not_utf8",
                format!(
                    "{} isn't UTF-8, so Oleafly won't rewrite it.",
                    target.relative
                ),
            )
            .hint("Save it as UTF-8 in your editor, then add the entry again.")
        })?
    } else {
        String::new()
    };
    let (updated, outcome) = add_entry(&content, bibtex).ok_or_else(|| {
        CliError::new(
            ErrorKind::InvalidInput,
            "cite.unreadable_entry",
            "The registry's answer isn't BibTeX Oleafly can read.",
        )
    })?;
    if matches!(outcome, AddOutcome::Added { .. }) {
        let updated = keep_line_endings(&content, updated);
        if let Some(parent) = target.path.parent() {
            std::fs::create_dir_all(parent).map_err(CliError::from)?;
        }
        oleafly_core::atomic::write_atomic(&target.path, updated.as_bytes())
            .map_err(CliError::from)?;
    }
    Ok(outcome)
}

fn open(ctx: &Context) -> Result<OpenedProject, CliError> {
    let opened = open_project(ctx.project(), None, None)?;
    for warning in &opened.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    Ok(opened)
}

// ---------------------------------------------------------------- cite

fn print_hits(ctx: &Context, hits: &[CitationHit]) {
    if ctx.json() {
        return;
    }
    if hits.is_empty() {
        ctx.note("Crossref found nothing for that title.");
        return;
    }
    for (index, hit) in hits.iter().enumerate() {
        let year = hit
            .year
            .as_deref()
            .map(|year| format!(" ({year})"))
            .unwrap_or_default();
        ctx.say(format!("{}. {}{year}", index + 1, hit.title));
        let mut details = Vec::new();
        if !hit.authors.is_empty() {
            let shown: Vec<&str> = hit.authors.iter().take(3).map(String::as_str).collect();
            let more = if hit.authors.len() > 3 { "; …" } else { "" };
            details.push(format!("{}{more}", shown.join("; ")));
        }
        if let Some(venue) = &hit.venue {
            details.push(venue.clone());
        }
        if let Some(doi) = &hit.doi {
            details.push(format!("doi:{doi}"));
        }
        if !details.is_empty() {
            ctx.say(format!("   {}", details.join(" · ")));
        }
    }
}

async fn run_cite(ctx: &Context, args: CiteArgs) -> Result<Outcome, CliError> {
    let input = args.input.join(" ");
    let found = detect_input(&input);
    ctx.event(
        "lookup_started",
        json!({"kind": found.kind.as_str(), "value": found.value}),
    )?;
    let (bibtex, source) = if found.kind == InputKind::Title {
        let hits = search_titles(&found.value).await?;
        let Some(pick) = args.pick else {
            print_hits(ctx, &hits);
            if args.add {
                return Err(CliError::usage(
                    "A title can match several papers. Pick one with --pick N.",
                )
                .details(json!({"hits": hits})));
            }
            if !hits.is_empty() {
                ctx.note("Add one with `oleafly cite <title> --pick N --add`.");
            }
            return Ok(Outcome::success(
                json!({"query": found.value, "hits": hits}),
            ));
        };
        let index = usize::try_from(pick)
            .unwrap_or(usize::MAX)
            .saturating_sub(1);
        let hit = hits.get(index).ok_or_else(|| {
            CliError::usage(format!(
                "Crossref returned {} matches, so there is no match {pick}.",
                hits.len()
            ))
        })?;
        let source = if hit.doi.is_some() { "doi" } else { "crossref" };
        (bibtex_for_hit(hit).await, source)
    } else {
        if args.pick.is_some() {
            ctx.warn("cite.flag_ignored", "--pick is only for title searches.");
        }
        lookup_detected(&found).await?
    };
    if !args.add {
        if !ctx.json() {
            ctx.say(&bibtex);
            ctx.note("Add it to the bibliography with `--add`.");
        }
        return Ok(Outcome::success(
            json!({"bibtex": bibtex, "source": source}),
        ));
    }
    let opened = open(ctx)?;
    let workspace = &opened.workspace;
    let target = bibliography_target(ctx, workspace, args.bib.as_deref())?;
    let created = !target.exists;
    let outcome = add_to_bibliography(ctx, workspace, &target, &bibtex)?;
    if created && !target.declared {
        ctx.warn(
            "cite.bibliography_not_declared",
            format!(
                "Oleafly created {}, but the document doesn't use it yet. {}",
                target.relative,
                declaration_hint(workspace.manifest().engine()?, &target.relative)
            ),
        );
    }
    let (added, key) = match &outcome {
        AddOutcome::Added { key } => (true, key.clone()),
        AddOutcome::AlreadyPresent { key } => (false, key.clone()),
    };
    if !ctx.json() {
        if ctx.quiet() {
            ctx.say(&key);
        } else if added {
            ctx.say(format!("Added {key} to {}", target.relative));
        } else {
            ctx.say(format!(
                "{} already has this paper as {key}.",
                target.relative
            ));
        }
    }
    Ok(Outcome::success(json!({
        "bibtex": bibtex,
        "source": source,
        "added": added,
        "key": key,
        "bibliography": target.relative,
        "created": created && added,
    })))
}

// ---------------------------------------------------------- literature

/// Connector keys from the app's encrypted store, read once.
struct CliSecrets(HashMap<String, Zeroizing<String>>);

impl ConnectorSecrets for CliSecrets {
    fn get(&self, name: &str) -> Option<Zeroizing<String>> {
        self.0.get(name).cloned()
    }
}

fn connector_secrets(ctx: &Context) -> CliSecrets {
    let store = ctx
        .data_root()
        .filter(|root| {
            root.join(oleafly_secrets::SecretFile::Connector.file_name())
                .is_file()
        })
        .map(oleafly_secrets::SecretStore::at);
    let Some(store) = store else {
        return CliSecrets(HashMap::new());
    };
    match store.read(oleafly_secrets::SecretFile::Connector) {
        Ok(values) => CliSecrets(
            values
                .into_iter()
                .map(|(name, value)| (name, Zeroizing::new(value)))
                .collect(),
        ),
        Err(_) => {
            ctx.warn(
                "literature.keys_unreadable",
                "Oleafly couldn't read the app's search keys, so it searches without them.",
            );
            CliSecrets(HashMap::new())
        }
    }
}

fn record_json(record: &LiteratureRecord) -> Value {
    json!({
        "id": record.id,
        "title": record.title,
        "authors": record.authors,
        "year": record.year,
        "venue": record.venue,
        "doi": record.doi,
        "arxiv_id": record.arxiv_id,
        "url": record.url,
        "pdf_url": record.pdf_url,
        "abstract": record.abstract_text,
        "citation_count": record.citation_count,
        "open_access": record.open_access,
        "sources": record.sources.iter().map(|source| source.as_str()).collect::<Vec<_>>(),
    })
}

fn parse_sources(names: &[String]) -> Result<Vec<LiteratureSourceId>, CliError> {
    let mut sources = Vec::new();
    for name in names
        .iter()
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
    {
        let source = LiteratureSourceId::parse(&name)
            .filter(|source| *source != LiteratureSourceId::Alphaxiv)
            .ok_or_else(|| {
                CliError::usage(format!("{name} isn't a source Oleafly can search from the command line."))
                    .details(json!({"sources": ["openalex", "semantic-scholar", "crossref", "arxiv", "pubmed", "google-scholar"]}))
            })?;
        if !sources.contains(&source) {
            sources.push(source);
        }
    }
    Ok(sources)
}

/// Where answers are cached: the data folder's cache, else a private folder
/// (owner only) that lasts for this command. A shared, predictable file in
/// the temporary folder could be read, or filled with chosen answers, by
/// another user of the machine.
fn literature_cache(data_root: Option<&Path>) -> (PathBuf, Option<tempfile::TempDir>) {
    if let Some(root) = data_root.filter(|root| root.is_dir()) {
        return (root.join("literature-cache.sqlite3"), None);
    }
    let private = tempfile::Builder::new()
        .prefix("oleafly-literature-")
        .tempdir()
        .ok()
        .filter(|private| owner_only(private.path()));
    match private {
        Some(private) => (private.path().join("cache.sqlite3"), Some(private)),
        // No cache at all: a folder that doesn't exist can't be opened.
        None => (
            std::env::temp_dir()
                .join(format!("oleafly-no-cache-{}", std::process::id()))
                .join("cache.sqlite3"),
            None,
        ),
    }
}

/// Makes `folder` reachable by its owner only.
fn owner_only(folder: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700)).is_ok()
    }
    #[cfg(not(unix))]
    {
        // A temporary folder under the user's profile is the user's.
        let _ = folder;
        true
    }
}

async fn run_literature(ctx: &Context, args: LiteratureArgs) -> Result<Outcome, CliError> {
    let query = args.query.join(" ");
    let sources = parse_sources(&args.sources)?;
    let secrets = connector_secrets(ctx);
    let (cache, _private) = literature_cache(ctx.data_root());
    let client = LiteratureClient::new(cache);
    let request = LiteratureQuery {
        query: query.clone(),
        sources,
        limit: args.limit,
        year_from: args.since,
        year_to: args.until,
        open_access_only: args.open_access,
    };
    ctx.event("search_started", json!({"query": query}))?;
    let results = search_all(&client, &secrets, request, &[])
        .await
        .map_err(|error| {
            let code = error.code().unwrap_or("literature.failed");
            CliError::new(ErrorKind::InvalidInput, code, String::from(error))
        })?;
    let failures: Vec<Value> = results
        .failures
        .iter()
        .map(|failure| json!({"source": failure.source.as_str(), "message": failure.message}))
        .collect();
    if results.records.is_empty() && !results.failures.is_empty() {
        return Err(CliError::new(
            ErrorKind::Network,
            "literature.failed",
            "None of the indexes answered.",
        )
        .hint("Check your internet connection, then try again.")
        .retryable()
        .details(json!({"failures": failures})));
    }
    for failure in &results.failures {
        ctx.warn(
            "literature.source_failed",
            format!(
                "{} didn't answer: {}",
                failure.source.as_str(),
                failure.message
            ),
        );
    }
    if !ctx.json() {
        if results.records.is_empty() {
            ctx.note("No papers matched.");
        }
        for (index, record) in results.records.iter().enumerate() {
            let year = record
                .year
                .map(|year| format!(" ({year})"))
                .unwrap_or_default();
            ctx.say(format!("{}. {}{year}", index + 1, record.title));
            let mut details = Vec::new();
            if !record.authors.is_empty() {
                let shown: Vec<&str> = record.authors.iter().take(3).map(String::as_str).collect();
                let more = if record.authors.len() > 3 {
                    "; …"
                } else {
                    ""
                };
                details.push(format!("{}{more}", shown.join("; ")));
            }
            if let Some(venue) = &record.venue {
                details.push(venue.clone());
            }
            if let Some(doi) = &record.doi {
                details.push(format!("doi:{doi}"));
            } else if let Some(arxiv) = &record.arxiv_id {
                details.push(format!("arXiv:{arxiv}"));
            }
            if let Some(count) = record.citation_count {
                details.push(format!("cited {count}×"));
            }
            if !details.is_empty() {
                ctx.say(format!("   {}", details.join(" · ")));
            }
        }
    }
    Ok(Outcome::success(json!({
        "query": query,
        "results": results.records.iter().map(record_json).collect::<Vec<_>>(),
        "failures": failures,
        "cached": results.cached.iter().map(|source| source.as_str()).collect::<Vec<_>>(),
    })))
}

// -------------------------------------------------------------- bib clean

fn clean_json(outcome: &CleanOutcome) -> Value {
    json!({
        "entries_before": outcome.entries_before,
        "entries_after": outcome.entries_after,
        "actions": outcome.actions,
        "changed_files": outcome.changed_files,
        "applied": outcome.applied,
        "backup_path": outcome.backup_path,
    })
}

fn print_clean(ctx: &Context, relative: &str, outcome: &CleanOutcome) {
    if ctx.json() || ctx.quiet() {
        return;
    }
    let renamed = outcome
        .actions
        .iter()
        .filter(|action| action.kind == "renamed-key")
        .count();
    let removed = outcome
        .actions
        .iter()
        .filter(|action| action.kind == "removed-duplicate")
        .count();
    ctx.say(format!(
        "{relative}: {} entries, {renamed} keys to rename, {removed} duplicates to remove",
        outcome.entries_before
    ));
    for action in &outcome.actions {
        let line = match action.kind {
            "renamed-key" => format!(
                "  rename  {} → {}",
                action.old.as_deref().unwrap_or(""),
                action.new.as_deref().unwrap_or("")
            ),
            "removed-duplicate" => format!(
                "  remove  {} (same {} as {})",
                action.removed.as_deref().unwrap_or(""),
                action.by.as_deref().unwrap_or("entry"),
                action.kept.as_deref().unwrap_or("")
            ),
            _ => match action.key.as_deref().filter(|key| !key.is_empty()) {
                Some(key) => format!("  check   {key}: {}", action.field.as_deref().unwrap_or("")),
                None => format!("  note    {}", action.field.as_deref().unwrap_or("")),
            },
        };
        ctx.say(line);
    }
    if !outcome.changed_files.is_empty() {
        ctx.say(format!(
            "Files that change: {}",
            outcome.changed_files.join(", ")
        ));
    }
}

async fn run_bib_clean(ctx: &Context, args: BibCleanArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx)?;
    let workspace = &opened.workspace;
    let target = bibliography_target(ctx, workspace, args.bib.as_deref())?;
    if !target.exists {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "bib.missing",
            format!("{} doesn't exist.", target.relative),
        ));
    }
    let root = workspace.root().to_path_buf();
    let relative = target.relative.clone();
    let plan = tokio::task::spawn_blocking(move || plan_project(&root, &relative))
        .await
        .map_err(|error| CliError::internal(error.to_string()))?
        .map_err(doc_error)?;
    print_clean(ctx, &target.relative, plan.outcome());
    if !plan.changes_files() {
        ctx.note("Nothing to change.");
        return Ok(Outcome::success(
            json!({"bibliography": target.relative, "clean": clean_json(plan.outcome())}),
        ));
    }
    if !args.apply {
        ctx.note("This was a preview. Run it again with --apply to make the changes.");
        return Ok(Outcome::success(
            json!({"bibliography": target.relative, "clean": clean_json(plan.outcome())}),
        ));
    }
    let question = format!("Change {} files?", plan.outcome().changed_files.len());
    if !ctx.confirm(&question, args.yes)? {
        ctx.note("Nothing changed.");
        return Ok(Outcome::success(
            json!({"bibliography": target.relative, "clean": clean_json(plan.outcome())}),
        ));
    }
    let lock = app_project_lock(ctx, workspace)?;
    let backups = match &opened.origin {
        ProjectOrigin::Linked { .. } => {
            let state = workspace
                .build_dir_path()
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| {
                    CliError::internal("The app's folder for this project is missing.")
                })?;
            let folder = state.join("backups");
            tokio::fs::create_dir_all(&folder)
                .await
                .map_err(CliError::from)?;
            BackupLocation::External(folder)
        }
        _ => BackupLocation::InProject,
    };
    let token = plan.token().to_string();
    let applied = tokio::task::spawn_blocking(move || apply_plan_to(plan, &token, &backups))
        .await
        .map_err(|error| CliError::internal(error.to_string()))?
        .map_err(doc_error)?;
    drop(lock);
    if !ctx.json() {
        ctx.say(format!(
            "Cleaned {}; changed {} files.",
            target.relative,
            applied.changed_files.len()
        ));
        if let Some(backup) = &applied.backup_path {
            ctx.note(format!("The old files are in {backup}."));
        }
    }
    Ok(Outcome::success(
        json!({"bibliography": target.relative, "clean": clean_json(&applied)}),
    ))
}

// -------------------------------------------------------------- bib check

/// A title without BibTeX's protective braces.
fn plain_title(title: &str) -> String {
    collapse_spaces(&title.replace(['{', '}'], ""))
}

async fn run_bib_check(ctx: &Context, args: BibCheckArgs) -> Result<Outcome, CliError> {
    let opened = open(ctx)?;
    let target = bibliography_target(ctx, &opened.workspace, args.bib.as_deref())?;
    if !target.exists {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "bib.missing",
            format!("{} doesn't exist.", target.relative),
        ));
    }
    let content = read_bounded(&target.path, MAX_BIB_BYTES).ok_or_else(|| {
        CliError::new(
            ErrorKind::InvalidInput,
            "bib.unreadable",
            format!("Oleafly couldn't read {}.", target.relative),
        )
    })?;
    let mut entries = parse_entries(&content);
    if !args.keys.is_empty() {
        for key in &args.keys {
            if !entries.iter().any(|entry| &entry.key == key) {
                ctx.warn(
                    "bib.unknown_key",
                    format!("{} has no entry {key}.", target.relative),
                );
            }
        }
        entries.retain(|entry| args.keys.contains(&entry.key));
    }
    let limit = usize::try_from(args.limit).unwrap_or(usize::MAX);
    if entries.len() > limit {
        ctx.warn(
            "bib.check_limited",
            format!("Checking the first {limit} of {} entries.", entries.len()),
        );
        entries.truncate(limit);
    }
    let mut skipped = Vec::new();
    let mut work = Vec::new();
    for entry in entries {
        let doi = entry
            .fields
            .get("doi")
            .map(|doi| doi.trim().to_string())
            .filter(|doi| !doi.is_empty());
        let title = entry
            .fields
            .get("title")
            .map(|title| plain_title(title))
            .filter(|title| !title.is_empty());
        if doi.is_none() && title.is_none() {
            skipped.push(entry.key);
        } else {
            work.push((entry.key, doi, title));
        }
    }
    let checked: Vec<(
        String,
        Result<oleafly_research::citation::CitationCheck, String>,
    )> = futures_util::stream::iter(work)
        .map(|(key, doi, title)| async move {
            let result =
                oleafly_research::citation::verify_citation(doi.as_deref(), title.as_deref()).await;
            (key, result)
        })
        .buffered(CHECK_CONCURRENCY)
        .collect()
        .await;
    let mut verified = Vec::new();
    let mut unverified = Vec::new();
    let mut failed = Vec::new();
    for (key, result) in checked {
        match result {
            Ok(check) if check.verified => verified.push(key),
            Ok(check) => unverified.push(json!({
                "key": key,
                "reason": check.reason,
                "doi": check.doi,
                "matched_title": check.matched_title,
                "score": check.score,
            })),
            Err(message) => failed.push(json!({"key": key, "message": message})),
        }
    }
    if verified.is_empty() && unverified.is_empty() && !failed.is_empty() {
        return Err(CliError::new(
            ErrorKind::Network,
            "bib.check_failed",
            "Oleafly couldn't reach the citation registries.",
        )
        .hint("Check your internet connection, then try again.")
        .retryable());
    }
    if !ctx.json() {
        if !ctx.quiet() {
            ctx.say(format!(
                "{}: {} verified, {} not matched, {} not checked",
                target.relative,
                verified.len(),
                unverified.len(),
                skipped.len() + failed.len()
            ));
        }
        for item in &unverified {
            let reason = item["reason"]
                .as_str()
                .unwrap_or("No matching record found.");
            ctx.say(format!(
                "  {}  {reason}",
                item["key"].as_str().unwrap_or("")
            ));
        }
        for item in &failed {
            ctx.note(format!(
                "{} wasn't checked: {}",
                item["key"].as_str().unwrap_or(""),
                item["message"].as_str().unwrap_or("")
            ));
        }
    }
    let fields = json!({
        "bibliography": target.relative,
        "verified": verified,
        "unverified": unverified,
        "skipped": skipped,
        "failed": failed,
    });
    Ok(if unverified.is_empty() {
        Outcome::success(fields)
    } else {
        Outcome::failure(Exit::Findings, fields)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(input: &str) -> (InputKind, String) {
        let found = detect_input(input);
        (found.kind, found.value)
    }

    #[test]
    fn identifiers_are_detected_like_the_app() {
        assert_eq!(
            kind("10.1145/3292500"),
            (InputKind::Doi, "10.1145/3292500".into())
        );
        assert_eq!(
            kind("https://doi.org/10.1000/xyz123"),
            (InputKind::Doi, "10.1000/xyz123".into())
        );
        assert_eq!(
            kind("see 10.1000/xyz123."),
            (InputKind::Doi, "10.1000/xyz123".into())
        );
        assert_eq!(
            kind("arXiv:1706.03762v5"),
            (InputKind::Arxiv, "1706.03762".into())
        );
        assert_eq!(
            kind("https://arxiv.org/abs/1706.03762"),
            (InputKind::Arxiv, "1706.03762".into())
        );
        assert_eq!(
            kind("https://arxiv.org/pdf/1706.03762v2.pdf"),
            (InputKind::Arxiv, "1706.03762".into())
        );
        assert_eq!(
            kind("hep-th/9901001v2"),
            (InputKind::Arxiv, "hep-th/9901001".into())
        );
        assert_eq!(
            kind("arXiv:math.GT/0309136"),
            (InputKind::Arxiv, "math.GT/0309136".into())
        );
        assert_eq!(
            kind("Attention is all you need"),
            (InputKind::Title, "Attention is all you need".into())
        );
        assert_eq!(
            kind("978-0-262-03561-3"),
            (InputKind::Isbn, "9780262035613".into())
        );
        assert_eq!(
            kind("isbn:020163361X"),
            (InputKind::Isbn, "020163361X".into())
        );
        assert_eq!(
            kind("ISBN-10: 0-8044-2957-x"),
            (InputKind::Isbn, "080442957X".into())
        );
        assert_eq!(kind("32172672"), (InputKind::Pmid, "32172672".into()));
        assert_eq!(kind("PMID: 33077593"), (InputKind::Pmid, "33077593".into()));
        assert_eq!(kind("42"), (InputKind::Title, "42".into()));
        assert_eq!(kind("PMID: 42"), (InputKind::Pmid, "42".into()));
        assert_eq!(
            kind("https://pubmed.ncbi.nlm.nih.gov/32172672/?source=share"),
            (InputKind::Pmid, "32172672".into())
        );
    }

    #[test]
    fn arxiv_atom_becomes_bibtex() {
        let feed = r#"<feed><entry>
  <id>http://arxiv.org/abs/1706.03762v7</id>
  <published>2017-06-12T17:57:34Z</published>
  <title>Attention Is All
   You Need &amp; More_</title>
  <author>
    <name>Ashish Vaswani</name>
  </author>
  <author><name>Noam Shazeer</name></author>
  <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.48550/arXiv.1706.03762</arxiv:doi>
</entry></feed>"#;
        let bibtex = arxiv_atom_to_bibtex(feed);
        assert!(bibtex.starts_with("@misc{170603762,"), "{bibtex}");
        assert!(
            bibtex.contains("title = {Attention Is All You Need \\& More\\_}"),
            "{bibtex}"
        );
        assert!(bibtex.contains("author = {Vaswani, Ashish and Shazeer, Noam}"));
        assert!(bibtex.contains("year = {2017}"));
        assert!(bibtex.contains("eprint = {1706.03762}"));
        assert!(bibtex.contains("doi = {10.48550/arXiv.1706.03762}"));
        assert_eq!(arxiv_atom_to_bibtex("<feed></feed>"), "");
    }

    #[test]
    fn crossref_hits_read_the_fields_the_dialog_shows() {
        let body = r#"{"message":{"items":[{"DOI":"10.1/x","title":["Deep <i>learning</i>"],"author":[{"family":"LeCun","given":"Yann"},{"name":"Consortium"}],"issued":{"date-parts":[[2015,5]]},"container-title":["Nature"],"type":"journal-article"}]}}"#;
        let hits = parse_crossref_hits(body);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Deep learning");
        assert_eq!(hits[0].authors, ["LeCun, Yann", "Consortium"]);
        assert_eq!(hits[0].year.as_deref(), Some("2015"));
        assert_eq!(hits[0].venue.as_deref(), Some("Nature"));
        assert!(parse_crossref_hits("not json").is_empty());
    }

    #[test]
    fn latex_bibliographies_skip_comments_and_styles() {
        let text = "\\bibliographystyle{plain}\n% \\bibliography{old}\n\\bibliography{refs, more}\n\\addbibresource[label=x]{extra.bib}\n";
        assert_eq!(latex_bibliographies(text), ["refs", "more", "extra.bib"]);
        assert_eq!(strip_tex_comment("50\\% done % note"), "50\\% done ");
    }

    #[test]
    fn the_target_is_the_declared_bibliography_then_any_then_references() {
        let ctx = Context::for_test(Default::default());
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\bibliography{refs}\n",
        )
        .unwrap();
        std::fs::create_dir(project.path().join("old")).unwrap();
        std::fs::write(project.path().join("old/other.bib"), "").unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        assert_eq!(
            (target.relative.as_str(), target.exists, target.declared),
            ("refs.bib", false, true)
        );
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n",
        )
        .unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        assert_eq!(
            (target.relative.as_str(), target.exists, target.declared),
            ("old/other.bib", true, false)
        );

        let bare = tempfile::tempdir().unwrap();
        std::fs::write(bare.path().join("main.typ"), "= Hi\n").unwrap();
        let workspace = Workspace::detected(bare.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        assert_eq!(
            (target.relative.as_str(), target.exists, target.declared),
            ("references.bib", false, false)
        );
        assert_eq!(
            bibliography_target(&ctx, &workspace, Some("../x.bib"))
                .unwrap_err()
                .code,
            "project.unsafe_path"
        );
        assert_eq!(
            bibliography_target(&ctx, &workspace, Some("notes.txt"))
                .unwrap_err()
                .code,
            "usage.invalid"
        );
    }

    #[test]
    fn without_a_data_folder_the_literature_cache_is_private_to_the_run() {
        let (path, private) = literature_cache(None);
        let private = private.expect("a private folder");
        assert!(path.starts_with(private.path()));
        assert_ne!(
            path,
            std::env::temp_dir().join("oleafly-literature-cache.sqlite3")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(private.path())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
        let data = tempfile::tempdir().unwrap();
        let (path, none) = literature_cache(Some(data.path()));
        assert_eq!(
            (path, none.is_none()),
            (data.path().join("literature-cache.sqlite3"), true)
        );
    }

    #[test]
    fn a_typst_root_relative_bibliography_is_found_from_the_project_root() {
        let ctx = Context::for_test(Default::default());
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("src")).unwrap();
        std::fs::create_dir_all(project.path().join("archive")).unwrap();
        std::fs::write(
            project.path().join("src/main.typ"),
            "= Hi\n#bibliography(\"/refs.bib\")\n",
        )
        .unwrap();
        std::fs::write(project.path().join("refs.bib"), "").unwrap();
        std::fs::write(project.path().join("archive/old.bib"), "").unwrap();
        let workspace = Workspace::detected(project.path(), Some("src/main.typ")).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        assert_eq!(
            (target.relative.as_str(), target.exists, target.declared),
            ("refs.bib", true, true)
        );
    }

    #[test]
    fn ten_byte_titles_with_wide_letters_are_titles_not_a_panic() {
        // Each is ten bytes long with a character across byte 9.
        for title in ["Книга", "Programmé", "A机器学", "ΑΒΓΔΕ"] {
            assert_eq!(title.len(), 10, "{title}");
            assert_eq!(kind(title), (InputKind::Title, title.into()), "{title}");
        }
        assert_eq!(
            kind("0-8044-2957-X"),
            (InputKind::Isbn, "080442957X".into())
        );
    }

    #[test]
    fn a_bibliography_that_is_not_utf8_is_left_alone() {
        let ctx = Context::for_test(Default::default());
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\bibliography{refs}\n",
        )
        .unwrap();
        let latin1 = b"@book{m,\n  author = {M\xfcller, Hans},\n  title = {Z\xfcrich}\n}\n";
        std::fs::write(project.path().join("refs.bib"), latin1).unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        let entry = "@article{x,\n  author = {Knuth, Donald},\n  title = {Literate Programming},\n  year = {1984}\n}";
        let error = add_to_bibliography(&ctx, &workspace, &target, entry).unwrap_err();
        assert_eq!(error.code, "bib.not_utf8");
        assert_eq!(
            std::fs::read(project.path().join("refs.bib")).unwrap(),
            latin1
        );
    }

    #[test]
    fn a_crlf_bibliography_gets_crlf_for_the_new_entry() {
        let ctx = Context::for_test(Default::default());
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\bibliography{refs}\n",
        )
        .unwrap();
        std::fs::write(
            project.path().join("refs.bib"),
            "\u{feff}@book{a,\r\n  title = {One}\r\n}\r\n",
        )
        .unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        let entry = "@article{x,\n  author = {Knuth, Donald},\n  title = {Literate Programming},\n  year = {1984}\n}";
        add_to_bibliography(&ctx, &workspace, &target, entry).unwrap();
        let written = std::fs::read_to_string(project.path().join("refs.bib")).unwrap();
        assert!(written.starts_with("\u{feff}@book{a,"));
        assert!(written.contains("@article"));
        assert_eq!(
            written.matches('\n').count(),
            written.matches("\r\n").count()
        );
    }

    #[test]
    fn adding_twice_keeps_one_entry() {
        let ctx = Context::for_test(Default::default());
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.md"),
            "---\nbibliography: refs.bib\n---\nText\n",
        )
        .unwrap();
        let workspace = Workspace::detected(project.path(), None).unwrap();
        let target = bibliography_target(&ctx, &workspace, None).unwrap();
        assert_eq!(
            (target.relative.as_str(), target.declared, target.exists),
            ("refs.bib", true, false)
        );
        let entry = "@article{x,\n  author = {Knuth, Donald},\n  title = {Literate Programming},\n  year = {1984},\n  doi = {10.1093/comjnl/27.2.97}\n}";
        let first = add_to_bibliography(&ctx, &workspace, &target, entry).unwrap();
        assert!(matches!(first, AddOutcome::Added { .. }));
        let second = add_to_bibliography(
            &ctx,
            &workspace,
            &BibTarget {
                exists: true,
                ..target.clone()
            },
            entry,
        )
        .unwrap();
        assert!(matches!(second, AddOutcome::AlreadyPresent { .. }));
        let written = std::fs::read_to_string(project.path().join("refs.bib")).unwrap();
        assert_eq!(written.matches("@article").count(), 1);
    }
}
