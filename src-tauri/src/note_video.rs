use std::net::Ipv4Addr;
use std::sync::LazyLock;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, Method, StatusCode};
use axum::response::Response;
use axum::Router;
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use tokio::sync::OnceCell;

pub(crate) const PLAYERS: [(&str, &str); 2] = [
    ("https://www.youtube-nocookie.com", "/embed/"),
    ("https://player.vimeo.com", "/video/"),
];
const PAGE_PATH: &str = "/video";
const SCRIPT: &str = include_str!("note_video_page.js");
const MISSING_POLICY: &str = "default-src 'none'; base-uri 'none'; form-action 'none'";

struct Page {
    html: String,
    policy: String,
}

fn page(script: &str) -> Page {
    let script = script.replace("\r\n", "\n").replace('\r', "\n");
    let hash = STANDARD.encode(Sha256::digest(script.as_bytes()));
    let frames = PLAYERS.map(|(origin, _)| origin).join(" ");
    Page {
        html: format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body><script>{script}</script></body></html>"
        ),
        policy: format!(
            "default-src 'none'; script-src 'sha256-{hash}'; frame-src {frames}; base-uri 'none'; form-action 'none'"
        ),
    }
}

static PAGE: LazyLock<Page> = LazyLock::new(|| page(SCRIPT));

static ORIGIN: OnceCell<String> = OnceCell::const_new();

pub(crate) fn origin() -> Option<&'static str> {
    ORIGIN.get().map(String::as_str)
}

fn reply(status: StatusCode, content_type: &str, policy: &str, body: Body) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, policy)
        .header(header::REFERRER_POLICY, "strict-origin-when-cross-origin")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_default()
}

fn respond(method: &Method, path: &str) -> Response {
    if method == Method::GET && path == PAGE_PATH {
        let page: &'static Page = &PAGE;
        return reply(
            StatusCode::OK,
            "text/html; charset=utf-8",
            &page.policy,
            Body::from(page.html.as_str()),
        );
    }
    reply(
        StatusCode::NOT_FOUND,
        "text/plain; charset=utf-8",
        MISSING_POLICY,
        Body::from("Not found"),
    )
}

async fn handle(request: Request) -> Response {
    respond(request.method(), request.uri().path())
}

fn router() -> Router {
    Router::new().fallback(handle)
}

async fn serve(listener: std::net::TcpListener) {
    let outcome = match tokio::net::TcpListener::from_std(listener) {
        Ok(listener) => axum::serve(listener, router()).await,
        Err(error) => Err(error),
    };
    if let Err(error) = outcome {
        let line = format!("The video page server for notes stopped: {error}");
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::project::append_app_log(line);
        });
    }
}

async fn start() -> Result<String, String> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("could not start the video page server: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("could not start the video page server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("could not start the video page server: {error}"))?
        .port();
    tauri::async_runtime::spawn(serve(listener));
    Ok(format!("http://{}:{port}", Ipv4Addr::LOCALHOST))
}

#[tauri::command]
pub async fn note_video_frame_origin() -> Result<String, String> {
    ORIGIN.get_or_try_init(start).await.cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    fn header_of(response: &reqwest::Response, name: header::HeaderName) -> &str {
        response.headers().get(name).unwrap().to_str().unwrap()
    }

    #[test]
    fn the_page_runs_only_its_own_script_and_frames_only_the_two_players() {
        let page = &*PAGE;
        let hash = STANDARD.encode(Sha256::digest(SCRIPT.as_bytes()));
        assert!(page
            .html
            .contains(&format!("<script>{SCRIPT}</script></body>")));
        assert_eq!(page.html.matches("<script").count(), 1);
        assert_eq!(
            page.policy,
            format!("default-src 'none'; script-src 'sha256-{hash}'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; base-uri 'none'; form-action 'none'")
        );
        assert!(!page.policy.contains("unsafe"));
        for (origin, path) in PLAYERS {
            assert!(SCRIPT.contains(&format!("`{origin}{path}")), "{origin}");
        }
        assert!(!SCRIPT.contains("</script"));
    }

    #[test]
    fn a_crlf_checkout_serves_and_hashes_the_script_the_browser_hashes() {
        let served = page("go();\r\nstop();\rdone();\r\n");
        let hash = STANDARD.encode(Sha256::digest(b"go();\nstop();\ndone();\n"));
        assert!(!served.html.contains('\r'));
        assert!(served
            .html
            .contains("<script>go();\nstop();\ndone();\n</script>"));
        assert!(served.policy.contains(&format!("'sha256-{hash}'")));
    }

    #[test]
    fn only_get_of_the_video_path_is_served() {
        assert_eq!(respond(&Method::GET, "/video").status(), StatusCode::OK);
        for (method, path) in [
            (Method::GET, "/"),
            (Method::GET, "/video/"),
            (Method::GET, "/video.html"),
            (Method::GET, "/videos"),
            (Method::HEAD, "/video"),
            (Method::POST, "/video"),
            (Method::PUT, "/video"),
        ] {
            assert_eq!(
                respond(&method, path).status(),
                StatusCode::NOT_FOUND,
                "{method} {path}"
            );
        }
    }

    #[tokio::test]
    async fn the_server_starts_once_on_loopback_and_serves_the_page_with_its_headers() {
        let first = note_video_frame_origin().await.unwrap();
        let second = note_video_frame_origin().await.unwrap();
        assert_eq!(first, second);
        assert_eq!(origin(), Some(first.as_str()));
        let port = first
            .strip_prefix("http://127.0.0.1:")
            .unwrap()
            .parse::<u16>()
            .unwrap();
        assert_ne!(port, 0);

        let page = client()
            .get(format!("{first}/video#youtube/dQw4w9WgXcQ?start=5"))
            .send()
            .await
            .unwrap();
        assert_eq!(page.status(), reqwest::StatusCode::OK);
        assert_eq!(
            header_of(&page, header::CONTENT_TYPE),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            header_of(&page, header::CONTENT_SECURITY_POLICY),
            PAGE.policy
        );
        assert_eq!(
            header_of(&page, header::REFERRER_POLICY),
            "strict-origin-when-cross-origin"
        );
        assert_eq!(header_of(&page, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
        assert_eq!(header_of(&page, header::CACHE_CONTROL), "no-store");
        assert_eq!(page.text().await.unwrap(), PAGE.html);

        let missing = client()
            .post(format!("{first}/video"))
            .send()
            .await
            .unwrap();
        assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
        assert_eq!(
            header_of(&missing, header::CONTENT_SECURITY_POLICY),
            MISSING_POLICY
        );
        let other = client().get(format!("{first}/")).send().await.unwrap();
        assert_eq!(other.status(), reqwest::StatusCode::NOT_FOUND);
    }
}
