use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use reqwest::RequestBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::host::ConnectorSecrets;
use crate::model::now_ms;

pub mod cache;
pub mod merge;
pub mod paper;
#[cfg(test)]
mod search_tests;
pub mod sources;

pub use sources::{LiteratureRecord, LiteratureSourceId};

const UA: &str = "Oleafly/0.2 (https://github.com/Oleafly/Oleafly; literature search)";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

fn sanitize_openalex_email(raw: &str) -> Option<&str> {
    let email = raw.trim();
    if email.is_empty() || !email.contains('@') {
        None
    } else {
        Some(email)
    }
}

/// The configured OpenAlex API key, if any. Keys became mandatory for
/// meaningful daily volumes in February 2026, so searches work without one
/// but degrade quickly.
fn openalex_api_key(secrets: &dyn ConnectorSecrets) -> Option<String> {
    secrets
        .get("openalex-api-key")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn literature_user_agent(secrets: &dyn ConnectorSecrets) -> String {
    let mut ua = UA.to_string();
    if let Some(email) = secrets.get("openalex-email") {
        if let Some(email) = sanitize_openalex_email(email.as_str()) {
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

fn request_error(source: &str, error: reqwest::Error) -> String {
    format!("{source} search failed: {}", error.without_url())
}

const MAX_RETRIES: u32 = 2;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(10);

fn retry_wait(attempt: u32, retry_after: Option<&str>) -> Duration {
    retry_after
        .and_then(|seconds| seconds.trim().parse::<u64>().ok())
        .map(|seconds| Duration::from_secs(seconds).min(MAX_RETRY_WAIT))
        .unwrap_or(if attempt == 0 {
            Duration::from_secs(1)
        } else {
            Duration::from_secs(3)
        })
}

async fn response_text(source: &str, request: RequestBuilder) -> Result<String, String> {
    let mut request = request;
    let mut attempt = 0;
    let response = loop {
        let again = request.try_clone();
        let response = request
            .send()
            .await
            .map_err(|error| request_error(source, error))?;
        let status = response.status();
        let limited = status == reqwest::StatusCode::TOO_MANY_REQUESTS
            || status == reqwest::StatusCode::SERVICE_UNAVAILABLE;
        match again {
            Some(again) if limited && attempt < MAX_RETRIES => {
                let wait = retry_wait(
                    attempt,
                    response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|value| value.to_str().ok()),
                );
                tokio::time::sleep(wait).await;
                attempt += 1;
                request = again;
            }
            _ => break response,
        }
    };
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(format!("{source} returned more than 2 MB of data."));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.without_url().to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(format!("{source} returned more than 2 MB of data."));
        }
        body.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(body).map_err(|_| format!("{source} returned invalid text."))?;

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

const MAX_ABSTRACT_WORDS: usize = 5_000;

/// OpenAlex sends abstracts as a word → positions index. Rebuilds each into
/// plain `abstract` text and drops the index.
pub fn with_openalex_abstracts(body: &str) -> Result<String, String> {
    let mut value: Value =
        serde_json::from_str(body).map_err(|_| "OpenAlex returned invalid JSON.".to_string())?;
    if let Some(results) = value.get_mut("results").and_then(Value::as_array_mut) {
        for item in results.iter_mut().filter_map(Value::as_object_mut) {
            let Some(index) = item.remove("abstract_inverted_index") else {
                continue;
            };
            let mut words: Vec<(u64, &str)> = index
                .as_object()
                .into_iter()
                .flatten()
                .flat_map(|(word, positions)| {
                    positions
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_u64)
                        .map(move |position| (position, word.as_str()))
                })
                .take(MAX_ABSTRACT_WORDS)
                .collect();
            words.sort_by_key(|(position, _)| *position);
            let text = words
                .iter()
                .map(|(_, word)| *word)
                .collect::<Vec<_>>()
                .join(" ");
            if !text.is_empty() {
                item.insert("abstract".into(), Value::String(text));
            }
        }
    }
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

fn openalex_request(
    http: &reqwest::Client,
    secrets: &dyn ConnectorSecrets,
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> Result<RequestBuilder, String> {
    let mut params = vec![
        ("search".to_string(), query.to_string()),
        ("per-page".to_string(), limit.to_string()),
        (
            "select".to_string(),
            "id,doi,title,publication_year,publication_date,type,authorships,primary_location,cited_by_count,open_access,best_oa_location,ids,abstract_inverted_index".to_string(),
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
    let mut request = http
        .get("https://api.openalex.org/works")
        .header("User-Agent", literature_user_agent(secrets))
        .query(&params);
    if let Some(key) = openalex_api_key(secrets) {
        request = request.bearer_auth(key);
    }
    Ok(request)
}

async fn search_openalex(
    http: &reqwest::Client,
    secrets: &dyn ConnectorSecrets,
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> Result<String, String> {
    let has_key = openalex_api_key(secrets).is_some();
    let result = response_text(
        "OpenAlex",
        openalex_request(http, secrets, query, limit, years, open_access_only)?,
    )
    .await
    .and_then(|body| with_openalex_abstracts(&body));
    if result.is_err() && !has_key {
        return result.map_err(|error| {
            format!("{error} Without an OpenAlex API key this source is heavily limited. Add one in Settings, Integrations.")
        });
    }
    result
}

async fn search_semantic_scholar(
    http: &reqwest::Client,
    secrets: &dyn ConnectorSecrets,
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
    let mut request = http
        .get("https://api.semanticscholar.org/graph/v1/paper/search")
        .query(&params);
    if let Some(key) = secrets
        .get("semantic-scholar")
        .filter(|key| !key.trim().is_empty())
    {
        request = request.header("x-api-key", key.as_str());
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
pub async fn literature_arxiv_lookup(
    secrets: &dyn ConnectorSecrets,
    arxiv_id: &str,
) -> Result<String, String> {
    let id = arxiv_id.trim();
    let valid = !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-'..='/'));
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
    if let Some(key) = secrets
        .get("semantic-scholar")
        .filter(|key| !key.trim().is_empty())
    {
        request = request.header("x-api-key", key.as_str());
    }
    response_text("Semantic Scholar", request).await
}

async fn search_crossref(
    http: &reqwest::Client,
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
        http.get("https://api.crossref.org/works").query(&params),
    )
    .await
}

async fn search_pubmed(
    http: &reqwest::Client,
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
        http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
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

    let summary_json = match pubmed_summary(http, &ids).await {
        Ok(summary) if sources::pubmed_summary_has_records(&summary) => summary,
        first => match pubmed_citation_summary(http, &ids).await {
            Ok(summary) if sources::pubmed_summary_has_records(&summary) => summary,
            _ => first?,
        },
    };
    serde_json::to_string(&json!({ "total": total, "summary": summary_json }))
        .map_err(|error| error.to_string())
}

async fn pubmed_summary(http: &reqwest::Client, ids: &str) -> Result<Value, String> {
    let summary = response_text(
        "PubMed",
        http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")
            .query(&[
                ("db", "pubmed"),
                ("id", ids),
                ("retmode", "json"),
                ("version", "2.0"),
                ("tool", "oleafly"),
            ]),
    )
    .await?;
    serde_json::from_str(&summary)
        .map_err(|error| format!("PubMed returned invalid summary JSON: {error}"))
}

async fn pubmed_citation_summary(http: &reqwest::Client, ids: &str) -> Result<Value, String> {
    let citations = response_text(
        "PubMed",
        http.get("https://api.ncbi.nlm.nih.gov/lit/ctxp/v1/pubmed/")
            .query(&[("format", "csl"), ("id", ids)]),
    )
    .await?;
    let citations: Value = serde_json::from_str(&citations)
        .map_err(|error| format!("PubMed returned invalid summary JSON: {error}"))?;
    let order: Vec<&str> = ids.split(',').collect();
    Ok(sources::pubmed_summary_from_csl(&citations, &order))
}

async fn search_arxiv(
    http: &reqwest::Client,
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
) -> Result<String, String> {
    let mut expression = format!("all:{query}");
    if let Some((from, to)) = years {
        expression.push_str(&format!(
            " AND submittedDate:[{from}01010000 TO {to}12312359]"
        ));
    }
    response_text(
        "arXiv",
        http.get("https://export.arxiv.org/api/query").query(&[
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
async fn search_google_scholar(
    http: &reqwest::Client,
    secrets: &dyn ConnectorSecrets,
    query: &str,
    limit: u8,
) -> Result<String, String> {
    let key = secrets
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
        http.post("https://google.serper.dev/scholar")
            .header("X-API-KEY", key)
            .header("Content-Type", "application/json")
            .json(&body),
    )
    .await
}

pub async fn literature_search(
    secrets: &dyn ConnectorSecrets,
    source: &str,
    query: &str,
    limit: u8,
    year_from: Option<u16>,
    year_to: Option<u16>,
    open_access_only: bool,
) -> Result<String, LiteratureError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(LiteratureError::QueryEmpty);
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(LiteratureError::QueryTooLong {
            max: MAX_QUERY_CHARS,
        });
    }
    let limit = limit.clamp(1, 25);
    let years = year_range(year_from, year_to);
    if source == "uspto" {
        return Err(LiteratureError::Message(
            "USPTO has temporarily paused PatentsView search APIs during its Open Data Portal migration."
                .to_string(),
        ));
    }
    let source = LiteratureSourceId::parse(source)
        .filter(|source| *source != LiteratureSourceId::Alphaxiv)
        .ok_or(LiteratureError::UnknownSource)?;
    let http = client().map_err(LiteratureError::Message)?;
    fetch_raw(
        &http,
        secrets,
        source,
        query,
        limit,
        years,
        open_access_only,
    )
    .await
    .map_err(LiteratureError::Message)
}

/// One built-in source's raw answer (JSON, or Atom XML for arXiv).
async fn fetch_raw(
    http: &reqwest::Client,
    secrets: &dyn ConnectorSecrets,
    source: LiteratureSourceId,
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> Result<String, String> {
    match source {
        LiteratureSourceId::Openalex => {
            search_openalex(http, secrets, query, limit, years, open_access_only).await
        }
        LiteratureSourceId::SemanticScholar => {
            search_semantic_scholar(http, secrets, query, limit, years).await
        }
        LiteratureSourceId::Crossref => search_crossref(http, query, limit, years).await,
        LiteratureSourceId::Pubmed => {
            search_pubmed(http, query, limit, years, open_access_only).await
        }
        LiteratureSourceId::Arxiv => search_arxiv(http, query, limit, years).await,
        LiteratureSourceId::GoogleScholar => {
            search_google_scholar(http, secrets, query, limit).await
        }
        LiteratureSourceId::Alphaxiv => Err("alphaXiv is searched through its connector.".into()),
    }
}

fn parse_raw(source: LiteratureSourceId, body: &str) -> Vec<LiteratureRecord> {
    match source {
        LiteratureSourceId::Openalex => sources::parse_openalex(body),
        LiteratureSourceId::SemanticScholar => sources::parse_semantic_scholar(body),
        LiteratureSourceId::Crossref => sources::parse_crossref(body),
        LiteratureSourceId::Pubmed => sources::parse_pubmed(body),
        LiteratureSourceId::Arxiv => sources::parse_arxiv(body),
        LiteratureSourceId::GoogleScholar => sources::parse_google_scholar(body),
        LiteratureSourceId::Alphaxiv => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct LiteratureQuery {
    pub query: String,
    pub sources: Vec<LiteratureSourceId>,
    pub limit: u8,
    pub year_from: Option<u16>,
    pub year_to: Option<u16>,
    pub open_access_only: bool,
}

impl Default for LiteratureQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            sources: Vec::new(),
            limit: 10,
            year_from: None,
            year_to: None,
            open_access_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFailure {
    pub source: LiteratureSourceId,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiteratureResults {
    pub records: Vec<LiteratureRecord>,
    pub failures: Vec<SourceFailure>,
    pub cached: Vec<LiteratureSourceId>,
}

#[async_trait::async_trait]
pub trait LiteratureSource: Send + Sync {
    fn id(&self) -> LiteratureSourceId;
    async fn search(&self, query: &LiteratureQuery) -> Result<Vec<LiteratureRecord>, String>;
}

const SOURCE_DEADLINE: Duration = Duration::from_secs(25);

pub struct LiteratureClient {
    http: reqwest::Client,
    cache: cache::LiteratureCache,
    last_request: Mutex<HashMap<LiteratureSourceId, Instant>>,
}

impl LiteratureClient {
    pub fn new(cache_path: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            http: client().unwrap_or_default(),
            cache: cache::LiteratureCache::new(cache_path),
            last_request: Mutex::new(HashMap::new()),
        })
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Waits so requests to one index stay apart: Semantic Scholar wants
    /// 1.1 s without a key, everyone else 200 ms.
    async fn pace(&self, source: LiteratureSourceId, secrets: &dyn ConnectorSecrets) {
        let gap = if source == LiteratureSourceId::SemanticScholar
            && secrets
                .get("semantic-scholar")
                .is_none_or(|key| key.trim().is_empty())
        {
            Duration::from_millis(1_100)
        } else {
            Duration::from_millis(200)
        };
        let wait = {
            let mut last = crate::scheduler::lock(&self.last_request);
            let now = Instant::now();
            let next = last
                .get(&source)
                .map(|at| *at + gap)
                .filter(|next| *next > now);
            let start = next.unwrap_or(now);
            last.insert(source, start);
            start.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }

    async fn built_in(
        &self,
        secrets: &dyn ConnectorSecrets,
        source: LiteratureSourceId,
        query: &LiteratureQuery,
    ) -> Result<(Vec<LiteratureRecord>, bool), String> {
        let limit = query.limit.clamp(1, 25);
        let years = year_range(query.year_from, query.year_to);
        let key = cache::cache_key(
            source.as_str(),
            &query.query,
            limit,
            years,
            query.open_access_only,
        );
        if let Some(body) = self.cache.get(&key, now_ms()) {
            return Ok((parse_raw(source, &body), true));
        }
        self.pace(source, secrets).await;
        let body = fetch_raw(
            &self.http,
            secrets,
            source,
            query.query.trim(),
            limit,
            years,
            query.open_access_only,
        )
        .await?;
        self.cache.put(&key, &body, now_ms());
        Ok((parse_raw(source, &body), false))
    }
}

pub async fn search_all(
    client: &LiteratureClient,
    secrets: &dyn ConnectorSecrets,
    query: LiteratureQuery,
    extra: &[Arc<dyn LiteratureSource>],
) -> Result<LiteratureResults, LiteratureError> {
    let trimmed = query.query.trim();
    if trimmed.is_empty() {
        return Err(LiteratureError::QueryEmpty);
    }
    if trimmed.chars().count() > MAX_QUERY_CHARS {
        return Err(LiteratureError::QueryTooLong {
            max: MAX_QUERY_CHARS,
        });
    }
    let mut wanted: Vec<LiteratureSourceId> = if query.sources.is_empty() {
        let mut defaults = LiteratureSourceId::defaults().to_vec();
        defaults.extend(extra.iter().map(|source| source.id()));
        defaults
    } else {
        query.sources.clone()
    };
    let mut seen = std::collections::HashSet::new();
    wanted.retain(|source| seen.insert(*source));
    let searches = wanted.iter().map(|source| {
        let query = &query;
        let source = *source;
        async move {
            let answer = async {
                match extra.iter().find(|candidate| candidate.id() == source) {
                    Some(external) => external.search(query).await.map(|records| (records, false)),
                    None if source == LiteratureSourceId::Alphaxiv => {
                        Err("Connect the alphaXiv server to search it.".to_string())
                    }
                    None => client.built_in(secrets, source, query).await,
                }
            };
            let result = tokio::time::timeout(SOURCE_DEADLINE, answer)
                .await
                .unwrap_or_else(|_| {
                    Err(format!("{} took longer than 25 seconds.", source.as_str()))
                });
            (source, result)
        }
    });
    let mut results = LiteratureResults::default();
    let mut groups = Vec::new();
    for (source, result) in join_all(searches).await {
        match result {
            Ok((records, cached)) => {
                if cached {
                    results.cached.push(source);
                }
                groups.push(records);
            }
            Err(message) => results.failures.push(SourceFailure { source, message }),
        }
    }
    results.records = merge::merge(groups);
    Ok(results)
}

const MAX_QUERY_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiteratureError {
    QueryEmpty,
    QueryTooLong { max: usize },
    UnknownSource,
    Message(String),
}

impl LiteratureError {
    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::QueryEmpty => Some("literature.query_empty"),
            Self::QueryTooLong { .. } => Some("literature.query_too_long"),
            Self::UnknownSource => Some("literature.unknown_source"),
            Self::Message(_) => None,
        }
    }
}

impl From<LiteratureError> for String {
    fn from(error: LiteratureError) -> Self {
        let envelope = |code: &str, params: Value| {
            format!(
                "@oleafly/error:{}",
                json!({"code": code, "params": params, "detail": Value::Null})
            )
        };
        match error {
            LiteratureError::QueryEmpty => envelope("literature.query_empty", json!({})),
            LiteratureError::QueryTooLong { max } => {
                envelope("literature.query_too_long", json!({"max": max.to_string()}))
            }
            LiteratureError::UnknownSource => envelope("literature.unknown_source", json!({})),
            LiteratureError::Message(message) => message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        literature_search, openalex_request, sanitize_openalex_email, with_openalex_abstracts,
        year_range, LiteratureError,
    };
    use crate::host::ConnectorSecrets;
    use serde_json::{json, Value};

    struct Keys(&'static str);

    impl ConnectorSecrets for Keys {
        fn get(&self, name: &str) -> Option<zeroize::Zeroizing<String>> {
            (name == "openalex-api-key").then(|| zeroize::Zeroizing::new(self.0.to_owned()))
        }
    }

    #[test]
    fn openalex_results_carry_a_reconstructed_abstract() {
        let raw = json!({"results":[{"id":"W1","abstract_inverted_index":{"Graph":[0],"networks":[1],"work.":[2]}}]});
        let out: Value =
            serde_json::from_str(&with_openalex_abstracts(&raw.to_string()).unwrap()).unwrap();
        assert_eq!(out["results"][0]["abstract"], "Graph networks work.");
        assert!(out["results"][0].get("abstract_inverted_index").is_none());
        let plain = json!({"results":[{"id":"W2","abstract_inverted_index":null}]});
        let out: Value =
            serde_json::from_str(&with_openalex_abstracts(&plain.to_string()).unwrap()).unwrap();
        assert!(out["results"][0].get("abstract").is_none());
    }

    #[test]
    fn the_openalex_key_goes_in_the_authorization_header() {
        let request = openalex_request(&reqwest::Client::new(), &Keys("k3y"), "q", 10, None, false)
            .unwrap()
            .build()
            .unwrap();
        assert!(!request.url().as_str().contains("k3y"));
        assert_eq!(request.headers()["authorization"], "Bearer k3y");
        assert!(request.url().as_str().contains("abstract_inverted_index"));
    }
    use crate::host::NoSecrets;

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

    #[tokio::test]
    async fn literature_errors_keep_their_codes_for_the_app() {
        let search = |source: &'static str, query: String| async move {
            literature_search(&NoSecrets, source, &query, 10, None, None, false).await
        };
        assert_eq!(
            search("openalex", "  ".into()).await,
            Err(LiteratureError::QueryEmpty)
        );
        assert_eq!(
            search("openalex", "x".repeat(501)).await,
            Err(LiteratureError::QueryTooLong { max: 500 })
        );
        assert_eq!(
            search("nope", "graphene".into()).await,
            Err(LiteratureError::UnknownSource)
        );
        let message = String::from(LiteratureError::QueryTooLong { max: 500 });
        let envelope: serde_json::Value =
            serde_json::from_str(message.strip_prefix("@oleafly/error:").unwrap()).unwrap();
        assert_eq!(
            envelope,
            serde_json::json!({"code": "literature.query_too_long", "params": {"max": "500"}, "detail": null})
        );
    }
}
