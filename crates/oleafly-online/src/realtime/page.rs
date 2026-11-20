use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use oleafly_net::MAX_MESSAGE_BYTES;
use reqwest::header::ACCEPT;
use reqwest::StatusCode;
use url::Url;

use super::events::LONGEST_SERVER_WAIT;
use crate::client::{self, BodyError, Http};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::html;
use crate::locked;
use crate::session::SessionHandle;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Meta {
    ws_url: Option<String>,
    csrf: Option<String>,
    max_doc_length: Option<u64>,
    max_reconnect_gracefully: Option<Duration>,
    user_id: Option<String>,
    fallback: bool,
}

#[derive(Debug)]
pub struct ProjectPage {
    project_id: String,
    meta: Mutex<Meta>,
    #[cfg(test)]
    loads: AtomicUsize,
    websocket_failures: AtomicUsize,
}

fn number(tags: &std::collections::HashMap<String, String>, name: &str) -> Option<u64> {
    html::meta_text(tags, name).and_then(|text| text.trim().parse().ok())
}

fn same_site(base: &Url, target: &Url) -> bool {
    let (Some(home), Some(host)) = (base.host_str(), target.host_str()) else {
        return false;
    };
    let home = home.to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    let site = home.strip_prefix("www.").unwrap_or(&home);
    target.scheme() == base.scheme()
        && (host == home || host == site || host.ends_with(&format!(".{site}")))
}

fn read_meta(http: &Http, page: &str, fallback: bool) -> Meta {
    let tags = html::meta_tags(page);
    let ws_url = html::meta_text(&tags, "ol-wsUrl")
        .filter(|_| !fallback)
        .and_then(|raw| {
            let base = Url::parse(&format!("{}/", http.base)).ok()?;
            let target = base.join(raw.trim()).ok()?;
            same_site(&base, &target).then(|| String::from(target))
        });
    Meta {
        ws_url,
        csrf: html::meta_text(&tags, "ol-csrfToken"),
        max_doc_length: number(&tags, "ol-maxDocLength"),
        max_reconnect_gracefully: number(&tags, "ol-maxReconnectGracefullyIntervalMs")
            .map(|wait| Duration::from_millis(wait).min(LONGEST_SERVER_WAIT)),
        user_id: html::meta_text(&tags, "ol-user_id"),
        fallback,
    }
}

impl ProjectPage {
    pub async fn load(
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
        fallback: bool,
    ) -> Result<ProjectPage, OnlineError> {
        let page = ProjectPage::unloaded(project_id)?;
        page.reload(http, session, fallback).await?;
        Ok(page)
    }

    pub fn unloaded(project_id: &str) -> Result<ProjectPage, OnlineError> {
        if !client::valid_project_id(project_id) {
            return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
        }
        Ok(ProjectPage {
            project_id: project_id.to_string(),
            meta: Mutex::new(Meta::default()),
            #[cfg(test)]
            loads: AtomicUsize::new(0),
            websocket_failures: AtomicUsize::new(0),
        })
    }

    pub async fn reload(
        &self,
        http: &Http,
        session: &SessionHandle,
        fallback: bool,
    ) -> Result<(), OnlineError> {
        let path = if fallback {
            format!("/project/{}?ws=fallback", self.project_id)
        } else {
            format!("/project/{}", self.project_id)
        };
        #[cfg(test)]
        self.loads.fetch_add(1, Ordering::Relaxed);
        let response = http
            .send_public(
                http.get(&path, &session.cookie())
                    .header(ACCEPT, "text/html"),
            )
            .await?;
        session.absorb_headers(response.headers());
        match response.status() {
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
                return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
            }
            StatusCode::UNAUTHORIZED => return Err(client::expired()),
            _ => http.classify(&response)?,
        }
        let body = client::text_capped(response, MAX_MESSAGE_BYTES)
            .await
            .map_err(|error| {
                let kind = match error {
                    BodyError::TooLarge(_) => OnlineErrorKind::Unrecognized,
                    BodyError::Read(_) => OnlineErrorKind::Unreachable,
                };
                OnlineError::new(kind).detail(error)
            })?;
        let meta = read_meta(http, &body, fallback);
        if meta.user_id.is_none() {
            return Err(client::expired());
        }
        *locked(&self.meta) = meta;
        Ok(())
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn ws_url(&self) -> Option<String> {
        locked(&self.meta).ws_url.clone()
    }

    pub fn is_fallback(&self) -> bool {
        locked(&self.meta).fallback
    }

    pub fn csrf(&self) -> Option<String> {
        locked(&self.meta).csrf.clone()
    }

    pub fn max_doc_length(&self) -> Option<u64> {
        locked(&self.meta).max_doc_length
    }

    pub fn max_reconnect_gracefully(&self) -> Option<Duration> {
        locked(&self.meta).max_reconnect_gracefully
    }

    pub fn user_id(&self) -> Option<String> {
        locked(&self.meta).user_id.clone()
    }

    #[cfg(test)]
    pub fn loads(&self) -> usize {
        self.loads.load(Ordering::Relaxed)
    }

    pub(crate) fn websocket_failures(&self) -> usize {
        self.websocket_failures.load(Ordering::Relaxed)
    }

    pub(crate) fn note_websocket_failure(&self) {
        self.websocket_failures.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn give_up_websockets(&self) {
        self.websocket_failures
            .store(u32::MAX as usize, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Session;
    use crate::test_support::streaming_server;

    fn page(name: &str, content: &str) -> String {
        format!("<meta name=\"{name}\" content=\"{content}\">")
    }

    #[test]
    fn an_absolute_socket_address_must_stay_on_the_service() {
        let http = Http::new("https://www.latex.example", "Oleafly/test").unwrap();
        let socket = |raw: &str| read_meta(&http, &page("ol-wsUrl", raw), false).ws_url;
        for (raw, expected) in [
            ("/socket.io", "https://www.latex.example/socket.io"),
            (
                "https://www.latex.example/rt/socket.io",
                "https://www.latex.example/rt/socket.io",
            ),
            (
                "https://rt.latex.example/socket.io",
                "https://rt.latex.example/socket.io",
            ),
            (
                "https://latex.example/socket.io",
                "https://latex.example/socket.io",
            ),
        ] {
            assert_eq!(socket(raw).as_deref(), Some(expected), "{raw}");
        }
        for refused in [
            "http://www.latex.example/socket.io",
            "wss://www.latex.example/socket.io",
            "https://elsewhere.example/socket.io",
            "https://latex.example.elsewhere.example/socket.io",
            "https://notlatex.example/socket.io",
            "//elsewhere.example/socket.io",
        ] {
            assert_eq!(socket(refused), None, "{refused}");
        }
        let hosted = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let socket = |raw: &str| read_meta(&hosted, &page("ol-wsUrl", raw), false).ws_url;
        assert!(socket("https://rt.latex.uni.edu/socket.io").is_some());
        assert_eq!(socket("https://uni.edu/socket.io"), None);
        assert_eq!(socket("https://other.uni.edu/socket.io"), None);
    }

    #[test]
    fn the_reconnect_window_from_the_page_is_capped() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let huge = u64::MAX.to_string();
        for (raw, expected) in [
            ("100000000000000000000", None),
            ("1000000000000", Some(LONGEST_SERVER_WAIT)),
            (huge.as_str(), Some(LONGEST_SERVER_WAIT)),
            ("0", Some(Duration::ZERO)),
            ("30000", Some(Duration::from_secs(30))),
        ] {
            let meta = read_meta(
                &http,
                &page("ol-maxReconnectGracefullyIntervalMs", raw),
                false,
            );
            assert_eq!(meta.max_reconnect_gracefully, expected, "{raw}");
        }
    }

    #[tokio::test]
    async fn an_editor_page_that_never_ends_is_refused() {
        let base = streaming_server(None, None, Duration::ZERO).await;
        let http = Http::new(&base, "Oleafly/test").unwrap();
        let session = SessionHandle::new(
            &base,
            Session {
                cookie: "overleaf.sid=s".into(),
                user_id: "u1".into(),
                email: String::new(),
                saved_by: None,
            },
            None,
        );
        let error = ProjectPage::load(&http, &session, "p1", false)
            .await
            .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::Unrecognized);
        assert!(
            error
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("larger than"),
            "{error:?}"
        );
    }
}
