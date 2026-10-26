use futures_util::future::BoxFuture;
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::{ContentHash, ContentHasher};
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const API_BASE: &str = "https://api.dropboxapi.com/2";
const CONTENT_BASE: &str = "https://content.dropboxapi.com/2";
const NOTIFY_BASE: &str = "https://notify.dropboxapi.com/2";
const TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
pub(crate) const SINGLE_UPLOAD_LIMIT: u64 = 8 * 1024 * 1024;
const SESSION_CHUNK: usize = 8 * 1024 * 1024;
const MAX_SMALL_BYTES: usize = 16 * 1024 * 1024;
const DROPBOX_BLOCK: usize = 4 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 4;
const MAX_LIST_PAGES: usize = 1_000;
const RPC_TIMEOUT: Duration = Duration::from_secs(60);
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);
const UPLOAD_CONCURRENCY: usize = 16;
const MAX_BATCH_ENTRIES: usize = 1_000;
const MAX_DELETE_ENTRIES: usize = 250;
const BATCH_JOB_WAIT: Duration = Duration::from_secs(300);
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
const COMMIT_TIME_PER_FILE: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StoreError {
    Revoked,
    Network(String),
    Server(String),
    Io(String),
    QuotaFull,
    RateLimited,
    TrafficLimit,
    Conflict,
    Rejected(String),
    Verify(String),
    Reset,
    /// The provider won't remove a folder this large in one call; the caller
    /// empties it piece by piece.
    FolderTooLarge,
}

impl StoreError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Revoked => "cloud.revoked",
            Self::Network(_) => "cloud.network",
            Self::Server(_) | Self::Reset | Self::Rejected(_) | Self::FolderTooLarge => {
                "cloud.server"
            }
            Self::Io(_) => "cloud.local_io",
            Self::QuotaFull => "cloud.quota_full",
            Self::RateLimited => "cloud.rate_limited",
            Self::TrafficLimit => "cloud.traffic_limit",
            Self::Conflict => "cloud.remote_busy",
            Self::Verify(_) => "cloud.verify_failed",
        }
    }

    pub(crate) fn ends_round(&self) -> bool {
        matches!(
            self,
            Self::Revoked | Self::Network(_) | Self::RateLimited | Self::TrafficLimit
        )
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
            Self::Revoked => formatter.write_str("cloud access was revoked"),
            Self::QuotaFull => formatter.write_str("the cloud storage is full"),
            Self::RateLimited => formatter.write_str("the cloud service asked to slow down"),
            Self::TrafficLimit => {
                formatter.write_str("the cloud service's upload limit was reached")
            }
            Self::Conflict => formatter.write_str("the remote record changed"),
            Self::Reset => formatter.write_str("the change cursor was reset"),
            Self::FolderTooLarge => {
                formatter.write_str("the folder holds too many files to remove at once")
            }
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BatchFile {
    pub(crate) remote: String,
    pub(crate) local: std::path::PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BatchDelete {
    pub(crate) remote: String,
    pub(crate) parent_rev: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BatchCopy {
    pub(crate) from: String,
    pub(crate) to: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Copied {
    pub(crate) rev: String,
    pub(crate) size: u64,
    pub(crate) content_hash: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct Changes {
    pub(crate) paths: Vec<String>,
    pub(crate) cursor: String,
}

/// Who the store belongs to, as the provider names them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AccountInfo {
    /// Stable for the account, and unique across providers.
    pub(crate) account_id: String,
    pub(crate) email: String,
    pub(crate) display_name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Space {
    pub(crate) used: u64,
    pub(crate) allocated: u64,
}

/// A revision as most providers write one: opaque, short and printable.
fn plain_rev(rev: &str) -> bool {
    !rev.is_empty() && rev.len() <= 256 && rev.bytes().all(|byte| byte.is_ascii_graphic())
}

/// The storage one provider offers sync. The engine works only through this,
/// so a provider is an implementation of it plus its sign-in; see
/// `provider.rs`. Calls with a default are optional: a provider without a
/// change feed, a quota or server-side copies leaves them out.
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
    async fn put_paths(
        &self,
        files: &[BatchFile],
        tick: &(dyn Fn() + Sync),
    ) -> Vec<StoreResult<Uploaded>> {
        let mut results = Vec::with_capacity(files.len());
        for file in files {
            results.push(self.put_path(&file.remote, &file.local).await);
            tick();
        }
        results
    }
    async fn fetch_zip(
        &self,
        _remote_dir: &str,
        _local: &Path,
        _limit: u64,
        _received: &(dyn Fn(u64) + Sync),
    ) -> StoreResult<bool> {
        Ok(false)
    }
    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()>;
    async fn delete_paths(&self, items: &[BatchDelete]) -> Vec<StoreResult<()>> {
        let mut results = Vec::with_capacity(items.len());
        for item in items {
            results.push(self.delete(&item.remote, item.parent_rev.as_deref()).await);
        }
        results
    }
    async fn copy_paths(&self, items: &[BatchCopy]) -> Vec<StoreResult<Copied>> {
        items
            .iter()
            .map(|_| Err(StoreError::Server("this store cannot copy".into())))
            .collect()
    }
    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>>;
    async fn latest_cursor(&self, remote_dir: &str) -> StoreResult<Option<String>>;
    async fn changes(&self, cursor: &str) -> StoreResult<Changes>;
    async fn account(&self) -> StoreResult<AccountInfo> {
        Err(StoreError::Server("this store has no account".into()))
    }
    /// Used and total bytes, or `None` when the provider has no quota to show.
    async fn space(&self) -> StoreResult<Option<Space>> {
        Ok(None)
    }
    /// Waits up to `timeout_secs` for a change after `cursor`. `None` means
    /// the provider can't wait for changes, and sync falls back to its timer.
    async fn wait_for_changes(
        &self,
        _cursor: &str,
        _timeout_secs: u64,
    ) -> StoreResult<Option<Waited>> {
        Ok(None)
    }
    /// Whether `rev` looks like a revision this provider hands out. A manifest
    /// entry with any other value is ignored.
    fn valid_rev(&self, rev: &str) -> bool {
        plain_rev(rev)
    }
    /// The hash a server-side copy of `local` reports, to check the copy
    /// against. `None` means copies can't be checked, so they aren't trusted
    /// and the file is uploaded instead.
    async fn copy_check_hash(&self, _local: &Path) -> Option<String> {
        None
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Endpoints {
    pub(crate) api: String,
    pub(crate) content: String,
    pub(crate) notify: String,
    pub(crate) token: String,
}

pub(crate) fn endpoints() -> Endpoints {
    #[cfg(test)]
    if let Some(endpoints) = test_endpoints::current() {
        return endpoints;
    }
    Endpoints {
        api: API_BASE.into(),
        content: CONTENT_BASE.into(),
        notify: NOTIFY_BASE.into(),
        token: TOKEN_URL.into(),
    }
}

#[cfg(test)]
pub(crate) mod test_endpoints {
    use super::Endpoints;
    use std::sync::Mutex;

    static OVERRIDE: Mutex<Option<Endpoints>> = Mutex::new(None);

    pub(crate) fn set(endpoints: Option<Endpoints>) {
        *OVERRIDE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = endpoints;
    }

    pub(crate) fn current() -> Option<Endpoints> {
        OVERRIDE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

fn client(read_timeout: Option<Duration>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent("Oleafly")
        .connect_timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(90));
    if let Some(read_timeout) = read_timeout {
        builder = builder.read_timeout(read_timeout);
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

// Downloads run for as long as bytes keep arriving, so a stalled one is caught
// by the read timeout. reqwest starts that timer when a request is created and
// keeps it running until the reply headers arrive, so on an upload it would cap
// sending the whole body at 60 seconds. Calls that carry their own total
// timeout use the client without one.
pub(crate) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| client(Some(STREAM_READ_TIMEOUT)))
}

fn timed_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| client(None))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Waited {
    pub(crate) changes: bool,
    pub(crate) backoff: Option<Duration>,
}

async fn dropbox_wait_for_changes(cursor: &str, timeout_secs: u64) -> StoreResult<Waited> {
    let timeout = timeout_secs.clamp(30, 480);
    let response = timed_http()
        .post(format!("{}/files/list_folder/longpoll", endpoints().notify))
        .timeout(Duration::from_secs(timeout + 120))
        .json(&serde_json::json!({ "cursor": cursor, "timeout": timeout }))
        .send()
        .await
        .map_err(|error| StoreError::Network(error.to_string()))?;
    let status = response.status().as_u16();
    if status == 429 {
        return Err(StoreError::RateLimited);
    }
    if status == 409 {
        return Err(match DropboxStore::refusal(response).await {
            Refusal::Reset => StoreError::Reset,
            refusal => refusal_error(refusal),
        });
    }
    if !response.status().is_success() {
        return Err(StoreError::Server(format!(
            "dropbox returned status {status}"
        )));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|error| StoreError::Network(error.to_string()))?;
    Ok(Waited {
        changes: value
            .get("changes")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        backoff: value
            .get("backoff")
            .and_then(serde_json::Value::as_u64)
            .map(Duration::from_secs),
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

fn dropbox_rev(rev: &str) -> bool {
    (9..=64).contains(&rev.len()) && rev.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) async fn dropbox_hash_of(path: &Path) -> Option<String> {
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut hasher = DropboxContentHasher::default();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(hasher.finish())
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
    TrafficLimit,
    TooManyFiles,
    Offset(u64),
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
    } else if summary.contains("upload_traffic_limit") {
        Refusal::TrafficLimit
    } else if summary.contains("too_many_write_operations") {
        Refusal::RateLimited
    } else if summary.contains("too_many_files") {
        Refusal::TooManyFiles
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
        Refusal::TrafficLimit => StoreError::TrafficLimit,
        Refusal::TooManyFiles => StoreError::FolderTooLarge,
        Refusal::Offset(_) => StoreError::Server("dropbox expected another upload offset".into()),
        Refusal::Rejected(summary) => StoreError::Rejected(summary),
        Refusal::Other(summary) => StoreError::Server(summary),
    }
}

fn correct_offset(error: &serde_json::Value) -> Option<u64> {
    match error {
        serde_json::Value::Object(fields) => fields
            .get("correct_offset")
            .and_then(serde_json::Value::as_u64)
            .or_else(|| fields.values().find_map(correct_offset)),
        _ => None,
    }
}

pub(crate) fn retry_delay(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(after) = retry_after {
        return after.min(MAX_RETRY_AFTER);
    }
    let base = 500_u64.saturating_mul(1 << attempt.min(6));
    let jitter = u64::from(rand::random::<u16>()) % 400;
    Duration::from_millis(base + jitter)
}

pub(crate) fn retry_after(response: &reqwest::Response) -> Option<Duration> {
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

pub(crate) fn transient(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request()
}

fn upload_timeout(len: usize) -> Duration {
    RPC_TIMEOUT + Duration::from_secs(u64::try_from(len / 32_768).unwrap_or(u64::MAX))
}

/// Gets a fresh access token, given the one Dropbox just refused.
pub(crate) type TokenRefresher =
    Arc<dyn Fn(String) -> BoxFuture<'static, StoreResult<String>> + Send + Sync>;

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
    timed: reqwest::Client,
    streaming: reqwest::Client,
}

impl DropboxStore {
    pub(crate) fn new(token: String, refresher: Option<TokenRefresher>) -> Self {
        let endpoints = endpoints();
        Self {
            api_base: endpoints.api,
            content_base: endpoints.content,
            token: Mutex::new(token),
            refresher,
            timed: timed_http().clone(),
            streaming: http().clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_read_timeout(
        token: String,
        refresher: Option<TokenRefresher>,
        read_timeout: Duration,
    ) -> Self {
        Self {
            streaming: client(Some(read_timeout)),
            ..Self::new(token, refresher)
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

    fn request(&self, call: &Call<'_>) -> reqwest::RequestBuilder {
        let client = if call.timeout.is_some() {
            &self.timed
        } else {
            &self.streaming
        };
        let mut request = client.post(&call.url).bearer_auth(self.token());
        if let Some(timeout) = call.timeout {
            request = request.timeout(timeout);
        }
        if let Some(arg) = &call.arg {
            request = request.header("Dropbox-API-Arg", arg);
        }
        match call.body {
            Body::None => request,
            Body::Json(value) => request.json(value),
            Body::Bytes(bytes) => request
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(bytes.to_vec()),
        }
    }

    async fn refreshed_once(&self, refreshed: &mut bool) -> StoreResult<bool> {
        if *refreshed {
            return Ok(false);
        }
        let Some(refresher) = &self.refresher else {
            return Ok(false);
        };
        let token = refresher(self.token()).await?;
        self.set_token(token);
        *refreshed = true;
        Ok(true)
    }

    async fn send(&self, call: &Call<'_>) -> StoreResult<reqwest::Response> {
        let mut refreshed = false;
        let mut attempt = 0;
        loop {
            attempt += 1;
            let response = match self.request(call).send().await {
                Ok(response) => response,
                Err(error) if attempt < MAX_ATTEMPTS && transient(&error) => {
                    tokio::time::sleep(retry_delay(attempt, None)).await;
                    continue;
                }
                Err(error) => return Err(StoreError::Network(error.to_string())),
            };
            let status = response.status().as_u16();
            if status == 401 {
                if self.refreshed_once(&mut refreshed).await? {
                    continue;
                }
                return Err(StoreError::Revoked);
            }
            if status != 429 && !(500..600).contains(&status) {
                return Ok(response);
            }
            if attempt < MAX_ATTEMPTS {
                let wait = retry_after(&response);
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
    }

    /// An account call made once. A lookup that fails is reported rather than
    /// retried, so a slow or broken reply doesn't hold up connecting or the
    /// settings tab; an expired token is still renewed once, like every call.
    async fn lookup(&self, route: &str, what: &str) -> StoreResult<serde_json::Value> {
        let null = serde_json::Value::Null;
        let call = Call {
            url: format!("{}/{route}", self.api_base),
            arg: None,
            body: Body::Json(&null),
            timeout: Some(LOOKUP_TIMEOUT),
        };
        let mut refreshed = false;
        loop {
            let response = self
                .request(&call)
                .send()
                .await
                .map_err(|error| StoreError::Network(error.to_string()))?;
            let status = response.status();
            if status.as_u16() == 401 {
                if self.refreshed_once(&mut refreshed).await? {
                    continue;
                }
                return Err(StoreError::Revoked);
            }
            let bytes = Self::read_capped(response, MAX_SMALL_BYTES).await?;
            if !status.is_success() {
                return Err(StoreError::Network(format!(
                    "dropbox {what} failed with status {status}"
                )));
            }
            return serde_json::from_slice(&bytes).map_err(|_| {
                StoreError::Network(format!("dropbox {what} returned an unreadable reply"))
            });
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
            if summary.contains("incorrect_offset") {
                if let Some(offset) = value.get("error").and_then(correct_offset) {
                    return Refusal::Offset(offset);
                }
            }
            return classify(summary);
        }
        let detail: String = if summary.is_empty() {
            String::from_utf8_lossy(&bytes)
                .chars()
                .filter(|character| !character.is_control())
                .take(200)
                .collect()
        } else {
            summary.chars().take(200).collect()
        };
        let detail = detail.trim();
        if detail.is_empty() {
            Refusal::Other(format!("dropbox returned status {status}"))
        } else {
            Refusal::Other(format!("dropbox returned status {status}: {detail}"))
        }
    }

    async fn rpc(
        &self,
        route: &str,
        arg: &serde_json::Value,
    ) -> StoreResult<Result<serde_json::Value, Refusal>> {
        self.rpc_within(route, arg, RPC_TIMEOUT).await
    }

    /// Sends `call`, waiting and trying again while Dropbox says it has too
    /// many writes in flight. That refusal means nothing was written.
    async fn send_writes(
        &self,
        call: &Call<'_>,
    ) -> StoreResult<Result<reqwest::Response, Refusal>> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let response = self.send(call).await?;
            if response.status().is_success() {
                return Ok(Ok(response));
            }
            let refusal = Self::refusal(response).await;
            if refusal != Refusal::RateLimited || attempt >= MAX_ATTEMPTS {
                return Ok(Err(refusal));
            }
            tokio::time::sleep(retry_delay(attempt, None)).await;
        }
    }

    async fn rpc_within(
        &self,
        route: &str,
        arg: &serde_json::Value,
        timeout: Duration,
    ) -> StoreResult<Result<serde_json::Value, Refusal>> {
        let response = match self
            .send_writes(&Call {
                url: format!("{}/{route}", self.api_base),
                arg: None,
                body: Body::Json(arg),
                timeout: Some(timeout),
            })
            .await?
        {
            Ok(response) => response,
            Err(refusal) => return Ok(Err(refusal)),
        };
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
        let response = match self
            .send_writes(&Call {
                url: format!("{}/{route}", self.content_base),
                arg: Some(arg_header(arg)),
                body: Body::Bytes(bytes),
                timeout: Some(upload_timeout(bytes.len())),
            })
            .await?
        {
            Ok(response) => response,
            Err(refusal) => return Ok(Err(refusal)),
        };
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
        if let Some(rev) = rev.filter(|rev| dropbox_rev(rev)) {
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
            .filter(|rev| dropbox_rev(rev))
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
            self.append(&session_id, offset, &chunk, false).await?;
            offset += chunk.len() as u64;
        }
    }

    async fn append(&self, id: &str, offset: u64, chunk: &[u8], close: bool) -> StoreResult<()> {
        let arg =
            serde_json::json!({"cursor": {"session_id": id, "offset": offset}, "close": close});
        match self
            .upload_call("files/upload_session/append_v2", &arg, chunk)
            .await?
        {
            Ok(_) => Ok(()),
            // A retry of an append that reached Dropbox but lost its reply:
            // Dropbox already holds these bytes, or already closed the session.
            Err(Refusal::Offset(correct)) if correct == offset + chunk.len() as u64 => Ok(()),
            Err(Refusal::Other(summary)) if close && summary.starts_with("closed") => Ok(()),
            Err(refusal) => Err(refusal_error(refusal)),
        }
    }
}

/// What tells a file changed while it was being read: its length and the time
/// it was last written.
pub(crate) async fn file_state(path: &Path) -> StoreResult<(u64, Option<std::time::SystemTime>)> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| StoreError::Io(error.to_string()))?;
    Ok((metadata.len(), metadata.modified().ok()))
}

struct OpenSession {
    id: String,
    size: u64,
    hash: ContentHash,
    dropbox: String,
}

fn tag_path(value: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    let mut current = value;
    while let Some(tag) = current.get(".tag").and_then(serde_json::Value::as_str) {
        parts.push(tag.to_string());
        match current.get(tag) {
            Some(next) if next.is_object() => current = next,
            _ => break,
        }
    }
    parts.join("/")
}

impl DropboxStore {
    async fn open_session(&self, local: &Path) -> StoreResult<OpenSession> {
        let before = file_state(local).await?;
        let length = before.0;
        let mut file = tokio::fs::File::open(local)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        let mut hasher = ContentHasher::new();
        let mut dropbox = DropboxContentHasher::default();
        let first = read_full(&mut file, SESSION_CHUNK).await?;
        hasher.update(&first);
        dropbox.update(&first);
        // Close with the last bytes, so a file of whole chunks needs no empty append.
        let mut closed = first.len() < SESSION_CHUNK || first.len() as u64 >= length;
        let started = self
            .upload_call(
                "files/upload_session/start",
                &serde_json::json!({ "close": closed }),
                &first,
            )
            .await?
            .map_err(refusal_error)?;
        let id = started
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                StoreError::Server("dropbox upload session reply was unreadable".into())
            })?
            .to_string();
        let mut offset = first.len() as u64;
        while !closed {
            let chunk = read_full(&mut file, SESSION_CHUNK).await?;
            hasher.update(&chunk);
            dropbox.update(&chunk);
            let next = offset + chunk.len() as u64;
            closed = chunk.len() < SESSION_CHUNK || next >= length;
            self.append(&id, offset, &chunk, closed).await?;
            offset = next;
        }
        if offset != length || file_state(local).await? != before {
            return Err(StoreError::Io(
                "the file changed while it was uploading".into(),
            ));
        }
        Ok(OpenSession {
            id,
            size: offset,
            hash: hasher.finish(),
            dropbox: dropbox.finish(),
        })
    }

    async fn finish_batch(
        &self,
        sessions: &[(&str, &OpenSession)],
    ) -> StoreResult<Vec<StoreResult<Uploaded>>> {
        let entries: Vec<serde_json::Value> = sessions
            .iter()
            .map(|(remote, session)| {
                serde_json::json!({
                    "cursor": {"session_id": session.id, "offset": session.size},
                    "commit": {"path": remote, "mode": "overwrite", "mute": true, "strict_conflict": false}
                })
            })
            .collect();
        // The commit is one synchronous call, so a large batch takes longer.
        let timeout = RPC_TIMEOUT
            + COMMIT_TIME_PER_FILE
                .saturating_mul(u32::try_from(sessions.len()).unwrap_or(u32::MAX));
        let reply = self
            .rpc_within(
                "files/upload_session/finish_batch_v2",
                &serde_json::json!({ "entries": entries }),
                timeout,
            )
            .await?
            .map_err(refusal_error)?;
        let results = reply
            .get("entries")
            .and_then(serde_json::Value::as_array)
            .filter(|results| results.len() == sessions.len())
            .ok_or_else(|| {
                StoreError::Server("dropbox batch commit reply was unreadable".into())
            })?;
        let mut finished = Vec::with_capacity(results.len());
        for (result, (remote, session)) in results.iter().zip(sessions) {
            if result.get(".tag").and_then(serde_json::Value::as_str) == Some("success") {
                finished.push(Self::uploaded(
                    result,
                    session.hash,
                    session.size,
                    &session.dropbox,
                ));
                continue;
            }
            let reason = tag_path(result.get("failure").unwrap_or(result));
            // A commit sent again after its reply was lost finds the session
            // used up. If the file Dropbox holds is this upload, it went in.
            let committed = if reason.starts_with("lookup_failed") {
                self.committed(remote, session).await
            } else {
                None
            };
            finished.push(committed.ok_or_else(|| refusal_error(classify(&reason))));
        }
        Ok(finished)
    }

    async fn committed(&self, remote: &str, session: &OpenSession) -> Option<Uploaded> {
        let value = self
            .rpc("files/get_metadata", &serde_json::json!({ "path": remote }))
            .await
            .ok()?
            .ok()?;
        let same = value.get(".tag").and_then(serde_json::Value::as_str) == Some("file")
            && value.get("size").and_then(serde_json::Value::as_u64) == Some(session.size)
            && value
                .get("content_hash")
                .and_then(serde_json::Value::as_str)
                == Some(session.dropbox.as_str());
        if !same {
            return None;
        }
        Self::uploaded(&value, session.hash, session.size, &session.dropbox).ok()
    }
}

impl DropboxStore {
    async fn batch_job(
        &self,
        launch: &str,
        check: &str,
        arg: &serde_json::Value,
        count: usize,
    ) -> StoreResult<Vec<serde_json::Value>> {
        let mut reply = self.rpc(launch, arg).await?.map_err(refusal_error)?;
        let job = reply
            .get("async_job_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        let deadline = tokio::time::Instant::now() + BATCH_JOB_WAIT;
        let mut wait = Duration::from_millis(250);
        loop {
            match reply.get(".tag").and_then(serde_json::Value::as_str) {
                Some("complete") => break,
                Some("async_job_id" | "in_progress") => {
                    let Some(job) = job.as_deref() else {
                        return Err(StoreError::Server("dropbox batch reply had no job".into()));
                    };
                    if tokio::time::Instant::now() >= deadline {
                        return Err(StoreError::Server(
                            "dropbox did not finish the batch in time".into(),
                        ));
                    }
                    tokio::time::sleep(wait).await;
                    wait = (wait * 2).min(Duration::from_secs(2));
                    reply = self
                        .rpc(check, &serde_json::json!({ "async_job_id": job }))
                        .await?
                        .map_err(refusal_error)?;
                }
                Some("failed") => {
                    return Err(refusal_error(classify(&tag_path(
                        reply.get("failed").unwrap_or(&reply),
                    ))));
                }
                _ => {
                    return Err(StoreError::Server(
                        "dropbox batch reply was unreadable".into(),
                    ))
                }
            }
        }
        reply
            .get("entries")
            .and_then(serde_json::Value::as_array)
            .filter(|results| results.len() == count)
            .cloned()
            .ok_or_else(|| StoreError::Server("dropbox batch reply was unreadable".into()))
    }

    async fn delete_batch(&self, items: &[BatchDelete]) -> StoreResult<Vec<StoreResult<()>>> {
        let entries: Vec<serde_json::Value> = items
            .iter()
            .map(|item| match &item.parent_rev {
                Some(rev) => serde_json::json!({"path": item.remote, "parent_rev": rev}),
                None => serde_json::json!({"path": item.remote}),
            })
            .collect();
        let results = self
            .batch_job(
                "files/delete_batch",
                "files/delete_batch/check",
                &serde_json::json!({ "entries": entries }),
                items.len(),
            )
            .await?;
        let mut done = Vec::with_capacity(items.len());
        for (result, item) in results.iter().zip(items) {
            done.push(
                match result.get(".tag").and_then(serde_json::Value::as_str) {
                    Some("success") => Ok(()),
                    _ => {
                        let refusal = classify(&tag_path(result.get("failure").unwrap_or(result)));
                        self.delete_refused(&item.remote, item.parent_rev.as_deref(), refusal)
                            .await
                    }
                },
            );
        }
        Ok(done)
    }

    async fn delete_refused(
        &self,
        remote: &str,
        parent_rev: Option<&str>,
        refusal: Refusal,
    ) -> StoreResult<()> {
        match (refusal, parent_rev) {
            (Refusal::NotFound, _) => Ok(()),
            (Refusal::RateLimited, _) => Err(StoreError::RateLimited),
            // A delete pinned to a revision is refused once another computer
            // replaced the file, and then the newer file stays. Any other
            // refusal leaves the file there, so it is still to be deleted.
            (refusal, Some(rev)) => match self.metadata(remote).await? {
                Some(meta) if meta.rev == rev => Err(refusal_error(refusal)),
                _ => Ok(()),
            },
            (refusal, None) => Err(refusal_error(refusal)),
        }
    }

    async fn copy_batch(&self, items: &[BatchCopy]) -> StoreResult<Vec<StoreResult<Copied>>> {
        let entries: Vec<serde_json::Value> = items
            .iter()
            .map(|item| serde_json::json!({"from_path": item.from, "to_path": item.to}))
            .collect();
        let results = self
            .batch_job(
                "files/copy_batch_v2",
                "files/copy_batch/check_v2",
                &serde_json::json!({ "entries": entries, "autorename": false }),
                items.len(),
            )
            .await?;
        Ok(results
            .iter()
            .map(
                |result| match result.get(".tag").and_then(serde_json::Value::as_str) {
                    Some("success") => copied(result.get("success").unwrap_or(result)),
                    _ => Err(refusal_error(classify(&tag_path(
                        result.get("failure").unwrap_or(result),
                    )))),
                },
            )
            .collect())
    }
}

fn copied(metadata: &serde_json::Value) -> StoreResult<Copied> {
    let rev = metadata
        .get("rev")
        .and_then(serde_json::Value::as_str)
        .filter(|rev| dropbox_rev(rev))
        .ok_or_else(|| StoreError::Server("dropbox copy reply had no revision".into()))?;
    Ok(Copied {
        rev: rev.to_string(),
        size: metadata
            .get("size")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        content_hash: metadata
            .get("content_hash")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    })
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

fn page_entries(page: &serde_json::Value) -> Vec<RemoteEntry> {
    page.get("entries")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(serde_json::Value::as_str)?;
            let tag = entry
                .get(".tag")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            (tag != "deleted").then(|| RemoteEntry {
                name: name.to_string(),
                folder: tag == "folder",
            })
        })
        .collect()
}

fn remove_quietly(path: &Path) {
    let _ = std::fs::remove_file(path);
}

pub(crate) async fn save_body(
    mut response: reqwest::Response,
    local: &Path,
    limit: u64,
    received: &(dyn Fn(u64) + Sync),
) -> StoreResult<Fetched> {
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
                    "a file from the cloud is larger than its record".into(),
                ));
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|error| StoreError::Io(error.to_string()))?;
            received(chunk.len() as u64);
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
    Ok(Fetched {
        hash: hasher.finish(),
        size,
    })
}

impl CloudStore for DropboxStore {
    async fn account(&self) -> StoreResult<AccountInfo> {
        let value = self
            .lookup("users/get_current_account", "account lookup")
            .await?;
        let text = |pointer: &str| {
            value
                .pointer(pointer)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        };
        let account_id = text("/account_id")
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                StoreError::Network("dropbox account lookup returned an unreadable reply".into())
            })?;
        Ok(AccountInfo {
            account_id,
            email: text("/email").unwrap_or_default(),
            display_name: text("/name/display_name").unwrap_or_default(),
        })
    }

    async fn space(&self) -> StoreResult<Option<Space>> {
        let value = self.lookup("users/get_space_usage", "space lookup").await?;
        let number = |pointer: &str| {
            value
                .pointer(pointer)
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
        };
        Ok(Some(Space {
            used: number("/used"),
            allocated: number("/allocation/allocated"),
        }))
    }

    async fn wait_for_changes(
        &self,
        cursor: &str,
        timeout_secs: u64,
    ) -> StoreResult<Option<Waited>> {
        dropbox_wait_for_changes(cursor, timeout_secs)
            .await
            .map(Some)
    }

    fn valid_rev(&self, rev: &str) -> bool {
        dropbox_rev(rev)
    }

    async fn copy_check_hash(&self, local: &Path) -> Option<String> {
        dropbox_hash_of(local).await
    }

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
            .filter(|rev| dropbox_rev(rev))
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
                    .filter(|rev| dropbox_rev(rev))
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
        let Some(response) = self.download_any(remote, rev).await? else {
            return Ok(None);
        };
        save_body(response, local, limit, &|_| {}).await.map(Some)
    }

    async fn fetch_zip(
        &self,
        remote_dir: &str,
        local: &Path,
        limit: u64,
        received: &(dyn Fn(u64) + Sync),
    ) -> StoreResult<bool> {
        let response = self
            .send(&Call {
                url: format!("{}/files/download_zip", self.content_base),
                arg: Some(arg_header(&serde_json::json!({ "path": remote_dir }))),
                body: Body::None,
                timeout: None,
            })
            .await?;
        if !response.status().is_success() {
            return match Self::refusal(response).await {
                Refusal::RateLimited => Err(StoreError::RateLimited),
                _ => Ok(false),
            };
        }
        if response
            .content_length()
            .is_some_and(|length| length > limit)
        {
            return Ok(false);
        }
        match save_body(response, local, limit, received).await {
            Ok(_) => Ok(true),
            Err(StoreError::Verify(_)) => Ok(false),
            Err(error) => Err(error),
        }
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

    async fn put_paths(
        &self,
        files: &[BatchFile],
        tick: &(dyn Fn() + Sync),
    ) -> Vec<StoreResult<Uploaded>> {
        let pending: Vec<_> = files
            .iter()
            .map(|file| async move {
                let opened = self.open_session(&file.local).await;
                tick();
                opened
            })
            .collect();
        let opened: Vec<StoreResult<OpenSession>> = stream::iter(pending)
            .buffered(UPLOAD_CONCURRENCY)
            .collect()
            .await;
        let mut results: Vec<Option<StoreResult<Uploaded>>> = Vec::with_capacity(files.len());
        let mut ready: Vec<(usize, &str, &OpenSession)> = Vec::new();
        for (index, opened) in opened.iter().enumerate() {
            match opened {
                Ok(session) => {
                    results.push(None);
                    ready.push((index, files[index].remote.as_str(), session));
                }
                Err(error) => results.push(Some(Err(error.clone()))),
            }
        }
        for batch in ready.chunks(MAX_BATCH_ENTRIES) {
            let mut waiting = batch.to_vec();
            for attempt in 1..=MAX_ATTEMPTS {
                let sessions: Vec<(&str, &OpenSession)> = waiting
                    .iter()
                    .map(|(_, remote, session)| (*remote, *session))
                    .collect();
                match self.finish_batch(&sessions).await {
                    Ok(finished) => {
                        // Dropbox refuses some commits when too many writes are
                        // in flight; their sessions are still open.
                        let mut again = Vec::new();
                        for (entry, result) in waiting.iter().zip(finished) {
                            match result {
                                Err(StoreError::RateLimited) if attempt < MAX_ATTEMPTS => {
                                    again.push(*entry);
                                }
                                result => results[entry.0] = Some(result),
                            }
                        }
                        if again.is_empty() {
                            break;
                        }
                        tokio::time::sleep(retry_delay(attempt, None)).await;
                        waiting = again;
                    }
                    Err(error) => {
                        for (index, _, _) in &waiting {
                            results[*index] = Some(Err(error.clone()));
                        }
                        break;
                    }
                }
            }
        }
        results
            .into_iter()
            .map(|result| {
                result.unwrap_or_else(|| Err(StoreError::Server("upload was not committed".into())))
            })
            .collect()
    }

    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()> {
        let mut arg = serde_json::json!({"path": remote});
        if let Some(rev) = parent_rev {
            arg["parent_rev"] = serde_json::Value::String(rev.to_string());
        }
        match self.rpc("files/delete_v2", &arg).await? {
            Ok(_) => Ok(()),
            Err(refusal) => self.delete_refused(remote, parent_rev, refusal).await,
        }
    }

    async fn delete_paths(&self, items: &[BatchDelete]) -> Vec<StoreResult<()>> {
        if let [item] = items {
            return vec![self.delete(&item.remote, item.parent_rev.as_deref()).await];
        }
        let mut results = Vec::with_capacity(items.len());
        for chunk in items.chunks(MAX_DELETE_ENTRIES) {
            match self.delete_batch(chunk).await {
                Ok(done) => results.extend(done),
                Err(error) => results.extend(chunk.iter().map(|_| Err(error.clone()))),
            }
        }
        results
    }

    async fn copy_paths(&self, items: &[BatchCopy]) -> Vec<StoreResult<Copied>> {
        if let [item] = items {
            let arg = serde_json::json!({"from_path": item.from, "to_path": item.to, "autorename": false});
            return vec![match self.rpc("files/copy_v2", &arg).await {
                Ok(Ok(value)) => copied(value.get("metadata").unwrap_or(&value)),
                Ok(Err(refusal)) => Err(refusal_error(refusal)),
                Err(error) => Err(error),
            }];
        }
        let mut results = Vec::with_capacity(items.len());
        for chunk in items.chunks(MAX_DELETE_ENTRIES) {
            match self.copy_batch(chunk).await {
                Ok(done) => results.extend(done),
                Err(error) => results.extend(chunk.iter().map(|_| Err(error.clone()))),
            }
        }
        results
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
            entries.extend(page_entries(&page));
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
    use super::{arg_header, classify, dropbox_rev, plain_rev, DropboxContentHasher, Refusal};

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
        assert!(dropbox_rev("a1c10ce0dd78"));
        assert!(!dropbox_rev("short"));
        assert!(!dropbox_rev("../../etc"));
        assert!(!dropbox_rev(&"a".repeat(65)));
        // Other providers hand out revisions of other shapes: generations,
        // quoted ETags, opaque ids. None of them may carry a space or be empty.
        assert!(plain_rev("1700000000000000"));
        assert!(plain_rev("\"d41d8cd98f00b204e9800998ecf8427e\""));
        assert!(!plain_rev(""));
        assert!(!plain_rev("a b"));
        assert!(!plain_rev(&"a".repeat(257)));
    }
}
