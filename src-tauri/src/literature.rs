use std::sync::{Arc, OnceLock};

use oleafly_research::host::ConnectorSecrets;
use oleafly_research::literature::{
    LiteratureClient, LiteratureError, LiteratureQuery, LiteratureRecord, LiteratureResults,
    LiteratureSource, LiteratureSourceId,
};
use serde_json::{json, Value};

pub(crate) struct AppSecrets;

impl ConnectorSecrets for AppSecrets {
    fn get(&self, name: &str) -> Option<zeroize::Zeroizing<String>> {
        crate::secrets::read_connector_secrets()
            .ok()?
            .get(name)
            .map(|value| zeroize::Zeroizing::new(value.to_string()))
    }
}

fn app_error(error: LiteratureError) -> String {
    match error {
        LiteratureError::QueryEmpty => {
            crate::app_error::AppError::new("literature.query_empty").into()
        }
        LiteratureError::QueryTooLong { max } => {
            crate::app_error::AppError::new("literature.query_too_long")
                .param("max", max)
                .into()
        }
        LiteratureError::UnknownSource => {
            crate::app_error::AppError::new("literature.unknown_source").into()
        }
        LiteratureError::Message(message) => message,
    }
}

/// Look up a single arXiv paper on Semantic Scholar to backfill authors and
/// venue for sources that return bare titles (e.g. Google Scholar via Serper).
#[tauri::command]
pub async fn literature_arxiv_lookup(arxiv_id: String) -> Result<String, String> {
    oleafly_research::literature::literature_arxiv_lookup(&AppSecrets, &arxiv_id).await
}

#[tauri::command]
pub async fn literature_search(
    source: String,
    query: String,
    limit: u8,
    year_from: Option<u16>,
    year_to: Option<u16>,
    open_access_only: bool,
) -> Result<String, String> {
    oleafly_research::literature::literature_search(
        &AppSecrets,
        &source,
        &query,
        limit,
        year_from,
        year_to,
        open_access_only,
    )
    .await
    .map_err(app_error)
}

const ALPHAXIV_MCP_URL: &str = "https://api.alphaxiv.org/mcp";

pub(crate) fn app_literature() -> Arc<LiteratureClient> {
    static CLIENT: OnceLock<Arc<LiteratureClient>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let cache = crate::paths::oleafly_root()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("literature-cache.sqlite3");
            LiteratureClient::new(cache)
        })
        .clone()
}

struct AppAlphaXiv {
    server: String,
}

#[async_trait::async_trait]
impl LiteratureSource for AppAlphaXiv {
    fn id(&self) -> LiteratureSourceId {
        LiteratureSourceId::Alphaxiv
    }

    async fn search(&self, query: &LiteratureQuery) -> Result<Vec<LiteratureRecord>, String> {
        let result = crate::mcp::client::call_enabled_server_tool(
            &self.server,
            "discover_papers",
            json!({"query": query.query}),
        )
        .await?;
        if result["isError"].as_bool() == Some(true) {
            return Err(mcp_text(&result)
                .chars()
                .take(300)
                .collect::<String>()
                .trim()
                .to_string());
        }
        Ok(parse_alphaxiv(
            &mcp_text(&result),
            usize::from(query.limit.max(1)),
        ))
    }
}

fn mcp_text(result: &Value) -> String {
    result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Papers in an alphaXiv answer, which names each one as `[ID=<id>]` on the
/// line with its title.
fn parse_alphaxiv(text: &str, limit: usize) -> Vec<LiteratureRecord> {
    let mut records: Vec<LiteratureRecord> = Vec::new();
    for line in text.lines() {
        let Some(start) = line.find("[ID=") else {
            continue;
        };
        let Some(length) = line[start + 4..].find(']') else {
            continue;
        };
        let id = line[start + 4..start + 4 + length].trim().to_string();
        if id.is_empty()
            || records
                .iter()
                .any(|record| record.source_ids.get("alphaxiv") == Some(&id))
        {
            continue;
        }
        let before = clean_title(&line[..start]);
        let title = if before.is_empty() {
            clean_title(&line[start + 5 + length..])
        } else {
            before
        };
        let arxiv = id.split_once('.').is_some_and(|(left, right)| {
            left.len() == 4
                && left.chars().all(|character| character.is_ascii_digit())
                && right
                    .chars()
                    .take(4)
                    .all(|character| character.is_ascii_digit())
        });
        records.push(LiteratureRecord {
            id: format!("alphaxiv:{id}"),
            title: if title.is_empty() { id.clone() } else { title },
            arxiv_id: arxiv.then(|| id.clone()),
            url: Some(format!("https://www.alphaxiv.org/abs/{id}")),
            sources: vec![LiteratureSourceId::Alphaxiv],
            source_ids: [("alphaxiv".to_string(), id)].into_iter().collect(),
            ..LiteratureRecord::default()
        });
        if records.len() >= limit {
            break;
        }
    }
    records
}

fn clean_title(text: &str) -> String {
    text.trim()
        .trim_start_matches(|character: char| {
            character.is_ascii_digit() || matches!(character, '.' | '-' | '*' | ')' | ' ')
        })
        .replace("**", "")
        .trim_matches(|character: char| matches!(character, ' ' | '-' | ':' | '*' | '|'))
        .to_string()
}

pub(crate) fn extra_sources() -> Vec<Arc<dyn LiteratureSource>> {
    crate::mcp::client::enabled_remote_server(ALPHAXIV_MCP_URL)
        .map(|server| vec![Arc::new(AppAlphaXiv { server }) as Arc<dyn LiteratureSource>])
        .unwrap_or_default()
}

#[tauri::command]
pub async fn literature_search_all(query: LiteratureQuery) -> Result<LiteratureResults, String> {
    let extra = tauri::async_runtime::spawn_blocking(extra_sources)
        .await
        .unwrap_or_default();
    oleafly_research::literature::search_all(&app_literature(), &AppSecrets, query, &extra)
        .await
        .map_err(app_error)
}

#[cfg(test)]
mod unified_tests {
    use super::*;

    #[test]
    fn alphaxiv_answers_become_records() {
        let text = "1. **Attention Is All You Need** [ID=1706.03762]\n- Scaling laws [ID=2001.08361]: compute\nno id here\n[ID=1706.03762] duplicate\n[ID=abc-123] Graph networks";
        let records = parse_alphaxiv(text, 10);
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].title, "Attention Is All You Need");
        assert_eq!(records[0].arxiv_id.as_deref(), Some("1706.03762"));
        assert_eq!(
            records[0].url.as_deref(),
            Some("https://www.alphaxiv.org/abs/1706.03762")
        );
        assert_eq!(records[1].title, "Scaling laws");
        assert_eq!(records[2].title, "Graph networks");
        assert_eq!(records[2].arxiv_id, None);
        assert_eq!(parse_alphaxiv(text, 1).len(), 1);
    }
}
