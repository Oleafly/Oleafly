use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, ACCEPT, CONTENT_TYPE, COOKIE, LOCATION, ORIGIN, SET_COOKIE};
use reqwest::{Response, StatusCode};
use serde_json::Value;
use tokio::io::AsyncWriteExt;

use super::html;
use super::session;
use crate::app_error::AppError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
const API_PAGE_SIZE: u64 = 1_000;

pub(crate) struct Dashboard {
    pub user_id: String,
    pub email: String,
    pub csrf: Option<String>,
    pub projects: Option<Vec<Value>>,
    pub total: Option<u64>,
    pub set_cookies: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct Http {
    client: reqwest::Client,
    pub base: String,
    pub origin: String,
}

fn build_client() -> Result<reqwest::Client, String> {
    let builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .user_agent(concat!("Oleafly/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none());
    #[cfg(test)]
    let builder = builder.no_proxy();
    builder
        .build()
        .map_err(|error| format!("could not start the connection: {error}"))
}

fn shared_client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = build_client()?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

pub(crate) fn expired() -> String {
    AppError::new("overleaf.session_expired").into()
}

pub(crate) fn is_expired(error: &str) -> bool {
    error.contains("\"overleaf.session_expired\"")
}

fn unreachable(base: &str, detail: impl ToString) -> String {
    AppError::new("overleaf.unreachable")
        .param("server", base)
        .detail(detail)
        .into()
}

fn set_cookie_lines(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_string))
        .collect()
}

impl Http {
    pub(crate) fn new(base: &str) -> Result<Self, String> {
        Ok(Self {
            client: shared_client()?,
            base: base.to_string(),
            origin: session::origin_of(base),
        })
    }

    pub(crate) fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    pub(crate) fn get(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .get(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    /// A request for a public page, sent without the account's cookie.
    pub(crate) fn public_get(&self, path: &str) -> reqwest::RequestBuilder {
        self.client.get(self.url(path))
    }

    pub(crate) async fn send_public(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<Response, String> {
        self.send(request).await
    }

    pub(crate) fn post(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .post(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Response, String> {
        request
            .send()
            .await
            .map_err(|error| unreachable(&self.base, error))
    }

    fn classify(&self, response: &Response) -> Result<(), String> {
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if ["login", "sso", "saml", "oauth", "auth"]
                .iter()
                .any(|marker| location.contains(marker))
            {
                return Err(expired());
            }
            return Err(unreachable(&self.base, format!("redirected to {location}")));
        }
        match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(expired()),
            StatusCode::TOO_MANY_REQUESTS => Err(AppError::new("overleaf.rate_limited").into()),
            status if status.is_success() => Ok(()),
            status => Err(unreachable(&self.base, format!("HTTP {}", status.as_u16()))),
        }
    }

    pub(crate) async fn dashboard(&self, cookie: &str) -> Result<Dashboard, String> {
        let response = self
            .send(self.get("/project", cookie).header(ACCEPT, "text/html"))
            .await?;
        self.classify(&response)?;
        let set_cookies = set_cookie_lines(response.headers());
        let page = response
            .text()
            .await
            .map_err(|error| unreachable(&self.base, error))?;
        let mut dashboard = parse_dashboard(&page)?;
        dashboard.set_cookies = set_cookies;
        Ok(dashboard)
    }

    pub(crate) async fn api_projects(
        &self,
        cookie: &str,
        csrf: &str,
        size: u64,
    ) -> Result<Vec<Value>, String> {
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
            .ok_or_else(|| AppError::new("overleaf.unrecognized").into())
    }

    /// Ask the server to copy a gallery template into the account, as its
    /// Open as Template button does, and return the new project's id.
    pub(crate) async fn create_from_template(
        &self,
        cookie: &str,
        csrf: &str,
        body: &Value,
    ) -> Result<String, String> {
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
                Err(AppError::new("overleaf.template_unavailable").into())
            }
            _ => {
                self.classify(&response)?;
                Err(AppError::new("overleaf.template_unavailable").into())
            }
        }
    }

    pub(crate) async fn download_zip(
        &self,
        cookie: &str,
        project_id: &str,
        destination: &Path,
        mut progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, String> {
        if !valid_project_id(project_id) {
            return Err(AppError::new("overleaf.project_unavailable").into());
        }
        let path = format!("/project/{project_id}/download/zip");
        let response = self.send(self.get(&path, cookie)).await?;
        match response.status() {
            StatusCode::NOT_FOUND => {
                return Err(AppError::new("overleaf.project_unavailable").into());
            }
            StatusCode::FORBIDDEN if response.headers().get(LOCATION).is_none() => {
                return Err(AppError::new("overleaf.project_unavailable").into());
            }
            _ => self.classify(&response)?,
        }
        let total = response.content_length();
        if total.is_some_and(|total| total > MAX_ARCHIVE_BYTES) {
            return Err(AppError::new("overleaf.too_large").into());
        }
        let mut file = tokio::fs::File::create(destination)
            .await
            .map_err(|error| format!("could not stage the download: {error}"))?;
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
                return Err(AppError::new("overleaf.too_large").into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("could not stage the download: {error}"))?;
            if last.elapsed() >= PROGRESS_INTERVAL {
                last = Instant::now();
                progress(received, total);
            }
        }
        file.flush()
            .await
            .map_err(|error| format!("could not stage the download: {error}"))?;
        if !head.starts_with(b"PK") {
            return Err(AppError::new("overleaf.not_an_archive").into());
        }
        progress(received, total.or(Some(received)));
        Ok(received)
    }
}

/// The project id in a redirect to `/project/<id>`, absolute or relative,
/// and under a server's sub-path too.
pub(crate) fn project_id_in(location: &str) -> Option<String> {
    let path = location.split_once("://").map_or(location, |(_, rest)| {
        rest.find('/').map_or("", |at| &rest[at..])
    });
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let at = path.rfind("/project/")?;
    let id = path[at + "/project/".len()..].trim_end_matches('/');
    valid_project_id(id).then(|| id.to_string())
}

pub(crate) fn parse_dashboard(page: &str) -> Result<Dashboard, String> {
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

pub(crate) fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn needs_api(dashboard: &Dashboard) -> bool {
    match (&dashboard.projects, dashboard.total) {
        (None, _) => true,
        (Some(list), Some(total)) => total > list.len() as u64,
        _ => false,
    }
}

pub(crate) fn api_size(dashboard: &Dashboard) -> u64 {
    dashboard.total.unwrap_or(API_PAGE_SIZE).max(API_PAGE_SIZE)
}
