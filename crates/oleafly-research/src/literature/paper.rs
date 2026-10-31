use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
    pub stored: Vec<String>,
}

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
    let digest = format!("{:x}", Sha256::digest(value.as_bytes()));
    format!("{prefix}_{cleaned}-{}", &digest[..8])
}

fn url_key(url: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(url.as_bytes()));
    format!("url_{}", &digest[..12])
}

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
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let pages = tokio::time::timeout(
        EXTRACT_LIMIT,
        tokio::task::spawn_blocking(move || rust_pages(&bytes, &reader_stop)),
    )
    .await;
    stop.store(true, Ordering::Relaxed);
    pages
        .map_err(|_| "Reading the PDF's text took longer than a minute.".to_string())?
        .map_err(|_| "Reading the PDF's text stopped unexpectedly.".to_string())?
}

/// The text of a PDF's first [`MAX_PAGES`] pages, read with pdf-extract.
/// pdf-extract follows a page's `/Parent` chain and nested form XObjects
/// with no loop check, and a loop overflows the stack, which aborts the
/// whole process: every page is checked first, and a PDF with a loop is
/// refused. Pages past the cap are counted, not read. `stop` ends the
/// reading at the next page.
fn rust_pages(bytes: &[u8], stop: &AtomicBool) -> Result<Vec<String>, String> {
    let unreadable =
        |error: pdf_extract::Error| format!("The PDF's text could not be read: {error}");
    let mut document = pdf_extract::Document::load_mem(bytes).map_err(unreadable)?;
    if document.is_encrypted() {
        document.decrypt("").map_err(unreadable)?;
    }
    let pages = document.get_pages();
    for &page in pages.values().take(MAX_PAGES) {
        check_page(&document, page)?;
    }
    let mut texts = Vec::with_capacity(pages.len().min(MAX_PAGES));
    for &number in pages.keys().take(MAX_PAGES) {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let mut text = String::new();
        let read = {
            let mut output = pdf_extract::PlainTextOutput::new(&mut text);
            pdf_extract::output_doc_page(&document, &mut output, number)
        };
        // Like pdf-extract's own page loop, a page it can't read ends the text.
        if read.is_err() {
            break;
        }
        texts.push(text);
    }
    if texts.len() == MAX_PAGES {
        texts.resize(pages.len(), String::new());
    }
    Ok(texts)
}

/// Pages pdf-extract climbs for inherited attributes, at most.
const MAX_PAGE_TREE_DEPTH: usize = 256;
const MAX_FORM_DEPTH: usize = 64;
const MAX_FORM_DRAWS: usize = 4_096;
const MALFORMED_PDF: &str = "The PDF's page structure is broken, so its text can't be read.";

fn resolved<'a>(
    document: &'a pdf_extract::Document,
    object: &'a pdf_extract::Object,
) -> &'a pdf_extract::Object {
    match object.as_reference() {
        Ok(id) => document.get_object(id).unwrap_or(object),
        Err(_) => object,
    }
}

fn dictionary_entry<'a>(
    document: &'a pdf_extract::Document,
    dictionary: &'a pdf_extract::Dictionary,
    key: &[u8],
) -> Option<&'a pdf_extract::Object> {
    dictionary
        .get(key)
        .ok()
        .map(|object| resolved(document, object))
}

/// Refuses a page whose `/Parent` chain loops, or whose form XObjects draw
/// themselves (or nest too deeply or too often), the two paths pdf-extract
/// recurses on.
fn check_page(document: &pdf_extract::Document, page: pdf_extract::ObjectId) -> Result<(), String> {
    let mut chain = Vec::new();
    let mut seen = HashSet::from([page]);
    let mut current = document.get_dictionary(page).ok();
    while let Some(dictionary) = current {
        chain.push(dictionary);
        let Ok(parent) = dictionary
            .get(b"Parent")
            .and_then(pdf_extract::Object::as_reference)
        else {
            break;
        };
        if !seen.insert(parent) || seen.len() > MAX_PAGE_TREE_DEPTH {
            return Err(MALFORMED_PDF.into());
        }
        current = document.get_dictionary(parent).ok();
    }
    // The resources pdf-extract draws the page with: the nearest in the chain.
    let empty = pdf_extract::Dictionary::new();
    let resources = chain
        .iter()
        .find_map(|dictionary| {
            dictionary_entry(document, dictionary, b"Resources")
                .and_then(|object| object.as_dict().ok())
        })
        .unwrap_or(&empty);
    let content = document.get_page_content(page).unwrap_or_default();
    check_forms(document, &content, resources, &mut Vec::new(), &mut 0)
}

/// Follows the `Do` operators of `content` the way pdf-extract draws them.
fn check_forms(
    document: &pdf_extract::Document,
    content: &[u8],
    resources: &pdf_extract::Dictionary,
    path: &mut Vec<*const pdf_extract::Stream>,
    draws: &mut usize,
) -> Result<(), String> {
    let Ok(content) = pdf_extract::content::Content::decode(content) else {
        return Ok(());
    };
    for operation in content
        .operations
        .iter()
        .filter(|operation| operation.operator == "Do")
    {
        let Some(name) = operation
            .operands
            .first()
            .and_then(|operand| operand.as_name().ok())
        else {
            continue;
        };
        let Some(form) = dictionary_entry(document, resources, b"XObject")
            .and_then(|xobjects| xobjects.as_dict().ok())
            .and_then(|xobjects| dictionary_entry(document, xobjects, name))
            .and_then(|object| object.as_stream().ok())
        else {
            continue;
        };
        *draws += 1;
        let key: *const pdf_extract::Stream = form;
        if *draws > MAX_FORM_DRAWS || path.len() >= MAX_FORM_DEPTH || path.contains(&key) {
            return Err(MALFORMED_PDF.into());
        }
        let inner = dictionary_entry(document, &form.dict, b"Resources")
            .and_then(|object| object.as_dict().ok())
            .unwrap_or(resources);
        let bytes = match form.filters() {
            Ok(_) => form
                .decompressed_content()
                .unwrap_or_else(|_| form.content.clone()),
            Err(_) => form.content.clone(),
        };
        path.push(key);
        check_forms(document, &bytes, inner, path, draws)?;
        path.pop();
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
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
        PaperRequest::Path { path, root_id } => (
            safe_key(
                "file",
                &match root_id {
                    Some(root_id) => format!("{root_id}/{path}"),
                    None => path.clone(),
                },
            ),
            None,
            None,
        ),
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
        assert_eq!(safe_key("doi", "10.1000/x y"), "doi_10.1000_x_y-ab5c2fbc");
        assert_eq!(safe_key("arxiv", "2410.16464"), "arxiv_2410.16464-c1be2607");
        assert!(url_key("https://example.org/a.pdf").starts_with("url_"));
    }

    #[test]
    fn different_papers_never_share_a_key() {
        assert_ne!(
            safe_key("file", "data/Paper A.pdf"),
            safe_key("file", "data/Paper_A.pdf")
        );
        let long = "x".repeat(100);
        assert_ne!(
            safe_key("file", &format!("{long}a.pdf")),
            safe_key("file", &format!("{long}b.pdf"))
        );
        assert_ne!(safe_key("doi", "10.1/a/b"), safe_key("doi", "10.1/a_b"));
        assert_eq!(safe_key("doi", "10.1/a"), safe_key("doi", "10.1/a"));
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

    fn one_page_pdf(text: &str) -> Vec<u8> {
        let content = format!("BT /F1 24 Tf 72 720 Td ({text}) Tj ET");
        pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
                .to_owned(),
            stream("", &content),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_owned(),
        ])
    }

    fn stream(dictionary: &str, content: &str) -> String {
        format!(
            "<< {dictionary} /Length {} >>\nstream\n{content}\nendstream",
            content.len()
        )
    }

    fn pdf_of(objects: &[String]) -> Vec<u8> {
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

    // pdf-extract climbs `/Parent` for a page's resources and media box with
    // no loop check; these PDFs used to overflow the stack and abort.
    #[test]
    fn a_page_tree_whose_parents_loop_is_refused() {
        let page_is_its_own_parent = pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 3 0 R /Contents 4 0 R >>".to_owned(),
            stream("", "BT ET"),
        ]);
        let parents_in_a_ring = pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 3 0 R >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>".to_owned(),
            stream("", "BT ET"),
        ]);
        for pdf in [page_is_its_own_parent, parents_in_a_ring] {
            assert_eq!(
                rust_pages(&pdf, &AtomicBool::new(false)).unwrap_err(),
                MALFORMED_PDF
            );
        }
    }

    // pdf-extract draws a form XObject by recursing into it, so a form that
    // draws itself (directly or through another form) never ends.
    #[tokio::test]
    async fn a_form_that_draws_itself_is_refused() {
        let page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /X1 5 0 R /X2 6 0 R >> >> /Contents 4 0 R >>";
        let form = "/Type /XObject /Subtype /Form /BBox [0 0 10 10]";
        let draws_itself = pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            page.to_owned(),
            stream("", "/X1 Do"),
            stream(form, "/X1 Do"),
            stream(form, "BT ET"),
        ]);
        let draws_each_other = pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            page.to_owned(),
            stream("", "/X1 Do"),
            stream(form, "/X2 Do"),
            stream(form, "/X1 Do"),
        ]);
        for pdf in [draws_itself, draws_each_other] {
            assert_eq!(
                extract(&pdf, PathBuf::from("unused.pdf"), None)
                    .await
                    .unwrap_err(),
                MALFORMED_PDF
            );
        }
        let drawn_twice = pdf_of(&[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            page.to_owned(),
            stream("", "/X2 Do /X2 Do"),
            stream(form, "BT ET"),
            stream(form, "BT ET"),
        ]);
        assert_eq!(
            rust_pages(&drawn_twice, &AtomicBool::new(false))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn the_rust_reader_stops_when_asked() {
        assert!(rust_pages(&one_page_pdf("Oleafly"), &AtomicBool::new(true))
            .unwrap()
            .is_empty());
    }

    struct Bridge {
        pages: Result<Vec<String>, String>,
        calls: std::sync::atomic::AtomicUsize,
    }

    #[async_trait::async_trait]
    impl PdfTextExtractor for Bridge {
        async fn pages(&self, pdf: PathBuf) -> Result<Vec<String>, String> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
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

    fn workspace_with_pdf(pdf: &[u8]) -> (tempfile::TempDir, TaskFiles) {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("research")).unwrap();
        std::fs::write(root.path().join("research/paper.pdf"), pdf).unwrap();
        let files = TaskFiles::open(root.path(), &["research".to_owned()]).unwrap();
        (root, files)
    }

    const RECORD: &str = "research/r-0000";
    const TEXT_PATH: &str = "research/r-0000/papers/file_research_paper.pdf-d0cb6c00.txt";

    fn workspace_paper() -> PaperRequest {
        PaperRequest::Path {
            path: "research/paper.pdf".into(),
            root_id: None,
        }
    }

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
        assert_eq!(paper.key, "file_research_paper.pdf-d0cb6c00");
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
        assert!(!root
            .path()
            .join("research/r-0000/papers/file_research_paper.pdf-d0cb6c00.pdf")
            .exists());

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
            papers.join("arxiv_2410.16464-c1be2607.txt"),
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
        assert_eq!(paper.key, "arxiv_2410.16464-c1be2607");
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
