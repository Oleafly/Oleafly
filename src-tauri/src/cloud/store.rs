use futures_util::future::BoxFuture;
use oleafly_core::content::{ContentHash, ContentHasher};
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const API_BASE: &str = "https://api.dropboxapi.com/2";
const CONTENT_BASE: &str = "https://content.dropboxapi.com/2";
pub(crate) const SINGLE_UPLOAD_LIMIT: u64 = 8 * 1024 * 1024;
const SESSION_CHUNK: usize = 8 * 1024 * 1024;
const MAX_SMALL_BYTES: usize = 16 * 1024 * 1024;
const DROPBOX_BLOCK: usize = 4 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 4;
const MAX_LIST_PAGES: usize = 1_000;
const RPC_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StoreError {
    Revoked,
    Network(String),
    Server(String),
    Io(String),
    QuotaFull,
    RateLimited,
    Conflict,
    Rejected(String),
    Verify(String),
    Reset,
}

impl StoreError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Revoked => "cloud.revoked",
            Self::Network(_) => "cloud.network",
            Self::Server(_) | Self::Reset | Self::Rejected(_) => "cloud.server",
            Self::Io(_) => "cloud.local_io",
            Self::QuotaFull => "cloud.quota_full",
            Self::RateLimited => "cloud.rate_limited",
            Self::Conflict => "cloud.remote_busy",
            Self::Verify(_) => "cloud.verify_failed",
        }
    }

    pub(crate) fn ends_round(&self) -> bool {
        matches!(self, Self::Revoked | Self::Network(_) | Self::RateLimited)
    }

    pub(crate) fn to_app_error(&self) -> String {
        let error = crate::app_error::AppError::new(self.code());
        match self {
            Self::Network(detail)
            | Self::Server(detail)
            | Self::Io(detail)
            | Self::Rejected(detail)
            | Self::Verify(detail) => error.detail(detail.clone()).into(),
            _ => error.into(),
        }
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Revoked => formatter.write_str("dropbox access was revoked"),
            Self::QuotaFull => formatter.write_str("dropbox is full"),
            Self::RateLimited => formatter.write_str("dropbox asked to slow down"),
            Self::Conflict => formatter.write_str("the remote record changed"),
            Self::Reset => formatter.write_str("the change cursor was reset"),
            Self::Network(message)
            | Self::Server(message)
            | Self::Io(message)
            | Self::Rejected(message)
            | Self::Verify(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for StoreError {}

pub(crate) type StoreResult<T> = std::result::Result<T, StoreError>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RemoteEntry {
    pub(crate) name: String,
    pub(crate) folder: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RemoteMeta {
    pub(crate) rev: String,
    pub(crate) size: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Uploaded {
    pub(crate) rev: String,
    pub(crate) hash: ContentHash,
    pub(crate) size: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Fetched {
    pub(crate) hash: ContentHash,
    pub(crate) size: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WriteMode {
    Add,
    Update(String),
    Overwrite,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct Changes {
    pub(crate) paths: Vec<String>,
    pub(crate) cursor: String,
}

pub(crate) trait CloudStore: Send + Sync {
    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>>;
    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>>;
    async fn fetch_to(
        &self,
        remote: &str,
        rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>>;
    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String>;
    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded>;
    async fn delete(&self, remote: &str) -> StoreResult<()>;
    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>>;
    async fn latest_cursor(&self, remote_dir: &str) -> StoreResult<Option<String>>;
    async fn changes(&self, cursor: &str) -> StoreResult<Changes>;
}

pub(crate) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Oleafly")
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

pub(crate) fn arg_header(value: &serde_json::Value) -> String {
    let mut out = String::new();
    let mut units = [0_u16; 2];
    for character in value.to_string().chars() {
        if (character as u32) < 0x7f {
            out.push(character);
            continue;
        }
        for unit in character.encode_utf16(&mut units) {
            out.push_str(&format!("\\u{unit:04x}"));
        }
    }
    out
}

pub(crate) fn valid_rev(rev: &str) -> bool {
    (9..=64).contains(&rev.len()) && rev.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Default)]
pub(crate) struct DropboxContentHasher {
    block: Sha256,
    block_len: usize,
    blocks: Sha256,
}

impl DropboxContentHasher {
    pub(crate) fn update(&mut self, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            let take = (DROPBOX_BLOCK - self.block_len).min(bytes.len());
            self.block.update(&bytes[..take]);
            self.block_len += take;
            bytes = &bytes[take..];
            if self.block_len == DROPBOX_BLOCK {
                let digest = std::mem::take(&mut self.block).finalize();
                self.blocks.update(digest);
                self.block_len = 0;
            }
        }
    }

    pub(crate) fn finish(mut self) -> String {
        if self.block_len > 0 {
            let digest = self.block.finalize();
            self.blocks.update(digest);
        }
        let digest = self.blocks.finalize();
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[derive(Debug, Eq, PartialEq)]
enum Refusal {
    NotFound,
    Conflict,
    QuotaFull,
    Reset,
    RateLimited,
    Rejected(String),
    Other(String),
}

fn classify(summary: &str) -> Refusal {
    let short: String = summary.chars().take(200).collect();
    if summary.contains("insufficient_space") {
        Refusal::QuotaFull
    } else if summary.starts_with("reset") {
        Refusal::Reset
    } else if summary.contains("not_found") {
        Refusal::NotFound
    } else if summary.contains("too_many_write_operations")
        || summary.contains("upload_traffic_limit")
    {
        Refusal::RateLimited
    } else if summary.contains("conflict") {
        Refusal::Conflict
    } else if [
        "disallowed_name",
        "malformed_path",
        "restricted_content",
        "unsupported_file",
        "too_long",
        "no_write_permission",
    ]
    .iter()
    .any(|reason| summary.contains(reason))
    {
        Refusal::Rejected(short)
    } else {
        Refusal::Other(short)
    }
}

fn refusal_error(refusal: Refusal) -> StoreError {
    match refusal {
        Refusal::NotFound => StoreError::Server("dropbox could not find the item".into()),
        Refusal::Conflict => StoreError::Conflict,
        Refusal::QuotaFull => StoreError::QuotaFull,
        Refusal::Reset => StoreError::Reset,
        Refusal::RateLimited => StoreError::RateLimited,
        Refusal::Rejected(summary) => StoreError::Rejected(summary),
        Refusal::Other(summary) => StoreError::Server(summary),
    }
}

fn retry_delay(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(after) = retry_after {
        return after.min(MAX_RETRY_AFTER);
    }
    let base = 500_u64.saturating_mul(1 << attempt.min(6));
    let jitter = u64::from(rand::random::<u16>()) % 400;
    Duration::from_millis(base + jitter)
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn upload_timeout(len: usize) -> Duration {
    RPC_TIMEOUT + Duration::from_secs(u64::try_from(len / 32_768).unwrap_or(u64::MAX))
}

pub(crate) type TokenRefresher =
    Arc<dyn Fn() -> BoxFuture<'static, StoreResult<String>> + Send + Sync>;

enum Body<'a> {
    None,
    Json(&'a serde_json::Value),
    Bytes(&'a [u8]),
}

struct Call<'a> {
    url: String,
    arg: Option<String>,
    body: Body<'a>,
    timeout: Option<Duration>,
}

pub(crate) struct DropboxStore {
    api_base: String,
    content_base: String,
    token: Mutex<String>,
    refresher: Option<TokenRefresher>,
}

impl DropboxStore {
    pub(crate) fn new(token: String, refresher: Option<TokenRefresher>) -> Self {
        Self {
            api_base: API_BASE.into(),
            content_base: CONTENT_BASE.into(),
            token: Mutex::new(token),
            refresher,
        }
    }

    fn token(&self) -> String {
        self.token
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn set_token(&self, token: String) {
        *self
            .token
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = token;
    }

    async fn send(&self, call: &Call<'_>) -> StoreResult<reqwest::Response> {
        let mut refreshed = false;
        let mut attempt = 0;
        loop {
            attempt += 1;
            let mut request = http().post(&call.url).bearer_auth(self.token());
            if let Some(timeout) = call.timeout {
                request = request.timeout(timeout);
            }
            if let Some(arg) = &call.arg {
                request = request.header("Dropbox-API-Arg", arg);
            }
            request = match call.body {
                Body::None => request,
                Body::Json(value) => request.json(value),
                Body::Bytes(bytes) => request
                    .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                    .body(bytes.to_vec()),
            };
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) => {
                    if attempt < MAX_ATTEMPTS
                        && (error.is_timeout() || error.is_connect() || error.is_request())
                    {
                        tokio::time::sleep(retry_delay(attempt, None)).await;
                        continue;
                    }
                    return Err(StoreError::Network(error.to_string()));
                }
            };
            let status = response.status().as_u16();
            if status == 401 {
                if !refreshed {
                    if let Some(refresher) = &self.refresher {
                        let token = refresher().await?;
                        self.set_token(token);
                        refreshed = true;
                        continue;
                    }
                }
                return Err(StoreError::Revoked);
            }
            if status == 429 || (500..600).contains(&status) {
                let wait = retry_after(&response);
                if attempt < MAX_ATTEMPTS {
                    drop(response);
                    tokio::time::sleep(retry_delay(attempt, wait)).await;
                    continue;
                }
                return Err(if status == 429 {
                    StoreError::RateLimited
                } else {
                    StoreError::Server(format!("dropbox returned status {status}"))
                });
            }
            return Ok(response);
        }
    }

    async fn read_capped(response: reqwest::Response, cap: usize) -> StoreResult<Vec<u8>> {
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| StoreError::Network(error.to_string()))?
        {
            if bytes.len() + chunk.len() > cap {
                return Err(StoreError::Server("dropbox response is too large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn refusal(response: reqwest::Response) -> Refusal {
        let status = response.status().as_u16();
        let bytes = Self::read_capped(response, 64 * 1024)
            .await
            .unwrap_or_default();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let summary = value
            .get("error_summary")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if status == 409 {
            classify(summary)
        } else {
            Refusal::Other(format!("dropbox returned status {status}"))
        }
    }

    async fn rpc(
        &self,
        route: &str,
        arg: &serde_json::Value,
    ) -> StoreResult<Result<serde_json::Value, Refusal>> {
        let response = self
            .send(&Call {
                url: format!("{}/{route}", self.api_base),
                arg: None,
                body: Body::Json(arg),
                timeout: Some(RPC_TIMEOUT),
            })
            .await?;
        if !response.status().is_success() {
            return Ok(Err(Self::refusal(response).await));
        }
        let bytes = Self::read_capped(response, MAX_SMALL_BYTES).await?;
        let value = serde_json::from_slice(&bytes)
            .map_err(|_| StoreError::Server(format!("dropbox {route} reply was unreadable")))?;
        Ok(Ok(value))
    }

    async fn upload_call(
        &self,
        route: &str,
        arg: &serde_json::Value,
        bytes: &[u8],
    ) -> StoreResult<Result<serde_json::Value, Refusal>> {
        let response = self
            .send(&Call {
                url: format!("{}/{route}", self.content_base),
                arg: Some(arg_header(arg)),
                body: Body::Bytes(bytes),
                timeout: Some(upload_timeout(bytes.len())),
            })
            .await?;
        if !response.status().is_success() {
            return Ok(Err(Self::refusal(response).await));
        }
        let bytes = Self::read_capped(response, MAX_SMALL_BYTES).await?;
        if bytes.is_empty() {
            return Ok(Ok(serde_json::Value::Null));
        }
        let value = serde_json::from_slice(&bytes)
            .map_err(|_| StoreError::Server(format!("dropbox {route} reply was unreadable")))?;
        Ok(Ok(value))
    }

    async fn download(&self, path_arg: &str) -> StoreResult<Result<reqwest::Response, Refusal>> {
        let response = self
            .send(&Call {
                url: format!("{}/files/download", self.content_base),
                arg: Some(arg_header(&serde_json::json!({ "path": path_arg }))),
                body: Body::None,
                timeout: None,
            })
            .await?;
        if !response.status().is_success() {
            return Ok(Err(Self::refusal(response).await));
        }
        Ok(Ok(response))
    }

    async fn download_any(
        &self,
        remote: &str,
        rev: Option<&str>,
    ) -> StoreResult<Option<reqwest::Response>> {
        if let Some(rev) = rev.filter(|rev| valid_rev(rev)) {
            match self.download(&format!("rev:{rev}")).await? {
                Ok(response) => return Ok(Some(response)),
                Err(Refusal::NotFound | Refusal::Rejected(_)) => {}
                Err(refusal) => return Err(refusal_error(refusal)),
            }
        }
        match self.download(remote).await? {
            Ok(response) => Ok(Some(response)),
            Err(Refusal::NotFound) => Ok(None),
            Err(refusal) => Err(refusal_error(refusal)),
        }
    }

    fn write_mode(mode: &WriteMode) -> (serde_json::Value, bool) {
        match mode {
            WriteMode::Add => (serde_json::json!("add"), true),
            WriteMode::Update(rev) => (serde_json::json!({".tag": "update", "update": rev}), true),
            WriteMode::Overwrite => (serde_json::json!("overwrite"), false),
        }
    }

    fn uploaded(
        value: &serde_json::Value,
        hash: ContentHash,
        size: u64,
        expected: &str,
    ) -> StoreResult<Uploaded> {
        let rev = value
            .get("rev")
            .and_then(serde_json::Value::as_str)
            .filter(|rev| valid_rev(rev))
            .ok_or_else(|| StoreError::Server("dropbox upload reply had no revision".into()))?;
        if let Some(stored) = value
            .get("content_hash")
            .and_then(serde_json::Value::as_str)
        {
            if stored != expected {
                return Err(StoreError::Verify(
                    "dropbox stored different bytes than were sent".into(),
                ));
            }
        }
        Ok(Uploaded {
            rev: rev.to_string(),
            hash,
            size,
        })
    }

    async fn upload_session(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        let mut file = tokio::fs::File::open(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        let started = self
            .upload_call(
                "files/upload_session/start",
                &serde_json::json!({"close": false}),
                &[],
            )
            .await?
            .map_err(refusal_error)?;
        let session_id = started
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                StoreError::Server("dropbox upload session reply was unreadable".into())
            })?
            .to_string();
        let mut hasher = ContentHasher::new();
        let mut dropbox = DropboxContentHasher::default();
        let mut offset: u64 = 0;
        loop {
            let chunk = read_full(&mut file, SESSION_CHUNK).await?;
            hasher.update(&chunk);
            dropbox.update(&chunk);
            if chunk.len() < SESSION_CHUNK {
                let size = offset + chunk.len() as u64;
                let finished = self
                    .upload_call(
                        "files/upload_session/finish",
                        &serde_json::json!({
                            "cursor": {"session_id": session_id, "offset": offset},
                            "commit": {"path": remote, "mode": "overwrite", "mute": true, "strict_conflict": false}
                        }),
                        &chunk,
                    )
                    .await?
                    .map_err(refusal_error)?;
                let hash = hasher.finish();
                return Self::uploaded(&finished, hash, size, &dropbox.finish());
            }
            self.upload_call(
                "files/upload_session/append_v2",
                &serde_json::json!({"cursor": {"session_id": session_id, "offset": offset}, "close": false}),
                &chunk,
            )
            .await?
            .map_err(refusal_error)?;
            offset += chunk.len() as u64;
        }
    }
}

async fn read_full(file: &mut tokio::fs::File, want: usize) -> StoreResult<Vec<u8>> {
    let mut buffer = vec![0_u8; want];
    let mut filled = 0;
    while filled < want {
        let read = file
            .read(&mut buffer[filled..])
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    buffer.truncate(filled);
    Ok(buffer)
}

fn remove_quietly(path: &Path) {
    let _ = std::fs::remove_file(path);
}

impl CloudStore for DropboxStore {
    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>> {
        let Some(response) = self.download_any(remote, None).await? else {
            return Ok(None);
        };
        let rev = response
            .headers()
            .get("Dropbox-API-Result")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .and_then(|value| {
                value
                    .get("rev")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .filter(|rev| valid_rev(rev))
            .ok_or_else(|| StoreError::Server("dropbox download reply had no revision".into()))?;
        let bytes = Self::read_capped(response, cap).await?;
        Ok(Some((bytes, rev)))
    }

    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>> {
        match self
            .rpc("files/get_metadata", &serde_json::json!({"path": remote}))
            .await?
        {
            Ok(value) => {
                if value.get(".tag").and_then(serde_json::Value::as_str) != Some("file") {
                    return Ok(None);
                }
                let rev = value
                    .get("rev")
                    .and_then(serde_json::Value::as_str)
                    .filter(|rev| valid_rev(rev))
                    .ok_or_else(|| StoreError::Server("dropbox metadata had no revision".into()))?;
                Ok(Some(RemoteMeta {
                    rev: rev.to_string(),
                    size: value
                        .get("size")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                }))
            }
            Err(Refusal::NotFound) => Ok(None),
            Err(refusal) => Err(refusal_error(refusal)),
        }
    }

    async fn fetch_to(
        &self,
        remote: &str,
        rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>> {
        let Some(mut response) = self.download_any(remote, rev).await? else {
            return Ok(None);
        };
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        let mut hasher = ContentHasher::new();
        let mut size: u64 = 0;
        let written = async {
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| StoreError::Network(error.to_string()))?
            {
                size += chunk.len() as u64;
                if size > limit {
                    return Err(StoreError::Verify(
                        "a file from dropbox is larger than its record".into(),
                    ));
                }
                hasher.update(&chunk);
                file.write_all(&chunk)
                    .await
                    .map_err(|error| StoreError::Io(error.to_string()))?;
            }
            file.flush()
                .await
                .map_err(|error| StoreError::Io(error.to_string()))?;
            file.sync_all()
                .await
                .map_err(|error| StoreError::Io(error.to_string()))?;
            Ok(())
        }
        .await;
        drop(file);
        if let Err(error) = written {
            remove_quietly(local);
            return Err(error);
        }
        Ok(Some(Fetched {
            hash: hasher.finish(),
            size,
        }))
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        let (mode_value, strict) = Self::write_mode(&mode);
        let mut dropbox = DropboxContentHasher::default();
        dropbox.update(&bytes);
        let size = bytes.len() as u64;
        let value = self
            .upload_call(
                "files/upload",
                &serde_json::json!({"path": remote, "mode": mode_value, "mute": true, "strict_conflict": strict}),
                &bytes,
            )
            .await?
            .map_err(refusal_error)?;
        Self::uploaded(&value, ContentHash::digest(&bytes), size, &dropbox.finish())
            .map(|uploaded| uploaded.rev)
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        let len = tokio::fs::metadata(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?
            .len();
        if len > SINGLE_UPLOAD_LIMIT {
            return self.upload_session(remote, local).await;
        }
        let bytes = tokio::fs::read(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        if bytes.len() as u64 > SINGLE_UPLOAD_LIMIT {
            return self.upload_session(remote, local).await;
        }
        let mut dropbox = DropboxContentHasher::default();
        dropbox.update(&bytes);
        let hash = ContentHash::digest(&bytes);
        let size = bytes.len() as u64;
        let value = self
            .upload_call(
                "files/upload",
                &serde_json::json!({"path": remote, "mode": "overwrite", "mute": true, "strict_conflict": false}),
                &bytes,
            )
            .await?
            .map_err(refusal_error)?;
        Self::uploaded(&value, hash, size, &dropbox.finish())
    }

    async fn delete(&self, remote: &str) -> StoreResult<()> {
        match self
            .rpc("files/delete_v2", &serde_json::json!({"path": remote}))
            .await?
        {
            Ok(_) | Err(Refusal::NotFound) => Ok(()),
            Err(refusal) => Err(refusal_error(refusal)),
        }
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        let mut page = match self
            .rpc(
                "files/list_folder",
                &serde_json::json!({"path": remote_dir, "recursive": false, "limit": 2000}),
            )
            .await?
        {
            Ok(page) => page,
            Err(Refusal::NotFound) => return Ok(Vec::new()),
            Err(refusal) => return Err(refusal_error(refusal)),
        };
        let mut entries = Vec::new();
        for _ in 0..MAX_LIST_PAGES {
            for entry in page
                .get("entries")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(name) = entry.get("name").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let tag = entry
                    .get(".tag")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                if tag == "deleted" {
                    continue;
                }
                entries.push(RemoteEntry {
                    name: name.to_string(),
                    folder: tag == "folder",
                });
            }
            if page.get("has_more").and_then(serde_json::Value::as_bool) != Some(true) {
                return Ok(entries);
            }
            let cursor = page
                .get("cursor")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| StoreError::Server("dropbox list reply was unreadable".into()))?
                .to_string();
            page = self
                .rpc(
                    "files/list_folder/continue",
                    &serde_json::json!({"cursor": cursor}),
                )
                .await?
                .map_err(refusal_error)?;
        }
        Err(StoreError::Server("dropbox listing is too long".into()))
    }

    async fn latest_cursor(&self, remote_dir: &str) -> StoreResult<Option<String>> {
        match self
            .rpc(
                "files/list_folder/get_latest_cursor",
                &serde_json::json!({"path": remote_dir, "recursive": true, "include_deleted": true}),
            )
            .await?
        {
            Ok(value) => Ok(value
                .get("cursor")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)),
            Err(Refusal::NotFound) => Ok(None),
            Err(refusal) => Err(refusal_error(refusal)),
        }
    }

    async fn changes(&self, cursor: &str) -> StoreResult<Changes> {
        let mut changes = Changes {
            paths: Vec::new(),
            cursor: cursor.to_string(),
        };
        for _ in 0..MAX_LIST_PAGES {
            let page = self
                .rpc(
                    "files/list_folder/continue",
                    &serde_json::json!({"cursor": changes.cursor}),
                )
                .await?
                .map_err(refusal_error)?;
            for entry in page
                .get("entries")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(path) = entry.get("path_lower").and_then(serde_json::Value::as_str) {
                    changes.paths.push(path.to_string());
                }
            }
            if let Some(next) = page.get("cursor").and_then(serde_json::Value::as_str) {
                next.clone_into(&mut changes.cursor);
            }
            if page.get("has_more").and_then(serde_json::Value::as_bool) != Some(true) {
                return Ok(changes);
            }
        }
        Err(StoreError::Reset)
    }
}

#[cfg(test)]
mod tests {
    use super::{arg_header, classify, valid_rev, DropboxContentHasher, Refusal};

    #[test]
    fn api_arg_escapes_everything_from_del_up_including_astral_characters() {
        let header = arg_header(&serde_json::json!({"path": "/p/files/café\u{7f}😀.tex"}));
        assert!(header.is_ascii());
        assert!(header.contains("\\u00e9"));
        assert!(header.contains("\\u007f"));
        assert!(header.contains("\\ud83d\\ude00"));
        let decoded: serde_json::Value = serde_json::from_str(&header).unwrap();
        assert_eq!(decoded["path"], "/p/files/café\u{7f}😀.tex");
    }

    #[test]
    fn dropbox_content_hash_matches_the_published_reference_rules() {
        let empty = DropboxContentHasher::default().finish();
        assert_eq!(
            empty,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        let block = vec![7_u8; 4 * 1024 * 1024 + 10];
        let mut whole = DropboxContentHasher::default();
        whole.update(&block);
        let mut split = DropboxContentHasher::default();
        split.update(&block[..3]);
        split.update(&block[3..4 * 1024 * 1024 + 1]);
        split.update(&block[4 * 1024 * 1024 + 1..]);
        assert_eq!(whole.finish(), split.finish());
    }

    #[test]
    fn refusals_are_classified_by_their_error_summary() {
        assert_eq!(classify("path/not_found/.."), Refusal::NotFound);
        assert_eq!(classify("path_lookup/not_found/"), Refusal::NotFound);
        assert_eq!(classify("path/conflict/file/.."), Refusal::Conflict);
        assert_eq!(classify("path/insufficient_space/.."), Refusal::QuotaFull);
        assert_eq!(classify("reset/.."), Refusal::Reset);
        assert_eq!(classify("too_many_write_operations/"), Refusal::RateLimited);
        assert!(matches!(
            classify("path/disallowed_name/"),
            Refusal::Rejected(_)
        ));
        assert!(matches!(
            classify("path/restricted_content/"),
            Refusal::Rejected(_)
        ));
        assert!(matches!(classify("something_new/"), Refusal::Other(_)));
    }

    #[test]
    fn revisions_must_look_like_dropbox_revisions() {
        assert!(valid_rev("a1c10ce0dd78"));
        assert!(!valid_rev("short"));
        assert!(!valid_rev("../../etc"));
        assert!(!valid_rev(&"a".repeat(65)));
    }
}
