//! HTTP calls to the online LaTeX service: the dashboard, the project API,
//! template copies and project downloads. Redirects are never followed.
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, ACCEPT, CONTENT_TYPE, COOKIE, LOCATION, ORIGIN, SET_COOKIE};
use reqwest::{Response, StatusCode};
use serde_json::Value;
use tokio::io::AsyncWriteExt;

use crate::error::{OnlineError, OnlineErrorKind};
use crate::html;
use crate::session;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
pub const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
const API_PAGE_SIZE: u64 = 1_000;

pub struct Dashboard {
    pub user_id: String,
    pub email: String,
    pub csrf: Option<String>,
    pub projects: Option<Vec<Value>>,
    pub total: Option<u64>,
    pub set_cookies: Vec<String>,
}

impl std::fmt::Debug for Dashboard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dashboard")
            .field("user_id", &self.user_id)
            .field("email", &self.email)
            .field("csrf", &self.csrf.as_ref().map(|_| "[redacted]"))
            .field("projects", &self.projects.as_ref().map(Vec::len))
            .field("total", &self.total)
            .field("set_cookies", &"[redacted]")
            .finish()
    }
}

#[derive(Clone)]
pub struct Http {
    client: reqwest::Client,
    pub base: String,
    pub origin: String,
}

fn build_client(user_agent: &str) -> Result<reqwest::Client, OnlineError> {
    let builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::none());
    #[cfg(any(test, feature = "test-support"))]
    let builder = builder.no_proxy();
    builder
        .build()
        .map_err(|error| OnlineError::io(format!("could not start the connection: {error}")))
}

/// One client per process, built on first use with the caller's agent.
fn shared_client(user_agent: &str) -> Result<reqwest::Client, OnlineError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = build_client(user_agent)?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

pub(crate) fn expired() -> OnlineError {
    OnlineError::new(OnlineErrorKind::SessionExpired)
}

fn unreachable(base: &str, detail: impl ToString) -> OnlineError {
    OnlineError::new(OnlineErrorKind::Unreachable)
        .param("server", base)
        .detail(detail)
}

fn set_cookie_lines(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_string))
        .collect()
}

impl Http {
    pub fn new(base: &str, user_agent: &str) -> Result<Self, OnlineError> {
        Ok(Self {
            client: shared_client(user_agent)?,
            base: base.to_string(),
            origin: session::origin_of(base),
        })
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    pub fn get(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .get(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    /// A request for a public page, sent without the account's cookie.
    pub fn public_get(&self, path: &str) -> reqwest::RequestBuilder {
        self.client.get(self.url(path))
    }

    pub async fn send_public(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<Response, OnlineError> {
        self.send(request).await
    }

    pub fn post(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .post(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Response, OnlineError> {
        request
            .send()
            .await
            .map_err(|error| unreachable(&self.base, error))
    }

    /// Whether `location` is this service's own login page, which is what a
    /// signed-out request is sent to. A redirect anywhere else (another host,
    /// a maintenance or challenge page) says nothing about the sign-in.
    fn is_login_redirect(&self, location: &str) -> bool {
        let Ok(base) = url::Url::parse(&format!("{}/", self.base)) else {
            return false;
        };
        let Ok(target) = base.join(location) else {
            return false;
        };
        target.origin() == base.origin() && target.path().trim_end_matches('/').ends_with("/login")
    }

    fn classify(&self, response: &Response) -> Result<(), OnlineError> {
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if self.is_login_redirect(location) {
                return Err(expired());
            }
            return Err(unreachable(&self.base, format!("redirected to {location}")));
        }
        match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(expired()),
            StatusCode::TOO_MANY_REQUESTS => Err(OnlineError::new(OnlineErrorKind::RateLimited)),
            status if status.is_success() => Ok(()),
            status => Err(unreachable(&self.base, format!("HTTP {}", status.as_u16()))),
        }
    }

    pub async fn dashboard(&self, cookie: &str) -> Result<Dashboard, OnlineError> {
        let response = self
            .send(self.get("/project", cookie).header(ACCEPT, "text/html"))
            .await?;
        // The service sends a signed-out visitor to its login page. A refusal
        // or a page without the account's id comes from something in front of
        // it (a firewall challenge, a maintenance page) and says nothing about
        // the sign-in, which must not be forgotten for it.
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            return Err(unreachable(
                &self.base,
                format!("HTTP {}", response.status().as_u16()),
            ));
        }
        self.classify(&response)?;
        let set_cookies = set_cookie_lines(response.headers());
        let page = response
            .text()
            .await
            .map_err(|error| unreachable(&self.base, error))?;
        let mut dashboard = parse_dashboard(&page).map_err(|error| {
            if error.kind == OnlineErrorKind::SessionExpired {
                OnlineError::new(OnlineErrorKind::SignInFailed)
            } else {
                error
            }
        })?;
        dashboard.set_cookies = set_cookies;
        Ok(dashboard)
    }

    pub async fn api_projects(
        &self,
        cookie: &str,
        csrf: &str,
        size: u64,
    ) -> Result<Vec<Value>, OnlineError> {
        let body = serde_json::json!({
            "filters": {},
            "page": { "size": size.clamp(1, 10 * API_PAGE_SIZE) },
            "sort": { "by": "lastUpdated", "order": "desc" },
        });
        let response = self
            .send(
                self.post("/api/project", cookie)
                    .header("X-Csrf-Token", csrf)
                    .header(ACCEPT, "application/json")
                    .header(CONTENT_TYPE, "application/json")
                    .body(body.to_string()),
            )
            .await?;
        self.classify(&response)?;
        let value: Value = response
            .json()
            .await
            .map_err(|error| unreachable(&self.base, error))?;
        value
            .get("projects")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| OnlineError::new(OnlineErrorKind::Unrecognized))
    }

    /// Ask the server to copy a gallery template into the account, as its
    /// Open as Template button does, and return the new project's id.
    pub async fn create_from_template(
        &self,
        cookie: &str,
        csrf: &str,
        body: &Value,
    ) -> Result<String, OnlineError> {
        let response = self
            .send(
                self.post("/project/new/template", cookie)
                    .header("X-Csrf-Token", csrf)
                    .header(ACCEPT, "text/html")
                    .header(CONTENT_TYPE, "application/json")
                    .body(body.to_string()),
            )
            .await?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if let Some(id) = project_id_in(location) {
                return Ok(id);
            }
        }
        match status {
            StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                Err(OnlineError::new(OnlineErrorKind::TemplateUnavailable))
            }
            _ => {
                self.classify(&response)?;
                Err(OnlineError::new(OnlineErrorKind::TemplateUnavailable))
            }
        }
    }

    pub async fn download_zip(
        &self,
        cookie: &str,
        project_id: &str,
        destination: &Path,
        mut progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, OnlineError> {
        if !valid_project_id(project_id) {
            return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
        }
        let path = format!("/project/{project_id}/download/zip");
        let response = self.send(self.get(&path, cookie)).await?;
        match response.status() {
            StatusCode::NOT_FOUND => {
                return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
            }
            StatusCode::FORBIDDEN if response.headers().get(LOCATION).is_none() => {
                return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
            }
            _ => self.classify(&response)?,
        }
        let total = response.content_length();
        if total.is_some_and(|total| total > MAX_ARCHIVE_BYTES) {
            return Err(OnlineError::new(OnlineErrorKind::TooLarge));
        }
        let mut file = tokio::fs::File::create(destination)
            .await
            .map_err(|error| OnlineError::io(format!("could not stage the download: {error}")))?;
        let mut stream = response.bytes_stream();
        let mut received: u64 = 0;
        let mut head: Vec<u8> = Vec::with_capacity(4);
        let mut last = Instant::now() - PROGRESS_INTERVAL;
        progress(0, total);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| unreachable(&self.base, error))?;
            if head.len() < 4 {
                head.extend(chunk.iter().take(4 - head.len()));
            }
            received += chunk.len() as u64;
            if received > MAX_ARCHIVE_BYTES {
                return Err(OnlineError::new(OnlineErrorKind::TooLarge));
            }
            file.write_all(&chunk).await.map_err(|error| {
                OnlineError::io(format!("could not stage the download: {error}"))
            })?;
            if last.elapsed() >= PROGRESS_INTERVAL {
                last = Instant::now();
                progress(received, total);
            }
        }
        file.flush()
            .await
            .map_err(|error| OnlineError::io(format!("could not stage the download: {error}")))?;
        if !head.starts_with(b"PK") {
            return Err(OnlineError::new(OnlineErrorKind::NotAnArchive));
        }
        progress(received, total.or(Some(received)));
        Ok(received)
    }
}

/// The project id in a redirect to `/project/<id>`, absolute or relative,
/// and under a server's sub-path too.
pub fn project_id_in(location: &str) -> Option<String> {
    let path = location.split_once("://").map_or(location, |(_, rest)| {
        rest.find('/').map_or("", |at| &rest[at..])
    });
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let at = path.rfind("/project/")?;
    let id = path[at + "/project/".len()..].trim_end_matches('/');
    valid_project_id(id).then(|| id.to_string())
}

pub fn parse_dashboard(page: &str) -> Result<Dashboard, OnlineError> {
    let tags = html::meta_tags(page);
    let user_id = html::meta_text(&tags, "ol-user_id").ok_or_else(expired)?;
    let email = html::meta_text(&tags, "ol-usersEmail").unwrap_or_default();
    let csrf = html::meta_text(&tags, "ol-csrfToken");
    let (projects, total) = projects_from_tags(&tags);
    Ok(Dashboard {
        user_id,
        email,
        csrf,
        projects,
        total,
        set_cookies: Vec::new(),
    })
}

fn projects_from_tags(tags: &HashMap<String, String>) -> (Option<Vec<Value>>, Option<u64>) {
    let parse = |name: &str| {
        tags.get(name)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    };
    if let Some(blob) = parse("ol-prefetchedProjectsBlob") {
        if let Some(list) = blob.get("projects").and_then(Value::as_array) {
            return (
                Some(list.clone()),
                blob.get("totalSize").and_then(Value::as_u64),
            );
        }
        if let Some(list) = blob.as_array() {
            return (Some(list.clone()), None);
        }
    }
    let mut names: Vec<&String> = tags.keys().collect();
    names.sort();
    for name in names {
        let raw = &tags[name];
        if !raw.contains("\"projects\"") {
            continue;
        }
        if let Ok(Value::Object(object)) = serde_json::from_str::<Value>(raw) {
            if let Some(list) = object.get("projects").and_then(Value::as_array) {
                return (
                    Some(list.clone()),
                    object.get("totalSize").and_then(Value::as_u64),
                );
            }
        }
    }
    if let Some(list) = parse("ol-projects").and_then(|value| value.as_array().cloned()) {
        return (Some(list), None);
    }
    (None, None)
}

pub fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn needs_api(dashboard: &Dashboard) -> bool {
    match (&dashboard.projects, dashboard.total) {
        (None, _) => true,
        (Some(list), Some(total)) => total > list.len() as u64,
        _ => false,
    }
}

pub fn api_size(dashboard: &Dashboard) -> u64 {
    dashboard.total.unwrap_or(API_PAGE_SIZE).max(API_PAGE_SIZE)
}
