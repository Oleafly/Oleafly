use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tauri::http::{header, Method, Request, Response, StatusCode};

pub const SCHEME: &str = "oleafly-artifact";
pub const MAX_DOCUMENTS: usize = 64;
pub const MAX_DOCUMENT_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 192 * 1024 * 1024;
pub const MAX_RUNTIMES: usize = 4;
pub const MAX_RUNTIME_BYTES: usize = 8 * 1024 * 1024;
pub const RUNTIME_MARKER: &str = "\"oleafly-runtime:";
const TOKEN_BYTES: usize = 16;
const HASH_CHARS: usize = 64;
const TOO_LARGE: &str = "This block is too large to run.";
const RUNTIME_TOO_LARGE: &str = "This block's libraries are too large to load.";
const RUNTIME_MISSING: &str = "This block couldn't load its libraries.";
pub const FRAME_POLICY: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'; sandbox allow-scripts";

struct Splice {
    start: usize,
    end: usize,
    literal: Arc<Vec<u8>>,
}

struct Body {
    html: Vec<u8>,
    runtime: Option<Splice>,
}

impl Body {
    fn len(&self) -> usize {
        match &self.runtime {
            Some(splice) => self.html.len() - (splice.end - splice.start) + splice.literal.len(),
            None => self.html.len(),
        }
    }

    fn bytes(&self) -> Vec<u8> {
        let Some(splice) = &self.runtime else {
            return self.html.clone();
        };
        let mut bytes = Vec::with_capacity(self.len());
        bytes.extend_from_slice(&self.html[..splice.start]);
        bytes.extend_from_slice(&splice.literal);
        bytes.extend_from_slice(&self.html[splice.end..]);
        bytes
    }
}

struct Document {
    token: String,
    body: Arc<Body>,
}

#[derive(Default)]
struct Documents {
    entries: VecDeque<Document>,
    bytes: usize,
}

impl Documents {
    fn insert(&mut self, token: String, body: Body) {
        let size = body.len();
        while !self.entries.is_empty()
            && (self.entries.len() >= MAX_DOCUMENTS || self.bytes + size > MAX_TOTAL_BYTES)
        {
            if let Some(oldest) = self.entries.pop_front() {
                self.bytes -= oldest.body.len();
            }
        }
        self.bytes += size;
        self.entries.push_back(Document {
            token,
            body: Arc::new(body),
        });
    }

    fn get(&self, token: &str) -> Option<Arc<Body>> {
        self.entries
            .iter()
            .find(|document| document.token == token)
            .map(|document| Arc::clone(&document.body))
    }

    fn remove(&mut self, token: &str) -> bool {
        let Some(index) = self
            .entries
            .iter()
            .position(|document| document.token == token)
        else {
            return false;
        };
        if let Some(document) = self.entries.remove(index) {
            self.bytes -= document.body.len();
        }
        true
    }
}

struct Runtime {
    hash: String,
    literal: Arc<Vec<u8>>,
}

#[derive(Default)]
struct Runtimes {
    entries: VecDeque<Runtime>,
}

impl Runtimes {
    fn insert(&mut self, hash: String, literal: Vec<u8>) {
        if self.touch(&hash).is_some() {
            return;
        }
        while self.entries.len() >= MAX_RUNTIMES {
            self.entries.pop_front();
        }
        self.entries.push_back(Runtime {
            hash,
            literal: Arc::new(literal),
        });
    }

    fn touch(&mut self, hash: &str) -> Option<Arc<Vec<u8>>> {
        let index = self
            .entries
            .iter()
            .position(|runtime| runtime.hash == hash)?;
        let runtime = self.entries.remove(index)?;
        let literal = Arc::clone(&runtime.literal);
        self.entries.push_back(runtime);
        Some(literal)
    }
}

fn locked<T, R>(cell: &'static OnceLock<Mutex<T>>, apply: impl FnOnce(&mut T) -> R) -> R
where
    T: Default,
{
    let mut guard = cell
        .get_or_init(|| Mutex::new(T::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    apply(&mut guard)
}

fn with_documents<T>(apply: impl FnOnce(&mut Documents) -> T) -> T {
    static DOCUMENTS: OnceLock<Mutex<Documents>> = OnceLock::new();
    locked(&DOCUMENTS, apply)
}

fn with_runtimes<T>(apply: impl FnOnce(&mut Runtimes) -> T) -> T {
    static RUNTIMES: OnceLock<Mutex<Runtimes>> = OnceLock::new();
    locked(&RUNTIMES, apply)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_token(token: &str) -> bool {
    lower_hex(token, TOKEN_BYTES * 2)
}

fn runtime_hash(text: &str) -> String {
    hex(&Sha256::digest(text.as_bytes()))
}

fn runtime_literal(text: &str) -> Result<Vec<u8>, String> {
    let json = serde_json::to_string(text).map_err(|error| error.to_string())?;
    let mut literal = String::with_capacity(json.len() + 64);
    for character in json.chars() {
        match character {
            '<' => literal.push_str("\\u003c"),
            '\u{2028}' => literal.push_str("\\u2028"),
            '\u{2029}' => literal.push_str("\\u2029"),
            other => literal.push(other),
        }
    }
    Ok(literal.into_bytes())
}

pub fn put_runtime(text: &str) -> Result<String, String> {
    if text.len() > MAX_RUNTIME_BYTES {
        return Err(RUNTIME_TOO_LARGE.into());
    }
    let hash = runtime_hash(text);
    if with_runtimes(|runtimes| runtimes.touch(&hash)).is_none() {
        let literal = runtime_literal(text)?;
        with_runtimes(|runtimes| runtimes.insert(hash.clone(), literal));
    }
    Ok(hash)
}

fn runtime_reference(html: &str) -> Option<(usize, usize, &str)> {
    let start = html.find(RUNTIME_MARKER)?;
    let hash_start = start + RUNTIME_MARKER.len();
    let hash = html.get(hash_start..hash_start + HASH_CHARS)?;
    let end = hash_start + HASH_CHARS;
    if !lower_hex(hash, HASH_CHARS) || html.as_bytes().get(end) != Some(&b'"') {
        return None;
    }
    Some((start, end + 1, hash))
}

fn prepare(html: String) -> Result<Body, String> {
    let runtime = match runtime_reference(&html) {
        Some((start, end, hash)) => {
            let literal = with_runtimes(|runtimes| runtimes.touch(hash))
                .ok_or_else(|| RUNTIME_MISSING.to_string())?;
            Some(Splice {
                start,
                end,
                literal,
            })
        }
        None => None,
    };
    let body = Body {
        html: html.into_bytes(),
        runtime,
    };
    if body.len() > MAX_DOCUMENT_BYTES {
        return Err(TOO_LARGE.into());
    }
    Ok(body)
}

pub fn document_url(token: &str) -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{token}")
    } else {
        format!("{SCHEME}://localhost/{token}")
    }
}

pub fn open_document(html: String) -> Result<String, String> {
    let body = prepare(html)?;
    let token = new_token();
    with_documents(|documents| documents.insert(token.clone(), body));
    Ok(document_url(&token))
}

pub fn close_document(token: &str) -> bool {
    valid_token(token) && with_documents(|documents| documents.remove(token))
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, FRAME_POLICY)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn not_found() -> Response<Vec<u8>> {
    response(
        StatusCode::NOT_FOUND,
        "text/plain; charset=utf-8",
        b"Not found".to_vec(),
    )
}

pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let method = request.method();
    if method != Method::GET && method != Method::HEAD {
        return response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain; charset=utf-8",
            Vec::new(),
        );
    }
    let token = request.uri().path().trim_start_matches('/');
    if !valid_token(token) {
        return not_found();
    }
    let Some(document) = with_documents(|documents| documents.get(token)) else {
        return not_found();
    };
    let body = if method == Method::HEAD {
        Vec::new()
    } else {
        document.bytes()
    };
    response(StatusCode::OK, "text/html; charset=utf-8", body)
}

#[tauri::command]
pub async fn artifact_frame_open(html: String) -> Result<String, String> {
    open_document(html)
}

#[tauri::command]
pub async fn artifact_frame_close(token: String) -> bool {
    close_document(&token)
}

#[tauri::command]
pub async fn artifact_frame_put_runtime(text: String) -> Result<String, String> {
    put_runtime(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_of(url: &str) -> String {
        url.rsplit('/').next().unwrap().to_string()
    }

    fn get(path: &str) -> Response<Vec<u8>> {
        let uri = if cfg!(windows) {
            format!("http://{SCHEME}.localhost{path}")
        } else {
            format!("{SCHEME}://localhost{path}")
        };
        respond(&Request::builder().uri(uri).body(Vec::new()).unwrap())
    }

    fn header_of<'a>(response: &'a Response<Vec<u8>>, name: &str) -> &'a str {
        response.headers().get(name).unwrap().to_str().unwrap()
    }

    #[test]
    fn tokens_are_random_lowercase_hex_of_128_bits() {
        let first = new_token();
        let second = new_token();
        assert_eq!(first.len(), 32);
        assert!(valid_token(&first));
        assert_ne!(first, second);
        assert!(!valid_token("ABCDEF0123456789abcdef0123456789"));
        assert!(!valid_token("0123"));
        assert!(!valid_token("../0123456789abcdef0123456789abcd"));
        assert!(!valid_token(""));
    }

    #[test]
    fn urls_use_the_platform_form_of_the_scheme() {
        let url = document_url("0123456789abcdef0123456789abcdef");
        if cfg!(windows) {
            assert_eq!(
                url,
                "http://oleafly-artifact.localhost/0123456789abcdef0123456789abcdef"
            );
        } else {
            assert_eq!(
                url,
                "oleafly-artifact://localhost/0123456789abcdef0123456789abcdef"
            );
        }
    }

    #[test]
    fn serves_an_open_document_with_locked_down_headers() {
        let url = open_document("<p>hello</p>".into()).unwrap();
        let token = token_of(&url);
        let response = get(&format!("/{token}"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"<p>hello</p>");
        assert_eq!(
            header_of(&response, "content-type"),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            header_of(&response, "content-security-policy"),
            FRAME_POLICY
        );
        assert_eq!(header_of(&response, "x-content-type-options"), "nosniff");
        assert_eq!(header_of(&response, "cache-control"), "no-store");
        assert_eq!(header_of(&response, "referrer-policy"), "no-referrer");
        assert!(FRAME_POLICY.contains("connect-src 'none'"));
        assert!(FRAME_POLICY.contains("default-src 'none'"));
        assert!(FRAME_POLICY.contains("sandbox allow-scripts"));
        assert!(!FRAME_POLICY.contains("allow-same-origin"));
        assert!(close_document(&token));
    }

    #[test]
    fn head_requests_carry_headers_without_a_body() {
        let token = token_of(&open_document("<p>head</p>".into()).unwrap());
        let uri = document_url(&token);
        let response = respond(
            &Request::builder()
                .method(Method::HEAD)
                .uri(uri)
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().is_empty());
        assert!(close_document(&token));
    }

    #[test]
    fn unknown_malformed_and_closed_tokens_are_not_found() {
        assert_eq!(
            get("/0123456789abcdef0123456789abcdef").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(get("/").status(), StatusCode::NOT_FOUND);
        assert_eq!(get("/index.html").status(), StatusCode::NOT_FOUND);
        let missing = get("/nope");
        assert_eq!(header_of(&missing, "content-security-policy"), FRAME_POLICY);
        assert_eq!(header_of(&missing, "cache-control"), "no-store");
        let token = token_of(&open_document("x".into()).unwrap());
        assert_eq!(
            get(&format!("/{token}/extra")).status(),
            StatusCode::NOT_FOUND
        );
        assert!(close_document(&token));
        assert!(!close_document(&token));
        assert_eq!(get(&format!("/{token}")).status(), StatusCode::NOT_FOUND);
        assert!(!close_document("not-a-token"));
    }

    #[test]
    fn other_methods_are_refused() {
        let token = token_of(&open_document("x".into()).unwrap());
        let response = respond(
            &Request::builder()
                .method(Method::POST)
                .uri(document_url(&token))
                .body(b"data".to_vec())
                .unwrap(),
        );
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert!(close_document(&token));
    }

    #[test]
    fn oversized_documents_are_refused() {
        assert!(open_document("x".repeat(MAX_DOCUMENT_BYTES + 1)).is_err());
        let url = open_document("x".repeat(MAX_DOCUMENT_BYTES)).unwrap();
        assert!(close_document(&token_of(&url)));
    }

    #[test]
    fn the_registry_keeps_the_newest_documents_within_the_caps() {
        let mut documents = Documents::default();
        for index in 0..MAX_DOCUMENTS + 3 {
            documents.insert(
                format!("{index:032x}"),
                Body {
                    html: vec![b'x'; 10],
                    runtime: None,
                },
            );
        }
        assert_eq!(documents.entries.len(), MAX_DOCUMENTS);
        assert_eq!(documents.bytes, MAX_DOCUMENTS * 10);
        assert!(documents.get(&format!("{:032x}", 0)).is_none());
        assert!(documents.get(&format!("{:032x}", 2)).is_none());
        assert!(documents.get(&format!("{:032x}", 3)).is_some());
        assert!(documents
            .get(&format!("{:032x}", MAX_DOCUMENTS + 2))
            .is_some());
        assert!(documents.remove(&format!("{:032x}", 3)));
        assert!(!documents.remove(&format!("{:032x}", 3)));
        assert_eq!(documents.bytes, (MAX_DOCUMENTS - 1) * 10);
    }

    #[test]
    fn the_registry_evicts_oldest_documents_to_stay_under_the_byte_budget() {
        let mut documents = Documents::default();
        let chunk = MAX_TOTAL_BYTES / 4;
        for index in 0..5 {
            documents.insert(
                format!("{index:032x}"),
                Body {
                    html: vec![0; chunk],
                    runtime: None,
                },
            );
        }
        assert_eq!(documents.entries.len(), 4);
        assert!(documents.bytes <= MAX_TOTAL_BYTES);
        assert!(documents.get(&format!("{:032x}", 0)).is_none());
        assert!(documents.get(&format!("{:032x}", 4)).is_some());
    }

    const RUNTIME: &str = "window.rt = \"</script>\\\u{2028}\u{2029}\";\n";
    const RUNTIME_LITERAL: &str = "\"window.rt = \\\"\\u003c/script>\\\\\\u2028\\u2029\\\";\\n\"";

    fn marker(hash: &str) -> String {
        format!("{RUNTIME_MARKER}{hash}\"")
    }

    fn served(url: &str) -> String {
        String::from_utf8(get(&format!("/{}", token_of(url))).into_body()).unwrap()
    }

    #[test]
    fn runtime_literals_escape_like_the_frames_inline_json() {
        assert_eq!(
            String::from_utf8(runtime_literal(RUNTIME).unwrap()).unwrap(),
            RUNTIME_LITERAL
        );
        assert_eq!(
            String::from_utf8(runtime_literal("\u{1}\u{1f}\t\u{7f}\u{e9}<<").unwrap()).unwrap(),
            "\"\\u0001\\u001f\\t\u{7f}\u{e9}\\u003c\\u003c\""
        );
    }

    #[test]
    fn runtimes_are_named_by_their_sha256() {
        assert_eq!(
            runtime_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let hash = put_runtime(RUNTIME).unwrap();
        assert_eq!(hash, runtime_hash(RUNTIME));
        assert_eq!(put_runtime(RUNTIME).unwrap(), hash);
        let copies = with_runtimes(|runtimes| {
            runtimes
                .entries
                .iter()
                .filter(|runtime| runtime.hash == hash)
                .count()
        });
        assert_eq!(copies, 1);
    }

    #[test]
    fn oversized_runtimes_are_refused() {
        assert_eq!(
            put_runtime(&"x".repeat(MAX_RUNTIME_BYTES + 1)),
            Err(RUNTIME_TOO_LARGE.to_string())
        );
    }

    #[test]
    fn serves_documents_with_the_runtime_spliced_in_once() {
        let hash = put_runtime(RUNTIME).unwrap();
        let html = format!(
            "<head><script>(0, eval)({});</script></head><body>{}</body>",
            marker(&hash),
            marker(&hash)
        );
        let url = open_document(html).unwrap();
        assert_eq!(
            served(&url),
            format!(
                "<head><script>(0, eval)({RUNTIME_LITERAL});</script></head><body>{}</body>",
                marker(&hash)
            )
        );
        let response = get(&format!("/{}", token_of(&url)));
        assert_eq!(
            header_of(&response, "content-security-policy"),
            FRAME_POLICY
        );
        assert_eq!(header_of(&response, "cache-control"), "no-store");
        let head = respond(
            &Request::builder()
                .method(Method::HEAD)
                .uri(&url)
                .body(Vec::new())
                .unwrap(),
        );
        assert_eq!(head.status(), StatusCode::OK);
        assert!(head.body().is_empty());
        assert!(close_document(&token_of(&url)));
    }

    #[test]
    fn documents_naming_an_unknown_runtime_are_refused() {
        assert_eq!(
            open_document(format!("<script>({})</script>", marker(&"0".repeat(64)))),
            Err(RUNTIME_MISSING.to_string())
        );
    }

    #[test]
    fn malformed_runtime_markers_are_served_as_written() {
        let hash = runtime_hash(RUNTIME);
        for html in [
            format!("{RUNTIME_MARKER}{}\"", &hash[..63]),
            format!("{RUNTIME_MARKER}{}\"", hash.to_uppercase()),
            format!("{RUNTIME_MARKER}{hash}'"),
            format!("{RUNTIME_MARKER}{hash}"),
            format!("{RUNTIME_MARKER}{}\u{e9}{}\"", &hash[..63], &hash[..1]),
            format!("{RUNTIME_MARKER}{}", &hash[..10]),
        ] {
            let url = open_document(html.clone()).unwrap();
            assert_eq!(served(&url), html);
            assert!(close_document(&token_of(&url)));
        }
    }

    #[test]
    fn the_size_limit_counts_the_spliced_runtime() {
        let hash = put_runtime(RUNTIME).unwrap();
        let reference = marker(&hash);
        let room = MAX_DOCUMENT_BYTES - RUNTIME_LITERAL.len();
        let fits = format!("{reference}{}", "x".repeat(room));
        let url = open_document(fits).unwrap();
        assert!(close_document(&token_of(&url)));
        assert_eq!(
            open_document(format!("{reference}{}", "x".repeat(room + 1))),
            Err(TOO_LARGE.to_string())
        );
    }

    #[test]
    fn the_registry_budgets_documents_at_their_served_size() {
        let mut documents = Documents::default();
        let literal = Arc::new(vec![b'r'; 100]);
        documents.insert(
            "a".repeat(32),
            Body {
                html: b"<p>[marker]</p>".to_vec(),
                runtime: Some(Splice {
                    start: 3,
                    end: 11,
                    literal: Arc::clone(&literal),
                }),
            },
        );
        assert_eq!(documents.bytes, 107);
        let body = documents.get(&"a".repeat(32)).unwrap();
        assert_eq!(body.len(), 107);
        assert_eq!(
            body.bytes(),
            [b"<p>".as_slice(), &literal, b"</p>"].concat()
        );
        assert!(documents.remove(&"a".repeat(32)));
        assert_eq!(documents.bytes, 0);
    }

    #[test]
    fn the_runtime_cache_keeps_the_most_recently_used_runtimes() {
        let mut runtimes = Runtimes::default();
        for index in 0..MAX_RUNTIMES {
            runtimes.insert(format!("{index:064x}"), vec![index as u8]);
        }
        assert!(runtimes.touch(&format!("{:064x}", 0)).is_some());
        runtimes.insert(format!("{:064x}", 1), vec![99]);
        assert_eq!(
            runtimes.touch(&format!("{:064x}", 1)).unwrap().as_slice(),
            &[1]
        );
        runtimes.insert(format!("{:064x}", MAX_RUNTIMES), vec![9]);
        assert_eq!(runtimes.entries.len(), MAX_RUNTIMES);
        assert!(runtimes.touch(&format!("{:064x}", 2)).is_none());
        assert!(runtimes.touch(&format!("{:064x}", 0)).is_some());
        assert!(runtimes.touch(&format!("{:064x}", MAX_RUNTIMES)).is_some());
        assert!(runtimes.touch(&"f".repeat(64)).is_none());
    }
}
