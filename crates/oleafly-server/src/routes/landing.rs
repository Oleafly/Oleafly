use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::ids::SharedProjectId;
use url::Url;

use crate::routes::path_id;
use crate::state::AppState;

pub const DOWNLOAD_URL: &str = "https://oleafly.com/download";

pub fn router() -> Router<AppState> {
    Router::new().route("/p/{project}", get(landing))
}

pub fn open_link(public_url: &Url, project: SharedProjectId) -> String {
    let mut link = Url::parse("oleafly://open").expect("a fixed URL parses");
    link.query_pairs_mut()
        .append_pair("server", public_url.as_str().trim_end_matches('/'))
        .append_pair("project", &project.to_string());
    link.to_string()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn landing(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
) -> Response {
    let Ok(project) = path_id::<SharedProjectId>(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let open = escape(&open_link(&state.config.public_url, project));
    let server = escape(&state.config.server_name);
    let page = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Oleafly</title>\
<style>body{{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2933;background:#fff}}a{{display:inline-block;margin:0.5rem 0.5rem 0 0;padding:0.6rem 1rem;border-radius:0.5rem;border:1px solid #c5ccd3;color:inherit;text-decoration:none}}a.primary{{background:#1f2933;color:#fff;border-color:#1f2933}}p{{line-height:1.5}}</style></head>\
<body><h1>A shared Oleafly project</h1><p>Someone on {server} shared a project with this link. Open it in Oleafly to see it. You need to be added by its owner, or the owner needs to turn on link sharing.</p>\
<a class=\"primary\" href=\"{open}\">Open in Oleafly</a><a href=\"{DOWNLOAD_URL}\">Get Oleafly</a></body></html>"
    );
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        page,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_open_link_names_the_server_and_project() {
        let project: SharedProjectId = "01920000-0000-7000-8000-0000000000aa".parse().unwrap();
        let link = open_link(
            &Url::parse("https://www.cs.uni.edu/oleafly/").unwrap(),
            project,
        );
        assert_eq!(
            link,
            "oleafly://open?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly&project=01920000-0000-7000-8000-0000000000aa"
        );
        assert_eq!(escape("<a & \"b\">"), "&lt;a &amp; &quot;b&quot;&gt;");
    }
}
