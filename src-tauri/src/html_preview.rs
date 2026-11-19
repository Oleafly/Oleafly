use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, Method, StatusCode};
use axum::response::Response;
use percent_encoding::percent_decode_str;

use crate::app_error::AppError;

const LINKS_PATH: &str = "/oleafly-preview-links.js";
const LINKS_SCRIPT: &str = include_str!("html_preview_links.js");
const LINKS_TAG: &[u8] = b"<script src=\"/oleafly-preview-links.js\"></script>";

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

fn resolve(roots: &HashMap<String, PathBuf>, path: &str) -> Option<PathBuf> {
    let mut segments = path.strip_prefix('/')?.split('/');
    let root = roots.get(segments.next()?)?;
    let mut file = root.clone();
    for segment in segments {
        let segment = percent_decode_str(segment).decode_utf8().ok()?;
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains(['/', '\\', ':', '\0'])
        {
            return None;
        }
        file.push(segment.as_ref());
    }
    let file = file.canonicalize().ok()?;
    (file.starts_with(root) && file.is_file()).then_some(file)
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
    let found = {
        let roots = roots().lock().unwrap_or_else(PoisonError::into_inner);
        resolve(&roots, request.uri().path())
    };
    let Some(file) = found else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let Ok(bytes) = tokio::fs::read(&file).await else {
        return refusal(StatusCode::NOT_FOUND);
    };
    let media_type = served_type(&file, &bytes);
    let bytes = if media_type == "text/html" {
        with_link_script(&bytes)
    } else {
        bytes
    };
    served(media_type, bytes)
}

const PLAIN_TEXT: &str = "text/plain; charset=utf-8";

fn looks_like_text(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    !head.contains(&0)
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

fn served(media_type: &str, bytes: Vec<u8>) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, media_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
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
    let segments: Vec<&str> = page.split('/').collect();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.contains(['\\', ':', '\0'])
    }) {
        return Err(refused());
    }
    let root = project.canonicalize().map_err(|_| refused())?;
    let file = root.join(page).canonicalize().map_err(|_| refused())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err(refused());
    }
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
}
