//! Local-first literature search transport.
//!
//! The webview invokes one source at a time and fans the calls out in parallel.
//! This module deliberately exposes a small source enum instead of an arbitrary
//! URL fetcher: every request goes directly from the desktop app to a reviewed,
//! fixed scholarly-data host. Normalization, deduplication, caching, and library
//! persistence stay in TypeScript where they are easy to unit test.

use reqwest::RequestBuilder;
use serde_json::{json, Value};

const UA: &str = "Oleafly/0.2 (https://github.com/Oleafly/Oleafly; literature search)";

/// Trim and validate an OpenAlex polite-pool contact email.
fn sanitize_openalex_email(raw: &str) -> Option<&str> {
    let email = raw.trim();
    if email.is_empty() || !email.contains('@') {
        None
    } else {
        Some(email)
    }
}

/// User-Agent for OpenAlex only: appends mailto when a contact email is configured.
fn literature_user_agent() -> String {
    let mut ua = UA.to_string();
    if let Ok(secrets) = crate::secrets::read_connector_secrets() {
        if let Some(email) = secrets
            .get("openalex-email")
            .map(|s| s.as_str())
            .and_then(sanitize_openalex_email)
        {
            // OpenAlex polite pool: contact in User-Agent
            ua = format!("{UA} (mailto:{email})");
        }
    }
    ua
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| error.to_string())
}

async fn response_text(source: &str, request: RequestBuilder) -> Result<String, String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("{source} search failed: {error}"))?;
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().await.map_err(|error| error.to_string())?;

    if status.is_success() {
        return Ok(body);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let wait = retry_after
            .map(|seconds| format!(" Retry after {seconds} seconds."))
            .unwrap_or_default();
        return Err(format!("{source} is rate-limiting this search.{wait}"));
    }
    Err(format!("{source} returned HTTP {status}."))
}

fn year_range(year_from: Option<u16>, year_to: Option<u16>) -> Option<(u16, u16)> {
    if year_from.is_none() && year_to.is_none() {
        return None;
    }
    let from = year_from.unwrap_or(1900).clamp(1800, 2200);
    let to = year_to.unwrap_or(2200).clamp(1800, 2200);
    Some((from.min(to), from.max(to)))
}

async fn search_openalex(
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> Result<String, String> {
    let mut params = vec![
        ("search".to_string(), query.to_string()),
        ("per-page".to_string(), limit.to_string()),
        (
            "select".to_string(),
            "id,doi,title,publication_year,publication_date,type,authorships,primary_location,cited_by_count,open_access,best_oa_location,ids".to_string(),
        ),
    ];
    let mut filters = Vec::new();
    if let Some((from, to)) = years {
        filters.push(format!("publication_year:{from}-{to}"));
    }
    if open_access_only {
        filters.push("is_oa:true".to_string());
    }
    if !filters.is_empty() {
        params.push(("filter".to_string(), filters.join(",")));
    }
    response_text(
        "OpenAlex",
        client()?
            .get("https://api.openalex.org/works")
            .header("User-Agent", literature_user_agent())
            .query(&params),
    )
    .await
}

async fn search_semantic_scholar(
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
) -> Result<String, String> {
    let mut params = vec![
        ("query".to_string(), query.to_string()),
        ("limit".to_string(), limit.to_string()),
        (
            "fields".to_string(),
            "paperId,title,authors,year,venue,publicationDate,externalIds,url,openAccessPdf,citationCount,publicationTypes,abstract".to_string(),
        ),
    ];
    if let Some((from, to)) = years {
        params.push(("year".to_string(), format!("{from}-{to}")));
    }
    let mut request = client()?
        .get("https://api.semanticscholar.org/graph/v1/paper/search")
        .query(&params);
    if let Some(key) = crate::secrets::read_connector_secrets()?
        .get("semantic-scholar")
        .filter(|key| !key.trim().is_empty())
    {
        request = request.header("x-api-key", key);
    }
    response_text("Semantic Scholar", request).await.map_err(|error| {
        if error.contains("rate-limiting") {
            "Semantic Scholar is rate-limiting anonymous searches. Results from other selected sources remain available. Configure an optional API key to increase this limit.".to_string()
        } else {
            error
        }
    })
}

/// Look up a single arXiv paper on Semantic Scholar to backfill authors and
/// venue for sources that return bare titles (e.g. Google Scholar via Serper).
#[tauri::command]
pub async fn literature_arxiv_lookup(arxiv_id: String) -> Result<String, String> {
    let id = arxiv_id.trim();
    let valid = !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '/'));
    if !valid {
        return Err("invalid arXiv id".to_string());
    }
    let mut request = client()?
        .get(format!(
            "https://api.semanticscholar.org/graph/v1/paper/arXiv:{id}"
        ))
        .query(&[(
            "fields",
            "title,authors,year,venue,externalIds,citationCount",
        )]);
    if let Some(key) = crate::secrets::read_connector_secrets()?
        .get("semantic-scholar")
        .filter(|key| !key.trim().is_empty())
    {
        request = request.header("x-api-key", key);
    }
    response_text("Semantic Scholar", request).await
}

async fn search_crossref(
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
) -> Result<String, String> {
    let mut params = vec![
        ("query.bibliographic".to_string(), query.to_string()),
        ("rows".to_string(), limit.to_string()),
        (
            "select".to_string(),
            "DOI,title,author,issued,container-title,type,URL,is-referenced-by-count,abstract"
                .to_string(),
        ),
    ];
    if let Some((from, to)) = years {
        params.push((
            "filter".to_string(),
            format!("from-pub-date:{from}-01-01,until-pub-date:{to}-12-31"),
        ));
    }
    response_text(
        "Crossref",
        client()?
            .get("https://api.crossref.org/works")
            .query(&params),
    )
    .await
}

async fn search_pubmed(
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> Result<String, String> {
    let mut term = query.to_string();
    if let Some((from, to)) = years {
        term.push_str(&format!(" AND {from}:{to}[pdat]"));
    }
    if open_access_only {
        term.push_str(" AND free full text[sb]");
    }
    let search = response_text(
        "PubMed",
        client()?
            .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
            .query(&[
                ("db", "pubmed"),
                ("term", term.as_str()),
                ("retmax", &limit.to_string()),
                ("retmode", "json"),
                ("sort", "relevance"),
                ("tool", "oleafly"),
            ]),
    )
    .await?;
    let search_json: Value = serde_json::from_str(&search)
        .map_err(|error| format!("PubMed returned invalid JSON: {error}"))?;
    let total = search_json["esearchresult"]["count"]
        .as_str()
        .unwrap_or("0")
        .to_string();
    let ids = search_json["esearchresult"]["idlist"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();

    if ids.is_empty() {
        return serde_json::to_string(&json!({
            "total": total,
            "summary": { "result": { "uids": [] } }
        }))
        .map_err(|error| error.to_string());
    }

    let summary = response_text(
        "PubMed",
        client()?
            .get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")
            .query(&[
                ("db", "pubmed"),
                ("id", ids.as_str()),
                ("retmode", "json"),
                ("version", "2.0"),
                ("tool", "oleafly"),
            ]),
    )
    .await?;
    let summary_json: Value = serde_json::from_str(&summary)
        .map_err(|error| format!("PubMed returned invalid summary JSON: {error}"))?;
    serde_json::to_string(&json!({ "total": total, "summary": summary_json }))
        .map_err(|error| error.to_string())
}

async fn search_arxiv(query: &str, limit: u8, years: Option<(u16, u16)>) -> Result<String, String> {
    let mut expression = format!("all:{query}");
    if let Some((from, to)) = years {
        expression.push_str(&format!(
            " AND submittedDate:[{from}01010000 TO {to}12312359]"
        ));
    }
    response_text(
        "arXiv",
        client()?.get("https://export.arxiv.org/api/query").query(&[
            ("search_query", expression.as_str()),
            ("start", "0"),
            ("max_results", &limit.to_string()),
            ("sortBy", "relevance"),
            ("sortOrder", "descending"),
        ]),
    )
    .await
}

/// Google Scholar via Serper (`google.serper.dev/scholar`). Requires connector secret `serper`.
async fn search_google_scholar(query: &str, limit: u8) -> Result<String, String> {
    let key = crate::secrets::read_connector_secrets()?
        .get("serper")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Google Scholar via Serper needs an API key. Add it under Settings → Integrations → Citation Search."
                .to_string()
        })?;
    let body = json!({ "q": query, "num": limit });
    response_text(
        "Google Scholar",
        client()?
            .post("https://google.serper.dev/scholar")
            .header("X-API-KEY", key)
            .header("Content-Type", "application/json")
            .json(&body),
    )
    .await
}

/// Search one reviewed scholarly source. The frontend invokes this once per
/// selected source with `Promise.allSettled`, so one slow or unavailable index
/// never suppresses results from the others.
#[tauri::command]
pub async fn literature_search(
    source: String,
    query: String,
    limit: u8,
    year_from: Option<u16>,
    year_to: Option<u16>,
    open_access_only: bool,
) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Search query cannot be empty.".to_string());
    }
    if query.chars().count() > 500 {
        return Err("Search query is too long (500 characters maximum).".to_string());
    }
    let limit = limit.clamp(1, 25);
    let years = year_range(year_from, year_to);
    match source.as_str() {
        "openalex" => search_openalex(query, limit, years, open_access_only).await,
        "semantic-scholar" => search_semantic_scholar(query, limit, years).await,
        "crossref" => search_crossref(query, limit, years).await,
        "pubmed" => search_pubmed(query, limit, years, open_access_only).await,
        "arxiv" => search_arxiv(query, limit, years).await,
        "google-scholar" => search_google_scholar(query, limit).await,
        "uspto" => Err(
            "USPTO has temporarily paused PatentsView search APIs during its Open Data Portal migration."
                .to_string(),
        ),
        _ => Err("Unknown literature source.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{sanitize_openalex_email, year_range};

    #[test]
    fn normalizes_partial_and_reversed_year_ranges() {
        assert_eq!(year_range(Some(2024), Some(2020)), Some((2020, 2024)));
        assert_eq!(year_range(Some(2018), None), Some((2018, 2200)));
        assert_eq!(year_range(None, None), None);
    }

    #[test]
    fn openalex_email_requires_at_sign() {
        assert_eq!(sanitize_openalex_email("  a@b.co  "), Some("a@b.co"));
        assert_eq!(sanitize_openalex_email("not-an-email"), None);
        assert_eq!(sanitize_openalex_email(""), None);
    }
}
