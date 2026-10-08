use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{Method, Response, StatusCode};
use axum::routing::any;
use axum::Router;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::commands::connection_report;
use super::export::{export, ItemRef, Style};
use super::http::Endpoints;
use super::links::{links_path, read_links, update_links, ProjectLink};
use super::sync::{Credentials, SyncOptions, ZoteroLibrary};
use super::{verify_at, ZoteroAccount};

struct Bridge {
    library: Arc<ZoteroLibrary>,
    root: PathBuf,
    account: Mutex<Option<(Credentials, ZoteroAccount)>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Flags {
    #[serde(default)]
    offline: bool,
    #[serde(default)]
    force: bool,
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn parse<T: DeserializeOwned>(body: &Value) -> Result<T, String> {
    serde_json::from_value(body.clone()).map_err(|error| error.to_string())
}

fn reply(status: StatusCode, body: Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS")
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

impl Bridge {
    fn credentials(&self) -> Option<Credentials> {
        self.account
            .lock()
            .unwrap()
            .as_ref()
            .map(|(credentials, _)| credentials.clone())
    }

    fn options(&self, flags: &Flags) -> SyncOptions {
        SyncOptions {
            offline: flags.offline,
            force: flags.force,
            credentials: self.credentials(),
        }
    }

    async fn dispatch(&self, command: &str, body: Value) -> Result<Value, String> {
        let library = &self.library;
        match command {
            "zotero_library_status" => to_value(&library.load().await),
            "zotero_library_sync" => {
                let flags: Flags = parse(&body)?;
                to_value(&library.sync(self.options(&flags), &mut |_| {}).await)
            }
            "zotero_library_test" => {
                let flags: Flags = parse(&body)?;
                to_value(
                    &connection_report(
                        library,
                        self.options(&Flags {
                            force: true,
                            ..flags
                        }),
                    )
                    .await,
                )
            }
            "zotero_library_search" => {
                let query = body["query"].as_str().unwrap_or_default();
                let limit = body["limit"].as_u64().unwrap_or(50) as usize;
                let (generation, result) = library.search(query, limit);
                Ok(json!({ "generation": generation, "total": result.total, "hits": result.hits }))
            }
            "zotero_library_lookup" => {
                let keys: Vec<String> = parse(&body["keys"])?;
                to_value(&library.lookup(&keys))
            }
            "zotero_library_keys" => {
                let (generation, keys) = library.keys();
                Ok(json!({ "generation": generation, "keys": keys }))
            }
            "zotero_library_items" => {
                let refs: Vec<ItemRef> = parse(&body["refs"])?;
                let refs: Vec<(String, String)> = refs
                    .into_iter()
                    .map(|reference| (reference.library, reference.item_key))
                    .collect();
                to_value(&library.items(&refs))
            }
            "zotero_library_export" => {
                let refs: Vec<ItemRef> = parse(&body["refs"])?;
                let style: Style = parse(&body["style"])?;
                let flags: Flags = parse(&body)?;
                to_value(&export(library, &refs, style, &self.options(&flags)).await)
            }
            "zotero_library_set_enabled" => {
                let id = body["libraryId"].as_str().unwrap_or_default();
                let enabled = body["enabled"].as_bool().unwrap_or(true);
                to_value(&library.set_enabled(id, enabled).await)
            }
            "zotero_web_account" => to_value(
                &self
                    .account
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|(_, account)| account.clone()),
            ),
            "zotero_web_connect" => {
                let user_id = body["userId"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let api_key = body["apiKey"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let account = verify_at(&library.endpoints().web, &user_id, &api_key).await?;
                *self.account.lock().unwrap() = Some((
                    Credentials {
                        user_id: account.user_id.clone(),
                        api_key,
                    },
                    account.clone(),
                ));
                to_value(&account)
            }
            "zotero_web_disconnect" => {
                *self.account.lock().unwrap() = None;
                Ok(Value::Null)
            }
            "zotero_project_links" => {
                let project = body["projectId"].as_str().unwrap_or_default();
                to_value(&read_links(&links_path(&self.root, project)))
            }
            "zotero_update_project_links" => {
                let project = body["projectId"].as_str().unwrap_or_default();
                let changes: BTreeMap<String, Option<ProjectLink>> = parse(&body["changes"])?;
                to_value(&update_links(&links_path(&self.root, project), changes)?)
            }
            other => Err(format!("unknown command {other}")),
        }
    }
}

async fn handle(
    State(bridge): State<Arc<Bridge>>,
    Path(command): Path<String>,
    method: Method,
    body: String,
) -> Response<Body> {
    if method == Method::OPTIONS {
        return reply(StatusCode::NO_CONTENT, Value::Null);
    }
    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    match bridge.dispatch(&command, body).await {
        Ok(value) => reply(StatusCode::OK, json!({ "ok": value })),
        Err(error) => reply(StatusCode::OK, json!({ "error": error })),
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "development bridge for the browser harness; run with --ignored --nocapture"]
async fn serves_zotero_commands_to_a_browser_harness() {
    let port: u16 = std::env::var("ZOTERO_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let root = PathBuf::from(std::env::var("ZOTERO_BRIDGE_DATA").expect("ZOTERO_BRIDGE_DATA"));
    let library = ZoteroLibrary::new(
        Endpoints::from_env(),
        Some(root.join("zotero").join("library.json")),
    );
    let bridge = Arc::new(Bridge {
        library: Arc::new(library),
        root,
        account: Mutex::new(None),
    });
    let router = Router::new()
        .route("/invoke/{command}", any(handle))
        .with_state(bridge);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    println!("ZOTERO_BRIDGE http://{}", listener.local_addr().unwrap());
    axum::serve(listener, router).await.unwrap();
}
