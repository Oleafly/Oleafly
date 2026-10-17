use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method, Response, StatusCode, Uri};
use axum::Router;
use serde_json::{json, Value};

use super::http::Endpoints;

#[derive(Clone)]
pub struct MockItem {
    pub key: String,
    pub version: u64,
    pub data: Value,
    pub bbt: Option<String>,
}

pub struct MockLibrary {
    pub id: String,
    pub name: String,
    pub bbt_id: u64,
    pub version: u64,
    pub items: Vec<MockItem>,
    pub deleted: Vec<(String, u64)>,
}

pub struct MockState {
    pub running: bool,
    pub local_api: bool,
    pub bbt: bool,
    pub backoff: Option<u64>,
    pub rate_limit: usize,
    pub retry_after: u64,
    pub libraries: Vec<MockLibrary>,
    pub requests: Vec<String>,
    pub web_requests: usize,
    pub not_modified: usize,
    pub local_total_extra: usize,
    pub local_user_id: u64,
    pub web_other_library: bool,
    clock: u64,
}

const USER_ID: &str = "475425";
const API_KEY: &str = "MOCKKEY0123456789abcdef";

fn timestamp(tick: u64) -> String {
    format!("2024-01-01T00:{:02}:{:02}Z", (tick / 60) % 60, tick % 60)
}

fn article(
    key: &str,
    item_type: &str,
    title: &str,
    family: &str,
    date: &str,
    extra: Value,
    tick: u64,
) -> Value {
    let mut data = json!({
        "key": key,
        "itemType": item_type,
        "title": title,
        "creators": [{ "creatorType": "author", "firstName": "Ann", "lastName": family }],
        "date": date,
        "dateAdded": timestamp(tick),
        "dateModified": timestamp(tick),
        "publicationTitle": "Journal of Tests",
        "pages": "1-10",
    });
    if let (Some(target), Some(source)) = (data.as_object_mut(), extra.as_object()) {
        for (name, value) in source {
            target.insert(name.clone(), value.clone());
        }
    }
    data
}

impl MockState {
    fn seed() -> Self {
        let user = MockLibrary {
            id: "user".into(),
            name: "My Library".into(),
            bbt_id: 1,
            version: 10,
            items: vec![
                MockItem {
                    key: "SMITH234".into(),
                    version: 8,
                    data: article(
                        "SMITH234",
                        "journalArticle",
                        "Deep learning",
                        "Smith",
                        "2020-03-15",
                        json!({ "DOI": "10.1/smith" }),
                        1,
                    ),
                    bbt: Some("smithBBT2020".into()),
                },
                MockItem {
                    key: "NATIV234".into(),
                    version: 9,
                    data: article(
                        "NATIV234",
                        "book",
                        "Native keys",
                        "Native",
                        "2019",
                        json!({ "citationKey": "nativeKey2019" }),
                        2,
                    ),
                    bbt: None,
                },
                MockItem {
                    key: "EXTRA234".into(),
                    version: 10,
                    data: article(
                        "EXTRA234",
                        "report",
                        "Extra keys",
                        "Extra",
                        "2018",
                        json!({ "extra": "Citation Key: extraKey2018" }),
                        3,
                    ),
                    bbt: None,
                },
                MockItem {
                    key: "NOTE2345".into(),
                    version: 10,
                    data: json!({ "key": "NOTE2345", "itemType": "note", "note": "<p>x</p>", "dateModified": timestamp(4) }),
                    bbt: None,
                },
            ],
            deleted: Vec::new(),
        };
        let group = MockLibrary {
            id: "group:777".into(),
            name: "Lab Group".into(),
            bbt_id: 2,
            version: 5,
            items: vec![MockItem {
                key: "GROUP234".into(),
                version: 5,
                data: article(
                    "GROUP234",
                    "conferencePaper",
                    "Group findings",
                    "Group",
                    "2021",
                    json!({ "DOI": "10.1/group" }),
                    5,
                ),
                bbt: Some("groupBBT2021".into()),
            }],
            deleted: Vec::new(),
        };
        Self {
            running: true,
            local_api: true,
            bbt: true,
            backoff: None,
            rate_limit: 0,
            retry_after: 0,
            libraries: vec![user, group],
            requests: Vec::new(),
            web_requests: 0,
            not_modified: 0,
            local_total_extra: 0,
            local_user_id: USER_ID.parse().unwrap(),
            web_other_library: false,
            clock: 100,
        }
    }

    fn library_mut(&mut self, id: &str) -> &mut MockLibrary {
        self.libraries
            .iter_mut()
            .find(|library| library.id == id)
            .expect("library")
    }

    fn tick(&mut self) -> String {
        self.clock += 1;
        timestamp(self.clock)
    }

    pub fn edit(&mut self, library: &str, key: &str, field: &str, value: &str, sync: bool) {
        let stamp = self.tick();
        let library = self.library_mut(library);
        if sync {
            library.version += 1;
        }
        let version = library.version;
        let item = library
            .items
            .iter_mut()
            .find(|item| item.key == key)
            .expect("item");
        item.data[field] = json!(value);
        item.data["dateModified"] = json!(stamp);
        if sync {
            item.version = version;
        }
    }

    pub fn add(&mut self, library: &str, key: &str, title: &str, sync: bool) {
        let tick = self.clock + 1;
        self.clock = tick;
        let library = self.library_mut(library);
        if sync {
            library.version += 1;
        }
        let version = if sync { library.version } else { 0 };
        library.items.push(MockItem {
            key: key.into(),
            version,
            data: article(
                key,
                "journalArticle",
                title,
                "Newman",
                "2024",
                json!({}),
                tick,
            ),
            bbt: Some(format!("newman{key}")),
        });
    }

    pub fn delete(&mut self, library: &str, key: &str) {
        let library = self.library_mut(library);
        library.version += 1;
        library.items.retain(|item| item.key != key);
        let version = library.version;
        library.deleted.push((key.into(), version));
    }

    pub fn set_bbt_key(&mut self, key: &str, citation_key: &str) {
        for library in &mut self.libraries {
            for item in &mut library.items {
                if item.key == key {
                    item.bbt = Some(citation_key.into());
                }
            }
        }
    }
}

#[derive(Clone)]
struct Shared(Arc<Mutex<MockState>>);

pub struct MockZotero {
    address: std::net::SocketAddr,
    state: Arc<Mutex<MockState>>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for MockZotero {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn reply(status: u16, headers: &[(&str, String)], body: String) -> Response<Body> {
    let mut builder = Response::builder()
        .status(status)
        .header("Zotero-API-Version", "3")
        .header("X-Zotero-Version", "7.0.11");
    for (name, value) in headers {
        builder = builder.header(*name, value);
    }
    builder.body(Body::from(body)).unwrap()
}

fn item_json(library: &MockLibrary, owner: u64, item: &MockItem, include: &str) -> Value {
    let (kind, id) = match library.id.strip_prefix("group:") {
        Some(group) => ("group", group.parse().unwrap_or_default()),
        None => ("user", owner),
    };
    let mut value = json!({
        "key": item.key,
        "version": item.version,
        "library": { "type": kind, "id": id, "name": library.name },
        "meta": {},
        "data": item.data,
    });
    value["data"]["version"] = json!(item.version);
    for format in ["biblatex", "bibtex"] {
        if include.split(',').any(|part| part == format) {
            value[format] = json!(zotero_export(item, format));
        }
    }
    value
}

pub fn zotero_export(item: &MockItem, format: &str) -> String {
    let family = item.data["creators"][0]["lastName"]
        .as_str()
        .unwrap_or("anon")
        .to_lowercase();
    let title = item.data["title"].as_str().unwrap_or_default();
    let word = title
        .split_whitespace()
        .next()
        .unwrap_or("x")
        .to_lowercase();
    let year = item.data["date"]
        .as_str()
        .unwrap_or_default()
        .get(..4)
        .unwrap_or("");
    let journal = if format == "biblatex" {
        "journaltitle"
    } else {
        "journal"
    };
    let date = if format == "biblatex" { "date" } else { "year" };
    format!(
        "\n@article{{{family}_{word}_{year},\n\ttitle = {{{title}}},\n\t{journal} = {{Journal of Tests}},\n\tauthor = {{{}, Ann}},\n\t{date} = {{{year}}},\n\tpages = {{1--10}},\n}}\n",
        item.data["creators"][0]["lastName"].as_str().unwrap_or("Anon")
    )
}

pub fn bbt_export(item: &MockItem, translator: &str) -> String {
    let key = item.bbt.clone().unwrap_or_default();
    let title = item.data["title"].as_str().unwrap_or_default();
    let family = item.data["creators"][0]["lastName"]
        .as_str()
        .unwrap_or("Anon");
    let year = item.data["date"]
        .as_str()
        .unwrap_or_default()
        .get(..4)
        .unwrap_or("");
    if translator == "Better BibLaTeX" {
        format!("@article{{{key},\n  title = {{{title}}},\n  author = {{{family}, Ann}},\n  date = {{{year}}},\n  journaltitle = {{Journal of Tests}},\n  langid = {{english}}\n}}\n")
    } else {
        format!("@article{{{key},\n  title = {{{title}}},\n  author = {{{family}, Ann}},\n  year = {{{year}}},\n  journal = {{Journal of Tests}}\n}}\n")
    }
}

fn query_map(uri: &Uri) -> HashMap<String, String> {
    uri.query()
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(name, value)| (name.to_string(), value.replace("%2C", ",")))
        .collect()
}

fn library_for<'a>(
    state: &'a MockState,
    path: &str,
    web: bool,
) -> Option<(&'a MockLibrary, String)> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let offset = usize::from(!web);
    let (kind, id) = (parts.get(offset)?, parts.get(offset + 1)?);
    let library_id = match *kind {
        "users" if *id == "0" && !web => "user".to_string(),
        "users" if *id == USER_ID => "user".to_string(),
        "groups" => format!("group:{id}"),
        _ => return None,
    };
    let rest = parts[offset + 2..].join("/");
    state
        .libraries
        .iter()
        .find(|library| library.id == library_id)
        .map(|library| (library, rest))
}

fn serve_items(
    state: &mut MockState,
    path: &str,
    uri: &Uri,
    headers: &HeaderMap,
    web: bool,
) -> Response<Body> {
    let query = query_map(uri);
    let Some((library, rest)) = library_for(state, path, web) else {
        return reply(if web { 403 } else { 404 }, &[], "Not found".into());
    };
    let version = library.version;
    if web && state.web_other_library {
        let body = match rest.as_str() {
            "deleted" => json!({ "items": [] }).to_string(),
            _ if query.get("format").map(String::as_str) == Some("keys") => String::new(),
            _ => "[]".to_string(),
        };
        return reply(
            200,
            &[
                ("Last-Modified-Version", "1".to_string()),
                ("Total-Results", "0".to_string()),
            ],
            body,
        );
    }
    if rest == "groups" {
        let groups: Vec<Value> = state
            .libraries
            .iter()
            .filter(|library| library.id != "user")
            .map(|library| {
                let id: u64 = library.id.trim_start_matches("group:").parse().unwrap();
                json!({ "id": id, "version": library.version, "data": { "id": id, "name": library.name } })
            })
            .collect();
        return reply(200, &[], Value::Array(groups).to_string());
    }
    if rest == "deleted" {
        let since: u64 = query
            .get("since")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let items: Vec<&String> = library
            .deleted
            .iter()
            .filter(|(_, deleted)| *deleted > since)
            .map(|(key, _)| key)
            .collect();
        return reply(
            200,
            &[("Last-Modified-Version", version.to_string())],
            json!({ "items": items, "collections": [], "searches": [], "tags": [], "settings": [] }).to_string(),
        );
    }
    if rest != "items/top" && rest != "items" {
        return reply(404, &[], "Not found".into());
    }
    if let Some(since) = headers
        .get("If-Modified-Since-Version")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        if version <= since {
            state.not_modified += 1;
            return reply(
                304,
                &[("Last-Modified-Version", version.to_string())],
                String::new(),
            );
        }
    }
    let mut items: Vec<&MockItem> = library.items.iter().collect();
    if let Some(since) = query
        .get("since")
        .and_then(|value| value.parse::<u64>().ok())
    {
        items.retain(|item| item.version > since);
    }
    if let Some(keys) = query.get("itemKey") {
        let wanted: Vec<&str> = keys.split(',').collect();
        items.retain(|item| wanted.contains(&item.key.as_str()));
    }
    let modified = |item: &MockItem| {
        item.data["dateModified"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    match query.get("sort").map(String::as_str) {
        Some("dateModified") => items.sort_by_key(|item| modified(item)),
        _ => items.sort_by_key(|item| {
            item.data["dateAdded"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        }),
    }
    if query.get("direction").map(String::as_str) == Some("desc") {
        items.reverse();
    }
    let total = items.len() + if web { 0 } else { state.local_total_extra };
    let start: usize = query
        .get("start")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut limit: usize = query
        .get("limit")
        .and_then(|value| value.parse().ok())
        .unwrap_or(if web { 25 } else { usize::MAX });
    if web {
        limit = limit.min(100);
    }
    let page: Vec<&MockItem> = items.into_iter().skip(start).take(limit).collect();
    let headers = [
        ("Last-Modified-Version", version.to_string()),
        ("Total-Results", total.to_string()),
    ];
    if query.get("format").map(String::as_str) == Some("keys") {
        let keys: Vec<&str> = page.iter().map(|item| item.key.as_str()).collect();
        return reply(200, &headers, keys.join("\n"));
    }
    let include = query
        .get("include")
        .cloned()
        .unwrap_or_else(|| "data".into());
    let owner = if web {
        USER_ID.parse().unwrap()
    } else {
        state.local_user_id
    };
    let body: Vec<Value> = page
        .iter()
        .map(|item| item_json(library, owner, item, &include))
        .collect();
    reply(200, &headers, Value::Array(body).to_string())
}

fn rpc(state: &MockState, body: &str) -> Response<Body> {
    if !state.bbt {
        return reply(404, &[], "No endpoint found".into());
    }
    let request: Value = serde_json::from_str(body).unwrap_or_default();
    let params = request["params"].clone();
    let result = match request["method"].as_str().unwrap_or_default() {
        "api.ready" => json!({ "betterbibtex": "6.7.240", "zotero": "7.0.11" }),
        "user.groups" => Value::Array(
            state
                .libraries
                .iter()
                .map(|library| json!({ "id": library.bbt_id, "name": library.name, "collections": null }))
                .collect(),
        ),
        "item.citationkey" => {
            let mut keys = serde_json::Map::new();
            for requested in params[0].as_array().into_iter().flatten().filter_map(Value::as_str) {
                let (bbt_id, key) = requested
                    .split_once(':')
                    .map(|(id, key)| (id.parse().unwrap_or(0), key))
                    .unwrap_or((1, requested));
                let found = state
                    .libraries
                    .iter()
                    .find(|library| library.bbt_id == bbt_id)
                    .and_then(|library| library.items.iter().find(|item| item.key == key))
                    .and_then(|item| item.bbt.clone());
                keys.insert(requested.to_string(), found.map(Value::String).unwrap_or(Value::Null));
            }
            Value::Object(keys)
        }
        "item.export" => {
            let translator = params[1].as_str().unwrap_or_default();
            let bbt_id = params[2].as_u64().unwrap_or(1);
            let library = state.libraries.iter().find(|library| library.bbt_id == bbt_id);
            let mut out = String::new();
            for citekey in params[0].as_array().into_iter().flatten().filter_map(Value::as_str) {
                let Some(item) = library.and_then(|library| {
                    library.items.iter().find(|item| item.bbt.as_deref() == Some(citekey))
                }) else {
                    return reply(
                        200,
                        &[],
                        json!({ "jsonrpc": "2.0", "error": { "code": -32602, "message": format!("not found: {citekey}") }, "id": 1 }).to_string(),
                    );
                };
                out.push_str(&bbt_export(item, translator));
                out.push('\n');
            }
            Value::String(out)
        }
        other => {
            return reply(
                200,
                &[],
                json!({ "jsonrpc": "2.0", "error": { "code": -32601, "message": format!("Method not found: {other}") }, "id": 1 }).to_string(),
            )
        }
    };
    reply(
        200,
        &[],
        json!({ "jsonrpc": "2.0", "result": result, "id": 1 }).to_string(),
    )
}

async fn handle(
    State(shared): State<Shared>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: String,
) -> Response<Body> {
    let mut state = shared.0.lock().unwrap();
    let path = uri.path().to_string();
    state.requests.push(uri.to_string());
    if let Some(path) = path.strip_prefix("/local") {
        if !state.running {
            return reply(503, &[], String::new());
        }
        if path == "/connector/ping" {
            return reply(200, &[], "Zotero is running".into());
        }
        if path == "/better-bibtex/json-rpc" && method == Method::POST {
            return rpc(&state, &body);
        }
        if !state.local_api && path.starts_with("/api/") {
            return reply(403, &[], "Local API is not enabled".into());
        }
        if path == "/api/" {
            return reply(200, &[], "Nothing to see here.".into());
        }
        return serve_items(&mut state, path, &uri, &headers, false);
    }
    if let Some(path) = path.strip_prefix("/web") {
        state.web_requests += 1;
        let backoff = state
            .backoff
            .map(|seconds| ("Backoff", seconds.to_string()));
        if state.rate_limit > 0 {
            state.rate_limit -= 1;
            let retry = state.retry_after.to_string();
            return reply(429, &[("Retry-After", retry)], "Too Many Requests".into());
        }
        let key = headers
            .get("Zotero-API-Key")
            .and_then(|value| value.to_str().ok());
        if key != Some(API_KEY) {
            return reply(403, &[], "Forbidden".into());
        }
        let mut response = if path == "/keys/current" {
            reply(
                200,
                &[],
                json!({ "key": API_KEY, "userID": 475425, "username": "mock", "access": { "user": { "library": true } } }).to_string(),
            )
        } else {
            serve_items(&mut state, path, &uri, &headers, true)
        };
        if let Some((name, value)) = backoff {
            response.headers_mut().insert(name, value.parse().unwrap());
        }
        return response;
    }
    reply(StatusCode::NOT_FOUND.as_u16(), &[], String::new())
}

impl MockZotero {
    pub async fn start() -> Self {
        let state = Arc::new(Mutex::new(MockState::seed()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new()
            .fallback(handle)
            .with_state(Shared(Arc::clone(&state)));
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            address,
            state,
            server,
        }
    }

    pub fn endpoints(&self) -> Endpoints {
        Endpoints {
            local: format!("http://{}/local", self.address),
            web: format!("http://{}/web", self.address),
        }
    }

    pub fn user_id(&self) -> &'static str {
        USER_ID
    }

    pub fn api_key(&self) -> &'static str {
        API_KEY
    }

    pub fn set(&self, change: impl FnOnce(&mut MockState)) {
        change(&mut self.state.lock().unwrap());
    }

    pub fn version(&self, library: &str) -> u64 {
        self.state
            .lock()
            .unwrap()
            .libraries
            .iter()
            .find(|candidate| candidate.id == library)
            .map(|library| library.version)
            .unwrap()
    }

    pub fn paths(&self) -> Vec<String> {
        self.state.lock().unwrap().requests.clone()
    }

    pub fn request_count(&self) -> usize {
        self.state.lock().unwrap().requests.len()
    }

    pub fn web_request_count(&self) -> usize {
        self.state.lock().unwrap().web_requests
    }

    pub fn not_modified_count(&self) -> usize {
        self.state.lock().unwrap().not_modified
    }

    pub fn clear_requests(&self) {
        let mut state = self.state.lock().unwrap();
        state.requests.clear();
        state.web_requests = 0;
        state.not_modified = 0;
    }
}
