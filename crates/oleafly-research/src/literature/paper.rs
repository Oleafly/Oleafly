//! `read_paper`: fetch an open-access PDF (or read one in the workspace),
//! keep it in the task's record as `papers/<key>.pdf`, and return its text
//! with `[p. N]` page anchors, a window at a time.
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::sources::{arxiv_id, normalize_doi};
use super::LiteratureClient;
use crate::task_tools::TaskFiles;

const MAX_DOWNLOAD_BYTES: usize = 50 * 1024 * 1024;
const MAX_LOCAL_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAGES: usize = 300;
pub const DEFAULT_WINDOW_CHARS: usize = 20_000;
const MAX_WINDOW_BYTES: usize = 48 * 1024;
const EXTRACT_LIMIT: Duration = Duration::from_secs(60);
const DOWNLOAD_LIMIT: Duration = Duration::from_secs(120);
const UA: &str = "Oleafly/0.4 (https://github.com/Oleafly/Oleafly; paper reader)";

pub const NOT_ALLOWED: &str = "That address isn't allowed.";
pub const TOO_LARGE_LOCAL: &str =
    "This PDF is larger than 100 MB. Extract the pages you need first.";
pub const NO_OPEN_COPY: &str = "No open-access copy was found for this DOI.";

/// Which paper to read.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PaperRequest {
    Doi {
        doi: String,
    },
    Arxiv {
        id: String,
    },
    Url {
        url: String,
    },
    /// A PDF in the workspace, or in a linked data folder when `root_id`
    /// names one (the caller resolves it).
    Path {
        path: String,
        root_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaperText {
    pub key: String,
    pub title: Option<String>,
    pub source_url: Option<String>,
    pub pages: usize,
    pub text: String,
    pub next_offset: Option<usize>,
    /// The record files written (the PDF and its text).
    pub stored: Vec<String>,
}

/// Turns a PDF into page texts (the app uses pdf.js; the fallback is Rust).
#[async_trait::async_trait]
pub trait PdfTextExtractor: Send + Sync {
    async fn pages(&self, pdf: PathBuf) -> Result<Vec<String>, String>;
}

fn safe_key(prefix: &str, value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '.' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    format!("{prefix}_{cleaned}")
}

fn url_key(url: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(url.as_bytes()));
    format!("url_{}", &digest[..12])
}

/// The window of `text` starting at byte `offset`, at most `max_chars`
/// characters (and 48 KiB).
fn window(text: &str, offset: usize, max_chars: usize) -> Result<(String, Option<usize>), String> {
    if offset > text.len() || !text.is_char_boundary(offset) {
        return Err("Use an offset from a previous read.".into());
    }
    let rest = &text[offset..];
    let mut end = rest
        .char_indices()
        .nth(max_chars.clamp(1, DEFAULT_WINDOW_CHARS * 3))
        .map(|(at, _)| at)
        .unwrap_or(rest.len())
        .min(MAX_WINDOW_BYTES);
    while !rest.is_char_boundary(end) {
        end -= 1;
    }
    let next = (offset + end < text.len()).then_some(offset + end);
    Ok((rest[..end].to_owned(), next))
}

/// Page texts as one document with `[p. N]` anchors (300 pages, 2 MiB at most).
pub fn anchored_text(pages: &[String]) -> String {
    let mut text = String::new();
    for (index, page) in pages.iter().take(MAX_PAGES).enumerate() {
        let block = format!("[p. {}]\n{}\n\n", index + 1, page.trim());
        if text.len() + block.len() > MAX_TEXT_BYTES {
            text.push_str("[Oleafly stopped here: the text is longer than 2 MB.]\n");
            return text;
        }
        text.push_str(&block);
    }
    if pages.len() > MAX_PAGES {
        text.push_str(&format!(
            "[Oleafly stopped at page {MAX_PAGES} of {}.]\n",
            pages.len()
        ));
    }
    text
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| NOT_ALLOWED.to_string())?;
    oleafly_agent::tools::web::check_public_https_url(&parsed)
        .map_err(|_| NOT_ALLOWED.to_string())?;
    let client = oleafly_agent::tools::web::public_https_client(UA, DOWNLOAD_LIMIT)
        .map_err(|error| error.to_string())?;
    let response = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/pdf,*/*;q=0.5")
        .send()
        .await
        .map_err(|error| format!("The paper could not be downloaded: {}", error.without_url()))?;
    if !response.status().is_success() {
        return Err(format!(
            "The paper's server answered HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DOWNLOAD_BYTES as u64)
    {
        return Err("The PDF is larger than 50 MB.".into());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            format!("The paper could not be downloaded: {}", error.without_url())
        })?;
        if body.len() + chunk.len() > MAX_DOWNLOAD_BYTES {
            return Err("The PDF is larger than 50 MB.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Finds an open-access PDF for a DOI through OpenAlex.
async fn open_access_pdf(
    client: &LiteratureClient,
    doi: &str,
) -> Result<(String, Option<String>), String> {
    let url = format!("https://api.openalex.org/works/doi:{doi}");
    let body = super::response_text(
        "OpenAlex",
        client
            .http()
            .get(url)
            .query(&[("select", "title,best_oa_location,open_access")]),
    )
    .await?;
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "OpenAlex returned invalid JSON.".to_string())?;
    let pdf = value["best_oa_location"]["pdf_url"]
        .as_str()
        .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
        .ok_or_else(|| NO_OPEN_COPY.to_string())?;
    Ok((pdf.to_owned(), value["title"].as_str().map(str::to_owned)))
}

async fn extract(
    pdf: &[u8],
    path: PathBuf,
    extractor: Option<&dyn PdfTextExtractor>,
) -> Result<Vec<String>, String> {
    if let Some(extractor) = extractor {
        if let Ok(Ok(pages)) = tokio::time::timeout(EXTRACT_LIMIT, extractor.pages(path)).await {
            return Ok(pages);
        }
    }
    let bytes = pdf.to_vec();
    let pages = tokio::time::timeout(
        EXTRACT_LIMIT,
        tokio::task::spawn_blocking(move || pdf_extract::extract_text_from_mem_by_pages(&bytes)),
    )
    .await
    .map_err(|_| "Reading the PDF's text took longer than a minute.".to_string())?
    .map_err(|_| "Reading the PDF's text stopped unexpectedly.".to_string())?
    .map_err(|error| format!("The PDF's text could not be read: {error}"))?;
    Ok(pages)
}

/// Reads a paper into the record (`{record_dir}/papers/`) and returns a
/// window of its text. A paper read before comes from the record.
#[allow(clippy::too_many_arguments)] // The tool's arguments plus the task's files.
pub async fn read_paper(
    client: &LiteratureClient,
    request: PaperRequest,
    files: &TaskFiles,
    record_dir: &str,
    linked_base: Option<PathBuf>,
    extractor: Option<&dyn PdfTextExtractor>,
    offset: usize,
    max_chars: usize,
) -> Result<PaperText, String> {
    let (key, title, source_url) = match &request {
        PaperRequest::Arxiv { id } => {
            let id = arxiv_id(id).ok_or("That isn't an arXiv id.")?;
            (
                safe_key("arxiv", &id),
                None,
                Some(format!("https://arxiv.org/pdf/{id}")),
            )
        }
        PaperRequest::Doi { doi } => {
            let doi = normalize_doi(doi).ok_or("That isn't a DOI.")?;
            (safe_key("doi", &doi), None, None)
        }
        PaperRequest::Url { url } => (url_key(url), None, Some(url.clone())),
        PaperRequest::Path { path, .. } => (safe_key("file", path), None, None),
    };
    let papers = format!("{record_dir}/papers");
    let text_path = format!("{papers}/{key}.txt");
    let pdf_path = format!("{papers}/{key}.pdf");
    if files.exists(&text_path)? {
        let text = files.read(&text_path)?;
        let (window, next_offset) = window(&text, offset, max_chars)?;
        return Ok(PaperText {
            pages: text.matches("[p. ").count(),
            key,
            title,
            source_url,
            text: window,
            next_offset,
            stored: Vec::new(),
        });
    }
    let (bytes, title, source_url, stored_pdf) = match request {
        PaperRequest::Path { path, root_id } => {
            let bytes = match (root_id, linked_base) {
                (Some(_), Some(base)) => {
                    let relative = crate::task_tools::relative_path(&path, false)?;
                    let file = base.join(relative);
                    let real = file
                        .canonicalize()
                        .map_err(|_| "The PDF is not in that data folder.".to_string())?;
                    if !real.starts_with(base.canonicalize().map_err(|error| error.to_string())?) {
                        return Err("The PDF is not in that data folder.".into());
                    }
                    if tokio::fs::metadata(&real)
                        .await
                        .map(|metadata| metadata.len())
                        .unwrap_or(0)
                        > MAX_LOCAL_BYTES
                    {
                        return Err(TOO_LARGE_LOCAL.into());
                    }
                    tokio::fs::read(real)
                        .await
                        .map_err(|error| format!("The PDF could not be read: {error}"))?
                }
                (Some(_), None) => {
                    return Err("That data folder isn't linked to this project.".into())
                }
                (None, _) => files.read_bytes(&path, MAX_LOCAL_BYTES).map_err(|error| {
                    if error.contains("too large") {
                        TOO_LARGE_LOCAL.to_string()
                    } else {
                        error
                    }
                })?,
            };
            (bytes, None, None, false)
        }
        PaperRequest::Doi { doi } => {
            let doi = normalize_doi(&doi).unwrap_or(doi);
            let (url, title) = open_access_pdf(client, &doi).await?;
            (download(&url).await?, title, Some(url), true)
        }
        PaperRequest::Arxiv { .. } | PaperRequest::Url { .. } => {
            let url = source_url.clone().unwrap_or_default();
            (download(&url).await?, title, source_url, true)
        }
    };
    if !bytes.starts_with(b"%PDF") {
        return Err("That file isn't a PDF.".into());
    }
    let mut stored = Vec::new();
    if stored_pdf {
        files.write_bytes(&pdf_path, &bytes, MAX_DOWNLOAD_BYTES)?;
        stored.push(pdf_path.clone());
    }
    let extract_from = if stored_pdf {
        files.root.join(&pdf_path)
    } else {
        // A workspace or data-folder file is extracted from a private copy.
        let scratch =
            std::env::temp_dir().join(format!("oleafly-paper-{}.pdf", rand::random::<u64>()));
        tokio::fs::write(&scratch, &bytes)
            .await
            .map_err(|error| error.to_string())?;
        scratch
    };
    let pages = extract(&bytes, extract_from.clone(), extractor).await;
    if !stored_pdf {
        let _ = tokio::fs::remove_file(&extract_from).await;
    }
    let pages = pages?;
    let text = anchored_text(&pages);
    files.write(&text_path, &text)?;
    stored.push(text_path);
    let (window, next_offset) = window(&text, offset, max_chars)?;
    Ok(PaperText {
        key,
        title,
        source_url,
        pages: pages.len(),
        text: window,
        next_offset,
        stored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_anchors_and_limits() {
        let pages: Vec<String> = (0..302).map(|index| format!("Page text {index}")).collect();
        let text = anchored_text(&pages);
        assert!(text.starts_with("[p. 1]\nPage text 0"));
        assert!(text.contains("[p. 300]"));
        assert!(!text.contains("[p. 301]"));
        assert!(text.ends_with("[Oleafly stopped at page 300 of 302.]\n"));
    }

    #[test]
    fn windows_continue_where_they_stopped() {
        let text = "é".repeat(30_000);
        let (first, next) = window(&text, 0, 20_000).unwrap();
        assert_eq!(first.chars().count(), 20_000);
        let next = next.unwrap();
        let (second, last) = window(&text, next, 20_000).unwrap();
        assert_eq!(second.chars().count(), 10_000);
        assert_eq!(last, None);
        assert!(window(&text, 1, 10).is_err());
    }

    #[test]
    fn keys_are_safe_file_names() {
        assert_eq!(safe_key("doi", "10.1000/x y"), "doi_10.1000_x_y");
        assert_eq!(safe_key("arxiv", "2410.16464"), "arxiv_2410.16464");
        assert!(url_key("https://example.org/a.pdf").starts_with("url_"));
    }

    #[tokio::test]
    async fn read_paper_refuses_private_addresses_and_plain_http() {
        let root = tempfile::tempdir().unwrap();
        let files = TaskFiles::open(root.path(), &["research".to_owned()]).unwrap();
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        for url in [
            "http://example.org/a.pdf",
            "https://127.0.0.1/a.pdf",
            "https://10.0.0.8/a.pdf",
        ] {
            let error = read_paper(
                &client,
                PaperRequest::Url { url: url.into() },
                &files,
                "research/r-0000",
                None,
                None,
                0,
                DEFAULT_WINDOW_CHARS,
            )
            .await
            .unwrap_err();
            assert_eq!(error, NOT_ALLOWED, "{url}");
        }
    }

    #[test]
    fn read_paper_refuses_a_huge_local_pdf() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("research")).unwrap();
        let file = std::fs::File::create(root.path().join("research/huge.pdf")).unwrap();
        file.set_len(MAX_LOCAL_BYTES + 1).unwrap();
        let files = TaskFiles::open(root.path(), &["research".to_owned()]).unwrap();
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let error = runtime
            .block_on(read_paper(
                &client,
                PaperRequest::Path {
                    path: "research/huge.pdf".into(),
                    root_id: None,
                },
                &files,
                "research/r-0000",
                None,
                None,
                0,
                DEFAULT_WINDOW_CHARS,
            ))
            .unwrap_err();
        assert_eq!(error, TOO_LARGE_LOCAL);
    }

    /// A one-page PDF that shows `text` in Helvetica, with a correct
    /// cross-reference table.
    fn one_page_pdf(text: &str) -> Vec<u8> {
        let content = format!("BT /F1 24 Tf 72 720 Td ({text}) Tj ET");
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
                .to_owned(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_owned(),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, body) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", index + 1).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        pdf
    }

    /// A pdf.js bridge stand-in: fixed pages, or a failure; it counts calls.
    struct Bridge {
        pages: Result<Vec<String>, String>,
        calls: std::sync::atomic::AtomicUsize,
    }

    #[async_trait::async_trait]
    impl PdfTextExtractor for Bridge {
        async fn pages(&self, pdf: PathBuf) -> Result<Vec<String>, String> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            // It gets a readable copy of the PDF.
            assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));
            self.pages.clone()
        }
    }

    fn bridge(pages: Result<Vec<String>, String>) -> Bridge {
        Bridge {
            pages,
            calls: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// A workspace with `research/paper.pdf` and its task files.
    fn workspace_with_pdf(pdf: &[u8]) -> (tempfile::TempDir, TaskFiles) {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("research")).unwrap();
        std::fs::write(root.path().join("research/paper.pdf"), pdf).unwrap();
        let files = TaskFiles::open(root.path(), &["research".to_owned()]).unwrap();
        (root, files)
    }

    const RECORD: &str = "research/r-0000";
    const TEXT_PATH: &str = "research/r-0000/papers/file_research_paper.pdf.txt";

    fn workspace_paper() -> PaperRequest {
        PaperRequest::Path {
            path: "research/paper.pdf".into(),
            root_id: None,
        }
    }

    // A downloaded paper (DOI, arXiv, URL) is stored as `papers/<key>.pdf`
    // too, but downloads only go to public HTTPS hosts, so this reads a
    // workspace PDF instead.
    #[tokio::test]
    async fn read_paper_stores_page_anchored_text_in_the_record() {
        let (root, files) = workspace_with_pdf(&one_page_pdf("Oleafly"));
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        let viewer = bridge(Ok(vec![
            "First page text".into(),
            "  Second page text\n".into(),
        ]));
        let paper = read_paper(
            &client,
            workspace_paper(),
            &files,
            RECORD,
            None,
            Some(&viewer),
            0,
            DEFAULT_WINDOW_CHARS,
        )
        .await
        .unwrap();
        assert_eq!(paper.key, "file_research_paper.pdf");
        assert_eq!(paper.pages, 2);
        assert_eq!(paper.stored, vec![TEXT_PATH.to_owned()]);
        assert_eq!(
            paper.text,
            "[p. 1]\nFirst page text\n\n[p. 2]\nSecond page text\n\n"
        );
        assert_eq!(paper.next_offset, None);
        assert_eq!(
            std::fs::read_to_string(root.path().join(TEXT_PATH)).unwrap(),
            paper.text
        );
        // The workspace PDF is read in place, not copied into the record.
        assert!(!root
            .path()
            .join("research/r-0000/papers/file_research_paper.pdf.pdf")
            .exists());

        // Read again: the record answers, a window at a time.
        let window = read_paper(
            &client,
            workspace_paper(),
            &files,
            RECORD,
            None,
            Some(&viewer),
            0,
            10,
        )
        .await
        .unwrap();
        assert_eq!(viewer.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(window.stored.is_empty());
        assert_eq!(window.pages, 2);
        assert_eq!(window.text, "[p. 1]\nFir");
        let rest = read_paper(
            &client,
            workspace_paper(),
            &files,
            RECORD,
            None,
            Some(&viewer),
            window.next_offset.unwrap(),
            DEFAULT_WINDOW_CHARS,
        )
        .await
        .unwrap();
        assert_eq!(format!("{}{}", window.text, rest.text), paper.text);
    }

    #[tokio::test]
    async fn a_failing_pdf_bridge_falls_back_to_the_rust_reader() {
        let (root, files) = workspace_with_pdf(&one_page_pdf("Oleafly"));
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        let viewer = bridge(Err("The viewer could not open the PDF.".into()));
        let paper = read_paper(
            &client,
            workspace_paper(),
            &files,
            RECORD,
            None,
            Some(&viewer),
            0,
            DEFAULT_WINDOW_CHARS,
        )
        .await
        .unwrap();
        assert_eq!(viewer.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(paper.pages, 1);
        assert!(paper.text.starts_with("[p. 1]\n"), "{}", paper.text);
        assert!(paper.text.contains("Oleafly"), "{}", paper.text);
        assert_eq!(
            std::fs::read_to_string(root.path().join(TEXT_PATH)).unwrap(),
            paper.text
        );
    }

    #[tokio::test]
    async fn a_paper_read_before_comes_from_the_record_under_its_arxiv_key() {
        let root = tempfile::tempdir().unwrap();
        let papers = root.path().join("research/r-0000/papers");
        std::fs::create_dir_all(&papers).unwrap();
        std::fs::write(
            papers.join("arxiv_2410.16464.txt"),
            "[p. 1]\nGraph networks\n\n",
        )
        .unwrap();
        let files = TaskFiles::open(root.path(), &["research".to_owned()]).unwrap();
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        let paper = read_paper(
            &client,
            PaperRequest::Arxiv {
                id: "arXiv:2410.16464v2".into(),
            },
            &files,
            RECORD,
            None,
            None,
            0,
            DEFAULT_WINDOW_CHARS,
        )
        .await
        .unwrap();
        assert_eq!(paper.key, "arxiv_2410.16464");
        assert_eq!(
            paper.source_url.as_deref(),
            Some("https://arxiv.org/pdf/2410.16464")
        );
        assert_eq!(paper.text, "[p. 1]\nGraph networks\n\n");
        assert_eq!((paper.pages, paper.stored.len()), (1, 0));
    }

    #[tokio::test]
    async fn a_file_that_is_not_a_pdf_is_refused() {
        let (root, files) = workspace_with_pdf(b"<html>not a paper</html>");
        let client = LiteratureClient::new(root.path().join("cache.sqlite3"));
        let viewer = bridge(Ok(vec!["never read".into()]));
        let error = read_paper(
            &client,
            workspace_paper(),
            &files,
            RECORD,
            None,
            Some(&viewer),
            0,
            DEFAULT_WINDOW_CHARS,
        )
        .await
        .unwrap_err();
        assert_eq!(error, "That file isn't a PDF.");
        assert_eq!(viewer.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(!root.path().join(TEXT_PATH).exists());
    }
}
