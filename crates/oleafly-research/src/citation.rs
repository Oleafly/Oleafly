//! On-demand citation metadata lookup. Thin async HTTP to three fixed hosts
//! (doi.org, arXiv, Crossref); all parsing/normalization happens in TypeScript
//! so it stays unit-testable. Only the identifier or query is ever sent.

const UA: &str = "Oleafly/0.2 (https://github.com/Oleafly/Oleafly; citation lookup)";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// Redirects a lookup follows, at most.
const MAX_REDIRECTS: usize = 3;

/// Whether a lookup follows a redirect to `next` after `previous` hops. A DOI
/// whose agency cannot answer content negotiation redirects to the
/// registrant's own address, which can be anything: only a public https host
/// is followed, never a loopback, private or link-local address.
fn redirect_allowed(next: &reqwest::Url, previous: usize) -> bool {
    previous <= MAX_REDIRECTS && oleafly_agent::tools::web::check_public_https_url(next).is_ok()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if redirect_allowed(attempt.url(), attempt.previous().len()) {
                attempt.follow()
            } else {
                attempt.error("redirect to a disallowed address")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn response_bytes(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("The citation service returned more than 2 MB of data.".to_string());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("The citation service returned more than 2 MB of data.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn response_text(response: reqwest::Response) -> Result<String, String> {
    let body = response_bytes(response).await?;
    String::from_utf8(body).map_err(|_| "The citation service returned invalid text.".to_string())
}

async fn response_json(response: reqwest::Response) -> Result<serde_json::Value, String> {
    let body = response_bytes(response).await?;
    serde_json::from_slice(&body)
        .map_err(|error| format!("The citation service returned invalid JSON: {error}"))
}

/// Canonical BibTeX for a DOI, via doi.org content negotiation.
pub async fn fetch_doi_bibtex(doi: &str) -> Result<String, String> {
    let doi = doi
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("doi:")
        .trim();
    if doi.is_empty() || !doi.starts_with("10.") {
        return Err("Not a valid DOI.".to_string());
    }
    let url = format!("https://doi.org/{doi}");
    let resp = client()?
        .get(&url)
        .header("Accept", "application/x-bibtex")
        .send()
        .await
        .map_err(|e| format!("lookup failed: {e}"))?
        .error_for_status()
        .map_err(|_| "No entry found for that DOI.".to_string())?;
    response_text(resp).await
}

/// The arXiv Atom entry for an id (parsed to BibTeX in the frontend).
pub async fn fetch_arxiv(id: &str) -> Result<String, String> {
    let id = id.trim().trim_start_matches("arXiv:").trim();
    if id.is_empty() {
        return Err("Not a valid arXiv id.".to_string());
    }
    let url = "https://export.arxiv.org/api/query";
    let resp = client()?
        .get(url)
        .query(&[("id_list", id), ("max_results", "1")])
        .send()
        .await
        .map_err(|e| format!("lookup failed: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    response_text(resp).await
}

/// Crossref bibliographic search (JSON parsed in the frontend).
pub async fn crossref_search(query: &str) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(String::new());
    }
    let resp = client()?
        .get("https://api.crossref.org/works")
        .query(&[
            ("query.bibliographic", q),
            ("rows", "8"),
            ("select", "DOI,title,author,issued,container-title,type"),
        ])
        .send()
        .await
        .map_err(|e| format!("search failed: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    response_text(resp).await
}

// --- Citation verification ---------------------------------------------------

/// Whether a reference is real: its DOI resolves to the given title, or a
/// Crossref record carries the title.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CitationCheck {
    pub verified: bool,
    /// `"doi"` or `"crossref-search"`.
    pub source: String,
    pub doi: Option<String>,
    pub matched_title: Option<String>,
    pub score: Option<f32>,
    pub bibtex: Option<String>,
    pub reason: Option<String>,
}

const NO_CROSSREF_MATCH: &str = "No matching Crossref record found.";
const DOI_TITLE_MISMATCH: &str = "The DOI belongs to a different title.";

fn first_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(items) => items.iter().find_map(first_text),
        _ => None,
    }
    .map(|text| text.trim().to_owned())
    .filter(|text| !text.is_empty())
}

/// The Crossref work record (`message`) for a DOI.
pub async fn crossref_work(doi: &str) -> Result<serde_json::Value, String> {
    let doi = doi.trim();
    if !doi.starts_with("10.") {
        return Err("Not a valid DOI.".to_string());
    }
    let mut url = reqwest::Url::parse("https://api.crossref.org/works/")
        .map_err(|error| error.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Not a valid DOI.".to_string())?
        .pop_if_empty()
        .push(doi);
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("lookup failed: {}", error.without_url()))?
        .error_for_status()
        .map_err(|_| "No entry found for that DOI.".to_string())?;
    let mut body = response_json(response).await?;
    Ok(body["message"].take())
}

/// The best-matching item of a Crossref search response for `title` (not
/// simply the first one).
pub fn best_crossref_match(title: &str, body: &serde_json::Value) -> CitationCheck {
    let best = body["message"]["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let candidate = first_text(&item["title"])?;
            let subtitle = first_text(&item["subtitle"]);
            let score =
                crate::similarity::title_match_score(title, &candidate, subtitle.as_deref());
            Some((score, candidate, first_text(&item["DOI"])))
        })
        .max_by(|left, right| left.0.total_cmp(&right.0));
    match best {
        Some((score, candidate, doi)) => {
            let verified = score >= crate::similarity::TITLE_MATCH_THRESHOLD;
            CitationCheck {
                verified,
                source: "crossref-search".into(),
                doi,
                matched_title: Some(candidate),
                score: Some(score),
                bibtex: None,
                reason: (!verified).then(|| NO_CROSSREF_MATCH.to_owned()),
            }
        }
        None => CitationCheck {
            verified: false,
            source: "crossref-search".into(),
            doi: None,
            matched_title: None,
            score: None,
            bibtex: None,
            reason: Some(NO_CROSSREF_MATCH.to_owned()),
        },
    }
}

const DOI_TITLE_UNKNOWN: &str = "The DOI resolves, but its title could not be read.";

/// The `title` field of a BibTeX entry, braces removed.
fn bibtex_title(bibtex: &str) -> Option<String> {
    let lower = bibtex.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find("title") {
        let start = from + found;
        from = start + 5;
        // A field name, not the end of "booktitle" or "subtitle".
        if lower[..start]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            continue;
        }
        let rest = bibtex[from..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let (open, close) = match rest.chars().next() {
            Some('{') => ('{', '}'),
            Some('"') => ('"', '"'),
            _ => continue,
        };
        let mut depth = 0usize;
        let mut value = String::new();
        for (index, character) in rest.char_indices() {
            if index == 0 {
                continue;
            }
            if open == '{' && character == '{' {
                depth += 1;
                continue;
            }
            if character == close {
                if depth == 0 {
                    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
                    return (!value.is_empty()).then_some(value);
                }
                depth -= 1;
                continue;
            }
            value.push(character);
        }
        return None;
    }
    None
}

/// The DOI path: the DOI resolves, and its record carries `title` (when one
/// was given). The Crossref record names the title; DataCite DOIs (arXiv,
/// Zenodo) only have the BibTeX.
fn doi_check(
    doi: &str,
    title: Option<&str>,
    work: &serde_json::Value,
    bibtex: Option<String>,
) -> CitationCheck {
    let matched_title =
        first_text(&work["title"]).or_else(|| bibtex.as_deref().and_then(bibtex_title));
    let score = title
        .zip(matched_title.as_deref())
        .map(|(title, candidate)| {
            crate::similarity::title_match_score(
                title,
                candidate,
                first_text(&work["subtitle"]).as_deref(),
            )
        });
    let reason = match (title, score) {
        (None, _) => None,
        (Some(_), Some(score)) if score >= crate::similarity::TITLE_MATCH_THRESHOLD => None,
        (Some(_), Some(_)) => Some(DOI_TITLE_MISMATCH),
        (Some(_), None) => Some(DOI_TITLE_UNKNOWN),
    };
    CitationCheck {
        verified: reason.is_none(),
        source: "doi".into(),
        doi: Some(doi.to_owned()),
        matched_title,
        score,
        bibtex,
        reason: reason.map(str::to_owned),
    }
}

/// Checks a reference by DOI (and title, when given) or by title alone.
pub async fn verify_citation(
    doi: Option<&str>,
    title: Option<&str>,
) -> Result<CitationCheck, String> {
    let doi = doi
        .map(|doi| {
            doi.trim()
                .trim_start_matches("https://doi.org/")
                .trim_start_matches("http://doi.org/")
                .trim_start_matches("doi:")
                .trim()
        })
        .filter(|doi| !doi.is_empty());
    let title = title.map(str::trim).filter(|title| !title.is_empty());
    if let Some(doi) = doi {
        let (bibtex, work) = tokio::join!(fetch_doi_bibtex(doi), crossref_work(doi));
        return match (bibtex, work) {
            (Err(error), Err(_)) => Ok(CitationCheck {
                verified: false,
                source: "doi".into(),
                doi: Some(doi.to_owned()),
                matched_title: None,
                score: None,
                bibtex: None,
                reason: Some(error),
            }),
            (bibtex, work) => Ok(doi_check(
                doi,
                title,
                &work.unwrap_or(serde_json::Value::Null),
                bibtex.ok(),
            )),
        };
    }
    let Some(title) = title else {
        return Err("Give a DOI or a title to check.".to_string());
    };
    let body: serde_json::Value = serde_json::from_str(&crossref_search(title).await?)
        .map_err(|error| format!("The citation service returned invalid JSON: {error}"))?;
    Ok(best_crossref_match(title, &body))
}

// --- ISBN and PMID lookups ---------------------------------------------------

/// Strip separator characters and validate an ISBN-10/13 with its check digit.
fn normalize_isbn(raw: &str) -> Result<String, String> {
    let isbn: String = raw
        .trim()
        .trim_start_matches("isbn:")
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_uppercase();
    let valid = if isbn.len() == 13 && isbn.chars().all(|c| c.is_ascii_digit()) {
        isbn.bytes()
            .enumerate()
            .map(|(index, digit)| {
                let value = u32::from(digit - b'0');
                if index % 2 == 0 {
                    value
                } else {
                    value * 3
                }
            })
            .sum::<u32>()
            % 10
            == 0
    } else if isbn.len() == 10
        && isbn[..9].chars().all(|c| c.is_ascii_digit())
        && matches!(isbn.as_bytes()[9], b'0'..=b'9' | b'X')
    {
        isbn.bytes()
            .enumerate()
            .map(|(index, digit)| {
                let value = if digit == b'X' {
                    10
                } else {
                    u32::from(digit - b'0')
                };
                value * (10 - index as u32)
            })
            .sum::<u32>()
            % 11
            == 0
    } else {
        false
    };
    if !valid {
        return Err("Not a valid ISBN-10 or ISBN-13.".to_string());
    }
    Ok(isbn)
}

/// Render a person list the way the app's cite keys expect it: family name
/// first, then initials, joined with " and ".
fn bibtex_authors(names: &[String]) -> String {
    names
        .iter()
        .map(|raw| {
            let name = raw.trim();
            if name.contains(',') {
                return name.to_string();
            }
            let mut parts = name.split_whitespace();
            let family = parts.next().unwrap_or_default().to_string();
            // PubMed compresses given names to bare initials ("Smith JA").
            // Expand all-uppercase tokens letter by letter, otherwise take
            // the first letter of each spelled-out name.
            let initials: Vec<String> = parts
                .flat_map(|token| {
                    if token.chars().all(|c| !c.is_ascii_lowercase()) && token.len() <= 3 {
                        token
                            .chars()
                            .filter(char::is_ascii_alphabetic)
                            .map(|c| format!("{c}."))
                            .collect::<Vec<_>>()
                    } else {
                        vec![format!("{}.", token.chars().next().unwrap_or_default()).to_string()]
                    }
                })
                .collect();
            if initials.is_empty() {
                family
            } else {
                format!("{family}, {}", initials.join(" "))
            }
        })
        .collect::<Vec<_>>()
        .join(" and ")
}

/// The app's citation key scheme (shared with the CLI).
pub use oleafly_core::bibkey::{cite_key, year_of};

fn brace_field(value: &str) -> String {
    format!("{{{}}}", value.replace(['{', '}'], ""))
}

fn string_list(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn text_field<'a>(record: Option<&'a serde_json::Value>, name: &str) -> Option<&'a str> {
    record
        .and_then(|value| value.get(name))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The `api/books` shape assembled from an edition record (`/isbn/<isbn>.json`)
/// and a search hit (`search.json?isbn=`), for when that endpoint is down.
pub fn merge_isbn_records(
    edition: Option<&serde_json::Value>,
    search: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let title = text_field(edition, "title").or_else(|| text_field(search, "title"))?;
    let authors: Vec<serde_json::Value> =
        string_list(search.and_then(|hit| hit.get("author_name")))
            .into_iter()
            .map(|name| serde_json::json!({ "name": name }))
            .collect();
    let publisher = string_list(edition.and_then(|record| record.get("publishers")))
        .into_iter()
        .next()
        .or_else(|| {
            string_list(search.and_then(|hit| hit.get("publisher")))
                .into_iter()
                .next()
        });
    let publish_date = text_field(edition, "publish_date")
        .map(str::to_string)
        .or_else(|| {
            search
                .and_then(|hit| hit.get("first_publish_year"))
                .map(|year| match year {
                    serde_json::Value::Number(number) => number.to_string(),
                    serde_json::Value::String(text) => text.clone(),
                    _ => String::new(),
                })
        });
    Some(serde_json::json!({
        "title": title,
        "authors": authors,
        "publishers": publisher
            .map(|name| vec![serde_json::json!({ "name": name })])
            .unwrap_or_default(),
        "publish_date": publish_date.unwrap_or_default(),
    }))
}

/// BibTeX for a book, from OpenLibrary's ISBN view (`?jscmd=data`).
/// The JSON shape here is stable and covered by unit tests below.
pub fn isbn_bibtex(data: &serde_json::Value, isbn: &str) -> Result<String, String> {
    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or("OpenLibrary returned no title for that ISBN.")?;
    let authors: Vec<String> = data
        .get("authors")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                .map(|n| n.to_string())
                .collect()
        })
        .unwrap_or_default();
    let publisher = data
        .get("publishers")
        .and_then(|v| v.as_array())
        .and_then(|list| list.first())
        .and_then(|p| p.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or_default();
    let date = data
        .get("publish_date")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let year = year_of(date);
    let author_list = authors
        .iter()
        .map(|name| name.trim())
        .collect::<Vec<_>>()
        .join(" and ");
    let key = cite_key(&author_list, &year, title);
    let mut fields = vec![
        ("author", brace_field(&author_list)),
        ("title", brace_field(title)),
    ];
    if !publisher.is_empty() {
        fields.push(("publisher", brace_field(publisher)));
    }
    if !year.is_empty() {
        fields.push(("year", format!("{{{year}}}")));
    }
    fields.push(("isbn", brace_field(isbn)));
    Ok(format!(
        "@book{{{key},\n{}\n}}",
        fields
            .iter()
            .map(|(k, v)| format!("  {k} = {v}"))
            .collect::<Vec<_>>()
            .join(",\n")
    ))
}

async fn openlibrary_json(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let resp = client
        .get(url)
        .query(query)
        .send()
        .await
        .map_err(|e| format!("lookup failed: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    response_json(resp)
        .await
        .map_err(|error| format!("OpenLibrary returned an unreadable response: {error}"))
}

async fn isbn_books_entry(client: &reqwest::Client, isbn: &str) -> Option<serde_json::Value> {
    let data = openlibrary_json(
        client,
        "https://openlibrary.org/api/books",
        &[
            ("bibkeys", format!("ISBN:{isbn}").as_str()),
            ("jscmd", "data"),
            ("format", "json"),
        ],
    )
    .await
    .ok()?;
    data.get(format!("ISBN:{isbn}")).cloned()
}

async fn isbn_edition(client: &reqwest::Client, isbn: &str) -> Option<serde_json::Value> {
    let record = openlibrary_json(
        client,
        &format!("https://openlibrary.org/isbn/{isbn}.json"),
        &[],
    )
    .await
    .ok()?;
    record.get("title").and_then(|v| v.as_str())?;
    Some(record)
}

async fn isbn_search_hit(
    client: &reqwest::Client,
    isbn: &str,
) -> Result<Option<serde_json::Value>, String> {
    let data = openlibrary_json(
        client,
        "https://openlibrary.org/search.json",
        &[
            ("isbn", isbn),
            ("fields", "title,author_name,publisher,first_publish_year"),
            ("limit", "1"),
        ],
    )
    .await?;
    Ok(data
        .get("docs")
        .and_then(|docs| docs.as_array())
        .and_then(|docs| docs.first())
        .cloned())
}

/// Canonical BibTeX for an ISBN, via OpenLibrary. The `api/books` view
/// answers directly with authors and publishers; when it is unavailable the
/// edition record and a search hit supply the same fields between them.
pub async fn fetch_isbn_bibtex(isbn: &str) -> Result<String, String> {
    let isbn = normalize_isbn(isbn)?;
    let client = client()?;
    if let Some(entry) = isbn_books_entry(&client, &isbn).await {
        return isbn_bibtex(&entry, &isbn);
    }
    let edition = isbn_edition(&client, &isbn).await;
    let hit = isbn_search_hit(&client, &isbn).await?;
    let record =
        merge_isbn_records(edition.as_ref(), hit.as_ref()).ok_or("No book found for that ISBN.")?;
    isbn_bibtex(&record, &isbn)
}

/// BibTeX for an article, from NCBI's PubMed esummary record.
pub fn pmid_bibtex(result: &serde_json::Value, pmid: &str) -> Result<String, String> {
    let entry = result
        .get(pmid)
        .ok_or_else(|| "PubMed returned no record for that PMID.".to_string())?;
    let title = entry
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or("PubMed returned no title for that PMID.")?;
    let authors: Vec<String> = entry
        .get("authors")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                .map(|n| n.to_string())
                .collect()
        })
        .unwrap_or_default();
    let journal = entry
        .get("fulljournalname")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("source").and_then(|v| v.as_str()))
        .unwrap_or_default();
    let date = entry
        .get("pubdate")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let year = year_of(date);
    let volume = entry.get("volume").and_then(|v| v.as_str()).unwrap_or("");
    let issue = entry.get("issue").and_then(|v| v.as_str()).unwrap_or("");
    let pages = entry
        .get("pages")
        .and_then(|v| v.as_str())
        .filter(|p| !p.trim().is_empty())
        .unwrap_or("");
    let doi = entry
        .get("elocationid")
        .and_then(|v| v.as_str())
        .and_then(|v| v.split("doi:").nth(1))
        .map(|d| d.trim().trim_end_matches('.'))
        .unwrap_or("");
    let author_list = bibtex_authors(&authors);
    let key = cite_key(&author_list, &year, title);
    let mut fields = vec![
        ("author", brace_field(&author_list)),
        ("title", brace_field(title)),
    ];
    if !journal.is_empty() {
        fields.push(("journal", brace_field(journal)));
    }
    if !volume.is_empty() {
        fields.push(("volume", brace_field(volume)));
    }
    if !issue.is_empty() {
        fields.push(("number", brace_field(issue)));
    }
    if !pages.is_empty() {
        fields.push(("pages", brace_field(pages)));
    }
    if !year.is_empty() {
        fields.push(("year", format!("{{{year}}}")));
    }
    if !doi.is_empty() {
        fields.push(("doi", brace_field(doi)));
    }
    fields.push(("pmid", brace_field(pmid)));
    Ok(format!(
        "@article{{{key},\n{}\n}}",
        fields
            .iter()
            .map(|(k, v)| format!("  {k} = {v}"))
            .collect::<Vec<_>>()
            .join(",\n")
    ))
}

/// Canonical BibTeX for a PMID, via NCBI E-utilities (no key required).
pub async fn fetch_pmid_bibtex(pmid: &str) -> Result<String, String> {
    let pmid = pmid.trim().trim_start_matches("PMID:").trim();
    if pmid.is_empty() || pmid.len() > 10 || !pmid.chars().all(|c| c.is_ascii_digit()) {
        return Err("Not a valid PubMed ID.".to_string());
    }
    let resp = client()?
        .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")
        .query(&[("db", "pubmed"), ("id", pmid), ("retmode", "json")])
        .send()
        .await
        .map_err(|e| format!("lookup failed: {e}"))?
        .error_for_status()
        .map_err(|_| "No record found for that PMID.".to_string())?;
    let data = response_json(resp)
        .await
        .map_err(|error| format!("PubMed returned an unreadable response: {error}"))?;
    let result = data
        .get("result")
        .cloned()
        .ok_or("PubMed returned no result for that PMID.")?;
    pmid_bibtex(&result, pmid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn url(text: &str) -> reqwest::Url {
        reqwest::Url::parse(text).unwrap()
    }

    #[test]
    fn lookups_follow_redirects_only_to_public_https_hosts() {
        assert!(redirect_allowed(
            &url("https://api.crossref.org/works/x"),
            0
        ));
        assert!(redirect_allowed(
            &url("https://example.org/paper"),
            MAX_REDIRECTS
        ));
        assert!(!redirect_allowed(
            &url("https://example.org/paper"),
            MAX_REDIRECTS + 1
        ));
        for refused in [
            "http://example.org/paper",
            "https://localhost/x",
            "https://127.0.0.1/x",
            "https://[::1]/x",
            "https://10.0.0.5/x",
            "https://192.168.1.10/x",
            "https://169.254.169.254/latest/meta-data",
            "https://printer.local/x",
            "https://user:pass@example.org/x",
        ] {
            assert!(!redirect_allowed(&url(refused), 0), "{refused}");
        }
    }

    #[tokio::test]
    async fn a_redirect_to_a_loopback_address_is_not_followed() {
        use axum::{
            http::{header::LOCATION, StatusCode},
            routing::get,
            Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let target = format!("http://{address}/secret");
        let router = Router::new()
            .route(
                "/start",
                get(move || {
                    let target = target.clone();
                    async move { (StatusCode::FOUND, [(LOCATION, target)]) }
                }),
            )
            .route("/secret", get(|| async { "internal data" }));
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        let result = client()
            .unwrap()
            .get(format!("http://{address}/start"))
            .send()
            .await;
        server.abort();
        // The redirect is refused, so the answer never arrives.
        assert!(result.is_err(), "{result:?}");
    }

    #[test]
    fn verification_picks_the_best_crossref_item_not_the_first() {
        let body = json!({"message":{"items":[
            {"title":["Unrelated survey"],"DOI":"10.1/a"},
            {"title":["Attention is all you need"],"DOI":"10.1/b"}
        ]}});
        let check = best_crossref_match("Attention Is All You Need", &body);
        assert!(check.verified);
        assert_eq!(check.doi.as_deref(), Some("10.1/b"));
        assert_eq!(check.source, "crossref-search");
    }

    #[test]
    fn verification_reports_unverified_with_the_closest_candidate() {
        let body = json!({"message":{"items":[
            {"title":["Attention is not all you need"],"DOI":"10.1/a"},
            {"title":["Graph networks"],"DOI":"10.1/b"}
        ]}});
        let check = best_crossref_match("Attention Is All You Need", &body);
        assert!(!check.verified);
        assert_eq!(
            check.reason.as_deref(),
            Some("No matching Crossref record found.")
        );
        assert_eq!(
            check.matched_title.as_deref(),
            Some("Attention is not all you need")
        );
        let empty = best_crossref_match("Anything", &json!({"message":{"items":[]}}));
        assert!(!empty.verified);
        assert_eq!(empty.matched_title, None);
    }

    #[test]
    fn a_doi_with_a_mismatched_title_is_not_verified() {
        let work = json!({"title": ["Other paper"]});
        let check = doi_check(
            "10.1/x",
            Some("Attention Is All You Need"),
            &work,
            Some("@article{x}".into()),
        );
        assert!(!check.verified);
        assert_eq!(
            check.reason.as_deref(),
            Some("The DOI belongs to a different title.")
        );
        let same = doi_check("10.1/x", Some("Other Paper."), &work, None);
        assert!(same.verified);
        assert_eq!(same.source, "doi");
        let untitled = doi_check(
            "10.1/x",
            None,
            &serde_json::Value::Null,
            Some("@misc{x}".into()),
        );
        assert!(untitled.verified);
    }

    #[test]
    fn a_datacite_doi_is_checked_against_its_bibtex_title() {
        let bibtex = "@misc{vaswani2017,\n  booktitle = {Proceedings},\n  title = {Attention Is {All} You Need},\n  year = {2017}\n}";
        assert_eq!(
            bibtex_title(bibtex).as_deref(),
            Some("Attention Is All You Need")
        );
        let check = doi_check(
            "10.48550/arXiv.1706.03762",
            Some("Attention is all you need"),
            &serde_json::Value::Null,
            Some(bibtex.into()),
        );
        assert!(check.verified, "{check:?}");
        let unreadable = doi_check(
            "10.1/x",
            Some("A title"),
            &serde_json::Value::Null,
            Some("@misc{x, year = {1}}".into()),
        );
        assert_eq!(
            unreadable.reason.as_deref(),
            Some("The DOI resolves, but its title could not be read.")
        );
    }

    #[test]
    fn year_accepts_iso_and_free_form_dates_without_truncating_numbers() {
        for date in ["2020-01-05", "5 March 2020", "2020/2021", "(2020)"] {
            assert_eq!(year_of(date), "2020");
        }
        for date in ["undated", "12345", "20200105"] {
            assert_eq!(year_of(date), "");
        }
    }

    #[test]
    fn isbn_normalization_accepts_separated_forms() {
        assert_eq!(
            normalize_isbn("978-0-13-468599-1").unwrap(),
            "9780134685991"
        );
        assert_eq!(normalize_isbn("0-201-63361-2").unwrap(), "0201633612");
        assert_eq!(normalize_isbn("isbn:080442957X").unwrap(), "080442957X");
        assert!(normalize_isbn("isbn:020163361X").is_err());
        assert!(normalize_isbn("12345").is_err());
        assert!(normalize_isbn("978013468599X").is_err());
        assert!(normalize_isbn("9780134685992").is_err());
        assert!(normalize_isbn("0201633613").is_err());
    }

    #[test]
    fn isbn_bibtex_maps_openlibrary_fields() {
        let data = serde_json::json!({
            "title": "Deep Learning",
            "authors": [{"name": "Ian Goodfellow"}, {"name": "Yoshua Bengio"}],
            "publishers": [{"name": "MIT Press"}],
            "publish_date": "November 2016",
        });
        let bib = isbn_bibtex(&data, "9780262035613").unwrap();
        assert!(bib.starts_with("@book{goodfellow2016deep,"), "{bib}");
        assert!(bib.contains("author = {Ian Goodfellow and Yoshua Bengio}"));
        assert!(bib.contains("publisher = {MIT Press}"));
        assert!(bib.contains("year = {2016}"));
        assert!(bib.contains("isbn = {9780262035613}"));
        assert!(bib.ends_with("}"));
    }

    #[test]
    fn merged_isbn_records_prefer_the_edition_and_take_authors_from_search() {
        let edition = serde_json::json!({
            "title": "Deep Learning",
            "publishers": ["MIT Press"],
            "publish_date": "3 January 2017",
            "works": [{"key": "/works/OL17801809W"}],
        });
        let hit = serde_json::json!({
            "title": "Deep learning (search title)",
            "author_name": ["Ian Goodfellow", "Yoshua Bengio", "Aaron Courville"],
            "publisher": ["deeplearningbook.org", "MIT Press"],
            "first_publish_year": 2016,
        });
        let record = merge_isbn_records(Some(&edition), Some(&hit)).unwrap();
        let bib = isbn_bibtex(&record, "9780262035613").unwrap();
        assert!(bib.starts_with("@book{goodfellow2017deep,"), "{bib}");
        assert!(bib.contains("author = {Ian Goodfellow and Yoshua Bengio and Aaron Courville}"));
        assert!(bib.contains("title = {Deep Learning}"));
        assert!(bib.contains("publisher = {MIT Press}"));
        assert!(bib.contains("year = {2017}"));
    }

    #[test]
    fn merged_isbn_records_fall_back_to_the_search_hit_alone() {
        let hit = serde_json::json!({
            "title": "Deep Learning",
            "author_name": ["Ian Goodfellow"],
            "publisher": ["MIT Press"],
            "first_publish_year": 2016,
        });
        let record = merge_isbn_records(None, Some(&hit)).unwrap();
        let bib = isbn_bibtex(&record, "9780262035613").unwrap();
        assert!(bib.starts_with("@book{goodfellow2016deep,"), "{bib}");
        assert!(bib.contains("publisher = {MIT Press}"));
        assert!(bib.contains("year = {2016}"));
    }

    #[test]
    fn merged_isbn_records_survive_an_edition_without_authors_and_reject_nothing_useful() {
        let edition = serde_json::json!({
            "title": "Deep Learning",
            "publishers": ["MIT Press"],
            "publish_date": "2017",
        });
        let record = merge_isbn_records(Some(&edition), None).unwrap();
        let bib = isbn_bibtex(&record, "9780262035613").unwrap();
        assert!(bib.contains("author = {}"), "{bib}");
        assert!(bib.contains("title = {Deep Learning}"));
        assert!(bib.contains("year = {2017}"));

        let untitled = serde_json::json!({ "author_name": ["Somebody"] });
        assert!(merge_isbn_records(None, Some(&untitled)).is_none());
        assert!(merge_isbn_records(None, None).is_none());
    }

    #[test]
    fn pmid_bibtex_maps_pubmed_fields() {
        let data = serde_json::json!({
            "result": {
                "32172672": {
                    "title": "Effects of working from home",
                    "authors": [{"name": "Smith Jane A"}, {"name": "Doe John"}],
                    "fulljournalname": "BMJ",
                    "pubdate": "2020 Mar 14",
                    "volume": "368",
                    "issue": "2",
                    "pages": "1126-1131",
                    "elocationid": "doi: 10.1136/bmj.m1126.",
                }
            }
        });
        let bib = pmid_bibtex(&data["result"], "32172672").unwrap();
        assert!(bib.starts_with("@article{smith2020effects,"), "{bib}");
        assert!(bib.contains("author = {Smith, J. A. and Doe, J.}"));
        assert!(bib.contains("journal = {BMJ}"));
        assert!(bib.contains("pages = {1126-1131}"));
        assert!(bib.contains("doi = {10.1136/bmj.m1126}"));
        assert!(bib.contains("pmid = {32172672}"));
    }
}
