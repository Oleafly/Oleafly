//! Google Drive as a sync provider, with the `drive.file` scope: an `Oleafly`
//! folder in My Drive the person can see, holding the layout the Dropbox app
//! folder uses. Drive addresses files by id and lets names repeat, and its v3
//! API has no conditional write, so this store resolves paths through a cache
//! and emulates compare-and-swap with the file's revision history: it writes,
//! then checks that the revision before its own is the one it built on, and
//! if another write slipped in between it puts that write back on top and
//! reports a conflict. The engine's lineage check covers the moment between.

use super::store::{
    file_state, retry_after, retry_delay, save_body, transient, AccountInfo, Changes, CloudStore,
    Fetched, RemoteEntry, RemoteMeta, Space, StoreError, StoreResult, TokenRefresher, Uploaded,
    Waited, WriteMode,
};
use futures_util::stream::{self, StreamExt};
use oleafly_core::content::{ContentHash, ContentHasher};
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const FOLDER: &str = "application/vnd.google-apps.folder";
const ROOT_NAME: &str = "Oleafly";
const MAX_ATTEMPTS: u32 = 4;
const SIMPLE_UPLOAD_LIMIT: u64 = 5 * 1024 * 1024;
/// Resumable uploads go in pieces that are a multiple of 256 KiB.
const CHUNK: u64 = 8 * 1024 * 1024;
const MAX_REPLY_BYTES: usize = 16 * 1024 * 1024;
const MAX_LIST_PAGES: usize = 1_000;
/// The limit on a lookup or other small request. Downloads have none, and an
/// upload's grows with its size.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// How long a download may go without a byte before it counts as stalled.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
const UPLOAD_CONCURRENCY: usize = 6;
/// How often a wait for changes asks Drive, which has no long poll.
const CHANGE_POLL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DriveEndpoints {
    pub(crate) api: String,
    pub(crate) upload: String,
}

fn endpoints() -> DriveEndpoints {
    DriveEndpoints {
        api: "https://www.googleapis.com/drive/v3".into(),
        upload: "https://www.googleapis.com/upload/drive/v3".into(),
    }
}

#[derive(Clone, Debug)]
struct Item {
    id: String,
    folder: bool,
}

pub(crate) struct DriveStore {
    endpoints: DriveEndpoints,
    token: Mutex<String>,
    refresher: Option<TokenRefresher>,
    /// For calls with a total timeout. It has no read timeout: reqwest runs
    /// that from the start of a request until the reply's headers, so it
    /// would also cap the time to send an upload's body.
    timed: reqwest::Client,
    /// For downloads, which run as long as bytes keep coming. Its read
    /// timeout catches one that stalls.
    streaming: reqwest::Client,
    timeout: Duration,
    /// Store paths to the items they resolved to. A path that stops resolving
    /// is dropped and looked up again.
    paths: Mutex<HashMap<String, Item>>,
    /// Folder ids to their names, for mapping changes back to paths.
    names: Mutex<HashMap<String, String>>,
    /// Folders the upload batch in flight read in full, with every name found
    /// in each. A name that isn't there needs no lookup before it goes up. It
    /// holds only while that batch runs, so another computer's new files show
    /// up again in the next one.
    indexed: Mutex<HashMap<String, HashSet<String>>>,
}

enum Body {
    None,
    Json(Value),
    Bytes(Vec<u8>, &'static str),
}

fn escape(name: &str) -> String {
    name.replace('\\', "\\\\").replace('\'', "\\'")
}

fn parent_of(path: &str) -> (&str, &str) {
    match path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", path),
    }
}

fn normalize(remote: &str) -> String {
    remote.trim_matches('/').to_string()
}

impl DriveStore {
    pub(crate) fn new(token: String, refresher: Option<TokenRefresher>) -> Self {
        Self::at(endpoints(), token, refresher)
    }

    pub(crate) fn at(
        endpoints: DriveEndpoints,
        token: String,
        refresher: Option<TokenRefresher>,
    ) -> Self {
        Self::with_timeouts(
            endpoints,
            token,
            refresher,
            REQUEST_TIMEOUT,
            STREAM_READ_TIMEOUT,
        )
    }

    /// `request` limits each small request; `read` is how long a download
    /// may go without a byte.
    pub(crate) fn with_timeouts(
        endpoints: DriveEndpoints,
        token: String,
        refresher: Option<TokenRefresher>,
        request: Duration,
        read: Duration,
    ) -> Self {
        let client = |read: Option<Duration>| {
            // A resumable upload answers 308 for "send the next piece", which
            // must not be followed as a redirect.
            let mut builder = reqwest::Client::builder()
                .user_agent("Oleafly")
                .connect_timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none());
            if let Some(read) = read {
                builder = builder.read_timeout(read);
            }
            builder.build().unwrap_or_else(|_| reqwest::Client::new())
        };
        Self {
            endpoints,
            token: Mutex::new(token),
            refresher,
            timed: client(None),
            streaming: client(Some(read)),
            timeout: request,
            paths: Mutex::new(HashMap::new()),
            names: Mutex::new(HashMap::new()),
            indexed: Mutex::new(HashMap::new()),
        }
    }

    fn token(&self) -> String {
        self.token
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Swaps in a fresh token for `stale`, the one Drive refused. False when
    /// there's no way to get one.
    async fn renew(&self, stale: String) -> StoreResult<bool> {
        let Some(refresher) = &self.refresher else {
            return Ok(false);
        };
        let fresh = refresher(stale).await?;
        *self
            .token
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = fresh;
        Ok(true)
    }

    /// A body gets the time a small request has plus a second for every 32
    /// KiB in it, so an 8 MiB piece still goes up on a slow uplink.
    fn upload_timeout(&self, len: usize) -> Duration {
        self.timeout + Duration::from_secs(len as u64 / 32_768)
    }

    /// Sends a request, trying again on a dropped connection, a busy or
    /// failing Drive, and once with a fresh token. `timeout` is the limit on
    /// the whole call; `None` is for a download, which instead fails when it
    /// stalls.
    async fn send(
        &self,
        method: Method,
        url: &str,
        query: &[(&str, String)],
        body: &Body,
        extra: &[(&'static str, String)],
        timeout: Option<Duration>,
    ) -> StoreResult<reqwest::Response> {
        let mut refreshed = false;
        let mut attempt = 0;
        loop {
            attempt += 1;
            let token = self.token();
            let mut request = match timeout {
                Some(timeout) => self.timed.request(method.clone(), url).timeout(timeout),
                None => self.streaming.request(method.clone(), url),
            }
            .bearer_auth(&token)
            .query(query);
            for (name, value) in extra {
                request = request.header(*name, value);
            }
            request = match body {
                Body::None => request,
                Body::Json(value) => request.json(value),
                Body::Bytes(bytes, content_type) => request
                    .header(reqwest::header::CONTENT_TYPE, *content_type)
                    .body(bytes.clone()),
            };
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if attempt < MAX_ATTEMPTS && transient(&error) => {
                    tokio::time::sleep(retry_delay(attempt, None)).await;
                    continue;
                }
                Err(error) => return Err(StoreError::Network(error.to_string())),
            };
            if response.status().as_u16() == 401 {
                if !refreshed && self.renew(token).await? {
                    refreshed = true;
                    continue;
                }
                return Err(StoreError::Revoked);
            }
            if attempt < MAX_ATTEMPTS && retryable(&response) {
                let wait = retry_after(&response);
                drop(response);
                tokio::time::sleep(retry_delay(attempt, wait)).await;
                continue;
            }
            return Ok(response);
        }
    }

    async fn json(
        &self,
        method: Method,
        url: &str,
        query: &[(&str, String)],
        body: &Body,
    ) -> StoreResult<Option<Value>> {
        let response = self
            .send(method, url, query, body, &[], Some(self.timeout))
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let bytes = read_capped(response, MAX_REPLY_BYTES).await?;
        if bytes.is_empty() {
            return Ok(Some(Value::Null));
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| StoreError::Server("drive sent an unreadable reply".into()))
    }

    /// Children of `parents` named `name`, oldest first, across every copy of
    /// a folder two computers may have made at once.
    async fn children_named(&self, parents: &[String], name: &str) -> StoreResult<Vec<Item>> {
        let within = parents
            .iter()
            .map(|parent| format!("'{}' in parents", escape(parent)))
            .collect::<Vec<_>>()
            .join(" or ");
        let query = format!(
            "({within}) and name = '{}' and trashed = false",
            escape(name)
        );
        let value = self
            .json(
                Method::GET,
                &format!("{}/files", self.endpoints.api),
                &[
                    ("q", query),
                    ("orderBy", "createdTime".into()),
                    ("fields", "files(id,mimeType)".into()),
                    ("pageSize", "100".into()),
                    ("spaces", "drive".into()),
                ],
                &Body::None,
            )
            .await?
            .unwrap_or_default();
        Ok(value["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|file| {
                Some(Item {
                    id: file["id"].as_str()?.to_string(),
                    folder: file["mimeType"].as_str() == Some(FOLDER),
                })
            })
            .collect())
    }

    async fn create_folder(&self, parent: &str, name: &str) -> StoreResult<String> {
        let value = self
            .json(
                Method::POST,
                &format!("{}/files", self.endpoints.api),
                &[("fields", "id".into())],
                &Body::Json(json!({ "name": name, "mimeType": FOLDER, "parents": [parent] })),
            )
            .await?
            .unwrap_or_default();
        value["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| StoreError::Server("drive created a folder without an id".into()))
    }

    /// The `Oleafly` folder at the top of My Drive. With `drive.file` the app
    /// sees only folders it made, so it finds its own or makes one.
    async fn root(&self, create: bool) -> StoreResult<Option<Vec<String>>> {
        if let Some(item) = self.cached("") {
            return Ok(Some(vec![item.id]));
        }
        let mut found = self.children_named(&["root".into()], ROOT_NAME).await?;
        found.retain(|item| item.folder);
        if found.is_empty() {
            if !create {
                return Ok(None);
            }
            let made = self.create_folder("root", ROOT_NAME).await?;
            found = self
                .settle_folder(&["root".into()], ROOT_NAME, made)
                .await?;
        }
        let ids: Vec<String> = found.into_iter().map(|item| item.id).collect();
        self.remember("", &ids[0], true);
        Ok(Some(ids))
    }

    /// After making a folder, keeps the oldest of any that another computer
    /// made at the same moment, and removes this one if it isn't that.
    async fn settle_folder(
        &self,
        parents: &[String],
        name: &str,
        made: String,
    ) -> StoreResult<Vec<Item>> {
        let mut found = self.children_named(parents, name).await?;
        found.retain(|item| item.folder);
        if found.first().is_some_and(|oldest| oldest.id != made) {
            let _ = self.trash(&made).await;
            found.retain(|item| item.id != made);
        }
        if found.is_empty() {
            found.push(Item {
                id: made,
                folder: true,
            });
        }
        Ok(found)
    }

    fn cached(&self, path: &str) -> Option<Item> {
        self.paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(path)
            .cloned()
    }

    fn remember(&self, path: &str, id: &str, folder: bool) {
        self.paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                path.to_string(),
                Item {
                    id: id.to_string(),
                    folder,
                },
            );
        if folder {
            let (_, name) = parent_of(path);
            self.names
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(id.to_string(), name.to_string());
        }
    }

    fn forget(&self, path: &str) {
        let mut paths = self
            .paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let inside = format!("{path}/");
        paths.retain(|known, _| known != path && !known.starts_with(&inside));
        drop(paths);
        self.indexed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|known, _| known != path && !known.starts_with(&inside));
    }

    /// Whether the batch in flight read the folder at `parent` and found
    /// nothing named `name` in it.
    fn known_absent(&self, parent: &str, name: &str) -> bool {
        self.indexed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(parent)
            .is_some_and(|names| !names.contains(name))
    }

    /// Reads every child of the folder at `path` in one listing, so the files a
    /// batch puts there need no lookup each. False when it couldn't, and the
    /// files are looked up one by one as before.
    async fn index_folder(&self, path: &str) -> StoreResult<bool> {
        let Some(parents) = self.folders(path, false).await? else {
            return Ok(false);
        };
        let within = parents
            .iter()
            .map(|parent| format!("'{}' in parents", escape(parent)))
            .collect::<Vec<_>>()
            .join(" or ");
        let mut children: Vec<(String, Item)> = Vec::new();
        let mut token: Option<String> = None;
        let mut whole = false;
        for _ in 0..MAX_LIST_PAGES {
            let mut query = vec![
                ("q", format!("({within}) and trashed = false")),
                ("orderBy", "createdTime".to_string()),
                (
                    "fields",
                    "nextPageToken,files(id,name,mimeType)".to_string(),
                ),
                ("pageSize", "1000".to_string()),
                ("spaces", "drive".to_string()),
            ];
            if let Some(token) = &token {
                query.push(("pageToken", token.clone()));
            }
            let value = self
                .json(
                    Method::GET,
                    &format!("{}/files", self.endpoints.api),
                    &query,
                    &Body::None,
                )
                .await?
                .unwrap_or_default();
            for file in value["files"].as_array().into_iter().flatten() {
                let (Some(name), Some(id)) = (file["name"].as_str(), file["id"].as_str()) else {
                    continue;
                };
                let item = Item {
                    id: id.to_string(),
                    folder: file["mimeType"].as_str() == Some(FOLDER),
                };
                children.push((name.to_string(), item));
            }
            match value["nextPageToken"].as_str() {
                Some(next) => token = Some(next.to_string()),
                None => {
                    whole = true;
                    break;
                }
            }
        }
        if !whole {
            return Ok(false);
        }
        // Oldest first, as a lookup by name picks. A name used by a file and a
        // folder both stays out of the cache and is looked up as before.
        let mut oldest: BTreeMap<&str, (Option<&Item>, Option<&Item>)> = BTreeMap::new();
        for (name, item) in &children {
            let entry = oldest.entry(name.as_str()).or_default();
            let slot = if item.folder {
                &mut entry.1
            } else {
                &mut entry.0
            };
            slot.get_or_insert(item);
        }
        for (name, kinds) in &oldest {
            let child = if path.is_empty() {
                (*name).to_string()
            } else {
                format!("{path}/{name}")
            };
            let only = match kinds {
                (Some(item), None) | (None, Some(item)) => item,
                _ => continue,
            };
            if self.cached(&child).is_none() {
                self.remember(&child, &only.id, only.folder);
            }
        }
        let names = oldest.keys().map(|name| (*name).to_string()).collect();
        self.indexed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(path.to_string(), names);
        Ok(true)
    }

    /// Readies a batch: makes its missing folders a level at a time, so files
    /// landing in the same new folder at once never each make it, then reads
    /// each folder it writes into once. Returns the folders it read.
    async fn prepare(&self, files: &[super::store::BatchFile]) -> Vec<String> {
        let parents: BTreeSet<String> = files
            .iter()
            .map(|file| parent_of(&normalize(&file.remote)).0.to_string())
            .collect();
        let mut levels: BTreeMap<usize, BTreeSet<String>> = BTreeMap::new();
        for parent in &parents {
            let mut walked = String::new();
            for (depth, segment) in parent.split('/').filter(|s| !s.is_empty()).enumerate() {
                if !walked.is_empty() {
                    walked.push('/');
                }
                walked.push_str(segment);
                levels.entry(depth).or_default().insert(walked.clone());
            }
        }
        // A folder that can't be made here fails its own files' uploads, which
        // report why.
        let _ = self.root(true).await;
        for level in levels.into_values() {
            let pending: Vec<_> = level.iter().map(|path| self.folders(path, true)).collect();
            let _: Vec<_> = stream::iter(pending)
                .buffer_unordered(UPLOAD_CONCURRENCY)
                .collect()
                .await;
        }
        let pending: Vec<_> = parents
            .iter()
            .map(|path| async move {
                matches!(self.index_folder(path).await, Ok(true)).then(|| path.clone())
            })
            .collect();
        stream::iter(pending)
            .buffer_unordered(UPLOAD_CONCURRENCY)
            .filter_map(|indexed| async move { indexed })
            .collect()
            .await
    }

    fn unindex(&self, folders: &[String]) {
        let mut indexed = self
            .indexed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for folder in folders {
            indexed.remove(folder);
        }
    }

    /// Every copy of the folder at `path`, oldest first, made on the way if
    /// `create` and missing. `None` when it doesn't exist.
    async fn folders(&self, path: &str, create: bool) -> StoreResult<Option<Vec<String>>> {
        let Some(mut current) = self.root(create).await? else {
            return Ok(None);
        };
        if path.is_empty() {
            return Ok(Some(current));
        }
        let mut walked = String::new();
        for segment in path.split('/') {
            if !walked.is_empty() {
                walked.push('/');
            }
            walked.push_str(segment);
            if let Some(item) = self.cached(&walked).filter(|item| item.folder) {
                current = vec![item.id];
                continue;
            }
            let mut found = self.children_named(&current, segment).await?;
            found.retain(|item| item.folder);
            if found.is_empty() {
                if !create {
                    return Ok(None);
                }
                let made = self.create_folder(&current[0], segment).await?;
                found = self.settle_folder(&current, segment, made).await?;
            }
            self.remember(&walked, &found[0].id, true);
            current = found.into_iter().map(|item| item.id).collect();
        }
        Ok(Some(current))
    }

    /// The file at `path`, the oldest when names repeat.
    async fn file(&self, path: &str) -> StoreResult<Option<String>> {
        if let Some(item) = self.cached(path).filter(|item| !item.folder) {
            return Ok(Some(item.id));
        }
        let (parent, name) = parent_of(path);
        if self.known_absent(parent, name) {
            return Ok(None);
        }
        let Some(parents) = self.folders(parent, false).await? else {
            return Ok(None);
        };
        let found = self.children_named(&parents, name).await?;
        let Some(item) = found.into_iter().find(|item| !item.folder) else {
            return Ok(None);
        };
        self.remember(path, &item.id, false);
        Ok(Some(item.id))
    }

    async fn head(&self, id: &str) -> StoreResult<Option<RemoteMeta>> {
        let Some(value) = self
            .json(
                Method::GET,
                &format!("{}/files/{id}", self.endpoints.api),
                &[("fields", "headRevisionId,size,trashed".into())],
                &Body::None,
            )
            .await?
        else {
            return Ok(None);
        };
        if value["trashed"].as_bool() == Some(true) {
            return Ok(None);
        }
        Ok(Some(RemoteMeta {
            rev: value["headRevisionId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            size: value["size"]
                .as_str()
                .and_then(|size| size.parse().ok())
                .unwrap_or(0),
        }))
    }

    async fn trash(&self, id: &str) -> StoreResult<()> {
        self.json(
            Method::PATCH,
            &format!("{}/files/{id}", self.endpoints.api),
            &[("fields", "id".into())],
            &Body::Json(json!({ "trashed": true })),
        )
        .await
        .map(|_| ())
    }

    async fn download(
        &self,
        id: &str,
        rev: Option<&str>,
    ) -> StoreResult<Option<reqwest::Response>> {
        let url = match rev {
            Some(rev) => format!("{}/files/{id}/revisions/{rev}", self.endpoints.api),
            None => format!("{}/files/{id}", self.endpoints.api),
        };
        // No total timeout: a large file takes as long as the link needs.
        let response = self
            .send(
                Method::GET,
                &url,
                &[("alt", "media".into())],
                &Body::None,
                &[],
                None,
            )
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        Ok(Some(response))
    }

    /// Writes `content` as the new content of `id`, or as a new file named
    /// `name` in `parent`, and returns the id and its new head revision.
    async fn upload(
        &self,
        target: Upload<'_>,
        content: Content<'_>,
    ) -> StoreResult<(String, String)> {
        let fields = ("fields", "id,headRevisionId".to_string());
        let response = match content {
            Content::Memory(bytes) if bytes.len() as u64 <= SIMPLE_UPLOAD_LIMIT => match target {
                Upload::Update(id) => {
                    let timeout = self.upload_timeout(bytes.len());
                    self.send(
                        Method::PATCH,
                        &format!("{}/files/{id}", self.endpoints.upload),
                        &[("uploadType", "media".into()), fields],
                        &Body::Bytes(bytes, "application/octet-stream"),
                        &[],
                        Some(timeout),
                    )
                    .await?
                }
                Upload::Create { parent, name } => {
                    let boundary = "oleafly-drive-upload-boundary";
                    let mut body = format!(
                        "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n",
                        json!({ "name": name, "parents": [parent] })
                    )
                    .into_bytes();
                    body.extend_from_slice(&bytes);
                    body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
                    let timeout = self.upload_timeout(body.len());
                    self.send(
                        Method::POST,
                        &format!("{}/files", self.endpoints.upload),
                        &[("uploadType", "multipart".into()), fields],
                        &Body::Bytes(
                            body,
                            "multipart/related; boundary=oleafly-drive-upload-boundary",
                        ),
                        &[],
                        Some(timeout),
                    )
                    .await?
                }
            },
            content => self.resumable(target, content).await?,
        };
        if !response.status().is_success() {
            return Err(failure(response).await);
        }
        let value: Value =
            serde_json::from_slice(&read_capped(response, MAX_REPLY_BYTES).await?)
                .map_err(|_| StoreError::Server("drive sent an unreadable upload reply".into()))?;
        match (value["id"].as_str(), value["headRevisionId"].as_str()) {
            (Some(id), Some(rev)) => Ok((id.to_string(), rev.to_string())),
            _ => Err(StoreError::Server(
                "drive didn't say which version it wrote".into(),
            )),
        }
    }

    async fn resumable(
        &self,
        target: Upload<'_>,
        mut content: Content<'_>,
    ) -> StoreResult<reqwest::Response> {
        let total = content.size();
        let (method, url, metadata) = match target {
            Upload::Update(id) => (
                Method::PATCH,
                format!("{}/files/{id}", self.endpoints.upload),
                json!({}),
            ),
            Upload::Create { parent, name } => (
                Method::POST,
                format!("{}/files", self.endpoints.upload),
                json!({ "name": name, "parents": [parent] }),
            ),
        };
        let started = self
            .send(
                method,
                &url,
                &[
                    ("uploadType", "resumable".into()),
                    ("fields", "id,headRevisionId".into()),
                ],
                &Body::Json(metadata),
                &[("x-upload-content-length", total.to_string())],
                Some(self.timeout),
            )
            .await?;
        if !started.status().is_success() {
            return Err(failure(started).await);
        }
        let session = started
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| StoreError::Server("drive didn't open an upload session".into()))?;
        // Each piece is read at the offset Drive asks for next. Drive may keep
        // only part of a piece, and after a failed one it is asked how much it
        // has, so a piece sent again starts where Drive stands.
        let mut offset = 0;
        let mut tries = 0;
        loop {
            tries += 1;
            let last = tries >= MAX_ATTEMPTS;
            let len = (total - offset).min(CHUNK);
            let piece = content.piece(offset, len).await?;
            let end = offset + len;
            if end == total {
                // The last piece makes the file on Drive, so a file that
                // changed while it went up fails here, before Drive keeps a
                // mix of two versions.
                content.unchanged().await?;
            }
            let token = self.token();
            // Ok holds the offset Drive asked for; Err the wait before asking
            // Drive where a failed piece left the upload.
            let kept_or_wait = match self.put_piece(&session, &token, piece, offset, total).await {
                Ok(response) if response.status().as_u16() == 308 => {
                    Ok(kept(&response, end, total)?)
                }
                Ok(response) if last => return Ok(response),
                Ok(response) if response.status().as_u16() == 401 => {
                    drop(response);
                    if !self.renew(token).await? {
                        return Err(StoreError::Revoked);
                    }
                    Err(Duration::ZERO)
                }
                Ok(response) if retryable(&response) => {
                    Err(retry_delay(tries, retry_after(&response)))
                }
                Ok(response) => return Ok(response),
                Err(error) if !last && transient(&error) => Err(retry_delay(tries, None)),
                Err(error) => return Err(StoreError::Network(error.to_string())),
            };
            let next = match kept_or_wait {
                Ok(next) => next,
                Err(wait) => {
                    tokio::time::sleep(wait).await;
                    // Drive may have kept some of the piece, or all of it
                    // with only the reply lost.
                    match self.standing(&session, end, total).await? {
                        Standing::At(next) => next,
                        Standing::Done(response) => return Ok(response),
                    }
                }
            };
            if next > offset {
                tries = 0;
            } else if last {
                return Err(StoreError::Server("drive stopped taking the upload".into()));
            }
            offset = next;
        }
    }

    /// Sends one piece of a resumable upload, once, moving its bytes into the
    /// request. A failure is followed by asking Drive how much it kept, not
    /// by sending the same bytes again.
    async fn put_piece(
        &self,
        session: &str,
        token: &str,
        piece: Vec<u8>,
        offset: u64,
        total: u64,
    ) -> reqwest::Result<reqwest::Response> {
        let last = offset + piece.len() as u64 - 1;
        self.timed
            .put(session)
            .timeout(self.upload_timeout(piece.len()))
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .header(
                reqwest::header::CONTENT_RANGE,
                format!("bytes {offset}-{last}/{total}"),
            )
            .body(piece)
            .send()
            .await
    }

    /// Asks Drive how much of an interrupted upload it has. `sent` is the end
    /// of the furthest piece sent.
    async fn standing(&self, session: &str, sent: u64, total: u64) -> StoreResult<Standing> {
        let response = self
            .send(
                Method::PUT,
                session,
                &[],
                &Body::Bytes(Vec::new(), "application/octet-stream"),
                &[("content-range", format!("bytes */{total}"))],
                Some(self.timeout),
            )
            .await?;
        match response.status().as_u16() {
            308 => kept(&response, sent, total).map(Standing::At),
            200 | 201 => Ok(Standing::Done(response)),
            _ => Err(failure(response).await),
        }
    }

    /// The revisions of `id`, oldest first.
    async fn revisions(&self, id: &str) -> StoreResult<Vec<String>> {
        let mut revisions = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let mut query = vec![
                ("fields", "nextPageToken,revisions(id)".to_string()),
                ("pageSize", "1000".to_string()),
            ];
            if let Some(token) = &token {
                query.push(("pageToken", token.clone()));
            }
            let value = self
                .json(
                    Method::GET,
                    &format!("{}/files/{id}/revisions", self.endpoints.api),
                    &query,
                    &Body::None,
                )
                .await?
                .unwrap_or_default();
            revisions.extend(
                value["revisions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|revision| revision["id"].as_str().map(str::to_string)),
            );
            match value["nextPageToken"].as_str() {
                Some(next) => token = Some(next.to_string()),
                None => return Ok(revisions),
            }
        }
        Err(StoreError::Server(
            "drive's revision list never ended".into(),
        ))
    }

    /// Compare-and-swap on a file: writes only if its head is `expected`, and
    /// undoes a write that raced another one.
    async fn swap(
        &self,
        path: &str,
        id: &str,
        expected: &str,
        bytes: Vec<u8>,
    ) -> StoreResult<String> {
        let current = self.head(id).await?.ok_or(StoreError::Conflict)?;
        if current.rev != expected {
            return Err(StoreError::Conflict);
        }
        let (_, written) = self
            .upload(Upload::Update(id), Content::Memory(bytes))
            .await?;
        let revisions = self.revisions(id).await?;
        let Some(position) = revisions.iter().position(|revision| *revision == written) else {
            self.forget(path);
            return Err(StoreError::Conflict);
        };
        let before = position
            .checked_sub(1)
            .map(|index| revisions[index].as_str());
        if before == Some(expected) {
            return Ok(written);
        }
        // Another computer wrote between the check and this write. While this
        // write is still the newest, put that one back on top, so neither is
        // lost: the engine reruns the round and merges both. A write that
        // already followed this one is left alone.
        let theirs = before.filter(|_| position + 1 == revisions.len());
        if let Some(theirs) = theirs {
            if let Some(response) = self.download(id, Some(theirs)).await? {
                let restored = read_capped(response, MAX_REPLY_BYTES).await?;
                let _ = self
                    .upload(Upload::Update(id), Content::Memory(restored))
                    .await;
            }
        }
        Err(StoreError::Conflict)
    }

    /// Create-if-absent. Names can repeat in Drive, so after creating, the
    /// oldest file of that name wins and a later one is removed again.
    async fn create_once(&self, path: &str, bytes: Vec<u8>) -> StoreResult<String> {
        let (parent, name) = parent_of(path);
        let parents = self
            .folders(parent, true)
            .await?
            .ok_or_else(|| StoreError::Server("drive couldn't make the folder".into()))?;
        if self
            .children_named(&parents, name)
            .await?
            .iter()
            .any(|item| !item.folder)
        {
            return Err(StoreError::Conflict);
        }
        let (id, rev) = self
            .upload(
                Upload::Create {
                    parent: &parents[0],
                    name,
                },
                Content::Memory(bytes),
            )
            .await?;
        let files: Vec<Item> = self
            .children_named(&parents, name)
            .await?
            .into_iter()
            .filter(|item| !item.folder)
            .collect();
        if files.first().is_some_and(|oldest| oldest.id != id) {
            let _ = self.trash(&id).await;
            return Err(StoreError::Conflict);
        }
        self.remember(path, &id, false);
        Ok(rev)
    }

    async fn write(&self, path: &str, bytes: Vec<u8>, mode: &WriteMode) -> StoreResult<String> {
        match mode {
            WriteMode::Add => self.create_once(path, bytes).await,
            WriteMode::Update(expected) => {
                let id = self.file(path).await?.ok_or(StoreError::Conflict)?;
                self.swap(path, &id, expected, bytes).await
            }
            WriteMode::Overwrite => self.overwrite(path, Content::Memory(bytes)).await,
        }
    }

    /// Writes `content` at `path`, over whatever is there.
    async fn overwrite(&self, path: &str, content: Content<'_>) -> StoreResult<String> {
        match self.file(path).await? {
            Some(id) => match self.upload(Upload::Update(&id), content).await {
                Ok((_, rev)) => Ok(rev),
                Err(error) => {
                    self.forget(path);
                    Err(error)
                }
            },
            None => {
                let (parent, name) = parent_of(path);
                let parents = self
                    .folders(parent, true)
                    .await?
                    .ok_or_else(|| StoreError::Server("drive couldn't make the folder".into()))?;
                let (id, rev) = self
                    .upload(
                        Upload::Create {
                            parent: &parents[0],
                            name,
                        },
                        content,
                    )
                    .await?;
                self.remember(path, &id, false);
                Ok(rev)
            }
        }
    }

    async fn folder_name(&self, id: &str) -> Option<String> {
        if let Some(name) = self
            .names
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
        {
            return Some(name.clone());
        }
        let value = self
            .json(
                Method::GET,
                &format!("{}/files/{id}", self.endpoints.api),
                &[("fields", "name".into())],
                &Body::None,
            )
            .await
            .ok()
            .flatten()?;
        let name = value["name"].as_str()?.to_string();
        self.names
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id.to_string(), name.clone());
        Some(name)
    }

    async fn change_page(
        &self,
        cursor: &str,
    ) -> StoreResult<(Vec<Value>, Option<String>, Option<String>)> {
        let value = self
            .json(
                Method::GET,
                &format!("{}/changes", self.endpoints.api),
                &[
                    ("pageToken", cursor.to_string()),
                    ("spaces", "drive".into()),
                    ("pageSize", "1000".into()),
                    (
                        "fields",
                        "nextPageToken,newStartPageToken,changes(fileId,removed,file(name,parents,trashed))"
                            .into(),
                    ),
                ],
                &Body::None,
            )
            .await?
            .ok_or(StoreError::Reset)?;
        Ok((
            value["changes"].as_array().cloned().unwrap_or_default(),
            value["nextPageToken"].as_str().map(str::to_string),
            value["newStartPageToken"].as_str().map(str::to_string),
        ))
    }
}

#[derive(Clone, Copy)]
enum Upload<'a> {
    Update(&'a str),
    Create { parent: &'a str, name: &'a str },
}

/// What an upload sends: bytes in memory, or a file read from disk a piece at
/// a time.
enum Content<'a> {
    Memory(Vec<u8>),
    File(&'a mut LocalFile),
}

impl Content<'_> {
    fn size(&self) -> u64 {
        match self {
            Self::Memory(bytes) => bytes.len() as u64,
            Self::File(file) => file.size(),
        }
    }

    async fn piece(&mut self, offset: u64, len: u64) -> StoreResult<Vec<u8>> {
        match self {
            Self::Memory(bytes) => {
                let start = offset as usize;
                Ok(bytes[start..start + len as usize].to_vec())
            }
            Self::File(file) => file.piece(offset, len).await,
        }
    }

    async fn unchanged(&self) -> StoreResult<()> {
        match self {
            Self::Memory(_) => Ok(()),
            Self::File(file) => file.unchanged().await,
        }
    }
}

/// A file that goes up straight from disk, so it never has to fit in memory.
/// Each piece is read at the offset Drive asks for, and each byte goes into
/// the hash once, in order, the first time it is read.
struct LocalFile {
    file: tokio::fs::File,
    path: PathBuf,
    state: (u64, Option<SystemTime>),
    hasher: ContentHasher,
    hashed: u64,
}

impl LocalFile {
    async fn open(path: &Path) -> StoreResult<Self> {
        let state = file_state(path).await?;
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        Ok(Self {
            file,
            path: path.to_path_buf(),
            state,
            hasher: ContentHasher::new(),
            hashed: 0,
        })
    }

    fn size(&self) -> u64 {
        self.state.0
    }

    async fn piece(&mut self, offset: u64, len: u64) -> StoreResult<Vec<u8>> {
        let mut piece = vec![0; len as usize];
        self.file
            .seek(SeekFrom::Start(offset))
            .await
            .map_err(|error| StoreError::Io(error.to_string()))?;
        self.file.read_exact(&mut piece).await.map_err(|error| {
            // The file is shorter than when the upload began.
            if error.kind() == std::io::ErrorKind::UnexpectedEof {
                changed_while_read()
            } else {
                StoreError::Io(error.to_string())
            }
        })?;
        // A piece sent again after Drive kept only part of one starts among
        // bytes already hashed.
        let seen = usize::try_from(self.hashed.saturating_sub(offset))
            .unwrap_or(usize::MAX)
            .min(piece.len());
        self.hasher.update(&piece[seen..]);
        self.hashed = self.hashed.max(offset + len);
        Ok(piece)
    }

    /// Fails when the file is no longer the one the upload began with.
    async fn unchanged(&self) -> StoreResult<()> {
        if file_state(&self.path).await? != self.state {
            return Err(changed_while_read());
        }
        Ok(())
    }

    /// The hash of the whole file, once every byte of it has been read.
    fn finish(&self) -> StoreResult<ContentHash> {
        if self.hashed != self.size() {
            return Err(StoreError::Server(
                "drive ended an upload before it had every byte".into(),
            ));
        }
        Ok(self.hasher.finish())
    }
}

fn changed_while_read() -> StoreError {
    StoreError::Io("the file changed while it was read".into())
}

/// Where an interrupted resumable upload stands.
enum Standing {
    /// Drive has every byte before this offset.
    At(u64),
    /// Drive has the whole file, and the reply says what it wrote.
    Done(reqwest::Response),
}

/// Where a resumable upload goes on from after Drive's 308: one past the last
/// byte in its Range header, or the start when it has none of the file yet.
/// `sent` is the end of the furthest piece sent.
fn kept(response: &reqwest::Response, sent: u64, total: u64) -> StoreResult<u64> {
    let next = match response.headers().get(reqwest::header::RANGE) {
        None => Some(0),
        Some(range) => range
            .to_str()
            .ok()
            .and_then(|range| range.strip_prefix("bytes=0-"))
            .and_then(|last| last.trim().parse::<u64>().ok())
            .and_then(|last| last.checked_add(1)),
    };
    // Drive can't hold more than it was sent, and a 308 means it lacks some.
    next.filter(|next| *next <= sent && *next < total)
        .ok_or_else(|| StoreError::Server("drive reported an upload range that doesn't fit".into()))
}

/// A reply worth trying again after a wait: Drive is failing or asks to slow
/// down.
fn retryable(response: &reqwest::Response) -> bool {
    let status = response.status().as_u16();
    status == 429 || status == 403 && rate_limited(response) || (500..600).contains(&status)
}

fn rate_limited(response: &reqwest::Response) -> bool {
    // Drive answers 403 for rate limits too; the reason is in the body, which
    // can't be read without consuming the reply, so a 403 that says to retry
    // later is told apart by its Retry-After header.
    response
        .headers()
        .contains_key(reqwest::header::RETRY_AFTER)
}

async fn read_capped(mut response: reqwest::Response, cap: usize) -> StoreResult<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| StoreError::Network(error.to_string()))?
    {
        if bytes.len() + chunk.len() > cap {
            return Err(StoreError::Server("drive's reply is too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn failure(response: reqwest::Response) -> StoreError {
    let status = response.status().as_u16();
    let bytes = read_capped(response, 64 * 1024).await.unwrap_or_default();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or_default();
    let reason = value["error"]["errors"][0]["reason"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let message: String = value["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect();
    match (status, reason.as_str()) {
        (_, "storageQuotaExceeded" | "quotaExceeded") => StoreError::QuotaFull,
        (_, "userRateLimitExceeded" | "rateLimitExceeded") | (429, _) => StoreError::RateLimited,
        (412, _) => StoreError::Conflict,
        (401, _) => StoreError::Revoked,
        (403, "insufficientPermissions" | "authError") => StoreError::Revoked,
        (400, _) => StoreError::Rejected(format!("{reason}: {message}")),
        _ => StoreError::Server(format!("drive answered {status} {reason}: {message}")),
    }
}

impl CloudStore for DriveStore {
    async fn get(&self, remote: &str, cap: usize) -> StoreResult<Option<(Vec<u8>, String)>> {
        let path = normalize(remote);
        let Some(id) = self.file(&path).await? else {
            return Ok(None);
        };
        let Some(meta) = self.head(&id).await? else {
            self.forget(&path);
            return Ok(None);
        };
        let Some(response) = self.download(&id, None).await? else {
            self.forget(&path);
            return Ok(None);
        };
        let bytes = read_capped(response, cap).await?;
        Ok(Some((bytes, meta.rev)))
    }

    async fn metadata(&self, remote: &str) -> StoreResult<Option<RemoteMeta>> {
        let path = normalize(remote);
        let Some(id) = self.file(&path).await? else {
            return Ok(None);
        };
        let meta = self.head(&id).await?;
        if meta.is_none() {
            self.forget(&path);
        }
        Ok(meta)
    }

    async fn fetch_to(
        &self,
        remote: &str,
        rev: Option<&str>,
        local: &Path,
        limit: u64,
    ) -> StoreResult<Option<Fetched>> {
        let path = normalize(remote);
        let Some(id) = self.file(&path).await? else {
            return Ok(None);
        };
        // The record's revision when Drive still keeps it, the head otherwise;
        // the engine checks either against the record's hash.
        let response = match rev {
            Some(rev) => match self.download(&id, Some(rev)).await? {
                Some(response) => Some(response),
                None => self.download(&id, None).await?,
            },
            None => self.download(&id, None).await?,
        };
        let Some(response) = response else {
            self.forget(&path);
            return Ok(None);
        };
        save_body(response, local, limit, &|_| {}).await.map(Some)
    }

    async fn put(&self, remote: &str, bytes: Vec<u8>, mode: WriteMode) -> StoreResult<String> {
        self.write(&normalize(remote), bytes, &mode).await
    }

    async fn put_path(&self, remote: &str, local: &Path) -> StoreResult<Uploaded> {
        let mut file = LocalFile::open(local).await?;
        let size = file.size();
        let content = if size <= SIMPLE_UPLOAD_LIMIT {
            // Small enough for one request, so it is read whole.
            let bytes = file.piece(0, size).await?;
            file.unchanged().await?;
            Content::Memory(bytes)
        } else {
            // Read a piece at a time as it goes up: a file can be gigabytes,
            // and several go up at once.
            Content::File(&mut file)
        };
        let rev = self.overwrite(&normalize(remote), content).await?;
        Ok(Uploaded {
            rev,
            hash: file.finish()?,
            size,
        })
    }

    async fn put_paths(
        &self,
        files: &[super::store::BatchFile],
        tick: &(dyn Fn() + Sync),
    ) -> Vec<StoreResult<Uploaded>> {
        let indexed = self.prepare(files).await;
        // Collected before buffering, as the Send bound on commands needs.
        let pending: Vec<_> = files
            .iter()
            .map(|file| async move {
                let uploaded = self.put_path(&file.remote, &file.local).await;
                tick();
                uploaded
            })
            .collect();
        let uploaded = stream::iter(pending)
            .buffered(UPLOAD_CONCURRENCY)
            .collect()
            .await;
        self.unindex(&indexed);
        uploaded
    }

    async fn delete(&self, remote: &str, parent_rev: Option<&str>) -> StoreResult<()> {
        let path = normalize(remote);
        let (parent, name) = parent_of(&path);
        let Some(parents) = self.folders(parent, false).await? else {
            return Ok(());
        };
        let found = self.children_named(&parents, name).await?;
        if found.is_empty() {
            return Ok(());
        }
        if let Some(expected) = parent_rev {
            if let Some(file) = found.iter().find(|item| !item.folder) {
                let current = self.head(&file.id).await?;
                if current.is_some_and(|meta| meta.rev != expected) {
                    return Err(StoreError::Conflict);
                }
            }
        }
        // Trashed, not deleted: Drive keeps it for 30 days, as Dropbox keeps
        // a deleted file's history. A folder goes with everything in it.
        for item in &found {
            self.trash(&item.id).await?;
        }
        self.forget(&path);
        Ok(())
    }

    async fn list(&self, remote_dir: &str) -> StoreResult<Vec<RemoteEntry>> {
        let Some(parents) = self.folders(&normalize(remote_dir), false).await? else {
            return Ok(Vec::new());
        };
        let within = parents
            .iter()
            .map(|parent| format!("'{}' in parents", escape(parent)))
            .collect::<Vec<_>>()
            .join(" or ");
        let mut entries: Vec<RemoteEntry> = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let mut query = vec![
                ("q", format!("({within}) and trashed = false")),
                ("fields", "nextPageToken,files(name,mimeType)".to_string()),
                ("pageSize", "1000".to_string()),
                ("spaces", "drive".to_string()),
            ];
            if let Some(token) = &token {
                query.push(("pageToken", token.clone()));
            }
            let value = self
                .json(
                    Method::GET,
                    &format!("{}/files", self.endpoints.api),
                    &query,
                    &Body::None,
                )
                .await?
                .unwrap_or_default();
            for file in value["files"].as_array().into_iter().flatten() {
                let Some(name) = file["name"].as_str() else {
                    continue;
                };
                let folder = file["mimeType"].as_str() == Some(FOLDER);
                if !entries
                    .iter()
                    .any(|entry| entry.name == name && entry.folder == folder)
                {
                    entries.push(RemoteEntry {
                        name: name.to_string(),
                        folder,
                    });
                }
            }
            match value["nextPageToken"].as_str() {
                Some(next) => token = Some(next.to_string()),
                None => return Ok(entries),
            }
        }
        Err(StoreError::Server(
            "drive's folder listing never ended".into(),
        ))
    }

    async fn latest_cursor(&self, _remote_dir: &str) -> StoreResult<Option<String>> {
        let value = self
            .json(
                Method::GET,
                &format!("{}/changes/startPageToken", self.endpoints.api),
                &[],
                &Body::None,
            )
            .await?
            .unwrap_or_default();
        Ok(value["startPageToken"].as_str().map(str::to_string))
    }

    async fn changes(&self, cursor: &str) -> StoreResult<Changes> {
        let mut paths = Vec::new();
        let mut page = cursor.to_string();
        for _ in 0..MAX_LIST_PAGES {
            let (changes, next, fresh) = self.change_page(&page).await?;
            for change in changes {
                // A project's manifest changes with every publish, and its
                // folder is named after the project.
                if change["file"]["name"].as_str() != Some("version.json") {
                    continue;
                }
                let Some(parent) = change["file"]["parents"][0].as_str() else {
                    continue;
                };
                if let Some(project) = self.folder_name(parent).await {
                    paths.push(format!("/projects/{project}/version.json"));
                }
            }
            match (next, fresh) {
                (Some(next), _) => page = next,
                (None, Some(fresh)) => {
                    return Ok(Changes {
                        paths,
                        cursor: fresh,
                    })
                }
                (None, None) => {
                    return Err(StoreError::Server(
                        "drive's change list had no end token".into(),
                    ))
                }
            }
        }
        Err(StoreError::Server("drive's change list never ended".into()))
    }

    async fn account(&self) -> StoreResult<AccountInfo> {
        let value = self
            .json(
                Method::GET,
                &format!("{}/about", self.endpoints.api),
                &[(
                    "fields",
                    "user(displayName,emailAddress,permissionId)".into(),
                )],
                &Body::None,
            )
            .await?
            .unwrap_or_default();
        let user = &value["user"];
        let account_id = user["permissionId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                StoreError::Network("drive's account lookup returned an unreadable reply".into())
            })?;
        Ok(AccountInfo {
            account_id: account_id.to_string(),
            email: user["emailAddress"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            display_name: user["displayName"].as_str().unwrap_or_default().to_string(),
        })
    }

    async fn space(&self) -> StoreResult<Option<Space>> {
        let value = self
            .json(
                Method::GET,
                &format!("{}/about", self.endpoints.api),
                &[("fields", "storageQuota(limit,usage)".into())],
                &Body::None,
            )
            .await?
            .unwrap_or_default();
        let number = |name: &str| {
            value["storageQuota"][name]
                .as_str()
                .and_then(|value| value.parse::<u64>().ok())
        };
        // An account without a limit has no ring to fill.
        Ok(number("limit").map(|allocated| Space {
            used: number("usage").unwrap_or(0),
            allocated,
        }))
    }

    async fn wait_for_changes(
        &self,
        cursor: &str,
        timeout_secs: u64,
    ) -> StoreResult<Option<Waited>> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
        loop {
            let (changes, _, _) = self.change_page(cursor).await?;
            if !changes.is_empty() {
                return Ok(Some(Waited {
                    changes: true,
                    backoff: None,
                }));
            }
            let now = tokio::time::Instant::now();
            if now + CHANGE_POLL > deadline {
                return Ok(Some(Waited {
                    changes: false,
                    backoff: None,
                }));
            }
            tokio::time::sleep(CHANGE_POLL).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{escape, normalize, parent_of};

    #[test]
    fn queries_escape_quotes_and_paths_split_into_folder_and_name() {
        assert_eq!(escape("it's\\here"), "it\\'s\\\\here");
        assert_eq!(
            parent_of("projects/p/version.json"),
            ("projects/p", "version.json")
        );
        assert_eq!(parent_of("settings.json"), ("", "settings.json"));
        assert_eq!(normalize("/projects/p/"), "projects/p");
    }
}
