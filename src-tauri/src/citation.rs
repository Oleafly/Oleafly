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

// --- ISBN and PMID lookups ---------------------------------------------------

/// Strip separator characters and validate the shape of an ISBN-10/13.
fn normalize_isbn(raw: &str) -> Result<String, String> {
    let isbn: String = raw
        .trim()
        .trim_start_matches("isbn:")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let shape = isbn.len() == 13 && isbn.chars().all(|c| c.is_ascii_digit())
        || isbn.len() == 10
            && isbn[..9].chars().all(|c| c.is_ascii_digit())
            && (isbn[9..].chars().all(|c| c.is_ascii_digit()) || isbn.ends_with('X'));
    if !shape {
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
            // PubMed compresses given names to bare initials ("Smith JA");
            // OpenLibrary spells them out ("Goodfellow Ian"). Expand
            // all-uppercase tokens letter by letter, otherwise take the
            // first letter of each spelled-out name.
            let initials: Vec<String> = parts
                .flat_map(|token| {
                    if token.chars().all(|c| !c.is_ascii_lowercase()) && token.len() <= 3 {
                        token
                            .chars()
                            .filter(|c| c.is_ascii_alphabetic())
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

/// Key in the app's `firstauthorYEARfirstword` scheme, matching
/// generateCiteKey in src/lib/citation/bibtex.ts.
pub(crate) fn cite_key(author: &str, year: &str, title: &str) -> String {
    const STOP: &[&str] = &[
        "the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "using", "via", "from",
        "by",
    ];
    let ascii = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase()
    };
    let first_author = author
        .split(" and ")
        .next()
        .unwrap_or_default()
        .split(',')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let family = if first_author.is_empty() {
        String::new()
    } else if first_author.contains(' ') {
        first_author
            .split_whitespace()
            .next_back()
            .unwrap_or_default()
            .to_string()
    } else {
        first_author
    };
    let word = title
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric()))
        .map(|w| w.to_ascii_lowercase())
        .find(|w| {
            w.chars().all(|c| c.is_ascii_alphabetic()) && w.len() > 2 && !STOP.contains(&w.as_str())
        })
        .unwrap_or_default();
    let mut key = format!("{}{}{}", ascii(&family), year, word);
    if key.is_empty() {
        key = format!("ref{year}");
    }
    key
}

/// The first 4-digit year found in a free-form date string ("2020 Mar 5").
pub(crate) fn year_of(date: &str) -> String {
    date.split_whitespace()
        .find(|token| token.len() == 4 && token.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or_default()
        .to_string()
}

fn brace_field(value: &str) -> String {
    format!("{{{}}}", value.replace(['{', '}'], ""))
}

/// BibTeX for a book, from OpenLibrary's ISBN view (`?jscmd=data`).
/// The JSON shape here is stable and covered by unit tests below.
pub(crate) fn isbn_bibtex(data: &serde_json::Value, isbn: &str) -> Result<String, String> {
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
    let author_list = bibtex_authors(&authors);
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

/// Canonical BibTeX for an ISBN, via OpenLibrary.
#[tauri::command]
pub async fn fetch_isbn_bibtex(isbn: String) -> Result<String, String> {
    let isbn = normalize_isbn(&isbn)?;
    let url = format!("https://openlibrary.org/isbn/{isbn}.json?jscmd=data");
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("lookup failed: {e}"))?
        .error_for_status()
        .map_err(|_| "No book found for that ISBN.".to_string())?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("OpenLibrary returned an unreadable response: {e}"))?;
    isbn_bibtex(&data, &isbn)
}

/// BibTeX for an article, from NCBI's PubMed esummary record.
pub(crate) fn pmid_bibtex(result: &serde_json::Value, pmid: &str) -> Result<String, String> {
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
#[tauri::command]
pub async fn fetch_pmid_bibtex(pmid: String) -> Result<String, String> {
    let pmid = pmid.trim().trim_start_matches("PMID:").trim();
    if pmid.is_empty() || !pmid.chars().all(|c| c.is_ascii_digit()) {
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
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("PubMed returned an unreadable response: {e}"))?;
    let result = data
        .get("result")
        .cloned()
        .ok_or("PubMed returned no result for that PMID.")?;
    pmid_bibtex(&result, pmid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isbn_normalization_accepts_separated_forms() {
        assert_eq!(
            normalize_isbn("978-0-13-468599-1").unwrap(),
            "9780134685991"
        );
        assert_eq!(normalize_isbn("0-201-63361-2").unwrap(), "0201633612");
        assert_eq!(normalize_isbn("isbn:020163361X").unwrap(), "020163361X");
        assert!(normalize_isbn("12345").is_err());
        assert!(normalize_isbn("978013468599X").is_err());
    }

    #[test]
    fn isbn_bibtex_maps_openlibrary_fields() {
        let data = serde_json::json!({
            "title": "Deep Learning",
            "authors": [{"name": "Goodfellow Ian"}, {"name": "Bengio Yoshua"}],
            "publishers": [{"name": "MIT Press"}],
            "publish_date": "November 2016",
        });
        let bib = isbn_bibtex(&data, "9780262035613").unwrap();
        assert!(bib.starts_with("@book{goodfellow2016deep,"), "{bib}");
        assert!(bib.contains("author = {Goodfellow, I. and Bengio, Y.}"));
        assert!(bib.contains("publisher = {MIT Press}"));
        assert!(bib.contains("year = {2016}"));
        assert!(bib.contains("isbn = {9780262035613}"));
        assert!(bib.ends_with("}"));
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

    #[test]
    fn cite_keys_match_the_app_scheme() {
        assert_eq!(
            cite_key(
                "Vaswani, A. and Shazeer, N.",
                "2017",
                "Attention Is All You Need"
            ),
            "vaswani2017attention"
        );
        assert_eq!(cite_key("", "2020", "A Study"), "2020study");
        // Bare "Given Family" names key on the family (last token), like the TS helper.
        assert_eq!(cite_key("Jane Doe", "2021", "The of and"), "doe2021");
        assert_eq!(cite_key("", "", ""), "ref");
    }
}
