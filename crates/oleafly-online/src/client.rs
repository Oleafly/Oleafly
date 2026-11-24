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

const READ_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const SMALL_BODY_BYTES: usize = 1024 * 1024;
const UPLOAD_FLOOR: Duration = Duration::from_secs(60);
const UPLOAD_BYTES_PER_SECOND: u64 = 32 * 1024;
pub const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
const API_PAGE_SIZE: u64 = 1_000;
const GET_RETRIES: u32 = 2;
const GET_PAUSE: Duration = Duration::from_millis(200);
const INVITE_TEMPLATE: &str = "notification_project_invite";
const INVITE_KEY: &str = "project-invite-";
const MAX_INVITES: usize = 200;

pub struct Dashboard {
    pub user_id: String,
    pub email: String,
    pub csrf: Option<String>,
    pub projects: Option<Vec<Value>>,
    pub total: Option<u64>,
    pub invites: Vec<ProjectInvite>,
    pub set_cookies: Vec<String>,
}

#[derive(Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInvite {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub inviter: Option<String>,
    pub expires: Option<String>,
    #[serde(skip)]
    pub token: String,
}

impl std::fmt::Debug for ProjectInvite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectInvite")
            .field("id", &self.id)
            .field("project_id", &self.project_id)
            .field("project_name", &self.project_name)
            .field("inviter", &self.inviter)
            .field("expires", &self.expires)
            .field("token", &"[redacted]")
            .finish()
    }
}

impl std::fmt::Debug for Dashboard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dashboard")
            .field("user_id", &self.user_id)
            .field("email", &self.email)
            .field("csrf", &self.csrf.as_ref().map(|_| "[redacted]"))
            .field("projects", &self.projects.as_ref().map(Vec::len))
            .field("total", &self.total)
            .field("invites", &self.invites.len())
            .field("set_cookies", &"[redacted]")
            .finish()
    }
}

#[derive(Clone)]
pub struct Http {
    client: reqwest::Client,
    uploads: reqwest::Client,
    pub base: String,
    pub origin: String,
    pub user_agent: String,
}

fn build_client(
    user_agent: &str,
    read_timeout: Option<Duration>,
) -> Result<reqwest::Client, OnlineError> {
    let builder = reqwest::Client::builder()
        .connect_timeout(oleafly_net::CONNECT_TIMEOUT)
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::none());
    let builder = match read_timeout {
        Some(timeout) => builder.read_timeout(timeout),
        None => builder,
    };
    #[cfg(any(test, feature = "test-support"))]
    let builder = builder.no_proxy();
    builder
        .build()
        .map_err(|error| OnlineError::io(format!("could not start the connection: {error}")))
}

fn shared_client(user_agent: &str) -> Result<reqwest::Client, OnlineError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = build_client(user_agent, Some(READ_TIMEOUT))?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

fn upload_client(user_agent: &str) -> Result<reqwest::Client, OnlineError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = build_client(user_agent, None)?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

pub fn upload_timeout(size: u64) -> Duration {
    UPLOAD_FLOOR + transfer_time(size)
}

pub(crate) fn transfer_time(size: u64) -> Duration {
    Duration::from_secs(size / UPLOAD_BYTES_PER_SECOND)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BodyError {
    TooLarge(usize),
    Read(String),
}

impl std::fmt::Display for BodyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BodyError::TooLarge(limit) => write!(f, "the reply is larger than {limit} bytes"),
            BodyError::Read(detail) => f.write_str(detail),
        }
    }
}

pub(crate) async fn read_counted(
    response: Response,
    limit: usize,
    mut arrived: impl FnMut(usize),
) -> Result<Vec<u8>, BodyError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(BodyError::TooLarge(limit));
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| BodyError::Read(error.to_string()))?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(BodyError::TooLarge(limit));
        }
        body.extend_from_slice(&chunk);
        arrived(chunk.len());
    }
    Ok(body)
}

pub(crate) async fn retried<T, E, F>(
    again: impl Fn(&E) -> bool,
    mut call: impl FnMut() -> F,
) -> Result<T, E>
where
    F: std::future::Future<Output = Result<T, E>>,
{
    let mut attempt = 0;
    loop {
        match call().await {
            Err(error) if again(&error) && attempt < GET_RETRIES => {
                attempt += 1;
                tokio::time::sleep(GET_PAUSE * attempt).await;
            }
            done => return done,
        }
    }
}

pub(crate) async fn read_capped(response: Response, limit: usize) -> Result<Vec<u8>, BodyError> {
    read_counted(response, limit, |_| {}).await
}

pub(crate) fn lossy_text(body: Vec<u8>) -> String {
    String::from_utf8(body)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

pub(crate) async fn text_capped(response: Response, limit: usize) -> Result<String, BodyError> {
    read_capped(response, limit).await.map(lossy_text)
}

pub(crate) fn boundary() -> String {
    format!(
        "----oleafly{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    )
}

pub(crate) fn multipart(boundary: &str, name: &str, bytes: &[u8]) -> Vec<u8> {
    let quoted: String = name
        .chars()
        .map(|character| match character {
            '"' => "%22".to_string(),
            '\r' | '\n' => " ".to_string(),
            other => other.to_string(),
        })
        .collect();
    let mut body = Vec::with_capacity(bytes.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{quoted}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"qqfile\"; filename=\"{quoted}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

pub(crate) fn expired() -> OnlineError {
    OnlineError::new(OnlineErrorKind::SessionExpired)
}

fn unreachable(base: &str, detail: impl ToString) -> OnlineError {
    OnlineError::new(OnlineErrorKind::Unreachable)
        .param("server", base)
        .detail(detail)
}

pub(crate) fn set_cookie_lines(headers: &HeaderMap) -> Vec<String> {
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
            uploads: upload_client(user_agent)?,
            base: base.to_string(),
            origin: session::origin_of(base),
            user_agent: user_agent.to_string(),
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

    pub fn get_at(&self, url: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .get(url)
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    pub fn post_at(&self, url: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .post(url)
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    pub fn public_get(&self, path: &str) -> reqwest::RequestBuilder {
        self.client.get(self.url(path))
    }

    pub async fn send_public(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<Response, OnlineError> {
        self.send(request).await
    }

    pub fn post_upload(&self, path: &str, cookie: &str, size: u64) -> reqwest::RequestBuilder {
        self.uploads
            .post(self.url(path))
            .timeout(upload_timeout(size))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    pub fn delete(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.client
            .delete(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
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

    fn is_login_redirect(&self, location: &str) -> bool {
        let Ok(base) = url::Url::parse(&format!("{}/", self.base)) else {
            return false;
        };
        let Ok(target) = base.join(location) else {
            return false;
        };
        target.origin() == base.origin() && target.path().trim_end_matches('/').ends_with("/login")
    }

    pub(crate) fn classify(&self, response: &Response) -> Result<(), OnlineError> {
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
        let page = text_capped(response, oleafly_net::MAX_MESSAGE_BYTES)
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
        let body = read_capped(response, oleafly_net::MAX_MESSAGE_BYTES)
            .await
            .map_err(|error| unreachable(&self.base, error))?;
        let value: Value =
            serde_json::from_slice(&body).map_err(|error| unreachable(&self.base, error))?;
        value
            .get("projects")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| OnlineError::new(OnlineErrorKind::Unrecognized))
    }

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
        progress: impl FnMut(u64, Option<u64>),
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
        self.save_archive(response, destination, progress).await
    }

    pub(crate) fn get_unhurried(&self, path: &str, cookie: &str) -> reqwest::RequestBuilder {
        self.uploads
            .get(self.url(path))
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }

    pub(crate) async fn save_archive(
        &self,
        response: Response,
        destination: &Path,
        mut progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, OnlineError> {
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

    pub(crate) fn post_unhurried(
        &self,
        path: &str,
        cookie: &str,
        total: Duration,
    ) -> reqwest::RequestBuilder {
        self.uploads
            .post(self.url(path))
            .timeout(total)
            .header(COOKIE, cookie)
            .header(ORIGIN, &self.origin)
    }
}

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
        invites: invites_from_tags(&tags),
        set_cookies: Vec::new(),
    })
}

fn invite_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(html::decode_entities)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn invite_of(notification: &Value) -> Option<ProjectInvite> {
    if notification.get("templateKey").and_then(Value::as_str) != Some(INVITE_TEMPLATE) {
        return None;
    }
    let id = notification
        .get("key")
        .and_then(Value::as_str)?
        .strip_prefix(INVITE_KEY)?
        .to_string();
    let options = notification.get("messageOpts")?;
    let project_id = invite_text(options, "projectId")?;
    let token = invite_text(options, "token")?;
    let plain = |text: &str| valid_project_id(text);
    if !plain(&id) || !plain(&project_id) || !plain(&token) {
        return None;
    }
    Some(ProjectInvite {
        project_name: invite_text(options, "projectName")
            .unwrap_or_else(|| "Untitled project".to_string()),
        inviter: invite_text(options, "userName"),
        expires: invite_text(notification, "expires"),
        id,
        project_id,
        token,
    })
}

fn invites_from_tags(tags: &HashMap<String, String>) -> Vec<ProjectInvite> {
    let Some(Value::Array(notifications)) = tags
        .get("ol-notifications")
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    else {
        return Vec::new();
    };
    let mut invites: Vec<ProjectInvite> = notifications
        .iter()
        .filter_map(invite_of)
        .take(MAX_INVITES)
        .collect();
    invites.dedup_by(|later, earlier| later.id == earlier.id);
    invites
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
