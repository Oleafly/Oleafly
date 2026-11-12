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

fn refusal(status: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
}

async fn serve(request: Request) -> Response {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return refusal(StatusCode::METHOD_NOT_ALLOWED);
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
    let media_type = crate::media_type::media_type(&file).unwrap_or("application/octet-stream");
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

fn port() -> std::io::Result<u16> {
    static PORT: Mutex<Option<u16>> = Mutex::new(None);
    let mut port = PORT.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(port) = *port {
        return Ok(port);
    }
    let started = start()?;
    *port = Some(started);
    Ok(started)
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
    let port = port()
        .map_err(|error| String::from(AppError::new("notebook.open_html_failed").detail(error)))?;
    let mut url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|_| missing())?;
    url.path_segments_mut()
        .map_err(|()| missing())?
        .extend([token_for(root).as_str(), name]);
    Ok(url.into())
}

#[tauri::command]
pub async fn compiled_html_preview_url(project_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        preview_url(&crate::notebook_toolchain::compiled_html(&project_id)?)
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

    #[tokio::test]
    async fn the_page_and_its_parts_are_served_on_loopback_without_a_referrer() {
        let (_dir, root) = site();
        let url = preview_url(&root.join("talk.html")).unwrap();
        assert!(url.starts_with("http://127.0.0.1:"), "{url}");
        let page = reqwest::get(&url).await.unwrap();
        assert_eq!(page.status(), 200);
        assert_eq!(page.headers()["content-type"], "text/html");
        assert_eq!(page.headers()["referrer-policy"], "no-referrer");
        assert_eq!(page.headers()["cache-control"], "no-store");
        assert_eq!(page.text().await.unwrap(), "<h1>Talk</h1>");
        let script = url.replace("talk.html", "talk_files/libs/reveal.js");
        let script = reqwest::get(&script).await.unwrap();
        assert_eq!(script.headers()["content-type"], "text/javascript");
        let escape = url.replace("talk.html", "..%2Fsecret.txt");
        assert_eq!(reqwest::get(&escape).await.unwrap().status(), 404);
        let posted = reqwest::Client::new().post(&url).send().await.unwrap();
        assert_eq!(posted.status(), 405);
    }
}
