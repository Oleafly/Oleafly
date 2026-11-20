use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::Response;
use percent_encoding::percent_decode_str;

use crate::app_error::AppError;

const LINKS_PATH: &str = "/oleafly-preview-links.js";
const LINKS_SCRIPT: &str = include_str!("html_preview_links.js");
const LINKS_TAG: &[u8] = b"<script src=\"/oleafly-preview-links.js\"></script>";
const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; ",
    "style-src 'self' 'unsafe-inline' data: blob:; ",
    "img-src 'self' data: blob:; ",
    "font-src 'self' data: blob:; ",
    "media-src 'self' data: blob:; ",
    "connect-src 'self' data: blob:; ",
    "frame-src 'self' blob:; ",
    "worker-src 'self' blob:; ",
    "object-src 'none'; ",
    "form-action 'self'; ",
    "base-uri 'self'"
);
const UNREADABLE_LOG_LIMIT: usize = 256;
const STREAM_CHUNK: usize = 64 * 1024;

fn roots() -> &'static Mutex<HashMap<String, PathBuf>> {
    static ROOTS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    ROOTS.get_or_init(Mutex::default)
}

fn token_for(root: PathBuf) -> String {
    let mut roots = roots().lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((token, _)) = roots.iter().find(|(_, known)| **known == root) {
        return token.clone();
    }
    let token = format!("{:032x}", rand::random::<u128>());
    roots.insert(token.clone(), root);
    token
}

fn root_of(token: &str) -> Option<PathBuf> {
    roots()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(token)
        .cloned()
}

fn servable(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && !segment.contains(['/', '\\', '\0'])
        && !(cfg!(windows) && segment.contains(':'))
}

fn hidden(inside: &Path) -> bool {
    inside
        .components()
        .any(|part| part.as_os_str().as_encoded_bytes().starts_with(b"."))
}

fn file_in<S: AsRef<str>>(root: &Path, segments: &[S]) -> Option<PathBuf> {
    if segments.is_empty() || !segments.iter().all(|segment| servable(segment.as_ref())) {
        return None;
    }
    let relative = segments
        .iter()
        .map(AsRef::as_ref)
        .collect::<Vec<&str>>()
        .join("/");
    let file = crate::sandbox::resolve_within(root, &relative)
        .ok()?
        .canonicalize()
        .ok()?;
    let inside = file.strip_prefix(root).ok()?;
    (!hidden(inside) && file.is_file()).then_some(file)
}

fn request_target(path: &str) -> Option<(String, Vec<String>)> {
    let mut segments = path.strip_prefix('/')?.split('/');
    let token = segments.next()?.to_owned();
    let decoded = segments
        .map(|segment| {
            percent_decode_str(segment)
                .decode_utf8()
                .ok()
                .map(|segment| segment.into_owned())
        })
        .collect::<Option<Vec<String>>>()?;
    Some((token, decoded))
}

fn first_unreadable(file: &Path) -> bool {
    static LOGGED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
    let mut logged = LOGGED.lock().unwrap_or_else(PoisonError::into_inner);
    let logged = logged.get_or_insert_with(HashSet::new);
    logged.len() < UNREADABLE_LOG_LIMIT && logged.insert(file.to_path_buf())
}

fn after_tag(page: &[u8], name: &[u8]) -> Option<usize> {
    let mut at = 0;
    while at < page.len() {
        let open = at + page[at..].iter().position(|&byte| byte == b'<')?;
        let rest = &page[open + 1..];
        if rest.starts_with(b"!--") {
            let close = rest.windows(3).position(|window| window == b"-->")?;
            at = open + 1 + close + 3;
            continue;
        }
        let named = rest.len() > name.len()
            && rest[..name.len()].eq_ignore_ascii_case(name)
            && matches!(
                rest[name.len()],
                b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r' | b'\x0c'
            );
        if named {
            let end = rest.iter().position(|&byte| byte == b'>')?;
            return Some(open + 1 + end + 1);
        }
        at = open + 1;
    }
    None
}

fn with_link_script(page: &[u8]) -> Vec<u8> {
    let at = after_tag(page, b"head")
        .or_else(|| after_tag(page, b"html"))
        .or_else(|| after_tag(page, b"!doctype"))
        .unwrap_or(0);
    let mut served = Vec::with_capacity(page.len() + LINKS_TAG.len());
    served.extend_from_slice(&page[..at]);
    served.extend_from_slice(LINKS_TAG);
    served.extend_from_slice(&page[at..]);
    served
}

fn refusal(status: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
}

async fn serve(request: Request) -> Response {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return refusal(StatusCode::METHOD_NOT_ALLOWED);
    }
    if request.uri().path() == LINKS_PATH {
        return served(
            "text/javascript; charset=utf-8",
            crate::navigation_guard::with_app_page_origin(LINKS_SCRIPT).into_bytes(),
        );
    }
    let Some((token, segments)) = request_target(request.uri().path()) else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let Some(root) = root_of(&token) else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let found = tauri::async_runtime::spawn_blocking(move || file_in(&root, &segments))
        .await
        .ok()
        .flatten();
    let Some(file) = found else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let range = request.headers().get(header::RANGE).cloned();
    let read = if crate::media_type::media_type(&file) == Some("text/html") {
        tokio::fs::read(&file)
            .await
            .map(|page| served("text/html", with_link_script(&page)))
    } else {
        streamed(&file, range.as_ref()).await
    };
    read.unwrap_or_else(|error| {
        if first_unreadable(&file) {
            let line = format!("HTML preview could not read {}: {error}", file.display());
            tauri::async_runtime::spawn_blocking(move || {
                let _ = crate::project::append_app_log(line);
            });
        }
        refusal(StatusCode::NOT_FOUND)
    })
}

fn byte_range(value: Option<&HeaderValue>, length: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = value?.to_str().ok()?.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (first, last) = spec.split_once('-')?;
    let final_byte = length.checked_sub(1);
    let (start, end) = match (first.trim(), last.trim()) {
        ("", suffix) => {
            let count: u64 = suffix.parse().ok()?;
            if count == 0 {
                return Some(Err(()));
            }
            (length.saturating_sub(count), final_byte)
        }
        (first, "") => (first.parse().ok()?, final_byte),
        (first, last) => {
            let last: u64 = last.parse().ok()?;
            (first.parse().ok()?, final_byte.map(|end| end.min(last)))
        }
    };
    match end {
        Some(end) if start <= end => Some(Ok((start, end))),
        _ => Some(Err(())),
    }
}

fn file_body(file: tokio::fs::File, length: u64) -> Body {
    use tokio::io::AsyncReadExt;
    let chunks = futures_util::stream::try_unfold(file.take(length), |mut reader| async move {
        let mut chunk = vec![0; STREAM_CHUNK];
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        chunk.truncate(read);
        Ok::<_, std::io::Error>(Some((chunk, reader)))
    });
    Body::from_stream(chunks)
}

async fn streamed(file: &Path, range: Option<&HeaderValue>) -> std::io::Result<Response> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut opened = tokio::fs::File::open(file).await?;
    let length = opened.metadata().await?.len();
    let mut head = Vec::new();
    if crate::media_type::media_type(file).is_none() {
        (&mut opened)
            .take(crate::text_search::BINARY_PROBE as u64)
            .read_to_end(&mut head)
            .await?;
    }
    let media_type = served_type(file, &head);
    let (status, start, count) = match byte_range(range, length) {
        None => (StatusCode::OK, 0, length),
        Some(Ok((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
        Some(Err(())) => {
            return Ok(page_headers(media_type)
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{length}"))
                .body(Body::empty())
                .unwrap_or_else(|_| refusal(StatusCode::INTERNAL_SERVER_ERROR)));
        }
    };
    opened.seek(std::io::SeekFrom::Start(start)).await?;
    let mut response = page_headers(media_type)
        .status(status)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, count);
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{length}", start + count - 1),
        );
    }
    Ok(response
        .body(file_body(opened, count))
        .unwrap_or_else(|_| refusal(StatusCode::INTERNAL_SERVER_ERROR)))
}

const PLAIN_TEXT: &str = "text/plain; charset=utf-8";

fn looks_like_text(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(crate::text_search::BINARY_PROBE)];
    !crate::text_search::looks_binary(head)
        && match std::str::from_utf8(head) {
            Ok(_) => true,
            Err(error) => error.error_len().is_none(),
        }
}

fn served_type(file: &Path, bytes: &[u8]) -> &'static str {
    match crate::media_type::media_type(file) {
        Some("text/markdown" | "application/x-tex" | "text/csv" | "text/plain") => PLAIN_TEXT,
        Some(known) => known,
        None if looks_like_text(bytes) => PLAIN_TEXT,
        None => "application/octet-stream",
    }
}

fn page_headers(media_type: &str) -> axum::http::response::Builder {
    Response::builder()
        .header(header::CONTENT_TYPE, media_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY)
}

fn served(media_type: &str, bytes: Vec<u8>) -> Response {
    page_headers(media_type)
        .body(Body::from(bytes))
        .unwrap_or_else(|_| refusal(StatusCode::INTERNAL_SERVER_ERROR))
}

fn start() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    tauri::async_runtime::spawn(async move {
        if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
            let _ = axum::serve(listener, axum::Router::new().fallback(serve)).await;
        }
    });
    Ok(port)
}

static PORT: Mutex<Option<u16>> = Mutex::new(None);

pub(crate) fn origin() -> Option<String> {
    let port = *PORT.lock().unwrap_or_else(PoisonError::into_inner);
    port.map(|port| format!("http://127.0.0.1:{port}"))
}

fn port() -> std::io::Result<u16> {
    let mut port = PORT.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(port) = *port {
        return Ok(port);
    }
    let started = start()?;
    *port = Some(started);
    Ok(started)
}

fn site_url<'a>(root: &Path, page: impl IntoIterator<Item = &'a str>) -> Result<String, String> {
    let failed = |detail: &dyn std::fmt::Display| {
        String::from(AppError::new("notebook.open_html_failed").detail(detail))
    };
    let port = port().map_err(|error| failed(&error))?;
    let mut url =
        tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|error| failed(&error))?;
    url.path_segments_mut()
        .map_err(|()| failed(&"no path"))?
        .push(&token_for(root.to_path_buf()))
        .extend(page);
    Ok(url.into())
}

fn preview_url(html: &Path) -> Result<String, String> {
    let missing = || String::from(AppError::new("notebook.no_html_output"));
    let root = html
        .parent()
        .and_then(|folder| folder.canonicalize().ok())
        .ok_or_else(missing)?;
    let name = html
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(missing)?;
    site_url(&root, [name])
}

fn project_page_url(project: &Path, page: &str) -> Result<String, String> {
    let refused = || String::from(AppError::new("notebook.open_html_failed").detail(page));
    let root = project.canonicalize().map_err(|_| refused())?;
    let segments: Vec<&str> = page.split('/').collect();
    file_in(&root, &segments).ok_or_else(refused)?;
    site_url(&root, segments)
}

#[tauri::command]
pub async fn compiled_html_preview_url(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        preview_url(&crate::notebook_toolchain::compiled_html(&project_id)?)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn project_html_preview_url(project_id: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_page_url(&crate::paths::project_dir(&project_id)?, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(roots: &HashMap<String, PathBuf>, path: &str) -> Option<PathBuf> {
        let (token, segments) = request_target(path)?;
        file_in(roots.get(&token)?, &segments)
    }

    fn site() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("build");
        std::fs::create_dir_all(root.join("talk_files/libs")).unwrap();
        std::fs::write(root.join("talk.html"), "<h1>Talk</h1>").unwrap();
        std::fs::write(root.join("talk_files/libs/reveal.js"), "Reveal").unwrap();
        std::fs::write(root.join("my notes.css"), "h1{}").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "secret").unwrap();
        let root = root.canonicalize().unwrap();
        (dir, root)
    }

    #[test]
    fn only_files_inside_the_registered_folder_resolve() {
        let (_dir, root) = site();
        let roots = HashMap::from([("t0k3n".to_owned(), root.clone())]);
        assert_eq!(
            resolve(&roots, "/t0k3n/talk_files/libs/reveal.js"),
            Some(root.join("talk_files/libs/reveal.js"))
        );
        assert_eq!(
            resolve(&roots, "/t0k3n/my%20notes.css"),
            Some(root.join("my notes.css"))
        );
        for refused in [
            "/other/talk.html",
            "/t0k3n/../secret.txt",
            "/t0k3n/%2e%2e/secret.txt",
            "/t0k3n/talk_files%2F..%2F..%2Fsecret.txt",
            "/t0k3n/talk_files",
            "/t0k3n/",
            "/t0k3n//talk.html",
            "t0k3n/talk.html",
            "/t0k3n/missing.html",
        ] {
            assert_eq!(resolve(&roots, refused), None, "{refused}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_refused() {
        let (dir, root) = site();
        std::os::unix::fs::symlink(dir.path().join("secret.txt"), root.join("leak.txt")).unwrap();
        let roots = HashMap::from([("t0k3n".to_owned(), root)]);
        assert_eq!(resolve(&roots, "/t0k3n/leak.txt"), None);
    }

    #[test]
    fn a_folder_keeps_one_token_and_folders_never_share_one() {
        let first = token_for(PathBuf::from("/builds/one"));
        assert_eq!(first.len(), 32);
        assert_eq!(token_for(PathBuf::from("/builds/one")), first);
        assert_ne!(token_for(PathBuf::from("/builds/two")), first);
    }

    #[test]
    fn text_is_told_apart_from_binary_even_when_cut_mid_character() {
        assert!(looks_like_text(b"plain words"));
        assert!(looks_like_text("caf\u{e9}".as_bytes()));
        let cut = "\u{e9}".repeat(4100);
        assert!(looks_like_text(&cut.as_bytes()[..8191]));
        assert!(!looks_like_text(b"PK\x03\x04\x00\x00"));
        assert!(!looks_like_text(&[0xff, 0xfe, 0x41]));
        assert!(looks_like_text(b""));
    }

    #[test]
    fn the_link_script_goes_first_in_the_head_of_every_page() {
        let served = |page: &str| String::from_utf8(with_link_script(page.as_bytes())).unwrap();
        let tag = std::str::from_utf8(LINKS_TAG).unwrap();
        assert_eq!(
            served("<!doctype html><html lang=\"en\"><HEAD><title>T</title></HEAD></html>"),
            format!("<!doctype html><html lang=\"en\"><HEAD>{tag}<title>T</title></HEAD></html>")
        );
        assert_eq!(
            served("<!-- <head> --><head\n data-x=\"1\"><meta charset=\"utf-8\">"),
            format!("<!-- <head> --><head\n data-x=\"1\">{tag}<meta charset=\"utf-8\">")
        );
        assert_eq!(
            served("<html><header>Top</header></html>"),
            format!("<html>{tag}<header>Top</header></html>")
        );
        assert_eq!(
            served("<!DOCTYPE html>\n<p>Hi</p>"),
            format!("<!DOCTYPE html>{tag}\n<p>Hi</p>")
        );
        assert_eq!(served("<p>Hi</p>"), format!("{tag}<p>Hi</p>"));
        assert_eq!(served(""), tag);
        assert_eq!(
            served("<!-- never closed <head>"),
            format!("{tag}<!-- never closed <head>")
        );
    }

    #[tokio::test]
    async fn the_page_and_its_parts_are_served_on_loopback_without_a_referrer() {
        let (_dir, root) = site();
        let url = preview_url(&root.join("talk.html")).unwrap();
        assert!(url.starts_with("http://127.0.0.1:"), "{url}");
        let origin = origin().unwrap();
        assert!(url.starts_with(&format!("{origin}/")), "{url} {origin}");
        let page = reqwest::get(&url).await.unwrap();
        assert_eq!(page.status(), 200);
        assert_eq!(page.headers()["content-type"], "text/html");
        assert_eq!(page.headers()["referrer-policy"], "no-referrer");
        assert_eq!(page.headers()["cache-control"], "no-store");
        assert_eq!(
            page.text().await.unwrap(),
            "<script src=\"/oleafly-preview-links.js\"></script><h1>Talk</h1>"
        );
        let links = reqwest::get(format!("{origin}{LINKS_PATH}")).await.unwrap();
        assert_eq!(links.status(), 200);
        assert_eq!(
            links.headers()["content-type"],
            "text/javascript; charset=utf-8"
        );
        let served = links.text().await.unwrap();
        assert_eq!(
            served,
            crate::navigation_guard::with_app_page_origin(LINKS_SCRIPT)
        );
        assert!(!served.contains("__OLEAFLY_APP_ORIGIN__"));
        let script = url.replace("talk.html", "talk_files/libs/reveal.js");
        let script = reqwest::get(&script).await.unwrap();
        assert_eq!(script.headers()["content-type"], "text/javascript");
        let escape = url.replace("talk.html", "..%2Fsecret.txt");
        assert_eq!(reqwest::get(&escape).await.unwrap().status(), 404);
        let posted = reqwest::Client::new().post(&url).send().await.unwrap();
        assert_eq!(posted.status(), 405);
    }

    #[tokio::test]
    async fn a_project_page_is_served_with_the_whole_project_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("paper");
        std::fs::create_dir_all(project.join("demos")).unwrap();
        std::fs::create_dir_all(project.join("figures")).unwrap();
        std::fs::write(
            project.join("demos/attention demo.html"),
            "<img src=\"../figures/a.png\">",
        )
        .unwrap();
        std::fs::write(project.join("figures/a.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(project.join("notes.md"), "# Notes").unwrap();
        std::fs::write(
            project.join("refs.bib"),
            "@book{knuth, title={The {\\TeX}book}}",
        )
        .unwrap();
        std::fs::write(project.join("data.bin"), [0x00, 0x9f, 0x92, 0x96]).unwrap();
        std::fs::write(dir.path().join("secret.txt"), "secret").unwrap();

        let url = project_page_url(&project, "demos/attention demo.html").unwrap();
        assert!(url.ends_with("/demos/attention%20demo.html"), "{url}");
        let page = reqwest::get(&url).await.unwrap();
        assert_eq!(page.headers()["content-type"], "text/html");
        let figure = url.replace("demos/attention%20demo.html", "figures/a.png");
        assert_eq!(reqwest::get(&figure).await.unwrap().status(), 200);
        for (name, expected) in [
            ("notes.md", "text/plain; charset=utf-8"),
            ("refs.bib", "text/plain; charset=utf-8"),
            ("data.bin", "application/octet-stream"),
        ] {
            let file = reqwest::get(url.replace("demos/attention%20demo.html", name))
                .await
                .unwrap();
            assert_eq!(file.headers()["content-type"], expected, "{name}");
        }
        let outside = url.replace("demos/attention%20demo.html", "..%2Fsecret.txt");
        assert_eq!(reqwest::get(&outside).await.unwrap().status(), 404);

        for refused in [
            "../secret.txt",
            "demos/../../secret.txt",
            "/etc/hosts",
            "demos//x.html",
            "missing.html",
            "demos",
        ] {
            assert!(project_page_url(&project, refused).is_err(), "{refused}");
        }
    }

    fn project_with_dot_folders() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("paper");
        for folder in [".git", ".oleafly/build", "web/.cache", "web/assets"] {
            std::fs::create_dir_all(project.join(folder)).unwrap();
        }
        for (name, text) in [
            ("web/index.html", "<img src=\"assets/a.png\">"),
            ("web/assets/a.png", "png"),
            (".git/config", "[remote]"),
            (".env", "KEY=secret"),
            (".oleafly/build/page.html", "<p>built</p>"),
            ("web/.cache/page.html", "<p>cached</p>"),
            ("web/.notes.html", "<p>hidden</p>"),
        ] {
            std::fs::write(project.join(name), text).unwrap();
        }
        let project = project.canonicalize().unwrap();
        (dir, project)
    }

    #[test]
    fn dot_folders_and_dot_files_never_resolve_at_any_depth() {
        let (_dir, project) = project_with_dot_folders();
        let roots = HashMap::from([("t0k3n".to_owned(), project.clone())]);
        assert_eq!(
            resolve(&roots, "/t0k3n/web/assets/a.png"),
            Some(project.join("web/assets/a.png"))
        );
        for refused in [
            "/t0k3n/.git/config",
            "/t0k3n/%2egit/config",
            "/t0k3n/%2Egit/config",
            "/t0k3n/.env",
            "/t0k3n/%2eenv",
            "/t0k3n/.oleafly/build/page.html",
            "/t0k3n/%2eoleafly/build/page.html",
            "/t0k3n/web/.cache/page.html",
            "/t0k3n/web/%2ecache/page.html",
            "/t0k3n/web/.notes.html",
            "/t0k3n/web/%2Enotes.html",
            "/t0k3n/web/assets%2F..%2F..%2F.git%2Fconfig",
        ] {
            assert_eq!(resolve(&roots, refused), None, "{refused}");
        }
        for refused in [
            ".git/config",
            ".env",
            ".oleafly/build/page.html",
            "web/.cache/page.html",
            "web/.notes.html",
        ] {
            assert!(project_page_url(&project, refused).is_err(), "{refused}");
        }
        assert!(project_page_url(&project, "web/index.html").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_into_a_dot_folder_is_refused() {
        let (_dir, project) = project_with_dot_folders();
        std::os::unix::fs::symlink(project.join(".git"), project.join("history")).unwrap();
        std::os::unix::fs::symlink(project.join(".env"), project.join("env.txt")).unwrap();
        let roots = HashMap::from([("t0k3n".to_owned(), project.clone())]);
        assert_eq!(resolve(&roots, "/t0k3n/history/config"), None);
        assert_eq!(resolve(&roots, "/t0k3n/env.txt"), None);
        assert!(project_page_url(&project, "history/config").is_err());
    }

    #[test]
    fn a_colon_is_refused_only_where_it_names_a_stream() {
        assert_eq!(servable("talk:part.html"), !cfg!(windows));
        assert!(!servable("a\\b"));
        assert!(!servable(""));
        assert!(!servable(".."));
        assert!(servable("talk.html"));
    }

    #[tokio::test]
    async fn every_served_file_carries_the_content_security_policy() {
        let (_dir, project) = project_with_dot_folders();
        std::fs::write(
            project.join("web/drawing.svg"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>fetch('https://evil.example')</script></svg>",
        )
        .unwrap();
        let url = project_page_url(&project, "web/index.html").unwrap();
        let page = reqwest::get(&url).await.unwrap();
        assert_eq!(page.status(), 200);
        assert_eq!(
            page.headers()["content-security-policy"],
            CONTENT_SECURITY_POLICY
        );
        for (name, kind) in [
            ("assets/a.png", "image/png"),
            ("drawing.svg", "image/svg+xml"),
        ] {
            let part = reqwest::get(url.replace("index.html", name)).await.unwrap();
            assert_eq!(part.status(), 200, "{name}");
            assert_eq!(part.headers()["content-type"], kind, "{name}");
            assert_eq!(
                part.headers()["content-security-policy"],
                CONTENT_SECURITY_POLICY,
                "{name}"
            );
        }
        let hidden = reqwest::get(url.replace("web/index.html", ".git/config"))
            .await
            .unwrap();
        assert_eq!(hidden.status(), 404);
        assert!(hidden.headers().get("content-security-policy").is_none());
    }

    #[test]
    fn byte_ranges_follow_the_http_rules() {
        let range = |text: &str, length: u64| {
            byte_range(Some(&HeaderValue::from_str(text).unwrap()), length)
        };
        assert_eq!(byte_range(None, 10), None);
        assert_eq!(range("bytes=0-1", 10), Some(Ok((0, 1))));
        assert_eq!(range("bytes=4-", 10), Some(Ok((4, 9))));
        assert_eq!(range("bytes=-3", 10), Some(Ok((7, 9))));
        assert_eq!(range("bytes=-30", 10), Some(Ok((0, 9))));
        assert_eq!(range("bytes=2-400", 10), Some(Ok((2, 9))));
        assert_eq!(range("bytes=10-", 10), Some(Err(())));
        assert_eq!(range("bytes=5-2", 10), Some(Err(())));
        assert_eq!(range("bytes=-0", 10), Some(Err(())));
        assert_eq!(range("bytes=0-", 0), Some(Err(())));
        assert_eq!(range("bytes=0-1,4-5", 10), None);
        assert_eq!(range("items=0-1", 10), None);
        assert_eq!(range("bytes=a-b", 10), None);
    }

    #[tokio::test]
    async fn media_is_streamed_whole_or_by_the_range_asked_for() {
        let (_dir, project) = project_with_dot_folders();
        let clip: Vec<u8> = (0..200_000u32).map(|index| (index % 251) as u8).collect();
        std::fs::write(project.join("web/assets/clip.mp4"), &clip).unwrap();
        let url = project_page_url(&project, "web/index.html")
            .unwrap()
            .replace("index.html", "assets/clip.mp4");
        let client = reqwest::Client::new();

        let whole = client.get(&url).send().await.unwrap();
        assert_eq!(whole.status(), 200);
        assert_eq!(whole.headers()["accept-ranges"], "bytes");
        assert_eq!(whole.headers()["content-length"], "200000");
        assert_eq!(whole.bytes().await.unwrap().as_ref(), clip.as_slice());

        let part = client
            .get(&url)
            .header("Range", "bytes=70000-70009")
            .send()
            .await
            .unwrap();
        assert_eq!(part.status(), 206);
        assert_eq!(part.headers()["content-range"], "bytes 70000-70009/200000");
        assert_eq!(
            part.headers()["content-security-policy"],
            CONTENT_SECURITY_POLICY
        );
        assert_eq!(part.bytes().await.unwrap().as_ref(), &clip[70000..70010]);

        let tail = client
            .get(&url)
            .header("Range", "bytes=-4")
            .send()
            .await
            .unwrap();
        assert_eq!(tail.status(), 206);
        assert_eq!(tail.bytes().await.unwrap().as_ref(), &clip[199_996..]);

        let past = client
            .get(&url)
            .header("Range", "bytes=300000-")
            .send()
            .await
            .unwrap();
        assert_eq!(past.status(), 416);
        assert_eq!(past.headers()["content-range"], "bytes */200000");
    }

    #[test]
    fn the_policy_keeps_the_page_on_its_own_origin() {
        let directives: HashMap<&str, Vec<&str>> = CONTENT_SECURITY_POLICY
            .split(';')
            .filter_map(|directive| {
                let mut words = directive.split_whitespace();
                Some((words.next()?, words.collect()))
            })
            .collect();
        for fetching in [
            "default-src",
            "script-src",
            "style-src",
            "img-src",
            "font-src",
            "media-src",
            "connect-src",
            "frame-src",
            "worker-src",
            "form-action",
            "base-uri",
        ] {
            let sources = &directives[fetching];
            assert!(sources.contains(&"'self'"), "{fetching}");
            assert!(
                sources.iter().all(|source| {
                    matches!(
                        *source,
                        "'self'" | "'unsafe-inline'" | "'unsafe-eval'" | "data:" | "blob:"
                    )
                }),
                "{fetching}: {sources:?}"
            );
        }
        assert_eq!(directives["object-src"], ["'none'"]);
        assert!(!directives["frame-src"].contains(&"data:"));
    }
}
