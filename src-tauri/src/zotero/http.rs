use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, RETRY_AFTER};
use reqwest::StatusCode;
use serde_json::Value;

use crate::app_error::AppError;

pub const LOCAL_BASE: &str = "http://127.0.0.1:23119";
pub const WEB_BASE: &str = "https://api.zotero.org";
const USER_AGENT: &str = concat!("Oleafly/", env!("CARGO_PKG_VERSION"), " (Zotero citations)");
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_RETRY_SECS: u64 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub local: String,
    pub web: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            local: LOCAL_BASE.to_string(),
            web: WEB_BASE.to_string(),
        }
    }
}

impl Endpoints {
    pub fn from_env() -> Self {
        let mut endpoints = Self::default();
        if cfg!(debug_assertions) {
            let read = |name: &str| {
                std::env::var(name)
                    .ok()
                    .map(|value| value.trim().trim_end_matches('/').to_string())
                    .filter(|value| {
                        value.starts_with("http://127.0.0.1:")
                            || value.starts_with("http://localhost:")
                    })
            };
            if let Some(local) = read("OLEAFLY_ZOTERO_LOCAL_BASE_URL") {
                endpoints.local = local;
            }
            if let Some(web) = read("OLEAFLY_ZOTERO_BASE_URL") {
                endpoints.web = web;
            }
        }
        endpoints
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    NotRunning,
    ApiDisabled,
    Unsupported,
    RateLimited { seconds: u64 },
    KeyRejected,
    Unreachable,
    Invalid,
    Http(u16),
    Offline,
    ServerChanged,
}

impl SyncError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotRunning => "zotero.local_not_running",
            Self::ApiDisabled => "zotero.local_api_disabled",
            Self::Unsupported => "zotero.local_unsupported",
            Self::RateLimited { .. } => "zotero.rate_limited",
            Self::KeyRejected => "zotero.key_rejected",
            Self::Unreachable => "zotero.unreachable",
            Self::Invalid => "zotero.invalid_response",
            Self::Http(_) => "zotero.http_error",
            Self::Offline => "zotero.offline",
            Self::ServerChanged => "zotero.invalid_response",
        }
    }

    pub fn app_error(&self) -> AppError {
        let error = AppError::new(self.code());
        match self {
            Self::Http(status) => error.param("status", status),
            _ => error,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Local,
    Web,
}

#[derive(Debug, Clone, Copy)]
pub struct WaitPolicy {
    pub max_single: Duration,
    pub max_total: Duration,
}

impl Default for WaitPolicy {
    fn default() -> Self {
        Self {
            max_single: Duration::from_secs(30),
            max_total: Duration::from_secs(60),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Reply {
    pub status: u16,
    pub body: String,
    pub version: Option<u64>,
    pub total: Option<usize>,
    pub server_id: Option<String>,
    pub zotero_version: Option<String>,
    pub api_version: Option<String>,
}

impl Reply {
    pub fn json(&self) -> Result<Value, SyncError> {
        serde_json::from_str(&self.body).map_err(|_| SyncError::Invalid)
    }

    pub fn not_modified(&self) -> bool {
        self.status == StatusCode::NOT_MODIFIED.as_u16()
    }
}

pub struct Http {
    client: reqwest::Client,
    base: String,
    side: Side,
    api_key: Option<String>,
    policy: WaitPolicy,
    waited: Duration,
    not_before: Option<Instant>,
    pub requests: usize,
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
}

fn seconds(value: Option<&str>) -> Option<u64> {
    value.and_then(|text| text.parse::<u64>().ok())
}

pub fn retry_seconds(headers: &HeaderMap) -> u64 {
    seconds(header(headers, RETRY_AFTER.as_str()))
        .or_else(|| seconds(header(headers, "Backoff")))
        .unwrap_or(DEFAULT_RETRY_SECS)
}

impl Http {
    pub fn new(side: Side, base: &str, api_key: Option<String>) -> Result<Self, SyncError> {
        let mut builder = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none());
        builder = match side {
            Side::Local => builder
                .no_proxy()
                .connect_timeout(Duration::from_millis(1_500))
                .timeout(Duration::from_secs(60)),
            Side::Web => builder
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30)),
        };
        Ok(Self {
            client: builder.build().map_err(|_| SyncError::Unreachable)?,
            base: base.trim_end_matches('/').to_string(),
            side,
            api_key,
            policy: WaitPolicy::default(),
            waited: Duration::ZERO,
            not_before: None,
            requests: 0,
        })
    }

    pub fn with_policy(mut self, policy: WaitPolicy) -> Self {
        self.policy = policy;
        self
    }

    fn unreachable(&self) -> SyncError {
        match self.side {
            Side::Local => SyncError::NotRunning,
            Side::Web => SyncError::Unreachable,
        }
    }

    async fn wait(&mut self, seconds: u64) -> Result<(), SyncError> {
        let duration = Duration::from_secs(seconds);
        if duration > self.policy.max_single || self.waited + duration > self.policy.max_total {
            return Err(SyncError::RateLimited { seconds });
        }
        self.waited += duration;
        if !duration.is_zero() {
            tokio::time::sleep(duration).await;
        }
        Ok(())
    }

    async fn respect_backoff(&mut self) -> Result<(), SyncError> {
        let Some(not_before) = self.not_before else {
            return Ok(());
        };
        let now = Instant::now();
        if not_before > now {
            let remaining = (not_before - now).as_secs_f64().ceil() as u64;
            self.wait(remaining).await?;
        }
        self.not_before = None;
        Ok(())
    }

    async fn read_body(response: reqwest::Response) -> Result<String, SyncError> {
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
        {
            return Err(SyncError::Invalid);
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| SyncError::Invalid)?;
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(SyncError::Invalid);
            }
            body.extend_from_slice(&chunk);
        }
        String::from_utf8(body).map_err(|_| SyncError::Invalid)
    }

    async fn send(
        &mut self,
        request: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    ) -> Result<Reply, SyncError> {
        loop {
            self.respect_backoff().await?;
            let mut builder = request(&self.client).header("Zotero-API-Version", "3");
            if let Some(key) = &self.api_key {
                builder = builder.header("Zotero-API-Key", key);
            }
            self.requests += 1;
            let response = builder.send().await.map_err(|_| self.unreachable())?;
            let status = response.status();
            let headers = response.headers().clone();
            if let Some(backoff) = seconds(header(&headers, "Backoff")) {
                self.not_before = Some(Instant::now() + Duration::from_secs(backoff));
            }
            if self.side == Side::Web
                && (status == StatusCode::TOO_MANY_REQUESTS
                    || status == StatusCode::SERVICE_UNAVAILABLE)
            {
                let retry = retry_seconds(&headers);
                self.wait(retry).await?;
                continue;
            }
            let body = Self::read_body(response).await?;
            return Ok(Reply {
                status: status.as_u16(),
                body,
                version: seconds(header(&headers, "Last-Modified-Version")),
                total: header(&headers, "Total-Results").and_then(|text| text.parse().ok()),
                server_id: header(&headers, "Zotero-Server-ID").map(str::to_string),
                zotero_version: header(&headers, "X-Zotero-Version").map(str::to_string),
                api_version: header(&headers, "Zotero-API-Version").map(str::to_string),
            });
        }
    }

    pub async fn get_raw(
        &mut self,
        path: &str,
        if_modified: Option<u64>,
    ) -> Result<Reply, SyncError> {
        let url = format!("{}{}", self.base, path);
        self.send(|client| {
            let builder = client.get(&url);
            match if_modified {
                Some(version) => builder.header("If-Modified-Since-Version", version.to_string()),
                None => builder,
            }
        })
        .await
    }

    pub async fn get(&mut self, path: &str, if_modified: Option<u64>) -> Result<Reply, SyncError> {
        let reply = self.get_raw(path, if_modified).await?;
        match reply.status {
            200..=299 | 304 => Ok(reply),
            401 | 403 if self.side == Side::Web => Err(SyncError::KeyRejected),
            403 => Err(SyncError::ApiDisabled),
            412 => Err(SyncError::ServerChanged),
            status => Err(SyncError::Http(status)),
        }
    }

    pub async fn rpc(&mut self, method: &str, params: Value) -> Result<Option<Value>, SyncError> {
        let url = format!("{}/better-bibtex/json-rpc", self.base);
        let body =
            serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params, "id": 1 });
        let reply = self.send(|client| client.post(&url).json(&body)).await?;
        if reply.status == 404 {
            return Ok(None);
        }
        if !(200..300).contains(&reply.status) {
            return Err(SyncError::Http(reply.status));
        }
        let value = reply.json()?;
        if value.get("error").is_some_and(|error| !error.is_null()) {
            return Err(SyncError::Invalid);
        }
        Ok(value.get("result").cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_retry_headers() {
        let mut headers = HeaderMap::new();
        assert_eq!(retry_seconds(&headers), DEFAULT_RETRY_SECS);
        headers.insert("Backoff", "12".parse().unwrap());
        assert_eq!(retry_seconds(&headers), 12);
        headers.insert(RETRY_AFTER, "3".parse().unwrap());
        assert_eq!(retry_seconds(&headers), 3);
    }

    #[test]
    fn maps_errors_to_codes() {
        assert_eq!(SyncError::ApiDisabled.code(), "zotero.local_api_disabled");
        assert_eq!(SyncError::NotRunning.code(), "zotero.local_not_running");
        assert_eq!(SyncError::Http(502).app_error().params["status"], "502");
    }

    #[test]
    fn endpoint_overrides_only_accept_loopback_urls() {
        let _guard = crate::paths::data_dir_env_lock();
        std::env::set_var("OLEAFLY_ZOTERO_LOCAL_BASE_URL", "http://127.0.0.1:4567/");
        std::env::set_var("OLEAFLY_ZOTERO_BASE_URL", "https://evil.example");
        let endpoints = Endpoints::from_env();
        std::env::remove_var("OLEAFLY_ZOTERO_LOCAL_BASE_URL");
        std::env::remove_var("OLEAFLY_ZOTERO_BASE_URL");
        assert_eq!(endpoints.local, "http://127.0.0.1:4567");
        assert_eq!(endpoints.web, WEB_BASE);
        assert_eq!(Endpoints::from_env(), Endpoints::default());
    }
}
