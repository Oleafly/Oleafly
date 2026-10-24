//! A stdio bridge to the app's MCP server (`<data>/mcp.json`), for clients
//! that start a command rather than connect to a URL. The bearer token lives
//! only in memory and in the `Authorization` header; it never reaches
//! stdout, stderr or an error message.
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Semaphore};
use zeroize::Zeroizing;

use crate::contract::{CliError, ErrorKind};

const MAX_ENDPOINT_BYTES: u64 = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_IN_FLIGHT: usize = 8;
const LOOPBACK_PREFIX: &str = "http://127.0.0.1:";
/// How long a confirmed "the app still has this project open" answer is
/// reused before the next `tools/call` asks again.
const PROJECT_CHECK_TTL: Duration = Duration::from_secs(1);

/// The app's MCP endpoint.
pub struct BridgeTarget {
    pub url: String,
    pub token: Zeroizing<String>,
}

impl std::fmt::Debug for BridgeTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BridgeTarget")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

fn loopback_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix(LOOPBACK_PREFIX) else {
        return false;
    };
    let Some(port) = rest.strip_suffix("/mcp") else {
        return false;
    };
    !port.is_empty() && port.len() <= 5 && port.chars().all(|character| character.is_ascii_digit())
}

/// Reads `<data>/mcp.json` (a regular file of at most 64 KiB whose URL is
/// the loopback `/mcp` endpoint).
pub fn discover(data_root: &Path) -> Option<BridgeTarget> {
    let path = data_root.join("mcp.json");
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ENDPOINT_BYTES {
        return None;
    }
    let bytes = Zeroizing::new(std::fs::read(&path).ok()?);
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let url = value.get("url")?.as_str()?.to_string();
    let token = Zeroizing::new(value.get("token")?.as_str()?.to_string());
    (loopback_url(&url) && !token.is_empty()).then_some(BridgeTarget { url, token })
}

fn client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .ok()
}

async fn post(
    client: &reqwest::Client,
    target: &BridgeTarget,
    body: &Value,
    protocol: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::Response, ()> {
    let mut request = client
        .post(&target.url)
        .timeout(timeout)
        .bearer_auth(target.token.as_str())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream",
        )
        .json(body);
    if let Some(protocol) = protocol {
        request = request.header("MCP-Protocol-Version", protocol);
    }
    request.send().await.map_err(|_| ())
}

/// Whether the app's server answers a `ping` within `timeout`.
pub async fn ping(target: &BridgeTarget, timeout: Duration) -> bool {
    let Some(client) = client() else {
        return false;
    };
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "ping"});
    match post(&client, target, &body, None, timeout).await {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .is_ok_and(|value| value.get("result").is_some()),
        _ => false,
    }
}

/// The project the app has open (its `get_status` tool), if it answers.
pub async fn app_project_id(target: &BridgeTarget) -> Option<String> {
    let client = client()?;
    open_project_id(&client, target).await
}

async fn open_project_id(client: &reqwest::Client, target: &BridgeTarget) -> Option<String> {
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_status", "arguments": {}}});
    let response = post(client, target, &body, None, STATUS_TIMEOUT)
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: Value = response.json().await.ok()?;
    let text = value.pointer("/result/content/0/text")?.as_str()?;
    let status: Value = serde_json::from_str(text).ok()?;
    status.get("project_id")?.as_str().map(str::to_owned)
}

/// The `data:` messages of an SSE body.
fn sse_messages(body: &str) -> Vec<String> {
    let mut messages = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in body.lines() {
        if line.is_empty() {
            if !current.is_empty() {
                messages.push(current.join("\n"));
                current.clear();
            }
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            current.push(data.strip_prefix(' ').unwrap_or(data));
        }
    }
    if !current.is_empty() {
        messages.push(current.join("\n"));
    }
    messages
}

async fn write_line(stdout: &Mutex<tokio::io::Stdout>, line: &str) {
    let mut stdout = stdout.lock().await;
    let _ = stdout.write_all(line.as_bytes()).await;
    let _ = stdout.write_all(b"\n").await;
    let _ = stdout.flush().await;
}

fn stopped_answering(id: &Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32603, "message": "The Oleafly app stopped answering."}}).to_string()
}

/// A failed tool result (the call reaches the client as a tool error, not
/// a protocol error).
fn tool_refused(id: &Value, text: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": {"content": [{"type": "text", "text": text}], "isError": true}}).to_string()
}

struct Shared {
    data_root: std::path::PathBuf,
    target: Mutex<BridgeTarget>,
    protocol: Mutex<Option<String>>,
    client: reqwest::Client,
    stdout: Mutex<tokio::io::Stdout>,
    /// In auto mode, the project this folder is: every `tools/call` is
    /// forwarded only while the app still has it open (the app's tools act
    /// on whatever project it has open and take no project argument).
    expected_project: Option<String>,
    /// When the app last confirmed `expected_project` was open.
    confirmed_at: std::sync::Mutex<Option<std::time::Instant>>,
}

impl Shared {
    /// A copy of the endpoint, so no lock is held while a request runs.
    async fn target(&self) -> BridgeTarget {
        let target = self.target.lock().await;
        BridgeTarget {
            url: target.url.clone(),
            token: target.token.clone(),
        }
    }

    /// Why a `tools/call` must not be forwarded now, if it mustn't.
    async fn project_refusal(&self) -> Option<&'static str> {
        let expected = self.expected_project.as_deref()?;
        let fresh =
            |at: &Option<std::time::Instant>| at.is_some_and(|at| at.elapsed() < PROJECT_CHECK_TTL);
        if fresh(&self.confirmed_at.lock().unwrap_or_else(|e| e.into_inner())) {
            return None;
        }
        let target = self.target().await;
        match open_project_id(&self.client, &target).await {
            Some(open) if open == expected => {
                *self.confirmed_at.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(std::time::Instant::now());
                None
            }
            Some(_) => Some(
                "Oleafly now has another project open, so this call wasn't sent. Open this project in Oleafly again, or restart the MCP server to work on it without the app.",
            ),
            None => Some(
                "Oleafly didn't say which project it has open, so this call wasn't sent. Try again.",
            ),
        }
    }
}

/// Forwards one message; writes the reply (if any) to stdout.
async fn forward(shared: Arc<Shared>, message: Value) {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str);
    let is_initialize = method == Some("initialize");
    if method == Some("tools/call") {
        if let Some(refusal) = shared.project_refusal().await {
            if let Some(id) = &id {
                write_line(&shared.stdout, &tool_refused(id, refusal)).await;
            }
            return;
        }
    }
    for attempt in 0..2 {
        let protocol = shared.protocol.lock().await.clone();
        let target = shared.target().await;
        let result = post(
            &shared.client,
            &target,
            &message,
            protocol.as_deref(),
            REQUEST_TIMEOUT,
        )
        .await;
        let response = match result {
            Ok(response) => response,
            Err(()) => break,
        };
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            // The app may have restarted with a new token.
            if let Some(fresh) = discover(&shared.data_root) {
                *shared.target.lock().await = fresh;
                continue;
            }
            break;
        }
        if status == reqwest::StatusCode::ACCEPTED {
            return;
        }
        if !status.is_success() {
            break;
        }
        let event_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/event-stream"));
        let Ok(body) = response.text().await else {
            break;
        };
        if body.trim().is_empty() {
            return;
        }
        let messages = if event_stream {
            sse_messages(&body)
        } else {
            vec![body]
        };
        for text in messages {
            let Ok(value) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if is_initialize {
                if let Some(version) = value
                    .pointer("/result/protocolVersion")
                    .and_then(Value::as_str)
                {
                    *shared.protocol.lock().await = Some(version.to_string());
                }
            }
            write_line(&shared.stdout, &value.to_string()).await;
        }
        return;
    }
    if let Some(id) = id {
        write_line(&shared.stdout, &stopped_answering(&id)).await;
    }
}

/// Bridges stdin to the app until stdin closes. With `expected_project`,
/// tool calls go through only while the app has that project open.
pub async fn serve_bridge(
    data_root: &Path,
    target: BridgeTarget,
    expected_project: Option<String>,
) -> Result<(), CliError> {
    let client = client().ok_or_else(|| {
        CliError::new(
            ErrorKind::Internal,
            "internal",
            "Oleafly couldn't start its HTTP client.",
        )
    })?;
    let shared = Arc::new(Shared {
        data_root: data_root.to_path_buf(),
        target: Mutex::new(target),
        protocol: Mutex::new(None),
        client,
        stdout: Mutex::new(tokio::io::stdout()),
        expected_project,
        confirmed_at: std::sync::Mutex::new(None),
    });
    let slots = Arc::new(Semaphore::new(MAX_IN_FLIGHT));
    let mut lines = super::server::StdinLines::new();
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(line) = lines.next().await {
        let message = match line {
            super::server::Line::Message(message) => message,
            super::server::Line::Reply(reply) => {
                write_line(&shared.stdout, &reply.to_string()).await;
                continue;
            }
        };
        let Ok(permit) = slots.clone().acquire_owned().await else {
            break;
        };
        let shared = shared.clone();
        tasks.spawn(async move {
            forward(shared, message).await;
            drop(permit);
        });
        while tasks.try_join_next().is_some() {}
    }
    while tasks.join_next().await.is_some() {}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[test]
    fn only_loopback_urls_are_trusted() {
        let data = tempfile::tempdir().unwrap();
        for (url, trusted) in [
            ("http://127.0.0.1:4321/mcp", true),
            ("http://example.com/mcp", false),
            ("http://127.0.0.1:4321/other", false),
            ("https://127.0.0.1:4321/mcp", false),
            ("http://127.0.0.1:/mcp", false),
        ] {
            std::fs::write(
                data.path().join("mcp.json"),
                json!({"url": url, "token": "s3cr3t"}).to_string(),
            )
            .unwrap();
            assert_eq!(discover(data.path()).is_some(), trusted, "{url}");
        }
    }

    #[test]
    fn debug_output_never_shows_the_token() {
        let target = BridgeTarget {
            url: "http://127.0.0.1:1/mcp".into(),
            token: Zeroizing::new("s3cr3t".into()),
        };
        assert!(!format!("{target:?}").contains("s3cr3t"));
    }

    #[test]
    fn event_streams_split_into_messages() {
        assert_eq!(
            sse_messages("event: message\ndata: {\"a\":1}\n\ndata: {\"b\":2}\n\n"),
            ["{\"a\":1}", "{\"b\":2}"]
        );
    }

    /// A one-request HTTP server answering `status` with `body`; returns the
    /// request it saw.
    fn serve_once(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://127.0.0.1:{}/mcp",
            listener.local_addr().unwrap().port()
        );
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                request.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut payload = vec![0; length];
            reader.read_exact(&mut payload).unwrap();
            request.push_str(&String::from_utf8_lossy(&payload));
            let reply = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            stream.write_all(reply.as_bytes()).unwrap();
            request
        });
        (url, handle)
    }

    #[tokio::test]
    async fn the_bridge_sends_the_token_only_as_a_bearer_header() {
        let (url, server) = serve_once("200 OK", r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
        let target = BridgeTarget {
            url,
            token: Zeroizing::new("s3cr3t".into()),
        };
        assert!(ping(&target, Duration::from_secs(5)).await);
        let request = server.join().unwrap();
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer s3cr3t"));
        assert!(!request
            .split("\r\n\r\n")
            .nth(1)
            .unwrap_or_default()
            .contains("s3cr3t"));
    }

    #[test]
    fn bridge_failures_never_echo_the_token() {
        let message = stopped_answering(&json!(3));
        assert!(!message.contains("s3cr3t"));
        assert!(message.contains("-32603"));
    }

    #[tokio::test]
    async fn auto_bridges_only_when_the_app_has_this_project_open() {
        let (url, server) = serve_once(
            "200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"project_id\":\"abc\"}"}]}}"#,
        );
        let target = BridgeTarget {
            url,
            token: Zeroizing::new("t".into()),
        };
        assert_eq!(app_project_id(&target).await.as_deref(), Some("abc"));
        server.join().unwrap();
    }

    fn shared_for(url: String, expected_project: Option<&str>) -> Arc<Shared> {
        Arc::new(Shared {
            data_root: std::path::PathBuf::new(),
            target: Mutex::new(BridgeTarget {
                url,
                token: Zeroizing::new("t".into()),
            }),
            protocol: Mutex::new(None),
            client: client().unwrap(),
            stdout: Mutex::new(tokio::io::stdout()),
            expected_project: expected_project.map(str::to_owned),
            confirmed_at: std::sync::Mutex::new(None),
        })
    }

    #[tokio::test]
    async fn tool_calls_stop_once_the_app_opens_another_project() {
        let (url, server) = serve_once(
            "200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"project_id\":\"grant\"}"}]}}"#,
        );
        let shared = shared_for(url, Some("thesis"));
        let refusal = shared.project_refusal().await.expect("refused");
        assert!(refusal.contains("another project"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn a_confirmed_project_is_reused_for_a_second() {
        let (url, server) = serve_once(
            "200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"project_id\":\"thesis\"}"}]}}"#,
        );
        let shared = shared_for(url, Some("thesis"));
        assert_eq!(shared.project_refusal().await, None);
        server.join().unwrap();
        // The server has gone: a second check inside the TTL doesn't ask.
        assert_eq!(shared.project_refusal().await, None);
        *shared.confirmed_at.lock().unwrap() = None;
        assert!(shared.project_refusal().await.is_some());
    }

    #[tokio::test]
    async fn without_an_expected_project_nothing_is_checked() {
        let shared = shared_for("http://127.0.0.1:1/mcp".into(), None);
        assert_eq!(shared.project_refusal().await, None);
    }

    #[tokio::test]
    async fn requests_are_forwarded_side_by_side() {
        // The server answers only once both requests have arrived, so a
        // bridge that sends one request at a time never finishes.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://127.0.0.1:{}/mcp",
            listener.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || {
            let mut streams = Vec::new();
            for _ in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0usize;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                    if line == "\r\n" {
                        break;
                    }
                }
                let mut payload = vec![0; length];
                reader.read_exact(&mut payload).unwrap();
                streams.push(stream);
            }
            for mut stream in streams {
                stream
                    .write_all(
                        b"HTTP/1.1 202 Accepted\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                    )
                    .unwrap();
            }
        });
        let shared = shared_for(url, None);
        let first = forward(
            shared.clone(),
            json!({"jsonrpc": "2.0", "method": "notifications/a"}),
        );
        let second = forward(
            shared.clone(),
            json!({"jsonrpc": "2.0", "method": "notifications/b"}),
        );
        tokio::time::timeout(Duration::from_secs(20), async {
            tokio::join!(first, second);
        })
        .await
        .expect("the second request waited for the first");
        server.join().unwrap();
    }
}
