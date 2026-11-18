use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::{ACCEPT, SET_COOKIE};
use reqwest::StatusCode;

use crate::client::{self, Http};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::html;
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
    loads: AtomicUsize,
    websocket_failures: AtomicUsize,
}

fn number(tags: &std::collections::HashMap<String, String>, name: &str) -> Option<u64> {
    html::meta_text(tags, name).and_then(|text| text.trim().parse().ok())
}

fn read_meta(http: &Http, page: &str, fallback: bool) -> Meta {
    let tags = html::meta_tags(page);
    let ws_url = html::meta_text(&tags, "ol-wsUrl")
        .filter(|_| !fallback)
        .and_then(|raw| {
            let base = url::Url::parse(&format!("{}/", http.base)).ok()?;
            base.join(raw.trim()).ok().map(String::from)
        });
    Meta {
        ws_url,
        csrf: html::meta_text(&tags, "ol-csrfToken"),
        max_doc_length: number(&tags, "ol-maxDocLength"),
        max_reconnect_gracefully: number(&tags, "ol-maxReconnectGracefullyIntervalMs")
            .map(Duration::from_millis),
        user_id: html::meta_text(&tags, "ol-user_id"),
        fallback,
    }
}

fn lock(meta: &Mutex<Meta>) -> std::sync::MutexGuard<'_, Meta> {
    meta.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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
        self.loads.fetch_add(1, Ordering::Relaxed);
        let response = http
            .send_public(
                http.get(&path, &session.cookie())
                    .header(ACCEPT, "text/html"),
            )
            .await?;
        let set_cookies: Vec<String> = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok().map(str::to_string))
            .collect();
        session.absorb(set_cookies.iter().map(String::as_str));
        match response.status() {
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
                return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
            }
            StatusCode::UNAUTHORIZED => return Err(client::expired()),
            _ => http.classify(&response)?,
        }
        let body = response
            .text()
            .await
            .map_err(|error| OnlineError::new(OnlineErrorKind::Unreachable).detail(error))?;
        let meta = read_meta(http, &body, fallback);
        if meta.user_id.is_none() {
            return Err(client::expired());
        }
        *lock(&self.meta) = meta;
        Ok(())
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn ws_url(&self) -> Option<String> {
        lock(&self.meta).ws_url.clone()
    }

    pub fn is_fallback(&self) -> bool {
        lock(&self.meta).fallback
    }

    pub fn csrf(&self) -> Option<String> {
        lock(&self.meta).csrf.clone()
    }

    pub fn max_doc_length(&self) -> Option<u64> {
        lock(&self.meta).max_doc_length
    }

    pub fn max_reconnect_gracefully(&self) -> Option<Duration> {
        lock(&self.meta).max_reconnect_gracefully
    }

    pub fn user_id(&self) -> Option<String> {
        lock(&self.meta).user_id.clone()
    }

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
