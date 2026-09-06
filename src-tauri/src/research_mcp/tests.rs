use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use axum::http::{HeaderMap, HeaderValue, StatusCode};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use super::{files::FileScope, tools, transport, ScopedResearchMcp};

async fn bridge(root: &Path, allowed: Option<Vec<String>>) -> ScopedResearchMcp {
    transport::serve(
        "project-a".into(),
        FileScope::open(root, allowed).unwrap(),
        Vec::new(),
        root.join("skills-storage"),
        None,
    )
    .await
    .unwrap()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap()
}

fn decode(result: &Value) -> Value {
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[test]
fn linked_file_results_preserve_their_root_identity() {
    let result = tools::linked_file_result(
        json!({"path":"notes.md","content":"linked notes"}),
        "references",
        "notes.md",
    );
    assert_eq!(result["root_id"], "references");
    assert_eq!(result["relative_path"], "notes.md");
    assert_eq!(result["path"], "notes.md");
    assert_eq!(result["content"], "linked notes");
}

fn headers(bridge: &ScopedResearchMcp) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "host",
        HeaderValue::from_str(&bridge.context.authority).unwrap(),
    );
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", bridge.context.token.as_str())).unwrap(),
    );
    headers
}

#[tokio::test]
async fn credentials_are_unique_and_reject_other_sessions_and_browser_origins() {
    let root = tempfile::tempdir().unwrap();
    let first = bridge(root.path(), None).await;
    let second = bridge(root.path(), None).await;
    assert_ne!(first.context.token.as_str(), second.context.token.as_str());
    assert_ne!(first.url, second.url);
    let mut request_headers = headers(&first);
    assert_eq!(
        transport::authenticate(&first.context, &request_headers),
        Ok(())
    );
    request_headers.insert("origin", HeaderValue::from_static("http://localhost"));
    assert_eq!(
        transport::authenticate(&first.context, &request_headers),
        Err(StatusCode::FORBIDDEN)
    );
    request_headers.remove("origin");
    request_headers.insert("host", HeaderValue::from_static("attacker.example"));
    assert_eq!(
        transport::authenticate(&first.context, &request_headers),
        Err(StatusCode::FORBIDDEN)
    );
    let mut request_headers = headers(&first);
    request_headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", second.context.token.as_str())).unwrap(),
    );
    assert_eq!(
        transport::authenticate(&first.context, &request_headers),
        Err(StatusCode::UNAUTHORIZED)
    );
    let mut request_headers = headers(&first);
    request_headers.append("authorization", HeaderValue::from_static("Bearer extra"));
    assert_eq!(
        transport::authenticate(&first.context, &request_headers),
        Err(StatusCode::UNAUTHORIZED)
    );
    let response = client()
        .post(&first.url)
        .bearer_auth(second.context.token.as_str())
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    first.shutdown().await;
    second.shutdown().await;
}

#[tokio::test]
async fn tool_calls_read_the_execution_root_and_cannot_override_the_project() {
    let original = tempfile::tempdir().unwrap();
    let isolated = tempfile::tempdir().unwrap();
    std::fs::write(original.path().join("main.tex"), "original manuscript").unwrap();
    std::fs::write(isolated.path().join("main.tex"), "isolated manuscript").unwrap();
    let original_bridge = bridge(original.path(), None).await;
    let isolated_bridge = bridge(isolated.path(), None).await;
    let response: Value = client().post(&isolated_bridge.url)
        .bearer_auth(isolated_bridge.context.token.as_str())
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"main.tex"}}}))
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(
        decode(&response["result"])["content"],
        "isolated manuscript"
    );
    assert_eq!(
        decode(
            &original_bridge
                .call_tool("read_file", &json!({"path":"main.tex"}))
                .await
                .unwrap()
        )["content"],
        "original manuscript"
    );
    for key in ["project_id", "projectId", "execution_root", "root_path"] {
        let mut arguments = json!({"path":"main.tex"});
        arguments[key] = json!("project-b");
        assert!(isolated_bridge
            .call_tool("read_file", &arguments)
            .await
            .is_err());
    }
    assert!(isolated_bridge
        .call_tool(
            "write_file",
            &json!({"path":"main.tex","content":"changed"})
        )
        .await
        .is_err());
    assert_eq!(
        std::fs::read_to_string(original.path().join("main.tex")).unwrap(),
        "original manuscript"
    );
    original_bridge.shutdown().await;
    isolated_bridge.shutdown().await;
}

#[tokio::test]
async fn initialization_and_tool_listing_never_return_the_credential() {
    let root = tempfile::tempdir().unwrap();
    let bridge = bridge(root.path(), None).await;
    for method in ["initialize", "tools/list"] {
        let response = client()
            .post(&bridge.url)
            .bearer_auth(bridge.context.token.as_str())
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method}))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let body = response.text().await.unwrap();
        assert!(!body.contains(bridge.context.token.as_str()));
        assert!(!body.contains(root.path().to_string_lossy().as_ref()));
        assert!(!body.contains("write_file"));
        assert!(!body.contains("run_command"));
    }
    let context = bridge
        .call_tool("research_context", &json!({}))
        .await
        .unwrap();
    assert!(!context.to_string().contains(bridge.context.token.as_str()));
    let descriptor = bridge.mcp_server();
    assert_eq!(descriptor["type"], "http");
    assert_eq!(descriptor["headers"][0]["name"], "Authorization");
    bridge.shutdown().await;
}

#[tokio::test]
async fn http_rejects_oversized_bodies_and_limits_concurrent_requests() {
    let root = tempfile::tempdir().unwrap();
    let bridge = bridge(root.path(), None).await;
    let response = client()
        .post(&bridge.url)
        .bearer_auth(bridge.context.token.as_str())
        .header("content-type", "application/json")
        .body("x".repeat(65 * 1024))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    let permits = bridge.context.requests.acquire_many(16).await.unwrap();
    let response = client()
        .post(&bridge.url)
        .bearer_auth(bridge.context.token.as_str())
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
    drop(permits);
    bridge.shutdown().await;
}

#[test]
fn paths_reject_traversal_absolute_and_private_metadata() {
    for path in [
        "../main.tex",
        "/etc/passwd",
        "folder/../main.tex",
        "folder/./main.tex",
        "a//b",
        "C:\\data\\file",
        ".git/config",
        ".oleafly/build/file",
        "nested/.private/notes",
        "a\0b",
    ] {
        assert!(
            super::files::relative_path(path, false).is_err(),
            "{path:?}"
        );
    }
    assert!(super::files::relative_path("", false).is_err());
    assert!(super::files::relative_path("", true).is_ok());
}

#[test]
fn restricted_scopes_filter_files_without_sibling_prefix_matches() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("notes")).unwrap();
    std::fs::create_dir(root.path().join("notes-extra")).unwrap();
    std::fs::write(root.path().join("notes/result.md"), "needle granted").unwrap();
    std::fs::write(root.path().join("notes-extra/private.md"), "needle denied").unwrap();
    std::fs::write(root.path().join("secret.md"), "needle denied").unwrap();
    let scope = FileScope::open(root.path(), Some(vec!["notes/result.md".into()])).unwrap();
    assert_eq!(
        scope.read("notes/result.md", 100).unwrap()["content"],
        "needle granted"
    );
    assert!(scope.read("notes-extra/private.md", 100).is_err());
    assert!(scope.read("secret.md", 100).is_err());
    let closed = AtomicBool::new(false);
    let listing = scope.list("", 5, &closed).unwrap();
    assert_eq!(listing["entries"].as_array().unwrap().len(), 2);
    let result = scope.search("needle", &closed).unwrap();
    assert_eq!(result["matches"].as_array().unwrap().len(), 1);
    let empty = FileScope::open(root.path(), Some(Vec::new())).unwrap();
    assert!(empty.read("secret.md", 100).is_err());
    assert!(empty.list("", 5, &closed).is_err());
}

#[test]
fn reads_and_listings_have_bounded_results() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("large.txt"),
        "x".repeat(super::files::MAX_READ_BYTES * 2),
    )
    .unwrap();
    std::fs::write(root.path().join("binary.dat"), [0, 1, 2]).unwrap();
    let scope = FileScope::open(root.path(), None).unwrap();
    let value = scope.read("large.txt", usize::MAX).unwrap();
    assert_eq!(value["bytes_read"], super::files::MAX_READ_BYTES);
    assert_eq!(value["truncated"], true);
    assert!(scope.read("binary.dat", 100).is_err());
    for index in 0..505 {
        std::fs::write(root.path().join(format!("{index}.txt")), "test").unwrap();
    }
    let listing = scope.list("", 0, &AtomicBool::new(false)).unwrap();
    assert_eq!(listing["entries"].as_array().unwrap().len(), 500);
    assert_eq!(listing["truncated"], true);
    assert!(scope.list("", 0, &AtomicBool::new(true)).is_err());
}

#[cfg(unix)]
#[test]
fn capability_reads_block_file_and_directory_symlinks() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "outside").unwrap();
    symlink(outside.path(), root.path().join("linked")).unwrap();
    symlink(
        outside.path().join("secret.txt"),
        root.path().join("secret.txt"),
    )
    .unwrap();
    let scope = FileScope::open(root.path(), None).unwrap();
    assert!(scope.read("linked/secret.txt", 100).is_err());
    assert!(scope.read("secret.txt", 100).is_err());
    assert_eq!(
        scope.list("", 5, &AtomicBool::new(false)).unwrap()["entries"],
        json!([])
    );
    assert!(FileScope::open(&root.path().join("linked"), None).is_err());
}

#[cfg(unix)]
#[test]
fn capability_root_stays_pinned_when_its_path_is_replaced() {
    use std::os::unix::fs::symlink;
    let parent = tempfile::tempdir().unwrap();
    let original = parent.path().join("root");
    std::fs::create_dir(&original).unwrap();
    std::fs::write(original.join("file.txt"), "session").unwrap();
    let scope = FileScope::open(&original, None).unwrap();
    let moved = parent.path().join("moved");
    std::fs::rename(&original, &moved).unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("file.txt"), "outside").unwrap();
    symlink(outside.path(), &original).unwrap();
    assert_eq!(scope.read("file.txt", 100).unwrap()["content"], "session");
}

#[tokio::test]
async fn shutdown_cancels_partial_requests_and_revokes_direct_calls() {
    let root = tempfile::tempdir().unwrap();
    let bridge = bridge(root.path(), None).await;
    let mut stream = tokio::net::TcpStream::connect(&bridge.context.authority)
        .await
        .unwrap();
    let partial = format!("POST /mcp HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{", bridge.context.authority, bridge.context.token.as_str());
    stream.write_all(partial.as_bytes()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), bridge.shutdown())
        .await
        .unwrap();
    assert!(bridge
        .call_tool("research_context", &json!({}))
        .await
        .is_err());
    assert_eq!(
        transport::authenticate(&bridge.context, &headers(&bridge)),
        Err(StatusCode::GONE)
    );
    assert!(tokio::net::TcpStream::connect(&bridge.context.authority)
        .await
        .is_err());
    bridge.shutdown().await;
}

#[tokio::test]
async fn dropping_the_owner_closes_the_listener() {
    let root = tempfile::tempdir().unwrap();
    let bridge = bridge(root.path(), None).await;
    let authority = bridge.context.authority.clone();
    drop(bridge);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if tokio::net::TcpStream::connect(&authority).await.is_err() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn unknown_linked_roots_are_rejected_before_any_filesystem_access() {
    let root = tempfile::tempdir().unwrap();
    let bridge = bridge(root.path(), None).await;
    let error = bridge
        .call_tool(
            "read_linked_file",
            &json!({"root_id":"../another-project","path":"file.txt"}),
        )
        .await
        .unwrap_err();
    assert!(error.contains("not granted"));
    bridge.shutdown().await;
}

#[test]
fn schemas_reject_invalid_queries_limits_and_unknown_arguments() {
    assert!(tools::validate(
        "literature_search",
        &json!({"source":"https://arbitrary.example","query":"paper"})
    )
    .is_err());
    assert!(tools::validate(
        "literature_search",
        &json!({"source":"arxiv","query":"paper","limit":256})
    )
    .is_err());
    assert!(tools::validate("read_file", &json!({"path":"main.tex","max_bytes":0})).is_err());
    assert!(tools::validate("list_files", &json!({"max_depth":-1})).is_err());
    assert!(tools::validate("research_context", &json!([])).is_err());
    assert!(tools::validate("load_skill", &json!({})).is_err());
    assert!(tools::validate(
        "literature_search",
        &json!({"source":"arxiv","query":"paper","limit":25})
    )
    .is_ok());
    let names: std::collections::HashSet<_> = tools::tool_definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect();
    assert_eq!(names.len(), 14);
}

#[test]
fn invalid_json_rpc_shapes_are_rejected() {
    for value in [
        json!([]),
        json!({"method":"ping"}),
        json!({"jsonrpc":"2.0","method":"ping","id":[]}),
        json!({"jsonrpc":"2.0","method":"ping","params":[]}),
    ] {
        assert!(!transport::valid_message(&value));
    }
    assert!(transport::valid_message(
        &json!({"jsonrpc":"2.0","id":1,"method":"ping"})
    ));
    assert!(transport::valid_message(
        &json!({"jsonrpc":"2.0","method":"notifications/initialized"})
    ));
}

fn write_skill(storage: &Path, id: &str, name: &str) {
    let directory = storage.join("skills").join(id);
    std::fs::create_dir_all(directory.join("scripts")).unwrap();
    std::fs::write(
        directory.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Review the sources.\n---\n\nStart with the claim audit.\n"),
    )
    .unwrap();
    std::fs::write(
        directory.join("scripts").join("verify_citations.py"),
        "print('ok')\n",
    )
    .unwrap();
}

#[tokio::test]
async fn a_device_enabled_skill_loads_with_its_folder_and_script_commands() {
    let root = tempfile::tempdir().unwrap();
    let storage = root.path().join("skills-storage");
    write_skill(&storage, "literature-review", "Literature Review");
    let bridge = bridge(root.path(), None).await;

    let listed = decode(&bridge.call_tool("list_skills", &json!({})).await.unwrap());
    assert_eq!(listed["skills"][0]["id"], "literature-review");
    assert_eq!(listed["skills"][0]["enabled"], true);

    let loaded = decode(
        &bridge
            .call_tool("load_skill", &json!({"id":"literature-review"}))
            .await
            .unwrap(),
    );
    assert_eq!(loaded["id"], "literature-review");
    assert_eq!(loaded["name"], "Literature Review");
    assert!(loaded["instructions"]
        .as_str()
        .unwrap()
        .contains("Start with the claim audit."));
    assert!(loaded["dir"]
        .as_str()
        .unwrap()
        .ends_with("literature-review"));
    assert_eq!(loaded["scripts"][0]["path"], "scripts/verify_citations.py");
    assert!(loaded["scripts"][0]["command"]
        .as_str()
        .unwrap()
        .replace('\\', "/")
        .contains("scripts/verify_citations.py"));

    crate::skills::set_project_enabled(
        &storage,
        None,
        "project-a",
        "literature-review",
        Some(false),
    )
    .unwrap();
    let refused = bridge
        .call_tool("load_skill", &json!({"id":"literature-review"}))
        .await
        .unwrap_err();
    assert!(refused.contains("literature-review"));
    bridge.shutdown().await;
}

#[test]
fn stdio_server_rewrites_an_http_entry_into_a_bridge_command() {
    let http = serde_json::json!({
        "type": "http",
        "name": "oleafly-research",
        "url": "http://127.0.0.1:54321/mcp",
        "headers": [{ "name": "Authorization", "value": "Bearer secret-token" }],
    });
    let stdio = super::stdio_server(&http).unwrap();
    assert_eq!(stdio["name"], "oleafly-research");
    assert!(stdio.get("type").is_none());
    assert!(stdio.get("url").is_none());
    assert!(stdio.get("headers").is_none());
    assert_eq!(
        stdio["command"].as_str().unwrap(),
        std::env::current_exe().unwrap().to_string_lossy()
    );
    assert_eq!(stdio["args"], serde_json::json!(["--oleafly-mcp-stdio"]));
    let env = stdio["env"].as_array().unwrap();
    let value = |name: &str| {
        env.iter()
            .find(|entry| entry["name"] == name)
            .map(|entry| entry["value"].as_str().unwrap().to_owned())
    };
    assert_eq!(
        value("OLEAFLY_MCP_URL").as_deref(),
        Some("http://127.0.0.1:54321/mcp")
    );
    assert_eq!(
        value("OLEAFLY_MCP_TOKEN").as_deref(),
        Some("Bearer secret-token")
    );
}

#[test]
fn stdio_server_refuses_an_entry_without_an_address_or_credential() {
    let missing_url = serde_json::json!({
        "type": "http",
        "name": "oleafly-research",
        "headers": [{ "name": "Authorization", "value": "Bearer token" }],
    });
    assert!(super::stdio_server(&missing_url)
        .unwrap_err()
        .contains("address"));
    let missing_token = serde_json::json!({
        "type": "http",
        "name": "oleafly-research",
        "url": "http://127.0.0.1:1/mcp",
        "headers": [{ "name": "X-Other", "value": "value" }],
    });
    assert!(super::stdio_server(&missing_token)
        .unwrap_err()
        .contains("credential"));
}

#[test]
fn the_stdio_bridge_carries_real_tool_calls_and_reports_an_unreachable_server() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("main.tex"), "\\section{Intro}\n").unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let served = runtime.block_on(bridge(temp.path(), None));
    let entry = super::stdio_server(&served.mcp_server()).unwrap();
    let value = |name: &str| {
        entry["env"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["name"] == name)
            .map(|item| item["value"].as_str().unwrap().to_owned())
            .unwrap()
    };
    let url = value("OLEAFLY_MCP_URL");
    let token = value("OLEAFLY_MCP_TOKEN");

    let requests = concat!(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent","version":"1"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        "\n",
        "\n",
        r#"not json at all"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"main.tex"}}}"#,
        "\n",
    );
    let mut written = Vec::new();
    super::stdio::pump(
        &runtime,
        &url,
        &token,
        std::io::Cursor::new(requests),
        &mut written,
    )
    .unwrap();
    let replies: Vec<Value> = String::from_utf8(written)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 2, "one reply per request with an id");
    assert_eq!(replies[0]["id"], 1);
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "oleafly");
    assert_eq!(replies[1]["id"], 2);
    assert!(replies[1]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("Intro"));

    runtime.block_on(served.shutdown());
    let mut after = Vec::new();
    super::stdio::pump(
        &runtime,
        &url,
        &token,
        std::io::Cursor::new(
            "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\",\"params\":{}}\n",
        ),
        &mut after,
    )
    .unwrap();
    let reply: Value = serde_json::from_str(String::from_utf8(after).unwrap().trim()).unwrap();
    assert_eq!(reply["id"], 9);
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unavailable")
            || reply["error"]["code"].is_number()
    );
}
