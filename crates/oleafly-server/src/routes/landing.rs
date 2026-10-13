use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::page::{document, status, Tone};
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

pub fn comment_link(
    public_url: &Url,
    project: SharedProjectId,
    file_id: &str,
    thread_id: &str,
) -> String {
    let mut link = Url::parse(&open_link(public_url, project)).expect("an open link parses");
    link.query_pairs_mut()
        .append_pair("file", file_id)
        .append_pair("thread", thread_id);
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
    let page = document(
        "A shared Oleafly project",
        &format!(
            "{}<h1>A shared Oleafly project</h1><p>Someone on {server} shared a project with this link. Open it in Oleafly to see it.</p><p class=\"next\">You need to be added by its owner, or the owner needs to turn on link sharing.</p><div class=\"actions\"><a class=\"button primary\" href=\"{open}\">Open in Oleafly</a><a class=\"button\" href=\"{DOWNLOAD_URL}\">Get Oleafly</a></div>",
            status(Tone::Info)
        ),
        Some(&state.config.server_name),
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

    #[test]
    fn a_comment_link_also_names_the_file_and_thread() {
        let project: SharedProjectId = "01920000-0000-7000-8000-0000000000aa".parse().unwrap();
        let link = comment_link(
            &Url::parse("https://www.cs.uni.edu/oleafly/").unwrap(),
            project,
            "01920000-0000-7000-8000-0000000000f1",
            "01920000-0000-7000-8000-0000000000c1",
        );
        assert_eq!(
            link,
            "oleafly://open?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly&project=01920000-0000-7000-8000-0000000000aa&file=01920000-0000-7000-8000-0000000000f1&thread=01920000-0000-7000-8000-0000000000c1"
        );
    }
}
