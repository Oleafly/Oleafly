use std::sync::{Arc, OnceLock};

use oleafly_research::host::ConnectorSecrets;
use oleafly_research::literature::{
    LiteratureClient, LiteratureError, LiteratureQuery, LiteratureResults,
};

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

#[tauri::command]
pub async fn literature_search_all(query: LiteratureQuery) -> Result<LiteratureResults, String> {
    oleafly_research::literature::search_all(&app_literature(), &AppSecrets, query, &[])
        .await
        .map_err(app_error)
}
