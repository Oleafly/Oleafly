//! S3-compatible object storage as a sync provider: Amazon S3, Google Cloud
//! Storage through its XML API with HMAC keys, MinIO, and the other services
//! that speak the same protocol. Objects live under `<bucket>/<prefix>/` in
//! the layout the Dropbox app folder uses. Sync relies on compare-and-swap, so
//! a bucket is only accepted once `probe` finds conditional writes work there.

use super::engine::UPLOAD_BASES;
use super::store::{
    file_state, retry_after, retry_delay, save_body, transient, AccountInfo, Changes, CloudStore,
    Fetched, RemoteEntry, RemoteMeta, StoreError, StoreResult, Uploaded, WriteMode,
};
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::{ContentHash, ContentHasher};
use oleafly_s3::sigv4::{self, Credentials, Request};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};
use tokio::io::AsyncReadExt;

const MAX_ATTEMPTS: u32 = 4;
/// Files up to this size go up in one request; larger ones in parts.
const SINGLE_PUT_LIMIT: u64 = 64 * 1024 * 1024;
const PART_SIZE: usize = 16 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 64 * 1024;
const MAX_LIST_BYTES: usize = 8 * 1024 * 1024;
const MAX_LIST_PAGES: usize = 1_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// A download has no deadline; it ends once this long passes without a byte.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
/// The slowest uplink a write's deadline allows for, on top of
/// `REQUEST_TIMEOUT`.
const UPLOAD_BYTES_PER_SECOND: u64 = 32 * 1024;
const UPLOAD_CONCURRENCY: usize = 8;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct S3Config {
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) region: String,
    pub(crate) bucket: String,
    /// The folder inside the bucket that sync uses.
    #[serde(default)]
    pub(crate) prefix: String,
    #[serde(default = "path_style_by_default")]
    pub(crate) path_style: bool,
}

fn path_style_by_default() -> bool {
    true
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct S3Keys {
    pub(crate) access_key_id: String,
    pub(crate) secret_access_key: String,
}

impl fmt::Debug for S3Keys {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("S3Keys")
            .field("access_key_id", &self.access_key_id)
            .field("secret_access_key", &"[redacted]")
            .finish()
    }
}

/// Google Cloud Storage takes S3 requests but states its own preconditions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Dialect {
    Aws,
    Gcs,
}

/// How long a request may run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Limit {
    /// Up to the request timeout, plus time to send the body at a slow rate.
    Timed,
    /// For as long as the reply keeps arriving.
    Streamed,
}

/// What one upload replaces, from the round that asked for it.
struct Placement {
    mode: WriteMode,
    manifest: String,
    manifest_rev: Option<String>,
    device: String,
}

impl Placement {
    fn of(remote: &str) -> Option<Self> {
        UPLOAD_BASES
            .try_with(|bases| {
                bases.files.get(remote).map(|mode| Self {
                    mode: mode.clone(),
                    manifest: bases.manifest.clone(),
                    manifest_rev: bases.manifest_rev.clone(),
                    device: bases.device.clone(),
                })
            })
            .ok()
            .flatten()
    }

    /// The manifest revision an upload is marked with; a quoted ETag or a
    /// generation number is never "none".
    fn base_mark(&self) -> String {
        self.manifest_rev.clone().unwrap_or_else(|| "none".into())
    }
}

/// Why a bucket can't hold sync, in the terms the connect form shows.
#[derive(Debug, Eq, PartialEq)]
pub(crate) enum ProbeError {
    Endpoint(String),
    Credentials,
    Bucket(String),
    NoConditionalWrites(String),
    Failed(StoreError),
}

impl ProbeError {
    pub(crate) fn to_app_error(&self) -> String {
        use crate::app_error::AppError;
        match self {
            Self::Endpoint(detail) => AppError::new("cloud.s3_endpoint")
                .detail(detail.clone())
                .into(),
            Self::Credentials => AppError::new("cloud.s3_credentials").into(),
            Self::Bucket(detail) => AppError::new("cloud.s3_bucket")
                .detail(detail.clone())
                .into(),
            Self::NoConditionalWrites(detail) => AppError::new("cloud.s3_no_conditional_writes")
                .detail(detail.clone())
                .into(),
            Self::Failed(error) => error.to_app_error(),
        }
    }
}

impl S3Config {
    fn endpoint_url(&self) -> Result<Url, ProbeError> {
        let url = Url::parse(self.endpoint.trim())
            .map_err(|_| ProbeError::Endpoint("the address is not a URL".into()))?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(ProbeError::Endpoint(
                "the address must start with https:// or http:// and name a server".into(),
            ));
        }
        Ok(url)
    }

    fn bucket(&self) -> &str {
        self.bucket.trim()
    }

    fn prefix(&self) -> &str {
        self.prefix.trim().trim_matches('/')
    }

    fn host(&self) -> String {
        self.endpoint_url()
            .ok()
            .and_then(|url| {
                url.host_str().map(|host| match url.port() {
                    Some(port) => format!("{host}:{port}"),
                    None => host.to_string(),
                })
            })
            .unwrap_or_default()
    }

    /// The address and folder, as the settings tab names the connection.
    pub(crate) fn label(&self) -> String {
        let place = match self.prefix() {
            "" => self.bucket().to_string(),
            prefix => format!("{}/{prefix}", self.bucket()),
        };
        format!("{place} on {}", self.host())
    }

    /// Sync state is kept per bucket and folder, so another bucket or folder
    /// is another account.
    pub(crate) fn account_id(&self) -> String {
        format!("s3:{}/{}/{}", self.host(), self.bucket(), self.prefix())
    }
}

fn dns_safe(bucket: &str) -> bool {
    (3..=63).contains(&bucket.len())
        && !bucket.contains("..")
        && bucket
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub(crate) struct S3Store {
    config: S3Config,
    keys: S3Keys,
    origin: Url,
    host: String,
    bucket_path: String,
    key_prefix: String,
    region: String,
    dialect: Dialect,
    /// For requests with a deadline: metadata, and uploads, whose deadline
    /// grows with their size. A read timeout would cap sending a body too.
    timed: reqwest::Client,
    /// For downloads, which run as long as bytes keep arriving.
    streaming: reqwest::Client,
    request_timeout: Duration,
    /// Multipart completions here go without a condition. Google's XML API
    /// takes none there, and the probe doesn't try one, so another service
    /// that refuses one is noted on its first refusal.
    plain_completions: AtomicBool,
}

fn client(read_timeout: Option<Duration>) -> reqwest::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent("Oleafly")
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none());
    if let Some(read_timeout) = read_timeout {
        builder = builder.read_timeout(read_timeout);
    }
    builder.build()
}

/// The whole file, as long as it didn't change since `before`.
async fn read_unchanged(local: &Path, before: (u64, Option<SystemTime>)) -> StoreResult<Vec<u8>> {
    let bytes = tokio::fs::read(local)
        .await
        .map_err(|error| StoreError::Io(error.to_string()))?;
    if file_state(local).await? != before {
        return Err(StoreError::Io("the file changed while it was read".into()));
    }
    Ok(bytes)
}

struct Listing {
    files: Vec<String>,
    folders: Vec<String>,
    next: Option<String>,
}

impl S3Store {
    pub(crate) fn new(config: S3Config, keys: S3Keys) -> Result<Self, ProbeError> {
        let endpoint = config.endpoint_url()?;
        let bucket = config.bucket();
        if bucket.is_empty() || bucket.contains('/') {
            return Err(ProbeError::Bucket(
                "the bucket name is missing or has a slash".into(),
            ));
        }
        if keys.access_key_id.trim().is_empty() || keys.secret_access_key.is_empty() {
            return Err(ProbeError::Credentials);
        }
        let server = endpoint.host_str().unwrap_or_default().to_ascii_lowercase();
        let dialect = if server == "storage.googleapis.com" {
            Dialect::Gcs
        } else {
            Dialect::Aws
        };
        let virtual_host = !config.path_style && dns_safe(bucket);
        let mut origin = endpoint.clone();
        origin.set_path("");
        origin.set_query(None);
        if virtual_host {
            origin
                .set_host(Some(&format!("{bucket}.{server}")))
                .map_err(|_| {
                    ProbeError::Endpoint("the bucket can't be part of the address".into())
                })?;
        }
        let host = match (origin.host_str(), origin.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_string(),
            (None, _) => return Err(ProbeError::Endpoint("the address names no server".into())),
        };
        let bucket_path = if virtual_host {
            String::new()
        } else {
            format!("/{}", sigv4::uri_encode(bucket, false))
        };
        let key_prefix = match config.prefix() {
            "" => String::new(),
            prefix => format!("{prefix}/"),
        };
        // Google signs S3 requests with the region "auto"; the form's
        // default region is the AWS one, so it counts as none there.
        let region = match config.region.trim() {
            "" | "us-east-1" if dialect == Dialect::Gcs => "auto".to_string(),
            "" => "us-east-1".to_string(),
            region => region.to_string(),
        };
        let unbuilt = |error: reqwest::Error| ProbeError::Endpoint(error.to_string());
        Ok(Self {
            config,
            keys,
            origin,
            host,
            bucket_path,
            key_prefix,
            region,
            dialect,
            timed: client(None).map_err(unbuilt)?,
            streaming: client(Some(STREAM_READ_TIMEOUT)).map_err(unbuilt)?,
            request_timeout: REQUEST_TIMEOUT,
            plain_completions: AtomicBool::new(dialect == Dialect::Gcs),
        })
    }

    /// The store with shorter timeouts, so a test can outlast them.
    #[cfg(test)]
    pub(crate) fn with_timeouts(mut self, request: Duration, read: Duration) -> Self {
        self.request_timeout = request;
        self.streaming = client(Some(read)).unwrap();
        self
    }

    /// The object key of a store path such as `/projects/<id>/version.json`.
    fn key(&self, remote: &str) -> String {
        format!("{}{}", self.key_prefix, remote.trim_start_matches('/'))
    }

    fn url(&self, key: &str, query: &str) -> Url {
        let mut url = self.origin.clone();
        url.set_path(&format!(
            "{}/{}",
            self.bucket_path,
            sigv4::uri_encode(key, true)
        ));
        if !query.is_empty() {
            url.set_query(Some(query));
        }
        url
    }

    async fn send(
        &self,
        method: Method,
        key: &str,
        query: &[(&str, String)],
        extra: &[(&'static str, String)],
        body: Option<Vec<u8>>,
        limit: Limit,
    ) -> StoreResult<reqwest::Response> {
        let sending = body.as_ref().map_or(0, |bytes| bytes.len() as u64);
        let deadline =
            self.request_timeout + Duration::from_secs(sending / UPLOAD_BYTES_PER_SECOND);
        let mut pairs: Vec<(String, String)> = query
            .iter()
            .map(|(name, value)| {
                (
                    sigv4::uri_encode(name, false),
                    sigv4::uri_encode(value, false),
                )
            })
            .collect();
        pairs.sort();
        let canonical_query = pairs
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("&");
        let url = self.url(key, &canonical_query);
        let payload_sha256 = match &body {
            Some(bytes) => hex(ring::digest::digest(&ring::digest::SHA256, bytes).as_ref()),
            None => sigv4::EMPTY_PAYLOAD_SHA256.to_string(),
        };
        let mut attempt = 0;
        loop {
            attempt += 1;
            let amz_date = sigv4::amz_date(crate::cloud::engine::now_ms() as i64);
            let mut headers: Vec<(&str, &str)> = vec![
                ("host", self.host.as_str()),
                ("x-amz-content-sha256", payload_sha256.as_str()),
                ("x-amz-date", amz_date.as_str()),
            ];
            headers.extend(extra.iter().map(|(name, value)| (*name, value.as_str())));
            let signed = sigv4::sign(
                &Credentials {
                    access_key_id: self.keys.access_key_id.trim(),
                    secret_access_key: &self.keys.secret_access_key,
                },
                &self.region,
                sigv4::SERVICE,
                &amz_date,
                &Request {
                    method: method.as_str(),
                    path: url.path(),
                    query: &canonical_query,
                    headers: &headers,
                    payload_sha256: &payload_sha256,
                },
            );
            let mut request = match limit {
                Limit::Timed => self
                    .timed
                    .request(method.clone(), url.clone())
                    .timeout(deadline),
                Limit::Streamed => self.streaming.request(method.clone(), url.clone()),
            }
            .header(reqwest::header::AUTHORIZATION, signed.authorization);
            for (name, value) in &headers {
                if *name != "host" {
                    request = request.header(*name, *value);
                }
            }
            if let Some(bytes) = &body {
                request = request
                    .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                    .body(bytes.clone());
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if attempt < MAX_ATTEMPTS && transient(&error) => {
                    tokio::time::sleep(retry_delay(attempt, None)).await;
                    continue;
                }
                Err(error) => return Err(StoreError::Network(error.to_string())),
            };
            let status = response.status().as_u16();
            if attempt < MAX_ATTEMPTS && matches!(status, 429 | 500 | 502 | 503 | 504) {
                let wait = retry_after(&response);
                drop(response);
                tokio::time::sleep(retry_delay(attempt, wait)).await;
                continue;
            }
            return Ok(response);
        }
    }

    fn rev_of(&self, headers: &reqwest::header::HeaderMap) -> Option<String> {
        let name = match self.dialect {
            Dialect::Aws => "etag",
            Dialect::Gcs => "x-goog-generation",
        };
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .filter(|rev| !rev.is_empty())
    }

    fn conditions(&self, mode: &WriteMode) -> Vec<(&'static str, String)> {
        match (self.dialect, mode) {
            (_, WriteMode::Overwrite) => Vec::new(),
            (Dialect::Aws, WriteMode::Add) => vec![("if-none-match", "*".into())],
            (Dialect::Aws, WriteMode::Update(rev)) => vec![("if-match", rev.clone())],
            (Dialect::Gcs, WriteMode::Add) => vec![("x-goog-if-generation-match", "0".into())],
            (Dialect::Gcs, WriteMode::Update(rev)) => {
                vec![("x-goog-if-generation-match", rev.clone())]
            }
        }
    }

    /// The metadata an upload carries: the manifest its round built on and the
    /// computer it ran on, which tell a later round whether a version no
    /// manifest holds can still be published.
    fn marks(&self, placement: &Placement) -> Vec<(&'static str, String)> {
        let (base, device) = self.mark_names();
        vec![
            (base, placement.base_mark()),
            (device, placement.device.clone()),
        ]
    }

    fn mark_names(&self) -> (&'static str, &'static str) {
        match self.dialect {
            Dialect::Aws => ("x-amz-meta-oleafly-base", "x-amz-meta-oleafly-device"),
            Dialect::Gcs => ("x-goog-meta-oleafly-base", "x-goog-meta-oleafly-device"),
        }
    }

    async fn put_key(
        &self,
        key: &str,
        bytes: Vec<u8>,
        mode: &WriteMode,
        marks: &[(&'static str, String)],
    ) -> StoreResult<String> {
        let mut headers = self.conditions(mode);
        headers.extend_from_slice(marks);
        let response = self
            .send(Method::PUT, key, &[], &headers, Some(bytes), Limit::Timed)
            .await?;
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        self.rev_of(response.headers()).ok_or_else(|| {
            StoreError::Server("the storage service didn't say which version it wrote".into())
        })
    }

    /// After an upload over the version its round read was refused: the write
    /// to make instead, when what is there now can't end up in a manifest, or
    /// `None` when another computer may still publish it. The round then
    /// counts a conflict and merges once that computer has published.
    async fn replaceable(
        &self,
        key: &str,
        placement: &Placement,
    ) -> StoreResult<Option<WriteMode>> {
        // A manifest published since the round started may hold it.
        let manifest = self.head_key(&self.key(&placement.manifest)).await?;
        if manifest.map(|meta| meta.rev) != placement.manifest_rev {
            return Ok(None);
        }
        let response = self
            .send(Method::HEAD, key, &[], &[], None, Limit::Timed)
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(Some(WriteMode::Add));
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let headers = response.headers();
        let (base, device) = self.mark_names();
        let mark = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
        // Another computer wrote it over the same manifest, and publishes it
        // next unless this round publishes first. Anything else is this
        // computer's own write from a round that didn't publish, or one whose
        // round built on an older manifest and so can't publish any more.
        if mark(base) == Some(placement.base_mark().as_str())
            && mark(device) != Some(placement.device.as_str())
        {
            return Ok(None);
        }
        Ok(self.rev_of(headers).map(WriteMode::Update))
    }

    async fn head_key(&self, key: &str) -> StoreResult<Option<RemoteMeta>> {
        let response = self
            .send(Method::HEAD, key, &[], &[], None, Limit::Timed)
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let rev = self.rev_of(response.headers()).unwrap_or_default();
        let size = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        Ok(Some(RemoteMeta { rev, size }))
    }

    async fn delete_key(&self, key: &str) -> StoreResult<()> {
        let response = self
            .send(Method::DELETE, key, &[], &[], None, Limit::Timed)
            .await?;
        if response.status().is_success() || response.status().as_u16() == 404 {
            return Ok(());
        }
        Err(failure(response).await)
    }

    async fn list_page(
        &self,
        prefix: &str,
        token: Option<&str>,
        max_keys: Option<u32>,
    ) -> StoreResult<Listing> {
        let mut query = vec![
            ("list-type", "2".to_string()),
            ("prefix", prefix.to_string()),
            ("delimiter", "/".to_string()),
        ];
        if let Some(token) = token {
            query.push(("continuation-token", token.to_string()));
        }
        if let Some(max_keys) = max_keys {
            query.push(("max-keys", max_keys.to_string()));
        }
        let response = self
            .send(Method::GET, "", &query, &[], None, Limit::Timed)
            .await?;
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let body = read_capped(response, MAX_LIST_BYTES).await?;
        parse_listing(&body, prefix)
    }

    async fn upload_parts(
        &self,
        key: &str,
        local: &Path,
        placement: Option<&Placement>,
    ) -> StoreResult<Uploaded> {
        let before = file_state(local).await?;
        let marks = placement
            .map(|placement| self.marks(placement))
            .unwrap_or_default();
        let response = self
            .send(
                Method::POST,
                key,
                &[("uploads", String::new())],
                &marks,
                None,
                Limit::Timed,
            )
            .await?;
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let created = read_capped(response, MAX_ERROR_BYTES).await?;
        let upload_id = xml_text(&created, "UploadId").ok_or_else(|| {
            StoreError::Server("the storage service didn't start the upload".into())
        })?;
        let uploaded = self
            .send_parts(key, local, &upload_id, before, placement)
            .await;
        if uploaded.is_err() {
            let _ = self
                .send(
                    Method::DELETE,
                    key,
                    &[("uploadId", upload_id)],
                    &[],
                    None,
                    Limit::Timed,
                )
                .await;
        }
        uploaded
    }

    async fn send_parts(
        &self,
        key: &str,
        local: &Path,
        upload_id: &str,
        before: (u64, Option<SystemTime>),
        placement: Option<&Placement>,
    ) -> StoreResult<Uploaded> {
        let mut file = tokio::fs::File::open(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        let mut hasher = ContentHasher::new();
        let mut size = 0_u64;
        let mut parts = Vec::new();
        loop {
            let mut buffer = vec![0_u8; PART_SIZE];
            let mut filled = 0;
            while filled < PART_SIZE {
                let read = file
                    .read(&mut buffer[filled..])
                    .await
                    .map_err(|error| StoreError::Io(error.to_string()))?;
                if read == 0 {
                    break;
                }
                filled += read;
            }
            if filled == 0 && !parts.is_empty() {
                break;
            }
            buffer.truncate(filled);
            hasher.update(&buffer);
            size += filled as u64;
            let number = parts.len() + 1;
            let response = self
                .send(
                    Method::PUT,
                    key,
                    &[
                        ("partNumber", number.to_string()),
                        ("uploadId", upload_id.to_string()),
                    ],
                    &[],
                    Some(buffer),
                    Limit::Timed,
                )
                .await?;
            if !response.status().is_success() {
                return Err(failure(response).await);
            }
            let etag = response
                .headers()
                .get("etag")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
                .ok_or_else(|| StoreError::Server("a part was stored without a tag".into()))?;
            parts.push(etag);
            if filled < PART_SIZE {
                break;
            }
        }
        if file_state(local).await? != before {
            return Err(StoreError::Io(
                "the file changed while it was uploading".into(),
            ));
        }
        let mut manifest = String::from("<CompleteMultipartUpload>");
        for (index, etag) in parts.iter().enumerate() {
            manifest.push_str(&format!(
                "<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>",
                index + 1,
                xml_escape(etag)
            ));
        }
        manifest.push_str("</CompleteMultipartUpload>");
        let mode = placement.map_or(WriteMode::Overwrite, |placement| placement.mode.clone());
        let rev = match self.complete(key, upload_id, &manifest, &mode).await {
            Err(StoreError::Conflict) => {
                let instead = match placement {
                    Some(placement) => self.replaceable(key, placement).await?,
                    None => None,
                };
                match instead {
                    Some(mode) => self.complete(key, upload_id, &manifest, &mode).await?,
                    None => return Err(StoreError::Conflict),
                }
            }
            completed => completed?,
        };
        Ok(Uploaded {
            rev,
            hash: hasher.finish(),
            size,
        })
    }

    async fn complete(
        &self,
        key: &str,
        upload_id: &str,
        parts: &str,
        mode: &WriteMode,
    ) -> StoreResult<String> {
        loop {
            let conditions = if self.plain_completions.load(Ordering::Relaxed) {
                Vec::new()
            } else {
                self.conditions(mode)
            };
            let response = self
                .send(
                    Method::POST,
                    key,
                    &[("uploadId", upload_id.to_string())],
                    &conditions,
                    Some(parts.as_bytes().to_vec()),
                    Limit::Timed,
                )
                .await?;
            let status = response.status();
            let headers = response.headers().clone();
            let body = read_capped(response, MAX_ERROR_BYTES).await?;
            let code = xml_text(&body, "Code");
            // A completion can fail after the reply has started, so S3
            // reports it inside a 200.
            if status.is_success() && code.is_none() {
                return self
                    .rev_of(&headers)
                    .or_else(|| xml_text(&body, "ETag"))
                    .ok_or_else(|| {
                        StoreError::Server("the upload finished without a version".into())
                    });
            }
            match refusal(status.as_u16(), &body) {
                StoreError::Conflict => return Err(StoreError::Conflict),
                // The probe tries conditional writes, not conditional
                // completions; a service without them completes as before.
                StoreError::Rejected(detail)
                    if !conditions.is_empty() && detail.starts_with("NotImplemented") =>
                {
                    self.plain_completions.store(true, Ordering::Relaxed);
                }
                _ => {
                    return Err(StoreError::Server(format!(
                        "the storage service didn't finish the upload ({})",
                        code.unwrap_or_else(|| status.to_string())
                    )))
                }
            }
        }
    }

    /// Checks that sync can work in this bucket: the keys are accepted, the
    /// bucket can be listed and written, and writes can be made conditional.
    /// Leaves nothing behind.
    pub(crate) async fn probe(&self) -> Result<(), ProbeError> {
        self.list_page(&self.key_prefix, None, Some(1))
            .await
            .map_err(|error| probe_failure(error, "list the bucket"))?;
        let key = format!(
            "{}.oleafly-probe-{}",
            self.key_prefix,
            crate::cloud::engine::now_ms()
        );
        let checked = self.probe_conditions(&key).await;
        let _ = self.delete_key(&key).await;
        checked
    }

    async fn probe_conditions(&self, key: &str) -> Result<(), ProbeError> {
        let refused = |error: StoreError, what: &str| match error {
            StoreError::Rejected(detail) | StoreError::Server(detail) => {
                ProbeError::NoConditionalWrites(format!("{what}: {detail}"))
            }
            other => probe_failure(other, what),
        };
        let first = self
            .put_key(key, b"one".to_vec(), &WriteMode::Add, &[])
            .await
            .map_err(|error| refused(error, "a create-only write"))?;
        match self
            .put_key(key, b"two".to_vec(), &WriteMode::Add, &[])
            .await
        {
            Err(StoreError::Conflict) => {}
            Ok(_) => {
                return Err(ProbeError::NoConditionalWrites(
                    "a second create-only write replaced the object".into(),
                ))
            }
            Err(error) => return Err(refused(error, "a second create-only write")),
        }
        let stale = match self.dialect {
            Dialect::Aws => "\"00000000000000000000000000000000\"".to_string(),
            Dialect::Gcs => "1".to_string(),
        };
        match self
            .put_key(key, b"three".to_vec(), &WriteMode::Update(stale), &[])
            .await
        {
            Err(StoreError::Conflict) => {}
            Ok(_) => {
                return Err(ProbeError::NoConditionalWrites(
                    "a write against an old version was accepted".into(),
                ))
            }
            Err(error) => return Err(refused(error, "a write against an old version")),
        }
        self.put_key(key, b"four".to_vec(), &WriteMode::Update(first), &[])
            .await
            .map_err(|error| match error {
                StoreError::Conflict => ProbeError::NoConditionalWrites(
                    "a write against the current version was refused".into(),
                ),
                other => refused(other, "a write against the current version"),
            })?;
        Ok(())
    }
}

fn probe_failure(error: StoreError, what: &str) -> ProbeError {
    match error {
        StoreError::Network(detail) => ProbeError::Endpoint(detail),
        StoreError::Revoked => ProbeError::Credentials,
        StoreError::Server(detail)
            if detail.contains("NoSuchBucket") || detail.contains("AccessDenied") =>
        {
            ProbeError::Bucket(detail)
        }
        StoreError::Server(detail) | StoreError::Rejected(detail) => {
            ProbeError::Failed(StoreError::Server(format!("couldn't {what}: {detail}")))
        }
        other => ProbeError::Failed(other),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn read_capped(mut response: reqwest::Response, cap: usize) -> StoreResult<String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| StoreError::Network(error.to_string()))?
    {
        if bytes.len() + chunk.len() > cap {
            return Err(StoreError::Server(
                "the storage service's reply is too large".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// The text of the first element named `name`, anywhere in `xml`.
fn xml_text(xml: &str, name: &str) -> Option<String> {
    let document = roxmltree::Document::parse(xml).ok()?;
    document
        .descendants()
        .find(|node| node.has_tag_name(name))
        .and_then(|node| node.text())
        .map(str::to_string)
}

fn child_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.has_tag_name(name))
        .and_then(|child| child.text())
        .map(str::to_string)
}

fn parse_listing(xml: &str, prefix: &str) -> StoreResult<Listing> {
    let document = roxmltree::Document::parse(xml)
        .map_err(|_| StoreError::Server("the storage service sent an unreadable listing".into()))?;
    let root = document.root_element();
    let mut listing = Listing {
        files: Vec::new(),
        folders: Vec::new(),
        next: None,
    };
    for node in root.children().filter(roxmltree::Node::is_element) {
        match node.tag_name().name() {
            "Contents" => {
                if let Some(name) = child_text(node, "Key")
                    .and_then(|key| key.strip_prefix(prefix).map(str::to_string))
                    .filter(|name| !name.is_empty() && !name.contains('/'))
                {
                    listing.files.push(name);
                }
            }
            "CommonPrefixes" => {
                if let Some(name) = child_text(node, "Prefix").and_then(|key| {
                    key.strip_prefix(prefix)
                        .map(|rest| rest.trim_end_matches('/').to_string())
                }) {
                    if !name.is_empty() {
                        listing.folders.push(name);
                    }
                }
            }
            "IsTruncated" if node.text() == Some("true") => {
                listing.next = Some(String::new());
            }
            _ => {}
        }
    }
    if listing.next.is_some() {
        listing.next = child_text(root, "NextContinuationToken");
        if listing.next.is_none() {
            return Err(StoreError::Server(
                "the storage service cut a listing short without saying where to go on".into(),
            ));
        }
    }
    Ok(listing)
}

async fn failure(response: reqwest::Response) -> StoreError {
    let status = response.status().as_u16();
    let body = read_capped(response, MAX_ERROR_BYTES)
        .await
        .unwrap_or_default();
    refusal(status, &body)
}

fn refusal(status: u16, body: &str) -> StoreError {
    let code = xml_text(body, "Code").unwrap_or_default();
    match (status, code.as_str()) {
        // AWS answers a write against a version of a key that is gone with
        // NoSuchKey; reads of a missing key never get here.
        (412, _)
        | (_, "PreconditionFailed")
        | (404, "NoSuchKey")
        | (409, "ConditionalRequestConflict" | "OperationAborted") => StoreError::Conflict,
        (401 | 403, "AccessDenied") => {
            StoreError::Server(format!("AccessDenied: {}", message(body)))
        }
        (401 | 403, _) => StoreError::Revoked,
        (507, _) | (_, "XMinioStorageFull" | "QuotaExceeded" | "StorageQuotaExceeded") => {
            StoreError::QuotaFull
        }
        (429 | 503, _) | (_, "SlowDown") => StoreError::RateLimited,
        (400 | 413, "EntityTooLarge" | "KeyTooLongError" | "InvalidObjectName") => {
            StoreError::Rejected(code)
        }
        (501, _) | (_, "NotImplemented") => {
            StoreError::Rejected(format!("NotImplemented: {}", message(body)))
        }
        (_, "") => StoreError::Server(format!("the storage service answered {status}")),
        _ => StoreError::Server(format!("{code}: {}", message(body))),
    }
}

fn message(body: &str) -> String {
    xml_text(body, "Message")
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect()
}

impl CloudStore for S3Store {
    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>> {
        let mut response = self
            .send(
                Method::GET,
                &self.key(remote),
                &[],
                &[],
                None,
                Limit::Streamed,
            )
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let rev = self.rev_of(response.headers()).unwrap_or_default();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?
        {
            if bytes.len() + chunk.len() > cap {
                return Err(StoreError::Server("the stored record is too large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some((bytes, rev)))
    }

    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>> {
        self.head_key(&self.key(remote)).await
    }

    async fn fetch_to(
        &self,
        remote: &str,
        _rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>> {
        // A bucket keeps only the latest version; the engine checks what
        // arrives against the record's hash. An upload replaces only the
        // version its round read, so a mismatch has a newer manifest coming.
        let response = self
            .send(
                Method::GET,
                &self.key(remote),
                &[],
                &[],
                None,
                Limit::Streamed,
            )
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        save_body(response, local, limit, &|_| {}).await.map(Some)
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        self.put_key(&self.key(remote), bytes, &mode, &[]).await
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        let key = self.key(remote);
        let placement = Placement::of(remote);
        let before = file_state(local).await?;
        if before.0 > SINGLE_PUT_LIMIT {
            return self.upload_parts(&key, local, placement.as_ref()).await;
        }
        let bytes = read_unchanged(local, before).await?;
        let hash = ContentHash::digest(&bytes);
        let size = bytes.len() as u64;
        let Some(placement) = placement else {
            let rev = self
                .put_key(&key, bytes, &WriteMode::Overwrite, &[])
                .await?;
            return Ok(Uploaded { rev, hash, size });
        };
        let marks = self.marks(&placement);
        let rev = match self.put_key(&key, bytes, &placement.mode, &marks).await {
            Err(StoreError::Conflict) => {
                let Some(mode) = self.replaceable(&key, &placement).await? else {
                    return Err(StoreError::Conflict);
                };
                let bytes = read_unchanged(local, before).await?;
                self.put_key(&key, bytes, &mode, &marks).await?
            }
            written => written?,
        };
        Ok(Uploaded { rev, hash, size })
    }

    async fn put_paths(
        &self,
        files: &[super::store::BatchFile],
        tick: &(dyn Fn() + Sync),
    ) -> Vec<StoreResult<Uploaded>> {
        // Collected before buffering: a stream that maps to futures borrowing
        // each file doesn't satisfy the Send bound the commands need.
        let pending: Vec<_> = files
            .iter()
            .map(|file| async move {
                let uploaded = self.put_path(&file.remote, &file.local).await;
                tick();
                uploaded
            })
            .collect();
        stream::iter(pending)
            .buffered(UPLOAD_CONCURRENCY)
            .collect()
            .await
    }

    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()> {
        let key = self.key(remote);
        match self.head_key(&key).await? {
            Some(meta) => {
                if parent_rev.is_some_and(|rev| rev != meta.rev) {
                    return Err(StoreError::Conflict);
                }
                self.delete_key(&key).await
            }
            // A bucket has no folders, only keys that share a prefix; one with
            // anything under it is emptied by the caller, file by file.
            None => {
                let inside = self.list_page(&format!("{key}/"), None, Some(1)).await?;
                if inside.files.is_empty() && inside.folders.is_empty() {
                    Ok(())
                } else {
                    Err(StoreError::FolderTooLarge)
                }
            }
        }
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        let prefix = format!("{}/", self.key(remote_dir).trim_end_matches('/'));
        let mut entries = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let page = self.list_page(&prefix, token.as_deref(), None).await?;
            entries.extend(page.files.into_iter().map(|name| RemoteEntry {
                name,
                folder: false,
            }));
            entries.extend(
                page.folders
                    .into_iter()
                    .map(|name| RemoteEntry { name, folder: true }),
            );
            match page.next {
                Some(next) => token = Some(next),
                None => return Ok(entries),
            }
        }
        Err(StoreError::Server("the bucket listing never ended".into()))
    }

    async fn latest_cursor(&self, _remote_dir: &str) -> StoreResult<Option<String>> {
        Ok(None)
    }

    async fn changes(&self, cursor: &str) -> StoreResult<Changes> {
        Ok(Changes {
            paths: Vec::new(),
            cursor: cursor.to_string(),
        })
    }

    async fn account(&self) -> StoreResult<AccountInfo> {
        let label = self.config.label();
        Ok(AccountInfo {
            account_id: self.config.account_id(),
            email: label.clone(),
            display_name: label,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{dns_safe, parse_listing, xml_text, S3Config, S3Keys, S3Store};
    use std::sync::atomic::Ordering;

    fn config(endpoint: &str, path_style: bool) -> S3Config {
        S3Config {
            endpoint: endpoint.into(),
            region: String::new(),
            bucket: "papers".into(),
            prefix: "/oleafly/".into(),
            path_style,
        }
    }

    fn keys() -> S3Keys {
        S3Keys {
            access_key_id: "AKID".into(),
            secret_access_key: "secret".into(),
        }
    }

    #[test]
    fn store_paths_map_to_keys_under_the_folder_in_either_addressing_style() {
        let path = S3Store::new(config("http://127.0.0.1:9000", true), keys()).unwrap();
        assert_eq!(
            path.key("/projects/p/version.json"),
            "oleafly/projects/p/version.json"
        );
        assert_eq!(
            path.url(&path.key("/projects/p/a b.tex"), "").as_str(),
            "http://127.0.0.1:9000/papers/oleafly/projects/p/a%20b.tex"
        );
        assert_eq!(path.region, "us-east-1");
        let hosted =
            S3Store::new(config("https://s3.eu-west-1.amazonaws.com", false), keys()).unwrap();
        assert_eq!(hosted.host, "papers.s3.eu-west-1.amazonaws.com");
        assert_eq!(
            hosted.url("oleafly/x", "").as_str(),
            "https://papers.s3.eu-west-1.amazonaws.com/oleafly/x"
        );
        let google = S3Store::new(config("https://storage.googleapis.com", true), keys()).unwrap();
        assert_eq!(google.region, "auto");
        assert_eq!(google.dialect, super::Dialect::Gcs);
        // Google's XML API takes no condition on a multipart completion.
        let plain = |store: &S3Store| store.plain_completions.load(Ordering::Relaxed);
        assert!(plain(&google) && !plain(&path));
    }

    #[test]
    fn labels_and_account_ids_name_the_server_bucket_and_folder() {
        let config = config("http://127.0.0.1:9000", true);
        assert_eq!(config.label(), "papers/oleafly on 127.0.0.1:9000");
        assert_eq!(config.account_id(), "s3:127.0.0.1:9000/papers/oleafly");
    }

    #[test]
    fn a_bad_address_bucket_or_key_is_refused_before_any_request() {
        assert!(S3Store::new(config("ftp://example.org", true), keys()).is_err());
        assert!(S3Store::new(config("not a url", true), keys()).is_err());
        let mut no_bucket = config("http://127.0.0.1:9000", true);
        no_bucket.bucket = " ".into();
        assert!(S3Store::new(no_bucket, keys()).is_err());
        let empty = S3Keys {
            access_key_id: String::new(),
            secret_access_key: "x".into(),
        };
        assert!(S3Store::new(config("http://127.0.0.1:9000", true), empty).is_err());
        assert!(dns_safe("my-bucket-1"));
        assert!(!dns_safe("My_Bucket"));
        assert!(!format!("{:?}", keys()).contains("secret\""));
    }

    #[test]
    fn listings_split_files_from_folders_and_follow_continuation() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Prefix>oleafly/projects/</Prefix>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>abc&amp;def</NextContinuationToken>
  <Contents><Key>oleafly/projects/readme &amp; notes.txt</Key></Contents>
  <Contents><Key>oleafly/projects/</Key></Contents>
  <CommonPrefixes><Prefix>oleafly/projects/p1/</Prefix></CommonPrefixes>
</ListBucketResult>"#;
        let listing = parse_listing(xml, "oleafly/projects/").unwrap();
        assert_eq!(listing.files, ["readme & notes.txt"]);
        assert_eq!(listing.folders, ["p1"]);
        assert_eq!(listing.next.as_deref(), Some("abc&def"));
        assert_eq!(
            xml_text("<Error><Code>NoSuchBucket</Code></Error>", "Code").as_deref(),
            Some("NoSuchBucket")
        );
    }
}
