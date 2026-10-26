//! A small Google Drive v3 for the Drive store's tests: the file and folder
//! queries the store sends, simple, multipart and resumable uploads, revision
//! history, trash, the change feed and the account lookup. It can make
//! another computer's write land in the middle of a compare-and-swap.

use crate::cloud::drive::{DriveEndpoints, DriveStore};
use crate::cloud::store::TokenRefresher;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

const FOLDER: &str = "application/vnd.google-apps.folder";
pub(crate) const PERMISSION_ID: &str = "04719871092875471834";

#[derive(Clone, Debug)]
pub(crate) struct FakeFile {
    pub(crate) name: String,
    pub(crate) parents: Vec<String>,
    pub(crate) folder: bool,
    pub(crate) trashed: bool,
    pub(crate) created: u64,
    pub(crate) revisions: Vec<(String, Vec<u8>)>,
}

#[derive(Default)]
pub(crate) struct Drive {
    pub(crate) files: BTreeMap<String, FakeFile>,
    pub(crate) token: String,
    next: u64,
    changes: Vec<(u64, String)>,
    sessions: BTreeMap<String, (Option<String>, Value, Vec<u8>)>,
    /// Bytes another computer writes to a file just before the next update
    /// of it lands, as if its write slipped between the check and the write.
    pub(crate) race_next_update: Option<Vec<u8>>,
    /// A file of the same name another computer creates just before the next
    /// create in that folder lands.
    pub(crate) race_next_create: bool,
    pub(crate) calls: usize,
}

impl Drive {
    fn tick(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    fn changed(&mut self, id: &str) {
        let seq = self.tick();
        self.changes.push((seq, id.to_string()));
    }

    fn add(&mut self, name: &str, parent: &str, folder: bool, bytes: Option<Vec<u8>>) -> String {
        let seq = self.tick();
        let id = format!("f{seq}");
        let revisions = bytes
            .map(|bytes| vec![(format!("r{}", self.tick()), bytes)])
            .unwrap_or_default();
        self.files.insert(
            id.clone(),
            FakeFile {
                name: name.to_string(),
                parents: vec![parent.to_string()],
                folder,
                trashed: false,
                created: seq,
                revisions,
            },
        );
        self.changed(&id);
        id
    }

    fn revise(&mut self, id: &str, bytes: Vec<u8>) -> Option<String> {
        if let Some(theirs) = self.race_next_update.take() {
            let rev = format!("r{}", self.tick());
            self.files.get_mut(id)?.revisions.push((rev, theirs));
        }
        let rev = format!("r{}", self.tick());
        self.files.get_mut(id)?.revisions.push((rev.clone(), bytes));
        self.changed(id);
        Some(rev)
    }

    /// The live file at a path below the `Oleafly` folder, for assertions.
    pub(crate) fn content(&self, path: &str) -> Option<Vec<u8>> {
        let mut parent = self
            .files
            .iter()
            .find(|(_, file)| file.name == "Oleafly" && file.parents == ["root"] && !file.trashed)?
            .0
            .clone();
        let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
        for (index, segment) in segments.iter().enumerate() {
            let last = index + 1 == segments.len();
            let (id, _) = self.files.iter().find(|(_, file)| {
                file.name == *segment
                    && file.parents.contains(&parent)
                    && !file.trashed
                    && file.folder != last
            })?;
            parent = id.clone();
        }
        self.files
            .get(&parent)?
            .revisions
            .last()
            .map(|(_, bytes)| bytes.clone())
    }
}

#[derive(Clone)]
pub(crate) struct FakeDrive {
    shared: Arc<Mutex<Drive>>,
    pub(crate) base: String,
    task: Arc<tokio::task::JoinHandle<()>>,
}

impl Drop for FakeDrive {
    fn drop(&mut self) {
        if Arc::strong_count(&self.task) == 1 {
            self.task.abort();
        }
    }
}

impl FakeDrive {
    pub(crate) async fn start() -> Self {
        let shared = Arc::new(Mutex::new(Drive {
            token: "at-1".into(),
            ..Drive::default()
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        // Drive takes resumable pieces of 8 MiB; axum's own limit is 2 MB.
        let router = axum::Router::new()
            .fallback(handle)
            .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
            .with_state(Arc::clone(&shared));
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Self {
            shared,
            base,
            task: Arc::new(task),
        }
    }

    pub(crate) fn with<T>(&self, change: impl FnOnce(&mut Drive) -> T) -> T {
        change(&mut self.lock())
    }

    fn lock(&self) -> MutexGuard<'_, Drive> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn endpoints(&self) -> DriveEndpoints {
        DriveEndpoints {
            api: format!("{}/drive/v3", self.base),
            upload: format!("{}/upload/drive/v3", self.base),
        }
    }

    pub(crate) fn store(&self) -> DriveStore {
        let token = self.lock().token.clone();
        DriveStore::at(self.endpoints(), token, None)
    }

    pub(crate) fn store_with(&self, token: &str, refresher: TokenRefresher) -> DriveStore {
        DriveStore::at(self.endpoints(), token.into(), Some(refresher))
    }
}

fn query_map(uri: &Uri) -> BTreeMap<String, String> {
    reqwest::Url::parse(&format!("http://fake{uri}"))
        .map(|url| url.query_pairs().into_owned().collect())
        .unwrap_or_default()
}

fn unescape(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(character) = chars.next() {
        if character == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(character);
        }
    }
    out
}

/// The quoted values in `q` that precede `suffix`, as in `'id' in parents`.
fn quoted_before(q: &str, suffix: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = q;
    while let Some(start) = rest.find('\'') {
        let after = &rest[start + 1..];
        let mut end = None;
        let mut escaped = false;
        for (index, character) in after.char_indices() {
            match character {
                '\\' if !escaped => escaped = true,
                '\'' if !escaped => {
                    end = Some(index);
                    break;
                }
                _ => escaped = false,
            }
        }
        let Some(end) = end else { break };
        let value = unescape(&after[..end]);
        let tail = &after[end + 1..];
        if tail.trim_start().starts_with(suffix) {
            found.push(value);
        }
        rest = tail;
    }
    found
}

fn name_in(q: &str) -> Option<String> {
    let start = q.find("name = '")? + "name = '".len();
    let after = &q[start..];
    let mut escaped = false;
    for (index, character) in after.char_indices() {
        match character {
            '\\' if !escaped => escaped = true,
            '\'' if !escaped => return Some(unescape(&after[..index])),
            _ => escaped = false,
        }
    }
    None
}

fn file_json(id: &str, file: &FakeFile) -> Value {
    let head = file.revisions.last();
    json!({
        "id": id,
        "name": file.name,
        "mimeType": if file.folder { FOLDER } else { "application/octet-stream" },
        "parents": file.parents,
        "trashed": file.trashed,
        "headRevisionId": head.map(|(rev, _)| rev.clone()),
        "size": head.map(|(_, bytes)| bytes.len().to_string()),
    })
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        axum::Json(
            json!({"error": {"errors": [{"reason": "notFound"}], "message": "File not found"}}),
        ),
    )
        .into_response()
}

fn created(drive: &mut Drive, metadata: &Value, bytes: Option<Vec<u8>>) -> Response {
    let name = metadata["name"].as_str().unwrap_or_default().to_string();
    let parent = metadata["parents"][0]
        .as_str()
        .unwrap_or("root")
        .to_string();
    let folder = metadata["mimeType"].as_str() == Some(FOLDER);
    if drive.race_next_create && !folder {
        drive.race_next_create = false;
        drive.add(&name, &parent, false, Some(b"theirs".to_vec()));
    }
    let id = drive.add(&name, &parent, folder, bytes.or((!folder).then(Vec::new)));
    let file = &drive.files[&id];
    axum::Json(file_json(&id, file)).into_response()
}

fn multipart_parts(content_type: &str, body: &[u8]) -> Option<(Value, Vec<u8>)> {
    let boundary = content_type.split("boundary=").nth(1)?.trim_matches('"');
    let delimiter = format!("--{boundary}");
    let text = body;
    let find = |haystack: &[u8], needle: &[u8], from: usize| {
        haystack[from..]
            .windows(needle.len())
            .position(|window| window == needle)
            .map(|position| position + from)
    };
    let first = find(text, delimiter.as_bytes(), 0)? + delimiter.len();
    let second = find(text, delimiter.as_bytes(), first)?;
    let third = find(text, delimiter.as_bytes(), second + delimiter.len())?;
    let part = |start: usize, end: usize| {
        let section = &text[start..end];
        let split = find(section, b"\r\n\r\n", 0)? + 4;
        let mut content = section[split..].to_vec();
        if content.ends_with(b"\r\n") {
            content.truncate(content.len() - 2);
        }
        Some(content)
    };
    let metadata = serde_json::from_slice(&part(first, second)?).ok()?;
    let media = part(second + delimiter.len(), third)?;
    Some((metadata, media))
}

async fn handle(
    State(shared): State<Arc<Mutex<Drive>>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let mut drive = shared.lock().unwrap_or_else(PoisonError::into_inner);
    drive.calls += 1;
    let authorized = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(format!("Bearer {}", drive.token).as_str());
    let path = uri.path().to_string();
    let query = query_map(&uri);
    if path.starts_with("/upload/session/") {
        return resume(&mut drive, &path, &headers, &body);
    }
    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": {"errors": [{"reason": "authError"}], "message": "Invalid Credentials"}})),
        )
            .into_response();
    }
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match (method.as_str(), parts.as_slice()) {
        ("GET", ["drive", "v3", "about"]) => axum::Json(json!({
            "user": {"displayName": "Ada Lovelace", "emailAddress": "ada@example.org", "permissionId": PERMISSION_ID},
            "storageQuota": {"limit": "16106127360", "usage": "2048"},
        }))
        .into_response(),
        ("GET", ["drive", "v3", "changes", "startPageToken"]) => {
            let next = drive.next + 1;
            axum::Json(json!({"startPageToken": next.to_string()})).into_response()
        }
        ("GET", ["drive", "v3", "changes"]) => {
            let from: u64 = query.get("pageToken").and_then(|token| token.parse().ok()).unwrap_or(0);
            let changes: Vec<Value> = drive
                .changes
                .iter()
                .filter(|(seq, _)| *seq >= from)
                .filter_map(|(_, id)| {
                    let file = drive.files.get(id)?;
                    Some(json!({"fileId": id, "removed": false, "file": {"name": file.name, "parents": file.parents, "trashed": file.trashed}}))
                })
                .collect();
            axum::Json(json!({"changes": changes, "newStartPageToken": (drive.next + 1).to_string()}))
                .into_response()
        }
        ("GET", ["drive", "v3", "files"]) => {
            let q = query.get("q").cloned().unwrap_or_default();
            let parents = quoted_before(&q, "in parents");
            let name = name_in(&q);
            let mut found: Vec<(&String, &FakeFile)> = drive
                .files
                .iter()
                .filter(|(_, file)| {
                    !file.trashed
                        && file.parents.iter().any(|parent| parents.contains(parent))
                        && name.as_ref().is_none_or(|name| &file.name == name)
                })
                .collect();
            found.sort_by_key(|(_, file)| file.created);
            let files: Vec<Value> = found.iter().map(|(id, file)| file_json(id, file)).collect();
            axum::Json(json!({"files": files})).into_response()
        }
        ("POST", ["drive", "v3", "files"]) => {
            let metadata: Value = serde_json::from_slice(&body).unwrap_or_default();
            created(&mut drive, &metadata, None)
        }
        ("GET", ["drive", "v3", "files", id]) => {
            let Some(file) = drive.files.get(*id) else {
                return not_found();
            };
            if query.get("alt").map(String::as_str) == Some("media") {
                return match file.revisions.last() {
                    Some((_, bytes)) => (StatusCode::OK, bytes.clone()).into_response(),
                    None => (StatusCode::OK, Vec::new()).into_response(),
                };
            }
            axum::Json(file_json(id, file)).into_response()
        }
        ("PATCH", ["drive", "v3", "files", id]) => {
            let change: Value = serde_json::from_slice(&body).unwrap_or_default();
            if !drive.files.contains_key(*id) {
                return not_found();
            }
            let id = id.to_string();
            if change["trashed"].as_bool() == Some(true) {
                // As in Drive, everything inside a trashed folder is trashed.
                let mut pending = vec![id.clone()];
                while let Some(next) = pending.pop() {
                    if let Some(file) = drive.files.get_mut(&next) {
                        file.trashed = true;
                    }
                    pending.extend(
                        drive
                            .files
                            .iter()
                            .filter(|(_, file)| file.parents.contains(&next) && !file.trashed)
                            .map(|(child, _)| child.clone()),
                    );
                }
            }
            drive.changed(&id);
            axum::Json(json!({"id": id})).into_response()
        }
        ("GET", ["drive", "v3", "files", id, "revisions"]) => {
            let Some(file) = drive.files.get(*id) else {
                return not_found();
            };
            let revisions: Vec<Value> =
                file.revisions.iter().map(|(rev, _)| json!({"id": rev})).collect();
            axum::Json(json!({"revisions": revisions})).into_response()
        }
        ("GET", ["drive", "v3", "files", id, "revisions", rev]) => {
            let found = drive
                .files
                .get(*id)
                .and_then(|file| file.revisions.iter().find(|(known, _)| known == rev));
            match found {
                Some((_, bytes)) => (StatusCode::OK, bytes.clone()).into_response(),
                None => not_found(),
            }
        }
        ("POST", ["upload", "drive", "v3", "files"]) | ("PATCH", ["upload", "drive", "v3", "files", _]) => {
            let target = parts.get(4).map(|id| id.to_string());
            match query.get("uploadType").map(String::as_str) {
                Some("multipart") => {
                    let content_type = headers
                        .get(header::CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default();
                    match multipart_parts(content_type, &body) {
                        Some((metadata, media)) => created(&mut drive, &metadata, Some(media)),
                        None => (StatusCode::BAD_REQUEST, "bad multipart").into_response(),
                    }
                }
                Some("media") => update(&mut drive, &target.unwrap_or_default(), body.to_vec()),
                Some("resumable") => {
                    let session = format!("s{}", drive.tick());
                    let metadata: Value = serde_json::from_slice(&body).unwrap_or_default();
                    drive.sessions.insert(session.clone(), (target, metadata, Vec::new()));
                    let location = format!("{}/upload/session/{session}", host_of(&headers));
                    (StatusCode::OK, [(header::LOCATION, location)]).into_response()
                }
                _ => (StatusCode::BAD_REQUEST, "unknown upload type").into_response(),
            }
        }
        _ => not_found(),
    }
}

fn host_of(headers: &HeaderMap) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("127.0.0.1");
    format!("http://{host}")
}

fn update(drive: &mut Drive, id: &str, bytes: Vec<u8>) -> Response {
    if !drive.files.contains_key(id) {
        return not_found();
    }
    drive.revise(id, bytes);
    let file = &drive.files[id];
    axum::Json(file_json(id, file)).into_response()
}

fn resume(drive: &mut Drive, path: &str, headers: &HeaderMap, body: &[u8]) -> Response {
    let session = path.trim_start_matches("/upload/session/").to_string();
    let total: Option<usize> = headers
        .get("content-range")
        .and_then(|value| value.to_str().ok())
        .and_then(|range| range.rsplit('/').next())
        .and_then(|total| total.parse().ok());
    let Some((_, _, received)) = drive.sessions.get_mut(&session) else {
        return not_found();
    };
    received.extend_from_slice(body);
    if total.is_some_and(|total| received.len() < total) {
        return StatusCode::PERMANENT_REDIRECT.into_response();
    }
    let (target, metadata, received) = drive.sessions.remove(&session).unwrap();
    match target {
        Some(id) => update(drive, &id, received),
        None => created(drive, &metadata, Some(received)),
    }
}
