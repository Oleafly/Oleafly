use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::page::{document_in, status, Tone};
use url::Url;

use crate::i18n::{Key, PageLocale};
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

pub fn browser_link(public_url: &Url, project: SharedProjectId) -> String {
    let mut link = public_url.clone();
    let base = public_url.path().trim_end_matches('/').to_string();
    link.set_path(&format!("{base}/web/"));
    link.set_fragment(None);
    link.query_pairs_mut()
        .clear()
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
    PageLocale(locale): PageLocale,
    path: Result<Path<String>, PathRejection>,
) -> Response {
    let Ok(project) = path_id::<SharedProjectId>(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let open = escape(&open_link(&state.config.public_url, project));
    let server = escape(&state.config.server_name);
    let title = locale.text(Key::LandingTitle);
    let browser = if state.config.web_enabled() {
        format!(
            "<a class=\"button\" href=\"{}\">{}</a>",
            escape(&browser_link(&state.config.public_url, project)),
            escape(locale.text(Key::LandingOpenBrowser)),
        )
    } else {
        String::new()
    };
    let page = document_in(
        locale.tag(),
        title,
        &format!(
            "{}<h1>{}</h1><p>{}</p><p class=\"next\">{}</p><div class=\"actions\"><a class=\"button primary\" href=\"{open}\">{}</a>{browser}<a class=\"button\" href=\"{DOWNLOAD_URL}\">{}</a></div>",
            status(Tone::Info),
            escape(title),
            locale.fill_html(Key::LandingBody, &[("server", &server)]),
            escape(locale.text(Key::LandingNext)),
            escape(locale.text(Key::LandingOpen)),
            escape(locale.text(Key::LandingGet)),
        ),
        Some(&state.config.server_name),
    );
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (header::VARY, HeaderValue::from_static("accept-language")),
        ],
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
    fn the_browser_link_opens_the_project_in_the_web_app_under_any_path() {
        let project: SharedProjectId = "01920000-0000-7000-8000-0000000000aa".parse().unwrap();
        assert_eq!(
            browser_link(&Url::parse("https://collab.example.edu/").unwrap(), project),
            "https://collab.example.edu/web/?project=01920000-0000-7000-8000-0000000000aa"
        );
        assert_eq!(
            browser_link(
                &Url::parse("https://www.cs.uni.edu/oleafly/").unwrap(),
                project
            ),
            "https://www.cs.uni.edu/oleafly/web/?project=01920000-0000-7000-8000-0000000000aa"
        );
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
