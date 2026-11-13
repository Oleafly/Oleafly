use std::borrow::Cow;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use oleafly_core::encoding::hex_lower;
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime};

pub const SCHEME: &str = "oleafly-artifact";
pub const MAX_DOCUMENTS: usize = 64;
pub const MAX_DOCUMENT_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 192 * 1024 * 1024;
const RUNTIME_DIR: &str = "artifact-runtime";
const RUNTIME_FILE: &str = "react-runtime.js";
const RUNTIME_ROUTE: &str = "/runtime/";
const RUNTIME_EXTENSION: &str = ".js";
const RUNTIME_TYPE: &str = "text/javascript; charset=utf-8";
const RUNTIME_CACHE: &str = "public, max-age=31536000, immutable";
const TOKEN_BYTES: usize = 16;
const TOO_LARGE: &str = "This block is too large to run.";
const RUNTIME_MISSING: &str = "This block couldn't load its libraries.";
const FRAME_SCRIPTS: &str = "'unsafe-inline' 'unsafe-eval'";
const FRAME_POLICY_REST: &str = "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'; sandbox allow-scripts";

type Body = Cow<'static, [u8]>;

fn frame_policy(runtime_url: Option<&str>) -> String {
    match runtime_url {
        Some(url) => {
            format!("default-src 'none'; script-src {FRAME_SCRIPTS} {url}; {FRAME_POLICY_REST}")
        }
        None => format!("default-src 'none'; script-src {FRAME_SCRIPTS}; {FRAME_POLICY_REST}"),
    }
}

#[derive(Default)]
struct Documents {
    entries: VecDeque<(String, Arc<Vec<u8>>)>,
    bytes: usize,
}

impl Documents {
    fn insert(&mut self, token: String, html: Vec<u8>) {
        let size = html.len();
        while !self.entries.is_empty()
            && (self.entries.len() >= MAX_DOCUMENTS || self.bytes + size > MAX_TOTAL_BYTES)
        {
            if let Some((_, oldest)) = self.entries.pop_front() {
                self.bytes -= oldest.len();
            }
        }
        self.bytes += size;
        self.entries.push_back((token, Arc::new(html)));
    }

    fn get(&self, token: &str) -> Option<Arc<Vec<u8>>> {
        self.entries
            .iter()
            .find(|(key, _)| key == token)
            .map(|(_, html)| Arc::clone(html))
    }

    fn remove(&mut self, token: &str) -> bool {
        let Some(index) = self.entries.iter().position(|(key, _)| key == token) else {
            return false;
        };
        if let Some((_, html)) = self.entries.remove(index) {
            self.bytes -= html.len();
        }
        true
    }
}

fn with_documents<T>(apply: impl FnOnce(&mut Documents) -> T) -> T {
    static DOCUMENTS: OnceLock<Mutex<Documents>> = OnceLock::new();
    let mut guard = DOCUMENTS
        .get_or_init(|| Mutex::new(Documents::default()))
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    apply(&mut guard)
}

fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    OsRng.fill_bytes(&mut bytes);
    hex_lower(&bytes)
}

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_BYTES * 2
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn frame_origin() -> String {
    if cfg!(windows) {
        format!("http://{SCHEME}.localhost")
    } else {
        format!("{SCHEME}://localhost")
    }
}

pub fn document_url(token: &str) -> String {
    format!("{}/{token}", frame_origin())
}

struct RuntimeFile {
    hash: String,
    url: String,
    bytes: Vec<u8>,
}

impl RuntimeFile {
    fn new(bytes: Vec<u8>) -> Self {
        let hash = hex_lower(&Sha256::digest(&bytes));
        let url = format!("{}{RUNTIME_ROUTE}{hash}{RUNTIME_EXTENSION}", frame_origin());
        Self { hash, url, bytes }
    }
}

static BUNDLED_RUNTIME: OnceLock<RuntimeFile> = OnceLock::new();

fn bundled_with(read: impl FnOnce() -> Option<Vec<u8>>) -> Option<&'static RuntimeFile> {
    if let Some(runtime) = BUNDLED_RUNTIME.get() {
        return Some(runtime);
    }
    let bytes = read()?;
    Some(BUNDLED_RUNTIME.get_or_init(|| RuntimeFile::new(bytes)))
}

fn read_bundled<R: Runtime>(app: &AppHandle<R>) -> Option<Vec<u8>> {
    if tauri::is_dev() {
        let built = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join(RUNTIME_DIR)
            .join(RUNTIME_FILE);
        return std::fs::read(built).ok();
    }
    let key = format!("/{RUNTIME_DIR}/{RUNTIME_FILE}");
    let resolver = app.asset_resolver();
    if !resolver.iter().any(|(name, _)| name == key.as_str()) {
        return None;
    }
    resolver.get(key).map(|asset| asset.bytes)
}

fn bundled_runtime<R: Runtime>(app: &AppHandle<R>) -> Option<&'static RuntimeFile> {
    bundled_with(|| read_bundled(app))
}

fn runtime_url(runtime: Option<&RuntimeFile>) -> Result<String, String> {
    runtime
        .map(|runtime| runtime.url.clone())
        .ok_or_else(|| RUNTIME_MISSING.to_string())
}

pub fn open_document(html: String) -> Result<String, String> {
    if html.len() > MAX_DOCUMENT_BYTES {
        return Err(TOO_LARGE.into());
    }
    let token = new_token();
    with_documents(|documents| documents.insert(token.clone(), html.into_bytes()));
    Ok(document_url(&token))
}

pub fn close_document(token: &str) -> bool {
    valid_token(token) && with_documents(|documents| documents.remove(token))
}

fn response(
    status: StatusCode,
    content_type: &str,
    cache: &str,
    policy: &str,
    body: Body,
) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, policy)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, cache)
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(body)
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[])))
}

fn plain(status: StatusCode, policy: &str, body: &'static [u8]) -> Response<Body> {
    response(
        status,
        "text/plain; charset=utf-8",
        "no-store",
        policy,
        Cow::Borrowed(body),
    )
}

fn respond_with(
    request: &Request<Vec<u8>>,
    runtime: Option<&'static RuntimeFile>,
) -> Response<Body> {
    let policy = frame_policy(runtime.map(|runtime| runtime.url.as_str()));
    let method = request.method();
    if method != Method::GET && method != Method::HEAD {
        return plain(StatusCode::METHOD_NOT_ALLOWED, &policy, b"");
    }
    let head = method == Method::HEAD;
    let path = request.uri().path();
    if let Some(hash) = path
        .strip_prefix(RUNTIME_ROUTE)
        .and_then(|rest| rest.strip_suffix(RUNTIME_EXTENSION))
    {
        let Some(runtime) = runtime.filter(|runtime| runtime.hash == hash) else {
            return plain(StatusCode::NOT_FOUND, &policy, b"Not found");
        };
        let body: Body = if head {
            Cow::Borrowed(&[])
        } else {
            Cow::Borrowed(runtime.bytes.as_slice())
        };
        return response(StatusCode::OK, RUNTIME_TYPE, RUNTIME_CACHE, &policy, body);
    }
    let token = path.trim_start_matches('/');
    if !valid_token(token) {
        return plain(StatusCode::NOT_FOUND, &policy, b"Not found");
    }
    let Some(document) = with_documents(|documents| documents.get(token)) else {
        return plain(StatusCode::NOT_FOUND, &policy, b"Not found");
    };
    let body: Body = if head {
        Cow::Borrowed(&[])
    } else {
        Cow::Owned(document.as_ref().clone())
    };
    response(
        StatusCode::OK,
        "text/html; charset=utf-8",
        "no-store",
        &policy,
        body,
    )
}

pub fn respond(request: &Request<Vec<u8>>) -> Response<Body> {
    respond_with(request, BUNDLED_RUNTIME.get())
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
pub async fn artifact_frame_runtime_url(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || runtime_url(bundled_runtime(&app)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNTIME: &[u8] = b"window.rt = \"</script>\";\n";

    fn runtime() -> &'static RuntimeFile {
        static TEST_RUNTIME: OnceLock<RuntimeFile> = OnceLock::new();
        TEST_RUNTIME.get_or_init(|| RuntimeFile::new(RUNTIME.to_vec()))
    }

    fn token_of(url: &str) -> String {
        url.rsplit('/').next().unwrap().to_string()
    }

    fn request(method: Method, path: &str) -> Request<Vec<u8>> {
        Request::builder()
            .method(method)
            .uri(format!("{}{path}", frame_origin()))
            .body(Vec::new())
            .unwrap()
    }

    fn get(path: &str) -> Response<Body> {
        respond_with(&request(Method::GET, path), Some(runtime()))
    }

    fn header_of<'a>(response: &'a Response<Body>, name: &str) -> &'a str {
        response.headers().get(name).unwrap().to_str().unwrap()
    }

    fn runtime_path() -> String {
        format!("/runtime/{}.js", runtime().hash)
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
        let hash = hex_lower(&Sha256::digest(RUNTIME));
        if cfg!(windows) {
            assert_eq!(
                url,
                "http://oleafly-artifact.localhost/0123456789abcdef0123456789abcdef"
            );
            assert_eq!(
                runtime().url,
                format!("http://oleafly-artifact.localhost/runtime/{hash}.js")
            );
        } else {
            assert_eq!(
                url,
                "oleafly-artifact://localhost/0123456789abcdef0123456789abcdef"
            );
            assert_eq!(
                runtime().url,
                format!("oleafly-artifact://localhost/runtime/{hash}.js")
            );
        }
    }

    #[test]
    fn the_runtime_is_named_by_the_sha256_of_its_bytes() {
        assert_eq!(
            RuntimeFile::new(b"abc".to_vec()).hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(runtime_url(Some(runtime())), Ok(runtime().url.clone()));
        assert_eq!(runtime_url(None), Err(RUNTIME_MISSING.to_string()));
    }

    #[test]
    fn the_bundled_runtime_is_read_once_and_kept() {
        let mut reads = 0;
        let mut read = || {
            reads += 1;
            Some(RUNTIME.to_vec())
        };
        let first = bundled_with(&mut read).unwrap();
        let second = bundled_with(&mut read).unwrap();
        assert!(std::ptr::eq(first, second));
        assert!(reads <= 1);
        assert_eq!(first.bytes, RUNTIME);
    }

    #[test]
    fn a_frame_policy_allows_exactly_the_runtime_url_and_nothing_else() {
        let base = frame_policy(None);
        assert_eq!(
            base,
            "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'; sandbox allow-scripts"
        );
        let with_runtime = frame_policy(Some(&runtime().url));
        assert_eq!(
            with_runtime,
            base.replacen(
                "'unsafe-eval';",
                &format!("'unsafe-eval' {};", runtime().url),
                1
            )
        );
        for policy in [&base, &with_runtime] {
            assert!(policy.contains("connect-src 'none'"));
            assert!(policy.contains("default-src 'none'"));
            assert!(policy.contains("frame-src 'none'"));
            assert!(policy.ends_with("sandbox allow-scripts"));
            assert!(!policy.contains("allow-same-origin"));
            assert!(!policy.contains('*'));
        }
    }

    #[test]
    fn serves_an_open_document_with_locked_down_headers() {
        let url = open_document("<p>hello</p>".into()).unwrap();
        let token = token_of(&url);
        let response = get(&format!("/{token}"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), b"<p>hello</p>");
        assert_eq!(
            header_of(&response, "content-type"),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            header_of(&response, "content-security-policy"),
            frame_policy(Some(&runtime().url))
        );
        assert_eq!(header_of(&response, "x-content-type-options"), "nosniff");
        assert_eq!(header_of(&response, "cache-control"), "no-store");
        assert_eq!(header_of(&response, "referrer-policy"), "no-referrer");
        let without = respond_with(&request(Method::GET, &format!("/{token}")), None);
        assert_eq!(
            header_of(&without, "content-security-policy"),
            frame_policy(None)
        );
        assert!(close_document(&token));
    }

    #[test]
    fn serves_the_runtime_as_cacheable_javascript_at_its_hash() {
        let response = get(&runtime_path());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), RUNTIME);
        assert!(matches!(response.body(), Cow::Borrowed(_)));
        assert_eq!(
            header_of(&response, "content-type"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            header_of(&response, "cache-control"),
            "public, max-age=31536000, immutable"
        );
        assert_eq!(header_of(&response, "x-content-type-options"), "nosniff");
        assert_eq!(header_of(&response, "referrer-policy"), "no-referrer");
        let head = respond_with(&request(Method::HEAD, &runtime_path()), Some(runtime()));
        assert_eq!(head.status(), StatusCode::OK);
        assert!(head.body().is_empty());
        assert_eq!(header_of(&head, "content-type"), RUNTIME_TYPE);
        let query = get(&format!("{}?v=1", runtime_path()));
        assert_eq!(query.status(), StatusCode::OK);
    }

    #[test]
    fn any_other_runtime_path_is_not_found() {
        let hash = &runtime().hash;
        let other = hex_lower(&Sha256::digest(b"other"));
        for path in [
            format!("/runtime/{other}.js"),
            format!("/runtime/{}.js", hash.to_uppercase()),
            format!("/runtime/{}.js", &hash[..63]),
            format!("/runtime/{hash}"),
            format!("/runtime/{hash}.mjs"),
            format!("/runtime/{hash}.js/x"),
            format!("/runtime/../{hash}.js"),
            format!("/runtime//{hash}.js"),
            format!("/runtime/%{hash}.js"),
            "/runtime/.js".to_string(),
            "/runtime/".to_string(),
            "/artifact-runtime/react-runtime.js".to_string(),
            "/react-runtime.js".to_string(),
        ] {
            let response = get(&path);
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert_eq!(header_of(&response, "cache-control"), "no-store");
            assert_eq!(
                header_of(&response, "content-type"),
                "text/plain; charset=utf-8"
            );
        }
        let missing = respond_with(&request(Method::GET, &runtime_path()), None);
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn head_requests_carry_headers_without_a_body() {
        let token = token_of(&open_document("<p>head</p>".into()).unwrap());
        let response = respond_with(
            &request(Method::HEAD, &format!("/{token}")),
            Some(runtime()),
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
        assert_eq!(
            header_of(&missing, "content-security-policy"),
            frame_policy(Some(&runtime().url))
        );
        assert_eq!(header_of(&missing, "cache-control"), "no-store");
        let token = token_of(&open_document("x".into()).unwrap());
        assert_eq!(
            get(&format!("/{token}/extra")).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(&format!("/runtime/{token}.js")).status(),
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
        for path in [format!("/{token}"), runtime_path()] {
            let mut post = request(Method::POST, &path);
            *post.body_mut() = b"data".to_vec();
            let response = respond_with(&post, Some(runtime()));
            assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
            assert!(response.body().is_empty());
        }
        assert!(close_document(&token));
    }

    #[test]
    fn oversized_documents_are_refused() {
        assert_eq!(
            open_document("x".repeat(MAX_DOCUMENT_BYTES + 1)),
            Err(TOO_LARGE.to_string())
        );
        let url = open_document("x".repeat(MAX_DOCUMENT_BYTES)).unwrap();
        assert!(close_document(&token_of(&url)));
    }

    #[test]
    fn documents_are_served_exactly_as_written() {
        let html = "<script src=\"oleafly-artifact://localhost/runtime/x.js\"></script>\"oleafly-runtime:abc\"";
        let url = open_document(html.into()).unwrap();
        assert_eq!(
            get(&format!("/{}", token_of(&url))).body().as_ref(),
            html.as_bytes()
        );
        assert!(close_document(&token_of(&url)));
    }

    #[test]
    fn the_registry_keeps_the_newest_documents_within_the_caps() {
        let mut documents = Documents::default();
        for index in 0..MAX_DOCUMENTS + 3 {
            documents.insert(format!("{index:032x}"), vec![b'x'; 10]);
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
            documents.insert(format!("{index:032x}"), vec![0; chunk]);
        }
        assert_eq!(documents.entries.len(), 4);
        assert!(documents.bytes <= MAX_TOTAL_BYTES);
        assert!(documents.get(&format!("{:032x}", 0)).is_none());
        assert!(documents.get(&format!("{:032x}", 4)).is_some());
    }
}
