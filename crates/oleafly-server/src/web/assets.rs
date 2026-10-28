use std::borrow::Cow;

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::page::{document_in, status, Tone};

use crate::routes::auth::found;
use crate::state::AppState;
use crate::web::WebOn;

#[derive(rust_embed::RustEmbed)]
#[folder = "../../web/dist"]
#[allow_missing = true]
struct Dist;

pub const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob: https:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
pub const NO_CACHE: &str = "no-cache";
const INDEX: &str = "index.html";
const ASSETS: &str = "assets/";

pub trait Files {
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>>;
}

struct Embedded;

impl Files for Embedded {
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        Dist::get(path).map(|file| file.data)
    }
}

pub fn content_type(path: &str) -> &'static str {
    let extension = path
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn secure(headers: &mut HeaderMap) {
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
}

fn respond(
    status_code: StatusCode,
    body: Cow<'static, [u8]>,
    kind: &'static str,
    cache: &'static str,
) -> Response {
    let mut response = (status_code, body.into_owned()).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    secure(headers);
    response
}

fn placeholder() -> Response {
    let title = "The browser app is not in this build";
    let page = document_in(
        "en",
        title,
        &format!(
            "{}<h1>{title}</h1><p>This copy of Oleafly Server was built without the browser app. Build it with pnpm web:build, then build the server with the web feature, or use the official image.</p>",
            status(Tone::Notice)
        ),
        None,
    );
    respond(
        StatusCode::SERVICE_UNAVAILABLE,
        Cow::Owned(page.into_bytes()),
        "text/html; charset=utf-8",
        "no-store",
    )
}

fn missing() -> Response {
    respond(
        StatusCode::NOT_FOUND,
        Cow::Borrowed(b"Not found."),
        "text/plain; charset=utf-8",
        "no-store",
    )
}

fn index_of(files: &dyn Files) -> Response {
    match files.read(INDEX) {
        Some(bytes) => respond(StatusCode::OK, bytes, content_type(INDEX), NO_CACHE),
        None => placeholder(),
    }
}

pub fn serve(files: &dyn Files, path: &str) -> Response {
    let path = path.trim_start_matches('/');
    if path.is_empty() || path == INDEX {
        return index_of(files);
    }
    let unsafe_path = path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || path.contains('\\')
        || path.chars().any(char::is_control);
    if unsafe_path {
        return missing();
    }
    if let Some(bytes) = files.read(path) {
        let cache = if path.starts_with(ASSETS) {
            IMMUTABLE
        } else {
            NO_CACHE
        };
        return respond(StatusCode::OK, bytes, content_type(path), cache);
    }
    let named = path.rsplit('/').next().unwrap_or(path);
    if named.contains('.') {
        return missing();
    }
    index_of(files)
}

pub async fn home(_on: WebOn, State(state): State<AppState>, uri: Uri) -> Response {
    let target = match uri.query() {
        Some(query) => format!("{}/web/?{query}", state.config.path_prefix()),
        None => format!("{}/web/", state.config.path_prefix()),
    };
    found(&target)
}

pub async fn index(_on: WebOn) -> Response {
    serve(&Embedded, "")
}

pub async fn file(_on: WebOn, Path(path): Path<String>) -> Response {
    serve(&Embedded, &path)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    struct Fake(HashMap<&'static str, &'static [u8]>);

    impl Files for Fake {
        fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
            self.0.get(path).map(|bytes| Cow::Borrowed(*bytes))
        }
    }

    fn built() -> Fake {
        Fake(HashMap::from([
            (
                "index.html",
                b"<!doctype html><title>Oleafly</title>".as_slice(),
            ),
            ("assets/index-1a2b3c.js", b"console.log(1)".as_slice()),
            ("assets/pdf.worker-9f8e.mjs", b"self.x=1".as_slice()),
        ]))
    }

    fn header_of(response: &Response, name: header::HeaderName) -> &str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
    }

    #[test]
    fn hashed_assets_are_cached_for_a_year_and_the_page_never() {
        let files = built();
        let script = serve(&files, "assets/index-1a2b3c.js");
        assert_eq!(script.status(), StatusCode::OK);
        assert_eq!(header_of(&script, header::CACHE_CONTROL), IMMUTABLE);
        assert_eq!(
            header_of(&script, header::CONTENT_TYPE),
            "text/javascript; charset=utf-8"
        );
        let worker = serve(&files, "assets/pdf.worker-9f8e.mjs");
        assert_eq!(header_of(&worker, header::CACHE_CONTROL), IMMUTABLE);
        for path in ["", "index.html", "/"] {
            let page = serve(&files, path);
            assert_eq!(page.status(), StatusCode::OK, "{path}");
            assert_eq!(header_of(&page, header::CACHE_CONTROL), NO_CACHE);
            assert_eq!(
                header_of(&page, header::CONTENT_TYPE),
                "text/html; charset=utf-8"
            );
        }
    }

    #[test]
    fn app_routes_get_the_page_and_missing_files_do_not() {
        let files = built();
        for route in ["projects", "p/abc", "settings/people"] {
            let page = serve(&files, route);
            assert_eq!(page.status(), StatusCode::OK, "{route}");
            assert_eq!(header_of(&page, header::CACHE_CONTROL), NO_CACHE);
        }
        for missing in [
            "assets/gone-0000.js",
            "favicon.ico",
            "../Cargo.toml",
            "assets/../index.html",
            "assets//x.js",
        ] {
            assert_eq!(
                serve(&files, missing).status(),
                StatusCode::NOT_FOUND,
                "{missing}"
            );
        }
    }

    #[test]
    fn every_answer_carries_the_browser_app_security_headers() {
        let files = built();
        for path in ["", "assets/index-1a2b3c.js", "projects", "assets/gone.js"] {
            let response = serve(&files, path);
            assert_eq!(
                header_of(&response, header::CONTENT_SECURITY_POLICY),
                CONTENT_SECURITY_POLICY
            );
            assert_eq!(
                header_of(&response, header::X_CONTENT_TYPE_OPTIONS),
                "nosniff"
            );
            assert_eq!(header_of(&response, header::X_FRAME_OPTIONS), "DENY");
            assert_eq!(header_of(&response, header::REFERRER_POLICY), "same-origin");
        }
        assert!(CONTENT_SECURITY_POLICY.contains("frame-ancestors 'none'"));
        assert!(CONTENT_SECURITY_POLICY.contains("img-src 'self' data: blob: https:"));
    }

    #[test]
    fn without_a_built_app_the_page_explains_how_to_get_one() {
        let empty = Fake(HashMap::new());
        let response = serve(&empty, "");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(header_of(&response, header::CACHE_CONTROL), "no-store");
        assert_eq!(
            serve(&empty, "projects").status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
