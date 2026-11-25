use serde_json::{json, Value};

use super::{SearchHit, SearchKey, WebClient, WebError, WebResult, MAX_SEARCH_RESULTS};

const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const BRAVE_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_URL: &str = "https://api.tavily.com/search";
const SERPER_URL: &str = "https://google.serper.dev/search";

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut inside = false;
    for character in text.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn hits(entries: Option<&Value>, build: impl Fn(&Value) -> SearchHit) -> Vec<SearchHit> {
    entries
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(build)
        .filter(|hit| !hit.url.is_empty())
        .take(MAX_SEARCH_RESULTS)
        .collect()
}

pub(crate) fn parse_brave(body: &Value) -> Vec<SearchHit> {
    hits(body.pointer("/web/results"), |result| SearchHit {
        title: strip_tags(&text(result, "title")),
        url: text(result, "url"),
        snippet: strip_tags(&text(result, "description")),
        published: optional(result, "age"),
    })
}

pub(crate) fn parse_tavily(body: &Value) -> Vec<SearchHit> {
    hits(body.get("results"), |result| SearchHit {
        title: text(result, "title"),
        url: text(result, "url"),
        snippet: text(result, "content"),
        published: optional(result, "published_date"),
    })
}

pub(crate) fn parse_serper(body: &Value) -> Vec<SearchHit> {
    hits(body.get("organic"), |result| SearchHit {
        title: text(result, "title"),
        url: text(result, "link"),
        snippet: text(result, "snippet"),
        published: optional(result, "date"),
    })
}

pub(crate) fn search_error(provider: &'static str, status: u16, _body: &str) -> WebError {
    WebError::Search {
        provider,
        status: Some(status),
    }
}

pub(crate) fn provider_name(key: &SearchKey) -> &'static str {
    match key {
        SearchKey::Brave(_) => "Brave Search",
        SearchKey::Tavily(_) => "Tavily",
        SearchKey::Serper(_) => "Serper",
    }
}

pub(crate) async fn search(
    client: &WebClient,
    query: &str,
    key: &SearchKey,
    count: usize,
) -> WebResult<Vec<SearchHit>> {
    let provider = provider_name(key);
    let unreachable = || WebError::Search {
        provider,
        status: None,
    };
    let count = count.clamp(1, MAX_SEARCH_RESULTS);
    let request = match key {
        SearchKey::Brave(token) => {
            let mut url = reqwest::Url::parse(BRAVE_URL).map_err(|_| unreachable())?;
            url.query_pairs_mut()
                .append_pair("q", query)
                .append_pair("count", &count.to_string());
            client
                .api
                .get(url)
                .header("Accept", "application/json")
                .header("X-Subscription-Token", sensitive(token)?)
        }
        SearchKey::Tavily(token) => client
            .api
            .post(TAVILY_URL)
            .header("Authorization", sensitive(&format!("Bearer {token}"))?)
            .json(&json!({ "query": query, "max_results": count, "search_depth": "basic" })),
        SearchKey::Serper(token) => client
            .api
            .post(SERPER_URL)
            .header("X-API-KEY", sensitive(token)?)
            .json(&json!({ "q": query, "num": count })),
    };
    let response = request.send().await.map_err(|_| unreachable())?;
    let status = response.status().as_u16();
    let body = super::read_limited(response, MAX_RESPONSE_BYTES)
        .await
        .map_err(|_| unreachable())?
        .0;
    if !(200..300).contains(&status) {
        return Err(search_error(
            provider,
            status,
            &String::from_utf8_lossy(&body),
        ));
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| unreachable())?;
    Ok(match key {
        SearchKey::Brave(_) => parse_brave(&value),
        SearchKey::Tavily(_) => parse_tavily(&value),
        SearchKey::Serper(_) => parse_serper(&value),
    })
}

fn sensitive(value: &str) -> WebResult<reqwest::header::HeaderValue> {
    let mut header =
        reqwest::header::HeaderValue::from_str(value).map_err(|_| WebError::Search {
            provider: "the search provider",
            status: None,
        })?;
    header.set_sensitive(true);
    Ok(header)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_search_provider_parses_into_hits() {
        let brave = parse_brave(&json!({"web":{"results":[
            {"title":"<strong>Claude</strong> Shannon","url":"https://e.org/a","description":"Father of <strong>x</strong> &amp; y","age":"2 days ago"},
            {"title":"No url"}
        ]}}));
        assert_eq!(brave.len(), 1);
        assert_eq!(brave[0].title, "Claude Shannon");
        assert_eq!(brave[0].snippet, "Father of x & y");
        assert_eq!(brave[0].published.as_deref(), Some("2 days ago"));
        let tavily = parse_tavily(
            &json!({"results":[{"title":"T","url":"https://t.org","content":"c","published_date":"2026-01-01"}]}),
        );
        assert_eq!(tavily[0].snippet, "c");
        let serper =
            parse_serper(&json!({"organic":[{"title":"S","link":"https://s.org","snippet":"s"}]}));
        assert_eq!(serper[0].url, "https://s.org");
        assert_eq!(serper[0].published, None);
    }

    #[test]
    fn search_errors_never_echo_the_key_or_the_body() {
        let error = search_error(
            "Brave Search",
            401,
            r#"{"error":"invalid token sk-secret-123"}"#,
        );
        assert!(!error.to_string().contains("sk-secret-123"));
        assert!(error.to_string().contains("Brave Search"));
        assert!(search_error("Tavily", 429, "")
            .to_string()
            .contains("rate-limiting"));
        assert!(search_error("Serper", 500, "")
            .to_string()
            .contains("HTTP 500"));
    }
}
