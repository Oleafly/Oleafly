//! On-demand citation metadata lookup. Thin async HTTP to three fixed hosts
//! (doi.org, arXiv, Crossref); all parsing/normalization happens in TypeScript
//! so it stays unit-testable. Only the identifier or query is ever sent.

const UA: &str = "Oleafly/0.2 (https://github.com/Oleafly/Oleafly; citation lookup)";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Canonical BibTeX for a DOI, via doi.org content negotiation.
#[tauri::command]
pub async fn fetch_doi_bibtex(doi: String) -> Result<String, String> {
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
    resp.text().await.map_err(|e| e.to_string())
}

/// The arXiv Atom entry for an id (parsed to BibTeX in the frontend).
#[tauri::command]
pub async fn fetch_arxiv(id: String) -> Result<String, String> {
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
    resp.text().await.map_err(|e| e.to_string())
}

/// Crossref bibliographic search (JSON parsed in the frontend).
#[tauri::command]
pub async fn crossref_search(query: String) -> Result<String, String> {
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
    resp.text().await.map_err(|e| e.to_string())
}
