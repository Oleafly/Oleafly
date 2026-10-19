//! On-demand citation metadata lookup. The lookups live in the research
//! crate so the CLI and research tasks use the same code; these are the
//! app's commands.

/// Canonical BibTeX for a DOI, via doi.org content negotiation.
#[tauri::command]
pub async fn fetch_doi_bibtex(doi: String) -> Result<String, String> {
    oleafly_research::citation::fetch_doi_bibtex(&doi).await
}

/// The arXiv Atom entry for an id (parsed to BibTeX in the frontend).
#[tauri::command]
pub async fn fetch_arxiv(id: String) -> Result<String, String> {
    oleafly_research::citation::fetch_arxiv(&id).await
}

/// Crossref bibliographic search (JSON parsed in the frontend).
#[tauri::command]
pub async fn crossref_search(query: String) -> Result<String, String> {
    oleafly_research::citation::crossref_search(&query).await
}

/// Canonical BibTeX for an ISBN, via OpenLibrary.
#[tauri::command]
pub async fn fetch_isbn_bibtex(isbn: String) -> Result<String, String> {
    oleafly_research::citation::fetch_isbn_bibtex(&isbn).await
}

/// Canonical BibTeX for a PMID, via NCBI E-utilities (no key required).
#[tauri::command]
pub async fn fetch_pmid_bibtex(pmid: String) -> Result<String, String> {
    oleafly_research::citation::fetch_pmid_bibtex(&pmid).await
}

/// Whether a reference is real: its DOI resolves to the title, or Crossref
/// has a record with that title.
#[tauri::command]
pub async fn verify_citation(
    doi: Option<String>,
    title: Option<String>,
) -> Result<oleafly_research::citation::CitationCheck, String> {
    oleafly_research::citation::verify_citation(doi.as_deref(), title.as_deref()).await
}
