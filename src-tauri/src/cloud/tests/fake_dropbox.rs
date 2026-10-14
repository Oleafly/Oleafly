use crate::cloud::store::{
    arg_header, test_endpoints, DropboxContentHasher, Endpoints, StoreResult, TokenRefresher,
};
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

pub(crate) const ACCOUNT_ID: &str = "dbid:AAH4f99T0taONIb-OurWxbNQ6ywGRopQngc";
pub(crate) const EMAIL: &str = "ada@example.org";
pub(crate) const DISPLAY_NAME: &str = "Ada Lovelace";
const MAX_BODY: usize = 64 * 1024 * 1024;
const CONTENT_ROUTES: [&str; 5] = [
    "files/download",
    "files/upload",
    "files/upload_session/start",
    "files/upload_session/append_v2",
    "files/upload_session/finish",
];
const FILE_ROUTES: [&str; 7] = [
    "files/download",
    "files/upload",
    "files/upload_session/start",
    "files/upload_session/append_v2",
    "files/upload_session/finish",
    "files/get_metadata",
    "files/delete_v2",
];

#[derive(Clone)]
struct Stored {
    path: String,
    bytes: Vec<u8>,
    rev: String,
    hash: String,
}

#[derive(Clone, Debug)]
pub(crate) enum Reply {
    Status(u16),
    Refuse(&'static str),
    Json(Value),
    Raw(&'static str),
}

struct Fault {
    route: String,
    path: Option<String>,
    reply: Reply,
    remaining: usize,
}

pub(crate) struct Inner {
    tag: u32,
    files: BTreeMap<String, Stored>,
    history: BTreeMap<String, Stored>,
    next_id: u64,
    log: Vec<String>,
    epoch: u64,
    sessions: BTreeMap<String, Vec<u8>>,
    access: BTreeSet<String>,
    refresh: BTreeSet<String>,
    faults: Vec<Fault>,
    calls: BTreeMap<String, usize>,
    pub(crate) account_id: String,
    pub(crate) expires_in: u64,
    pub(crate) omit_refresh: bool,
    pub(crate) refresh_revoked: bool,
    pub(crate) quota: Option<u64>,
    pub(crate) allocated: u64,
    pub(crate) page_size: usize,
    pub(crate) rejected_names: BTreeSet<String>,
    pub(crate) corrupt_hash: bool,
    pub(crate) list_noise: bool,
    pub(crate) token_forms: Vec<BTreeMap<String, String>>,
    pub(crate) revoked: Vec<String>,
}

fn dropbox_hash(bytes: &[u8]) -> String {
    let mut hasher = DropboxContentHasher::default();
    hasher.update(bytes);
    hasher.finish()
}

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or_default()
}

fn file_meta(stored: &Stored) -> Value {
    json!({
        ".tag": "file",
        "name": name_of(&stored.path),
        "path_lower": stored.path.to_lowercase(),
        "path_display": stored.path,
        "id": format!("id:{}", stored.rev),
        "client_modified": "2026-10-14T08:00:00Z",
        "server_modified": "2026-10-14T08:00:00Z",
        "rev": stored.rev,
        "size": stored.bytes.len(),
        "is_downloadable": true,
        "content_hash": stored.hash,
    })
}

fn folder_meta(path: &str) -> Value {
    json!({
        ".tag": "folder",
        "name": name_of(path),
        "path_lower": path.to_lowercase(),
        "path_display": path,
        "id": format!("id:{}", path.to_lowercase()),
    })
}

fn json_reply(value: Value) -> Response {
    (StatusCode::OK, axum::Json(value)).into_response()
}

fn refuse(summary: &str) -> Response {
    let tag = summary.split('/').next().unwrap_or_default();
    (
        StatusCode::CONFLICT,
        axum::Json(json!({"error_summary": summary, "error": {".tag": tag}})),
    )
        .into_response()
}

fn expired() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(json!({
            "error_summary": "expired_access_token/..",
            "error": {".tag": "expired_access_token"}
        })),
    )
        .into_response()
}

fn oauth_error(error: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        axum::Json(json!({"error": error, "error_description": format!("refused: {error}")})),
    )
        .into_response()
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, message.to_string()).into_response()
}

fn reply_response(reply: Reply) -> Response {
    match reply {
        Reply::Status(401) => expired(),
        Reply::Status(429) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "0")],
            axum::Json(json!({
                "error_summary": "too_many_requests/..",
                "error": {"reason": {".tag": "too_many_requests"}, "retry_after": 0}
            })),
        )
            .into_response(),
        Reply::Status(code) => (
            StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            [(header::RETRY_AFTER, "0")],
            "fake dropbox failure",
        )
            .into_response(),
        Reply::Refuse(summary) => refuse(summary),
        Reply::Json(value) => json_reply(value),
        Reply::Raw(text) => (StatusCode::OK, text).into_response(),
    }
}

fn dir_of(arg: &Value) -> String {
    arg["path"]
        .as_str()
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_lowercase()
}

impl Inner {
    fn new() -> Self {
        Self {
            tag: rand::random(),
            files: BTreeMap::new(),
            history: BTreeMap::new(),
            next_id: 0,
            log: Vec::new(),
            epoch: 0,
            sessions: BTreeMap::new(),
            access: BTreeSet::new(),
            refresh: BTreeSet::new(),
            faults: Vec::new(),
            calls: BTreeMap::new(),
            account_id: ACCOUNT_ID.into(),
            expires_in: 14_400,
            omit_refresh: false,
            refresh_revoked: false,
            quota: None,
            allocated: 2 * 1024 * 1024 * 1024,
            page_size: 2_000,
            rejected_names: BTreeSet::new(),
            corrupt_hash: false,
            list_noise: false,
            token_forms: Vec::new(),
            revoked: Vec::new(),
        }
    }

    pub(crate) fn write(&mut self, path: &str, bytes: Vec<u8>) -> String {
        self.next_id += 1;
        let rev = format!("{:012x}", 0x05a1_0000_0000_u64 + self.next_id);
        let stored = Stored {
            path: path.to_string(),
            hash: dropbox_hash(&bytes),
            bytes,
            rev: rev.clone(),
        };
        let lower = path.to_lowercase();
        self.history.insert(rev.clone(), stored.clone());
        self.files.insert(lower.clone(), stored);
        self.log.push(lower);
        rev
    }

    pub(crate) fn remove(&mut self, path: &str) -> bool {
        let lower = path.to_lowercase();
        let prefix = format!("{lower}/");
        let before = self.files.len();
        self.files
            .retain(|key, _| *key != lower && !key.starts_with(&prefix));
        let removed = self.files.len() != before;
        if removed {
            self.log.push(lower);
        }
        removed
    }

    pub(crate) fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.files
            .get(&path.to_lowercase())
            .map(|stored| stored.bytes.clone())
    }

    pub(crate) fn rev(&self, path: &str) -> Option<String> {
        self.files
            .get(&path.to_lowercase())
            .map(|stored| stored.rev.clone())
    }

    pub(crate) fn used(&self) -> u64 {
        self.files
            .values()
            .map(|stored| stored.bytes.len() as u64)
            .sum()
    }

    pub(crate) fn mint_token(&mut self) -> String {
        self.next_id += 1;
        let token = format!("sl.{:08x}.access-{}", self.tag, self.next_id);
        self.access.insert(token.clone());
        token
    }

    fn mint_refresh(&mut self) -> String {
        self.next_id += 1;
        let token = format!("{:08x}-refresh-{}", self.tag, self.next_id);
        self.refresh.insert(token.clone());
        token
    }

    pub(crate) fn expire_tokens(&mut self) {
        self.access.clear();
    }

    pub(crate) fn reset_cursors(&mut self) {
        self.epoch += 1;
    }

    pub(crate) fn fault(&mut self, route: &str, path: Option<&str>, reply: Reply, times: usize) {
        self.faults.push(Fault {
            route: route.to_string(),
            path: path.map(str::to_lowercase),
            reply,
            remaining: times,
        });
    }

    pub(crate) fn calls(&self, route: &str) -> usize {
        self.calls.get(route).copied().unwrap_or(0)
    }

    pub(crate) fn file_calls(&self) -> usize {
        FILE_ROUTES.iter().map(|route| self.calls(route)).sum()
    }

    pub(crate) fn clear_calls(&mut self) {
        self.calls.clear();
    }

    fn take_fault(&mut self, route: &str, arg: &Value) -> Option<Reply> {
        let target = arg
            .get("path")
            .or_else(|| arg.pointer("/commit/path"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let fault = self.faults.iter_mut().find(|fault| {
            fault.remaining > 0
                && fault.route == route
                && fault
                    .path
                    .as_ref()
                    .is_none_or(|path| target.ends_with(path.as_str()))
        })?;
        fault.remaining -= 1;
        Some(fault.reply.clone())
    }

    fn serve(&mut self, path: &str, headers: &HeaderMap, body: &[u8]) -> Response {
        if path == "/oauth2/token" {
            *self.calls.entry("oauth2/token".into()).or_default() += 1;
            if let Some(reply) = self.take_fault("oauth2/token", &Value::Null) {
                return reply_response(reply);
            }
            return self.token(body);
        }
        let (route, content) = if let Some(route) = path.strip_prefix("/content/2/") {
            (route.to_string(), true)
        } else if let Some(route) = path.strip_prefix("/2/") {
            (route.to_string(), false)
        } else {
            return (StatusCode::NOT_FOUND, "no such route").into_response();
        };
        *self.calls.entry(route.clone()).or_default() += 1;
        if content != CONTENT_ROUTES.contains(&route.as_str()) {
            return bad_request("this route lives on the other host");
        }
        let arg = if content {
            let Some(arg) = headers
                .get("Dropbox-API-Arg")
                .and_then(|value| value.to_str().ok())
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
            else {
                return bad_request("Error in call to API function: missing Dropbox-API-Arg");
            };
            arg
        } else {
            serde_json::from_slice(body).unwrap_or(Value::Null)
        };
        if let Some(reply) = self.take_fault(&route, &arg) {
            return reply_response(reply);
        }
        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default()
            .to_string();
        if !self.access.contains(&token) {
            return expired();
        }
        match route.as_str() {
            "auth/token/revoke" => {
                self.access.remove(&token);
                self.revoked.push(token);
                json_reply(Value::Null)
            }
            "users/get_current_account" => json_reply(json!({
                "account_id": self.account_id,
                "name": {
                    "given_name": "Ada",
                    "surname": "Lovelace",
                    "familiar_name": "Ada",
                    "display_name": DISPLAY_NAME,
                    "abbreviated_name": "AL"
                },
                "email": EMAIL,
                "email_verified": true,
                "disabled": false,
                "country": "GB",
                "locale": "en",
                "is_paired": false,
                "account_type": {".tag": "basic"}
            })),
            "users/get_space_usage" => json_reply(json!({
                "used": self.used(),
                "allocation": {".tag": "individual", "allocated": self.quota.unwrap_or(self.allocated)}
            })),
            "files/get_metadata" => self.get_metadata(&arg),
            "files/delete_v2" => self.delete(&arg),
            "files/list_folder" => self.list_folder(&arg),
            "files/list_folder/continue" => self.list_continue(&arg),
            "files/list_folder/get_latest_cursor" => self.latest_cursor(&arg),
            "files/download" => self.download(&arg),
            "files/upload" => self.commit(&arg, body.to_vec()),
            "files/upload_session/start" => {
                self.next_id += 1;
                let id = format!("pid_upload_session:{:08x}{}", self.tag, self.next_id);
                self.sessions.insert(id.clone(), body.to_vec());
                json_reply(json!({"session_id": id}))
            }
            "files/upload_session/append_v2" => match self.append(&arg, body) {
                Ok(_) => json_reply(Value::Null),
                Err(summary) => refuse(summary),
            },
            "files/upload_session/finish" => match self.append(&arg, body) {
                Ok(id) => {
                    let data = self.sessions.remove(&id).unwrap_or_default();
                    self.commit(&arg["commit"], data)
                }
                Err(summary) => refuse(summary),
            },
            _ => (StatusCode::NOT_FOUND, "unknown route").into_response(),
        }
    }

    fn token(&mut self, body: &[u8]) -> Response {
        let form: BTreeMap<String, String> = reqwest::Url::parse(&format!(
            "http://form.invalid/?{}",
            String::from_utf8_lossy(body)
        ))
        .map(|url| url.query_pairs().into_owned().collect())
        .unwrap_or_default();
        self.token_forms.push(form.clone());
        let field = |name: &str| form.get(name).map(String::as_str).unwrap_or_default();
        if form.contains_key("client_secret") || field("client_id").is_empty() {
            return oauth_error("invalid_client");
        }
        match field("grant_type") {
            "authorization_code" => {
                let code = field("code");
                if code == "denied" {
                    return oauth_error("access_denied");
                }
                if code.is_empty() || code == "bad" || field("code_verifier").is_empty() {
                    return oauth_error("invalid_grant");
                }
                let access = self.mint_token();
                let refresh = self.mint_refresh();
                let mut reply = json!({
                    "access_token": access,
                    "token_type": "bearer",
                    "expires_in": self.expires_in,
                    "scope": "account_info.read files.content.read files.content.write files.metadata.read",
                    "uid": "4242",
                    "account_id": self.account_id,
                });
                if !self.omit_refresh {
                    reply["refresh_token"] = json!(refresh);
                }
                json_reply(reply)
            }
            "refresh_token" => {
                if self.refresh_revoked || !self.refresh.contains(field("refresh_token")) {
                    return oauth_error("invalid_grant");
                }
                json_reply(json!({
                    "access_token": self.mint_token(),
                    "token_type": "bearer",
                    "expires_in": self.expires_in,
                }))
            }
            _ => oauth_error("unsupported_grant_type"),
        }
    }

    fn folder_exists(&self, dir: &str) -> bool {
        let prefix = format!("{dir}/");
        self.files.keys().any(|key| key.starts_with(&prefix))
    }

    fn children(&self, dir: &str) -> Vec<Value> {
        let prefix = format!("{dir}/");
        let depth = dir.split('/').count();
        let mut seen: BTreeMap<String, Value> = BTreeMap::new();
        for (key, stored) in &self.files {
            if !key.starts_with(&prefix) {
                continue;
            }
            let parts: Vec<&str> = stored.path.split('/').collect();
            let Some(name) = parts.get(depth) else {
                continue;
            };
            let entry = if parts.len() > depth + 1 {
                folder_meta(&parts[..=depth].join("/"))
            } else {
                file_meta(stored)
            };
            seen.entry(name.to_lowercase()).or_insert(entry);
        }
        seen.into_values().collect()
    }

    fn get_metadata(&self, arg: &Value) -> Response {
        let path = arg["path"].as_str().unwrap_or_default();
        let lower = path.to_lowercase();
        if let Some(stored) = self.files.get(&lower) {
            return json_reply(file_meta(stored));
        }
        if self.folder_exists(&lower) {
            return json_reply(folder_meta(path));
        }
        refuse("path/not_found/..")
    }

    fn delete(&mut self, arg: &Value) -> Response {
        let path = arg["path"].as_str().unwrap_or_default();
        let lower = path.to_lowercase();
        let metadata = match self.files.get(&lower) {
            Some(stored) => file_meta(stored),
            None if self.folder_exists(&lower) => folder_meta(path),
            None => return refuse("path_lookup/not_found/.."),
        };
        self.remove(path);
        json_reply(json!({"metadata": metadata}))
    }

    fn list_folder(&self, arg: &Value) -> Response {
        let dir = dir_of(arg);
        let limit = arg["limit"]
            .as_u64()
            .and_then(|limit| usize::try_from(limit).ok())
            .unwrap_or(2_000);
        if !self.folder_exists(&dir) {
            return refuse("path/not_found/..");
        }
        json_reply(self.list_page(&dir, 0, limit))
    }

    fn list_page(&self, dir: &str, offset: usize, limit: usize) -> Value {
        let children = self.children(dir);
        let start = offset.min(children.len());
        let end = (start + limit.min(self.page_size).max(1)).min(children.len());
        let mut entries = children[start..end].to_vec();
        if self.list_noise && start == 0 {
            entries.push(json!({".tag": "deleted", "name": "gone.tex", "path_lower": format!("{dir}/gone.tex")}));
            entries.push(json!({".tag": "file", "path_lower": format!("{dir}/nameless")}));
        }
        json!({
            "entries": entries,
            "cursor": format!("list|{end}|{limit}|{dir}"),
            "has_more": end < children.len(),
        })
    }

    fn list_continue(&self, arg: &Value) -> Response {
        let cursor = arg["cursor"].as_str().unwrap_or_default();
        let parts: Vec<&str> = cursor.splitn(4, '|').collect();
        match parts.as_slice() {
            ["list", end, limit, dir] => match (end.parse(), limit.parse()) {
                (Ok(end), Ok(limit)) => json_reply(self.list_page(dir, end, limit)),
                _ => bad_request("Error in call to API function: invalid cursor"),
            },
            ["chg", epoch, index, dir] => match (epoch.parse::<u64>(), index.parse::<usize>()) {
                (Ok(epoch), _) if epoch != self.epoch => refuse("reset/.."),
                (Ok(_), Ok(index)) => json_reply(self.changes_page(dir, index)),
                _ => bad_request("Error in call to API function: invalid cursor"),
            },
            _ => bad_request("Error in call to API function: invalid cursor"),
        }
    }

    fn changes_page(&self, dir: &str, index: usize) -> Value {
        let prefix = format!("{dir}/");
        let size = self.page_size.max(1);
        let mut entries = Vec::new();
        let mut next = self.log.len();
        for (position, changed) in self.log.iter().enumerate().skip(index) {
            if changed != dir && !changed.starts_with(&prefix) {
                continue;
            }
            if entries.len() == size {
                next = position;
                break;
            }
            entries.push(self.change_entry(changed));
        }
        json!({
            "entries": entries,
            "cursor": format!("chg|{}|{next}|{dir}", self.epoch),
            "has_more": next < self.log.len(),
        })
    }

    fn change_entry(&self, lower: &str) -> Value {
        if let Some(stored) = self.files.get(lower) {
            return file_meta(stored);
        }
        if self.folder_exists(lower) {
            return folder_meta(lower);
        }
        json!({".tag": "deleted", "name": name_of(lower), "path_lower": lower, "path_display": lower})
    }

    fn latest_cursor(&self, arg: &Value) -> Response {
        let dir = dir_of(arg);
        if !self.folder_exists(&dir) {
            return refuse("path/not_found/..");
        }
        json_reply(json!({"cursor": format!("chg|{}|{}|{dir}", self.epoch, self.log.len())}))
    }

    fn download(&self, arg: &Value) -> Response {
        let target = arg["path"].as_str().unwrap_or_default();
        let found = match target.strip_prefix("rev:") {
            Some(rev) => self.history.get(rev),
            None => self.files.get(&target.to_lowercase()),
        };
        let Some(stored) = found else {
            return refuse("path/not_found/..");
        };
        Response::builder()
            .status(StatusCode::OK)
            .header("Dropbox-API-Result", arg_header(&file_meta(stored)))
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(stored.bytes.clone()))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }

    fn append(&mut self, arg: &Value, body: &[u8]) -> Result<String, &'static str> {
        let id = arg
            .pointer("/cursor/session_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let offset = arg.pointer("/cursor/offset").and_then(Value::as_u64);
        let Some(data) = self.sessions.get_mut(&id) else {
            return Err("lookup_failed/not_found/..");
        };
        if offset != Some(data.len() as u64) {
            return Err("lookup_failed/incorrect_offset/..");
        }
        data.extend_from_slice(body);
        Ok(id)
    }

    fn commit(&mut self, commit: &Value, bytes: Vec<u8>) -> Response {
        let Some(path) = commit["path"]
            .as_str()
            .filter(|path| path.starts_with('/') && !path.ends_with('/'))
        else {
            return refuse("path/malformed_path/..");
        };
        if self.rejected_names.contains(&name_of(path).to_lowercase()) {
            return refuse("path/disallowed_name/..");
        }
        let lower = path.to_lowercase();
        if self.folder_exists(&lower) {
            return refuse("path/conflict/folder/..");
        }
        let current = self.files.get(&lower).cloned();
        let mode = &commit["mode"];
        let allowed = match (
            mode.as_str(),
            mode.get(".tag").and_then(Value::as_str),
            &current,
        ) {
            (Some("overwrite"), _, _) | (Some("add"), _, None) => true,
            (None, Some("update"), Some(existing)) => {
                mode["update"].as_str() == Some(existing.rev.as_str())
            }
            (Some("add"), _, Some(_)) | (None, Some("update"), None) => false,
            _ => return bad_request("unknown write mode"),
        };
        if !allowed {
            return refuse("path/conflict/file/..");
        }
        if let Some(quota) = self.quota {
            let replaced = current.map_or(0, |existing| existing.bytes.len() as u64);
            if self.used() - replaced + bytes.len() as u64 > quota {
                return refuse("path/insufficient_space/..");
            }
        }
        self.write(path, bytes);
        let mut metadata = file_meta(&self.files[&lower]);
        if std::mem::take(&mut self.corrupt_hash) {
            metadata["content_hash"] = json!("0".repeat(64));
        }
        json_reply(metadata)
    }
}

async fn handle(
    State(shared): State<Arc<Mutex<Inner>>>,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Ok(body) = axum::body::to_bytes(body, MAX_BODY).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };
    shared
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .serve(uri.path(), &headers, &body)
}

pub(crate) struct FakeDropbox {
    base: String,
    shared: Arc<Mutex<Inner>>,
    task: tokio::task::JoinHandle<()>,
}

impl FakeDropbox {
    pub(crate) async fn start() -> Self {
        let shared = Arc::new(Mutex::new(Inner::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new()
            .fallback(handle)
            .with_state(Arc::clone(&shared));
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Self {
            base: format!("http://{address}"),
            shared,
            task,
        }
    }

    pub(crate) fn endpoints(&self) -> Endpoints {
        Endpoints {
            api: format!("{}/2", self.base),
            content: format!("{}/content/2", self.base),
            token: format!("{}/oauth2/token", self.base),
        }
    }

    pub(crate) fn with<T>(&self, change: impl FnOnce(&mut Inner) -> T) -> T {
        change(&mut self.shared.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub(crate) fn refresher(&self, calls: Arc<AtomicUsize>) -> TokenRefresher {
        let shared = Arc::clone(&self.shared);
        Arc::new(move || -> BoxFuture<'static, StoreResult<String>> {
            calls.fetch_add(1, Ordering::SeqCst);
            let token = shared
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .mint_token();
            Box::pin(async move { Ok(token) })
        })
    }
}

impl Drop for FakeDropbox {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) struct BlackHole {
    pub(crate) endpoints: Endpoints,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for BlackHole {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) async fn black_hole() -> BlackHole {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            drop(stream);
        }
    });
    BlackHole {
        endpoints: Endpoints {
            api: format!("{base}/2"),
            content: format!("{base}/content/2"),
            token: format!("{base}/oauth2/token"),
        },
        task,
    }
}

static POINTED: Mutex<()> = Mutex::new(());

pub(crate) struct Pointed {
    _guard: MutexGuard<'static, ()>,
}

impl Pointed {
    pub(crate) fn repoint(&self, endpoints: Endpoints) {
        test_endpoints::set(Some(endpoints));
    }
}

impl Drop for Pointed {
    fn drop(&mut self) {
        test_endpoints::set(None);
    }
}

pub(crate) fn point_at(endpoints: Endpoints) -> Pointed {
    let guard = POINTED.lock().unwrap_or_else(PoisonError::into_inner);
    test_endpoints::set(Some(endpoints));
    Pointed { _guard: guard }
}
