use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LiteratureSourceId {
    Openalex,
    SemanticScholar,
    Crossref,
    Pubmed,
    Arxiv,
    GoogleScholar,
    Alphaxiv,
}

impl LiteratureSourceId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openalex => "openalex",
            Self::SemanticScholar => "semantic-scholar",
            Self::Crossref => "crossref",
            Self::Pubmed => "pubmed",
            Self::Arxiv => "arxiv",
            Self::GoogleScholar => "google-scholar",
            Self::Alphaxiv => "alphaxiv",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Openalex,
            Self::SemanticScholar,
            Self::Crossref,
            Self::Pubmed,
            Self::Arxiv,
            Self::GoogleScholar,
            Self::Alphaxiv,
        ]
        .into_iter()
        .find(|source| source.as_str() == value)
    }

    /// The sources a search asks when it names none (Google Scholar needs a
    /// key and is only asked for by name; alphaXiv joins when connected).
    pub fn defaults() -> [Self; 5] {
        [
            Self::Openalex,
            Self::SemanticScholar,
            Self::Crossref,
            Self::Arxiv,
            Self::Pubmed,
        ]
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureRecord {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u16>,
    pub venue: Option<String>,
    pub doi: Option<String>,
    pub arxiv_id: Option<String>,
    pub url: Option<String>,
    pub pdf_url: Option<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub citation_count: Option<u64>,
    pub open_access: Option<bool>,
    pub sources: Vec<LiteratureSourceId>,
    pub source_ids: BTreeMap<String, String>,
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(end) = tail.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|decimal| decimal.parse().ok())
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(character) => {
                out.push(character);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for character in text.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(character),
            _ => {}
        }
    }
    out
}

pub fn clean_text(value: &str) -> Option<String> {
    let cleaned = decode_entities(&strip_tags(value))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

fn text(value: &Value) -> Option<String> {
    value.as_str().and_then(clean_text)
}

fn first_text(value: &Value) -> Option<String> {
    match value {
        Value::Array(items) => items.iter().find_map(text),
        other => text(other),
    }
}

pub fn normalize_doi(value: &str) -> Option<String> {
    let doi = value.trim();
    let lower = doi.to_ascii_lowercase();
    let doi = [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ]
    .iter()
    .find(|prefix| lower.starts_with(*prefix))
    .map(|prefix| doi[prefix.len()..].trim())
    .unwrap_or(doi);
    doi.starts_with("10.").then(|| doi.to_owned())
}

fn safe_url(value: &Value) -> Option<String> {
    let candidate = text(value)?;
    let url = reqwest::Url::parse(&candidate).ok()?;
    matches!(url.scheme(), "https" | "http").then(|| url.to_string())
}

fn year_from(value: &Value) -> Option<u16> {
    let text = match value {
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => return None,
    };
    let bytes = text.as_bytes();
    (0..bytes.len().saturating_sub(3)).find_map(|start| {
        let window = &text[start..start + 4];
        let boundary_before = start == 0 || !bytes[start - 1].is_ascii_digit();
        let boundary_after = bytes
            .get(start + 4)
            .is_none_or(|next| !next.is_ascii_digit());
        let year: u16 = window.parse().ok()?;
        (boundary_before && boundary_after && (1800..2200).contains(&year)).then_some(year)
    })
}

pub fn arxiv_id(value: &str) -> Option<String> {
    let id = value
        .trim()
        .trim_start_matches("arXiv:")
        .trim_start_matches("https://arxiv.org/abs/")
        .trim_start_matches("http://arxiv.org/abs/")
        .trim_start_matches("https://arxiv.org/pdf/")
        .trim_end_matches(".pdf");
    let id = match id.rfind('v') {
        Some(at)
            if at > 0
                && id[at + 1..]
                    .chars()
                    .all(|character| character.is_ascii_digit())
                && at + 1 < id.len() =>
        {
            &id[..at]
        }
        _ => id,
    };
    (!id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "./-".contains(character)))
    .then(|| id.to_owned())
}

fn record(
    source: LiteratureSourceId,
    source_id: String,
    mut record: LiteratureRecord,
) -> LiteratureRecord {
    record.id = format!("{}:{source_id}", source.as_str());
    record.sources = vec![source];
    record
        .source_ids
        .insert(source.as_str().to_owned(), source_id);
    if let Some(arxiv) = &record.arxiv_id {
        record
            .source_ids
            .entry("arxiv".into())
            .or_insert_with(|| arxiv.clone());
    }
    record
}

fn json(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or(Value::Null)
}

pub fn parse_openalex(body: &str) -> Vec<LiteratureRecord> {
    let body = json(body);
    let empty = Vec::new();
    body["results"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let title = text(&item["title"])?;
            let source_id = text(&item["id"])
                .and_then(|id| id.rsplit('/').next().map(str::to_owned))
                .unwrap_or_else(|| format!("result-{index}"));
            let doi = item["doi"].as_str().and_then(normalize_doi);
            let landing = safe_url(&item["best_oa_location"]["landing_page_url"])
                .or_else(|| safe_url(&item["primary_location"]["landing_page_url"]));
            let arxiv = item["ids"]["arxiv"]
                .as_str()
                .and_then(arxiv_id)
                .or_else(|| {
                    landing
                        .as_deref()
                        .filter(|url| url.contains("arxiv.org/abs/"))
                        .and_then(arxiv_id)
                });
            Some(record(
                LiteratureSourceId::Openalex,
                source_id,
                LiteratureRecord {
                    title,
                    authors: item["authorships"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|authorship| text(&authorship["author"]["display_name"]))
                        .collect(),
                    year: year_from(&item["publication_year"]),
                    venue: text(&item["primary_location"]["source"]["display_name"]),
                    url: doi
                        .as_ref()
                        .map(|doi| format!("https://doi.org/{doi}"))
                        .or(landing)
                        .or_else(|| safe_url(&item["id"])),
                    doi,
                    arxiv_id: arxiv,
                    pdf_url: safe_url(&item["best_oa_location"]["pdf_url"])
                        .or_else(|| safe_url(&item["primary_location"]["pdf_url"])),
                    abstract_text: text(&item["abstract"]),
                    citation_count: item["cited_by_count"].as_u64(),
                    open_access: item["open_access"]["is_oa"].as_bool(),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

pub fn parse_semantic_scholar(body: &str) -> Vec<LiteratureRecord> {
    let body = json(body);
    let empty = Vec::new();
    body["data"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let title = text(&item["title"])?;
            let source_id = text(&item["paperId"]).unwrap_or_else(|| format!("result-{index}"));
            let doi = item["externalIds"]["DOI"].as_str().and_then(normalize_doi);
            let pdf_url = safe_url(&item["openAccessPdf"]["url"]);
            Some(record(
                LiteratureSourceId::SemanticScholar,
                source_id,
                LiteratureRecord {
                    title,
                    authors: item["authors"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|author| text(&author["name"]))
                        .collect(),
                    year: year_from(&item["year"]),
                    venue: text(&item["venue"]),
                    url: doi
                        .as_ref()
                        .map(|doi| format!("https://doi.org/{doi}"))
                        .or_else(|| safe_url(&item["url"])),
                    doi,
                    arxiv_id: item["externalIds"]["ArXiv"].as_str().and_then(arxiv_id),
                    open_access: pdf_url.is_some().then_some(true),
                    pdf_url,
                    abstract_text: text(&item["abstract"]),
                    citation_count: item["citationCount"].as_u64(),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

pub fn parse_crossref(body: &str) -> Vec<LiteratureRecord> {
    let body = json(body);
    let empty = Vec::new();
    body["message"]["items"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let title = first_text(&item["title"])?;
            let doi = item["DOI"].as_str().and_then(normalize_doi);
            let source_id = doi.clone().unwrap_or_else(|| format!("result-{index}"));
            let year = item["issued"]["date-parts"][0][0].clone();
            Some(record(
                LiteratureSourceId::Crossref,
                source_id,
                LiteratureRecord {
                    title,
                    authors: item["author"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|author| {
                            text(&author["name"]).or_else(|| {
                                let given = author["given"].as_str().unwrap_or_default();
                                let family = author["family"].as_str().unwrap_or_default();
                                clean_text(&format!("{given} {family}"))
                            })
                        })
                        .collect(),
                    year: year_from(&year),
                    venue: first_text(&item["container-title"]),
                    url: doi
                        .as_ref()
                        .map(|doi| format!("https://doi.org/{doi}"))
                        .or_else(|| safe_url(&item["URL"])),
                    doi,
                    abstract_text: text(&item["abstract"]),
                    citation_count: item["is-referenced-by-count"].as_u64(),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

pub fn parse_pubmed(body: &str) -> Vec<LiteratureRecord> {
    let body = json(body);
    let result = &body["summary"]["result"];
    let empty = Vec::new();
    result["uids"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|uid| {
            let item = &result[uid];
            let title = text(&item["title"])?;
            let ids = item["articleids"].as_array().cloned().unwrap_or_default();
            let id_of = |kind: &str| {
                ids.iter()
                    .find(|identifier| identifier["idtype"].as_str() == Some(kind))
                    .and_then(|identifier| identifier["value"].as_str())
                    .map(str::to_owned)
            };
            let date = if item["pubdate"].is_string() {
                &item["pubdate"]
            } else {
                &item["epubdate"]
            };
            Some(record(
                LiteratureSourceId::Pubmed,
                uid.to_owned(),
                LiteratureRecord {
                    title,
                    authors: item["authors"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|author| text(&author["name"]))
                        .collect(),
                    year: year_from(date),
                    venue: text(&item["source"]),
                    doi: id_of("doi").as_deref().and_then(normalize_doi),
                    url: Some(format!("https://pubmed.ncbi.nlm.nih.gov/{uid}/")),
                    open_access: id_of("pmc").map(|_| true),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

pub fn parse_arxiv(body: &str) -> Vec<LiteratureRecord> {
    let Ok(document) = roxmltree::Document::parse(body) else {
        return Vec::new();
    };
    let child_text = |node: roxmltree::Node<'_, '_>, name: &str| {
        node.children()
            .find(|child| child.tag_name().name() == name)
            .and_then(|child| child.text())
            .and_then(clean_text)
    };
    document
        .descendants()
        .filter(|node| node.tag_name().name() == "entry")
        .enumerate()
        .filter_map(|(index, entry)| {
            let title = child_text(entry, "title")?;
            let entry_url = child_text(entry, "id");
            let id = entry_url.as_deref().and_then(arxiv_id);
            let source_id = id.clone().unwrap_or_else(|| format!("result-{index}"));
            let pdf = entry
                .children()
                .filter(|child| child.tag_name().name() == "link")
                .find(|link| {
                    link.attribute("title") == Some("pdf")
                        || link.attribute("type") == Some("application/pdf")
                })
                .and_then(|link| link.attribute("href"))
                .map(str::to_owned)
                .or_else(|| entry_url.as_ref().map(|url| url.replace("/abs/", "/pdf/")));
            let published = child_text(entry, "published");
            Some(record(
                LiteratureSourceId::Arxiv,
                source_id,
                LiteratureRecord {
                    title,
                    authors: entry
                        .children()
                        .filter(|child| child.tag_name().name() == "author")
                        .filter_map(|author| child_text(author, "name"))
                        .collect(),
                    year: published
                        .as_ref()
                        .and_then(|date| year_from(&Value::String(date.clone()))),
                    venue: child_text(entry, "journal_ref").or_else(|| Some("arXiv".into())),
                    doi: child_text(entry, "doi").as_deref().and_then(normalize_doi),
                    arxiv_id: id,
                    url: entry_url,
                    pdf_url: pdf,
                    abstract_text: child_text(entry, "summary"),
                    open_access: Some(true),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

pub fn parse_google_scholar(body: &str) -> Vec<LiteratureRecord> {
    let body = json(body);
    let empty = Vec::new();
    body["organic"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let title = text(&item["title"])?;
            let url = safe_url(&item["link"]);
            let arxiv = url
                .as_deref()
                .filter(|url| url.contains("arxiv.org/abs/") || url.contains("arxiv.org/pdf/"))
                .and_then(arxiv_id);
            let source_id = arxiv
                .clone()
                .or_else(|| url.clone())
                .unwrap_or_else(|| format!("result-{index}"));
            Some(record(
                LiteratureSourceId::GoogleScholar,
                source_id,
                LiteratureRecord {
                    title,
                    year: year_from(&item["year"]),
                    venue: text(&item["publication"]),
                    pdf_url: arxiv
                        .as_ref()
                        .map(|id| format!("https://arxiv.org/pdf/{id}")),
                    open_access: arxiv.as_ref().map(|_| true),
                    arxiv_id: arxiv,
                    url,
                    abstract_text: text(&item["snippet"]),
                    citation_count: item["citedBy"].as_u64(),
                    ..LiteratureRecord::default()
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossref_jats_abstracts_become_plain_text() {
        assert_eq!(
            clean_text("<jats:p>Hello <jats:italic>world</jats:italic> &amp; more</jats:p>")
                .as_deref(),
            Some("Hello world & more")
        );
    }

    #[test]
    fn arxiv_ids_lose_their_version() {
        assert_eq!(
            arxiv_id("http://arxiv.org/abs/2410.16464v2").as_deref(),
            Some("2410.16464")
        );
        assert_eq!(
            arxiv_id("arXiv:hep-th/9901001").as_deref(),
            Some("hep-th/9901001")
        );
    }

    #[test]
    fn arxiv_feeds_parse_with_authors_and_pdf_links() {
        let feed = r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
          <entry><id>http://arxiv.org/abs/2410.16464v1</id><published>2024-10-21T00:00:00Z</published>
          <title>Graph  Networks</title><summary> A study. </summary>
          <author><name>Ada Lovelace</name></author><arxiv:doi>10.1/x</arxiv:doi>
          <link title="pdf" href="http://arxiv.org/pdf/2410.16464v1" rel="related"/></entry></feed>"#;
        let records = parse_arxiv(feed);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].title, "Graph Networks");
        assert_eq!(records[0].arxiv_id.as_deref(), Some("2410.16464"));
        assert_eq!(records[0].authors, vec!["Ada Lovelace".to_owned()]);
        assert_eq!(records[0].doi.as_deref(), Some("10.1/x"));
        assert_eq!(records[0].year, Some(2024));
        assert_eq!(
            records[0].pdf_url.as_deref(),
            Some("http://arxiv.org/pdf/2410.16464v1")
        );
    }

    #[test]
    fn openalex_records_carry_doi_abstract_and_counts() {
        let body = r#"{"results":[{"id":"https://openalex.org/W1","doi":"https://doi.org/10.1/A","title":"A","publication_year":2021,
            "authorships":[{"author":{"display_name":"Jane"}}],"cited_by_count":4,"open_access":{"is_oa":true},"abstract":"Text."}]}"#;
        let records = parse_openalex(body);
        assert_eq!(records[0].id, "openalex:W1");
        assert_eq!(records[0].doi.as_deref(), Some("10.1/A"));
        assert_eq!(records[0].abstract_text.as_deref(), Some("Text."));
        assert_eq!(records[0].citation_count, Some(4));
    }
}
